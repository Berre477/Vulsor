// ── Writer — create books & papers ────────────────────────────────
// Depends on: globals.js (fs, path, WRITER_FILE)
//
// A project is either a "book" (multiple chapters) or a "paper" (a single
// body). Content is stored as HTML produced by a contentEditable editor.
//   project = { id, type:'book'|'paper', title, author, createdAt, updatedAt,
//               chapters: [{ id, title, content }], activeChapterId }

function loadWriterData() {
    try {
        if (fs.existsSync(WRITER_FILE))
            return JSON.parse(fs.readFileSync(WRITER_FILE, 'utf8'));
    } catch (_) {}
    return { projects: [] };
}
function saveWriterData() {
    try { fs.writeFileSync(WRITER_FILE, JSON.stringify(writerData, null, 2)); } catch (_) {}
}

// ── State ──────────────────────────────────────────────────────────
let writerData      = { projects: [] };
let writerActiveId  = null;
let writerSaveTimer = null;

// ── Helpers ────────────────────────────────────────────────────────
function writerUid() { return 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

function writerEscHtml(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// Word count from an HTML string.
function writerCountHtml(html) {
    const tmp = document.createElement('div');
    tmp.innerHTML = html || '';
    const text = (tmp.textContent || '').trim();
    return text ? text.split(/\s+/).length : 0;
}

function writerActiveProject() {
    return writerData.projects.find(p => p.id === writerActiveId) || null;
}
function writerActiveChapter(p) {
    p = p || writerActiveProject();
    if (!p || !p.chapters || !p.chapters.length) return null;
    return p.chapters.find(c => c.id === p.activeChapterId) || p.chapters[0];
}
function writerProjectWords(p) {
    return (p.chapters || []).reduce((sum, c) => sum + writerCountHtml(c.content), 0);
}

// ── Sidebar ────────────────────────────────────────────────────────
function renderWriterSidebar() {
    const listEl = document.getElementById('writer-project-list');
    if (!listEl) return;

    const projects = writerData.projects.slice()
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    if (!projects.length) {
        listEl.innerHTML = '<p class="text-slate-700 text-xs text-center py-6 italic px-3">No projects yet.<br>Create a book or paper.</p>';
        return;
    }

    const groups = [
        { type: 'book',  label: 'Books',  icon: 'fa-book' },
        { type: 'paper', label: 'Papers', icon: 'fa-file-lines' },
    ];

    listEl.innerHTML = groups.map(g => {
        const items = projects.filter(p => p.type === g.type);
        if (!items.length) return '';
        return `<div class="mb-3">
            <p class="text-slate-600 text-[9px] font-semibold uppercase tracking-widest px-2 mb-1 flex items-center gap-1.5">
                <i class="fas ${g.icon} text-[9px]"></i> ${g.label}
            </p>
            ${items.map(p => {
                const isActive = p.id === writerActiveId;
                const words = writerProjectWords(p);
                const chapNote = p.type === 'book' ? `${(p.chapters || []).length} ch · ` : '';
                return `<div class="writer-project group px-3 py-2.5 rounded-xl cursor-pointer transition-all mb-1 ${
                    isActive ? 'border' : 'hover:bg-slate-800/50'
                }" data-id="${p.id}" ${isActive ? 'style="background:rgba(225,29,72,0.10);border-color:rgba(225,29,72,0.22)"' : ''}>
                    <p class="text-xs font-semibold truncate" style="${isActive ? 'color:#fb7185' : 'color:#cbd5e1'}">${writerEscHtml(p.title || 'Untitled')}</p>
                    <p class="text-slate-600 text-[10px] mt-0.5 truncate">${chapNote}${words} word${words !== 1 ? 's' : ''}</p>
                </div>`;
            }).join('')}
        </div>`;
    }).join('');

    listEl.querySelectorAll('.writer-project').forEach(el => {
        el.onclick = () => openWriterProject(el.dataset.id);
    });
}

// ── Chapter strip (books only) ─────────────────────────────────────
function renderWriterChapters() {
    const bar = document.getElementById('writer-chapters');
    if (!bar) return;
    const p = writerActiveProject();

    if (!p || p.type !== 'book') { bar.style.display = 'none'; bar.innerHTML = ''; return; }
    bar.style.display = 'flex';

    const active = writerActiveChapter(p);
    bar.innerHTML = (p.chapters || []).map((c, i) =>
        `<span class="writer-chapter-tab ${active && c.id === active.id ? 'active' : ''}" data-id="${c.id}">${writerEscHtml(c.title || ('Chapter ' + (i + 1)))}</span>`
    ).join('') +
        `<span id="writer-add-chapter" class="writer-chapter-tab" title="Add chapter" style="font-weight:700">+</span>`;

    bar.querySelectorAll('.writer-chapter-tab[data-id]').forEach(el => {
        el.onclick = () => openWriterChapter(el.dataset.id);
        el.ondblclick = () => renameWriterChapter(el.dataset.id);
    });
    const addBtn = document.getElementById('writer-add-chapter');
    if (addBtn) addBtn.onclick = () => addWriterChapter();
}

// ── Editor ─────────────────────────────────────────────────────────
function renderWriterEditor() {
    const empty = document.getElementById('writer-empty');
    const main  = document.getElementById('writer-editor-main');
    const p = writerActiveProject();

    if (!p) {
        if (empty) empty.classList.remove('hidden');
        if (main)  main.classList.add('hidden');
        return;
    }
    if (empty) empty.classList.add('hidden');
    if (main)  main.classList.remove('hidden');

    const titleEl  = document.getElementById('writer-title');
    const authorEl = document.getElementById('writer-author');
    const badge    = document.getElementById('writer-type-badge');
    const editor   = document.getElementById('writer-editor');

    if (titleEl)  titleEl.value  = p.title  || '';
    if (authorEl) authorEl.value = p.author || '';
    if (badge) {
        const isBook = p.type === 'book';
        badge.textContent = isBook ? 'Book' : 'Paper';
        badge.style.background = isBook ? 'rgba(225,29,72,0.18)' : 'rgba(148,163,184,0.15)';
        badge.style.color      = isBook ? '#fb7185' : '#cbd5e1';
    }

    renderWriterChapters();

    const chap = writerActiveChapter(p);
    if (editor) {
        editor.innerHTML = (chap && chap.content) || '';
        editor.setAttribute('data-placeholder',
            p.type === 'book' ? 'Write this chapter…' : 'Start your paper…');
    }
    updateWriterMeta();
}

function updateWriterMeta() {
    const editor = document.getElementById('writer-editor');
    const metaEl = document.getElementById('writer-word-count');
    const p = writerActiveProject();
    if (!editor || !metaEl || !p) return;
    const cur = writerCountHtml(editor.innerHTML);
    if (p.type === 'book') {
        // total across chapters, using live editor content for the active one
        const active = writerActiveChapter(p);
        let total = 0;
        (p.chapters || []).forEach(c => {
            total += (active && c.id === active.id) ? cur : writerCountHtml(c.content);
        });
        metaEl.textContent = `${cur} word${cur !== 1 ? 's' : ''} · ${total} total`;
    } else {
        metaEl.textContent = `${cur} word${cur !== 1 ? 's' : ''}`;
    }
}

function openWriterProject(id) {
    writerFlush();
    writerActiveId = id;
    renderWriterEditor();
    renderWriterSidebar();
    const editor = document.getElementById('writer-editor');
    if (editor) setTimeout(() => editor.focus(), 30);
}

function openWriterChapter(cid) {
    writerFlush();
    const p = writerActiveProject();
    if (!p) return;
    p.activeChapterId = cid;
    renderWriterEditor();
    const editor = document.getElementById('writer-editor');
    if (editor) setTimeout(() => editor.focus(), 30);
}

// ── Create / modify projects ───────────────────────────────────────
function newWriterProject(type) {
    writerFlush();
    const isBook = type === 'book';
    const proj = {
        id: writerUid(), type, title: '', author: '',
        createdAt: Date.now(), updatedAt: Date.now(),
        chapters: isBook
            ? [{ id: writerUid(), title: 'Chapter 1', content: '' }]
            : [{ id: writerUid(), title: 'Body', content: '' }],
    };
    proj.activeChapterId = proj.chapters[0].id;
    writerData.projects.push(proj);
    saveWriterData();
    writerActiveId = proj.id;
    renderWriterEditor();
    renderWriterSidebar();
    const titleEl = document.getElementById('writer-title');
    if (titleEl) setTimeout(() => titleEl.focus(), 40);
}

function deleteWriterProject() {
    const p = writerActiveProject();
    if (!p) return;
    if (!confirm(`Delete "${p.title || 'Untitled'}"? This cannot be undone.`)) return;
    writerData.projects = writerData.projects.filter(x => x.id !== p.id);
    writerActiveId = writerData.projects.length
        ? writerData.projects.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0].id
        : null;
    saveWriterData();
    renderWriterEditor();
    renderWriterSidebar();
}

