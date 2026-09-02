// ── PDF annotation layer ───────────────────────────────────────────────
// Marking up a PDF in the vault: highlight, draw, and drop text notes on the
// page itself. Depends on: vault.js (vaultData, vaultOpenFileId, saveVaultData,
// getPDFScrollEl, pdfScale) and pdf.js for the page render underneath.
//
// Nothing is written into the PDF file. Marks live in vault.json alongside the
// file's other metadata, as `file.annots = { "<page>": [mark, …] }`, so the
// original stays byte-identical and a mark can always be taken back off.
//
// Every coordinate is stored 0..1 relative to the page box, never in pixels.
// That is what lets a mark survive zooming, the fit-width recalculation and a
// window resize — all of which change the pixel size of the same page.
(function () {
    const TOOLS = ['none', 'highlight', 'pen', 'text', 'erase'];
    const COLORS = ['#facc15', '#f87171', '#4ade80', '#60a5fa', '#c084fc', '#ffffff'];

    let tool  = 'none';
    let color = '#facc15';
    let drawing = null;           // in-progress mark
    let saveTimer = null;

    const file = () => {
        try {
            return (typeof vaultOpenFileId !== 'undefined' && vaultOpenFileId && typeof vaultData !== 'undefined')
                ? vaultData.files.find(f => f.id === vaultOpenFileId) : null;
        } catch (_) { return null; }
    };

    // `create` only when a mark is actually going in. Painting a page must not
    // allocate an entry for it — scrolling a 300-page PDF would otherwise leave
    // 300 empty arrays in vault.json for every file you opened.
    function marksFor(page, create) {
        const f = file();
        if (!f) return [];
        if (!f.annots) {
            if (!create) return EMPTY;
            f.annots = {};
        }
        if (!Array.isArray(f.annots[page])) {
            if (!create) return EMPTY;
            f.annots[page] = [];
        }
        return f.annots[page];
    }
    const EMPTY = [];   // shared read-only stand-in; never written to

    // Debounced: a pen stroke is a lot of points and the vault index is shared
    // with every other window, so this must not fire on every pointermove.
    function save() {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            try { saveVaultData(); } catch (e) { console.error('[pdf-annot] save:', e); }
            setStatus('saved');
        }, 500);
        setStatus('saving…');
    }

    function setStatus(text) {
        const el = document.getElementById('vault-annot-status');
        if (el) el.textContent = text;
    }

    // ── Painting ───────────────────────────────────────────────────────
    // Called after a page canvas is painted, and again whenever its marks
    // change. `w`/`h` are the page's current pixel size.
    function paint(pageNum, layer, w, h) {
        const ctx = layer.getContext('2d');
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, layer.width, layer.height);
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        const all = marksFor(pageNum).slice();
        if (drawing && drawing.page === pageNum) all.push(drawing);

        for (const m of all) {
            if (m.type === 'highlight') {
                ctx.globalAlpha = 0.32;
                ctx.fillStyle = m.color;
                ctx.fillRect(m.x * w, m.y * h, m.w * w, m.h * h);
                ctx.globalAlpha = 1;
            } else if (m.type === 'pen') {
                if (!m.pts || m.pts.length < 2) continue;
                ctx.strokeStyle = m.color;
                ctx.lineWidth = (m.width || 0.003) * w;
                ctx.lineJoin = ctx.lineCap = 'round';
                ctx.beginPath();
                ctx.moveTo(m.pts[0][0] * w, m.pts[0][1] * h);
                for (let i = 1; i < m.pts.length; i++) ctx.lineTo(m.pts[i][0] * w, m.pts[i][1] * h);
                ctx.stroke();
            } else if (m.type === 'text') {
                const size = (m.size || 0.022) * h;
                ctx.font = `600 ${size}px Inter, system-ui, sans-serif`;
                ctx.textBaseline = 'top';
                const pad = size * 0.32;
                const tw = ctx.measureText(m.text).width;
                ctx.fillStyle = 'rgba(15,20,30,0.82)';
                ctx.fillRect(m.x * w - pad, m.y * h - pad, tw + pad * 2, size + pad * 2);
                ctx.fillStyle = m.color;
                ctx.fillText(m.text, m.x * w, m.y * h);
            }
        }
    }

    // Repaint one page (or all rendered pages) from current data.
    function refresh(pageNum) {
        document.querySelectorAll('#vault-pdf-pages [data-page-num]').forEach(w => {
            const n = parseInt(w.dataset.pageNum, 10);
            if (pageNum && n !== pageNum) return;
            const layer = w.querySelector('.pdf-annot-layer');
            if (layer) paint(n, layer, w.clientWidth, w.clientHeight);
        });
    }

    // ── The layer on each page ─────────────────────────────────────────
    // vault.js calls this once a page's canvas exists. The layer sits above the
    // text layer so marks are visible, and only takes pointer events while a
    // tool is armed — otherwise text selection would stop working.
    function attach(wrapper, pageNum, w, h) {
        let layer = wrapper.querySelector('.pdf-annot-layer');
        if (!layer) {
            layer = document.createElement('canvas');
            layer.className = 'pdf-annot-layer';
            layer.style.cssText = 'position:absolute;inset:0;z-index:3';
            wrapper.appendChild(layer);
            wire(layer, pageNum);
        }
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        layer.width  = Math.floor(w * dpr);
        layer.height = Math.floor(h * dpr);
        layer.style.width  = w + 'px';
        layer.style.height = h + 'px';
        layer.dataset.pageNum = pageNum;
        layer.style.pointerEvents = tool === 'none' ? 'none' : 'auto';
        layer.style.cursor = tool === 'erase' ? 'not-allowed' : (tool === 'none' ? '' : 'crosshair');
        paint(pageNum, layer, w, h);
        return layer;
    }

    function wire(layer, pageNum) {
        const pos = e => {
            const r = layer.getBoundingClientRect();
            return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
        };
        const page = () => parseInt(layer.dataset.pageNum, 10) || pageNum;

        layer.addEventListener('pointerdown', e => {
            if (tool === 'none') return;
            e.preventDefault();
            const [x, y] = pos(e);

            if (tool === 'erase') {
                eraseAt(page(), x, y);
                return;
            }
            if (tool === 'text') {
                addText(page(), x, y);
                return;
            }
            layer.setPointerCapture(e.pointerId);
            drawing = tool === 'pen'
                ? { type: 'pen', color, width: 0.0035, pts: [[x, y]], page: page() }
                : { type: 'highlight', color, x, y, w: 0, h: 0, _ox: x, _oy: y, page: page() };
        });

        layer.addEventListener('pointermove', e => {
            if (!drawing || drawing.page !== page()) return;
            const [x, y] = pos(e);
            if (drawing.type === 'pen') {
                const last = drawing.pts[drawing.pts.length - 1];
                // Skip micro-moves so a stroke doesn't become thousands of points.
                if (Math.hypot(x - last[0], y - last[1]) < 0.0015) return;
                drawing.pts.push([x, y]);
            } else {
                drawing.x = Math.min(x, drawing._ox);
                drawing.y = Math.min(y, drawing._oy);
                drawing.w = Math.abs(x - drawing._ox);
                drawing.h = Math.abs(y - drawing._oy);
            }
            paint(page(), layer, layer.clientWidth, layer.clientHeight);
        });

        const finish = () => {
            if (!drawing) return;
            const m = drawing;
            drawing = null;
            const keep = m.type === 'pen'
                ? (m.pts.length > 1)
                : (m.w > 0.004 && m.h > 0.004);      // ignore a stray click
            if (keep) {
                delete m._ox; delete m._oy;
                const p = m.page; delete m.page;
                marksFor(p, true).push(m);
                save();
            }
            refresh(page());
        };
        layer.addEventListener('pointerup', finish);
        layer.addEventListener('pointercancel', finish);
    }

    function eraseAt(pageNum, x, y) {
        const list = marksFor(pageNum);
        // Topmost first, so erasing removes what you can actually see.
        for (let i = list.length - 1; i >= 0; i--) {
            if (hits(list[i], x, y)) {
                list.splice(i, 1);
                save();
                refresh(pageNum);
                return;
            }
        }
    }

    function hits(m, x, y) {
        if (m.type === 'highlight') {
            return x >= m.x - 0.004 && x <= m.x + m.w + 0.004
                && y >= m.y - 0.004 && y <= m.y + m.h + 0.004;
        }
        if (m.type === 'text') {
            // Size the box to the note. A fixed width meant a three-word note
            // claimed the same area as a long one, so clicking near two notes
            // erased whichever happened to be later in the list.
            const size = m.size || 0.022;
            const w = Math.max(0.03, m.text.length * size * 0.55);
            const pad = size * 0.4;
            return x >= m.x - pad && x <= m.x + w + pad
                && y >= m.y - pad && y <= m.y + size + pad;
        }
        if (m.type === 'pen') {
            return (m.pts || []).some(p => Math.hypot(p[0] - x, p[1] - y) < 0.012);
        }
        return false;
    }

    async function addText(pageNum, x, y) {
        let text = '';
        try {
            text = await vulsorPrompt('Note on page ' + pageNum, '', {
                placeholder: 'Type the note…', confirmLabel: 'Place',
            });
        } catch (_) { return; }
        if (text == null) return;
        text = String(text).trim();
        if (!text) return;
        marksFor(pageNum, true).push({ type: 'text', x, y, text, color, size: 0.022 });
        save();
        refresh(pageNum);
    }

    // ── Toolbar ────────────────────────────────────────────────────────
    function setTool(next) {
        tool = TOOLS.includes(next) ? next : 'none';
        document.querySelectorAll('[data-annot-tool]').forEach(b => {
            const on = b.dataset.annotTool === tool;
            b.classList.toggle('active', on);
            b.style.background = on ? 'var(--accent,#dc2626)' : '';
            b.style.color = on ? '#fff' : '';
        });
        // Only capture the pointer while a tool is armed, so selecting text and
        // scrolling keep working the rest of the time.
        document.querySelectorAll('.pdf-annot-layer').forEach(l => {
            l.style.pointerEvents = tool === 'none' ? 'none' : 'auto';
            l.style.cursor = tool === 'erase' ? 'not-allowed' : (tool === 'none' ? '' : 'crosshair');
        });
        const bar = document.getElementById('vault-annot-colors');
        if (bar) bar.style.display = (tool === 'none' || tool === 'erase') ? 'none' : '';
    }

    function setColor(c) {
        color = c;
        document.querySelectorAll('[data-annot-color]').forEach(b => {
            b.style.outline = b.dataset.annotColor === c ? '2px solid #fff' : '';
            b.style.outlineOffset = '1px';
        });
    }

    function clearPage() {
        const n = (typeof pdfPageNum !== 'undefined') ? pdfPageNum : 1;
        const list = marksFor(n);
        if (!list.length) { setStatus('nothing on this page'); return; }
        if (!confirm(`Remove all ${list.length} mark${list.length !== 1 ? 's' : ''} from page ${n}?`)) return;
        list.length = 0;
        save();
        refresh(n);
    }

    function undo() {
        const n = (typeof pdfPageNum !== 'undefined') ? pdfPageNum : 1;
        const list = marksFor(n);
        if (!list.length) { setStatus('nothing to undo on this page'); return; }
        list.pop();
        save();
        refresh(n);
    }

    function initToolbar() {
        document.querySelectorAll('[data-annot-tool]').forEach(b => {
            b.addEventListener('click', () => setTool(b.dataset.annotTool === tool ? 'none' : b.dataset.annotTool));
        });
        const colors = document.getElementById('vault-annot-colors');
        if (colors && !colors.dataset.built) {
            colors.dataset.built = '1';
            colors.innerHTML = COLORS.map(c =>
                `<button data-annot-color="${c}" title="${c}" style="width:16px;height:16px;border-radius:50%;border:1px solid rgba(255,255,255,.25);background:${c};cursor:pointer"></button>`
            ).join('');
            colors.querySelectorAll('[data-annot-color]').forEach(b => {
                b.addEventListener('click', () => setColor(b.dataset.annotColor));
            });
        }
        document.getElementById('vault-annot-undo')?.addEventListener('click', undo);
        document.getElementById('vault-annot-clear')?.addEventListener('click', clearPage);
        setTool('none');
        setColor(color);
    }

    // Leaving one PDF for another must not carry a tool over.
    function reset() { setTool('none'); setStatus(''); }

    window.pdfAnnot = { attach, refresh, setTool, initToolbar, reset, get tool() { return tool; } };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initToolbar);
    else initToolbar();
})();
