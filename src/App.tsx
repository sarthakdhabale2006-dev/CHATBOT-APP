/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  MessageSquare,
  Plus,
  Search,
  X,
  Settings as SettingsIcon,
  Sun,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Trash2,
  Edit3,
  Copy,
  Check,
  Square,
  Send,
  Zap,
  AlertCircle,
  Activity,
  Download,
  Menu,
  ChevronDown,
  RotateCcw,
  Sparkles,
  ExternalLink
} from 'lucide-react';

// --- Interfaces & Types ---
interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  isStreaming?: boolean;
  error?: string | null;
}

interface Chat {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: Message[];
}

interface AppSettings {
  modelName: string;
  backendUrl: string;
  systemPrompt: string;
  streaming: boolean;
  temperature: number;
  maxTokens: number;
  theme: 'dark' | 'light' | 'system';
}

const DEFAULT_SETTINGS: AppSettings = {
  modelName: 'Gemma 4 12B QAT',
  backendUrl: '/api/chat',
  systemPrompt: 'You are Gemma 4 12B QAT, an advanced local AI model built by Google. You are helpful, insightful, precise, and concise.',
  streaming: true,
  temperature: 0.7,
  maxTokens: 2048,
  theme: 'dark',
};

const STORAGE_KEY_CHATS = 'local_ai_chats';
const STORAGE_KEY_ACTIVE = 'local_ai_active_chat_id';
const STORAGE_KEY_SETTINGS = 'local_ai_settings';

// Helper to generate IDs
const generateId = () => 'chat_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 7);

// --- Code Block Component with Copy functionality ---
const CodeBlock: React.FC<{ code: string; language: string }> = ({ code, language }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="my-3.5 rounded-lg border border-slate-700/60 bg-slate-950 overflow-hidden shadow-sm text-xs font-mono">
      <div className="flex items-center justify-between px-3.5 py-1.5 bg-slate-900/80 border-b border-slate-800 text-slate-400">
        <span className="uppercase tracking-wider text-[11px] font-semibold text-slate-400">
          {language || 'code'}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
          aria-label="Copy code to clipboard"
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-emerald-400">Copied!</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <pre className="p-3.5 overflow-x-auto text-slate-200 leading-relaxed font-mono selection:bg-blue-600/30">
        <code>{code}</code>
      </pre>
    </div>
  );
};

