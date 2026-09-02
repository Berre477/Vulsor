// ── Editor — timeline video editor (multi-clip, text, music, export) ─────
// Depends on: globals.js (fs, path, os, VAULT_DIR, ipcRenderer, vaultData),
//             vault.js (saveVaultData, renderVaultGrid, openVaultFile)

// Clip model:
//  video: {id, track:'video', fileId, name, src, inP, outP}          (dur = outP-inP)
//  text:  {id, track:'text',  text, pos, size, color, start, dur}
//  music: {id, track:'music', fileId, name, src, inP, outP, start, volume, muteOriginal}
let edVideo = [];     // ordered, laid contiguously from t=0
let edText  = [];
let edMusic = null;   // single music clip or null

let edPxPerSec = 60;
let edPlayhead = 0;
let edPlaying  = false;
let edSelected = null;     // {type, id}
let edRaf      = null;
let edClock0   = 0;        // performance.now baseline
let edBase0    = 0;        // playhead at clock baseline
let edCurSrc   = '';       // currently loaded preview src
let edAudioEl  = null;     // music preview element

const ED_VID_H = 46, ED_TXT_H = 34, ED_AUD_H = 38;

function _edId(p){ return p + Date.now() + Math.random().toString(36).slice(2,6); }
function _edEsc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function _edFmt(t){ t=Math.max(0,t||0); const m=Math.floor(t/60); const s=Math.floor(t%60); return `${m}:${String(s).padStart(2,'0')}`; }

function edDur(c){ return Math.max(0.05, (c.outP - c.inP)); }
function edVideoStart(i){ let s=0; for(let k=0;k<i;k++) s+=edDur(edVideo[k]); return s; }
function edTotal(){ let s=0; for(const c of edVideo) s+=edDur(c); return s; }

// ── Render ───────────────────────────────────────────────────────────────
function renderEditor() {
    edRefreshBin();
    edRenderTimeline();
    edRenderFrame(edPlayhead);
    const z = document.getElementById('ed-zoom');
    if (z) z.oninput = () => { edPxPerSec = +z.value; edRenderTimeline(); edUpdatePlayhead(); };
    _edWireTimelineClicks();
}

function edRefreshBin() {
    const bin = document.getElementById('ed-bin');
    if (!bin) return;
    const vids = (vaultData?.files || []).filter(f => ['mp4','webm','mov','m4v','mkv','ogv'].includes((f.originalName.split('.').pop()||'').toLowerCase()));
    const auds = (vaultData?.files || []).filter(f => ['mp3','wav','m4a','aac','ogg','flac'].includes((f.originalName.split('.').pop()||'').toLowerCase()));
    if (!vids.length && !auds.length) {
        bin.innerHTML = `<p class="text-slate-600 text-[11px] italic p-2 text-center">No videos in the Vault yet. Record with the Camera, then come back.</p>`;
        return;
    }
    const row = (f, isAud) => `<div class="ed-bin-item flex items-center gap-2 px-2 py-1.5 rounded-lg border border-slate-700/50 hover:border-amber-500/50 hover:bg-slate-800/50 cursor-pointer transition-colors"
            onclick="edAddClip('${f.id}', ${isAud})">
        <i class="fas ${isAud?'fa-music':'fa-file-video'} text-[11px] shrink-0" style="color:${isAud?'#fb923c':'#34d399'}"></i>
        <span class="text-slate-200 text-[11px] truncate flex-1">${_edEsc(f.originalName)}</span>
        <i class="fas fa-plus text-[9px] text-slate-500"></i>
    </div>`;
    bin.innerHTML =
        (vids.length ? `<div class="text-slate-600 text-[9px] uppercase tracking-wider px-1 mb-0.5">Video</div>` + vids.map(f=>row(f,false)).join('') : '') +
        (auds.length ? `<div class="text-slate-600 text-[9px] uppercase tracking-wider px-1 mt-2 mb-0.5">Audio</div>` + auds.map(f=>row(f,true)).join('') : '');
}

