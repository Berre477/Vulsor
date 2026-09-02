// ── Karaoke ─────────────────────────────────────────────────────

let karaokeData      = {};   // { [trackPath]: { lyrics: string } }
let kActivePl        = null; // active musicPlaylists id, or null = all tracks
let kPlaylistView    = 'playlists'; // 'playlists' | 'songs'
let kTrackIdx        = null; // selected track index in musicLibrary
let kLines           = [];
let kIsLRC           = false;
let kCurrentLine     = 0;
let kDisplayFontSize = 40;
let kCurrentColor    = '#ffffff';
let kAutoScroll      = true;
let kTimingOffset    = 1.0; // seconds early — line highlights before the beat

// ── Persist ───────────────────────────────────────────────────
function loadKaraoke() {
    try { karaokeData = JSON.parse(localStorage.getItem('karaokeData') || '{}'); } catch(e) { karaokeData = {}; }
    try {
        const saved = JSON.parse(localStorage.getItem('karaokePrefs') || '{}');
        if (saved.fontSize)    kDisplayFontSize = saved.fontSize;
        if (saved.color)       kCurrentColor    = saved.color;
        if (saved.autoScroll !== undefined) kAutoScroll = saved.autoScroll;
        if (saved.timingOffset !== undefined) kTimingOffset = saved.timingOffset;
    } catch(e) {}
}

function saveKaraoke() {
    localStorage.setItem('karaokeData', JSON.stringify(karaokeData));
    localStorage.setItem('karaokePrefs', JSON.stringify({
        fontSize: kDisplayFontSize, color: kCurrentColor, autoScroll: kAutoScroll,
        timingOffset: kTimingOffset
    }));
}

// ── Render entry (called when switching to tab) ───────────────
function renderKaraoke() {
    renderKaraokePlaylists();
    if (kTrackIdx !== null) karaokeUpdateDisplay();
    const cb = document.getElementById('karaoke-autoscroll');
    if (cb) cb.checked = kAutoScroll;
    const slider = document.getElementById('karaoke-timing-slider');
    const label  = document.getElementById('karaoke-timing-label');
    if (slider) slider.value = kTimingOffset;
    if (label)  label.textContent = kTimingOffset.toFixed(1) + 's';
    kSyncPlayerUI();
}

// ── Playlist list view (reads shared musicPlaylists) ──────────
function renderKaraokePlaylists() {
    const list = document.getElementById('karaoke-pl-list');
    if (!list) return;

    const playlists = (typeof musicPlaylists !== 'undefined') ? musicPlaylists : [];

    if (kPlaylistView === 'songs') {
        // Show songs in the selected playlist
        let tracks = [];
        let plName = 'Playlist';
        if (kActivePl) {
            const pl = playlists.find(p => p.id === kActivePl);
            if (pl) {
                plName = pl.name;
                tracks = pl.trackPaths
                    .map(tp => { const i = (musicLibrary||[]).findIndex(t => t.path === tp); return i >= 0 ? { idx: i, t: musicLibrary[i] } : null; })
                    .filter(Boolean);
            }
        } else {
            tracks = (musicLibrary || []).map((t, i) => ({ idx: i, t }));
        }

        let html = `<button onclick="kBackToPlaylists()"
            class="w-full text-left px-2.5 py-1.5 text-xs text-slate-500 hover:text-slate-300 flex items-center gap-1.5 transition-colors shrink-0">
            <i class="fas fa-chevron-left text-[9px]"></i>
            <span class="truncate font-medium">${escHtml(plName)}</span>
        </button>`;

        if (!tracks.length) {
            html += '<p class="text-slate-700 text-xs italic px-2 py-2">No tracks in this playlist.</p>';
        } else {
            html += tracks.map(({ idx, t }) => {
                const hasLyrics = !!(karaokeData[t.path] && karaokeData[t.path].lyrics);
                const active    = kTrackIdx === idx;
                return `<button onclick="karaokeSelectTrack(${idx})"
                    class="w-full text-left px-2.5 py-1.5 rounded-lg text-xs flex items-center gap-2 transition-colors ${
                        active ? '' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                    }"
                    style="${active ? 'background:rgba(var(--accent-rgb),.15);color:var(--accent-light)' : ''}">
                    <i class="fas fa-${hasLyrics ? 'file-alt' : 'music'} text-[9px] opacity-50 shrink-0"></i>
                    <span class="flex-1 truncate">${escHtml(t.title)}</span>
                    ${hasLyrics ? `<i class="fas fa-check-circle text-[9px]" style="color:var(--accent-light);opacity:.7"></i>` : ''}
                </button>`;
            }).join('');
        }

        list.innerHTML = html;
        return;
    }

    // Playlists view
    let html = '';
    if (!playlists.length) {
        html = `<p class="text-slate-700 text-[10px] italic px-1 py-2">No playlists yet — create them in the Music tab</p>`;
    } else {
        playlists.forEach(pl => {
            const active = kActivePl === pl.id && kPlaylistView === 'songs';
            html += `<button onclick="kSelectPlaylist(${pl.id})"
                class="w-full text-left px-2.5 py-1.5 rounded-lg text-xs flex items-center gap-2 transition-colors ${active ? '' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'}"
                style="${active ? 'background:rgba(var(--accent-rgb),.15);color:var(--accent-light)' : ''}">
                <i class="fas fa-list text-[9px] opacity-50 shrink-0"></i>
                <span class="flex-1 truncate">${escHtml(pl.name)}</span>
                <span class="text-[9px] opacity-40">${pl.trackPaths.length}</span>
            </button>`;
        });
    }
    list.innerHTML = html;
}

