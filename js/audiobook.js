// ── Audiobooks — read PDFs aloud with the local text-to-speech engine ──
// Depends on: pdfjsLib (vendor/pdf.min.js) for text extraction,
//             window.speechSynthesis (Web Speech API) for narration.
// Recents + per-book progress are persisted in localStorage (no extra files).

const AB_RECENTS_KEY = 'vulsor.audiobook.recents';   // [{ path, name, page, chunk, total, ts }]

// ── State ──────────────────────────────────────────────────────────
let abPdfDoc      = null;     // active pdf.js document
let abFilePath    = '';       // current file path
let abName        = '';       // display name
let abChunks      = [];       // [{ text, page }]  flattened sentence chunks
let abIdx         = 0;        // index of the chunk currently spoken / selected
let abPlaying     = false;    // is narration active (incl. paused)
let abPaused      = false;
let abRate        = 1.0;
let abVoiceURI    = '';       // chosen system voice
let abLoading     = false;

// ── Persistence ────────────────────────────────────────────────────
function abLoadRecents() {
    try { return JSON.parse(localStorage.getItem(AB_RECENTS_KEY)) || []; }
    catch (_) { return []; }
}
function abSaveRecents(list) {
    try { localStorage.setItem(AB_RECENTS_KEY, JSON.stringify(list.slice(0, 12))); } catch (_) {}
}
function abRememberProgress() {
    if (!abFilePath) return;
    const list = abLoadRecents().filter(r => r.path !== abFilePath);
    list.unshift({
        path:  abFilePath,
        name:  abName,
        page:  abChunks[abIdx] ? abChunks[abIdx].page : 1,
        chunk: abIdx,
        total: abChunks.length,
        ts:    Date.now(),
    });
    abSaveRecents(list);
}

// ── Text helpers ───────────────────────────────────────────────────
// Split a page's raw text into bite-sized chunks the speech engine can
// handle reliably (long utterances get truncated by some TTS voices).
function abSplitToChunks(text) {
    const clean = text.replace(/\s+/g, ' ').trim();
    if (!clean) return [];
    const sentences = clean.match(/[^.!?]+[.!?]+|\S[^.!?]*$/g) || [clean];
    const out = [];
    for (const s of sentences) {
        const t = s.trim();
        if (!t) continue;
        if (t.length <= 220) { out.push(t); continue; }
        // Break overly long sentences on commas / spaces near the limit.
        let rest = t;
        while (rest.length > 220) {
            let cut = rest.lastIndexOf(',', 220);
            if (cut < 80) cut = rest.lastIndexOf(' ', 220);
            if (cut < 80) cut = 220;
            out.push(rest.slice(0, cut + 1).trim());
            rest = rest.slice(cut + 1).trim();
        }
        if (rest) out.push(rest);
    }
    return out;
}

// ── Voices ─────────────────────────────────────────────────────────
function abPopulateVoices() {
    const sel = document.getElementById('ab-voice-select');
    if (!sel) return;
    const voices = window.speechSynthesis.getVoices() || [];
    if (!voices.length) return;
    const prev = abVoiceURI || localStorage.getItem('vulsor.audiobook.voice') || '';
    sel.innerHTML = '';
    voices.forEach(v => {
        const opt = document.createElement('option');
        opt.value = v.voiceURI;
        opt.textContent = `${v.name} (${v.lang})${v.default ? ' — default' : ''}`;
        sel.appendChild(opt);
    });
    // Prefer a previously chosen voice, else an English default.
    const fallback = voices.find(v => /^en/i.test(v.lang) && v.default)
                  || voices.find(v => /^en/i.test(v.lang))
                  || voices[0];
    abVoiceURI = (prev && voices.some(v => v.voiceURI === prev)) ? prev : fallback.voiceURI;
    sel.value = abVoiceURI;
}