function addWriterChapter() {
    writerFlush();
    const p = writerActiveProject();
    if (!p) return;
    const ch = { id: writerUid(), title: 'Chapter ' + ((p.chapters || []).length + 1), content: '' };
    p.chapters.push(ch);
    p.activeChapterId = ch.id;
    p.updatedAt = Date.now();
    saveWriterData();
    renderWriterEditor();
    renderWriterSidebar();
    const editor = document.getElementById('writer-editor');
    if (editor) setTimeout(() => editor.focus(), 30);
}

async function renameWriterChapter(cid) {
    const p = writerActiveProject();
    if (!p) return;
    const ch = p.chapters.find(c => c.id === cid);
    if (!ch) return;
    const name = await vulsorPrompt('Chapter title', ch.title || '', { confirmLabel: 'Save' });
    if (name == null) return;
    ch.title = name.trim() || ch.title;
    p.updatedAt = Date.now();
    saveWriterData();
    renderWriterChapters();
}

// ── Auto-save ──────────────────────────────────────────────────────
function writerOnInput() {
    updateWriterMeta();
    const status = document.getElementById('writer-save-status');
    if (status) status.textContent = 'saving…';
    clearTimeout(writerSaveTimer);
    writerSaveTimer = setTimeout(() => {
        writerCommit();
        if (status) status.textContent = 'saved';
        renderWriterSidebar();
    }, 600);
}