function kSelectPlaylist(id) {
    kActivePl = id;
    kPlaylistView = 'songs';
    renderKaraokePlaylists();
}

function kBackToPlaylists() {
    kPlaylistView = 'playlists';
    renderKaraokePlaylists();
}

// ── Select track ──────────────────────────────────────────────
function karaokeSelectTrack(idx) {
    kTrackIdx    = idx;
    kCurrentLine = 0;
    const track = musicLibrary[idx];
    if (!track) return;

    // Populate the lyrics textarea
    const lyrics = (karaokeData[track.path] && karaokeData[track.path].lyrics) || '';
    const ta = document.getElementById('karaoke-lyrics-input');
    if (ta) ta.value = lyrics;

    // Update track name label
    const nameEl = document.getElementById('karaoke-track-name');
    if (nameEl) nameEl.textContent = track.title;

    // Load audio for this track (but don't auto-play)
    const audio = kGetAudio();
    if (audio) {
        const { pathToFileURL } = require('url');
        const newSrc = pathToFileURL(track.path).href;
        if (audio.src !== newSrc) {
            audio.src = newSrc;
            audio.load();
        }
        if (typeof musicIndex !== 'undefined') musicIndex = idx;
    }

    kParseLines(lyrics);
    // Merge word-level klyric if saved
    const klyric = (karaokeData[track.path] && karaokeData[track.path].klyric) || '';
    if (klyric) kMergeKlyric(kParseKlyric(klyric));
    renderKaraokePlaylists();
    karaokeUpdateDisplay();
    kSyncPlayerUI();
}

// ── Parse lyrics (plain text or LRC) ─────────────────────────
function kParseLines(text) {
    const lrcRx = /^\[(\d{1,2}):(\d{2})\.(\d{2,3})\](.*)/;
    const rows   = text.split('\n');
    const hasTS  = rows.some(r => lrcRx.test(r));

    if (hasTS) {
        kIsLRC = true;
        kLines = [];
        rows.forEach(row => {
            const m = row.match(lrcRx);
            if (m) {
                const t = parseInt(m[1]) * 60 + parseFloat(m[2] + '.' + m[3]);
                const txt = m[4].trim();
                if (txt) kLines.push({ time: t, text: txt });
            }
        });
        kLines.sort((a, b) => a.time - b.time);
    } else {
        kIsLRC = false;
        kLines = rows
            .map(r => ({ time: null, text: r }))
            .filter((l, i, arr) => {
                if (l.text) return true;
                return i > 0 && i < arr.length - 1;
            });
    }
}

