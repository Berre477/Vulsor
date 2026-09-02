// ══════════════════════════════════════════════════════════════
//  Vulsor workout server  (run on the Ubuntu box)
//
//  Hosts the daily workout page on a PUBLIC HTTPS origin so the
//  phone can install it as a real offline page. That's the whole
//  reason this exists: a service worker — the only thing that can
//  make a page store itself offline — refuses to register unless
//  the origin is secure. A LAN address like http://192.168.1.5:8477
//  is not secure, and AppCache (which used to work over plain HTTP)
//  was removed from every browser. A proper HTTPS host is the only
//  way, and it has a bonus: the phone can be on cellular anywhere,
//  not just on the same Wi-Fi.
//
//  Vulsor PUTs the rendered page here; the phone GETs it once and
//  then never needs the network again.
//
//  Usage:   node workout-server.js
//  Env:     PORT=8478
//           DATA_DIR=/home/USER/vulsor-server/workout-data
//           TOKEN=<shared secret, same value Vulsor sends>
//           TLS_CERT=/etc/letsencrypt/live/<host>/fullchain.pem
//           TLS_KEY=/etc/letsencrypt/live/<host>/privkey.pem
//
//  Without TLS_CERT/TLS_KEY it serves plain HTTP — only useful on
//  localhost (browsers treat localhost as secure) or behind a proxy
//  such as nginx/Caddy that terminates TLS for you.
//
//  Pure Node — no dependencies. Pair it with the systemd unit
//  (vulsor-workout.service) so it stays running and starts on boot.
//  See README-workout.md for the certbot steps.
// ══════════════════════════════════════════════════════════════

const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const crypto = require('crypto');

const PORT     = parseInt(process.env.PORT || '8478', 10);
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'workout-data'));
const TOKEN    = process.env.TOKEN || '';
const MAX_BODY = 8 * 1024 * 1024;          // pages carry inlined images

if (!TOKEN) {
    console.error('Refusing to start: TOKEN is not set. Without it anyone could');
    console.error('overwrite your workout page. Generate one in Vulsor (Workouts →');
    console.error('To phone) and put the same value in vulsor-workout.service.');
    process.exit(1);
}
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// The slug is the secret in the URL — it's what keeps the page unlisted, so it
// has to be long and it must never be able to escape DATA_DIR.
const SLUG_RE = /^[A-Za-z0-9_-]{16,64}$/;
const pageFile = slug => path.join(DATA_DIR, slug + '.html');

