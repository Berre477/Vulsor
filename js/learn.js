// ── Learn — topics + flashcards with spaced repetition ────────────
// Depends on: globals.js (fs, path, LEARN_FILE)
// Exposes: renderLearn()
//
// A topic tracks what you're learning (description, a checklist of
// resources/milestones with progress) and holds a deck of flashcards that
// are scheduled with a simplified SM-2 spaced-repetition algorithm.

function loadLearnData() {
    try {
        if (fs.existsSync(LEARN_FILE))
            return JSON.parse(fs.readFileSync(LEARN_FILE, 'utf8'));
    } catch (_) {}
    return { topics: [] };
}
function saveLearnData() {
    try { fs.writeFileSync(LEARN_FILE, JSON.stringify(learnData, null, 2)); } catch (_) {}
}

// ── State ──────────────────────────────────────────────────────────
let learnData     = { topics: [] };
let learnActiveId = null;
let learnTab      = 'overview';      // 'overview' | 'cards'
let learnSearch   = '';
let learnEditCard = null;            // id of card being inline-edited
let learnBuilt    = false;
let learnSaveTimer = null;
// active study session: { topicId, queue:[cardId], reviewed, total, revealed }
let learnStudy    = null;

const LEARN_ACCENT  = '#84cc16';
const LEARN_PALETTE = ['#84cc16', '#22c55e', '#0ea5e9', '#a855f7', '#f97316', '#ec4899', '#eab308', '#14b8a6'];
const DAY_MS = 86400000;

