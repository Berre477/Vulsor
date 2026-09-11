const { app, BrowserWindow, session, ipcMain, Menu, dialog, safeStorage, webContents, components, clipboard } = require('electron');

// ── Video decode: hardware (VideoToolbox) ON ────────────────────────────
// Hardware video decode is REQUIRED for H.265/HEVC — the codec many streaming
// sites serve (e.g. 123movies → hakunaymatata delivers /resource/h265/…). Chromium
// has NO software HEVC decoder, so with hardware decode OFF an HEVC stream plays
// AUDIO + SUBTITLES but shows a BLANK image (videoWidth stays 0). Verified on this
// machine (2026-07-02): with GPU compositing enabled, hardware-decoded video —
// YouTube (H.264) AND 123movies (HEVC) — composites and displays correctly, so the
// old software-only workaround is no longer needed and actively breaks HEVC.
//
// REVERT: the historical "black HTML5 video" bug (a hardware-decoded frame landing
// on a GPU overlay that didn't composite) was under the old all-software GPU mode.
// If black video ever returns, set VULSOR_SW_VIDEO=1 to force software decode again
// (note: that re-breaks HEVC playback — audio-but-no-image).
if (process.env.VULSOR_SW_VIDEO === '1') { try { app.commandLine.appendSwitch('disable-accelerated-video-decode'); } catch (_) {} }

const path   = require('path');
const fs     = require('fs');
const os     = require('os');
const https  = require('https');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
// The four side modules are optional extras (updates, the local control
// endpoint, the remote-access relay, the WhatsApp assistant). If one fails to
// load — a missing dependency after a partial install, say — the app must
// still open; the failed module is replaced by a stub whose every method
// resolves to { ok: false, error } so callers get a clear answer, not a crash.
function safeRequire(modulePath) {
    try { return require(modulePath); }
    catch (e) {
        console.error(`[main] optional module ${modulePath} failed to load:`, e && e.message);
        _mainLog('module-load', `${modulePath}: ${(e && e.stack) || e}`);
        const error = `${path.basename(modulePath)} is unavailable in this install`;
        return new Proxy({}, { get: (_, prop) => (prop === 'then' ? undefined : (async () => ({ ok: false, error }))) });
    }
}
// Main-process log file (userData/logs/main.log) — the only trace a packaged
// build leaves when something goes wrong before a window exists.
function _mainLog(kind, msg) {
    try {
        const dir = path.join(app.getPath('userData'), 'logs');
        fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, 'main.log');
        try { if (fs.statSync(file).size > 512 * 1024) fs.renameSync(file, file + '.1'); } catch (_) {}
        fs.appendFileSync(file, `${new Date().toISOString()} [${kind}] ${msg}\n`);
    } catch (_) {}
}
const { initAutoUpdate } = safeRequire('./updater');
const controlServer = safeRequire('./control-server');
const relay = safeRequire('./relay');
const waBot = safeRequire('./wa-bot');

// ── Verso → Vulsor data migration (one-time) ──────────────────────
// The app was renamed from Verso to Vulsor. Everything the old name owned on
// disk is moved to the new name the first time this build runs, so an existing
// install keeps its vault, Whisper models, cookies, logins and preferences.
//
// The userData move MUST happen here — at require time, before app.whenReady()
// — because Chromium opens Local Storage / Cookies inside userData as soon as
// the app is ready. Renaming after that point would be ignored (or corrupt the
// open handles). Same-volume renames, so renameSync is atomic and cheap even
// for the multi-GB vault; cpSync is only a fallback for a cross-device EXDEV.
function migrateVersoData() {
    const appData  = app.getPath('appData');   // ~/Library/Application Support (darwin)
    const home     = os.homedir();
    const moves = [
        // [ old path, new path ]
        [path.join(home, 'Documents', 'Verso_Memories'), path.join(home, 'Documents', 'Vulsor_Memories')],
        [path.join(home, 'Library', 'Application Support', 'Verso'), path.join(home, 'Library', 'Application Support', 'Vulsor')],
        [path.join(appData, 'verso-ai'), path.join(appData, 'vulsor-ai')],
    ];

    for (const [oldDir, newDir] of moves) {
        try {
            if (!fs.existsSync(oldDir)) continue;             // nothing to migrate
            if (fs.existsSync(newDir)) {
                // Electron may have already created an empty userData dir before
                // we got here. An empty shell is safe to discard; a populated one
                // means the migration already ran, so leave it alone.
                if (fs.readdirSync(newDir).length > 0) continue;
                fs.rmSync(newDir, { recursive: true, force: true });
            }
            try {
                fs.renameSync(oldDir, newDir);
            } catch (err) {
                if (err.code !== 'EXDEV') throw err;
                fs.cpSync(oldDir, newDir, { recursive: true });
                fs.rmSync(oldDir, { recursive: true, force: true });
            }
            console.log('[migrate] Verso → Vulsor:', oldDir, '→', newDir);
        } catch (err) {
            // A failed migration must never block startup — the app falls back
            // to a fresh directory and the old data is left untouched on disk.
            console.error('[migrate] failed for', oldDir, err);
        }
    }

    // Vault blobs are stored as "<id>.verso" (see storedName in vault.js), so the
    // folder move above is not enough — the extension itself has to follow the
    // rename or every stored file becomes unreachable.
    try {
        const vault = path.join(home, 'Documents', 'Vulsor_Memories', 'vault');
        if (fs.existsSync(vault)) {
            let renamed = 0;
            const walk = (dir) => {
                for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                    const full = path.join(dir, entry.name);
                    if (entry.isDirectory()) { walk(full); continue; }
                    if (!entry.name.endsWith('.verso')) continue;
                    const next = full.slice(0, -'.verso'.length) + '.vulsor';
                    if (!fs.existsSync(next)) { fs.renameSync(full, next); renamed++; }
                }
            };
            walk(vault);
            if (renamed) console.log('[migrate] renamed', renamed, '.verso vault files → .vulsor');
        }
    } catch (err) {
        console.error('[migrate] vault extension rename failed', err);
    }
}
migrateVersoData();

// ── Main-process safety net ───────────────────────────────────────
// A throw inside an IPC handler or async callback must not crash the whole
// app (which would kill every window). Log and keep running. This does NOT
// replace per-handler error handling — it's the last line of defence.
process.on('uncaughtException', (err) => {
    console.error('[main uncaughtException]', err);
    _mainLog('uncaught', (err && err.stack) || String(err));
});
process.on('unhandledRejection', (reason) => {
    console.error('[main unhandledRejection]', reason);
    _mainLog('rejection', (reason && reason.stack) || String(reason));
});

// Real filter-list ad-block engine (EasyList + EasyPrivacy — the same lists
// Brave-style blockers use). We do NOT use enableBlockingInSession() (it runs
// match() on EVERY request and segfaults this castlabs Electron build); instead
// we call the engine's match() ourselves, scoped to script/sub_frame/object
// requests only, from the session's onBeforeRequest — see _setupBrowserSession.
let ElectronBlocker = null;
let _fromElectronDetails = null;
try {
    const _abe = require('@ghostery/adblocker-electron');
    ElectronBlocker = _abe.ElectronBlocker;
    _fromElectronDetails = _abe.fromElectronDetails;
} catch (_) {}
// Request types that carry ads/popups (low-frequency, bursty at load) — safe to
// run the engine on. Media/image/css/font/xhr are excluded so the per-request
// match() can never build the sustained load that crashes this build.
const _AD_NET_TYPES = new Set(['script', 'subFrame', 'object']);
let _adblockEngine = null;
const _browserSessions = new Set();   
const _engineOnSessions = new Set();  

// Embedded relay
ipcMain.handle('relay:set', async (e, enabled) => {
    const dataDir = path.join(app.getPath('userData'), 'relay-data');
    if (enabled) return relay.startRelay({ port: 8480, dataDir });
    return relay.stopRelay();
});
ipcMain.handle('relay:status', () => relay.relayStatus());

// ── QR code generation ───────────────────────────────────────────────────
// Rendered in the main process: the renderer resolves the qrcode package via
// its "browser" field, which doesn't load reliably there. Main uses plain
// Node resolution (pngjs renderer) and just hands back a data URL.
ipcMain.handle('qr-data-url', async (e, text) => {
    try {
        return await require('qrcode').toDataURL(String(text || ''), {
            width: 560, margin: 1, errorCorrectionLevel: 'M',
            color: { dark: '#000000', light: '#ffffff' },
        });
    } catch (err) {
        console.error('[qr] generation failed:', err);
        return null;
    }
});

// ── WhatsApp Assistant (two-way auto-reply bot) ──────────────────────────
function _waEmit(type, payload = {}) {
    for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
            try { win.webContents.send('wa-bot:event', { type, ...payload }); } catch (_) {}
        }
    }
}
ipcMain.handle('wa-bot:start',  (e, opts)  => waBot.start(opts || {}, _waEmit));
ipcMain.handle('wa-bot:stop',   ()         => waBot.stop());
ipcMain.handle('wa-bot:unlink', ()         => waBot.unlink());
ipcMain.handle('wa-bot:status', ()         => waBot.status());
ipcMain.handle('wa-bot:config', (e, patch) => waBot.setConfig(patch || {}));
ipcMain.handle('wa-bot:send',   (e, p)     => waBot.sendText((p || {}).number, (p || {}).text));
// Hand a message to the WhatsApp desktop app signed in on this Mac (no linking).
ipcMain.handle('wa-bot:send-app', (e, p)   => waBot.sendViaApp((p || {}).number, (p || {}).text));
// Open a conversation with a chosen contact (the model writes the first message).
ipcMain.handle('wa-bot:open-chat', (e, p) => waBot.startConversation((p || {}).number, (p || {}).topic, (p || {}).opener, (p || {}).queue));
ipcMain.handle('wa-bot:reset-chat', (e, p) => waBot.resetConversation((p || {}).number));

// Deliberately still 'Vulsor', not 'Vulsor Browser': this is what Electron
// derives userData from, and ~/Library/Application Support/Vulsor holds every
// cookie, login and browser session. Renaming it would start from an empty
// folder and strand 2.3GB of data. The visible name comes from the bundle.
app.setName('Vulsor');

// ── Hardware (GPU) acceleration ──────────────────────────────────────────
// Re-enabled for performance: 3D categories (Galaxy, Voyage, Chess3D, Physics3D,
// Cosmos), page scrolling and compositing all run on the GPU again, which is a
// large speedup over the previous all-software (SwiftShader) mode.
//
// GPU compositing being ON is also what lets hardware video decode display
// correctly (see the video-decode note at the top of this file) — decoded frames
// composite into the page instead of showing black, so we no longer force video
// through software decode.
//
// REVERT: if black video or rendering glitches return on this machine, flip
// ENABLE_GPU to false (or launch with VULSOR_DISABLE_GPU=1) to restore the old
// fully-software mode.
const ENABLE_GPU = process.env.VULSOR_DISABLE_GPU !== '1';   // ← set to `false` to revert
if (!ENABLE_GPU) app.disableHardwareAcceleration();
// Allow the SwiftShader software-GL fallback. It is only used when a real GPU
// context can't be created, and is required for WebGL when GPU is fully off.
try { app.commandLine.appendSwitch('enable-unsafe-swiftshader'); } catch (_) {}

// ── Clean User-Agent (fixes "unsupported browser" on Prime Video etc.) ──
// The default Electron UA contains "Vulsor/1.0.0" and "Electron/42.3.3" tokens.
// Streaming sites (Prime Video → error 7132, etc.) read those and reject the
// browser as unsupported. Strip them so we present as plain Chrome on macOS,
// keeping the engine's real Chromium version. Auth-host Firefox spoofing and
// per-tab overrides below still apply on top of this default.
try {
    const _defUA = app.userAgentFallback || '';
    const _cleanUA = _defUA.replace(/\s*Vulsor\/\S+/ig, '').replace(/\s*Electron\/\S+/ig, '').replace(/\s{2,}/g, ' ').trim();
    if (_cleanUA && _cleanUA !== _defUA) app.userAgentFallback = _cleanUA;
} catch (_) {}
const windows = [];
let _pendingOpenUrl = null;

function _focusedWindow() {
    const open = BrowserWindow.getAllWindows();
    if (!open.length) return null;
    return open.find(w => w.isFocused()) || open[open.length - 1];
}

function _flushOpenUrl(win) {
    if (!_pendingOpenUrl || !win) return;
    const send = () => { const u = _pendingOpenUrl; _pendingOpenUrl = null; try { win.webContents.send('open-external-url', u); } catch (_) {} };
    if (win.webContents.isLoading()) win.webContents.once('did-finish-load', send);
    else send();
}

