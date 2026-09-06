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
];

const BG_THEMES = [
    // ── Dark ──
    { id: 'slate',    name: 'Slate',     preview: '#020617', base: '#020617', surface: '#0f172a', elevated: '#1e293b', border: '#1e293b', borderHi: '#334155', inputBg: '#1e293b', dark: true  },
    { id: 'black',    name: 'Black',     preview: '#000000', base: '#000000', surface: '#0c0c0c', elevated: '#161616', border: '#202020', borderHi: '#2a2a2a', inputBg: '#141414', dark: true  },
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

    // ── Light. Apple's neutrals: near-white surfaces, hairline dividers, and
    //    no blue cast — the old silver/white pair was a muddy blue-grey. ──
    { id: 'white',    name: 'White',     preview: '#ffffff', base: '#ffffff', surface: '#fbfbfd', elevated: '#f5f5f7', border: '#e4e4e7', borderHi: '#d2d2d7', inputBg: '#ffffff', dark: false },
    { id: 'silver',   name: 'Silver',    preview: '#f0f0f2', base: '#f5f5f7', surface: '#ffffff', elevated: '#fbfbfd', border: '#dcdce0', borderHi: '#c6c6cc', inputBg: '#ffffff', dark: false },
    { id: 'mist',     name: 'Mist',      preview: '#eef1f6', base: '#eef1f6', surface: '#fafbfd', elevated: '#ffffff', border: '#dde2ea', borderHi: '#c5ccd8', inputBg: '#ffffff', dark: false },
    { id: 'paper',    name: 'Paper',     preview: '#faf7f2', base: '#f7f4ee', surface: '#fffdf9', elevated: '#fbf8f2', border: '#e6e0d5', borderHi: '#d3cabb', inputBg: '#fffdf9', dark: false },
];

let settingsData = { accentIndex: 0, customAccent: null, bgTheme: 'slate', customBg: null, wallpaper: null, wallpaperFit: 'fill', homeBg: 'plexus', categoryColors: {}, categoryIcons: {}, categoryTileColor: null, homeItems: null, homeSites: [], archived: [] };

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
    { id: 'none',   name: 'None', desc: 'Plain background',
      swatch: 'linear-gradient(135deg, #0b1020, #05070f)' },
];

// Hand the chosen style to the renderer. Safe to call before it has loaded.
function applyHomeBackground() {
    try { if (typeof window.setHomeBackground === 'function') window.setHomeBackground(settingsData.homeBg || 'plexus'); }
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
            settingsData = { ...settingsData, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) };
        }
    } catch(e) {}
}

function saveSettingsData() {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settingsData, null, 2));
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

function applyBackground(theme) {
    let el = document.getElementById('vulsor-bg-override');
    if (!el) {
        el = document.createElement('style');
        el.id = 'vulsor-bg-override';
        document.head.appendChild(el);
    }
    el.textContent = generateBackgroundCSS(theme);
    // Store on root for other uses
    document.documentElement.dataset.bg    = theme.id;
    document.documentElement.dataset.theme = theme.dark ? 'dark' : 'light';
}

