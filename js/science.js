// ── Science Tools — Molecule Builder, Periodic Table, DNA/RNA, Anatomy ──
// Depends on: globals.js (fs, path, VAULT_DIR), vault.js (vaultData, saveVaultData)

// ====================================================================
// Shared persistence helper
// ====================================================================
function _sciReadFile(file) {
    try {
        const p = path.join(VAULT_DIR, file.storedName);
        if (!fs.existsSync(p)) return null;
        return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch (_) { return null; }
}
function _sciWriteFile(file, data) {
    const p = path.join(VAULT_DIR, file.storedName);
    const json = JSON.stringify(data);
    fs.writeFileSync(p, json);
    file.size      = Buffer.byteLength(json, 'utf8');
    file.updatedAt = Date.now();
    saveVaultData();
}

// Generic file factory
function _sciCreateFile(label, flagKey, ext, initial) {
    try {
        const id         = 'vf_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
        const storedName = id + ext;
        fs.writeFileSync(path.join(VAULT_DIR, storedName), JSON.stringify(initial));
        const file = {
            id, originalName: label, storedName,
            folderId: vaultActiveFolderId,
            notes: '', pageNotes: {}, addedAt: Date.now(), size: 0,
        };
        file[flagKey] = true;
        vaultData.files.unshift(file);
        saveVaultData();
        renderVaultFolders();
        renderVaultGrid();

        // ── Direct viewer switch ──────────────────────────────────
        // Reset all editor flags and hide all areas
        vaultIsMolecule = vaultIsPeriodic = vaultIsDna = false;
        vaultIsAnatomy = vaultIsChessStrategy = false;
        vaultIsDoc = vaultIsCode = vaultIsNotebook = false;
        ['vault-doc-editor-area','vault-doc-toolbar-row','vault-doc-footer',
         'vault-code-area','vault-code-toolbar-row',
         'vault-notebook-area','vault-notebook-toolbar-row',
         'vault-molecule-area','vault-periodic-area','vault-dna-area',
         'vault-anatomy-area','vault-chessstrategy-area'].forEach(elId => {
            const el = document.getElementById(elId);
            if (el) el.style.display = 'none';
        });

        // Switch from grid to viewer
        document.getElementById('vault-grid-view').style.display   = 'none';
        document.getElementById('vault-viewer-view').style.display = 'flex';

        // Set the open file id and update UI
        vaultOpenFileId = id;
        const { icon, color } = vaultIcon(file.originalName, false, false, false, file);
        const iconEl = document.getElementById('vault-viewer-icon');
        if (iconEl) { iconEl.className = `fas ${icon} text-sm shrink-0`; iconEl.style.color = color; }
        const titleEl = document.getElementById('vault-viewer-title');
        if (titleEl) titleEl.textContent = label;
        renderVaultFolders();

        // Open the correct science tool editor
        if      (flagKey === 'isMolecule')      { vaultIsMolecule = true;      openVaultMoleculeEditor(file); }
        else if (flagKey === 'isPeriodic')       { vaultIsPeriodic = true;      openVaultPeriodicEditor(file); }
        else if (flagKey === 'isDna')            { vaultIsDna = true;           openVaultDNAEditor(file); }
        else if (flagKey === 'isAnatomy')        { vaultIsAnatomy = true;       openVaultAnatomyEditor(file); }
        else if (flagKey === 'isChessStrategy')  { vaultIsChessStrategy = true; openVaultChessStrategyEditor(file); }

    } catch(e) {
        console.error('[_sciCreateFile] error:', e);
        alert('Error opening ' + label + ': ' + e.message);
    }
}

// ====================================================================
// 1. MOLECULE BUILDER
// ====================================================================
// CPK colors for the well-known common elements; other elements fall back
// to a category color derived from PT_ELEMENTS.
const CPK_COLORS = {
    H:'#f8fafc', He:'#06b6d4',
    Li:'#a78bfa', Be:'#15803d', B:'#f4a09c', C:'#1e293b', N:'#2563eb', O:'#dc2626',
    F:'#a3e635', Ne:'#06b6d4',
    Na:'#a78bfa', Mg:'#15803d', Al:'#94a3b8', Si:'#fbbf24', P:'#ea580c', S:'#ca8a04',
    Cl:'#22c55e', Ar:'#06b6d4',
    K:'#a78bfa', Ca:'#15803d',
    Fe:'#ea580c', Cu:'#b45309', Zn:'#6b7280', Br:'#92400e', I:'#7c3aed',
    Au:'#fbbf24', Ag:'#cbd5e1', Pt:'#cbd5e1', Hg:'#94a3b8', Pb:'#475569', U:'#84cc16',
};
const MOL_CAT_COLORS = {
    alkali:'#a78bfa', alkaline:'#15803d', transition:'#f59e0b',
    post:'#94a3b8',   metalloid:'#34d399', nonmetal:'#67e8f9',
    halogen:'#22c55e', noble:'#06b6d4',
    lanthanide:'#f9a8d4', actinide:'#f0abfc',
};
// Build the full 118-element palette from PT_ELEMENTS (defined further below).
// Wrapped in a getter so it works regardless of declaration order.
function molAllElements() {
    return PT_ELEMENTS.map(([sym, name, z, , , mass, cat]) => ({
        sym, name, z, mass,
        color: CPK_COLORS[sym] || MOL_CAT_COLORS[cat] || '#94a3b8',
        cat,
    }));
}

let molState = {
    atoms: [],          // { id, el, x, y }
    bonds: [],          // { a, b, order }
    nextId: 1,
    tool: 'atom',
    element: 'C',
    bondOrder: 1,
    pendingBond: null,  // atom id awaiting partner
    dpr: 1,
    search: '',         // element-palette search query
};
let molCurrentFile = null;
let molSaveTimer = null;

function molElementInfo(sym) {
    const all = molAllElements();
    return all.find(e => e.sym === sym) || all.find(e => e.sym === 'C');
}

// ── Valence rules ────────────────────────────────────────────────────────────
// Typical covalent valence (max total bond order) for each element.
// null = no restriction (rare/transition metals with variable valence).
const MOL_VALENCE = {
    H:1,  He:0,
    Li:1, Be:2, B:3,  C:4,  N:3,  O:2,  F:1,  Ne:0,
    Na:1, Mg:2, Al:3, Si:4, P:3,  S:2,  Cl:1, Ar:0,
    K:1,  Ca:2,
    Ga:3, Ge:4, As:3, Se:2, Br:1, Kr:0,
    Rb:1, Sr:2,
    In:3, Sn:4, Sb:3, Te:2, I:1,  Xe:0,
    Cs:1, Ba:2,
    Tl:3, Pb:4, Bi:3, Po:2, At:1, Rn:0,
    // Transition metals / lanthanides / actinides — no hard restriction (null)
};

function molUsedValence(atomId) {
    return molState.bonds
        .filter(b => b.a === atomId || b.b === atomId)
        .reduce((sum, b) => sum + b.order, 0);
}

function molFreeValence(atomId) {
    const atom = molState.atoms.find(a => a.id === atomId);
    if (!atom) return 0;
    const max = MOL_VALENCE[atom.el];
    if (max == null) return Infinity; // no restriction
    return Math.max(0, max - molUsedValence(atomId));
}

// Flash a brief warning on the canvas (shown for 800 ms)
let _molValenceWarnTimer = null;
let _molValenceWarnMsg   = '';
function _molShowValenceWarning(msg) {
    _molValenceWarnMsg = msg;
    clearTimeout(_molValenceWarnTimer);
    _molValenceWarnTimer = setTimeout(() => {
        _molValenceWarnMsg = '';
        molRedraw();
    }, 1200);
    molRedraw();
}

function molRenderPalette() {
    const wrap = document.getElementById('mol-element-palette');
    if (!wrap) return;
    const q = (molState.search || '').trim().toLowerCase();
    const all = molAllElements();
    const filtered = q
        ? all.filter(e => e.sym.toLowerCase().includes(q)
                       || e.name.toLowerCase().includes(q)
                       || String(e.z) === q)
        : all;
    wrap.innerHTML = '';
    filtered.forEach(el => {
        const b = document.createElement('div');
        b.className = 'mol-el-btn' + (molState.element === el.sym ? ' active' : '');
        // Show colored background so users can recognise CPK colors
        const fg = (el.color === '#f8fafc' || el.color === '#a3e635' || el.color === '#fbbf24' ||
                    el.color === '#67e8f9' || el.color === '#06b6d4' || el.color === '#cbd5e1')
                   ? '#0f172a' : '#ffffff';
        b.style.background = el.color;
        b.style.color      = fg;
        b.style.borderColor= 'rgba(255,255,255,0.15)';
        b.textContent = el.sym;
        b.title = `${el.z}. ${el.name} (${el.mass})`;
        b.onclick = () => {
            molState.element = el.sym;
            const cur = document.getElementById('mol-current-element');
            if (cur) { cur.textContent = el.sym; cur.style.background = el.color; cur.style.color = fg; }
            molRenderPalette();
        };
        wrap.appendChild(b);
    });

    // Sync the "Selected:" chip to whatever element is active
    const cur = document.getElementById('mol-current-element');
    if (cur) {
        const sel = molElementInfo(molState.element);
        const fg = (sel.color === '#f8fafc' || sel.color === '#a3e635' || sel.color === '#fbbf24' ||
                    sel.color === '#67e8f9' || sel.color === '#06b6d4' || sel.color === '#cbd5e1')
                   ? '#0f172a' : '#ffffff';
        cur.textContent = sel.sym;
        cur.style.background = sel.color;
        cur.style.color = fg;
    }
}

function molRedraw() {
    const canvas = document.getElementById('mol-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) {
        canvas.width  = rect.width  * dpr;
        canvas.height = rect.height * dpr;
    }
    molState.dpr = dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);

    // Bonds
    molState.bonds.forEach(b => {
        const a1 = molState.atoms.find(a => a.id === b.a);
        const a2 = molState.atoms.find(a => a.id === b.b);
        if (!a1 || !a2) return;
        const dx = a2.x - a1.x, dy = a2.y - a1.y;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len, uy = dy / len;
        const px = -uy, py = ux; // perpendicular
        const offsetStep = 5;
        const r = 16; // gap so bonds don't overlap circle
        const sx = a1.x + ux * r, sy = a1.y + uy * r;
        const ex = a2.x - ux * r, ey = a2.y - uy * r;
        ctx.strokeStyle = '#cbd5e1';
        ctx.lineWidth = 1.8;
        const lines = b.order;
        for (let i = 0; i < lines; i++) {
            const o = (i - (lines - 1) / 2) * offsetStep;
            ctx.beginPath();
            ctx.moveTo(sx + px * o, sy + py * o);
            ctx.lineTo(ex + px * o, ey + py * o);
            ctx.stroke();
        }
    });

    // Atoms
    molState.atoms.forEach(a => {
        const info = molElementInfo(a.el);
        const isPending = molState.pendingBond === a.id;
        const maxVal = MOL_VALENCE[a.el];
        const isSaturated = maxVal != null && molUsedValence(a.id) >= maxVal;
        ctx.beginPath();
        ctx.arc(a.x, a.y, 14, 0, Math.PI * 2);
        ctx.fillStyle = info.color;
        ctx.fill();
        if (isPending) {
            ctx.lineWidth = 3;
            ctx.strokeStyle = '#10b981';
        } else if (isSaturated) {
            ctx.lineWidth = 2.5;
            ctx.strokeStyle = '#ef4444'; // red ring = full valence
        } else {
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = 'rgba(255,255,255,0.4)';
        }
        ctx.stroke();
        // Element symbol
        ctx.fillStyle = (info.color === '#f8fafc' || info.color === '#a3e635') ? '#0f172a' : '#fff';
        ctx.font = 'bold 12px -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(a.el, a.x, a.y);
        // Small free-valence badge (top-right of atom), hidden when 0 or no restriction
        if (maxVal != null && !isSaturated) {
            const free = maxVal - molUsedValence(a.id);
            ctx.fillStyle = 'rgba(15,23,42,0.75)';
            ctx.beginPath();
            ctx.arc(a.x + 10, a.y - 10, 7, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#94a3b8';
            ctx.font = 'bold 8px -apple-system, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(free, a.x + 10, a.y - 10);
        }
    });

    // Valence warning overlay
    if (_molValenceWarnMsg) {
        const pw = rect.width, ph = rect.height;
        ctx.save();
        ctx.fillStyle = 'rgba(239,68,68,0.92)';
        const bw = Math.min(320, pw - 32), bh = 38;
        const bx = (pw - bw) / 2, by = ph - bh - 16;
        const r2 = 8;
        ctx.beginPath();
        ctx.moveTo(bx + r2, by);
        ctx.lineTo(bx + bw - r2, by);
        ctx.quadraticCurveTo(bx + bw, by, bx + bw, by + r2);
        ctx.lineTo(bx + bw, by + bh - r2);
        ctx.quadraticCurveTo(bx + bw, by + bh, bx + bw - r2, by + bh);
        ctx.lineTo(bx + r2, by + bh);
        ctx.quadraticCurveTo(bx, by + bh, bx, by + bh - r2);
        ctx.lineTo(bx, by + r2);
        ctx.quadraticCurveTo(bx, by, bx + r2, by);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 13px -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(_molValenceWarnMsg, pw / 2, by + bh / 2);
        ctx.restore();
    }
}

function molHitAtom(x, y) {
    for (let i = molState.atoms.length - 1; i >= 0; i--) {
        const a = molState.atoms[i];
        if (Math.hypot(a.x - x, a.y - y) <= 16) return a;
    }
    return null;
}

function molHitBond(x, y) {
    for (let i = 0; i < molState.bonds.length; i++) {
        const b = molState.bonds[i];
        const a1 = molState.atoms.find(a => a.id === b.a);
        const a2 = molState.atoms.find(a => a.id === b.b);
        if (!a1 || !a2) continue;
        const dx = a2.x - a1.x, dy = a2.y - a1.y;
        const len2 = dx * dx + dy * dy;
        if (!len2) continue;
        let t = ((x - a1.x) * dx + (y - a1.y) * dy) / len2;
        t = Math.max(0, Math.min(1, t));
        const cx = a1.x + t * dx, cy = a1.y + t * dy;
        if (Math.hypot(cx - x, cy - y) < 8) return b;
    }
    return null;
}

// Drag state for moving atoms
let _molDrag = null; // { atom, startX, startY, moved }

function _molCanvasCoords(ev) {
    const canvas = document.getElementById('mol-canvas');
    const rect = canvas.getBoundingClientRect();
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
}

function molCanvasPointerDown(ev) {
    if (ev.button !== 0) return;
    const { x, y } = _molCanvasCoords(ev);
    const hit = molHitAtom(x, y);
    // Set up drag/click state — atom under cursor for drag, or null for empty-space click
    _molDrag = { atom: hit, startX: x, startY: y,
                 origX: hit ? hit.x : x, origY: hit ? hit.y : y, moved: false };
    try { ev.currentTarget.setPointerCapture(ev.pointerId); } catch(_){}
}

function molCanvasPointerMove(ev) {
    if (!_molDrag) return;
    const { x, y } = _molCanvasCoords(ev);
    const dx = x - _molDrag.startX, dy = y - _molDrag.startY;
    if (!_molDrag.moved && Math.hypot(dx, dy) < 4) return; // dead zone
    _molDrag.moved = true;
    // Only move existing atoms (and only when not in erase mode)
    if (_molDrag.atom && molState.tool !== 'erase') {
        _molDrag.atom.x = x;
        _molDrag.atom.y = y;
        molRedraw();
    }
}

function molCanvasPointerUp(ev) {
    if (!_molDrag) return;
    const drag = _molDrag;
    _molDrag = null;
    if (drag.moved && drag.atom && molState.tool !== 'erase') {
        molScheduleSave();
        return; // was a drag of an existing atom
    }
    // Treat as click — empty-space click adds atom (in atom mode); atom click handles bond/erase
    const { x, y } = _molCanvasCoords(ev);
    molHandleClick(x, y, drag.atom);
}

function molHandleClick(x, y, hitAtom) {
    const hit = hitAtom || molHitAtom(x, y);
    if (molState.tool === 'atom') {
        if (hit) {
            hit.el = molState.element;
        } else {
            molState.atoms.push({ id: molState.nextId++, el: molState.element, x, y });
        }
    } else if (molState.tool === 'bond') {
        if (!hit) { molState.pendingBond = null; }
        else if (molState.pendingBond == null) {
            molState.pendingBond = hit.id;
        } else if (molState.pendingBond === hit.id) {
            molState.pendingBond = null;
        } else {
            const a = molState.pendingBond, b = hit.id;
            const existing = molState.bonds.find(x =>
                (x.a === a && x.b === b) || (x.a === b && x.b === a));
            const newOrder = molState.bondOrder;
            // ── Valence check ──────────────────────────────────────
            if (existing) {
                // Changing bond order: compute delta and check if both atoms can absorb it
                const delta = newOrder - existing.order;
                if (delta > 0) {
                    const freeA = molFreeValence(a);
                    const freeB = molFreeValence(b);
                    const atomA = molState.atoms.find(at => at.id === a);
                    const atomB = molState.atoms.find(at => at.id === b);
                    if (freeA < delta) {
                        _molShowValenceWarning(`${atomA.el} is already at max valence (${MOL_VALENCE[atomA.el] ?? '∞'})`);
                        molState.pendingBond = null;
                        return;
                    }
                    if (freeB < delta) {
                        _molShowValenceWarning(`${atomB.el} is already at max valence (${MOL_VALENCE[atomB.el] ?? '∞'})`);
                        molState.pendingBond = null;
                        return;
                    }
                }
                existing.order = newOrder;
            } else {
                const freeA = molFreeValence(a);
                const freeB = molFreeValence(b);
                const atomA = molState.atoms.find(at => at.id === a);
                const atomB = molState.atoms.find(at => at.id === b);
                if (freeA < newOrder) {
                    _molShowValenceWarning(`${atomA.el} is already at max valence (${MOL_VALENCE[atomA.el] ?? '∞'})`);
                    molState.pendingBond = null;
                    return;
                }
                if (freeB < newOrder) {
                    _molShowValenceWarning(`${atomB.el} is already at max valence (${MOL_VALENCE[atomB.el] ?? '∞'})`);
                    molState.pendingBond = null;
                    return;
                }
                molState.bonds.push({ a, b, order: newOrder });
            }
            molState.pendingBond = null;
        }
    } else if (molState.tool === 'erase') {
        if (hit) {
            molState.atoms = molState.atoms.filter(a => a.id !== hit.id);
            molState.bonds = molState.bonds.filter(b => b.a !== hit.id && b.b !== hit.id);
        } else {
            const hb = molHitBond(x, y);
            if (hb) molState.bonds = molState.bonds.filter(b => b !== hb);
        }
    }
    molRedraw();
    molUpdateFormula();
    molScheduleSave();
}

// Legacy click kept for compatibility (no-op now — handled by pointerUp)
function molCanvasClick(ev) { /* handled by pointerdown/up */ }

function molUpdateFormula() {
    const counts = {};
    molState.atoms.forEach(a => { counts[a.el] = (counts[a.el] || 0) + 1; });
    // Hill order: C first, H second, then alphabetical
    const order = Object.keys(counts).sort((a, b) => {
        if (a === b) return 0;
        if (a === 'C') return -1;
        if (b === 'C') return 1;
        if (a === 'H') return -1;
        if (b === 'H') return 1;
        return a.localeCompare(b);
    });
    const sub = n => n === 1 ? '' : String(n).replace(/\d/g, d => '₀₁₂₃₄₅₆₇₈₉'[d]);
    const formula = order.map(s => s + sub(counts[s])).join('') || '—';
    document.getElementById('mol-formula').textContent = formula;
    let weight = 0;
    order.forEach(s => { weight += molElementInfo(s).mass * counts[s]; });
    document.getElementById('mol-weight').textContent =
        weight ? `· MW ${weight.toFixed(2)} g/mol` : '';
}

function molScheduleSave() {
    clearTimeout(molSaveTimer);
    molSaveTimer = setTimeout(molSaveNow, 500);
}
function molSaveNow() {
    if (!molCurrentFile) return;
    _sciWriteFile(molCurrentFile, {
        atoms: molState.atoms, bonds: molState.bonds, nextId: molState.nextId,
    });
}

function openVaultMoleculeEditor(file) {
    molCurrentFile = file;
    document.getElementById('vault-normal-view').style.display = 'none';
    document.getElementById('vault-molecule-area').style.display = '';
    document.getElementById('vault-viewer-title').classList.add('hidden');
    const titleInput = document.getElementById('vault-doc-title-input');
    titleInput.classList.remove('hidden');
    titleInput.value = file.originalName;

    const data = _sciReadFile(file) || { atoms: [], bonds: [], nextId: 1 };
    molState.atoms = data.atoms || [];
    molState.bonds = data.bonds || [];
    molState.nextId = data.nextId || (molState.atoms.reduce((m,a)=>Math.max(m,a.id),0) + 1);
    molState.pendingBond = null;
    _molDrag = null;
    // Sync canvas cursor with current tool
    const cv = document.getElementById('mol-canvas');
    if (cv) cv.dataset.tool = molState.tool;
    molRenderPalette();
    // Two rAF passes ensure the container has painted and getBoundingClientRect() is non-zero
    requestAnimationFrame(() => requestAnimationFrame(() => { molRedraw(); molUpdateFormula(); }));
}

function closeVaultMoleculeEditor() {
    if (molCurrentFile) molSaveNow();
    molCurrentFile = null;
    document.getElementById('vault-molecule-area').style.display = 'none';
    document.getElementById('vault-normal-view').style.display = '';
    document.getElementById('vault-viewer-title').classList.remove('hidden');
    document.getElementById('vault-doc-title-input').classList.add('hidden');
}

// ── Molecule templates ───────────────────────────────────────────────────────
// Common molecules with pre-laid-out 2D geometry (coords relative to center,
// ~46 px bond length). a/b in bonds index into the atoms array.
const MOL_TEMPLATES = {
    water:    { name: 'Water (H₂O)',
        atoms: [['O',0,0],['H',-36,28],['H',36,28]],
        bonds: [[0,1,1],[0,2,1]] },
    co2:      { name: 'Carbon dioxide (CO₂)',
        atoms: [['C',0,0],['O',-50,0],['O',50,0]],
        bonds: [[0,1,2],[0,2,2]] },
    o2:       { name: 'Oxygen (O₂)',
        atoms: [['O',-25,0],['O',25,0]],
        bonds: [[0,1,2]] },
    n2:       { name: 'Nitrogen (N₂)',
        atoms: [['N',-25,0],['N',25,0]],
        bonds: [[0,1,3]] },
    ammonia:  { name: 'Ammonia (NH₃)',
        atoms: [['N',0,0],['H',-40,26],['H',40,26],['H',0,-46]],
        bonds: [[0,1,1],[0,2,1],[0,3,1]] },
    methane:  { name: 'Methane (CH₄)',
        atoms: [['C',0,0],['H',0,-48],['H',48,0],['H',0,48],['H',-48,0]],
        bonds: [[0,1,1],[0,2,1],[0,3,1],[0,4,1]] },
    ethanol:  { name: 'Ethanol (C₂H₅OH)',
        atoms: [['C',-70,10],['C',-24,-14],['O',22,10],['H',57,-10],
                ['H',-93,50],['H',-113,-6],['H',-62,-35],['H',-24,-60],['H',-24,32]],
        bonds: [[0,1,1],[1,2,1],[2,3,1],[0,4,1],[0,5,1],[0,6,1],[1,7,1],[1,8,1]] },
    aceticacid: { name: 'Acetic acid (CH₃COOH)',
        atoms: [['C',-60,0],['C',-14,-20],['O',30,-44],['O',-2,26],['H',44,40],
                ['H',-83,40],['H',-103,-16],['H',-52,-45]],
        bonds: [[0,1,1],[1,2,2],[1,3,1],[3,4,1],[0,5,1],[0,6,1],[0,7,1]] },
    benzene:  { name: 'Benzene (C₆H₆)',
        atoms: [['C',0,-52],['C',-45,-26],['C',-45,26],['C',0,52],['C',45,26],['C',45,-26],
                ['H',0,-92],['H',-80,-46],['H',-80,46],['H',0,92],['H',80,46],['H',80,-46]],
        bonds: [[0,1,2],[1,2,1],[2,3,2],[3,4,1],[4,5,2],[5,0,1],
                [0,6,1],[1,7,1],[2,8,1],[3,9,1],[4,10,1],[5,11,1]] },
};

// Insert a template centered on the canvas (offset if atoms already exist)
function molInsertTemplate(key) {
    const tpl = MOL_TEMPLATES[key];
    const canvas = document.getElementById('mol-canvas');
    if (!tpl || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    let cx = rect.width / 2, cy = rect.height / 2;
    if (molState.atoms.length) {          // don't stack exactly on an existing structure
        cx += (Math.random() - 0.5) * 120;
        cy += (Math.random() - 0.5) * 120;
    }
    const idMap = tpl.atoms.map(([el, x, y]) => {
        const id = molState.nextId++;
        molState.atoms.push({ id, el, x: cx + x, y: cy + y });
        return id;
    });
    tpl.bonds.forEach(([a, b, order]) => {
        molState.bonds.push({ a: idMap[a], b: idMap[b], order });
    });
    molRedraw(); molUpdateFormula(); molScheduleSave();
}

// Fill every atom's free valence with hydrogen atoms, placed in the largest
// angular gaps between existing bonds so the drawing stays readable.
function molAddHydrogens() {
    const existing = molState.atoms.slice();  // snapshot — don't add H to new H
    let added = 0;
    existing.forEach(atom => {
        let free = molFreeValence(atom.id);
        if (!isFinite(free) || free <= 0) return;
        // Angles of current bonds from this atom
        const bondAngles = molState.bonds
            .filter(b => b.a === atom.id || b.b === atom.id)
            .map(b => {
                const other = molState.atoms.find(a => a.id === (b.a === atom.id ? b.b : b.a));
                return other ? Math.atan2(other.y - atom.y, other.x - atom.x) : null;
            })
            .filter(a => a != null);
        for (let k = 0; k < free; k++) {
            // Pick the candidate angle (every 30°) farthest from all used angles
            let bestAngle = -Math.PI / 2, bestDist = -1;
            for (let deg = 0; deg < 360; deg += 30) {
                const ang = deg * Math.PI / 180;
                const dist = bondAngles.length
                    ? Math.min(...bondAngles.map(b => {
                        let d = Math.abs(ang - b) % (Math.PI * 2);
                        return d > Math.PI ? Math.PI * 2 - d : d;
                    }))
                    : Math.PI;
                if (dist > bestDist) { bestDist = dist; bestAngle = ang; }
            }
            bondAngles.push(bestAngle);
            const id = molState.nextId++;
            molState.atoms.push({
                id, el: 'H',
                x: atom.x + Math.cos(bestAngle) * 42,
                y: atom.y + Math.sin(bestAngle) * 42,
            });
            molState.bonds.push({ a: atom.id, b: id, order: 1 });
            added++;
        }
    });
    if (added) { molRedraw(); molUpdateFormula(); molScheduleSave(); }
    else _molShowValenceWarning('No free valences to fill');
}

function initMoleculeBuilder() {
    const newBtn = document.getElementById('vault-new-molecule-btn');
    if (newBtn) newBtn.onclick = () => _sciCreateFile(
        'New Molecule', 'isMolecule', '.mol.json',
        { atoms: [], bonds: [], nextId: 1 });

    const canvas = document.getElementById('mol-canvas');
    if (canvas) {
        // Replace click with pointer events for drag support
        canvas.addEventListener('pointerdown', molCanvasPointerDown);
        canvas.addEventListener('pointermove', molCanvasPointerMove);
        canvas.addEventListener('pointerup',   molCanvasPointerUp);
        canvas.addEventListener('pointercancel', () => { _molDrag = null; });
        // Keyboard delete of selected atom (canvas must be focusable)
        canvas.setAttribute('tabindex', '0');
        canvas.addEventListener('keydown', e => {
            if ((e.key === 'Delete' || e.key === 'Backspace') && molState.pendingBond != null) {
                const id = molState.pendingBond;
                molState.atoms = molState.atoms.filter(a => a.id !== id);
                molState.bonds = molState.bonds.filter(b => b.a !== id && b.b !== id);
                molState.pendingBond = null;
                molRedraw(); molUpdateFormula(); molScheduleSave();
            }
        });
        // ResizeObserver keeps canvas pixel-perfect at any container size
        new ResizeObserver(() => { if (molCurrentFile) molRedraw(); }).observe(canvas.parentElement);
    }
    document.querySelectorAll('.mol-tool-btn').forEach(b => {
        b.onclick = () => {
            molState.tool = b.dataset.mtool;
            molState.pendingBond = null;
            document.querySelectorAll('.mol-tool-btn').forEach(x =>
                x.classList.toggle('active', x === b));
            const cv = document.getElementById('mol-canvas');
            if (cv) cv.dataset.tool = molState.tool;
            molRedraw();
        };
    });
    const bondOrder = document.getElementById('mol-bond-order');
    if (bondOrder) bondOrder.onchange = () => {
        molState.bondOrder = parseInt(bondOrder.value, 10) || 1;
    };
    const clearBtn = document.getElementById('mol-clear-btn');
    if (clearBtn) clearBtn.onclick = () => {
        if (!confirm('Clear the entire molecule?')) return;
        molState.atoms = []; molState.bonds = []; molState.pendingBond = null;
        molRedraw(); molUpdateFormula(); molScheduleSave();
    };

    // Element palette search
    const elSearch = document.getElementById('mol-element-search');
    if (elSearch) elSearch.oninput = e => {
        molState.search = e.target.value;
        molRenderPalette();
    };

    // Molecule templates dropdown
    const tplSel = document.getElementById('mol-template-select');
    if (tplSel) {
        Object.entries(MOL_TEMPLATES).forEach(([key, tpl]) => {
            const opt = document.createElement('option');
            opt.value = key;
            opt.textContent = tpl.name;
            tplSel.appendChild(opt);
        });
        tplSel.onchange = () => {
            if (tplSel.value) molInsertTemplate(tplSel.value);
            tplSel.value = '';   // reset so the same template can be inserted again
        };
    }

    // Auto-fill hydrogens
    const addHBtn = document.getElementById('mol-addh-btn');
    if (addHBtn) addHBtn.onclick = molAddHydrogens;
}

// ====================================================================
// 2. PERIODIC TABLE
// ====================================================================
// Compact dataset — symbol, name, atomic number, period, group, mass, category
const PT_ELEMENTS = [
    ['H','Hydrogen',1,1,1,1.008,'nonmetal'],
    ['He','Helium',2,1,18,4.0026,'noble'],
    ['Li','Lithium',3,2,1,6.94,'alkali'],
    ['Be','Beryllium',4,2,2,9.0122,'alkaline'],
    ['B','Boron',5,2,13,10.81,'metalloid'],
    ['C','Carbon',6,2,14,12.011,'nonmetal'],
    ['N','Nitrogen',7,2,15,14.007,'nonmetal'],
    ['O','Oxygen',8,2,16,15.999,'nonmetal'],
    ['F','Fluorine',9,2,17,18.998,'halogen'],
    ['Ne','Neon',10,2,18,20.180,'noble'],
    ['Na','Sodium',11,3,1,22.990,'alkali'],
    ['Mg','Magnesium',12,3,2,24.305,'alkaline'],
    ['Al','Aluminium',13,3,13,26.982,'post'],
    ['Si','Silicon',14,3,14,28.085,'metalloid'],
    ['P','Phosphorus',15,3,15,30.974,'nonmetal'],
    ['S','Sulfur',16,3,16,32.06,'nonmetal'],
    ['Cl','Chlorine',17,3,17,35.45,'halogen'],
    ['Ar','Argon',18,3,18,39.948,'noble'],
    ['K','Potassium',19,4,1,39.098,'alkali'],
    ['Ca','Calcium',20,4,2,40.078,'alkaline'],
    ['Sc','Scandium',21,4,3,44.956,'transition'],
    ['Ti','Titanium',22,4,4,47.867,'transition'],
    ['V','Vanadium',23,4,5,50.942,'transition'],
    ['Cr','Chromium',24,4,6,51.996,'transition'],
    ['Mn','Manganese',25,4,7,54.938,'transition'],
    ['Fe','Iron',26,4,8,55.845,'transition'],
    ['Co','Cobalt',27,4,9,58.933,'transition'],
    ['Ni','Nickel',28,4,10,58.693,'transition'],
    ['Cu','Copper',29,4,11,63.546,'transition'],
    ['Zn','Zinc',30,4,12,65.38,'transition'],
    ['Ga','Gallium',31,4,13,69.723,'post'],
    ['Ge','Germanium',32,4,14,72.630,'metalloid'],
    ['As','Arsenic',33,4,15,74.922,'metalloid'],
    ['Se','Selenium',34,4,16,78.971,'nonmetal'],
    ['Br','Bromine',35,4,17,79.904,'halogen'],
    ['Kr','Krypton',36,4,18,83.798,'noble'],
    ['Rb','Rubidium',37,5,1,85.468,'alkali'],
    ['Sr','Strontium',38,5,2,87.62,'alkaline'],
    ['Y','Yttrium',39,5,3,88.906,'transition'],
    ['Zr','Zirconium',40,5,4,91.224,'transition'],
    ['Nb','Niobium',41,5,5,92.906,'transition'],
    ['Mo','Molybdenum',42,5,6,95.95,'transition'],
    ['Tc','Technetium',43,5,7,98,'transition'],
    ['Ru','Ruthenium',44,5,8,101.07,'transition'],
    ['Rh','Rhodium',45,5,9,102.91,'transition'],
    ['Pd','Palladium',46,5,10,106.42,'transition'],
    ['Ag','Silver',47,5,11,107.87,'transition'],
    ['Cd','Cadmium',48,5,12,112.41,'transition'],
    ['In','Indium',49,5,13,114.82,'post'],
    ['Sn','Tin',50,5,14,118.71,'post'],
    ['Sb','Antimony',51,5,15,121.76,'metalloid'],
    ['Te','Tellurium',52,5,16,127.60,'metalloid'],
    ['I','Iodine',53,5,17,126.90,'halogen'],
    ['Xe','Xenon',54,5,18,131.29,'noble'],
    ['Cs','Caesium',55,6,1,132.91,'alkali'],
    ['Ba','Barium',56,6,2,137.33,'alkaline'],
    ['La','Lanthanum',57,6,3,138.91,'lanthanide'],
    ['Ce','Cerium',58,9,4,140.12,'lanthanide'],
    ['Pr','Praseodymium',59,9,5,140.91,'lanthanide'],
    ['Nd','Neodymium',60,9,6,144.24,'lanthanide'],
    ['Pm','Promethium',61,9,7,145,'lanthanide'],
    ['Sm','Samarium',62,9,8,150.36,'lanthanide'],
    ['Eu','Europium',63,9,9,151.96,'lanthanide'],
    ['Gd','Gadolinium',64,9,10,157.25,'lanthanide'],
    ['Tb','Terbium',65,9,11,158.93,'lanthanide'],
    ['Dy','Dysprosium',66,9,12,162.50,'lanthanide'],
    ['Ho','Holmium',67,9,13,164.93,'lanthanide'],
    ['Er','Erbium',68,9,14,167.26,'lanthanide'],
    ['Tm','Thulium',69,9,15,168.93,'lanthanide'],
    ['Yb','Ytterbium',70,9,16,173.05,'lanthanide'],
    ['Lu','Lutetium',71,9,17,174.97,'lanthanide'],
    ['Hf','Hafnium',72,6,4,178.49,'transition'],
    ['Ta','Tantalum',73,6,5,180.95,'transition'],
    ['W','Tungsten',74,6,6,183.84,'transition'],
    ['Re','Rhenium',75,6,7,186.21,'transition'],
    ['Os','Osmium',76,6,8,190.23,'transition'],
    ['Ir','Iridium',77,6,9,192.22,'transition'],
    ['Pt','Platinum',78,6,10,195.08,'transition'],
    ['Au','Gold',79,6,11,196.97,'transition'],
    ['Hg','Mercury',80,6,12,200.59,'transition'],
    ['Tl','Thallium',81,6,13,204.38,'post'],
    ['Pb','Lead',82,6,14,207.2,'post'],
    ['Bi','Bismuth',83,6,15,208.98,'post'],
    ['Po','Polonium',84,6,16,209,'metalloid'],
    ['At','Astatine',85,6,17,210,'halogen'],
    ['Rn','Radon',86,6,18,222,'noble'],
    ['Fr','Francium',87,7,1,223,'alkali'],
    ['Ra','Radium',88,7,2,226,'alkaline'],
    ['Ac','Actinium',89,7,3,227,'actinide'],
    ['Th','Thorium',90,10,4,232.04,'actinide'],
    ['Pa','Protactinium',91,10,5,231.04,'actinide'],
    ['U','Uranium',92,10,6,238.03,'actinide'],
    ['Np','Neptunium',93,10,7,237,'actinide'],
    ['Pu','Plutonium',94,10,8,244,'actinide'],
    ['Am','Americium',95,10,9,243,'actinide'],
    ['Cm','Curium',96,10,10,247,'actinide'],
    ['Bk','Berkelium',97,10,11,247,'actinide'],
    ['Cf','Californium',98,10,12,251,'actinide'],
    ['Es','Einsteinium',99,10,13,252,'actinide'],
    ['Fm','Fermium',100,10,14,257,'actinide'],
    ['Md','Mendelevium',101,10,15,258,'actinide'],
    ['No','Nobelium',102,10,16,259,'actinide'],
    ['Lr','Lawrencium',103,10,17,266,'actinide'],
    ['Rf','Rutherfordium',104,7,4,267,'transition'],
    ['Db','Dubnium',105,7,5,268,'transition'],
    ['Sg','Seaborgium',106,7,6,269,'transition'],
    ['Bh','Bohrium',107,7,7,270,'transition'],
    ['Hs','Hassium',108,7,8,277,'transition'],
    ['Mt','Meitnerium',109,7,9,278,'transition'],
    ['Ds','Darmstadtium',110,7,10,281,'transition'],
    ['Rg','Roentgenium',111,7,11,282,'transition'],
    ['Cn','Copernicium',112,7,12,285,'transition'],
    ['Nh','Nihonium',113,7,13,286,'post'],
    ['Fl','Flerovium',114,7,14,289,'post'],
    ['Mc','Moscovium',115,7,15,290,'post'],
    ['Lv','Livermorium',116,7,16,293,'post'],
    ['Ts','Tennessine',117,7,17,294,'halogen'],
    ['Og','Oganesson',118,7,18,294,'noble'],
];

const PT_CATEGORY_COLORS = {
    alkali:'#fca5a5', alkaline:'#fdba74', transition:'#fde68a',
    post:'#bef264', metalloid:'#86efac', nonmetal:'#67e8f9',
    halogen:'#7dd3fc', noble:'#c4b5fd',
    lanthanide:'#f9a8d4', actinide:'#f0abfc',
};
const PT_CATEGORY_NAMES = {
    alkali:'Alkali metal', alkaline:'Alkaline earth metal',
    transition:'Transition metal', post:'Post-transition metal',
    metalloid:'Metalloid', nonmetal:'Reactive nonmetal',
    halogen:'Halogen', noble:'Noble gas',
    lanthanide:'Lanthanide', actinide:'Actinide',
};

let ptCurrentFile = null;
let ptSelectedZ = null;
let ptNotesTimer = null;

function ptRenderGrid(filterQuery) {
    const grid = document.getElementById('pt-grid');
    if (!grid) return;
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = 'repeat(18, 34px)';
    grid.style.gridAutoRows = '34px';
    grid.style.gap = '2px';
    grid.innerHTML = '';

    const q = (filterQuery || '').trim().toLowerCase();
    const data = ptCurrentFile ? (_sciReadFile(ptCurrentFile) || { notes: {} }) : { notes: {} };

    PT_ELEMENTS.forEach(([sym, name, z, period, group, mass, cat]) => {
        const cell = document.createElement('div');
        cell.className = 'pt-cell';
        cell.style.background = PT_CATEGORY_COLORS[cat] || '#e2e8f0';
        cell.style.gridColumn = group;
        cell.style.gridRow = period;
        cell.innerHTML = `<span class="pt-z">${z}</span><span class="pt-sym">${sym}</span>`;
        cell.title = `${name} (${mass})`;
        if (data.notes && data.notes[sym]) {
            cell.style.boxShadow = 'inset 0 0 0 2px #1e293b';
        }
        if (ptSelectedZ === z) cell.classList.add('active');
        if (q && !(sym.toLowerCase().includes(q) || name.toLowerCase().includes(q) || String(z) === q)) {
            cell.classList.add('dim');
        }
        cell.onclick = () => { ptSelectedZ = z; ptShowDetail(z); ptRenderGrid(q); };
        grid.appendChild(cell);
    });

    // Category colour legend row (placed below the f-block, row 11)
    const legendData = [
        ['alkali','Alkali'], ['alkaline','Alkaline'], ['transition','Transition'],
        ['post','Post-trans.'], ['metalloid','Metalloid'], ['nonmetal','Nonmetal'],
        ['halogen','Halogen'], ['noble','Noble gas'], ['lanthanide','Lanthanide'], ['actinide','Actinide'],
    ];
    legendData.forEach(([cat, label], i) => {
        const lc = document.createElement('div');
        lc.style.cssText = `grid-column:${i * 2 - 1 < 1 ? 1 : (i < 9 ? i * 2 - 1 : i * 2 - 1)}; grid-row:12;
            display:flex; align-items:center; gap:3px; font-size:8px; color:rgb(var(--slate-400)); grid-column:${(i % 9) + 1};
            grid-row:${12 + Math.floor(i / 9)};`;
        lc.innerHTML = `<span style="width:8px;height:8px;border-radius:2px;background:${PT_CATEGORY_COLORS[cat]};flex-shrink:0;display:inline-block"></span>${label}`;
        grid.appendChild(lc);
    });
}

function ptShowDetail(z) {
    const e = PT_ELEMENTS.find(x => x[2] === z);
    if (!e) return;
    const [sym, name, , period, group, mass, cat] = e;
    document.getElementById('pt-detail').innerHTML = `
        <div class="flex items-start gap-4">
            <div style="background:${PT_CATEGORY_COLORS[cat]};color:rgb(var(--slate-900))" class="rounded-xl p-3 w-20 text-center">
                <div class="text-[9px] opacity-70">${z}</div>
                <div class="text-2xl font-bold leading-tight">${sym}</div>
                <div class="text-[9px] mt-0.5">${mass}</div>
            </div>
            <div class="flex-1 min-w-0">
                <div class="text-base font-semibold text-white">${name}</div>
                <div class="text-[10px] text-slate-400 mt-0.5">${PT_CATEGORY_NAMES[cat] || cat}</div>
                <div class="mt-2 grid grid-cols-2 gap-y-1 text-[11px]">
                    <span class="text-slate-500">Atomic number</span><span class="text-slate-300">${z}</span>
                    <span class="text-slate-500">Atomic mass</span><span class="text-slate-300">${mass} u</span>
                    <span class="text-slate-500">Period</span><span class="text-slate-300">${period > 7 ? (period === 8 || period === 9 ? '6' : '7') : period}</span>
                    <span class="text-slate-500">Group</span><span class="text-slate-300">${group <= 18 ? group : '—'}</span>
                </div>
            </div>
        </div>
    `;
    document.getElementById('pt-notes-label').textContent = `${name} (${sym})`;
    const data = ptCurrentFile ? (_sciReadFile(ptCurrentFile) || { notes: {} }) : { notes: {} };
    document.getElementById('pt-notes').value = (data.notes && data.notes[sym]) || '';
}

function ptSaveNotes() {
    if (!ptCurrentFile || ptSelectedZ == null) return;
    const e = PT_ELEMENTS.find(x => x[2] === ptSelectedZ);
    if (!e) return;
    const sym = e[0];
    const data = _sciReadFile(ptCurrentFile) || { notes: {} };
    if (!data.notes) data.notes = {};
    const v = document.getElementById('pt-notes').value;
    if (v) data.notes[sym] = v; else delete data.notes[sym];
    _sciWriteFile(ptCurrentFile, data);
    ptRenderGrid(document.getElementById('pt-search').value);
}

function openVaultPeriodicEditor(file) {
    ptCurrentFile = file;
    document.getElementById('vault-normal-view').style.display = 'none';
    document.getElementById('vault-periodic-area').style.display = 'flex';
    document.getElementById('vault-viewer-title').classList.add('hidden');
    const titleInput = document.getElementById('vault-doc-title-input');
    titleInput.classList.remove('hidden');
    titleInput.value = file.originalName;
    ptSelectedZ = null;
    ptRenderGrid('');
    document.getElementById('pt-detail').innerHTML =
        `<p class="text-slate-500 italic">Click any element to see its details.</p>`;
    document.getElementById('pt-notes').value = '';
    document.getElementById('pt-search').value = '';
}
function closeVaultPeriodicEditor() {
    ptCurrentFile = null;
    document.getElementById('vault-periodic-area').style.display = 'none';
    document.getElementById('vault-normal-view').style.display = '';
    document.getElementById('vault-viewer-title').classList.remove('hidden');
    document.getElementById('vault-doc-title-input').classList.add('hidden');
}

function initPeriodicTable() {
    const newBtn = document.getElementById('vault-new-periodic-btn');
    if (newBtn) newBtn.onclick = () => _sciCreateFile(
        'New Periodic Table', 'isPeriodic', '.pt.json', { notes: {} });
    const search = document.getElementById('pt-search');
    if (search) search.oninput = e => ptRenderGrid(e.target.value);
    const notes = document.getElementById('pt-notes');
    if (notes) notes.oninput = () => {
        clearTimeout(ptNotesTimer);
        ptNotesTimer = setTimeout(ptSaveNotes, 400);
    };
}

// ====================================================================
// 3. DNA / RNA SEQUENCE TOOL
// ====================================================================
const CODON_TABLE = {
    UUU:'F',UUC:'F',UUA:'L',UUG:'L',CUU:'L',CUC:'L',CUA:'L',CUG:'L',
    AUU:'I',AUC:'I',AUA:'I',AUG:'M',GUU:'V',GUC:'V',GUA:'V',GUG:'V',
    UCU:'S',UCC:'S',UCA:'S',UCG:'S',CCU:'P',CCC:'P',CCA:'P',CCG:'P',
    ACU:'T',ACC:'T',ACA:'T',ACG:'T',GCU:'A',GCC:'A',GCA:'A',GCG:'A',
    UAU:'Y',UAC:'Y',UAA:'*',UAG:'*',CAU:'H',CAC:'H',CAA:'Q',CAG:'Q',
    AAU:'N',AAC:'N',AAA:'K',AAG:'K',GAU:'D',GAC:'D',GAA:'E',GAG:'E',
    UGU:'C',UGC:'C',UGA:'*',UGG:'W',CGU:'R',CGC:'R',CGA:'R',CGG:'R',
    AGU:'S',AGC:'S',AGA:'R',AGG:'R',GGU:'G',GGC:'G',GGA:'G',GGG:'G',
};

let dnaCurrentFile = null;
let dnaSaveTimer = null;

function dnaClean(seq, type) {
    const allowed = type === 'rna' ? /[^ACGU]/gi : /[^ACGT]/gi;
    return seq.toUpperCase().replace(allowed, '');
}
function dnaComplement(seq, type) {
    const map = type === 'rna'
        ? { A:'U', U:'A', G:'C', C:'G' }
        : { A:'T', T:'A', G:'C', C:'G' };
    return seq.toUpperCase().split('').map(b => map[b] || b).join('');
}
function dnaTranscribe(seq) {
    // DNA template strand → mRNA: replace T with U on the coding strand interpretation.
    // Convention here: input is coding (sense) strand; mRNA = same with T→U.
    return seq.toUpperCase().replace(/T/g, 'U');
}
function dnaTranslate(seq, type) {
    const rna = type === 'rna' ? seq.toUpperCase() : seq.toUpperCase().replace(/T/g, 'U');
    let out = '';
    for (let i = 0; i + 3 <= rna.length; i += 3) {
        const codon = rna.slice(i, i + 3);
        out += CODON_TABLE[codon] || '?';
    }
    return out;
}

function dnaUpdateStats() {
    const type = document.getElementById('dna-type').value;
    const raw = document.getElementById('dna-input').value;
    const clean = dnaClean(raw, type);
    const counts = { A:0, C:0, G:0, T:0, U:0 };
    for (const c of clean) counts[c] = (counts[c] || 0) + 1;
    const gc = clean.length ? ((counts.G + counts.C) / clean.length * 100).toFixed(1) : '0.0';
    const parts = [`len ${clean.length}`, `GC ${gc}%`,
        `A:${counts.A}`, `C:${counts.C}`, `G:${counts.G}`,
        type === 'rna' ? `U:${counts.U}` : `T:${counts.T}`];
    document.getElementById('dna-stats').textContent = parts.join(' · ');
}

function dnaScheduleSave() {
    clearTimeout(dnaSaveTimer);
    dnaSaveTimer = setTimeout(() => {
        if (!dnaCurrentFile) return;
        _sciWriteFile(dnaCurrentFile, {
            type: document.getElementById('dna-type').value,
            seq:  document.getElementById('dna-input').value,
        });
    }, 500);
}

function openVaultDNAEditor(file) {
    dnaCurrentFile = file;
    document.getElementById('vault-normal-view').style.display = 'none';
    document.getElementById('vault-dna-area').style.display = '';
    document.getElementById('vault-viewer-title').classList.add('hidden');
    const titleInput = document.getElementById('vault-doc-title-input');
    titleInput.classList.remove('hidden');
    titleInput.value = file.originalName;
    const data = _sciReadFile(file) || { type:'dna', seq:'' };
    document.getElementById('dna-type').value = data.type || 'dna';
    document.getElementById('dna-input').value = data.seq || '';
    document.getElementById('dna-output').textContent = '';
    document.getElementById('dna-output-label').textContent = 'Output';
    dnaUpdateStats();
}
function closeVaultDNAEditor() {
    if (dnaCurrentFile) {
        clearTimeout(dnaSaveTimer);
        _sciWriteFile(dnaCurrentFile, {
            type: document.getElementById('dna-type').value,
            seq:  document.getElementById('dna-input').value,
        });
    }
    dnaCurrentFile = null;
    document.getElementById('vault-dna-area').style.display = 'none';
    document.getElementById('vault-normal-view').style.display = '';
    document.getElementById('vault-viewer-title').classList.remove('hidden');
    document.getElementById('vault-doc-title-input').classList.add('hidden');
}

function _dnaSetOutput(label, text) {
    document.getElementById('dna-output-label').textContent = label;
    document.getElementById('dna-output').textContent = text;
}

function initDNATool() {
    const newBtn = document.getElementById('vault-new-dna-btn');
    if (newBtn) newBtn.onclick = () => _sciCreateFile(
        'New Sequence', 'isDna', '.dna.json', { type:'dna', seq:'' });

    const input = document.getElementById('dna-input');
    if (input) input.oninput = () => { dnaUpdateStats(); dnaScheduleSave(); };
    const typeSel = document.getElementById('dna-type');
    if (typeSel) typeSel.onchange = () => {
        // Clear stale output when sequence type changes
        document.getElementById('dna-output').textContent = '';
        document.getElementById('dna-output-label').textContent = 'Output';
        dnaUpdateStats();
        dnaScheduleSave();
    };

    document.getElementById('dna-clean-btn')?.addEventListener('click', () => {
        const type = document.getElementById('dna-type').value;
        document.getElementById('dna-input').value =
            dnaClean(document.getElementById('dna-input').value, type);
        dnaUpdateStats(); dnaScheduleSave();
    });
    document.getElementById('dna-complement-btn')?.addEventListener('click', () => {
        const type = document.getElementById('dna-type').value;
        const seq = dnaClean(document.getElementById('dna-input').value, type);
        _dnaSetOutput('Complement (5′ → 3′ of complementary strand, same order)', dnaComplement(seq, type));
    });
    document.getElementById('dna-revcomp-btn')?.addEventListener('click', () => {
        const type = document.getElementById('dna-type').value;
        const seq = dnaClean(document.getElementById('dna-input').value, type);
        _dnaSetOutput('Reverse Complement', dnaComplement(seq, type).split('').reverse().join(''));
    });
    document.getElementById('dna-transcribe-btn')?.addEventListener('click', () => {
        const seq = dnaClean(document.getElementById('dna-input').value, 'dna');
        _dnaSetOutput('mRNA (T → U)', dnaTranscribe(seq));
    });
    document.getElementById('dna-translate-btn')?.addEventListener('click', () => {
        const type = document.getElementById('dna-type').value;
        const seq = dnaClean(document.getElementById('dna-input').value, type);
        const protein = dnaTranslate(seq, type);
        _dnaSetOutput(`Protein (${protein.length} aa, * = stop)`, protein);
    });
}

// ====================================================================
// 4. ANATOMY EXPLORER
// ====================================================================
const ANATOMY_SYSTEMS = [
    { id:'skeletal',       name:'Skeletal',         icon:'fa-bone',       color:'#e2e8f0' },
    { id:'muscular',       name:'Muscular',         icon:'fa-dumbbell',   color:'#fb7185' },
    { id:'cardiovascular', name:'Cardiovascular',   icon:'fa-heartbeat',  color:'#ef4444' },
    { id:'respiratory',    name:'Respiratory',      icon:'fa-lungs',      color:'#38bdf8' },
    { id:'digestive',      name:'Digestive',        icon:'fa-utensils',   color:'#f59e0b' },
    { id:'nervous',        name:'Nervous',          icon:'fa-brain',      color:'#a78bfa' },
    { id:'endocrine',      name:'Endocrine',        icon:'fa-flask',      color:'#22d3ee' },
    { id:'urinary',        name:'Urinary',          icon:'fa-tint',       color:'#facc15' },
    { id:'reproductive',   name:'Reproductive',     icon:'fa-venus-mars', color:'#f472b6' },
    { id:'immune',         name:'Lymphatic / Immune', icon:'fa-shield-alt', color:'#34d399' },
    { id:'integumentary',  name:'Integumentary',    icon:'fa-hand-paper', color:'#fb923c' },
    { id:'sensory',        name:'Sensory',          icon:'fa-eye',        color:'#60a5fa' },
];

// Comprehensive body-parts database.
// view: which SVG view(s) the part is highlightable in: 'organs', 'skeleton', 'front', 'back'
// region: optional id of a body-region the part lives inside (for the front/back silhouette)
const ANATOMY_PARTS = [
    // ── HEAD & NECK ─────────────────────────────────────────────────
    { id:'brain',        name:'Brain',              latin:'Encephalon',           system:'nervous',
      func:'Master control center for thought, emotion, sensation, movement, and autonomic functions.',
      facts:['~86 billion neurons','~1.4 kg (3 lb)','Consumes ~20% of body\'s oxygen','Divided into cerebrum, cerebellum, brainstem'],
      view:'organs', region:'head' },
    { id:'cerebrum',     name:'Cerebrum',           latin:'Cerebrum',             system:'nervous',
      func:'Largest part of the brain; controls voluntary movement, language, memory, and reasoning.',
      facts:['Split into left and right hemispheres','Four lobes: frontal, parietal, temporal, occipital'] },
    { id:'cerebellum',   name:'Cerebellum',         latin:'Cerebellum',           system:'nervous',
      func:'Coordinates voluntary movement, posture, balance, and motor learning.',
      facts:['"Little brain" at the back of the skull','Contains more than half of all neurons in the brain'] },
    { id:'brainstem',    name:'Brainstem',          latin:'Truncus encephali',    system:'nervous',
      func:'Regulates heart rate, breathing, blood pressure and connects brain to spinal cord.',
      facts:['Includes midbrain, pons, medulla oblongata','Most cranial nerves originate here'] },
    { id:'spinal-cord',  name:'Spinal Cord',        latin:'Medulla spinalis',     system:'nervous',
      func:'Conducts signals between brain and the rest of the body; coordinates reflexes.',
      facts:['~45 cm long in adults','Protected by the vertebral column'],
      view:'organs' },
    { id:'eye',          name:'Eyes',               latin:'Oculus',               system:'sensory',
      func:'Detect light and convert it into neural signals for vision.',
      facts:['~6 million cone cells, ~120 million rod cells','Cornea provides ~2/3 of focusing power'],
      view:'organs', region:'head' },
    { id:'ear',          name:'Ears',               latin:'Auris',                system:'sensory',
      func:'Hearing and balance — convert sound waves and head motion into nerve signals.',
      facts:['Smallest bones in the body live here (ossicles)','Vestibular system controls balance'] },
    { id:'tongue',       name:'Tongue',             latin:'Lingua',               system:'sensory',
      func:'Tastes, manipulates food, and articulates speech.',
      facts:['Made of 8 interwoven muscles','~2,000–8,000 taste buds'] },
    { id:'nose',         name:'Nose',               latin:'Nasus',                system:'respiratory',
      func:'Warms, filters and humidifies inhaled air; houses olfactory receptors.',
      facts:['Detects ~1 trillion distinct smells','Lined with cilia and mucus that trap particles'] },
    { id:'pharynx',      name:'Pharynx',            latin:'Pharynx',              system:'respiratory',
      func:'Shared passage for air and food behind the nose and mouth.',
      facts:['Divided into naso-, oro-, and laryngopharynx'] },
    { id:'larynx',       name:'Larynx (voice box)', latin:'Larynx',               system:'respiratory',
      func:'Contains vocal cords; routes air to the lungs and prevents food entering the airway.',
      facts:['Vocal folds vibrate to produce sound','Adam\'s apple is the thyroid cartilage'] },
    { id:'skull',        name:'Skull',              latin:'Cranium',              system:'skeletal',
      func:'Encloses and protects the brain; supports the face.',
      facts:['22 bones (8 cranial + 14 facial)','Fused at sutures in adulthood'],
      view:'skeleton', region:'head' },
    { id:'mandible',     name:'Mandible (jaw)',     latin:'Mandibula',            system:'skeletal',
      func:'Lower jawbone — the only freely movable skull bone; supports lower teeth.',
      facts:['Strongest bone of the face'],
      view:'skeleton' },

    // ── THORAX (chest) ──────────────────────────────────────────────
    { id:'heart',        name:'Heart',              latin:'Cor',                  system:'cardiovascular',
      func:'Four-chambered muscular pump that drives blood through the pulmonary and systemic circuits.',
      facts:['Beats ~100,000 times per day','Pumps ~7,000 L of blood per day','Located slightly left of midline'],
      view:'organs', region:'chest' },
    { id:'lung-left',    name:'Left Lung',          latin:'Pulmo sinister',       system:'respiratory',
      func:'Oxygenates blood and removes carbon dioxide; smaller (2 lobes) to make room for heart.',
      facts:['Has a cardiac notch','2 lobes vs. 3 on the right'],
      view:'organs', region:'chest' },
    { id:'lung-right',   name:'Right Lung',         latin:'Pulmo dexter',         system:'respiratory',
      func:'Oxygenates blood and removes carbon dioxide; larger (3 lobes) than the left.',
      facts:['3 lobes: superior, middle, inferior'],
      view:'organs', region:'chest' },
    { id:'trachea',      name:'Trachea (windpipe)', latin:'Trachea',              system:'respiratory',
      func:'Tube carrying air between the larynx and the bronchi.',
      facts:['~10–12 cm long','Reinforced by C-shaped cartilage rings'],
      view:'organs' },
    { id:'bronchi',      name:'Bronchi',            latin:'Bronchi',              system:'respiratory',
      func:'Branch off the trachea and deliver air into each lung.',
      facts:['Right main bronchus is wider and more vertical'] },
    { id:'alveoli',      name:'Alveoli',            latin:'Alveoli pulmonis',     system:'respiratory',
      func:'Tiny air sacs where O₂/CO₂ exchange occurs across capillary walls.',
      facts:['~300–500 million in adult lungs','Total surface area ~70 m² (size of a tennis court)'] },
    { id:'diaphragm',    name:'Diaphragm',          latin:'Diaphragma',           system:'muscular',
      func:'Dome-shaped muscle below the lungs; main driver of breathing.',
      facts:['Innervated by the phrenic nerve','Contraction expands the thoracic cavity'],
      view:'organs' },
    { id:'thymus',       name:'Thymus',             latin:'Thymus',               system:'immune',
      func:'Site of T-lymphocyte maturation; central to adaptive immunity.',
      facts:['Largest in childhood, shrinks after puberty'] },
    { id:'aorta',        name:'Aorta',              latin:'Aorta',                system:'cardiovascular',
      func:'Largest artery in the body; carries oxygenated blood from the left ventricle.',
      facts:['~2.5 cm diameter','Arches over the heart'] },
    { id:'vena-cava',    name:'Vena Cava',          latin:'Vena cava',            system:'cardiovascular',
      func:'Two largest veins (superior & inferior) returning deoxygenated blood to the right atrium.',
      facts:['SVC drains head/arms, IVC drains abdomen/legs'] },
    { id:'sternum',      name:'Sternum',            latin:'Sternum',              system:'skeletal',
      func:'Flat breast bone; anchors the ribs and protects heart and lungs.',
      facts:['Manubrium, body, xiphoid process'],
      view:'skeleton', region:'chest' },
    { id:'ribs',         name:'Ribs',               latin:'Costae',               system:'skeletal',
      func:'12 paired curved bones forming the rib cage that protects thoracic organs.',
      facts:['7 true, 3 false, 2 floating pairs'],
      view:'skeleton', region:'chest' },
    { id:'clavicle',     name:'Clavicle (collar)',  latin:'Clavicula',            system:'skeletal',
      func:'S-shaped strut connecting the arm to the trunk.',
      facts:['Most commonly fractured bone'],
      view:'skeleton' },
    { id:'scapula',      name:'Scapula (shoulder blade)', latin:'Scapula',        system:'skeletal',
      func:'Flat triangular bone connecting humerus and clavicle.',
      facts:['17 muscles attach to it'] },

    // ── ABDOMEN ─────────────────────────────────────────────────────
    { id:'stomach',      name:'Stomach',            latin:'Gaster',               system:'digestive',
      func:'Stores and mechanically/chemically breaks down food using acid and enzymes.',
      facts:['pH ~1.5–3.5','Holds up to ~1.5 L','Inner lining replaced every few days'],
      view:'organs', region:'abdomen' },
    { id:'liver',        name:'Liver',              latin:'Hepar',                system:'digestive',
      func:'Largest internal organ; detoxifies, metabolizes nutrients and drugs, makes bile.',
      facts:['~1.5 kg','Over 500 known functions','Can regenerate from ~25% of its mass'],
      view:'organs', region:'abdomen' },
    { id:'gallbladder',  name:'Gallbladder',        latin:'Vesica biliaris',      system:'digestive',
      func:'Stores and concentrates bile from the liver; releases it to digest fats.',
      facts:['~50 mL capacity','Sits under the right liver lobe'] },
    { id:'pancreas',     name:'Pancreas',           latin:'Pancreas',             system:'digestive',
      func:'Exocrine: digestive enzymes. Endocrine: insulin & glucagon.',
      facts:['Both endocrine and exocrine roles','Islets of Langerhans = endocrine cells'],
      view:'organs', region:'abdomen' },
    { id:'small-intestine', name:'Small Intestine', latin:'Intestinum tenue',     system:'digestive',
      func:'Primary site of nutrient absorption; ~6 m long.',
      facts:['3 parts: duodenum, jejunum, ileum','Villi & microvilli enormously increase surface area'],
      view:'organs', region:'abdomen' },
    { id:'large-intestine', name:'Large Intestine', latin:'Intestinum crassum',   system:'digestive',
      func:'Absorbs water and electrolytes; forms and stores feces.',
      facts:['~1.5 m long','Houses the gut microbiome (~10¹³ microbes)'],
      view:'organs', region:'abdomen' },
    { id:'appendix',     name:'Appendix',           latin:'Appendix vermiformis', system:'immune',
      func:'Small pouch off the cecum; reservoir for beneficial gut bacteria; role in immunity.',
      facts:['Once thought vestigial','Inflammation = appendicitis'] },
    { id:'spleen',       name:'Spleen',             latin:'Splen / Lien',         system:'immune',
      func:'Filters old red blood cells; produces lymphocytes; reservoir for blood.',
      facts:['Roughly fist-sized','Can be removed — other organs compensate'],
      view:'organs', region:'abdomen' },
    { id:'kidney-left',  name:'Left Kidney',        latin:'Ren sinister',         system:'urinary',
      func:'Filters blood, regulates fluid/electrolytes, produces urine and hormones (EPO, renin).',
      facts:['~1 million nephrons each','Filters ~180 L plasma/day','Slightly higher than the right'],
      view:'organs', region:'abdomen' },
    { id:'kidney-right', name:'Right Kidney',       latin:'Ren dexter',           system:'urinary',
      func:'Filters blood, regulates fluid/electrolytes, produces urine and hormones.',
      facts:['Sits slightly lower because of the liver above'],
      view:'organs', region:'abdomen' },
    { id:'adrenal',      name:'Adrenal Glands',     latin:'Glandula suprarenalis', system:'endocrine',
      func:'Produce cortisol, aldosterone, adrenaline and other hormones.',
      facts:['Sit atop each kidney','Cortex + medulla zones'] },
    { id:'ureter',       name:'Ureters',            latin:'Ureter',               system:'urinary',
      func:'Muscular tubes that move urine from kidneys to bladder via peristalsis.',
      facts:['~25–30 cm long'] },
    { id:'bladder',      name:'Urinary Bladder',    latin:'Vesica urinaria',      system:'urinary',
      func:'Stores urine; signals fullness around 200–400 mL.',
      facts:['Holds up to ~500 mL comfortably','Made of detrusor smooth muscle'],
      view:'organs', region:'pelvis' },
    { id:'urethra',      name:'Urethra',            latin:'Urethra',              system:'urinary',
      func:'Tube carrying urine from bladder out of the body.',
      facts:['Longer in males (~20 cm) than females (~4 cm)'] },

    // ── PELVIS & REPRODUCTIVE ───────────────────────────────────────
    { id:'pelvis',       name:'Pelvis',             latin:'Pelvis',               system:'skeletal',
      func:'Bony basin supporting abdominal organs and connecting spine to legs.',
      facts:['Ilium, ischium, pubis fuse into hip bone','Different shape in males vs females'],
      view:'skeleton', region:'pelvis' },
    { id:'ovaries',      name:'Ovaries',            latin:'Ovarium',              system:'reproductive',
      func:'Produce eggs and the hormones estrogen and progesterone.',
      facts:['Born with ~1–2 million oocytes'] },
    { id:'uterus',       name:'Uterus',             latin:'Uterus',               system:'reproductive',
      func:'Muscular organ where a fetus develops during pregnancy.',
      facts:['Can expand from ~7 cm to ~38 cm'] },
    { id:'testes',       name:'Testes',             latin:'Testis',               system:'reproductive',
      func:'Produce sperm and testosterone.',
      facts:['Sit outside the body for cooler temperature (~2 °C lower)'] },
    { id:'prostate',     name:'Prostate',           latin:'Prostata',             system:'reproductive',
      func:'Adds fluid to semen and helps propel it during ejaculation.',
      facts:['Walnut-sized in young men, often enlarges with age'] },

    // ── UPPER LIMB ─────────────────────────────────────────────────
    { id:'humerus',      name:'Humerus',            latin:'Humerus',              system:'skeletal',
      func:'Long bone of the upper arm; from shoulder to elbow.',
      facts:['"Funny bone" = ulnar nerve at its elbow end'],
      view:'skeleton' },
    { id:'radius',       name:'Radius',             latin:'Radius',               system:'skeletal',
      func:'Lateral forearm bone; rotates around the ulna (pronation/supination).',
      view:'skeleton' },
    { id:'ulna',         name:'Ulna',               latin:'Ulna',                 system:'skeletal',
      func:'Medial forearm bone; forms the bony point of the elbow.',
      view:'skeleton' },
    { id:'carpals',      name:'Carpals',            latin:'Ossa carpi',           system:'skeletal',
      func:'Eight small wrist bones arranged in two rows.',
      facts:['Scaphoid is the most commonly fractured'] },
    { id:'biceps',       name:'Biceps Brachii',     latin:'Musculus biceps brachii', system:'muscular',
      func:'Flexes the elbow and supinates the forearm.',
      view:'front' },
    { id:'triceps',      name:'Triceps Brachii',    latin:'Musculus triceps brachii', system:'muscular',
      func:'Extends the elbow.',
      view:'back' },
    { id:'deltoid',      name:'Deltoid',            latin:'Musculus deltoideus',  system:'muscular',
      func:'Cap of the shoulder; abducts, flexes, and extends the arm.',
      view:'front' },

    // ── LOWER LIMB ─────────────────────────────────────────────────
    { id:'femur',        name:'Femur',              latin:'Femur',                system:'skeletal',
      func:'Thigh bone — longest and strongest bone in the body.',
      facts:['Supports up to 30× body weight in compression'],
      view:'skeleton' },
    { id:'patella',      name:'Patella (kneecap)',  latin:'Patella',              system:'skeletal',
      func:'Sesamoid bone protecting the knee joint; improves quadriceps leverage.' },
    { id:'tibia',        name:'Tibia',              latin:'Tibia',                system:'skeletal',
      func:'Larger of the two lower-leg bones; bears most weight.',
      view:'skeleton' },
    { id:'fibula',       name:'Fibula',             latin:'Fibula',               system:'skeletal',
      func:'Slender lateral lower-leg bone; stabilizes the ankle.',
      view:'skeleton' },
    { id:'quadriceps',   name:'Quadriceps',         latin:'Musculus quadriceps femoris', system:'muscular',
      func:'Four-headed thigh muscle that extends the knee.',
      view:'front' },
    { id:'hamstrings',   name:'Hamstrings',         latin:'Musculi posteriores femoris', system:'muscular',
      func:'Three posterior thigh muscles that flex the knee and extend the hip.',
      view:'back' },
    { id:'gastrocnemius',name:'Gastrocnemius',      latin:'Musculus gastrocnemius', system:'muscular',
      func:'Large calf muscle; plantarflexes the foot.',
      view:'back' },
    { id:'gluteus',      name:'Gluteus Maximus',    latin:'Musculus gluteus maximus', system:'muscular',
      func:'Largest muscle in the body; extends the hip, propels walking and standing.',
      view:'back' },

    // ── TRUNK & GENERAL ─────────────────────────────────────────────
    { id:'vertebral-column', name:'Vertebral Column', latin:'Columna vertebralis', system:'skeletal',
      func:'33 vertebrae stacked to protect the spinal cord and support the body.',
      facts:['7 cervical, 12 thoracic, 5 lumbar, 5 sacral (fused), 4 coccygeal (fused)'],
      view:'skeleton' },
    { id:'pectoralis',   name:'Pectoralis Major',   latin:'Musculus pectoralis major', system:'muscular',
      func:'Large chest muscle; flexes, adducts, and medially rotates the arm.',
      view:'front' },
    { id:'rectus-abdominis', name:'Rectus Abdominis', latin:'Musculus rectus abdominis', system:'muscular',
      func:'Front abdominal muscle ("six-pack"); flexes the trunk.',
      view:'front' },
    { id:'latissimus',   name:'Latissimus Dorsi',   latin:'Musculus latissimus dorsi', system:'muscular',
      func:'Broad back muscle; extends, adducts, and medially rotates the arm.',
      view:'back' },
    { id:'trapezius',    name:'Trapezius',          latin:'Musculus trapezius',   system:'muscular',
      func:'Upper back/neck muscle; moves and stabilizes the scapula.',
      view:'back' },

    // ── ENDOCRINE EXTRAS ────────────────────────────────────────────
    { id:'pituitary',    name:'Pituitary Gland',    latin:'Hypophysis',           system:'endocrine',
      func:'"Master gland" — controls growth, thyroid, adrenals, gonads, and water balance.',
      facts:['Pea-sized, at the base of the brain'] },
    { id:'thyroid',      name:'Thyroid',            latin:'Glandula thyroidea',   system:'endocrine',
      func:'Butterfly-shaped neck gland regulating metabolism via T3/T4.',
      facts:['Calcitonin lowers blood calcium'] },
    { id:'pineal',       name:'Pineal Gland',       latin:'Glandula pinealis',    system:'endocrine',
      func:'Secretes melatonin to regulate sleep-wake cycles.' },

    // ── SKIN / IMMUNE / BLOOD ───────────────────────────────────────
    { id:'skin',         name:'Skin',               latin:'Integumentum commune', system:'integumentary',
      func:'Largest organ; barrier, thermoregulation, sensation, vitamin D synthesis.',
      facts:['~1.5–2 m² surface','Epidermis, dermis, hypodermis'] },
    { id:'lymph-nodes',  name:'Lymph Nodes',        latin:'Nodi lymphatici',      system:'immune',
      func:'Filter lymph and host lymphocytes that mount immune responses.',
      facts:['~600 nodes throughout the body'] },
    { id:'bone-marrow',  name:'Bone Marrow',        latin:'Medulla ossium',       system:'immune',
      func:'Site of blood cell production (hematopoiesis); red and yellow marrow.',
      facts:['Produces ~500 billion blood cells per day'] },
];

let anatCurrentFile = null;
let anatSelectedId  = null;
let anatSearch      = '';
let anatExpanded    = new Set();  // expanded system ids
let anatSaveTimer   = null;

// Default real interactive 3D anatomy model — Sketchfab embed of a public
// CC-licensed full human anatomy scene. Users can paste any embed URL.
const ANATOMY_DEFAULT_3D =
    'https://sketchfab.com/models/31b40fd809b14665b93773936d67c52c/embed?autostart=1&ui_theme=dark&ui_infos=0&ui_inspector=0';


// ── 3D iframe embed ────────────────────────────────────────────────
function anatRenderView() {
    const iframe = document.getElementById('anatomy-iframe');
    const urlIn  = document.getElementById('anatomy-url-input');
    const ext    = document.getElementById('anatomy-open-external');
    const placeholder = document.getElementById('anatomy-iframe-placeholder');
    if (!iframe) return;

    const data = anatCurrentFile ? (_sciReadFile(anatCurrentFile) || {}) : {};
    const url  = data.modelUrl || ANATOMY_DEFAULT_3D;

    if (iframe.getAttribute('src') !== url) {
        // Show loading state while iframe loads
        if (placeholder) { placeholder.style.display = 'flex'; iframe.style.opacity = '0'; }
        iframe.setAttribute('src', url);
        iframe.onload = () => {
            if (placeholder) placeholder.style.display = 'none';
            iframe.style.opacity = '1';
        };
        iframe.onerror = () => {
            if (placeholder) {
                placeholder.innerHTML = `<div class="text-slate-500 text-xs text-center p-4">
                    <i class="fas fa-exclamation-triangle text-amber-500 text-2xl mb-2 block"></i>
                    Could not load the 3D model.<br>
                    <span class="text-[10px]">Paste a different URL above, or check your internet connection.</span>
                </div>`;
                placeholder.style.display = 'flex';
            }
        };
    }
    if (urlIn) urlIn.value = data.modelUrl || '';
    if (ext)   ext.setAttribute('href', url);
}

function anatFilteredIds() {
    const q = anatSearch.toLowerCase().trim();
    if (!q) return new Set(ANATOMY_PARTS.map(p => p.id));
    return new Set(ANATOMY_PARTS
        .filter(p => p.name.toLowerCase().includes(q)
                  || (p.latin || '').toLowerCase().includes(q)
                  || p.system.toLowerCase().includes(q)
                  || (p.func || '').toLowerCase().includes(q))
        .map(p => p.id));
}

function anatRenderBrowser() {
    const wrap = document.getElementById('anatomy-browser');
    if (!wrap) return;
    const data = anatCurrentFile ? (_sciReadFile(anatCurrentFile) || { notes: {} }) : { notes: {} };
    const matchIds = anatFilteredIds();
    wrap.innerHTML = '';

    ANATOMY_SYSTEMS.forEach(sys => {
        const sysParts = ANATOMY_PARTS.filter(p => p.system === sys.id && matchIds.has(p.id));
        if (anatSearch && sysParts.length === 0) return;

        const header = document.createElement('div');
        const isOpen = anatExpanded.has(sys.id) || !!anatSearch;
        header.className = 'anatomy-sys-header' + (isOpen ? ' open' : '');
        header.innerHTML = `
            <i class="fas fa-chevron-right caret text-[8px]"></i>
            <i class="fas ${sys.icon} text-[10px]" style="color:${sys.color}"></i>
            <span class="flex-1">${sys.name}</span>
            <span class="text-slate-600 text-[9px]">${sysParts.length}</span>
        `;
        header.onclick = () => {
            if (anatExpanded.has(sys.id)) anatExpanded.delete(sys.id);
            else anatExpanded.add(sys.id);
            anatRenderBrowser();
        };
        wrap.appendChild(header);

        if (isOpen) {
            sysParts.forEach(p => {
                const btn = document.createElement('div');
                btn.className = 'anatomy-part-btn' + (anatSelectedId === p.id ? ' active' : '');
                const hasNote = data.notes && data.notes[p.id];
                btn.innerHTML = `
                    <span class="dot" style="background:${sys.color}"></span>
                    <span class="flex-1 truncate">${p.name}</span>
                    ${hasNote ? '<span class="has-note"></span>' : ''}
                `;
                btn.title = p.latin || p.name;
                btn.onclick = () => anatSelectPart(p.id);
                wrap.appendChild(btn);
            });
        }
    });
}

function anatSelectPart(id) {
    anatSaveNow();
    const part = ANATOMY_PARTS.find(p => p.id === id);
    if (!part) return;
    anatSelectedId = id;

    const sys = ANATOMY_SYSTEMS.find(s => s.id === part.system);
    const ic = document.getElementById('anatomy-current-icon');
    if (sys) { ic.className = `fas ${sys.icon} text-[11px]`; ic.style.color = sys.color; }
    document.getElementById('anatomy-current-name').textContent = part.name;

    const facts = (part.facts || []).map(f => `<li>${f}</li>`).join('');
    document.getElementById('anatomy-detail').innerHTML = `
        <div class="text-slate-100 text-sm font-semibold">${part.name}</div>
        ${part.latin ? `<div class="text-slate-500 italic text-[10.5px] mt-0.5">${part.latin}</div>` : ''}
        <div class="text-[10px] uppercase tracking-wide text-slate-500 mt-3 mb-1">System</div>
        <div class="text-slate-300 text-xs">${sys ? sys.name : part.system}</div>
        <div class="text-[10px] uppercase tracking-wide text-slate-500 mt-3 mb-1">Function</div>
        <div class="text-slate-300 text-xs leading-relaxed">${part.func || '—'}</div>
        ${facts ? `
            <div class="text-[10px] uppercase tracking-wide text-slate-500 mt-3 mb-1">Key facts</div>
            <ul class="list-disc list-inside text-slate-300 text-xs space-y-0.5">${facts}</ul>
        ` : ''}
    `;

    const data = anatCurrentFile ? (_sciReadFile(anatCurrentFile) || { notes: {} }) : { notes: {} };
    document.getElementById('anatomy-notes').value = (data.notes && data.notes[id]) || '';

    // Make sure system is expanded so the part is visible in the tree
    anatExpanded.add(part.system);
    anatRenderBrowser();
}

function anatSaveNow() {
    if (!anatCurrentFile || !anatSelectedId) return;
    const data = _sciReadFile(anatCurrentFile) || { notes: {} };
    if (!data.notes) data.notes = {};
    const v = document.getElementById('anatomy-notes').value;
    if (v) data.notes[anatSelectedId] = v; else delete data.notes[anatSelectedId];
    _sciWriteFile(anatCurrentFile, data);
}

function openVaultAnatomyEditor(file) {
    anatCurrentFile = file;
    document.getElementById('vault-normal-view').style.display = 'none';
    document.getElementById('vault-anatomy-area').style.display = 'flex';
    document.getElementById('vault-viewer-title').classList.add('hidden');
    const titleInput = document.getElementById('vault-doc-title-input');
    titleInput.classList.remove('hidden');
    titleInput.value = file.originalName;

    anatSelectedId = null;
    anatSearch = '';
    anatExpanded = new Set();
    document.getElementById('anatomy-search').value = '';
    document.getElementById('anatomy-current-name').textContent = 'Select a body part';
    document.getElementById('anatomy-current-icon').className = 'fas fa-heartbeat text-[11px]';
    document.getElementById('anatomy-current-icon').style.color = '#f87171';
    document.getElementById('anatomy-detail').innerHTML =
        `<p class="text-slate-500 italic text-xs">Spin and zoom the live 3D model on the right. Pick a body part from the browser on the left to read its description, or paste any Sketchfab / BioDigital embed URL above to load a different model.</p>`;
    document.getElementById('anatomy-notes').value = '';

    // Reset iframe so it reloads with loading indicator visible
    const iframeEl = document.getElementById('anatomy-iframe');
    if (iframeEl) { iframeEl.removeAttribute('src'); iframeEl.style.opacity = '0'; }
    const ph = document.getElementById('anatomy-iframe-placeholder');
    if (ph) {
        ph.style.display = 'flex';
        ph.innerHTML = `<div class="text-slate-600 text-xs text-center">
            <i class="fas fa-circle-notch fa-spin text-red-400 text-2xl mb-2 block"></i>
            Loading 3D model…
        </div>`;
    }

    anatRenderView();
    anatRenderBrowser();
}

function closeVaultAnatomyEditor() {
    anatSaveNow();
    anatCurrentFile = null;
    document.getElementById('vault-anatomy-area').style.display = 'none';
    document.getElementById('vault-normal-view').style.display = '';
    document.getElementById('vault-viewer-title').classList.remove('hidden');
    document.getElementById('vault-doc-title-input').classList.add('hidden');
}

function initAnatomyTool() {
    const newBtn = document.getElementById('vault-new-anatomy-btn');
    if (newBtn) newBtn.onclick = () => _sciCreateFile(
        'New Anatomy Atlas', 'isAnatomy', '.anat.json', { notes: {} });

    const notes = document.getElementById('anatomy-notes');
    if (notes) notes.oninput = () => {
        clearTimeout(anatSaveTimer);
        anatSaveTimer = setTimeout(anatSaveNow, 400);
    };

    const search = document.getElementById('anatomy-search');
    if (search) search.oninput = e => {
        anatSearch = e.target.value;
        anatRenderBrowser();
    };

    // URL input — saves a custom embed URL per file
    const urlInput = document.getElementById('anatomy-url-input');
    if (urlInput) {
        let urlTimer;
        urlInput.oninput = () => {
            clearTimeout(urlTimer);
            urlTimer = setTimeout(() => {
                if (!anatCurrentFile) return;
                const data = _sciReadFile(anatCurrentFile) || {};
                const val = urlInput.value.trim();
                if (val) data.modelUrl = val; else delete data.modelUrl;
                _sciWriteFile(anatCurrentFile, data);
                anatRenderView();
            }, 600);
        };
    }
    const urlReset = document.getElementById('anatomy-url-reset');
    if (urlReset) urlReset.onclick = () => {
        if (!anatCurrentFile) return;
        const data = _sciReadFile(anatCurrentFile) || {};
        delete data.modelUrl;
        _sciWriteFile(anatCurrentFile, data);
        document.getElementById('anatomy-url-input').value = '';
        anatRenderView();
    };
}

// ====================================================================
// 5. CHESS STRATEGY BOARD
// ====================================================================
const STRAT_UNICODE = {
    K:'♔', Q:'♕', R:'♖', B:'♗', N:'♘', P:'♙',
    k:'♚', q:'♛', r:'♜', b:'♝', n:'♞', p:'♟',
};
const STRAT_SQUARE_LIGHT = '#f0d9b5';
const STRAT_SQUARE_DARK  = '#b58863';
const STRAT_STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';

let stratState = { pieces:{}, arrows:[], highlights:{}, notes:'' };
let stratFile        = null;
let stratTool        = 'piece';
let stratActivePiece = 'N';
let stratActiveColor = '#4ade80';
let stratSaveTimer   = null;
let stratCssSize     = 400;
let stratDpr         = 1;
let stratResizeObs   = null;

// ── Piece movement rules ─────────────────────────────────────────────
// Returns the set of squares that piece `code` placed on `sq` can reach,
// respecting blocking pieces already on the board.
function _stratPieceMoves(sq, code) {
    const type = code.toUpperCase();
    const { col, row } = _stratSqCoords(sq);
    const targets = [];
    const inBoard = (c, r) => c >= 0 && c < 8 && r >= 0 && r < 8;
    const push    = (c, r) => { if (inBoard(c, r)) targets.push(_stratSq(c, r)); };
    const slide   = (dc, dr) => {
        let c = col + dc, r = row + dr;
        while (inBoard(c, r)) {
            targets.push(_stratSq(c, r));
            if (stratState.pieces[_stratSq(c, r)]) break; // blocked
            c += dc; r += dr;
        }
    };

    if      (type === 'N') [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]].forEach(([dc,dr]) => push(col+dc, row+dr));
    else if (type === 'K') [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]].forEach(([dc,dr]) => push(col+dc, row+dr));
    else if (type === 'R') [[1,0],[-1,0],[0,1],[0,-1]].forEach(([dc,dr]) => slide(dc,dr));
    else if (type === 'B') [[1,1],[1,-1],[-1,1],[-1,-1]].forEach(([dc,dr]) => slide(dc,dr));
    else if (type === 'Q') [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]].forEach(([dc,dr]) => slide(dc,dr));
    else if (type === 'P') {
        const isWhite = code === 'P';
        const dir = isWhite ? -1 : 1, startRow = isWhite ? 6 : 1;
        push(col, row + dir);
        if (row === startRow) push(col, row + 2*dir);
        [-1,1].forEach(dc => push(col+dc, row+dir));
    }
    return targets;
}

