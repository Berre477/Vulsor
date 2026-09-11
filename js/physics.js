// ── Physics Sandbox ──────────────────────────────────────────────────────────
'use strict';
(function () {

/* ── Math helpers ── */
const TWO_PI = Math.PI * 2;
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function cross2(ax, ay, bx, by) { return ax * by - ay * bx; }
function _physBgBase() {
    return getComputedStyle(document.documentElement).getPropertyValue('--bg-base').trim() || '#080d18';
}
function _physIsLight() {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--bg-base').trim();
    if (!v) return false;
    const hex = v.replace('#','');
    const r = parseInt(hex.substr(0,2),16)||0;
    const g = parseInt(hex.substr(2,2),16)||0;
    const b = parseInt(hex.substr(4,2),16)||0;
    return (r*299 + g*587 + b*114)/1000 > 128;
}

/* ── Scene state ── */
let _sc    = null;
let _tool  = 'ball';
let _sel   = null;
let _linkA = null;
let _mx = 0, _my = 0;
let _drag = null, _dragOX = 0, _dragOY = 0;

const GRAVITY_PX = 55;
const COULOMB_K  = 7000;
let _idSeq = 0;
function _nid() { return 'o' + (++_idSeq); }

function _newScene(W, H) {
    return {
        objects: [], links: [],
        settings: { gravity: 9.8, restitution: 0.8, springK: 40, airDrag: 0.001 },
        W, H, t: 0,
    };
}

/* ══════════════════════════════════════════════════
   POLYGON HELPERS  (SAT collision)
══════════════════════════════════════════════════ */

// World-space vertices for polygon objects
function _getVerts(o) {
    const a = o.angle || 0, cos = Math.cos(a), sin = Math.sin(a);
    let local;
    if (o.type === 'box') {
        const hw = (o.w || 50) / 2, hh = (o.h || 35) / 2;
        local = [[-hw,-hh],[hw,-hh],[hw,hh],[-hw,hh]];
    } else if (o.type === 'triangle') {
        const r = o.radius || 28;
        local = [[0,-r],[r*0.866,r*0.5],[-r*0.866,r*0.5]];
    } else if (o.type === 'ramp') {
        const hw = (o.w || 110) / 2, hh = (o.h || 14) / 2;
        local = [[-hw,hh],[hw,-hh],[hw,hh]];  // right-triangle wedge
    }
    return (local || []).map(([lx, ly]) => [
        o.x + lx * cos - ly * sin,
        o.y + lx * sin + ly * cos,
    ]);
}

function _polyAxes(verts) {
    return verts.map((v, i) => {
        const j = (i + 1) % verts.length;
        const dx = verts[j][0] - v[0], dy = verts[j][1] - v[1];
        const len = Math.hypot(dx, dy) || 1;
        return [-dy / len, dx / len];
    });
}

function _project(verts, ax) {
    let mn = Infinity, mx = -Infinity;
    for (const [vx, vy] of verts) {
        const d = vx * ax[0] + vy * ax[1];
        if (d < mn) mn = d;
        if (d > mx) mx = d;
    }
    return [mn, mx];
}

// SAT between two polygons → null or { depth, nx, ny }
function _satPoly(a, b) {
    const va = _getVerts(a), vb = _getVerts(b);
    if (!va.length || !vb.length) return null;
    const axes = [..._polyAxes(va), ..._polyAxes(vb)];
    let minDep = Infinity, mnx = 0, mny = 0;
    for (const [ax, ay] of axes) {
        const [minA, maxA] = _project(va, [ax, ay]);
        const [minB, maxB] = _project(vb, [ax, ay]);
        const ov = Math.min(maxA, maxB) - Math.max(minA, minB);
        if (ov <= 0) return null;
        if (ov < minDep) { minDep = ov; mnx = ax; mny = ay; }
    }
    // Orient normal from a → b
    if ((b.x - a.x) * mnx + (b.y - a.y) * mny < 0) { mnx = -mnx; mny = -mny; }
    // Approximate contact point: average of deepest verts of b
    const [minA] = _project(va, [mnx, mny]);
    let cx = 0, cy = 0, cnt = 0;
    for (const [vx, vy] of vb) {
        if (vx * mnx + vy * mny < minA + minDep + 1) { cx += vx; cy += vy; cnt++; }
    }
    if (cnt === 0) { cx = (a.x + b.x) / 2; cy = (a.y + b.y) / 2; } else { cx /= cnt; cy /= cnt; }
    return { depth: minDep, nx: mnx, ny: mny, cx, cy };
}

// SAT between circle (ball) and polygon
function _satCirclePoly(ball, poly) {
    const verts = _getVerts(poly);
    if (!verts.length) return null;
    const axes = [..._polyAxes(verts)];
    // Add axes from each vertex toward circle center
    for (const [vx, vy] of verts) {
        const dx = ball.x - vx, dy = ball.y - vy;
        const len = Math.hypot(dx, dy) || 1;
        axes.push([dx / len, dy / len]);
    }
    const r = ball.radius || 12;
    let minDep = Infinity, mnx = 0, mny = 0;
    for (const [ax, ay] of axes) {
        const ballC = ball.x * ax + ball.y * ay;
        const [minP, maxP] = _project(verts, [ax, ay]);
        const ov = Math.min(ballC + r, maxP) - Math.max(ballC - r, minP);
        if (ov <= 0) return null;
        if (ov < minDep) { minDep = ov; mnx = ax; mny = ay; }
    }
    if ((poly.x - ball.x) * mnx + (poly.y - ball.y) * mny < 0) { mnx = -mnx; mny = -mny; }
    return { depth: minDep, nx: mnx, ny: mny, cx: ball.x + mnx * r, cy: ball.y + mny * r };
}

// Moment of inertia
function _getMOI(o) {
    if (o.type === 'box')      return o.mass * ((o.w || 50) ** 2 + (o.h || 35) ** 2) / 12;
    if (o.type === 'triangle') return o.mass * (o.radius || 28) ** 2 * 0.5;
    if (o.type === 'ramp')     return Infinity; // fixed
    return Infinity;
}

// Bounding radius for broad-phase & wall check
function _brad(o) {
    if (o.type === 'ball')     return o.radius || 12;
    if (o.type === 'box')      return Math.hypot(o.w || 50, o.h || 35) / 2;
    if (o.type === 'triangle') return (o.radius || 28) * 1.1;
    if (o.type === 'charge')   return o.radius || 14;
    return 12;
}

// Apply linear + angular impulse
function _applyImpulse(o, J, nx, ny, cx, cy, sign) {
    if (o.fixed) return;
    o.vx += sign * J * nx / o.mass;
    o.vy += sign * J * ny / o.mass;
    if (o.omega !== undefined) {
        const rx = cx - o.x, ry = cy - o.y;
        o.omega += sign * cross2(rx, ry, nx * J, ny * J) / _getMOI(o);
    }
}

/* ══════════════════════════════════════════════════
   PHYSICS STEP
══════════════════════════════════════════════════ */
function _step(dt) {
    if (!_sc) return;
    const { objects, links, settings: cfg } = _sc;
    const W = _sc.W, H = _sc.H;

    // Reset accelerations
    objects.forEach(o => { o.ax = 0; o.ay = 0; });

    // Gravity
    objects.forEach(o => {
        if (o.fixed || o.id === _drag) return;
        if (['ball','box','triangle','charge'].includes(o.type))
            o.ay += cfg.gravity * GRAVITY_PX;
    });

    // Spring / rope forces
    links.forEach(lk => {
        const a = objects.find(o => o.id === lk.a);
        const b = objects.find(o => o.id === lk.b);
        if (!a || !b) return;
        const dx = b.x - a.x, dy = b.y - a.y;
        const len = Math.hypot(dx, dy);
        if (len < 0.5) return;
        const ext = len - lk.L0;
        if (lk.type === 'rope' && ext <= 0) return;
        const k = lk.type === 'rope' ? 8000 : cfg.springK;
        const F = k * ext / len;
        if (!a.fixed && a.id !== _drag) { a.ax += F * dx / a.mass; a.ay += F * dy / a.mass; }
        if (!b.fixed && b.id !== _drag) { b.ax -= F * dx / b.mass; b.ay -= F * dy / b.mass; }
    });

    // Gravity wells
    objects.filter(o => o.type === 'gravity_well').forEach(gw => {
        objects.forEach(o => {
            if (o.fixed || o.id === gw.id || o.id === _drag) return;
            if (!['ball','box','triangle','charge'].includes(o.type)) return;
            const dx = gw.x - o.x, dy = gw.y - o.y;
            const r2 = dx * dx + dy * dy;
            if (r2 < 100) return;
            const r  = Math.sqrt(r2);
            const F  = (gw.strength || 5000) / r2;
            o.ax += F * dx / r;
            o.ay += F * dy / r;
        });
    });

    // Coulomb forces
    const chObjs = objects.filter(o => o.type === 'charge');
    for (let i = 0; i < chObjs.length; i++) {
        for (let j = i + 1; j < chObjs.length; j++) {
            const a = chObjs[i], b = chObjs[j];
            const dx = b.x - a.x, dy = b.y - a.y;
            const r2 = dx * dx + dy * dy;
            if (r2 < 64) continue;
            const r = Math.sqrt(r2);
            const F = COULOMB_K * a.charge * b.charge / r2;
            const fx = F * dx / r, fy = F * dy / r;
            if (!a.fixed && a.id !== _drag) { a.ax -= fx / a.mass; a.ay -= fy / a.mass; }
            if (!b.fixed && b.id !== _drag) { b.ax += fx / b.mass; b.ay += fy / b.mass; }
        }
    }

    // Integrate + wall bounce
    const airF = 1 - cfg.airDrag * 60;
    objects.forEach(o => {
        if (o.fixed || o.id === _drag) return;
        if (!['ball','box','triangle','charge'].includes(o.type)) return;
        o.vx = (o.vx + o.ax * dt) * airF;
        o.vy = (o.vy + o.ay * dt) * airF;
        o.x  += o.vx * dt;
        o.y  += o.vy * dt;
        // Angular integration
        if (o.omega !== undefined) {
            o.omega *= 0.9985;
            o.angle  = ((o.angle || 0) + o.omega * dt) % TWO_PI;
        }
        // Wall bounce using bounding radius
        const r = _brad(o), e = cfg.restitution;
        if (o.x - r < 0)      { o.x = r;      o.vx =  Math.abs(o.vx) * e; if (o.omega != null) o.omega *= -0.4; }
        if (o.x + r > W)      { o.x = W - r;  o.vx = -Math.abs(o.vx) * e; if (o.omega != null) o.omega *= -0.4; }
        if (o.y - r < 0)      { o.y = r;      o.vy =  Math.abs(o.vy) * e; }
        if (o.y + r > H - 30) {
            o.y = H - 30 - r;
            o.vy = -Math.abs(o.vy) * e;
            if (o.omega != null) { o.omega = o.omega * 0.65 - o.vx * 0.04; o.vx *= 0.97; }
        }
    });

    // ── Collision resolution ──────────────────────────────────────
    const balls  = objects.filter(o => o.type === 'ball');
    const polys  = objects.filter(o => ['box','triangle','ramp'].includes(o.type));
    const dynPol = polys.filter(o => !o.fixed);

    // Ball vs ball
    for (let i = 0; i < balls.length; i++) {
        for (let j = i + 1; j < balls.length; j++) {
            const a = balls[i], b = balls[j];
            const dx = b.x - a.x, dy = b.y - a.y;
            const d = Math.hypot(dx, dy), minD = a.radius + b.radius;
            if (d >= minD || d < 0.01) continue;
            const nx = dx / d, ny = dy / d, e = cfg.restitution;
            const dvn = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
            if (dvn > 0) {
                const J = -(1 + e) * dvn / ((!a.fixed ? 1/a.mass : 0) + (!b.fixed ? 1/b.mass : 0) || 1);
                _applyImpulse(a, J, nx, ny, (a.x+b.x)/2, (a.y+b.y)/2,  1);
                _applyImpulse(b, J, nx, ny, (a.x+b.x)/2, (a.y+b.y)/2, -1);
            }
            const ov = (minD - d) / 2;
            if (!a.fixed) { a.x -= nx * ov; a.y -= ny * ov; }
            if (!b.fixed) { b.x += nx * ov; b.y += ny * ov; }
        }
    }

    // Ball vs polygon (box / triangle / ramp)
    for (const ball of balls) {
        for (const poly of polys) {
            const col = _satCirclePoly(ball, poly);
            if (!col) continue;
            const { depth, nx, ny, cx, cy } = col;
            const e  = cfg.restitution;
            const rAx = cx - ball.x, rAy = cy - ball.y;
            const rBx = cx - poly.x, rBy = cy - poly.y;
            const IB = _getMOI(poly);
            const rBxN = cross2(rBx, rBy, nx, ny);
            const vRelx = (ball.vx||0) - (poly.vx||0) - (poly.omega||0)*rBy;
            const vRely = (ball.vy||0) - (poly.vy||0) + (poly.omega||0)*rBx;
            const vRn = vRelx * nx + vRely * ny;
            if (vRn > 0) continue;
            const denom = (!ball.fixed ? 1/ball.mass : 0) + (!poly.fixed ? 1/poly.mass : 0)
                        + (!poly.fixed ? rBxN*rBxN/IB : 0);
            if (denom < 1e-10) continue;
            const J = -(1 + e) * vRn / denom;
            _applyImpulse(ball, J, nx, ny, cx, cy,  1);
            _applyImpulse(poly, J, nx, ny, cx, cy, -1);
            const cor = depth * 0.5;
            if (!ball.fixed) { ball.x -= nx * cor; ball.y -= ny * cor; }
            if (!poly.fixed) { poly.x += nx * cor; poly.y += ny * cor; }
        }
    }

    // Dynamic polygon vs polygon  (box-box, box-triangle, triangle-triangle)
    for (let i = 0; i < dynPol.length; i++) {
        for (let j = i + 1; j < dynPol.length; j++) {
            const col = _satPoly(dynPol[i], dynPol[j]);
            if (!col) continue;
            const { depth, nx, ny, cx, cy } = col;
            const a = dynPol[i], b = dynPol[j];
            const e  = cfg.restitution;
            const rAx = cx - a.x, rAy = cy - a.y;
            const rBx = cx - b.x, rBy = cy - b.y;
            const IA = _getMOI(a), IB = _getMOI(b);
            const rAxN = cross2(rAx, rAy, nx, ny);
            const rBxN = cross2(rBx, rBy, nx, ny);
            const vRelx = (a.vx||0)-(b.vx||0) - (b.omega||0)*rBy + (a.omega||0)*rAy;
            const vRely = (a.vy||0)-(b.vy||0) + (b.omega||0)*rBx - (a.omega||0)*rAx;
            const vRn = vRelx * nx + vRely * ny;
            if (vRn > 0) continue;
            const denom = 1/a.mass + 1/b.mass + rAxN*rAxN/IA + rBxN*rBxN/IB;
            if (denom < 1e-10) continue;
            const J = -(1 + e) * vRn / denom;
            _applyImpulse(a, J, nx, ny, cx, cy,  1);
            _applyImpulse(b, J, nx, ny, cx, cy, -1);
            const cor = depth * 0.5;
            a.x -= nx * cor; a.y -= ny * cor;
            b.x += nx * cor; b.y += ny * cor;
        }
    }

    // Wave phases
    objects.filter(o => o.type === 'wave').forEach(w => {
        w.phase = ((w.phase || 0) + dt * (w.freq || 1.5)) % 1;
    });
    _sc.t += dt;
}

/* ══════════════════════════════════════════════════
   DRAW
══════════════════════════════════════════════════ */
function _draw(ctx, W, H) {
    if (!_sc) return;
    const sc = _sc;
    const light = _physIsLight();

    // Grid
    ctx.strokeStyle = light ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.03)'; ctx.lineWidth = 1;
    for (let x = 0; x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
    for (let y = 0; y < H; y += 40) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }

    // Floor
    ctx.fillStyle = light ? '#d1d5db' : '#1e293b'; ctx.fillRect(0, H-30, W, 30);
    ctx.strokeStyle = light ? '#9ca3af' : '#334155'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, H-30); ctx.lineTo(W, H-30); ctx.stroke();
    ctx.strokeStyle = light ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.04)'; ctx.lineWidth = 1;
    for (let x = 0; x < W; x += 22) { ctx.beginPath(); ctx.moveTo(x, H-30); ctx.lineTo(x-14, H); ctx.stroke(); }

    // E-field lines
    const charges = sc.objects.filter(o => o.type === 'charge');
    if (charges.length) _drawField(ctx, charges, W, H);

    // Wave ripples
    sc.objects.filter(o => o.type === 'wave').forEach(w => {
        for (let i = 0; i < 7; i++) {
            const p = ((w.phase || 0) - i*(1/7) + 2) % 1;
            const r = p * 280;
            if (r < 2) continue;
            ctx.beginPath(); ctx.arc(w.x, w.y, r, 0, TWO_PI);
            ctx.strokeStyle = `rgba(167,139,250,${(1-p)*0.3})`; ctx.lineWidth = 1.5; ctx.stroke();
        }
    });

    // Links
    sc.links.forEach(lk => {
        const a = sc.objects.find(o => o.id === lk.a);
        const b = sc.objects.find(o => o.id === lk.b);
        if (!a || !b) return;
        const ext = Math.hypot(b.x-a.x, b.y-a.y) - lk.L0;
        lk.type === 'spring' ? _drawSpring(ctx, a.x, a.y, b.x, b.y, ext) : _drawRope(ctx, a.x, a.y, b.x, b.y, ext > 2);
    });

    // Link preview
    if (_linkA) {
        const src = sc.objects.find(o => o.id === _linkA);
        if (src) {
            ctx.strokeStyle = '#38bdf8'; ctx.lineWidth = 1.5; ctx.setLineDash([5,5]);
            ctx.beginPath(); ctx.moveTo(src.x, src.y); ctx.lineTo(_mx, _my);
            ctx.stroke(); ctx.setLineDash([]);
        }
    }

    // Objects (ramps first — they're backgrounds)
    sc.objects.filter(o => o.type === 'ramp').forEach(o => _drawObj(ctx, o));
    sc.objects.filter(o => o.type !== 'ramp').forEach(o => _drawObj(ctx, o));

    // Empty hint
    if (!sc.objects.length) {
        ctx.fillStyle = light ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.13)'; ctx.font = '14px system-ui,sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('Select a tool below, then click the canvas to place objects', W/2, H/2 - 12);
        ctx.font = '11px system-ui,sans-serif'; ctx.fillStyle = light ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.05)';
        ctx.fillText('Spring / Rope: click first object → click second object', W/2, H/2 + 12);
        ctx.textAlign = 'left';
    }

    // Stats
    ctx.fillStyle = light ? '#6b7280' : '#475569'; ctx.font = '10px system-ui,sans-serif';
    ctx.fillText(`objects: ${sc.objects.length}   links: ${sc.links.length}   t = ${sc.t.toFixed(1)} s`, 10, H-8);
}

