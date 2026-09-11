// ── Galaxy — fully 3D Milky Way ⇄ detailed Solar System (three.js / WebGL) ───
// Two linked 3D scenes sharing one renderer. Free-roaming space map:
//   • In the GALAXY, drag to orbit, right-drag to pan anywhere, and click
//     the Magellanic Cloud galaxies to fly over to them. Clicking the
//     ☉ Sun marker (or the header button) opens the Solar System.
//   • In the SOLAR SYSTEM, the header button returns to the galaxy.
//
//   GALAXY — particle Milky Way: 4 spiral arms with dust lanes, nebulae, a
//            barred golden core (Sgr A*), named arms, globular clusters and
//            the Large/Small Magellanic Clouds off in the distance.
//   SOLAR  — Sun + 8 planets (+ Pluto), real axial tilts, Earth clouds &
//            atmosphere, Galilean moons, Titan, Triton, Phobos/Deimos,
//            Saturn + Uranus rings, asteroid + Kuiper belts, and a comet
//            with a live particle tail. Click a body for its info card.
//
// Depends on global THREE (vendor/three.min.js) + THREE.OrbitControls.
// Exposes: renderGalaxySim / stopGalaxySim / galaxyToggleMode /
//          galaxySetSpin / galaxySetStars / galaxyResetView / galaxyCloseInfo.
'use strict';
(function () {

const TWO_PI = Math.PI * 2;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const rnd = (a, b) => a + Math.random() * (b - a);
let T = null;

let renderer, container, raf = null, last = 0, ro = null;
let mode = 'galaxy';
let spin = 1, starTarget = 40000;
let starTex, softTex;
let _transitioning = false;

// ── C++ engine (cpp/galaxy.cpp → js/wasm/galaxy.wasm) ───────────────────
// Generates the galaxy point cloud and animates the comet tail in native
// code; buffers live in wasm memory and three.js renders zero-copy views
// over them. If it fails to load, the original JS paths below take over.
let CPP = null;
const _f32 = (ptr, n) => new Float32Array(CPP.memory.buffer, ptr, n);
(async function _loadCpp() {
    try {
        const cand = [];
        if (typeof __dirname !== 'undefined') {
            cand.push(path.join(__dirname, 'js', 'wasm', 'galaxy.wasm'));
            cand.push(path.join(__dirname, 'wasm', 'galaxy.wasm'));
        }
        const wp = cand.find(p => { try { return fs.existsSync(p); } catch (_) { return false; } });
        if (!wp) return;
        const mod = await WebAssembly.compile(fs.readFileSync(wp));
        // Standalone wasm may import a few WASI stubs it never calls
        const imp = {};
        for (const d of WebAssembly.Module.imports(mod)) {
            if (!imp[d.module]) imp[d.module] = {};
            imp[d.module][d.name] = () => 0;
        }
        const inst = await WebAssembly.instantiate(mod, imp);
        if (inst.exports._initialize) inst.exports._initialize();
        CPP = inst.exports;
    } catch (e) {
        console.warn('[galaxy] C++ engine unavailable, using JS fallback:', e);
        CPP = null;
    }
})();

const G = { scene:null, camera:null, controls:null, points:null, dust:null, group:null, sunMarker:null, pickables:[] };
const S = { scene:null, camera:null, controls:null, planets:[], sun:null, belt:null, kuiper:null, comet:null };

// Camera fly-to animation + follow state (solar scene)
let _fly = null;
let _follow = null;

/* ════════════════════════════════════════════════════════════
   Shared sprite textures
════════════════════════════════════════════════════════════ */
function _makeStarTex() {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.85)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.25)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; return t;
}
function _makeSoftTex() {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.4)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; return t;
}
function _glowSprite(color, size, opacity) {
    const s = new T.Sprite(new T.SpriteMaterial({
        map: softTex, color, transparent: true, opacity: opacity ?? 1,
        depthWrite: false, blending: T.AdditiveBlending }));
    s.scale.set(size, size, 1);
    return s;
}

/* ════════════════════════════════════════════════════════════
   GALAXY scene
════════════════════════════════════════════════════════════ */
const GAL_R = 120, BULGE_R = 22, SUN_GR = 64;
const ARMS = 4, WIND = 3.4;
const ARM_NAMES = ['Perseus Arm', 'Scutum–Centaurus Arm', 'Sagittarius Arm', 'Norma Arm'];

function _armPoint(arm, t, spreadMul) {
    const r = BULGE_R * 0.5 + t * (GAL_R - BULGE_R * 0.5);
    const spread = (0.55 - 0.4 * t) * (Math.random() - 0.5) * (spreadMul || 1);
    const a = arm * (TWO_PI / ARMS) + WIND * (r / GAL_R) + spread;
    return { r, a };
}

function _buildGalaxyPoints() {
    if (G.points) { G.group.remove(G.points); G.points.geometry.dispose(); G.points.material.dispose(); }
    if (G.dust)   { G.group.remove(G.dust);   G.dust.geometry.dispose();   G.dust.material.dispose(); }

    const N = starTarget;
    let pos, col, dp;
    if (CPP) {
        // C++ engine fills the whole point cloud in wasm memory
        const n = CPP.gal_build(N, (Math.random() * 0xffffffff) >>> 0);
        pos = _f32(CPP.gal_star_pos(), n * 3);
        col = _f32(CPP.gal_star_col(), n * 3);
        dp  = _f32(CPP.gal_dust_pos(), CPP.gal_dust_count() * 3);
    } else {
        ({ pos, col, dp } = _buildGalaxyPointsJS(N));
    }

    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(pos, 3));
    geo.setAttribute('color', new T.BufferAttribute(col, 3));
    G.points = new T.Points(geo, new T.PointsMaterial({
        size: 1.3, map: starTex, vertexColors: true, transparent: true,
        depthWrite: false, blending: T.AdditiveBlending, sizeAttenuation: true }));
    G.group.add(G.points);

    // Dust lanes
    const dg = new T.BufferGeometry(); dg.setAttribute('position', new T.BufferAttribute(dp, 3));
    G.dust = new T.Points(dg, new T.PointsMaterial({
        size: 2.6, map: starTex, color: 0x07050a, transparent: true,
        opacity: 0.55, depthWrite: false }));
    G.group.add(G.dust);
}