// --- Formatted Message Renderer (Markdown-like parser) ---
const FormattedMessage: React.FC<{ content: string; isStreaming?: boolean }> = ({ content, isStreaming }) => {
  const blocks = useMemo(() => {
    if (!content) return [];

    const result: Array<{ type: 'text' | 'code'; text: string; lang?: string }> = [];
    const codeBlockRegex = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
    let lastIndex = 0;
    let match;

    while ((match = codeBlockRegex.exec(content)) !== null) {
      if (match.index > lastIndex) {
        result.push({
          type: 'text',
          text: content.slice(lastIndex, match.index),
        });
      }
      result.push({
        type: 'code',
        lang: match[1] || 'code',
        text: match[2].replace(/\n$/, ''),
      });
      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < content.length) {
      result.push({
        type: 'text',
        text: content.slice(lastIndex),
      });
    }

    return result;
  }, [content]);

  // Helper for paragraphs, lists, bold, inline code in text segments
  const renderTextSegment = (text: string) => {
    const lines = text.split('\n');
    return lines.map((line, idx) => {
      // Empty line spacer
      if (!line.trim()) {
        return <div key={idx} className="h-2" />;
      }

      // Headers
      if (line.startsWith('### ')) {
        return <h3 key={idx} className="text-base font-semibold text-slate-100 dark:text-slate-100 light:text-slate-900 mt-3 mb-1.5">{line.replace('### ', '')}</h3>;
      }
      if (line.startsWith('## ')) {
        return <h2 key={idx} className="text-lg font-semibold text-slate-100 dark:text-slate-100 light:text-slate-900 mt-3.5 mb-2">{line.replace('## ', '')}</h2>;
      }
      if (line.startsWith('# ')) {
        return <h1 key={idx} className="text-xl font-bold text-slate-100 dark:text-slate-100 light:text-slate-900 mt-4 mb-2">{line.replace('# ', '')}</h1>;
      }

      // Bullet points
      const bulletMatch = line.match(/^(\s*)[-*+]\s+(.*)$/);
      if (bulletMatch) {
        return (
          <li key={idx} className="ml-5 list-disc my-0.5 text-slate-200 dark:text-slate-200 light:text-slate-800">
            {formatInlineText(bulletMatch[2])}
          </li>
        );
      }

      // Numbered list
      const numMatch = line.match(/^(\s*)\d+\.\s+(.*)$/);
      if (numMatch) {
        return (
          <li key={idx} className="ml-5 list-decimal my-0.5 text-slate-200 dark:text-slate-200 light:text-slate-800">
            {formatInlineText(numMatch[2])}
          </li>
        );
      }

      // Blockquote
      if (line.startsWith('> ')) {
        return (
          <blockquote key={idx} className="border-l-3 border-blue-500/60 pl-3.5 my-2 italic text-slate-400">
            {formatInlineText(line.replace('> ', ''))}
          </blockquote>
        );
      }

      // Normal paragraph
      return (
        <p key={idx} className="my-1 text-slate-200 dark:text-slate-200 light:text-slate-800 leading-relaxed">
          {formatInlineText(line)}
        </p>
      );
    });
  };

  const formatInlineText = (str: string) => {
    // Process inline `code`
    const parts = str.split(/(`[^`]+`)/g);
    return parts.map((part, i) => {
      if (part.startsWith('`') && part.endsWith('`')) {
        return (
          <code key={i} className="px-1.5 py-0.5 mx-0.5 rounded bg-slate-800 text-blue-400 border border-slate-700/60 font-mono text-[13px]">
            {part.slice(1, -1)}
          </code>
        );
      }
      // Process bold **text**
      const boldParts = part.split(/(\*\*[^*]+\*\*)/g);
      return boldParts.map((bPart, bIdx) => {
        if (bPart.startsWith('**') && bPart.endsWith('**')) {
          return <strong key={bIdx} className="font-semibold text-slate-100">{bPart.slice(2, -2)}</strong>;
        }
        return bPart;
      });
    });
  };

  return (
    <div className="space-y-1">
      {blocks.map((block, idx) => {
        if (block.type === 'code') {
          return <CodeBlock key={idx} code={block.text} language={block.lang || 'code'} />;
        }
        return <div key={idx}>{renderTextSegment(block.text)}</div>;
      })}
      {isStreaming && (
        <span className="inline-block w-2 h-4 bg-blue-500 ml-1 translate-y-0.5 animate-blink" aria-hidden="true" />
      )}
    </div>
  );
};

// --- Main App Component ---
export default function App() {
  // Settings & Theme State
  const [settings, setSettings] = useState<AppSettings>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_SETTINGS);
      if (saved) {
        const parsed = JSON.parse(saved);
        // If loaded in a remote browser environment (HTTPS), prioritize /api/chat over blocked http://127.0.0.1
        if (typeof window !== 'undefined' && window.location.protocol === 'https:' && parsed.backendUrl?.includes('127.0.0.1')) {
          parsed.backendUrl = '/api/chat';
        }
        return { ...DEFAULT_SETTINGS, ...parsed };
      }
      return DEFAULT_SETTINGS;
    } catch {
      return DEFAULT_SETTINGS;
    }
  });

  // Chats State
  const [chats, setChats] = useState<Chat[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_CHATS);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) {
      console.error(e);
    }
    const initial: Chat = {
      id: generateId(),
      title: 'New Conversation',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [],
    };
    return [initial];
  });

  const [activeChatId, setActiveChatId] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_ACTIVE);
      if (saved) return saved;
    } catch {}
    return chats[0]?.id || '';
  });

  // UI Interactive States
  const [inputPrompt, setInputPrompt] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [backendStatus, setBackendStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [showScrollBottom, setShowScrollBottom] = useState(false);

  // Modals
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isConnectionModalOpen, setIsConnectionModalOpen] = useState(false);
  const [renameModal, setRenameModal] = useState<{ open: boolean; chatId: string; title: string }>({
    open: false,
    chatId: '',
    title: '',
  });
  const [confirmModal, setConfirmModal] = useState<{ open: boolean; title: string; desc: string; onConfirm: () => void }>({
    open: false,
    title: '',
    desc: '',
    onConfirm: () => {},
  });

  // Toast feedback
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Connection probe test feedback state
  const [testResult, setTestResult] = useState<{ text: string; success?: boolean } | null>(null);
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);

  // Refs
  const abortControllerRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  // Trigger toast
  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(current => (current === msg ? null : current));
    }, 3000);
  }, []);

  // Save state to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(settings));
    } catch (e) {
      console.error(e);
    }
  }, [settings]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_CHATS, JSON.stringify(chats));
    } catch (e) {
      console.error(e);
    }
  }, [chats]);

  useEffect(() => {
    try {
      if (activeChatId) localStorage.setItem(STORAGE_KEY_ACTIVE, activeChatId);
    } catch (e) {}
  }, [activeChatId]);

  // Apply Theme
  useEffect(() => {
    let effective = settings.theme;
    if (effective === 'system') {
      effective = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    if (effective === 'dark') {
      document.documentElement.classList.add('dark');
      document.documentElement.setAttribute('data-theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      document.documentElement.setAttribute('data-theme', 'light');
    }
  }, [settings.theme]);

  // Get active chat object
  const activeChat = useMemo(() => {
    return chats.find(c => c.id === activeChatId) || chats[0];
  }, [chats, activeChatId]);

  // Auto scroll to bottom
  const scrollToBottom = useCallback((smooth = true) => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto' });
    }
  }, []);

  // Scroll event detector for "Scroll to bottom" floater
  const handleScroll = () => {
    if (!viewportRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = viewportRef.current;
    const isUp = scrollHeight - scrollTop - clientHeight > 160;
    setShowScrollBottom(isUp);
  };

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [inputPrompt]);

  // --- Backend Communication Module ---
  /**
   * Core API function communicating with local AI backend at http://127.0.0.1:8000/api/chat
   */
  const sendMessageToBackend = useCallback(
    async (
      chatId: string,
      historyMessages: Message[],
      onChunk: (chunk: string, full: string) => void,
      onComplete: (fullText: string) => void,
      onError: (errMsg: string) => void
    ) => {
      const controller = new AbortController();
      abortControllerRef.current = controller;
      setBackendStatus('connecting');

      // Format payload supporting both {message, history} and {messages}
      const lastUserMsg = historyMessages.filter(m => m.role === 'user').pop();
      const promptText = lastUserMsg ? lastUserMsg.content : '';
      const priorHistory = historyMessages.slice(0, -1).map(m => ({ role: m.role, content: m.content }));

      const payload = {
        message: promptText,
        history: priorHistory,
        messages: [
          ...(settings.systemPrompt ? [{ role: 'system', content: settings.systemPrompt }] : []),
          ...historyMessages.map(m => ({ role: m.role, content: m.content })),
        ],
        model: settings.modelName || 'gemma-4-12b-qat',
        stream: Boolean(settings.streaming),
        temperature: settings.temperature,
        max_tokens: settings.maxTokens,
        system_prompt: settings.systemPrompt,
      };

      try {
        const response = await fetch(settings.backendUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: settings.streaming ? 'text/event-stream, application/json' : 'application/json',
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        if (!response.ok) {
          const errText = await response.text().catch(() => '');
          throw new Error(`Server returned HTTP ${response.status}: ${errText || response.statusText}`);
        }

        setBackendStatus('connected');

        const contentType = response.headers.get('content-type') || '';
        const isSSE = contentType.includes('text/event-stream');

        if (isSSE && response.body) {
          const reader = response.body.getReader();
          const decoder = new TextDecoder('utf-8');
          let fullText = '';
          let buffer = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || trimmed.startsWith(':')) continue;

              if (trimmed.startsWith('data:')) {
                const dataStr = trimmed.slice(5).trim();
                if (dataStr === '[DONE]') break;

                try {
                  const parsed = JSON.parse(dataStr);
                  const delta =
                    parsed.reply ||
                    parsed.response ||
                    parsed.delta?.content ||
                    parsed.choices?.[0]?.delta?.content ||
                    parsed.message?.content ||
                    parsed.text ||
                    '';
                  if (delta) {
                    fullText += delta;
                    onChunk(delta, fullText);
                  }
                } catch {
                  fullText += dataStr;
                  onChunk(dataStr, fullText);
                }
              }
            }
          }

          onComplete(fullText);
        } else {
          const data = await response.json();
          const responseText =
            data.reply ||
            data.response ||
            data.choices?.[0]?.message?.content ||
            data.message?.content ||
            data.text ||
            '';
          onComplete(responseText);
        }
      } catch (err: any) {
        if (err.name === 'AbortError') {
          onComplete('(Generation stopped by user)');
        } else {
          setBackendStatus('disconnected');
          const errMsg = `Cannot reach local backend at ${settings.backendUrl}. Please ensure your Gemma 4 local inference server is running on 127.0.0.1:8000. Error: ${err.message}`;
          onError(errMsg);
        }
      } finally {
        abortControllerRef.current = null;
      }
    },
    [settings]
  );

  // Ping backend check
  const pingBackend = useCallback(async (customUrl?: string) => {
    const url = customUrl || settings.backendUrl;
    setBackendStatus('connecting');
    setTestResult({ text: 'Probing connection to local server...' });

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2500);

      const res = await fetch(url, { method: 'OPTIONS', signal: controller.signal }).catch(async () => {
        const parsed = new URL(url);
        return fetch(`${parsed.origin}/`, { method: 'GET', signal: controller.signal });
      });

      clearTimeout(timeout);

      if (res && (res.ok || res.status === 404 || res.status === 405 || res.status === 200)) {
        setBackendStatus('connected');
        setTestResult({ text: `Successfully connected to local backend (${url})`, success: true });
        return true;
      } else {
        setBackendStatus('disconnected');
        setTestResult({ text: `Server reachable but returned code ${res?.status || 'Unknown'}`, success: false });
        return false;
      }
    } catch (e: any) {
      setBackendStatus('disconnected');
      setTestResult({
        text: `No local server detected at ${url}. Start your local server (e.g. uvicorn, vLLM, or llama.cpp) on port 8000.`,
        success: false,
      });
      return false;
    }
  }, [settings.backendUrl]);

  // Check connection on load
  useEffect(() => {
    pingBackend();
  }, [pingBackend]);

  // Stop Generation
  const stopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setIsGenerating(false);
    showToast('Generation stopped');
  };

  // Send message
  const handleSendMessage = async (textToSend?: string) => {
    const prompt = (textToSend || inputPrompt).trim();
    if (!prompt || isGenerating) return;

    if (!activeChat) return;

    // Auto title if first message
    const isFirstMessage = activeChat.messages.length === 0;
    const updatedTitle = isFirstMessage ? prompt.slice(0, 32) + (prompt.length > 32 ? '...' : '') : activeChat.title;

    const userMessage: Message = {
      id: generateId(),
      role: 'user',
      content: prompt,
      timestamp: new Date().toISOString(),
    };

    const assistantMsgId = generateId();
    const assistantPlaceholder: Message = {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
      isStreaming: true,
      error: null,
    };

    const updatedMessages = [...activeChat.messages, userMessage, assistantPlaceholder];

    setChats(prev =>
      prev.map(c =>
        c.id === activeChat.id
          ? {
              ...c,
              title: updatedTitle,
              updatedAt: new Date().toISOString(),
              messages: updatedMessages,
            }
          : c
      )
    );

    setInputPrompt('');
    setIsGenerating(true);
    setTimeout(() => scrollToBottom(), 50);

    const historyForBackend = [...activeChat.messages, userMessage];

    await sendMessageToBackend(
      activeChat.id,
      historyForBackend,
      // onChunk
      (chunk, full) => {
        setChats(prev =>
          prev.map(c => {
            if (c.id !== activeChat.id) return c;
            return {
              ...c,
              messages: c.messages.map(m =>
                m.id === assistantMsgId ? { ...m, content: full, isStreaming: true } : m
              ),
            };
          })
        );
        scrollToBottom();
      },
      // onComplete
      fullText => {
        setIsGenerating(false);
        setChats(prev =>
          prev.map(c => {
            if (c.id !== activeChat.id) return c;
            return {
              ...c,
              messages: c.messages.map(m =>
                m.id === assistantMsgId ? { ...m, content: fullText, isStreaming: false } : m
              ),
            };
          })
        );
        scrollToBottom();
      },
      // onError
      errMsg => {
        setIsGenerating(false);
        setChats(prev =>
          prev.map(c => {
            if (c.id !== activeChat.id) return c;
            return {
              ...c,
              messages: c.messages.map(m =>
                m.id === assistantMsgId ? { ...m, isStreaming: false, error: errMsg } : m
              ),
            };
          })
        );
        showToast('Local backend error');
        scrollToBottom();
      }
    );
  };

  // Retry message
  const handleRetry = (msgId: string) => {
    if (!activeChat || isGenerating) return;
    const msgIdx = activeChat.messages.findIndex(m => m.id === msgId);
    if (msgIdx === -1) return;

    // Remove the failed message and re-send with previous user prompt
    const prevUserMsg = activeChat.messages[msgIdx - 1];
    if (prevUserMsg && prevUserMsg.role === 'user') {
      const remainingMessages = activeChat.messages.slice(0, msgIdx);
      setChats(prev =>
        prev.map(c => (c.id === activeChat.id ? { ...c, messages: remainingMessages } : c))
      );
      handleSendMessage(prevUserMsg.content);
    }
  };

  // Create New Chat
  const handleNewChat = () => {
    const newChat: Chat = {
      id: generateId(),
      title: 'New Conversation',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [],
    };
    setChats(prev => [newChat, ...prev]);
    setActiveChatId(newChat.id);
    setMobileSidebarOpen(false);
    if (textareaRef.current) textareaRef.current.focus();
  };

  // Delete Chat
  const handleDeleteChat = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const chatToDelete = chats.find(c => c.id === id);
    setConfirmModal({
      open: true,
      title: `Delete "${chatToDelete?.title || 'conversation'}"?`,
      desc: 'All messages in this conversation will be permanently removed.',
      onConfirm: () => {
        setChats(prev => {
          const next = prev.filter(c => c.id !== id);
          if (next.length === 0) {
            const fallback: Chat = {
              id: generateId(),
              title: 'New Conversation',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              messages: [],
            };
            setActiveChatId(fallback.id);
            return [fallback];
          }
          if (activeChatId === id) {
            setActiveChatId(next[0].id);
          }
          return next;
        });
        showToast('Conversation deleted');
      },
    });
  };

  // Clear current chat
  const handleClearCurrentChat = () => {
    if (!activeChat || activeChat.messages.length === 0) return;
    setConfirmModal({
      open: true,
      title: 'Clear conversation?',
      desc: 'Are you sure you want to clear all messages from this conversation?',
      onConfirm: () => {
        setChats(prev =>
          prev.map(c => (c.id === activeChat.id ? { ...c, messages: [] } : c))
        );
        showToast('Messages cleared');
      },
    });
  };

  // Clear all chats
  const handleClearAllChats = () => {
    setConfirmModal({
      open: true,
      title: 'Clear all conversations?',
      desc: 'This will delete your entire conversation history stored locally.',
      onConfirm: () => {
        const fresh: Chat = {
          id: generateId(),
          title: 'New Conversation',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          messages: [],
        };
        setChats([fresh]);
        setActiveChatId(fresh.id);
        setIsSettingsOpen(false);
        showToast('All conversations cleared');
      },
    });
  };

  // Export current chat as Markdown
  const handleExportMarkdown = () => {
    if (!activeChat || activeChat.messages.length === 0) {
      showToast('No messages to export');
      return;
    }
    let md = `# ${activeChat.title}\n`;
    md += `Model: ${settings.modelName}\n`;
    md += `Date: ${new Date(activeChat.createdAt).toLocaleString()}\n\n---\n\n`;

    activeChat.messages.forEach(m => {
      const roleName = m.role === 'user' ? 'User' : settings.modelName;
      md += `### ${roleName} (${new Date(m.timestamp).toLocaleTimeString()})\n\n${m.content}\n\n`;
    });

    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeChat.title.replace(/[^a-zA-Z0-9_-]/g, '_')}.md`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Exported conversation as Markdown');
  };

  // Export all as JSON
  const handleExportAllJSON = () => {
    const backup = {
      app: 'Local AI Chat',
      model: settings.modelName,
      exportedAt: new Date().toISOString(),
      settings,
      chats,
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'local_ai_chats_backup.json';
    a.click();
    URL.revokeObjectURL(url);
    showToast('Exported all conversations');
  };

  // Copy message text
  const handleCopyMessage = (msgId: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedMsgId(msgId);
    showToast('Copied to clipboard');
    setTimeout(() => setCopiedMsgId(null), 2000);
  };

  // Filtered Chats
  const filteredChats = useMemo(() => {
    if (!searchQuery.trim()) return chats;
    const q = searchQuery.toLowerCase();
    return chats.filter(
      c => c.title.toLowerCase().includes(q) || c.messages.some(m => m.content.toLowerCase().includes(q))
    );
  }, [chats, searchQuery]);

  // Keyboard Shortcuts (Ctrl+N, Ctrl+[, etc.)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        handleNewChat();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '[') {
        e.preventDefault();
        setSidebarCollapsed(prev => !prev);
      }
      if (e.key === 'Escape') {
        setIsSettingsOpen(false);
        setIsConnectionModalOpen(false);
        setRenameModal(prev => ({ ...prev, open: false }));
        setConfirmModal(prev => ({ ...prev, open: false }));
        setMobileSidebarOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-950 text-slate-100 font-sans selection:bg-blue-600/30">
      {/* Mobile Sidebar Backdrop Overlay */}
      {mobileSidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-xs md:hidden"
          onClick={() => setMobileSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* --- SIDEBAR --- */}
      <aside
        className={`fixed md:static inset-y-0 left-0 z-50 flex flex-col bg-slate-900 border-r border-slate-800 transition-all duration-200 ease-in-out ${
          sidebarCollapsed ? 'md:w-0 md:min-w-0 md:overflow-hidden md:border-r-0' : 'w-72 min-w-72'
        } ${mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}
        aria-label="Chat sidebar"
      >
        {/* Brand / Logo */}
        <div className="h-14 px-4 flex items-center justify-between border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-blue-600 to-cyan-500 flex items-center justify-center text-white shrink-0 shadow-sm">
              <Zap className="w-4 h-4 fill-current" />
            </div>
            <div className="min-w-0 flex flex-col">
              <h1 className="text-sm font-semibold tracking-tight text-white truncate">Local AI Chat</h1>
              <span className="text-[11px] font-mono text-slate-400 font-medium truncate">{settings.modelName}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setSidebarCollapsed(true)}
            className="hidden md:flex p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            title="Collapse sidebar (Ctrl+[)"
            aria-label="Collapse sidebar"
          >
            <PanelLeftClose className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setMobileSidebarOpen(false)}
            className="md:hidden p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-slate-800"
            aria-label="Close sidebar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* New Chat Button */}
        <div className="p-3 shrink-0">
          <button
            type="button"
            onClick={handleNewChat}
            className="w-full flex items-center justify-between px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs shadow-sm transition-all"
            aria-label="Start new conversation"
          >
            <div className="flex items-center gap-2">
              <Plus className="w-4 h-4" />
              <span>New Chat</span>
            </div>
            <kbd className="hidden sm:inline-block px-1.5 py-0.5 text-[10px] font-mono bg-blue-700/60 rounded text-blue-200">
              Ctrl+N
            </kbd>
          </button>
        </div>

        {/* Search Chats Input */}
        <div className="px-3 pb-2 shrink-0">
          <div className="relative flex items-center">
            <Search className="w-3.5 h-3.5 absolute left-2.5 text-slate-500 pointer-events-none" />
            <input
              type="text"
              placeholder="Search conversations..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full h-8 pl-8 pr-7 text-xs bg-slate-950/70 border border-slate-800 rounded-md text-slate-200 placeholder:text-slate-500 focus:outline-hidden focus:border-blue-500 transition-colors"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2 p-0.5 text-slate-500 hover:text-slate-300"
                aria-label="Clear search"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        {/* Chat History List */}
        <nav className="flex-1 overflow-y-auto px-2 space-y-1 py-1" aria-label="Conversation list">
          {filteredChats.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-500">
              No conversations found
            </div>
          ) : (
            filteredChats.map(c => {
              const isActive = c.id === activeChatId;
              return (
                <div
                  key={c.id}
                  onClick={() => {
                    setActiveChatId(c.id);
                    setMobileSidebarOpen(false);
                  }}
                  className={`group relative flex items-center justify-between px-2.5 py-2 rounded-lg text-xs cursor-pointer transition-colors ${
                    isActive
                      ? 'bg-slate-800 text-white font-medium shadow-xs border border-slate-700/60'
                      : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'
                  }`}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => {
                    if (e.key === 'Enter') setActiveChatId(c.id);
                  }}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <MessageSquare className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-blue-400' : 'text-slate-500'}`} />
                    <span className="truncate">{c.title}</span>
                  </div>

                  {/* Actions on hover */}
                  <div className={`flex items-center gap-0.5 shrink-0 ${isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-opacity`}>
                    <button
                      type="button"
                      onClick={e => {
                        e.stopPropagation();
                        setRenameModal({ open: true, chatId: c.id, title: c.title });
                      }}
                      className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-700"
                      title="Rename conversation"
                    >
                      <Edit3 className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={e => handleDeleteChat(c.id, e)}
                      className="p-1 rounded text-slate-400 hover:text-red-400 hover:bg-red-950/40"
                      title="Delete conversation"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </nav>

        {/* Sidebar Footer */}
        <div className="p-2.5 border-t border-slate-800 shrink-0 space-y-1">
          {/* Connection Status Button */}
          <button
            type="button"
            onClick={() => setIsConnectionModalOpen(true)}
            className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors"
          >
            <div className="flex items-center gap-2 truncate">
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${
                  backendStatus === 'connected'
                    ? 'bg-emerald-500 ring-2 ring-emerald-500/20'
                    : backendStatus === 'connecting'
                    ? 'bg-amber-500 animate-pulse'
                    : 'bg-red-500'
                }`}
              />
              <span className="truncate font-mono text-[11px]">127.0.0.1:8000</span>
            </div>
            <span className="text-[10px] text-slate-500 uppercase tracking-wider">
              {backendStatus === 'connected' ? 'Ready' : backendStatus === 'connecting' ? 'Pinging' : 'Offline'}
            </span>
          </button>

          {/* Settings Trigger */}
          <button
            type="button"
            onClick={() => setIsSettingsOpen(true)}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors"
          >
            <SettingsIcon className="w-3.5 h-3.5" />
            <span>Settings</span>
          </button>
        </div>
      </aside>

      {/* --- MAIN CHAT AREA --- */}
      <main className="flex-1 flex flex-col h-full min-w-0 bg-slate-950">
        {/* Top Header */}
        <header className="h-14 px-4 flex items-center justify-between border-b border-slate-800 bg-slate-900/50 backdrop-blur-sm shrink-0 z-20">
          <div className="flex items-center gap-3 min-w-0">
            {/* Mobile Menu Button */}
            <button
              type="button"
              onClick={() => setMobileSidebarOpen(true)}
              className="md:hidden p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-slate-800"
              aria-label="Open navigation sidebar"
            >
              <Menu className="w-4 h-4" />
            </button>

            {/* Desktop Expand Sidebar button */}
            {sidebarCollapsed && (
              <button
                type="button"
                onClick={() => setSidebarCollapsed(false)}
                className="hidden md:flex p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-slate-800"
                title="Expand sidebar (Ctrl+[)"
                aria-label="Expand sidebar"
              >
                <PanelLeftOpen className="w-4 h-4" />
              </button>
            )}

            {/* Active Chat Title & Model Subtitle */}
            <div className="min-w-0 flex flex-col">
              <div className="flex items-center gap-2">
                <h2
                  onClick={() => {
                    if (activeChat) setRenameModal({ open: true, chatId: activeChat.id, title: activeChat.title });
                  }}
                  className="text-sm font-semibold text-slate-100 truncate cursor-pointer hover:underline"
                  title="Click to rename"
                >
                  {activeChat?.title || 'New Conversation'}
                </h2>
                <button
                  type="button"
                  onClick={() => {
                    if (activeChat) setRenameModal({ open: true, chatId: activeChat.id, title: activeChat.title });
                  }}
                  className="text-slate-500 hover:text-slate-300 p-0.5 rounded"
                  aria-label="Rename conversation"
                >
                  <Edit3 className="w-3 h-3" />
                </button>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-slate-400">
                <span className="font-mono text-slate-400">{settings.modelName}</span>
                <span aria-hidden="true">·</span>
                <button
                  type="button"
                  onClick={() => setIsConnectionModalOpen(true)}
                  className="flex items-center gap-1.5 text-slate-400 hover:text-slate-200"
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      backendStatus === 'connected'
                        ? 'bg-emerald-500'
                        : backendStatus === 'connecting'
                        ? 'bg-amber-500'
                        : 'bg-red-500'
                    }`}
                  />
                  <span>{backendStatus === 'connected' ? 'Connected' : 'Offline Backend'}</span>
                </button>
              </div>
            </div>
          </div>

          {/* Header Right Actions */}
          <div className="flex items-center gap-1.5">
            {/* Theme Toggle */}
            <button
              type="button"
              onClick={() => {
                const next = settings.theme === 'dark' ? 'light' : 'dark';
                setSettings(s => ({ ...s, theme: next }));
              }}
              className="p-1.5 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
              title="Toggle theme"
              aria-label="Toggle theme"
            >
              {settings.theme === 'light' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
            </button>

            {/* Export Chat */}
            <button
              type="button"
              onClick={handleExportMarkdown}
              className="p-1.5 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
              title="Export as Markdown"
              aria-label="Export conversation"
            >
              <Download className="w-4 h-4" />
            </button>

            {/* Clear Chat */}
            <button
              type="button"
              onClick={handleClearCurrentChat}
              className="p-1.5 rounded-md text-slate-400 hover:text-red-400 hover:bg-slate-800 transition-colors"
              title="Clear messages in chat"
              aria-label="Clear chat messages"
            >
              <Trash2 className="w-4 h-4" />
            </button>

            {/* Settings */}
            <button
              type="button"
              onClick={() => setIsSettingsOpen(true)}
              className="p-1.5 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
              title="Settings"
              aria-label="Settings"
            >
              <SettingsIcon className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Scrollable Messages Viewport */}
        <section
          ref={viewportRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto px-4 py-6 scroll-smooth"
          aria-label="Conversation messages"
        >
          {/* Empty State Screen */}
          {(!activeChat?.messages || activeChat.messages.length === 0) && (
            <div className="max-w-2xl mx-auto py-12 px-2 flex flex-col items-center text-center">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-blue-600 to-cyan-500 flex items-center justify-center text-white mb-5 shadow-lg shadow-blue-500/20">
                <Zap className="w-7 h-7 fill-current" />
              </div>
              <h2 className="text-2xl font-bold tracking-tight text-white mb-2">Local AI Chat</h2>
              <p className="text-sm text-slate-400 mb-6 max-w-md">
                Fast, 100% offline local inference on <span className="font-mono text-blue-400 font-semibold">{settings.modelName}</span>.
                Your data remains entirely on this machine.
              </p>

              {/* Backend Status Callout */}
              <div className="w-full bg-slate-900 border border-slate-800 rounded-xl p-4 text-left mb-8 shadow-sm">
                <div className="flex items-center gap-2 mb-1.5">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      backendStatus === 'connected' ? 'bg-emerald-500' : 'bg-red-500'
                    }`}
                  />
                  <span className="text-xs font-semibold text-slate-200">
                    Backend Status: {backendStatus === 'connected' ? 'Ready' : 'Standby / Offline'}
                  </span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed mb-3">
                  Inference target configured at <code className="px-1.5 py-0.5 rounded bg-slate-950 font-mono text-blue-400 border border-slate-800">{settings.backendUrl}</code>.
                  {backendStatus !== 'connected' && ' When you run your local model server, responses will stream instantly.'}
                </p>
                <div className="flex flex-wrap gap-2">
                  {settings.backendUrl !== '/api/chat' && (
                    <button
                      type="button"
                      onClick={() => {
                        setSettings(s => ({ ...s, backendUrl: '/api/chat' }));
                        pingBackend('/api/chat');
                        showToast('Switched to Built-in Server');
                      }}
                      className="px-2.5 py-1 text-xs rounded bg-blue-600 hover:bg-blue-500 text-white font-medium transition-colors"
                    >
                      ⚡ Connect Built-in Server
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => pingBackend()}
                    className="px-2.5 py-1 text-xs rounded border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
                  >
                    Check Connection
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsSettingsOpen(true)}
                    className="px-2.5 py-1 text-xs rounded border border-slate-700 text-slate-300 hover:bg-slate-800 transition-colors"
                  >
                    Configure URL
                  </button>
                </div>
              </div>

              {/* Starter Prompt Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 w-full text-left">
                {[
                  {
                    cat: 'Architecture',
                    prompt: 'Explain how Quantization-Aware Training (QAT) preserves model accuracy at 4-bit precision.',
                  },
                  {
                    cat: 'Benchmark',
                    prompt: 'Write a Python script to benchmark token generation latency on local CPU and GPU.',
                  },
                  {
                    cat: 'Reasoning',
                    prompt: 'Compare Gemma 4 12B against Gemma 2 9B in reasoning capabilities and RAM requirements.',
                  },
                  {
                    cat: 'Integration',
                    prompt: 'Show how to stream SSE tokens from FastAPI into a modern web client.',
                  },
                ].map((item, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleSendMessage(item.prompt)}
                    className="p-3.5 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-700 hover:bg-slate-850 text-left transition-all group cursor-pointer"
                  >
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-blue-400 block mb-1">
                      {item.cat}
                    </span>
                    <p className="text-xs text-slate-300 leading-snug group-hover:text-white">
                      {item.prompt}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Messages Stream */}
          <div className="max-w-3xl mx-auto space-y-6">
            {activeChat?.messages.map(msg => {
              const isUser = msg.role === 'user';
              return (
                <div
                  key={msg.id}
                  className={`flex gap-3.5 ${isUser ? 'justify-end' : 'justify-start'}`}
                >
                  {!isUser && (
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-blue-600 to-cyan-500 flex items-center justify-center text-white shrink-0 shadow-sm mt-1">
                      <Zap className="w-4 h-4 fill-current" />
                    </div>
                  )}

                  <div className={`max-w-[85%] flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
                    {/* Message Sender & Timestamp Line */}
                    <div className="flex items-center gap-2 mb-1 text-[11px] text-slate-400">
                      <span className="font-semibold text-slate-300">
                        {isUser ? 'You' : settings.modelName}
                      </span>
                      <span>·</span>
                      <time>{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
                      {msg.isStreaming && <span className="text-blue-400 font-mono">streaming...</span>}
                    </div>

                    {/* Content Bubble */}
                    {isUser ? (
                      <div className="px-4 py-2.5 rounded-2xl rounded-tr-sm bg-blue-600 text-white text-sm leading-relaxed whitespace-pre-wrap shadow-xs">
                        {msg.content}
                      </div>
                    ) : (
                      <div className="w-full text-sm leading-relaxed text-slate-200">
                        <FormattedMessage content={msg.content} isStreaming={msg.isStreaming} />

                        {/* Error UI Card if request failed */}
                        {msg.error && (
                          <div className="mt-3 p-3.5 rounded-lg border border-red-900/60 bg-red-950/30 text-xs text-red-200 space-y-2">
                            <div className="flex items-center gap-1.5 font-semibold text-red-400">
                              <AlertCircle className="w-4 h-4 shrink-0" />
                              <span>Connection Error</span>
                            </div>
                            <p className="text-slate-300 leading-relaxed">{msg.error}</p>
                            <div className="flex flex-wrap items-center gap-2 pt-1">
                              {settings.backendUrl !== '/api/chat' && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSettings(s => ({ ...s, backendUrl: '/api/chat' }));
                                    showToast('Switched to Built-in Backend (/api/chat)');
                                    setTimeout(() => handleRetry(msg.id), 100);
                                  }}
                                  className="flex items-center gap-1 px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white font-medium transition-colors"
                                >
                                  <Zap className="w-3 h-3 fill-current" />
                                  <span>Use Built-in Backend</span>
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => handleRetry(msg.id)}
                                className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
                              >
                                <RotateCcw className="w-3 h-3" />
                                <span>Retry Request</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => setIsConnectionModalOpen(true)}
                                className="px-2.5 py-1 rounded border border-slate-700 text-slate-300 hover:bg-slate-800 transition-colors"
                              >
                                Check Backend
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Action buttons under response */}
                        {!msg.error && !msg.isStreaming && msg.content && (
                          <div className="flex items-center gap-2 mt-2 pt-1">
                            <button
                              type="button"
                              onClick={() => handleCopyMessage(msg.id, msg.content)}
                              className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-slate-400 hover:text-slate-200 hover:bg-slate-800/80 transition-colors"
                              aria-label="Copy message"
                            >
                              {copiedMsgId === msg.id ? (
                                <>
                                  <Check className="w-3 h-3 text-emerald-400" />
                                  <span className="text-emerald-400">Copied</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3 h-3" />
                                  <span>Copy</span>
                                </>
                              )}
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {isUser && (
                    <div className="w-8 h-8 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-300 shrink-0 mt-1">
                      <span className="text-xs font-semibold">U</span>
                    </div>
                  )}
                </div>
              );
            })}

            {/* Typing Indicator */}
            {isGenerating && activeChat?.messages.some(m => m.isStreaming && !m.content) && (
              <div className="flex gap-3.5 items-start">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-blue-600 to-cyan-500 flex items-center justify-center text-white shrink-0 mt-1">
                  <Zap className="w-4 h-4 fill-current" />
                </div>
                <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 border border-slate-800">
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-400 typing-dot-1" />
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-400 typing-dot-2" />
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-400 typing-dot-3" />
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </section>

        {/* Scroll To Bottom Button */}
        {showScrollBottom && (
          <button
            type="button"
            onClick={() => scrollToBottom()}
            className="fixed bottom-24 right-8 z-30 p-2.5 rounded-full bg-slate-800 text-slate-200 border border-slate-700 shadow-lg hover:bg-slate-700 transition-transform active:scale-95"
            aria-label="Scroll to bottom"
          >
            <ChevronDown className="w-4 h-4" />
          </button>
        )}

        {/* --- CHAT INPUT AREA --- */}
        <footer className="p-4 bg-slate-950 shrink-0">
          <div className="max-w-3xl mx-auto">
            <form
              onSubmit={e => {
                e.preventDefault();
                handleSendMessage();
              }}
              className="bg-slate-900 border border-slate-800 focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500/20 rounded-xl p-2.5 shadow-sm transition-all"
            >
              <textarea
                ref={textareaRef}
                rows={1}
                value={inputPrompt}
                onChange={e => setInputPrompt(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage();
                  }
                }}
                placeholder={`Ask ${settings.modelName}... (Shift+Enter for newline)`}
                className="w-full bg-transparent border-0 resize-none text-sm text-slate-100 placeholder:text-slate-500 focus:outline-hidden min-h-[28px] max-h-[200px]"
                aria-label="Prompt input"
              />

              <div className="flex items-center justify-between pt-2 border-t border-slate-800/80 mt-1">
                <div className="flex items-center gap-2 text-[11px] text-slate-500 font-mono">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                  <span>Local Inference</span>
                </div>

                <div className="flex items-center gap-2">
                  {isGenerating ? (
                    <button
                      type="button"
                      onClick={stopGeneration}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-medium transition-colors"
                      aria-label="Stop generation"
                    >
                      <Square className="w-3.5 h-3.5 fill-current text-red-400" />
                      <span>Stop</span>
                    </button>
                  ) : (
                    <button
                      type="submit"
                      disabled={!inputPrompt.trim() || isGenerating}
                      className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:hover:bg-blue-600 text-white text-xs font-medium transition-all"
                      aria-label="Send message"
                    >
                      <span>Send</span>
                      <Send className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </form>

            <div className="flex items-center justify-center gap-2 mt-2 text-[11px] text-slate-500">
              <span>Local AI Chat</span>
              <span>·</span>
              <span>{settings.modelName}</span>
              <span>·</span>
              <span className="font-mono text-slate-400">{settings.backendUrl}</span>
            </div>
          </div>
        </footer>
      </main>

      {/* --- SETTINGS MODAL --- */}
      {isSettingsOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="settings-heading"
        >
          <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between shrink-0">
              <div>
                <h3 id="settings-heading" className="text-base font-semibold text-white">
                  Settings
                </h3>
                <p className="text-xs text-slate-400">Configure model inference, theme, and local API endpoint</p>
              </div>
              <button
                type="button"
                onClick={() => setIsSettingsOpen(false)}
                className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800"
                aria-label="Close settings"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-5 text-xs text-slate-300">
              {/* Model Name */}
              <div>
                <label className="block font-medium text-slate-200 mb-1">Model Name</label>
                <input
                  type="text"
                  value={settings.modelName}
                  onChange={e => setSettings(s => ({ ...s, modelName: e.target.value }))}
                  className="w-full h-8 px-2.5 bg-slate-950 border border-slate-800 rounded-md text-slate-200 focus:outline-hidden focus:border-blue-500"
                />
              </div>

              {/* Backend API URL */}
              <div>
                <label className="block font-medium text-slate-200 mb-1">Backend API Endpoint</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={settings.backendUrl}
                    onChange={e => setSettings(s => ({ ...s, backendUrl: e.target.value }))}
                    className="flex-1 h-8 px-2.5 bg-slate-950 border border-slate-800 rounded-md text-slate-200 font-mono text-[11px] focus:outline-hidden focus:border-blue-500"
                  />
                  <button
                    type="button"
                    onClick={() => pingBackend(settings.backendUrl)}
                    className="px-3 h-8 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs whitespace-nowrap"
                  >
                    Test Ping
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setSettings(s => ({ ...s, backendUrl: '/api/chat' }));
                      pingBackend('/api/chat');
                    }}
                    className={`px-2 py-0.5 rounded text-[10px] font-mono border transition-colors ${
                      settings.backendUrl === '/api/chat'
                        ? 'bg-blue-600/20 border-blue-500 text-blue-400'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    ⚡ Built-in Server (/api/chat)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSettings(s => ({ ...s, backendUrl: 'http://127.0.0.1:8000/api/chat' }));
                      pingBackend('http://127.0.0.1:8000/api/chat');
                    }}
                    className={`px-2 py-0.5 rounded text-[10px] font-mono border transition-colors ${
                      settings.backendUrl.includes('8000')
                        ? 'bg-blue-600/20 border-blue-500 text-blue-400'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    🐍 FastAPI (127.0.0.1:8000)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSettings(s => ({ ...s, backendUrl: 'http://127.0.0.1:11434/api/chat' }));
                      pingBackend('http://127.0.0.1:11434/api/chat');
                    }}
                    className={`px-2 py-0.5 rounded text-[10px] font-mono border transition-colors ${
                      settings.backendUrl.includes('11434')
                        ? 'bg-blue-600/20 border-blue-500 text-blue-400'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    🦙 Ollama (127.0.0.1:11434)
                  </button>
                </div>
                {testResult && (
                  <p
                    className={`mt-1.5 text-[11px] ${
                      testResult.success ? 'text-emerald-400' : 'text-red-400'
                    }`}
                  >
                    {testResult.text}
                  </p>
                )}
              </div>

              {/* System Prompt */}
              <div>
                <label className="block font-medium text-slate-200 mb-1">System Prompt</label>
                <textarea
                  rows={2}
                  value={settings.systemPrompt}
                  onChange={e => setSettings(s => ({ ...s, systemPrompt: e.target.value }))}
                  className="w-full p-2 bg-slate-950 border border-slate-800 rounded-md text-slate-200 resize-none focus:outline-hidden focus:border-blue-500 text-xs"
                />
              </div>

              {/* Streaming Toggle */}
              <div className="flex items-center justify-between py-1">
                <div>
                  <span className="block font-medium text-slate-200">Stream Response</span>
                  <span className="text-[11px] text-slate-500">Render tokens progressively via SSE</span>
                </div>
                <button
                  type="button"
                  onClick={() => setSettings(s => ({ ...s, streaming: !s.streaming }))}
                  className={`w-10 h-5 flex items-center rounded-full p-1 cursor-pointer transition-colors ${
                    settings.streaming ? 'bg-blue-600' : 'bg-slate-800'
                  }`}
                  role="switch"
                  aria-checked={settings.streaming}
                >
                  <span
                    className={`bg-white w-3 h-3 rounded-full shadow-md transform transition-transform ${
                      settings.streaming ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Sliders: Temperature & Max Tokens */}
              <div className="space-y-3 pt-1">
                <div>
                  <div className="flex justify-between mb-1">
                    <span className="font-medium text-slate-200">Temperature</span>
                    <span className="font-mono text-blue-400">{settings.temperature}</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1.5"
                    step="0.05"
                    value={settings.temperature}
                    onChange={e => setSettings(s => ({ ...s, temperature: parseFloat(e.target.value) }))}
                    className="w-full accent-blue-500"
                  />
                </div>

                <div>
                  <div className="flex justify-between mb-1">
                    <span className="font-medium text-slate-200">Max Tokens</span>
                    <span className="font-mono text-blue-400">{settings.maxTokens}</span>
                  </div>
                  <input
                    type="range"
                    min="256"
                    max="8192"
                    step="256"
                    value={settings.maxTokens}
                    onChange={e => setSettings(s => ({ ...s, maxTokens: parseInt(e.target.value, 10) }))}
                    className="w-full accent-blue-500"
                  />
                </div>
              </div>

              {/* Theme selector */}
              <div>
                <label className="block font-medium text-slate-200 mb-1.5">Theme</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['dark', 'light', 'system'] as const).map(t => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setSettings(s => ({ ...s, theme: t }))}
                      className={`py-1.5 px-3 rounded-md border text-center capitalize transition-colors ${
                        settings.theme === t
                          ? 'border-blue-500 bg-blue-500/10 text-blue-400 font-medium'
                          : 'border-slate-800 bg-slate-950 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              {/* Data actions */}
              <div className="pt-2 border-t border-slate-800 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleExportAllJSON}
                  className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs flex items-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Export All Chats (JSON)</span>
                </button>
                <button
                  type="button"
                  onClick={handleClearAllChats}
                  className="px-3 py-1.5 rounded bg-red-950/40 hover:bg-red-900/60 text-red-300 border border-red-900 text-xs flex items-center gap-1.5"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Clear All Chats</span>
                </button>
              </div>
            </div>

            <div className="px-5 py-3 border-t border-slate-800 bg-slate-900 flex justify-between shrink-0">
              <button
                type="button"
                onClick={() => {
                  setSettings(DEFAULT_SETTINGS);
                  showToast('Reset settings to default');
                }}
                className="px-3 py-1.5 rounded text-xs text-slate-400 hover:text-slate-200"
              >
                Reset Defaults
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsSettingsOpen(false);
                  showToast('Settings saved');
                }}
                className="px-4 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- CONNECTION STATUS MODAL --- */}
      {isConnectionModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-xl shadow-2xl p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-base font-semibold text-white">Local Backend Status</h3>
                <p className="text-xs text-slate-400">Connection to Gemma 4 Inference Server</p>
              </div>
              <button
                type="button"
                onClick={() => setIsConnectionModalOpen(false)}
                className="p-1 rounded text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center gap-3 p-3 rounded-lg bg-slate-950 border border-slate-800">
              <span
                className={`w-3.5 h-3.5 rounded-full ${
                  backendStatus === 'connected'
                    ? 'bg-emerald-500'
                    : backendStatus === 'connecting'
                    ? 'bg-amber-500 animate-pulse'
                    : 'bg-red-500'
                }`}
              />
              <div>
                <p className="text-xs font-semibold text-white">
                  {backendStatus === 'connected'
                    ? 'Backend Connected and Ready'
                    : backendStatus === 'connecting'
                    ? 'Checking connection...'
                    : 'Backend Offline'}
                </p>
                <p className="text-[11px] font-mono text-slate-400">{settings.backendUrl}</p>
              </div>
            </div>

            <div className="text-xs text-slate-400 space-y-2">
              <p className="font-semibold text-slate-300">How to launch your local server:</p>
              <ol className="list-decimal pl-4 space-y-1">
                <li>Run your FastAPI, vLLM, or llama.cpp server with Gemma 4 12B QAT weights.</li>
                <li>Ensure endpoint exposes <code className="text-blue-400 font-mono">/api/chat</code>.</li>
                <li>Ensure CORS allows local browser origins.</li>
              </ol>
              <div className="p-2 rounded bg-slate-950 font-mono text-[11px] text-cyan-400 border border-slate-800">
                <code>uvicorn server:app --host 127.0.0.1 --port 8000</code>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => {
                  setIsConnectionModalOpen(false);
                  setIsSettingsOpen(true);
                }}
                className="px-3 py-1.5 rounded text-xs border border-slate-700 text-slate-300 hover:bg-slate-800"
              >
                Change URL
              </button>
              <button
                type="button"
                onClick={() => pingBackend()}
                className="px-3 py-1.5 rounded text-xs bg-blue-600 hover:bg-blue-500 text-white font-medium"
              >
                Ping Server
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- RENAME MODAL --- */}
      {renameModal.open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-xl shadow-2xl p-5 space-y-4">
            <h3 className="text-base font-semibold text-white">Rename Conversation</h3>
            <input
              type="text"
              autoFocus
              value={renameModal.title}
              onChange={e => setRenameModal(prev => ({ ...prev, title: e.target.value }))}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  const newT = renameModal.title.trim() || 'Untitled';
                  setChats(prev =>
                    prev.map(c => (c.id === renameModal.chatId ? { ...c, title: newT } : c))
                  );
                  setRenameModal(prev => ({ ...prev, open: false }));
                  showToast('Conversation renamed');
                }
              }}
              className="w-full h-9 px-3 bg-slate-950 border border-slate-800 rounded-md text-xs text-slate-100 focus:outline-hidden focus:border-blue-500"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRenameModal(prev => ({ ...prev, open: false }))}
                className="px-3 py-1.5 rounded text-xs text-slate-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const newT = renameModal.title.trim() || 'Untitled';
                  setChats(prev =>
                    prev.map(c => (c.id === renameModal.chatId ? { ...c, title: newT } : c))
                  );
                  setRenameModal(prev => ({ ...prev, open: false }));
                  showToast('Conversation renamed');
                }}
                className="px-3.5 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- CONFIRMATION MODAL --- */}
      {confirmModal.open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-xl shadow-2xl p-5 space-y-3">
            <h3 className="text-base font-semibold text-white">{confirmModal.title}</h3>
            <p className="text-xs text-slate-400">{confirmModal.desc}</p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmModal(prev => ({ ...prev, open: false }))}
                className="px-3 py-1.5 rounded text-xs text-slate-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  confirmModal.onConfirm();
                  setConfirmModal(prev => ({ ...prev, open: false }));
                }}
                className="px-3.5 py-1.5 rounded bg-red-600 hover:bg-red-500 text-white text-xs font-medium"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- TOAST NOTIFICATION --- */}
      {toastMessage && (
        <div
          className="fixed bottom-5 right-5 z-50 px-3.5 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-slate-200 shadow-xl flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2"
          role="status"
        >
          <Sparkles className="w-3.5 h-3.5 text-blue-400" />
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
}