// ── Coordinate helpers ────────────────────────────────────────────
function _stratSq(col, row) {
    // col: 0=a, row: 0=rank-8-top, 7=rank-1-bottom
    return String.fromCharCode(97 + col) + (8 - row);
}
function _stratSqCoords(sq) {
    return { col: sq.charCodeAt(0) - 97, row: 8 - parseInt(sq[1]) };
}
function _stratSqFromXY(x, y, cellCss) {
    const col = Math.floor(x / cellCss);
    const row = Math.floor(y / cellCss);
    if (col < 0 || col > 7 || row < 0 || row > 7) return null;
    return _stratSq(col, row);
}
function _stratFenToPieces(fen) {
    const out = {};
    fen.split('/').forEach((row, r) => {
        let c = 0;
        for (const ch of row) {
            if (/\d/.test(ch)) c += parseInt(ch);
            else { out[_stratSq(c, r)] = ch; c++; }
        }
    });
    return out;
}

// ── Rendering ────────────────────────────────────────────────────
function stratDraw() {
    const canvas = document.getElementById('strat-canvas');
    if (!canvas) return;
    const ctx  = canvas.getContext('2d');
    const cell = stratCssSize / 8;

    ctx.clearRect(0, 0, stratCssSize, stratCssSize);

    // Squares + highlights
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            const sq = _stratSq(c, r);
            const hl = stratState.highlights[sq];
            ctx.fillStyle = hl
                ? hl + 'bb'
                : (c + r) % 2 === 0 ? STRAT_SQUARE_LIGHT : STRAT_SQUARE_DARK;
            ctx.fillRect(c * cell, r * cell, cell, cell);
        }
    }

    // Coordinate labels
    ctx.font = `bold ${cell * 0.175}px sans-serif`;
    for (let c = 0; c < 8; c++) {
        ctx.fillStyle = c % 2 === 0 ? STRAT_SQUARE_DARK : STRAT_SQUARE_LIGHT;
        ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
        ctx.fillText(String.fromCharCode(97 + c), (c + 1) * cell - cell * 0.04, stratCssSize - cell * 0.04);
    }
    for (let r = 0; r < 8; r++) {
        ctx.fillStyle = r % 2 === 0 ? STRAT_SQUARE_DARK : STRAT_SQUARE_LIGHT;
        ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        ctx.fillText(String(8 - r), r * 0 + cell * 0.04, r * cell + cell * 0.04);
    }

    // Pieces
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `${cell * 0.7}px serif`;
    for (const [sq, code] of Object.entries(stratState.pieces)) {
        const { col, row } = _stratSqCoords(sq);
        const x = (col + 0.5) * cell, y = (row + 0.5) * cell;
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.fillText(STRAT_UNICODE[code] || '?', x + cell * 0.03, y + cell * 0.04);
        ctx.fillStyle = code === code.toUpperCase() ? '#ffffff' : '#1e1e1e';
        ctx.fillText(STRAT_UNICODE[code] || '?', x, y);
    }

    // Arrows
    stratState.arrows.forEach(a => _stratDrawArrow(ctx, a.from, a.to, a.color, cell));

    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
}