// ── Helpers ────────────────────────────────────────────────────────
function learnNewId() { return 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

function learnBlankTopic() {
    return {
        id: learnNewId(), name: 'New topic', desc: '',
        color: LEARN_PALETTE[learnData.topics.length % LEARN_PALETTE.length],
        resources: [], cards: [], created: Date.now(), updated: Date.now(),
    };
}
function learnBlankCard() {
    return { id: learnNewId(), front: '', back: '', due: Date.now(), interval: 0, ease: 2.5, reps: 0, lapses: 0, created: Date.now() };
}

function learnTopicById(id) { return learnData.topics.find(t => t.id === id) || null; }
function learnActiveTopic() { return learnTopicById(learnActiveId); }

function learnProgress(t) {
    if (!t || !t.resources.length) return 0;
    return Math.round(100 * t.resources.filter(r => r.done).length / t.resources.length);
}
function learnDueCards(t) {
    if (!t) return [];
    const now = Date.now();
    return t.cards.filter(c => (c.due || 0) <= now);
}
function learnFilteredTopics() {
    const q = learnSearch.trim().toLowerCase();
    return learnData.topics
        .filter(t => !q || (t.name + ' ' + t.desc).toLowerCase().includes(q))
        .sort((a, b) => (b.updated || 0) - (a.updated || 0));
}

function learnTouch(t) { if (t) t.updated = Date.now(); }
function learnScheduleSave() {
    clearTimeout(learnSaveTimer);
    learnSaveTimer = setTimeout(saveLearnData, 350);
}

// ── Spaced repetition (simplified SM-2) ────────────────────────────
// quality: 'again' | 'hard' | 'good' | 'easy'  →  reschedule the card
function learnReviewCard(card, quality) {
    if (quality === 'again') {
        card.reps = 0;
        card.interval = 0;
        card.ease = Math.max(1.3, (card.ease || 2.5) - 0.2);
        card.lapses = (card.lapses || 0) + 1;
        card.due = Date.now() + 60000;            // ~1 min; repeats within session
        return;
    }
    let ivl;
    if (card.reps === 0)      ivl = quality === 'easy' ? 2 : quality === 'hard' ? 0.5 : 1;
    else if (card.reps === 1) ivl = quality === 'easy' ? 6 : quality === 'hard' ? 2 : 3;
    else {
        const mult = quality === 'easy' ? (card.ease * 1.3) : quality === 'hard' ? 1.2 : card.ease;
        ivl = (card.interval || 1) * mult;
    }
    card.ease = Math.min(3.0, Math.max(1.3, (card.ease || 2.5) + (quality === 'easy' ? 0.15 : quality === 'hard' ? -0.15 : 0)));
    card.reps = (card.reps || 0) + 1;
    card.interval = Math.max(0.04, ivl);          // floor ~1h
    card.due = Date.now() + card.interval * DAY_MS;
}
// human-readable "next due" estimate for a rating button preview
function learnIvlLabel(card, quality) {
    const c = JSON.parse(JSON.stringify(card));
    learnReviewCard(c, quality);
    const d = c.due - Date.now();
    if (d < 3600000) return '<1h';
    if (d < DAY_MS) return Math.round(d / 3600000) + 'h';
    const days = d / DAY_MS;
    if (days < 30) return Math.round(days) + 'd';
    if (days < 365) return Math.round(days / 30) + 'mo';
    return (days / 365).toFixed(1) + 'y';
}

// ── Topic mutations ────────────────────────────────────────────────
function learnCreateTopic() {
    const t = learnBlankTopic();
    learnData.topics.unshift(t);
    learnActiveId = t.id; learnTab = 'overview';
    saveLearnData(); learnRenderList(); learnRenderDetail();
    setTimeout(() => { const n = document.getElementById('learn-name'); if (n) { n.focus(); n.select(); } }, 30);
}
function learnSelectTopic(id) { learnActiveId = id; learnTab = 'overview'; learnStudy = null; learnRenderList(); learnRenderDetail(); }
function learnDeleteTopic(id) {
    const t = learnTopicById(id); if (!t) return;
    if (!confirm(`Delete topic "${t.name || 'Untitled'}" and its ${t.cards.length} card(s)?`)) return;
    learnData.topics = learnData.topics.filter(x => x.id !== id);
    if (learnActiveId === id) { const l = learnFilteredTopics(); learnActiveId = l.length ? l[0].id : null; }
    saveLearnData(); learnRenderList(); learnRenderDetail();
}

// ── Resource / checklist mutations ─────────────────────────────────
function learnAddResource(title, url) {
    const t = learnActiveTopic(); if (!t || !title.trim()) return;
    t.resources.push({ id: learnNewId(), title: title.trim(), url: (url || '').trim(), done: false });
    learnTouch(t); saveLearnData(); learnRenderList(); learnRenderDetail();
}
function learnToggleResource(rid) {
    const t = learnActiveTopic(); if (!t) return;
    const r = t.resources.find(x => x.id === rid); if (!r) return;
    r.done = !r.done; learnTouch(t); saveLearnData(); learnRenderList(); learnRenderDetail();
}
function learnDeleteResource(rid) {
    const t = learnActiveTopic(); if (!t) return;
    t.resources = t.resources.filter(x => x.id !== rid);
    learnTouch(t); saveLearnData(); learnRenderList(); learnRenderDetail();
}

// ── Card mutations ─────────────────────────────────────────────────
function learnAddCard(front, back) {
    const t = learnActiveTopic(); if (!t || !front.trim()) return;
    const c = learnBlankCard(); c.front = front.trim(); c.back = back.trim();
    t.cards.push(c); learnTouch(t); saveLearnData(); learnRenderList(); learnRenderDetail();
}
function learnSaveCard(cid, front, back) {
    const t = learnActiveTopic(); if (!t) return;
    const c = t.cards.find(x => x.id === cid); if (!c) return;
    c.front = front.trim(); c.back = back.trim(); learnEditCard = null;
    learnTouch(t); saveLearnData(); learnRenderDetail();
}
function learnDeleteCard(cid) {
    const t = learnActiveTopic(); if (!t) return;
    t.cards = t.cards.filter(x => x.id !== cid);
    learnTouch(t); saveLearnData(); learnRenderList(); learnRenderDetail();
}

// ── Study session ──────────────────────────────────────────────────
function learnStartStudy(mode) {
    const t = learnActiveTopic(); if (!t) return;
    const pool = mode === 'cram' ? t.cards.slice() : learnDueCards(t);
    if (!pool.length) return;
    learnStudy = { topicId: t.id, queue: pool.map(c => c.id), reviewed: 0, total: pool.length, revealed: false };
    learnRenderDetail();
}
function learnRate(quality) {
    if (!learnStudy) return;
    const t = learnTopicById(learnStudy.topicId); if (!t) { learnStudy = null; return learnRenderDetail(); }
    const cid = learnStudy.queue[0];
    const card = t.cards.find(c => c.id === cid);
    if (card) {
        learnReviewCard(card, quality);
        learnTouch(t); learnScheduleSave();
    }
    learnStudy.queue.shift();
    if (quality === 'again' && card) learnStudy.queue.push(cid);  // repeat later this session
    else learnStudy.reviewed += 1;
    learnStudy.revealed = false;
    learnRenderDetail();
}
function learnEndStudy() { learnStudy = null; saveLearnData(); learnRenderList(); learnRenderDetail(); }

// ── Rendering: sidebar topic list ──────────────────────────────────
function learnRenderList() {
    const wrap = document.getElementById('learn-list'); if (!wrap) return;
    const list = learnFilteredTopics();
    if (!learnData.topics.length) {
        wrap.innerHTML = `<div class="text-center text-slate-600 text-xs px-4 py-10 leading-relaxed">
            Nothing yet.<br>Hit <span style="color:${LEARN_ACCENT}">New topic</span> to start learning something.</div>`;
        return;
    }
    if (!list.length) { wrap.innerHTML = `<div class="text-center text-slate-600 text-xs px-4 py-10">No topics match.</div>`; return; }
    wrap.innerHTML = list.map(t => {
        const active = t.id === learnActiveId;
        const due = learnDueCards(t).length;
        const prog = learnProgress(t);
        return `<button data-tid="${t.id}" class="learn-item w-full text-left px-3 py-2.5 rounded-lg mb-1 transition-colors ${active ? '' : 'hover:bg-slate-800/50'}"
            style="${active ? `background:${learnHex(t.color, 0.12)};border:1px solid ${learnHex(t.color, 0.3)}` : 'border:1px solid transparent'}">
            <div class="flex items-center gap-2">
                <span class="w-2 h-2 rounded-full shrink-0" style="background:${t.color || LEARN_ACCENT}"></span>
                <span class="text-slate-200 text-sm font-medium truncate flex-1">${escapeLearn(t.name || 'Untitled')}</span>
                ${due ? `<span class="text-[10px] px-1.5 py-0.5 rounded-full shrink-0" style="background:${learnHex(t.color,0.2)};color:${t.color}">${due} due</span>` : ''}
            </div>
            <div class="flex items-center gap-2 mt-1.5 pl-4">
                <div class="flex-1 h-1 rounded-full bg-slate-700/60 overflow-hidden"><div style="height:100%;width:${prog}%;background:${t.color || LEARN_ACCENT}"></div></div>
                <span class="text-slate-500 text-[10px] tabular-nums shrink-0">${t.cards.length} card${t.cards.length === 1 ? '' : 's'}</span>
            </div>
        </button>`;
    }).join('');
    wrap.querySelectorAll('.learn-item').forEach(b => b.addEventListener('click', () => learnSelectTopic(b.getAttribute('data-tid'))));
}

// ── Rendering: detail (overview / cards / study) ───────────────────
function learnRenderDetail() {
    const wrap = document.getElementById('learn-detail'); if (!wrap) return;
    const t = learnActiveTopic();
    if (!t) {
        wrap.innerHTML = `<div class="flex-1 flex flex-col items-center justify-center text-center text-slate-600 px-8">
            <i class="fas fa-lightbulb text-4xl mb-4" style="color:${learnHex(LEARN_ACCENT, 0.4)}"></i>
            <p class="text-slate-400 text-sm font-medium">Nothing selected</p>
            <p class="text-slate-600 text-xs mt-1">Pick a topic on the left, or create a new one.</p>
        </div>`;
        return;
    }
    if (learnStudy && learnStudy.topicId === t.id) return learnRenderStudy(wrap, t);

    const ac = t.color || LEARN_ACCENT;
    const due = learnDueCards(t).length;
    const tabBtn = (id, label) => `<button data-tab="${id}" class="learn-tab text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
        style="${learnTab === id ? `background:${learnHex(ac,0.16)};color:${ac}` : 'color:rgb(var(--slate-400))'}">${label}</button>`;

    wrap.innerHTML = `
    <div class="max-w-3xl w-full mx-auto px-8 py-7">
        <div class="flex items-start justify-between gap-4 mb-4">
            <input id="learn-name" type="text" value="${escapeLearn(t.name)}" placeholder="Topic name"
                class="flex-1 bg-transparent text-slate-100 text-2xl font-bold outline-none placeholder-slate-700 border-b border-transparent focus:border-slate-700 pb-1" style="min-width:0">
            <button id="learn-delete" title="Delete topic"
                class="shrink-0 w-9 h-9 rounded-lg bg-slate-800 hover:bg-red-600/20 border border-slate-700/60 hover:border-red-600/40 text-slate-400 hover:text-red-400 flex items-center justify-center transition-colors">
                <i class="fas fa-trash-alt text-xs"></i>
            </button>
        </div>
        <div class="flex items-center gap-2 mb-6">
            ${tabBtn('overview', 'Overview')}
            ${tabBtn('cards', `Flashcards · ${t.cards.length}`)}
            ${due ? `<button id="learn-study-due" class="ml-auto text-xs font-semibold px-3 py-1.5 rounded-lg" style="background:${ac};color:#0a0f0a"><i class="fas fa-bolt text-[10px] mr-1"></i>Study ${due} due</button>` : ''}
        </div>
        <div id="learn-pane"></div>
    </div>`;

    wrap.querySelectorAll('.learn-tab').forEach(b => b.addEventListener('click', () => { learnTab = b.getAttribute('data-tab'); learnRenderDetail(); }));
    const sd = document.getElementById('learn-study-due'); if (sd) sd.addEventListener('click', () => learnStartStudy('due'));
    const nm = document.getElementById('learn-name');
    if (nm) nm.addEventListener('input', () => { t.name = nm.value; learnTouch(t); learnRenderList(); learnScheduleSave(); });
    const del = document.getElementById('learn-delete'); if (del) del.addEventListener('click', () => learnDeleteTopic(t.id));

    if (learnTab === 'overview') learnRenderOverview(t, ac);
    else learnRenderCards(t, ac);

    wrap.querySelectorAll('input, textarea').forEach(el => el.addEventListener('keydown', e => e.stopPropagation()));
}

function learnRenderOverview(t, ac) {
    const pane = document.getElementById('learn-pane'); if (!pane) return;
    const prog = learnProgress(t);
    const taCls = 'w-full bg-slate-800/40 text-slate-200 text-sm leading-relaxed border border-slate-700/50 rounded-xl px-4 py-3 outline-none resize-none chat-scroll placeholder-slate-600 transition-colors';
    pane.innerHTML = `
        <div class="mb-6">
            <h3 class="text-slate-300 text-xs font-semibold uppercase tracking-widest mb-2">What you're learning</h3>
            <textarea id="learn-desc" rows="3" class="${taCls}" placeholder="What is this topic? Why are you learning it?">${escapeLearn(t.desc)}</textarea>
        </div>
        <div class="mb-3 flex items-center gap-3">
            <h3 class="text-slate-300 text-xs font-semibold uppercase tracking-widest">Progress</h3>
            <div class="flex-1 h-2 rounded-full bg-slate-700/60 overflow-hidden"><div style="height:100%;width:${prog}%;background:${ac};transition:width .25s"></div></div>
            <span class="text-slate-300 text-xs tabular-nums font-semibold" style="color:${ac}">${prog}%</span>
        </div>
        <div class="mb-2 flex items-center gap-2">
            <i class="fas fa-list-check text-xs" style="color:${ac}"></i>
            <h3 class="text-slate-300 text-xs font-semibold uppercase tracking-widest">Resources &amp; milestones</h3>
        </div>
        <div id="learn-res-list" class="mb-3"></div>
        <div class="flex gap-2">
            <input id="learn-res-title" type="text" placeholder="Add a resource or milestone…" class="flex-1 bg-slate-800/70 text-slate-200 text-sm border border-slate-700/60 rounded-lg px-3 py-2 outline-none placeholder-slate-600">
            <input id="learn-res-url" type="text" placeholder="link (optional)" class="w-40 bg-slate-800/70 text-slate-200 text-sm border border-slate-700/60 rounded-lg px-3 py-2 outline-none placeholder-slate-600">
            <button id="learn-res-add" class="px-3 py-2 rounded-lg text-sm font-medium shrink-0" style="background:${learnHex(ac,0.15)};border:1px solid ${learnHex(ac,0.3)};color:${ac}">Add</button>
        </div>`;

    const desc = document.getElementById('learn-desc');
    if (desc) desc.addEventListener('input', () => { t.desc = desc.value; learnTouch(t); learnScheduleSave(); });

    const rl = document.getElementById('learn-res-list');
    if (rl) {
        if (!t.resources.length) rl.innerHTML = `<div class="text-slate-600 text-xs py-3">No resources yet — add links, books, videos, or milestones to track.</div>`;
        else rl.innerHTML = t.resources.map(r => `
            <div class="flex items-center gap-3 py-2 px-2 rounded-lg hover:bg-slate-800/40 group">
                <button data-toggle="${r.id}" class="w-4 h-4 rounded shrink-0 flex items-center justify-center border transition-colors"
                    style="${r.done ? `background:${ac};border-color:${ac}` : 'border-color:rgb(var(--slate-600))'}">
                    ${r.done ? '<i class="fas fa-check text-[9px]" style="color:#0a0f0a"></i>' : ''}
                </button>
                <span class="flex-1 text-sm truncate ${r.done ? 'text-slate-500 line-through' : 'text-slate-200'}">${escapeLearn(r.title)}</span>
                ${r.url ? `<button data-open="${escapeLearn(r.url)}" class="text-slate-500 hover:text-sky-400 text-xs shrink-0"><i class="fas fa-arrow-up-right-from-square"></i></button>` : ''}
                <button data-del="${r.id}" class="text-slate-600 hover:text-red-400 text-xs shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"><i class="fas fa-times"></i></button>
            </div>`).join('');
        rl.querySelectorAll('[data-toggle]').forEach(b => b.addEventListener('click', () => learnToggleResource(b.getAttribute('data-toggle'))));
        rl.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => learnDeleteResource(b.getAttribute('data-del'))));
        rl.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => learnOpenUrl(b.getAttribute('data-open'))));
    }
    const ti = document.getElementById('learn-res-title'), ui = document.getElementById('learn-res-url'), add = document.getElementById('learn-res-add');
    const doAdd = () => { if (ti.value.trim()) { learnAddResource(ti.value, ui.value); } };
    if (add) add.addEventListener('click', doAdd);
    if (ti)  ti.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); doAdd(); } });
    if (ui)  ui.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); doAdd(); } });
}