// ── Parse NetEase word-level klyric ──────────────────────────
// Format per line: [MM:SS.xx][MM:SS.xx,durMs]word1 [MM:SS.xx,durMs]word2 ...
function kParseKlyric(text) {
    const lineStartRx = /^\[(\d+):(\d+\.\d+)\]/;
    const wordRx      = /\[(\d+):(\d+\.\d+),(\d+)\]([^\[]*)/g;
    const lines = [];
    for (const row of text.split('\n')) {
        const lm = row.match(lineStartRx);
        if (!lm) continue;
        const lineTime = parseInt(lm[1]) * 60 + parseFloat(lm[2]);
        const rest = row.slice(lm[0].length);
        wordRx.lastIndex = 0;
        const words = [];
        let wm;
        while ((wm = wordRx.exec(rest)) !== null) {
            const wTime = parseInt(wm[1]) * 60 + parseFloat(wm[2]);
            const wDur  = parseInt(wm[3]) / 1000;
            const wText = wm[4].trim();
            if (wText) words.push({ time: wTime, dur: wDur, text: wText });
        }
        if (words.length) {
            lines.push({ time: lineTime, text: words.map(w => w.text).join(' '), words });
        }
    }
    return lines.sort((a, b) => a.time - b.time);
}

// Merge word-level data from klyric into existing kLines
function kMergeKlyric(klyricLines) {
    if (!klyricLines.length) return;
    kIsLRC = true;
    // If we have no LRC lines at all, just use klyric lines directly
    if (!kLines.length) { kLines = klyricLines; return; }
    // Match each klyric line to the closest kLines entry and attach words
    klyricLines.forEach(kl => {
        let best = 0, bestDiff = Infinity;
        kLines.forEach((ll, i) => {
            if (ll.time == null) return;
            const diff = Math.abs(ll.time - kl.time);
            if (diff < bestDiff) { bestDiff = diff; best = i; }
        });
        if (bestDiff < 2) kLines[best].words = kl.words;
    });
}

// ── Lyrics live input ─────────────────────────────────────────
function karaokeOnLyricsInput() {
    const ta = document.getElementById('karaoke-lyrics-input');
    if (!ta) return;
    kParseLines(ta.value);
    kCurrentLine = 0;
    karaokeUpdateDisplay();
}

// ── Save lyrics for current track ────────────────────────────
function kSaveLyrics() {
    const track = kTrackIdx !== null ? musicLibrary[kTrackIdx] : null;
    const ta    = document.getElementById('karaoke-lyrics-input');
    if (!track || !ta) return;
    if (!karaokeData[track.path]) karaokeData[track.path] = {};
    karaokeData[track.path].lyrics = ta.value;
    saveKaraoke();
    renderKaraokePlaylists();
    kParseLines(ta.value);
    kCurrentLine = 0;
    karaokeUpdateDisplay();
}

// ── Build the display ─────────────────────────────────────────
function karaokeUpdateDisplay() {
    const empty    = document.getElementById('karaoke-empty');
    const linesDiv = document.getElementById('karaoke-lines');
    if (!empty || !linesDiv) return;

    if (!kLines.length) {
        empty.style.display = '';
        linesDiv.classList.add('hidden');
        return;
    }

    empty.style.display = 'none';
    linesDiv.classList.remove('hidden');

    const accent = getComputedStyle(document.documentElement)
        .getPropertyValue('--accent-light').trim() || '#f87171';
    const currentClr = kCurrentColor === 'accent' ? accent : kCurrentColor;

    const audio = kGetAudio();
    const nowT  = audio ? audio.currentTime : 0;

    linesDiv.innerHTML = kLines.map((ln, i) => {
        if (!ln.text) return `<div class="karaoke-spacer"></div>`;
        const isCur  = i === kCurrentLine;
        const isPast = i < kCurrentLine;

        // Word-level rendering for the current line (when klyric data available)
        let innerHtml;
        if (isCur && ln.words && ln.words.length) {
            innerHtml = ln.words.map(w => {
                const active   = nowT >= w.time && nowT < (w.time + w.dur);
                const pastWord = nowT >= (w.time + w.dur);
                const cls = active ? 'k-word k-word-on' : pastWord ? 'k-word k-word-past' : 'k-word';
                return `<span class="${cls}">${escHtml(w.text)}</span>`;
            }).join(' ');
        } else {
            innerHtml = escHtml(ln.text);
        }

        return `<div
            data-line="${i}"
            class="karaoke-line ${isCur ? 'karaoke-cur' : isPast ? 'karaoke-past' : 'karaoke-future'}"
            style="font-size:${isCur ? kDisplayFontSize + 14 : kDisplayFontSize}px;${isCur ? `color:${currentClr};` : ''}"
            onclick="kJumpTo(${i})">
            ${innerHtml}
        </div>`;
    }).join('');

    if (kAutoScroll) kScrollToCurrent();
}

// Efficiently update word highlighting within the current line (no DOM rebuild)
function kUpdateWordHighlight(t) {
    const line = kLines[kCurrentLine];
    if (!line || !line.words) return;
    const linesDiv = document.getElementById('karaoke-lines');
    if (!linesDiv) return;
    const curEl = linesDiv.querySelector('.karaoke-cur');
    if (!curEl) return;
    const spans = curEl.querySelectorAll('.k-word');
    line.words.forEach((w, i) => {
        if (i >= spans.length) return;
        const active   = t >= w.time && t < (w.time + w.dur);
        const pastWord = t >= (w.time + w.dur);
        spans[i].className = active ? 'k-word k-word-on' : pastWord ? 'k-word k-word-past' : 'k-word';
    });
}

// ── Scroll current line into the vertical centre ──────────────
function kScrollToCurrent() {
    const linesDiv = document.getElementById('karaoke-lines');
    const display  = document.getElementById('karaoke-display');
    if (!linesDiv || !display) return;
    const cur = linesDiv.querySelector('.karaoke-cur');
    if (!cur) return;
    const dRect = display.getBoundingClientRect();
    const cRect = cur.getBoundingClientRect();
    const targetScroll = display.scrollTop + (cRect.top - dRect.top) - dRect.height / 2 + cRect.height / 2;
    display.scrollTo({ top: targetScroll, behavior: 'smooth' });
}

// ── Line navigation ───────────────────────────────────────────
function kJumpTo(i) {
    kCurrentLine = i;
    karaokeUpdateDisplay();
}

function kNextLine() {
    if (!kLines.length) return;
    // Skip blank spacer lines
    let next = kCurrentLine + 1;
    while (next < kLines.length && !kLines[next].text) next++;
    if (next < kLines.length) { kCurrentLine = next; karaokeUpdateDisplay(); }
}

function kPrevLine() {
    if (!kLines.length) return;
    let prev = kCurrentLine - 1;
    while (prev >= 0 && !kLines[prev].text) prev--;
    if (prev >= 0) { kCurrentLine = prev; karaokeUpdateDisplay(); }
}

// ── Font size ─────────────────────────────────────────────────
function kFontSize(delta) {
    kDisplayFontSize = Math.max(16, Math.min(96, kDisplayFontSize + delta));
    saveKaraoke();
    karaokeUpdateDisplay();
}

// ── Text colour ───────────────────────────────────────────────
function kSetColor(color) {
    kCurrentColor = color;
    saveKaraoke();
    karaokeUpdateDisplay();
}

// ── Auto-scroll toggle ────────────────────────────────────────
function kToggleAutoScroll(val) {
    kAutoScroll = val;
    saveKaraoke();
    if (kAutoScroll) kScrollToCurrent();
}

function kSetTimingOffset(val) {
    kTimingOffset = val;
    const label = document.getElementById('karaoke-timing-label');
    if (label) label.textContent = val.toFixed(1) + 's';
    saveKaraoke();
}

// ── NetEase Cloud Music — word-level klyric fetch ────────────
async function kFetchNetease(artist, title) {
    const q = [artist, title].filter(Boolean).join(' ');
    try {
        const sRes = await fetch('https://music.163.com/api/search/get', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent':   'Mozilla/5.0',
                'Referer':      'https://music.163.com/'
            },
            body: `s=${encodeURIComponent(q)}&type=1&limit=10`
        });
        if (!sRes.ok) return null;
        const sd = await sRes.json();
        const songs = sd?.result?.songs;
        if (!songs || !songs.length) return null;

        // Pick the best matching song (prefer exact title + artist match)
        let pick = songs[0];
        for (const s of songs) {
            const sName   = (s.name || '').toLowerCase();
            const sArtist = (s.artists || []).map(a => a.name).join(' ').toLowerCase();
            if (sName.includes(title.toLowerCase()) &&
                (!artist || sArtist.includes(artist.toLowerCase()))) {
                pick = s; break;
            }
        }

        const lRes = await fetch(
            `https://music.163.com/api/song/lyric?id=${pick.id}&lv=1&kv=1&tv=-1`,
            { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://music.163.com/' } }
        );
        if (!lRes.ok) return null;
        const ld = await lRes.json();
        return {
            klyric: ld?.klyric?.lyric || null,
            lrc:    ld?.lrc?.lyric    || null
        };
    } catch (e) {
        console.warn('[kFetchNetease]', e);
        return null;
    }
}