function _routeOpenUrl(url) {
    if (!url || !/^https?:\/\//i.test(url)) return;
    _pendingOpenUrl = url;
    const win = _focusedWindow();
    if (!win) { if (app.isReady()) createWindow(); return; }   
    _flushOpenUrl(win);
    if (win.isMinimized()) win.restore();
    win.focus();
}

// ── Markdown files opened from the OS ───────────────────────────────
// Vulsor registers as a handler for .md/.markdown (CFBundleDocumentTypes in
// build-extras/url-types.plist). Double-clicking one in Finder — or `open -a`,
// or an argv path on Windows/Linux — hands the path to the renderer, which
// opens it in the Vault's markdown viewer (see appOpenVaultExternalFile).
const MD_FILE_RE = /\.(md|markdown)$/i;
let _pendingOpenFiles = [];

function _flushOpenFiles(win) {
    if (!_pendingOpenFiles.length || !win) return;
    const send = () => {
        const files = _pendingOpenFiles; _pendingOpenFiles = [];
        try { win.webContents.send('open-external-file', files); } catch (_) {}
    };
    if (win.webContents.isLoading()) win.webContents.once('did-finish-load', send);
    else send();
}

function _routeOpenFile(p) {
    if (!p || !MD_FILE_RE.test(p)) return;
    let full = p;
    try { full = path.resolve(p); if (!fs.existsSync(full)) return; } catch (_) { return; }
    _pendingOpenFiles.push(full);
    const win = _focusedWindow();
    if (!win) { if (app.isReady()) createWindow(); return; }
    _flushOpenFiles(win);
    if (win.isMinimized()) win.restore();
    win.focus();
}

// macOS delivers this before 'ready' on a cold launch, so it is registered at
// module scope; _routeOpenFile queues the path until a window exists.
app.on('open-file', (e, p) => { e.preventDefault(); _routeOpenFile(p); });

if (!app.requestSingleInstanceLock()) {
    app.exit(0);
} else {
    app.on('second-instance', (e, argv) => {
        const url  = argv.find(a => /^https?:\/\//i.test(a));
        const files = argv.filter(a => MD_FILE_RE.test(a));
        if (url) _routeOpenUrl(url);
        files.forEach(_routeOpenFile);
        if (!url && !files.length) { const w = _focusedWindow(); if (w) { if (w.isMinimized()) w.restore(); w.focus(); } }
    });
}

app.on('open-url', (e, url) => { e.preventDefault(); _routeOpenUrl(url); });

// The window's native background is what shows before the page paints and
// in any strip the renderer hasn't covered yet (window resizes, view swaps).
// It used to be a fixed near-black, which flashed as a black band on light
// themes. Read the saved theme's page colour so it matches from the first
// frame; the renderer keeps it in sync afterwards via 'window:set-bg'.
let _windowBg = '#020617';
try {
    const sf = path.join(os.homedir(), 'Documents', 'Vulsor_Memories', 'settings.json');
    const st = JSON.parse(fs.readFileSync(sf, 'utf8'));
    const bg = st && st.themeVars && st.themeVars['--bg-base'];
    if (typeof bg === 'string' && /^#[0-9a-f]{6}$/i.test(bg)) _windowBg = bg;
} catch (_) {}
ipcMain.on('window:set-bg', (e, hex) => {
    if (typeof hex !== 'string' || !/^#[0-9a-f]{6}$/i.test(hex)) return;
    _windowBg = hex;
    for (const w of BrowserWindow.getAllWindows()) { try { w.setBackgroundColor(hex); } catch (_) {} }
});

// ── App icon (Appearance → App icon) ─────────────────────────────────
// Two shipped variants (black / white) plus any PNG the user picks. The
// choice is applied to the Dock at once, and — in the packaged app, whose
// bundle is only linker-signed and carries no resource seal — the .icns in
// Contents/Resources is replaced too, so Finder and Launchpad follow. A custom
// PNG is converted to .icns with macOS's own sips + iconutil.
const ICON_VARIANTS = {
    black: { png: path.join(__dirname, 'build-extras', 'icons', 'black.png'), icns: path.join(__dirname, 'build-extras', 'icons', 'black.icns') },
    white: { png: path.join(__dirname, 'build-extras', 'icons', 'white.png'), icns: path.join(__dirname, 'build-extras', 'icons', 'white.icns') },
};
function _savedAppIcon() {
    try {
        const sf = path.join(os.homedir(), 'Documents', 'Vulsor_Memories', 'settings.json');
        return JSON.parse(fs.readFileSync(sf, 'utf8')).appIcon || null;
    } catch (_) { return null; }
}
function _iconPngFor(choice) {
    if (!choice) return null;
    if (ICON_VARIANTS[choice]) return ICON_VARIANTS[choice].png;
    if (typeof choice === 'string' && /\.(png|icns|jpe?g)$/i.test(choice) && fs.existsSync(choice)) return choice;
    return null;
}
async function _icnsFor(choice) {
    if (ICON_VARIANTS[choice]) return ICON_VARIANTS[choice].icns;
    if (/\.icns$/i.test(choice)) return choice;
    // Custom image → iconset → icns (macOS tools)
    const { execFile } = require('child_process');
    const run = (cmd, args) => new Promise((res, rej) => execFile(cmd, args, err => err ? rej(err) : res()));
    const dir = path.join(app.getPath('userData'), 'app-icon.iconset');
    fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
    for (const [n, names] of [[16, ['icon_16x16.png']], [32, ['icon_16x16@2x.png', 'icon_32x32.png']], [64, ['icon_32x32@2x.png']], [128, ['icon_128x128.png']], [256, ['icon_128x128@2x.png', 'icon_256x256.png']], [512, ['icon_256x256@2x.png', 'icon_512x512.png']], [1024, ['icon_512x512@2x.png']]]) {
        const out = path.join(dir, names[0]);
        await run('/usr/bin/sips', ['-s', 'format', 'png', '-z', String(n), String(n), choice, '--out', out]);
        for (const extra of names.slice(1)) fs.copyFileSync(out, path.join(dir, extra));
    }
    const icns = path.join(app.getPath('userData'), 'app-icon.icns');
    await run('/usr/bin/iconutil', ['-c', 'icns', dir, '-o', icns]);
    fs.rmSync(dir, { recursive: true, force: true });
    return icns;
}
async function applyAppIcon(choice, { writeBundle = true } = {}) {
    const png = _iconPngFor(choice);
    if (!png) return { ok: false, error: 'That image could not be used as an icon.' };
    try { if (process.platform === 'darwin') app.dock.setIcon(png); } catch (e) { return { ok: false, error: e.message }; }
    if (!writeBundle || process.platform !== 'darwin' || !app.isPackaged) return { ok: true, bundle: false };
    try {
        const icns = await _icnsFor(choice);
        const plist = path.join(process.resourcesPath, '..', 'Info.plist');
        let iconFile = 'electron.icns';
        try { const m = fs.readFileSync(plist, 'utf8').match(/<key>CFBundleIconFile<\/key>\s*<string>([^<]+)<\/string>/); if (m) iconFile = m[1].endsWith('.icns') ? m[1] : m[1] + '.icns'; } catch (_) {}
        const dest = path.join(process.resourcesPath, iconFile);
        fs.copyFileSync(icns, dest);
        // Finder caches icons by bundle mtime — bump it so the new one shows.
        const bundle = path.resolve(process.resourcesPath, '..', '..');
        const now = new Date(); fs.utimesSync(bundle, now, now);
        return { ok: true, bundle: true };
    } catch (e) {
        return { ok: true, bundle: false, error: `Dock updated; the app file itself could not be changed (${e.message}).` };
    }
}
ipcMain.handle('app-icon:set', (e, choice) => applyAppIcon(choice));
ipcMain.handle('app-icon:pick', async () => {
    const r = await dialog.showOpenDialog({ title: 'Choose an app icon', properties: ['openFile'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'icns'] }] });
    if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
    return { ok: true, path: r.filePaths[0] };
});

function createWindow() {
    const saved = _savedAppIcon();
    const iconPath = _iconPngFor(saved) || path.join(__dirname, 'icon.icns');

    if (process.platform === 'darwin' && fs.existsSync(iconPath)) {
        try { app.dock.setIcon(iconPath); } catch (e) {}
    }

    const win = new BrowserWindow({
        width: 1100, height: 850,
        title: 'Vulsor Browser',
        show: false,   
        backgroundColor: _windowBg,
        ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 14 } } : { frame: true }),
        ...(fs.existsSync(iconPath) ? { icon: iconPath } : {}),
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            webSecurity: false,
            webviewTag: true   
        }
    });

    // Show the window as soon as there is a DOM to paint. 'ready-to-show' waits
    // for the page's load event, and the tab strip's favicons are fetched from
    // whatever sites were open — that put the whole window behind a network
    // round-trip on every launch. backgroundColor above covers the first frame.
    let revealed = false;
    const reveal = () => {
        if (revealed || win.isDestroyed()) return;
        revealed = true;
        win.show();
    };
    win.once('ready-to-show', reveal);
    win.webContents.once('dom-ready', reveal);
    windows.push(win);
    win.on('closed', () => {
        const i = windows.indexOf(win);
        if (i !== -1) windows.splice(i, 1);
    });

    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
        const allowed = ['media', 'microphone', 'audioCapture'];
        callback(allowed.includes(permission));
    });
    session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
        const allowed = ['media', 'microphone', 'audioCapture'];
        return allowed.includes(permission);
    });

    win.loadFile('index.html');
    win.webContents.on('did-finish-load', () => { _flushOpenUrl(win); _flushOpenFiles(win); });

    // If the main UI's render process dies, reload it once automatically
    // instead of leaving a blank window. (Guard against reload loops.)
    win.webContents.on('render-process-gone', (e, details) => {
        console.error('[main window render-process-gone]', details && details.reason);
        if (win.isDestroyed()) return;
        const now = Date.now();
        if (now - (win._lastReload || 0) > 5000) {
            win._lastReload = now;
            try { win.reload(); } catch (_) {}
        }
    });
    return win;
}

function buildMenu() {
    const template = [
        {
            label: 'Vulsor Browser',
            submenu: [
                { label: 'About Vulsor', role: 'about' },
                { type: 'separator' },
                { label: 'Hide Vulsor', accelerator: 'CmdOrCtrl+H', role: 'hide' },
                { label: 'Hide Others', accelerator: 'CmdOrCtrl+Alt+H', role: 'hideOthers' },
                { type: 'separator' },
                { label: 'Quit Vulsor', accelerator: 'CmdOrCtrl+Q', role: 'quit' }
            ]
        },
        {
            label: 'File',
            submenu: [
                { label: 'New Window', accelerator: 'CmdOrCtrl+N', click: () => createWindow() },
                { type: 'separator' },
                {
                    label: 'Remove Ad Overlay',
                    accelerator: 'CmdOrCtrl+Shift+X',
                    click: (item, win) => { const w = win || BrowserWindow.getFocusedWindow(); if (w) w.webContents.send('declutter-overlay'); }
                },
                { type: 'separator' },
                {
                    label: 'Close Tab',
                    accelerator: 'CmdOrCtrl+W',
                    click: (item, win) => { const w = win || BrowserWindow.getFocusedWindow(); if (w) w.webContents.send('close-active-tab'); }
                },
                { label: 'Close Window', accelerator: 'CmdOrCtrl+Shift+W', role: 'close' }
            ]
        },
        {
            label: 'Edit',
            submenu: [
                { label: 'Undo', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
                { label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z', role: 'redo' },
                { type: 'separator' },
                { label: 'Cut', accelerator: 'CmdOrCtrl+X', role: 'cut' },
                { label: 'Copy', accelerator: 'CmdOrCtrl+C', role: 'copy' },
                { label: 'Paste', accelerator: 'CmdOrCtrl+V', role: 'paste' },
                { label: 'Select All', accelerator: 'CmdOrCtrl+A', role: 'selectAll' }
            ]
        },
        {
            label: 'View',
            submenu: [
                { label: 'Reload', accelerator: 'CmdOrCtrl+R', role: 'reload' },
                { label: 'Force Reload', accelerator: 'CmdOrCtrl+Shift+R', role: 'forceReload' },
                { label: 'Toggle DevTools', accelerator: 'CmdOrCtrl+Alt+I', role: 'toggleDevTools' },
                { type: 'separator' },
                { label: 'Actual Size', accelerator: 'CmdOrCtrl+0', role: 'resetZoom' },
                { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', role: 'zoomIn' },
                { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', role: 'zoomOut' },
                { type: 'separator' },
                { label: 'Toggle Full Screen', accelerator: 'Ctrl+Cmd+F', role: 'togglefullscreen' }
            ]
        },
        {
            label: 'Window',
            submenu: [
                { label: 'Minimize', accelerator: 'CmdOrCtrl+M', role: 'minimize' },
                { label: 'Zoom', role: 'zoom' },
                { type: 'separator' },
                { label: 'Bring All to Front', role: 'front' }
            ]
        }
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

ipcMain.on('new-window', () => createWindow());

const _preHtmlFsState = new WeakMap();
ipcMain.on('browser-html-fullscreen', (event, on) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return;
    if (on) {
        _preHtmlFsState.set(win, win.isFullScreen());
        if (!win.isFullScreen()) win.setFullScreen(true);
    } else {
        const wasFs = _preHtmlFsState.get(win);
        _preHtmlFsState.delete(win);
        if (!wasFs && win.isFullScreen()) win.setFullScreen(false);
    }
});

ipcMain.on('vault-data-changed', (event) => {
    for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed() && win.webContents !== event.sender) {
            win.webContents.send('vault-reload');
        }
    }
});

let _winDragState = null;
ipcMain.on('win-drag-start', (event, { screenX, screenY }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    const [wx, wy] = win.getPosition();
    _winDragState = { startMouseX: screenX, startMouseY: screenY, startWinX: wx, startWinY: wy, win };
});
ipcMain.on('win-drag-move', (event, { screenX, screenY }) => {
    if (!_winDragState) return;
    const dx = screenX - _winDragState.startMouseX;
    const dy = screenY - _winDragState.startMouseY;
    _winDragState.win.setPosition(
        Math.round(_winDragState.startWinX + dx),
        Math.round(_winDragState.startWinY + dy)
    );
});
ipcMain.on('win-drag-end', () => { _winDragState = null; });

let _dragPreviewWin = null;

function _closeDragPreview() {
    if (_dragPreviewWin && !_dragPreviewWin.isDestroyed()) {
        try { _dragPreviewWin.close(); } catch (_) {}
    }
    _dragPreviewWin = null;
}

// Lightweight tab "chip" that follows the cursor while a tab is torn out of the
// strip — the Brave/Chrome feel. It's a tiny transparent, non-focusable window
// so dragging stays buttery; the real detached window isn't created until drop.
// Content (label/color/icon/favicon) comes from the active drag's payload.
function _showDragPreview(screenX, screenY) {
    const drag = _activeDrag;
    if (!drag || !drag.payload) return;
    const offX = (drag.grabOffsetX != null) ? drag.grabOffsetX : 110;
    const winX = Math.round(screenX - offX);
    const winY = Math.round(screenY - 17);

    if (_dragPreviewWin && !_dragPreviewWin.isDestroyed()) {
        _dragPreviewWin.setPosition(winX, winY);
        return;
    }

    const p = drag.payload;
    _dragPreviewWin = new BrowserWindow({
        width: 240, height: 50,
        x: winX, y: winY,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        focusable: false,
        show: false,
        hasShadow: false,
        webPreferences: { nodeIntegration: false, contextIsolation: true },
    });
    _dragPreviewWin.setIgnoreMouseEvents(true);

    _dragPreviewWin.loadFile('drag-preview.html', {
        query: {
            label:   encodeURIComponent(p.label || 'Tab'),
            color:   encodeURIComponent(p.color || '#475569'),
            icon:    encodeURIComponent(p.icon || 'fa-circle'),
            favicon: encodeURIComponent(p.favicon || ''),
        },
    });
    _dragPreviewWin.once('ready-to-show', () => {
        if (_dragPreviewWin && !_dragPreviewWin.isDestroyed()) _dragPreviewWin.showInactive();
    });
    _dragPreviewWin.on('closed', () => { _dragPreviewWin = null; });
}

const TAB_STRIP_HEIGHT = 42;

// Materialize a real detached window for a torn-out tab. Created only on DROP
// (Brave-style), so the drag itself stays light — until release the user is just
// carrying the preview chip. Positioned so the new window's tab strip lands
// under the cursor where it was let go.
function _spawnDetachedWindow(payload, screenX, screenY, grabOffsetX) {
    const offX = (grabOffsetX != null) ? grabOffsetX : 110;
    const winX = Math.round(screenX - offX);
    const winY = Math.round(screenY - TAB_STRIP_HEIGHT);

    const iconPath = path.join(__dirname, 'icon.icns');
    const tw = new BrowserWindow({
        width: 1100, height: 850,
        x: winX, y: winY,
        title: 'Vulsor Browser',
        show: false,
        backgroundColor: _windowBg,
        ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 14 } } : { frame: true }),
        ...(fs.existsSync(iconPath) ? { icon: iconPath } : {}),
        webPreferences: { nodeIntegration: true, contextIsolation: false, webSecurity: false, webviewTag: true },
    });

    windows.push(tw);
    tw.on('closed', () => { const i = windows.indexOf(tw); if (i !== -1) windows.splice(i, 1); });

    // Safety net: if the load ever stalls, don't leave the chip stuck on screen.
    const chipFallback = setTimeout(_closeDragPreview, 2000);

    tw.loadFile('index.html');
    tw.webContents.once('did-finish-load', () => {
        if (tw.isDestroyed()) return;
        // Hand the tab over as structured data. The payload carries page titles and
        // URLs from the web, and building a source string out of those is how
        // injection bugs start; it also lets the new window restore the tab's state
        // instead of just opening the app blank.
        tw.webContents.send('adopt-tab', payload);
        if (!tw.isVisible()) tw.show();
        tw.focus();
        // Window has painted — now retire the floating chip so the handoff from
        // chip → real window is seamless (no empty flash on drop).
        clearTimeout(chipFallback);
        _closeDragPreview();
    });
    return tw;
}