// ── PDF loading ────────────────────────────────────────────────────
async function abOpenFile(filePath, opts = {}) {
    if (typeof pdfjsLib === 'undefined') {
        abSetStatus('PDF engine not loaded.', true);
        return;
    }
    abStop();
    abLoading = true;
    abName = (filePath.split(/[\\/]/).pop() || 'Document').replace(/\.pdf$/i, '');
    abFilePath = filePath;
    abSetStatus(`Opening “${abName}”…`);
    abRenderShelf();

    let url;
    try {
        const { pathToFileURL } = require('url');
        url = pathToFileURL(filePath).href;
    } catch (_) { url = `file://${filePath}`; }

    try {
        if (abPdfDoc) { try { abPdfDoc.destroy(); } catch (_) {} }
        abPdfDoc = await pdfjsLib.getDocument(url).promise;
        const n = abPdfDoc.numPages;
        abChunks = [];
        for (let p = 1; p <= n; p++) {
            abSetStatus(`Extracting text… page ${p} of ${n}`);
            const page = await abPdfDoc.getPage(p);
            const tc = await page.getTextContent();
            const text = tc.items.map(it => it.str).join(' ');
            abSplitToChunks(text).forEach(t => abChunks.push({ text: t, page: p }));
        }
        abLoading = false;

        if (!abChunks.length) {
            abSetStatus('No readable text found. This PDF may be scanned images.', true);
            return;
        }
        // Resume saved position if reopening the same book.
        const saved = abLoadRecents().find(r => r.path === filePath);
        abIdx = (opts.resume && saved && saved.chunk < abChunks.length) ? saved.chunk : 0;
        abRememberProgress();
        abShowReader();
        abRenderPage();
        abUpdateTransport();
        abSetStatus('');
    } catch (err) {
        abLoading = false;
        console.error('[audiobook] load failed:', err);
        abSetStatus(`Could not open PDF: ${err.message}`, true);
    }
}

async function abPickFile() {
    try {
        const { ipcRenderer } = require('electron');
        const result = await ipcRenderer.invoke('show-open-dialog', {
            title: 'Choose a PDF to listen to',
            filters: [{ name: 'PDF', extensions: ['pdf'] }],
            properties: ['openFile'],
        });
        if (result && !result.canceled && result.filePaths.length) {
            abOpenFile(result.filePaths[0]);
        }
    } catch (e) {
        console.error('[audiobook] pick failed:', e);
        abSetStatus('Could not open the file picker.', true);
    }
}

// ── Narration ──────────────────────────────────────────────────────
function abSpeakCurrent() {
    if (!abChunks[abIdx]) { abStop(); return; }
    window.speechSynthesis.cancel();
    const chunk = abChunks[abIdx];
    const u = new SpeechSynthesisUtterance(chunk.text);
    u.rate = abRate;
    const voices = window.speechSynthesis.getVoices() || [];
    const v = voices.find(x => x.voiceURI === abVoiceURI);
    if (v) { u.voice = v; u.lang = v.lang; }
    u.onend = () => {
        if (!abPlaying || abPaused) return;
        if (abIdx < abChunks.length - 1) {
            abIdx++;
            if (abChunks[abIdx].page !== chunk.page) abRenderPage();
            abHighlightCurrent();
            abUpdateTransport();
            abRememberProgress();
            abSpeakCurrent();
        } else {
            abStop();
            abSetStatus('Finished. 🎧');
        }
    };
    u.onerror = () => { /* swallow interrupt errors from cancel() */ };
    window.speechSynthesis.speak(u);
    abHighlightCurrent();
}

