// ══════════════════════════════════════════════════════════════
//  Network — LAN peer-to-peer messaging & file sharing
//  Discovers other Vulsor devices on the local network via UDP
//  broadcast, then exchanges chat messages and files over TCP.
//  Uses Node built-ins only (dgram, net) — no extra dependencies.
// ══════════════════════════════════════════════════════════════

const dgram = require('dgram');
const net   = require('net');
// Electron 32+ removed File.path — resolve the real path via webUtils.
const { webUtils: _netWebUtils } = require('electron');
function _netFilePath(f) {
    try { return _netWebUtils.getPathForFile(f); } catch (_) { return f.path || ''; }
}

const NET_DISCOVERY_PORT = 41848;          // shared UDP broadcast port
const NET_BEACON_MS      = 3000;           // how often we announce ourselves
const NET_PEER_TIMEOUT   = 12000;          // drop a peer unseen for this long
const NET_PROTO_V        = 1;

// ── Public servers (relay) ─────────────────────────────────────
// Address is read from vulsor-config.json (single source of truth,
// shared with the auto-updater). Edit serverHost there.
let HUB_HOST       = null;     // resolved at init from vulsor-config.json
let HUB_PORT       = 8480;
let HUB_TLS        = false;
const HUB_MAX_FILE   = 100 * 1024 * 1024;  // 100 MB upload cap (matches relay)
const HUB_RECONNECT_MS = 4000;

// Load the shared server config. Checks an easy-to-edit override in
// the Vulsor_Memories folder first, then the bundled config.
function _netLoadServerConfig() {
    const candidates = [
        path.join(DOCUMENTS_PATH, 'vulsor-config.json'),                 // user override (no rebuild needed)
        (typeof __dirname !== 'undefined') ? path.join(__dirname, 'vulsor-config.json') : null,
        (typeof __dirname !== 'undefined') ? path.join(__dirname, '..', 'vulsor-config.json') : null,
        process.resourcesPath ? path.join(process.resourcesPath, 'app.asar', 'vulsor-config.json') : null,
        process.resourcesPath ? path.join(process.resourcesPath, 'app', 'vulsor-config.json') : null,
    ].filter(Boolean);
    for (const f of candidates) {
        try {
            if (fs.existsSync(f)) {
                const c = JSON.parse(fs.readFileSync(f, 'utf8'));
                if (c.serverHost && !String(c.serverHost).includes('CHANGE-ME')) {
                    HUB_HOST = c.serverHost;
                    HUB_PORT = c.relayPort || 8480;
                    HUB_TLS  = !!c.useHttps;
                    return;
                }
            }
        } catch (_) {}
    }
}

// ── State ──────────────────────────────────────────────────────
let netConfig     = null;   // { deviceId, deviceName, deviceType }
let netPeers      = {};     // id -> { id, name, type, address, tcpPort, lastSeen }
let netConvos     = {};     // peerId -> [ { dir:'in'|'out', kind:'msg'|'file', text?, name?, size?, path?, ts } ]
let netActivePeer = null;   // currently selected peer id (or null)
let netUdp        = null;   // dgram socket
let netServer     = null;   // net.Server
let netTcpPort    = 0;      // our actual listening TCP port
let netBeaconTimer = null;
let netPruneTimer  = null;
let netStarted     = false;

// Servers (shared hubs)
let netServers      = {};    // servers I host: id -> { id, name, hostId, messages: [] }
let netActiveServer = null;  // { id, hostId } currently open, or null
let netServerPoll   = null;  // poll interval while viewing a remote server
let netRemoteCache  = {};    // serverId -> { name, messages, gone? } fetched from host

// Public servers (via the Ubuntu relay)
let netHubSock      = null;  // persistent TCP socket to the relay
let netHubConnected = false;
let netHubBuf       = '';    // newline-framing buffer for incoming relay data
let netHubReconnect = null;  // reconnect timer
let netHubList      = [];    // [{ id, name, hasPassword, members }] from relay
let netHubTokens    = {};    // serverId -> session token (after join)
let netHubMsgs      = {};    // serverId -> [ message entries ]
let netHubNames     = {};    // serverId -> name
let netHubOwner     = {};    // serverId -> bool (am I the creator)
let netActiveHub    = null;  // serverId of the public server currently open, or null
let netHubPending    = null;  // serverId we're trying to join (awaiting password result)
let netHubStore     = {};    // serverId -> [ stored file entries ]  (persistent storage)
let netHubMode      = {};    // serverId -> 'chat' | 'files'

// ── Persistence ────────────────────────────────────────────────
function _netLoad() {
    try {
        if (fs.existsSync(NETWORK_FILE)) {
            const raw = readJsonStrict(NETWORK_FILE);
            netConfig  = raw.config  || null;
            netConvos  = raw.convos  || {};
            netServers = raw.servers || {};
        }
    } catch (_) {}
    if (!netConfig) {
        netConfig = {
            deviceId:   'dev-' + Math.random().toString(36).slice(2) + Date.now().toString(36),
            deviceName: os.hostname().replace(/\.local$/, ''),
            deviceType: 'computer',   // 'computer' | 'server'
        };
        _netSave();
    }
}

function _netSave() {
    try {
        writeJsonSafe(NETWORK_FILE, { config: netConfig, convos: netConvos, servers: netServers });
    } catch (e) { console.error('network save failed', e); }
}

// ── Discovery (UDP broadcast) ──────────────────────────────────
function _netStartDiscovery() {
    netUdp = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    netUdp.on('error', (err) => { console.error('udp error', err); try { netUdp.close(); } catch(_){} });

    netUdp.on('message', (buf, rinfo) => {
        let msg;
        try { msg = JSON.parse(buf.toString()); } catch (_) { return; }
        if (!msg || msg.v !== NET_PROTO_V) return;
        if (msg.id === netConfig.deviceId) return;   // ignore our own beacons

        if (msg.kind === 'beacon') {
            const existing = netPeers[msg.id];
            netPeers[msg.id] = {
                id: msg.id, name: msg.name || 'Unknown', type: msg.type || 'computer',
                address: rinfo.address, tcpPort: msg.tcpPort, lastSeen: Date.now(),
                servers: msg.servers || [],
            };
            _netRenderPeers();
            // A peer's hosted-server list can change, so refresh that too
            if (!existing || JSON.stringify(existing.servers) !== JSON.stringify(msg.servers || [])) _netRenderServers();
        } else if (msg.kind === 'bye') {
            if (netPeers[msg.id]) { delete netPeers[msg.id]; _netRenderPeers(); }
        }
    });

    netUdp.bind(NET_DISCOVERY_PORT, () => {
        try { netUdp.setBroadcast(true); } catch (_) {}
        _netBroadcast('beacon');
    });

    netBeaconTimer = setInterval(() => _netBroadcast('beacon'), NET_BEACON_MS);
    netPruneTimer  = setInterval(_netPrune, NET_BEACON_MS);
}

function _netBroadcast(kind) {
    if (!netUdp) return;
    const payload = Buffer.from(JSON.stringify({
        v: NET_PROTO_V, kind, id: netConfig.deviceId,
        name: netConfig.deviceName, type: netConfig.deviceType, tcpPort: netTcpPort,
        servers: Object.values(netServers).map(s => ({ id: s.id, name: s.name })),
    }));
    try { netUdp.send(payload, 0, payload.length, NET_DISCOVERY_PORT, '255.255.255.255'); } catch (_) {}
}

function _netPrune() {
    const now = Date.now();
    let changed = false;
    for (const id in netPeers) {
        if (now - netPeers[id].lastSeen > NET_PEER_TIMEOUT) { delete netPeers[id]; changed = true; }
    }
    if (changed) { _netRenderPeers(); _netRenderServers(); }
}