let _activeDrag = null;

function _findWindowAtTabStrip(screenX, screenY, exclude) {
    for (let i = windows.length - 1; i >= 0; i--) {
        const win = windows[i];
        if (!win || win === exclude || win.isDestroyed()) continue;
        if (!win.isVisible() || win.isMinimized()) continue;
        const b = win.getBounds();
        if (screenX >= b.x && screenX <= b.x + b.width &&
            screenY >= b.y && screenY <= b.y + TAB_STRIP_HEIGHT) {
            return win;
        }
    }
    return null;
}

ipcMain.on('tab-drag-begin', (event, payload) => {
    const sourceWin = BrowserWindow.fromWebContents(event.sender);
    _activeDrag = {
        sourceWin,
        payload,
        grabOffsetX: (payload && payload.grabOffsetX != null) ? payload.grabOffsetX : 110,
        lastTargetWin: null,
    };
});

ipcMain.on('tab-drag-move', (event, { screenX, screenY, outOfStrip }) => {
    if (!_activeDrag) return;
    // Back inside the source strip → drop any external indicator and the chip;
    // the source renderer re-inserts the tab locally (drag-back-in).
    if (!outOfStrip) {
        if (_activeDrag.lastTargetWin && !_activeDrag.lastTargetWin.isDestroyed()) {
            _activeDrag.lastTargetWin.webContents.send('tab-external-drag-leave');
        }
        _activeDrag.lastTargetWin = null;
        _closeDragPreview();
        return;
    }
    const target = _findWindowAtTabStrip(screenX, screenY, _activeDrag.sourceWin);
    if (target !== _activeDrag.lastTargetWin) {
        if (_activeDrag.lastTargetWin && !_activeDrag.lastTargetWin.isDestroyed()) {
            _activeDrag.lastTargetWin.webContents.send('tab-external-drag-leave');
        }
        if (target) {
            // Over another window's strip → that window shows the insertion
            // indicator; hide the floating chip so it doesn't fight the slot.
            target.webContents.send('tab-external-drag-enter', { payload: _activeDrag.payload, screenX, screenY });
            _closeDragPreview();
        } else {
            // Free space → carry the lightweight chip under the cursor.
            _showDragPreview(screenX, screenY);
        }
        _activeDrag.lastTargetWin = target;
    } else if (target && !target.isDestroyed()) {
        target.webContents.send('tab-external-drag-over', { screenX, screenY });
    } else {
        _showDragPreview(screenX, screenY);
    }
});

ipcMain.on('tab-drag-end', (event, { screenX, screenY, outOfStrip }) => {
    if (!_activeDrag) return;
    const target  = _activeDrag.lastTargetWin;
    const payload = _activeDrag.payload;
    const offX    = _activeDrag.grabOffsetX;
    _activeDrag = null;

    // Dropped over another window's tab strip → merge into it.
    if (target && !target.isDestroyed()) {
        _closeDragPreview();
        target.webContents.send('tab-external-drop', { payload, screenX, screenY });
        if (target.isMinimized()) target.restore();
        target.focus();
        return;
    }
    // Dropped outside any strip → materialize a fresh detached window now. The
    // chip stays up until that window paints (see _spawnDetachedWindow), so the
    // handoff is seamless. A plain in-strip reorder needs no window.
    if (outOfStrip) {
        _spawnDetachedWindow(payload, screenX, screenY, offX);
    } else {
        _closeDragPreview();
    }
});

ipcMain.on('tab-drag-cancel', () => {
    if (_activeDrag && _activeDrag.lastTargetWin && !_activeDrag.lastTargetWin.isDestroyed()) {
        _activeDrag.lastTargetWin.webContents.send('tab-external-drag-leave');
    }
    _activeDrag = null;
    _closeDragPreview();
});

ipcMain.on('close-this-window', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) win.close();
});

ipcMain.handle('music-pick-folder', async (event) => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
});

const MUSIC_DL_DIR = path.join(os.homedir(), 'Music', 'Vulsor');

// ── Locating optional command-line tools ─────────────────────────────
// ffmpeg, whisper.cpp and yt-dlp are optional extras the user installs
// themselves. Look in the usual Homebrew / system prefixes first (a packaged
// app launched from Finder has a nearly empty PATH), then in every PATH
// entry, then in a few Linux/Windows homes — so a tool installed any normal
// way is found, and the features that need it can say precisely what's
// missing when it isn't. Results are cached per launch; a fresh install is
// picked up by re-running the check the feature exposes.
const _binCache = new Map();
function findBin(names, extraDirs = []) {
    const list = Array.isArray(names) ? names : [names];
    const key = list.join('|');
    if (_binCache.has(key) && _binCache.get(key)) return _binCache.get(key);
    const dirs = [
        ...extraDirs,
        '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin',
        '/opt/local/bin', '/snap/bin', path.join(os.homedir(), '.local', 'bin'),
        ...(process.env.PATH || '').split(path.delimiter).filter(Boolean),
        ...(process.platform === 'win32' ? [
            path.join(process.env.ProgramFiles || 'C:\\Program Files', 'ffmpeg', 'bin'),
            path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Links'),
            path.join(process.env.ChocolateyInstall || 'C:\\ProgramData\\chocolatey', 'bin'),
        ] : []),
    ];
    const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
    for (const dir of dirs) for (const n of list) for (const ext of exts) {
        const p = path.join(dir, n + ext);
        try { if (fs.statSync(p).isFile()) { _binCache.set(key, p); return p; } } catch (_) {}
    }
    _binCache.set(key, null);
    return null;
}

function findYtDlpBin() { return findBin('yt-dlp'); }

const WHISPER_BIN_PATHS = [ '/opt/homebrew/bin/whisper-cli', '/opt/homebrew/bin/whisper-cpp', '/usr/local/bin/whisper-cli', '/usr/local/bin/whisper-cpp' ];
// userData resolves to ~/Library/Application Support/Vulsor on macOS (see
// app.setName above) and to the platform's equivalent elsewhere — the old
// hardcoded macOS path put the speech model somewhere Windows and Linux
// builds would never look.
const VULSOR_DATA_DIR = (() => { try { return app.getPath('userData'); } catch (_) { return path.join(os.homedir(), 'Library', 'Application Support', 'Vulsor'); } })();
const WHISPER_MODEL_ML  = path.join(VULSOR_DATA_DIR, 'ggml-base.bin');      
const WHISPER_MODEL_EN  = path.join(VULSOR_DATA_DIR, 'ggml-base.en.bin');   
const WHISPER_MODEL     = WHISPER_MODEL_ML;   
const WHISPER_MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin';

function getWhisperModelInfo() {
    if (fs.existsSync(WHISPER_MODEL_ML)) return { path: WHISPER_MODEL_ML, langFlag: 'auto' };
    if (fs.existsSync(WHISPER_MODEL_EN)) return { path: WHISPER_MODEL_EN, langFlag: 'en' };
    return null;
}

function findWhisperBin() {
    return findBin(['whisper-cli', 'whisper-cpp'], WHISPER_BIN_PATHS.map(p => path.dirname(p)));
}

function downloadFile(url, destPath, onProgress) {
    return new Promise((resolve, reject) => {
        if (!fs.existsSync(path.dirname(destPath))) { fs.mkdirSync(path.dirname(destPath), { recursive: true }); }
        const file = fs.createWriteStream(destPath);
        const get = (u) => https.get(u, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { res.resume(); return get(res.headers.location); }
            if (res.statusCode !== 200) { file.close(); fs.unlink(destPath, () => {}); return reject(new Error(`HTTP ${res.statusCode}`)); }
            const total = parseInt(res.headers['content-length'] || '0', 10);
            let received = 0;
            res.on('data', (chunk) => { received += chunk.length; if (total && onProgress) onProgress(received / total); });
            res.pipe(file);
            file.on('finish', () => file.close(() => resolve()));
        }).on('error', (err) => { file.close(); fs.unlink(destPath, () => {}); reject(err); });
        get(url);
    });
}

function writeWavFile(filePath, float32Samples, sampleRate) {
    const numSamples = float32Samples.length;
    const dataSize   = numSamples * 2;
    const buffer     = Buffer.alloc(44 + dataSize);
    let o = 0;
    buffer.write('RIFF', o); o += 4;
    buffer.writeUInt32LE(36 + dataSize, o); o += 4;
    buffer.write('WAVE', o); o += 4;
    buffer.write('fmt ', o); o += 4;
    buffer.writeUInt32LE(16, o); o += 4;          
    buffer.writeUInt16LE(1, o); o += 2;           
    buffer.writeUInt16LE(1, o); o += 2;           
    buffer.writeUInt32LE(sampleRate, o); o += 4;
    buffer.writeUInt32LE(sampleRate * 2, o); o += 4;
    buffer.writeUInt16LE(2, o); o += 2;           
    buffer.writeUInt16LE(16, o); o += 2;          
    buffer.write('data', o); o += 4;
    buffer.writeUInt32LE(dataSize, o); o += 4;
    for (let i = 0; i < numSamples; i++) {
        const s = Math.max(-1, Math.min(1, float32Samples[i]));
        buffer.writeInt16LE(s < 0 ? s * 0x8000 : s * 0x7FFF, 44 + i * 2);
    }
    fs.writeFileSync(filePath, buffer);
}

ipcMain.handle('voice:check-setup', async () => {
    const bin = findWhisperBin();
    return {
        binInstalled: !!bin,
        modelInstalled: fs.existsSync(WHISPER_MODEL_ML) || fs.existsSync(WHISPER_MODEL_EN),
        multilingual: fs.existsSync(WHISPER_MODEL_ML),
        binPath: bin, modelPath: WHISPER_MODEL
    };
});

