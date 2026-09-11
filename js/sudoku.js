// ══════════════════════════════════════════════════════════════
//  Sudoku  — generate, play, check, solve. Self-contained module.
// ══════════════════════════════════════════════════════════════

const SUDOKU_FILE = path.join(DOCUMENTS_PATH, 'sudoku.json');

let _sdkSolution = null;   // Int[81] full solution
let _sdkGiven    = null;   // Int[81] givens (0 = blank)
let _sdkCells    = null;   // Int[81] current entries (0 = blank)
let _sdkNotes    = null;   // Array[81] of Set-like {n:true}
let _sdkSel      = -1;     // selected index
let _sdkNoteMode = false;
let _sdkDiff     = 'medium';
let _sdkMistakes = 0;
let _sdkStart    = 0;      // timestamp
let _sdkTimer    = null;
let _sdkDone     = false;

const SDK_DIFF = { easy: 44, medium: 34, hard: 28, expert: 24 }; // givens count

function _sdkDefaultStats() {
    return {
        completed: 0, played: 0,
        byDiff: {
            easy:   { played: 0, solved: 0, best: null },
            medium: { played: 0, solved: 0, best: null },
            hard:   { played: 0, solved: 0, best: null },
            expert: { played: 0, solved: 0, best: null },
        },
    };
}
let _sdkStats = _sdkDefaultStats();

// ── Generation ─────────────────────────────────────────────────
function _sdkShuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[a[i], a[j]] = [a[j], a[i]]; } return a; }

function _sdkValid(b, idx, val) {
    const r = Math.floor(idx / 9), c = idx % 9;
    for (let i = 0; i < 9; i++) {
        if (b[r * 9 + i] === val) return false;
        if (b[i * 9 + c] === val) return false;
    }
    const br = Math.floor(r / 3) * 3, bc = Math.floor(c / 3) * 3;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) if (b[(br + i) * 9 + (bc + j)] === val) return false;
    return true;
}

function _sdkSolve(b) {
    const idx = b.indexOf(0);
    if (idx === -1) return true;
    const nums = _sdkShuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    for (const n of nums) {
        if (_sdkValid(b, idx, n)) {
            b[idx] = n;
            if (_sdkSolve(b)) return true;
            b[idx] = 0;
        }
    }
    return false;
}

function _sdkNewGame(diff) {
    _sdkDiff = diff || _sdkDiff;
    const sol = new Array(81).fill(0);
    _sdkSolve(sol);
    _sdkSolution = sol.slice();
    const given = sol.slice();
    // remove cells down to target given count
    const target = SDK_DIFF[_sdkDiff] || 34;
    const order = _sdkShuffle([...Array(81).keys()]);
    let remaining = 81;
    for (const idx of order) {
        if (remaining <= target) break;
        given[idx] = 0;
        remaining--;
    }
    _sdkGiven = given;
    _sdkCells = given.slice();
    _sdkNotes = Array.from({ length: 81 }, () => ({}));
    _sdkSel = -1; _sdkMistakes = 0; _sdkDone = false;
    _sdkNoteMode = false;          // always start in normal (big-number) mode
    _sdkStart = Date.now();
    // stats: a game was started
    _sdkStats.played++;
    if (_sdkStats.byDiff[_sdkDiff]) _sdkStats.byDiff[_sdkDiff].played++;
    _sdkSave();
    _sdkRenderAll();
    _sdkStartTimer();
}

