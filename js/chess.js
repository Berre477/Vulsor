// ── Chess — full rules engine, 6-level bot, board UI, puzzles, learn ──
// No external deps. Board uses Unicode chess pieces.

// ====================================================================
// ENGINE — board state, move generation, legality, check / mate
// ====================================================================
// Internal board: array of 64. Index 0 = a8 (top-left when White at bottom),
// index 63 = h1. Piece codes: lowercase = black, uppercase = white.
// p n b r q k = pawn knight bishop rook queen king. Empty = '.'.

const CHESS_INITIAL = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function chessParseFEN(fen) {
    const [pos, turn, castle, ep, half, full] = fen.split(' ');
    const board = new Array(64).fill('.');
    let i = 0;
    for (const ch of pos) {
        if (ch === '/') continue;
        if (/\d/.test(ch)) i += parseInt(ch, 10);
        else board[i++] = ch;
    }
    return {
        board,
        turn,                       // 'w' | 'b'
        castle: castle === '-' ? '' : castle,
        ep: ep === '-' ? null : _algToIdx(ep),
        halfmove: parseInt(half || '0', 10),
        fullmove: parseInt(full || '1', 10),
    };
}
function chessToFEN(s) {
    let pos = '';
    for (let r = 0; r < 8; r++) {
        let empty = 0;
        for (let f = 0; f < 8; f++) {
            const p = s.board[r * 8 + f];
            if (p === '.') { empty++; continue; }
            if (empty) { pos += empty; empty = 0; }
            pos += p;
        }
        if (empty) pos += empty;
        if (r < 7) pos += '/';
    }
    const ep = s.ep == null ? '-' : _idxToAlg(s.ep);
    return `${pos} ${s.turn} ${s.castle || '-'} ${ep} ${s.halfmove} ${s.fullmove}`;
}

function _algToIdx(a) {
    const file = a.charCodeAt(0) - 97;
    const rank = parseInt(a[1], 10);
    return (8 - rank) * 8 + file;
}
function _idxToAlg(i) {
    const file = i % 8, rank = 8 - Math.floor(i / 8);
    return String.fromCharCode(97 + file) + rank;
}
function _isWhite(p) { return p !== '.' && p === p.toUpperCase(); }
function _isBlack(p) { return p !== '.' && p === p.toLowerCase(); }
function _sameSide(a, b) { return a !== '.' && b !== '.' && _isWhite(a) === _isWhite(b); }

// Generate pseudo-legal moves (may leave king in check). Then filter.
function chessGenerateMoves(s, sideOverride) {
    const side = sideOverride || s.turn;
    const isWhite = side === 'w';
    const moves = [];
    for (let i = 0; i < 64; i++) {
        const p = s.board[i];
        if (p === '.') continue;
        if (isWhite !== _isWhite(p)) continue;
        const pt = p.toLowerCase();
        if (pt === 'p') _genPawn(s, i, isWhite, moves);
        else if (pt === 'n') _genStep(s, i, isWhite, KNIGHT_DELTAS, moves, false);
        else if (pt === 'b') _genSlide(s, i, isWhite, BISHOP_DIRS, moves);
        else if (pt === 'r') _genSlide(s, i, isWhite, ROOK_DIRS, moves);
        else if (pt === 'q') _genSlide(s, i, isWhite, QUEEN_DIRS, moves);
        else if (pt === 'k') _genKing(s, i, isWhite, moves);
    }
    return moves;
}

const KNIGHT_DELTAS = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
const BISHOP_DIRS = [[-1,-1],[-1,1],[1,-1],[1,1]];
const ROOK_DIRS   = [[-1,0],[1,0],[0,-1],[0,1]];
const QUEEN_DIRS  = BISHOP_DIRS.concat(ROOK_DIRS);
const KING_DELTAS = QUEEN_DIRS;

function _ij(i) { return [Math.floor(i/8), i%8]; }
function _ri(r, c) { return r * 8 + c; }
function _inB(r, c) { return r >= 0 && r < 8 && c >= 0 && c < 8; }

function _genPawn(s, i, white, moves) {
    const [r, c] = _ij(i);
    const dir = white ? -1 : 1;
    const startRank = white ? 6 : 1;
    const promoteRank = white ? 0 : 7;
    // 1 square fwd
    if (_inB(r + dir, c) && s.board[_ri(r + dir, c)] === '.') {
        if (r + dir === promoteRank) {
            for (const pr of ['q','r','b','n']) moves.push({ from:i, to:_ri(r+dir,c), promote:pr });
        } else {
            moves.push({ from:i, to:_ri(r+dir,c) });
            // 2 squares from start
            if (r === startRank && s.board[_ri(r + 2*dir, c)] === '.') {
                moves.push({ from:i, to:_ri(r+2*dir,c), pawnDouble:true });
            }
        }
    }
    // Captures
    for (const dc of [-1, 1]) {
        const nr = r + dir, nc = c + dc;
        if (!_inB(nr, nc)) continue;
        const t = _ri(nr, nc);
        const tgt = s.board[t];
        if (tgt !== '.' && _isWhite(tgt) !== white) {
            if (nr === promoteRank) {
                for (const pr of ['q','r','b','n']) moves.push({ from:i, to:t, promote:pr, capture:true });
            } else {
                moves.push({ from:i, to:t, capture:true });
            }
        }
        // En passant
        if (s.ep != null && t === s.ep) {
            moves.push({ from:i, to:t, enPassant:true, capture:true });
        }
    }
}

function _genStep(s, i, white, deltas, moves) {
    const [r, c] = _ij(i);
    for (const [dr, dc] of deltas) {
        const nr = r + dr, nc = c + dc;
        if (!_inB(nr, nc)) continue;
        const t = _ri(nr, nc);
        const tgt = s.board[t];
        if (tgt === '.') moves.push({ from:i, to:t });
        else if (_isWhite(tgt) !== white) moves.push({ from:i, to:t, capture:true });
    }
}

function _genSlide(s, i, white, dirs, moves) {
    const [r, c] = _ij(i);
    for (const [dr, dc] of dirs) {
        let nr = r + dr, nc = c + dc;
        while (_inB(nr, nc)) {
            const t = _ri(nr, nc);
            const tgt = s.board[t];
            if (tgt === '.') moves.push({ from:i, to:t });
            else {
                if (_isWhite(tgt) !== white) moves.push({ from:i, to:t, capture:true });
                break;
            }
            nr += dr; nc += dc;
        }
    }
}

function _genKing(s, i, white, moves) {
    _genStep(s, i, white, KING_DELTAS, moves);
    // Castling
    const rights = s.castle || '';
    const homeR = white ? 7 : 0;
    if (i !== _ri(homeR, 4)) return;
    if (chessIsAttacked(s, i, !white)) return;
    const kingSide = white ? 'K' : 'k';
    const queenSide = white ? 'Q' : 'q';
    // King side
    if (rights.includes(kingSide)
        && s.board[_ri(homeR, 5)] === '.'
        && s.board[_ri(homeR, 6)] === '.'
        && !chessIsAttacked(s, _ri(homeR, 5), !white)
        && !chessIsAttacked(s, _ri(homeR, 6), !white)) {
        moves.push({ from:i, to:_ri(homeR, 6), castle:'K' });
    }
    if (rights.includes(queenSide)
        && s.board[_ri(homeR, 1)] === '.'
        && s.board[_ri(homeR, 2)] === '.'
        && s.board[_ri(homeR, 3)] === '.'
        && !chessIsAttacked(s, _ri(homeR, 2), !white)
        && !chessIsAttacked(s, _ri(homeR, 3), !white)) {
        moves.push({ from:i, to:_ri(homeR, 2), castle:'Q' });
    }
}

// Is square `target` attacked by `byWhite` side?
function chessIsAttacked(s, target, byWhite) {
    const [tr, tc] = _ij(target);
    // Pawn attacks
    const pawnDir = byWhite ? 1 : -1; // pawns attacking up from below
    for (const dc of [-1, 1]) {
        const r = tr + pawnDir, c = tc + dc;
        if (_inB(r, c)) {
            const p = s.board[_ri(r, c)];
            if (p !== '.' && (p === (byWhite ? 'P' : 'p'))) return true;
        }
    }
    // Knight
    for (const [dr, dc] of KNIGHT_DELTAS) {
        const r = tr + dr, c = tc + dc;
        if (!_inB(r, c)) continue;
        const p = s.board[_ri(r, c)];
        if (p !== '.' && p.toLowerCase() === 'n' && _isWhite(p) === byWhite) return true;
    }
    // King
    for (const [dr, dc] of KING_DELTAS) {
        const r = tr + dr, c = tc + dc;
        if (!_inB(r, c)) continue;
        const p = s.board[_ri(r, c)];
        if (p !== '.' && p.toLowerCase() === 'k' && _isWhite(p) === byWhite) return true;
    }
    // Sliding: bishop/queen on diagonals, rook/queen on lines
    for (const [dirs, types] of [[BISHOP_DIRS, ['b','q']], [ROOK_DIRS, ['r','q']]]) {
        for (const [dr, dc] of dirs) {
            let r = tr + dr, c = tc + dc;
            while (_inB(r, c)) {
                const p = s.board[_ri(r, c)];
                if (p !== '.') {
                    if (_isWhite(p) === byWhite && types.includes(p.toLowerCase())) return true;
                    break;
                }
                r += dr; c += dc;
            }
        }
    }
    return false;
}

function chessFindKing(s, white) {
    const k = white ? 'K' : 'k';
    for (let i = 0; i < 64; i++) if (s.board[i] === k) return i;
    return -1;
}

function chessInCheck(s, sideOverride) {
    const side = sideOverride || s.turn;
    const white = side === 'w';
    const kp = chessFindKing(s, white);
    if (kp < 0) return false;
    return chessIsAttacked(s, kp, !white);
}

// Apply move (returns a NEW state). Doesn't validate legality — call with legal moves only.
function chessApplyMove(state, mv) {
    const s = {
        board: state.board.slice(),
        turn:  state.turn,
        castle:state.castle,
        ep:    null,
        halfmove: state.halfmove + 1,
        fullmove: state.fullmove + (state.turn === 'b' ? 1 : 0),
    };
    const piece = s.board[mv.from];
    const target = s.board[mv.to];
    const isWhite = _isWhite(piece);
    s.board[mv.from] = '.';
    s.board[mv.to] = piece;

    // Reset halfmove on pawn move or capture
    if (piece.toLowerCase() === 'p' || target !== '.' || mv.enPassant) s.halfmove = 0;

    // En passant capture
    if (mv.enPassant) {
        const capRow = isWhite ? Math.floor(mv.to / 8) + 1 : Math.floor(mv.to / 8) - 1;
        s.board[capRow * 8 + (mv.to % 8)] = '.';
    }
    // Pawn double — set ep target
    if (mv.pawnDouble) {
        s.ep = (mv.from + mv.to) / 2 | 0;
    }
    // Promotion
    if (mv.promote) {
        s.board[mv.to] = isWhite ? mv.promote.toUpperCase() : mv.promote;
    }
    // Castling — move the rook
    if (mv.castle) {
        const homeR = isWhite ? 7 : 0;
        if (mv.castle === 'K') {
            s.board[_ri(homeR, 5)] = s.board[_ri(homeR, 7)];
            s.board[_ri(homeR, 7)] = '.';
        } else {
            s.board[_ri(homeR, 3)] = s.board[_ri(homeR, 0)];
            s.board[_ri(homeR, 0)] = '.';
        }
    }
    // Update castle rights
    let rights = s.castle;
    if (piece === 'K') rights = rights.replace(/[KQ]/g, '');
    if (piece === 'k') rights = rights.replace(/[kq]/g, '');
    if (piece === 'R') {
        if (mv.from === 56) rights = rights.replace('Q', '');
        if (mv.from === 63) rights = rights.replace('K', '');
    }
    if (piece === 'r') {
        if (mv.from === 0)  rights = rights.replace('q', '');
        if (mv.from === 7)  rights = rights.replace('k', '');
    }
    // If a rook on its home was captured, lose that right
    if (mv.to === 56) rights = rights.replace('Q', '');
    if (mv.to === 63) rights = rights.replace('K', '');
    if (mv.to === 0)  rights = rights.replace('q', '');
    if (mv.to === 7)  rights = rights.replace('k', '');
    s.castle = rights;

    // Atomic: capture detonates a 3x3 area (non-pawn pieces vanish, capturing piece too)
    if (chessVariant === 'atomic' && (mv.capture || mv.enPassant)) {
        chessAtomicDetonate(s, mv.to);
    }

    s.turn = state.turn === 'w' ? 'b' : 'w';
    return s;
}

// Legal moves: pseudo-legal moves that don't leave own king in check.
function chessLegalMoves(s, sideOverride) {
    const side = sideOverride || s.turn;
    const pseudo = chessGenerateMoves(s, side);
    const legal = [];
    const isWhite = side === 'w';
    for (const mv of pseudo) {
        const next = chessApplyMove(s, mv);
        if (chessVariant === 'atomic') {
            // Illegal if our king vanished in an explosion
            const ourKing = isWhite ? 'K' : 'k';
            if (!next.board.includes(ourKing)) continue;
            // Otherwise check rules are looser in atomic (touching kings = legal),
            // but we still require we're not left in check.
            if (chessInCheck(next, side)) continue;
            legal.push(mv);
        } else {
            if (!chessInCheck(next, side)) legal.push(mv);
        }
    }
    return legal;
}

