// ── Vault Document Editor ─────────────────────────────────────
// All editor functions target #vault-doc-editor inside the vault viewer.
// Called by vault.js when a .vulsor file is opened.

function vdEscapeHtml(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Per-note page customization (background, font colour, size, family, spacing) ──
// Stored per file as `file.style` in vaultData (persisted via saveVaultData). The
// toolbar's font/colour controls style SELECTED text; this styles the WHOLE note
// (its default look). Applied on open by openVaultDocEditor.
const VD_STYLE_DEFAULTS = { bg: '#ffffff', fg: '#111111', size: 15, font: "'Inter', sans-serif", lh: 1.7 };
const VD_THEMES = [
    { name: 'Paper',    bg: '#ffffff', fg: '#111111' },
    { name: 'Sepia',    bg: '#f4ecd8', fg: '#4b3a26' },
    { name: 'Mint',     bg: '#e8f8ef', fg: '#14503a' },
    { name: 'Sky',      bg: '#eaf2fb', fg: '#173a5e' },
    { name: 'Rose',     bg: '#fdeef1', fg: '#5e1f2b' },
    { name: 'Lemon',    bg: '#fbf6da', fg: '#4a3f10' },
    { name: 'Slate',    bg: '#2a2f3a', fg: '#e6eaf2' },
    { name: 'Midnight', bg: '#0f172a', fg: '#cbd5e1' },
];

function vdDocStyleFor(file) { return Object.assign({}, VD_STYLE_DEFAULTS, (file && file.style) || {}); }

// <input type=color> only accepts #rrggbb — coerce #rgb / pass through #rrggbb.
function _vdHex(c) {
    if (typeof c !== 'string') return '#ffffff';
    if (/^#[0-9a-f]{6}$/i.test(c)) return c.toLowerCase();
    if (/^#[0-9a-f]{3}$/i.test(c)) return ('#' + c.slice(1).split('').map(x => x + x).join('')).toLowerCase();
    return '#ffffff';
}

// Apply a style object to the live editor page + content element.
function vdApplyDocStyle(style) {
    const s = Object.assign({}, VD_STYLE_DEFAULTS, style || {});
    const page   = document.querySelector('#vault-doc-editor-area .docs-page');
    const editor = document.getElementById('vault-doc-editor');
    if (page)   page.style.background = s.bg;
    if (editor) {
        editor.style.color      = s.fg;
        editor.style.fontSize   = (parseFloat(s.size) || 15) + 'px';
        editor.style.fontFamily = s.font;
        editor.style.lineHeight = String(s.lh);
    }
    return s;
}

function _vdCurrentFile() {
    try { return (typeof vaultOpenFileId !== 'undefined' && vaultOpenFileId && typeof vaultData !== 'undefined')
        ? vaultData.files.find(f => f.id === vaultOpenFileId) : null; }
    catch (_) { return null; }
}

// Merge a patch into the open note's style, apply it live, and persist.
function vdSaveDocStyle(patch) {
    const file = _vdCurrentFile();
    if (!file) return;
    file.style = Object.assign({}, vdDocStyleFor(file), patch || {});
    vdApplyDocStyle(file.style);
    try { saveVaultData(); } catch (_) {}
    const szV = document.getElementById('vd-size-val');
    if (szV) szV.textContent = (parseInt(file.style.size, 10) || 15) + 'px';
}

// Push the open note's current style into the panel controls.
function vdSyncStylePanel() {
    const s = vdDocStyleFor(_vdCurrentFile());
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    set('vd-bg-color', _vdHex(s.bg));
    set('vd-fg-color', _vdHex(s.fg));
    set('vd-base-size', parseInt(s.size, 10) || 15);
    set('vd-base-font', s.font);
    set('vd-base-lh', String(s.lh));
    const szV = document.getElementById('vd-size-val');
    if (szV) szV.textContent = (parseInt(s.size, 10) || 15) + 'px';
}

// Called by vault.js when a doc/note opens. The Customize palette (background,
// font colour, size, …) is exclusive to Custom Notes — regular Documents keep the
// clean default look and never show the button. The editor element is reused, so
// we always (re)apply: the note's saved style for a Custom Note, defaults otherwise.
function vdOpenDocStyle(file) {
    const isCustom = !!(file && file.isCustomNote);
    const btn = document.getElementById('vd-customize-btn');
    if (btn) btn.style.display = isCustom ? '' : 'none';
    const page   = document.querySelector('#vault-doc-editor-area .docs-page');
    const editor = document.getElementById('vault-doc-editor');
    if (isCustom) {
        vdApplyDocStyle(file && file.style);
        vdSyncStylePanel();
    } else {
        // Regular Document: undo any inline overrides a previously-open Custom Note
        // left on this reused editor element. Colour / size / spacing come from CSS
        // classes (clear them), but the font was Inter INLINE in the markup, so
        // restore that rather than clearing it (which would drop to an inherited font).
        if (page)   page.style.background = '';
        if (editor) {
            editor.style.color = '';
            editor.style.fontSize = '';
            editor.style.lineHeight = '';
            editor.style.fontFamily = "'Inter', sans-serif";
        }
    }
    vdApplyDocDirection(file);
    const panel = document.getElementById('vd-style-panel');
    if (panel) panel.classList.add('hidden');
}

function vdExec(cmd, value) {
    document.getElementById('vault-doc-editor').focus();
    document.execCommand(cmd, false, value || null);
    vaultDocOnInput();
}

// Blocks the direction buttons act on. Lists are included so their bullets /
// numbers move to the other side along with the text.
const VD_DIR_BLOCKS = 'p,div,h1,h2,h3,h4,h5,h6,li,ul,ol,blockquote,pre,table';

// Text direction (LTR / RTL). execCommand has no direction command in Chromium,
// so the `dir` attribute goes on the block elements themselves — that way it
// lives in the document HTML, which is exactly what gets saved to disk.
//
// Select paragraphs to flip just those; with nothing selected the whole document
// flips, which is the usual reason to reach for this at all. A document-wide flip
// is also stored on the file so text typed after reopening starts on the right
// side, which an attribute on the blocks alone can't do.
function vdSetDirection(dir) {
    const editor = document.getElementById('vault-doc-editor');
    if (!editor) return;
    editor.focus();
    if (!editor.querySelector(VD_DIR_BLOCKS)) editor.innerHTML = '<p><br></p>';

    const sel      = window.getSelection();
    const hasRange = !!(sel && sel.rangeCount && !sel.isCollapsed && editor.contains(sel.anchorNode));
    const blocks   = hasRange
        ? [...editor.querySelectorAll(VD_DIR_BLOCKS)].filter(el => sel.containsNode(el, true))
        : [...editor.querySelectorAll(VD_DIR_BLOCKS)];

    blocks.forEach(el => {
        el.setAttribute('dir', dir);
        el.style.direction = dir;
        // An explicit align from the justify buttons would otherwise pin the text
        // to the old side. Leave a deliberate centre/justify alone.
        const align = el.style.textAlign;
        if (!align || align === 'left' || align === 'right' || align === 'start' || align === 'end') {
            el.style.textAlign = (dir === 'rtl') ? 'right' : 'left';
        }
    });

    // Whole-document flip: mark the editor too, so newly typed paragraphs inherit
    // it, and remember it on the file so reopening the document keeps it.
    if (!hasRange) {
        editor.setAttribute('dir', dir);
        editor.style.direction = dir;
        const file = _vdCurrentFile();
        if (file) { file.dir = dir; try { saveVaultData(); } catch (_) {} }
    }
    vaultDocOnInput();
}

// Put the editor element back to the document's saved direction. Called on open,
// since the editor element is reused between documents and would otherwise keep
// the last one's direction.
function vdApplyDocDirection(file) {
    const editor = document.getElementById('vault-doc-editor');
    if (!editor) return;
    const dir = (file && file.dir === 'rtl') ? 'rtl' : 'ltr';
    editor.setAttribute('dir', dir);
    editor.style.direction = dir;
}

// Find the block element (paragraph/heading/etc.) that contains a node.
function vdBlockOf(node) {
    const editor = document.getElementById('vault-doc-editor');
    let el = node && node.nodeType === 3 ? node.parentNode : node;
    while (el && el !== editor && !/^(P|DIV|H1|H2|H3|H4|LI|BLOCKQUOTE|PRE)$/.test(el.nodeName)) {
        el = el.parentNode;
    }
    return (el && el !== editor) ? el : null;
}

// Markdown-style auto list: typing "- ", "* ", "+ ", "1. " etc. at the very
// start of a line turns that line into a bullet/numbered list. Returns true if
// it handled the space (caller should preventDefault).
function vdMaybeAutoList() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || !sel.isCollapsed) return false;
    const range = sel.getRangeAt(0);
    const block = vdBlockOf(range.startContainer);
    if (!block || block.nodeName === 'LI' || block.nodeName === 'PRE') return false;

    // Text from the start of the block up to the caret.
    const pre = document.createRange();
    pre.selectNodeContents(block);
    pre.setEnd(range.startContainer, range.startOffset);
    const before = pre.toString();

    let cmd = null;
    if (/^[-*+]$/.test(before))      cmd = 'insertUnorderedList';
    else if (/^\d+[.)]$/.test(before)) cmd = 'insertOrderedList';
    if (!cmd) return false;

    // Delete the marker text, then convert the (now empty) line into a list.
    pre.deleteContents();
    document.execCommand(cmd);
    vaultDocOnInput();
    return true;
}

