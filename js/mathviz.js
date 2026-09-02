// ── Math & Visual rendering for AI chat ────────────────────────────────────
// Lets the AI's chat replies render real mathematics and figures:
//   • $ ... $ / $$ ... $$           → KaTeX equations
//   • ```plot  …  ```               → function graphs on a canvas (y = f(x))
//   • ```geometry  { … }  ```       → triangles / polygons / circles / etc. as SVG
//
// Self-contained: depends only on the `katex` npm module (already a dependency)
// and the bundled css/katex-fonts. Exposes mvFormatRich() + mvRenderPending(),
// used by ui.js (addMessageToUI).
'use strict';

/* ════════════════════════════════════════════════════════════════════════
   SMALL HELPERS
════════════════════════════════════════════════════════════════════════ */
function _mvEscapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function _mvEscapeAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
// Unicode-safe base64 so arbitrary block bodies survive a data-* attribute.
function _mvEnc(s) { return btoa(unescape(encodeURIComponent(String(s)))); }
function _mvDec(s) { try { return decodeURIComponent(escape(atob(String(s)))); } catch (_) { return ''; } }

const _MV_PALETTE = ['#38bdf8', '#f87171', '#4ade80', '#fbbf24', '#c084fc', '#fb923c', '#34d399', '#e879f9'];

