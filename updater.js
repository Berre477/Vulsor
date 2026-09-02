// ══════════════════════════════════════════════════════════════
//  Silent auto-updater  (main process)
//
//  Each running copy of Vulsor periodically checks a version feed on
//  YOUR server. If a newer build exists for this platform, it is
//  downloaded, extracted, and staged. A small detached helper then
//  waits for the app to quit and swaps the install in place — so the
//  update is silently applied the next time the app is opened.
//
//  No code signing required; works on macOS, Windows and Linux.
//  Only runs in packaged builds (never during `npm start`).
//
//  ──────────────────────────────────────────────────────────────
//  SET YOUR UPDATE URL HERE  ▼  (points at a version.json you host)
//  You can also override it without rebuilding by creating a file
//  named  update-url.txt  in the app's userData folder, or by
//  setting the VULSOR_UPDATE_URL environment variable.
// ══════════════════════════════════════════════════════════════

const DEFAULT_FEED_URL = 'https://YOUR-SERVER-HERE.example.com/vulsor/version.json';

const { app } = require('electron');
const path  = require('path');
const fs    = require('fs');
const os    = require('os');
const http  = require('http');
const https = require('https');
const { spawn, spawnSync } = require('child_process');

const CHECK_DELAY_MS    = 8000;             // first check, after launch settles
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // then every 6 hours

let _checking = false;
let _stagedVersion = null;   // version we've already staged this session

// ── Logging ────────────────────────────────────────────────────
function _logFile() { try { return path.join(app.getPath('userData'), 'update.log'); } catch (_) { return path.join(os.tmpdir(), 'vulsor-update.log'); } }
function _log(...args) {
    const line = `[${new Date().toISOString()}] ${args.join(' ')}\n`;
    try { fs.appendFileSync(_logFile(), line); } catch (_) {}
}

// ── Feed URL resolution ────────────────────────────────────────
// Single source of truth: vulsor-config.json (shared with the relay).
function _readConfig() {
    const candidates = [
        path.join(os.homedir(), 'Documents', 'Vulsor_Memories', 'vulsor-config.json'), // in-app override (set from the Network tab)
        path.join(app.getPath('userData'), 'vulsor-config.json'),   // override, no rebuild needed
        path.join(app.getAppPath(), 'vulsor-config.json'),          // bundled in the build
        path.join(process.resourcesPath || '', 'app', 'vulsor-config.json'),
    ];
    for (const f of candidates) {
        try { if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) {}
    }
    return null;
}

function _feedUrl() {
    if (process.env.VULSOR_UPDATE_URL) return process.env.VULSOR_UPDATE_URL.trim();
    try {
        const f = path.join(app.getPath('userData'), 'update-url.txt');
        if (fs.existsSync(f)) { const u = fs.readFileSync(f, 'utf8').trim(); if (u) return u; }
    } catch (_) {}
    const c = _readConfig();
    if (c && c.serverHost && !String(c.serverHost).includes('CHANGE-ME')) {
        const proto = c.useHttps ? 'https' : 'http';
        return `${proto}://${c.serverHost}:${c.updatePort || 8479}/version.json`;
    }
    return DEFAULT_FEED_URL;
}

// ── Tiny HTTP(S) GET with redirect support ─────────────────────
function _get(url, { binary = false, redirects = 0 } = {}) {
    return new Promise((resolve, reject) => {
        if (redirects > 6) return reject(new Error('too many redirects'));
        const mod = url.startsWith('https') ? https : http;
        const req = mod.get(url, { headers: { 'User-Agent': 'Vulsor-Updater' } }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                res.resume();
                const next = new URL(res.headers.location, url).toString();
                return resolve(_get(next, { binary, redirects: redirects + 1 }));
            }
            if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => resolve(binary ? Buffer.concat(chunks) : Buffer.concat(chunks).toString('utf8')));
        });
        req.on('error', reject);
        req.setTimeout(60000, () => req.destroy(new Error('timeout')));
    });
}

// ── Download to a file (streamed, with redirects) ──────────────
function _download(url, dest, redirects = 0) {
    return new Promise((resolve, reject) => {
        if (redirects > 6) return reject(new Error('too many redirects'));
        const mod = url.startsWith('https') ? https : http;
        const req = mod.get(url, { headers: { 'User-Agent': 'Vulsor-Updater' } }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                res.resume();
                const next = new URL(res.headers.location, url).toString();
                return resolve(_download(next, dest, redirects + 1));
            }
            if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
            const out = fs.createWriteStream(dest);
            res.pipe(out);
            out.on('finish', () => out.close(resolve));
            out.on('error', reject);
        });
        req.on('error', reject);
        req.setTimeout(300000, () => req.destroy(new Error('timeout')));
    });
}

