// ── Tuner ────────────────────────────────────────────────────

const TUNER_INSTRUMENTS = {
    guitar:   { label: 'Guitar',        strings: [{note:'E2',freq:82.41},{note:'A2',freq:110.00},{note:'D3',freq:146.83},{note:'G3',freq:196.00},{note:'B3',freq:246.94},{note:'E4',freq:329.63}] },
    violin:   { label: 'Violin',        strings: [{note:'G3',freq:196.00},{note:'D4',freq:293.66},{note:'A4',freq:440.00},{note:'E5',freq:659.25}] },
    viola:    { label: 'Viola',         strings: [{note:'C3',freq:130.81},{note:'G3',freq:196.00},{note:'D4',freq:293.66},{note:'A4',freq:440.00}] },
    cello:    { label: 'Cello',         strings: [{note:'C2',freq:65.41},{note:'G2',freq:98.00},{note:'D3',freq:146.83},{note:'A3',freq:220.00}] },
    bass:     { label: 'Bass Guitar',   strings: [{note:'E1',freq:41.20},{note:'A1',freq:55.00},{note:'D2',freq:73.42},{note:'G2',freq:98.00}] },
    ukulele:  { label: 'Ukulele',       strings: [{note:'G4',freq:392.00},{note:'C4',freq:261.63},{note:'E4',freq:329.63},{note:'A4',freq:440.00}] },
    mandolin: { label: 'Mandolin',      strings: [{note:'G3',freq:196.00},{note:'D4',freq:293.66},{note:'A4',freq:440.00},{note:'E5',freq:659.25}] },
    banjo:    { label: 'Banjo (5-str)', strings: [{note:'G4',freq:392.00},{note:'D3',freq:146.83},{note:'G3',freq:196.00},{note:'B3',freq:246.94},{note:'D4',freq:293.66}] },
    chromatic:{ label: 'Chromatic',     strings: [] },
};

const TUNER_NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

// Chord definitions: intervals relative to root (all mod 12)
const TUNER_CHORDS = [
    { suffix: '',      name: 'Major',            intervals: [0, 4, 7] },
    { suffix: 'm',     name: 'Minor',            intervals: [0, 3, 7] },
    { suffix: '7',     name: 'Dominant 7th',     intervals: [0, 4, 7, 10] },
    { suffix: 'maj7',  name: 'Major 7th',        intervals: [0, 4, 7, 11] },
    { suffix: 'm7',    name: 'Minor 7th',        intervals: [0, 3, 7, 10] },
    { suffix: 'dim',   name: 'Diminished',       intervals: [0, 3, 6] },
    { suffix: 'aug',   name: 'Augmented',        intervals: [0, 4, 8] },
    { suffix: 'sus2',  name: 'Suspended 2nd',    intervals: [0, 2, 7] },
    { suffix: 'sus4',  name: 'Suspended 4th',    intervals: [0, 5, 7] },
    { suffix: '5',     name: 'Power chord',      intervals: [0, 7] },
    { suffix: 'm7♭5',  name: 'Half Diminished',  intervals: [0, 3, 6, 10] },
    { suffix: 'dim7',  name: 'Diminished 7th',   intervals: [0, 3, 6, 9] },
    { suffix: '6',     name: 'Major 6th',        intervals: [0, 4, 7, 9] },
    { suffix: 'm6',    name: 'Minor 6th',        intervals: [0, 3, 7, 9] },
    { suffix: 'add9',  name: 'Add 9',            intervals: [0, 2, 4, 7] },
    { suffix: '9',     name: 'Dominant 9th',     intervals: [0, 2, 4, 7, 10] },
];

// ── State ────────────────────────────────────────────────────

let _tunerAudioCtx   = null;
let _tunerAnalyser   = null;
let _tunerStream     = null;
let _tunerRaf        = null;
let _tunerTimeBuf    = null;  // Float32Array for autocorrelation
let _tunerFreqBuf    = null;  // Float32Array for FFT
let _tunerActive       = false;
let _tunerMode         = 'strings'; // 'strings' | 'chords'
let _tunerInstrument   = 'guitar';
let _tunerHistory      = [];   // rolling freq detections (strings mode)
let _tunerSilence      = 0;    // consecutive silent frames
let _tunerTargetString = null; // { note, freq } – string locked for focused tuning

