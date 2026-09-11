// ── Calendar ──────────────────────────────────────────────────────────────
// A Google-Calendar-style calendar: Day / Week / Month views over a real event
// store, with click-drag to create, drag to move and drag-the-edge to resize.
//
// Depends on: globals.js (fs, CALENDAR_FILE, calEvents), todos.js (todos,
//             saveTodos, getCat, todayStr, toDateStr)
//
// Event shape — times are plain local values, never UTC, so an event at 09:00
// stays at 09:00 regardless of where the machine thinks it is:
//   { id, title, date:'YYYY-MM-DD', endDate:'YYYY-MM-DD'|null,
//     allDay:bool, startMin:int, endMin:int, color:'#rrggbb', notes:'' }
// startMin/endMin are minutes from local midnight (540 = 09:00).

const CAL_HOUR_PX  = 48;               // height of one hour in the time grid
const CAL_SNAP_MIN = 15;               // dragging snaps to quarter hours
const CAL_DAY_MIN  = 24 * 60;

const CAL_COLORS = [
    { name: 'Tomato',    hex: '#ef4444' },
    { name: 'Tangerine', hex: '#f97316' },
    { name: 'Banana',    hex: '#eab308' },
    { name: 'Basil',     hex: '#22c55e' },
    { name: 'Peacock',   hex: '#06b6d4' },
    { name: 'Blueberry', hex: '#3b82f6' },
    { name: 'Lavender',  hex: '#8b5cf6' },
    { name: 'Grape',     hex: '#d946ef' },
    { name: 'Graphite',  hex: '#64748b' },
];

const CAL_DOW    = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const CAL_MONTHS = ['January','February','March','April','May','June',
                    'July','August','September','October','November','December'];

let calView       = 'week';            // 'day' | 'week' | 'month'
let calAnchor     = new Date();        // any date inside the visible range
let calSelected   = null;              // dateKey clicked in month view
let _calNowTimer  = null;

// ── Persistence ───────────────────────────────────────────────────────────
function loadCalEvents() {
    try {
        if (fs.existsSync(CALENDAR_FILE)) {
            const d = readJsonStrict(CALENDAR_FILE);
            return Array.isArray(d) ? d : (d.events || []);
        }
    } catch (e) { console.error('[calendar] load failed:', e); }
    return [];
}
function saveCalEvents() {
    try {
        // Temp-file + rename, so a crash mid-write can't leave a truncated
        // calendar.json behind (same approach the vault uses).
        const tmp = CALENDAR_FILE + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(calEvents, null, 2));
        fs.renameSync(tmp, CALENDAR_FILE);
    } catch (e) { console.error('[calendar] save failed:', e); }
}

