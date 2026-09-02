// ── Local Music Player ─────────────────────────────────────────
// Note: fs, path, os are already declared in globals.js
//
// The library lives in a shared file (~/Documents/Vulsor_Memories/music.json)
// rather than localStorage, so the standalone VulsorPlay app works on the very
// same library. Anything downloaded or renamed over there shows up here live.

// Relative requires in the renderer resolve from index.html's directory.
const musicStore = require('./shared/music-store.js');

// ── State ─────────────────────────────────────────────────────
// One-time lift of the old localStorage library into the shared file.
musicStore.migrateFromLocalStorage(localStorage);

let _musicLib      = musicStore.read();
let musicLibrary   = _musicLib.tracks;
let musicPlaylists = _musicLib.playlists;
let musicFolders   = _musicLib.folders;
let musicIndex     = -1;
// Path of the track currently loaded. musicIndex alone is not stable: the other
// app can reorder or insert tracks underneath us at any moment.
let _musicNowPlayingPath = null;
let musicPlaying   = false;
let musicShuffle   = false;
let musicLoop      = false;
let shuffleOrder   = [];
let dlQueue        = [];
let musicActiveList = null; // null = All Tracks, or playlist id

const MUSIC_VIDEO_EXTS = /\.(mp4|webm|mkv|mov|avi|m4v)$/i;

function getAudio() { return document.getElementById('music-audio'); }
function getVideo() { return document.getElementById('music-video'); }

function musicIsVideo(filePath) { return MUSIC_VIDEO_EXTS.test(filePath || ''); }

function getActiveMedia() {
    const track = musicLibrary[musicIndex];
    return (track && musicIsVideo(track.path)) ? getVideo() : getAudio();
}

// ── Download via IPC ──────────────────────────────────────────
ipcRenderer.on('music-dl-event', (_, ev) => {
    const job = dlQueue.find(j => j.id === ev.jobId);
    if (!job) return;

    if (ev.type === 'progress') { job.progress = ev.progress; renderDlQueue(); }
    if (ev.type === 'title')    { job.title    = ev.title;    renderDlQueue(); }

    if (ev.type === 'done') {
        job.status = 'done'; job.progress = 100; job.title = ev.title;
        renderDlQueue();
        if (!musicLibrary.some(t => t.path === ev.filePath)) {
            const size = musicFileSize(ev.filePath);
            musicLibrary.push({ title: ev.title, path: ev.filePath, duration: 0, size });
            musicSave();
            const idx = musicLibrary.length - 1;
            musicLoadDuration(musicLibrary[idx], idx);
            renderMusicLibrary();
            renderMusicSidebar();
        }
        setTimeout(() => { dlQueue = dlQueue.filter(j => j.id !== ev.jobId); renderDlQueue(); }, 3000);
    }

    if (ev.type === 'error') {
        job.status = 'error'; job.error = ev.error;
        renderDlQueue();
    }
});

function musicStartDownload() {
    const urlInput = document.getElementById('music-dl-url');
    const format   = document.getElementById('music-dl-format').value;
    const url      = urlInput.value.trim();
    if (!url) return;

    urlInput.value = '';
    const jobId = Date.now();
    dlQueue.push({ id: jobId, url, title: 'Downloading…', progress: 0, status: 'downloading', error: '' });
    renderDlQueue();

    ipcRenderer.send('music-download', { jobId, url, format });
}

function renderDlQueue() {
    const el = document.getElementById('music-dl-queue');
    if (!el) return;
    if (!dlQueue.length) { el.innerHTML = ''; return; }
    el.innerHTML = dlQueue.map(job => {
        let right = '';
        if (job.status === 'downloading') right = `<span class="music-dl-pct">${Math.round(job.progress)}%</span>`;
        if (job.status === 'done')        right = `<i class="fas fa-check text-green-400 text-[10px]"></i>`;
        const isError = job.status === 'error';
        return `<div class="music-dl-row${isError ? ' music-dl-row-err' : ''}">
            <div class="music-dl-info">
                <span class="music-dl-title">${job.title}</span>
                ${job.status === 'downloading'
                    ? `<div class="music-dl-bar"><div class="music-dl-fill" style="width:${job.progress}%"></div></div>`
                    : ''}
                ${isError ? `<span class="music-dl-errtxt">${job.error}</span>` : ''}
            </div>${right}
        </div>`;
    }).join('');
}

// ── File picking ──────────────────────────────────────────────
function musicPickFiles() {
    document.getElementById('music-file-input').click();
}

