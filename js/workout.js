// ── Workouts — Weekly planner, exercises (wger images) & nutrition ──
// Depends on: globals.js (fs, path, WORKOUT_FILE, WORKOUT_DIR, workoutData,
//             workoutWeekAnchor)

// ── Persistence ────────────────────────────────────────────────────
function loadWorkoutData() {
    try {
        if (fs.existsSync(WORKOUT_FILE)) {
            const d = readJsonStrict(WORKOUT_FILE);
            return { days: d.days || {}, settings: d.settings || {} };
        }
    } catch (_) {}
    return { days: {}, settings: {} };
}
function saveWorkoutData() {
    try { writeJsonSafe(WORKOUT_FILE, workoutData); }
    catch (e) { console.error('[workout] save failed:', e); }
}

// ── Date helpers (local, no UTC drift) ─────────────────────────────
function woKey(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}
function woMonday(date) {
    const x = new Date(date);
    x.setHours(0, 0, 0, 0);
    const dow = (x.getDay() + 6) % 7; // 0 = Monday
    x.setDate(x.getDate() - dow);
    return x;
}
function woAddDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function woDay(key) {
    if (!workoutData.days[key]) workoutData.days[key] = { exercises: [], meals: [] };
    const d = workoutData.days[key];
    if (!d.exercises) d.exercises = [];
    if (!d.meals) d.meals = [];
    return d;
}
function woId(prefix) { return prefix + Date.now() + Math.random().toString(36).slice(2, 6); }
function woEsc(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

const WO_WEEKDAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const WO_MONTHS   = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// ── Media (free-exercise-db) ───────────────────────────────────────
// Images & search come from the open-source free-exercise-db dataset
// (873 exercises, each with photos hosted on GitHub's raw CDN).
const WO_EXDB_JSON  = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json';
const WO_EXDB_BASE  = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/';
const WO_EXDB_CACHE = path.join(WORKOUT_DIR, 'exercise-db.json');

let _woExDb        = null;   // [{ name, toks, images }]
let _woExDbLoading = null;   // in-flight load promise (single-flight)

const _WO_STOP = new Set(['the', 'a', 'with', 'and', 'of', 'to', 'for', 'on']);
function _woTokens(s) {
    return String(s == null ? '' : s).toLowerCase()
        .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
        .split(' ').filter(w => w.length > 1 && !_WO_STOP.has(w));
}

// Load (and disk-cache) the exercise dataset. Resolves to the parsed array,
// or throws if it can't be fetched and isn't cached yet.
async function woLoadExerciseDb() {
    if (_woExDb) return _woExDb;
    if (_woExDbLoading) return _woExDbLoading;
    _woExDbLoading = (async () => {
        let raw = null;
        try { if (fs.existsSync(WO_EXDB_CACHE)) raw = JSON.parse(fs.readFileSync(WO_EXDB_CACHE, 'utf8')); } catch (_) {}
        if (!raw) {
            const res = await fetch(WO_EXDB_JSON);
            if (!res.ok) throw new Error('exercise-db ' + res.status);
            raw = await res.json();
            try { fs.writeFileSync(WO_EXDB_CACHE, JSON.stringify(raw)); } catch (_) {}
        }
        _woExDb = (raw || [])
            .filter(e => e.images && e.images.length)
            .map(e => ({ name: e.name, toks: _woTokens(e.name), images: e.images }));
        return _woExDb;
    })();
    try { return await _woExDbLoading; }
    finally { _woExDbLoading = null; }
}

// Best-matching image URL for an exercise name (null if no confident match).
// Requires the dataset to already be loaded (call woLoadExerciseDb first).
function woMatchImageUrl(name) {
    if (!_woExDb) return null;
    const qt = _woTokens(name);
    if (!qt.length) return null;
    let best = null, bestScore = 0;
    for (const c of _woExDb) {
        let hit = 0;
        for (const t of qt) if (c.toks.includes(t)) hit++;
        if (!hit) continue;
        const score = hit / qt.length - Math.abs(c.toks.length - qt.length) * 0.04;
        if (score > bestScore) { bestScore = score; best = c; }
    }
    if (!best || bestScore < 0.5) return null;
    return WO_EXDB_BASE + best.images[0];
}

// Search the dataset by name (used by the "Add exercise" modal). Returns
// [{ name, img, category }] with a remote image URL for each result.
async function woSearchExercises(term) {
    const db = await woLoadExerciseDb();
    const qt = _woTokens(term);
    if (!qt.length) return [];
    const scored = [];
    for (const c of db) {
        let hit = 0;
        for (const t of qt) if (c.toks.some(ct => ct.startsWith(t))) hit++;
        if (hit) scored.push({ c, score: hit });
    }
    scored.sort((a, b) => b.score - a.score || a.c.name.length - b.c.name.length);
    return scored.slice(0, 30).map(({ c }) => ({
        name: c.name, img: WO_EXDB_BASE + c.images[0], category: '',
    }));
}

// Download an image into WORKOUT_DIR and return its local file path (or null)
async function woCacheImage(url, id) {
    if (!url) return null;
    try {
        const res = await fetch(url);
        if (!res.ok) return null;
        const buf = Buffer.from(await res.arrayBuffer());
        let ext = (url.split('?')[0].split('.').pop() || 'png').toLowerCase();
        if (!/^(png|jpg|jpeg|gif|webp|svg)$/.test(ext)) ext = 'png';
        const fp = path.join(WORKOUT_DIR, id + '.' + ext);
        fs.writeFileSync(fp, buf);
        return fp;
    } catch (_) { return null; }
}
function woImgSrc(localPath) {
    if (!localPath) return null;
    return 'file://' + localPath.replace(/\\/g, '/');
}

// ── Macro totals ───────────────────────────────────────────────────
function woDayTotals(day) {
    return (day.meals || []).reduce((t, m) => {
        t.cal += Number(m.calories) || 0;
        t.p   += Number(m.protein)  || 0;
        t.c    += Number(m.carbs)    || 0;
        t.f    += Number(m.fat)      || 0;
        return t;
    }, { cal: 0, p: 0, c: 0, f: 0 });
}

// ── Render ─────────────────────────────────────────────────────────
function renderWorkout() {
    if (!workoutWeekAnchor) workoutWeekAnchor = woMonday(new Date());
    const grid = document.getElementById('workout-week-grid');
    if (!grid) return;

    const monday = woMonday(workoutWeekAnchor);
    const sunday = woAddDays(monday, 6);
    const label = document.getElementById('workout-week-label');
    if (label) {
        const sameMonth = monday.getMonth() === sunday.getMonth();
        label.textContent = sameMonth
            ? `${WO_MONTHS[monday.getMonth()]} ${monday.getDate()} – ${sunday.getDate()}, ${sunday.getFullYear()}`
            : `${WO_MONTHS[monday.getMonth()]} ${monday.getDate()} – ${WO_MONTHS[sunday.getMonth()]} ${sunday.getDate()}, ${sunday.getFullYear()}`;
    }

    const todayKey = woKey(new Date());

    // Widen today's column so the current day stands out (if it's this week)
    let todayCol = -1;
    for (let i = 0; i < 7; i++) { if (woKey(woAddDays(monday, i)) === todayKey) { todayCol = i; break; } }
    grid.style.gridTemplateColumns = Array.from({ length: 7 },
        (_, i) => i === todayCol ? 'minmax(0,2fr)' : 'minmax(0,1fr)').join(' ');

    // Week stats + nutrition target
    let statsTrained = 0, statsDaysDone = 0, statsExDone = 0, statsExTotal = 0;
    const calTarget = Number(workoutData.settings?.calTarget) || 0;

    let html = '';
    for (let i = 0; i < 7; i++) {
        const date = woAddDays(monday, i);
        const key  = woKey(date);
        const day  = woDay(key);
        const isToday = key === todayKey;
        const totals  = woDayTotals(day);
        const isRest     = day.focus === 'rest';
        const focusLabel = WO_FOCUS_LABELS[day.focus] || 'Workout';
        const focusIcon  = isRest ? 'fa-bed' : 'fa-dumbbell';

        // Completion tracking
        const exs       = day.exercises || [];
        const doneCount = exs.filter(e => e.done).length;
        const allDone   = exs.length > 0 && doneCount === exs.length;
        if (exs.length) {
            statsTrained++; statsExTotal += exs.length; statsExDone += doneCount;
            if (allDone) statsDaysDone++;
        }

        // Today's card is featured: wider column, larger exercise rows + images.
        const thumbCls = isToday ? 'w-16 h-16' : 'w-10 h-10';
        const exHtml = exs.map(ex => {
            const src = woImgSrc(ex.img);
            const thumb = src
                ? `<img src="${woEsc(src)}" class="${thumbCls} rounded-lg object-cover bg-slate-800 shrink-0" alt="">`
                : `<div class="${thumbCls} rounded-lg bg-slate-800 flex items-center justify-center shrink-0"><i class="fas fa-dumbbell text-slate-600 ${isToday ? 'text-lg' : 'text-xs'}"></i></div>`;
            const meta = [
                ex.sets && ex.reps ? `${ex.sets}×${ex.reps}` : (ex.reps ? `${ex.reps} reps` : ''),
                ex.weight ? `${ex.weight}` : ''
            ].filter(Boolean).join(' · ');
            const rowCls  = isToday ? 'gap-3 p-2' : 'gap-2 p-1.5';
            const nameCls = isToday ? 'text-slate-100 text-sm font-semibold' : 'text-slate-200 text-xs font-medium';
            const metaCls = isToday ? 'text-slate-400 text-xs' : 'text-slate-500 text-[10px]';
            const checkCls = ex.done
                ? 'bg-emerald-500 border-emerald-500 text-white'
                : 'border-slate-600 text-transparent hover:border-emerald-400';
            return `<div class="wo-ex flex items-center ${rowCls} rounded-lg hover:bg-slate-800/70 cursor-pointer transition-colors${ex.done ? ' opacity-55' : ''}"
                        onclick="workoutOpenExerciseDetail('${key}','${ex.id}')">
                    ${thumb}
                    <div class="min-w-0 flex-1">
                        <div class="${nameCls} truncate${ex.done ? ' line-through' : ''}">${woEsc(ex.name)}</div>
                        ${meta ? `<div class="${metaCls} truncate">${woEsc(meta)}</div>` : ''}
                    </div>
                    <button onclick="event.stopPropagation();workoutToggleDone('${key}','${ex.id}')" title="Mark as done"
                        class="shrink-0 ${isToday ? 'w-6 h-6' : 'w-5 h-5'} rounded-full border-2 ${checkCls} flex items-center justify-center transition-colors"><i class="fas fa-check text-[9px]"></i></button>
                </div>`;
        }).join('') || `<p class="text-slate-600 text-[11px] italic px-1.5 py-1">${isRest ? 'Rest &amp; recover' : 'No exercises'}</p>`;

        const mealHtml = (day.meals || []).map(m => {
            const macros = [
                m.protein ? `P${m.protein}` : '', m.carbs ? `C${m.carbs}` : '', m.fat ? `F${m.fat}` : ''
            ].filter(Boolean).join(' ');
            return `<div class="wo-meal flex items-center gap-2 p-1.5 rounded-lg hover:bg-slate-800/70 cursor-pointer transition-colors"
                        onclick="workoutOpenMealForm('${key}','${m.id}')">
                    <div class="min-w-0 flex-1">
                        <div class="text-slate-200 text-xs font-medium truncate">${woEsc(m.name)}</div>
                        ${macros ? `<div class="text-slate-500 text-[10px] truncate">${woEsc(macros)}</div>` : ''}
                    </div>
                    ${m.calories ? `<span class="text-emerald-400/80 text-[10px] font-semibold tabular-nums shrink-0">${Number(m.calories)} kcal</span>` : ''}
                </div>`;
        }).join('') || `<p class="text-slate-600 text-[11px] italic px-1.5 py-1">No meals</p>`;

        html += `
        <div class="wo-day-card flex flex-col bg-slate-900/40 border ${isToday ? 'border-emerald-500/60 shadow-lg shadow-emerald-900/30' : 'border-slate-800/70'} rounded-xl overflow-hidden" style="min-height:${isToday ? 360 : 260}px; max-height:100%">
            <div class="px-3 ${isToday ? 'py-2.5' : 'py-2'} border-b ${isToday ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-slate-800/70 bg-slate-900/60'} shrink-0 flex items-center justify-between">
                <span class="${isToday ? 'text-sm' : 'text-xs'} font-semibold ${isToday ? 'text-emerald-300' : 'text-slate-300'}">${WO_WEEKDAYS[i]}${isToday ? ' · Today' : ''}${allDone ? ' <i class="fas fa-circle-check text-emerald-400 text-[10px]"></i>' : ''}</span>
                <div class="flex items-center gap-2">
                    <span class="text-[10px] ${isToday ? 'text-emerald-400/80' : 'text-slate-500'} tabular-nums">${WO_MONTHS[date.getMonth()]} ${date.getDate()}</span>
                    <button onclick="event.stopPropagation();workoutOpenDay('${key}')" title="Zoom in / edit day" class="text-slate-500 hover:text-emerald-300 transition-colors"><i class="fas fa-expand text-[11px]"></i></button>
                </div>
            </div>
            <div class="flex-1 overflow-y-auto chat-scroll p-2 flex flex-col gap-3">
                <div>
                    <div class="flex items-center justify-between mb-1 px-1">
                        <span class="text-[10px] uppercase tracking-wide ${isRest ? 'text-slate-600' : 'text-emerald-500/80'} font-semibold"><i class="fas ${focusIcon} mr-1"></i>${focusLabel}${exs.length ? ` <span class="text-slate-500 normal-case tabular-nums">· ${doneCount}/${exs.length}</span>` : ''}</span>
                        <button onclick="workoutOpenAddExercise('${key}')" class="text-emerald-400 hover:text-emerald-300 text-[10px] font-semibold"><i class="fas fa-plus"></i></button>
                    </div>
                    <div class="flex flex-col gap-0.5">${exHtml}</div>
                </div>
                <div>
                    <div class="flex items-center justify-between mb-1 px-1">
                        <span class="text-[10px] uppercase tracking-wide text-slate-500 font-semibold"><i class="fas fa-utensils mr-1"></i>Food</span>
                        <button onclick="workoutOpenMealForm('${key}')" class="text-emerald-400 hover:text-emerald-300 text-[10px] font-semibold"><i class="fas fa-plus"></i></button>
                    </div>
                    <div class="flex flex-col gap-0.5">${mealHtml}</div>
                    ${totals.cal ? `<div class="mt-1.5 px-1.5 py-1 rounded-lg bg-slate-800/60 text-[10px] text-slate-400 flex items-center justify-between">
                        <span class="${calTarget && totals.cal > calTarget ? 'text-red-400' : 'text-emerald-400'} font-semibold tabular-nums">${totals.cal}${calTarget ? '/' + calTarget : ''} kcal</span>
                        <span class="tabular-nums">P${totals.p} C${totals.c} F${totals.f}</span>
                    </div>` : ''}
                </div>
            </div>
        </div>`;
    }
    grid.innerHTML = html;

    // Week progress readout in the view header
    const statsEl = document.getElementById('workout-stats');
    if (statsEl) {
        statsEl.textContent = statsExTotal
            ? `${statsDaysDone}/${statsTrained} days complete · ${statsExDone}/${statsExTotal} exercises done`
            : '';
    }

    // Fetch images for every visible day's exercises that don't have one yet.
    // Today is enriched first so the featured card fills in soonest.
    const weekKeys = Array.from({ length: 7 }, (_, i) => woKey(woAddDays(monday, i)));
    if (todayCol !== -1) weekKeys.sort((a, b) => (a === todayKey ? -1 : b === todayKey ? 1 : 0));
    woEnrichImages(weekKeys);

    // Keep the zoomed-in day view in sync (also lets images pop in there)
    if (_woOpenDay && document.getElementById('workout-day-modal')?.style.display === 'flex') {
        renderWorkoutDay();
    }
}

// Background image fetch for the given day keys. Each exercise is matched
// against the dataset and its photo cached locally. Tried once per session
// (guarded by _woImgAttempted) and serialised by _woEnriching so re-renders
// triggered by a landed image don't spawn overlapping loops. Images pop in
// progressively. Stops quietly when offline.
let _woEnriching      = false;
let _woImgGaveUp      = false;   // a fetch failed (offline) — stop trying this session
const _woImgAttempted = new Set();
async function woEnrichImages(keys) {
    if (_woEnriching || _woImgGaveUp) return;

    const pending = [];
    for (const key of keys) {
        const day = workoutData.days[key];
        if (!day || !day.exercises) continue;
        for (const ex of day.exercises) {
            if (!ex.img && !_woImgAttempted.has(ex.id)) pending.push(ex);
        }
    }
    if (!pending.length) return;

    _woEnriching = true;
    let landed = false;
    try {
        await woLoadExerciseDb();
        for (const ex of pending) {
            if (ex.img) continue;
            _woImgAttempted.add(ex.id);
            const url = woMatchImageUrl(ex.name);
            if (!url) continue;                       // no confident match → keep placeholder
            const local = await woCacheImage(url, ex.id);   // returns null on failure, never throws
            if (local) { ex.img = local; landed = true; saveWorkoutData(); renderWorkout(); }
        }
    } catch (_) {
        _woImgGaveUp = true;                          // dataset couldn't load (offline, no cache)
    } finally {
        _woEnriching = false;
        if (landed) renderWorkout();
    }
}

// ── Modal helpers ──────────────────────────────────────────────────
function workoutOpenModal(title, bodyHtml) {
    document.getElementById('workout-modal-title').textContent = title;
    document.getElementById('workout-modal-body').innerHTML = bodyHtml;
    document.getElementById('workout-modal').style.display = 'flex';
}
function workoutCloseModal() {
    document.getElementById('workout-modal').style.display = 'none';
}

// ── Zoomed-in single-day view ──────────────────────────────────────
let _woOpenDay = null;   // dateKey of the day open in the big overlay

const _WO_DAY_BTN = 'w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center text-xs disabled:opacity-25 disabled:pointer-events-none transition-colors';

function workoutOpenDay(key) {
    _woOpenDay = key;
    document.getElementById('workout-day-modal').style.display = 'flex';
    renderWorkoutDay();
    // Make sure this day's images get fetched even if it's not the current week's today
    woEnrichImages([key]);
}
function workoutCloseDay() {
    _woOpenDay = null;
    document.getElementById('workout-day-modal').style.display = 'none';
}

function renderWorkoutDay() {
    if (!_woOpenDay) return;
    const key   = _woOpenDay;
    const day   = woDay(key);
    const [y, m, d] = key.split('-').map(Number);
    const date  = new Date(y, m - 1, d);
    const isRest     = day.focus === 'rest';
    const focusLabel = WO_FOCUS_LABELS[day.focus] || 'Workout';
    const totals     = woDayTotals(day);

    const titleEl = document.getElementById('workout-day-title');
    if (titleEl) {
        titleEl.innerHTML = `${WO_WEEKDAYS[(date.getDay() + 6) % 7]}, ${WO_MONTHS[date.getMonth()]} ${date.getDate()}`
            + `<span class="ml-2 text-xs font-medium ${isRest ? 'text-slate-500' : 'text-emerald-400/80'}">${focusLabel}</span>`;
    }

    const exercises = day.exercises || [];
    const exRows = exercises.map((ex, idx) => {
        const src   = woImgSrc(ex.img);
        const thumb = src
            ? `<img src="${woEsc(src)}" class="w-20 h-20 rounded-xl object-cover bg-slate-800 shrink-0" alt="">`
            : `<div class="w-20 h-20 rounded-xl bg-slate-800 flex items-center justify-center shrink-0"><i class="fas fa-dumbbell text-slate-600 text-xl"></i></div>`;
        const meta = [
            ex.sets && ex.reps ? `${ex.sets} × ${ex.reps}` : (ex.reps ? `${ex.reps} reps` : ''),
            ex.weight ? `${ex.weight}` : '',
            ex.notes ? `${ex.notes}` : '',
        ].filter(Boolean).join('  ·  ');
        const checkCls = ex.done
            ? 'bg-emerald-500 border-emerald-500 text-white'
            : 'border-slate-600 text-transparent hover:border-emerald-400';
        return `<div class="flex items-center gap-4 p-3 rounded-2xl bg-slate-900/50 border ${ex.done ? 'border-emerald-600/40 opacity-70' : 'border-slate-800/70'}">
                <button onclick="workoutToggleDone('${key}','${ex.id}')" title="Mark as done"
                    class="w-8 h-8 rounded-full border-2 ${checkCls} flex items-center justify-center shrink-0 transition-colors"><i class="fas fa-check text-xs"></i></button>
                ${thumb}
                <div class="min-w-0 flex-1">
                    <div class="text-slate-100 text-base font-semibold truncate${ex.done ? ' line-through' : ''}">${woEsc(ex.name)}</div>
                    ${meta ? `<div class="text-slate-400 text-sm mt-1 truncate">${woEsc(meta)}</div>` : `<div class="text-slate-600 text-sm mt-1 italic">Tap edit to add sets &amp; reps</div>`}
                </div>
                <div class="flex items-center gap-1.5 shrink-0">
                    <button onclick="workoutMoveExercise('${key}','${ex.id}',-1)" ${idx === 0 ? 'disabled' : ''} class="${_WO_DAY_BTN}" title="Move up"><i class="fas fa-arrow-up"></i></button>
                    <button onclick="workoutMoveExercise('${key}','${ex.id}',1)" ${idx === exercises.length - 1 ? 'disabled' : ''} class="${_WO_DAY_BTN}" title="Move down"><i class="fas fa-arrow-down"></i></button>
                    <button onclick="workoutOpenSwapExercise('${key}','${ex.id}')" class="${_WO_DAY_BTN}" title="Swap for another exercise"><i class="fas fa-right-left"></i></button>
                    <button onclick="workoutOpenExerciseDetail('${key}','${ex.id}')" class="${_WO_DAY_BTN}" title="Edit sets/reps"><i class="fas fa-pen"></i></button>
                    <button onclick="workoutDeleteExercise('${key}','${ex.id}')" class="${_WO_DAY_BTN} hover:text-red-300" title="Remove"><i class="fas fa-trash"></i></button>
                </div>
            </div>`;
    }).join('') || `<p class="text-slate-500 text-sm text-center py-10">${isRest ? 'Rest &amp; recover — no exercises planned.' : 'No exercises yet — add one below.'}</p>`;

    const mealRows = (day.meals || []).map(ml => {
        const macros = [
            ml.protein ? `P${ml.protein}` : '', ml.carbs ? `C${ml.carbs}` : '', ml.fat ? `F${ml.fat}` : ''
        ].filter(Boolean).join('  ');
        return `<div onclick="workoutOpenMealForm('${key}','${ml.id}')" class="flex items-center gap-3 p-2.5 rounded-xl bg-slate-900/50 border border-slate-800/70 hover:border-slate-600/60 cursor-pointer transition-colors">
                <div class="min-w-0 flex-1">
                    <div class="text-slate-200 text-sm font-medium truncate">${woEsc(ml.name)}</div>
                    ${macros ? `<div class="text-slate-500 text-xs mt-0.5">${woEsc(macros)}</div>` : ''}
                </div>
                ${ml.calories ? `<span class="text-emerald-400/80 text-xs font-semibold tabular-nums shrink-0">${Number(ml.calories)} kcal</span>` : ''}
            </div>`;
    }).join('') || `<p class="text-slate-600 text-xs italic px-1 py-2">No meals logged.</p>`;

    // Completion + nutrition-target progress
    const doneCount = exercises.filter(e => e.done).length;
    const calT = Number(workoutData.settings?.calTarget) || 0;
    const pT   = Number(workoutData.settings?.proteinTarget) || 0;
    const bar = (label, val, target, unit, color) => {
        const pct  = Math.min(100, Math.round(val / target * 100));
        const over = val > target;
        return `<div class="mb-2">
            <div class="flex justify-between text-[11px] mb-1"><span class="text-slate-400">${label}</span>
                <span class="${over ? 'text-red-400' : 'text-slate-300'} tabular-nums">${val} / ${target} ${unit}</span></div>
            <div class="h-1.5 rounded-full bg-slate-800 overflow-hidden"><div class="h-full ${over ? 'bg-red-500' : color}" style="width:${pct}%"></div></div>
        </div>`;
    };

    const bodyEl = document.getElementById('workout-day-body');
    if (bodyEl) bodyEl.innerHTML = `
        <div class="flex items-center justify-between mb-3">
            <span class="text-xs uppercase tracking-wide ${isRest ? 'text-slate-500' : 'text-emerald-500/80'} font-semibold"><i class="fas fa-dumbbell mr-1.5"></i>Exercises${exercises.length ? ` <span class="text-slate-500 normal-case tabular-nums">· ${doneCount}/${exercises.length} done</span>` : ''}</span>
            <div class="flex items-center gap-2">
                <button onclick="workoutSendToPhone('${key}')" title="Send this workout to your phone" class="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700/50 text-slate-300 text-xs font-semibold transition-colors"><i class="fas fa-mobile-alt mr-1"></i>To phone</button>
                <button onclick="workoutOpenAddExercise('${key}')" class="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors"><i class="fas fa-plus mr-1"></i>Add exercise</button>
            </div>
        </div>
        ${exercises.length ? `<div class="h-1.5 rounded-full bg-slate-800 mb-3 overflow-hidden"><div class="h-full bg-emerald-500 transition-all" style="width:${Math.round(doneCount / exercises.length * 100)}%"></div></div>` : ''}
        <div class="flex flex-col gap-2 mb-7">${exRows}</div>
        <div class="flex items-center justify-between mb-3">
            <span class="text-xs uppercase tracking-wide text-slate-400 font-semibold"><i class="fas fa-utensils mr-1.5"></i>Food${totals.cal && !calT ? ` · <span class="text-emerald-400">${totals.cal} kcal</span>` : ''}</span>
            <button onclick="workoutOpenMealForm('${key}')" class="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700/50 text-slate-300 text-xs font-semibold transition-colors"><i class="fas fa-plus mr-1"></i>Add meal</button>
        </div>
        ${calT ? bar('Calories', totals.cal, calT, 'kcal', 'bg-emerald-500') : ''}
        ${pT ? bar('Protein', totals.p, pT, 'g', 'bg-sky-500') : ''}
        <div class="flex flex-col gap-2${calT || pT ? ' mt-1' : ''}">${mealRows}</div>`;
}

// Reorder an exercise within its day
function workoutMoveExercise(dateKey, exId, dir) {
    const arr = woDay(dateKey).exercises;
    const i = arr.findIndex(e => e.id === exId);
    if (i < 0) return;
    const j = i + dir;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    saveWorkoutData();
    renderWorkout();
}

// ── Swap an exercise for a different one ────────────────────────────
function workoutOpenSwapExercise(dateKey, exId) {
    const ex = woDay(dateKey).exercises.find(e => e.id === exId);
    if (!ex) return;

    // Quick alternatives from the same muscle group
    let altHtml = '';
    if (ex.group) {
        const alts = WO_EXERCISE_DB.filter(e => e.group === ex.group && e.name !== ex.name);
        if (alts.length) {
            altHtml = `<div class="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-1.5">Alternatives</div>
                <div class="flex flex-col gap-1.5 mb-4">` + alts.map(a =>
                `<div class="wo-result flex items-center gap-3 p-2 rounded-xl border border-slate-700/50 hover:border-emerald-600/60 hover:bg-slate-800/50 cursor-pointer transition-colors"
                    onclick="workoutSwapExercise('${dateKey}','${exId}', ${woEscAttr(a.name)}, null, ${woEscAttr(a.group)})">
                    <div class="w-10 h-10 rounded-lg bg-slate-800 flex items-center justify-center shrink-0"><i class="fas fa-dumbbell text-slate-600"></i></div>
                    <div class="text-slate-200 text-sm font-medium">${woEsc(a.name)}</div>
                </div>`).join('') + `</div>`;
        }
    }

    workoutOpenModal('Swap exercise', `
        <p class="text-slate-400 text-xs mb-3">Replace <span class="text-slate-200 font-medium">${woEsc(ex.name)}</span> — keeps your sets, reps &amp; weight.</p>
        ${altHtml}
        <input id="wo-search-input" type="text" placeholder="Or search for any exercise…"
            class="w-full bg-slate-800/80 text-slate-100 text-sm border border-slate-700/60 rounded-xl px-4 py-2.5 outline-none focus:border-emerald-600/60 mb-3" style="color-scheme:dark">
        <div id="wo-search-results" class="flex flex-col gap-1.5 max-h-[40vh] overflow-y-auto chat-scroll"></div>
    `);

    const input   = document.getElementById('wo-search-input');
    const results = document.getElementById('wo-search-results');
    input.oninput = () => {
        const term = input.value.trim();
        clearTimeout(_woSearchTimer);
        if (term.length < 2) { results.innerHTML = ''; return; }
        results.innerHTML = `<p class="text-slate-500 text-xs text-center py-6"><i class="fas fa-circle-notch fa-spin mr-1"></i>Searching…</p>`;
        _woSearchTimer = setTimeout(async () => {
            try {
                const list = await woSearchExercises(term);
                if (!list.length) { results.innerHTML = `<p class="text-slate-500 text-xs text-center py-6">No matches.</p>`; return; }
                results.innerHTML = list.map(r => {
                    const thumb = r.img
                        ? `<img src="${woEsc(r.img)}" class="w-12 h-12 rounded-lg object-cover bg-slate-800 shrink-0" alt="">`
                        : `<div class="w-12 h-12 rounded-lg bg-slate-800 flex items-center justify-center shrink-0"><i class="fas fa-dumbbell text-slate-600"></i></div>`;
                    return `<div class="wo-result flex items-center gap-3 p-2 rounded-xl border border-slate-700/50 hover:border-emerald-600/60 hover:bg-slate-800/50 cursor-pointer transition-colors"
                            onclick="workoutSwapExercise('${dateKey}','${exId}', ${woEscAttr(r.name)}, ${woEscAttr(r.img || '')}, null)">
                            ${thumb}
                            <div class="min-w-0"><div class="text-slate-200 text-sm font-medium truncate">${woEsc(r.name)}</div></div>
                        </div>`;
                }).join('');
            } catch (e) {
                results.innerHTML = `<p class="text-red-400 text-xs text-center py-6">Search failed (offline?).</p>`;
            }
        }, 350);
    };
    setTimeout(() => input.focus(), 50);
}

async function workoutSwapExercise(dateKey, exId, name, imgUrl, group) {
    const ex = woDay(dateKey).exercises.find(e => e.id === exId);
    if (!ex) return;
    ex.name = name || ex.name;
    if (group) ex.group = group;
    ex.img = null;                      // drop the old photo
    _woImgAttempted.delete(exId);       // allow re-fetching a new one
    saveWorkoutData();
    workoutCloseModal();
    renderWorkout();
    // Cache the new photo (from search result, or matched by name)
    const url = imgUrl || (await woLoadExerciseDb().then(() => woMatchImageUrl(ex.name)).catch(() => null));
    if (url) {
        const local = await woCacheImage(url, exId);
        if (local) { ex.img = local; _woImgAttempted.add(exId); saveWorkoutData(); renderWorkout(); }
    }
}

// ── Add exercise (dataset search) ──────────────────────────────────
let _woSearchTimer = null;
function workoutOpenAddExercise(dateKey) {
    workoutOpenModal('Add exercise', `
        <input id="wo-search-input" type="text" placeholder="Search an exercise (e.g. bench press)…" autofocus
            class="w-full bg-slate-800/80 text-slate-100 text-sm border border-slate-700/60 rounded-xl px-4 py-2.5 outline-none focus:border-emerald-600/60 mb-3" style="color-scheme:dark">
        <div id="wo-search-results" class="flex flex-col gap-1.5 max-h-[48vh] overflow-y-auto chat-scroll"></div>
    `);
    const input  = document.getElementById('wo-search-input');
    const results = document.getElementById('wo-search-results');
    const renderEmpty = (msg) => { results.innerHTML = `<p class="text-slate-500 text-xs text-center py-6">${woEsc(msg)}</p>`; };
    renderEmpty('Type to search the exercise database.');

    input.oninput = () => {
        const term = input.value.trim();
        clearTimeout(_woSearchTimer);
        if (term.length < 2) { renderEmpty('Type at least 2 characters.'); return; }
        results.innerHTML = `<p class="text-slate-500 text-xs text-center py-6"><i class="fas fa-circle-notch fa-spin mr-1"></i>Searching…</p>`;
        _woSearchTimer = setTimeout(async () => {
            try {
                const list = await woSearchExercises(term);
                const customRow = `<div class="wo-result flex items-center gap-3 p-2 rounded-xl border border-dashed border-slate-700/70 hover:border-emerald-600/60 cursor-pointer transition-colors"
                        onclick="workoutAddExercise('${dateKey}', ${woEscAttr(term)}, null)">
                        <div class="w-12 h-12 rounded-lg bg-slate-800 flex items-center justify-center shrink-0"><i class="fas fa-plus text-slate-500"></i></div>
                        <div class="min-w-0"><div class="text-slate-200 text-sm font-medium">Add “${woEsc(term)}”</div><div class="text-slate-500 text-[11px]">Custom exercise — no image</div></div>
                    </div>`;
                if (!list.length) { results.innerHTML = customRow; return; }
                results.innerHTML = list.map(r => {
                    const thumb = r.img
                        ? `<img src="${woEsc(r.img)}" class="w-12 h-12 rounded-lg object-cover bg-slate-800 shrink-0" alt="">`
                        : `<div class="w-12 h-12 rounded-lg bg-slate-800 flex items-center justify-center shrink-0"><i class="fas fa-dumbbell text-slate-600"></i></div>`;
                    return `<div class="wo-result flex items-center gap-3 p-2 rounded-xl border border-slate-700/50 hover:border-emerald-600/60 hover:bg-slate-800/50 cursor-pointer transition-colors"
                            onclick="workoutAddExercise('${dateKey}', ${woEscAttr(r.name)}, ${woEscAttr(r.img || '')})">
                            ${thumb}
                            <div class="min-w-0"><div class="text-slate-200 text-sm font-medium truncate">${woEsc(r.name)}</div></div>
                        </div>`;
                }).join('') + customRow;
            } catch (e) {
                results.innerHTML = `<p class="text-red-400 text-xs text-center py-6">Search failed (offline?). <br>You can still add a custom exercise:</p>
                    <div class="wo-result flex items-center gap-3 p-2 rounded-xl border border-dashed border-slate-700/70 hover:border-emerald-600/60 cursor-pointer transition-colors mt-2"
                        onclick="workoutAddExercise('${dateKey}', ${woEscAttr(term)}, null)">
                        <div class="w-12 h-12 rounded-lg bg-slate-800 flex items-center justify-center shrink-0"><i class="fas fa-plus text-slate-500"></i></div>
                        <div class="min-w-0"><div class="text-slate-200 text-sm font-medium">Add “${woEsc(term)}”</div></div>
                    </div>`;
            }
        }, 350);
    };
    setTimeout(() => input.focus(), 50);
}
// Safely embed a string as a JS string literal inside an inline handler
function woEscAttr(s) {
    return JSON.stringify(String(s == null ? '' : s)).replace(/"/g, '&quot;');
}

async function workoutAddExercise(dateKey, name, imgUrl) {
    const day = woDay(dateKey);
    const id  = woId('ex_');
    const ex  = { id, name: name || 'Exercise', img: null, sets: '', reps: '', weight: '', notes: '' };
    day.exercises.push(ex);
    saveWorkoutData();
    workoutCloseModal();
    renderWorkout();
    // Cache the image in the background, then re-render
    if (imgUrl) {
        const local = await woCacheImage(imgUrl, id);
        if (local) { ex.img = local; saveWorkoutData(); renderWorkout(); }
    }
}

// ── Exercise detail / edit ─────────────────────────────────────────
function workoutOpenExerciseDetail(dateKey, exId) {
    const day = woDay(dateKey);
    const ex  = day.exercises.find(e => e.id === exId);
    if (!ex) return;
    const src = woImgSrc(ex.img);
    workoutOpenModal('Exercise', `
        ${src ? `<img src="${woEsc(src)}" class="w-full max-h-64 object-contain rounded-xl bg-slate-950 mb-4" alt="">`
              : `<div class="w-full h-40 rounded-xl bg-slate-950 flex items-center justify-center mb-4"><i class="fas fa-dumbbell text-slate-700 text-3xl"></i></div>`}
        <label class="block text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-1">Name</label>
        <input id="wo-ex-name" type="text" value="${woEsc(ex.name)}" class="w-full bg-slate-800/80 text-slate-100 text-sm border border-slate-700/60 rounded-xl px-3 py-2 outline-none focus:border-emerald-600/60 mb-3" style="color-scheme:dark">
        <div class="grid grid-cols-3 gap-2 mb-3">
            <div><label class="block text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-1">Sets</label>
                <input id="wo-ex-sets" type="number" min="0" value="${woEsc(ex.sets)}" class="w-full bg-slate-800/80 text-slate-100 text-sm border border-slate-700/60 rounded-xl px-3 py-2 outline-none focus:border-emerald-600/60" style="color-scheme:dark"></div>
            <div><label class="block text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-1">Reps</label>
                <input id="wo-ex-reps" type="number" min="0" value="${woEsc(ex.reps)}" class="w-full bg-slate-800/80 text-slate-100 text-sm border border-slate-700/60 rounded-xl px-3 py-2 outline-none focus:border-emerald-600/60" style="color-scheme:dark"></div>
            <div><label class="block text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-1">Weight</label>
                <input id="wo-ex-weight" type="text" value="${woEsc(ex.weight)}" placeholder="e.g. 60kg" class="w-full bg-slate-800/80 text-slate-100 text-sm border border-slate-700/60 rounded-xl px-3 py-2 outline-none focus:border-emerald-600/60" style="color-scheme:dark"></div>
        </div>
        <label class="block text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-1">Notes</label>
        <textarea id="wo-ex-notes" rows="2" class="w-full bg-slate-800/80 text-slate-100 text-sm border border-slate-700/60 rounded-xl px-3 py-2 outline-none focus:border-emerald-600/60 resize-none mb-4" style="color-scheme:dark">${woEsc(ex.notes)}</textarea>
        <div class="flex items-center justify-between">
            <button onclick="workoutDeleteExercise('${dateKey}','${exId}')" class="text-red-400 hover:text-red-300 text-xs font-medium"><i class="fas fa-trash mr-1"></i>Delete</button>
            <button onclick="workoutSaveExercise('${dateKey}','${exId}')" class="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold">Save</button>
        </div>
    `);
}
function workoutSaveExercise(dateKey, exId) {
    const day = woDay(dateKey);
    const ex  = day.exercises.find(e => e.id === exId);
    if (!ex) return;
    ex.name   = document.getElementById('wo-ex-name').value.trim() || ex.name;
    ex.sets   = document.getElementById('wo-ex-sets').value;
    ex.reps   = document.getElementById('wo-ex-reps').value;
    ex.weight = document.getElementById('wo-ex-weight').value.trim();
    ex.notes  = document.getElementById('wo-ex-notes').value;
    saveWorkoutData();
    workoutCloseModal();
    renderWorkout();
}
function workoutDeleteExercise(dateKey, exId) {
    const day = woDay(dateKey);
    day.exercises = day.exercises.filter(e => e.id !== exId);
    saveWorkoutData();
    workoutCloseModal();
    renderWorkout();
}

// ── Meal add / edit ────────────────────────────────────────────────
function workoutOpenMealForm(dateKey, mealId) {
    const day  = woDay(dateKey);
    const meal = mealId ? day.meals.find(m => m.id === mealId) : null;
    workoutOpenModal(meal ? 'Edit meal' : 'Add meal', `
        <label class="block text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-1">Meal</label>
        <input id="wo-meal-name" type="text" value="${woEsc(meal ? meal.name : '')}" placeholder="e.g. Chicken & rice" autofocus
            class="w-full bg-slate-800/80 text-slate-100 text-sm border border-slate-700/60 rounded-xl px-3 py-2 outline-none focus:border-emerald-600/60 mb-3" style="color-scheme:dark">
        <div class="grid grid-cols-4 gap-2 mb-4">
            <div><label class="block text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-1">Kcal</label>
                <input id="wo-meal-cal" type="number" min="0" value="${woEsc(meal ? meal.calories : '')}" class="w-full bg-slate-800/80 text-slate-100 text-sm border border-slate-700/60 rounded-xl px-3 py-2 outline-none focus:border-emerald-600/60" style="color-scheme:dark"></div>
            <div><label class="block text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-1">Protein</label>
                <input id="wo-meal-p" type="number" min="0" value="${woEsc(meal ? meal.protein : '')}" class="w-full bg-slate-800/80 text-slate-100 text-sm border border-slate-700/60 rounded-xl px-3 py-2 outline-none focus:border-emerald-600/60" style="color-scheme:dark"></div>
            <div><label class="block text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-1">Carbs</label>
                <input id="wo-meal-c" type="number" min="0" value="${woEsc(meal ? meal.carbs : '')}" class="w-full bg-slate-800/80 text-slate-100 text-sm border border-slate-700/60 rounded-xl px-3 py-2 outline-none focus:border-emerald-600/60" style="color-scheme:dark"></div>
            <div><label class="block text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-1">Fat</label>
                <input id="wo-meal-f" type="number" min="0" value="${woEsc(meal ? meal.fat : '')}" class="w-full bg-slate-800/80 text-slate-100 text-sm border border-slate-700/60 rounded-xl px-3 py-2 outline-none focus:border-emerald-600/60" style="color-scheme:dark"></div>
        </div>
        <div class="flex items-center justify-between">
            ${meal ? `<button onclick="workoutDeleteMeal('${dateKey}','${mealId}')" class="text-red-400 hover:text-red-300 text-xs font-medium"><i class="fas fa-trash mr-1"></i>Delete</button>` : '<span></span>'}
            <button onclick="workoutSaveMeal('${dateKey}', ${meal ? `'${mealId}'` : 'null'})" class="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold">Save</button>
        </div>
    `);
    setTimeout(() => document.getElementById('wo-meal-name')?.focus(), 50);
}
function workoutSaveMeal(dateKey, mealId) {
    const day  = woDay(dateKey);
    const name = document.getElementById('wo-meal-name').value.trim();
    if (!name) { workoutCloseModal(); return; }
    const vals = {
        name,
        calories: document.getElementById('wo-meal-cal').value,
        protein:  document.getElementById('wo-meal-p').value,
        carbs:    document.getElementById('wo-meal-c').value,
        fat:      document.getElementById('wo-meal-f').value,
    };
    if (mealId) {
        const meal = day.meals.find(m => m.id === mealId);
        if (meal) Object.assign(meal, vals);
    } else {
        day.meals.push({ id: woId('ml_'), ...vals });
    }
    saveWorkoutData();
    workoutCloseModal();
    renderWorkout();
}
function workoutDeleteMeal(dateKey, mealId) {
    const day = woDay(dateKey);
    day.meals = day.meals.filter(m => m.id !== mealId);
    saveWorkoutData();
    workoutCloseModal();
    renderWorkout();
}

// ════════════════════════════════════════════════════════════════════
// ── Auto workout planner ───────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════

// Curated exercise library. equip: which kit each move needs —
//   'gym' = barbell/machine/cable, 'dumbbell' = dumbbells, 'bodyweight' = none.
// compound moves are prioritised (placed first, picked before isolation).
const WO_EXERCISE_DB = [
    // Chest
    { name: 'Barbell Bench Press',     group: 'chest', equip: ['gym'],        compound: true  },
    { name: 'Incline Dumbbell Press',  group: 'chest', equip: ['dumbbell'],   compound: true  },
    { name: 'Dumbbell Bench Press',    group: 'chest', equip: ['dumbbell'],   compound: true  },
    { name: 'Push-up',                 group: 'chest', equip: ['bodyweight'], compound: true  },
    { name: 'Chest Dip',               group: 'chest', equip: ['bodyweight'], compound: true  },
    { name: 'Cable Fly',               group: 'chest', equip: ['gym'],        compound: false },
    { name: 'Dumbbell Fly',            group: 'chest', equip: ['dumbbell'],   compound: false },
    // Back
    { name: 'Deadlift',                group: 'back', equip: ['gym'],         compound: true  },
    { name: 'Barbell Row',             group: 'back', equip: ['gym'],         compound: true  },
    { name: 'Lat Pulldown',            group: 'back', equip: ['gym'],         compound: true  },
    { name: 'Seated Cable Row',        group: 'back', equip: ['gym'],         compound: true  },
    { name: 'Pull-up',                 group: 'back', equip: ['bodyweight'],  compound: true  },
    { name: 'Inverted Row',            group: 'back', equip: ['bodyweight'],  compound: true  },
    { name: 'Dumbbell Row',            group: 'back', equip: ['dumbbell'],    compound: true  },
    { name: 'Face Pull',               group: 'back', equip: ['gym'],         compound: false },
    // Shoulders
    { name: 'Overhead Press',          group: 'shoulders', equip: ['gym'],        compound: true  },
    { name: 'Dumbbell Shoulder Press', group: 'shoulders', equip: ['dumbbell'],   compound: true  },
    { name: 'Pike Push-up',            group: 'shoulders', equip: ['bodyweight'], compound: true  },
    { name: 'Lateral Raise',           group: 'shoulders', equip: ['dumbbell'],   compound: false },
    { name: 'Cable Lateral Raise',     group: 'shoulders', equip: ['gym'],        compound: false },
    { name: 'Reverse Fly',             group: 'shoulders', equip: ['dumbbell'],   compound: false },
    // Biceps
    { name: 'Barbell Curl',            group: 'biceps', equip: ['gym'],        compound: false },
    { name: 'Dumbbell Curl',           group: 'biceps', equip: ['dumbbell'],   compound: false },
    { name: 'Hammer Curl',             group: 'biceps', equip: ['dumbbell'],   compound: false },
    { name: 'Cable Curl',              group: 'biceps', equip: ['gym'],        compound: false },
    { name: 'Chin-up',                 group: 'biceps', equip: ['bodyweight'], compound: true  },
    // Triceps
    { name: 'Close-Grip Bench Press',  group: 'triceps', equip: ['gym'],        compound: true  },
    { name: 'Triceps Pushdown',        group: 'triceps', equip: ['gym'],        compound: false },
    { name: 'Overhead Dumbbell Extension', group: 'triceps', equip: ['dumbbell'], compound: false },
    { name: 'Dips',                    group: 'triceps', equip: ['bodyweight'], compound: true  },
    { name: 'Diamond Push-up',         group: 'triceps', equip: ['bodyweight'], compound: true  },
    // Quads
    { name: 'Barbell Back Squat',      group: 'quads', equip: ['gym'],        compound: true  },
    { name: 'Front Squat',             group: 'quads', equip: ['gym'],        compound: true  },
    { name: 'Leg Press',               group: 'quads', equip: ['gym'],        compound: true  },
    { name: 'Goblet Squat',            group: 'quads', equip: ['dumbbell'],   compound: true  },
    { name: 'Bulgarian Split Squat',   group: 'quads', equip: ['dumbbell'],   compound: true  },
    { name: 'Walking Lunge',           group: 'quads', equip: ['dumbbell'],   compound: true  },
    { name: 'Bodyweight Squat',        group: 'quads', equip: ['bodyweight'], compound: true  },
    { name: 'Leg Extension',           group: 'quads', equip: ['gym'],        compound: false },
    // Hamstrings
    { name: 'Romanian Deadlift',         group: 'hamstrings', equip: ['gym'],        compound: true  },
    { name: 'Dumbbell Romanian Deadlift',group: 'hamstrings', equip: ['dumbbell'],   compound: true  },
    { name: 'Lying Leg Curl',            group: 'hamstrings', equip: ['gym'],        compound: false },
    { name: 'Nordic Curl',               group: 'hamstrings', equip: ['bodyweight'], compound: false },
    { name: 'Glute-Ham Raise',           group: 'hamstrings', equip: ['bodyweight'], compound: false },
    // Glutes
    { name: 'Hip Thrust',              group: 'glutes', equip: ['gym'],        compound: true  },
    { name: 'Dumbbell Hip Thrust',     group: 'glutes', equip: ['dumbbell'],   compound: true  },
    { name: 'Glute Bridge',            group: 'glutes', equip: ['bodyweight'], compound: false },
    { name: 'Cable Kickback',          group: 'glutes', equip: ['gym'],        compound: false },
    // Calves
    { name: 'Standing Calf Raise',     group: 'calves', equip: ['gym'],        compound: false },
    { name: 'Dumbbell Calf Raise',     group: 'calves', equip: ['dumbbell'],   compound: false },
    { name: 'Calf Raise',              group: 'calves', equip: ['bodyweight'], compound: false },
    // Core
    { name: 'Plank',                   group: 'core', equip: ['bodyweight'], compound: false },
    { name: 'Hanging Leg Raise',       group: 'core', equip: ['bodyweight'], compound: false },
    { name: 'Russian Twist',           group: 'core', equip: ['bodyweight'], compound: false },
    { name: 'Ab Wheel Rollout',        group: 'core', equip: ['bodyweight'], compound: false },
    { name: 'Cable Crunch',            group: 'core', equip: ['gym'],        compound: false },
    // Cardio (used as a finisher for fat-loss plans)
    { name: 'Rowing Machine',          group: 'cardio', equip: ['gym'],        compound: false },
    { name: 'Treadmill Run',           group: 'cardio', equip: ['gym'],        compound: false },
    { name: 'Stationary Bike',         group: 'cardio', equip: ['gym'],        compound: false },
    { name: 'Jump Rope',               group: 'cardio', equip: ['bodyweight'], compound: false },
    { name: 'Burpees',                 group: 'cardio', equip: ['bodyweight'], compound: false },
    { name: 'Incline Walk',            group: 'cardio', equip: ['bodyweight'], compound: false },

    // ── Extra variety (so every body part has options at every equipment level) ──
    // Chest
    { name: 'Machine Chest Press',     group: 'chest', equip: ['gym'],        compound: true  },
    { name: 'Decline Push-up',         group: 'chest', equip: ['bodyweight'], compound: true  },
    { name: 'Incline Barbell Press',   group: 'chest', equip: ['gym'],        compound: true  },
    // Back
    { name: 'T-Bar Row',               group: 'back', equip: ['gym'],         compound: true  },
    { name: 'Chest-Supported Row',     group: 'back', equip: ['dumbbell'],    compound: true  },
    { name: 'Straight-Arm Pulldown',   group: 'back', equip: ['gym'],         compound: false },
    { name: 'Single-Arm Lat Pulldown', group: 'back', equip: ['gym'],         compound: true  },
    { name: 'Wide-Grip Pull-up',       group: 'back', equip: ['bodyweight'],  compound: true  },
    { name: 'Negative Pull-up',        group: 'back', equip: ['bodyweight'],  compound: true  },
    { name: 'Superman',                group: 'back', equip: ['bodyweight'],  compound: false },
    // Shoulders
    { name: 'Arnold Press',            group: 'shoulders', equip: ['dumbbell'],   compound: true  },
    { name: 'Upright Row',             group: 'shoulders', equip: ['gym'],        compound: true  },
    { name: 'Front Raise',             group: 'shoulders', equip: ['dumbbell'],   compound: false },
    { name: 'Cable Reverse Fly',       group: 'shoulders', equip: ['gym'],        compound: false },
    // Biceps
    { name: 'Incline Dumbbell Curl',   group: 'biceps', equip: ['dumbbell'],   compound: false },
    { name: 'Preacher Curl',           group: 'biceps', equip: ['gym'],        compound: false },
    { name: 'Concentration Curl',      group: 'biceps', equip: ['dumbbell'],   compound: false },
    { name: 'Close-Grip Chin-up',      group: 'biceps', equip: ['bodyweight'], compound: true  },
    // Triceps
    { name: 'Skull Crusher',           group: 'triceps', equip: ['gym'],        compound: false },
    { name: 'Bench Dip',               group: 'triceps', equip: ['bodyweight'], compound: true  },
    { name: 'Cable Overhead Extension',group: 'triceps', equip: ['gym'],        compound: false },
    { name: 'Dumbbell Kickback',       group: 'triceps', equip: ['dumbbell'],   compound: false },
    // Quads
    { name: 'Hack Squat',              group: 'quads', equip: ['gym'],        compound: true  },
    { name: 'Dumbbell Step-up',        group: 'quads', equip: ['dumbbell'],   compound: true  },
    { name: 'Sissy Squat',             group: 'quads', equip: ['bodyweight'], compound: false },
    { name: 'Reverse Lunge',           group: 'quads', equip: ['bodyweight'], compound: true  },
    // Hamstrings
    { name: 'Good Morning',            group: 'hamstrings', equip: ['gym'],        compound: true  },
    { name: 'Seated Leg Curl',         group: 'hamstrings', equip: ['gym'],        compound: false },
    { name: 'Single-Leg Romanian Deadlift', group: 'hamstrings', equip: ['dumbbell'], compound: true },
    // Glutes
    { name: 'Cable Pull-Through',      group: 'glutes', equip: ['gym'],        compound: true  },
    { name: 'Frog Pump',               group: 'glutes', equip: ['bodyweight'], compound: false },
    { name: 'Curtsy Lunge',            group: 'glutes', equip: ['dumbbell'],   compound: true  },
    // Calves
    { name: 'Seated Calf Raise',       group: 'calves', equip: ['gym'],        compound: false },
    { name: 'Single-Leg Calf Raise',   group: 'calves', equip: ['bodyweight'], compound: false },
    // Core / abs
    { name: 'Bicycle Crunch',          group: 'core', equip: ['bodyweight'], compound: false },
    { name: 'Mountain Climbers',       group: 'core', equip: ['bodyweight'], compound: false },
    { name: 'Lying Leg Raise',         group: 'core', equip: ['bodyweight'], compound: false },
    { name: 'Side Plank',              group: 'core', equip: ['bodyweight'], compound: false },
    { name: 'Dead Bug',               group: 'core', equip: ['bodyweight'], compound: false },
    { name: 'Sit-up',                  group: 'core', equip: ['bodyweight'], compound: false },
    { name: 'Cable Woodchopper',       group: 'core', equip: ['gym'],        compound: false },
    { name: 'Flutter Kicks',           group: 'core', equip: ['bodyweight'], compound: false },
    { name: 'V-up',                    group: 'core', equip: ['bodyweight'], compound: false },
    // Cardio
    { name: 'Elliptical',              group: 'cardio', equip: ['gym'],        compound: false },
    { name: 'Stair Climber',           group: 'cardio', equip: ['gym'],        compound: false },
    { name: 'Battle Ropes',            group: 'cardio', equip: ['gym'],        compound: false },
    { name: 'Kettlebell Swing',        group: 'cardio', equip: ['dumbbell'],   compound: false },
    { name: 'High Knees',              group: 'cardio', equip: ['bodyweight'], compound: false },
    { name: 'Box Jumps',               group: 'cardio', equip: ['bodyweight'], compound: false },
    { name: 'Mountain Climber Sprint', group: 'cardio', equip: ['bodyweight'], compound: false },
];

// Which muscle groups each day-focus targets (ordered by priority)
const WO_FOCUS_GROUPS = {
    full:  ['quads', 'chest', 'back', 'shoulders', 'hamstrings', 'biceps', 'triceps', 'glutes', 'calves', 'core'],
    upper: ['chest', 'back', 'shoulders', 'triceps', 'biceps', 'core'],
    lower: ['quads', 'hamstrings', 'glutes', 'calves', 'core'],
    push:  ['chest', 'shoulders', 'triceps', 'core'],
    pull:  ['back', 'biceps', 'core'],
    legs:  ['quads', 'hamstrings', 'glutes', 'calves', 'core'],
};
const WO_FOCUS_LABELS = {
    full: 'Full body', upper: 'Upper', lower: 'Lower',
    push: 'Push', pull: 'Pull', legs: 'Legs', rest: 'Rest',
};

// Sets/reps scheme + main-lift count per goal & experience level.
// (Every day additionally gets a guaranteed abs move + a cardio finisher.)
const WO_SCHEME = {
    hypertrophy: { sets: 4, reps: '8-12',  count: { beginner: 5, intermediate: 7, advanced: 9 } },
    strength:    { sets: 5, reps: '5',     count: { beginner: 5, intermediate: 6, advanced: 8 } },
    fatloss:     { sets: 3, reps: '12-15', count: { beginner: 5, intermediate: 7, advanced: 8 } },
    general:     { sets: 3, reps: '10',    count: { beginner: 5, intermediate: 6, advanced: 7 } },
};

// Which weekday indexes (0 = Mon … 6 = Sun) are training days
const WO_TRAINING_DAYS = {
    3: [0, 2, 4],
    4: [0, 1, 3, 4],
    5: [0, 1, 2, 3, 4],
    6: [0, 1, 2, 3, 4, 5],
};

// Build the ordered list of day-focuses for the chosen split
function woSplitSequence(split, days) {
    if (split === 'auto') {
        if (days <= 3)      split = 'fullbody';
        else if (days === 4) split = 'upperlower';
        else if (days === 5) return ['push', 'pull', 'legs', 'upper', 'lower'];
        else                 split = 'ppl';
    }
    if (split === 'fullbody')   return Array.from({ length: days }, () => 'full');
    if (split === 'upperlower') return Array.from({ length: days }, (_, i) => (i % 2 ? 'lower' : 'upper'));
    if (split === 'ppl') {
        const cyc = ['push', 'pull', 'legs'];
        return Array.from({ length: days }, (_, i) => cyc[i % 3]);
    }
    return Array.from({ length: days }, () => 'full');
}

function woFilterByEquip(list, equip) {
    if (equip === 'gym')      return list;
    if (equip === 'dumbbell') return list.filter(e => e.equip.includes('dumbbell') || e.equip.includes('bodyweight'));
    return list.filter(e => e.equip.includes('bodyweight'));
}

// Pick `count` distinct exercises for a focus, one per muscle group per pass,
// preferring compounds first, then cycling back for accessories. Randomised
// so re-running the planner gives fresh variety.
function woPickForFocus(focus, equip, count) {
    // Core/abs and cardio are appended separately (guaranteed on every day),
    // so the main-lift picker skips them here.
    const groups = (WO_FOCUS_GROUPS[focus] || WO_FOCUS_GROUPS.full).filter(g => g !== 'core');
    const used   = new Set();
    const chosen = [];
    for (let pass = 0; pass < 5 && chosen.length < count; pass++) {
        for (const g of groups) {
            if (chosen.length >= count) break;
            let cands = woFilterByEquip(WO_EXERCISE_DB.filter(e => e.group === g), equip)
                .filter(e => !used.has(e.name));
            if (!cands.length) continue;
            if (pass === 0) {
                const comp = cands.filter(e => e.compound);
                if (comp.length) cands = comp;     // lead each group with a compound
            }
            const pick = cands[Math.floor(Math.random() * cands.length)];
            used.add(pick.name);
            chosen.push(pick);
        }
    }
    return chosen;
}

// Pick one random exercise from a group at the given equipment level
function woPickOne(group, equip, exclude) {
    exclude = exclude || new Set();
    let cands = woFilterByEquip(WO_EXERCISE_DB.filter(e => e.group === group), equip)
        .filter(e => !exclude.has(e.name));
    if (!cands.length) cands = woFilterByEquip(WO_EXERCISE_DB.filter(e => e.group === group), equip);
    if (!cands.length) return null;
    return cands[Math.floor(Math.random() * cands.length)];
}

// Generate a full week of training from the planner options
function workoutGeneratePlan(opts) {
    const { goal, days, split, level, equip, clear } = opts;
    const monday      = woMonday(workoutWeekAnchor);
    const trainingIdx = WO_TRAINING_DAYS[days] || WO_TRAINING_DAYS[3];
    const seq         = woSplitSequence(split, days);
    const scheme      = WO_SCHEME[goal] || WO_SCHEME.general;
    const baseCount   = scheme.count[level] || 5;

    let trained = 0;
    for (let i = 0; i < 7; i++) {
        const key = woKey(woAddDays(monday, i));
        const day = woDay(key);
        if (clear) day.exercises = [];      // wipe old plan, keep meals
        delete day.focus;

        const ti = trainingIdx.indexOf(i);
        if (ti === -1) { day.focus = 'rest'; continue; }

        const focus = seq[ti % seq.length];
        day.focus   = focus;
        const count = baseCount + ((focus === 'legs' || focus === 'full') ? 1 : 0);

        const picks = woPickForFocus(focus, equip, count);
        picks.sort((a, b) => (b.compound ? 1 : 0) - (a.compound ? 1 : 0)); // compounds first
        const used = new Set(picks.map(p => p.name));
        picks.forEach(p => day.exercises.push({
            id: woId('ex_'), name: p.name, img: null,
            sets: String(scheme.sets), reps: scheme.reps, weight: '', notes: '', group: p.group,
        }));

        // Guaranteed abs work on every training day (1, or 2 on leg/full days)
        const abCount = (focus === 'legs' || focus === 'full') ? 2 : 1;
        for (let a = 0; a < abCount; a++) {
            const ab = woPickOne('core', equip, used);
            if (!ab) break;
            used.add(ab.name);
            day.exercises.push({
                id: woId('ex_'), name: ab.name, img: null,
                sets: '3', reps: '15', weight: '', notes: '', group: 'core',
            });
        }

        // Cardio finisher on every training day (fat-loss goal gets a longer one)
        const cardio = woPickOne('cardio', equip, used);
        if (cardio) {
            day.exercises.push({
                id: woId('ex_'), name: cardio.name, img: null,
                sets: '', reps: '', weight: '', notes: goal === 'fatloss' ? '20–30 min' : '10–15 min',
                group: 'cardio',
            });
        }
        trained++;
    }

    saveWorkoutData();
    workoutCloseModal();
    renderWorkout();
    woToast(`Planned ${trained} training day${trained !== 1 ? 's' : ''} this week 💪`);
    // Fetch photos for the whole planned week in the background
    const weekKeys = Array.from({ length: 7 }, (_, i) => woKey(woAddDays(monday, i)));
    woEnrichImages(weekKeys);
}

// ── Planner modal ──────────────────────────────────────────────────
function workoutOpenPlanner() {
    const selCls = 'w-full bg-slate-800/80 text-slate-100 text-sm border border-slate-700/60 rounded-xl px-3 py-2 outline-none focus:border-emerald-600/60';
    const labCls = 'block text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-1';
    workoutOpenModal('Plan my week', `
        <p class="text-slate-400 text-xs mb-4 leading-relaxed">Auto-build a balanced week of training. Pick your goal and schedule — Vulsor fills each day with exercises, sets and reps, plus a core/abs move and a cardio finisher.</p>
        <div class="grid grid-cols-2 gap-3 mb-3">
            <div>
                <label class="${labCls}">Goal</label>
                <select id="wo-plan-goal" class="${selCls}" style="color-scheme:dark">
                    <option value="hypertrophy">Build muscle</option>
                    <option value="strength">Get stronger</option>
                    <option value="fatloss">Lose fat</option>
                    <option value="general">General fitness</option>
                </select>
            </div>
            <div>
                <label class="${labCls}">Days / week</label>
                <select id="wo-plan-days" class="${selCls}" style="color-scheme:dark">
                    <option value="3">3 days</option>
                    <option value="4" selected>4 days</option>
                    <option value="5">5 days</option>
                    <option value="6">6 days</option>
                </select>
            </div>
            <div>
                <label class="${labCls}">Split</label>
                <select id="wo-plan-split" class="${selCls}" style="color-scheme:dark">
                    <option value="auto" selected>Auto (recommended)</option>
                    <option value="fullbody">Full body</option>
                    <option value="upperlower">Upper / Lower</option>
                    <option value="ppl">Push / Pull / Legs</option>
                </select>
            </div>
            <div>
                <label class="${labCls}">Experience</label>
                <select id="wo-plan-level" class="${selCls}" style="color-scheme:dark">
                    <option value="beginner">Beginner</option>
                    <option value="intermediate" selected>Intermediate</option>
                    <option value="advanced">Advanced</option>
                </select>
            </div>
            <div class="col-span-2">
                <label class="${labCls}">Equipment</label>
                <select id="wo-plan-equip" class="${selCls}" style="color-scheme:dark">
                    <option value="gym" selected>Full gym</option>
                    <option value="dumbbell">Dumbbells only</option>
                    <option value="bodyweight">Bodyweight only</option>
                </select>
            </div>
        </div>
        <label class="flex items-center gap-2 text-slate-400 text-xs mb-4 cursor-pointer select-none">
            <input type="checkbox" id="wo-plan-clear" checked class="accent-emerald-500 w-3.5 h-3.5"> Replace existing exercises this week
        </label>
        <button onclick="workoutRunPlanner()" class="w-full px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold transition-colors"><i class="fas fa-wand-magic-sparkles mr-2"></i>Generate plan</button>
        <button onclick="workoutCopyLastWeek()" class="w-full mt-2 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700/50 text-slate-300 text-xs font-semibold transition-colors"><i class="fas fa-clone mr-2"></i>Copy last week instead (keeps your weights)</button>
    `);
}
function workoutRunPlanner() {
    const v = id => document.getElementById(id)?.value;
    workoutGeneratePlan({
        goal:  v('wo-plan-goal')  || 'hypertrophy',
        days:  parseInt(v('wo-plan-days'), 10) || 4,
        split: v('wo-plan-split') || 'auto',
        level: v('wo-plan-level') || 'intermediate',
        equip: v('wo-plan-equip') || 'gym',
        clear: document.getElementById('wo-plan-clear')?.checked !== false,
    });
}

// ── Completion tracking ────────────────────────────────────────────
function workoutToggleDone(dateKey, exId) {
    const ex = woDay(dateKey).exercises.find(e => e.id === exId);
    if (!ex) return;
    ex.done = !ex.done;
    saveWorkoutData();
    renderWorkout();   // refreshes week grid + open day view
}

// ── Nutrition targets ──────────────────────────────────────────────
function workoutOpenTargets() {
    const s = workoutData.settings || {};
    const inpCls = 'w-full bg-slate-800/80 text-slate-100 text-sm border border-slate-700/60 rounded-xl px-3 py-2 outline-none focus:border-emerald-600/60';
    const labCls = 'block text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-1';
    workoutOpenModal('Nutrition targets', `
        <p class="text-slate-400 text-xs mb-4 leading-relaxed">Set daily targets — day cards and the day view show your progress against them. Leave empty to hide.</p>
        <div class="grid grid-cols-2 gap-3 mb-4">
            <div><label class="${labCls}">Calories / day</label>
                <input id="wo-target-cal" type="number" min="0" value="${woEsc(s.calTarget || '')}" placeholder="e.g. 2200" class="${inpCls}" style="color-scheme:dark"></div>
            <div><label class="${labCls}">Protein / day (g)</label>
                <input id="wo-target-p" type="number" min="0" value="${woEsc(s.proteinTarget || '')}" placeholder="e.g. 150" class="${inpCls}" style="color-scheme:dark"></div>
        </div>
        <button onclick="workoutSaveTargets()" class="w-full px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold transition-colors">Save targets</button>
    `);
}
function workoutSaveTargets() {
    workoutData.settings = workoutData.settings || {};
    workoutData.settings.calTarget     = document.getElementById('wo-target-cal')?.value || '';
    workoutData.settings.proteinTarget = document.getElementById('wo-target-p')?.value || '';
    saveWorkoutData();
    workoutCloseModal();
    renderWorkout();
    woToast('Targets saved 🎯');
}

// ── Rest timer (in the day view) ───────────────────────────────────
let _woRestInt = null, _woRestEnd = 0;
function woBeep() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const beep = (freq, t0) => {
            const o = ctx.createOscillator(), g = ctx.createGain();
            o.connect(g); g.connect(ctx.destination);
            o.frequency.value = freq; g.gain.value = 0.08;
            o.start(ctx.currentTime + t0); o.stop(ctx.currentTime + t0 + 0.18);
        };
        beep(880, 0); beep(1175, 0.25);
        setTimeout(() => ctx.close(), 800);
    } catch (_) {}
}
function workoutStartRest(sec) {
    clearInterval(_woRestInt);
    _woRestEnd = Date.now() + sec * 1000;
    const el = document.getElementById('workout-day-timer');
    if (!el) return;
    el.classList.remove('hidden');
    const tick = () => {
        const left = Math.max(0, Math.round((_woRestEnd - Date.now()) / 1000));
        el.textContent = `⏱ ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
        if (left <= 0) {
            clearInterval(_woRestInt); _woRestInt = null;
            woBeep();
            el.textContent = 'Rest done — go! 💪';
            setTimeout(() => { if (!_woRestInt) el.classList.add('hidden'); }, 2500);
        }
    };
    tick();
    _woRestInt = setInterval(tick, 250);
}
function workoutStopRest() {
    clearInterval(_woRestInt); _woRestInt = null;
    document.getElementById('workout-day-timer')?.classList.add('hidden');
}

// ── Copy last week's plan into the current week ────────────────────
// Brings exercises + focus over with fresh ids and completion reset,
// keeping weights so you can progress on them. Meals are not copied.
function workoutCopyLastWeek() {
    const monday = woMonday(workoutWeekAnchor);
    let copied = 0;
    for (let i = 0; i < 7; i++) {
        const src = workoutData.days[woKey(woAddDays(monday, i - 7))];
        if (!src || (!src.exercises?.length && !src.focus)) continue;
        const dst = woDay(woKey(woAddDays(monday, i)));
        if (src.focus) dst.focus = src.focus; else delete dst.focus;
        dst.exercises = (src.exercises || []).map(ex => ({ ...ex, id: woId('ex_'), done: false }));
        if (dst.exercises.length) copied++;
    }
    if (!copied) { woToast('Nothing to copy from last week'); return; }
    saveWorkoutData();
    workoutCloseModal();
    renderWorkout();
    woToast(`Copied ${copied} day${copied !== 1 ? 's' : ''} from last week 📋`);
}

// ── Send workout to phone (QR code) ────────────────────────────────
// Builds a plain-text version of a day's workout and shows it as a QR
// code — scan it with the phone camera to get the full plan as text.
function woWorkoutText(dateKey) {
    const day = woDay(dateKey);
    const [y, m, d] = dateKey.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    const focusLabel = WO_FOCUS_LABELS[day.focus] || 'Workout';
    let out = `Workout — ${WO_WEEKDAYS[(date.getDay() + 6) % 7]} ${WO_MONTHS[date.getMonth()]} ${date.getDate()} (${focusLabel})\n`;
    const exs = day.exercises || [];
    if (!exs.length) return out + 'Rest day — no exercises planned.';
    exs.forEach((ex, i) => {
        const meta = [
            ex.sets && ex.reps ? `${ex.sets}x${ex.reps}` : (ex.reps ? `${ex.reps} reps` : ''),
            ex.weight || '',
            ex.notes || '',
        ].filter(Boolean).join(' · ');
        out += `${i + 1}. ${ex.done ? '[done] ' : ''}${ex.name}${meta ? ' — ' + meta : ''}\n`;
    });
    return out.trim();
}

// ── Local share server ──
// Phone cameras only reliably act on URL QR codes (plain-text QRs are often
// ignored, especially on iPhone). So we serve the workout as a small mobile
// web page over the local network and QR-encode that URL. The server starts
// on first use, binds an ephemeral port, and also serves the exercise images.
let _woShareServer = null;
let _woSharePort   = 0;
let _woShareDayKey = null;   // day being shared — page is rendered live from workoutData

function woGetLanIP() {
    try {
        const ifs = require('os').networkInterfaces();
        for (const name of Object.keys(ifs)) {
            for (const i of ifs[name] || []) {
                if (i.family === 'IPv4' && !i.internal) return i.address;
            }
        }
    } catch (_) {}
    return null;
}

// ── Publishing to the HTTPS box ────────────────────────────────────
// A phone can only INSTALL a page for offline use from a secure origin — that's a
// hard browser rule, and it's why the plain Wi-Fi page could never survive being
// out of range. So the real path is: render the page here, PUT it to the Ubuntu
// box, and put that https:// URL in the QR code. Once the phone has loaded it
// once, its service worker keeps the page with no network at all — and because
// the address is public, it works on cellular too, not just on your Wi-Fi.
const WORKOUT_SHARE_FILE = path.join(DOCUMENTS_PATH, 'workout_share.json');

// The box address lives in vulsor-config.json, same as for the updater and relay.
function woReadVulsorHost() {
    const tries = [
        path.join(DOCUMENTS_PATH, 'vulsor-config.json'),
        (typeof __dirname !== 'undefined') ? path.join(__dirname, '..', 'vulsor-config.json') : null,
        (typeof __dirname !== 'undefined') ? path.join(__dirname, 'vulsor-config.json') : null,
        process.resourcesPath ? path.join(process.resourcesPath, 'app', 'vulsor-config.json') : null,
    ].filter(Boolean);
    for (const p of tries) {
        try {
            const c = JSON.parse(fs.readFileSync(p, 'utf8'));
            if (c && c.serverHost && !String(c.serverHost).includes('CHANGE-ME')) return c.serverHost;
        } catch (_) {}
    }
    return null;
}

// Generated once and kept: the token authorises publishing (it has to be copied
// into vulsor-workout.service on the box), and the slug IS the unlisted URL, which
// is what keeps the page from being found by anyone else.
function woShareConfig() {
    let cfg = {};
    try { cfg = readJsonStrict(WORKOUT_SHARE_FILE) || {}; } catch (_) {}
    const before = JSON.stringify(cfg);
    // Off by default: scanning should open a tab instantly, and until the box is
    // actually running, trying to publish first would only stall the QR. Flip this
    // to true once workout-server.js is up — see server/README-workout.md.
    if (cfg.enabled === undefined) cfg.enabled = false;
    if (!cfg.host)  cfg.host  = woReadVulsorHost() || '';
    if (!cfg.port)  cfg.port  = 8478;
    if (!cfg.token) cfg.token = require('crypto').randomBytes(16).toString('hex');
    if (!cfg.slug)  cfg.slug  = require('crypto').randomBytes(16).toString('hex');
    if (JSON.stringify(cfg) !== before) {
        try { writeJsonSafe(WORKOUT_SHARE_FILE, cfg); } catch (_) {}
    }
    return cfg;
}

function woPublish(html, cfg) {
    return new Promise((resolve, reject) => {
        const body = Buffer.from(html, 'utf8');
        const req = require('https').request({
            host: cfg.host, port: cfg.port, path: `/w/${cfg.slug}/`, method: 'PUT',
            headers: {
                'Content-Type':   'text/html; charset=utf-8',
                'Content-Length': body.length,
                'Authorization':  'Bearer ' + cfg.token,
            },
        }, res => {
            let b = '';
            res.on('data', d => b += d);
            res.on('end', () => res.statusCode === 200
                ? resolve()
                : reject(new Error(`HTTP ${res.statusCode} ${String(b).slice(0, 100)}`)));
        });
        // Short: a box that's down must not hold up the QR dialog.
        req.setTimeout(4000, () => req.destroy(new Error('timed out')));
        req.on('error', reject);
        req.end(body);
    });
}

// A day key from the phone is untrusted input — only 'YYYY-MM-DD' gets through.
function woValidDayKey(v) {
    const s = String(v || '');
    return /^\d{4}-\d{2}-\d{2}$/.test(s) && workoutData.days[s] ? s : null;
}

function woEnsureShareServer() {
    if (_woShareServer && _woSharePort) return Promise.resolve(_woSharePort);
    return new Promise((resolve, reject) => {
        const http = require('http');
        // Serves the day as an ordinary web page — scan, it opens in the browser,
        // nothing to download. The cache headers are what let a refresh work with no
        // Wi-Fi: the URL is stable for a given day + plan (see the ?v= hash in
        // workoutSendToPhone), so a reload re-reads the phone's own copy instead of
        // asking the Mac. No ETag/Last-Modified on purpose — validators only invite
        // the browser to check back with a server that isn't there, and `immutable`
        // asks it not to revalidate at all. This is the only offline mechanism open to
        // us: a service worker, the usual answer, can't register over a plain http://
        // LAN IP because that's not a secure origin.
        const srv = http.createServer((req, res) => {
            let dk = null;
            try { dk = woValidDayKey(new URL(req.url, 'http://localhost').searchParams.get('d')); } catch (_) {}
            dk = dk || _woShareDayKey;
            if (!dk) {
                res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end('<p style="font-family:sans-serif">Nothing shared yet.</p>');
                return;
            }
            res.writeHead(200, {
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'public, max-age=31536000, immutable',
            });
            res.end(woShareDayHtml(dk));
        });
        // Fixed port first (so an old QR still resolves), ephemeral if it's taken.
        const ok = () => {
            _woShareServer = srv;
            _woSharePort   = srv.address().port;
            resolve(_woSharePort);
        };
        let triedFallback = false;
        srv.on('error', e => {
            if (e.code === 'EADDRINUSE' && !triedFallback) {
                triedFallback = true;
                try { srv.listen(0, '0.0.0.0', ok); return; } catch (_) {}
            }
            _woShareServer = null;
            reject(e);
        });
        srv.listen(8477, '0.0.0.0', ok);
    });
}

// The day's page — the list and nothing else. No script, no controls, no requests
// after the initial load: the exercise images are inlined as data-URIs, so once the
// page is in the phone's cache a refresh needs nothing from the network. Exercises
// already ticked off in Vulsor show as done, read-only.
function woShareDayHtml(dateKey, opts) {
    // opts.offline: this copy is going to the HTTPS box, so it may install itself.
    // The Wi-Fi fallback page stays script-free — the browser would refuse to
    // register a worker there anyway, since a LAN address isn't a secure origin.
    const offline = !!(opts && opts.offline);
    const day = woDay(dateKey);
    const [y, m, d] = dateKey.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    const focusLabel = WO_FOCUS_LABELS[day.focus] || 'Workout';
    const exs = day.exercises || [];
    const rows = exs.map(ex => {
        const meta = [
            ex.sets && ex.reps ? `${ex.sets} × ${ex.reps}` : (ex.reps ? `${ex.reps} reps` : ''),
            ex.weight || '', ex.notes || '',
        ].filter(Boolean).join(' · ');
        let img = `<div class="ph">🏋️</div>`;
        try {
            if (ex.img && fs.existsSync(ex.img)) {
                const ext  = (ex.img.split('.').pop() || 'png').toLowerCase();
                const mime = { png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', gif:'image/gif', webp:'image/webp' }[ext] || 'image/png';
                img = `<img src="data:${mime};base64,${fs.readFileSync(ex.img).toString('base64')}" alt="">`;
            }
        } catch (_) {}
        return `<li${ex.done ? ' class="done"' : ''}>
            ${img}<div><b>${woEsc(ex.name)}</b>${meta ? `<span>${woEsc(meta)}</span>` : ''}</div>${ex.done ? '<i>✓</i>' : ''}</li>`;
    }).join('') || '<p class="empty">Rest day — no exercises planned.</p>';

    return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${offline ? '<link rel="manifest" href="app.webmanifest">\n' : ''}<title>Workout — ${WO_MONTHS[date.getMonth()]} ${date.getDate()}</title>
<style>
/* Kills pull-to-refresh. An accidental overscroll is the likeliest way to trigger a
   reload you didn't ask for, and a reload is the one moment this page needs luck. */
html,body{overscroll-behavior-y:contain}
body{margin:0;background:rgb(var(--slate-900));color:rgb(var(--slate-200));font-family:-apple-system,system-ui,sans-serif;padding:20px 16px 60px}
h1{font-size:20px;margin:0 0 2px}
.sub{color:rgb(var(--tw-emerald-400));font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:18px}
ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}
li{display:flex;align-items:center;gap:12px;background:rgb(var(--slate-800));border-radius:14px;padding:10px 12px}
li img,li .ph{width:56px;height:56px;border-radius:10px;object-fit:cover;background:rgb(var(--slate-900));display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0}
li div{flex:1;min-width:0}
li b{display:block;font-size:15px}
li span{display:block;color:rgb(var(--slate-400));font-size:12px;margin-top:2px}
li i{color:rgb(var(--tw-emerald-500));font-style:normal;font-size:15px;flex-shrink:0}
li.done{opacity:.55}
li.done b{text-decoration:line-through}
.empty{color:rgb(var(--slate-500));text-align:center;padding:40px 0}
.note{color:rgb(var(--slate-600));font-size:11px;text-align:center;margin-top:26px;line-height:1.5}
</style></head><body>
<h1>${WO_WEEKDAYS[(date.getDay() + 6) % 7]}, ${WO_MONTHS[date.getMonth()]} ${date.getDate()}</h1>
<div class="sub">${focusLabel}${exs.length ? ` · ${exs.length} exercises` : ''}</div>
<ul>${rows}</ul>
<p class="note">${offline ? 'Sent from Vulsor · saved on this phone, works with no signal.' : 'Sent from Vulsor · keep this tab open and it stays put, off Wi-Fi too.'}</p>
${offline ? `<script>
// Installs the page for offline use. After this runs once, the phone serves the
// workout from its own storage — no Wi-Fi, no cellular, Vulsor closed, doesn't
// matter. Failure is harmless: you just get the page you're already looking at.
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js', { scope: './' }).catch(function () {});
</script>` : ''}
</body></html>`;
}

// Generate a QR data-URL: main process first (reliable Node resolution),
// then the renderer's own require as a fallback.
async function woMakeQR(payload) {
    try {
        const url = await ipcRenderer.invoke('qr-data-url', payload);
        if (url) return url;
    } catch (e) { console.error('[qr] ipc failed:', e); }
    try {
        return await require('qrcode').toDataURL(payload, {
            width: 560, margin: 1, errorCorrectionLevel: 'M',
            color: { dark: '#000000', light: '#ffffff' },
        });
    } catch (e) { console.error('[qr] renderer failed:', e); }
    return null;
}

async function workoutSendToPhone(dateKey) {
    const text = woWorkoutText(dateKey);

    workoutOpenModal('Send to phone', `
        <p id="wo-qr-hint" class="text-slate-400 text-xs mb-4 leading-relaxed"><i class="fas fa-circle-notch fa-spin mr-1"></i>Preparing…</p>
        <div id="wo-qr-wrap" class="flex items-center justify-center mb-3" style="min-height:280px"></div>
        <p id="wo-qr-url" class="text-slate-500 text-[11px] text-center font-mono mb-4"></p>
        <button id="wo-qr-copy" class="w-full px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700/50 text-slate-200 text-sm font-semibold transition-colors"><i class="fas fa-copy mr-2"></i>Copy workout as text</button>
    `);
    const wrap   = document.getElementById('wo-qr-wrap');
    const hint   = document.getElementById('wo-qr-hint');
    const urlEl  = document.getElementById('wo-qr-url');
    document.getElementById('wo-qr-copy')?.addEventListener('click', () => {
        navigator.clipboard.writeText(text).then(() => woToast('Workout copied 📋')).catch(() => {});
    });

    // Default path: serve the page off this Mac and put that URL in the QR — scan it,
    // a browser tab opens, the list is there. Nothing is downloaded or saved.
    // Publishing to the HTTPS box is the opt-in extra (it's the only way the page can
    // also install itself for offline use); when it's off, or the box can't be
    // reached, we just use the local page.
    let payload = text;
    let mode    = 'text';          // text | lan | box
    let problem = '';
    const cfg   = woShareConfig();

    if (cfg.enabled && cfg.host) {
        try {
            await woPublish(woShareDayHtml(dateKey, { offline: true }), cfg);
            payload = `https://${cfg.host}:${cfg.port}/w/${cfg.slug}/`;
            mode    = 'box';
        } catch (e) { problem = e.message || String(e); }
    }

    if (mode !== 'box') {
        const ip = woGetLanIP();
        if (ip) {
            try {
                const port = await woEnsureShareServer();
                _woShareDayKey = dateKey;
                // ?d= names the day; ?v= is a hash of that day's plan. Same plan, same URL —
                // so a refresh (and a re-scan) hits the copy already in the phone's cache
                // instead of the Mac. Edit the workout and the hash changes, which is what
                // makes the phone fetch the new version rather than show a stale one.
                let stamp = '';
                try {
                    stamp = '&v=' + require('crypto').createHash('sha1')
                        .update(JSON.stringify(workoutData.days[dateKey] || {})).digest('hex').slice(0, 8);
                } catch (_) {}
                payload = `http://${ip}:${port}/?d=${dateKey}${stamp}`;
                mode    = 'lan';
            } catch (_) {}
        }
    }

    const served = mode !== 'text';
    if (hint) {
        if (mode === 'box') {
            hint.innerHTML = 'Scan it — a tab opens in your browser with the full list, and the page <b>installs itself on the phone</b>. After that it works with no Wi-Fi and no signal at all, through refreshes and reboots, with Vulsor closed. The same code keeps working every day.';
        } else if (mode === 'lan') {
            hint.innerHTML = 'Scan it — a tab opens in your browser with everything for the day: sets, reps, weights, notes and the exercise pictures. Nothing to download or save. Be on the same Wi-Fi as this Mac when you scan; the page then stays put for as long as you leave the tab open.'
                + (cfg.enabled && problem
                    ? `<br><br><span class="text-amber-400/80">Offline publishing is on but the box didn't answer (${woEsc(problem)}) — using the Wi-Fi page instead.</span>`
                    : `<br><br><span class="text-slate-600">Want it to keep working with no Wi-Fi at all? Set up <code>server/workout-server.js</code> (see <code>server/README-workout.md</code>), then set <code>"enabled": true</code> in <code>workout_share.json</code>. Publish token: <code class="text-slate-500 break-all">${woEsc(cfg.token)}</code></span>`);
        } else {
            hint.innerHTML = 'No network found — this code contains the workout as plain text (some phones only preview it). You can always use the copy button below.';
        }
    }
    if (urlEl && served) urlEl.textContent = payload;

    const dataUrl = await woMakeQR(payload);
    if (wrap) {
        wrap.innerHTML = dataUrl
            ? `<img src="${dataUrl}" class="rounded-2xl bg-white p-2" style="width:280px;height:280px" alt="QR code">`
            : '<p class="text-red-400 text-xs py-6">Could not generate the QR code — use the copy button, or type the address above into your phone\'s browser.</p>';
    }
}

// ── Tiny toast ─────────────────────────────────────────────────────
function woToast(msg) {
    let el = document.getElementById('wo-toast');
    if (!el) {
        el = document.createElement('div');
        el.id = 'wo-toast';
        el.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);' +
            'background:rgb(var(--tw-emerald-900));color:rgb(var(--tw-emerald-100));padding:10px 18px;border-radius:12px;font-size:13px;' +
            'font-weight:600;z-index:99999;box-shadow:0 8px 30px rgba(0,0,0,.5);' +
            'border:1px solid rgba(16,185,129,.4);transition:opacity .3s;pointer-events:none';
        document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.opacity = '1';
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.style.opacity = '0'; }, 2600);
}

