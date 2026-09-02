// ── WhatsApp Assistant (main process) ───────────────────────────────────
// Two-way WhatsApp conversations driven by the local Ollama model.
//
// Uses Baileys (a pure-Node WhatsApp Web client) so it links to the user's
// WhatsApp account as a device (scan a QR once) without launching a second
// browser. It listens for incoming 1:1 messages from WHITELISTED contacts,
// asks the local model for a reply, and sends it back automatically.
//
// Baileys / qrcode are lazy-required so the rest of the app still runs if the
// dependency hasn't been installed yet.
//
// IMPORTANT: automating a personal WhatsApp number is against WhatsApp's ToS
// and carries a (small but real) risk of the number being banned.

const fs    = require('fs');
const os    = require('os');
const path  = require('path');
const https = require('https');
const { execFile } = require('child_process');

let _emit     = () => {};          // event sink → renderer windows (set by main.js / start)
let _sock     = null;
let _status   = 'stopped';         // stopped | connecting | qr | online | error
let _starting = false;
let _authDir  = null;
let _lastQr   = null;              // last QR data-URL, so a reloading renderer can re-show it
let _lastError = null;

let _cfg = {
    // How messages leave this machine.
    //   'app'    — hand them to the WhatsApp desktop app already signed in here.
    //              Nothing to link, but nothing can read incoming messages either,
    //              so it can start and send, not auto-reply.
    //   'linked' — this app is its own linked device (the QR). Two-way.
    delivery: 'app',
    provider: 'ollama',        // 'ollama' (local, private) | 'gemini' (cloud)
    model: 'llama3.1:8b',      // Ollama model
    geminiKey: '',             // kept in the main process, never in localStorage
    geminiModel: '',           // resolved from the API on first use
    whitelist: [], ownerName: '', instruction: '',
};
let _cfgFile = null;

function _saveCfg() {
    if (!_cfgFile) return;
    try { fs.writeFileSync(_cfgFile, JSON.stringify(_cfg), 'utf8'); } catch (_) {}
}
function _loadCfg() {
    if (!_cfgFile) return;
    try {
        const d = JSON.parse(fs.readFileSync(_cfgFile, 'utf8'));
        if (d && typeof d === 'object') _cfg = Object.assign(_cfg, d);
    } catch (_) {}
}

const _histories = new Map();      // jid → [{ role, content }, …]  (per-chat memory)
const _topics    = new Map();      // jid → what this conversation is meant to be about
const HISTORY_MAX = 20;
let _histFile = null;              // conversations survive a restart

function _saveHistories() {
    if (!_histFile) return;
    try {
        fs.writeFileSync(_histFile, JSON.stringify({
            histories: Object.fromEntries(_histories),
            topics:    Object.fromEntries(_topics),
        }), 'utf8');
    } catch (_) {}
}
function _loadHistories() {
    if (!_histFile) return;
    try {
        const d = JSON.parse(fs.readFileSync(_histFile, 'utf8'));
        for (const [k, v] of Object.entries(d.histories || {})) if (Array.isArray(v)) _histories.set(k, v);
        for (const [k, v] of Object.entries(d.topics || {}))    if (typeof v === 'string') _topics.set(k, v);
    } catch (_) {}
}

// ── small helpers ────────────────────────────────────────────────────────
function _stubLogger() {
    const l = { level: 'silent', child: () => l, trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {} };
    return l;
}

function _setStatus(s, extra = {}) {
    _status = s;
    if (extra.error !== undefined) _lastError = extra.error;
    _emit('status', { status: s, ...extra });
}

function normNum(s) { return String(s || '').replace(/[^\d]/g, ''); }

function _whitelisted(jid) {
    const n = normNum(jid.split('@')[0]);
    if (!n) return false;
    return (_cfg.whitelist || []).some(w => {
        const e = normNum(w);
        if (e.length < 7) return false;
        return n === e || n.endsWith(e) || e.endsWith(n);
    });
}

function _clearAuth() { try { if (_authDir) fs.rmSync(_authDir, { recursive: true, force: true }); } catch (_) {} }