function chessGameStatus(s) {
    // Variant-specific terminal checks first
    if (chessVariant === 'koth') {
        const koth = chessCheckKOTHWin(s);
        if (koth) return koth;
    }
    if (chessVariant === 'atomic') {
        const atom = chessAtomicGameStatus(s);
        if (atom) return atom;
    }
    if (chessVariant === 'horde') {
        // White loses if no pawns remain
        const wp = s.board.filter(p => p === 'P').length;
        if (wp === 0) return { over:true, result:'0-1', reason:'horde eliminated' };
    }

    const legal = chessLegalMoves(s);
    const inCheck = chessInCheck(s);
    if (legal.length === 0) {
        if (inCheck) return { over:true, result:s.turn === 'w' ? '0-1' : '1-0', reason:'checkmate' };
        return { over:true, result:'½-½', reason:'stalemate' };
    }
    if (s.halfmove >= 100) return { over:true, result:'½-½', reason:'50-move rule' };
    // Insufficient material (basic): only kings, or K vs K+minor
    // Skip for variants where this doesn't apply
    if (chessVariant === 'standard' || chessVariant === '960') {
        const pieces = s.board.filter(p => p !== '.' && p.toLowerCase() !== 'k');
        if (pieces.length === 0) return { over:true, result:'½-½', reason:'insufficient material' };
        if (pieces.length === 1 && ['n','b'].includes(pieces[0].toLowerCase()))
            return { over:true, result:'½-½', reason:'insufficient material' };
    }
    return { over:false, inCheck };
}

// Format a move as Standard Algebraic Notation (simplified).
function chessMoveToSAN(state, mv) {
    const piece = state.board[mv.from];
    const pt = piece.toLowerCase();
    if (mv.castle === 'K') return 'O-O' + _checkSuffix(state, mv);
    if (mv.castle === 'Q') return 'O-O-O' + _checkSuffix(state, mv);

    let san = '';
    const isPawn = pt === 'p';
    if (!isPawn) san += piece.toUpperCase();

    // Disambiguation
    if (!isPawn) {
        const sameType = chessLegalMoves(state).filter(m =>
            m !== mv && state.board[m.from] === piece && m.to === mv.to);
        if (sameType.length) {
            const sameFile = sameType.some(m => (m.from % 8) === (mv.from % 8));
            const sameRank = sameType.some(m => Math.floor(m.from/8) === Math.floor(mv.from/8));
            if (!sameFile) san += _idxToAlg(mv.from)[0];
            else if (!sameRank) san += _idxToAlg(mv.from)[1];
            else san += _idxToAlg(mv.from);
        }
    }

    if (mv.capture) {
        if (isPawn) san += _idxToAlg(mv.from)[0];
        san += 'x';
    }
    san += _idxToAlg(mv.to);
    if (mv.promote) san += '=' + mv.promote.toUpperCase();
    san += _checkSuffix(state, mv);
    return san;
}
function _checkSuffix(state, mv) {
    const next = chessApplyMove(state, mv);
    const status = chessGameStatus(next);
    if (status.over && status.reason === 'checkmate') return '#';
    if (status.inCheck) return '+';
    return '';
}

// ====================================================================
// BOT — Random / Beginner / Easy / Medium / Hard / Master
// ====================================================================
const PIECE_VAL = { p:100, n:320, b:330, r:500, q:900, k:20000 };
const MATE_SCORE = 30000;

// Piece-square tables (simplified, from white's perspective; mirror for black)
const PST = {
    p:[ 0, 0, 0, 0, 0, 0, 0, 0,
       50,50,50,50,50,50,50,50,
       10,10,20,30,30,20,10,10,
        5, 5,10,25,25,10, 5, 5,
        0, 0, 0,20,20, 0, 0, 0,
        5,-5,-10,0, 0,-10,-5, 5,
        5,10,10,-20,-20,10,10, 5,
        0, 0, 0, 0, 0, 0, 0, 0 ],
    n:[-50,-40,-30,-30,-30,-30,-40,-50,
       -40,-20, 0, 0, 0, 0,-20,-40,
       -30, 0,10,15,15,10, 0,-30,
       -30, 5,15,20,20,15, 5,-30,
       -30, 0,15,20,20,15, 0,-30,
       -30, 5,10,15,15,10, 5,-30,
       -40,-20, 0, 5, 5, 0,-20,-40,
       -50,-40,-30,-30,-30,-30,-40,-50],
    b:[-20,-10,-10,-10,-10,-10,-10,-20,
       -10, 0, 0, 0, 0, 0, 0,-10,
       -10, 0, 5,10,10, 5, 0,-10,
       -10, 5, 5,10,10, 5, 5,-10,
       -10, 0,10,10,10,10, 0,-10,
       -10,10,10,10,10,10,10,-10,
       -10, 5, 0, 0, 0, 0, 5,-10,
       -20,-10,-10,-10,-10,-10,-10,-20],
    r:[ 0, 0, 0, 0, 0, 0, 0, 0,
        5,10,10,10,10,10,10, 5,
       -5, 0, 0, 0, 0, 0, 0,-5,
       -5, 0, 0, 0, 0, 0, 0,-5,
       -5, 0, 0, 0, 0, 0, 0,-5,
       -5, 0, 0, 0, 0, 0, 0,-5,
       -5, 0, 0, 0, 0, 0, 0,-5,
        0, 0, 0, 5, 5, 0, 0, 0 ],
    q:[-20,-10,-10,-5,-5,-10,-10,-20,
       -10, 0, 0, 0, 0, 0, 0,-10,
       -10, 0, 5, 5, 5, 5, 0,-10,
       -5, 0, 5, 5, 5, 5, 0,-5,
        0, 0, 5, 5, 5, 5, 0,-5,
       -10, 5, 5, 5, 5, 5, 0,-10,
       -10, 0, 5, 0, 0, 0, 0,-10,
       -20,-10,-10,-5,-5,-10,-10,-20],
    k:[-30,-40,-40,-50,-50,-40,-40,-30,
       -30,-40,-40,-50,-50,-40,-40,-30,
       -30,-40,-40,-50,-50,-40,-40,-30,
       -30,-40,-40,-50,-50,-40,-40,-30,
       -20,-30,-30,-40,-40,-30,-30,-20,
       -10,-20,-20,-20,-20,-20,-20,-10,
        20,20, 0, 0, 0, 0,20,20,
        20,30,10, 0, 0,10,30,20],
};

// ── Evaluation ─────────────────────────────────────────────────────
// Material + PST + bishop pair + pawn structure (doubled/isolated/passed)
// + king-safety pawn shield (middlegame only) + tempo.
function chessEvaluate(s) {
    let score = 0;
    let wK = -1, bK = -1;
    let wBishops = 0, bBishops = 0;
    let totalMat = 0;             // for game-phase detection
    const wPawns = [0,0,0,0,0,0,0,0];
    const bPawns = [0,0,0,0,0,0,0,0];

    for (let i = 0; i < 64; i++) {
        const p = s.board[i];
        if (p === '.') continue;
        const pt = p.toLowerCase();
        const val = PIECE_VAL[pt];
        const tbl = PST[pt];
        if (_isWhite(p)) {
            score += val + tbl[i];
            if (pt !== 'k' && pt !== 'p') totalMat += val;
            if (pt === 'k') wK = i;
            else if (pt === 'b') wBishops++;
            else if (pt === 'p') wPawns[i & 7]++;
        } else {
            const mi = ((7 - (i >>> 3)) << 3) | (i & 7);
            score -= val + tbl[mi];
            if (pt !== 'k' && pt !== 'p') totalMat += val;
            if (pt === 'k') bK = i;
            else if (pt === 'b') bBishops++;
            else if (pt === 'p') bPawns[i & 7]++;
        }
    }

    // Bishop pair
    if (wBishops >= 2) score += 35;
    if (bBishops >= 2) score -= 35;

    // Pawn structure
    for (let f = 0; f < 8; f++) {
        const wL = f > 0 ? wPawns[f-1] : 0;
        const wR = f < 7 ? wPawns[f+1] : 0;
        const bL = f > 0 ? bPawns[f-1] : 0;
        const bR = f < 7 ? bPawns[f+1] : 0;
        // Doubled
        if (wPawns[f] > 1) score -= 18 * (wPawns[f] - 1);
        if (bPawns[f] > 1) score += 18 * (bPawns[f] - 1);
        // Isolated
        if (wPawns[f] && !wL && !wR) score -= 14;
        if (bPawns[f] && !bL && !bR) score += 14;
        // Passed (no opposing pawn on file or adjacent files)
        if (wPawns[f] && !bL && !bPawns[f] && !bR) score += 25;
        if (bPawns[f] && !wL && !wPawns[f] && !wR) score -= 25;
    }

    // King safety — pawn shield, only matters in middlegame
    if (totalMat > 2000) {
        if (wK !== -1) {
            const kr = wK >>> 3, kc = wK & 7;
            let shield = 0;
            if (kr >= 1) {
                for (let dc = -1; dc <= 1; dc++) {
                    const c = kc + dc;
                    if (c < 0 || c > 7) continue;
                    if (s.board[_ri(kr-1, c)] === 'P') shield += 12;
                    else if (kr >= 2 && s.board[_ri(kr-2, c)] === 'P') shield += 6;
                    else shield -= 8;  // missing shield pawn is bad
                }
            }
            score += shield;
        }
        if (bK !== -1) {
            const kr = bK >>> 3, kc = bK & 7;
            let shield = 0;
            if (kr <= 6) {
                for (let dc = -1; dc <= 1; dc++) {
                    const c = kc + dc;
                    if (c < 0 || c > 7) continue;
                    if (s.board[_ri(kr+1, c)] === 'p') shield += 12;
                    else if (kr <= 5 && s.board[_ri(kr+2, c)] === 'p') shield += 6;
                    else shield -= 8;
                }
            }
            score -= shield;
        }
    }

    // Tempo — small bonus for side to move
    score += s.turn === 'w' ? 10 : -10;

    return s.turn === 'w' ? score : -score; // negamax-friendly
}

// ── Search infrastructure ──────────────────────────────────────────
const MAX_PLY = 96;
let _killer1 = new Array(MAX_PLY).fill(null);
let _killer2 = new Array(MAX_PLY).fill(null);
let _history = new Int32Array(64 * 64);

let _searchStartTime = 0;
let _searchTimeBudget = 0;
let _searchAborted = false;
let _nodes = 0;

function _moveKey(mv) { return (mv.from << 6) | mv.to; }
function _moveEq(a, b) {
    if (!a || !b) return false;
    return a.from === b.from && a.to === b.to && (a.promote || null) === (b.promote || null);
}

function _moveOrderScore(s, mv) {
    let score = 0;
    if (mv.capture) {
        const att = s.board[mv.from].toLowerCase();
        const vic = mv.enPassant ? 'p' : s.board[mv.to].toLowerCase();
        score += 10000 + 10 * PIECE_VAL[vic] - PIECE_VAL[att];
    }
    if (mv.promote) score += 8000 + (PIECE_VAL[mv.promote] || 0);
    return score;
}

function _orderedScore(s, mv, ply) {
    let base = _moveOrderScore(s, mv);
    if (!mv.capture && !mv.promote) {
        if (_moveEq(_killer1[ply], mv)) base += 9000;
        else if (_moveEq(_killer2[ply], mv)) base += 8000;
        else base += _history[_moveKey(mv)];
    }
    return base;
}

// ── Quiescence search ──────────────────────────────────────────────
// Stand-pat at non-check positions; recurse on captures/promotions only.
// In check, search every legal escape (full expansion).
function chessQuiescence(s, alpha, beta, ply) {
    _nodes++;
    if ((_nodes & 1023) === 0 && Date.now() - _searchStartTime > _searchTimeBudget) {
        _searchAborted = true;
        return 0;
    }
    const inCheck = chessInCheck(s);
    let standPat = 0;
    if (!inCheck) {
        standPat = chessEvaluate(s);
        if (standPat >= beta) return beta;
        if (standPat > alpha) alpha = standPat;
    }
    const legal = chessLegalMoves(s);
    if (!legal.length) {
        if (inCheck) return -MATE_SCORE + ply;
        return 0;
    }
    const candidates = inCheck ? legal : legal.filter(m => m.capture || m.promote);
    candidates.sort((a, b) => _moveOrderScore(s, b) - _moveOrderScore(s, a));
    for (const mv of candidates) {
        // Delta pruning — skip clearly hopeless captures
        if (!inCheck) {
            const vic = mv.capture ? (mv.enPassant ? 'p' : s.board[mv.to].toLowerCase()) : null;
            const gain = (vic ? PIECE_VAL[vic] : 0) + (mv.promote ? PIECE_VAL[mv.promote] - PIECE_VAL.p : 0);
            if (standPat + gain + 200 < alpha) continue;
        }
        const next = chessApplyMove(s, mv);
        const sc = -chessQuiescence(next, -beta, -alpha, ply + 1);
        if (_searchAborted) return 0;
        if (sc >= beta) return beta;
        if (sc > alpha) alpha = sc;
    }
    return alpha;
}

