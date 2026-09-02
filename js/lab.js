// ── Lab — chemistry lab reports ───────────────────────────────────
// Depends on: globals.js (fs, path, LAB_FILE)
// Exposes: initLab(), renderLab()
//
// A "lab" is a category that holds the user's lab reports. Each report is
// a structured chemistry write-up (title, date, course, objective,
// materials, procedure, observations, results, conclusion). Layout mirrors
// the Journal / Recipes sections: a sidebar list on the left, a scrollable
// report form on the right, with debounced auto-save.

function loadLabData() {
    try {
        if (fs.existsSync(LAB_FILE))
            return JSON.parse(fs.readFileSync(LAB_FILE, 'utf8'));
    } catch (_) {}
    return { reports: [] };
}
function saveLabData() {
    try { fs.writeFileSync(LAB_FILE, JSON.stringify(labData, null, 2)); } catch (_) {}
}

// ── State ──────────────────────────────────────────────────────────
let labData        = { reports: [] };
let labActiveId    = null;
let labSearch      = '';
let labSaveTimer   = null;

const LAB_ACCENT = '#14b8a6';

// The editable sections of a report, in display order. `key` maps to the
// report field; `multiline` controls textarea vs single-line input.
const LAB_SECTIONS = [
    { key: 'objective',    label: 'Objective / Aim',        placeholder: 'What is this experiment trying to determine?' },
    { key: 'materials',    label: 'Materials & Apparatus',  placeholder: 'Chemicals, glassware and equipment used…' },
    { key: 'procedure',    label: 'Procedure',              placeholder: 'Step-by-step method you followed…' },
    { key: 'observations', label: 'Observations & Data',    placeholder: 'What you saw and measured — colour changes, temperatures, masses, readings…' },
    { key: 'results',      label: 'Results & Calculations', placeholder: 'Worked calculations, yields, equations…' },
    { key: 'conclusion',   label: 'Conclusion',             placeholder: 'What the results mean, sources of error, evaluation…' },
];

