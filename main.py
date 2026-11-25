import asyncio
import logging
from pathlib import Path
from fastapi import FastAPI, File, HTTPException, UploadFile
import inngest
import inngest.fast_api
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from pydantic import BaseModel, Field
import uuid
import os
from data_loader import (
    EMBED_DIM,
    OLLAMA_CHAT_MODEL,
    client as ollama_client,
    embed_texts,
    load_and_chunk_pdf,
)
from vector_db import QdrantStorage
from custom_types import RAGChunkAndSrc, RAGUpsertResult, RAGSearchResult, RAGQueryResult


load_dotenv()

UPLOAD_DIR = Path(os.getenv("PDF_UPLOAD_DIR", Path(__file__).parent / "uploads"))
MAX_PDF_BYTES = 25 * 1024 * 1024


inngest_client = inngest.Inngest(
    app_id="rag_app",
    logger=logging.getLogger("uvicorn"),
    is_production=False,
    serializer=inngest.PydanticSerializer()
)

class QueryRequest(BaseModel):
    question: str = Field(min_length=1, max_length=4000)
    top_k: int = Field(default=5, ge=1, le=20)

class UploadResponse(BaseModel):
    event_id: str
    filename: str
    status: str

# Embeds a question and retrieves its most relevant document passages.
def _search(question: str, top_k: int = 5) -> RAGSearchResult:
    query_vec = embed_texts([question])[0]
    found = QdrantStorage().search(query_vec, top_k)
    return RAGSearchResult(context=found["context"], sources=found["sources"])

# Uses the local Ollama chat model to answer from retrieved passages.
def _generate_answer(question: str, contexts: list[str]) -> str:
    context_block = "\n\n".join(f"- {context}" for context in contexts)
    response = ollama_client.chat.completions.create(
        model=OLLAMA_CHAT_MODEL,
        messages=[
            {
                "role": "system",
                "content": "You answer questions using only the provided context.",
            },
            {
                "role": "user",
                "content": (
                    "Use the following context to answer the question.\n\n"
                    f"Context:\n{context_block}\n\n"
                    f"Question: {question}\n"
                    "Answer concisely using the context above."
                ),
            },
        ],
        max_tokens=1024,
        temperature=0.2,
    )
    answer = response.choices[0].message.content
    if not answer:
        raise RuntimeError("Ollama returned an empty answer")
    return answer.strip()

# Processes an Inngest PDF event through loading, embedding, and Qdrant storage.
@inngest_client.create_function(
    fn_id="RAG: Ingest PDF",
    trigger=inngest.TriggerEvent(event="rag/ingest_pdf")
)
async def rag_ingest_pdf(ctx: inngest.Context):
    # Loads the event's PDF and returns its text chunks with the source ID.
    def _load(ctx: inngest.Context) -> RAGChunkAndSrc:
        pdf_path = ctx.event.data["pdf_path"]
        source_id = ctx.event.data.get("source_id", pdf_path)
        chunks = load_and_chunk_pdf(pdf_path)
        return RAGChunkAndSrc(chunks=chunks, source_id=source_id)

    # Embeds the chunks and upserts them into the document collection.
    def _upsert(data: RAGChunkAndSrc) -> RAGUpsertResult:
        chunks = data.chunks
        source_id = data.source_id
        vecs = embed_texts(chunks)
        ids = [str(uuid.uuid5(uuid.NAMESPACE_URL, f"{source_id}:{i}")) for i in range(len(chunks))]
        payloads = [{"source": source_id, "text": chunks[i]} for i in range(len(chunks))]
        QdrantStorage(dim=EMBED_DIM).upsert(ids, vecs, payloads)
        return RAGUpsertResult(ingested=len(chunks))

    chunks_and_src = await ctx.step.run("load-and-chunk", lambda: _load(ctx), output_type=RAGChunkAndSrc)
    ingested = await ctx.step.run("embed-and-upsert", lambda: _upsert(chunks_and_src), output_type=RAGUpsertResult)
    return ingested.model_dump()

# Handles question events as durable search and answer-generation steps.
@inngest_client.create_function(
    fn_id="RAG: Query PDF",
    trigger = inngest.TriggerEvent(event="rag/query_pdf_ai")
)
async def rag_query_pdf_ai(ctx: inngest.Context):
    question = ctx.event.data["question"]
    top_k = int(ctx.event.data.get("top_k", 5))

    found = await ctx.step.run("emb-and-search", lambda: _search(question, top_k), output_type=RAGSearchResult)
    if not found.context:
        raise ValueError("No indexed PDF content was found")
    answer = await ctx.step.run(
        "llm-answer",
        lambda: _generate_answer(question, found.context),
        output_type=str,
    )
    return RAGQueryResult(
        answer=answer,
        sources=found.sources,
        num_contexts=len(found.context),
    ).model_dump()

app = FastAPI()

frontend_origins = [
    origin.strip()
    for origin in os.getenv(
        "FRONTEND_ORIGINS",
        "http://localhost:3000,http://127.0.0.1:3000",
    ).split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=frontend_origins,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

# Validates an uploaded PDF, saves it, and queues its Inngest event.
@app.post("/api/upload", status_code=202, response_model=UploadResponse)
async def upload_pdf(file: UploadFile = File(...)):
    filename = Path(file.filename or "").name
    if not filename or Path(filename).suffix.lower() != ".pdf":
        raise HTTPException(status_code=415, detail="Please upload a PDF file")

    content = await file.read(MAX_PDF_BYTES + 1)
    if len(content) > MAX_PDF_BYTES:
        raise HTTPException(status_code=413, detail="PDF must be 25 MB or smaller")
    if b"%PDF-" not in content[:1024]:
        raise HTTPException(status_code=415, detail="The uploaded file is not a valid PDF")

    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    pdf_path = UPLOAD_DIR / f"{uuid.uuid4().hex}.pdf"
    await asyncio.to_thread(pdf_path.write_bytes, content)

    event_ids = await inngest_client.send(
        inngest.Event(
            name="rag/ingest_pdf",
            data={
                "pdf_path": str(pdf_path.resolve()),
                "source_id": filename,
            },
        )
    )
    if not event_ids:
        raise HTTPException(status_code=502, detail="Inngest did not accept the upload event")
    return UploadResponse(event_id=event_ids[0], filename=filename, status="queued")

# Retrieves relevant passages and returns an Ollama-generated answer.
@app.post("/api/query", response_model=RAGQueryResult)
def query_documents(request: QueryRequest):
    question = request.question.strip()
    if not question:
        raise HTTPException(status_code=422, detail="Question cannot be blank")

    found = _search(question, request.top_k)
    if not found.context:
        raise HTTPException(
            status_code=409,
            detail="No indexed PDF content found. Wait for Inngest ingestion to finish, then try again.",
        )

    answer = _generate_answer(question, found.context)
    return RAGQueryResult(
        answer=answer,
        sources=found.sources,
        num_contexts=len(found.context),
    )

inngest.fast_api.serve(app, inngest_client, [rag_ingest_pdf, rag_query_pdf_ai])