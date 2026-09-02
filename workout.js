// ── Workouts — Weekly planner, exercises (wger images) & nutrition ──
// Depends on: globals.js (fs, path, WORKOUT_FILE, WORKOUT_DIR, workoutData,
//             workoutWeekAnchor)

// ── Persistence ────────────────────────────────────────────────────
function loadWorkoutData() {
    try {
        if (fs.existsSync(WORKOUT_FILE)) {
            const d = JSON.parse(fs.readFileSync(WORKOUT_FILE, 'utf8'));
            return { days: d.days || {} };
        }
    } catch (_) {}
    return { days: {} };
}
function saveWorkoutData() {
    try { fs.writeFileSync(WORKOUT_FILE, JSON.stringify(workoutData, null, 2)); }
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

// ── Media (wger) ───────────────────────────────────────────────────
// Search the free wger exercise database for an exercise by name.
async function woSearchExercises(term) {
    const url = `https://wger.de/api/v2/exercise/search/?term=${encodeURIComponent(term)}&language=english&format=json`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('search failed: ' + res.status);
    const json = await res.json();
    const seen = new Set();
    const out = [];
    (json.suggestions || []).forEach(s => {
        const data = s.data || {};
        const name = data.name || s.value;
        if (!name || seen.has(name.toLowerCase())) return;
        seen.add(name.toLowerCase());
        const img = data.image ? ('https://wger.de' + data.image) : null;
        out.push({ name, img, category: data.category || '' });
    });
    return out;
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
    let html = '';
    for (let i = 0; i < 7; i++) {
        const date = woAddDays(monday, i);
        const key  = woKey(date);
        const day  = woDay(key);
        const isToday = key === todayKey;
        const totals  = woDayTotals(day);

        const exHtml = (day.exercises || []).map(ex => {
            const src = woImgSrc(ex.img);
            const thumb = src
                ? `<img src="${woEsc(src)}" class="w-10 h-10 rounded-md object-cover bg-slate-800 shrink-0" alt="">`
                : `<div class="w-10 h-10 rounded-md bg-slate-800 flex items-center justify-center shrink-0"><i class="fas fa-dumbbell text-slate-600 text-xs"></i></div>`;
            const meta = [
                ex.sets && ex.reps ? `${ex.sets}×${ex.reps}` : (ex.reps ? `${ex.reps} reps` : ''),
                ex.weight ? `${ex.weight}` : ''
            ].filter(Boolean).join(' · ');
            return `<div class="wo-ex flex items-center gap-2 p-1.5 rounded-lg hover:bg-slate-800/70 cursor-pointer transition-colors"
                        onclick="workoutOpenExerciseDetail('${key}','${ex.id}')">
                    ${thumb}
                    <div class="min-w-0 flex-1">
                        <div class="text-slate-200 text-xs font-medium truncate">${woEsc(ex.name)}</div>
                        ${meta ? `<div class="text-slate-500 text-[10px] truncate">${woEsc(meta)}</div>` : ''}
                    </div>
                </div>`;
        }).join('') || `<p class="text-slate-600 text-[11px] italic px-1.5 py-1">No exercises</p>`;

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
        <div class="wo-day-card flex flex-col bg-slate-900/40 border ${isToday ? 'border-emerald-500/50' : 'border-slate-800/70'} rounded-xl overflow-hidden min-h-0">
            <div class="px-3 py-2 border-b ${isToday ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-slate-800/70 bg-slate-900/60'} shrink-0 flex items-center justify-between">
                <span class="text-xs font-semibold ${isToday ? 'text-emerald-300' : 'text-slate-300'}">${WO_WEEKDAYS[i]}</span>
                <span class="text-[10px] ${isToday ? 'text-emerald-400/80' : 'text-slate-500'} tabular-nums">${WO_MONTHS[date.getMonth()]} ${date.getDate()}</span>
            </div>
            <div class="flex-1 overflow-y-auto chat-scroll p-2 flex flex-col gap-3">
                <div>
                    <div class="flex items-center justify-between mb-1 px-1">
                        <span class="text-[10px] uppercase tracking-wide text-slate-500 font-semibold"><i class="fas fa-dumbbell mr-1"></i>Workout</span>
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
                        <span class="text-emerald-400 font-semibold tabular-nums">${totals.cal} kcal</span>
                        <span class="tabular-nums">P${totals.p} C${totals.c} F${totals.f}</span>
                    </div>` : ''}
                </div>
            </div>
        </div>`;
    }
    grid.innerHTML = html;
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

// ── Add exercise (wger search) ─────────────────────────────────────
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
    document.getElementById('workout-modal-close')?.addEventListener('click', workoutCloseModal);
    document.getElementById('workout-modal')?.addEventListener('click', (e) => {
        if (e.target.id === 'workout-modal') workoutCloseModal();
    });
}