// ── Date helpers (local — never toISOString, which shifts the day) ────────
function calKey(d) {
    return d.getFullYear() + '-' +
           String(d.getMonth() + 1).padStart(2, '0') + '-' +
           String(d.getDate()).padStart(2, '0');
}
function calParse(key) {
    const [y, m, d] = String(key).split('-').map(Number);
    return new Date(y, m - 1, d);
}
function calAddDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function calStartOfWeek(d) {
    const x = new Date(d); x.setHours(0, 0, 0, 0);
    x.setDate(x.getDate() - x.getDay());        // weeks start Sunday, as Google does
    return x;
}
function calSameDay(a, b) { return calKey(a) === calKey(b); }
function calMinLabel(min, withMinutes) {
    const h = Math.floor(min / 60) % 24, m = min % 60;
    const ampm = h < 12 ? 'AM' : 'PM';
    const h12  = h % 12 === 0 ? 12 : h % 12;
    return (withMinutes || m) ? `${h12}:${String(m).padStart(2,'0')} ${ampm}` : `${h12} ${ampm}`;
}
function calNowMin() { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); }
function calNewId()  { return 'ev' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

// ── Which days does a given range cover ──────────────────────────────────
function calVisibleDays() {
    if (calView === 'day')  return [new Date(calAnchor)];
    if (calView === 'week') {
        const s = calStartOfWeek(calAnchor);
        return Array.from({ length: 7 }, (_, i) => calAddDays(s, i));
    }
    // month: full weeks covering the month
    const first = new Date(calAnchor.getFullYear(), calAnchor.getMonth(), 1);
    const start = calStartOfWeek(first);
    const days  = [];
    for (let i = 0; i < 42; i++) {
        const d = calAddDays(start, i);
        days.push(d);
        if (i >= 34 && d.getMonth() !== calAnchor.getMonth() && d.getDay() === 6) break;
    }
    return days;
}

// ── Events for a day ─────────────────────────────────────────────────────
// All-day events may span days via endDate, so a day is covered when it falls
// anywhere in [date, endDate].
function calEventsOn(dateKey) {
    return calEvents.filter(ev => {
        if (!ev.allDay) return ev.date === dateKey;
        const from = ev.date, to = ev.endDate || ev.date;
        return dateKey >= from && dateKey <= to;
    });
}
function calTimedOn(dateKey) {
    return calEventsOn(dateKey).filter(e => !e.allDay)
        .sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
}
function calAllDayOn(dateKey) { return calEventsOn(dateKey).filter(e => e.allDay); }

// Tasks with a due date show up too, so the calendar covers everything you
// have on that day rather than only the things typed into it.
function calTodosOn(dateKey) {
    return (typeof todos !== 'undefined' ? todos : []).filter(t => t.dueDate === dateKey);
}

// ── Side-by-side layout for overlapping events ───────────────────────────
// Events that overlap in time are split across columns, the way every
// calendar does it: cluster the overlaps, then pack each cluster greedily.
function calLayoutDay(evs) {
    const sorted = [...evs].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
    const out = [];
    let cluster = [], clusterEnd = -1;

    const flush = () => {
        if (!cluster.length) return;
        const colEnds = [];
        cluster.forEach(ev => {
            let c = 0;
            while (colEnds[c] != null && colEnds[c] > ev.startMin) c++;
            colEnds[c] = ev.endMin;
            ev.__col = c;
        });
        cluster.forEach(ev => out.push({ ev, col: ev.__col, cols: colEnds.length }));
        cluster = [];
    };

    sorted.forEach(ev => {
        if (cluster.length && ev.startMin >= clusterEnd) { flush(); clusterEnd = -1; }
        cluster.push(ev);
        clusterEnd = Math.max(clusterEnd, ev.endMin);
    });
    flush();
    return out;
}

// ── Render ───────────────────────────────────────────────────────────────
function renderCalPage() {
    const root = document.getElementById('cal-root');
    if (!root) return;
    _calSyncHeader();
    if (calView === 'month') _calRenderMonth(root);
    else                     _calRenderGrid(root);
    _calStartNowTimer();
}

function _calSyncHeader() {
    const title = document.getElementById('cal-title');
    const days  = calVisibleDays();
    if (title) {
        if (calView === 'day') {
            title.textContent = `${CAL_MONTHS[calAnchor.getMonth()]} ${calAnchor.getDate()}, ${calAnchor.getFullYear()}`;
        } else if (calView === 'week') {
            const a = days[0], b = days[6];
            title.textContent = a.getMonth() === b.getMonth()
                ? `${CAL_MONTHS[a.getMonth()]} ${a.getDate()} – ${b.getDate()}, ${a.getFullYear()}`
                : `${CAL_MONTHS[a.getMonth()].slice(0,3)} ${a.getDate()} – ${CAL_MONTHS[b.getMonth()].slice(0,3)} ${b.getDate()}, ${b.getFullYear()}`;
        } else {
            title.textContent = `${CAL_MONTHS[calAnchor.getMonth()]} ${calAnchor.getFullYear()}`;
        }
    }
    document.querySelectorAll('.cal-view-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.view === calView);
    });
}