// ── Clean a raw filename into a searchable title ─────────────
function kCleanForSearch(raw) {
    return raw
        // Remove leading track numbers: "01 ", "1. ", "02 - "
        .replace(/^\d+[\s.\-–]+/, '')
        // Replace underscores/dots with spaces
        .replace(/[_\.]+/g, ' ')
        // Remove ALL bracketed/parenthesized content (anywhere)
        .replace(/[\(\[【][^\)\]】]*[\)\]】]/g, '')
        // Strip common YouTube / download junk words
        .replace(/\b(lyrics?|lyric\s*video|official\s*(music\s*)?video|official\s*audio|official|audio|video|visualizer|hd|4k|1080p|720p|explicit|clean|topic|vevo|remaster(ed)?|live(\s*version)?|acoustic(\s*version)?|cover|karaoke|instrumental|radio\s*edit|extended|version|original|single|album|ost|soundtrack)\b/gi, '')
        // Restore apostrophes lost in filenames
        .replace(/\bcan\s*t\b/gi, "can't")
        .replace(/\bdon\s*t\b/gi, "don't")
        .replace(/\bwon\s*t\b/gi, "won't")
        .replace(/\bdoesn\s*t\b/gi, "doesn't")
        .replace(/\bisn\s*t\b/gi, "isn't")
        .replace(/\baren\s*t\b/gi, "aren't")
        .replace(/\bwasn\s*t\b/gi, "wasn't")
        .replace(/\bweren\s*t\b/gi, "weren't")
        .replace(/\bhadn\s*t\b/gi, "hadn't")
        .replace(/\bhasn\s*t\b/gi, "hasn't")
        .replace(/\bcouldn\s*t\b/gi, "couldn't")
        .replace(/\bwouldn\s*t\b/gi, "wouldn't")
        .replace(/\bshouldn\s*t\b/gi, "shouldn't")
        .replace(/\bi\s*m\b/gi, "i'm")
        .replace(/\bi\s*ve\b/gi, "i've")
        .replace(/\bi\s*ll\b/gi, "i'll")
        .replace(/\bi\s*d\b/gi, "i'd")
        .replace(/\byou\s*re\b/gi, "you're")
        .replace(/\byou\s*ve\b/gi, "you've")
        .replace(/\byou\s*ll\b/gi, "you'll")
        .replace(/\bthey\s*re\b/gi, "they're")
        .replace(/\bwe\s*re\b/gi, "we're")
        .replace(/\bhe\s*s\b/gi, "he's")
        .replace(/\bshe\s*s\b/gi, "she's")
        .replace(/\bit\s*s\b/gi, "it's")
        .replace(/\bthat\s*s\b/gi, "that's")
        .replace(/\bwhat\s*s\b/gi, "what's")
        .replace(/\bwho\s*s\b/gi, "who's")
        .replace(/\blet\s*s\b/gi, "let's")
        // Strip leftover ft./feat.
        .replace(/\b(ft\.?|feat\.?)\s+.*/i, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

// ── Parse artist + title from a track title string ───────────
function kParseArtistTitle(raw) {
    // Common separators: " - ", " – ", " — "
    const sepRx = /\s+[-–—]\s+/;
    const m = raw.match(sepRx);
    if (m) {
        const sepIdx = raw.indexOf(m[0]);
        const left  = kCleanForSearch(raw.slice(0, sepIdx));
        const right = kCleanForSearch(raw.slice(sepIdx + m[0].length));
        // Heuristic: artist is usually shorter; if both sides have > 2 words, keep order
        return { artist: left, title: right };
    }
    // No separator — treat the whole thing as title only
    return { artist: '', title: kCleanForSearch(raw) };
}

// ── Search lrclib with a fallback strategy ───────────────────
async function kSearchLrclib(artist, title) {
    const attempts = [
        { track_name: title, artist_name: artist },   // full
        { track_name: title },                         // title only
        { artist_name: artist, track_name: title.split(' ').slice(0, 4).join(' ') } // first 4 words
    ].filter(p => p.track_name);

    for (const params of attempts) {
        try {
            const res = await fetch(`https://lrclib.net/api/search?${new URLSearchParams(params)}`, {
                headers: { 'User-Agent': 'VulsorApp/1.0 (contact: alexandervinhome@gmail.com)' }
            });
            if (!res.ok) continue;
            const results = await res.json();
            if (results && results.length) {
                const best = results.find(r => r.syncedLyrics) || results.find(r => r.plainLyrics);
                if (best) return best;
            }
        } catch (_) {}
    }
    return null;
}

// ── Auto-fetch lyrics (NetEase word-level → lrclib line-level) ─
async function kFetchLyrics() {
    const track = kTrackIdx !== null ? musicLibrary[kTrackIdx] : null;
    if (!track) { alert('Select a track first.'); return; }

    const btn = document.getElementById('karaoke-fetch-btn');
    const origHtml = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-circle-notch fa-spin text-[10px] mr-1"></i> Fetching…'; }

    const { artist, title: songTitle } = kParseArtistTitle(track.title);

    try {
        let lyricsText = '';
        let klyricText = '';
        let source     = '';

        // ── 1. Try NetEase (word-level klyric) ──────────────────
        if (btn) btn.innerHTML = '<i class="fas fa-circle-notch fa-spin text-[10px] mr-1"></i> Trying NetEase…';
        const ne = await kFetchNetease(artist, songTitle);
        if (ne && ne.klyric) {
            const parsed = kParseKlyric(ne.klyric);
            if (parsed.length >= 3) {
                klyricText = ne.klyric;
                lyricsText = ne.lrc || parsed.map(l => {
                    const mm = String(Math.floor(l.time / 60)).padStart(2, '0');
                    const ss = (l.time % 60).toFixed(2).padStart(5, '0');
                    return `[${mm}:${ss}]${l.text}`;
                }).join('\n');
                source = 'word-level';
            }
        }

        // ── 2. Try lrclib.net with multiple fallback queries ─────
        if (!lyricsText) {
            if (btn) btn.innerHTML = '<i class="fas fa-circle-notch fa-spin text-[10px] mr-1"></i> Trying lrclib…';
            const best = await kSearchLrclib(artist, songTitle);
            if (best) {
                lyricsText = best.syncedLyrics || best.plainLyrics || '';
                if (lyricsText) source = best.syncedLyrics ? 'line-level' : 'plain';
            }
        }

        if (!lyricsText) {
            if (btn) { btn.innerHTML = origHtml; btn.disabled = false; }
            // Nothing online — offer to listen to the song and transcribe it instead.
            if (typeof kTranscribeAudio === 'function' &&
                confirm(`No online lyrics found for "${track.title}".\n\nListen to the song and transcribe the lyrics on-device (Whisper AI)? This takes about a minute.`)) {
                return kTranscribeAudio();
            }
            alert(`No lyrics found. Tip: rename the file "Artist - Song Title.mp3", paste lyrics manually, or use “Listen & Transcribe”.`);
            return;
        }

        // Save lyrics + klyric
        const ta = document.getElementById('karaoke-lyrics-input');
        if (ta) ta.value = lyricsText;
        if (!karaokeData[track.path]) karaokeData[track.path] = {};
        karaokeData[track.path].lyrics  = lyricsText;
        karaokeData[track.path].klyric  = klyricText;
        saveKaraoke();
        renderKaraokePlaylists();

        // Parse and display
        kParseLines(lyricsText);
        if (klyricText) kMergeKlyric(kParseKlyric(klyricText));
        kCurrentLine = 0;
        karaokeUpdateDisplay();

        const label = source === 'word-level' ? '✦ Word-level sync!' : source === 'line-level' ? 'Line-level sync' : 'Plain lyrics';
        if (btn) btn.innerHTML = `<i class="fas fa-check text-[10px] mr-1"></i> ${label}`;
        setTimeout(() => { if (btn) { btn.innerHTML = origHtml; btn.disabled = false; } }, 2500);

    } catch (err) {
        console.error('[kFetchLyrics]', err);
        alert('Could not fetch lyrics: ' + err.message);
        if (btn) { btn.innerHTML = origHtml; btn.disabled = false; }
    }
}

// ── Listen to the audio & transcribe timed lyrics (on-device Whisper) ──
// Sends the track to the main process, which runs ffmpeg + whisper.cpp locally and
// returns LRC (timestamped lines) that drop straight into the synced display.
async function kTranscribeAudio() {
    const track = kTrackIdx !== null ? musicLibrary[kTrackIdx] : null;
    if (!track) { alert('Select a track first.'); return; }
    const { ipcRenderer } = require('electron');
    const btn  = document.getElementById('karaoke-transcribe-btn');
    const orig = btn ? btn.innerHTML : '';
    const setBtn = html => { if (btn) btn.innerHTML = html; };
    if (btn) btn.disabled = true;
    setBtn('<i class="fas fa-circle-notch fa-spin text-[10px] mr-1"></i> Preparing…');

    // Make sure the local transcriber is available, with a helpful message if not.
    try {
        const avail = await ipcRenderer.invoke('karaoke:transcribe-available');
        if (!avail || !avail.ok) {
            const need = !avail ? 'the transcriber'
                : !avail.whisper ? 'whisper-cli  (install: brew install whisper-cpp)'
                : !avail.model   ? 'a Whisper model (ggml-base.bin in Vulsor’s app-support folder)'
                : 'ffmpeg';
            alert('On-device transcription needs ' + need + '.');
            setBtn(orig); if (btn) btn.disabled = false; return;
        }
    } catch (_) {}

    const onProg = (_e, d) => {
        if (!btn || !d) return;
        if (d.phase === 'decoding')       setBtn('<i class="fas fa-circle-notch fa-spin text-[10px] mr-1"></i> Decoding…');
        else if (d.phase === 'listening') setBtn(`<i class="fas fa-circle-notch fa-spin text-[10px] mr-1"></i> Listening… ${d.pct || 0}%`);
    };
    ipcRenderer.on('karaoke:transcribe-progress', onProg);
    try {
        const res = await ipcRenderer.invoke('karaoke:transcribe', { path: track.path, lang: 'auto' });
        if (!res || !res.ok) {
            alert('Could not transcribe: ' + ((res && res.error) || 'unknown error'));
            setBtn(orig); if (btn) btn.disabled = false; return;
        }
        const lrc = res.lrc;
        const ta = document.getElementById('karaoke-lyrics-input');
        if (ta) ta.value = lrc;
        if (!karaokeData[track.path]) karaokeData[track.path] = {};
        karaokeData[track.path].lyrics = lrc;
        karaokeData[track.path].klyric = '';
        saveKaraoke();
        renderKaraokePlaylists();
        kParseLines(lrc);
        kCurrentLine = 0;
        karaokeUpdateDisplay();
        setBtn('<i class="fas fa-check text-[10px] mr-1"></i> Transcribed!');
        setTimeout(() => { setBtn(orig); if (btn) btn.disabled = false; }, 2500);
    } catch (err) {
        alert('Transcription failed: ' + ((err && err.message) || err));
        setBtn(orig); if (btn) btn.disabled = false;
    } finally {
        try { ipcRenderer.removeListener('karaoke:transcribe-progress', onProg); } catch (_) {}
    }
}
window.kTranscribeAudio = kTranscribeAudio;

// ── Fullscreen (CSS-based, works reliably in Electron) ────────
let kIsFullscreen = false;

function kFullscreen() {
    const el  = document.getElementById('karaoke-main');
    const btn = document.querySelector('[onclick="kFullscreen()"]');
    if (!el) return;

    kIsFullscreen = !kIsFullscreen;

    if (kIsFullscreen) {
        el.classList.add('karaoke-fs');
        if (btn) btn.innerHTML = '<i class="fas fa-compress text-[10px]"></i>';
    } else {
        el.classList.remove('karaoke-fs');
        if (btn) btn.innerHTML = '<i class="fas fa-expand text-[10px]"></i>';
    }
}

// ESC closes fullscreen
document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && kIsFullscreen) kFullscreen();
});

