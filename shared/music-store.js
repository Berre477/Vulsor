// ── Shared music library ───────────────────────────────────────────────
// One library on disk, read and written by BOTH apps:
//   • Vulsor          (js/music.js)
//   • VulsorPlay      (VulsorPlay/js/library.js)
//
// Canonical file: ~/Documents/Vulsor_Memories/music.json — the same folder
// the rest of Vulsor's data lives in. Whichever app writes it, the other
// picks the change up live through watch().
//
// NOTE: this file is duplicated at VulsorPlay/shared/music-store.js so the
// packaged app carries its own copy. Keep the two in sync.

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const DATA_DIR = path.join(os.homedir(), 'Documents', 'Vulsor_Memories');
const LIB_FILE = path.join(DATA_DIR, 'music.json');
const DL_DIR   = path.join(os.homedir(), 'Music', 'Vulsor');

const EMPTY = { version: 1, updatedAt: 0, tracks: [], playlists: [], folders: [] };

// The exact JSON we last wrote. The watcher compares against this so an app
// never re-renders (or worse, echoes back) its own save.
let _lastWritten = null;

const VIDEO_EXTS = /\.(mp4|webm|mkv|mov|avi|m4v)$/i;
const MEDIA_EXTS = /\.(mp3|mp4|m4a|wav|ogg|flac|aac|opus|webm|mkv|mov|avi|m4v)$/i;

function isVideo(filePath) { return VIDEO_EXTS.test(filePath || ''); }

function ensureDirs() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(DL_DIR))   fs.mkdirSync(DL_DIR,   { recursive: true });
}

// ── Normalising ────────────────────────────────────────────────────────
// Tracks are keyed by absolute file path — that is what makes the library
// meaningful across two apps. Everything else is best-effort metadata.
function normaliseTrack(t) {
    if (!t || !t.path) return null;
    return {
        path:     String(t.path),
        title:    t.title || path.basename(t.path).replace(/\.[^.]+$/, ''),
        duration: Number(t.duration) || 0,
        size:     Number(t.size) || 0,
        kind:     t.kind || (isVideo(t.path) ? 'video' : 'audio'),
        artist:   t.artist || '',
        thumb:    t.thumb  || '',
        source:   t.source || '',
        addedAt:  Number(t.addedAt) || Date.now(),
    };
}

function normalise(raw) {
    const d = (raw && typeof raw === 'object') ? raw : {};
    const seen = new Set();
    const tracks = [];
    for (const t of Array.isArray(d.tracks) ? d.tracks : []) {
        const n = normaliseTrack(t);
        if (!n || seen.has(n.path)) continue;   // path is the identity
        seen.add(n.path);
        tracks.push(n);
    }
    const folders = (Array.isArray(d.folders) ? d.folders : [])
        .filter(f => f && f.id != null)
        .map(f => ({ id: f.id, name: f.name || 'Folder', collapsed: !!f.collapsed }));

    const playlists = (Array.isArray(d.playlists) ? d.playlists : [])
        .filter(p => p && p.id != null)
        .map(p => ({
            id: p.id,
            name: p.name || 'Playlist',
            // Drop references to tracks that no longer exist in the library.
            trackPaths: (Array.isArray(p.trackPaths) ? p.trackPaths : []).filter(fp => seen.has(fp)),
            folderId: p.folderId != null ? p.folderId : null,
        }));

    return { version: 1, updatedAt: Number(d.updatedAt) || 0, tracks, playlists, folders };
}

// ── Read / write ───────────────────────────────────────────────────────
function read() {
    try {
        if (!fs.existsSync(LIB_FILE)) return { ...EMPTY };
        return normalise(JSON.parse(fs.readFileSync(LIB_FILE, 'utf8')));
    } catch (e) {
        console.error('[music-store] read failed:', e.message);
        return { ...EMPTY };
    }
}

// Atomic: write a temp file next to the target, then rename over it. A reader
// in the other app therefore never observes a half-written library.
function write(data) {
    ensureDirs();
    const out  = normalise(data);
    out.updatedAt = Date.now();
    const json = JSON.stringify(out, null, 2);
    const tmp  = LIB_FILE + '.' + process.pid + '.tmp';
    try {
        fs.writeFileSync(tmp, json, 'utf8');
        fs.renameSync(tmp, LIB_FILE);
        _lastWritten = json;
        return out;
    } catch (e) {
        console.error('[music-store] write failed:', e.message);
        try { fs.unlinkSync(tmp); } catch (_) {}
        return out;
    }
}