// JS fallback for when the C++ engine isn't available
function _buildGalaxyPointsJS(N) {
    const pos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    const c = new T.Color();
    let k = 0;

    // Spiral-arm stars (72%)
    const armN = Math.floor(N * 0.72 / ARMS);
    for (let arm = 0; arm < ARMS; arm++) {
        for (let i = 0; i < armN; i++, k++) {
            const t = Math.pow(Math.random(), 0.5);
            const { r, a } = _armPoint(arm, t, 1);
            const thick = GAL_R * 0.045 * (1 - t * 0.7);
            pos[k*3]   = Math.cos(a) * r;
            pos[k*3+1] = (Math.random() - 0.5) * thick;
            pos[k*3+2] = Math.sin(a) * r;
            const edge = r / GAL_R;
            const blue = Math.random() < 0.18 + edge * 0.25;
            if (blue) c.setHSL(0.58 + Math.random() * 0.06, 0.9, 0.62 + Math.random() * 0.22);
            else      c.setHSL(0.09 + edge * 0.46, 0.8, 0.5 + Math.random() * 0.22);
            col[k*3] = c.r; col[k*3+1] = c.g; col[k*3+2] = c.b;
        }
    }
    // Scattered disc field stars (12%)
    const fieldEnd = k + Math.floor(N * 0.12);
    for (; k < fieldEnd; k++) {
        const t = Math.pow(Math.random(), 0.5);
        const r = t * GAL_R, a = Math.random() * TWO_PI;
        pos[k*3] = Math.cos(a) * r;
        pos[k*3+1] = (Math.random() - 0.5) * GAL_R * 0.05 * (1 - t * 0.6);
        pos[k*3+2] = Math.sin(a) * r;
        c.setHSL(0.08 + Math.random() * 0.5, 0.55, 0.45 + Math.random() * 0.2);
        col[k*3] = c.r; col[k*3+1] = c.g; col[k*3+2] = c.b;
    }
    // Barred bulge (rest)
    for (; k < N; k++) {
        const rr = Math.pow(Math.random(), 1.7) * BULGE_R;
        const u = Math.random() * TWO_PI, v = Math.acos(2 * Math.random() - 1);
        let bx = rr * Math.sin(v) * Math.cos(u) * 1.65;
        let bz = rr * Math.sin(v) * Math.sin(u) * 0.85;
        const ba = 0.5;
        pos[k*3]   = bx * Math.cos(ba) - bz * Math.sin(ba);
        pos[k*3+1] = rr * Math.cos(v) * 0.55;
        pos[k*3+2] = bx * Math.sin(ba) + bz * Math.cos(ba);
        c.setHSL(0.10 + Math.random() * 0.05, 0.9, 0.6 + Math.random() * 0.25);
        col[k*3] = c.r; col[k*3+1] = c.g; col[k*3+2] = c.b;
    }

    // Dust lanes
    const DN = Math.min(9000, N / 4 | 0);
    const dp = new Float32Array(DN * 3);
    for (let i = 0; i < DN; i++) {
        const arm = i % ARMS;
        const t = 0.12 + Math.pow(Math.random(), 0.7) * 0.85;
        const { r, a } = _armPoint(arm, t, 0.45);
        const aa = a - 0.10;
        dp[i*3] = Math.cos(aa) * r;
        dp[i*3+1] = (Math.random() - 0.5) * GAL_R * 0.02;
        dp[i*3+2] = Math.sin(aa) * r;
    }
    return { pos, col, dp };
}

// A small dense ball of old golden stars (globular cluster / dwarf galaxy core)
function _starBlob(n, radius, hueA, hueB, flatten) {
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    const c = new T.Color();
    for (let i = 0; i < n; i++) {
        const rr = Math.pow(Math.random(), 1.6) * radius;
        const u = Math.random() * TWO_PI, v = Math.acos(2 * Math.random() - 1);
        pos[i*3]   = rr * Math.sin(v) * Math.cos(u);
        pos[i*3+1] = rr * Math.cos(v) * (flatten || 1);
        pos[i*3+2] = rr * Math.sin(v) * Math.sin(u);
        c.setHSL(rnd(hueA, hueB), 0.65, rnd(0.55, 0.8));
        col[i*3]=c.r; col[i*3+1]=c.g; col[i*3+2]=c.b;
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(pos, 3));
    g.setAttribute('color', new T.BufferAttribute(col, 3));
    return new T.Points(g, new T.PointsMaterial({
        size: 0.9, map: starTex, vertexColors: true, transparent: true,
        depthWrite: false, blending: T.AdditiveBlending }));
}

