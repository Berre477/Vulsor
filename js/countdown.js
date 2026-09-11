// ── Countdowns — track days until future events ────────────────────
// Depends on: globals.js (fs, COUNTDOWN_FILE, countdowns)

// Each countdown: { id, title, description, target (ms epoch), color, createdAt }

const COUNTDOWN_COLORS = ['#eab308', '#f43f5e', '#3b82f6', '#10b981', '#a855f7', '#06b6d4', '#f97316', '#ec4899'];

function loadCountdowns() {
    try {
        if (fs.existsSync(COUNTDOWN_FILE)) {
            const data = readJsonStrict(COUNTDOWN_FILE);
            countdowns = Array.isArray(data) ? data : (data.countdowns || []);
        } else {
            countdowns = [];
        }
    } catch (_) {
        countdowns = [];
    }
}

function saveCountdowns() {
    try { writeJsonSafe(COUNTDOWN_FILE, countdowns); } catch (_) {}
}

// ── Helpers ────────────────────────────────────────────────────────
function countdownRemaining(targetMs) {
    let diff = targetMs - Date.now();
    const past = diff < 0;
    diff = Math.abs(diff);
    const totalSec = Math.floor(diff / 1000);
    return {
        past,
        days:  Math.floor(totalSec / 86400),
        hours: Math.floor((totalSec % 86400) / 3600),
        mins:  Math.floor((totalSec % 3600) / 60),
        secs:  totalSec % 60,
    };
}

