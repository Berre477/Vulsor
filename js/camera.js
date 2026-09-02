// ── Camera — record video with live whisper subtitles, save to Vault ─────
// Depends on: globals.js (fs, path, VAULT_DIR, ipcRenderer, vaultData),
//             vault.js (saveVaultData, renderVaultGrid, renderVaultFolders)

let camStream      = null;   // MediaStream (video+audio)
let camRecorder    = null;   // MediaRecorder
let camChunks      = [];     // recorded video blobs
let camRecording   = false;
let camStartTime   = 0;
let camTimerInt    = null;

// Subtitle (whisper) capture
let camAudioCtx    = null;
let camProcessor   = null;
let camPcm         = [];      // Float32 chunks for the current caption window
let camFullPcm     = [];      // ALL audio chunks (for accurate final transcription)
let camCaptureRate = 16000;   // actual AudioContext sample rate
let camWindowStart = 0;       // ms (relative to recording start) of current window
let camCaptionInt  = null;
let camSegments    = [];      // [{start, end, text}] for the .srt
let camTranscript  = '';      // accumulated plain text
let camWhisperOk   = false;
let camBusy        = false;   // a transcription is in flight

const CAM_CAPTION_MS = 5000;  // transcribe every 5s
const CAM_SR         = 16000;

function _camEl(id) { return document.getElementById(id); }

// Linear resample a Float32 buffer to a target sample rate
function camResample(buf, fromRate, toRate) {
    if (fromRate === toRate) return buf;
    const ratio = fromRate / toRate;
    const newLen = Math.max(1, Math.round(buf.length / ratio));
    const out = new Float32Array(newLen);
    for (let i = 0; i < newLen; i++) {
        const idx = i * ratio;
        const i0 = Math.floor(idx);
        const i1 = Math.min(i0 + 1, buf.length - 1);
        out[i] = buf[i0] + (buf[i1] - buf[i0]) * (idx - i0);
    }
    return out;
}

async function renderCamera() {
    // Check whisper availability for subtitles
    try {
        const setup = await ipcRenderer.invoke('voice:check-setup');
        camWhisperOk = !!(setup && setup.binInstalled && setup.modelInstalled);
    } catch (_) { camWhisperOk = false; }
    const statusEl = _camEl('camera-whisper-status');
    if (statusEl) statusEl.innerHTML = camWhisperOk
        ? '<i class="fas fa-closed-captioning text-amber-400 mr-1"></i>live subtitles on'
        : 'subtitles need the voice model (open the Voice setup) — video still records';

    await camStartPreview();

    const btn = _camEl('camera-record-btn');
    if (btn) btn.onclick = camToggleRecord;
}

async function camStartPreview() {
    if (camStream) return; // already running
    try {
        camStream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: true,
        });
        const v = _camEl('camera-preview');
        if (v) { v.srcObject = camStream; v.play().catch(()=>{}); }
    } catch (e) {
        const stage = _camEl('camera-preview');
        if (stage) stage.outerHTML = `<div class="text-center text-slate-400 text-sm p-8"><i class="fas fa-video-slash text-2xl mb-3 block text-slate-600"></i>Could not access camera/microphone.<br><span class="text-slate-600 text-xs">${(e.message||'').slice(0,80)}</span></div>`;
    }
}

function camToggleRecord() {
    if (camRecording) camStopRecording();
    else camStartRecording();
}

function camStartRecording() {
    if (!camStream || camRecording) return;
    camChunks = [];
    camSegments = [];
    camTranscript = '';
    camPcm = [];
    camFullPcm = [];
    camWindowStart = 0;
    const tEl = _camEl('camera-transcript'); if (tEl) tEl.textContent = '';
    const note = _camEl('camera-save-note'); if (note) note.style.display = 'none';

    // Pick a supported mime type
    let mime = 'video/webm;codecs=vp9,opus';
    if (!MediaRecorder.isTypeSupported(mime)) mime = 'video/webm;codecs=vp8,opus';
    if (!MediaRecorder.isTypeSupported(mime)) mime = 'video/webm';

    try {
        camRecorder = new MediaRecorder(camStream, { mimeType: mime });
    } catch (e) {
        camRecorder = new MediaRecorder(camStream);
    }
    camRecorder.ondataavailable = e => { if (e.data && e.data.size) camChunks.push(e.data); };
    camRecorder.onstop = camOnRecordingStopped;
    camRecorder.start(1000); // collect in 1s slices

    camRecording = true;
    camStartTime = Date.now();

    // UI
    const btn = _camEl('camera-record-btn');
    if (btn) { btn.innerHTML = '<i class="fas fa-stop text-[10px]"></i> Stop recording'; btn.style.background = '#64748b'; }
    const dot = _camEl('camera-rec-dot'); if (dot) dot.style.display = '';
    const timer = _camEl('camera-timer'); if (timer) timer.style.display = '';
    camTimerInt = setInterval(camUpdateTimer, 500);

    // Start subtitle capture
    if (camWhisperOk) camStartSubtitleCapture();
}

