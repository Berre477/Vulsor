// ── My Lists (Shopping, Goals, Ideas, Projects) ────────────────
// Depends on: globals.js (LISTS_FILE, lists, currentListTab)

const LIST_TABS = [
    { key: 'shopping', label: 'Shopping', icon: 'fa-shopping-cart' },
    { key: 'goals',    label: 'Goals',    icon: 'fa-bullseye'      },
    { key: 'ideas',    label: 'Ideas',    icon: 'fa-lightbulb'     },
    { key: 'projects', label: 'Projects', icon: 'fa-briefcase'     },
];

function loadLists() {
    try {
        const saved = fs.existsSync(LISTS_FILE) ? JSON.parse(fs.readFileSync(LISTS_FILE, 'utf8')) : {};
        lists = {
            shopping: saved.shopping || [],
            goals:    saved.goals    || [],
            ideas:    saved.ideas    || [],
            projects: saved.projects || [],
        };
    } catch (_) {
        lists = { shopping: [], goals: [], ideas: [], projects: [] };
    }
}

function saveLists() {
    fs.writeFileSync(LISTS_FILE, JSON.stringify(lists, null, 2));
}

function renderListTab() {
    const tabsEl  = document.getElementById('lists-view-tabs');
    const countEl = document.getElementById('lists-view-count');
    const listEl  = document.getElementById('lists-view-items');
    if (!tabsEl) return;

    const items = lists[currentListTab] || [];

    // Render tab buttons
    tabsEl.innerHTML = LIST_TABS.map(t => {
        const count = (lists[t.key] || []).filter(i => !i.done).length;
        const isActive = currentListTab === t.key;
        return `
        <button class="lists-tab flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all border ${
            isActive
                ? 'bg-red-600/15 border-red-600/30 text-red-500'
                : 'border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-800 hover:border-slate-700'
        }" data-key="${t.key}">
            <i class="fas ${t.icon} text-xs"></i>
            ${t.label}
            ${count ? `<span class="text-xs px-1.5 py-0.5 rounded-full ${isActive ? 'bg-red-600/30 text-red-300' : 'bg-slate-700 text-slate-400'}">${count}</span>` : ''}
        </button>`;
    }).join('');

    tabsEl.querySelectorAll('.lists-tab').forEach(btn => {
        btn.onclick = () => { currentListTab = btn.dataset.key; renderListTab(); };
    });

    // Count
    const remaining = items.filter(i => !i.done).length;
    countEl.textContent = items.length
        ? (remaining ? `${remaining} of ${items.length} remaining` : 'All done!')
        : '';

    // Items
    if (!items.length) {
        listEl.innerHTML = `
            <div class="flex flex-col items-center justify-center py-20 text-center">
                <div class="w-14 h-14 bg-slate-800 rounded-2xl flex items-center justify-center mb-4">
                    <i class="fas ${LIST_TABS.find(t => t.key === currentListTab).icon} text-2xl text-slate-600"></i>
                </div>
                <p class="text-slate-400 text-sm font-medium">Nothing in ${LIST_TABS.find(t => t.key === currentListTab).label} yet</p>
                <p class="text-slate-600 text-xs mt-1">Add one below or ask Vulsor in the Chat tab</p>
            </div>`;
        return;
    }

    const active = items.filter(i => !i.done);
    const done   = items.filter(i => i.done);

    const renderItem = (item) => `
        <div class="flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-slate-800/50 group transition-colors border border-transparent hover:border-slate-700/50">
            <button class="list-check w-5 h-5 rounded-md border-2 ${item.done ? 'bg-red-600 border-red-600' : 'border-slate-600 hover:border-red-500'} flex items-center justify-center shrink-0 transition-all" data-id="${item.id}">
                ${item.done ? '<i class="fas fa-check text-white text-[9px]"></i>' : ''}
            </button>
            <span class="flex-1 text-sm ${item.done ? 'line-through text-slate-500' : 'text-slate-200'}">${item.text}</span>
            <button class="list-delete opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-500 transition-all text-xs w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-600/10" data-id="${item.id}">
                <i class="fas fa-trash text-xs"></i>
            </button>
        </div>`;

    listEl.innerHTML =
        active.map(renderItem).join('') +
        (done.length
            ? `<div class="px-4 pt-5 pb-2 text-xs text-slate-600 font-semibold uppercase tracking-widest flex items-center gap-2">
                   <div class="flex-1 h-px bg-slate-800"></div>Done<div class="flex-1 h-px bg-slate-800"></div>
               </div>` + done.map(renderItem).join('')
            : '');

    listEl.querySelectorAll('.list-check').forEach(btn => {
        btn.onclick = () => {
            const item = lists[currentListTab].find(i => i.id === parseInt(btn.dataset.id));
            if (item) { item.done = !item.done; saveLists(); renderListTab(); }
        };
    });
    listEl.querySelectorAll('.list-delete').forEach(btn => {
        btn.onclick = () => {
            lists[currentListTab] = lists[currentListTab].filter(i => i.id !== parseInt(btn.dataset.id));
            saveLists();
            renderListTab();
        };
    });
}

function initLists() {
    const input  = document.getElementById('lists-view-input');
    const addBtn = document.getElementById('lists-view-add-btn');

    addBtn.onclick = () => {
        const text = input.value.trim();
        if (!text) return;
        lists[currentListTab].push({ id: Date.now(), text, done: false, createdAt: Date.now() });
        saveLists();
        renderListTab();
        input.value = '';
        input.focus();
    };
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') addBtn.click();
    });
}
