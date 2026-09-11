// ── AI providers — one chat interface over Ollama, Claude, OpenAI, Gemini… ──
// Depends on: globals.js (fs, path, ipcRenderer, DOCUMENTS_PATH, MODEL, readJsonStrict, writeJsonSafe)
//
// The chat used to speak only to a local Ollama. This module is the single
// place that knows how to talk to a model: ai.js hands it the conversation
// and gets text back, whatever is selected in the picker. Adding a provider
// means adding one entry to AI_PROVIDERS and one `complete` function.
//
// Keys never touch disk in the clear: they go through the main process's
// safeStorage (the same mechanism the password manager uses) and only the
// encrypted blob is written to ai.json. If safeStorage isn't available on a
// machine, the key is kept for the session only and the picker says so.

const AI_FILE = path.join(DOCUMENTS_PATH, 'ai.json');

const AI_PROVIDERS = {
    // Vulsor's own local model — served by Ollama under the hood. The id stays
    // 'ollama' so saved settings keep working; only the label is branded.
    ollama: {
        name: 'Vulsor (local)', icon: 'fa-bolt', needsKey: false,
        hint: 'Vulsor\'s built-in model runs on this machine (through Ollama). Nothing leaves it.',
        models: [],                              // filled from the Ollama API
        defaultModel: MODEL,
    },
    anthropic: {
        name: 'Claude', icon: 'fa-a', needsKey: true, keyPlaceholder: 'sk-ant-…',
        keyUrl: 'https://console.anthropic.com/settings/keys',
        hint: 'Anthropic API key.',
        models: [
            { id: 'claude-opus-5',     label: 'Claude Opus 5' },
            { id: 'claude-sonnet-5',   label: 'Claude Sonnet 5' },
            { id: 'claude-fable-5-1',  label: 'Claude Fable 5.1' },
            { id: 'claude-haiku-4-5',  label: 'Claude Haiku 4.5' },
        ],
        defaultModel: 'claude-opus-5',
    },
    openai: {
        name: 'ChatGPT (OpenAI)', icon: 'fa-comment-dots', needsKey: true, keyPlaceholder: 'sk-…',
        keyUrl: 'https://platform.openai.com/api-keys',
        hint: 'OpenAI API key.',
        models: [
            { id: 'gpt-5',      label: 'GPT-5' },
            { id: 'gpt-5-mini', label: 'GPT-5 mini' },
            { id: 'gpt-4.1',    label: 'GPT-4.1' },
            { id: 'gpt-4o',     label: 'GPT-4o' },
            { id: 'o3',         label: 'o3' },
        ],
        defaultModel: 'gpt-5',
    },
    gemini: {
        name: 'Gemini (Google)', icon: 'fa-gem', needsKey: true, keyPlaceholder: 'AIza…',
        keyUrl: 'https://aistudio.google.com/app/apikey',
        hint: 'Google AI Studio API key.',
        models: [
            { id: 'gemini-2.5-pro',   label: 'Gemini 2.5 Pro' },
            { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
            { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
        ],
        defaultModel: 'gemini-2.5-pro',
    },
    custom: {
        name: 'Other (OpenAI-compatible)', icon: 'fa-plug', needsKey: true, keyPlaceholder: 'API key (leave empty if the server needs none)',
        hint: 'Any server that speaks the OpenAI chat-completions API: OpenRouter, Groq, Mistral, DeepSeek, xAI, Together, LM Studio…',
        models: [],
        defaultModel: '',
        needsBaseUrl: true,
    },
};

// Settings: which provider/model is active, per-provider model overrides,
// encrypted keys, custom base URL.
let aiSettings = { provider: 'ollama', models: {}, keys: {}, keysPlain: {}, customBaseUrl: '' };
const _aiKeyCache = {};                         // decrypted, in memory only

function aiLoadSettings() {
    try {
        if (fs.existsSync(AI_FILE)) aiSettings = { ...aiSettings, ...readJsonStrict(AI_FILE) };
    } catch (_) {}
    if (!AI_PROVIDERS[aiSettings.provider]) aiSettings.provider = 'ollama';
    if (!aiSettings.models || typeof aiSettings.models !== 'object') aiSettings.models = {};
    if (!aiSettings.keys   || typeof aiSettings.keys   !== 'object') aiSettings.keys = {};
    if (!aiSettings.keysPlain || typeof aiSettings.keysPlain !== 'object') aiSettings.keysPlain = {};
}
function aiSaveSettings() { writeJsonSafe(AI_FILE, aiSettings); }

function aiActiveProvider() { return aiSettings.provider || 'ollama'; }
function aiActiveModel(provider = aiActiveProvider()) {
    const p = AI_PROVIDERS[provider];
    return aiSettings.models[provider] || (p && p.defaultModel) || '';
}
function aiModelLabel(provider = aiActiveProvider(), modelId = aiActiveModel(provider)) {
    const p = AI_PROVIDERS[provider];
    const m = p && p.models.find(x => x.id === modelId);
    return m ? m.label : (modelId || 'no model');
}

// ── Keys ──────────────────────────────────────────────────────────
async function aiSetKey(provider, key) {
    key = String(key || '').trim();
    delete _aiKeyCache[provider];
    if (!key) { delete aiSettings.keys[provider]; delete aiSettings.keysPlain[provider]; aiSaveSettings(); return { stored: 'none' }; }
    _aiKeyCache[provider] = key;
    try {
        const r = await ipcRenderer.invoke('secure-encrypt', key);
        if (r && r.available && r.data) {
            aiSettings.keys[provider] = r.data;
            delete aiSettings.keysPlain[provider];
            aiSaveSettings();
            return { stored: 'encrypted' };
        }
    } catch (_) {}
    // No OS keychain available (rare — some Linux setups). Keep the key for
    // this session only rather than writing it to disk in the clear.
    delete aiSettings.keys[provider];
    aiSaveSettings();
    return { stored: 'session' };
}
async function aiGetKey(provider) {
    if (_aiKeyCache[provider]) return _aiKeyCache[provider];
    const blob = aiSettings.keys[provider];
    if (blob) {
        try {
            const r = await ipcRenderer.invoke('secure-decrypt', blob);
            if (r && r.available && r.data) { _aiKeyCache[provider] = r.data; return r.data; }
        } catch (_) {}
    }
    return '';
}
function aiHasKey(provider) { return !!(_aiKeyCache[provider] || aiSettings.keys[provider]); }

// ── Message shaping ───────────────────────────────────────────────
// chatHistory entries are { role, content, images?: [base64], imageMime? }.
// The system prompt is passed separately; drop it from the list.
function _aiTurns(messages) {
    return messages.filter(m => m.role !== 'system' && (m.content || (m.images && m.images.length)));
}
function _aiMime(m) { return m.imageMime || 'image/jpeg'; }

// ── Providers ─────────────────────────────────────────────────────
class AIError extends Error {
    constructor(message, { retryable = false, needsKey = false } = {}) { super(message); this.userFacing = true; this.retryable = retryable; this.needsKey = needsKey; }
}

async function _aiOllama({ model, system, messages, signal, options }) {
    let res;
    try {
        res = await fetch('http://localhost:11434/api/chat', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
            body: JSON.stringify({ model, messages, system, stream: false, options }),
        });
    } catch (e) {
        if (e && e.name === 'AbortError') throw e;
        throw new AIError('Vulsor\'s local model isn\'t running. It works through **Ollama** on `localhost:11434` — start the Ollama app (or run `ollama serve`), or pick Claude, ChatGPT or Gemini from the model picker next to the chat title.');
    }
    if (!res.ok) {
        let detail = '';
        try { detail = (await res.json()).error || ''; } catch (_) {}
        if (res.status === 404 && /model/i.test(detail)) {
            throw new AIError(`The model "${model}" isn't installed. In a terminal run:\n\n\`\`\`\nollama pull ${model}\n\`\`\`\n\nthen send your message again.`);
        }
        throw new AIError(`Ollama returned ${res.status}${detail ? ` — ${detail}` : ''}`, { retryable: res.status >= 500 });
    }
    const data = await res.json();
    return (data.message && data.message.content) || '';
}

async function _aiAnthropic({ model, system, messages, signal, apiKey }) {
    const mod = require('@anthropic-ai/sdk');
    const Anthropic = mod.default || mod;
    // Electron renderer looks like a browser to the SDK; the key stays on this
    // machine, so the guard doesn't apply.
    const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });
    const turns = _aiTurns(messages).map(m => {
        if (m.role === 'user' && m.images && m.images.length) {
            return { role: 'user', content: [
                ...m.images.map(b64 => ({ type: 'image', source: { type: 'base64', media_type: _aiMime(m), data: b64 } })),
                { type: 'text', text: m.content || 'Describe this image.' },
            ] };
        }
        return { role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content };
    });
    // Haiku 4.5 still uses the older budget form; the current generation
    // thinks adaptively. Opus 5 / Fable 5.1 get server-side refusal fallbacks
    // so a policy decline re-runs on another Claude model inside the call.
    const isHaiku = /haiku/.test(model);
    const fallbackable = /^claude-(opus-5|fable-5)/.test(model);
    const params = {
        model, max_tokens: 16000, system, messages: turns,
        ...(isHaiku ? {} : { thinking: { type: 'adaptive' } }),
    };
    const run = (useBeta) => {
        const api = useBeta ? client.beta.messages : client.messages;
        const extra = useBeta ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {};
        return api.stream({ ...params, ...extra }, { signal }).finalMessage();
    };
    let msg;
    try {
        try { msg = await run(fallbackable); }
        catch (e) {
            // An SDK/API that doesn't know the fallback beta yet: plain request.
            if (fallbackable && e instanceof Anthropic.BadRequestError) msg = await run(false);
            else throw e;
        }
    } catch (e) {
        if (e && e.name === 'AbortError') throw e;
        if (e instanceof Anthropic.AuthenticationError) throw new AIError('Anthropic rejected the API key. Check it in the model picker (it starts with `sk-ant-`).', { needsKey: true });
        if (e instanceof Anthropic.PermissionDeniedError) throw new AIError(`Anthropic refused this request for your account: ${e.message}`);
        if (e instanceof Anthropic.NotFoundError) throw new AIError(`Anthropic doesn't know the model "${model}". Pick another one in the model picker.`);
        if (e instanceof Anthropic.RateLimitError) throw new AIError('Anthropic is rate-limiting this key right now — wait a moment and try again.', { retryable: true });
        if (e instanceof Anthropic.APIConnectionError) throw new AIError('Couldn\'t reach api.anthropic.com — check your connection.', { retryable: true });
        if (e instanceof Anthropic.APIError) throw new AIError(`Anthropic returned ${e.status}: ${e.message}`);
        throw e;
    }
    if (msg.stop_reason === 'refusal') {
        const why = msg.stop_details && msg.stop_details.explanation;
        return `Claude declined to answer this one${why ? `: ${why}` : '.'}`;
    }
    return msg.content.filter(b => b.type === 'text').map(b => b.text).join('');
}

