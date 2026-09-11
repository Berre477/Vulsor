// ── Research — NotebookLM-style grounded Q&A powered by Claude ────────
// Depends on: globals.js (RESEARCH_FILE, researchData, ipcRenderer), vault.js (vaultData, VAULT_DIR)
// NOTE: ipcRenderer is already declared globally in globals.js — do NOT redeclare.

// ── Persistence ────────────────────────────────────────────────────────
function loadResearchData() {
    try {
        if (fs.existsSync(RESEARCH_FILE)) {
            const d = readJsonStrict(RESEARCH_FILE);
            return { notebooks: d.notebooks || [], apiKey: d.apiKey || '', model: d.model || 'claude-sonnet-4-5', backend: d.backend || 'api' };
        }
    } catch (_) {}
    return { notebooks: [], apiKey: '', model: 'claude-sonnet-4-5', backend: 'api' };
}
function saveResearchData() {
    try { writeJsonSafe(RESEARCH_FILE, researchData); }
    catch (e) { console.error('[research] save failed:', e); }
}

// ── State ─────────────────────────────────────────────────────────────
let researchActiveId  = null;  // currently open notebook id
let researchStreaming  = false; // Claude is currently streaming

function resId(p) { return p + Date.now() + Math.random().toString(36).slice(2,6); }
function resEsc(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function resNb()   { return researchData.notebooks.find(n => n.id === researchActiveId) || null; }

// ── Text extraction helpers ────────────────────────────────────────────
const MAX_SOURCE_CHARS = 80000;

async function resExtractText(file) {
    const storedPath = path.join(VAULT_DIR, file.storedName);
    const ext = (file.originalName.split('.').pop() || '').toLowerCase();
    try {
        if (ext === 'pdf') {
            return await resExtractPDF(storedPath);
        } else if (file.isDoc || ext === 'vulsor') {
            const html = fs.readFileSync(storedPath, 'utf8');
            return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_SOURCE_CHARS);
        } else if (['md','markdown','txt'].includes(ext)) {
            return fs.readFileSync(storedPath, 'utf8').slice(0, MAX_SOURCE_CHARS);
        } else if (ext === 'vnb') {
            const nb = JSON.parse(fs.readFileSync(storedPath, 'utf8'));
            return (nb.cells || []).map(c => c.source || '').join('\n\n').slice(0, MAX_SOURCE_CHARS);
        } else {
            // Try reading as text
            return fs.readFileSync(storedPath, 'utf8').slice(0, MAX_SOURCE_CHARS);
        }
    } catch (e) {
        return '';
    }
}

async function resExtractPDF(filePath) {
    if (typeof pdfjsLib === 'undefined') return '';
    let doc = null;
    let url; try { url = pathToFileURL(filePath).href; } catch (_) { url = `file://${filePath}`; }
    try {
        doc = await pdfjsLib.getDocument(url).promise;
        const pages = Math.min(doc.numPages, 80);
        let text = '';
        for (let i = 1; i <= pages; i++) {
            const page    = await doc.getPage(i);
            const content = await page.getTextContent();
            text += content.items.map(it => it.str).join(' ') + '\n';
            page.cleanup();
            if (text.length > MAX_SOURCE_CHARS) break;
        }
        return text.slice(0, MAX_SOURCE_CHARS);
    } catch (e) { return ''; }
    finally { if (doc) { try { await doc.destroy(); } catch (_) {} } }  // free worker/memory
}

// ── Claude streaming API ───────────────────────────────────────────────
function resCallClaude(system, messages, onChunk, onDone) {
    // Claude Code CLI backend (Pro/Max subscription, no API key) — non-streaming
    if ((researchData.backend || 'api') === 'cli') {
        const convo = messages.map(m => (m.role === 'user' ? 'User: ' : 'Assistant: ') + m.content).join('\n\n');
        const prompt = `${system}\n\n=== Conversation ===\n${convo}\n\nAssistant:`;
        const mdl = researchData.model || '';
        const alias = /opus/i.test(mdl) ? 'opus' : /haiku/i.test(mdl) ? 'haiku' : 'sonnet';
        ipcRenderer.invoke('claude-cli-chat', { prompt, model: alias }).then(r => {
            if (!r || !r.ok) { onDone(r && r.error || 'Claude Code call failed'); return; }
            onChunk(r.text || '(empty response)');
            onDone(null);
        }).catch(e => onDone(e.message));
        return;
    }
    const requestId = resId('req_');
    const handler   = (_, data) => {
        if (data.requestId !== requestId) return;
        if (data.error)  { onDone(data.error); ipcRenderer.removeListener('claude-chunk', handler); return; }
        if (data.text)   onChunk(data.text);
        if (data.done)   { onDone(null); ipcRenderer.removeListener('claude-chunk', handler); }
    };
    ipcRenderer.on('claude-chunk', handler);
    ipcRenderer.send('claude-chat', {
        requestId,
        apiKey:   researchData.apiKey,
        model:    researchData.model || 'claude-sonnet-4-5',
        system,
        messages,
    });
}

// Keep the whole prompt safely within the model context window.
// ~3.5 chars/token, target ≈ 110k tokens of sources → leaves room for the
// question, conversation, and the model's answer under a 200k window.
const RES_CONTEXT_BUDGET = 380000; // characters of source text

