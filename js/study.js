// ── Study / Pomodoro ────────────────────────────────────────────
// Depends on: globals.js  (fs, path, STUDY_FILE, todayStr)

// ── Persistence ───────────────────────────────────────────────────
function loadStudyData() {
    try {
        return fs.existsSync(STUDY_FILE)
            ? JSON.parse(fs.readFileSync(STUDY_FILE, 'utf8'))
            : defaultStudyData();
    } catch(_) { return defaultStudyData(); }
}

function defaultStudyData() {
    return {
        subjects: [],
        sessions: [],
        settings: { work: 25, shortBreak: 5, longBreak: 15, sessionsBeforeLong: 4 }
    };
}

function saveStudyData() {
    fs.writeFileSync(STUDY_FILE, JSON.stringify(studyData, null, 2));
}

// ── State ─────────────────────────────────────────────────────────
let studyData       = defaultStudyData();
let studyStatsPeriod = 'week'; // 'today' | 'week' | 'month' | 'year'

let pomo = {
    interval:      null,
    running:       false,
    secondsLeft:   25 * 60,
    sessionType:   'work',   // 'work' | 'short' | 'long'
    roundsThisRun: 0,
};

const TYPE_COLORS = {
    work:  { text: '#f87171', bg: 'rgba(239,68,68,0.12)',    border: 'rgba(239,68,68,0.3)' },
    short: { text: '#34d399', bg: 'rgba(52,211,153,0.12)',   border: 'rgba(52,211,153,0.3)' },
    long:  { text: '#60a5fa', bg: 'rgba(96,165,250,0.12)',   border: 'rgba(96,165,250,0.3)' },
};

function durations() {
    const s = studyData.settings;
    return { work: s.work * 60, short: s.shortBreak * 60, long: s.longBreak * 60 };
}

const SUBJECT_COLORS = [
    '#f87171','#fb923c','#fbbf24','#34d399',
    '#22d3ee','#60a5fa','#a78bfa','#f472b6',
];

function pickSubjectColor() {
    const used = new Set(studyData.subjects.map(s => s.color));
    return SUBJECT_COLORS.find(c => !used.has(c)) || SUBJECT_COLORS[studyData.subjects.length % SUBJECT_COLORS.length];
}

// ── Timer logic ───────────────────────────────────────────────────
function fmtTime(s) {
    return `${String(Math.floor(s / 60)).padStart(2,'0')}:${String(s % 60).padStart(2,'0')}`;
}

// Ask for notification permission when a timer actually starts, not at launch.
// Reading Notification.permission is a synchronous trip to the browser process,
// and during startup that process is busy opening the window — the read alone
// blocked the renderer for over a second before anything could be painted.
function studyAskNotifyPermission() {
    try {
        if (Notification.permission === 'default') Notification.requestPermission();
    } catch (_) {}
}

function startTimer() {
    if (pomo.running) return;
    studyAskNotifyPermission();
    pomo.running = true;
    pomo.interval = setInterval(() => {
        pomo.secondsLeft--;
        updateTimerDisplay();
        if (pomo.secondsLeft <= 0) {
            clearInterval(pomo.interval);
            pomo.running = false;
            onSessionComplete();
        }
    }, 1000);
    renderControls();
}

function pauseTimer() {
    if (!pomo.running) return;
    clearInterval(pomo.interval);
    pomo.running = false;
    renderControls();
}

function resetTimer() {
    clearInterval(pomo.interval);
    pomo.running = false;
    pomo.secondsLeft = durations()[pomo.sessionType];
    updateTimerDisplay();
    renderControls();
}

function switchType(type) {
    pauseTimer();
    pomo.sessionType = type;
    pomo.secondsLeft = durations()[type];
    updateTimerDisplay();
    renderTypeBtns();
    renderControls();
    updateStatusLabel();
}

function onSessionComplete() {
    const subjectId = (document.getElementById('study-subject-select') || {}).value || '';

    if (pomo.sessionType === 'work') {
        pomo.roundsThisRun++;

        // Log the session
        const session = {
            id:          Date.now(),
            subjectId:   subjectId || null,
            date:        todayStr(),
            durationMin: studyData.settings.work,
            type:        'work',
            completedAt: Date.now(),
        };
        studyData.sessions.push(session);

        // Update subject total time
        if (subjectId) {
            const subj = studyData.subjects.find(s => s.id === subjectId);
            if (subj) subj.totalMinutes = (subj.totalMinutes || 0) + studyData.settings.work;
        }
        saveStudyData();
        renderLog();
        renderSubjects();
        renderStats();
        renderRoundDots();

        // Auto-switch to break
        const isLong = pomo.roundsThisRun % studyData.settings.sessionsBeforeLong === 0;
        switchType(isLong ? 'long' : 'short');

        playTimerSound(true);
        notify('Work session complete!', isLong ? 'Time for a long break.' : 'Take a short break.');
    } else {
        switchType('work');
        playTimerSound(false);
        notify('Break over!', 'Time to focus.');
    }
}