// ── Insert link ────────────────────────────────────────────────
// Electron has no window.prompt(), so use an inline popup instead.
function vdInsertLink(anchorBtn) {
    const existing = document.getElementById('vd-link-picker');
    if (existing) { existing.remove(); return; }

    const editor = document.getElementById('vault-doc-editor');
    // Capture the selection now — it's lost once the popup input takes focus.
    const sel = window.getSelection();
    let savedRange = null;
    if (sel && sel.rangeCount && editor.contains(sel.anchorNode)) {
        savedRange = sel.getRangeAt(0).cloneRange();
    }
    const selectedText = savedRange ? savedRange.toString() : '';

    const picker = document.createElement('div');
    picker.id = 'vd-link-picker';
    picker.className = 'absolute z-50 bg-slate-800 border border-slate-700 rounded-xl p-3 shadow-2xl';
    picker.style.minWidth = '240px';
    picker.innerHTML = `
        <p class="text-slate-400 text-[10px] text-center mb-2 font-semibold uppercase tracking-wider">Insert Link</p>
        ${selectedText ? '' : `<input id="vd-link-text" type="text" placeholder="Link text"
            class="w-full bg-slate-700 border border-slate-600 rounded-lg px-2 py-1.5 text-white text-xs outline-none focus:border-red-600/70 transition-colors placeholder-slate-500 mb-2">`}
        <div class="flex gap-1">
            <input id="vd-link-url" type="text" placeholder="https://…"
                class="flex-1 bg-slate-700 border border-slate-600 rounded-lg px-2 py-1.5 text-white text-xs outline-none focus:border-red-600/70 transition-colors placeholder-slate-500">
            <button id="vd-link-go" class="px-2.5 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs rounded-lg transition-colors shrink-0">
                <i class="fas fa-check text-[10px]"></i>
            </button>
        </div>`;

    vdPositionPopup(picker, anchorBtn);

    const urlInput  = picker.querySelector('#vd-link-url');
    const textInput = picker.querySelector('#vd-link-text');

    const apply = () => {
        let url = urlInput.value.trim();
        if (!url) return;
        // Default to https:// when no scheme / not a relative or anchor link.
        if (!/^[a-z][a-z0-9+.-]*:/i.test(url) && !url.startsWith('/') && !url.startsWith('#')) {
            url = 'https://' + url;
        }
        picker.remove();
        editor.focus();
        if (savedRange) {
            const s = window.getSelection();
            s.removeAllRanges(); s.addRange(savedRange);
        }
        if (selectedText) {
            document.execCommand('createLink', false, url);
        } else {
            const label = (textInput && textInput.value.trim()) || url;
            document.execCommand('insertHTML', false,
                `<a href="${vdEscapeHtml(url)}" target="_blank" rel="noopener">${vdEscapeHtml(label)}</a>`);
        }
        vaultDocOnInput();
    };

    picker.querySelector('#vd-link-go').addEventListener('click', apply);
    urlInput.addEventListener('keydown', e => { if (e.key === 'Enter') apply(); });
    if (textInput) textInput.addEventListener('keydown', e => { if (e.key === 'Enter') urlInput.focus(); });
    setTimeout(() => (textInput || urlInput).focus(), 0);

    const close = (e) => {
        if (!picker.contains(e.target) && e.target !== anchorBtn) {
            picker.remove(); document.removeEventListener('mousedown', close);
        }
    };
    setTimeout(() => document.addEventListener('mousedown', close), 0);
}

