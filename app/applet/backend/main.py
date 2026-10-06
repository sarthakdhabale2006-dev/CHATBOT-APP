"""
Local AI Chat - FastAPI Backend
Connects frontend requests directly to local Ollama instance running Gemma 4 12B QAT.
Supports chat, streaming SSE, and file attachments.
"""

import json
import logging
import os
import sys
from typing import Any, AsyncGenerator, Dict, List, Literal, Optional, Union

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
import httpx
from pydantic import BaseModel, Field, field_validator, model_validator

# ------------------------------------------------------------------------------
# 1. Environment & Logging Configuration
# ------------------------------------------------------------------------------
backend_dir = os.path.dirname(os.path.abspath(__file__))
env_path = os.path.join(backend_dir, ".env")
load_dotenv(dotenv_path=env_path)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("local_ai_backend")

OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip("/")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "gemma-4-12b-qat").strip() or "gemma-4-12b-qat"
SYSTEM_PROMPT = os.getenv(
    "SYSTEM_PROMPT",
    "You are a helpful, accurate and concise AI assistant. Explain technical concepts clearly. "
    "When writing code, provide complete executable examples. When files are provided, analyze and explain them accurately.",
).strip()
OLLAMA_TIMEOUT_SECONDS = float(os.getenv("OLLAMA_TIMEOUT_SECONDS", "120.0"))

cors_origins_raw = os.getenv(
    "CORS_ORIGINS",
    "http://localhost:5500,http://127.0.0.1:5500,http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173,http://127.0.0.1:5173",
)
CORS_ORIGINS = [origin.strip() for origin in cors_origins_raw.split(",") if origin.strip()]

logger.info("Initializing Local AI Chat Backend")
logger.info("Ollama Base URL: %s", OLLAMA_BASE_URL)
logger.info("Default Model: %s", OLLAMA_MODEL)
logger.info("Allowed CORS Origins: %s", CORS_ORIGINS)

