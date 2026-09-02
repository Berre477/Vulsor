// ══════════════════════════════════════════════════════════════
//  Embedded relay  (main process)
//
//  Lets THIS computer host public, password-protected servers
//  without any separate server machine. Same protocol as
//  server/relay-server.js. Toggled on/off from the Network tab.
//  Data persists in userData/relay-data.
// ══════════════════════════════════════════════════════════════

const net    = require('net');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const MAX_MSGS = 500;
const MAX_FILE = 100 * 1024 * 1024;

let _server   = null;
let _port     = 8480;
let _dataDir  = null;
let _filesDir = null;
let _dbFile   = null;
let _servers  = {};
const _members    = {};
const _allSockets = new Set();
let _saveTimer = null;

function _load() { try { if (fs.existsSync(_dbFile)) _servers = JSON.parse(fs.readFileSync(_dbFile, 'utf8')); } catch (_) {} }
function _save() { clearTimeout(_saveTimer); _saveTimer = setTimeout(() => { try { fs.writeFileSync(_dbFile, JSON.stringify(_servers)); } catch (_) {} }, 200); }

function _hashPw(pw, salt) { return crypto.createHash('sha256').update(salt + ':' + pw).digest('hex'); }
function _rid(p) { return p + crypto.randomBytes(8).toString('hex'); }
function _send(sock, obj) { try { sock.write(JSON.stringify(obj) + '\n'); } catch (_) {} }
function _count(id) { return _members[id] ? _members[id].size : 0; }
function _broadcast(id, obj, ex) { const s = _members[id]; if (!s) return; for (const so of s) if (so !== ex) _send(so, obj); }
function _list() { return Object.values(_servers).map(s => ({ id: s.id, name: s.name, hasPassword: !!s.hash, members: _count(s.id) })); }
function _pushList() { const l = _list(); for (const s of _allSockets) _send(s, { t: 'list', servers: l }); }
function _join(sock, id, token) { if (!_members[id]) _members[id] = new Set(); _members[id].add(sock); sock._joined.add(id); sock._tokens[id] = token; }
function _leave(sock, id) { if (_members[id]) { _members[id].delete(sock); _broadcast(id, { t: 'members', id, members: _count(id) }); } sock._joined.delete(id); delete sock._tokens[id]; }