// ── Init ─────────────────────────────────────────────────────

function renderTuner() {
    _tunerUpdateStringButtons();
    setTimeout(() => _tunerDrawNeedle(0, false), 0);
}

function tunerSetMode(mode) {
    _tunerMode = mode;
    document.getElementById('tuner-pane-strings').style.display = mode === 'strings' ? '' : 'none';
    document.getElementById('tuner-pane-chords').style.display  = mode === 'chords'  ? '' : 'none';
    document.getElementById('tuner-tab-strings').classList.toggle('active', mode === 'strings');
    document.getElementById('tuner-tab-chords').classList.toggle('active',  mode === 'chords');
    // Reset display on mode switch
    _tunerHistory = [];
    _tunerSilence = 0;
    if (mode === 'strings') {
        setTimeout(() => _tunerDrawNeedle(0, false), 0);
        _tunerSetNote('--', '', '');
    } else {
        _tunerSetChord(null);
    }
}

// ── Pitch detection (ACF2+ algorithm) ────────────────────────

function _tunerFreqToNote(freq) {
    if (!freq || freq <= 0) return null;
    const semitones = 12 * Math.log2(freq / 440.0);
    const rounded   = Math.round(semitones);
    const cents     = (semitones - rounded) * 100;
    const midi      = rounded + 69;
    const octave    = Math.floor(midi / 12) - 1;
    const pc        = ((midi % 12) + 12) % 12;
    const noteName  = TUNER_NOTE_NAMES[pc];
    return { note: noteName, octave, cents, freq, pc };
}

function _tunerAutoCorrelate(buf, sampleRate) {
    var SIZE = buf.length;
    var rms = 0;
    for (let i = 0; i < SIZE; i++) rms += buf[i] * buf[i];
    rms = Math.sqrt(rms / SIZE);
    if (rms < 0.005) return -1;

    var r1 = 0, r2 = SIZE - 1, thres = 0.2;
    for (let i = 0; i < SIZE / 2; i++) { if (Math.abs(buf[i]) < thres) { r1 = i; break; } }
    for (let i = 1; i < SIZE / 2; i++) { if (Math.abs(buf[SIZE - i]) < thres) { r2 = SIZE - i; break; } }
    buf  = buf.slice(r1, r2 + 1);
    SIZE = buf.length;
    if (SIZE < 4) return -1;

    var minLag = Math.max(2, Math.floor(sampleRate / 1400));
    var maxLag = Math.min(SIZE - 1, Math.ceil(sampleRate / 40));
    var c      = new Float32Array(maxLag + 1);
    for (var lag = minLag; lag <= maxLag; lag++) {
        var s = 0, lim = SIZE - lag;
        for (var j = 0; j < lim; j++) s += buf[j] * buf[j + lag];
        c[lag] = s;
    }

    var d = minLag;
    while (d < maxLag && c[d] > c[d + 1]) d++;

    var maxval = -1, maxpos = -1;
    for (let i = d; i <= maxLag; i++) {
        if (c[i] > maxval) { maxval = c[i]; maxpos = i; }
    }
    if (maxpos < 2) return -1;

    var x1 = c[maxpos - 1], x2 = c[maxpos];
    var x3  = maxpos < maxLag ? c[maxpos + 1] : x2;
    var a   = (x1 + x3 - 2 * x2) / 2;
    var b   = (x3 - x1) / 2;
    var T0  = a ? maxpos - b / (2 * a) : maxpos;
    if (T0 < 1) return -1;
    return sampleRate / T0;
}