function notify(title, body) {
    // Reading the permission here is cheap: by the time a session ends the
    // browser process is long past its startup work.
    if (Notification.permission === 'granted') {
        new Notification(`Vulsor Study — ${title}`, { body, silent: false });
    }
}

// ── Timer end sound (Web Audio API) ──────────────────────────────
function playTimerSound(isWork) {
    try {
        const ctx = new AudioContext();
        // Work done → ascending chime (C5 E5 G5 C6)
        // Break done → two soft low tones (G4 C5)
        const notes = isWork
            ? [523.25, 659.25, 783.99, 1046.50]
            : [392.00, 523.25];

        notes.forEach((freq, i) => {
            const osc  = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type = 'sine';
            osc.frequency.value = freq;
            const t = ctx.currentTime + i * 0.22;
            gain.gain.setValueAtTime(0, t);
            gain.gain.linearRampToValueAtTime(0.28, t + 0.015);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
            osc.start(t);
            osc.stop(t + 0.6);
        });

        // Fade out context after all notes finish
        setTimeout(() => ctx.close(), (notes.length * 220) + 700);
    } catch (e) {
        console.warn('Study sound error:', e);
    }
}

// ── Render helpers ────────────────────────────────────────────────
function updateTimerDisplay() {
    const el = document.getElementById('study-timer-display');
    if (el) el.textContent = fmtTime(pomo.secondsLeft);
    document.title = pomo.running ? `${fmtTime(pomo.secondsLeft)} — Vulsor` : 'Vulsor AI';
}

function updateStatusLabel() {
    const el = document.getElementById('study-status-label');
    if (!el) return;
    const labels = { work: 'Focus session', short: 'Short break', long: 'Long break' };
    el.textContent = pomo.running
        ? `${labels[pomo.sessionType]} — in progress`
        : `${labels[pomo.sessionType]} — ready`;
}

function renderTypeBtns() {
    ['work','short','long'].forEach(type => {
        const btn = document.getElementById(`study-type-${type}`);
        if (!btn) return;
        const active = pomo.sessionType === type;
        btn.className = `study-type-btn px-4 py-1.5 rounded-lg text-xs font-medium transition-all ${
            active ? '' : 'text-slate-500 hover:text-slate-300'
        }`;
        if (active) {
            const c = TYPE_COLORS[type];
            btn.style.cssText = `background:${c.bg};color:${c.text};border:1px solid ${c.border}`;
        } else {
            btn.style.cssText = '';
        }
    });
}

function renderControls() {
    const start = document.getElementById('study-start-btn');
    const pause = document.getElementById('study-pause-btn');
    if (!start || !pause) return;
    start.style.display = pomo.running ? 'none' : '';
    pause.style.display = pomo.running ? '' : 'none';
    updateStatusLabel();
}

function renderRoundDots() {
    const el = document.getElementById('study-rounds-dots');
    if (!el) return;
    const total    = studyData.settings.sessionsBeforeLong;
    const completed = pomo.roundsThisRun % total || (pomo.roundsThisRun > 0 && pomo.roundsThisRun % total === 0 ? total : 0);
    el.innerHTML = Array.from({ length: total }, (_, i) =>
        `<div class="w-2 h-2 rounded-full transition-all" style="background:${
            i < (pomo.roundsThisRun % total || (pomo.roundsThisRun > 0 && pomo.roundsThisRun % total === 0 ? total : 0))
                ? '#f87171' : '#334155'
        }"></div>`
    ).join('');
}

function renderSubjectSelect() {
    const sel = document.getElementById('study-subject-select');
    if (!sel) return;
    const prev = sel.value;
    sel.innerHTML = '<option value="">No subject</option>' +
        studyData.subjects.map(s =>
            `<option value="${s.id}">${s.name}</option>`
        ).join('');
    if (prev && studyData.subjects.find(s => s.id === prev)) sel.value = prev;
}

