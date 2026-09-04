// ── Entry Point ────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    try {
        // Assign shared DOM refs
        chatBox     = document.getElementById('chat-box');
        userInput   = document.getElementById('user-input');
        sessionList = document.getElementById('session-list');

        // ══════════════════════════════════════════════════════
        // ── Browser-style Tab Management ─────────────────────
        // ══════════════════════════════════════════════════════

        const ALL_VIEWS = ['home', 'chat', 'todos', 'study', 'vault', 'finance', 'journal', 'lab', 'recipes', 'books', 'writer', 'learn', 'countdown', 'audiobook', 'calendar', 'music', 'karaoke', 'chess', 'tuner', 'workout', 'news', 'courses', 'research', 'cosmos', 'galaxy', 'voyage', 'camera', 'editor', 'mail', 'browser', 'rts', 'network', 'sudoku', 'settings'];
        const chatToolbar = document.getElementById('chat-toolbar');

        // Apps that can have multiple simultaneous tabs
        const MULTI_INSTANCE_APPS = new Set(['vault', 'chat']);

        // App definitions for Home page + tab favicons
        const APP_DEFS = {
            home:     { label: 'New Tab',  icon: 'fa-home',          color: '#475569' },
            chat:     { label: 'Chat',     icon: 'fa-comments',      color: 'var(--accent,#dc2626)' },
            todos:    { label: 'To-Do',    icon: 'fa-check-square',  color: '#10b981' },
            study:    { label: 'Study',    icon: 'fa-graduation-cap',color: '#f59e0b' },
            vault:    { label: 'Vault',    icon: 'fa-folder-open',   color: '#3b82f6' },
            finance:  { label: 'Finance',  icon: 'fa-wallet',        color: '#8b5cf6' },
            journal:  { label: 'Journal',  icon: 'fa-book-open',     color: '#ec4899' },
            lab:      { label: 'Lab',      icon: 'fa-flask',         color: '#14b8a6' },
            recipes:  { label: 'Recipes',  icon: 'fa-utensils',      color: '#f97316' },
            books:    { label: 'Books',    icon: 'fa-book',          color: '#b45309' },
            writer:   { label: 'Writer',   icon: 'fa-pen-nib',       color: '#e11d48' },
            learn:    { label: 'Learn',    icon: 'fa-lightbulb',     color: '#84cc16' },
            countdown:{ label: 'Countdown',icon: 'fa-hourglass-half',color: '#eab308' },
            audiobook:{ label: 'Audiobooks',icon: 'fa-headphones',   color: '#8b5cf6' },
            calendar: { label: 'Calendar', icon: 'fa-calendar-alt',  color: '#0891b2' },
            music:    { label: 'Music',    icon: 'fa-headphones',    color: '#f43f5e' },
            karaoke:  { label: 'Karaoke',  icon: 'fa-microphone',    color: '#a855f7' },
            chess:    { label: 'Chess',    icon: 'fa-chess-knight',  color: '#d97706' },
            tuner:    { label: 'Tuner',    icon: 'fa-sliders-h',     color: '#f43f5e' },
            workout:  { label: 'Workouts', icon: 'fa-dumbbell',      color: '#10b981' },
            news:     { label: 'News',     icon: 'fa-newspaper',     color: '#dc2626' },
            courses:  { label: 'Courses',  icon: 'fa-chalkboard-teacher', color: '#6366f1' },
            research: { label: 'Research',  icon: 'fa-brain',          color: '#8b5cf6' },
            cosmos:   { label: 'Cosmos',    icon: 'fa-meteor',         color: '#6366f1' },
            galaxy:   { label: 'Galaxy',    icon: 'fa-rocket',         color: '#a855f7' },
            voyage:   { label: 'Voyage',    icon: 'fa-user-astronaut', color: '#06b6d4' },
            camera:   { label: 'Camera',    icon: 'fa-video',          color: '#ef4444' },
            editor:   { label: 'Editor',    icon: 'fa-film',           color: '#f59e0b' },
            mail:     { label: 'Mail',      icon: 'fa-envelope',       color: '#0ea5e9' },
            browser:  { label: 'Browser',   icon: 'fa-globe',          color: '#38bdf8' },
            rts:      { label: 'Calculator', icon: 'fa-calculator',     color: '#6366f1' },
            network:  { label: 'Network',   icon: 'fa-network-wired',  color: '#22d3ee' },
            sudoku:   { label: 'Sudoku',    icon: 'fa-table-cells',    color: '#14b8a6' },
            settings: { label: 'Settings',  icon: 'fa-gear',           color: '#64748b' },
        };

        // ── State ──────────────────────────────────────────────
        let _tabs     = [];   // [{ id, key, label?, instanceData }]
        let _activeId = null;
        let _tabIdSeq = 0;

        function _makeId() { return 'bt' + (++_tabIdSeq); }

        // ── Tab label for duplicates ────────────────────────────
        function _tabLabel(tab) {
            // Browser tabs are labelled with the live page title / favicon.
            if (tab.key === 'browser') {
                const m = window.bwMeta && window.bwMeta(tab.instanceData && tab.instanceData.bwId);
                return (m && (m.title || m.url)) || (tab.instanceData && tab.instanceData.private ? 'Private Tab' : 'New Tab');
            }
            if (tab.label) return tab.label; // custom label (e.g. folder name)
            const def = APP_DEFS[tab.key] || APP_DEFS.home;
            if (!MULTI_INSTANCE_APPS.has(tab.key)) return def.label;
            // Count how many tabs of same key exist before this one
            const idx = _tabs.filter(t => t.key === tab.key).indexOf(tab);
            return idx > 0 ? `${def.label} ${idx + 1}` : def.label;
        }

        // ── Vault per-tab state ─────────────────────────────────
        function _saveVaultTabState(tab) {
            let altScrollTop = null;
            if (!vaultIsPDF && !vaultIsPPTX) {
                try {
                    const altEl = document.getElementById('vault-content-alt');
                    const inner = altEl && altEl.querySelector('.overflow-y-auto, .overflow-auto');
                    if (inner) altScrollTop = inner.scrollTop || null;
                } catch(_) {}
            }
            tab.instanceData = {
                activeFolderId: vaultActiveFolderId,
                openFileId:     vaultOpenFileId,   // null means no file open
                pdfPage:        vaultIsPDF  ? pdfPageNum       : null,
                pptxSlide:      vaultIsPPTX ? pptxCurrentSlide : null,
                altScrollTop,
            };
        }
        function _restoreVaultTabState(tab) {
            const d          = tab.instanceData || {};
            const wantFileId = d.openFileId || null;

            // ── Fast path: the exact same file is already open ──────────
            // This happens when switching away from vault and back without
            // any other vault tab in between. Skip the expensive close→reopen
            // cycle so canvases / RAF loops are never torn down unnecessarily.
            if (wantFileId && wantFileId === vaultOpenFileId) {
                vaultActiveFolderId = d.activeFolderId ?? null;
                try { renderVaultFolders(); renderVaultGrid(); } catch(_) {}
                // Restore scroll/slide for the already-open file
                if (d.pdfPage && d.pdfPage > 1) {
                    try { scrollToPage(d.pdfPage); } catch(_) {}
                } else if (d.pptxSlide) {
                    try { pptxGoTo(d.pptxSlide); } catch(_) {}
                } else if (d.altScrollTop) {
                    try {
                        const altEl = document.getElementById('vault-content-alt');
                        const inner = altEl && altEl.querySelector('.overflow-y-auto, .overflow-auto');
                        if (inner) inner.scrollTop = d.altScrollTop;
                    } catch(_) {}
                }
                return;
            }

            // ── Close whatever is currently open (saves any unsaved edits) ─
            if (vaultOpenFileId) {
                try { if (typeof closeVaultViewer === 'function') closeVaultViewer(); } catch(_) {}
            }

            // ── Restore folder position & grid ──────────────────────────
            vaultActiveFolderId = d.activeFolderId ?? null;
            try { renderVaultFolders(); renderVaultGrid(); } catch(_) {}

            // ── Re-open file or show plain grid ─────────────────────────
            if (wantFileId) {
                // Signal async loaders to jump to saved position after loading
                if (d.pdfPage  && d.pdfPage > 1)  vaultPendingScrollPage = d.pdfPage;
                if (d.pptxSlide != null)            vaultPendingPPTXSlide  = d.pptxSlide;
                try { openVaultFile(wantFileId); } catch(_) {}
                // For text/image files the DOM is ready synchronously; restore scroll next tick
                if (d.altScrollTop) {
                    setTimeout(() => {
                        try {
                            const altEl = document.getElementById('vault-content-alt');
                            const inner = altEl && altEl.querySelector('.overflow-y-auto, .overflow-auto');
                            if (inner) inner.scrollTop = d.altScrollTop;
                        } catch(_) {}
                    }, 0);
                }
            } else {
                const vv = document.getElementById('vault-viewer-view');
                const gv = document.getElementById('vault-grid-view');
                if (vv) vv.style.display = 'none';
                if (gv) gv.style.display = '';
            }
        }

        // ── Activate a view key ─────────────────────────────────
        function _activateView(key) {
            // Stop tuner mic when leaving the tuner view
            if (key !== 'tuner' && typeof tunerStop === 'function') tunerStop();

            ALL_VIEWS.forEach(v => {
                const el = document.getElementById(`view-${v}`);
                if (el) el.classList.toggle('active', v === key);
            });
            // Legacy hidden tab buttons
            ALL_VIEWS.forEach(v => {
                const btn = document.getElementById(`tab-${v}`);
                if (btn) btn.classList.toggle('active', v === key);
            });

            // Chat toolbar + sidebar visibility
            if (chatToolbar) chatToolbar.style.display = key === 'chat' ? '' : 'none';

            // Music player bar
            const musicBar = document.getElementById('music-player-bar');
            if (musicBar) {
                if (key === 'music') {
                    const audio = document.getElementById('music-audio');
                    musicBar.style.display = (audio && audio.src && audio.src !== window.location.href) ? 'flex' : 'none';
                } else {
                    musicBar.style.display = 'none';
                }
            }

            // Render functions
            if (key === 'home')     { _updateHomeGreeting(); renderHomeWeather();
                // Browser-style: focus the search bar when landing on a new tab
                setTimeout(() => { const o = document.getElementById('home-omnibox-input'); if (o) o.focus(); }, 60); }
            if (key === 'todos')    renderTodos();
            if (key === 'study')    { renderLog(); renderStats(); renderSubjects(); renderSubjectSelect(); }
            if (key === 'finance')  { renderFinanceSummary(); renderTransactions(); renderRecurring(); renderFinanceChart(); }
            if (key === 'journal')  { renderJournalEditor(); renderJournalSidebar(); }
            if (key === 'lab')      { if (typeof renderLab === 'function') renderLab(); }
            if (key === 'recipes')  { if (typeof renderRecipes === 'function') renderRecipes(); }
            if (key === 'books')    { if (typeof renderBooks === 'function') renderBooks(); }
            if (key === 'writer')   { if (typeof renderWriter === 'function') renderWriter(); }
            if (key === 'learn')    { if (typeof renderLearn === 'function') renderLearn(); }
            if (key === 'countdown'){ if (typeof renderCountdowns === 'function') renderCountdowns(); }
            if (key === 'audiobook'){ if (typeof renderAudiobook === 'function') renderAudiobook(); }
            if (key !== 'audiobook' && typeof audiobookStop === 'function') audiobookStop();
            if (key === 'calendar') renderCalPage();
            if (key === 'music')    renderMusic();
            if (key === 'karaoke')  renderKaraoke();
            if (key === 'chess')    { if (typeof renderChess === 'function') renderChess(); }
            if (key === 'tuner')   { if (typeof renderTuner === 'function') renderTuner(); }
            if (key === 'workout')  { if (typeof renderWorkout  === 'function') renderWorkout(); }
            if (key === 'news')     { if (typeof renderNewsView === 'function') renderNewsView(); }
            if (key === 'courses')  { if (typeof renderCoursesView === 'function') renderCoursesView(); }
            if (key === 'research') { if (typeof renderResearch === 'function') renderResearch(); }
            if (key === 'cosmos')   { if (typeof renderCosmos   === 'function') renderCosmos(); }
            if (key === 'galaxy')   { if (typeof renderGalaxySim === 'function') renderGalaxySim(); }
            if (key !== 'galaxy'    && typeof stopGalaxySim === 'function') stopGalaxySim();
            if (key === 'voyage')   { if (typeof renderVoyage === 'function') renderVoyage(); }
            if (key !== 'voyage'    && typeof stopVoyage === 'function') stopVoyage();
            if (key === 'camera')   { if (typeof renderCamera   === 'function') renderCamera(); }
            if (key !== 'camera'    && typeof cameraStopAll === 'function') cameraStopAll();
            if (key === 'editor')   { if (typeof renderEditor   === 'function') renderEditor(); }
            if (key === 'mail')     { if (typeof renderMail     === 'function') renderMail(); }
            if (key === 'browser')  {
                if (typeof renderBrowser === 'function') renderBrowser();
                const bt = _tabs.find(t => t.id === _activeId);
                if (bt && bt.instanceData && bt.instanceData.bwId && window.bwActivate) window.bwActivate(bt.instanceData.bwId);
            }
            if (key === 'rts')      { calcReset && calcReset(); }
            if (key === 'network')  { if (typeof renderNetwork === 'function') renderNetwork(); }
            if (key === 'settings') { if (typeof renderSettingsPage === 'function') renderSettingsPage(); }
            if (key === 'sudoku')   { if (typeof renderSudoku  === 'function') renderSudoku(); }

            // Address bar
            const tab  = _tabs.find(t => t.id === _activeId);
            const lbl  = tab ? _tabLabel(tab) : (APP_DEFS[key] || APP_DEFS.home).label;
            const def  = APP_DEFS[key] || APP_DEFS.home;
            const addrText = document.getElementById('browser-addr-text');
            const addrIcon = document.getElementById('browser-addr-icon');
            if (addrText) addrText.textContent = key === 'home' ? 'Vulsor · New Tab' : `Vulsor · ${lbl}`;
            if (addrIcon) {
                addrIcon.className = `fas ${def.icon}`;
                addrIcon.style.fontSize = '10px';
                addrIcon.style.color = key === 'home' ? '#475569' : def.color;
            }

            if (key === 'home') _updateHomeGreeting();
        }

        // ══════════════════════════════════════════════════════
        // ── Chrome-style drag system ─────────────────────────
        // ══════════════════════════════════════════════════════
        const { ipcRenderer } = require('electron');

        let _drag = null;
        const DRAG_DEADZONE = 4;
        const TEAROUT_BELOW = 50;  // px below strip → tear into new window
        const TEAROUT_ABOVE = 14;  // px above strip top → tear

        // External-drop state (when a tab from another window is being dragged over)
        let _externalDrop = null;

        function _cleanDragStyles() {
            document.querySelectorAll('.browser-tab').forEach(t => {
                t.style.transform = '';
                t.style.transition = '';
                t.style.opacity = '';
                t.style.zIndex = '';
                t.classList.remove('tab-dragging-active');
            });
        }

        // Repainting the strip mid-drag was the main reason tearing a tab out
        // "didn't always work". _paintTabStrip() rebuilds every tab element from
        // scratch, so the node under the pointer got destroyed and the drag died
        // silently — and web tabs ask for a repaint on every favicon, title and
        // loading change, which is exactly why it only failed sometimes: it
        // depended on whether a page happened to be loading at that moment.
        // Repaints asked for during a drag are held and applied once it ends.
        let _stripDirty = false;
        function _renderTabStrip() {
            if (_drag) { _stripDirty = true; return; }
            _stripDirty = false;
            _paintTabStrip();
        }
        function _flushStripAfterDrag() {
            if (!_stripDirty) return;
            _stripDirty = false;
            _paintTabStrip();
        }

        function _paintTabStrip() {
            const container = document.getElementById('open-tabs-container');
            if (!container) return;
            // Preserve the + button across the rebuild and re-append it after the
            // tabs so it always follows the last (newest) tab.
            const newTabBtn = document.getElementById('new-tab-btn');
            if (newTabBtn) newTabBtn.remove();
            container.innerHTML = '';

            _tabs.forEach(tab => {
                const def      = APP_DEFS[tab.key] || APP_DEFS.home;
                const isActive = tab.id === _activeId;
                const label    = _tabLabel(tab);

                const el = document.createElement('div');
                el.className = 'browser-tab' + (isActive ? ' active' : '');
                el.dataset.tabId = tab.id;

                // Browser tabs show the page's favicon / loading spinner; app
                // tabs show their fixed app icon.
                let iconHtml;
                if (tab.key === 'browser') {
                    const m = (window.bwMeta && window.bwMeta(tab.instanceData && tab.instanceData.bwId)) || {};
                    if (m.loading)
                        iconHtml = `<span class="tab-favicon" style="background:transparent"><i class="fas fa-circle-notch fa-spin" style="font-size:9px; color:#818cf8"></i></span>`;
                    else if (m.favicon)
                        iconHtml = `<span class="tab-favicon" style="background:transparent"><img src="${m.favicon.replace(/"/g,'&quot;')}" style="width:14px; height:14px; border-radius:3px; object-fit:cover" onerror="this.style.display='none'"></span>`;
                    else
                        iconHtml = `<span class="tab-favicon" style="background:${m.private?'rgba(168,85,247,0.12)':def.color+'20'}; color:${m.private?'#c084fc':def.color}"><i class="fas ${m.private?'fa-user-secret':'fa-globe'}" style="font-size:9px"></i></span>`;
                } else {
                    iconHtml = `<span class="tab-favicon" style="background:${def.color}20; color:${def.color}"><i class="fas ${def.icon}" style="font-size:9px"></i></span>`;
                }

                el.innerHTML = `
                    ${iconHtml}
                    <span class="tab-label"></span>
                    <button class="tab-close-btn" title="Close tab" data-close-id="${tab.id}">
                        <i class="fas fa-times" style="font-size:8px"></i>
                    </button>
                `;
                // Page titles can contain HTML metacharacters — set as text.
                el.querySelector('.tab-label').textContent = label;
                el.title = label;

                el.querySelector('.tab-close-btn').addEventListener('click', e => {
                    e.stopPropagation(); e.preventDefault();
                    _closeTab(tab.id);
                });
                el.addEventListener('auxclick', e => {
                    if (e.button === 1) _closeTab(tab.id);
                });

                _attachDragHandlers(el, tab);
                container.appendChild(el);
            });

            if (newTabBtn) container.appendChild(newTabBtn);
        }

        // Write a tab's live view state into its instanceData. The active tab's
        // state — which vault file is open, which PDF page, where it's scrolled —
        // lives in the view, not on the tab object, and was only ever written when
        // switching AWAY from it. So tearing out the tab you were looking at carried
        // stale or empty state, and the new window came up on the wrong page.
        function _captureTabState(tab) {
            if (!tab || tab.id !== _activeId) return;   // only the active tab has live state
            if (tab.key === 'vault') _saveVaultTabState(tab);
        }

        // Only pointerdown is bound to the tab element. Move/up/cancel go on the
        // window for the life of the drag: they keep firing when the pointer leaves
        // the window, and they don't live on a DOM node that could be replaced
        // underneath us.
        function _attachDragHandlers(el, tab) {
            el.addEventListener('pointerdown', e => {
                if (e.button !== 0) return;
                if (e.target.closest('.tab-close-btn')) return;
                e.preventDefault();

                const container = document.getElementById('open-tabs-container');
                const allEls = [...container.querySelectorAll('.browser-tab')];
                const draggedIdx = _tabs.findIndex(t => t.id === tab.id);
                const stripRect = container.getBoundingClientRect();
                const rect = el.getBoundingClientRect();
                const homeCenters = allEls.map(t => {
                    const r = t.getBoundingClientRect();
                    return (r.left + r.right) / 2;
                });

                _drag = {
                    pointerId: e.pointerId,
                    tabId: tab.id, tab, el, allEls,
                    draggedIdx,
                    homeCenters,
                    tabWidth: rect.width,
                    startClientX: e.clientX, startClientY: e.clientY,
                    grabOffsetX: e.clientX - rect.left,
                    stripTop: stripRect.top, stripBottom: stripRect.bottom,
                    moved: false,
                    mode: 'strip',
                    currentDropIdx: draggedIdx,
                };
                window.addEventListener('pointermove',   _onDragMove);
                window.addEventListener('pointerup',     _onDragUp);
                window.addEventListener('pointercancel', _onDragCancel);
            });
        }

        function _releaseDragListeners() {
            window.removeEventListener('pointermove',   _onDragMove);
            window.removeEventListener('pointerup',     _onDragUp);
            window.removeEventListener('pointercancel', _onDragCancel);
        }

        function _onDragMove(e) {
            if (!_drag || e.pointerId !== _drag.pointerId) return;
            const tab = _drag.tab;
            const dx = e.clientX - _drag.startClientX;
            const dy = e.clientY - _drag.startClientY;

            if (!_drag.moved && Math.abs(dx) < DRAG_DEADZONE && Math.abs(dy) < DRAG_DEADZONE) return;

            if (!_drag.moved) {
                _drag.moved = true;
                // Freeze the tab's state into instanceData now, so whatever the
                // tab is showing travels with it.
                _captureTabState(tab);
                _drag.el.style.zIndex = '100';
                _drag.el.style.transition = 'none';
                _drag.allEls.forEach(t => {
                    if (t === _drag.el) return;
                    t.style.transition = 'transform 160ms cubic-bezier(0.2,0.8,0.2,1)';
                });
                _drag.el.classList.add('tab-dragging-active');

                const def = APP_DEFS[tab.key] || APP_DEFS.home;
                const _bsnap = _browserTabSnapshot(tab);
                const _fav = (tab.key === 'browser' && window.bwMeta && tab.instanceData)
                    ? ((window.bwMeta(tab.instanceData.bwId) || {}).favicon || '')
                    : '';
                ipcRenderer.send('tab-drag-begin', {
                    key: tab.key,
                    label: _tabLabel(tab),
                    color: def.color,
                    icon: def.icon,
                    favicon: _fav,
                    grabOffsetX: _drag.grabOffsetX,
                    instanceData: tab.instanceData || {},
                    browserUrl: _bsnap.url,
                    browserPrivate: _bsnap.private,
                });
            }

            const isOut = (e.clientY > _drag.stripBottom + TEAROUT_BELOW) ||
                          (e.clientY < _drag.stripTop - TEAROUT_ABOVE);

            ipcRenderer.send('tab-drag-move', {
                screenX: e.screenX, screenY: e.screenY,
                outOfStrip: isOut,
            });

            if (isOut && _drag.mode === 'strip') _enterTearMode();
            else if (!isOut && _drag.mode === 'tearing') _exitTearMode(e);

            if (_drag.mode === 'strip') {
                _drag.el.style.transform = `translateX(${dx}px)`;
                const draggedCenter = _drag.homeCenters[_drag.draggedIdx] + dx;
                const newIdx = _computeDropIndex(draggedCenter);
                if (newIdx !== _drag.currentDropIdx) {
                    _drag.currentDropIdx = newIdx;
                    _applyShifts();
                }
            }
        }

        function _onDragUp(e) {
            if (!_drag || e.pointerId !== _drag.pointerId) return;
            const d = _drag;
            _drag = null;
            _releaseDragListeners();

            d.el.style.transition = '';
            d.allEls.forEach(t => { t.style.transition = ''; });

            if (!d.moved) {
                _cleanDragStyles();
                _switchToTab(d.tabId);
                _flushStripAfterDrag();
                return;
            }

            ipcRenderer.send('tab-drag-end', {
                screenX: e.screenX, screenY: e.screenY,
                outOfStrip: d.mode === 'tearing',
            });

            if (d.mode === 'tearing') {
                _cleanDragStyles();
                _removeTabAfterTear(d.tabId);
                _flushStripAfterDrag();
                return;
            }

            _cleanDragStyles();
            const D = d.draggedIdx;
            const Y = d.currentDropIdx;
            if (Y !== D) {
                const [mv] = _tabs.splice(D, 1);
                _tabs.splice(Y, 0, mv);
            }
            _renderTabStrip();
        }

        function _onDragCancel(e) {
            if (!_drag || (e && e.pointerId !== _drag.pointerId)) return;
            if (_drag.moved) ipcRenderer.send('tab-drag-cancel');
            _drag = null;
            _releaseDragListeners();
            _cleanDragStyles();
            _renderTabStrip();
        }

        function _computeDropIndex(draggedCenter) {
            const D = _drag.draggedIdx;
            const W = _drag.tabWidth;
            let count = 0;
            for (let i = 0; i < _drag.homeCenters.length; i++) {
                if (i === D) continue;
                const adj = i < D ? _drag.homeCenters[i] : _drag.homeCenters[i] - W;
                if (adj < draggedCenter) count++;
            }
            return count;
        }

        function _applyShifts() {
            const D = _drag.draggedIdx;
            const Y = _drag.currentDropIdx;
            const W = _drag.tabWidth;
            _drag.allEls.forEach((t, origI) => {
                if (origI === D) return;
                const idxWoX = origI < D ? origI : origI - 1;
                const gapShift = origI > D ? -W : 0;
                const insertShift = idxWoX >= Y ? W : 0;
                t.style.transform = `translateX(${gapShift + insertShift}px)`;
            });
        }

        function _enterTearMode() {
            _drag.mode = 'tearing';
            // Fully hide the tab in the strip — the floating chip (owned by the
            // main process) now stands in for it, and the remaining tabs slide
            // over to close the gap, just like Brave/Chrome.
            _drag.el.style.opacity = '0';
            _drag.el.style.transform = '';
            _drag.allEls.forEach((t, i) => {
                if (i === _drag.draggedIdx) return;
                t.style.transform = i > _drag.draggedIdx ? `translateX(${-_drag.tabWidth}px)` : '';
            });
            // No window is created here. The main process shows the lightweight
            // preview chip from the out-of-strip drag-move events; the real
            // detached window is materialized only on drop.
        }

        function _exitTearMode(e) {
            _drag.mode = 'strip';
            // Dragged back into the strip — restore the tab and resume reordering.
            // Main hides the chip on the outOfStrip:false drag-move sent just
            // before this, so there's nothing to tear down here.
            _drag.el.style.opacity = '';
            const dx = e.clientX - _drag.startClientX;
            _drag.el.style.transform = `translateX(${dx}px)`;
            _applyShifts();
        }

        // Remove the local tab after it has been torn out / merged elsewhere.
        // Main process has already created/used the receiving window.
        function _removeTabAfterTear(id) {
            const idx = _tabs.findIndex(t => t.id === id);
            if (idx === -1) return;
            // A browser tab was rebuilt in the receiving window → tear down the
            // <webview> it left behind here so it doesn't linger off-screen.
            const moved = _tabs[idx];
            if (moved.key === 'browser' && moved.instanceData && moved.instanceData.bwId && window.bwDestroy)
                window.bwDestroy(moved.instanceData.bwId);
            if (_tabs.length === 1) {
                // Last tab torn out → close this window
                ipcRenderer.send('close-this-window');
                return;
            }
            _tabs.splice(idx, 1);
            if (_activeId === id) {
                _switchToTab(_tabs[Math.max(0, idx - 1)].id);
            } else {
                _renderTabStrip();
            }
        }

        // ── External-drop: another window's tab is being dragged over us ──
        ipcRenderer.on('tab-external-drag-enter', (_event, { payload, screenX, screenY }) => {
            _externalDrop = { payload, indicatorIdx: null };
            _updateExternalDropIndicator(screenX, screenY);
        });
        ipcRenderer.on('tab-external-drag-over', (_event, { screenX, screenY }) => {
            if (!_externalDrop) return;
            _updateExternalDropIndicator(screenX, screenY);
        });
        ipcRenderer.on('tab-external-drag-leave', () => {
            _externalDrop = null;
            document.querySelectorAll('#open-tabs-container .browser-tab').forEach(t => {
                t.style.transform = '';
                t.style.transition = 'transform 120ms ease-out';
            });
        });
        ipcRenderer.on('tab-external-drop', (_event, { payload }) => {
            const dropIdx = _externalDrop && _externalDrop.indicatorIdx != null
                ? _externalDrop.indicatorIdx : _tabs.length;
            _externalDrop = null;
            document.querySelectorAll('#open-tabs-container .browser-tab').forEach(t => {
                t.style.transform = '';
                t.style.transition = '';
            });
            // Browser tabs can't bring their <webview> across renderers (the
            // bwId belongs to the source window). Rebuild a fresh web tab here
            // pointing at the same URL, then slot it at the drop position.
            if (payload.key === 'browser') {
                const t = _openBrowserTab(payload.browserUrl || '', { private: payload.browserPrivate });
                const curIdx = _tabs.findIndex(x => x.id === t.id);
                if (curIdx !== -1) {
                    let target = dropIdx > curIdx ? dropIdx - 1 : dropIdx;
                    if (target !== curIdx) {
                        _tabs.splice(curIdx, 1);
                        _tabs.splice(Math.min(Math.max(target, 0), _tabs.length), 0, t);
                        _renderTabStrip();
                    }
                }
                return;
            }

            const id = _makeId();
            const newTab = {
                id,
                key: payload.key,
                label: payload.label && payload.label !== (APP_DEFS[payload.key]?.label) ? payload.label : null,
                instanceData: payload.instanceData || {},
            };
            _tabs.splice(dropIdx, 0, newTab);
            _switchToTab(id);
        });

        function _updateExternalDropIndicator(screenX, _screenY) {
            const container = document.getElementById('open-tabs-container');
            if (!container || !_externalDrop) return;
            // Convert screen X to client X (Electron renderer: window.screenX = window's screen X)
            const clientX = screenX - window.screenX;
            const allEls = [...container.querySelectorAll('.browser-tab')];

            let idx = allEls.length;
            for (let i = 0; i < allEls.length; i++) {
                const r = allEls[i].getBoundingClientRect();
                // Reset to home rect (no transform) — we apply transforms below
                const homeLeft  = r.left  - (parseFloat(allEls[i].style.transform?.match(/-?\d+(?:\.\d+)?/)?.[0]) || 0);
                const center = (homeLeft + (r.right - r.left) / 2);
                if (clientX < center) { idx = i; break; }
            }
            if (idx === _externalDrop.indicatorIdx) return;
            _externalDrop.indicatorIdx = idx;

            const W = 140; // approximate width for the incoming tab's slot
            allEls.forEach((t, i) => {
                t.style.transition = 'transform 140ms cubic-bezier(0.2,0.8,0.2,1)';
                t.style.transform  = i >= idx ? `translateX(${W}px)` : '';
            });
        }

        // ── Tab operations ─────────────────────────────────────
        function _switchToTab(id) {
            // Save vault state of outgoing tab
            const prevTab = _tabs.find(t => t.id === _activeId);
            if (prevTab && prevTab.key === 'vault') _saveVaultTabState(prevTab);

            _activeId = id;
            const tab = _tabs.find(t => t.id === id);
            if (!tab) return;

            _activateView(tab.key);

            // Restore vault state for incoming tab
            if (tab.key === 'vault') _restoreVaultTabState(tab);

            _renderTabStrip();
        }

        // Open or navigate to an app.
        // • If the CURRENT tab is a home tab → transform it in place (browser "new tab" UX).
        // • Vault & chat support multiple instances.
        // • All other apps: switch to an existing tab if one exists.
        function _openTab(key) {
            // Browser is not a single app any more — route to a real web tab.
            if (key === 'browser') { _openBrowserTab('', { background: false }); return; }

            const activeTab = _tabs.find(t => t.id === _activeId);

            // Home tab → transform into this app
            if (activeTab && activeTab.key === 'home') {
                activeTab.key = key;
                activeTab.instanceData = {};
                activeTab.label = null;
                // Save vault state if applicable (shouldn't be, but safe)
                if (key === 'vault') _restoreVaultTabState(activeTab);
                _activateView(key);
                _renderTabStrip();
                return;
            }

            // Multi-instance apps: always open a new tab
            if (MULTI_INSTANCE_APPS.has(key)) {
                const id = _makeId();
                _tabs.push({ id, key, instanceData: {} });
                if (key === 'vault') {
                    // Save previous vault tab state before switching
                    if (activeTab && activeTab.key === 'vault') _saveVaultTabState(activeTab);
                }
                _activeId = id;
                _activateView(key);
                if (key === 'vault') _restoreVaultTabState(_tabs.find(t => t.id === id));
                _renderTabStrip();
                return;
            }

            // Single-instance apps: switch to existing or open new
            const existing = _tabs.find(t => t.key === key);
            if (existing) { _switchToTab(existing.id); return; }
            const id = _makeId();
            _tabs.push({ id, key, instanceData: {} });
            _activeId = id;
            _activateView(key);
            _renderTabStrip();
        }

        function _closeTab(id) {
            const idx = _tabs.findIndex(t => t.id === id);
            if (idx === -1) return;
            // Tear down the backing <webview> when closing a web tab.
            const closing = _tabs[idx];
            if (closing.key === 'browser' && closing.instanceData && closing.instanceData.bwId && window.bwDestroy)
                window.bwDestroy(closing.instanceData.bwId);
            if (_tabs.length === 1) {
                // Last tab: navigate to home instead of closing
                _tabs[0].key = 'home';
                _tabs[0].label = null;
                _tabs[0].instanceData = {};
                _switchToTab(_tabs[0].id);
                return;
            }
            _tabs.splice(idx, 1);
            if (_activeId === id) {
                _switchToTab(_tabs[Math.max(0, idx - 1)].id);
            } else {
                _renderTabStrip();
            }
        }

        // ── Web tabs as top-level tabs ─────────────────────────
        // Open a website as its own top-level app tab. The <webview> is owned
        // by browser.js, linked to this tab via instanceData.bwId.
        //   opts.background → insert without switching to it (used for popups
        //   so ad popunders can't steal focus from the current page).
        //   opts.private    → private (in-memory) browsing partition.
        // URL + private flag for a browser tab, used when moving it to another
        // window (the live <webview> can't cross renderers, so we rebuild it).
        function _browserTabSnapshot(tab) {
            if (tab && tab.key === 'browser' && tab.instanceData && tab.instanceData.bwId && window.bwTabSnapshot) {
                const s = window.bwTabSnapshot(tab.instanceData.bwId) || {};
                return { url: s.url || '', private: !!s.private };
            }
            return { url: '', private: false };
        }

        function _openBrowserTab(url, opts = {}) {
            const bwId = _makeId();
            const id   = _makeId();
            const tab  = { id, key: 'browser', instanceData: { bwId, private: !!opts.private } };
            const activeIdx = _tabs.findIndex(t => t.id === _activeId);
            _tabs.splice(activeIdx >= 0 ? activeIdx + 1 : _tabs.length, 0, tab);
            if (typeof renderBrowser === 'function') renderBrowser();   // ensure browser.js is initialised
            if (window.bwCreateWebview) window.bwCreateWebview(bwId, url || '', !!opts.private);
            if (!opts.background) {
                _activeId = id;
                _activateView('browser');   // activates the webview via bwActivate
            }
            _renderTabStrip();
            return tab;
        }

        // Public API for other modules
        window.switchTab = (key) => _openTab(key);
        // Let browser.js repaint the strip on title/favicon/loading changes,
        // and open new web tabs (new-tab button, popups, history clicks).
        window.appRenderTabStrip = _renderTabStrip;
        window.appOpenBrowserTab = _openBrowserTab;
        window.appOpenTab        = _openTab;
        window.appCloseActiveTab = () => _closeTab(_activeId);

        // Jump to the Vault showing a particular folder. Used when something
        // outside the Vault puts a file in it (a finished download) and wants to
        // show the user where it landed. Reuses an open Vault tab instead of
        // stacking up a new one each time, and closes any file that tab had open
        // so the grid — where the new file is — is what actually comes up.
        // `fileId` (optional) opens straight into that file's viewer — used when
        // the OS hands us a .md to open (see appOpenVaultExternalFile).
        window.appOpenVaultAt = function (folderId, fileId) {
            folderId = folderId || null;
            const activeTab = _tabs.find(t => t.id === _activeId);
            let tab = (activeTab && activeTab.key === 'vault') ? activeTab
                    : _tabs.find(t => t.key === 'vault');

            if (!tab && activeTab && activeTab.key === 'home') {
                tab = activeTab;             // transform the blank tab in place
                tab.key   = 'vault';
                tab.label = null;
            }
            if (!tab) {
                if (activeTab && activeTab.key === 'vault') _saveVaultTabState(activeTab);
                tab = { id: _makeId(), key: 'vault', instanceData: {} };
                _tabs.push(tab);
            } else if (tab !== activeTab && activeTab && activeTab.key === 'vault') {
                _saveVaultTabState(activeTab);
            }

            tab.instanceData = { ...(tab.instanceData || {}), activeFolderId: folderId, openFileId: fileId || null };
            _activeId = tab.id;
            _activateView('vault');
            _restoreVaultTabState(tab);
            _renderTabStrip();
        };

        // ⌘W from the app menu (works even while a <webview> has focus).
        // _closeTab already falls back to the home view on the last tab.
        try { require('electron').ipcRenderer.on('close-active-tab', () => _closeTab(_activeId)); } catch (_) {}

        // Adopt a browser tab that was torn into this freshly-opened window.
        // Transform the window's initial blank home tab in place (so we don't
        // leave a stray empty tab) and load the site that was torn out.
        // Called in a freshly detached window (see _spawnDetachedWindow in main.js)
        // to rebuild the torn-out tab here — including the state it was carrying.
        // The old code ran a bare switchTab(key), which is why a torn-out vault tab
        // always arrived empty however carefully its state had been captured.
        window.appAdoptTab = function (payload) {
            payload = payload || {};
            const key = payload.key;
            if (!key || !APP_DEFS[key]) return;
            if (key === 'browser') {
                window.appAdoptBrowserTab(payload.browserUrl || '', !!payload.browserPrivate);
                return;
            }
            // A brand-new window starts on a single home tab — take it over rather
            // than leaving an empty one behind.
            const active = _tabs.find(t => t.id === _activeId);
            const tab    = (active && active.key === 'home') ? active
                         : (() => { const t = { id: _makeId(), key, instanceData: {} }; _tabs.push(t); return t; })();
            const defLabel = (APP_DEFS[key] || {}).label;
            tab.key          = key;
            tab.label        = (payload.label && payload.label !== defLabel) ? payload.label : null;
            tab.instanceData = payload.instanceData || {};
            _activeId = tab.id;
            _activateView(key);
            if (key === 'vault') _restoreVaultTabState(tab);
            _renderTabStrip();
        };

        ipcRenderer.on('adopt-tab', (_event, payload) => {
            try { window.appAdoptTab(payload); }
            catch (err) { console.error('[tabs] adopting torn-out tab failed:', err); }
        });

        window.appAdoptBrowserTab = function (url, isPrivate) {
            const active = _tabs.find(t => t.id === _activeId);
            if (active && active.key === 'home' && !isPrivate) {
                const bwId = _makeId();
                active.key = 'browser';
                active.label = null;
                active.instanceData = { bwId, private: false };
                if (typeof renderBrowser === 'function') renderBrowser();
                if (window.bwCreateWebview) window.bwCreateWebview(bwId, url || '', false);
                _activateView('browser');
                _renderTabStrip();
            } else {
                _openBrowserTab(url, { private: isPrivate });
            }
        };

        // Ask the built-in AI a question (used by the address-bar "Ask Vulsor AI"
        // row): open the Chat tab and send the query.
        window.appAskAI = function (text) {
            text = (text || '').trim();
            if (!text) return;
            _openTab('chat');
            setTimeout(() => { try { if (userInput) { userInput.value = text; sendMessage(); } } catch (_) {} }, 80);
        };

        // OS handoff when Vulsor is the default browser: open the link as a
        // foreground web tab. Registered here (not in renderBrowser) so it
        // works even if the browser view hasn't been opened yet this session.
        ipcRenderer.on('open-external-url', (e, url) => { if (url) _openBrowserTab(url, { background: false }); });

        // Same handoff for files: macOS/Windows hand us .md paths when Vulsor is
        // the default markdown app. They open in the Vault, not the browser.
        ipcRenderer.on('open-external-file', (e, files) => {
            const list = Array.isArray(files) ? files : [files];
            list.forEach(p => {
                try { if (typeof window.appOpenVaultExternalFile === 'function') window.appOpenVaultExternalFile(p); }
                catch (err) { console.error('[open-external-file]', err); }
            });
        });

        // Brave-style pop-up blocking: when the main process denies a pop-under,
        // show a small throttled toast that lets the user open it if it was real.
        let _popupToast = null, _popupCount = 0, _popupLast = '', _popupTimer = null;
        ipcRenderer.on('browser-popup-blocked', (e, d) => {
            _popupCount++; _popupLast = (d && d.url) || '';
            if (!_popupToast) {
                _popupToast = document.createElement('div');
                _popupToast.style.cssText = 'position:fixed; bottom:20px; left:50%; transform:translateX(-50%); z-index:9999; display:flex; align-items:center; gap:12px; background:#111827; border:1px solid rgba(129,140,248,0.4); border-radius:12px; padding:10px 14px; box-shadow:0 16px 40px rgba(0,0,0,0.55); font-size:12px; color:#e2e8f0';
                document.body.appendChild(_popupToast);
            }
            _popupToast.innerHTML = `<i class="fas fa-ban" style="color:#f87171"></i>
                <span>Blocked <b>${_popupCount}</b> pop-up${_popupCount > 1 ? 's' : ''}</span>
                <button id="popup-open" style="font-weight:600; color:#a5b4fc; background:none; border:none; cursor:pointer">Open last</button>
                <button id="popup-x" style="color:#64748b; background:none; border:none; cursor:pointer"><i class="fas fa-xmark"></i></button>`;
            _popupToast.querySelector('#popup-open').onclick = () => { if (_popupLast) _openBrowserTab(_popupLast, { background: false }); _dismissPopupToast(); };
            _popupToast.querySelector('#popup-x').onclick = _dismissPopupToast;
            clearTimeout(_popupTimer);
            _popupTimer = setTimeout(_dismissPopupToast, 4500);
        });
        function _dismissPopupToast() {
            clearTimeout(_popupTimer);
            if (_popupToast) { _popupToast.remove(); _popupToast = null; }
            _popupCount = 0; _popupLast = '';
        }

        // Open a URL/search in the browser. From a blank "new tab" (home) tab
        // we transform it in place; otherwise we open a fresh web tab. Used by
        // the home omnibox and the home-page site shortcuts.
        window.browserOpenUrl = function (url) {
            const active = _tabs.find(t => t.id === _activeId);
            if (active && active.key === 'home') {
                const bwId = _makeId();
                active.key = 'browser';
                active.label = null;
                active.instanceData = { bwId, private: false };
                if (typeof renderBrowser === 'function') renderBrowser();
                if (window.bwCreateWebview) window.bwCreateWebview(bwId, url || '', false);
                _activateView('browser');   // activates the webview via bwActivate
                _renderTabStrip();
            } else {
                _openBrowserTab(url, { background: false });
            }
        };
        // Allow vault.js to update the active tab's display label (e.g. show folder name)
        window.updateActiveTabLabel = (label) => {
            const tab = _tabs.find(t => t.id === _activeId);
            if (tab) { tab.label = label; _renderTabStrip(); }
        };

        // Lighten (pct>0) or darken (pct<0) a hex color
        function _shade(hex, pct) {
            hex = String(hex || '#313845').replace('#','');
            if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
            let r = parseInt(hex.slice(0,2),16), g = parseInt(hex.slice(2,4),16), b = parseInt(hex.slice(4,6),16);
            const adj = c => pct >= 0 ? Math.round(c + (255 - c) * pct) : Math.round(c * (1 + pct));
            return '#' + [adj(r),adj(g),adj(b)].map(c => Math.max(0,Math.min(255,c)).toString(16).padStart(2,'0')).join('');
        }
        // Relative luminance 0..1 of a hex color
        function _lum(hex) {
            hex = String(hex || '#000').replace('#','');
            if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
            const r = parseInt(hex.slice(0,2),16), g = parseInt(hex.slice(2,4),16), b = parseInt(hex.slice(4,6),16);
            return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        }
        // Adapt an icon color so it stays readable on a tile of the given luminance
        function _iconColorFor(color, tileLum) {
            const cl = _lum(color);
            if (tileLum > 0.55) {
                // Light tile: darken bright/pale icons so they pop
                if (cl > 0.45) return _shade(color, -(cl - 0.30));
                return color;
            }
            // Dark tile: lift very dark icons so they don't disappear
            if (cl < 0.20) return _shade(color, 0.5);
            return color;
        }

        // ── Home page ──────────────────────────────────────────
        // Canonical list of built-in apps shown on the home page.
        // NOTE: 'browser' is intentionally absent — web pages are no longer a
        // single "Browser" app/category; each site opens as its own top-level
        // tab via the home omnibox / site shortcuts (see browserOpenUrl).
        const HOME_APPS = ['chat','todos','study','vault','finance','journal','lab','recipes','books','writer','learn','countdown','audiobook','calendar','music','karaoke','chess','tuner','workout','news','courses','research','cosmos','galaxy','voyage','camera','editor','mail','rts','network','sudoku','settings'];

        // Home tiles are a single ordered list mixing built-in apps and the
        // user's own website shortcuts: [{t:'app', k}, {t:'site', id}].
        // Stored in settingsData.homeItems; site data in settingsData.homeSites.
        function _homeSites() {
            if (!settingsData.homeSites) settingsData.homeSites = [];
            return settingsData.homeSites;
        }
        // Archived tiles are hidden from the main grid but kept so they can be
        // restored. Stored as keys: app keys ('chess') or site ids ('site_…').
        function _archived() {
            if (!Array.isArray(settingsData.archived)) settingsData.archived = [];
            return settingsData.archived;
        }
        function _isArchived(key) { return _archived().includes(key); }
        function _archiveItem(key) {
            if (!_archived().includes(key)) _archived().push(key);
            if (typeof saveSettingsData === 'function') saveSettingsData();
            _buildHomePage();
        }
        function _unarchiveItem(key) {
            settingsData.archived = _archived().filter(k => k !== key);
            if (typeof saveSettingsData === 'function') saveSettingsData();
            _buildHomePage();
        }

        // Per-app custom icons (overrides APP_DEFS[key].icon). key → 'fa-name'.
        function _categoryIcons() {
            if (!settingsData.categoryIcons) settingsData.categoryIcons = {};
            return settingsData.categoryIcons;
        }
        function _setCategoryIcon(key, name) {
            const m = _categoryIcons();
            if (name) m[key] = name; else delete m[key];
            if (typeof saveSettingsData === 'function') saveSettingsData();
            _buildHomePage();
        }

        // ── Icon picker (choose from every Font Awesome icon) ──────────
        let _faIconsCache = null;
        function _allFaIcons() {
            if (_faIconsCache) return _faIconsCache;
            const set = new Set();
            for (const sheet of document.styleSheets) {
                let rules; try { rules = sheet.cssRules; } catch (_) { continue; }
                if (!rules) continue;
                for (const rule of rules) {
                    const sel = rule.selectorText;
                    if (!sel || sel.indexOf('.fa-') === -1 || sel.indexOf('before') === -1) continue;
                    sel.split(',').forEach(s => {
                        const m = s.trim().match(/^\.(fa-[a-z0-9-]+)::?before$/);
                        if (m) set.add(m[1]);
                    });
                }
            }
            _faIconsCache = [...set].sort();
            return _faIconsCache;
        }

        // current: currently selected 'fa-name' (or null). onPick(name|null).
        function _openIconPicker(current, onPick) {
            document.getElementById('home-icon-modal')?.remove();
            const overlay = document.createElement('div');
            overlay.id = 'home-icon-modal';
            overlay.style.cssText = 'position:fixed; inset:0; z-index:650; background:rgba(2,6,23,0.6); display:flex; align-items:center; justify-content:center;';
            overlay.innerHTML = `
                <div style="width:460px; max-width:92vw; height:520px; max-height:86vh; background:#0f172a; border:1px solid rgba(255,255,255,0.12); border-radius:16px; box-shadow:0 24px 60px rgba(0,0,0,0.6); display:flex; flex-direction:column; overflow:hidden">
                    <div style="display:flex; align-items:center; gap:10px; padding:14px 16px; border-bottom:1px solid rgba(148,163,184,0.12)">
                        <span style="font-size:14px; font-weight:700; color:#e2e8f0; flex:1">Choose an icon</span>
                        <button id="home-icon-default" style="font-size:11px; color:#cbd5e1; background:rgba(255,255,255,0.06); border:none; border-radius:8px; padding:6px 12px; cursor:pointer">Use default</button>
                        <button id="home-icon-close" style="font-size:14px; color:#94a3b8; background:none; border:none; cursor:pointer; width:26px; height:26px; border-radius:7px">✕</button>
                    </div>
                    <div style="padding:12px 16px 8px">
                        <input id="home-icon-search" type="text" placeholder="Search icons (e.g. github, music, heart)…" spellcheck="false" autocomplete="off"
                            style="width:100%; background:#1e293b; border:1px solid rgba(255,255,255,0.1); border-radius:9px; padding:9px 12px; color:#e2e8f0; font-size:13px; outline:none">
                    </div>
                    <div id="home-icon-grid" style="flex:1; overflow-y:auto; padding:6px 12px 14px; display:grid; grid-template-columns:repeat(auto-fill,minmax(46px,1fr)); gap:6px; align-content:start"></div>
                    <div id="home-icon-count" style="padding:6px 16px 12px; font-size:11px; color:#64748b"></div>
                </div>`;
            document.body.appendChild(overlay);
            const grid = overlay.querySelector('#home-icon-grid');
            const search = overlay.querySelector('#home-icon-search');
            const count = overlay.querySelector('#home-icon-count');
            const all = _allFaIcons();
            const CAP = 600;

            const render = (q) => {
                q = (q || '').trim().toLowerCase();
                const matches = q ? all.filter(n => n.includes(q)) : all;
                const shown = matches.slice(0, CAP);
                grid.innerHTML = shown.map(n =>
                    `<button class="home-icon-cell${n === current ? ' selected' : ''}" data-icon="${n}" title="${n.replace(/^fa-/, '')}"><i class="fa-any ${n}"></i></button>`).join('');
                count.textContent = matches.length > CAP
                    ? `Showing ${CAP} of ${matches.length} — keep typing to narrow down`
                    : `${matches.length} icon${matches.length === 1 ? '' : 's'}`;
                grid.querySelectorAll('.home-icon-cell').forEach(b =>
                    b.addEventListener('click', () => { onPick(b.dataset.icon); overlay.remove(); }));
            };
            render('');
            let t = null;
            search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => render(search.value), 120); });
            search.addEventListener('keydown', e => { if (e.key === 'Escape') overlay.remove(); });
            overlay.querySelector('#home-icon-default').addEventListener('click', () => { onPick(null); overlay.remove(); });
            overlay.querySelector('#home-icon-close').addEventListener('click', () => overlay.remove());
            overlay.addEventListener('mousedown', e => { if (e.target === overlay) overlay.remove(); });
            setTimeout(() => search.focus(), 40);
        }
        function _homeItems() {
            let items = Array.isArray(settingsData.homeItems) ? settingsData.homeItems.slice() : [];
            // Drop stale entries (uninstalled apps / deleted sites)
            const siteIds = new Set(_homeSites().map(s => s.id));
            items = items.filter(it => it && (it.t === 'app' ? HOME_APPS.includes(it.k) : siteIds.has(it.id)));
            // Append any apps / sites not yet present (first run, new app in an update)
            HOME_APPS.forEach(k => { if (!items.some(it => it.t === 'app' && it.k === k)) items.push({ t: 'app', k }); });
            _homeSites().forEach(s => { if (!items.some(it => it.t === 'site' && it.id === s.id)) items.push({ t: 'site', id: s.id }); });
            return items;
        }
        function _saveHomeOrderFromDOM() {
            const grid = document.getElementById('home-shortcuts-grid');
            if (!grid) return;
            const items = [];
            grid.querySelectorAll('.home-shortcut-tile[data-home-type]').forEach(el => {
                if (el.dataset.homeType === 'app') items.push({ t: 'app', k: el.dataset.homeKey });
                else if (el.dataset.homeType === 'site') items.push({ t: 'site', id: el.dataset.homeKey });
            });
            settingsData.homeItems = items;
            if (typeof saveSettingsData === 'function') saveSettingsData();
        }

        let _homeDragEl = null;
        let _archivedOpen = false;

        function _buildHomePage() {
            const grid = document.getElementById('home-shortcuts-grid');
            if (!grid) return;
            grid.innerHTML = '';
            const customColors = (typeof settingsData !== 'undefined' && settingsData.categoryColors) || {};
            const tileBase = (typeof settingsData !== 'undefined' && settingsData.categoryTileColor) || '#313845';
            const tileBg   = `linear-gradient(145deg, ${_shade(tileBase, 0.10)}, ${_shade(tileBase, -0.14)})`;
            const tileLum  = _lum(tileBase);
            const sites = _homeSites();

            const makeDraggable = (tile) => {
                tile.draggable = true;
                tile.addEventListener('dragstart', e => {
                    _homeDragEl = tile; tile.classList.add('dragging');
                    try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', ''); } catch (_) {}
                });
                tile.addEventListener('dragend', () => {
                    tile.classList.remove('dragging'); _homeDragEl = null;
                    _saveHomeOrderFromDOM();
                });
            };

            _homeItems().forEach(item => {
                const itemKey = item.t === 'app' ? item.k : item.id;
                if (_isArchived(itemKey)) return;   // hidden until restored

                const tile = document.createElement('div');
                tile.className = 'home-shortcut-tile';

                if (item.t === 'app') {
                    const def = APP_DEFS[item.k];
                    if (!def) return;
                    const rawColor = customColors[item.k] || def.color;
                    const color = _iconColorFor(rawColor, tileLum);
                    tile.style.setProperty('--tile-accent', color);   // per-app hover glow
                    const customIcon = _categoryIcons()[item.k];
                    const iconCls = customIcon ? `fa-any ${customIcon}` : `fas ${def.icon}`;
                    tile.dataset.homeType = 'app';
                    tile.dataset.homeKey = item.k;
                    tile.title = `${def.label} · drag to reorder · right-click for options`;
                    tile.innerHTML = `
                        <div class="home-shortcut-icon" style="background:${tileBg}; border:1px solid rgba(255,255,255,0.08); box-shadow:0 2px 6px rgba(0,0,0,0.35)">
                            <i class="${iconCls}" style="color:${color}; font-size:22px"></i>
                        </div>
                        <span class="home-shortcut-label">${def.label}</span>`;
                    tile.addEventListener('click', () => _openTab(item.k));
                    tile.addEventListener('contextmenu', e => { e.preventDefault(); _openAppMenu(item.k, rawColor, e.clientX, e.clientY); });
                } else {
                    const site = sites.find(s => s.id === item.id);
                    if (!site) return;
                    tile.dataset.homeType = 'site';
                    tile.dataset.homeKey = site.id;
                    tile.title = `${site.name} — ${site.url} · drag to reorder · right-click to edit`;
                    tile.innerHTML = `
                        <div class="home-shortcut-icon" style="background:${tileBg}; border:1px solid rgba(255,255,255,0.08); box-shadow:0 2px 6px rgba(0,0,0,0.35)">
                            ${_siteIconHtml(site)}
                        </div>
                        <span class="home-shortcut-label">${_escHtml(site.name)}</span>`;
                    tile.addEventListener('click', () => { if (typeof browserOpenUrl === 'function') browserOpenUrl(site.url); });
                    tile.addEventListener('contextmenu', e => { e.preventDefault(); _openSiteMenu(site, e.clientX, e.clientY); });
                }

                makeDraggable(tile);
                grid.appendChild(tile);
            });

            // "Add site" tile (always last, not draggable)
            const add = document.createElement('div');
            add.className = 'home-shortcut-tile home-add-tile';
            add.title = 'Add a website shortcut';
            add.innerHTML = `
                <div class="home-shortcut-icon home-add-icon"><i class="fas fa-plus" style="color:#94a3b8; font-size:22px"></i></div>
                <span class="home-shortcut-label">Add site</span>`;
            add.addEventListener('click', () => _openSiteEditor(null));
            grid.appendChild(add);

            // Reordering: insert the dragged tile relative to the hovered tile
            if (!grid._homeDndWired) {
                grid._homeDndWired = true;
                grid.addEventListener('dragover', e => {
                    if (!_homeDragEl) return;
                    e.preventDefault();
                    const after = _homeDragAfter(grid, e.clientX, e.clientY);
                    if (after == null) {
                        const addTile = grid.querySelector('.home-add-tile');
                        grid.insertBefore(_homeDragEl, addTile);   // keep "Add site" last
                    } else if (after !== _homeDragEl) {
                        grid.insertBefore(_homeDragEl, after);
                    }
                });
            }

            _buildArchived();
        }

        // ── Archived shortcuts: opened from the button in the page's corner ────
        function _buildArchived() {
            const wrap = document.getElementById('home-archived');
            const btn  = document.getElementById('home-archive-btn');
            if (!wrap) return;
            const arch = _archived();
            const items = _homeItems().filter(it => arch.includes(it.t === 'app' ? it.k : it.id));
            if (btn) {
                btn.style.display = items.length ? '' : 'none';
                btn.classList.toggle('is-open', _archivedOpen && items.length > 0);
                btn.title = `${items.length} archived shortcut${items.length !== 1 ? 's' : ''}`;
                const count = document.getElementById('home-archive-count');
                if (count) count.textContent = items.length;
                if (!btn._wired) {
                    btn._wired = true;
                    btn.addEventListener('click', e => {
                        e.stopPropagation();
                        _archivedOpen = !_archivedOpen;
                        _buildArchived();
                    });
                    // Clicking anywhere else puts the drawer away again
                    document.addEventListener('click', e => {
                        if (!_archivedOpen) return;
                        if (e.target.closest('#home-archived') || e.target.closest('#home-archive-btn')) return;
                        _archivedOpen = false;
                        _buildArchived();
                    });
                }
            }
            if (!items.length) { wrap.style.display = 'none'; wrap.innerHTML = ''; return; }

            wrap.style.display = _archivedOpen ? 'block' : 'none';
            wrap.innerHTML =
                '<div class="home-archived-title">Archived<em>click to restore</em></div>' +
                '<div class="home-archived-grid"></div>';

            const g = wrap.querySelector('.home-archived-grid');
            const customColors = settingsData.categoryColors || {};
            const tileBase = settingsData.categoryTileColor || '#313845';
            const tileBg   = `linear-gradient(145deg, ${_shade(tileBase, 0.10)}, ${_shade(tileBase, -0.14)})`;
            const tileLum  = _lum(tileBase);
            const sites = _homeSites();

            items.forEach(item => {
                let key, label, iconHtml;
                if (item.t === 'app') {
                    const def = APP_DEFS[item.k]; if (!def) return;
                    key = item.k; label = def.label;
                    const color = _iconColorFor(customColors[item.k] || def.color, tileLum);
                    iconHtml = `<i class="fas ${def.icon}" style="color:${color}; font-size:22px"></i>`;
                } else {
                    const site = sites.find(s => s.id === item.id); if (!site) return;
                    key = site.id; label = site.name;
                    iconHtml = _siteIconHtml(site);
                }
                const tile = document.createElement('div');
                tile.className = 'home-shortcut-tile home-archived-tile';
                tile.title = `${label} — click to restore`;
                tile.innerHTML = `
                    <div class="home-shortcut-icon" style="background:${tileBg}; border:1px solid rgba(255,255,255,0.08)">
                        ${iconHtml}
                        <div class="home-restore-badge"><i class="fas fa-rotate-left"></i></div>
                    </div>
                    <span class="home-shortcut-label">${_escHtml(label)}</span>`;
                tile.addEventListener('click', () => _unarchiveItem(key));
                g.appendChild(tile);
            });
        }
        // Find the tile that the dragged item should be inserted before, based
        // on pointer position (nearest center to the right/below).
        function _homeDragAfter(grid, x, y) {
            const tiles = [...grid.querySelectorAll('.home-shortcut-tile:not(.dragging):not(.home-add-tile)')];
            let best = null, bestDist = Infinity;
            for (const t of tiles) {
                const r = t.getBoundingClientRect();
                const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
                // only consider tiles whose center is after the pointer
                if (y < r.top - 4 || (Math.abs(cy - y) < r.height && x < cx)) {
                    const d = Math.hypot(cx - x, cy - y);
                    if (d < bestDist) { bestDist = d; best = t; }
                }
            }
            return best;
        }
        function _escHtml(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

        // Icon markup for a website shortcut tile. Like Chrome/Brave, we want the
        // site's real logo, so we try several favicon sources in order and fall
        // back to the next on load failure, ending at a globe glyph:
        //   1. DuckDuckGo's icon service — returns the actual per-site logo
        //      (e.g. the Gmail envelope, the Outlook logo), not a generic mark.
        //   2. Google's favicon service at high resolution (sharp on the tile).
        //   3. A globe icon.
        // Some sites serve a generic favicon.ico that isn't their real logo —
        // notably Google apps, which all serve the multicolor Google "G" at
        // their domain even though Chrome shows the product logo (it reads the
        // page's declared icon). Map those hosts to the real product icon.
        const KNOWN_FAVICONS = {
            'mail.google.com':     'https://ssl.gstatic.com/ui/v1/icons/mail/rfr/gmail.ico',
            'gmail.com':           'https://ssl.gstatic.com/ui/v1/icons/mail/rfr/gmail.ico',
            'drive.google.com':    'https://ssl.gstatic.com/images/branding/product/1x/drive_2020q4_48dp.png',
            'docs.google.com':     'https://ssl.gstatic.com/docs/documents/images/kix-favicon7.ico',
            'calendar.google.com': 'https://calendar.google.com/googlecalendar/images/favicons_2020q4/calendar_31.ico'
        };
        function _faviconSources(url) {
            let host = '';
            try {
                const u = /^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : 'https://' + url;
                host = new URL(u).hostname.replace(/^www\./, '');
            } catch (_) {}
            if (!host) return [];
            const srcs = [
                `https://icons.duckduckgo.com/ip3/${host}.ico`,
                `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=128`
            ];
            // A known brand-logo override takes priority over the favicon services.
            if (KNOWN_FAVICONS[host]) srcs.unshift(KNOWN_FAVICONS[host]);
            // Best of all: the real page-declared icon Vulsor captured when this
            // site was visited (accurate for sites favicon services get wrong,
            // e.g. Google products like NotebookLM). Tried first.
            try { const cached = window.bwFaviconForHost && window.bwFaviconForHost(host); if (cached) srcs.unshift(cached); } catch (_) {}
            return srcs;
        }
        // Advance an icon <img> to its next fallback source; when exhausted,
        // reveal the globe glyph that follows it.
        window._favAdvance = function (img) {
            const f = (img.dataset.fb || '').split('|').filter(Boolean);
            if (f.length) { img.dataset.fb = f.slice(1).join('|'); img.src = f[0]; }
            else { img.style.display = 'none'; if (img.nextElementSibling) img.nextElementSibling.style.display = 'block'; }
        };
        // DuckDuckGo serves a fixed 48×48 gray "›" placeholder (HTTP 404, but a
        // valid PNG, so the browser renders it instead of firing onerror) for
        // sites it has no icon for. Detect it and fall through to the next source.
        window._favCheck = function (img) {
            if (img.src.indexOf('icons.duckduckgo.com') > -1 && img.naturalWidth === 48 && img.naturalHeight === 48) {
                window._favAdvance(img);
            }
        };
        function _siteIconHtml(site) {
            const srcs = _faviconSources(site.url);
            if (!srcs.length) return `<i class="fas fa-globe" style="color:#94a3b8; font-size:22px"></i>`;
            return `<img class="home-site-favicon" src="${srcs[0]}" alt="" loading="lazy" data-fb="${_escHtml(srcs.slice(1).join('|'))}" onerror="window._favAdvance(this)" onload="window._favCheck(this)"><i class="fas fa-globe" style="display:none; color:#94a3b8; font-size:22px"></i>`;
        }

        // ── Custom site: add / edit modal ──────────────────────
        function _openSiteEditor(site) {
            document.getElementById('home-site-modal')?.remove();
            const editing = !!site;
            const overlay = document.createElement('div');
            overlay.id = 'home-site-modal';
            overlay.style.cssText = 'position:fixed; inset:0; z-index:600; background:rgba(2,6,23,0.6); display:flex; align-items:center; justify-content:center;';
            overlay.innerHTML = `
                <div style="width:360px; max-width:90vw; background:#0f172a; border:1px solid rgba(255,255,255,0.12); border-radius:16px; padding:18px; box-shadow:0 24px 60px rgba(0,0,0,0.6)">
                    <div style="font-size:14px; font-weight:700; color:#e2e8f0; margin-bottom:14px">${editing ? 'Edit shortcut' : 'Add a website'}</div>
                    <label style="font-size:11px; color:#94a3b8">Name</label>
                    <input id="home-site-name" type="text" placeholder="GitHub" value="${editing ? _escHtml(site.name) : ''}"
                        style="width:100%; margin:4px 0 12px; background:#1e293b; border:1px solid rgba(255,255,255,0.1); border-radius:9px; padding:8px 10px; color:#e2e8f0; font-size:13px; outline:none">
                    <label style="font-size:11px; color:#94a3b8">Web address</label>
                    <input id="home-site-url" type="text" placeholder="github.com" value="${editing ? _escHtml(site.url) : ''}"
                        style="width:100%; margin:4px 0 4px; background:#1e293b; border:1px solid rgba(255,255,255,0.1); border-radius:9px; padding:8px 10px; color:#e2e8f0; font-size:13px; outline:none">
                    <div id="home-site-err" style="font-size:11px; color:#f87171; min-height:14px; margin-bottom:8px"></div>
                    <div style="display:flex; justify-content:space-between; align-items:center; gap:8px">
                        <button id="home-site-del" style="font-size:12px; color:#f87171; background:none; border:none; cursor:pointer; ${editing ? '' : 'visibility:hidden'}">Remove</button>
                        <div style="display:flex; gap:8px">
                            <button id="home-site-cancel" style="font-size:12px; color:#94a3b8; background:rgba(255,255,255,0.06); border:none; border-radius:8px; padding:7px 14px; cursor:pointer">Cancel</button>
                            <button id="home-site-save" style="font-size:12px; font-weight:600; color:#fff; background:var(--accent,#dc2626); border:none; border-radius:8px; padding:7px 16px; cursor:pointer">${editing ? 'Save' : 'Add'}</button>
                        </div>
                    </div>
                </div>`;
            document.body.appendChild(overlay);
            const nameEl = overlay.querySelector('#home-site-name');
            const urlEl  = overlay.querySelector('#home-site-url');
            const errEl  = overlay.querySelector('#home-site-err');
            setTimeout(() => nameEl.focus(), 30);

            const close = () => overlay.remove();
            const save = () => {
                let url = urlEl.value.trim();
                let name = nameEl.value.trim();
                if (!url) { errEl.textContent = 'Please enter a web address.'; return; }
                if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
                try { new URL(url); } catch (_) { errEl.textContent = 'That doesn’t look like a valid address.'; return; }
                if (!name) { try { name = new URL(url).hostname.replace(/^www\./, ''); } catch (_) { name = url; } }
                const sites = _homeSites();
                if (editing) {
                    const s = sites.find(x => x.id === site.id);
                    if (s) { s.name = name; s.url = url; }
                } else {
                    sites.push({ id: 'site_' + Date.now() + '_' + Math.random().toString(36).slice(2,6), name, url });
                }
                if (typeof saveSettingsData === 'function') saveSettingsData();
                close(); _buildHomePage();
            };
            overlay.querySelector('#home-site-save').addEventListener('click', save);
            overlay.querySelector('#home-site-cancel').addEventListener('click', close);
            overlay.querySelector('#home-site-del').addEventListener('click', () => { if (editing) { _removeSite(site.id); close(); } });
            [nameEl, urlEl].forEach(el => el.addEventListener('keydown', e => {
                if (e.key === 'Enter') save();
                else if (e.key === 'Escape') close();
            }));
            overlay.addEventListener('mousedown', e => { if (e.target === overlay) close(); });
        }

        function _removeSite(id) {
            settingsData.homeSites = _homeSites().filter(s => s.id !== id);
            if (Array.isArray(settingsData.homeItems))
                settingsData.homeItems = settingsData.homeItems.filter(it => !(it.t === 'site' && it.id === id));
            settingsData.archived = _archived().filter(k => k !== id);   // also drop from archived
            if (typeof saveSettingsData === 'function') saveSettingsData();
            _buildHomePage();
        }

        // Small reusable context menu. items: [{label, icon, danger?, act}]
        function _openTileMenu(items, x, y) {
            document.getElementById('home-tile-menu')?.remove();
            const menu = document.createElement('div');
            menu.id = 'home-tile-menu';
            menu.style.cssText = `position:fixed; left:${Math.min(x, window.innerWidth-160)}px; top:${Math.min(y, window.innerHeight-30-items.length*32)}px;
                z-index:600; background:#0f172a; border:1px solid rgba(255,255,255,0.12); border-radius:10px; padding:5px;
                box-shadow:0 12px 32px rgba(0,0,0,0.5); min-width:150px; display:flex; flex-direction:column;`;
            menu.innerHTML = items.map((it, i) =>
                `<button data-i="${i}" style="text-align:left; font-size:12px; color:${it.danger ? '#f87171' : '#e2e8f0'}; background:none; border:none; cursor:pointer; padding:7px 10px; border-radius:7px"><i class="fas ${it.icon} mr-2" style="width:14px"></i>${it.label}</button>`).join('');
            menu.querySelectorAll('button').forEach(b => {
                b.addEventListener('mouseenter', () => b.style.background = 'rgba(255,255,255,0.06)');
                b.addEventListener('mouseleave', () => b.style.background = 'none');
                b.addEventListener('click', () => { menu.remove(); items[b.dataset.i | 0].act(); });
            });
            document.body.appendChild(menu);
            setTimeout(() => {
                const onDoc = ev => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('mousedown', onDoc); } };
                document.addEventListener('mousedown', onDoc);
            }, 0);
        }

        // Right-click menu for a built-in app tile (Change icon / colour / Archive)
        function _openAppMenu(key, rawColor, x, y) {
            _openTileMenu([
                { label: 'Change icon…', icon: 'fa-icons', act: () => _openIconPicker(_categoryIcons()[key] || null, name => _setCategoryIcon(key, name)) },
                { label: 'Change colour…', icon: 'fa-palette', act: () => _openCategoryColorPicker(key, rawColor, x, y) },
                { label: 'Archive', icon: 'fa-box-archive', act: () => _archiveItem(key) },
            ], x, y);
        }

        // Right-click menu for a custom site tile (Edit / Open / Archive / Remove)
        function _openSiteMenu(site, x, y) {
            _openTileMenu([
                { label: 'Edit', icon: 'fa-pen', act: () => _openSiteEditor(site) },
                { label: 'Open', icon: 'fa-up-right-from-square', act: () => { if (typeof browserOpenUrl === 'function') browserOpenUrl(site.url); } },
                { label: 'Archive', icon: 'fa-box-archive', act: () => _archiveItem(site.id) },
                { label: 'Remove', icon: 'fa-trash', danger: true, act: () => _removeSite(site.id) },
            ], x, y);
        }

        // ── Home omnibox: search the web / go to an address ────
        function _wireHomeOmnibox() {
            const input = document.getElementById('home-omnibox-input');
            const go    = document.getElementById('home-omnibox-go');
            if (!input || input._wired) return;
            input._wired = true;
            const onGo = (q) => {
                q = (q || '').trim();
                if (!q) return;
                input.value = '';
                if (window.bwRecordSearch) window.bwRecordSearch(q);
                if (typeof browserOpenUrl === 'function') browserOpenUrl(q);
            };
            // Autocomplete dropdown — same engine as the browser address bar
            // (search suggestions, previous searches, history, "Ask Vulsor AI").
            const drop = document.getElementById('home-suggest');
            if (window.bwOmniboxAttach && drop) window.bwOmniboxAttach(input, drop, onGo, () => input.blur());
            else input.addEventListener('keydown', e => { if (e.key === 'Enter') onGo(input.value); else if (e.key === 'Escape') input.blur(); });
            go?.addEventListener('click', () => onGo(input.value));
        }
        _wireHomeOmnibox();

        // Allow other modules (settings.js) to trigger a home rebuild
        window.rebuildHomePage = _buildHomePage;

        // Small popup to recolor a category tile
        function _openCategoryColorPicker(key, currentColor, x, y) {
            document.getElementById('category-color-popup')?.remove();
            const def = APP_DEFS[key] || {};
            const pop = document.createElement('div');
            pop.id = 'category-color-popup';
            pop.style.cssText = `position:fixed; left:${Math.min(x, window.innerWidth-200)}px; top:${Math.min(y, window.innerHeight-110)}px;
                z-index:500; background:#0f172a; border:1px solid rgba(255,255,255,0.12); border-radius:12px;
                padding:12px; box-shadow:0 12px 32px rgba(0,0,0,0.5); display:flex; flex-direction:column; gap:8px; min-width:180px;`;
            pop.innerHTML = `
                <div style="font-size:11px; font-weight:600; color:#e2e8f0">${def.label || 'Category'} color</div>
                <div style="display:flex; align-items:center; gap:8px">
                    <input type="color" id="cat-color-input" value="${currentColor}"
                        style="width:36px; height:36px; border:none; background:transparent; padding:0; cursor:pointer; border-radius:8px">
                    <input type="text" id="cat-color-hex" value="${currentColor}"
                        style="flex:1; background:#1e293b; border:1px solid rgba(255,255,255,0.1); border-radius:8px; padding:6px 8px; color:#e2e8f0; font-size:12px; outline:none; font-family:monospace">
                </div>
                <div style="display:flex; justify-content:space-between; align-items:center">
                    <button id="cat-color-reset" style="font-size:11px; color:#94a3b8; background:none; border:none; cursor:pointer">Reset</button>
                    <button id="cat-color-done" style="font-size:11px; font-weight:600; color:#fff; background:var(--accent,#dc2626); border:none; border-radius:7px; padding:5px 12px; cursor:pointer">Done</button>
                </div>`;
            document.body.appendChild(pop);

            const colorInput = pop.querySelector('#cat-color-input');
            const hexInput   = pop.querySelector('#cat-color-hex');
            const setColor = (hex) => {
                if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return;
                if (!settingsData.categoryColors) settingsData.categoryColors = {};
                settingsData.categoryColors[key] = hex;
                if (typeof saveSettingsData === 'function') saveSettingsData();
                _buildHomePage();
            };
            colorInput.addEventListener('input', () => { hexInput.value = colorInput.value; setColor(colorInput.value); });
            hexInput.addEventListener('input', () => setColor(hexInput.value.trim()));
            pop.querySelector('#cat-color-reset').addEventListener('click', () => {
                if (settingsData.categoryColors) delete settingsData.categoryColors[key];
                if (typeof saveSettingsData === 'function') saveSettingsData();
                _buildHomePage();
                pop.remove();
            });
            pop.querySelector('#cat-color-done').addEventListener('click', () => pop.remove());

            // Dismiss on outside click
            setTimeout(() => {
                const onDoc = (ev) => {
                    if (!pop.contains(ev.target)) { pop.remove(); document.removeEventListener('mousedown', onDoc); }
                };
                document.addEventListener('mousedown', onDoc);
            }, 0);
        }

        function _updateHomeGreeting() {
            const h = new Date().getHours();
            const greet = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
            const el = document.getElementById('home-greeting-text');
            if (el) el.textContent = greet;
        }

        // ── Weather widget (IP geolocation + Open-Meteo, no API key) ──
        function _wmoCode(code) {
            const m = {
                0:['fa-sun','Clear'], 1:['fa-cloud-sun','Mainly clear'], 2:['fa-cloud-sun','Partly cloudy'],
                3:['fa-cloud','Overcast'], 45:['fa-smog','Fog'], 48:['fa-smog','Fog'],
                51:['fa-cloud-rain','Light drizzle'], 53:['fa-cloud-rain','Drizzle'], 55:['fa-cloud-rain','Drizzle'],
                56:['fa-cloud-rain','Freezing drizzle'], 57:['fa-cloud-rain','Freezing drizzle'],
                61:['fa-cloud-rain','Light rain'], 63:['fa-cloud-showers-heavy','Rain'], 65:['fa-cloud-showers-heavy','Heavy rain'],
                66:['fa-cloud-rain','Freezing rain'], 67:['fa-cloud-rain','Freezing rain'],
                71:['fa-snowflake','Light snow'], 73:['fa-snowflake','Snow'], 75:['fa-snowflake','Heavy snow'],
                77:['fa-snowflake','Snow grains'], 80:['fa-cloud-rain','Showers'], 81:['fa-cloud-showers-heavy','Showers'],
                82:['fa-cloud-showers-heavy','Heavy showers'], 85:['fa-snowflake','Snow showers'], 86:['fa-snowflake','Snow showers'],
                95:['fa-bolt','Thunderstorm'], 96:['fa-bolt','Thunderstorm'], 99:['fa-bolt','Thunderstorm'],
            };
            return m[code] || ['fa-cloud', '—'];
        }
        let _weatherCache = null, _weatherTs = 0;
        async function renderHomeWeather(force) {
            const el = document.getElementById('home-weather');
            if (!el) return;
            if (!force && _weatherCache && Date.now() - _weatherTs < 15 * 60 * 1000) {
                el.innerHTML = _weatherCache; return;
            }
            try {
                const { ipcRenderer } = require('electron');
                const r = await ipcRenderer.invoke('get-weather');
                if (!r || !r.ok || r.temp == null) throw new Error(r && r.error || 'no data');
                const deg = r.unit === 'fahrenheit' ? '°F' : '°C';
                const temp = Math.round(r.temp);
                const [icon, label] = _wmoCode(r.code);
                const city = r.city ? ` · ${r.city}` : '';
                const html = `<i class="fas ${icon}" style="color:var(--accent-light)"></i>
                    <span class="text-slate-400 text-xs">${temp}${deg} · ${label}${city}</span>`;
                _weatherCache = html; _weatherTs = Date.now();
                el.innerHTML = html;
            } catch (e) {
                el.innerHTML = `<span class="text-slate-600 text-xs">Weather unavailable</span>`;
            }
        }

        // ── Boot ───────────────────────────────────────────────
        _buildHomePage();
        _updateHomeGreeting();
        renderHomeWeather();
        const homeId = _makeId();
        const _urlParams = new URLSearchParams(window.location.search);
        const _startApp  = _urlParams.get('app');
        if (_startApp && APP_DEFS[_startApp]) {
            _tabs.push({ id: homeId, key: _startApp, instanceData: {} });
            _activeId = homeId;
            _activateView(_startApp);
        } else {
            _tabs.push({ id: homeId, key: 'home', instanceData: {} });
            _activeId = homeId;
            _activateView('home');
        }
        _renderTabStrip();

        // + New tab button — always opens a fresh home tab
        const newTabBtn = document.getElementById('new-tab-btn');
        if (newTabBtn) newTabBtn.addEventListener('click', () => {
            const id = _makeId();
            _tabs.push({ id, key: 'home', instanceData: {} });
            _switchToTab(id);
        });

        // Home button in toolbar — navigate current tab back to home
        const homeBtn = document.getElementById('browser-home-btn');
        if (homeBtn) homeBtn.addEventListener('click', () => {
            const tab = _tabs.find(t => t.id === _activeId);
            if (tab) {
                if (tab.key === 'vault') _saveVaultTabState(tab);
                tab.key = 'home'; tab.label = null; tab.instanceData = {};
                _activateView('home'); _renderTabStrip();
            }
        });

        // ── New window ────────────────────────────────────────
        document.getElementById('new-window-btn').onclick = () => ipcRenderer.send('new-window');

        // ── Share app ──────────────────────────────────────────
        document.getElementById('share-app-btn').onclick = () => {
            const shareBtn   = document.getElementById('share-app-btn');
            const projectDir = path.normalize(path.join(process.execPath, '..', '..', '..', '..', '..'));
            const desktopDir = path.join(require('os').homedir(), 'Desktop');
            const outZip     = path.join(desktopDir, 'Vulsor.zip');

            const setLabel = (html) => { shareBtn.innerHTML = html; };
            const fail = msg => {
                shareBtn.disabled = false;
                setLabel('<i class="fas fa-share-alt text-xs"></i>');
                alert('Share failed: ' + msg);
            };

            shareBtn.disabled = true;
            setLabel('<i class="fas fa-circle-notch fa-spin text-xs"></i>');

            // Step 1: rebuild the Mac app so it's always the latest version
            exec(`cd "${projectDir}" && npm run build`, { timeout: 300000 }, err => {
                if (err) { fail(err.message); return; }

                setLabel('<i class="fas fa-file-zipper fa-spin text-xs"></i>');

                // Step 2: zip ONLY Vulsor.app using ditto (preserves macOS resource forks)
                // Result: Vulsor.zip → contains just Vulsor.app, ready to double-click and run
                const appBundle = path.join(projectDir, 'Vulsor-darwin-arm64', 'Vulsor.app');
                exec(`ditto -c -k --sequesterRsrc --keepParent "${appBundle}" "${outZip}"`, err => {
                    shareBtn.disabled = false;
                    if (err) { fail(err.message); return; }

                    setLabel('<i class="fas fa-check text-xs"></i>');
                    setTimeout(() => setLabel('<i class="fas fa-share-alt text-xs"></i>'), 2500);

                    // Reveal Vulsor.zip in Finder so user can AirDrop / iMessage / copy it
                    exec(`open -R "${outZip}"`);
                });
            });
        };

        // ── Image attachment ───────────────────────────────────
        document.getElementById('photo-btn').onclick = () =>
            document.getElementById('image-input').click();

        document.getElementById('remove-image-btn').onclick = clearImage;

        document.getElementById('image-input').onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                currentImageDataUrl = ev.target.result;
                currentImageBase64  = currentImageDataUrl.split(',')[1];
                document.getElementById('image-preview').src = currentImageDataUrl;
                document.getElementById('image-preview-container').classList.remove('hidden');
            };
            reader.readAsDataURL(file);
        };

        // ── Send message ───────────────────────────────────────
        document.getElementById('new-chat-btn').onclick = startNewChat;

        // Toggle send button between "send" (red, arrow) and "stop" (slate, square).
        // While the AI is generating, clicking the button cancels the request.
        function setSendButtonMode(mode) {
            const btn = document.getElementById('send-btn');
            const icon = btn.querySelector('i');
            if (mode === 'stop') {
                icon.className = 'fas fa-stop text-sm';
                btn.title = 'Stop generation';
                btn.onclick = cancelGeneration;
                btn.classList.remove('bg-red-600', 'hover:bg-red-700', 'active:bg-red-800', 'shadow-red-600/20');
                btn.classList.add('bg-slate-700', 'hover:bg-slate-600', 'shadow-slate-700/20');
            } else {
                icon.className = 'fas fa-arrow-up text-sm';
                btn.title = '';
                btn.onclick = sendMessage;
                btn.classList.remove('bg-slate-700', 'hover:bg-slate-600', 'shadow-slate-700/20');
                btn.classList.add('bg-red-600', 'hover:bg-red-700', 'active:bg-red-800', 'shadow-red-600/20');
            }
        }

        async function sendMessage() {
            const text = userInput.value.trim();
            if (!text && !currentImageBase64) return;

            const imageDataUrl = currentImageDataUrl;
            const imageBase64  = currentImageBase64;
            const messageText  = text || 'Please describe this image.';

            addMessageToUI('You', text, imageDataUrl);
            userInput.value = '';
            userInput.style.height = '';
            clearImage();

            if (imageDataUrl) {
                const lastUser = [...chatHistory].reverse().find(m => m.role === 'user');
                if (lastUser) lastUser.imageDataUrl = imageDataUrl;
            }

            setSendButtonMode('stop');
            showTyping();
            const reply = await generate(messageText, imageBase64);
            const indicator = document.getElementById('typing-indicator');
            if (indicator) indicator.remove();
            setSendButtonMode('send');
            addMessageToUI('AI', reply);
        }

        document.getElementById('send-btn').onclick = sendMessage;
        userInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
        });

        // ── Module init ────────────────────────────────────────
        loadCommands();
        initCommands();

        loadTodos();
        loadCategories();
        migrateLists();
        initTodos();

        initStudy();
        initVault();
        if (typeof initVaultAI === 'function') initVaultAI();
        initFinance();
        if (typeof initWorkout  === 'function') initWorkout();
        if (typeof initNews     === 'function') initNews();
        if (typeof initCourses  === 'function') initCourses();
        if (typeof initResearch === 'function') initResearch();
        if (typeof initMail     === 'function') initMail();
        if (typeof initNetwork  === 'function') initNetwork();
        if (typeof initSudoku   === 'function') initSudoku();
        initJournal();
        if (typeof initLab === 'function') initLab();
        if (typeof initWriter === 'function') initWriter();
        loadCountdowns();
        initCountdown();
        initSettings();
        _buildHomePage();  // rebuild with saved category colors now that settings are loaded
        initVoice();
        if (typeof initWhatsAppBot === 'function') initWhatsAppBot();
        initCalendarPage();

        loadStudio();
        initStudio();
        loadKaraoke();

        // ── Window drag from the top chrome bar only ────────────
        // The window can only be moved by grabbing the top bar (#browser-chrome:
        // the tab strip + toolbar). Mousedowns elsewhere in the content area are
        // ignored. Interactive elements inside the top bar are still skipped.
        (function initWindowDrag() {
            let _wd = null; // drag state: { screenX, screenY }

            function _interactive(el) {
                // Walk up from the clicked element; stop at body
                for (let e = el; e && e !== document.body; e = e.parentElement) {
                    const tag = e.tagName ? e.tagName.toLowerCase() : '';
                    if (['button','input','textarea','select','a','canvas','video','audio','label'].includes(tag)) return true;
                    if (e.isContentEditable) return true;
                    if (e.getAttribute('role') === 'button') return true;
                    if (e.classList && (e.classList.contains('no-drag') || e.classList.contains('ace_editor'))) return true;
                    // Anything the browser shows as a pointer or text cursor is interactive
                    const cur = window.getComputedStyle(e).cursor;
                    if (['pointer','text','crosshair','grab','grabbing','col-resize','row-resize','ew-resize','ns-resize','nwse-resize','nesw-resize'].includes(cur)) return true;
                }
                return false;
            }

            document.addEventListener('mousedown', e => {
                if (e.button !== 0) return;
                // Only allow dragging the window from the top chrome bar.
                if (!e.target.closest || !e.target.closest('#browser-chrome')) return;
                if (_interactive(e.target)) return;
                _wd = { screenX: e.screenX, screenY: e.screenY };
                ipcRenderer.send('win-drag-start', { screenX: e.screenX, screenY: e.screenY });
            }, { passive: true });

            document.addEventListener('mousemove', e => {
                if (!_wd) return;
                ipcRenderer.send('win-drag-move', { screenX: e.screenX, screenY: e.screenY });
            }, { passive: true });

            document.addEventListener('mouseup', () => {
                if (_wd) { _wd = null; ipcRenderer.send('win-drag-end'); }
            }, { passive: true });
        })();

        // ── Global clock ───────────────────────────────────────
        (function startGlobalClock() {
            const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
            function tick() {
                const now = new Date();
                const dayEl  = document.getElementById('global-clock-day');
                const dateEl = document.getElementById('global-clock-date');
                const timeEl = document.getElementById('global-clock-time');
                if (!dayEl) return;
                dayEl.textContent  = DAYS[now.getDay()];
                dateEl.textContent = now.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
                timeEl.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
            }
            tick();
            setInterval(tick, 1000);
        })();

    } catch (err) {
        document.body.innerHTML = `<div class="p-10 text-red-500 font-mono text-sm bg-black h-screen whitespace-pre-wrap">[CRASH] ${err.stack}</div>`;
    }
});