// ══════════════════════════════════════════════════════════════
// ── Microphone — sing through the speakers, with echo + meter ──
// ══════════════════════════════════════════════════════════════
let kMicCtx = null, kMicStream = null, kMicGain = null, kMicAnalyser = null;
let kMicOn = false, kMicReverb = true, kMicVolume = 1.4, kMicMeterRaf = null;
let kMicWet = null;

async function kMicToggle() {
    if (kMicOn) { kMicStop(); return; }
    const btn = document.getElementById('karaoke-mic-btn');
    try {
        // Raw mic: disable processing that would eat a singing voice
        kMicStream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        });
        kMicCtx = kMicCtx || new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
        if (kMicCtx.state === 'suspended') await kMicCtx.resume();

        const src = kMicCtx.createMediaStreamSource(kMicStream);
        kMicGain  = kMicCtx.createGain();
        kMicGain.gain.value = kMicVolume;

        // Simple feedback-delay "hall" echo — cheap and flattering
        const delay = kMicCtx.createDelay(1.0);
        delay.delayTime.value = 0.16;
        const fb = kMicCtx.createGain(); fb.gain.value = 0.32;
        kMicWet = kMicCtx.createGain(); kMicWet.gain.value = kMicReverb ? 0.35 : 0;
        delay.connect(fb); fb.connect(delay);

        kMicAnalyser = kMicCtx.createAnalyser();
        kMicAnalyser.fftSize = 256;

        src.connect(kMicGain);
        kMicGain.connect(kMicAnalyser);
        kMicGain.connect(kMicCtx.destination);            // dry voice
        kMicGain.connect(delay); delay.connect(kMicWet);  // echo tail
        kMicWet.connect(kMicCtx.destination);

        kMicOn = true;
        if (btn) { btn.classList.add('k-mic-live'); btn.title = 'Mic is live — click to turn off'; }
        document.getElementById('karaoke-mic-extras')?.classList.remove('hidden');
        _kMicMeterLoop();
    } catch (e) {
        console.error('[karaoke mic]', e);
        alert('Could not access the microphone: ' + e.message);
    }
}
function kMicStop() {
    kMicOn = false;
    cancelAnimationFrame(kMicMeterRaf);
    try { kMicStream?.getTracks().forEach(t => t.stop()); } catch (_) {}
    kMicStream = null;
    try { kMicGain?.disconnect(); kMicWet?.disconnect(); } catch (_) {}
    const btn = document.getElementById('karaoke-mic-btn');
    if (btn) { btn.classList.remove('k-mic-live'); btn.title = 'Turn on the microphone'; }
    document.getElementById('karaoke-mic-extras')?.classList.add('hidden');
    const meter = document.getElementById('karaoke-mic-meter-fill');
    if (meter) meter.style.width = '0%';
}
function kMicSetVolume(v) {
    kMicVolume = parseFloat(v);
    if (kMicGain) kMicGain.gain.value = kMicVolume;
}
function kMicToggleReverb() {
    kMicReverb = !kMicReverb;
    if (kMicWet) kMicWet.gain.value = kMicReverb ? 0.35 : 0;
    document.getElementById('karaoke-mic-reverb-btn')?.classList.toggle('k-on', kMicReverb);
}
function _kMicMeterLoop() {
    if (!kMicOn || !kMicAnalyser) return;
    const data = new Uint8Array(kMicAnalyser.frequencyBinCount);
    kMicAnalyser.getByteTimeDomainData(data);
    let peak = 0;
    for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i] - 128));
    const meter = document.getElementById('karaoke-mic-meter-fill');
    if (meter) {
        const pct = Math.min(100, (peak / 128) * 160);
        meter.style.width = pct + '%';
        meter.style.background = pct > 85 ? '#ef4444' : pct > 60 ? '#f59e0b' : '#34d399';
    }
    kMicMeterRaf = requestAnimationFrame(_kMicMeterLoop);
}

