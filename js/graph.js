// ── Graph Editor (2D + 3D) ────────────────────────────────────────────────────
'use strict';
(function () {

/* ══════════════════════════════════════════════════
   STATE
══════════════════════════════════════════════════ */
let _file    = null;
let _mode    = '2d';   // '2d' | '3d' | 'matrix'
let _raf     = null;
let _resObs  = null;
let _saveTimer = null;

let _graphs = [];          // array of { id, expr, color, visible, label }
let _view2d = { xMin:-10, xMax:10, yMin:-8, yMax:8, panX:0, panY:0, zoom:1 };
let _view3d = { rotX:0.45, rotY:0.5, zoom:0.72 };
let _pan     = null;       // {startX, startY, origMin/Max…}
let _orb3d   = null;       // {x0,y0,rx0,ry0}

// Matrix calculator state
let _mats = [];            // [{ id, name, rows, cols, data }]  data = flat row-major array
let _matIdSeq = 0;
function _matNid() { return 'M' + (++_matIdSeq); }

let _idSeq = 0;
function _nid() { return 'g' + (++_idSeq); }

const DEFAULT_COLORS = ['#38bdf8','#f87171','#4ade80','#fbbf24','#c084fc','#fb923c','#34d399','#e879f9'];

/* Returns true when the active background theme is light */
function _isLight() {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--bg-base').trim();
    if (!v) return false;
    const hex = v.replace('#','');
    const r = parseInt(hex.substr(0,2),16)||0;
    const g = parseInt(hex.substr(2,2),16)||0;
    const b = parseInt(hex.substr(4,2),16)||0;
    return (r*299 + g*587 + b*114)/1000 > 128;
}
function _bgBase() {
    return getComputedStyle(document.documentElement).getPropertyValue('--bg-base').trim() || '#0a0f1a';
}

/* ══════════════════════════════════════════════════
   SAFE EXPRESSION EVALUATOR
══════════════════════════════════════════════════ */
function _makeEval(expr) {
    // Strip common prefixes like "y=", "f(x)=", "z=", "f(x,y)="
    let e = expr.trim().replace(/^[a-zA-Z]\s*(?:\([^)]*\))?\s*=\s*/, '');

    // Named functions — order matters (longer names first to avoid partial matches)
    e = e
        .replace(/\^/g, '**')
        // Hyperbolic (must come before plain trig)
        .replace(/\basinh\b/g, 'Math.asinh')
        .replace(/\bacosh\b/g, 'Math.acosh')
        .replace(/\batanh\b/g, 'Math.atanh')
        .replace(/\bsinh\b/g,  'Math.sinh')
        .replace(/\bcosh\b/g,  'Math.cosh')
        .replace(/\btanh\b/g,  'Math.tanh')
        // Inverse trig
        .replace(/\basin\b/g,  'Math.asin')
        .replace(/\bacos\b/g,  'Math.acos')
        .replace(/\batan2\b/g, 'Math.atan2')
        .replace(/\batan\b/g,  'Math.atan')
        // Plain trig + cot
        .replace(/\bsin\b/g,   'Math.sin')
        .replace(/\bcos\b/g,   'Math.cos')
        .replace(/\bcot\b/g,   '(1/Math.tan)')
        .replace(/\btan\b/g,   'Math.tan')
        // Roots / powers
        .replace(/\bsqrt\b/g,  'Math.sqrt')
        .replace(/\bcbrt\b/g,  'Math.cbrt')
        // Log / exp
        .replace(/\blog2\b/g,  'Math.log2')
        .replace(/\blog10\b/g, 'Math.log10')
        .replace(/\blog\b/g,   'Math.log10')
        .replace(/\bln\b/g,    'Math.log')
        .replace(/\bexp\b/g,   'Math.exp')
        // Rounding
        .replace(/\bfloor\b/g, 'Math.floor')
        .replace(/\bceil\b/g,  'Math.ceil')
        .replace(/\bround\b/g, 'Math.round')
        // Misc
        .replace(/\babs\b/g,   'Math.abs')
        .replace(/\bsign\b/g,  'Math.sign')
        .replace(/\bmin\b/g,   'Math.min')
        .replace(/\bmax\b/g,   'Math.max')
        .replace(/\bmod\b/g,   '%')
        // Constants (after function names so "exp" isn't affected by "e" replace)
        .replace(/\bpi\b/gi,   'Math.PI')
        .replace(/\bPI\b/g,    'Math.PI')
        .replace(/\bE\b/g,     'Math.E')
        .replace(/(?<![a-zA-Z_$])\be\b(?![a-zA-Z_$])/g, 'Math.E');

    // ── Implicit multiplication ──────────────────────────────────────────────
    // Temporarily protect Math.Xxx( so its `(` isn't affected
    e = e.replace(/(Math\.\w+)\(/g, '$1\x01');
    // digit or `)` before a letter or `(`
    e = e
        .replace(/(\d)([a-zA-Z])/g,  '$1*$2')   // 2x → 2*x, 2Math → 2*Math
        .replace(/(\d)\(/g,           '$1*(')     // 2( → 2*(
        .replace(/\)\(/g,             ')*(')      // )( → )*(
        .replace(/\)([a-zA-Z\d])/g,  ')*$1')     // )x → )*x, )2 → )*2
        .replace(/([a-zA-Z])\(/g,     '$1*(');    // x( → x*( (safe now—Math.X( is protected)
    // Restore protected parens
    e = e.replace(/(Math\.\w+)\x01/g, '$1(');

    try {
        // Compiles a user-typed plot expression. The input is the user's own
        // formula from the graphing UI, and the body is wrapped so a bad
        // expression yields NaN rather than throwing mid-render.
        // eslint-disable-next-line no-new-func
        return new Function('x', 'y', `"use strict"; try { return (${e}); } catch(_) { return NaN; }`);
    } catch { return () => NaN; }
}

/* ══════════════════════════════════════════════════
   2D CANVAS RENDERING
══════════════════════════════════════════════════ */
function _draw2d() {
    const canvas = document.getElementById('graph-canvas-2d');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const dpr = window.devicePixelRatio || 1;
    const w = W / dpr, h = H / dpr;

    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.scale(dpr, dpr);

    // Background
    const light2d = _isLight();
    ctx.fillStyle = _bgBase();
    ctx.fillRect(0, 0, w, h);

    const v = _view2d;
    const xRange = v.xMax - v.xMin, yRange = v.yMax - v.yMin;
    const toCanvasX = x => (x - v.xMin) / xRange * w;
    const toCanvasY = y => h - (y - v.yMin) / yRange * h;
    const fromCanvasX = cx => v.xMin + cx / w * xRange;
    const fromCanvasY = cy => v.yMin + (h - cy) / h * yRange;

    // Grid
    const gridColor = light2d ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.07)';
    const axisColor = light2d ? 'rgba(0,0,0,0.30)' : 'rgba(255,255,255,0.25)';

    function niceStep(range, targetLines) {
        const raw = range / targetLines;
        const mag = Math.pow(10, Math.floor(Math.log10(raw)));
        const norm = raw / mag;
        if (norm < 1.5) return mag;
        if (norm < 3.5) return 2 * mag;
        if (norm < 7.5) return 5 * mag;
        return 10 * mag;
    }

    const xStep = niceStep(xRange, 10);
    const yStep = niceStep(yRange, 8);

    // Vertical grid lines
    ctx.lineWidth = 1;
    const xStart = Math.ceil(v.xMin / xStep) * xStep;
    for (let x = xStart; x <= v.xMax + xStep * 0.01; x += xStep) {
        const cx = toCanvasX(x);
        ctx.strokeStyle = Math.abs(x) < xStep * 0.01 ? axisColor : gridColor;
        ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, h); ctx.stroke();
    }
    // Horizontal grid lines
    const yStart = Math.ceil(v.yMin / yStep) * yStep;
    for (let y = yStart; y <= v.yMax + yStep * 0.01; y += yStep) {
        const cy = toCanvasY(y);
        ctx.strokeStyle = Math.abs(y) < yStep * 0.01 ? axisColor : gridColor;
        ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(w, cy); ctx.stroke();
    }

    // Tick labels
    const labelColor  = light2d ? 'rgba(0,0,0,0.55)'   : 'rgba(148,163,184,0.7)';
    const labelColor2 = light2d ? 'rgba(0,0,0,0.35)'   : 'rgba(148,163,184,0.5)';
    ctx.fillStyle = labelColor;
    ctx.font = `${Math.max(9, Math.min(11, w / 70))}px monospace`;
    ctx.textBaseline = 'top';
    const originY = Math.min(Math.max(toCanvasY(0), 2), h - 14);
    const originX = Math.min(Math.max(toCanvasX(0), 2), w - 30);
    for (let x = xStart; x <= v.xMax; x += xStep) {
        if (Math.abs(x) < xStep * 0.01) continue;
        const lbl = Number(x.toPrecision(4)).toString();
        ctx.textAlign = 'center';
        ctx.fillText(lbl, toCanvasX(x), originY + 3);
    }
    ctx.textBaseline = 'middle';
    for (let y = yStart; y <= v.yMax; y += yStep) {
        if (Math.abs(y) < yStep * 0.01) continue;
        const lbl = Number(y.toPrecision(4)).toString();
        ctx.textAlign = 'right';
        ctx.fillText(lbl, originX - 4, toCanvasY(y));
    }

    // Axis labels
    ctx.fillStyle = labelColor2;
    ctx.font = '10px monospace';
    ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
    ctx.fillText('x', w - 4, originY - 2);
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText('y', originX + 4, 4);

    // Plot each graph
    _graphs.forEach(g => {
        if (!g.visible || !g.expr.trim()) return;
        const fn = _makeEval(g.expr);
        const steps = Math.ceil(w * 1.5);
        ctx.beginPath();
        ctx.strokeStyle = g.color;
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        let pen = false;
        for (let i = 0; i <= steps; i++) {
            const x = v.xMin + (i / steps) * xRange;
            let y;
            try { y = fn(x, 0); } catch { y = NaN; }
            if (!isFinite(y) || isNaN(y) || Math.abs(y) > yRange * 20) { pen = false; continue; }
            const cx = toCanvasX(x), cy = toCanvasY(y);
            if (!pen) { ctx.moveTo(cx, cy); pen = true; }
            else       ctx.lineTo(cx, cy);
        }
        ctx.stroke();
    });

    // Legend
    const visible = _graphs.filter(g => g.visible && g.expr.trim());
    if (visible.length) {
        let ly = 10;
        visible.forEach(g => {
            ctx.fillStyle = g.color + 'cc';
            ctx.fillRect(10, ly, 16, 3);
            ctx.fillStyle = light2d ? 'rgba(0,0,0,0.75)' : 'rgba(255,255,255,0.7)';
            ctx.font = '10px monospace';
            ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
            ctx.fillText(g.label || g.expr.substring(0, 24), 32, ly + 1);
            ly += 16;
        });
    }

    ctx.restore();
}

/* ══════════════════════════════════════════════════
   3D CANVAS RENDERING (software isometric)
══════════════════════════════════════════════════ */
function _draw3d() {
    const canvas = document.getElementById('graph-canvas-3d');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.width / dpr, H = canvas.height / dpr;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(dpr, dpr);
    const light3d = _isLight();
    ctx.fillStyle = _bgBase();
    ctx.fillRect(0, 0, W, H);

    const v = _view3d;
    const cx = W / 2, cy = H / 2;
    const scale = Math.min(W, H) * v.zoom * 0.38;

    // Rotation matrices
    const cosX = Math.cos(v.rotX), sinX = Math.sin(v.rotX);
    const cosY = Math.cos(v.rotY), sinY = Math.sin(v.rotY);

    function project(x, y, z) {
        // Rotate around Y axis
        const rx = x * cosY + z * sinY;
        const rz = -x * sinY + z * cosY;
        // Rotate around X axis
        const ry = y * cosX - rz * sinX;
        const rz2 = y * sinX + rz * cosX;
        // Perspective
        const fov = 3.5;
        const d = fov / (fov + rz2 * 0.5 + 2);
        return { sx: cx + rx * scale * d, sy: cy - ry * scale * d, d };
    }

    // Draw grid axes
    const RANGE = 2.2;
    ctx.lineWidth = 1;

    // Axis lines
    [['x',1,0,0,'rgba(248,113,113,0.6)'],
     ['y',0,1,0,'rgba(74,222,128,0.6)'],
     ['z',0,0,1,'rgba(56,189,248,0.6)']].forEach(([lbl,dx,dy,dz,col]) => {
        const p0 = project(-dx*RANGE,-dy*RANGE,-dz*RANGE);
        const p1 = project( dx*RANGE, dy*RANGE, dz*RANGE);
        ctx.strokeStyle = col; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(p0.sx,p0.sy); ctx.lineTo(p1.sx,p1.sy); ctx.stroke();
        ctx.fillStyle = col; ctx.font = 'bold 11px monospace';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(lbl, p1.sx + (dx-dz)*8, p1.sy - dy*8);
    });

    // Grid on XZ plane (y=0)
    ctx.strokeStyle = light3d ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.06)'; ctx.lineWidth = 0.8;
    const gSteps = 5;
    for (let i = -gSteps; i <= gSteps; i++) {
        const t = i / gSteps * RANGE;
        const a = project(t, 0, -RANGE), b = project(t, 0, RANGE);
        ctx.beginPath(); ctx.moveTo(a.sx,a.sy); ctx.lineTo(b.sx,b.sy); ctx.stroke();
        const c = project(-RANGE, 0, t), d2 = project(RANGE, 0, t);
        ctx.beginPath(); ctx.moveTo(c.sx,c.sy); ctx.lineTo(d2.sx,d2.sy); ctx.stroke();
    }

    // Plot surfaces
    const SURF_STEPS = 40;
    _graphs.forEach(g => {
        if (!g.visible || !g.expr.trim()) return;
        const fn = _makeEval(g.expr);
        const r = parseInt(g.color.slice(1,3),16) || 56;
        const gv = parseInt(g.color.slice(3,5),16) || 189;
        const bv = parseInt(g.color.slice(5,7),16) || 248;

        // Build grid of projected points
        const pts = [];
        for (let i = 0; i <= SURF_STEPS; i++) {
            pts.push([]);
            for (let j = 0; j <= SURF_STEPS; j++) {
                const x = -RANGE + i / SURF_STEPS * RANGE * 2;
                const z = -RANGE + j / SURF_STEPS * RANGE * 2;
                let y; try { y = fn(x, z) * 0.4; } catch { y = NaN; }
                if (!isFinite(y) || isNaN(y)) y = 0;
                y = Math.max(-RANGE * 1.2, Math.min(RANGE * 1.2, y));
                pts[i].push(project(x, y, z));
            }
        }

        // Draw quad strips sorted by depth (painter's algorithm — approximate)
        const quads = [];
        for (let i = 0; i < SURF_STEPS; i++) {
            for (let j = 0; j < SURF_STEPS; j++) {
                const p0 = pts[i][j], p1 = pts[i+1][j], p2 = pts[i+1][j+1], p3 = pts[i][j+1];
                const avgD = (p0.d + p1.d + p2.d + p3.d) / 4;
                const yVal = (-RANGE + (i + 0.5) / SURF_STEPS * RANGE * 2);
                quads.push({ p0,p1,p2,p3, avgD, yVal });
            }
        }
        quads.sort((a, b) => a.avgD - b.avgD);

        quads.forEach(q => {
            const t = Math.max(0, Math.min(1, (q.p0.sy - cy) / (H * 0.4) + 0.5));
            const alpha = 0.55;
            const fr = Math.floor(r * (0.4 + t * 0.6));
            const fg = Math.floor(gv * (0.4 + t * 0.6));
            const fb = Math.floor(bv * (0.4 + t * 0.6));
            ctx.beginPath();
            ctx.moveTo(q.p0.sx, q.p0.sy);
            ctx.lineTo(q.p1.sx, q.p1.sy);
            ctx.lineTo(q.p2.sx, q.p2.sy);
            ctx.lineTo(q.p3.sx, q.p3.sy);
            ctx.closePath();
            ctx.fillStyle = `rgba(${fr},${fg},${fb},${alpha})`;
            ctx.fill();
            ctx.strokeStyle = `rgba(${fr},${fg},${fb},0.15)`;
            ctx.lineWidth = 0.4; ctx.stroke();
        });
    });

    // Legend
    const visible = _graphs.filter(g => g.visible && g.expr.trim());
    if (visible.length) {
        let ly = 10;
        visible.forEach(g => {
            ctx.fillStyle = g.color + 'cc';
            ctx.fillRect(10, ly, 16, 3);
            ctx.fillStyle = light3d ? 'rgba(0,0,0,0.75)' : 'rgba(255,255,255,0.7)';
            ctx.font = '10px monospace';
            ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
            ctx.fillText(g.label || ('z = ' + g.expr.substring(0, 20)), 32, ly + 1);
            ly += 16;
        });
    }

    ctx.fillStyle = light3d ? 'rgba(0,0,0,0.30)' : 'rgba(255,255,255,0.18)';
    ctx.font = '10px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText('Drag to rotate · scroll to zoom', 10, H - 8);
    ctx.restore();
}