function abPlay() {
    if (!abChunks.length) return;
    if (abPaused) { abPaused = false; window.speechSynthesis.resume(); abUpdateTransport(); return; }
    abPlaying = true; abPaused = false;
    abUpdateTransport();
    abSpeakCurrent();
}
function abPause() {
    if (!abPlaying) return;
    abPaused = true;
    window.speechSynthesis.pause();
    abUpdateTransport();
}
function abStop() {
    abPlaying = false; abPaused = false;
    try { window.speechSynthesis.cancel(); } catch (_) {}
    abUpdateTransport();
}
function abJump(delta) {
    if (!abChunks.length) return;
    const wasPlaying = abPlaying && !abPaused;
    abIdx = Math.max(0, Math.min(abChunks.length - 1, abIdx + delta));
    abRenderPage();
    abRememberProgress();
    abUpdateTransport();
    if (wasPlaying) abSpeakCurrent(); else abHighlightCurrent();
}
// Jump to the first chunk of the previous / next page.
function abJumpPage(dir) {
    if (!abChunks.length) return;
    const curPage = abChunks[abIdx].page;
    let target = abIdx;
    if (dir > 0) {
        target = abChunks.findIndex(c => c.page > curPage);
        if (target < 0) target = abChunks.length - 1;
    } else {
        const firstOfCur = abChunks.findIndex(c => c.page === curPage);
        if (abIdx > firstOfCur) target = firstOfCur;          // restart current page
        else { const prev = curPage - 1; target = Math.max(0, abChunks.findIndex(c => c.page === prev)); }
    }
    abJump(target - abIdx);
}

// ── Rendering ──────────────────────────────────────────────────────
function abSetStatus(msg, isError) {
    const el = document.getElementById('ab-status');
    if (!el) return;
    el.textContent = msg || '';
    el.style.display = msg ? '' : 'none';
    el.style.color = isError ? '#f87171' : '#94a3b8';
}

function abShowReader() {
    const shelf  = document.getElementById('ab-shelf');
    const reader = document.getElementById('ab-reader');
    if (shelf)  shelf.style.display  = 'none';
    if (reader) reader.style.display = 'flex';
    const title = document.getElementById('ab-book-title');
    if (title) title.textContent = abName;
}
function abShowShelf() {
    abStop();
    const shelf  = document.getElementById('ab-shelf');
    const reader = document.getElementById('ab-reader');
    if (reader) reader.style.display = 'none';
    if (shelf)  shelf.style.display  = 'block';
    abRenderShelf();
}

// Render the current page's chunks as highlightable spans.
function abRenderPage() {
    const box = document.getElementById('ab-text');
    if (!box || !abChunks[abIdx]) return;
    const page = abChunks[abIdx].page;
    box.innerHTML = '';
    abChunks.forEach((c, i) => {
        if (c.page !== page) return;
        const span = document.createElement('span');
        span.className = 'ab-chunk';
        span.dataset.idx = i;
        span.textContent = c.text + ' ';
        span.addEventListener('click', () => {
            const wasPlaying = abPlaying && !abPaused;
            abIdx = i; abRememberProgress(); abUpdateTransport();
            if (wasPlaying) abSpeakCurrent(); else abHighlightCurrent();
        });
        box.appendChild(span);
    });
    abHighlightCurrent();
}

