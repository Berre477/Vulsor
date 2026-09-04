// ── Studio (build / draw / plan / 3D projects) ────────────────
// Depends on: globals.js (STUDIO_FILE, projects, studioFilter)

const STUDIO_TYPES = [
    { id: 'build', name: 'Build', icon: 'fa-hammer',          color: '#f97316' },
    { id: 'draw',  name: 'Draw',  icon: 'fa-pen-nib',         color: '#3b82f6' },
    { id: 'plan',  name: 'Plan',  icon: 'fa-clipboard-list',  color: '#22c55e' },
    { id: '3d',    name: '3D',    icon: 'fa-cube',            color: '#a855f7' }
];

const STUDIO_STATUSES = {
    idea:        { label: 'Idea',        color: '#64748b' },
    in_progress: { label: 'In progress', color: '#eab308' },
    done:        { label: 'Done',        color: '#22c55e' }
};

// ── Accent color helper — always reads the live CSS variable ─────
function getAccent() {
    return getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#dc2626';
}

// Editor-modal state
let studioEditingId   = null;
let studioEditingType = 'build';

// Workspace state — the open project being edited fullscreen
let wsProject       = null;          // reference into projects[]
let wsDirty         = false;
let wsSaveTimer     = null;

// ──────────────────────────────────────────────────────────────
// Persistence
// ──────────────────────────────────────────────────────────────
function loadStudio() {
    try {
        if (fs.existsSync(STUDIO_FILE)) {
            projects = JSON.parse(fs.readFileSync(STUDIO_FILE, 'utf8')) || [];
        }
    } catch (_) { projects = []; }
}

function saveStudio() {
    try { fs.writeFileSync(STUDIO_FILE, JSON.stringify(projects, null, 2), 'utf8'); }
    catch (_) {}
}

