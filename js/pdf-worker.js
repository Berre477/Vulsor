// ── PDF.js worker setup ──────────────────────────────────────────────
// Loaded straight after vendor/pdf.min.js, before anything can call
// getDocument(). Two things are fixed here, both of which bit us in the
// viewer with "Could not load PDF: Setting up fake worker failed":
//
//  1. Left alone, pdf.js builds its worker by wrapping workerSrc in a blob
//     that runs importScripts("file:///…/pdf.worker.min.js"). From a file://
//     page — and especially from inside app.asar in a packaged build — that
//     fetch is exactly the fragile part. We read the worker off disk ourselves
//     (fs handles asar) and hand pdf.js a blob URL of the real source, so no
//     cross-origin fetch is involved at all.
//
//  2. When a worker does die — a crash, memory pressure — pdf.js falls back to
//     running the worker code on the main thread. Its bootstrap for that loads
//     workerSrc through a <script> tag and reads window.pdfjsWorker, which is
//     never set here (the bundle is a UMD and binds to module.exports in a
//     nodeIntegration renderer). The bootstrap promise is then cached rejected,
//     so ONE dead worker made every later PDF in that window fail the same way
//     until the app was restarted. Replacing the bootstrap with one that
//     require()s the bundle makes the fallback work instead of poisoning the
//     session — the note stays open, it just parses on the main thread until
//     the next launch.
(() => {
    if (typeof pdfjsLib === 'undefined') return;

    // The worker bundle sitting next to index.html. __dirname is the page's
    // directory in a nodeIntegration renderer; fall back to the page URL.
    function workerFile() {
        const p = require('path');
        try {
            if (typeof __dirname === 'string' && __dirname) return p.join(__dirname, 'vendor', 'pdf.worker.min.js');
        } catch (_) {}
        const dir = p.dirname(decodeURIComponent(new URL(window.location.href).pathname));
        return p.join(dir, 'vendor', 'pdf.worker.min.js');
    }

    // ── 1. Serve the worker from a blob of its own source ──
    try {
        const src = require('fs').readFileSync(workerFile(), 'utf8');
        pdfjsLib.GlobalWorkerOptions.workerSrc =
            URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    } catch (e) {
        console.error('[pdf] could not inline the worker, falling back to the file path:', e);
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
    }

    // ── 2. A main-thread fallback that actually resolves ──
    // pdf.js reads this once and caches whatever it gets (shadow()), so the
    // getter loads the bundle lazily: nothing is read unless a worker dies.
    try {
        let bootstrap = null;
        Object.defineProperty(pdfjsLib.PDFWorker, '_setupFakeWorkerGlobal', {
            configurable: true,
            get() {
                if (!bootstrap) {
                    bootstrap = (async () => {
                        // require() leaves globalThis.pdfjsWorker behind, and its
                        // presence tells pdf.js to stop using real workers at all.
                        // Take the handler and put the global back as it was.
                        const had = Object.prototype.hasOwnProperty.call(globalThis, 'pdfjsWorker');
                        const mod = require(workerFile());
                        const handler = (mod && mod.WorkerMessageHandler)
                            || (globalThis.pdfjsWorker && globalThis.pdfjsWorker.WorkerMessageHandler);
                        if (!had) { try { delete globalThis.pdfjsWorker; } catch (_) {} }
                        if (!handler) throw new Error('the worker bundle exposed no WorkerMessageHandler');
                        console.warn('[pdf] worker unavailable — parsing on the main thread');
                        return handler;
                    })();
                }
                return bootstrap;
            },
        });
    } catch (e) {
        console.error('[pdf] could not install the main-thread worker fallback:', e);
    }
})();
