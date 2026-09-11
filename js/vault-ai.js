// ── Vault AI ───────────────────────────────────────────────────────
// Three features, all running on the same local Ollama model the chat uses:
//   1. "AI" panel in the viewer — ask about the file that is open right now
//   2. AI writing actions inside the document / markdown editors
//   3. "Ask Vault" — one question answered from every note you own, with sources
//
// Nothing here touches chatHistory: these are one-off calls with their own
// context, so asking about a PDF never pollutes the main conversation.
//
// Depends on: globals.js (fs, path, MODEL, VAULT_DIR, DOCUMENTS_PATH, vulsorPrompt)
//             vault.js   (vaultData, vaultOpenFileId, vaultExt, openVaultFile,
//                         renderVaultMarkdown, vaultRenderMath, _vaultShowMoveToast)

// ── Model plumbing ─────────────────────────────────────────────────
const VAULT_AI_URL     = 'http://localhost:11434/api/chat';
// Ollama defaults num_ctx to 2048, which silently truncates a document down to
// its first couple of pages. Everything here feeds real files to the model, so
// the window has to be raised explicitly or the answers quietly go wrong.
const VAULT_AI_NUM_CTX = 8192;
const VAULT_AI_OFFLINE = 'Cannot reach Ollama. Make sure it is running on localhost:11434.';

// Rough budget for how much file text we hand the model. ~4 chars per token,
// leaving room for the question, the system prompt and the reply.
const VAULT_AI_MAX_CONTEXT = 12000;

/**
 * One-off chat completion. Pass onToken to stream (the panel does), omit it to
 * get the whole string back at once (the editor actions do — they replace text
 * in one go, so a half-written result on screen would be worse, not better).
 */
async function _vaultAIChat(messages, opts = {}) {
    const { signal = null, temperature = 0.3, onToken = null } = opts;
    let res;
    try {
        res = await fetch(VAULT_AI_URL, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model:    MODEL,
                messages,
                stream:   !!onToken,
                options:  { temperature, num_ctx: VAULT_AI_NUM_CTX }
            }),
            signal
        });
    } catch (e) {
        if (e.name === 'AbortError') throw e;
        throw new Error(VAULT_AI_OFFLINE);
    }
    if (!res.ok) throw new Error(`Ollama returned ${res.status} — is the "${MODEL}" model pulled?`);

    if (!onToken) {
        const data = await res.json();
        return (data.message?.content || '').trim();
    }

    // Streaming replies come back as NDJSON — one JSON object per line, and a
    // chunk boundary can land mid-line, so hold the tail until a newline shows up.
    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '', full = '';
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n')) !== -1) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line) continue;
            try {
                const tok = JSON.parse(line).message?.content || '';
                if (tok) { full += tok; onToken(tok, full); }
            } catch (_) { /* partial / keep-alive line — ignore */ }
        }
    }
    return full.trim();
}

// ── Reading a vault file as plain text ─────────────────────────────
const VAULT_AI_TEXT_EXTS = new Set([
    'md','markdown','txt','csv','tsv','json','log','srt','vtt',
    'xml','yml','yaml','ini','conf','env','tex','bib'
]);