// ── TCP server (receive messages + files) ──────────────────────
function _netStartServer() {
    netServer = net.createServer((sock) => {
        let header = null;
        let headerBuf = Buffer.alloc(0);
        let payloadChunks = [];
        let payloadLen = 0;

        // kinds that carry a binary payload after the JSON header
        const PAYLOAD_KINDS = { file: 1, 'srv-upload': 1 };

        sock.on('data', (chunk) => {
            if (!header) {
                headerBuf = Buffer.concat([headerBuf, chunk]);
                const nl = headerBuf.indexOf(0x0a);   // '\n'
                if (nl === -1) return;
                try { header = JSON.parse(headerBuf.slice(0, nl).toString()); }
                catch (_) { sock.destroy(); return; }
                const rest = headerBuf.slice(nl + 1);
                if (!PAYLOAD_KINDS[header.kind]) { _netHandleNoPayload(header, sock); return; }
                if (rest.length) { payloadChunks.push(rest); payloadLen += rest.length; }
            } else {
                payloadChunks.push(chunk); payloadLen += chunk.length;
            }
            if (header && PAYLOAD_KINDS[header.kind] && payloadLen >= header.size) {
                _netHandlePayload(header, Buffer.concat(payloadChunks));
                sock.end();
            }
        });
        sock.on('error', () => {});
    });

    netServer.on('error', (e) => console.error('tcp server error', e));
    netServer.listen(0, () => { netTcpPort = netServer.address().port; });
}

function _netOnMessage(h) {
    _netPushConvo(h.from, { dir: 'in', kind: 'msg', text: h.text, ts: h.ts || Date.now(), fromName: h.fromName });
}

function _netOnFile(h, buf) {
    try {
        // sanitize filename + avoid collisions
        let safe = (h.name || 'file').replace(/[/\\]/g, '_');
        let dest = path.join(NETWORK_DIR, safe);
        let n = 1;
        while (fs.existsSync(dest)) {
            const ext = path.extname(safe); const base = path.basename(safe, ext);
            dest = path.join(NETWORK_DIR, `${base} (${n})${ext}`); n++;
        }
        fs.writeFileSync(dest, buf);
        _netPushConvo(h.from, { dir: 'in', kind: 'file', name: path.basename(dest), size: buf.length, path: dest, ts: h.ts || Date.now(), fromName: h.fromName });
    } catch (e) { console.error('file receive failed', e); }
}

// Dispatch an incoming connection by message kind
function _netHandleNoPayload(h, sock) {
    switch (h.kind) {
        case 'msg':      _netOnMessage(h); sock.end(); break;
        case 'srv-post': _netSrvOnPost(h);  sock.end(); break;
        case 'srv-fetch': {
            const s = netServers[h.serverId];
            const resp = s ? { name: s.name, messages: s.messages } : { error: 'gone' };
            sock.end(JSON.stringify(resp));
            break;
        }
        case 'srv-download': {
            const fp = _netSrvFilePath(h.serverId, h.fileId);
            if (fp && fs.existsSync(fp)) sock.end(fs.readFileSync(fp));
            else sock.end();
            break;
        }
        default: sock.end();
    }
}

function _netHandlePayload(h, buf) {
    if (h.kind === 'file') _netOnFile(h, buf);
    else if (h.kind === 'srv-upload') _netSrvOnUpload(h, buf);
}

function _netPushConvo(peerId, entry) {
    if (!netConvos[peerId]) netConvos[peerId] = [];
    netConvos[peerId].push(entry);
    _netSave();
    if (peerId === netActivePeer) _netRenderConvo();
    _netRenderPeers();   // refresh unread/last-msg
    // Notify if not the active peer / not on network view
    if (entry.dir === 'in') _netNotify(peerId, entry);
}

function _netNotify(peerId, entry) {
    const peer = netPeers[peerId];
    const who = (peer && peer.name) || entry.fromName || 'A device';
    const onView = document.getElementById('view-network')?.classList.contains('active');
    if (onView && peerId === netActivePeer) return;
    const txt = entry.kind === 'file' ? `sent a file: ${entry.name}` : entry.text;
    try { new Notification(`${who}`, { body: txt }); } catch (_) {}
}

// ── Sending ────────────────────────────────────────────────────
function _netSendTo(peer, header, payloadBuf) {
    return new Promise((resolve, reject) => {
        const sock = net.connect(peer.tcpPort, peer.address, () => {
            sock.write(JSON.stringify(header) + '\n');
            if (payloadBuf && payloadBuf.length) sock.write(payloadBuf);
            sock.end();
        });
        sock.on('error', reject);
        sock.on('close', resolve);
    });
}

// Like _netSendTo, but collects the host's response bytes (for fetch/download)
function _netRequest(peer, header, payloadBuf) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let done = false;
        const finish = () => { if (!done) { done = true; resolve(Buffer.concat(chunks)); } };
        const sock = net.connect(peer.tcpPort, peer.address, () => {
            sock.write(JSON.stringify(header) + '\n');
            if (payloadBuf && payloadBuf.length) sock.write(payloadBuf);
        });
        sock.on('data', (c) => chunks.push(c));
        sock.on('end', finish);
        sock.on('close', finish);
        sock.on('error', (e) => { if (!done) { done = true; reject(e); } });
    });
}

async function netSendMessage() {
    const input = document.getElementById('net-msg-input');
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;
    if (netActiveHub)    { input.value = ''; netPostToHub(text); return; }
    if (netActiveServer) { input.value = ''; netPostToServer(text); return; }
    if (!netActivePeer) return;
    const peer = netPeers[netActivePeer];
    if (!peer) { _netToast('Device is offline'); return; }
    const ts = Date.now();
    try {
        await _netSendTo(peer, { v: NET_PROTO_V, kind: 'msg', from: netConfig.deviceId, fromName: netConfig.deviceName, text, ts });
        input.value = '';
        _netPushConvo(netActivePeer, { dir: 'out', kind: 'msg', text, ts });
    } catch (e) { _netToast('Could not reach device'); }
}

async function netSendFile() {
    if (!netActiveHub && !netActiveServer && !netActivePeer) return;
    const peer = netActivePeer ? netPeers[netActivePeer] : null;
    if (!netActiveHub && !netActiveServer && !peer) { _netToast('Device is offline'); return; }
    const picker = document.getElementById('net-file-input');
    picker.value = '';
    picker.onchange = async () => {
        const f = picker.files[0];
        if (!f) return;
        if (netActiveHub)    { netUploadToHub(f); return; }
        if (netActiveServer) { netUploadToServer(f); return; }
        try {
            const fpath = _netFilePath(f);
            const buf = fs.readFileSync(fpath);
            const ts = Date.now();
            await _netSendTo(peer, { v: NET_PROTO_V, kind: 'file', from: netConfig.deviceId, fromName: netConfig.deviceName, name: f.name, size: buf.length, ts }, buf);
            _netPushConvo(netActivePeer, { dir: 'out', kind: 'file', name: f.name, size: buf.length, path: fpath, ts });
        } catch (e) { _netToast('Could not send file'); }
    };
    picker.click();
}

// ── Servers (shared hubs) ──────────────────────────────────────
function _netServerDir(id) {
    const d = path.join(NETWORK_DIR, 'servers', id);
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
    return d;
}
function _netSrvFilePath(serverId, fileId) {
    const s = netServers[serverId];
    const e = s && s.messages.find(m => m.fileId === fileId);
    return e && e.path;
}

