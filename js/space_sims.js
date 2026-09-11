// ── Space Simulations ─────────────────────────────────────────────────────────
// A "Space" category for the 2-D physics canvas: the Solar System, a warp
// starfield, a spiral galaxy and a black-hole accretion disk.
// Each mode exposes the same interface physics.js expects:
//   { label, icon, color, tip, init(W,H), step(dt), draw(ctx,W,H), click(x,y),
//     controls(el), [move(x,y)], [release(x,y)] }
// Loaded AFTER physics_sims.js — merges into window._physSimModes.
'use strict';
(function () {

const TWO_PI = Math.PI * 2;
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

/* ══════════════════════════════════════════════════
   Shared star-field backdrop (seeded so it doesn't flicker)
══════════════════════════════════════════════════ */
function _drawStars(ctx, w, h, count, seed) {
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    for (let i = 0; i < count; i++) {
        const sx = ((i * 137 + seed * 31) % w);
        const sy = ((i * 191 + seed * 17) % h);
        const tw = 0.4 + ((i * 53) % 100) / 160;     // pseudo-random size
        ctx.globalAlpha = 0.25 + ((i * 29) % 100) / 200;
        ctx.fillRect(sx, sy, tw, tw);
    }
    ctx.globalAlpha = 1;
}

/* ══════════════════════════════════════════════════
   1. SOLAR SYSTEM
══════════════════════════════════════════════════ */
const SOLAR = (() => {
    // a = orbit radius as fraction of view, r = body px radius,
    // period = orbital period in Earth years, color, name
    const PLANETS = [
        { name:'Mercury', a:0.085, r:2.6, period:0.24,  color:'#b8b3a8' },
        { name:'Venus',   a:0.135, r:4.2, period:0.62,  color:'#e8c27a' },
        { name:'Earth',   a:0.195, r:4.4, period:1.00,  color:'#5aa9e6', moon:true },
        { name:'Mars',    a:0.255, r:3.4, period:1.88,  color:'#e2673a' },
        { name:'Jupiter', a:0.42,  r:9.5, period:11.86, color:'#d9a066' },
        { name:'Saturn',  a:0.57,  r:8.2, period:29.46, color:'#e3d9a0', ring:true },
        { name:'Uranus',  a:0.74,  r:6.2, period:84.0,  color:'#9fe3e0' },
        { name:'Neptune', a:0.92,  r:6.0, period:164.8, color:'#4f73d6' },
    ];
    // Earth completes one orbit in EARTH_SECONDS sim-seconds at speed 1.
    const EARTH_SECONDS = 8;

    let W, H, maxR, t = 0, showRings = true, showLabels = true, moonA = 0;
    const ang = [];

    function _init(w, h) {
        W = w; H = h; t = 0; moonA = 0;
        maxR = Math.min(w, h) * 0.46;
        ang.length = 0;
        PLANETS.forEach((p, i) => ang.push((i * 0.7) % TWO_PI));
    }

    function _step(dt) {
        t += dt;
        PLANETS.forEach((p, i) => {
            ang[i] += dt * (TWO_PI / (EARTH_SECONDS * p.period));
        });
        moonA += dt * (TWO_PI / (EARTH_SECONDS * 0.075));   // ~27-day moon
    }

    function _drawPlanet(ctx, x, y, p) {
        // soft shading
        const grd = ctx.createRadialGradient(x - p.r*0.4, y - p.r*0.4, p.r*0.1, x, y, p.r);
        grd.addColorStop(0, p.color);
        grd.addColorStop(1, _shade(p.color, -0.45));
        ctx.beginPath(); ctx.arc(x, y, p.r, 0, TWO_PI);
        ctx.fillStyle = grd; ctx.fill();

        if (p.ring) {
            ctx.save();
            ctx.translate(x, y); ctx.rotate(-0.5); ctx.scale(1, 0.38);
            ctx.beginPath(); ctx.arc(0, 0, p.r * 2.0, 0, TWO_PI);
            ctx.lineWidth = p.r * 0.7;
            ctx.strokeStyle = 'rgba(220,200,150,0.55)'; ctx.stroke();
            ctx.restore();
        }
    }

    function _draw(ctx, w, h) {
        ctx.fillStyle = '#03040a'; ctx.fillRect(0, 0, w, h);
        _drawStars(ctx, w, h, 110, 7);

        const cx = w / 2, cy = h / 2;

        // Orbit rings
        if (showRings) {
            ctx.lineWidth = 1;
            PLANETS.forEach(p => {
                ctx.beginPath();
                ctx.arc(cx, cy, p.a * maxR, 0, TWO_PI);
                ctx.strokeStyle = 'rgba(120,150,200,0.12)';
                ctx.stroke();
            });
        }

        // Sun with glow
        const sunR = 15;
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, sunR * 4.2);
        g.addColorStop(0, 'rgba(255,236,150,1)');
        g.addColorStop(0.25, 'rgba(255,180,60,0.8)');
        g.addColorStop(1, 'rgba(255,140,0,0)');
        ctx.beginPath(); ctx.arc(cx, cy, sunR * 4.2, 0, TWO_PI);
        ctx.fillStyle = g; ctx.fill();
        ctx.beginPath(); ctx.arc(cx, cy, sunR, 0, TWO_PI);
        ctx.fillStyle = '#fff3b0'; ctx.fill();

        // Planets
        PLANETS.forEach((p, i) => {
            const x = cx + Math.cos(ang[i]) * p.a * maxR;
            const y = cy + Math.sin(ang[i]) * p.a * maxR;
            _drawPlanet(ctx, x, y, p);

            if (p.moon) {
                const mx = x + Math.cos(moonA) * (p.r + 7);
                const my = y + Math.sin(moonA) * (p.r + 7);
                ctx.beginPath(); ctx.arc(mx, my, 1.6, 0, TWO_PI);
                ctx.fillStyle = '#cbd5e1'; ctx.fill();
            }

            if (showLabels) {
                ctx.fillStyle = 'rgba(203,213,225,0.65)';
                ctx.font = '9px sans-serif'; ctx.textAlign = 'center';
                ctx.fillText(p.name, x, y - p.r - 5);
            }
        });

        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.font = '11px sans-serif'; ctx.textAlign = 'left';
        ctx.fillText('Solar System — relative orbital periods (not to scale in distance)', 12, h - 14);
    }

    function _controls(el) {
        _slider(el, 'Speed', 0.1, 10, 0.1, _spd(), '×', '#fbbf24', v => window._physSpeed = v);

        _toggle(el, () => showRings, () => showRings = !showRings,
            '◯ Orbits ON', '◯ Orbits OFF', '#60a5fa');
        _toggle(el, () => showLabels, () => showLabels = !showLabels,
            '🏷 Labels ON', '🏷 Labels OFF', '#a78bfa');

        const rb = _btn('↺ Reset', 'transparent', '#475569', '#1e293b');
        rb.onclick = () => _init(W, H);
        el.appendChild(rb);
    }

    return { label:'Solar System', icon:'fa-sun', color:'#fbbf24',
        tip:'The Sun and eight planets orbiting with realistic relative speeds',
        init:_init, step:_step, draw:_draw, click:()=>{}, controls:_controls };
})();

/* ══════════════════════════════════════════════════
   2. STARFIELD WARP
══════════════════════════════════════════════════ */
const WARP = (() => {
    let W, H, stars = [], speed = 6, N = 600, cx, cy;

    function _spawn(s) {
        s.x = (Math.random() - 0.5) * W;
        s.y = (Math.random() - 0.5) * H;
        s.z = Math.random() * W;
        s.pz = s.z;
    }
    function _init(w, h) {
        W = w; H = h; cx = w / 2; cy = h / 2;
        stars = [];
        for (let i = 0; i < N; i++) { const s = {}; _spawn(s); stars.push(s); }
    }
    function _step(dt) {
        const v = speed * dt * 60;
        stars.forEach(s => {
            s.pz = s.z;
            s.z -= v;
            if (s.z < 1) { _spawn(s); s.z = W; s.pz = W; }
        });
    }
    function _draw(ctx, w, h) {
        ctx.fillStyle = '#01010a'; ctx.fillRect(0, 0, w, h);
        ctx.lineCap = 'round';
        stars.forEach(s => {
            const sx = (s.x / s.z) * W + cx;
            const sy = (s.y / s.z) * W + cy;
            const px = (s.x / s.pz) * W + cx;
            const py = (s.y / s.pz) * W + cy;
            const k = clamp((1 - s.z / W), 0, 1);
            const r = k * 2.4;
            ctx.strokeStyle = `rgba(255,255,255,${0.25 + k * 0.75})`;
            ctx.lineWidth = Math.max(0.5, r);
            ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(sx, sy); ctx.stroke();
        });
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.font = '11px sans-serif'; ctx.textAlign = 'left';
        ctx.fillText('Starfield — flying through space at warp speed', 12, h - 14);
    }
    function _click() { speed = Math.min(speed + 6, 40); }

    function _controls(el) {
        _slider(el, 'Warp', 1, 40, 1, speed, '', '#38bdf8', v => speed = v);
        _slider(el, 'Stars', 100, 1400, 50, N, '', '#a78bfa', v => { N = v|0; _init(W, H); });
        const hint = document.createElement('span');
        hint.className = 'text-[10px] text-slate-500 italic shrink-0';
        hint.textContent = 'click canvas for a speed boost';
        el.appendChild(hint);
    }

    return { label:'Starfield', icon:'fa-star', color:'#38bdf8',
        tip:'Warp through a field of stars — adjust speed and density',
        init:_init, step:_step, draw:_draw, click:_click, controls:_controls };
})();

/* ══════════════════════════════════════════════════
   3. SPIRAL GALAXY
══════════════════════════════════════════════════ */
const GALAXY = (() => {
    let W, H, stars = [], N = 1400, spin = 0.5, arms = 2, core = true;

    function _make() {
        stars = [];
        const maxR = Math.min(W, H) * 0.46;
        for (let i = 0; i < N; i++) {
            const arm = i % arms;
            const t = Math.pow(Math.random(), 0.6);       // bias toward centre
            const rad = t * maxR;
            const armOff = (arm / arms) * TWO_PI;
            const swirl = rad / maxR * 4.5;               // arm winding
            const scatter = (Math.random() - 0.5) * (0.5 - 0.35 * t);
            const a = armOff + swirl + scatter;
            // colour: blue/white at the edge, gold/orange in the core
            const edge = rad / maxR;
            const hue = 210 - edge * 170;                 // 210(blue) → 40(gold) inwards
            stars.push({ r: rad, a, baseA: a,
                size: 0.5 + Math.random() * (edge < 0.2 ? 1.6 : 1.0),
                hue: clamp(hue, 30, 210),
                alpha: 0.35 + Math.random() * 0.5 });
        }
    }
    function _init(w, h) { W = w; H = h; _make(); }
    function _step(dt) {
        const maxR = Math.min(W, H) * 0.46;
        stars.forEach(s => {
            // differential rotation: inner stars rotate faster
            const omega = spin * (0.4 + 1.6 * (1 - s.r / maxR));
            s.a += omega * dt;
        });
    }
    function _draw(ctx, w, h) {
        ctx.fillStyle = '#020108'; ctx.fillRect(0, 0, w, h);
        const cx = w / 2, cy = h / 2;

        if (core) {
            const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.min(w, h) * 0.22);
            g.addColorStop(0, 'rgba(255,228,170,0.55)');
            g.addColorStop(0.5, 'rgba(255,180,120,0.18)');
            g.addColorStop(1, 'rgba(255,150,90,0)');
            ctx.fillStyle = g;
            ctx.beginPath(); ctx.arc(cx, cy, Math.min(w, h) * 0.22, 0, TWO_PI); ctx.fill();
        }

        stars.forEach(s => {
            const x = cx + Math.cos(s.a) * s.r;
            const y = cy + Math.sin(s.a) * s.r * 0.55;   // tilt the disc
            ctx.fillStyle = `hsla(${s.hue},85%,72%,${s.alpha})`;
            ctx.fillRect(x, y, s.size, s.size);
        });

        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.font = '11px sans-serif'; ctx.textAlign = 'left';
        ctx.fillText('Spiral Galaxy — differential rotation winds the arms', 12, h - 14);
    }

    function _controls(el) {
        _slider(el, 'Spin', 0, 2, 0.05, spin, '', '#c084fc', v => spin = v);
        _slider(el, 'Stars', 300, 3000, 100, N, '', '#38bdf8', v => { N = v|0; _make(); });
        _slider(el, 'Arms', 2, 6, 1, arms, '', '#f472b6', v => { arms = v|0; _make(); });
        _toggle(el, () => core, () => core = !core, '✦ Core ON', '✦ Core OFF', '#fbbf24');
    }

    return { label:'Galaxy', icon:'fa-hurricane', color:'#c084fc',
        tip:'A rotating spiral galaxy — tune arms, spin and star count',
        init:_init, step:_step, draw:_draw, click:()=>{}, controls:_controls };
})();