function countdownFmtDate(ms) {
    const d = new Date(ms);
    const date = d.toLocaleDateString([], { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' });
    const hasTime = d.getHours() !== 0 || d.getMinutes() !== 0;
    return hasTime ? `${date} · ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : date;
}

function countdownTimeBlocksHTML(r) {
    const block = (val, label) => `
        <div class="flex flex-col items-center">
            <span class="text-xl font-bold tabular-nums text-slate-100 leading-none">${String(val).padStart(2, '0')}</span>
            <span class="text-[9px] uppercase tracking-widest text-slate-500 mt-1">${label}</span>
        </div>`;
    return block(r.days, 'days') + block(r.hours, 'hrs') + block(r.mins, 'min') + block(r.secs, 'sec');
}

// ── Render ─────────────────────────────────────────────────────────
function renderCountdowns() {
    const listEl = document.getElementById('countdown-list');
    if (!listEl) return;

    if (!countdowns.length) {
        listEl.innerHTML = `
            <div class="flex flex-col items-center justify-center py-24 text-center col-span-full">
                <div class="w-16 h-16 bg-slate-800 rounded-2xl flex items-center justify-center mb-4">
                    <i class="fas fa-hourglass-half text-2xl text-slate-600"></i>
                </div>
                <p class="text-slate-400 text-sm font-medium">No countdowns yet</p>
                <p class="text-slate-600 text-xs mt-1">Add one above to start counting down to a future day</p>
            </div>`;
        return;
    }

    // Soonest upcoming first; past events sink to the bottom
    const sorted = [...countdowns].sort((a, b) => {
        const ap = a.target < Date.now(), bp = b.target < Date.now();
        if (ap !== bp) return ap ? 1 : -1;
        return a.target - b.target;
    });

    listEl.innerHTML = sorted.map(c => {
        const r = countdownRemaining(c.target);
        const color = c.color || COUNTDOWN_COLORS[0];
        return `
        <div class="countdown-card group relative rounded-2xl border border-slate-800 bg-slate-900/40 p-5 transition-all hover:border-slate-700" data-id="${c.id}" style="border-left:3px solid ${color}">
            <button class="countdown-delete absolute top-3 right-3 opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-500 transition-all w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-600/10" data-id="${c.id}" title="Delete">
                <i class="fas fa-trash text-xs"></i>
            </button>
            <div class="flex items-center gap-2 mb-3 pr-8">
                <i class="fas fa-flag-checkered text-xs" style="color:${color}"></i>
                <h3 class="text-slate-100 font-semibold text-sm truncate">${escapeCountdown(c.title)}</h3>
            </div>
            <div id="countdown-time-${c.id}" class="grid grid-cols-4 gap-2 mb-3 px-2 py-3 rounded-xl bg-slate-800/40">
                ${countdownTimeBlocksHTML(r)}
            </div>
            <div id="countdown-status-${c.id}" class="text-xs font-medium mb-2" style="color:${color}">
                ${r.past ? `<i class="fas fa-check-circle mr-1"></i>Reached ${r.days > 0 ? r.days + ' day' + (r.days === 1 ? '' : 's') + ' ago' : 'today'}` : `<i class="fas fa-clock mr-1"></i>${r.days} day${r.days === 1 ? '' : 's'} to go`}
            </div>
            <p class="text-slate-500 text-xs flex items-center gap-1.5"><i class="far fa-calendar text-[10px]"></i>${countdownFmtDate(c.target)}</p>
            ${c.description ? `<p class="text-slate-400 text-xs mt-2 leading-relaxed border-t border-slate-800/60 pt-2">${escapeCountdown(c.description)}</p>` : ''}
        </div>`;
    }).join('');

    listEl.querySelectorAll('.countdown-delete').forEach(btn => {
        btn.onclick = () => {
            countdowns = countdowns.filter(c => c.id !== Number(btn.dataset.id));
            saveCountdowns();
            renderCountdowns();
        };
    });
}

function escapeCountdown(s) {
    return String(s || '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

// Lightweight per-second update — only rewrites the time numbers, not the cards
function tickCountdowns() {
    const view = document.getElementById('view-countdown');
    if (!view || !view.classList.contains('active')) return;
    countdowns.forEach(c => {
        const timeEl = document.getElementById(`countdown-time-${c.id}`);
        if (!timeEl) return;
        const r = countdownRemaining(c.target);
        timeEl.innerHTML = countdownTimeBlocksHTML(r);
        const statusEl = document.getElementById(`countdown-status-${c.id}`);
        if (statusEl) {
            statusEl.innerHTML = r.past
                ? `<i class="fas fa-check-circle mr-1"></i>Reached ${r.days > 0 ? r.days + ' day' + (r.days === 1 ? '' : 's') + ' ago' : 'today'}`
                : `<i class="fas fa-clock mr-1"></i>${r.days} day${r.days === 1 ? '' : 's'} to go`;
        }
    });
}

// ── Init ───────────────────────────────────────────────────────────
function initCountdown() {
    const titleInput = document.getElementById('countdown-title-input');
    const descInput  = document.getElementById('countdown-desc-input');
    const dateInput  = document.getElementById('countdown-date-input');
    const addBtn     = document.getElementById('countdown-add-btn');
    if (!addBtn) return;

    // Default the date picker to one week ahead for convenience
    if (dateInput && !dateInput.value) {
        const d = new Date(Date.now() + 7 * 86400000);
        d.setSeconds(0, 0);
        const pad = n => String(n).padStart(2, '0');
        dateInput.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    const add = () => {
        const title = (titleInput.value || '').trim();
        const when  = dateInput.value;
        if (!title) { titleInput.focus(); return; }
        if (!when)  { dateInput.focus(); return; }
        const target = new Date(when).getTime();
        if (isNaN(target)) { dateInput.focus(); return; }

        countdowns.push({
            id: Date.now(),
            title,
            description: (descInput.value || '').trim(),
            target,
            color: COUNTDOWN_COLORS[countdowns.length % COUNTDOWN_COLORS.length],
            createdAt: Date.now(),
        });
        saveCountdowns();
        renderCountdowns();
        titleInput.value = '';
        descInput.value  = '';
        titleInput.focus();
    };

    addBtn.onclick = add;
    [titleInput, descInput].forEach(el => el && el.addEventListener('keypress', e => {
        if (e.key === 'Enter') add();
    }));

    // Single global ticker — only does work while the countdown view is visible
    if (!window._countdownTicker) {
        window._countdownTicker = setInterval(tickCountdowns, 1000);
    }
}