// Persist the current editor + title fields into the active project.
function writerCommit() {
    const p = writerActiveProject();
    if (!p) return;
    const titleEl  = document.getElementById('writer-title');
    const authorEl = document.getElementById('writer-author');
    const editor   = document.getElementById('writer-editor');
    if (titleEl)  p.title  = titleEl.value;
    if (authorEl) p.author = authorEl.value;
    const chap = writerActiveChapter(p);
    if (chap && editor) chap.content = editor.innerHTML;
    p.updatedAt = Date.now();
    saveWriterData();
}

// Flush any pending debounced save immediately (before switching context).
function writerFlush() {
    if (writerSaveTimer) { clearTimeout(writerSaveTimer); writerSaveTimer = null; }
    if (writerActiveProject()) writerCommit();
}

// ── Formatting ─────────────────────────────────────────────────────
function writerExec(cmd, val) {
    const editor = document.getElementById('writer-editor');
    if (!editor) return;
    editor.focus();
    try {
        if (cmd === 'formatBlock') document.execCommand('formatBlock', false, val);
        else document.execCommand(cmd, false, val || null);
    } catch (_) {}
    writerOnInput();
}

// ── Export ─────────────────────────────────────────────────────────
function exportWriter() {
    writerFlush();
    const p = writerActiveProject();
    if (!p) return;
    const title = p.title || 'Untitled';
    const bodyParts = (p.chapters || []).map(c => {
        const head = p.type === 'book'
            ? `<h1>${writerEscHtml(c.title || 'Chapter')}</h1>` : '';
        return head + (c.content || '');
    });
    const html =
`<!DOCTYPE html>
<html><head><meta charset="utf-8">
<title>${writerEscHtml(title)}</title>
<style>
  body { max-width: 760px; margin: 40px auto; padding: 0 24px;
         font-family: Georgia, 'Times New Roman', serif; font-size: 18px;
         line-height: 1.7; color: #1a1a1a; }
  h1 { font-size: 1.9em; margin: 1.4em 0 .5em; }
  h2 { font-size: 1.4em; margin: 1.1em 0 .4em; }
  blockquote { border-left: 3px solid #ccc; margin: 0 0 1em; padding-left: 1em;
               color: #555; font-style: italic; }
  .byline { color: #666; font-style: italic; margin-top: -.4em; }
</style></head>
<body>
<h1 style="border-bottom:1px solid #ddd;padding-bottom:.3em">${writerEscHtml(title)}</h1>
${p.author ? `<p class="byline">by ${writerEscHtml(p.author)}</p>` : ''}
${bodyParts.join('\n<hr style="border:none;border-top:1px solid #eee;margin:2em 0">\n')}
</body></html>`;

    const blob = new Blob([html], { type: 'text/html' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (title.replace(/[^\w\- ]+/g, '').trim() || 'document') + '.html';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

// ── Entry point called on view activation ──────────────────────────
function renderWriter() {
    // Default to most-recent project when none selected.
    if (!writerActiveProject() && writerData.projects.length) {
        writerActiveId = writerData.projects.slice()
            .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0].id;
    }
    renderWriterEditor();
    renderWriterSidebar();
}

// ── Init ───────────────────────────────────────────────────────────
function initWriter() {
    writerData = loadWriterData();

    const bookBtn  = document.getElementById('writer-new-book-btn');
    const paperBtn = document.getElementById('writer-new-paper-btn');
    if (bookBtn)  bookBtn.onclick  = () => newWriterProject('book');
    if (paperBtn) paperBtn.onclick = () => newWriterProject('paper');

    const editor = document.getElementById('writer-editor');
    if (editor) {
        editor.addEventListener('input', writerOnInput);
        editor.addEventListener('blur', writerFlush);
    }
    const titleEl  = document.getElementById('writer-title');
    const authorEl = document.getElementById('writer-author');
    if (titleEl)  titleEl.addEventListener('input', writerOnInput);
    if (authorEl) authorEl.addEventListener('input', writerOnInput);

    // Toolbar buttons — mousedown+preventDefault keeps the editor selection.
    document.querySelectorAll('.writer-fmt').forEach(btn => {
        btn.addEventListener('mousedown', e => e.preventDefault());
        btn.addEventListener('click', () => writerExec(btn.dataset.cmd, btn.dataset.val));
    });

    const exportBtn = document.getElementById('writer-export-btn');
    const deleteBtn = document.getElementById('writer-delete-btn');
    if (exportBtn) exportBtn.onclick = exportWriter;
    if (deleteBtn) deleteBtn.onclick = deleteWriterProject;

    renderWriter();
}
