// ── Home page background ───────────────────────────────────────────────
// One canvas behind the home content, painted by whichever style is selected
// in Settings → Home background. Every style shares the same canvas, resize
// handling and frame loop, so adding one means writing a draw() and nothing
// else. Runs at ~30fps and idles fully whenever the home view is hidden, so
// it costs nothing while you're in another app.
//
// Styles read the user's accent colour, so the background follows the theme
// instead of fighting it. Motion drops to a slow drift when the OS asks for
// less of it. Nothing tracks the pointer — the scene moves on its own.
(function () {
    const HOME_ID = 'view-home';
    const FPS     = 30;

    let canvas = null, ctx = null, W = 0, H = 0, dpr = 1;
    let styleId = 'plexus';
    let style   = null;          // the active style object
    let lastFrame = 0, t0 = performance.now();

    const reduceMotion = () => window.matchMedia
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // The accent, as "r,g,b". Falls back to indigo before settings load.
    function accentRGB() {
        try {
            const v = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
            const m = v.match(/^#?([0-9a-f]{6})$/i);
            if (m) {
                const n = parseInt(m[1], 16);
                return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
            }
            const r = v.match(/(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
            if (r) return `${r[1]},${r[2]},${r[3]}`;
        } catch (_) {}
        return '99,102,241';
    }

    const rand = (a, b) => a + Math.random() * (b - a);

    // Light background themes flip the page to near-white, and white stars on
    // white paper vanish. Every style takes its "starlight" colours from here
    // so the same scene reads as ink on paper when the theme is light. The
    // accent-tinted parts already work on both.
    const isLight = () => document.documentElement.dataset.theme === 'light';
    const INK = {
        star:      () => isLight() ? '51,65,85'   : '214,228,255',   // small distant stars
        starHi:    () => isLight() ? '30,41,59'   : '226,236,255',   // brighter / bent stars
        nebStar:   () => isLight() ? '30,41,59'   : '235,243,255',
        streak:    () => isLight() ? '51,65,85'   : '215,230,255',   // warp lines
        coreWarm:  () => isLight() ? '150,95,35'  : '255,241,214',   // galaxy core
        coreMid:   () => isLight() ? '170,110,40' : '255,196,120',
        coreEdge:  () => isLight() ? '190,130,60' : '255,170,90',
        armWarm:   () => isLight() ? '160,100,40' : '255,232,196',
        armCool:   () => isLight() ? '60,80,120'  : '186,214,255',
        // Additive blending brightens toward white — invisible on a light page.
        blend:     () => isLight() ? 'multiply' : 'lighter',
    };

    // ── Styles ─────────────────────────────────────────────────────────
    // Each has: build() to (re)seed for the current size, draw(t) to paint.

    // Nodes drifting in a slowly rotating 3D volume, projected with
    // perspective. Links fade with distance and depth.
    const plexus = (() => {
        const LINK = 265, DEPTH = 700, FOCAL = 950;
        let nodes = [], rotY = 0, rotX = 0;
        const hues = () => [accentRGB(), '139,92,246', '56,189,248'];
        return {
            id: 'plexus',
            build() {
                const HU = hues();
                const count = Math.max(80, Math.min(220, Math.round(W * H / 7500)));
                nodes = Array.from({ length: count }, () => ({
                    x: (Math.random() - 0.5) * W * 1.55,
                    y: (Math.random() - 0.5) * H * 1.45,
                    z: (Math.random() - 0.5) * DEPTH,
                    vx: rand(-0.11, 0.11), vy: rand(-0.11, 0.11), vz: rand(-0.14, 0.14),
                    hue: HU[Math.floor(Math.random() * HU.length)],
                    r: 2.2 + Math.random() * 2.6,
                }));
            },
            draw() {
                const slow = reduceMotion() ? 0.25 : 1;
                rotY += 0.00042 * slow; rotX = Math.sin(rotY * 0.6) * 0.22;
                const sy = Math.sin(rotY), cy = Math.cos(rotY);
                const sx = Math.sin(rotX), cx = Math.cos(rotX);
                const proj = new Array(nodes.length);
                for (let i = 0; i < nodes.length; i++) {
                    const n = nodes[i];
                    n.x += n.vx * slow; n.y += n.vy * slow; n.z += n.vz * slow;
                    if (Math.abs(n.x) > W)         n.vx *= -1;
                    if (Math.abs(n.y) > H)         n.vy *= -1;
                    if (Math.abs(n.z) > DEPTH / 2) n.vz *= -1;
                    let x = n.x * cy + n.z * sy;
                    let z = -n.x * sy + n.z * cy;
                    let y = n.y * cx - z * sx;
                    z = n.y * sx + z * cx;
                    const s = FOCAL / (FOCAL + z + DEPTH / 2);
                    proj[i] = { sx: W / 2 + x * s, sy: H / 2 + y * s, s };
                }
                ctx.lineWidth = 1;
                for (let i = 0; i < nodes.length; i++) {
                    for (let j = i + 1; j < nodes.length; j++) {
                        const dx = proj[i].sx - proj[j].sx, dy = proj[i].sy - proj[j].sy;
                        const d2 = dx * dx + dy * dy;
                        if (d2 > LINK * LINK) continue;
                        const d = Math.sqrt(d2);
                        const a = (1 - d / LINK) * 0.20 * Math.min(proj[i].s, proj[j].s);
                        if (a < 0.006) continue;
                        ctx.strokeStyle = `rgba(${nodes[i].hue},${a.toFixed(3)})`;
                        ctx.beginPath();
                        ctx.moveTo(proj[i].sx, proj[i].sy);
                        ctx.lineTo(proj[j].sx, proj[j].sy);
                        ctx.stroke();
                    }
                }
                for (let i = 0; i < nodes.length; i++) {
                    const p = proj[i], r = nodes[i].r * p.s;
                    ctx.fillStyle = `rgba(${nodes[i].hue},${(0.10 * p.s + 0.03).toFixed(3)})`;
                    ctx.beginPath(); ctx.arc(p.sx, p.sy, Math.max(1, r * 2.6), 0, 6.2832); ctx.fill();
                    ctx.fillStyle = `rgba(${nodes[i].hue},${(0.68 * p.s + 0.12).toFixed(3)})`;
                    ctx.beginPath(); ctx.arc(p.sx, p.sy, Math.max(0.6, r), 0, 6.2832); ctx.fill();
                }
            },
        };
    })();

    // Depth-sorted stars drifting toward the viewer, with a few brighter ones.
    const stars = (() => {
        let pts = [];
        return {
            id: 'stars',
            build() {
                const count = Math.max(140, Math.min(420, Math.round(W * H / 3400)));
                pts = Array.from({ length: count }, () => ({
                    x: rand(-1, 1), y: rand(-1, 1), z: rand(0.05, 1),
                    tw: Math.random() * 6.28,
                    big: Math.random() < 0.22,
                }));
            },
            draw(t) {
                const slow = reduceMotion() ? 0.2 : 1;
                const a = accentRGB();
                for (const p of pts) {
                    p.z -= 0.00035 * slow;
                    if (p.z <= 0.04) { p.z = 1; p.x = rand(-1, 1); p.y = rand(-1, 1); }
                    const s = 0.45 / p.z;
                    const sx = W / 2 + p.x * W * 0.62 * s;
                    const sy = H / 2 + p.y * H * 0.62 * s;
                    if (sx < -40 || sx > W + 40 || sy < -40 || sy > H + 40) continue;
                    const twinkle = 0.72 + 0.28 * Math.sin(t * 0.0016 + p.tw);
                    // Floor the brightness: distant stars were fading to nothing,
                    // which left the field looking empty rather than deep.
                    const alpha = Math.min(0.95, 0.22 + (1 - p.z) * 0.95) * twinkle;
                    const r = (p.big ? 2.3 : 1.35) * (0.65 + (1 - p.z) * 1.5);
                    if (p.big) {
                        ctx.fillStyle = `rgba(${a},${(alpha * 0.20).toFixed(3)})`;
                        ctx.beginPath(); ctx.arc(sx, sy, r * 6, 0, 6.2832); ctx.fill();
                    }
                    ctx.fillStyle = p.big
                        ? `rgba(${a},${alpha.toFixed(3)})`
                        : `rgba(${INK.star()},${(alpha * 0.85).toFixed(3)})`;
                    ctx.beginPath(); ctx.arc(sx, sy, r, 0, 6.2832); ctx.fill();
                }
            },
        };
    })();

    // Big soft colour fields sliding over each other — no particles, very cheap.
    const aurora = (() => {
        let blobs = [];
        return {
            id: 'aurora',
            build() {
                const a = accentRGB();
                const palette = [a, '139,92,246', '56,189,248', '16,185,129'];
                blobs = palette.map((hue, i) => ({
                    hue,
                    r: Math.max(W, H) * rand(0.42, 0.72),
                    px: rand(0.15, 0.85), py: rand(0.15, 0.85),
                    ax: rand(0.10, 0.26), ay: rand(0.08, 0.20),
                    sp: rand(0.00006, 0.00013) * (i % 2 ? -1 : 1),
                    ph: rand(0, 6.28),
                }));
            },
            draw(t) {
                const slow = reduceMotion() ? 0.25 : 1;
                ctx.globalCompositeOperation = INK.blend();
                for (const b of blobs) {
                    const k = t * b.sp * slow + b.ph;
                    const cx = (b.px + Math.cos(k) * b.ax) * W;
                    const cy = (b.py + Math.sin(k * 1.3) * b.ay) * H;
                    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, b.r);
                    g.addColorStop(0,    `rgba(${b.hue},0.16)`);
                    g.addColorStop(0.45, `rgba(${b.hue},0.06)`);
                    g.addColorStop(1,    `rgba(${b.hue},0)`);
                    ctx.fillStyle = g;
                    ctx.beginPath(); ctx.arc(cx, cy, b.r, 0, 6.2832); ctx.fill();
                }
                ctx.globalCompositeOperation = 'source-over';
            },
        };
    })();

    // Layered sine bands, brighter toward the bottom of the view.
    const waves = {
        id: 'waves',
        build() {},
        draw(t) {
            const slow = reduceMotion() ? 0.25 : 1;
            const a = accentRGB();
            const LAYERS = 5;
            for (let L = 0; L < LAYERS; L++) {
                const k = L / (LAYERS - 1);
                const amp = H * (0.035 + k * 0.055);
                const base = H * (0.52 + k * 0.13);
                const len = W / (1.1 + k * 0.9);
                const sp  = t * 0.00018 * slow * (1 + k * 0.55) + L * 1.7;
                ctx.beginPath();
                ctx.moveTo(0, H);
                for (let x = 0; x <= W; x += 8) {
                    const y = base
                        + Math.sin(x / len + sp) * amp
                        + Math.sin(x / (len * 0.45) + sp * 1.6) * amp * 0.32;
                    ctx.lineTo(x, y);
                }
                ctx.lineTo(W, H);
                ctx.closePath();
                const g = ctx.createLinearGradient(0, base - amp, 0, H);
                g.addColorStop(0, `rgba(${a},${(0.055 + k * 0.03).toFixed(3)})`);
                g.addColorStop(1, `rgba(${a},0)`);
                ctx.fillStyle = g;
                ctx.fill();
                ctx.strokeStyle = `rgba(${a},${(0.10 - k * 0.014).toFixed(3)})`;
                ctx.lineWidth = 1;
                ctx.stroke();
            }
        },
    };

    // Slow-falling embers, warm and sparse.
    const embers = (() => {
        let ps = [];
        return {
            id: 'embers',
            build() {
                const count = Math.max(40, Math.min(120, Math.round(W * H / 14000)));
                ps = Array.from({ length: count }, () => ({
                    x: Math.random() * W, y: Math.random() * H,
                    r: rand(0.8, 2.6), vy: rand(-0.30, -0.09), drift: rand(-0.18, 0.18),
                    ph: Math.random() * 6.28,
                }));
            },
            draw(t) {
                const slow = reduceMotion() ? 0.25 : 1;
                for (const p of ps) {
                    p.y += p.vy * slow;
                    p.x += Math.sin(t * 0.0007 + p.ph) * p.drift * slow;
                    if (p.y < -12) { p.y = H + 12; p.x = Math.random() * W; }
                    const a = 0.30 + 0.30 * Math.sin(t * 0.0013 + p.ph);
                    const sx = p.x, sy = p.y;
                    ctx.fillStyle = `rgba(251,146,60,${(a * 0.14).toFixed(3)})`;
                    ctx.beginPath(); ctx.arc(sx, sy, p.r * 5, 0, 6.2832); ctx.fill();
                    ctx.fillStyle = `rgba(253,205,140,${a.toFixed(3)})`;
                    ctx.beginPath(); ctx.arc(sx, sy, p.r, 0, 6.2832); ctx.fill();
                }
            },
        };
    })();

    // A black hole: background starfield bent around the shadow, a tilted
    // accretion disk drawn in two halves so the far side arcs over the top the
    // way the real thing does, and a photon ring at the edge of the shadow.
    const blackhole = (() => {
        let stars = [], disk = [];
        const TILT = 0.30;            // how flat the disk looks edge-on
        return {
            id: 'blackhole',
            build() {
                const ns = Math.max(120, Math.min(320, Math.round(W * H / 5200)));
                stars = Array.from({ length: ns }, () => ({
                    x: Math.random() * W, y: Math.random() * H,
                    r: rand(0.4, 1.5), tw: Math.random() * 6.28,
                }));
                const nd = Math.max(240, Math.min(560, Math.round(W * H / 2600)));
                disk = Array.from({ length: nd }, () => {
                    const a = rand(1.25, 3.1);                 // orbit radius, in shadow radii
                    return {
                        a, ang: Math.random() * 6.2832,
                        sp: 0.55 / Math.pow(a, 1.5),           // inner orbits sweep faster
                        jit: rand(-0.05, 0.05),
                        w: rand(0.5, 1),
                    };
                });
            },
            draw(t) {
                const slow = reduceMotion() ? 0.22 : 1;
                const cx = W / 2, cy = H / 2;
                const R  = Math.min(W, H) * 0.105;             // shadow radius

                // Background stars, deflected outward near the hole. Anything
                // that would fall inside the shadow is simply swallowed.
                for (const st of stars) {
                    const dx = st.x - cx, dy = st.y - cy;
                    const d = Math.hypot(dx, dy) || 0.001;
                    const bent = d + (2.6 * R * R) / d;        // crude but reads right
                    if (bent < R * 1.08) continue;
                    const k = bent / d;
                    const sx = cx + dx * k, sy = cy + dy * k;
                    if (sx < -20 || sx > W + 20 || sy < -20 || sy > H + 20) continue;
                    const a = (0.35 + 0.35 * Math.sin(t * 0.0015 + st.tw)) * Math.min(1, d / (R * 3));
                    ctx.fillStyle = `rgba(${INK.starHi()},${a.toFixed(3)})`;
                    ctx.beginPath(); ctx.arc(sx, sy, st.r, 0, 6.2832); ctx.fill();
                }

                // Disk particle → screen. Behind the hole when sin(ang) < 0.
                const place = p => {
                    const ang = p.ang + t * 0.001 * p.sp * slow;
                    const r = p.a * R;
                    return {
                        x: cx + Math.cos(ang) * r,
                        y: cy + Math.sin(ang) * r * TILT + p.jit * R,
                        ang, behind: Math.sin(ang) < 0,
                    };
                };
                const paint = (p, pos) => {
                    // Hot and white near the hole, cooling to orange outward.
                    const heat = Math.max(0, Math.min(1, (3.1 - p.a) / 1.85));
                    const rr = 255;
                    const gg = Math.round(150 + 95 * heat);
                    const bb = Math.round(40 + 170 * heat * heat);
                    // The side sweeping toward us is brighter — Doppler beaming.
                    const beam = 0.45 + 0.55 * (0.5 + 0.5 * Math.cos(pos.ang));
                    const a = 0.42 * p.w * beam;
                    const size = (1.0 + heat * 1.5) * p.w;
                    ctx.fillStyle = `rgba(${rr},${gg},${bb},${(a * 0.22).toFixed(3)})`;
                    ctx.beginPath(); ctx.arc(pos.x, pos.y, size * 4, 0, 6.2832); ctx.fill();
                    ctx.fillStyle = `rgba(${rr},${gg},${bb},${a.toFixed(3)})`;
                    ctx.beginPath(); ctx.arc(pos.x, pos.y, size, 0, 6.2832); ctx.fill();
                };

                ctx.globalCompositeOperation = INK.blend();
                const near = [];
                for (const p of disk) {
                    const pos = place(p);
                    if (pos.behind) paint(p, pos); else near.push([p, pos]);
                }
                ctx.globalCompositeOperation = 'source-over';

                // The shadow itself, with a soft rim so it doesn't look cut out.
                const g = ctx.createRadialGradient(cx, cy, R * 0.6, cx, cy, R * 1.35);
                g.addColorStop(0, '#000');
                g.addColorStop(0.72, '#000');
                g.addColorStop(1, 'rgba(0,0,0,0)');
                ctx.fillStyle = g;
                ctx.beginPath(); ctx.arc(cx, cy, R * 1.35, 0, 6.2832); ctx.fill();

                // Photon ring.
                ctx.globalCompositeOperation = INK.blend();
                ctx.strokeStyle = 'rgba(255,214,160,0.55)';
                ctx.lineWidth = Math.max(1, R * 0.045);
                ctx.beginPath(); ctx.arc(cx, cy, R * 1.02, 0, 6.2832); ctx.stroke();
                ctx.strokeStyle = 'rgba(255,180,90,0.16)';
                ctx.lineWidth = Math.max(2, R * 0.14);
                ctx.beginPath(); ctx.arc(cx, cy, R * 1.06, 0, 6.2832); ctx.stroke();

                // Everything in front of the shadow, drawn last.
                for (const [p, pos] of near) paint(p, pos);
                ctx.globalCompositeOperation = 'source-over';
            },
        };
    })();

    // A barred spiral seen face-on, turning with differential rotation so the
    // arms wind rather than spinning like a solid wheel.
    const galaxy = (() => {
        let ps = [];
        const ARMS = 2, TWIST = 2.9;
        return {
            id: 'galaxy',
            build() {
                const n = Math.max(400, Math.min(1100, Math.round(W * H / 1400)));
                ps = Array.from({ length: n }, () => {
                    const r = Math.pow(Math.random(), 0.62);          // denser toward the core
                    const arm = Math.floor(Math.random() * ARMS);
                    const spread = (1 - r) * 0.55 + 0.12;
                    return {
                        r,
                        th: (arm / ARMS) * 6.2832 + r * TWIST + rand(-spread, spread),
                        w: rand(0.35, 1),
                        tw: Math.random() * 6.28,
                    };
                });
            },
            draw(t) {
                const slow = reduceMotion() ? 0.2 : 1;
                const cx = W / 2, cy = H / 2;
                const maxR = Math.min(W, H) * 0.46;
                const acc = accentRGB();

                // Core glow.
                ctx.globalCompositeOperation = INK.blend();
                const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR * 0.42);
                g.addColorStop(0,   `rgba(${INK.coreWarm()},0.30)`);
                g.addColorStop(0.35,`rgba(${INK.coreMid()},0.11)`);
                g.addColorStop(1,   `rgba(${INK.coreEdge()},0)`);
                ctx.fillStyle = g;
                ctx.beginPath(); ctx.arc(cx, cy, maxR * 0.42, 0, 6.2832); ctx.fill();

                for (const p of ps) {
                    // Inner material laps the outer — that's what winds the arms.
                    const th = p.th + t * 0.00013 * slow / (0.22 + p.r);
                    const r = p.r * maxR;
                    const x = cx + Math.cos(th) * r;
                    const y = cy + Math.sin(th) * r * 0.52;      // slight tilt
                    if (x < -10 || x > W + 10 || y < -10 || y > H + 10) continue;
                    const tw = 0.75 + 0.25 * Math.sin(t * 0.0012 + p.tw);
                    const a = (0.55 - p.r * 0.30) * p.w * tw;
                    // Warm core, cooler accent-tinted arms.
                    const col = p.r < 0.28
                        ? INK.armWarm()
                        : (Math.random() < 0.5 ? acc : INK.armCool());
                    ctx.fillStyle = `rgba(${col},${a.toFixed(3)})`;
                    ctx.beginPath(); ctx.arc(x, y, (1.5 - p.r * 0.8) * p.w, 0, 6.2832); ctx.fill();
                }
                ctx.globalCompositeOperation = 'source-over';
            },
        };
    })();

    // Coloured gas banks with a star layer in front — slow, quiet, no particles
    // in the clouds themselves so it stays cheap at full screen.
    const nebula = (() => {
        let clouds = [], pts = [];
        return {
            id: 'nebula',
            build() {
                const acc = accentRGB();
                const pal = [acc, '236,72,153', '139,92,246', '56,189,248', '16,185,129'];
                clouds = Array.from({ length: 7 }, (_, i) => ({
                    hue: pal[i % pal.length],
                    r: Math.max(W, H) * rand(0.24, 0.52),
                    px: rand(0.05, 0.95), py: rand(0.05, 0.95),
                    ax: rand(0.04, 0.14), ay: rand(0.03, 0.11),
                    sp: rand(0.00004, 0.0001) * (i % 2 ? -1 : 1),
                    ph: rand(0, 6.28),
                }));
                const n = Math.max(90, Math.min(260, Math.round(W * H / 6000)));
                pts = Array.from({ length: n }, () => ({
                    x: Math.random() * W, y: Math.random() * H,
                    r: rand(0.4, 1.5), tw: Math.random() * 6.28,
                }));
            },
            draw(t) {
                const slow = reduceMotion() ? 0.25 : 1;
                ctx.globalCompositeOperation = INK.blend();
                for (const c of clouds) {
                    const k = t * c.sp * slow + c.ph;
                    const x = (c.px + Math.cos(k) * c.ax) * W;
                    const y = (c.py + Math.sin(k * 1.25) * c.ay) * H;
                    const g = ctx.createRadialGradient(x, y, 0, x, y, c.r);
                    g.addColorStop(0,    `rgba(${c.hue},0.13)`);
                    g.addColorStop(0.5,  `rgba(${c.hue},0.045)`);
                    g.addColorStop(1,    `rgba(${c.hue},0)`);
                    ctx.fillStyle = g;
                    ctx.beginPath(); ctx.arc(x, y, c.r, 0, 6.2832); ctx.fill();
                }
                for (const p of pts) {
                    const a = 0.35 + 0.4 * Math.sin(t * 0.0014 + p.tw);
                    ctx.fillStyle = `rgba(${INK.nebStar()},${Math.max(0, a).toFixed(3)})`;
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, p.r, 0, 6.2832);
                    ctx.fill();
                }
                ctx.globalCompositeOperation = 'source-over';
            },
        };
    })();

    // Hyperspace: stars streaking outward from the centre, the streak growing
    // as they get closer, so it reads as speed rather than as a static sunburst.
    const warp = (() => {
        let ps = [];
        const reseed = p => { p.a = Math.random() * 6.2832; p.z = rand(0.55, 1); p.w = rand(0.4, 1); };
        return {
            id: 'warp',
            build() {
                const n = Math.max(160, Math.min(420, Math.round(W * H / 3600)));
                ps = Array.from({ length: n }, () => { const p = {}; reseed(p); p.z = Math.random(); return p; });
            },
            draw() {
                const slow = reduceMotion() ? 0.18 : 1;
                const cx = W / 2, cy = H / 2;
                const span = Math.hypot(W, H) * 0.62;
                const acc = accentRGB();
                ctx.lineCap = 'round';
                for (const p of ps) {
                    p.z -= 0.0055 * slow;
                    if (p.z <= 0.03) reseed(p);
                    const near = 1 - p.z;                    // 0 far → 1 close
                    const r1 = span * near * near;
                    const r0 = Math.max(0, r1 - span * (0.02 + near * 0.20));
                    const ca = Math.cos(p.a), sa = Math.sin(p.a);
                    const a = Math.min(0.9, near * 1.3) * p.w;
                    if (a < 0.02) continue;
                    ctx.strokeStyle = near > 0.72
                        ? `rgba(${acc},${a.toFixed(3)})`
                        : `rgba(${INK.streak()},${a.toFixed(3)})`;
                    ctx.lineWidth = Math.max(0.6, near * 2.2 * p.w);
                    ctx.beginPath();
                    ctx.moveTo(cx + ca * r0, cy + sa * r0);
                    ctx.lineTo(cx + ca * r1, cy + sa * r1);
                    ctx.stroke();
                }
            },
        };
    })();

    const STYLES = { plexus, stars, blackhole, galaxy, nebula, warp, aurora, waves, embers };

    // ── Engine ─────────────────────────────────────────────────────────
    function resize() {
        const home = document.getElementById(HOME_ID);
        if (!home || !canvas) return;
        const rect = home.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        dpr = Math.min(2, window.devicePixelRatio || 1);
        W = rect.width; H = rect.height;
        canvas.width  = W * dpr;
        canvas.height = H * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        if (style) style.build();
    }

    function frame(t) {
        // Idle cheaply whenever the home view is hidden or the window is not
        // visible. The check is on the view, not the canvas: a fixed-position
        // element always reports offsetParent === null, which would idle the
        // loop forever and leave the background blank.
        const host = document.getElementById(HOME_ID);
        if (!canvas || !style || document.hidden || !host || host.offsetParent === null) {
            setTimeout(() => requestAnimationFrame(frame), 600);
            return;
        }
        if (t - lastFrame >= 1000 / FPS) {
            lastFrame = t;
            ctx.clearRect(0, 0, W, H);
            try { style.draw(t - t0); } catch (_) {}
        }
        requestAnimationFrame(frame);
    }

    // Public: switch style. Unknown id (or 'none') leaves the canvas blank.
    function setStyle(id) {
        styleId = id || 'plexus';
        style = STYLES[styleId] || null;
        if (canvas) canvas.style.display = style ? '' : 'none';
        // Wipe first either way — switching to 'none' used to leave the last
        // frame sitting on a hidden canvas.
        if (ctx && W && H) ctx.clearRect(0, 0, W, H);
        if (style && W && H) style.build();
    }

    function init() {
        const home = document.getElementById(HOME_ID);
        if (!home) return;
        canvas = document.createElement('canvas');
        canvas.id = 'home-neural-bg';
        canvas.style.cssText = 'position:fixed;inset:0;z-index:-1;pointer-events:none';
        home.prepend(canvas);
        ctx = canvas.getContext('2d');

        // Settings live in a file and load a moment later, so start on the
        // default; initSettings() calls setHomeBackground() with the saved
        // choice as soon as it has read it.
        setStyle('plexus');
        resize();

        // rAF-wrapped: resizing the canvas inside the RO callback would
        // trigger the benign "ResizeObserver loop" warning.
        new ResizeObserver(() => requestAnimationFrame(resize)).observe(home);

        requestAnimationFrame(frame);

        window.setHomeBackground = setStyle;
        window.homeBackgroundStyles = Object.keys(STYLES);
        // Test/debug hook — paints one frame regardless of visibility
        window.__neuralBgDraw = (t) => {
            if (!ctx || !style) return 0;
            ctx.clearRect(0, 0, W, H);
            style.draw((t || performance.now()) - t0);
            return styleId;
        };
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
