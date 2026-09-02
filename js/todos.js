// ── To-Do List · Categories · Notes · Repeating ────────────────
// Depends on: globals.js

// ── Local UI state ─────────────────────────────────────────────
let expandedNotes     = new Set();   // task ids whose notes are open
let expandedSubtasks  = new Set();   // task ids whose subtask checklist is open
let selectedCatColor  = '#3b82f6';  // default for new category
let selectedCatIcon   = '📌';       // default emoji for new category
let editingTaskId     = null;        // id of task currently being edited
let hideCompleted     = false;       // whether to hide done tasks
let searchQuery       = '';          // live text filter

const CAT_COLORS = [
    '#ef4444','#f97316','#f59e0b','#22c55e',
    '#14b8a6','#3b82f6','#8b5cf6','#ec4899',
];
// Emoji palette for categories — pick one when creating, or tap to cycle later.
const CAT_ICONS = [
    '📌','🛒','🎯','💡','📁','💼','🏠','📚','💪','🍔','✈️','💰','❤️','🎨',
    '🎵','🎮','⚽','🌱','🔧','⭐','🔥','☕','🎁','🧠','📝','🚗','🩺','🐾','💻','🧹',
];
// A category's emoji, defaulting for older categories saved before icons existed.
function catIcon(cat) { return (cat && cat.icon) ? cat.icon : '📌'; }
// Live counts for a category across the whole task list.
function catStats(catId) {
    let active = 0, done = 0;
    for (const t of todos) {
        if (t.categoryId !== catId) continue;
        if (t.done) done++; else active++;
    }
    const total = active + done;
    return { active, done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}
const REPEAT_LABELS = { daily:'Daily', weekly:'Weekly', monthly:'Monthly', yearly:'Yearly' };

// ── Priority levels ────────────────────────────────────────────
// Optional per-task field. Tasks without one sort last (rank 3) and show no flag.
const PRIORITY = {
    high:   { label: 'High',   color: '#ef4444', rank: 0 },
    medium: { label: 'Medium', color: '#f59e0b', rank: 1 },
    low:    { label: 'Low',    color: '#3b82f6', rank: 2 },
};
function prioRank(p) { return PRIORITY[p] ? PRIORITY[p].rank : 3; }
function priorityBadgeHtml(p) {
    const P = PRIORITY[p];
    if (!P) return '';
    return `<span class="text-[10px] flex items-center gap-1 font-medium" style="color:${P.color}"><i class="fas fa-flag"></i>${P.label}</span>`;
}

// ── Subtasks (checklists) ──────────────────────────────────────
function subtaskStats(t) {
    const subs = (t && t.subtasks) || [];
    if (!subs.length) return null;
    const done = subs.filter(s => s.done).length;
    return { done, total: subs.length, pct: Math.round((done / subs.length) * 100) };
}
function subtaskCountHtml(t) {
    const st = subtaskStats(t);
    if (!st) return '';
    const complete = st.done === st.total;
    return `<span class="text-[10px] flex items-center gap-1 ${complete ? 'text-emerald-400' : 'text-slate-500'}">`
        + `<i class="fas fa-list-check"></i>${st.done}/${st.total}</span>`;
}
// Minimal HTML escape for user text rendered into markup.
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function newSubId() { return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

// ── Persistence ────────────────────────────────────────────────
function loadTodos() {
    try { todos = fs.existsSync(TODOS_FILE) ? JSON.parse(fs.readFileSync(TODOS_FILE,'utf8')) : []; }
    catch(_) { todos = []; }
}
function saveTodos() { fs.writeFileSync(TODOS_FILE, JSON.stringify(todos,null,2)); }

const DEFAULT_CATEGORIES = [
    { id: 'cat_shopping', name: 'Shopping', color: '#22c55e', icon: '🛒' },
    { id: 'cat_goals',    name: 'Goals',    color: '#f59e0b', icon: '🎯' },
    { id: 'cat_ideas',    name: 'Ideas',    color: '#8b5cf6', icon: '💡' },
    { id: 'cat_projects', name: 'Projects', color: '#3b82f6', icon: '📁' },
];

function loadCategories() {
    try { categories = fs.existsSync(CATEGORIES_FILE) ? JSON.parse(fs.readFileSync(CATEGORIES_FILE,'utf8')) : []; }
    catch(_) { categories = []; }
    // Seed default categories if not already present
    let changed = false;
    DEFAULT_CATEGORIES.forEach(def => {
        if (!categories.find(c => c.id === def.id)) { categories.push(def); changed = true; }
    });
    // Backfill an emoji for categories saved before icons existed, so every category
    // shows one. Give each a varied icon from the palette instead of all the same.
    categories.forEach((c, i) => {
        if (!c.icon) { c.icon = CAT_ICONS[(i + 1) % CAT_ICONS.length]; changed = true; }
    });
    if (changed) saveCategories();
}

// ── Migrate old lists.json → todos with categories ─────────────
function migrateLists() {
    if (!fs.existsSync(LISTS_FILE)) return;
    try {
        const saved = JSON.parse(fs.readFileSync(LISTS_FILE, 'utf8'));
        const catMap = { shopping: 'cat_shopping', goals: 'cat_goals', ideas: 'cat_ideas', projects: 'cat_projects' };
        let migrated = 0;
        ['shopping', 'goals', 'ideas', 'projects'].forEach(key => {
            (saved[key] || []).forEach(item => {
                if (!todos.some(t => t.text === item.text && t.categoryId === catMap[key])) {
                    todos.push({ id: item.id || (Date.now() + migrated), text: item.text, done: item.done || false,
                        dueDate: null, repeat: null, categoryId: catMap[key], notes: '', createdAt: item.createdAt || Date.now() });
                    migrated++;
                }
            });
        });
        if (migrated > 0) saveTodos();
        fs.renameSync(LISTS_FILE, LISTS_FILE + '.migrated');
    } catch(e) { console.error('List migration failed:', e); }
}
function saveCategories() { fs.writeFileSync(CATEGORIES_FILE, JSON.stringify(categories,null,2)); }

// ── Helpers ────────────────────────────────────────────────────
// Local date key. toISOString() converts to UTC first, so east of Greenwich
// every time between local midnight and the UTC offset came out as YESTERDAY:
// tasks due today read as overdue and "Today" filtered the wrong day. Build the
// string from the local parts instead — same approach as the workout module.
function toDateStr(d) {
    return d.getFullYear() + '-' +
           String(d.getMonth() + 1).padStart(2, '0') + '-' +
           String(d.getDate()).padStart(2, '0');
}
function todayStr()   { return toDateStr(new Date()); }

function getCat(id) { return categories.find(c => c.id === id) || null; }

function nextRepeatDate(dueDate, repeat) {
    if (!repeat) return null;
    // If no due date, base the next occurrence off today
    const base = dueDate || todayStr();
    const d = new Date(base + 'T12:00:00');
    if (repeat === 'daily')   d.setDate(d.getDate() + 1);
    if (repeat === 'weekly')  d.setDate(d.getDate() + 7);
    if (repeat === 'monthly') d.setMonth(d.getMonth() + 1);
    if (repeat === 'yearly')  d.setFullYear(d.getFullYear() + 1);
    return toDateStr(d);
}

// Small "9:30 AM" pill next to the due date, when a task has a time.
function timeLabelHtml(dueTime) {
    if (!dueTime) return '';
    const [h, m] = String(dueTime).split(':').map(Number);
    const ampm = h < 12 ? 'AM' : 'PM';
    const h12  = h % 12 === 0 ? 12 : h % 12;
    return `<span class="text-[10px] text-sky-400/90 font-medium">${h12}:${String(m).padStart(2,'0')} ${ampm}</span>`;
}

function dueLabelHtml(dueDate) {
    if (!dueDate) return '';
    const today    = todayStr();
    const tomorrow = toDateStr(new Date(Date.now() + 86400000));
    let cls = 'text-slate-500', text = dueDate;
    if (dueDate === today)    { cls = 'text-amber-400'; text = 'Today'; }
    else if (dueDate < today) { cls = 'text-red-400';   text = 'Overdue · ' + dueDate; }
    else if (dueDate === tomorrow) { cls = 'text-sky-400'; text = 'Tomorrow'; }
    return `<span class="text-[10px] ${cls} flex items-center gap-1"><i class="fas fa-calendar-day"></i>${text}</span>`;
}

function catBadgeHtml(catId) {
    const cat = getCat(catId);
    if (!cat) return '';
    return `<span class="text-[10px] font-medium px-1.5 py-0.5 rounded-full inline-flex items-center gap-1" style="background:${cat.color}22;color:${cat.color}"><span style="font-size:10px">${catIcon(cat)}</span>${esc(cat.name)}</span>`;
}

function repeatBadgeHtml(repeat) {
    if (!repeat) return '';
    return `<span class="text-[10px] text-violet-400 flex items-center gap-1"><i class="fas fa-rotate-right"></i>${REPEAT_LABELS[repeat]}</span>`;
}

// ── Populate add-form selects ──────────────────────────────────
function refreshFormSelects() {
    const sel = document.getElementById('todo-cat-select');
    if (!sel) return;
    const val = sel.value;
    sel.innerHTML = `<option value="">No category</option>` +
        categories.map(c => `<option value="${c.id}">${catIcon(c)}  ${esc(c.name)}</option>`).join('');
    sel.value = val || '';
}

// ── Date filter bar ───────────────────────────────────────────
function renderDateFilter() {
    const el = document.getElementById('todo-date-filter');
    if (!el) return;
    const filters = [
        { id: null,    label: 'All' },
        { id: 'today', label: 'Today' },
        { id: 'week',  label: 'This Week' },
        { id: 'month', label: 'This Month' },
    ];
    el.innerHTML = filters.map(f => {
        const active = activeDateFilter === f.id;
        return `<button class="date-filter-pill text-xs px-3 py-1 rounded-full font-medium transition-all border ${
            active
                ? 'text-white'
                : 'border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500'
        }" data-id="${f.id ?? ''}" ${active ? 'style="background:var(--accent);border-color:var(--accent)"' : ''}>${f.label}</button>`;
    }).join('');
    el.querySelectorAll('.date-filter-pill').forEach(btn => {
        btn.onclick = () => {
            activeDateFilter = btn.dataset.id === '' ? null : btn.dataset.id;
            renderDateFilter();
            renderTodos();
        };
    });
}

// ── Category filter bar ────────────────────────────────────────
function renderCatFilter() {
    const el = document.getElementById('todo-cat-filter');
    if (!el) return;
    const pills = [{ id: null, name: 'All', color: '#94a3b8', icon: '📋' }, ...categories];
    const totalActive = todos.filter(t => !t.done).length;
    el.innerHTML = pills.map(c => {
        const active = activeCategoryFilter === c.id;
        const n = c.id === null ? totalActive : catStats(c.id).active;
        const iconHtml = c.id === null ? '📋' : catIcon(c);
        const countHtml = n
            ? `<span class="ml-1 text-[9px] px-1.5 py-0.5 rounded-full ${active ? 'bg-black/25 text-white' : 'bg-slate-700/70 text-slate-300'}">${n}</span>`
            : '';
        return `<button class="cat-filter-pill text-xs px-2.5 py-1 rounded-full font-medium transition-all border inline-flex items-center ${
            active ? 'border-transparent text-white' : 'border-slate-700 text-slate-400 hover:text-slate-200'
        }" data-id="${c.id ?? ''}" style="${active ? `background:${c.color};` : ''}">
            <span class="mr-1" style="font-size:11px">${iconHtml}</span>${esc(c.name)}${countHtml}
        </button>`;
    }).join('');
    el.querySelectorAll('.cat-filter-pill').forEach(btn => {
        btn.onclick = () => {
            activeCategoryFilter = btn.dataset.id === '' ? null : btn.dataset.id;
            renderCatFilter();
            renderTodos();
        };
    });
}

// ── List view ──────────────────────────────────────────────────
function renderTodos(filterDate = null) {
    const listEl  = document.getElementById('todo-view-list');
    const countEl = document.getElementById('todo-view-count');
    if (!listEl) return;

    let source = filterDate ? todos.filter(t => t.dueDate === filterDate) : todos;
    if (activeCategoryFilter) source = source.filter(t => t.categoryId === activeCategoryFilter);
    if (searchQuery) {
        const q = searchQuery.toLowerCase();
        source = source.filter(t =>
            (t.text || '').toLowerCase().includes(q) ||
            (t.notes || '').toLowerCase().includes(q) ||
            ((t.subtasks || []).some(s => (s.text || '').toLowerCase().includes(q)))
        );
    }
    if (!filterDate && activeDateFilter) {
        const today = todayStr();
        if (activeDateFilter === 'today') {
            source = source.filter(t => t.dueDate && t.dueDate <= today);
        } else if (activeDateFilter === 'week') {
            const weekEnd = toDateStr(new Date(Date.now() + 7 * 86400000));
            source = source.filter(t => t.dueDate && t.dueDate >= today && t.dueDate <= weekEnd);
        } else if (activeDateFilter === 'month') {
            const monthPrefix = today.slice(0, 7);
            source = source.filter(t => t.dueDate && t.dueDate.startsWith(monthPrefix));
        }
    }

    const remaining = todos.filter(t => !t.done).length;
    const doneCount = todos.length - remaining;
    countEl.textContent = todos.length
        ? (remaining ? `${remaining} of ${todos.length} remaining` : 'All done!')
        : 'No tasks yet';
    // Overall completion progress bar in the header
    const pct = todos.length ? Math.round((doneCount / todos.length) * 100) : 0;
    const pFill = document.getElementById('todo-progress-fill');
    const pPct  = document.getElementById('todo-progress-pct');
    if (pFill) pFill.style.width = pct + '%';
    if (pPct)  pPct.textContent = pct + '%';

    if (!source.length) {
        listEl.innerHTML = `
            <div class="flex flex-col items-center justify-center py-16 text-center">
                <div class="w-12 h-12 bg-slate-800 rounded-2xl flex items-center justify-center mb-3">
                    <i class="fas fa-check-square text-xl text-slate-600"></i>
                </div>
                <p class="text-slate-400 text-sm font-medium">${filterDate ? 'No tasks for this day' : 'No tasks yet'}</p>
                <p class="text-slate-600 text-xs mt-1">Add one below or ask the AI in Chat</p>
            </div>`;
        return;
    }


    // Sort active: overdue → today → future → no date
    const today = todayStr();
    const sortScore = t => {
        if (!t.dueDate) return 3;
        if (t.dueDate < today) return 0;
        if (t.dueDate === today) return 1;
        return 2;
    };
    const active = source.filter(t => !t.done)
        .sort((a, b) => sortScore(a) - sortScore(b)
            || prioRank(a.priority) - prioRank(b.priority)
            || (a.dueDate || '9').localeCompare(b.dueDate || '9'));
    const done   = hideCompleted ? [] : source.filter(t => t.done);

    // Update hide-completed button label
    const hcBtn = document.getElementById('todo-hide-completed-btn');
    if (hcBtn) {
        hcBtn.innerHTML = hideCompleted
            ? '<i class="fas fa-eye text-xs"></i>'
            : '<i class="fas fa-eye-slash text-xs"></i>';
        hcBtn.title = hideCompleted ? 'Show completed tasks' : 'Hide completed tasks';
    }

    const renderItem = (t) => {
        const notesOpen = expandedNotes.has(t.id);
        const hasNotes  = t.notes && t.notes.trim();
        const isEditing = editingTaskId === t.id;
        const subsOpen  = expandedSubtasks.has(t.id);
        const st        = subtaskStats(t);
        const P         = PRIORITY[t.priority];

        if (isEditing) {
            const catOptions = `<option value="">No category</option>` +
                categories.map(c => `<option value="${c.id}" ${t.categoryId === c.id ? 'selected' : ''}>${catIcon(c)}  ${esc(c.name)}</option>`).join('');
            return `
            <div class="todo-item rounded-xl border bg-slate-800/60 transition-all" style="border-color:rgba(var(--accent-rgb),0.40)" data-id="${t.id}">
                <div class="flex flex-col gap-2 px-4 py-3">
                    <input class="todo-edit-text w-full bg-slate-900 text-white text-sm border border-slate-600 rounded-lg px-3 py-2 outline-none focus:border-red-500 transition-colors"
                        value="${t.text.replace(/"/g, '&quot;')}" data-id="${t.id}">
                    <div class="flex flex-wrap gap-2">
                        <input class="todo-edit-date bg-slate-900 text-slate-300 text-xs border border-slate-700 rounded-lg px-2 py-1.5 outline-none focus:border-red-500 transition-colors cursor-pointer"
                            type="date" value="${t.dueDate || ''}" data-id="${t.id}" style="color-scheme:dark">
                        <input class="todo-edit-time bg-slate-900 text-slate-300 text-xs border border-slate-700 rounded-lg px-2 py-1.5 outline-none focus:border-red-500 transition-colors cursor-pointer"
                            type="time" title="Time (optional) — shows on the calendar" value="${t.dueTime || ''}" data-id="${t.id}" step="900" style="color-scheme:dark">
                        <select class="todo-edit-priority bg-slate-900 text-slate-300 text-xs border border-slate-700 rounded-lg px-2 py-1.5 outline-none focus:border-red-500 transition-colors cursor-pointer" data-id="${t.id}" style="color-scheme:dark">
                            <option value="" ${!t.priority ? 'selected' : ''}>No priority</option>
                            <option value="high"   ${t.priority==='high'   ? 'selected':''}>🚩 High</option>
                            <option value="medium" ${t.priority==='medium' ? 'selected':''}>🟠 Medium</option>
                            <option value="low"    ${t.priority==='low'    ? 'selected':''}>🔵 Low</option>
                        </select>
                        <select class="todo-edit-repeat bg-slate-900 text-slate-300 text-xs border border-slate-700 rounded-lg px-2 py-1.5 outline-none focus:border-red-500 transition-colors cursor-pointer" data-id="${t.id}" style="color-scheme:dark">
                            <option value="" ${!t.repeat ? 'selected' : ''}>No repeat</option>
                            <option value="daily"   ${t.repeat==='daily'   ? 'selected':''}>Daily</option>
                            <option value="weekly"  ${t.repeat==='weekly'  ? 'selected':''}>Weekly</option>
                            <option value="monthly" ${t.repeat==='monthly' ? 'selected':''}>Monthly</option>
                            <option value="yearly"  ${t.repeat==='yearly'  ? 'selected':''}>Yearly</option>
                        </select>
                        <select class="todo-edit-cat bg-slate-900 text-slate-300 text-xs border border-slate-700 rounded-lg px-2 py-1.5 outline-none focus:border-red-500 transition-colors cursor-pointer" data-id="${t.id}" style="color-scheme:dark">
                            ${catOptions}
                        </select>
                    </div>
                    <div class="flex gap-2 justify-end">
                        <button class="todo-edit-cancel text-xs text-slate-400 hover:text-slate-200 px-3 py-1.5 rounded-lg hover:bg-slate-700 transition-colors" data-id="${t.id}">Cancel</button>
                        <button class="todo-edit-save text-xs text-white px-3 py-1.5 rounded-lg transition-colors font-medium" style="background:var(--accent)" data-id="${t.id}">Save</button>
                    </div>
                </div>
            </div>`;
        }

        return `
        <div class="todo-item rounded-xl border border-transparent hover:border-slate-700/50 hover:bg-slate-800/40 transition-all group overflow-hidden" data-id="${t.id}"${P ? ` style="box-shadow:inset 3px 0 0 ${P.color}"` : ''}>
            <div class="flex items-center gap-3 px-4 py-3">
                <button class="todo-check w-5 h-5 rounded-md border-2 shrink-0 flex items-center justify-center transition-all
                    ${t.done ? '' : 'border-slate-600'}"
                    style="${t.done ? 'background:var(--accent);border-color:var(--accent)' : ''}"
                    data-id="${t.id}">
                    ${t.done ? '<i class="fas fa-check text-white text-[9px]"></i>' : ''}
                </button>
                <div class="flex-1 min-w-0">
                    <span class="block text-sm ${t.done ? 'line-through text-slate-500' : 'text-slate-200'} truncate">${esc(t.text)}</span>
                    <div class="flex flex-wrap gap-2 mt-0.5">
                        ${priorityBadgeHtml(t.priority)}
                        ${dueLabelHtml(t.dueDate)}${timeLabelHtml(t.dueTime)}
                        ${repeatBadgeHtml(t.repeat)}
                        ${catBadgeHtml(t.categoryId)}
                        ${subtaskCountHtml(t)}
                    </div>
                    ${st ? `<div class="h-1 rounded-full bg-slate-800 overflow-hidden mt-1.5 max-w-[220px]">
                        <div class="h-full rounded-full transition-all duration-300" style="width:${st.pct}%;background:${st.pct===100?'#22c55e':'var(--accent)'}"></div>
                    </div>` : ''}
                </div>
                <div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-all shrink-0">
                    <button class="todo-subtasks-toggle w-7 h-7 flex items-center justify-center rounded-lg transition-colors
                        ${subsOpen || st ? 'text-sky-400 hover:bg-sky-400/10' : 'text-slate-500 hover:text-slate-300 hover:bg-slate-700'}"
                        title="Subtasks" data-id="${t.id}">
                        <i class="fas fa-list-check text-xs"></i>
                    </button>
                    <button class="todo-notes-toggle w-7 h-7 flex items-center justify-center rounded-lg transition-colors
                        ${notesOpen || hasNotes ? 'text-amber-400 hover:bg-amber-400/10' : 'text-slate-500 hover:text-slate-300 hover:bg-slate-700'}"
                        title="Notes" data-id="${t.id}">
                        <i class="fas fa-sticky-note text-xs"></i>
                    </button>
                    <button class="todo-edit w-7 h-7 flex items-center justify-center rounded-lg text-slate-500 hover:text-sky-400 hover:bg-sky-400/10 transition-colors"
                        title="Edit" data-id="${t.id}">
                        <i class="fas fa-pencil text-xs"></i>
                    </button>
                    <button class="todo-delete w-7 h-7 flex items-center justify-center rounded-lg text-slate-500 hover:text-red-500 hover:bg-red-600/10 transition-colors"
                        data-id="${t.id}">
                        <i class="fas fa-trash text-xs"></i>
                    </button>
                </div>
            </div>
            ${subsOpen ? `
            <div class="px-4 pb-3 pl-12">
                ${(t.subtasks || []).map(s => `
                    <div class="flex items-center gap-2 py-1 group/sub">
                        <button class="subtask-check w-4 h-4 rounded border-2 shrink-0 flex items-center justify-center transition-all ${s.done ? '' : 'border-slate-600'}"
                            style="${s.done ? 'background:var(--accent);border-color:var(--accent)' : ''}" data-tid="${t.id}" data-sid="${s.id}">
                            ${s.done ? '<i class="fas fa-check text-white text-[7px]"></i>' : ''}
                        </button>
                        <span class="flex-1 text-xs ${s.done ? 'line-through text-slate-600' : 'text-slate-300'}">${esc(s.text)}</span>
                        <button class="subtask-del opacity-0 group-hover/sub:opacity-100 w-5 h-5 flex items-center justify-center rounded text-slate-500 hover:text-red-500 transition-all" data-tid="${t.id}" data-sid="${s.id}">
                            <i class="fas fa-xmark text-[10px]"></i>
                        </button>
                    </div>`).join('')}
                <div class="flex gap-2 mt-1.5">
                    <input class="subtask-input flex-1 bg-slate-900 text-slate-300 text-xs border border-slate-700 rounded-lg px-2.5 py-1.5 outline-none focus:border-red-500 transition-colors placeholder-slate-600"
                        placeholder="Add a step…" data-id="${t.id}">
                    <button class="subtask-add text-xs text-white px-3 py-1.5 rounded-lg font-medium transition-colors" style="background:var(--accent)" data-id="${t.id}">Add</button>
                </div>
            </div>` : ''}
            ${notesOpen ? `
            <div class="px-4 pb-3">
                <textarea class="todo-notes-area w-full bg-slate-900 text-slate-300 text-xs border border-slate-700 rounded-lg px-3 py-2 outline-none focus:border-slate-500 resize-none transition-colors placeholder-slate-600"
                    rows="2" placeholder="Add a note…" data-id="${t.id}">${esc(t.notes || '')}</textarea>
            </div>` : ''}
        </div>`;
    };

    // Split active into overdue/today/upcoming/no-date groups with headers
    const overdue  = active.filter(t => t.dueDate && t.dueDate < today);
    const dueToday = active.filter(t => t.dueDate === today);
    const upcoming = active.filter(t => t.dueDate && t.dueDate > today);
    const noDate   = active.filter(t => !t.dueDate);

    const sectionHeader = (label, icon) =>
        `<div class="px-4 pt-4 pb-1.5 text-[10px] text-slate-600 font-semibold uppercase tracking-widest flex items-center gap-2">
             <i class="fas ${icon} text-[9px]"></i>${label}
         </div>`;

    let html = '';
    if (overdue.length)  html += sectionHeader('Overdue', 'fa-exclamation-circle') + overdue.map(renderItem).join('');
    if (dueToday.length) html += sectionHeader('Today', 'fa-sun') + dueToday.map(renderItem).join('');
    if (upcoming.length) html += sectionHeader('Upcoming', 'fa-calendar') + upcoming.map(renderItem).join('');
    if (noDate.length)   html += sectionHeader('No Date', 'fa-circle') + noDate.map(renderItem).join('');
    if (!active.length && !done.length) html = `
        <div class="flex flex-col items-center justify-center py-16 text-center">
            <div class="w-12 h-12 bg-slate-800 rounded-2xl flex items-center justify-center mb-3">
                <i class="fas fa-check-square text-xl text-slate-600"></i>
            </div>
            <p class="text-slate-400 text-sm font-medium">All done!</p>
        </div>`;

    if (done.length)
        html += `<div class="px-4 pt-5 pb-1.5 text-[10px] text-slate-600 font-semibold uppercase tracking-widest flex items-center gap-2">
                     <div class="flex-1 h-px bg-slate-800"></div>Completed<div class="flex-1 h-px bg-slate-800"></div>
                 </div>` + done.map(renderItem).join('');

    listEl.innerHTML = html;

    // Check/uncheck
    listEl.querySelectorAll('.todo-check').forEach(btn => {
        btn.onclick = () => {
            const t = todos.find(t => t.id === parseInt(btn.dataset.id));
            if (!t) return;
            t.done = !t.done;
            if (t.done) {
                t.completedAt = Date.now();
                // Auto-create next occurrence for repeating tasks
                if (t.repeat) {
                    const next = nextRepeatDate(t.dueDate, t.repeat);
                    if (next) todos.push({ id: Date.now(), text: t.text, done: false,
                        dueDate: next, dueTime: t.dueTime || null, repeat: t.repeat, categoryId: t.categoryId,
                        priority: t.priority || null,
                        subtasks: (t.subtasks || []).map(s => ({ id: newSubId(), text: s.text, done: false })),
                        notes: '', createdAt: Date.now() });
                }
            } else {
                t.completedAt = null;
            }
            saveTodos();
            renderTodos(filterDate);
            renderCalPage();
        };
    });

    // Delete
    listEl.querySelectorAll('.todo-delete').forEach(btn => {
        btn.onclick = () => {
            todos = todos.filter(t => t.id !== parseInt(btn.dataset.id));
            saveTodos(); renderTodos(filterDate); renderCalPage();
        };
    });

    // Edit — open inline form
    listEl.querySelectorAll('.todo-edit').forEach(btn => {
        btn.onclick = () => {
            editingTaskId = parseInt(btn.dataset.id);
            renderTodos(filterDate);
            // Focus the text input after render
            const input = listEl.querySelector('.todo-edit-text');
            if (input) { input.focus(); input.select(); }
        };
    });

    // Edit — save
    listEl.querySelectorAll('.todo-edit-save').forEach(btn => {
        btn.onclick = () => {
            const t    = todos.find(t => t.id === parseInt(btn.dataset.id));
            const row  = listEl.querySelector(`.todo-item[data-id="${btn.dataset.id}"]`);
            if (!t || !row) return;
            const newText = row.querySelector('.todo-edit-text').value.trim();
            if (!newText) return;
            t.text       = newText;
            t.dueDate    = row.querySelector('.todo-edit-date').value     || null;
            t.dueTime    = row.querySelector('.todo-edit-time').value     || null;
            t.priority   = row.querySelector('.todo-edit-priority').value || null;
            t.repeat     = row.querySelector('.todo-edit-repeat').value   || null;
            t.categoryId = row.querySelector('.todo-edit-cat').value      || null;
            saveTodos();
            editingTaskId = null;
            renderTodos(filterDate);
            renderCalPage();
        };
    });

    // Edit — cancel
    listEl.querySelectorAll('.todo-edit-cancel').forEach(btn => {
        btn.onclick = () => { editingTaskId = null; renderTodos(filterDate); };
    });

    // Edit — save on Enter key
    listEl.querySelectorAll('.todo-edit-text').forEach(input => {
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter') {
                const saveBtn = listEl.querySelector(`.todo-edit-save[data-id="${input.dataset.id}"]`);
                if (saveBtn) saveBtn.click();
            }
            if (e.key === 'Escape') {
                editingTaskId = null; renderTodos(filterDate);
            }
        });
    });

    // Toggle notes
    listEl.querySelectorAll('.todo-notes-toggle').forEach(btn => {
        btn.onclick = () => {
            const id = parseInt(btn.dataset.id);
            expandedNotes.has(id) ? expandedNotes.delete(id) : expandedNotes.add(id);
            renderTodos(filterDate);
        };
    });

    // Save notes on blur
    listEl.querySelectorAll('.todo-notes-area').forEach(ta => {
        ta.addEventListener('blur', () => {
            const t = todos.find(t => t.id === parseInt(ta.dataset.id));
            if (t) { t.notes = ta.value; saveTodos(); }
        });
        ta.addEventListener('keydown', (e) => { if (e.key === 'Escape') ta.blur(); });
    });

    // Subtasks — toggle the checklist open/closed
    listEl.querySelectorAll('.todo-subtasks-toggle').forEach(btn => {
        btn.onclick = () => {
            const id = parseInt(btn.dataset.id);
            expandedSubtasks.has(id) ? expandedSubtasks.delete(id) : expandedSubtasks.add(id);
            renderTodos(filterDate);
        };
    });
    // Subtasks — check / uncheck a step
    listEl.querySelectorAll('.subtask-check').forEach(btn => {
        btn.onclick = () => {
            const t = todos.find(t => t.id === parseInt(btn.dataset.tid));
            const s = t && (t.subtasks || []).find(s => s.id === btn.dataset.sid);
            if (!s) return;
            s.done = !s.done;
            saveTodos();
            renderTodos(filterDate);
        };
    });
    // Subtasks — delete a step
    listEl.querySelectorAll('.subtask-del').forEach(btn => {
        btn.onclick = () => {
            const t = todos.find(t => t.id === parseInt(btn.dataset.tid));
            if (!t || !t.subtasks) return;
            t.subtasks = t.subtasks.filter(s => s.id !== btn.dataset.sid);
            saveTodos();
            renderTodos(filterDate);
        };
    });
    // Subtasks — add a step (keeps the input focused for rapid entry)
    const addSubtask = (id) => {
        const t = todos.find(t => t.id === id);
        const input = listEl.querySelector(`.subtask-input[data-id="${id}"]`);
        if (!t || !input) return;
        const text = input.value.trim();
        if (!text) return;
        if (!t.subtasks) t.subtasks = [];
        t.subtasks.push({ id: newSubId(), text, done: false });
        expandedSubtasks.add(id);
        saveTodos();
        renderTodos(filterDate);
        const again = listEl.querySelector(`.subtask-input[data-id="${id}"]`);
        if (again) again.focus();
    };
    listEl.querySelectorAll('.subtask-add').forEach(btn => {
        btn.onclick = () => addSubtask(parseInt(btn.dataset.id));
    });
    listEl.querySelectorAll('.subtask-input').forEach(input => {
        input.addEventListener('keydown', e => {
            e.stopPropagation();
            if (e.key === 'Enter') addSubtask(parseInt(input.dataset.id));
        });
    });
}


