// ── Vault links (Obsidian-style) ─────────────────────────────────────
// Adds [[wikilinks]], backlinks, and manual links between any two files.
// (The force-directed graph view this file used to carry was removed — the
// links themselves stayed, since notes reference each other by name.)
//
// Depends on (all global, loaded earlier):
//   globals.js → fs, path, VAULT_DIR, VAULT_FILE
//   vault.js   → vaultData, vaultActiveFolderId, openVaultFile,
//                saveVaultData, renderVaultGrid, renderVaultFolders, vaultIcon
//
// Data model:
//   Manual links live in  vaultData.links = [{from, to}]  (undirected, deduped).
//   Wikilinks  [[Name]]  are parsed live from note text and merged at
//   graph-build time — they are never persisted, so editing a note's text
//   (in the app, by the in-app AI, or by Claude over MCP) instantly reshapes
//   the graph with no extra bookkeeping.

// ── Link store ───────────────────────────────────────────────────────
function _vaultLinks() {
    if (!Array.isArray(vaultData.links)) vaultData.links = [];
    return vaultData.links;
}
function vaultAddLink(a, b) {
    if (!a || !b || a === b) return false;
    const links = _vaultLinks();
    if (links.some(l => (l.from === a && l.to === b) || (l.from === b && l.to === a))) return false;
    links.push({ from: a, to: b });
    saveVaultData();
    return true;
}
function vaultRemoveLink(a, b) {
    const links = _vaultLinks();
    const before = links.length;
    vaultData.links = links.filter(l => !((l.from === a && l.to === b) || (l.from === b && l.to === a)));
    if (vaultData.links.length !== before) { saveVaultData(); return true; }
    return false;
}

// ── Note text reading ────────────────────────────────────────────────
const _VAULT_NOTE_EXT = new Set(['md', 'markdown', 'txt']);
function _vaultExtOf(name) { return (String(name || '').split('.').pop() || '').toLowerCase(); }
function _vaultIsNoteFile(f) {
    if (!f) return false;
    if (f.isDoc) return true;                       // .vulsor rich-text docs
    return _VAULT_NOTE_EXT.has(_vaultExtOf(f.originalName));
}
// Raw text of a note for link scanning (HTML stripped for .vulsor docs).
function vaultNoteText(f) {
    try {
        if (!f || !f.storedName) return '';
        const p = path.join(VAULT_DIR, f.storedName);
        if (!fs.existsSync(p)) return '';
        let t = fs.readFileSync(p, 'utf8');
        if (f.isDoc) t = t.replace(/<[^>]+>/g, ' ');
        return t;
    } catch (_) { return ''; }
}