/* ══════════════════════════════════════════════════
   CANVAS RESIZE
══════════════════════════════════════════════════ */
function _resizeCanvases() {
    const wrap = document.getElementById('graph-canvas-wrap');
    if (!wrap) return;
    const dpr = window.devicePixelRatio || 1;
    const r = wrap.getBoundingClientRect();
    ['graph-canvas-2d', 'graph-canvas-3d'].forEach(id => {
        const c = document.getElementById(id);
        if (!c) return;
        c.width  = Math.round(r.width  * dpr);
        c.height = Math.round(r.height * dpr);
        c.style.width  = r.width  + 'px';
        c.style.height = r.height + 'px';
    });
    _redraw();
}

function _redraw() {
    if (_mode === '2d') _draw2d();
    else                _draw3d();
}

/* ══════════════════════════════════════════════════
   MATH KEYBOARD
══════════════════════════════════════════════════ */
let _mkbTarget = null;   // the currently-focused expression input
let _mkbTab    = '123';  // active keyboard tab

const _MKB_TABS = {
    '123': [
        // row 1
        { lbl:'x', ins:'x' },      { lbl:'y', ins:'y' },      { lbl:'π', ins:'pi' },  { lbl:'e', ins:'e' },
        { lbl:'7', ins:'7' },      { lbl:'8', ins:'8' },      { lbl:'9', ins:'9' },
        { lbl:'×', ins:'*' },      { lbl:'÷', ins:'/' },
        // row 2
        { lbl:'x²', ins:'x^2', sup:true }, { lbl:'xⁿ', ins:'^', sup:true }, { lbl:'√x', ins:'sqrt(' }, { lbl:'|x|', ins:'abs(' },
        { lbl:'4', ins:'4' },      { lbl:'5', ins:'5' },      { lbl:'6', ins:'6' },
        { lbl:'+', ins:'+' },      { lbl:'−', ins:'-' },
        // row 3
        { lbl:'<', ins:'<' },      { lbl:'>', ins:'>' },      { lbl:'(', ins:'(' },   { lbl:')', ins:')' },
        { lbl:'1', ins:'1' },      { lbl:'2', ins:'2' },      { lbl:'3', ins:'3' },
        { lbl:'=', ins:'=' },      { lbl:'⌫', ins:'__del__', special:'del' },
        // row 4
        { lbl:'ans', ins:'ans', wide:true }, { lbl:',', ins:',' },
        { lbl:'0', ins:'0' },      { lbl:'.', ins:'.' },
        { lbl:'◀', ins:'__left__', special:'nav' },  { lbl:'▶', ins:'__right__', special:'nav' }, { lbl:'↵', ins:'__enter__', special:'enter', wide:true },
    ],
    'f(x)': [
        { lbl:'sin',  ins:'sin(' },  { lbl:'cos',  ins:'cos(' },  { lbl:'tan',   ins:'tan(' },  { lbl:'cot',  ins:'cot(' },
        { lbl:'asin', ins:'asin(' }, { lbl:'acos', ins:'acos(' }, { lbl:'atan',  ins:'atan(' }, { lbl:'atan2',ins:'atan2(' },
        { lbl:'sinh', ins:'sinh(' }, { lbl:'cosh', ins:'cosh(' }, { lbl:'tanh',  ins:'tanh(' }, { lbl:'asinh',ins:'asinh(' },
        { lbl:'√',    ins:'sqrt(' }, { lbl:'∛',    ins:'cbrt(' }, { lbl:'xⁿ',   ins:'^',sup:true }, { lbl:'|x|', ins:'abs(' },
        { lbl:'ln',   ins:'ln(' },   { lbl:'log',  ins:'log(' },  { lbl:'log₂',  ins:'log2(' }, { lbl:'exp',  ins:'exp(' },
        { lbl:'floor',ins:'floor(' },{ lbl:'ceil', ins:'ceil(' }, { lbl:'round', ins:'round(' },{ lbl:'sign', ins:'sign(' },
        { lbl:'min',  ins:'min(' },  { lbl:'max',  ins:'max(' },  { lbl:'mod',   ins:'mod' },   { lbl:'⌫', ins:'__del__', special:'del' },
    ],
    'ABC': [
        { lbl:'x',  ins:'x' }, { lbl:'y',  ins:'y' }, { lbl:'z',  ins:'z' }, { lbl:'t',  ins:'t' },
        { lbl:'a',  ins:'a' }, { lbl:'b',  ins:'b' }, { lbl:'c',  ins:'c' }, { lbl:'n',  ins:'n' },
        { lbl:'π',  ins:'pi'  }, { lbl:'e',  ins:'e'  }, { lbl:'φ',  ins:'(1+sqrt(5))/2' }, { lbl:'τ',  ins:'2*pi' },
        { lbl:'∞',  ins:'Infinity' }, { lbl:'i',  ins:'i' }, { lbl:'k',  ins:'k' }, { lbl:'r',  ins:'r' },
        { lbl:'θ',  ins:'theta' }, { lbl:'α',  ins:'alpha' }, { lbl:'β',  ins:'beta' }, { lbl:'γ',  ins:'gamma' },
        { lbl:'δ',  ins:'delta' }, { lbl:'ε',  ins:'epsilon' }, { lbl:'λ',  ins:'lambda' }, { lbl:'μ',  ins:'mu' },
        { lbl:'σ',  ins:'sigma' }, { lbl:'ω',  ins:'omega' }, { lbl:'ρ',  ins:'rho' }, { lbl:'⌫', ins:'__del__', special:'del' },
    ],
    '#&¬': [
        { lbl:'²',  ins:'^2' },   { lbl:'³',  ins:'^3' },   { lbl:'ⁿ',  ins:'^' },    { lbl:'½',  ins:'1/2' },
        { lbl:'⅓',  ins:'1/3' },  { lbl:'¼',  ins:'1/4' },  { lbl:'⅔',  ins:'2/3' },  { lbl:'¾',  ins:'3/4' },
        { lbl:'≠',  ins:'!=' },   { lbl:'≤',  ins:'<=' },   { lbl:'≥',  ins:'>=' },   { lbl:'≈',  ins:'~=' },
        { lbl:'!',  ins:'!' },    { lbl:'%',  ins:'%' },    { lbl:'&',  ins:'&' },    { lbl:'|',  ins:'|' },
        { lbl:'⌊⌋', ins:'floor(' }, { lbl:'⌈⌉', ins:'ceil(' }, { lbl:'Σ',  ins:'sum(' }, { lbl:'∏',  ins:'prod(' },
        { lbl:'d/dx', ins:'diff(' }, { lbl:'∫',  ins:'int(' }, { lbl:'lim', ins:'lim(' }, { lbl:'→',  ins:'->' },
        { lbl:'{', ins:'{' }, { lbl:'}', ins:'}' }, { lbl:'[', ins:'[' }, { lbl:'⌫', ins:'__del__', special:'del' },
    ],
};

