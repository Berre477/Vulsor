#!/usr/bin/env node
// ── Vulsor Vault MCP server ───────────────────────────────────────────
// A zero-dependency Model Context Protocol server (stdio transport) that
// lets Claude (Claude Code, Claude Desktop, or any MCP client) read and
// write the Vulsor Vault — the same notes you see in the app's Vault tab.
//
// It speaks newline-delimited JSON-RPC 2.0 on stdin/stdout. No npm install
// needed — only Node built-ins. Logs go to stderr so they never corrupt
// the protocol stream.
//
// Storage (shared with the Vulsor app):
//   ~/Documents/Vulsor_Memories/vault.json   — the file/folder/link index
//   ~/Documents/Vulsor_Memories/vault/        — the note bodies (.md, .vulsor …)
//
// Files created here are written the same way the app writes its own, so they
// show up in the Vault tab — live, since js/vault.js watches the index for
// outside writes — and stay portable (a note is a plain .md on disk).
//
// Register with Claude Code:
//   claude mcp add vulsor-vault -- node /ABS/PATH/server/vault-mcp.js
// Or see server/README-vault-mcp.md for the Claude Desktop config.

'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');

// ── Paths (must match js/globals.js) ─────────────────────────────────
const DOCS = path.join(os.homedir(), 'Documents', 'Vulsor_Memories');
const VAULT_FILE = path.join(DOCS, 'vault.json');
const VAULT_DIR = path.join(DOCS, 'vault');
function ensureDirs() {
    if (!fs.existsSync(DOCS)) fs.mkdirSync(DOCS, { recursive: true });
    if (!fs.existsSync(VAULT_DIR)) fs.mkdirSync(VAULT_DIR, { recursive: true });
}

// ── Vault data access ────────────────────────────────────────────────
function load() {
    try {
        if (!fs.existsSync(VAULT_FILE)) return { folders: [], files: [], links: [] };
        const d = JSON.parse(fs.readFileSync(VAULT_FILE, 'utf8'));
        if (!Array.isArray(d.files)) d.files = [];
        if (!Array.isArray(d.folders)) d.folders = [];
        if (!Array.isArray(d.links)) d.links = [];
        return d;
    } catch (e) { return { folders: [], files: [], links: [] }; }
}
function save(data) {
    ensureDirs();
    const tmp = VAULT_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, VAULT_FILE);
}
const ext = n => (String(n || '').split('.').pop() || '').toLowerCase();
const NOTE_EXT = new Set(['md', 'markdown', 'txt']);
// Reading one of these as utf8 gives back mojibake, so vault_read declines.
const BINARY_EXT = new Set(['pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'mp3', 'wav', 'm4a', 'flac',
    'mp4', 'mov', 'avi', 'mkv', 'webm', 'zip', 'gz', 'tar', 'docx', 'pptx', 'xlsx', 'ttf', 'otf', 'woff', 'woff2']);
