// ── Cosmos — the beauty of the universe (NASA Astronomy Picture of the Day) ──
// Depends on: globals.js (ipcRenderer, COSMOS_FILE, fs)

let _cosmosItems   = [];      // discover feed
let _cosmosFavs    = [];      // saved favorites
let _cosmosView    = [];      // list currently shown (for lightbox indexing)
let _cosmosMode    = 'discover';
let _cosmosLoading = false;
let _cosmosLoaded  = false;

// ── Persistence (favorites + cache + NASA key) ──────────────────────────
let _cosmosCache   = [];   // last successful batch (offline / rate-limit fallback)
let _cosmosNasaKey = '';

function loadCosmosStore() {
    try {
        if (fs.existsSync(COSMOS_FILE)) {
            const d = readJsonStrict(COSMOS_FILE);
            _cosmosFavs    = d.favorites || [];
            _cosmosCache   = d.cache || [];
            _cosmosNasaKey = d.nasaKey || '';
            return;
        }
    } catch (_) {}
    _cosmosFavs = []; _cosmosCache = []; _cosmosNasaKey = '';
}
function saveCosmosStore() {
    try { writeJsonSafe(COSMOS_FILE, { favorites: _cosmosFavs, cache: _cosmosCache, nasaKey: _cosmosNasaKey }); }
    catch (e) { console.error('[cosmos] save failed:', e); }
}
function saveCosmosFavs() { saveCosmosStore(); }
function _cosmosKey(it) { return it.date || it.url || it.title || ''; }
function cosmosIsFav(it) { const k = _cosmosKey(it); return _cosmosFavs.some(f => _cosmosKey(f) === k); }
function cosmosToggleFav(it) {
    const k = _cosmosKey(it);
    const i = _cosmosFavs.findIndex(f => _cosmosKey(f) === k);
    if (i >= 0) _cosmosFavs.splice(i, 1);
    else _cosmosFavs.unshift(it);
    saveCosmosFavs();
}