function _mkbInsert(ins) {
    if (!_mkbTarget) return;
    const el = _mkbTarget;
    if (ins === '__del__') {
        const s = el.selectionStart, e = el.selectionEnd;
        if (s !== e) { el.setRangeText('', s, e, 'end'); }
        else if (s > 0) { el.setRangeText('', s-1, s, 'end'); }
    } else if (ins === '__left__') {
        const p = Math.max(0, el.selectionStart - 1);
        el.setSelectionRange(p, p);
    } else if (ins === '__right__') {
        const p = Math.min(el.value.length, el.selectionStart + 1);
        el.setSelectionRange(p, p);
    } else if (ins === '__enter__') {
        el.blur(); _mkbHide();
    } else {
        const s = el.selectionStart, e = el.selectionEnd;
        el.setRangeText(ins, s, e, 'end');
        // Auto-close brackets
        if (ins.endsWith('(')) {
            const cur = el.selectionStart;
            el.setRangeText(')', cur, cur, 'start');
            el.setSelectionRange(cur, cur);
        }
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.focus();
}

function _mkbRender() {
    const kb = document.getElementById('graph-mathkb');
    if (!kb) return;

    // Tab bar
    const tabs = ['123','f(x)','ABC','#&¬'];
    let html = `<div class="flex items-center gap-0 border-b border-slate-700/60 bg-slate-900/80 shrink-0" style="-webkit-app-region:no-drag">`;
    tabs.forEach(t => {
        const active = t === _mkbTab;
        html += `<button class="mkb-tab px-3 py-1.5 text-[11px] font-medium transition-colors ${active ? 'mkb-tab-active border-b-2' : 'text-slate-500 hover:text-slate-300'}" data-tab="${t}">${t}</button>`;
    });
    html += `<button id="mkb-close" class="ml-auto mr-2 text-slate-600 hover:text-slate-300 text-[11px] px-2 py-1" title="Close keyboard"><i class="fas fa-chevron-down"></i></button></div>`;

    // Keys grid
    const keys = _MKB_TABS[_mkbTab];
    html += `<div class="flex-1 overflow-y-auto p-1.5" style="-webkit-app-region:no-drag"><div class="grid gap-1" style="grid-template-columns:repeat(9,1fr)">`;

    // For '123' tab, use a 9-column layout matching the image: 4 math + gap + 5 numpad/ops
    // For other tabs use 4-column uniform grid
    const cols = _mkbTab === '123' ? 9 : 4;
    html = html.replace('repeat(9,1fr)', `repeat(${cols},1fr)`);

    if (_mkbTab === '123') {
        // Custom 4+gap+5 layout using CSS grid areas
        html = html.replace(`<div class="grid gap-1" style="grid-template-columns:repeat(${cols},1fr)">`,
            `<div class="grid gap-1" style="grid-template-columns:repeat(4,1fr) 8px repeat(5,1fr)">`);
        keys.forEach((k, i) => {
            // Row breaks: insert gap column at positions 4,13,22,31 (every 9 keys, at index 4)
            const colInRow = i % 9;
            const gapSpan = (colInRow === 4) ? `<div></div>` : '';
            const wide = k.wide ? 'style="grid-column:span 2"' : '';
            const special = k.special === 'del' ? 'bg-slate-700/80 hover:bg-slate-600' :
                            k.special === 'enter' ? 'mkb-enter-key' :
                            k.special === 'nav' ? 'bg-slate-700/60 hover:bg-slate-600' :
                            'bg-slate-800/80 hover:bg-slate-700';
            html += `${gapSpan}<button class="mkb-key ${special} rounded text-[11px] text-slate-200 py-1.5 font-mono transition-colors" data-ins="${k.ins}" ${wide}>${k.lbl}</button>`;
        });
    } else {
        keys.forEach(k => {
            const special = k.special === 'del' ? 'bg-slate-700/80 hover:bg-slate-600' :
                            'bg-slate-800/80 hover:bg-slate-700';
            html += `<button class="mkb-key ${special} rounded text-[11px] text-slate-200 py-1.5 font-mono transition-colors" data-ins="${k.ins}">${k.lbl}</button>`;
        });
    }
    html += `</div></div>`;
    kb.innerHTML = html;

    // Wire tab buttons
    kb.querySelectorAll('.mkb-tab').forEach(btn => {
        btn.onmousedown = e => { e.preventDefault(); _mkbTab = btn.dataset.tab; _mkbRender(); };
    });
    // Wire key buttons
    kb.querySelectorAll('.mkb-key').forEach(btn => {
        btn.onmousedown = e => { e.preventDefault(); _mkbInsert(btn.dataset.ins); };
    });
    // Close button
    const closeBtn = kb.querySelector('#mkb-close');
    if (closeBtn) closeBtn.onmousedown = e => { e.preventDefault(); _mkbHide(); };
}

function _mkbShow(inputEl) {
    _mkbTarget = inputEl;
    const kb = document.getElementById('graph-mathkb');
    if (kb) { kb.style.display = 'flex'; _mkbRender(); }
}
function _mkbHide() {
    _mkbTarget = null;
    const kb = document.getElementById('graph-mathkb');
    if (kb) kb.style.display = 'none';
}

/* ══════════════════════════════════════════════════
   SIDEBAR / EXPRESSION LIST
══════════════════════════════════════════════════ */
function _renderSidebar() {
    const list = document.getElementById('graph-expr-list');
    if (!list) return;
    list.innerHTML = '';

    _graphs.forEach((g, idx) => {
        const row = document.createElement('div');
        row.className = 'flex items-center gap-1.5 p-1.5 rounded-lg bg-slate-800/60 border border-slate-700/40';

        // Color swatch / picker
        const swatch = document.createElement('label');
        swatch.style.cssText = `width:16px;height:16px;border-radius:4px;background:${g.color};cursor:pointer;flex-shrink:0;display:block;border:1px solid rgba(255,255,255,0.15)`;
        swatch.title = 'Click to change colour';
        const picker = document.createElement('input');
        picker.type = 'color'; picker.value = g.color;
        picker.className = 'sr-only';
        picker.oninput = () => { g.color = picker.value; swatch.style.background = picker.value; _redraw(); _scheduleSave(); };
        swatch.appendChild(picker);
        row.appendChild(swatch);

        // Expression input
        const inp = document.createElement('input');
        inp.type = 'text';
        inp.value = g.expr;
        inp.placeholder = _mode === '2d' ? 'e.g. sin(x) or x^2' : 'e.g. sin(x)*cos(y)';
        inp.className = 'flex-1 bg-transparent text-slate-200 text-[11px] font-mono outline-none min-w-0 border-b border-slate-700/60 graph-expr-inp pb-0.5';
        inp.spellcheck = false;
        inp.oninput = () => { g.expr = inp.value; _redraw(); _scheduleSave(); };
        inp.onkeydown = e => { if (e.key === 'Enter') { inp.blur(); _mkbHide(); } };
        inp.onfocus = () => _mkbShow(inp);
        row.appendChild(inp);

        // Visibility toggle
        const vis = document.createElement('button');
        vis.className = 'w-5 h-5 flex items-center justify-center rounded text-[9px] flex-shrink-0 transition-colors';
        vis.style.background = g.visible ? 'rgba(var(--accent-rgb),0.13)' : '';
        vis.style.color      = g.visible ? 'var(--accent-light,#38bdf8)' : 'var(--text-muted,#475569)';
        vis.innerHTML = '<i class="fas fa-eye"></i>';
        vis.title = 'Toggle visibility';
        vis.onclick = () => { g.visible = !g.visible; _renderSidebar(); _redraw(); _scheduleSave(); };
        row.appendChild(vis);

        // Delete
        const del = document.createElement('button');
        del.className = 'w-5 h-5 flex items-center justify-center rounded text-[9px] flex-shrink-0 text-slate-600 hover:text-red-400 hover:bg-red-900/20 transition-colors';
        del.innerHTML = '<i class="fas fa-times"></i>';
        del.title = 'Remove';
        del.onclick = () => { _graphs.splice(idx, 1); _renderSidebar(); _redraw(); _scheduleSave(); };
        row.appendChild(del);

        list.appendChild(row);
    });

    // Add function button
    const addBtn = document.createElement('button');
    addBtn.className = 'w-full py-1.5 rounded-lg text-[10px] text-slate-500 hover:text-slate-300 border border-dashed border-slate-700/60 hover:border-slate-600 transition-colors flex items-center justify-center gap-1';
    addBtn.innerHTML = '<i class="fas fa-plus text-[8px]"></i> Add function';
    addBtn.onclick = () => {
        _graphs.push({ id:_nid(), expr:'', color: DEFAULT_COLORS[_graphs.length % DEFAULT_COLORS.length], visible:true, label:'' });
        _renderSidebar();
        // Focus the new input
        const inputs = list.querySelectorAll('input[type=text]');
        if (inputs.length) inputs[inputs.length-1].focus();
        _scheduleSave();
    };
    list.appendChild(addBtn);

    // Window
    _renderWindow();
}

function _syncWindowInputs() {
    const el = document.getElementById('graph-window-panel');
    if (!el) return;
    const keys = ['xMin','xMax','yMin','yMax'];
    el.querySelectorAll('input[type=text]').forEach((inp, i) => {
        if (document.activeElement !== inp && keys[i])
            inp.value = _fmtView(_view2d[keys[i]]);
    });
}

function _fmtView(n) {
    // Show at most 4 significant figures, no trailing zeros, locale-independent
    if (!isFinite(n)) return String(n);
    const s = parseFloat(n.toPrecision(6));
    return String(s);
}

function _renderWindow() {
    const el = document.getElementById('graph-window-panel');
    if (!el) return;
    el.innerHTML = '';

    if (_mode === '2d') {
        const v = _view2d;
        [['X min','xMin'],['X max','xMax'],['Y min','yMin'],['Y max','yMax']].forEach(([lbl, key]) => {
            const row = document.createElement('div');
            row.className = 'flex items-center gap-1.5';
            // Use type="text" to avoid locale-dependent comma decimal separators
            row.innerHTML = `<label class="text-[9px] text-slate-500 w-10 shrink-0">${lbl}</label>
              <input type="text" inputmode="decimal" value="${_fmtView(v[key])}"
                class="flex-1 bg-slate-800/60 text-slate-200 text-[10px] font-mono border border-slate-700/40 rounded px-1.5 py-1 outline-none">`;
            const inp = row.querySelector('input');
            inp.oninput = () => {
                // Accept both . and , as decimal separator
                const n = parseFloat(inp.value.replace(',', '.'));
                if (isFinite(n)) { v[key] = n; _redraw(); _scheduleSave(); }
            };
            inp.onblur = () => { inp.value = _fmtView(v[key]); };
            el.appendChild(row);
        });
        // Zoom buttons
        const zRow = document.createElement('div');
        zRow.className = 'flex gap-1 mt-1';
        [['fa-search-plus','Zoom in', 0.6],['fa-search-minus','Zoom out',1.67],['fa-compress-arrows-alt','Reset',null]].forEach(([icon,tip,factor]) => {
            const b = document.createElement('button');
            b.className = 'flex-1 py-1 rounded text-[9px] bg-slate-800/60 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors border border-slate-700/40';
            b.innerHTML = `<i class="fas ${icon}"></i>`;
            b.title = tip;
            b.onclick = () => {
                if (factor === null) { Object.assign(_view2d,{xMin:-10,xMax:10,yMin:-8,yMax:8}); }
                else {
                    const mx=(v.xMin+v.xMax)/2, my=(v.yMin+v.yMax)/2;
                    const hw=(v.xMax-v.xMin)/2*factor, hh=(v.yMax-v.yMin)/2*factor;
                    v.xMin=mx-hw; v.xMax=mx+hw; v.yMin=my-hh; v.yMax=my+hh;
                }
                // Update input values directly without full re-render (avoids flicker)
                el.querySelectorAll('input[type=text]').forEach((inp, i) => {
                    const keys = ['xMin','xMax','yMin','yMax'];
                    inp.value = _fmtView(v[keys[i]]);
                });
                _redraw(); _scheduleSave();
            };
            zRow.appendChild(b);
        });
        el.appendChild(zRow);
    } else {
        // 3D orbit hint
        const hint = document.createElement('p');
        hint.className = 'text-[9px] text-slate-600 leading-relaxed';
        hint.textContent = 'Drag canvas to rotate · scroll to zoom · z = f(x, y)';
        el.appendChild(hint);

        // Zoom
        const zRow = document.createElement('div');
        zRow.className = 'flex gap-1 mt-1';
        [['fa-search-plus','Zoom in', 1.3],['fa-search-minus','Zoom out',0.77],['fa-compress-arrows-alt','Reset',0]].forEach(([icon,tip,f]) => {
            const b = document.createElement('button');
            b.className = 'flex-1 py-1 rounded text-[9px] bg-slate-800/60 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors border border-slate-700/40';
            b.innerHTML = `<i class="fas ${icon}"></i>`; b.title = tip;
            b.onclick = () => { if(f===0){_view3d={rotX:0.45,rotY:0.5,zoom:0.72};}else _view3d.zoom=Math.max(0.2,Math.min(3,_view3d.zoom*f)); _redraw(); };
            zRow.appendChild(b);
        });
        el.appendChild(zRow);
    }
}

/* ══════════════════════════════════════════════════
   CANVAS INTERACTION
══════════════════════════════════════════════════ */
function _mountCanvasEvents() {
    const c2 = document.getElementById('graph-canvas-2d');
    const c3 = document.getElementById('graph-canvas-3d');

    // 2D: pan on drag, zoom on wheel
    if (c2) {
        c2.onmousedown = e => {
            const dpr = window.devicePixelRatio || 1;
            const r = c2.getBoundingClientRect();
            const mx = (e.clientX - r.left), my = (e.clientY - r.top);
            _pan = { startX:mx, startY:my, xMin:_view2d.xMin, xMax:_view2d.xMax, yMin:_view2d.yMin, yMax:_view2d.yMax };
            e.preventDefault();
        };
        window.addEventListener('mousemove', e => {
            if (!_pan || _mode !== '2d') return;
            const r = c2.getBoundingClientRect();
            const mx = (e.clientX - r.left), my = (e.clientY - r.top);
            const dx = (mx - _pan.startX) / r.width  * (_pan.xMax - _pan.xMin);
            const dy = (my - _pan.startY) / r.height * (_pan.yMax - _pan.yMin);
            _view2d.xMin = _pan.xMin - dx; _view2d.xMax = _pan.xMax - dx;
            _view2d.yMin = _pan.yMin + dy; _view2d.yMax = _pan.yMax + dy;
            _redraw();
        });
        window.addEventListener('mouseup', () => { if (_pan) { _pan = null; _syncWindowInputs(); _scheduleSave(); } });
        c2.onwheel = e => {
            e.preventDefault();
            const factor = e.deltaY > 0 ? 1.12 : 0.89;
            const r = c2.getBoundingClientRect();
            const fx = (e.clientX - r.left) / r.width;
            const fy = (e.clientY - r.top)  / r.height;
            const v = _view2d;
            const xRange = v.xMax - v.xMin, yRange = v.yMax - v.yMin;
            const pivX = v.xMin + fx * xRange, pivY = v.yMax - fy * yRange;
            v.xMin = pivX - (pivX - v.xMin) * factor;
            v.xMax = pivX + (v.xMax - pivX) * factor;
            v.yMin = pivY - (pivY - v.yMin) * factor;
            v.yMax = pivY + (v.yMax - pivY) * factor;
            _syncWindowInputs(); _redraw(); _scheduleSave();
        };
    }

    // 3D: orbit on drag, zoom on wheel
    if (c3) {
        c3.onmousedown = e => {
            _orb3d = { x0:e.clientX, y0:e.clientY, rx:_view3d.rotX, ry:_view3d.rotY };
            e.preventDefault();
        };
        window.addEventListener('mousemove', e => {
            if (!_orb3d || _mode !== '3d') return;
            _view3d.rotY = _orb3d.ry + (e.clientX - _orb3d.x0) * 0.007;
            _view3d.rotX = Math.max(-Math.PI/2+0.05, Math.min(Math.PI/2-0.05,
                _orb3d.rx + (e.clientY - _orb3d.y0) * 0.007));
            _redraw();
        });
        window.addEventListener('mouseup', () => { _orb3d = null; });
        c3.onwheel = e => {
            e.preventDefault();
            _view3d.zoom = Math.max(0.2, Math.min(3, _view3d.zoom * (e.deltaY > 0 ? 0.9 : 1.11)));
            _redraw();
        };
    }
}

/* ══════════════════════════════════════════════════
   MATRIX MATH
══════════════════════════════════════════════════ */
function _matGet(m, r, c) { return m.data[r * m.cols + c]; }
function _matSet(m, r, c, v) { m.data[r * m.cols + c] = v; }
function _matMake(rows, cols, fill) {
    return { rows, cols, data: Array(rows * cols).fill(fill ?? 0) };
}
function _matClone(m) { return { rows:m.rows, cols:m.cols, data:[...m.data] }; }

function _matAdd(A, B) {
    if (A.rows !== B.rows || A.cols !== B.cols) throw new Error(`Size mismatch: (${A.rows}×${A.cols}) + (${B.rows}×${B.cols})`);
    const C = _matMake(A.rows, A.cols);
    for (let i = 0; i < C.data.length; i++) C.data[i] = A.data[i] + B.data[i];
    return C;
}
function _matSub(A, B) {
    if (A.rows !== B.rows || A.cols !== B.cols) throw new Error(`Size mismatch: (${A.rows}×${A.cols}) - (${B.rows}×${B.cols})`);
    const C = _matMake(A.rows, A.cols);
    for (let i = 0; i < C.data.length; i++) C.data[i] = A.data[i] - B.data[i];
    return C;
}
function _matMul(A, B) {
    if (A.cols !== B.rows) throw new Error(`Size mismatch: (${A.rows}×${A.cols}) × (${B.rows}×${B.cols})`);
    const C = _matMake(A.rows, B.cols);
    for (let r = 0; r < A.rows; r++)
        for (let c = 0; c < B.cols; c++) {
            let s = 0;
            for (let k = 0; k < A.cols; k++) s += _matGet(A,r,k) * _matGet(B,k,c);
            _matSet(C, r, c, s);
        }
    return C;
}
function _matScale(A, k) {
    const C = _matClone(A);
    for (let i = 0; i < C.data.length; i++) C.data[i] *= k;
    return C;
}
function _matTranspose(A) {
    const C = _matMake(A.cols, A.rows);
    for (let r = 0; r < A.rows; r++)
        for (let c = 0; c < A.cols; c++)
            _matSet(C, c, r, _matGet(A, r, c));
    return C;
}
function _matDet(A) {
    if (A.rows !== A.cols) throw new Error('Determinant requires a square matrix');
    const n = A.rows;
    if (n === 1) return A.data[0];
    if (n === 2) return _matGet(A,0,0)*_matGet(A,1,1) - _matGet(A,0,1)*_matGet(A,1,0);
    const L = _matClone(A);
    let sign = 1;
    for (let col = 0; col < n; col++) {
        let maxR = col;
        for (let r = col+1; r < n; r++)
            if (Math.abs(_matGet(L,r,col)) > Math.abs(_matGet(L,maxR,col))) maxR = r;
        if (maxR !== col) {
            for (let c = 0; c < n; c++) {
                const t = _matGet(L,col,c); _matSet(L,col,c,_matGet(L,maxR,c)); _matSet(L,maxR,c,t);
            }
            sign *= -1;
        }
        const piv = _matGet(L, col, col);
        if (Math.abs(piv) < 1e-12) return 0;
        for (let r = col+1; r < n; r++) {
            const f = _matGet(L,r,col) / piv;
            for (let c = col; c < n; c++) _matSet(L,r,c, _matGet(L,r,c) - f * _matGet(L,col,c));
        }
    }
    let d = sign;
    for (let i = 0; i < n; i++) d *= _matGet(L,i,i);
    return d;
}
function _matInverse(A) {
    if (A.rows !== A.cols) throw new Error('Inverse requires a square matrix');
    const n = A.rows;
    const aug = _matMake(n, 2*n);
    for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) _matSet(aug, r, c, _matGet(A, r, c));
        _matSet(aug, r, n+r, 1);
    }
    for (let col = 0; col < n; col++) {
        let maxR = col;
        for (let r = col+1; r < n; r++)
            if (Math.abs(_matGet(aug,r,col)) > Math.abs(_matGet(aug,maxR,col))) maxR = r;
        if (maxR !== col)
            for (let c = 0; c < 2*n; c++) {
                const t = _matGet(aug,col,c); _matSet(aug,col,c,_matGet(aug,maxR,c)); _matSet(aug,maxR,c,t);
            }
        const piv = _matGet(aug, col, col);
        if (Math.abs(piv) < 1e-12) throw new Error('Matrix is singular (not invertible)');
        for (let c = 0; c < 2*n; c++) _matSet(aug, col, c, _matGet(aug,col,c)/piv);
        for (let r = 0; r < n; r++) {
            if (r === col) continue;
            const f = _matGet(aug, r, col);
            for (let c = 0; c < 2*n; c++) _matSet(aug, r, c, _matGet(aug,r,c) - f*_matGet(aug,col,c));
        }
    }
    const inv = _matMake(n, n);
    for (let r = 0; r < n; r++)
        for (let c = 0; c < n; c++) _matSet(inv, r, c, _matGet(aug, r, n+c));
    return inv;
}
function _matTrace(A) {
    if (A.rows !== A.cols) throw new Error('Trace requires a square matrix');
    let t = 0;
    for (let i = 0; i < A.rows; i++) t += _matGet(A,i,i);
    return t;
}
function _matRank(A) {
    const R = _matClone(A);
    let rank = 0;
    for (let col = 0; col < R.cols && rank < R.rows; col++) {
        let maxR = rank;
        for (let r = rank+1; r < R.rows; r++)
            if (Math.abs(_matGet(R,r,col)) > Math.abs(_matGet(R,maxR,col))) maxR = r;
        if (Math.abs(_matGet(R, maxR, col)) < 1e-10) continue;
        if (maxR !== rank)
            for (let c = 0; c < R.cols; c++) {
                const t = _matGet(R,rank,c); _matSet(R,rank,c,_matGet(R,maxR,c)); _matSet(R,maxR,c,t);
            }
        const piv = _matGet(R, rank, col);
        for (let c = 0; c < R.cols; c++) _matSet(R, rank, c, _matGet(R,rank,c)/piv);
        for (let r = 0; r < R.rows; r++) {
            if (r === rank) continue;
            const f = _matGet(R, r, col);
            for (let c = 0; c < R.cols; c++) _matSet(R, r, c, _matGet(R,r,c) - f*_matGet(R,rank,c));
        }
        rank++;
    }
    return rank;
}
function _matRREF(A) {
    const R = _matClone(A);
    let pivRow = 0;
    for (let col = 0; col < R.cols && pivRow < R.rows; col++) {
        let maxR = pivRow;
        for (let r = pivRow+1; r < R.rows; r++)
            if (Math.abs(_matGet(R,r,col)) > Math.abs(_matGet(R,maxR,col))) maxR = r;
        if (Math.abs(_matGet(R, maxR, col)) < 1e-10) continue;
        if (maxR !== pivRow)
            for (let c = 0; c < R.cols; c++) {
                const t = _matGet(R,pivRow,c); _matSet(R,pivRow,c,_matGet(R,maxR,c)); _matSet(R,maxR,c,t);
            }
        const piv = _matGet(R, pivRow, col);
        for (let c = 0; c < R.cols; c++) _matSet(R, pivRow, c, _matGet(R,pivRow,c)/piv);
        for (let r = 0; r < R.rows; r++) {
            if (r === pivRow) continue;
            const f = _matGet(R, r, col);
            for (let c = 0; c < R.cols; c++) _matSet(R, r, c, _matGet(R,r,c) - f*_matGet(R,pivRow,c));
        }
        pivRow++;
    }
    return R;
}
function _matPow(A, p) {
    if (A.rows !== A.cols) throw new Error('Matrix power requires square matrix');
    if (!Number.isInteger(p)) throw new Error('Exponent must be an integer');
    if (p < 0) { A = _matInverse(A); p = -p; }
    let R = _matMake(A.rows, A.cols);
    for (let i = 0; i < A.rows; i++) _matSet(R, i, i, 1);
    let base = _matClone(A);
    while (p > 0) {
        if (p & 1) R = _matMul(R, base);
        base = _matMul(base, base);
        p >>= 1;
    }
    return R;
}