// ── Main alpha-beta search (negamax) ───────────────────────────────
function chessSearch(s, depth, alpha, beta, ply) {
    if (ply === undefined) ply = 0;
    _nodes++;
    if ((_nodes & 1023) === 0 && Date.now() - _searchStartTime > _searchTimeBudget) {
        _searchAborted = true;
        return { score: 0 };
    }

    const inCheck = chessInCheck(s);
    if (inCheck) depth++;  // check extension

    if (depth <= 0) {
        return { score: chessQuiescence(s, alpha, beta, ply) };
    }

    const legal = chessLegalMoves(s);
    if (!legal.length) {
        if (inCheck) return { score: -MATE_SCORE + ply };
        return { score: 0 };
    }

    legal.sort((a, b) => _orderedScore(s, b, ply) - _orderedScore(s, a, ply));

    let bestScore = -Infinity;
    let bestMove = null;
    for (const mv of legal) {
        const next = chessApplyMove(s, mv);
        const r = chessSearch(next, depth - 1, -beta, -alpha, ply + 1);
        if (_searchAborted) return { score: 0 };
        const sc = -r.score;
        if (sc > bestScore) { bestScore = sc; bestMove = mv; }
        if (sc > alpha) alpha = sc;
        if (alpha >= beta) {
            // Beta cutoff — record killer + history for quiet moves
            if (!mv.capture && !mv.promote) {
                if (!_moveEq(_killer1[ply], mv)) {
                    _killer2[ply] = _killer1[ply];
                    _killer1[ply] = mv;
                }
                _history[_moveKey(mv)] += depth * depth;
            }
            break;
        }
    }
    return { score: bestScore, move: bestMove };
}

// Iterative deepening with soft time budget.
function chessSearchIterative(s, maxDepth, timeMs) {
    for (let i = 0; i < MAX_PLY; i++) { _killer1[i] = null; _killer2[i] = null; }
    _history = new Int32Array(64 * 64);
    _searchStartTime = Date.now();
    _searchTimeBudget = timeMs;
    _searchAborted = false;
    _nodes = 0;

    let bestMove = null;
    let bestScore = 0;
    for (let d = 1; d <= maxDepth; d++) {
        const r = chessSearch(s, d, -Infinity, Infinity, 0);
        if (_searchAborted) break;
        if (r.move) { bestMove = r.move; bestScore = r.score; }
        if (Math.abs(bestScore) > MATE_SCORE - 100) break;
        if (Date.now() - _searchStartTime > timeMs * 0.45) break;
    }
    return { move: bestMove, score: bestScore };
}

// ── Named bot roster ─────────────────────────────────────────────────
// maxDepth: iterative-deepening cap.
// time:     soft time budget per move in ms.
// noise:    cp threshold — moves within this of best are candidates for "human" weakening.
// blunder:  probability of playing a random legal move (heavy weakening).
// captureBias / passBias: personality knobs that nudge move choice.
const CHESS_BOTS = [
    { id: 0,  name: 'Human',            emoji: '👤', elo: 0    },
    { id: 1,  name: 'Random Rick',      emoji: '🎲', elo: 200,  maxDepth: 0, time: 0,    blunder: 1.00 },
    { id: 2,  name: 'Patzer Pete',      emoji: '🤡', elo: 400,  maxDepth: 1, time: 30,   blunder: 0.45, noise: 220 },
    { id: 3,  name: 'Little Timmy',     emoji: '🧒', elo: 600,  maxDepth: 1, time: 40,   blunder: 0.25, noise: 140 },
    { id: 4,  name: 'Club Carlos',      emoji: '♟', elo: 800,   maxDepth: 1, time: 50,   blunder: 0.12, noise: 80 },
    { id: 5,  name: 'Capture Kim',      emoji: '😈', elo: 950,  maxDepth: 2, time: 80,   blunder: 0.06, noise: 55, captureBias: 1.5 },
    { id: 6,  name: 'Tactical Tony',    emoji: '⚔️', elo: 1100, maxDepth: 2, time: 100,  blunder: 0.04, noise: 40, captureBias: 1.3 },
    { id: 7,  name: 'Opening Oliver',   emoji: '📖', elo: 1250, maxDepth: 2, time: 130,  blunder: 0.02, noise: 32 },
    { id: 8,  name: 'Gambit Gary',      emoji: '🎯', elo: 1400, maxDepth: 3, time: 170,  blunder: 0.02, noise: 22 },
    { id: 9,  name: 'Blitz Bobby',      emoji: '⚡', elo: 1550, maxDepth: 3, time: 220,  blunder: 0.01, noise: 16 },
    { id: 10, name: 'Solid Sam',        emoji: '🛡️', elo: 1650, maxDepth: 3, time: 280,  noise: 10, passBias: 1.0 },
    { id: 11, name: 'The Punisher',     emoji: '😤', elo: 1750, maxDepth: 4, time: 350,  noise: 7 },
    { id: 12, name: 'Positional Pat',   emoji: '🧩', elo: 1850, maxDepth: 4, time: 450,  noise: 4, passBias: 1.2 },
    { id: 13, name: 'Firebrand Fiona',  emoji: '🔥', elo: 1950, maxDepth: 4, time: 550,  noise: 3, captureBias: 1.2 },
    { id: 14, name: 'Endgame Eddie',    emoji: '👑', elo: 2050, maxDepth: 5, time: 700,  noise: 0 },
    { id: 15, name: 'Iron Ivan',        emoji: '🦾', elo: 2150, maxDepth: 6, time: 900,  noise: 0 },
    { id: 16, name: 'Master Mike',      emoji: '🏆', elo: 2250, maxDepth: 7, time: 1200, noise: 0 },
    { id: 17, name: 'Expert Emma',      emoji: '🎓', elo: 2350, maxDepth: 8, time: 1600, noise: 0 },
    { id: 18, name: 'The Professor',    emoji: '🔭', elo: 2450, maxDepth: 10, time: 2200, noise: 0 },
    { id: 19, name: 'Candidate CM',     emoji: '⭐', elo: 2550, maxDepth: 12, time: 3000, noise: 0 },
    { id: 20, name: 'Grandmaster GM',   emoji: '🎩', elo: 2650, maxDepth: 14, time: 4500, noise: 0 },
    { id: 21, name: 'Magnus',           emoji: '🤖', elo: 2800, maxDepth: 16, time: 6500, noise: 0 },
];

function chessBotMove(s, level) {
    const legal = chessLegalMoves(s);
    if (!legal.length) return null;

    const bot = CHESS_BOTS[level] || CHESS_BOTS[5];

    // Pure-random or full blunder
    if (!bot.maxDepth || (bot.blunder && Math.random() < bot.blunder)) {
        return legal[Math.floor(Math.random() * legal.length)];
    }

    // Depth-1: greedy 1-ply with noise + biases (used by weak bots)
    if (bot.maxDepth === 1) {
        let best = legal[0], bestScore = -Infinity;
        for (const mv of legal) {
            const next = chessApplyMove(s, mv);
            let sc = -chessEvaluate(next);
            if (bot.noise)       sc += (Math.random() * bot.noise * 2 - bot.noise);
            if (bot.captureBias && mv.capture) sc += bot.captureBias * 80;
            if (bot.passBias    && !mv.capture) sc += bot.passBias * 20;
            if (sc > bestScore)  { bestScore = sc; best = mv; }
        }
        return best;
    }

    // Full search
    const r = chessSearchIterative(s, bot.maxDepth, bot.time || 500);
    let bestMove = r.move || legal[0];

    // Weakening pass: rescore all root moves at 1-ply, pick from
    // moves within `noise` cp of best. Gives natural human-like sloppiness.
    if (bot.noise && bot.noise > 0) {
        const scored = legal.map(mv => {
            const next = chessApplyMove(s, mv);
            return { mv, score: -chessEvaluate(next) };
        });
        scored.sort((a, b) => b.score - a.score);
        const top = scored[0].score;
        const candidates = scored.filter(x => top - x.score <= bot.noise);
        if (candidates.length > 1 && Math.random() < 0.5) {
            bestMove = candidates[Math.floor(Math.random() * candidates.length)].mv;
        }
    }

    // Personality post-search
    if (bot.captureBias && bestMove && !bestMove.capture && Math.random() < 0.25) {
        const capMoves = legal.filter(m => m.capture);
        if (capMoves.length) {
            // Pick the best capture by SEE-approximation (MVV-LVA)
            capMoves.sort((a, b) => _moveOrderScore(s, b) - _moveOrderScore(s, a));
            return capMoves[0];
        }
    }
    if (bot.passBias && bestMove && bestMove.capture && Math.random() < 0.2) {
        const nonCap = legal.filter(m => !m.capture);
        if (nonCap.length) {
            const sub = chessSearchIterative(s, Math.max(1, bot.maxDepth - 1), (bot.time || 500) * 0.3);
            return sub.move || bestMove;
        }
    }

    return bestMove;
}

// ====================================================================
// UI — board rendering, click handling, history, controls
// ====================================================================
const PIECE_UNICODE = {
    K:'♚', Q:'♛', R:'♜', B:'♝', N:'♞', P:'♟',
    k:'♚', q:'♛', r:'♜', b:'♝', n:'♞', p:'♟',
};

let chessState     = chessParseFEN(CHESS_INITIAL);
let chessHistory   = [];          // [{state, move, san}] BEFORE the move
let chessSelected  = null;        // selected square idx
let chessLegalCache= [];          // legal moves from selected square
let chessOrientation = 'w';       // 'w' = white at bottom
let chessBotLevel  = 5;
let chessHumanSide = 'w';         // which color the human plays. 'b'=both human
let chessBotBusy   = false;
let chessPendingPromotion = null; // {mv, callback}

// ── ELO tracking ─────────────────────────────────────────────────────
const CHESS_ELO_KEY     = 'vulsor_chess_elo';
const CHESS_ELO_HIST_KEY= 'vulsor_chess_elo_hist';
let chessPlayerElo      = 0;
let chessEloHistory     = []; // [{date, delta, newElo, opponent, result}]

const CHESS_ELO_TITLES = [
    [0,    'Beginner'],
    [800,  'Novice'],
    [1000, 'Intermediate'],
    [1200, 'Club Player'],
    [1400, 'Advanced'],
    [1600, 'Expert'],
    [1800, 'Candidate Master'],
    [2000, 'FIDE Master'],
    [2200, 'International Master'],
    [2400, 'Grandmaster'],
    [2600, 'Super-GM'],
];

function _eloTitle(elo) {
    if (elo === 0) return 'Unrated';
    let title = CHESS_ELO_TITLES[0][1];
    for (const [thresh, name] of CHESS_ELO_TITLES) {
        if (elo >= thresh) title = name;
    }
    return title;
}

function chessLoadElo() {
    try {
        const raw = localStorage.getItem(CHESS_ELO_KEY);
        if (raw !== null) chessPlayerElo = Math.max(0, parseInt(raw, 10) || 0);
        const hist = localStorage.getItem(CHESS_ELO_HIST_KEY);
        if (hist) chessEloHistory = JSON.parse(hist).slice(-50); // keep last 50
    } catch(e) {}
}

function chessSaveElo() {
    try {
        localStorage.setItem(CHESS_ELO_KEY, String(chessPlayerElo));
        localStorage.setItem(CHESS_ELO_HIST_KEY, JSON.stringify(chessEloHistory.slice(-50)));
    } catch(e) {}
}

// Gap at which wins against weaker bots give 0 ELO (losses still cost rating)
const CHESS_ELO_WIN_GAP = 400;

function chessCalcElo(playerElo, opponentElo, result /* 1=win, 0=loss, 0.5=draw */) {
    // Win against a bot rated 400+ below you → no gain
    if (result === 1 && playerElo - opponentElo >= CHESS_ELO_WIN_GAP) return 0;
    const K = playerElo < 1200 ? 40 : playerElo < 2100 ? 32 : 24;
    const expected = 1 / (1 + Math.pow(10, (opponentElo - playerElo) / 400));
    return Math.round(K * (result - expected));
}

function chessRenderElo() {
    const disp  = document.getElementById('chess-elo-display');
    const badge = document.getElementById('chess-elo-badge');
    const bar   = document.getElementById('chess-elo-bar');
    const delta = document.getElementById('chess-elo-delta');
    if (!disp) return;
    disp.textContent  = chessPlayerElo;
    if (badge) badge.textContent = _eloTitle(chessPlayerElo);
    if (bar) {
        // Bar fills from 0 (0 ELO) to 100% (2850 ELO)
        const pct = Math.max(1, Math.min(100, (chessPlayerElo / 2850) * 100));
        bar.style.width = pct + '%';
        bar.style.background = chessPlayerElo >= 2200 ? '#a78bfa'
            : chessPlayerElo >= 1800 ? '#f59e0b'
            : chessPlayerElo >= 1400 ? '#34d399'
            : '#60a5fa';
    }
    if (delta) delta.textContent = ''; // clear between games
    // Render history list
    const hist = document.getElementById('chess-elo-history');
    if (hist && chessEloHistory.length) {
        hist.innerHTML = [...chessEloHistory].reverse().map(h => {
            const sign   = h.delta >= 0 ? '+' : '';
            const col    = h.delta > 0 ? 'text-green-400' : h.delta < 0 ? 'text-red-400' : 'text-slate-400';
            const icon   = h.result === 'win' ? '♟ W' : h.result === 'loss' ? '♟ L' : '♟ D';
            return `<div class="flex items-center justify-between text-[10px] py-0.5 border-b border-slate-800/60">
                <span class="text-slate-500">${icon} vs ${h.opponent}</span>
                <span class="${col} font-medium">${sign}${h.delta} → ${h.newElo}</span>
            </div>`;
        }).join('');
    }
}
let chessLastMove  = null;
let chessAnimating = false;
let chessViewMode  = '2d';        // '2d' | '3d' | 'iso' | 'blind'
let chessTheme     = 'wood';      // wood | walnut | sand | green | forest | blue | ice | coral | pastel | marble | glass | midnight | neon | lava | matrix
let chessVariant   = 'standard';  // 'standard' | '960' | 'koth' | 'atomic' | 'horde'