function camUpdateTimer() {
    const timer = _camEl('camera-timer');
    if (!timer) return;
    const s = Math.floor((Date.now() - camStartTime) / 1000);
    const mm = String(Math.floor(s / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    timer.textContent = `${mm}:${ss}`;
}

// ── Subtitle capture via whisper on rolling windows ─────────────────────
function camStartSubtitleCapture() {
    try {
        camAudioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: CAM_SR });
        camCaptureRate = camAudioCtx.sampleRate;
        const src = camAudioCtx.createMediaStreamSource(camStream);
        camProcessor = camAudioCtx.createScriptProcessor(4096, 1, 1);
        camProcessor.onaudioprocess = e => {
            if (!camRecording) return;
            const data = new Float32Array(e.inputBuffer.getChannelData(0));
            camPcm.push(data);
            camFullPcm.push(data);   // keep everything for the accurate final pass
        };
        src.connect(camProcessor);
        camProcessor.connect(camAudioCtx.destination); // output stays silent (we never write it)
        camCaptionInt = setInterval(camFlushCaption, CAM_CAPTION_MS);
    } catch (e) {
        console.error('[camera] subtitle capture failed:', e);
    }
}

async function camFlushCaption() {
    if (!camRecording || camBusy || !camPcm.length) return;
    // Snapshot & reset the window
    const chunks = camPcm; camPcm = [];
    let total = 0; for (const c of chunks) total += c.length;
    if (total < CAM_SR * 0.4) return; // too short, skip
    const merged = new Float32Array(total);
    let off = 0; for (const c of chunks) { merged.set(c, off); off += c.length; }

    const winStart = camWindowStart;
    const winEnd   = Date.now() - camStartTime;
    camWindowStart = winEnd;

    // Whisper requires 16 kHz — resample if the AudioContext gave us something else
    const ctxRate = camAudioCtx.sampleRate;
    const samples = ctxRate === CAM_SR ? merged : camResample(merged, ctxRate, CAM_SR);

    camBusy = true;
    try {
        const r = await ipcRenderer.invoke('voice:transcribe', { samples, sampleRate: CAM_SR });
        if (r && r.ok && r.text) {
            const text = r.text.replace(/\[.*?\]/g, '').trim(); // strip [BLANK_AUDIO] etc.
            if (text) {
                camSegments.push({ start: winStart, end: winEnd, text });
                camTranscript += (camTranscript ? ' ' : '') + text;
                camShowSubtitle(text);
                const tEl = _camEl('camera-transcript');
                if (tEl) { tEl.textContent = camTranscript; tEl.scrollTop = tEl.scrollHeight; }
            }
        }
    } catch (_) {} finally { camBusy = false; }
}

function camShowSubtitle(text) {
    const el = _camEl('camera-subtitle');
    if (!el) return;
    el.textContent = text;
    el.style.display = '';
    clearTimeout(el._hideTimer);
    el._hideTimer = setTimeout(() => { el.style.display = 'none'; }, CAM_CAPTION_MS + 2000);
}

// ── Stop & save ─────────────────────────────────────────────────────────
function camStopRecording() {
    if (!camRecording) return;
    camRecording = false;
    clearInterval(camTimerInt); camTimerInt = null;
    clearInterval(camCaptionInt); camCaptionInt = null;

    // Final caption flush
    if (camWhisperOk) { try { camFlushCaption(); } catch(_){} }

    try { camRecorder && camRecorder.state !== 'inactive' && camRecorder.stop(); } catch(_){}

    // Teardown audio capture
    if (camProcessor) { try { camProcessor.disconnect(); } catch(_){} camProcessor = null; }
    if (camAudioCtx)  { try { camAudioCtx.close(); } catch(_){} camAudioCtx = null; }

    const btn = _camEl('camera-record-btn');
    if (btn) { btn.innerHTML = '<i class="fas fa-circle text-[10px]"></i> Start recording'; btn.style.background = '#ef4444'; }
    const dot = _camEl('camera-rec-dot'); if (dot) dot.style.display = 'none';
}