// Host side: someone posted a message / uploaded a file to a server we host
function _netSrvOnPost(h) {
    const s = netServers[h.serverId]; if (!s) return;
    s.messages.push({ kind: 'msg', fromId: h.from, fromName: h.fromName, text: h.text, ts: h.ts || Date.now() });
    _netSave();
    if (netActiveServer && netActiveServer.id === h.serverId) _netRenderServerView();
}
function _netSrvOnUpload(h, buf) {
    const s = netServers[h.serverId]; if (!s) return;
    const fileId = 'f-' + Math.random().toString(36).slice(2);
    const safe = (h.name || 'file').replace(/[/\\]/g, '_');
    const dest = path.join(_netServerDir(h.serverId), fileId + '_' + safe);
    try { fs.writeFileSync(dest, buf); } catch (_) { return; }
    s.messages.push({ kind: 'file', fromId: h.from, fromName: h.fromName, name: h.name, size: buf.length, fileId, path: dest, ts: h.ts || Date.now() });
    _netSave();
    if (netActiveServer && netActiveServer.id === h.serverId) _netRenderServerView();
}

function netCreateServer() {
    const inp = document.getElementById('net-new-server');
    const name = (inp && inp.value || '').trim();
    if (!name) return;
    const id = 'srv-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    netServers[id] = { id, name, hostId: netConfig.deviceId, messages: [] };
    _netServerDir(id);
    _netSave();
    if (inp) inp.value = '';
    _netBroadcast('beacon');            // announce the new server immediately
    _netRenderServers();
    netOpenServer(id, netConfig.deviceId);
}

function netDeleteServer(id) {
    if (!netServers[id]) return;
    delete netServers[id];
    try { fs.rmSync(path.join(NETWORK_DIR, 'servers', id), { recursive: true, force: true }); } catch (_) {}
    _netSave();
    _netBroadcast('beacon');
    if (netActiveServer && netActiveServer.id === id) { netActiveServer = null; _netStopServerPoll(); }
    _netRenderServers();
    _netRenderRight();
}

function netLeaveServer() {
    netActiveServer = null;
    _netStopServerPoll();
    _netRenderServers();
    _netRenderConvo();
}

// All servers visible to me: ones I host + ones advertised by peers
function _netAllServers() {
    const out = [];
    for (const s of Object.values(netServers)) {
        out.push({ id: s.id, name: s.name, hostId: netConfig.deviceId, hostName: netConfig.deviceName, mine: true });
    }
    for (const p of Object.values(netPeers)) {
        (p.servers || []).forEach(s => out.push({ id: s.id, name: s.name, hostId: p.id, hostName: p.name, mine: false }));
    }
    return out;
}

function netOpenServer(id, hostId) {
    netActiveServer = { id, hostId };
    netActivePeer = null;
    netActiveHub = null;
    _netRenderServers();
    _netRenderPeers();
    _netRenderServerView();
    if (hostId !== netConfig.deviceId) { _netFetchServer(); _netStartServerPoll(); }
    else _netStopServerPoll();
}

function _netStartServerPoll() {
    _netStopServerPoll();
    netServerPoll = setInterval(() => {
        if (netActiveServer && netActiveServer.hostId !== netConfig.deviceId) _netFetchServer();
    }, 2000);
}
function _netStopServerPoll() { if (netServerPoll) { clearInterval(netServerPoll); netServerPoll = null; } }

async function _netFetchServer() {
    const a = netActiveServer; if (!a) return;
    const host = netPeers[a.hostId];
    if (!host) { _netRenderServerView(); return; }   // host offline
    try {
        const buf = await _netRequest(host, { v: NET_PROTO_V, kind: 'srv-fetch', serverId: a.id, from: netConfig.deviceId });
        const resp = JSON.parse(buf.toString() || '{}');
        netRemoteCache[a.id] = resp.error
            ? { name: a.id, messages: [], gone: true }
            : { name: resp.name, messages: resp.messages || [] };
        if (netActiveServer && netActiveServer.id === a.id) _netRenderServerView();
    } catch (_) { /* unreachable; keep last cache */ }
}

async function netPostToServer(text) {
    const a = netActiveServer; if (!a) return;
    const ts = Date.now();
    if (a.hostId === netConfig.deviceId) {
        netServers[a.id].messages.push({ kind: 'msg', fromId: netConfig.deviceId, fromName: netConfig.deviceName, text, ts });
        _netSave(); _netRenderServerView();
    } else {
        const host = netPeers[a.hostId];
        if (!host) { _netToast('Server host is offline'); return; }
        try {
            await _netSendTo(host, { v: NET_PROTO_V, kind: 'srv-post', serverId: a.id, from: netConfig.deviceId, fromName: netConfig.deviceName, text, ts });
            _netFetchServer();
        } catch (_) { _netToast('Could not reach server'); }
    }
}

async function netUploadToServer(f) {
    const a = netActiveServer; if (!a) return;
    let buf; try { buf = fs.readFileSync(_netFilePath(f)); } catch (_) { _netToast('Could not read file'); return; }
    const ts = Date.now();
    if (a.hostId === netConfig.deviceId) {
        _netSrvOnUpload({ serverId: a.id, from: netConfig.deviceId, fromName: netConfig.deviceName, name: f.name, ts }, buf);
    } else {
        const host = netPeers[a.hostId];
        if (!host) { _netToast('Server host is offline'); return; }
        try {
            await _netSendTo(host, { v: NET_PROTO_V, kind: 'srv-upload', serverId: a.id, from: netConfig.deviceId, fromName: netConfig.deviceName, name: f.name, size: buf.length, ts }, buf);
            _netFetchServer();
        } catch (_) { _netToast('Could not send file'); }
    }
}

async function netDownloadServerFile(fileId, name) {
    const a = netActiveServer; if (!a) return;
    if (a.hostId === netConfig.deviceId) {
        const fp = _netSrvFilePath(a.id, fileId);
        if (fp) netOpenFile(fp); else _netToast('File unavailable');
        return;
    }
    const host = netPeers[a.hostId];
    if (!host) { _netToast('Server host is offline'); return; }
    try {
        const buf = await _netRequest(host, { v: NET_PROTO_V, kind: 'srv-download', serverId: a.id, fileId, from: netConfig.deviceId });
        if (!buf.length) { _netToast('File unavailable'); return; }
        let safe = (name || 'file').replace(/[/\\]/g, '_');
        let dest = path.join(NETWORK_DIR, safe); let n = 1;
        while (fs.existsSync(dest)) {
            const ext = path.extname(safe); const base = path.basename(safe, ext);
            dest = path.join(NETWORK_DIR, `${base} (${n})${ext}`); n++;
        }
        fs.writeFileSync(dest, buf);
        netOpenFile(dest);
    } catch (_) { _netToast('Download failed'); }
}

// ── Public servers (relay client) ──────────────────────────────
function _netHubConfigured() { return (netConfig && netConfig.hostPublic) || !!HUB_HOST; }
function _netHubTarget() { return (netConfig && netConfig.hostPublic) ? '127.0.0.1' : HUB_HOST; }

