// ── Settings / Appearance ──────────────────────────────────────

const ACCENT_PRESETS = [
    { name: 'Red',    hex: '#dc2626', rgb: '220,38,38',  hover: '#b91c1c', light: '#f87171', lighter: '#fca5a5' },
    { name: 'Orange', hex: '#ea580c', rgb: '234,88,12',  hover: '#c2410c', light: '#fb923c', lighter: '#fdba74' },
    { name: 'Amber',  hex: '#d97706', rgb: '217,119,6',  hover: '#b45309', light: '#fbbf24', lighter: '#fde68a' },
    { name: 'Lime',   hex: '#65a30d', rgb: '101,163,13', hover: '#4d7c0f', light: '#a3e635', lighter: '#d9f99d' },
    { name: 'Green',  hex: '#16a34a', rgb: '22,163,74',  hover: '#15803d', light: '#4ade80', lighter: '#86efac' },
    { name: 'Teal',   hex: '#0d9488', rgb: '13,148,136', hover: '#0f766e', light: '#2dd4bf', lighter: '#99f6e4' },
    { name: 'Cyan',   hex: '#0891b2', rgb: '8,145,178',  hover: '#0e7490', light: '#22d3ee', lighter: '#a5f3fc' },
    { name: 'Blue',   hex: '#2563eb', rgb: '37,99,235',  hover: '#1d4ed8', light: '#60a5fa', lighter: '#bfdbfe' },
    { name: 'Indigo', hex: '#4f46e5', rgb: '79,70,229',  hover: '#4338ca', light: '#818cf8', lighter: '#c7d2fe' },
    { name: 'Violet', hex: '#7c3aed', rgb: '124,58,237', hover: '#6d28d9', light: '#a78bfa', lighter: '#ddd6fe' },
    { name: 'Purple', hex: '#9333ea', rgb: '147,51,234', hover: '#7e22ce', light: '#c084fc', lighter: '#e9d5ff' },
    { name: 'Pink',   hex: '#db2777', rgb: '219,39,119', hover: '#be185d', light: '#f472b6', lighter: '#fbcfe8' },
    // Apple's system colours — the accents the OS itself uses. Appended so
    // existing saved accentIndex values keep pointing at the same swatch.
    { name: 'Apple Blue',   hex: '#0071e3', rgb: '0,113,227',   hover: '#0062c4', light: '#2997ff', lighter: '#8ec5ff' },
    { name: 'Apple Green',  hex: '#34c759', rgb: '52,199,89',   hover: '#28a745', light: '#30d158', lighter: '#8ee6a1' },
    { name: 'Apple Orange', hex: '#ff9500', rgb: '255,149,0',   hover: '#e0830a', light: '#ff9f0a', lighter: '#ffc978' },
    { name: 'Apple Red',    hex: '#ff3b30', rgb: '255,59,48',   hover: '#e0322a', light: '#ff453a', lighter: '#ff9d97' },
    { name: 'Apple Purple', hex: '#af52de', rgb: '175,82,222',  hover: '#9a44c4', light: '#bf5af2', lighter: '#dcaaf5' },
    { name: 'Apple Pink',   hex: '#ff2d55', rgb: '255,45,85',   hover: '#e0284c', light: '#ff375f', lighter: '#ff96ab' },
    { name: 'Graphite',     hex: '#8e8e93', rgb: '142,142,147', hover: '#7a7a80', light: '#aeaeb2', lighter: '#d1d1d6' },
];

const BG_THEMES = [
    // ── Dark ──
    { id: 'slate',    name: 'Slate',     preview: '#020617', base: '#020617', surface: '#0f172a', elevated: '#1e293b', border: '#1e293b', borderHi: '#334155', inputBg: '#1e293b', dark: true  },
    // Apple's dark register: pure black page, #1a1a1a cards (the surface the
    // system's own dark widgets use), hairlines a step above.
    { id: 'black',    name: 'Black',     preview: '#000000', base: '#000000', surface: '#161616', elevated: '#1f1f1f', border: '#2a2a2a', borderHi: '#3a3a3a', inputBg: '#1f1f1f', dark: true  },
    { id: 'midnight', name: 'Midnight',  preview: '#0a0e1a', base: '#0a0e1a', surface: '#111827', elevated: '#1b2436', border: '#1f2a3d', borderHi: '#2e3b54', inputBg: '#161f30', dark: true  },
    { id: 'deepblue', name: 'Deep Blue', preview: '#03071e', base: '#03071e', surface: '#060d28', elevated: '#0d1639', border: '#1a2550', borderHi: '#263a72', inputBg: '#0d1639', dark: true  },
    { id: 'ocean',    name: 'Ocean',     preview: '#04151f', base: '#04151f', surface: '#08202e', elevated: '#0d2c3e', border: '#12384c', borderHi: '#1b5069', inputBg: '#0a2734', dark: true  },
    { id: 'forest',   name: 'Forest',    preview: '#0a140f', base: '#0a140f', surface: '#101e17', elevated: '#17291f', border: '#1d3527', borderHi: '#2a4a37', inputBg: '#13241b', dark: true  },
    { id: 'plum',     name: 'Plum',      preview: '#150c1d', base: '#150c1d', surface: '#1e1229', elevated: '#281937', border: '#342145', borderHi: '#472e5e', inputBg: '#231530', dark: true  },
    { id: 'charcoal', name: 'Charcoal',  preview: '#111111', base: '#111111', surface: '#1c1c1c', elevated: '#272727', border: '#303030', borderHi: '#3a3a3a', inputBg: '#222222', dark: true  },
    { id: 'nord',     name: 'Nord',      preview: '#2e3440', base: '#2e3440', surface: '#353d4b', elevated: '#3b4252', border: '#434c5e', borderHi: '#4c566a', inputBg: '#3b4252', dark: true  },
    { id: 'mocha',    name: 'Mocha',     preview: '#14100c', base: '#14100c', surface: '#1c1713', elevated: '#26201a', border: '#352b22', borderHi: '#4a3c2e', inputBg: '#221c16', dark: true  },
    { id: 'dim',      name: 'Dim',       preview: '#1a1f2e', base: '#1a1f2e', surface: '#242b3d', elevated: '#2e3854', border: '#3a4668', borderHi: '#4d5e88', inputBg: '#2a3050', dark: true  },
    { id: 'metallic', name: 'Metallic',  preview: '#3a3f4b', base: '#1c1f26', surface: '#262a33', elevated: '#323845', border: '#3c4350', borderHi: '#525b6b', inputBg: '#2a2f3a', dark: true, gradient: 'linear-gradient(135deg, #2a2f38 0%, #1a1d23 45%, #20242c 70%, #2e333d 100%)' },

];
// The light themes (White, Silver, Mist, Paper) were removed from the picker
// at the user's request. The light-theme rendering path is kept intact — a
// custom light colour still works — they are just no longer offered here.


let settingsData = { accentIndex: 0, customAccent: null, bgTheme: 'slate', customBg: null, wallpaper: null, wallpaperFit: 'fill', homeBg: 'plexus', homeBgIntensity: 1, homeBgSpeed: 1, homeIconSize: 60, categoryColors: {}, categoryIcons: {}, categoryTileColor: null, homeItems: null, homeSites: [], archived: [] };