function _drawSpring(ctx, x1, y1, x2, y2, ext) {
    const dx = x2-x1, dy = y2-y1, len = Math.hypot(dx,dy);
    if (len < 1) return;
    const nx = -dy/len, ny = dx/len, coils = 8, amp = 9;
    ctx.strokeStyle = Math.abs(ext)>12 ? (ext>0 ? '#f87171':'#38bdf8') : '#f59e0b';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x1,y1);
    for (let i = 1; i < coils*2; i++) {
        const t = i/(coils*2), side = (i%4<2 ? amp : -amp);
        ctx.lineTo(x1+dx*t+nx*side, y1+dy*t+ny*side);
    }
    ctx.lineTo(x2,y2); ctx.stroke();
    if (Math.abs(ext) > 3) {
        ctx.fillStyle = 'rgba(148,163,184,0.65)'; ctx.font = '8px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText((ext>0?'+':'')+ext.toFixed(0)+'px', (x1+x2)/2, (y1+y2)/2-10); ctx.textAlign = 'left';
    }
}

function _drawRope(ctx, x1, y1, x2, y2, taut) {
    ctx.strokeStyle = taut ? '#f87171' : '#94a3b8';
    ctx.lineWidth = taut ? 2.5 : 1.5;
    ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
}

function _drawField(ctx, charges, W, H) {
    const LINES = 10, STEP = 4, STEPS = 120;
    charges.filter(c => c.charge > 0).forEach(src => {
        for (let li = 0; li < LINES; li++) {
            const angle = (li/LINES)*TWO_PI;
            let px = src.x + Math.cos(angle)*18, py = src.y + Math.sin(angle)*18;
            ctx.beginPath(); ctx.moveTo(px,py);
            for (let s = 0; s < STEPS; s++) {
                let ex=0, ey=0;
                charges.forEach(c => {
                    const dx=px-c.x, dy=py-c.y, r2=dx*dx+dy*dy;
                    if (r2<100) return;
                    const r3=Math.pow(r2,1.5);
                    ex+=c.charge*dx/r3; ey+=c.charge*dy/r3;
                });
                const em=Math.hypot(ex,ey);
                if (em<1e-7) break;
                px+=ex/em*STEP; py+=ey/em*STEP;
                ctx.lineTo(px,py);
                if (px<0||px>W||py<0||py>H) break;
                if (charges.some(c=>c.charge<0&&Math.hypot(px-c.x,py-c.y)<18)) break;
            }
            ctx.strokeStyle='rgba(56,189,248,0.18)'; ctx.lineWidth=1; ctx.stroke();
        }
    });
}