function _netHubConnect() {
    if (!_netHubConfigured() || netHubSock) return;
    try {
        netHubSock = net.connect(HUB_PORT, _netHubTarget(), () => {
            netHubConnected = true;
            netHubBuf = '';
            _netHubSend({ t: 'hello', from: netConfig.deviceId });
            _netHubSend({ t: 'list' });
            // rejoin the open server after a reconnect
            if (netActiveHub) _netHubSend({ t: 'join', id: netActiveHub, password: '', from: netConfig.deviceId, fromName: netConfig.deviceName });
            _netRenderHubServers();
        });
        netHubSock.on('data', (chunk) => {
            netHubBuf += chunk.toString('utf8');
            let idx;
            while ((idx = netHubBuf.indexOf('\n')) >= 0) {
                const line = netHubBuf.slice(0, idx);
                netHubBuf = netHubBuf.slice(idx + 1);
                if (!line.trim()) continue;
                let m; try { m = JSON.parse(line); } catch (_) { continue; }
                _netHubDispatch(m);
            }
        });
        netHubSock.on('close', () => { netHubConnected = false; netHubSock = null; _netHubScheduleReconnect(); _netRenderHubServers(); });
        netHubSock.on('error', () => {});
    } catch (_) { netHubSock = null; _netHubScheduleReconnect(); }
}

function _netHubScheduleReconnect() {
    if (netHubReconnect || !_netHubConfigured()) return;
    netHubReconnect = setTimeout(() => { netHubReconnect = null; _netHubConnect(); }, HUB_RECONNECT_MS);
}

function _netHubSend(obj) {
    if (netHubSock && netHubConnected) { try { netHubSock.write(JSON.stringify(obj) + '\n'); return true; } catch (_) {} }
    return false;
}

function _netHubDispatch(m) {
    switch (m.t) {
        case 'list':
            netHubList = m.servers || [];
            _netRenderHubServers();
            break;
        case 'created':
            netHubTokens[m.id] = m.token;
            netHubNames[m.id] = m.name;
            netHubOwner[m.id] = true;
            netHubMsgs[m.id] = [];
            netOpenHub(m.id);
            _netToast('Public server created');
            break;
        case 'joined':
            netHubTokens[m.id] = m.token;
            netHubNames[m.id] = m.name;
            netHubOwner[m.id] = !!m.owner;
            netHubMsgs[m.id] = m.messages || [];
            netHubPending = null;
            netOpenHub(m.id);
            break;
        case 'msg':
            if (!netHubMsgs[m.id]) netHubMsgs[m.id] = [];
            netHubMsgs[m.id].push(m.entry);
            if (netActiveHub === m.id) _netRenderHubView();
            if (m.entry && m.entry.from !== netConfig.deviceId) _netNotifyHub(m.id, m.entry);
            break;
        case 'members':
            { const s = netHubList.find(x => x.id === m.id); if (s) { s.members = m.members; _netRenderHubServers(); } }
            break;
        case 'file':
            _netHubSaveDownload(m);
            break;
        case 'store':
            netHubStore[m.id] = m.files || [];
            if (netActiveHub === m.id && netHubMode[m.id] === 'files') _netRenderHubView();
            break;
        case 'store-add':
            if (!netHubStore[m.id]) netHubStore[m.id] = [];
            netHubStore[m.id].push(m.entry);
            if (netActiveHub === m.id && netHubMode[m.id] === 'files') _netRenderHubView();
            break;
        case 'store-del':
            if (netHubStore[m.id]) netHubStore[m.id] = netHubStore[m.id].filter(x => x.fileId !== m.fileId);
            if (netActiveHub === m.id && netHubMode[m.id] === 'files') _netRenderHubView();
            break;
        case 'store-file':
            _netHubSaveDownload(m);
            break;
        case 'deleted':
            delete netHubTokens[m.id]; delete netHubMsgs[m.id]; delete netHubNames[m.id]; delete netHubOwner[m.id];
            netHubList = netHubList.filter(x => x.id !== m.id);
            if (netActiveHub === m.id) { netActiveHub = null; _netRenderConvo(); }
            _netRenderHubServers();
            _netToast('Public server was deleted');
            break;
        case 'error':
            netHubPending = null;
            _netToast(m.msg || 'Server error');
            break;
    }
}

function _netNotifyHub(id, entry) {
    const onView = document.getElementById('view-network')?.classList.contains('active');
    if (onView && netActiveHub === id) return;
    const who = entry.fromName || 'Someone';
    const txt = entry.kind === 'file' ? `sent a file: ${entry.name}` : entry.text;
    try { new Notification(`${netHubNames[id] || 'Public server'} · ${who}`, { body: txt }); } catch (_) {}
}

function netOpenHub(id) {
    netActiveHub = id;
    netActivePeer = null;
    netActiveServer = null;
    _netStopServerPoll();
    if (!netHubTokens[id]) {
        // not joined yet → need to join (password handled by caller)
        _netHubSend({ t: 'join', id, password: '', from: netConfig.deviceId, fromName: netConfig.deviceName });
    }
    if (!netHubMode[id]) netHubMode[id] = 'chat';
    if (netHubTokens[id]) _netHubSend({ t: 'store-list', id, token: netHubTokens[id] });   // preload storage
    _netRenderHubServers();
    _netRenderServers();
    _netRenderPeers();
    _netRenderHubView();
}

// Click a public server in the list → join (prompting for password if needed)
function netJoinHub(id) {
    if (netHubTokens[id]) { netOpenHub(id); return; }   // already joined this session
    const s = netHubList.find(x => x.id === id);
    if (s && s.hasPassword) { _netOpenJoinModal(id, s.name); return; }
    netHubPending = id;
    _netHubSend({ t: 'join', id, password: '', from: netConfig.deviceId, fromName: netConfig.deviceName });
}

function netSubmitJoin(id, password) {
    netHubPending = id;
    _netHubSend({ t: 'join', id, password: password || '', from: netConfig.deviceId, fromName: netConfig.deviceName });
}

function netCreateHubServer(name, password) {
    if (!_netHubConfigured()) { _netToast('Public servers are not configured yet'); return; }
    if (!netHubConnected) { _netToast('Not connected to the server'); return; }
    _netHubSend({ t: 'create', name, password, from: netConfig.deviceId, fromName: netConfig.deviceName });
}

function netDeleteHubServer(id) {
    _netHubSend({ t: 'delete', id, from: netConfig.deviceId });
}

function netLeaveHub() {
    netActiveHub = null;
    _netRenderHubServers();
    _netRenderConvo();
}

async function netPostToHub(text) {
    const id = netActiveHub; if (!id) return;
    if (!_netHubSend({ t: 'post', id, token: netHubTokens[id], text, from: netConfig.deviceId, fromName: netConfig.deviceName }))
        _netToast('Not connected');
}

function netUploadToHub(f) {
    const id = netActiveHub; if (!id) return;
    let buf; try { buf = fs.readFileSync(_netFilePath(f)); } catch (_) { _netToast('Could not read file'); return; }
    if (buf.length > HUB_MAX_FILE) { _netToast('File too large (max 50MB)'); return; }
    if (!_netHubSend({ t: 'upload', id, token: netHubTokens[id], name: f.name, size: buf.length, dataB64: buf.toString('base64'), from: netConfig.deviceId, fromName: netConfig.deviceName }))
        _netToast('Not connected');
}

function netDownloadHubFile(fileId, name) {
    const id = netActiveHub; if (!id) return;
    _netHubSend({ t: 'download', id, token: netHubTokens[id], fileId });
}

function _netHubSaveDownload(m) {
    try {
        const buf = Buffer.from(m.dataB64 || '', 'base64');
        let safe = (m.name || 'file').replace(/[/\\]/g, '_');
        let dest = path.join(NETWORK_DIR, safe); let n = 1;
        while (fs.existsSync(dest)) {
            const ext = path.extname(safe); const base = path.basename(safe, ext);
            dest = path.join(NETWORK_DIR, `${base} (${n})${ext}`); n++;
        }
        fs.writeFileSync(dest, buf);
        netOpenFile(dest);
    } catch (_) { _netToast('Download failed'); }
}