function resBuildSystemPrompt(notebook) {
    if (!notebook.sources.length) {
        return 'You are a helpful research assistant. No sources have been added yet — let the user know they need to add sources first.';
    }

    const sources = notebook.sources;
    const totalChars = sources.reduce((s, x) => s + ((x.content || '').length), 0);
    let truncated = false;
    // Per-source budget so every source is represented even with many large PDFs
    const perSource = totalChars > RES_CONTEXT_BUDGET
        ? Math.max(2000, Math.floor(RES_CONTEXT_BUDGET / sources.length))
        : Infinity;

    const srcXML = sources.map((s, i) => {
        let content = s.content || '(empty)';
        if (content.length > perSource) {
            content = content.slice(0, perSource) + '\n…[truncated — source longer than the per-document limit]';
            truncated = true;
        }
        return `<source id="${i+1}" name="${s.name.replace(/"/g,'&quot;')}">\n${content}\n</source>`;
    }).join('\n\n');

    const truncNote = truncated
        ? `\n\nNote: there are ${sources.length} sources and some were truncated to fit the context window. If you need a part of a document that seems cut off, tell the user which source to focus the notebook on.`
        : '';

    return `You are a research assistant grounded in the user's documents. Answer questions based ONLY on the provided sources. For every factual claim, cite the source using [Source Name] notation. If the answer isn't in the sources, say: "I couldn't find that in your sources."

<sources>
${srcXML}
</sources>

Guidelines:
- Be concise and accurate
- Always cite with [Source Name]
- If multiple sources support a point, cite all of them
- Never make up information not found in the sources${truncNote}

Formatting:
- Write your answer in Markdown (use headings, **bold**, bullet/numbered lists, tables, and \`code\` where helpful)
- Write ALL mathematics in LaTeX: inline math as $ ... $ and display equations as $$ ... $$
- Use proper LaTeX for symbols, fractions, matrices, integrals, etc. (e.g. $\\frac{a}{b}$, $\\int_0^1 x\\,dx$, matrices with \\begin{bmatrix}...\\end{bmatrix})`;
}

// ── Render helpers ─────────────────────────────────────────────────────
function resFileIcon(name, file) {
    const ext = (name.split('.').pop() || '').toLowerCase();
    if (file && file.isDoc)  return { icon: 'fa-file-alt',      color: '#f87171' };
    if (ext === 'pdf')       return { icon: 'fa-file-pdf',      color: '#f87171' };
    if (['md','markdown'].includes(ext)) return { icon: 'fa-file-alt', color: '#60a5fa' };
    if (ext === 'txt')       return { icon: 'fa-file-alt',      color: '#94a3b8' };
    if (ext === 'vnb')       return { icon: 'fa-book-open',     color: '#fb923c' };
    return { icon: 'fa-file', color: '#64748b' };
}

function resFormatSize(chars) {
    if (!chars) return '';
    if (chars < 1000) return chars + ' chars';
    return (chars / 1000).toFixed(1) + 'k chars';
}

// ── Render: sidebar notebook list ─────────────────────────────────────
function renderResearchSidebar() {
    const list = document.getElementById('research-notebook-list');
    if (!list) return;
    if (!researchData.notebooks.length) {
        list.innerHTML = `<p class="text-slate-600 text-xs text-center py-8 italic px-2">No notebooks yet.<br>Create one to get started.</p>`;
        return;
    }
    list.innerHTML = researchData.notebooks.map(nb => {
        const active = nb.id === researchActiveId;
        const srcCount = nb.sources.length;
        const lastMsg  = nb.chats.length ? nb.chats[nb.chats.length - 1] : null;
        const preview  = lastMsg ? lastMsg.content.replace(/\n/g,' ').slice(0, 55) : `${srcCount} source${srcCount !== 1 ? 's' : ''}`;
        return `<div class="res-nb-item rounded-xl px-3 py-2.5 cursor-pointer transition-colors ${active ? 'bg-violet-600/20 border border-violet-500/40' : 'hover:bg-slate-800/60 border border-transparent'}"
                    onclick="resOpenNotebook('${nb.id}')">
                <div class="text-slate-100 text-xs font-semibold truncate mb-0.5">${resEsc(nb.name)}</div>
                <div class="text-slate-500 text-[10px] truncate">${resEsc(preview)}</div>
            </div>`;
    }).join('');
}