function musicFilesSelected(input) {
    musicAddFiles(Array.from(input.files));
    input.value = '';
}

function musicOnDrop(e) {
    e.preventDefault();
    document.getElementById('music-drop-zone').classList.remove('music-drop-active');
    const files = Array.from(e.dataTransfer.files).filter(f =>
        f.type.startsWith('audio/') || f.type.startsWith('video/') ||
        /\.(mp3|mp4|m4a|wav|ogg|flac|aac|opus|webm)$/i.test(f.name)
    );
    musicAddFiles(files);
}

// ── Folder import ─────────────────────────────────────────────
async function musicImportFolder() {
    const folderPath = await ipcRenderer.invoke('music-pick-folder');
    if (!folderPath) return;

    const AUDIO_EXT = /\.(mp3|mp4|m4a|wav|ogg|flac|aac|opus|webm)$/i;

    function scanDir(dir) {
        let results = [];
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    results = results.concat(scanDir(full));
                } else if (AUDIO_EXT.test(entry.name)) {
                    results.push(full);
                }
            }
        } catch(e) {}
        return results;
    }

    const filePaths = scanDir(folderPath);
    if (!filePaths.length) { alert('No audio files found in that folder.'); return; }

    let added = 0;
    filePaths.forEach(fp => {
        if (musicLibrary.some(t => t.path === fp)) return;
        const size = musicFileSize(fp);
        const title = path.basename(fp).replace(/\.[^.]+$/, '');
        musicLibrary.push({ title, path: fp, duration: 0, size });
        added++;
    });

    if (!added) { alert('All files in that folder are already in your library.'); return; }

    musicSave();
    renderMusicLibrary();
    renderMusicSidebar();
    musicLibrary.forEach((track, i) => { if (track.duration === 0) musicLoadDuration(track, i); });
}

function musicFileSize(filePath) {
    try { return fs.statSync(filePath).size; } catch(e) { return 0; }
}

function musicFmtSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function musicAddFiles(files) {
    let added = 0;
    files.forEach(file => {
        const filePath = file.path || file.name;
        if (musicLibrary.some(t => t.path === filePath)) return;
        const size = musicFileSize(filePath);
        musicLibrary.push({ title: file.name.replace(/\.[^.]+$/, ''), path: filePath, duration: 0, size });
        added++;
    });
    if (!added) return;
    musicSave();
    renderMusicLibrary();
    renderMusicSidebar();
    musicLibrary.forEach((track, i) => { if (track.duration === 0) musicLoadDuration(track, i); });
}

function musicLoadDuration(track, index) {
    const tmp = musicIsVideo(track.path) ? document.createElement('video') : new Audio();
    tmp.src   = pathToFileURL(track.path).href;
    tmp.addEventListener('loadedmetadata', () => {
        musicLibrary[index].duration = tmp.duration;
        musicSave();
        const el = document.getElementById(`music-dur-${index}`);
        if (el) el.textContent = musicFmt(tmp.duration);
    });
}

// ── Library CRUD ──────────────────────────────────────────────
// Paths deleted in this session. A save must not resurrect them when it folds
// in whatever VulsorPlay has written to the shared file in the meantime.
const _musicDeleted = new Set();

function musicSave() {
    musicStore.mutate(lib => {
        // Fold in tracks the other app added since our last sync (a download
        // finishing in VulsorPlay mid-edit), minus anything we just deleted.
        const mine = new Set(musicLibrary.map(t => t.path));
        for (const t of lib.tracks) {
            if (!mine.has(t.path) && !_musicDeleted.has(t.path)) musicLibrary.push(t);
        }
        lib.tracks    = musicLibrary;
        lib.playlists = musicPlaylists;
        lib.folders   = musicFolders;
        return lib;
    });
}

// ── Live sync from the other app ──────────────────────────────
// VulsorPlay writes the same file; pick its changes up without a restart.
musicStore.watch(lib => {
    musicLibrary   = lib.tracks;
    musicPlaylists = lib.playlists;
    musicFolders   = lib.folders;
    // Keep pointing at the same track across the swap — the array it lives in
    // has just been replaced, so a bare index would drift onto a random song.
    if (musicIndex >= 0 && _musicNowPlayingPath) {
        musicIndex = musicLibrary.findIndex(t => t.path === _musicNowPlayingPath);
    }
    try {
        renderMusicLibrary();
        renderMusicSidebar();
    } catch (e) { console.error('[music] re-render after external change failed:', e); }
});

