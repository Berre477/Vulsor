// ── Chess 3D — real WebGL board with Staunton-style pieces (Three.js) ──
// Depends on global THREE (loaded via CDN in index.html) and on chess.js
// (chessState, chessLegalMoves, chessClickSquare, _ij, _ri, _isWhite).

const C3D = {
    inited: false,
    enabled: false,
    scene: null,
    camera: null,
    renderer: null,
    boardGroup: null,
    squares: {},        // idx -> mesh
    pieceMeshes: {},    // idx -> mesh of piece currently on that square
    pieceFactory: null, // function(type, isWhite) -> mesh
    raycaster: null,
    pointer: new (typeof THREE !== 'undefined' ? THREE.Vector2 : function(){})(0, 0),
    orbit: null,
    animating: false,
    highlightMeshes: [], // legal-move dots
    lastFromIdx: null,
    lastToIdx:   null,
    container:   null,
    rafId: null,
};

// ──────────────────────────────────────────────────────────────────────
// Geometry: lathe profiles for Staunton-style pieces.
// Each profile is an array of [radius, y]. The lathe spins these around Y.
// Units: 1 square = 1.0. Pieces sit centered on a square at y=0 (square top).
// ──────────────────────────────────────────────────────────────────────
// Staunton-style profiles. Each profile traces the side silhouette from
// base to top. Profiles include three-stage bases: outer flare, decorative
// rim, then a narrower collar before the shaft begins.
const P_PAWN = [
    [0.00, 0.000], [0.42, 0.000], [0.44, 0.020], [0.45, 0.050],
    [0.44, 0.080], [0.40, 0.110], [0.36, 0.135], [0.36, 0.165],
    [0.38, 0.190], [0.32, 0.220], [0.24, 0.250], [0.20, 0.280],
    [0.18, 0.330], [0.17, 0.420], [0.16, 0.520], [0.16, 0.620],
    [0.18, 0.680], [0.22, 0.720], [0.27, 0.755], [0.30, 0.795],
    [0.31, 0.845], [0.30, 0.900], [0.27, 0.945], [0.21, 0.985],
    [0.13, 1.015], [0.06, 1.035], [0.02, 1.045], [0.00, 1.050],
];
const P_ROOK = [
    [0.00, 0.000], [0.48, 0.000], [0.50, 0.020], [0.51, 0.055],
    [0.50, 0.090], [0.46, 0.120], [0.42, 0.145], [0.42, 0.180],
    [0.44, 0.210], [0.38, 0.240], [0.32, 0.275], [0.30, 0.320],
    [0.29, 0.380], [0.29, 0.480], [0.29, 0.620], [0.29, 0.780],
    [0.30, 0.860], [0.34, 0.905], [0.40, 0.945], [0.45, 0.985],
    [0.48, 1.025], [0.50, 1.075], [0.49, 1.115], [0.00, 1.115],
];
const P_BISHOP = [
    [0.00, 0.000], [0.46, 0.000], [0.48, 0.020], [0.49, 0.055],
    [0.48, 0.090], [0.43, 0.120], [0.38, 0.150], [0.38, 0.180],
    [0.40, 0.210], [0.34, 0.240], [0.27, 0.275], [0.24, 0.310],
    [0.26, 0.345], [0.30, 0.380], [0.26, 0.420], [0.21, 0.475],
    [0.18, 0.550], [0.18, 0.700], [0.19, 0.870], [0.22, 1.010],
    [0.26, 1.110], [0.30, 1.180], [0.30, 1.235], [0.27, 1.290],
    [0.22, 1.360], [0.16, 1.450], [0.10, 1.540], [0.05, 1.620],
    [0.02, 1.680], [0.00, 1.710],
];
const P_QUEEN = [
    [0.00, 0.000], [0.52, 0.000], [0.54, 0.020], [0.55, 0.055],
    [0.54, 0.090], [0.50, 0.120], [0.44, 0.150], [0.44, 0.180],
    [0.46, 0.215], [0.40, 0.245], [0.32, 0.285], [0.28, 0.325],
    [0.30, 0.365], [0.34, 0.405], [0.30, 0.445], [0.25, 0.500],
    [0.22, 0.585], [0.21, 0.700], [0.21, 0.870], [0.22, 1.030],
    [0.25, 1.150], [0.30, 1.250], [0.36, 1.330], [0.41, 1.395],
    [0.43, 1.450], [0.41, 1.495], [0.36, 1.540], [0.30, 1.585],
    [0.25, 1.620], [0.21, 1.650], [0.19, 1.680], [0.18, 1.710],
    [0.16, 1.735], [0.13, 1.755], [0.09, 1.775], [0.04, 1.790],
    [0.00, 1.800],
];
const P_KING = [
    [0.00, 0.000], [0.54, 0.000], [0.56, 0.020], [0.57, 0.055],
    [0.56, 0.090], [0.52, 0.120], [0.46, 0.150], [0.46, 0.180],
    [0.48, 0.215], [0.42, 0.245], [0.34, 0.285], [0.30, 0.330],
    [0.32, 0.370], [0.36, 0.410], [0.32, 0.455], [0.26, 0.520],
    [0.23, 0.620], [0.22, 0.760], [0.22, 0.940], [0.24, 1.120],
    [0.27, 1.250], [0.32, 1.350], [0.38, 1.430], [0.43, 1.500],
    [0.45, 1.560], [0.43, 1.610], [0.38, 1.660], [0.32, 1.710],
    [0.26, 1.755], [0.21, 1.795], [0.18, 1.830], [0.16, 1.870],
    [0.15, 1.910], [0.16, 1.940], [0.13, 1.965], [0.08, 1.985],
    [0.03, 1.998], [0.00, 2.005],
];
// Knight base — solid Staunton column up to the neck where the head is grafted on.
const P_KNIGHT_BASE = [
    [0.00, 0.000], [0.50, 0.000], [0.52, 0.020], [0.53, 0.055],
    [0.52, 0.090], [0.48, 0.120], [0.42, 0.150], [0.42, 0.180],
    [0.44, 0.215], [0.38, 0.245], [0.32, 0.285], [0.28, 0.325],
    [0.27, 0.370], [0.27, 0.430], [0.27, 0.500], [0.27, 0.560],
    [0.27, 0.600], [0.00, 0.600],
];