function camOnRecordingStopped() {
    const blob = new Blob(camChunks, { type: camChunks[0]?.type || 'video/webm' });
    camChunks = [];
    if (!blob.size) return;
    // Give the final caption a moment to land, then ask for name + folder
    setTimeout(() => camOpenSaveModal(blob), 600);
}

// ── Save dialog: choose name + destination folder ───────────────────────
function camOpenSaveModal(blob) {
    document.getElementById('camera-save-modal')?.remove();
    const defaultName = `Recording ${_camStamp()}`;
    const sizeMB = (blob.size / (1024*1024)).toFixed(1);
    const folderOpts = (typeof vaultFolderOptions === 'function') ? vaultFolderOptions(null, 0) : '';
    const m = document.createElement('div');
    m.id = 'camera-save-modal';
    m.className = 'settings-backdrop';
    m.style.display = 'flex';
    m.innerHTML = `
        <div class="bg-slate-900 border border-slate-700/60 rounded-2xl w-[460px] flex flex-col shadow-2xl overflow-hidden">
            <div class="px-5 py-4 border-b border-slate-800/80 flex items-center justify-between shrink-0">
                <h3 class="text-slate-100 text-sm font-semibold flex items-center gap-2"><i class="fas fa-video text-red-400"></i>Save recording</h3>
                <span class="text-slate-600 text-[11px]">${sizeMB} MB${camSegments.length ? ' · subtitles' : ''}</span>
            </div>
            <div class="p-5 flex flex-col gap-3">
                <div>
                    <label class="block text-slate-500 text-[10px] uppercase tracking-widest font-semibold mb-1.5">Name</label>
                    <input id="camera-save-name" type="text" value="${defaultName.replace(/"/g,'&quot;')}"
                        class="w-full bg-slate-800/80 text-slate-100 text-sm border border-slate-700/60 rounded-xl px-4 py-2.5 outline-none focus:border-red-500/60" style="color-scheme:dark">
                </div>
                <div>
                    <label class="block text-slate-500 text-[10px] uppercase tracking-widest font-semibold mb-1.5">Save to folder</label>
                    <select id="camera-save-folder" class="w-full bg-slate-800/80 text-slate-100 text-sm border border-slate-700/60 rounded-xl px-3 py-2.5 outline-none focus:border-red-500/60" style="color-scheme:dark">
                        <option value="">Vault (no folder)</option>
                        ${folderOpts}
                    </select>
                </div>
                <div class="flex items-center justify-between mt-1">
                    <button id="camera-save-discard" class="text-slate-500 hover:text-red-400 text-xs font-medium transition-colors"><i class="fas fa-trash mr-1"></i>Discard</button>
                    <button id="camera-save-confirm" class="px-5 py-2.5 rounded-xl bg-red-500 hover:bg-red-400 text-white text-sm font-semibold transition-colors">Save to Vault</button>
                </div>
            </div>
        </div>`;
    document.body.appendChild(m);
    const nameInput = m.querySelector('#camera-save-name');
    setTimeout(() => { nameInput.focus(); nameInput.select(); }, 50);
    // Pre-select the folder currently open in the Vault, if any
    if (typeof vaultActiveFolderId !== 'undefined' && vaultActiveFolderId) {
        const sel = m.querySelector('#camera-save-folder');
        if (sel) sel.value = vaultActiveFolderId;
    }
    m.querySelector('#camera-save-confirm').onclick = () => {
        const name = (nameInput.value.trim() || defaultName);
        const folderId = m.querySelector('#camera-save-folder').value || null;
        m.remove();
        camSaveToVault(blob, name, folderId);
    };
    m.querySelector('#camera-save-discard').onclick = () => { m.remove(); };
    nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') m.querySelector('#camera-save-confirm').click(); });
}

function _camPad(n, w) { return String(n).padStart(w, '0'); }
function _camStamp() {
    const d = new Date();
    return `${d.getFullYear()}-${_camPad(d.getMonth()+1,2)}-${_camPad(d.getDate(),2)} ${_camPad(d.getHours(),2)}-${_camPad(d.getMinutes(),2)}-${_camPad(d.getSeconds(),2)}`;
}
function _camMsToSrt(ms) {
    ms = Math.max(0, Math.floor(ms));
    const h = Math.floor(ms/3600000); ms -= h*3600000;
    const m = Math.floor(ms/60000);   ms -= m*60000;
    const s = Math.floor(ms/1000);    ms -= s*1000;
    return `${_camPad(h,2)}:${_camPad(m,2)}:${_camPad(s,2)},${_camPad(ms,3)}`;
}
function _camBuildSrt() {
    return camSegments.map((seg, i) =>
        `${i+1}\n${_camMsToSrt(seg.start)} --> ${_camMsToSrt(seg.end)}\n${seg.text}\n`
    ).join('\n');
}