// ── Init ───────────────────────────────────────────────────────────
function initWorkout() {
    workoutData = loadWorkoutData();
    workoutWeekAnchor = woMonday(new Date());

    document.getElementById('workout-prev-week')?.addEventListener('click', () => {
        workoutWeekAnchor = woAddDays(woMonday(workoutWeekAnchor), -7);
        renderWorkout();
    });
    document.getElementById('workout-next-week')?.addEventListener('click', () => {
        workoutWeekAnchor = woAddDays(woMonday(workoutWeekAnchor), 7);
        renderWorkout();
    });
    document.getElementById('workout-today-btn')?.addEventListener('click', () => {
        workoutWeekAnchor = woMonday(new Date());
        renderWorkout();
    });
    document.getElementById('workout-plan-btn')?.addEventListener('click', workoutOpenPlanner);
    document.getElementById('workout-targets-btn')?.addEventListener('click', workoutOpenTargets);
    document.getElementById('workout-phone-btn')?.addEventListener('click', () => workoutSendToPhone(woKey(new Date())));
    document.getElementById('workout-modal-close')?.addEventListener('click', workoutCloseModal);
    document.getElementById('workout-modal')?.addEventListener('click', (e) => {
        if (e.target.id === 'workout-modal') workoutCloseModal();
    });
    document.getElementById('workout-day-close')?.addEventListener('click', workoutCloseDay);
    document.getElementById('workout-day-modal')?.addEventListener('click', (e) => {
        if (e.target.id === 'workout-day-modal') workoutCloseDay();
    });
}
