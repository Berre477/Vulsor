// ============================================================================
//  Voyage — a study timer as a 3D space journey.
//  Customise your astronaut, pick a planet and a study duration, then launch:
//  the ship flies through space and arrives exactly when your time is up.
//
//  Built on the global THREE (vendor/three.min.js), mirroring js/galaxy.js.
//  Exposes: renderVoyage() / stopVoyage()
// ============================================================================
(function () {
    'use strict';

    var T, renderer, scene, camera, controls, raf = null, ro = null, last = 0;
    var ship, spinRing, engineGlow, stars, planet, planetGlow, sunLight;
    var built = false, hudBuilt = false, faceCanvas = null;
    // gameplay (legacy, unused) + drag-to-rotate the rocket
    var orbs = [], keys = {}, steerX = 0, steerY = 0, score = 0, best = 0;
    var launchStart = 0, lookMode = false, keysBound = false;
    // points earned for completing voyages
    var totalPoints = 0, lastEarned = 0;
    var modelPivot = null, dragRX = 0, dragRY = 0, dragBound = false, dragging = false, dpx = 0, dpy = 0;

    // ---- state / persistence ----------------------------------------------
    var PLANETS = [
        { name: 'Tau Ceti e',  col: 0x4fb079, shade: 0x2e7a55, ring: false },
        { name: 'Mars',        col: 0xc85a37, shade: 0x8a3a25, ring: false },
        { name: 'The Moon',    col: 0xc8c8cd, shade: 0x84848f, ring: false },
        { name: 'Proxima b',   col: 0xb4785a, shade: 0x784b37, ring: false },
        { name: 'Saturn',      col: 0xdcc896, shade: 0xaa966e, ring: true  },
        { name: 'Kepler-442b', col: 0x6e96dc, shade: 0x4664aa, ring: false },
        { name: 'Earth',       col: 0x3a7bd5, shade: 0x21507f, ring: false },
        { name: 'Venus',       col: 0xe6d2a0, shade: 0xb0a070, ring: false },
        { name: 'Mercury',     col: 0x9c8b7a, shade: 0x6e5f50, ring: false },
        { name: 'Jupiter',     col: 0xd9b48f, shade: 0xa07b50, ring: false },
        { name: 'Uranus',      col: 0x9fe0e6, shade: 0x5fa9b5, ring: true  },
        { name: 'Neptune',     col: 0x3f54c0, shade: 0x26337a, ring: false },
        { name: 'Pluto',       col: 0xc9b8a8, shade: 0x8f7f6f, ring: false },
        { name: 'TRAPPIST-1e', col: 0xc0664a, shade: 0x803a25, ring: false },
        { name: '55 Cancri e', col: 0xff7a3c, shade: 0xb04010, ring: false },
        { name: 'Kepler-22b',  col: 0x5ec8c0, shade: 0x368078, ring: false }
    ];
    var SHIP_COLS = [0xced2dc, 0xf2b04a, 0x66c8a0, 0x78a0fa, 0xe66e8c, 0xb478e6];
    var SKIN = ['#ffe0bd','#f1c296','#e0ac69','#c68642','#8d5524','#5e3920'];
    var HAIR = ['#1e1c1c','#4a301c','#966432','#d6a860','#b4b4b9','#c83c3c','#5a78d2'];
    var EYES = ['#46301a','#285aa0','#3c8c5a','#785aa0','#3c3c41'];
    var HELM = ['#ebebf5','#fab43c','#5ac8a0','#78a0fa','#e66e8c','#aa78e6'];

    // To use a real 3D ship model: drop a NON-Draco .glb at js/models/hail_mary.glb
    // (path is relative to index.html). It auto-replaces the built-in ship. Tune
    // these if it loads facing the wrong way or too big/small.
    var SHIP_MODEL_URL = 'js/models/hail_mary.glb';
    var SHIP_MODEL = { scale: 1.0, rotX: -0.35, rotY: Math.PI, rotZ: 0, ox: 0, oy: 3.4, oz: 0 };
    var usingModel = false;

    // Planets are huge compared to the ~16-unit ship. PLANET_R is the body radius;
    // the ship sits as a tiny silhouette in the foreground while the world looms
    // behind it. NEAR is kept well back so the massive planet stays framed (and
    // never engulfs the camera) on arrival.
    var PLANET_R = 120;
    // The planet's launch distance scales with the study time so the ship flies at
    // a constant speed: 60 min sits twice as far out as 30 min. NEAR is where it
    // ends up on arrival — kept at least PLANET_R behind the ship (z=0) so the huge
    // body fills the view without swallowing the ship. Clamped to the far plane.
    var PLANET_PER_MIN = 40;   // world units of travel per study minute
    var PLANET_NEAR = -185;
    function _planetFar() { return Math.max(PLANET_NEAR - PLANET_PER_MIN * S.minutes, -3500); }

    var S = {
        dest: 0, minutes: 25, shipCol: 0,
        skin: 1, hairStyle: 1, hair: 1, eye: 0, helmet: 0, glasses: false, beard: false
    };
    function load() { try { var j = JSON.parse(localStorage.getItem('vulsor_voyage') || '{}'); Object.assign(S, j); } catch (_) {} }
    function save() { try { localStorage.setItem('vulsor_voyage', JSON.stringify(S)); } catch (_) {} }
    function loadPoints() { try { totalPoints = parseInt(localStorage.getItem('vulsor_voyage_points') || '0', 10) || 0; } catch (_) { totalPoints = 0; } }
    function savePoints() { try { localStorage.setItem('vulsor_voyage_points', String(totalPoints)); } catch (_) {} }

    // points awarded for reaching the planet: 10 per focused minute, plus a 50pt
    // arrival bonus and a small distance bonus for further planets.
    function _awardPoints() {
        var distBonus = (S.dest + 1) * 25;
        lastEarned = S.minutes * 10 + 50 + distBonus;
        totalPoints += lastEarned;
        savePoints();
    }

    // flight state
    var phase = 'setup';            // 'setup' | 'flying' | 'arrived'
    var startMs = 0, pausedMs = 0, pauseStart = 0, paused = false, arriveT = 0;

    function progress() {
        if (phase === 'arrived') return 1;
        if (phase !== 'flying') return 0;
        var now = performance.now();
        var elapsed = now - startMs - pausedMs - (paused ? (now - pauseStart) : 0);
        return Math.max(0, Math.min(1, elapsed / (S.minutes * 60000)));
    }
    function remainingSec() { return Math.max(0, S.minutes * 60 * (1 - progress())); }

    // ---- 3D build ----------------------------------------------------------
    function _starsGeo(n, spread, depth) {
        var g = new T.BufferGeometry(), p = new Float32Array(n * 3);
        for (var i = 0; i < n; i++) {
            p[i*3]   = (Math.random()*2-1) * spread;
            p[i*3+1] = (Math.random()*2-1) * spread;
            p[i*3+2] = -Math.random() * depth;
        }
        g.setAttribute('position', new T.BufferAttribute(p, 3));
        return g;
    }

    function _buildShip() {
        var grp = new T.Group();
        var col = SHIP_COLS[S.shipCol];
        var hullMat = new T.MeshStandardMaterial({ color: col, metalness: 0.5, roughness: 0.45 });
        var darkMat = new T.MeshStandardMaterial({ color: 0x4a5066, metalness: 0.6, roughness: 0.5 });

        var hull = new T.Mesh(new T.CylinderGeometry(0.62, 0.62, 3.2, 24), hullMat);
        hull.rotation.x = Math.PI / 2; grp.add(hull);

        var nose = new T.Mesh(new T.ConeGeometry(0.62, 1.2, 24), hullMat);
        nose.rotation.x = -Math.PI / 2; nose.position.z = -2.2; grp.add(nose);

        var tail = new T.Mesh(new T.CylinderGeometry(0.5, 0.66, 0.5, 24), darkMat);
        tail.rotation.x = Math.PI / 2; tail.position.z = 1.7; grp.add(tail);

        // spinning habitat ring
        spinRing = new T.Mesh(new T.TorusGeometry(1.05, 0.16, 12, 32), darkMat);
        spinRing.position.z = 0.1; grp.add(spinRing);

        // cockpit dome (front)
        var dome = new T.Mesh(new T.SphereGeometry(0.5, 20, 16),
            new T.MeshStandardMaterial({ color: 0x223049, metalness: 0.2, roughness: 0.1,
                emissive: 0x4a78c8, emissiveIntensity: 0.35 }));
        dome.position.z = -1.0; dome.scale.z = 0.8; grp.add(dome);

        // fins
        var finMat = darkMat;
        [[0, 0.85], [0, -0.85], [0.85, 0], [-0.85, 0]].forEach(function (o) {
            var fin = new T.Mesh(new T.BoxGeometry(0.12, 0.7, 0.9), finMat);
            fin.position.set(o[0], o[1], 1.4);
            if (o[0] !== 0) fin.rotation.z = Math.PI / 2;
            grp.add(fin);
        });

        // engine glow
        engineGlow = new T.Mesh(new T.SphereGeometry(0.42, 16, 12),
            new T.MeshBasicMaterial({ color: 0x7cc8ff, transparent: true, opacity: 0.9 }));
        engineGlow.position.z = 2.1; grp.add(engineGlow);
        var eL = new T.PointLight(0x7cc8ff, 1.2, 12); eL.position.z = 3; grp.add(eL);

        return grp;
    }

    function _buildPlanet() {
        if (planet) scene.remove(planet);
        var P = PLANETS[S.dest];
        var g = new T.Group();
        var mesh = new T.Mesh(new T.SphereGeometry(PLANET_R, 48, 32),
            new T.MeshStandardMaterial({ color: P.col, roughness: 0.9, metalness: 0.0,
                emissive: P.shade, emissiveIntensity: 0.15 }));
        g.add(mesh);
        if (P.ring) {
            var ring = new T.Mesh(new T.RingGeometry(PLANET_R * 1.35, PLANET_R * 2.1, 96),
                new T.MeshBasicMaterial({ color: P.col, side: T.DoubleSide, transparent: true, opacity: 0.5 }));
            ring.rotation.x = Math.PI / 2.3; g.add(ring);
        }
        planetGlow = new T.Mesh(new T.SphereGeometry(PLANET_R * 1.08, 48, 32),
            new T.MeshBasicMaterial({ color: P.col, transparent: true, opacity: 0.12 }));
        g.add(planetGlow);
        g.position.set(PLANET_R * 0.35, PLANET_R * 0.12, _planetFar());
        scene.add(g);
        planet = g;
    }

    // collectible "astrophage" energy orbs — fly through them for points
    function _orbReset(o, far) {
        o.position.set((Math.random() - 0.5) * 11, (Math.random() - 0.5) * 6.5,
                       far ? (-90 - Math.random() * 240) : (-30 - Math.random() * 60));
        o.visible = true; o.userData.hit = false;
    }
    function _buildOrbs() {
        orbs = [];
        var geo = new T.SphereGeometry(0.5, 14, 12);
        for (var i = 0; i < 16; i++) {
            var mat = new T.MeshBasicMaterial({ color: 0x8fffd0, transparent: true, opacity: 0.95 });
            var o = new T.Mesh(geo, mat);
            var glow = new T.Mesh(new T.SphereGeometry(0.85, 12, 10),
                new T.MeshBasicMaterial({ color: 0x4fe0a0, transparent: true, opacity: 0.25 }));
            o.add(glow);
            _orbReset(o, true);
            scene.add(o); orbs.push(o);
        }
    }

    function _applyModel(gltf) {
        try {
            var model = gltf.scene || (gltf.scenes && gltf.scenes[0]);
            if (!model || !ship) return;

            // make every material render (Sketchfab PBR is often fully metallic →
            // shows up pure black with no environment map, which looked "missing")
            model.traverse(function (o) {
                if (!o.isMesh) return;
                o.frustumCulled = false;
                var mats = Array.isArray(o.material) ? o.material : [o.material];
                mats.forEach(function (m) {
                    if (!m) return;
                    if ('metalness' in m) m.metalness = Math.min(m.metalness, 0.35);
                    if ('roughness' in m) m.roughness = Math.max(m.roughness == null ? 0.5 : m.roughness, 0.45);
                    if ('envMapIntensity' in m) m.envMapIntensity = 1.6;
                    m.needsUpdate = true;
                });
            });

            // centre the model in a pivot, then scale BIG + orient toward the planet
            var box = new T.Box3().setFromObject(model);
            var c = box.getCenter(new T.Vector3());
            var sz = box.getSize(new T.Vector3());
            model.position.sub(c);
            var pivot = new T.Group();
            pivot.add(model);
            var maxd = Math.max(sz.x, sz.y, sz.z) || 1;
            pivot.scale.setScalar((16 / maxd) * SHIP_MODEL.scale);   // much bigger
            pivot.rotation.set(SHIP_MODEL.rotX, SHIP_MODEL.rotY, SHIP_MODEL.rotZ);
            pivot.position.set(SHIP_MODEL.ox, SHIP_MODEL.oy, SHIP_MODEL.oz);

            for (var i = ship.children.length - 1; i >= 0; i--) ship.remove(ship.children[i]);
            spinRing = null; engineGlow = null;   // the model provides these now
            ship.add(pivot);
            modelPivot = pivot;
            usingModel = true;
            if (controls) controls.target.set(0, SHIP_MODEL.oy, 0);
            console.log('[voyage] Hail Mary model loaded (size ' + sz.x.toFixed(1) + 'x' + sz.y.toFixed(1) + 'x' + sz.z.toFixed(1) + ')');
        } catch (e) { console.warn('[voyage] model setup failed', e); }
    }

    function _loadShipModel() {
        if (!ship || !T || typeof T.GLTFLoader !== 'function') return;
        var loader = new T.GLTFLoader();
        // Preferred: read the file with Node fs (works from inside app.asar, where
        // web fetch/XHR of a large binary can fail) and parse the bytes directly.
        try {
            var req = (typeof require === 'function') ? require : (window.require || null);
            if (req) {
                var fs = req('fs');
                var dir = decodeURIComponent((location.pathname || '')).replace(/\/[^/]*$/, '');
                var file = dir + '/' + SHIP_MODEL_URL;
                fs.readFile(file, function (err, buf) {
                    if (err || !buf) { _loadViaUrl(loader); return; }
                    var ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
                    try { loader.parse(ab, '', _applyModel, function () { _loadViaUrl(loader); }); }
                    catch (e) { _loadViaUrl(loader); }
                });
                return;
            }
        } catch (e) { /* fall through */ }
        _loadViaUrl(loader);
    }
    function _loadViaUrl(loader) {
        try { loader.load(SHIP_MODEL_URL, _applyModel, undefined, function () {
            console.warn('[voyage] could not load ship model — using built-in ship');
        }); } catch (e) {}
    }

    function _build() {
        var container = document.getElementById('voyage-3d');
        if (!container) return false;
        T = window.THREE;
        if (!T) { console.warn('[voyage] THREE not loaded'); return false; }

        // antialias off + pixelRatio 1: this app runs WebGL in software (hardware
        // accel is disabled for the video fix), so resolution/AA dominate cost.
        renderer = new T.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
        renderer.setPixelRatio(1);
        if (T.sRGBEncoding) renderer.outputEncoding = T.sRGBEncoding;
        renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
        container.appendChild(renderer.domElement);

        scene = new T.Scene();
        scene.fog = new T.FogExp2(0x01010a, 0.0009);
        camera = new T.PerspectiveCamera(60, 1, 0.1, 4000);
        camera.position.set(0, SHIP_MODEL.oy + 1.5, 22);
        camera.lookAt(0, SHIP_MODEL.oy, 0);

        // bright multi-angle lighting so a metallic ship model is clearly visible
        scene.add(new T.AmbientLight(0xb0c4e0, 1.1));
        scene.add(new T.HemisphereLight(0xcfe2ff, 0x202a44, 1.2));
        sunLight = new T.DirectionalLight(0xfff0e0, 2.0);
        sunLight.position.set(-6, 8, 6); scene.add(sunLight);
        var fill = new T.DirectionalLight(0xffffff, 1.2); fill.position.set(7, -2, 6); scene.add(fill);
        var rim = new T.DirectionalLight(0x9fc0ff, 1.4); rim.position.set(0, 3, -9); scene.add(rim);
        var key2 = new T.PointLight(0xffffff, 1.0, 60); key2.position.set(0, 0, 12); scene.add(key2);

        // two star layers for parallax
        stars = new T.Group();
        var s1 = new T.Points(_starsGeo(550, 120, 600),
            new T.PointsMaterial({ color: 0xffffff, size: 0.7, sizeAttenuation: true, transparent: true, opacity: 0.9 }));
        var s2 = new T.Points(_starsGeo(280, 90, 600),
            new T.PointsMaterial({ color: 0x9fc8ff, size: 1.1, sizeAttenuation: true, transparent: true, opacity: 0.8 }));
        stars.add(s1); stars.add(s2); scene.add(stars);

        ship = _buildShip(); scene.add(ship);
        _loadShipModel();
        _buildPlanet();

        // keep scroll-to-zoom (via OrbitControls) but NOT camera rotate/pan —
        // the left-drag is used to spin the rocket itself instead.
        if (typeof T.OrbitControls === 'function') {
            controls = new T.OrbitControls(camera, renderer.domElement);
            controls.enableDamping = true; controls.dampingFactor = 0.08;
            controls.enableRotate = false; controls.enablePan = false;
            controls.minDistance = 6; controls.maxDistance = 90;
            controls.target.set(0, SHIP_MODEL.oy, 0);
        }
        // drag anywhere on the scene to rotate the rocket (turn it on its side)
        if (!dragBound) {
            dragBound = true;
            var el = renderer.domElement;
            el.style.cursor = 'grab';
            el.addEventListener('pointerdown', function (e) {
                dragging = true; dpx = e.clientX; dpy = e.clientY; el.style.cursor = 'grabbing';
                try { el.setPointerCapture(e.pointerId); } catch (_) {}
            });
            el.addEventListener('pointermove', function (e) {
                if (!dragging || phase !== 'setup') return;   // after launch, drag = look around
                dragRY += (e.clientX - dpx) * 0.01;
                dragRX += (e.clientY - dpy) * 0.01;
                dpx = e.clientX; dpy = e.clientY;
            });
            var endDrag = function () { dragging = false; if (renderer) renderer.domElement.style.cursor = 'grab'; };
            el.addEventListener('pointerup', endDrag);
            el.addEventListener('pointerleave', endDrag);
        }

        ro = new ResizeObserver(_resize); ro.observe(container);
        _resize();
        built = true;
        return true;
    }

    function _resize() {
        var c = document.getElementById('voyage-3d'); if (!c || !renderer) return;
        var w = c.clientWidth || 800, h = c.clientHeight || 600;
        renderer.setSize(w, h, false);
        camera.aspect = w / h; camera.updateProjectionMatrix();
    }

    function _recolorShip() {
        if (!ship) return;
        var col = SHIP_COLS[S.shipCol];
        ship.traverse(function (m) {
            if (m.isMesh && m.material && m.material.color &&
                m.material.metalness === 0.5) m.material.color.setHex(col);
        });
    }

    // ---- animation ---------------------------------------------------------
    function _frame(t) {
        raf = requestAnimationFrame(_frame);
        var dt = Math.min(0.05, (t - last) / 1000); last = t;
        var prog = progress();

        var launching = (phase === 'launch');
        var launchK = launching ? Math.min(1, (performance.now() - launchStart) / 2500) : (phase === 'flying' ? 1 : 0);
        var moving = (phase === 'flying' && !paused) || launching;

        // starfield streaks — ramps up during the launch
        var speed = moving ? (18 + 52 * launchK) : 12;
        stars.children.forEach(function (layer, li) {
            var arr = layer.geometry.attributes.position.array, sp = speed * (li === 0 ? 1 : 0.6);
            for (var i = 2; i < arr.length; i += 3) { arr[i] += sp * dt; if (arr[i] > 8) arr[i] = -600 + Math.random() * 20; }
            layer.geometry.attributes.position.needsUpdate = true;
        });

        // gentle idle bob; left-drag rotates the rocket (spin it / turn on its side)
        if (ship) ship.position.set(0, Math.sin(t * 0.0016) * 0.12, 0);
        if (modelPivot) {
            ship.rotation.set(0, 0, 0);
            modelPivot.rotation.set(SHIP_MODEL.rotX + dragRX, SHIP_MODEL.rotY + dragRY, SHIP_MODEL.rotZ);
        } else if (ship) {
            ship.rotation.set(dragRX, dragRY, 0);
        }
        if (spinRing) spinRing.rotation.z += dt * (moving ? 2.4 : 1.0);
        if (engineGlow) {
            var fl = 0.7 + 0.3 * Math.sin(t * 0.03) + 0.1 * Math.sin(t * 0.09);
            engineGlow.scale.setScalar(moving ? (0.8 + fl + launchK) : 0.5);
            engineGlow.material.opacity = moving ? 0.95 : 0.35;
        }

        // planet approaches as study progresses
        if (planet) {
            var far = _planetFar();
            planet.position.z = far + (far - PLANET_NEAR) * -prog;
            planet.rotation.y += dt * 0.08;
            if (planetGlow) planetGlow.material.opacity = 0.10 + 0.06 * Math.sin(t * 0.002);
        }

        // ── phase transitions ──
        if (launching && launchK >= 1) { phase = 'flying'; startMs = performance.now(); pausedMs = 0; paused = false; _hud(); }
        if (phase === 'flying' && prog >= 1) { phase = 'arrived'; arriveT = 0; _awardPoints(); _hud(); }
        if (phase === 'arrived') { arriveT += dt; if (planet) planet.rotation.y += dt * 0.3; }

        // ── camera ── setup: fixed (drag poses the rocket). after launch: drag
        // orbits the camera so you can look around while you travel.
        if (controls) {
            controls.enabled = true;
            controls.enableRotate = (phase !== 'setup');
            controls.update();
        }

        if (phase === 'flying') _hudTick();
        renderer.render(scene, camera);
    }

    // ---- astronaut face (2D, customisable) ---------------------------------
    function _drawFace() {
        if (!faceCanvas) return;
        var x = faceCanvas.getContext('2d'), W = faceCanvas.width, H = faceCanvas.height;
        x.clearRect(0, 0, W, H);
        var cx = W / 2, cy = H / 2 + 4, s = W / 100;
        var skin = SKIN[S.skin], hair = HAIR[S.hair];
        // shoulders
        x.fillStyle = '#46506e'; _round(x, cx - 22*s, cy + 20*s, 44*s, 18*s, 8*s);
        // head
        x.fillStyle = skin; _circle(x, cx, cy, 18*s);
        _circle(x, cx - 18*s, cy + 2*s, 3.5*s); _circle(x, cx + 18*s, cy + 2*s, 3.5*s);
        // hair
        if (S.hairStyle !== 0) {
            x.fillStyle = hair;
            x.beginPath(); x.arc(cx, cy, 19*s, Math.PI, 2*Math.PI); x.fill();
            if (S.hairStyle === 2) { x.lineWidth = 2.4*s; x.strokeStyle = hair;
                for (var i = -3; i <= 3; i++) { x.beginPath(); x.moveTo(cx+i*5*s, cy-14*s); x.lineTo(cx+i*5*s-1*s, cy-26*s); x.stroke(); } }
            else if (S.hairStyle === 3) { _round(x, cx-20*s, cy-4*s, 7*s, 26*s, 3*s); _round(x, cx+13*s, cy-4*s, 7*s, 26*s, 3*s); }
            else if (S.hairStyle === 4) { _circle(x, cx, cy-22*s, 6.5*s); }
        }
        // eyes
        var ex = 7*s, ey = -1*s;
        x.fillStyle = '#fff'; _circle(x, cx-ex, cy+ey, 4*s); _circle(x, cx+ex, cy+ey, 4*s);
        x.fillStyle = EYES[S.eye]; _circle(x, cx-ex, cy+ey, 2.1*s); _circle(x, cx+ex, cy+ey, 2.1*s);
        x.fillStyle = '#000'; _circle(x, cx-ex+0.6*s, cy+ey-0.6*s, 0.8*s); _circle(x, cx+ex+0.6*s, cy+ey-0.6*s, 0.8*s);
        // brows
        x.strokeStyle = hair; x.lineWidth = 1.6*s; x.lineCap = 'round';
        x.beginPath(); x.moveTo(cx-ex-3*s, cy+ey-6*s); x.lineTo(cx-ex+3*s, cy+ey-7*s); x.stroke();
        x.beginPath(); x.moveTo(cx+ex-3*s, cy+ey-7*s); x.lineTo(cx+ex+3*s, cy+ey-6*s); x.stroke();
        // smile
        x.strokeStyle = 'rgba(150,60,60,0.85)'; x.beginPath(); x.arc(cx, cy+6*s, 5*s, 0.15*Math.PI, 0.85*Math.PI); x.stroke();
        // beard
        if (S.beard) { x.fillStyle = hair; x.globalAlpha = 0.9; x.beginPath(); x.arc(cx, cy+5*s, 17*s, 0.18*Math.PI, 0.82*Math.PI); x.fill(); x.globalAlpha = 1; }
        // glasses
        if (S.glasses) { x.strokeStyle = '#2a2a2e'; x.lineWidth = 1.4*s;
            x.beginPath(); x.arc(cx-ex, cy+ey, 5.4*s, 0, 2*Math.PI); x.stroke();
            x.beginPath(); x.arc(cx+ex, cy+ey, 5.4*s, 0, 2*Math.PI); x.stroke(); }
        // helmet
        x.strokeStyle = HELM[S.helmet]; x.lineWidth = 3*s;
        x.beginPath(); x.arc(cx, cy, 27*s, 0, 2*Math.PI); x.stroke();
        x.fillStyle = 'rgba(150,200,255,0.10)'; _circle(x, cx, cy, 26*s);
    }
    function _circle(x, cx, cy, r) { x.beginPath(); x.arc(cx, cy, r, 0, 2*Math.PI); x.fill(); }
    function _round(x, rx, ry, w, h, r) { x.beginPath(); x.moveTo(rx+r, ry); x.arcTo(rx+w, ry, rx+w, ry+h, r); x.arcTo(rx+w, ry+h, rx, ry+h, r); x.arcTo(rx, ry+h, rx, ry, r); x.arcTo(rx, ry, rx+w, ry, r); x.fill(); }

    // ---- HUD ---------------------------------------------------------------
    function _btn(label, cb) {
        var b = document.createElement('button');
        b.textContent = label;
        b.style.cssText = 'pointer-events:auto;background:rgba(40,52,84,.85);color:#dbe4ff;border:1px solid rgba(120,160,250,.3);border-radius:8px;padding:5px 9px;font-size:13px;cursor:pointer;margin:0 3px';
        b.onclick = cb; return b;
    }
    function _row(label, valueId, onPrev, onNext) {
        var r = document.createElement('div');
        r.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin:6px 0;gap:8px';
        var l = document.createElement('span'); l.textContent = label; l.style.cssText = 'color:#aab6d8;font-size:13px;min-width:96px';
        var mid = document.createElement('div'); mid.style.cssText = 'display:flex;align-items:center;gap:4px';
        mid.appendChild(_btn('◀', onPrev));
        var v = document.createElement('span'); v.id = valueId; v.style.cssText = 'color:#eaf0ff;font-size:13px;min-width:84px;text-align:center'; mid.appendChild(v);
        mid.appendChild(_btn('▶', onNext));
        r.appendChild(l); r.appendChild(mid); return r;
    }
    function _cyc(key, n, d) { S[key] = (S[key] + d + n) % n; save(); _drawFace(); _hud(); if (key === 'shipCol') _recolorShip(); if (key === 'dest') _buildPlanet(); }

    function _buildHud() {
        var hud = document.getElementById('voyage-hud');
        if (!hud) return;
        hud.innerHTML = '';

        // setup card
        var card = document.createElement('div');
        card.id = 'voyage-setup';
        card.style.cssText = 'position:absolute;top:18px;left:18px;width:300px;background:rgba(10,14,30,.72);backdrop-filter:blur(8px);border:1px solid rgba(120,160,250,.22);border-radius:16px;padding:14px 16px;pointer-events:none';
        card.innerHTML = '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">'
            + '<canvas id="voyage-face" width="72" height="72" style="border-radius:10px;background:rgba(0,0,0,.25)"></canvas>'
            + '<div><div style="color:#eaf0ff;font-size:16px;font-weight:600">Study Voyage</div>'
            + '<div style="color:#8ea0cc;font-size:11px">Set a time — arrive when you finish.</div>'
            + '<div id="v-setup-pts" style="color:#ffe08a;font-size:12px;font-weight:600;margin-top:3px">★ 0 pts</div></div></div>';
        hud.appendChild(card);
        faceCanvas = card.querySelector('#voyage-face');

        card.appendChild(_row('Destination', 'v-dest', function () { _cyc('dest', PLANETS.length, -1); }, function () { _cyc('dest', PLANETS.length, 1); }));

        // Minutes — type it in (or use the arrows)
        var mrow = document.createElement('div');
        mrow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin:6px 0;gap:8px';
        var ml = document.createElement('span'); ml.textContent = 'Minutes';
        ml.style.cssText = 'color:#aab6d8;font-size:13px;min-width:96px';
        var mmid = document.createElement('div'); mmid.style.cssText = 'display:flex;align-items:center;gap:4px';
        var minInput = document.createElement('input');
        minInput.type = 'number'; minInput.min = '1'; minInput.max = '600'; minInput.id = 'v-min-input'; minInput.value = S.minutes;
        minInput.style.cssText = 'pointer-events:auto;width:64px;text-align:center;background:rgba(20,28,48,.9);color:#eaf0ff;border:1px solid rgba(120,160,250,.35);border-radius:8px;padding:5px 4px;font-size:14px;-moz-appearance:textfield';
        minInput.addEventListener('input', function () { var v = parseInt(minInput.value, 10); if (!isNaN(v)) { S.minutes = Math.max(1, Math.min(600, v)); save(); } });
        minInput.addEventListener('change', function () { minInput.value = S.minutes; });
        minInput.addEventListener('keydown', function (e) { e.stopPropagation(); if (e.key === 'Enter') minInput.blur(); });
        mmid.appendChild(_btn('◀', function () { S.minutes = Math.max(1, S.minutes - 1); save(); minInput.value = S.minutes; }));
        mmid.appendChild(minInput);
        mmid.appendChild(_btn('▶', function () { S.minutes = Math.min(600, S.minutes + 1); save(); minInput.value = S.minutes; }));
        mrow.appendChild(ml); mrow.appendChild(mmid);
        card.appendChild(mrow);
        card.appendChild(_row('Ship colour', 'v-ship', function () { _cyc('shipCol', SHIP_COLS.length, -1); }, function () { _cyc('shipCol', SHIP_COLS.length, 1); }));
        card.appendChild(_row('Skin', 'v-skin', function () { _cyc('skin', SKIN.length, -1); }, function () { _cyc('skin', SKIN.length, 1); }));
        card.appendChild(_row('Hair style', 'v-hs', function () { _cyc('hairStyle', 5, -1); }, function () { _cyc('hairStyle', 5, 1); }));
        card.appendChild(_row('Hair colour', 'v-hc', function () { _cyc('hair', HAIR.length, -1); }, function () { _cyc('hair', HAIR.length, 1); }));
        card.appendChild(_row('Eyes', 'v-eye', function () { _cyc('eye', EYES.length, -1); }, function () { _cyc('eye', EYES.length, 1); }));
        card.appendChild(_row('Helmet', 'v-helm', function () { _cyc('helmet', HELM.length, -1); }, function () { _cyc('helmet', HELM.length, 1); }));
        var toggles = document.createElement('div'); toggles.style.cssText = 'display:flex;gap:6px;margin:8px 0';
        toggles.appendChild(_btn('Glasses', function () { S.glasses = !S.glasses; save(); _drawFace(); }));
        toggles.appendChild(_btn('Beard', function () { S.beard = !S.beard; save(); _drawFace(); }));
        card.appendChild(toggles);
        var launch = _btn('🚀  Launch', function () {
            phase = 'launch'; launchStart = performance.now(); _hud();
        });
        launch.style.cssText += ';width:100%;margin:6px 0 0;background:linear-gradient(90deg,#3b6ad6,#7c4fe0);font-size:15px;padding:9px';
        card.appendChild(launch);

        // flight HUD (top center)
        var fly = document.createElement('div');
        fly.id = 'voyage-fly';
        fly.style.cssText = 'position:absolute;top:18px;left:50%;transform:translateX(-50%);text-align:center;pointer-events:none;display:none';
        fly.innerHTML = '<div id="v-clock" style="color:#fff;font-size:48px;font-weight:700;font-variant-numeric:tabular-nums;text-shadow:0 2px 20px rgba(80,140,255,.5)">25:00</div>'
            + '<div id="v-to" style="color:#9fc0ff;font-size:15px">to Tau Ceti e</div>';
        hud.appendChild(fly);

        // launch banner
        var lb = document.createElement('div');
        lb.id = 'voyage-launch';
        lb.style.cssText = 'position:absolute;top:42%;left:50%;transform:translateX(-50%);text-align:center;pointer-events:none;display:none';
        lb.innerHTML = '<div style="color:#fff;font-size:46px;font-weight:800;letter-spacing:4px;text-shadow:0 2px 30px rgba(120,160,255,.6)">LIFT-OFF</div>'
            + '<div style="color:#9fc0ff;font-size:16px;margin-top:4px">igniting the spin drive…</div>';
        hud.appendChild(lb);

        // progress + controls (bottom)
        var bar = document.createElement('div');
        bar.id = 'voyage-bar';
        bar.style.cssText = 'position:absolute;left:50%;bottom:22px;transform:translateX(-50%);width:60%;pointer-events:none;display:none';
        bar.innerHTML = '<div style="height:12px;background:rgba(30,38,62,.8);border-radius:8px;overflow:hidden"><div id="v-fill" style="height:100%;width:0%;background:linear-gradient(90deg,#5ac8ff,#7c4fe0);border-radius:8px;transition:width .3s linear"></div></div>';
        var ctr = document.createElement('div'); ctr.style.cssText = 'text-align:center;margin-top:8px'; ctr.id = 'voyage-ctr';
        ctr.appendChild(_btn('⏸  Pause', function () {
            paused = !paused;
            if (paused) pauseStart = performance.now(); else pausedMs += performance.now() - pauseStart;
            _hud();
        }));
        ctr.appendChild(_btn('✦  Abort', function () { phase = 'setup'; _hud(); }));
        bar.appendChild(ctr);
        hud.appendChild(bar);

        // arrival overlay
        var arr = document.createElement('div');
        arr.id = 'voyage-arrived';
        arr.style.cssText = 'position:absolute;inset:0;display:none;flex-direction:column;align-items:center;justify-content:center;text-align:center;pointer-events:none';
        arr.innerHTML = '<div style="color:#fff;font-size:52px;font-weight:800;text-shadow:0 4px 30px rgba(120,160,255,.6)">Arrived!</div>'
            + '<div id="v-arr-name" style="color:#9fc0ff;font-size:22px;margin-top:6px"></div>'
            + '<div id="v-arr-sub" style="color:#cfd8f0;font-size:16px;margin-top:10px"></div>'
            + '<div id="v-arr-pts" style="color:#ffe08a;font-size:30px;font-weight:800;margin-top:18px;text-shadow:0 2px 18px rgba(255,200,80,.5)"></div>'
            + '<div id="v-arr-total" style="color:#9fc0ff;font-size:15px;margin-top:4px"></div>';
        var again = _btn('New voyage', function () { phase = 'setup'; _hud(); });
        again.style.cssText += ';pointer-events:auto;margin-top:18px;font-size:16px;padding:9px 16px';
        arr.appendChild(again);
        hud.appendChild(arr);

        hudBuilt = true;
        _drawFace();
        _hud();
    }

    function _hud() {
        if (!hudBuilt) return;
        var setup = document.getElementById('voyage-setup');
        var fly = document.getElementById('voyage-fly');
        var bar = document.getElementById('voyage-bar');
        var arr = document.getElementById('voyage-arrived');
        var lb = document.getElementById('voyage-launch');
        if (setup) setup.style.display = (phase === 'setup') ? '' : 'none';
        if (fly) fly.style.display = (phase === 'flying') ? '' : 'none';
        if (bar) bar.style.display = (phase === 'flying') ? '' : 'none';
        if (lb) lb.style.display = (phase === 'launch') ? '' : 'none';
        if (arr) arr.style.display = (phase === 'arrived') ? 'flex' : 'none';

        if (phase === 'setup') {
            var P = PLANETS[S.dest];
            _set('v-dest', P.name);
            var mi = document.getElementById('v-min-input'); if (mi && document.activeElement !== mi) mi.value = S.minutes;
            _set('v-ship', (S.shipCol + 1) + '/' + SHIP_COLS.length);
            _set('v-skin', (S.skin + 1) + '/' + SKIN.length);
            _set('v-hs', ['Bald','Short','Spiky','Long','Bun'][S.hairStyle]);
            _set('v-hc', (S.hair + 1) + '/' + HAIR.length);
            _set('v-eye', (S.eye + 1) + '/' + EYES.length);
            _set('v-helm', (S.helmet + 1) + '/' + HELM.length);
            _set('v-setup-pts', '★ ' + totalPoints.toLocaleString() + ' pts');
        } else if (phase === 'flying') {
            _set('v-to', 'to ' + PLANETS[S.dest].name);
            var ctr = document.getElementById('voyage-ctr');
            if (ctr && ctr.firstChild) ctr.firstChild.textContent = paused ? '▶  Resume' : '⏸  Pause';
            _hudTick();
        } else if (phase === 'arrived') {
            _set('v-arr-name', 'You reached ' + PLANETS[S.dest].name);
            _set('v-arr-sub', 'Study session complete — ' + S.minutes + ' minutes focused.');
            _set('v-arr-pts', '+' + lastEarned.toLocaleString() + ' points');
            _set('v-arr-total', 'Total: ' + totalPoints.toLocaleString() + ' pts');
        }
    }
    function _hudTick() {
        var r = remainingSec(), mm = Math.floor(r / 60), ss = Math.floor(r % 60);
        _set('v-clock', (mm < 10 ? '0' : '') + mm + ':' + (ss < 10 ? '0' : '') + ss);
        var fill = document.getElementById('v-fill'); if (fill) fill.style.width = (progress() * 100).toFixed(1) + '%';
    }
    function _set(id, txt) { var e = document.getElementById(id); if (e) e.textContent = txt; }

    // ---- public API --------------------------------------------------------
    window.renderVoyage = function () {
        load();
        loadPoints();
        try { best = parseInt(localStorage.getItem('vulsor_voyage_best') || '0', 10) || 0; } catch (_) {}
        if (!built) { if (!_build()) return; }
        if (!hudBuilt) _buildHud();
        _recolorShip(); _buildPlanet(); _drawFace(); _hud();
        last = performance.now();
        if (!raf) raf = requestAnimationFrame(_frame);
    };
    window.stopVoyage = function () { if (raf) { cancelAnimationFrame(raf); raf = null; } };
})();