function _drawObj(ctx, o) {
    const sel = _sel === o.id;

    /* ── Ball ── */
    if (o.type === 'ball') {
        const r = o.radius, spd = Math.hypot(o.vx||0, o.vy||0);
        const hot = clamp(spd/250, 0, 1);
        const grd = ctx.createRadialGradient(o.x-r*0.3, o.y-r*0.3, r*0.1, o.x, o.y, r);
        if (o.fixed) { grd.addColorStop(0,'#fde68a'); grd.addColorStop(1,'#d97706'); }
        else { grd.addColorStop(0, hot>0.5?'#fca5a5':'#93c5fd'); grd.addColorStop(1, hot>0.5?'#ef4444':'#3b82f6'); }
        ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(o.x,o.y,r,0,TWO_PI); ctx.fill();
        if (sel) { ctx.strokeStyle='#38bdf8'; ctx.lineWidth=2.5; ctx.stroke(); }
        else if (o.fixed) { ctx.strokeStyle='#fbbf24'; ctx.lineWidth=2; ctx.setLineDash([3,3]); ctx.stroke(); ctx.setLineDash([]); }
        ctx.fillStyle='rgba(0,0,0,0.75)'; ctx.font=`bold ${Math.max(8,Math.round(r*0.65))}px sans-serif`; ctx.textAlign='center';
        ctx.fillText(o.mass+'kg', o.x, o.y+r*0.35);
        if (spd > 8) {
            const sc2 = Math.min(60/spd, 1);
            ctx.strokeStyle='rgba(74,222,128,0.55)'; ctx.lineWidth=1.5;
            ctx.beginPath(); ctx.moveTo(o.x,o.y); ctx.lineTo(o.x+(o.vx||0)*sc2, o.y+(o.vy||0)*sc2); ctx.stroke();
        }
        const KE = 0.5*o.mass*spd*spd/1e4;
        if (KE>0.05) { ctx.fillStyle='rgba(251,191,36,0.55)'; ctx.font='8px sans-serif'; ctx.fillText(KE.toFixed(2)+'J', o.x, o.y-r-4); }
    }

    /* ── Box ── */
    else if (o.type === 'box') {
        const verts = _getVerts(o);
        const spd = Math.hypot(o.vx||0, o.vy||0);
        const hot = clamp(spd/200, 0, 1);
        ctx.beginPath();
        verts.forEach(([vx,vy],i) => i===0 ? ctx.moveTo(vx,vy) : ctx.lineTo(vx,vy));
        ctx.closePath();
        ctx.fillStyle = o.fixed ? '#1a2744' : (hot>0.6 ? '#7f1d1d' : '#1e3a5f');
        ctx.fill();
        ctx.strokeStyle = sel ? '#38bdf8' : (o.fixed ? '#fbbf24' : '#60a5fa');
        ctx.lineWidth = sel ? 2.5 : 1.5;
        if (o.fixed) ctx.setLineDash([3,3]);
        ctx.stroke(); ctx.setLineDash([]);
        ctx.save(); ctx.translate(o.x,o.y); ctx.rotate(o.angle||0);
        ctx.fillStyle = '#93c5fd'; ctx.font = `bold ${Math.max(8,Math.round(Math.min(o.w||50,o.h||35)*0.3))}px sans-serif`; ctx.textAlign='center';
        ctx.fillText(o.mass+'kg', 0, 4);
        // Rotation arrow hint
        if (Math.abs(o.omega||0) > 0.05) {
            ctx.strokeStyle='rgba(74,222,128,0.4)'; ctx.lineWidth=1.5;
            ctx.beginPath(); ctx.arc(0,0,Math.min(o.w||50,o.h||35)*0.3, 0, (o.omega>0?1:-1)*1.2); ctx.stroke();
        }
        ctx.restore();
    }

    /* ── Triangle ── */
    else if (o.type === 'triangle') {
        const verts = _getVerts(o);
        const spd = Math.hypot(o.vx||0, o.vy||0);
        ctx.beginPath();
        verts.forEach(([vx,vy],i) => i===0 ? ctx.moveTo(vx,vy) : ctx.lineTo(vx,vy));
        ctx.closePath();
        ctx.fillStyle = o.fixed ? '#14302a' : '#14532d';
        ctx.fill();
        ctx.strokeStyle = sel ? '#38bdf8' : (o.fixed ? '#fbbf24' : '#4ade80');
        ctx.lineWidth = sel ? 2.5 : 1.5;
        if (o.fixed) ctx.setLineDash([3,3]);
        ctx.stroke(); ctx.setLineDash([]);
        ctx.save(); ctx.translate(o.x,o.y); ctx.rotate(o.angle||0);
        ctx.fillStyle='#86efac'; ctx.font=`bold ${Math.max(7,Math.round((o.radius||28)*0.38))}px sans-serif`; ctx.textAlign='center';
        ctx.fillText(o.mass+'kg', 0, 4);
        ctx.restore();
    }

    /* ── Ramp ── */
    else if (o.type === 'ramp') {
        const verts = _getVerts(o);
        ctx.beginPath();
        verts.forEach(([vx,vy],i) => i===0 ? ctx.moveTo(vx,vy) : ctx.lineTo(vx,vy));
        ctx.closePath();
        ctx.fillStyle = '#0f1e2e'; ctx.fill();
        ctx.strokeStyle = sel ? '#38bdf8' : '#475569'; ctx.lineWidth = sel ? 2.5 : 1.5; ctx.stroke();
        // Hatching
        ctx.save(); ctx.clip();
        ctx.strokeStyle = 'rgba(71,85,105,0.45)'; ctx.lineWidth = 1;
        const cx = verts.reduce((s,[vx])=>s+vx,0)/verts.length;
        const cy2 = verts.reduce((s,[,vy])=>s+vy,0)/verts.length;
        for (let i = -150; i < 200; i += 10) {
            ctx.beginPath(); ctx.moveTo(cx-150+i, cy2-100); ctx.lineTo(cx-150+i+100, cy2+100); ctx.stroke();
        }
        ctx.restore();
        // Label
        if (sel) {
            ctx.fillStyle='#64748b'; ctx.font='9px sans-serif'; ctx.textAlign='center';
            ctx.fillText('ramp', o.x, o.y+4); ctx.textAlign='left';
        }
    }

    /* ── Gravity well ── */
    else if (o.type === 'gravity_well') {
        const r = o.radius || 50;
        // Pulsing rings
        const pulse = (Date.now() % 2000) / 2000;
        for (let i = 3; i > 0; i--) {
            ctx.beginPath(); ctx.arc(o.x, o.y, r*i/3, 0, TWO_PI);
            ctx.strokeStyle = `rgba(168,85,247,${0.08*(4-i)})`; ctx.lineWidth=1.5; ctx.stroke();
        }
        ctx.beginPath(); ctx.arc(o.x, o.y, 10+pulse*4, 0, TWO_PI);
        ctx.fillStyle = sel ? 'rgba(56,189,248,0.9)' : 'rgba(168,85,247,0.9)'; ctx.fill();
        ctx.strokeStyle = '#0f172a'; ctx.lineWidth=2; ctx.stroke();
        ctx.fillStyle='#e9d5ff'; ctx.font='bold 8px sans-serif'; ctx.textAlign='center';
        ctx.fillText('G', o.x, o.y+3);
        ctx.font='8px sans-serif'; ctx.fillStyle='rgba(255,255,255,0.3)';
        ctx.fillText((o.strength||5000).toFixed(0), o.x, o.y+r/1.5+8);
    }

    /* ── Pin ── */
    else if (o.type === 'pin') {
        ctx.fillStyle = sel ? '#38bdf8' : '#fbbf24';
        ctx.beginPath(); ctx.arc(o.x,o.y,8,0,TWO_PI); ctx.fill();
        ctx.strokeStyle='#0f172a'; ctx.lineWidth=2; ctx.stroke();
        ctx.beginPath(); ctx.moveTo(o.x-5,o.y); ctx.lineTo(o.x+5,o.y); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(o.x,o.y-5); ctx.lineTo(o.x,o.y+5); ctx.stroke();
    }

    /* ── Charge ── */
    else if (o.type === 'charge') {
        const r=14, pos=o.charge>0;
        ctx.beginPath(); ctx.arc(o.x,o.y,r,0,TWO_PI);
        ctx.fillStyle = pos?'rgba(248,113,113,0.2)':'rgba(56,189,248,0.2)'; ctx.fill();
        ctx.strokeStyle = pos?'#f87171':'#38bdf8'; ctx.lineWidth=sel?2.5:1.5; ctx.stroke();
        ctx.fillStyle = pos?'#f87171':'#38bdf8'; ctx.font='bold 17px sans-serif'; ctx.textAlign='center';
        ctx.fillText(pos?'+':'−', o.x, o.y+6);
        ctx.font='8px sans-serif'; ctx.fillStyle='rgba(255,255,255,0.35)';
        ctx.fillText(Math.abs(o.charge).toFixed(1)+'C', o.x, o.y+r+11);
    }

    /* ── Wave source ── */
    else if (o.type === 'wave') {
        ctx.beginPath(); ctx.arc(o.x,o.y,9,0,TWO_PI);
        ctx.fillStyle='rgba(167,139,250,0.25)'; ctx.fill();
        ctx.strokeStyle=sel?'#38bdf8':'#a78bfa'; ctx.lineWidth=sel?2.5:1.5; ctx.stroke();
        ctx.fillStyle='#a78bfa'; ctx.font='bold 11px sans-serif'; ctx.textAlign='center';
        ctx.fillText('~', o.x, o.y+4);
        ctx.font='8px sans-serif'; ctx.fillStyle='rgba(255,255,255,0.3)';
        ctx.fillText((o.freq||1.5).toFixed(1)+'Hz', o.x, o.y+20);
    }

    ctx.textAlign = 'left';
}