function _buildGalaxy() {
    G.scene = new T.Scene();
    G.scene.background = new T.Color(0x02030a);
    G.group = new T.Group();
    G.scene.add(G.group);

    _buildGalaxyPoints();

    // Nebula clouds along the arms
    const NEB_COLORS = [0xff5f9e, 0x5aa0ff, 0xb06aff, 0xff8a5f];
    for (let i = 0; i < 42; i++) {
        const { r, a } = _armPoint(i % ARMS, rnd(0.2, 0.95), 0.5);
        const neb = _glowSprite(NEB_COLORS[i % NEB_COLORS.length], rnd(7, 17), 0.16);
        neb.position.set(Math.cos(a) * r, rnd(-1.5, 1.5), Math.sin(a) * r);
        G.group.add(neb);
    }
    // Hazy white sheen along the arms (milky glow)
    for (let i = 0; i < 24; i++) {
        const { r, a } = _armPoint(i % ARMS, rnd(0.15, 0.9), 0.3);
        const haze = _glowSprite(0xfff4e0, rnd(16, 30), 0.05);
        haze.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
        G.group.add(haze);
    }

    // Layered glowing core + Sgr A* label
    G.group.add(_glowSprite(0xffe9c0, 80, 0.9));
    G.group.add(_glowSprite(0xfff6e0, 30, 1.0));
    G.group.add(_glowSprite(0xffc070, 140, 0.35));
    G.group.add(_glowSprite(0x4a5acc, GAL_R * 3.2, 0.16));
    G.group.add(_textSprite('Sgr A*', '#ffd9a0', 0, 5, 0, 12));

    // Named spiral arms (deterministic anchor on each arm)
    ARM_NAMES.forEach((name, arm) => {
        const t = 0.62;
        const r = BULGE_R * 0.5 + t * (GAL_R - BULGE_R * 0.5);
        const a = arm * (TWO_PI / ARMS) + WIND * (r / GAL_R);
        G.group.add(_textSprite(name, '#8fa6cc', Math.cos(a) * r, 4, Math.sin(a) * r, 11));
    });

    // Globular clusters in the halo
    for (let i = 0; i < 14; i++) {
        const blob = _starBlob(110, rnd(1.5, 3), 0.08, 0.13, 1);
        const rr = rnd(60, 170), a = Math.random() * TWO_PI;
        blob.position.set(Math.cos(a) * rr, rnd(-70, 70), Math.sin(a) * rr);
        G.scene.add(blob);
    }

    // Magellanic Clouds — two dwarf companion galaxies, click to fly over
    const addGalaxy = (blob, x, y, z, viewDist, info) => {
        blob.position.set(x, y, z); G.scene.add(blob);
        G.scene.add(_textSprite(info.name + ' — click to visit', '#9fb4dd', x, y + 22, z, 12));
        const hit = new T.Mesh(new T.SphereGeometry(viewDist * 0.8, 8, 8),
            new T.MeshBasicMaterial({ visible: false }));
        hit.position.set(x, y, z);
        hit.userData.galaxy = { ...info, viewDist };
        G.scene.add(hit);
        G.pickables.push(hit);
    };
    const lmc = _starBlob(700, 17, 0.5, 0.62, 0.5);
    lmc.add(_glowSprite(0x8fb0ff, 40, 0.2));
    addGalaxy(lmc, 250, -140, 190, 32, {
        name: 'Large Magellanic Cloud',
        rows: { Distance: '160,000 ly', Diameter: '14,000 ly', Stars: '~30 billion', Type: 'Magellanic spiral' },
        fun: 'Home of the Tarantula Nebula — the most violent star factory in our neighborhood.' });
    const smc = _starBlob(380, 11, 0.52, 0.64, 0.55);
    smc.add(_glowSprite(0x8fb0ff, 26, 0.18));
    addGalaxy(smc, 330, -180, 90, 24, {
        name: 'Small Magellanic Cloud',
        rows: { Distance: '200,000 ly', Diameter: '7,000 ly', Stars: '~3 billion', Type: 'Dwarf irregular' },
        fun: 'Slowly being pulled apart by the Milky Way and its bigger sibling.' });

    // Distant background shell
    const bgN = 2200, bp = new Float32Array(bgN * 3);
    for (let i = 0; i < bgN; i++) {
        const u = Math.random() * TWO_PI, v = Math.acos(2 * Math.random() - 1), R = 700;
        bp[i*3] = R*Math.sin(v)*Math.cos(u); bp[i*3+1] = R*Math.sin(v)*Math.sin(u); bp[i*3+2] = R*Math.cos(v);
    }
    const bgeo = new T.BufferGeometry(); bgeo.setAttribute('position', new T.BufferAttribute(bp, 3));
    G.scene.add(new T.Points(bgeo, new T.PointsMaterial({
        size: 1.1, map: starTex, color: 0x99aaff, transparent: true,
        depthWrite: false, blending: T.AdditiveBlending })));

    // Sun marker on the Orion spur — click it to enter the Solar System
    const sa = Math.PI * 0.3;
    G.sunMarker = _glowSprite(0x9fe6ff, 7, 1);
    G.sunMarker.position.set(Math.cos(sa) * SUN_GR, 1.5, Math.sin(sa) * SUN_GR);
    G.group.add(G.sunMarker);
    const ring = new T.Mesh(
        new T.RingGeometry(4, 4.5, 40),
        new T.MeshBasicMaterial({ color: 0x9fe6ff, transparent: true, opacity: 0.8, side: T.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.copy(G.sunMarker.position);
    G.group.add(ring);
    G.group.add(_textSprite('☉ Sun — click to enter', '#bfefff',
        G.sunMarker.position.x + 6, 5, G.sunMarker.position.z, 14));
    G.group.add(_textSprite('Orion Spur', '#8fa6cc',
        G.sunMarker.position.x - 4, -3.5, G.sunMarker.position.z + 6, 11));
    const sunHit = new T.Mesh(new T.SphereGeometry(6, 8, 8),
        new T.MeshBasicMaterial({ visible: false }));
    sunHit.position.copy(G.sunMarker.position);
    sunHit.userData.sun = true;
    G.group.add(sunHit);          // in the rotating group, so it tracks the marker
    G.pickables.push(sunHit);

    G.camera = new T.PerspectiveCamera(55, _aspect(), 0.5, 4000);
    G.camera.position.set(0, 130, 230);
    G.controls = _orbit(G.camera);
    G.controls.minDistance = 4; G.controls.maxDistance = 900;
    // Free roam: no auto-rotate pinning the view to the galactic center;
    // right-drag pans the camera anywhere on the map.
    G.controls.autoRotate = false;
    G.controls.enablePan = true;
    G.controls.screenSpacePanning = true;
}

/* ════════════════════════════════════════════════════════════
   SOLAR scene
════════════════════════════════════════════════════════════ */
const PLANETS = [
    { name:'Mercury', dist:14,  size:0.55, day:0.10, year:0.40,  type:'rock',  col:'#9c8b7a', tilt:0,
      facts:{ diameter:'4,879 km', year:'88 days', dayLen:'59 Earth days', moons:'0',
              fun:'Daytime hits 430 °C while the night side falls to −180 °C.' } },
    { name:'Venus',   dist:20,  size:0.95, day:-0.04, year:0.26, type:'venus', col:'#d9b06a', tilt:177,
      facts:{ diameter:'12,104 km', year:'225 days', dayLen:'243 Earth days', moons:'0',
              fun:'Spins backwards — on Venus the Sun rises in the west.' } },
    { name:'Earth',   dist:27,  size:1.0,  day:0.5,  year:0.16,  type:'earth', col:'#3a7ad0', tilt:23.4,
      moonsList:[{ d:1.7, s:0.27, sp:1.4, col:0xb9b9b9 }],
      facts:{ diameter:'12,742 km', year:'365.25 days', dayLen:'24 hours', moons:'1',
              fun:'The only known world with liquid-water oceans.' } },
    { name:'Mars',    dist:34,  size:0.7,  day:0.48, year:0.11,  type:'mars',  col:'#c1572f', tilt:25,
      moonsList:[{ d:0.6, s:0.08, sp:3.2, col:0x9a8a78 }, { d:1.0, s:0.06, sp:2.1, col:0x8a7d6e }],
      facts:{ diameter:'6,779 km', year:'687 days', dayLen:'24.6 hours', moons:'2 (Phobos & Deimos)',
              fun:'Olympus Mons is the tallest volcano in the solar system — 21 km high.' } },
    { name:'Jupiter', dist:52,  size:2.8,  day:1.2,  year:0.052, type:'gas',   col:'#caa472', tilt:3,
      moonsList:[
        { d:1.5, s:0.16, sp:2.4, col:0xd9c25f },   // Io
        { d:2.1, s:0.14, sp:1.8, col:0xd8cdbb },   // Europa
        { d:2.8, s:0.22, sp:1.3, col:0x9b8d7d },   // Ganymede
        { d:3.6, s:0.20, sp:0.9, col:0x6e655c }],  // Callisto
      facts:{ diameter:'139,820 km', year:'11.9 years', dayLen:'9.9 hours', moons:'95',
              fun:'The Great Red Spot is a storm wider than the whole Earth.' } },
    { name:'Saturn',  dist:70,  size:2.4,  day:1.1,  year:0.034, type:'gas',   col:'#dcc89a', tilt:26.7, ring:'saturn',
      moonsList:[{ d:3.6, s:0.20, sp:0.8, col:0xc8a86a }],   // Titan
      facts:{ diameter:'116,460 km', year:'29.4 years', dayLen:'10.7 hours', moons:'146',
              fun:'Its rings are almost pure water ice and only ~10 m thick in places.' } },
    { name:'Uranus',  dist:86,  size:1.7,  day:0.7,  year:0.022, type:'ice',   col:'#a6e3e0', tilt:97.8, ring:'uranus',
      facts:{ diameter:'50,724 km', year:'84 years', dayLen:'17.2 hours', moons:'28',
              fun:'Rolls around the Sun on its side — its axis is tipped 98°.' } },
    { name:'Neptune', dist:100, size:1.6,  day:0.75, year:0.014, type:'ice',   col:'#3f6fd6', tilt:28.3,
      moonsList:[{ d:1.5, s:0.15, sp:-1.0, col:0xd8d8e8 }],  // Triton (retrograde)
      facts:{ diameter:'49,244 km', year:'165 years', dayLen:'16.1 hours', moons:'16',
              fun:'Winds reach 2,100 km/h — the fastest in the solar system.' } },
    { name:'Pluto',   dist:115, size:0.35, day:0.2,  year:0.009, type:'rock',  col:'#bfa68f', tilt:120, inc:0.30, dwarf:true,
      facts:{ diameter:'2,377 km', year:'248 years', dayLen:'6.4 Earth days', moons:'5',
              fun:'A dwarf planet with a heart-shaped nitrogen-ice glacier (Sputnik Planitia).' } },
];
const SUN_FACTS = { diameter:'1.39 million km', year:'—', dayLen:'~27 days (equator)', moons:'8 planets',
    fun:'Holds 99.86 % of the solar system’s mass and fuses 600 M tons of hydrogen per second.' };

function _planetTexture(p) {
    const c = document.createElement('canvas'); c.width = 512; c.height = 256;
    const x = c.getContext('2d');
    const base = p.col;
    x.fillStyle = base; x.fillRect(0, 0, 512, 256);

    if (p.type === 'gas' || p.type === 'ice') {
        const bands = p.type === 'gas' ? 30 : 16;
        for (let i = 0; i < bands; i++) {
            const y = (i / bands) * 256, h = 256 / bands + 1;
            x.fillStyle = _shade(base, rnd(-0.20, 0.20));
            x.fillRect(0, y, 512, h);
        }
        for (let i = 0; i < 220; i++) {
            x.globalAlpha = 0.07;
            x.fillStyle = _shade(base, rnd(-0.25, 0.25));
            const y = rnd(0, 256), w = rnd(60, 360);
            x.beginPath(); x.ellipse(rnd(0, 512), y, w, rnd(1.5, 5), 0, 0, TWO_PI); x.fill();
        }
        x.globalAlpha = 1;
        if (p.name === 'Jupiter') {
            x.fillStyle = '#c14a32';
            x.beginPath(); x.ellipse(360, 160, 34, 16, 0, 0, TWO_PI); x.fill();
            x.fillStyle = '#e0795f';
            x.beginPath(); x.ellipse(360, 160, 22, 10, 0, 0, TWO_PI); x.fill();
        }
        if (p.name === 'Neptune') {
            x.fillStyle = '#1e3f8f';
            x.beginPath(); x.ellipse(180, 110, 30, 13, 0, 0, TWO_PI); x.fill();
        }
    } else if (p.type === 'earth') {
        x.fillStyle = '#123c78'; x.fillRect(0, 0, 512, 256);
        for (let i = 0; i < 40; i++) {
            x.globalAlpha = 0.12; x.fillStyle = '#1d55a3';
            x.beginPath(); x.ellipse(rnd(0,512), rnd(0,256), rnd(30,120), rnd(20,60), 0, 0, TWO_PI); x.fill();
        }
        x.globalAlpha = 1;
        for (let cont = 0; cont < 7; cont++) {
            const cx0 = rnd(0, 512), cy0 = rnd(40, 216);
            for (let i = 0; i < 22; i++) {
                x.fillStyle = i % 4 === 0 ? '#6f9440' : (i % 3 ? '#3c7a34' : '#2c5f2a');
                x.beginPath();
                x.ellipse((cx0 + rnd(-46, 46) + 512) % 512, clamp(cy0 + rnd(-26, 26), 14, 242),
                          rnd(7, 24), rnd(5, 14), rnd(0, 3), 0, TWO_PI);
                x.fill();
            }
        }
        for (let i = 0; i < 10; i++) {
            x.globalAlpha = 0.5; x.fillStyle = '#b89a52';
            x.beginPath(); x.ellipse(rnd(0,512), rnd(90,170), rnd(6,16), rnd(4,9), 0, 0, TWO_PI); x.fill();
        }
        x.globalAlpha = 1;
        x.fillStyle = '#f1f6ff'; x.fillRect(0, 0, 512, 16); x.fillRect(0, 240, 512, 16);
    } else if (p.type === 'mars') {
        for (let i = 0; i < 900; i++) {
            x.fillStyle = _shade(base, rnd(-0.25, 0.18));
            const s = rnd(3, 12);
            x.beginPath(); x.ellipse(rnd(0,512), rnd(0,256), s, s * rnd(0.5, 1), 0, 0, TWO_PI); x.fill();
        }
        x.globalAlpha = 0.4; x.fillStyle = '#5e2c18';
        x.beginPath(); x.ellipse(250, 140, 90, 7, 0.1, 0, TWO_PI); x.fill();
        for (let i = 0; i < 8; i++) { x.beginPath(); x.ellipse(rnd(0,512), rnd(60,200), rnd(20,55), rnd(12,28), 0, 0, TWO_PI); x.fill(); }
        x.globalAlpha = 1;
        x.fillStyle = '#f3ece0'; x.fillRect(0, 0, 512, 13); x.fillRect(0, 243, 512, 13);
    } else if (p.type === 'venus') {
        for (let i = 0; i < 160; i++) {
            x.globalAlpha = 0.10; x.fillStyle = _shade(base, rnd(-0.15, 0.25));
            x.beginPath(); x.ellipse(rnd(0,512), rnd(0,256), rnd(40,180), rnd(4,12), rnd(-0.3,0.3), 0, TWO_PI); x.fill();
        }
        x.globalAlpha = 1;
    } else {
        for (let i = 0; i < 1100; i++) {
            x.fillStyle = _shade(base, rnd(-0.25, 0.22));
            const s = rnd(1.5, 7);
            x.beginPath(); x.arc(rnd(0,512), rnd(0,256), s, 0, TWO_PI); x.fill();
        }
        for (let i = 0; i < 50; i++) {
            const cx0 = rnd(0,512), cy0 = rnd(0,256), r = rnd(3, 11);
            x.fillStyle = _shade(base, -0.3); x.beginPath(); x.arc(cx0, cy0, r, 0, TWO_PI); x.fill();
            x.strokeStyle = _shade(base, 0.18); x.lineWidth = 1.5;
            x.beginPath(); x.arc(cx0, cy0, r, 0, TWO_PI); x.stroke();
        }
    }
    const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; return t;
}

function _cloudTexture() {
    const c = document.createElement('canvas'); c.width = 512; c.height = 256;
    const x = c.getContext('2d');
    x.clearRect(0, 0, 512, 256);
    for (let i = 0; i < 90; i++) {
        x.globalAlpha = rnd(0.10, 0.30);
        x.fillStyle = '#ffffff';
        const cx0 = rnd(0, 512), cy0 = rnd(10, 246);
        for (let j = 0; j < 6; j++) {
            x.beginPath();
            x.ellipse((cx0 + rnd(-30, 30) + 512) % 512, clamp(cy0 + rnd(-8, 8), 0, 256),
                      rnd(12, 42), rnd(3, 9), 0, 0, TWO_PI);
            x.fill();
        }
    }
    const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; return t;
}

function _sunTexture() {
    const c = document.createElement('canvas'); c.width = 512; c.height = 256;
    const x = c.getContext('2d');
    x.fillStyle = '#ffc933'; x.fillRect(0, 0, 512, 256);
    for (let i = 0; i < 2600; i++) {
        const s = rnd(2, 9);
        x.globalAlpha = rnd(0.2, 0.6);
        x.fillStyle = Math.random() < 0.5 ? '#ff9020' : '#fff6c0';
        x.beginPath(); x.arc(rnd(0,512), rnd(0,256), s, 0, TWO_PI); x.fill();
    }
    x.globalAlpha = 1;
    const t = new T.CanvasTexture(c);
    t.encoding = T.sRGBEncoding; t.wrapS = T.RepeatWrapping;
    return t;
}

function _ringMesh(inner, outer, style) {
    const geo = new T.RingGeometry(inner, outer, 128, 1);
    const pos = geo.attributes.position, uv = geo.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
        const r = Math.hypot(pos.getX(i), pos.getY(i));
        uv.setXY(i, (r - inner) / (outer - inner), 0.5);
    }
    const c = document.createElement('canvas'); c.width = 256; c.height = 1;
    const ix = c.getContext('2d');
    for (let i = 0; i < 256; i++) {
        const f = i / 256;
        if (style === 'uranus') {
            // sparse, thin, dark bluish rings
            let a = (Math.sin(f * 90) > 0.86 ? 0.5 : 0.06) * (f > 0.1 && f < 0.95 ? 1 : 0.2);
            ix.fillStyle = `rgba(150,175,195,${a})`;
        } else {
            let a = 0.55 + 0.4 * Math.sin(f * 60) * Math.sin(f * 13);
            if (f > 0.62 && f < 0.70) a = 0.04;
            if (f < 0.04 || f > 0.97) a *= 0.25;
            ix.fillStyle = `rgba(${215 - f*40|0},${195 - f*45|0},${155 - f*35|0},${clamp(a, 0, 1)})`;
        }
        ix.fillRect(i, 0, 1, 1);
    }
    const tex = new T.CanvasTexture(c); tex.encoding = T.sRGBEncoding;
    const m = new T.Mesh(geo, new T.MeshBasicMaterial({
        map: tex, transparent: true, side: T.DoubleSide, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    return m;
}

function _orbitLine(r) {
    const pts = [];
    for (let i = 0; i <= 160; i++) { const a = (i / 160) * TWO_PI; pts.push(new T.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r)); }
    return new T.LineLoop(new T.BufferGeometry().setFromPoints(pts),
        new T.LineBasicMaterial({ color: 0x4a5a80, transparent: true, opacity: 0.3 }));
}

/* ── Comet on an eccentric, inclined orbit with a particle tail ── */
const COMET = { a: 62, e: 0.72, inc: 0.5, N: 140 };
function _cometR(theta) { return COMET.a * (1 - COMET.e * COMET.e) / (1 + COMET.e * Math.cos(theta)); }

function _buildComet() {
    const grp = new T.Group();
    grp.rotation.x = COMET.inc;
    S.scene.add(grp);

    // dotted orbit ellipse
    const pts = [];
    for (let i = 0; i <= 200; i++) {
        const th = (i / 200) * TWO_PI, r = _cometR(th);
        pts.push(new T.Vector3(Math.cos(th) * r, 0, Math.sin(th) * r));
    }
    grp.add(new T.LineLoop(new T.BufferGeometry().setFromPoints(pts),
        new T.LineBasicMaterial({ color: 0x6a8ab0, transparent: true, opacity: 0.22 })));

    // head: icy nucleus + glow
    const head = new T.Group();
    head.add(new T.Mesh(new T.SphereGeometry(0.22, 16, 16),
        new T.MeshBasicMaterial({ color: 0xdff2ff })));
    head.add(_glowSprite(0x9fd4ff, 2.4, 0.9));
    grp.add(head);

    // tail particles (positions rewritten every frame)
    const N = COMET.N;
    const useCpp = !!CPP;
    let tp;
    if (useCpp) {
        // zero-copy view: comet_step() writes straight into this buffer
        CPP.comet_init((Math.random() * 0xffffffff) >>> 0);
        tp = _f32(CPP.comet_tail(), N * 3);
    } else {
        tp = new Float32Array(N * 3);
    }
    const tc = new Float32Array(N * 3);
    const jit = [];
    for (let i = 0; i < N; i++) {
        const t = i / N, fade = 1 - t;
        tc[i*3] = 0.45 * fade + 0.1; tc[i*3+1] = 0.7 * fade + 0.12; tc[i*3+2] = fade + 0.15;
        jit.push(new T.Vector3(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)));
    }
    const tg = new T.BufferGeometry();
    tg.setAttribute('position', new T.BufferAttribute(tp, 3));
    tg.setAttribute('color', new T.BufferAttribute(tc, 3));
    const tail = new T.Points(tg, new T.PointsMaterial({
        size: 1.0, map: starTex, vertexColors: true, transparent: true,
        depthWrite: false, blending: T.AdditiveBlending }));
    grp.add(tail);

    const label = _textSprite('Comet', '#bfe0ff', 0, 1.6, 0, 11);
    grp.add(label);

    S.comet = { grp, head, tail, label, jit, theta: 2.4, cpp: useCpp };
}

function _stepComet(dt) {
    const c = S.comet; if (!c) return;
    if (c.cpp) {
        // Orbit + tail particles computed in C++; the tail attribute is a
        // view over wasm memory, so just flag it for re-upload.
        CPP.comet_step(dt, spin);
        const head = _f32(CPP.comet_head(), 2);
        c.head.position.set(head[0], 0, head[1]);
        c.label.position.set(head[0], 1.8, head[1]);
        c.tail.geometry.attributes.position.needsUpdate = true;
        return;
    }
    const r = _cometR(c.theta);
    c.theta += (360 / (r * r)) * spin * dt;          // Kepler-ish: fast at perihelion
    const px = Math.cos(c.theta) * r, pz = Math.sin(c.theta) * r;
    c.head.position.set(px, 0, pz);
    c.label.position.set(px, 1.8, pz);

    // tail points away from the Sun (origin), longer when closer
    const dir = new T.Vector3(px, 0, pz).normalize();
    const len = clamp(420 / r, 3, 16);
    const posAttr = c.tail.geometry.attributes.position;
    for (let i = 0; i < COMET.N; i++) {
        const t = i / COMET.N;
        const wob = c.jit[i];
        posAttr.setXYZ(i,
            px + dir.x * t * len + wob.x * t * len * 0.14,
            0  + wob.y * t * len * 0.14,
            pz + dir.z * t * len + wob.z * t * len * 0.14);
    }
    posAttr.needsUpdate = true;
}

function _buildSolar() {
    S.scene = new T.Scene();
    S.scene.background = new T.Color(0x01010a);

    // Starfield backdrop (two depths) + Milky Way band
    [[900, 1.8], [2400, 1.0]].forEach(([n, sz]) => {
        const sp = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
            const u = Math.random() * TWO_PI, v = Math.acos(2*Math.random()-1), R = 600;
            sp[i*3]=R*Math.sin(v)*Math.cos(u); sp[i*3+1]=R*Math.sin(v)*Math.sin(u); sp[i*3+2]=R*Math.cos(v);
        }
        const sg = new T.BufferGeometry(); sg.setAttribute('position', new T.BufferAttribute(sp, 3));
        S.scene.add(new T.Points(sg, new T.PointsMaterial({
            size: sz, map: starTex, color: 0xcdd8ff, transparent: true,
            depthWrite: false, blending: T.AdditiveBlending })));
    });
    const mwN = 1600, mp = new Float32Array(mwN * 3), mcl = new Float32Array(mwN * 3);
    const mc = new T.Color();
    for (let i = 0; i < mwN; i++) {
        const a = Math.random() * TWO_PI, R = 600;
        const spread = Math.pow(Math.random(), 2) * (Math.random() < 0.5 ? 1 : -1) * 120;
        mp[i*3] = R * Math.cos(a); mp[i*3+1] = spread + R * 0.12 * Math.sin(a * 2); mp[i*3+2] = R * Math.sin(a);
        mc.setHSL(rnd(0.55, 0.65), 0.5, rnd(0.5, 0.8));
        mcl[i*3]=mc.r; mcl[i*3+1]=mc.g; mcl[i*3+2]=mc.b;
    }
    const mg = new T.BufferGeometry();
    mg.setAttribute('position', new T.BufferAttribute(mp, 3));
    mg.setAttribute('color', new T.BufferAttribute(mcl, 3));
    S.scene.add(new T.Points(mg, new T.PointsMaterial({
        size: 1.6, map: starTex, vertexColors: true, transparent: true, opacity: 0.5,
        depthWrite: false, blending: T.AdditiveBlending })));

    // Lighting
    S.scene.add(new T.AmbientLight(0x202028, 0.7));
    S.scene.add(new T.PointLight(0xfff2d8, 2.6, 0, 1.6));

    // Sun + corona
    S.sun = new T.Mesh(new T.SphereGeometry(4.5, 56, 56), new T.MeshBasicMaterial({ map: _sunTexture() }));
    S.scene.add(S.sun);
    S._corona1 = _glowSprite(0xffeebb, 26, 0.95); S.scene.add(S._corona1);
    S._corona2 = _glowSprite(0xff9930, 44, 0.35); S.scene.add(S._corona2);
    S.scene.add(_textSprite('Sun', '#ffe9a8', 0, 6.8, 0, 16));

    // Planets
    S.planets = [];
    PLANETS.forEach(p => {
        const orbitGroup = new T.Group();
        if (p.inc) orbitGroup.rotation.x = p.inc;
        S.scene.add(orbitGroup);
        orbitGroup.add(_orbitLine(p.dist));

        const pivot = new T.Group(); orbitGroup.add(pivot);
        const holder = new T.Group(); holder.position.x = p.dist; pivot.add(holder);
        holder.rotation.z = (p.tilt || 0) * Math.PI / 180;

        const mesh = new T.Mesh(new T.SphereGeometry(p.size, 48, 48),
            new T.MeshStandardMaterial({ map: _planetTexture(p), roughness: 0.95, metalness: 0 }));
        mesh.userData.planet = p;
        holder.add(mesh);

        holder.add(_glowSprite(new T.Color(p.col).getHex(), p.size * 3.4, p.type === 'rock' ? 0.10 : 0.18));

        let clouds = null;
        if (p.type === 'earth') {
            clouds = new T.Mesh(new T.SphereGeometry(p.size * 1.025, 48, 48),
                new T.MeshStandardMaterial({ map: _cloudTexture(), transparent: true, depthWrite: false, roughness: 1 }));
            holder.add(clouds);
            holder.add(_glowSprite(0x6ab7ff, p.size * 3.0, 0.25));
        }

        if (p.ring === 'saturn') holder.add(_ringMesh(p.size * 1.35, p.size * 2.5, 'saturn'));
        if (p.ring === 'uranus') holder.add(_ringMesh(p.size * 1.55, p.size * 1.85, 'uranus'));

        const moons = [];
        (p.moonsList || []).forEach(mn => {
            const gp = new T.Group(); gp.rotation.y = Math.random() * TWO_PI; holder.add(gp);
            const m = new T.Mesh(new T.SphereGeometry(mn.s, 18, 18),
                new T.MeshStandardMaterial({ color: mn.col, roughness: 1 }));
            m.position.x = p.size + mn.d; gp.add(m);
            moons.push({ pivot: gp, sp: mn.sp });
        });

        pivot.add(_textSprite(p.name, p.dwarf ? '#a8a8c0' : '#cfe0ff', p.dist, p.size + 1.7, 0, 12));
        pivot.rotation.y = Math.random() * TWO_PI;
        S.planets.push({ p, pivot, holder, mesh, clouds, moons });
    });

    // Asteroid belt (Mars ↔ Jupiter)
    const aN = 2200, ap = new Float32Array(aN * 3);
    for (let i = 0; i < aN; i++) {
        const a = Math.random() * TWO_PI, r = 40 + Math.random() * 7;
        ap[i*3] = Math.cos(a) * r; ap[i*3+1] = (Math.random()-0.5)*1.6; ap[i*3+2] = Math.sin(a) * r;
    }
    const ag = new T.BufferGeometry(); ag.setAttribute('position', new T.BufferAttribute(ap, 3));
    S.belt = new T.Points(ag, new T.PointsMaterial({ size: 0.45, color: 0x8a7d6a, transparent: true, opacity: 0.85 }));
    S.scene.add(S.belt);

    // Kuiper belt (beyond Neptune)
    const kN = 2600, kp = new Float32Array(kN * 3);
    for (let i = 0; i < kN; i++) {
        const a = Math.random() * TWO_PI, r = 112 + Math.random() * 34;
        kp[i*3] = Math.cos(a) * r;
        kp[i*3+1] = (Math.random() - 0.5) * 7 * Math.random();
        kp[i*3+2] = Math.sin(a) * r;
    }
    const kg = new T.BufferGeometry(); kg.setAttribute('position', new T.BufferAttribute(kp, 3));
    S.kuiper = new T.Points(kg, new T.PointsMaterial({
        size: 0.5, map: starTex, color: 0x7a8aa0, transparent: true, opacity: 0.55,
        depthWrite: false, blending: T.AdditiveBlending }));
    S.scene.add(S.kuiper);
    S.scene.add(_textSprite('Kuiper Belt', '#7a8aa0', 0, 6, -128, 12));

    _buildComet();

    S.camera = new T.PerspectiveCamera(50, _aspect(), 0.1, 3000);
    S.camera.position.set(0, 55, 110);
    S.controls = _orbit(S.camera);
    S.controls.minDistance = 2;
    S.controls.maxDistance = 460;
}

/* ════════════════════════════════════════════════════════════
   Helpers
════════════════════════════════════════════════════════════ */
function _textSprite(text, color, x, y, z, px) {
    const pad = 6, font = `600 ${px*2}px sans-serif`;
    const mc = document.createElement('canvas'); const mx = mc.getContext('2d');
    mx.font = font; const w = mx.measureText(text).width;
    mc.width = w + pad * 2; mc.height = px * 2 + pad * 2;
    mx.font = font; mx.textBaseline = 'middle';
    mx.fillStyle = 'rgba(0,0,0,0.6)'; mx.fillText(text, pad + 1, mc.height/2 + 1);
    mx.fillStyle = color; mx.fillText(text, pad, mc.height/2);
    const tex = new T.CanvasTexture(mc); tex.encoding = T.sRGBEncoding;
    const spr = new T.Sprite(new T.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false }));
    const s = px * 0.16; spr.scale.set((mc.width/mc.height) * s, s, 1);
    spr.position.set(x, y, z);
    return spr;
}
function _shade(hex, amt) {
    if (!/^#[0-9a-f]{6}$/i.test(hex)) return hex;
    let r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
    const f = amt < 0 ? 0 : 255, t2 = Math.abs(amt);
    r = Math.round((f-r)*t2+r); g = Math.round((f-g)*t2+g); b = Math.round((f-b)*t2+b);
    return `rgb(${r},${g},${b})`;
}
function _aspect() { const r = container.getBoundingClientRect(); return (r.width||800)/(r.height||600); }
function _orbit(cam) {
    const o = new T.OrbitControls(cam, renderer.domElement);
    o.enableDamping = true; o.dampingFactor = 0.08; o.rotateSpeed = 0.6;
    o.target.set(0, 0, 0); return o;
}
const _ease = t => t < 0.5 ? 2*t*t : 1 - Math.pow(-2*t + 2, 2) / 2;

function _flyTo(cam, ctl, targetPos, dist, dur) {
    const dir = cam.position.clone().sub(targetPos);
    if (dir.lengthSq() < 0.01) dir.set(0, 0.5, 1);
    dir.normalize();
    const toP = targetPos.clone().add(dir.multiplyScalar(dist)).add(new T.Vector3(0, dist * 0.25, 0));
    _fly = { t: 0, dur: dur || 1.3, cam, ctl,
        fromP: cam.position.clone(), toP,
        fromT: ctl.target.clone(), toT: targetPos.clone() };
    ctl.enabled = false;
}
function _stepFly(dt) {
    _fly.t += dt;
    const k = _ease(clamp(_fly.t / _fly.dur, 0, 1));
    _fly.cam.position.lerpVectors(_fly.fromP, _fly.toP, k);
    _fly.ctl.target.lerpVectors(_fly.fromT, _fly.toT, k);
    if (_fly.t >= _fly.dur) { _fly.ctl.enabled = true; _fly = null; }
}
function _setFollow(mesh) {
    if (!mesh) { _follow = null; return; }
    const wp = new T.Vector3(); mesh.getWorldPosition(wp);
    _follow = { mesh, lastPos: wp };
}

/* ── Info card ── */
function _showInfo(label, facts, color) {
    const el = document.getElementById('galaxy-info'); if (!el) return;
    el.style.display = 'block';
    el.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px">
        <span style="color:${color || '#cfe0ff'}; font-size:14px; font-weight:700">${label}</span>
        <button onclick="galaxyCloseInfo()" style="color:rgb(var(--slate-400)); background:none; border:none; cursor:pointer; font-size:14px; padding:0 2px">✕</button>
      </div>
      <div style="display:grid; grid-template-columns:auto 1fr; gap:3px 12px; font-size:11px">
        <span style="color:#7c8aa5">Diameter</span><span style="color:#dbe4f5">${facts.diameter}</span>
        <span style="color:#7c8aa5">Year</span><span style="color:#dbe4f5">${facts.year}</span>
        <span style="color:#7c8aa5">Day</span><span style="color:#dbe4f5">${facts.dayLen}</span>
        <span style="color:#7c8aa5">Moons</span><span style="color:#dbe4f5">${facts.moons}</span>
      </div>
      <div style="color:#a9b6cf; font-size:11px; font-style:italic; margin-top:8px; line-height:1.5">${facts.fun}</div>`;
}
function _showGalaxyInfo(g) {
    const el = document.getElementById('galaxy-info'); if (!el) return;
    el.style.display = 'block';
    el.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px">
        <span style="color:#b9c8ff; font-size:14px; font-weight:700">🌌 ${g.name}</span>
        <button onclick="galaxyCloseInfo()" style="color:rgb(var(--slate-400)); background:none; border:none; cursor:pointer; font-size:14px; padding:0 2px">✕</button>
      </div>
      <div style="display:grid; grid-template-columns:auto 1fr; gap:3px 12px; font-size:11px">
        ${Object.entries(g.rows).map(([k, v]) =>
            `<span style="color:#7c8aa5">${k}</span><span style="color:#dbe4f5">${v}</span>`).join('')}
      </div>
      <div style="color:#a9b6cf; font-size:11px; font-style:italic; margin-top:8px; line-height:1.5">${g.fun}</div>`;
}
function galaxyCloseInfo() {
    const el = document.getElementById('galaxy-info');
    if (el) el.style.display = 'none';
    _follow = null;
}

/* ════════════════════════════════════════════════════════════
   Loop
════════════════════════════════════════════════════════════ */
function _frame(ts) {
    if (!container || container.offsetParent === null) { raf = null; return; }
    raf = requestAnimationFrame(_frame);
    const dt = Math.min((ts - last) / 1000, 0.05); last = ts;

    if (mode === 'galaxy') {
        if (G.group) G.group.rotation.y += 0.015 * spin * dt;
        if (_fly) _stepFly(dt);
        G.controls.update();
        renderer.render(G.scene, G.camera);
        return;
    }

    // — Solar —
    S.planets.forEach(o => {
        o.pivot.rotation.y += o.p.year * spin * dt * 6;
        o.mesh.rotation.y  += o.p.day * spin * dt * 6;
        if (o.clouds) o.clouds.rotation.y += o.p.day * spin * dt * 7.5;
        o.moons.forEach(m => { m.pivot.rotation.y += m.sp * spin * dt; });
    });
    if (S.belt)   S.belt.rotation.y   += 0.03 * spin * dt;
    if (S.kuiper) S.kuiper.rotation.y += 0.012 * spin * dt;
    _stepComet(dt);
    if (S.sun) {
        S.sun.rotation.y += 0.05 * spin * dt;
        S.sun.material.map.offset.x += 0.004 * dt;
        const pulse = 1 + Math.sin(ts * 0.0011) * 0.04;
        S._corona1.scale.set(26 * pulse, 26 * pulse, 1);
        S._corona2.scale.set(44 / pulse, 44 / pulse, 1);
    }

    if (_fly) {
        _stepFly(dt);
    } else if (_follow) {
        const wp = new T.Vector3(); _follow.mesh.getWorldPosition(wp);
        const delta = wp.clone().sub(_follow.lastPos);
        S.camera.position.add(delta);
        S.controls.target.add(delta);
        _follow.lastPos = wp;
    }

    S.controls.update();
    renderer.render(S.scene, S.camera);
}

/* ════════════════════════════════════════════════════════════
   Picking — planet/Sun info cards (solar scene only)
════════════════════════════════════════════════════════════ */
let _down = null;
function _wirePicking() {
    const el = renderer.domElement;
    if (el._galPick) return; el._galPick = true;
    el.addEventListener('pointerdown', e => { _down = { x: e.clientX, y: e.clientY }; });
    el.addEventListener('pointerup', e => {
        if (!_down) return;
        const moved = Math.hypot(e.clientX - _down.x, e.clientY - _down.y);
        _down = null;
        if (moved > 5 || _fly || _transitioning) return;
        const rect = el.getBoundingClientRect();
        const m = new T.Vector2(((e.clientX-rect.left)/rect.width)*2-1, -((e.clientY-rect.top)/rect.height)*2+1);
        const ray = new T.Raycaster();

        if (mode === 'galaxy') {
            ray.setFromCamera(m, G.camera);
            const hits = ray.intersectObjects(G.pickables, false);
            if (!hits.length) return;
            const u = hits[0].object.userData;
            if (u.sun) {
                _setMode('solar', () => { S.camera.position.set(0, 55, 110); S.controls.target.set(0, 0, 0); });
            } else if (u.galaxy) {
                const wp = new T.Vector3(); hits[0].object.getWorldPosition(wp);
                _flyTo(G.camera, G.controls, wp, u.galaxy.viewDist, 1.8);
                _showGalaxyInfo(u.galaxy);
            }
            return;
        }

        ray.setFromCamera(m, S.camera);
        const targets = S.planets.map(o => o.mesh).concat([S.sun]);
        const hits = ray.intersectObjects(targets, false);
        if (!hits.length) return;
        const obj = hits[0].object;
        const wp = new T.Vector3(); obj.getWorldPosition(wp);
        if (obj === S.sun) {
            _flyTo(S.camera, S.controls, wp, 22);
            _setFollow(null);
            _showInfo('☀️ The Sun', SUN_FACTS, '#ffe9a8');
        } else {
            const p = obj.userData.planet;
            _flyTo(S.camera, S.controls, wp, Math.max(4.5, p.size * 5));
            _setFollow(obj);
            _showInfo((p.dwarf ? '🪨 ' : '🪐 ') + p.name + (p.dwarf ? ' (dwarf planet)' : ''), p.facts, '#cfe0ff');
        }
    });
}

/* ════════════════════════════════════════════════════════════
   Mode + resize + lifecycle
════════════════════════════════════════════════════════════ */
function _fade(cb) {
    const f = document.getElementById('galaxy-fade');
    if (!f) { cb(); return; }
    f.style.opacity = '1';
    setTimeout(() => { cb(); _resize(); f.style.opacity = '0'; }, 220);
}
// place(): optional camera-positioning callback, run after the mode switches
function _setMode(m, place) {
    if (m === mode || _transitioning) return;
    _transitioning = true;
    galaxyCloseInfo(); _fly = null;
    _fade(() => {
        mode = m;
        if (place) place();
        _updateUI();
        _transitioning = false;
    });
}
function _updateUI() {
    const title = document.getElementById('galaxy-title');
    const sub   = document.getElementById('galaxy-sub');
    const btn   = document.getElementById('galaxy-mode-btn');
    if (title) title.textContent = mode === 'galaxy' ? 'Milky Way' : 'Solar System';
    if (sub) sub.textContent = mode === 'galaxy'
        ? 'Drag to orbit · right-drag to pan · click a galaxy to fly there · click the ☉ Sun for the Solar System'
        : 'Drag to orbit · click a planet for details · use the button above to return to the galaxy';
    if (btn) btn.innerHTML = mode === 'galaxy' ? '☉ Enter Solar System' : '✦ Back to Galaxy';
    if (G.controls) G.controls.enabled = mode === 'galaxy';
    if (S.controls) S.controls.enabled = mode === 'solar' && !_fly;
}
function _resize() {
    if (!renderer || !container) return;
    const r = container.getBoundingClientRect();
    if (!r.width || !r.height) return;
    renderer.setSize(r.width, r.height, false);
    [G.camera, S.camera].forEach(c => { if (c) { c.aspect = r.width / r.height; c.updateProjectionMatrix(); } });
}

function renderGalaxySim() {
    container = document.getElementById('galaxy-3d');
    if (!container) return;
    T = window.THREE;
    if (!T) { console.warn('THREE not loaded'); return; }
    if (!renderer) {
        renderer = new T.WebGLRenderer({ antialias: true, alpha: false });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.outputEncoding = T.sRGBEncoding;
        // width/height:100% are required — a <canvas> is a replaced element and
        // without them it uses its intrinsic buffer size instead of filling the box.
        renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;cursor:grab';
        container.appendChild(renderer.domElement);
        starTex = _makeStarTex();
        softTex = _makeSoftTex();
        _buildGalaxy();
        _buildSolar();
        _wirePicking();
        _updateUI();
        ro = new ResizeObserver(_resize); ro.observe(container);
    }
    _resize();
    last = performance.now();
    if (!raf) raf = requestAnimationFrame(_frame);
}
function stopGalaxySim() { if (raf) { cancelAnimationFrame(raf); raf = null; } }

function galaxyToggleMode() {
    if (mode === 'galaxy') {
        _setMode('solar', () => { S.camera.position.set(0, 55, 110); S.controls.target.set(0, 0, 0); });
    } else {
        _setMode('galaxy', () => { G.camera.position.set(0, 130, 230); G.controls.target.set(0, 0, 0); });
    }
}
function galaxySetSpin(v) { spin = v; }
function galaxySetStars(v) { starTarget = clamp(v|0, 8000, 120000); if (G.scene) _buildGalaxyPoints(); }
function galaxyResetView() {
    galaxyCloseInfo(); _fly = null;
    if (mode === 'galaxy' && G.camera) { G.camera.position.set(0,130,230); G.controls.target.set(0,0,0); G.controls.enabled = true; }
    else if (S.camera) { S.camera.position.set(0,55,110); S.controls.target.set(0,0,0); S.controls.enabled = true; }
}

window.renderGalaxySim  = renderGalaxySim;
window.stopGalaxySim    = stopGalaxySim;
window.galaxyToggleMode = galaxyToggleMode;
window.galaxySetSpin    = galaxySetSpin;
window.galaxySetStars   = galaxySetStars;
window.galaxyResetView  = galaxyResetView;
window.galaxyCloseInfo  = galaxyCloseInfo;

})();
