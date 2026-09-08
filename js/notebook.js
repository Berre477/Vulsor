// ── Vulsor Notebook — Jupyter-style notebook for .vnb files ──────────
// Depends on: globals.js (fs, path, exec, os), vault.js (vaultData, etc.)

// ── State ─────────────────────────────────────────────────────────────
// NOTE: vaultIsNotebook is declared in vault.js — do NOT redeclare here
let notebookFilePath   = null;
let notebookCells      = [];     // [{id, type:'code'|'markdown', source, outputs, lang}]
let notebookLang       = 'python';
let notebookRunCount   = {};     // cellId → execution number shown in gutter
let notebookRunning    = null;   // currently running child process
let notebookSaveTimer  = null;
let notebookAceEditors = {};     // cellId → Ace editor instance

// ── Notebook terminal state ───────────────────────────────────────────
let vnbTerm        = null;   // xterm Terminal instance
let vnbFitAddon    = null;
let vnbTermOpen    = false;
let vnbTermCwd     = os.homedir();
let vnbTermProc    = null;
let vnbTermRunning = false;
let vnbTermLine    = '';
let vnbTermHistory = [];
let vnbTermHistIdx = -1;

// Ace mode for each supported notebook language
const NB_ACE_MODES = {
    python: 'python', javascript: 'javascript', typescript: 'typescript',
    ruby: 'ruby', go: 'golang', shell: 'sh', r: 'r',
};

// ── Language execution config ─────────────────────────────────────────
const NOTEBOOK_LANG_CMDS = {
    python:     p => ({ cmd: 'python3', args: [p] }),
    javascript: p => ({ cmd: 'node',    args: [p] }),
    typescript: p => ({ cmd: 'npx',     args: ['ts-node', '--skip-project', p] }),
    ruby:       p => ({ cmd: 'ruby',    args: [p] }),
    go:         p => ({ cmd: 'go',      args: ['run', p] }),
    shell:      p => ({ cmd: 'bash',    args: [p] }),
    r:          p => ({ cmd: 'Rscript', args: [p] }),
};

const NOTEBOOK_LANG_EXT = {
    python: '.py', javascript: '.js', typescript: '.ts',
    ruby: '.rb', go: '.go', shell: '.sh', r: '.r',
};

// Augmented PATH so binaries are found even from a sandboxed macOS app bundle
function _nbEnv() {
    const extras  = [
        '/usr/local/bin', '/usr/bin', '/bin',
        '/opt/homebrew/bin', '/opt/homebrew/sbin',
        '/usr/local/sbin', '/usr/sbin', '/sbin',
    ];
    const current = (process.env.PATH || '').split(':').filter(Boolean);
    const seen    = new Set();
    const merged  = [...extras, ...current].filter(p => {
        if (seen.has(p)) return false;
        seen.add(p); return true;
    });
    return Object.assign({}, process.env, { PATH: merged.join(':') });
}

// ── Helpers ───────────────────────────────────────────────────────────
function nbGenId() {
    return 'nb_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
}