// ── Home icon size (Appearance → Home icon size) ─────────────────────
const HOME_ICON_MIN = 40, HOME_ICON_MAX = 96, HOME_ICON_DEFAULT = 60;
function clampHomeIconSize(v) {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n)) return HOME_ICON_DEFAULT;
    return Math.max(HOME_ICON_MIN, Math.min(HOME_ICON_MAX, n));
}
// Everything on the Home grid scales from one CSS variable (see styles.css).
function applyHomeIconSize() {
    const px = clampHomeIconSize(settingsData.homeIconSize);
    document.documentElement.style.setProperty('--home-icon-pref', px + 'px');
}

// The animated home-page backgrounds, drawn by neural-bg.js. `swatch` is a
// small CSS stand-in for the real thing, so the grid reads at a glance.
const HOME_BGS = [
    { id: 'plexus', name: 'Plexus', desc: 'Drifting 3D network',
      swatch: 'radial-gradient(circle at 30% 35%, rgba(99,102,241,.85) 0 2px, transparent 3px), radial-gradient(circle at 68% 28%, rgba(56,189,248,.8) 0 2px, transparent 3px), radial-gradient(circle at 50% 70%, rgba(139,92,246,.8) 0 2px, transparent 3px), linear-gradient(120deg, rgba(99,102,241,.30), transparent 60%), #070b18' },
    { id: 'stars',  name: 'Starfield', desc: 'Slow drift through stars',
      swatch: 'radial-gradient(circle at 20% 30%, #fff 0 1px, transparent 2px), radial-gradient(circle at 70% 55%, #dbeafe 0 1.5px, transparent 3px), radial-gradient(circle at 45% 80%, #fff 0 1px, transparent 2px), #04060f' },
    { id: 'blackhole', name: 'Black hole', desc: 'Accretion disk and bent starlight',
      swatch: 'radial-gradient(circle at 50% 50%, #000 0 26%, rgba(255,190,110,.95) 27% 30%, rgba(255,150,60,.35) 31% 44%, transparent 46%), radial-gradient(circle at 20% 25%, #fff 0 1px, transparent 2px), #05070e' },
    { id: 'galaxy', name: 'Galaxy', desc: 'Spiral arms, slowly winding',
      swatch: 'radial-gradient(circle at 50% 50%, rgba(255,236,200,.85) 0 8%, rgba(255,190,120,.30) 9% 22%, transparent 40%), conic-gradient(from 0deg at 50% 50%, rgba(150,190,255,.30), transparent 28%, rgba(150,190,255,.26) 52%, transparent 78%), #05060f' },
    { id: 'nebula', name: 'Nebula', desc: 'Coloured gas and stars',
      swatch: 'radial-gradient(55% 70% at 30% 35%, rgba(236,72,153,.55), transparent), radial-gradient(55% 70% at 72% 62%, rgba(56,189,248,.5), transparent), radial-gradient(circle at 55% 25%, #fff 0 1px, transparent 2px), #06060f' },
    { id: 'warp', name: 'Warp', desc: 'Hyperspace star streaks',
      swatch: 'repeating-conic-gradient(from 0deg at 50% 50%, rgba(220,235,255,.55) 0deg 1.5deg, transparent 1.5deg 16deg), radial-gradient(circle at 50% 50%, #000 0 12%, transparent 42%), #04060e' },
    { id: 'aurora', name: 'Aurora', desc: 'Soft moving colour fields',
      swatch: 'radial-gradient(60% 80% at 25% 30%, rgba(139,92,246,.55), transparent), radial-gradient(60% 80% at 75% 65%, rgba(16,185,129,.45), transparent), #060912' },
    { id: 'waves',  name: 'Waves', desc: 'Layered flowing bands',
      swatch: 'linear-gradient(180deg, #060a16 45%, rgba(99,102,241,.35) 65%, rgba(99,102,241,.12) 100%)' },
    { id: 'embers', name: 'Embers', desc: 'Warm rising sparks',
      swatch: 'radial-gradient(circle at 30% 70%, rgba(251,146,60,.9) 0 2px, transparent 4px), radial-gradient(circle at 62% 40%, rgba(253,205,140,.85) 0 1.5px, transparent 3px), #0a0705' },
    { id: 'mesh', name: 'Mesh', desc: 'Flowing gradient fields',
      swatch: 'radial-gradient(60% 80% at 25% 30%, rgba(56,189,248,.55), transparent), radial-gradient(60% 80% at 75% 65%, rgba(244,114,182,.5), transparent), radial-gradient(50% 60% at 60% 20%, rgba(167,139,250,.5), transparent), #070b18' },
    { id: 'fireflies', name: 'Fireflies', desc: 'Wandering glow points',
      swatch: 'radial-gradient(circle at 25% 60%, rgba(253,224,71,.95) 0 1.5px, rgba(253,224,71,.25) 4px, transparent 7px), radial-gradient(circle at 65% 35%, rgba(134,239,172,.9) 0 1.5px, rgba(134,239,172,.25) 4px, transparent 7px), radial-gradient(circle at 80% 70%, rgba(125,211,252,.9) 0 1.5px, transparent 5px), #06090f' },
    { id: 'dots', name: 'Dots', desc: 'Lattice with a light sweep',
      swatch: 'radial-gradient(circle, rgba(255,255,255,.35) 0 1px, transparent 1.6px) 0 0 / 9px 9px, linear-gradient(100deg, transparent 35%, rgba(99,102,241,.45) 50%, transparent 65%), #070b18' },
    { id: 'none',   name: 'None', desc: 'Plain background',
      swatch: 'linear-gradient(135deg, #0b1020, #05070f)' },
];

// Hand the chosen style to the renderer. Safe to call before it has loaded.
function applyHomeBackground() {
    try {
        if (typeof window.setHomeBackgroundIntensity === 'function') window.setHomeBackgroundIntensity(settingsData.homeBgIntensity ?? 1);
        if (typeof window.setHomeBackgroundSpeed === 'function') window.setHomeBackgroundSpeed(settingsData.homeBgSpeed ?? 1);
        if (typeof window.setHomeBackground === 'function') window.setHomeBackground(settingsData.homeBg || 'plexus');
    }
    catch (e) { console.error('[settings] home background:', e); }
}

// Grey presets for the category tile backgrounds
const CATEGORY_TILE_GREYS = [
    { name: 'Charcoal', hex: '#313845' },
    { name: 'Graphite', hex: '#1f242c' },
    { name: 'Slate',    hex: '#475569' },
    { name: 'Gray',     hex: '#74787f' },
    { name: 'Silver',   hex: '#aab0ba' },
];

function loadSettingsData() {
    try {
        if (fs.existsSync(SETTINGS_FILE)) {
            settingsData = { ...settingsData, ...readJsonStrict(SETTINGS_FILE) };
        }
    } catch(e) {}
}

function saveSettingsData() {
    writeJsonSafe(SETTINGS_FILE, settingsData);
}