function _fmtNum(v) {
    if (!isFinite(v)) return isNaN(v) ? 'NaN' : (v > 0 ? '∞' : '-∞');
    if (Math.abs(v - Math.round(v)) < 1e-9) return String(Math.round(v));
    return String(parseFloat(v.toPrecision(6)));
}

/* ══════════════════════════════════════════════════
   MATRIX UI
══════════════════════════════════════════════════ */
function _matFromState(id) { return _mats.find(m => m.id === id); }

function _matStateFromEl(id) {
    const m = _matFromState(id);
    if (!m) return;
    const el = document.getElementById('mat-grid-' + id);
    if (!el) return;
    el.querySelectorAll('input[data-r]').forEach(inp => {
        _matSet(m, +inp.dataset.r, +inp.dataset.c, parseFloat(inp.value) || 0);
    });
}

function _syncAllMats() { _mats.forEach(m => _matStateFromEl(m.id)); }

function _renderMatrixUI() {
    const wrap = document.getElementById('graph-matrix-wrap');
    if (!wrap) return;
    wrap.innerHTML = '';

    /* ── Left column: matrix list ── */
    const leftCol = document.createElement('div');
    leftCol.className = 'flex flex-col border-r border-slate-800/80 overflow-y-auto chat-scroll shrink-0';
    leftCol.style.cssText = 'width:260px;min-width:220px;background:var(--bg-surface,#0f172a);';

    const hdr = document.createElement('div');
    hdr.className = 'px-3 py-2 border-b border-slate-800/80 flex items-center justify-between shrink-0';
    hdr.innerHTML = `
        <span class="text-slate-300 text-[11px] font-medium flex items-center gap-1.5">
            <i class="fas fa-th-large text-sky-400 text-[10px]"></i> Matrices
        </span>
        <button id="mat-add-btn" class="w-6 h-6 flex items-center justify-center rounded-lg bg-sky-600/30 hover:bg-sky-600/50 text-sky-300 transition-colors" title="New matrix">
            <i class="fas fa-plus text-[10px]"></i>
        </button>`;
    leftCol.appendChild(hdr);

    const matList = document.createElement('div');
    matList.id = 'mat-list';
    matList.className = 'flex-1 p-2 flex flex-col gap-2 overflow-y-auto chat-scroll';

    _mats.forEach(m => {
        const card = document.createElement('div');
        card.className = 'rounded-xl bg-slate-800/60 border border-slate-700/40 p-2 flex flex-col gap-1.5';

        // Name + size row
        const titleRow = document.createElement('div');
        titleRow.className = 'flex items-center gap-1.5';
        const nameInp = document.createElement('input');
        nameInp.type = 'text'; nameInp.value = m.name;
        nameInp.className = 'mat-name-inp flex-1 bg-transparent text-[12px] font-bold font-mono outline-none border-b border-slate-700/40 pb-0.5 min-w-0';
        nameInp.spellcheck = false;
        nameInp.oninput = () => { m.name = nameInp.value; _scheduleSave(); };
        titleRow.appendChild(nameInp);
        card.appendChild(titleRow);

        const sizeRow = document.createElement('div');
        sizeRow.className = 'flex items-center gap-1 text-[9px] text-slate-500';
        sizeRow.appendChild(Object.assign(document.createElement('span'), {textContent:'Rows'}));
        const rInp = document.createElement('input');
        rInp.type = 'number'; rInp.min = 1; rInp.max = 8; rInp.value = m.rows;
        rInp.className = 'w-7 bg-slate-900 border border-slate-700/40 rounded text-[9px] text-slate-200 text-center outline-none px-0.5';
        sizeRow.appendChild(rInp);
        sizeRow.appendChild(Object.assign(document.createElement('span'), {textContent:'×'}));
        const cInp = document.createElement('input');
        cInp.type = 'number'; cInp.min = 1; cInp.max = 8; cInp.value = m.cols;
        cInp.className = 'w-7 bg-slate-900 border border-slate-700/40 rounded text-[9px] text-slate-200 text-center outline-none px-0.5';
        sizeRow.appendChild(cInp);

        const applySize = () => {
            const nr = Math.max(1, Math.min(8, parseInt(rInp.value)||1));
            const nc = Math.max(1, Math.min(8, parseInt(cInp.value)||1));
            _matStateFromEl(m.id);
            const old = [...m.data], oC = m.cols;
            m.rows = nr; m.cols = nc;
            m.data = Array(nr * nc).fill(0);
            for (let r = 0; r < Math.min(nr, Math.floor(old.length/oC)); r++)
                for (let c = 0; c < Math.min(nc, oC); c++)
                    _matSet(m, r, c, old[r * oC + c] || 0);
            _scheduleSave(); _renderMatrixUI();
        };
        rInp.onchange = applySize; cInp.onchange = applySize;

        const delBtn = document.createElement('button');
        delBtn.className = 'ml-auto text-[9px] text-slate-600 hover:text-red-400 w-5 h-5 flex items-center justify-center rounded hover:bg-red-900/20 transition-colors';
        delBtn.innerHTML = '<i class="fas fa-trash-alt"></i>'; delBtn.title = 'Delete matrix';
        delBtn.onclick = () => { _mats = _mats.filter(x => x.id !== m.id); _renderMatrixUI(); _scheduleSave(); };
        sizeRow.appendChild(delBtn);
        card.appendChild(sizeRow);

        // Grid
        const grid = document.createElement('div');
        grid.id = 'mat-grid-' + m.id;
        grid.style.cssText = `display:grid;grid-template-columns:repeat(${m.cols},1fr);gap:2px;`;
        for (let r = 0; r < m.rows; r++)
            for (let c = 0; c < m.cols; c++) {
                const inp = document.createElement('input');
                inp.type = 'number'; inp.step = 'any';
                inp.value = _fmtNum(_matGet(m, r, c));
                inp.dataset.r = r; inp.dataset.c = c;
                inp.className = 'mat-cell-inp bg-slate-900 border border-slate-700/30 rounded text-center text-[10px] font-mono text-slate-200 outline-none py-0.5 min-w-0';
                inp.style.minWidth = 0;
                inp.oninput = () => { _matSet(m, r, c, parseFloat(inp.value)||0); _scheduleSave(); };
                grid.appendChild(inp);
            }
        card.appendChild(grid);

        // Quick ops
        const opRow = document.createElement('div');
        opRow.className = 'flex gap-1 mt-0.5 flex-wrap';
        [['det','Det',m.rows===m.cols],['inv','Inv⁻¹',m.rows===m.cols],['tr','Tᵀ',true],
         ['trace','Tr',m.rows===m.cols],['rank','Rank',true],['rref','RREF',true]].forEach(([op,lbl,ok]) => {
            if (!ok) return;
            const b = document.createElement('button');
            b.className = 'mat-op-btn px-1.5 py-0.5 rounded text-[9px] bg-slate-700/60 text-slate-400 border border-slate-600/40 transition-colors';
            b.textContent = lbl;
            b.onclick = () => { _matStateFromEl(m.id); _doQuickOp(op, m); };
            opRow.appendChild(b);
        });
        card.appendChild(opRow);
        matList.appendChild(card);
    });

    leftCol.appendChild(matList);
    wrap.appendChild(leftCol);

    /* ── Right column: operations + result ── */
    const rightCol = document.createElement('div');
    rightCol.className = 'flex flex-1 flex-col min-w-0 min-h-0 overflow-hidden';
    rightCol.style.background = 'var(--bg-base,#0a0f1a)';

    // ─ Two-matrix panel ─
    const opsPanel = document.createElement('div');
    opsPanel.className = 'border-b border-slate-800/80 px-4 py-3 shrink-0 flex flex-col gap-3';

    // Helper to build a matrix select
    const mkSel = (defaultIdx) => {
        const s = document.createElement('select');
        s.className = 'bg-slate-800 border border-slate-700/60 text-slate-200 text-[10px] rounded px-1.5 py-1 outline-none';
        s.style.minWidth = '80px';
        _mats.forEach(m => {
            const o = document.createElement('option');
            o.value = m.id; o.textContent = `${m.name} (${m.rows}×${m.cols})`; s.appendChild(o);
        });
        if (s.options.length > defaultIdx) s.selectedIndex = defaultIdx;
        return s;
    };

    const scalarInp = document.createElement('input');
    scalarInp.type = 'number'; scalarInp.value = '2'; scalarInp.placeholder = 'n';
    scalarInp.className = 'w-12 bg-slate-800 border border-slate-700/60 text-slate-200 text-[10px] rounded px-1.5 py-1 outline-none';
    scalarInp.title = 'n (scalar / power)';

    // Two-matrix row
    const twoRow = document.createElement('div');
    twoRow.className = 'flex flex-wrap items-center gap-1.5';
    twoRow.innerHTML = `<span class="text-slate-500 text-[9px] font-medium uppercase tracking-wide w-full">Two-matrix</span>`;
    const selA = mkSel(0), selB = mkSel(1);
    const opSel = document.createElement('select');
    opSel.className = 'bg-slate-800 border border-slate-700/60 text-slate-200 text-[10px] rounded px-1.5 py-1 outline-none';
    [['add','A + B'],['sub','A − B'],['mul','A × B']].forEach(([v,l]) => {
        const o = document.createElement('option'); o.value=v; o.textContent=l; opSel.appendChild(o);
    });
    const calcBtn = document.createElement('button');
    calcBtn.className = 'mat-calc-btn px-3 py-1 rounded-lg text-[10px] font-medium border transition-colors';
    calcBtn.textContent = '=';
    calcBtn.onclick = () => {
        _syncAllMats();
        const A = _matFromState(selA.value), B = _matFromState(selB.value);
        if (!A || !B) { _showMatError('Select two matrices'); return; }
        try {
            const op = opSel.value;
            const mat = op==='add' ? _matAdd(A,B) : op==='sub' ? _matSub(A,B) : _matMul(A,B);
            _showMatResult({scalar:null,mat}, `${A.name} ${op==='add'?'+':op==='sub'?'−':'×'} ${B.name}`);
        } catch(e) { _showMatError(e.message); }
    };
    twoRow.append(selA, opSel, selB, calcBtn);
    opsPanel.appendChild(twoRow);

    // Single-matrix row
    const oneRow = document.createElement('div');
    oneRow.className = 'flex flex-wrap items-center gap-1.5';
    oneRow.innerHTML = `<span class="text-slate-500 text-[9px] font-medium uppercase tracking-wide w-full">Single-matrix</span>`;
    const selC = mkSel(0);
    [['inv','Inverse'],['det','Det'],['tr','Transpose'],['trace','Trace'],['rank','Rank'],
     ['rref','RREF'],['scale','Scale×n'],['pow','Aⁿ']].forEach(([v,l]) => {
        const b = document.createElement('button');
        b.className = 'mat-op-btn px-2 py-1 rounded text-[9px] bg-slate-700/60 text-slate-400 border border-slate-600/40 transition-colors';
        b.textContent = l;
        b.onclick = () => {
            _syncAllMats();
            const m = _matFromState(selC.value); if (!m) return;
            const n = parseFloat(scalarInp.value)||2;
            try {
                const r = v==='inv'   ? {scalar:null, mat:_matInverse(m)}
                        : v==='det'   ? {scalar:_fmtNum(_matDet(m)), mat:null}
                        : v==='tr'    ? {scalar:null, mat:_matTranspose(m)}
                        : v==='trace' ? {scalar:_fmtNum(_matTrace(m)), mat:null}
                        : v==='rank'  ? {scalar:String(_matRank(m)), mat:null}
                        : v==='rref'  ? {scalar:null, mat:_matRREF(m)}
                        : v==='scale' ? {scalar:null, mat:_matScale(m,n)}
                        :               {scalar:null, mat:_matPow(m,Math.round(n))};
                _showMatResult(r, `${l}(${m.name})${v==='scale'||v==='pow'?`, n=${n}`:''}`);
            } catch(e) { _showMatError(e.message); }
        };
        oneRow.appendChild(b);
    });
    oneRow.append(selC, scalarInp);
    opsPanel.appendChild(oneRow);
    rightCol.appendChild(opsPanel);

    // Result area
    const resArea = document.createElement('div');
    resArea.id = 'mat-result-area';
    resArea.className = 'flex-1 overflow-y-auto chat-scroll p-4 flex flex-col gap-3';
    resArea.innerHTML = `<p class="italic text-slate-600 text-[11px] text-center mt-8">Select an operation above to see the result.</p>`;
    rightCol.appendChild(resArea);
    wrap.appendChild(rightCol);

    // Wire add button
    document.getElementById('mat-add-btn').onclick = () => {
        const names = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        const name = names[_mats.length % names.length] || 'M';
        _mats.push({ id:_matNid(), name, rows:3, cols:3, data:Array(9).fill(0) });
        _scheduleSave(); _renderMatrixUI();
    };
}

