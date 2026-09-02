// ══════════════════════════════════════════════════════════════
//  Vulsor relay server  (run on the Ubuntu box)
//
//  Hosts PUBLIC, password-protected servers that anyone running
//  Vulsor can reach over the internet. All chat + file traffic is
//  relayed through here over persistent TCP connections, so it
//  works even when participants are behind home routers/NAT.
//
//  Protocol: newline-delimited JSON, one object per line.
//  File bytes are carried base64-encoded inside the JSON.
//
//  Pure Node — no dependencies.  Default port 8480.
//  Pair with vulsor-relay.service so it stays up / starts on boot.
// ══════════════════════════════════════════════════════════════

const net    = require('net');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const PORT      = parseInt(process.env.RELAY_PORT || '8480', 10);
const DATA_DIR  = path.resolve(process.env.RELAY_DIR || path.join(__dirname, 'relay-data'));
const FILES_DIR = path.join(DATA_DIR, 'files');
const DB_FILE   = path.join(DATA_DIR, 'servers.json');
const MAX_MSGS  = 500;                       // keep last N messages per server
const MAX_FILE  = 100 * 1024 * 1024;         // 100 MB upload cap

fs.mkdirSync(FILES_DIR, { recursive: true });

// ── State ──────────────────────────────────────────────────────
let servers = {};                 // id -> { id, name, salt, hash, ownerId, createdTs, messages: [] }
const members    = {};            // id -> Set<socket> currently joined
const allSockets = new Set();     // every connected socket (for list pushes)

function load() { try { if (fs.existsSync(DB_FILE)) servers = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch (e) { console.error('load', e); } }
let _saveTimer = null;
function save() {
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => { try { fs.writeFileSync(DB_FILE, JSON.stringify(servers)); } catch (e) { console.error('save', e); } }, 200);
}
load();

// ── Helpers ────────────────────────────────────────────────────
function hashPw(pw, salt) { return crypto.createHash('sha256').update(salt + ':' + pw).digest('hex'); }
function rid(prefix) { return prefix + crypto.randomBytes(8).toString('hex'); }
function send(sock, obj) { try { sock.write(JSON.stringify(obj) + '\n'); } catch (_) {} }
function memberCount(id) { return members[id] ? members[id].size : 0; }
function broadcast(id, obj, exclude) { const set = members[id]; if (!set) return; for (const s of set) if (s !== exclude) send(s, obj); }
function publicList() { return Object.values(servers).map(s => ({ id: s.id, name: s.name, hasPassword: !!s.hash, members: memberCount(s.id) })); }
function pushListToAll() { const list = publicList(); for (const s of allSockets) send(s, { t: 'list', servers: list }); }

function joinSock(sock, id, token) {
    if (!members[id]) members[id] = new Set();
    members[id].add(sock);
    sock._joined.add(id);
    sock._tokens[id] = token;
}
function leaveSock(sock, id) {
    if (members[id]) { members[id].delete(sock); broadcast(id, { t: 'members', id, members: memberCount(id) }); }
    sock._joined.delete(id);
    delete sock._tokens[id];
}

