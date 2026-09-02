// ── Video editor — trim + text overlays via ffmpeg, saves to Vault ───────
// Depends on: globals.js (fs, path, VAULT_DIR, ipcRenderer, vaultData),
//             vault.js (saveVaultData, renderVaultGrid, renderVaultFolders, openVaultFile)

let vedFileId   = null;
let vedDuration = 0;
let vedTexts    = [];   // [{text, pos, size}]

function _vedEsc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function _vedFmt(t){ t=Math.max(0,t||0); const m=Math.floor(t/60), s=(t%60); return `${m}:${String(Math.floor(s)).padStart(2,'0')}`; }

async function openVideoEditor(fileId) {
    const file = vaultData.files.find(f => f.id === fileId);
    if (!file) return;
    const avail = await ipcRenderer.invoke('ffmpeg-available').catch(() => ({ ok: false }));
    vedFileId = fileId;
    vedTexts = [];
    const src = 'file://' + path.join(VAULT_DIR, file.storedName).replace(/ /g, '%20');

    document.getElementById('ved-modal')?.remove();
    const m = document.createElement('div');
    m.id = 'ved-modal';
    m.className = 'settings-backdrop';
    m.style.cssText = 'display:flex; z-index:300';
    m.innerHTML = `
        <div class="bg-slate-900 border border-slate-700/60 rounded-2xl w-[760px] max-w-[94vw] max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
            <div class="px-5 py-3 border-b border-slate-800/80 flex items-center justify-between shrink-0">
                <h3 class="text-slate-100 text-sm font-semibold flex items-center gap-2"><i class="fas fa-scissors text-red-400"></i>Edit video</h3>
                <button onclick="vedClose()" class="text-slate-500 hover:text-white w-7 h-7 flex items-center justify-center rounded-lg hover:bg-slate-800 transition-colors"><i class="fas fa-times"></i></button>
            </div>
            ${!avail.ok ? `<div class="p-6 text-center text-slate-400 text-sm">Video editing needs ffmpeg.<br><span class="text-slate-600 text-xs font-mono">brew install ffmpeg</span></div>` : `
            <div class="overflow-y-auto chat-scroll p-5 flex flex-col gap-4">
                <video id="ved-video" src="${src}" controls class="w-full rounded-xl bg-black" style="max-height:42vh"></video>

                <!-- Trim -->
                <div>
                    <p class="text-slate-400 text-[10px] uppercase tracking-widest font-semibold mb-2"><i class="fas fa-scissors mr-1"></i>Trim</p>
                    <div class="flex items-center gap-3">
                        <div class="flex-1">
                            <label class="text-slate-500 text-[10px]">Start</label>
                            <div class="flex items-center gap-1.5">
                                <input id="ved-start" type="number" min="0" step="0.1" value="0" class="w-20 bg-slate-800/80 text-slate-100 text-sm border border-slate-700/60 rounded-lg px-2 py-1.5 outline-none focus:border-red-500/60" style="color-scheme:dark">
                                <span class="text-slate-600 text-[10px]">s</span>
                                <button onclick="vedSetNow('start')" class="text-[10px] px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300">⤓ playhead</button>
                            </div>
                        </div>
                        <div class="flex-1">
                            <label class="text-slate-500 text-[10px]">End</label>
                            <div class="flex items-center gap-1.5">
                                <input id="ved-end" type="number" min="0" step="0.1" value="0" class="w-20 bg-slate-800/80 text-slate-100 text-sm border border-slate-700/60 rounded-lg px-2 py-1.5 outline-none focus:border-red-500/60" style="color-scheme:dark">
                                <span class="text-slate-600 text-[10px]">s</span>
                                <button onclick="vedSetNow('end')" class="text-[10px] px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300">⤓ playhead</button>
                            </div>
                        </div>
                        <div class="text-slate-600 text-[11px] self-end pb-1.5">Duration: <span id="ved-dur">–</span></div>
                    </div>
                </div>

                <!-- Text overlays -->
                <div>
                    <p class="text-slate-400 text-[10px] uppercase tracking-widest font-semibold mb-2"><i class="fas fa-font mr-1"></i>Text overlay</p>
                    <div class="flex items-center gap-2 mb-2">
                        <input id="ved-text-input" type="text" placeholder="Text to add…" class="flex-1 bg-slate-800/80 text-slate-100 text-sm border border-slate-700/60 rounded-lg px-3 py-2 outline-none focus:border-red-500/60" style="color-scheme:dark">
                        <select id="ved-text-pos" class="bg-slate-800/80 text-slate-100 text-xs border border-slate-700/60 rounded-lg px-2 py-2 outline-none" style="color-scheme:dark">
                            <option value="bottom">Bottom</option><option value="center">Center</option><option value="top">Top</option>
                        </select>
                        <input id="ved-text-size" type="number" min="10" max="200" value="36" title="Font size" class="w-16 bg-slate-800/80 text-slate-100 text-xs border border-slate-700/60 rounded-lg px-2 py-2 outline-none" style="color-scheme:dark">
                        <button onclick="vedAddText()" class="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium">Add</button>
                    </div>
                    <div id="ved-text-list" class="flex flex-col gap-1"></div>
                </div>
            </div>
            <div class="px-5 py-3 border-t border-slate-800/80 flex items-center justify-between shrink-0">
                <span id="ved-status" class="text-slate-500 text-xs"></span>
                <button id="ved-export-btn" onclick="vedExport()" class="px-5 py-2.5 rounded-xl bg-red-500 hover:bg-red-400 text-white text-sm font-semibold transition-colors">Export to Vault</button>
            </div>`}
        </div>`;
    document.body.appendChild(m);
    m.addEventListener('click', e => { if (e.target === m) vedClose(); });

    if (avail.ok) {
        const v = document.getElementById('ved-video');
        v.addEventListener('loadedmetadata', () => {
            vedDuration = v.duration || 0;
            const endEl = document.getElementById('ved-end');
            if (endEl) endEl.value = vedDuration.toFixed(1);
            vedUpdateDur();
        });
        ['ved-start','ved-end'].forEach(id => document.getElementById(id)?.addEventListener('input', vedUpdateDur));
    }
}

