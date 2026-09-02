// ── News — Multi-outlet RSS reader ──────────────────────────────────
// Depends on: globals.js (fs, path, DOCUMENTS_PATH)
// Feeds are fetched with Node's http(s) (no CORS), parsed with DOMParser.

const NEWS_FILE = path.join(DOCUMENTS_PATH, 'news.json');

// ── Outlet catalog ─────────────────────────────────────────────────
const NEWS_OUTLETS = [
    // World
    { id: 'bbc-world',    name: 'BBC World',     cat: 'World',        color: '#bb1919', url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
    { id: 'guardian',     name: 'The Guardian',  cat: 'World',        color: '#0f5290', url: 'https://www.theguardian.com/world/rss' },
    { id: 'nyt-world',    name: 'NY Times',      cat: 'World',        color: '#5c7080', url: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml' },
    { id: 'aljazeera',    name: 'Al Jazeera',    cat: 'World',        color: '#fa9000', url: 'https://www.aljazeera.com/xml/rss/all.xml' },
    { id: 'cnn',          name: 'CNN',           cat: 'World',        color: '#cc0000', url: 'http://rss.cnn.com/rss/edition.rss' },
    // Tech
    { id: 'verge',        name: 'The Verge',     cat: 'Tech',         color: '#7c3aed', url: 'https://www.theverge.com/rss/index.xml' },
    { id: 'techcrunch',   name: 'TechCrunch',    cat: 'Tech',         color: '#0a8935', url: 'https://techcrunch.com/feed/' },
    { id: 'ars',          name: 'Ars Technica',  cat: 'Tech',         color: '#ff4e00', url: 'https://feeds.arstechnica.com/arstechnica/index' },
    { id: 'wired',        name: 'Wired',         cat: 'Tech',         color: '#64748b', url: 'https://www.wired.com/feed/rss' },
    { id: 'hn',           name: 'Hacker News',   cat: 'Tech',         color: '#f26522', url: 'https://hnrss.org/frontpage' },
    // Business
    { id: 'bbc-business', name: 'BBC Business',  cat: 'Business',     color: '#bb1919', url: 'https://feeds.bbci.co.uk/news/business/rss.xml' },
    { id: 'cnbc',         name: 'CNBC',          cat: 'Business',     color: '#005594', url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114' },
    // Science
    { id: 'sciencedaily', name: 'ScienceDaily',  cat: 'Science',      color: '#006699', url: 'https://www.sciencedaily.com/rss/all.xml' },
    { id: 'nasa',         name: 'NASA',          cat: 'Science',      color: '#0b3d91', url: 'https://www.nasa.gov/rss/dyn/breaking_news.rss' },
    { id: 'newsci',       name: 'New Scientist', cat: 'Science',      color: '#00b2a9', url: 'https://www.newscientist.com/feed/home/' },
    // Sports
    { id: 'bbc-sport',    name: 'BBC Sport',     cat: 'Sports',       color: '#ffd230', url: 'https://feeds.bbci.co.uk/sport/rss.xml' },
    { id: 'espn',         name: 'ESPN',          cat: 'Sports',       color: '#d00000', url: 'https://www.espn.com/espn/rss/news' },
    { id: 'skysports',    name: 'Sky Sports',    cat: 'Sports',       color: '#38bdf8', url: 'https://www.skysports.com/rss/12040' },
    // Gaming
    { id: 'ign',          name: 'IGN',           cat: 'Gaming',       color: '#bf1313', url: 'https://feeds.feedburner.com/ign/all' },
    { id: 'polygon',      name: 'Polygon',       cat: 'Gaming',       color: '#ff0052', url: 'https://www.polygon.com/rss/index.xml' },
    // Entertainment
    { id: 'variety',      name: 'Variety',       cat: 'Entertainment', color: '#94a3b8', url: 'https://variety.com/feed/' },
    // UK
    { id: 'bbc-uk',       name: 'BBC UK',        cat: 'UK',           color: '#bb1919', url: 'https://feeds.bbci.co.uk/news/uk/rss.xml' },
    { id: 'sky-news',     name: 'Sky News',      cat: 'UK',           color: '#e6003d', url: 'https://feeds.skynews.com/feeds/rss/uk.xml' },
    { id: 'guardian-uk',  name: 'Guardian UK',   cat: 'UK',           color: '#0f5290', url: 'https://www.theguardian.com/uk-news/rss' },
    { id: 'independent',  name: 'Independent',   cat: 'UK',           color: '#ec1a2e', url: 'https://www.independent.co.uk/news/uk/rss' },
    { id: 'standard',     name: 'Evening Standard', cat: 'UK',        color: '#231f20', url: 'https://www.standard.co.uk/rss' },
    { id: 'metro',        name: 'Metro',         cat: 'UK',           color: '#e3000f', url: 'https://metro.co.uk/feed/' },
    // US
    { id: 'nyt-us',       name: 'NYT US',        cat: 'US',           color: '#5c7080', url: 'https://rss.nytimes.com/services/xml/rss/nyt/US.xml' },
    { id: 'npr',          name: 'NPR',           cat: 'US',           color: '#237bbd', url: 'https://feeds.npr.org/1001/rss.xml' },
    { id: 'cbs',          name: 'CBS News',      cat: 'US',           color: '#0057b8', url: 'https://www.cbsnews.com/latest/rss/main' },
    { id: 'fox',          name: 'Fox News',      cat: 'US',           color: '#003366', url: 'https://moxie.foxnews.com/google-publisher/latest.xml' },
    { id: 'abc',          name: 'ABC News',      cat: 'US',           color: '#1c4ed8', url: 'https://abcnews.go.com/abcnews/topstories' },
    // Politics
    { id: 'politico',     name: 'Politico',      cat: 'Politics',     color: '#dc0228', url: 'https://rss.politico.com/politics-news.xml' },
    { id: 'thehill',      name: 'The Hill',      cat: 'Politics',     color: '#003399', url: 'https://thehill.com/feed/' },
    { id: 'bbc-politics', name: 'BBC Politics',  cat: 'Politics',     color: '#bb1919', url: 'https://feeds.bbci.co.uk/news/politics/rss.xml' },
    { id: 'guardian-pol', name: 'Guardian Politics', cat: 'Politics', color: '#0f5290', url: 'https://www.theguardian.com/politics/rss' },
    { id: 'nyt-politics', name: 'NYT Politics',  cat: 'Politics',     color: '#5c7080', url: 'https://rss.nytimes.com/services/xml/rss/nyt/Politics.xml' },
];

const NEWS_CATEGORIES = ['World', 'UK', 'US', 'Politics', 'Tech', 'Business', 'Science', 'Sports', 'Gaming', 'Entertainment', 'Custom'];
const NEWS_DEFAULT_ON = ['bbc-world', 'guardian', 'bbc-uk', 'nyt-us', 'politico', 'verge', 'techcrunch', 'nasa', 'bbc-sport'];

// ── State ──────────────────────────────────────────────────────────
let newsData      = { enabled: {}, custom: [] };   // persisted
let newsCache     = {};      // sourceKey → { at, items: [] }
let newsItems     = [];      // merged, sorted
let newsActiveCat    = 'All';
let newsActiveSource = null;    // outlet id filter (null = all)
let newsSearch       = '';
let newsLoading   = 0;       // feeds currently in flight
let newsFailures  = [];      // names of sources that failed last refresh
const NEWS_TTL    = 10 * 60 * 1000;

// ── Persistence ────────────────────────────────────────────────────
function loadNewsData() {
    try {
        if (fs.existsSync(NEWS_FILE)) {
            const d = JSON.parse(fs.readFileSync(NEWS_FILE, 'utf8'));
            return { enabled: d.enabled || {}, custom: d.custom || [] };
        }
    } catch (_) {}
    const enabled = {};
    NEWS_DEFAULT_ON.forEach(id => enabled[id] = true);
    return { enabled, custom: [] };
}
function saveNewsData() {
    try { fs.writeFileSync(NEWS_FILE, JSON.stringify(newsData, null, 2)); }
    catch (e) { console.error('[news] save failed:', e); }
}

// ── Helpers ────────────────────────────────────────────────────────
function nEsc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function newsTimeAgo(t) {
    if (!t) return '';
    const s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 60)        return 'just now';
    if (s < 3600)      return Math.floor(s / 60) + 'm ago';
    if (s < 86400)     return Math.floor(s / 3600) + 'h ago';
    if (s < 86400 * 7) return Math.floor(s / 86400) + 'd ago';
    const d = new Date(t);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
// All sources the user has enabled (catalog + custom feeds)
function newsEnabledSources() {
    const list = NEWS_OUTLETS.filter(o => newsData.enabled[o.id]);
    (newsData.custom || []).forEach(c => list.push({
        id: c.id, name: c.name, cat: c.cat || 'Custom', color: c.color || '#10b981', url: c.url, custom: true,
    }));
    return list;
}
function newsOpenLink(url) {
    if (!/^https?:\/\//i.test(url)) return;
    try { require('electron').shell.openExternal(url); } catch (_) {}
}

// ── Fetching ───────────────────────────────────────────────────────
// Node http(s) request (renderer fetch would be blocked by CORS)
function newsFetchXml(url, redirects) {
    if (redirects === undefined) redirects = 5;
    return new Promise((resolve, reject) => {
        let mod;
        try { mod = url.startsWith('https') ? require('https') : require('http'); }
        catch (e) { return reject(e); }
        const req = mod.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh) VulsorNews/1.0 RSS Reader',
                'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
            },
        }, res => {
            if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
                res.resume();
                let next;
                try { next = new URL(res.headers.location, url).href; }
                catch (_) { return reject(new Error('bad redirect')); }
                return resolve(newsFetchXml(next, redirects - 1));
            }
            if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
            let data = '';
            res.setEncoding('utf8');
            res.on('data', c => { data += c; });
            res.on('end', () => resolve(data));
        });
        req.on('error', reject);
        req.setTimeout(12000, () => req.destroy(new Error('timeout')));
    });
}