/* ══════════════════════════════════════════════════
   4. BLACK HOLE — accretion disk
══════════════════════════════════════════════════ */
const BLACKHOLE = (() => {
    let W, H, cx, cy, parts = [], N = 800, G = 1, eventR = 22;

    function _spawn(p, fresh) {
        const maxR = Math.min(W, H) * 0.48;
        const r = fresh ? eventR + 20 + Math.random() * (maxR - eventR - 20) : maxR;
        const a = Math.random() * TWO_PI;
        p.x = cx + Math.cos(a) * r;
        p.y = cy + Math.sin(a) * r * 0.5;     // disc tilt
        // tangential velocity ~ keplerian
        const v = Math.sqrt(2400 * G / r) * (0.9 + Math.random() * 0.2);
        p.vx = -Math.sin(a) * v;
        p.vy = Math.cos(a) * v * 0.5;
        p.hue = 20 + Math.random() * 35;       // orange/yellow disc
        p.life = 1;
    }
    function _init(w, h) {
        W = w; H = h; cx = w / 2; cy = h / 2;
        parts = [];
        for (let i = 0; i < N; i++) { const p = {}; _spawn(p, true); parts.push(p); }
    }
    function _step(dt) {
        dt = Math.min(dt, 0.03);
        parts.forEach(p => {
            const dx = cx - p.x, dy = (cy - p.y) * 2;     // un-tilt for force
            const d2 = dx*dx + dy*dy;
            const d = Math.sqrt(d2) + 1;
            const F = 2400 * G / d2;
            p.vx += (dx / d) * F * dt;
            p.vy += (dy / d) * F * dt * 0.5;
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            // hotter / bluer as it spirals in
            const rr = Math.hypot(p.x - cx, (p.y - cy) * 2);
            p.hue = clamp(15 + rr / 6, 15, 55);
            if (rr < eventR) _spawn(p, false);            // consumed → respawn at edge
        });
    }
    function _draw(ctx, w, h) {
        ctx.fillStyle = '#000005'; ctx.fillRect(0, 0, w, h);
        _drawStars(ctx, w, h, 90, 3);

        // accretion particles (additive glow)
        ctx.globalCompositeOperation = 'lighter';
        parts.forEach(p => {
            const rr = Math.hypot(p.x - cx, (p.y - cy) * 2);
            const heat = clamp(1 - rr / (Math.min(W, H) * 0.48), 0, 1);
            ctx.fillStyle = `hsla(${p.hue},100%,${55 + heat*25}%,${0.5 + heat*0.5})`;
            const s = 1 + heat * 1.6;
            ctx.fillRect(p.x, p.y, s, s);
        });
        ctx.globalCompositeOperation = 'source-over';

        // photon ring glow
        const pr = ctx.createRadialGradient(cx, cy, eventR, cx, cy, eventR * 1.7);
        pr.addColorStop(0, 'rgba(255,180,80,0.8)');
        pr.addColorStop(1, 'rgba(255,140,40,0)');
        ctx.beginPath(); ctx.arc(cx, cy, eventR * 1.7, 0, TWO_PI);
        ctx.fillStyle = pr; ctx.fill();

        // event horizon (pure black)
        ctx.beginPath(); ctx.arc(cx, cy, eventR, 0, TWO_PI);
        ctx.fillStyle = '#000'; ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = 'rgba(255,210,140,0.9)';
        ctx.stroke();

        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.font = '11px sans-serif'; ctx.textAlign = 'left';
        ctx.fillText('Black Hole — matter spirals into the event horizon', 12, h - 14);
    }

    function _controls(el) {
        _slider(el, 'Gravity', 0.3, 3, 0.1, G, '×', '#f59e0b', v => G = v);
        _slider(el, 'Matter', 200, 2000, 100, N, '', '#fb923c', v => { N = v|0; _init(W, H); });
        const rb = _btn('↺ Reset', 'transparent', '#475569', '#1e293b');
        rb.onclick = () => _init(W, H);
        el.appendChild(rb);
    }

    return { label:'Black Hole', icon:'fa-circle-notch', color:'#fb923c',
        tip:'An accretion disk of matter spiraling into a black hole',
        init:_init, step:_step, draw:_draw, click:()=>{}, controls:_controls };
})();