function vedUpdateDur() {
    const s = parseFloat(document.getElementById('ved-start')?.value) || 0;
    const e = parseFloat(document.getElementById('ved-end')?.value) || 0;
    const d = document.getElementById('ved-dur');
    if (d) d.textContent = e > s ? _vedFmt(e - s) : '–';
}
function vedSetNow(which) {
    const v = document.getElementById('ved-video');
    if (!v) return;
    const el = document.getElementById(which === 'start' ? 'ved-start' : 'ved-end');
    if (el) { el.value = v.currentTime.toFixed(1); vedUpdateDur(); }
}
function vedAddText() {
    const inp = document.getElementById('ved-text-input');
    const text = (inp.value || '').trim();
    if (!text) return;
    vedTexts.push({ text, pos: document.getElementById('ved-text-pos').value, size: parseInt(document.getElementById('ved-text-size').value) || 36 });
    inp.value = '';
    vedRenderTexts();
}
function vedRemoveText(i) { vedTexts.splice(i, 1); vedRenderTexts(); }
function vedRenderTexts() {
    const list = document.getElementById('ved-text-list');
    if (!list) return;
    list.innerHTML = vedTexts.map((t, i) =>
        `<div class="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800/60 text-xs">
            <i class="fas fa-font text-slate-500 text-[10px]"></i>
            <span class="flex-1 text-slate-200 truncate">${_vedEsc(t.text)}</span>
            <span class="text-slate-500 text-[10px]">${t.pos} · ${t.size}px</span>
            <button onclick="vedRemoveText(${i})" class="text-slate-600 hover:text-red-400"><i class="fas fa-times text-[10px]"></i></button>
        </div>`).join('');
}

async function vedExport() {
    const file = vaultData.files.find(f => f.id === vedFileId);
    if (!file) return;
    const start = parseFloat(document.getElementById('ved-start').value) || 0;
    const end   = parseFloat(document.getElementById('ved-end').value) || vedDuration;
    const duration = (end > start) ? (end - start) : 0;
    const status = document.getElementById('ved-status');
    const btn = document.getElementById('ved-export-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Exporting…'; btn.style.opacity = '0.6'; }
    if (status) status.innerHTML = '<i class="fas fa-circle-notch fa-spin mr-1"></i>Rendering with ffmpeg…';

    const newId = 'vf_' + Date.now() + '_' + Math.random().toString(36).slice(2,7);
    const outName = newId + '.mp4';

    // Render text overlays to a transparent PNG at the video's resolution
    let overlayPng = null;
    try {
        if (vedTexts.length) {
            const v = document.getElementById('ved-video');
            const vw = v.videoWidth || 1280, vh = v.videoHeight || 720;
            const canvas = document.createElement('canvas');
            canvas.width = vw; canvas.height = vh;
            const ctx = canvas.getContext('2d');
            ctx.textAlign = 'center';
            ctx.textBaseline = 'alphabetic';
            vedTexts.forEach(t => {
                const size = Math.max(10, Math.min(200, parseInt(t.size) || 36));
                ctx.font = `bold ${size}px Arial, Helvetica, sans-serif`;
                ctx.lineWidth = Math.max(3, size * 0.14);
                ctx.lineJoin = 'round';
                ctx.strokeStyle = 'rgba(0,0,0,0.75)';
                ctx.fillStyle = '#ffffff';
                let y;
                if (t.pos === 'top') y = size + 30;
                else if (t.pos === 'center') y = vh / 2 + size / 3;
                else y = vh - 45;
                ctx.strokeText(t.text, vw / 2, y);
                ctx.fillText(t.text, vw / 2, y);
            });
            const b64 = canvas.toDataURL('image/png').split(',')[1];
            overlayPng = path.join(os.tmpdir(), 'ved_' + Date.now() + '.png');
            fs.writeFileSync(overlayPng, Buffer.from(b64, 'base64'));
        }
    } catch (e) { console.error('[video] overlay render failed:', e); }

    try {
        const r = await ipcRenderer.invoke('ffmpeg-edit', {
            storedName: file.storedName, start, duration, overlayPng, outName,
        });
        if (!r || !r.ok) {
            if (status) status.innerHTML = `<span class="text-red-400">Failed: ${_vedEsc(String(r && r.error || 'error').slice(0,90))}</span>`;
            if (btn) { btn.disabled = false; btn.textContent = 'Export to Vault'; btn.style.opacity = '1'; }
            return;
        }
        const base = file.originalName.replace(/\.[^.]+$/, '');
        vaultData.files.unshift({
            id: newId, originalName: base + ' (edited).mp4', storedName: outName,
            folderId: file.folderId || null, notes: '', pageNotes: {}, addedAt: Date.now(), size: r.size || 0,
        });
        if (typeof saveVaultData === 'function') saveVaultData();
        if (typeof renderVaultGrid === 'function') renderVaultGrid();
        if (typeof renderVaultFolders === 'function') renderVaultFolders();
        vedClose();
        if (typeof openVaultFile === 'function') openVaultFile(newId);
    } catch (e) {
        if (status) status.innerHTML = `<span class="text-red-400">${_vedEsc(e.message)}</span>`;
        if (btn) { btn.disabled = false; btn.textContent = 'Export to Vault'; btn.style.opacity = '1'; }
    }
}

function vedClose() { document.getElementById('ved-modal')?.remove(); }