function studioEscape(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ──────────────────────────────────────────────────────────────
// Grid + filters
// ──────────────────────────────────────────────────────────────
function renderStudioFilters() {
    const wrap = document.getElementById('studio-filters');
    if (!wrap) return;
    wrap.innerHTML = '';
    const counts = { all: projects.length };
    STUDIO_TYPES.forEach(t => { counts[t.id] = projects.filter(p => p.type === t.id).length; });

    const items = [{ id: 'all', name: 'All', icon: 'fa-bars', color: getAccent() }, ...STUDIO_TYPES];
    items.forEach(t => {
        const isActive = studioFilter === t.id;
        const btn = document.createElement('button');
        btn.className = `flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
            isActive
                ? 'border-transparent text-white'
                : 'border-slate-700/60 bg-slate-800/60 text-slate-400 hover:text-slate-200 hover:border-slate-600'
        }`;
        if (isActive) btn.style.backgroundColor = t.color;
        btn.innerHTML = `<i class="fas ${t.icon} text-[10px]"></i><span>${t.name}</span><span class="opacity-60">${counts[t.id] || 0}</span>`;
        btn.onclick = () => { studioFilter = t.id; renderStudio(); };
        wrap.appendChild(btn);
    });
}

function renderStudio() {
    const grid  = document.getElementById('studio-grid');
    const empty = document.getElementById('studio-empty');
    if (!grid) return;
    renderStudioFilters();

    const filtered = studioFilter === 'all'
        ? [...projects]
        : projects.filter(p => p.type === studioFilter);

    const order = { in_progress: 0, idea: 1, done: 2 };
    filtered.sort((a, b) => {
        const oa = order[a.status] ?? 99, ob = order[b.status] ?? 99;
        if (oa !== ob) return oa - ob;
        return (b.updatedAt || 0) - (a.updatedAt || 0);
    });

    grid.innerHTML = '';
    if (!filtered.length) { empty.classList.remove('hidden'); return; }
    empty.classList.add('hidden');

    filtered.forEach(p => {
        const t = STUDIO_TYPES.find(x => x.id === p.type) || STUDIO_TYPES[0];
        const s = STUDIO_STATUSES[p.status] || STUDIO_STATUSES.idea;
        const card = document.createElement('button');
        card.className = 'studio-card text-left bg-slate-900/70 hover:bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-2xl p-4 transition-all flex flex-col gap-2 min-h-[140px]';
        const date = p.updatedAt ? new Date(p.updatedAt).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '';

        // Build a small preview based on type
        let preview = '';
        if (p.type === 'draw' && p.data && typeof p.data === 'string' && p.data.startsWith('data:image')) {
            preview = `<img src="${p.data}" class="w-full h-24 object-contain bg-slate-800/40 rounded-lg border border-slate-800" alt="">`;
        } else if (p.type === '3d' && p.data && p.data.objects && p.data.objects.length) {
            preview = `<div class="text-slate-500 text-[10px] italic px-1">${p.data.objects.length} object${p.data.objects.length === 1 ? '' : 's'}</div>`;
        } else if (p.notes) {
            const notesPreview = p.notes.slice(0, 160);
            preview = `<p class="text-slate-400 text-xs leading-relaxed whitespace-pre-wrap" style="display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden">${studioEscape(notesPreview)}</p>`;
        } else {
            preview = `<p class="text-slate-600 text-xs italic">Empty — click to start</p>`;
        }

        card.innerHTML = `
            <div class="flex items-center justify-between gap-2">
                <div class="flex items-center gap-2 min-w-0">
                    <div class="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style="background:${t.color}33;color:${t.color}">
                        <i class="fas ${t.icon} text-xs"></i>
                    </div>
                    <span class="text-white text-sm font-semibold truncate">${studioEscape(p.name || 'Untitled')}</span>
                </div>
                <span class="text-[9px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full shrink-0" style="background:${s.color}22;color:${s.color}">${s.label}</span>
            </div>
            ${preview}
            <div class="flex items-center justify-between text-[10px] text-slate-600 mt-auto pt-1">
                <span class="uppercase tracking-wider">${t.name}</span>
                <span>${date}</span>
            </div>
        `;
        card.onclick = () => openWorkspace(p.id);
        grid.appendChild(card);
    });
}

// ──────────────────────────────────────────────────────────────
// "New Project" modal — picks type/name only, then opens workspace
// ──────────────────────────────────────────────────────────────
function renderStudioTypePicker() {
    const wrap = document.getElementById('studio-type-picker');
    if (!wrap) return;
    wrap.innerHTML = '';
    STUDIO_TYPES.forEach(t => {
        const isActive = studioEditingType === t.id;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `flex flex-col items-center gap-1 py-2.5 rounded-lg border transition-all ${
            isActive
                ? 'border-transparent text-white'
                : 'border-slate-700/60 bg-slate-800/60 text-slate-400 hover:text-slate-200 hover:border-slate-600'
        }`;
        if (isActive) btn.style.backgroundColor = t.color;
        btn.innerHTML = `<i class="fas ${t.icon} text-sm"></i><span class="text-[10px] font-semibold">${t.name}</span>`;
        btn.onclick = () => { studioEditingType = t.id; renderStudioTypePicker(); };
        wrap.appendChild(btn);
    });
}

function openStudioEditor() {
    const editor = document.getElementById('studio-editor');
    editor.classList.remove('hidden');
    editor.classList.add('flex');

    studioEditingId   = null;
    studioEditingType = (studioFilter !== 'all') ? studioFilter : 'build';

    document.getElementById('studio-editor-title').textContent = 'New Project';
    document.getElementById('studio-name').value   = '';
    document.getElementById('studio-status').value = 'idea';
    document.getElementById('studio-notes').value  = '';

    renderStudioTypePicker();
    document.getElementById('studio-delete-btn').classList.add('hidden');

    setTimeout(() => document.getElementById('studio-name').focus(), 50);
}

function closeStudioEditor() {
    const editor = document.getElementById('studio-editor');
    editor.classList.add('hidden');
    editor.classList.remove('flex');
    studioEditingId = null;
}

function saveStudioFromEditor() {
    const name   = document.getElementById('studio-name').value.trim();
    const status = document.getElementById('studio-status').value;
    const notes  = document.getElementById('studio-notes').value;
    if (!name) { document.getElementById('studio-name').focus(); return; }

    const now = Date.now();
    const vaultId = 'vf_' + now + '_' + Math.random().toString(36).slice(2, 7);
    const vaultEntry = {
        id: vaultId,
        originalName: name,
        isProject: true,
        projectType: studioEditingType,
        projectStatus: status,
        projectData: null,
        notes,
        folderId: typeof vaultActiveFolderId !== 'undefined' ? vaultActiveFolderId : null,
        addedAt: now,
        updatedAt: now,
        size: 0,
    };
    vaultData.files.unshift(vaultEntry);
    saveVaultData();
    closeStudioEditor();
    renderVaultFolders();
    renderVaultGrid();
    openVaultProjectWorkspace(vaultEntry);
}

// ──────────────────────────────────────────────────────────────
// Workspace shell — opens the type-specific editor for a project
// ──────────────────────────────────────────────────────────────
function openWorkspace(projectId) {
    const p = projects.find(x => x.id === projectId);
    if (!p) return;
    wsProject = p;
    wsDirty   = false;

    const ws = document.getElementById('studio-workspace');
    ws.classList.remove('hidden');
    ws.classList.add('flex');

    // Toolbar header
    const t = STUDIO_TYPES.find(x => x.id === p.type) || STUDIO_TYPES[0];
    const badge = document.getElementById('ws-type-badge');
    badge.style.backgroundColor = t.color + '33';
    badge.style.color           = t.color;
    badge.innerHTML = `<i class="fas ${t.icon} text-[10px]"></i><span>${t.name}</span>`;

    document.getElementById('ws-name').value   = p.name || '';
    document.getElementById('ws-status').value = p.status || 'idea';

    // Hide all editors, then mount the matching one
    ['ws-plan', 'ws-draw', 'ws-3d', 'ws-build'].forEach(id => {
        const el = document.getElementById(id);
        el.classList.add('hidden');
    });
    document.getElementById('ws-tools').innerHTML = '';

    if (p.type === 'plan')  mountPlanEditor(p);
    if (p.type === 'draw')  mountDrawEditor(p);
    if (p.type === '3d')    mount3DEditor(p);
    if (p.type === 'build') mountBuildEditor(p);
}

function openVaultProjectWorkspace(vaultEntry) {
    const p = {
        _vaultId:  vaultEntry.id,
        id:        vaultEntry.id,
        name:      vaultEntry.originalName,
        type:      vaultEntry.projectType  || 'build',
        status:    vaultEntry.projectStatus || 'idea',
        data:      vaultEntry.projectData  || null,
        notes:     vaultEntry.notes        || '',
        updatedAt: vaultEntry.updatedAt    || Date.now(),
    };
    wsProject = p;
    wsDirty   = false;

    const ws = document.getElementById('studio-workspace');
    ws.classList.remove('hidden');
    ws.classList.add('flex');

    const t = STUDIO_TYPES.find(x => x.id === p.type) || STUDIO_TYPES[0];
    const badge = document.getElementById('ws-type-badge');
    badge.style.backgroundColor = t.color + '33';
    badge.style.color           = t.color;
    badge.innerHTML = `<i class="fas ${t.icon} text-[10px]"></i><span>${t.name}</span>`;

    document.getElementById('ws-name').value   = p.name   || '';
    document.getElementById('ws-status').value = p.status || 'idea';

    ['ws-plan', 'ws-draw', 'ws-3d', 'ws-build'].forEach(id => {
        document.getElementById(id).classList.add('hidden');
    });
    document.getElementById('ws-tools').innerHTML = '';

    if (p.type === 'plan')  mountPlanEditor(p);
    if (p.type === 'draw')  mountDrawEditor(p);
    if (p.type === '3d')    mount3DEditor(p);
    if (p.type === 'build') mountBuildEditor(p);
}

function closeWorkspace() {
    const ws = document.getElementById('studio-workspace');
    ws.classList.add('hidden');
    ws.classList.remove('flex');
    teardown3DEditor();
    teardownPlanEditor();
    const wasVault = wsProject && wsProject._vaultId;
    wsProject = null;
    if (wasVault) {
        renderVaultFolders();
        renderVaultGrid();
    } else {
        renderStudio();
    }
}

function commitWorkspace() {
    if (!wsProject) return;
    wsProject.name      = document.getElementById('ws-name').value.trim() || wsProject.name;
    wsProject.status    = document.getElementById('ws-status').value;
    wsProject.updatedAt = Date.now();
    if (wsProject._vaultId) {
        const entry = vaultData.files.find(f => f.id === wsProject._vaultId);
        if (entry) {
            entry.originalName   = wsProject.name;
            entry.projectStatus  = wsProject.status;
            entry.projectData    = wsProject.data;
            entry.notes          = wsProject.notes || entry.notes;
            entry.updatedAt      = wsProject.updatedAt;
        }
        saveVaultData();
    } else {
        saveStudio();
    }
    wsDirty = false;
}

function deleteCurrentProject() {
    if (!wsProject) return;
    if (!confirm(`Delete "${wsProject.name || 'Untitled'}"? This cannot be undone.`)) return;
    if (wsProject._vaultId) {
        deleteVaultFile(wsProject._vaultId);
        const ws = document.getElementById('studio-workspace');
        ws.classList.add('hidden');
        ws.classList.remove('flex');
        teardown3DEditor();
        teardownPlanEditor();
        wsProject = null;
    } else {
        projects = projects.filter(x => x.id !== wsProject.id);
        saveStudio();
        closeWorkspace();
    }
}

function exportCurrentWorkspace() {
    if (!wsProject) return;
    if (wsProject.type === 'plan') { exportPlanAsPng(); return; }
    if (wsProject.type === 'draw') { exportDrawAsPng(); return; }
    if (wsProject.type === '3d')   { export3DAsOBJ();  return; }
    if (wsProject.type === 'build') {
        const safeName  = (wsProject.name || 'project').replace(/[^a-z0-9]+/gi, '_');
        const target    = path.join(os.homedir(), 'Downloads', safeName + '.txt');
        const notes     = document.getElementById('ws-build')?.value || wsProject.notes || '';
        try {
            fs.writeFileSync(target, notes, 'utf8');
            const cmd = process.platform === 'darwin' ? `open -R "${target}"` : `explorer /select,"${target}"`;
            exec(cmd, () => {});
        } catch(e) { alert('Export failed: ' + e.message); }
    }
}

function exportDrawAsPng() {
    if (!drawState) return;
    const safeName = (wsProject?.name || 'drawing').replace(/[^a-z0-9]+/gi, '_');
    const target   = path.join(os.homedir(), 'Downloads', safeName + '.png');
    drawState.canvas.toBlob(blob => {
        const reader = new FileReader();
        reader.onload = () => {
            try {
                fs.writeFileSync(target, Buffer.from(reader.result));
                const cmd = process.platform === 'darwin' ? `open -R "${target}"` : `explorer /select,"${target}"`;
                exec(cmd, () => {});
            } catch(e) { alert('Export failed: ' + e.message); }
        };
        reader.readAsArrayBuffer(blob);
    }, 'image/png');
}

// ── OBJ / MTL export helpers ──────────────────────────────────

function sceneToOBJ(meshes, sceneName) {
    let objLines = [`# Exported from Vulsor — ${sceneName}`, `mtllib ${sceneName}.mtl`, ''];
    let mtlLines = [`# Exported from Vulsor — ${sceneName}`, ''];

    let vertOffset = 1;

    meshes.forEach((mesh, mi) => {
        const matName = `mat_${mi}`;
        const color   = mesh.material.color;
        const r = color.r.toFixed(4), g = color.g.toFixed(4), b = color.b.toFixed(4);

        mtlLines.push(`newmtl ${matName}`);
        mtlLines.push(`Kd ${r} ${g} ${b}`);
        mtlLines.push(`Ka 0.1 0.1 0.1`);
        mtlLines.push(`Ks 0.0 0.0 0.0`);
        mtlLines.push(`Ns ${(mesh.material.metalness * 100).toFixed(1)}`);
        mtlLines.push('');

        const geom = mesh.geometry.clone();
        geom.applyMatrix4(mesh.matrixWorld);

        if (!geom.index) {
            // Convert non-indexed to indexed-like by just using positions as-is
            const THREE_local = typeof THREE !== 'undefined' ? THREE : null;
            if (THREE_local) {
                const indexed = THREE_local.BufferGeometryUtils
                    ? THREE_local.BufferGeometryUtils.mergeVertices(geom)
                    : geom;
                exportGeomToOBJ(indexed, matName, mi, objLines, vertOffset);
                const posCount = Math.floor(indexed.attributes.position.count);
                vertOffset += posCount;
            }
        } else {
            exportGeomToOBJ(geom, matName, mi, objLines, vertOffset);
            vertOffset += geom.attributes.position.count;
        }
    });

    return { obj: objLines.join('\n'), mtl: mtlLines.join('\n') };
}

function exportGeomToOBJ(geom, matName, mi, objLines, vertOffset) {
    const pos = geom.attributes.position;
    const normals = geom.attributes.normal;

    objLines.push(`o object_${mi}`);
    objLines.push(`usemtl ${matName}`);

    for (let i = 0; i < pos.count; i++) {
        objLines.push(`v ${pos.getX(i).toFixed(6)} ${pos.getY(i).toFixed(6)} ${pos.getZ(i).toFixed(6)}`);
    }
    if (normals) {
        for (let i = 0; i < normals.count; i++) {
            objLines.push(`vn ${normals.getX(i).toFixed(6)} ${normals.getY(i).toFixed(6)} ${normals.getZ(i).toFixed(6)}`);
        }
    }

    if (geom.index) {
        const idx = geom.index;
        for (let i = 0; i < idx.count; i += 3) {
            const a = idx.getX(i) + vertOffset;
            const b = idx.getX(i + 1) + vertOffset;
            const c = idx.getX(i + 2) + vertOffset;
            if (normals) {
                const na = idx.getX(i) + vertOffset;
                const nb = idx.getX(i + 1) + vertOffset;
                const nc = idx.getX(i + 2) + vertOffset;
                objLines.push(`f ${a}//${na} ${b}//${nb} ${c}//${nc}`);
            } else {
                objLines.push(`f ${a} ${b} ${c}`);
            }
        }
    } else {
        for (let i = 0; i < pos.count; i += 3) {
            const a = i + vertOffset, b = i + 1 + vertOffset, c = i + 2 + vertOffset;
            objLines.push(`f ${a} ${b} ${c}`);
        }
    }
    objLines.push('');
}

function saveOBJFiles(safeName, objStr, mtlStr) {
    const downloads = path.join(os.homedir(), 'Downloads');
    const objPath   = path.join(downloads, safeName + '.obj');
    const mtlPath   = path.join(downloads, safeName + '.mtl');
    try {
        fs.writeFileSync(objPath, objStr, 'utf8');
        fs.writeFileSync(mtlPath, mtlStr, 'utf8');
        const cmd = process.platform === 'darwin' ? `open -R "${objPath}"` : `explorer /select,"${objPath}"`;
        exec(cmd, () => {});
    } catch(e) { alert('Export failed: ' + e.message); }
}

function export3DAsOBJ() {
    if (!three.objects || !three.objects.length) {
        alert('Nothing in the scene — add some objects first.'); return;
    }
    flush3DSave();
    const safeName = (wsProject?.name || '3d_scene').replace(/[^a-z0-9]+/gi, '_');
    const { obj, mtl } = sceneToOBJ(three.objects, safeName);
    saveOBJFiles(safeName, obj, mtl);
}

function savedDataToOBJ(projectData, safeName) {
    if (!projectData || !projectData.objects || !projectData.objects.length) {
        alert('No 3D objects saved yet — open the project and add some objects first.'); return;
    }
    const tempScene = new THREE.Scene();
    const tempMeshes = projectData.objects.map(o => {
        const geom = makePrimitiveGeometry(o.kind || 'cube');
        const mat  = new THREE.MeshStandardMaterial({
            color: new THREE.Color(o.color || '#888888'),
            roughness: typeof o.roughness === 'number' ? o.roughness : 0.55,
            metalness: typeof o.metalness === 'number' ? o.metalness : 0.05,
        });
        const mesh = new THREE.Mesh(geom, mat);
        if (o.position) mesh.position.set(o.position[0], o.position[1], o.position[2]);
        if (o.rotation) mesh.rotation.set(o.rotation[0], o.rotation[1], o.rotation[2]);
        if (o.scale)    mesh.scale.set(o.scale[0], o.scale[1], o.scale[2]);
        mesh.updateMatrixWorld(true);
        return mesh;
    });
    const { obj, mtl } = sceneToOBJ(tempMeshes, safeName);
    saveOBJFiles(safeName, obj, mtl);
}

function migrateStudioProjectsToVault() {
    if (!projects.length) return;
    const now = Date.now();
    projects.forEach((p, i) => {
        vaultData.files.push({
            id:            'vf_migrated_' + p.id,
            originalName:  p.name || 'Untitled Project',
            isProject:     true,
            projectType:   p.type   || 'build',
            projectStatus: p.status || 'idea',
            projectData:   p.data   || null,
            notes:         p.notes  || '',
            folderId:      null,
            addedAt:       p.createdAt || (now - i * 1000),
            updatedAt:     p.updatedAt || now,
            size:          0,
        });
    });
    saveVaultData();
    projects = [];
    saveStudio();
    renderVaultFolders();
    renderVaultGrid();
}

// ──────────────────────────────────────────────────────────────
// BUILD editor — simple notes textarea
// ──────────────────────────────────────────────────────────────
function mountBuildEditor(p) {
    const ta = document.getElementById('ws-build');
    ta.classList.remove('hidden');
    ta.value = p.notes || '';
    ta.oninput = () => { p.notes = ta.value; wsDirty = true; };
}

// ──────────────────────────────────────────────────────────────
// PLAN editor — offline SVG diagram editor
// Schema: { nodes: [{id, kind, x, y, w, h, text, color}],
//          edges: [{id, from, to, label}],
//          view:  {tx, ty, zoom} }
// ──────────────────────────────────────────────────────────────
const PLAN_NS = 'http://www.w3.org/2000/svg';
let plan = null;   // active editor state when Plan workspace is mounted

function mountPlanEditor(p) {
    const wrap = document.getElementById('ws-plan');
    wrap.classList.remove('hidden');
    const svg = document.getElementById('ws-plan-svg');

    plan = {
        project: p,
        svg,
        data: (p.data && typeof p.data === 'object' && p.data.nodes)
            ? JSON.parse(JSON.stringify(p.data))
            : { nodes: [], edges: [], view: { tx: 0, ty: 0, zoom: 1 } },
        selectedId: null,
        connectMode: false,
        connectFromId: null,
        dragNode: null,
        dragOffset: { x: 0, y: 0 },
        resizeHandle: null,
        pan: null,
        snap: false,
        gridVisible: true,
        history: [],        // undo stack
        layers: {}
    };
    if (!plan.data.view) plan.data.view = { tx: 0, ty: 0, zoom: 1 };

    // Build SVG layers: defs (arrowhead + grid pattern), grid background,
    // root <g> with viewport transform, edges layer under nodes layer.
    svg.innerHTML = '';
    const defs = document.createElementNS(PLAN_NS, 'defs');
    defs.innerHTML = `
        <marker id="ws-plan-arrow" viewBox="0 0 10 10" refX="9" refY="5"
                markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="context-stroke"></path>
        </marker>
        <pattern id="ws-plan-grid-pattern" width="20" height="20" patternUnits="userSpaceOnUse">
            <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#cbd5e1" stroke-width="0.5"></path>
        </pattern>
        <pattern id="ws-plan-grid-major" width="100" height="100" patternUnits="userSpaceOnUse">
            <path d="M 100 0 L 0 0 0 100" fill="none" stroke="#94a3b8" stroke-width="0.6"></path>
        </pattern>
        <filter id="ws-plan-shadow" x="-10%" y="-10%" width="120%" height="130%">
            <feDropShadow dx="0" dy="1.5" stdDeviation="1.5" flood-color="#000" flood-opacity="0.18"/>
        </filter>`;
    svg.appendChild(defs);

    // Grid background — covers a wide range so it tiles infinitely under panning
    const gridBg = document.createElementNS(PLAN_NS, 'rect');
    gridBg.setAttribute('id', 'ws-plan-gridbg');
    gridBg.setAttribute('x', '-10000'); gridBg.setAttribute('y', '-10000');
    gridBg.setAttribute('width', '20000'); gridBg.setAttribute('height', '20000');
    gridBg.setAttribute('fill', 'url(#ws-plan-grid-pattern)');
    const gridBg2 = document.createElementNS(PLAN_NS, 'rect');
    gridBg2.setAttribute('x', '-10000'); gridBg2.setAttribute('y', '-10000');
    gridBg2.setAttribute('width', '20000'); gridBg2.setAttribute('height', '20000');
    gridBg2.setAttribute('fill', 'url(#ws-plan-grid-major)');

    const root = document.createElementNS(PLAN_NS, 'g');
    root.setAttribute('id', 'ws-plan-root');
    svg.appendChild(root);
    root.appendChild(gridBg);
    root.appendChild(gridBg2);
    const edgesG = document.createElementNS(PLAN_NS, 'g');
    edgesG.setAttribute('id', 'ws-plan-edges');
    const nodesG = document.createElementNS(PLAN_NS, 'g');
    nodesG.setAttribute('id', 'ws-plan-nodes');
    root.appendChild(edgesG);
    root.appendChild(nodesG);
    plan.layers = { root, edgesG, nodesG, gridBg, gridBg2 };

    applyPlanViewTransform();

    // Background pan + click-to-deselect
    // Note: e.target is the grid rect (not the svg itself) so we check for both
    svg.onmousedown = (e) => {
        const isBackground = e.target === svg
            || e.target === plan.layers.gridBg
            || e.target === plan.layers.gridBg2;
        if (!isBackground) return;
        if (plan.connectMode) return;
        plan.pan = { startX: e.clientX, startY: e.clientY,
                     baseTx: plan.data.view.tx, baseTy: plan.data.view.ty };
        svg.style.cursor = 'grabbing';
        selectPlan(null);
    };
    window.addEventListener('mousemove', planOnMouseMove);
    window.addEventListener('mouseup',   planOnMouseUp);
    window.addEventListener('keydown',   planKbHandler);

    // Zoom on wheel
    svg.onwheel = (e) => {
        e.preventDefault();
        const r = svg.getBoundingClientRect();
        const mx = e.clientX - r.left, my = e.clientY - r.top;
        const oldZoom = plan.data.view.zoom;
        const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
        const newZoom = Math.max(0.25, Math.min(4, oldZoom * factor));
        // Zoom toward cursor
        plan.data.view.tx = mx - (mx - plan.data.view.tx) * (newZoom / oldZoom);
        plan.data.view.ty = my - (my - plan.data.view.ty) * (newZoom / oldZoom);
        plan.data.view.zoom = newZoom;
        applyPlanViewTransform();
        wsDirty = true;
    };

    // Toolbar wiring
    document.querySelectorAll('.ws-plan-add').forEach(btn => {
        btn.onclick = () => addPlanNode(btn.dataset.shape);
    });
    document.getElementById('ws-plan-connect-btn').onclick = () => {
        if (plan.connectMode) {
            planExitConnectMode();
        } else {
            plan.connectMode   = true;
            plan.connectFromId = null;
            const connBtn = document.getElementById('ws-plan-connect-btn');
            connBtn.style.backgroundColor = getAccent();
            connBtn.style.color = '#ffffff';
            svg.style.cursor = 'crosshair';
            renderPlanSelectedPanel();
            planUpdateHint();
        }
    };
    const snapEl = document.getElementById('ws-plan-snap');
    if (snapEl) {
        snapEl.checked = false;
        snapEl.onchange = (e) => { plan.snap = e.target.checked; };
    }
    const gridEl = document.getElementById('ws-plan-grid-vis');
    if (gridEl) {
        gridEl.checked = true;
        gridEl.onchange = (e) => {
            plan.gridVisible = e.target.checked;
            plan.layers.gridBg.style.display  = plan.gridVisible ? '' : 'none';
            plan.layers.gridBg2.style.display = plan.gridVisible ? '' : 'none';
        };
    }
    const exportBtn = document.getElementById('ws-plan-export');
    if (exportBtn) exportBtn.onclick = exportPlanAsPng;
    const resetBtn = document.getElementById('ws-plan-reset-view');
    if (resetBtn) resetBtn.onclick = () => {
        plan.data.view = { tx: 0, ty: 0, zoom: 1 };
        applyPlanViewTransform();
        wsDirty = true;
    };

    // Render initial state
    renderPlanAll();
    selectPlan(null);

    // Delegated dblclick on the stable nodesG layer.
    // Individual node <g> elements are destroyed and recreated on every re-render,
    // so a dblclick listener on each g breaks after the first click re-renders the node.
    // Listening here survives re-renders and always finds the right node via data-id.
    plan.layers.nodesG.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        if (plan.connectMode) return;
        let el = e.target;
        while (el && el !== plan.layers.nodesG) {
            const id = el.getAttribute && el.getAttribute('data-id');
            if (id) {
                const node = plan.data.nodes.find(n => n.id === id);
                if (node) startPlanInlineEdit(node);
                return;
            }
            el = el.parentNode;
        }
    });

    planUpdateHint();
}