function edAddClip(fileId, isAud) {
    const f = vaultData.files.find(x => x.id === fileId);
    if (!f) return;
    const src = 'file://' + path.join(VAULT_DIR, f.storedName).replace(/ /g, '%20');
    // probe duration via a temp media element
    const probe = document.createElement(isAud ? 'audio' : 'video');
    probe.preload = 'metadata';
    probe.src = src;
    probe.addEventListener('loadedmetadata', () => {
        const d = probe.duration && isFinite(probe.duration) ? probe.duration : 10;
        if (isAud) {
            edMusic = { id:_edId('m_'), track:'music', fileId, name:f.originalName, src, inP:0, outP:d, start:0, volume:0.8, muteOriginal:false };
        } else {
            edVideo.push({ id:_edId('v_'), track:'video', fileId, name:f.originalName, src, inP:0, outP:d });
        }
        edRenderTimeline();
        if (edVideo.length && !edCurSrc) edRenderFrame(edPlayhead);
    });
    probe.addEventListener('error', () => {
        // fallback duration
        if (isAud) edMusic = { id:_edId('m_'), track:'music', fileId, name:f.originalName, src, inP:0, outP:30, start:0, volume:0.8, muteOriginal:false };
        else edVideo.push({ id:_edId('v_'), track:'video', fileId, name:f.originalName, src, inP:0, outP:10 });
        edRenderTimeline();
    });
}

function edAddText() {
    const t = edTotal();
    edText.push({ id:_edId('t_'), track:'text', text:'Your text', pos:'bottom', size:42, color:'#ffffff', start: Math.min(edPlayhead, Math.max(0,t-2)), dur: Math.min(3, Math.max(1, t||3)) });
    edSelected = { type:'text', id: edText[edText.length-1].id };
    edRenderTimeline();
    edOpenInspector();
}

function edAddMusic() {
    // Point user to the Audio section of the media bin
    edSetStatus('Pick an audio file from the Media panel (left) to add music.');
}

// ── Timeline rendering ────────────────────────────────────────────────────
function edRenderTimeline() {
    const total = Math.max(edTotal(), edPlayhead + 2, 10);
    const width = Math.max(total * edPxPerSec + 40, 400);

    // Ruler
    const ruler = document.getElementById('ed-ruler');
    if (ruler) {
        ruler.style.width = width + 'px';
        let ticks = '';
        const step = edPxPerSec < 40 ? 5 : 1;
        for (let s = 0; s <= total; s += step) {
            const x = s * edPxPerSec;
            ticks += `<div class="absolute top-0 h-full border-l border-slate-700/50" style="left:${x}px"><span class="text-slate-500 text-[9px] ml-1">${_edFmt(s)}</span></div>`;
        }
        ruler.innerHTML = ticks;
    }

    const tracks = document.getElementById('ed-tracks');
    if (!tracks) return;
    tracks.style.width = width + 'px';

    // Video track (contiguous)
    let vHtml = '';
    let acc = 0;
    edVideo.forEach((c, i) => {
        const left = acc * edPxPerSec;
        const w = edDur(c) * edPxPerSec;
        acc += edDur(c);
        const sel = edSelected && edSelected.type==='video' && edSelected.id===c.id;
        vHtml += `<div class="ed-clip ed-clip-video ${sel?'ed-clip-sel':''}" data-type="video" data-id="${c.id}" data-idx="${i}"
            style="left:${left}px;width:${w}px">
            <div class="ed-clip-handle ed-handle-l" data-edge="l"></div>
            <span class="ed-clip-label">${_edEsc(c.name)}</span>
            <div class="ed-clip-handle ed-handle-r" data-edge="r"></div>
        </div>`;
    });

    // Text track (free)
    let tHtml = '';
    edText.forEach(c => {
        const left = c.start * edPxPerSec, w = c.dur * edPxPerSec;
        const sel = edSelected && edSelected.type==='text' && edSelected.id===c.id;
        tHtml += `<div class="ed-clip ed-clip-text ${sel?'ed-clip-sel':''}" data-type="text" data-id="${c.id}"
            style="left:${left}px;width:${w}px">
            <div class="ed-clip-handle ed-handle-l" data-edge="l"></div>
            <span class="ed-clip-label"><i class="fas fa-font text-[8px] mr-1"></i>${_edEsc(c.text)}</span>
            <div class="ed-clip-handle ed-handle-r" data-edge="r"></div>
        </div>`;
    });

    // Music track
    let mHtml = '';
    if (edMusic) {
        const left = edMusic.start * edPxPerSec, w = edDur(edMusic) * edPxPerSec;
        const sel = edSelected && edSelected.type==='music';
        mHtml = `<div class="ed-clip ed-clip-music ${sel?'ed-clip-sel':''}" data-type="music" data-id="${edMusic.id}"
            style="left:${left}px;width:${w}px">
            <div class="ed-clip-handle ed-handle-l" data-edge="l"></div>
            <span class="ed-clip-label"><i class="fas fa-music text-[8px] mr-1"></i>${_edEsc(edMusic.name)}</span>
            <div class="ed-clip-handle ed-handle-r" data-edge="r"></div>
        </div>`;
    }

    tracks.innerHTML = `
        <div class="ed-track" style="height:${ED_VID_H}px"><div class="ed-track-label">V1</div>${vHtml}</div>
        <div class="ed-track" style="height:${ED_TXT_H}px"><div class="ed-track-label">T1</div>${tHtml}</div>
        <div class="ed-track" style="height:${ED_AUD_H}px"><div class="ed-track-label">A1</div>${mHtml}</div>`;

    _edWireClipDrag();
    edUpdatePlayhead();
    edUpdateTime();
}