function hexToRgb(hex) {
    const r = parseInt(hex.slice(1,3),16);
    const g = parseInt(hex.slice(3,5),16);
    const b = parseInt(hex.slice(5,7),16);
    return `${r},${g},${b}`;
}

// Darken a hex color by a factor (0-1)
function darkenHex(hex, factor) {
    let r = parseInt(hex.slice(1,3),16);
    let g = parseInt(hex.slice(3,5),16);
    let b = parseInt(hex.slice(5,7),16);
    r = Math.max(0, Math.round(r * (1 - factor)));
    g = Math.max(0, Math.round(g * (1 - factor)));
    b = Math.max(0, Math.round(b * (1 - factor)));
    return '#' + [r,g,b].map(x => x.toString(16).padStart(2,'0')).join('');
}

// Lighten a hex color
function lightenHex(hex, factor) {
    let r = parseInt(hex.slice(1,3),16);
    let g = parseInt(hex.slice(3,5),16);
    let b = parseInt(hex.slice(5,7),16);
    r = Math.min(255, Math.round(r + (255 - r) * factor));
    g = Math.min(255, Math.round(g + (255 - g) * factor));
    b = Math.min(255, Math.round(b + (255 - b) * factor));
    return '#' + [r,g,b].map(x => x.toString(16).padStart(2,'0')).join('');
}

function buildAccentFromHex(hex) {
    return {
        hex,
        rgb: hexToRgb(hex),
        hover: darkenHex(hex, 0.15),
        light: lightenHex(hex, 0.4),
        lighter: lightenHex(hex, 0.65),
    };
}

function applyAccent(accent) {
    if (typeof renderSettingsModal === 'function') renderSettingsModal._thumbs = null;   // swatches show the accent
    const root = document.documentElement;
    root.style.setProperty('--accent-rgb', accent.rgb);
    root.style.setProperty('--accent',     accent.hex);
    root.style.setProperty('--accent-hover',   accent.hover);
    root.style.setProperty('--accent-light',   accent.light);
    root.style.setProperty('--accent-lighter', accent.lighter);

    // Override Tailwind inline-class elements
    let el = document.getElementById('vulsor-theme-override');
    if (!el) {
        el = document.createElement('style');
        el.id = 'vulsor-theme-override';
        document.head.appendChild(el);
    }
    el.textContent = generateThemeCSS(accent);
}

// ── Background themes: one grey scale, derived per theme ────────────────
// The whole UI is written in Tailwind's `slate` utilities, and
// tailwind.config.js compiles those to the --slate-50…950 variables. So a
// theme is applied by computing eleven RGB stops that share the theme's hue
// and setting them on <html>. Every surface, label, hairline and translucent
// overlay follows — nothing has to be listed by selector, and a view added
// later is themed automatically. The old approach (a few hundred `!important`
// overrides against specific classes) left everything it hadn't listed in
// slate blue, which is why warm and neutral themes looked muddy.

// Lightness (%) of each Tailwind slate stop — the skeleton every theme's
// scale is built on so contrast ratios stay where the UI was designed.
const SLATE_L = { 50: 98, 100: 96, 200: 91, 300: 84, 400: 65, 500: 47, 600: 35, 700: 28, 800: 17, 900: 12, 950: 5 };
const SLATE_STOPS = Object.keys(SLATE_L).map(Number);

function hexToHsl(hex) {
    let r = parseInt(hex.slice(1,3),16) / 255, g = parseInt(hex.slice(3,5),16) / 255, b = parseInt(hex.slice(5,7),16) / 255;
    const max = Math.max(r,g,b), min = Math.min(r,g,b), l = (max + min) / 2;
    let h = 0, s = 0;
    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        if (max === r)      h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        else if (max === g) h = ((b - r) / d + 2) / 6;
        else                h = ((r - g) / d + 4) / 6;
    }
    return { h: h * 360, s: s * 100, l: l * 100 };
}
function hslToRgb(h, s, l) {
    s /= 100; l /= 100;
    const k = n => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return [f(0), f(8), f(4)].map(v => Math.round(v * 255));
}
const hexToTriplet = hex => [1,3,5].map(i => parseInt(hex.slice(i,i+2),16)).join(' ');
const tripletToHex = t => '#' + t.split(' ').map(n => (+n).toString(16).padStart(2,'0')).join('');

// Compute the eleven --slate-* stops (as "r g b" strings) plus the semantic
// aliases for a theme. Anchors the stops the theme names explicitly
// (base/surface/elevated/borders) and fills the rest along its hue.
function buildThemeVars(t) {
    // Hue and saturation come from the surface colour: on near-black themes
    // the base is too dark to carry a readable hue.
    const ref = hexToHsl(t.surface);
    const dark = !!t.dark;
    // Slate's own text greys sit around 20–40% saturation; keep tinted themes
    // in that band and let genuinely neutral ones (black, charcoal) stay grey.
    const sat = Math.min(dark ? 24 : 12, ref.s * (dark ? 1.0 : 0.6));
    const vars = {};
    // The Slate theme is Tailwind's palette verbatim — no derivation drift.
    if (t.id === 'slate') {
        const exact = { 50:'#f8fafc',100:'#f1f5f9',200:'#e2e8f0',300:'#cbd5e1',400:'#94a3b8',500:'#64748b',600:'#475569',700:'#334155',800:'#1e293b',900:'#0f172a',950:'#020617' };
        for (const stop of SLATE_STOPS) vars[`--slate-${stop}`] = hexToTriplet(exact[stop]);
        return finishThemeVars(vars, t);
    }
    const set = (stop, hex) => { vars[`--slate-${stop}`] = hexToTriplet(hex); };
    const derive = (stop, L) => { vars[`--slate-${stop}`] = hslToRgb(ref.h, sat, L).join(' '); };

    if (dark) {
        set(950, t.base); set(900, t.surface); set(800, t.elevated); set(700, t.borderHi);
        // Mid greys: keep slate's lightness, but nudge them slightly lighter on
        // very dark themes so muted text never sinks into a pure-black base.
        const lift = ref.l < 8 ? 4 : 0;
        for (const stop of [600, 500, 400, 300, 200, 100, 50]) derive(stop, Math.min(98, SLATE_L[stop] + (stop >= 400 ? lift : 0)));
    } else {
        // Light theme: the scale is mirrored — bg-slate-950 is now the lightest
        // surface and text-slate-200 the darkest ink. The theme's named colours
        // anchor the surfaces; ink stops are derived from the mirrored lightness.
        // 800 doubles as "elevated chip" and "hairline" (border-slate-800), and
        // 700 as "hover wash" and "strong hairline", so both anchor to the
        // theme's border colours rather than its elevated surface — on a
        // near-white theme the elevated tint is too faint to read as an edge.
        // Keep the same lightness *distance* from the base that the dark scale
        // has (800 is 12 points off the base, 700 is 23), so chips and
        // hairlines read with the same weight on a light page as on a dark one.
        // The theme's own border colours are too faint for that once they are
        // drawn at the 60% opacity most card borders use.
        set(950, t.base); set(900, t.surface);
        const baseL = hexToHsl(t.base).l;
        // 600 is dim text and icons (text-slate-600 is its main use), so it
        // needs to be ink, not another surface; from there down the stops mirror.
        // Ink follows Apple's light-mode text ramp: #1d1d1f primary (200),
        // #424245 (300), #86868b secondary (400), #aeaeb2 tertiary (600).
        // Chips/fields (800) sit ~7 points under the page (Apple's #f0f0f2 on
        // #f5f5f7); hover washes and strong hairlines (700) ~15 under.
        const mirror = { 800: baseL - 7, 700: baseL - 15, 600: 62, 500: 55, 400: 47, 300: 27, 200: 13, 100: 11, 50: 9 };
        for (const stop of [800, 700, 600, 500, 400, 300, 200, 100, 50]) derive(stop, mirror[stop]);
    }

    return finishThemeVars(vars, t);
}
function finishThemeVars(vars, t) {
    const dark = !!t.dark;
    vars['--bg-base']    = t.gradient ? 'transparent' : t.base;
    vars['--bg-surface'] = t.surface;
    vars['--bg-elev']    = t.elevated;
    vars['--bg-border']  = t.border;
    vars['--bg-borderh'] = t.borderHi;
    vars['--input-bg']   = t.inputBg || t.elevated;
    vars['--text-1'] = `rgb(${vars['--slate-100']})`;
    vars['--text-2'] = `rgb(${vars['--slate-300']})`;
    vars['--text-3'] = `rgb(${vars['--slate-400']})`;
    vars['--text-4'] = `rgb(${vars['--slate-500']})`;
    vars['--ink-rgb'] = dark ? '255 255 255' : '0 0 0';
    return vars;
}