// ── Insert table ───────────────────────────────────────────────
function vdInsertTable(rows, cols) {
    let html = '<div style="overflow-x:auto;margin:0.8em 0"><table class="docs-table" style="margin:0"><tbody>';
    for (let r = 0; r < rows; r++) {
        html += '<tr>';
        for (let c = 0; c < cols; c++) {
            html += r === 0 ? '<th><br></th>' : '<td><br></td>';
        }
        html += '</tr>';
    }
    html += '</tbody></table></div><p><br></p>';
    document.getElementById('vault-doc-editor').focus();
    document.execCommand('insertHTML', false, html);
    vaultDocOnInput();
}

// ── Position a popup as fixed near an anchor ───────────────────
// Appended to <body> (not the toolbar) so the toolbar's overflow:auto
// can't clip it, and clamped to stay inside the viewport.
function vdPositionPopup(popup, anchor) {
    popup.style.position = 'fixed';
    popup.style.zIndex   = '9999';
    document.body.appendChild(popup);
    const a = anchor.getBoundingClientRect();
    const p = popup.getBoundingClientRect();
    let left = a.left;
    let top  = a.bottom + 4;
    if (left + p.width > window.innerWidth - 8)
        left = Math.max(8, window.innerWidth - p.width - 8);
    if (top + p.height > window.innerHeight - 8)
        top = Math.max(8, a.top - p.height - 4);   // flip above the anchor
    popup.style.left = left + 'px';
    popup.style.top  = top + 'px';
}