// ── Day / Week: the time grid ────────────────────────────────────────────
function _calRenderGrid(root) {
    const days     = calVisibleDays();
    const todayKey = calKey(new Date());

    root.innerHTML = `
        <div class="cal-wrap">
            <div class="cal-head" id="cal-head"></div>
            <div class="cal-allday" id="cal-allday"></div>
            <div class="cal-scroll" id="cal-scroll">
                <div class="cal-grid-body" id="cal-body"></div>
            </div>
        </div>`;

    const head   = root.querySelector('#cal-head');
    const allday = root.querySelector('#cal-allday');
    const body   = root.querySelector('#cal-body');
    const cols   = `72px repeat(${days.length}, minmax(0, 1fr))`;
    head.style.gridTemplateColumns   = cols;
    allday.style.gridTemplateColumns = cols;
    body.style.gridTemplateColumns   = cols;

    // ── Day headers ──
    head.appendChild(_calCell('cal-head-gutter'));
    days.forEach(d => {
        const key  = calKey(d);
        const cell = _calCell('cal-head-day' + (key === todayKey ? ' today' : ''));
        const dow  = document.createElement('span');
        dow.className = 'cal-head-dow';
        dow.textContent = CAL_DOW[d.getDay()];
        const num = document.createElement('span');
        num.className = 'cal-head-num';
        num.textContent = d.getDate();
        cell.append(dow, num);
        cell.onclick = () => { calAnchor = new Date(d); calView = 'day'; renderCalPage(); };
        head.appendChild(cell);
    });

    // ── All-day row ──
    const adLabel = _calCell('cal-allday-gutter');
    adLabel.textContent = 'all-day';
    allday.appendChild(adLabel);
    days.forEach(d => {
        const key  = calKey(d);
        const cell = _calCell('cal-allday-cell');
        calAllDayOn(key).forEach(ev => cell.appendChild(_calChip(ev)));
        // Only untimed tasks belong up here — one with a time is drawn on the
        // grid at that time instead, and showing it in both places reads as two
        // separate tasks.
        calTodosOn(key).filter(t => !t.dueTime).forEach(t => cell.appendChild(_calTodoChip(t)));
        cell.ondblclick = () => calOpenEditor(_calBlankEvent(key, { allDay: true }));
        allday.appendChild(cell);
    });

    // ── Hour gutter ──
    const gutter = _calCell('cal-gutter');
    gutter.style.height = (CAL_HOUR_PX * 24) + 'px';
    for (let h = 1; h < 24; h++) {
        const l = document.createElement('span');
        l.className = 'cal-hour-label';
        l.style.top = (h * CAL_HOUR_PX) + 'px';
        l.textContent = calMinLabel(h * 60);
        gutter.appendChild(l);
    }
    body.appendChild(gutter);

    // ── Day columns ──
    days.forEach(d => {
        const key = calKey(d);
        const col = _calCell('cal-col' + (key === todayKey ? ' today' : ''));
        col.dataset.date = key;
        col.style.height = (CAL_HOUR_PX * 24) + 'px';

        calLayoutDay(calTimedOn(key)).forEach(({ ev, col: c, cols: n }) => {
            col.appendChild(_calEventEl(ev, c, n));
        });
        // Tasks that carry a time sit on the grid alongside events.
        calTodosOn(key).filter(t => t.dueTime).forEach(t => col.appendChild(_calTodoEl(t)));

        if (key === todayKey) {
            const now = document.createElement('div');
            now.className = 'cal-now';
            now.id = 'cal-now-line';
            now.style.top = ((calNowMin() / 60) * CAL_HOUR_PX) + 'px';
            col.appendChild(now);
        }

        _calAttachCreate(col, key);
        body.appendChild(col);
    });

    // Open on the working day rather than at midnight.
    const scroll = root.querySelector('#cal-scroll');
    requestAnimationFrame(() => {
        const target = Math.max(0, ((calNowMin() - 90) / 60) * CAL_HOUR_PX);
        scroll.scrollTop = Math.min(target, CAL_HOUR_PX * 24 - scroll.clientHeight);
    });
}

function _calCell(cls) { const el = document.createElement('div'); el.className = cls; return el; }

// ── Event blocks ─────────────────────────────────────────────────────────
function _calEventEl(ev, col, cols) {
    const el = document.createElement('div');
    el.className = 'cal-event';
    el.dataset.id = ev.id;
    const top = (ev.startMin / 60) * CAL_HOUR_PX;
    const h   = Math.max(((ev.endMin - ev.startMin) / 60) * CAL_HOUR_PX, 16);
    el.style.top    = top + 'px';
    el.style.height = h + 'px';
    el.style.left   = `calc(${(col / cols) * 100}% + 2px)`;
    el.style.width  = `calc(${(1 / cols) * 100}% - 6px)`;
    el.style.background  = (ev.color || '#3b82f6') + '2e';
    el.style.borderLeft  = '3px solid ' + (ev.color || '#3b82f6');

    const t = document.createElement('span');
    t.className = 'cal-event-title';
    t.textContent = ev.title || '(no title)';
    const time = document.createElement('span');
    time.className = 'cal-event-time';
    time.textContent = `${calMinLabel(ev.startMin, true)} – ${calMinLabel(ev.endMin, true)}`;
    el.append(t);
    if (h > 30) el.append(time);

    const grip = document.createElement('div');
    grip.className = 'cal-event-grip';
    el.appendChild(grip);

    _calAttachMove(el, ev, grip);
    return el;
}