// ── Helpers ────────────────────────────────────────────────────────
function labNewId() { return 'lab' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

function labToday() { return new Date().toISOString().slice(0, 10); }

function labBlank() {
    const r = {
        id: labNewId(), title: 'Untitled report', date: labToday(), course: 'Chemistry',
        created: Date.now(), updated: Date.now(),
    };
    LAB_SECTIONS.forEach(s => { r[s.key] = ''; });
    return r;
}

function labById(id) { return labData.reports.find(r => r.id === id) || null; }

function labFilteredList() {
    const q = labSearch.trim().toLowerCase();
    return labData.reports
        .filter(r => !q || ((r.title || '') + ' ' + (r.course || '') + ' ' + (r.objective || '')).toLowerCase().includes(q))
        .sort((a, b) => (b.updated || 0) - (a.updated || 0));
}

function labFmtDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T12:00:00');
    if (isNaN(d)) return dateStr;
    return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function labEsc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ── Mutations ──────────────────────────────────────────────────────
function labCreate() {
    const r = labBlank();
    labData.reports.unshift(r);
    labActiveId = r.id;
    saveLabData();
    renderLabList();
    renderLabDetail();
    setTimeout(() => { const n = document.getElementById('lab-title'); if (n) { n.focus(); n.select(); } }, 30);
}

function labSelect(id) {
    labActiveId = id;
    renderLabList();
    renderLabDetail();
}

function labDelete(id) {
    const r = labById(id);
    if (!r) return;
    if (!confirm(`Delete "${r.title || 'this report'}"?`)) return;
    labData.reports = labData.reports.filter(x => x.id !== id);
    if (labActiveId === id) {
        const list = labFilteredList();
        labActiveId = list.length ? list[0].id : null;
    }
    saveLabData();
    renderLabList();
    renderLabDetail();
}

// Debounced write back from the editor into the active report.
function labScheduleSave() {
    const status = document.getElementById('lab-save-status');
    if (status) status.textContent = 'saving…';
    clearTimeout(labSaveTimer);
    labSaveTimer = setTimeout(() => {
        const r = labById(labActiveId);
        if (!r) return;
        const titleEl  = document.getElementById('lab-title');
        const dateEl   = document.getElementById('lab-date');
        const courseEl = document.getElementById('lab-course');
        if (titleEl)  r.title  = titleEl.value.trim() || 'Untitled report';
        if (dateEl)   r.date   = dateEl.value;
        if (courseEl) r.course = courseEl.value;
        LAB_SECTIONS.forEach(s => {
            const el = document.getElementById('lab-field-' + s.key);
            if (el) r[s.key] = el.value;
        });
        r.updated = Date.now();
        saveLabData();
        renderLabList();
        if (status) status.textContent = 'saved';
    }, 500);
}

// ── Render: sidebar list ───────────────────────────────────────────
function renderLabList() {
    const listEl = document.getElementById('lab-list');
    if (!listEl) return;
    const list = labFilteredList();

    if (!list.length) {
        listEl.innerHTML = labSearch.trim()
            ? '<p class="text-slate-700 text-xs text-center py-6 italic px-3">No reports match</p>'
            : '<p class="text-slate-700 text-xs text-center py-6 italic px-3">No reports yet</p>';
        return;
    }

    listEl.innerHTML = list.map(r => {
        const isActive = r.id === labActiveId;
        return `<div class="lab-list-item group px-3 py-2.5 rounded-xl cursor-pointer transition-all mb-1 ${
            isActive ? 'border' : 'hover:bg-slate-800/50'
        }" data-id="${r.id}" ${isActive ? 'data-active="true" style="background:rgba(20,184,166,0.12);border-color:rgba(20,184,166,0.25)"' : ''}>
            <div class="flex items-center justify-between gap-2 mb-0.5">
                <span class="text-xs font-semibold truncate" style="${isActive ? 'color:#5eead4' : 'color:#cbd5e1'}">${labEsc(r.title || 'Untitled report')}</span>
                <button class="lab-del-btn opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400 transition shrink-0" data-del="${r.id}" title="Delete report">
                    <i class="fas fa-trash text-[10px]"></i>
                </button>
            </div>
            <div class="flex items-center gap-2">
                <span class="text-slate-600 text-[10px]">${labFmtDate(r.date)}</span>
                ${r.course ? `<span class="text-[9px] px-1.5 py-0.5 rounded-full font-medium" style="background:rgba(20,184,166,0.15);color:#5eead4">${labEsc(r.course)}</span>` : ''}
            </div>
        </div>`;
    }).join('');

    listEl.querySelectorAll('.lab-list-item').forEach(el => {
        el.onclick = e => {
            if (e.target.closest('.lab-del-btn')) return;
            labSelect(el.dataset.id);
        };
    });
    listEl.querySelectorAll('.lab-del-btn').forEach(btn => {
        btn.onclick = e => { e.stopPropagation(); labDelete(btn.dataset.del); };
    });
}

// ── Render: report editor ──────────────────────────────────────────
function renderLabDetail() {
    const wrap = document.getElementById('lab-detail');
    const empty = document.getElementById('lab-empty');
    if (!wrap || !empty) return;

    const r = labById(labActiveId);
    if (!r) {
        wrap.style.display = 'none';
        empty.style.display = 'flex';
        return;
    }
    empty.style.display = 'none';
    wrap.style.display = 'flex';

    const sectionsHtml = LAB_SECTIONS.map(s => `
        <div class="mb-5">
            <label class="block text-slate-400 text-[11px] font-semibold uppercase tracking-widest mb-1.5">${s.label}</label>
            <textarea id="lab-field-${s.key}" rows="4"
                placeholder="${labEsc(s.placeholder)}"
                class="w-full bg-slate-900/40 text-slate-200 text-sm leading-relaxed px-3.5 py-2.5 rounded-xl border border-slate-800/70 outline-none resize-y chat-scroll placeholder-slate-700 focus:border-teal-500/50 transition-colors"
                style="font-family:inherit">${labEsc(r[s.key] || '')}</textarea>
        </div>`).join('');

    wrap.innerHTML = `
        <div class="flex-1 overflow-y-auto chat-scroll px-10 py-7">
            <div class="max-w-3xl mx-auto">
                <!-- Title -->
                <input id="lab-title" type="text" value="${labEsc(r.title || '')}"
                    placeholder="Report title"
                    class="w-full bg-transparent text-slate-100 text-2xl font-bold leading-tight outline-none placeholder-slate-700 mb-3">

                <!-- Meta: date + course -->
                <div class="flex flex-wrap items-center gap-3 mb-7">
                    <div class="flex items-center gap-2">
                        <i class="fas fa-calendar-day text-slate-600 text-xs"></i>
                        <input id="lab-date" type="date" value="${labEsc(r.date || '')}"
                            class="bg-slate-800 text-slate-300 text-xs border border-slate-700/60 rounded-lg px-2 py-1.5 outline-none focus:border-teal-500/50 transition-colors cursor-pointer" style="color-scheme:dark">
                    </div>
                    <div class="flex items-center gap-2">
                        <i class="fas fa-flask text-slate-600 text-xs"></i>
                        <input id="lab-course" type="text" value="${labEsc(r.course || '')}"
                            placeholder="Course / subject"
                            class="bg-slate-800 text-slate-300 text-xs border border-slate-700/60 rounded-lg px-2.5 py-1.5 outline-none focus:border-teal-500/50 transition-colors" style="width:170px">
                    </div>
                </div>

                ${sectionsHtml}
            </div>
        </div>`;

    // Wire auto-save on every field.
    ['lab-title', 'lab-date', 'lab-course'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.oninput = el.onchange = labScheduleSave;
    });
    LAB_SECTIONS.forEach(s => {
        const el = document.getElementById('lab-field-' + s.key);
        if (el) el.oninput = labScheduleSave;
    });
}

// ── Public render (called when the view activates) ─────────────────
function renderLab() {
    // Ensure something is selected if reports exist.
    if (!labById(labActiveId)) {
        const list = labFilteredList();
        labActiveId = list.length ? list[0].id : null;
    }
    renderLabList();
    renderLabDetail();
}

// ── Init ───────────────────────────────────────────────────────────
function initLab() {
    labData = loadLabData();
    if (!labData || !Array.isArray(labData.reports)) labData = { reports: [] };

    const list = labFilteredList();
    labActiveId = list.length ? list[0].id : null;

    const newBtn = document.getElementById('lab-new-btn');
    if (newBtn) newBtn.onclick = labCreate;

    const searchEl = document.getElementById('lab-search');
    if (searchEl) searchEl.oninput = e => { labSearch = e.target.value; renderLabList(); };

    renderLabList();
    renderLabDetail();
}