function nbEscape(str) {
    return (str || '')
        .replace(/&/g,'&amp;').replace(/</g,'&lt;')
        .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Ace editor helpers ────────────────────────────────────────────────

/** Destroy all Ace instances (called before clearing the cells container). */
function _nbDestroyAceEditors() {
    Object.values(notebookAceEditors).forEach(ed => {
        try { ed.destroy(); } catch(_) {}
    });
    notebookAceEditors = {};
}

/** Initialise one Ace editor for a code cell (called after DOM is ready). */
function _nbInitCellAce(cell) {
    const el = document.getElementById(`vnb-ace-${cell.id}`);
    if (!el) return;
    // Ace loads on first use rather than at startup — come back once it is here,
    // as long as this cell is still on screen.
    if (typeof ace === 'undefined') {
        if (typeof vulsorLoadAce !== 'function') return;
        vulsorLoadAce()
            .then(() => { if (document.getElementById(`vnb-ace-${cell.id}`)) _nbInitCellAce(cell); })
            .catch(e => console.error('[notebook] Ace failed to load:', e));
        return;
    }

    const theme = localStorage.getItem('vulsor_code_theme') || 'monokai';
    const mode  = NB_ACE_MODES[cell.lang || notebookLang] || 'python';

    ace.config.set('useWorker', false);
    const editor = ace.edit(el);
    editor.setOptions({
        theme:                     `ace/theme/${theme}`,
        mode:                      `ace/mode/${mode}`,
        fontSize:                  '13px',
        showPrintMargin:           false,
        showGutter:                true,
        highlightActiveLine:       true,
        enableBasicAutocompletion: true,
        enableLiveAutocompletion:  true,
        enableSnippets:            true,
        maxLines:                  Infinity,
        minLines:                  3,
        tabSize:                   4,
        useSoftTabs:               true,
        wrap:                      false,
        scrollPastEnd:             0,
    });
    // Suppress the "use strict" warning Ace emits in dev
    editor.$blockScrolling = Infinity;
    editor.setValue(cell.source || '', -1);

    // Shift+Enter → run this cell
    editor.commands.addCommand({
        name: 'nbRunCell',
        bindKey: { win: 'Shift-Enter', mac: 'Shift-Enter' },
        exec: () => notebookRunCell(cell.id),
    });

    // Keep cell.source in sync + trigger auto-save
    editor.session.on('change', () => {
        cell.source = editor.getValue();
        notebookAutoSave();
    });

    notebookAceEditors[cell.id] = editor;
    // Let the browser settle, then tell Ace to measure itself
    setTimeout(() => { try { editor.resize(); } catch(_) {} }, 20);
}

/** Pull the latest source text out of every editor (code=Ace, md=textarea). */
function _nbHarvestSources() {
    notebookCells.forEach(cell => {
        const ed = notebookAceEditors[cell.id];
        if (ed) {
            cell.source = ed.getValue();
        } else {
            const ta = document.getElementById(`vnb-source-${cell.id}`);
            if (ta) cell.source = ta.value;
        }
    });
}

// ── Persist ───────────────────────────────────────────────────────────
function notebookSave() {
    if (!notebookFilePath) return;
    _nbHarvestSources();
    const data = {
        cells:    notebookCells,
        metadata: { language: notebookLang, updatedAt: Date.now() }
    };
    try {
        fs.writeFileSync(notebookFilePath, JSON.stringify(data, null, 2));
    } catch(e) { console.error('Notebook save error:', e); }
}

function notebookAutoSave() {
    clearTimeout(notebookSaveTimer);
    notebookSaveTimer = setTimeout(notebookSave, 800);
}

/** Save the editable notebook name from the title input. */
function notebookSaveTitle() {
    if (!vaultOpenFileId) return;
    const file = vaultData.files.find(f => f.id === vaultOpenFileId);
    if (!file) return;
    const input = document.getElementById('vault-doc-title-input');
    if (!input) return;
    const val = input.value.trim();
    file.originalName = val || 'New Notebook';
    saveVaultData();
    renderVaultGrid();
    renderVaultFolders();
}

// ── Create ────────────────────────────────────────────────────────────
function createNotebookFile() {
    const id         = 'vf_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    const storedName = id + '.vnb';
    const initial    = {
        cells: [{ id: nbGenId(), type: 'code', source: '', outputs: [], lang: 'python' }],
        metadata: { language: 'python', created: Date.now() }
    };
    fs.writeFileSync(path.join(VAULT_DIR, storedName), JSON.stringify(initial, null, 2));
    vaultData.files.unshift({
        id, originalName: 'New Notebook', storedName,
        folderId: vaultActiveFolderId,
        notes: '', pageNotes: {}, addedAt: Date.now(), size: 0,
        isNotebook: true,
    });
    saveVaultData();
    renderVaultFolders();
    renderVaultGrid();
    openVaultFile(id);
}

// ── Open ──────────────────────────────────────────────────────────────
function openNotebookEditor(file, storedPath) {
    notebookFilePath = storedPath;

    // Load JSON data
    let data = { cells: [], metadata: { language: 'python' } };
    try { data = JSON.parse(fs.readFileSync(storedPath, 'utf8')); } catch(_) {}

    notebookLang     = (data.metadata && data.metadata.language) || 'python';
    notebookCells    = data.cells || [];
    notebookRunCount = {};

    // Guarantee at least one cell
    if (!notebookCells.length)
        notebookCells.push({ id: nbGenId(), type: 'code', source: '', outputs: [], lang: notebookLang });

    // Normalise every cell
    notebookCells.forEach(c => {
        if (!c.id)        c.id      = nbGenId();
        if (!c.type)      c.type    = 'code';
        if (c.source == null) c.source = '';
        if (!c.outputs)   c.outputs = [];
        if (!c.lang)      c.lang    = notebookLang;
    });

    // Hide all other content areas
    document.getElementById('vault-normal-view').style.display        = 'none';
    document.getElementById('vault-doc-editor-area').style.display    = 'none';
    document.getElementById('vault-doc-toolbar-row').style.display    = 'none';
    document.getElementById('vault-doc-footer').style.display         = 'none';
    document.getElementById('vault-code-area').style.display          = 'none';
    document.getElementById('vault-code-toolbar-row').style.display   = 'none';

    // Show notebook UI
    document.getElementById('vault-notebook-toolbar-row').style.display = '';
    document.getElementById('vault-notebook-area').style.display         = '';

    // Switch static title span → editable input (same pattern as .vulsor docs)
    document.getElementById('vault-viewer-title').classList.add('hidden');
    const titleInput = document.getElementById('vault-doc-title-input');
    titleInput.classList.remove('hidden');
    titleInput.placeholder = 'Notebook name';
    titleInput.value       = file.originalName;

    // Sync toolbar language selector
    const langSel = document.getElementById('vnb-lang-select');
    if (langSel) langSel.value = notebookLang;

    notebookRenderAll();
}

// ── Close ─────────────────────────────────────────────────────────────
function closeNotebookEditor() {
    clearTimeout(notebookSaveTimer);
    notebookSaveTitle();   // persist any unsaved name change
    _nbHarvestSources();
    notebookSave();
    _nbDestroyAceEditors();

    vaultIsNotebook  = false;
    notebookFilePath = null;
    notebookCells    = [];
    notebookRunCount = {};

    if (notebookRunning) {
        try { notebookRunning.kill(); } catch(_) {}
        notebookRunning = null;
    }

    // Kill any running terminal process
    if (vnbTermProc) { try { vnbTermProc.kill(); } catch(_) {} vnbTermProc = null; }
    if (vnbTerm)     { try { vnbTerm.dispose(); } catch(_) {}  vnbTerm = null; vnbFitAddon = null; }
    vnbTermOpen = false; vnbTermLine = ''; vnbTermRunning = false;

    document.getElementById('vault-notebook-toolbar-row').style.display = 'none';
    document.getElementById('vault-notebook-area').style.display         = 'none';
    document.getElementById('vnb-term-wrap').style.display               = 'none';
    document.getElementById('vault-normal-view').style.display           = '';

    // Restore static title span
    document.getElementById('vault-viewer-title').classList.remove('hidden');
    document.getElementById('vault-doc-title-input').classList.add('hidden');
}

// ── Render all cells ──────────────────────────────────────────────────
function notebookRenderAll() {
    _nbDestroyAceEditors();
    const container = document.getElementById('vault-notebook-cells');
    if (!container) return;
    container.innerHTML = '';
    notebookCells.forEach(cell => container.appendChild(nbMakeCellEl(cell)));
    // Init Ace editors only after all elements are in the DOM
    notebookCells.forEach(cell => {
        if (cell.type === 'code') _nbInitCellAce(cell);
    });
}

// ── Build one cell element ────────────────────────────────────────────
function nbMakeCellEl(cell) {
    const div = document.createElement('div');
    div.className = 'vnb-cell ' + (cell.type === 'markdown' ? 'vnb-cell-md' : 'vnb-cell-code');
    div.id = `vnb-cell-${cell.id}`;
    div.dataset.cellId = cell.id;

    const runNum   = notebookRunCount[cell.id] || '';
    const srcLines = Math.max(cell.type === 'markdown' ? 2 : 3, (cell.source || '').split('\n').length);

    div.innerHTML = `
      <div class="vnb-left">
        ${cell.type === 'code' ? `
          <span class="vnb-counter" id="vnb-counter-${cell.id}">[${runNum || '&nbsp;'}]</span>
          <button class="vnb-run-cell-btn" data-id="${cell.id}" title="Run cell (Shift+Enter)">
            <i class="fas fa-play" style="margin-left:1px"></i>
          </button>
        ` : `
          <span class="vnb-md-badge">M↓</span>
        `}
      </div>
      <div class="vnb-main">
        ${cell.type === 'code'
          ? `<div class="vnb-ace-wrap" id="vnb-ace-${cell.id}"></div>`
          : `<div class="vnb-md-wrap">
               <textarea class="vnb-md-ta" id="vnb-source-${cell.id}"
                 rows="${srcLines}" placeholder="Write Markdown here…">${nbEscape(cell.source)}</textarea>
               <div class="vnb-md-preview" id="vnb-preview-${cell.id}">${nbRenderMarkdown(cell.source)}</div>
             </div>`
        }
        <div class="vnb-outputs" id="vnb-outputs-${cell.id}">${nbOutputsHTML(cell.outputs)}</div>
      </div>
      <div class="vnb-actions">
        <button class="vnb-action-btn vnb-move-up"   data-id="${cell.id}" title="Move up">↑</button>
        <button class="vnb-action-btn vnb-move-down" data-id="${cell.id}" title="Move down">↓</button>
        <button class="vnb-action-btn vnb-add-code"  data-id="${cell.id}" title="Add code cell below">+C</button>
        <button class="vnb-action-btn vnb-add-md"    data-id="${cell.id}" title="Add markdown cell below">+M</button>
        <button class="vnb-action-btn vnb-del-cell"  data-id="${cell.id}" title="Delete cell">✕</button>
      </div>
    `;

    // Wire markdown-cell textarea (code cells are handled inside Ace after init)
    if (cell.type === 'markdown') {
        const ta = div.querySelector(`#vnb-source-${cell.id}`);
        if (ta) {
            ta.addEventListener('input', () => {
                cell.source = ta.value;
                ta.rows = Math.max(2, ta.value.split('\n').length);
                notebookAutoSave();
                const prev = document.getElementById(`vnb-preview-${cell.id}`);
                if (prev) prev.innerHTML = nbRenderMarkdown(cell.source);
            });
            ta.addEventListener('keydown', e => {
                if (e.key === 'Tab') {
                    e.preventDefault();
                    const s = ta.selectionStart, end = ta.selectionEnd;
                    ta.value = ta.value.substring(0, s) + '    ' + ta.value.substring(end);
                    ta.selectionStart = ta.selectionEnd = s + 4;
                    cell.source = ta.value;
                }
            });
        }
    }

    // Wire action buttons
    div.querySelector('.vnb-run-cell-btn')?.addEventListener('click', () => notebookRunCell(cell.id));
    div.querySelector('.vnb-move-up')?.addEventListener('click',      () => notebookMoveCell(cell.id, 'up'));
    div.querySelector('.vnb-move-down')?.addEventListener('click',    () => notebookMoveCell(cell.id, 'down'));
    div.querySelector('.vnb-add-code')?.addEventListener('click',     () => notebookAddCell('code',     cell.id));
    div.querySelector('.vnb-add-md')?.addEventListener('click',       () => notebookAddCell('markdown', cell.id));
    div.querySelector('.vnb-del-cell')?.addEventListener('click',     () => notebookDeleteCell(cell.id));

    return div;
}

// ── Outputs HTML ──────────────────────────────────────────────────────
function nbOutputsHTML(outputs) {
    if (!outputs || !outputs.length) return '';
    return outputs.map(o => {
        const t = nbEscape(o.text || '');
        if (o.type === 'stdout') return `<pre class="vnb-out-stdout">${t}</pre>`;
        if (o.type === 'stderr') return `<pre class="vnb-out-stderr">${t}</pre>`;
        if (o.type === 'error')  return `<pre class="vnb-out-error">${t}</pre>`;
        if (o.type === 'result') return `<div class="vnb-out-result">${t}</div>`;
        return '';
    }).join('');
}

// ── Run one cell ──────────────────────────────────────────────────────
function notebookRunCell(cellId) {
    const cell = notebookCells.find(c => c.id === cellId);
    if (!cell || cell.type !== 'code') return;

    // Harvest latest source from Ace
    const ed = notebookAceEditors[cellId];
    if (ed) cell.source = ed.getValue();
    if (!cell.source.trim()) return;

    // Show spinner
    cell.outputs = [];
    const outEl = document.getElementById(`vnb-outputs-${cellId}`);
    if (outEl) outEl.innerHTML = `<div class="vnb-running"><i class="fas fa-circle-notch fa-spin"></i> Running…</div>`;

    // Bump run counter
    const count = (notebookRunCount[cellId] || 0) + 1;
    notebookRunCount[cellId] = count;
    const ctrEl = document.getElementById(`vnb-counter-${cellId}`);
    if (ctrEl) ctrEl.textContent = `[${count}]`;

    const lang    = cell.lang || notebookLang;
    const cmdInfo = NOTEBOOK_LANG_CMDS[lang];
    if (!cmdInfo) {
        _nbSetOutput(cellId, [{ type: 'error', text: `Language "${lang}" is not supported for execution.` }]);
        return;
    }

    // Write source to a temp file
    const ext     = NOTEBOOK_LANG_EXT[lang] || '.txt';
    const tmpPath = path.join(os.tmpdir(), `vulsor_nb_${cellId.replace(/[^a-z0-9_]/gi,'_')}${ext}`);
    try { fs.writeFileSync(tmpPath, cell.source); }
    catch(e) { _nbSetOutput(cellId, [{ type: 'error', text: `Could not write temp file: ${e.message}` }]); return; }

    const { cmd, args }  = cmdInfo(tmpPath);
    const { spawn }      = require('child_process');
    const cwd            = notebookFilePath ? path.dirname(notebookFilePath) : os.tmpdir();
    const proc           = spawn(cmd, args, { cwd, env: _nbEnv() });
    notebookRunning      = proc;

    let stdout = '', stderr = '';
    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => { stderr += d.toString(); });

    proc.on('close', code => {
        notebookRunning = null;
        const outputs = [];
        if (stdout) outputs.push({ type: 'stdout', text: stdout });
        if (stderr) outputs.push({ type: code !== 0 ? 'stderr' : 'stderr', text: stderr });
        if (!outputs.length) outputs.push({ type: 'result', text: `✓ Done  (exit ${code})` });
        _nbSetOutput(cellId, outputs);
        notebookSave();
    });

    proc.on('error', err => {
        notebookRunning = null;
        _nbSetOutput(cellId, [{
            type: 'error',
            text: `Failed to start "${cmd}": ${err.message}\n\nMake sure ${lang} is installed and on your PATH.\nPATH used: ${_nbEnv().PATH}`
        }]);
    });
}