/* ══════════════════════════════════════════════════
   CANVAS EVENT HANDLER
══════════════════════════════════════════════════ */
let _evH = null;

function _mountCanvas(canvas) {
    const pos = e => {
        const r = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
        return { x: (e.clientX-r.left)*(canvas.width/r.width/dpr), y: (e.clientY-r.top)*(canvas.height/r.height/dpr) };
    };
    const objAt = p => _sc && _sc.objects.find(o => Math.hypot(o.x-p.x, o.y-p.y) < (_brad(o)||12) + 6);
    const removeObj = id => {
        if (!_sc) return;
        _sc.links   = _sc.links.filter(lk => lk.a !== id && lk.b !== id);
        _sc.objects = _sc.objects.filter(o => o.id !== id);
        if (_sel === id)   _sel   = null;
        if (_linkA === id) _linkA = null;
        _renderControls();
    };

    _evH = {
        mousedown(e) {
            const p = pos(e);
            // Delegate to active simulation
            const sim = _getActiveSim();
            if (sim) { sim.click(p.x, p.y); return; }

            if (!_sc) return;
            if (e.button === 2) { const o = objAt(p); if (o) removeObj(o.id); return; }

            if (_tool === 'select') {
                const o = objAt(p);
                _sel = o ? o.id : null;
                if (o) { _drag = o.id; _dragOX = p.x-o.x; _dragOY = p.y-o.y; o.vx=0; o.vy=0; if(o.omega!==undefined)o.omega=0; }
                _renderControls();
            }
            else if (_tool === 'ball') {
                const mass = 1 + Math.floor(Math.random()*4);
                _sc.objects.push({ id:_nid(), type:'ball', x:p.x, y:p.y, vx:0, vy:0, ax:0, ay:0, mass, radius:10+mass*4, fixed:e.shiftKey });
            }
            else if (_tool === 'box') {
                const mass = 2 + Math.floor(Math.random()*5);
                const sz = 30 + mass*5;
                _sc.objects.push({ id:_nid(), type:'box', x:p.x, y:p.y, vx:0, vy:0, ax:0, ay:0, mass, w:sz, h:sz*0.7, angle:0, omega:0, fixed:e.shiftKey });
            }
            else if (_tool === 'triangle') {
                const mass = 1 + Math.floor(Math.random()*4);
                _sc.objects.push({ id:_nid(), type:'triangle', x:p.x, y:p.y, vx:0, vy:0, ax:0, ay:0, mass, radius:22+mass*4, angle:0, omega:0, fixed:e.shiftKey });
            }
            else if (_tool === 'ramp') {
                _sc.objects.push({ id:_nid(), type:'ramp', x:p.x, y:p.y, vx:0, vy:0, ax:0, ay:0, mass:1e9, w:120, h:15, angle: -Math.PI/6, omega:0, fixed:true });
            }
            else if (_tool === 'pin') {
                _sc.objects.push({ id:_nid(), type:'pin', x:p.x, y:p.y, vx:0, vy:0, ax:0, ay:0, mass:1e9, radius:8, fixed:true });
            }
            else if (_tool === 'charge+' || _tool === 'charge-') {
                _sc.objects.push({ id:_nid(), type:'charge', x:p.x, y:p.y, vx:0, vy:0, ax:0, ay:0, mass:0.5, radius:14, charge:_tool==='charge+'?1:-1, fixed:e.shiftKey });
            }
            else if (_tool === 'gravity_well') {
                _sc.objects.push({ id:_nid(), type:'gravity_well', x:p.x, y:p.y, vx:0, vy:0, ax:0, ay:0, mass:1e9, radius:50, strength:5000, fixed:true });
            }
            else if (_tool === 'wave') {
                _sc.objects.push({ id:_nid(), type:'wave', x:p.x, y:p.y, vx:0, vy:0, ax:0, ay:0, mass:1e9, radius:9, freq:1.5, phase:0, fixed:true });
            }
            else if (_tool === 'spring' || _tool === 'rope') {
                const o = objAt(p);
                if (!o) return;
                if (!_linkA) {
                    _linkA = o.id; _sel = o.id; _renderControls();
                } else if (_linkA !== o.id) {
                    const a = _sc.objects.find(ob => ob.id === _linkA), b = o;
                    const already = _sc.links.find(lk => (lk.a===_linkA&&lk.b===b.id)||(lk.a===b.id&&lk.b===_linkA));
                    if (!already) {
                        _sc.links.push({ id:'lk'+Date.now(), type:_tool, a:_linkA, b:b.id, L0:Math.hypot(a.x-b.x,a.y-b.y), k:_sc.settings.springK });
                    }
                    _linkA = null; _sel = null; _renderControls();
                }
            }
            else if (_tool === 'erase') {
                const o = objAt(p); if (o) removeObj(o.id);
            }
        },
        mousemove(e) {
            const p = pos(e); _mx = p.x; _my = p.y;
            const sim = _getActiveSim();
            if (sim) { if (sim.move) sim.move(p.x, p.y); return; }
            if (_drag) {
                const o = _sc && _sc.objects.find(ob => ob.id === _drag);
                if (o) { o.x = p.x-_dragOX; o.y = p.y-_dragOY; o.vx=0; o.vy=0; }
            }
        },
        mouseup(e) {
            const p = pos(e);
            const sim = _getActiveSim();
            if (sim) { if (sim.release) sim.release(p.x, p.y); _drag = null; return; }
            _drag = null;
        },
        contextmenu(e) { e.preventDefault(); },
        keydown(e) {
            if ((e.key==='Delete'||e.key==='Backspace') && _sel) removeObj(_sel);
            if (e.key==='f' && _sel) {
                const o = _sc && _sc.objects.find(ob => ob.id === _sel);
                if (o && ['ball','box','triangle','charge'].includes(o.type)) { o.fixed=!o.fixed; o.vx=0; o.vy=0; _renderControls(); }
            }
            if (e.key==='Escape') { _sel=null; _linkA=null; _renderControls(); }
        },
    };
    canvas.addEventListener('mousedown',   _evH.mousedown);
    canvas.addEventListener('mousemove',   _evH.mousemove);
    canvas.addEventListener('mouseup',     _evH.mouseup);
    canvas.addEventListener('contextmenu', _evH.contextmenu);
    window.addEventListener('keydown',     _evH.keydown);
    canvas.style.cursor = 'crosshair';
}