# ------------------------------------------------------------------------------
# 2. FastAPI Application Setup
# ------------------------------------------------------------------------------
app = FastAPI(
    title="Local AI Chat Backend",
    description="FastAPI service proxying conversation requests to local Ollama (Gemma 4 12B QAT).",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS if CORS_ORIGINS else ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ------------------------------------------------------------------------------
# 3. Pydantic Request & Response Schemas
# ------------------------------------------------------------------------------
class AttachedFileItem(BaseModel):
    name: str
    type: Optional[str] = None
    size: Optional[int] = None
    content: Optional[str] = None
    dataUrl: Optional[str] = None
    isImage: Optional[bool] = False


class ChatHistoryItem(BaseModel):
    role: Literal["user", "assistant", "system"]
    content: str = Field(..., min_length=1, max_length=50000, description="Message text content")

    @field_validator("content")
    @classmethod
    def validate_content_not_empty(cls, v: str) -> str:
        stripped = v.strip()
        if not stripped:
            raise ValueError("Message content cannot be blank or only whitespace.")
        return stripped


class ChatRequest(BaseModel):
    message: Optional[str] = Field(default=None, max_length=50000, description="Current user prompt")
    history: List[ChatHistoryItem] = Field(
        default_factory=list,
        max_length=100,
        description="Prior conversation turns for multi-turn context",
    )
    messages: Optional[List[ChatHistoryItem]] = Field(
        default=None,
        description="Alternative list of messages",
    )
    files: Optional[List[AttachedFileItem]] = Field(
        default=None,
        description="Optional list of attached files (text, code, images)",
    )
    model: Optional[str] = Field(
        default=None,
        max_length=100,
        description="Optional model override; defaults to OLLAMA_MODEL",
    )
    system_prompt: Optional[str] = Field(
        default=None,
        max_length=5000,
        description="Optional custom system prompt override",
    )
    stream: Optional[bool] = Field(
        default=None,
        description="Whether to stream response tokens",
    )

    @model_validator(mode="after")
    def populate_message_and_history(self) -> "ChatRequest":
        if not self.message and self.messages:
            user_msgs = [m for m in self.messages if m.role == "user"]
            if user_msgs:
                self.message = user_msgs[-1].content
                last_idx = len(self.messages) - 1 - list(reversed(self.messages)).index(user_msgs[-1])
                self.history = self.messages[:last_idx]
            else:
                self.message = self.messages[-1].content
                self.history = self.messages[:-1]

        # If files exist without a typed message, generate a default prompt
        if not self.message or not self.message.strip():
            if self.files and len(self.files) > 0:
                self.message = f"Please analyze the attached file: {self.files[0].name}"
            else:
                raise ValueError("A non-empty user message or file attachment must be provided.")

        self.message = self.message.strip()
        return self


class ChatResponse(BaseModel):
    reply: str
    response: Optional[str] = None
    model: Optional[str] = None

    @model_validator(mode="after")
    def sync_response_alias(self) -> "ChatResponse":
        if not self.response:
            self.response = self.reply
        return self


class HealthResponse(BaseModel):
    status: str
    ollama: bool
    detail: Optional[str] = None
    model: Optional[str] = None


class ModelResponse(BaseModel):
    model: str
    configured: bool
    status: str


# ------------------------------------------------------------------------------
# 4. Helper Utilities
# ------------------------------------------------------------------------------
async def resolve_effective_model(requested_model: Optional[str]) -> str:
    candidate = (requested_model or OLLAMA_MODEL or "").strip()
    if candidate:
        return candidate

    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            resp = await client.get(f"{OLLAMA_BASE_URL}/api/tags")
            if resp.status_code == 200:
                tags_data = resp.json()
                models = tags_data.get("models", [])
                if models:
                    for m in models:
                        name = m.get("name", "")
                        if "gemma" in name.lower():
                            return name
                    return models[0].get("name", "gemma-4-12b-qat")
    except Exception:
        pass

    return "gemma-4-12b-qat"


def build_ollama_messages(
    request: ChatRequest,
    effective_system_prompt: str,
) -> tuple[List[dict], List[str]]:
    """Assemble messages and images for Ollama /api/chat."""
    messages = []
    images = []

    if effective_system_prompt:
        messages.append({
            "role": "system",
            "content": effective_system_prompt,
        })

    for item in request.history:
        messages.append({
            "role": item.role,
            "content": item.content,
        })

    user_text = request.message or ""

    # Attach file contexts
    if request.files:
        for f in request.files:
            if f.isImage and f.dataUrl:
                b64 = f.dataUrl.split("base64,")[1] if "base64," in f.dataUrl else f.content
                if b64:
                    images.append(b64)
            elif f.content:
                user_text = f"[Attached File: {f.name}]\n```\n{f.content}\n```\n\n{user_text}"

    user_msg_dict: Dict[str, Any] = {
        "role": "user",
        "content": user_text,
    }
    if images:
        user_msg_dict["images"] = images

    messages.append(user_msg_dict)
    return messages, images


# ------------------------------------------------------------------------------
# 5. API Endpoints
# ------------------------------------------------------------------------------
@app.get("/api/health", response_model=HealthResponse, tags=["Health"])
async def check_health():
    ollama_tags_url = f"{OLLAMA_BASE_URL}/api/tags"
    logger.info("Health check: probing Ollama at %s", ollama_tags_url)

    try:
        async with httpx.AsyncClient(timeout=4.0) as client:
            resp = await client.get(ollama_tags_url)
            if resp.status_code == 200:
                return HealthResponse(
                    status="online",
                    ollama=True,
                    model=OLLAMA_MODEL,
                )
            else:
                return JSONResponse(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    content={
                        "status": "offline",
                        "ollama": False,
                        "detail": f"Ollama service returned unexpected status {resp.status_code}",
                        "model": OLLAMA_MODEL,
                    },
                )
    except Exception as exc:
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content={
                "status": "offline",
                "ollama": False,
                "detail": f"Cannot connect to Ollama at {OLLAMA_BASE_URL}: {str(exc)}",
                "model": OLLAMA_MODEL,
            },
        )