function musicDelete(index) {
    const wasPlaying = musicIndex === index;
    const deletedPath = musicLibrary[index].path;
    _musicDeleted.add(deletedPath);
    musicLibrary.splice(index, 1);
    // Remove from all playlists
    musicPlaylists.forEach(pl => {
        pl.trackPaths = pl.trackPaths.filter(p => p !== deletedPath);
    });
    musicSave();
    if (wasPlaying) musicStop();
    else if (musicIndex > index) musicIndex--;
    renderMusicLibrary();
    renderMusicSidebar();
}

// ── Name modal ────────────────────────────────────────────────
let _musicModalCb = null;
function musicNameModal(title, defaultVal, cb) {
    _musicModalCb = cb;
    const modal = document.getElementById('music-name-modal');
    document.getElementById('music-name-modal-title').textContent = title;
    const input = document.getElementById('music-name-modal-input');
    input.value = defaultVal || '';
    modal.style.display = 'flex';
    setTimeout(() => { input.focus(); input.select(); }, 50);
}
function musicNameModalConfirm() {
    const val = document.getElementById('music-name-modal-input').value.trim();
    document.getElementById('music-name-modal').style.display = 'none';
    if (val && _musicModalCb) _musicModalCb(val);
    _musicModalCb = null;
}
function musicNameModalCancel() {
    document.getElementById('music-name-modal').style.display = 'none';
    _musicModalCb = null;
}

// ── Folder management ─────────────────────────────────────────
function musicCreateFolder() {
    musicNameModal('New folder name', '', name => {
        musicFolders.push({ id: Date.now(), name, collapsed: false });
        musicSave();
        renderMusicSidebar();
    });
}

function musicRenameFolder(id) {
    const folder = musicFolders.find(f => f.id === id);
    if (!folder) return;
    musicNameModal('Rename folder', folder.name, name => {
        folder.name = name;
        musicSave();
        renderMusicSidebar();
    });
}

function musicDeleteFolder(id) {
    musicPlaylists.forEach(pl => { if (pl.folderId === id) pl.folderId = null; });
    musicFolders = musicFolders.filter(f => f.id !== id);
    musicSave();
    renderMusicSidebar();
}

function musicToggleFolder(id) {
    const folder = musicFolders.find(f => f.id === id);
    if (folder) { folder.collapsed = !folder.collapsed; musicSave(); renderMusicSidebar(); }
}

function musicMovePlaylistToFolder(plId, folderId) {
    const pl = musicPlaylists.find(p => p.id === plId);
    if (pl) { pl.folderId = folderId; musicSave(); renderMusicSidebar(); }
}

// ── Playlist management ───────────────────────────────────────
function musicCreatePlaylist(folderId) {
    musicNameModal('New playlist name', '', name => {
        musicPlaylists.push({ id: Date.now(), name, trackPaths: [], folderId: folderId || null });
        musicSave();
        renderMusicSidebar();
    });
}

function musicRenamePlaylist(id) {
    const pl = musicPlaylists.find(p => p.id === id);
    if (!pl) return;
    musicNameModal('Rename playlist', pl.name, name => {
        pl.name = name;
        musicSave();
        renderMusicSidebar();
        const title = document.getElementById('music-view-title');
        if (title && musicActiveList === id) title.textContent = name;
    });
}

function musicDeletePlaylist(id) {
    musicPlaylists = musicPlaylists.filter(p => p.id !== id);
    if (musicActiveList === id) musicActiveList = null;
    musicSave();
    renderMusicSidebar();
    renderMusicLibrary();
}

function musicAddTrackToPlaylist(trackIdx, playlistId) {
    const pl = musicPlaylists.find(p => p.id === playlistId);
    if (!pl) return;
    const fp = musicLibrary[trackIdx]?.path;
    if (!fp || pl.trackPaths.includes(fp)) return;
    pl.trackPaths.push(fp);
    musicSave();
    renderMusicSidebar();
}

function musicRemoveTrackFromPlaylist(trackIdx, playlistId) {
    const pl = musicPlaylists.find(p => p.id === playlistId);
    if (!pl) return;
    const fp = musicLibrary[trackIdx]?.path;
    if (!fp) return;
    pl.trackPaths = pl.trackPaths.filter(p => p !== fp);
    musicSave();
    renderMusicLibrary();
}

function musicSetActiveList(id) {
    musicActiveList = id;
    const title = document.getElementById('music-view-title');
    if (id === null) {
        if (title) title.textContent = 'All Tracks';
    } else {
        const pl = musicPlaylists.find(p => p.id === id);
        if (title && pl) title.textContent = pl.name;
    }
    renderMusicSidebar();
    renderMusicLibrary();
}