function applyBackground(theme) {
    if (typeof renderSettingsModal === 'function') renderSettingsModal._thumbs = null;
    const root = document.documentElement;
    const vars = buildThemeVars(theme);
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
    root.dataset.bg    = theme.id;
    root.dataset.theme = theme.dark ? 'dark' : 'light';
    root.style.colorScheme = theme.dark ? 'dark' : 'light';
    // Native window background = page colour, so resizes never flash black.
    try { ipcRenderer.send('window:set-bg', theme.base); } catch (_) {}

    // Persist the computed variables so the inline <head> script can apply
    // them before first paint next launch (it must not depend on this file).
    try {
        const json = JSON.stringify(vars);
        if (JSON.stringify(settingsData.themeVars || null) !== json) {
            settingsData.themeVars = vars;
            settingsData.themeDark = !!theme.dark;
            saveSettingsData();
        }
    } catch (_) {}

    let el = document.getElementById('vulsor-bg-override');
    if (!el) {
        el = document.createElement('style');
        el.id = 'vulsor-bg-override';
        document.head.appendChild(el);
    }
    el.textContent = generateBackgroundCSS(theme);
}

// The little that can't be expressed by the palette swap: the body gradient
// for "metallic", and inline dark backgrounds on a few view shells.
function generateBackgroundCSS(t) {
    const body = t.gradient
        ? `body { background-color: ${t.base} !important; background-image: ${t.gradient} !important; background-attachment: fixed !important; }
#main-area, .app-view { background-color: transparent !important; }`
        : `body { background-color: ${t.base} !important; background-image: none !important; }`;
    return `
/* ── Vulsor background theme: ${t.id} ── */
${body}
#boot-screen { background-color: ${t.base} !important; }
#user-input, .mail-inp, .ed-ins-input, .res-md-input { background-color: var(--input-bg) !important; }
`;
}