ipcMain.handle('voice:download-model', async (event) => {
    try {
        await downloadFile(WHISPER_MODEL_URL, WHISPER_MODEL, (pct) => { event.sender.send('voice:download-progress', pct); });
        return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('voice:transcribe', async (event, { samples, sampleRate }) => {
    const bin = findWhisperBin();
    if (!bin) return { ok: false, error: 'whisper.cpp is not installed. On macOS: brew install whisper-cpp' };
    const modelInfo = getWhisperModelInfo();
    if (!modelInfo) return { ok: false, error: 'Model not downloaded' };
    const tmpFile = path.join(os.tmpdir(), `vulsor-voice-${Date.now()}.wav`);
    try {
        const float32 = samples instanceof Float32Array ? samples : new Float32Array(samples);
        writeWavFile(tmpFile, float32, sampleRate);
        const text = await new Promise((resolve, reject) => {
            const proc = spawn(bin, [ '-m', modelInfo.path, '-f', tmpFile, '-nt', '-l', 'en', '--no-prints' ]);
            let out = '', err = '';
            proc.stdout.on('data', d => { out += d.toString(); });
            proc.stderr.on('data', d => { err += d.toString(); });
            proc.on('close', code => { if (code === 0) resolve(out.trim()); else reject(new Error(err.trim() || `exit ${code}`)); });
            proc.on('error', reject);
        });
        return { ok: true, text };
    } catch (e) { return { ok: false, error: e.message }; }
    finally { try { fs.unlinkSync(tmpFile); } catch (_) {} }
});

ipcMain.on('music-download', (event, { jobId, url, format }) => {
    const ytdlp = findYtDlpBin();
    if (!ytdlp) { event.sender.send('music-dl-event', { jobId, type: 'error', error: 'yt-dlp is not installed. On macOS: brew install yt-dlp' }); return; }
    if (!fs.existsSync(MUSIC_DL_DIR)) fs.mkdirSync(MUSIC_DL_DIR, { recursive: true });
    const outTpl = path.join(MUSIC_DL_DIR, '%(title)s.%(ext)s');
    const args = format === 'audio'
        ? ['-f', 'bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio', '--restrict-filenames', '--newline', '-o', outTpl, '--no-playlist', url]
        : ['-f', 'best[ext=mp4]/best[ext=mp4]/best', '--restrict-filenames', '--newline', '-o', outTpl, '--no-playlist', url];
    const env  = { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || ''}` };
    const proc = spawn(ytdlp, args, { env });
    let buf = '', errText = '', detectedFilePath = null;

    proc.stdout.on('data', data => {
        buf += data.toString();
        const lines = buf.split(/[\r\n]/); buf = lines.pop();
        lines.forEach(line => {
            const destMatch = line.match(/\[download\] Destination:\s*(.+)/);
            if (destMatch) {
                detectedFilePath = destMatch[1].trim();
                const title = path.basename(detectedFilePath, path.extname(detectedFilePath)).replace(/_/g, ' ');
                event.sender.send('music-dl-event', { jobId, type: 'title', title });
            }
            const alreadyMatch = line.match(/\[download\] (.+?) has already been downloaded/);
            if (alreadyMatch) {
                detectedFilePath = alreadyMatch[1].trim();
                const title = path.basename(detectedFilePath, path.extname(detectedFilePath)).replace(/_/g, ' ');
                event.sender.send('music-dl-event', { jobId, type: 'title', title });
            }
            const pct = line.match(/(\d+\.?\d*)%/);
            if (pct) event.sender.send('music-dl-event', { jobId, type: 'progress', progress: parseFloat(pct[1]) });
        });
    });
    proc.stderr.on('data', data => { errText += data.toString(); });
    proc.on('error', err => { event.sender.send('music-dl-event', { jobId, type: 'error', error: err.message }); });
    proc.on('close', code => {
        if (code === 0) {
            if (detectedFilePath && fs.existsSync(detectedFilePath)) {
                const title = path.basename(detectedFilePath, path.extname(detectedFilePath)).replace(/_/g, ' ');
                event.sender.send('music-dl-event', { jobId, type: 'done', filePath: detectedFilePath, title });
            } else {
                const newest = fs.readdirSync(MUSIC_DL_DIR).filter(f => !/\.part$/.test(f))
                    .map(f => ({ name: f, mtime: fs.statSync(path.join(MUSIC_DL_DIR, f)).mtimeMs }))
                    .sort((a, b) => b.mtime - a.mtime)[0];
                if (newest && (Date.now() - newest.mtime) < 60000) {
                    const filePath = path.join(MUSIC_DL_DIR, newest.name);
                    const title    = path.basename(filePath, path.extname(filePath)).replace(/_/g, ' ');
                    event.sender.send('music-dl-event', { jobId, type: 'done', filePath, title });
                } else { event.sender.send('music-dl-event', { jobId, type: 'error', error: 'No file saved.' }); }
            }
        } else {
            const errLine = errText.split('\n').find(l => /ERROR/i.test(l)) || errText.trim() || `code ${code}`;
            event.sender.send('music-dl-event', { jobId, type: 'error', error: errLine.replace(/^ERROR:\s*/i, '').trim().slice(0, 120) });
        }
    });
});

ipcMain.handle('music-cleanup-leftovers', () => {
    if (!fs.existsSync(MUSIC_DL_DIR)) return;
    fs.readdirSync(MUSIC_DL_DIR).forEach(f => {
        if (/\.part$/i.test(f) || /\.ytdl$/i.test(f)) { try { fs.unlinkSync(path.join(MUSIC_DL_DIR, f)); } catch(e) {} }
    });
});

ipcMain.handle('show-open-dialog', async (event, options) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return dialog.showOpenDialog(win, options);
});

function _getJSON(url, timeoutMs) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { headers: { 'User-Agent': 'Vulsor/1.0', 'Accept': 'application/json' }, timeout: timeoutMs || 12000 }, res => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { res.resume(); return _getJSON(res.headers.location, timeoutMs).then(resolve, reject); }
            let data = ''; res.on('data', c => data += c);
            res.on('end', () => {
                if (res.statusCode >= 400) { return reject(new Error('HTTP ' + res.statusCode)); }
                try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('parse error')); }
            });
        });
        req.on('timeout', () => req.destroy(new Error('timeout')));
        req.on('error', reject);
    });
}

ipcMain.handle('get-weather', async () => {
    try {
        const loc = await _getJSON('https://ipwho.is/');
        const lat = loc.latitude, lon = loc.longitude;
        if (lat == null || lon == null) throw new Error('no location');
        const unit = loc.country_code === 'US' ? 'fahrenheit' : 'celsius';
        const w = await _getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&temperature_unit=${unit}`);
        return { ok: true, city: loc.city || '', unit, temp: w.current?.temperature_2m, code: w.current?.weather_code };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
});

ipcMain.handle('search-nasa-images', async (event, { q }) => {
    try {
        const data = await _getJSON(`https://images-api.nasa.gov/search?q=${encodeURIComponent(q)}&media_type=image`, 20000);
        const items = ((data.collection && data.collection.items) || []).map(it => {
            const d = (it.data && it.data[0]) || {};
            const href = (it.links && it.links[0] && it.links[0].href) || '';
            if (!href) return null;
            return { title: d.title || '', explanation: d.description || '', date: (d.date_created || '').slice(0, 10), url: href, hdurl: href.replace(/~thumb\.(jpe?g|png)/i, '~orig.$1'), media_type: 'image' };
        }).filter(Boolean);
        return { ok: true, items };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
});

function _downloadBinary(url, dest) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { headers: { 'User-Agent': 'Vulsor/1.0' } }, res => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { res.resume(); return _downloadBinary(res.headers.location, dest).then(resolve, reject); }
            if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
            const file = fs.createWriteStream(dest); res.pipe(file);
            file.on('finish', () => file.close(() => resolve(dest))); file.on('error', reject);
        });
        req.on('error', reject);
    });
}