/* ══════════════════════════════════════════════════
   Small shared UI / colour helpers
══════════════════════════════════════════════════ */
function _spd() { return window._physSpeed || 1; }

function _btn(text, bg, fg, border) {
    const b = document.createElement('button');
    b.className = 'px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all';
    b.style.cssText = `background:${bg};color:${fg};border:1px solid ${border}`;
    b.textContent = text;
    return b;
}

function _toggle(el, get, set, onText, offText, color) {
    const b = document.createElement('button');
    b.className = 'px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all';
    const sync = () => {
        b.style.cssText = get()
            ? `background:${color}22;color:${color};border:1px solid ${color}44`
            : 'background:transparent;color:rgb(var(--slate-600));border:1px solid rgb(var(--slate-800))';
        b.textContent = get() ? onText : offText;
    };
    sync();
    b.onclick = () => { set(); sync(); };
    el.appendChild(b);
}

function _slider(el, label, min, max, step, val, unit, color, onInput) {
    const w = document.createElement('div'); w.className = 'flex items-center gap-2';
    const dec = step < 1 ? (step < 0.1 ? 2 : 1) : 0;
    w.innerHTML = `<label class="text-[10px] text-slate-400 w-14 shrink-0">${label}</label>
      <input type="range" min="${min}" max="${max}" step="${step}" value="${val}"
             class="w-24 h-1 rounded appearance-none cursor-pointer" style="accent-color:${color}">
      <span class="text-[10px] font-mono w-12 text-right shrink-0" style="color:${color}">${Number(val).toFixed(dec)}${unit?' '+unit:''}</span>`;
    const sl = w.querySelector('input'), sp = w.querySelector('span:last-child');
    sl.oninput = () => {
        const v = parseFloat(sl.value);
        sp.textContent = v.toFixed(dec) + (unit ? ' ' + unit : '');
        onInput(v);
    };
    el.appendChild(w);
}

// Lighten (+) / darken (−) a #rrggbb hex by amt in [-1,1]
function _shade(hex, amt) {
    if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return hex;
    let r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
    const f = amt < 0 ? 0 : 255, t = Math.abs(amt);
    r = Math.round((f - r) * t + r); g = Math.round((f - g) * t + g); b = Math.round((f - b) * t + b);
    return `rgb(${r},${g},${b})`;
}

/* ══════════════════════════════════════════════════
   EXPORT — merge into the physics sim registry (Space category)
══════════════════════════════════════════════════ */
window._physSimModes = Object.assign(window._physSimModes || {}, {
    solar_system: SOLAR,
    starfield:    WARP,
    galaxy:       GALAXY,
    black_hole:   BLACKHOLE,
});

})();