function _cosmosEsc(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// ── Main render ─────────────────────────────────────────────────────────
function renderCosmos(force) {
    const gallery = document.getElementById('cosmos-gallery');
    if (!gallery) return;
    _cosmosUpdateTabs();

    if (_cosmosMode === 'favs') { _cosmosRenderGrid(_cosmosFavs, true); return; }

    if (_cosmosLoaded && !force) { _cosmosRenderGrid(_cosmosItems, false); return; }
    if (_cosmosLoading) return;

    _cosmosLoading = true;
    gallery.innerHTML = `
        <div class="flex flex-col items-center justify-center h-full gap-4 text-center">
            <i class="fas fa-meteor text-3xl text-indigo-400 cosmos-float"></i>
            <p class="text-slate-400 text-sm"><i class="fas fa-circle-notch fa-spin mr-1.5"></i>Gazing into the cosmos…</p>
        </div>`;

    ipcRenderer.invoke('get-apod', { count: 16, apiKey: _cosmosNasaKey }).then(r => {
        _cosmosLoading = false;
        if (!r || !r.ok || !r.items) {
            // Fall back to cached images if we have any
            if (_cosmosCache.length) {
                _cosmosItems = _cosmosCache;
                _cosmosLoaded = true;
                _cosmosRenderGrid(_cosmosItems, false);
                _cosmosShowBanner(r && r.rateLimited
                    ? 'NASA is rate-limited — showing saved images. Add a free key (🔑) for more.'
                    : 'NASA unavailable — showing saved images.');
                return;
            }
            const is429 = r && (r.rateLimited || String(r.error||'').includes('429'));
            gallery.innerHTML = `
                <div class="flex flex-col items-center justify-center h-full gap-3 text-center px-6">
                    <i class="fas fa-satellite-dish text-2xl text-slate-600"></i>
                    <p class="text-slate-400 text-sm">Couldn't reach NASA right now.</p>
                    <p class="text-slate-600 text-xs">${is429 ? 'The shared demo key is rate-limited (HTTP 429).' : _cosmosEsc(String(r && r.error || 'Check your connection').slice(0,80))}</p>
                    ${is429 ? `<p class="text-slate-500 text-xs max-w-sm">Get your own free NASA key (1,000/hour) to fix this.</p>
                    <button onclick="cosmosShowKeyModal()" class="mt-1 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold"><i class="fas fa-key mr-1.5"></i>Add NASA key</button>` : ''}
                    <button onclick="renderCosmos(true)" class="mt-1 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium">Try again</button>
                </div>`;
            return;
        }
        _cosmosItems = r.items.filter(it => it.media_type === 'image' && (it.url || it.hdurl));
        _cosmosLoaded = true;
        // Cache this good batch for offline / rate-limited fallback
        if (_cosmosItems.length) { _cosmosCache = _cosmosItems.slice(0, 30); saveCosmosStore(); }
        _cosmosRenderGrid(_cosmosItems, false);
    }).catch(e => {
        _cosmosLoading = false;
        if (_cosmosCache.length) {
            _cosmosItems = _cosmosCache; _cosmosLoaded = true;
            _cosmosRenderGrid(_cosmosItems, false);
            _cosmosShowBanner('NASA unavailable — showing saved images.');
        } else {
            gallery.innerHTML = `<div class="flex items-center justify-center h-full"><p class="text-red-400 text-sm">${_cosmosEsc(e.message)}</p></div>`;
        }
    });
}

function _cosmosShowBanner(text) {
    const gallery = document.getElementById('cosmos-gallery');
    if (!gallery) return;
    const banner = document.createElement('div');
    banner.className = 'mb-3 px-4 py-2 rounded-xl text-xs text-amber-300 flex items-center gap-2';
    banner.style.cssText = 'background:rgba(245,158,11,0.12);border:1px solid rgba(245,158,11,0.3)';
    banner.innerHTML = `<i class="fas fa-triangle-exclamation"></i> ${_cosmosEsc(text)}`;
    gallery.insertBefore(banner, gallery.firstChild);
}

function _cosmosUpdateTabs() {
    const dEl = document.getElementById('cosmos-tab-discover');
    const fEl = document.getElementById('cosmos-tab-favs');
    const shuf = document.getElementById('cosmos-shuffle');
    const on  = 'rgba(99,102,241,0.3)', onB = 'rgba(99,102,241,0.5)';
    const off = 'rgba(30,41,59,0.6)', offB = 'rgba(148,163,184,0.2)';
    if (dEl) { dEl.style.background = _cosmosMode==='discover'?on:off; dEl.style.borderColor = _cosmosMode==='discover'?onB:offB; dEl.style.color = _cosmosMode==='discover'?'#fff':'#cbd5e1'; }
    if (fEl) { fEl.style.background = _cosmosMode==='favs'?on:off; fEl.style.borderColor = _cosmosMode==='favs'?onB:offB; fEl.style.color = _cosmosMode==='favs'?'#fff':'#cbd5e1';
        fEl.innerHTML = `<i class="fas fa-heart text-[10px] mr-1"></i> Favorites${_cosmosFavs.length ? ` (${_cosmosFavs.length})` : ''}`; }
    if (shuf) shuf.style.display = _cosmosMode === 'discover' ? '' : 'none';
}

function _cosmosRenderGrid(items, isFavView) {
    const gallery = document.getElementById('cosmos-gallery');
    if (!gallery) return;
    _cosmosView = items;
    if (!items.length) {
        gallery.innerHTML = isFavView
            ? `<div class="flex flex-col items-center justify-center h-full gap-3 text-center"><i class="far fa-heart text-2xl text-slate-600"></i><p class="text-slate-500 text-sm">No favorites yet.<br>Tap the ♥ on any image to save it here.</p></div>`
            : `<p class="text-slate-500 text-sm text-center py-10">No images. <button onclick="renderCosmos(true)" class="text-indigo-400 underline">Shuffle again</button></p>`;
        return;
    }
    gallery.innerHTML = `<div class="cosmos-grid">` + items.map((it, i) => {
        const fav = cosmosIsFav(it);
        return `<div class="cosmos-card" onclick="cosmosOpen(${i})">
            <img src="${_cosmosEsc(it.url)}" alt="" loading="lazy" class="cosmos-card-img">
            <button class="cosmos-fav-btn ${fav ? 'is-fav' : ''}" onclick="event.stopPropagation();cosmosToggleFavAt(${i})" title="Favorite">
                <i class="${fav ? 'fas' : 'far'} fa-heart"></i>
            </button>
        </div>`;
    }).join('') + `</div>`;
}

function cosmosToggleFavAt(i) {
    const it = _cosmosView[i];
    if (!it) return;
    cosmosToggleFav(it);
    _cosmosUpdateTabs();
    // Re-render current grid to reflect change
    _cosmosRenderGrid(_cosmosMode === 'favs' ? _cosmosFavs : _cosmosItems, _cosmosMode === 'favs');
}

// ── Lightbox ────────────────────────────────────────────────────────────
let _cosmosLbItem = null;
function cosmosOpen(i) {
    const it = _cosmosView[i];
    if (!it) return;
    _cosmosLbItem = it;
    const lb = document.getElementById('cosmos-lightbox');
    const img = document.getElementById('cosmos-lb-img');
    const spinner = document.getElementById('cosmos-lb-spinner');
    document.getElementById('cosmos-lb-title').textContent = it.title || '';

    // Fast render: show the already-loaded grid image instantly, then upgrade to HD
    if (spinner) spinner.style.display = '';
    img.onload = () => { if (spinner) spinner.style.display = 'none'; };
    img.src = it.url;  // usually cached from the grid → appears immediately

    if (it.hdurl && it.hdurl !== it.url) {
        const hd = new Image();
        hd.onload = () => { img.src = it.hdurl; if (spinner) spinner.style.display = 'none'; };
        hd.src = it.hdurl;
    }
    _cosmosUpdateLbFav();
    lb.style.display = 'flex';
}
function _cosmosUpdateLbFav() {
    const btn = document.getElementById('cosmos-lb-fav');
    if (!btn || !_cosmosLbItem) return;
    const fav = cosmosIsFav(_cosmosLbItem);
    btn.innerHTML = `<i class="${fav ? 'fas' : 'far'} fa-heart text-sm"></i>`;
    btn.style.color = fav ? '#f472b6' : '';
}
function cosmosCloseLightbox() {
    const lb = document.getElementById('cosmos-lightbox');
    if (lb) lb.style.display = 'none';
}

async function cosmosDownloadCurrent() {
    if (!_cosmosLbItem) return;
    const btn = document.getElementById('cosmos-lb-download');
    const orig = btn ? btn.innerHTML : '';
    if (btn) btn.innerHTML = '<i class="fas fa-circle-notch fa-spin text-sm"></i>';
    try {
        const r = await ipcRenderer.invoke('cosmos-download', {
            url: _cosmosLbItem.hdurl || _cosmosLbItem.url,
            filename: _cosmosLbItem.title || _cosmosLbItem.date || 'cosmos',
        });
        if (btn) {
            if (r && r.ok) { btn.innerHTML = '<i class="fas fa-check text-sm text-green-400"></i>'; }
            else if (r && r.canceled) { btn.innerHTML = orig; }
            else { btn.innerHTML = '<i class="fas fa-xmark text-sm text-red-400"></i>'; }
            setTimeout(() => { btn.innerHTML = orig; }, 1500);
        }
    } catch (e) {
        if (btn) { btn.innerHTML = '<i class="fas fa-xmark text-sm text-red-400"></i>'; setTimeout(() => btn.innerHTML = orig, 1500); }
    }
}

// ── Search the NASA image library ───────────────────────────────────────
let _cosmosSearchSeq = 0;
function cosmosSearch(q) {
    q = (q || '').trim();
    const gallery = document.getElementById('cosmos-gallery');
    if (!gallery) return;
    if (!q) { _cosmosMode = 'discover'; renderCosmos(); return; }

    _cosmosMode = 'search';
    _cosmosUpdateTabs();
    const seq = ++_cosmosSearchSeq;
    gallery.innerHTML = `
        <div class="flex flex-col items-center justify-center h-full gap-3 text-center">
            <i class="fas fa-magnifying-glass text-2xl text-indigo-400 cosmos-float"></i>
            <p class="text-slate-400 text-sm"><i class="fas fa-circle-notch fa-spin mr-1.5"></i>Searching for “${_cosmosEsc(q)}”…</p>
        </div>`;

    ipcRenderer.invoke('search-nasa-images', { q }).then(r => {
        if (seq !== _cosmosSearchSeq) return; // a newer search superseded this one
        if (!r || !r.ok) {
            gallery.innerHTML = `<div class="flex flex-col items-center justify-center h-full gap-3 text-center"><i class="fas fa-satellite-dish text-2xl text-slate-600"></i><p class="text-slate-400 text-sm">Search failed.</p><p class="text-slate-600 text-xs">${_cosmosEsc(String(r && r.error || '').slice(0,80))}</p></div>`;
            return;
        }
        const items = (r.items || []).filter(it => it.url);
        if (!items.length) {
            gallery.innerHTML = `<div class="flex flex-col items-center justify-center h-full gap-2 text-center"><i class="far fa-image text-2xl text-slate-600"></i><p class="text-slate-400 text-sm">No results for “${_cosmosEsc(q)}”.</p></div>`;
            _cosmosView = [];
            return;
        }
        _cosmosRenderGrid(items, false);
    }).catch(e => {
        if (seq !== _cosmosSearchSeq) return;
        gallery.innerHTML = `<div class="flex items-center justify-center h-full"><p class="text-red-400 text-sm">${_cosmosEsc(e.message)}</p></div>`;
    });
}

// ── NASA key modal ──────────────────────────────────────────────────────
function cosmosShowKeyModal() {
    const m = document.getElementById('cosmos-key-modal');
    const inp = document.getElementById('cosmos-key-input');
    if (m) m.style.display = 'flex';
    if (inp) { inp.value = _cosmosNasaKey || ''; setTimeout(() => inp.focus(), 50); }
}
function cosmosCloseKeyModal() {
    const m = document.getElementById('cosmos-key-modal');
    if (m) m.style.display = 'none';
}

function initCosmos() {
    loadCosmosStore();

    document.getElementById('cosmos-shuffle')?.addEventListener('click', () => renderCosmos(true));
    document.getElementById('cosmos-key-btn')?.addEventListener('click', cosmosShowKeyModal);

    // Search bar — search on Enter (debounced live search too)
    const searchEl = document.getElementById('cosmos-search');
    const clearBtn = document.getElementById('cosmos-search-clear');
    let _searchTimer = null;
    if (searchEl) {
        searchEl.addEventListener('input', () => {
            if (clearBtn) clearBtn.style.display = searchEl.value ? '' : 'none';
            clearTimeout(_searchTimer);
            const v = searchEl.value;
            _searchTimer = setTimeout(() => cosmosSearch(v), 500);
        });
        searchEl.addEventListener('keydown', e => {
            if (e.key === 'Enter') { clearTimeout(_searchTimer); cosmosSearch(searchEl.value); }
            else if (e.key === 'Escape') { searchEl.value = ''; if (clearBtn) clearBtn.style.display = 'none'; cosmosSearch(''); }
        });
    }
    if (clearBtn) clearBtn.addEventListener('click', () => {
        if (searchEl) searchEl.value = '';
        clearBtn.style.display = 'none';
        cosmosSearch('');
    });
    document.getElementById('cosmos-key-close')?.addEventListener('click', cosmosCloseKeyModal);
    document.getElementById('cosmos-key-modal')?.addEventListener('click', e => {
        if (e.target.id === 'cosmos-key-modal') cosmosCloseKeyModal();
    });
    document.getElementById('cosmos-key-save')?.addEventListener('click', () => {
        const v = document.getElementById('cosmos-key-input').value.trim();
        _cosmosNasaKey = v;
        saveCosmosStore();
        cosmosCloseKeyModal();
        renderCosmos(true);
    });
    const _clearSearchBox = () => {
        const s = document.getElementById('cosmos-search');
        const c = document.getElementById('cosmos-search-clear');
        if (s) s.value = ''; if (c) c.style.display = 'none';
    };
    document.getElementById('cosmos-tab-discover')?.addEventListener('click', () => { _clearSearchBox(); _cosmosMode = 'discover'; renderCosmos(); });
    document.getElementById('cosmos-tab-favs')?.addEventListener('click', () => { _clearSearchBox(); _cosmosMode = 'favs'; renderCosmos(); });

    document.getElementById('cosmos-lb-close')?.addEventListener('click', cosmosCloseLightbox);
    document.getElementById('cosmos-lb-download')?.addEventListener('click', cosmosDownloadCurrent);
    document.getElementById('cosmos-lb-fav')?.addEventListener('click', () => {
        if (!_cosmosLbItem) return;
        cosmosToggleFav(_cosmosLbItem);
        _cosmosUpdateLbFav();
        _cosmosUpdateTabs();
    });
    document.getElementById('cosmos-lightbox')?.addEventListener('click', e => {
        if (e.target.id === 'cosmos-lightbox') cosmosCloseLightbox();
    });
}
if (document.readyState !== 'loading') initCosmos();
else document.addEventListener('DOMContentLoaded', initCosmos);