@app.get("/api/model", response_model=ModelResponse, tags=["Configuration"])
async def get_configured_model():
    model_name = await resolve_effective_model(None)
    return ModelResponse(
        model=model_name,
        configured=bool(model_name),
        status="configured",
    )


@app.post("/api/chat", tags=["Chat"])
async def chat_completion(request: ChatRequest, req: Request):
    accept_header = req.headers.get("accept", "")
    wants_streaming = (request.stream is True) or ("text/event-stream" in accept_header)

    if wants_streaming:
        return await chat_stream_completion(request)

    model = await resolve_effective_model(request.model)
    system_prompt = request.system_prompt if request.system_prompt is not None else SYSTEM_PROMPT
    ollama_messages, _ = build_ollama_messages(request, system_prompt)

    ollama_chat_url = f"{OLLAMA_BASE_URL}/api/chat"
    payload = {
        "model": model,
        "messages": ollama_messages,
        "stream": False,
    }

    try:
        async with httpx.AsyncClient(timeout=OLLAMA_TIMEOUT_SECONDS) as client:
            resp = await client.post(ollama_chat_url, json=payload)

            if resp.status_code == 200:
                data = resp.json()
                reply_text = data.get("message", {}).get("content", "")
                return {
                    "reply": reply_text,
                    "response": reply_text,
                    "message": {"role": "assistant", "content": reply_text},
                    "model": model,
                }
            elif resp.status_code == 404:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Model '{model}' not found in Ollama. Run 'ollama pull {model}' to download it.",
                )
            else:
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail=f"Ollama server returned error {resp.status_code}: {resp.text}",
                )
    except httpx.ConnectError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Failed to connect to local Ollama instance at {OLLAMA_BASE_URL}. Ensure Ollama is running ('ollama serve').",
        )
    except httpx.TimeoutException:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail=f"Ollama request timed out after {OLLAMA_TIMEOUT_SECONDS}s.",
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Internal server error: {str(exc)}",
        )


@app.post("/api/chat/stream", tags=["Chat"])
async def chat_stream_completion(request: ChatRequest):
    model = await resolve_effective_model(request.model)
    system_prompt = request.system_prompt if request.system_prompt is not None else SYSTEM_PROMPT
    ollama_messages, _ = build_ollama_messages(request, system_prompt)

    ollama_chat_url = f"{OLLAMA_BASE_URL}/api/chat"
    payload = {
        "model": model,
        "messages": ollama_messages,
        "stream": True,
    }

    async def event_generator() -> AsyncGenerator[str, None]:
        try:
            async with httpx.AsyncClient(timeout=OLLAMA_TIMEOUT_SECONDS) as client:
                async with client.stream("POST", ollama_chat_url, json=payload) as response:
                    if response.status_code != 200:
                        yield f"data: {json.dumps({'error': f'Ollama error {response.status_code}'})}\n\n"
                        yield "data: [DONE]\n\n"
                        return

                    async for line in response.aiter_lines():
                        if not line or not line.strip():
                            continue

                        try:
                            chunk_data = json.loads(line)
                            content = chunk_data.get("message", {}).get("content", "")
                            is_done = chunk_data.get("done", False)

                            out_chunk = {
                                "reply": content,
                                "response": content,
                                "delta": {"content": content},
                                "message": {"content": content},
                                "done": is_done,
                            }
                            yield f"data: {json.dumps(out_chunk)}\n\n"

                            if is_done:
                                yield "data: [DONE]\n\n"
                                break
                        except json.JSONDecodeError:
                            continue

        except Exception as exc:
            yield f"data: {json.dumps({'error': str(exc)})}\n\n"
            yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.main:app", host="127.0.0.1", port=8000, reload=True)