// ── Public-server storage (a persistent file drop) ─────────────
function netHubSetMode(mode) {
    const id = netActiveHub; if (!id) return;
    netHubMode[id] = mode;
    if (mode === 'files' && netHubTokens[id]) _netHubSend({ t: 'store-list', id, token: netHubTokens[id] });
    _netRenderHubView();
}

function netHubStoreUpload() {
    const id = netActiveHub; if (!id) return;
    const picker = document.getElementById('net-file-input');
    picker.value = '';
    picker.onchange = () => {
        const f = picker.files[0];
        if (!f) return;
        let buf; try { buf = fs.readFileSync(_netFilePath(f)); } catch (_) { _netToast('Could not read file'); return; }
        if (buf.length > HUB_MAX_FILE) { _netToast('File too large (max 100MB)'); return; }
        if (!_netHubSend({ t: 'store-upload', id, token: netHubTokens[id], name: f.name, size: buf.length, dataB64: buf.toString('base64'), from: netConfig.deviceId, fromName: netConfig.deviceName }))
            _netToast('Not connected');
    };
    picker.click();
}

function netHubStoreDownload(fileId) {
    const id = netActiveHub; if (!id) return;
    _netHubSend({ t: 'store-download', id, token: netHubTokens[id], fileId });
}

function netHubStoreDelete(fileId) {
    const id = netActiveHub; if (!id) return;
    _netHubSend({ t: 'store-delete', id, token: netHubTokens[id], fileId, from: netConfig.deviceId });
}

// ── Rendering ──────────────────────────────────────────────────
function _netIcon(type) { return type === 'server' ? 'fa-server' : 'fa-desktop'; }

function _netFmtSize(n) {
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
    return (n / 1073741824).toFixed(2) + ' GB';
}

function _netRenderPeers() {
    const list = document.getElementById('net-peers');
    if (!list) return;
    const peers = Object.values(netPeers).sort((a, b) => a.name.localeCompare(b.name));
    if (!peers.length) {
        list.innerHTML = `<div class="text-center text-slate-600 text-xs py-8 px-3">
            <i class="fas fa-satellite-dish text-2xl mb-2 block opacity-40"></i>
            No devices found yet.<br>Open Vulsor on another computer on the same network.
        </div>`;
        return;
    }
    list.innerHTML = peers.map(p => {
        const convo = netConvos[p.id] || [];
        const last  = convo[convo.length - 1];
        const lastTxt = last ? (last.kind === 'file' ? '📎 ' + last.name : last.text) : '';
        const active = p.id === netActivePeer ? 'background:rgba(34,211,238,0.12); border-color:rgba(34,211,238,0.4)' : '';
        return `<div class="net-peer" onclick="netSelectPeer('${p.id}')"
            style="display:flex; align-items:center; gap:10px; padding:10px 12px; border-radius:12px; cursor:pointer; border:1px solid transparent; ${active}">
            <div style="position:relative; width:36px; height:36px; border-radius:10px; background:rgba(34,211,238,0.12); display:flex; align-items:center; justify-content:center; flex-shrink:0">
                <i class="fas ${_netIcon(p.type)}" style="color:rgb(var(--tw-cyan-400)); font-size:15px"></i>
                <span style="position:absolute; bottom:-2px; right:-2px; width:10px; height:10px; border-radius:50%; background:rgb(var(--tw-green-500)); border:2px solid rgb(var(--slate-900))"></span>
            </div>
            <div style="min-width:0; flex:1">
                <div class="text-slate-100 text-sm font-medium truncate">${_netEsc(p.name)}</div>
                <div class="text-slate-500 text-xs truncate">${lastTxt ? _netEsc(lastTxt) : p.address}</div>
            </div>
        </div>`;
    }).join('');
}

function netSelectPeer(id) {
    netActivePeer = id;
    netActiveServer = null;
    netActiveHub = null;
    _netStopServerPoll();
    _netRenderServers();
    _netRenderHubServers();
    _netRenderPeers();
    _netRenderConvo();
}

function _netRenderRight() {
    if (netActiveHub) _netRenderHubView();
    else if (netActiveServer) _netRenderServerView();
    else _netRenderConvo();
}

function _netRenderHubServers() {
    const list = document.getElementById('net-hub-servers');
    const status = document.getElementById('net-hub-status');
    if (status) {
        if (!_netHubConfigured()) status.textContent = 'not configured';
        else status.textContent = netHubConnected ? 'online' : 'connecting…';
        status.style.color = netHubConnected ? '#22c55e' : '#64748b';
    }
    if (!list) return;
    if (!_netHubConfigured()) {
        list.innerHTML = `<div class="text-slate-600 text-xs px-3 py-2">Public servers aren’t set up yet.</div>`;
        return;
    }
    if (!netHubList.length) {
        list.innerHTML = `<div class="text-slate-600 text-xs px-3 py-2">${netHubConnected ? 'No public servers yet — create one below.' : 'Connecting to the server…'}</div>`;
        return;
    }
    list.innerHTML = netHubList.slice().sort((a, b) => a.name.localeCompare(b.name)).map(s => {
        const active = netActiveHub === s.id ? 'background:rgba(34,211,238,0.12); border-color:rgba(34,211,238,0.4)' : '';
        const lock = s.hasPassword ? '<i class="fas fa-lock" style="font-size:9px; opacity:.7; margin-left:5px"></i>' : '';
        return `<div onclick="netJoinHub('${s.id}')"
            style="display:flex; align-items:center; gap:10px; padding:9px 12px; border-radius:12px; cursor:pointer; border:1px solid transparent; ${active}">
            <div style="width:34px; height:34px; border-radius:10px; background:rgba(34,211,238,0.12); display:flex; align-items:center; justify-content:center; flex-shrink:0">
                <i class="fas fa-globe" style="color:rgb(var(--tw-cyan-400)); font-size:14px"></i>
            </div>
            <div style="min-width:0; flex:1">
                <div class="text-slate-100 text-sm font-medium truncate">${_netEsc(s.name)}${lock}</div>
                <div class="text-slate-500 text-xs truncate">${s.members || 0} online</div>
            </div>
        </div>`;
    }).join('');
}