// Read-modify-write against the file as it is *right now*, so a save from one
// app doesn't clobber a change the other app made a moment earlier.
function mutate(fn) {
    const current = read();
    const next = fn(current) || current;
    return write(next);
}

// ── Live sync ──────────────────────────────────────────────────────────
// Watch the directory rather than the file: atomic writes swap the inode, and
// a file-level watch would silently stop firing after the first rename.
function watch(onChange) {
    ensureDirs();
    let timer = null;
    let watcher = null;

    const fire = () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
            let json;
            try { json = fs.readFileSync(LIB_FILE, 'utf8'); } catch (_) { return; }
            if (json === _lastWritten) return;      // our own save — ignore
            _lastWritten = json;
            try { onChange(normalise(JSON.parse(json))); }
            catch (e) { console.error('[music-store] watch parse failed:', e.message); }
        }, 120);   // debounce: one rename can emit several events
    };

    try {
        watcher = fs.watch(DATA_DIR, (_, filename) => {
            if (!filename || path.basename(filename) !== 'music.json') return;
            fire();
        });
    } catch (e) {
        console.error('[music-store] watch failed:', e.message);
    }
    return () => { clearTimeout(timer); try { watcher && watcher.close(); } catch (_) {} };
}

// ── One-time migration out of Vulsor's localStorage ─────────────────────
// Vulsor kept the library in localStorage, which lives inside Electron's
// per-app profile and is therefore invisible to a second app. Lift it into
// the shared file once, then leave a marker so we never do it again.
function migrateFromLocalStorage(storage) {
    if (!storage) return null;
    if (storage.getItem('musicMigratedToSharedStore') === '1') return null;

    const parse = (key) => {
        try { return JSON.parse(storage.getItem(key) || '[]'); } catch (_) { return []; }
    };
    const oldTracks    = parse('musicLibrary');
    const oldPlaylists = parse('musicPlaylists');
    const oldFolders   = parse('musicFolders');

    if (!oldTracks.length && !oldPlaylists.length && !oldFolders.length) {
        storage.setItem('musicMigratedToSharedStore', '1');
        return null;
    }

    const merged = mutate(lib => {
        const byPath = new Set(lib.tracks.map(t => t.path));
        for (const t of oldTracks) {
            const n = normaliseTrack(t);
            if (n && !byPath.has(n.path)) { byPath.add(n.path); lib.tracks.push(n); }
        }
        const plIds = new Set(lib.playlists.map(p => String(p.id)));
        for (const p of oldPlaylists) {
            if (p && p.id != null && !plIds.has(String(p.id))) lib.playlists.push(p);
        }
        const fIds = new Set(lib.folders.map(f => String(f.id)));
        for (const f of oldFolders) {
            if (f && f.id != null && !fIds.has(String(f.id))) lib.folders.push(f);
        }
        return lib;
    });

    storage.setItem('musicMigratedToSharedStore', '1');
    console.log(`[music-store] migrated ${oldTracks.length} track(s) from localStorage`);
    return merged;
}

// ── Convenience used by both apps ──────────────────────────────────────
function fileSize(filePath) {
    try { return fs.statSync(filePath).size; } catch (_) { return 0; }
}

// Returns the updated library, or null when the track was already present.
function addTrack(track) {
    const n = normaliseTrack(track);
    if (!n) return null;
    let added = false;
    const lib = mutate(l => {
        if (l.tracks.some(t => t.path === n.path)) return l;
        if (!n.size) n.size = fileSize(n.path);
        l.tracks.push(n);
        added = true;
        return l;
    });
    return added ? lib : null;
}

function removeTrack(filePath) {
    return mutate(l => {
        l.tracks = l.tracks.filter(t => t.path !== filePath);
        l.playlists.forEach(p => { p.trackPaths = p.trackPaths.filter(fp => fp !== filePath); });
        return l;
    });
}

// Drop library entries whose file has been deleted or moved on disk.
function pruneMissing() {
    return mutate(l => {
        l.tracks = l.tracks.filter(t => fs.existsSync(t.path));
        const alive = new Set(l.tracks.map(t => t.path));
        l.playlists.forEach(p => { p.trackPaths = p.trackPaths.filter(fp => alive.has(fp)); });
        return l;
    });
}

module.exports = {
    LIB_FILE, DATA_DIR, DL_DIR, MEDIA_EXTS, VIDEO_EXTS,
    isVideo, read, write, mutate, watch, migrateFromLocalStorage,
    addTrack, removeTrack, pruneMissing, fileSize, normaliseTrack,
};
