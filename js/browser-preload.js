// ── Browser webview preload ─────────────────────────────────────────────
// Runs in each embedded page at document-start. On Google's sign-in hosts
// the main process presents a Firefox User-Agent, but the underlying engine
// is Chromium — so navigator.userAgentData (Chromium-only) and
// navigator.vendor ("Google Inc.") still leak the real engine and contradict
// the Firefox UA. Google reads those and blocks sign-in ("browser may not be
// secure"). Here we make the in-page fingerprint internally consistent with
// the Firefox identity, which is what Firefox itself exposes.
//
// Loaded with contextIsolation disabled so these overrides apply to the
// page's own JavaScript world.

// ── Force hardware-decodable video (H.264) ──────────────────────────────
// YouTube and other adaptive-streaming sites serve VP9/AV1 by default. Most
// Macs have NO hardware decoder for VP9 (and only the newest for AV1), so those
// codecs are decoded in software on the CPU — which is exactly why video stutters
// and the machine heats up. H.264 has hardware decode (VideoToolbox) on every
// Mac. By reporting VP9/AV1 as unsupported, sites fall back to H.264 and play
// smoothly with far less CPU. (Same idea as the "h264ify" extension.) Runs at
// document-start in every frame so it's in place before the player initialises.
(function () {
    'use strict';
    try {
        var BLOCKED = /vp0?9|av01|av1|dav1/i;  // CPU-decoded codecs (VP9 / AV1)

        // SAFETY: only downgrade VP9/AV1 when a hardware-friendly H.264 path
        // actually exists on this machine. That way we steer sites to the smooth
        // codec when they have it, but we NEVER make a site unplayable — if H.264
        // isn't available (or VP9/AV1 is all a site offers) the originals are used
        // unchanged, so everything still runs.
        var canH264 = false;
        try {
            canH264 = !!(window.MediaSource && MediaSource.isTypeSupported
                && MediaSource.isTypeSupported('video/mp4; codecs="avc1.42E01E"'));
        } catch (_) {}

        if (canH264 && window.MediaSource && typeof MediaSource.isTypeSupported === 'function') {
            var _ist = MediaSource.isTypeSupported.bind(MediaSource);
            MediaSource.isTypeSupported = function (mime) {
                if (mime && BLOCKED.test(mime)) return false;
                return _ist(mime);
            };
        }
        if (canH264 && window.HTMLMediaElement && HTMLMediaElement.prototype.canPlayType) {
            var _cpt = HTMLMediaElement.prototype.canPlayType;
            HTMLMediaElement.prototype.canPlayType = function (mime) {
                if (mime && BLOCKED.test(mime)) return '';
                return _cpt.apply(this, arguments);
            };
        }
        // Modern players pick formats via navigator.mediaCapabilities.decodingInfo.
        // Report VP9/AV1 as "supported but not smooth / not power-efficient" so
        // adaptive players prefer H.264 yet can still fall back to VP9/AV1 when
        // that's the only option (keeps every site playable).
        if (navigator.mediaCapabilities && navigator.mediaCapabilities.decodingInfo) {
            var _di = navigator.mediaCapabilities.decodingInfo.bind(navigator.mediaCapabilities);
            navigator.mediaCapabilities.decodingInfo = function (cfg) {
                try {
                    if (canH264 && cfg && cfg.video && cfg.video.contentType && BLOCKED.test(cfg.video.contentType))
                        return Promise.resolve({ supported: true, smooth: false, powerEfficient: false });
                } catch (_) {}
                return _di(cfg);
            };
        }
    } catch (_) {}
})();

