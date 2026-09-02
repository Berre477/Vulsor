// ── Chess Piece SVG Images ─────────────────────────────────────
// Professional Staunton-style pieces (similar to chess.com classic).
// Each piece is a data URI so no external files are needed.

const CHESS_PIECE_IMGS = (() => {
    function mkSvg(body) {
        const s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 45 45">${body}</svg>`;
        return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(s)));
    }

    // ── Color palettes ────────────────────────────────────────────
    const WF = '#fffff0';   // white fill (cream)
    const WS = '#2b1d0e';   // white stroke (dark walnut)
    const BF = '#232320';   // black fill (near-black)
    const BS = '#e8e8d8';   // black highlights (light cream)

    // ── PAWN ──────────────────────────────────────────────────────
    function pawn(f, s) { return mkSvg(`
        <circle cx="22.5" cy="10.5" r="5.5" fill="${f}" stroke="${s}" stroke-width="1.5"/>
        <path d="M17.5,21 C15,28 13,33 11.5,37 H33.5 C32,33 30,28 27.5,21 Z"
              fill="${f}" stroke="${s}" stroke-width="1.5" stroke-linejoin="round"/>
        <rect x="9.5" y="37" width="26" height="4.5" rx="1.5"
              fill="${f}" stroke="${s}" stroke-width="1.5"/>`);
    }

    // ── ROOK ──────────────────────────────────────────────────────
    function rook(f, s) { return mkSvg(`
        <rect x="9.5" y="37" width="26" height="4.5" rx="1.5"
              fill="${f}" stroke="${s}" stroke-width="1.5"/>
        <path d="M12,36.5 V22 H33 V36.5 Z"
              fill="${f}" stroke="${s}" stroke-width="1.5"/>
        <path d="M9.5,9 h7 v5.5 h4 v-5.5 h6 v5.5 h4 v-5.5 h7 v13 H9.5 Z"
              fill="${f}" stroke="${s}" stroke-width="1.5" stroke-linejoin="round"/>
        <line x1="12" y1="22" x2="33" y2="22" stroke="${s}" stroke-width="1"/>
        <line x1="12" y1="14.5" x2="33" y2="14.5" stroke="${s}" stroke-width="1"/>`);
    }

    // ── KNIGHT ────────────────────────────────────────────────────
    function knight(f, s, eye) { return mkSvg(`
        <rect x="9.5" y="37" width="26" height="4.5" rx="1.5"
              fill="${f}" stroke="${s}" stroke-width="1.5"/>
        <path d="M12.5,36.5 H33 V32 C33,32 37,27 35,22
                 C37,18 37,12 34.5,9.5
                 C32,7 27.5,7 25,9
                 L24,8 C22,6.5 18.5,7.5 16,9.5
                 C13,12 14,18 16.5,20
                 C13,22.5 12,28 12.5,32 Z"
              fill="${f}" stroke="${s}" stroke-width="1.5" stroke-linejoin="round"/>
        <circle cx="31" cy="12" r="2" fill="${eye}" stroke="none"/>
        <line x1="25" y1="9" x2="26.5" y2="13.5"
              stroke="${s}" stroke-width="1" stroke-linecap="round"/>`);
    }

    // ── BISHOP ────────────────────────────────────────────────────
    function bishop(f, s) { return mkSvg(`
        <rect x="9.5" y="37" width="26" height="4.5" rx="1.5"
              fill="${f}" stroke="${s}" stroke-width="1.5"/>
        <rect x="13.5" y="32" width="18" height="5" rx="1"
              fill="${f}" stroke="${s}" stroke-width="1.5"/>
        <path d="M15,32 C15,24 18.5,19 22.5,13.5 C26.5,19 30,24 30,32 Z"
              fill="${f}" stroke="${s}" stroke-width="1.5" stroke-linejoin="round"/>
        <circle cx="22.5" cy="8.5" r="5" fill="${f}" stroke="${s}" stroke-width="1.5"/>
        <path d="M20,8.5 L25,8.5" stroke="${s}" stroke-width="1.5" stroke-linecap="round"/>
        <circle cx="22.5" cy="3.5" r="1.5" fill="${f}" stroke="${s}" stroke-width="1"/>`);
    }

    // ── QUEEN ─────────────────────────────────────────────────────
    function queen(f, s) { return mkSvg(`
        <rect x="9.5" y="37" width="26" height="4.5" rx="1.5"
              fill="${f}" stroke="${s}" stroke-width="1.5"/>
        <circle cx="6"   cy="13.5" r="2.5" fill="${f}" stroke="${s}" stroke-width="1.5"/>
        <circle cx="14"  cy="10"   r="2.5" fill="${f}" stroke="${s}" stroke-width="1.5"/>
        <circle cx="22.5" cy="8.5" r="2.5" fill="${f}" stroke="${s}" stroke-width="1.5"/>
        <circle cx="31"  cy="10"   r="2.5" fill="${f}" stroke="${s}" stroke-width="1.5"/>
        <circle cx="39"  cy="13.5" r="2.5" fill="${f}" stroke="${s}" stroke-width="1.5"/>
        <path d="M9.5,27 C17,25 28,25 35.5,27
                 L38.5,13.5 L30.5,24 L22.5,8.5 L14.5,24 L6.5,13.5 Z"
              fill="${f}" stroke="${s}" stroke-width="1.5" stroke-linejoin="round"/>
        <path d="M9.5,27 C9.5,30 12,31.5 14.5,32 H30.5
                 C33,31.5 35.5,30 35.5,27 V37 H9.5 Z"
              fill="${f}" stroke="${s}" stroke-width="1.5" stroke-linejoin="round"/>
        <line x1="9.5" y1="37" x2="35.5" y2="37" stroke="${s}" stroke-width="1"/>`);
    }

    // ── KING ──────────────────────────────────────────────────────
    function king(f, s) { return mkSvg(`
        <rect x="9.5" y="37" width="26" height="4.5" rx="1.5"
              fill="${f}" stroke="${s}" stroke-width="1.5"/>
        <path d="M11.5,36.5 C17,40.5 28,40.5 33.5,36.5 V30
                 C33.5,30 41,25.5 38,19.5
                 C34,13 25,16 22.5,23.5 V27
                 M22.5,23.5 C20,16 11,13 7,19.5
                 C4,25.5 11.5,30 11.5,30 Z"
              fill="${f}" stroke="${s}" stroke-width="1.5" stroke-linejoin="round"/>
        <path d="M22.5,26 C22.5,26 27,18 25.5,15
                 C25.5,15 24.5,12.5 22.5,12.5
                 C20.5,12.5 19.5,15 19.5,15
                 C18,18 22.5,26 22.5,26 Z"
              fill="${f}" stroke="${s}" stroke-width="1.5" stroke-linejoin="round"/>
        <line x1="22.5" y1="6"   x2="22.5" y2="12" stroke="${s}" stroke-width="2.5" stroke-linecap="round"/>
        <line x1="19.5" y1="8.5" x2="25.5" y2="8.5" stroke="${s}" stroke-width="2.5" stroke-linecap="round"/>`);
    }

    return {
        P: pawn(WF,WS),    p: pawn(BF,BS),
        R: rook(WF,WS),    r: rook(BF,BS),
        N: knight(WF,WS,WS), n: knight(BF,BS,BS),
        B: bishop(WF,WS),  b: bishop(BF,BS),
        Q: queen(WF,WS),   q: queen(BF,BS),
        K: king(WF,WS),    k: king(BF,BS),
    };
})();
