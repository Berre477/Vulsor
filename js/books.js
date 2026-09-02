// ── Books — track what you're reading, want to read & have finished ──
// Depends on: globals.js (fs, path, BOOKS_FILE)
// Exposes: renderBooks()

function loadBooksData() {
    try {
        if (fs.existsSync(BOOKS_FILE))
            return JSON.parse(fs.readFileSync(BOOKS_FILE, 'utf8'));
    } catch (_) {}
    return { books: [] };
}
function saveBooksData() {
    try { fs.writeFileSync(BOOKS_FILE, JSON.stringify(booksData, null, 2)); } catch (_) {}
}

// ── State ──────────────────────────────────────────────────────────
let booksData       = { books: [] };
let bookActiveId    = null;
let bookStatusFilter = 'All';
let bookSearch      = '';
let bookSaveTimer   = null;
let booksBuilt      = false;

const BOOK_ACCENT = '#b45309';

// status key → { label, color } — the order here is the filter-chip order.
const BOOK_STATUS = {
    want:     { label: 'Want to Read',   color: '#64748b' },
    reading:  { label: 'Reading',        color: '#3b82f6' },
    finished: { label: 'Finished',       color: '#10b981' },
    dnf:      { label: 'Did not finish', color: '#f43f5e' },
};
const BOOK_STATUS_KEYS = Object.keys(BOOK_STATUS);

