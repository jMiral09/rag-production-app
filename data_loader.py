from openai import OpenAI
from llama_index.readers.file import PDFReader
from llama_index.core.node_parser import SentenceSplitter
from dotenv import load_dotenv
import os

load_dotenv()

OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434/v1")
OLLAMA_CHAT_MODEL = os.getenv("OLLAMA_CHAT_MODEL", "llama3.2:3b")

client = OpenAI(
    base_url=OLLAMA_BASE_URL,
    api_key="ollama",
)
EMBED_MODEL = "nomic-embed-text"
EMBED_DIM = 768

splitter = SentenceSplitter(chunk_size = 1000, chunk_overlap = 200)

# Reads a PDF and splits its extracted text into overlapping chunks.
def load_and_chunk_pdf(path: str):
    docs = PDFReader().load_data(file=path)
    texts = [d.text for d in docs if getattr(d, "text", None)]
    chunks = []
    for t in texts:
        chunks.extend(splitter.split_text(t))
    return chunks

# Requests embedding vectors for text chunks from the local Ollama endpoint.
def embed_texts(texts: list[str]) -> list[list[float]]:
    response = client.embeddings.create(
        model=EMBED_MODEL,
        input=texts
    )
    return [item.embedding for item in response.data]