function _unmountCanvas(canvas) {
    if (!_evH) return;
    canvas.removeEventListener('mousedown',   _evH.mousedown);
    canvas.removeEventListener('mousemove',   _evH.mousemove);
    canvas.removeEventListener('mouseup',     _evH.mouseup);
    canvas.removeEventListener('contextmenu', _evH.contextmenu);
    window.removeEventListener('keydown',     _evH.keydown);
    canvas.style.cursor = ''; _evH = null;
}

/* ══════════════════════════════════════════════════
   CONTROLS PANEL
══════════════════════════════════════════════════ */
const TOOLS = [
    { id:'select',       icon:'fa-mouse-pointer',  label:'Select',     color:'#64748b', tip:'Click to select & drag  ·  Del=remove  ·  F=fix/unfix' },
    { id:'ball',         icon:'fa-circle',          label:'Ball',       color:'#3b82f6', tip:'Round mass  ·  Shift=fixed' },
    { id:'box',          icon:'fa-square',          label:'Box',        color:'#60a5fa', tip:'Rectangular mass with rotation  ·  Shift=fixed' },
    { id:'triangle',     icon:'fa-play',            label:'Triangle',   color:'#4ade80', tip:'Triangle mass with rotation  ·  Shift=fixed' },
    { id:'ramp',         icon:'fa-angle-double-right', label:'Ramp',    color:'#475569', tip:'Static angled surface  ·  adjust angle in panel' },
    { id:'pin',          icon:'fa-thumbtack',       label:'Pin',        color:'#fbbf24', tip:'Fixed anchor point' },
    { id:'spring',       icon:'fa-minus',           label:'Spring',     color:'#f59e0b', tip:'Click obj A → click obj B' },
    { id:'rope',         icon:'fa-link',            label:'Rope',       color:'#94a3b8', tip:'Inextensible rope  ·  click A → click B' },
    { id:'charge+',      icon:'fa-plus-circle',     label:'+ Charge',   color:'#f87171', tip:'Positive charge  ·  Shift=fixed' },
    { id:'charge-',      icon:'fa-minus-circle',    label:'− Charge',   color:'#38bdf8', tip:'Negative charge  ·  Shift=fixed' },
    { id:'gravity_well', icon:'fa-dot-circle',      label:'Gravity',    color:'#a855f7', tip:'Gravity well  ·  pulls nearby objects' },
    { id:'wave',         icon:'fa-broadcast-tower', label:'Wave',       color:'#a78bfa', tip:'Ripple wave source' },
    { id:'erase',        icon:'fa-eraser',          label:'Erase',      color:'#ef4444', tip:'Click to remove' },
];