function _handle(sock, m) {
    switch (m.t) {
        case 'hello': sock._deviceId = m.from || null; _send(sock, { t: 'hello', ok: true }); break;
        case 'list': _send(sock, { t: 'list', servers: _list() }); break;
        case 'create': {
            const name = (m.name || '').trim();
            if (!name) return _send(sock, { t: 'error', code: 'noname', msg: 'Name required' });
            if (!m.password) return _send(sock, { t: 'error', code: 'nopass', msg: 'Password required' });
            const id = _rid('ps-'); const salt = crypto.randomBytes(8).toString('hex');
            _servers[id] = { id, name, salt, hash: _hashPw(m.password, salt), ownerId: m.from || null, createdTs: Date.now(), messages: [], store: [] };
            _save();
            const token = _rid('tk-'); _join(sock, id, token);
            _send(sock, { t: 'created', id, token, name }); _pushList(); break;
        }
        case 'join': {
            const s = _servers[m.id]; if (!s) return _send(sock, { t: 'error', code: 'nosrv', msg: 'Server not found', ref: m.id });
            if (s.hash && _hashPw(m.password || '', s.salt) !== s.hash) return _send(sock, { t: 'error', code: 'badpass', msg: 'Wrong password', ref: m.id });
            const token = _rid('tk-'); _join(sock, m.id, token);
            _send(sock, { t: 'joined', id: m.id, token, name: s.name, owner: s.ownerId === (m.from || null), messages: s.messages.slice(-MAX_MSGS) });
            _broadcast(m.id, { t: 'members', id: m.id, members: _count(m.id) }); break;
        }
        case 'leave': _leave(sock, m.id); break;
        case 'post': {
            const s = _servers[m.id]; if (!s || sock._tokens[m.id] !== m.token) return;
            const e = { kind: 'msg', from: m.from, fromName: m.fromName, text: String(m.text || '').slice(0, 5000), ts: Date.now() };
            s.messages.push(e); if (s.messages.length > MAX_MSGS) s.messages = s.messages.slice(-MAX_MSGS);
            _save(); _broadcast(m.id, { t: 'msg', id: m.id, entry: e }); break;
        }
        case 'upload': {
            const s = _servers[m.id]; if (!s || sock._tokens[m.id] !== m.token) return;
            let buf; try { buf = Buffer.from(m.dataB64 || '', 'base64'); } catch (_) { return; }
            if (buf.length > MAX_FILE) return _send(sock, { t: 'error', code: 'toobig', msg: 'File too large (max 100MB)' });
            const fileId = _rid('f-'); const safe = (m.name || 'file').replace(/[/\\]/g, '_');
            const dir = path.join(_filesDir, m.id); fs.mkdirSync(dir, { recursive: true });
            try { fs.writeFileSync(path.join(dir, fileId + '_' + safe), buf); } catch (_) { return; }
            const e = { kind: 'file', from: m.from, fromName: m.fromName, name: m.name, size: buf.length, fileId, ts: Date.now() };
            s.messages.push(e); if (s.messages.length > MAX_MSGS) s.messages = s.messages.slice(-MAX_MSGS);
            _save(); _broadcast(m.id, { t: 'msg', id: m.id, entry: e }); break;
        }
        case 'download': {
            const s = _servers[m.id]; if (!s || sock._tokens[m.id] !== m.token) return;
            const e = s.messages.find(x => x.fileId === m.fileId); if (!e) return _send(sock, { t: 'error', code: 'nofile', msg: 'File gone' });
            const safe = (e.name || 'file').replace(/[/\\]/g, '_');
            let buf; try { buf = fs.readFileSync(path.join(_filesDir, m.id, m.fileId + '_' + safe)); } catch (_) { return _send(sock, { t: 'error', code: 'nofile', msg: 'File gone' }); }
            _send(sock, { t: 'file', id: m.id, fileId: m.fileId, name: e.name, dataB64: buf.toString('base64') }); break;
        }
        case 'store-list': {
            const s = _servers[m.id]; if (!s || sock._tokens[m.id] !== m.token) return;
            _send(sock, { t: 'store', id: m.id, files: s.store || [] }); break;
        }
        case 'store-upload': {
            const s = _servers[m.id]; if (!s || sock._tokens[m.id] !== m.token) return;
            let buf; try { buf = Buffer.from(m.dataB64 || '', 'base64'); } catch (_) { return; }
            if (buf.length > MAX_FILE) return _send(sock, { t: 'error', code: 'toobig', msg: 'File too large (max 100MB)' });
            const fileId = _rid('s-'); const safe = (m.name || 'file').replace(/[/\\]/g, '_');
            const dir = path.join(_filesDir, m.id, 'store'); fs.mkdirSync(dir, { recursive: true });
            try { fs.writeFileSync(path.join(dir, fileId + '_' + safe), buf); } catch (_) { return; }
            if (!s.store) s.store = [];
            const e = { fileId, name: m.name, size: buf.length, from: m.from, fromName: m.fromName, ts: Date.now() };
            s.store.push(e); _save(); _broadcast(m.id, { t: 'store-add', id: m.id, entry: e }); break;
        }
        case 'store-download': {
            const s = _servers[m.id]; if (!s || sock._tokens[m.id] !== m.token) return;
            const e = (s.store || []).find(x => x.fileId === m.fileId); if (!e) return _send(sock, { t: 'error', code: 'nofile', msg: 'File gone' });
            const safe = (e.name || 'file').replace(/[/\\]/g, '_');
            let buf; try { buf = fs.readFileSync(path.join(_filesDir, m.id, 'store', m.fileId + '_' + safe)); } catch (_) { return _send(sock, { t: 'error', code: 'nofile', msg: 'File gone' }); }
            _send(sock, { t: 'store-file', id: m.id, fileId: m.fileId, name: e.name, dataB64: buf.toString('base64') }); break;
        }
        case 'store-delete': {
            const s = _servers[m.id]; if (!s || sock._tokens[m.id] !== m.token) return;
            const e = (s.store || []).find(x => x.fileId === m.fileId); if (!e) return;
            if (e.from !== (m.from || null) && s.ownerId !== (m.from || null)) return _send(sock, { t: 'error', code: 'notowner', msg: 'Only the uploader or owner can delete' });
            const safe = (e.name || 'file').replace(/[/\\]/g, '_');
            try { fs.rmSync(path.join(_filesDir, m.id, 'store', m.fileId + '_' + safe), { force: true }); } catch (_) {}
            s.store = s.store.filter(x => x.fileId !== m.fileId); _save();
            _broadcast(m.id, { t: 'store-del', id: m.id, fileId: m.fileId }); break;
        }
        case 'delete': {
            const s = _servers[m.id]; if (!s) return;
            if (s.ownerId && s.ownerId !== (m.from || null)) return _send(sock, { t: 'error', code: 'notowner', msg: 'Only the creator can delete this server' });
            delete _servers[m.id]; _save();
            try { fs.rmSync(path.join(_filesDir, m.id), { recursive: true, force: true }); } catch (_) {}
            _broadcast(m.id, { t: 'deleted', id: m.id });
            if (_members[m.id]) { for (const so of _members[m.id]) { so._joined.delete(m.id); delete so._tokens[m.id]; } delete _members[m.id]; }
            _pushList(); break;
        }
    }
}

