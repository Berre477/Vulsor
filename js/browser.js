// ── Browser — embedded web browser with tabs (<webview>-based) ──────────
// Depends on: globals.js (ipcRenderer, fs, BROWSER_FILE), vault.js
// (addFilesToVault for the downloads bar).
// Each tab owns a persistent <webview> in #browser-pages; switching tabs
// toggles visibility so page state, history and media survive switches.
// Private tabs use the in-memory 'browser-private' partition — no cookies
// or history survive. Popups are denied in the main process and routed
// back here via 'browser-open-url'. Downloads are saved to ~/Downloads by
// the main process, which streams progress over 'browser-download-*'.

let _bwTabs    = [];    // [{ id, url, title, favicon, wv, loading, pendingUrl, private }]
let _bwActive  = null;
let _bwSeq     = 0;
let _bwGuestSeq = 0;    // unique suffix for each private tab's guest partition
let _bwInited  = false;
let _bwSaveTimer = null;
let _bwHistory = [];    // [{ url, title, ts }] newest first (normal tabs only)
const _BW_HISTORY_MAX = 1000;

// Previous search terms typed into the address bar (newest first).
let _bwSearches = [];
const _BW_SEARCH_MAX = 200;

// Real favicons seen while browsing (host → icon URL). These are the page's own
// declared icons — the accurate logo (e.g. NotebookLM's, Gmail's envelope) that
// favicon services don't return. Used to render home-shortcut tiles correctly.
let _bwFavCache = {};

// Address-bar autocomplete state
let _bwSugItems = [];   // [{ kind:'search'|'url', text, url? }]
let _bwSugSel   = 0;
let _bwSugSeq   = 0;    // guards against out-of-order suggestion fetches
let _bwSugTimer = null;

// User-tunable browser settings (persisted alongside tabs/history).
let _bwSettings = { saveHistory: true, savePasswords: true, engine: 'google' };

// Saved logins: [{ host, username, password, ts }]. Held in memory decrypted;
// written to disk encrypted via the main process (OS keychain / safeStorage).
let _bwPasswords = [];
let _bwPwEncrypted = true;          // false → keychain unavailable, stored as plain base64
let _bwPwNeverHosts = {};           // host → true (user clicked "Never" for save prompt)
const _BW_SEARCH = {
    google:     'https://www.google.com/search?q=',
    duckduckgo: 'https://duckduckgo.com/?q=',
    bing:       'https://www.bing.com/search?q='
};

// Strip app tokens so sites treat us like regular Chrome
const _BW_UA = navigator.userAgent.replace(/\s(vulsor-ai|Vulsor|Electron)\/[\d.]+/gi, '');

// Preload injected into every web page. Makes the spoofed Firefox identity on
// Google auth hosts internally consistent (see js/browser-preload.js), so
// Google's "this browser may not be secure" block is avoided.
const _BW_PRELOAD = (() => {
    try { return pathToFileURL(path.join(__dirname, 'js', 'browser-preload.js')).href; }
    catch (_) { return null; }
})();

// ── Persistence (open tabs + history survive restarts) ──────────────────
function _bwSave() {
    clearTimeout(_bwSaveTimer);
    _bwSaveTimer = setTimeout(() => {
        try {
            const pub = _bwTabs.filter(t => !t.private);
            const tabs = pub.map(t => t.url || t.pendingUrl || '').filter(Boolean);
            const activeIdx = Math.max(0, pub.findIndex(t => t.id === _bwActive));
            writeJsonSafe(BROWSER_FILE, { tabs, activeIdx, history: _bwHistory, searches: _bwSearches, favicons: _bwFavCache, settings: _bwSettings, neverHosts: _bwPwNeverHosts });
        } catch (_) {}
    }, 400);
}
function _bwLoadSaved() {
    try {
        if (fs.existsSync(BROWSER_FILE)) return readJsonStrict(BROWSER_FILE);
    } catch (_) {}
    return null;
}

// Load persisted history, settings and saved passwords once. Runs from either
// entry point — opening the browser, or the Settings page directly — so the
// Settings page works even if the browser view was never opened this session.
let _bwLoaded = false;
function _bwEnsureLoaded() {
    if (_bwLoaded) return;
    _bwLoaded = true;
    const saved = _bwLoadSaved();
    if (saved && Array.isArray(saved.history)) _bwHistory = saved.history.slice(0, _BW_HISTORY_MAX);
    if (saved && Array.isArray(saved.searches)) _bwSearches = saved.searches.slice(0, _BW_SEARCH_MAX);
    if (saved && saved.favicons && typeof saved.favicons === 'object') _bwFavCache = saved.favicons;
    if (saved && saved.settings) _bwSettings = Object.assign(_bwSettings, saved.settings);
    if (saved && saved.neverHosts) _bwPwNeverHosts = saved.neverHosts;
    _bwLoadPasswords().then(() => { _bwUpdatePwLock('pop'); _bwUpdatePwLock('page'); });
}

