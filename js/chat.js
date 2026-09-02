// ── Chat Session Management ────────────────────────────────────
// Depends on: globals.js, ui.js (addMessageToUI)

// ── Chat Tabs ──────────────────────────────────────────────────
function renderChatTabs() {
    const strip = document.getElementById('chat-tab-strip');
    if (!strip) return;
    strip.innerHTML = chatTabs.map(tab => {
        const isActive = tab.tabId === activeChatTabId;
        return `<div class="chat-tab group flex items-center gap-1.5 px-3 py-1.5 border-r border-slate-800/60 cursor-pointer shrink-0 transition-colors max-w-[160px] ${
            isActive ? 'bg-slate-800/70 text-slate-200' : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800/40'
        }" data-tab-id="${tab.tabId}">
            <span class="text-xs truncate flex-1">${tab.title}</span>
            <button class="chat-tab-close w-4 h-4 flex items-center justify-center rounded hover:bg-slate-600 transition-colors opacity-0 group-hover:opacity-100 shrink-0" data-tab-id="${tab.tabId}">
                <i class="fas fa-times text-[8px]"></i>
            </button>
        </div>`;
    }).join('') + `<button id="chat-tab-new" class="w-8 h-full flex items-center justify-center text-slate-600 hover:text-slate-300 hover:bg-slate-800/40 transition-colors shrink-0 border-r border-slate-800/60" title="New chat">
        <i class="fas fa-plus text-[10px]"></i>
    </button>`;

    strip.querySelectorAll('.chat-tab').forEach(el => {
        el.onclick = e => {
            if (e.target.closest('.chat-tab-close')) return;
            switchChatTab(el.dataset.tabId);
        };
    });
    strip.querySelectorAll('.chat-tab-close').forEach(btn => {
        btn.onclick = e => { e.stopPropagation(); closeChatTab(btn.dataset.tabId); };
    });
    const newBtn = document.getElementById('chat-tab-new');
    if (newBtn) newBtn.onclick = startNewChat;
}

function saveCurrentTabState() {
    const tab = chatTabs.find(t => t.tabId === activeChatTabId);
    if (tab) { tab.history = chatHistory.slice(); tab.filePath = currentFilePath; tab.title = currentChatTitle; }
}

function switchChatTab(tabId) {
    saveCurrentTabState();
    const tab = chatTabs.find(t => t.tabId === tabId);
    if (!tab) return;
    activeChatTabId  = tabId;
    currentFilePath  = tab.filePath;
    currentChatTitle = tab.title;
    chatHistory      = tab.history.slice();
    chatBox.innerHTML = '';
    chatHistory.forEach(msg => {
        if (msg.role !== 'system')
            addMessageToUI(msg.role === 'user' ? 'You' : 'AI', msg.content, msg.imageDataUrl || null);
    });
    updateChatTitle(currentChatTitle);
    loadSessionList();
    renderChatTabs();
}

function closeChatTab(tabId) {
    const idx = chatTabs.findIndex(t => t.tabId === tabId);
    if (idx === -1) return;
    chatTabs.splice(idx, 1);
    if (activeChatTabId === tabId) {
        if (chatTabs.length) {
            const next = chatTabs[Math.min(idx, chatTabs.length - 1)];
            switchChatTab(next.tabId);
        } else {
            startNewChat();
            return;
        }
    }
    renderChatTabs();
}

function openOrCreateTab(title, filePath, history) {
    // If the file is already open in a tab, just switch to it
    if (filePath) {
        const existing = chatTabs.find(t => t.filePath === filePath);
        if (existing) { switchChatTab(existing.tabId); return; }
    }
    saveCurrentTabState();
    const tabId = 'ctab_' + Date.now();
    chatTabs.push({ tabId, title, filePath, history: history.slice() });
    activeChatTabId  = tabId;
    currentFilePath  = filePath;
    currentChatTitle = title;
    chatHistory      = history.slice();
    renderChatTabs();
    loadSessionList();
}

function loadSessionList() {
    sessionList.innerHTML = '';
    const files = fs.readdirSync(DOCUMENTS_PATH)
        .filter(f => f.endsWith('.json') && !NON_CHAT_FILES.has(f));
    files.sort((a, b) =>
        fs.statSync(path.join(DOCUMENTS_PATH, b)).mtime -
        fs.statSync(path.join(DOCUMENTS_PATH, a)).mtime
    );

    if (!files.length) {
        sessionList.innerHTML = `<p class="text-slate-600 text-xs text-center px-4 py-6">No sessions yet</p>`;
        return;
    }

    files.forEach(file => {
        const isActive = currentFilePath && currentFilePath.endsWith(file);
        const label    = file.replace('.json', '');
        const div      = document.createElement('div');
        div.className  = `flex items-center justify-between px-3 py-2 mb-1 rounded-lg cursor-pointer transition-all group ${
            isActive ? 'active-chat' : 'hover:bg-slate-800/70 text-slate-400'
        }`;
        div.innerHTML = `
            <span class="text-sm truncate flex-1 ${isActive ? 'text-white' : ''}">${label}</span>
            <button class="session-delete opacity-0 group-hover:opacity-100 w-6 h-6 flex items-center justify-center rounded hover:text-red-500 transition-all shrink-0">
                <i class="fas fa-trash text-[10px]"></i>
            </button>`;
        div.querySelector('.session-delete').onclick = (e) => {
            e.stopPropagation();
            if (confirm(`Delete "${label}"?`)) {
                fs.unlinkSync(path.join(DOCUMENTS_PATH, file));
                if (isActive) startNewChat();
                else loadSessionList();
            }
        };
        div.onclick = () => loadChat(file);
        sessionList.appendChild(div);
    });
}

function startNewChat() {
    const title   = 'New Chat';
    const history = [{ role: 'system', content: TUNING.system }];
    openOrCreateTab(title, null, history);
    chatBox.innerHTML = '';
    updateChatTitle(title);
    addMessageToUI('AI', 'Hello. How can I assist you today?');
}

function loadChat(filename) {
    const filePath = path.join(DOCUMENTS_PATH, filename);
    const title    = filename.replace('.json', '');
    const history  = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    openOrCreateTab(title, filePath, history);
    chatBox.innerHTML = '';
    chatHistory.forEach(msg => {
        if (msg.role !== 'system')
            addMessageToUI(msg.role === 'user' ? 'You' : 'AI', msg.content, msg.imageDataUrl || null);
    });
    updateChatTitle(title);
}

function saveChat() {
    if (!currentFilePath)
        currentFilePath = path.join(DOCUMENTS_PATH, `Chat_${Date.now()}.json`);
    fs.writeFileSync(currentFilePath, JSON.stringify(chatHistory, null, 2));
    loadSessionList();
}

function updateChatTitle(title) {
    const el = document.getElementById('chat-session-title');
    if (el) el.textContent = title;
}