function learnRenderCards(t, ac) {
    const pane = document.getElementById('learn-pane'); if (!pane) return;
    const due = learnDueCards(t).length;
    const taCls = 'w-full bg-slate-800/40 text-slate-200 text-sm leading-relaxed border border-slate-700/50 rounded-xl px-4 py-2.5 outline-none resize-none chat-scroll placeholder-slate-600';
    pane.innerHTML = `
        <div class="flex items-center gap-2 mb-4 text-xs">
            <span class="text-slate-400"><span class="font-semibold" style="color:${ac}">${due}</span> due now · ${t.cards.length} total</span>
            <div class="ml-auto flex gap-2">
                ${t.cards.length ? `<button id="learn-cram" class="px-3 py-1.5 rounded-lg font-medium text-slate-300 bg-slate-800 border border-slate-700/60 hover:bg-slate-700">Cram all</button>` : ''}
                ${due ? `<button id="learn-study2" class="px-3 py-1.5 rounded-lg font-semibold" style="background:${ac};color:#0a0f0a">Study due</button>` : ''}
            </div>
        </div>
        <div class="mb-5 p-3 rounded-xl border border-slate-700/50 bg-slate-800/30">
            <p class="text-slate-500 text-[10px] font-semibold uppercase tracking-widest mb-2">New card</p>
            <textarea id="learn-card-front" rows="2" class="${taCls} mb-2" placeholder="Front — question / prompt"></textarea>
            <textarea id="learn-card-back" rows="2" class="${taCls} mb-2" placeholder="Back — answer"></textarea>
            <div class="text-right"><button id="learn-card-add" class="px-3 py-1.5 rounded-lg text-sm font-medium" style="background:${learnHex(ac,0.15)};border:1px solid ${learnHex(ac,0.3)};color:${ac}">Add card</button></div>
        </div>
        <div id="learn-card-list"></div>`;

    const cs = document.getElementById('learn-study2'); if (cs) cs.addEventListener('click', () => learnStartStudy('due'));
    const cr = document.getElementById('learn-cram');   if (cr) cr.addEventListener('click', () => learnStartStudy('cram'));
    const f = document.getElementById('learn-card-front'), b = document.getElementById('learn-card-back'), a = document.getElementById('learn-card-add');
    if (a) a.addEventListener('click', () => { if (f.value.trim()) { learnAddCard(f.value, b.value); } });

    const cl = document.getElementById('learn-card-list');
    if (cl) {
        if (!t.cards.length) cl.innerHTML = `<div class="text-slate-600 text-xs py-4 text-center">No cards yet — add your first one above.</div>`;
        else cl.innerHTML = t.cards.map(c => {
            if (learnEditCard === c.id) return `
                <div class="p-3 rounded-xl border mb-2" style="border-color:${learnHex(ac,0.4)}">
                    <textarea id="ec-front-${c.id}" rows="2" class="${taCls} mb-2">${escapeLearn(c.front)}</textarea>
                    <textarea id="ec-back-${c.id}" rows="2" class="${taCls} mb-2">${escapeLearn(c.back)}</textarea>
                    <div class="flex justify-end gap-2">
                        <button data-cancel="${c.id}" class="px-2.5 py-1 rounded-lg text-xs text-slate-400 bg-slate-800 border border-slate-700/60">Cancel</button>
                        <button data-save="${c.id}" class="px-2.5 py-1 rounded-lg text-xs font-medium" style="background:${learnHex(ac,0.15)};border:1px solid ${learnHex(ac,0.3)};color:${ac}">Save</button>
                    </div>
                </div>`;
            const dueNow = (c.due || 0) <= Date.now();
            return `<div class="flex items-start gap-3 py-2.5 px-3 rounded-lg hover:bg-slate-800/40 group border-b border-slate-800/40">
                <span class="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0" style="background:${dueNow ? ac : '#475569'}" title="${dueNow ? 'due now' : 'scheduled'}"></span>
                <div class="flex-1 min-w-0">
                    <div class="text-slate-200 text-sm truncate">${escapeLearn(c.front) || '<span class="text-slate-600">(empty)</span>'}</div>
                    <div class="text-slate-500 text-xs truncate">${escapeLearn(c.back)}</div>
                </div>
                <button data-edit="${c.id}" class="text-slate-600 hover:text-slate-300 text-xs shrink-0 opacity-0 group-hover:opacity-100"><i class="fas fa-pen"></i></button>
                <button data-delc="${c.id}" class="text-slate-600 hover:text-red-400 text-xs shrink-0 opacity-0 group-hover:opacity-100"><i class="fas fa-trash-alt"></i></button>
            </div>`;
        }).join('');
        cl.querySelectorAll('[data-edit]').forEach(x => x.addEventListener('click', () => { learnEditCard = x.getAttribute('data-edit'); learnRenderDetail(); }));
        cl.querySelectorAll('[data-delc]').forEach(x => x.addEventListener('click', () => learnDeleteCard(x.getAttribute('data-delc'))));
        cl.querySelectorAll('[data-cancel]').forEach(x => x.addEventListener('click', () => { learnEditCard = null; learnRenderDetail(); }));
        cl.querySelectorAll('[data-save]').forEach(x => x.addEventListener('click', () => {
            const id = x.getAttribute('data-save');
            learnSaveCard(id, document.getElementById('ec-front-' + id).value, document.getElementById('ec-back-' + id).value);
        }));
    }
    pane.querySelectorAll('textarea').forEach(el => el.addEventListener('keydown', e => e.stopPropagation()));
}