// ── URL handling ─────────────────────────────────────────────────────────
function _bwResolveInput(q) {
    q = (q || '').trim();
    if (!q) return null;
    if (/^(https?|file):\/\//i.test(q) || q === 'about:blank') return q;
    // Looks like a host (no spaces + a dot or localhost) → treat as URL
    if (!/\s/.test(q) && (/^[\w-]+(\.[\w-]+)+(:\d+)?([/?#]|$)/.test(q) || /^localhost(:\d+)?([/?#]|$)/.test(q)))
        return 'https://' + q;
    return (_BW_SEARCH[_bwSettings.engine] || _BW_SEARCH.google) + encodeURIComponent(q);
}
function _bwHost(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch (_) { return url; }
}
function _bwEsc(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// ── Tabs ─────────────────────────────────────────────────────────────────
// Web tabs are now top-level app tabs: main.js owns the tab strip and drives
// the webview here via the bridge (bwCreateWebview / bwActivate / bwDestroy).
// Each web tab's id is the bwId stored on the matching app tab's instanceData.

// Register a webview-backed tab (the actual <webview> is created lazily on
// first activation). `url` may be a raw omnibox query — resolved here.
window.bwCreateWebview = function (id, url, isPrivate) {
    if (_bwTabs.find(t => t.id === id)) return;
    // Each private tab gets its own throwaway, non-persistent partition so it
    // starts as a clean guest: no cookies or sign-ins carry over from the
    // normal browsing session, nor between separate private tabs.
    const partition = isPrivate ? ('browser-guest-' + (++_bwGuestSeq)) : 'persist:browser';
    _bwTabs.push({ id, url: '', title: isPrivate ? 'Private Tab' : 'New Tab',
                   favicon: null, wv: null, loading: false, partition,
                   pendingUrl: url ? (_bwResolveInput(url) || url) : '', private: !!isPrivate });
};

// Make this web tab visible (lazily creating its <webview>) and sync the
// toolbar. Called by main.js whenever its top-level tab becomes active.
window.bwActivate = function (id) { _bwActivate(id); };

// Tear down a web tab's <webview>. Called by main.js when its tab is closed.
window.bwDestroy = function (id) {
    const idx = _bwTabs.findIndex(t => t.id === id);
    if (idx === -1) return;
    const tab = _bwTabs[idx];
    if (tab.wv) { try { tab.wv.remove(); } catch (_) {} }
    _bwTabs.splice(idx, 1);
    if (_bwActive === id) _bwActive = null;
    _bwSave();
};

// Metadata main.js uses to render the web tab's chip (title, favicon, …).
window.bwMeta = function (id) {
    const t = _bwTabs.find(x => x.id === id);
    if (!t) return null;
    return { title: t.title, favicon: t.favicon, loading: t.loading, private: t.private, url: t.url };
};

// Snapshot enough state to re-create this web tab in another window. The live
// <webview> can't cross renderers, so a moved/torn browser tab is rebuilt from
// its URL on the other side. Falls back to a not-yet-loaded pendingUrl.
window.bwTabSnapshot = function (id) {
    const t = _bwTabs.find(x => x.id === id);
    if (!t) return null;
    return { url: t.url || t.pendingUrl || '', private: !!t.private };
};

function _bwActivate(id) {
    const tab = _bwTabs.find(t => t.id === id);
    if (!tab) return;
    _bwActive = id;
    // Lazily create the webview for restored/queued tabs
    if (!tab.wv && tab.pendingUrl) {
        const u = tab.pendingUrl; tab.pendingUrl = '';
        _bwNavigate(tab, u);
    }
    _bwTabs.forEach(t => { if (t.wv) t.wv.style.visibility = t.id === id ? 'visible' : 'hidden'; });
    const start = document.getElementById('browser-start');
    if (start) start.style.display = tab.wv ? 'none' : 'flex';
    _bwHideError(); _bwHidePanels();
    _bwScheduleUi();
    if (!tab.wv) setTimeout(() => document.getElementById('browser-url')?.focus(), 30);
    _bwSave();
}

function _bwActiveTab() { return _bwTabs.find(t => t.id === _bwActive) || null; }

// Coalesce chrome updates: webview events arrive in bursts (loading state,
// title, favicon, navigation) — render the tab strip + toolbar at most once
// per frame instead of rebuilding the DOM for every event.
let _bwUiRaf = 0;
function _bwScheduleUi() {
    if (_bwUiRaf) return;
    _bwUiRaf = requestAnimationFrame(() => {
        _bwUiRaf = 0;
        // Web tabs live in the top-level app strip — ask main.js to repaint it.
        if (typeof window.appRenderTabStrip === 'function') window.appRenderTabStrip();
        _bwSyncToolbar();
    });
}

// ── History ──────────────────────────────────────────────────────────────
function _bwRecordHistory(tab, url) {
    if (tab.private || !_bwSettings.saveHistory || !/^https?:/i.test(url)) return;
    if (_bwHistory[0] && _bwHistory[0].url === url) return;   // consecutive dupe
    _bwHistory.unshift({ url, title: tab.title || _bwHost(url), ts: Date.now() });
    if (_bwHistory.length > _BW_HISTORY_MAX) _bwHistory.length = _BW_HISTORY_MAX;
}

// ── Webview lifecycle ────────────────────────────────────────────────────
function _bwNavigate(tab, url) {
    if (!tab.wv) {
        const wv = document.createElement('webview');
        wv.setAttribute('partition', tab.partition || (tab.private ? 'browser-private' : 'persist:browser'));
        wv.setAttribute('allowpopups', '');      // intercepted in main → new tab here
        wv.setAttribute('useragent', _BW_UA);
        // contextIsolation=no → the preload's navigator overrides reach the
        // page's own JS world (needed for the Google sign-in fingerprint fix).
        // disableDialogs=yes: Chromium suppresses ALL alert()/confirm()/prompt()
        //   dialogs from the page AND its cross-origin iframes (e.g. the fake
        //   "vidnest.fun — Please confirm to continue" modal). This is the only
        //   reliable way to kill native dialogs an embed iframe throws.
        // nodeIntegrationInSubFrames=yes runs our preload in those iframes too
        //   (without granting Node) for the overlay/popup guards.
        wv.setAttribute('webpreferences', 'v8CacheOptions=code,contextIsolation=no,nodeIntegrationInSubFrames=yes,disableDialogs=yes');
        if (_BW_PRELOAD) wv.setAttribute('preload', _BW_PRELOAD);
        wv.style.cssText = 'position:absolute; inset:0; width:100%; height:100%; visibility:hidden;';
        tab.wv = wv;
        _bwWireWebview(tab, wv);
        wv.src = url;
        document.getElementById('browser-pages').appendChild(wv);
    } else if (tab.wv._domReady) {
        try { tab.wv.loadURL(url).catch(() => {}); } catch (_) {}
    } else {
        // Guest process still initializing — queue, applied on dom-ready
        tab.wv._pendingNav = url;
    }
    tab.url = url;
    tab.title = _bwHost(url);
    if (tab.id === _bwActive) {
        tab.wv.style.visibility = 'visible';
        const start = document.getElementById('browser-start');
        if (start) start.style.display = 'none';
    }
    _bwHideError();
    _bwScheduleUi();
}

function _bwWireWebview(tab, wv) {
    wv.addEventListener('dom-ready', () => {
        wv._domReady = true;
        if (wv._pendingNav) {
            const u = wv._pendingNav; wv._pendingNav = null;
            try { wv.loadURL(u).catch(() => {}); } catch (_) {}
        }
    });
    wv.addEventListener('did-start-loading', () => {
        tab.loading = true; _bwHideError(); _bwScheduleUi();
    });
    wv.addEventListener('did-stop-loading', () => {
        tab.loading = false;
        // page-title-updated is unreliable on <webview> — read it directly
        try {
            const t = wv.getTitle && wv.getTitle();
            if (t) {
                tab.title = t;
                const h = _bwHistory.find(x => x.url === tab.url);
                if (h && !tab.private && h.title !== t) { h.title = t; _bwSave(); }
            }
        } catch (_) {}
        // Password autofill + capture hook for this freshly-loaded page
        _bwInstallCapture(tab);
        _bwAutofillOnLoad(tab);
        _bwScheduleUi();
    });
    wv.addEventListener('page-title-updated', e => {
        tab.title = e.title || tab.title;
        // Backfill the title on the matching history entry
        const h = _bwHistory.find(x => x.url === tab.url);
        if (h && !tab.private) { h.title = tab.title; _bwSave(); }
        _bwScheduleUi();
    });
    wv.addEventListener('page-favicon-updated', e => {
        tab.favicon = (e.favicons && e.favicons[0]) || null;
        // Remember the real per-site logo for the home shortcuts (normal tabs
        // only). Accept data: URLs too — SPAs like NotebookLM set their favicon
        // to an inline data: image via JavaScript.
        if (tab.favicon && !tab.private && /^https?:/i.test(tab.url || '') && /^(https?|data):/i.test(tab.favicon)) {
            const h = _bwHost(tab.url);
            if (h && _bwFavCache[h] !== tab.favicon) {
                _bwFavCache[h] = tab.favicon;
                _bwSave();
                if (typeof window.rebuildHomePage === 'function') window.rebuildHomePage();
            }
        }
        _bwScheduleUi();
    });
    // NOTE: 'did-navigate' / 'load-commit' do not fire on <webview> in this
    // Electron build (verified empirically) — 'did-start-navigation' does.
    const onNav = e => {
        if (e.isMainFrame === false || !e.url || !/^https?:/i.test(e.url)) return;
        // A main-frame navigation likely means a login form was submitted —
        // offer to save whatever was typed on the page we're leaving.
        if (!tab.private && tab.url && _bwHost(tab.url) !== _bwHost(e.url)) _bwOnNavCapture();
        tab.url = e.url;
        _bwRecordHistory(tab, e.url);
        _bwScheduleUi(); _bwSave();
    };
    wv.addEventListener('did-start-navigation', onNav);
    wv.addEventListener('did-redirect-navigation', onNav);
    wv.addEventListener('did-navigate', onNav);
    wv.addEventListener('did-navigate-in-page', onNav);
    // Chromium's net error codes, translated for the banner. Anything not
    // listed falls back to Chromium's own description.
    const NET_ERRORS = {
        '-105': 'That address couldn\'t be found — check the spelling.',
        '-106': 'You\'re offline. The page will load once you\'re connected again.',
        '-118': 'The site took too long to respond.',
        '-7':   'The site took too long to respond.',
        '-102': 'The site refused the connection.',
        '-100': 'The connection was closed before the page loaded.',
        '-101': 'The connection was reset by the site.',
        '-109': 'That address is unreachable from this network.',
        '-200': 'This site\'s security certificate isn\'t valid.',
        '-201': 'This site\'s security certificate has expired or isn\'t valid yet.',
        '-202': 'This site\'s security certificate isn\'t trusted.',
        '-501': 'This site\'s security certificate has a problem.',
        '-20':  'This page was blocked.',
        '-27':  'This page was blocked by the content blocker.',
        '-137': 'The site\'s address could not be resolved right now.',
        '-324': 'The site sent back an empty response.',
        '-310': 'Too many redirects.',
    };
    wv.addEventListener('did-fail-load', e => {
        // -3 = aborted (e.g. user navigated away mid-load) — not an error
        if (!e.isMainFrame || e.errorCode === -3) return;
        tab.loading = false;
        const friendly = navigator.onLine === false
            ? NET_ERRORS['-106']
            : (NET_ERRORS[String(e.errorCode)] || `${e.errorDescription || 'The page could not be loaded'} (${e.errorCode})`);
        let host = '';
        try { host = new URL(e.validatedURL || tab.url).hostname; } catch (_) {}
        _bwShowError(tab, host ? `${host}: ${friendly}` : friendly);
        _bwScheduleUi();
    });
    // Render process died — show a recoverable error instead of a blank tab.
    wv.addEventListener('render-process-gone', e => {
        tab.loading = false;
        const reason = (e && e.reason) || 'crashed';
        _bwShowError(tab, reason === 'killed'
            ? 'This tab was stopped to free memory — click Retry to reload it.'
            : `This page crashed (${reason}) — click Retry to reload it.`);
        _bwScheduleUi();
    });
    // Legacy crash event (older Electron) — harmless to also listen for.
    wv.addEventListener('crashed', () => {
        tab.loading = false;
        _bwShowError(tab, 'This page crashed — click Retry to reload it.');
        _bwScheduleUi();
    });
    // Page hung (infinite loop / stuck script). Offer a reload rather than
    // leaving the whole tab frozen with no feedback.
    wv.addEventListener('unresponsive', () => {
        _bwShowError(tab, 'This page has become unresponsive — click Retry to reload, or wait for it to recover.');
    });
    wv.addEventListener('responsive', () => { if (tab.id === _bwActive) _bwHideError(); });
    // HTML5 fullscreen inside the page (e.g. a video's fullscreen button). The
    // <webview> only fills the area below the tab strip + toolbar, so on its own
    // the chrome stays visible over the "fullscreen" video. Hide the chrome and
    // let the page cover the whole window (and the display) while it lasts.
    wv.addEventListener('enter-html-full-screen', _bwEnterHtmlFullscreen);
    wv.addEventListener('leave-html-full-screen', _bwExitHtmlFullscreen);
}

function _bwEnterHtmlFullscreen() {
    document.body.classList.add('browser-fullscreen');
    try { ipcRenderer.send('browser-html-fullscreen', true); } catch (_) {}
}
function _bwExitHtmlFullscreen() {
    document.body.classList.remove('browser-fullscreen');
    try { ipcRenderer.send('browser-html-fullscreen', false); } catch (_) {}
}

// ── Error banner ─────────────────────────────────────────────────────────
function _bwShowError(tab, msg) {
    if (tab.id !== _bwActive) return;
    const el = document.getElementById('browser-error');
    if (!el) return;
    document.getElementById('browser-error-msg').textContent = msg;
    el.style.display = 'flex';
}
function _bwHideError() {
    const el = document.getElementById('browser-error');
    if (el) el.style.display = 'none';
}

// ── Toolbar / tab strip rendering ───────────────────────────────────────
function _bwSyncToolbar() {
    const tab = _bwActiveTab();
    const urlEl = document.getElementById('browser-url');
    const icon  = document.getElementById('browser-secure');
    const back  = document.getElementById('browser-back');
    const fwd   = document.getElementById('browser-fwd');
    const rld   = document.getElementById('browser-reload');
    if (urlEl && document.activeElement !== urlEl) urlEl.value = tab ? (tab.url || '') : '';
    if (urlEl) urlEl.placeholder = tab && tab.private ? 'Private tab — search or enter address' : 'Search or enter address';
    if (icon) {
        const https = tab && /^https:/i.test(tab.url || '');
        icon.className = `fas ${tab && tab.url ? (https ? 'fa-lock' : 'fa-lock-open') : 'fa-magnifying-glass'}`;
        icon.style.color = https ? '#34d399' : '#64748b';
    }
    // canGoBack()/canGoForward() call getWebContentsId() internally, which THROWS
    // ("The WebView must be attached to the DOM and the dom-ready event emitted
    // before this method can be called") if the <webview> isn't dom-ready yet.
    // _bwScheduleUi() runs on the very next frame after the webview is created —
    // before dom-ready — so guard on _domReady and swallow any late error, or the
    // throw bubbles up to the global handler and shows the "Something went wrong"
    // toast on every site you open.
    let canBack = false, canFwd = false;
    try {
        if (tab && tab.wv && tab.wv._domReady) {
            canBack = !!(tab.wv.canGoBack && tab.wv.canGoBack());
            canFwd  = !!(tab.wv.canGoForward && tab.wv.canGoForward());
        }
    } catch (_) {}
    if (back) { back.style.opacity = canBack ? '1' : '0.35'; back.style.pointerEvents = canBack ? '' : 'none'; }
    if (fwd)  { fwd.style.opacity  = canFwd  ? '1' : '0.35'; fwd.style.pointerEvents  = canFwd  ? '' : 'none'; }
    if (rld)  rld.innerHTML = tab && tab.loading
        ? '<i class="fas fa-xmark"></i>'
        : '<i class="fas fa-arrow-rotate-right"></i>';
}

// ── History & site-info panels ───────────────────────────────────────────
function _bwHidePanels() {
    ['browser-history', 'browser-siteinfo', 'browser-settings', 'browser-passwords', 'browser-suggest'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
}

function _bwToggleHistory() {
    const panel = document.getElementById('browser-history');
    if (!panel) return;
    const open = panel.style.display !== 'none';
    _bwHidePanels();
    if (open) return;
    panel.style.display = 'flex';
    const q = document.getElementById('browser-history-search');
    if (q) { q.value = ''; setTimeout(() => q.focus(), 30); }
    _bwRenderHistory('pop');
}

// Render the history list into either the in-browser popover ('pop') or the
// full Settings page ('page'); both read data from the same _bwHistory.
function _bwRenderHistory(scope) {
    scope = scope || 'pop';
    const onPage   = scope === 'page';
    const listId   = onPage ? 'sp-history-list'   : 'browser-history-list';
    const searchId = onPage ? 'sp-history-search' : 'browser-history-search';
    const list = document.getElementById(listId);
    if (!list) return;
    const f = (document.getElementById(searchId)?.value || '').toLowerCase();
    if (onPage) {
        const c = document.getElementById('sp-history-count');
        if (c) c.textContent = _bwHistory.length ? `· ${_bwHistory.length}` : '';
    }
    const items = _bwHistory.filter(h => !f || (h.title || '').toLowerCase().includes(f) || h.url.toLowerCase().includes(f)).slice(0, 250);
    if (!items.length) {
        list.innerHTML = `<p class="text-slate-500 text-xs text-center py-6">${_bwHistory.length ? 'No matches.' : 'No history yet.'}</p>`;
        return;
    }
    const fmt = ts => {
        const d = new Date(ts), today = new Date();
        const sameDay = d.toDateString() === today.toDateString();
        return sameDay ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                       : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    };
    list.innerHTML = items.map((h, i) => `
        <div class="bw-hist-item" data-i="${i}" title="${_bwEsc(h.url)}">
            <span class="bw-hist-time">${fmt(h.ts)}</span>
            <span class="bw-hist-title">${_bwEsc(h.title || _bwHost(h.url))}</span>
            <span class="bw-hist-host">${_bwEsc(_bwHost(h.url))}</span>
        </div>`).join('');
    list.querySelectorAll('.bw-hist-item').forEach(el =>
        el.addEventListener('click', () => {
            const h = items[el.dataset.i | 0];
            if (h && window.appOpenBrowserTab) { _bwHidePanels(); window.appOpenBrowserTab(h.url, { background: false }); }
        }));
}
function _bwRenderHistoryAll() { _bwRenderHistory('pop'); _bwRenderHistory('page'); }

function _bwToggleSiteInfo() {
    const panel = document.getElementById('browser-siteinfo');
    if (!panel) return;
    const open = panel.style.display !== 'none';
    _bwHidePanels();
    if (open) return;
    const tab = _bwActiveTab();
    const st = document.getElementById('browser-siteinfo-status');
    const ho = document.getElementById('browser-siteinfo-host');
    if (!tab || !tab.url) {
        if (st) { st.innerHTML = '<i class="fas fa-magnifying-glass mr-1.5"></i>No page loaded'; st.style.color = '#94a3b8'; }
        if (ho) ho.textContent = '';
    } else if (/^https:/i.test(tab.url)) {
        if (st) { st.innerHTML = '<i class="fas fa-lock mr-1.5"></i>Connection is secure'; st.style.color = '#34d399'; }
        if (ho) ho.textContent = `${_bwHost(tab.url)} — traffic is encrypted (HTTPS).${tab.private ? ' Private guest tab: separate from your normal sign-ins; cookies are discarded when it closes.' : ''}`;
    } else {
        if (st) { st.innerHTML = '<i class="fas fa-lock-open mr-1.5"></i>Connection is not secure'; st.style.color = '#fbbf24'; }
        if (ho) ho.textContent = `${_bwHost(tab.url)} — this page uses unencrypted HTTP. Avoid entering passwords or card details here.`;
    }
    panel.style.display = 'flex';
}

async function _bwClearBrowsingData(btn) {
    const orig = btn ? btn.innerHTML : '';
    if (btn) btn.innerHTML = '<i class="fas fa-circle-notch fa-spin mr-1.5"></i>Clearing…';
    try { await ipcRenderer.invoke('browser-clear-data'); } catch (_) {}
    _bwHistory = [];
    _bwSave();
    _bwRenderHistoryAll();
    if (btn) { btn.innerHTML = '<i class="fas fa-check mr-1.5"></i>Cleared'; setTimeout(() => btn.innerHTML = orig, 1500); }
}

// ── Password manager ──────────────────────────────────────────────────────
async function _bwLoadPasswords() {
    try {
        if (!fs.existsSync(PASSWORDS_FILE)) return;
        const raw = readJsonStrict(PASSWORDS_FILE);
        if (raw.enc && raw.blob) {
            const res = await ipcRenderer.invoke('secure-decrypt', raw.blob);
            if (res && res.available && res.data) { _bwPasswords = JSON.parse(res.data) || []; _bwPwEncrypted = true; }
        } else if (raw.plain) {
            _bwPasswords = JSON.parse(Buffer.from(raw.plain, 'base64').toString('utf8')) || [];
            _bwPwEncrypted = false;
        }
    } catch (_) {}
}

async function _bwSavePasswords() {
    try {
        const json = JSON.stringify(_bwPasswords);
        const res = await ipcRenderer.invoke('secure-encrypt', json);
        if (res && res.available && res.data) {
            _bwPwEncrypted = true;
            writeJsonSafe(PASSWORDS_FILE, { enc: true, blob: res.data });
        } else {
            // Keychain unavailable — store base64 (NOT secure) and flag it in the UI.
            _bwPwEncrypted = false;
            writeJsonSafe(PASSWORDS_FILE, { enc: false, plain: Buffer.from(json, 'utf8').toString('base64') });
        }
    } catch (e) { console.error('[browser] password save failed:', e); }
}

// Element-id map for the two password UIs: the in-browser popover ('pop')
// and the full Settings page ('page').
function _pwIds(scope) {
    return scope === 'page'
        ? { form: 'sp-pw-form', site: 'sp-pw-site', user: 'sp-pw-user', pass: 'sp-pw-pass', search: 'sp-pw-search', list: 'sp-pw-list', lock: 'sp-pw-lock' }
        : { form: 'browser-pw-form', site: 'browser-pw-site', user: 'browser-pw-user', pass: 'browser-pw-pass', search: 'browser-pw-search', list: 'browser-pw-list', lock: 'browser-pw-lock' };
}

function _bwUpdatePwLock(scope) {
    const lock = document.getElementById(_pwIds(scope).lock);
    if (!lock) return;
    lock.innerHTML = _bwPwEncrypted
        ? '<i class="fas fa-lock mr-1"></i>Encrypted'
        : '<i class="fas fa-triangle-exclamation mr-1"></i>Not encrypted';
    lock.style.cssText = _bwPwEncrypted
        ? 'background:rgba(52,211,153,0.15); color:rgb(var(--tw-emerald-400))'
        : 'background:rgba(251,191,36,0.15); color:rgb(var(--tw-amber-400))';
}

function _bwTogglePasswords() {
    const panel = document.getElementById('browser-passwords');
    if (!panel) return;
    const open = panel.style.display !== 'none';
    _bwHidePanels();
    if (open) return;
    _bwPwHideForm('pop');
    const q = document.getElementById('browser-pw-search');
    if (q) q.value = '';
    _bwRenderPasswords('pop');
    _bwUpdatePwLock('pop');
    panel.style.display = 'flex';
}

function _bwRenderPasswords(scope) {
    scope = scope || 'pop';
    const ids = _pwIds(scope);
    const list = document.getElementById(ids.list);
    if (!list) return;
    const f = (document.getElementById(ids.search)?.value || '').toLowerCase();
    const rows = _bwPasswords
        .map((e, i) => ({ e, i }))
        .filter(({ e }) => !f || (e.host || '').toLowerCase().includes(f) || (e.username || '').toLowerCase().includes(f));
    if (!rows.length) {
        list.innerHTML = `<p class="text-slate-500 text-xs text-center py-6">${_bwPasswords.length ? 'No matches.' : 'No saved passwords yet.'}</p>`;
        return;
    }
    const hasTab = !!(_bwActiveTab() && _bwActiveTab().wv);
    list.innerHTML = rows.map(({ e, i }) => `
        <div class="bw-pw-item" data-i="${i}">
            <div class="bw-pw-fav">${_bwEsc((e.host || '?')[0].toUpperCase())}</div>
            <div class="bw-pw-main">
                <div class="bw-pw-host">${_bwEsc(e.host)}</div>
                <div class="bw-pw-user">${_bwEsc(e.username || '—')}</div>
                <div class="bw-pw-dots" data-pw="0">••••••••</div>
            </div>
            ${hasTab ? `<button class="bw-pw-btn" data-act="fill" title="Fill on current page"><i class="fas fa-wand-magic-sparkles"></i></button>` : ''}
            <button class="bw-pw-btn" data-act="reveal" title="Show/hide password"><i class="fas fa-eye"></i></button>
            <button class="bw-pw-btn" data-act="copy" title="Copy password"><i class="fas fa-copy"></i></button>
            <button class="bw-pw-btn danger" data-act="del" title="Delete"><i class="fas fa-trash"></i></button>
        </div>`).join('');
    list.querySelectorAll('.bw-pw-item').forEach(el => {
        const idx = el.dataset.i | 0;
        const entry = _bwPasswords[idx];
        el.querySelectorAll('[data-act]').forEach(btn => btn.addEventListener('click', ev => {
            ev.stopPropagation();
            const act = btn.dataset.act;
            if (act === 'reveal') {
                const dots = el.querySelector('.bw-pw-dots');
                const shown = dots.dataset.pw === '1';
                dots.dataset.pw = shown ? '0' : '1';
                dots.textContent = shown ? '••••••••' : (entry.password || '');
                btn.innerHTML = shown ? '<i class="fas fa-eye"></i>' : '<i class="fas fa-eye-slash"></i>';
            } else if (act === 'copy') {
                try { navigator.clipboard.writeText(entry.password || ''); } catch (_) {}
                btn.innerHTML = '<i class="fas fa-check"></i>';
                setTimeout(() => { btn.innerHTML = '<i class="fas fa-copy"></i>'; }, 1200);
            } else if (act === 'fill') {
                _bwPwFillCurrent(entry);
                _bwHidePanels();
            } else if (act === 'del') {
                _bwPasswords.splice(idx, 1);
                _bwSavePasswords();
                _bwRenderPwAll();
            }
        }));
    });
}
function _bwRenderPwAll() { _bwRenderPasswords('pop'); _bwRenderPasswords('page'); }

function _bwPwShowForm(prefill, scope) {
    const ids = _pwIds(scope);
    const form = document.getElementById(ids.form);
    if (!form) return;
    document.getElementById(ids.site).value = (prefill && prefill.host) || '';
    document.getElementById(ids.user).value = (prefill && prefill.username) || '';
    document.getElementById(ids.pass).value = (prefill && prefill.password) || '';
    form.style.display = 'block';
    document.getElementById(ids.site).focus();
}
function _bwPwHideForm(scope) {
    const form = document.getElementById(_pwIds(scope).form);
    if (form) form.style.display = 'none';
}

function _bwPwSaveFromForm(scope) {
    const ids = _pwIds(scope);
    const host = (document.getElementById(ids.site).value || '').trim();
    const username = (document.getElementById(ids.user).value || '').trim();
    const password = document.getElementById(ids.pass).value || '';
    if (!host || !password) { document.getElementById(ids.site).focus(); return; }
    _bwPwUpsert(_bwHost(host.includes('://') ? host : 'https://' + host), username, password);
    _bwPwHideForm(scope);
    _bwRenderPwAll();
}

// Render/sync the full Settings page from the shared browser state.
window.renderSettingsPage = function () {
    _bwEnsureLoaded();
    // Privacy & Search controls
    const h = document.getElementById('sp-savehist');
    const p = document.getElementById('sp-savepw');
    const e = document.getElementById('sp-engine');
    if (h) h.checked = !!_bwSettings.saveHistory;
    if (p) p.checked = !!_bwSettings.savePasswords;
    if (e) e.value = _bwSettings.engine || 'google';
    _bwPwHideForm('page');
    _bwRenderHistory('page');
    _bwRenderPasswords('page');
    _bwUpdatePwLock('page');
    _bwSyncAdblockUi();
    _bwWireSettingsPage();
};

// Reflect the main-process ad/popup-block state into the Settings toggles.
function _bwSyncAdblockUi() {
    ipcRenderer.invoke('adblock:get').then(s => {
        if (!s) return;
        const ab = document.getElementById('sp-adblock');
        const pb = document.getElementById('sp-popup');
        const abc = document.getElementById('sp-adblock-count');
        const pbc = document.getElementById('sp-popup-count');
        if (ab) ab.checked = !!s.enabled;
        if (pb) pb.checked = !!s.popupBlock;
        if (abc) abc.textContent = s.count ? `· ${s.count.toLocaleString()} blocked` : '';
        if (pbc) pbc.textContent = s.popupCount ? `· ${s.popupCount.toLocaleString()} blocked` : '';
    }).catch(() => {});
}

// One-time event wiring for the full Settings page.
let _bwPageWired = false;
function _bwWireSettingsPage() {
    if (_bwPageWired) return;
    _bwPageWired = true;
    document.getElementById('sp-adblock')?.addEventListener('change', ev => ipcRenderer.invoke('adblock:set', { enabled: ev.target.checked }).catch(() => {}));
    document.getElementById('sp-popup')?.addEventListener('change', ev => ipcRenderer.invoke('adblock:set', { popupBlock: ev.target.checked }).catch(() => {}));
    document.getElementById('sp-savehist')?.addEventListener('change', ev => { _bwSettings.saveHistory = ev.target.checked; _bwSave(); });
    document.getElementById('sp-savepw')?.addEventListener('change', ev => { _bwSettings.savePasswords = ev.target.checked; _bwSave(); });
    document.getElementById('sp-engine')?.addEventListener('change', ev => { _bwSettings.engine = ev.target.value; _bwSave(); });
    document.getElementById('sp-cleardata')?.addEventListener('click', ev => _bwClearBrowsingData(ev.currentTarget));
    document.getElementById('sp-history-search')?.addEventListener('input', () => _bwRenderHistory('page'));
    document.getElementById('sp-history-clear')?.addEventListener('click', () => { _bwHistory = []; _bwSave(); _bwRenderHistory('page'); });
    document.getElementById('sp-pw-search')?.addEventListener('input', () => _bwRenderPasswords('page'));
    document.getElementById('sp-pw-add-btn')?.addEventListener('click', () => {
        const form = document.getElementById('sp-pw-form');
        if (form && form.style.display !== 'none') _bwPwHideForm('page');
        else _bwPwShowForm({ host: _bwActiveTab() && _bwActiveTab().url ? _bwHost(_bwActiveTab().url) : '' }, 'page');
    });
    document.getElementById('sp-pw-cancel')?.addEventListener('click', () => _bwPwHideForm('page'));
    document.getElementById('sp-pw-save')?.addEventListener('click', () => _bwPwSaveFromForm('page'));
    document.getElementById('sp-pw-pass')?.addEventListener('keydown', ev => { if (ev.key === 'Enter') _bwPwSaveFromForm('page'); });
}

// Insert or update a credential, keyed by host + username.
function _bwPwUpsert(host, username, password) {
    const ex = _bwPasswords.find(e => e.host === host && (e.username || '') === (username || ''));
    if (ex) { ex.password = password; ex.ts = Date.now(); }
    else _bwPasswords.unshift({ host, username, password, ts: Date.now() });
    _bwSavePasswords();
}

// Fill a saved credential into the active page's login form.
function _bwPwFillCurrent(entry) {
    const tab = _bwActiveTab();
    if (!tab || !tab.wv) return;
    const u = JSON.stringify(entry.username || ''), p = JSON.stringify(entry.password || '');
    const code = `(function(){try{
        var U=${u},P=${p};
        var pws=[].slice.call(document.querySelectorAll('input[type=password]')).filter(function(e){return e.offsetParent!==null;});
        var pw=pws[0]; if(!pw) return 'nofield';
        function sv(el,v){var d=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value');d.set.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));}
        var scope=pw.form||document;
        var cands=[].slice.call(scope.querySelectorAll('input')).filter(function(e){var t=(e.type||'').toLowerCase();return ['text','email','tel',''].indexOf(t)>=0&&e.offsetParent!==null;});
        var uf=null;for(var i=0;i<cands.length;i++){if(cands[i].compareDocumentPosition(pw)&Node.DOCUMENT_POSITION_FOLLOWING)uf=cands[i];}
        if(uf&&U)sv(uf,U); sv(pw,P); pw.focus(); return 'ok';
    }catch(e){return 'err';}})()`;
    try { tab.wv.executeJavaScript(code).catch(() => {}); } catch (_) {}
}

// ── Password autofill + capture (best-effort, host-driven) ────────────────
// Injected into each page after load: records the latest typed credential on
// window.__vulsor_cap so the host can offer to save it (read by the poller).
const _BW_CAPTURE_JS = `(function(){if(window.__vulsor_cap_on)return;window.__vulsor_cap_on=true;window.__vulsor_cap=null;
    document.addEventListener('input',function(ev){try{var t=ev.target;if(!t||t.tagName!=='INPUT')return;if((t.type||'').toLowerCase()!=='password'||!t.value)return;
        var scope=t.form||document;var c=[].slice.call(scope.querySelectorAll('input')).filter(function(e){var y=(e.type||'').toLowerCase();return ['text','email','tel',''].indexOf(y)>=0;});
        var uf=null;for(var i=0;i<c.length;i++){if(c[i].compareDocumentPosition(t)&Node.DOCUMENT_POSITION_FOLLOWING)uf=c[i];}
        window.__vulsor_cap={u:uf?uf.value:'',p:t.value};}catch(e){}},true);})()`;

let _bwPendingCap = null;   // { host, u, p } — latest typed creds, awaiting a submit/navigation
let _bwCapTimer = null;

function _bwInstallCapture(tab) {
    if (!tab || !tab.wv || tab.private) return;
    try { tab.wv.executeJavaScript(_BW_CAPTURE_JS).catch(() => {}); } catch (_) {}
}

// Auto-fill when exactly one saved login matches the page host.
function _bwAutofillOnLoad(tab) {
    if (!tab || !tab.wv || tab.private || !tab.url) return;
    if (tab._filledUrl === tab.url) return;
    tab._filledUrl = tab.url;
    const host = _bwHost(tab.url);
    const matches = _bwPasswords.filter(e => e.host === host);
    if (matches.length === 1) _bwPwFillCurrent(matches[0]);
}

function _bwStartCapturePoll() {
    if (_bwCapTimer) return;
    _bwCapTimer = setInterval(async () => {
        const tab = _bwActiveTab();
        if (!tab || !tab.wv || tab.private || !_bwSettings.savePasswords) return;
        try {
            const cap = await tab.wv.executeJavaScript('window.__vulsor_cap||null');
            if (cap && cap.p) _bwPendingCap = { host: _bwHost(tab.url), u: cap.u || '', p: cap.p };
        } catch (_) {}
    }, 1200);
}

// On a real navigation away (likely a login submit), offer to save if the
// typed credential isn't already stored and the user hasn't said "never".
function _bwOnNavCapture(host) {
    const cap = _bwPendingCap;
    _bwPendingCap = null;
    if (!cap || !cap.p || !_bwSettings.savePasswords) return;
    if (_bwPwNeverHosts[cap.host]) return;
    const dupe = _bwPasswords.find(e => e.host === cap.host && (e.username || '') === (cap.u || '') && e.password === cap.p);
    if (dupe) return;
    _bwShowSavePrompt(cap);
}

function _bwShowSavePrompt(cap) {
    const bar = document.getElementById('browser-pw-prompt');
    if (!bar) return;
    document.getElementById('browser-pw-prompt-host').textContent = cap.host;
    bar._cap = cap;
    bar.style.display = 'flex';
}
function _bwHideSavePrompt() {
    const bar = document.getElementById('browser-pw-prompt');
    if (bar) { bar.style.display = 'none'; bar._cap = null; }
}

// ── Downloads bar ────────────────────────────────────────────────────────
const _bwDls = {};   // id → { card, path, filename }

function _bwDlBar() { return document.getElementById('browser-dlbar'); }

function _bwDlStart(d) {
    const bar = _bwDlBar();
    if (!bar) return;
    bar.style.display = 'flex';
    const card = document.createElement('div');
    card.className = 'bw-dl-card';
    card.innerHTML = `
        <i class="fas fa-file-arrow-down" style="color:rgb(var(--tw-indigo-400)); font-size:13px; flex:none"></i>
        <div style="flex:1; min-width:0">
            <div class="bw-dl-name" title="${_bwEsc(d.path)}">${_bwEsc(d.filename)}</div>
            <div class="bw-dl-sub">Downloading…</div>
            <div class="bw-dl-track"><div class="bw-dl-fill" style="width:0%"></div></div>
        </div>
        <div class="bw-dl-actions"></div>
        <button class="bw-dl-x" title="Dismiss"><i class="fas fa-xmark"></i></button>`;
    card.querySelector('.bw-dl-x').addEventListener('click', () => _bwDlRemove(d.id));
    bar.appendChild(card);
    _bwDls[d.id] = { card, path: d.path, filename: d.filename };
}

function _bwDlProgress(d) {
    const dl = _bwDls[d.id];
    if (!dl) return;
    const pct = d.total > 0 ? Math.round(d.received / d.total * 100) : 0;
    const fill = dl.card.querySelector('.bw-dl-fill');
    const sub  = dl.card.querySelector('.bw-dl-sub');
    if (fill && d.total > 0) fill.style.width = pct + '%';
    if (sub) sub.textContent = d.total > 0
        ? `${pct}% · ${(d.received / 1048576).toFixed(1)} / ${(d.total / 1048576).toFixed(1)} MB`
        : `${(d.received / 1048576).toFixed(1)} MB`;
}

function _bwDlDone(d) {
    const dl = _bwDls[d.id];
    if (!dl) return;
    const sub = dl.card.querySelector('.bw-dl-sub');
    const track = dl.card.querySelector('.bw-dl-track');
    const actions = dl.card.querySelector('.bw-dl-actions');
    if (track) track.style.display = 'none';
    if (d.state !== 'completed') {
        if (sub) { sub.textContent = d.state === 'cancelled' ? 'Cancelled' : 'Failed'; sub.style.color = '#f87171'; }
        return;
    }
    if (sub) sub.textContent = 'Saved to Downloads';
    if (actions) {
        actions.innerHTML = `
            <button class="bw-dl-btn bw-dl-vault"><i class="fas fa-folder-open mr-1"></i>Add to Vault</button>
            <button class="bw-dl-btn"><i class="fas fa-magnifying-glass mr-1"></i>Show in Folder</button>`;
        const [vaultBtn, showBtn] = actions.querySelectorAll('button');
        vaultBtn.addEventListener('click', () => _bwDlAddToVault(dl, vaultBtn, sub));
        showBtn.addEventListener('click', () => {
            try { require('electron').shell.showItemInFolder(dl.path); } catch (_) {}
        });
    }
}

// "Add to Vault" on a finished download. Asks which Vault folder to put it in
// (the same navigator the Vault itself uses), then turns the button into a
// "Show in Vault" that jumps to the file — so the copy is something you can see
// rather than a file that quietly landed in whichever folder the Vault happened
// to be showing. A failed copy says so instead of reporting success.
function _bwDlAddToVault(dl, vaultBtn, sub) {
    if (typeof addFilesToVault !== 'function') return;
    const land = res => {
        if (!res || !res.added) {
            if (sub) { sub.textContent = 'Could not copy into Vault'; sub.style.color = '#f87171'; }
            return;
        }
        const folder = res.folderId && typeof vaultData === 'object'
            ? (vaultData.folders.find(f => f.id === res.folderId) || {}).name
            : null;
        if (sub) sub.textContent = `In Vault${folder ? ' · ' + folder : ''} (also kept in Downloads)`;
        const fileId = res.ids && res.ids[0];
        vaultBtn.innerHTML = '<i class="fas fa-arrow-right-to-bracket mr-1"></i>Show in Vault';
        vaultBtn.disabled  = false;
        // Replace the node to drop the "add" listener — a second click reveals.
        const reveal = vaultBtn.cloneNode(true);
        vaultBtn.replaceWith(reveal);
        reveal.addEventListener('click', () => {
            if (fileId && typeof vaultRevealFile === 'function') vaultRevealFile(fileId);
            else if (typeof window.appOpenVaultAt === 'function') window.appOpenVaultAt(res.folderId || null);
        });
    };
    try {
        if (typeof vaultAddFilesWithDestination === 'function') {
            vaultAddFilesWithDestination([dl.path], {
                title:         'Put "' + dl.filename + '" in…',
                // Downloads shouldn't inherit wherever the Vault was last left —
                // start at the root so the file is findable by default.
                startFolderId: null,
                onDone:        land,
            });
        } else {
            land(addFilesToVault([dl.path], null));
        }
    } catch (e) { console.error('[browser] vault add failed:', e); }
}

function _bwDlRemove(id) {
    const dl = _bwDls[id];
    if (dl) { dl.card.remove(); delete _bwDls[id]; }
    const bar = _bwDlBar();
    if (bar && !bar.children.length) bar.style.display = 'none';
}

// ── Address-bar autocomplete ──────────────────────────────────────────────
const _BW_ENGINE_NAME = { google: 'Google', duckduckgo: 'DuckDuckGo', bing: 'Bing' };

// The autocomplete is shared between the browser address bar and the home-page
// search bar. _bwSugCtx points at whichever is currently active.
let _bwSugCtx = null;   // { input, drop, onGo }

function _bwSugEl() { return _bwSugCtx && _bwSugCtx.drop; }
function _bwSugOpen() { const el = _bwSugEl(); return !!(el && el.style.display !== 'none' && _bwSugItems.length); }
function _bwSugHide() { const el = _bwSugEl(); if (el) el.style.display = 'none'; _bwSugItems = []; _bwSugSel = 0; }

// Anchor the dropdown under the search bar's pill (position:fixed → viewport).
function _bwSugPosition() {
    if (!_bwSugCtx) return;
    const el = _bwSugCtx.drop, pill = _bwSugCtx.input.parentElement;
    if (!el || !pill) return;
    const r = pill.getBoundingClientRect();
    el.style.left = r.left + 'px';
    el.style.top = (r.bottom + 5) + 'px';
    el.style.width = r.width + 'px';
}

// Wire an <input> + dropdown <div> to the shared suggestion engine. onGo(text)
// performs the navigation/search for the host (browser bar vs home page).
window.bwOmniboxAttach = function (input, drop, onGo, onEscapeClosed) {
    if (!input || !drop || input._sugWired) return;
    input._sugWired = true;
    const activate = () => { _bwSugCtx = { input, drop, onGo }; };
    input.addEventListener('input', () => {
        activate();
        clearTimeout(_bwSugTimer);
        _bwSugSel = 0;
        const v = input.value;
        _bwSugTimer = setTimeout(() => { activate(); _bwSugUpdate(v); }, 110);
    });
    input.addEventListener('keydown', e => {
        if (_bwSugCtx && _bwSugCtx.input !== input) activate();
        const open = _bwSugOpen();
        if (e.key === 'ArrowDown' && open) { e.preventDefault(); _bwSugSel = (_bwSugSel + 1) % _bwSugItems.length; _bwSugHighlight(true); }
        else if (e.key === 'ArrowUp' && open) { e.preventDefault(); _bwSugSel = (_bwSugSel - 1 + _bwSugItems.length) % _bwSugItems.length; _bwSugHighlight(true); }
        else if (e.key === 'Enter') { e.preventDefault(); if (open) _bwSugChoose(_bwSugSel); else { _bwSugHide(); onGo(input.value); input.blur(); } }
        else if (e.key === 'Escape') { if (open) _bwSugHide(); else if (onEscapeClosed) onEscapeClosed(); else input.blur(); }
    });
    input.addEventListener('blur', () => setTimeout(_bwSugHide, 150));
};

// Query the chosen engine's suggestion endpoint (all return [query,[...]]).
function _bwSugFetch(q) {
    const eng = _bwSettings.engine || 'google';
    let url;
    if (eng === 'duckduckgo') url = 'https://duckduckgo.com/ac/?type=list&q=' + encodeURIComponent(q);
    else if (eng === 'bing')  url = 'https://api.bing.com/osjson.aspx?query=' + encodeURIComponent(q);
    else url = 'https://suggestqueries.google.com/complete/search?client=firefox&hl=en&q=' + encodeURIComponent(q);
    return fetch(url).then(r => r.json()).then(d => {
        if (Array.isArray(d) && Array.isArray(d[1])) return d[1];
        if (Array.isArray(d)) return d.map(x => x && x.phrase).filter(Boolean);
        return [];
    }).catch(() => []);
}

// Bold the matched portion of a suggestion (Google-style).
function _bwSugHl(text, q) {
    const lt = text.toLowerCase(), idx = q ? lt.indexOf(q.toLowerCase()) : -1;
    if (idx < 0) return _bwEsc(text);
    return _bwEsc(text.slice(0, idx)) + '<b>' + _bwEsc(text.slice(idx, idx + q.length)) + '</b>' + _bwEsc(text.slice(idx + q.length));
}

async function _bwSugUpdate(q) {
    q = (q || '').trim();
    if (!q) { _bwSugHide(); return; }
    _bwEnsureLoaded();   // history + previous searches may not be loaded yet (home page)
    const lc = q.toLowerCase();
    // Build local items immediately: default search, previous searches, history.
    const items = [{ kind: 'search', text: q }];
    let nSearch = 0;
    for (const s of _bwSearches) {
        if (nSearch >= 3) break;
        if (s.toLowerCase() !== lc && s.toLowerCase().includes(lc)) { items.push({ kind: 'pastsearch', text: s }); nSearch++; }
    }
    const seen = new Set();
    for (const h of _bwHistory) {
        if (seen.size >= 3) break;
        if (seen.has(h.url)) continue;
        if ((h.title || '').toLowerCase().includes(lc) || (h.url || '').toLowerCase().includes(lc)) {
            seen.add(h.url);
            items.push({ kind: 'url', text: h.title || _bwHost(h.url), url: h.url });
        }
    }
    const aiItem = { kind: 'ai', text: q };
    _bwSugRender(q, items.concat(aiItem));
    // Then merge in remote suggestions (ignore if a newer query started).
    const seq = ++_bwSugSeq;
    const sugg = await _bwSugFetch(q);
    if (seq !== _bwSugSeq) return;
    const merged = items.slice();
    const have = new Set(items.filter(it => it.kind === 'pastsearch' || it.kind === 'search').map(it => it.text.toLowerCase()));
    for (const s of sugg) {
        if (merged.length >= 9) break;
        if (!s || have.has(s.toLowerCase())) continue;
        merged.push({ kind: 'suggest', text: s });
        have.add(s.toLowerCase());
    }
    _bwSugRender(q, merged.concat(aiItem));   // AI row always pinned last
}

function _bwSugRender(q, items) {
    const el = _bwSugEl();
    if (!el) return;
    _bwSugItems = items;
    if (_bwSugSel >= items.length) _bwSugSel = 0;
    const engName = _BW_ENGINE_NAME[_bwSettings.engine || 'google'] || 'Google';
    el.innerHTML = items.map((it, i) => {
        const sel = i === _bwSugSel ? ' sel' : '';
        if (it.kind === 'url') {
            // From history → an already-visited site, so show it in purple like
            // a visited link in Google.
            return `<div class="bw-sug-item${sel}" data-i="${i}">
                <i class="fas fa-clock-rotate-left bw-sug-ico"></i>
                <span class="bw-sug-text bw-sug-visited">${_bwEsc(it.text)}</span>
                <span class="bw-sug-url">${_bwEsc(_bwHost(it.url))}</span></div>`;
        }
        if (it.kind === 'ai') {
            return `<div class="bw-sug-item bw-sug-ai${sel}" data-i="${i}">
                <i class="fas fa-wand-magic-sparkles bw-sug-ico" style="color:rgb(var(--tw-purple-400))"></i>
                <span class="bw-sug-text">${_bwEsc(it.text)} — <span style="color:rgb(var(--tw-purple-400))">Ask Vulsor AI</span></span>
                <span class="bw-sug-hint">${i === _bwSugSel ? 'Enter ↵' : 'Press ↑'}</span></div>`;
        }
        // Previous searches use a history icon; live suggestions / the default
        // row use a magnifier.
        const icon = it.kind === 'pastsearch' ? 'fa-clock-rotate-left' : 'fa-magnifying-glass';
        const hint = it.kind === 'search' ? `<span class="bw-sug-hint">${engName} Search</span>` : '';
        return `<div class="bw-sug-item${sel}" data-i="${i}">
            <i class="fas ${icon} bw-sug-ico"></i>
            <span class="bw-sug-text">${_bwSugHl(it.text, q)}</span>${hint}</div>`;
    }).join('');
    _bwSugPosition();
    el.style.display = 'block';
    el.querySelectorAll('.bw-sug-item').forEach(node => {
        node.addEventListener('mousedown', e => { e.preventDefault(); _bwSugChoose(node.dataset.i | 0); });
        node.addEventListener('mouseenter', () => { _bwSugSel = node.dataset.i | 0; _bwSugHighlight(false); });
    });
}

function _bwSugHighlight(updateInput) {
    const el = _bwSugEl();
    if (el) el.querySelectorAll('.bw-sug-item').forEach((n, i) => n.classList.toggle('sel', i === _bwSugSel));
    if (updateInput && _bwSugCtx) {
        const it = _bwSugItems[_bwSugSel], input = _bwSugCtx.input;
        if (it && input && it.kind !== 'ai') input.value = it.kind === 'url' ? it.url : it.text;
    }
}

function _bwSugChoose(i) {
    const it = _bwSugItems[i];
    if (!it || !_bwSugCtx) return;
    const input = _bwSugCtx.input, onGo = _bwSugCtx.onGo;
    _bwSugHide();
    if (it.kind === 'ai') {
        if (input) input.blur();
        if (window.appAskAI) window.appAskAI(it.text);
        return;
    }
    const target = it.kind === 'url' ? it.url : it.text;
    if (input) { input.value = target; input.blur(); }
    onGo(target);
}

// The real cached favicon for a host (no www.), or null. Used by home tiles.
window.bwFaviconForHost = function (host) {
    try { _bwEnsureLoaded(); return _bwFavCache[String(host || '').replace(/^www\./, '')] || null; } catch (_) { return null; }
};

// Record a term as a past search if it resolves to a search (not a URL). Used
// by the home-page omnibox, whose navigation doesn't go through _bwGo.
window.bwRecordSearch = function (text) {
    try {
        const url = _bwResolveInput(text);
        if (url && Object.values(_BW_SEARCH).some(p => url.startsWith(p))) _bwRecordSearch(text);
    } catch (_) {}
};

// Remember a search term so it can be re-surfaced in the address bar later.
function _bwRecordSearch(term) {
    term = (term || '').trim();
    if (!term) return;
    _bwSearches = _bwSearches.filter(s => s.toLowerCase() !== term.toLowerCase());
    _bwSearches.unshift(term);
    if (_bwSearches.length > _BW_SEARCH_MAX) _bwSearches.length = _BW_SEARCH_MAX;
    _bwSave();
}

// Manual "nuke overlay" — aggressively remove ad overlays / fake pop-ups from
// the current page. User-triggered, so it can be more forceful than the passive
// guard (it actually removes nodes and restores scrolling). The passive guard in
// browser-preload.js covers iframes; this handles the top page on demand.
function _bwDeclutter() {
    const tab = _bwActiveTab();
    if (!tab || !tab.wv) return;
    // Aggressive, geometry-based: find the player and remove every positioned
    // layer sitting on top of it (any size, any text), plus big page-wide ad
    // layers. User-triggered, so we don't gate on text at all.
    const code = `(function(){try{
        var removed=0, vw=innerWidth, vh=innerHeight;
        function frac(r,pr){var ox=Math.max(0,Math.min(r.right,pr.right)-Math.max(r.left,pr.left));var oy=Math.max(0,Math.min(r.bottom,pr.bottom)-Math.max(r.top,pr.top));var a=r.width*r.height;return a>0?(ox*oy)/a:0;}
        var pl=null,pa=0,med=document.querySelectorAll('video,iframe,embed,object');
        for(var m=0;m<med.length;m++){var mr=med[m].getBoundingClientRect();if(mr.width<250||mr.height<150)continue;var a=mr.width*mr.height;if(a>pa){pa=a;pl=med[m];}}
        var pr=pl?pl.getBoundingClientRect():null;
        var all=document.querySelectorAll('body *');
        for(var i=0;i<all.length&&i<8000;i++){var e=all[i],cs;
            if(pl&&(e===pl||e.contains(pl)||pl.contains(e)))continue;
            try{cs=getComputedStyle(e);}catch(_){continue;}
            if(cs.position!=='fixed'&&cs.position!=='absolute')continue;
            var z=parseInt(cs.zIndex,10)||0;var r=e.getBoundingClientRect();if(r.width<24||r.height<24)continue;
            if(pr&&z>=1&&frac(r,pr)>0.5&&(r.width*r.height)<vw*vh*0.98){e.remove();removed++;continue;}
            if(z>=1&&r.width>=vw*0.5&&r.height>=vh*0.5){if(e.tagName==='A'||e.tagName==='INS'){e.remove();removed++;}else{var tr=cs.backgroundColor==='rgba(0, 0, 0, 0)'||parseFloat(cs.opacity||'1')<0.05;if(tr)e.style.setProperty('pointer-events','none','important');}}
        }
        try{document.documentElement.style.overflow='';document.body.style.overflow='';document.body.style.position='';}catch(_){}
        return removed;
    }catch(e){return -1;}})()`;
    try { tab.wv.executeJavaScript(code).catch(() => {}); } catch (_) {}
    // Also clear inside cross-origin sub-frames (the embed player) via main.
    try { ipcRenderer.send('declutter-frames', tab.wv.getWebContentsId()); } catch (_) {}
}

// ── Actions ──────────────────────────────────────────────────────────────
function _bwGo(input) {
    const url = _bwResolveInput(input);
    if (!url) return;
    // If this was a search (not a direct URL), keep the term for autocomplete.
    if (Object.values(_BW_SEARCH).some(p => url.startsWith(p))) _bwRecordSearch(input);
    const tab = _bwActiveTab();
    if (!tab) { if (window.appOpenBrowserTab) window.appOpenBrowserTab(url, { background: false }); return; }
    _bwNavigate(tab, url);
    _bwSave();
}

function renderBrowser() {
    if (_bwInited) return;
    _bwInited = true;

    document.getElementById('browser-newtab')?.addEventListener('click', () => window.appOpenBrowserTab?.('', { background: false }));
    document.getElementById('browser-newprivate')?.addEventListener('click', () => window.appOpenBrowserTab?.('', { background: false, private: true }));
    document.getElementById('browser-back')?.addEventListener('click', () => { const t = _bwActiveTab(); if (t && t.wv) t.wv.goBack(); });
    document.getElementById('browser-fwd') ?.addEventListener('click', () => { const t = _bwActiveTab(); if (t && t.wv) t.wv.goForward(); });
    document.getElementById('browser-reload')?.addEventListener('click', () => {
        const t = _bwActiveTab(); if (!t || !t.wv) return;
        if (t.loading) t.wv.stop(); else t.wv.reload();
    });
    document.getElementById('browser-open-ext')?.addEventListener('click', () => {
        const t = _bwActiveTab();
        if (t && t.url) { try { require('electron').shell.openExternal(t.url); } catch (_) {} }
    });
    // Coming back online retries the page automatically if the banner is up.
    window.addEventListener('online', () => {
        const el = document.getElementById('browser-error');
        if (!el || el.style.display === 'none') return;
        document.getElementById('browser-error-retry')?.click();
    });
    document.getElementById('browser-error-retry')?.addEventListener('click', () => {
        const t = _bwActiveTab();
        if (!t || !t.wv) return;
        _bwHideError();
        // reload() can throw on a dead render process — fall back to reloading the URL
        try { t.wv.reload(); }
        catch (_) { try { if (t.url) t.wv.loadURL ? t.wv.loadURL(t.url) : (t.wv.src = t.url); } catch (_) {} }
    });

    // History + security panels
    document.getElementById('browser-history-btn')?.addEventListener('click', e => { e.stopPropagation(); _bwToggleHistory(); });
    document.getElementById('browser-secure')?.addEventListener('click', e => { e.stopPropagation(); _bwToggleSiteInfo(); });
    document.getElementById('browser-history-search')?.addEventListener('input', () => _bwRenderHistory('pop'));
    document.getElementById('browser-history-clear')?.addEventListener('click', () => { _bwHistory = []; _bwSave(); _bwRenderHistoryAll(); });
    document.getElementById('browser-history-cleardata')?.addEventListener('click', e => _bwClearBrowsingData(e.currentTarget));
    document.getElementById('browser-siteinfo-cleardata')?.addEventListener('click', e => _bwClearBrowsingData(e.currentTarget));

    // Private (guest) tab — toolbar button
    document.getElementById('browser-private-btn')?.addEventListener('click', () => window.appOpenBrowserTab?.('', { background: false, private: true }));

    // Manual ad-overlay remover (toolbar button + app-level ⌘⇧X menu accelerator,
    // which fires even while the embedded page has keyboard focus).
    document.getElementById('browser-declutter')?.addEventListener('click', () => _bwDeclutter());
    ipcRenderer.on('declutter-overlay', () => _bwDeclutter());

    // ⋮ opens the full-page Settings (its own top-level app tab)
    document.getElementById('browser-settings-btn')?.addEventListener('click', e => { e.stopPropagation(); _bwHidePanels(); window.appOpenTab?.('settings'); });

    // In-browser password popover (still available programmatically; the
    // primary password UI now lives on the Settings page)
    document.getElementById('browser-pw-add-btn')?.addEventListener('click', () => {
        const form = document.getElementById('browser-pw-form');
        if (form && form.style.display !== 'none') _bwPwHideForm('pop');
        else _bwPwShowForm({ host: _bwActiveTab() && _bwActiveTab().url ? _bwHost(_bwActiveTab().url) : '' }, 'pop');
    });
    document.getElementById('browser-pw-cancel')?.addEventListener('click', () => _bwPwHideForm('pop'));
    document.getElementById('browser-pw-save')?.addEventListener('click', () => _bwPwSaveFromForm('pop'));
    document.getElementById('browser-pw-pass')?.addEventListener('keydown', e => { if (e.key === 'Enter') _bwPwSaveFromForm('pop'); });
    document.getElementById('browser-pw-search')?.addEventListener('input', () => _bwRenderPasswords('pop'));

    // Save-password prompt bar
    document.getElementById('browser-pw-prompt-save')?.addEventListener('click', () => {
        const bar = document.getElementById('browser-pw-prompt');
        const cap = bar && bar._cap;
        if (cap) { _bwPwUpsert(cap.host, cap.u, cap.p); _bwRenderPwAll(); }
        _bwHideSavePrompt();
    });
    document.getElementById('browser-pw-prompt-never')?.addEventListener('click', () => {
        const bar = document.getElementById('browser-pw-prompt');
        const cap = bar && bar._cap;
        if (cap) { _bwPwNeverHosts[cap.host] = true; _bwSave(); }
        _bwHideSavePrompt();
    });
    document.getElementById('browser-pw-prompt-dismiss')?.addEventListener('click', () => _bwHideSavePrompt());

    // Click anywhere else closes the popover panels
    document.getElementById('view-browser')?.addEventListener('mousedown', e => {
        const inPanel = e.target.closest('#browser-history') || e.target.closest('#browser-siteinfo')
            || e.target.closest('#browser-settings') || e.target.closest('#browser-passwords')
            || e.target.closest('#browser-pw-prompt')
            || e.target.closest('#browser-history-btn') || e.target.closest('#browser-secure')
            || e.target.closest('#browser-settings-btn');
        if (!inPanel) _bwHidePanels();
    });

    const urlEl = document.getElementById('browser-url');
    if (urlEl) {
        // Warm up DNS for the likely destination while the user is still
        // typing, so the connection starts faster on Enter.
        let dnsTimer = null;
        urlEl.addEventListener('input', () => {
            clearTimeout(dnsTimer);
            dnsTimer = setTimeout(() => {
                try {
                    const u = _bwResolveInput(urlEl.value);
                    if (u) require('dns').lookup(new URL(u).hostname, () => {});
                } catch (_) {}
            }, 250);
        });
        urlEl.addEventListener('focus', () => urlEl.select());
        // Address-bar autocomplete (shared engine).
        window.bwOmniboxAttach(urlEl, document.getElementById('browser-suggest'), v => _bwGo(v),
            () => { const t = _bwActiveTab(); urlEl.value = t ? (t.url || '') : ''; urlEl.blur(); });
    }

    // Quick links on the start panel
    document.querySelectorAll('#browser-start [data-bw-url]').forEach(b =>
        b.addEventListener('click', () => _bwGo(b.dataset.bwUrl)));

    // Keyboard shortcuts while the browser view is active (host focus only)
    document.addEventListener('keydown', e => {
        const view = document.getElementById('view-browser');
        if (!view || !view.classList.contains('active')) return;
        const mod = e.metaKey || e.ctrlKey;
        if (mod && !e.shiftKey && e.key.toLowerCase() === 'l') { e.preventDefault(); urlEl?.focus(); }
        else if (mod && !e.shiftKey && e.key.toLowerCase() === 't') { e.preventDefault(); window.appOpenBrowserTab?.('', { background: false }); }
        else if (mod && e.shiftKey && e.key.toLowerCase() === 'n') { e.preventDefault(); window.appOpenBrowserTab?.('', { background: false, private: true }); }
        else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); _bwToggleHistory(); }
        else if (mod && !e.shiftKey && e.key.toLowerCase() === 's') {
            e.preventDefault();
            const t = _bwActiveTab();
            if (t && t.wv) { try { ipcRenderer.send('browser-save-page', t.wv.getWebContentsId()); } catch (_) {} }
        }
    });

    // Chords pressed while the page itself has focus: the document keydown
    // above never fires then, so the main process catches them on the webview
    // (before-input-event) and forwards the ones the host owns.
    ipcRenderer.on('browser-shortcut', (e, s) => {
        const k = (s && s.key) || '';
        if (k === 'l') { urlEl?.focus(); }
        else if (k === 't') window.appOpenBrowserTab?.('', { background: false });
        else if (k === 'n' && s.shift) window.appOpenBrowserTab?.('', { background: false, private: true });
        else if (k === 'y') _bwToggleHistory();
    });

    // Popups / new-tab links from pages (window.open / target=_blank). Foreground
    // the new tab for normal opens so the user actually SEES it — the old
    // always-background behavior made a link click feel like it did nothing.
    // Chromium reports cmd/ctrl-click as 'background-tab', which we still honor so
    // "open in background" keeps working. Payload may be a plain URL string (from
    // explicit menu actions) or { url, disposition } (from the popup handler).
    ipcRenderer.on('browser-open-url', (e, payload) => {
        const src  = _bwActiveTab();
        const url  = (typeof payload === 'string') ? payload : (payload && payload.url) || '';
        const disp = (payload && typeof payload === 'object') ? payload.disposition : '';
        if (!url) return;
        const background = disp === 'background-tab';
        if (window.appOpenBrowserTab) window.appOpenBrowserTab(url, { background, private: !!(src && src.private) });
    });

    // Downloads (driven by the main process)
    ipcRenderer.on('browser-download-started',  (e, d) => _bwDlStart(d));
    ipcRenderer.on('browser-download-progress', (e, d) => _bwDlProgress(d));
    ipcRenderer.on('browser-download-done',     (e, d) => _bwDlDone(d));

    // Restore browsing history (open web tabs are top-level app tabs now and,
    // like every other app tab, start fresh each launch — the signed-in web
    // session itself still persists via the 'persist:browser' partition).
    // Load saved history/settings/logins, then watch for typed credentials so
    // we can offer to save them.
    _bwEnsureLoaded();
    _bwStartCapturePoll();
}