// ── Variant helpers ──────────────────────────────────────────────────
const CHESS_VARIANT_INFO = {
    standard: 'Standard chess. Castling, en passant, 50-move rule all in play.',
    '960':    'Fischer Random — back rank is shuffled (same for both sides, bishops on opposite colors, king between rooks). Castling is disabled in this build for simplicity.',
    koth:     'King of the Hill — first king to safely occupy d4, d5, e4, or e5 wins. Normal rules otherwise.',
    atomic:   'Atomic Chess — any capture detonates: the captured piece, the capturing piece, and all non-pawn pieces on the 8 adjacent squares vanish. Win by exploding the enemy king.',
    horde:    'Horde — White plays 36 pawns vs Black\'s full army. White wins by checkmate; Black wins by removing every white pawn.',
};

function chessGenerate960FEN() {
    // Generate a legal Chess960 back rank.
    // Rules: bishops on opposite colors, king between rooks.
    const pieces = ['', '', '', '', '', '', '', ''];
    // Bishop on a light square (index 1,3,5,7)
    const lightSqs = [1,3,5,7]; pieces[lightSqs[Math.floor(Math.random()*4)]] = 'b';
    // Bishop on a dark square (index 0,2,4,6)
    const darkSqs = [0,2,4,6]; pieces[darkSqs[Math.floor(Math.random()*4)]] = 'b';
    // Place queen + 2 knights in remaining squares
    const empty = () => pieces.map((p,i) => p === '' ? i : -1).filter(i => i >= 0);
    const eA = empty();
    pieces[eA[Math.floor(Math.random()*eA.length)]] = 'q';
    let eB = empty();
    pieces[eB[Math.floor(Math.random()*eB.length)]] = 'n';
    let eC = empty();
    pieces[eC[Math.floor(Math.random()*eC.length)]] = 'n';
    // Remaining 3 squares: R K R (king must be between rooks)
    let eD = empty(); // 3 indices left, ascending
    pieces[eD[0]] = 'r'; pieces[eD[1]] = 'k'; pieces[eD[2]] = 'r';

    const black = pieces.join('');
    const white = black.toUpperCase();
    // We disable castling in 960 for simplicity (the engine assumes king on e1/e8).
    return `${black}/pppppppp/8/8/8/8/PPPPPPPP/${white} w - - 0 1`;
}

function chessVariantStartFEN(v) {
    if (v === '960')   return chessGenerate960FEN();
    if (v === 'horde') return 'rnbqkbnr/pppppppp/8/1PP2PP1/PPPPPPPP/PPPPPPPP/PPPPPPPP/PPPPPPPP w kq - 0 1';
    return CHESS_INITIAL;
}

// King of the Hill — check if any king is on a central square
function chessCheckKOTHWin(s) {
    if (chessVariant !== 'koth') return null;
    const hills = [27, 28, 35, 36]; // d5, e5, d4, e4 in 0-63 index (rank 4 = idx 32..39, rank 5 = 24..31)
    for (const idx of hills) {
        const p = s.board[idx];
        if (p === 'K') return { over:true, result:'1-0', reason:'king of the hill (white)' };
        if (p === 'k') return { over:true, result:'0-1', reason:'king of the hill (black)' };
    }
    return null;
}

// Atomic — detonate around a captured square. Pawns survive in the blast (they're already gone if captured), pieces vanish.
function chessAtomicDetonate(s, capSquare) {
    const [r, c] = _ij(capSquare);
    s.board[capSquare] = '.'; // capturing piece also vanishes
    for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            const nr = r + dr, nc = c + dc;
            if (!_inB(nr, nc)) continue;
            const idx = _ri(nr, nc);
            const p = s.board[idx];
            if (p !== '.' && p.toLowerCase() !== 'p') s.board[idx] = '.';
        }
    }
}

function chessAtomicGameStatus(s) {
    // Atomic: if either king has vanished, that side loses.
    let wk = false, bk = false;
    for (const p of s.board) { if (p === 'K') wk = true; if (p === 'k') bk = true; }
    if (!wk) return { over:true, result:'0-1', reason:'white king exploded' };
    if (!bk) return { over:true, result:'1-0', reason:'black king exploded' };
    return null;
}


function chessNewGame() {
    chessState = chessParseFEN(chessVariantStartFEN(chessVariant));
    chessHistory = [];
    chessSelected = null;
    chessLegalCache = [];
    chessLastMove = null;
    chessBotBusy = false;
    document.getElementById('chess-bot-thinking').style.display = 'none';
    document.getElementById('chess-gameover').style.display = 'none';
    document.getElementById('chess-gameover').classList.remove('flex');
    document.getElementById('chess-promotion').style.display = 'none';
    document.getElementById('chess-promotion').classList.remove('flex');

    // Player color selection
    const colorSel = document.getElementById('chess-player-color').value;
    let me = 'w';
    if (colorSel === 'r') me = Math.random() < 0.5 ? 'w' : 'b';
    else me = colorSel;
    chessHumanSide = me;
    chessOrientation = me;

    const lvl = parseInt(document.getElementById('chess-bot-level').value, 10);
    chessBotLevel = lvl;

    chessRender();
    if (typeof ChessSounds !== 'undefined') ChessSounds.gameStart();

    // If bot plays first
    if (lvl > 0 && chessHumanSide !== chessState.turn) {
        chessTriggerBot();
    }
}

function chessRender() {
    chessApplyViewTheme();
    chessRenderBoard();
    chessRenderHistory();
    chessRenderStatus();
    chessRenderCaptured();
}

function chessApplyViewTheme() {
    const wrap = document.getElementById('chess-board-wrap');
    const play = document.getElementById('chess-play-pane');
    if (!wrap || !play) return;

    // Reset all mode/theme classes
    wrap.className = wrap.className
        .replace(/\bchess-view-\S+/g, '')
        .replace(/\bchess-theme-\S+/g, '')
        .trim() + ' relative';
    if (chessViewMode !== '2d') wrap.classList.add(`chess-view-${chessViewMode}`);
    wrap.classList.add(`chess-theme-${chessTheme}`);

    // Show 3D-only customization panel when in 3D mode
    const c3dCtrl = document.getElementById('chess-3d-controls');
    if (c3dCtrl) c3dCtrl.style.display = chessViewMode === '3d' ? '' : 'none';

    play.style.alignItems = 'center';

    if (chessViewMode === '3d') {
        // Let the 3D canvas fill the entire available play area
        wrap.style.aspectRatio = 'auto';
        wrap.style.width = '100%';
        wrap.style.height = '100%';
        wrap.style.maxWidth = 'none';
        wrap.style.minWidth = '0';
        play.style.padding = '0';
        play.style.alignItems = 'stretch';
        if (typeof chess3DShow === 'function') {
            chess3DShow();
            if (typeof chess3DSync === 'function') chess3DSync(chessLastMove);
        }
    } else {
        // Restore the square 2D board sizing — height-first so aspect-ratio
        // keeps it square and it never overflows the container vertically.
        wrap.style.aspectRatio = '1/1';
        wrap.style.height    = 'calc(100% - 4px)';
        wrap.style.maxHeight = 'calc(100% - 4px)';
        wrap.style.width     = 'auto';
        wrap.style.maxWidth  = 'min(900px, 96%)';
        wrap.style.minWidth  = '0';
        play.style.padding = '';
        if (typeof chess3DHide === 'function') chess3DHide();
    }
}

function chessRenderBoard() {
    const board = document.getElementById('chess-board');
    if (!board) return;
    board.innerHTML = '';
    const flipped = chessOrientation === 'b';
    for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
            const visR = flipped ? 7 - row : row;
            const visC = flipped ? 7 - col : col;
            const idx = visR * 8 + visC;
            const sq = document.createElement('div');
            const isLight = (visR + visC) % 2 === 0;
            sq.className = 'chess-sq ' + (isLight ? 'light' : 'dark');
            sq.dataset.idx = idx;

            // Last-move highlights
            if (chessLastMove) {
                if (chessLastMove.from === idx) sq.classList.add('last-from');
                if (chessLastMove.to   === idx) sq.classList.add('last-to');
            }
            // Selected
            if (chessSelected === idx) sq.classList.add('selected');

            // King in check highlight
            const status = chessGameStatus(chessState);
            if (status.inCheck) {
                const kp = chessFindKing(chessState, chessState.turn === 'w');
                if (kp === idx) sq.classList.add('in-check');
            }

            // Legal move dot
            const legalHere = chessLegalCache.find(m => m.to === idx);
            if (legalHere) {
                const dot = document.createElement('div');
                dot.className = 'legal-dot';
                sq.appendChild(dot);
                if (legalHere.capture || chessState.board[idx] !== '.') sq.classList.add('capture');
                // En passant — mark the empty target square with an EP badge
                if (legalHere.enPassant) {
                    sq.classList.add('ep-hint');
                    const ep = document.createElement('span');
                    ep.className = 'ep-badge';
                    ep.textContent = 'EP';
                    sq.appendChild(ep);
                }
            }

            // Piece — unicode
            const p = chessState.board[idx];
            if (p !== '.') {
                const span = document.createElement('span');
                span.className = 'piece ' + (_isWhite(p) ? 'white' : 'black');
                span.textContent = PIECE_UNICODE[p];
                sq.appendChild(span);
            }

            // Coordinates on edges
            if ((flipped && col === 7) || (!flipped && col === 0)) {
                const r = document.createElement('span');
                r.className = 'coord rank';
                r.textContent = 8 - visR;
                sq.appendChild(r);
            }
            if ((flipped && row === 0) || (!flipped && row === 7)) {
                const f = document.createElement('span');
                f.className = 'coord file';
                f.textContent = String.fromCharCode(97 + visC);
                sq.appendChild(f);
            }

            sq.onclick = () => chessClickSquare(idx);
            board.appendChild(sq);
        }
    }
}

function chessClickSquare(idx) {
    if (chessBotBusy || chessAnimating) return;
    const status = chessGameStatus(chessState);
    if (status.over) return;

    // Only human side can click when bot enabled
    if (chessBotLevel > 0 && chessState.turn !== chessHumanSide) return;

    // If already selected, attempt to move
    if (chessSelected != null) {
        const mv = chessLegalCache.find(m => m.to === idx);
        if (mv) {
            // Promotion?
            const piece = chessState.board[chessSelected];
            const promoteRank = _isWhite(piece) ? 0 : 7;
            if (piece.toLowerCase() === 'p' && Math.floor(idx / 8) === promoteRank) {
                chessPendingPromotion = { from: chessSelected, to: idx };
                chessShowPromotionPicker();
                return;
            }
            chessMakeMove(mv);
            return;
        }
        // Clicked own piece elsewhere → reselect
        const p = chessState.board[idx];
        if (p !== '.' && _isWhite(p) === (chessState.turn === 'w')) {
            chessSelected = idx;
            chessLegalCache = chessLegalMoves(chessState).filter(m => m.from === idx);
            chessRenderBoard();
            if (chessViewMode === '3d' && typeof chess3DHighlightRefresh === 'function') chess3DHighlightRefresh();
            return;
        }
        // Deselect
        chessSelected = null;
        chessLegalCache = [];
        chessRenderBoard();
        if (chessViewMode === '3d' && typeof chess3DHighlightRefresh === 'function') chess3DHighlightRefresh();
        return;
    }
    // Select a piece
    const p = chessState.board[idx];
    if (p === '.' || _isWhite(p) !== (chessState.turn === 'w')) {
        if (typeof ChessSounds !== 'undefined') ChessSounds.illegal();
        return;
    }
    chessSelected = idx;
    chessLegalCache = chessLegalMoves(chessState).filter(m => m.from === idx);
    chessRenderBoard();
    if (chessViewMode === '3d' && typeof chess3DHighlightRefresh === 'function') {
        chess3DHighlightRefresh();
    }
}

function chessShowPromotionPicker() {
    const el = document.getElementById('chess-promotion');
    el.style.display = 'flex';
    el.classList.add('flex');
    el.classList.remove('hidden');
}

function chessHandlePromotionChoice(pieceKind) {
    if (!chessPendingPromotion) return;
    const { from, to } = chessPendingPromotion;
    chessPendingPromotion = null;
    document.getElementById('chess-promotion').style.display = 'none';
    const mv = chessLegalMoves(chessState).find(m =>
        m.from === from && m.to === to && m.promote === pieceKind);
    if (mv) chessMakeMove(mv);
}