ipcMain.handle('cosmos-download', async (event, { url, filename }) => {
    try {
        const win = BrowserWindow.fromWebContents(event.sender);
        const ext = (url.split('?')[0].split('.').pop() || 'jpg').toLowerCase().slice(0, 4);
        const safe = (filename || 'cosmos').replace(/[\/\\:*?"<>|]/g, '-').slice(0, 80);
        const result = await dialog.showSaveDialog(win, { title: 'Save image', defaultPath: path.join(os.homedir(), 'Downloads', `${safe}.${ext}`) });
        if (result.canceled || !result.filePath) return { ok: false, canceled: true };
        await _downloadBinary(url, result.filePath);
        return { ok: true, path: result.filePath };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
});

ipcMain.handle('get-apod', async (event, { count, apiKey }) => {
    const key = (apiKey && apiKey.trim()) || 'DEMO_KEY';
    const url = `https://api.nasa.gov/planetary/apod?api_key=${encodeURIComponent(key)}&count=${count || 12}&thumbs=true`;
    let lastErr;
    for (let i = 0; i < 3; i++) {
        try { const data = await _getJSON(url, 25000); return { ok: true, items: Array.isArray(data) ? data : [data] }; }
        catch (e) { lastErr = e; if (String(e?.message || e).includes('429')) return { ok: false, error: 'HTTP 429', rateLimited: true }; await new Promise(r => setTimeout(r, 800 * (i + 1))); }
    }
    return { ok: false, error: String(lastErr?.message || lastErr) };
});

function findFfmpeg() { return findBin('ffmpeg'); }
ipcMain.handle('ffmpeg-available', async () => ({ ok: !!findFfmpeg() }));

// ── Karaoke: transcribe a song's audio → timed LRC (on-device, whisper.cpp) ──
// Decodes the track to 16 kHz mono WAV with ffmpeg, then runs whisper.cpp's
// whisper-cli with -olrc so we get timestamped lines the karaoke display can sync
// and highlight. Fully local — no audio leaves the machine.
function findWhisper() { return findWhisperBin(); }
function findWhisperModel() {
    const dir = app.getPath('userData');
    // Prefer the multilingual base (handles non-English songs); fall back sensibly.
    for (const n of ['ggml-base.bin', 'ggml-small.bin', 'ggml-medium.bin', 'ggml-base.en.bin', 'ggml-small.en.bin', 'ggml-tiny.bin']) {
        const p = path.join(dir, n); if (fs.existsSync(p)) return p;
    }
    const hb = '/opt/homebrew/opt/whisper-cpp/share/whisper-cpp/for-tests-ggml-tiny.bin';
    if (fs.existsSync(hb)) return hb;
    return null;
}
ipcMain.handle('karaoke:transcribe-available', async () => ({
    ok: !!(findFfmpeg() && findWhisper() && findWhisperModel()),
    ffmpeg: !!findFfmpeg(), whisper: !!findWhisper(), model: !!findWhisperModel(),
}));
ipcMain.handle('karaoke:transcribe', async (e, opts = {}) => {
    const audioPath = opts && opts.path;
    const lang = (opts && opts.lang) || 'auto';
    try {
        if (!audioPath || !fs.existsSync(audioPath)) return { ok: false, error: 'Audio file not found.' };
        const ff = findFfmpeg(); if (!ff) return { ok: false, error: 'ffmpeg is not installed. On macOS: brew install ffmpeg' };
        const whisper = findWhisper(); if (!whisper) return { ok: false, error: 'whisper-cli not found — install with: brew install whisper-cpp' };
        const model = findWhisperModel(); if (!model) return { ok: false, error: 'No Whisper model found (expected ggml-base.bin in Vulsor app-support).' };

        const base = path.join(app.getPath('temp'), 'vulsor-karaoke-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7));
        const wav  = base + '.wav';
        const send = (phase, pct) => { try { if (!e.sender.isDestroyed()) e.sender.send('karaoke:transcribe-progress', { phase, pct }); } catch (_) {} };

        // 1) decode → 16 kHz mono WAV (whisper.cpp's required input format)
        send('decoding', 0);
        await new Promise((res, rej) => {
            const p = spawn(ff, ['-y', '-i', audioPath, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav]);
            let err = ''; p.stderr.on('data', d => err += d);
            p.on('error', rej);
            p.on('close', c => c === 0 ? res() : rej(new Error('ffmpeg decode failed: ' + err.slice(-200))));
        });

        // 2) whisper.cpp → LRC (writes base + '.lrc'); stream % progress to the UI
        send('listening', 0);
        await new Promise((res, rej) => {
            const p = spawn(whisper, ['-m', model, '-f', wav, '-olrc', '-of', base, '-l', lang, '-pp']);
            let err = '';
            const onData = d => { const s = d.toString(); const m = /progress\s*=\s*(\d+)\s*%/i.exec(s); if (m) send('listening', parseInt(m[1], 10)); };
            p.stderr.on('data', d => { err += d; onData(d); });
            p.stdout.on('data', onData);
            p.on('error', rej);
            p.on('close', c => c === 0 ? res() : rej(new Error('whisper failed: ' + err.slice(-200))));
        });

        let lrc = '';
        try { lrc = fs.readFileSync(base + '.lrc', 'utf8'); } catch (_) {}
        try { fs.unlinkSync(wav); } catch (_) {}
        try { fs.unlinkSync(base + '.lrc'); } catch (_) {}
        send('done', 100);

        // Clean up whisper's LRC: drop ID tags ([by:], [ar:]…) and the single space
        // it inserts after each timestamp, so lines display tidily in the karaoke view.
        if (lrc) {
            lrc = lrc.split('\n')
                .filter(l => !/^\s*\[(by|ar|al|ti|length|offset|re|ve|au|la):/i.test(l))
                .map(l => l.replace(/^(\[\d{1,2}:\d{2}(?:\.\d{1,3})?\])\s/, '$1'))
                .join('\n').trim();
        }

        if (!lrc || !lrc.trim()) return { ok: false, error: 'The transcription came back empty.' };
        return { ok: true, lrc, model: path.basename(model) };
    } catch (err) {
        return { ok: false, error: String((err && err.message) || err) };
    }
});

function _imapClient(acc) {
    const { ImapFlow } = require('imapflow');
    return new ImapFlow({ host: acc.imapHost, port: parseInt(acc.imapPort) || 993, secure: true, auth: { user: acc.email, pass: acc.password }, logger: false, emitLogs: false });
}
ipcMain.handle('mail:test', async (event, acc) => {
    const c = _imapClient(acc);
    try { await c.connect(); await c.logout(); return { ok: true }; }
    catch (e) { try { await c.close(); } catch(_){} return { ok: false, error: e.message }; }
});
ipcMain.handle('mail:list', async (event, { acc, mailbox = 'INBOX', limit = 40 }) => {
    const c = _imapClient(acc);
    try {
        await c.connect(); const lock = await c.getMailboxLock(mailbox); const out = [];
        try {
            const total = c.mailbox.exists || 0;
            if (total > 0) {
                const start = Math.max(1, total - limit + 1);
                for await (const msg of c.fetch(`${start}:*`, { envelope: true, flags: true, internalDate: true })) {
                    const from = msg.envelope.from && msg.envelope.from[0];
                    out.push({ uid: msg.uid, seq: msg.seq, subject: msg.envelope.subject || '(no subject)', from: from ? (from.name || from.address) : '', fromAddr: from ? from.address : '', date: msg.internalDate, seen: msg.flags ? msg.flags.has('\\Seen') : true, messageId: msg.envelope.messageId || '' });
                }
            }
        } finally { lock.release(); }
        await c.logout(); out.reverse(); return { ok: true, messages: out };
    } catch (e) { try { await c.close(); } catch(_){} return { ok: false, error: e.message }; }
});
ipcMain.handle('mail:get', async (event, { acc, uid, mailbox = 'INBOX' }) => {
    const c = _imapClient(acc);
    try {
        await c.connect(); const lock = await c.getMailboxLock(mailbox); let parsed = null;
        try {
            const msg = await c.fetchOne(String(uid), { source: true }, { uid: true });
            if (msg && msg.source) {
                const { simpleParser } = require('mailparser'); const p = await simpleParser(msg.source);
                parsed = { subject: p.subject || '', from: p.from ? p.from.text : '', to: p.to ? p.to.text : '', date: p.date, text: p.text || '', html: p.html || '', messageId: p.messageId || '' };
            }
            try { await c.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true }); } catch(_){}
        } finally { lock.release(); }
        await c.logout(); return parsed ? { ok: true, message: parsed } : { ok: false, error: 'not found' };
    } catch (e) { try { await c.close(); } catch(_){} return { ok: false, error: e.message }; }
});
ipcMain.handle('mail:send', async (event, { acc, to, subject, text, inReplyTo, references }) => {
    try {
        const nodemailer = require('nodemailer'); const port = parseInt(acc.smtpPort) || 465;
        const transport = nodemailer.createTransport({ host: acc.smtpHost, port, secure: port === 465, auth: { user: acc.email, pass: acc.password } });
        const info = await transport.sendMail({ from: acc.name ? `${acc.name} <${acc.email}>` : acc.email, to, subject, text, inReplyTo: inReplyTo || undefined, references: references || undefined });
        return { ok: true, id: info.messageId };
    } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('print-file', async (event, { filePath }) => {
    return new Promise((resolve) => {
        let url; try { url = pathToFileURL(filePath).href; } catch (_) { url = 'file://' + filePath; }
        const win = new BrowserWindow({ show: false, webPreferences: { plugins: true } }); let done = false;
        const finish = (r) => { if (done) return; done = true; try { win.destroy(); } catch(_){} resolve(r); };
        win.webContents.once('did-finish-load', () => { setTimeout(() => { try { win.webContents.print({ silent: false, printBackground: true }, (ok, reason) => { finish({ ok, reason }); }); } catch (e) { finish({ ok: false, error: e.message }); } }, 800); });
        win.webContents.once('did-fail-load', (e, code, desc) => finish({ ok: false, error: desc }));
        win.loadURL(url); setTimeout(() => finish({ ok: false, error: 'timeout' }), 20000);
    });
});

ipcMain.handle('editor-export', async (event, project) => {
    const ff = findFfmpeg(); if (!ff) return { ok: false, error: 'ffmpeg is not installed. On macOS: brew install ffmpeg' };
    const VAULT = path.join(os.homedir(), 'Documents', 'Vulsor_Memories', 'vault');
    const clips = project.videoClips || []; if (!clips.length) return { ok: false, error: 'no clips' };
    const out = path.join(VAULT, project.outName); const W = 1280, H = 720, FPS = 30;
    const args = [];
    clips.forEach(c => { args.push('-ss', String(c.inP), '-t', String(Math.max(0.05, c.outP - c.inP)), '-i', path.join(VAULT, c.storedName)); });
    const nClips = clips.length; let idx = nClips; let musicIdx = -1;
    if (project.music) { args.push('-i', path.join(VAULT, project.music.storedName)); musicIdx = idx; idx++; }
    const overlays = project.overlays || []; overlays.forEach(o => { args.push('-loop', '1', '-i', o.png); });
    const total = clips.reduce((s, c) => s + Math.max(0.05, c.outP - c.inP), 0); const fc = [];
    for (let i = 0; i < nClips; i++) {
        fc.push(`[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${FPS},format=yuv420p[v${i}]`);
        fc.push(`[${i}:a]aresample=44100,aformat=channel_layouts=stereo[a${i}]`);
    }
    let concatIn = ''; for (let i = 0; i < nClips; i++) concatIn += `[v${i}][a${i}]`;
    fc.push(`${concatIn}concat=n=${nClips}:v=1:a=1[cv][ca]`);
    let vlabel = '[cv]';
    overlays.forEach((o, j) => {
        const inLbl = (musicIdx >= 0 ? musicIdx + 1 : nClips) + j;
        const next = (j === overlays.length - 1) ? '[vtxt]' : `[ov${j}]`;
        fc.push(`${vlabel}[${inLbl}:v]overlay=0:0:enable='between(t,${o.start.toFixed(2)},${o.end.toFixed(2)})'${next}`); vlabel = next;
    });
    const vAfterText = overlays.length ? '[vtxt]' : '[cv]';
    const fadeD = Math.min(0.4, total / 4);
    fc.push(`${vAfterText}fade=t=in:st=0:d=${fadeD},fade=t=out:st=${(total - fadeD).toFixed(2)}:d=${fadeD}[vout]`);
    let aout = '[ca]';
    if (project.music) {
        const m = project.music; const delayMs = Math.max(0, Math.round((m.start || 0) * 1000));
        fc.push(`[${musicIdx}:a]atrim=${m.inP}:${m.outP},asetpts=PTS-STARTPTS,volume=${m.volume},adelay=${delayMs}|${delayMs}[mA]`);
        if (m.muteOriginal) { fc.push(`[ca]volume=0[casil]`); fc.push(`[casil][mA]amix=inputs=2:duration=first:dropout_transition=0[amix]`); }
        else { fc.push(`[ca][mA]amix=inputs=2:duration=first:dropout_transition=0[amix]`); }
        aout = '[amix]';
    }
    fc.push(`${aout}afade=t=in:st=0:d=${fadeD},afade=t=out:st=${(total - fadeD).toFixed(2)}:d=${fadeD}[aout]`);
    args.push('-filter_complex', fc.join(';'), '-map', '[vout]', '-map', '[aout]', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', '-y', out);

    return new Promise((resolve) => {
        const proc = spawn(ff, args); let err = ''; proc.stderr.on('data', d => { err += d.toString(); });
        proc.on('error', e => resolve({ ok: false, error: e.message }));
        proc.on('close', code => {
            (project.overlays || []).forEach(o => { try { fs.unlinkSync(o.png); } catch (_) {} });
            if (code === 0) { try { resolve({ ok: true, size: fs.statSync(out).size }); } catch (e) { resolve({ ok: false, error: 'output missing' }); } }
            else resolve({ ok: false, error: (err.split('\n').filter(Boolean).slice(-3).join(' ') || 'failed').slice(0, 300) });
        });
    });
});

ipcMain.handle('ffmpeg-edit', async (event, { storedName, start, duration, overlayPng, outName }) => {
    const ff = findFfmpeg(); if (!ff) return { ok: false, error: 'ffmpeg is not installed. On macOS: brew install ffmpeg' };
    const VAULT = path.join(os.homedir(), 'Documents', 'Vulsor_Memories', 'vault');
    const input = path.join(VAULT, storedName); const out = path.join(VAULT, outName);
    const args = []; if (start && start > 0) args.push('-ss', String(start)); if (duration && duration > 0) args.push('-t', String(duration)); args.push('-i', input);
    if (overlayPng && fs.existsSync(overlayPng)) { args.push('-loop', '1', '-i', overlayPng, '-filter_complex', '[0:v][1:v]overlay=0:0[outv]', '-map', '[outv]', '-map', '0:a?', '-shortest'); }
    args.push('-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', '-y', out);
    return new Promise((resolve) => {
        const proc = spawn(ff, args); let err = ''; proc.stderr.on('data', d => { err += d.toString(); });
        proc.on('error', e => resolve({ ok: false, error: e.message }));
        proc.on('close', code => {
            try { if (overlayPng) fs.unlinkSync(overlayPng); } catch (_) {}
            if (code === 0) { try { resolve({ ok: true, size: fs.statSync(out).size }); } catch (e) { resolve({ ok: false, error: 'missing' }); } }
            else { resolve({ ok: false, error: (err.split('\n').filter(Boolean).slice(-2).join(' ') || 'failed').slice(0, 200) }); }
        });
    });
});

ipcMain.handle('voice:transcribe-timed', async (event, { samples, sampleRate }) => {
    const bin = findWhisperBin(); if (!bin) return { ok: false, error: 'whisper.cpp is not installed. On macOS: brew install whisper-cpp' };
    const modelInfo = getWhisperModelInfo(); if (!modelInfo) return { ok: false, error: 'Model not downloaded' };
    const tmpFile = path.join(os.tmpdir(), `vulsor-cam-${Date.now()}.wav`);
    try {
        const float32 = samples instanceof Float32Array ? samples : new Float32Array(samples); writeWavFile(tmpFile, float32, sampleRate);
        const raw = await new Promise((resolve, reject) => {
            const proc = spawn(bin, ['-m', modelInfo.path, '-f', tmpFile, '-l', 'en', '--no-prints']);
            let out = '', err = ''; proc.stdout.on('data', d => out += d.toString()); proc.stderr.on('data', d => err += d.toString());
            proc.on('close', code => code === 0 ? resolve(out) : reject(new Error(err.trim() || 'whisper failed'))); proc.on('error', reject);
        });
        const segs = []; const re = /\[(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})\.(\d{3})\]\s*(.*)/;
        for (const line of raw.split('\n')) {
            const m = line.match(re); if (!m) continue;
            const start = (+m[1])*3600000 + (+m[2])*60000 + (+m[3])*1000 + (+m[4]);
            const end   = (+m[5])*3600000 + (+m[6])*60000 + (+m[7])*1000 + (+m[8]);
            const text  = m[9].trim().replace(/\[.*?\]/g, '').trim(); if (text) segs.push({ start, end, text });
        }
        return { ok: true, segments: segs, text: segs.map(s => s.text).join(' ') };
    } catch (e) { return { ok: false, error: e.message }; } finally { try { fs.unlinkSync(tmpFile); } catch (_) {} }
});

ipcMain.handle('research-tts', async (event, { lines }) => {
    try {
        const dir = path.join(os.tmpdir(), 'vulsor_audio_' + Date.now()); fs.mkdirSync(dir, { recursive: true });
        const voiceA = 'Samantha', voiceB = 'Daniel'; const files = [];
        for (let i = 0; i < lines.length; i++) {
            const l = lines[i]; const voice = l.speaker === 'B' ? voiceB : voiceA; const out = path.join(dir, `line_${String(i).padStart(3,'0')}.wav`);
            await new Promise((resolve, reject) => {
                const child = spawn('say', ['-v', voice, '-o', out, '--data-format=LEI16@22050', l.text]);
                child.on('error', reject); child.on('close', code => code === 0 ? resolve() : reject(new Error('exit ' + code)));
            });
            files.push(out);
        }
        return { ok: true, dir, files };
    } catch (e) { return { ok: false, error: e.message }; }
});

function _claudeCliEnv() {
    const home = os.homedir();
    const extras = [ '/usr/local/bin', '/usr/bin', '/bin', '/opt/homebrew/bin', '/opt/homebrew/sbin', path.join(home, '.claude', 'local'), path.join(home, '.npm-global', 'bin'), path.join(home, '.local', 'bin'), path.join(home, '.bun', 'bin'), path.join(home, 'node_modules', '.bin') ];
    const current = (process.env.PATH || '').split(':').filter(Boolean); const seen = new Set();
    const merged = [...extras, ...current].filter(p => { if (seen.has(p)) return false; seen.add(p); return true; });
    const env = Object.assign({}, process.env, { PATH: merged.join(':') });
    let info = {}; try { info = os.userInfo(); } catch (_) {}
    env.HOME = env.HOME || info.homedir || home; env.USER = env.USER || info.username || ''; env.LOGNAME = env.LOGNAME || info.username || '';
    return env;
}
ipcMain.handle('claude-cli-chat', async (event, { prompt, model }) => {
    return new Promise((resolve) => {
        const env  = _claudeCliEnv(); const args = ['-p', '--output-format', 'text']; if (model) args.push('--model', model);
        let child; try { child = spawn('claude', args, { env, cwd: os.homedir() }); } catch (e) { return resolve({ ok: false, error: e.message }); }
        let out = '', err = '';
        child.on('error', e => { resolve({ ok: false, error: e.code === 'ENOENT' ? 'Not found.' : e.message }); });
        child.stdout.on('data', d => out += d.toString()); child.stderr.on('data', d => err += d.toString());
        child.on('close', code => { if (code === 0) resolve({ ok: true, text: out.trim() }); else resolve({ ok: false, error: (err.trim() || 'exit ' + code).slice(0, 400) }); });
        try { child.stdin.write(prompt); child.stdin.end(); } catch (e) { resolve({ ok: false, error: e.message }); }
    });
});

ipcMain.on('claude-chat', (event, { requestId, apiKey, model, system, messages }) => {
    const body = Buffer.from(JSON.stringify({ model: model || 'claude-sonnet-4-5', system, messages, max_tokens: 4096, stream: true }));
    const req = https.request({ hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Length': body.length } }, res => {
        let buf = '';
        res.on('data', chunk => {
            buf += chunk.toString(); const lines = buf.split('\n'); buf = lines.pop();
            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                const raw = line.slice(6).trim(); if (!raw || raw === '[DONE]') continue;
                try {
                    const ev = JSON.parse(raw);
                    if (ev.type === 'content_block_delta' && ev.delta?.text) { if (!event.sender.isDestroyed()) event.sender.send('claude-chunk', { requestId, text: ev.delta.text }); }
                    else if (ev.type === 'message_stop') { if (!event.sender.isDestroyed()) event.sender.send('claude-chunk', { requestId, done: true }); }
                    else if (ev.type === 'error') { if (!event.sender.isDestroyed()) event.sender.send('claude-chunk', { requestId, error: ev.error?.message || 'Error', done: true }); }
                } catch (_) {}
            }
        });
        res.on('end', () => { if (!event.sender.isDestroyed()) event.sender.send('claude-chunk', { requestId, done: true }); });
    });
    req.on('error', err => { if (!event.sender.isDestroyed()) event.sender.send('claude-chunk', { requestId, error: err.message, done: true }); });
    req.write(body); req.end();
});

// Render HTML in a hidden window and write a real PDF file (no print dialog).
// Returns { success, path } — default output dir is ~/Downloads.
ipcMain.handle('export-pdf', async (event, { html, name, outDir }) => {
    const tmpFile = path.join(os.tmpdir(), `vulsor_pdf_${Date.now()}.html`);
    fs.writeFileSync(tmpFile, html);
    const win = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true } });
    try {
        await win.loadURL(`file://${tmpFile}`);
        await new Promise(r => setTimeout(r, 500));   // let images/fonts settle
        const data = await win.webContents.printToPDF({
            printBackground: true, pageSize: 'A4',
            margins: { top: 0.6, bottom: 0.6, left: 0.6, right: 0.6 },
        });
        const dir  = outDir || path.join(os.homedir(), 'Downloads');
        const safe = String(name || 'document').replace(/[^\w\s.-]/g, '').trim().replace(/\s+/g, '_').slice(0, 80) || 'document';
        let out = path.join(dir, safe + '.pdf');
        let n = 2;
        while (fs.existsSync(out)) out = path.join(dir, `${safe}_${n++}.pdf`);
        fs.writeFileSync(out, data);
        return { success: true, path: out };
    } catch (e) {
        console.error('[export-pdf]', e);
        return { success: false, error: e.message };
    } finally {
        win.destroy();
        try { fs.unlinkSync(tmpFile); } catch (_) {}
    }
});

ipcMain.handle('print-html', async (event, { html, title }) => {
    return new Promise((resolve) => {
        const tmpFile = path.join(os.tmpdir(), `vulsor_print_${Date.now()}.html`); fs.writeFileSync(tmpFile, html);
        const printWin = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true } });
        printWin.loadURL(`file://${tmpFile}`);
        printWin.webContents.once('did-finish-load', () => { printWin.webContents.print({ silent: false, printBackground: true }, (success, reason) => { printWin.destroy(); try { fs.unlinkSync(tmpFile); } catch(_) {} resolve({ success, reason }); }); });
    });
});

const BW_FIREFOX_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:140.0) Gecko/20100101 Firefox/140.0';
const BW_AUTH_HOSTS = /(^|\.)accounts\.(google|youtube)\.com$|(^|\.)gds\.google\.com$/i;
// Client-Hint headers that say "Google Chrome" (Electron's default only says
// "Chromium", which Prime Video etc. reject). Major version from the clean UA.
const _CHROME_MAJOR = (((app.userAgentFallback || '').match(/Chrome\/(\d+)/) || [])[1]) || '148';
const BW_SECCHUA = `"Not)A;Brand";v="99", "Google Chrome";v="${_CHROME_MAJOR}", "Chromium";v="${_CHROME_MAJOR}"`;
const BW_DOWNLOADS_DIR = path.join(os.homedir(), 'Downloads');