/** Flatten a .vulsor document's stored HTML into readable text. */
function _vaultAIHtmlToText(html) {
    const el = document.createElement('div');
    el.innerHTML = html || '';
    el.querySelectorAll('script,style').forEach(n => n.remove());
    // Block elements have no textContent separator, so paragraphs would run
    // together into one wall of words without this.
    el.querySelectorAll('p,div,br,li,tr,h1,h2,h3,h4,h5,h6,blockquote,pre')
      .forEach(n => { try { n.insertAdjacentText('afterend', '\n'); } catch (_) {} });
    return (el.textContent || '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Turn a .vnb notebook into markdown-ish text: prose, code, and its output. */
function _vaultAINotebookToText(raw) {
    try {
        const nb = JSON.parse(raw);
        return (nb.cells || []).map(c => {
            const src = c.source || '';
            if (c.type === 'markdown') return src;
            const outs = (c.outputs || [])
                .map(o => (typeof o === 'string' ? o : (o.text || '')))
                .filter(Boolean).join('\n');
            return '```' + (c.lang || '') + '\n' + src + '\n```'
                 + (outs ? '\nOutput:\n' + outs : '');
        }).join('\n\n').trim();
    } catch (_) { return raw; }
}

/** Pull the text layer out of a PDF. Capped — a 400-page book is not context. */
async function _vaultAIPdfToText(fullPath, maxPages = 40) {
    if (typeof pdfjsLib === 'undefined') return '';
    const url = 'file://' + encodeURI(fullPath.replace(/\\/g, '/')).replace(/#/g, '%23');
    let doc = null;
    try {
        doc = await pdfjsLib.getDocument(url).promise;
        const n = Math.min(doc.numPages, maxPages);
        const out = [];
        for (let p = 1; p <= n; p++) {
            const tc = await (await doc.getPage(p)).getTextContent();
            const line = tc.items.map(i => i.str).join(' ').replace(/\s+/g, ' ').trim();
            if (line) out.push(`[page ${p}] ${line}`);
        }
        if (doc.numPages > n) out.push(`… (${doc.numPages - n} further pages not read)`);
        return out.join('\n\n');
    } catch (e) {
        console.error('[vault-ai] pdf extract:', e);
        return '';
    } finally {
        if (doc) { try { doc.destroy(); } catch (_) {} }
    }
}

/**
 * Read one vault file as text. For the file currently open in an editor this
 * reads the editor instead of the disk, so unsaved keystrokes are included —
 * asking "what did I just write?" should see what is on screen.
 */
async function vaultAIFileText(file) {
    if (!file) return '';
    if (file.isWebLink) return `Website link: ${file.url || ''}`;

    if (file.id === vaultOpenFileId) {
        if (vaultIsDoc) {
            const ed = document.getElementById('vault-doc-editor');
            if (ed) return _vaultAIHtmlToText(ed.innerHTML);
        }
        if (vaultIsMd && vaultMdEditMode) {
            if (typeof vaultLiveIsMounted === 'function' && vaultLiveIsMounted()) return vaultLiveGetText();
            const ta = document.getElementById('vault-md-textarea');
            if (ta) return ta.value;
        }
        if (vaultIsCode && typeof vaultAceEditor !== 'undefined' && vaultAceEditor) {
            try { return vaultAceEditor.getValue(); } catch (_) {}
        }
    }

    const fullPath = path.join(VAULT_DIR, file.storedName || '');
    const ext      = vaultExt(file.originalName || '');
    if (!file.storedName || !fs.existsSync(fullPath)) return '';

    if (ext === 'pdf') return await _vaultAIPdfToText(fullPath);

    if (['pptx', 'ppt'].includes(ext)) {
        // The viewer already parsed the deck — reuse it rather than unzipping again.
        if (file.id === vaultOpenFileId && typeof pptxSlides !== 'undefined' && pptxSlides.length) {
            return pptxSlides.map((s, i) => {
                const words = (s.shapes || [])
                    .filter(sh => sh.type === 'text' && sh.paras)
                    .map(sh => sh.paras
                        .map(pa => (pa.runs || []).map(r => r.text || '').join(''))
                        .filter(Boolean).join('\n'))
                    .filter(Boolean).join('\n');
                return `[slide ${i + 1}]\n${words}`;
            }).join('\n\n');
        }
        return '';
    }

    let raw;
    try { raw = fs.readFileSync(fullPath, 'utf8'); }
    catch (e) { return ''; }

    if (file.isDoc)      return _vaultAIHtmlToText(raw);
    if (file.isNotebook || ext === 'vnb') return _vaultAINotebookToText(raw);
    if (VAULT_AI_TEXT_EXTS.has(ext))      return raw;
    if (typeof isCodeFile === 'function' && isCodeFile(file.originalName || '')) return raw;
    if (['html', 'htm'].includes(ext))    return _vaultAIHtmlToText(raw);
    return '';
}

/** Trim to the context budget, keeping the head (where the point usually is). */
function _vaultAIClip(text, limit = VAULT_AI_MAX_CONTEXT) {
    if (!text) return '';
    if (text.length <= limit) return text;
    return text.slice(0, limit) + `\n\n… (file continues — ${text.length - limit} more characters not shown)`;
}

function _vaultAIEsc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Markdown → HTML for AI replies, reusing the vault's own renderer. */
function _vaultAIRenderMd(container, text) {
    try {
        container.innerHTML = renderVaultMarkdown(text || '');
        if (typeof vaultRenderMath === 'function') vaultRenderMath(container);
    } catch (_) {
        container.textContent = text || '';
    }
}

function _vaultAIToast(msg, icon = 'fa-circle-info', color = '#f59e0b') {
    const old = document.getElementById('vault-ai-toast');
    if (old) old.remove();
    const t = document.createElement('div');
    t.id = 'vault-ai-toast';
    t.className = 'fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium shadow-xl pointer-events-none';
    t.style.cssText = 'background:rgb(var(--slate-800));border:1px solid rgb(var(--slate-700));color:rgb(var(--slate-200));transition:opacity .3s';
    t.innerHTML = `<i class="fas ${icon} text-sm" style="color:${color}"></i> <span>${_vaultAIEsc(msg)}</span>`;
    document.body.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 2600);
}

// ═══════════════════════════════════════════════════════════════════
// 1 ─ AI panel: ask about the file that is open
// ═══════════════════════════════════════════════════════════════════

let vaultAIPanelOpen = false;
let vaultAIHistory   = [];     // [{role:'user'|'assistant', content}] for one file
let vaultAIHistoryOf = null;   // which file id the history above belongs to
let vaultAIAbort     = null;   // AbortController of the in-flight answer
let vaultAIContext   = null;   // { fileId, text } — extracted once per file
let vaultAISetVisible = null;  // assigned by the panel wiring below

const VAULT_AI_QUICK = [
    { label: 'Summarise',   icon: 'fa-align-left',   prompt: 'Summarise this file in a short paragraph, then list the main points as bullets.' },
    { label: 'Key points',  icon: 'fa-list-ul',      prompt: 'Pull out the key points of this file as a bullet list. Be specific — quote the numbers, names and dates that appear.' },
    { label: 'Explain',     icon: 'fa-lightbulb',    prompt: 'Explain what this file is about in plain language, as if to someone seeing it for the first time.' },
    { label: 'Action items',icon: 'fa-square-check', prompt: 'List every task, action item, decision or follow-up in this file. If there are none, say so plainly.' },
    { label: 'Quiz me',     icon: 'fa-circle-question', prompt: 'Write 5 questions that test whether someone has understood this file, with the answers underneath.' }
];

function _vaultAIOpenFile() {
    return (vaultData.files || []).find(f => f.id === vaultOpenFileId) || null;
}

/** Reset the conversation when a different file is opened. */
function vaultAIOnFileOpen() {
    if (vaultAIHistoryOf !== vaultOpenFileId) {
        try { vaultAIAbort?.abort(); } catch (_) {}
        vaultAIAbort     = null;
        vaultAIHistory   = [];
        vaultAIHistoryOf = vaultOpenFileId;
        vaultAIContext   = null;
    }
    if (vaultAIPanelOpen) vaultAIRenderPanel();
}

/** The panel lives outside the viewer, so hide it when we go back to the grid. */
function vaultAIOnViewerClose() {
    try { vaultAIAbort?.abort(); } catch (_) {}
    vaultAIAbort = null;
    if (vaultAISetVisible) vaultAISetVisible(false, null);
}

/** Extract (and cache) the open file's text. */
async function _vaultAIEnsureContext() {
    const file = _vaultAIOpenFile();
    if (!file) return null;
    // Text-backed files are re-read every time: the user may have typed since
    // the last question, and a stale answer is worse than a slightly slower one.
    // Only PDF/PPTX extraction is expensive enough to be worth caching.
    const live = file.isDoc || vaultIsMd || vaultIsCode || vaultIsNotebook;
    if (!live && vaultAIContext && vaultAIContext.fileId === file.id) return vaultAIContext;
    const text = await vaultAIFileText(file);
    vaultAIContext = { fileId: file.id, text: text || '' };
    return vaultAIContext;
}

function _vaultAIStatusEl() { return document.getElementById('vault-ai-context'); }

async function _vaultAIRefreshContextChip() {
    const el = _vaultAIStatusEl();
    if (!el) return;
    const file = _vaultAIOpenFile();
    if (!file) { el.innerHTML = '<span class="text-slate-600">No file open</span>'; return; }
    el.innerHTML = `<i class="fas fa-spinner fa-spin text-[9px] mr-1"></i>reading ${_vaultAIEsc(file.originalName)}…`;
    const forId = file.id;
    const ctx = await _vaultAIEnsureContext();
    // Reading a big PDF takes a moment; if the user moved on, this result is stale.
    if (forId !== vaultOpenFileId) return;
    const n   = (ctx?.text || '').length;
    if (!n) {
        el.innerHTML = `<i class="fas fa-triangle-exclamation text-[9px] mr-1 text-amber-500"></i>`
                     + `<span class="text-slate-500">No readable text in ${_vaultAIEsc(file.originalName)}</span>`;
    } else {
        const size = n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);
        el.innerHTML = `<i class="fas fa-paperclip text-[9px] mr-1 text-slate-600"></i>`
                     + `<span class="text-slate-400">${_vaultAIEsc(file.originalName)}</span>`
                     + `<span class="text-slate-600"> · ${size} chars in context</span>`;
    }
}

function vaultAIRenderPanel() {
    const list = document.getElementById('vault-ai-messages');
    if (!list) return;

    if (!vaultAIHistory.length) {
        const file = _vaultAIOpenFile();
        list.innerHTML = `
            <div class="flex flex-col items-center text-center gap-2 px-4 pt-8 pb-4">
                <div class="w-9 h-9 rounded-xl flex items-center justify-center"
                     style="background:rgba(var(--accent-rgb),.14);border:1px solid rgba(var(--accent-rgb),.25)">
                    <i class="fas fa-wand-magic-sparkles text-[13px]" style="color:var(--accent-light)"></i>
                </div>
                <p class="text-slate-300 text-xs font-semibold">Ask about this file</p>
                <p class="text-slate-600 text-[11px] leading-relaxed">
                    ${file ? _vaultAIEsc(file.originalName) : 'Open a file'} is read straight into the
                    model. Nothing leaves your machine.
                </p>
            </div>`;
        return;
    }

    list.innerHTML = '';
    vaultAIHistory.forEach(m => list.appendChild(_vaultAIBubble(m.role, m.content)));
    list.scrollTop = list.scrollHeight;
}

function _vaultAIBubble(role, content) {
    const wrap = document.createElement('div');
    if (role === 'user') {
        wrap.className = 'flex justify-end';
        wrap.innerHTML = `<div class="max-w-[88%] px-3 py-2 rounded-xl rounded-br-sm text-[12px] leading-relaxed whitespace-pre-wrap"
             style="background:rgba(var(--accent-rgb),.16);border:1px solid rgba(var(--accent-rgb),.24);color:rgb(var(--slate-200))">${_vaultAIEsc(content)}</div>`;
        return wrap;
    }
    wrap.className = 'flex justify-start';
    const box = document.createElement('div');
    box.className = 'res-md max-w-full w-full px-3 py-2 rounded-xl rounded-bl-sm text-slate-300 select-text';
    box.style.cssText = 'background:rgb(var(--slate-400) / .07);border:1px solid rgb(var(--slate-400) / .13);font-size:12px';
    _vaultAIRenderMd(box, content);
    wrap.appendChild(box);
    return wrap;
}

function _vaultAISetBusy(busy) {
    const send = document.getElementById('vault-ai-send');
    const stop = document.getElementById('vault-ai-stop');
    if (send) send.style.display = busy ? 'none' : '';
    if (stop) stop.style.display = busy ? '' : 'none';
    document.querySelectorAll('.vault-ai-quick').forEach(b => {
        b.disabled = busy;
        b.style.opacity = busy ? '.45' : '';
    });
}

async function vaultAIAsk(question) {
    const q = (question || '').trim();
    if (!q || vaultAIAbort) return;

    const file = _vaultAIOpenFile();
    if (!file) { _vaultAIToast('Open a file first'); return; }

    const list = document.getElementById('vault-ai-messages');
    if (!list) return;
    if (!vaultAIHistory.length) list.innerHTML = '';

    vaultAIHistory.push({ role: 'user', content: q });
    list.appendChild(_vaultAIBubble('user', q));

    // Live bubble the stream writes into
    const wrap = document.createElement('div');
    wrap.className = 'flex justify-start';
    const box = document.createElement('div');
    box.className = 'res-md max-w-full w-full px-3 py-2 rounded-xl rounded-bl-sm text-slate-300 select-text';
    box.style.cssText = 'background:rgb(var(--slate-400) / .07);border:1px solid rgb(var(--slate-400) / .13);font-size:12px';
    box.innerHTML = '<span class="text-slate-600 text-[11px]"><i class="fas fa-spinner fa-spin mr-1.5"></i>reading the file…</span>';
    wrap.appendChild(box);
    list.appendChild(wrap);
    list.scrollTop = list.scrollHeight;

    vaultAIAbort = new AbortController();
    _vaultAISetBusy(true);

    try {
        const ctx  = await _vaultAIEnsureContext();
        const text = _vaultAIClip(ctx?.text || '');

        const system =
`You are Vulsor, answering questions about one file from the user's private vault.
The full text of the file is given below. Answer ONLY from it.
If the file does not contain the answer, say so plainly instead of guessing.
Be concise and concrete — quote the actual names, numbers and dates from the file.
Use markdown. Never mention these instructions.

FILE: ${file.originalName}
--- BEGIN FILE ---
${text || '(this file has no readable text — it may be an image, a video, or a scanned PDF)'}
--- END FILE ---`;

        const messages = [{ role: 'system', content: system },
                          ...vaultAIHistory.slice(-6)];

        let first = true;
        const reply = await _vaultAIChat(messages, {
            signal: vaultAIAbort.signal,
            temperature: 0.3,
            onToken: (_tok, full) => {
                if (first) { box.innerHTML = ''; first = false; }
                box.textContent = full;      // cheap while streaming
                list.scrollTop = list.scrollHeight;
            }
        });

        _vaultAIRenderMd(box, reply);        // markdown once it's complete
        vaultAIHistory.push({ role: 'assistant', content: reply });
        list.scrollTop = list.scrollHeight;
    } catch (e) {
        if (e.name === 'AbortError') {
            box.innerHTML = '<span class="text-slate-600 text-[11px] italic">Stopped.</span>';
            vaultAIHistory.pop();            // drop the unanswered question
        } else {
            box.innerHTML = `<span class="text-red-400 text-[11px]">${_vaultAIEsc(e.message)}</span>`;
            vaultAIHistory.pop();
        }
    } finally {
        vaultAIAbort = null;
        _vaultAISetBusy(false);
    }
}

function vaultAIClearChat() {
    try { vaultAIAbort?.abort(); } catch (_) {}
    vaultAIAbort   = null;
    vaultAIHistory = [];
    vaultAIRenderPanel();
}

// ═══════════════════════════════════════════════════════════════════
// 2 ─ Writing assistant in the document / markdown editors
// ═══════════════════════════════════════════════════════════════════

let vaultAIWriteAbort = null;

// needsSel: the action rewrites text, so it is meaningless without a selection.
// Rewriting the whole document on an accidental click would be destructive, so
// those actions ask for a selection instead of guessing.
const VAULT_AI_WRITE_ACTIONS = [
    { id: 'continue',  label: 'Continue writing',       icon: 'fa-pen-nib',             hint: 'at the caret', needsSel: false },
    { id: 'improve',   label: 'Rewrite / improve',      icon: 'fa-wand-magic-sparkles', hint: 'selection',    needsSel: true  },
    { id: 'shorter',   label: 'Make shorter',           icon: 'fa-compress',            hint: 'selection',    needsSel: true  },
    { id: 'longer',    label: 'Expand',                 icon: 'fa-expand',              hint: 'selection',    needsSel: true  },
    { id: 'grammar',   label: 'Fix grammar & spelling', icon: 'fa-spell-check',         hint: 'selection',    needsSel: true  },
    { id: 'bullets',   label: 'Summarise as bullets',   icon: 'fa-list-ul',             hint: 'appends',      needsSel: false },
    { id: 'tone',      label: 'Change tone…',           icon: 'fa-masks-theater',       hint: 'selection',    needsSel: true  },
    { id: 'translate', label: 'Translate…',             icon: 'fa-language',            hint: 'selection',    needsSel: true  },
    { id: 'custom',    label: 'Custom instruction…',    icon: 'fa-terminal',            hint: '',             needsSel: false }
];

/** A small "working" pill at the bottom of the window, with a Stop button. */
function _vaultAIWorkingPill(label, onCancel) {
    const old = document.getElementById('vault-ai-pill');
    if (old) old.remove();
    const pill = document.createElement('div');
    pill.id = 'vault-ai-pill';
    pill.className = 'fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm shadow-xl';
    pill.style.cssText = 'background:rgb(var(--slate-800));border:1px solid rgb(var(--slate-700));color:rgb(var(--slate-200))';
    pill.innerHTML = `<i class="fas fa-spinner fa-spin text-[12px]" style="color:var(--accent-light)"></i>
        <span class="text-[12px] font-medium">${_vaultAIEsc(label)}</span>
        <button class="text-[11px] font-semibold px-2 py-1 rounded-lg transition-colors"
                style="background:rgb(var(--slate-400) / .14);color:rgb(var(--slate-300))">Stop</button>`;
    pill.querySelector('button').onclick = () => { try { onCancel(); } catch (_) {} };
    document.body.appendChild(pill);
    return { done: () => pill.remove() };
}

/** Where are we writing — the .vulsor doc editor, or the markdown textarea? */
function _vaultAIWriteTarget() {
    if (vaultIsDoc) {
        const ed = document.getElementById('vault-doc-editor');
        if (ed) return { kind: 'doc', el: ed };
    }
    if (vaultIsMd && vaultMdEditMode) {
        if (typeof vaultLiveIsMounted === 'function' && vaultLiveIsMounted()) {
            return { kind: 'live', el: document.getElementById('vault-live-editor') };
        }
        const ta = document.getElementById('vault-md-textarea');
        if (ta) return { kind: 'md', el: ta };
    }
    return null;
}

/** Snapshot the selection before the toolbar click steals focus. */
function _vaultAICaptureSelection(target) {
    if (!target) return null;
    if (target.kind === 'live') {
        const sel = vaultLiveGetSelection();
        return { kind: 'live', el: target.el, start: sel.start, end: sel.end,
                 text: sel.text, all: sel.all, before: sel.all.slice(0, sel.end) };
    }
    if (target.kind === 'md') {
        const ta = target.el;
        // Without focus selectionStart is a meaningless 0, which would make
        // "continue writing" prepend at the top of the file.
        const hasCaret = document.activeElement === ta;
        const start = hasCaret ? ta.selectionStart : ta.value.length;
        const end   = hasCaret ? ta.selectionEnd   : ta.value.length;
        return { kind: 'md', el: ta, start, end,
                 text: ta.value.slice(start, end), all: ta.value,
                 before: ta.value.slice(0, end) };
    }
    const ed  = target.el;
    const sel = window.getSelection();
    let range = null, text = '', before = '';
    if (sel && sel.rangeCount) {
        const r = sel.getRangeAt(0);
        if (ed.contains(r.commonAncestorContainer)) { range = r.cloneRange(); text = sel.toString(); }
    }
    if (range) {
        try {
            const r = document.createRange();
            r.selectNodeContents(ed);
            r.setEnd(range.endContainer, range.endOffset);
            before = r.toString();
        } catch (_) {}
    }
    return { kind: 'doc', el: ed, range, text, all: ed.innerText || '',
             before: before || (ed.innerText || '') };
}

function _vaultAIApplyToDoc(snap, text, replace) {
    const ed  = snap.el;
    ed.focus();
    const sel = window.getSelection();
    sel.removeAllRanges();
    if (snap.range) sel.addRange(snap.range);
    else {
        const r = document.createRange();
        r.selectNodeContents(ed);
        r.collapse(false);
        sel.addRange(r);
    }
    if (!replace) {
        const r2 = sel.getRangeAt(0);
        r2.collapse(false);                  // append after, never over
        sel.removeAllRanges();
        sel.addRange(r2);
        document.execCommand('insertParagraph');
    }
    // execCommand keeps the browser's native undo stack alive, so ⌘Z still
    // takes the whole insertion back out.
    String(text).split('\n').forEach((line, i) => {
        if (i > 0) document.execCommand('insertParagraph');
        if (line) document.execCommand('insertText', false, line);
    });
    if (typeof vaultDocOnInput === 'function') vaultDocOnInput();
}

function _vaultAIApplyToMd(snap, text, replace) {
    const ta = snap.el;
    ta.focus();
    if (replace) {
        ta.setSelectionRange(snap.start, snap.end);
        document.execCommand('insertText', false, text);
    } else {
        const at = (snap.end == null) ? ta.value.length : snap.end;
        ta.setSelectionRange(at, at);
        document.execCommand('insertText', false, (ta.value[at - 1] === '\n' ? '\n' : '\n\n') + text);
    }
    ta.dispatchEvent(new Event('input', { bubbles: true }));
}

function _vaultAIApplyToLive(snap, text, replace) {
    if (replace) {
        vaultLiveReplaceRange(snap.start, snap.end, text);
    } else {
        const at   = (snap.end == null) ? snap.all.length : snap.end;
        const lead = snap.all[at - 1] === '\n' ? '\n' : '\n\n';
        vaultLiveReplaceRange(at, at, lead + text);
    }
}

/** Build the prompt for one action. Returns null when the user cancels a sub-prompt. */
async function _vaultAIWritePrompt(action, snap) {
    const sel  = snap.text;
    const doc  = _vaultAIClip(snap.all || '', 6000);
    const tail = (snap.before || snap.all || '').slice(-2500);

    switch (action.id) {
        case 'continue':
            return { replace: false, temperature: 0.7, prompt:
`Continue this piece of writing. Carry on in the same voice, tense and formatting.
Write 1-3 more paragraphs. Do not repeat what is already written, do not summarise
it, and do not add a heading or any preamble — output only the new prose.

TEXT SO FAR:
${tail}` };

        case 'improve':
            return { replace: true, temperature: 0.4, prompt:
`Rewrite the passage below so it reads better — clearer, tighter, better flow.
Keep the meaning, the facts and roughly the length. Keep the same language.
Output ONLY the rewritten passage, with no preamble, quotes or commentary.

PASSAGE:
${sel}` };

        case 'shorter':
            return { replace: true, temperature: 0.3, prompt:
`Rewrite the passage below to be significantly shorter while keeping every fact
that matters. Keep the same language. Output ONLY the shortened passage.

PASSAGE:
${sel}` };

        case 'longer':
            return { replace: true, temperature: 0.6, prompt:
`Expand the passage below with more detail, explanation and examples, staying
faithful to its meaning and voice. Keep the same language. Do not invent facts,
figures or citations. Output ONLY the expanded passage.

PASSAGE:
${sel}` };

        case 'grammar':
            return { replace: true, temperature: 0.1, prompt:
`Correct the spelling, grammar and punctuation of the passage below. Change
nothing else — keep the wording, voice, formatting and language exactly as they
are. Output ONLY the corrected passage.

PASSAGE:
${sel}` };

        case 'bullets':
            return { replace: false, temperature: 0.3, prompt:
`Summarise the text below as a short markdown bullet list of its key points.
Output ONLY the bullet list.

TEXT:
${sel || doc}` };

        case 'tone': {
            const tone = await vulsorPrompt('Rewrite in which tone?', 'professional',
                { placeholder: 'professional, casual, confident, friendly, academic…',
                  confirmLabel: 'Rewrite' });
            if (tone === null || !tone.trim()) return null;
            return { replace: true, temperature: 0.5, prompt:
`Rewrite the passage below in a ${tone.trim()} tone. Keep the meaning and the
language. Output ONLY the rewritten passage.

PASSAGE:
${sel}` };
        }

        case 'translate': {
            const lang = await vulsorPrompt('Translate into which language?', '',
                { placeholder: 'Norwegian, Spanish, German…', confirmLabel: 'Translate' });
            if (lang === null || !lang.trim()) return null;
            return { replace: true, temperature: 0.3, prompt:
`Translate the passage below into ${lang.trim()}. Keep the formatting and the
line breaks. Output ONLY the translation.

PASSAGE:
${sel}` };
        }

        case 'custom': {
            const instr = await vulsorPrompt(
                sel ? 'What should the AI do with the selected text?'
                    : 'What should the AI write?',
                '', { multiline: true, confirmLabel: 'Run',
                      placeholder: sel ? 'e.g. turn this into a table' : 'e.g. write an intro paragraph' });
            if (instr === null || !instr.trim()) return null;
            return { replace: !!sel, temperature: 0.5, prompt:
`${instr.trim()}

Output ONLY the resulting text, with no preamble or commentary.

${sel ? 'SELECTED TEXT:\n' + sel : 'THE DOCUMENT SO FAR:\n' + doc}` };
        }
    }
    return null;
}

async function vaultAIRunWriteAction(actionId, snap) {
    const action = VAULT_AI_WRITE_ACTIONS.find(a => a.id === actionId);
    if (!action || !snap) return;

    if (action.needsSel && !snap.text.trim()) {
        _vaultAIToast('Select some text first, then pick that action');
        return;
    }
    if (!action.needsSel && !snap.text.trim() && !(snap.all || '').trim() && actionId !== 'custom') {
        _vaultAIToast('Nothing written yet — type something first');
        return;
    }

    const spec = await _vaultAIWritePrompt(action, snap);
    if (!spec) return;

    vaultAIWriteAbort = new AbortController();
    const pill = _vaultAIWorkingPill(action.label + '…', () => vaultAIWriteAbort?.abort());

    try {
        const out = await _vaultAIChat([
            { role: 'system', content:
                'You are a writing assistant embedded in a text editor. You return only the '
              + 'text the user asked for — never an explanation, never a preamble like "Here is", '
              + 'never surrounding quotation marks or code fences. Match the language of the input.' },
            { role: 'user', content: spec.prompt }
        ], { signal: vaultAIWriteAbort.signal, temperature: spec.temperature });

        // Small models like wrapping the answer in a fence even when told not to.
        let text = out.replace(/^\s*```[a-z]*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
        if (!text) { _vaultAIToast('The model returned nothing — try again'); return; }

        if      (snap.kind === 'md')   _vaultAIApplyToMd(snap, text, spec.replace);
        else if (snap.kind === 'live') _vaultAIApplyToLive(snap, text, spec.replace);
        else                           _vaultAIApplyToDoc(snap, text, spec.replace);
    } catch (e) {
        if (e.name !== 'AbortError') _vaultAIToast(e.message, 'fa-circle-exclamation', '#f87171');
    } finally {
        pill.done();
        vaultAIWriteAbort = null;
    }
}

/** Drop-down of writing actions, anchored under the toolbar button. */
function vaultAIOpenWriteMenu(anchorBtn) {
    document.getElementById('vault-ai-write-menu')?.remove();

    const target = _vaultAIWriteTarget();
    if (!target) { _vaultAIToast('Open a document, or switch the note to Live or Source mode'); return; }
    const snap    = _vaultAICaptureSelection(target);
    const hasSel  = !!(snap && snap.text.trim());

    const menu = document.createElement('div');
    menu.id = 'vault-ai-write-menu';
    menu.className = 'fixed z-[70] bg-slate-800 border border-slate-700/60 rounded-xl shadow-2xl py-1.5';
    menu.style.minWidth = '236px';
    menu.innerHTML =
        `<div class="px-3 py-1.5 text-[9px] uppercase tracking-wider text-slate-500 flex items-center justify-between">
            <span>AI writing</span>
            <span class="${hasSel ? 'text-emerald-400' : 'text-slate-600'} normal-case tracking-normal">
                ${hasSel ? snap.text.trim().split(/\s+/).length + ' words selected' : 'no selection'}
            </span>
         </div>`
        + VAULT_AI_WRITE_ACTIONS.map(a => {
            const off = a.needsSel && !hasSel;
            return `<button data-act="${a.id}" ${off ? 'disabled' : ''}
                class="w-full text-left px-3 py-2 text-xs flex items-center gap-2 transition-colors
                       ${off ? 'text-slate-600 cursor-not-allowed' : 'text-slate-300 hover:bg-slate-700/70'}">
                <i class="fas ${a.icon} text-[10px] w-3.5 text-center ${off ? '' : 'text-slate-400'}"></i>
                <span class="flex-1">${a.label}</span>
                <span class="text-[9px] text-slate-600">${off ? 'select text' : a.hint}</span>
            </button>`;
        }).join('');

    document.body.appendChild(menu);

    // Anchor under the button, nudged back on screen if it would overflow.
    const r = anchorBtn.getBoundingClientRect();
    const w = menu.offsetWidth, h = menu.offsetHeight;
    menu.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left)) + 'px';
    menu.style.top  = (r.bottom + h + 8 > window.innerHeight ? Math.max(8, r.top - h - 4) : r.bottom + 4) + 'px';

    menu.querySelectorAll('button[data-act]').forEach(b => {
        b.addEventListener('click', () => {
            const act = b.dataset.act;
            menu.remove();
            document.removeEventListener('mousedown', onAway, true);
            vaultAIRunWriteAction(act, snap);
        });
    });

    function onAway(e) {
        if (menu.contains(e.target) || e.target === anchorBtn || anchorBtn.contains(e.target)) return;
        menu.remove();
        document.removeEventListener('mousedown', onAway, true);
    }
    setTimeout(() => document.addEventListener('mousedown', onAway, true), 0);
}

// ═══════════════════════════════════════════════════════════════════
// 3 ─ Ask Vault: one question, answered from every note you own
// ═══════════════════════════════════════════════════════════════════

// Extracting text from every PDF on every question would take minutes, so the
// text is pulled once and cached on disk, keyed by the file's own change stamp.
const VAULT_AI_INDEX_FILE = path.join(DOCUMENTS_PATH, 'vault_ai_index.json');

let vaultAIIndex      = null;   // { [fileId]: { u: stamp, n: name, t: text } }
let vaultAIAskAbort   = null;
let vaultAIIndexing   = false;
let vaultAILastSources = [];    // [{n, id, name}] backing the source chips

function _vaultAIStamp(f) { return `${f.updatedAt || 0}:${f.size || 0}:${f.storedName || ''}`; }

function _vaultAILoadIndex() {
    if (vaultAIIndex) return vaultAIIndex;
    try {
        vaultAIIndex = fs.existsSync(VAULT_AI_INDEX_FILE)
            ? JSON.parse(fs.readFileSync(VAULT_AI_INDEX_FILE, 'utf8'))
            : {};
    } catch (_) { vaultAIIndex = {}; }
    return vaultAIIndex;
}

function _vaultAISaveIndex() {
    try {
        const tmp = VAULT_AI_INDEX_FILE + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(vaultAIIndex || {}));
        fs.renameSync(tmp, VAULT_AI_INDEX_FILE);
    } catch (e) { console.error('[vault-ai] index save:', e); }
}

function _vaultAIIndexableFiles() {
    return (vaultData.files || []).filter(f => {
        if (f.isWebLink || f.isProject) return false;
        if (f.isMolecule || f.isPeriodic || f.isDna || f.isAnatomy ||
            f.isChessStrategy || f.isPhysics || f.isGraph) return false;
        if (f.isDoc || f.isNotebook) return true;
        const ext = vaultExt(f.originalName || '');
        if (ext === 'vnb' || ext === 'pdf') return true;
        if (VAULT_AI_TEXT_EXTS.has(ext)) return true;
        if (typeof isCodeFile === 'function' && isCodeFile(f.originalName || '')) return true;
        return false;
    });
}

/**
 * Bring the cache in line with the vault. Unchanged files are reused, so this
 * is slow once and instant afterwards.
 */
async function vaultAIBuildIndex(onProgress, force = false) {
    if (vaultAIIndexing) return _vaultAILoadIndex();
    vaultAIIndexing = true;
    try {
        const idx   = _vaultAILoadIndex();
        const files = _vaultAIIndexableFiles();
        const live  = new Set(files.map(f => f.id));

        // Drop entries for files that have since been deleted
        Object.keys(idx).forEach(id => { if (!live.has(id)) delete idx[id]; });

        let done = 0, changed = 0;
        for (const f of files) {
            const stamp = _vaultAIStamp(f);
            const hit   = idx[f.id];
            if (!force && hit && hit.u === stamp) {
                hit.n = f.originalName;      // keep renames in step
                done++; onProgress?.(done, files.length, f.originalName, false);
                continue;
            }
            let text = '';
            try { text = await vaultAIFileText(f); } catch (_) {}
            idx[f.id] = { u: stamp, n: f.originalName, t: (text || '').slice(0, 200000) };
            changed++; done++;
            onProgress?.(done, files.length, f.originalName, true);
        }
        if (changed || Object.keys(idx).length !== live.size) _vaultAISaveIndex();
        return idx;
    } finally {
        vaultAIIndexing = false;
    }
}

// ── Retrieval ──────────────────────────────────────────────────────
const VAULT_AI_STOP = new Set(('a an the and or but if then than that this these those of in on at to for from '
    + 'by with as is are was were be been being am it its i you he she they we us my your our their do does did '
    + 'not no so such about into over under out up down what which who whom when where why how all any both each '
    + 'few more most other some can could will would just should now have has had').split(' '));

// Lowercase and strip accents. Notes get written "représentation" and searched
// for as "representation"; without folding those are simply different words and
// the note is never found. Folding is exact-match-preserving — unlike prefix or
// fuzzy matching, it cannot invent a hit — so a question about something the
// vault genuinely lacks still comes back empty instead of citing noise.
function _vaultAIFold(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function _vaultAITokens(s) {
    return (_vaultAIFold(s).match(/[\p{L}\p{N}_]{2,}/gu) || [])
        .filter(t => !VAULT_AI_STOP.has(t));
}

/** Split a document into ~1100-char chunks on paragraph boundaries. */
function _vaultAIChunkText(text, size = 1100) {
    const paras = String(text || '').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
    const out = [];
    let cur = '';
    for (const p of paras) {
        if (p.length > size) {                       // one giant paragraph — hard split
            if (cur) { out.push(cur); cur = ''; }
            for (let i = 0; i < p.length; i += size) out.push(p.slice(i, i + size));
            continue;
        }
        if ((cur + '\n\n' + p).length > size) { out.push(cur); cur = p; }
        else                                  { cur = cur ? cur + '\n\n' + p : p; }
    }
    if (cur) out.push(cur);
    return out;
}

/** BM25-ish ranking over every chunk in the vault. */
function vaultAIRetrieve(query, index, { maxChunks = 6, maxPerFile = 2, budget = 7000 } = {}) {
    const qTerms = [...new Set(_vaultAITokens(query))];
    if (!qTerms.length) return [];

    const chunks = [];
    for (const [id, rec] of Object.entries(index || {})) {
        if (!rec || !rec.t) continue;
        _vaultAIChunkText(rec.t).forEach(t => chunks.push({ id, name: rec.n || '', text: t }));
    }
    if (!chunks.length) return [];

    // Two passes. The first is cheap (one lowercase per chunk) and does double
    // duty: it collects document frequencies across the WHOLE vault — which is
    // what makes IDF meaningful — and picks out the chunks worth tokenizing.
    // Only those get the expensive treatment; a vault of hundreds of files is
    // thousands of chunks, and tokenizing them all on every question is waste.
    const df   = new Map(qTerms.map(t => [t, 0]));
    const cand = [];
    for (const c of chunks) {
        const lower = _vaultAIFold(c.text);
        const nameL = _vaultAIFold(c.name);
        let hit = false;
        for (const t of qTerms) {
            if (lower.includes(t)) { df.set(t, df.get(t) + 1); hit = true; }
            else if (nameL.includes(t)) hit = true;
        }
        if (hit) cand.push({ ...c, lower, nameL });
    }
    if (!cand.length) return [];

    for (const c of cand) {
        const toks = _vaultAITokens(c.text);
        const tf = new Map();
        for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
        c.tf = tf;
        c.len = toks.length || 1;
    }

    const N   = chunks.length;
    const avg = cand.reduce((s, c) => s + c.len, 0) / cand.length;

    const k1 = 1.4, b = 0.75;
    for (const c of cand) {
        let score = 0;
        const nameL = c.nameL;
        for (const t of qTerms) {
            const n = df.get(t) || 0;
            const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
            const f = c.tf.get(t) || 0;
            if (f) score += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * c.len / avg));
            if (nameL.includes(t)) score += 1.4;      // a matching filename is a strong hint
        }
        c.score = score;
    }

    cand.sort((a, b2) => b2.score - a.score);

    const perFile = new Map();
    const picked  = [];
    let used = 0;
    for (const c of cand) {
        if (picked.length >= maxChunks || used >= budget) break;
        const n = perFile.get(c.id) || 0;
        if (n >= maxPerFile) continue;
        perFile.set(c.id, n + 1);
        picked.push(c);
        used += c.text.length;
    }
    return picked;
}

// ── Ask Vault modal ────────────────────────────────────────────────
const VAULT_AI_ASK_SUGGESTIONS = [
    'What did I decide about…?',
    'Summarise everything I have on…',
    'What are my open action items?',
    'Where did I write about…?'
];

function openVaultAsk() {
    const modal = document.getElementById('vault-ask-modal');
    if (!modal) return;
    modal.classList.add('open');
    const input = document.getElementById('vault-ask-input');
    setTimeout(() => { input?.focus(); input?.select(); }, 30);
    _vaultAIAskIdleState();
    _vaultAIAskRefreshStatus();
}

function closeVaultAsk() {
    try { vaultAIAskAbort?.abort(); } catch (_) {}
    vaultAIAskAbort = null;
    document.getElementById('vault-ask-modal')?.classList.remove('open');
}

function _vaultAIAskRefreshStatus() {
    const el = document.getElementById('vault-ask-status');
    if (!el) return;
    const idx     = _vaultAILoadIndex();
    const files   = _vaultAIIndexableFiles();
    const cached  = files.filter(f => idx[f.id] && idx[f.id].u === _vaultAIStamp(f)).length;
    const pending = files.length - cached;
    el.innerHTML = pending
        ? `<i class="fas fa-circle text-[6px] text-amber-400 mr-1.5"></i>${cached} of ${files.length} files indexed · ${pending} to read`
        : `<i class="fas fa-circle text-[6px] text-emerald-400 mr-1.5"></i>${files.length} files indexed`;
}

function _vaultAIAskIdleState() {
    const body = document.getElementById('vault-ask-body');
    if (!body) return;
    const _src = document.getElementById('vault-ask-sources');
    if (_src) { _src.innerHTML = ''; _src.style.display = 'none'; }
    body.innerHTML = `
        <div class="flex flex-col items-center text-center gap-3 py-10 px-6">
            <div class="w-11 h-11 rounded-2xl flex items-center justify-center"
                 style="background:rgba(var(--accent-rgb),.14);border:1px solid rgba(var(--accent-rgb),.25)">
                <i class="fas fa-wand-magic-sparkles text-base" style="color:var(--accent-light)"></i>
            </div>
            <div>
                <p class="text-slate-200 text-sm font-semibold">Ask your whole vault</p>
                <p class="text-slate-600 text-xs mt-1 leading-relaxed max-w-sm">
                    Every note, document, notebook and PDF you own is searched, and the
                    answer cites the files it came from.
                </p>
            </div>
            <div class="flex flex-wrap gap-1.5 justify-center mt-1">
                ${VAULT_AI_ASK_SUGGESTIONS.map(s =>
                    `<span class="vault-ask-sugg px-2.5 py-1 rounded-lg text-[11px] cursor-pointer transition-colors"
                           style="background:rgb(var(--slate-400) / .09);border:1px solid rgb(var(--slate-400) / .14);color:rgb(var(--slate-400))"
                    >${_vaultAIEsc(s)}</span>`).join('')}
            </div>
        </div>`;
    body.querySelectorAll('.vault-ask-sugg').forEach(el => {
        el.addEventListener('click', () => {
            const input = document.getElementById('vault-ask-input');
            input.value = el.textContent.trim();
            input.focus();
            // The suggestions are half-written on purpose — put the caret where
            // the user still has to fill the topic in.
            const dots = input.value.indexOf('…');
            if (dots >= 0) input.setSelectionRange(dots, dots + 1);
        });
    });
}

function _vaultAIAskBusy(busy) {
    const go   = document.getElementById('vault-ask-go');
    const stop = document.getElementById('vault-ask-stop');
    if (go)   go.style.display   = busy ? 'none' : '';
    if (stop) stop.style.display = busy ? '' : 'none';
}

async function vaultAIAskVault(question) {
    const q = (question || '').trim();
    if (!q || vaultAIAskAbort) return;

    const body    = document.getElementById('vault-ask-body');
    const srcWrap = document.getElementById('vault-ask-sources');
    srcWrap.innerHTML = '';
    srcWrap.style.display = 'none';
    vaultAILastSources = [];

    vaultAIAskAbort = new AbortController();
    const signal = vaultAIAskAbort.signal;
    _vaultAIAskBusy(true);

    try {
        // ── 1. index ──
        body.innerHTML = `<div class="px-6 py-8 flex flex-col items-center gap-3">
            <i class="fas fa-spinner fa-spin text-slate-500"></i>
            <p id="vault-ask-progress" class="text-slate-500 text-xs">Reading your files…</p>
            <div class="w-56 h-1 rounded-full overflow-hidden" style="background:rgb(var(--slate-400) / .14)">
                <div id="vault-ask-bar" class="h-full transition-all" style="width:0%;background:var(--accent-light)"></div>
            </div>
        </div>`;
        const prog = document.getElementById('vault-ask-progress');
        const bar  = document.getElementById('vault-ask-bar');

        const idx = await vaultAIBuildIndex((done, total, name, wasRead) => {
            if (bar)  bar.style.width = Math.round((done / Math.max(1, total)) * 100) + '%';
            if (prog) prog.textContent = wasRead
                ? `Reading ${name} (${done}/${total})`
                : `Checking files… (${done}/${total})`;
        });
        if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
        _vaultAIAskRefreshStatus();

        // ── 2. retrieve ──
        const hits = vaultAIRetrieve(q, idx);
        if (!hits.length) {
            body.innerHTML = `<div class="px-6 py-10 text-center">
                <i class="fas fa-magnifying-glass text-slate-700 text-xl mb-3"></i>
                <p class="text-slate-400 text-sm font-medium">Nothing in your vault matches that</p>
                <p class="text-slate-600 text-xs mt-1.5">Try different words, or the names of the files you have in mind.</p>
            </div>`;
            return;
        }

        // Number the sources in the order the model will see them
        const order = [];
        hits.forEach(h => { if (!order.includes(h.id)) order.push(h.id); });
        vaultAILastSources = order.map((id, i) => ({ n: i + 1, id, name: idx[id]?.n || 'Untitled' }));
        // A vault can hold two distinct files with the same name; identical
        // chips would be indistinguishable, so qualify them by folder.
        const nameCount = {};
        vaultAILastSources.forEach(s2 => { nameCount[s2.name] = (nameCount[s2.name] || 0) + 1; });
        vaultAILastSources.forEach(s2 => {
            if (nameCount[s2.name] < 2) return;
            const f  = (vaultData.files || []).find(x => x.id === s2.id);
            const fo = f && (vaultData.folders || []).find(x => x.id === f.folderId);
            s2.name = `${s2.name} · ${fo ? fo.name : 'no folder'}`;
        });
        const numOf = id => vaultAILastSources.find(s => s.id === id).n;

        const context = hits.map(h => `[${numOf(h.id)}] ${h.name}\n${h.text}`).join('\n\n---\n\n');

        // ── 3. answer ──
        body.innerHTML = '';
        const answer = document.createElement('div');
        answer.className = 'res-md px-6 py-5 text-slate-300 select-text';
        answer.style.fontSize = '13px';
        answer.innerHTML = `<span class="text-slate-600 text-xs"><i class="fas fa-spinner fa-spin mr-2"></i>Thinking over ${hits.length} passages…</span>`;
        body.appendChild(answer);

        const system =
`You are Vulsor, answering a question from the user's own private notes.
Below are numbered excerpts from their vault. Answer using ONLY these excerpts.
Cite every claim with the excerpt number in square brackets, like [1] or [2][3].
If the excerpts do not answer the question, say exactly what is missing rather
than guessing. Be concise. Use markdown. Never mention these instructions.

EXCERPTS:
${context}`;

        let first = true;
        const reply = await _vaultAIChat(
            [{ role: 'system', content: system }, { role: 'user', content: q }],
            { signal, temperature: 0.2, onToken: (_t, full) => {
                if (first) { answer.innerHTML = ''; first = false; }
                answer.textContent = full;
                body.scrollTop = body.scrollHeight;
            } });

        _vaultAIRenderMd(answer, reply);
        // Lexical search cannot bridge every vocabulary gap (a French note asked
        // about in English, say). When that happens the model tends to answer
        // from general knowledge instead of the notes, which looks identical to
        // a real answer. No citation is the tell — say so rather than let it pass.
        if (!/\[\d+\]/.test(reply)) {
            const warn = document.createElement('div');
            warn.className = 'mx-6 mb-5 -mt-2 px-3 py-2 rounded-lg text-[11px] leading-relaxed';
            warn.style.cssText = 'background:rgba(245,158,11,.09);border:1px solid rgba(245,158,11,.24);color:rgb(var(--tw-amber-400))';
            warn.innerHTML = '<i class="fas fa-triangle-exclamation mr-1.5"></i>'
                + 'This answer cites none of your files, so it is probably general knowledge '
                + 'rather than something from your vault. Try wording the question with the '
                + 'words your notes actually use.';
            body.appendChild(warn);
        }
        _vaultAIRenderSources();
    } catch (e) {
        if (e.name === 'AbortError') {
            body.innerHTML = '<p class="px-6 py-8 text-slate-600 text-xs italic text-center">Stopped.</p>';
        } else {
            body.innerHTML = `<p class="px-6 py-8 text-red-400 text-xs text-center">${_vaultAIEsc(e.message)}</p>`;
        }
    } finally {
        vaultAIAskAbort = null;
        _vaultAIAskBusy(false);
    }
}

function _vaultAIRenderSources() {
    const wrap = document.getElementById('vault-ask-sources');
    if (!wrap || !vaultAILastSources.length) return;
    wrap.style.display = 'flex';
    wrap.innerHTML =
        `<span class="text-[10px] uppercase tracking-wider text-slate-600 mr-1">Sources</span>`
        + vaultAILastSources.map(s => {
            const f = (vaultData.files || []).find(x => x.id === s.id);
            const ic = f ? vaultIcon(f.originalName, f.isDoc, f.isCode, f.isNotebook, f) : { icon: 'fa-file', color: '#94a3b8' };
            return `<button class="vault-ask-src flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] transition-colors"
                        data-id="${_vaultAIEsc(s.id)}" title="Open ${_vaultAIEsc(s.name)}"
                        style="background:rgb(var(--slate-400) / .09);border:1px solid rgb(var(--slate-400) / .16);color:rgb(var(--slate-300))">
                    <span class="text-[9px] font-bold" style="color:var(--accent-light)">${s.n}</span>
                    <i class="fas ${ic.icon} text-[9px]" style="color:${ic.color}"></i>
                    <span class="truncate max-w-[180px]">${_vaultAIEsc(s.name)}</span>
                </button>`;
        }).join('');
    wrap.querySelectorAll('.vault-ask-src').forEach(b => {
        b.addEventListener('click', () => {
            const id = b.dataset.id;
            closeVaultAsk();
            if (typeof openVaultFile === 'function') openVaultFile(id);
        });
    });
}

// ═══════════════════════════════════════════════════════════════════
// Wiring
// ═══════════════════════════════════════════════════════════════════

function initVaultAI() {
    // ── AI panel: toggle + drag-resize (same feel as the Docs/Notes tabs) ──
    const tab     = document.getElementById('vault-ai-btn');
    const panel   = document.getElementById('vault-ai-sidebar');
    const resizer = document.getElementById('vault-ai-resizer');
    const SNAP    = 120;
    const DEFAULT_W = 340;

    if (tab && panel && resizer) {
        function setVisible(v, width) {
            vaultAIPanelOpen = v;
            panel.style.display   = v ? '' : 'none';
            resizer.style.display = v ? '' : 'none';
            tab.classList.toggle('active', v);
            if (v && width != null) panel.style.width = width + 'px';
            if (v) { vaultAIRenderPanel(); _vaultAIRefreshContextChip(); }
        }
        vaultAISetVisible = setVisible;
        setVisible(false, null);

        // Click toggles; drag resizes. Identical to how Docs/Notes behave, so
        // the third panel doesn't need learning.
        tab.addEventListener('mousedown', e => {
            if (e.button !== 0) return;
            e.preventDefault();
            const startX = e.clientX;
            const startW = (vaultAIPanelOpen ? panel.offsetWidth : 0) || DEFAULT_W;
            let moved = false;

            function onMove(ev) {
                const d = (startX - ev.clientX);          // drag left widens
                if (Math.abs(d) > 4) moved = true;
                if (!moved) return;
                const newW = Math.max(0, Math.min(700, startW + d));
                if (!vaultAIPanelOpen && newW > SNAP) setVisible(true, newW);
                if (vaultAIPanelOpen) panel.style.width = newW + 'px';
            }
            function onUp(ev) {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                document.body.classList.remove('vault-resizing');
                if (!moved) { setVisible(!vaultAIPanelOpen, DEFAULT_W); return; }
                const finalW = startW + (startX - ev.clientX);
                if (finalW <= SNAP) setVisible(false, null);
                else panel.style.width = Math.min(700, Math.max(SNAP + 1, finalW)) + 'px';
            }
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
            document.body.classList.add('vault-resizing');
        });

        // Edge strip drags the panel border directly
        resizer.addEventListener('mousedown', e => {
            if (e.button !== 0) return;
            e.preventDefault();
            const startX = e.clientX;
            const startW = panel.offsetWidth || DEFAULT_W;
            function onMove(ev) {
                const w = Math.max(0, Math.min(700, startW + (startX - ev.clientX)));
                panel.style.width = w + 'px';
            }
            function onUp(ev) {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                document.body.classList.remove('vault-resizing');
                if (startW + (startX - ev.clientX) <= SNAP) setVisible(false, null);
            }
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
            document.body.classList.add('vault-resizing');
        });
    }

    // Quick-action chips
    const quick = document.getElementById('vault-ai-quick');
    if (quick) {
        quick.innerHTML = VAULT_AI_QUICK.map(q =>
            `<button class="vault-ai-quick flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-medium transition-colors"
                     data-prompt="${_vaultAIEsc(q.prompt)}"
                     style="background:rgb(var(--slate-400) / .09);border:1px solid rgb(var(--slate-400) / .14);color:rgb(var(--slate-400))">
                <i class="fas ${q.icon} text-[9px]"></i>${q.label}
            </button>`).join('');
        quick.addEventListener('click', e => {
            const b = e.target.closest('.vault-ai-quick');
            if (b && !b.disabled) vaultAIAsk(b.dataset.prompt);
        });
    }

    // Panel input
    const aiInput = document.getElementById('vault-ai-input');
    const send = () => {
        const v = aiInput.value.trim();
        if (!v) return;
        aiInput.value = '';
        aiInput.style.height = 'auto';
        vaultAIAsk(v);
    };
    if (aiInput) {
        aiInput.addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
        });
        aiInput.addEventListener('input', () => {          // grow with the question
            aiInput.style.height = 'auto';
            aiInput.style.height = Math.min(120, aiInput.scrollHeight) + 'px';
        });
    }
    document.getElementById('vault-ai-send')?.addEventListener('click', send);
    document.getElementById('vault-ai-stop')?.addEventListener('click', () => vaultAIAbort?.abort());
    document.getElementById('vault-ai-clear')?.addEventListener('click', vaultAIClearChat);

    // ── Writing assistant buttons ──
    document.getElementById('vd-ai-btn')?.addEventListener('click', e => {
        vaultAIOpenWriteMenu(e.currentTarget);
    });
    document.getElementById('vault-md-ai-btn')?.addEventListener('click', e => {
        vaultAIOpenWriteMenu(e.currentTarget);
    });
    // The markdown button sits outside #vault-doc-toolbar, which is what keeps
    // the caret alive on mousedown — so it needs its own guard.
    document.getElementById('vault-md-ai-btn')?.addEventListener('mousedown', e => e.preventDefault());

    // ── Ask Vault ──
    document.getElementById('vault-ask-btn')?.addEventListener('click', openVaultAsk);
    document.getElementById('vault-ask-close')?.addEventListener('click', closeVaultAsk);
    document.getElementById('vault-ask-modal')?.addEventListener('mousedown', e => {
        if (e.target.id === 'vault-ask-modal') closeVaultAsk();
    });
    const askInput = document.getElementById('vault-ask-input');
    const askGo    = () => vaultAIAskVault(askInput.value);
    askInput?.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); askGo(); }
    });
    document.getElementById('vault-ask-go')?.addEventListener('click', askGo);
    document.getElementById('vault-ask-stop')?.addEventListener('click', () => vaultAIAskAbort?.abort());
    document.getElementById('vault-ask-reindex')?.addEventListener('click', async () => {
        const st = document.getElementById('vault-ask-status');
        if (st) st.innerHTML = '<i class="fas fa-spinner fa-spin text-[9px] mr-1.5"></i>Re-reading every file…';
        await vaultAIBuildIndex((d, t, n) => {
            if (st) st.innerHTML = `<i class="fas fa-spinner fa-spin text-[9px] mr-1.5"></i>${n} (${d}/${t})`;
        }, true);
        _vaultAIAskRefreshStatus();
        _vaultAIToast('Vault re-indexed', 'fa-check-circle', '#34d399');
    });

    document.addEventListener('keydown', e => {
        if (e.key !== 'Escape') return;
        if (document.getElementById('vault-ask-modal')?.classList.contains('open')) closeVaultAsk();
        else document.getElementById('vault-ai-write-menu')?.remove();
    });
}