function _stratDrawArrow(ctx, from, to, color, cell) {
    if (from === to) return;
    const { col: fc, row: fr } = _stratSqCoords(from);
    const { col: tc, row: tr } = _stratSqCoords(to);
    const x1 = (fc + 0.5) * cell, y1 = (fr + 0.5) * cell;
    const x2 = (tc + 0.5) * cell, y2 = (tr + 0.5) * cell;
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (len < 1) return;
    const headLen = cell * 0.36, shaftEnd = len - headLen * 0.65;
    const dx = (x2 - x1) / len, dy = (y2 - y1) / len;
    const ex = x1 + dx * shaftEnd, ey = y1 + dy * shaftEnd;

    ctx.save();
    ctx.globalAlpha = 0.82;
    ctx.strokeStyle = color; ctx.fillStyle = color;
    ctx.lineWidth = cell * 0.14; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(ex, ey); ctx.stroke();
    const ang = Math.atan2(y2 - y1, x2 - x1);
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - headLen * Math.cos(ang - 0.44), y2 - headLen * Math.sin(ang - 0.44));
    ctx.lineTo(x2 - headLen * Math.cos(ang + 0.44), y2 - headLen * Math.sin(ang + 0.44));
    ctx.closePath(); ctx.fill();
    ctx.restore();
}