function _calChip(ev) {
    const c = document.createElement('div');
    c.className = 'cal-chip';
    c.style.background = (ev.color || '#3b82f6') + '33';
    c.style.color = ev.color || '#93c5fd';
    c.textContent = ev.title || '(no title)';
    c.onclick = e => { e.stopPropagation(); calOpenEditor(ev); };
    return c;
}

function _calTodoChip(t) {
    const c = document.createElement('div');
    c.className = 'cal-chip cal-chip-todo' + (t.done ? ' done' : '');
    const cat = (typeof getCat === 'function') ? getCat(t.categoryId) : null;
    const col = cat ? cat.color : '#64748b';
    c.style.background = col + '22';
    c.style.color = col;
    c.textContent = (t.done ? '✓ ' : '') + t.text;
    c.title = 'Task — click to toggle';
    c.onclick = e => { e.stopPropagation(); _calToggleTodo(t); };
    return c;
}

function _calTodoEl(t) {
    const el = document.createElement('div');
    el.className = 'cal-event cal-event-todo' + (t.done ? ' done' : '');
    const start = _calTimeToMin(t.dueTime);
    el.style.top    = ((start / 60) * CAL_HOUR_PX) + 'px';
    el.style.height = (CAL_HOUR_PX / 2) + 'px';
    el.style.left   = '2px';
    el.style.width  = 'calc(100% - 6px)';
    const cat = (typeof getCat === 'function') ? getCat(t.categoryId) : null;
    const col = cat ? cat.color : '#64748b';
    el.style.background = col + '22';
    el.style.borderLeft = '3px dashed ' + col;
    const s = document.createElement('span');
    s.className = 'cal-event-title';
    s.textContent = (t.done ? '✓ ' : '') + t.text;
    el.appendChild(s);
    el.title = 'Task — click to toggle';
    el.onclick = e => { e.stopPropagation(); _calToggleTodo(t); };
    return el;
}

function _calToggleTodo(t) {
    t.done = !t.done;
    t.completedAt = t.done ? Date.now() : null;
    if (typeof saveTodos === 'function') saveTodos();
    if (typeof renderTodos === 'function') { try { renderTodos(); } catch (_) {} }
    renderCalPage();
}

function _calTimeToMin(hhmm) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
    return m ? Math.min(CAL_DAY_MIN - 1, (+m[1]) * 60 + (+m[2])) : 0;
}
function _calMinToTime(min) {
    return String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0');
}

// ── Drag on empty grid → create ──────────────────────────────────────────
function _calAttachCreate(col, dateKey) {
    col.addEventListener('pointerdown', e => {
        if (e.button !== 0) return;
        if (e.target.closest('.cal-event')) return;      // dragging an event, not the canvas
        e.preventDefault();

        const rect  = col.getBoundingClientRect();
        const from  = _calSnap(((e.clientY - rect.top) / CAL_HOUR_PX) * 60);
        const ghost = document.createElement('div');
        ghost.className = 'cal-event cal-ghost';
        ghost.style.left = '2px';
        ghost.style.width = 'calc(100% - 6px)';
        col.appendChild(ghost);

        let startMin = from, endMin = from + 30;
        const paint = () => {
            ghost.style.top    = ((startMin / 60) * CAL_HOUR_PX) + 'px';
            ghost.style.height = Math.max(((endMin - startMin) / 60) * CAL_HOUR_PX, 12) + 'px';
            ghost.textContent  = `${calMinLabel(startMin, true)} – ${calMinLabel(endMin, true)}`;
        };
        paint();

        const move = ev => {
            const to = _calSnap(((ev.clientY - rect.top) / CAL_HOUR_PX) * 60);
            startMin = Math.max(0, Math.min(from, to));
            endMin   = Math.min(CAL_DAY_MIN, Math.max(from, to));
            if (endMin - startMin < CAL_SNAP_MIN) endMin = startMin + CAL_SNAP_MIN;
            paint();
        };
        const up = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            ghost.remove();
            if (endMin - startMin < CAL_SNAP_MIN) endMin = startMin + 60;   // a plain click = 1 hour
            calOpenEditor(_calBlankEvent(dateKey, { startMin, endMin }));
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
    });
}

