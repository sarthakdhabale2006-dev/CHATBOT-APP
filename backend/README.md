# Local AI Chat - Backend (FastAPI + Ollama)

FastAPI backend for **Local AI Chat**, providing local inference connectivity to Ollama running **Gemma 4 12B QAT**.

---

## 🏛️ Architecture

```
┌─────────────────────────────────┐
│     Local AI Chat Frontend      │ (Port 5500 / 3000)
└────────────────┬────────────────┘
                 │ HTTP / SSE
                 ▼
┌─────────────────────────────────┐
│       FastAPI Backend           │ (127.0.0.1:8000)
│  - Input validation (Pydantic)  │
│  - System prompt management     │
│  - Multi-turn conversation      │
│  - StreamingResponse (SSE)      │
│  - CORS & Timeout handling      │
└────────────────┬────────────────┘
                 │ HTTP API
                 ▼
┌─────────────────────────────────┐
│         Ollama Server           │ (127.0.0.1:11434)
└────────────────┬────────────────┘
                 │ Local Inference
                 ▼
┌─────────────────────────────────┐
│       Gemma 4 12B QAT           │ (Local Weights)
└─────────────────────────────────┘
```

---

## 📋 Prerequisites

1. **Python 3.10+**
2. **Ollama installed and running locally**:
   - Download & install from: [ollama.com](https://ollama.com)
   - Ensure Ollama is active (`ollama serve` or background service)

---

## 🚀 Setup & Installation

### 1. Create a Python Virtual Environment

Open a terminal in the project directory:

```bash
# Navigate to backend directory
cd backend

# Create a virtual environment
python3 -m venv venv

# Activate the virtual environment
# On Linux / macOS:
source venv/bin/activate

# On Windows (cmd.exe):
# venv\Scripts\activate.bat

# On Windows (PowerShell):
# .\venv\Scripts\Activate.ps1
```

### 2. Install Dependencies

```bash
pip install --upgrade pip
pip install -r requirements.txt
```

---

## ⚙️ Ollama & Model Configuration

### 1. Check your installed Ollama models

Run in your terminal:

```bash
ollama list
```

Example output:
```
NAME               ID           SIZE      MODIFIED
gemma2:9b          c179261a0b38 5.4 GB    2 days ago
gemma-4-12b-qat    e281b37b4e91 7.4 GB    1 hour ago
```

### 2. Configure `.env`

Edit `backend/.env`:

```env
# Ollama local inference endpoint
OLLAMA_BASE_URL=http://127.0.0.1:11434

# Set your exact model tag from `ollama list`
OLLAMA_MODEL=gemma-4-12b-qat

# System prompt configured for the local model
SYSTEM_PROMPT=You are a helpful, accurate and concise AI assistant. Explain technical concepts clearly. When writing code, provide complete executable examples. If uncertain, say so instead of inventing information.

# Allowed CORS origins (comma-separated)
CORS_ORIGINS=http://localhost:5500,http://127.0.0.1:5500,http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173,http://127.0.0.1:5173

# Timeout for Ollama requests in seconds
OLLAMA_TIMEOUT_SECONDS=120.0
```

> **Note**: Do not leave `OLLAMA_MODEL` blank. Set it to the exact tag shown by `ollama list`.

---

## ▶️ Start the Backend Server

From the project root:

```bash
uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```

Or from inside the `backend` directory:

```bash
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

When started, you should see:
```
INFO:     Started server process
INFO:     Waiting for application startup.
INFO:     Application startup complete.
INFO:     Uvicorn running on http://127.0.0.1:8000 (Press CTRL+C to quit)
```

---

## 🔍 Interactive API Documentation

Interactive Swagger API docs are available at:

* **Swagger UI**: [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)
* **ReDoc**: [http://127.0.0.1:8000/redoc](http://127.0.0.1:8000/redoc)

---

## 🧪 Testing the Endpoints

### 1. Test Health (`GET /api/health`)

Checks if Ollama is running at `OLLAMA_BASE_URL`:

```bash
curl http://127.0.0.1:8000/api/health
```

Expected response when Ollama is running:
```json
{
  "status": "online",
  "ollama": true
}
```

If Ollama is stopped:
```json
{
  "status": "offline",
  "ollama": false,
  "detail": "Cannot connect to Ollama at http://127.0.0.1:11434. Is 'ollama serve' running?"
}
```

---

### 2. Test Configured Model (`GET /api/model`)

Returns the model tag configured in `.env`:

```bash
curl http://127.0.0.1:8000/api/model
```

Expected response:
```json
{
  "model": "gemma-4-12b-qat",
  "configured": true,
  "status": "configured"
}
```

---

### 3. Test Chat Completion (`POST /api/chat`)

Sends a prompt and conversation history to Ollama:

```bash
curl -X POST http://127.0.0.1:8000/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Explain how Quantization-Aware Training works in 2 sentences.",
    "history": []
  }'
```

Expected response:
```json
{
  "reply": "Quantization-Aware Training (QAT) simulates low-precision rounding errors during the training process. This allows the model weights to adapt to quantization noise, maintaining high accuracy when converted to 4-bit integer weights."
}
```

---

### 4. Test Streaming Chat (`POST /api/chat/stream`)

Streams Server-Sent Events (SSE) progressively:

```bash
curl -N -X POST http://127.0.0.1:8000/api/chat/stream \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Count from 1 to 5.",
    "history": []
  }'
```

Expected SSE stream output:
```
data: {"reply": "1", "done": false}

data: {"reply": ", 2", "done": false}

data: {"reply": ", 3", "done": false}

data: {"reply": ", 4", "done": false}

data: {"reply": ", 5", "done": true}

data: [DONE]
```

---

## 🔒 Security & Validation Details

* **Input Validation**: `message` must be 1 to 8,000 characters and cannot be blank whitespace.
* **History Limit**: Maximum 50 conversation turns with 12,000 character limit per turn.
* **Timeout Protection**: Default 120-second timeout on local inference calls.
* **Error Sanitization**: Server-side error details are caught, logged, and returned with appropriate HTTP status codes (400, 404, 502, 503, 504) without leaking server environment secrets.