function _stratResize() {
    const canvas = document.getElementById('strat-canvas');
    const wrap   = document.getElementById('strat-canvas-wrap');
    if (!canvas || !wrap) return;
    const rect = wrap.getBoundingClientRect();
    const size = Math.min(Math.floor(rect.width - 24), Math.floor(rect.height - 24), 640);
    if (size < 40) return;
    stratDpr     = window.devicePixelRatio || 1;
    stratCssSize = size;
    canvas.width  = size * stratDpr;
    canvas.height = size * stratDpr;
    canvas.style.width  = size + 'px';
    canvas.style.height = size + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(stratDpr, 0, 0, stratDpr, 0, 0);
    stratDraw();
}

// ── Persistence ───────────────────────────────────────────────────
function _stratScheduleSave() {
    clearTimeout(stratSaveTimer);
    const s = document.getElementById('strat-save-status');
    if (s) s.textContent = 'saving…';
    stratSaveTimer = setTimeout(() => {
        if (!stratFile) return;
        _sciWriteFile(stratFile, {
            pieces:     stratState.pieces,
            arrows:     stratState.arrows,
            highlights: stratState.highlights,
            notes:      stratState.notes,
        });
        renderVaultGrid();
        const s2 = document.getElementById('strat-save-status');
        if (s2) s2.textContent = 'saved';
    }, 700);
}