function _tunerMedian(arr) {
    var s = arr.slice().sort(function(a, b) { return a - b; });
    var m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// ── Target string (focused tuning) ───────────────────────────

// Toggle focus on a string; clicking the same string again deselects
function tunerSelectString(note, freq) {
    if (_tunerTargetString && _tunerTargetString.note === note) {
        _tunerTargetString = null;
    } else {
        _tunerTargetString = { note, freq };
    }
    _tunerApplyStringSelected();
}

// Sync the .tsv-selected class to the current target
function _tunerApplyStringSelected() {
    document.querySelectorAll('.tsv-col').forEach(col => {
        col.classList.toggle('tsv-selected', !!(
            _tunerTargetString && col.dataset.note === _tunerTargetString.note
        ));
    });
}

// Cents from freq relative to target, octave-normalised to [-50, +50]
function _tunerCentsFromTarget(freq, targetFreq) {
    let ratio = freq / targetFreq;
    while (ratio < 0.707) ratio *= 2;
    while (ratio > 1.414) ratio /= 2;
    return 1200 * Math.log2(ratio);
}

// ── Chord detection (FFT peaks + harmonic suppression) ────────

function _tunerDetectChord() {
    if (!_tunerAnalyser || !_tunerFreqBuf) return null;
    _tunerAnalyser.getFloatFrequencyData(_tunerFreqBuf);

    const sr     = _tunerAudioCtx.sampleRate;
    const fftN   = _tunerAnalyser.fftSize;
    const binHz  = sr / fftN;
    const data   = _tunerFreqBuf;

    // Overall signal check: loudest bin in musical range
    const minBin = Math.max(1, Math.floor(60 / binHz));
    const maxBin = Math.min(data.length - 2, Math.floor(1400 / binHz));
    let peak = -Infinity;
    for (let i = minBin; i <= maxBin; i++) { if (data[i] > peak) peak = data[i]; }
    if (peak < -60) return null; // near silence

    // Find local spectral peaks
    const threshold = peak - 28; // within 28 dB of loudest
    const raw = [];
    for (let i = minBin + 1; i < maxBin; i++) {
        if (data[i] > data[i - 1] && data[i] > data[i + 1] && data[i] > threshold) {
            // Parabolic interpolation for sub-bin frequency
            const a = data[i - 1], b = data[i], c = data[i + 1];
            const denom = 2 * (2 * b - a - c);
            const offset = denom !== 0 ? (c - a) / denom : 0;
            raw.push({ freq: (i + offset) * binHz, db: data[i] });
        }
    }
    if (raw.length === 0) return null;

    // Sort low→high; suppress harmonics
    raw.sort((a, b) => a.freq - b.freq);
    const fund = [];
    for (const p of raw) {
        let harmonic = false;
        for (const f of fund) {
            for (let n = 2; n <= 6; n++) {
                if (Math.abs(p.freq - n * f.freq) / f.freq < 0.04) { harmonic = true; break; }
            }
            if (harmonic) break;
        }
        if (!harmonic) fund.push(p);
        if (fund.length >= 8) break;
    }

    if (fund.length < 2) return null;

    // Convert to pitch classes
    const pcSet = new Set();
    const noteList = [];
    fund.sort((a, b) => b.db - a.db); // strongest first
    for (const p of fund.slice(0, 6)) {
        const det = _tunerFreqToNote(p.freq);
        if (det && !pcSet.has(det.pc)) {
            pcSet.add(det.pc);
            noteList.push(det.note);
        }
    }
    if (pcSet.size < 2) return null;

    return _tunerMatchChord([...pcSet], noteList);
}

function _tunerMatchChord(pcs, noteList) {
    const detected = new Set(pcs);
    let best = null, bestScore = -1;

    for (const chord of TUNER_CHORDS) {
        for (let root = 0; root < 12; root++) {
            const chordPcs = chord.intervals.map(i => (root + i) % 12);
            let matched = 0;
            for (const pc of chordPcs) { if (detected.has(pc)) matched++; }
            const score = matched / chordPcs.length;
            // Prefer higher score; break ties by preferring larger chord (more specific)
            if (score > bestScore || (score === bestScore && chordPcs.length > (best ? best.chord.intervals.length : 0))) {
                bestScore = score;
                best = { root, chord, score };
            }
        }
    }

    if (!best || bestScore < 0.8) return null;
    return { root: best.root, chord: best.chord, score: bestScore, notes: noteList };
}

// ── Mic control ──────────────────────────────────────────────

async function tunerToggle() {
    if (_tunerActive) { tunerStop(); return; }
    try {
        _tunerStream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
        });
        _tunerAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (_tunerAudioCtx.state === 'suspended') await _tunerAudioCtx.resume();

        _tunerAnalyser         = _tunerAudioCtx.createAnalyser();
        _tunerAnalyser.fftSize = 4096;
        _tunerAudioCtx.createMediaStreamSource(_tunerStream).connect(_tunerAnalyser);

        _tunerTimeBuf = new Float32Array(_tunerAnalyser.fftSize);
        _tunerFreqBuf = new Float32Array(_tunerAnalyser.frequencyBinCount);
        _tunerHistory = [];
        _tunerSilence = 0;
        _tunerActive  = true;
        _tunerSetBtnState(true);
        _tunerLoop();
    } catch (e) {
        _tunerSetNote('Mic error', '', '');
        console.error('[tuner]', e);
    }
}