function _calSnap(min) {
    return Math.max(0, Math.min(CAL_DAY_MIN, Math.round(min / CAL_SNAP_MIN) * CAL_SNAP_MIN));
}

function _calBlankEvent(dateKey, over) {
    return Object.assign({
        id: null, title: '', date: dateKey, endDate: null, allDay: false,
        startMin: 9 * 60, endMin: 10 * 60, color: CAL_COLORS[5].hex, notes: '',
    }, over || {});
}

// ── Drag an event to move / resize ───────────────────────────────────────
function _calAttachMove(el, ev, grip) {
    let mode = null;

    el.addEventListener('pointerdown', e => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();                          // don't start a create-drag underneath
        mode = e.target === grip ? 'resize' : 'move';

        const body      = el.closest('.cal-grid-body');
        const startY    = e.clientY;
        const startX    = e.clientX;
        const origStart = ev.startMin, origEnd = ev.endMin, origDate = ev.date;
        const dur       = origEnd - origStart;
        let moved = false, curDate = origDate;

        const move = m => {
            const dy = m.clientY - startY;
            if (!moved && Math.abs(dy) < 3 && Math.abs(m.clientX - startX) < 3) return;
            moved = true;
            el.classList.add('dragging');
            const dMin = _calSnap((dy / CAL_HOUR_PX) * 60) ;

            if (mode === 'resize') {
                ev.endMin = Math.min(CAL_DAY_MIN, Math.max(origStart + CAL_SNAP_MIN, _calSnap(origEnd + dMin)));
            } else {
                let s = _calSnap(origStart + dMin);
                s = Math.max(0, Math.min(CAL_DAY_MIN - dur, s));
                ev.startMin = s; ev.endMin = s + dur;

                // Sideways across day columns — that's how you move an event to
                // another day without opening the editor.
                const overCol = document.elementsFromPoint(m.clientX, m.clientY)
                    .find(n => n.classList && n.classList.contains('cal-col'));
                if (overCol && overCol.dataset.date) curDate = overCol.dataset.date;
            }
            el.style.top    = ((ev.startMin / 60) * CAL_HOUR_PX) + 'px';
            el.style.height = Math.max(((ev.endMin - ev.startMin) / 60) * CAL_HOUR_PX, 16) + 'px';
        };

        const up = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            el.classList.remove('dragging');
            if (!moved) { calOpenEditor(ev); return; }   // a click, not a drag → edit it
            ev.date = curDate;
            saveCalEvents();
            renderCalPage();
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
    });
}

// ── Month view ───────────────────────────────────────────────────────────
function _calRenderMonth(root) {
    const days     = calVisibleDays();
    const todayKey = calKey(new Date());
    const month    = calAnchor.getMonth();

    root.innerHTML = `
        <div class="cal-wrap">
            <div class="cal-month-dow" id="cal-mdow"></div>
            <div class="cal-month" id="cal-month"></div>
        </div>`;
    const dow = root.querySelector('#cal-mdow');
    CAL_DOW.forEach(d => { const c = _calCell('cal-dow'); c.textContent = d; dow.appendChild(c); });

    const grid = root.querySelector('#cal-month');
    grid.style.gridTemplateRows = `repeat(${Math.ceil(days.length / 7)}, minmax(0, 1fr))`;

    days.forEach(d => {
        const key  = calKey(d);
        const cell = _calCell('cal-mcell'
            + (d.getMonth() !== month ? ' outside' : '')
            + (key === todayKey ? ' today' : '')
            + (key === calSelected ? ' selected' : ''));

        const num = document.createElement('div');
        num.className = 'cal-mnum';
        num.textContent = d.getDate();
        cell.appendChild(num);

        const list = document.createElement('div');
        list.className = 'cal-mlist';
        const evs   = calEventsOn(key).sort((a, b) => (a.allDay ? -1 : 0) - (b.allDay ? -1 : 0) || a.startMin - b.startMin);
        const tds   = calTodosOn(key);
        const items = [...evs.map(e => ({ ev: e })), ...tds.map(t => ({ todo: t }))];
        items.slice(0, 3).forEach(it => {
            list.appendChild(it.ev ? _calMonthItem(it.ev) : _calTodoChip(it.todo));
        });
        if (items.length > 3) {
            const more = document.createElement('div');
            more.className = 'cal-more';
            more.textContent = `+${items.length - 3} more`;
            more.onclick = e => { e.stopPropagation(); calAnchor = new Date(d); calView = 'day'; renderCalPage(); };
            list.appendChild(more);
        }
        cell.appendChild(list);

        cell.onclick    = () => { calSelected = key; renderCalPage(); };
        cell.ondblclick = () => calOpenEditor(_calBlankEvent(key));
        grid.appendChild(cell);
    });
}