function edUpdatePlayhead() {
    const ph = document.getElementById('ed-playhead');
    if (ph) ph.style.left = (edPlayhead * edPxPerSec) + 'px';
}
function edUpdateTime() {
    const el = document.getElementById('ed-time');
    if (el) el.textContent = `${_edFmt(edPlayhead)} / ${_edFmt(edTotal())}`;
}

// ── Clip interactions (drag move / trim, select) ──────────────────────────
function _edWireClipDrag() {
    document.querySelectorAll('#ed-tracks .ed-clip').forEach(el => {
        el.addEventListener('mousedown', e => {
            const type = el.dataset.type, id = el.dataset.id;
            edSelected = { type, id };
            const edge = e.target.dataset && e.target.dataset.edge;
            const startX = e.clientX;
            const obj = type==='video' ? edVideo.find(c=>c.id===id) : type==='text' ? edText.find(c=>c.id===id) : edMusic;
            if (!obj) return;
            const o = { inP:obj.inP, outP:obj.outP, start:obj.start||0, idx: edVideo.indexOf(obj) };
            e.preventDefault(); e.stopPropagation();
            const move = ev => {
                const dxSec = (ev.clientX - startX) / edPxPerSec;
                if (edge === 'l') {
                    if (type==='video') { obj.inP = Math.max(0, Math.min(o.inP + dxSec, obj.outP - 0.1)); }
                    else { obj.start = Math.max(0, o.start + dxSec); obj.dur = Math.max(0.2, (o.start + (o.outP? (o.outP-o.inP):obj.dur)) - obj.start); if(type==='text'){ obj.dur = Math.max(0.2, (o.start+ obj.dur) - obj.start);} }
                } else if (edge === 'r') {
                    if (type==='video') { obj.outP = Math.max(obj.inP + 0.1, o.outP + dxSec); }
                    else { obj.dur = Math.max(0.2, (type==='music'? edDur(obj): obj.dur) + dxSec); if(type==='music'){ obj.outP = Math.max(obj.inP+0.2, o.outP + dxSec); } }
                } else {
                    // move body
                    if (type==='video') {
                        // reorder by dragging across neighbors
                        const newStart = Math.max(0, edVideoStart(o.idx) + dxSec);
                        edReorderVideoByStart(obj, newStart);
                    } else {
                        obj.start = Math.max(0, o.start + dxSec);
                    }
                }
                edRenderTimeline();
            };
            const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); edRenderFrame(edPlayhead); edOpenInspector(); };
            document.addEventListener('mousemove', move);
            document.addEventListener('mouseup', up);
        });
    });
}

function edReorderVideoByStart(clip, newStart) {
    const idx = edVideo.indexOf(clip);
    if (idx < 0) return;
    edVideo.splice(idx, 1);
    let acc = 0, insertAt = edVideo.length;
    for (let i=0;i<edVideo.length;i++){ const mid = acc + edDur(edVideo[i])/2; if (newStart < mid){ insertAt = i; break; } acc += edDur(edVideo[i]); }
    edVideo.splice(insertAt, 0, clip);
}