async function camSaveToVault(blob, name, folderId) {
    try {
        const baseName = (name || `Recording ${_camStamp()}`).replace(/[\/\\:*?"<>|]/g, '-');

        // ── Accurate final transcription (full audio, with real timestamps) ──
        if (camWhisperOk && camFullPcm.length) {
            const note = _camEl('camera-save-note');
            if (note) { note.style.display = ''; note.innerHTML = '<i class="fas fa-circle-notch fa-spin mr-1"></i>Transcribing for accurate subtitles…'; }
            try {
                let total = 0; for (const c of camFullPcm) total += c.length;
                const full = new Float32Array(total);
                let o = 0; for (const c of camFullPcm) { full.set(c, o); o += c.length; }
                const samples = camCaptureRate === CAM_SR ? full : camResample(full, camCaptureRate, CAM_SR);
                const r = await ipcRenderer.invoke('voice:transcribe-timed', { samples, sampleRate: CAM_SR });
                if (r && r.ok && r.segments && r.segments.length) {
                    camSegments = r.segments;            // replace rough live captions with accurate ones
                    camTranscript = r.text || camTranscript;
                }
            } catch (_) { /* keep live captions as fallback */ }
        }

        const dest = folderId || null;
        const id = 'vf_' + Date.now() + '_' + Math.random().toString(36).slice(2,7);
        const storedName = id + '.webm';
        const buf = Buffer.from(await blob.arrayBuffer());
        fs.writeFileSync(path.join(VAULT_DIR, storedName), buf);
        const stats = fs.statSync(path.join(VAULT_DIR, storedName));

        // Video entry (transcript stored in its notes)
        vaultData.files.unshift({
            id, originalName: baseName + '.webm', storedName,
            folderId: dest,
            notes: camTranscript || '', pageNotes: {}, addedAt: Date.now(), size: stats.size,
        });

        // Subtitles (.srt) entry
        if (camSegments.length) {
            const srtId = 'vf_' + Date.now() + '_' + Math.random().toString(36).slice(2,7);
            const srtName = srtId + '.srt';
            fs.writeFileSync(path.join(VAULT_DIR, srtName), _camBuildSrt());
            const srtStats = fs.statSync(path.join(VAULT_DIR, srtName));
            vaultData.files.unshift({
                id: srtId, originalName: baseName + '.srt', storedName: srtName,
                folderId: dest,
                notes: '', pageNotes: {}, addedAt: Date.now(), size: srtStats.size,
            });
        }

        if (typeof saveVaultData === 'function') saveVaultData();
        if (typeof renderVaultGrid === 'function') renderVaultGrid();
        if (typeof renderVaultFolders === 'function') renderVaultFolders();

        const note = _camEl('camera-save-note');
        if (note) {
            note.style.display = '';
            note.innerHTML = `<i class="fas fa-check-circle text-green-400 mr-1"></i>Saved to Vault as <span class="text-slate-300">${baseName}.webm</span>${camSegments.length ? ' + subtitles (.srt)' : ''}.`;
        }
    } catch (e) {
        const note = _camEl('camera-save-note');
        if (note) { note.style.display = ''; note.innerHTML = `<span class="text-red-400">Save failed: ${(e.message||'').slice(0,80)}</span>`; }
        console.error('[camera] save failed:', e);
    }
}

// Stop everything when leaving the Camera view
function cameraStopAll() {
    if (camRecording) { try { camStopRecording(); } catch(_){} }
    clearInterval(camTimerInt); camTimerInt = null;
    clearInterval(camCaptionInt); camCaptionInt = null;
    if (camProcessor) { try { camProcessor.disconnect(); } catch(_){} camProcessor = null; }
    if (camAudioCtx)  { try { camAudioCtx.close(); } catch(_){} camAudioCtx = null; }
    if (camStream) {
        try { camStream.getTracks().forEach(t => t.stop()); } catch(_){}
        camStream = null;
    }
    const v = _camEl('camera-preview'); if (v) v.srcObject = null;
}