// ── Render: main panel ─────────────────────────────────────────────────
function renderResearch() {
    renderResearchSidebar();
    const main = document.getElementById('research-main');
    if (!main) return;

    // API backend with no key → show setup prompt (CLI backend needs no key)
    const needsKey = (researchData.backend || 'api') === 'api' && !researchData.apiKey;
    if (needsKey) {
        main.innerHTML = `
            <div class="flex flex-col items-center justify-center h-full gap-5 text-center p-10">
                <div class="w-16 h-16 rounded-2xl flex items-center justify-center" style="background:rgba(139,92,246,0.15);border:1.5px solid rgba(139,92,246,0.3)">
                    <i class="fas fa-brain text-2xl" style="color:rgb(var(--tw-violet-500))"></i>
                </div>
                <div>
                    <h2 class="text-slate-100 text-xl font-bold mb-1">Research with Claude</h2>
                    <p class="text-slate-400 text-sm max-w-md">Add your documents as sources and ask Claude questions — every answer is grounded in your files with citations. Use an API key, or your Claude Code (Pro/Max) login.</p>
                </div>
                <button onclick="resShowKeyModal()" class="px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition-colors">
                    <i class="fas fa-plug mr-2"></i>Connect Claude
                </button>
            </div>`;
        return;
    }

    // No notebook selected
    if (!researchActiveId || !resNb()) {
        main.innerHTML = `
            <div class="flex flex-col items-center justify-center h-full gap-5 text-center p-10">
                <div class="w-14 h-14 rounded-2xl flex items-center justify-center" style="background:rgba(139,92,246,0.12);border:1.5px solid rgba(139,92,246,0.25)">
                    <i class="fas fa-book-open text-xl" style="color:rgb(var(--tw-violet-500))"></i>
                </div>
                <p class="text-slate-400 text-sm">Select a notebook or create a new one</p>
                <button onclick="resNewNotebook()" class="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold transition-colors">
                    <i class="fas fa-plus mr-1.5"></i>New Notebook
                </button>
            </div>`;
        return;
    }

    const nb = resNb();
    main.innerHTML = `
        <!-- Notebook header -->
        <div class="px-4 py-3 border-b border-slate-800/80 flex items-center gap-2 shrink-0 bg-slate-900/40">
            <button onclick="resToggleSidebar()" class="w-7 h-7 shrink-0 flex items-center justify-center rounded-lg text-slate-500 hover:text-white hover:bg-slate-800 transition-colors" title="Show/hide notebooks">
                <i class="fas fa-bars text-xs"></i>
            </button>
            <button onclick="resToggleSources()" class="w-7 h-7 shrink-0 flex items-center justify-center rounded-lg text-slate-500 hover:text-white hover:bg-slate-800 transition-colors" title="Show/hide sources">
                <i class="fas fa-folder text-xs"></i>
            </button>
            <input id="res-nb-title" type="text" value="${resEsc(nb.name)}"
                class="flex-1 bg-transparent text-slate-100 text-sm font-semibold outline-none border-b border-transparent focus:border-violet-500/50 transition-colors min-w-0"
                onblur="resRenameNotebook(this.value)" onkeydown="if(event.key==='Enter')this.blur()">
            <button onclick="resDeleteNotebook('${nb.id}')" class="text-slate-600 hover:text-red-400 transition-colors text-xs shrink-0" title="Delete notebook">
                <i class="fas fa-trash"></i>
            </button>
        </div>
        <!-- Two-panel: sources + chat -->
        <div class="flex flex-1 min-h-0 min-w-0 overflow-hidden">
            <!-- Sources panel -->
            <div id="res-sources-panel" class="flex flex-col border-r border-slate-800/80 shrink-0" style="width:250px">
                <div class="px-4 py-2.5 border-b border-slate-800/60 shrink-0 flex items-center justify-between">
                    <span class="text-[10px] uppercase tracking-widest font-semibold text-slate-400">Sources <span class="text-slate-600">${nb.sources.length}</span></span>
                </div>
                <div class="px-3 py-2 shrink-0 flex flex-col gap-1.5">
                    <button onclick="resOpenVaultPicker()" class="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800 border border-slate-700/50 transition-colors">
                        <i class="fas fa-folder-open text-[10px] text-blue-400"></i> Add from Vault
                    </button>
                    <button onclick="resPasteSource()" class="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800 border border-slate-700/50 transition-colors">
                        <i class="fas fa-paste text-[10px] text-violet-400"></i> Paste text
                    </button>
                </div>
                <div id="res-sources-list" class="flex-1 overflow-y-auto chat-scroll px-2 pb-3 flex flex-col gap-1">
                    ${resRenderSourcesList(nb)}
                </div>
            </div>
            <!-- Chat panel -->
            <div class="flex flex-col flex-1 min-w-0">
                ${nb.sources.length ? `
                <!-- Studio toolbar -->
                <div class="px-4 py-2 border-b border-slate-800/60 shrink-0 flex items-center gap-1.5 flex-wrap bg-slate-900/30">
                    <span class="text-[10px] uppercase tracking-widest text-slate-500 font-semibold mr-1"><i class="fas fa-wand-magic-sparkles mr-1 text-violet-400"></i>Studio</span>
                    <button onclick="resStudio('summary')"  class="res-studio-chip">Summary</button>
                    <button onclick="resStudio('guide')"    class="res-studio-chip">Study Guide</button>
                    <button onclick="resStudio('faq')"      class="res-studio-chip">FAQ</button>
                    <button onclick="resStudio('timeline')" class="res-studio-chip">Timeline</button>
                    <button onclick="resStudio('briefing')" class="res-studio-chip">Briefing</button>
                    <button onclick="resGenerateAudio()" class="res-studio-chip res-studio-audio"><i class="fas fa-headphones text-[9px] mr-1"></i>Audio Overview</button>
                </div>` : ''}
                <!-- Messages -->
                <div id="res-chat-messages" class="flex-1 overflow-y-auto chat-scroll p-5 flex flex-col gap-4">
                    ${resRenderMessages(nb)}
                </div>
                <!-- Input -->
                <div class="border-t border-slate-800/80 p-4 shrink-0">
                    ${!nb.sources.length ? `<p class="text-slate-600 text-xs text-center py-2">Add at least one source before asking questions.</p>` : `
                    <div class="flex items-end gap-2">
                        <textarea id="res-chat-input" placeholder="Ask a question about your sources…" rows="2"
                            class="flex-1 bg-slate-800/80 text-slate-100 text-sm border border-slate-700/60 rounded-xl px-4 py-2.5 outline-none focus:border-violet-600/60 resize-none chat-scroll leading-relaxed"
                            style="color-scheme:dark"
                            onkeydown="if((event.metaKey||event.ctrlKey)&&event.key==='Enter'){event.preventDefault();resSendMessage();}"></textarea>
                        <button onclick="resSendMessage()" id="res-send-btn"
                            class="w-10 h-10 shrink-0 rounded-xl flex items-center justify-center transition-colors text-white"
                            style="background:rgb(var(--tw-violet-600))">
                            <i class="fas fa-paper-plane text-xs"></i>
                        </button>
                    </div>
                    <p class="text-slate-700 text-[10px] mt-1.5 text-right">⌘↵ to send</p>`}
                </div>
            </div>
        </div>`;
    resScrollChat();
}

function resRenderSourcesList(nb) {
    if (!nb.sources.length) return `<p class="text-slate-600 text-[11px] italic px-2 py-3">No sources yet. Add files from your Vault or paste text.</p>`;
    return nb.sources.map(s => {
        const { icon, color } = resFileIcon(s.name, null);
        const size = resFormatSize(s.content ? s.content.length : 0);
        const statusIcon = s.content ? '' : `<i class="fas fa-circle-notch fa-spin text-[8px] text-violet-400"></i>`;
        return `<div class="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-800/60 group">
            <i class="fas ${icon} text-[11px] shrink-0" style="color:${color}"></i>
            <div class="min-w-0 flex-1">
                <div class="text-slate-200 text-xs truncate">${resEsc(s.name)}</div>
                <div class="text-slate-600 text-[10px] flex items-center gap-1">${size} ${statusIcon}</div>
            </div>
            <button onclick="resDeleteSource('${s.id}')" class="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400 transition-all text-[10px] shrink-0"><i class="fas fa-times"></i></button>
        </div>`;
    }).join('');
}