function teardownPlanEditor() {
    window.removeEventListener('mousemove', planOnMouseMove);
    window.removeEventListener('mouseup',   planOnMouseUp);
    window.removeEventListener('keydown',   planKbHandler);
    plan = null;
}

// ── Plan hint bar ─────────────────────────────────────────────
function planUpdateHint() {
    const el = document.getElementById('ws-tools');
    if (!el) return;
    if (plan.connectMode && plan.connectFromId) {
        el.innerHTML = `<span class="text-amber-400 text-[10px] px-2 font-semibold">🔗 Source selected — click any other shape to draw the arrow. <kbd class="bg-slate-700 px-1 rounded">ESC</kbd> to cancel.</span>`;
    } else if (plan.connectMode) {
        el.innerHTML = `<span class="text-amber-400 text-[10px] px-2 font-semibold">→ Arrow mode ON — click a shape to set the source. <kbd class="bg-slate-700 px-1 rounded">ESC</kbd> to exit.</span>`;
    } else {
        el.innerHTML = `<span class="text-slate-500 text-[10px] px-2">Drag to move · Double-click to rename · <kbd class="bg-slate-700 px-1 rounded text-slate-400">Del</kbd> delete · <kbd class="bg-slate-700 px-1 rounded text-slate-400">D</kbd> duplicate · <kbd class="bg-slate-700 px-1 rounded text-slate-400">⌘Z</kbd> undo</span>`;
    }
}

// ── Keyboard shortcuts ────────────────────────────────────────
function planKbHandler(e) {
    if (!plan) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;

    if (e.key === 'Escape') {
        e.preventDefault();
        if (plan.connectMode) {
            planExitConnectMode();
        } else {
            selectPlan(null);
        }
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && plan.selectedId) {
        e.preventDefault();
        deletePlanItem(plan.selectedId);
    }
    if (e.key === 'd' && !e.metaKey && !e.ctrlKey && plan.selectedId) {
        e.preventDefault();
        duplicatePlanNode();
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault();
        undoPlan();
    }
}

// ── Undo ──────────────────────────────────────────────────────
function pushPlanHistory() {
    if (!plan) return;
    plan.history.push(JSON.stringify(plan.data));
    if (plan.history.length > 60) plan.history.shift();
}
function undoPlan() {
    if (!plan || !plan.history.length) return;
    plan.data = JSON.parse(plan.history.pop());
    renderPlanAll();
    selectPlan(null);
    wsDirty = true;
    plan.project.updatedAt = Date.now();
    saveStudio();
}

// ── Duplicate selected node ───────────────────────────────────
function duplicatePlanNode() {
    if (!plan || !plan.selectedId) return;
    const src = plan.data.nodes.find(n => n.id === plan.selectedId);
    if (!src) return;
    pushPlanHistory();
    const copy = JSON.parse(JSON.stringify(src));
    copy.id = 'n_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
    copy.x += 24; copy.y += 24;
    plan.data.nodes.push(copy);
    renderPlanNode(copy);
    selectPlan(copy.id);
    wsDirty = true;
    plan.project.updatedAt = Date.now();
    saveStudio();
}

// ── Connect-mode helpers ──────────────────────────────────────
function planExitConnectMode() {
    if (!plan) return;
    plan.connectMode    = false;
    plan.connectFromId  = null;
    planRemoveRubberBand();
    const connBtn = document.getElementById('ws-plan-connect-btn');
    if (connBtn) { connBtn.style.backgroundColor = ''; connBtn.style.color = ''; }
    plan.svg.style.cursor = 'grab';
    renderPlanAll();   // re-render to remove source glow
    renderPlanSelectedPanel();
    planUpdateHint();
}

function planRemoveRubberBand() {
    const rb = document.getElementById('ws-plan-rubberband');
    if (rb) rb.remove();
}

function applyPlanViewTransform() {
    if (!plan) return;
    const v = plan.data.view;
    plan.layers.root.setAttribute('transform', `translate(${v.tx} ${v.ty}) scale(${v.zoom})`);
}

