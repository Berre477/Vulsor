// ── Cosmos starfield — loader/blitter for the C++ WebAssembly engine ────
// The animation itself (star simulation, twinkle, shooting stars, raster-
// ization) is implemented in cpp/starfield.cpp and compiled to
// js/wasm/starfield.wasm. This shim instantiates the module, then each
// animation frame copies its RGBA framebuffer onto a <canvas> overlay.
// If the wasm fails to load, the old CSS .cosmos-stars background stays.
// Depends on: globals.js (fs, path)

(function () {
    const SF_MAX_W = 2560, SF_MAX_H = 1600;  // must match cpp/starfield.cpp
    let sf = null;          // wasm exports
    let sfCanvas = null, sfCtx = null, sfImg = null;
    let sfW = 0, sfH = 0;
    let sfSeed = (Math.random() * 0xffffffff) >>> 0;

    function sfResize() {
        const w = Math.max(1, Math.min(SF_MAX_W, sfCanvas.clientWidth | 0));
        const h = Math.max(1, Math.min(SF_MAX_H, sfCanvas.clientHeight | 0));
        if (w === sfW && h === sfH) return;
        sfW = w; sfH = h;
        sfCanvas.width = w; sfCanvas.height = h;
        sf.init(w, h, sfSeed);  // same seed → same sky across resizes
        sfImg = new ImageData(w, h);
    }

    function sfFrame(t) {
        requestAnimationFrame(sfFrame);
        // Skip work while the Cosmos view is hidden
        if (!sfCanvas.isConnected || sfCanvas.offsetParent === null) return;
        sfResize();
        sf.render(t);
        const ptr = sf.framebuffer();
        sfImg.data.set(new Uint8Array(sf.memory.buffer, ptr, sfW * sfH * 4));
        sfCtx.putImageData(sfImg, 0, 0);
    }

    function sfWasmPath() {
        const candidates = [];
        if (typeof __dirname !== 'undefined') {
            candidates.push(path.join(__dirname, 'js', 'wasm', 'starfield.wasm'));
            candidates.push(path.join(__dirname, 'wasm', 'starfield.wasm'));
        }
        for (const p of candidates) {
            try { if (fs.existsSync(p)) return p; } catch (_) {}
        }
        return null;
    }

    async function sfBoot() {
        const view = document.getElementById('view-cosmos');
        if (!view) return;
        try {
            const wasmPath = sfWasmPath();
            if (!wasmPath) throw new Error('starfield.wasm not found');
            const mod = await WebAssembly.compile(fs.readFileSync(wasmPath));
            // Standalone wasm may import a few WASI stubs it never calls
            const imports = {};
            for (const d of WebAssembly.Module.imports(mod)) {
                if (!imports[d.module]) imports[d.module] = {};
                imports[d.module][d.name] = () => 0;
            }
            const inst = await WebAssembly.instantiate(mod, imports);
            sf = inst.exports;
            if (sf._initialize) sf._initialize();  // WASI reactor init

            sfCanvas = document.createElement('canvas');
            sfCanvas.className = 'cosmos-stars-canvas';
            const cssStars = view.querySelector('.cosmos-stars');
            if (cssStars) {
                cssStars.style.display = 'none';   // wasm replaces the CSS fallback
                view.insertBefore(sfCanvas, cssStars);
            } else {
                view.insertBefore(sfCanvas, view.firstChild);
            }
            sfCtx = sfCanvas.getContext('2d');
            requestAnimationFrame(sfFrame);
        } catch (e) {
            console.warn('[starfield] C++ engine unavailable, keeping CSS fallback:', e);
        }
    }

    if (document.readyState !== 'loading') sfBoot();
    else document.addEventListener('DOMContentLoaded', sfBoot);
})();