function status() {
    return {
        status: _status,
        whitelist: _cfg.whitelist,
        ownerName: _cfg.ownerName,
        instruction: _cfg.instruction,
        model: _cfg.model,
        provider: _cfg.provider,
        delivery: _cfg.delivery,
        // The key itself stays in the main process — the UI only needs to know
        // whether one is saved.
        hasGeminiKey: !!_cfg.geminiKey,
        geminiModel: _cfg.geminiModel,
        pending: _pendingOpeners.length,
        qr: _status === 'qr' ? _lastQr : null,
        error: _lastError
    };
}

function setConfig(patch = {}) {
    if (patch.model && typeof patch.model === 'string') _cfg.model = patch.model;
    if (Array.isArray(patch.whitelist)) _cfg.whitelist = patch.whitelist;
    if (typeof patch.ownerName === 'string') _cfg.ownerName = patch.ownerName;
    if (typeof patch.instruction === 'string') _cfg.instruction = patch.instruction;
    if (patch.provider === 'ollama' || patch.provider === 'gemini') _cfg.provider = patch.provider;
    if (patch.delivery === 'app' || patch.delivery === 'linked') _cfg.delivery = patch.delivery;
    // An empty string here means "leave the saved key alone", so a config push
    // from a UI that never sees the key can't wipe it.
    if (typeof patch.geminiKey === 'string' && patch.geminiKey.trim()) {
        _cfg.geminiKey   = patch.geminiKey.trim();
        _cfg.geminiModel = '';        // re-resolve for the new key
        _geminiRanked    = [];
    }
    if (patch.clearGeminiKey) { _cfg.geminiKey = ''; _cfg.geminiModel = ''; _geminiRanked = []; }
    _saveCfg();
    return status();
}

function setWhitelist(list) {
    _cfg.whitelist = Array.isArray(list) ? list : [];
    return status();
}

// ── Model backends ────────────────────────────────────────────────────────
// Two ways to answer: Ollama on this machine (private, free, needs the daemon
// running) or Gemini (cloud, needs a key). Everything above this line is
// backend-agnostic — it asks _chat() for a reply and doesn't care which.

function _geminiCall(pathname, body) {
    return new Promise((resolve, reject) => {
        const payload = body ? JSON.stringify(body) : null;
        const req = https.request({
            host: 'generativelanguage.googleapis.com',
            path: '/v1beta/' + pathname,
            method: body ? 'POST' : 'GET',
            headers: {
                'x-goog-api-key': _cfg.geminiKey,
                ...(payload ? { 'Content-Type': 'application/json',
                                'Content-Length': Buffer.byteLength(payload) } : {}),
            },
            timeout: 90000,
        }, res => {
            let raw = '';
            res.setEncoding('utf8');
            res.on('data', d => { raw += d; });
            res.on('end', () => {
                let j;
                try { j = JSON.parse(raw); }
                catch (_) {
                    // Say what actually came back — a bare status code hides auth
                    // failures and HTML error pages, which is most of what goes wrong.
                    return reject(new Error(`Gemini returned HTTP ${res.statusCode}: ${raw.slice(0, 160)}`));
                }
                if (j.error) return reject(new Error(j.error.message || ('Gemini ' + res.statusCode)));
                resolve(j);
            });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Gemini timed out')); });
        req.end(payload || undefined);
    });
}

// Newest usable Gemini, preferring flash (fast, cheap) over pro — the same
// ranking Vulsor Mind uses, so both apps land on the same model for a key.
function _rankGemini(models) {
    const score = n => {
        let s = 0;
        const m = n.match(/gemini-(\d+)\.?(\d+)?/);
        if (m) s += Number(m[1]) * 100 + Number(m[2] || 0) * 10;
        if (/flash/.test(n)) s += 25;
        if (/lite/.test(n)) s -= 12;
        if (/preview|exp/.test(n)) s -= 60;
        if (/latest/.test(n)) s += 8;
        return s;
    };
    return models.slice().sort((a, b) => score(b) - score(a));
}

// Ask the API which models this key can actually use, rather than hardcoding a
// name that Google may have retired.
let _geminiRanked = [];
async function _ensureGeminiModel() {
    if (_cfg.geminiModel && _geminiRanked.length) return _cfg.geminiModel;
    const j = await _geminiCall('models', null);
    const models = (j.models || [])
        .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
        .map(m => m.name.replace(/^models\//, ''))
        .filter(n => /^gemini/.test(n) && !/embedding|aqa|vision|tts|image/.test(n));
    _geminiRanked = _rankGemini(models);
    if (!_cfg.geminiModel) { _cfg.geminiModel = _geminiRanked[0] || ''; _saveCfg(); }
    return _cfg.geminiModel;
}

// One reply from whichever backend is configured. Throws with a message worth
// showing the user; callers turn that into a log line.
async function _chat(system, turns, temperature) {
    if (_cfg.provider === 'gemini') {
        if (!_cfg.geminiKey) throw new Error('No Gemini API key set — add one in the WhatsApp panel.');
        await _ensureGeminiModel();
        const body = {
            contents: turns.map(m => ({
                role: m.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: m.content }],
            })),
            systemInstruction: { parts: [{ text: system }] },
            generationConfig: { temperature },
        };
        // Work down the ranking: an overloaded or retired model is worth trying
        // the next one for rather than dropping the message.
        const chain = [_cfg.geminiModel, ..._geminiRanked.filter(m => m !== _cfg.geminiModel)]
            .filter(Boolean).slice(0, 4);
        let lastErr = null;
        for (const model of chain) {
            try {
                const j = await _geminiCall(`models/${model}:generateContent`, body);
                if (model !== _cfg.geminiModel) { _cfg.geminiModel = model; _saveCfg(); }
                return ((j.candidates || [])[0]?.content?.parts || [])
                    .map(pt => pt.text || '').join('').trim();
            } catch (e) {
                lastErr = e;
                if (!/high demand|overload|unavailable|not found|not supported|503/i.test(e.message)) throw e;
            }
        }
        throw lastErr || new Error('No usable Gemini model.');
    }

    const res = await fetch('http://localhost:11434/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: _cfg.model,
            messages: [{ role: 'system', content: system }, ...turns],
            stream: false, options: { temperature },
        }),
    });
    if (!res.ok) throw new Error('Ollama returned ' + res.status);
    const data = await res.json();
    return ((data.message && data.message.content) || '').trim();
}