function _renderControls() {
    const el = document.getElementById('phys-controls');
    if (!el) return;
    el.innerHTML = '';

    /* ── Simulation mode selector ── */
    const modeRow = document.createElement('div');
    modeRow.className = 'flex items-center gap-1 flex-wrap pb-1.5';
    modeRow.style.cssText = 'border-bottom:1px solid rgba(255,255,255,0.07);margin-bottom:6px';

    const modeLabel = document.createElement('span');
    modeLabel.className = 'text-[9px] text-slate-500 uppercase tracking-wider shrink-0 mr-1';
    modeLabel.textContent = 'Mode:';
    modeRow.appendChild(modeLabel);

    const addModeBtn = (id, label, icon, color) => {
        const active = _physSimMode === id;
        const btn = document.createElement('button');
        btn.className = 'flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold transition-all whitespace-nowrap';
        btn.style.cssText = active
            ? `background:${color}33;color:${color};border:1px solid ${color}66`
            : 'background:transparent;color:rgb(var(--slate-600));border:1px solid rgb(var(--slate-800))';
        btn.innerHTML = `<i class="fas ${icon}" style="font-size:8px"></i>${label}`;
        btn.onclick = () => {
            const canvas = document.getElementById('phys-canvas');
            const W = canvas ? canvas.width/DPR : 800;
            const H = canvas ? canvas.height/DPR : 600;
            _physSimMode = id;
            const sim = _getActiveSim();
            if (sim) sim.init(W, H);
            _renderControls();
        };
        modeRow.appendChild(btn);
    };

    addModeBtn('sandbox', 'Sandbox', 'fa-cubes', '#3b82f6');
    const sims = window._physSimModes || {};
    Object.entries(sims).forEach(([id, s]) => addModeBtn(id, s.label, s.icon, s.color));
    el.appendChild(modeRow);

    /* ── Active sim controls (or sandbox tools) ── */
    const sim = _getActiveSim();
    if (sim) {
        const simRow = document.createElement('div');
        simRow.className = 'flex items-center gap-2 flex-wrap';
        const tip = document.createElement('span');
        tip.className = 'text-[10px] text-slate-500 italic shrink-0';
        tip.textContent = sim.tip;
        simRow.appendChild(tip);
        sim.controls(simRow);
        el.appendChild(simRow);
        return; // skip sandbox tools
    }

    /* ── Tool palette ── */
    const toolRow = document.createElement('div');
    toolRow.className = 'flex items-center gap-1 flex-wrap';
    TOOLS.forEach(t => {
        const active = _tool === t.id;
        const btn = document.createElement('button');
        btn.className = 'flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] font-semibold transition-all whitespace-nowrap';
        btn.style.cssText = active
            ? `background:${t.color}33;color:${t.color};border:1px solid ${t.color}66`
            : `background:transparent;color:rgb(var(--slate-600));border:1px solid rgb(var(--slate-800))`;
        btn.innerHTML = `<i class="fas ${t.icon}" style="font-size:9px"></i>${t.label}`;
        btn.title = t.tip;
        btn.addEventListener('click', () => { _tool = t.id; _linkA = null; _sel = null; _renderControls(); });
        toolRow.appendChild(btn);
    });
    if (_linkA) {
        const hint = document.createElement('span');
        hint.className = 'text-[10px] text-cyan-400 ml-1 animate-pulse shrink-0';
        hint.textContent = '→ click second object';
        toolRow.appendChild(hint);
    }
    /* Clear all */
    const cb = document.createElement('button');
    cb.className = 'flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-semibold ml-auto whitespace-nowrap';
    cb.style.cssText = 'background:#ef444422;color:rgb(var(--tw-red-400));border:1px solid #ef444444';
    cb.innerHTML = '<i class="fas fa-trash-alt" style="font-size:9px"></i> Clear';
    cb.title = 'Remove all objects';
    cb.addEventListener('click', () => {
        const canvas = document.getElementById('phys-canvas');
        const DPR2 = window.devicePixelRatio||1;
        const W = canvas?canvas.width/DPR2:800, H = canvas?canvas.height/DPR2:600;
        const cfg = _sc ? {..._sc.settings} : {};
        _sc = _newScene(W,H); Object.assign(_sc.settings,cfg);
        _sel=null; _linkA=null; _drag=null; _renderControls();
    });
    toolRow.appendChild(cb);
    el.appendChild(toolRow);

    /* ── Global settings ── */
    if (_sc) {
        const sRow = document.createElement('div');
        sRow.className = 'flex items-center gap-4 flex-wrap';
        sRow.style.cssText = 'border-top:1px solid rgba(255,255,255,0.07);margin-top:6px;padding-top:5px;width:100%';

        const addSl = (label, key, min, max, step, unit, color) => {
            const w = document.createElement('div'); w.className = 'flex items-center gap-2';
            const vid = 'phys-cfg-'+key, cur = _sc.settings[key]??0;
            w.innerHTML = `<label class="text-[10px] text-slate-400 w-16 shrink-0">${label}</label>
              <input type="range" min="${min}" max="${max}" step="${step}" value="${cur}"
                     class="w-20 h-1 rounded appearance-none cursor-pointer" style="accent-color:${color}">
              <span id="${vid}" class="text-[10px] font-mono w-14 text-right shrink-0" style="color:${color}">${cur.toFixed(1)} ${unit}</span>`;
            const sl = w.querySelector('input');
            sl.addEventListener('input', () => {
                _sc.settings[key]=parseFloat(sl.value);
                const sp=document.getElementById(vid); if(sp) sp.textContent=parseFloat(sl.value).toFixed(1)+' '+unit;
            });
            sRow.appendChild(w);
        };
        addSl('Gravity',  'gravity',     0, 25,  0.5,  'm/s²', '#f59e0b');
        addSl('Bounce',   'restitution', 0, 1,   0.05, '',     '#38bdf8');
        addSl('Spring k', 'springK',     1, 200, 1,    'N/m',  '#f59e0b');
        el.appendChild(sRow);
    }

    /* ── Selected object properties ── */
    if (_sel && _sc) {
        const o = _sc.objects.find(ob => ob.id === _sel);
        if (o) {
            const pRow = document.createElement('div');
            pRow.className = 'flex items-center gap-3 flex-wrap';
            pRow.style.cssText = 'border-top:1px solid rgba(255,255,255,0.07);margin-top:5px;padding-top:5px;width:100%';
            const tag = document.createElement('span');
            tag.className = 'text-[10px] text-slate-500 font-semibold uppercase tracking-wider shrink-0';
            tag.textContent = '▸ ' + o.type;
            pRow.appendChild(tag);

            const addProp = (label, key, min, max, step, unit, color, cb2) => {
                const w = document.createElement('div'); w.className = 'flex items-center gap-1.5';
                const cur = o[key]??0;
                w.innerHTML = `<label class="text-[10px] text-slate-400 w-12 shrink-0">${label}</label>
                  <input type="range" min="${min}" max="${max}" step="${step}" value="${cur}"
                         class="w-20 h-1 rounded appearance-none cursor-pointer" style="accent-color:${color}">
                  <span class="text-[10px] font-mono w-12 text-right shrink-0" style="color:${color}">${Number(cur).toFixed(typeof step==='number'&&step<1?1:0)} ${unit}</span>`;
                const sl = w.querySelector('input'), sp = w.querySelector('span:last-child');
                sl.addEventListener('input', () => {
                    const v=parseFloat(sl.value); o[key]=v;
                    sp.textContent=v.toFixed(typeof step==='number'&&step<1?1:0)+' '+unit;
                    if (cb2) cb2(v);
                });
                pRow.appendChild(w);
            };

            const fixBtn = (cond) => {
                const fb = document.createElement('button');
                fb.className = 'px-2 py-1.5 rounded-lg text-[11px] font-semibold shrink-0';
                fb.style.cssText = cond
                    ? 'background:#fbbf2433;color:rgb(var(--tw-amber-400));border:1px solid #fbbf2455'
                    : 'background:transparent;color:rgb(var(--slate-600));border:1px solid rgb(var(--slate-800))';
                fb.innerHTML = `<i class="fas fa-thumbtack" style="font-size:9px"></i> ${cond?'Unfix':'Fix'}`;
                fb.addEventListener('click', () => { o.fixed=!o.fixed; o.vx=0; o.vy=0; if(o.omega!==undefined)o.omega=0; _renderControls(); });
                pRow.appendChild(fb);
            };

            if (o.type === 'ball') {
                addProp('Mass',   'mass',   0.5, 20,  0.5, 'kg', '#3b82f6', v=>{o.radius=10+v*4;});
                fixBtn(o.fixed);
            }
            if (o.type === 'box') {
                addProp('Mass',   'mass',   0.5, 30,  0.5, 'kg', '#60a5fa');
                addProp('Width',  'w',      20,  200, 5,   'px', '#60a5fa');
                addProp('Height', 'h',      10,  150, 5,   'px', '#93c5fd');
                addProp('Angle',  'angle', -Math.PI, Math.PI, 0.05, 'rad', '#a78bfa');
                fixBtn(o.fixed);
            }
            if (o.type === 'triangle') {
                addProp('Mass',  'mass',   0.5, 20,  0.5, 'kg',  '#4ade80');
                addProp('Size',  'radius', 12,  80,  2,   'px',  '#4ade80');
                addProp('Angle', 'angle', -Math.PI, Math.PI, 0.05, 'rad', '#a78bfa');
                fixBtn(o.fixed);
            }
            if (o.type === 'ramp') {
                addProp('Width', 'w',     40,  300, 5,   'px',  '#475569');
                addProp('Height','h',     5,   60,  2,   'px',  '#475569');
                addProp('Angle', 'angle', -Math.PI/2, Math.PI/2, 0.02, 'rad', '#a78bfa');
            }
            if (o.type === 'charge') {
                addProp('Charge', 'charge', -5, 5, 0.5, 'C', '#f87171');
                fixBtn(o.fixed);
            }
            if (o.type === 'wave') {
                addProp('Freq', 'freq', 0.2, 5, 0.1, 'Hz', '#a78bfa');
            }
            if (o.type === 'gravity_well') {
                addProp('Strength', 'strength', 500, 20000, 100, '', '#a855f7');
                addProp('Radius',   'radius',   20,  200,   5,   'px','#a855f7');
            }

            el.appendChild(pRow);
        }
    }
}