// OpenAI and every OpenAI-compatible server (the `custom` provider).
async function _aiOpenAICompatible({ model, system, messages, signal, apiKey, baseUrl, providerName }) {
    const base = String(baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
    const turns = _aiTurns(messages).map(m => {
        if (m.role === 'user' && m.images && m.images.length) {
            return { role: 'user', content: [
                { type: 'text', text: m.content || 'Describe this image.' },
                ...m.images.map(b64 => ({ type: 'image_url', image_url: { url: `data:${_aiMime(m)};base64,${b64}` } })),
            ] };
        }
        return { role: m.role, content: m.content };
    });
    const body = { model, messages: [{ role: 'system', content: system }, ...turns], max_completion_tokens: 16000 };
    let res;
    try {
        res = await fetch(`${base}/chat/completions`, {
            method: 'POST', signal,
            headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
            body: JSON.stringify(body),
        });
    } catch (e) {
        if (e && e.name === 'AbortError') throw e;
        throw new AIError(`Couldn't reach ${providerName} at ${base} — check your connection${baseUrl ? ' and the base URL' : ''}.`, { retryable: true });
    }
    if (!res.ok) {
        let detail = '';
        try { const j = await res.json(); detail = (j.error && (j.error.message || j.error)) || j.message || ''; } catch (_) {}
        detail = typeof detail === 'string' ? detail : JSON.stringify(detail);
        // Older servers only know max_tokens.
        if (res.status === 400 && /max_completion_tokens/i.test(detail)) {
            delete body.max_completion_tokens; body.max_tokens = 16000;
            const r2 = await fetch(`${base}/chat/completions`, { method: 'POST', signal, headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) }, body: JSON.stringify(body) });
            if (r2.ok) { const j = await r2.json(); return (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || ''; }
        }
        if (res.status === 401) throw new AIError(`${providerName} rejected the API key. Check it in the model picker.`, { needsKey: true });
        if (res.status === 404) throw new AIError(`${providerName} doesn't know the model "${model}"${detail ? ` (${detail})` : ''}. Pick or type another model id.`);
        if (res.status === 429) throw new AIError(`${providerName} is rate-limiting this key right now — wait a moment and try again.`, { retryable: true });
        if (res.status === 402) throw new AIError(`${providerName} says this account is out of credit.`);
        throw new AIError(`${providerName} returned ${res.status}${detail ? ` — ${detail}` : ''}`, { retryable: res.status >= 500 });
    }
    const data = await res.json();
    return (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
}

async function _aiGemini({ model, system, messages, signal, apiKey }) {
    const contents = _aiTurns(messages).map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [
            ...(m.content ? [{ text: m.content }] : []),
            ...((m.role === 'user' && m.images) || []).map(b64 => ({ inline_data: { mime_type: _aiMime(m), data: b64 } })),
        ],
    }));
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    let res;
    try {
        res = await fetch(url, {
            method: 'POST', signal,
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
            body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents, generationConfig: { maxOutputTokens: 16000 } }),
        });
    } catch (e) {
        if (e && e.name === 'AbortError') throw e;
        throw new AIError('Couldn\'t reach Google\'s Gemini API — check your connection.', { retryable: true });
    }
    if (!res.ok) {
        let detail = '';
        try { detail = ((await res.json()).error || {}).message || ''; } catch (_) {}
        if (res.status === 400 && /API key/i.test(detail)) throw new AIError('Google rejected the API key. Check it in the model picker.', { needsKey: true });
        if (res.status === 403) throw new AIError(`Google refused this request${detail ? `: ${detail}` : ''}. The key may lack access to this model.`, { needsKey: true });
        if (res.status === 404) throw new AIError(`Gemini doesn't know the model "${model}". Pick another one in the model picker.`);
        if (res.status === 429) throw new AIError('Gemini is rate-limiting this key right now — wait a moment and try again.', { retryable: true });
        throw new AIError(`Gemini returned ${res.status}${detail ? ` — ${detail}` : ''}`, { retryable: res.status >= 500 });
    }
    const data = await res.json();
    const cand = data.candidates && data.candidates[0];
    if (!cand) {
        const block = data.promptFeedback && data.promptFeedback.blockReason;
        return block ? `Gemini declined to answer this one (${block}).` : '';
    }
    if (cand.finishReason === 'SAFETY') return 'Gemini declined to answer this one (safety).';
    return ((cand.content && cand.content.parts) || []).map(p => p.text || '').join('');
}