function _netRenderHubView() {
    const pane = document.getElementById('net-convo');
    const head = document.getElementById('net-convo-head');
    const composer = document.getElementById('net-composer');
    if (!pane) return;
    const id = netActiveHub; if (!id) return;
    const name = netHubNames[id] || 'Public server';
    const owner = !!netHubOwner[id];

    const mode = netHubMode[id] || 'chat';
    const tabBtn = (mm, label, icon) => `<button onclick="netHubSetMode('${mm}')" class="text-xs px-2.5 py-1 rounded-lg transition-colors ${mode === mm ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'}"><i class="fas ${icon} mr-1"></i>${label}</button>`;
    head.innerHTML = `<div style="display:flex; align-items:center; gap:10px; width:100%">
        <i class="fas fa-globe" style="color:rgb(var(--tw-cyan-400))"></i>
        <div style="flex:1; min-width:0">
            <div class="text-slate-100 text-sm font-semibold truncate">${_netEsc(name)}</div>
            <div class="text-xs ${netHubConnected ? 'text-green-400' : 'text-slate-500'}">${netHubConnected ? 'public · connected' : 'reconnecting…'}</div>
        </div>
        <div style="display:flex; gap:4px; background:rgb(var(--slate-900) / .6); padding:3px; border-radius:10px">${tabBtn('chat', 'Chat', 'fa-comments')}${tabBtn('files', 'Files', 'fa-folder')}</div>
        ${owner
            ? `<button onclick="netDeleteHubServer('${id}')" class="text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded-lg hover:bg-slate-800 transition-colors"><i class="fas fa-trash mr-1"></i>Delete</button>`
            : `<button onclick="netLeaveHub()" class="text-xs text-slate-400 hover:text-white px-2 py-1 rounded-lg hover:bg-slate-800 transition-colors">Leave</button>`}
    </div>`;
    composer.style.display = (mode === 'files') ? 'none' : '';
    if (mode === 'files') { _netRenderHubFiles(id); return; }

    const msgs = netHubMsgs[id] || [];
    if (!msgs.length) {
        pane.innerHTML = `<div style="height:100%; display:flex; align-items:center; justify-content:center; color:rgb(var(--slate-600))" class="text-sm">No messages yet — say hi to everyone</div>`;
        return;
    }
    pane.innerHTML = msgs.map(e => {
        const mine = e.from === netConfig.deviceId;
        const align = mine ? 'flex-end' : 'flex-start';
        const bg = mine ? 'background:rgb(var(--tw-cyan-700)); color:rgb(var(--tw-cyan-50))' : 'background:rgb(var(--slate-800)); color:rgb(var(--slate-200))';
        let body;
        if (e.kind === 'file') {
            body = `<div onclick="netDownloadHubFile('${e.fileId}','${_netAttr(e.name)}')" style="display:flex; align-items:center; gap:10px; cursor:pointer">
                <i class="fas fa-file" style="font-size:18px; opacity:.9"></i>
                <div style="min-width:0">
                    <div class="truncate" style="font-weight:600; max-width:220px">${_netEsc(e.name)}</div>
                    <div style="font-size:11px; opacity:.7">${_netFmtSize(e.size)} · click to download</div>
                </div>
            </div>`;
        } else {
            body = _netEsc(e.text).replace(/\n/g, '<br>');
        }
        const t = new Date(e.ts);
        const time = t.getHours().toString().padStart(2, '0') + ':' + t.getMinutes().toString().padStart(2, '0');
        const sender = mine ? '' : `<div style="font-size:10px; font-weight:600; opacity:.8; margin-bottom:2px">${_netEsc(e.fromName || '?')}</div>`;
        return `<div style="display:flex; justify-content:${align}; margin-bottom:8px">
            <div style="${bg}; padding:8px 12px; border-radius:14px; max-width:75%; word-break:break-word; font-size:13px; line-height:1.4">
                ${sender}${body}
                <div style="font-size:10px; opacity:.55; margin-top:3px; text-align:right">${time}</div>
            </div>
        </div>`;
    }).join('');
    pane.scrollTop = pane.scrollHeight;
}

function _netRenderHubFiles(id) {
    const pane = document.getElementById('net-convo');
    if (!pane) return;
    const files = netHubStore[id] || [];
    const header = `<div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:14px">
        <div class="text-slate-400 text-xs">${files.length} file${files.length === 1 ? '' : 's'} stored on the server</div>
        <button onclick="netHubStoreUpload()" class="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold transition-colors">
            <i class="fas fa-upload"></i> Upload
        </button>
    </div>`;
    if (!files.length) {
        pane.innerHTML = header + `<div style="height:70%; display:flex; flex-direction:column; align-items:center; justify-content:center; color:rgb(var(--slate-600))">
            <i class="fas fa-folder-open text-4xl mb-3 opacity-30"></i>
            <p class="text-sm">No files yet — upload PDFs, images, anything.<br>They stay on the server for everyone here.</p>
        </div>`;
        return;
    }
    const rows = files.slice().sort((a, b) => b.ts - a.ts).map(f => {
        const t = new Date(f.ts);
        const when = t.toLocaleDateString() + ' ' + t.getHours().toString().padStart(2, '0') + ':' + t.getMinutes().toString().padStart(2, '0');
        const canDelete = f.from === netConfig.deviceId || netHubOwner[id];
        return `<div style="display:flex; align-items:center; gap:12px; padding:10px 12px; border-radius:12px; background:rgb(var(--slate-800)); margin-bottom:8px">
            <i class="fas ${_netFileIcon(f.name)}" style="color:rgb(var(--tw-cyan-400)); font-size:20px; width:24px; text-align:center"></i>
            <div style="flex:1; min-width:0">
                <div class="text-slate-100 text-sm font-medium truncate">${_netEsc(f.name)}</div>
                <div class="text-slate-500 text-xs truncate">${_netFmtSize(f.size)} · ${_netEsc(f.fromName || '?')} · ${when}</div>
            </div>
            <button onclick="netHubStoreDownload('${f.fileId}')" title="Download" class="w-8 h-8 flex items-center justify-center rounded-lg text-slate-300 hover:text-white hover:bg-slate-700 transition-colors"><i class="fas fa-download text-sm"></i></button>
            ${canDelete ? `<button onclick="netHubStoreDelete('${f.fileId}')" title="Delete" class="w-8 h-8 flex items-center justify-center rounded-lg text-slate-500 hover:text-red-400 hover:bg-slate-700 transition-colors"><i class="fas fa-trash text-sm"></i></button>` : ''}
        </div>`;
    }).join('');
    pane.innerHTML = header + rows;
}

function _netFileIcon(name) {
    const ext = (name || '').split('.').pop().toLowerCase();
    if (ext === 'pdf') return 'fa-file-pdf';
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'heic'].includes(ext)) return 'fa-file-image';
    if (['mp4', 'mov', 'mkv', 'avi', 'webm'].includes(ext)) return 'fa-file-video';
    if (['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg'].includes(ext)) return 'fa-file-audio';
    if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return 'fa-file-archive';
    if (['doc', 'docx'].includes(ext)) return 'fa-file-word';
    if (['xls', 'xlsx', 'csv'].includes(ext)) return 'fa-file-excel';
    if (['ppt', 'pptx'].includes(ext)) return 'fa-file-powerpoint';
    if (['js', 'ts', 'py', 'html', 'css', 'json', 'c', 'cpp', 'java'].includes(ext)) return 'fa-file-code';
    if (['txt', 'md'].includes(ext)) return 'fa-file-alt';
    return 'fa-file';
}

// ── Public-server modals (create / join) ───────────────────────
function _netOpenCreateModal() {
    if (!_netHubConfigured()) { _netToast('Public servers aren’t set up yet'); return; }
    const m = document.getElementById('net-hub-create-modal');
    if (!m) return;
    document.getElementById('net-hub-create-name').value = '';
    document.getElementById('net-hub-create-pass').value = '';
    m.style.display = 'flex';
    setTimeout(() => document.getElementById('net-hub-create-name').focus(), 30);
}
function netCloseCreateModal() { const m = document.getElementById('net-hub-create-modal'); if (m) m.style.display = 'none'; }
function netConfirmCreate() {
    const name = document.getElementById('net-hub-create-name').value.trim();
    const pass = document.getElementById('net-hub-create-pass').value;
    if (!name) { _netToast('Enter a name'); return; }
    if (!pass)  { _netToast('Enter a password'); return; }
    netCreateHubServer(name, pass);
    netCloseCreateModal();
}

function _netOpenJoinModal(id, name) {
    const m = document.getElementById('net-hub-join-modal');
    if (!m) return;
    document.getElementById('net-hub-join-title').textContent = 'Join "' + name + '"';
    const pass = document.getElementById('net-hub-join-pass');
    pass.value = '';
    m.dataset.serverId = id;
    m.style.display = 'flex';
    setTimeout(() => pass.focus(), 30);
}
function netCloseJoinModal() { const m = document.getElementById('net-hub-join-modal'); if (m) m.style.display = 'none'; }
function netConfirmJoin() {
    const m = document.getElementById('net-hub-join-modal');
    const id = m.dataset.serverId;
    const pass = document.getElementById('net-hub-join-pass').value;
    netSubmitJoin(id, pass);
    netCloseJoinModal();
}