/* ══════════════════════════════════════════════════
   RAF LOOP
══════════════════════════════════════════════════ */
let _physPaused  = false;
let _physRaf     = null;
let _physLastTs  = 0;
let _physSpeed   = 1.0;
let _physSimMode = 'sandbox'; // 'sandbox' | key in window._physSimModes
const DPR = window.devicePixelRatio || 1;

function _getActiveSim() {
    return (window._physSimModes || {})[_physSimMode] || null;
}

function _physLoop(ts) {
    if (_physPaused) return;
    _physRaf = requestAnimationFrame(_physLoop);
    const canvas = document.getElementById('phys-canvas');
    if (!canvas) return;
    const wrap = document.getElementById('phys-canvas-wrap');
    if (wrap && wrap.offsetParent === null) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width/DPR, H = canvas.height/DPR;
    const dt = Math.min((ts - _physLastTs)/1000, 0.05);
    _physLastTs = ts;
    if (dt <= 0) return;
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.save(); ctx.scale(DPR,DPR);

    const sim = _getActiveSim();
    if (sim) {
        sim.step(dt * _physSpeed);
        sim.draw(ctx, W, H);
    } else {
        ctx.fillStyle=_physBgBase(); ctx.fillRect(0,0,W,H);
        _step(dt * _physSpeed);
        _draw(ctx,W,H);
    }
    ctx.restore();
}