// ── Vinyl helpers ─────────────────────────────────────────────
function vinylSetPlaying(playing, title, isVid) {
    const display = document.getElementById('vinyl-display');
    const video   = document.getElementById('music-video');
    const record  = document.getElementById('vinyl-record');
    const arm     = document.getElementById('vinyl-arm');
    const titleEl = document.getElementById('vinyl-title');
    const eq      = document.getElementById('vinyl-eq');
    const vpBtn   = document.getElementById('vinyl-play-btn');

    if (!record) return;

    // Switch between vinyl and video display
    if (display) display.style.display = isVid ? 'none' : '';
    if (video)   video.style.display   = isVid ? 'block' : 'none';

    if (playing) {
        if (!isVid) {
            record.classList.add('vinyl-playing');
            arm?.classList.add('vinyl-arm-playing');
        }
        eq?.classList.add('vinyl-playing-active');
        if (titleEl) {
            titleEl.className = 'vinyl-track-title';
            titleEl.textContent = title || '—';
        }
        if (vpBtn) vpBtn.innerHTML = '<i class="fas fa-pause text-xs"></i>';
    } else {
        record.classList.remove('vinyl-playing');
        arm?.classList.remove('vinyl-arm-playing');
        eq?.classList.remove('vinyl-playing-active');
        if (vpBtn) vpBtn.innerHTML = '<i class="fas fa-play text-xs"></i>';
    }
}

function vinylSetIdle() {
    const display = document.getElementById('vinyl-display');
    const video   = document.getElementById('music-video');
    const record  = document.getElementById('vinyl-record');
    const arm     = document.getElementById('vinyl-arm');
    const titleEl = document.getElementById('vinyl-title');
    const eq      = document.getElementById('vinyl-eq');
    const vpBtn   = document.getElementById('vinyl-play-btn');

    if (display) display.style.display = '';
    if (video)   { video.style.display = 'none'; video.src = ''; }
    record?.classList.remove('vinyl-playing');
    arm?.classList.remove('vinyl-arm-playing');
    eq?.classList.remove('vinyl-playing-active');
    if (titleEl) { titleEl.className = 'vinyl-track-idle'; titleEl.textContent = 'No track playing'; }
    if (vpBtn) vpBtn.innerHTML = '<i class="fas fa-play text-xs"></i>';
}

// ── Playback ──────────────────────────────────────────────────
function musicPlay(index) {
    if (!musicLibrary[index]) return;

    // Stop whichever element is currently active
    const prevAudio = getAudio(); prevAudio.pause(); prevAudio.src = '';
    const prevVideo = getVideo(); prevVideo.pause(); prevVideo.src = '';

    musicIndex   = index;
    _musicNowPlayingPath = musicLibrary[index].path;
    musicPlaying = true;

    const isVid  = musicIsVideo(musicLibrary[index].path);
    const media  = isVid ? getVideo() : getAudio();
    media.src    = pathToFileURL(musicLibrary[index].path).href;
    media.loop   = musicLoop;
    media.play().catch(() => {});

    document.getElementById('music-player-bar').style.display = 'flex';
    document.getElementById('music-bar-title').textContent    = musicLibrary[index].title;
    document.getElementById('music-play-btn').innerHTML       = '<i class="fas fa-pause text-xs"></i>';

    vinylSetPlaying(true, musicLibrary[index].title, isVid);
    renderMusicLibrary();
}

function musicTogglePlay() {
    const media = getActiveMedia();
    if (!media.src || media.src === window.location.href) return;
    const isVid = musicIsVideo(musicLibrary[musicIndex]?.path);
    if (musicPlaying) {
        media.pause();
        musicPlaying = false;
        document.getElementById('music-play-btn').innerHTML = '<i class="fas fa-play text-xs"></i>';
        vinylSetPlaying(false, musicLibrary[musicIndex]?.title, isVid);
    } else {
        media.play().catch(() => {});
        musicPlaying = true;
        document.getElementById('music-play-btn').innerHTML = '<i class="fas fa-pause text-xs"></i>';
        vinylSetPlaying(true, musicLibrary[musicIndex]?.title, isVid);
    }
}

function musicStop() {
    const audio = getAudio(); audio.pause(); audio.src = '';
    const video = getVideo(); video.pause(); video.src = '';
    musicIndex = -1; _musicNowPlayingPath = null; musicPlaying = false;
    document.getElementById('music-player-bar').style.display = 'none';
    vinylSetIdle();
    renderMusicLibrary();
}