/* ════════════════════════════════════════════════════════════════════════
   RICH FORMATTER  — turns AI text into HTML with deferred-render placeholders
════════════════════════════════════════════════════════════════════════ */
function mvFormatRich(text) {
    const blocks = [];
    // Private-use sentinels won't collide with markdown or appear in model output.
    const stash = (html) => `MV${blocks.push(html) - 1}`;

    let t = String(text);

    // Function plots:  ```plot  …  ```   (also accepts ```graph)
    t = t.replace(/```(?:plot|graph)[ \t]*\r?\n([\s\S]*?)```/gi,
        (_, body) => stash(`<div class="mv-plot-pending" data-src="${_mvEnc(body)}"></div>`));

    // Geometry / figures:  ```geometry { … } ```  (also geom / shape / shapes)
    t = t.replace(/```(?:geometry|geom|shapes?|figure)[ \t]*\r?\n([\s\S]*?)```/gi,
        (_, body) => stash(`<div class="mv-geo-pending" data-src="${_mvEnc(body)}"></div>`));

    // Generic fenced code (escaped, same look as the old formatText)
    t = t.replace(/```(\w*)\r?\n?([\s\S]*?)```/g, (_, lang, code) => stash(
        `<pre class="bg-slate-950 p-3 rounded-xl my-2 font-mono text-xs border border-slate-800 overflow-x-auto select-text leading-relaxed" style="color:var(--accent-light)"><code>${_mvEscapeHtml(code.trim())}</code></pre>`));

    // Display math  $$ … $$
    t = t.replace(/\$\$([\s\S]+?)\$\$/g,
        (_, tex) => stash(`<span class="mv-math-pending" data-display="1" data-tex="${_mvEscapeAttr(tex.trim())}"></span>`));

    // Inline math  $ … $   (single line, non-empty, not an empty $$)
    t = t.replace(/\$([^$\n]+?)\$/g,
        (_, tex) => stash(`<span class="mv-math-pending" data-tex="${_mvEscapeAttr(tex.trim())}"></span>`));

    // Inline markdown on the remaining prose
    t = t
        .replace(/`([^`]+)`/g, '<code class="bg-slate-950 px-1.5 py-0.5 rounded text-xs font-mono" style="color:var(--accent-light)">$1</code>')
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/\n/g, '<br>');

    // Restore the protected blocks
    return t.replace(/MV(\d+)/g, (_, i) => blocks[+i] || '');
}

// Render every deferred widget that lives inside `container` (call after it is
// attached to the DOM so canvases/SVGs can measure their width).
function mvRenderPending(container) {
    if (!container) return;
    try { _mvRenderMath(container); } catch (_) {}
    container.querySelectorAll('.mv-plot-pending').forEach(el => {
        try { _mvRenderPlot(el, _mvDec(el.dataset.src)); } catch (e) { _mvErr(el, e); }
        el.classList.remove('mv-plot-pending');
    });
    container.querySelectorAll('.mv-geo-pending').forEach(el => {
        try { _mvRenderGeometry(el, _mvDec(el.dataset.src)); } catch (e) { _mvErr(el, e); }
        el.classList.remove('mv-geo-pending');
    });
}

function _mvErr(el, e) {
    el.innerHTML = `<div class="text-xs font-mono text-red-400 bg-slate-950 border border-red-900/50 rounded-lg px-3 py-2 my-1">⚠ ${_mvEscapeHtml(e.message || e)}</div>`;
}

/* ════════════════════════════════════════════════════════════════════════
   KATEX MATH
════════════════════════════════════════════════════════════════════════ */
let _mvKatex = null;
function _mvEnsureKatexFonts() {
    if (document.getElementById('katex-abs-fonts')) return;   // vault.js may have added it already
    const fontDir = require('path').join(__dirname, '..', 'css', 'katex-fonts').replace(/\\/g, '/');
    const base = `file://${fontDir.startsWith('/') ? '' : '/'}${fontDir}`;
    const faces = [
        ['KaTeX_Main', 'normal', 400, 'KaTeX_Main-Regular'], ['KaTeX_Main', 'italic', 400, 'KaTeX_Main-Italic'],
        ['KaTeX_Main', 'normal', 700, 'KaTeX_Main-Bold'], ['KaTeX_Main', 'italic', 700, 'KaTeX_Main-BoldItalic'],
        ['KaTeX_Math', 'italic', 400, 'KaTeX_Math-Italic'], ['KaTeX_Math', 'italic', 700, 'KaTeX_Math-BoldItalic'],
        ['KaTeX_AMS', 'normal', 400, 'KaTeX_AMS-Regular'],
        ['KaTeX_Caligraphic', 'normal', 400, 'KaTeX_Caligraphic-Regular'], ['KaTeX_Caligraphic', 'normal', 700, 'KaTeX_Caligraphic-Bold'],
        ['KaTeX_Fraktur', 'normal', 400, 'KaTeX_Fraktur-Regular'], ['KaTeX_Fraktur', 'normal', 700, 'KaTeX_Fraktur-Bold'],
        ['KaTeX_SansSerif', 'normal', 400, 'KaTeX_SansSerif-Regular'], ['KaTeX_SansSerif', 'normal', 700, 'KaTeX_SansSerif-Bold'],
        ['KaTeX_SansSerif', 'italic', 400, 'KaTeX_SansSerif-Italic'],
        ['KaTeX_Script', 'normal', 400, 'KaTeX_Script-Regular'], ['KaTeX_Typewriter', 'normal', 400, 'KaTeX_Typewriter-Regular'],
        ['KaTeX_Size1', 'normal', 400, 'KaTeX_Size1-Regular'], ['KaTeX_Size2', 'normal', 400, 'KaTeX_Size2-Regular'],
        ['KaTeX_Size3', 'normal', 400, 'KaTeX_Size3-Regular'], ['KaTeX_Size4', 'normal', 400, 'KaTeX_Size4-Regular'],
    ];
    const css = faces.map(([fam, st, w, file]) =>
        `@font-face{font-family:"${fam}";font-style:${st};font-weight:${w};font-display:block;` +
        `src:url("${base}/${file}.woff2") format("woff2"),url("${base}/${file}.woff") format("woff"),url("${base}/${file}.ttf") format("truetype")}`
    ).join('\n');
    const style = document.createElement('style');
    style.id = 'katex-abs-fonts';
    style.textContent = css;
    document.head.appendChild(style);
}

function _mvRenderMath(container) {
    const pending = container.querySelectorAll('.mv-math-pending');
    if (!pending.length) return;
    if (!_mvKatex) { try { _mvKatex = require('katex'); } catch (_) { return; } }
    _mvEnsureKatexFonts();
    pending.forEach(el => {
        const tex = el.dataset.tex || '';
        const display = el.dataset.display === '1';
        try {
            _mvKatex.render(tex, el, { displayMode: display, throwOnError: false, output: 'html', trust: true, strict: false });
        } catch (_) {
            el.textContent = tex;
            el.style.color = '#f87171';
        }
        el.classList.remove('mv-math-pending');
    });
}

