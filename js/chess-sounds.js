// ── Chess Sound Effects ────────────────────────────────────────
// All sounds synthesized via Web Audio API — no external files needed.
// Inspired by chess.com's wooden-board sound design.

const ChessSounds = (() => {
    let _ctx = null;

    function _ac() {
        if (!_ctx) {
            try { _ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) {}
        }
        // Resume if suspended (browser autoplay policy)
        if (_ctx && _ctx.state === 'suspended') _ctx.resume();
        return _ctx;
    }

    // ── Primitive builders ────────────────────────────────────────

    // Short burst of filtered noise (wood thud)
    function _woodThud(vol, freq, decay, start) {
        const ctx = _ac(); if (!ctx) return;
        const t = ctx.currentTime + (start || 0);
        const buf = ctx.createBuffer(1, ctx.sampleRate * 0.15, ctx.sampleRate);
        const d   = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const filt = ctx.createBiquadFilter();
        filt.type = 'bandpass';
        filt.frequency.value = freq;
        filt.Q.value = 1.2;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(vol, t);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + decay);
        src.connect(filt); filt.connect(gain); gain.connect(ctx.destination);
        src.start(t); src.stop(t + decay);
    }

    // Short sine tone (ding)
    function _tone(freq, vol, attack, hold, release, start) {
        const ctx = _ac(); if (!ctx) return;
        const t = ctx.currentTime + (start || 0);
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(vol, t + attack);
        gain.gain.setValueAtTime(vol, t + attack + hold);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(t); osc.stop(t + attack + hold + release + 0.05);
    }

    // ── Public sounds ─────────────────────────────────────────────

    function move() {
        // Light wooden click — a quiet thud
        _woodThud(0.55, 420, 0.12);
    }

    function capture() {
        // Heavier impact — louder, lower freq, two layers
        _woodThud(0.75, 260, 0.18);
        _woodThud(0.45, 520, 0.10, 0.02);
    }

    function castle() {
        // Two wooden clicks in quick succession
        _woodThud(0.55, 420, 0.12, 0);
        _woodThud(0.55, 380, 0.12, 0.12);
    }

    function check() {
        // Two-note alert: higher pitched, distinctive
        _woodThud(0.4, 420, 0.10, 0);
        _tone(880, 0.25, 0.01, 0.05, 0.15, 0);
        _tone(1100, 0.2, 0.01, 0.04, 0.18, 0.12);
    }

    function promote() {
        // Ascending three-note chime
        _tone(660, 0.22, 0.01, 0.05, 0.2, 0);
        _tone(880, 0.22, 0.01, 0.05, 0.2, 0.12);
        _tone(1100, 0.22, 0.01, 0.08, 0.3, 0.24);
    }

    function gameStart() {
        // Clean upward chime — friendly, welcoming
        _tone(523, 0.18, 0.01, 0.06, 0.25, 0);       // C5
        _tone(659, 0.18, 0.01, 0.06, 0.25, 0.1);      // E5
        _tone(784, 0.20, 0.01, 0.08, 0.35, 0.2);      // G5
    }

    function gameWin() {
        // Victory fanfare — bright ascending arpeggio
        _tone(523, 0.20, 0.01, 0.08, 0.2, 0);         // C5
        _tone(659, 0.20, 0.01, 0.08, 0.2, 0.12);      // E5
        _tone(784, 0.20, 0.01, 0.08, 0.2, 0.24);      // G5
        _tone(1047, 0.22, 0.01, 0.15, 0.4, 0.36);     // C6
    }

    function gameLose() {
        // Descending sad motif
        _tone(523, 0.18, 0.01, 0.1, 0.3, 0);          // C5
        _tone(466, 0.18, 0.01, 0.1, 0.3, 0.15);       // Bb4
        _tone(415, 0.18, 0.01, 0.1, 0.3, 0.30);       // Ab4
        _tone(349, 0.18, 0.01, 0.18, 0.5, 0.46);      // F4
    }

    function gameDraw() {
        // Neutral two-note
        _tone(523, 0.18, 0.01, 0.08, 0.3, 0);
        _tone(523, 0.15, 0.01, 0.08, 0.3, 0.18);
    }

    function illegal() {
        // Quick error buzz
        const ctx = _ac(); if (!ctx) return;
        const t = ctx.currentTime;
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(180, t);
        osc.frequency.exponentialRampToValueAtTime(80, t + 0.12);
        gain.gain.setValueAtTime(0.18, t);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(t); osc.stop(t + 0.15);
    }

    function lowTime() {
        // Single sharp click for low-time warning
        _tone(880, 0.15, 0.005, 0.02, 0.08, 0);
        _woodThud(0.3, 600, 0.07, 0);
    }

    // Warm up AudioContext on first user interaction (autoplay policy)
    document.addEventListener('click', () => _ac(), { once: true });

    return { move, capture, castle, check, promote, gameStart, gameWin, gameLose, gameDraw, illegal, lowTime };
})();