function musicPrev() {
    if (!musicLibrary.length) return;
    musicPlay(musicShuffle
        ? shuffleOrder[(shuffleOrder.indexOf(musicIndex) - 1 + shuffleOrder.length) % shuffleOrder.length]
        : (musicIndex - 1 + musicLibrary.length) % musicLibrary.length);
}

function musicNext() {
    if (!musicLibrary.length) return;
    if (musicShuffle) {
        musicPlay(shuffleOrder[(shuffleOrder.indexOf(musicIndex) + 1) % shuffleOrder.length]);
    } else {
        musicPlay((musicIndex + 1) % musicLibrary.length);
    }
}

function musicSeek(val)      { const m = getActiveMedia(); if (m.duration) m.currentTime = (val / 100) * m.duration; }
function musicSetVolume(val) { getAudio().volume = val; getVideo().volume = val; }

function musicToggleShuffle() {
    musicShuffle = !musicShuffle;
    if (musicShuffle) shuffleOrder = [...musicLibrary.keys()].sort(() => Math.random() - 0.5);
    document.getElementById('music-shuffle-btn').classList.toggle('music-ctrl-on', musicShuffle);
}

function musicToggleLoop() {
    musicLoop = !musicLoop;
    getAudio().loop = musicLoop;
    getVideo().loop = musicLoop;
    document.getElementById('music-loop-btn').classList.toggle('music-ctrl-on', musicLoop);
}

function musicFmt(secs) {
    if (!secs || isNaN(secs)) return '—';
    const m = Math.floor(secs / 60), s = Math.floor(secs % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

// ── Audio / Video events ──────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    function wireMediaEvents(el) {
        el.addEventListener('timeupdate', () => {
            if (el !== getActiveMedia()) return;
            if (!el.duration) return;
            document.getElementById('music-bar-seek').value       = (el.currentTime / el.duration) * 100;
            document.getElementById('music-bar-time').textContent = `${musicFmt(el.currentTime)} / ${musicFmt(el.duration)}`;
        });
        el.addEventListener('ended', () => { if (!musicLoop) musicNext(); });
        el.addEventListener('play',  () => {
            const isVid = el === getVideo();
            vinylSetPlaying(true,  musicLibrary[musicIndex]?.title, isVid);
        });
        el.addEventListener('pause', () => {
            const isVid = el === getVideo();
            vinylSetPlaying(false, musicLibrary[musicIndex]?.title, isVid);
        });
    }

    wireMediaEvents(getAudio());
    wireMediaEvents(getVideo());

    // Backfill size for tracks saved before this field existed
    musicLibrary.forEach((t, i) => { if (!t.size) t.size = musicFileSize(t.path); });
    musicSave();

    // Dismiss context menus on outside click
    document.addEventListener('click', () => {
        const m = document.getElementById('music-pl-menu');
        if (m) m.style.display = 'none';
        const tm = document.getElementById('music-track-ctx-menu');
        if (tm) tm.style.display = 'none';
    });

    // Clean up leftover .part files from previous downloads
    ipcRenderer.invoke('music-cleanup-leftovers').catch(() => {});
});

// ── renderMusic (called when switching to the Music tab) ──────
function renderMusic() {
    renderMusicSidebar();
    renderMusicLibrary();
}

// ── Sidebar render ────────────────────────────────────────────
function renderMusicSidebar() {
    const allBtn   = document.getElementById('music-all-btn');
    const allCount = document.getElementById('music-all-count');
    const plList   = document.getElementById('music-playlist-list');
    if (!plList) return;

    if (allCount) allCount.textContent = musicLibrary.length;
    if (allBtn) allBtn.classList.toggle('music-sbar-active', musicActiveList === null);

    let html = '';

    // Render folders first, with their playlists nested inside
    musicFolders.forEach(folder => {
        const folderPlaylists = musicPlaylists.filter(pl => pl.folderId === folder.id);
        const chevron = folder.collapsed ? 'fa-chevron-right' : 'fa-chevron-down';
        html += `<div class="music-folder">
            <div class="music-folder-header music-pl-drop"
                 onclick="musicToggleFolder(${folder.id})"
                 oncontextmenu="musicShowFolderMenu(event,${folder.id})"
                 ondragover="musicDragOverFolder(event,this)"
                 ondragleave="this.classList.remove('music-sbar-drop-over')"
                 ondrop="musicDropOnFolder(event,${folder.id},this)">
                <i class="fas ${chevron} music-folder-chevron"></i>
                <i class="fas fa-folder${folder.collapsed ? '' : '-open'} music-folder-icon"></i>
                <span class="flex-1 truncate">${escHtml(folder.name)}</span>
                <span class="music-sbar-badge">${folderPlaylists.length}</span>
            </div>
            ${!folder.collapsed ? `<div class="music-folder-children">
                ${folderPlaylists.map(pl => renderPlaylistItem(pl)).join('') ||
                  `<div class="music-folder-empty">Drop a track here to create a playlist</div>`}
            </div>` : ''}
        </div>`;
    });

    // Render playlists not in any folder
    const orphanPlaylists = musicPlaylists.filter(pl => !pl.folderId);
    orphanPlaylists.forEach(pl => { html += renderPlaylistItem(pl); });

    plList.innerHTML = html;
}