function tunerStop() {
    _tunerActive       = false;
    _tunerHistory      = [];
    _tunerSilence      = 0;
    _tunerTargetString = null;
    if (_tunerRaf)      { cancelAnimationFrame(_tunerRaf); _tunerRaf = null; }
    if (_tunerStream)   { _tunerStream.getTracks().forEach(t => t.stop()); _tunerStream = null; }
    if (_tunerAudioCtx) { _tunerAudioCtx.close(); _tunerAudioCtx = null; }
    _tunerSetBtnState(false);
    _tunerDrawNeedle(0, false);
    _tunerSetNote('--', '', '');
    _tunerSetChord(null);
    _tunerHighlightString(null);
}

// ── Main loop ────────────────────────────────────────────────

function _tunerLoop() {
    if (!_tunerActive) return;
    if (_tunerMode === 'strings') _tunerLoopStrings();
    else                          _tunerLoopChords();
    _tunerRaf = requestAnimationFrame(_tunerLoop);
}

function _tunerLoopStrings() {
    _tunerAnalyser.getFloatTimeDomainData(_tunerTimeBuf);
    const raw = _tunerAutoCorrelate(_tunerTimeBuf, _tunerAudioCtx.sampleRate);

    if (raw > 0) {
        _tunerSilence = 0;
        _tunerHistory.push(raw);
        if (_tunerHistory.length > 7) _tunerHistory.shift();

        const freq = _tunerMedian(_tunerHistory);
        const det  = _tunerFreqToNote(freq);
        if (det) {
            _tunerSetNote(det.note, det.octave, freq.toFixed(1));
            if (_tunerTargetString) {
                // Show cents relative to the locked string, not the nearest chromatic note
                const c = _tunerCentsFromTarget(freq, _tunerTargetString.freq);
                _tunerDrawNeedle(Math.max(-1, Math.min(1, c / 50)), true);
                _tunerHighlightString(_tunerTargetString.note, c);
            } else {
                _tunerDrawNeedle(det.cents / 50, true);
                _tunerHighlightString(det.note + det.octave, det.cents);
            }
        }
    } else {
        _tunerSilence++;
        if (_tunerSilence > 24) {
            _tunerHistory = [];
            _tunerSilence = 0;
            _tunerDrawNeedle(0, false);
            _tunerSetNote('--', '', '');
            _tunerHighlightString(null);
        }
    }
}

function _tunerLoopChords() {
    const result = _tunerDetectChord();
    if (result) {
        _tunerSilence = 0;
        _tunerSetChord(result);
    } else {
        _tunerSilence++;
        if (_tunerSilence > 30) {
            _tunerSilence = 0;
            _tunerSetChord(null);
        }
    }
}

// ── Canvas gauge (strings mode) ──────────────────────────────

