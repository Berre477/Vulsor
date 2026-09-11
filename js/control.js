// ── Control API — the renderer half ────────────────────────────────────
// Answers requests that arrive on the loopback port (see control-server.js),
// so Vulsor Mind can open pages, read what is on screen, jump to an app, and
// tell this window that data on disk changed underneath it.
// Depends on: globals.js, todos.js, browser.js, main.js

(function () {
    const { ipcRenderer } = require('electron');

    // Re-read the JSON that Vulsor Mind may have just written, and repaint
    // whatever is on screen. Each part is guarded: an app that is not loaded
    // in this window must not stop the rest from refreshing.
    function reloadData(which) {
        const want = w => !which || which === 'all' || which === w;
        const done = [];

        if (want('todos')) {
            try {
                loadTodos(); loadCategories();
                if (typeof renderTodos === 'function') renderTodos();
                if (typeof renderCatFilter === 'function') renderCatFilter();
                if (typeof refreshFormSelects === 'function') refreshFormSelects();
                done.push('todos');
            } catch (e) { console.error('[control] todos reload', e); }
        }
        if (want('calendar')) {
            try {
                if (typeof loadCalendar === 'function') loadCalendar();
                if (typeof renderCalPage === 'function') renderCalPage();
                done.push('calendar');
            } catch (_) {}
        }
        if (want('vault')) {
            // vault.js already has a reload path for the other-window case.
            try { ipcRenderer.emit('vault-reload'); } catch (_) {}
            try {
                if (typeof loadVaultData === 'function') loadVaultData();
                if (typeof renderVaultFolders === 'function') renderVaultFolders();
                if (typeof renderVaultGrid === 'function') renderVaultGrid();
                done.push('vault');
            } catch (_) {}
        }
        return { ok: true, reloaded: done };
    }

    // A quiet line at the bottom of the window: Vulsor Mind did something here.
    function toast(text) {
        let el = document.getElementById('control-toast');
        if (!el) {
            el = document.createElement('div');
            el.id = 'control-toast';
            el.style.cssText = 'position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:9999;'
                + 'background:rgba(15,20,28,.96);border:1px solid rgb(var(--slate-400) / .28);color:rgb(var(--slate-200));'
                + 'font-size:12.5px;padding:9px 16px;border-radius:11px;box-shadow:0 12px 36px rgba(0,0,0,.55);'
                + 'display:flex;align-items:center;gap:9px;opacity:0;transition:opacity .18s;pointer-events:none';
            document.body.appendChild(el);
        }
        el.innerHTML = '<span style="color:#4db8ff">◆</span><span></span>';
        el.lastChild.textContent = text;
        requestAnimationFrame(() => { el.style.opacity = '1'; });
        clearTimeout(el._t);
        el._t = setTimeout(() => { el.style.opacity = '0'; }, 3600);
        return { ok: true };
    }

    async function handle(action, p) {
        switch (action) {

            case 'ping':
                return { ok: true, app: 'Vulsor Browser', view: window.appCurrentView ? window.appCurrentView() : null };

            case 'reload-data':
                return reloadData(p.what);

            case 'notify':
                return toast(String(p.text || '').slice(0, 300));

            // ── Web tabs ──
            case 'open-url': {
                const url = String(p.url || '').trim();
                if (!url) return { ok: false, error: 'no url' };
                if (typeof window.appOpenBrowserTab === 'function') {
                    window.appOpenBrowserTab(url, { background: !!p.background });
                    return { ok: true, opened: url };
                }
                return { ok: false, error: 'the browser module is not loaded in this window' };
            }

            case 'tabs':
                return { ok: true, tabs: (window.bwListTabs ? window.bwListTabs() : []) };

            case 'read-page': {
                if (!window.bwReadActive) return { ok: false, error: 'no browser tab open' };
                const page = await window.bwReadActive(p.match);
                return page ? { ok: true, ...page } : { ok: false, error: 'nothing is loaded in the active tab' };
            }

            // ── Apps inside the browser ──
            case 'open-app': {
                const key = String(p.app || '').trim();
                if (!key) return { ok: false, error: 'no app named' };
                if (typeof window.appOpenTab !== 'function') return { ok: false, error: 'tabs are not ready' };
                window.appOpenTab(key);
                return { ok: true, opened: key };
            }

            case 'apps':
                return { ok: true, apps: (window.appListApps ? window.appListApps() : []) };

            default:
                return { ok: false, error: `no such action: ${action}` };
        }
    }

    ipcRenderer.on('control', async (_e, { id, action, payload }) => {
        let result;
        try { result = await handle(action, payload || {}); }
        catch (e) { result = { ok: false, error: e.message }; }
        ipcRenderer.send(`control-reply-${id}`, result);
    });
})();