function renderLog() {
    const el = document.getElementById('study-log-list');
    if (!el) return;
    const today = todayStr();
    const sessions = [...studyData.sessions]
        .filter(s => s.date === today && s.type === 'work')
        .reverse();

    if (sessions.length === 0) {
        el.innerHTML = '<p class="text-slate-600 text-xs text-center py-4">No sessions yet today</p>';
        return;
    }

    el.innerHTML = sessions.map(s => {
        const subj = s.subjectId ? studyData.subjects.find(sub => sub.id === s.subjectId) : null;
        const time = new Date(s.completedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return `<div class="flex items-center gap-3 py-2 border-b border-slate-800/60 last:border-0">
            <div class="w-2 h-2 rounded-full shrink-0" style="background:${subj ? subj.color : '#475569'}"></div>
            <span class="text-slate-300 text-xs flex-1">${subj ? subj.name : 'Untracked'}</span>
            <span class="text-slate-500 text-xs">${s.durationMin}min</span>
            <span class="text-slate-600 text-xs">${time}</span>
        </div>`;
    }).join('');
}

function renderStats() {
    const el = document.getElementById('study-stats');
    if (!el) return;
    const today    = todayStr();
    const sessions = studyData.sessions.filter(s => s.date === today && s.type === 'work');
    const totalMin = sessions.reduce((a, s) => a + s.durationMin, 0);
    const h = Math.floor(totalMin / 60), m = totalMin % 60;
    const timeStr  = h > 0 ? `${h}h ${m}m` : (m > 0 ? `${m}m` : '0m');

    el.innerHTML = `
        <div class="flex gap-6 items-center">
            <div class="text-center">
                <div class="text-2xl font-bold text-white tabular-nums">${sessions.length}</div>
                <div class="text-slate-500 text-[10px] uppercase tracking-wider mt-0.5">Sessions Today</div>
            </div>
            <div class="w-px h-10 bg-slate-800"></div>
            <div class="text-center">
                <div class="text-2xl font-bold text-white tabular-nums">${timeStr}</div>
                <div class="text-slate-500 text-[10px] uppercase tracking-wider mt-0.5">Focus Time</div>
            </div>
            <div class="w-px h-10 bg-slate-800"></div>
            <div class="text-center">
                <div class="text-2xl font-bold text-white tabular-nums">${pomo.roundsThisRun}</div>
                <div class="text-slate-500 text-[10px] uppercase tracking-wider mt-0.5">This Run</div>
            </div>
        </div>`;
}

// ── Period stats helpers ──────────────────────────────────────────
function periodStartDate(period) {
    const now = new Date();
    if (period === 'today') return todayStr();
    if (period === 'week') {
        const d = new Date(now);
        d.setDate(d.getDate() - d.getDay());
        return toDateStr(d);
    }
    if (period === 'month') {
        return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;
    }
    if (period === 'year') return `${now.getFullYear()}-01-01`;
    return todayStr();
}

function subjectMinutesInPeriod(subjectId, period) {
    const start = periodStartDate(period);
    const end   = todayStr();
    return studyData.sessions
        .filter(s => s.type === 'work' && s.date >= start && s.date <= end && s.subjectId === subjectId)
        .reduce((acc, s) => acc + s.durationMin, 0);
}

function totalMinutesInPeriod(period) {
    const start = periodStartDate(period);
    const end   = todayStr();
    return studyData.sessions
        .filter(s => s.type === 'work' && s.date >= start && s.date <= end)
        .reduce((acc, s) => acc + s.durationMin, 0);
}

function fmtMin(m) {
    if (m === 0) return '—';
    const h = Math.floor(m / 60), rem = m % 60;
    if (h === 0) return `${rem}m`;
    if (rem === 0) return `${h}h`;
    return `${h}h ${rem}m`;
}

function renderSubjects() {
    const el    = document.getElementById('study-subjects-list');
    const totEl = document.getElementById('study-period-total');
    if (!el) return;

    // Sync period selector button styles
    document.querySelectorAll('.study-period-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.period === studyStatsPeriod);
    });

    if (studyData.subjects.length === 0) {
        el.innerHTML = '<p class="text-slate-600 text-xs text-center py-3">No subjects yet</p>';
        if (totEl) totEl.textContent = '';
        return;
    }

    const grandTotal = totalMinutesInPeriod(studyStatsPeriod);

    el.innerHTML = studyData.subjects.map(s => {
        const mins    = subjectMinutesInPeriod(s.id, studyStatsPeriod);
        const pct     = grandTotal > 0 ? Math.round((mins / grandTotal) * 100) : 0;
        const timeStr = fmtMin(mins);
        return `<div class="py-2 border-b border-slate-800/60 last:border-0 group">
            <div class="flex items-center gap-3 mb-1.5">
                <div class="w-2.5 h-2.5 rounded-full shrink-0" style="background:${s.color}"></div>
                <span class="text-slate-300 text-xs flex-1 truncate">${s.name}</span>
                <span class="text-slate-400 text-xs tabular-nums font-medium">${timeStr}</span>
                <button onclick="deleteStudySubject('${s.id}')"
                    class="opacity-0 group-hover:opacity-100 w-5 h-5 text-slate-600 hover:text-red-500 transition-all flex items-center justify-center shrink-0">
                    <i class="fas fa-times text-[10px]"></i>
                </button>
            </div>
            ${mins > 0 ? `<div class="ml-5 h-1 rounded-full bg-slate-800 overflow-hidden">
                <div class="h-full rounded-full transition-all" style="width:${pct}%;background:${s.color}"></div>
            </div>` : ''}
        </div>`;
    }).join('');

    if (totEl) {
        const periodLabels = { today: 'today', week: 'this week', month: 'this month', year: 'this year' };
        totEl.textContent = grandTotal > 0
            ? `${fmtMin(grandTotal)} total ${periodLabels[studyStatsPeriod]}`
            : `No sessions ${periodLabels[studyStatsPeriod]}`;
    }
}

