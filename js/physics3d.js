// ── Physics 3D Sandbox  ─────────────────────────────────────────────────
// Three.js-based 3D physics: spheres, boxes, cylinders, cones, tori.
// Drop objects, watch them fall, collide, bounce. Edit mass & restitution.
// Depends on global THREE (vendor/three.min.js) + THREE.OrbitControls.
(function () {
'use strict';

/* ══════════════════════════════════════════════════════
   STATE
══════════════════════════════════════════════════════ */
let _scene, _camera, _renderer, _orbit;
let _objects = [];
let _rafId = null;
let _paused = false;
let _speed  = 1.0;
let _lastTs = 0;
let _sel    = null;
let _tool   = 'sphere';
let _nid    = 0;
let _initialized = false;
let _orbitWasMoved = false; // distinguish click vs orbit drag

const GRAVITY   = 9.8;
const ROOM_HALF = 10;

/* ══════════════════════════════════════════════════════
   SHAPE CATALOGUE
══════════════════════════════════════════════════════ */
const SHAPES = [
    { id:'sphere',   label:'Sphere',   icon:'fa-circle',       hex:0x3b82f6, css:'#3b82f6' },
    { id:'box',      label:'Box',      icon:'fa-cube',         hex:0x60a5fa, css:'#60a5fa' },
    { id:'cylinder', label:'Cylinder', icon:'fa-database',     hex:0x4ade80, css:'#4ade80' },
    { id:'cone',     label:'Cone',     icon:'fa-play',         hex:0xfbbf24, css:'#fbbf24' },
    { id:'torus',    label:'Torus',    icon:'fa-ring',         hex:0xa78bfa, css:'#a78bfa' },
    { id:'select',   label:'Select',   icon:'fa-mouse-pointer',hex:0x64748b, css:'#64748b' },
    { id:'erase',    label:'Erase',    icon:'fa-eraser',       hex:0xef4444, css:'#ef4444' },
];

/* ══════════════════════════════════════════════════════
   OBJECT FACTORY
══════════════════════════════════════════════════════ */
function _makeMesh(type) {
    const T = window.THREE;
    let geo;
    switch (type) {
        case 'box':      geo = new T.BoxGeometry(1, 1, 1);                         break;
        case 'cylinder': geo = new T.CylinderGeometry(0.4, 0.4, 1, 20);           break;
        case 'cone':     geo = new T.ConeGeometry(0.45, 1, 20);                    break;
        case 'torus':    geo = new T.TorusGeometry(0.38, 0.16, 12, 32);           break;
        default:         geo = new T.SphereGeometry(0.5, 22, 22);
    }
    const def = SHAPES.find(s => s.id === type) || SHAPES[0];
    const mat = new T.MeshPhongMaterial({ color: def.hex, shininess: 90 });
    const mesh = new T.Mesh(geo, mat);
    mesh.castShadow    = true;
    mesh.receiveShadow = false;
    return mesh;
}

// Approximate bounding radius for collision
function _bR(o) {
    switch (o.type) {
        case 'box':      return 0.5;
        case 'cylinder': return 0.5;
        case 'cone':     return 0.5;
        case 'torus':    return 0.54;
        default:         return 0.5;
    }
}

// Y offset from centre to bottom edge (for floor collision)
function _botY(o) {
    switch (o.type) {
        case 'sphere':   return 0.5;
        case 'box':      return 0.5;
        case 'cylinder': return 0.5;
        case 'cone':     return 0.5;
        case 'torus':    return 0.16;
        default:         return 0.5;
    }
}

function _addObject(type, pos) {
    const T = window.THREE;
    const mesh = _makeMesh(type);
    mesh.position.set(pos.x, pos.y, pos.z);
    _scene.add(mesh);
    const obj = {
        id: 'p3d' + (++_nid),
        type, mesh,
        mass: 1.0,
        restitution: 0.45,
        vx: (Math.random()-0.5)*0.4,
        vy: 0,
        vz: (Math.random()-0.5)*0.4,
        fixed: false,
    };
    _objects.push(obj);
    return obj;
}

function _removeObject(id) {
    const i = _objects.findIndex(o => o.id === id);
    if (i < 0) return;
    const [o] = _objects.splice(i, 1);
    _scene.remove(o.mesh);
    o.mesh.geometry.dispose();
    o.mesh.material.dispose();
    if (_sel === id) { _sel = null; _renderProps(); }
}

/* ══════════════════════════════════════════════════════
   PHYSICS STEP
══════════════════════════════════════════════════════ */
function _step(dt) {
    for (const o of _objects) {
        if (o.fixed) continue;
        o.vy -= GRAVITY * dt;

        const p = o.mesh.position;
        p.x += o.vx * dt;
        p.y += o.vy * dt;
        p.z += o.vz * dt;

        // Visual spin for non-spheres
        if (o.type !== 'sphere') {
            o.mesh.rotation.x += o.vz * dt * 0.7;
            o.mesh.rotation.z -= o.vx * dt * 0.7;
        }

        // Floor
        const bot = _botY(o);
        if (p.y - bot < 0) {
            p.y = bot;
            o.vy = -o.vy * o.restitution;
            o.vx *= 0.82;
            o.vz *= 0.82;
            if (Math.abs(o.vy) < 0.06) o.vy = 0;
        }

        // Side walls
        const wall = ROOM_HALF - _bR(o);
        if (p.x >  wall) { p.x =  wall; o.vx = -Math.abs(o.vx) * o.restitution; }
        if (p.x < -wall) { p.x = -wall; o.vx =  Math.abs(o.vx) * o.restitution; }
        if (p.z >  wall) { p.z =  wall; o.vz = -Math.abs(o.vz) * o.restitution; }
        if (p.z < -wall) { p.z = -wall; o.vz =  Math.abs(o.vz) * o.restitution; }
    }

    // Object–object collision (sphere approximation)
    for (let i = 0; i < _objects.length; i++) {
        for (let j = i + 1; j < _objects.length; j++) {
            const a = _objects[i], b = _objects[j];
            if (a.fixed && b.fixed) continue;
            const pa = a.mesh.position, pb = b.mesh.position;
            const dx = pb.x - pa.x, dy = pb.y - pa.y, dz = pb.z - pa.z;
            const dist2 = dx*dx + dy*dy + dz*dz;
            const minD  = _bR(a) + _bR(b);
            if (dist2 >= minD * minD || dist2 < 1e-6) continue;
            const dist   = Math.sqrt(dist2);
            const nx = dx/dist, ny = dy/dist, nz = dz/dist;
            const ov = minD - dist;

            const ma = a.fixed ? 1e9 : a.mass;
            const mb = b.fixed ? 1e9 : b.mass;
            const tot = ma + mb;
            if (!a.fixed) { pa.x -= nx*ov*(mb/tot); pa.y -= ny*ov*(mb/tot); pa.z -= nz*ov*(mb/tot); }
            if (!b.fixed) { pb.x += nx*ov*(ma/tot); pb.y += ny*ov*(ma/tot); pb.z += nz*ov*(ma/tot); }

            const rvn = (a.vx-b.vx)*nx + (a.vy-b.vy)*ny + (a.vz-b.vz)*nz;
            if (rvn >= 0) continue;
            const e  = Math.min(a.restitution, b.restitution);
            const J  = -(1+e)*rvn / (1/ma + 1/mb);
            if (!a.fixed) { a.vx += J/ma*nx; a.vy += J/ma*ny; a.vz += J/ma*nz; }
            if (!b.fixed) { b.vx -= J/mb*nx; b.vy -= J/mb*ny; b.vz -= J/mb*nz; }
        }
    }
}

/* ══════════════════════════════════════════════════════
   SCENE SETUP
══════════════════════════════════════════════════════ */
function _setupScene(container) {
    const T = window.THREE;

    // Renderer
    _renderer = uiCreateWebGLRenderer(container, { antialias: true, alpha: false });
    if (!_renderer) return false;
    _renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    _renderer.shadowMap.enabled = true;
    _renderer.shadowMap.type = T.PCFSoftShadowMap;
    _renderer.setSize(container.clientWidth || 800, container.clientHeight || 600);
    _renderer.domElement.style.display = 'block';
    _renderer.domElement.style.webkitAppRegion = 'no-drag';
    container.appendChild(_renderer.domElement);

    // Scene
    _scene = new T.Scene();
    _scene.background = new T.Color(0x080d18);
    _scene.fog = new T.FogExp2(0x080d18, 0.025);

    // Camera
    _camera = new T.PerspectiveCamera(50, (container.clientWidth||800)/(container.clientHeight||600), 0.1, 200);
    _camera.position.set(10, 9, 14);
    _camera.lookAt(0, 2, 0);

    // Lights
    _scene.add(new T.AmbientLight(0x334466, 0.9));
    const sun = new T.DirectionalLight(0xfff0e0, 1.0);
    sun.position.set(8, 14, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.width  = 2048;
    sun.shadow.mapSize.height = 2048;
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far  = 60;
    sun.shadow.camera.left = sun.shadow.camera.bottom = -ROOM_HALF;
    sun.shadow.camera.right = sun.shadow.camera.top   =  ROOM_HALF;
    _scene.add(sun);
    const fill = new T.DirectionalLight(0x4060ff, 0.3);
    fill.position.set(-6, 4, -8);
    _scene.add(fill);

    // Floor
    const floorGeo = new T.PlaneGeometry(ROOM_HALF*2, ROOM_HALF*2);
    const floorMat = new T.MeshPhongMaterial({ color: 0x111824, shininess: 12 });
    const floor = new T.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI/2;
    floor.receiveShadow = true;
    floor.userData.isFloor = true;
    _scene.add(floor);

    // Grid
    const grid = new T.GridHelper(ROOM_HALF*2, 20, 0x1a2540, 0x111e30);
    grid.position.y = 0.001;
    _scene.add(grid);

    // Orbit controls
    if (T.OrbitControls) {
        _orbit = new T.OrbitControls(_camera, _renderer.domElement);
        _orbit.enableDamping   = true;
        _orbit.dampingFactor   = 0.07;
        _orbit.minDistance     = 2;
        _orbit.maxDistance     = 50;
        _orbit.maxPolarAngle   = Math.PI * 0.49;
        _orbit.target.set(0, 2, 0);
    }

    // Resize observer
    if (container._p3dRO) container._p3dRO.disconnect();
    container._p3dRO = new ResizeObserver(() => {
        if (!_renderer || !container.clientWidth) return;
        _renderer.setSize(container.clientWidth, container.clientHeight);
        _camera.aspect = container.clientWidth / container.clientHeight;
        _camera.updateProjectionMatrix();
    });
    container._p3dRO.observe(container);
}

/* ══════════════════════════════════════════════════════
   RAYCASTING
══════════════════════════════════════════════════════ */
function _rayFloor(event, container) {
    const T = window.THREE;
    const rect = container.getBoundingClientRect();
    const ndc  = new T.Vector2(
        ((event.clientX - rect.left) / rect.width)  * 2 - 1,
       -((event.clientY - rect.top)  / rect.height) * 2 + 1
    );
    const rc = new T.Raycaster();
    rc.setFromCamera(ndc, _camera);
    const plane = new T.Plane(new T.Vector3(0,1,0), 0);
    const pt = new T.Vector3();
    if (!rc.ray.intersectPlane(plane, pt)) return null;
    pt.x = Math.max(-ROOM_HALF+1, Math.min(ROOM_HALF-1, pt.x));
    pt.z = Math.max(-ROOM_HALF+1, Math.min(ROOM_HALF-1, pt.z));
    pt.y = 3.5 + Math.random() * 3;
    return pt;
}

function _rayObjects(event, container) {
    const T = window.THREE;
    const rect = container.getBoundingClientRect();
    const ndc  = new T.Vector2(
        ((event.clientX - rect.left) / rect.width)  * 2 - 1,
       -((event.clientY - rect.top)  / rect.height) * 2 + 1
    );
    const rc = new T.Raycaster();
    rc.setFromCamera(ndc, _camera);
    const hits = rc.intersectObjects(_objects.map(o => o.mesh), false);
    if (!hits.length) return null;
    return _objects.find(o => o.mesh === hits[0].object) || null;
}

/* ══════════════════════════════════════════════════════
   RENDER LOOP
══════════════════════════════════════════════════════ */
function _loop(ts) {
    _rafId = requestAnimationFrame(_loop);
    const dt = Math.min((ts - _lastTs) / 1000, 0.05);
    _lastTs = ts;
    // View hidden (user switched apps) → skip physics + WebGL work entirely
    if (!_renderer || _renderer.domElement.offsetParent === null) return;
    if (!_paused && dt > 0) {
        const sub = 3; // sub-steps for stability
        for (let s = 0; s < sub; s++) _step((dt * _speed) / sub);
    }
    if (_orbit) _orbit.update();
    _renderer.render(_scene, _camera);

    // Refresh velocity readout if something is selected
    if (_sel) {
        const o = _objects.find(ob => ob.id === _sel);
        if (o) _updateVelReadout(o);
    }
}

function _updateVelReadout(o) {
    const el = document.getElementById('p3d-vel-readout');
    if (!el) return;
    const sp = Math.sqrt(o.vx**2 + o.vy**2 + o.vz**2);
    el.innerHTML =
        `<div class="flex justify-between"><span>Speed</span><span class="text-cyan-400">${sp.toFixed(2)} m/s</span></div>` +
        `<div class="flex justify-between"><span>vX</span><span>${o.vx.toFixed(2)}</span></div>` +
        `<div class="flex justify-between"><span>vY</span><span>${o.vy.toFixed(2)}</span></div>` +
        `<div class="flex justify-between"><span>vZ</span><span>${o.vz.toFixed(2)}</span></div>`;
}

/* ══════════════════════════════════════════════════════
   PROPERTIES PANEL
══════════════════════════════════════════════════════ */
function _renderProps() {
    const el = document.getElementById('phys3d-props-inner');
    if (!el) return;
    el.innerHTML = '';

    // Tool palette
    const palette = document.createElement('div');
    palette.className = 'p-2 flex flex-wrap gap-1';
    SHAPES.forEach(def => {
        const btn = document.createElement('button');
        const active = _tool === def.id;
        btn.className = 'flex flex-col items-center gap-0.5 px-1.5 py-1.5 rounded-lg text-[9px] font-semibold transition-all';
        btn.style.cssText = active
            ? `background:${def.css}25;color:${def.css};border:1px solid ${def.css}55;min-width:48px`
            : 'background:transparent;color:rgb(var(--slate-600));border:1px solid rgb(var(--slate-800));min-width:48px';
        btn.innerHTML = `<i class="fas ${def.icon} text-[10px]"></i>${def.label}`;
        btn.addEventListener('click', () => { _tool = def.id; _renderProps(); });
        palette.appendChild(btn);
    });
    el.appendChild(palette);

    const hr = document.createElement('div');
    hr.className = 'border-t border-slate-800/80 mx-2';
    el.appendChild(hr);

    const obj = _sel ? _objects.find(o => o.id === _sel) : null;
    if (!obj) {
        const hint = document.createElement('div');
        hint.className = 'text-slate-600 text-[10px] p-4 text-center leading-relaxed';
        hint.innerHTML =
            '<i class="fas fa-cube text-2xl mb-2 block text-slate-800"></i>' +
            'Click canvas to place<br>Use <b class="text-slate-500">Select</b> tool to pick<br>Right-click to delete';
        el.appendChild(hint);
        return;
    }

    const def = SHAPES.find(d => d.id === obj.type) || SHAPES[0];
    const wrap = document.createElement('div');
    wrap.className = 'p-3 flex flex-col gap-3';

    // Header
    wrap.innerHTML = `
        <div class="flex items-center gap-2">
            <div class="w-2.5 h-2.5 rounded-full shrink-0" style="background:${def.css}"></div>
            <span class="text-white text-xs font-semibold capitalize">${obj.type}</span>
            <span class="text-slate-700 text-[9px] ml-auto">#${obj.id.replace('p3d','')}</span>
        </div>`;

    const addSlider = (label, key, min, max, step, unit='') => {
        const row = document.createElement('div');
        const labelId = 'p3d-lbl-' + key;
        row.innerHTML = `
            <div class="flex justify-between mb-1">
                <span class="text-slate-400 text-[10px]">${label}</span>
                <span id="${labelId}" class="text-cyan-400 text-[10px] font-mono">${parseFloat(obj[key]).toFixed(2)}${unit}</span>
            </div>
            <input type="range" min="${min}" max="${max}" step="${step}" value="${obj[key]}"
                class="w-full h-1 rounded appearance-none cursor-pointer" style="accent-color:rgb(var(--tw-cyan-500))">`;
        const sl  = row.querySelector('input');
        const lbl = row.querySelector(`#${labelId}`);
        sl.addEventListener('input', () => {
            obj[key] = parseFloat(sl.value);
            lbl.textContent = obj[key].toFixed(2) + unit;
        });
        wrap.appendChild(row);
    };

    addSlider('Mass',    'mass',        0.1, 100,  0.1, ' kg');
    addSlider('Bounce',  'restitution', 0,   1,    0.01);

    // Velocity readout (live-updated by loop)
    const velWrap = document.createElement('div');
    velWrap.innerHTML = `
        <div class="text-slate-500 text-[9px] uppercase tracking-wide mb-1">Velocity</div>
        <div id="p3d-vel-readout" class="bg-slate-900/60 rounded-lg p-2 font-mono text-[9px] text-slate-400 flex flex-col gap-0.5"></div>`;
    wrap.appendChild(velWrap);

    // Fix toggle
    const fixBtn = document.createElement('button');
    fixBtn.className = 'text-[10px] py-1.5 px-2 rounded-lg border flex items-center gap-1.5 w-full';
    const updateFixBtn = () => {
        fixBtn.style.cssText = obj.fixed
            ? 'background:#1e40af22;color:rgb(var(--tw-blue-400));border-color:#1e40af55'
            : 'background:rgb(var(--slate-800));color:rgb(var(--slate-400));border-color:rgb(var(--slate-700))';
        fixBtn.innerHTML = `<i class="fas ${obj.fixed ? 'fa-lock' : 'fa-lock-open'} text-[9px]"></i> ${obj.fixed ? 'Fixed — click to release' : 'Free — click to fix'}`;
    };
    updateFixBtn();
    fixBtn.addEventListener('click', () => {
        obj.fixed = !obj.fixed;
        if (obj.fixed) { obj.vx = obj.vy = obj.vz = 0; }
        updateFixBtn();
    });
    wrap.appendChild(fixBtn);

    // Give a kick
    const kickBtn = document.createElement('button');
    kickBtn.className = 'text-[10px] py-1.5 px-2 rounded-lg bg-amber-900/20 text-amber-400 border border-amber-900/40 hover:bg-amber-900/40 flex items-center gap-1.5 w-full';
    kickBtn.innerHTML = '<i class="fas fa-bolt text-[9px]"></i> Give a Kick';
    kickBtn.addEventListener('click', () => {
        obj.fixed = false;
        obj.vx = (Math.random()-0.5) * 10;
        obj.vy = 4 + Math.random() * 4;
        obj.vz = (Math.random()-0.5) * 10;
    });
    wrap.appendChild(kickBtn);

    // Delete
    const delBtn = document.createElement('button');
    delBtn.className = 'text-[10px] py-1.5 px-2 rounded-lg bg-red-900/20 text-red-400 border border-red-900/40 hover:bg-red-900/40 flex items-center gap-1.5 w-full';
    delBtn.innerHTML = '<i class="fas fa-trash text-[9px]"></i> Delete';
    delBtn.addEventListener('click', () => _removeObject(obj.id));
    wrap.appendChild(delBtn);

    el.appendChild(wrap);
}

/* ══════════════════════════════════════════════════════
   WIRING
══════════════════════════════════════════════════════ */
function _wire() {
    const container = document.getElementById('phys3d-wrap');
    if (!container || !_renderer) return;

    // Detect orbit movement to distinguish click from drag
    _renderer.domElement.addEventListener('pointerdown', () => { _orbitWasMoved = false; });
    _renderer.domElement.addEventListener('pointermove', () => { _orbitWasMoved = true; });
    _renderer.domElement.addEventListener('click', e => {
        if (_orbitWasMoved) return; // was an orbit drag, not a click

        if (_tool === 'select') {
            const obj = _rayObjects(e, container);
            _sel = obj ? obj.id : null;
            _renderProps();
        } else if (_tool === 'erase') {
            const obj = _rayObjects(e, container);
            if (obj) _removeObject(obj.id);
        } else {
            const pos = _rayFloor(e, container);
            if (pos) {
                const obj = _addObject(_tool, pos);
                _sel = obj.id;
                _renderProps();
            }
        }
    });

    _renderer.domElement.addEventListener('contextmenu', e => {
        e.preventDefault();
        const obj = _rayObjects(e, container);
        if (obj) _removeObject(obj.id);
    });

    // Speed slider (shared with 2D)
    const sp = document.getElementById('phys-speed-slider');
    if (sp) {
        _speed = parseFloat(sp.value) || 1;
        sp.addEventListener('input', () => { _speed = parseFloat(sp.value); });
    }

    // Clear button (3D specific)
    const clearBtn = document.getElementById('phys3d-clear-btn');
    if (clearBtn) {
        clearBtn.onclick = () => {
            [..._objects].forEach(o => _removeObject(o.id));
            _renderProps();
        };
    }
}

/* ══════════════════════════════════════════════════════
   PUBLIC API
══════════════════════════════════════════════════════ */
window.initPhysics3D = function () {
    if (!window.THREE) { console.warn('physics3d: THREE not available'); return; }
    const container = document.getElementById('phys3d-wrap');
    if (!container) return;

    if (!_initialized) {
        if (_setupScene(container) === false) return;   // WebGL unavailable — panel shown
        _wire();
        _initialized = true;
        _renderProps();
    }

    _paused = false;
    cancelAnimationFrame(_rafId);
    _rafId = requestAnimationFrame(ts => { _lastTs = ts; _loop(ts); });
    _renderProps();
};

window.stopPhysics3D = function () {
    cancelAnimationFrame(_rafId);
    _rafId = null;
};

window.pausePhysics3D = function (p) { _paused = p; };

})();