// v2 cache name so the upgrade to the big Brave-grade lists is picked up on next
// launch (the old ~3.6k-domain cache is ignored, forcing a fresh download).
const AD_CACHE_FILE = () => path.join(app.getPath('userData'), 'adblock-hosts-v2.txt');
const AD_FLAG_FILE  = () => path.join(app.getPath('userData'), 'adblock.json');
// Brave-grade network blocking = big, well-tuned host lists. HaGeZi "Pro" is the
// core list (ads + trackers + a lot of pop-under/malvertising domains, tuned for low
// breakage); Peter Lowe's is a small, reliable ads backup. We merge them all into the
// crash-safe host Set (the Ghostery filter ENGINE segfaults this castlabs build, so we
// deliberately do NOT use it — see _initAdblockEngine).
const AD_LIST_URLS  = [
    'https://raw.githubusercontent.com/hagezi/dns-blocklists/main/hosts/pro.txt',
    'https://pgl.yoyo.org/adservers/serverlist.php?hostformat=hosts&showintro=0&mimetype=plaintext',
];
const AD_REFRESH_MS = 7 * 24 * 60 * 60 * 1000;
const AD_BUILTIN = [ 'doubleclick.net','googlesyndication.com','googleadservices.com','google-analytics.com','googletagmanager.com','googletagservices.com','adservice.google.com','amazon-adsystem.com','ads.yahoo.com','adserver.yahoo.com','taboola.com','outbrain.com','criteo.com','criteo.net','scorecardresearch.com','quantserve.com','adnxs.com','rubiconproject.com','pubmatic.com','openx.net','moatads.com','adsrvr.org','3lift.com','casalemedia.com','sharethrough.com','zedo.com','bidswitch.net','smartadserver.com','advertising.com','adcolony.com','applovin.com','connect.facebook.net','analytics.tiktok.com','ads.tiktok.com','hotjar.com','mixpanel.com','segment.com','segment.io','branch.io','fullstory.com','mouseflow.com','clarity.ms','doubleverify.com','serving-sys.com','flashtalking.com','yieldmo.com','teads.tv','indexww.com','gumgum.com','sizmek.com','contextweb.com','districtm.io','adform.net','bench.utils.google.com','popads.net','popcash.net','propellerads.com','propellerpops.com','propu.sh','propellerclick.com','adsterra.com','ad-maven.com','admaven.com','hilltopads.net','hilltopads.com','clickadu.com','exoclick.com','exosrv.com','juicyads.com','trafficjunky.com','trafficjunky.net','popmyads.com','onclickads.net','onclckds.com','onclasrv.com','adcash.com','adsterracdn.com','mgid.com','revcontent.com','adskeeper.com','bidvertiser.com','clicksor.com','poptm.com','popunder.net','galaksion.com','adnium.com','admexo.com','clickaine.com','toroadvertising.com','mybetterdeals.net','a-ads.com','adrunnr.com','servedby-buysellads.com' ];
const adBlock = { enabled: true, popupBlock: true, hosts: new Set(), count: 0, popupCount: 0 };
const _popupTimes = {};   

function _adParseHosts(text) {
    const out = [];
    for (const raw of text.split('\n')) {
        const line = raw.replace(/#.*$/, '').trim(); if (!line) continue;
        const parts = line.split(/\s+/); const domain = ((parts.length > 1 ? parts[1] : parts[0]) || '').toLowerCase();
        if (domain && domain !== 'localhost' && /^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) out.push(domain);
    }
    return out;
}
function _adLoad() {
    AD_BUILTIN.forEach(d => adBlock.hosts.add(d));
    try { if (fs.existsSync(AD_CACHE_FILE())) _adParseHosts(fs.readFileSync(AD_CACHE_FILE(), 'utf8')).forEach(d => adBlock.hosts.add(d)); } catch (_) {}
    try { if (fs.existsSync(AD_FLAG_FILE())) { const f = JSON.parse(fs.readFileSync(AD_FLAG_FILE(), 'utf8')); adBlock.enabled = f.enabled !== false; adBlock.popupBlock = f.popupBlock !== false; } } catch (_) {}
    let stale = true; try { stale = !fs.existsSync(AD_CACHE_FILE()) || (Date.now() - fs.statSync(AD_CACHE_FILE()).mtimeMs) > AD_REFRESH_MS; } catch (_) {}
    if (stale) _adRefresh();
}
function _adRefresh() {
    // Download every blocklist, merge into the live Set immediately, and write the
    // combined result to the cache once all fetches finish. A failed list is skipped
    // (the others + the built-ins still apply), so blocking never fully breaks.
    let pending = AD_LIST_URLS.length;
    const merged = new Set();
    let gotAny = false;
    AD_LIST_URLS.forEach(u => _adDownload(u, (err, text) => {
        if (!err && text) {
            const list = _adParseHosts(text);
            if (list.length >= 50) { gotAny = true; for (const d of list) { merged.add(d); adBlock.hosts.add(d); } }
        }
        if (--pending === 0 && gotAny) {
            try { fs.writeFileSync(AD_CACHE_FILE(), Array.from(merged).join('\n')); } catch (_) {}
        }
    }));
}
function _adDownload(url, cb, redirects = 0) {
    try {
        https.get(url, { headers: { 'User-Agent': 'VulsorAdblock/1.0' } }, res => {
            if ([301,302,307,308].includes(res.statusCode) && res.headers.location && redirects < 5) { res.resume(); return _adDownload(res.headers.location, cb, redirects + 1); }
            if (res.statusCode !== 200) { res.resume(); return cb(new Error('HTTP ' + res.statusCode)); }
            let data = ''; res.setEncoding('utf8'); res.on('data', c => data += c); res.on('end', () => cb(null, data));
        }).on('error', e => cb(e));
    } catch (e) { cb(e); }
}
function _adBlocked(hostname) {
    if (!hostname) return false; hostname = hostname.toLowerCase(); if (adBlock.hosts.has(hostname)) return true;
    let idx = hostname.indexOf('.');
    while (idx !== -1) { if (adBlock.hosts.has(hostname.slice(idx + 1))) return true; idx = hostname.indexOf('.', idx + 1); }
    return false;
}

// Spam / pop-under destination check for NEW-TAB opens. Pop-unders on streaming &
// piracy sites (123movies, etc.) usually target throwaway domains on cheap
// high-abuse TLDs (e.g. sx.domagedeacons.shop) that aren't on any ad-network list,
// so `_adBlocked` misses them. These TLDs are overwhelmingly ads/scams and almost
// never something a user deliberately opens in a new tab, so refusing pop-ups to
// them is a safe, high-signal filter. Random-looking many-subdomain hosts on a bare
// registrable domain are also treated as pop-unders.
const _SPAM_TLD_RE = /\.(shop|top|xyz|club|online|site|fun|live|cyou|sbs|cfd|icu|rest|quest|monster|buzz|click|link|gdn|loan|download|review|bar|beauty|boats|autos|makeup|hair|skin|mom|lol|cam|men|stream|racing|date|faith|win|accountant|science|party|gq|cf|ml|ga|tk|pw|bid|vip|zip|sbs|rodeo|cricket|trade|webcam|country|kim|work|wang)$/i;
function _isSpamPopup(url) {
    let h;
    try { h = new URL(url).hostname.toLowerCase(); } catch (_) { return false; }
    if (_adBlocked(h)) return true;         // known ad networks
    if (_SPAM_TLD_RE.test(h)) return true;  // throwaway high-abuse TLD
    // Long hostname with many labels + a random-looking (vowel-poor) leaf label —
    // the shape of auto-generated pop-under subdomains.
    const labels = h.split('.');
    if (labels.length >= 3) {
        const leaf = labels[0];
        if (leaf.length >= 10 && !/[aeiou]/.test(leaf.replace(/[^a-z]/g, '').slice(0, 8))) return true;
    }
    return false;
}
function _adSaveFlags() { try { fs.writeFileSync(AD_FLAG_FILE(), JSON.stringify({ enabled: adBlock.enabled, popupBlock: adBlock.popupBlock })); } catch (_) {} }

// Hosts where the ad-block engine is fully bypassed — no network blocking, no
// CSP rewriting, and (critically) no cosmetic/scriptlet injection. YouTube's
// player is broken by the injected uBO-style scriptlets (json-prune etc.), which
// is why videos render as a black screen, so we exclude the whole YouTube/Google
// video stack here.
const ADBLOCK_SKIP_RE = /(^|\.)(youtube\.com|youtube-nocookie\.com|youtubekids\.com|youtu\.be|ytimg\.com|googlevideo\.com|ggpht\.com)$/i;
function _adblockHostSkip(re, u) { try { return re.test(new URL(u).hostname); } catch (_) { return false; } }
// Partial / surgical YouTube handling. We deliberately do NOT touch YouTube's own
// network requests at all:
//   * Running the broad host-list blocker against its domains kills icons,
//     thumbnails, the player and the innertube API ("the icons don't work").
//   * CANCELLING its ad/tracking endpoints (/pagead, /api/stats/ads, …) is exactly
//     what YouTube's anti-adblock detection watches for — a failed/blocked ad
//     request is what triggers the "Ad blockers are not allowed" wall. So we must
//     let those requests SUCCEED to stay undetected.
// Net result: any request that is part of a YouTube page is passed through
// untouched (undetectable), while every other site keeps full blocking. Crucially
// this also covers the player's own ad/measurement fetches to third-party hosts
// (googleads.g.doubleclick.net, …): cancelling THOSE is the main thing that fires
// the wall, so on a YouTube tab we let them succeed. Off YouTube those same hosts
// are still blocked globally. Ad removal on YouTube itself is intentionally off.
const YT_PAGE_RE = /(^|\.)(youtube\.com|youtube-nocookie\.com|youtubekids\.com|youtu\.be)$/i;
function _isYouTubeReq(details) {
    // Request to YouTube's own stack (player, icons, thumbnails, innertube API).
    if (_adblockHostSkip(ADBLOCK_SKIP_RE, details.url)) return true;
    // Request made BY a YouTube page (e.g. the player's ad/measurement call to
    // doubleclick) — keyed off the referrer and the top-level page URL.
    try { if (details.referrer && YT_PAGE_RE.test(new URL(details.referrer).hostname)) return true; } catch (_) {}
    try { const wc = details.webContents; if (wc && !wc.isDestroyed()) { const u = wc.getURL(); if (u && YT_PAGE_RE.test(new URL(u).hostname)) return true; } } catch (_) {}
    return false;
}
// Wrap the engine's three Electron entry points so matching hosts are passed
// through untouched. BlockingContext dispatches dynamically to these instance
// methods, so wrapping them here applies to every session.
function _excludeAdblockHosts(engine, re) {
    if (!engine || engine._vulsorExcluded) return;
    engine._vulsorExcluded = true;
    const origBefore  = engine.onBeforeRequest.bind(engine);
    const origHeaders = engine.onHeadersReceived.bind(engine);
    const origInject  = engine.onInjectCosmeticFilters.bind(engine);
    engine.onBeforeRequest = (details, cb) => _adblockHostSkip(re, details.url) ? cb({}) : origBefore(details, cb);
    engine.onHeadersReceived = (details, cb) => _adblockHostSkip(re, details.url) ? cb({}) : origHeaders(details, cb);
    engine.onInjectCosmeticFilters = (event, url, msg) => _adblockHostSkip(re, url) ? Promise.resolve() : origInject(event, url, msg);
}
async function _initAdblockEngine() {
    // DISABLED — confirmed again 2026-06-23: even loading the Ghostery engine and
    // calling match() ONLY on script/sub_frame requests (no enableBlockingInSession)
    // still segfaults this castlabs Electron build ~30s in. The engine is simply not
    // viable here. Brave-style blocking is provided instead by the crash-safe stack:
    // the host-list network blocker (_setupBrowserSession), the structural srcdoc
    // ad-shell removal, the click-catcher neutralizer, and the per-frame
    // MutationObserver — all in _bwSweepCode / browser-preload.js.
    return;
    // eslint-disable-next-line no-unreachable
    if (!ElectronBlocker || !_fromElectronDetails) return;
    try {
        const cache = path.join(app.getPath('userData'), 'adblock-engine.bin');
        _adblockEngine = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch, { path: cache, read: async (p) => fs.promises.readFile(p), write: async (p, d) => fs.promises.writeFile(p, d) });
    } catch (e) { _adblockEngine = null; }
}
ipcMain.on('declutter-frames', (e, wcId) => { try { const c = webContents.fromId(wcId); if (c) _bwSweepAllFrames(c, true); } catch (_) {} });

ipcMain.handle('adblock:get', () => ({ enabled: adBlock.enabled, popupBlock: adBlock.popupBlock, count: adBlock.count, popupCount: adBlock.popupCount, size: adBlock.hosts.size }));
ipcMain.handle('adblock:set', (e, patch) => {
    if (patch && typeof patch === 'object') {
        if ('enabled' in patch) adBlock.enabled = !!patch.enabled;
        if ('popupBlock' in patch) adBlock.popupBlock = !!patch.popupBlock;
        _adSaveFlags();
        // Engine blocking is gated by the adBlock.enabled check inside
        // onBeforeRequest, so toggling needs no per-session enable/disable here.
    }
    return { enabled: adBlock.enabled, popupBlock: adBlock.popupBlock };
});