// ── AI reply ──────────────────────────────────────────────────────────────
function _buildSystemPrompt(jid) {
    const who = _cfg.ownerName
        ? `You are replying to WhatsApp messages on behalf of ${_cfg.ownerName}.`
        : 'You are replying to WhatsApp messages on behalf of the phone\'s owner.';
    const topic = jid && _topics.get(jid);
    return [
        who,
        topic ? ('This conversation was started deliberately. What it is for: ' + topic
                 + ' Keep it heading there, but let it breathe like a normal chat.') : '',
        'Write like a real person texting: short, casual, warm. Plain text ONLY — no markdown, no bullet points, no headings, no emoji spam.',
        'Reply in the same language the other person is using.',
        'Keep replies to one or two short sentences unless more detail is clearly needed.',
        'You are Vulsor, an AI assistant. Do not pretend to be a human.',
        'If you are asked who or what you are — or whether you are a bot, an AI, or a real person — say plainly that you are Vulsor, an AI, replying on the owner\'s behalf. Say it once, naturally, and carry on with the conversation.',
        'Do not open with it or bring it up unprompted; it is an honest answer, not a disclaimer to repeat.',
        _cfg.instruction ? ('Extra instructions from the owner: ' + _cfg.instruction) : ''
    ].filter(Boolean).join('\n');
}

async function _aiReply(jid, incoming) {
    const sys  = _buildSystemPrompt(jid);
    const hist = _histories.get(jid) || [];
    // Build the request off a copy. The turn only joins the stored history once
    // there's a reply to pair it with — otherwise a failed generation left the
    // chat carrying a message the model never answered.
    let reply = '';
    try {
        reply = await _chat(sys, [...hist, { role: 'user', content: incoming }], 0.7);
    } catch (e) {
        _emit('log', { jid, error: 'AI error: ' + e.message });
        return '';
    }

    // The model occasionally echoes TOOL_CALL lines from the Jarvis prompt; strip them.
    reply = reply.replace(/TOOL_CALL:\s*\{[\s\S]*?\}\s*/g, '').trim();

    if (reply) {
        hist.push({ role: 'user', content: incoming });
        hist.push({ role: 'assistant', content: reply });
        while (hist.length > HISTORY_MAX) hist.shift();
        _histories.set(jid, hist);
        _saveHistories();
    }
    return reply;
}

