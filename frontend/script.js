/**
 * Local AI Chat - Frontend Application Script
 * Gemma 4 12B QAT Interface
 * 
 * Standalone Vanilla JavaScript implementation with persistent localStorage,
 * Markdown-like syntax rendering, clipboard utilities, responsive UI,
 * and clean backend connection module ready for http://127.0.0.1:8000/api/chat.
 */

(() => {
  'use strict';

  // --- Constants & Storage Keys ---
  const STORAGE_KEY_CHATS = 'local_ai_chats';
  const STORAGE_KEY_ACTIVE = 'local_ai_active_chat_id';
  const STORAGE_KEY_SETTINGS = 'local_ai_settings';

  const DEFAULT_SETTINGS = {
    modelName: 'Gemma 4 12B QAT',
    backendUrl: '/api/chat',
    systemPrompt: 'You are Gemma 4, a state-of-the-art local AI model created by Google. You are helpful, insightful, and concise.',
    streaming: true,
    temperature: 0.7,
    maxTokens: 2048,
    theme: 'dark', // 'dark', 'light', 'system'
  };

  // --- Application State ---
  let state = {
    chats: [],
    activeChatId: null,
    settings: { ...DEFAULT_SETTINGS },
    isGenerating: false,
    abortController: null,
    connectionStatus: 'disconnected', // 'connected' | 'connecting' | 'disconnected'
    searchQuery: '',
    confirmActionCallback: null,
  };

  // --- DOM Elements Cache ---
  const el = {};

  function cacheDOMElements() {
    el.appContainer = document.getElementById('app-container');
    el.sidebar = document.getElementById('sidebar');
    el.sidebarBackdrop = document.getElementById('sidebar-backdrop');
    el.collapseSidebarBtn = document.getElementById('collapse-sidebar-btn');
    el.expandSidebarBtn = document.getElementById('expand-sidebar-btn');
    el.mobileMenuBtn = document.getElementById('mobile-menu-btn');
    el.mobileCloseSidebarBtn = document.getElementById('mobile-close-sidebar-btn');

    el.newChatBtn = document.getElementById('new-chat-btn');
    el.searchChatsInput = document.getElementById('search-chats-input');
    el.searchClearBtn = document.getElementById('search-clear-btn');
    el.chatHistoryList = document.getElementById('chat-history-list');
    el.historyEmptyState = document.getElementById('history-empty-state');

    el.activeChatTitle = document.getElementById('active-chat-title');
    el.renameCurrentBtn = document.getElementById('rename-current-btn');
    el.headerModelName = document.getElementById('header-model-name');
    el.headerStatusBtn = document.getElementById('header-status-btn');
    el.headerStatusDot = document.getElementById('header-status-dot');
    el.headerStatusLabel = document.getElementById('header-status-label');

    el.sidebarModelSubtitle = document.getElementById('sidebar-model-subtitle');
    el.footerStatusDot = document.getElementById('footer-status-dot');
    el.footerStatusText = document.getElementById('footer-status-text');
    el.footerConnectionBtn = document.getElementById('footer-connection-btn');
    el.openSettingsBtn = document.getElementById('open-settings-btn');
    el.headerSettingsBtn = document.getElementById('header-settings-btn');

    el.themeToggleBtn = document.getElementById('theme-toggle-btn');
    el.exportChatBtn = document.getElementById('export-chat-btn');
    el.clearChatBtn = document.getElementById('clear-chat-btn');

    el.messagesViewport = document.getElementById('messages-viewport');
    el.messagesList = document.getElementById('messages-list');
    el.emptyStateScreen = document.getElementById('empty-state-screen');
    el.emptyStateModelName = document.getElementById('empty-state-model-name');
    el.typingIndicator = document.getElementById('typing-indicator');
    el.scrollBottomBtn = document.getElementById('scroll-bottom-btn');

    el.calloutCheckBtn = document.getElementById('callout-check-btn');
    el.calloutSettingsBtn = document.getElementById('callout-settings-btn');
    el.emptyCalloutDot = document.getElementById('empty-callout-dot');
    el.emptyCalloutText = document.getElementById('empty-callout-text');

    el.chatForm = document.getElementById('chat-form');
    el.chatInput = document.getElementById('chat-input');
    el.sendBtn = document.getElementById('send-btn');
    el.stopGenBtn = document.getElementById('stop-generation-btn');
    el.footerEndpointDisplay = document.getElementById('footer-endpoint-display');

    // Settings Modal
    el.settingsModal = document.getElementById('settings-modal-backdrop');
    el.closeSettingsBtn = document.getElementById('close-settings-btn');
    el.saveSettingsBtn = document.getElementById('save-settings-btn');
    el.resetSettingsBtn = document.getElementById('reset-settings-btn');
    el.settingModelName = document.getElementById('setting-model-name');
    el.settingBackendUrl = document.getElementById('setting-backend-url');
    el.settingSystemPrompt = document.getElementById('setting-system-prompt');
    el.settingStreamingToggle = document.getElementById('setting-streaming-toggle');
    el.settingTemperature = document.getElementById('setting-temperature');
    el.temperatureValDisplay = document.getElementById('temperature-val-display');
    el.settingMaxTokens = document.getElementById('setting-max-tokens');
    el.maxTokensValDisplay = document.getElementById('max-tokens-val-display');
    el.testConnectionBtn = document.getElementById('test-connection-btn');
    el.connectionTestResult = document.getElementById('connection-test-result');
    el.exportAllDataBtn = document.getElementById('export-all-data-btn');
    el.clearAllDataBtn = document.getElementById('clear-all-data-btn');

    // Connection Modal
    el.connectionModal = document.getElementById('connection-modal-backdrop');
    el.closeConnModalBtn = document.getElementById('close-connection-modal-btn');
    el.connModalDot = document.getElementById('conn-modal-dot');
    el.connModalStatusText = document.getElementById('conn-modal-status-text');
    el.connModalUrlText = document.getElementById('conn-modal-url-text');
    el.connModalPingBtn = document.getElementById('conn-modal-ping-btn');
    el.connModalSettingsBtn = document.getElementById('conn-modal-settings-btn');
    el.connModalPingFeedback = document.getElementById('conn-modal-ping-feedback');

    // Rename Modal
    el.renameModal = document.getElementById('rename-modal-backdrop');
    el.renameInput = document.getElementById('rename-input');
    el.closeRenameBtn = document.getElementById('close-rename-modal-btn');
    el.cancelRenameBtn = document.getElementById('cancel-rename-btn');
    el.saveRenameBtn = document.getElementById('save-rename-btn');

    // Confirm Modal
    el.confirmModal = document.getElementById('confirm-modal-backdrop');
    el.confirmDesc = document.getElementById('confirm-dialog-desc');
    el.closeConfirmBtn = document.getElementById('close-confirm-modal-btn');
    el.cancelConfirmBtn = document.getElementById('cancel-confirm-btn');
    el.actionConfirmBtn = document.getElementById('action-confirm-btn');

    el.toastContainer = document.getElementById('toast-container');
  }

  // --- Utility Functions ---
  function generateId() {
    return 'chat_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 7);
  }

  function escapeHtml(text) {
    if (!text) return '';
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function formatTime(isoString) {
    if (!isoString) return '';
    const date = new Date(isoString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function showToast(message, duration = 3000) {
    if (!el.toastContainer) return;
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.setAttribute('role', 'status');
    toast.textContent = message;
    el.toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 200ms ease';
      setTimeout(() => toast.remove(), 200);
    }, duration);
  }

  // Simple Markdown parser for Assistant messages (Safe & Escaped)
  function renderMarkdown(content) {
    if (!content) return '';

    // Extract code blocks first to protect code content
    const codeBlocks = [];
    let processed = content.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (_, lang, code) => {
      const id = codeBlocks.length;
      codeBlocks.push({ lang: lang.trim() || 'code', code: code.replace(/\n$/, '') });
      return `__CODE_BLOCK_${id}__`;
    });

    // Escape raw HTML characters
    processed = escapeHtml(processed);

    // Restore Code Blocks with markup & copy button
    processed = processed.replace(/__CODE_BLOCK_(\d+)__/g, (_, idx) => {
      const item = codeBlocks[Number(idx)];
      const escapedCode = escapeHtml(item.code);
      return `
        <div class="code-block-wrapper">
          <div class="code-block-header">
            <span>${item.lang}</span>
            <button type="button" class="copy-code-btn" data-code="${encodeURIComponent(item.code)}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
              <span>Copy</span>
            </button>
          </div>
          <pre><code>${escapedCode}</code></pre>
        </div>
      `;
    });

    // Inline code: `code`
    processed = processed.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');

    // Bold: **text**
    processed = processed.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    // Italic: *text*
    processed = processed.replace(/\*([^*]+)\*/g, '<em>$1</em>');

    // Headers
    processed = processed.replace(/^### (.*$)/gim, '<h3>$1</h3>');
    processed = processed.replace(/^## (.*$)/gim, '<h2>$1</h2>');
    processed = processed.replace(/^# (.*$)/gim, '<h1>$1</h1>');

    // Blockquotes
    processed = processed.replace(/^> (.*$)/gim, '<blockquote>$1</blockquote>');

    // Split into paragraphs & lists
    const lines = processed.split('\n');
    let inList = false;
    let listType = 'ul';
    const outputLines = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Unordered list
      const ulMatch = line.match(/^(\s*)[-*+]\s+(.*)$/);
      // Ordered list
      const olMatch = line.match(/^(\s*)\d+\.\s+(.*)$/);

      if (ulMatch) {
        if (!inList) {
          outputLines.push('<ul>');
          inList = true;
          listType = 'ul';
        }
        outputLines.push(`<li>${ulMatch[2]}</li>`);
      } else if (olMatch) {
        if (!inList) {
          outputLines.push('<ol>');
          inList = true;
          listType = 'ol';
        }
        outputLines.push(`<li>${olMatch[2]}</li>`);
      } else {
        if (inList) {
          outputLines.push(`</${listType}>`);
          inList = false;
        }
        if (line.trim().startsWith('<div class="code-block-wrapper">') || line.trim().startsWith('<h') || line.trim().startsWith('<blockquote')) {
          outputLines.push(line);
        } else if (line.trim().length > 0) {
          outputLines.push(`<p>${line}</p>`);
        }
      }
    }

    if (inList) {
      outputLines.push(`</${listType}>`);
    }

    return outputLines.join('\n');
  }

  // --- Local Storage Management ---
  function loadFromStorage() {
    try {
      const savedSettings = localStorage.getItem(STORAGE_KEY_SETTINGS);
      if (savedSettings) {
        state.settings = { ...DEFAULT_SETTINGS, ...JSON.parse(savedSettings) };
        if (window.location.protocol === 'https:' && state.settings.backendUrl?.includes('127.0.0.1')) {
          state.settings.backendUrl = '/api/chat';
        }
      }

      const savedChats = localStorage.getItem(STORAGE_KEY_CHATS);
      if (savedChats) {
        state.chats = JSON.parse(savedChats);
      }

      const activeId = localStorage.getItem(STORAGE_KEY_ACTIVE);
      if (activeId && state.chats.some(c => c.id === activeId)) {
        state.activeChatId = activeId;
      } else if (state.chats.length > 0) {
        state.activeChatId = state.chats[0].id;
      } else {
        createNewChat(false);
      }
    } catch (err) {
      console.error('Failed to parse localStorage data:', err);
      state.chats = [];
      createNewChat(false);
    }
  }

  function saveChatsToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY_CHATS, JSON.stringify(state.chats));
      if (state.activeChatId) {
        localStorage.setItem(STORAGE_KEY_ACTIVE, state.activeChatId);
      }
    } catch (err) {
      console.error('Failed to save chats to localStorage:', err);
    }
  }

  function saveSettingsToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(state.settings));
    } catch (err) {
      console.error('Failed to save settings:', err);
    }
  }

  // --- Chat Lifecycle & Management ---
  function getActiveChat() {
    return state.chats.find(c => c.id === state.activeChatId) || null;
  }

  function createNewChat(autoRender = true) {
    const newChat = {
      id: generateId(),
      title: 'New Conversation',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [],
    };
    state.chats.unshift(newChat);
    state.activeChatId = newChat.id;
    saveChatsToStorage();

    if (autoRender) {
      renderChatHistory();
      renderActiveChat();
      if (window.innerWidth <= 768) {
        closeMobileSidebar();
      }
      el.chatInput.focus();
    }
    return newChat;
  }

  function selectChat(id) {
    if (state.activeChatId === id) return;
    if (state.isGenerating) {
      showToast('Please wait or stop the current generation before switching chats');
      return;
    }
    state.activeChatId = id;
    saveChatsToStorage();
    renderChatHistory();
    renderActiveChat();
    if (window.innerWidth <= 768) {
      closeMobileSidebar();
    }
  }

  function renameChat(id, newTitle) {
    const chat = state.chats.find(c => c.id === id);
    if (!chat) return;
    const cleanTitle = newTitle.trim() || 'Untitled Conversation';
    chat.title = cleanTitle;
    chat.updatedAt = new Date().toISOString();
    saveChatsToStorage();
    renderChatHistory();
    if (state.activeChatId === id) {
      el.activeChatTitle.textContent = cleanTitle;
    }
    showToast('Conversation renamed');
  }

  function deleteChat(id) {
    const index = state.chats.findIndex(c => c.id === id);
    if (index === -1) return;

    state.chats.splice(index, 1);

    if (state.activeChatId === id) {
      if (state.chats.length > 0) {
        state.activeChatId = state.chats[0].id;
      } else {
        createNewChat(false);
      }
    }

    saveChatsToStorage();
    renderChatHistory();
    renderActiveChat();
    showToast('Conversation deleted');
  }

  function clearActiveChatMessages() {
    const chat = getActiveChat();
    if (!chat) return;
    chat.messages = [];
    chat.updatedAt = new Date().toISOString();
    saveChatsToStorage();
    renderActiveChat();
    showToast('Messages cleared');
  }

  function clearAllChats() {
    state.chats = [];
    createNewChat(false);
    saveChatsToStorage();
    renderChatHistory();
    renderActiveChat();
    showToast('All conversations cleared');
  }

  // --- Rendering UI ---
  function renderChatHistory() {
    el.chatHistoryList.innerHTML = '';
    const query = state.searchQuery.toLowerCase().trim();

    const filtered = state.chats.filter(chat => {
      if (!query) return true;
      if (chat.title.toLowerCase().includes(query)) return true;
      return chat.messages.some(m => m.content.toLowerCase().includes(query));
    });

    if (filtered.length === 0) {
      el.historyEmptyState.hidden = false;
      return;
    }
    el.historyEmptyState.hidden = true;

    filtered.forEach(chat => {
      const item = document.createElement('div');
      item.className = `history-item ${chat.id === state.activeChatId ? 'active' : ''}`;
      item.setAttribute('role', 'button');
      item.setAttribute('tabindex', '0');
      item.setAttribute('aria-label', `Conversation: ${chat.title}`);

      item.innerHTML = `
        <div class="history-item-content">
          <svg class="history-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
          </svg>
          <span class="history-item-title">${escapeHtml(chat.title)}</span>
        </div>
        <div class="history-item-actions">
          <button type="button" class="history-action-btn rename-btn" title="Rename conversation" aria-label="Rename ${escapeHtml(chat.title)}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 20h9"></path>
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
            </svg>
          </button>
          <button type="button" class="history-action-btn delete-btn" title="Delete conversation" aria-label="Delete ${escapeHtml(chat.title)}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
        </div>
      `;

      item.addEventListener('click', (e) => {
        if (e.target.closest('.rename-btn')) {
          e.stopPropagation();
          openRenameModal(chat.id, chat.title);
          return;
        }
        if (e.target.closest('.delete-btn')) {
          e.stopPropagation();
          openConfirmModal(
            `Delete "${chat.title}"?`,
            'This conversation will be permanently removed.',
            () => deleteChat(chat.id)
          );
          return;
        }
        selectChat(chat.id);
      });

      item.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          selectChat(chat.id);
        }
      });

      el.chatHistoryList.appendChild(item);
    });
  }

  function renderActiveChat() {
    const chat = getActiveChat();
    if (!chat) return;

    el.activeChatTitle.textContent = chat.title;
    el.headerModelName.textContent = state.settings.modelName;
    el.sidebarModelSubtitle.textContent = state.settings.modelName;
    el.emptyStateModelName.textContent = state.settings.modelName;

    // Check if chat has messages
    if (!chat.messages || chat.messages.length === 0) {
      el.emptyStateScreen.style.display = 'flex';
      el.messagesList.innerHTML = '';
      return;
    }

    el.emptyStateScreen.style.display = 'none';
    el.messagesList.innerHTML = '';

    chat.messages.forEach(msg => {
      appendMessageToDOM(msg, false);
    });

    scrollToBottom();
  }

  function appendMessageToDOM(msg, shouldScroll = true) {
    const isUser = msg.role === 'user';
    const row = document.createElement('div');
    row.className = `message-row ${isUser ? 'user-message' : 'assistant-message'}`;
    row.id = `msg-${msg.id}`;

    if (isUser) {
      row.innerHTML = `
        <div class="message-avatar user-avatar" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
            <circle cx="12" cy="7" r="4"></circle>
          </svg>
        </div>
        <div class="message-body">
          <div class="message-sender-line">
            <span class="sender-name">You</span>
            <span class="sender-timestamp">${formatTime(msg.timestamp)}</span>
          </div>
          <div class="message-content-bubble">${escapeHtml(msg.content)}</div>
        </div>
      `;
    } else {
      const renderedContent = renderMarkdown(msg.content || '');
      const errorHtml = msg.error ? `
        <div class="message-error-card">
          <div class="error-title-row">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
            <span>Connection Error</span>
          </div>
          <p class="error-desc">${escapeHtml(msg.error)}</p>
          <div class="error-actions">
            <button type="button" class="btn btn-outline btn-sm retry-btn" data-id="${msg.id}">
              Retry Request
            </button>
            <button type="button" class="btn btn-outline btn-sm open-conn-btn">
              Check Backend
            </button>
          </div>
        </div>
      ` : '';

      row.innerHTML = `
        <div class="message-avatar assistant-avatar" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
          </svg>
        </div>
        <div class="message-body">
          <div class="message-sender-line">
            <span class="sender-name">${escapeHtml(state.settings.modelName)}</span>
            <span class="sender-timestamp">${formatTime(msg.timestamp)}</span>
            ${msg.isStreaming ? '<span class="sender-status-text">Streaming...</span>' : ''}
          </div>
          <div class="message-content-bubble">
            ${renderedContent}
            ${msg.isStreaming ? '<span class="streaming-cursor"></span>' : ''}
          </div>
          ${errorHtml}
          ${!msg.error && !msg.isStreaming ? `
            <div class="message-actions-bar">
              <button type="button" class="msg-action-btn copy-msg-btn" data-content="${encodeURIComponent(msg.content)}" aria-label="Copy assistant response">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                <span>Copy</span>
              </button>
            </div>
          ` : ''}
        </div>
      `;

      // Attach event listeners for copy and retry
      const copyBtn = row.querySelector('.copy-msg-btn');
      if (copyBtn) {
        copyBtn.addEventListener('click', () => {
          const raw = decodeURIComponent(copyBtn.dataset.content || '');
          navigator.clipboard.writeText(raw).then(() => {
            showToast('Response copied to clipboard');
          });
        });
      }

      const retryBtn = row.querySelector('.retry-btn');
      if (retryBtn) {
        retryBtn.addEventListener('click', () => {
          retryMessage(msg.id);
        });
      }

      const openConnBtn = row.querySelector('.open-conn-btn');
      if (openConnBtn) {
        openConnBtn.addEventListener('click', openConnectionModal);
      }
    }

    el.messagesList.appendChild(row);

    if (shouldScroll) {
      scrollToBottom();
    }
  }

  function updateStreamingMessageInDOM(messageId, currentText, isStreaming = true) {
    const row = document.getElementById(`msg-${messageId}`);
    if (!row) return;

    const bubble = row.querySelector('.message-content-bubble');
    if (bubble) {
      bubble.innerHTML = renderMarkdown(currentText) + (isStreaming ? '<span class="streaming-cursor"></span>' : '');
    }

    const statusText = row.querySelector('.sender-status-text');
    if (statusText && !isStreaming) {
      statusText.remove();
    }

    scrollToBottom();
  }

  function scrollToBottom(force = false) {
    if (!el.messagesViewport) return;
    el.messagesViewport.scrollTop = el.messagesViewport.scrollHeight;
  }

  // --- Backend Communication Module ---
  /**
   * Clean JavaScript API function to send chat messages to the local backend.
   * Target endpoint: http://127.0.0.1:8000/api/chat
   *
   * @param {string} chatId - Current conversation identifier
   * @param {Array} messages - List of conversation messages [{role, content}]
   * @param {Object} options - Model name, temperature, streaming, etc.
   * @param {Function} onChunk - Callback for incremental streamed tokens: (chunkText) => void
   * @param {Function} onComplete - Callback when request successfully finishes: (fullResponseText) => void
   * @param {Function} onError - Callback on failure: (errorMessage, errorDetails) => void
   * @returns {AbortController} - Controller allowing cancellation via stop button
   */
  async function sendMessageToBackend(chatId, messages, options, onChunk, onComplete, onError) {
    const controller = new AbortController();
    const endpoint = options.backendUrl || 'http://127.0.0.1:8000/api/chat';

    // Format payload supporting both {message, history} and {messages}
    const lastUserMsg = messages.filter(m => m.role === 'user').pop();
    const promptText = lastUserMsg ? lastUserMsg.content : '';
    const priorHistory = messages.slice(0, -1).map(m => ({ role: m.role, content: m.content }));

    const payload = {
      message: promptText,
      history: priorHistory,
      messages: [
        ...(options.systemPrompt ? [{ role: 'system', content: options.systemPrompt }] : []),
        ...messages.map(m => ({ role: m.role, content: m.content })),
      ],
      model: options.modelName || 'gemma-4-12b-qat',
      stream: Boolean(options.streaming),
      temperature: Number(options.temperature ?? 0.7),
      max_tokens: Number(options.maxTokens ?? 2048),
      system_prompt: options.systemPrompt,
    };

    updateConnectionStatus('connecting');

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': options.streaming ? 'text/event-stream, application/json' : 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`Server returned HTTP ${response.status}: ${errorText || response.statusText}`);
      }

      updateConnectionStatus('connected');

      const contentType = response.headers.get('content-type') || '';
      const isSSE = contentType.includes('text/event-stream');

      // Handle Streaming SSE Response
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
          buffer = lines.pop() || ''; // Keep partial line for next iteration

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith(':')) continue; // SSE comment or empty

            if (trimmed.startsWith('data:')) {
              const dataStr = trimmed.slice(5).trim();
              if (dataStr === '[DONE]') {
                break;
              }
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
                  if (typeof onChunk === 'function') {
                    onChunk(delta, fullText);
                  }
                }
              } catch {
                // Raw plain text token fallback
                fullText += dataStr;
                if (typeof onChunk === 'function') {
                  onChunk(dataStr, fullText);
                }
              }
            }
          }
        }

        if (typeof onComplete === 'function') {
          onComplete(fullText);
        }
      } else {
        // Non-streaming JSON response or fallback
        const data = await response.json();
        const responseText =
          data.reply ||
          data.response ||
          data.choices?.[0]?.message?.content ||
          data.message?.content ||
          data.text ||
          '';
        if (typeof onComplete === 'function') {
          onComplete(responseText);
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        if (typeof onComplete === 'function') {
          onComplete('(Generation stopped by user)');
        }
      } else {
        updateConnectionStatus('disconnected');
        const userFriendlyMessage = `Failed to connect to local AI server at ${endpoint}. Please ensure your local Gemma service is active. Details: ${err.message}`;
        if (typeof onError === 'function') {
          onError(userFriendlyMessage, err);
        }
      }
    }

    return controller;
  }

  // --- Sending Flow & State Handling ---
  async function handleSendMessage() {
    const text = el.chatInput.value.trim();
    if (!text || state.isGenerating) return;

    const chat = getActiveChat();
    if (!chat) return;

    // Auto-title conversation on first message
    if (chat.messages.length === 0) {
      const generatedTitle = text.slice(0, 32) + (text.length > 32 ? '...' : '');
      chat.title = generatedTitle;
      el.activeChatTitle.textContent = generatedTitle;
    }

    // 1. Add User Message
    const userMsg = {
      id: generateId(),
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
    };

    chat.messages.push(userMsg);
    chat.updatedAt = new Date().toISOString();
    saveChatsToStorage();

    // Reset input
    el.chatInput.value = '';
    adjustTextareaHeight();
    el.sendBtn.disabled = true;

    // Render in UI
    el.emptyStateScreen.style.display = 'none';
    appendMessageToDOM(userMsg);
    renderChatHistory();

    // 2. Prepare Assistant Placeholder
    const assistantMsgId = generateId();
    const assistantMsg = {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
      isStreaming: true,
      error: null,
    };

    chat.messages.push(assistantMsg);
    saveChatsToStorage();

    // Toggle generating state
    setGeneratingState(true);
    showTypingIndicator(true);

    let accumulatedContent = '';

    // 3. Trigger Backend Call
    const controller = await sendMessageToBackend(
      chat.id,
      chat.messages.filter(m => m.id !== assistantMsgId),
      {
        backendUrl: state.settings.backendUrl,
        modelName: state.settings.modelName,
        streaming: state.settings.streaming,
        temperature: state.settings.temperature,
        maxTokens: state.settings.maxTokens,
        systemPrompt: state.settings.systemPrompt,
      },
      // onChunk
      (chunk, full) => {
        showTypingIndicator(false);
        accumulatedContent = full;
        assistantMsg.content = full;
        saveChatsToStorage();

        // If not in DOM yet, append
        if (!document.getElementById(`msg-${assistantMsgId}`)) {
          appendMessageToDOM(assistantMsg);
        } else {
          updateStreamingMessageInDOM(assistantMsgId, full, true);
        }
      },
      // onComplete
      (finalText) => {
        showTypingIndicator(false);
        setGeneratingState(false);
        assistantMsg.content = finalText || accumulatedContent;
        assistantMsg.isStreaming = false;
        saveChatsToStorage();

        if (!document.getElementById(`msg-${assistantMsgId}`)) {
          appendMessageToDOM(assistantMsg);
        } else {
          updateStreamingMessageInDOM(assistantMsgId, assistantMsg.content, false);
          // Rerender chat to ensure all action buttons and copy items are fresh
          renderActiveChat();
        }
      },
      // onError
      (errMsg, err) => {
        showTypingIndicator(false);
        setGeneratingState(false);
        assistantMsg.content = '';
        assistantMsg.isStreaming = false;
        assistantMsg.error = errMsg;
        saveChatsToStorage();

        if (!document.getElementById(`msg-${assistantMsgId}`)) {
          appendMessageToDOM(assistantMsg);
        } else {
          renderActiveChat();
        }
        showToast('Local backend offline or unreachable');
      }
    );

    state.abortController = controller;
  }

  function retryMessage(failedMsgId) {
    const chat = getActiveChat();
    if (!chat) return;

    const idx = chat.messages.findIndex(m => m.id === failedMsgId);
    if (idx === -1) return;

    // Remove the failed assistant message
    chat.messages.splice(idx, 1);
    saveChatsToStorage();
    renderActiveChat();

    // Find previous user message
    const prevUserMsg = chat.messages[chat.messages.length - 1];
    if (prevUserMsg && prevUserMsg.role === 'user') {
      // Trigger regeneration
      regenerateResponse(chat);
    }
  }

  async function regenerateResponse(chat) {
    if (state.isGenerating) return;

    const assistantMsgId = generateId();
    const assistantMsg = {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
      isStreaming: true,
      error: null,
    };

    chat.messages.push(assistantMsg);
    saveChatsToStorage();

    setGeneratingState(true);
    showTypingIndicator(true);

    let accumulatedContent = '';

    const controller = await sendMessageToBackend(
      chat.id,
      chat.messages.filter(m => m.id !== assistantMsgId),
      {
        backendUrl: state.settings.backendUrl,
        modelName: state.settings.modelName,
        streaming: state.settings.streaming,
        temperature: state.settings.temperature,
        maxTokens: state.settings.maxTokens,
        systemPrompt: state.settings.systemPrompt,
      },
      (chunk, full) => {
        showTypingIndicator(false);
        accumulatedContent = full;
        assistantMsg.content = full;
        saveChatsToStorage();
        if (!document.getElementById(`msg-${assistantMsgId}`)) {
          appendMessageToDOM(assistantMsg);
        } else {
          updateStreamingMessageInDOM(assistantMsgId, full, true);
        }
      },
      (finalText) => {
        showTypingIndicator(false);
        setGeneratingState(false);
        assistantMsg.content = finalText || accumulatedContent;
        assistantMsg.isStreaming = false;
        saveChatsToStorage();
        renderActiveChat();
      },
      (errMsg) => {
        showTypingIndicator(false);
        setGeneratingState(false);
        assistantMsg.content = '';
        assistantMsg.isStreaming = false;
        assistantMsg.error = errMsg;
        saveChatsToStorage();
        renderActiveChat();
        showToast('Local backend error');
      }
    );

    state.abortController = controller;
  }

  function stopGeneration() {
    if (state.abortController) {
      state.abortController.abort();
      state.abortController = null;
    }
    setGeneratingState(false);
    showTypingIndicator(false);
    showToast('Generation cancelled');
  }

  function setGeneratingState(isGen) {
    state.isGenerating = isGen;
    el.stopGenBtn.hidden = !isGen;
    el.sendBtn.hidden = isGen;
  }

  function showTypingIndicator(visible) {
    el.typingIndicator.hidden = !visible;
    if (visible) {
      scrollToBottom();
    }
  }

  // --- Connection Status Management ---
  function updateConnectionStatus(newStatus) {
    state.connectionStatus = newStatus;
    const dotClasses = ['status-connected', 'status-connecting', 'status-disconnected', 'status-offline'];

    const removeOld = (element) => {
      if (!element) return;
      dotClasses.forEach(c => element.classList.remove(c));
      element.classList.add(`status-${newStatus}`);
    };

    removeOld(el.headerStatusDot);
    removeOld(el.footerStatusDot);
    removeOld(el.emptyCalloutDot);
    removeOld(el.connModalDot);

    const labels = {
      connected: 'Backend Ready',
      connecting: 'Connecting...',
      disconnected: 'Local Backend (Offline)',
      offline: 'Local Backend (Offline)',
    };

    const cleanLabel = labels[newStatus] || 'Offline';
    if (el.headerStatusLabel) el.headerStatusLabel.textContent = cleanLabel;
    if (el.emptyCalloutText) el.emptyCalloutText.textContent = `Backend Status: ${cleanLabel}`;
    if (el.connModalStatusText) el.connModalStatusText.textContent = cleanLabel;
  }

  async function testBackendPing(url) {
    const targetUrl = url || state.settings.backendUrl;
    updateConnectionStatus('connecting');

    try {
      // Fast probe to check if port/server is alive
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2500);

      const resp = await fetch(targetUrl, {
        method: 'OPTIONS',
        signal: controller.signal,
      }).catch(async () => {
        // Fallback to GET on root host to see if port responds
        const parsed = new URL(targetUrl);
        return fetch(`${parsed.origin}/`, { method: 'GET', signal: controller.signal });
      });

      clearTimeout(timeoutId);

      if (resp && (resp.ok || resp.status === 404 || resp.status === 405 || resp.status === 200)) {
        updateConnectionStatus('connected');
        return { success: true, message: `Connected to local server (${targetUrl})` };
      } else {
        updateConnectionStatus('disconnected');
        return { success: false, message: `Server reachable but returned code ${resp ? resp.status : 'ERR'}` };
      }
    } catch (err) {
      updateConnectionStatus('disconnected');
      return {
        success: false,
        message: `No server responding at ${targetUrl}. Start your local backend (FastAPI/llama.cpp/vLLM) on 127.0.0.1:8000.`,
      };
    }
  }

  // --- Input & Auto-growing Textarea ---
  function adjustTextareaHeight() {
    el.chatInput.style.height = 'auto';
    el.chatInput.style.height = Math.min(el.chatInput.scrollHeight, 200) + 'px';
    el.sendBtn.disabled = el.chatInput.value.trim().length === 0 || state.isGenerating;
  }

  // --- Theme Handling ---
  function applyTheme(theme) {
    state.settings.theme = theme;
    let effective = theme;
    if (theme === 'system') {
      effective = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    document.documentElement.setAttribute('data-theme', effective);

    // Update settings modal theme radio buttons
    document.querySelectorAll('.theme-option-btn').forEach(btn => {
      const val = btn.dataset.themeVal;
      btn.setAttribute('aria-checked', val === theme ? 'true' : 'false');
    });

    saveSettingsToStorage();
  }

  function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    applyTheme(next);
  }

  // --- Modals Management ---
  function openSettingsModal() {
    el.settingModelName.value = state.settings.modelName;
    el.settingBackendUrl.value = state.settings.backendUrl;
    el.settingSystemPrompt.value = state.settings.systemPrompt;
    el.settingStreamingToggle.checked = state.settings.streaming;
    el.settingTemperature.value = state.settings.temperature;
    el.temperatureValDisplay.textContent = state.settings.temperature;
    el.settingMaxTokens.value = state.settings.maxTokens;
    el.maxTokensValDisplay.textContent = state.settings.maxTokens;
    el.connectionTestResult.hidden = true;

    applyTheme(state.settings.theme);

    el.settingsModal.hidden = false;
    el.settingModelName.focus();
  }

  function closeSettingsModal() {
    el.settingsModal.hidden = true;
  }

  function saveSettingsFromModal() {
    state.settings.modelName = el.settingModelName.value.trim() || DEFAULT_SETTINGS.modelName;
    state.settings.backendUrl = el.settingBackendUrl.value.trim() || DEFAULT_SETTINGS.backendUrl;
    state.settings.systemPrompt = el.settingSystemPrompt.value.trim();
    state.settings.streaming = el.settingStreamingToggle.checked;
    state.settings.temperature = parseFloat(el.settingTemperature.value);
    state.settings.maxTokens = parseInt(el.settingMaxTokens.value, 10);

    saveSettingsToStorage();
    renderActiveChat();
    el.footerEndpointDisplay.textContent = state.settings.backendUrl;
    closeSettingsModal();
    showToast('Settings saved');
  }

  function openConnectionModal() {
    el.connModalUrlText.textContent = state.settings.backendUrl;
    el.connModalPingFeedback.hidden = true;
    el.connectionModal.hidden = false;
    updateConnectionStatus(state.connectionStatus);
  }

  function closeConnectionModal() {
    el.connectionModal.hidden = true;
  }

  function openRenameModal(chatId, currentTitle) {
    el.renameInput.value = currentTitle;
    el.renameModal.dataset.chatId = chatId;
    el.renameModal.hidden = false;
    el.renameInput.focus();
    el.renameInput.select();
  }

  function closeRenameModal() {
    el.renameModal.hidden = true;
  }

  function openConfirmModal(title, desc, onConfirm) {
    document.getElementById('confirm-dialog-title').textContent = title;
    el.confirmDesc.textContent = desc;
    state.confirmActionCallback = onConfirm;
    el.confirmModal.hidden = false;
    el.actionConfirmBtn.focus();
  }

  function closeConfirmModal() {
    el.confirmModal.hidden = true;
    state.confirmActionCallback = null;
  }

  // --- Mobile Sidebar Controls ---
  function openMobileSidebar() {
    el.sidebar.classList.add('mobile-open');
    el.sidebarBackdrop.classList.add('active');
  }

  function closeMobileSidebar() {
    el.sidebar.classList.remove('mobile-open');
    el.sidebarBackdrop.classList.remove('active');
  }

  function toggleDesktopSidebar() {
    el.appContainer.classList.toggle('sidebar-collapsed');
    const isCollapsed = el.appContainer.classList.contains('sidebar-collapsed');
    el.expandSidebarBtn.hidden = !isCollapsed;
  }

  // --- Export Functionality ---
  function exportCurrentChatAsMarkdown() {
    const chat = getActiveChat();
    if (!chat || chat.messages.length === 0) {
      showToast('No messages to export');
      return;
    }

    let md = `# ${chat.title}\n`;
    md += `Model: ${state.settings.modelName}\n`;
    md += `Date: ${new Date(chat.createdAt).toLocaleString()}\n\n---\n\n`;

    chat.messages.forEach(msg => {
      const sender = msg.role === 'user' ? 'User' : state.settings.modelName;
      md += `### ${sender} (${formatTime(msg.timestamp)})\n\n${msg.content}\n\n`;
    });

    downloadFile(md, `${chat.title.replace(/[^a-zA-Z0-9_-]/g, '_')}.md`, 'text/markdown');
    showToast('Conversation exported as Markdown');
  }

  function exportAllDataAsJSON() {
    const data = {
      exportDate: new Date().toISOString(),
      model: state.settings.modelName,
      settings: state.settings,
      chats: state.chats,
    };
    downloadFile(JSON.stringify(data, null, 2), 'local_ai_chats_backup.json', 'application/json');
    showToast('All conversations exported');
  }

  function downloadFile(content, fileName, contentType) {
    const a = document.createElement('a');
    const file = new Blob([content], { type: contentType });
    a.href = URL.createObjectURL(file);
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // --- Event Listeners Setup ---
  function initEventListeners() {
    // Input & Auto-growing textarea
    el.chatInput.addEventListener('input', adjustTextareaHeight);
    el.chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSendMessage();
      }
    });

    el.chatForm.addEventListener('submit', (e) => {
      e.preventDefault();
      handleSendMessage();
    });

    el.stopGenBtn.addEventListener('click', stopGeneration);

    // New Chat
    el.newChatBtn.addEventListener('click', () => createNewChat(true));

    // Search Chats
    el.searchChatsInput.addEventListener('input', (e) => {
      state.searchQuery = e.target.value;
      el.searchClearBtn.hidden = state.searchQuery.length === 0;
      renderChatHistory();
    });

    el.searchClearBtn.addEventListener('click', () => {
      el.searchChatsInput.value = '';
      state.searchQuery = '';
      el.searchClearBtn.hidden = true;
      renderChatHistory();
      el.searchChatsInput.focus();
    });

    // Theme Toggle
    el.themeToggleBtn.addEventListener('click', toggleTheme);

    // Sidebar toggles
    el.collapseSidebarBtn.addEventListener('click', toggleDesktopSidebar);
    el.expandSidebarBtn.addEventListener('click', toggleDesktopSidebar);
    el.mobileMenuBtn.addEventListener('click', openMobileSidebar);
    el.mobileCloseSidebarBtn.addEventListener('click', closeMobileSidebar);
    el.sidebarBackdrop.addEventListener('click', closeMobileSidebar);

    // Header Actions
    el.exportChatBtn.addEventListener('click', exportCurrentChatAsMarkdown);
    el.clearChatBtn.addEventListener('click', () => {
      const chat = getActiveChat();
      if (!chat || chat.messages.length === 0) return;
      openConfirmModal(
        'Clear conversation?',
        'All messages in this conversation will be erased.',
        clearActiveChatMessages
      );
    });

    el.renameCurrentBtn.addEventListener('click', () => {
      const chat = getActiveChat();
      if (chat) openRenameModal(chat.id, chat.title);
    });
    el.activeChatTitle.addEventListener('click', () => {
      const chat = getActiveChat();
      if (chat) openRenameModal(chat.id, chat.title);
    });

    // Modals Triggers
    el.openSettingsBtn.addEventListener('click', openSettingsModal);
    el.headerSettingsBtn.addEventListener('click', openSettingsModal);
    el.calloutSettingsBtn.addEventListener('click', openSettingsModal);
    el.connModalSettingsBtn.addEventListener('click', () => {
      closeConnectionModal();
      openSettingsModal();
    });

    el.headerStatusBtn.addEventListener('click', openConnectionModal);
    el.footerConnectionBtn.addEventListener('click', openConnectionModal);
    el.calloutCheckBtn.addEventListener('click', openConnectionModal);

    // Settings Modal Events
    el.closeSettingsBtn.addEventListener('click', closeSettingsModal);
    el.saveSettingsBtn.addEventListener('click', saveSettingsFromModal);
    el.resetSettingsBtn.addEventListener('click', () => {
      state.settings = { ...DEFAULT_SETTINGS };
      saveSettingsToStorage();
      openSettingsModal();
      showToast('Settings reset to defaults');
    });

    el.settingTemperature.addEventListener('input', (e) => {
      el.temperatureValDisplay.textContent = e.target.value;
    });

    el.settingMaxTokens.addEventListener('input', (e) => {
      el.maxTokensValDisplay.textContent = e.target.value;
    });

    document.querySelectorAll('.theme-option-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        applyTheme(btn.dataset.themeVal);
      });
    });

    el.testConnectionBtn.addEventListener('click', async () => {
      el.connectionTestResult.hidden = false;
      el.connectionTestResult.className = 'connection-test-result';
      el.connectionTestResult.textContent = 'Testing connection...';
      const res = await testBackendPing(el.settingBackendUrl.value.trim());
      el.connectionTestResult.className = `connection-test-result ${res.success ? 'feedback-success' : 'feedback-error'}`;
      el.connectionTestResult.textContent = res.message;
    });

    el.exportAllDataBtn.addEventListener('click', exportAllDataAsJSON);
    el.clearAllDataBtn.addEventListener('click', () => {
      openConfirmModal(
        'Clear all conversations?',
        'All your chat history stored locally will be permanently deleted.',
        clearAllChats
      );
    });

    // Connection Modal Events
    el.closeConnModalBtn.addEventListener('click', closeConnectionModal);
    el.connModalPingBtn.addEventListener('click', async () => {
      el.connModalPingFeedback.hidden = false;
      el.connModalPingFeedback.className = 'connection-ping-status';
      el.connModalPingFeedback.textContent = 'Testing backend...';
      const res = await testBackendPing(state.settings.backendUrl);
      el.connModalPingFeedback.className = `connection-ping-status ${res.success ? 'feedback-success' : 'feedback-error'}`;
      el.connModalPingFeedback.textContent = res.message;
    });

    // Rename Modal Events
    el.closeRenameBtn.addEventListener('click', closeRenameModal);
    el.cancelRenameBtn.addEventListener('click', closeRenameModal);
    el.saveRenameBtn.addEventListener('click', () => {
      const chatId = el.renameModal.dataset.chatId;
      renameChat(chatId, el.renameInput.value);
      closeRenameModal();
    });
    el.renameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const chatId = el.renameModal.dataset.chatId;
        renameChat(chatId, el.renameInput.value);
        closeRenameModal();
      }
    });

    // Confirm Modal Events
    el.closeConfirmBtn.addEventListener('click', closeConfirmModal);
    el.cancelConfirmBtn.addEventListener('click', closeConfirmModal);
    el.actionConfirmBtn.addEventListener('click', () => {
      if (typeof state.confirmActionCallback === 'function') {
        state.confirmActionCallback();
      }
      closeConfirmModal();
    });

    // Global Keyboard Shortcuts
    window.addEventListener('keydown', (e) => {
      // Ctrl+N -> New Chat
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        createNewChat(true);
      }
      // Ctrl+[ -> Toggle Sidebar
      if ((e.ctrlKey || e.metaKey) && e.key === '[') {
        e.preventDefault();
        toggleDesktopSidebar();
      }
      // Escape -> Close Modals
      if (e.key === 'Escape') {
        if (!el.settingsModal.hidden) closeSettingsModal();
        if (!el.connectionModal.hidden) closeConnectionModal();
        if (!el.renameModal.hidden) closeRenameModal();
        if (!el.confirmModal.hidden) closeConfirmModal();
        if (el.sidebar.classList.contains('mobile-open')) closeMobileSidebar();
      }
    });

    // Starter Prompt Cards Click
    document.querySelectorAll('.starter-prompt-card').forEach(card => {
      card.addEventListener('click', () => {
        const prompt = card.dataset.prompt;
        if (prompt) {
          el.chatInput.value = prompt;
          adjustTextareaHeight();
          handleSendMessage();
        }
      });
    });

    // Code copy event delegation
    document.addEventListener('click', (e) => {
      const copyBtn = e.target.closest('.copy-code-btn');
      if (copyBtn) {
        const code = decodeURIComponent(copyBtn.dataset.code || '');
        navigator.clipboard.writeText(code).then(() => {
          const originalText = copyBtn.querySelector('span').textContent;
          copyBtn.querySelector('span').textContent = 'Copied!';
          setTimeout(() => {
            copyBtn.querySelector('span').textContent = originalText;
          }, 1500);
        });
      }
    });

    // Scroll to bottom floater detection
    el.messagesViewport.addEventListener('scroll', () => {
      const distanceFromBottom = el.messagesViewport.scrollHeight - el.messagesViewport.scrollTop - el.messagesViewport.clientHeight;
      el.scrollBottomBtn.hidden = distanceFromBottom < 150;
    });

    el.scrollBottomBtn.addEventListener('click', () => {
      scrollToBottom();
      el.scrollBottomBtn.hidden = true;
    });
  }

  // --- Initializer ---
  function init() {
    cacheDOMElements();
    loadFromStorage();
    applyTheme(state.settings.theme);
    initEventListeners();
    renderChatHistory();
    renderActiveChat();
    updateConnectionStatus('disconnected');

    // Run a quiet probe for the local backend
    testBackendPing(state.settings.backendUrl);
  }

  // Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
