"""
Local AI Chat - FastAPI Backend
Connects frontend requests directly to local Ollama instance running Gemma 4 12B QAT.
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
    "When writing code, provide complete executable examples. If uncertain, say so instead of inventing information.",
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
class ChatHistoryItem(BaseModel):
    role: Literal["user", "assistant", "system"]
    content: str = Field(..., min_length=1, max_length=20000, description="Message text content")

    @field_validator("content")
    @classmethod
    def validate_content_not_empty(cls, v: str) -> str:
        stripped = v.strip()
        if not stripped:
            raise ValueError("Message content cannot be blank or only whitespace.")
        return stripped


class ChatRequest(BaseModel):
    # Flexible message input: supports both single `message` and OpenAI-style `messages` array
    message: Optional[str] = Field(default=None, max_length=12000, description="Current user prompt")
    history: List[ChatHistoryItem] = Field(
        default_factory=list,
        max_length=100,
        description="Prior conversation turns for multi-turn context",
    )
    messages: Optional[List[ChatHistoryItem]] = Field(
        default=None,
        description="Alternative list of messages (compatible with standard chat APIs)",
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
        """Support both {message, history} and {messages: [...]} formats seamlessly."""
        if not self.message and self.messages:
            # Extract last user message as prompt, and preceding messages as history
            user_msgs = [m for m in self.messages if m.role == "user"]
            if user_msgs:
                self.message = user_msgs[-1].content
                # Put all preceding messages into history
                last_idx = len(self.messages) - 1 - list(reversed(self.messages)).index(user_msgs[-1])
                self.history = self.messages[:last_idx]
            else:
                self.message = self.messages[-1].content
                self.history = self.messages[:-1]

        if not self.message or not self.message.strip():
            raise ValueError("A valid, non-empty user message must be provided.")

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
    """
    Resolve the model tag to use.
    If explicitly provided in request or .env, use it.
    If .env was blank, try querying Ollama's available models and pick the best match.
    """
    candidate = (requested_model or OLLAMA_MODEL or "").strip()
    if candidate:
        return candidate

    # Try auto-detecting available model from Ollama
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            resp = await client.get(f"{OLLAMA_BASE_URL}/api/tags")
            if resp.status_code == 200:
                tags_data = resp.json()
                models = tags_data.get("models", [])
                if models:
                    # Prefer any model with gemma in the name
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
) -> List[dict]:
    """Assemble the conversation messages payload for Ollama /api/chat."""
    messages = []

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

    if request.message:
        messages.append({
            "role": "user",
            "content": request.message,
        })

    return messages


# ------------------------------------------------------------------------------
# 5. API Endpoints
# ------------------------------------------------------------------------------

@app.get("/api/health", response_model=HealthResponse, tags=["Health"])
async def check_health():
    """
    Check whether Ollama is reachable and operating.
    Returns:
        { "status": "online", "ollama": True } if Ollama is accessible.
        503 Service Unavailable with offline status if Ollama is unreachable.
    """
    ollama_tags_url = f"{OLLAMA_BASE_URL}/api/tags"
    logger.info("Health check: probing Ollama at %s", ollama_tags_url)

    try:
        async with httpx.AsyncClient(timeout=4.0) as client:
            resp = await client.get(ollama_tags_url)
            if resp.status_code == 200:
                logger.info("Health check passed: Ollama is online")
                return HealthResponse(
                    status="online",
                    ollama=True,
                    model=OLLAMA_MODEL,
                )
            else:
                logger.warning("Ollama responded with status %d", resp.status_code)
                return JSONResponse(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    content={
                        "status": "offline",
                        "ollama": False,
                        "detail": f"Ollama service returned unexpected HTTP status {resp.status_code}",
                        "model": OLLAMA_MODEL,
                    },
                )
    except httpx.ConnectError:
        logger.warning("Cannot connect to Ollama at %s (Connection Refused)", OLLAMA_BASE_URL)
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content={
                "status": "offline",
                "ollama": False,
                "detail": f"Cannot connect to Ollama at {OLLAMA_BASE_URL}. Ensure Ollama is running ('ollama serve').",
                "model": OLLAMA_MODEL,
            },
        )
    except httpx.TimeoutException:
        logger.warning("Timeout while connecting to Ollama at %s", OLLAMA_BASE_URL)
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content={
                "status": "offline",
                "ollama": False,
                "detail": f"Connection to Ollama at {OLLAMA_BASE_URL} timed out.",
                "model": OLLAMA_MODEL,
            },
        )
    except Exception as exc:
        logger.error("Unexpected error checking Ollama health: %s", exc)
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content={
                "status": "offline",
                "ollama": False,
                "detail": f"Error connecting to Ollama: {str(exc)}",
                "model": OLLAMA_MODEL,
            },
        )


@app.get("/api/model", response_model=ModelResponse, tags=["Configuration"])
async def get_configured_model():
    """
    Return the configured model name from environment variables.
    """
    model_name = await resolve_effective_model(None)
    return ModelResponse(
        model=model_name,
        configured=bool(model_name),
        status="configured",
    )


@app.post("/api/chat", tags=["Chat"])
async def chat_completion(request: ChatRequest, req: Request):
    """
    Accept user message and conversation history, validate inputs,
    and forward the conversation to local Ollama.
    Supports both non-streaming JSON and SSE streaming (if requested by client).
    """
    # If client explicitly asks for streaming via stream=True or text/event-stream header, route to stream
    accept_header = req.headers.get("accept", "")
    wants_streaming = (request.stream is True) or ("text/event-stream" in accept_header)

    if wants_streaming:
        return await chat_stream_completion(request)

    model = await resolve_effective_model(request.model)
    system_prompt = request.system_prompt if request.system_prompt is not None else SYSTEM_PROMPT
    ollama_messages = build_ollama_messages(request, system_prompt)

    ollama_chat_url = f"{OLLAMA_BASE_URL}/api/chat"
    payload = {
        "model": model,
        "messages": ollama_messages,
        "stream": False,
    }

    logger.info("Sending chat request to Ollama [model=%s, turns=%d]", model, len(ollama_messages))

    try:
        async with httpx.AsyncClient(timeout=OLLAMA_TIMEOUT_SECONDS) as client:
            resp = await client.post(ollama_chat_url, json=payload)

            if resp.status_code == 200:
                data = resp.json()
                reply_text = data.get("message", {}).get("content", "")
                if not reply_text:
                    logger.warning("Ollama returned 200 OK with empty message content")
                return {
                    "reply": reply_text,
                    "response": reply_text,
                    "message": {"role": "assistant", "content": reply_text},
                    "model": model,
                }

            elif resp.status_code == 404:
                logger.error("Model '%s' not found on Ollama server", model)
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Model '{model}' was not found in Ollama. Run 'ollama pull {model}' to download it.",
                )
            else:
                err_body = resp.text
                logger.error("Ollama returned HTTP %d: %s", resp.status_code, err_body)
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail=f"Ollama server returned error {resp.status_code}: {err_body}",
                )

    except httpx.ConnectError:
        logger.error("Failed to connect to Ollama at %s", OLLAMA_BASE_URL)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Failed to connect to local Ollama instance at {OLLAMA_BASE_URL}. Ensure Ollama is running ('ollama serve').",
        )
    except httpx.TimeoutException:
        logger.error("Request to Ollama timed out after %s seconds", OLLAMA_TIMEOUT_SECONDS)
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail=f"Ollama request timed out after {OLLAMA_TIMEOUT_SECONDS}s while waiting for generation.",
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Unexpected error in chat_completion: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Internal server error: {str(exc)}",
        )


@app.post("/api/chat/stream", tags=["Chat"])
async def chat_stream_completion(request: ChatRequest):
    """
    Stream token responses progressively from local Ollama via Server-Sent Events (SSE).
    Returns a StreamingResponse sending chunks with `reply`, `response`, and `delta` aliases.
    """
    model = await resolve_effective_model(request.model)
    system_prompt = request.system_prompt if request.system_prompt is not None else SYSTEM_PROMPT
    ollama_messages = build_ollama_messages(request, system_prompt)

    ollama_chat_url = f"{OLLAMA_BASE_URL}/api/chat"
    payload = {
        "model": model,
        "messages": ollama_messages,
        "stream": True,
    }

    logger.info("Opening streaming chat request to Ollama [model=%s, turns=%d]", model, len(ollama_messages))

    async def event_generator() -> AsyncGenerator[str, None]:
        try:
            async with httpx.AsyncClient(timeout=OLLAMA_TIMEOUT_SECONDS) as client:
                async with client.stream("POST", ollama_chat_url, json=payload) as response:
                    if response.status_code == 404:
                        error_payload = {
                            "error": f"Model '{model}' not found in Ollama. Run 'ollama pull {model}' to download it."
                        }
                        yield f"data: {json.dumps(error_payload)}\n\n"
                        yield "data: [DONE]\n\n"
                        return

                    if response.status_code != 200:
                        error_payload = {
                            "error": f"Ollama returned HTTP error {response.status_code}"
                        }
                        yield f"data: {json.dumps(error_payload)}\n\n"
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

        except httpx.ConnectError:
            logger.error("Stream connection failed: cannot connect to Ollama at %s", OLLAMA_BASE_URL)
            err_msg = {
                "error": f"Failed to connect to local Ollama instance at {OLLAMA_BASE_URL}. Ensure Ollama is running ('ollama serve')."
            }
            yield f"data: {json.dumps(err_msg)}\n\n"
            yield "data: [DONE]\n\n"
        except httpx.TimeoutException:
            logger.error("Stream timed out waiting for Ollama tokens")
            err_msg = {"error": f"Generation timed out after {OLLAMA_TIMEOUT_SECONDS}s."}
            yield f"data: {json.dumps(err_msg)}\n\n"
            yield "data: [DONE]\n\n"
        except Exception as exc:
            logger.error("Stream error: %s", exc)
            err_msg = {"error": f"Streaming error: {str(exc)}"}
            yield f"data: {json.dumps(err_msg)}\n\n"
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


# ------------------------------------------------------------------------------
# 6. Global Exception Handlers
# ------------------------------------------------------------------------------
@app.exception_handler(HTTPException)
async def custom_http_exception_handler(request: Request, exc: HTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail},
    )


if __name__ == "__main__":
    import uvicorn

    host = os.getenv("HOST", "127.0.0.1")
    port = int(os.getenv("PORT", "8000"))
    logger.info("Starting Uvicorn server on %s:%d", host, port)
    uvicorn.run("backend.main:app", host=host, port=port, reload=True)