// ── Build piece palette buttons ───────────────────────────────────
function _stratBuildPalette() {
    [['white', ['K','Q','R','B','N','P'], ['♔','♕','♖','♗','♘','♙']],
     ['black', ['k','q','r','b','n','p'], ['♚','♛','♜','♝','♞','♟']]].forEach(([side, codes, syms]) => {
        const el = document.getElementById(`strat-${side}-pieces`);
        if (!el) return;
        el.innerHTML = codes.map((code, i) =>
            `<button data-strat-piece="${code}"
                class="strat-piece-btn text-xl h-9 w-9 flex items-center justify-center rounded-lg
                       bg-slate-800 hover:bg-slate-700 border transition-colors cursor-pointer
                       ${stratActivePiece === code ? 'border-amber-500 bg-amber-900/30' : 'border-slate-700/60'}"
                title="${code.toUpperCase()}">${syms[i]}</button>`
        ).join('');
        el.querySelectorAll('[data-strat-piece]').forEach(btn => {
            btn.onclick = () => {
                stratActivePiece = btn.dataset.stratPiece;
                stratTool = 'piece';
                _stratSyncToolBtns();
                document.querySelectorAll('[data-strat-piece]').forEach(b => {
                    b.classList.toggle('border-amber-500', b === btn);
                    b.classList.toggle('bg-amber-900/30',  b === btn);
                    b.classList.toggle('border-slate-700/60', b !== btn);
                });
            };
        });
    });
}