(function () {
    'use strict';
    try {
        var host = (location && location.hostname) || '';
        var isGoogleAuth = /(^|\.)accounts\.(google|youtube)\.com$/i.test(host)
                        || /(^|\.)gds\.google\.com$/i.test(host);

        var def = function (obj, prop, getter) {
            try { Object.defineProperty(obj, prop, { get: getter, configurable: true }); } catch (_) {}
        };

        // Automation signal — keep false everywhere (defensive).
        def(navigator, 'webdriver', function () { return false; });

        if (isGoogleAuth) {
            // Firefox exposes neither the Client Hints API nor a vendor string.
            def(navigator, 'userAgentData', function () { return undefined; });
            def(navigator, 'vendor', function () { return ''; });
        } else {
            // Electron's Client Hints report ONLY "Chromium" — not "Google Chrome".
            // Streaming sites (Prime Video → "unsupported browser", error 7132) read
            // navigator.userAgentData.brands and reject anything that isn't a real
            // consumer browser. Add the "Google Chrome" brand so we pass as Chrome.
            try {
                var uad = navigator.userAgentData;
                if (uad && uad.brands && !uad.brands.some(function (b) { return b.brand === 'Google Chrome'; })) {
                    var maj = '0';
                    uad.brands.forEach(function (b) { if (/chromium/i.test(b.brand)) maj = b.version; });
                    var full = ((navigator.userAgent.match(/Chrome\/([\d.]+)/) || [])[1]) || (maj + '.0.0.0');
                    var brands = [{ brand: 'Not)A;Brand', version: '99' }, { brand: 'Google Chrome', version: maj }, { brand: 'Chromium', version: maj }];
                    var fullList = [{ brand: 'Not)A;Brand', version: '99.0.0.0' }, { brand: 'Google Chrome', version: full }, { brand: 'Chromium', version: full }];
                    var plat = uad.platform || 'macOS';
                    var fake = {
                        brands: brands,
                        mobile: false,
                        platform: plat,
                        getHighEntropyValues: function (hints) {
                            var base = uad.getHighEntropyValues ? uad.getHighEntropyValues(hints) : Promise.resolve({});
                            return base.then(function (v) {
                                v = v || {};
                                v.brands = brands; v.fullVersionList = fullList; v.uaFullVersion = full;
                                if (!v.platform) v.platform = plat;
                                if (!v.architecture) v.architecture = 'arm';
                                if (!v.bitness) v.bitness = '64';
                                if (v.model == null) v.model = '';
                                return v;
                            }).catch(function () {
                                return { brands: brands, fullVersionList: fullList, uaFullVersion: full, platform: plat, mobile: false, architecture: 'arm', bitness: '64', model: '' };
                            });
                        },
                        toJSON: function () { return { brands: brands, mobile: false, platform: plat }; }
                    };
                    def(navigator, 'userAgentData', function () { return fake; });
                }
            } catch (_) {}
        }
    } catch (_) {}
})();

