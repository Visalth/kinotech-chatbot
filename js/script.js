"use strict";

(() => {
  const API_BASE = "http://localhost:8000";
  const API_URL = `${API_BASE}/chat`;
  const MODELS_URL = `${API_BASE}/models`;
  const TITLE_URL = `${API_BASE}/title`;
  const STORAGE_CHATS = "kinotech_chats";
  const STORAGE_ACTIVE = "kinotech_active_chat";
  const STORAGE_LAST_MODEL = "kinotech_last_model";
  const TITLE_MAX_LEN = 32;

  const FALLBACK_MODELS = [
    { id: "openai/gpt-oss-120b", name: "Kinotech Pro", tagline: "Most capable. Best for general tasks." },
    { id: "qwen/qwen3-32b", name: "Kinotech Coder", tagline: "Best for code, math, reasoning." },
    { id: "llama-3.1-8b-instant", name: "Kinotech Lite", tagline: "Fastest. Lightweight responses." },
  ];

  let availableModels = FALLBACK_MODELS;
  let defaultModelId = FALLBACK_MODELS[0].id;

  const sidebar = document.querySelector(".sidebar");
  const sidebarExpandBtn = document.getElementById("sidebar-expand-btn");

  if (localStorage.getItem("kinotech_sidebar_expanded") === "true") {
    sidebar.classList.add("sidebar--expanded");
  }
  sidebarExpandBtn.addEventListener("click", () => {
    const expanded = sidebar.classList.toggle("sidebar--expanded");
    localStorage.setItem("kinotech_sidebar_expanded", expanded);
  });

  const form = document.querySelector(".composer__form");
  const input = document.querySelector(".composer__input");
  const sendBtn = document.querySelector(".composer__btn");
  const messagesList = document.querySelector(".chat__messages");
  const welcomeState = document.querySelector(".chat__welcome");
  const chatMain = document.querySelector(".chat__main");
  const suggestionCards = document.querySelectorAll(".pill-btn");
  const sidebarList = document.querySelector(".sidebar__list");
  const newChatBtn = document.querySelector(".sidebar__new-chat");
  const topbarTitle = document.querySelector(".chat__topbar-title");
  const pickers = document.querySelectorAll("[data-picker]");

  const ICON_SEND =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
  const ICON_STOP =
    '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';
  const ICON_MESSAGE =
    '<svg class="sidebar__link-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  const ICON_TRASH =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
  const ICON_COPY =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  const ICON_CHECK =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>';

  let chats = [];
  let activeChatId = null;
  let isWaiting = false;
  let activeStream = null;

  function loadState() {
    try {
      chats = JSON.parse(localStorage.getItem(STORAGE_CHATS) || "[]");
    } catch {
      chats = [];
    }
    activeChatId = localStorage.getItem(STORAGE_ACTIVE);
  }

  function saveState() {
    localStorage.setItem(STORAGE_CHATS, JSON.stringify(chats));
    if (activeChatId) localStorage.setItem(STORAGE_ACTIVE, activeChatId);
    else localStorage.removeItem(STORAGE_ACTIVE);
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function getActiveChat() {
    return chats.find((c) => c.id === activeChatId) || null;
  }

  function createChat() {
    const lastModel = localStorage.getItem(STORAGE_LAST_MODEL);
    const initialModel =
      lastModel && availableModels.some((m) => m.id === lastModel) ? lastModel : defaultModelId;
    const chat = {
      id: uid(),
      title: "New chat",
      createdAt: Date.now(),
      messages: [],
      model: initialModel,
    };
    chats.unshift(chat);
    activeChatId = chat.id;
    saveState();
    return chat;
  }

  function deleteChat(id) {
    chats = chats.filter((c) => c.id !== id);
    if (activeChatId === id) activeChatId = chats[0]?.id || null;
    if (chats.length === 0) createChat();
    else saveState();
  }

  function setActiveChat(id) {
    if (activeChatId === id) return;
    activeChatId = id;
    saveState();
    renderSidebar();
    renderActiveChat();
  }

  function deriveTitle(text) {
    const oneLine = text.replace(/\s+/g, " ").trim();
    return oneLine.length > TITLE_MAX_LEN ? oneLine.slice(0, TITLE_MAX_LEN) + "…" : oneLine;
  }

  function renderSidebar() {
    sidebarList.innerHTML = "";
    chats.forEach((chat) => {
      const li = document.createElement("li");
      li.className = "sidebar__item" + (chat.id === activeChatId ? " sidebar__item--active" : "");

      const link = document.createElement("a");
      link.href = "#";
      link.className = "sidebar__link";

      const iconWrap = document.createElement("span");
      iconWrap.innerHTML = ICON_MESSAGE;
      link.appendChild(iconWrap.firstElementChild);

      const text = document.createElement("span");
      text.className = "sidebar__link-text";
      text.textContent = chat.title;
      link.appendChild(text);

      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "sidebar__delete";
      deleteBtn.setAttribute("aria-label", "Delete chat");
      const trashWrap = document.createElement("span");
      trashWrap.innerHTML = ICON_TRASH;
      deleteBtn.appendChild(trashWrap.firstElementChild);
      link.appendChild(deleteBtn);

      link.setAttribute("title", chat.title);
      link.addEventListener("click", (e) => {
        e.preventDefault();
        if (isWaiting) abortStream(true);
        setActiveChat(chat.id);
      });

      deleteBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!confirm(`Delete "${chat.title}"?`)) return;
        if (isWaiting && chat.id === activeChatId) abortStream(true);
        deleteChat(chat.id);
        renderSidebar();
        renderActiveChat();
      });

      li.appendChild(link);
      sidebarList.appendChild(li);
    });
  }

  function renderActiveChat() {
    const chat = getActiveChat();
    messagesList.innerHTML = "";
    updatePickerLabels();
    renderPickerMenus();

    if (!chat || chat.messages.length === 0) {
      welcomeState.classList.remove("u-hidden");
      messagesList.classList.add("u-hidden");
      topbarTitle.textContent = "New chat";
      return;
    }

    welcomeState.classList.add("u-hidden");
    messagesList.classList.remove("u-hidden");
    topbarTitle.textContent = chat.title;

    chat.messages.forEach((m) => {
      if (m.role === "user") {
        appendUserMessage(m.content);
      } else if (m.role === "meta") {
        appendMetaMessage(m);
      } else {
        const el = appendBotMessage();
        renderBotContent(el.querySelector(".message__text"), m.content);
      }
    });
    scrollToBottom();
  }

  function getActiveChatModelId() {
    const chat = getActiveChat();
    const id = chat?.model;
    if (id && availableModels.some((m) => m.id === id)) return id;
    return defaultModelId;
  }

  function getModelMeta(id) {
    return availableModels.find((m) => m.id === id) || availableModels[0];
  }

  async function generateTitle(chat) {
    const userMsg = chat.messages.find((m) => m.role === "user");
    const asstMsg = chat.messages.find((m) => m.role === "assistant");
    if (!userMsg || !asstMsg) return;
    try {
      const res = await fetch(TITLE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user: userMsg.content, assistant: asstMsg.content }),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (!data.title) return;
      chat.title = data.title;
      saveState();
      renderSidebar();
      if (getActiveChat()?.id === chat.id) topbarTitle.textContent = chat.title;
    } catch {}
  }

  async function fetchModels() {
    try {
      const res = await fetch(MODELS_URL);
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.models) && data.models.length > 0) {
        availableModels = data.models;
        if (data.default) defaultModelId = data.default;
      }
    } catch {}
  }

  function updatePickerLabels() {
    const meta = getModelMeta(getActiveChatModelId());
    pickers.forEach((picker) => {
      const nameEl = picker.querySelector("[data-picker-name]");
      if (nameEl) nameEl.textContent = meta.name;
    });
  }

  function renderPickerMenus() {
    const currentId = getActiveChatModelId();
    pickers.forEach((picker) => {
      const menu = picker.querySelector("[data-picker-menu]");
      if (!menu) return;
      menu.innerHTML = "";
      availableModels.forEach((m) => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "model-picker__item" + (m.id === currentId ? " is-active" : "");
        item.setAttribute("role", "menuitem");

        const name = document.createElement("div");
        name.className = "model-picker__item-name";
        name.textContent = m.name;

        const tagline = document.createElement("div");
        tagline.className = "model-picker__item-tagline";
        tagline.textContent = m.tagline || "";

        item.append(name, tagline);
        item.addEventListener("click", (e) => {
          e.stopPropagation();
          selectModel(m.id);
        });
        menu.appendChild(item);
      });
    });
  }

  function selectModel(modelId) {
    const chat = getActiveChat() || createChat();
    if (chat.model === modelId) {
      closeAllPickers();
      return;
    }
    const prev = getModelMeta(chat.model);
    const next = getModelMeta(modelId);
    chat.model = modelId;
    localStorage.setItem(STORAGE_LAST_MODEL, modelId);

    if (chat.messages.length > 0) {
      chat.messages.push({
        role: "meta",
        kind: "model_switch",
        from: prev.name,
        to: next.name,
        timestamp: Date.now(),
      });
    }

    saveState();
    closeAllPickers();
    updatePickerLabels();
    renderPickerMenus();
    renderActiveChat();
  }

  function togglePicker(picker) {
    const trigger = picker.querySelector(".model-picker__trigger");
    const menu = picker.querySelector("[data-picker-menu]");
    const isOpen = trigger.getAttribute("aria-expanded") === "true";
    closeAllPickers();
    if (!isOpen) {
      trigger.setAttribute("aria-expanded", "true");
      menu.hidden = false;
      picker.classList.add("model-picker--open");
    }
  }

  function closeAllPickers() {
    pickers.forEach((p) => {
      const trigger = p.querySelector(".model-picker__trigger");
      const menu = p.querySelector("[data-picker-menu]");
      trigger.setAttribute("aria-expanded", "false");
      if (menu) menu.hidden = true;
      p.classList.remove("model-picker--open");
    });
  }

  pickers.forEach((picker) => {
    const trigger = picker.querySelector(".model-picker__trigger");
    if (!trigger) return;
    trigger.addEventListener("click", (e) => {
      e.stopPropagation();
      togglePicker(picker);
    });
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest("[data-picker]")) closeAllPickers();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeAllPickers();
  });

  function appendUserMessage(text) {
    const li = document.createElement("li");
    li.className = "message message--user";
    const body = document.createElement("div");
    body.className = "message__text";
    body.textContent = text;
    li.appendChild(body);
    messagesList.appendChild(li);
    return li;
  }

  function appendBotMessage() {
    const li = document.createElement("li");
    li.className = "message message--bot";
    const avatar = document.createElement("div");
    avatar.className = "message__avatar";
    avatar.textContent = "K";
    const body = document.createElement("div");
    body.className = "message__text";
    li.append(avatar, body);
    messagesList.appendChild(li);
    return li;
  }

  function appendMetaMessage(meta) {
    const li = document.createElement("li");
    li.className = "message message--meta";
    const text = document.createElement("span");
    text.className = "message__meta-text";
    if (meta.kind === "model_switch") {
      text.textContent = `Switched from ${meta.from} to ${meta.to}`;
    } else {
      text.textContent = meta.text || "";
    }
    li.appendChild(text);
    messagesList.appendChild(li);
    return li;
  }

  function appendTypingIndicator() {
    const li = document.createElement("li");
    li.className = "message message--bot message--typing";
    const avatar = document.createElement("div");
    avatar.className = "message__avatar";
    avatar.textContent = "K";
    const body = document.createElement("div");
    body.className = "message__text";
    const dots = document.createElement("span");
    dots.className = "typing-dots";
    for (let i = 0; i < 3; i++) {
      const dot = document.createElement("span");
      dot.className = "typing-dots__dot";
      dots.appendChild(dot);
    }
    body.appendChild(dots);
    li.append(avatar, body);
    messagesList.appendChild(li);
    scrollToBottom();
    return li;
  }

  function scrollToBottom() {
    chatMain.scrollTop = chatMain.scrollHeight;
  }

  function stripThinkBlocks(text) {
    let result = text.replace(/<think>[\s\S]*?<\/think>\s*/g, "");
    const openIdx = result.lastIndexOf("<think>");
    if (openIdx !== -1) result = result.slice(0, openIdx);
    return result;
  }

  function renderBotContent(element, text, opts) {
    const highlight = !opts || opts.highlight !== false;

    if (typeof window.marked === "undefined" || typeof window.DOMPurify === "undefined") {
      element.textContent = text;
      return;
    }

    const cleaned = stripThinkBlocks(text);
    const html = window.marked.parse(cleaned, { gfm: true, breaks: true });
    element.innerHTML = window.DOMPurify.sanitize(html);
    if (!highlight) return;

    if (typeof window.hljs !== "undefined") {
      element.querySelectorAll("pre code").forEach((codeEl) => {
        try { window.hljs.highlightElement(codeEl); } catch {}
      });
    }

    element.querySelectorAll("pre").forEach((pre) => {
      if (pre.querySelector(".code-copy")) return;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "code-copy";
      btn.setAttribute("aria-label", "Copy code");
      btn.innerHTML = ICON_COPY + "<span>Copy</span>";
      btn.addEventListener("click", () => copyCodeBlock(pre, btn));
      pre.appendChild(btn);
    });
  }

  function copyCodeBlock(pre, btn) {
    const code = pre.querySelector("code")?.innerText ?? "";
    navigator.clipboard.writeText(code).then(() => {
      btn.classList.add("is-copied");
      btn.innerHTML = ICON_CHECK + "<span>Copied</span>";
      setTimeout(() => {
        btn.classList.remove("is-copied");
        btn.innerHTML = ICON_COPY + "<span>Copy</span>";
      }, 1500);
    }).catch(() => {
      btn.innerHTML = ICON_COPY + "<span>Failed</span>";
    });
  }

  function setSendButtonMode(mode) {
    if (mode === "stop") {
      sendBtn.innerHTML = ICON_STOP;
      sendBtn.setAttribute("aria-label", "Stop generating");
      sendBtn.disabled = false;
    } else {
      sendBtn.innerHTML = ICON_SEND;
      sendBtn.setAttribute("aria-label", "Send message");
    }
  }

  function updateSendButton() {
    if (isWaiting) {
      sendBtn.disabled = false;
      return;
    }
    sendBtn.disabled = input.value.trim().length === 0;
  }

  function parseSSEEvent(block) {
    let event = null;
    const dataLines = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
    }
    if (!event) return null;
    return { event, data: dataLines.join("\n") };
  }

  async function streamFromBackend(messages, handlers) {
    const { onToken, onDone, onError, signal, model } = handlers;
    let response;
    try {
      response = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages, model }),
        signal,
      });
    } catch (err) {
      if (err.name === "AbortError") return;
      onError(getFriendlyError(err));
      return;
    }

    if (!response.ok || !response.body) {
      let detail = `Server returned ${response.status}`;
      try {
        const data = await response.json();
        if (data.detail) detail = data.detail;
      } catch {}
      onError(detail);
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let sepIndex;
        while ((sepIndex = buffer.indexOf("\n\n")) !== -1) {
          const block = buffer.slice(0, sepIndex);
          buffer = buffer.slice(sepIndex + 2);
          const parsed = parseSSEEvent(block);
          if (!parsed) continue;

          if (parsed.event === "token") {
            try {
              const data = JSON.parse(parsed.data);
              if (typeof data.text === "string") onToken(data.text);
            } catch {}
          } else if (parsed.event === "done") {
            onDone();
            return;
          } else if (parsed.event === "error") {
            let msg = "Unknown error";
            try {
              const data = JSON.parse(parsed.data);
              msg = data.message || msg;
            } catch {}
            onError(msg);
            return;
          }
        }
      }
      onDone();
    } catch (err) {
      if (err.name === "AbortError") return;
      onError(getFriendlyError(err));
    }
  }

  function getFriendlyError(err) {
    if (err instanceof TypeError && /fetch|network/i.test(err.message)) {
      return "I can't reach the backend. Make sure the Python server is running on http://localhost:8000.";
    }
    return err.message || String(err);
  }

  function abortStream(savePartial) {
    if (!activeStream || activeStream.savedOnAbort) return;
    const { controller, partial, chat, botEl } = activeStream;
    activeStream.savedOnAbort = true;

    controller.abort();

    if (savePartial && partial.length > 0) {
      chat.messages.push({ role: "assistant", content: partial });
      saveState();
    }

    if (botEl) {
      botEl.classList.remove("message--streaming");
      renderBotContent(botEl.querySelector(".message__text"), partial);
    }

    finalizeStream();
  }

  function finalizeStream() {
    activeStream = null;
    isWaiting = false;
    setSendButtonMode("send");
    updateSendButton();
    input.focus();
  }

  async function sendMessage(rawText) {
    const text = rawText.trim();
    if (!text || isWaiting) return;

    let chat = getActiveChat();
    if (!chat) chat = createChat();

    chat.messages.push({ role: "user", content: text });
    if (chat.title === "New chat" || !chat.title) chat.title = deriveTitle(text);
    saveState();
    renderSidebar();

    welcomeState.classList.add("u-hidden");
    messagesList.classList.remove("u-hidden");
    topbarTitle.textContent = chat.title;
    appendUserMessage(text);
    scrollToBottom();

    const typingEl = appendTypingIndicator();
    const controller = new AbortController();
    let botEl = null;
    let partial = "";

    isWaiting = true;
    setSendButtonMode("stop");

    activeStream = { controller, partial, chat, botEl: null, savedOnAbort: false };

    const apiMessages = chat.messages.filter((m) => m.role === "user" || m.role === "assistant");
    await streamFromBackend(apiMessages, {
      signal: controller.signal,
      model: chat.model || defaultModelId,
      onToken: (token) => {
        partial += token;
        activeStream.partial = partial;
        const visible = stripThinkBlocks(partial);
        if (!botEl) {
          if (visible.trim().length === 0) {
            scrollToBottom();
            return;
          }
          typingEl.remove();
          botEl = appendBotMessage();
          botEl.classList.add("message--streaming");
          activeStream.botEl = botEl;
        }
        renderBotContent(botEl.querySelector(".message__text"), partial, { highlight: false });
        scrollToBottom();
      },
      onDone: () => {
        if (activeStream && activeStream.savedOnAbort) return;
        if (botEl) {
          botEl.classList.remove("message--streaming");
          renderBotContent(botEl.querySelector(".message__text"), partial);
          chat.messages.push({ role: "assistant", content: partial });
          saveState();
          const userTurns = chat.messages.filter((m) => m.role === "user").length;
          if (userTurns === 1) generateTitle(chat);
        } else {
          typingEl.remove();
        }
        finalizeStream();
      },
      onError: (msg) => {
        if (activeStream && activeStream.savedOnAbort) return;
        if (typingEl.parentNode) typingEl.remove();
        if (!botEl) botEl = appendBotMessage();
        botEl.classList.remove("message--streaming");
        const body = botEl.querySelector(".message__text");
        if (partial.length > 0) {
          renderBotContent(body, partial);
          chat.messages.push({ role: "assistant", content: partial });
          saveState();
        }
        const notice = document.createElement("div");
        notice.className = "message__error";
        notice.textContent = msg;
        body.appendChild(notice);
        scrollToBottom();
        finalizeStream();
      },
    });
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (isWaiting) {
      abortStream(true);
      return;
    }
    const text = input.value;
    input.value = "";
    updateSendButton();
    sendMessage(text);
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      if (isWaiting) {
        e.preventDefault();
        return;
      }
      e.preventDefault();
      form.requestSubmit();
    }
  });

  input.addEventListener("input", updateSendButton);

  newChatBtn.addEventListener("click", () => {
    if (isWaiting) abortStream(true);
    const current = getActiveChat();
    if (current && current.messages.length === 0) {
      input.focus();
      return;
    }
    createChat();
    renderSidebar();
    renderActiveChat();
    input.focus();
  });

  suggestionCards.forEach((card) => {
    card.addEventListener("click", () => {
      if (isWaiting) return;
      const prompt =
        card.dataset.prompt ||
        card.querySelector(".suggestion-card__title")?.textContent?.trim() ||
        "";
      sendMessage(prompt);
    });
  });

  (async () => {
    await fetchModels();
    loadState();
    if (chats.length === 0) createChat();
    else if (!activeChatId || !getActiveChat()) {
      activeChatId = chats[0].id;
      saveState();
    }
    renderSidebar();
    renderActiveChat();
    setSendButtonMode("send");
    updateSendButton();
    input.focus();
  })();
})();