function generateThemeCSS(a) {
    const shadow = `0 4px 6px -1px rgba(${a.rgb},0.25), 0 2px 4px -2px rgba(${a.rgb},0.1)`;
    return `
/* ── Vulsor accent theme: ${a.hex} ── */

/* ── Accent-colored fill buttons ── */
#new-chat-btn, #send-btn, #voice-mic-btn,
#add-cmd-btn, #vault-folder-modal-save,
#vault-add-btn, #todo-view-add-btn, #add-cat-btn,
#study-start-btn, #study-add-subject-btn, #study-settings-save-btn,
#settings-apply-btn {
    background-color: ${a.hex} !important;
    box-shadow: ${shadow} !important;
}
#new-chat-btn:hover, #send-btn:hover,
#add-cmd-btn:hover, #vault-folder-modal-save:hover,
#vault-add-btn:hover, #todo-view-add-btn:hover, #add-cat-btn:hover,
#study-start-btn:hover, #study-add-subject-btn:hover, #study-settings-save-btn:hover,
#settings-apply-btn:hover { background-color: ${a.hover} !important; }
#new-chat-btn:active, #send-btn:active { background-color: ${darkenHex(a.hover,0.1)} !important; }

/* ── Boot screen logo ── */
#boot-screen .bg-red-600 {
    background-color: ${a.hex} !important;
    box-shadow: 0 20px 25px -5px rgba(${a.rgb},0.4) !important;
}

/* ── Sidebar Vulsor logo badge ── */
#app-sidebar .bg-red-600 { background-color: ${a.hex} !important; }

/* ── Voice ── */
#voice-mic-btn:not(.voice-listening):not(.voice-speaking):hover { background-color: ${a.hover} !important; }
.voice-listening { background-color: ${a.hex} !important; }
.wave-bar { background-color: ${a.light} !important; }

/* ── Tab bar icon buttons hover ── */
#voice-mode-btn:hover {
    background-color: ${a.hex} !important;
    border-color: ${a.hex} !important;
    color: #fff !important;
}
#commands-btn:hover {
    background: rgba(${a.rgb},0.15) !important;
    color: ${a.light} !important;
    border-color: rgba(${a.rgb},0.3) !important;
}
#new-window-btn:hover, #share-app-btn:hover { color: ${a.light} !important; }
#settings-btn:hover {
    background: rgba(${a.rgb},0.12) !important;
    color: ${a.light} !important;
    border-color: rgba(${a.rgb},0.3) !important;
}

/* ── Active tab ── */
.tab-btn.active {
    background: rgba(${a.rgb},0.12) !important;
    color: ${a.light} !important;
    border-color: rgba(${a.rgb},0.3) !important;
}

/* ── Section header icons (decorative accent icons in view headers) ── */
#view-todos   i.fa-check-square,
#view-study   i.fa-graduation-cap,
#view-vault   i.fa-folder-open,
#view-journal i.fa-book-open,
#view-study   i.fa-list,
#view-study   i.fa-book,
#view-todos   i.fa-tag,
#view-study   i.fa-sliders-h { color: ${a.light} !important; }

/* ── All focus borders ── */
input:focus, textarea:focus, select:focus {
    border-color: rgba(${a.rgb},0.65) !important;
}

/* ── Due chip hovers ── */
.due-chip:hover {
    border-color: rgba(${a.rgb},0.5) !important;
    color: ${a.light} !important;
}

/* ── Remove image hover ── */
#remove-image-btn:hover { background-color: ${a.hex} !important; }

/* ── Tool card left border ── */
.tool-card { border-left-color: rgba(${a.rgb},0.5) !important; }

/* ── Cmd suggestions hover ── */
#cmd-suggestions .cmd-item:hover { background: rgba(${a.rgb},0.12) !important; }

/* ── Vault ── */
#vault-back-btn:hover { color: ${a.light} !important; background: rgba(${a.rgb},0.08) !important; }
#vault-notes-resizer:hover, #vault-notes-resizer:active { background-color: rgba(${a.rgb},0.4) !important; }
#vault-new-doc-sidebar-btn:hover { color: ${a.light} !important; }
#vault-new-folder-btn:hover { color: ${a.light} !important; }
#vault-doc-editor { caret-color: ${a.hex} !important; }
#vault-search:focus { border-color: rgba(${a.rgb},0.65) !important; }

/* ── Journal ── */
#journal-today-btn {
    background: rgba(${a.rgb},0.15) !important;
    border-color: rgba(${a.rgb},0.25) !important;
    color: ${a.light} !important;
}
#journal-today-badge {
    background: rgba(${a.rgb},0.2) !important;
    color: ${a.light} !important;
    border-color: rgba(${a.rgb},0.2) !important;
}
/* Journal icon badge bg/border */
#view-journal .rounded-xl.border { border-color: rgba(${a.rgb},0.3) !important; }
#view-journal .rounded-xl.border i { color: ${a.light} !important; }

/* ── Study timer ring animation ── */
.study-ring-progress { stroke: ${a.hex} !important; }

/* ── Study period/mode buttons (active) ── */
.study-period-btn.active, .todo-mode-btn.active {
    background: rgba(${a.rgb},0.15) !important;
    color: ${a.light} !important;
    border-color: rgba(${a.rgb},0.35) !important;
}

/* ── Study settings btn hover ── */
#study-settings-btn:hover { color: ${a.light} !important; }

/* ── Chat ── */
.active-chat {
    background: rgba(${a.rgb},0.12) !important;
    border-left-color: ${a.hex} !important;
    color: ${a.light} !important;
}

/* ── Journal sidebar active entry ── */
.journal-sidebar-entry.active-entry,
#journal-entry-list .journal-sidebar-entry[data-active="true"] {
    background: rgba(${a.rgb},0.10) !important;
    border-color: rgba(${a.rgb},0.20) !important;
}
.journal-sidebar-entry .entry-date-active { color: ${a.light} !important; }
.journal-sidebar-entry .entry-today-badge {
    background: rgba(${a.rgb},0.20) !important;
    color: ${a.light} !important;
}

/* ── Todo checkboxes (done = filled with accent) ── */
.todo-checkbox-done {
    background-color: ${a.hex} !important;
    border-color: ${a.hex} !important;
}
.todo-checkbox:not(.todo-checkbox-done):hover {
    border-color: ${a.hex} !important;
}
/* Todo edit-mode save button */
.todo-edit-save {
    background-color: ${a.hex} !important;
}
.todo-edit-save:hover { background-color: ${a.hover} !important; }
/* Todo item being edited border */
.todo-item-editing {
    border-color: rgba(${a.rgb},0.40) !important;
}
/* Due chip active state */
.due-chip-active {
    border-color: rgba(${a.rgb},0.50) !important;
    color: ${a.light} !important;
}

/* ── Vault sidebar active folder/all ── */
.vault-sidebar-active {
    background: rgba(${a.rgb},0.12) !important;
    color: ${a.light} !important;
    border-color: rgba(${a.rgb},0.25) !important;
}

/* ── Docs active tab ── */
.doc-tab-active {
    background-color: ${a.hex} !important;
    border-color: ${a.hover} !important;
}

/* ── Finance chart type / period active buttons ── */
.finance-type-btn.active, .finance-period-btn.active {
    background: rgba(${a.rgb},0.15) !important;
    color: ${a.light} !important;
    border-color: rgba(${a.rgb},0.35) !important;
}

/* ── Lists tab active ── */
.list-tab-btn.active {
    background: rgba(${a.rgb},0.12) !important;
    color: ${a.light} !important;
    border-color: rgba(${a.rgb},0.3) !important;
}

/* ── Physics Sandbox ── */
#vault-physics-area i.fa-atom { color: ${a.light} !important; }
#phys-mode-2d, #phys-mode-3d {
    /* base state – active state handled via JS style */
    transition: background 0.15s, color 0.15s;
}
#phys-speed-label { color: ${a.light} !important; }
#phys-play-btn:hover, #phys-reset-btn:hover { color: ${a.light} !important; }
#phys-controls .phys-mode-btn-active,
.phys-sim-btn.active {
    background: rgba(${a.rgb},0.15) !important;
    color: ${a.light} !important;
    border-color: rgba(${a.rgb},0.35) !important;
}

/* ── Graph / Plotter ── */
#vault-graph-area i.fa-chart-line { color: ${a.light} !important; }
#graph-mode-2d, #graph-mode-3d, #graph-mode-matrix {
    transition: background 0.15s, color 0.15s;
}
#graph-add-expr {
    background: rgba(${a.rgb},0.2) !important;
    color: ${a.light} !important;
}
#graph-add-expr:hover { background: rgba(${a.rgb},0.35) !important; }

/* Graph window panel focus borders */
#graph-window-panel input:focus { border-color: rgba(${a.rgb},0.6) !important; }
.graph-expr-inp:focus           { border-color: rgba(${a.rgb},0.6) !important; }

/* ── Math keyboard ── */
.mkb-tab-active {
    color: ${a.light} !important;
    border-color: ${a.hex} !important;
}
.mkb-enter-key {
    background: rgba(${a.rgb},0.3) !important;
    color: ${a.light} !important;
    border: 1px solid rgba(${a.rgb},0.4) !important;
}
.mkb-enter-key:hover { background: rgba(${a.rgb},0.45) !important; }

/* ── Matrix calculator ── */
#mat-add-btn {
    background: rgba(${a.rgb},0.2) !important;
    color: ${a.light} !important;
}
#mat-add-btn:hover { background: rgba(${a.rgb},0.35) !important; }
#graph-matrix-wrap i.fa-th-large { color: ${a.light} !important; }
/* Matrix name inputs */
#mat-list input[type=text]:first-child { color: ${a.light} !important; }
/* Matrix quick-op buttons hover */
.mat-op-btn:hover {
    background: rgba(${a.rgb},0.2) !important;
    color: ${a.light} !important;
    border-color: rgba(${a.rgb},0.35) !important;
}
/* Two-matrix calc button */
#graph-matrix-wrap button.mkb-calc-btn,
#graph-matrix-wrap .mat-calc-btn {
    background: rgba(${a.rgb},0.2) !important;
    color: ${a.light} !important;
    border-color: rgba(${a.rgb},0.3) !important;
}
/* Result label colour */
.mat-result-label { color: ${a.light} !important; }
/* Matrix name inputs */
.mat-name-inp { color: ${a.light} !important; }
.mat-name-inp:focus { border-color: rgba(${a.rgb},0.6) !important; }
/* Matrix cell inputs */
.mat-cell-inp:focus { border-color: rgba(${a.rgb},0.6) !important; }
/* Store button */
.mat-store-btn:hover { color: ${a.light} !important; border-color: rgba(${a.rgb},0.4) !important; }

/* ── Physics sims mode row buttons ── */
#phys-controls button[data-sim].active {
    background: rgba(${a.rgb},0.15) !important;
    color: ${a.light} !important;
    border-color: rgba(${a.rgb},0.35) !important;
}
`;
}