function planOnMouseMove(e) {
    if (!plan) return;

    // Rubber-band preview while in connect mode with a source selected
    if (plan.connectMode && plan.connectFromId) {
        const srcNode = plan.data.nodes.find(n => n.id === plan.connectFromId);
        if (srcNode) {
            const svgRect = plan.svg.getBoundingClientRect();
            const v = plan.data.view;
            const mx = (e.clientX - svgRect.left - v.tx) / v.zoom;
            const my = (e.clientY - svgRect.top  - v.ty) / v.zoom;
            let rb = document.getElementById('ws-plan-rubberband');
            if (!rb) {
                rb = document.createElementNS(PLAN_NS, 'line');
                rb.setAttribute('id', 'ws-plan-rubberband');
                rb.setAttribute('stroke-width', 2);
                rb.setAttribute('stroke-dasharray', '8 5');
                rb.setAttribute('marker-end', 'url(#ws-plan-arrow)');
                rb.style.pointerEvents = 'none';
                rb.style.stroke = getAccent();
                plan.layers.edgesG.appendChild(rb);
            }
            rb.setAttribute('x1', srcNode.x + srcNode.w / 2);
            rb.setAttribute('y1', srcNode.y + srcNode.h / 2);
            rb.setAttribute('x2', mx);
            rb.setAttribute('y2', my);
        }
    } else if (!plan.connectMode) {
        planRemoveRubberBand();
    }

    if (plan.resizeHandle) {
        const rh = plan.resizeHandle;
        const zoom = plan.data.view.zoom;
        const dx = (e.clientX - rh.startMX) / zoom;
        const dy = (e.clientY - rh.startMY) / zoom;
        const MIN_W = 50, MIN_H = 30;
        let nx = rh.startX, ny = rh.startY, nw = rh.startW, nh = rh.startH;
        const d = rh.dir;
        if (d.includes('w')) { nx = rh.startX + dx; nw = rh.startW - dx; }
        if (d.includes('e')) { nw = rh.startW + dx; }
        if (d.includes('n')) { ny = rh.startY + dy; nh = rh.startH - dy; }
        if (d.includes('s')) { nh = rh.startH + dy; }
        if (nw < MIN_W) { if (d.includes('w')) nx = rh.startX + rh.startW - MIN_W; nw = MIN_W; }
        if (nh < MIN_H) { if (d.includes('n')) ny = rh.startY + rh.startH - MIN_H; nh = MIN_H; }
        rh.node.x = nx; rh.node.y = ny; rh.node.w = nw; rh.node.h = nh;
        renderPlanNode(rh.node);
        renderPlanEdgesFor(rh.node.id);
        wsDirty = true;
        return;
    }

    if (plan.dragNode) {
        const dx = (e.clientX - plan.dragStart.x) / plan.data.view.zoom;
        const dy = (e.clientY - plan.dragStart.y) / plan.data.view.zoom;
        let nx = plan.dragStartPos.x + dx;
        let ny = plan.dragStartPos.y + dy;
        if (plan.snap) { nx = Math.round(nx / 20) * 20; ny = Math.round(ny / 20) * 20; }
        plan.dragNode.x = nx;
        plan.dragNode.y = ny;
        renderPlanNode(plan.dragNode);
        renderPlanEdgesFor(plan.dragNode.id);
        wsDirty = true;
    } else if (plan.pan) {
        plan.data.view.tx = plan.pan.baseTx + (e.clientX - plan.pan.startX);
        plan.data.view.ty = plan.pan.baseTy + (e.clientY - plan.pan.startY);
        applyPlanViewTransform();
        wsDirty = true;
    }
}

function planOnMouseUp() {
    if (!plan) return;
    if (plan.resizeHandle) {
        plan.resizeHandle = null;
        plan.project.updatedAt = Date.now();
        saveStudio();
        return;
    }
    if (plan.dragNode) {
        plan.dragNode = null;
        plan.project.updatedAt = Date.now();
        saveStudio();
    }
    if (plan.pan) {
        plan.pan = null;
        plan.svg.style.cursor = plan.connectMode ? 'crosshair' : 'grab';
    }
}

// Inline text editor — positions a real <input> over the node on the screen
function startPlanInlineEdit(node) {
    if (!plan) return;
    const svgRect = plan.svg.getBoundingClientRect();
    const v = plan.data.view;
    const sx = svgRect.left + v.tx + node.x * v.zoom;
    const sy = svgRect.top  + v.ty + node.y * v.zoom;
    const sw = node.w * v.zoom;
    const sh = node.h * v.zoom;

    const inp = document.createElement('input');
    inp.type  = 'text';
    inp.value = node.text || '';
    inp.style.cssText = [
        `position:fixed`,
        `left:${sx + sw * 0.05}px`,
        `top:${sy + sh / 2 - 15}px`,
        `width:${sw * 0.9}px`,
        `height:30px`,
        `background:rgba(255,255,255,0.97)`,
        `border:2px solid ${getAccent()}`,
        `border-radius:5px`,
        `font:600 13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif`,
        `text-align:center`,
        `color:#0f172a`,
        `z-index:9999`,
        `outline:none`,
        `padding:0 6px`,
        `box-shadow:0 4px 24px rgba(0,0,0,0.45)`
    ].join(';');
    document.body.appendChild(inp);
    inp.focus();
    inp.select();

    let done = false;
    const commit = () => {
        if (done) return;
        done = true;
        const val = inp.value;
        document.body.removeChild(inp);
        if (val !== node.text) {
            node.text = val;
            renderPlanNode(node);
            wsDirty = true;
            plan.project.updatedAt = Date.now();
            saveStudio();
        }
    };
    inp.addEventListener('keydown', ev => {
        if (ev.key === 'Enter' || ev.key === 'Escape') { ev.preventDefault(); commit(); }
    });
    inp.addEventListener('blur', commit);
}

function addPlanNode(kind) {
    const v = plan.data.view;
    // Place at the visible centre of the canvas
    const r = plan.svg.getBoundingClientRect();
    let cx = (r.width / 2 - v.tx) / v.zoom;
    let cy = (r.height / 2 - v.ty) / v.zoom;
    const defaults = {
        rect:          { w: 140, h: 60, text: 'Step' },
        diamond:       { w: 140, h: 90, text: 'Decision?' },
        ellipse:       { w: 140, h: 60, text: 'Start' },
        parallelogram: { w: 140, h: 60, text: 'Data' },
        hexagon:       { w: 140, h: 70, text: 'Step' },
        cylinder:      { w: 120, h: 90, text: 'DB' },
        document:      { w: 140, h: 80, text: 'Doc' },
        cloud:         { w: 160, h: 90, text: 'Cloud' },
        note:          { w: 140, h: 90, text: 'Note' },
        text:          { w: 120, h: 30, text: 'Text' }
    };
    const d = defaults[kind] || defaults.rect;
    let nx = cx - d.w / 2, ny = cy - d.h / 2;
    if (plan.snap) { nx = Math.round(nx / 20) * 20; ny = Math.round(ny / 20) * 20; }
    const colorByKind = {
        note: '#fef9c3', cloud: '#e0f2fe', cylinder: '#fce7f3',
        document: '#f1f5f9', hexagon: '#dcfce7'
    };
    const node = {
        id: 'n_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
        kind, text: d.text,
        x: nx, y: ny, w: d.w, h: d.h,
        color: colorByKind[kind] || '#dbeafe'
    };
    pushPlanHistory();
    plan.data.nodes.push(node);
    renderPlanNode(node);
    selectPlan(node.id);
    wsDirty = true;
    plan.project.updatedAt = Date.now();
    saveStudio();
}

function renderPlanAll() {
    if (!plan) return;
    plan.layers.nodesG.innerHTML = '';
    plan.layers.edgesG.innerHTML = '';
    plan.data.nodes.forEach(renderPlanNode);
    plan.data.edges.forEach(renderPlanEdge);
}

function renderPlanNode(n) {
    if (!plan) return;
    // Remove previous render
    const prev = plan.layers.nodesG.querySelector(`[data-id="${n.id}"]`);
    if (prev) prev.remove();

    const g = document.createElementNS(PLAN_NS, 'g');
    g.setAttribute('data-id', n.id);
    g.setAttribute('transform', `translate(${n.x} ${n.y})`);
    g.style.cursor = plan.connectMode ? 'pointer' : 'move';

    const isSelected   = plan.selectedId === n.id;
    const isConnSrc    = plan.connectMode && plan.connectFromId === n.id;
    if (isConnSrc) g.classList.add('plan-connect-source');

    const stroke  = isSelected ? getAccent() : '#1e293b';
    const strokeW = isSelected ? 2.5 : 1.5;

    let shape;
    const w = n.w, h = n.h;
    if (n.kind === 'rect') {
        shape = document.createElementNS(PLAN_NS, 'rect');
        shape.setAttribute('width', w); shape.setAttribute('height', h);
        shape.setAttribute('rx', 6); shape.setAttribute('ry', 6);
    } else if (n.kind === 'diamond') {
        shape = document.createElementNS(PLAN_NS, 'polygon');
        shape.setAttribute('points', `${w/2},0 ${w},${h/2} ${w/2},${h} 0,${h/2}`);
    } else if (n.kind === 'ellipse') {
        shape = document.createElementNS(PLAN_NS, 'ellipse');
        shape.setAttribute('cx', w / 2); shape.setAttribute('cy', h / 2);
        shape.setAttribute('rx', w / 2); shape.setAttribute('ry', h / 2);
    } else if (n.kind === 'parallelogram') {
        shape = document.createElementNS(PLAN_NS, 'polygon');
        const skew = 18;
        shape.setAttribute('points', `${skew},0 ${w},0 ${w - skew},${h} 0,${h}`);
    } else if (n.kind === 'hexagon') {
        shape = document.createElementNS(PLAN_NS, 'polygon');
        const off = h / 2;
        shape.setAttribute('points', `${off},0 ${w - off},0 ${w},${h/2} ${w - off},${h} ${off},${h} 0,${h/2}`);
    } else if (n.kind === 'cylinder') {
        // Database cylinder — top ellipse + body
        shape = document.createElementNS(PLAN_NS, 'path');
        const er = h * 0.12;   // ellipse radius (half-height) for the top/bottom ovals
        const top = er;
        const bot = h - er;
        shape.setAttribute('d',
            `M 0 ${top} ` +
            `C 0 ${top - er * 1.4}, ${w} ${top - er * 1.4}, ${w} ${top} ` +
            `L ${w} ${bot} ` +
            `C ${w} ${bot + er * 1.4}, 0 ${bot + er * 1.4}, 0 ${bot} ` +
            `Z ` +
            `M 0 ${top} ` +
            `C 0 ${top + er * 1.4}, ${w} ${top + er * 1.4}, ${w} ${top}`
        );
        shape.setAttribute('fill-rule', 'evenodd');
    } else if (n.kind === 'document') {
        // Page with a wavy bottom edge
        shape = document.createElementNS(PLAN_NS, 'path');
        const wave = h * 0.18;
        shape.setAttribute('d',
            `M 0 0 L ${w} 0 L ${w} ${h - wave} ` +
            `Q ${w * 0.75} ${h + wave * 0.3}, ${w * 0.5} ${h - wave * 0.4} ` +
            `T 0 ${h - wave} Z`
        );
    } else if (n.kind === 'cloud') {
        // Cloud-shape made of arcs
        shape = document.createElementNS(PLAN_NS, 'path');
        const r1 = h * 0.30, r2 = h * 0.36, r3 = h * 0.30;
        shape.setAttribute('d',
            `M ${w * 0.20} ${h - r1 * 0.8} ` +
            `A ${r1} ${r1} 0 0 1 ${w * 0.30} ${h * 0.3} ` +
            `A ${r2} ${r2} 0 0 1 ${w * 0.65} ${h * 0.25} ` +
            `A ${r3} ${r3} 0 0 1 ${w - r3 * 0.6} ${h * 0.55} ` +
            `A ${r1} ${r1} 0 0 1 ${w * 0.85} ${h - r1 * 0.4} ` +
            `A ${r2} ${r2} 0 0 1 ${w * 0.45} ${h - r2 * 0.2} ` +
            `A ${r1} ${r1} 0 0 1 ${w * 0.20} ${h - r1 * 0.8} ` +
            `Z`
        );
    } else if (n.kind === 'note') {
        // Sticky-note with a folded corner
        const fold = 14;
        shape = document.createElementNS(PLAN_NS, 'polygon');
        shape.setAttribute('points', `0,0 ${w - fold},0 ${w},${fold} ${w},${h} 0,${h}`);
    } else if (n.kind === 'text') {
        shape = document.createElementNS(PLAN_NS, 'rect');
        shape.setAttribute('width', w); shape.setAttribute('height', h);
        shape.setAttribute('fill', 'transparent');
        shape.setAttribute('stroke', isSelected ? stroke : 'transparent');
        shape.setAttribute('stroke-dasharray', '4 3');
    }
    if (n.kind !== 'text') {
        shape.setAttribute('fill', n.color || '#dbeafe');
        shape.setAttribute('stroke', stroke);
        shape.setAttribute('stroke-width', strokeW);
    } else {
        shape.setAttribute('stroke-width', strokeW);
    }
    g.appendChild(shape);

    // Text label
    const text = document.createElementNS(PLAN_NS, 'text');
    text.setAttribute('x', n.w / 2);
    text.setAttribute('y', n.h / 2);
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dominant-baseline', 'middle');
    text.setAttribute('font-family', '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif');
    text.setAttribute('font-size', n.kind === 'text' ? 14 : 13);
    text.setAttribute('font-weight', n.kind === 'text' ? '500' : '600');
    text.setAttribute('fill', '#0f172a');
    text.style.userSelect = 'none';
    text.style.pointerEvents = 'none';
    text.textContent = n.text || '';
    g.appendChild(text);

    // ── Resize handles (only on selected node) ───────────────────
    if (isSelected) {
        const hs = 5;
        const handleDefs = [
            { cx: 0,   cy: 0,   dir: 'nw', cur: 'nw-resize' },
            { cx: w/2, cy: 0,   dir: 'n',  cur: 'n-resize'  },
            { cx: w,   cy: 0,   dir: 'ne', cur: 'ne-resize' },
            { cx: w,   cy: h/2, dir: 'e',  cur: 'e-resize'  },
            { cx: w,   cy: h,   dir: 'se', cur: 'se-resize' },
            { cx: w/2, cy: h,   dir: 's',  cur: 's-resize'  },
            { cx: 0,   cy: h,   dir: 'sw', cur: 'sw-resize' },
            { cx: 0,   cy: h/2, dir: 'w',  cur: 'w-resize'  },
        ];
        handleDefs.forEach(({ cx, cy, dir, cur }) => {
            const hEl = document.createElementNS(PLAN_NS, 'rect');
            hEl.setAttribute('x', cx - hs);
            hEl.setAttribute('y', cy - hs);
            hEl.setAttribute('width',  hs * 2);
            hEl.setAttribute('height', hs * 2);
            hEl.setAttribute('rx', 2);
            hEl.setAttribute('fill', '#ffffff');
            hEl.setAttribute('stroke', getAccent());
            hEl.setAttribute('stroke-width', 1.5);
            hEl.style.cursor = cur;
            hEl.addEventListener('mousedown', ev => {
                ev.stopPropagation();
                plan.resizeHandle = {
                    node: n, dir,
                    startMX: ev.clientX, startMY: ev.clientY,
                    startX: n.x, startY: n.y,
                    startW: n.w, startH: n.h
                };
            });
            g.appendChild(hEl);
        });
    }

    // ── Interactions ──────────────────────────────────────────────
    g.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        if (plan.connectMode) {
            if (!plan.connectFromId) {
                // First click: set source, show glow
                plan.connectFromId = n.id;
                selectPlan(n.id);
                planUpdateHint();
            } else if (plan.connectFromId !== n.id) {
                // Second click: create edge
                pushPlanHistory();
                plan.data.edges.push({
                    id:    'e_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
                    from:  plan.connectFromId,
                    to:    n.id,
                    label: '',
                    style: 'solid',
                    bidir: false
                });
                plan.connectFromId = null;
                planRemoveRubberBand();
                renderPlanAll();
                planUpdateHint();
                wsDirty = true;
                plan.project.updatedAt = Date.now();
                saveStudio();
            }
            return;
        }
        // Normal drag: select first (lightweight re-render), then set drag state
        pushPlanHistory();
        selectPlan(n.id);
        plan.dragNode     = n;
        plan.dragStart    = { x: e.clientX, y: e.clientY };
        plan.dragStartPos = { x: n.x, y: n.y };
    });
    plan.layers.nodesG.appendChild(g);
}

