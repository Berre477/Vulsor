// ── PDF.js worker setup ──────────────────────────────────────────────
// Loaded straight after vendor/pdf.min.js, before anything can call
// getDocument(). Nothing here runs at startup beyond installing one lazy
// property — an earlier version read the 1MB worker bundle out of app.asar
// and inlined it as a blob when the page loaded, which segfaulted the
// renderer in a packaged build.
//
// What it fixes: when a worker dies, pdf.js falls back to running the worker
// code on the main thread. Its bootstrap for that loads workerSrc through a
// <script> tag and reads window.pdfjsWorker — and if that comes back
// undefined, the rejected promise is cached (shadow()) while PDFWorkerUtil
// latches isWorkerDisabled. One dead worker then made EVERY later PDF in the
// window fail with "Setting up fake worker failed" until the app restarted.
// The bootstrap below loads the bundle the same way and, if the global is
// still missing, require()s it — so the fallback works instead of poisoning
// the session. It parses on the main thread until the next launch, which is
// slower but keeps the viewer alive.
(() => {
    if (typeof pdfjsLib === 'undefined') return;

    pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';

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

    function handlerFromGlobal() {
        return (globalThis.pdfjsWorker && globalThis.pdfjsWorker.WorkerMessageHandler) || null;
    }

    function loadWorkerScript() {
        return new Promise((resolve, reject) => {
            const el = document.createElement('script');
            el.src     = pdfjsLib.GlobalWorkerOptions.workerSrc;
            el.onload  = () => resolve();
            el.onerror = () => reject(new Error('could not load ' + el.src));
            document.head.appendChild(el);
        });
    }

    try {
        let bootstrap = null;
        Object.defineProperty(pdfjsLib.PDFWorker, '_setupFakeWorkerGlobal', {
            configurable: true,
            get() {
                if (!bootstrap) {
                    bootstrap = (async () => {
                        console.warn('[pdf] worker unavailable — parsing on the main thread');
                        let handler = handlerFromGlobal();
                        if (!handler) {
                            try { await loadWorkerScript(); handler = handlerFromGlobal(); }
                            catch (e) { console.error('[pdf] worker script:', e); }
                        }
                        if (!handler) {
                            // The bundle is a UMD: in a nodeIntegration renderer it
                            // can bind to module.exports and leave the global unset,
                            // which is the case pdf.js does not handle.
                            const mod = require(workerFile());
                            handler = (mod && mod.WorkerMessageHandler) || handlerFromGlobal();
                        }
                        if (!handler) throw new Error('the worker bundle exposed no WorkerMessageHandler');
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