function renderPlaylistItem(pl) {
    const active = musicActiveList === pl.id;
    return `<div class="music-sbar-item${active ? ' music-sbar-active' : ''} music-pl-drop"
                 onclick="musicSetActiveList(${pl.id})"
                 oncontextmenu="musicShowPlMenu(event,${pl.id})"
                 ondragover="musicDragOverPlaylist(event,this)"
                 ondragleave="this.classList.remove('music-sbar-drop-over')"
                 ondrop="musicDropOnPlaylist(event,${pl.id},this)">
        <i class="fas fa-music text-[10px]" style="opacity:.5"></i>
        <span class="flex-1 text-left truncate">${escHtml(pl.name)}</span>
        <span class="music-sbar-badge">${pl.trackPaths.length}</span>
    </div>`;
}

// ── Folder context menu ───────────────────────────────────────
function musicShowFolderMenu(e, id) {
    e.preventDefault();
    e.stopPropagation();
    const menu = document.getElementById('music-pl-menu');
    const items = document.getElementById('music-pl-menu-items');
    if (!menu || !items) return;
    const hide = `document.getElementById('music-pl-menu').style.display='none'`;
    items.innerHTML = `
        <div class="music-ctx-item" onclick="musicCreatePlaylist(${id});${hide}">
            <i class="fas fa-plus text-[10px]"></i> New playlist here
        </div>
        <div class="music-ctx-sep"></div>
        <div class="music-ctx-item" onclick="musicRenameFolder(${id});${hide}">
            <i class="fas fa-pencil-alt text-[10px]"></i> Rename folder
        </div>
        <div class="music-ctx-item music-ctx-danger" onclick="musicDeleteFolder(${id});${hide}">
            <i class="fas fa-trash text-[10px]"></i> Delete folder
        </div>`;
    menu.style.display = 'block';
    menu.style.left = e.clientX + 'px';
    menu.style.top  = e.clientY + 'px';
}

// ── Playlist context menu ─────────────────────────────────────
function musicShowPlMenu(e, id) {
    e.preventDefault();
    e.stopPropagation();
    const menu = document.getElementById('music-pl-menu');
    const items = document.getElementById('music-pl-menu-items');
    if (!menu || !items) return;
    const hide = `document.getElementById('music-pl-menu').style.display='none'`;

    const folderOptions = musicFolders.map(f =>
        `<div class="music-ctx-item" onclick="musicMovePlaylistToFolder(${id},${f.id});${hide}">
            <i class="fas fa-folder text-[10px]" style="opacity:.6"></i> ${escHtml(f.name)}
        </div>`
    ).join('');

    const pl = musicPlaylists.find(p => p.id === id);
    const inFolder = pl && pl.folderId;

    items.innerHTML = `
        <div class="music-ctx-item" onclick="musicRenamePlaylist(${id});${hide}">
            <i class="fas fa-pencil-alt text-[10px]"></i> Rename
        </div>
        ${musicFolders.length ? `
        <div class="music-ctx-sep"></div>
        <div class="music-ctx-label">Move to folder</div>
        ${folderOptions}
        ${inFolder ? `<div class="music-ctx-item" onclick="musicMovePlaylistToFolder(${id},null);${hide}">
            <i class="fas fa-times text-[10px]" style="opacity:.5"></i> Remove from folder
        </div>` : ''}` : ''}
        <div class="music-ctx-sep"></div>
        <div class="music-ctx-item music-ctx-danger" onclick="musicDeletePlaylist(${id});${hide}">
            <i class="fas fa-trash text-[10px]"></i> Delete
        </div>`;
    menu.style.display = 'block';
    menu.style.left = e.clientX + 'px';
    menu.style.top  = e.clientY + 'px';
}