function renderPlanEdge(e) {
    // Remove any previous render of this edge (line + label share the same data-id)
    plan.layers.edgesG.querySelectorAll(`[data-id="${e.id}"]`).forEach(el => el.remove());

    const a = plan.data.nodes.find(n => n.id === e.from);
    const b = plan.data.nodes.find(n => n.id === e.to);
    if (!a || !b) return;
    const ax = a.x + a.w / 2, ay = a.y + a.h / 2;
    const bx = b.x + b.w / 2, by = b.y + b.h / 2;
    // Trim line to box edges so the arrowhead doesn't disappear inside the shape
    const [tax, tay] = trimToBox(ax, ay, bx, by, a);
    const [tbx, tby] = trimToBox(bx, by, ax, ay, b);

    const isSelected  = plan.selectedId === e.id;
    const edgeColor   = isSelected ? getAccent() : (e.color || '#475569');
    const strokeWidth = isSelected ? 2.5 : 1.8;
    const dashArray   = e.style === 'dashed' ? '9 5' : '';

    const line = document.createElementNS(PLAN_NS, 'line');
    line.setAttribute('data-id', e.id);
    line.setAttribute('x1', tax); line.setAttribute('y1', tay);
    line.setAttribute('x2', tbx); line.setAttribute('y2', tby);
    line.setAttribute('stroke', edgeColor);
    line.setAttribute('stroke-width', strokeWidth);
    if (dashArray) line.setAttribute('stroke-dasharray', dashArray);
    line.setAttribute('marker-end', 'url(#ws-plan-arrow)');
    if (e.bidir) line.setAttribute('marker-start', 'url(#ws-plan-arrow)');
    line.style.cursor = 'pointer';
    line.addEventListener('mousedown', (ev) => {
        ev.stopPropagation();
        selectPlan(e.id);
    });
    plan.layers.edgesG.appendChild(line);

    if (e.label) {
        const t = document.createElementNS(PLAN_NS, 'text');
        t.setAttribute('data-id', e.id);   // same id so cleanup above works
        t.setAttribute('x', (tax + tbx) / 2);
        t.setAttribute('y', (tay + tby) / 2 - 6);
        t.setAttribute('text-anchor', 'middle');
        t.setAttribute('font-family', '-apple-system, sans-serif');
        t.setAttribute('font-size', 11);
        t.setAttribute('fill', '#475569');
        t.textContent = e.label;
        plan.layers.edgesG.appendChild(t);
    }
}

function renderPlanEdgesFor(nodeId) {
    plan.data.edges.forEach(e => {
        if (e.from === nodeId || e.to === nodeId) {
            const old = plan.layers.edgesG.querySelector(`[data-id="${e.id}"]`);
            if (old) old.remove();
            renderPlanEdge(e);
        }
    });
}

// Clip a line from a centre to an outside point against a node's bounding box
function trimToBox(cx, cy, ox, oy, n) {
    const dx = ox - cx, dy = oy - cy;
    if (dx === 0 && dy === 0) return [cx, cy];
    const halfW = n.w / 2, halfH = n.h / 2;
    const tX = halfW / Math.abs(dx);
    const tY = halfH / Math.abs(dy);
    const t = Math.min(isFinite(tX) ? tX : Infinity, isFinite(tY) ? tY : Infinity);
    return [cx + dx * t, cy + dy * t];
}

function selectPlan(id) {
    if (!plan) return;
    const oldId = plan.selectedId;
    plan.selectedId = id;

    // Lightweight: only re-render the items whose selection state actually changed.
    // This avoids clearing and rebuilding ALL DOM nodes on every click/drag,
    // which was causing the mousedown → drag sequence to break.
    const toUpdate = new Set();
    if (oldId) toUpdate.add(oldId);
    if (id)    toUpdate.add(id);
    toUpdate.forEach(itemId => {
        const node = plan.data.nodes.find(n => n.id === itemId);
        const edge = plan.data.edges.find(e => e.id === itemId);
        if (node) renderPlanNode(node);
        else if (edge) renderPlanEdge(edge);
    });

    renderPlanSelectedPanel();
}