function _edWireTimelineClicks() {
    const scroll = document.getElementById('ed-timeline-scroll');
    const ruler = document.getElementById('ed-ruler');
    const seekFromEvent = e => {
        const rect = document.getElementById('ed-tracks').getBoundingClientRect();
        const x = e.clientX - rect.left + scroll.scrollLeft;
        edPlayhead = Math.max(0, x / edPxPerSec);
        edPause();
        edUpdatePlayhead(); edUpdateTime(); edRenderFrame(edPlayhead);
    };
    if (ruler) ruler.addEventListener('mousedown', seekFromEvent);
}

// ── Split / delete ────────────────────────────────────────────────────────
function edSplit() {
    // split the video clip under the playhead
    let acc = 0;
    for (let i=0;i<edVideo.length;i++){
        const c = edVideo[i], d = edDur(c);
        if (edPlayhead > acc + 0.05 && edPlayhead < acc + d - 0.05) {
            const cutLocal = edPlayhead - acc; // seconds into the clip
            const cutSrc = c.inP + cutLocal;
            const right = { ...c, id:_edId('v_'), inP: cutSrc };
            c.outP = cutSrc;
            edVideo.splice(i+1, 0, right);
            edRenderTimeline();
            edSetStatus('Clip split.');
            return;
        }
        acc += d;
    }
    edSetStatus('Move the playhead over a clip to split it.');
}

function edDeleteSelected() {
    if (!edSelected) return;
    if (edSelected.type==='video') edVideo = edVideo.filter(c=>c.id!==edSelected.id);
    else if (edSelected.type==='text') edText = edText.filter(c=>c.id!==edSelected.id);
    else if (edSelected.type==='music') edMusic = null;
    edSelected = null;
    edRenderTimeline(); edRenderFrame(edPlayhead);
}

// ── Inspector (edit selected text/music props) ────────────────────────────
function edOpenInspector() {
    document.getElementById('ed-inspector')?.remove();
    if (!edSelected) return;
    let html = '';
    if (edSelected.type === 'text') {
        const c = edText.find(x=>x.id===edSelected.id); if(!c) return;
        html = `<div class="flex flex-col gap-2">
            <input id="ed-ins-text" value="${_edEsc(c.text)}" class="ed-ins-input" placeholder="Text">
            <div class="flex gap-2">
                <select id="ed-ins-pos" class="ed-ins-input flex-1">
                    <option value="bottom"${c.pos==='bottom'?' selected':''}>Bottom</option>
                    <option value="center"${c.pos==='center'?' selected':''}>Center</option>
                    <option value="top"${c.pos==='top'?' selected':''}>Top</option>
                </select>
                <input id="ed-ins-size" type="number" min="10" max="200" value="${c.size}" class="ed-ins-input" style="width:64px">
                <input id="ed-ins-color" type="color" value="${c.color}" class="ed-ins-input" style="width:42px;padding:2px">
            </div>
        </div>`;
    } else if (edSelected.type === 'music') {
        if(!edMusic) return;
        html = `<div class="flex items-center gap-3">
            <span class="text-slate-400 text-[11px]">Volume</span>
            <input id="ed-ins-vol" type="range" min="0" max="1" step="0.05" value="${edMusic.volume}" class="flex-1">
            <label class="text-slate-400 text-[11px] flex items-center gap-1"><input id="ed-ins-mute" type="checkbox" ${edMusic.muteOriginal?'checked':''}> mute video audio</label>
        </div>`;
    } else return;

    const ins = document.createElement('div');
    ins.id = 'ed-inspector';
    ins.style.cssText = 'position:absolute; right:12px; bottom:218px; z-index:40; background:#111827; border:1px solid rgba(148,163,184,0.2); border-radius:12px; padding:12px; width:300px; box-shadow:0 12px 30px rgba(0,0,0,0.5)';
    ins.innerHTML = `<div class="text-[10px] uppercase tracking-widest text-slate-500 font-semibold mb-2">${edSelected.type} properties</div>${html}`;
    document.getElementById('view-editor').appendChild(ins);

    if (edSelected.type==='text') {
        const c = edText.find(x=>x.id===edSelected.id);
        ins.querySelector('#ed-ins-text').oninput = e => { c.text = e.target.value; edRenderTimeline(); edRenderFrame(edPlayhead); };
        ins.querySelector('#ed-ins-pos').onchange = e => { c.pos = e.target.value; edRenderFrame(edPlayhead); };
        ins.querySelector('#ed-ins-size').oninput = e => { c.size = +e.target.value; edRenderFrame(edPlayhead); };
        ins.querySelector('#ed-ins-color').oninput = e => { c.color = e.target.value; edRenderFrame(edPlayhead); };
    } else if (edSelected.type==='music') {
        ins.querySelector('#ed-ins-vol').oninput = e => { edMusic.volume = +e.target.value; if(edAudioEl) edAudioEl.volume = edMusic.volume; };
        ins.querySelector('#ed-ins-mute').onchange = e => { edMusic.muteOriginal = e.target.checked; edRenderFrame(edPlayhead); };
    }
}