function _tunerDrawNeedle(val, active) {
    const canvas = document.getElementById('tuner-canvas');
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const W   = canvas.clientWidth  || 380;
    const H   = canvas.clientHeight || 180;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
        canvas.width  = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const cx     = W / 2;
    const cy     = H + 10;
    const R      = Math.min(W * 0.48, H * 1.3);
    const centre = 3 * Math.PI / 2;
    const half   = (65 / 180) * Math.PI;
    const aStart = centre - half;
    const aEnd   = centre + half;

    // Track
    ctx.beginPath();
    ctx.arc(cx, cy, R, aStart, aEnd);
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth   = 14;
    ctx.lineCap     = 'butt';
    ctx.stroke();

    if (active) {
        const segs = [
            { from: aStart,               to: centre - half * 0.2, color: '#1d4ed8' },
            { from: centre - half * 0.2,  to: centre + half * 0.2, color: Math.abs(val) <= 0.2 ? '#22c55e' : '#166534' },
            { from: centre + half * 0.2,  to: aEnd,                color: '#991b1b' },
        ];
        for (const s of segs) {
            ctx.beginPath();
            ctx.arc(cx, cy, R, s.from, s.to);
            ctx.strokeStyle = s.color;
            ctx.lineWidth   = 14;
            ctx.lineCap     = 'butt';
            ctx.stroke();
        }
    }

    // Tick marks + labels
    for (let c = -50; c <= 50; c += 10) {
        const angle = aStart + (c + 50) / 100 * half * 2;
        const major = c % 20 === 0;
        const inner = R - 10, outer = R - 10 + (major ? 20 : 12);
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
        ctx.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer);
        ctx.strokeStyle = major ? '#64748b' : '#334155';
        ctx.lineWidth   = major ? 2 : 1;
        ctx.stroke();
        if (major && c !== 0) {
            ctx.font = `bold ${Math.round(W * 0.026)}px sans-serif`;
            ctx.fillStyle = '#475569'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(c > 0 ? '+' + c : String(c), cx + Math.cos(angle) * (outer + 10), cy + Math.sin(angle) * (outer + 10));
        }
    }
    ctx.font = `bold ${Math.round(W * 0.028)}px sans-serif`;
    ctx.fillStyle = active && Math.abs(val) <= 0.1 ? '#22c55e' : '#64748b';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('0', cx + Math.cos(centre) * (R - 10 + 28), cy + Math.sin(centre) * (R - 10 + 28));

    if (!active) return;

    const angle     = aStart + (val + 1) / 2 * half * 2;
    const inTune    = Math.abs(val) <= 0.1;
    const needleClr = inTune ? '#22c55e' : (val < 0 ? '#60a5fa' : '#f87171');
    ctx.shadowColor = needleClr + '88'; ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(angle) * R * 0.82, cy + Math.sin(angle) * R * 0.82);
    ctx.strokeStyle = needleClr; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.beginPath(); ctx.arc(cx, cy, 7, 0, Math.PI * 2); ctx.fillStyle = '#94a3b8'; ctx.fill();
}

// ── UI helpers ───────────────────────────────────────────────

function _tunerSetNote(note, octave, freq) {
    const en = document.getElementById('tuner-note');
    const eo = document.getElementById('tuner-octave');
    const ef = document.getElementById('tuner-freq');
    if (en) en.textContent = note;
    if (eo) eo.textContent = (octave !== '' && octave != null) ? octave : '';
    if (ef) ef.textContent = freq ? freq + ' Hz' : '';
}