function resRenderMessages(nb) {
    if (!nb.chats.length) {
        return `<div class="flex flex-col items-center justify-center h-full gap-3 text-center opacity-50">
            <i class="fas fa-comments text-2xl text-slate-600"></i>
            <p class="text-slate-500 text-xs">Ask a question to get started.<br>Claude will answer using your sources.</p>
        </div>`;
    }
    return nb.chats.map(m => {
        const isUser = m.role === 'user';
        if (isUser) {
            return `<div class="flex justify-end">
                <div class="bg-violet-600/20 border border-violet-500/30 text-slate-100 text-sm px-4 py-2.5 rounded-2xl rounded-tr-sm max-w-[80%] leading-relaxed" style="overflow-wrap:anywhere">${resEsc(m.content)}</div>
            </div>`;
        }
        // Assistant — full Markdown + LaTeX
        const html = resRenderMarkdown(m.content);
        return `<div class="flex justify-start min-w-0">
            <div class="flex gap-3 max-w-[90%] min-w-0">
                <div class="w-7 h-7 rounded-lg shrink-0 flex items-center justify-center mt-0.5" style="background:rgba(139,92,246,0.2);border:1px solid rgba(139,92,246,0.3)">
                    <i class="fas fa-brain text-[10px]" style="color:rgb(var(--tw-violet-500))"></i>
                </div>
                <div class="res-md text-slate-200 text-sm leading-relaxed min-w-0" style="overflow-wrap:anywhere">${html}</div>
            </div>
        </div>`;
    }).join('');
}

// Lightweight live formatter used WHILE streaming (cheap, no KaTeX)
function resFormatResponse(text) {
    let s = resEsc(text);
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong class="text-slate-100">$1</strong>');
    s = s.replace(/\n\n/g, '</p><p class="mt-2">');
    s = s.replace(/\n/g, '<br>');
    return `<p>${s}</p>`;
}

// Full Markdown + LaTeX rendering for finished responses (reuses the Vault renderer)
function resRenderMarkdown(text) {
    if (typeof renderVaultMarkdown === 'function') {
        try { return renderVaultMarkdown(text); } catch (_) {}
    }
    return resFormatResponse(text);
}
// Fill in KaTeX math placeholders inside a container
function resRenderMathIn(container) {
    if (container && typeof vaultRenderMath === 'function') {
        try { vaultRenderMath(container); } catch (_) {}
    }
}

// Collapse / expand the notebook list sidebar and the sources panel
function resToggleSidebar() {
    const sb = document.getElementById('research-sidebar');
    if (sb) sb.style.display = (sb.style.display === 'none') ? '' : 'none';
}
function resToggleSources() {
    const sp = document.getElementById('res-sources-panel');
    if (sp) sp.style.display = (sp.style.display === 'none') ? '' : 'none';
}

function resScrollChat() {
    setTimeout(() => {
        const el = document.getElementById('res-chat-messages');
        if (el) { resRenderMathIn(el); el.scrollTop = el.scrollHeight; }
    }, 30);
}

// ── Notebook actions ───────────────────────────────────────────────────
function resNewNotebook() {
    if ((researchData.backend || 'api') === 'api' && !researchData.apiKey) { resShowKeyModal(); return; }
    const nb = {
        id: resId('nb_'), name: 'Untitled Notebook',
        createdAt: Date.now(), sources: [], chats: [],
    };
    researchData.notebooks.unshift(nb);
    saveResearchData();
    researchActiveId = nb.id;
    renderResearch();
    setTimeout(() => document.getElementById('res-nb-title')?.select(), 50);
}

function resOpenNotebook(id) {
    researchActiveId = id;
    renderResearch();
}

function resRenameNotebook(name) {
    const nb = resNb(); if (!nb) return;
    nb.name = name.trim() || 'Untitled Notebook';
    saveResearchData();
    renderResearchSidebar();
}

function resDeleteNotebook(id) {
    if (!confirm('Delete this notebook and all its sources and chats?')) return;
    researchData.notebooks = researchData.notebooks.filter(n => n.id !== id);
    if (researchActiveId === id) researchActiveId = researchData.notebooks[0]?.id || null;
    saveResearchData();
    renderResearch();
}

// ── Source actions ─────────────────────────────────────────────────────
function resDeleteSource(sourceId) {
    const nb = resNb(); if (!nb) return;
    nb.sources = nb.sources.filter(s => s.id !== sourceId);
    saveResearchData();
    renderResearch();
}

async function resAddVaultFile(vaultFileId, batch) {
    const nb = resNb(); if (!nb) return;
    if (nb.sources.find(s => s.vaultFileId === vaultFileId)) {
        if (!batch) resCloseVaultPicker();
        return;
    }
    const file = vaultData.files.find(f => f.id === vaultFileId);
    if (!file) return;

    const src = { id: resId('src_'), name: file.originalName, type: 'vault', vaultFileId, content: null };
    nb.sources.push(src);
    saveResearchData();
    if (!batch) {
        resCloseVaultPicker();
        renderResearch();
    } else {
        // Keep picker open; reflect "Added" state and update sources panel
        resRenderVaultList(document.getElementById('research-vault-search')?.value || '');
        const listEl = document.getElementById('res-sources-list');
        if (listEl) listEl.innerHTML = resRenderSourcesList(nb);
    }

    // Extract text async, then update sources panel
    const text = await resExtractText(file);
    src.content = text || '(could not extract text)';
    saveResearchData();
    const listEl = document.getElementById('res-sources-list');
    if (listEl) listEl.innerHTML = resRenderSourcesList(nb);
}

function resPasteSource() {
    const nb = resNb(); if (!nb) return;
    const modal = document.createElement('div');
    modal.className = 'settings-backdrop';
    modal.style.display = 'flex';
    modal.innerHTML = `
        <div class="bg-slate-900 border border-slate-700/60 rounded-2xl w-[500px] flex flex-col shadow-2xl overflow-hidden">
            <div class="px-5 py-4 border-b border-slate-800/80 flex items-center justify-between shrink-0">
                <h3 class="text-slate-100 text-sm font-semibold">Add text source</h3>
                <button onclick="this.closest('.settings-backdrop').remove()" class="text-slate-500 hover:text-white w-7 h-7 flex items-center justify-center rounded-lg hover:bg-slate-800 transition-colors"><i class="fas fa-times"></i></button>
            </div>
            <div class="p-5 flex flex-col gap-3">
                <input id="paste-src-name" type="text" placeholder="Source name (e.g. Meeting notes)" value=""
                    class="w-full bg-slate-800/80 text-slate-100 text-sm border border-slate-700/60 rounded-xl px-3 py-2 outline-none focus:border-violet-600/60" style="color-scheme:dark">
                <textarea id="paste-src-text" rows="8" placeholder="Paste your text here…"
                    class="w-full bg-slate-800/80 text-slate-100 text-sm border border-slate-700/60 rounded-xl px-3 py-2 outline-none focus:border-violet-600/60 resize-none chat-scroll" style="color-scheme:dark"></textarea>
                <button id="paste-src-save" class="py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition-colors">Add Source</button>
            </div>
        </div>`;
    document.body.appendChild(modal);
    modal.querySelector('#paste-src-save').onclick = () => {
        const name = modal.querySelector('#paste-src-name').value.trim() || 'Pasted text';
        const text = modal.querySelector('#paste-src-text').value.trim();
        if (!text) return;
        const src = { id: resId('src_'), name, type: 'paste', content: text.slice(0, MAX_SOURCE_CHARS) };
        nb.sources.push(src);
        saveResearchData();
        modal.remove();
        renderResearch();
    };
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
    setTimeout(() => modal.querySelector('#paste-src-name')?.focus(), 50);
}