// Animate a piece sliding from `fromIdx` to `toIdx`, then run callback.
// Duration ~450ms gives a calm, "thinking" feel.
const CHESS_ANIM_MS = 480;
function chessAnimateMove(fromIdx, toIdx, callback) {
    const board = document.getElementById('chess-board');
    if (!board) { callback(); return; }
    const fromSq = board.querySelector(`[data-idx="${fromIdx}"]`);
    const toSq   = board.querySelector(`[data-idx="${toIdx}"]`);
    if (!fromSq || !toSq) { callback(); return; }
    const piece = fromSq.querySelector('.piece');
    if (!piece) { callback(); return; }

    const boardRect = board.getBoundingClientRect();
    const fromRect  = fromSq.getBoundingClientRect();
    const toRect    = toSq.getBoundingClientRect();

    const ghost = piece.cloneNode(true);
    ghost.style.position = 'absolute';
    ghost.style.left = (fromRect.left - boardRect.left) + 'px';
    ghost.style.top  = (fromRect.top  - boardRect.top)  + 'px';
    ghost.style.width  = fromRect.width  + 'px';
    ghost.style.height = fromRect.height + 'px';
    ghost.style.display = 'flex';
    ghost.style.alignItems = 'center';
    ghost.style.justifyContent = 'center';
    ghost.style.fontSize = window.getComputedStyle(piece).fontSize;
    ghost.style.lineHeight = '1';
    ghost.style.transition = `transform ${CHESS_ANIM_MS}ms cubic-bezier(0.4, 0.0, 0.2, 1)`;
    ghost.style.zIndex = '25';
    ghost.style.pointerEvents = 'none';
    board.appendChild(ghost);

    // Hide the original so it doesn't double up
    piece.style.opacity = '0';

    // Trigger the slide on the next frame
    requestAnimationFrame(() => {
        const dx = toRect.left - fromRect.left;
        const dy = toRect.top  - fromRect.top;
        ghost.style.transform = `translate(${dx}px, ${dy}px)`;
    });

    setTimeout(() => {
        ghost.remove();
        callback();
    }, CHESS_ANIM_MS + 20);
}

function chessMakeMove(mv) {
    const san = chessMoveToSAN(chessState, mv);
    const prevState = chessState;
    chessHistory.push({ state: prevState, move: mv, san });

    // Pick the right animation for the current view mode.
    chessAnimating = true;
    const animFn = (chessViewMode === '3d' && typeof chess3DAnimateMove === 'function')
        ? chess3DAnimateMove
        : chessAnimateMove;
    animFn(mv.from, mv.to, () => {
        chessAnimating = false;
        chessState = chessApplyMove(prevState, mv);
        chessSelected = null;
        chessLegalCache = [];
        chessLastMove = mv;
        chessRender();
        if (chessViewMode === '3d' && typeof chess3DSync === 'function') {
            chess3DSync(mv);
        }

        // ── Sound ────────────────────────────────────────────────
        if (typeof ChessSounds !== 'undefined') {
            const isCastle  = san.startsWith('O-O');
            const isCapture = mv.capture || san.includes('x');
            const isPromote = !!mv.promotion;
            const isCheck   = chessInCheck(chessState, chessState.turn === 'w');
            if      (isCheck)   ChessSounds.check();
            else if (isPromote) ChessSounds.promote();
            else if (isCastle)  ChessSounds.castle();
            else if (isCapture) ChessSounds.capture();
            else                ChessSounds.move();
        }

        const status = chessGameStatus(chessState);
        if (status.over) {
            chessShowGameOver(status);
            return;
        }
        // Bot's turn?
        if (chessBotLevel > 0 && chessState.turn !== chessHumanSide) {
            chessTriggerBot();
        }
    });
}

function chessTriggerBot() {
    if (chessBotLevel === 0) return;
    chessBotBusy = true;
    document.getElementById('chess-bot-thinking').style.display = '';
    // Yield to UI then compute. Small "thinking" delay feels human.
    const thinkDelay = 350 + Math.random() * 250;
    setTimeout(() => {
        const mv = chessBotMove(chessState, chessBotLevel);
        chessBotBusy = false;
        document.getElementById('chess-bot-thinking').style.display = 'none';
        if (!mv) return;
        chessMakeMove(mv);
    }, thinkDelay);
}

function chessRenderHistory() {
    const wrap = document.getElementById('chess-history');
    if (!wrap) return;
    if (!chessHistory.length) {
        wrap.innerHTML = '<div class="text-slate-600 italic text-[10px]">No moves yet</div>';
        return;
    }
    let html = '';
    for (let i = 0; i < chessHistory.length; i += 2) {
        const num = (i / 2 | 0) + 1;
        const w = chessHistory[i]?.san || '';
        const b = chessHistory[i+1]?.san || '';
        html += `<div class="flex gap-2 hover:bg-slate-800/40 px-1 rounded">
            <span class="text-slate-600 w-6 text-right">${num}.</span>
            <span class="flex-1 text-slate-200">${w}</span>
            <span class="flex-1 text-slate-400">${b}</span>
        </div>`;
    }
    wrap.innerHTML = html;
    wrap.scrollTop = wrap.scrollHeight;
}

function chessRenderStatus() {
    const pill = document.getElementById('chess-status-pill');
    if (!pill) return;
    const status = chessGameStatus(chessState);
    if (status.over) {
        if (status.reason === 'checkmate') pill.textContent = `Checkmate — ${status.result}`;
        else pill.textContent = `Draw — ${status.reason}`;
        pill.className = 'text-[10px] px-1.5 py-0.5 rounded bg-amber-900/60 text-amber-200';
        return;
    }
    const who = chessState.turn === 'w' ? 'White' : 'Black';
    pill.textContent = `${who} to move${status.inCheck ? ' · CHECK' : ''}`;
    pill.className = 'text-[10px] px-1.5 py-0.5 rounded ' +
        (status.inCheck ? 'bg-red-900/60 text-red-200' : 'bg-slate-800 text-slate-400');
}

function chessRenderCaptured() {
    // Count from initial vs current
    const initial = { p:8, n:2, b:2, r:2, q:1 };
    const cur = { w:{p:0,n:0,b:0,r:0,q:0}, b:{p:0,n:0,b:0,r:0,q:0} };
    for (const p of chessState.board) {
        if (p === '.') continue;
        const t = p.toLowerCase();
        if (t === 'k') continue;
        const side = _isWhite(p) ? 'w' : 'b';
        cur[side][t] = (cur[side][t] || 0) + 1;
    }
    const renderRow = (side, side2, totalKey) => {
        let html = '';
        let matVal = 0;
        for (const t of ['p','n','b','r','q']) {
            const lost = initial[t] - cur[side][t];
            for (let i = 0; i < lost; i++) {
                const sym = side === 'w' ? PIECE_UNICODE[t.toUpperCase()] : PIECE_UNICODE[t];
                html += `<span class="${side === 'w' ? 'text-slate-200' : 'text-slate-500'}">${sym}</span>`;
                matVal += PIECE_VAL[t];
            }
        }
        return { html, matVal };
    };
    // Captured by white = black pieces missing
    const byW = renderRow('b');
    const byB = renderRow('w');
    document.getElementById('chess-captured-by-w').innerHTML = byW.html;
    document.getElementById('chess-captured-by-b').innerHTML = byB.html;
    const diff = (byW.matVal - byB.matVal) / 100;
    document.getElementById('chess-material-w').textContent = diff > 0 ? `+${diff}` : '';
    document.getElementById('chess-material-b').textContent = diff < 0 ? `+${-diff}` : '';
}

function chessShowGameOver(status) {
    const el = document.getElementById('chess-gameover');
    el.style.display = 'flex';
    el.classList.add('flex');

    let title = 'Draw', msg = '', icon = 'fa-handshake', color = 'text-slate-300';
    let resultForElo = null; // 1 = win, 0 = loss, 0.5 = draw, null = no ELO change

    if (status.reason === 'checkmate') {
        const winner = chessState.turn === 'w' ? 'Black' : 'White';
        const youWon = chessBotLevel > 0
            ? ((winner === 'White' && chessHumanSide === 'w') ||
               (winner === 'Black' && chessHumanSide === 'b'))
            : null;
        title = `Checkmate — ${winner} wins`;
        msg = chessBotLevel > 0
            ? (youWon ? 'Well played! Try a stronger bot.' : 'Better luck next game.')
            : '';
        icon = 'fa-trophy';
        color = youWon === false ? 'text-red-400' : 'text-amber-400';
        if (chessBotLevel > 0 && youWon !== null) resultForElo = youWon ? 1 : 0;
    } else if (status.reason === 'resignation') {
        title = 'Resignation';
        msg = '';
        icon = 'fa-flag';
        color = 'text-red-400';
        if (chessBotLevel > 0) resultForElo = 0;
    } else {
        title = 'Draw';
        msg = `By ${status.reason}.`;
        if (chessBotLevel > 0) resultForElo = 0.5;
    }

    document.getElementById('chess-gameover-title').textContent = title;
    document.getElementById('chess-gameover-msg').textContent   = msg;
    const ic = document.getElementById('chess-gameover-icon');
    ic.className = `fas ${icon} text-3xl mb-2 ${color}`;

    // ── ELO update ────────────────────────────────────────────────
    const eloBox = document.getElementById('chess-gameover-elo');
    if (eloBox) {
        if (resultForElo !== null && chessBotLevel > 0) {
            const botInfo  = CHESS_BOTS[chessBotLevel] || { elo: 1200, name: `Bot ${chessBotLevel}` };
            const botElo   = botInfo.elo || 1200;
            const delta    = chessCalcElo(chessPlayerElo, botElo, resultForElo);
            const noGain   = resultForElo === 1 && delta === 0; // won but bot was too weak
            const oldElo   = chessPlayerElo;
            chessPlayerElo = Math.max(0, chessPlayerElo + delta);

            const resultStr = resultForElo === 1 ? 'win' : resultForElo === 0 ? 'loss' : 'draw';
            chessEloHistory.push({
                date:     new Date().toLocaleDateString(),
                delta,
                newElo:   chessPlayerElo,
                opponent: botInfo.name,
                result:   resultStr,
            });
            chessSaveElo();

            const deltaEl = document.getElementById('chess-gameover-elo-delta');
            const newEl   = document.getElementById('chess-gameover-elo-new');
            if (noGain) {
                if (deltaEl) { deltaEl.textContent = 'No gain'; deltaEl.style.color = '#94a3b8'; deltaEl.style.fontSize = '1rem'; }
                if (newEl)   newEl.textContent = `Opponent rated ${chessPlayerElo - botElo > 0 ? chessPlayerElo - botElo : ''}+ points below you`;
            } else {
                const sign     = delta >= 0 ? '+' : '';
                const deltaCol = delta > 0 ? '#4ade80' : delta < 0 ? '#f87171' : '#94a3b8';
                if (deltaEl) { deltaEl.textContent = `${sign}${delta}`; deltaEl.style.color = deltaCol; deltaEl.style.fontSize = ''; }
                if (newEl)   newEl.textContent = `Rating: ${oldElo} → ${chessPlayerElo} · ${_eloTitle(chessPlayerElo)}`;
            }

            eloBox.classList.remove('hidden');
            eloBox.style.display = 'flex';

            // Update sidebar ELO
            setTimeout(() => {
                chessRenderElo();
                const sidebarDelta = document.getElementById('chess-elo-delta');
                if (sidebarDelta && !noGain) {
                    const sign     = delta >= 0 ? '+' : '';
                    const deltaCol = delta > 0 ? '#4ade80' : delta < 0 ? '#f87171' : '#94a3b8';
                    sidebarDelta.textContent = `${sign}${delta}`;
                    sidebarDelta.style.color = deltaCol;
                }
            }, 350);
        } else {
            eloBox.classList.add('hidden');
            eloBox.style.display = 'none';
        }
    }

    // Sound
    if (typeof ChessSounds !== 'undefined') {
        setTimeout(() => {
            if (status.reason === 'checkmate') {
                const winner = chessState.turn === 'w' ? 'Black' : 'White';
                const youWon = chessBotLevel > 0
                    ? ((winner === 'White' && chessHumanSide === 'w') ||
                       (winner === 'Black' && chessHumanSide === 'b'))
                    : true;
                if (youWon) ChessSounds.gameWin(); else ChessSounds.gameLose();
            } else if (status.reason === 'resignation') {
                ChessSounds.gameLose();
            } else {
                ChessSounds.gameDraw();
            }
        }, 300);
    }
}

// ── Hint ──
function chessShowHint() {
    if (chessState.turn !== chessHumanSide && chessBotLevel > 0) return;
    const status = chessGameStatus(chessState);
    if (status.over) return;
    const r = chessSearchIterative(chessState, 5, 800);
    if (!r.move) return;
    chessSelected = r.move.from;
    chessLegalCache = chessLegalMoves(chessState).filter(m => m.from === r.move.from);
    chessRenderBoard();
    // Briefly flash the destination
    const board = document.getElementById('chess-board');
    if (board) {
        const sq = board.querySelector(`[data-idx="${r.move.to}"]`);
        if (sq) {
            sq.style.boxShadow = 'inset 0 0 0 5px #fbbf24';
            setTimeout(() => { sq.style.boxShadow = ''; }, 1400);
        }
    }
}