function renderPlanSelectedPanel() {
    const panel = document.getElementById('ws-plan-selected');
    if (!panel) return;
    if (!plan || !plan.selectedId) {
        panel.innerHTML = plan && plan.connectMode
            ? '<p class="text-amber-400 text-[10px] px-1">Click a shape, then another to draw an arrow.</p>'
            : '<p class="text-slate-600 text-[10px] italic px-1">Click a shape to select</p>';
        return;
    }
    const node = plan.data.nodes.find(n => n.id === plan.selectedId);
    const edge = plan.data.edges.find(e => e.id === plan.selectedId);

    if (node) {
        const hex = node.color || '#dbeafe';
        panel.innerHTML = `
            <div class="text-slate-300 text-[11px] font-semibold flex items-center gap-2 px-1 capitalize">${node.kind}</div>
            ${node.kind !== 'text' ? `
                <label class="text-slate-500 text-[9px] uppercase tracking-wider px-1">Fill colour</label>
                <input id="ws-plan-color" type="color" value="${hex}" class="w-full h-8 bg-slate-800 rounded-md cursor-pointer border-0 p-0">` : ''}
            <button id="ws-plan-rename"    class="bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10px] px-2 py-1.5 rounded-md flex items-center justify-center gap-2"><i class="fas fa-pen text-[10px]"></i> Rename</button>
            <button id="ws-plan-duplicate" class="bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10px] px-2 py-1.5 rounded-md flex items-center justify-center gap-2"><i class="fas fa-clone text-[10px]"></i> Duplicate</button>
            <button id="ws-plan-delete"    class="bg-slate-800 hover:bg-slate-700 hover:text-red-400 text-slate-500 text-[10px] px-2 py-1.5 rounded-md flex items-center justify-center gap-2"><i class="fas fa-trash text-[10px]"></i> Delete</button>
        `;
        const colorEl = document.getElementById('ws-plan-color');
        if (colorEl) colorEl.oninput = (ev) => { node.color = ev.target.value; renderPlanNode(node); wsDirty = true; saveStudio(); };
        document.getElementById('ws-plan-rename').onclick    = () => startPlanInlineEdit(node);
        document.getElementById('ws-plan-duplicate').onclick = () => duplicatePlanNode();
        document.getElementById('ws-plan-delete').onclick    = () => deletePlanItem(node.id);

    } else if (edge) {
        const isDashed = edge.style === 'dashed';
        const isBidir  = !!edge.bidir;
        const edgeColor = edge.color || '#475569';
        panel.innerHTML = `
            <div class="text-slate-300 text-[11px] font-semibold px-1">Arrow</div>

            <label class="text-slate-500 text-[9px] uppercase tracking-wider px-1">Label</label>
            <button id="ws-plan-edge-label" class="bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10px] px-2 py-1.5 rounded-md flex items-center justify-center gap-2"><i class="fas fa-tag text-[10px]"></i> ${edge.label ? `"${edge.label}"` : 'Add label'}</button>

            <label class="text-slate-500 text-[9px] uppercase tracking-wider px-1">Colour</label>
            <input id="ws-plan-edge-color" type="color" value="${edgeColor}" class="w-full h-8 bg-slate-800 rounded-md cursor-pointer border-0 p-0">

            <label class="text-slate-500 text-[9px] uppercase tracking-wider px-1">Style</label>
            <div class="flex gap-1">
                <button id="ws-plan-edge-solid"  class="flex-1 text-[10px] py-1 rounded-md ${!isDashed ? 'text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}" ${!isDashed ? `style="background:${getAccent()}"` : ''}>Solid</button>
                <button id="ws-plan-edge-dashed" class="flex-1 text-[10px] py-1 rounded-md ${isDashed  ? 'text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}" ${ isDashed ? `style="background:${getAccent()}"` : ''}>Dashed</button>
            </div>

            <label class="flex items-center gap-2 px-1 text-slate-300 text-[10px] cursor-pointer mt-0.5">
                <input id="ws-plan-edge-bidir" type="checkbox" ${isBidir ? 'checked' : ''} style="accent-color:var(--accent)"> Bidirectional
            </label>

            <button id="ws-plan-edge-delete" class="bg-slate-800 hover:bg-slate-700 hover:text-red-400 text-slate-500 text-[10px] px-2 py-1.5 rounded-md flex items-center justify-center gap-2 mt-1"><i class="fas fa-trash text-[10px]"></i> Delete</button>
        `;

        // Label edit (inline)
        document.getElementById('ws-plan-edge-label').onclick = () => {
            const a = plan.data.nodes.find(nd => nd.id === edge.from);
            const b = plan.data.nodes.find(nd => nd.id === edge.to);
            if (!a || !b) return;
            const svgRect = plan.svg.getBoundingClientRect();
            const v = plan.data.view;
            const mx = svgRect.left + v.tx + ((a.x + a.w/2 + b.x + b.w/2) / 2) * v.zoom;
            const my = svgRect.top  + v.ty + ((a.y + a.h/2 + b.y + b.h/2) / 2) * v.zoom - 15;
            const inp = document.createElement('input');
            inp.type = 'text'; inp.value = edge.label || ''; inp.placeholder = 'Arrow label…';
            inp.style.cssText = `position:fixed;left:${mx-70}px;top:${my}px;width:140px;height:28px;background:rgba(255,255,255,.97);border:2px solid ${getAccent()};border-radius:5px;font:500 12px -apple-system,sans-serif;text-align:center;color:#0f172a;z-index:9999;outline:none;padding:0 6px;box-shadow:0 4px 24px rgba(0,0,0,.45)`;
            document.body.appendChild(inp); inp.focus(); inp.select();
            let done = false;
            const commit = () => {
                if (done) return; done = true;
                edge.label = inp.value; document.body.removeChild(inp);
                renderPlanEdge(edge); renderPlanSelectedPanel(); wsDirty = true; saveStudio();
            };
            inp.addEventListener('keydown', ev => { if (ev.key==='Enter'||ev.key==='Escape'){ev.preventDefault();commit();} });
            inp.addEventListener('blur', commit);
        };

        // Colour
        document.getElementById('ws-plan-edge-color').oninput = (ev) => {
            edge.color = ev.target.value; renderPlanEdge(edge); wsDirty = true; saveStudio();
        };

        // Solid / Dashed
        document.getElementById('ws-plan-edge-solid').onclick = () => {
            edge.style = 'solid'; renderPlanEdge(edge); renderPlanSelectedPanel(); wsDirty = true; saveStudio();
        };
        document.getElementById('ws-plan-edge-dashed').onclick = () => {
            edge.style = 'dashed'; renderPlanEdge(edge); renderPlanSelectedPanel(); wsDirty = true; saveStudio();
        };

        // Bidirectional
        document.getElementById('ws-plan-edge-bidir').onchange = (ev) => {
            edge.bidir = ev.target.checked; renderPlanEdge(edge); wsDirty = true; saveStudio();
        };

        document.getElementById('ws-plan-edge-delete').onclick = () => deletePlanItem(edge.id);
    }
}

function deletePlanItem(id) {
    if (!plan) return;
    pushPlanHistory();
    const before = plan.data.nodes.length + plan.data.edges.length;
    plan.data.nodes = plan.data.nodes.filter(n => n.id !== id);
    // Removing a node also removes any edges attached to it
    plan.data.edges = plan.data.edges.filter(e => e.id !== id && e.from !== id && e.to !== id);
    if (plan.selectedId === id) plan.selectedId = null;
    renderPlanAll();
    renderPlanSelectedPanel();
    wsDirty = true;
    plan.project.updatedAt = Date.now();
    saveStudio();
}

function flushPlanSave() {
    if (!plan || !plan.project) return;
    plan.project.data = JSON.parse(JSON.stringify(plan.data));
}

// Render the current SVG (without grid) into a PNG and save to ~/Downloads
async function exportPlanAsPng() {
    if (!plan) return;
    // Compute bounding box of all shapes (with padding)
    if (!plan.data.nodes.length) { alert('Add some shapes first.'); return; }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    plan.data.nodes.forEach(n => {
        minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
        maxX = Math.max(maxX, n.x + n.w); maxY = Math.max(maxY, n.y + n.h);
    });
    const pad = 40;
    minX -= pad; minY -= pad; maxX += pad; maxY += pad;
    const w = maxX - minX, h = maxY - minY;

    // Build a standalone SVG string excluding the grid
    const clone = plan.svg.cloneNode(true);
    const grid1 = clone.querySelector('#ws-plan-gridbg');
    if (grid1) grid1.remove();
    // Remove the second grid layer (it was inserted right after gridBg in root)
    const root = clone.querySelector('#ws-plan-root');
    if (root) {
        // Reset transform and re-position so the bounding box maps to (0,0,w,h)
        root.setAttribute('transform', `translate(${-minX} ${-minY})`);
        // Drop the major grid pattern rect (the second child of root)
        const children = [...root.children];
        // gridBg already removed; the next rect (major grid) should be removed too
        children.forEach(c => {
            if (c.getAttribute('fill') === 'url(#ws-plan-grid-major)') c.remove();
        });
    }
    clone.setAttribute('width',  w);
    clone.setAttribute('height', h);
    clone.setAttribute('viewBox', `0 0 ${w} ${h}`);
    clone.style.cursor = 'default';
    const svgStr = new XMLSerializer().serializeToString(clone);
    const svgBlob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);

    const img = new Image();
    img.onload = () => {
        const canvas = document.createElement('canvas');
        const scale = 2;   // 2× for crisp output
        canvas.width  = Math.ceil(w * scale);
        canvas.height = Math.ceil(h * scale);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);

        canvas.toBlob((blob) => {
            const filename = `${(plan.project.name || 'diagram').replace(/[^a-z0-9]+/gi,'_')}.png`;
            const target = path.join(os.homedir(), 'Downloads', filename);
            const reader = new FileReader();
            reader.onload = () => {
                try {
                    const buf = Buffer.from(reader.result);
                    fs.writeFileSync(target, buf);
                    alert('Exported to ~/Downloads/' + filename);
                } catch (err) {
                    alert('Export failed: ' + err.message);
                }
            };
            reader.readAsArrayBuffer(blob);
        }, 'image/png');
    };
    img.onerror = () => { URL.revokeObjectURL(url); alert('Could not render diagram.'); };
    img.src = url;
}

// ──────────────────────────────────────────────────────────────
// DRAW editor — HTML5 canvas with pen/eraser/shapes/colors/undo
// ──────────────────────────────────────────────────────────────
let drawCtx = null;
let drawState = null;

function mountDrawEditor(p) {
    const wrap = document.getElementById('ws-draw');
    wrap.classList.remove('hidden');
    const canvas = document.getElementById('ws-draw-canvas');
    drawCtx = canvas.getContext('2d');

    drawState = {
        canvas,
        tool: 'pen',
        color: document.getElementById('ws-draw-color').value,
        size:  parseInt(document.getElementById('ws-draw-size').value, 10),
        drawing: false,
        startX: 0, startY: 0,
        snapshot: null,
        undoStack: []
    };

    // White background then load existing data
    drawCtx.fillStyle = '#ffffff';
    drawCtx.fillRect(0, 0, canvas.width, canvas.height);
    if (p.data && typeof p.data === 'string' && p.data.startsWith('data:image')) {
        const img = new Image();
        img.onload = () => {
            drawCtx.drawImage(img, 0, 0, canvas.width, canvas.height);
            pushDrawUndo();
        };
        img.src = p.data;
    } else {
        pushDrawUndo();
    }

    // Tool buttons
    document.querySelectorAll('.ws-draw-tool').forEach(btn => {
        btn.onclick = () => {
            drawState.tool = btn.dataset.tool;
            document.querySelectorAll('.ws-draw-tool').forEach(b => b.classList.toggle('active', b === btn));
        };
    });

    document.getElementById('ws-draw-color').oninput = (e) => { drawState.color = e.target.value; };
    document.getElementById('ws-draw-size').oninput  = (e) => { drawState.size  = parseInt(e.target.value, 10); };
    document.getElementById('ws-draw-undo').onclick  = drawUndo;
    document.getElementById('ws-draw-clear').onclick = () => {
        if (!confirm('Clear the canvas?')) return;
        drawCtx.fillStyle = '#ffffff';
        drawCtx.fillRect(0, 0, canvas.width, canvas.height);
        pushDrawUndo();
        wsDirty = true;
    };

    // Mouse handlers
    canvas.onmousedown = (e) => {
        const r = canvas.getBoundingClientRect();
        const x = (e.clientX - r.left) * canvas.width / r.width;
        const y = (e.clientY - r.top)  * canvas.height / r.height;
        drawState.drawing = true;
        drawState.startX = x; drawState.startY = y;
        drawState.snapshot = drawCtx.getImageData(0, 0, canvas.width, canvas.height);
        if (drawState.tool === 'pen' || drawState.tool === 'eraser') {
            drawCtx.beginPath();
            drawCtx.moveTo(x, y);
        }
    };
    canvas.onmousemove = (e) => {
        if (!drawState.drawing) return;
        const r = canvas.getBoundingClientRect();
        const x = (e.clientX - r.left) * canvas.width / r.width;
        const y = (e.clientY - r.top)  * canvas.height / r.height;
        const ctx = drawCtx;
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.lineWidth = drawState.size;

        if (drawState.tool === 'pen') {
            ctx.strokeStyle = drawState.color;
            ctx.lineTo(x, y); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(x, y);
        } else if (drawState.tool === 'eraser') {
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = drawState.size * 2.5;
            ctx.lineTo(x, y); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(x, y);
        } else {
            // line / rect / ellipse — preview from snapshot every move
            ctx.putImageData(drawState.snapshot, 0, 0);
            ctx.strokeStyle = drawState.color;
            ctx.lineWidth = drawState.size;
            ctx.beginPath();
            if (drawState.tool === 'line') {
                ctx.moveTo(drawState.startX, drawState.startY);
                ctx.lineTo(x, y);
            } else if (drawState.tool === 'rect') {
                ctx.rect(drawState.startX, drawState.startY, x - drawState.startX, y - drawState.startY);
            } else if (drawState.tool === 'ellipse') {
                const cx = (drawState.startX + x) / 2;
                const cy = (drawState.startY + y) / 2;
                const rx = Math.abs(x - drawState.startX) / 2;
                const ry = Math.abs(y - drawState.startY) / 2;
                ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
            }
            ctx.stroke();
        }
    };
    const endDraw = () => {
        if (!drawState.drawing) return;
        drawState.drawing = false;
        pushDrawUndo();
        wsDirty = true;
    };
    canvas.onmouseup    = endDraw;
    canvas.onmouseleave = endDraw;

    document.getElementById('ws-tools').innerHTML =
        `<span class="text-slate-500 text-[10px] px-2">Pen · Eraser · Line · Rect · Ellipse · Color · Size · Undo</span>`;
}