// ── Table grid picker ──────────────────────────────────────────
function vdShowTablePicker(anchorBtn) {
    const existing = document.getElementById('vd-table-picker');
    if (existing) { existing.remove(); return; }

    const picker = document.createElement('div');
    picker.id = 'vd-table-picker';
    picker.className = 'absolute z-50 bg-slate-800 border border-slate-700 rounded-xl p-3 shadow-2xl';
    const ROWS = 6, COLS = 8;
    let hoverR = 0, hoverC = 0;

    function build() {
        picker.innerHTML = '';
        const lbl = document.createElement('p');
        lbl.className = 'text-slate-400 text-[10px] text-center mb-2';
        lbl.textContent = hoverR && hoverC ? `${hoverR} × ${hoverC}` : 'Insert table';
        picker.appendChild(lbl);
        const grid = document.createElement('div');
        grid.style.cssText = `display:grid;grid-template-columns:repeat(${COLS},18px);gap:2px`;
        for (let r = 1; r <= ROWS; r++) {
            for (let c = 1; c <= COLS; c++) {
                const cell = document.createElement('div');
                const active = r <= hoverR && c <= hoverC;
                cell.className = `w-[18px] h-[18px] rounded border cursor-pointer transition-all ${
                    active ? '' : 'bg-slate-700 border-slate-600 hover:bg-slate-600'
                }`;
                if (active) { cell.style.background = 'var(--accent)'; cell.style.borderColor = 'var(--accent-hover)'; }
                cell.addEventListener('mouseenter', () => { hoverR = r; hoverC = c; build(); });
                cell.addEventListener('click', () => { picker.remove(); vdInsertTable(r, c); });
                grid.appendChild(cell);
            }
        }
        picker.appendChild(grid);
    }
    build();

    vdPositionPopup(picker, anchorBtn);

    const close = (e) => {
        if (!picker.contains(e.target) && e.target !== anchorBtn) {
            picker.remove(); document.removeEventListener('mousedown', close);
        }
    };
    setTimeout(() => document.addEventListener('mousedown', close), 0);
}