// ── Semver-ish compare: returns true if `remote` > `local` ─────
function _isNewer(remote, local) {
    const pa = String(remote).split('.').map(n => parseInt(n, 10) || 0);
    const pb = String(local).split('.').map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const a = pa[i] || 0, b = pb[i] || 0;
        if (a > b) return true;
        if (a < b) return false;
    }
    return false;
}

// ── Extract a .zip / .tar.gz into destDir (platform tools) ─────
function _extract(archive, destDir) {
    fs.mkdirSync(destDir, { recursive: true });
    const isTar = /\.t(ar\.)?gz$|\.tgz$/i.test(archive);
    let r;
    if (process.platform === 'darwin') {
        // ditto preserves .app symlinks/permissions; tar handles tarballs
        r = isTar ? spawnSync('tar', ['-xzf', archive, '-C', destDir])
                  : spawnSync('ditto', ['-x', '-k', archive, destDir]);
    } else if (process.platform === 'win32') {
        if (isTar) {
            r = spawnSync('tar', ['-xzf', archive, '-C', destDir]);   // bsdtar (Win10 1803+)
        } else {
            // tar.exe (bsdtar) handles .zip; fall back to PowerShell Expand-Archive
            r = spawnSync('tar', ['-xf', archive, '-C', destDir]);
            if (r.status !== 0) {
                r = spawnSync('powershell', ['-NoProfile', '-Command',
                    `Expand-Archive -LiteralPath '${archive}' -DestinationPath '${destDir}' -Force`]);
            }
        }
    } else { // linux
        if (isTar) r = spawnSync('tar', ['-xzf', archive, '-C', destDir]);
        else {
            r = spawnSync('unzip', ['-o', archive, '-d', destDir]);
            if (r.status !== 0) r = spawnSync('bsdtar', ['-xf', archive, '-C', destDir]);
        }
    }
    if (!r || r.status !== 0) throw new Error('extract failed: ' + (r && r.stderr ? r.stderr.toString() : 'unknown'));
}

// ── Find the new build root inside the extracted folder ────────
//  Adapts whether the archive contains the folder or its contents.
function _findNewBuild(dir) {
    if (process.platform === 'darwin') {
        // look for a *.app bundle (depth ≤ 2)
        const hit = _walkFind(dir, 2, (p) => p.endsWith('.app') && fs.statSync(p).isDirectory());
        return hit;
    }
    const exeName = process.platform === 'win32' ? 'Vulsor.exe' : 'Vulsor';
    const exe = _walkFind(dir, 3, (p) => path.basename(p) === exeName && fs.statSync(p).isFile());
    return exe ? path.dirname(exe) : null;
}
function _walkFind(dir, depth, match) {
    let entries;
    try { entries = fs.readdirSync(dir); } catch (_) { return null; }
    for (const name of entries) {
        const full = path.join(dir, name);
        let st; try { st = fs.statSync(full); } catch (_) { continue; }
        if (match(full)) return full;
        if (depth > 0 && st.isDirectory()) {
            const found = _walkFind(full, depth - 1, match);
            if (found) return found;
        }
    }
    return null;
}

// ── Where the currently-installed build lives ──────────────────
function _installTarget() {
    const exe = app.getPath('exe');
    if (process.platform === 'darwin') {
        // …/Vulsor.app/Contents/MacOS/Vulsor  ->  …/Vulsor.app
        return path.resolve(path.dirname(exe), '..', '..');
    }
    // win/linux: the folder that contains the executable
    return path.dirname(exe);
}