// ── The one call ai.js makes ──────────────────────────────────────
// Returns the reply text. Throws AIError (userFacing) for anything the user
// should read, or the raw error otherwise.
async function aiComplete({ system, messages, signal, options }) {
    const provider = aiActiveProvider();
    const p = AI_PROVIDERS[provider];
    const model = aiActiveModel(provider);
    if (!model) throw new AIError(`No model chosen for ${p.name}. Open the model picker next to the chat title and pick or type one.`, { needsKey: true });
    if (provider === 'ollama') return _aiOllama({ model, system, messages, signal, options });
    const apiKey = await aiGetKey(provider);
    if (p.needsKey && !apiKey && provider !== 'custom') {
        throw new AIError(`${p.name} needs an API key. Open the model picker next to the chat title and paste one — it's stored encrypted on this Mac.`, { needsKey: true });
    }
    if (provider === 'anthropic') return _aiAnthropic({ model, system, messages, signal, apiKey });
    if (provider === 'gemini')    return _aiGemini({ model, system, messages, signal, apiKey });
    if (provider === 'openai')    return _aiOpenAICompatible({ model, system, messages, signal, apiKey, providerName: 'OpenAI' });
    if (provider === 'custom') {
        if (!aiSettings.customBaseUrl) throw new AIError('Set the server\'s base URL in the model picker (for example `https://openrouter.ai/api/v1`).', { needsKey: true });
        return _aiOpenAICompatible({ model, system, messages, signal, apiKey, baseUrl: aiSettings.customBaseUrl, providerName: 'The server' });
    }
    throw new AIError(`Unknown provider "${provider}".`);
}

