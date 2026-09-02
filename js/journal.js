// ── Journal — Daily entries ───────────────────────────────────────
// Depends on: globals.js (fs, path, JOURNAL_FILE)

function loadJournalData() {
    try {
        if (fs.existsSync(JOURNAL_FILE))
            return JSON.parse(fs.readFileSync(JOURNAL_FILE, 'utf8'));
    } catch(_) {}
    return { entries: {} };
}
function saveJournalData() {
    fs.writeFileSync(JOURNAL_FILE, JSON.stringify(journalData, null, 2));
}

// ── State ──────────────────────────────────────────────────────────
let journalData       = { entries: {} };
let journalActiveDate = null; // 'YYYY-MM-DD'
let journalSaveTimer  = null;

// ── Helpers ────────────────────────────────────────────────────────
function journalToday() { return new Date().toISOString().slice(0, 10); }

function journalFmtHeading(dateStr) {
    const d = new Date(dateStr + 'T12:00:00');
    const DAYS   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    return { day: DAYS[d.getDay()], full: `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}` };
}

function journalFmtShort(dateStr) {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function journalWordCount(text) {
    return text.trim() ? text.trim().split(/\s+/).length : 0;
}

function journalPrevDate(dateStr) {
    const d = new Date(dateStr + 'T12:00:00'); d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
}
function journalNextDate(dateStr) {
    const d = new Date(dateStr + 'T12:00:00'); d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
}

// ── Render ─────────────────────────────────────────────────────────
function renderJournalSidebar() {
    const listEl = document.getElementById('journal-entry-list');
    if (!listEl) return;

    const dates = Object.keys(journalData.entries)
        .filter(d => (journalData.entries[d].content || '').trim())
        .sort((a, b) => b.localeCompare(a));

    const today = journalToday();

    // Always show today even if empty
    const allDates = dates.includes(today) ? dates : [today, ...dates];

    if (!allDates.length) {
        listEl.innerHTML = '<p class="text-slate-700 text-xs text-center py-6 italic px-3">No entries yet</p>';
        return;
    }

    listEl.innerHTML = allDates.map(d => {
        const isActive  = d === journalActiveDate;
        const isToday   = d === today;
        const entry     = journalData.entries[d];
        const preview   = (entry?.content || '').trim().slice(0, 60).replace(/\n/g, ' ');
        const wc        = journalWordCount(entry?.content || '');

        return `<div class="journal-sidebar-entry group px-3 py-2.5 rounded-xl cursor-pointer transition-all mb-1 ${
            isActive ? 'border' : 'hover:bg-slate-800/50'
        }" data-date="${d}" ${isActive ? 'data-active="true" style="background:rgba(var(--accent-rgb),0.10);border-color:rgba(var(--accent-rgb),0.20)"' : ''}>
            <div class="flex items-center justify-between mb-0.5">
                <span class="text-xs font-semibold" style="${isActive ? 'color:var(--accent-light)' : 'color:#cbd5e1'}">${journalFmtShort(d)}</span>
                ${isToday ? '<span class="entry-today-badge text-[9px] px-1.5 py-0.5 rounded-full font-medium" style="background:rgba(var(--accent-rgb),0.20);color:var(--accent-light)">Today</span>' : ''}
            </div>
            ${preview
                ? `<p class="text-slate-600 text-[10px] truncate leading-relaxed">${preview}</p>`
                : `<p class="text-slate-700 text-[10px] italic">No entry</p>`}
            ${wc ? `<p class="text-slate-700 text-[9px] mt-0.5">${wc} words</p>` : ''}
        </div>`;
    }).join('');

    listEl.querySelectorAll('.journal-sidebar-entry').forEach(el => {
        el.onclick = () => openJournalDate(el.dataset.date);
    });
}

// Apply the user's customized category color to the Journal header icon.
// Falls back to the default Journal pink (#ec4899) when not customized.
function applyJournalHeaderColor() {
    const hex = (typeof settingsData !== 'undefined' && settingsData.categoryColors && settingsData.categoryColors.journal) || '#ec4899';
    const h = hex.replace('#', '');
    const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
    const r = parseInt(full.slice(0, 2), 16), g = parseInt(full.slice(2, 4), 16), b = parseInt(full.slice(4, 6), 16);
    const wrap = document.getElementById('journal-header-icon-wrap');
    const icon = document.getElementById('journal-header-icon');
    if (wrap) {
        wrap.style.background = `rgba(${r},${g},${b},0.2)`;
        wrap.style.border = `1px solid rgba(${r},${g},${b},0.3)`;
    }
    if (icon) icon.style.color = hex;
}

function renderJournalEditor() {
    applyJournalHeaderColor();
    const date   = journalActiveDate;
    const entry  = journalData.entries[date] || { content: '' };
    const { day, full } = journalFmtHeading(date);
    const today  = journalToday();
    const isToday = date === today;

    // Heading
    const dayEl  = document.getElementById('journal-entry-day');
    const dateEl = document.getElementById('journal-entry-date');
    if (dayEl)  dayEl.textContent  = day;
    if (dateEl) dateEl.textContent = full;

    // Nav buttons
    const prevBtn = document.getElementById('journal-prev-btn');
    const nextBtn = document.getElementById('journal-next-btn');
    if (prevBtn) prevBtn.disabled = false;
    if (nextBtn) nextBtn.disabled = date >= today;

    // Today badge
    const todayBadge = document.getElementById('journal-today-badge');
    if (todayBadge) todayBadge.style.display = isToday ? '' : 'none';

    // Textarea
    const ta = document.getElementById('journal-textarea');
    if (ta) {
        ta.value = entry.content || '';
        updateJournalMeta();
    }
}

function updateJournalMeta() {
    const ta      = document.getElementById('journal-textarea');
    const metaEl  = document.getElementById('journal-word-count');
    if (!ta || !metaEl) return;
    const wc = journalWordCount(ta.value);
    const cc = ta.value.length;
    metaEl.textContent = `${wc} word${wc !== 1 ? 's' : ''} · ${cc} char${cc !== 1 ? 's' : ''}`;
}

function openJournalDate(dateStr) {
    journalActiveDate = dateStr;
    renderJournalEditor();
    renderJournalSidebar();
}

// ── Auto-save ──────────────────────────────────────────────────────
function journalOnInput() {
    const ta = document.getElementById('journal-textarea');
    if (!ta) return;
    updateJournalMeta();
    clearTimeout(journalSaveTimer);
    const savedEl = document.getElementById('journal-save-status');
    if (savedEl) savedEl.textContent = 'saving…';
    journalSaveTimer = setTimeout(() => {
        if (!journalData.entries[journalActiveDate])
            journalData.entries[journalActiveDate] = {};
        journalData.entries[journalActiveDate].content   = ta.value;
        journalData.entries[journalActiveDate].updatedAt = Date.now();
        saveJournalData();
        if (savedEl) savedEl.textContent = 'saved';
        renderJournalSidebar();
    }, 600);
}

// ── Init ───────────────────────────────────────────────────────────
function initJournal() {
    journalData       = loadJournalData();
    journalActiveDate = journalToday();

    document.getElementById('journal-prev-btn').onclick = () => {
        openJournalDate(journalPrevDate(journalActiveDate));
    };
    document.getElementById('journal-next-btn').onclick = () => {
        const next = journalNextDate(journalActiveDate);
        if (next <= journalToday()) openJournalDate(next);
    };
    document.getElementById('journal-today-btn').onclick = () => {
        openJournalDate(journalToday());
    };

    // Date picker jump
    document.getElementById('journal-date-picker').onchange = e => {
        if (e.target.value) openJournalDate(e.target.value);
    };
    document.getElementById('journal-date-picker').max = journalToday();

    document.getElementById('journal-textarea').oninput = journalOnInput;

    renderJournalEditor();
    renderJournalSidebar();
}
