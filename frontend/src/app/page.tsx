"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";

const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000"
).replace(/\/$/, "");

type UploadResponse = {
  event_id: string;
  filename: string;
  status: string;
};

type QueryResponse = {
  answer: string;
  sources: string[];
  num_contexts: number;
};

type ChatMessage = {
  id: string;
  role: "assistant" | "user";
  content: string;
  sources?: string[];
  numContexts?: number;
  isError?: boolean;
};

// Sends a request to the API and turns backend errors into readable messages.
async function requestJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload: unknown = await response.json().catch(() => undefined);

  if (!response.ok) {
    const detail =
      typeof payload === "object" &&
      payload !== null &&
      "detail" in payload &&
      typeof payload.detail === "string"
        ? payload.detail
        : "The request could not be completed.";
    throw new Error(detail);
  }

  return payload as T;
}

// Renders the document uploader and chat while keeping their UI state.
export default function Home() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [uploadResult, setUploadResult] = useState<UploadResponse | null>(null);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "Hi! Upload a PDF, let its Inngest run finish, then ask me anything about the document.",
    },
  ]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Keep the latest chat message visible as the conversation changes.
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, asking]);

  // Uploads the selected PDF so FastAPI can queue its Inngest ingestion.
  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedFile || uploading) return;

    setUploading(true);
    setUploadError("");
    setUploadResult(null);

    const formData = new FormData();
    formData.append("file", selectedFile);

    try {
      const result = await requestJson<UploadResponse>(
        `${API_BASE_URL}/api/upload`,
        { method: "POST", body: formData },
      );
      setUploadResult(result);
    } catch (error) {
      setUploadError(
        error instanceof Error ? error.message : "PDF upload failed.",
      );
    } finally {
      setUploading(false);
    }
  }

  // Sends a question to FastAPI and adds its answer or error to the chat.
  async function handleAsk(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedQuestion = question.trim();
    if (!trimmedQuestion || asking) return;

    setQuestion("");
    setAsking(true);
    setMessages((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        role: "user",
        content: trimmedQuestion,
      },
    ]);

    try {
      const result = await requestJson<QueryResponse>(
        `${API_BASE_URL}/api/query`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: trimmedQuestion }),
        },
      );
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: result.answer,
          sources: result.sources,
          numContexts: result.num_contexts,
        },
      ]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content:
            error instanceof Error
              ? error.message
              : "I couldn't answer that question.",
          isError: true,
        },
      ]);
    } finally {
      setAsking(false);
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="Papertrail home">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path
                d="M6.5 3.75h7.25l4.75 4.8v11.7H6.5V3.75Z"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinejoin="round"
              />
              <path
                d="M13.5 3.9v5h4.8M9.5 13h6M9.5 16.5h6"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span className="brand-name">papertrail</span>
        </Link>
        <div className="topbar-meta">
          <span className="local-indicator" />
          <span>Private · local models</span>
        </div>
      </header>

      <div className="workspace">
        <section className="intro">
          <div className="eyebrow">
            <span className="eyebrow-line" />
            YOUR PERSONAL DOCUMENT ASSISTANT
          </div>
          <h1>
            Good questions
            <br />
            <span>start on paper.</span>
          </h1>
          <p>
            Bring a PDF. Get to the details that matter, with answers grounded
            in your own documents.
          </p>
        </section>

        <div className="workspace-grid">
          <aside className="source-panel">
            <div className="panel-kicker">
              <span>01</span>
              <span>YOUR LIBRARY</span>
            </div>
            <h2>Add a document</h2>
            <p className="panel-copy">
              Upload a PDF to add it to your searchable library.
            </p>

            <form className="upload-form" onSubmit={handleUpload}>
              <input
                ref={fileInputRef}
                className="visually-hidden"
                id="pdf-file"
                type="file"
                accept=".pdf,application/pdf"
                onChange={(event) => {
                  setSelectedFile(event.target.files?.[0] ?? null);
                  setUploadError("");
                  setUploadResult(null);
                }}
              />
              <button
                className={`dropzone${selectedFile ? " dropzone-selected" : ""}`}
                type="button"
                onClick={() => fileInputRef.current?.click()}
                aria-describedby="upload-hint"
              >
                <span className="upload-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none">
                    <path
                      d="M12 15.5V4.75m0 0L8.25 8.5M12 4.75l3.75 3.75M5 14.75v4.5h14v-4.5"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                <span className="dropzone-title">
                  {selectedFile ? selectedFile.name : "Choose a PDF"}
                </span>
                <span className="dropzone-subtitle">
                  {selectedFile
                    ? `${(selectedFile.size / (1024 * 1024)).toFixed(1)} MB · Ready to upload`
                    : "or click to browse your files"}
                </span>
              </button>
              <p className="upload-hint" id="upload-hint">
                PDF only · up to 25 MB
              </p>
              <button
                className="upload-button"
                type="submit"
                disabled={!selectedFile || uploading}
              >
                {uploading ? (
                  <>
                    <span className="spinner" />
                    Sending to Inngest
                  </>
                ) : (
                  <>
                    Add to library
                    <span aria-hidden="true">↗</span>
                  </>
                )}
              </button>
            </form>

            {uploadError && (
              <p className="feedback feedback-error" role="alert">
                {uploadError}
              </p>
            )}
            {uploadResult && (
              <div className="feedback feedback-success" role="status">
                <span className="success-dot" />
                <div>
                  <strong>{uploadResult.filename} queued</strong>
                  <p>
                    Wait for its Inngest run to finish before asking about it.
                  </p>
                  <code>Event {uploadResult.event_id.slice(0, 12)}</code>
                </div>
              </div>
            )}

            <div className="pipeline-note">
              <div className="pipeline-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none">
                  <path
                    d="M4.5 7h15M7.5 12h9m-6 5h3"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                  />
                </svg>
              </div>
              <p>
                PDFs are chunked and indexed locally with Ollama and Qdrant.
              </p>
            </div>
          </aside>

          <section className="chat-panel" aria-label="Chat with your documents">
            <div className="chat-header">
              <div className="chat-title">
                <span className="assistant-mark" aria-hidden="true">
                  ✳
                </span>
                <div>
                  <h2>Ask your library</h2>
                  <p>Answers are based on your indexed PDFs</p>
                </div>
              </div>
              <span className="model-badge">
                <span className="local-indicator" />
                OLLAMA
              </span>
            </div>

            <div className="message-list" role="log" aria-live="polite">
              {messages.map((message) => (
                <article
                  className={`message message-${message.role}`}
                  key={message.id}
                >
                  {message.role === "assistant" && (
                    <span className="message-avatar" aria-hidden="true">
                      ✳
                    </span>
                  )}
                  <div className="message-body">
                    <span className="message-author">
                      {message.role === "assistant" ? "Papertrail" : "You"}
                    </span>
                    <p className={message.isError ? "message-error" : ""}>
                      {message.content}
                    </p>
                    {message.sources && message.sources.length > 0 && (
                      <div className="sources">
                        <span>
                          {message.numContexts} passages · Sources
                        </span>
                        {message.sources.map((source) => (
                          <span className="source-chip" key={source}>
                            {source}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </article>
              ))}
              {asking && (
                <article className="message message-assistant">
                  <span className="message-avatar" aria-hidden="true">
                    ✳
                  </span>
                  <div className="message-body">
                    <span className="message-author">Papertrail</span>
                    <p className="thinking">
                      Searching your documents
                      <span className="thinking-dots" aria-hidden="true">
                        ...
                      </span>
                    </p>
                  </div>
                </article>
              )}
              <div ref={messagesEndRef} />
            </div>

            <form className="chat-form" onSubmit={handleAsk}>
              <label className="visually-hidden" htmlFor="question">
                Ask a question about your PDFs
              </label>
              <input
                id="question"
                type="text"
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder="Ask a question about your documents..."
                autoComplete="off"
                disabled={asking}
              />
              <button
                className="send-button"
                type="submit"
                aria-label="Send question"
                disabled={!question.trim() || asking}
              >
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M5 12h14m-6-6 6 6-6 6"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </form>
            <p className="chat-footnote">
              Answers can make mistakes. Check the cited document sources.
            </p>
          </section>
        </div>
        <footer className="page-footer">
          <span>Made for curious readers.</span>
          <span>LOCAL RAG WORKSPACE</span>
        </footer>
      </div>
    </main>
  );
}