// ── Spawn the detached swap helper (waits for exit, then swaps) ─
function _scheduleSwap(stagedBuild, installTarget) {
    const tmp = path.join(os.tmpdir(), 'vulsor-update-' + Date.now());
    fs.mkdirSync(tmp, { recursive: true });
    const log = _logFile();
    const pid = process.pid;

    if (process.platform === 'win32') {
        const script = path.join(tmp, 'swap.cmd');
        const body =
`@echo off
:waitloop
tasklist /FI "PID eq ${pid}" 2>nul | find "${pid}" >nul
if not errorlevel 1 (
  timeout /t 1 /nobreak >nul
  goto waitloop
)
timeout /t 1 /nobreak >nul
robocopy "${stagedBuild}" "${installTarget}" /MIR /NFL /NDL /NJH /NJS /NC /NS >> "${log}" 2>&1
echo update applied >> "${log}"
`;
        fs.writeFileSync(script, body);
        const child = spawn('cmd.exe', ['/c', script], { detached: true, stdio: 'ignore', windowsHide: true });
        child.unref();
    } else {
        const script = path.join(tmp, 'swap.sh');
        const body =
`#!/bin/bash
PID="${pid}"
SRC="${stagedBuild}"
DEST="${installTarget}"
LOG="${log}"
for i in $(seq 1 1200); do
  kill -0 "$PID" 2>/dev/null || break
  sleep 0.5
done
sleep 1
BK="\${DEST}.old-$$"
if [ -e "$DEST" ]; then mv "$DEST" "$BK" || { echo "backup failed" >> "$LOG"; exit 1; }; fi
if mv "$SRC" "$DEST"; then
  rm -rf "$BK"
  echo "update applied" >> "$LOG"
else
  echo "swap failed, restoring" >> "$LOG"
  [ -e "$BK" ] && mv "$BK" "$DEST"
fi
`;
        fs.writeFileSync(script, body, { mode: 0o755 });
        const child = spawn('/bin/bash', [script], { detached: true, stdio: 'ignore' });
        child.unref();
    }
    _log('swap helper scheduled:', stagedBuild, '->', installTarget);
}

// ── One update check ───────────────────────────────────────────
async function _check() {
    if (_checking) return;
    _checking = true;
    try {
        const feed = _feedUrl();
        if (feed.includes('YOUR-SERVER-HERE')) { _log('skip: update URL not configured'); return; }

        const raw = await _get(feed);
        const manifest = JSON.parse(raw);
        const remoteVer = manifest.version;
        const localVer  = app.getVersion();
        if (!remoteVer) { _log('manifest missing version'); return; }
        if (!_isNewer(remoteVer, localVer)) { _log('up to date (' + localVer + ')'); return; }
        if (_stagedVersion === remoteVer) { _log('already staged ' + remoteVer); return; }

        const key = `${process.platform}-${process.arch}`;
        const url = manifest.platforms && manifest.platforms[key];
        if (!url) { _log('no build for ' + key); return; }
        _log(`update available: ${localVer} -> ${remoteVer} (${key})`);

        // Mark so we don't re-stage the same version across checks/restarts
        const marker = path.join(app.getPath('userData'), `staged-${remoteVer}.flag`);
        if (fs.existsSync(marker)) { _stagedVersion = remoteVer; _log('marker present, skip'); return; }

        // Download + extract into a staging area next to the install (same volume → fast atomic mv)
        const installTarget = _installTarget();
        const stageRoot = path.join(path.dirname(installTarget), '.vulsor-update');
        try { fs.rmSync(stageRoot, { recursive: true, force: true }); } catch (_) {}
        fs.mkdirSync(stageRoot, { recursive: true });

        const ext = url.split('?')[0].toLowerCase().endsWith('.tar.gz') || url.toLowerCase().endsWith('.tgz') ? '.tar.gz' : '.zip';
        const archive = path.join(stageRoot, 'download' + ext);
        _log('downloading', url);
        await _download(url, archive);

        const extractDir = path.join(stageRoot, 'x');
        _extract(archive, extractDir);
        const newBuild = _findNewBuild(extractDir);
        if (!newBuild) { _log('could not locate new build in archive'); return; }

        // Move the new build to a stable staged path, then schedule the swap
        const staged = path.join(stageRoot, path.basename(installTarget));
        try { fs.rmSync(staged, { recursive: true, force: true }); } catch (_) {}
        fs.renameSync(newBuild, staged);

        fs.writeFileSync(marker, remoteVer);
        _stagedVersion = remoteVer;
        _scheduleSwap(staged, installTarget);
        _log('staged ' + remoteVer + '; will apply on next quit');
    } catch (e) {
        _log('check failed: ' + (e && e.message ? e.message : e));
    } finally {
        _checking = false;
    }
}

// ── Public entry ───────────────────────────────────────────────
function initAutoUpdate() {
    if (!app.isPackaged) { _log('dev run — auto-update disabled'); return; }
    setTimeout(_check, CHECK_DELAY_MS);
    setInterval(_check, CHECK_INTERVAL_MS);
}

module.exports = { initAutoUpdate };