function pushDrawUndo() {
    if (!drawCtx || !drawState) return;
    drawState.undoStack.push(drawCtx.getImageData(0, 0, drawState.canvas.width, drawState.canvas.height));
    if (drawState.undoStack.length > 30) drawState.undoStack.shift();
}

function drawUndo() {
    if (!drawState || drawState.undoStack.length < 2) return;
    drawState.undoStack.pop();
    const prev = drawState.undoStack[drawState.undoStack.length - 1];
    drawCtx.putImageData(prev, 0, 0);
    wsDirty = true;
}

function flushDrawSave() {
    if (!drawState || !wsProject) return;
    wsProject.data = drawState.canvas.toDataURL('image/png');
}

// ──────────────────────────────────────────────────────────────
// 3D editor — three.js scene with primitives + transforms
// ──────────────────────────────────────────────────────────────
let three = {
    scene: null, camera: null, renderer: null,
    orbit: null, transform: null, grid: null,
    raycaster: null, mouse: null,
    objects: [],            // user-added meshes
    selected: null,
    rafId: null,
    onResize: null,
    onPointerDown: null,
    onKeyDown: null
};

function mount3DEditor(p) {
    const wrap = document.getElementById('ws-3d');
    wrap.classList.remove('hidden');
    const viewport = document.getElementById('ws-3d-viewport');
    if (typeof THREE === 'undefined') {
        viewport.innerHTML = '<div class="absolute inset-0 flex items-center justify-center text-slate-400 text-sm">three.js failed to load — check your network connection.</div>';
        return;
    }

    // Scene + camera + renderer
    three.scene = new THREE.Scene();
    three.scene.background = new THREE.Color(0x0f172a);

    three.camera = new THREE.PerspectiveCamera(50, viewport.clientWidth / viewport.clientHeight, 0.1, 1000);
    three.camera.position.set(5, 4, 7);

    three.renderer = new THREE.WebGLRenderer({ antialias: true });
    three.renderer.setPixelRatio(window.devicePixelRatio);
    three.renderer.setSize(viewport.clientWidth, viewport.clientHeight);
    viewport.innerHTML = '';
    viewport.appendChild(three.renderer.domElement);

    // Grid + lights
    const grid = new THREE.GridHelper(20, 20, 0x334155, 0x1e293b);
    three.scene.add(grid);
    three.grid = grid;
    three.scene.add(new THREE.AmbientLight(0xffffff, 0.45));
    const dir = new THREE.DirectionalLight(0xffffff, 0.85);
    dir.position.set(5, 10, 7);
    three.scene.add(dir);

    // Restore saved scene appearance
    const sceneOpts = (p.data && p.data.scene) || {};
    if (sceneOpts.bg) three.scene.background = new THREE.Color(sceneOpts.bg);
    if (sceneOpts.gridVisible === false) grid.visible = false;

    // Controls
    three.orbit = new THREE.OrbitControls(three.camera, three.renderer.domElement);
    three.orbit.enableDamping = true;
    three.orbit.dampingFactor = 0.08;

    three.transform = new THREE.TransformControls(three.camera, three.renderer.domElement);
    three.scene.add(three.transform);
    three.transform.addEventListener('dragging-changed', (e) => {
        three.orbit.enabled = !e.value;
        if (!e.value) {
            // Drag finished — capture state
            wsDirty = true;
            scheduleSerialize();
        }
    });

    three.raycaster = new THREE.Raycaster();
    three.mouse     = new THREE.Vector2();
    three.objects   = [];
    three.selected  = null;

    // Load existing scene
    if (p.data && p.data.objects && Array.isArray(p.data.objects)) {
        p.data.objects.forEach(o => addPrimitiveFromData(o));
    }

    // Mouse pick (left click on viewport)
    three.onPointerDown = (e) => {
        if (e.button !== 0) return;
        if (e.target !== three.renderer.domElement) return;
        const r = three.renderer.domElement.getBoundingClientRect();
        three.mouse.x =  ((e.clientX - r.left) / r.width)  * 2 - 1;
        three.mouse.y = -((e.clientY - r.top)  / r.height) * 2 + 1;
        three.raycaster.setFromCamera(three.mouse, three.camera);
        const hits = three.raycaster.intersectObjects(three.objects, false);
        if (hits.length) selectThree(hits[0].object);
        else selectThree(null);
    };
    three.renderer.domElement.addEventListener('pointerdown', three.onPointerDown);

    // Keyboard: Delete / Backspace removes selection; T/R/S switches mode
    three.onKeyDown = (e) => {
        if (document.getElementById('studio-workspace').classList.contains('hidden')) return;
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
        if ((e.key === 'Delete' || e.key === 'Backspace') && three.selected) {
            removeSelectedThree();
        } else if (e.key === 't' || e.key === 'T') {
            setThreeMode('translate');
        } else if (e.key === 'r' || e.key === 'R') {
            setThreeMode('rotate');
        } else if (e.key === 's' || e.key === 'S') {
            setThreeMode('scale');
        } else if ((e.key === 'd' || e.key === 'D') && three.selected) {
            duplicateSelectedThree();
        } else if (e.key === 'f' || e.key === 'F') {
            // Frame — reset camera to default
            setThreeView('persp');
        }
    };
    window.addEventListener('keydown', three.onKeyDown);

    // Resize
    three.onResize = () => {
        if (!three.renderer) return;
        const w = viewport.clientWidth, h = viewport.clientHeight;
        three.camera.aspect = w / h;
        three.camera.updateProjectionMatrix();
        three.renderer.setSize(w, h);
    };
    window.addEventListener('resize', three.onResize);

    // Toolbar wiring
    document.querySelectorAll('.ws-3d-add').forEach(btn => {
        btn.onclick = () => addPrimitive(btn.dataset.prim);
    });
    document.querySelectorAll('.ws-3d-mode').forEach(btn => {
        btn.onclick = () => setThreeMode(btn.dataset.mode);
    });
    document.querySelectorAll('.ws-3d-view').forEach(btn => {
        btn.onclick = () => setThreeView(btn.dataset.view);
    });

    // Scene options
    const gridChk = document.getElementById('ws-3d-grid');
    if (gridChk) {
        gridChk.checked = grid.visible;
        gridChk.onchange = (e) => { grid.visible = e.target.checked; flush3DSave(); saveStudio(); };
    }
    const snapChk = document.getElementById('ws-3d-snap');
    if (snapChk) {
        snapChk.checked = false;
        snapChk.onchange = (e) => {
            if (!three.transform) return;
            three.transform.setTranslationSnap(e.target.checked ? 0.5 : null);
            three.transform.setRotationSnap(e.target.checked ? Math.PI / 12 : null);
            three.transform.setScaleSnap   (e.target.checked ? 0.1 : null);
        };
    }
    const bgEl = document.getElementById('ws-3d-bg');
    if (bgEl) {
        const cur = three.scene.background;
        bgEl.value = cur ? '#' + cur.getHexString() : '#0f172a';
        bgEl.oninput = (e) => {
            three.scene.background = new THREE.Color(e.target.value);
            wsDirty = true; scheduleSerialize();
        };
    }

    setThreeMode('translate');
    selectThree(null);
    render3DObjectList();

    // Render loop
    const tick = () => {
        if (!three.renderer) return;
        three.orbit.update();
        three.renderer.render(three.scene, three.camera);
        three.rafId = requestAnimationFrame(tick);
    };
    tick();

    document.getElementById('ws-tools').innerHTML =
        `<span class="text-slate-500 text-[10px] px-2">Add primitives → click to select → drag gizmo · T/R/S to switch mode · Del to remove</span>`;
}

function teardown3DEditor() {
    if (three.rafId) cancelAnimationFrame(three.rafId);
    if (three.onResize)      window.removeEventListener('resize', three.onResize);
    if (three.onKeyDown)     window.removeEventListener('keydown', three.onKeyDown);
    if (three.onPointerDown && three.renderer) {
        three.renderer.domElement.removeEventListener('pointerdown', three.onPointerDown);
    }
    if (three.renderer) {
        try { three.renderer.dispose(); } catch (_) {}
        if (three.renderer.domElement && three.renderer.domElement.parentNode) {
            three.renderer.domElement.parentNode.removeChild(three.renderer.domElement);
        }
    }
    three = {
        scene: null, camera: null, renderer: null,
        orbit: null, transform: null, grid: null,
        raycaster: null, mouse: null,
        objects: [], selected: null, rafId: null,
        onResize: null, onPointerDown: null, onKeyDown: null
    };
}

function setThreeMode(mode) {
    if (!three.transform) return;
    three.transform.setMode(mode);
    document.querySelectorAll('.ws-3d-mode').forEach(b => {
        b.classList.toggle('active', b.dataset.mode === mode);
    });
}

function setThreeView(view) {
    if (!three.camera || !three.orbit) return;
    const dist = 9;
    if      (view === 'top')   three.camera.position.set(0, dist,  0.001);
    else if (view === 'front') three.camera.position.set(0,  1,  dist);
    else if (view === 'side')  three.camera.position.set(dist, 1,  0);
    else                       three.camera.position.set(5, 4, 7);   // iso/persp
    three.orbit.target.set(0, 0.5, 0);
    three.orbit.update();
}

function render3DObjectList() {
    const wrap = document.getElementById('ws-3d-list');
    if (!wrap) return;
    if (!three.objects.length) {
        wrap.innerHTML = '<p class="text-slate-600 text-[10px] italic px-1">Empty scene</p>';
        return;
    }
    wrap.innerHTML = '';
    three.objects.forEach((m, i) => {
        const isSel = m === three.selected;
        const row = document.createElement('button');
        row.className = `flex items-center gap-2 px-1.5 py-1 rounded text-left ${
            isSel ? 'text-white' : 'bg-slate-800/40 text-slate-300 hover:bg-slate-800'
        }`;
        if (isSel) row.style.backgroundColor = getAccent();
        const sw = document.createElement('span');
        sw.style.cssText = `width:10px;height:10px;border-radius:2px;background:#${m.material.color.getHexString()};flex-shrink:0`;
        const lbl = document.createElement('span');
        lbl.textContent = (m.userData.name || m.userData.kind || 'object') + ' ' + (i + 1);
        lbl.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1';
        row.appendChild(sw); row.appendChild(lbl);
        row.onclick = () => selectThree(m);
        wrap.appendChild(row);
    });
}

function duplicateSelectedThree() {
    if (!three.selected) return;
    const m = three.selected;
    const clone = m.clone();
    clone.material = m.material.clone();
    clone.userData = { kind: m.userData.kind, name: m.userData.name };
    clone.position.x += 1;
    three.scene.add(clone);
    three.objects.push(clone);
    selectThree(clone);
    wsDirty = true;
    scheduleSerialize();
}

function makePrimitiveGeometry(kind) {
    switch (kind) {
        case 'cube':         return new THREE.BoxGeometry(1, 1, 1);
        case 'sphere':       return new THREE.SphereGeometry(0.6, 24, 16);
        case 'cylinder':     return new THREE.CylinderGeometry(0.5, 0.5, 1.2, 24);
        case 'cone':         return new THREE.ConeGeometry(0.6, 1.2, 24);
        case 'torus':        return new THREE.TorusGeometry(0.5, 0.18, 12, 32);
        case 'plane':        return new THREE.PlaneGeometry(2, 2);
        case 'tetrahedron':  return new THREE.TetrahedronGeometry(0.7, 0);
        case 'octahedron':   return new THREE.OctahedronGeometry(0.7, 0);
        case 'dodecahedron': return new THREE.DodecahedronGeometry(0.7, 0);
        case 'icosahedron':  return new THREE.IcosahedronGeometry(0.7, 0);
        case 'torusknot':    return new THREE.TorusKnotGeometry(0.45, 0.13, 64, 8);
        case 'ring':         return new THREE.RingGeometry(0.3, 0.7, 32);
        default:             return new THREE.BoxGeometry(1, 1, 1);
    }
}

