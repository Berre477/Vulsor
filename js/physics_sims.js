// ── Extra Physics Simulations ─────────────────────────────────────────────────
// Self-contained simulation modes for the 2-D physics canvas.
// Each mode exposes: { label, icon, color, tip, init(W,H), step(dt), draw(ctx,W,H), click(x,y), controls(el) }
'use strict';
(function () {

const TWO_PI = Math.PI * 2;
function lerp(a, b, t) { return a + (b - a) * t; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

/* ══════════════════════════════════════════════════
   SHARED SPEED reference (set by physics.js via window._physSpeed)
══════════════════════════════════════════════════ */
function _spd() { return window._physSpeed || 1; }

/* ══════════════════════════════════════════════════
   1. PENDULUM WAVE
══════════════════════════════════════════════════ */
const PW = (() => {
    const N = 15;
    let W, H, bobs = [], trailOn = false;
    const PERIOD_BASE = 4.0; // seconds for longest pendulum

    function _init(w, h) {
        W = w; H = h; bobs = [];
        for (let i = 0; i < N; i++) {
            const nOsc = 51 + i;                    // oscillations in 60 s
            const T = 60 / nOsc;                    // period
            const L = 9.81 * (T / TWO_PI) ** 2;    // length in metres
            const Lpx = L * (H * 0.55);             // scale to canvas
            bobs.push({ angle: Math.PI * 0.4, vel: 0, L: Lpx, trail: [] });
        }
    }

    function _step(dt) {
        dt = Math.min(dt, 0.03);
        bobs.forEach(b => {
            const acc = -9.81 / (b.L / (H * 0.55)) * Math.sin(b.angle);
            b.vel  += acc * dt;
            b.vel  *= 0.9995;           // tiny damping
            b.angle += b.vel * dt;
            if (trailOn) {
                const px = W / 2 + (N/2 - bobs.indexOf(b)) * (W / (N + 2)) + Math.sin(b.angle) * b.L;
                const py = H * 0.18 + Math.cos(b.angle) * b.L;
                b.trail.push([px, py]);
                if (b.trail.length > 120) b.trail.shift();
            } else { b.trail = []; }
        });
    }

    function _draw(ctx, w, h) {
        ctx.fillStyle = '#0a0f1a';
        ctx.fillRect(0, 0, w, h);

        const pivotY = h * 0.15;
        const spacing = w / (N + 1);

        bobs.forEach((b, i) => {
            const px = spacing * (i + 1);
            const bx = px + Math.sin(b.angle) * b.L;
            const by = pivotY + Math.cos(b.angle) * b.L;
            const hue = (i / N) * 280 + 180;

            // Trail
            if (b.trail.length > 1) {
                ctx.beginPath();
                b.trail.forEach(([tx, ty], ti) => {
                    ctx.strokeStyle = `hsla(${hue},90%,65%,${ti/b.trail.length*0.4})`;
                    ti === 0 ? ctx.moveTo(tx, ty) : ctx.lineTo(tx, ty);
                });
                ctx.lineWidth = 1.5; ctx.stroke();
            }

            // String
            ctx.beginPath(); ctx.moveTo(px, pivotY); ctx.lineTo(bx, by);
            ctx.strokeStyle = `hsla(${hue},60%,50%,0.55)`; ctx.lineWidth = 1.2; ctx.stroke();
            // Pivot
            ctx.beginPath(); ctx.arc(px, pivotY, 3, 0, TWO_PI);
            ctx.fillStyle = '#64748b'; ctx.fill();
            // Bob
            ctx.beginPath(); ctx.arc(bx, by, 7, 0, TWO_PI);
            ctx.fillStyle = `hsl(${hue},85%,62%)`; ctx.fill();
        });

        // Label
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.font = '11px sans-serif'; ctx.textAlign = 'left';
        ctx.fillText('Pendulum Wave — 15 pendulums tuned to 51–65 cycles/min', 12, h - 14);
    }

    function _controls(el) {
        const btn = document.createElement('button');
        btn.className = 'px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all';
        const sync = () => {
            btn.style.cssText = trailOn
                ? 'background:#a78bfa33;color:rgb(var(--tw-violet-400));border:1px solid #a78bfa66'
                : 'background:transparent;color:rgb(var(--slate-600));border:1px solid rgb(var(--slate-800))';
            btn.textContent = trailOn ? '✦ Trails ON' : '✦ Trails OFF';
        };
        sync();
        btn.onclick = () => { trailOn = !trailOn; sync(); };
        el.appendChild(btn);

        const restartBtn = document.createElement('button');
        restartBtn.className = 'px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all';
        restartBtn.style.cssText = 'background:transparent;color:rgb(var(--slate-600));border:1px solid rgb(var(--slate-800))';
        restartBtn.textContent = '↺ Reset swing';
        restartBtn.onclick = () => bobs.forEach(b => { b.angle = Math.PI * 0.4; b.vel = 0; b.trail = []; });
        el.appendChild(restartBtn);
    }

    return { label:'Pendulum Wave', icon:'fa-wave-square', color:'#a78bfa',
             tip:'15 pendulums tuned to different periods create hypnotic wave patterns',
             init:_init, step:_step, draw:_draw, click:()=>{}, controls:_controls };
})();

/* ══════════════════════════════════════════════════
   2. DOUBLE PENDULUM
══════════════════════════════════════════════════ */
const DP = (() => {
    let W, H;
    let pend = [];   // array of independent double pendulums
    let trailLen = 400;

    function _makePend(a1, a2, col) {
        return { a1, a2, v1: 0, v2: 0, m1: 1, m2: 1, L1: 0, L2: 0, trail: [], color: col };
    }

    function _init(w, h) {
        W = w; H = h;
        const L = Math.min(w, h) * 0.25;
        pend = [
            _makePend( Math.PI * 0.75, Math.PI * 0.5, '#38bdf8'),
            _makePend( Math.PI * 0.75 + 0.001, Math.PI * 0.5, '#f87171'),
        ];
        pend.forEach(p => { p.L1 = L; p.L2 = L; });
    }

    // Runge–Kutta 4 step for double pendulum Lagrangian
    function _dpDerivs(p, a1, a2, v1, v2) {
        const g = 9.81, L1 = p.L1, L2 = p.L2, m1 = p.m1, m2 = p.m2;
        const d = a1 - a2;
        const denom1 = (m1 + m2) * L1 - m2 * L1 * Math.cos(d) ** 2;
        const denom2 = (L2 / L1) * denom1;
        const da1 = v1;
        const da2 = v2;
        const dv1 = (m2 * L1 * v1**2 * Math.sin(d) * Math.cos(d)
                   + m2 * g * Math.sin(a2) * Math.cos(d)
                   + m2 * L2 * v2**2 * Math.sin(d)
                   - (m1 + m2) * g * Math.sin(a1)) / denom1;
        const dv2 = (-m2 * L2 * v2**2 * Math.sin(d) * Math.cos(d)
                   + (m1 + m2) * (g * Math.sin(a1) * Math.cos(d) - L1 * v1**2 * Math.sin(d) - g * Math.sin(a2))) / denom2;
        return [da1, da2, dv1, dv2];
    }

    function _rk4(p, dt) {
        const s = [p.a1, p.a2, p.v1, p.v2];
        const k1 = _dpDerivs(p, ...s);
        const s2 = s.map((v, i) => v + k1[i] * dt / 2);
        const k2 = _dpDerivs(p, ...s2);
        const s3 = s.map((v, i) => v + k2[i] * dt / 2);
        const k3 = _dpDerivs(p, ...s3);
        const s4 = s.map((v, i) => v + k3[i] * dt);
        const k4 = _dpDerivs(p, ...s4);
        p.a1 += (k1[0]+2*k2[0]+2*k3[0]+k4[0]) * dt/6;
        p.a2 += (k1[1]+2*k2[1]+2*k3[1]+k4[1]) * dt/6;
        p.v1 += (k1[2]+2*k2[2]+2*k3[2]+k4[2]) * dt/6;
        p.v2 += (k1[3]+2*k2[3]+2*k3[3]+k4[3]) * dt/6;
    }

    function _step(dt) {
        dt = Math.min(dt, 0.02);
        const px = W / 2, py = H * 0.28;
        pend.forEach(p => {
            for (let sub = 0; sub < 4; sub++) _rk4(p, dt / 4);
            const b1x = px + Math.sin(p.a1) * p.L1;
            const b1y = py + Math.cos(p.a1) * p.L1;
            const b2x = b1x + Math.sin(p.a2) * p.L2;
            const b2y = b1y + Math.cos(p.a2) * p.L2;
            p.trail.push([b2x, b2y]);
            if (p.trail.length > trailLen) p.trail.shift();
        });
    }

    function _draw(ctx, w, h) {
        ctx.fillStyle = '#0a0f1a';
        ctx.fillRect(0, 0, w, h);
        const px = w / 2, py = h * 0.28;

        pend.forEach(p => {
            // Trail
            if (p.trail.length > 1) {
                for (let i = 1; i < p.trail.length; i++) {
                    const alpha = i / p.trail.length;
                    ctx.strokeStyle = p.color.replace(')', `,${alpha * 0.85})`).replace('rgb','rgba').replace('#', 'rgba(').replace(/rgba\(([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/, (_,r,g,b) => `rgba(${parseInt(r,16)},${parseInt(g,16)},${parseInt(b,16)}`);
                    // simpler approach:
                    const col = p.color;
                    const r = parseInt(col.slice(1,3),16), g2 = parseInt(col.slice(3,5),16), b2 = parseInt(col.slice(5,7),16);
                    ctx.strokeStyle = `rgba(${r},${g2},${b2},${alpha * 0.7})`;
                    ctx.lineWidth = 1.2;
                    ctx.beginPath();
                    ctx.moveTo(p.trail[i-1][0], p.trail[i-1][1]);
                    ctx.lineTo(p.trail[i][0],   p.trail[i][1]);
                    ctx.stroke();
                }
            }

            const b1x = px + Math.sin(p.a1) * p.L1;
            const b1y = py + Math.cos(p.a1) * p.L1;
            const b2x = b1x + Math.sin(p.a2) * p.L2;
            const b2y = b1y + Math.cos(p.a2) * p.L2;

            // Arms
            ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(b1x, b1y); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(b1x, b1y); ctx.lineTo(b2x, b2y); ctx.stroke();
            // Pivot
            ctx.beginPath(); ctx.arc(px, py, 5, 0, TWO_PI);
            ctx.fillStyle = '#64748b'; ctx.fill();
            // Bobs
            ctx.beginPath(); ctx.arc(b1x, b1y, 9, 0, TWO_PI);
            ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fill();
            ctx.beginPath(); ctx.arc(b2x, b2y, 10, 0, TWO_PI);
            ctx.fillStyle = p.color; ctx.fill();
        });

        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.font = '11px sans-serif'; ctx.textAlign = 'left';
        ctx.fillText('Double Pendulum — blue & red start 0.001 rad apart (chaos)', 12, h - 14);
    }

    function _controls(el) {
        // Trail length slider
        const w = document.createElement('div'); w.className = 'flex items-center gap-2';
        w.innerHTML = `<label class="text-[10px] text-slate-400 w-20 shrink-0">Trail length</label>
          <input type="range" min="20" max="800" step="10" value="${trailLen}"
                 class="w-24 h-1 rounded appearance-none cursor-pointer" style="accent-color:rgb(var(--tw-sky-400))">
          <span class="text-[10px] font-mono w-8 text-right shrink-0" style="color:rgb(var(--tw-sky-400))">${trailLen}</span>`;
        const sl = w.querySelector('input'), sp = w.querySelector('span:last-child');
        sl.oninput = () => { trailLen = parseInt(sl.value); sp.textContent = trailLen; };
        el.appendChild(w);

        const rb = document.createElement('button');
        rb.className = 'px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all';
        rb.style.cssText = 'background:transparent;color:rgb(var(--slate-600));border:1px solid rgb(var(--slate-800))';
        rb.textContent = '↺ Reset';
        rb.onclick = () => { const L = Math.min(W,H)*0.25; pend.forEach(p=>{p.a1=Math.PI*0.75;p.a2=Math.PI*0.5;p.v1=0;p.v2=0;p.L1=L;p.L2=L;p.trail=[];}); pend[1].a1+=0.001; };
        el.appendChild(rb);
    }

    return { label:'Double Pendulum', icon:'fa-atom', color:'#38bdf8',
             tip:'Two blue & red double pendulums starting 0.001 rad apart — watch chaos diverge',
             init:_init, step:_step, draw:_draw, click:()=>{}, controls:_controls };
})();

/* ══════════════════════════════════════════════════
   3. WAVE INTERFERENCE
══════════════════════════════════════════════════ */
const WI = (() => {
    let W, H, sources = [], freq = 2.5, t = 0, speed = 120, resolution = 3;

    function _init(w, h) {
        W = w; H = h; t = 0;
        sources = [
            { x: w * 0.38, y: h * 0.5, phase: 0 },
            { x: w * 0.62, y: h * 0.5, phase: 0 },
        ];
    }

    function _step(dt) { t += dt; }

    function _draw(ctx, w, h) {
        const img = ctx.createImageData(Math.ceil(w / resolution), Math.ceil(h / resolution));
        const omega = TWO_PI * freq, k = omega / speed;
        const cols = img.width, rows = img.height;

        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                const wx = col * resolution, wy = row * resolution;
                let amp = 0;
                sources.forEach(s => {
                    const d = Math.hypot(wx - s.x, wy - s.y);
                    if (d < 0.1) { amp += 1; return; }
                    amp += Math.sin(k * d - omega * t + s.phase) / (1 + d * 0.008);
                });
                const v = clamp((amp / sources.length + 1) / 2, 0, 1);
                const idx = (row * cols + col) * 4;
                // Blue–cyan–white palette
                img.data[idx]     = Math.floor(v * v * 30);
                img.data[idx + 1] = Math.floor(v * 180);
                img.data[idx + 2] = Math.floor(v * 255);
                img.data[idx + 3] = 255;
            }
        }
        // Scale up
        const tmp = document.createElement('canvas');
        tmp.width = cols; tmp.height = rows;
        tmp.getContext('2d').putImageData(img, 0, 0);
        ctx.drawImage(tmp, 0, 0, w, h);

        // Draw sources
        sources.forEach((s, i) => {
            ctx.beginPath(); ctx.arc(s.x, s.y, 10, 0, TWO_PI);
            ctx.fillStyle = 'rgba(255,220,100,0.9)'; ctx.fill();
            ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
            ctx.fillStyle = '#000'; ctx.font = 'bold 9px sans-serif';
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(i + 1, s.x, s.y);
        });

        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.font = '11px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        ctx.fillText(`Wave interference — click to add sources (${sources.length} active)`, 12, h - 14);
    }

    function _click(x, y) { sources.push({ x, y, phase: 0 }); }

    function _controls(el) {
        // Frequency
        const fw = document.createElement('div'); fw.className = 'flex items-center gap-2';
        fw.innerHTML = `<label class="text-[10px] text-slate-400 w-16 shrink-0">Frequency</label>
          <input type="range" min="0.5" max="8" step="0.1" value="${freq}"
                 class="w-24 h-1 rounded appearance-none cursor-pointer" style="accent-color:rgb(var(--tw-sky-400))">
          <span class="text-[10px] font-mono w-12 text-right shrink-0" style="color:rgb(var(--tw-sky-400))">${freq.toFixed(1)} Hz</span>`;
        const fsl = fw.querySelector('input'), fsp = fw.querySelector('span:last-child');
        fsl.oninput = () => { freq = parseFloat(fsl.value); fsp.textContent = freq.toFixed(1) + ' Hz'; };
        el.appendChild(fw);

        // Clear sources
        const cb = document.createElement('button');
        cb.className = 'px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all';
        cb.style.cssText = 'background:#ef444422;color:rgb(var(--tw-red-400));border:1px solid #ef444444';
        cb.textContent = 'Clear extra sources';
        cb.onclick = () => { sources = sources.slice(0, 2); };
        el.appendChild(cb);

        // Phase shift btn
        const pb = document.createElement('button');
        pb.className = 'px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all';
        pb.style.cssText = 'background:transparent;color:rgb(var(--slate-600));border:1px solid rgb(var(--slate-800))';
        pb.textContent = '⟲ Shift phase';
        pb.onclick = () => { sources.forEach((s, i) => { s.phase = (Math.PI * i) % TWO_PI; }); };
        el.appendChild(pb);
    }

    return { label:'Wave Interference', icon:'fa-water', color:'#22d3ee',
             tip:'Click anywhere to add a new wave source',
             init:_init, step:_step, draw:_draw, click:_click, controls:_controls };
})();

/* ══════════════════════════════════════════════════
   4. IDEAL GAS
══════════════════════════════════════════════════ */
const GAS = (() => {
    let W, H, particles = [], wallTemp = 1, t = 0, heatOn = false;
    const N_INIT = 80, R = 5;

    function _init(w, h) {
        W = w; H = h; particles = []; t = 0;
        const margin = 30;
        for (let i = 0; i < N_INIT; i++) {
            const speed = 120 + Math.random() * 100;
            const angle = Math.random() * TWO_PI;
            particles.push({
                x: margin + Math.random() * (w - margin * 2),
                y: margin + Math.random() * (h - margin * 2),
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
            });
        }
    }

    function _step(dt) {
        t += dt;
        dt = Math.min(dt, 0.02);
        const margin = 10;
        if (heatOn) {
            particles.forEach(p => {
                const spd = Math.hypot(p.vx, p.vy);
                p.vx += (Math.random() - 0.5) * 40 * dt;
                p.vy += (Math.random() - 0.5) * 40 * dt;
            });
        }
        particles.forEach(p => {
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            if (p.x < margin + R)       { p.x = margin + R;   p.vx = Math.abs(p.vx); }
            if (p.x > W - margin - R)   { p.x = W-margin-R;   p.vx = -Math.abs(p.vx); }
            if (p.y < margin + R)       { p.y = margin + R;   p.vy = Math.abs(p.vy); }
            if (p.y > H - margin - R)   { p.y = H-margin-R;   p.vy = -Math.abs(p.vy); }
        });
        // Simple pairwise collisions (only nearby)
        for (let i = 0; i < particles.length; i++) {
            for (let j = i + 1; j < particles.length; j++) {
                const a = particles[i], b = particles[j];
                const dx = b.x - a.x, dy = b.y - a.y;
                const dist = Math.hypot(dx, dy);
                if (dist < R * 2 && dist > 0) {
                    const nx = dx / dist, ny = dy / dist;
                    const rel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
                    if (rel > 0) {
                        a.vx -= rel * nx; a.vy -= rel * ny;
                        b.vx += rel * nx; b.vy += rel * ny;
                        const overlap = R * 2 - dist;
                        a.x -= nx * overlap / 2; a.y -= ny * overlap / 2;
                        b.x += nx * overlap / 2; b.y += ny * overlap / 2;
                    }
                }
            }
        }
    }

    function _avgKE() {
        if (!particles.length) return 0;
        return particles.reduce((s, p) => s + p.vx**2 + p.vy**2, 0) / particles.length / 2;
    }

    function _draw(ctx, w, h) {
        ctx.fillStyle = '#0a0f1a'; ctx.fillRect(0, 0, w, h);
        const margin = 10;
        // Box
        ctx.strokeStyle = 'rgba(100,148,237,0.4)'; ctx.lineWidth = 2;
        ctx.strokeRect(margin, margin, w - margin*2, h - margin*2);

        const ke = _avgKE();
        const maxKE = 30000;
        particles.forEach(p => {
            const spd = Math.hypot(p.vx, p.vy);
            const t = clamp(spd / 350, 0, 1);
            // cool (blue) → hot (red)
            const r = Math.floor(lerp(50, 240, t));
            const g = Math.floor(lerp(120, 80, t));
            const b2 = Math.floor(lerp(220, 60, t));
            ctx.beginPath(); ctx.arc(p.x, p.y, R, 0, TWO_PI);
            ctx.fillStyle = `rgb(${r},${g},${b2})`; ctx.fill();
        });

        // Stats
        const temp = (ke / 150).toFixed(1);
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.font = '12px monospace'; ctx.textAlign = 'right';
        ctx.fillText(`T = ${temp} K  ·  N = ${particles.length}`, w - 16, 28);
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.font = '11px sans-serif'; ctx.textAlign = 'left';
        ctx.fillText('Ideal Gas — blue=cold, red=hot  ·  click to add particles', 12, h - 14);
    }

    function _click(x, y) {
        const speed = 150 + Math.random() * 80, angle = Math.random() * TWO_PI;
        particles.push({ x, y, vx: Math.cos(angle)*speed, vy: Math.sin(angle)*speed });
    }

    function _controls(el) {
        const hb = document.createElement('button');
        hb.className = 'px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all';
        const sync = () => {
            hb.style.cssText = heatOn
                ? 'background:#f8717122;color:rgb(var(--tw-red-400));border:1px solid #f8717144'
                : 'background:transparent;color:rgb(var(--slate-600));border:1px solid rgb(var(--slate-800))';
            hb.textContent = heatOn ? '🔥 Heating ON' : '🔥 Heat';
        };
        sync(); hb.onclick = () => { heatOn = !heatOn; sync(); };
        el.appendChild(hb);

        const cb = document.createElement('button');
        cb.className = 'px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all';
        cb.style.cssText = 'background:transparent;color:rgb(var(--slate-600));border:1px solid rgb(var(--slate-800))';
        cb.textContent = '❄ Cool';
        cb.onclick = () => { particles.forEach(p => { p.vx *= 0.5; p.vy *= 0.5; }); };
        el.appendChild(cb);

        const rb = document.createElement('button');
        rb.className = 'px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all';
        rb.style.cssText = 'background:#ef444422;color:rgb(var(--tw-red-400));border:1px solid #ef444444';
        rb.textContent = '↺ Reset';
        rb.onclick = () => _init(W, H);
        el.appendChild(rb);
    }

    return { label:'Ideal Gas', icon:'fa-th', color:'#f87171',
             tip:'Elastic particle collisions — click to add particles',
             init:_init, step:_step, draw:_draw, click:_click, controls:_controls };
})();

/* ══════════════════════════════════════════════════
   5. ORBITAL MECHANICS
══════════════════════════════════════════════════ */
const ORB = (() => {
    let W, H, bodies = [], trailLen = 300, G = 2000, t = 0;
    let _placing = null; // {x,y} of first click for velocity drag

    function _init(w, h) {
        W = w; H = h; t = 0; _placing = null;
        const cx = w / 2, cy = h / 2;
        bodies = [
            { x: cx, y: cy, vx: 0, vy: 0, mass: 5000, r: 14, color: '#fbbf24', fixed: true, trail: [] },
            { x: cx + 140, y: cy, vx: 0, vy: -Math.sqrt(G * 5000 / 140), mass: 20, r: 6, color: '#38bdf8', fixed: false, trail: [] },
            { x: cx - 220, y: cy, vx: 0, vy:  Math.sqrt(G * 5000 / 220), mass: 15, r: 5, color: '#4ade80', fixed: false, trail: [] },
        ];
    }

    function _step(dt) {
        t += dt;
        dt = Math.min(dt, 0.02);
        const n = bodies.length;
        bodies.forEach(b => { b.ax = 0; b.ay = 0; });
        for (let i = 0; i < n; i++) {
            for (let j = i + 1; j < n; j++) {
                const a = bodies[i], b = bodies[j];
                const dx = b.x - a.x, dy = b.y - a.y;
                const dist2 = dx*dx + dy*dy;
                const dist = Math.sqrt(dist2) + 0.01;
                const F = G * a.mass * b.mass / dist2;
                const fx = F * dx / dist, fy = F * dy / dist;
                if (!a.fixed) { a.ax += fx / a.mass; a.ay += fy / a.mass; }
                if (!b.fixed) { b.ax -= fx / b.mass; b.ay -= fy / b.mass; }
            }
        }
        bodies.forEach(b => {
            if (b.fixed) return;
            b.vx += b.ax * dt; b.vy += b.ay * dt;
            b.x  += b.vx * dt; b.y  += b.vy * dt;
            b.trail.push([b.x, b.y]);
            if (b.trail.length > trailLen) b.trail.shift();
        });
    }

    function _draw(ctx, w, h) {
        ctx.fillStyle = '#060a14'; ctx.fillRect(0, 0, w, h);
        // Stars background (static, seeded)
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        for (let i = 0; i < 60; i++) {
            const sx = ((i*137+73) % w), sy = ((i*191+29) % h);
            ctx.fillRect(sx, sy, 1, 1);
        }
        // Trails
        bodies.forEach(b => {
            if (b.trail.length < 2) return;
            const r = parseInt(b.color.slice(1,3),16), g2 = parseInt(b.color.slice(3,5),16), b2 = parseInt(b.color.slice(5,7),16);
            for (let i = 1; i < b.trail.length; i++) {
                const alpha = (i / b.trail.length) * 0.6;
                ctx.strokeStyle = `rgba(${r},${g2},${b2},${alpha})`;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(b.trail[i-1][0], b.trail[i-1][1]);
                ctx.lineTo(b.trail[i][0],   b.trail[i][1]);
                ctx.stroke();
            }
        });
        // Bodies
        bodies.forEach(b => {
            if (b.fixed) {
                // glow
                const grd = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r * 3.5);
                grd.addColorStop(0, b.color);
                grd.addColorStop(1, 'transparent');
                ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 3.5, 0, TWO_PI);
                ctx.fillStyle = grd; ctx.fill();
            }
            ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TWO_PI);
            ctx.fillStyle = b.color; ctx.fill();
        });

        // Placing preview
        if (_placing) {
            ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            ctx.beginPath(); ctx.moveTo(_placing.x, _placing.y);
            ctx.lineTo(_placing.mx || _placing.x, _placing.my || _placing.y);
            ctx.stroke(); ctx.setLineDash([]);
            ctx.beginPath(); ctx.arc(_placing.x, _placing.y, 7, 0, TWO_PI);
            ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fill();
        }

        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.font = '11px sans-serif'; ctx.textAlign = 'left';
        ctx.fillText('Orbital Mechanics — click to place a body, drag to set velocity', 12, h - 14);
    }

    function _click(x, y) { _placing = { x, y, mx: x, my: y }; }
    function _release(x, y) {
        if (!_placing) return;
        const vx = (x - _placing.x) * 1.5, vy = (y - _placing.y) * 1.5;
        bodies.push({ x: _placing.x, y: _placing.y, vx, vy, mass: 10 + Math.random()*20, r: 5 + Math.random()*4, color: `hsl(${Math.random()*360|0},80%,65%)`, fixed: false, trail: [] });
        _placing = null;
    }
    function _move(x, y) { if (_placing) { _placing.mx = x; _placing.my = y; } }

    function _controls(el) {
        // G slider
        const gw = document.createElement('div'); gw.className = 'flex items-center gap-2';
        gw.innerHTML = `<label class="text-[10px] text-slate-400 w-12 shrink-0">Gravity G</label>
          <input type="range" min="200" max="8000" step="100" value="${G}"
                 class="w-24 h-1 rounded appearance-none cursor-pointer" style="accent-color:rgb(var(--tw-amber-400))">
          <span class="text-[10px] font-mono w-12 text-right shrink-0" style="color:rgb(var(--tw-amber-400))">${G}</span>`;
        const gsl = gw.querySelector('input'), gsp = gw.querySelector('span:last-child');
        gsl.oninput = () => { G = parseInt(gsl.value); gsp.textContent = G; };
        el.appendChild(gw);

        const rb = document.createElement('button');
        rb.className = 'px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all';
        rb.style.cssText = 'background:transparent;color:rgb(var(--slate-600));border:1px solid rgb(var(--slate-800))';
        rb.textContent = '↺ Reset';
        rb.onclick = () => _init(W, H);
        el.appendChild(rb);

        const cb = document.createElement('button');
        cb.className = 'px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all';
        cb.style.cssText = 'background:#ef444422;color:rgb(var(--tw-red-400));border:1px solid #ef444444';
        cb.textContent = 'Clear bodies';
        cb.onclick = () => { bodies = [bodies[0]]; };
        el.appendChild(cb);
    }

    return { label:'Orbital Mechanics', icon:'fa-globe', color:'#fbbf24',
             tip:'Click canvas to place a body, drag to set launch velocity',
             init:_init, step:_step, draw:_draw,
             click:_click, release:_release, move:_move,
             controls:_controls };
})();

/* ══════════════════════════════════════════════════
   6. STANDING WAVE / ROPE
══════════════════════════════════════════════════ */
const SW = (() => {
    let W, H, nodes = [], t = 0, freq = 3, amplitude = 60, N = 80, damping = 0.002;
    let driving = true;

    function _init(w, h) {
        W = w; H = h; t = 0;
        nodes = [];
        for (let i = 0; i < N; i++) {
            nodes.push({ x: w * 0.08 + i * (w * 0.84) / (N - 1), y: h / 2, vy: 0 });
        }
    }

    function _step(dt) {
        t += dt;
        dt = Math.min(dt, 0.016);
        const c2 = 90000; // wave speed squared
        const dx = nodes.length > 1 ? nodes[1].x - nodes[0].x : 1;

        // Drive left end
        if (driving) nodes[0].y = H / 2 + Math.sin(TWO_PI * freq * t) * amplitude;
        // Fixed right end
        nodes[N - 1].y = H / 2;

        // Wave equation (finite differences)
        for (let i = 1; i < N - 1; i++) {
            const acc = c2 * (nodes[i-1].y + nodes[i+1].y - 2 * nodes[i].y) / (dx * dx);
            nodes[i].vy += acc * dt;
            nodes[i].vy *= (1 - damping);
        }
        for (let i = 1; i < N - 1; i++) nodes[i].y += nodes[i].vy * dt;
    }

    function _draw(ctx, w, h) {
        ctx.fillStyle = '#0a0f1a'; ctx.fillRect(0, 0, w, h);

        // Equilibrium line
        ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1;
        ctx.setLineDash([6, 6]);
        ctx.beginPath(); ctx.moveTo(0, h/2); ctx.lineTo(w, h/2); ctx.stroke();
        ctx.setLineDash([]);

        // Rope with gradient
        if (nodes.length < 2) return;
        for (let i = 1; i < nodes.length; i++) {
            const dy = nodes[i].y - h / 2;
            const hue = 220 + (dy / amplitude) * 60;
            const bright = 50 + Math.abs(dy / amplitude) * 35;
            ctx.strokeStyle = `hsl(${hue},80%,${bright}%)`;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(nodes[i-1].x, nodes[i-1].y);
            ctx.lineTo(nodes[i].x,   nodes[i].y);
            ctx.stroke();
        }

        // Endpoints
        ctx.beginPath(); ctx.arc(nodes[0].x, nodes[0].y, 7, 0, TWO_PI);
        ctx.fillStyle = '#f59e0b'; ctx.fill();
        ctx.beginPath(); ctx.arc(nodes[N-1].x, nodes[N-1].y, 7, 0, TWO_PI);
        ctx.fillStyle = '#64748b'; ctx.fill();

        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.font = '11px sans-serif'; ctx.textAlign = 'left';
        ctx.fillText(`Standing Wave — ${freq.toFixed(1)} Hz  ·  click rope to pluck`, 12, h - 14);
    }

    function _click(x, y) {
        // Pluck: displace nearest node
        let best = 0, bd = Infinity;
        nodes.forEach((n, i) => { const d = Math.abs(n.x - x); if (d < bd) { bd = d; best = i; } });
        nodes[best].y = y;
        nodes[best].vy = 0;
    }

    function _controls(el) {
        const fw = document.createElement('div'); fw.className = 'flex items-center gap-2';
        fw.innerHTML = `<label class="text-[10px] text-slate-400 w-16 shrink-0">Frequency</label>
          <input type="range" min="0.5" max="12" step="0.5" value="${freq}"
                 class="w-24 h-1 rounded appearance-none cursor-pointer" style="accent-color:rgb(var(--tw-green-400))">
          <span class="text-[10px] font-mono w-12 text-right shrink-0" style="color:rgb(var(--tw-green-400))">${freq.toFixed(1)} Hz</span>`;
        const fsl = fw.querySelector('input'), fsp = fw.querySelector('span:last-child');
        fsl.oninput = () => { freq = parseFloat(fsl.value); fsp.textContent = freq.toFixed(1)+' Hz'; };
        el.appendChild(fw);

        const aw = document.createElement('div'); aw.className = 'flex items-center gap-2';
        aw.innerHTML = `<label class="text-[10px] text-slate-400 w-16 shrink-0">Amplitude</label>
          <input type="range" min="5" max="120" step="5" value="${amplitude}"
                 class="w-24 h-1 rounded appearance-none cursor-pointer" style="accent-color:rgb(var(--tw-green-400))">
          <span class="text-[10px] font-mono w-10 text-right shrink-0" style="color:rgb(var(--tw-green-400))">${amplitude} px</span>`;
        const asl = aw.querySelector('input'), asp = aw.querySelector('span:last-child');
        asl.oninput = () => { amplitude = parseInt(asl.value); asp.textContent = amplitude+' px'; };
        el.appendChild(aw);

        const db = document.createElement('button');
        db.className = 'px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all';
        const dsync = () => {
            db.style.cssText = driving
                ? 'background:#4ade8022;color:rgb(var(--tw-green-400));border:1px solid #4ade8044'
                : 'background:transparent;color:rgb(var(--slate-600));border:1px solid rgb(var(--slate-800))';
            db.textContent = driving ? '〜 Drive ON' : '〜 Drive OFF';
        };
        dsync(); db.onclick = () => { driving = !driving; dsync(); };
        el.appendChild(db);
    }

    return { label:'Standing Wave', icon:'fa-broadcast-tower', color:'#4ade80',
             tip:'Driven wave on a rope — adjust frequency to hit resonance nodes',
             init:_init, step:_step, draw:_draw, click:_click, controls:_controls };
})();

/* ══════════════════════════════════════════════════
   EXPORT
══════════════════════════════════════════════════ */
window._physSimModes = {
    pendulum_wave:    PW,
    double_pendulum:  DP,
    wave_interference: WI,
    ideal_gas:        GAS,
    orbital:          ORB,
    standing_wave:    SW,
};

})();