function _doQuickOp(op, m) {
    try {
        const r = op==='det'   ? {scalar:_fmtNum(_matDet(m)), mat:null}
                : op==='inv'   ? {scalar:null, mat:_matInverse(m)}
                : op==='tr'    ? {scalar:null, mat:_matTranspose(m)}
                : op==='trace' ? {scalar:_fmtNum(_matTrace(m)), mat:null}
                : op==='rank'  ? {scalar:String(_matRank(m)), mat:null}
                :                {scalar:null, mat:_matRREF(m)};
        _showMatResult(r, `${op}(${m.name})`);
    } catch(e) { _showMatError(e.message); }
}

function _showMatResult(res, label) {
    const area = document.getElementById('mat-result-area');
    if (!area) return;
    const box = document.createElement('div');
    box.className = 'rounded-xl bg-slate-800/60 border border-slate-700/40 p-3';
    const lbl = document.createElement('div');
    lbl.className = 'mat-result-label text-[10px] font-mono font-bold mb-2';
    lbl.textContent = '= ' + label;
    box.appendChild(lbl);

    if (res.scalar !== null) {
        const v = document.createElement('div');
        v.className = 'text-2xl font-mono text-white font-bold text-center py-2';
        v.textContent = res.scalar;
        box.appendChild(v);
    } else if (res.mat) {
        const M = res.mat;
        const tbl = document.createElement('div');
        tbl.style.cssText = `display:inline-grid;grid-template-columns:repeat(${M.cols},auto);gap:3px 6px;`;
        for (let r = 0; r < M.rows; r++)
            for (let c = 0; c < M.cols; c++) {
                const cell = document.createElement('div');
                cell.className = 'text-[11px] font-mono text-slate-200 text-right px-1.5 py-0.5 bg-slate-900/60 rounded';
                cell.style.minWidth = '36px';
                cell.textContent = _fmtNum(_matGet(M, r, c));
                tbl.appendChild(cell);
            }
        // Wrap with bracket visual
        const bracket = document.createElement('div');
        bracket.className = 'flex items-center gap-1';
        const makeBar = (left) => {
            const b = document.createElement('div');
            b.style.cssText = `width:6px;height:100%;border:2px solid rgb(var(--tw-sky-400));${left?'border-right:none;border-radius:4px 0 0 4px':'border-left:none;border-radius:0 4px 4px 0'}`;
            return b;
        };
        bracket.append(makeBar(true), tbl, makeBar(false));
        box.appendChild(bracket);

        const storeBtn = document.createElement('button');
        storeBtn.className = 'mat-store-btn mt-2 text-[9px] text-slate-500 border border-slate-700/40 px-2 py-1 rounded transition-colors';
        storeBtn.textContent = '+ Store as new matrix';
        storeBtn.onclick = () => {
            const names = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
            const name = names[_mats.length % names.length] || 'R';
            _mats.push({ id:_matNid(), name, rows:M.rows, cols:M.cols, data:[...M.data] });
            _scheduleSave(); _renderMatrixUI();
        };
        box.appendChild(storeBtn);
    }

    area.insertBefore(box, area.firstChild);
    area.querySelectorAll('p.italic').forEach(p => p.remove());
}