// ── Persistence ────────────────────────────────────────────────
function _sdkSave() {
    try {
        writeJsonSafe(SUDOKU_FILE, {
            solution: _sdkSolution, given: _sdkGiven, cells: _sdkCells, notes: _sdkNotes,
            diff: _sdkDiff, mistakes: _sdkMistakes, start: _sdkStart, done: _sdkDone,
            stats: _sdkStats,
        });
    } catch (_) {}
}
function _sdkLoad() {
    try {
        if (fs.existsSync(SUDOKU_FILE)) {
            const d = readJsonStrict(SUDOKU_FILE);
            if (d.stats && d.stats.byDiff) _sdkStats = d.stats;   // stats persist across games
            if (d.solution && d.cells) {
                _sdkSolution = d.solution; _sdkGiven = d.given; _sdkCells = d.cells;
                _sdkNotes = d.notes || Array.from({ length: 81 }, () => ({}));
                _sdkDiff = d.diff || 'medium'; _sdkMistakes = d.mistakes || 0;
                _sdkStart = d.start || Date.now(); _sdkDone = !!d.done;
                return true;
            }
        }
    } catch (_) {}
    return false;
}

// ── Timer ──────────────────────────────────────────────────────
function _sdkStartTimer() {
    clearInterval(_sdkTimer);
    if (_sdkDone) return;
    _sdkTimer = setInterval(() => {
        const el = document.getElementById('sdk-timer');
        if (!el) return;
        const s = Math.floor((Date.now() - _sdkStart) / 1000);
        el.textContent = `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
    }, 500);
}

// ── Input ──────────────────────────────────────────────────────
function sdkSelect(idx) {
    if (_sdkGiven && _sdkGiven[idx] !== 0) { _sdkSel = idx; _sdkRenderBoard(); return; } // can highlight givens
    _sdkSel = idx;
    _sdkRenderBoard();
}

function sdkEnter(n) {
    if (_sdkSel < 0 || _sdkDone) return;
    if (_sdkGiven[_sdkSel] !== 0) return;          // can't change a given
    if (_sdkNoteMode && n !== 0) {
        const notes = _sdkNotes[_sdkSel];
        notes[n] = !notes[n];
        _sdkCells[_sdkSel] = 0;
    } else {
        if (n === 0) { _sdkCells[_sdkSel] = 0; }
        else {
            _sdkCells[_sdkSel] = n;
            _sdkNotes[_sdkSel] = {};
            if (_sdkSolution[_sdkSel] !== n) {
                _sdkMistakes++;
                const m = document.getElementById('sdk-mistakes');
                if (m) m.textContent = _sdkMistakes;
            }
        }
    }
    _sdkSave();
    _sdkRenderBoard();
    _sdkCheckWin();
}

function sdkToggleNotes() {
    _sdkNoteMode = !_sdkNoteMode;
    _sdkUpdateNotesBtn();
}

function _sdkUpdateNotesBtn() {
    const b = document.getElementById('sdk-notes-btn');
    if (!b) return;
    b.classList.toggle('bg-cyan-600', _sdkNoteMode);
    b.classList.toggle('text-white', _sdkNoteMode);
    b.classList.toggle('bg-white', !_sdkNoteMode);
    b.innerHTML = `<i class="fas fa-pencil mr-1.5"></i>${_sdkNoteMode ? 'Notes: ON' : 'Notes'}`;
}

function sdkHint() {
    if (_sdkDone) return;
    // fill the selected empty cell, or the first empty cell, with the solution
    let idx = (_sdkSel >= 0 && _sdkCells[_sdkSel] === 0) ? _sdkSel : _sdkCells.indexOf(0);
    if (idx === -1) return;
    _sdkCells[idx] = _sdkSolution[idx];
    _sdkGiven[idx] = _sdkSolution[idx];  // lock it as correct
    _sdkNotes[idx] = {};
    _sdkSel = idx;
    _sdkSave();
    _sdkRenderBoard();
    _sdkCheckWin();
}

function sdkSolve() {
    if (!_sdkSolution) return;
    _sdkCells = _sdkSolution.slice();
    _sdkDone = true;
    clearInterval(_sdkTimer);
    _sdkSave();
    _sdkRenderBoard();
}

function _sdkCheckWin() {
    if (_sdkCells.some(v => v === 0)) return;
    for (let i = 0; i < 81; i++) if (_sdkCells[i] !== _sdkSolution[i]) return;
    _sdkDone = true;
    clearInterval(_sdkTimer);
    const secs = Math.floor((Date.now() - _sdkStart) / 1000);
    // stats: record the win + best time
    _sdkStats.completed++;
    const bd = _sdkStats.byDiff[_sdkDiff];
    if (bd) { bd.solved++; if (bd.best == null || secs < bd.best) bd.best = secs; }
    _sdkSave();
    _sdkRenderStats();
    setTimeout(() => {
        _sdkBanner(`Solved in ${Math.floor(secs / 60)}:${(secs % 60).toString().padStart(2, '0')} · ${_sdkMistakes} mistake${_sdkMistakes === 1 ? '' : 's'}`);
    }, 100);
}

function _sdkBanner(text) {
    const el = document.getElementById('sdk-banner');
    if (!el) return;
    el.textContent = '🎉 ' + text;
    el.style.display = 'block';
}

// ── Rendering ──────────────────────────────────────────────────
function _sdkRenderAll() {
    const b = document.getElementById('sdk-banner'); if (b) b.style.display = 'none';
    const md = document.getElementById('sdk-diff'); if (md) md.textContent = _sdkDiff;
    const mm = document.getElementById('sdk-mistakes'); if (mm) mm.textContent = _sdkMistakes;
    _sdkUpdateNotesBtn();
    _sdkRenderBoard();
    _sdkRenderStats();
}

function _sdkRenderStats() {
    const el = document.getElementById('sdk-stats');
    if (!el) return;
    const s = _sdkStats;
    const fmt = (t) => t == null ? '—' : `${Math.floor(t / 60)}:${(t % 60).toString().padStart(2, '0')}`;
    const row = (label, key) => `<div style="display:flex; justify-content:space-between; padding:5px 0; border-top:1px solid #e2e8f0">
        <span class="text-slate-500 capitalize">${label}</span>
        <span class="text-slate-700">${s.byDiff[key].solved} solved / ${s.byDiff[key].played} · best ${fmt(s.byDiff[key].best)}</span>
    </div>`;
    el.innerHTML = `
        <p class="text-slate-500 text-[10px] uppercase tracking-widest font-semibold mb-2">Your stats</p>
        <div style="display:flex; gap:10px; margin-bottom:10px">
            <div style="flex:1; background:#ffffff; border:1px solid #cbd5e1; border-radius:12px; padding:12px; text-align:center">
                <div class="text-2xl font-bold text-teal-600">${s.completed}</div>
                <div class="text-[11px] text-slate-500 uppercase tracking-wide">Completed</div>
            </div>
            <div style="flex:1; background:#ffffff; border:1px solid #cbd5e1; border-radius:12px; padding:12px; text-align:center">
                <div class="text-2xl font-bold text-slate-800">${s.played}</div>
                <div class="text-[11px] text-slate-500 uppercase tracking-wide">Started</div>
            </div>
        </div>
        <div style="background:#ffffff; border:1px solid #cbd5e1; border-radius:12px; padding:6px 14px 10px; font-size:12px">
            ${row('Easy', 'easy')}${row('Medium', 'medium')}${row('Hard', 'hard')}${row('Expert', 'expert')}
        </div>`;
}

function _sdkRenderBoard() {
    const grid = document.getElementById('sudoku-grid');
    if (!grid || !_sdkCells) return;
    const selVal = _sdkSel >= 0 ? _sdkCells[_sdkSel] : 0;
    const selR = _sdkSel >= 0 ? Math.floor(_sdkSel / 9) : -1;
    const selC = _sdkSel >= 0 ? _sdkSel % 9 : -1;

    let html = '';
    for (let i = 0; i < 81; i++) {
        const r = Math.floor(i / 9), c = i % 9;
        const v = _sdkCells[i];
        const given = _sdkGiven[i] !== 0;
        const wrong = v !== 0 && !given && v !== _sdkSolution[i];

        // borders for 3x3 boxes — dark lines on white "paper"
        let bd = 'border:1px solid #d4d9e0;';
        if (c % 3 === 0) bd += 'border-left:2px solid #334155;';
        if (r % 3 === 0) bd += 'border-top:2px solid #334155;';
        if (c === 8) bd += 'border-right:2px solid #334155;';
        if (r === 8) bd += 'border-bottom:2px solid #334155;';

        let bg = '#ffffff';
        if (_sdkSel === i) bg = '#bae6fd';
        else if (selR === r || selC === c || (Math.floor(selR / 3) === Math.floor(r / 3) && Math.floor(selC / 3) === Math.floor(c / 3))) bg = '#eef2f7';
        if (v !== 0 && v === selVal && _sdkSel !== i) bg = '#dbeafe';

        let color = given ? '#1e293b' : '#2563eb';
        if (wrong) color = '#dc2626';

        let inner = '';
        if (v !== 0) {
            inner = `<span style="font-size:30px; line-height:1; font-weight:${given ? 700 : 600}; color:${color}">${v}</span>`;
        } else {
            const notes = _sdkNotes[i] || {};
            if (Object.keys(notes).length) {
                inner = '<div style="display:grid; grid-template-columns:repeat(3,1fr); width:100%; height:100%; padding:2px">';
                for (let n = 1; n <= 9; n++) inner += `<span style="font-size:10px; color:#94a3b8; display:flex; align-items:center; justify-content:center">${notes[n] ? n : ''}</span>`;
                inner += '</div>';
            }
        }

        html += `<div onclick="sdkSelect(${i})" style="${bd} background:${bg}; min-width:0; display:flex; align-items:center; justify-content:center; cursor:pointer; user-select:none; transition:background .08s">${inner}</div>`;
    }
    grid.innerHTML = html;

    // number pad counts (how many of each placed)
    for (let n = 1; n <= 9; n++) {
        const cnt = _sdkCells.filter(v => v === n).length;
        const el = document.getElementById('sdk-pad-' + n);
        if (el) el.style.opacity = cnt >= 9 ? '0.3' : '1';
    }
}

// ── Keyboard ───────────────────────────────────────────────────
function _sdkKeydown(e) {
    const view = document.getElementById('view-sudoku');
    if (!view || !view.classList.contains('active')) return;
    if (e.key >= '1' && e.key <= '9') { sdkEnter(parseInt(e.key, 10)); }
    else if (e.key === '0' || e.key === 'Backspace' || e.key === 'Delete') { sdkEnter(0); }
    else if (e.key === 'n' || e.key === 'N') { sdkToggleNotes(); }
    else if (_sdkSel >= 0 && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        let r = Math.floor(_sdkSel / 9), c = _sdkSel % 9;
        if (e.key === 'ArrowUp') r = (r + 8) % 9;
        if (e.key === 'ArrowDown') r = (r + 1) % 9;
        if (e.key === 'ArrowLeft') c = (c + 8) % 9;
        if (e.key === 'ArrowRight') c = (c + 1) % 9;
        _sdkSel = r * 9 + c; _sdkRenderBoard(); e.preventDefault();
    }
}

// ── Lifecycle ──────────────────────────────────────────────────
function initSudoku() {
    if (!_sdkLoad()) _sdkNewGame('medium');
    document.addEventListener('keydown', _sdkKeydown);
}

function renderSudoku() {
    if (!_sdkCells) { if (!_sdkLoad()) _sdkNewGame('medium'); }
    _sdkRenderAll();
    _sdkStartTimer();
}

// expose for inline handlers
window.sdkSelect = sdkSelect;
window.sdkEnter = sdkEnter;
window.sdkToggleNotes = sdkToggleNotes;
window.sdkHint = sdkHint;
window.sdkSolve = sdkSolve;
window.sdkNewGame = _sdkNewGame;
