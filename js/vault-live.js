// ─────────────────────────────────────────────────────────────────────
//  Vault · Obsidian-style live preview
//
//  A markdown note is edited as a single contenteditable made of one
//  <div class="vlp-b"> per source block. Every block except the one the
//  caret sits in shows its rendered HTML (renderVaultMarkdown); the block
//  under the caret shows its raw markdown, so syntax is there to edit but
//  disappears into formatting the moment you move away — the way Obsidian
//  does it. `data-src` on each block is the authoritative markdown for it,
//  and joining every block's source with "\n" reproduces the file exactly.
//
//  Most blocks are one line. Constructs that only make sense as a unit —
//  fenced code, $$ math, tables — are grouped into one multi-line block
//  (data-multi="1") so editing them doesn't tear them in half.
// ─────────────────────────────────────────────────────────────────────

let vlpEl        = null;   // the contenteditable host
let vlpActive    = null;   // block currently showing source, or null
let vlpOnChange  = null;   // called with the full markdown after each edit
let vlpUndo      = [];     // {text, caret} snapshots
let vlpRedo      = [];
let vlpUndoTimer = null;
let vlpLastSnap  = '';
let vlpMuted     = false;  // true while we rebuild the DOM ourselves

// ── Styles ───────────────────────────────────────────────────────────
// renderVaultMarkdown ships its CSS inside every render. Blocks are
// rendered one at a time here, so lift that <style> into the document
// once and strip it from each block's HTML.
function vlpEnsureStyle() {
    if (document.getElementById('vlp-md-style')) return;
    let css = '';
    try {
        const m = renderVaultMarkdown('').match(/<style>([\s\S]*?)<\/style>/);
        css = m ? m[1] : '';
    } catch (_) {}
    const el = document.createElement('style');
    el.id = 'vlp-md-style';
    el.textContent = css + `
.vlp{outline:none;min-height:100%;caret-color:var(--accent-light);cursor:text}
.vlp-b{min-height:1.6em}
/* Math-heavy notes render to tens of thousands of KaTeX spans, and a
   contenteditable re-lays-out all of them on every keystroke. Letting the
   browser skip blocks that are off-screen (content-visibility) and scope
   layout to each block (contain) cuts a keystroke on a 58 KB note from
   ~38 ms to ~14 ms. The active block is exempt so the caret always has real
   geometry to work with. */
.vlp-b:not(.vlp-src){content-visibility:auto;contain-intrinsic-size:auto 1.6em;contain:layout style}
.vlp-b.vlp-src{white-space:pre-wrap;word-break:break-word;color:rgb(var(--slate-200))}
.vlp-b.vlp-src{background:rgba(var(--accent-rgb),.06);border-radius:4px;box-shadow:0 0 0 1px rgba(var(--accent-rgb),.10)}
.vlp-b.vlp-src .vmd-h{margin:0}
.vlp-b .vmd-ul,.vlp-b .vmd-ol{margin-top:0;margin-bottom:0}
.vlp-b .vmd-p{margin:0}
.vlp-b .vmd-h{margin:.9em 0 .3em}
.vlp-b:first-child .vmd-h{margin-top:0}
.vlp-b .vmd-pre-wrap,.vlp-b .vmd-tbl-wrap,.vlp-b .vmd-callout{margin:.6em 0}
.vlp-b .vmd-bq{margin:0}
.vlp-b .vmd-cb{cursor:pointer}
.vlp-b img{pointer-events:none}
.vlp-backlinks{opacity:.9}
`;
    document.head.appendChild(el);
}