function getCurrentAccent() {
    if (settingsData.customAccent) {
        return buildAccentFromHex(settingsData.customAccent);
    }
    return ACCENT_PRESETS[settingsData.accentIndex ?? 0];
}

function renderSettingsModal() {
    // ── Animated home background ──
    const hbGrid = document.getElementById('home-bg-grid');
    if (hbGrid) {
        const cur = settingsData.homeBg || 'plexus';
        // Light themes paint the wash renditions (see neural-bg.js), so the
        // swatch previews the wash rather than the night-sky version.
        const lightTheme = document.documentElement.dataset.theme === 'light';
        const LIGHT_SWATCH = {
            plexus:    'radial-gradient(60% 70% at 30% 35%, rgba(99,102,241,.35), transparent), radial-gradient(55% 65% at 75% 65%, rgba(56,189,248,.32), transparent), #f5f6fa',
            stars:     'radial-gradient(60% 70% at 25% 60%, rgba(56,189,248,.32), transparent), radial-gradient(55% 65% at 75% 30%, rgba(129,140,248,.30), transparent), #f5f6fa',
            blackhole: 'radial-gradient(60% 70% at 30% 40%, rgba(251,146,60,.32), transparent), radial-gradient(55% 65% at 75% 65%, rgba(248,113,113,.28), transparent), #faf6f3',
            galaxy:    'radial-gradient(60% 70% at 30% 35%, rgba(251,191,36,.30), transparent), radial-gradient(55% 65% at 72% 65%, rgba(56,189,248,.28), transparent), #f8f7f3',
            nebula:    'radial-gradient(60% 70% at 30% 35%, rgba(244,114,182,.32), transparent), radial-gradient(55% 65% at 72% 62%, rgba(56,189,248,.30), transparent), #f8f5f9',
            warp:      'radial-gradient(60% 70% at 25% 40%, rgba(56,189,248,.32), transparent), radial-gradient(55% 65% at 75% 60%, rgba(34,211,238,.28), transparent), #f3f8fa',
            aurora:    'radial-gradient(60% 80% at 25% 30%, rgba(139,92,246,.32), transparent), radial-gradient(60% 80% at 75% 65%, rgba(16,185,129,.28), transparent), #f5f5f8',
            waves:     'radial-gradient(60% 70% at 30% 70%, rgba(99,102,241,.30), transparent), radial-gradient(55% 65% at 72% 30%, rgba(56,189,248,.28), transparent), #f4f6fa',
            embers:    'radial-gradient(60% 70% at 30% 65%, rgba(251,146,60,.32), transparent), radial-gradient(55% 65% at 72% 30%, rgba(244,114,182,.26), transparent), #faf6f2',
            mesh:      'radial-gradient(60% 80% at 25% 30%, rgba(56,189,248,.35), transparent), radial-gradient(60% 80% at 75% 65%, rgba(244,114,182,.32), transparent), #f5f5f8',
            fireflies: 'radial-gradient(circle at 25% 60%, rgba(202,138,4,.8) 0 1.5px, rgba(202,138,4,.2) 4px, transparent 7px), radial-gradient(circle at 65% 35%, rgba(22,163,74,.7) 0 1.5px, transparent 5px), radial-gradient(circle at 80% 70%, rgba(2,132,199,.7) 0 1.5px, transparent 5px), #f6f6f8',
            dots:      'radial-gradient(circle, rgba(0,0,0,.18) 0 1px, transparent 1.6px) 0 0 / 9px 9px, linear-gradient(100deg, transparent 35%, rgba(99,102,241,.35) 50%, transparent 65%), #f5f5f8',
            none:      'linear-gradient(135deg, #f5f5f7, #ececf0)',
        };
        // Real thumbnails rendered by the engine (cached per theme); the CSS
        // swatches are the fallback if it isn't available yet.
        const thumbKey = lightTheme ? 'light' : 'dark';
        renderSettingsModal._thumbs = renderSettingsModal._thumbs || {};
        const thumbs = renderSettingsModal._thumbs[thumbKey] = renderSettingsModal._thumbs[thumbKey] || {};
        const thumbFor = (id) => {
            if (id === 'none' || typeof window.renderHomeBackgroundThumb !== 'function') return null;
            if (!(id in thumbs)) { try { thumbs[id] = window.renderHomeBackgroundThumb(id, 132, 46); } catch (_) { thumbs[id] = null; } }
            return thumbs[id];
        };
        hbGrid.innerHTML = HOME_BGS.map(b => {
            const on = cur === b.id;
            const thumb = thumbFor(b.id);
            const bg = thumb ? `url(${thumb}) center / cover no-repeat` : (lightTheme ? (LIGHT_SWATCH[b.id] || b.swatch) : b.swatch);
            return `<button class="home-bg-btn flex flex-col items-center gap-1.5" data-hbg="${b.id}" title="${b.desc}">
                <div class="w-full rounded-lg border-2 transition-all" style="height:46px;background:${bg};background-color:${lightTheme ? '#f5f5f7' : '#070b18'};border-color:${on ? 'var(--accent,#dc2626)' : 'rgba(148,163,184,0.18)'}"></div>
                <span class="text-[10px] font-medium ${on ? '' : 'text-slate-500'}" style="${on ? 'color:var(--accent-light)' : ''}">${b.name}</span>
            </button>`;
        }).join('');
        hbGrid.querySelectorAll('.home-bg-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                settingsData.homeBg = btn.dataset.hbg;
                saveSettingsData();
                applyHomeBackground();
                renderSettingsModal();
            });
        });
    }

    // ── Background theme swatch grid ──
    const bgGrid = document.getElementById('bg-theme-grid');
    if (bgGrid) {
        const curId = settingsData.bgTheme || 'slate';
        bgGrid.innerHTML = BG_THEMES.map(t => {
            const active = curId === t.id;
            return `<button class="bg-swatch-btn flex flex-col items-center gap-1.5" data-bg="${t.id}" title="${t.name}">
                <div class="w-full rounded-lg overflow-hidden border-2 transition-all" style="height:38px;background:${t.gradient || t.preview};border-color:${active ? 'var(--accent,#dc2626)' : 'rgba(148,163,184,0.18)'}">
                    <div class="w-full h-full flex">
                        <div style="width:30%;height:100%;background:${t.surface}"></div>
                        <div style="flex:1;padding:5px"><div style="height:4px;border-radius:2px;background:${t.elevated};margin-bottom:3px"></div><div style="height:4px;width:65%;border-radius:2px;background:${t.elevated}"></div></div>
                    </div>
                </div>
                <span class="text-[10px] font-medium ${active ? '' : 'text-slate-500'}" style="${active ? 'color:var(--accent-light)' : ''}">${t.name}</span>
            </button>`;
        }).join('');
        bgGrid.querySelectorAll('.bg-swatch-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                settingsData.bgTheme = btn.dataset.bg;
                settingsData.customBg = null;
                saveSettingsData();
                applyBackground(getCurrentBgTheme());
                renderSettingsModal();
            });
        });
    }

    const grid = document.getElementById('settings-accent-grid');
    if (!grid) return;
    grid.innerHTML = ACCENT_PRESETS.map((p, i) => {
        const active = !settingsData.customAccent && settingsData.accentIndex === i;
        return `<div class="accent-swatch ${active ? 'active' : ''}"
            style="background:${p.hex}"
            title="${p.name}"
            data-index="${i}"></div>`;
    }).join('');

    grid.querySelectorAll('.accent-swatch').forEach(sw => {
        sw.addEventListener('click', () => {
            settingsData.accentIndex = parseInt(sw.dataset.index);
            settingsData.customAccent = null;
            saveSettingsData();
            applyAccent(ACCENT_PRESETS[settingsData.accentIndex]);
            renderSettingsModal();
        });
    });

    // Custom accent color input
    const customInput = document.getElementById('settings-custom-color');
    if (customInput) {
        customInput.value = settingsData.customAccent || getCurrentAccent().hex;
        customInput.oninput = () => {
            const hex = customInput.value;
            if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
                settingsData.customAccent = hex;
                settingsData.accentIndex = -1;
                saveSettingsData();
                applyAccent(buildAccentFromHex(hex));
                // Deselect swatches
                grid.querySelectorAll('.accent-swatch').forEach(s => s.classList.remove('active'));
            }
        };
    }

    // ── Home background intensity ──
    const intInput = document.getElementById('home-bg-intensity');
    if (intInput && !intInput._wired) {
        intInput._wired = true;
        const val = document.getElementById('home-bg-intensity-val');
        const paint = k => {
            intInput.value = Math.round(k * 100);
            intInput.style.setProperty('--fill', ((k - 0.25) / (2.5 - 0.25) * 100).toFixed(1) + '%');
            if (val) val.textContent = Math.round(k * 100) + '%';
        };
        const commit = (pct, save) => {
            settingsData.homeBgIntensity = Math.max(0.25, Math.min(2.5, (Number(pct) || 100) / 100));
            paint(settingsData.homeBgIntensity);
            if (typeof window.setHomeBackgroundIntensity === 'function') window.setHomeBackgroundIntensity(settingsData.homeBgIntensity);
            if (save) saveSettingsData();
        };
        intInput.addEventListener('input',  () => commit(intInput.value, false));
        intInput.addEventListener('change', () => commit(intInput.value, true));
        document.getElementById('home-bg-intensity-reset')?.addEventListener('click', () => commit(100, true));
        paint(settingsData.homeBgIntensity ?? 1);
    }

    // ── Home background speed ──
    const spdInput = document.getElementById('home-bg-speed');
    if (spdInput && !spdInput._wired) {
        spdInput._wired = true;
        const val = document.getElementById('home-bg-speed-val');
        const paint = k => {
            spdInput.value = Math.round(k * 100);
            spdInput.style.setProperty('--fill', ((k - 0.25) / (3 - 0.25) * 100).toFixed(1) + '%');
            if (val) val.textContent = Math.round(k * 100) + '%';
        };
        const commit = (pct, save) => {
            settingsData.homeBgSpeed = Math.max(0.25, Math.min(3, (Number(pct) || 100) / 100));
            paint(settingsData.homeBgSpeed);
            if (typeof window.setHomeBackgroundSpeed === 'function') window.setHomeBackgroundSpeed(settingsData.homeBgSpeed);
            if (save) saveSettingsData();
        };
        spdInput.addEventListener('input',  () => commit(spdInput.value, false));
        spdInput.addEventListener('change', () => commit(spdInput.value, true));
        document.getElementById('home-bg-speed-reset')?.addEventListener('click', () => commit(100, true));
        paint(settingsData.homeBgSpeed ?? 1);
    }

    // ── Home icon size ──
    const sizeInput = document.getElementById('home-icon-size');
    if (sizeInput && !sizeInput._wired) {
        sizeInput._wired = true;
        const val = document.getElementById('home-icon-size-val');
        const presets = document.getElementById('home-icon-size-presets');
        const paint = (px) => {
            sizeInput.value = px;
            sizeInput.style.setProperty('--fill', ((px - HOME_ICON_MIN) / (HOME_ICON_MAX - HOME_ICON_MIN) * 100).toFixed(1) + '%');
            if (val) val.textContent = px + ' px';
            presets?.querySelectorAll('.home-size-preset').forEach(b => b.classList.toggle('active', Number(b.dataset.size) === px));
        };
        const commit = (px, save) => {
            settingsData.homeIconSize = clampHomeIconSize(px);
            paint(settingsData.homeIconSize);
            applyHomeIconSize();               // live preview while dragging
            if (save) saveSettingsData();
        };
        sizeInput.addEventListener('input',  () => commit(sizeInput.value, false));
        sizeInput.addEventListener('change', () => commit(sizeInput.value, true));
        presets?.addEventListener('click', e => {
            const b = e.target.closest('.home-size-preset');
            if (b) commit(b.dataset.size, true);
        });
        paint(clampHomeIconSize(settingsData.homeIconSize));
    }

    // ── Category tile grey swatches ──
    const tileGrid = document.getElementById('cat-tile-grid');
    const current  = settingsData.categoryTileColor || null;   // null = follow the theme
    const _rebuildHome = () => { if (typeof window.rebuildHomePage === 'function') window.rebuildHomePage(); };
    if (tileGrid) {
        // First swatch: "match theme" — the tile shade is derived from the
        // active background so tiles never look blue on a warm theme.
        const themeTile = `rgb(${getComputedStyle(document.documentElement).getPropertyValue('--slate-800').trim().split(/\s+/).join(',')})`;
        const auto = `<div class="accent-swatch ${current ? '' : 'active'}" title="Match theme"
            data-hex="" style="background:${themeTile}; position:relative">
            <i class="fas fa-wand-magic-sparkles" style="position:absolute; inset:0; display:flex; align-items:center; justify-content:center; font-size:10px; color:rgb(var(--slate-300))"></i></div>`;
        tileGrid.innerHTML = auto + CATEGORY_TILE_GREYS.map(g => {
            const active = current && current.toLowerCase() === g.hex.toLowerCase();
            return `<div class="accent-swatch ${active ? 'active' : ''}" title="${g.name}"
                data-hex="${g.hex}" style="background:${g.hex}"></div>`;
        }).join('');
        tileGrid.querySelectorAll('.accent-swatch').forEach(sw => {
            sw.addEventListener('click', () => {
                settingsData.categoryTileColor = sw.dataset.hex || null;
                saveSettingsData();
                _rebuildHome();
                renderSettingsModal();
            });
        });
    }
    const tileCustom = document.getElementById('cat-tile-custom');
    if (tileCustom) {
        tileCustom.value = current || CATEGORY_TILE_GREYS[0].hex;
        tileCustom.oninput = () => {
            const hex = tileCustom.value;
            if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
                settingsData.categoryTileColor = hex;
                saveSettingsData();
                _rebuildHome();
                if (tileGrid) tileGrid.querySelectorAll('.accent-swatch').forEach(s => s.classList.remove('active'));
            }
        };
    }
}

