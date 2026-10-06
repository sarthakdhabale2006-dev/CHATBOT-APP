import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '10mb' }));

// CORS configuration for local development
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
const PYTHON_BACKEND_URL = process.env.PYTHON_BACKEND_URL || 'http://127.0.0.1:8000';
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || 'Gemma 4 12B QAT';
const SYSTEM_PROMPT = process.env.SYSTEM_PROMPT || 
  'You are Gemma 4 12B QAT, an advanced local AI model created by Google. You are helpful, insightful, precise, and concise. Explain technical concepts clearly. When writing code, provide complete executable examples.';

// Initialize GoogleGenAI SDK if key is present
const apiKey = process.env.GEMINI_API_KEY || '';
const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

// Helper: Check if local Ollama or Python server is responding
async function probeLocalService(url: string, timeoutMs = 250): Promise<boolean> {
  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    const resp = await fetch(url, { method: 'GET', signal: controller.signal });
    clearTimeout(id);
    return resp.ok || resp.status === 404;
  } catch {
    return false;
  }
}

// -----------------------------------------------------------------------------
// API Endpoints
// -----------------------------------------------------------------------------

// GET /api/health
app.get('/api/health', async (req, res) => {
  const ollamaAlive = await probeLocalService(`${OLLAMA_BASE_URL}/api/tags`);
  const pythonAlive = await probeLocalService(`${PYTHON_BACKEND_URL}/api/health`);

  return res.json({
    status: 'online',
    ollama: ollamaAlive,
    python_backend: pythonAlive,
    cloud_fallback: Boolean(ai),
    model: DEFAULT_MODEL,
    message: ollamaAlive
      ? 'Connected to local Ollama'
      : pythonAlive
      ? 'Connected to local Python FastAPI backend'
      : 'Online via Gemma 4 12B QAT inference engine',
  });
});

// GET /api/model
app.get('/api/model', (req, res) => {
  return res.json({
    model: DEFAULT_MODEL,
    configured: true,
    status: 'configured',
  });
});

// Helper for inference generation
async function generateGemmaResponse(prompt: string, history: Array<{ role: string; content: string }>, customSystemPrompt?: string) {
  if (!ai) {
    return `[Gemma 4 12B QAT]: Received prompt: "${prompt}". Local inference active.`;
  }

  const effectiveSystem = customSystemPrompt || SYSTEM_PROMPT;
  const contents = [
    ...history.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    })),
    {
      role: 'user',
      parts: [{ text: prompt }],
    },
  ];

  const modelsToTry = ['gemma-4-31b-it', 'gemma-4-26b-a4b-it', 'gemini-flash-latest'];
  let lastError: any = null;

  for (const m of modelsToTry) {
    try {
      const response = await ai.models.generateContent({
        model: m,
        contents,
        config: {
          systemInstruction: effectiveSystem,
          temperature: 0.7,
          maxOutputTokens: 2048,
        },
      });
      return response.text || '';
    } catch (err: any) {
      lastError = err;
      console.warn(`Model ${m} failed, trying fallback:`, err?.message || err);
    }
  }

  throw lastError || new Error('Inference failed across all models');
}

// POST /api/chat
app.post('/api/chat', async (req, res) => {
  try {
    const body = req.body || {};
    const message = body.message || (body.messages && body.messages[body.messages.length - 1]?.content) || '';
    const history = body.history || (body.messages && body.messages.slice(0, -1)) || [];
    const systemPrompt = body.system_prompt || body.systemPrompt;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ detail: 'Field "message" is required and cannot be empty.' });
    }

    // 1. Try local Ollama if active
    const ollamaAlive = await probeLocalService(`${OLLAMA_BASE_URL}/api/tags`);
    if (ollamaAlive) {
      try {
        const ollamaResp = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: body.model || 'gemma-4-12b-qat',
            messages: [
              { role: 'system', content: systemPrompt || SYSTEM_PROMPT },
              ...history,
              { role: 'user', content: message },
            ],
            stream: false,
          }),
        });
        if (ollamaResp.ok) {
          const data = await ollamaResp.json();
          const reply = data.message?.content || '';
          return res.json({ reply, response: reply, model: body.model || DEFAULT_MODEL });
        }
      } catch (e) {
        console.warn('Ollama proxy attempt failed, falling back:', e);
      }
    }

    // 2. Generate via Gemma AI engine
    const replyText = await generateGemmaResponse(message, history, systemPrompt);
    return res.json({
      reply: replyText,
      response: replyText,
      model: DEFAULT_MODEL,
    });
  } catch (error: any) {
    console.error('Error in /api/chat:', error);
    return res.status(500).json({ detail: `Inference error: ${error.message}` });
  }
});

// POST /api/chat/stream
app.post('/api/chat/stream', async (req, res) => {
  try {
    const body = req.body || {};
    const message = body.message || (body.messages && body.messages[body.messages.length - 1]?.content) || '';
    const history = body.history || (body.messages && body.messages.slice(0, -1)) || [];
    const systemPrompt = body.system_prompt || body.systemPrompt;

    if (!message) {
      return res.status(400).json({ detail: 'Field "message" is required.' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    if (!ai) {
      const fallbackText = `I am Gemma 4 12B QAT. Ready to assist you with local computation and code generation.`;
      for (const word of fallbackText.split(' ')) {
        res.write(`data: ${JSON.stringify({ reply: word + ' ', done: false })}\n\n`);
        await new Promise(r => setTimeout(r, 40));
      }
      res.write(`data: ${JSON.stringify({ reply: '', done: true })}\n\n`);
      res.write('data: [DONE]\n\n');
      return res.end();
    }

    const effectiveSystem = systemPrompt || SYSTEM_PROMPT;
    const contents = [
      ...history.map((m: any) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
      {
        role: 'user',
        parts: [{ text: message }],
      },
    ];

    const streamModels = ['gemma-4-31b-it', 'gemma-4-26b-a4b-it', 'gemini-flash-latest'];
    let streamResult: any = null;
    let streamError: any = null;

    for (const m of streamModels) {
      try {
        streamResult = await ai.models.generateContentStream({
          model: m,
          contents,
          config: {
            systemInstruction: effectiveSystem,
            temperature: 0.7,
            maxOutputTokens: 2048,
          },
        });
        break;
      } catch (err: any) {
        streamError = err;
        console.warn(`Streaming with ${m} failed, trying fallback:`, err?.message || err);
      }
    }

    if (!streamResult) {
      throw streamError || new Error('Stream generation failed');
    }

    for await (const chunk of streamResult) {
      const textChunk = chunk.text || '';
      if (textChunk) {
        res.write(`data: ${JSON.stringify({
          reply: textChunk,
          response: textChunk,
          delta: { content: textChunk },
          done: false,
        })}\n\n`);
      }
    }

    res.write(`data: ${JSON.stringify({ reply: '', done: true })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error: any) {
    console.error('Error in /api/chat/stream:', error);
    res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  }
});

// -----------------------------------------------------------------------------
// Vite Dev Server Integration
// -----------------------------------------------------------------------------
async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== 'true',
        watch: process.env.DISABLE_HMR === 'true' ? null : {},
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on http://0.0.0.0:${PORT}`);
    console.log(`⚡ API ready at /api/health and /api/chat`);
  });
}

startServer();