function addPrimitive(kind) {
    const geom = makePrimitiveGeometry(kind);
    const colors = ['#dc2626', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#a855f7', '#ec4899'];
    const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(colors[Math.floor(Math.random() * colors.length)]),
        roughness: 0.55, metalness: 0.05, side: THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.userData.kind = kind;
    mesh.userData.name = kind;
    mesh.position.y = 0.6;
    three.scene.add(mesh);
    three.objects.push(mesh);
    selectThree(mesh);
    render3DObjectList();
    wsDirty = true;
    scheduleSerialize();
}

function addPrimitiveFromData(o) {
    const kind = o.kind || 'cube';
    const geom = makePrimitiveGeometry(kind);
    const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(o.color || getAccent()),
        roughness: typeof o.roughness === 'number' ? o.roughness : 0.55,
        metalness: typeof o.metalness === 'number' ? o.metalness : 0.05,
        wireframe: !!o.wireframe,
        side: THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.userData.kind = kind;
    mesh.userData.name = o.name || kind;
    if (o.position) mesh.position.set(o.position[0], o.position[1], o.position[2]);
    if (o.rotation) mesh.rotation.set(o.rotation[0], o.rotation[1], o.rotation[2]);
    if (o.scale)    mesh.scale.set(o.scale[0], o.scale[1], o.scale[2]);
    three.scene.add(mesh);
    three.objects.push(mesh);
}

function selectThree(mesh) {
    three.selected = mesh;
    if (mesh) three.transform.attach(mesh);
    else three.transform.detach();
    renderSelected3DPanel();
    render3DObjectList();
}

function removeSelectedThree() {
    if (!three.selected) return;
    three.transform.detach();
    three.scene.remove(three.selected);
    three.objects = three.objects.filter(o => o !== three.selected);
    three.selected = null;
    renderSelected3DPanel();
    render3DObjectList();
    wsDirty = true;
    scheduleSerialize();
}

function renderSelected3DPanel() {
    const panel = document.getElementById('ws-3d-selected');
    if (!panel) return;
    if (!three.selected) {
        panel.innerHTML = '<p class="text-slate-600 text-[10px] italic px-1">Click an object to select</p>';
        return;
    }
    const m = three.selected;
    const hex = '#' + m.material.color.getHexString();
    const f = (v) => v.toFixed(2);
    const name = m.userData.name || m.userData.kind || 'object';
    panel.innerHTML = `
        <div class="flex items-center gap-2 px-1">
            <i class="fas fa-cube text-[10px] text-slate-500"></i>
            <input id="ws-3d-name" value="${studioEscape(name)}" class="bg-transparent text-slate-200 text-[11px] font-semibold outline-none border-b border-transparent focus:border-slate-600 flex-1 min-w-0">
        </div>
        <label class="text-slate-500 text-[9px] uppercase tracking-wider px-1">Color</label>
        <input id="ws-3d-color" type="color" value="${hex}" class="w-full h-7 bg-slate-800 rounded-md cursor-pointer border-0 p-0">

        <label class="text-slate-500 text-[9px] uppercase tracking-wider px-1 mt-1">Position (X · Y · Z)</label>
        <div class="grid grid-cols-3 gap-1">
            <input id="ws-3d-px" type="number" step="0.1" value="${f(m.position.x)}" class="bg-slate-800 text-slate-200 text-[10px] px-1.5 py-1 rounded outline-none focus:bg-slate-700">
            <input id="ws-3d-py" type="number" step="0.1" value="${f(m.position.y)}" class="bg-slate-800 text-slate-200 text-[10px] px-1.5 py-1 rounded outline-none focus:bg-slate-700">
            <input id="ws-3d-pz" type="number" step="0.1" value="${f(m.position.z)}" class="bg-slate-800 text-slate-200 text-[10px] px-1.5 py-1 rounded outline-none focus:bg-slate-700">
        </div>

        <label class="text-slate-500 text-[9px] uppercase tracking-wider px-1 mt-1">Scale</label>
        <div class="grid grid-cols-3 gap-1">
            <input id="ws-3d-sx" type="number" step="0.1" min="0.05" value="${f(m.scale.x)}" class="bg-slate-800 text-slate-200 text-[10px] px-1.5 py-1 rounded outline-none focus:bg-slate-700">
            <input id="ws-3d-sy" type="number" step="0.1" min="0.05" value="${f(m.scale.y)}" class="bg-slate-800 text-slate-200 text-[10px] px-1.5 py-1 rounded outline-none focus:bg-slate-700">
            <input id="ws-3d-sz" type="number" step="0.1" min="0.05" value="${f(m.scale.z)}" class="bg-slate-800 text-slate-200 text-[10px] px-1.5 py-1 rounded outline-none focus:bg-slate-700">
        </div>

        <label class="text-slate-500 text-[9px] uppercase tracking-wider px-1 mt-1">Material</label>
        <div class="px-1 flex items-center gap-2">
            <span class="text-slate-400 text-[9px] w-12">Rough</span>
            <input id="ws-3d-rough" type="range" min="0" max="1" step="0.05" value="${m.material.roughness}" class="flex-1" style="accent-color:var(--accent)">
        </div>
        <div class="px-1 flex items-center gap-2">
            <span class="text-slate-400 text-[9px] w-12">Metal</span>
            <input id="ws-3d-metal" type="range" min="0" max="1" step="0.05" value="${m.material.metalness}" class="flex-1" style="accent-color:var(--accent)">
        </div>
        <label class="flex items-center gap-2 px-1 text-slate-300 text-[10px] cursor-pointer">
            <input id="ws-3d-wire" type="checkbox" ${m.material.wireframe ? 'checked' : ''} style="accent-color:var(--accent)">Wireframe
        </label>

        <button id="ws-3d-duplicate" class="bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10px] px-2 py-1.5 rounded-md flex items-center justify-center gap-2 mt-1"><i class="fas fa-clone text-[10px]"></i> Duplicate</button>
        <button id="ws-3d-delete"    class="bg-slate-800 hover:bg-red-600/30 hover:text-red-400 text-slate-400 text-[10px] px-2 py-1.5 rounded-md flex items-center justify-center gap-2"><i class="fas fa-trash text-[10px]"></i> Delete</button>
    `;
    const dirty = () => { wsDirty = true; scheduleSerialize(); };
    document.getElementById('ws-3d-name').oninput  = (e) => { m.userData.name = e.target.value; render3DObjectList(); dirty(); };
    document.getElementById('ws-3d-color').oninput = (e) => { m.material.color.set(e.target.value); render3DObjectList(); dirty(); };
    ['x','y','z'].forEach(ax => {
        document.getElementById('ws-3d-p' + ax).oninput = (e) => {
            const v = parseFloat(e.target.value); if (isFinite(v)) { m.position[ax] = v; dirty(); }
        };
        document.getElementById('ws-3d-s' + ax).oninput = (e) => {
            const v = parseFloat(e.target.value); if (isFinite(v) && v > 0.001) { m.scale[ax] = v; dirty(); }
        };
    });
    document.getElementById('ws-3d-rough').oninput = (e) => { m.material.roughness = parseFloat(e.target.value); dirty(); };
    document.getElementById('ws-3d-metal').oninput = (e) => { m.material.metalness = parseFloat(e.target.value); dirty(); };
    document.getElementById('ws-3d-wire').onchange  = (e) => { m.material.wireframe = e.target.checked; dirty(); };
    document.getElementById('ws-3d-delete').onclick    = removeSelectedThree;
    document.getElementById('ws-3d-duplicate').onclick = duplicateSelectedThree;
}

function scheduleSerialize() {
    if (wsSaveTimer) clearTimeout(wsSaveTimer);
    wsSaveTimer = setTimeout(() => {
        flush3DSave();
        if (wsProject) { wsProject.updatedAt = Date.now(); saveStudio(); }
    }, 400);
}

function flush3DSave() {
    if (!wsProject || !three.scene) return;
    const objects = three.objects.map(o => ({
        kind:      o.userData.kind || 'cube',
        name:      o.userData.name || o.userData.kind || 'object',
        position:  [o.position.x, o.position.y, o.position.z],
        rotation:  [o.rotation.x, o.rotation.y, o.rotation.z],
        scale:     [o.scale.x, o.scale.y, o.scale.z],
        color:     '#' + o.material.color.getHexString(),
        roughness: o.material.roughness,
        metalness: o.material.metalness,
        wireframe: !!o.material.wireframe
    }));
    const scene = {
        bg:          three.scene.background ? '#' + three.scene.background.getHexString() : null,
        gridVisible: three.grid ? three.grid.visible : true
    };
    wsProject.data = { objects, scene };
}

// ──────────────────────────────────────────────────────────────
// Init
// ──────────────────────────────────────────────────────────────
function initStudio() {
    // NOTE: the click handler for #vault-new-project-btn is owned by vault.js —
    // it's the "Project" row of the vault's New menu and calls openStudioEditor()
    // directly, so no listener is attached here.
    document.getElementById('studio-editor-close').onclick = closeStudioEditor;
    document.getElementById('studio-save-btn').onclick     = saveStudioFromEditor;
    document.getElementById('studio-delete-btn').onclick   = closeStudioEditor;   // not used now
    document.getElementById('studio-name').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') saveStudioFromEditor();
    });

    // Workspace toolbar
    document.getElementById('ws-back-btn').onclick = () => {
        // Persist whatever the active editor produces
        if (wsProject) {
            if (wsProject.type === 'plan')  flushPlanSave();
            if (wsProject.type === 'draw')  flushDrawSave();
            if (wsProject.type === '3d')    flush3DSave();
            // build saves on input already
            commitWorkspace();
        }
        closeWorkspace();
    };
    document.getElementById('ws-save-btn').onclick = () => {
        if (!wsProject) return;
        if (wsProject.type === 'plan')  flushPlanSave();
        if (wsProject.type === 'draw')  flushDrawSave();
        if (wsProject.type === '3d')    flush3DSave();
        commitWorkspace();
        // brief visual feedback
        const btn = document.getElementById('ws-save-btn');
        const originalHTML = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-check text-[10px]"></i> Saved';
        setTimeout(() => { btn.innerHTML = originalHTML; }, 900);
    };
    document.getElementById('ws-delete-btn').onclick = deleteCurrentProject;
    document.getElementById('ws-share-btn').onclick  = exportCurrentWorkspace;
    document.getElementById('ws-name').oninput   = () => { wsDirty = true; };
    document.getElementById('ws-status').onchange = () => { wsDirty = true; commitWorkspace(); };

    // Delete key support for the plan editor (3D editor handles its own).
    window.addEventListener('keydown', (e) => {
        const ws = document.getElementById('studio-workspace');
        if (ws.classList.contains('hidden')) return;
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
        if (plan && plan.selectedId && (e.key === 'Delete' || e.key === 'Backspace')) {
            e.preventDefault();
            deletePlanItem(plan.selectedId);
        }
    });

    migrateStudioProjectsToVault();
}