// ── Helpers ────────────────────────────────────────────────────────
function bookNewId() { return 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

function bookBlank() {
    return {
        id: bookNewId(), title: 'Untitled book', author: '', status: 'want',
        totalPages: 0, currentPage: 0, rating: 0, genre: '',
        started: '', finished: '', notes: '',
        created: Date.now(), updated: Date.now(),
    };
}

function bookById(id) { return booksData.books.find(b => b.id === id) || null; }

function bookStatusMeta(s) { return BOOK_STATUS[s] || BOOK_STATUS.want; }

function bookProgress(b) {
    const tot = parseInt(b.totalPages, 10) || 0;
    const cur = parseInt(b.currentPage, 10) || 0;
    if (tot <= 0) return 0;
    return Math.max(0, Math.min(100, Math.round((cur / tot) * 100)));
}

function bookFilteredList() {
    const q = bookSearch.trim().toLowerCase();
    return booksData.books
        .filter(b => bookStatusFilter === 'All' || b.status === bookStatusFilter)
        .filter(b => !q || (b.title + ' ' + b.author + ' ' + b.genre).toLowerCase().includes(q))
        .sort((a, b) => (b.updated || 0) - (a.updated || 0));
}

function bookToday() { return new Date().toISOString().slice(0, 10); }

// ── Mutations ──────────────────────────────────────────────────────
function bookCreate() {
    const b = bookBlank();
    booksData.books.unshift(b);
    bookActiveId = b.id;
    saveBooksData();
    renderBooksList();
    renderBooksStats();
    renderBookDetail();
    setTimeout(() => { const n = document.getElementById('book-title'); if (n) { n.focus(); n.select(); } }, 30);
}

function bookSelect(id) {
    bookActiveId = id;
    renderBooksList();
    renderBookDetail();
}

function bookDelete(id) {
    const b = bookById(id);
    if (!b) return;
    if (!confirm(`Delete "${b.title || 'this book'}"?`)) return;
    booksData.books = booksData.books.filter(x => x.id !== id);
    if (bookActiveId === id) {
        const list = bookFilteredList();
        bookActiveId = list.length ? list[0].id : null;
    }
    saveBooksData();
    renderBooksList();
    renderBooksStats();
    renderBookDetail();
}

function bookScheduleSave() {
    clearTimeout(bookSaveTimer);
    const status = document.getElementById('book-save-status');
    if (status) status.textContent = 'saving…';
    bookSaveTimer = setTimeout(() => {
        saveBooksData();
        if (status) status.textContent = 'saved';
    }, 400);
}

// Pull an editor field value into the active book.
function bookCommitField(field, value) {
    const b = bookById(bookActiveId);
    if (!b) return;
    b[field] = value;
    b.updated = Date.now();
    if (field === 'title' || field === 'author') renderBooksList();
    bookScheduleSave();
}

// Page fields update progress live without re-rendering the whole editor
// (which would steal focus mid-typing).
function bookCommitPage(field, value) {
    const b = bookById(bookActiveId);
    if (!b) return;
    b[field] = Math.max(0, parseInt(value, 10) || 0);
    if (field === 'currentPage' && b.totalPages && b.currentPage > b.totalPages) b.currentPage = b.totalPages;
    b.updated = Date.now();
    const pct = bookProgress(b);
    const bar = document.getElementById('book-progress-bar');
    const lbl = document.getElementById('book-progress-label');
    if (bar) bar.style.width = pct + '%';
    if (lbl) lbl.textContent = `${b.currentPage || 0} / ${b.totalPages || 0} pages · ${pct}%`;
    renderBooksList();
    bookScheduleSave();
}

// Status changes carry sensible side-effects (auto-stamp dates, complete pages).
function bookSetStatus(value) {
    const b = bookById(bookActiveId);
    if (!b) return;
    b.status = value;
    if (value === 'reading' && !b.started) b.started = bookToday();
    if (value === 'finished') {
        if (!b.finished) b.finished = bookToday();
        if (b.totalPages) b.currentPage = b.totalPages;
    }
    b.updated = Date.now();
    saveBooksData();
    renderBooksList();
    renderBooksStats();
    renderBookDetail();
}

function bookSetRating(n) {
    const b = bookById(bookActiveId);
    if (!b) return;
    b.rating = (b.rating === n) ? 0 : n;   // click the current rating to clear it
    b.updated = Date.now();
    saveBooksData();
    renderBookDetail();
}

// ── Rendering: header stats ────────────────────────────────────────
function renderBooksStats() {
    const el = document.getElementById('books-stats');
    if (!el) return;
    const books = booksData.books;
    const reading = books.filter(b => b.status === 'reading').length;
    const yr = new Date().getFullYear();
    const finishedYr = books.filter(b => b.status === 'finished' && (b.finished || '').slice(0, 4) === String(yr)).length;
    const pages = books.reduce((s, b) => s + (b.status === 'finished' ? (parseInt(b.totalPages, 10) || 0) : (parseInt(b.currentPage, 10) || 0)), 0);
    if (!books.length) { el.innerHTML = ''; return; }
    const stat = (val, lbl) => `<span class="text-slate-300 font-semibold">${val}</span><span class="text-slate-500"> ${lbl}</span>`;
    el.innerHTML = `<div class="flex items-center gap-3 text-[11px]">
        ${stat(reading, 'reading')}<span class="text-slate-700">·</span>
        ${stat(finishedYr, `read in ${yr}`)}<span class="text-slate-700">·</span>
        ${stat(pages.toLocaleString(), 'pages')}</div>`;
}

// ── Rendering: sidebar list ────────────────────────────────────────
function renderBooksList() {
    const wrap = document.getElementById('books-list');
    if (!wrap) return;
    const list = bookFilteredList();

    if (!booksData.books.length) {
        wrap.innerHTML = `<div class="text-center text-slate-600 text-xs px-4 py-10 leading-relaxed">
            No books yet.<br>Hit <span style="color:${BOOK_ACCENT}">New book</span> to add the first one.</div>`;
        return;
    }
    if (!list.length) {
        wrap.innerHTML = `<div class="text-center text-slate-600 text-xs px-4 py-10">No books match.</div>`;
        return;
    }

    wrap.innerHTML = list.map(b => {
        const active = b.id === bookActiveId;
        const sm = bookStatusMeta(b.status);
        const pct = bookProgress(b);
        const sub = b.author ? escapeBook(b.author) : 'Unknown author';
        const progressRow = b.status === 'reading' && b.totalPages
            ? `<div class="h-1 rounded-full bg-slate-700/60 mt-1.5 overflow-hidden"><div class="h-full rounded-full" style="width:${pct}%;background:${sm.color}"></div></div>`
            : '';
        const stars = b.status === 'finished' && b.rating
            ? `<span class="text-amber-400 text-[10px]">${'★'.repeat(b.rating)}${'☆'.repeat(5 - b.rating)}</span>` : '';
        return `<button data-bid="${b.id}" class="book-item w-full text-left px-3 py-2.5 rounded-lg mb-1 transition-colors ${active ? '' : 'hover:bg-slate-800/50'}"
            style="${active ? `background:rgba(180,83,9,0.12);border:1px solid rgba(180,83,9,0.3)` : 'border:1px solid transparent'}">
            <div class="flex items-center gap-2">
                <span class="w-2 h-2 rounded-full shrink-0" style="background:${sm.color}"></span>
                <span class="text-slate-200 text-sm font-medium truncate flex-1">${escapeBook(b.title || 'Untitled')}</span>
                ${stars}
            </div>
            <div class="text-slate-500 text-[10px] mt-0.5 truncate pl-4">${sub}<span class="text-slate-600"> · ${sm.label}</span></div>
            ${progressRow}
        </button>`;
    }).join('');

    wrap.querySelectorAll('.book-item').forEach(btn => {
        btn.addEventListener('click', () => bookSelect(btn.getAttribute('data-bid')));
    });
}

// ── Rendering: status filter chips ─────────────────────────────────
function renderBookFilter() {
    const wrap = document.getElementById('books-status-filter');
    if (!wrap) return;
    const chips = [['All', 'All', null]].concat(BOOK_STATUS_KEYS.map(k => [k, BOOK_STATUS[k].label, BOOK_STATUS[k].color]));
    wrap.innerHTML = chips.map(([key, label, color]) => {
        const on = key === bookStatusFilter;
        const c = color || BOOK_ACCENT;
        return `<button data-status="${key}" class="book-chip text-[10px] px-2 py-1 rounded-full transition-colors"
            style="${on ? `background:${c}2e;color:${c};border:1px solid ${c}59`
                        : 'background:rgba(30,41,59,0.6);color:#94a3b8;border:1px solid rgba(51,65,85,0.6)'}">${label}</button>`;
    }).join('');
    wrap.querySelectorAll('.book-chip').forEach(btn => {
        btn.addEventListener('click', () => {
            bookStatusFilter = btn.getAttribute('data-status');
            renderBookFilter();
            renderBooksList();
        });
    });
}

// ── Rendering: detail editor ───────────────────────────────────────
function renderBookDetail() {
    const wrap = document.getElementById('books-detail');
    if (!wrap) return;
    const b = bookById(bookActiveId);

    if (!b) {
        wrap.innerHTML = `<div class="flex-1 flex flex-col items-center justify-center text-center text-slate-600 px-8">
            <i class="fas fa-book-open text-4xl mb-4" style="color:rgba(180,83,9,0.4)"></i>
            <p class="text-slate-400 text-sm font-medium">No book selected</p>
            <p class="text-slate-600 text-xs mt-1">Pick one on the left, or add a new book.</p>
        </div>`;
        return;
    }

    const inputCls = 'bg-slate-800/70 text-slate-200 text-sm border border-slate-700/60 rounded-lg px-3 py-2 outline-none focus:border-amber-600/60 transition-colors';
    const taCls = 'w-full bg-slate-800/40 text-slate-200 text-sm leading-relaxed border border-slate-700/50 rounded-xl px-4 py-3 outline-none resize-none chat-scroll placeholder-slate-600 focus:border-amber-600/50 transition-colors';
    const labelCls = 'text-slate-500 text-[10px] font-semibold uppercase tracking-widest';

    const statusOpts = BOOK_STATUS_KEYS.map(k => `<option value="${k}" ${k === b.status ? 'selected' : ''}>${BOOK_STATUS[k].label}</option>`).join('');
    const pct = bookProgress(b);
    const sm = bookStatusMeta(b.status);

    const stars = [1, 2, 3, 4, 5].map(n =>
        `<button data-star="${n}" class="book-star text-xl leading-none transition-colors ${n <= (b.rating || 0) ? 'text-amber-400' : 'text-slate-600 hover:text-amber-400/60'}">${n <= (b.rating || 0) ? '★' : '☆'}</button>`
    ).join('');

    wrap.innerHTML = `
    <div class="max-w-3xl w-full mx-auto px-8 py-7">
        <div class="flex items-start justify-between gap-4 mb-1">
            <input id="book-title" type="text" value="${escapeBook(b.title)}" placeholder="Book title"
                class="flex-1 bg-transparent text-slate-100 text-2xl font-bold outline-none placeholder-slate-700 border-b border-transparent focus:border-slate-700 pb-1" style="min-width:0">
            <button id="book-delete" title="Delete book"
                class="shrink-0 w-9 h-9 rounded-lg bg-slate-800 hover:bg-red-600/20 border border-slate-700/60 hover:border-red-600/40 text-slate-400 hover:text-red-400 flex items-center justify-center transition-colors">
                <i class="fas fa-trash-alt text-xs"></i>
            </button>
        </div>
        <input id="book-author" type="text" value="${escapeBook(b.author)}" placeholder="Author"
            class="w-full bg-transparent text-slate-400 text-sm outline-none placeholder-slate-700 mb-6">

        <div class="flex flex-wrap gap-3 mb-6">
            <label class="flex flex-col gap-1">
                <span class="${labelCls}">Status</span>
                <select id="book-status" class="${inputCls}" style="min-width:150px">${statusOpts}</select>
            </label>
            <label class="flex flex-col gap-1">
                <span class="${labelCls}">Genre</span>
                <input id="book-genre" type="text" value="${escapeBook(b.genre)}" placeholder="Fiction, sci-fi…" class="${inputCls}" style="width:150px">
            </label>
            <label class="flex flex-col gap-1">
                <span class="${labelCls}">Started</span>
                <input id="book-started" type="date" value="${escapeBook(b.started)}" class="${inputCls}">
            </label>
            <label class="flex flex-col gap-1">
                <span class="${labelCls}">Finished</span>
                <input id="book-finished" type="date" value="${escapeBook(b.finished)}" class="${inputCls}">
            </label>
        </div>

        <div class="mb-6">
            <div class="flex items-center justify-between mb-2">
                <span class="${labelCls}">Reading progress</span>
                <span id="book-progress-label" class="text-slate-400 text-[11px]">${b.currentPage || 0} / ${b.totalPages || 0} pages · ${pct}%</span>
            </div>
            <div class="h-2 rounded-full bg-slate-700/60 overflow-hidden mb-3">
                <div id="book-progress-bar" class="h-full rounded-full transition-all" style="width:${pct}%;background:${sm.color}"></div>
            </div>
            <div class="flex gap-3">
                <label class="flex flex-col gap-1">
                    <span class="${labelCls}">Current page</span>
                    <input id="book-current" type="number" min="0" value="${b.currentPage || 0}" class="${inputCls}" style="width:120px">
                </label>
                <label class="flex flex-col gap-1">
                    <span class="${labelCls}">Total pages</span>
                    <input id="book-total" type="number" min="0" value="${b.totalPages || 0}" class="${inputCls}" style="width:120px">
                </label>
            </div>
        </div>

        <div class="mb-6">
            <span class="${labelCls}">Rating</span>
            <div class="flex items-center gap-1 mt-1">${stars}</div>
        </div>

        <div class="mb-4">
            <div class="flex items-center gap-2 mb-2">
                <i class="fas fa-pen-nib text-xs" style="color:${BOOK_ACCENT}"></i>
                <h3 class="text-slate-300 text-xs font-semibold uppercase tracking-widest">Notes &amp; review</h3>
            </div>
            <textarea id="book-notes" rows="6" class="${taCls}" placeholder="Thoughts, favourite quotes, what you took away…">${escapeBook(b.notes)}</textarea>
        </div>

        <div class="text-right">
            <span id="book-save-status" class="text-slate-700 text-xs italic">saved</span>
        </div>
    </div>`;

    // ── Wire editor events ──
    const bind = (id, field, ev) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener(ev || 'input', () => bookCommitField(field, el.value));
    };
    bind('book-title', 'title');
    bind('book-author', 'author');
    bind('book-genre', 'genre');
    bind('book-started', 'started', 'change');
    bind('book-finished', 'finished', 'change');
    bind('book-notes', 'notes');

    const statusSel = document.getElementById('book-status');
    if (statusSel) statusSel.addEventListener('change', () => bookSetStatus(statusSel.value));

    const cur = document.getElementById('book-current');
    if (cur) cur.addEventListener('input', () => bookCommitPage('currentPage', cur.value));
    const tot = document.getElementById('book-total');
    if (tot) tot.addEventListener('input', () => bookCommitPage('totalPages', tot.value));

    wrap.querySelectorAll('.book-star').forEach(s => {
        s.addEventListener('click', () => bookSetRating(parseInt(s.getAttribute('data-star'), 10)));
    });

    // keep keystrokes from bubbling to global app shortcuts
    wrap.querySelectorAll('input, textarea, select').forEach(el => {
        el.addEventListener('keydown', e => e.stopPropagation());
    });
    const del = document.getElementById('book-delete');
    if (del) del.addEventListener('click', () => bookDelete(b.id));
}

function escapeBook(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ── Entry point ────────────────────────────────────────────────────
function renderBooks() {
    booksData = loadBooksData();
    if (!Array.isArray(booksData.books)) booksData.books = [];

    if (!booksBuilt) {
        const nb = document.getElementById('books-new-btn');
        if (nb) nb.addEventListener('click', bookCreate);
        const search = document.getElementById('books-search');
        if (search) {
            search.addEventListener('input', () => { bookSearch = search.value; renderBooksList(); });
            search.addEventListener('keydown', e => e.stopPropagation());
        }
        booksBuilt = true;
    }

    // default selection
    if (!bookById(bookActiveId)) {
        const list = bookFilteredList();
        bookActiveId = list.length ? list[0].id : null;
    }

    renderBookFilter();
    renderBooksStats();
    renderBooksList();
    renderBookDetail();
}