function _setupBrowserSession(ses) {
    if (ses._vulsorBrowserSetup) return;
    ses._vulsorBrowserSetup = true;

    ses.webRequest.onBeforeRequest((details, cb) => {
        if (!adBlock.enabled || details.resourceType === 'mainFrame') return cb({});
        // YouTube: pass every request belonging to a YouTube page through untouched
        // (including the player's own ad/measurement fetches). Blocking or cancelling
        // any of it is what trips the "Ad blockers are not allowed" wall — see
        // YT_PAGE_RE / _isYouTubeReq.
        if (_isYouTubeReq(details)) return cb({});
        try { if (_adBlocked(new URL(details.url).hostname)) { adBlock.count++; return cb({ cancel: true }); } } catch (_) {}
        // Brave-style filter-list blocking, scoped to ad-carrying request types so
        // the engine's match() can't build the sustained load that crashes this
        // build. Blocking the ad SCRIPT / ad <iframe> here stops the popup & its
        // click-catcher from ever being created (no flash, no episode-switch gap).
        try {
            if (_adblockEngine && _AD_NET_TYPES.has(details.resourceType) && !_adblockHostSkip(ADBLOCK_SKIP_RE, details.url)) {
                const { match, redirect } = _adblockEngine.match(_fromElectronDetails(details));
                if (match && !redirect) { adBlock.count++; return cb({ cancel: true }); }
            }
        } catch (_) {}
        cb({});
    });

    ses.webRequest.onBeforeSendHeaders((details, cb) => {
        const headers = details.requestHeaders;
        try {
            if (BW_AUTH_HOSTS.test(new URL(details.url).hostname)) {
                headers['User-Agent'] = BW_FIREFOX_UA;
                for (const k of Object.keys(headers)) if (/^sec-ch-ua/i.test(k)) delete headers[k];
            } else {
                // Replace the "Chromium"-only Client-Hint header with one that
                // advertises Google Chrome, so streaming sites accept the browser.
                for (const k of Object.keys(headers)) {
                    if (k.toLowerCase() === 'sec-ch-ua') headers[k] = BW_SECCHUA;
                }
            }
        } catch (_) {}
        cb({ requestHeaders: headers });
    });

    ses.on('will-download', (event, item, webContents) => {
        const dlId = 'dl' + Date.now() + Math.random().toString(36).slice(2, 6);
        const fname = (item.getFilename() || 'download').replace(/[/\\]/g, '_');
        const ext = path.extname(fname), base = path.basename(fname, ext);
        let dest = path.join(BW_DOWNLOADS_DIR, fname), n = 1;
        while (fs.existsSync(dest)) dest = path.join(BW_DOWNLOADS_DIR, `${base} (${n++})${ext}`);
        item.setSavePath(dest);
        const host = webContents && (webContents.hostWebContents || webContents);
        const send = (ch, extra) => { try { if (host && !host.isDestroyed()) host.send(ch, { id: dlId, filename: path.basename(dest), path: dest, url: item.getURL(), ...extra }); } catch (_) {} };
        send('browser-download-started', { total: item.getTotalBytes() });
        item.on('updated', () => send('browser-download-progress', { received: item.getReceivedBytes(), total: item.getTotalBytes() }));
        item.once('done', (e2, state) => send('browser-download-done', { state }));
    });

    _browserSessions.add(ses);
    // NOTE: we deliberately do NOT call enableBlockingInSession here — the engine
    // is used only via the scoped match() in onBeforeRequest above (crash-safe).
}

ipcMain.handle('secure-encrypt', (e, plain) => {
    try { if (!safeStorage.isEncryptionAvailable()) return { available: false }; return { available: true, data: safeStorage.encryptString(String(plain)).toString('base64') }; } catch (_) { return { available: false }; }
});
ipcMain.handle('secure-decrypt', (e, b64) => {
    try { if (!safeStorage.isEncryptionAvailable()) return { available: false }; return { available: true, data: safeStorage.decryptString(Buffer.from(String(b64), 'base64')) }; } catch (_) { return { available: false }; }
});

ipcMain.handle('browser-clear-data', async () => {
    for (const p of ['persist:browser', 'browser-private']) { try { const ses = session.fromPartition(p); await ses.clearCache(); await ses.clearStorageData(); } catch (_) {} }
    return { ok: true };
});

function _bwSweepCode(aggressive, streaming) {
    return `(function(){try{
        function frac(r,p){var ox=Math.max(0,Math.min(r.right,p.right)-Math.max(r.left,p.left));var oy=Math.max(0,Math.min(r.bottom,p.bottom)-Math.max(r.top,p.top));var a=r.width*r.height;return a>0?(ox*oy)/a:0;}
        var SR=/not a robot|check the box|to view the (site|content|video)|click\\s*["']?(allow|ok|continue)|press\\s*["']?(allow|ok)|enable\\s+(push\\s+)?notification|prove you|are you human|human verification|please confirm|confirm (to|that|you)|to continue|over\\s?18|18\\s?\\+|reward zone|congratulation|you (have )?won|claim (your|now)/i;
        var vids=document.querySelectorAll('video'),main=null,ma=0,i,r,a;
        for(i=0;i<vids.length;i++){r=vids[i].getBoundingClientRect();a=r.width*r.height;if(a>ma&&r.width>=250&&r.height>=150){ma=a;main=vids[i];}}
        var pl=main,pa=ma;
        if(!pl){var ifr=document.querySelectorAll('iframe,embed,object');for(i=0;i<ifr.length;i++){r=ifr[i].getBoundingClientRect();a=r.width*r.height;if(a>pa&&r.width>=250&&r.height>=150){pa=a;pl=ifr[i];}}}
        var pr=pl?pl.getBoundingClientRect():null;
        // Safety net: the player itself must always stay interactive. Some sites (and
        // our own catcher sweeps in earlier ticks) leave the player <iframe>/<video>
        // at pointer-events:none, which plays the video but makes the page feel frozen
        // (no pause/seek/click). Force it back on. pointer-events:auto on the element
        // re-enables it even if an ancestor is set to none.
        try{if(pl){var _plpe='';try{_plpe=getComputedStyle(pl).pointerEvents;}catch(_){}if(_plpe==='none')pl.style.setProperty('pointer-events','auto','important');}}catch(_){}
        var _trz=/(^|\\.)(youtube\\.com|youtu\\.be|youtube-nocookie\\.com|google\\.[a-z.]+|gstatic\\.com|netflix\\.com|spotify\\.com|twitch\\.tv|vimeo\\.com|disneyplus\\.com|hbomax\\.com|max\\.com|primevideo\\.com|hulu\\.com|wikipedia\\.org|github\\.com|reddit\\.com)$/i;var _trusted=false;try{_trusted=_trz.test(location.hostname||'');}catch(_){}
        var NF=/browse ad[- ]?free|powerful blocking|faster speeds|enha[sn]ced privacy|allow (notifications?|push|to (continue|watch|proceed|view|browse))|click\\s*["']?allow to/i;
        // Brave-style instant kill: install a one-time MutationObserver per frame
        // that hides any newly-inserted scam-bait element the moment it appears.
        // The popup lives in an about:srcdoc ad frame the <webview> preload never
        // reaches, but this injected code does — so we plant the observer here.
        var _subFrame=false;try{_subFrame=(window.top!==window.self);}catch(_){}
        var _href='';try{_href=location.href||'';}catch(_){}
        var _isAboutFrame=/^about:srcdoc/i.test(_href);
        var _hasBigMedia=function(doc){try{var v=(doc||document).querySelectorAll('video,iframe,embed,object');for(var _m=0;_m<v.length;_m++){var _rm=v[_m].getBoundingClientRect();if(_rm.width>=250&&_rm.height>=150)return true;}return false;}catch(_){return false;}};
        var _blankFrame=function(){try{var de=document.documentElement;if(de)de.style.setProperty('display','none','important');if(document.body)document.body.style.setProperty('display','none','important');}catch(_){}};
        // An about:srcdoc <iframe> that holds no real video is an injected ad shell
        // (the scam popup + its full-page click-catcher). This is STRUCTURAL —
        // independent of the ad's wording — so it survives the creative rotating
        // between "Browse ad-free", "Turn on an ad blocker", etc. (about:blank is
        // intentionally NOT matched: video players legitimately load through it.)
        var _isAdShell=function(F){try{return !!(F.hasAttribute&&F.hasAttribute('srcdoc'));}catch(_){return false;}};
        var _dropShellIframes=function(){try{var _ifr=document.querySelectorAll('iframe');for(var _x=0;_x<_ifr.length;_x++){var _F=_ifr[_x];if(!_isAdShell(_F))continue;var _holds=false;try{_holds=_hasBigMedia(_F.contentDocument);}catch(_){_holds=false;}if(_holds)continue;try{_F.style.setProperty('display','none','important');}catch(_){}try{_F.style.setProperty('pointer-events','none','important');}catch(_){}try{_F.remove();}catch(_){}}}catch(_){}};
        if(!_trusted&&_subFrame&&_isAboutFrame&&!_hasBigMedia(document)){_blankFrame();}
        if(!_trusted){_dropShellIframes();}
        // Neutralize full-page CLICK-CATCHERS: a positioned layer covering most of
        // the viewport that is invisible (transparent + empty) or a giant ad <a>/<ins>
        // swallows every click while the video plays behind it — the page feels
        // "frozen". Let clicks pass through (pointer-events:none) / hide ad anchors.
        // The player and its container are skipped so video controls still work.
        if(!_trusted){try{var _vw=innerWidth,_vh=innerHeight,_ov=document.querySelectorAll('body *');for(var _o=0;_o<_ov.length&&_o<9000;_o++){var _e=_ov[_o],_cc;if(_e===pl||(_e.contains&&_e.contains(pl)))continue;try{_cc=getComputedStyle(_e);}catch(_){continue;}if(_cc.position!=='fixed'&&_cc.position!=='absolute')continue;if(_cc.pointerEvents==='none')continue;var _rr=_e.getBoundingClientRect();if(_rr.width<120||_rr.height<120)continue;var _tg=_e.tagName;if(_tg==='IFRAME'||_tg==='VIDEO'||_tg==='EMBED'||_tg==='OBJECT')continue;if((_tg==='A'||_tg==='INS')&&_rr.width>=_vw*0.5&&_rr.height>=_vh*0.5){try{_e.style.setProperty('display','none','important');}catch(_){}continue;}var _tr=(_cc.backgroundColor==='rgba(0, 0, 0, 0)'||_cc.backgroundColor==='transparent'||parseFloat(_cc.opacity||'1')<0.1);if(!_tr)continue;if((_e.textContent||'').trim().length>0)continue;var _hm=false;try{_hm=!!_e.querySelector('video,iframe,embed,object,img');}catch(_){}if(_hm)continue;var _full=(_rr.width>=_vw*0.6&&_rr.height>=_vh*0.6);var _op=(pr&&frac(_rr,pr)>0.5);if(_full||_op){try{_e.style.setProperty('pointer-events','none','important');}catch(_){}}}}catch(_){}}
        if(!_trusted&&!window.__vulsor_nfmo){window.__vulsor_nfmo=1;try{var _killNode=function(n){try{if(!n||n.nodeType!==1)return;if(n.tagName==='IFRAME'&&_isAdShell(n)){var _h=false;try{_h=_hasBigMedia(n.contentDocument);}catch(_){}if(!_h){try{n.remove();}catch(_){try{n.style.setProperty('display','none','important');}catch(__){}}return;}}if(!n.style)return;try{var _c2=getComputedStyle(n);if((_c2.position==='fixed'||_c2.position==='absolute')&&_c2.pointerEvents!=='none'){var _r2=n.getBoundingClientRect();if(_r2.width>=180&&_r2.height>=120&&(_r2.width>=innerWidth*0.5||_r2.height>=innerHeight*0.5)){var _t2=(_c2.backgroundColor==='rgba(0, 0, 0, 0)'||_c2.backgroundColor==='transparent'||parseFloat(_c2.opacity||'1')<0.1);if(_t2&&(n.textContent||'').trim().length===0&&n!==pl&&!(n.contains&&n.contains(pl))){var _m2=(n.tagName==='IFRAME'||n.tagName==='VIDEO'||n.tagName==='EMBED'||n.tagName==='OBJECT');try{_m2=_m2||!!n.querySelector('video,iframe,embed,object,img');}catch(_){}if(!_m2)n.style.setProperty('pointer-events','none','important');}}}}catch(_){}var tt=n.textContent||'';if(tt.length<400&&NF.test(tt)){n.style.setProperty('display','none','important');if(_subFrame&&_isAboutFrame)_blankFrame();}}catch(_){}};var _mo=new MutationObserver(function(ms){for(var mi=0;mi<ms.length;mi++){var an=ms[mi].addedNodes;for(var aj=0;aj<an.length;aj++){_killNode(an[aj]);}}});var _stmo=function(){try{_mo.observe(document.documentElement||document.body,{childList:true,subtree:true});}catch(_){}};if(document.body){_stmo();}else{document.addEventListener('DOMContentLoaded',_stmo,true);}}catch(_){}}
        // Periodic safety-net sweep. NF (scam-bait) text is checked BEFORE the
        // fixed/absolute gate because these ad popups use position:relative inside
        // their srcdoc frame; the player-overlap rule below still needs positioning.
        if(!document.hidden){var all=document.querySelectorAll('body *');var _hide=[];for(var k=0;k<all.length&&k<7000;k++){var e=all[k],cs;if(pl&&(e===pl||(e.contains&&e.contains(pl))||(pl.contains&&pl.contains(e))))continue;try{cs=getComputedStyle(e);}catch(_){continue;}var er=e.getBoundingClientRect();if(er.width<24||er.height<24)continue;var t=e.textContent||'';if(!_trusted&&t.length<260&&NF.test(t)){_hide.push(e);continue;}if(cs.position!=='fixed'&&cs.position!=='absolute')continue;var z=parseInt(cs.zIndex,10)||0;if(!_trusted&&pr&&frac(er,pr)>0.5&&(er.width*er.height)<pa*0.97){var ok=${aggressive ? 'true' : '(z>=50)||(t.length<260&&SR.test(t))'};if(ok){_hide.push(e);}}}for(var hh=0;hh<_hide.length;hh++){try{_hide[hh].style.setProperty('display','none','important');}catch(_){}}}
        var isTop=(window.top===window.self);
        var doMute = main || pr || (${streaming ? 'true' : 'false'} && !isTop);
        if(doMute){var med=document.querySelectorAll('audio,video');for(var m=0;m<med.length;m++){if(med[m]===main)continue;try{med[m].muted=true;med[m].volume=0;}catch(_){}}}
        if(${streaming ? 'true' : 'false'}){
          try{ if(!window.__vulsor_sss){window.__vulsor_sss=1;
            var S=window.AudioScheduledSourceNode;
            if(S&&S.prototype&&S.prototype.start){S.prototype.start=function(){try{this.disconnect&&this.disconnect();}catch(e){}};}
            window.__vulsor_acs=window.__vulsor_acs||[];
            ['AudioContext','webkitAudioContext'].forEach(function(n){var C=window[n];if(!C)return;function W(o){var c=new C(o);try{window.__vulsor_acs.push(c);if(window.__vulsor_acs.length>32)window.__vulsor_acs.shift();}catch(e){}return c;}W.prototype=C.prototype;try{Object.defineProperty(window,n,{value:W,configurable:true,writable:true});}catch(e){try{window[n]=W;}catch(_){}}});
          } }catch(e){}
          if(!main${aggressive ? '||true' : ''}){try{(window.__vulsor_acs||[]).forEach(function(c){try{if(c.state==='running')c.suspend();}catch(e){}});}catch(e){}}
        }
    }catch(e){}})()`;
}