// ── Categories modal ───────────────────────────────────────────
function openCatModal() {
    renderCatModalList();
    document.getElementById('todo-cats-modal').classList.add('open');
}

// Re-render every place categories appear after an edit.
function _catRefreshAll() {
    saveCategories();
    renderCatModalList();
    refreshFormSelects();
    renderCatFilter();
    renderTodos();
}

function renderCatModalList() {
    const el = document.getElementById('cats-modal-list');
    if (!el) return;
    if (!categories.length) {
        el.innerHTML = `<p class="text-slate-600 text-xs text-center py-6">No categories yet — add one below.</p>`;
        return;
    }
    el.innerHTML = categories.map((c, i) => {
        const s = catStats(c.id);
        const bar = s.total
            ? `<div class="flex items-center gap-2 mt-1.5">
                   <div class="flex-1 h-1.5 rounded-full bg-slate-800 overflow-hidden max-w-[150px]">
                       <div class="h-full rounded-full transition-all" style="width:${s.pct}%;background:${c.color}"></div>
                   </div>
                   <span class="text-[10px] text-slate-500 tabular-nums">${s.active} active · ${s.done} done</span>
               </div>`
            : `<div class="text-[10px] text-slate-600 mt-1.5">No tasks yet</div>`;
        return `
        <div class="cat-card rounded-xl border border-slate-800 bg-slate-800/40 hover:bg-slate-800/70 px-3 py-2.5 flex items-center gap-3 mb-2 transition-colors" data-id="${c.id}">
            <button class="cat-icon-btn w-10 h-10 rounded-lg flex items-center justify-center shrink-0 text-xl transition-transform hover:scale-110" style="background:${c.color}22" data-id="${c.id}" title="Tap to change icon">${catIcon(c)}</button>
            <div class="flex-1 min-w-0">
                <input class="cat-name-input w-full bg-transparent text-sm text-slate-100 font-semibold outline-none border-b border-transparent focus:border-slate-600 transition-colors" value="${esc(c.name).replace(/"/g,'&quot;')}" data-id="${c.id}" spellcheck="false">
                ${bar}
            </div>
            <div class="flex items-center gap-1 shrink-0">
                <button class="cat-color-btn w-6 h-6 rounded-full border-2 border-white/20 hover:border-white/60 transition-colors" style="background:${c.color}" data-id="${c.id}" title="Tap to change colour"></button>
                <div class="flex flex-col">
                    <button class="cat-up w-6 h-4 flex items-center justify-center rounded text-slate-500 hover:text-white ${i === 0 ? 'opacity-20 pointer-events-none' : ''}" data-i="${i}" title="Move up"><i class="fas fa-chevron-up text-[9px]"></i></button>
                    <button class="cat-down w-6 h-4 flex items-center justify-center rounded text-slate-500 hover:text-white ${i === categories.length - 1 ? 'opacity-20 pointer-events-none' : ''}" data-i="${i}" title="Move down"><i class="fas fa-chevron-down text-[9px]"></i></button>
                </div>
                <button class="cat-delete w-7 h-7 flex items-center justify-center rounded-lg text-slate-500 hover:text-red-500 hover:bg-red-600/10 transition-all" data-id="${c.id}" title="Delete category">
                    <i class="fas fa-trash text-[11px]"></i>
                </button>
            </div>
        </div>`;
    }).join('');

    const byId = id => categories.find(c => c.id === id);

    // Rename (save on input, debounced via blur/enter is overkill — save live)
    el.querySelectorAll('.cat-name-input').forEach(inp => {
        inp.addEventListener('input', () => {
            const c = byId(inp.dataset.id); if (!c) return;
            c.name = inp.value;
            saveCategories(); refreshFormSelects(); renderCatFilter(); renderTodos();
        });
        inp.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') inp.blur(); });
    });
    // Cycle icon
    el.querySelectorAll('.cat-icon-btn').forEach(btn => {
        btn.onclick = () => {
            const c = byId(btn.dataset.id); if (!c) return;
            const idx = CAT_ICONS.indexOf(catIcon(c));
            c.icon = CAT_ICONS[(idx + 1) % CAT_ICONS.length];
            _catRefreshAll();
        };
    });
    // Cycle colour
    el.querySelectorAll('.cat-color-btn').forEach(btn => {
        btn.onclick = () => {
            const c = byId(btn.dataset.id); if (!c) return;
            const idx = CAT_COLORS.indexOf(c.color);
            c.color = CAT_COLORS[(idx + 1) % CAT_COLORS.length];
            _catRefreshAll();
        };
    });
    // Reorder
    const move = (from, to) => {
        if (to < 0 || to >= categories.length) return;
        const [c] = categories.splice(from, 1);
        categories.splice(to, 0, c);
        _catRefreshAll();
    };
    el.querySelectorAll('.cat-up').forEach(b => b.onclick = () => move(parseInt(b.dataset.i), parseInt(b.dataset.i) - 1));
    el.querySelectorAll('.cat-down').forEach(b => b.onclick = () => move(parseInt(b.dataset.i), parseInt(b.dataset.i) + 1));
    // Delete
    el.querySelectorAll('.cat-delete').forEach(btn => {
        btn.onclick = () => {
            const id = btn.dataset.id;
            const idx = categories.findIndex(c => c.id === id);
            if (idx < 0) return;
            categories.splice(idx, 1);
            todos.forEach(t => { if (t.categoryId === id) t.categoryId = null; });
            if (activeCategoryFilter === id) activeCategoryFilter = null;
            saveTodos();
            _catRefreshAll();
        };
    });
}