function buildBgFromHex(hex) {
    // Detect luminance to decide dark vs light
    const r = parseInt(hex.slice(1,3),16);
    const g = parseInt(hex.slice(3,5),16);
    const b = parseInt(hex.slice(5,7),16);
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b; // 0–255
    const dark = lum < 128;
    if (dark) {
        return {
            id: 'custom', name: 'Custom', preview: hex, dark: true,
            base:     hex,
            surface:  lightenHex(hex, 0.07),
            elevated: lightenHex(hex, 0.14),
            border:   lightenHex(hex, 0.10),
            borderHi: lightenHex(hex, 0.20),
            inputBg:  lightenHex(hex, 0.10),
        };
    } else {
        return {
            id: 'custom', name: 'Custom', preview: hex, dark: false,
            base:     hex,
            surface:  lightenHex(hex, 0.15),
            elevated: lightenHex(hex, 0.28),
            border:   darkenHex(hex, 0.12),
            borderHi: darkenHex(hex, 0.22),
            inputBg:  lightenHex(hex, 0.20),
        };
    }
}

function getCurrentBgTheme() {
    if (settingsData.customBg) return buildBgFromHex(settingsData.customBg);
    // A saved theme that no longer exists (the retired light ones) falls back to Slate.
    return BG_THEMES.find(t => t.id === (settingsData.bgTheme || 'slate')) || BG_THEMES[0];
}

