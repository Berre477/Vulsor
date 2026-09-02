// ── Vulsor Browser — control server ─────────────────────────────────────
// A loopback-only HTTP endpoint so the other Vulsor apps — Vulsor Mind in
// particular — can drive this one: open a page, read what is on screen, jump
// to an app, or tell it that data on disk changed underneath it.
//
// Same shape as Vulsor Play's: bind a random port on 127.0.0.1 and publish it
// in the shared data folder, because the port has to be discoverable.

const http = require('http');
const path = require('path');
const fs   = require('fs');
const os   = require('os');
const { ipcMain, BrowserWindow } = require('electron');

const DATA_DIR  = path.join(os.homedir(), 'Documents', 'Vulsor_Memories');
const PORT_FILE = path.join(DATA_DIR, 'vulsorbrowser-port.json');

// The renderer owns the tabs, the vault and the task list, so every request
// round-trips through it.
function targetWindow() {
    const focused = BrowserWindow.getFocusedWindow();
    if (focused && !focused.isDestroyed()) return focused;
    return BrowserWindow.getAllWindows().find(w => !w.isDestroyed()) || null;
}

let _rpcId = 0;
function askRenderer(action, payload) {
    return new Promise(resolve => {
        const win = targetWindow();
        if (!win) return resolve({ ok: false, error: 'Vulsor Browser has no open window' });
        const id = ++_rpcId;
        const timer = setTimeout(() => {
            ipcMain.removeAllListeners(`control-reply-${id}`);
            resolve({ ok: false, error: 'the window did not answer' });
        }, 20000);
        ipcMain.once(`control-reply-${id}`, (_e, result) => {
            clearTimeout(timer);
            resolve(result);
        });
        win.webContents.send('control', { id, action, payload });
    });
}

function readBody(req) {
    return new Promise(resolve => {
        let b = '';
        req.on('data', c => { b += c; if (b.length > 4e6) req.destroy(); });
        req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch (_) { resolve({}); } });
    });
}

function start() {
    return new Promise((resolve, reject) => {
        const server = http.createServer(async (req, res) => {
            const url = (req.url || '/').split('?')[0];
            if (!url.startsWith('/api/')) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ ok: false, error: 'not found' }));
            }
            // Bring the window to the front on request, without a round-trip.
            const action = decodeURIComponent(url.slice(5));
            if (action === 'focus') {
                const win = targetWindow();
                if (win) { win.show(); win.focus(); }
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ ok: !!win }));
            }
            const payload = req.method === 'POST' ? await readBody(req) : {};
            const result = await askRenderer(action, payload);
            res.writeHead(result && result.ok === false ? 400 : 200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));
        });

        server.on('error', reject);
        // 127.0.0.1 only: nothing on the network can reach this.
        server.listen(0, '127.0.0.1', () => {
            const port = server.address().port;
            try {
                if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
                fs.writeFileSync(PORT_FILE,
                    JSON.stringify({ port, pid: process.pid, startedAt: Date.now() }), 'utf8');
            } catch (e) { console.error('[control] could not publish port:', e.message); }
            resolve(port);
        });
    });
}

module.exports = { start, askRenderer, PORT_FILE };