function deleteStudySubject(id) {
    studyData.subjects = studyData.subjects.filter(s => s.id !== id);
    saveStudyData();
    renderSubjectSelect();
    renderSubjects();
}

// ── Settings modal ────────────────────────────────────────────────
function openStudySettings() {
    const modal = document.getElementById('study-settings-modal');
    if (!modal) return;
    const s = studyData.settings;
    document.getElementById('study-setting-work').value   = s.work;
    document.getElementById('study-setting-short').value  = s.shortBreak;
    document.getElementById('study-setting-long').value   = s.longBreak;
    document.getElementById('study-setting-rounds').value = s.sessionsBeforeLong;
    modal.classList.add('open');
}

function closeStudySettings() {
    const modal = document.getElementById('study-settings-modal');
    if (modal) modal.classList.remove('open');
}

// ── Init ──────────────────────────────────────────────────────────
function initStudy() {
    studyData = loadStudyData();

    // Session type buttons
    ['work','short','long'].forEach(type =>
        document.getElementById(`study-type-${type}`).onclick = () => switchType(type)
    );

    // Timer controls
    document.getElementById('study-start-btn').onclick = startTimer;
    document.getElementById('study-pause-btn').onclick = pauseTimer;
    document.getElementById('study-reset-btn').onclick = resetTimer;

    // Settings
    document.getElementById('study-settings-btn').onclick       = openStudySettings;
    document.getElementById('study-settings-close-btn').onclick = closeStudySettings;
    document.getElementById('study-settings-save-btn').onclick  = () => {
        const w = Math.max(1, parseInt(document.getElementById('study-setting-work').value)   || 25);
        const s = Math.max(1, parseInt(document.getElementById('study-setting-short').value)  || 5);
        const l = Math.max(1, parseInt(document.getElementById('study-setting-long').value)   || 15);
        const r = Math.max(1, parseInt(document.getElementById('study-setting-rounds').value) || 4);
        studyData.settings = { work: w, shortBreak: s, longBreak: l, sessionsBeforeLong: r };
        saveStudyData();
        if (!pomo.running) {
            pomo.secondsLeft = durations()[pomo.sessionType];
            updateTimerDisplay();
        }
        renderRoundDots();
        closeStudySettings();
    };

    // Period selector
    document.querySelectorAll('.study-period-btn').forEach(btn => {
        btn.onclick = () => {
            studyStatsPeriod = btn.dataset.period;
            renderSubjects();
        };
    });

    // Add subject
    const addSubject = () => {
        const input = document.getElementById('study-new-subject-input');
        const name  = input.value.trim();
        if (!name) return;
        studyData.subjects.push({
            id:           'subj_' + Date.now(),
            name,
            color:        pickSubjectColor(),
            totalMinutes: 0,
        });
        saveStudyData();
        input.value = '';
        renderSubjectSelect();
        renderSubjects();
    };
    document.getElementById('study-add-subject-btn').onclick = addSubject;
    document.getElementById('study-new-subject-input').onkeypress = e => {
        if (e.key === 'Enter') addSubject();
    };

    // Initial render
    pomo.secondsLeft = durations().work;
    updateTimerDisplay();
    renderTypeBtns();
    renderControls();
    renderRoundDots();
    renderSubjectSelect();
    renderLog();
    renderStats();
    renderSubjects();
}