const isNote = f => !!f && (f.isDoc || NOTE_EXT.has(ext(f.originalName)));
const norm = s => String(s || '').trim().toLowerCase().replace(/\.(md|markdown|txt|vulsor)$/, '');
function findFile(data, ref) {
    if (!ref) return null;
    return data.files.find(f => f.id === ref)
        || data.files.find(f => norm(f.originalName) === norm(ref)) || null;
}
function noteText(f) {
    try {
        if (!f || !f.storedName) return '';
        const p = path.join(VAULT_DIR, f.storedName);
        if (!fs.existsSync(p)) return '';
        let t = fs.readFileSync(p, 'utf8');
        if (f.isDoc) t = t.replace(/<[^>]+>/g, ' ');
        return t;
    } catch (_) { return ''; }
}
function extractWikilinks(text) {
    const out = [];
    const re = /\[\[([^\]\n|#]+)(?:[#|][^\]\n]*)?\]\]/g;
    let m;
    while ((m = re.exec(text || ''))) { const n = m[1].trim(); if (n) out.push(n); }
    return out;
}
function resolveLink(data, nameStr) {
    const key = norm(nameStr);
    const f = data.files.find(x => norm(x.originalName) === key);
    return f ? f.id : null;
}
function buildGraph(data) {
    const byId = new Map(data.files.map(f => [f.id, f]));
    const seen = new Set();
    const edges = [];
    const add = (a, b, kind) => {
        if (!a || !b || a === b || !byId.has(a) || !byId.has(b)) return;
        const k = a < b ? a + '|' + b : b + '|' + a;
        if (seen.has(k)) return;
        seen.add(k); edges.push({ from: a, to: b, kind });
    };
    for (const l of data.links) add(l.from, l.to, 'manual');
    for (const f of data.files) {
        if (!isNote(f)) continue;
        for (const nm of extractWikilinks(noteText(f))) { const t = resolveLink(data, nm); if (t) add(f.id, t, 'wikilink'); }
    }
    return { nodes: data.files.map(f => ({ id: f.id, label: f.originalName })), edges };
}
// ── Folders ──────────────────────────────────────────────────────────
// Same shape the app writes in createVaultFolder() (js/vault.js).
const FOLDER_COLORS = ['#f87171', '#fb923c', '#fbbf24', '#34d399', '#22d3ee', '#60a5fa', '#a78bfa', '#f472b6'];
function pickFolderColor(data) {
    const used = new Set(data.folders.map(f => f.color));
    return FOLDER_COLORS.find(c => !used.has(c)) || FOLDER_COLORS[data.folders.length % FOLDER_COLORS.length];
}
// "Parent/Child" — the path shown to Claude, so nested folders with the same
// leaf name ("slides" appears half a dozen times) can still be told apart.
function folderLabel(data, id) {
    const parts = [];
    const seen = new Set();
    let cur = data.folders.find(f => f.id === id);
    while (cur && !seen.has(cur.id)) {
        seen.add(cur.id);
        parts.unshift(cur.name);
        cur = data.folders.find(f => f.id === cur.parentId);
    }
    return parts.join('/');
}
// Accepts a folder id, a bare folder name, or a "Parent/Child" path.
function findFolder(data, ref) {
    const s = String(ref == null ? '' : ref).trim().replace(/^\/+|\/+$/g, '');
    if (!s) return null;
    const byId = data.folders.find(f => f.id === s);
    if (byId) return byId;
    const low = s.toLowerCase();
    return data.folders.find(f => folderLabel(data, f.id).toLowerCase() === low)
        || data.folders.find(f => String(f.name).toLowerCase() === low)
        || null;
}
// null folder = the Vault root ("All Files"). An unknown name is an error
// rather than a silent drop into the root, where the file would be lost among
// hundreds of others.
function resolveFolder(data, ref) {
    if (ref == null || String(ref).trim() === '') return { id: null, label: 'All Files' };
    const f = findFolder(data, ref);
    if (!f) return { error: `No folder named "${ref}". Run vault_folders to see them, or create it with vault_create_folder.` };
    return { id: f.id, label: folderLabel(data, f.id) };
}
function createFolder(data, name, parentRef) {
    const nm = String(name || '').trim().replace(/[\/\\:*?"<>|]/g, '-');
    if (!nm) return { error: 'A folder needs a name.' };
    const parent = resolveFolder(data, parentRef);
    if (parent.error) return parent;
    const twin = data.folders.find(f =>
        String(f.name).toLowerCase() === nm.toLowerCase() && (f.parentId || null) === parent.id);
    if (twin) return { folder: twin, existed: true };
    // The app's own ids are 'vd_<timestamp>', which is unique enough when a
    // human is clicking. Claude can create two folders in the same
    // millisecond, so add the same random tail the file ids use.
    const folder = { id: 'vd_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
        name: nm, color: pickFolderColor(data), parentId: parent.id };
    data.folders.push(folder);
    return { folder };
}

// ── Adding files ─────────────────────────────────────────────────────
const safeName = n => String(n == null ? '' : n).replace(/[\/\\:*?"<>|]/g, '-').trim();
const newFileId = () => 'vf_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
// The app stores every file as <id>.<ext> and keeps the display name in the
// index, so two notes can share a name without colliding on disk.
const storedNameFor = (id, originalName) => {
    const e = ext(originalName);
    return id + (e ? '.' + e : '');
};
function pushEntry(data, f) { data.files.unshift(f); return f; }

// Write text into the Vault under any extension — .py, .html, .csv, .md …
// The app decides how to open it from the extension alone, so a .py lands in
// the code editor and a .md in the markdown viewer with no extra flags.
function writeVaultFile(data, name, content, folderId) {
    const originalName = safeName(name) || 'Untitled';
    const id = newFileId();
    const storedName = storedNameFor(id, originalName);
    const body = String(content == null ? '' : content);
    ensureDirs();
    fs.writeFileSync(path.join(VAULT_DIR, storedName), body);
    return pushEntry(data, {
        id, originalName, storedName, folderId: folderId || null,
        notes: '', pageNotes: {}, addedAt: Date.now(), size: Buffer.byteLength(body, 'utf8'),
    });
}

// Copy something that already exists on disk (a PDF, an image, a build
// artifact) into the Vault — the same thing the app's "Add File…" does.
function copyIntoVault(data, srcPath, name, folderId) {
    const originalName = safeName(name || path.basename(srcPath)) || path.basename(srcPath);
    const id = newFileId();
    const storedName = storedNameFor(id, originalName);
    const dest = path.join(VAULT_DIR, storedName);
    ensureDirs();
    fs.copyFileSync(srcPath, dest);
    return pushEntry(data, {
        id, originalName, storedName, folderId: folderId || null,
        notes: '', pageNotes: {}, addedAt: Date.now(), size: fs.statSync(dest).size,
    });
}

function createNote(data, name, content, folderId) {
    let base = safeName(name) || 'Untitled';
    if (!/\.(md|markdown|txt)$/i.test(base)) base += '.md';
    const body = content == null ? `# ${base.replace(/\.(md|markdown|txt)$/i, '')}\n` : String(content);
    const f = writeVaultFile(data, base, body, folderId);
    f.isMd = true;
    return f;
}

// ── Tools ────────────────────────────────────────────────────────────
const TOOLS = [
    { name: 'vault_list', description: 'List the files/notes in the Vulsor Vault, optionally just one folder.',
      inputSchema: { type: 'object', properties: { folder: { type: 'string', description: 'Only list this folder — name, "Parent/Child" path, or id.' } } } },
    { name: 'vault_search', description: 'Search the Vault by file name or note content.',
      inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
    { name: 'vault_read', description: "Read a note's text by name (or id).",
      inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
    { name: 'vault_create_note', description: 'Create a new markdown note. Link to other notes by writing [[Other Note]] in the content.',
      inputSchema: { type: 'object', properties: { name: { type: 'string' }, content: { type: 'string' },
        folder: { type: 'string', description: 'Folder to put it in — name, "Parent/Child" path, or id. Omit for All Files.' } }, required: ['name'] } },
    { name: 'vault_write_file', description: 'Write a file of ANY type into the Vault so it appears in the app — code, HTML, CSV, JSON, SVG, markdown. Give `name` the real extension; the app opens it accordingly (.py in the code editor, .md in the note viewer). This is how you hand the user a file you generated.',
      inputSchema: { type: 'object', properties: {
        name: { type: 'string', description: 'File name including extension, e.g. "gradient_descent.py"' },
        content: { type: 'string', description: 'The full file contents' },
        folder: { type: 'string', description: 'Folder — name, "Parent/Child" path, or id. Omit for All Files.' },
        overwrite: { type: 'boolean', description: 'Replace a file of the same name instead of refusing (default false).' },
      }, required: ['name', 'content'] } },
    { name: 'vault_add_file', description: 'Copy a file that already exists on disk into the Vault, including binaries (PDF, image, video, docx). Use this for a file you generated on disk with other tools.',
      inputSchema: { type: 'object', properties: {
        path: { type: 'string', description: 'Absolute path of the file to copy in' },
        name: { type: 'string', description: 'Name to show in the Vault (defaults to the file name)' },
        folder: { type: 'string', description: 'Folder — name, "Parent/Child" path, or id. Omit for All Files.' },
      }, required: ['path'] } },
    { name: 'vault_folders', description: 'List the Vault folders as "Parent/Child" paths, with how many files each holds.',
      inputSchema: { type: 'object', properties: {} } },
    { name: 'vault_create_folder', description: 'Create a Vault folder.',
      inputSchema: { type: 'object', properties: { name: { type: 'string' },
        parent: { type: 'string', description: 'Parent folder — name, path, or id. Omit for a top-level folder.' } }, required: ['name'] } },
    { name: 'vault_move', description: 'Move a Vault file into a folder. Pass an empty folder to move it back to All Files.',
      inputSchema: { type: 'object', properties: { name: { type: 'string' }, folder: { type: 'string' } }, required: ['name'] } },
    { name: 'vault_edit_note', description: "Replace a note's content (creates it if missing).",
      inputSchema: { type: 'object', properties: { name: { type: 'string' }, content: { type: 'string' } }, required: ['name', 'content'] } },
    { name: 'vault_append_note', description: 'Append text to the end of a note.',
      inputSchema: { type: 'object', properties: { name: { type: 'string' }, text: { type: 'string' } }, required: ['name', 'text'] } },
    { name: 'vault_link', description: 'Create a link between two files in the knowledge graph.',
      inputSchema: { type: 'object', properties: { a: { type: 'string' }, b: { type: 'string' } }, required: ['a', 'b'] } },
    { name: 'vault_unlink', description: 'Remove a manual link between two files.',
      inputSchema: { type: 'object', properties: { a: { type: 'string' }, b: { type: 'string' } }, required: ['a', 'b'] } },
    { name: 'vault_backlinks', description: 'List the files connected to a given note.',
      inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
    { name: 'vault_graph', description: 'Summarise the whole knowledge graph (counts + most-connected notes).',
      inputSchema: { type: 'object', properties: {} } },
];

function callTool(name, args = {}) {
    const data = load();
    let result;
    switch (name) {
        case 'vault_list': {
            if (!data.files.length) return 'The Vault is empty.';
            let files = data.files;
            let where = '';
            if (args.folder != null && String(args.folder).trim() !== '') {
                const dest = resolveFolder(data, args.folder);
                if (dest.error) return dest.error;
                files = data.files.filter(f => (f.folderId || null) === dest.id);
                where = ` in ${dest.label}`;
                if (!files.length) return `Nothing in ${dest.label} yet.`;
            }
            const head = `${files.length} file${files.length === 1 ? '' : 's'}${where}:`;
            return head + '\n' + files.slice(0, 300).map(f => {
                const t = f.isDoc ? 'doc' : f.isCode ? 'code' : f.isNotebook ? 'notebook' : ext(f.originalName);
                const loc = where ? '' : (f.folderId ? `  [${folderLabel(data, f.folderId)}]` : '');
                return `- ${f.originalName} (${t})${loc}`;
            }).join('\n');
        }
        case 'vault_search': {
            const q = String(args.query || '').toLowerCase();
            if (!q) return 'No query given.';
            const hits = data.files.filter(f =>
                (f.originalName || '').toLowerCase().includes(q) || noteText(f).toLowerCase().includes(q));
            return hits.length ? hits.slice(0, 20).map(f => `- ${f.originalName}`).join('\n') : `No matches for "${args.query}".`;
        }
        case 'vault_read': {
            const f = findFile(data, args.name);
            if (!f) return `No note named "${args.name}".`;
            if (BINARY_EXT.has(ext(f.originalName)))
                return `"${f.originalName}" is a ${ext(f.originalName)} file — not text, so there's nothing to read out here.`;
            const t = noteText(f);
            return t ? t.slice(0, 12000) : '(empty note)';
        }
        case 'vault_create_note': {
            if (findFile(data, args.name)) return `A note named "${args.name}" already exists; use vault_edit_note or vault_append_note.`;
            const dest = resolveFolder(data, args.folder);
            if (dest.error) return dest.error;
            const f = createNote(data, args.name, args.content, dest.id);
            save(data);
            return `Created note "${f.originalName}" in ${dest.label}. It's in the app's Vault now.`;
        }

        case 'vault_write_file': {
            if (!args.name) return 'Give the file a name, extension included.';
            const dest = resolveFolder(data, args.folder);
            if (dest.error) return dest.error;
            const existing = findFile(data, args.name);
            if (existing && !args.overwrite)
                return `"${existing.originalName}" already exists in the Vault. Pass overwrite: true to replace it, or pick another name.`;
            if (existing) {
                const body = String(args.content == null ? '' : args.content);
                fs.writeFileSync(path.join(VAULT_DIR, existing.storedName), body);
                existing.size = Buffer.byteLength(body, 'utf8');
                existing.updatedAt = Date.now();
                save(data);
                return `Replaced "${existing.originalName}" in the Vault.`;
            }
            const f = writeVaultFile(data, args.name, args.content, dest.id);
            save(data);
            return `Wrote "${f.originalName}" (${f.size} bytes) to ${dest.label}. It's in the app's Vault now.`;
        }

        case 'vault_add_file': {
            const src = String(args.path || '');
            if (!src) return 'Give the absolute path of the file to add.';
            if (!fs.existsSync(src)) return `No file at ${src}.`;
            let st;
            try { st = fs.statSync(src); } catch (e) { return `Could not read ${src}: ${e.message}`; }
            if (st.isDirectory()) return `${src} is a folder — add files one at a time.`;
            const dest = resolveFolder(data, args.folder);
            if (dest.error) return dest.error;
            const f = copyIntoVault(data, src, args.name, dest.id);
            save(data);
            return `Added "${f.originalName}" (${f.size} bytes) to ${dest.label}. It's in the app's Vault now.`;
        }

        case 'vault_folders': {
            if (!data.folders.length) return 'No folders yet — everything sits in All Files.';
            const count = id => data.files.filter(f => (f.folderId || null) === id).length;
            const rows = data.folders
                .map(f => ({ label: folderLabel(data, f.id), n: count(f.id) }))
                .sort((a, b) => a.label.localeCompare(b.label))
                .map(r => `- ${r.label} (${r.n} file${r.n === 1 ? '' : 's'})`);
            return `${data.folders.length} folders, plus All Files (${count(null)} files) at the root:\n` + rows.join('\n');
        }

        case 'vault_create_folder': {
            const r = createFolder(data, args.name, args.parent);
            if (r.error) return r.error;
            if (r.existed) return `"${folderLabel(data, r.folder.id)}" already exists.`;
            save(data);
            return `Created folder "${folderLabel(data, r.folder.id)}".`;
        }

        case 'vault_move': {
            const f = findFile(data, args.name);
            if (!f) return `No file named "${args.name}".`;
            const dest = resolveFolder(data, args.folder);
            if (dest.error) return dest.error;
            if ((f.folderId || null) === dest.id) return `"${f.originalName}" is already in ${dest.label}.`;
            f.folderId = dest.id;
            save(data);
            return `Moved "${f.originalName}" to ${dest.label}.`;
        }
        case 'vault_edit_note':
        case 'vault_append_note': {
            let f = findFile(data, args.name);
            if (!f && name === 'vault_edit_note') f = createNote(data, args.name, '');
            if (!f) return `No note named "${args.name}".`;
            const p = path.join(VAULT_DIR, f.storedName);
            let cur = '';
            try { cur = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''; } catch (_) {}
            let next;
            if (name === 'vault_append_note') {
                const add = String(args.text || '');
                next = f.isDoc ? cur + add.split('\n').map(l => `<p>${l || '<br>'}</p>`).join('')
                               : (cur ? cur.replace(/\s*$/, '') + '\n\n' : '') + add;
            } else {
                const c = String(args.content || '');
                next = f.isDoc ? c.split('\n').map(l => `<p>${l || '<br>'}</p>`).join('') : c;
            }
            fs.writeFileSync(p, next);
            f.size = Buffer.byteLength(next, 'utf8'); f.updatedAt = Date.now();
            save(data);
            return `${name === 'vault_append_note' ? 'Appended to' : 'Updated'} "${f.originalName}".`;
        }
        case 'vault_link': {
            const a = findFile(data, args.a), b = findFile(data, args.b);
            if (!a) return `No note named "${args.a}".`;
            if (!b) return `No note named "${args.b}".`;
            if (a.id === b.id) return 'Cannot link a file to itself.';
            if (data.links.some(l => (l.from === a.id && l.to === b.id) || (l.from === b.id && l.to === a.id)))
                return 'Those two are already linked.';
            data.links.push({ from: a.id, to: b.id });
            save(data);
            return `Linked "${a.originalName}" <-> "${b.originalName}".`;
        }
        case 'vault_unlink': {
            const a = findFile(data, args.a), b = findFile(data, args.b);
            if (!a || !b) return 'One or both notes not found.';
            const before = data.links.length;
            data.links = data.links.filter(l => !((l.from === a.id && l.to === b.id) || (l.from === b.id && l.to === a.id)));
            if (data.links.length === before) return 'They were not manually linked (a [[wikilink]] in the text would need editing instead).';
            save(data);
            return `Unlinked "${a.originalName}" and "${b.originalName}".`;
        }
        case 'vault_backlinks': {
            const f = findFile(data, args.name);
            if (!f) return `No note named "${args.name}".`;
            const { edges } = buildGraph(data);
            const ids = new Set();
            for (const e of edges) { if (e.from === f.id) ids.add(e.to); if (e.to === f.id) ids.add(e.from); }
            const names = [...ids].map(id => (data.files.find(x => x.id === id) || {}).originalName).filter(Boolean);
            return names.length ? names.map(n => `- ${n}`).join('\n') : 'No linked notes yet.';
        }
        case 'vault_graph': {
            const g = buildGraph(data);
            if (!g.nodes.length) return 'The Vault is empty.';
            const deg = new Map();
            for (const e of g.edges) { deg.set(e.from, (deg.get(e.from) || 0) + 1); deg.set(e.to, (deg.get(e.to) || 0) + 1); }
            const top = g.nodes.map(n => ({ n, d: deg.get(n.id) || 0 })).sort((x, y) => y.d - x.d)
                .slice(0, 8).filter(x => x.d > 0).map(x => `- ${x.n.label} (${x.d})`).join('\n');
            return `${g.nodes.length} files, ${g.edges.length} links.\nMost connected:\n${top || '(nothing linked yet)'}`;
        }
        default:
            throw new Error('Unknown tool: ' + name);
    }
}

// ── JSON-RPC 2.0 over stdio ──────────────────────────────────────────
const SERVER_INFO = { name: 'vulsor-vault', version: '1.0.0' };
const PROTOCOL = '2024-11-05';
function send(msg) { process.stdout.write(JSON.stringify(msg) + '\n'); }
function reply(id, result) { send({ jsonrpc: '2.0', id, result }); }
function replyErr(id, code, message) { send({ jsonrpc: '2.0', id, error: { code, message } }); }

function handle(msg) {
    const { id, method, params } = msg;
    const isNotification = id === undefined || id === null;
    try {
        switch (method) {
            case 'initialize':
                return reply(id, { protocolVersion: PROTOCOL, capabilities: { tools: {} }, serverInfo: SERVER_INFO });
            case 'notifications/initialized':
            case 'initialized':
                return; // notification, no response
            case 'ping':
                return reply(id, {});
            case 'tools/list':
                return reply(id, { tools: TOOLS });
            case 'tools/call': {
                const { name, arguments: a } = params || {};
                try {
                    const text = callTool(name, a || {});
                    return reply(id, { content: [{ type: 'text', text: String(text) }] });
                } catch (e) {
                    return reply(id, { content: [{ type: 'text', text: 'Error: ' + e.message }], isError: true });
                }
            }
            default:
                if (!isNotification) replyErr(id, -32601, 'Method not found: ' + method);
                return;
        }
    } catch (e) {
        if (!isNotification) replyErr(id, -32603, e.message);
    }
}

ensureDirs();
const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on('line', line => {
    const s = line.trim();
    if (!s) return;
    let msg;
    try { msg = JSON.parse(s); } catch (_) { return; }
    handle(msg);
});
rl.on('close', () => process.exit(0));
process.stderr.write('[vulsor-vault-mcp] ready · vault at ' + VAULT_FILE + '\n');