// ── Rendering: study session ───────────────────────────────────────
function learnRenderStudy(wrap, t) {
    const ac = t.color || LEARN_ACCENT;
    if (!learnStudy.queue.length) {
        wrap.innerHTML = `<div class="flex-1 flex flex-col items-center justify-center text-center px-8">
            <i class="fas fa-circle-check text-5xl mb-4" style="color:${ac}"></i>
            <p class="text-slate-100 text-xl font-bold">Session complete</p>
            <p class="text-slate-500 text-sm mt-1">Reviewed ${learnStudy.reviewed} card${learnStudy.reviewed === 1 ? '' : 's'} in “${escapeLearn(t.name)}”.</p>
            <button id="learn-study-done" class="mt-6 px-4 py-2 rounded-lg text-sm font-medium" style="background:${learnHex(ac,0.15)};border:1px solid ${learnHex(ac,0.3)};color:${ac}">Done</button>
        </div>`;
        const d = document.getElementById('learn-study-done'); if (d) d.addEventListener('click', learnEndStudy);
        return;
    }
    const card = t.cards.find(c => c.id === learnStudy.queue[0]);
    if (!card) { learnStudy.queue.shift(); return learnRenderStudy(wrap, t); }
    const doneN = learnStudy.total - new Set(learnStudy.queue).size;
    const pct = Math.round(100 * Math.min(learnStudy.reviewed, learnStudy.total) / learnStudy.total);

    wrap.innerHTML = `
    <div class="max-w-2xl w-full mx-auto px-8 py-6 flex flex-col" style="min-height:100%">
        <div class="flex items-center gap-3 mb-6">
            <button id="learn-exit" class="text-slate-500 hover:text-slate-300 text-xs"><i class="fas fa-xmark mr-1"></i>Exit</button>
            <div class="flex-1 h-1.5 rounded-full bg-slate-700/60 overflow-hidden"><div style="height:100%;width:${pct}%;background:${ac};transition:width .2s"></div></div>
            <span class="text-slate-500 text-xs tabular-nums">${learnStudy.reviewed}/${learnStudy.total}</span>
        </div>
        <div class="flex-1 flex flex-col items-center justify-center text-center gap-5 py-6">
            <div class="text-slate-100 text-2xl font-semibold leading-snug whitespace-pre-wrap">${escapeLearn(card.front) || '(empty)'}</div>
            ${learnStudy.revealed ? `<div class="w-full border-t border-slate-700/50 pt-5 text-slate-300 text-lg leading-relaxed whitespace-pre-wrap">${escapeLearn(card.back) || '<span class=\"text-slate-600\">(no answer)</span>'}</div>` : ''}
        </div>
        <div class="pt-4">
            ${learnStudy.revealed ? `
                <div class="grid grid-cols-4 gap-2">
                    <button data-q="again" class="py-2.5 rounded-xl text-sm font-semibold text-red-300 bg-red-600/15 border border-red-600/30 hover:bg-red-600/25">Again<br><span class="text-[10px] opacity-70">${learnIvlLabel(card,'again')}</span></button>
                    <button data-q="hard" class="py-2.5 rounded-xl text-sm font-semibold text-amber-300 bg-amber-600/15 border border-amber-600/30 hover:bg-amber-600/25">Hard<br><span class="text-[10px] opacity-70">${learnIvlLabel(card,'hard')}</span></button>
                    <button data-q="good" class="py-2.5 rounded-xl text-sm font-semibold text-sky-300 bg-sky-600/15 border border-sky-600/30 hover:bg-sky-600/25">Good<br><span class="text-[10px] opacity-70">${learnIvlLabel(card,'good')}</span></button>
                    <button data-q="easy" class="py-2.5 rounded-xl text-sm font-semibold text-emerald-300 bg-emerald-600/15 border border-emerald-600/30 hover:bg-emerald-600/25">Easy<br><span class="text-[10px] opacity-70">${learnIvlLabel(card,'easy')}</span></button>
                </div>` : `
                <button id="learn-reveal" class="w-full py-3 rounded-xl text-sm font-semibold" style="background:${ac};color:#0a0f0a">Show answer</button>`}
        </div>
    </div>`;

    const ex = document.getElementById('learn-exit'); if (ex) ex.addEventListener('click', learnEndStudy);
    const rev = document.getElementById('learn-reveal'); if (rev) rev.addEventListener('click', () => { learnStudy.revealed = true; learnRenderStudy(wrap, t); });
    wrap.querySelectorAll('[data-q]').forEach(b => b.addEventListener('click', () => learnRate(b.getAttribute('data-q'))));
}