function _calMonthItem(ev) {
    const c = document.createElement('div');
    c.className = 'cal-mitem';
    const dot = document.createElement('span');
    dot.className = 'cal-mdot';
    dot.style.background = ev.color || '#3b82f6';
    const t = document.createElement('span');
    t.className = 'cal-mtext';
    t.textContent = (ev.allDay ? '' : calMinLabel(ev.startMin, false) + '  ') + (ev.title || '(no title)');
    c.append(dot, t);
    c.onclick = e => { e.stopPropagation(); calOpenEditor(ev); };
    return c;
}

// ── The red "now" line ───────────────────────────────────────────────────
function _calStartNowTimer() {
    if (_calNowTimer) clearInterval(_calNowTimer);
    _calNowTimer = setInterval(() => {
        const line = document.getElementById('cal-now-line');
        if (!line) return;
        line.style.top = ((calNowMin() / 60) * CAL_HOUR_PX) + 'px';
    }, 60000);
}

// ── Event editor ─────────────────────────────────────────────────────────
// Titles and notes are set with textContent / .value, never interpolated into
// innerHTML, so an event called `<img onerror=…>` stays text.
function calOpenEditor(ev) {
    const isNew = !ev.id;
    const host  = document.getElementById('view-calendar') || document.body;
    const back  = document.createElement('div');
    back.className = 'cal-modal-back';
    back.innerHTML = `
        <div class="cal-modal">
            <div class="cal-modal-head">
                <h3>${isNew ? 'New event' : 'Edit event'}</h3>
                <button data-c="x" class="cal-x"><i class="fas fa-times"></i></button>
            </div>
            <div class="cal-modal-body">
                <input data-c="title" class="cal-input cal-title-input" placeholder="Add a title" maxlength="200">
                <label class="cal-allday-toggle"><input data-c="allday" type="checkbox"> <span>All day</span></label>
                <div class="cal-row">
                    <input data-c="date" type="date" class="cal-input">
                    <input data-c="start" type="time" class="cal-input" step="900">
                    <span class="cal-dash">→</span>
                    <input data-c="end" type="time" class="cal-input" step="900">
                </div>
                <div class="cal-row" data-c="endrow" style="display:none">
                    <span class="cal-sub">Ends</span>
                    <input data-c="enddate" type="date" class="cal-input">
                </div>
                <div class="cal-swatches" data-c="colors"></div>
                <textarea data-c="notes" class="cal-input cal-notes" rows="3" placeholder="Notes"></textarea>
            </div>
            <div class="cal-modal-foot">
                <button data-c="del" class="cal-btn cal-btn-del"${isNew ? ' style="visibility:hidden"' : ''}>Delete</button>
                <div class="cal-foot-right">
                    <button data-c="cancel" class="cal-btn">Cancel</button>
                    <button data-c="save" class="cal-btn cal-btn-save">Save</button>
                </div>
            </div>
        </div>`;
    host.appendChild(back);
    const q = n => back.querySelector(`[data-c="${n}"]`);

    q('title').value    = ev.title || '';
    q('notes').value    = ev.notes || '';
    q('date').value     = ev.date;
    q('enddate').value  = ev.endDate || ev.date;
    q('start').value    = _calMinToTime(ev.startMin);
    q('end').value      = _calMinToTime(ev.endMin);
    q('allday').checked = !!ev.allDay;

    let color = ev.color || CAL_COLORS[5].hex;
    const swatches = q('colors');
    CAL_COLORS.forEach(c => {
        const b = document.createElement('button');
        b.className = 'cal-swatch' + (c.hex === color ? ' on' : '');
        b.style.background = c.hex;
        b.title = c.name;
        b.onclick = () => {
            color = c.hex;
            swatches.querySelectorAll('.cal-swatch').forEach(s => s.classList.remove('on'));
            b.classList.add('on');
        };
        swatches.appendChild(b);
    });

    const syncAllDay = () => {
        const on = q('allday').checked;
        q('start').style.display = on ? 'none' : '';
        q('end').style.display   = on ? 'none' : '';
        back.querySelector('.cal-dash').style.display = on ? 'none' : '';
        q('endrow').style.display = on ? 'flex' : 'none';
    };
    q('allday').onchange = syncAllDay;
    syncAllDay();

    const close = () => { document.removeEventListener('keydown', onKey); back.remove(); };
    const save = () => {
        const allDay = q('allday').checked;
        let startMin = _calTimeToMin(q('start').value);
        let endMin   = _calTimeToMin(q('end').value);
        if (!allDay && endMin <= startMin) endMin = Math.min(CAL_DAY_MIN, startMin + 30);

        const rec = {
            id:       ev.id || calNewId(),
            title:    q('title').value.trim(),
            date:     q('date').value || ev.date,
            endDate:  allDay ? (q('enddate').value || null) : null,
            allDay,
            startMin, endMin,
            color,
            notes:    q('notes').value,
        };
        if (rec.endDate && rec.endDate < rec.date) rec.endDate = rec.date;

        const i = calEvents.findIndex(x => x.id === rec.id);
        if (i === -1) calEvents.push(rec); else calEvents[i] = rec;
        saveCalEvents();
        close();
        renderCalPage();
    };
    const del = () => {
        calEvents = calEvents.filter(x => x.id !== ev.id);
        saveCalEvents();
        close();
        renderCalPage();
    };
    function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); close(); }
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); }
    }

    q('save').onclick   = save;
    q('cancel').onclick = close;
    q('x').onclick      = close;
    q('del').onclick    = del;
    back.onclick = e => { if (e.target === back) close(); };
    document.addEventListener('keydown', onKey);
    setTimeout(() => q('title').focus(), 30);
}