// ── Wallpaper (home page only) ─────────────────────────────────────
const WALLPAPER_FITS = { fill: 'cover', fit: 'contain', stretch: '100% 100%' };

function applyWallpaper(src, fit) {
    const home = document.getElementById('view-home');
    // Clear any stale body-level styling from older versions
    document.body.style.backgroundImage = '';

    let style = document.getElementById('vulsor-wallpaper-style');
    if (!style) {
        style = document.createElement('style');
        style.id = 'vulsor-wallpaper-style';
        document.head.appendChild(style);
    }

    if (!home) return;
    if (src) {
        const fitMode = fit || settingsData.wallpaperFit || 'fill';
        const size    = WALLPAPER_FITS[fitMode] || 'cover';
        home.style.backgroundImage    = `url("${src.replace(/\\/g,'\\\\').replace(/"/g,'\\"')}")`;
        home.style.backgroundSize     = size;
        home.style.backgroundPosition = 'center';
        home.style.backgroundRepeat   = 'no-repeat';
        home.style.backgroundColor    = '#0a0f1a'; // letterbox fill for "Fit" mode
        // Keep the category tiles solid/opaque so they stay readable over the image
        style.textContent = `
            #view-home .home-shortcut-tile {
                background: rgba(10,15,26,0.80) !important;
                box-shadow: 0 6px 20px rgba(0,0,0,0.45);
            }
            #view-home .home-shortcut-tile:hover { background: rgba(20,28,44,0.90) !important; }
            #view-home .home-shortcut-label { color: rgb(var(--slate-200)); }
            #view-home .home-greeting-title,
            #view-home .home-greeting-sub { text-shadow: 0 2px 14px rgba(0,0,0,0.75); }
        `;
    } else {
        home.style.backgroundImage    = '';
        home.style.backgroundSize     = '';
        home.style.backgroundPosition = '';
        home.style.backgroundRepeat   = '';
        home.style.backgroundColor    = '';
        style.textContent = '';
    }
}

function _updateWallpaperPreview() {
    const src = settingsData.wallpaper;
    const prev = document.getElementById('wallpaper-preview');
    const img  = document.getElementById('wallpaper-preview-img');
    const fitRow = document.getElementById('wallpaper-fit-row');
    if (!prev || !img) return;
    if (src) {
        img.src = src.startsWith('/') || src.startsWith('C:') ? `file://${src}` : src;
        prev.style.display = '';
        if (fitRow) fitRow.style.display = '';
    } else {
        prev.style.display = 'none';
        if (fitRow) fitRow.style.display = 'none';
    }
    // Highlight the active fit button
    const active = settingsData.wallpaperFit || 'fill';
    document.querySelectorAll('.wallpaper-fit-btn').forEach(b => {
        const on = b.dataset.fit === active;
        b.style.borderColor = on ? 'var(--accent)' : '';
        b.style.color       = on ? 'var(--accent-light)' : '';
    });
}

function initSettings() {
    loadSettingsData();
    applyAccent(getCurrentAccent());
    applyBackground(getCurrentBgTheme());
    applyHomeBackground();
    applyHomeIconSize();
    if (settingsData.wallpaper) applyWallpaper(settingsData.wallpaper, settingsData.wallpaperFit);

    const settingsBtn    = document.getElementById('settings-btn');
    const settingsModal  = document.getElementById('settings-modal');
    const settingsClose  = document.getElementById('settings-close-btn');
    const backdrop       = document.getElementById('settings-modal');

    settingsBtn.addEventListener('click', () => {
        settingsModal.classList.add('open');
        renderSettingsModal();
        _updateWallpaperPreview();
    });
    settingsClose.addEventListener('click', () => settingsModal.classList.remove('open'));
    backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) settingsModal.classList.remove('open');
    });

    // ── Wallpaper picker ──
    const { ipcRenderer } = require('electron');

    document.getElementById('wallpaper-pick-btn')?.addEventListener('click', async () => {
        try {
            // Use ipcRenderer to show open dialog via main process
            const result = await ipcRenderer.invoke('show-open-dialog', {
                title: 'Choose wallpaper',
                filters: [{ name: 'Images', extensions: ['png','jpg','jpeg','webp','gif'] }],
                properties: ['openFile'],
            });
            if (result && !result.canceled && result.filePaths.length) {
                const fp = result.filePaths[0];
                settingsData.wallpaper = fp;
                saveSettingsData();
                applyWallpaper(fp);
                _updateWallpaperPreview();
            }
        } catch(e) {
            // Fallback: file input
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/*';
            input.onchange = () => {
                const f = input.files[0];
                if (!f) return;
                const fp = (typeof webUtils !== 'undefined' ? webUtils.getPathForFile(f) : null) || f.path || '';
                if (!fp) return;
                settingsData.wallpaper = fp;
                saveSettingsData();
                applyWallpaper(fp);
                _updateWallpaperPreview();
            };
            input.click();
        }
    });

    document.getElementById('wallpaper-clear-btn')?.addEventListener('click', () => {
        settingsData.wallpaper = null;
        saveSettingsData();
        applyWallpaper(null);
        _updateWallpaperPreview();
    });

    // Display / fit mode buttons
    document.querySelectorAll('.wallpaper-fit-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            settingsData.wallpaperFit = btn.dataset.fit;
            saveSettingsData();
            if (settingsData.wallpaper) applyWallpaper(settingsData.wallpaper, settingsData.wallpaperFit);
            _updateWallpaperPreview();
        });
    });
}