// ── Splitting a document into blocks ────────────────────────────────
function vlpIsFence(l)  { return /^\s*(```|~~~)/.test(l); }
function vlpIsTableSep(l) { return /^\s*\|?[\s\-:|]+\|[\s\-:|]*$/.test(l) && l.includes('-'); }

function vlpSplitBlocks(text) {
    const lines = String(text == null ? '' : text).split('\n');
    const out   = [];
    let i = 0;
    while (i < lines.length) {
        const l = lines[i];
        // fenced code — everything up to the closing fence
        if (vlpIsFence(l)) {
            const buf = [l]; i++;
            while (i < lines.length) { buf.push(lines[i]); if (vlpIsFence(lines[i])) { i++; break; } i++; }
            out.push({ src: buf.join('\n'), multi: true });
            continue;
        }
        // display math — $$ on its own line opens a block
        const t = l.trim();
        if (t.startsWith('$$') && !(t.length > 4 && t.endsWith('$$'))) {
            const buf = [l]; i++;
            while (i < lines.length) { buf.push(lines[i]); if (lines[i].trim().endsWith('$$')) { i++; break; } i++; }
            out.push({ src: buf.join('\n'), multi: true });
            continue;
        }
        // table — header row + separator + body rows
        if (l.includes('|') && i + 1 < lines.length && vlpIsTableSep(lines[i + 1])) {
            const buf = [l, lines[i + 1]]; i += 2;
            while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') { buf.push(lines[i]); i++; }
            out.push({ src: buf.join('\n'), multi: true });
            continue;
        }
        out.push({ src: l, multi: false });
        i++;
    }
    if (!out.length) out.push({ src: '', multi: false });
    return out;
}

// ── Rendering one block ─────────────────────────────────────────────
function vlpRenderHTML(src) {
    if (!src.trim()) return '<br>';
    let html;
    try {
        html = renderVaultMarkdown(src);
    } catch (e) {
        console.error('[vlp] render failed:', e);
        return _vaultEsc(src);
    }
    html = html.replace(/<style>[\s\S]*?<\/style>/, '');
    const m = html.match(/<div class="vmd-wrap">([\s\S]*)<\/div>\s*$/);
    html = (m ? m[1] : html).trim();
    // A single list line renders as its own <ol> — keep the number the user
    // typed instead of restarting at 1 on every item.
    const num = src.match(/^\s*(\d+)[.)]\s/);
    if (num) html = html.replace('<ol class="vmd-ol"', `<ol class="vmd-ol" start="${num[1]}"`);
    return html || '<br>';
}

function vlpIndentPx(src) {
    const m = src.match(/^([ \t]*)/);
    if (!m || !m[1]) return 0;
    const spaces = m[1].replace(/\t/g, '    ').length;
    return /^\s*([-*+]|\d+[.)])\s/.test(src) ? Math.floor(spaces / 2) * 22 : 0;
}

function vlpShowRendered(b) {
    b.classList.remove('vlp-src');
    b.className = 'vlp-b';
    b.style.paddingLeft = vlpIndentPx(b.dataset.src || '') + 'px';
    b.innerHTML = vlpRenderHTML(b.dataset.src || '');
    b.dataset.r = '1';
    try { vaultRenderMath(b); } catch (_) {}
}

function vlpShowSource(b) {
    const src = b.dataset.src || '';
    // Keep a heading the same size while editing it, so the line doesn't
    // jump when the caret arrives.
    const h = src.match(/^(#{1,6})\s/);
    b.className = 'vlp-b vlp-src' + (h ? ` vmd-h vmd-h${h[1].length}` : '');
    b.style.paddingLeft = '';
    b.textContent = src;
    delete b.dataset.r;
}

// ── Reading text back out ───────────────────────────────────────────
function vlpReadSrc(b) {
    // The active block holds plain text, but the browser may still have
    // dropped a <br> or wrapper <div> in there.
    let out = '';
    (function walk(node) {
        node.childNodes.forEach(n => {
            if (n.nodeType === 3) out += n.nodeValue;
            else if (n.nodeName === 'BR') out += '\n';
            else {
                if (/^(DIV|P)$/.test(n.nodeName) && out && !out.endsWith('\n')) out += '\n';
                walk(n);
            }
        });
    })(b);
    return out;
}

function vlpBlocks() {
    return vlpEl ? Array.from(vlpEl.children).filter(n => n.classList && n.classList.contains('vlp-b')) : [];
}

function vaultLiveGetText() {
    if (!vlpEl) return '';
    if (vlpActive) vlpActive.dataset.src = vlpReadSrc(vlpActive);
    return vlpBlocks().map(b => b.dataset.src || '').join('\n');
}

// ── Caret helpers ───────────────────────────────────────────────────
function vlpBlockOf(node) {
    let n = node;
    while (n && n !== vlpEl) {
        if (n.nodeType === 1 && n.classList && n.classList.contains('vlp-b')) return n;
        n = n.parentNode;
    }
    return null;
}

function vlpOffsetIn(el) {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return 0;
    const r   = sel.getRangeAt(0);
    const pre = document.createRange();
    pre.selectNodeContents(el);
    try { pre.setEnd(r.endContainer, r.endOffset); } catch (_) { return 0; }
    return pre.toString().length;
}

function vlpPutCaret(el, off) {
    const sel = window.getSelection();
    if (!sel) return;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node = null, rest = Math.max(0, off), n;
    while ((n = walker.nextNode())) {
        if (rest <= n.nodeValue.length) { node = n; break; }
        rest -= n.nodeValue.length;
    }
    const r = document.createRange();
    if (node) r.setStart(node, rest);
    else { r.selectNodeContents(el); r.collapse(false); }
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
}

// Rendered text drops the markdown syntax, so a caret placed by clicking
// rendered output has to be walked back onto the source. The visible text
// is a subsequence of the source for everything we render, so a greedy
// alignment lands on the right character.
function vlpMapToSource(src, visible, vOff) {
    let i = 0, v = 0;
    while (i < src.length && v < vOff) {
        if (src[i] === visible[v]) v++;
        i++;
    }
    return i;
}

// ── Switching the active block ──────────────────────────────────────
function vlpCommit(b) {
    if (!b) return;
    b.dataset.src = vlpReadSrc(b);
    vlpShowRendered(b);
}

function vlpActivate(b, off) {
    if (!b || b === vlpActive) return;
    const prev = vlpActive;
    vlpActive = b;
    if (prev && prev.isConnected) vlpCommit(prev);
    vlpShowSource(b);
    vlpPutCaret(b, Math.min(off, (b.dataset.src || '').length));
}

function vlpSync() {
    if (!vlpEl || vlpMuted) return;
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const node = sel.anchorNode;
    if (!node || !vlpEl.contains(node)) return;
    const b = vlpBlockOf(node);
    if (!b || b === vlpActive) return;
    const rendered = b.dataset.r === '1';
    const off      = vlpOffsetIn(b);
    vlpActivate(b, rendered ? vlpMapToSource(b.dataset.src || '', b.textContent || '', off) : off);
}

// ── Whole-document offsets (used by paste, undo and the AI actions) ──
function vlpGlobalCaret() {
    const blocks = vlpBlocks();
    const b = vlpActive && vlpActive.isConnected ? vlpActive : null;
    if (!b) return vaultLiveGetText().length;
    let off = 0;
    for (const x of blocks) {
        if (x === b) break;
        off += (x.dataset.src || '').length + 1;
    }
    return off + vlpOffsetIn(b);
}

function vlpBuild(text) {
    vlpMuted  = true;
    vlpActive = null;
    vlpEl.innerHTML = '';
    vlpSplitBlocks(text).forEach(({ src, multi }) => {
        const b = document.createElement('div');
        b.className   = 'vlp-b';
        b.dataset.src = src;
        if (multi) b.dataset.multi = '1';
        vlpShowRendered(b);
        vlpEl.appendChild(b);
    });
    vlpMuted = false;
}

function vlpFocusOffset(caret) {
    const blocks = vlpBlocks();
    let off = 0;
    for (const b of blocks) {
        const len = (b.dataset.src || '').length;
        if (caret <= off + len) { vlpActivate(b, caret - off); return; }
        off += len + 1;
    }
    const last = blocks[blocks.length - 1];
    if (last) vlpActivate(last, (last.dataset.src || '').length);
}

function vaultLiveSetText(text, caret) {
    if (!vlpEl) return;
    vlpBuild(text);
    if (typeof caret === 'number') { vlpEl.focus(); vlpFocusOffset(caret); }
    vlpChanged();
}

// Re-split the whole document, keeping the caret where it was. Needed when
// an edit changes how lines group — opening a fence, starting a table.
function vlpReflow() {
    const caret = vlpGlobalCaret();
    const text  = vaultLiveGetText();
    vlpBuild(text);
    vlpFocusOffset(caret);
}

function vlpNeedsReflow(src) {
    return vlpIsFence(src) || src.trim().startsWith('$$') || src.includes('|');
}

// ── Change plumbing ─────────────────────────────────────────────────
function vlpChanged() {
    if (vlpMuted) return;
    clearTimeout(vlpUndoTimer);
    vlpUndoTimer = setTimeout(vlpPushUndo, 500);
    if (vlpOnChange) vlpOnChange(vaultLiveGetText());
}

function vlpPushUndo() {
    const text = vaultLiveGetText();
    if (text === vlpLastSnap) return;
    vlpUndo.push({ text: vlpLastSnap, caret: vlpGlobalCaret() });
    if (vlpUndo.length > 200) vlpUndo.shift();
    vlpRedo.length = 0;
    vlpLastSnap = text;
}

function vlpDoUndo(redo) {
    clearTimeout(vlpUndoTimer);
    const from = redo ? vlpRedo : vlpUndo;
    if (!from.length) return;
    const cur  = { text: vaultLiveGetText(), caret: vlpGlobalCaret() };
    const snap = from.pop();
    (redo ? vlpUndo : vlpRedo).push(cur);
    vlpLastSnap = snap.text;
    vaultLiveSetText(snap.text, snap.caret);
}

// ── Key handling ────────────────────────────────────────────────────
// Enter, Backspace-at-start and Delete-at-end move text between blocks,
// so they are handled here rather than left to contenteditable.
function vlpOnKeyDown(e) {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); vlpDoUndo(e.shiftKey); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); vlpDoUndo(true); return; }
    if (mod) return;

    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const b = vlpBlockOf(sel.anchorNode);
    if (!b) return;
    if (b !== vlpActive) vlpSync();
    const cur = vlpActive;
    if (!cur) return;
    const collapsed = sel.isCollapsed;

    if (e.key === 'Enter') {
        e.preventDefault();
        vlpPushUndo();
        const src = vlpReadSrc(cur);
        const off = vlpOffsetIn(cur);
        // Inside a fence / math block / table, Enter adds a line to the block.
        if (cur.dataset.multi === '1' && !e.shiftKey) {
            cur.dataset.src = src.slice(0, off) + '\n' + src.slice(off);
            cur.textContent = cur.dataset.src;
            vlpPutCaret(cur, off + 1);
            vlpChanged();
            return;
        }
        let left  = src.slice(0, off);
        let right = src.slice(off);
        let prefix = '';
        const m = left.match(/^(\s*)([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/);
        if (m && !e.shiftKey) {
            if (left.trim() === m[0].trim()) {
                left = '';                       // empty item — Enter ends the list
            } else {
                const mark = /^\d/.test(m[2])
                    ? (parseInt(m[2], 10) + 1) + m[2].slice(-1)
                    : m[2];
                prefix = m[1] + mark + ' ' + (m[3] ? '[ ] ' : '');
            }
        }
        cur.dataset.src = left;
        const nb = document.createElement('div');
        nb.className   = 'vlp-b';
        nb.dataset.src = prefix + right;
        vlpShowRendered(nb);
        cur.after(nb);
        // Render from dataset.src, not from the DOM: the text still on screen
        // is the whole line, and `left` is only the part that stays here.
        vlpActive = null;
        vlpShowRendered(cur);
        vlpActivate(nb, prefix.length);
        if (vlpNeedsReflow(left) || vlpNeedsReflow(nb.dataset.src)) vlpReflow();
        vlpChanged();
        return;
    }

    if (e.key === 'Backspace' && collapsed && vlpOffsetIn(cur) === 0) {
        const prev = cur.previousElementSibling;
        if (!prev || !prev.classList.contains('vlp-b')) return;
        e.preventDefault();
        vlpPushUndo();
        const prevSrc = prev.dataset.src || '';
        const merged  = prevSrc + vlpReadSrc(cur);
        cur.remove();
        vlpActive = null;
        prev.dataset.src = merged;
        vlpShowRendered(prev);
        vlpActivate(prev, prevSrc.length);
        vlpChanged();
        return;
    }

    if (e.key === 'Delete' && collapsed) {
        const src = vlpReadSrc(cur);
        if (vlpOffsetIn(cur) !== src.length) return;
        const next = cur.nextElementSibling;
        if (!next || !next.classList.contains('vlp-b')) return;
        e.preventDefault();
        vlpPushUndo();
        cur.dataset.src = src + (next.dataset.src || '');
        next.remove();
        vlpShowSource(cur);
        vlpPutCaret(cur, src.length);
        vlpChanged();
        return;
    }

    if (e.key === 'Tab') {
        e.preventDefault();
        const src = vlpReadSrc(cur);
        const off = vlpOffsetIn(cur);
        if (e.shiftKey) {
            const m = src.match(/^(\s{1,2})/);
            if (!m) return;
            cur.dataset.src = src.slice(m[1].length);
            cur.textContent = cur.dataset.src;
            vlpPutCaret(cur, Math.max(0, off - m[1].length));
        } else {
            cur.dataset.src = '  ' + src;
            cur.textContent = cur.dataset.src;
            vlpPutCaret(cur, off + 2);
        }
        vlpChanged();
    }
}

function vlpOnPaste(e) {
    const text = e.clipboardData ? e.clipboardData.getData('text/plain') : '';
    if (!text) return;
    e.preventDefault();
    vlpPushUndo();
    const clean = text.replace(/\r\n?/g, '\n');
    if (!clean.includes('\n') && vlpActive) {
        const src = vlpReadSrc(vlpActive);
        const off = vlpOffsetIn(vlpActive);
        vlpActive.dataset.src = src.slice(0, off) + clean + src.slice(off);
        vlpActive.textContent = vlpActive.dataset.src;
        vlpPutCaret(vlpActive, off + clean.length);
        vlpChanged();
        return;
    }
    const caret = vlpGlobalCaret();
    const all   = vaultLiveGetText();
    vaultLiveSetText(all.slice(0, caret) + clean + all.slice(caret), caret + clean.length);
}

// A keystroke aimed at a rendered block would land in HTML we are about to
// throw away. Swap that block to source before the browser applies the edit.
function vlpOnBeforeInput(e) {
    if (!vlpEl || vlpMuted) return;
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const b = vlpBlockOf(sel.anchorNode);
    if (!b || b === vlpActive) return;
    // Swapping the block to source pulls the DOM out from under the browser's
    // pending insertion, so type the character in ourselves.
    if (e.inputType === 'insertText' && e.data != null) {
        e.preventDefault();
        vlpSync();
        if (!vlpActive) return;
        const src = vlpReadSrc(vlpActive);
        const off = vlpOffsetIn(vlpActive);
        vlpActive.dataset.src = src.slice(0, off) + e.data + src.slice(off);
        vlpActive.textContent = vlpActive.dataset.src;
        vlpPutCaret(vlpActive, off + e.data.length);
        vlpChanged();
        return;
    }
    vlpSync();
}

// Text that landed in a rendered block — an input with no beforeinput to
// intercept (execCommand, some IME paths). Diff the block against a fresh
// render of its source to find what was inserted, and put it in the source
// instead of losing it on the next render.
function vlpRecoverStray(b) {
    const probe = document.createElement('div');
    probe.innerHTML = vlpRenderHTML(b.dataset.src || '');
    const oldV = probe.textContent || '';
    const newV = b.textContent || '';
    const prev = vlpActive;
    vlpActive = null;
    if (prev && prev !== b && prev.isConnected) vlpCommit(prev);
    if (newV === oldV) { vlpShowRendered(b); vlpActivate(b, 0); return; }
    let p = 0;
    while (p < oldV.length && p < newV.length && oldV[p] === newV[p]) p++;
    let sfx = 0;
    while (sfx < oldV.length - p && sfx < newV.length - p
           && oldV[oldV.length - 1 - sfx] === newV[newV.length - 1 - sfx]) sfx++;
    const ins   = newV.slice(p, newV.length - sfx);
    const src   = b.dataset.src || '';
    const start = vlpMapToSource(src, oldV, p);
    const end   = vlpMapToSource(src, oldV, oldV.length - sfx);
    b.dataset.src = src.slice(0, start) + ins + src.slice(end);
    vlpShowRendered(b);
    vlpActivate(b, start + ins.length);
}

function vlpOnInput() {
    if (vlpMuted) return;
    const sel = window.getSelection();
    const hit = (sel && sel.rangeCount) ? vlpBlockOf(sel.anchorNode) : null;
    if (hit && hit !== vlpActive) { vlpRecoverStray(hit); vlpChanged(); return; }
    if (!vlpActive || !vlpActive.isConnected) { vlpSync(); }
    if (vlpActive) {
        const src = vlpReadSrc(vlpActive);
        vlpActive.dataset.src = src;
        // The browser can leave a wrapper div behind after a multi-line
        // edit; re-splitting keeps one line per block.
        if (src.includes('\n') && vlpActive.dataset.multi !== '1') { vlpReflow(); vlpChanged(); return; }
    }
    vlpChanged();
}

// Checkboxes stay clickable in rendered blocks, like Obsidian's live preview.
function vlpOnClick(e) {
    const cb = e.target.closest && e.target.closest('.vmd-cb');
    if (cb) {
        const b = vlpBlockOf(cb);
        if (b && b !== vlpActive) {
            e.preventDefault();
            vlpPushUndo();
            const src = b.dataset.src || '';
            b.dataset.src = /\[[xX]\]/.test(src)
                ? src.replace(/\[[xX]\]/, '[ ]')
                : src.replace(/\[\s\]/, '[x]');
            vlpShowRendered(b);
            vlpChanged();
            return;
        }
    }
    if (e.target.closest && e.target.closest('a')) return;  // links do their own thing
    setTimeout(vlpSync, 0);
}

function vlpOnSelectionChange() {
    if (!vlpEl || !vlpEl.isConnected) return;
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    if (!vlpEl.contains(sel.anchorNode)) return;
    vlpSync();
}

// ── Mount / unmount ─────────────────────────────────────────────────
function vaultLiveMount(host, text, onChange, focus) {
    vlpEnsureStyle();
    vaultLiveUnmount();
    vlpEl = document.createElement('div');
    vlpEl.id = 'vault-live-editor';
    vlpEl.className = 'vmd-wrap vlp';
    vlpEl.contentEditable = 'true';
    vlpEl.spellcheck = false;
    vlpEl.setAttribute('autocorrect', 'off');
    host.appendChild(vlpEl);

    vlpOnChange = onChange || null;
    vlpUndo = []; vlpRedo = []; vlpLastSnap = String(text || '');
    vlpBuild(text || '');

    vlpEl.addEventListener('keydown', vlpOnKeyDown);
    vlpEl.addEventListener('paste',   vlpOnPaste);
    vlpEl.addEventListener('beforeinput', vlpOnBeforeInput);
    vlpEl.addEventListener('input',   vlpOnInput);
    vlpEl.addEventListener('click',   vlpOnClick);
    vlpEl.addEventListener('blur',    () => { if (vlpActive) { const b = vlpActive; vlpActive = null; vlpCommit(b); } });
    document.addEventListener('selectionchange', vlpOnSelectionChange);

    // Land the caret on the first line so typing works straight away — unless
    // the caller is refreshing the note behind the user's back.
    if (focus !== false) {
        vlpEl.focus();
        const first = vlpBlocks()[0];
        if (first) vlpActivate(first, (first.dataset.src || '').length);
    }
    return vlpEl;
}

function vaultLiveUnmount() {
    document.removeEventListener('selectionchange', vlpOnSelectionChange);
    clearTimeout(vlpUndoTimer);
    // Drop the old editor rather than leaving a second one in the host.
    if (vlpEl && vlpEl.isConnected) vlpEl.remove();
    vlpEl = null; vlpActive = null; vlpOnChange = null;
    vlpUndo = []; vlpRedo = []; vlpLastSnap = '';
}

function vaultLiveIsMounted() { return !!(vlpEl && vlpEl.isConnected); }

// ── Selection API for the AI writing actions ────────────────────────
function vaultLiveGetSelection() {
    const all = vaultLiveGetText();
    const sel = window.getSelection();
    const focused = vlpEl && sel && sel.rangeCount && vlpEl.contains(sel.anchorNode);
    if (!focused) return { start: all.length, end: all.length, text: '', all };
    if (sel.isCollapsed) { const c = vlpGlobalCaret(); return { start: c, end: c, text: '', all }; }
    const text = sel.toString();
    const end  = vlpGlobalCaret();
    // The caret sits at the focus end; the selection covers the visible text
    // before it. Rendered blocks hide syntax, so this is the text as shown.
    const start = Math.max(0, end - text.length);
    return { start, end, text, all };
}

function vaultLiveReplaceRange(start, end, text) {
    const all = vaultLiveGetText();
    const s = Math.max(0, Math.min(start, all.length));
    const e = Math.max(s, Math.min(end, all.length));
    vaultLiveSetText(all.slice(0, s) + text + all.slice(e), s + text.length);
}