function _tunerSetChord(result) {
    const nameEl    = document.getElementById('tuner-chord-name');
    const qualityEl = document.getElementById('tuner-chord-quality');
    const notesEl   = document.getElementById('tuner-chord-notes');
    const allEl     = document.getElementById('tuner-chord-all-notes');

    if (!result) {
        if (nameEl)    nameEl.textContent    = '--';
        if (qualityEl) qualityEl.textContent = '';
        if (notesEl)   notesEl.innerHTML     = '<span class="text-slate-600 text-xs italic self-center">Play a chord…</span>';
        if (allEl)     allEl.innerHTML       = '';
        return;
    }

    const rootName = TUNER_NOTE_NAMES[result.root];
    if (nameEl)    nameEl.textContent    = rootName + result.chord.suffix;
    if (qualityEl) qualityEl.textContent = rootName + ' ' + result.chord.name;

    // Chord tones (intervals of this chord from root)
    if (notesEl) {
        const chordNotes = result.chord.intervals.map(i => TUNER_NOTE_NAMES[(result.root + i) % 12]);
        notesEl.innerHTML = chordNotes.map(n =>
            `<span class="inline-flex items-center justify-center rounded-lg text-xs font-bold px-3 py-1.5"
                   style="background:rgba(244,63,94,.15);border:1px solid rgba(244,63,94,.35);color:#fda4af">${n}</span>`
        ).join('');
    }

    // All detected notes
    if (allEl) {
        allEl.innerHTML = (result.notes || []).map(n =>
            `<span class="inline-flex items-center justify-center rounded-lg text-xs font-semibold px-2.5 py-1"
                   style="background:#1e293b;border:1px solid #334155;color:#94a3b8">${n}</span>`
        ).join('');
    }
}

function _tunerSetBtnState(on) {
    const btn = document.getElementById('tuner-toggle-btn');
    if (!btn) return;
    btn.innerHTML        = on ? '<i class="fas fa-stop mr-2 text-xs"></i>Stop' : '<i class="fas fa-microphone mr-2 text-xs"></i>Start Tuner';
    btn.style.background = on ? '#475569' : '#dc2626';
    btn.style.boxShadow  = on ? '' : '0 4px 18px rgba(220,38,38,.25)';
}

// cents is optional — used for colour-coding the active string
function _tunerHighlightString(noteOctave, cents) {
    document.querySelectorAll('.tsv-col').forEach(col => {
        col.classList.remove('tsv-in-tune', 'tsv-close', 'tsv-far');
        if (noteOctave && col.dataset.note === noteOctave) {
            const abs = Math.abs(cents || 0);
            if (abs <= 10)      col.classList.add('tsv-in-tune');
            else if (abs <= 25) col.classList.add('tsv-close');
            else                col.classList.add('tsv-far');
        }
    });
}

function tunerSetInstrument(inst) {
    _tunerInstrument   = inst;
    _tunerTargetString = null;
    _tunerUpdateStringButtons();
}

function _tunerUpdateStringButtons() {
    const container = document.getElementById('tuner-strings');
    if (!container) return;
    const inst = TUNER_INSTRUMENTS[_tunerInstrument];
    if (!inst || !inst.strings.length) {
        container.innerHTML = '<p class="text-slate-600 text-xs italic">Detects any note automatically</p>';
        return;
    }

    const freqs = inst.strings.map(s => s.freq);
    const fmin  = Math.min(...freqs), fmax = Math.max(...freqs);

    const cols = inst.strings.map(s => {
        // Lower frequency → thicker wire (4 px → 1.5 px)
        const t     = fmax > fmin ? (s.freq - fmin) / (fmax - fmin) : 0.5;
        const thick = (4.0 - t * 2.5).toFixed(1);
        const m     = s.note.match(/^([A-G]#?)(\d)$/);
        const name  = m ? m[1] : s.note;
        const oct   = m ? m[2] : '';
        return `<div class="tsv-col" data-note="${s.note}"
                     title="Tap to focus on ${s.note} · ${s.freq.toFixed(1)} Hz"
                     onclick="tunerSelectString('${s.note}', ${s.freq})">
            <div class="tsv-peg"></div>
            <div class="tsv-wire" style="width:${thick}px"></div>
            <div class="tsv-label">
                <span class="tsv-note-name">${name}</span>
                <span class="tsv-note-oct">${oct}</span>
            </div>
        </div>`;
    }).join('');

    container.innerHTML = `<div class="tsv-body">${cols}</div>`;
    _tunerApplyStringSelected(); // restore selection after DOM rebuild
}