function startRelay({ port, dataDir } = {}) {
    return new Promise((resolve) => {
        if (_server) return resolve({ running: true, port: _port });
        _port = port || 8480;
        _dataDir = dataDir;
        _filesDir = path.join(_dataDir, 'files');
        _dbFile = path.join(_dataDir, 'servers.json');
        try { fs.mkdirSync(_filesDir, { recursive: true }); } catch (_) {}
        _load();

        _server = net.createServer((sock) => {
            sock.setNoDelay(true);
            sock._buf = ''; sock._joined = new Set(); sock._tokens = {}; sock._deviceId = null;
            _allSockets.add(sock);
            sock.on('data', (chunk) => {
                sock._buf += chunk.toString('utf8');
                let idx;
                while ((idx = sock._buf.indexOf('\n')) >= 0) {
                    const line = sock._buf.slice(0, idx); sock._buf = sock._buf.slice(idx + 1);
                    if (!line.trim()) continue;
                    let m; try { m = JSON.parse(line); } catch (_) { continue; }
                    try { _handle(sock, m); } catch (_) {}
                }
            });
            sock.on('error', () => {});
            sock.on('close', () => {
                _allSockets.delete(sock);
                for (const id of sock._joined) if (_members[id]) { _members[id].delete(sock); _broadcast(id, { t: 'members', id, members: _count(id) }); }
            });
        });
        _server.on('error', (e) => { _server = null; resolve({ running: false, error: e.code === 'EADDRINUSE' ? 'Port ' + _port + ' is already in use' : String(e.message || e) }); });
        _server.listen(_port, '0.0.0.0', () => resolve({ running: true, port: _port }));
    });
}

function stopRelay() {
    return new Promise((resolve) => {
        if (!_server) return resolve({ running: false });
        for (const s of _allSockets) { try { s.destroy(); } catch (_) {} }
        _allSockets.clear();
        _server.close(() => { _server = null; resolve({ running: false }); });
    });
}

function relayStatus() { return { running: !!_server, port: _port }; }

module.exports = { startRelay, stopRelay, relayStatus };