// ── Clear old completed tasks ──────────────────────────────────
function clearOldTasks() {
    const cutoff = Date.now() - 3 * 24 * 60 * 60 * 1000; // 3 days ago
    const before = todos.length;
    todos = todos.filter(t => !(t.done && (t.completedAt || t.createdAt) < cutoff));
    if (todos.length < before) {
        saveTodos();
        renderTodos();
    }
    return before - todos.length;
}


// ── Init ───────────────────────────────────────────────────────
function initTodos() {
    const input      = document.getElementById('todo-view-input');
    const dateInput  = document.getElementById('todo-view-date');
    const timeInput  = document.getElementById('todo-view-time');
    const prioSel    = document.getElementById('todo-priority-select');
    const repeatSel  = document.getElementById('todo-repeat-select');
    const catSel     = document.getElementById('todo-cat-select');
    const addBtn     = document.getElementById('todo-view-add-btn');

    refreshFormSelects();
    renderDateFilter();
    renderCatFilter();

    addBtn.onclick = () => {
        const text = input.value.trim();
        if (!text) return;
        todos.push({
            id:         Date.now(),
            text,
            done:       false,
            dueDate:    (dateInput && dateInput.value) || null,
            dueTime:    (timeInput && timeInput.value) || null,
            priority:   (prioSel && prioSel.value)     || null,
            repeat:     repeatSel.value  || null,
            categoryId: catSel.value     || null,
            subtasks:   [],
            notes:      '',
            createdAt:  Date.now(),
        });
        saveTodos();
        renderTodos();
        input.value = ''; repeatSel.value = ''; catSel.value = '';
        if (dateInput) dateInput.value = '';
        if (timeInput) timeInput.value = '';
        if (prioSel) prioSel.value = '';
        input.focus();
    };
    input.addEventListener('keypress', e => { if (e.key === 'Enter') addBtn.click(); });

    // Live search
    const searchInput = document.getElementById('todo-search');
    const searchClear = document.getElementById('todo-search-clear');
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            searchQuery = searchInput.value.trim();
            if (searchClear) searchClear.style.display = searchQuery ? 'flex' : 'none';
            renderTodos();
        });
        searchInput.addEventListener('keydown', e => {
            e.stopPropagation();
            if (e.key === 'Escape') { searchInput.value = ''; searchQuery = ''; if (searchClear) searchClear.style.display = 'none'; renderTodos(); }
        });
    }
    if (searchClear) searchClear.onclick = () => {
        searchQuery = ''; if (searchInput) searchInput.value = '';
        searchClear.style.display = 'none'; renderTodos();
        if (searchInput) searchInput.focus();
    };

    // Hide/show completed
    document.getElementById('todo-hide-completed-btn').onclick = () => {
        hideCompleted = !hideCompleted;
        renderTodos();
    };

    // Clear old tasks
    document.getElementById('todo-clear-old-btn').onclick = () => {
        const removed = clearOldTasks();
        if (!removed) {
            const btn = document.getElementById('todo-clear-old-btn');
            btn.title = 'No completed tasks older than 3 days';
            setTimeout(() => { btn.title = 'Remove completed tasks older than 3 days'; }, 2000);
        }
    };


    // Category modal
    document.getElementById('todo-manage-cats-btn').onclick = openCatModal;
    document.getElementById('close-cats-modal-btn').onclick = () => {
        document.getElementById('todo-cats-modal').classList.remove('open');
    };
    document.getElementById('todo-cats-modal').onclick = (e) => {
        if (e.target === document.getElementById('todo-cats-modal'))
            document.getElementById('todo-cats-modal').classList.remove('open');
    };

    // Icon picker (emoji) for a new category
    const iconPickerEl = document.getElementById('cat-icon-picker');
    if (iconPickerEl) {
        iconPickerEl.innerHTML = '';
        CAT_ICONS.forEach(emo => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = emo;
            btn.className = 'w-7 h-7 rounded-lg flex items-center justify-center text-base transition-all border-2 border-transparent hover:bg-slate-700';
            if (emo === selectedCatIcon) { btn.style.borderColor = '#fff'; btn.style.background = 'rgba(255,255,255,0.08)'; }
            btn.onclick = () => {
                selectedCatIcon = emo;
                iconPickerEl.querySelectorAll('button').forEach(b => { b.style.borderColor = 'transparent'; b.style.background = 'transparent'; });
                btn.style.borderColor = '#fff'; btn.style.background = 'rgba(255,255,255,0.08)';
            };
            iconPickerEl.appendChild(btn);
        });
    }

    // Color picker
    const pickerEl = document.getElementById('cat-color-picker');
    CAT_COLORS.forEach(hex => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'w-6 h-6 rounded-full transition-all border-2 border-transparent';
        btn.style.background = hex;
        if (hex === selectedCatColor) btn.style.borderColor = '#fff';
        btn.onclick = () => {
            selectedCatColor = hex;
            pickerEl.querySelectorAll('button').forEach(b => b.style.borderColor = 'transparent');
            btn.style.borderColor = '#fff';
        };
        pickerEl.appendChild(btn);
    });

    document.getElementById('add-cat-btn').onclick = () => {
        const nameEl = document.getElementById('new-cat-name');
        const name   = nameEl.value.trim();
        if (!name) return;
        categories.push({ id: 'cat_' + Date.now(), name, color: selectedCatColor, icon: selectedCatIcon });
        saveCategories(); nameEl.value = '';
        renderCatModalList(); refreshFormSelects(); renderCatFilter();
    };
    document.getElementById('new-cat-name').addEventListener('keypress', e => {
        if (e.key === 'Enter') document.getElementById('add-cat-btn').click();
    });
}