// ══════════════════════════════════════════════════════════════
// ── Vocal reduction — sing over the instrumental ──────────────
// Classic centre-channel cancellation (L − R): removes vocals mixed
// to the centre of a stereo track. Built lazily around the shared
// music <audio>; the passthrough path keeps normal playback identical.
// ══════════════════════════════════════════════════════════════
let kVocalCtx = null, kVocalDry = null, kVocalCancel = null, kVocalOn = false;

function kVocalToggle() {
    const audio = kGetAudio();
    if (!audio) return;
    try {
        if (!kVocalCtx) {
            kVocalCtx = new (window.AudioContext || window.webkitAudioContext)();
            const src = kVocalCtx.createMediaElementSource(audio);
            // Passthrough (default — identical to normal playback)
            kVocalDry = kVocalCtx.createGain(); kVocalDry.gain.value = 1;
            src.connect(kVocalDry); kVocalDry.connect(kVocalCtx.destination);
            // Centre-cancel: mono(L − R) to both ears
            const split = kVocalCtx.createChannelSplitter(2);
            const gL = kVocalCtx.createGain(); gL.gain.value = 0.9;
            const gR = kVocalCtx.createGain(); gR.gain.value = -0.9;
            const sum = kVocalCtx.createGain();
            const merge = kVocalCtx.createChannelMerger(2);
            src.connect(split);
            split.connect(gL, 0); split.connect(gR, 1);
            gL.connect(sum); gR.connect(sum);
            sum.connect(merge, 0, 0); sum.connect(merge, 0, 1);
            kVocalCancel = kVocalCtx.createGain(); kVocalCancel.gain.value = 0;
            merge.connect(kVocalCancel); kVocalCancel.connect(kVocalCtx.destination);
        }
        if (kVocalCtx.state === 'suspended') kVocalCtx.resume();
        kVocalOn = !kVocalOn;
        // Short crossfade so toggling doesn't click
        const t = kVocalCtx.currentTime;
        kVocalDry.gain.setTargetAtTime(kVocalOn ? 0 : 1, t, 0.05);
        kVocalCancel.gain.setTargetAtTime(kVocalOn ? 1 : 0, t, 0.05);
        document.getElementById('karaoke-novocals-btn')?.classList.toggle('k-on', kVocalOn);
    } catch (e) {
        console.error('[karaoke vocals]', e);
        alert('Vocal reduction unavailable for this track: ' + e.message);
    }
}