// ── Color picker ───────────────────────────────────────────────
function vdShowColorPicker(cmd, anchorId) {
    const existingId = 'vd-color-picker-popup';
    const existing = document.getElementById(existingId);
    if (existing) { existing.remove(); return; }

    const COLORS = [
        '#000000','#374151','#6b7280','#9ca3af','#d1d5db','#ffffff',
        '#dc2626','#ea580c','#d97706','#65a30d','#059669','#0284c7',
        '#7c3aed','#db2777','#be185d','#0891b2','#0e7490','#1d4ed8',
        '#fef08a','#fed7aa','#fecaca','#bbf7d0','#bfdbfe','#ddd6fe',
    ];

    const popup = document.createElement('div');
    popup.id = existingId;
    popup.className = 'absolute z-50 bg-slate-800 border border-slate-700 rounded-xl p-3 shadow-2xl';
    const anchor = document.getElementById(anchorId);

    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(6,22px);gap:3px';
    COLORS.forEach(color => {
        const sw = document.createElement('div');
        sw.className = 'w-[22px] h-[22px] rounded-md cursor-pointer border-2 border-transparent hover:border-white transition-all';
        sw.style.background = color;
        sw.addEventListener('click', () => {
            popup.remove();
            document.getElementById('vault-doc-editor').focus();
            document.execCommand(cmd, false, color);
            vaultDocOnInput();
        });
        grid.appendChild(sw);
    });

    const customRow = document.createElement('div');
    customRow.className = 'flex gap-2 mt-2 items-center';
    const inp = document.createElement('input');
    inp.type = 'color';
    inp.className = 'w-7 h-7 rounded cursor-pointer border-0 bg-transparent';
    inp.addEventListener('input', () => {
        document.getElementById('vault-doc-editor').focus();
        document.execCommand(cmd, false, inp.value);
        vaultDocOnInput();
    });
    inp.addEventListener('change', () => popup.remove());
    const lbl = document.createElement('span');
    lbl.className = 'text-slate-400 text-[10px]';
    lbl.textContent = 'Custom color';
    customRow.appendChild(inp);
    customRow.appendChild(lbl);
    popup.appendChild(grid);
    popup.appendChild(customRow);

    vdPositionPopup(popup, anchor);

    const close = (e) => {
        if (!popup.contains(e.target) && e.target !== anchor) {
            popup.remove(); document.removeEventListener('mousedown', close);
        }
    };
    setTimeout(() => document.addEventListener('mousedown', close), 0);
}