function _netRenderServers() {
    const list = document.getElementById('net-servers');
    if (!list) return;
    const servers = _netAllServers().sort((a, b) => a.name.localeCompare(b.name));
    if (!servers.length) {
        list.innerHTML = `<div class="text-slate-600 text-xs px-3 py-2">No servers yet — create one below.</div>`;
        return;
    }
    list.innerHTML = servers.map(s => {
        const active = netActiveServer && netActiveServer.id === s.id ? 'background:rgba(34,211,238,0.12); border-color:rgba(34,211,238,0.4)' : '';
        const sub = s.mine ? 'hosting' : 'by ' + _netEsc(s.hostName);
        return `<div onclick="netOpenServer('${s.id}','${s.hostId}')"
            style="display:flex; align-items:center; gap:10px; padding:9px 12px; border-radius:12px; cursor:pointer; border:1px solid transparent; ${active}">
            <div style="width:34px; height:34px; border-radius:10px; background:rgba(34,211,238,0.12); display:flex; align-items:center; justify-content:center; flex-shrink:0">
                <i class="fas fa-server" style="color:rgb(var(--tw-cyan-400)); font-size:14px"></i>
            </div>
            <div style="min-width:0; flex:1">
                <div class="text-slate-100 text-sm font-medium truncate">${_netEsc(s.name)}</div>
                <div class="text-slate-500 text-xs truncate">${sub}</div>
            </div>
        </div>`;
    }).join('');
}

function _netRenderServerView() {
    const pane = document.getElementById('net-convo');
    const head = document.getElementById('net-convo-head');
    const composer = document.getElementById('net-composer');
    if (!pane) return;
    const a = netActiveServer; if (!a) return;
    const mineHost = a.hostId === netConfig.deviceId;
    const state = mineHost ? netServers[a.id] : (netRemoteCache[a.id] || { name: a.id, messages: [] });
    if (mineHost && !state) { netActiveServer = null; _netRenderConvo(); return; }

    const name = state.name || 'Server';
    const hostName = mineHost ? 'you' : ((netPeers[a.hostId] && netPeers[a.hostId].name) || 'host');
    head.innerHTML = `<div style="display:flex; align-items:center; gap:10px; width:100%">
        <i class="fas fa-server" style="color:rgb(var(--tw-cyan-400))"></i>
        <div style="flex:1; min-width:0">
            <div class="text-slate-100 text-sm font-semibold truncate">${_netEsc(name)}</div>
            <div class="text-xs text-slate-500">hosted by ${_netEsc(hostName)}</div>
        </div>
        ${mineHost
            ? `<button onclick="netDeleteServer('${a.id}')" class="text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded-lg hover:bg-slate-800 transition-colors"><i class="fas fa-trash mr-1"></i>Delete</button>`
            : `<button onclick="netLeaveServer()" class="text-xs text-slate-400 hover:text-white px-2 py-1 rounded-lg hover:bg-slate-800 transition-colors">Leave</button>`}
    </div>`;
    composer.style.display = '';

    if (state.gone) {
        pane.innerHTML = `<div style="height:100%; display:flex; align-items:center; justify-content:center; color:rgb(var(--slate-600))" class="text-sm">This server is no longer available</div>`;
        return;
    }
    const msgs = state.messages || [];
    if (!msgs.length) {
        pane.innerHTML = `<div style="height:100%; display:flex; align-items:center; justify-content:center; color:rgb(var(--slate-600))" class="text-sm">No messages yet — say hi to everyone</div>`;
        return;
    }
    pane.innerHTML = msgs.map(e => {
        const mine = e.fromId === netConfig.deviceId;
        const align = mine ? 'flex-end' : 'flex-start';
        const bg = mine ? 'background:rgb(var(--tw-cyan-700)); color:rgb(var(--tw-cyan-50))' : 'background:rgb(var(--slate-800)); color:rgb(var(--slate-200))';
        let body;
        if (e.kind === 'file') {
            body = `<div onclick="netDownloadServerFile('${e.fileId}','${_netAttr(e.name)}')" style="display:flex; align-items:center; gap:10px; cursor:pointer">
                <i class="fas fa-file" style="font-size:18px; opacity:.9"></i>
                <div style="min-width:0">
                    <div class="truncate" style="font-weight:600; max-width:220px">${_netEsc(e.name)}</div>
                    <div style="font-size:11px; opacity:.7">${_netFmtSize(e.size)} · click to download</div>
                </div>
            </div>`;
        } else {
            body = _netEsc(e.text).replace(/\n/g, '<br>');
        }
        const t = new Date(e.ts);
        const time = t.getHours().toString().padStart(2, '0') + ':' + t.getMinutes().toString().padStart(2, '0');
        const sender = mine ? '' : `<div style="font-size:10px; font-weight:600; opacity:.8; margin-bottom:2px">${_netEsc(e.fromName || '?')}</div>`;
        return `<div style="display:flex; justify-content:${align}; margin-bottom:8px">
            <div style="${bg}; padding:8px 12px; border-radius:14px; max-width:75%; word-break:break-word; font-size:13px; line-height:1.4">
                ${sender}${body}
                <div style="font-size:10px; opacity:.55; margin-top:3px; text-align:right">${time}</div>
            </div>
        </div>`;
    }).join('');
    pane.scrollTop = pane.scrollHeight;
}

function _netRenderConvo() {
    const pane = document.getElementById('net-convo');
    const head = document.getElementById('net-convo-head');
    const composer = document.getElementById('net-composer');
    if (!pane) return;
    const peer = netActivePeer ? netPeers[netActivePeer] : null;

    if (!netActivePeer) {
        head.innerHTML = '';
        composer.style.display = 'none';
        pane.innerHTML = `<div style="height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center; color:rgb(var(--slate-600))">
            <i class="fas fa-network-wired text-4xl mb-3 opacity-30"></i>
            <p class="text-sm">Select a device to start chatting and sharing files</p>
        </div>`;
        return;
    }

    const offline = !peer;
    head.innerHTML = `<div style="display:flex; align-items:center; gap:10px">
        <i class="fas ${_netIcon(peer ? peer.type : 'computer')}" style="color:rgb(var(--tw-cyan-400))"></i>
        <div>
            <div class="text-slate-100 text-sm font-semibold">${_netEsc(peer ? peer.name : 'Device')}</div>
            <div class="text-xs ${offline ? 'text-slate-500' : 'text-green-400'}">${offline ? 'offline' : peer.address}</div>
        </div>
    </div>`;
    composer.style.display = '';

    const convo = netConvos[netActivePeer] || [];
    if (!convo.length) {
        pane.innerHTML = `<div style="height:100%; display:flex; align-items:center; justify-content:center; color:rgb(var(--slate-600))" class="text-sm">No messages yet — say hi</div>`;
    } else {
        pane.innerHTML = convo.map(e => {
            const mine = e.dir === 'out';
            const align = mine ? 'flex-end' : 'flex-start';
            const bg = mine ? 'background:rgb(var(--tw-cyan-700)); color:rgb(var(--tw-cyan-50))' : 'background:rgb(var(--slate-800)); color:rgb(var(--slate-200))';
            let body;
            if (e.kind === 'file') {
                body = `<div onclick="netOpenFile('${_netAttr(e.path)}')" style="display:flex; align-items:center; gap:10px; cursor:pointer">
                    <i class="fas fa-file" style="font-size:18px; opacity:.9"></i>
                    <div style="min-width:0">
                        <div class="truncate" style="font-weight:600; max-width:220px">${_netEsc(e.name)}</div>
                        <div style="font-size:11px; opacity:.7">${_netFmtSize(e.size)} · click to open</div>
                    </div>
                </div>`;
            } else {
                body = _netEsc(e.text).replace(/\n/g, '<br>');
            }
            const t = new Date(e.ts);
            const time = t.getHours().toString().padStart(2, '0') + ':' + t.getMinutes().toString().padStart(2, '0');
            return `<div style="display:flex; justify-content:${align}; margin-bottom:8px">
                <div style="${bg}; padding:8px 12px; border-radius:14px; max-width:75%; word-break:break-word; font-size:13px; line-height:1.4">
                    ${body}
                    <div style="font-size:10px; opacity:.55; margin-top:3px; text-align:right">${time}</div>
                </div>
            </div>`;
        }).join('');
        pane.scrollTop = pane.scrollHeight;
    }
}