// ── Pop-up / pop-under guard (Brave-style) ──────────────────────────────
// Streaming/piracy sites (123movies, etc.) hijack the play-button click to
// fire many window.open() popunders, then leave a transparent full-page
// overlay that swallows further clicks — so the page becomes "frozen". We
// neutralise this at the source: allow only ONE window.open per genuine user
// gesture (and none without one), and strip click-stealing overlays. Runs in
// the page's own JS world (contextIsolation is disabled for this preload).
(function () {
    'use strict';
    try {
        var lastGesture = 0, opensThisGesture = 0;
        var mark = function () { lastGesture = Date.now(); opensThisGesture = 0; };
        ['pointerdown', 'mousedown', 'keydown', 'touchstart'].forEach(function (t) {
            try { document.addEventListener(t, mark, true); } catch (_) {}
        });

        // A harmless fake window so sites that read the return value (and some
        // anti-adblock checks) don't throw when a popup is blocked.
        var stub = { closed: true, close: function () {}, focus: function () {}, blur: function () {},
                     postMessage: function () {}, moveTo: function () {}, resizeTo: function () {},
                     document: { write: function () {}, writeln: function () {} },
                     location: { href: '', replace: function () {}, assign: function () {} } };

        // Hosts where a cross-origin window.open is legitimately expected (sign-in /
        // payment popups). Everything else cross-origin is treated as a pop-under.
        var AUTH_RE = /(^|\.)(accounts\.google\.com|accounts\.youtube\.com|login\.live\.com|login\.microsoftonline\.com|login\.microsoft\.com|github\.com|gitlab\.com|appleid\.apple\.com|okta\.com|auth0\.com|duosecurity\.com|paypal\.com|facebook\.com|twitter\.com|x\.com|linkedin\.com)$/i;
        var nativeOpen = window.open;
        var guardedOpen = function (url, name, features) {
            var active = false;
            try { active = navigator.userActivation ? navigator.userActivation.isActive : (Date.now() - lastGesture < 1000); }
            catch (_) { active = (Date.now() - lastGesture < 1000); }
            // No real user gesture, or more than one open per gesture → pop-under spam.
            if (!active || opensThisGesture >= 1) return stub;
            // A window.open to a DIFFERENT site is almost always a pop-under ad — this
            // is exactly how 123movies etc. spawn an ad tab on the play/show click,
            // which then leaves a click-catcher that blocks the page. Block it (return
            // a fake window so the page's own script doesn't throw). Same-site opens and
            // known sign-in hosts are allowed. Genuine <a target="_blank"> link clicks
            // never reach here — Chromium opens those natively — so normal "open in new
            // tab" is unaffected.
            var allow = false;
            try {
                if (url && url !== 'about:blank') {
                    var h = new URL(url, location.href).hostname;
                    var base = (location.hostname || '').replace(/^www\./, '');
                    var th = h.replace(/^www\./, '');
                    var sameSite = th === base || th.indexOf('.' + base) === th.length - base.length - 1 || base.indexOf('.' + th) === base.length - th.length - 1;
                    allow = sameSite || AUTH_RE.test(h);
                }
            } catch (_) { allow = false; }
            if (!allow) return stub;
            opensThisGesture++;
            try { return nativeOpen.call(window, url, name, features); } catch (_) { return stub; }
        };
        // getter/setter so a page reassigning window.open is silently ignored
        // (keeps our guard) instead of throwing and breaking the page's script.
        try {
            Object.defineProperty(window, 'open', { get: function () { return guardedOpen; }, set: function () {}, configurable: true });
        } catch (_) { try { window.open = guardedOpen; } catch (_) {} }

        // Structural ad-overlay removal. The reliable signal isn't the wording
        // (sites keep changing it) but the GEOMETRY: a scam box is a positioned,
        // high-z element sitting on top of the video player. We find the player
        // and delete the boxes layered over it. A broad scam-text regex is only
        // used to scope removals that AREN'T over the player (so legit modals on
        // ordinary pages are never touched).
        // STRICT: phrases that essentially only exist on scam overlays — safe to
        // remove anywhere. BROAD: more generic phrases that could appear on legit
        // modals, so they only trigger removal when the box is over the player.
        var STRICT_RE = /not a robot|check the box|to view the (site|content|video)|click\s*["']?allow|press\s*["']?allow|enable\s+(push\s+)?notification/i;
        var BROAD_RE  = /prove you('| a)?re|are you human|human verification|verify (you|that)|please confirm|confirm (to|that|you)|to continue|click\s*["']?(ok|continue)|press\s*["']?ok|over\s?18|18\s?\+/i;
        // NOTIF: fake "browser notification" / push-subscription bait — a small
        // box dressed up as a system notification (bell icon, "now" timestamp,
        // Allow/Block or OK/Cancel buttons) pushing ad-blocker/VPN adware. The
        // copy is distinctive enough to remove anywhere on untrusted sites, and
        // these often sit in a screen corner rather than over the player, so we
        // don't gate it on player overlap.
        var NOTIF_RE = /browse ad[- ]?free|powerful blocking|faster speeds|enha[sn]ced privacy|allow (notifications?|push|to (continue|watch|proceed|view|browse))|click\s*["']?allow to/i;

        // Known ad / pop-under / interstitial networks. Used as a POSITIVE
        // signal: a near-full-screen box on a non-trusted site that holds one of
        // these frames is an ad container — true even after the network blocker
        // has emptied the frame, because the box itself often lingers (blank and
        // click-blocking) on top of the page.
        var AD_HOST_RE = /(^|\.)(doubleclick\.net|googlesyndication\.com|googleadservices\.com|2mdn\.net|adnxs\.com|popads\.net|popcash\.net|propellerads\.com|propu\.sh|exoclick\.com|exosrv\.com|juicyads\.com|adsterra\.com|hilltopads\.(net|com)|mgid\.com|revcontent\.com|taboola\.com|outbrain\.com|trafficjunky\.(com|net)|clickadu\.com|adskeeper\.(com|co\.uk)|bidvertiser\.com|adcash\.com|onclkds\.com|admaven\.com|a-ads\.com|adf\.ly|zedo\.com|media\.net|smartadserver\.com|criteo\.(com|net)|pubmatic\.com|rubiconproject\.com|openx\.net|adroll\.com|moatads\.com|adblade\.com)/i;
        var isAdHost = function (src) {
            if (!src || /^(about:|javascript:|data:)/i.test(src)) return false;
            try { return AD_HOST_RE.test(new URL(src, location.href).hostname); } catch (_) { return false; }
        };
        // Does this box contain an ad-network frame / <ins> ad unit?
        var hasAdFrame = function (el) {
            try {
                if (el.querySelector('ins.adsbygoogle, ins[data-ad-client], ins[data-ad-slot]')) return true;
                var fr = el.querySelectorAll('iframe');
                for (var i = 0; i < fr.length && i < 40; i++) {
                    if (isAdHost(fr[i].getAttribute('src') || fr[i].src || '')) return true;
                }
            } catch (_) {}
            return false;
        };

        // The biggest <video> / player <iframe> on the page (the thing you
        // watch). Ad-network iframes are skipped so an interstitial ad iframe is
        // never mistaken for the player (which would make us protect the overlay
        // around it instead of removing it).
        var findPlayer = function () {
            var best = null, bestArea = 0;
            var list = document.querySelectorAll('video, iframe, embed, object');
            for (var i = 0; i < list.length; i++) {
                if (list[i].tagName === 'IFRAME' && isAdHost(list[i].getAttribute('src') || list[i].src || '')) continue;
                var r = list[i].getBoundingClientRect();
                if (r.width < 250 || r.height < 150) continue;
                var a = r.width * r.height;
                if (a > bestArea) { bestArea = a; best = list[i]; }
            }
            return best;
        };
        var overlapFrac = function (r, pr) {
            var ox = Math.max(0, Math.min(r.right, pr.right) - Math.max(r.left, pr.left));
            var oy = Math.max(0, Math.min(r.bottom, pr.bottom) - Math.max(r.top, pr.top));
            var ea = r.width * r.height;
            return ea > 0 ? (ox * oy) / ea : 0;
        };



        // Mainstream sites manage their own UI and have no scam overlays. This
        // in-page sweep sets pointer-events:none on big transparent layers, which
        // on YouTube disabled the sidebar (clicks fell through to the video and
        // toggled play/pause). Skip it on trusted hosts. The main-process sweep
        // (which only removes the black layer OVER the player and never touches
        // pointer-events) still runs there, so the video still shows.
        var _TRUSTED = /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com|google\.[a-z.]+|gstatic\.com|netflix\.com|spotify\.com|twitch\.tv|vimeo\.com|disneyplus\.com|hbomax\.com|max\.com|primevideo\.com|hulu\.com|wikipedia\.org|github\.com|reddit\.com)$/i;
        var sweepOverlays = function () {
            var _trusted = false;
            try { _trusted = _TRUSTED.test(location.hostname || ''); } catch (_) {}
            try {
                var vw = window.innerWidth, vh = window.innerHeight;
                var player = findPlayer();
                var pr = player ? player.getBoundingClientRect() : null;
                var nodes = document.querySelectorAll('body *');
                // Do every layout READ first, then apply the style WRITES in one
                // batch at the end. Interleaving reads and writes forces a
                // synchronous reflow on every iteration (layout thrashing), which
                // is what made video stutter on busy pages. Read-only loops let
                // the browser compute layout once.
                var hide = [], noClick = [];
                for (var i = 0; i < nodes.length && i < 6000; i++) {
                    var el = nodes[i], cs;
                    if (player && (el === player || el.contains(player) || player.contains(el))) continue;
                    try { cs = getComputedStyle(el); } catch (_) { continue; }
                    if (cs.position !== 'fixed' && cs.position !== 'absolute') continue;
                    var z = parseInt(cs.zIndex, 10) || 0;
                    var r = el.getBoundingClientRect();
                    if (r.width < 24 || r.height < 24) continue;
                    var onPlayer = pr && z >= 1 && overlapFrac(r, pr) > 0.55 && (r.width * r.height) < vw * vh * 0.97;
                    var txt = el.textContent || '';
                    var shortTxt = txt.length <= 240;

                    // (1) Ad-link layer sitting over the player → remove.
                    if (onPlayer && (el.tagName === 'A' || el.tagName === 'INS')) { hide.push(el); continue; }
                    // (2) Scam box: strict phrases anywhere, broad phrases only
                    // when the box is over the player. Hiding the positioned box
                    // removes everything nested inside it (backdrop + dialog).
                    if (shortTxt && (STRICT_RE.test(txt) || (!_trusted && NOTIF_RE.test(txt)) || (onPlayer && BROAD_RE.test(txt)))) { hide.push(el); continue; }
                    // (2b) Interstitial ad overlay: a positioned, near-full-screen,
                    // high-z box that holds an ad-network frame. These pop up right
                    // after you click a film — often before any player exists — and
                    // linger (blank, click-blocking) even after the network blocker
                    // empties the ad frame. Untrusted sites only, so real modals /
                    // cookie banners on ordinary pages are never touched. Positioned
                    // (fixed/absolute) is already enforced above, so normal page
                    // content that merely contains a banner ad is excluded.
                    if (!_trusted && z >= 100 && r.width >= vw * 0.6 && r.height >= vh * 0.6 && hasAdFrame(el)) { hide.push(el); continue; }
                    // (3) Big page-wide layers: hide <a>/<ins> ad layers; disable
                    // clicks on transparent click-catchers.
                    if (z >= 1000 && r.width >= vw * 0.55 && r.height >= vh * 0.55) {
                        if (el.tagName === 'A' || el.tagName === 'INS') hide.push(el);
                        // Skip the pointer-events:none "click-catcher" rule on
                        // trusted sites — on YouTube it disabled the sidebar — and
                        // in sub-frames, where neutralising clicks inside an
                        // arbitrary cross-origin embed (e.g. a payment form) is
                        // riskier than the text-gated scam-box removal above.
                        else if (isTopFrame && !_trusted && (cs.backgroundColor === 'rgba(0, 0, 0, 0)' || parseFloat(cs.opacity || '1') < 0.05)) noClick.push(el);
                    }
                }
                for (var h = 0; h < hide.length; h++)    hide[h].style.setProperty('display', 'none', 'important');
                for (var c = 0; c < noClick.length; c++) noClick[c].style.setProperty('pointer-events', 'none', 'important');
            } catch (_) {}
            killAdAudio();
        };

        // Background audio ads (the "strange sound"): hidden/auto-playing audio
        // or video elements that aren't the movie. On a streaming page we mute
        // everything except the main (largest) video. Only runs when a real
        // player is present, so music sites / normal audio are never muted.
        var killAdAudio = function () {
            try {
                var vids = document.querySelectorAll('video'), main = null, mArea = 0;
                for (var i = 0; i < vids.length; i++) {
                    var r = vids[i].getBoundingClientRect(), a = r.width * r.height;
                    if (a > mArea && r.width >= 250 && r.height >= 150) { mArea = a; main = vids[i]; }
                }
                var bigEmbed = false, fr = document.querySelectorAll('iframe,embed,object');
                for (var j = 0; j < fr.length; j++) { var rr = fr[j].getBoundingClientRect(); if (rr.width >= 250 && rr.height >= 150) { bigEmbed = true; break; } }
                if (!main && !bigEmbed) return;   // not a video page — leave audio alone
                var media = document.querySelectorAll('audio, video');
                for (var k = 0; k < media.length; k++) {
                    var m = media[k];
                    if (m === main) continue;     // keep the movie's sound
                    try { m.muted = true; m.volume = 0; } catch (_) {}
                }
            } catch (_) {}
        };

        // These ad overlays appear AFTER you click play, so a one-shot sweep
        // isn't enough: watch the DOM and re-sweep on changes. But the sweep is
        // heavy (walks the DOM, reads layout), and a video page mutates its DOM
        // constantly during playback — running it on every burst froze frames.
        // So: coalesce bursts, enforce a minimum gap between runs, run the work
        // during browser IDLE time (so it never competes with video frames), and
        // skip entirely while the tab is hidden.
        var sweepScheduled = false, lastSweep = 0;
        var MIN_GAP = 1500;   // ms — never sweep more often than this
        var ric = window.requestIdleCallback || function (cb) {
            return setTimeout(function () { cb({ timeRemaining: function () { return 16; } }); }, 120);
        };
        var runSweep = function () { sweepScheduled = false; lastSweep = Date.now(); sweepOverlays(); };
        var scheduleSweep = function () {
            if (sweepScheduled || document.hidden) return;
            sweepScheduled = true;
            var wait = Math.max(0, MIN_GAP - (Date.now() - lastSweep));
            setTimeout(function () { ric(runSweep, { timeout: 2000 }); }, wait);
        };
        // The over-the-player overlays live in the TOP document, but scam popups
        // are just as often served INSIDE a cross-origin ad iframe (e.g. the
        // "Browse ad-free / powerful blocking" push-notification bait). The
        // parent's sweep can't read into a cross-origin frame, so that popup would
        // survive — but this preload runs inside every sub-frame too, so we let
        // each frame clean its OWN document. The sweep is text-gated (NOTIF/STRICT
        // rules), so an idle ad frame does almost no work; sub-frames just use a
        // longer safety-net interval to keep cumulative CPU negligible.
        var isTopFrame = true;
        try { isTopFrame = (window.top === window); } catch (_) { isTopFrame = true; }
        try {
            var mo = new MutationObserver(scheduleSweep);
            var startMo = function () { try { mo.observe(document.documentElement || document.body, { childList: true, subtree: true }); } catch (_) {} };
            if (document.body) startMo(); else document.addEventListener('DOMContentLoaded', startMo, true);
        } catch (_) {}
        // Periodic safety net (catches overlays added without DOM mutations the
        // observer sees), routed through the same coalesced/idle path.
        setInterval(function () { if (!document.hidden) scheduleSweep(); }, isTopFrame ? 4000 : 6000);
        try { document.addEventListener('DOMContentLoaded', scheduleSweep, true); } catch (_) {}
    } catch (_) {}
})();

// ── Kill ad "buzzing" / synthesised Web Audio (Brave-style) ─────────────
// Ads and anti-adblock scripts make a buzzing/beeping tone with the Web Audio
// API (OscillatorNode / AudioBufferSourceNode). Movies and music play through
// the <video>/<audio> element's NATIVE audio, never synthesised sources — so we
// no-op AudioScheduledSourceNode.start() at document-start. The per-call check
// only blocks it when the frame is showing a video, so web games/synths on
// ordinary pages are untouched. Running at document-start means the buzzer is
// silenced from the very first frame of a fresh page load.
(function () {
    'use strict';
    try {
        var S = window.AudioScheduledSourceNode;
        if (S && S.prototype && S.prototype.start) {
            var _start = S.prototype.start;
            S.prototype.start = function () {
                try {
                    var streaming = false, v = document.querySelectorAll('video,iframe,embed,object');
                    for (var i = 0; i < v.length; i++) { var r = v[i].getBoundingClientRect(); if (r.width >= 250 && r.height >= 150) { streaming = true; break; } }
                    if (streaming) { try { this.disconnect && this.disconnect(); } catch (_) {} return; }
                } catch (_) {}
                return _start.apply(this, arguments);
            };
        }
    } catch (_) {}
})();

// ── Tame modal dialogs (Brave-style) ────────────────────────────────────
// alert()/confirm()/prompt()/print() are window-modal — an abusive page that
// spams them freezes the ENTIRE app (you can't type anywhere until you click
// through each one). Throttle them: allow a couple, then suppress the rest.
// Also neuter beforeunload so a page can't trap you on it.
(function () {
    'use strict';
    try {
        var n = 0, t = 0;
        var wrap = function (orig, blocked) {
            return function () {
                var now = Date.now();
                if (now - t > 8000) { n = 0; t = now; }
                if (++n > 2) return blocked;          // suppress spam after 2 in 8s
                try { return orig.apply(this, arguments); } catch (_) { return blocked; }
            };
        };
        if (window.alert)   window.alert   = wrap(window.alert,   undefined);
        if (window.confirm) window.confirm = wrap(window.confirm, false);
        if (window.prompt)  window.prompt  = wrap(window.prompt,  null);
        if (window.print)   window.print   = wrap(window.print,   undefined);
        try { Object.defineProperty(window, 'onbeforeunload', { get: function () { return null; }, set: function () {}, configurable: true }); } catch (_) {}
        var ael = window.addEventListener;
        window.addEventListener = function (type) {
            if (String(type).toLowerCase() === 'beforeunload') return;   // ignore unload traps
            return ael.apply(this, arguments);
        };
    } catch (_) {}
})();

// ── YouTube ad blocker (response-level: ads never load) ─────────────────
// Instead of letting an ad start and then clicking "Skip" (which sometimes
// misses), we remove the ads at the SOURCE: YouTube fetches the video from
// /youtubei/v1/player, and that JSON carries the ad list (adPlacements /
// playerAds / adSlots …). We delete those fields before the player reads the
// response, so the player is never told there's an ad — nothing plays, nothing
// to skip. This only edits the ad fields of the player JSON; it never touches
// the actual video stream, so playback is unaffected (no black screen), and it
// runs entirely in the page (not the main process), so it can't cause crashes.
(function () {
    'use strict';
    try {
        if (!/(^|\.)youtube\.com$/i.test(location.hostname || '')) return;

        // Ad payload fields removed from the player JSON. Kept deliberately narrow
        // and shallow: this is the exact set/traversal that strips ads WITHOUT
        // breaking playback. (A broader deep-prune was tried and caused black
        // screens, so the anti-detection work below is done at the DOM/config
        // layer instead, where it can't touch the video stream.)
        var AD_FIELDS = ['adPlacements', 'playerAds', 'adSlots', 'adBreakHeartbeatParams', 'adParams'];
        var prune = function (o, depth) {
            if (!o || typeof o !== 'object' || (depth || 0) > 4) return;
            for (var i = 0; i < AD_FIELDS.length; i++) { try { if (o[AD_FIELDS[i]] != null) delete o[AD_FIELDS[i]]; } catch (_) {} }
            if (o.playerResponse) prune(o.playerResponse, (depth || 0) + 1);
            if (o.response) prune(o.response, (depth || 0) + 1);
        };

        // Disable the anti-adblock popup at the config level too. YouTube reads
        // yt.config_.openPopupConfig.supportedPopups.adBlockMessageViewModel to
        // decide whether to show the wall; forcing it off is belt-and-suspenders
        // alongside the response-level strip above.
        var killWallConfig = function () {
            try {
                var cfgs = [window.yt && window.yt.config_, window.ytcfg && window.ytcfg.data_];
                for (var i = 0; i < cfgs.length; i++) {
                    var c = cfgs[i];
                    var sp = c && c.openPopupConfig && c.openPopupConfig.supportedPopups;
                    if (sp && 'adBlockMessageViewModel' in sp) sp.adBlockMessageViewModel = false;
                }
            } catch (_) {}
        };

        // YouTube's "Before you continue to YouTube" CONSENT overlay covers the
        // whole watch page with a backdrop that swallows EVERY click — so the
        // video plays but you can't open anything in the sidebar. Its dismiss
        // buttons are unreliable (duplicate forms, the dialog lingers at
        // opacity:0 and keeps intercepting). So: click a dismiss button to record
        // the choice, then hard-remove the consent dialog + its backdrop and
        // restore page scrolling so the sidebar (and the rest of the page) is
        // clickable again. SCOPED to the consent overlay only — we never touch
        // YouTube's normal dialogs (share / save / settings) or their backdrops.
        var killConsent = function () {
            try {
                var dlg = document.querySelector('ytd-consent-bump-v2-lightbox, tp-yt-paper-dialog.eom-v1-dialog');
                if (!dlg) return;
                try {
                    var btns = dlg.querySelectorAll('button, tp-yt-paper-button');
                    for (var i = 0; i < btns.length; i++) {
                        if (/reject all|accept all|i agree/i.test(btns[i].textContent || '')) { try { btns[i].click(); } catch (_) {} break; }
                    }
                } catch (_) {}
                try { dlg.remove(); } catch (_) {}
                // Remove ONLY backdrops while a consent dialog exists in the DOM.
                try {
                    var bds = document.querySelectorAll('tp-yt-iron-overlay-backdrop');
                    for (var b = 0; b < bds.length; b++) { try { bds[b].remove(); } catch (_) {} }
                } catch (_) {}
                try { document.documentElement.style.overflow = ''; if (document.body) document.body.style.overflow = ''; } catch (_) {}
            } catch (_) {}
        };

        // "Ad blockers violate YouTube's Terms of Service" ENFORCEMENT wall.
        // YouTube pops a modal (ytd-enforcement-message-view-model, "Allow YouTube
        // ads" / "Try YouTube Premium") that pauses playback until you allowlist.
        // Tear it down at the DOM layer (the memory-endorsed approach — killWallConfig
        // above only sets the config flag, which YouTube no longer fully honors):
        // remove the enforcement dialog + its host popup + the backdrop, restore page
        // scroll, and resume the paused player. SCOPED by ytd-enforcement-message-
        // view-model, which no legitimate YouTube dialog uses — so share / save /
        // settings dialogs are never touched.
        var killWall = function () {
            try {
                var enf = document.querySelector('ytd-enforcement-message-view-model');
                if (!enf) return;
                var host = enf.closest('tp-yt-paper-dialog, ytd-popup-container') || enf;
                try { enf.remove(); } catch (_) {}
                try { if (host && host !== enf) host.remove(); } catch (_) {}
                try {
                    var bds = document.querySelectorAll('tp-yt-iron-overlay-backdrop');
                    for (var b = 0; b < bds.length; b++) { try { bds[b].remove(); } catch (_) {} }
                } catch (_) {}
                try { document.documentElement.style.overflow = ''; if (document.body) document.body.style.overflow = ''; } catch (_) {}
                // The wall pauses the player — resume it.
                var mp = document.getElementById('movie_player');
                var v = mp ? mp.querySelector('video') : document.querySelector('video');
                try { if (v && v.paused) v.play().catch(function () {}); } catch (_) {}
                try { if (mp && mp.playVideo) mp.playVideo(); } catch (_) {}
            } catch (_) {}
        };

        // Response-level ad strip is DISABLED and must stay off in this build.
        // Verified by CDP testing (2026-06-30): pruning the /youtubei/v1/player
        // JSON — in ANY form (new Response, .json() wrapper, .text() wrapper) —
        // leaves the video stuck at readyState 0 (black screen). This castlabs
        // Electron build's player rejects the modified player response. Pure
        // passthrough plays perfectly. So we do NOT touch the player JSON.
        var STRIP_PLAYER_JSON = false;
        if (STRIP_PLAYER_JSON) {
            // 1) Wrap the player/next API responses (the SPA path).
            try {
                var _fetch = window.fetch;
                if (typeof _fetch === 'function') {
                    window.fetch = function (input, init) {
                        var url = '';
                        try { url = (typeof input === 'string') ? input : (input && input.url) || ''; } catch (_) {}
                        var pr = _fetch.apply(this, arguments);
                        if (!/\/youtubei\/v1\/(player|next|reel_item_watch)/.test(url)) return pr;
                        return pr.then(function (res) {
                            try {
                                // Wrap ONLY .json(): it mutates the PARSED object and
                                // returns it — no JSON.stringify, so we never alter the
                                // raw response bytes (re-serializing broke playback,
                                // readyState stuck at 0). We deliberately do NOT wrap
                                // .text() for the same reason.
                                var _json = res.json.bind(res);
                                res.json = function () { return _json().then(function (d) { try { prune(d); } catch (_) {} return d; }); };
                            } catch (_) {}
                            return res;
                        });
                    };
                }
            } catch (_) {}

            // 2) Strip ads from the response embedded in the first page load.
            // This mutates the object in place (no Response involved) — safe.
            try {
                var hidden = window.ytInitialPlayerResponse;
                if (hidden) prune(hidden);
                Object.defineProperty(window, 'ytInitialPlayerResponse', {
                    configurable: true,
                    get: function () { return hidden; },
                    set: function (v) { try { prune(v); } catch (_) {} hidden = v; }
                });
            } catch (_) {}
        }

        // 3) Watchdog (top frame only). Does NOTHING during normal playback; only
        // acts while a video ad is showing. Two ad-skip steps, both of which look
        // like normal player actions to YouTube (they block no request and remove
        // no ad DOM, so they don't trip the "Ad blockers are not allowed" wall — that
        // is what an earlier ad-container-removal approach did, and it's why the
        // response-level JSON strip stays off, see STRIP_PLAYER_JSON above):
        //   a) click YouTube's OWN "Skip Ad" button when present (skippable ads);
        //   b) for NON-skippable ads (no button), the ad plays through the SAME
        //      <video> element, so seeking it to its end makes YouTube treat the ad
        //      as finished and cut straight to the content. This just simulates the
        //      ad reaching its end — the fix the user asked for ("skip the video").
        // We restore playbackRate afterwards so the content video plays at 1x. This
        // is strictly gated on ad-showing, so it never fights the user's controls
        // during real playback (the reason the previous seek-everywhere was removed).
        if (window.top === window) {
            var tick = function () {
                try {
                    killWallConfig();
                    killConsent();
                    killWall();
                    var p = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
                    if (p && p.classList && p.classList.contains('ad-showing')) {
                        // a) click YouTube's OWN Skip button (skippable ads).
                        var btn = document.querySelector('.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button, .ytp-ad-skip-button-container button, .ytp-ad-overlay-close-button');
                        if (btn) { try { btn.click(); } catch (_) {} }
                        // b) NON-skippable ads (no button): the ad plays through the
                        // SAME <video>, so jumping it to its end makes YouTube treat
                        // the ad as finished and cut to content. If this ever provokes
                        // the enforcement wall, killWall() above removes it and resumes.
                        var v = p.querySelector('video');
                        if (v) {
                            try { v.muted = true; } catch (_) {}   // silence the ad while it's fast-forwarded
                            var d = v.duration;
                            if (isFinite(d) && d > 0 && v.currentTime < d - 0.3) { try { v.currentTime = d; } catch (_) {} }
                        }
                    }
                } catch (_) {}
            };
            var iv = setInterval(tick, 300); tick();
            window.addEventListener('unload', function () { try { clearInterval(iv); } catch (_) {} });
        }
    } catch (_) {}
})();