// Ollama's installed models, for the picker. Empty list when it's not running.
async function aiOllamaModels() {
    try {
        const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 1500);
        const res = await fetch('http://localhost:11434/api/tags', { signal: ctl.signal });
        clearTimeout(t);
        if (!res.ok) return [];
        const j = await res.json();
        return (j.models || []).map(m => ({ id: m.name, label: m.name }));
    } catch (_) { return []; }
}

aiLoadSettings();

// ── Picker UI ─────────────────────────────────────────────────────
// A popover under the toolbar button: provider tiles, model choice (list or a
// typed id), API key with encrypted save, base URL for the custom server.
(function () {
    let open = false;
    const $ = id => document.getElementById(id);

    function paintButton() {
        const lbl = $('ai-model-label');
        if (!lbl) return;
        const p = AI_PROVIDERS[aiActiveProvider()];
        const short = p.name.replace(/ \(.*\)$/, '');
        const model = aiModelLabel();
        // "Claude · Claude Opus 5" reads twice; drop the repeated brand.
        lbl.textContent = model.toLowerCase().startsWith(short.toLowerCase()) ? model : `${short} · ${model}`;
        const btn = $('ai-model-btn');
        if (btn) btn.title = `${p.name} — ${aiActiveModel() || 'no model'} (click to change)`;
    }

    function paintStatus() {
        const st = $('ai-picker-status'); if (!st) return;
        const prov = aiActiveProvider(), p = AI_PROVIDERS[prov];
        if (!p.needsKey) { st.textContent = 'On this Mac'; st.className = 'ai-picker-status ok'; return; }
        if (_aiKeyCache[prov] && !aiSettings.keys[prov]) { st.textContent = 'Key kept for this session'; st.className = 'ai-picker-status warn'; return; }
        if (aiHasKey(prov)) { st.textContent = 'Key stored encrypted'; st.className = 'ai-picker-status ok'; return; }
        if (prov === 'custom') { st.textContent = 'No key'; st.className = 'ai-picker-status'; return; }
        st.textContent = 'Key needed'; st.className = 'ai-picker-status warn';
    }

    async function paintModels() {
        const prov = aiActiveProvider(), p = AI_PROVIDERS[prov];
        const sel = $('ai-picker-model'), custom = $('ai-picker-model-custom');
        if (!sel || !custom) return;
        let models = p.models;
        if (prov === 'ollama') {
            sel.innerHTML = '<option>Looking for installed models…</option>';
            models = await aiOllamaModels();
            if (aiActiveProvider() !== 'ollama') return;      // user moved on
            if (!models.length) {
                sel.hidden = true; custom.hidden = false;
                custom.value = aiActiveModel('ollama');
                custom.placeholder = 'e.g. llama3.1:8b (local model service isn\'t running — type a model)';
                return;
            }
        }
        const current = aiActiveModel(prov);
        const listed = models.some(m => m.id === current);
        if (!models.length) {                                   // custom server: type the id
            sel.hidden = true; custom.hidden = false;
            custom.value = current; custom.placeholder = 'model id, e.g. llama-3.3-70b-versatile';
            return;
        }
        sel.hidden = false;
        sel.innerHTML = models.map(m => `<option value="${m.id}"${m.id === current ? ' selected' : ''}>${m.label}</option>`).join('')
            + `<option value="__custom"${listed ? '' : ' selected'}>Other… (type an id)</option>`;
        custom.hidden = listed; custom.value = listed ? '' : current; custom.placeholder = 'model id';
    }

    function paint() {
        const prov = aiActiveProvider(), p = AI_PROVIDERS[prov];
        const grid = $('ai-picker-providers');
        if (grid) {
            grid.innerHTML = Object.entries(AI_PROVIDERS).map(([id, q]) => `
                <button type="button" class="ai-picker-provider${id === prov ? ' active' : ''}" data-provider="${id}">
                    <i class="fas ${q.icon}"></i>
                    <span><b>${q.name.replace(/ \(.*\)$/, '')}</b><small>${q.needsKey ? (aiHasKey(id) ? 'Key saved' : 'Needs a key') : 'Built in · private'}</small></span>
                </button>`).join('');
        }
        const keyWrap = $('ai-picker-key-wrap'), urlWrap = $('ai-picker-url-wrap');
        if (keyWrap) keyWrap.hidden = !p.needsKey;
        if (urlWrap) { urlWrap.hidden = !p.needsBaseUrl; const u = $('ai-picker-url'); if (u) u.value = aiSettings.customBaseUrl || ''; }
        const key = $('ai-picker-key');
        if (key) { key.value = ''; key.placeholder = aiHasKey(prov) ? '•••••••• (saved — paste to replace)' : (p.keyPlaceholder || 'Paste key'); }
        const kh = $('ai-picker-key-hint');
        if (kh) kh.innerHTML = p.keyUrl ? `Get one at <a href="#" data-url="${p.keyUrl}">${p.keyUrl.replace(/^https?:\/\//, '')}</a>. Stored encrypted with your Mac's keychain.` : 'Stored encrypted with your Mac\'s keychain.';
        const hint = $('ai-picker-hint'); if (hint) hint.textContent = p.hint || '';
        paintStatus(); paintModels(); paintButton();
    }

    function place() {
        const btn = $('ai-model-btn'), pk = $('ai-picker');
        if (!btn || !pk) return;
        const r = btn.getBoundingClientRect();
        pk.style.top = `${Math.round(r.bottom + 8)}px`;
        pk.style.left = `${Math.max(12, Math.min(window.innerWidth - pk.offsetWidth - 12, Math.round(r.left)))}px`;
    }

    function show() {
        const pk = $('ai-picker'); if (!pk) return;
        paint(); pk.hidden = false; open = true; place();
        $('ai-model-btn')?.classList.add('open');
    }
    function hide() {
        const pk = $('ai-picker'); if (!pk) return;
        pk.hidden = true; open = false;
        $('ai-model-btn')?.classList.remove('open');
    }
    window.aiOpenPicker = show;

    function wire() {
        const btn = $('ai-model-btn'), pk = $('ai-picker');
        if (!btn || !pk) return;
        paintButton();
        btn.addEventListener('click', e => { e.stopPropagation(); open ? hide() : show(); });
        document.addEventListener('click', e => { if (open && !e.target.closest('#ai-picker') && !e.target.closest('#ai-model-btn')) hide(); });
        document.addEventListener('keydown', e => { if (open && e.key === 'Escape') hide(); });
        window.addEventListener('resize', () => { if (open) place(); });

        pk.addEventListener('click', e => {
            // Re-rendering the tiles below detaches the clicked node, which
            // would make the document-level "click outside" check close us.
            e.stopPropagation();
            const tile = e.target.closest('.ai-picker-provider');
            if (tile) { aiSettings.provider = tile.dataset.provider; aiSaveSettings(); paint(); return; }
            const a = e.target.closest('a[data-url]');
            if (a) { e.preventDefault(); try { require('electron').shell.openExternal(a.dataset.url); } catch (_) {} }
        });
        $('ai-picker-model').addEventListener('change', e => {
            const custom = $('ai-picker-model-custom');
            if (e.target.value === '__custom') { custom.hidden = false; custom.value = ''; custom.focus(); return; }
            custom.hidden = true;
            aiSettings.models[aiActiveProvider()] = e.target.value; aiSaveSettings(); paintButton();
        });
        const commitCustom = () => {
            const v = $('ai-picker-model-custom').value.trim();
            if (!v) return;
            aiSettings.models[aiActiveProvider()] = v; aiSaveSettings(); paintButton();
        };
        $('ai-picker-model-custom').addEventListener('change', commitCustom);
        $('ai-picker-model-custom').addEventListener('keydown', e => { if (e.key === 'Enter') { commitCustom(); hide(); } });
        $('ai-picker-url').addEventListener('change', e => { aiSettings.customBaseUrl = e.target.value.trim().replace(/\/+$/, ''); aiSaveSettings(); });
        const saveKey = async () => {
            const inp = $('ai-picker-key');
            const r = await aiSetKey(aiActiveProvider(), inp.value);
            inp.value = '';
            paint();
            const st = $('ai-picker-status');
            if (st && r.stored === 'session') { st.textContent = 'Kept for this session only — no OS keychain available'; st.className = 'ai-picker-status warn'; }
        };
        $('ai-picker-key-save').addEventListener('click', saveKey);
        $('ai-picker-key').addEventListener('keydown', e => { if (e.key === 'Enter') saveKey(); });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
    else wire();
})();