// ── Undo ──
function chessUndo() {
    if (chessBotBusy) return;
    // Undo two plies if playing a bot, one if human-vs-human
    const plies = (chessBotLevel > 0 && chessHistory.length >= 2 &&
                   chessHistory[chessHistory.length - 1].state.turn === chessHumanSide) ? 2 : 1;
    for (let i = 0; i < plies && chessHistory.length; i++) {
        const h = chessHistory.pop();
        chessState = h.state;
    }
    chessSelected = null;
    chessLegalCache = [];
    chessLastMove = chessHistory.length
        ? chessHistory[chessHistory.length - 1].move
        : null;
    document.getElementById('chess-gameover').style.display = 'none';
    chessRender();
}

function chessResign() {
    if (chessBotLevel === 0) {
        if (!confirm(`Resign? ${chessState.turn === 'w' ? 'White' : 'Black'} resigns.`)) return;
    } else {
        if (!confirm('Resign this game?')) return;
    }
    chessShowGameOver({ over:true, reason:'resignation',
        result: chessHumanSide === 'w' ? '0-1' : '1-0' });
    chessBotBusy = true; // disable further play
}

function chessFlipBoard() {
    chessOrientation = chessOrientation === 'w' ? 'b' : 'w';
    chessRender();
}

// ====================================================================
// PUZZLES — curated tactical positions
// ====================================================================
// ── Puzzles removed ───────────────────────────────────────────────────

function chessSwitchSubTab(name) {
    document.querySelectorAll('.chess-tab').forEach(b =>
        b.classList.toggle('active', b.dataset.chessTab === name));
    document.getElementById('chess-play-pane').style.display = name === 'play' ? 'flex' : 'none';
    document.getElementById('chess-learn-pane').style.display = name === 'learn' ? 'block' : 'none';
}

// ====================================================================
// Settings persistence (localStorage)
// ====================================================================
const CHESS_SETTINGS_KEY = 'vulsor_chess_settings';

function chessSaveSettings() {
    try {
        const psSel   = document.getElementById('chess-3d-pieceset');
        const bmSel   = document.getElementById('chess-3d-board');
        const ltSel   = document.getElementById('chess-3d-lighting');
        const camSel  = document.getElementById('chess-3d-camera');
        const lockChk = document.getElementById('chess-3d-lock');
        const glbInput= document.getElementById('chess-3d-glb-url');
        const botSel  = document.getElementById('chess-bot-level');
        const colorSel= document.getElementById('chess-player-color');
        localStorage.setItem(CHESS_SETTINGS_KEY, JSON.stringify({
            viewMode   : chessViewMode,
            theme      : chessTheme,
            variant    : chessVariant,
            botLevel   : botSel   ? botSel.value   : chessBotLevel,
            playerColor: colorSel ? colorSel.value : 'w',
            pieceset   : psSel    ? psSel.value    : 'classic',
            boardMat   : bmSel    ? bmSel.value    : 'walnut',
            lighting   : ltSel    ? ltSel.value    : 'studio',
            camera     : camSel   ? camSel.value   : 'player',
            camLocked  : lockChk  ? lockChk.checked : true,
            glbUrl     : glbInput ? glbInput.value  : '',
        }));
    } catch(e) { /* ignore storage errors */ }
}

function chessLoadSettings() {
    try {
        const raw = localStorage.getItem(CHESS_SETTINGS_KEY);
        if (!raw) return;
        const s = JSON.parse(raw);
        // Apply to module variables
        if (s.viewMode)    chessViewMode = s.viewMode;
        if (s.theme)       chessTheme    = s.theme;
        if (s.variant)     chessVariant  = s.variant;
        if (s.botLevel !== undefined) chessBotLevel = parseInt(s.botLevel, 10);
        if (s.playerColor) chessHumanSide = s.playerColor === 'r'
            ? (Math.random() < 0.5 ? 'w' : 'b')
            : s.playerColor;
        // Apply to DOM
        const set = (id, val) => { const el = document.getElementById(id); if (el && val !== undefined) el.value = val; };
        const setChk = (id, val) => { const el = document.getElementById(id); if (el && val !== undefined) el.checked = !!val; };
        set('chess-view-mode',    s.viewMode);
        set('chess-theme',        s.theme);
        set('chess-variant',      s.variant);
        set('chess-bot-level',    s.botLevel);
        set('chess-player-color', s.playerColor);
        set('chess-3d-pieceset',  s.pieceset);
        set('chess-3d-board',     s.boardMat);
        set('chess-3d-lighting',  s.lighting);
        set('chess-3d-camera',    s.camera);
        setChk('chess-3d-lock',   s.camLocked);
        set('chess-3d-glb-url',   s.glbUrl);
        // Update variant description
        const varDesc = document.getElementById('chess-variant-desc');
        if (varDesc && s.variant) varDesc.textContent = CHESS_VARIANT_INFO[s.variant] || '';
        // Show 3D controls if needed
        const c3d = document.getElementById('chess-3d-controls');
        if (c3d) c3d.style.display = chessViewMode === '3d' ? '' : 'none';
    } catch(e) { /* ignore */ }
}

// ====================================================================
// Init & external entry point
// ====================================================================
let _chessInited = false;
let _chessIsFullscreen = false;

function chessToggleFullscreen() {
    _chessIsFullscreen = !_chessIsFullscreen;
    const view   = document.getElementById('view-chess');
    const chrome = document.getElementById('browser-chrome');
    const icon   = document.getElementById('chess-fs-icon');
    if (_chessIsFullscreen) {
        if (view)   view.classList.add('chess-fullscreen');
        if (chrome) chrome.style.display = 'none';
        if (icon)   { icon.classList.remove('fa-expand'); icon.classList.add('fa-compress'); }
    } else {
        if (view)   view.classList.remove('chess-fullscreen');
        if (chrome) chrome.style.display = '';
        if (icon)   { icon.classList.remove('fa-compress'); icon.classList.add('fa-expand'); }
    }
    // Resize 3D if visible
    if (typeof chess3DResize === 'function') setTimeout(chess3DResize, 60);
}

// ESC to exit chess fullscreen
document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && _chessIsFullscreen) chessToggleFullscreen();
});

function renderChess() {
    if (!_chessInited) {
        chessInit();
        _chessInited = true;
        chessNewGame();
    }
    chessRender();
}

function chessInit() {
    // Restore persisted settings and ELO before wiring events
    chessLoadSettings();
    chessLoadElo();
    chessRenderElo();

    document.getElementById('chess-new-game').onclick = chessNewGame;
    document.getElementById('chess-undo').onclick     = chessUndo;
    document.getElementById('chess-hint').onclick     = chessShowHint;
    document.getElementById('chess-flip').onclick     = chessFlipBoard;
    document.getElementById('chess-resign').onclick   = chessResign;

    // ELO reset button
    const eloReset = document.getElementById('chess-elo-reset');
    if (eloReset) eloReset.onclick = () => {
        if (!confirm('Reset your rating to 1200?')) return;
        chessPlayerElo  = 1200;
        chessEloHistory = [];
        chessSaveElo();
        chessRenderElo();
    };

    // ELO history toggle
    const histToggle = document.getElementById('chess-elo-history-toggle');
    const histBox    = document.getElementById('chess-elo-history');
    if (histToggle && histBox) histToggle.onclick = () => {
        const visible = histBox.style.display !== 'none';
        histBox.style.display = visible ? 'none' : 'flex';
        histBox.style.flexDirection = 'column';
        histToggle.textContent = (visible ? '▸ ' : '▾ ') + 'History';
        if (!visible) chessRenderElo();
    };

    // Bot level
    const botSel = document.getElementById('chess-bot-level');
    if (botSel) botSel.onchange = () => {
        chessBotLevel = parseInt(botSel.value, 10);
        chessSaveSettings();
    };

    // Player color
    const colorSel = document.getElementById('chess-player-color');
    if (colorSel) colorSel.onchange = () => { chessSaveSettings(); };

    // View / theme / variant
    const viewSel = document.getElementById('chess-view-mode');
    if (viewSel) viewSel.onchange = () => {
        chessViewMode = viewSel.value;
        const c3d = document.getElementById('chess-3d-controls');
        if (c3d) c3d.style.display = chessViewMode === '3d' ? '' : 'none';
        chessSaveSettings();
        chessRender();
    };

    // 3D customization selects
    const psSel = document.getElementById('chess-3d-pieceset');
    if (psSel) psSel.onchange = () => {
        if (typeof chess3DSetPieceSet === 'function') chess3DSetPieceSet(psSel.value);
        chessSaveSettings();
    };
    const bmSel = document.getElementById('chess-3d-board');
    if (bmSel) bmSel.onchange = () => {
        if (typeof chess3DSetBoardMat === 'function') chess3DSetBoardMat(bmSel.value);
        chessSaveSettings();
    };
    const ltSel = document.getElementById('chess-3d-lighting');
    if (ltSel) ltSel.onchange = () => {
        if (typeof chess3DSetLighting === 'function') chess3DSetLighting(ltSel.value);
        chessSaveSettings();
    };
    const camSel = document.getElementById('chess-3d-camera');
    if (camSel) camSel.onchange = () => {
        if (typeof chess3DSetCameraPreset === 'function') chess3DSetCameraPreset(camSel.value);
        chessSaveSettings();
    };
    const lockChk = document.getElementById('chess-3d-lock');
    if (lockChk) lockChk.onchange = () => {
        if (typeof chess3DSetCameraLocked === 'function') chess3DSetCameraLocked(lockChk.checked);
        chessSaveSettings();
    };

    // Custom GLB chess set
    const glbInput = document.getElementById('chess-3d-glb-url');
    const glbLoad  = document.getElementById('chess-3d-glb-load');
    const glbClear = document.getElementById('chess-3d-glb-clear');
    if (glbLoad) glbLoad.onclick = () => {
        const url = glbInput.value.trim();
        if (!url) return;
        glbLoad.textContent = 'Loading…';
        glbLoad.disabled = true;
        if (typeof chess3DLoadGLB !== 'function') return;
        chess3DLoadGLB(url)
            .then(() => {
                glbLoad.textContent = '✓ Loaded';
                chessSaveSettings();
                setTimeout(() => glbLoad.textContent = 'Load', 1200);
            })
            .catch(err => {
                console.warn('GLB load failed:', err);
                glbLoad.textContent = 'Failed — see console';
                setTimeout(() => glbLoad.textContent = 'Load', 1800);
            })
            .finally(() => { glbLoad.disabled = false; });
    };
    if (glbClear) glbClear.onclick = () => {
        glbInput.value = '';
        if (typeof chess3DLoadGLB === 'function') chess3DLoadGLB('');
        chessSaveSettings();
    };
    const themeSel = document.getElementById('chess-theme');
    if (themeSel) themeSel.onchange = () => {
        chessTheme = themeSel.value;
        chessSaveSettings();
        chessRender();
    };
    const varSel = document.getElementById('chess-variant');
    const varDesc = document.getElementById('chess-variant-desc');
    if (varSel) varSel.onchange = () => {
        chessVariant = varSel.value;
        if (varDesc) varDesc.textContent = CHESS_VARIANT_INFO[chessVariant] || '';
        chessSaveSettings();
        // Variant change requires a new game with the new starting position
        chessNewGame();
    };
    document.getElementById('chess-gameover-new').onclick = () => {
        document.getElementById('chess-gameover').style.display = 'none';
        chessNewGame();
    };
    document.querySelectorAll('[data-promote]').forEach(b =>
        b.onclick = () => chessHandlePromotionChoice(b.dataset.promote));
    document.querySelectorAll('.chess-tab').forEach(b =>
        b.onclick = () => chessSwitchSubTab(b.dataset.chessTab));
}