// ── Parsing (RSS 2.0 + Atom) ───────────────────────────────────────
function _newsText(parent, tag) {
    const el = parent.getElementsByTagName(tag)[0];
    return el ? (el.textContent || '').trim() : '';
}
function _newsStripHtml(html) {
    if (!html) return '';
    try {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
    } catch (_) { return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); }
}
function _newsFindImage(item, descHtml) {
    // enclosure / media:content / media:thumbnail
    const encl = item.getElementsByTagName('enclosure')[0];
    if (encl) {
        const u = encl.getAttribute('url') || '';
        const t = encl.getAttribute('type') || '';
        if (u && (t.startsWith('image') || /\.(png|jpe?g|gif|webp)(\?|$)/i.test(u))) return u;
    }
    const mediaTags = ['media:content', 'media:thumbnail'];
    for (const tag of mediaTags) {
        const els = item.getElementsByTagName(tag);
        for (let i = 0; i < els.length; i++) {
            const u = els[i].getAttribute('url') || '';
            const t = els[i].getAttribute('type') || els[i].getAttribute('medium') || '';
            if (u && (!t || t.includes('image') || /\.(png|jpe?g|gif|webp)(\?|$)/i.test(u))) return u;
        }
    }
    // fallback: first <img> in the description HTML
    if (descHtml) {
        const m = descHtml.match(/<img[^>]+src=["']([^"']+)["']/i);
        if (m && /^https?:\/\//i.test(m[1])) return m[1];
    }
    return null;
}
function newsParseFeed(xml, source) {
    let doc;
    try { doc = new DOMParser().parseFromString(xml, 'text/xml'); } catch (_) { return []; }
    if (!doc || doc.getElementsByTagName('parsererror').length) return [];
    const out = [];

    // RSS 2.0
    const rssItems = doc.getElementsByTagName('item');
    for (let i = 0; i < rssItems.length && out.length < 40; i++) {
        const it   = rssItems[i];
        const title = _newsText(it, 'title');
        const link  = _newsText(it, 'link') || (it.getElementsByTagName('guid')[0]?.textContent || '').trim();
        if (!title || !/^https?:\/\//i.test(link)) continue;
        const descHtml = _newsText(it, 'description') || _newsText(it, 'content:encoded');
        const dateStr  = _newsText(it, 'pubDate') || _newsText(it, 'dc:date');
        out.push({
            title, link,
            desc: _newsStripHtml(descHtml).slice(0, 220),
            img: _newsFindImage(it, descHtml),
            time: dateStr ? (Date.parse(dateStr) || 0) : 0,
            sourceId: source.id, sourceName: source.name, color: source.color, cat: source.cat,
        });
    }
    if (out.length) return out;

    // Atom
    const entries = doc.getElementsByTagName('entry');
    for (let i = 0; i < entries.length && out.length < 40; i++) {
        const it    = entries[i];
        const title = _newsText(it, 'title');
        let link = '';
        const links = it.getElementsByTagName('link');
        for (let k = 0; k < links.length; k++) {
            const rel = links[k].getAttribute('rel');
            if (!rel || rel === 'alternate') { link = links[k].getAttribute('href') || ''; break; }
        }
        if (!title || !/^https?:\/\//i.test(link)) continue;
        const descHtml = _newsText(it, 'summary') || _newsText(it, 'content');
        const dateStr  = _newsText(it, 'published') || _newsText(it, 'updated');
        out.push({
            title, link,
            desc: _newsStripHtml(descHtml).slice(0, 220),
            img: _newsFindImage(it, descHtml),
            time: dateStr ? (Date.parse(dateStr) || 0) : 0,
            sourceId: source.id, sourceName: source.name, color: source.color, cat: source.cat,
        });
    }
    return out;
}

// ── Refresh ────────────────────────────────────────────────────────
function newsRefresh(force) {
    const sources = newsEnabledSources();
    newsFailures = [];
    const stale = sources.filter(s => force || !newsCache[s.id] || (Date.now() - newsCache[s.id].at) > NEWS_TTL);
    if (!stale.length) { _newsMerge(); renderNews(); return; }

    newsLoading = stale.length;
    _newsStatus();
    stale.forEach(src => {
        newsFetchXml(src.url)
            .then(xml => {
                const items = newsParseFeed(xml, src);
                newsCache[src.id] = { at: Date.now(), items };
                if (!items.length) newsFailures.push(src.name);
            })
            .catch(err => {
                console.warn('[news]', src.name, 'failed:', err.message);
                newsFailures.push(src.name);
                if (!newsCache[src.id]) newsCache[src.id] = { at: Date.now(), items: [] };
            })
            .finally(() => {
                newsLoading--;
                _newsMerge();
                renderNews();   // progressive: cards appear as feeds land
            });
    });
}
function _newsMerge() {
    const enabledIds = new Set(newsEnabledSources().map(s => s.id));
    newsItems = [];
    Object.keys(newsCache).forEach(id => {
        if (enabledIds.has(id)) newsItems.push(...newsCache[id].items);
    });
    newsItems.sort((a, b) => (b.time || 0) - (a.time || 0));
}
function _newsStatus() {
    const el = document.getElementById('news-status');
    if (!el) return;
    if (newsLoading > 0) el.textContent = `loading ${newsLoading} source${newsLoading !== 1 ? 's' : ''}…`;
    else {
        const n = newsEnabledSources().length;
        el.textContent = `${n} source${n !== 1 ? 's' : ''}`
            + (newsFailures.length ? ` · ${newsFailures.length} unavailable` : '');
    }
}

// ── Render ─────────────────────────────────────────────────────────
function _newsThumb(it, big) {
    if (it.img) {
        return `<div class="news-thumb${big ? ' news-hero-img' : ''}"><img src="${nEsc(it.img)}" loading="lazy"
            onerror="this.parentElement.classList.add('news-thumb-ph');this.remove()" alt="">
            <i class="fas fa-newspaper" style="color:${it.color}55"></i></div>`;
    }
    // No image → colored gradient placeholder so every card still has a visual
    return `<div class="news-thumb news-thumb-ph${big ? ' news-hero-img' : ''}" style="background:linear-gradient(135deg,${it.color}30,#0b1020 70%)">
        <i class="fas fa-newspaper" style="color:${it.color}66"></i></div>`;
}
function _newsBadge(it) {
    return `<span class="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded" style="background:${it.color}22;color:${it.color}">${nEsc(it.sourceName)}</span>`;
}

function renderNews() {
    const grid = document.getElementById('news-grid');
    if (!grid) return;
    _newsStatus();

    const enabled = newsEnabledSources();

    // Category tabs: All + categories that have enabled sources
    const cats = ['All', ...NEWS_CATEGORIES.filter(c => enabled.some(s => s.cat === c))];
    if (!cats.includes(newsActiveCat)) newsActiveCat = 'All';
    const tabs = document.getElementById('news-tabs');
    if (tabs) {
        tabs.innerHTML = cats.map(c =>
            `<button onclick="newsSetCat('${c}')" class="px-3 py-1.5 rounded-lg text-[11px] font-semibold whitespace-nowrap transition-colors ${
                c === newsActiveCat ? 'bg-red-600/90 text-white' : 'bg-slate-800/80 text-slate-400 hover:text-white hover:bg-slate-700'
            }">${c}</button>`).join('');
    }

    // Source chips: which outlets feed the current tab — click one to filter
    const srcRow = document.getElementById('news-sources');
    if (srcRow) {
        const catSources = enabled.filter(s => newsActiveCat === 'All' || s.cat === newsActiveCat);
        if (!catSources.some(s => s.id === newsActiveSource)) newsActiveSource = null;
        srcRow.innerHTML = catSources.map(s =>
            `<button onclick="newsSetSource('${s.id}')" class="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold whitespace-nowrap border transition-colors ${
                s.id === newsActiveSource ? 'border-slate-400 bg-slate-700 text-white' : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:text-white hover:border-slate-600'
            }"><span class="w-1.5 h-1.5 rounded-full" style="background:${s.color}"></span>${nEsc(s.name)}</button>`).join('')
            + `<button onclick="newsOpenCustomize()" class="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold whitespace-nowrap border border-dashed border-slate-700 text-slate-500 hover:text-white hover:border-slate-500 transition-colors"><i class="fas fa-plus text-[8px]"></i>Add sources</button>`;
    }

    // Filter
    const q = newsSearch.toLowerCase();
    let items = newsItems.filter(it =>
        (newsActiveCat === 'All' || it.cat === newsActiveCat) &&
        (!newsActiveSource || it.sourceId === newsActiveSource) &&
        (!q || it.title.toLowerCase().includes(q) || (it.desc || '').toLowerCase().includes(q)));
    items = items.slice(0, 140);

    if (!items.length) {
        grid.innerHTML = `<div class="col-span-full text-center py-20">
            <i class="fas fa-newspaper text-slate-700 text-4xl mb-4"></i>
            <p class="text-slate-500 text-sm mb-4">${newsLoading ? 'Loading headlines…'
                : (enabled.length ? 'No articles match this filter.' : 'No sources enabled yet.')}</p>
            ${!newsLoading ? `<button onclick="newsOpenCustomize()" class="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-semibold transition-colors"><i class="fas fa-sliders-h mr-1.5"></i>Choose your sources</button>` : ''}
        </div>`;
        return;
    }

    // Hero: the newest story that has an image leads the page
    let heroIdx = items.findIndex(it => it.img);
    if (heroIdx > 4 || heroIdx === -1) heroIdx = -1;   // only feature genuinely fresh stories
    const hero = heroIdx >= 0 ? items.splice(heroIdx, 1)[0] : null;

    const heroHtml = hero ? `
        <div class="news-card news-hero" data-url="${nEsc(hero.link)}" onclick="newsOpenLink(this.dataset.url)">
            ${_newsThumb(hero, true)}
            <div class="p-5 flex flex-col gap-2 flex-1 justify-center min-w-0">
                <div class="flex items-center gap-2">${_newsBadge(hero)}<span class="text-slate-500 text-[10px] tabular-nums">${newsTimeAgo(hero.time)}</span></div>
                <div class="text-slate-50 text-xl font-bold leading-snug news-clamp3">${nEsc(hero.title)}</div>
                ${hero.desc ? `<div class="text-slate-400 text-[13px] leading-relaxed news-clamp3">${nEsc(hero.desc)}</div>` : ''}
                <span class="text-red-400 text-[11px] font-semibold mt-1">Read the full story <i class="fas fa-arrow-right ml-1"></i></span>
            </div>
        </div>` : '';

    grid.innerHTML = heroHtml + items.map(it => `
        <div class="news-card" data-url="${nEsc(it.link)}" onclick="newsOpenLink(this.dataset.url)">
            ${_newsThumb(it, false)}
            <div class="p-3.5 flex flex-col gap-1.5">
                <div class="flex items-center gap-2">
                    ${_newsBadge(it)}
                    <span class="text-slate-500 text-[10px] ml-auto tabular-nums">${newsTimeAgo(it.time)}</span>
                </div>
                <div class="text-slate-100 text-[13px] font-semibold leading-snug news-clamp3">${nEsc(it.title)}</div>
                ${it.desc ? `<div class="text-slate-500 text-[11px] leading-relaxed news-clamp2">${nEsc(it.desc)}</div>` : ''}
            </div>
        </div>`).join('');
}
function newsSetCat(c)      { newsActiveCat = c; newsActiveSource = null; renderNews(); }
function newsSetSource(id)  { newsActiveSource = (newsActiveSource === id ? null : id); renderNews(); }

// ── Customize modal ────────────────────────────────────────────────
function newsOpenCustomize() {
    const body = document.getElementById('news-modal-body');
    if (!body) return;

    const groups = {};
    NEWS_CATEGORIES.forEach(c => {
        const outlets = NEWS_OUTLETS.filter(o => o.cat === c);
        if (outlets.length) groups[c] = outlets;
    });
    const onCount = NEWS_OUTLETS.filter(o => newsData.enabled[o.id]).length + newsData.custom.length;

    let html = `<p class="text-slate-400 text-xs mb-4 leading-relaxed">Pick the outlets you want in your feed — <span class="text-slate-200 font-semibold">${onCount} enabled</span>, ${NEWS_OUTLETS.length} available across ${Object.keys(groups).length} categories. Changes apply immediately.</p>`;
    Object.entries(groups).forEach(([cat, outlets]) => {
        const catOn = outlets.filter(o => newsData.enabled[o.id]).length;
        html += `<div class="flex items-center gap-2 mb-1.5 mt-4 first:mt-0">
            <span class="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">${cat}</span>
            <span class="text-[10px] text-slate-600 tabular-nums">${catOn}/${outlets.length}</span>
            <span class="flex-1"></span>
            <button onclick="newsSetCategoryAll('${cat}', true)" class="text-[10px] text-slate-500 hover:text-red-300 font-semibold">All</button>
            <span class="text-slate-700 text-[10px]">·</span>
            <button onclick="newsSetCategoryAll('${cat}', false)" class="text-[10px] text-slate-500 hover:text-red-300 font-semibold">None</button>
        </div>
        <div class="grid grid-cols-2 gap-1.5">` +
        outlets.map(o => `
            <label class="flex items-center gap-2.5 px-3 py-2 rounded-xl border cursor-pointer transition-colors ${
                newsData.enabled[o.id] ? 'border-red-500/40 bg-red-500/5' : 'border-slate-800 hover:border-slate-700'
            }">
                <input type="checkbox" ${newsData.enabled[o.id] ? 'checked' : ''} onchange="newsToggleSource('${o.id}', this.checked)" class="accent-red-500 w-3.5 h-3.5">
                <span class="w-2 h-2 rounded-full shrink-0" style="background:${o.color}"></span>
                <span class="text-slate-200 text-xs font-medium">${nEsc(o.name)}</span>
            </label>`).join('') + `</div>`;
    });

    // Custom feeds
    html += `<div class="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-1.5 mt-5">Custom RSS feeds</div>`;
    if (newsData.custom.length) {
        html += `<div class="flex flex-col gap-1.5 mb-3">` + newsData.custom.map(c => `
            <div class="flex items-center gap-2.5 px-3 py-2 rounded-xl border border-slate-800">
                <span class="w-2 h-2 rounded-full shrink-0" style="background:${c.color || '#10b981'}"></span>
                <div class="min-w-0 flex-1">
                    <div class="text-slate-200 text-xs font-medium truncate">${nEsc(c.name)} <span class="text-slate-600 font-normal">· ${nEsc(c.cat || 'Custom')}</span></div>
                    <div class="text-slate-600 text-[10px] truncate">${nEsc(c.url)}</div>
                </div>
                <button onclick="newsRemoveCustom('${c.id}')" class="text-slate-600 hover:text-red-400 text-xs shrink-0"><i class="fas fa-trash"></i></button>
            </div>`).join('') + `</div>`;
    }
    html += `<div class="grid grid-cols-[1fr_1fr] gap-2 mb-2">
            <input id="news-custom-name" placeholder="Name (e.g. Le Monde)" class="bg-slate-800/80 text-slate-100 text-xs border border-slate-700/60 rounded-xl px-3 py-2 outline-none focus:border-red-500/60" style="color-scheme:dark">
            <select id="news-custom-cat" class="bg-slate-800/80 text-slate-300 text-xs border border-slate-700/60 rounded-xl px-3 py-2 outline-none" style="color-scheme:dark">
                ${NEWS_CATEGORIES.map(c => `<option value="${c}" ${c === 'Custom' ? 'selected' : ''}>${c}</option>`).join('')}
            </select>
        </div>
        <div class="flex gap-2">
            <input id="news-custom-url" placeholder="RSS feed URL (https://…/rss.xml)" class="flex-1 bg-slate-800/80 text-slate-100 text-xs border border-slate-700/60 rounded-xl px-3 py-2 outline-none focus:border-red-500/60" style="color-scheme:dark">
            <button onclick="newsAddCustom()" class="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-semibold transition-colors shrink-0">Add</button>
        </div>
        <p id="news-custom-err" class="text-red-400 text-[11px] mt-2 hidden"></p>`;

    body.innerHTML = html;
    document.getElementById('news-modal').style.display = 'flex';
}
function newsCloseCustomize() {
    document.getElementById('news-modal').style.display = 'none';
}
function newsToggleSource(id, on) {
    newsData.enabled[id] = !!on;
    saveNewsData();
    newsOpenCustomize();     // re-render checkbox styles
    newsRefresh();
}
function newsSetCategoryAll(cat, on) {
    NEWS_OUTLETS.filter(o => o.cat === cat).forEach(o => { newsData.enabled[o.id] = on; });
    saveNewsData();
    newsOpenCustomize();
    newsRefresh();
}
function newsAddCustom() {
    const name = document.getElementById('news-custom-name')?.value.trim();
    const url  = document.getElementById('news-custom-url')?.value.trim();
    const cat  = document.getElementById('news-custom-cat')?.value || 'Custom';
    const err  = document.getElementById('news-custom-err');
    const fail = msg => { if (err) { err.textContent = msg; err.classList.remove('hidden'); } };
    if (!name)                        return fail('Give the feed a name.');
    if (!/^https?:\/\//i.test(url))   return fail('The URL must start with http(s)://');
    const id = 'cf_' + Date.now();
    newsData.custom.push({ id, name, url, cat, color: '#10b981' });
    saveNewsData();
    newsOpenCustomize();
    newsRefresh(true);
}
function newsRemoveCustom(id) {
    newsData.custom = newsData.custom.filter(c => c.id !== id);
    delete newsCache[id];
    saveNewsData();
    newsOpenCustomize();
    _newsMerge();
    renderNews();
}

// ── Init ───────────────────────────────────────────────────────────
let _newsInitialised = false;
function initNews() {
    newsData = loadNewsData();

    document.getElementById('news-refresh-btn')?.addEventListener('click', () => newsRefresh(true));
    document.getElementById('news-customize-btn')?.addEventListener('click', newsOpenCustomize);
    document.getElementById('news-modal-close')?.addEventListener('click', newsCloseCustomize);
    document.getElementById('news-modal')?.addEventListener('click', e => {
        if (e.target.id === 'news-modal') newsCloseCustomize();
    });
    let t = null;
    document.getElementById('news-search')?.addEventListener('input', e => {
        clearTimeout(t);
        t = setTimeout(() => { newsSearch = e.target.value.trim(); renderNews(); }, 200);
    });
    _newsInitialised = true;
}

// Called by main.js when the view is shown — first show triggers a fetch
function renderNewsView() {
    if (!_newsInitialised) return;
    renderNews();
    newsRefresh(false);   // respects the 10-min cache
}