// Constant-time compare, so a wrong token can't be guessed a byte at a time.
function tokenOk(header) {
    const got = String(header || '').replace(/^Bearer\s+/i, '');
    const a = Buffer.from(got), b = Buffer.from(TOKEN);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ── The service worker ──
// Network-first with a short timeout, cache fallback. At home there's a route to
// this box, so you get the freshly published day; at the gym the fetch fails (or
// stalls) and the cached copy renders with no network at all. Every successful
// fetch refreshes the cache, so the page you hold offline is always the last one
// you managed to load.
const SW_JS = `const CACHE = 'vulsor-workout-v1';
const TIMEOUT = 2500;

self.addEventListener('install', e => {
    // Grab the page immediately so it's usable offline after the very first visit.
    e.waitUntil(caches.open(CACHE).then(c => c.add('./')).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
    e.waitUntil(caches.keys()
        .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
        .then(() => self.clients.claim()));
});

function fromNetwork(req) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout')), TIMEOUT);
        fetch(req).then(res => { clearTimeout(timer); resolve(res); },
                        err => { clearTimeout(timer); reject(err); });
    });
}

self.addEventListener('fetch', e => {
    if (e.request.method !== 'GET') return;
    e.respondWith(
        fromNetwork(e.request)
            .then(res => {
                if (res && res.ok) {
                    const copy = res.clone();
                    caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
                }
                return res;
            })
            .catch(() => caches.match(e.request, { ignoreSearch: true })
                .then(hit => hit || caches.match('./')
                .then(page => page || new Response(
                    '<p style="font-family:sans-serif;padding:24px">No offline copy saved yet — open this once while you have signal.</p>',
                    { headers: { 'Content-Type': 'text/html; charset=utf-8' } }))))
    );
});
`;

const MANIFEST = slug => JSON.stringify({
    name: 'Vulsor Workout',
    short_name: 'Workout',
    start_url: `/w/${slug}/`,
    scope: `/w/${slug}/`,
    display: 'standalone',
    background_color: '#0f172a',
    theme_color: '#0f172a',
}, null, 2);

function send(res, status, type, body, extra) {
    res.writeHead(status, Object.assign({
        'Content-Type': type,
        'Content-Length': Buffer.byteLength(body),
        // This origin only ever serves one person's own page; nothing here is
        // meant to be embedded or read by other sites.
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
    }, extra || {}));
    res.end(body);
}

const handler = (req, res) => {
    let urlPath;
    try { urlPath = decodeURIComponent((req.url || '/').split('?')[0]); }
    catch (_) { return send(res, 400, 'text/plain', 'bad request'); }

    const m = /^\/w\/([^/]+)\/?(sw\.js|app\.webmanifest)?$/.exec(urlPath);
    if (!m) return send(res, 404, 'text/plain', 'not found');
    const [, slug, asset] = m;
    if (!SLUG_RE.test(slug)) return send(res, 404, 'text/plain', 'not found');

    // ── Vulsor publishes the day ──
    if (req.method === 'PUT' || req.method === 'POST') {
        if (asset) return send(res, 405, 'text/plain', 'method not allowed');
        if (!tokenOk(req.headers.authorization)) {
            console.log(new Date().toISOString(), 'rejected publish from', req.socket.remoteAddress);
            return send(res, 401, 'text/plain', 'unauthorized');
        }
        const chunks = [];
        let size = 0, aborted = false;
        req.on('data', d => {
            if (aborted) return;
            size += d.length;
            if (size > MAX_BODY) {
                aborted = true;
                // Close the connection rather than destroying the socket mid-write:
                // a destroyed socket can go back into the client's keep-alive pool
                // and blow up the NEXT publish with EPIPE.
                send(res, 413, 'text/plain', 'too large', { 'Connection': 'close' });
                res.on('finish', () => { try { req.destroy(); } catch (_) {} });
                return;
            }
            chunks.push(d);
        });
        req.on('end', () => {
            if (aborted) return;
            try {
                fs.writeFileSync(pageFile(slug), Buffer.concat(chunks));
                console.log(new Date().toISOString(), 'published', slug, `(${size}b)`);
                send(res, 200, 'application/json', JSON.stringify({ ok: true, url: `/w/${slug}/` }));
            } catch (e) {
                console.error('write failed:', e.message);
                send(res, 500, 'application/json', JSON.stringify({ ok: false }));
            }
        });
        return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'text/plain', 'method not allowed');

    // The service worker has to be served from inside the page's own path or the
    // browser won't let it claim that scope.
    if (asset === 'sw.js')           return send(res, 200, 'text/javascript; charset=utf-8', SW_JS, { 'Cache-Control': 'no-cache' });
    if (asset === 'app.webmanifest') return send(res, 200, 'application/manifest+json', MANIFEST(slug), { 'Cache-Control': 'no-cache' });

    // ── The phone reads the page ──
    let html;
    try { html = fs.readFileSync(pageFile(slug)); }
    catch (_) { return send(res, 404, 'text/html; charset=utf-8', '<p style="font-family:sans-serif;padding:24px">Nothing published to this address yet.</p>'); }
    // no-cache, not no-store: the HTTP cache is not what keeps this page offline —
    // the service worker is — and we want a fresh copy whenever there IS a network.
    send(res, 200, 'text/html; charset=utf-8', html, { 'Cache-Control': 'no-cache' });
};

let server;
if (process.env.TLS_CERT && process.env.TLS_KEY) {
    server = https.createServer({
        cert: fs.readFileSync(process.env.TLS_CERT),
        key:  fs.readFileSync(process.env.TLS_KEY),
    }, handler);
    server.listen(PORT, '0.0.0.0', () => console.log(`Vulsor workout server on https://0.0.0.0:${PORT}  data: ${DATA_DIR}`));
} else {
    server = http.createServer(handler);
    server.listen(PORT, '0.0.0.0', () => {
        console.log(`Vulsor workout server on http://0.0.0.0:${PORT}  data: ${DATA_DIR}`);
        console.log('NOTE: no TLS. Service workers need a secure origin, so offline');
        console.log('install only works over https:// (or on localhost, for testing).');
    });
}
