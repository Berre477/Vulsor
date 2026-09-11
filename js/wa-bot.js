// ── WhatsApp Assistant (renderer) ───────────────────────────────────────
// UI + glue for the two-way WhatsApp auto-reply bot. The actual WhatsApp
// connection runs in the main process (wa-bot.js at the repo root); this file
// just drives it over IPC and renders the control panel.
//
// Globals used (declared in globals.js): ipcRenderer, execAsync, fs, path, os, MODEL.

(function () {
    const SKEY = 'wa-bot-settings';
    let cfg = { enabled: false, contacts: [], ownerName: '', instruction: '', provider: 'ollama', delivery: 'app' };

    const $ = id => document.getElementById(id);

    function load() {
        try { const s = JSON.parse(localStorage.getItem(SKEY)); if (s && typeof s === 'object') cfg = Object.assign(cfg, s); } catch (_) {}
        if (!Array.isArray(cfg.contacts)) cfg.contacts = [];
    }
    function save() { try { localStorage.setItem(SKEY, JSON.stringify(cfg)); } catch (_) {} }

    function numbers() { return cfg.contacts.map(c => c.number).filter(Boolean); }
    function startPayload() {
        return {
            model: (typeof MODEL !== 'undefined' ? MODEL : 'qwen3:8b'),
            whitelist: numbers(),
            ownerName: cfg.ownerName || '',
            instruction: cfg.instruction || '',
            provider: cfg.provider || 'ollama',
            delivery: cfg.delivery || 'app',
            // Only ever sent when the user has just typed one. An empty string
            // means "keep the saved key", so this can't wipe it.
            geminiKey: _pendingKey,
        };
    }
    let _pendingKey = '';

    // ── UI helpers ─────────────────────────────────────────────────────────
    function logLine(text, color) {
        const box = $('wa-bot-log'); if (!box) return;
        if (box.textContent === 'Idle.') box.textContent = '';
        const ts = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const div = document.createElement('div');
        div.style.color = color || '#94a3b8';
        div.textContent = `[${ts}] ${text}`;
        box.appendChild(div);
        box.scrollTop = box.scrollHeight;
        while (box.children.length > 80) box.removeChild(box.firstChild);
    }

    function setStatusPill(status) {
        const pill = $('wa-bot-status-pill');
        const map = {
            stopped:    ['Off',          'rgba(148,163,184,.14)', '#94a3b8'],
            connecting: ['Connecting…',  'rgba(234,179,8,.16)',   '#eab308'],
            qr:         ['Scan QR',      'rgba(234,179,8,.16)',   '#eab308'],
            online:     ['Live',         'rgba(34,197,94,.16)',   '#22c55e'],
            error:      ['Error',        'rgba(239,68,68,.16)',   '#f87171']
        };
        const [label, bg, fg] = map[status] || map.stopped;
        if (pill) { pill.textContent = label; pill.style.background = bg; pill.style.color = fg; }
        const toggle = $('wa-bot-toggle');
        if (toggle) {
            const running = status === 'online' || status === 'connecting' || status === 'qr';
            toggle.textContent = running ? 'Stop assistant' : 'Start assistant';
            toggle.style.background = running ? 'rgba(239,68,68,.16)' : '#16a34a';
            toggle.style.color = running ? '#f87171' : '#fff';
            toggle.dataset.running = running ? '1' : '';
        }
    }

    function showQr(dataUrl) {
        const box = $('wa-bot-qr-box'), img = $('wa-bot-qr-img');
        if (!box || !img) return;
        if (dataUrl) { img.src = dataUrl; box.style.display = 'flex'; }
        else { box.style.display = 'none'; img.removeAttribute('src'); }
    }

    function renderList() {
        const wrap = $('wa-bot-list'), empty = $('wa-bot-list-empty');
        if (!wrap) return;
        wrap.innerHTML = '';
        if (!cfg.contacts.length) { if (empty) empty.style.display = 'block'; return; }
        if (empty) empty.style.display = 'none';
        cfg.contacts.forEach((c, i) => {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:center;gap:8px;background:rgb(var(--slate-400) / .07);border:1px solid rgb(var(--slate-400) / .1);border-radius:9px;padding:7px 10px';
            row.innerHTML = `<i class="fas fa-user" style="color:rgb(var(--tw-green-500));font-size:10px"></i>
                <span style="flex:1;color:rgb(var(--slate-200));font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${(c.label || c.number).replace(/</g, '&lt;')}</span>
                <span style="color:rgb(var(--slate-500));font-size:11px">+${c.number}</span>`;
            // Start a conversation with this person, rather than waiting for them
            // to message first — which is all the bot could ever do before.
            const go = document.createElement('button');
            go.innerHTML = '<i class="fas fa-comment-dots" style="margin-right:5px"></i>Start chat';
            go.title = 'Have the AI message ' + (c.label || c.number) + ' first';
            go.style.cssText = 'background:rgba(34,197,94,.14);border:1px solid rgba(34,197,94,.3);color:rgb(var(--tw-green-400));'
                             + 'cursor:pointer;font-size:11px;font-weight:600;padding:4px 9px;border-radius:7px;white-space:nowrap';
            go.onclick = () => openChat(c);
            row.appendChild(go);

            const rm = document.createElement('button');
            rm.innerHTML = '<i class="fas fa-xmark"></i>';
            rm.title = 'Remove';
            rm.style.cssText = 'background:none;border:none;color:rgb(var(--slate-500));cursor:pointer;font-size:12px;padding:2px 4px';
            rm.onclick = () => {
                cfg.contacts.splice(i, 1); save(); renderList(); pushConfig();
                try { ipcRenderer.invoke('wa-bot:reset-chat', { number: c.number }); } catch (_) {}
            };
            row.appendChild(rm);
            wrap.appendChild(row);
        });
    }

    // Ask what the conversation is for, then let the model open it. The bot has to
    // be linked and running first — otherwise there's no session to send through.
    async function openChat(c) {
        const who = c.label || ('+' + c.number);
        const topic = await vulsorPrompt(`What should the AI talk to ${who} about?`, '', {
            hint: 'It writes the first message itself and keeps the conversation going from there.',
            placeholder: 'e.g. ask if he\'s free to help move on Saturday',
            multiline: true,
            confirmLabel: 'Start chat',
        });
        if (topic === null) return;                      // cancelled
        logLine(`Starting a conversation with ${who}…`, '#94a3b8');
        const ask = extra => ipcRenderer.invoke('wa-bot:open-chat',
            Object.assign({ number: c.number, topic: topic.trim() }, extra || {}));

        let r;
        try { r = await ask(); }
        catch (e) { logLine('Could not start it: ' + e.message, '#f87171'); return; }

        // Not linked yet? Bring the assistant up and hold the message, instead of
        // telling you to go and do it yourself — pressing the button IS the intent.
        if (r && r.reason === 'offline') {
            logLine('Connecting WhatsApp first…', '#94a3b8');
            try { applyStatus(await ipcRenderer.invoke('wa-bot:start', startPayload())); }
            catch (e) { logLine('Could not start the assistant: ' + e.message, '#f87171'); return; }
            try { r = await ask({ queue: true }); }
            catch (e) { logLine('Could not start it: ' + e.message, '#f87171'); return; }
            if (r && r.queued) {
                logLine(`Queued for ${who} — it sends the moment WhatsApp connects.`, '#eab308');
                logLine('Scan the QR code above with your phone to finish linking.', '#eab308');
                if (!cfg.contacts.some(x => x.number === c.number)) { cfg.contacts.push(c); save(); renderList(); }
                return;
            }
        }

        if (!r || !r.ok) {
            const why = {
                'bad-number':   'That contact has an unusable number.',
                'no-accessibility': 'WhatsApp opened with the message ready, but Vulsor could not press send. '
                                  + 'Allow Vulsor under System Settings → Privacy & Security → Accessibility, then try again '
                                  + '(or just press Enter in WhatsApp — the text is already there).',
                'ai-error':     'The model did not answer: ' + ((r && r.error) || ''),
                'empty-opener': 'The model came back with nothing to send.',
                'send-failed':  'WhatsApp refused the message: ' + ((r && r.error) || ''),
            }[r && r.reason] || 'Could not start that conversation.';
            logLine(why, '#f87171');
            return;
        }
        // Whitelisted on the main side so the reply is answered — mirror that here
        // so the setting the UI pushes on the next config change doesn't undo it.
        if (!cfg.contacts.some(x => x.number === c.number)) { cfg.contacts.push(c); save(); renderList(); }
        pushConfig();
    }

    // Resolve a typed value (a phone number OR a contact name) to { label, number }.
    async function resolveContact(input) {
        const raw = input.trim();
        if (/\d/.test(raw) && raw.replace(/[^\d]/g, '').length >= 7 && !/[a-z]/i.test(raw)) {
            return { label: raw, number: raw.replace(/[^\d]/g, '') };
        }
        // Looks like a name → look it up in macOS Contacts.
        const esc = s => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        const script = `tell application "Contacts"
  set matches to (every person whose name contains "${esc(raw)}")
  if (count of matches) is 0 then return "NOTFOUND"
  set p to item 1 of matches
  set phs to phones of p
  if (count of phs) is 0 then return "NOPHONE"
  repeat with x in phs
    set lbl to ((label of x) as text)
    if lbl contains "mobile" or lbl contains "iphone" then return ((name of p) & "||" & (value of x))
  end repeat
  return ((name of p) & "||" & (value of item 1 of phs))
end tell`;
        try {
            const tmp = path.join(os.tmpdir(), 'vulsor_wa_wl_lookup.applescript');
            fs.writeFileSync(tmp, script, 'utf8');
            const out = (await execAsync(`osascript "${tmp}"`, { timeout: 15000 })).stdout.trim();
            if (out === 'NOTFOUND') return { error: `No contact named "${raw}" in your Contacts.` };
            if (out === 'NOPHONE')  return { error: `"${raw}" has no phone number saved.` };
            const [name, num] = out.split('||');
            let d = (num || '').replace(/[^\d]/g, '');
            if (d.startsWith('00')) d = d.slice(2);
            if (d.length < 7) return { error: `"${raw}" has an unusable phone number.` };
            return { label: name || raw, number: d };
        } catch (e) {
            return { error: 'Contacts lookup failed (grant Vulsor access to Contacts): ' + e.message };
        }
    }

    async function addContact() {
        const inp = $('wa-bot-add-input'); if (!inp) return;
        const val = inp.value.trim(); if (!val) return;
        const btn = $('wa-bot-add-btn'); const old = btn ? btn.textContent : '';
        if (btn) { btn.textContent = '…'; btn.disabled = true; }
        const r = await resolveContact(val);
        if (btn) { btn.textContent = old; btn.disabled = false; }
        if (r.error) { logLine(r.error, '#f87171'); return; }
        if (!cfg.contacts.some(c => c.number === r.number)) {
            cfg.contacts.push(r); save(); renderList(); pushConfig();
            logLine(`Added ${r.label} (+${r.number}).`, '#22c55e');
        }
        inp.value = '';
    }

    function readFields() {
        cfg.ownerName   = ($('wa-bot-owner')       || {}).value || '';
        cfg.instruction = ($('wa-bot-instruction') || {}).value || '';
        cfg.provider    = ($('wa-bot-provider')    || {}).value || 'ollama';
        cfg.delivery    = ($('wa-bot-delivery')    || {}).value || 'app';
        const keyInput = $('wa-bot-gemini-key');
        if (keyInput && keyInput.value.trim()) {
            _pendingKey = keyInput.value.trim();
            keyInput.value = '';              // never keep it sitting in the DOM
        }
        save();
    }

    // Spell out what the chosen delivery route can and can't do — the difference
    // between them is exactly "can it hear the reply", which is worth stating.
    function syncDeliveryUI() {
        const sel = $('wa-bot-delivery');
        if (sel) sel.value = cfg.delivery || 'app';
        const note = $('wa-bot-delivery-note');
        const toggle = $('wa-bot-toggle');
        const app = (cfg.delivery || 'app') === 'app';
        if (note) {
            note.textContent = app
                ? 'Sends through the WhatsApp app you are already signed into — nothing to link. It cannot see incoming messages this way, so it will not reply on its own. Needs Vulsor allowed under Privacy & Security → Accessibility.'
                : 'Vulsor becomes its own linked device, so it both sends AND reads replies.';
        }
        // Replying is a separate capability from sending: it needs the linked
        // session either way, so the button stays available and says so. Hiding
        // it in app mode left no way to turn replies on at all.
        if (toggle && !toggle.dataset.running) {
            toggle.textContent = app ? 'Turn on replies (link once)' : 'Start assistant';
            toggle.title = app
                ? 'Sending uses the WhatsApp app. Answering their replies needs Vulsor linked as a device — one QR scan, once.'
                : '';
        }
    }

    // Show the key field only when Gemini is the chosen brain.
    function syncProviderUI(hasKey) {
        const sel = $('wa-bot-provider');
        if (sel) sel.value = cfg.provider || 'ollama';
        const row = $('wa-bot-gemini-row');
        if (row) row.style.display = (cfg.provider === 'gemini') ? 'block' : 'none';
        const state = $('wa-bot-key-state');
        if (state) state.textContent = hasKey ? '— saved, type a new one to replace' : '';
    }

    function pushConfig() {
        readFields();
        try {
            ipcRenderer.invoke('wa-bot:config', startPayload()).then(st => {
                _pendingKey = '';                 // handed over — don't send it again
                if (st) syncProviderUI(st.hasGeminiKey);
            }).catch(() => {});
        } catch (_) {}
    }

    function applyStatus(s) {
        if (!s) return;
        setStatusPill(s.status);
        showQr(s.status === 'qr' ? s.qr : null);
        if (s.provider) cfg.provider = s.provider;
        if (s.delivery) cfg.delivery = s.delivery;
        syncProviderUI(s.hasGeminiKey);
        syncDeliveryUI();
        if (s.error && s.status === 'error') logLine(s.error, '#f87171');
    }

    // ── actions ─────────────────────────────────────────────────────────────
    async function start() {
        if (!numbers().length) { logLine('Add at least one allowed contact first.', '#eab308'); return; }
        readFields();
        cfg.enabled = true; save();
        logLine('Starting…');
        try { applyStatus(await ipcRenderer.invoke('wa-bot:start', startPayload())); }
        catch (e) { logLine('Start failed: ' + e.message, '#f87171'); }
    }
    async function stop() {
        cfg.enabled = false; save();
        try { applyStatus(await ipcRenderer.invoke('wa-bot:stop')); } catch (_) {}
        logLine('Stopped.');
    }
    async function unlink() {
        cfg.enabled = false; save();
        try { applyStatus(await ipcRenderer.invoke('wa-bot:unlink')); } catch (_) {}
        showQr(null); logLine('Unlinked this device from WhatsApp.', '#f87171');
    }

    function open() {
        const ov = $('wa-bot-overlay'); if (!ov) return;
        if ($('wa-bot-owner'))       $('wa-bot-owner').value = cfg.ownerName || '';
        if ($('wa-bot-instruction')) $('wa-bot-instruction').value = cfg.instruction || '';
        renderList();
        ov.style.display = 'flex';
        ipcRenderer.invoke('wa-bot:status').then(applyStatus).catch(() => {});
    }
    function close() { const ov = $('wa-bot-overlay'); if (ov) ov.style.display = 'none'; }

    function initWhatsAppBot() {
        load();
        const btn = $('wa-bot-btn');          if (btn) btn.onclick = open;
        const closeBtn = $('wa-bot-close');   if (closeBtn) closeBtn.onclick = close;
        const ov = $('wa-bot-overlay');       if (ov) ov.addEventListener('mousedown', e => { if (e.target === ov) close(); });
        const addBtn = $('wa-bot-add-btn');   if (addBtn) addBtn.onclick = addContact;
        const addInp = $('wa-bot-add-input'); if (addInp) addInp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addContact(); } });
        const owner = $('wa-bot-owner');      if (owner) owner.addEventListener('change', pushConfig);
        const instr = $('wa-bot-instruction'); if (instr) instr.addEventListener('change', pushConfig);
        const prov  = $('wa-bot-provider');    if (prov)  prov.addEventListener('change', () => { cfg.provider = prov.value; save(); syncProviderUI(); pushConfig(); });
        const gkey  = $('wa-bot-gemini-key');  if (gkey)  gkey.addEventListener('change', pushConfig);
        const deliv = $('wa-bot-delivery');    if (deliv) deliv.addEventListener('change', () => { cfg.delivery = deliv.value; save(); syncDeliveryUI(); pushConfig(); });
        syncProviderUI();
        syncDeliveryUI();
        const unlinkBtn = $('wa-bot-unlink'); if (unlinkBtn) unlinkBtn.onclick = unlink;
        const toggle = $('wa-bot-toggle');
        if (toggle) toggle.onclick = () => { (toggle.dataset.running ? stop() : start()); };

        // Live events from the main-process bot.
        try {
            ipcRenderer.on('wa-bot:event', (_e, ev) => {
                if (!ev) return;
                if (ev.type === 'status') {
                    setStatusPill(ev.status);
                    if (ev.status === 'qr') showQr(ev.qr);
                    else if (ev.status === 'online' || ev.status === 'stopped') showQr(null);
                    if (ev.status === 'online') logLine('Connected — listening for messages.', '#22c55e');
                    if (ev.reason === 'logged-out') logLine('Your phone unlinked this device.', '#f87171');
                    if (ev.error) logLine(ev.error, '#f87171');
                } else if (ev.type === 'qr') {
                    showQr(ev.dataUrl || ev.qr || null);
                } else if (ev.type === 'log') {
                    if (ev.error) { logLine(ev.error, '#f87171'); return; }
                    const who = (ev.jid || '').split('@')[0];
                    if (ev.dir === 'in')  logLine(`← +${who}: ${ev.text}`, '#94a3b8');
                    if (ev.dir === 'out') logLine(`→ +${who}: ${ev.text}`, '#22c55e');
                }
            });
        } catch (_) {}

        // Re-arm automatically if it was running last session (the WhatsApp link
        // is persisted in the main process, so no new QR scan is needed).
        if (cfg.enabled && numbers().length) {
            ipcRenderer.invoke('wa-bot:start', startPayload()).then(applyStatus).catch(() => {});
        }
    }

    window.initWhatsAppBot = initWhatsAppBot;
})();