function _nbSetOutput(cellId, outputs) {
    const cell = notebookCells.find(c => c.id === cellId);
    if (cell) cell.outputs = outputs;
    const outEl = document.getElementById(`vnb-outputs-${cellId}`);
    if (outEl) outEl.innerHTML = nbOutputsHTML(outputs);
}

// ── Run all cells ─────────────────────────────────────────────────────
async function notebookRunAll() {
    const btn = document.getElementById('vnb-run-all-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Running…'; }

    for (const cell of notebookCells.filter(c => c.type === 'code')) {
        const ed = notebookAceEditors[cell.id];
        if (ed) cell.source = ed.getValue();
        if (!cell.source.trim()) continue;

        await new Promise(resolve => {
            cell.outputs = [];
            const outEl = document.getElementById(`vnb-outputs-${cell.id}`);
            if (outEl) outEl.innerHTML = `<div class="vnb-running"><i class="fas fa-circle-notch fa-spin"></i> Running…</div>`;

            const count = (notebookRunCount[cell.id] || 0) + 1;
            notebookRunCount[cell.id] = count;
            const ctrEl = document.getElementById(`vnb-counter-${cell.id}`);
            if (ctrEl) ctrEl.textContent = `[${count}]`;

            const lang    = cell.lang || notebookLang;
            const cmdInfo = NOTEBOOK_LANG_CMDS[lang];
            if (!cmdInfo) { _nbSetOutput(cell.id, [{ type: 'error', text: `Language "${lang}" not supported.` }]); resolve(); return; }

            const ext     = NOTEBOOK_LANG_EXT[lang] || '.txt';
            const tmpPath = path.join(os.tmpdir(), `vulsor_nb_${cell.id.replace(/[^a-z0-9_]/gi,'_')}${ext}`);
            try { fs.writeFileSync(tmpPath, cell.source); }
            catch(e) { _nbSetOutput(cell.id, [{ type: 'error', text: e.message }]); resolve(); return; }

            const { cmd, args } = cmdInfo(tmpPath);
            const { spawn }     = require('child_process');
            const cwd           = notebookFilePath ? path.dirname(notebookFilePath) : os.tmpdir();
            const proc          = spawn(cmd, args, { cwd, env: _nbEnv() });

            let stdout = '', stderr = '';
            proc.stdout.on('data', d => { stdout += d.toString(); });
            proc.stderr.on('data', d => { stderr += d.toString(); });
            proc.on('close', code => {
                const outputs = [];
                if (stdout) outputs.push({ type: 'stdout', text: stdout });
                if (stderr) outputs.push({ type: 'stderr', text: stderr });
                if (!outputs.length) outputs.push({ type: 'result', text: `✓ Done  (exit ${code})` });
                _nbSetOutput(cell.id, outputs);
                notebookSave();
                resolve();
            });
            proc.on('error', err => {
                _nbSetOutput(cell.id, [{ type: 'error', text: `Failed to start "${cmd}": ${err.message}` }]);
                resolve();
            });
        });
    }

    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-fast-forward text-[9px]"></i> Run All'; }
}

