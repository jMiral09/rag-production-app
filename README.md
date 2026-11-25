# Local embeddings with Ollama

This app generates embeddings and answers questions locally with Ollama. PDF
chunks are stored in Qdrant.

## Local services

Install and start [Ollama](https://ollama.com/) and pull the models:

```bash
ollama pull nomic-embed-text
ollama pull llama3.2:3b
```

Ensure Qdrant is running at `http://localhost:6333`.

## Run the application

Start the FastAPI backend from the repository root:

```bash
uv run uvicorn main:app --reload
```

In another terminal, start the Inngest dev server:

```bash
npx inngest-cli@latest dev -u http://127.0.0.1:8000/api/inngest --no-discovery
```

Then start the Next.js frontend:

```bash
cd frontend
npm run dev
```

Open `http://localhost:3000`. Uploading a PDF saves it under `uploads/` and
queues the `rag/ingest_pdf` Inngest event. Wait for that Inngest run to finish
before asking questions. Chat requests go to the synchronous FastAPI endpoint.

The app uses the `docs_ollama` Qdrant collection to keep these vectors separate
from any existing `docs` collection. Existing vectors are not deleted; PDFs
must be ingested again to populate `docs_ollama`.

Set `OLLAMA_BASE_URL` if Ollama is running at a different address. The default
is `http://localhost:11434/v1`. Set `OLLAMA_CHAT_MODEL` to use a different local
chat model; the default is `llama3.2:3b`. The frontend API defaults to
`http://localhost:8000`; override it with `NEXT_PUBLIC_API_BASE_URL` if needed.