function _vec2List(profile) {
    return profile.map(([x, y]) => new THREE.Vector2(x, y));
}

function _buildLathePiece(profile, material) {
    const geo = new THREE.LatheGeometry(_vec2List(profile), 64);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, material);
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    return mesh;
}

function _buildKnight(material) {
    const group = new THREE.Group();
    // Base (lathed)
    const baseGeo = new THREE.LatheGeometry(_vec2List(P_KNIGHT_BASE), 64);
    baseGeo.computeVertexNormals();
    const base = new THREE.Mesh(baseGeo, material);
    base.castShadow = true;
    group.add(base);

    // Head silhouette — a carefully traced horse-head profile, extruded along Z.
    // The horse faces +X (right). Black knights get rotated 180° elsewhere.
    const head = new THREE.Shape();
    head.moveTo(-0.22, 0.60);
    // Back of the neck rising
    head.bezierCurveTo(-0.34, 0.75, -0.34, 1.00, -0.20, 1.10);
    // Top of the mane
    head.bezierCurveTo(-0.10, 1.20, -0.05, 1.30, 0.05, 1.35);
    // Crest of head
    head.bezierCurveTo( 0.18, 1.42, 0.30, 1.40, 0.35, 1.32);
    // Forehead drop into snout
    head.bezierCurveTo( 0.40, 1.22, 0.46, 1.15, 0.50, 1.05);
    // Snout tip
    head.bezierCurveTo( 0.54, 0.95, 0.52, 0.86, 0.46, 0.80);
    // Bottom of muzzle
    head.bezierCurveTo( 0.38, 0.78, 0.28, 0.82, 0.20, 0.80);
    // Throat curving back to neck base
    head.bezierCurveTo( 0.08, 0.78, -0.02, 0.72, -0.10, 0.65);
    head.bezierCurveTo(-0.16, 0.62, -0.20, 0.60, -0.22, 0.60);

    const ext = new THREE.ExtrudeGeometry(head, {
        depth: 0.34, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05,
        bevelSegments: 4, curveSegments: 24,
    });
    ext.translate(0, 0, -0.17);
    ext.computeVertexNormals();
    const headMesh = new THREE.Mesh(ext, material);
    headMesh.castShadow = true;
    group.add(headMesh);

    // Tiny ears — two slim cones
    const earGeo = new THREE.ConeGeometry(0.04, 0.10, 8);
    const earL = new THREE.Mesh(earGeo, material);
    earL.position.set(0.06, 1.44, 0.10); earL.rotation.x = -0.2; earL.castShadow = true;
    const earR = earL.clone(); earR.position.z = -0.10;
    group.add(earL); group.add(earR);

    // Eye indents (small darker spheres for character)
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x0a0604, roughness: 0.6 });
    const eyeGeo = new THREE.SphereGeometry(0.025, 10, 8);
    const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
    eyeL.position.set(0.28, 1.20, 0.13);
    const eyeR = new THREE.Mesh(eyeGeo, eyeMat);
    eyeR.position.set(0.28, 1.20, -0.13);
    group.add(eyeL); group.add(eyeR);

    return group;
}

// King gets a cross on top
function _addKingCross(group, material) {
    const vBar = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.30, 0.08), material);
    vBar.position.y = 2.15;
    vBar.castShadow = true;
    const hBar = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.08, 0.08), material);
    hBar.position.y = 2.12;
    hBar.castShadow = true;
    // Cross base bead
    const beadGeo = new THREE.SphereGeometry(0.06, 16, 12);
    const bead = new THREE.Mesh(beadGeo, material);
    bead.position.y = 2.005;
    bead.castShadow = true;
    group.add(bead);
    group.add(vBar);
    group.add(hBar);
}

// Queen gets a serrated crown: 8 teardrop beads in a circle + small finial
function _addQueenCrown(group, material) {
    const beadGeo = new THREE.SphereGeometry(0.05, 16, 12);
    for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const b = new THREE.Mesh(beadGeo, material);
        b.position.set(Math.cos(a) * 0.15, 1.82, Math.sin(a) * 0.15);
        b.castShadow = true;
        group.add(b);
    }
    const finial = new THREE.Mesh(new THREE.SphereGeometry(0.07, 18, 14), material);
    finial.position.y = 1.85;
    finial.castShadow = true;
    group.add(finial);
}

// Rook crenellations — 4 chunky merlons around the rim
function _addRookCrenels(group, material) {
    for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        const c = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.16, 0.18), material);
        c.position.set(Math.cos(a) * 0.34, 1.190, Math.sin(a) * 0.34);
        c.castShadow = true;
        group.add(c);
    }
}