// ── Preview ───────────────────────────────────────────────────────────────
function _edActiveVideo(t) {
    let acc = 0;
    for (const c of edVideo) { const d = edDur(c); if (t >= acc && t < acc + d) return { clip:c, local: t-acc }; acc += d; }
    return null;
}
function edRenderFrame(t) {
    const v = document.getElementById('ed-preview');
    const av = _edActiveVideo(t);
    if (v) {
        if (av) {
            if (edCurSrc !== av.clip.src) { edCurSrc = av.clip.src; v.src = av.clip.src; }
            const target = av.clip.inP + av.local;
            if (!edPlaying || Math.abs(v.currentTime - target) > 0.35) { try { v.currentTime = target; } catch(_){} }
            v.muted = !!(edMusic && edMusic.muteOriginal);
        } else { try { v.removeAttribute('src'); v.load(); } catch(_){} edCurSrc=''; }
    }
    edDrawOverlay(t);
}
function edDrawOverlay(t) {
    const v = document.getElementById('ed-preview');
    const cv = document.getElementById('ed-overlay');
    if (!cv || !v) return;
    const w = v.clientWidth, h = v.clientHeight;
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0,0,w,h);
    ctx.textAlign = 'center';
    edText.forEach(c => {
        if (t < c.start || t > c.start + c.dur) return;
        const size = Math.max(10, c.size) * (h / 720); // scale to preview
        ctx.font = `bold ${size}px Arial, sans-serif`;
        ctx.lineWidth = Math.max(2, size*0.14); ctx.lineJoin='round';
        ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.fillStyle = c.color || '#fff';
        let y; if (c.pos==='top') y = size+20; else if (c.pos==='center') y = h/2; else y = h-25;
        ctx.strokeText(c.text, w/2, y); ctx.fillText(c.text, w/2, y);
    });
}

function edTogglePlay() { edPlaying ? edPause() : edPlay(); }
function edPlay() {
    if (edPlaying) return;
    if (edTotal() <= 0) return;
    edPlaying = true;
    document.getElementById('ed-play-btn').innerHTML = '<i class="fas fa-pause"></i>';
    edClock0 = performance.now(); edBase0 = edPlayhead;
    const v = document.getElementById('ed-preview');
    if (v) { try { v.play(); } catch(_){} }
    if (edMusic) edStartMusic();
    const loop = () => {
        if (!edPlaying) return;
        edPlayhead = edBase0 + (performance.now() - edClock0) / 1000;
        if (edPlayhead >= edTotal()) { edPlayhead = edTotal(); edPause(); edUpdatePlayhead(); edUpdateTime(); return; }
        edRenderFrame(edPlayhead);
        edUpdatePlayhead(); edUpdateTime();
        edRaf = requestAnimationFrame(loop);
    };
    edRaf = requestAnimationFrame(loop);
}
function edPause() {
    edPlaying = false;
    if (edRaf) cancelAnimationFrame(edRaf), edRaf = null;
    const btn = document.getElementById('ed-play-btn'); if (btn) btn.innerHTML = '<i class="fas fa-play"></i>';
    const v = document.getElementById('ed-preview'); if (v) { try { v.pause(); } catch(_){} }
    if (edAudioEl) { try { edAudioEl.pause(); } catch(_){} }
}
function edSeekStart() { edPause(); edPlayhead = 0; edUpdatePlayhead(); edUpdateTime(); edRenderFrame(0); }
function edStartMusic() {
    if (!edMusic) return;
    if (!edAudioEl) edAudioEl = new Audio();
    if (edAudioEl.src !== edMusic.src) edAudioEl.src = edMusic.src;
    edAudioEl.volume = edMusic.volume;
    const into = edPlayhead - edMusic.start + edMusic.inP;
    if (into >= 0) { try { edAudioEl.currentTime = Math.max(0, into); edAudioEl.play(); } catch(_){} }
}