// ── utils ──────────────────────────────────────────────────────────
function escapeLearn(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
// hex (#rrggbb) → rgba string with given alpha
function learnHex(hex, a) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return `rgba(132,204,22,${a})`;
    const n = parseInt(m[1], 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
function learnOpenUrl(url) {
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    try { if (typeof browserOpenUrl === 'function') { browserOpenUrl(url); return; } } catch (_) {}
    try { const r = (typeof require === 'function') ? require : window.require; if (r) { r('electron').shell.openExternal(url); return; } } catch (_) {}
    try { window.open(url, '_blank'); } catch (_) {}
}

// ── Entry point ────────────────────────────────────────────────────
function renderLearn() {
    learnData = loadLearnData();
    if (!Array.isArray(learnData.topics)) learnData.topics = [];
    learnData.topics.forEach(t => { t.resources = t.resources || []; t.cards = t.cards || []; });

    if (!learnBuilt) {
        const nb = document.getElementById('learn-new-btn'); if (nb) nb.addEventListener('click', learnCreateTopic);
        const s = document.getElementById('learn-search');
        if (s) { s.addEventListener('input', () => { learnSearch = s.value; learnRenderList(); }); s.addEventListener('keydown', e => e.stopPropagation()); }
        learnBuilt = true;
    }
    if (!learnActiveTopic()) { const l = learnFilteredTopics(); learnActiveId = l.length ? l[0].id : null; }
    learnRenderList();
    learnRenderDetail();
}