function _showMatError(msg) {
    const area = document.getElementById('mat-result-area');
    if (!area) return;
    const box = document.createElement('div');
    box.className = 'rounded-xl bg-red-900/20 border border-red-700/40 p-3 text-red-400 text-[11px] font-mono';
    box.textContent = '⚠ ' + msg;
    area.insertBefore(box, area.firstChild);
    area.querySelectorAll('p.italic').forEach(p => p.remove());
}

/* ══════════════════════════════════════════════════
   MODE SWITCH
══════════════════════════════════════════════════ */
function _switchMode(m) {
    _mode = m;
    const c2   = document.getElementById('graph-canvas-2d');
    const c3   = document.getElementById('graph-canvas-3d');
    const mWrap = document.getElementById('graph-matrix-wrap');
    const side  = document.getElementById('graph-sidebar');
    if (c2)   c2.style.display    = m === '2d'     ? 'block' : 'none';
    if (c3)   c3.style.display    = m === '3d'     ? 'block' : 'none';
    if (mWrap) mWrap.style.display = m === 'matrix' ? 'flex'  : 'none';
    if (side)  side.style.display  = m !== 'matrix' ? 'flex'  : 'none';

    ['graph-mode-2d','graph-mode-3d','graph-mode-matrix'].forEach(id => {
        const btn = document.getElementById(id);
        if (!btn) return;
        const active = (id === 'graph-mode-' + m);
        // Use CSS custom properties so the accent colour is respected
        btn.style.background = active ? 'rgba(var(--accent-rgb),0.15)' : '';
        btn.style.color      = active ? 'var(--accent-light, #38bdf8)' : '';
        btn.style.opacity    = active ? '1' : '';
    });

    if (m === 'matrix') {
        _renderMatrixUI();
    } else {
        _renderSidebar();
        _resizeCanvases();
    }
}