// ── Navigation ───────────────────────────────────────────────────────────
function calStep(dir) {
    if (calView === 'day')        calAnchor = calAddDays(calAnchor, dir);
    else if (calView === 'week')  calAnchor = calAddDays(calAnchor, dir * 7);
    else calAnchor = new Date(calAnchor.getFullYear(), calAnchor.getMonth() + dir, 1);
    renderCalPage();
}
function calSetView(v) { calView = v; renderCalPage(); }
function calGoToday()  { calAnchor = new Date(); calSelected = calKey(calAnchor); renderCalPage(); }

// ── Init ─────────────────────────────────────────────────────────────────
function initCalendarPage() {
    calEvents = loadCalEvents();

    document.getElementById('cal-prev')?.addEventListener('click', () => calStep(-1));
    document.getElementById('cal-next')?.addEventListener('click', () => calStep(1));
    document.getElementById('cal-today-btn')?.addEventListener('click', calGoToday);
    document.getElementById('cal-new-btn')?.addEventListener('click',
        () => calOpenEditor(_calBlankEvent(calKey(calView === 'month' && calSelected ? calParse(calSelected) : calAnchor))));
    document.querySelectorAll('.cal-view-btn').forEach(b => {
        b.addEventListener('click', () => calSetView(b.dataset.view));
    });

    // Google's own shortcuts: D / W / M switch view, T jumps to today,
    // arrows step through time. Ignored while typing.
    document.addEventListener('keydown', e => {
        const view = document.getElementById('view-calendar');
        if (!view || view.style.display === 'none' || !view.offsetParent) return;
        if (/^(INPUT|TEXTAREA|SELECT)$/.test((e.target.tagName || '')) || e.target.isContentEditable) return;
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        const k = e.key.toLowerCase();
        if (k === 'd') calSetView('day');
        else if (k === 'w') calSetView('week');
        else if (k === 'm') calSetView('month');
        else if (k === 't') calGoToday();
        else if (e.key === 'ArrowLeft')  calStep(-1);
        else if (e.key === 'ArrowRight') calStep(1);
        else return;
        e.preventDefault();
    });
}