function edSetStatus(msg) { const el = document.getElementById('ed-status'); if (el) el.textContent = msg || ''; setTimeout(()=>{ if(el && el.textContent===msg) el.textContent=''; }, 4000); }

// Keyboard
document.addEventListener('keydown', e => {
    const view = document.getElementById('view-editor');
    if (!view || !view.classList.contains('active')) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName==='SELECT') return;
    if (e.code === 'Space') { e.preventDefault(); edTogglePlay(); }
    else if (e.key === 's' || e.key === 'S') { edSplit(); }
    else if (e.key === 'Backspace' || e.key === 'Delete') { edDeleteSelected(); }
});

// ── Export ────────────────────────────────────────────────────────────────
async function edExport() {
    if (!edVideo.length) { edSetStatus('Add at least one video clip first.'); return; }
    const btn = document.getElementById('ed-export-btn');
    if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; }
    edSetStatus('Rendering timeline with ffmpeg… this can take a moment.');

    // Build text overlay PNGs (rendered to 1280x720) with timing
    const overlays = [];
    try {
        for (const c of edText) {
            const canvas = document.createElement('canvas');
            canvas.width = 1280; canvas.height = 720;
            const ctx = canvas.getContext('2d');
            ctx.textAlign = 'center';
            const size = Math.max(10, c.size);
            ctx.font = `bold ${size}px Arial, sans-serif`;
            ctx.lineWidth = Math.max(3, size*0.14); ctx.lineJoin='round';
            ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.fillStyle = c.color || '#fff';
            let y; if (c.pos==='top') y = size+30; else if (c.pos==='center') y = 360+size/3; else y = 720-45;
            ctx.strokeText(c.text, 640, y); ctx.fillText(c.text, 640, y);
            const b64 = canvas.toDataURL('image/png').split(',')[1];
            const png = path.join(os.tmpdir(), 'edt_' + _edId('') + '.png');
            fs.writeFileSync(png, Buffer.from(b64, 'base64'));
            overlays.push({ png, start: c.start, end: c.start + c.dur });
        }
    } catch(e) { console.error('[editor] overlay build:', e); }

    const project = {
        videoClips: edVideo.map(c => ({ storedName: _edStored(c.fileId), inP: c.inP, outP: c.outP })),
        overlays,
        music: edMusic ? { storedName: _edStored(edMusic.fileId), inP: edMusic.inP, outP: edMusic.outP, start: edMusic.start, volume: edMusic.volume, muteOriginal: edMusic.muteOriginal } : null,
        outName: 'vf_' + Date.now() + '_' + Math.random().toString(36).slice(2,7) + '.mp4',
    };

    try {
        const r = await ipcRenderer.invoke('editor-export', project);
        if (!r || !r.ok) { edSetStatus('Export failed: ' + String(r && r.error || '').slice(0,100)); if (btn){btn.disabled=false;btn.style.opacity='1';} return; }
        // add to vault
        const id = project.outName.replace('.mp4','');
        vaultData.files.unshift({ id, originalName: 'Edited '+ new Date().toLocaleString().replace(/[\/:]/g,'-') + '.mp4', storedName: project.outName, folderId:null, notes:'', pageNotes:{}, addedAt:Date.now(), size: r.size||0 });
        if (typeof saveVaultData==='function') saveVaultData();
        if (typeof renderVaultGrid==='function') renderVaultGrid();
        edSetStatus('Exported to Vault ✓');
    } catch(e) { edSetStatus('Export error: ' + e.message); }
    if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
}
function _edStored(fileId){ const f = vaultData.files.find(x=>x.id===fileId); return f ? f.storedName : ''; }