/* ══════════════════════════════════════════════════
   PERSISTENCE
══════════════════════════════════════════════════ */
function _scheduleSave() {
    if (!_file) return;
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => {
        if (typeof _sciWriteFile === 'function') {
            _sciWriteFile(_file, { mode:_mode, graphs:_graphs, view2d:_view2d, view3d:_view3d, mats:_mats });
        }
    }, 500);
}

/* ══════════════════════════════════════════════════
   PUBLIC API
══════════════════════════════════════════════════ */
window.openVaultGraphEditor = function(file) {
    _file = file;
    const saved = (typeof _sciReadFile === 'function' ? _sciReadFile(file) : null) || {};

    _mode   = saved.mode   || '2d';
    _graphs = saved.graphs || [
        { id:_nid(), expr:'sin(x)',  color:'#38bdf8', visible:true, label:'' },
        { id:_nid(), expr:'cos(x)',  color:'#f87171', visible:true, label:'' },
        { id:_nid(), expr:'x^2/10', color:'#4ade80', visible:true, label:'' },
    ];
    _view2d = Object.assign({ xMin:-10, xMax:10, yMin:-8, yMax:8 }, saved.view2d || {});
    _view3d = Object.assign({ rotX:0.45, rotY:0.5, zoom:0.72 }, saved.view3d || {});
    _mats   = saved.mats || [];

    const area = document.getElementById('vault-graph-area');
    if (area) area.style.display = 'flex';
    document.getElementById('vault-normal-view').style.display = 'none';

    const titleSpan = document.getElementById('vault-viewer-title');
    if (titleSpan) { titleSpan.textContent = file.originalName; titleSpan.classList.remove('hidden'); }
    document.getElementById('vault-doc-title-input')?.classList.add('hidden');

    // Wire mode buttons
    const b2 = document.getElementById('graph-mode-2d');
    const b3 = document.getElementById('graph-mode-3d');
    const bM = document.getElementById('graph-mode-matrix');
    if (b2) b2.onclick = () => _switchMode('2d');
    if (b3) b3.onclick = () => _switchMode('3d');
    if (bM) bM.onclick = () => _switchMode('matrix');

    // Wire header add-expr button
    const addBtn = document.getElementById('graph-add-expr');
    if (addBtn) addBtn.onclick = () => {
        _graphs.push({ id:_nid(), expr:'', color: DEFAULT_COLORS[_graphs.length % DEFAULT_COLORS.length], visible:true, label:'' });
        _renderSidebar();
        const list = document.getElementById('graph-expr-list');
        if (list) { const inputs = list.querySelectorAll('input[type=text]'); if (inputs.length) inputs[inputs.length-1].focus(); }
        _scheduleSave();
    };

    // Mount canvas events
    _mountCanvasEvents();

    // ResizeObserver
    if (_resObs) _resObs.disconnect();
    const wrap = document.getElementById('graph-canvas-wrap');
    if (wrap) { _resObs = new ResizeObserver(_resizeCanvases); _resObs.observe(wrap); }

    // Defer until browser has reflowed the newly-visible area —
    // otherwise getBoundingClientRect() returns 0×0 on first open
    requestAnimationFrame(() => requestAnimationFrame(() => _switchMode(_mode)));
};

window.closeVaultGraphEditor = function() {
    const area = document.getElementById('vault-graph-area');
    if (area) area.style.display = 'none';
    document.getElementById('vault-normal-view').style.display = '';
    document.getElementById('vault-viewer-title')?.classList.remove('hidden');
    document.getElementById('vault-doc-title-input')?.classList.add('hidden');
    if (_resObs) { _resObs.disconnect(); _resObs = null; }
    clearTimeout(_saveTimer);
    if (_file && typeof _sciWriteFile === 'function') {
        _sciWriteFile(_file, { mode:_mode, graphs:_graphs, view2d:_view2d, view3d:_view3d });
    }
    _file = null;
};

})();