function _stratSyncToolBtns() {
    document.querySelectorAll('[data-strat-tool]').forEach(b => {
        const active = b.dataset.stratTool === stratTool;
        b.classList.toggle('bg-amber-600',  active);
        b.classList.toggle('text-white',    active);
        b.classList.toggle('bg-slate-800',  !active);
        b.classList.toggle('text-slate-400',!active);
    });
}

// ── Open / Close ─────────────────────────────────────────────────
function openVaultChessStrategyEditor(file) {
    stratFile = file;
    const saved = _sciReadFile(file) || {};
    stratState = {
        pieces:     saved.pieces     || _stratFenToPieces(STRAT_STARTING_FEN),
        arrows:     saved.arrows     || [],
        highlights: saved.highlights || {},
        notes:      saved.notes      || '',
    };
    stratTool        = 'piece';
    stratActivePiece = 'N';
    stratActiveColor = '#4ade80';

    // Hide normal view, show strategy area
    document.getElementById('vault-normal-view').style.display = 'none';
    const area = document.getElementById('vault-chessstrategy-area');
    if (area) area.style.display = '';

    // Title
    const titleSpan = document.getElementById('vault-viewer-title');
    if (titleSpan) { titleSpan.textContent = file.originalName; titleSpan.classList.remove('hidden'); }
    document.getElementById('vault-doc-title-input')?.classList.add('hidden');

    // Build palettes
    _stratBuildPalette();
    _stratSyncToolBtns();

    // Wire tool buttons
    document.querySelectorAll('[data-strat-tool]').forEach(btn => {
        btn.onclick = () => { stratTool = btn.dataset.stratTool; _stratSyncToolBtns(); };
    });

    // Wire color buttons
    document.querySelectorAll('[data-strat-color]').forEach(btn => {
        btn.style.outline = btn.dataset.stratColor === stratActiveColor ? '2px solid white' : 'none';
        btn.style.outlineOffset = '2px';
        btn.onclick = () => {
            stratActiveColor = btn.dataset.stratColor;
            document.querySelectorAll('[data-strat-color]').forEach(b => {
                b.style.outline = b === btn ? '2px solid white' : 'none';
            });
        };
    });

    // Notes
    const notesEl = document.getElementById('strat-notes');
    if (notesEl) {
        notesEl.value    = stratState.notes;
        notesEl.oninput  = () => { stratState.notes = notesEl.value; _stratScheduleSave(); };
    }

    // Clear board
    const clearBtn = document.getElementById('strat-clear-btn');
    if (clearBtn) clearBtn.onclick = () => {
        if (!confirm('Clear the board and all arrows/highlights?')) return;
        stratState.pieces = {}; stratState.arrows = []; stratState.highlights = {};
        stratDraw(); _stratScheduleSave();
    };

    // Starting position
    const startBtn = document.getElementById('strat-start-pos-btn');
    if (startBtn) startBtn.onclick = () => {
        stratState.pieces = _stratFenToPieces(STRAT_STARTING_FEN);
        stratState.arrows = []; stratState.highlights = {};
        stratDraw(); _stratScheduleSave();
    };

    // ── Canvas interaction ──────────────────────────────────────
    const canvas = document.getElementById('strat-canvas');
    if (canvas) {
        canvas.oncontextmenu = e => e.preventDefault();
        let arrowFrom = null, validSquares = null, dragging = false;

        canvas.onpointerdown = e => {
            e.preventDefault();
            const rect    = canvas.getBoundingClientRect();
            const cellCss = rect.width / 8;
            const sq = _stratSqFromXY(e.clientX - rect.left, e.clientY - rect.top, cellCss);
            if (!sq) return;

            if (e.button === 2) {
                delete stratState.pieces[sq];
                delete stratState.highlights[sq];
                stratState.arrows = stratState.arrows.filter(a => a.from !== sq && a.to !== sq);
                stratDraw(); _stratScheduleSave(); return;
            }

            if (stratTool === 'arrow') {
                arrowFrom = sq;
                dragging  = true;
                // If there's a piece on this square, pre-compute where it can go
                const piece = stratState.pieces[sq];
                validSquares = piece ? new Set(_stratPieceMoves(sq, piece)) : null;
                canvas.setPointerCapture(e.pointerId);
                return;
            }
            if (stratTool === 'piece') {
                stratState.pieces[sq] = stratActivePiece;
                stratDraw(); _stratScheduleSave(); return;
            }
            if (stratTool === 'highlight') {
                if (stratState.highlights[sq] === stratActiveColor) delete stratState.highlights[sq];
                else stratState.highlights[sq] = stratActiveColor;
                stratDraw(); _stratScheduleSave(); return;
            }
            if (stratTool === 'erase') {
                delete stratState.pieces[sq]; delete stratState.highlights[sq];
                stratState.arrows = stratState.arrows.filter(a => a.from !== sq && a.to !== sq);
                stratDraw(); _stratScheduleSave();
            }
        };

        canvas.onpointermove = e => {
            if (!dragging || stratTool !== 'arrow' || !arrowFrom) return;
            const rect    = canvas.getBoundingClientRect();
            const cellCss = rect.width / 8;
            const sqTo    = _stratSqFromXY(e.clientX - rect.left, e.clientY - rect.top, cellCss);

            stratDraw(); // clear previous preview
            const ctx = canvas.getContext('2d');

            // Dim invalid squares when constrained to piece moves
            if (validSquares) {
                ctx.save();
                ctx.fillStyle = 'rgba(0,0,0,0.45)';
                for (let r = 0; r < 8; r++) {
                    for (let c = 0; c < 8; c++) {
                        const s = _stratSq(c, r);
                        if (s !== arrowFrom && !validSquares.has(s)) {
                            ctx.fillRect(c * cellCss, r * cellCss, cellCss, cellCss);
                        }
                    }
                }
                ctx.restore();
            }

            if (sqTo && sqTo !== arrowFrom) {
                const isValid = !validSquares || validSquares.has(sqTo);
                // Preview arrow: full colour if valid, red-tinted if not
                const previewColor = isValid ? stratActiveColor : 'rgba(239,68,68,0.7)';
                _stratDrawArrow(ctx, arrowFrom, sqTo, previewColor, cellCss);
            }
        };

        canvas.onpointerup = e => {
            if (!dragging || stratTool !== 'arrow') { dragging = false; return; }
            dragging = false;
            const rect    = canvas.getBoundingClientRect();
            const cellCss = rect.width / 8;
            const sqTo    = _stratSqFromXY(e.clientX - rect.left, e.clientY - rect.top, cellCss);

            if (sqTo && sqTo !== arrowFrom) {
                // Block arrow if the from-square has a piece that can't reach sqTo
                const isValid = !validSquares || validSquares.has(sqTo);
                if (isValid) {
                    const idx = stratState.arrows.findIndex(a => a.from === arrowFrom && a.to === sqTo);
                    if (idx >= 0) stratState.arrows.splice(idx, 1); // toggle off
                    else stratState.arrows.push({ from: arrowFrom, to: sqTo, color: stratActiveColor });
                    _stratScheduleSave();
                }
            }
            arrowFrom    = null;
            validSquares = null;
            stratDraw();
        };
    }

    // ResizeObserver
    if (stratResizeObs) stratResizeObs.disconnect();
    const wrap = document.getElementById('strat-canvas-wrap');
    if (wrap) {
        stratResizeObs = new ResizeObserver(() => _stratResize());
        stratResizeObs.observe(wrap);
    }
    // Initial paint after layout
    requestAnimationFrame(() => requestAnimationFrame(() => _stratResize()));
}