async function _bwSweepAllFrames(contents, aggressive) {
    try {
        const mf = contents.mainFrame; if (!mf) return;
        let streaming = false;
        try { streaming = await mf.executeJavaScript(`(function(){try{var v=document.querySelectorAll('video,iframe,embed,object');for(var i=0;i<v.length;i++){var r=v[i].getBoundingClientRect();if(r.width>=250&&r.height>=150)return true;}return false;}catch(e){return false;}})()`, true); } catch (_) {}
        const frames = mf.framesInSubtree || [mf]; const code = _bwSweepCode(!!aggressive, !!streaming);
        for (const f of frames) { try { f.executeJavaScript(code, true).catch(() => {}); } catch (_) {} }
    } catch (_) {}
}


// ⌘S for the browser. A page that IS a media document (an image, video,
// audio file or PDF opened directly) goes through downloadURL so the normal
// Downloads bar tracks it; an HTML page gets a Save dialog + complete-page
// save (html + assets folder).
async function _bwSavePage(contents) {
    try {
        const url = contents.getURL() || '';
        if (!/^https?:/i.test(url)) return;
        let ctype = '';
        try { ctype = String(await contents.executeJavaScript('document.contentType', true) || ''); } catch (_) {}
        if (/^(image|video|audio)\//i.test(ctype) || /pdf$/i.test(ctype)) { contents.downloadURL(url); return; }
        const win = BrowserWindow.fromWebContents(contents.hostWebContents || contents);
        const title = (contents.getTitle() || '').replace(/[\/\\:*?"<>|]/g, '-').trim().slice(0, 80) || 'page';
        const r = await dialog.showSaveDialog(win, {
            title: 'Save Page',
            defaultPath: path.join(BW_DOWNLOADS_DIR, title + '.html'),
            filters: [{ name: 'Web Page, Complete', extensions: ['html'] }]
        });
        if (r.canceled || !r.filePath) return;
        await contents.savePage(r.filePath, 'HTMLComplete');
        // Report it through the same channel as a real download so the saved
        // page gets a Downloads-bar card — and with it "Add to Vault", which
        // otherwise only ever existed for files that came down the wire.
        try {
            const host = contents.hostWebContents || contents;
            if (host && !host.isDestroyed()) {
                const id = 'dl' + Date.now() + Math.random().toString(36).slice(2, 6);
                const info = { id, filename: path.basename(r.filePath), path: r.filePath, url };
                let total = 0;
                try { total = fs.statSync(r.filePath).size; } catch (_) {}
                host.send('browser-download-started', { ...info, total });
                host.send('browser-download-done',    { ...info, state: 'completed' });
            }
        } catch (_) {}
    } catch (e) { console.error('[browser save]', e); }
}
// Host-side ⌘S (address bar / start panel focused) — renderer sends the
// active webview's webContents id.
ipcMain.on('browser-save-page', (e, wcId) => {
    try { const wc = webContents.fromId(wcId); if (wc && !wc.isDestroyed()) _bwSavePage(wc); } catch (_) {}
});

app.on('web-contents-created', (event, contents) => {
    if (contents.getType() !== 'webview') return;

    const _sweep = () => _bwSweepAllFrames(contents, false);
    contents.on('dom-ready', _sweep);
    contents.on('did-frame-finish-load', _sweep);
    // Episode switches re-navigate the player frames and re-inject the ad popup /
    // click-catcher. Sweep on every navigation, plus a few rapid follow-ups, so the
    // fresh ad is cleared within a few hundred ms instead of waiting for the 2.5s
    // tick (which is the "problem when changing episodes").
    const _burst = () => { _sweep(); [150, 400, 800, 1500].forEach(d => setTimeout(_sweep, d)); };
    contents.on('did-frame-navigate', _burst);
    contents.on('did-navigate-in-page', _burst);
    contents.on('did-start-navigation', _burst);

    const _sweepIv = setInterval(_sweep, 2500);
    contents.on('destroyed', () => clearInterval(_sweepIv));

    try { _setupBrowserSession(contents.session); } catch (_) {}

    // Keyboard shortcuts while the page itself has focus. The host renderer's
    // keydown listeners never fire once the <webview> owns focus, so the
    // standard browser chords are caught here. preventDefault also stops the
    // app-menu accelerators (⌘R / ⌘= / …) from acting on the whole app window
    // instead of just the page. ⌘W is left alone on purpose — the app menu's
    // Close Tab handles it globally.
    contents.on('before-input-event', (e, input) => {
        if (input.type !== 'keyDown' || input.isAutoRepeat) return;
        const mod = process.platform === 'darwin' ? input.meta : input.control;
        if (!mod || input.alt) return;
        const key = (input.key || '').toLowerCase();
        // Chords the host renderer owns (address bar, tabs, history) are
        // forwarded so they keep working while the page has focus.
        const fwd = () => {
            e.preventDefault();
            const host = contents.hostWebContents;
            try { if (host && !host.isDestroyed()) host.send('browser-shortcut', { key, shift: !!input.shift }); } catch (_) {}
        };
        try {
            if (key === 's' && !input.shift)      { e.preventDefault(); _bwSavePage(contents); }
            else if (key === 'p' && !input.shift) { e.preventDefault(); contents.print(); }
            else if (key === 'r')                 { e.preventDefault(); input.shift ? contents.reloadIgnoringCache() : contents.reload(); }
            else if (key === '=' || key === '+')  { e.preventDefault(); contents.setZoomLevel(Math.min(9, contents.getZoomLevel() + 0.5)); }
            else if (key === '-' && !input.shift) { e.preventDefault(); contents.setZoomLevel(Math.max(-8, contents.getZoomLevel() - 0.5)); }
            else if (key === '0' && !input.shift) { e.preventDefault(); contents.setZoomLevel(0); }
            else if (key === '[' && !input.shift) { e.preventDefault(); contents.navigationHistory ? contents.navigationHistory.goBack() : contents.goBack(); }
            else if (key === ']' && !input.shift) { e.preventDefault(); contents.navigationHistory ? contents.navigationHistory.goForward() : contents.goForward(); }
            else if (key === 'l' || key === 't' || key === 'y' || (key === 'n' && input.shift)) fwd();
        } catch (_) {}
    });

    // Right-click context menu for web pages (Save Image, Copy, Open Link,
    // Inspect, navigation, etc.). Electron ships no default menu for <webview>.
    contents.on('context-menu', (e, p) => {
        try {
            const items = [];
            const host = contents.hostWebContents;
            const canBack = () => { try { return contents.navigationHistory ? contents.navigationHistory.canGoBack() : contents.canGoBack(); } catch (_) { return false; } };
            const canFwd  = () => { try { return contents.navigationHistory ? contents.navigationHistory.canGoForward() : contents.canGoForward(); } catch (_) { return false; } };
            const goBack  = () => { try { contents.navigationHistory ? contents.navigationHistory.goBack() : contents.goBack(); } catch (_) {} };
            const goFwd   = () => { try { contents.navigationHistory ? contents.navigationHistory.goForward() : contents.goForward(); } catch (_) {} };

            if (p.mediaType === 'image' && p.srcURL) {
                items.push({ label: 'Save Image As…', click: () => { try { contents.downloadURL(p.srcURL); } catch (_) {} } });
                items.push({ label: 'Copy Image', click: () => { try { contents.copyImageAt(p.x, p.y); } catch (_) {} } });
                items.push({ label: 'Copy Image Address', click: () => clipboard.writeText(p.srcURL) });
                items.push({ type: 'separator' });
            }
            if ((p.mediaType === 'video' || p.mediaType === 'audio') && p.srcURL) {
                items.push({ label: 'Save Media As…', click: () => { try { contents.downloadURL(p.srcURL); } catch (_) {} } });
                items.push({ label: 'Copy Media Address', click: () => clipboard.writeText(p.srcURL) });
                items.push({ type: 'separator' });
            }
            if (p.linkURL) {
                items.push({ label: 'Open Link in New Tab', click: () => { try { if (host) host.send('browser-open-url', { url: p.linkURL, disposition: 'background-tab' }); } catch (_) {} } });
                items.push({ label: 'Copy Link', click: () => clipboard.writeText(p.linkURL) });
                items.push({ label: 'Save Link As…', click: () => { try { contents.downloadURL(p.linkURL); } catch (_) {} } });
                items.push({ type: 'separator' });
            }
            if (p.isEditable) {
                items.push({ role: 'undo', enabled: !!(p.editFlags && p.editFlags.canUndo) });
                items.push({ role: 'redo', enabled: !!(p.editFlags && p.editFlags.canRedo) });
                items.push({ type: 'separator' });
                items.push({ role: 'cut', enabled: !!(p.editFlags && p.editFlags.canCut) });
                items.push({ role: 'copy', enabled: !!(p.editFlags && p.editFlags.canCopy) });
                items.push({ role: 'paste', enabled: !!(p.editFlags && p.editFlags.canPaste) });
                items.push({ role: 'selectAll' });
                items.push({ type: 'separator' });
            } else if (p.selectionText && p.selectionText.trim()) {
                const sel = p.selectionText.trim();
                items.push({ role: 'copy' });
                const q = sel.length > 24 ? sel.slice(0, 24) + '…' : sel;
                items.push({ label: `Search the web for “${q}”`, click: () => { try { if (host) host.send('browser-open-url', 'https://www.google.com/search?q=' + encodeURIComponent(sel)); } catch (_) {} } });
                items.push({ type: 'separator' });
            }
            items.push({ label: 'Back', enabled: canBack(), click: goBack });
            items.push({ label: 'Forward', enabled: canFwd(), click: goFwd });
            items.push({ label: 'Reload', click: () => { try { contents.reload(); } catch (_) {} } });
            items.push({ type: 'separator' });
            items.push({ label: 'Inspect Element', click: () => { try { contents.inspectElement(p.x, p.y); } catch (_) {} } });

            Menu.buildFromTemplate(items).popup();
        } catch (_) {}
    });

    contents.on('will-prevent-unload', e => e.preventDefault());
    contents.setWindowOpenHandler((details) => {
        const url = details.url; const host = contents.hostWebContents;
        if (!host || !/^https?:/i.test(url)) return { action: 'deny' };

        if (adBlock.popupBlock) {
            const now = Date.now(); const rec = _popupTimes[contents.id] || (_popupTimes[contents.id] = []);
            while (rec.length && now - rec[0] > 1500) rec.shift();
            // Refuse the tab if the destination is spam/junk (known ad network, a
            // throwaway high-abuse TLD, or a random-looking pop-under host) or if this
            // is a pop-under FLOOD (3+ new windows within 1.5s). Opening a couple of
            // legit links in a row is normal browsing, so we don't block on count alone.
            if (_isSpamPopup(url) || rec.length >= 3) {
                adBlock.popupCount++;
                try { host.send('browser-popup-blocked', { url }); } catch (_) {}
                return { action: 'deny' };
            }
            rec.push(now);
        }
        host.send('browser-open-url', { url, disposition: details.disposition }); return { action: 'deny' };
    });

    contents.on('did-start-navigation', e => {
        if (!e.isMainFrame || !/^https?:/i.test(e.url)) return;
        try {
            if (contents._vulsorOrigUA === undefined) {
                contents._vulsorOrigUA = (contents.userAgent || '').replace(/\s*Vulsor\/\S+/ig, '').replace(/\s*Electron\/\S+/ig, '').replace(/\s{2,}/g, ' ').trim();
            }
            const wantFF = BW_AUTH_HOSTS.test(new URL(e.url).hostname);
            const ua = wantFF ? BW_FIREFOX_UA : contents._vulsorOrigUA;
            if (ua && contents.userAgent !== ua) contents.userAgent = ua;
        } catch (_) {}
    });
});

app.whenReady().then(async () => {
    // Widevine stays ahead of the window: the castlabs build wants its
    // components registered before content that plays protected media exists.
    if (components && typeof components.whenReady === 'function') {
        try { await components.whenReady(); console.log('[Widevine] ready:', components.status && components.status()); } catch (e) {}
    }

    // The window goes up next, before the rest of the startup chores. All of
    // them used to run first, which on a cold launch is dead time between
    // clicking the icon and seeing anything: none of it is needed to paint.
    createWindow();

    try { waBot.init(path.join(app.getPath('userData'), 'wa-session')); } catch (_) {}
    _adLoad(); _initAdblockEngine();
    // Browser sessions are configured before any <webview> can exist — the
    // renderer is still loading, and web tabs only appear once the user opens one.
    ['persist:browser', 'browser-private'].forEach(p => { try { _setupBrowserSession(session.fromPartition(p)); } catch (_) {} });
    buildMenu();

    // Ask to become the default browser at most once, then remember the answer,
    // so macOS stops showing the "change your default browser" dialog on every launch.
    try {
        const flagFile = path.join(app.getPath('userData'), 'default-browser.json');
        const alreadyDefault = app.isDefaultProtocolClient('http');
        let asked = false;
        try { asked = fs.existsSync(flagFile) && JSON.parse(fs.readFileSync(flagFile, 'utf8')).asked === true; } catch (_) {}
        if (!alreadyDefault && !asked) {
            app.setAsDefaultProtocolClient('http');
            app.setAsDefaultProtocolClient('https');
            try { fs.writeFileSync(flagFile, JSON.stringify({ asked: true })); } catch (_) {}
        }
    } catch (_) {}
    initAutoUpdate();

    // Let the other Vulsor apps drive this one. Loopback only, and a failure
    // here must never stop the browser from opening.
    controlServer.start()
        .then(port => console.log('[control] listening on 127.0.0.1:' + port))
        .catch(e => console.error('[control] not available:', e.message));

    const argvUrl = process.argv.find(a => /^https?:\/\//i.test(a)); if (argvUrl) _routeOpenUrl(argvUrl);
    process.argv.slice(1).filter(a => MD_FILE_RE.test(a)).forEach(_routeOpenFile);
    if (process.platform === 'darwin') { app.dock.setMenu(Menu.buildFromTemplate([ { label: 'New Window', click: () => createWindow() } ])); }
});

app.on('activate', () => {
    const open = BrowserWindow.getAllWindows();
    if (open.length === 0) { createWindow(); } 
    else { const win = open.find(w => w.isFocused()) || open[open.length - 1]; if (win.isMinimized()) win.restore(); win.focus(); }
});

app.on('window-all-closed', () => app.exit(0));
app.on('before-quit', () => { setTimeout(() => app.exit(0), 200); });