function generateBackgroundCSS(t) {
    const light = !t.dark;
    // For gradient (metallic) themes, content areas are transparent so the body
    // gradient shows through; otherwise they use the solid base color.
    const viewBg = t.gradient ? 'transparent' : t.base;

    // For dark themes: only background/border overrides needed
    const base = `
/* ── Vulsor background theme: ${t.id} ── */
:root {
    --bg-base:    ${t.base};
    --bg-surface: ${t.surface};
    --bg-elev:    ${t.elevated};
    --bg-border:  ${t.border};
    --bg-borderh: ${t.borderHi};
}
body { background-color: ${t.base} !important; ${t.gradient ? `background-image: ${t.gradient} !important; background-attachment: fixed !important;` : 'background-image: none !important;'} }
#boot-screen { background-color: ${t.base} !important; }
#app-sidebar { background-color: ${t.surface} !important; border-right-color: ${t.border} !important; }
#main-area { background-color: ${t.gradient ? 'transparent' : t.base} !important; }
#tab-bar { background-color: ${t.base} !important; border-bottom-color: ${t.border} !important; }
#view-chat, #view-todos, #view-study,
#view-vault, #view-finance, #view-journal { background-color: ${t.base} !important; }
#voice-mode { background-color: ${t.base} !important; }
#settings-modal > div { background-color: ${t.surface} !important; border-color: ${t.borderHi} !important; }
#vault-folder-modal > div { background-color: ${t.surface} !important; border-color: ${t.borderHi} !important; }
#vault-sidebar { background-color: ${t.surface} !important; border-right-color: ${t.border} !important; }
#vault-viewer-view { background-color: ${t.base} !important; }
#vault-notes-sidebar { background-color: ${t.surface} !important; border-left-color: ${t.border} !important; }
.bg-slate-950 { background-color: ${t.base} !important; }
.bg-slate-900 { background-color: ${t.surface} !important; }
.bg-slate-800 { background-color: ${t.elevated} !important; }
.border-slate-800 { border-color: ${t.border} !important; }
.border-slate-700 { border-color: ${t.borderHi} !important; }
.bg-slate-900\\/40, .bg-slate-900\\/60, .bg-slate-900\\/80 { background-color: ${t.surface} !important; }
.bg-slate-800\\/60, .bg-slate-800\\/80 { background-color: ${t.elevated} !important; }
#user-input { background-color: ${t.inputBg} !important; border-color: ${t.borderHi} !important; }
#settings-btn, #new-window-btn, #share-app-btn, #commands-btn, #voice-mode-btn {
    background-color: ${t.elevated} !important;
    border-color: ${t.borderHi} !important;
}`;

    // ── Comprehensive dark-mode element coverage ──────────────────
    const extra = `

/* All views */
#view-home, #view-chat, #view-todos, #view-study, #view-vault,
#view-finance, #view-journal, #view-countdown, #view-calendar, #view-music,
#view-karaoke, #view-chess, #view-tuner, #view-workout,
#view-research, #view-cosmos, #view-camera { background-color: ${t.base} !important; }

/* New categories: side panels, headers, surfaces */
#research-sidebar, #res-sources-panel, #research-main .bg-slate-900\\/40,
#workout-week-grid .wo-day-card, #camera-preview ~ * { }
.bg-slate-900\\/30, .bg-slate-900\\/50 { background-color: ${t.surface} !important; }
#camera-subtitle { background: rgba(0,0,0,0.6) !important; }
.cosmos-card { background-color: ${t.surface} !important; }

/* Browser chrome */
#browser-chrome { background-color: ${t.base} !important; border-bottom-color: ${t.border} !important; }
#tab-strip-row   { background-color: ${t.base} !important; }
#browser-toolbar { background-color: ${t.surface} !important; border-top-color: ${t.border} !important; }
#browser-address-bar { background-color: ${t.elevated} !important; border-color: ${t.border} !important; }

/* App dock */
#app-dock { background-color: ${t.surface} !important; border-right-color: ${t.border} !important; }
.dock-btn { color: ${t.dark ? '#4e5a6e' : '#64748b'} !important; }

/* Tabs */
.browser-tab { background-color: ${t.dark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.04)'} !important; }
.browser-tab.active { background-color: ${t.surface} !important; }
.browser-tab:hover { background-color: ${t.dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.07)'} !important; }

/* Sidebar + chat */
#app-sidebar, #session-list { background-color: ${t.surface} !important; }

/* Chess */
.chess-sidebar { background-color: ${t.surface} !important; }
#chess-play-pane { background-color: ${t.base} !important; }
#chess-learn-pane { background-color: ${t.base} !important; }
#chess-learn-pane > div > div { background-color: ${t.surface} !important; }

/* Vault science areas */
#vault-molecule-area, #vault-periodic-area, #vault-dna-area,
#vault-anatomy-area, #vault-chessstrategy-area { background-color: ${t.base} !important; }
#strat-canvas-wrap { background-color: ${t.base} !important; }
#vault-chessstrategy-area > div:first-child { background-color: ${t.surface} !important; }
#vault-chessstrategy-area > div:last-child   { background-color: ${t.surface} !important; }
#vault-molecule-area > div, #vault-periodic-area > div,
#vault-dna-area > div, #vault-anatomy-area > div:first-child,
#vault-anatomy-area > div:last-child { background-color: ${t.surface} !important; }
#mol-canvas-wrap { background-color: ${t.base} !important; }

/* Vault viewer & editor */
#vault-viewer-view { background-color: ${t.base} !important; }
#vault-normal-view { background-color: ${t.base} !important; }
#vault-doc-editor-area { background-color: ${t.base} !important; }
#vault-code-lang-modal > div, #vault-folder-modal > div,
#vault-share-modal > div, #vault-code-modal > div { background-color: ${t.surface} !important; border-color: ${t.borderHi} !important; }

/* Music / Karaoke */
#view-music .border-b, #view-karaoke .border-b { border-bottom-color: ${t.border} !important; }

/* Calendar */
.cal-cell { background-color: ${t.surface} !important; border-color: ${t.border} !important; }
.cal-cell.today { background-color: ${t.elevated} !important; }
.cal-header { background-color: ${t.base} !important; }

/* Study */
.study-log-row { background-color: ${t.surface} !important; border-color: ${t.border} !important; }
.study-settings-backdrop > div { background-color: ${t.surface} !important; border-color: ${t.borderHi} !important; }

/* Finance */
.finance-row { background-color: ${t.surface} !important; border-color: ${t.border} !important; }

/* Home page */
#view-home { background-color: ${t.base} !important; }
.home-page-inner { color: ${t.dark ? '#e2e8f0' : '#1e293b'} !important; }

/* Modals */
#settings-modal > div { background-color: ${t.surface} !important; border-color: ${t.borderHi} !important; }
#vault-folder-modal > div { background-color: ${t.surface} !important; border-color: ${t.borderHi} !important; }

/* Generic slate overrides */
.border-slate-800\\/80, .border-slate-800\\/60 { border-color: ${t.border} !important; }
.bg-slate-950, .bg-slate-950\\/80 { background-color: ${viewBg} !important; }
.bg-slate-900, .bg-slate-900\\/20, .bg-slate-900\\/30, .bg-slate-900\\/40, .bg-slate-900\\/50, .bg-slate-900\\/60, .bg-slate-900\\/80 { background-color: ${t.surface} !important; }
.bg-slate-800, .bg-slate-800\\/40, .bg-slate-800\\/50, .bg-slate-800\\/60, .bg-slate-800\\/70, .bg-slate-800\\/80 { background-color: ${t.elevated} !important; }
.border-slate-800  { border-color: ${t.border} !important; }
.border-slate-700  { border-color: ${t.borderHi} !important; }
[class*="border-slate-800"] { border-color: ${t.border} !important; }
[class*="border-slate-700"] { border-color: ${t.borderHi} !important; }

/* ── Every category view follows the theme (overrides inline backgrounds) ── */
#view-home, #view-chat, #view-todos, #view-study, #view-vault, #view-finance,
#view-journal, #view-countdown, #view-calendar, #view-music, #view-karaoke, #view-chess, #view-tuner,
#view-workout, #view-research, #view-cosmos, #view-camera, #view-editor, #view-mail {
    background-color: ${viewBg} !important;
    ${t.gradient ? 'background-image: none !important;' : ''}
}
/* Workout */
#view-workout .bg-slate-900\\/40, .wo-day-card { background-color: ${t.surface} !important; }
/* Research */
#research-sidebar, #res-sources-panel, #research-main, #view-research .bg-slate-900\\/30,
#view-research .bg-slate-900\\/40 { background-color: ${t.surface} !important; }
/* Cosmos */
#view-cosmos { background-color: ${viewBg} !important; }
#view-cosmos > div[style*="background"] { background-color: ${t.surface} !important; }
.cosmos-card { background-color: ${t.elevated} !important; }
/* Camera */
#view-camera, #view-camera > div, #view-camera .bg-slate-900\\/40 { background-color: ${viewBg} !important; }
#view-camera .border-l, #view-camera .bg-slate-900\\/30 { background-color: ${t.surface} !important; }
/* Editor */
#view-editor, #view-editor > div { background-color: ${viewBg} !important; }
#view-editor .bg-slate-900\\/30, #view-editor .bg-slate-900\\/40, #view-editor .bg-slate-900\\/50,
#ed-bin, #ed-timeline-scroll, #ed-ruler { background-color: ${t.surface} !important; }
/* Mail */
#view-mail, #view-mail > div { background-color: ${viewBg} !important; }
#view-mail .bg-slate-900\\/40, #view-mail .bg-slate-900\\/20, #view-mail .bg-slate-900\\/30,
#mail-account-list, #mail-list, #mail-reader { background-color: ${t.surface} !important; }
#mail-reader { background-color: ${viewBg} !important; }
/* Dynamically-created modals (settings-backdrop) */
.settings-backdrop > div { background-color: ${t.surface} !important; border-color: ${t.borderHi} !important; }
/* Inputs */
.mail-inp, .ed-ins-input, .res-md-input { background-color: ${t.inputBg} !important; border-color: ${t.borderHi} !important; }
`;

    if (!light) return base + extra;

    // ── Light mode: comprehensive text + surface overrides ──
    const tb = '#1d1d1f'; // base text (near-black)
    const ts = '#424245'; // secondary text
    const tm = '#6e6e73'; // muted text — light enough to recede, dark enough to read
    const bg = t.base;
    const su = t.surface;
    const el = t.elevated;
    const bd = t.border;
    const bh = t.borderHi;

    return base + `

/* ══════════════════════════════════════════════════
   LIGHT MODE — comprehensive overrides
══════════════════════════════════════════════════ */

/* ── Global text ── */
body { color: ${tb} !important; }
* { -webkit-font-smoothing: auto !important; }

/* Slate text classes */
.text-white, .text-slate-100, .text-slate-200 { color: ${tb} !important; }
.text-slate-300, .text-slate-400               { color: ${ts} !important; }
.text-slate-500, .text-slate-600,
.text-slate-700, .text-slate-800               { color: ${tm} !important; }

/* ── All inputs / textareas / selects ── */
input, textarea, select {
    background-color: ${su} !important;
    color: ${tb} !important;
    border-color: ${bh} !important;
}
input::placeholder, textarea::placeholder { color: ${tm} !important; }

/* ── Scrollbar ── */
.chat-scroll::-webkit-scrollbar-thumb { background: ${bh} !important; }

/* ── Tab bar + browser chrome ── */
.browser-tab span, .browser-tab i { color: ${ts} !important; }
.browser-tab.active span, .browser-tab.active i { color: ${tb} !important; }
#browser-addr-text { color: ${tb} !important; }

/* ── App dock buttons ── */
.tab-btn { color: ${ts} !important; }
.tab-btn:hover { color: ${tb} !important; background: rgba(0,0,0,0.06) !important; }
.tab-btn.active { color: ${tb} !important; }

/* ── Sidebar ── */
#app-sidebar { border-right-color: ${bd} !important; }
#session-list { color: ${tb} !important; }
#session-list .text-slate-300, #session-list .text-slate-400 { color: ${ts} !important; }
#session-list [class*="text-slate"] { color: ${ts} !important; }
.active-chat { color: ${tb} !important; }

/* ── Chat ── */
#chat-box { background-color: ${bg} !important; }
.chat-msg { color: ${tb} !important; }
.chat-msg p, .chat-msg li, .chat-msg span,
.chat-msg strong, .chat-msg b,
.chat-msg h1, .chat-msg h2, .chat-msg h3, .chat-msg h4 { color: ${tb} !important; }
.chat-msg code {
    background-color: ${el} !important;
    color: #c0392b !important;
    border-color: ${bh} !important;
}
.chat-msg pre { background-color: #f1f5f9 !important; border-color: ${bh} !important; }
.chat-msg pre code { background: transparent !important; color: ${tb} !important; }
.ai-row { background-color: ${su} !important; border-color: ${bd} !important; }
#user-input { color: ${tb} !important; }
#user-input::placeholder { color: ${tm} !important; }

/* ── Vault sidebar ── */
.vault-folder-row, .vault-sidebar-file { color: ${ts} !important; }
.vault-folder-row:hover, .vault-sidebar-file:hover { color: ${tb} !important; background-color: rgba(0,0,0,0.05) !important; }
#vault-folders-list { color: ${tb} !important; }
#vault-notes-sidebar { color: ${tb} !important; }
.vault-notes-input, #vault-notes-input {
    background-color: ${su} !important;
    color: ${tb} !important;
}

/* ── Vault viewer ── */
#vault-viewer-view [class*="border-slate"] { border-color: ${bd} !important; }
#vault-doc-editor { background-color: #ffffff !important; color: ${tb} !important; }
#vault-doc-footer { background-color: ${su} !important; border-color: ${bd} !important; color: ${ts} !important; }
#vault-doc-toolbar-row { background-color: ${su} !important; border-color: ${bd} !important; }
.docs-tb-btn { color: ${ts} !important; }
.docs-tb-btn:hover { background-color: rgba(0,0,0,0.06) !important; color: ${tb} !important; }
.docs-tb-select { background-color: ${su} !important; color: ${tb} !important; border-color: ${bh} !important; }

/* ── Vault grid cards ── */
.vault-card  { background-color: ${su} !important; border-color: ${bd} !important; }
.vault-card:hover { background-color: ${el} !important; border-color: ${bh} !important; }
.vault-subfolder-card { background-color: ${su} !important; border-color: ${bd} !important; }
.vault-subfolder-card:hover { background-color: ${el} !important; }
.vault-card p, .vault-subfolder-card p { color: ${tb} !important; }

/* ── Vault science / special areas ── */
#vault-physics-area, #vault-graph-area,
#vault-molecule-area, #vault-periodic-area,
#vault-dna-area, #vault-anatomy-area,
#vault-chessstrategy-area, #vault-notebook-area,
#vault-code-area {
    background-color: ${bg} !important;
}
#vault-physics-area > div,
#vault-graph-area > div,
#graph-sidebar, #graph-window-panel,
#graph-matrix-wrap > div:first-child {
    background-color: ${su} !important;
    border-color: ${bd} !important;
}
#phys-2d-controls-bar,
#phys-canvas-wrap,
#graph-canvas-wrap { background-color: ${bg} !important; }
#graph-canvas-2d, #graph-canvas-3d { filter: invert(0); }
/* Math keyboard */
#graph-mathkb { background-color: ${su} !important; border-color: ${bd} !important; }
.mkb-key { background-color: ${el} !important; color: ${tb} !important; border-color: ${bd} !important; }
.mkb-key:hover { background-color: ${bh} !important; }
.mkb-tab { color: ${ts} !important; }
/* Matrix */
#mat-list { color: ${tb} !important; }
.mat-cell-inp { background-color: ${el} !important; color: ${tb} !important; border-color: ${bd} !important; }
#mat-result-area { background-color: ${bg} !important; color: ${tb} !important; }

/* ── Phys controls ── */
#phys-controls button { color: ${ts} !important; }

/* ── Notebook ── */
#notebook-editor { background-color: ${su} !important; color: ${tb} !important; }
.notebook-cell { background-color: ${su} !important; border-color: ${bd} !important; color: ${tb} !important; }
.notebook-cell textarea, .notebook-cell input { background-color: ${el} !important; color: ${tb} !important; }

/* ── Code editor ── */
#vault-code-area { color: ${tb} !important; }

/* ── Study ── */
#study-log-list [class*="text-slate"] { color: ${ts} !important; }
.study-log-row { background-color: ${su} !important; border-color: ${bd} !important; }

/* ── Finance ── */
.finance-row { background-color: ${su} !important; border-color: ${bd} !important; color: ${tb} !important; }
#view-finance [class*="text-slate-3"], #view-finance [class*="text-slate-4"] { color: ${ts} !important; }

/* ── Calendar ── */
.cal-cell { background-color: ${su} !important; border-color: ${bd} !important; color: ${tb} !important; }
.cal-cell.today { background-color: ${el} !important; }

/* ── Journal ── */
#journal-textarea { background-color: ${su} !important; color: ${tb} !important; }
.journal-sidebar-entry { color: ${ts} !important; }

/* ── Modals ── */
#settings-modal { color: ${tb} !important; }
#vault-folder-modal, #vault-code-lang-modal,
#vault-code-modal, #vault-share-modal { color: ${tb} !important; }
#settings-modal p, #settings-modal span, #settings-modal label { color: ${ts} !important; }
/* Settings bg toggle buttons */
#bg-opt-dark span, #bg-opt-light span { /* handled by JS */ }

/* ── Borders throughout ── */
[class*="border-slate-800"], [class*="border-slate-700"] { border-color: ${bd} !important; }

/* ── Todo ── */
.todo-item { color: ${tb} !important; }
.todo-category-header { color: ${ts} !important; }

/* ── Music / Karaoke ── */
#view-music [class*="text-slate"], #view-karaoke [class*="text-slate"] { color: ${ts} !important; }
#music-player-bar { background-color: ${su} !important; border-color: ${bd} !important; }

/* ── Home page ── */
.home-page-inner, #view-home { color: ${tb} !important; }
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
        hbGrid.innerHTML = HOME_BGS.map(b => {
            const on = cur === b.id;
            return `<button class="home-bg-btn flex flex-col items-center gap-1.5" data-hbg="${b.id}" title="${b.desc}">
                <div class="w-full rounded-lg border-2 transition-all" style="height:46px;background:${b.swatch};background-color:#070b18;border-color:${on ? 'var(--accent,#dc2626)' : 'rgba(148,163,184,0.18)'}"></div>
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

    // ── Category tile grey swatches ──
    const tileGrid = document.getElementById('cat-tile-grid');
    const current  = settingsData.categoryTileColor || CATEGORY_TILE_GREYS[0].hex;
    const _rebuildHome = () => { if (typeof window.rebuildHomePage === 'function') window.rebuildHomePage(); };
    if (tileGrid) {
        tileGrid.innerHTML = CATEGORY_TILE_GREYS.map(g => {
            const active = current.toLowerCase() === g.hex.toLowerCase();
            return `<div class="accent-swatch ${active ? 'active' : ''}" title="${g.name}"
                data-hex="${g.hex}" style="background:${g.hex}"></div>`;
        }).join('');
        tileGrid.querySelectorAll('.accent-swatch').forEach(sw => {
            sw.addEventListener('click', () => {
                settingsData.categoryTileColor = sw.dataset.hex;
                saveSettingsData();
                _rebuildHome();
                renderSettingsModal();
            });
        });
    }
    const tileCustom = document.getElementById('cat-tile-custom');
    if (tileCustom) {
        tileCustom.value = current;
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
            #view-home .home-shortcut-label { color: #e2e8f0; }
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