/* ════════════════════════════════════════════════════════════════════════
   EXPRESSION ENGINE  — compiles "sin(x)+x^2" to a JS function, no eval
════════════════════════════════════════════════════════════════════════ */
const _MV_FUNCS = {
    sin: Math.sin, cos: Math.cos, tan: Math.tan,
    asin: Math.asin, acos: Math.acos, atan: Math.atan,
    sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
    sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs,
    exp: Math.exp, ln: Math.log, log: x => Math.log(x) / Math.LN10,
    log10: x => Math.log(x) / Math.LN10, log2: Math.log2,
    floor: Math.floor, ceil: Math.ceil, round: Math.round,
    sign: Math.sign, trunc: Math.trunc,
};
const _MV_CONSTS = { pi: Math.PI, e: Math.E, tau: Math.PI * 2 };

// Recursive-descent parser → closure (x => number). Supports + - * / ^,
// parentheses, unary minus, named functions, constants and implicit
// multiplication (2x, 3sin(x), (x+1)(x-1)).
function mvCompile(src) {
    const s = String(src).replace(/\s+/g, '');
    let i = 0;
    const eof = () => i >= s.length;
    const ch = () => s[i];

    function parseExpr() {           // + and -
        let f = parseTerm();
        while (!eof() && (ch() === '+' || ch() === '-')) {
            const op = s[i++]; const r = parseTerm();
            const l = f; f = op === '+' ? x => l(x) + r(x) : x => l(x) - r(x);
        }
        return f;
    }
    function parseTerm() {           // * / and implicit *
        let f = parseUnary();
        while (!eof()) {
            const c = ch();
            if (c === '*' || c === '/') {
                i++; const r = parseUnary(); const l = f;
                f = c === '*' ? x => l(x) * r(x) : x => l(x) / r(x);
            } else if (/[0-9.a-zA-Z(]/.test(c)) {   // implicit multiply: 2x, (a)(b)
                const r = parseUnary(); const l = f; f = x => l(x) * r(x);
            } else break;
        }
        return f;
    }
    function parseUnary() {           // unary - binds looser than ^, so -x^2 = -(x^2)
        if (!eof() && (ch() === '-' || ch() === '+')) {
            const op = s[i++]; const r = parseUnary();
            return op === '-' ? x => -r(x) : r;
        }
        return parsePower();
    }
    function parsePower() {           // ^ right-associative; exponent may be unary (2^-x)
        const base = parsePrimary();
        if (!eof() && ch() === '^') { i++; const exp = parseUnary(); return x => Math.pow(base(x), exp(x)); }
        return base;
    }
    function parsePrimary() {
        if (eof()) throw new Error('Unexpected end of expression');
        const c = ch();
        if (c === '(') {
            i++; const e = parseExpr();
            if (ch() !== ')') throw new Error('Missing )');
            i++; return e;
        }
        // number (incl. 1.5, .5, 1e3)
        const num = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(s.slice(i));
        if (num) { i += num[0].length; const v = parseFloat(num[0]); return () => v; }
        // identifier: function call, constant, or variable
        const id = /^[a-zA-Z_]\w*/.exec(s.slice(i));
        if (id) {
            const name = id[0]; i += name.length;
            if (!eof() && ch() === '(') {
                i++; const args = [parseExpr()];
                while (!eof() && ch() === ',') { i++; args.push(parseExpr()); }
                if (ch() !== ')') throw new Error('Missing ) after ' + name);
                i++;
                const lname = name.toLowerCase();
                if (lname === 'max') return x => Math.max(...args.map(a => a(x)));
                if (lname === 'min') return x => Math.min(...args.map(a => a(x)));
                if (lname === 'mod') return x => args[0](x) % args[1](x);
                if (lname === 'pow') return x => Math.pow(args[0](x), args[1](x));
                if (lname === 'atan2') return x => Math.atan2(args[0](x), args[1](x));
                const fn = _MV_FUNCS[lname];
                if (!fn) throw new Error('Unknown function: ' + name);
                const a0 = args[0]; return x => fn(a0(x));
            }
            const lname = name.toLowerCase();
            if (lname === 'x' || lname === 't') return x => x;
            if (lname in _MV_CONSTS) { const v = _MV_CONSTS[lname]; return () => v; }
            throw new Error('Unknown symbol: ' + name);
        }
        throw new Error('Cannot parse near "' + s.slice(i, i + 8) + '"');
    }

    const fn = parseExpr();
    if (!eof()) throw new Error('Unexpected "' + s.slice(i) + '"');
    return fn;
}

/* ════════════════════════════════════════════════════════════════════════
   FUNCTION PLOTTER  (canvas)
════════════════════════════════════════════════════════════════════════ */
function _mvParsePlotSpec(body) {
    const spec = { title: '', curves: [], xMin: -10, xMax: 10, yMin: null, yMax: null, points: [] };
    for (let raw of String(body).split('\n')) {
        const line = raw.trim();
        if (!line || line.startsWith('#') || line.startsWith('//')) continue;
        const lower = line.toLowerCase();
        let m;
        if ((m = /^title\s*[:=]\s*(.+)$/i.exec(line))) { spec.title = m[1].trim(); continue; }
        if ((m = /^x(?:range|domain)\s*[:=]\s*(-?[\d.eE+]+)\s*[, ]\s*(-?[\d.eE+]+)/i.exec(line))) {
            spec.xMin = parseFloat(m[1]); spec.xMax = parseFloat(m[2]); continue;
        }
        if ((m = /^y(?:range)\s*[:=]\s*(-?[\d.eE+]+)\s*[, ]\s*(-?[\d.eE+]+)/i.exec(line))) {
            spec.yMin = parseFloat(m[1]); spec.yMax = parseFloat(m[2]); continue;
        }
        if ((m = /^point\s*[:=]\s*\(?\s*(-?[\d.eE+]+)\s*,\s*(-?[\d.eE+]+)/i.exec(line))) {
            spec.points.push({ x: parseFloat(m[1]), y: parseFloat(m[2]) }); continue;
        }
        // function line — optional "color: …" suffix, optional y= / f(x)= prefix
        let color = null;
        let expr = line.replace(/[,;]?\s*colou?r\s*[:=]\s*(#[0-9a-f]{3,8}|[a-z]+)\s*$/i, (_, c) => { color = c; return ''; });
        expr = expr.replace(/^[a-zA-Z]\w*\s*(?:\([a-zA-Z]\))?\s*=\s*/, '').trim();   // strip y= , f(x)=
        if (!expr) continue;
        try {
            const fn = mvCompile(expr);
            spec.curves.push({ expr, fn, color: color || _MV_PALETTE[spec.curves.length % _MV_PALETTE.length] });
        } catch (e) {
            spec.curves.push({ expr, error: e.message, color: '#f87171' });
        }
    }
    return spec;
}

function _mvRenderPlot(host, body) {
    const spec = _mvParsePlotSpec(body);
    const W = Math.max(260, Math.min((host.clientWidth || host.parentElement?.clientWidth || 440), 560));
    const H = Math.round(W * 0.62);
    const dpr = window.devicePixelRatio || 1;

    const wrap = document.createElement('div');
    wrap.className = 'my-2 rounded-xl border border-slate-700/60 bg-slate-950/70 p-2';
    const canvas = document.createElement('canvas');
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    canvas.style.display = 'block';
    wrap.appendChild(canvas);
    host.innerHTML = ''; host.appendChild(wrap);

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const pad = { l: 40, r: 12, t: spec.title ? 26 : 12, b: 22 };
    const plotW = W - pad.l - pad.r, plotH = H - pad.t - pad.b;

    let { xMin, xMax, yMin, yMax } = spec;
    if (xMax <= xMin) { xMin = -10; xMax = 10; }

    // sample every curve
    const N = Math.max(200, plotW);
    const samples = spec.curves.map(c => {
        if (!c.fn) return [];
        const pts = [];
        for (let k = 0; k <= N; k++) {
            const x = xMin + (xMax - xMin) * (k / N);
            let y; try { y = c.fn(x); } catch (_) { y = NaN; }
            pts.push({ x, y: (typeof y === 'number' && isFinite(y)) ? y : NaN });
        }
        return pts;
    });

    // auto y-range (robust to asymptotes via percentile clipping)
    if (yMin === null || yMax === null) {
        const ys = [];
        samples.forEach(p => p.forEach(q => { if (isFinite(q.y)) ys.push(q.y); }));
        spec.points.forEach(q => ys.push(q.y));
        if (ys.length) {
            ys.sort((a, b) => a - b);
            const lo = ys[Math.floor(ys.length * 0.02)], hi = ys[Math.floor(ys.length * 0.98)];
            let a = lo, b = hi;
            if (a === b) { a -= 1; b += 1; }
            const padY = (b - a) * 0.1;
            yMin = a - padY; yMax = b + padY;
        } else { yMin = -8; yMax = 8; }
    }
    if (yMax <= yMin) { yMin = -8; yMax = 8; }

    const X = x => pad.l + (x - xMin) / (xMax - xMin) * plotW;
    const Y = y => pad.t + (1 - (y - yMin) / (yMax - yMin)) * plotH;

    // grid
    const niceStep = (range, target) => {
        const raw = range / target, mag = Math.pow(10, Math.floor(Math.log10(raw)));
        const n = raw / mag;
        return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
    };
    ctx.font = '10px ui-monospace, monospace';
    ctx.lineWidth = 1;
    const xStep = niceStep(xMax - xMin, 8), yStep = niceStep(yMax - yMin, 6);
    ctx.strokeStyle = 'rgba(148,163,184,0.13)';
    ctx.fillStyle = 'rgba(148,163,184,0.85)';
    for (let gx = Math.ceil(xMin / xStep) * xStep; gx <= xMax; gx += xStep) {
        const px = X(gx);
        ctx.beginPath(); ctx.moveTo(px, pad.t); ctx.lineTo(px, pad.t + plotH); ctx.stroke();
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        if (Math.abs(gx) > 1e-9) ctx.fillText(_mvNum(gx), px, pad.t + plotH + 4);
    }
    for (let gy = Math.ceil(yMin / yStep) * yStep; gy <= yMax; gy += yStep) {
        const py = Y(gy);
        ctx.beginPath(); ctx.moveTo(pad.l, py); ctx.lineTo(pad.l + plotW, py); ctx.stroke();
        ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        if (Math.abs(gy) > 1e-9) ctx.fillText(_mvNum(gy), pad.l - 5, py);
    }
    // axes
    ctx.strokeStyle = 'rgba(203,213,225,0.55)'; ctx.lineWidth = 1.2;
    if (yMin <= 0 && yMax >= 0) { ctx.beginPath(); ctx.moveTo(pad.l, Y(0)); ctx.lineTo(pad.l + plotW, Y(0)); ctx.stroke(); }
    if (xMin <= 0 && xMax >= 0) { ctx.beginPath(); ctx.moveTo(X(0), pad.t); ctx.lineTo(X(0), pad.t + plotH); ctx.stroke(); }

    // curves (clip to plot area; break on NaN / off-screen jumps)
    ctx.save();
    ctx.beginPath(); ctx.rect(pad.l, pad.t, plotW, plotH); ctx.clip();
    ctx.lineWidth = 2; ctx.lineJoin = 'round';
    samples.forEach((pts, ci) => {
        const c = spec.curves[ci]; if (!c.fn) return;
        ctx.strokeStyle = c.color; ctx.beginPath();
        let drawing = false, prevY = null;
        for (const p of pts) {
            if (!isFinite(p.y)) { drawing = false; prevY = null; continue; }
            const py = Y(p.y), px = X(p.x);
            const jump = prevY !== null && Math.abs(py - prevY) > plotH * 1.5;   // asymptote guard
            if (!drawing || jump) { ctx.moveTo(px, py); drawing = true; } else { ctx.lineTo(px, py); }
            prevY = py;
        }
        ctx.stroke();
    });
    // explicit points
    spec.points.forEach(p => {
        ctx.fillStyle = '#fbbf24';
        ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), 3.5, 0, Math.PI * 2); ctx.fill();
    });
    ctx.restore();

    // title
    if (spec.title) {
        ctx.fillStyle = 'rgba(226,232,240,0.95)'; ctx.font = '600 12px ui-sans-serif, system-ui';
        ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText(spec.title, pad.l, 6);
    }
    // legend
    const labeled = spec.curves.filter(c => c.fn);
    if (labeled.length) {
        ctx.font = '10px ui-monospace, monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        let ly = pad.t + 4;
        labeled.forEach(c => {
            ctx.fillStyle = c.color; ctx.fillRect(pad.l + plotW - 96, ly - 4, 10, 3);
            ctx.fillStyle = 'rgba(203,213,225,0.9)';
            ctx.fillText(c.expr.slice(0, 16), pad.l + plotW - 82, ly);
            ly += 13;
        });
    }
    // surface parse errors
    const errs = spec.curves.filter(c => c.error);
    if (errs.length) {
        const e = document.createElement('div');
        e.className = 'text-[10px] font-mono text-red-400/90 mt-1 px-1';
        e.textContent = errs.map(c => `${c.expr}: ${c.error}`).join('  ·  ');
        wrap.appendChild(e);
    }
}

function _mvNum(v) {
    if (v === 0) return '0';
    const a = Math.abs(v);
    if (a >= 1e4 || a < 1e-3) return v.toExponential(0);
    return String(Math.round(v * 1000) / 1000);
}

/* ════════════════════════════════════════════════════════════════════════
   GEOMETRY  (SVG)  — triangles, polygons, circles, lines, points, vectors
════════════════════════════════════════════════════════════════════════ */
function _mvRenderGeometry(host, body) {
    let spec;
    try { spec = JSON.parse(body); }
    catch (e) { throw new Error('Geometry needs valid JSON. ' + e.message); }
    const shapes = Array.isArray(spec) ? spec : (spec.shapes || []);
    if (!shapes.length) throw new Error('No shapes provided.');

    // collect every point to size the viewBox
    const pts = [];
    const push = p => { if (Array.isArray(p) && isFinite(p[0]) && isFinite(p[1])) pts.push(p); };
    for (const sh of shapes) {
        (sh.points || []).forEach(push);
        ['at', 'from', 'to', 'center', 'a', 'b', 'c', 'start', 'end'].forEach(k => sh[k] && push(sh[k]));
        if (sh.center && sh.r != null) { push([sh.center[0] - sh.r, sh.center[1] - sh.r]); push([sh.center[0] + sh.r, sh.center[1] + sh.r]); }
        if (sh.center && (sh.rx != null || sh.ry != null)) { push([sh.center[0] - (sh.rx || sh.ry), sh.center[1] - (sh.ry || sh.rx)]); push([sh.center[0] + (sh.rx || sh.ry), sh.center[1] + (sh.ry || sh.rx)]); }
    }
    if (!pts.length) throw new Error('Shapes have no coordinates.');

    let minX = Math.min(...pts.map(p => p[0])), maxX = Math.max(...pts.map(p => p[0]));
    let minY = Math.min(...pts.map(p => p[1])), maxY = Math.max(...pts.map(p => p[1]));
    let spanX = maxX - minX || 1, spanY = maxY - minY || 1;
    const m = Math.max(spanX, spanY) * 0.15 + 0.5;     // margin
    minX -= m; maxX += m; minY -= m; maxY += m;
    spanX = maxX - minX; spanY = maxY - minY;

    const W = Math.max(260, Math.min((host.clientWidth || host.parentElement?.clientWidth || 440), 560));
    const scale = W / spanX;
    const H = Math.max(160, Math.min(spanY * scale, 520));

    // math (y-up) → svg (y-down) pixel coords
    const sx = x => (x - minX) * scale;
    const sy = y => H - (y - minY) * scale;
    const showAxes = !Array.isArray(spec) && spec.axes;
    const showGrid = !Array.isArray(spec) && spec.grid;

    let svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="display:block;max-width:100%">`;

    if (showGrid) {
        const step = (function (r) { const mag = Math.pow(10, Math.floor(Math.log10(r / 8))); const n = (r / 8) / mag; return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag; })(Math.max(spanX, spanY));
        for (let gx = Math.ceil(minX / step) * step; gx <= maxX; gx += step)
            svg += `<line x1="${sx(gx).toFixed(1)}" y1="0" x2="${sx(gx).toFixed(1)}" y2="${H}" stroke="rgba(148,163,184,0.12)"/>`;
        for (let gy = Math.ceil(minY / step) * step; gy <= maxY; gy += step)
            svg += `<line x1="0" y1="${sy(gy).toFixed(1)}" x2="${W}" y2="${sy(gy).toFixed(1)}" stroke="rgba(148,163,184,0.12)"/>`;
    }
    if (showAxes) {
        if (minY <= 0 && maxY >= 0) svg += `<line x1="0" y1="${sy(0).toFixed(1)}" x2="${W}" y2="${sy(0).toFixed(1)}" stroke="rgba(203,213,225,0.45)"/>`;
        if (minX <= 0 && maxX >= 0) svg += `<line x1="${sx(0).toFixed(1)}" y1="0" x2="${sx(0).toFixed(1)}" y2="${H}" stroke="rgba(203,213,225,0.45)"/>`;
    }
    svg += `<defs><marker id="mv-arrow" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 Z" fill="context-stroke"/></marker></defs>`;

    const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    const text = (x, y, str, color, dy = 0) =>
        `<text x="${sx(x).toFixed(1)}" y="${(sy(y) + dy).toFixed(1)}" fill="${color || '#e2e8f0'}" font-size="12" font-family="ui-sans-serif,system-ui" text-anchor="middle" dominant-baseline="middle">${_mvEscapeHtml(str)}</text>`;

    shapes.forEach((sh, idx) => {
        const color = sh.color || _MV_PALETTE[idx % _MV_PALETTE.length];
        const fill = sh.fill || color;
        const fillOp = sh.fill === 'none' ? 0 : (sh.fillOpacity != null ? sh.fillOpacity : 0.12);
        const type = (sh.type || 'polygon').toLowerCase();

        const poly = (points, close) => {
            const d = points.map(p => `${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`).join(' ');
            svg += close
                ? `<polygon points="${d}" fill="${fill}" fill-opacity="${fillOp}" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>`
                : `<polyline points="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>`;
        };
        const labelVerts = (points, names) => {
            points.forEach((p, k) => {
                const nm = names && names[k] != null ? names[k] : (sh.labelVertices ? String.fromCharCode(65 + k) : null);
                if (nm != null && nm !== '') svg += text(p[0], p[1], nm, '#f1f5f9', -10);
            });
        };
        const edgeLengths = (points) => {
            for (let k = 0; k < points.length; k++) {
                const a = points[k], b = points[(k + 1) % points.length];
                svg += text((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, _mvNum(dist(a, b)), 'rgba(148,163,184,0.95)', 0);
            }
        };

        if (type === 'point') {
            const p = sh.at || sh.center; if (!p) return;
            svg += `<circle cx="${sx(p[0]).toFixed(1)}" cy="${sy(p[1]).toFixed(1)}" r="4" fill="${color}"/>`;
            if (sh.label) svg += text(p[0], p[1], sh.label, '#f1f5f9', -10);
        } else if (type === 'line' || type === 'segment' || type === 'vector' || type === 'arrow') {
            const a = sh.from || sh.start || sh.a, b = sh.to || sh.end || sh.b; if (!a || !b) return;
            const arrow = (type === 'vector' || type === 'arrow') ? ` marker-end="url(#mv-arrow)"` : '';
            svg += `<line x1="${sx(a[0]).toFixed(1)}" y1="${sy(a[1]).toFixed(1)}" x2="${sx(b[0]).toFixed(1)}" y2="${sy(b[1]).toFixed(1)}" stroke="${color}" stroke-width="2"${arrow}/>`;
            if (sh.showLength || sh.lengths) svg += text((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, _mvNum(dist(a, b)), 'rgba(148,163,184,0.95)');
            if (sh.label) svg += text((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, sh.label, '#f1f5f9', -8);
        } else if (type === 'circle') {
            const c = sh.center; if (!c || sh.r == null) return;
            svg += `<circle cx="${sx(c[0]).toFixed(1)}" cy="${sy(c[1]).toFixed(1)}" r="${(sh.r * scale).toFixed(1)}" fill="${fill}" fill-opacity="${fillOp}" stroke="${color}" stroke-width="2"/>`;
            if (sh.label) svg += text(c[0], c[1], sh.label, '#f1f5f9');
        } else if (type === 'ellipse') {
            const c = sh.center; if (!c) return;
            svg += `<ellipse cx="${sx(c[0]).toFixed(1)}" cy="${sy(c[1]).toFixed(1)}" rx="${((sh.rx || sh.r) * scale).toFixed(1)}" ry="${((sh.ry || sh.r) * scale).toFixed(1)}" fill="${fill}" fill-opacity="${fillOp}" stroke="${color}" stroke-width="2"/>`;
            if (sh.label) svg += text(c[0], c[1], sh.label, '#f1f5f9');
        } else if (type === 'rect' || type === 'rectangle') {
            let points = sh.points;
            if (!points && sh.at && sh.width != null) {
                const [x, y] = sh.at, w = sh.width, h = sh.height != null ? sh.height : sh.width;
                points = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
            }
            if (!points) return;
            poly(points, true);
            labelVerts(points, sh.vertexLabels);
            if (sh.lengths) edgeLengths(points);
            if (sh.label) { const cx = points.reduce((s, p) => s + p[0], 0) / points.length, cy = points.reduce((s, p) => s + p[1], 0) / points.length; svg += text(cx, cy, sh.label, '#f1f5f9'); }
        } else {   // triangle / polygon / default
            let points = sh.points;
            if (!points && sh.a && sh.b && sh.c) points = [sh.a, sh.b, sh.c];
            if (!points || points.length < 2) return;
            const closed = type !== 'polyline' && type !== 'path';
            poly(points, closed);
            const names = sh.vertexLabels || (typeof sh.label === 'string' && sh.label.length === points.length ? sh.label.split('') : null);
            labelVerts(points, names);
            if (sh.lengths || sh.showLengths) edgeLengths(points);
            if (sh.angles && points.length === 3) _mvTriangleAngles(points).forEach((ang, k) =>
                { svg += text(points[k][0], points[k][1], ang + '°', 'rgba(56,189,248,0.95)', 12); });
        }
    });

    svg += '</svg>';
    const wrap = document.createElement('div');
    wrap.className = 'my-2 rounded-xl border border-slate-700/60 bg-slate-950/70 p-2 inline-block max-w-full';
    if (!Array.isArray(spec) && spec.title) {
        const t = document.createElement('div');
        t.className = 'text-xs font-semibold text-slate-300 mb-1 px-1';
        t.textContent = spec.title;
        wrap.appendChild(t);
    }
    wrap.insertAdjacentHTML('beforeend', svg);
    host.innerHTML = ''; host.appendChild(wrap);
}

// interior angles (degrees) at each vertex of a triangle, via law of cosines
function _mvTriangleAngles(p) {
    const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    const A = d(p[1], p[2]), B = d(p[0], p[2]), C = d(p[0], p[1]);
    const ang = (o, a, b) => Math.round(Math.acos(Math.min(1, Math.max(-1, (o * o - a * a - b * b) / (-2 * a * b)))) * 180 / Math.PI);
    return [ang(A, B, C), ang(B, A, C), ang(C, A, B)];
}