// ──────────────────────────────────────────────────────────────────────
// Materials
// ──────────────────────────────────────────────────────────────────────
function _buildWoodTexture(c1, c2) {
    // Procedural canvas wood texture: vertical grain with noise
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 256;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 256, 0);
    grad.addColorStop(0, c1);
    grad.addColorStop(0.5, c2);
    grad.addColorStop(1, c1);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 256);
    // Add streaks
    for (let i = 0; i < 220; i++) {
        const x = Math.random() * 256;
        ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.10})`;
        ctx.fillRect(x, 0, 1 + Math.random() * 2, 256);
    }
    // Soft noise
    const img = ctx.getImageData(0, 0, 256, 256);
    for (let i = 0; i < img.data.length; i += 4) {
        const n = (Math.random() - 0.5) * 14;
        img.data[i]   = Math.max(0, Math.min(255, img.data[i]   + n));
        img.data[i+1] = Math.max(0, Math.min(255, img.data[i+1] + n));
        img.data[i+2] = Math.max(0, Math.min(255, img.data[i+2] + n));
    }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
}

// ── Customization presets ─────────────────────────────────────────
const BOARD_PRESETS = {
    walnut:   { light:['#e0c089','#cfa86a'], dark:['#7a4a26','#5c351a'], frame:['#4d2a15','#3a1f0e'] },
    mahogany: { light:['#d8a777','#c08856'], dark:['#5a2a1c','#3e1a10'], frame:['#3d1810','#28100a'] },
    oak:      { light:['#f0d9a8','#e0c486'], dark:['#a17549','#85572f'], frame:['#5c3a1f','#43280e'] },
    marble:   { light:['#f4f4f4','#dcdcdc'], dark:['#2a2a2a','#101010'], frame:['#1a1a1a','#080808'] },
    ebony:    { light:['#6e5238','#54402a'], dark:['#1b110a','#0a0604'], frame:['#0a0604','#000000'] },
    onyx:     { light:['#2a2a2a','#1a1a1a'], dark:['#0a0a0a','#000000'], frame:['#000000','#000000'] },
};
// MeshPhysicalMaterial gives clearcoat (lacquer) — turns plain wood into polished tournament pieces.
const _M = THREE.MeshPhysicalMaterial ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial;

// Procedural wood-grain canvas texture for piece bodies. Tighter grain than the
// board so pieces show fine concentric rings, like real turned wood.
function _buildPieceWoodTexture(c1, c2) {
    const canvas = document.createElement('canvas');
    canvas.width = 128; canvas.height = 256;
    const ctx = canvas.getContext('2d');
    // Base gradient (vertical for piece bodies)
    const grad = ctx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, c1);
    grad.addColorStop(0.5, c2);
    grad.addColorStop(1, c1);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 256);
    // Subtle horizontal rings to suggest lathe lines
    for (let y = 0; y < 256; y += 1.5 + Math.random() * 2) {
        ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.05})`;
        ctx.fillRect(0, y, 128, 0.6);
    }
    // Fine grain streaks
    for (let i = 0; i < 70; i++) {
        const x = Math.random() * 128;
        ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.07})`;
        ctx.fillRect(x, 0, 0.6, 256);
    }
    // Noise pass
    const img = ctx.getImageData(0, 0, 128, 256);
    for (let i = 0; i < img.data.length; i += 4) {
        const n = (Math.random() - 0.5) * 8;
        img.data[i]   = Math.max(0, Math.min(255, img.data[i]   + n));
        img.data[i+1] = Math.max(0, Math.min(255, img.data[i+1] + n));
        img.data[i+2] = Math.max(0, Math.min(255, img.data[i+2] + n));
    }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1, 1);
    return tex;
}
const PIECE_PRESETS = {
    classic: { white:{color:0xf2eada,roughness:0.32,metalness:0.05,clearcoat:0.6,clearcoatRoughness:0.18},
               black:{color:0x2d1b10,roughness:0.30,metalness:0.05,clearcoat:0.7,clearcoatRoughness:0.15} },
    ebony:   { white:{color:0xf8f1de,roughness:0.22,metalness:0.0,clearcoat:0.85,clearcoatRoughness:0.10},
               black:{color:0x0a0604,roughness:0.20,metalness:0.0,clearcoat:0.9,clearcoatRoughness:0.08} },
    marble:  { white:{color:0xfafafa,roughness:0.12,metalness:0.05,clearcoat:0.95,clearcoatRoughness:0.06},
               black:{color:0x141414,roughness:0.10,metalness:0.05,clearcoat:0.95,clearcoatRoughness:0.06} },
    gold:    { white:{color:0xffd86b,roughness:0.20,metalness:0.95},
               black:{color:0xb5b5b5,roughness:0.22,metalness:0.95} },
    glass:   { white:{color:0xdef3ff,roughness:0.05,metalness:0.0,transparent:true,opacity:0.55,clearcoat:1.0,clearcoatRoughness:0.02,transmission:0.8},
               black:{color:0x1a1a2a,roughness:0.06,metalness:0.0,transparent:true,opacity:0.65,clearcoat:1.0,clearcoatRoughness:0.02,transmission:0.7} },
    jade:    { white:{color:0x9ed4ab,roughness:0.18,metalness:0.0,clearcoat:0.8,clearcoatRoughness:0.12},
               black:{color:0x1a1a1a,roughness:0.18,metalness:0.10,clearcoat:0.8,clearcoatRoughness:0.10} },
};

let C3D_PIECESET = 'classic';
let C3D_BOARDMAT = 'walnut';
let C3D_LIGHTING = 'studio';

// Cached GLB piece prototypes (per type). When loaded successfully, these
// override the procedural lathe pieces. `null` = use procedural.
let C3D_GLB_TEMPLATES = null;   // { p,r,n,b,q,k } each = THREE.Object3D (cloneable)
let C3D_GLB_URL = '';

let _MAT_CACHE = null;
function _buildMaterials() {
    const board = BOARD_PRESETS[C3D_BOARDMAT] || BOARD_PRESETS.walnut;
    const pieces = PIECE_PRESETS[C3D_PIECESET] || PIECE_PRESETS.classic;

    const lightWood = _buildWoodTexture(board.light[0], board.light[1]);
    const darkWood  = _buildWoodTexture(board.dark[0],  board.dark[1]);
    const frameWood = _buildWoodTexture(board.frame[0], board.frame[1]);

    // Wood-grain textures for piece bodies (only for wood-family piece sets;
    // marble / gold / glass / jade get flat colored materials).
    const useWoodTex = (C3D_PIECESET === 'classic' || C3D_PIECESET === 'ebony');
    const whiteOpts = Object.assign({}, pieces.white);
    const blackOpts = Object.assign({}, pieces.black);
    if (useWoodTex) {
        whiteOpts.map = _buildPieceWoodTexture('#ece1c4', '#d4c391');
        blackOpts.map = _buildPieceWoodTexture('#3a2418', '#1c0f08');
    }

    _MAT_CACHE = {
        lightSq: new THREE.MeshStandardMaterial({ map: lightWood, roughness: 0.55, metalness: 0.05 }),
        darkSq:  new THREE.MeshStandardMaterial({ map: darkWood,  roughness: 0.55, metalness: 0.05 }),
        frame:   new THREE.MeshStandardMaterial({ map: frameWood, roughness: 0.45, metalness: 0.05 }),
        white:   new _M(whiteOpts),
        black:   new _M(blackOpts),
        legalDot: new THREE.MeshStandardMaterial({ color: 0x000000, transparent: true, opacity: 0.45 }),
        captureRing: new THREE.MeshStandardMaterial({ color: 0xef4444, transparent: true, opacity: 0.55 }),
        lastMove: new THREE.MeshBasicMaterial({ color: 0xfde047, transparent: true, opacity: 0.35 }),
        selected: new THREE.MeshBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.40 }),
        check:    new THREE.MeshBasicMaterial({ color: 0xef4444, transparent: true, opacity: 0.55 }),
    };
    return _MAT_CACHE;
}

// ── Lighting presets ──────────────────────────────────────────────
const LIGHTING_PRESETS = {
    studio:    { ambient:[0xffffff,0.45], key:[0xffffff,0.85,[6,12,4]],  fill:[0xfff0d8,0.25,[-6,8,-4]], rim:[0xa0c8ff,0.15,[0,4,-8]], bg:0x111827 },
    warm:      { ambient:[0xffe5b8,0.40], key:[0xffd8a8,1.00,[6,12,4]],  fill:[0xffc880,0.30,[-6,8,-4]], rim:[0xff8060,0.10,[0,4,-8]], bg:0x2a1810 },
    cool:      { ambient:[0xa0c8ff,0.35], key:[0xc8d8ff,0.80,[6,12,4]],  fill:[0x80a0ff,0.25,[-6,8,-4]], rim:[0xffffff,0.20,[0,4,-8]], bg:0x0a1428 },
    dramatic:  { ambient:[0xffffff,0.10], key:[0xffffff,1.40,[3,15,3]],  fill:[0x303050,0.05,[-6,8,-4]], rim:[0xff8030,0.10,[0,4,-8]], bg:0x000000 },
    bright:    { ambient:[0xffffff,0.70], key:[0xffffff,1.10,[6,15,6]],  fill:[0xffffff,0.50,[-6,10,-4]], rim:[0xffffff,0.25,[0,6,-8]], bg:0xe5e7eb },
};

function _applyLighting(name) {
    const p = LIGHTING_PRESETS[name] || LIGHTING_PRESETS.studio;
    const group = C3D.lights.group;
    // Clear old lights
    while (group.children.length) group.remove(group.children[0]);

    const amb = new THREE.AmbientLight(p.ambient[0], p.ambient[1]);
    group.add(amb);

    const key = new THREE.DirectionalLight(p.key[0], p.key[1]);
    key.position.set(...p.key[2]);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 1; key.shadow.camera.far = 40;
    key.shadow.camera.left = -8; key.shadow.camera.right = 8;
    key.shadow.camera.top = 8; key.shadow.camera.bottom = -8;
    key.shadow.bias = -0.0008;
    group.add(key);

    const fill = new THREE.DirectionalLight(p.fill[0], p.fill[1]);
    fill.position.set(...p.fill[2]);
    group.add(fill);

    const rim = new THREE.DirectionalLight(p.rim[0], p.rim[1]);
    rim.position.set(...p.rim[2]);
    group.add(rim);

    if (C3D.scene) {
        C3D.scene.background = new THREE.Color(p.bg);
        C3D.scene.fog = new THREE.Fog(p.bg, 20, 50);
    }
}

// ──────────────────────────────────────────────────────────────────────
// Scene setup
// ──────────────────────────────────────────────────────────────────────
function chess3DInit() {
    if (C3D.inited) return;
    if (typeof THREE === 'undefined') { console.warn('THREE not loaded'); return; }

    const container = document.getElementById('chess-3d-container');
    if (!container) return;
    C3D.container = container;

    const scene = new THREE.Scene();
    C3D.scene = scene;
    scene.background = new THREE.Color(0x111827);
    scene.fog = new THREE.Fog(0x111827, 20, 50);

    const camera = new THREE.PerspectiveCamera(45,
        Math.max(1, container.clientWidth) / Math.max(1, container.clientHeight), 0.1, 100);

    const renderer = uiCreateWebGLRenderer(container, { antialias: true, alpha: true });
    if (!renderer) return;
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputEncoding = THREE.sRGBEncoding;
    container.appendChild(renderer.domElement);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.cursor = 'grab';

    // ── Lights (rebuildable) ───────────────────────────────────────
    C3D.lights = { group: new THREE.Group() };
    scene.add(C3D.lights.group);
    _applyLighting(C3D_LIGHTING);

    // ── Board ───────────────────────────────────────────────────────
    const mats = _buildMaterials();
    const boardGroup = new THREE.Group();

    // Frame (outer raised border)
    const frame = new THREE.Mesh(new THREE.BoxGeometry(9.6, 0.4, 9.6), mats.frame);
    frame.position.y = -0.20;
    frame.receiveShadow = true;
    boardGroup.add(frame);
    // Inner inlay (slightly recessed darker line)
    const inlay = new THREE.Mesh(new THREE.BoxGeometry(8.6, 0.42, 8.6),
        new THREE.MeshStandardMaterial({ color: 0x1a0a05, roughness:0.6, metalness:0 }));
    inlay.position.y = -0.20;
    inlay.receiveShadow = true;
    boardGroup.add(inlay);

    // 64 squares
    const sqGeo = new THREE.BoxGeometry(1.0, 0.10, 1.0);
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            const idx = r * 8 + c;
            const isLight = (r + c) % 2 === 0;
            const sq = new THREE.Mesh(sqGeo, isLight ? mats.lightSq : mats.darkSq);
            // Board coordinates: white at south (camera side). idx 0 = a8 (back-left for white)
            // Use file (c) and rank (8-r); position so a1 is front-left of white.
            sq.position.set(c - 3.5, 0, r - 3.5);
            sq.receiveShadow = true;
            sq.userData.idx = idx;
            boardGroup.add(sq);
            C3D.squares[idx] = sq;
        }
    }
    scene.add(boardGroup);
    C3D.boardGroup = boardGroup;

    // Piece factory
    C3D.pieceFactory = function(type, isWhite) {
        // If a GLB chess set has been loaded, prefer that.
        if (C3D_GLB_TEMPLATES && C3D_GLB_TEMPLATES[type]) {
            const proto = C3D_GLB_TEMPLATES[type];
            const cloned = proto.clone(true);
            // Re-tint material to white/black piece color
            const mats = _MAT_CACHE || _buildMaterials();
            const tint = isWhite ? mats.white : mats.black;
            cloned.traverse(o => {
                if (o.isMesh) {
                    o.material = tint.clone();
                    o.castShadow = true;
                    o.receiveShadow = false;
                }
            });
            // Rotate black pieces 180° so knights/bishops face the right way
            if (!isWhite) cloned.rotation.y = Math.PI;
            cloned.userData.type = type;
            cloned.userData.isWhite = isWhite;
            return cloned;
        }
        const mat = (isWhite ? mats.white : mats.black).clone();
        let mesh;
        if (type === 'p') mesh = _buildLathePiece(P_PAWN,   mat);
        else if (type === 'r') {
            mesh = _buildLathePiece(P_ROOK, mat);
            const g = new THREE.Group(); g.add(mesh); _addRookCrenels(g, mat); mesh = g;
        }
        else if (type === 'b') {
            mesh = _buildLathePiece(P_BISHOP, mat);
            // Mitre slit
            const slit = new THREE.Mesh(
                new THREE.BoxGeometry(0.55, 0.06, 0.07),
                new THREE.MeshStandardMaterial({ color:0x0a0a0a, roughness:0.8 }));
            slit.position.y = 1.25;
            slit.rotation.z = Math.PI / 4;
            slit.castShadow = false;
            const g = new THREE.Group(); g.add(mesh); g.add(slit); mesh = g;
        }
        else if (type === 'n') mesh = _buildKnight(mat);
        else if (type === 'q') {
            mesh = _buildLathePiece(P_QUEEN, mat);
            const g = new THREE.Group(); g.add(mesh); _addQueenCrown(g, mat); mesh = g;
        }
        else if (type === 'k') {
            mesh = _buildLathePiece(P_KING, mat);
            const g = new THREE.Group(); g.add(mesh); _addKingCross(g, mat); mesh = g;
        }
        // Tag with type for picking
        mesh.userData.type = type;
        mesh.userData.isWhite = isWhite;
        // Orient knights to face left (so they look at each other)
        if (type === 'n') {
            mesh.rotation.y = isWhite ? -Math.PI / 2 : Math.PI / 2;
        }
        return mesh;
    };

    C3D.scene = scene;
    C3D.camera = camera;
    C3D.renderer = renderer;
    C3D.raycaster = new THREE.Raycaster();

    // Locked camera
    _attachCamera(camera, renderer.domElement);

    // Click to move
    renderer.domElement.addEventListener('pointerdown', _onPointerDown);
    renderer.domElement.addEventListener('pointerup', _onPointerUp);

    // Resize
    new ResizeObserver(() => chess3DResize()).observe(container);

    C3D.inited = true;
}

function chess3DResize() {
    if (!C3D.inited) return;
    const c = C3D.container;
    const w = Math.max(1, c.clientWidth);
    const h = Math.max(1, c.clientHeight);
    C3D.renderer.setSize(w, h);
    C3D.camera.aspect = w / h;
    C3D.camera.updateProjectionMatrix();
    // Reapply current preset so radius adapts to new aspect (keeps full board in frame)
    if (!_userOverride) _camUpdate();
}

// ──────────────────────────────────────────────────────────────────────
// Camera — preset angles + optional drag-to-orbit when unlocked.
// ──────────────────────────────────────────────────────────────────────
const CAMERA_PRESETS = {
    player:    { phi: 1.05, radius: 13.5 },  // close, low — like the reference photo
    classic:   { phi: 0.95, radius: 15.0 },  // standard table view
    bird:      { phi: 0.55, radius: 14.5 },  // looking down at a steep angle
    top:       { phi: 0.05, radius: 13.5 },  // nearly top-down for analysis
    side:      { phi: 1.40, radius: 15.5 },  // low side profile
    cinematic: { phi: 0.85, radius: 12.5 },  // dramatic close shot
};

let _camPreset = 'player';
let _camLocked = true;
let _camSide   = 'w';
let _camTheta  = Math.PI / 2;
let _camPhi    = 1.05;
let _camRadius = 13.5;
let _userOverride = false;  // user dragged → don't snap back unless preset changes

// Auto-fit: scale up the preset radius when the viewport is narrow/short so the
// full board + pieces always fit on screen, no matter the window size.
function _fitRadius(baseRadius) {
    const cam = C3D.camera;
    if (!cam) return baseRadius;
    // Board half-extent (8 squares + frame + tallest piece). King ≈ 2.4 tall.
    const halfBoard = 5.2;
    const fovV = (cam.fov || 45) * Math.PI / 180;
    const aspect = cam.aspect || 1;
    // Required distance so the board fits in both vertical and horizontal FOV.
    const distV = halfBoard / Math.tan(fovV / 2);
    const distH = halfBoard / (Math.tan(fovV / 2) * aspect);
    const required = Math.max(distV, distH) * 1.1; // 10% margin
    return Math.max(baseRadius, required);
}

function _camUpdate() {
    const cam = C3D.camera;
    if (!cam) return;
    const r = _userOverride ? _camRadius : _fitRadius(_camRadius);
    const x = r * Math.sin(_camPhi) * Math.cos(_camTheta);
    const y = r * Math.cos(_camPhi);
    const z = r * Math.sin(_camPhi) * Math.sin(_camTheta);
    cam.position.set(x, y, z);
    cam.lookAt(0, 0.35, 0);
}

function _camApplyPreset(name) {
    const p = CAMERA_PRESETS[name] || CAMERA_PRESETS.player;
    _camPreset = name;
    _camPhi = p.phi;
    _camRadius = p.radius;
    _camTheta = _camSide === 'b' ? -Math.PI / 2 : Math.PI / 2;
    _userOverride = false;
    _camUpdate();
}

function _attachCamera(camera, dom) {
    C3D.camera = camera;
    _camApplyPreset(_camPreset);

    C3D.orbit = {
        setForSide(side) {
            _camSide = side;
            // Only re-snap horizontal angle if user hasn't taken control
            if (!_userOverride || _camLocked) {
                _camTheta = side === 'b' ? -Math.PI / 2 : Math.PI / 2;
                _camUpdate();
            }
        },
    };

    // Drag-to-orbit only when camera is unlocked
    let dragging = false, lastX = 0, lastY = 0, downX = 0, downY = 0;
    dom.addEventListener('pointerdown', e => {
        if (e.button !== 0) return;
        downX = lastX = e.clientX; downY = lastY = e.clientY;
        if (!_camLocked) {
            dragging = true;
            dom.setPointerCapture(e.pointerId);
            dom.style.cursor = 'grabbing';
        }
    });
    dom.addEventListener('pointermove', e => {
        if (!dragging) return;
        const dx = e.clientX - lastX, dy = e.clientY - lastY;
        lastX = e.clientX; lastY = e.clientY;
        _camTheta -= dx * 0.006;
        _camPhi = Math.max(0.05, Math.min(Math.PI / 2 - 0.02, _camPhi - dy * 0.006));
        _userOverride = true;
        _camUpdate();
    });
    dom.addEventListener('pointerup', e => {
        if (dragging) {
            dragging = false;
            dom.style.cursor = _camLocked ? 'pointer' : 'grab';
        }
    });
    // Wheel zoom only when unlocked
    dom.addEventListener('wheel', e => {
        if (_camLocked) return;
        e.preventDefault();
        _camRadius = Math.max(5, Math.min(25, _camRadius + e.deltaY * 0.01));
        _userOverride = true;
        _camUpdate();
    }, { passive: false });

    dom.style.cursor = _camLocked ? 'pointer' : 'grab';
}

// Public setters
window.chess3DSetCameraPreset = function(name) {
    if (!C3D.inited) { _camPreset = name; return; }
    _camApplyPreset(name);
};
window.chess3DSetCameraLocked = function(locked) {
    _camLocked = !!locked;
    if (C3D.renderer && C3D.renderer.domElement) {
        C3D.renderer.domElement.style.cursor = _camLocked ? 'pointer' : 'grab';
    }
    // Locking simply disables drag/wheel — the camera stays exactly where the
    // user pointed it. (Use the preset dropdown to snap back to a named angle.)
};

// ──────────────────────────────────────────────────────────────────────
// Click → square index
// ──────────────────────────────────────────────────────────────────────
let _pointerDownAt = null;
function _onPointerDown(e) { _pointerDownAt = { x:e.clientX, y:e.clientY }; }
function _onPointerUp(e) {
    if (!_pointerDownAt) return;
    const moved = Math.hypot(e.clientX - _pointerDownAt.x, e.clientY - _pointerDownAt.y);
    _pointerDownAt = null;
    if (moved > 4) return; // small slop tolerance
    const idx = _pickSquare(e);
    if (idx != null && typeof chessClickSquare === 'function') chessClickSquare(idx);
}
function _pickSquare(e) {
    const rect = C3D.renderer.domElement.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    C3D.pointer.set(x, y);
    C3D.raycaster.setFromCamera(C3D.pointer, C3D.camera);
    // Intersect against squares + pieces
    const targets = Object.values(C3D.squares).concat(
        Object.values(C3D.pieceMeshes).flatMap(m => m ? _collect(m) : []));
    const hits = C3D.raycaster.intersectObjects(targets, false);
    if (!hits.length) return null;
    // Walk up to find a userData.idx
    let obj = hits[0].object;
    while (obj && obj.userData.idx == null) obj = obj.parent;
    if (obj && obj.userData.idx != null) return obj.userData.idx;
    return null;
}
function _collect(obj) {
    const out = [];
    obj.traverse(o => { if (o.isMesh) out.push(o); });
    return out;
}

// ──────────────────────────────────────────────────────────────────────
// State sync: rebuild piece meshes from chessState
// ──────────────────────────────────────────────────────────────────────
function _idxToWorld(idx) {
    // idx 0 = a8 = top-left for white. White is south (positive z).
    const r = Math.floor(idx / 8), c = idx % 8;
    return { x: c - 3.5, z: r - 3.5 };
}

function chess3DSyncFromState() {
    if (!C3D.inited) return;
    // Remove existing pieces
    for (const idx of Object.keys(C3D.pieceMeshes)) {
        const m = C3D.pieceMeshes[idx];
        if (m) C3D.scene.remove(m);
    }
    C3D.pieceMeshes = {};
    // Add fresh
    for (let idx = 0; idx < 64; idx++) {
        const p = chessState.board[idx];
        if (p === '.') continue;
        const mesh = C3D.pieceFactory(p.toLowerCase(), p === p.toUpperCase());
        const w = _idxToWorld(idx);
        mesh.position.set(w.x, 0.05, w.z);
        mesh.userData.idx = idx;
        C3D.scene.add(mesh);
        C3D.pieceMeshes[idx] = mesh;
    }
    _rebuildHighlights();
}

function _rebuildHighlights() {
    if (!C3D.inited) return;
    // Clear old
    for (const m of C3D.highlightMeshes) C3D.scene.remove(m);
    C3D.highlightMeshes = [];

    const addPlane = (idx, mat, yOff, scale = 0.95) => {
        const w = _idxToWorld(idx);
        const geo = new THREE.PlaneGeometry(scale, scale);
        const m = new THREE.Mesh(geo, mat);
        m.rotation.x = -Math.PI / 2;
        m.position.set(w.x, 0.061 + yOff, w.z);
        C3D.scene.add(m);
        C3D.highlightMeshes.push(m);
    };
    const addRing = (idx, mat, yOff) => {
        const w = _idxToWorld(idx);
        const geo = new THREE.RingGeometry(0.42, 0.48, 32);
        const m = new THREE.Mesh(geo, mat);
        m.rotation.x = -Math.PI / 2;
        m.position.set(w.x, 0.061 + yOff, w.z);
        C3D.scene.add(m);
        C3D.highlightMeshes.push(m);
    };
    const addDot = (idx, isCapture) => {
        const w = _idxToWorld(idx);
        const mats = _MAT_CACHE;
        if (isCapture) {
            const geo = new THREE.RingGeometry(0.36, 0.46, 32);
            const m = new THREE.Mesh(geo, mats.captureRing);
            m.rotation.x = -Math.PI / 2;
            m.position.set(w.x, 0.062, w.z);
            C3D.scene.add(m);
            C3D.highlightMeshes.push(m);
        } else {
            const geo = new THREE.CircleGeometry(0.13, 24);
            const m = new THREE.Mesh(geo, mats.legalDot);
            m.rotation.x = -Math.PI / 2;
            m.position.set(w.x, 0.062, w.z);
            C3D.scene.add(m);
            C3D.highlightMeshes.push(m);
        }
    };

    // Last move
    if (C3D.lastFromIdx != null) addPlane(C3D.lastFromIdx, _MAT_CACHE.lastMove, 0.001, 1.0);
    if (C3D.lastToIdx   != null) addPlane(C3D.lastToIdx,   _MAT_CACHE.lastMove, 0.001, 1.0);

    // Selected square + legal dots
    if (typeof chessSelected !== 'undefined' && chessSelected != null) {
        addPlane(chessSelected, _MAT_CACHE.selected, 0.002, 1.0);
        if (Array.isArray(chessLegalCache)) {
            for (const mv of chessLegalCache) {
                addDot(mv.to, mv.capture || chessState.board[mv.to] !== '.');
            }
        }
    }
    // Check glow
    if (typeof chessInCheck === 'function' && chessInCheck(chessState)) {
        const kp = chessFindKing(chessState, chessState.turn === 'w');
        if (kp >= 0) addPlane(kp, _MAT_CACHE.check, 0.003, 1.0);
    }
}

// ──────────────────────────────────────────────────────────────────────
// Animation: slide a piece mesh from one square to another
// ──────────────────────────────────────────────────────────────────────
function chess3DAnimateMove(fromIdx, toIdx, callback) {
    if (!C3D.inited) { callback(); return; }
    const mesh = C3D.pieceMeshes[fromIdx];
    if (!mesh) { callback(); return; }
    const from = _idxToWorld(fromIdx);
    const to   = _idxToWorld(toIdx);
    // Remove captured piece if present at target
    const cap = C3D.pieceMeshes[toIdx];
    if (cap) {
        C3D.scene.remove(cap);
        delete C3D.pieceMeshes[toIdx];
    }
    // Re-assign mesh in pieceMeshes
    delete C3D.pieceMeshes[fromIdx];
    C3D.pieceMeshes[toIdx] = mesh;
    mesh.userData.idx = toIdx;

    const duration = 480; // ms
    const start = performance.now();
    const startY = mesh.position.y;
    const arcHeight = 0.35; // gentle arc

    C3D.animating = true;
    function step(now) {
        const t = Math.min(1, (now - start) / duration);
        const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; // easeInOutQuad
        mesh.position.x = from.x + (to.x - from.x) * e;
        mesh.position.z = from.z + (to.z - from.z) * e;
        mesh.position.y = startY + arcHeight * Math.sin(Math.PI * e);
        if (t < 1) requestAnimationFrame(step);
        else {
            mesh.position.set(to.x, 0.05, to.z);
            C3D.animating = false;
            callback();
        }
    }
    requestAnimationFrame(step);
}

// ──────────────────────────────────────────────────────────────────────
// Show / hide & render loop
// ──────────────────────────────────────────────────────────────────────
function chess3DShow() {
    if (!C3D.inited) chess3DInit();
    if (!C3D.inited) return;
    C3D.enabled = true;
    chess3DResize();
    chess3DSyncFromState();
    if (C3D.orbit && typeof chessHumanSide !== 'undefined') C3D.orbit.setForSide(chessHumanSide || 'w');
    if (!C3D.rafId) _loop();
}
function chess3DHide() {
    C3D.enabled = false;
    if (C3D.rafId) { cancelAnimationFrame(C3D.rafId); C3D.rafId = null; }
}
function _loop() {
    if (!C3D.enabled) { C3D.rafId = null; return; }
    C3D.rafId = requestAnimationFrame(_loop);
    // View hidden (user switched apps) → skip the WebGL render
    if (!C3D.renderer || C3D.renderer.domElement.offsetParent === null) return;
    C3D.renderer.render(C3D.scene, C3D.camera);
}

// ──────────────────────────────────────────────────────────────────────
// Load a custom chess set from a GLB URL.
// Expected: top-level meshes / nodes named "pawn", "rook", "knight",
// "bishop", "queen", "king" (case-insensitive). Returns a promise.
// ──────────────────────────────────────────────────────────────────────
function chess3DLoadGLB(url) {
    return new Promise((resolve, reject) => {
        if (typeof THREE.GLTFLoader === 'undefined') {
            reject(new Error('GLTFLoader not available'));
            return;
        }
        if (!url) {
            C3D_GLB_TEMPLATES = null;
            C3D_GLB_URL = '';
            if (C3D.inited) chess3DSyncFromState();
            resolve(null);
            return;
        }
        const loader = new THREE.GLTFLoader();
        loader.load(url, gltf => {
            // Walk the scene, pick out named pieces
            const found = {};
            const keys = { pawn:'p', rook:'r', knight:'n', bishop:'b', queen:'q', king:'k' };
            gltf.scene.traverse(obj => {
                const n = (obj.name || '').toLowerCase();
                for (const k of Object.keys(keys)) {
                    if (n.includes(k) && !found[keys[k]]) {
                        // Clone, normalize scale to ~unit size, and center on origin x/z.
                        const inst = obj.clone(true);
                        const box = new THREE.Box3().setFromObject(inst);
                        const size = box.getSize(new THREE.Vector3());
                        const target = (k === 'king') ? 1.9 :
                                       (k === 'queen') ? 1.7 :
                                       (k === 'bishop' || k === 'knight') ? 1.5 :
                                       (k === 'rook') ? 1.1 : 1.0;
                        const scale = target / Math.max(0.001, size.y);
                        inst.scale.setScalar(scale);
                        // Rebox after scale + center on x/z, bottom on y=0
                        const box2 = new THREE.Box3().setFromObject(inst);
                        const ctr = box2.getCenter(new THREE.Vector3());
                        inst.position.x -= ctr.x;
                        inst.position.z -= ctr.z;
                        inst.position.y -= box2.min.y;
                        found[keys[k]] = inst;
                    }
                }
            });
            const have = Object.keys(found);
            if (have.length === 0) {
                reject(new Error('No pieces found in GLB — expected names like pawn/rook/knight/bishop/queen/king'));
                return;
            }
            C3D_GLB_TEMPLATES = found;
            C3D_GLB_URL = url;
            if (C3D.inited) chess3DSyncFromState();
            resolve(found);
        }, undefined, err => reject(err));
    });
}

// Rebuild materials & meshes when piece-set or board-material changes
function chess3DRebuild() {
    if (!C3D.inited) return;
    _MAT_CACHE = null;
    const mats = _buildMaterials();
    // Update board square + frame materials
    for (const child of C3D.boardGroup.children) {
        if (child.geometry && child.geometry.type === 'BoxGeometry') {
            const params = child.geometry.parameters;
            // Frame is 9.6 wide, inlay is 8.6, squares are 1.0
            if (Math.abs(params.width - 9.6) < 0.01) child.material = mats.frame;
            else if (Math.abs(params.width - 1.0) < 0.01) {
                const idx = child.userData.idx;
                const r = Math.floor(idx / 8), c = idx % 8;
                child.material = ((r + c) % 2 === 0) ? mats.lightSq : mats.darkSq;
            }
        }
    }
    // Recreate piece meshes from current state
    chess3DSyncFromState();
}

// ──────────────────────────────────────────────────────────────────────
// Public API used by chess.js
// ──────────────────────────────────────────────────────────────────────
window.chess3DSetPieceSet = function(name) { C3D_PIECESET = name; chess3DRebuild(); };
window.chess3DSetBoardMat = function(name) { C3D_BOARDMAT = name; chess3DRebuild(); };
window.chess3DSetLighting = function(name) { C3D_LIGHTING = name; if (C3D.inited) _applyLighting(name); };
window.chess3DLoadGLB     = chess3DLoadGLB;
window.chess3DShow = chess3DShow;
window.chess3DHide = chess3DHide;
window.chess3DSync = function(lastMove) {
    if (!C3D.enabled) return;
    if (lastMove) { C3D.lastFromIdx = lastMove.from; C3D.lastToIdx = lastMove.to; }
    else          { C3D.lastFromIdx = null;           C3D.lastToIdx = null; }
    chess3DSyncFromState();
};
window.chess3DAnimateMove = chess3DAnimateMove;
window.chess3DHighlightRefresh = _rebuildHighlights;