// ── Insert image ───────────────────────────────────────────────
function vdShowImagePicker(anchorBtn) {
    const existing = document.getElementById('vd-image-picker');
    if (existing) { existing.remove(); return; }

    const picker = document.createElement('div');
    picker.id = 'vd-image-picker';
    picker.className = 'absolute z-50 bg-slate-800 border border-slate-700 rounded-xl p-3 shadow-2xl';
    picker.style.minWidth = '210px';

    picker.innerHTML = `
        <p class="text-slate-400 text-[10px] text-center mb-2 font-semibold uppercase tracking-wider">Insert Image</p>
        <button id="vd-img-file-btn" class="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs transition-colors mb-2">
            <i class="fas fa-folder-open text-[11px] text-red-400"></i> From File…
        </button>
        <div class="flex items-center gap-1.5 text-slate-600 text-[10px] mb-2">
            <div class="flex-1 h-px bg-slate-700"></div>
            <span>or paste URL</span>
            <div class="flex-1 h-px bg-slate-700"></div>
        </div>
        <div class="flex gap-1">
            <input id="vd-img-url-input" type="text" placeholder="https://…"
                class="flex-1 bg-slate-700 border border-slate-600 rounded-lg px-2 py-1.5 text-white text-xs outline-none focus:border-red-600/70 transition-colors placeholder-slate-500">
            <button id="vd-img-url-btn" class="px-2.5 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs rounded-lg transition-colors shrink-0">
                <i class="fas fa-check text-[10px]"></i>
            </button>
        </div>
    `;

    vdPositionPopup(picker, anchorBtn);

    // From file
    picker.querySelector('#vd-img-file-btn').addEventListener('click', () => {
        picker.remove();
        document.getElementById('vd-image-input').click();
    });

    // From URL
    const urlInput = picker.querySelector('#vd-img-url-input');
    const insertFromUrl = () => {
        const url = urlInput.value.trim();
        if (!url) return;
        picker.remove();
        document.getElementById('vault-doc-editor').focus();
        document.execCommand('insertHTML', false,
            `<img src="${vdEscapeHtml(url)}" style="max-width:100%;height:auto;border-radius:4px;margin:6px 0;display:block" alt="image">`);
        vaultDocOnInput();
    };
    picker.querySelector('#vd-img-url-btn').addEventListener('click', insertFromUrl);
    urlInput.addEventListener('keydown', e => { if (e.key === 'Enter') insertFromUrl(); });
    setTimeout(() => urlInput.focus(), 0);

    const close = (e) => {
        if (!picker.contains(e.target) && e.target !== anchorBtn) {
            picker.remove(); document.removeEventListener('mousedown', close);
        }
    };
    setTimeout(() => document.addEventListener('mousedown', close), 0);
}