// ── Wikilinks ────────────────────────────────────────────────────────
// Matches [[Name]], [[Name|alias]] and [[Name#heading]].
function vaultExtractWikilinks(text) {
    const out = [];
    if (!text) return out;
    const re = /\[\[([^\]\n|#]+)(?:[#|][^\]\n]*)?\]\]/g;
    let m;
    while ((m = re.exec(text))) {
        const name = m[1].trim();
        if (name) out.push(name);
    }
    return out;
}
function _vaultNormName(s) {
    return String(s || '').trim().toLowerCase().replace(/\.(md|markdown|txt|vulsor)$/, '');
}
// Resolve a wikilink target → file id (by originalName, extension-insensitive).
function vaultResolveLink(name) {
    const key = _vaultNormName(name);
    const f = (vaultData.files || []).find(x => _vaultNormName(x.originalName) === key);
    return f ? f.id : null;
}

// Click handler for [[wikilinks]] rendered in markdown. Opens the target
// note; if it doesn't exist yet, offers to create it (Obsidian behaviour).
function vaultGraphOpenByName(name) {
    const id = vaultResolveLink(name);
    if (id) { openVaultFile(id); return; }
    if (confirm(`Note "${name}" doesn't exist yet. Create it?`)) {
        const f = vaultCreateNote(name, `# ${name}\n`);
        openVaultFile(f.id);
    }
}

// ── Note creation (shared by AI tools + unresolved wikilinks) ─────────
function vaultCreateNote(name, content) {
    let base = String(name || 'Untitled').replace(/[\/\\:*?"<>|]/g, '-').trim() || 'Untitled';
    if (!/\.(md|markdown|txt)$/i.test(base)) base += '.md';
    const id = 'vf_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    const storedName = id + '.md';
    const body = (content == null) ? `# ${base.replace(/\.md$/i, '')}\n` : String(content);
    fs.writeFileSync(path.join(VAULT_DIR, storedName), body);
    const fileObj = {
        id, originalName: base, storedName,
        folderId: (typeof vaultActiveFolderId !== 'undefined') ? vaultActiveFolderId : null,
        notes: '', pageNotes: {}, addedAt: Date.now(),
        size: Buffer.byteLength(body, 'utf8'), isMd: true,
    };
    vaultData.files.unshift(fileObj);
    saveVaultData();
    try { renderVaultFolders(); renderVaultGrid(); } catch (_) {}
    return fileObj;
}

// ── Graph model ──────────────────────────────────────────────────────
function vaultBuildGraph() {
    const files = vaultData.files || [];
    const byId = new Map(files.map(f => [f.id, f]));
    const nodes = files.map(f => {
        let color = '#94a3b8';
        try {
            const ic = vaultIcon(f.originalName, f.isDoc, f.isCode, f.isNotebook, f);
            if (ic && ic.color) color = ic.color;
        } catch (_) {}
        return { id: f.id, label: f.originalName, color, folderId: f.folderId || null, note: _vaultIsNoteFile(f) };
    });
    const seen = new Set();
    const edges = [];
    const addEdge = (a, b, kind) => {
        if (!a || !b || a === b || !byId.has(a) || !byId.has(b)) return;
        const key = a < b ? a + '|' + b : b + '|' + a;
        if (seen.has(key)) return;
        seen.add(key);
        edges.push({ from: a, to: b, kind });
    };
    for (const l of (vaultData.links || [])) addEdge(l.from, l.to, 'manual');
    for (const f of files) {
        if (!_vaultIsNoteFile(f)) continue;
        for (const nm of vaultExtractWikilinks(vaultNoteText(f))) {
            const tid = vaultResolveLink(nm);
            if (tid) addEdge(f.id, tid, 'wikilink');
        }
    }
    return { nodes, edges };
}

// Files connected to `fileId` (either direction), for the backlinks panel.
function vaultBacklinks(fileId) {
    const { edges } = vaultBuildGraph();
    const ids = new Set();
    for (const e of edges) {
        if (e.from === fileId) ids.add(e.to);
        if (e.to === fileId) ids.add(e.from);
    }
    return [...ids].map(id => (vaultData.files || []).find(f => f.id === id)).filter(Boolean);
}

// HTML block of connected notes, embedded under the markdown viewer.
function vaultGraphBacklinksHTML(fileId) {
    let links;
    try { links = vaultBacklinks(fileId); } catch (_) { return ''; }
    if (!links.length) return '';
    const items = links.map(f =>
        `<button onclick="openVaultFile('${f.id}')" style="display:flex;align-items:center;gap:8px;width:100%;text-align:left;background:rgba(148,163,184,.06);border:1px solid rgba(148,163,184,.12);border-radius:8px;padding:7px 10px;margin:4px 0;color:#cbd5e1;font-size:12px;cursor:pointer">
            <i class="fas fa-link" style="font-size:9px;color:#64748b"></i>${(f.originalName || '').replace(/</g, '&lt;')}
        </button>`).join('');
    return `<div style="max-width:760px;margin:32px auto 12px;padding:0 24px">
        <div style="display:flex;align-items:center;gap:8px;color:#64748b;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">
            <i class="fas fa-diagram-project"></i> ${links.length} Linked note${links.length > 1 ? 's' : ''}
        </div>${items}</div>`;
}