// ── Vault picker (folder-aware) ─────────────────────────────────────────
let resVaultFolder = null;  // current folder id being browsed (null = root)

function resVaultFileSupported(f) {
    if (f.isMolecule || f.isPeriodic || f.isDna || f.isAnatomy || f.isChessStrategy || f.isPhysics || f.isGraph) return false;
    const ext = (f.originalName.split('.').pop() || '').toLowerCase();
    return f.isDoc || ['pdf','md','markdown','txt','vulsor','vnb'].includes(ext);
}

function resOpenVaultPicker() {
    const modal = document.getElementById('research-vault-picker');
    if (!modal) return;
    resVaultFolder = null;
    const search = document.getElementById('research-vault-search');
    if (search) search.value = '';
    modal.style.display = 'flex';
    resRenderVaultList('');
}

function resCloseVaultPicker() {
    const modal = document.getElementById('research-vault-picker');
    if (modal) modal.style.display = 'none';
}

function resVaultGoTo(folderId) {
    resVaultFolder = folderId || null;
    resRenderVaultList('');
}

// Breadcrumb path from root → current folder
function resVaultBreadcrumb() {
    const crumbs = [{ id: null, name: 'All Files' }];
    let cur = resVaultFolder;
    const chain = [];
    while (cur) {
        const f = (vaultData.folders || []).find(x => x.id === cur);
        if (!f) break;
        chain.unshift({ id: f.id, name: f.name });
        cur = f.parentId || null;
    }
    return crumbs.concat(chain);
}

function resRenderVaultList(query) {
    const listEl = document.getElementById('research-vault-list');
    if (!listEl) return;
    const nb = resNb();
    const addedIds = new Set((nb?.sources || []).filter(s => s.vaultFileId).map(s => s.vaultFileId));
    const q = (query || '').trim().toLowerCase();

    const fileRow = (f) => {
        const { icon, color } = resFileIcon(f.originalName, f);
        const added = addedIds.has(f.id);
        const size  = f.size ? (f.size > 1048576 ? (f.size/1048576).toFixed(1)+'MB' : (f.size/1024).toFixed(0)+'KB') : '';
        return `<div class="flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-colors ${added ? 'border-violet-500/40 bg-violet-600/10 opacity-50' : 'border-slate-700/50 hover:border-violet-500/40 hover:bg-violet-600/10 cursor-pointer'}"
                ${added ? '' : `onclick="resAddVaultFile('${f.id}')"`}>
            <i class="fas ${icon} text-sm shrink-0" style="color:${color}"></i>
            <div class="min-w-0 flex-1">
                <div class="text-slate-200 text-xs font-medium truncate">${resEsc(f.originalName)}</div>
                ${size ? `<div class="text-slate-600 text-[10px]">${size}</div>` : ''}
            </div>
            ${added ? `<span class="text-violet-400 text-[10px] font-semibold shrink-0">Added</span>` : `<i class="fas fa-plus text-[10px] text-slate-500 shrink-0"></i>`}
        </div>`;
    };

    // ── Search mode: flat results across the whole vault ──
    if (q) {
        const matches = (vaultData?.files || []).filter(f => resVaultFileSupported(f) && f.originalName.toLowerCase().includes(q));
        listEl.innerHTML = matches.length
            ? matches.map(fileRow).join('')
            : `<p class="text-slate-600 text-xs text-center py-8 italic">No matching files.</p>`;
        return;
    }

    // ── Browse mode: folders + files at the current level ──
    const folders = (vaultData?.folders || []).filter(fo => (fo.parentId || null) === resVaultFolder);
    const files   = (vaultData?.files   || []).filter(f => (f.folderId || null) === resVaultFolder && resVaultFileSupported(f));

    // Breadcrumb
    const crumbs = resVaultBreadcrumb();
    const breadcrumbHtml = `<div class="flex items-center gap-1 flex-wrap text-[11px] mb-2 px-1 sticky top-0 bg-slate-900 py-1 z-10">
        ${crumbs.map((c, i) => {
            const isLast = i === crumbs.length - 1;
            return `<span class="${isLast ? 'text-slate-300 font-medium' : 'text-violet-400 cursor-pointer hover:underline'}"
                ${isLast ? '' : `onclick="resVaultGoTo(${c.id ? `'${c.id}'` : 'null'})"`}>${resEsc(c.name)}</span>
                ${isLast ? '' : '<i class="fas fa-chevron-right text-[8px] text-slate-600 mx-0.5"></i>'}`;
        }).join('')}
    </div>`;

    // Count supported files inside a folder (recursive) for the "add all" hint
    const folderHtml = folders.map(fo => {
        const childCount = (vaultData.files || []).filter(f => (f.folderId || null) === fo.id && resVaultFileSupported(f)).length;
        return `<div class="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-slate-700/50 hover:border-slate-600/70 hover:bg-slate-800/50 cursor-pointer transition-colors"
                onclick="resVaultGoTo('${fo.id}')">
            <i class="fas fa-folder text-sm shrink-0" style="color:${fo.color || '#60a5fa'}"></i>
            <div class="min-w-0 flex-1">
                <div class="text-slate-200 text-xs font-medium truncate">${resEsc(fo.name)}</div>
                ${childCount ? `<div class="text-slate-600 text-[10px]">${childCount} file${childCount !== 1 ? 's' : ''}</div>` : ''}
            </div>
            <i class="fas fa-chevron-right text-[10px] text-slate-600 shrink-0"></i>
        </div>`;
    }).join('');

    const addAllHtml = files.length > 1
        ? `<button onclick="resAddAllInFolder()" class="w-full text-center py-1.5 mb-1 text-violet-400 hover:text-violet-300 text-[11px] font-medium">
              <i class="fas fa-layer-group mr-1"></i>Add all ${files.length} files in this folder
           </button>` : '';

    const filesHtml = files.map(fileRow).join('');

    if (!folders.length && !files.length) {
        listEl.innerHTML = breadcrumbHtml + `<p class="text-slate-600 text-xs text-center py-8 italic">This folder has no compatible files.</p>`;
        return;
    }
    listEl.innerHTML = breadcrumbHtml + folderHtml + addAllHtml + filesHtml;
}