// ── Wire toolbar ───────────────────────────────────────────────
function initVaultDocEditor() {
    const toolbar = document.getElementById('vault-doc-toolbar');

    // Make Enter create <p> blocks (matches the editor's CSS) instead of
    // browser-default <div>s, so paragraph spacing stays consistent.
    try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch (_) {}

    // Keep the editor's selection when a toolbar BUTTON is pressed. Without this
    // the editor blurs on mousedown and the selection collapses to a caret, so
    // block commands (lists, alignment, indent, headings) only affect one line.
    // Selects/inputs are intentionally excluded — they need to take focus.
    toolbar.addEventListener('mousedown', (e) => {
        if (e.target.closest('button')) e.preventDefault();
    });

    // data-vcmd buttons
    toolbar.querySelectorAll('[data-vcmd]').forEach(btn => {
        const cmd = btn.dataset.vcmd;
        btn.addEventListener('click', () => {
            if (cmd === 'link') { vdInsertLink(btn); return; }
            if (cmd === 'ltr' || cmd === 'rtl') { vdSetDirection(cmd); return; }
            if (cmd === 'print') {
                const editor   = document.getElementById('vault-doc-editor');
                // Live title lives in the editable input; the span is hidden while editing.
                const titleInp = document.getElementById('vault-doc-title-input');
                const title    = (titleInp && !titleInp.classList.contains('hidden') && titleInp.value.trim())
                    || document.getElementById('vault-viewer-title').textContent || 'Document';
                const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${vdEscapeHtml(title)}</title>
                    <style>body{font-family:Georgia,serif;max-width:800px;margin:40px auto;padding:0 40px;color:#111}
                    table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:6px 10px}
                    h1,h2,h3{margin:1.2em 0 0.4em}hr{border:none;border-top:2px solid #e5e7eb;margin:1.5em 0}
                    a{color:rgb(var(--tw-blue-600))}img{max-width:100%}
                    @media print{@page{margin:1.5cm}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style>
                    </head><body>${editor.innerHTML}</body></html>`;
                // window.open is blocked by this app's window-open handler, so print via IPC.
                try {
                    const { ipcRenderer } = require('electron');
                    ipcRenderer.invoke('print-html', { html, title });
                } catch (err) {
                    console.error('Doc print failed:', err);
                }
                return;
            }
            vdExec(cmd);
        });
    });

    // Format block
    document.getElementById('vd-format-select').addEventListener('change', (e) => {
        vdExec('formatBlock', e.target.value);
        e.target.value = 'p';
    });

    // Font family
    document.getElementById('vd-font-select').addEventListener('change', (e) => {
        vdExec('fontName', e.target.value);
    });

    // Font size — wrap the selection in a span, preserving nested
    // formatting (bold/italic/color/links) instead of flattening to text.
    document.getElementById('vd-fontsize-select').addEventListener('change', (e) => {
        const editor = document.getElementById('vault-doc-editor');
        editor.focus();
        const sel = window.getSelection();
        if (!sel || !sel.rangeCount) return;
        const range = sel.getRangeAt(0);
        if (range.collapsed) return;          // nothing selected → nothing to resize
        const span = document.createElement('span');
        span.style.fontSize = e.target.value;
        span.appendChild(range.extractContents());   // keeps child nodes/formatting
        range.insertNode(span);
        // re-select the resized content
        const newRange = document.createRange();
        newRange.selectNodeContents(span);
        sel.removeAllRanges();
        sel.addRange(newRange);
        vaultDocOnInput();
    });

    // Color pickers
    document.getElementById('vd-text-color-btn').addEventListener('click', () =>
        vdShowColorPicker('foreColor', 'vd-text-color-btn'));
    document.getElementById('vd-highlight-btn').addEventListener('click', () =>
        vdShowColorPicker('hiliteColor', 'vd-highlight-btn'));

    // Customize panel — whole-note background / font colour / size / family / spacing
    (function wireCustomize() {
        const panel = document.getElementById('vd-style-panel');
        const btn   = document.getElementById('vd-customize-btn');
        if (!panel || !btn) return;

        // Theme swatches
        const themeRow = document.getElementById('vd-theme-row');
        if (themeRow) VD_THEMES.forEach(t => {
            const b = document.createElement('button');
            b.type = 'button';
            b.title = t.name;
            b.className = 'w-7 h-7 rounded-md border border-slate-600 shrink-0 flex items-center justify-center transition-transform hover:scale-110';
            b.style.background = t.bg;
            b.innerHTML = `<span style="color:${t.fg};font-size:12px;font-weight:700;font-family:Georgia,serif">A</span>`;
            b.addEventListener('click', () => { vdSaveDocStyle({ bg: t.bg, fg: t.fg }); vdSyncStylePanel(); });
            themeRow.appendChild(b);
        });

        // Toggle panel
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const hidden = panel.classList.contains('hidden');
            if (hidden) vdSyncStylePanel();
            panel.classList.toggle('hidden');
        });
        // Close on outside click / Escape
        document.addEventListener('click', (e) => {
            if (panel.classList.contains('hidden')) return;
            if (panel.contains(e.target) || btn.contains(e.target)) return;
            panel.classList.add('hidden');
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !panel.classList.contains('hidden')) panel.classList.add('hidden');
        });

        // Controls
        const bgI = document.getElementById('vd-bg-color');
        const fgI = document.getElementById('vd-fg-color');
        const szI = document.getElementById('vd-base-size');
        const szV = document.getElementById('vd-size-val');
        const fontI = document.getElementById('vd-base-font');
        const lhI = document.getElementById('vd-base-lh');
        if (bgI)   bgI.addEventListener('input',  () => vdSaveDocStyle({ bg: bgI.value }));
        if (fgI)   fgI.addEventListener('input',  () => vdSaveDocStyle({ fg: fgI.value }));
        if (szI)   szI.addEventListener('input',  () => { if (szV) szV.textContent = szI.value + 'px'; vdSaveDocStyle({ size: parseInt(szI.value, 10) }); });
        if (fontI) fontI.addEventListener('change', () => vdSaveDocStyle({ font: fontI.value }));
        if (lhI)   lhI.addEventListener('change', () => vdSaveDocStyle({ lh: parseFloat(lhI.value) }));
        const resetBtn = document.getElementById('vd-style-reset');
        if (resetBtn) resetBtn.addEventListener('click', () => {
            const file = _vdCurrentFile();
            if (file) { file.style = Object.assign({}, VD_STYLE_DEFAULTS); vdApplyDocStyle(file.style); try { saveVaultData(); } catch (_) {} }
            vdSyncStylePanel();
        });
    })();

    // Table picker
    document.getElementById('vd-table-btn').addEventListener('click', () =>
        vdShowTablePicker(document.getElementById('vd-table-btn')));

    // Image picker
    document.getElementById('vd-image-btn').addEventListener('click', () =>
        vdShowImagePicker(document.getElementById('vd-image-btn')));

    // Image file input → embed as base64
    document.getElementById('vd-image-input').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            const editor = document.getElementById('vault-doc-editor');
            editor.focus();
            document.execCommand('insertHTML', false,
                `<img src="${ev.target.result}" style="max-width:100%;height:auto;border-radius:4px;margin:6px 0;display:block" alt="${vdEscapeHtml(file.name)}">`);
            vaultDocOnInput();
        };
        reader.readAsDataURL(file);
        e.target.value = '';
    });

    // Editor events
    const editor = document.getElementById('vault-doc-editor');

    editor.addEventListener('input', vaultDocOnInput);

    editor.addEventListener('keydown', (e) => {
        if (e.key === 'Tab') {
            e.preventDefault();
            document.execCommand(e.shiftKey ? 'outdent' : 'indent');
        }
        // "- ", "* ", "1. " at line start → auto bullet / numbered list.
        if (e.key === ' ' && vdMaybeAutoList()) {
            e.preventDefault();
            return;
        }
        setTimeout(() => {
            if (editor.innerHTML === '' || editor.innerHTML === '<br>') {
                editor.innerHTML = '<p><br></p>';
                const r = document.createRange();
                r.setStart(editor.firstChild, 0); r.collapse(true);
                window.getSelection().removeAllRanges();
                window.getSelection().addRange(r);
            }
        }, 0);
    });

    editor.addEventListener('paste', (e) => {
        e.preventDefault();
        const html = e.clipboardData.getData('text/html');
        const text = e.clipboardData.getData('text/plain');
        if (html) {
            const tmp = document.createElement('div');
            tmp.innerHTML = html;
            tmp.querySelectorAll('script,style,meta,link').forEach(el => el.remove());
            // Strip inline event handlers and javascript: URLs (they'd run in print/export).
            tmp.querySelectorAll('*').forEach(el => {
                [...el.attributes].forEach(attr => {
                    if (/^on/i.test(attr.name)) el.removeAttribute(attr.name);
                });
                ['href', 'src'].forEach(a => {
                    const v = el.getAttribute(a);
                    if (v && /^\s*javascript:/i.test(v)) el.removeAttribute(a);
                });
            });
            document.execCommand('insertHTML', false, tmp.innerHTML);
        } else if (text) {
            document.execCommand('insertText', false, text);
        }
    });
}