function _physResizeCanvas() {
    const canvas = document.getElementById('phys-canvas');
    const wrap   = document.getElementById('phys-canvas-wrap');
    if (!canvas||!wrap) return;
    const r = wrap.getBoundingClientRect();
    canvas.width  = Math.round(r.width  * DPR);
    canvas.height = Math.round(r.height * DPR);
    canvas.style.width  = r.width  + 'px';
    canvas.style.height = r.height + 'px';
    if (_sc) { _sc.W=r.width; _sc.H=r.height; }
    else _sc = _newScene(r.width, r.height);
}

function _updatePlayBtn() {
    const btn = document.getElementById('phys-play-btn');
    if (!btn) return;
    btn.innerHTML = _physPaused ? '<i class="fas fa-play text-xs"></i>' : '<i class="fas fa-pause text-xs"></i>';
    btn.title = _physPaused ? 'Resume' : 'Pause';
}

/* ══════════════════════════════════════════════════
   PUBLIC API
══════════════════════════════════════════════════ */
window.initPhysics = function () {
    _physResizeCanvas();
    const canvas = document.getElementById('phys-canvas');
    if (!_sc && canvas) _sc = _newScene(canvas.width/DPR, canvas.height/DPR);

    if (canvas) { _unmountCanvas(canvas); _mountCanvas(canvas); }

    const wrap = document.getElementById('phys-canvas-wrap');
    if (wrap && !wrap._physObs) {
        wrap._physObs = new ResizeObserver(() => _physResizeCanvas());
        wrap._physObs.observe(wrap);
    }

    const playBtn = document.getElementById('phys-play-btn');
    if (playBtn && !playBtn._bound) {
        playBtn._bound = true;
        playBtn.addEventListener('click', () => {
            _physPaused = !_physPaused; _updatePlayBtn();
            if (!_physPaused) _physRaf = requestAnimationFrame(ts => { _physLastTs=ts; _physLoop(ts); });
        });
    }
    _updatePlayBtn();

    const resetBtn = document.getElementById('phys-reset-btn');
    if (resetBtn && !resetBtn._bound) {
        resetBtn._bound = true;
        resetBtn.addEventListener('click', () => {
            if (!canvas) return;
            const cfg = _sc ? {..._sc.settings} : {};
            _sc = _newScene(canvas.width/DPR, canvas.height/DPR);
            Object.assign(_sc.settings,cfg);
            _sel=null; _linkA=null; _drag=null; _renderControls();
        });
    }

    const speedSlider = document.getElementById('phys-speed-slider');
    const speedLabel  = document.getElementById('phys-speed-label');
    if (speedSlider && !speedSlider._bound) {
        speedSlider._bound = true;
        speedSlider.value = _physSpeed;
        speedSlider.addEventListener('input', () => {
            _physSpeed = parseFloat(speedSlider.value);
            if (speedLabel) speedLabel.textContent = _physSpeed.toFixed(1) + '×';
        });
    }
    if (speedLabel) speedLabel.textContent = _physSpeed.toFixed(1) + '×';

    _renderControls();
    _physPaused = false;
    if (_physRaf) cancelAnimationFrame(_physRaf);
    _physRaf = requestAnimationFrame(ts => { _physLastTs=ts; _physLoop(ts); });
};

window.stopPhysics = function () {
    if (_physRaf) { cancelAnimationFrame(_physRaf); _physRaf=null; }
    const canvas = document.getElementById('phys-canvas');
    if (canvas) _unmountCanvas(canvas);
};

})();