// ── Track context menu ────────────────────────────────────────
function musicShowTrackMenu(e, trackIdx) {
    e.preventDefault();
    e.stopPropagation();

    let menu = document.getElementById('music-track-ctx-menu');
    if (!menu) {
        menu = document.createElement('div');
        menu.id = 'music-track-ctx-menu';
        menu.className = 'music-ctx-menu';
        document.body.appendChild(menu);
    }

    const isInActivePlaylist = musicActiveList !== null &&
        musicPlaylists.find(p => p.id === musicActiveList)?.trackPaths.includes(musicLibrary[trackIdx]?.path);

    const addToItems = musicPlaylists.map(pl =>
        `<div class="music-ctx-item" onclick="musicAddTrackToPlaylist(${trackIdx},${pl.id});document.getElementById('music-track-ctx-menu').style.display='none'">
            <i class="fas fa-plus text-[10px]"></i> ${escHtml(pl.name)}
        </div>`
    ).join('') || `<div class="music-ctx-item" style="opacity:.5;cursor:default">No playlists yet</div>`;

    menu.innerHTML = `
        <div class="music-ctx-label">Add to playlist</div>
        ${addToItems}
        ${isInActivePlaylist ? `
        <div class="music-ctx-sep"></div>
        <div class="music-ctx-item music-ctx-danger" onclick="musicRemoveTrackFromPlaylist(${trackIdx},${musicActiveList});document.getElementById('music-track-ctx-menu').style.display='none'">
            <i class="fas fa-minus text-[10px]"></i> Remove from playlist
        </div>` : ''}
        <div class="music-ctx-sep"></div>
        <div class="music-ctx-item music-ctx-danger" onclick="musicDelete(${trackIdx});document.getElementById('music-track-ctx-menu').style.display='none'">
            <i class="fas fa-trash text-[10px]"></i> Delete track
        </div>`;

    menu.style.display = 'block';
    menu.style.left = e.clientX + 'px';
    menu.style.top  = e.clientY + 'px';
}

// ── Drag helpers ──────────────────────────────────────────────
let _dragTrackIdx = null;
let _dragPlOrderIdx = null; // for in-playlist reorder

function musicDragStart(e, trackIdx) {
    _dragTrackIdx = trackIdx;
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('text/plain', String(trackIdx));
    setTimeout(() => {
        const el = document.querySelector(`.music-track-item[data-idx="${trackIdx}"]`);
        if (el) el.classList.add('music-track-dragging');
    }, 0);
}

function musicDragEnd(e) {
    document.querySelectorAll('.music-track-dragging').forEach(el => el.classList.remove('music-track-dragging'));
    _dragTrackIdx = null;
}