function abHighlightCurrent() {
    document.querySelectorAll('#ab-text .ab-chunk').forEach(s => {
        const on = Number(s.dataset.idx) === abIdx;
        s.classList.toggle('ab-active', on);
        if (on) s.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
}

function abUpdateTransport() {
    const playBtn = document.getElementById('ab-play-btn');
    if (playBtn) {
        const icon = (abPlaying && !abPaused) ? 'fa-pause' : 'fa-play';
        playBtn.innerHTML = `<i class="fas ${icon}"></i>`;
    }
    const total = abChunks.length || 1;
    const pct = abChunks.length ? Math.round(((abIdx + 1) / total) * 100) : 0;
    const bar = document.getElementById('ab-progress-fill');
    if (bar) bar.style.width = pct + '%';
    const lbl = document.getElementById('ab-progress-label');
    if (lbl && abChunks[abIdx]) {
        const lastPage = abChunks[abChunks.length - 1].page;
        lbl.textContent = `Page ${abChunks[abIdx].page} / ${lastPage} · ${pct}%`;
    } else if (lbl) {
        lbl.textContent = '';
    }
}

// The library shelf: recently opened books + an "open" button.
function abRenderShelf() {
    const grid = document.getElementById('ab-recents');
    if (!grid) return;
    const recents = abLoadRecents();
    grid.innerHTML = '';
    if (!recents.length) {
        grid.innerHTML = `<p class="text-slate-600 text-sm col-span-full text-center py-10">
            No audiobooks yet. Open a PDF to start listening.</p>`;
        return;
    }
    recents.forEach(r => {
        const pct = r.total ? Math.round(((r.chunk + 1) / r.total) * 100) : 0;
        const card = document.createElement('div');
        card.className = 'ab-card rounded-2xl border border-slate-800 bg-slate-900/40 p-4 cursor-pointer hover:border-violet-500/50 transition-colors';
        card.innerHTML = `
            <div class="flex items-start gap-3">
                <div class="w-10 h-12 rounded-md bg-gradient-to-br from-violet-500/30 to-fuchsia-500/20 border border-violet-500/30 flex items-center justify-center shrink-0">
                    <i class="fas fa-headphones text-violet-300 text-sm"></i>
                </div>
                <div class="min-w-0 flex-1">
                    <p class="text-slate-200 text-sm font-medium truncate" title="${r.name}">${r.name}</p>
                    <p class="text-slate-600 text-[11px] mt-0.5">Page ${r.page || 1} · ${pct}% listened</p>
                    <div class="h-1 rounded-full bg-slate-800 mt-2 overflow-hidden">
                        <div class="h-full bg-violet-500" style="width:${pct}%"></div>
                    </div>
                </div>
                <button class="ab-card-remove text-slate-700 hover:text-red-400 shrink-0" title="Remove">
                    <i class="fas fa-times text-xs"></i>
                </button>
            </div>`;
        card.addEventListener('click', () => abOpenFile(r.path, { resume: true }));
        card.querySelector('.ab-card-remove').addEventListener('click', (e) => {
            e.stopPropagation();
            abSaveRecents(abLoadRecents().filter(x => x.path !== r.path));
            abRenderShelf();
        });
        grid.appendChild(card);
    });
}

// ── Entry point (called by main.js on view activation) ─────────────
let abBound = false;
function renderAudiobook() {
    if (!abBound) {
        abBound = true;
        document.getElementById('ab-open-btn')?.addEventListener('click', abPickFile);
        document.getElementById('ab-open-btn-2')?.addEventListener('click', abPickFile);
        document.getElementById('ab-back-btn')?.addEventListener('click', abShowShelf);
        document.getElementById('ab-play-btn')?.addEventListener('click', () => {
            (abPlaying && !abPaused) ? abPause() : abPlay();
        });
        document.getElementById('ab-prev-btn')?.addEventListener('click', () => abJumpPage(-1));
        document.getElementById('ab-next-btn')?.addEventListener('click', () => abJumpPage(1));
        document.getElementById('ab-back-chunk')?.addEventListener('click', () => abJump(-1));
        document.getElementById('ab-fwd-chunk')?.addEventListener('click', () => abJump(1));

        const rate = document.getElementById('ab-rate');
        rate?.addEventListener('input', () => {
            abRate = parseFloat(rate.value);
            const rl = document.getElementById('ab-rate-label');
            if (rl) rl.textContent = abRate.toFixed(1) + '×';
            if (abPlaying && !abPaused) abSpeakCurrent();  // apply rate live
        });

        const vsel = document.getElementById('ab-voice-select');
        vsel?.addEventListener('change', () => {
            abVoiceURI = vsel.value;
            localStorage.setItem('vulsor.audiobook.voice', abVoiceURI);
            if (abPlaying && !abPaused) abSpeakCurrent();
        });

        abPopulateVoices();
        if (typeof speechSynthesis !== 'undefined') {
            window.speechSynthesis.onvoiceschanged = abPopulateVoices;
        }
    }
    // Show the shelf unless a book is already loaded in this session.
    if (!abChunks.length && !abLoading) {
        abShowShelf();
    }
    abRenderShelf();
}

// Stop narration when navigating away (wired from main.js too, but safe here).
window.audiobookStop = abStop;