// ── Built-in player controls ──────────────────────────────────
function kGetAudio() { return document.getElementById('music-audio'); }

function kTogglePlay() {
    const audio = kGetAudio();
    if (!audio) return;
    // If nothing is loaded yet, load the selected track first
    if (kTrackIdx !== null && (!audio.src || audio.src === window.location.href)) {
        kLoadAudioTrack(kTrackIdx);
        return;
    }
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
}

function kLoadAudioTrack(idx) {
    const audio = kGetAudio();
    if (!audio || !musicLibrary[idx]) return;
    const { pathToFileURL } = require('url');
    audio.src = pathToFileURL(musicLibrary[idx].path).href;
    audio.load();
    audio.play().catch(() => {});
    // Keep musicIndex in sync so the Music tab stays consistent
    if (typeof musicIndex !== 'undefined') musicIndex = idx;
}

function kGetQueueIndices() {
    // Returns the ordered list of musicLibrary indices in the current queue
    const playlists = (typeof musicPlaylists !== 'undefined') ? musicPlaylists : [];
    if (kActivePl) {
        const pl = playlists.find(p => p.id === kActivePl);
        if (pl) return pl.trackPaths
            .map(tp => (musicLibrary||[]).findIndex(t => t.path === tp))
            .filter(i => i >= 0);
    }
    return (musicLibrary || []).map((_, i) => i);
}