function closeVaultChessStrategyEditor() {
    const area = document.getElementById('vault-chessstrategy-area');
    if (area) area.style.display = 'none';
    document.getElementById('vault-normal-view').style.display = '';
    document.getElementById('vault-viewer-title')?.classList.remove('hidden');
    document.getElementById('vault-doc-title-input')?.classList.add('hidden');
    if (stratResizeObs) { stratResizeObs.disconnect(); stratResizeObs = null; }
    clearTimeout(stratSaveTimer);
    if (stratFile) {
        _sciWriteFile(stratFile, {
            pieces: stratState.pieces, arrows: stratState.arrows,
            highlights: stratState.highlights, notes: stratState.notes,
        });
    }
    stratFile = null;
}

function initChessStrategyTool() {
    const newBtn = document.getElementById('vault-new-chessstrategy-btn');
    if (newBtn) newBtn.onclick = () => _sciCreateFile(
        'New Strategy Board', 'isChessStrategy', '.chess.json',
        { pieces: {}, arrows: [], highlights: {}, notes: '' });
}

// ====================================================================
// Physics Simulation — Vault integration
// ====================================================================
function openVaultPhysicsEditor(file) {
    const area = document.getElementById('vault-physics-area');
    if (!area) return;
    area.style.display = 'flex';
    document.getElementById('vault-normal-view').style.display = 'none';
    // Show editable title
    document.getElementById('vault-viewer-title')?.classList.add('hidden');
    const titleInput = document.getElementById('vault-doc-title-input');
    if (titleInput) {
        titleInput.classList.remove('hidden');
        titleInput.value = file.originalName.replace(/\.phys\.json$/, '');
    }

    // ── Wire 2D / 3D mode toggle ──────────────────────────────────────
    const btn2d        = document.getElementById('phys-mode-2d');
    const btn3d        = document.getElementById('phys-mode-3d');
    const canvasWrap   = document.getElementById('phys-canvas-wrap');
    const controlsBar  = document.getElementById('phys-2d-controls-bar');
    const container3d  = document.getElementById('phys3d-container');

    function _setPhysBtn(btn, active) {
        if (!btn) return;
        btn.style.background = active ? 'rgba(var(--accent-rgb),0.15)' : '';
        btn.style.color      = active ? 'var(--accent-light, #06b6d4)'  : '';
    }

    function _activate2D() {
        _setPhysBtn(btn2d, true);
        _setPhysBtn(btn3d, false);
        if (canvasWrap)  canvasWrap.style.display  = '';
        if (controlsBar) controlsBar.style.display = '';
        if (container3d) container3d.style.display = 'none';
        if (typeof stopPhysics3D === 'function') stopPhysics3D();
        if (typeof initPhysics   === 'function') initPhysics();
    }

    function _activate3D() {
        _setPhysBtn(btn3d, true);
        _setPhysBtn(btn2d, false);
        if (canvasWrap)  canvasWrap.style.display  = 'none';
        if (controlsBar) controlsBar.style.display = 'none';
        if (container3d) container3d.style.display = 'flex';
        if (typeof stopPhysics   === 'function') stopPhysics();
        if (typeof initPhysics3D === 'function') initPhysics3D();
    }

    if (btn2d) btn2d.onclick = _activate2D;
    if (btn3d) btn3d.onclick = _activate3D;

    // Wire play/pause and reset buttons to also work in 3D mode
    const playBtn  = document.getElementById('phys-play-btn');
    const resetBtn = document.getElementById('phys-reset-btn');
    if (playBtn) {
        playBtn._origOnclick = playBtn.onclick;
        playBtn.onclick = () => {
            if (container3d && container3d.style.display !== 'none') {
                if (typeof pausePhysics3D === 'function') pausePhysics3D();
            } else {
                playBtn._origOnclick && playBtn._origOnclick();
            }
        };
    }
    if (resetBtn) {
        resetBtn._origOnclick = resetBtn.onclick;
        resetBtn.onclick = () => {
            if (container3d && container3d.style.display !== 'none') {
                if (typeof stopPhysics3D === 'function') stopPhysics3D();
                if (typeof initPhysics3D === 'function') initPhysics3D();
            } else {
                resetBtn._origOnclick && resetBtn._origOnclick();
            }
        };
    }

    // Default to 2D mode on open — defer until after the browser has reflowed
    // the newly-visible area (getBoundingClientRect returns 0×0 otherwise)
    requestAnimationFrame(() => requestAnimationFrame(() => _activate2D()));
}

function closeVaultPhysicsEditor() {
    const area = document.getElementById('vault-physics-area');
    if (area) area.style.display = 'none';
    document.getElementById('vault-normal-view').style.display = '';
    document.getElementById('vault-viewer-title')?.classList.remove('hidden');
    document.getElementById('vault-doc-title-input')?.classList.add('hidden');
    if (typeof stopPhysics3D === 'function') stopPhysics3D();
    if (typeof stopPhysics   === 'function') stopPhysics();
}

function initPhysicsTool() {
    const newBtn = document.getElementById('vault-new-physics-btn');
    if (newBtn) newBtn.onclick = () => _sciCreateFile(
        'New Physics Simulation', 'isPhysics', '.phys.json',
        { simId: 'projectile', version: 1 });
}

// ====================================================================
// Master init
// ====================================================================
function initVaultScience() {
    initMoleculeBuilder();
    initPeriodicTable();
    initDNATool();
    initAnatomyTool();
    initChessStrategyTool();
    initPhysicsTool();
}

document.addEventListener('DOMContentLoaded', initVaultScience);