// ── lifecycle ──────────────────────────────────────────────────────────────
function init(authDir) {
    _authDir = authDir;
    try { fs.mkdirSync(authDir, { recursive: true }); } catch (_) {}
    _histFile = authDir.replace(/\/+$/, '') + '-chats.json';
    _cfgFile  = authDir.replace(/\/+$/, '') + '-config.json';
    _loadCfg();
    _loadHistories();
}

async function start(opts = {}, emit) {
    if (emit) _emit = emit;
    setConfig(opts);
    if (_starting || _sock) return status();   // already running / connecting
    _starting = true;
    _lastError = null;
    _setStatus('connecting');

    let baileys;
    try {
        baileys = require('@whiskeysockets/baileys');
    } catch (e) {
        _starting = false;
        _setStatus('error', { error: 'WhatsApp library not installed. Run: npm install @whiskeysockets/baileys qrcode' });
        return status();
    }
    const makeWASocket = baileys.default || baileys.makeWASocket;
    const { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = baileys;
    let QRCode = null;
    try { QRCode = require('qrcode'); } catch (_) {}

    try {
        const { state, saveCreds } = await useMultiFileAuthState(_authDir);
        let version;
        try { ({ version } = await fetchLatestBaileysVersion()); } catch (_) {}

        _sock = makeWASocket({
            auth: state,
            version,
            logger: _stubLogger(),
            browser: ['Vulsor', 'Chrome', '1.0'],
            markOnlineOnConnect: false,
            syncFullHistory: false
        });

        _sock.ev.on('creds.update', saveCreds);

        _sock.ev.on('connection.update', async (u) => {
            const { connection, lastDisconnect, qr } = u;
            if (qr) {
                if (QRCode) {
                    try { _lastQr = await QRCode.toDataURL(qr, { margin: 1, width: 280 }); }
                    catch (_) { _lastQr = null; }
                }
                _setStatus('qr', { qr: _lastQr, qrText: qr });
            }
            if (connection === 'open') {
                _starting = false; _lastQr = null;
                _setStatus('online');
                _flushPendingOpeners().catch(() => {});
            }
            if (connection === 'close') {
                const code = lastDisconnect && lastDisconnect.error
                    && lastDisconnect.error.output && lastDisconnect.error.output.statusCode;
                _sock = null;
                if (code === DisconnectReason.loggedOut) {
                    _starting = false;
                    _clearAuth();
                    _setStatus('stopped', { reason: 'logged-out' });
                } else if (_status !== 'stopped') {
                    // transient drop — reconnect, reusing the saved session
                    _setStatus('connecting');
                    setTimeout(() => { start({}, _emit).catch(() => {}); }, 2500);
                }
            }
        });

        _sock.ev.on('messages.upsert', async (ev) => {
            try {
                if (ev.type !== 'notify') return;
                for (const msg of ev.messages) {
                    if (!msg.message || msg.key.fromMe) continue;
                    const jid = msg.key.remoteJid || '';
                    if (!jid.endsWith('@s.whatsapp.net')) continue;        // 1:1 chats only (no groups/status)
                    const m = msg.message;
                    const text = m.conversation
                        || (m.extendedTextMessage && m.extendedTextMessage.text)
                        || (m.imageMessage && m.imageMessage.caption)
                        || (m.videoMessage && m.videoMessage.caption)
                        || '';
                    if (!text.trim()) continue;
                    if (!_whitelisted(jid)) continue;

                    _emit('log', { jid, dir: 'in', text: text.trim() });
                    try { await _sock.readMessages([msg.key]); } catch (_) {}
                    try { await _sock.sendPresenceUpdate('composing', jid); } catch (_) {}

                    const reply = await _aiReply(jid, text.trim());

                    try { await _sock.sendPresenceUpdate('paused', jid); } catch (_) {}
                    if (reply && _sock) {
                        await _sock.sendMessage(jid, { text: reply });
                        _emit('log', { jid, dir: 'out', text: reply });
                    }
                }
            } catch (e) {
                _emit('log', { error: 'handler: ' + e.message });
            }
        });

        return status();
    } catch (e) {
        _starting = false; _sock = null;
        _setStatus('error', { error: e.message });
        return status();
    }
}

// Send a one-off outbound message through the linked session (used by the
// AI's send_whatsapp tool for reliable auto-send — no keystroke simulation).
async function sendText(number, text) {
    if (!_sock || _status !== 'online') return { ok: false, reason: 'offline' };
    const digits = normNum(number);
    if (!digits) return { ok: false, reason: 'bad-number' };
    if (!String(text || '').trim()) return { ok: false, reason: 'empty' };
    const jid = digits + '@s.whatsapp.net';
    try {
        // Best-effort check that the number is actually on WhatsApp.
        try {
            const r = await _sock.onWhatsApp(jid);
            if (Array.isArray(r) && r.length && r[0] && r[0].exists === false) {
                return { ok: false, reason: 'not-on-whatsapp' };
            }
        } catch (_) { /* lookup unavailable — proceed and let send decide */ }
        await _sock.sendMessage(jid, { text: String(text) });
        return { ok: true };
    } catch (e) {
        return { ok: false, reason: 'error', error: e.message };
    }
}

// ── Sending through the WhatsApp desktop app ───────────────────────────────
// The app on this Mac is already signed in, so there's nothing to link. We hand
// it a whatsapp://send URL with the text pre-filled and press Return. This is
// the same route the AI's send_whatsapp tool has always used; it lives here now
// so both callers share one copy.
//
// It can only SEND. Nothing can read incoming messages out of the desktop app,
// which is why auto-replies still need the linked ('linked') mode.
function sendViaApp(number, text) {
    return new Promise(resolve => {
        const digits = normNum(number);
        if (!digits) return resolve({ ok: false, reason: 'bad-number' });
        const body = String(text || '').trim();
        if (!body) return resolve({ ok: false, reason: 'empty' });

        const url = `whatsapp://send?phone=${digits}&text=${encodeURIComponent(body).replace(/'/g, '%27')}`;
        const script = `set waURL to ${JSON.stringify(url)}
set wasRunning to (application "WhatsApp" is running)
do shell script "open " & quoted form of waURL
if wasRunning then
    delay 2
else
    repeat 40 times
        if application "WhatsApp" is running then exit repeat
        delay 0.25
    end repeat
    delay 4
end if
tell application "WhatsApp" to activate
delay 1.2
tell application "System Events"
    try
        tell process "WhatsApp" to set frontmost to true
    end try
    delay 0.5
    key code 36
end tell`;
        let file;
        try {
            file = path.join(os.tmpdir(), 'vulsor_wa_send_' + Date.now() + '.applescript');
            fs.writeFileSync(file, script, 'utf8');
        } catch (e) { return resolve({ ok: false, reason: 'error', error: e.message }); }

        execFile('osascript', [file], { timeout: 45000 }, (err) => {
            try { fs.unlinkSync(file); } catch (_) {}
            if (err) {
                // The message is sitting in WhatsApp with the text ready — only the
                // keystroke failed, which is almost always the Accessibility grant.
                return resolve({ ok: false, reason: 'no-accessibility', error: err.message });
            }
            resolve({ ok: true });
        });
    });
}

// ── Start a conversation ───────────────────────────────────────────────────
// The bot could only ever react: it waited for a whitelisted contact to message
// first. This opens one with a contact you pick — the model writes the opener,
// it goes out through the linked session, and the exchange is seeded so the
// reply lands in a conversation that already has context instead of arriving
// cold. The number is whitelisted at the same time, otherwise the bot would
// open a chat and then ignore the answer.
//
//   number  the contact to message
//   topic   what the conversation is for, in the owner's words
//   opener  optional exact first message; when omitted the model writes it
async function startConversation(number, topic, opener, queue) {
    const digits = normNum(number);
    if (!digits) return { ok: false, reason: 'bad-number' };
    const jid = digits + '@s.whatsapp.net';

    // Delivering through the desktop app needs no socket and no linking — the
    // app on this Mac is already signed in. Compose and hand it over.
    if (_cfg.delivery === 'app') {
        const composed = await _composeOpener(jid, topic, opener);
        if (!composed.ok) return composed;
        const sent = await sendViaApp(digits, composed.text);
        if (!sent.ok) return sent;
        _rememberOpener(jid, composed.text, topic, digits);
        return { ok: true, text: composed.text, jid, via: 'app' };
    }

    if (!_sock || _status !== 'online') {
        // Being told "not connected" and left to go and fix it yourself is a
        // dead end. Hold the request and send it the moment the link is live.
        if (!queue) return { ok: false, reason: 'offline' };
        if (!_pendingOpeners.some(p => p.number === digits)) {
            _pendingOpeners.push({ number: digits, topic, opener });
        }
        if (topic && String(topic).trim()) _topics.set(jid, String(topic).trim());
        if (!_whitelisted(jid)) _cfg.whitelist = [...(_cfg.whitelist || []), digits];
        _saveCfg();
        return { ok: true, queued: true };
    }

    if (topic && String(topic).trim()) _topics.set(jid, String(topic).trim());

    // Make sure the reply will actually be answered.
    if (!_whitelisted(jid)) {
        _cfg.whitelist = [...(_cfg.whitelist || []), digits];
    }

    const composed = await _composeOpener(jid, topic, opener);
    if (!composed.ok) return composed;

    try {
        await _sock.sendMessage(jid, { text: composed.text });
    } catch (e) {
        return { ok: false, reason: 'send-failed', error: e.message };
    }
    _rememberOpener(jid, composed.text, topic, digits);
    return { ok: true, text: composed.text, jid, via: 'linked' };
}

// The first message: whatever the caller supplied, or one the model writes.
async function _composeOpener(jid, topic, opener) {
    let text = String(opener || '').trim();
    if (!text) {
        const sys = _buildSystemPrompt(jid);
        const ask = topic
            ? `Open the conversation. Send the first message. What you want out of it: ${topic}`
            : 'Open the conversation with a natural first message.';
        try {
            text = (await _chat(sys, [{ role: 'user', content: ask }], 0.8))
                .replace(/TOOL_CALL:\s*\{[\s\S]*?\}\s*/g, '')
                .replace(/^["']|["']$/g, '')
                .trim();
        } catch (e) {
            return { ok: false, reason: 'ai-error', error: e.message };
        }
    }
    if (!text) return { ok: false, reason: 'empty-opener' };
    return { ok: true, text };
}

// Seed the thread with what we just said, so a reply continues it rather than
// arriving cold, and make sure that reply would be answered.
function _rememberOpener(jid, text, topic, digits) {
    if (topic && String(topic).trim()) _topics.set(jid, String(topic).trim());
    if (digits && !_whitelisted(jid)) _cfg.whitelist = [...(_cfg.whitelist || []), digits];
    const hist = _histories.get(jid) || [];
    hist.push({ role: 'assistant', content: text });
    while (hist.length > HISTORY_MAX) hist.shift();
    _histories.set(jid, hist);
    _saveHistories();
    _saveCfg();
    _emit('log', { jid, dir: 'out', text });
}

// Conversations asked for while WhatsApp was still connecting.
const _pendingOpeners = [];

// Called once the link comes up: send everything that was waiting on it.
async function _flushPendingOpeners() {
    if (!_pendingOpeners.length) return;
    const queued = _pendingOpeners.splice(0, _pendingOpeners.length);
    for (const p of queued) {
        try {
            const r = await startConversation(p.number, p.topic, p.opener);
            if (!r.ok) _emit('log', { error: `Could not open the chat with +${p.number}: ${r.error || r.reason}` });
        } catch (e) {
            _emit('log', { error: `Could not open the chat with +${p.number}: ${e.message}` });
        }
    }
}

// Forget a conversation's memory and purpose without touching the contact.
function resetConversation(number) {
    const jid = normNum(number) + '@s.whatsapp.net';
    _histories.delete(jid);
    _topics.delete(jid);
    _saveHistories();
    return { ok: true };
}

// Pause the bot but KEEP the linked session (re-enabling won't need a new QR).
async function stop() {
    _setStatus('stopped');
    _starting = false;
    _lastQr = null;
    if (_sock) {
        try { _sock.end(undefined); } catch (_) {}
        _sock = null;
    }
    return status();
}

// Fully unlink the device — clears the saved session (next start needs a QR scan).
async function unlink() {
    if (_sock) {
        try { await _sock.logout(); } catch (_) {}
        try { _sock.end(undefined); } catch (_) {}
        _sock = null;
    }
    _clearAuth();
    _starting = false;
    _lastQr = null;
    _histories.clear();
    _setStatus('stopped', { reason: 'unlinked' });
    return status();
}

module.exports = { init, start, stop, unlink, status, setConfig, setWhitelist, sendText,
                   sendViaApp, startConversation, resetConversation };