// ── Per-message handling ───────────────────────────────────────
function handle(sock, m) {
    switch (m.t) {
        case 'hello':
            sock._deviceId = m.from || null;
            send(sock, { t: 'hello', ok: true });
            break;

        case 'list':
            send(sock, { t: 'list', servers: publicList() });
            break;

        case 'create': {
            const name = (m.name || '').trim();
            if (!name)        return send(sock, { t: 'error', code: 'noname', msg: 'Name required' });
            if (!m.password)  return send(sock, { t: 'error', code: 'nopass', msg: 'Password required' });
            const id = rid('ps-');
            const salt = crypto.randomBytes(8).toString('hex');
            servers[id] = { id, name, salt, hash: hashPw(m.password, salt), ownerId: m.from || null, createdTs: Date.now(), messages: [] };
            save();
            const token = rid('tk-');
            joinSock(sock, id, token);
            send(sock, { t: 'created', id, token, name });
            pushListToAll();
            break;
        }

        case 'join': {
            const s = servers[m.id];
            if (!s) return send(sock, { t: 'error', code: 'nosrv', msg: 'Server not found', ref: m.id });
            if (s.hash && hashPw(m.password || '', s.salt) !== s.hash)
                return send(sock, { t: 'error', code: 'badpass', msg: 'Wrong password', ref: m.id });
            const token = rid('tk-');
            joinSock(sock, m.id, token);
            send(sock, { t: 'joined', id: m.id, token, name: s.name, owner: s.ownerId === (m.from || null), messages: s.messages.slice(-MAX_MSGS) });
            broadcast(m.id, { t: 'members', id: m.id, members: memberCount(m.id) });
            break;
        }

        case 'leave':
            leaveSock(sock, m.id);
            break;

        case 'post': {
            const s = servers[m.id];
            if (!s || sock._tokens[m.id] !== m.token) return;
            const e = { kind: 'msg', from: m.from, fromName: m.fromName, text: String(m.text || '').slice(0, 5000), ts: Date.now() };
            s.messages.push(e);
            if (s.messages.length > MAX_MSGS) s.messages = s.messages.slice(-MAX_MSGS);
            save();
            broadcast(m.id, { t: 'msg', id: m.id, entry: e });
            break;
        }

        case 'upload': {
            const s = servers[m.id];
            if (!s || sock._tokens[m.id] !== m.token) return;
            let buf; try { buf = Buffer.from(m.dataB64 || '', 'base64'); } catch (_) { return; }
            if (buf.length > MAX_FILE) return send(sock, { t: 'error', code: 'toobig', msg: 'File too large (max 50MB)' });
            const fileId = rid('f-');
            const safe = (m.name || 'file').replace(/[/\\]/g, '_');
            const dir = path.join(FILES_DIR, m.id);
            fs.mkdirSync(dir, { recursive: true });
            try { fs.writeFileSync(path.join(dir, fileId + '_' + safe), buf); } catch (_) { return; }
            const e = { kind: 'file', from: m.from, fromName: m.fromName, name: m.name, size: buf.length, fileId, ts: Date.now() };
            s.messages.push(e);
            if (s.messages.length > MAX_MSGS) s.messages = s.messages.slice(-MAX_MSGS);
            save();
            broadcast(m.id, { t: 'msg', id: m.id, entry: e });
            break;
        }

        case 'download': {
            const s = servers[m.id];
            if (!s || sock._tokens[m.id] !== m.token) return;
            const e = s.messages.find(x => x.fileId === m.fileId);
            if (!e) return send(sock, { t: 'error', code: 'nofile', msg: 'File gone' });
            const safe = (e.name || 'file').replace(/[/\\]/g, '_');
            const fp = path.join(FILES_DIR, m.id, m.fileId + '_' + safe);
            let buf; try { buf = fs.readFileSync(fp); } catch (_) { return send(sock, { t: 'error', code: 'nofile', msg: 'File gone' }); }
            send(sock, { t: 'file', id: m.id, fileId: m.fileId, name: e.name, dataB64: buf.toString('base64') });
            break;
        }

        // ── Persistent file storage (separate from chat) ──────
        case 'store-list': {
            const s = servers[m.id];
            if (!s || sock._tokens[m.id] !== m.token) return;
            send(sock, { t: 'store', id: m.id, files: s.store || [] });
            break;
        }
        case 'store-upload': {
            const s = servers[m.id];
            if (!s || sock._tokens[m.id] !== m.token) return;
            let buf; try { buf = Buffer.from(m.dataB64 || '', 'base64'); } catch (_) { return; }
            if (buf.length > MAX_FILE) return send(sock, { t: 'error', code: 'toobig', msg: 'File too large (max 100MB)' });
            const fileId = rid('s-');
            const safe = (m.name || 'file').replace(/[/\\]/g, '_');
            const dir = path.join(FILES_DIR, m.id, 'store');
            fs.mkdirSync(dir, { recursive: true });
            try { fs.writeFileSync(path.join(dir, fileId + '_' + safe), buf); } catch (_) { return; }
            if (!s.store) s.store = [];
            const e = { fileId, name: m.name, size: buf.length, from: m.from, fromName: m.fromName, ts: Date.now() };
            s.store.push(e);
            save();
            broadcast(m.id, { t: 'store-add', id: m.id, entry: e });
            break;
        }
        case 'store-download': {
            const s = servers[m.id];
            if (!s || sock._tokens[m.id] !== m.token) return;
            const e = (s.store || []).find(x => x.fileId === m.fileId);
            if (!e) return send(sock, { t: 'error', code: 'nofile', msg: 'File gone' });
            const safe = (e.name || 'file').replace(/[/\\]/g, '_');
            let buf; try { buf = fs.readFileSync(path.join(FILES_DIR, m.id, 'store', m.fileId + '_' + safe)); }
            catch (_) { return send(sock, { t: 'error', code: 'nofile', msg: 'File gone' }); }
            send(sock, { t: 'store-file', id: m.id, fileId: m.fileId, name: e.name, dataB64: buf.toString('base64') });
            break;
        }
        case 'store-delete': {
            const s = servers[m.id];
            if (!s || sock._tokens[m.id] !== m.token) return;
            const e = (s.store || []).find(x => x.fileId === m.fileId);
            if (!e) return;
            if (e.from !== (m.from || null) && s.ownerId !== (m.from || null))
                return send(sock, { t: 'error', code: 'notowner', msg: 'Only the uploader or owner can delete' });
            const safe = (e.name || 'file').replace(/[/\\]/g, '_');
            try { fs.rmSync(path.join(FILES_DIR, m.id, 'store', m.fileId + '_' + safe), { force: true }); } catch (_) {}
            s.store = s.store.filter(x => x.fileId !== m.fileId);
            save();
            broadcast(m.id, { t: 'store-del', id: m.id, fileId: m.fileId });
            break;
        }

        case 'delete': {
            const s = servers[m.id];
            if (!s) return;
            if (s.ownerId && s.ownerId !== (m.from || null))
                return send(sock, { t: 'error', code: 'notowner', msg: 'Only the creator can delete this server' });
            delete servers[m.id];
            save();
            try { fs.rmSync(path.join(FILES_DIR, m.id), { recursive: true, force: true }); } catch (_) {}
            broadcast(m.id, { t: 'deleted', id: m.id });
            if (members[m.id]) { for (const so of members[m.id]) { so._joined.delete(m.id); delete so._tokens[m.id]; } delete members[m.id]; }
            pushListToAll();
            break;
        }
    }
}

// ── Server ─────────────────────────────────────────────────────
const server = net.createServer((sock) => {
    sock.setNoDelay(true);
    sock._buf = '';
    sock._joined = new Set();
    sock._tokens = {};
    sock._deviceId = null;
    allSockets.add(sock);

    sock.on('data', (chunk) => {
        sock._buf += chunk.toString('utf8');
        let idx;
        while ((idx = sock._buf.indexOf('\n')) >= 0) {
            const line = sock._buf.slice(0, idx);
            sock._buf = sock._buf.slice(idx + 1);
            if (!line.trim()) continue;
            let m; try { m = JSON.parse(line); } catch (_) { continue; }
            try { handle(sock, m); } catch (e) { console.error('handle', e); }
        }
    });
    sock.on('error', () => {});
    sock.on('close', () => {
        allSockets.delete(sock);
        for (const id of sock._joined) {
            if (members[id]) { members[id].delete(sock); broadcast(id, { t: 'members', id, members: memberCount(id) }); }
        }
    });
});

server.on('error', (e) => console.error('relay error', e));
server.listen(PORT, '0.0.0.0', () => console.log(`Vulsor relay on 0.0.0.0:${PORT}  data: ${DATA_DIR}`));
