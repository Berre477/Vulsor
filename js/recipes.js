// ── Recipes — make & store recipes and meals ──────────────────────
// Depends on: globals.js (fs, path, RECIPES_FILE)
// Exposes: renderRecipes()

function loadRecipesData() {
    try {
        if (fs.existsSync(RECIPES_FILE))
            return readJsonStrict(RECIPES_FILE);
    } catch (_) {}
    return { recipes: [] };
}
function saveRecipesData() {
    try { writeJsonSafe(RECIPES_FILE, recipesData); } catch (_) {}
}

// ── State ──────────────────────────────────────────────────────────
let recipesData      = { recipes: [] };
let recipeActiveId   = null;
let recipeMealFilter = 'All';
let recipeSearch     = '';
let recipeSaveTimer  = null;
let recipesBuilt     = false;

const RECIPE_MEALS = ['Breakfast', 'Lunch', 'Dinner', 'Dessert', 'Snack', 'Drink', 'Other'];
const RECIPE_ACCENT = '#f97316';

// ── Helpers ────────────────────────────────────────────────────────
function recipeNewId() { return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

function recipeBlank() {
    return {
        id: recipeNewId(), name: 'Untitled recipe', meal: 'Dinner',
        servings: '', time: '', ingredients: '', steps: '', notes: '', photos: [],
        created: Date.now(), updated: Date.now(),
    };
}

function recipeById(id) { return recipesData.recipes.find(r => r.id === id) || null; }

function recipeFilteredList() {
    const q = recipeSearch.trim().toLowerCase();
    return recipesData.recipes
        .filter(r => recipeMealFilter === 'All' || r.meal === recipeMealFilter)
        .filter(r => !q || (r.name + ' ' + r.ingredients + ' ' + r.notes).toLowerCase().includes(q))
        .sort((a, b) => (b.updated || 0) - (a.updated || 0));
}

function recipeMealColor(meal) {
    const map = {
        Breakfast: '#f59e0b', Lunch: '#22c55e', Dinner: '#f97316',
        Dessert: '#ec4899', Snack: '#a855f7', Drink: '#0ea5e9', Other: '#64748b',
    };
    return map[meal] || RECIPE_ACCENT;
}

// ── Mutations ──────────────────────────────────────────────────────
function recipeCreate() {
    const r = recipeBlank();
    recipesData.recipes.unshift(r);
    recipeActiveId = r.id;
    saveRecipesData();
    renderRecipesList();
    renderRecipeDetail();
    // focus the name field for the fresh recipe
    setTimeout(() => { const n = document.getElementById('recipe-name'); if (n) { n.focus(); n.select(); } }, 30);
}

function recipeSelect(id) {
    recipeActiveId = id;
    renderRecipesList();
    renderRecipeDetail();
}

function recipeDelete(id) {
    const r = recipeById(id);
    if (!r) return;
    if (!confirm(`Delete "${r.name || 'this recipe'}"?`)) return;
    recipesData.recipes = recipesData.recipes.filter(x => x.id !== id);
    if (recipeActiveId === id) {
        const list = recipeFilteredList();
        recipeActiveId = list.length ? list[0].id : null;
    }
    saveRecipesData();
    renderRecipesList();
    renderRecipeDetail();
}

// ── Photos ─────────────────────────────────────────────────────────
// Downscale a picked image to a sane size, write it as a JPEG into
// RECIPES_DIR, and return a file:// path (keeps recipes.json small).
function recipeSavePhoto(file, cb) {
    const reader = new FileReader();
    reader.onload = function () {
        const img = new Image();
        img.onload = function () {
            try {
                const MAX = 1600;
                let w = img.width, h = img.height;
                if (Math.max(w, h) > MAX) { const s = MAX / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
                const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
                cv.getContext('2d').drawImage(img, 0, 0, w, h);
                const b64 = cv.toDataURL('image/jpeg', 0.85).split(',')[1];
                const fp = path.join(RECIPES_DIR, recipeNewId() + '.jpg');
                fs.writeFileSync(fp, Buffer.from(b64, 'base64'));
                cb('file://' + fp.replace(/\\/g, '/'));
            } catch (e) { console.warn('[recipes] photo save failed', e); cb(null); }
        };
        img.onerror = function () { cb(null); };
        img.src = reader.result;
    };
    reader.onerror = function () { cb(null); };
    reader.readAsDataURL(file);
}

function recipeAddPhotos(fileList) {
    const r = recipeById(recipeActiveId);
    if (!r || !fileList || !fileList.length) return;
    let pending = 0;
    Array.prototype.forEach.call(fileList, function (f) {
        if (!/^image\//.test(f.type)) return;
        pending++;
        recipeSavePhoto(f, function (p) {
            if (p) { r.photos.push(p); r.updated = Date.now(); }
            if (--pending === 0) { saveRecipesData(); renderRecipesList(); renderRecipeDetail(); }
        });
    });
}

function recipeRemovePhoto(idx) {
    const r = recipeById(recipeActiveId);
    if (!r || !r.photos[idx]) return;
    const p = r.photos[idx];
    r.photos.splice(idx, 1);
    r.updated = Date.now();
    // delete the underlying file if it's one we created in RECIPES_DIR
    try {
        const fp = p.replace(/^file:\/\//, '');
        if (fp.indexOf(RECIPES_DIR) === 0 && fs.existsSync(fp)) fs.unlinkSync(fp);
    } catch (_) {}
    saveRecipesData(); renderRecipesList(); renderRecipeDetail();
}

function recipeScheduleSave() {
    clearTimeout(recipeSaveTimer);
    const status = document.getElementById('recipe-save-status');
    if (status) status.textContent = 'saving…';
    recipeSaveTimer = setTimeout(() => {
        saveRecipesData();
        if (status) status.textContent = 'saved';
    }, 400);
}

// Pull the current editor field values into the active recipe object.
function recipeCommitField(field, value) {
    const r = recipeById(recipeActiveId);
    if (!r) return;
    r[field] = value;
    r.updated = Date.now();
    if (field === 'name' || field === 'meal') renderRecipesList();
    recipeScheduleSave();
}

// ── Rendering: sidebar list ────────────────────────────────────────
function renderRecipesList() {
    const wrap = document.getElementById('recipes-list');
    if (!wrap) return;
    const list = recipeFilteredList();

    if (!recipesData.recipes.length) {
        wrap.innerHTML = `<div class="text-center text-slate-600 text-xs px-4 py-10 leading-relaxed">
            No recipes yet.<br>Hit <span style="color:${RECIPE_ACCENT}">New recipe</span> to add your first dish.</div>`;
        return;
    }
    if (!list.length) {
        wrap.innerHTML = `<div class="text-center text-slate-600 text-xs px-4 py-10">No recipes match.</div>`;
        return;
    }

    wrap.innerHTML = list.map(r => {
        const active = r.id === recipeActiveId;
        const dot = recipeMealColor(r.meal);
        const meta = [r.meal, r.time ? `${r.time} min` : '', r.servings ? `${r.servings} serv` : '']
            .filter(Boolean).join(' · ');
        return `<button data-rid="${r.id}" class="recipe-item w-full text-left px-3 py-2.5 rounded-lg mb-1 transition-colors ${active ? '' : 'hover:bg-slate-800/50'}"
            style="${active ? `background:rgba(249,115,22,0.12);border:1px solid rgba(249,115,22,0.3)` : 'border:1px solid transparent'}">
            <div class="flex items-center gap-2">
                ${r.photos && r.photos.length
                    ? `<img src="${escapeRecipe(r.photos[0])}" class="w-7 h-7 rounded-md object-cover shrink-0 border border-slate-700/50" alt="">`
                    : `<span class="w-2 h-2 rounded-full shrink-0" style="background:${dot}"></span>`}
                <span class="text-slate-200 text-sm font-medium truncate flex-1">${escapeRecipe(r.name || 'Untitled')}</span>
            </div>
            <div class="text-slate-500 text-[10px] mt-0.5 truncate ${r.photos && r.photos.length ? 'pl-9' : 'pl-4'}">${escapeRecipe(meta)}</div>
        </button>`;
    }).join('');

    wrap.querySelectorAll('.recipe-item').forEach(btn => {
        btn.addEventListener('click', () => recipeSelect(btn.getAttribute('data-rid')));
    });
}

// ── Rendering: meal-type filter chips ──────────────────────────────
function renderRecipeFilter() {
    const wrap = document.getElementById('recipes-meal-filter');
    if (!wrap) return;
    const chips = ['All'].concat(RECIPE_MEALS);
    wrap.innerHTML = chips.map(m => {
        const on = m === recipeMealFilter;
        return `<button data-meal="${m}" class="recipe-chip text-[10px] px-2 py-1 rounded-full transition-colors"
            style="${on ? `background:rgba(249,115,22,0.18);color:${RECIPE_ACCENT};border:1px solid rgba(249,115,22,0.35)`
                        : 'background:rgb(var(--slate-800) / 0.6);color:rgb(var(--slate-400));border:1px solid rgb(var(--slate-700) / 0.6)'}">${m}</button>`;
    }).join('');
    wrap.querySelectorAll('.recipe-chip').forEach(btn => {
        btn.addEventListener('click', () => {
            recipeMealFilter = btn.getAttribute('data-meal');
            renderRecipeFilter();
            renderRecipesList();
        });
    });
}

// ── Rendering: detail editor ───────────────────────────────────────
function renderRecipeDetail() {
    const wrap = document.getElementById('recipes-detail');
    if (!wrap) return;
    const r = recipeById(recipeActiveId);

    if (!r) {
        wrap.innerHTML = `<div class="flex-1 flex flex-col items-center justify-center text-center text-slate-600 px-8">
            <i class="fas fa-utensils text-4xl mb-4" style="color:rgba(249,115,22,0.4)"></i>
            <p class="text-slate-400 text-sm font-medium">No recipe selected</p>
            <p class="text-slate-600 text-xs mt-1">Pick one on the left, or create a new recipe.</p>
        </div>`;
        return;
    }

    const opts = RECIPE_MEALS.map(m => `<option value="${m}" ${m === r.meal ? 'selected' : ''}>${m}</option>`).join('');
    const inputCls = 'bg-slate-800/70 text-slate-200 text-sm border border-slate-700/60 rounded-lg px-3 py-2 outline-none focus:border-orange-500/60 transition-colors';
    const taCls = 'w-full bg-slate-800/40 text-slate-200 text-sm leading-relaxed border border-slate-700/50 rounded-xl px-4 py-3 outline-none resize-none chat-scroll placeholder-slate-600 focus:border-orange-500/50 transition-colors';
    const photoThumbs = r.photos.map((p, i) => `
            <div class="relative group" style="width:96px;height:96px">
                <img src="${escapeRecipe(p)}" class="w-full h-full object-cover rounded-lg border border-slate-700/60" alt="">
                <button data-rmphoto="${i}" title="Remove photo"
                    class="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-slate-900/90 border border-slate-600 text-slate-300 hover:text-red-400 hover:border-red-500 flex items-center justify-center text-[10px] opacity-0 group-hover:opacity-100 transition-opacity"><i class="fas fa-times"></i></button>
            </div>`).join('');

    wrap.innerHTML = `
    <div class="max-w-3xl w-full mx-auto px-8 py-7">
        <div class="flex items-start justify-between gap-4 mb-5">
            <input id="recipe-name" type="text" value="${escapeRecipe(r.name)}" placeholder="Recipe name"
                class="flex-1 bg-transparent text-slate-100 text-2xl font-bold outline-none placeholder-slate-700 border-b border-transparent focus:border-slate-700 pb-1" style="min-width:0">
            <button id="recipe-delete" title="Delete recipe"
                class="shrink-0 w-9 h-9 rounded-lg bg-slate-800 hover:bg-red-600/20 border border-slate-700/60 hover:border-red-600/40 text-slate-400 hover:text-red-400 flex items-center justify-center transition-colors">
                <i class="fas fa-trash-alt text-xs"></i>
            </button>
        </div>

        <div class="flex flex-wrap gap-3 mb-7">
            <label class="flex flex-col gap-1">
                <span class="text-slate-500 text-[10px] font-semibold uppercase tracking-widest">Meal</span>
                <select id="recipe-meal" class="${inputCls}" style="color-scheme:dark">${opts}</select>
            </label>
            <label class="flex flex-col gap-1">
                <span class="text-slate-500 text-[10px] font-semibold uppercase tracking-widest">Servings</span>
                <input id="recipe-servings" type="number" min="0" value="${escapeRecipe(r.servings)}" placeholder="—" class="${inputCls}" style="width:90px">
            </label>
            <label class="flex flex-col gap-1">
                <span class="text-slate-500 text-[10px] font-semibold uppercase tracking-widest">Time (min)</span>
                <input id="recipe-time" type="number" min="0" value="${escapeRecipe(r.time)}" placeholder="—" class="${inputCls}" style="width:90px">
            </label>
        </div>

        <div class="mb-6">
            <div class="flex items-center gap-2 mb-2">
                <i class="fas fa-image text-xs" style="color:${RECIPE_ACCENT}"></i>
                <h3 class="text-slate-300 text-xs font-semibold uppercase tracking-widest">Photos</h3>
            </div>
            <div class="flex flex-wrap gap-2">
                ${photoThumbs}
                <button id="recipe-add-photo" type="button"
                    class="flex flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-slate-700/70 text-slate-500 hover:text-orange-400 hover:border-orange-500/50 transition-colors" style="width:96px;height:96px">
                    <i class="fas fa-camera text-base"></i><span class="text-[10px]">Add photo</span>
                </button>
            </div>
            <input id="recipe-photo-input" type="file" accept="image/*" multiple style="display:none">
        </div>

        <div class="mb-6">
            <div class="flex items-center gap-2 mb-2">
                <i class="fas fa-carrot text-xs" style="color:${RECIPE_ACCENT}"></i>
                <h3 class="text-slate-300 text-xs font-semibold uppercase tracking-widest">Ingredients</h3>
                <span class="text-slate-600 text-[10px]">one per line</span>
            </div>
            <textarea id="recipe-ingredients" rows="6" class="${taCls}" placeholder="2 eggs&#10;200g flour&#10;1 cup milk">${escapeRecipe(r.ingredients)}</textarea>
        </div>

        <div class="mb-6">
            <div class="flex items-center gap-2 mb-2">
                <i class="fas fa-list-ol text-xs" style="color:${RECIPE_ACCENT}"></i>
                <h3 class="text-slate-300 text-xs font-semibold uppercase tracking-widest">Steps</h3>
                <span class="text-slate-600 text-[10px]">one step per line</span>
            </div>
            <textarea id="recipe-steps" rows="8" class="${taCls}" placeholder="Preheat oven to 180°C&#10;Mix dry ingredients&#10;Bake for 25 minutes">${escapeRecipe(r.steps)}</textarea>
        </div>

        <div class="mb-4">
            <div class="flex items-center gap-2 mb-2">
                <i class="fas fa-sticky-note text-xs" style="color:${RECIPE_ACCENT}"></i>
                <h3 class="text-slate-300 text-xs font-semibold uppercase tracking-widest">Notes</h3>
            </div>
            <textarea id="recipe-notes" rows="3" class="${taCls}" placeholder="Tips, substitutions, where it came from…">${escapeRecipe(r.notes)}</textarea>
        </div>

        <div class="text-right">
            <span id="recipe-save-status" class="text-slate-700 text-xs italic">saved</span>
        </div>
    </div>`;

    // ── Wire editor events ──
    const bind = (id, field, ev) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener(ev || 'input', () => recipeCommitField(field, el.value));
    };
    bind('recipe-name', 'name');
    bind('recipe-meal', 'meal', 'change');
    bind('recipe-servings', 'servings');
    bind('recipe-time', 'time');
    bind('recipe-ingredients', 'ingredients');
    bind('recipe-steps', 'steps');
    bind('recipe-notes', 'notes');
    // keep keystrokes from bubbling to global app shortcuts
    wrap.querySelectorAll('input, textarea, select').forEach(el => {
        el.addEventListener('keydown', e => e.stopPropagation());
    });
    const del = document.getElementById('recipe-delete');
    if (del) del.addEventListener('click', () => recipeDelete(r.id));

    // photos
    const addPhoto = document.getElementById('recipe-add-photo');
    const photoInput = document.getElementById('recipe-photo-input');
    if (addPhoto && photoInput) {
        addPhoto.addEventListener('click', () => photoInput.click());
        photoInput.addEventListener('change', () => { recipeAddPhotos(photoInput.files); photoInput.value = ''; });
    }
    wrap.querySelectorAll('[data-rmphoto]').forEach(b => {
        b.addEventListener('click', () => recipeRemovePhoto(parseInt(b.getAttribute('data-rmphoto'), 10)));
    });
}

function escapeRecipe(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ── Entry point ────────────────────────────────────────────────────
function renderRecipes() {
    recipesData = loadRecipesData();
    if (!Array.isArray(recipesData.recipes)) recipesData.recipes = [];
    recipesData.recipes.forEach(r => { if (!Array.isArray(r.photos)) r.photos = []; });

    if (!recipesBuilt) {
        const nb = document.getElementById('recipes-new-btn');
        if (nb) nb.addEventListener('click', recipeCreate);
        const search = document.getElementById('recipes-search');
        if (search) {
            search.addEventListener('input', () => { recipeSearch = search.value; renderRecipesList(); });
            search.addEventListener('keydown', e => e.stopPropagation());
        }
        recipesBuilt = true;
    }

    // default selection
    if (!recipeById(recipeActiveId)) {
        const list = recipeFilteredList();
        recipeActiveId = list.length ? list[0].id : null;
    }

    renderRecipeFilter();
    renderRecipesList();
    renderRecipeDetail();
}