function musicDragOverPlaylist(e, el) {
    if (_dragTrackIdx === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    el.classList.add('music-sbar-drop-over');
}

function musicDragOverFolder(e, el) {
    if (_dragTrackIdx === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    el.classList.add('music-sbar-drop-over');
}

function musicDropOnPlaylist(e, playlistId, el) {
    e.preventDefault();
    el.classList.remove('music-sbar-drop-over');
    const idx = _dragTrackIdx !== null ? _dragTrackIdx : parseInt(e.dataTransfer.getData('text/plain'));
    if (isNaN(idx)) return;
    musicAddTrackToPlaylist(idx, playlistId);
}

function musicDropOnFolder(e, folderId, el) {
    e.preventDefault();
    el.classList.remove('music-sbar-drop-over');
    const idx = _dragTrackIdx !== null ? _dragTrackIdx : parseInt(e.dataTransfer.getData('text/plain'));
    if (isNaN(idx)) return;
    // Drop on folder header: add to first playlist in folder, or create one
    const plInFolder = musicPlaylists.filter(p => p.folderId === folderId);
    if (plInFolder.length) {
        musicAddTrackToPlaylist(idx, plInFolder[0].id);
    } else {
        // Create a new playlist inside this folder with this track
        const folder = musicFolders.find(f => f.id === folderId);
        const track  = musicLibrary[idx];
        if (!folder || !track) return;
        const newPl = { id: Date.now(), name: 'New Playlist', trackPaths: [track.path], folderId };
        musicPlaylists.push(newPl);
        musicSave();
        renderMusicSidebar();
    }
}

// ── In-playlist reorder via drag ──────────────────────────────
let _reorderSrc = null;

function musicReorderDragStart(e, listIdx) {
    _reorderSrc = listIdx;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', 'reorder');
    setTimeout(() => e.target.closest('.music-track-item')?.classList.add('music-track-dragging'), 0);
}

function musicReorderDragOver(e, listIdx, el) {
    if (_reorderSrc === null || _reorderSrc === listIdx) return;
    e.preventDefault();
    document.querySelectorAll('.music-reorder-over').forEach(x => x.classList.remove('music-reorder-over'));
    el.classList.add('music-reorder-over');
}

function musicReorderDrop(e, listIdx) {
    e.preventDefault();
    document.querySelectorAll('.music-reorder-over, .music-track-dragging').forEach(x => {
        x.classList.remove('music-reorder-over', 'music-track-dragging');
    });
    if (_reorderSrc === null || _reorderSrc === listIdx || musicActiveList === null) { _reorderSrc = null; return; }
    const pl = musicPlaylists.find(p => p.id === musicActiveList);
    if (!pl) { _reorderSrc = null; return; }
    const moved = pl.trackPaths.splice(_reorderSrc, 1)[0];
    pl.trackPaths.splice(listIdx, 0, moved);
    _reorderSrc = null;
    musicSave();
    renderMusicLibrary();
}

function escHtml(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Render ────────────────────────────────────────────────────
function renderMusicLibrary() {
    const dropZone  = document.getElementById('music-drop-zone');
    const trackList = document.getElementById('music-track-list');
    if (!dropZone || !trackList) return;

    // Determine which tracks to show
    let tracks = musicLibrary.map((t, i) => ({ ...t, _origIdx: i }));

    if (musicActiveList !== null) {
        const pl = musicPlaylists.find(p => p.id === musicActiveList);
        const paths = pl ? pl.trackPaths : [];
        tracks = tracks.filter(t => paths.includes(t.path));
    }

    // Search filter
    const query = (document.getElementById('music-search')?.value || '').toLowerCase().trim();
    if (query) tracks = tracks.filter(t => t.title.toLowerCase().includes(query));

    // Sort
    const sort = document.getElementById('music-sort')?.value || 'added';
    if (sort === 'title')    tracks.sort((a, b) => a.title.localeCompare(b.title));
    if (sort === 'duration') tracks.sort((a, b) => b.duration - a.duration);
    if (sort === 'size')     tracks.sort((a, b) => b.size - a.size);

    if (!tracks.length) {
        dropZone.style.display  = musicLibrary.length ? 'none' : 'flex';
        trackList.style.display = musicLibrary.length ? 'block' : 'none';
        if (musicLibrary.length) {
            trackList.innerHTML = `<div class="flex flex-col items-center justify-center h-full text-slate-600 text-sm gap-2 py-12">
                <i class="fas fa-search text-2xl opacity-30"></i>
                <span>${query ? 'No tracks match your search.' : 'This playlist is empty. Right-click tracks to add them.'}</span>
            </div>`;
        }
        return;
    }

    dropZone.style.display  = 'none';
    trackList.style.display = 'block';

    const inPlaylist = musicActiveList !== null;

    trackList.innerHTML = tracks.map((track, listIdx) => {
        const i      = track._origIdx;
        const active = i === musicIndex;
        const icon   = active && musicPlaying ? 'fa-volume-up' : 'fa-play';
        const size   = musicFmtSize(track.size);
        const reorderAttrs = inPlaylist
            ? `ondragstart="musicReorderDragStart(event,${listIdx})"
               ondragover="musicReorderDragOver(event,${listIdx},this)"
               ondrop="musicReorderDrop(event,${listIdx})"
               ondragend="document.querySelectorAll('.music-track-dragging,.music-reorder-over').forEach(x=>x.classList.remove('music-track-dragging','music-reorder-over'))"`
            : `ondragstart="musicDragStart(event,${i})" ondragend="musicDragEnd(event)"`;
        return `
        <div class="music-track-item${active ? ' music-track-item-active' : ''}"
             data-idx="${i}"
             draggable="true"
             ${reorderAttrs}
             ondblclick="musicPlay(${i})"
             oncontextmenu="musicShowTrackMenu(event,${i})">
            ${inPlaylist ? `<i class="fas fa-grip-lines music-track-grip"></i>` : ''}
            <button class="music-track-play" onclick="musicPlay(${i})">
                <i class="fas ${icon} text-[10px]"></i>
            </button>
            <div class="music-track-name">
                <span class="music-track-title">${escHtml(track.title)}</span>
            </div>
            <span id="music-dur-${i}" class="music-track-dur">${musicFmt(track.duration)}</span>
            <span class="music-track-size">${size}</span>
        </div>`;
    }).join('');
}
