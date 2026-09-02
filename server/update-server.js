// ══════════════════════════════════════════════════════════════
//  Vulsor update server  (run on the Ubuntu box)
//
//  Serves the contents of ./files over HTTP so every Vulsor app can
//  fetch version.json and download build archives.
//
//  Usage:   node update-server.js            (defaults: port 8479, ./files)
//  Env:     PORT=8479  FILES_DIR=/srv/vulsor  node update-server.js
//
//  Pure Node — no dependencies. Pair it with the systemd unit
//  (vulsor-update.service) so it stays running and starts on boot.
// ══════════════════════════════════════════════════════════════

const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT      = parseInt(process.env.PORT || '8479', 10);
const FILES_DIR = path.resolve(process.env.FILES_DIR || path.join(__dirname, 'files'));

const MIME = {
    '.json': 'application/json',
    '.zip':  'application/zip',
    '.gz':   'application/gzip',
    '.tgz':  'application/gzip',
    '.txt':  'text/plain',
};

if (!fs.existsSync(FILES_DIR)) fs.mkdirSync(FILES_DIR, { recursive: true });

const server = http.createServer((req, res) => {
    // Decode + strip query, prevent path traversal
    let urlPath;
    try { urlPath = decodeURIComponent(req.url.split('?')[0]); } catch (_) { res.writeHead(400); return res.end('bad request'); }
    if (urlPath === '/') urlPath = '/version.json';

    const safe = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
    const filePath = path.join(FILES_DIR, safe);
    if (!filePath.startsWith(FILES_DIR)) { res.writeHead(403); return res.end('forbidden'); }

    fs.stat(filePath, (err, st) => {
        if (err || !st.isFile()) { res.writeHead(404); return res.end('not found'); }
        const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
        res.writeHead(200, {
            'Content-Type': type,
            'Content-Length': st.size,
            'Cache-Control': 'no-cache',
            'Access-Control-Allow-Origin': '*',
        });
        const stream = fs.createReadStream(filePath);
        stream.on('error', () => { try { res.destroy(); } catch (_) {} });
        stream.pipe(res);
        console.log(new Date().toISOString(), req.socket.remoteAddress, '->', safe, `(${st.size}b)`);
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Vulsor update server on http://0.0.0.0:${PORT}  serving  ${FILES_DIR}`);
});