// ====================================================================
// LEARN — interactive lessons + bot tutor
// ====================================================================
const CHESS_LESSONS = [
    {
        id:'pieces', title:'How pieces move', icon:'fa-chess-pawn',
        body:`
<h2 class="text-white font-bold text-lg mb-3">How the pieces move</h2>
<p class="mb-4 text-xs">Master these six movement patterns and you've already learned the alphabet of chess.</p>
<ul class="space-y-3 text-xs">
  <li class="flex gap-3"><span class="text-3xl text-slate-200">♙</span><div><b class="text-white">Pawn</b> — 1 square forward, or 2 from its starting rank. Captures only diagonally one square. Promotes to any piece (usually queen) on the 8th rank. Can capture <i>en passant</i> immediately after an enemy pawn double-jumps next to it.</div></li>
  <li class="flex gap-3"><span class="text-3xl text-slate-200">♘</span><div><b class="text-white">Knight</b> — L-shape: 2 in one direction + 1 perpendicular. The only piece that <b>jumps over</b> pieces. Great at forking targets that are far apart.</div></li>
  <li class="flex gap-3"><span class="text-3xl text-slate-200">♗</span><div><b class="text-white">Bishop</b> — any number of squares diagonally. A bishop stays on the same color forever.</div></li>
  <li class="flex gap-3"><span class="text-3xl text-slate-200">♖</span><div><b class="text-white">Rook</b> — any number of squares straight (file or rank). Loves open files.</div></li>
  <li class="flex gap-3"><span class="text-3xl text-slate-200">♕</span><div><b class="text-white">Queen</b> — combines rook + bishop. Strongest piece (9 points). Don't expose it too early — it gets chased around.</div></li>
  <li class="flex gap-3"><span class="text-3xl text-slate-200">♔</span><div><b class="text-white">King</b> — one square in any direction. Cannot move into check. Can <b>castle</b> with a rook: king moves 2 squares, rook jumps to its other side. Both must be unmoved, no pieces between, king not in/through/into check.</div></li>
</ul>
<p class="mt-4 text-[11px] text-slate-500">Piece values: ♙ 1 · ♘ 3 · ♗ 3 · ♖ 5 · ♕ 9. Use these to evaluate trades.</p>`
    },
    {
        id:'goal', title:'Goal of the game', icon:'fa-bullseye',
        body:`
<h2 class="text-white font-bold text-lg mb-3">How you win</h2>
<p class="text-xs mb-3">The whole game is about one thing: <b>checkmate</b>. That means your opponent's king is under attack <i>and</i> has no legal way to escape.</p>
<ul class="space-y-2 text-xs">
  <li>✓ <b>Check</b> — king is attacked. You <i>must</i> respond: block, capture the attacker, or move the king. Check is not the goal — checkmate is.</li>
  <li>✓ <b>Checkmate (#)</b> — king is in check and has no legal move. Game over.</li>
  <li>✓ <b>Stalemate</b> — it's your turn, you're <i>not</i> in check, but you have <i>no legal moves</i>. Draw. (Easy to miss when you're winning — be careful!)</li>
  <li>✓ <b>Draws</b> also happen by: 50-move rule, threefold repetition, insufficient material, or agreement.</li>
</ul>`
    },
    {
        id:'opening', title:'Opening principles', icon:'fa-rocket',
        body:`
<h2 class="text-white font-bold text-lg mb-3">The 5 opening rules</h2>
<ol class="list-decimal list-inside space-y-2 text-xs">
  <li><b>Fight for the center</b> — push <i>e4</i> or <i>d4</i>. Center pawns control the most squares and give your pieces room.</li>
  <li><b>Develop knights before bishops.</b> Knights have only 2 good squares (f3/c3 for white). Bishops can wait until you see where they belong.</li>
  <li><b>Castle within the first 10 moves.</b> A king in the center is a king in danger.</li>
  <li><b>Don't move the same piece twice</b> in the opening unless you must. Development = activity, and time matters.</li>
  <li><b>Don't bring the queen out early.</b> She'll be harassed by enemy minor pieces and lose tempo.</li>
</ol>
<div class="bg-slate-800/40 border border-slate-700/60 rounded-xl p-3 mt-4">
<b class="text-amber-300 text-xs">Try it:</b><br>
<span class="text-[11px]">Open with <i>1.e4 e5 2.Nf3 Nc6 3.Bc4 Bc5 4.O-O</i> — that's the Italian. You've grabbed the center, developed two minor pieces, and castled. Perfect classical play.</span>
</div>`
    },
    {
        id:'openings', title:'Common openings', icon:'fa-chess-rook',
        body:`
<h2 class="text-white font-bold text-lg mb-3">Five openings to know</h2>
<ul class="space-y-3 text-xs">
  <li><b class="text-amber-300">Italian Game</b> — <i>1.e4 e5 2.Nf3 Nc6 3.Bc4</i>. The classical attacking setup. Aims at f7. Easy to learn, hard to mishandle.</li>
  <li><b class="text-amber-300">Ruy López (Spanish)</b> — <i>1.e4 e5 2.Nf3 Nc6 3.Bb5</i>. Pins the knight defending e5. Deep strategic game — favored by world champions.</li>
  <li><b class="text-amber-300">Queen's Gambit</b> — <i>1.d4 d5 2.c4</i>. Offers a pawn for central dominance. Black usually declines with <i>e6</i> or accepts with <i>dxc4</i>.</li>
  <li><b class="text-amber-300">Sicilian Defense</b> — <i>1.e4 c5</i>. Sharpest answer to 1.e4 for Black. Asymmetric — both sides attack on opposite sides.</li>
  <li><b class="text-amber-300">French Defense</b> — <i>1.e4 e6</i>. Solid but cramped. Black builds a pawn chain and counters later.</li>
  <li><b class="text-amber-300">London System</b> — <i>1.d4, 2.Nf3, 3.Bf4</i>. Same setup against almost anything Black plays. Great for beginners.</li>
</ul>`
    },
    {
        id:'tactics', title:'Tactical patterns', icon:'fa-bolt',
        body:`
<h2 class="text-white font-bold text-lg mb-3">Tactics — winning material in 1–3 moves</h2>
<p class="text-xs mb-3">Tactics are short combinations that win material or deliver mate. Patterns repeat. Learn them.</p>
<ul class="space-y-3 text-xs">
  <li><b class="text-amber-300">Fork</b> — one piece attacks two. Knights are the kings of forks (royal fork = king + queen forked).</li>
  <li><b class="text-amber-300">Pin</b> — a piece can't move because something more valuable is behind it. Use bishops/rooks/queens.</li>
  <li><b class="text-amber-300">Skewer</b> — like a pin, but the more valuable piece is in front. It must move, exposing the weaker piece behind.</li>
  <li><b class="text-amber-300">Discovered attack</b> — move one piece and uncover an attack from another. Discovered <i>check</i> is brutal because the opponent must address the check, not your other threat.</li>
  <li><b class="text-amber-300">Double attack</b> — one move creates two threats. Opponent can only meet one.</li>
  <li><b class="text-amber-300">Removing the defender</b> — capture or chase away the piece that defends a target, then take the target.</li>
  <li><b class="text-amber-300">Back-rank mate</b> — opponent's king is trapped on its first rank by its own pawns. A rook or queen on the open file = mate.</li>
</ul>
<p class="mt-3 text-[11px] text-slate-500">Switch to the <b class="text-amber-300">Puzzles</b> tab and solve a few — recognition comes from repetition.</p>`
    },
    {
        id:'middlegame', title:'Middlegame ideas', icon:'fa-chess-queen',
        body:`
<h2 class="text-white font-bold text-lg mb-3">After the opening — now what?</h2>
<ol class="list-decimal list-inside space-y-2 text-xs">
  <li><b>Have a plan.</b> The plan often comes from the pawn structure: weak pawns to attack, open files to seize, color complexes to exploit.</li>
  <li><b>Improve your worst piece.</b> If your light-squared bishop is stuck behind pawns, reroute it. A piece that does nothing is a piece you don't have.</li>
  <li><b>Control open files with rooks.</b> Doubled rooks on the 7th rank ("pigs on the 7th") are usually decisive.</li>
  <li><b>Trade when ahead in material.</b> Avoid trades when behind — you need pieces on the board to create complications.</li>
  <li><b>Attack the king when you have more attackers than the defender has defenders.</b></li>
  <li><b>Prophylaxis</b> — ask "what does my opponent want?" and prevent it before doing your own thing.</li>
</ol>`
    },
    {
        id:'endgame', title:'Endgame basics', icon:'fa-flag-checkered',
        body:`
<h2 class="text-white font-bold text-lg mb-3">Endgame essentials</h2>
<p class="text-xs mb-3">When few pieces remain, the king becomes a strong attacker. Use it.</p>
<ul class="space-y-2 text-xs">
  <li><b class="text-amber-300">King + Queen vs King</b> — push the enemy king to the edge with your queen, then march your own king up to deliver mate. Avoid stalemate!</li>
  <li><b class="text-amber-300">King + Rook vs King</b> — same idea, but you need both pieces working together. The rook cuts the king off; your king escorts.</li>
  <li><b class="text-amber-300">Pawn endings</b> — the <b>opposition</b> (kings facing each other one square apart) decides everything. Whoever has to move first loses the opposition.</li>
  <li><b class="text-amber-300">Passed pawn</b> — a pawn with no enemy pawn on its file or adjacent files. Push it. Promote it. Win.</li>
  <li><b class="text-amber-300">Rule of the square</b> — to see if your king can catch a passed pawn, draw a square from the pawn to its promotion rank. If your king is in the square, you stop it.</li>
</ul>`
    },
    {
        id:'mistakes', title:'Common mistakes', icon:'fa-exclamation-triangle',
        body:`
<h2 class="text-white font-bold text-lg mb-3">10 mistakes beginners keep making</h2>
<ol class="list-decimal list-inside space-y-1.5 text-xs">
  <li>Moving pawns instead of developing pieces.</li>
  <li>Bringing the queen out on move 2 or 3 (Scholar's Mate seekers).</li>
  <li>Forgetting to castle.</li>
  <li>Hanging pieces — leaving them undefended where they can be captured for free.</li>
  <li>Not asking "what is my opponent attacking?" before moving.</li>
  <li>Playing fast in losing positions (slow down — find resources).</li>
  <li>Trading when ahead is fine; trading when behind makes losing easier.</li>
  <li>Trying to mate the king before you control the center.</li>
  <li>Pushing pawns in front of your castled king (creates fatal weaknesses).</li>
  <li>Resigning too early — players blunder, even at high level.</li>
</ol>`
    },
    {
        id:'thinking', title:'A thinking routine', icon:'fa-brain',
        body:`
<h2 class="text-white font-bold text-lg mb-3">What to think about each move</h2>
<p class="text-xs mb-3">Every move, run this checklist. Slow down — it's worth 200 rating points.</p>
<ol class="list-decimal list-inside space-y-2 text-xs">
  <li><b>What did my opponent just threaten?</b> Look at every piece they touched, where it now points.</li>
  <li><b>Are any of my pieces hanging?</b> Or attacked more times than they're defended?</li>
  <li><b>Look for forcing moves</b> — Checks, Captures, Threats — for both sides. (CCT.)</li>
  <li><b>What's my plan?</b> Improve a piece, seize a file, attack a weakness, restrict the king.</li>
  <li><b>Calculate concrete lines</b> for the candidate moves. "If I play X, they play Y, I play Z…"</li>
  <li><b>Blunder-check</b> your move before you commit. What's the opponent's <i>best</i> reply?</li>
</ol>`
    },
];

let chessLessonCurrent = 'pieces';

function chessRenderLessonList() {
    const wrap = document.getElementById('chess-lesson-list');
    if (!wrap) return;
    wrap.innerHTML = '';
    CHESS_LESSONS.forEach(L => {
        const b = document.createElement('div');
        b.className = 'chess-lesson-btn' + (L.id === chessLessonCurrent ? ' active' : '');
        b.innerHTML = `<i class="fas ${L.icon} lesson-icon"></i><span class="flex-1 truncate">${L.title}</span>`;
        b.onclick = () => { chessLessonCurrent = L.id; chessRenderLesson(); };
        wrap.appendChild(b);
    });
}
function chessRenderLesson() {
    chessRenderLessonList();
    const L = CHESS_LESSONS.find(x => x.id === chessLessonCurrent) || CHESS_LESSONS[0];
    document.getElementById('chess-lesson-content').innerHTML = L.body;
}