function netOpenFile(p) {
    try { ipcRenderer.send('open-path', p); } catch (_) {}
    try { require('electron').shell.openPath(p); } catch (_) {}
}

// ── Server address (editable, no rebuild needed) ───────────────
function netSaveServerAddr() {
    const inp = document.getElementById('net-server-host');
    if (!inp) return;
    const host = (inp.value || '').trim();
    const cfgPath = path.join(DOCUMENTS_PATH, 'vulsor-config.json');
    let cfg = { serverHost: '', updatePort: 8479, relayPort: 8480, useHttps: false };
    try { if (fs.existsSync(cfgPath)) cfg = Object.assign(cfg, JSON.parse(fs.readFileSync(cfgPath, 'utf8'))); } catch (_) {}
    cfg.serverHost = host || 'CHANGE-ME-UBUNTU-ADDRESS';
    try { fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2)); } catch (_) { _netToast('Could not save address'); return; }

    // apply immediately: drop the old connection and reconnect to the new host
    if (netHubSock) { try { netHubSock.destroy(); } catch (_) {} netHubSock = null; netHubConnected = false; }
    if (netHubReconnect) { clearTimeout(netHubReconnect); netHubReconnect = null; }
    netActiveHub = null; netHubList = []; netHubTokens = {}; netHubMsgs = {}; netHubStore = {};
    _netLoadServerConfig();
    _netHubConnect();
    _netRenderHubServers();
    _netRenderRight();
    _netToast(host ? 'Server set to ' + host : 'Server address cleared');
}

// ── Host public servers on this computer ───────────────────────
function netToggleHost(on) {
    netConfig.hostPublic = !!on;
    _netSave();
    // tear down any existing relay connection
    if (netHubSock) { try { netHubSock.destroy(); } catch (_) {} netHubSock = null; netHubConnected = false; }
    if (netHubReconnect) { clearTimeout(netHubReconnect); netHubReconnect = null; }
    netActiveHub = null; netHubList = []; netHubTokens = {}; netHubMsgs = {}; netHubStore = {};

    ipcRenderer.invoke('relay:set', on).then((res) => {
        if (on && res && res.error) { _netToast(res.error); }
        else if (on) { _netToast('Now hosting public servers on this computer'); }
        else { _netToast('Stopped hosting'); }
        _netHubConnect();
        _netRenderHubServers();
        _netRenderRight();
    }).catch(() => { _netHubConnect(); });
}

// ── Identity editing ───────────────────────────────────────────
function netSaveIdentity() {
    const nameEl = document.getElementById('net-my-name');
    const typeEl = document.getElementById('net-my-type');
    if (nameEl) netConfig.deviceName = nameEl.value.trim() || os.hostname();
    if (typeEl) netConfig.deviceType = typeEl.value;
    _netSave();
    _netBroadcast('beacon');
    _netToast('Saved');
}

// ── Small helpers ──────────────────────────────────────────────
function _netEsc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function _netAttr(s) { return _netEsc(s).replace(/'/g, '&#39;'); }

let _netToastTimer = null;
function _netToast(msg) {
    let t = document.getElementById('net-toast');
    if (!t) {
        t = document.createElement('div');
        t.id = 'net-toast';
        t.style.cssText = 'position:fixed; bottom:24px; left:50%; transform:translateX(-50%); background:rgb(var(--slate-900)); color:rgb(var(--slate-200)); border:1px solid rgba(255,255,255,.12); padding:10px 18px; border-radius:12px; font-size:13px; z-index:9999; box-shadow:0 8px 24px rgba(0,0,0,.5)';
        document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.opacity = '1';
    clearTimeout(_netToastTimer);
    _netToastTimer = setTimeout(() => { t.style.opacity = '0'; }, 2200);
}

// ── Lifecycle ──────────────────────────────────────────────────
function initNetwork() {
    if (netStarted) return;
    netStarted = true;
    _netLoad();
    _netLoadServerConfig();
    _netStartServer();
    _netStartDiscovery();
    // If this computer is set to host public servers, start the embedded relay first.
    if (netConfig.hostPublic) {
        ipcRenderer.invoke('relay:set', true).then(() => _netHubConnect()).catch(() => _netHubConnect());
    } else {
        _netHubConnect();
    }
    window.addEventListener('beforeunload', () => { try { _netBroadcast('bye'); } catch (_) {} });
}

function renderNetwork() {
    if (!netStarted) initNetwork();
    const nameEl = document.getElementById('net-my-name');
    const typeEl = document.getElementById('net-my-type');
    if (nameEl) nameEl.value = netConfig.deviceName;
    if (typeEl) typeEl.value = netConfig.deviceType;
    const hostEl = document.getElementById('net-server-host');
    if (hostEl && document.activeElement !== hostEl) hostEl.value = HUB_HOST || '';
    const hostToggle = document.getElementById('net-host-toggle');
    if (hostToggle) hostToggle.checked = !!netConfig.hostPublic;
    if (!netHubConnected) _netHubConnect();
    else _netHubSend({ t: 'list' });   // refresh the public list when reopening the tab
    _netRenderServers();
    _netRenderHubServers();
    _netRenderPeers();
    _netRenderRight();
}

// expose handlers used from inline HTML
window.netSelectPeer  = netSelectPeer;
window.netSendMessage = netSendMessage;
window.netSendFile    = netSendFile;
window.netOpenFile    = netOpenFile;
window.netSaveIdentity = netSaveIdentity;
window.netSaveServerAddr = netSaveServerAddr;
window.netToggleHost = netToggleHost;
window.netCreateServer = netCreateServer;
window.netDeleteServer = netDeleteServer;
window.netLeaveServer  = netLeaveServer;
window.netOpenServer   = netOpenServer;
window.netDownloadServerFile = netDownloadServerFile;
// public servers (relay)
window.netJoinHub        = netJoinHub;
window.netLeaveHub       = netLeaveHub;
window.netDeleteHubServer = netDeleteHubServer;
window.netDownloadHubFile = netDownloadHubFile;
window.netOpenCreateModal = _netOpenCreateModal;
window.netCloseCreateModal = netCloseCreateModal;
window.netConfirmCreate   = netConfirmCreate;
window.netCloseJoinModal  = netCloseJoinModal;
window.netConfirmJoin     = netConfirmJoin;
window.netHubSetMode      = netHubSetMode;
window.netHubStoreUpload  = netHubStoreUpload;
window.netHubStoreDownload = netHubStoreDownload;
window.netHubStoreDelete  = netHubStoreDelete;