async function resAddAllInFolder() {
    const files = (vaultData?.files || []).filter(f => (f.folderId || null) === resVaultFolder && resVaultFileSupported(f));
    for (const f of files) {
        await resAddVaultFile(f.id, true);
    }
    resRenderVaultList('');
}

// ── Chat ───────────────────────────────────────────────────────────────
function resSendMessage() {
    if (researchStreaming) return;
    const nb     = resNb(); if (!nb) return;
    const input  = document.getElementById('res-chat-input');
    const question = (input?.value || '').trim();
    if (!question) return;
    if (!nb.sources.length) return;
    if ((researchData.backend || 'api') === 'api' && !researchData.apiKey) { resShowKeyModal(); return; }

    // Add user message
    nb.chats.push({ role: 'user', content: question });
    if (input) input.value = '';
    saveResearchData();
    renderResearch();

    // Build Claude messages (last 20 turns for context)
    const history = nb.chats.slice(-20).map(m => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.content,
    }));

    // Placeholder assistant message for streaming
    const assistantMsg = { role: 'assistant', content: '' };
    nb.chats.push(assistantMsg);
    researchStreaming = true;
    const btn = document.getElementById('res-send-btn');
    if (btn) btn.innerHTML = '<i class="fas fa-circle-notch fa-spin text-xs"></i>';

    // Insert streaming bubble
    const messagesEl = document.getElementById('res-chat-messages');
    if (messagesEl) {
        const bubble = document.createElement('div');
        bubble.id = 'res-streaming-bubble';
        bubble.className = 'flex justify-start';
        bubble.innerHTML = `<div class="flex gap-3 max-w-[90%]">
            <div class="w-7 h-7 rounded-lg shrink-0 flex items-center justify-center mt-0.5" style="background:rgba(139,92,246,0.2);border:1px solid rgba(139,92,246,0.3)">
                <i class="fas fa-brain text-[10px]" style="color:rgb(var(--tw-violet-500))"></i>
            </div>
            <div id="res-streaming-text" class="text-slate-200 text-sm leading-relaxed"><span class="text-slate-500 text-xs italic">Thinking…</span></div>
        </div>`;
        messagesEl.appendChild(bubble);
        messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    const system = resBuildSystemPrompt(nb);
    resCallClaude(system, history, (chunk) => {
        assistantMsg.content += chunk;
        const textEl = document.getElementById('res-streaming-text');
        if (textEl) {
            textEl.innerHTML = resFormatResponse(assistantMsg.content);
            const msgs = document.getElementById('res-chat-messages');
            if (msgs) msgs.scrollTop = msgs.scrollHeight;
        }
    }, (err) => {
        researchStreaming = false;
        if (err) assistantMsg.content = `⚠️ Error: ${err}`;
        saveResearchData();
        renderResearch(); // full re-render to clean up
    });
}

// ── API Key modal ──────────────────────────────────────────────────────
function resShowKeyModal() {
    const modal = document.getElementById('research-key-modal');
    const input = document.getElementById('research-key-input');
    const sel   = document.getElementById('research-model-select');
    const bsel  = document.getElementById('research-backend-select');
    if (modal) modal.style.display = 'flex';
    if (input) input.value = researchData.apiKey || '';
    if (sel)   sel.value = researchData.model || 'claude-sonnet-4-5';
    if (bsel)  bsel.value = researchData.backend || 'api';
    resUpdateBackendUI();
}

function resUpdateBackendUI() {
    const bsel = document.getElementById('research-backend-select');
    const isCli = bsel && bsel.value === 'cli';
    const keyRow  = document.getElementById('research-key-row');
    const cliNote = document.getElementById('research-cli-note');
    if (keyRow)  keyRow.style.display  = isCli ? 'none' : '';
    if (cliNote) cliNote.style.display = isCli ? '' : 'none';
}

// ── Studio: generated documents ─────────────────────────────────────────
const RES_STUDIO_PROMPTS = {
    summary:  { title: 'Summary',     prompt: 'Write a clear, well-structured summary of the sources. Start with a 1-2 sentence overview, then the key points as organized sections.' },
    guide:    { title: 'Study Guide', prompt: 'Create a study guide: key concepts with definitions, the most important takeaways, and 5-8 review questions at the end (with brief answers).' },
    faq:      { title: 'FAQ',         prompt: 'Generate a FAQ of 10-15 question/answer pairs covering the most important points a learner would ask about these sources.' },
    timeline: { title: 'Timeline',    prompt: 'Create a chronological timeline of the key events, developments, or logical progression described in the sources. Use a dated/ordered list.' },
    briefing: { title: 'Briefing',    prompt: 'Write a concise executive briefing document: purpose, key findings, and recommended takeaways.' },
};

let _resOutputText = '';
function resStudio(kind) {
    const nb = resNb();
    if (!nb || !nb.sources.length) return;
    const spec = RES_STUDIO_PROMPTS[kind];
    if (!spec) return;
    resOpenOutputModal(spec.title);
    _resOutputText = '';
    const system = resBuildSystemPrompt(nb);
    resCallClaude(system, [{ role: 'user', content: spec.prompt + ' Use Markdown formatting, and LaTeX for any math ($ inline $, $$ display $$). Cite sources with [Source Name] where relevant.' }],
        (chunk) => { _resOutputText += chunk; resUpdateOutputBody(_resOutputText); },
        (err) => {
            if (err) { resUpdateOutputBody('⚠️ Error: ' + err); return; }
            resUpdateOutputBody(_resOutputText, true);  // final → full markdown + math
            resEnableOutputActions(spec.title, _resOutputText, nb.name);
        });
}