function kPlayNext() {
    const queue = kGetQueueIndices();
    if (!queue.length) return;
    const pos = queue.indexOf(kTrackIdx ?? -1);
    const next = queue[(pos + 1) % queue.length];
    karaokeSelectTrack(next);
    kLoadAudioTrack(next);
}

function kPlayPrev() {
    const queue = kGetQueueIndices();
    if (!queue.length) return;
    const pos = queue.indexOf(kTrackIdx ?? 0);
    const prev = queue[(pos - 1 + queue.length) % queue.length];
    karaokeSelectTrack(prev);
    kLoadAudioTrack(prev);
}

function kSeek(e) {
    const audio = kGetAudio();
    if (!audio || !audio.duration) return;
    const wrap = document.getElementById('karaoke-seek-wrap');
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audio.currentTime = ratio * audio.duration;
}

function kSetVolume(val) {
    const audio = kGetAudio();
    if (audio) audio.volume = parseFloat(val);
}

function kSyncPlayerUI() {
    const audio = kGetAudio();
    if (!audio) return;

    // Play/pause icon
    const btn = document.getElementById('karaoke-play-btn');
    if (btn) {
        btn.innerHTML = audio.paused
            ? '<i class="fas fa-play text-sm"></i>'
            : '<i class="fas fa-pause text-sm"></i>';
    }

    // Seek bar + time
    const fill    = document.getElementById('karaoke-seek-fill');
    const timeEl  = document.getElementById('karaoke-time-display');
    const dur     = audio.duration || 0;
    const cur     = audio.currentTime || 0;
    if (fill && dur) fill.style.width = ((cur / dur) * 100) + '%';
    if (timeEl) timeEl.textContent = kFmtTime(cur) + ' / ' + kFmtTime(dur);
}

function kFmtTime(s) {
    if (!isFinite(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return m + ':' + String(sec).padStart(2, '0');
}

// ── LRC sync: hook into the shared audio element ──────────────
document.addEventListener('DOMContentLoaded', () => {
    const audio = document.getElementById('music-audio');
    if (!audio) return;

    // Sync play/pause button state
    audio.addEventListener('play',  kSyncPlayerUI);
    audio.addEventListener('pause', kSyncPlayerUI);
    audio.addEventListener('ended', () => {
        kSyncPlayerUI();
        // Auto-advance to next track
        kPlayNext();
    });

    audio.addEventListener('timeupdate', () => {
        kSyncPlayerUI();

        if (!kIsLRC || !kLines.length) return;
        const view = document.getElementById('view-karaoke');
        if (!view || !view.classList.contains('active')) return;

        const raw = audio.currentTime;
        const t   = raw + kTimingOffset;

        // Find the current line
        let best = 0;
        for (let i = 0; i < kLines.length; i++) {
            if (kLines[i].time <= t) best = i;
            else break;
        }
        if (best !== kCurrentLine) {
            kCurrentLine = best;
            karaokeUpdateDisplay();
        } else {
            // Same line — just update word highlights efficiently
            kUpdateWordHighlight(raw);
        }
    });

    // Keyboard shortcuts while karaoke tab is active
    document.addEventListener('keydown', (e) => {
        const view = document.getElementById('view-karaoke');
        if (!view || !view.classList.contains('active')) return;
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        if (e.key === 'ArrowDown' || e.key === ' ') { e.preventDefault(); kNextLine(); }
        if (e.key === 'ArrowUp')                    { e.preventDefault(); kPrevLine(); }
        if (e.key === 'p' || e.key === 'P')         { e.preventDefault(); kTogglePlay(); }
    });
});
