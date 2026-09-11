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
    // User-adjustable strength (Appearance → Background intensity). 1 = as
    // designed; below 1 fades, above 1 stamps the scene again for more ink.
    let intensity = 1;
    // How dark the page is: 1 on a black page, 0 on a light one. Scenes use it
    // to push alpha up on near-black themes, where the same strokes that read
    // fine on slate almost vanish.
    function pageDarkness() {
        try {
            const v = getComputedStyle(document.documentElement).getPropertyValue('--bg-base').trim();
            const m = v.match(/^#([0-9a-f]{6})$/i);
            if (m) {
                const n = parseInt(m[1], 16);
                const l = (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
                return Math.max(0, Math.min(1, 1 - l * 6));   // <#2a2a2a ≈ 1, slate ≈ 0.7
            }
        } catch (_) {}
        return 0.7;
    }
    const INK = {
        // On light themes the scenes are drawn in saturated colour — indigo and
        // blue stars, orange embers — never grey, which read as dirt on white.
        star:      () => isLight() ? '99,102,241'  : '214,228,255',   // small distant stars
        starHi:    () => isLight() ? '37,99,235'   : '226,236,255',   // brighter / bent stars
        nebStar:   () => isLight() ? '124,58,237'  : '235,243,255',
        streak:    () => isLight() ? '59,130,246'  : '215,230,255',   // warp lines
        coreWarm:  () => isLight() ? '234,88,12'   : '255,241,214',   // galaxy core
        coreMid:   () => isLight() ? '245,158,11'  : '255,196,120',
        coreEdge:  () => isLight() ? '251,191,36'  : '255,170,90',
        armWarm:   () => isLight() ? '234,88,12'   : '255,232,196',
        armCool:   () => isLight() ? '37,99,235'   : '186,214,255',
        ring:      () => isLight() ? '234,88,12'   : '255,214,160',   // black-hole photon ring
        ringSoft:  () => isLight() ? '249,115,22'  : '255,180,90',
        emberGlow: () => isLight() ? '234,88,12'   : '251,146,60',
        ember:     () => isLight() ? '249,115,22'  : '253,205,140',
        // Additive blending brightens toward white — invisible on a light page.
        blend:     () => isLight() ? 'multiply' : 'lighter',
        // Light pages need a little more opacity for the same presence.
        boost:     () => isLight() ? 1.35 : 1,
    };

    // ── Styles ─────────────────────────────────────────────────────────
    // Each has: build() to (re)seed for the current size, draw(t) to paint.

    // Nodes drifting in a slowly rotating 3D volume, projected with
    // perspective. Links fade with distance and depth.
    const plexus = (() => {
        const LINK = 265, DEPTH = 700, FOCAL = 950;
        let nodes = [], rotY = 0, rotX = 0;
        // Palette follows the accent: the accent itself, a lighter tint of it,
        // and a few near-white highlight nodes. The old fixed purple + sky mix
        // clashed with neutral themes and with any accent that wasn't blue.
        const mix = (rgb, t, to = [255, 255, 255]) => rgb.split(',').map((c, i) => Math.round(+c + (to[i] - c) * t)).join(',');
        const hues = () => {
            const a = accentRGB();
            const light = isLight();
            return light
                ? [a, a, mix(a, 0.45, [30, 41, 59]), mix(a, 0.25, [79, 70, 229]), a]
                : [a, a, a, mix(a, 0.3), mix(a, 0.3)];
        };
        // Project a 3D point with the current rotation → { sx, sy, s }.
        function project(n) {
            const sy = Math.sin(rotY), cy = Math.cos(rotY);
            const sx = Math.sin(rotX), cx = Math.cos(rotX);
            let x = n.x * cy + n.z * sy;
            let z = -n.x * sy + n.z * cy;
            let y = n.y * cx - z * sx;
            z = n.y * sx + z * cx;
            const s = FOCAL / (FOCAL + z + DEPTH / 2);
            return { sx: W / 2 + x * s, sy: H / 2 + y * s, s };
        }
        // A node is only useful if it lands on the page: sample 3D positions
        // until the projection is on-screen. That is what keeps the rotating
        // field covering the whole canvas instead of clumping at the edges.
        function seed(n, fadeIn) {
            for (let tries = 0; tries < 40; tries++) {
                n.x = (Math.random() - 0.5) * W * 2.2;
                n.y = (Math.random() - 0.5) * H * 2.2;
                n.z = (Math.random() - 0.5) * DEPTH;
                const p = project(n);
                if (p.sx > -10 && p.sx < W + 10 && p.sy > -10 && p.sy < H + 10) break;
            }
            n.fade = fadeIn ? 0 : 1;
            return n;
        }
        return {
            id: 'plexus',
            build() {
                const HU = hues();
                const count = Math.max(80, Math.min(200, Math.round(W * H / 7800)));
                nodes = Array.from({ length: count }, () => seed({
                    vx: rand(-0.11, 0.11), vy: rand(-0.11, 0.11), vz: rand(-0.14, 0.14),
                    hue: HU[Math.floor(Math.random() * HU.length)],
                    r: 2.2 + Math.random() * 2.6,
                }, false));
            },
            draw() {
                const slow = reduceMotion() ? 0.25 : 1;
                // Near-black pages get brighter links and nodes (up to ~2.2×).
                const boost = isLight() ? 1 : 1.15 + 1.05 * pageDarkness();
                rotY += 0.00042 * slow; rotX = Math.sin(rotY * 0.6) * 0.22;
                const proj = new Array(nodes.length);
                const M = 60;                                   // off-screen margin before re-seeding
                for (let i = 0; i < nodes.length; i++) {
                    const n = nodes[i];
                    n.x += n.vx * slow; n.y += n.vy * slow; n.z += n.vz * slow;
                    if (Math.abs(n.z) > DEPTH / 2) n.vz *= -1;
                    let p = project(n);
                    // Drifted (or rotated) out of view: come back somewhere visible,
                    // fading in so nothing pops.
                    if (p.sx < -M || p.sx > W + M || p.sy < -M || p.sy > H + M) { seed(n, true); p = project(n); }
                    if (n.fade < 1) n.fade = Math.min(1, n.fade + 0.02 * slow);
                    p.s *= n.fade;
                    proj[i] = p;
                }
                ctx.lineWidth = isLight() ? 1 : 1.25;
                const linkHue = accentRGB();
                for (let i = 0; i < nodes.length; i++) {
                    for (let j = i + 1; j < nodes.length; j++) {
                        const dx = proj[i].sx - proj[j].sx, dy = proj[i].sy - proj[j].sy;
                        const d2 = dx * dx + dy * dy;
                        if (d2 > LINK * LINK) continue;
                        const d = Math.sqrt(d2);
                        const a = (1 - d / LINK) * (isLight() ? 0.26 : 0.40) * boost * Math.min(proj[i].s, proj[j].s);
                        // Anything fainter than this is a grey smear — either draw
                        // a line that reads, or don't draw it. Links take the accent
                        // (not the node hue) so none come out grey.
                        if (a < 0.12) continue;
                        ctx.strokeStyle = `rgba(${linkHue},${Math.min(1, a).toFixed(3)})`;
                        ctx.beginPath();
                        ctx.moveTo(proj[i].sx, proj[i].sy);
                        ctx.lineTo(proj[j].sx, proj[j].sy);
                        ctx.stroke();
                    }
                }
                for (let i = 0; i < nodes.length; i++) {
                    const p = proj[i], r = nodes[i].r * p.s;
                    ctx.fillStyle = `rgba(${nodes[i].hue},${Math.min(1, (0.10 * p.s + 0.03) * boost).toFixed(3)})`;
                    ctx.beginPath(); ctx.arc(p.sx, p.sy, Math.max(1, r * 2.6), 0, 6.2832); ctx.fill();
                    ctx.fillStyle = `rgba(${nodes[i].hue},${Math.min(1, (0.68 * p.s + 0.12) * boost).toFixed(3)})`;
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
                    const light = isLight();
                    // On white the wide accent halos read as bubbles: keep the
                    // stars crisp and small there, with only a faint glow.
                    const r = (p.big ? 2.3 : 1.35) * (0.65 + (1 - p.z) * 1.5) * (light ? 0.7 : 1);
                    if (p.big) {
                        ctx.fillStyle = `rgba(${a},${(alpha * (light ? 0.07 : 0.20)).toFixed(3)})`;
                        ctx.beginPath(); ctx.arc(sx, sy, r * (light ? 3 : 6), 0, 6.2832); ctx.fill();
                    }
                    // Light: a mix of indigo, blue and violet so the field has depth.
                    const small = light ? (p.tw < 2.1 ? '79,70,229' : p.tw < 4.2 ? '37,99,235' : '124,58,237') : INK.star();
                    ctx.fillStyle = p.big
                        ? `rgba(${a},${alpha.toFixed(3)})`
                        : `rgba(${small},${(alpha * 0.85).toFixed(3)})`;
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
                    ctx.fillStyle = `rgba(${INK.emberGlow()},${(a * 0.14).toFixed(3)})`;
                    ctx.beginPath(); ctx.arc(sx, sy, p.r * 5, 0, 6.2832); ctx.fill();
                    ctx.fillStyle = `rgba(${INK.ember()},${a.toFixed(3)})`;
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
                const light = isLight();

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

                // A continuous glowing band under the particles, so the disk
                // reads as a solid ring of hot gas rather than scattered dots —
                // essential on a light page, and a richer look on dark.
                ctx.globalCompositeOperation = INK.blend();
                ctx.save();
                ctx.translate(cx, cy); ctx.scale(1, TILT);
                const band = ctx.createRadialGradient(0, 0, R * 1.05, 0, 0, R * 3.2);
                band.addColorStop(0,    `rgba(${light ? '234,88,12' : '255,214,160'},${light ? 0.55 : 0.55})`);
                band.addColorStop(0.18, `rgba(${light ? '245,158,11' : '255,180,90'},${light ? 0.42 : 0.38})`);
                band.addColorStop(0.55, `rgba(${light ? '251,146,60' : '255,140,60'},${light ? 0.16 : 0.12})`);
                band.addColorStop(1,    'rgba(255,140,60,0)');
                ctx.fillStyle = band;
                ctx.beginPath(); ctx.arc(0, 0, R * 3.2, 0, 6.2832); ctx.fill();
                ctx.restore();

                const near = [];
                for (const p of disk) {
                    const pos = place(p);
                    if (pos.behind) paint(p, pos); else near.push([p, pos]);
                }
                ctx.globalCompositeOperation = 'source-over';

                // The shadow itself, with a soft rim so it doesn't look cut out.
                // On light the wide soft rim smeared into a grey halo; keep it tight there.
                const rim = light ? 1.12 : 1.35;
                const g = ctx.createRadialGradient(cx, cy, R * 0.6, cx, cy, R * rim);
                g.addColorStop(0, '#000');
                g.addColorStop(light ? 0.86 : 0.72, '#000');
                g.addColorStop(1, 'rgba(0,0,0,0)');
                ctx.fillStyle = g;
                ctx.beginPath(); ctx.arc(cx, cy, R * rim, 0, 6.2832); ctx.fill();

                // Photon ring — drawn opaque (source-over) so it sits crisply on
                // the shadow's edge on both themes.
                ctx.strokeStyle = `rgba(${INK.ring()},${light ? 0.9 : 0.7})`;
                ctx.lineWidth = Math.max(1.2, R * 0.05);
                ctx.beginPath(); ctx.arc(cx, cy, R * 1.02, 0, 6.2832); ctx.stroke();
                ctx.globalCompositeOperation = INK.blend();
                ctx.strokeStyle = `rgba(${INK.ringSoft()},${light ? 0.35 : 0.22})`;
                ctx.lineWidth = Math.max(2, R * 0.16);
                ctx.beginPath(); ctx.arc(cx, cy, R * 1.08, 0, 6.2832); ctx.stroke();

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

    // Flowing mesh gradient — four large colour fields whose centres orbit
    // slowly, blended additively (dark) or multiplied (light). Reads as a
    // macOS wallpaper on either theme, so the light rendition is the same.
    const mesh = (() => {
        let fields = [];
        return {
            id: 'mesh',
            build() {
                const a = accentRGB();
                const pal = [a, '56,189,248', '167,139,250', '244,114,182'];
                fields = pal.map((hue, i) => ({
                    hue, r: Math.max(W, H) * rand(0.55, 0.85),
                    cx: rand(0.15, 0.85), cy: rand(0.15, 0.85),
                    ax: rand(0.12, 0.28), ay: rand(0.10, 0.24),
                    sp: rand(0.00005, 0.00011) * (i % 2 ? -1 : 1), ph: rand(0, 6.28),
                }));
            },
            draw(t) {
                const slow = reduceMotion() ? 0.25 : 1;
                const light = isLight();
                ctx.globalCompositeOperation = light ? 'multiply' : 'lighter';
                for (const f of fields) {
                    const k = t * f.sp * slow + f.ph;
                    const x = (f.cx + Math.cos(k) * f.ax) * W, y = (f.cy + Math.sin(k * 1.4) * f.ay) * H;
                    const g = ctx.createRadialGradient(x, y, 0, x, y, f.r);
                    g.addColorStop(0,   `rgba(${f.hue},${light ? 0.30 : 0.22})`);
                    g.addColorStop(0.5, `rgba(${f.hue},${light ? 0.12 : 0.08})`);
                    g.addColorStop(1,   `rgba(${f.hue},0)`);
                    ctx.fillStyle = g;
                    ctx.beginPath(); ctx.arc(x, y, f.r, 0, 6.2832); ctx.fill();
                }
                ctx.globalCompositeOperation = 'source-over';
            },
        };
    })();

    // Fireflies — a few dozen soft points wandering with gentle pulses.
    const fireflies = (() => {
        let ps = [];
        return {
            id: 'fireflies',
            build() {
                const a = accentRGB();
                const pal = [a, '253,224,71', '134,239,172', '125,211,252'];
                const count = Math.max(24, Math.min(70, Math.round(W * H / 16000)));
                ps = Array.from({ length: count }, () => ({
                    x: Math.random() * W, y: Math.random() * H,
                    vx: rand(-0.12, 0.12), vy: rand(-0.12, 0.12), turn: rand(-0.002, 0.002),
                    r: rand(1.7, 3.4), hue: pal[Math.floor(Math.random() * pal.length)],
                    ph: rand(0, 6.28), speed: rand(0.0008, 0.0016),
                }));
            },
            draw(t) {
                const slow = reduceMotion() ? 0.25 : 1;
                const light = isLight();
                for (const p of ps) {
                    const ang = Math.atan2(p.vy, p.vx) + p.turn * slow;
                    const sp = Math.hypot(p.vx, p.vy);
                    p.vx = Math.cos(ang) * sp; p.vy = Math.sin(ang) * sp;
                    p.x += p.vx * slow; p.y += p.vy * slow;
                    if (p.x < -20) p.x = W + 20; else if (p.x > W + 20) p.x = -20;
                    if (p.y < -20) p.y = H + 20; else if (p.y > H + 20) p.y = -20;
                    const pulse = 0.5 + 0.5 * Math.sin(t * p.speed + p.ph);
                    const a = (light ? 0.7 : 0.6) * (0.35 + 0.65 * pulse);
                    ctx.fillStyle = `rgba(${p.hue},${(a * 0.18).toFixed(3)})`;
                    ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 7, 0, 6.2832); ctx.fill();
                    ctx.fillStyle = `rgba(${p.hue},${a.toFixed(3)})`;
                    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.2832); ctx.fill();
                }
            },
        };
    })();

    // Dots — a quiet lattice with a soft band of light sweeping across it.
    const dots = {
        id: 'dots',
        build() {},
        draw(t) {
            const slow = reduceMotion() ? 0.25 : 1;
            const light = isLight();
            const a = accentRGB();
            const STEP = 26;
            const sweep = ((t * 0.00009 * slow) % 1.6) - 0.3;     // −0.3 … 1.3 across the width
            for (let y = STEP / 2; y < H; y += STEP) {
                for (let x = STEP / 2; x < W; x += STEP) {
                    const dx = x / W - sweep, dy = (y / H - 0.5) * 0.35;
                    const d = Math.sqrt(dx * dx + dy * dy);
                    const glow = Math.max(0, 1 - d / 0.28);
                    const baseA = light ? 0.16 : 0.10;
                    if (glow > 0.02) {
                        ctx.fillStyle = `rgba(${a},${(0.16 + glow * (light ? 0.7 : 0.75)).toFixed(3)})`;
                        ctx.beginPath(); ctx.arc(x, y, 1.2 + glow * 1.6, 0, 6.2832); ctx.fill();
                    } else {
                        ctx.fillStyle = light ? `rgba(0,0,0,${baseA})` : `rgba(255,255,255,${baseA})`;
                        ctx.beginPath(); ctx.arc(x, y, 1.2, 0, 6.2832); ctx.fill();
                    }
                }
            }
        },
    };

    const STYLES = { plexus, stars, blackhole, galaxy, nebula, warp, aurora, waves, embers, mesh, fireflies, dots };

    // ── Light-theme renditions ──────────────────────────────────────────
    // The scenes above are night skies; drawn as dark specks on a white page
    // they read as dirt, not stars. On light themes each style is replaced by
    // a wash: a few large, slow-drifting colour fields in that style's palette
    // (the way macOS wallpapers do it), plus soft bokeh discs where the dark
    // version had particles. Multiply blending keeps overlaps rich instead of
    // bleaching toward white. Same ids, so the picker and settings are
    // untouched — only what gets painted changes with the theme.
    const LIGHT_PALETTES = {
        plexus:    () => [accentRGB(), '99,102,241', '56,189,248'],
        stars:     () => ['56,189,248', '129,140,248', accentRGB()],
        blackhole: () => ['251,146,60', '248,113,113', '129,140,248'],
        galaxy:    () => ['251,191,36', '56,189,248', '167,139,250'],
        nebula:    () => ['244,114,182', '56,189,248', '167,139,250'],
        warp:      () => ['56,189,248', '34,211,238', '129,140,248'],
        aurora:    () => [accentRGB(), '139,92,246', '56,189,248', '16,185,129'],
        waves:     () => [accentRGB(), '56,189,248', '99,102,241'],
        embers:    () => ['251,146,60', '253,186,116', '244,114,182'],
    };
    // Which styles get bokeh on top of the wash, and how it moves.
    const LIGHT_BOKEH = {};   // the real scene now draws on top of the wash

    function makeLightScene(id) {
        let blobs = [], bokeh = [];
        return {
            id: `${id}-light`,
            build() {
                const pal = (LIGHT_PALETTES[id] || LIGHT_PALETTES.aurora)();
                const R = Math.max(W, H);
                blobs = pal.map((hue, i) => ({
                    hue,
                    r: R * rand(0.38, 0.62),
                    px: rand(0.12, 0.88), py: rand(0.10, 0.90),
                    ax: rand(0.08, 0.22), ay: rand(0.06, 0.18),
                    sp: rand(0.00004, 0.00009) * (i % 2 ? -1 : 1),
                    ph: rand(0, 6.28),
                    a: 0.34 + (i === 0 ? 0.08 : 0),
                }));
                const mode = LIGHT_BOKEH[id];
                const count = mode ? Math.max(14, Math.min(34, Math.round(W * H / 26000))) : 0;
                bokeh = Array.from({ length: count }, () => ({
                    x: Math.random() * W, y: Math.random() * H,
                    r: rand(14, 54), hue: pal[Math.floor(Math.random() * pal.length)],
                    vx: rand(-0.06, 0.06), vy: mode === 'rise' ? rand(-0.16, -0.05) : rand(-0.05, 0.05),
                    ph: rand(0, 6.28), a: rand(0.07, 0.15),
                }));
            },
            draw(t) {
                const slow = reduceMotion() ? 0.25 : 1;
                ctx.globalCompositeOperation = 'multiply';
                for (const b of blobs) {
                    const k = t * b.sp * slow + b.ph;
                    const cx = (b.px + Math.cos(k) * b.ax) * W;
                    const cy = (b.py + Math.sin(k * 1.3) * b.ay) * H;
                    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, b.r);
                    g.addColorStop(0,    `rgba(${b.hue},${b.a.toFixed(3)})`);
                    g.addColorStop(0.5,  `rgba(${b.hue},${(b.a * 0.38).toFixed(3)})`);
                    g.addColorStop(1,    `rgba(${b.hue},0)`);
                    ctx.fillStyle = g;
                    ctx.beginPath(); ctx.arc(cx, cy, b.r, 0, 6.2832); ctx.fill();
                }
                for (const p of bokeh) {
                    p.x += p.vx * slow; p.y += p.vy * slow;
                    if (p.y < -p.r) { p.y = H + p.r; p.x = Math.random() * W; }
                    if (p.y > H + p.r) p.y = -p.r;
                    if (p.x < -p.r) p.x = W + p.r; else if (p.x > W + p.r) p.x = -p.r;
                    const a = p.a * (0.7 + 0.3 * Math.sin(t * 0.0009 + p.ph));
                    const g = ctx.createRadialGradient(p.x, p.y, p.r * 0.55, p.x, p.y, p.r);
                    g.addColorStop(0, `rgba(${p.hue},${a.toFixed(3)})`);
                    g.addColorStop(1, `rgba(${p.hue},0)`);
                    ctx.fillStyle = g;
                    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.2832); ctx.fill();
                }
                ctx.globalCompositeOperation = 'source-over';
            },
        };
    }
    // On light themes the real scene is drawn over a faint wash in its own
    // palette: the wash gives the page colour, the scene stays recognisable.
    // Mesh, fireflies and dots are already theme-aware and skip the wash.
    const LIGHT_STYLES = {};
    const SELF_THEMED = new Set(['mesh', 'fireflies', 'dots']);
    const LIGHT_STRENGTH = { plexus: 0.62, warp: 0.75, waves: 0.85 };
    // The scenes were tuned as white-on-black: many stars sit at 0.2–0.5
    // alpha, which is plenty against black and nothing against white. So on
    // light themes the scene is drawn to an offscreen layer and stamped onto
    // the page three times with multiply — alpha compounds (0.3 → ~0.66) and
    // every dot, line and spark comes through in saturated colour. The scene
    // code itself stays untouched.
    let layer = null, layerCtx = null;
    function ensureLayer() {
        if (!layer) { layer = document.createElement('canvas'); layerCtx = layer.getContext('2d'); }
        if (layer.width !== canvas.width || layer.height !== canvas.height) {
            layer.width = canvas.width; layer.height = canvas.height;
        }
        layerCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    for (const id of Object.keys(STYLES)) {
        if (SELF_THEMED.has(id)) { LIGHT_STYLES[id] = STYLES[id]; continue; }
        const wash = makeLightScene(id), scene = STYLES[id];
        LIGHT_STYLES[id] = {
            id: `${id}-light`,
            build() { wash.build(); scene.build(); },
            draw(t) {
                ctx.globalAlpha = 0.38; wash.draw(t); ctx.globalAlpha = 1;
                ensureLayer();
                layerCtx.clearRect(0, 0, W, H);
                const main = ctx; ctx = layerCtx;          // scenes draw through the module's ctx
                try { scene.draw(t); } finally { ctx = main; }
                ctx.save();
                ctx.setTransform(1, 0, 0, 1, 0, 0);
                ctx.globalCompositeOperation = 'multiply';
                // Twice: once in place, once a pixel over — deepens the colour
                // and fattens the 1–2px particles the scenes were tuned with
                // for black skies, without turning them into blobs.
                // Line-based scenes carry more ink than particle ones; ease them.
                const k = LIGHT_STRENGTH[id] ?? 1;
                ctx.globalAlpha = k;
                ctx.drawImage(layer, 0, 0);
                ctx.globalAlpha = 0.6 * k;
                ctx.drawImage(layer, dpr, dpr);
                ctx.restore();
            },
        };
    }

    // The theme can change while the home page is open; pick the right
    // rendition each frame and reseed when it flips.
    let paintedLight = null;
    function activeStyle() {
        const light = isLight();
        const st = light ? LIGHT_STYLES[styleId] : STYLES[styleId];
        if (st && paintedLight !== light) { paintedLight = light; if (W && H) st.build(); }
        return st || null;
    }

    // ── Engine ─────────────────────────────────────────────────────────
    function resize() {
        const home = document.getElementById(HOME_ID);
        if (!home || !canvas) return;
        const rect = home.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        dpr = Math.min(2, window.devicePixelRatio || 1);
        W = rect.width; H = rect.height;
        // A <canvas> is a replaced element: `inset:0` does not stretch it, so
        // the CSS box must be set explicitly to the view's rectangle. Without
        // this the canvas sat at the top of the window at its buffer size,
        // leaving the bottom of the home page unpainted.
        canvas.style.top    = `${rect.top}px`;
        canvas.style.left   = `${rect.left}px`;
        canvas.style.width  = `${W}px`;
        canvas.style.height = `${H}px`;
        canvas.width  = W * dpr;
        canvas.height = H * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        if (style) style.build();
        if (LIGHT_STYLES[styleId]) LIGHT_STYLES[styleId].build();
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
            try { const st = activeStyle(); if (st) drawWithIntensity(st, t - t0); } catch (_) {}
        }
        requestAnimationFrame(frame);
    }

    // Paint a style at the current intensity. At exactly 1 the scene draws
    // straight to the canvas; otherwise it goes through an offscreen layer
    // that is composited back with the chosen alpha — and stamped once more
    // per whole step above 1, so "200%" genuinely doubles the ink.
    let iLayer = null, iCtx = null;
    function drawWithIntensity(st, t) {
        if (Math.abs(intensity - 1) < 0.01) { st.draw(t); return; }
        if (!iLayer) { iLayer = document.createElement('canvas'); iCtx = iLayer.getContext('2d'); }
        if (iLayer.width !== canvas.width || iLayer.height !== canvas.height) { iLayer.width = canvas.width; iLayer.height = canvas.height; }
        iCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        iCtx.clearRect(0, 0, W, H);
        const main = ctx; ctx = iCtx;
        try { st.draw(t); } finally { ctx = main; }
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        let k = intensity;
        ctx.globalCompositeOperation = isLight() ? 'multiply' : 'source-over';
        while (k > 0) { ctx.globalAlpha = Math.min(1, k); ctx.drawImage(iLayer, 0, 0); k -= 1; }
        ctx.restore();
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
        if (style && W && H && LIGHT_STYLES[styleId]) LIGHT_STYLES[styleId].build();
        paintedLight = null;
    }

    function init() {
        const home = document.getElementById(HOME_ID);
        if (!home) return;
        canvas = document.createElement('canvas');
        canvas.id = 'home-neural-bg';
        canvas.style.cssText = 'position:fixed;top:0;left:0;z-index:-1;pointer-events:none';
        home.prepend(canvas);
        ctx = canvas.getContext('2d');

        // Settings live in a file and load a moment later, so start on the
        // default; initSettings() calls setHomeBackground() with the saved
        // choice as soon as it has read it.
        setStyle('plexus');
        resize();

        // rAF-wrapped: resizing the canvas inside the RO callback would
        // trigger the benign "ResizeObserver loop" warning.
        new ResizeObserver(() => requestAnimationFrame(() => {
            resize();
            // Paint straight away so a window resize never shows a bare strip.
            try { const st = activeStyle(); if (st && ctx) { ctx.clearRect(0, 0, W, H); st.draw(performance.now() - t0); } } catch (_) {}
        })).observe(home);
        window.addEventListener('resize', () => requestAnimationFrame(resize));

        requestAnimationFrame(frame);

        window.setHomeBackground = setStyle;
        window.setHomeBackgroundIntensity = k => { intensity = Math.max(0.25, Math.min(2.5, Number(k) || 1)); };
        window.homeBackgroundStyles = Object.keys(STYLES);
        // Real thumbnail of a style for the Appearance picker: the engine is
        // pointed at an offscreen canvas of the swatch size, the style is
        // reseeded for it, a frame is drawn through the same dark/light
        // pipeline the page uses, then everything is restored. Returns a data
        // URL, or null if the style is unknown.
        window.renderHomeBackgroundThumb = function (id, w, h) {
            const dark = STYLES[id], lightSt = LIGHT_STYLES[id];
            if (!dark) return null;
            const off = document.createElement('canvas');
            const scale = Math.min(2, window.devicePixelRatio || 1);
            off.width = w * scale; off.height = h * scale;
            const octx = off.getContext('2d');
            // The scenes have minimum particle counts tuned for a full window;
            // at swatch size that is a solid mass. Let the scene believe the
            // canvas is 3× larger and draw it scaled down.
            const V = 5;
            octx.setTransform(scale / V, 0, 0, scale / V, 0, 0);
            const saved = { canvas, ctx, W, H, dpr, layer, layerCtx, paintedLight };
            canvas = off; ctx = octx; W = w * V; H = h * V; dpr = scale / V; layer = null; layerCtx = null;
            try {
                const light = isLight();
                const base = getComputedStyle(document.documentElement).getPropertyValue('--bg-base').trim() || (light ? '#f5f5f7' : '#070b18');
                octx.fillStyle = base; octx.fillRect(0, 0, W, H);
                const st = light ? lightSt : dark;
                st.build();
                // A few seconds in, so streaks, sweeps and drifts have developed.
                st.draw(6000);
                return off.toDataURL('image/png');
            } catch (e) { console.warn('[home-bg] thumb', id, e); return null; }
            finally {
                ({ canvas, ctx, W, H, dpr, layer, layerCtx, paintedLight } = saved);
                // Reseed the live scene at the real size.
                const live = activeStyle(); if (live && W && H) live.build();
            }
        };
        // Test/debug hook — paints one frame regardless of visibility
        window.__neuralBgDraw = (t) => {
            const st = activeStyle();
            if (!ctx || !st) return 0;
            ctx.clearRect(0, 0, W, H);
            st.draw((t || performance.now()) - t0);
            return st.id;
        };
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