function resOpenOutputModal(title) {
    document.getElementById('res-output-modal')?.remove();
    const m = document.createElement('div');
    m.id = 'res-output-modal';
    m.className = 'settings-backdrop';
    m.style.display = 'flex';
    m.innerHTML = `
        <div class="bg-slate-900 border border-slate-700/60 rounded-2xl w-[660px] max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
            <div class="px-5 py-4 border-b border-slate-800/80 flex items-center justify-between shrink-0">
                <h3 class="text-slate-100 text-sm font-semibold flex items-center gap-2"><i class="fas fa-wand-magic-sparkles text-violet-400"></i>${resEsc(title)}</h3>
                <button onclick="document.getElementById('res-output-modal').remove()" class="text-slate-500 hover:text-white w-7 h-7 flex items-center justify-center rounded-lg hover:bg-slate-800 transition-colors"><i class="fas fa-times"></i></button>
            </div>
            <div id="res-output-body" class="p-5 overflow-y-auto chat-scroll text-slate-200 text-sm leading-relaxed flex-1"><span class="text-slate-500 italic text-xs"><i class="fas fa-circle-notch fa-spin mr-1"></i>Generating…</span></div>
            <div class="px-5 py-3 border-t border-slate-800/80 flex justify-end gap-2 shrink-0">
                <button id="res-output-copy" disabled class="px-4 py-2 rounded-xl bg-slate-800 text-slate-500 text-xs font-medium opacity-50">Copy</button>
                <button id="res-output-save" disabled class="px-4 py-2 rounded-xl bg-violet-600/50 text-white/60 text-xs font-semibold opacity-50">Save to Vault</button>
            </div>
        </div>`;
    document.body.appendChild(m);
    m.addEventListener('click', e => { if (e.target === m) m.remove(); });
}
function resUpdateOutputBody(text, final) {
    const el = document.getElementById('res-output-body');
    if (!el) return;
    if (final) { el.classList.add('res-md'); el.innerHTML = resRenderMarkdown(text); resRenderMathIn(el); }
    else { el.innerHTML = resFormatResponse(text); }
    el.scrollTop = el.scrollHeight;
}
function resEnableOutputActions(title, text, nbName) {
    const copyBtn = document.getElementById('res-output-copy');
    const saveBtn = document.getElementById('res-output-save');
    if (copyBtn) {
        copyBtn.disabled = false; copyBtn.classList.remove('opacity-50');
        copyBtn.className = 'px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors';
        copyBtn.onclick = () => { navigator.clipboard.writeText(text); copyBtn.textContent = 'Copied!'; setTimeout(() => copyBtn.textContent = 'Copy', 1200); };
    }
    if (saveBtn) {
        saveBtn.disabled = false; saveBtn.classList.remove('opacity-50');
        saveBtn.className = 'px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold transition-colors';
        saveBtn.onclick = () => {
            resSaveToVault(`${title} — ${nbName}`, text);
            saveBtn.textContent = 'Saved ✓'; setTimeout(() => saveBtn.textContent = 'Save to Vault', 1500);
        };
    }
}