// ── Bot tutor: pattern-matched chess advice ──
// Each entry: regex of trigger keywords, then a markdown-ish reply.
const CHESS_TUTOR_KB = [
    { re:/\b(hi|hello|hey|sup|hola|yo)\b/i,
      reply:`Hi! I'm your chess tutor. Ask me anything — "what's a <b>fork</b>?", "when should I <b>castle</b>?", "how do I win a <b>K+Q endgame</b>?", "best opening for beginners?" — I've got you.` },

    { re:/\b(castl(e|ing)|o-?o|king safety)\b/i,
      reply:`<b>Castling</b> is two moves in one: king jumps 2 squares toward a rook, the rook hops over to the other side. Use it to tuck your king behind pawns.<br><br>Requirements: neither piece has moved, no pieces between them, king isn't in / passing through / landing in check.<br><br><b>When?</b> Within the first 10 moves usually. The exception: if you can sense an attack brewing on the kingside, castle queenside or stay in the center for a beat.` },

    { re:/\b(fork)\b/i,
      reply:`A <b>fork</b> is one piece attacking two enemy pieces at once. The opponent can only save one. Classic example: a knight on e5 attacking the queen on d7 <i>and</i> the rook on f7. You'll grab the rook next move.<br><br>Knights fork best because they hit pieces of every color in a wide pattern. Pawns fork by attacking diagonally. Always ask: "can my next move attack two things?"` },

    { re:/\b(pin)\b/i,
      reply:`A <b>pin</b> is when a piece can't move because something more valuable is behind it. Example: your bishop on g5 pins a knight on f6 against the queen on d8 — if the knight moves, you take the queen.<br><br><b>Absolute pin</b> = behind it is the king (the pinned piece <i>cannot legally</i> move). <b>Relative pin</b> = behind it is something valuable but legal to expose. Always pile up attacks on a pinned piece — it can't run.` },

    { re:/\b(skewer)\b/i,
      reply:`A <b>skewer</b> is the reverse of a pin: the <i>valuable</i> piece is in front. It must move, exposing the weaker piece behind. Often deadly with king + queen on the same line — check the king, win the queen.` },

    { re:/\b(discover(ed)?( attack|check)?)\b/i,
      reply:`A <b>discovered attack</b> happens when you move one piece and uncover an attack from another piece behind it. <b>Discovered check</b> is the nastiest: the opponent <i>must</i> deal with the check, so the moving piece is free to do whatever — capture, fork, anything.` },

    { re:/\b(open(ing)?s?|first moves?|best (start|opening))\b/i,
      reply:`For a beginner, start with <b>1.e4</b> as White. Then aim for the <b>Italian Game</b>: <i>1.e4 e5 2.Nf3 Nc6 3.Bc4</i>. Easy plan: develop, castle, look for tactics on f7.<br><br>As Black:<br>• vs 1.e4 → play <i>1...e5</i> for classical play, or <i>1...c5</i> (Sicilian) if you like sharp games.<br>• vs 1.d4 → <i>1...d5 2...e6</i> (Queen's Gambit Declined) is rock solid.<br><br>Pick <b>one</b> opening for each color and play it until you know it. Variety comes later.` },

    { re:/\b(center|control(ling)? the center|d4|e4)\b/i,
      reply:`The <b>center</b> (e4, d4, e5, d5) is the most valuable real estate. Pieces in the center attack more squares, can switch flanks faster, and control the game.<br><br>Push <b>e4</b> or <b>d4</b> on move 1. Don't let your opponent get both. If they take e5 and d5 with pawns, your pieces will be cramped.` },

    { re:/\b(develop(ment)?|pieces out)\b/i,
      reply:`<b>Development</b> = bringing your pieces from their starting squares to active ones. Order:<br>1. Knights first (f3/c3) — they have fewer good squares.<br>2. Bishops next (c4/f4, or on long diagonals).<br>3. Castle.<br>4. Connect rooks (move the queen so rooks see each other on the back rank).<br><br>Each piece, one move, in the first 6–8 moves. No piece moves twice unless attacked.` },

    { re:/\b(check ?mate|mate(d)?|win( the)? game)\b/i,
      reply:`<b>Checkmate</b> = king is attacked + has no legal escape. To deliver mate you usually need (a) the enemy king trapped or restricted, and (b) at least one attacker that <i>can't be captured or blocked</i>.<br><br>Common patterns: <b>back-rank mate</b> (rook on the 8th vs king trapped by own pawns), <b>scholar's mate</b> (queen + bishop on f7), <b>smothered mate</b> (knight, king blocked by own pieces).` },

    { re:/\b(stale ?mate)\b/i,
      reply:`<b>Stalemate</b> is a <i>draw</i>: it's your turn, you're <b>not</b> in check, but you have <b>no legal moves</b>. Painful when you're winning! When ahead in material, always give the opponent a move. The biggest stalemate trap is K+Q vs K — leave the enemy king a square to step to.` },

    { re:/\b(en ?passant)\b/i,
      reply:`<b>En passant</b> ("in passing"): when an enemy pawn double-jumps and lands next to your pawn, you can capture it diagonally — <i>on the very next move only</i>. It's as if the pawn moved one square. Easy to forget; great to spot.` },

    { re:/\b(promot(e|ion)|queen(ing)?|8th rank)\b/i,
      reply:`When a pawn reaches the 8th rank (1st for Black), it <b>promotes</b> to any piece you want — queen, rook, bishop, or knight (never king/pawn). Almost always queen. Occasionally underpromote to a knight to deliver a fork (e.g. forking king + queen).` },

    { re:/\b(piece values?|points?|how much is a (pawn|knight|bishop|rook|queen))\b/i,
      reply:`Standard values:<br>♙ Pawn = <b>1</b><br>♘ Knight = <b>3</b><br>♗ Bishop = <b>3</b> (slight edge over knight in open positions)<br>♖ Rook = <b>5</b><br>♕ Queen = <b>9</b><br>♔ King = priceless (losing it = losing)<br><br>Trades: knight for bishop = roughly equal. Two minor pieces (6) for a rook + pawn (6) is even on paper but the two pieces are usually stronger in the middlegame.` },

    { re:/\b(end ?game|ending|few pieces)\b/i,
      reply:`In the <b>endgame</b>, the king becomes a fighting piece — bring it forward. Master these first:<br>1. K+Q vs K (push enemy king to edge, support with own king).<br>2. K+R vs K (cut off file, escort with king).<br>3. King + pawn vs king — learn the <b>opposition</b> and the <b>square of the pawn</b>.<br>4. Two rooks vs king (very easy — "ladder mate").<br><br>Passed pawns become enormously valuable. A passed pawn on the 7th rank is worth a piece.` },

    { re:/\b(opposition)\b/i,
      reply:`<b>Opposition</b> = two kings facing each other on the same line, an odd number of squares apart (usually 1 square). Whoever has to move first <i>loses</i> the opposition — they have to step aside. Critical in pawn endings: getting opposition in front of your passed pawn = you queen.` },

    { re:/\b(passed pawn)\b/i,
      reply:`A <b>passed pawn</b> has no enemy pawn on its file or adjacent files — nothing can stop it from promoting except enemy pieces. Push it. Protect it. Promote it. As Aron Nimzowitsch said: <i>"the passed pawn is a criminal that must be kept under lock and key."</i>` },

    { re:/\b(blunder|hang(ed|ing)?|free piece)\b/i,
      reply:`Blunders almost always come from <b>not asking what the opponent threatens</b>. Before every move:<br>1. What did they just attack?<br>2. Are any of my pieces undefended?<br>3. Is my king safe (any checks possible)?<br>4. After my move, what's their best reply?<br><br>Even fast games allow 5 seconds for a blunder-check. Use them.` },

    { re:/\b(time|clock|fast|blitz|bullet)\b/i,
      reply:`Time pressure causes 90% of blunders. Beginners should play <b>longer time controls</b> (15+10 or 30+0) so you can practice the thinking routine. Blitz is fun but bakes in bad habits if it's all you play.` },

    { re:/\b(study|improve|get better|rating up|practice)\b/i,
      reply:`Fastest path to improvement:<br>1. <b>Tactics puzzles every day.</b> 15 minutes. Pattern recognition is everything below 1800.<br>2. <b>Play slow games</b> (15+10 or longer) and review them — find your last mistake, then the one before it.<br>3. <b>Learn 1 opening for each color</b> and stick with it for 3 months.<br>4. <b>Endgames</b> — K+Q vs K, K+R vs K, K+P vs K. Memorize these. They decide tournament games.<br>5. Watch a strong player explain their thinking. Don't memorize their moves — copy their <i>process</i>.` },

    { re:/\b(notation|algebraic|SAN|read moves)\b/i,
      reply:`<b>Algebraic notation</b> labels each square with a file (a–h) and rank (1–8). Pieces use a letter (N=knight, B=bishop, R=rook, Q=queen, K=king; pawns have no letter). Examples:<br>• <i>e4</i> = pawn to e4<br>• <i>Nf3</i> = knight to f3<br>• <i>Bxe5</i> = bishop captures on e5<br>• <i>O-O</i> = kingside castle, <i>O-O-O</i> = queenside<br>• <i>+</i> after a move = check, <i>#</i> = checkmate<br>• <i>=Q</i> = promotes to queen` },

    { re:/\b(rook|open file|7th rank)\b/i,
      reply:`Rooks belong on <b>open files</b> (no pawns) or <b>semi-open files</b> (no friendly pawns). Doubled rooks on a file are crushing. Two rooks on the 7th rank ("pigs on the 7th") usually win — they restrict the enemy king and gobble pawns.` },

    { re:/\b(knight|out ?post)\b/i,
      reply:`Knights are short-range but tricky. They love <b>outposts</b> — squares deep in enemy territory that can't be challenged by an enemy pawn. A knight on d6 or e6 in front of the enemy queenside pawns can paralyze the position. "A knight on the rim is dim" — keep them centralized.` },

    { re:/\b(bishop|bishop pair|fianchetto)\b/i,
      reply:`Bishops are long-range, especially in open positions. The <b>bishop pair</b> (both bishops) is worth a small bonus (~½ pawn) — they cover all colors together. <b>Fianchetto</b> = playing a bishop to b2 (g7 etc), aiming along the long diagonal. Classic in the Catalan, King's Indian, English openings.` },

    { re:/\b(queen)\b/i,
      reply:`The queen is your most powerful piece (9 points) but also the most vulnerable to attack. <b>Don't develop her early</b> — minor pieces will chase her and you'll waste moves. Bring her out around move 8–12 once minor pieces are developed and you've castled.` },

    { re:/\b(king|king ?safety)\b/i,
      reply:`King safety = #1 priority. <b>Castle early</b>, then leave the pawns in front of your king alone (no h3 or g4 without a concrete reason). Watch out for opponents lifting rooks to the 3rd rank or trading off your defender pieces — those are usually attack signals.` },

    { re:/\b(pawn (structure|chain|island))\b/i,
      reply:`Pawn structure is the skeleton of the position. Things to know:<br>• <b>Isolated pawn</b> — no friendly pawns on adjacent files. Often weak.<br>• <b>Doubled pawns</b> — two on the same file. Slightly weak unless they control key squares.<br>• <b>Backward pawn</b> — can't be defended by a fellow pawn and can't safely advance. Target it.<br>• <b>Pawn chain</b> — diagonal pawn fence (e.g. b2-c3-d4-e5). Attack the base, not the head.<br>• <b>Pawn islands</b> — groups of connected pawns. Fewer islands = stronger structure.` },

    { re:/\b(plan|strategy|positional)\b/i,
      reply:`A <b>plan</b> in chess comes from the pawn structure. Ask:<br>1. Where is each side's pawn weakness?<br>2. Which side has more space — and where?<br>3. Where is the enemy king, and can I get to it?<br>4. Which of my pieces is worst, and how do I improve it?<br><br>Make a 2–3 move plan, execute it, then reassess. <i>"A bad plan is better than no plan."</i> — Tartakower.` },

    { re:/\b(scholars? ?mate|four ?move ?mate)\b/i,
      reply:`<b>Scholar's Mate</b>: 1.e4 e5 2.Bc4 Nc6 3.Qh5 Nf6?? 4.Qxf7# — queen + bishop mate on f7. Defense is easy: play <i>3...g6</i> (kicks the queen) or <i>3...Qe7</i> defending f7. Don't fear it.` },

    { re:/\b(book|video|app|chesscom|chess24|lichess|recommend)\b/i,
      reply:`Free + brilliant: <b>Lichess.org</b> (puzzles, lessons, opening explorer, all free). Chess.com is great too. Books: "Logical Chess Move by Move" (Chernev) for absolute beginners; "My System" (Nimzowitsch) once you hit 1500.<br><br>Right here in this app: switch to <b>Puzzles</b> for tactics, and pick a bot one level above your current strength to keep improving.` },

    { re:/\b(thank|thanks|thx|good (bot|tutor)|nice)\b/i,
      reply:`You're welcome! Play a game with the bot at Easy or Medium and use <b>Hint</b> if you get stuck. The fastest improvement comes from playing slowly and analyzing your losses.` },
];

function chessTutorAnswer(query) {
    const q = query.trim();
    if (!q) return null;
    // Find first matching rule
    for (const rule of CHESS_TUTOR_KB) {
        if (rule.re.test(q)) return rule.reply;
    }
    // Try fuzzy fallback by lesson title
    const ql = q.toLowerCase();
    const hit = CHESS_LESSONS.find(L =>
        L.title.toLowerCase().split(/\s+/).some(w => w.length > 3 && ql.includes(w)));
    if (hit) {
        return `Great question — that's covered in the <b>${hit.title}</b> lesson on the left. Click it for a deep dive, then come back if you want to drill into something specific.`;
    }
    return `Hmm, I don't have a canned answer for that one. Try keywords like <i>fork, pin, castle, opening, endgame, opposition, blunder, plan, knight outpost, pawn structure</i>, or open a lesson on the left.`;
}

function chessTutorPush(role, text) {
    const wrap = document.getElementById('chess-tutor-chat');
    if (!wrap) return;
    const bub = document.createElement('div');
    bub.className = 'chess-tutor-bubble ' + role;
    bub.innerHTML = text;
    wrap.appendChild(bub);
    wrap.scrollTop = wrap.scrollHeight;
}

function chessTutorAsk() {
    const inp = document.getElementById('chess-tutor-input');
    if (!inp) return;
    const q = inp.value.trim();
    if (!q) return;
    inp.value = '';
    chessTutorPush('user', q.replace(/</g,'&lt;'));
    // Tiny "thinking" delay for natural feel
    setTimeout(() => {
        const a = chessTutorAnswer(q) || 'Sorry, no idea on that one.';
        chessTutorPush('bot', a);
    }, 220);
}

// Hook Learn-tab init into existing chessInit. Patch it by wrapping.
// Reassigning the declaration is deliberate: chess.js owns chessInit and this is
// the last statement to touch it, so every later caller gets the wrapped version.
const _origChessInit = chessInit;
// eslint-disable-next-line no-func-assign
chessInit = function() {
    _origChessInit();
    chessRenderLesson();
    chessTutorPush('bot', `Hey! I'm your chess tutor. Pick a lesson on the left, or ask me anything — try <i>"explain a fork"</i>, <i>"best opening for beginners"</i>, or <i>"when should I castle?"</i>.`);

    document.getElementById('chess-tutor-send').onclick = chessTutorAsk;
    document.getElementById('chess-tutor-input').addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); chessTutorAsk(); }
    });
    document.getElementById('chess-tutor-clear').onclick = () => {
        document.getElementById('chess-tutor-chat').innerHTML = '';
        chessTutorPush('bot', `Cleared. What do you want to learn next?`);
    };
};