// ── Cell CRUD ─────────────────────────────────────────────────────────
function notebookAddCell(type, afterId) {
    const newCell = { id: nbGenId(), type, source: '', outputs: [], lang: notebookLang };
    if (afterId) {
        const idx = notebookCells.findIndex(c => c.id === afterId);
        notebookCells.splice(Math.max(idx + 1, 0), 0, newCell);
    } else {
        notebookCells.push(newCell);
    }
    notebookRenderAll();
    notebookSave();
    setTimeout(() => {
        const ed = notebookAceEditors[newCell.id];
        if (ed) ed.focus();
        else { const ta = document.getElementById(`vnb-source-${newCell.id}`); if (ta) ta.focus(); }
        document.getElementById(`vnb-cell-${newCell.id}`)
            ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 60);
}

function notebookDeleteCell(cellId) {
    if (notebookCells.length <= 1) {
        // Just clear the single cell instead of removing it
        const cell = notebookCells[0];
        const ed   = notebookAceEditors[cell.id];
        if (ed) ed.setValue('', -1);
        cell.source = '';
        cell.outputs = [];
        _nbSetOutput(cell.id, []);
        notebookSave();
        return;
    }
    const idx = notebookCells.findIndex(c => c.id === cellId);
    notebookCells = notebookCells.filter(c => c.id !== cellId);
    notebookRenderAll();
    notebookSave();
    setTimeout(() => {
        const next = notebookCells[Math.min(idx, notebookCells.length - 1)];
        if (!next) return;
        const ed = notebookAceEditors[next.id];
        if (ed) ed.focus();
        else { const ta = document.getElementById(`vnb-source-${next.id}`); if (ta) ta.focus(); }
    }, 60);
}

function notebookMoveCell(cellId, dir) {
    const idx = notebookCells.findIndex(c => c.id === cellId);
    if (dir === 'up'   && idx > 0)
        [notebookCells[idx], notebookCells[idx-1]] = [notebookCells[idx-1], notebookCells[idx]];
    else if (dir === 'down' && idx < notebookCells.length - 1)
        [notebookCells[idx], notebookCells[idx+1]] = [notebookCells[idx+1], notebookCells[idx]];
    else return;
    notebookRenderAll();
    notebookSave();
    setTimeout(() => { const ed = notebookAceEditors[cellId]; if (ed) ed.focus(); }, 60);
}

// ── Markdown renderer ─────────────────────────────────────────────────
function nbRenderMarkdown(src) {
    if (!src || !src.trim()) return '';
    let h = nbEscape(src);

    // Fenced code blocks
    h = h.replace(/```[\s\S]*?```/g, m => {
        const inner = m.slice(3, -3).replace(/^\w+\n/, '');
        return `<pre class="vnb-md-pre"><code>${inner}</code></pre>`;
    });

    h = h.replace(/^### (.+)$/gm, '<h3 class="vnb-md-h3">$1</h3>');
    h = h.replace(/^## (.+)$/gm,  '<h2 class="vnb-md-h2">$1</h2>');
    h = h.replace(/^# (.+)$/gm,   '<h1 class="vnb-md-h1">$1</h1>');
    h = h.replace(/^---$/gm,      '<hr class="vnb-md-hr">');

    h = h.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    h = h.replace(/\*\*(.+?)\*\*/g,     '<strong>$1</strong>');
    h = h.replace(/\*(.+?)\*/g,         '<em>$1</em>');
    h = h.replace(/`([^`]+)`/g,         '<code class="vnb-md-code">$1</code>');
    h = h.replace(/^&gt; (.+)$/gm,      '<blockquote class="vnb-md-bq">$1</blockquote>');

    // Unordered lists
    h = h.replace(/^[*\-] (.+)$/gm, '<vnbli>$1</vnbli>');
    h = h.replace(/(<vnbli>[\s\S]*?<\/vnbli>\n?)+/g, m =>
        `<ul class="vnb-md-ul">${m.replace(/<vnbli>/g,'<li>').replace(/<\/vnbli>/g,'</li>')}</ul>`
    );
    // Ordered lists
    h = h.replace(/^\d+\. (.+)$/gm, '<vnboli>$1</vnboli>');
    h = h.replace(/(<vnboli>[\s\S]*?<\/vnboli>\n?)+/g, m =>
        `<ol class="vnb-md-ol">${m.replace(/<vnboli>/g,'<li>').replace(/<\/vnboli>/g,'</li>')}</ol>`
    );

    // Paragraph wrap
    h = h.split(/\n\n+/).map(block => {
        block = block.trim();
        if (!block) return '';
        if (/^<(h[1-6]|ul|ol|blockquote|hr|pre)[\s>]/.test(block)) return block;
        return `<p class="vnb-md-p">${block.replace(/\n/g,'<br>')}</p>`;
    }).join('\n');

    return h;
}

// ── Notebook terminal ─────────────────────────────────────────────────

function vnbToggleTerm() {
    vnbTermOpen = !vnbTermOpen;
    const wrap = document.getElementById('vnb-term-wrap');
    const btn  = document.getElementById('vnb-term-btn');
    if (wrap) wrap.style.display = vnbTermOpen ? 'flex' : 'none';
    if (btn)  btn.classList.toggle('text-green-400', vnbTermOpen);
    if (vnbTermOpen) {
        _vnbEnsureTermInit();
        setTimeout(() => { _vnbFitTerm(); if (vnbTerm) vnbTerm.focus(); }, 50);
    }
}

function _vnbEnsureTermInit() {
    if (vnbTerm) return;

    // Load xterm via require() — NOT via globals.
    // In Electron with nodeIntegration:true, UMD libs loaded via <script> tags
    // detect Node's module/exports globals and export via module.exports instead
    // of window.X, so window.Terminal is never set. require() is the fix.
    let TermClass, FitClass;
    try {
        const xterm    = require('./js/xterm/xterm.js');
        const fitaddon = require('./js/xterm/xterm-addon-fit.js');
        TermClass = xterm.Terminal;
        FitClass  = fitaddon.FitAddon;
    } catch(e) {
        console.error('[Vulsor] Failed to load xterm for notebook:', e);
        return;
    }
    if (!TermClass) { console.error('[Vulsor] xterm Terminal class not found'); return; }

    vnbTerm = new TermClass({
        theme: {
            background: '#1a1b26', foreground: '#c0caf5',
            cursor: '#c0caf5',  black: '#15161e', red: '#f7768e',
            green: '#9ece6a',   yellow: '#e0af68', blue: '#7aa2f7',
            magenta: '#bb9af7', cyan: '#7dcfff',   white: '#a9b1d6',
        },
        fontSize: 13,
        fontFamily: "'Fira Code', 'JetBrains Mono', Menlo, Consolas, monospace",
        cursorBlink: true,
        cursorStyle: 'block',
        scrollback: 5000,
    });

    if (FitClass) {
        vnbFitAddon = new FitClass();
        vnbTerm.loadAddon(vnbFitAddon);
    }

    const el = document.getElementById('vnb-term');
    vnbTerm.open(el);
    _vnbFitTerm();

    // Clicking anywhere in the terminal area refocuses it
    el.addEventListener('mousedown', () => {
        setTimeout(() => { if (vnbTerm) vnbTerm.focus(); }, 0);
    });

    vnbTermCwd = os.homedir();
    vnbTerm.writeln('\x1b[32m╔═════════════════════════════════╗\x1b[0m');
    vnbTerm.writeln('\x1b[32m║  Notebook Terminal  —  bash      ║\x1b[0m');
    vnbTerm.writeln('\x1b[32m║  pip install · conda · python3   ║\x1b[0m');
    vnbTerm.writeln('\x1b[32m╚═════════════════════════════════╝\x1b[0m');
    vnbTerm.writeln('');
    _vnbWritePrompt();

    vnbTerm.onData(_vnbHandleTermData);

    if (window.ResizeObserver) {
        new ResizeObserver(() => _vnbFitTerm()).observe(el);
    }
}

function _vnbFitTerm() {
    if (!vnbTerm) return;
    if (vnbFitAddon) { try { vnbFitAddon.fit(); } catch(_) {} return; }
    const el = document.getElementById('vnb-term');
    if (!el) return;
    const cols = Math.max(10, Math.floor((el.clientWidth  - 8) / 7.8));
    const rows = Math.max(2,  Math.floor((el.clientHeight - 8) / 17));
    try { vnbTerm.resize(cols, rows); } catch(_) {}
}

function _vnbWritePrompt() {
    if (!vnbTerm) return;
    const home = os.homedir();
    const disp = vnbTermCwd.startsWith(home)
        ? '\x1b[96m~' + vnbTermCwd.slice(home.length) + '\x1b[0m'
        : '\x1b[96m' + vnbTermCwd + '\x1b[0m';
    vnbTerm.write(`\x1b[32m➜\x1b[0m ${disp} \x1b[97m$\x1b[0m `);
}

function _vnbHandleTermData(data) {
    if (vnbTermRunning) {
        // Forward all input to running process stdin (enables pip install, python REPL, etc.)
        if (vnbTermProc) {
            if (data === '\x03') {
                try { vnbTermProc.kill('SIGINT'); } catch(_) {}
            } else if (vnbTermProc.stdin && !vnbTermProc.stdin.destroyed) {
                try { vnbTermProc.stdin.write(data === '\r' ? '\n' : data); } catch(_) {}
            }
        }
        return;
    }

    const code = data.charCodeAt(0);

    if (data === '\r') {
        const cmd = vnbTermLine.trim();
        vnbTerm.write('\r\n');
        vnbTermLine = '';
        vnbTermHistIdx = -1;
        if (cmd) { vnbTermHistory.unshift(cmd); _vnbExecCmd(cmd); }
        else     { _vnbWritePrompt(); }
        return;
    }
    if (data === '\x7f' || data === '\b') {
        if (vnbTermLine.length > 0) { vnbTermLine = vnbTermLine.slice(0,-1); vnbTerm.write('\b \b'); }
        return;
    }
    if (data === '\x03') { vnbTerm.write('^C\r\n'); vnbTermLine=''; vnbTermHistIdx=-1; _vnbWritePrompt(); return; }
    if (data === '\x0c') { vnbTerm.clear(); _vnbWritePrompt(); vnbTerm.write(vnbTermLine); return; }
    if (data === '\x1b[A') {   // Arrow Up
        if (!vnbTermHistory.length) return;
        vnbTermHistIdx = Math.min(vnbTermHistIdx+1, vnbTermHistory.length-1);
        _vnbReplaceTermLine(vnbTermHistory[vnbTermHistIdx]); return;
    }
    if (data === '\x1b[B') {   // Arrow Down
        if (vnbTermHistIdx <= 0) { vnbTermHistIdx=-1; _vnbReplaceTermLine(''); }
        else { vnbTermHistIdx--; _vnbReplaceTermLine(vnbTermHistory[vnbTermHistIdx]); }
        return;
    }
    if (data === '\x1b[C' || data === '\x1b[D') return; // Left/Right ignored
    if (data === '\t') { vnbTerm.write('    '); vnbTermLine += '    '; return; }
    if (code >= 32 && code < 127) { vnbTermLine += data; vnbTerm.write(data); }
}

function _vnbReplaceTermLine(newLine) {
    vnbTerm.write('\b \b'.repeat(vnbTermLine.length));
    vnbTermLine = newLine;
    vnbTerm.write(newLine);
}

function _vnbExecCmd(rawCmd) {
    // Handle cd locally
    const cdMatch = rawCmd.match(/^cd\s*(.*)?$/);
    if (cdMatch) {
        const target   = (cdMatch[1]||'').trim().replace(/^~/, os.homedir()) || os.homedir();
        const resolved = path.resolve(vnbTermCwd, target);
        try {
            if (require('fs').statSync(resolved).isDirectory()) vnbTermCwd = resolved;
            else vnbTerm.writeln(`\x1b[31mcd: ${target}: Not a directory\x1b[0m`);
        } catch(_) { vnbTerm.writeln(`\x1b[31mcd: ${target}: No such file or directory\x1b[0m`); }
        _vnbWritePrompt(); return;
    }

    vnbTermRunning = true;
    const { spawn } = require('child_process');

    // Use the user's own login shell (zsh/bash) with --login so it sources
    // ~/.zprofile / ~/.bash_profile and picks up Homebrew, pyenv, conda, etc.
    // A plain 'bash -c' is a non-login, non-interactive shell — PATH is minimal
    // and tools like pip, python3, conda are never found.
    const userShell = process.env.SHELL || '/bin/zsh';

    const proc = spawn(userShell, ['--login', '-c', rawCmd], {
        cwd: vnbTermCwd,
        env: Object.assign({}, process.env, {
            TERM: 'xterm-256color',
            COLORTERM: 'truecolor',
            FORCE_COLOR: '3',
            PYTHONUNBUFFERED: '1',
            PIP_PROGRESS_BAR: 'on',
        }),
    });
    vnbTermProc = proc;

    const write = d => {
        if (!vnbTerm) return;
        vnbTerm.write(d.toString().replace(/\r?\n/g, '\r\n'));
    };
    proc.stdout.on('data', write);
    proc.stderr.on('data', write);
    proc.on('close', code => {
        vnbTermProc = null; vnbTermRunning = false;
        if (code !== 0 && code !== null) vnbTerm.write(`\x1b[90m[exit ${code}]\x1b[0m\r\n`);
        _vnbWritePrompt();
    });
    proc.on('error', err => {
        vnbTermProc = null; vnbTermRunning = false;
        vnbTerm.writeln(`\x1b[31mError: ${err.message}\x1b[0m`);
        _vnbWritePrompt();
    });
}

// ── Init ──────────────────────────────────────────────────────────────
function initVaultNotebook() {
    // New notebook button
    const newNbBtn = document.getElementById('vault-new-notebook-btn');
    if (newNbBtn) newNbBtn.onclick = createNotebookFile;

    // Title input — save name whenever the user types (works for both doc & notebook)
    const titleInput = document.getElementById('vault-doc-title-input');
    if (titleInput) {
        titleInput.addEventListener('input', () => {
            if (vaultIsNotebook) notebookSaveTitle();
        });
    }

    // Language selector
    const langSel = document.getElementById('vnb-lang-select');
    if (langSel) langSel.onchange = () => {
        notebookLang = langSel.value;
        notebookCells.forEach(c => { if (c.type === 'code') c.lang = notebookLang; });
        // Re-set mode on all open Ace editors
        Object.entries(notebookAceEditors).forEach(([id, ed]) => {
            const cell = notebookCells.find(c => c.id === id);
            if (cell) ed.session.setMode(`ace/mode/${NB_ACE_MODES[notebookLang] || 'python'}`);
        });
        notebookAutoSave();
    };

    // Run All button
    document.getElementById('vnb-run-all-btn')?.addEventListener('click', notebookRunAll);

    // Add cell buttons (append at bottom)
    document.getElementById('vnb-add-code-btn')?.addEventListener('click', () => notebookAddCell('code',     null));
    document.getElementById('vnb-add-md-btn')?.addEventListener('click',   () => notebookAddCell('markdown', null));

    // Clear all outputs
    document.getElementById('vnb-clear-btn')?.addEventListener('click', () => {
        notebookCells.forEach(c => { c.outputs = []; });
        notebookRunCount = {};
        notebookRenderAll();
        notebookSave();
    });

    // Terminal toggle button
    document.getElementById('vnb-term-btn')?.addEventListener('click', vnbToggleTerm);
    document.getElementById('vnb-term-close-btn')?.addEventListener('click', () => {
        if (vnbTermOpen) vnbToggleTerm();
    });
}