// Save generated text into the Vault as a markdown file
function resSaveToVault(title, text) {
    try {
        const id = 'vf_' + Date.now() + '_' + Math.random().toString(36).slice(2,7);
        const storedName = id + '.md';
        const safeTitle = title.replace(/[\/\\:*?"<>|]/g, '-');
        fs.writeFileSync(path.join(VAULT_DIR, storedName), `# ${safeTitle}\n\n${text}`);
        const stats = fs.statSync(path.join(VAULT_DIR, storedName));
        vaultData.files.unshift({
            id, originalName: safeTitle + '.md', storedName,
            folderId: null, notes: '', pageNotes: {}, addedAt: Date.now(), size: stats.size,
        });
        if (typeof saveVaultData === 'function') saveVaultData();
        if (typeof renderVaultGrid === 'function') renderVaultGrid();
        if (typeof renderVaultFolders === 'function') renderVaultFolders();
    } catch (e) { console.error('[research] save to vault failed:', e); }
}

// ── Studio: Audio Overview ──────────────────────────────────────────────
let _resAudioEl = null;

function resGenerateAudio() {
    const nb = resNb();
    if (!nb || !nb.sources.length) return;
    resOpenAudioModal();
    resSetAudioStatus('<i class="fas fa-circle-notch fa-spin mr-1.5"></i>Writing the script…');
    const system = resBuildSystemPrompt(nb);
    const prompt = `Create a lively, conversational AUDIO OVERVIEW of these sources — a dialogue between two hosts who explain the material so a listener really understands it. Host A is a curious co-host who asks great questions; Host B is the knowledgeable expert. Aim for 10-18 exchanges, engaging and clear, covering the most important ideas.

Output ONLY the dialogue, one line per turn, in EXACTLY this format (no markdown, no names, no stage directions, no citations):
A: <line>
B: <line>
A: <line>
...`;
    let acc = '';
    resCallClaude(system, [{ role: 'user', content: prompt }],
        (chunk) => { acc += chunk; },
        async (err) => {
            if (err) { resSetAudioStatus('⚠️ ' + resEsc(err)); return; }
            const lines = resParseDialogue(acc);
            if (!lines.length) { resSetAudioStatus('⚠️ Could not parse the generated script.'); return; }
            resSetAudioStatus(`<i class="fas fa-circle-notch fa-spin mr-1.5"></i>Synthesizing ${lines.length} lines of audio…`);
            try {
                const r = await ipcRenderer.invoke('research-tts', { lines });
                if (!r || !r.ok) { resSetAudioStatus('⚠️ ' + resEsc(r && r.error || 'TTS failed')); return; }
                resStartAudioPlayer(lines, r.files);
            } catch (e) { resSetAudioStatus('⚠️ ' + resEsc(e.message)); }
        });
}

function resParseDialogue(text) {
    const out = [];
    text.split('\n').forEach(line => {
        const m = line.match(/^\s*([AB])\s*[:\-]\s*(.+)$/);
        if (m) out.push({ speaker: m[1], text: m[2].trim() });
    });
    return out;
}

function resOpenAudioModal() {
    document.getElementById('res-audio-modal')?.remove();
    const m = document.createElement('div');
    m.id = 'res-audio-modal';
    m.className = 'settings-backdrop';
    m.style.display = 'flex';
    m.innerHTML = `
        <div class="bg-slate-900 border border-slate-700/60 rounded-2xl w-[520px] flex flex-col shadow-2xl overflow-hidden">
            <div class="px-5 py-4 border-b border-slate-800/80 flex items-center justify-between shrink-0">
                <h3 class="text-slate-100 text-sm font-semibold flex items-center gap-2"><i class="fas fa-headphones text-violet-400"></i>Audio Overview</h3>
                <button onclick="resCloseAudioModal()" class="text-slate-500 hover:text-white w-7 h-7 flex items-center justify-center rounded-lg hover:bg-slate-800 transition-colors"><i class="fas fa-times"></i></button>
            </div>
            <div id="res-audio-body" class="p-6 flex flex-col items-center justify-center gap-4 min-h-[180px]">
                <div id="res-audio-status" class="text-slate-400 text-sm text-center"></div>
            </div>
        </div>`;
    document.body.appendChild(m);
    m.addEventListener('click', e => { if (e.target === m) resCloseAudioModal(); });
}
function resCloseAudioModal() {
    if (_resAudioEl) { try { _resAudioEl.pause(); } catch(_){} _resAudioEl = null; }
    document.getElementById('res-audio-modal')?.remove();
}
function resSetAudioStatus(html) {
    const el = document.getElementById('res-audio-status');
    if (el) el.innerHTML = html;
}

function resStartAudioPlayer(lines, files) {
    const body = document.getElementById('res-audio-body');
    if (!body) return;
    body.innerHTML = `
        <div class="w-full flex flex-col items-center gap-4">
            <div class="w-16 h-16 rounded-full flex items-center justify-center" style="background:rgba(139,92,246,0.15);border:1.5px solid rgba(139,92,246,0.35)">
                <i class="fas fa-headphones text-2xl" style="color:rgb(var(--tw-violet-500))"></i>
            </div>
            <div id="res-audio-speaker" class="text-[10px] uppercase tracking-widest font-semibold text-violet-400">Host A</div>
            <div id="res-audio-line" class="text-slate-300 text-sm text-center leading-relaxed min-h-[60px] px-2">${resEsc(lines[0].text)}</div>
            <div class="flex items-center gap-4">
                <button id="res-audio-restart" class="w-9 h-9 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-colors" title="Restart"><i class="fas fa-backward-step text-xs"></i></button>
                <button id="res-audio-play" class="w-12 h-12 rounded-full bg-violet-600 hover:bg-violet-500 text-white flex items-center justify-center transition-colors"><i class="fas fa-pause"></i></button>
                <span id="res-audio-progress" class="text-slate-500 text-xs tabular-nums w-14 text-center">1 / ${lines.length}</span>
            </div>
        </div>`;

    _resAudioEl = new Audio();
    let idx = 0;
    const updateUI = () => {
        document.getElementById('res-audio-speaker').textContent = lines[idx].speaker === 'B' ? 'Host B' : 'Host A';
        document.getElementById('res-audio-speaker').style.color = lines[idx].speaker === 'B' ? '#22d3ee' : '#a78bfa';
        document.getElementById('res-audio-line').textContent = lines[idx].text;
        document.getElementById('res-audio-progress').textContent = `${idx+1} / ${lines.length}`;
    };
    const playIdx = (i) => {
        idx = i;
        if (idx >= files.length) {
            const pb = document.getElementById('res-audio-play');
            if (pb) pb.innerHTML = '<i class="fas fa-rotate-right"></i>';
            document.getElementById('res-audio-speaker').textContent = 'Finished';
            return;
        }
        updateUI();
        _resAudioEl.src = 'file://' + files[idx].replace(/ /g, '%20');
        _resAudioEl.play().catch(()=>{});
    };
    _resAudioEl.addEventListener('ended', () => playIdx(idx + 1));
    const playBtn = document.getElementById('res-audio-play');
    playBtn.onclick = () => {
        if (idx >= files.length) { playIdx(0); playBtn.innerHTML = '<i class="fas fa-pause"></i>'; return; }
        if (_resAudioEl.paused) { _resAudioEl.play(); playBtn.innerHTML = '<i class="fas fa-pause"></i>'; }
        else { _resAudioEl.pause(); playBtn.innerHTML = '<i class="fas fa-play"></i>'; }
    };
    document.getElementById('res-audio-restart').onclick = () => { playIdx(0); playBtn.innerHTML = '<i class="fas fa-pause"></i>'; };
    playIdx(0);
}

// ── Init ───────────────────────────────────────────────────────────────
function initResearch() {
    researchData = loadResearchData();

    document.getElementById('research-new-btn')?.addEventListener('click', resNewNotebook);
    document.getElementById('research-apikey-btn')?.addEventListener('click', resShowKeyModal);

    // API key modal
    document.getElementById('research-key-modal-close')?.addEventListener('click', () => {
        document.getElementById('research-key-modal').style.display = 'none';
    });
    document.getElementById('research-backend-select')?.addEventListener('change', resUpdateBackendUI);

    document.getElementById('research-key-save')?.addEventListener('click', () => {
        const val  = document.getElementById('research-key-input').value.trim();
        const sel  = document.getElementById('research-model-select');
        const bsel = document.getElementById('research-backend-select');
        if (bsel) researchData.backend = bsel.value;
        if (sel)  researchData.model   = sel.value;
        if (val)  researchData.apiKey  = val;
        saveResearchData();
        document.getElementById('research-key-modal').style.display = 'none';
        renderResearch();
    });
    document.getElementById('research-key-modal')?.addEventListener('click', e => {
        if (e.target.id === 'research-key-modal') document.getElementById('research-key-modal').style.display = 'none';
    });

    // Vault picker
    document.getElementById('research-vault-picker-close')?.addEventListener('click', resCloseVaultPicker);
    document.getElementById('research-vault-picker')?.addEventListener('click', e => {
        if (e.target.id === 'research-vault-picker') resCloseVaultPicker();
    });
    document.getElementById('research-vault-search')?.addEventListener('input', e => {
        resRenderVaultList(e.target.value);
    });
}
