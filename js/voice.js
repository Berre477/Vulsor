// ── Voice Mode (local STT via whisper.cpp) ─────────────────────
// Depends on: globals.js (TUNING, MODEL)

// ── Built-in voice profiles ────────────────────────────────────
// `preferredVoices` is searched in order. Order matters: list MOST genre-correct
// voices first so that fallbacks don't leak into the wrong gender/accent.
const BUILTIN_VOICES = [
    { id: 'raniax', name: 'Raniax', icon: 'fa-venus',  description: 'Girl voice',     accentColor: '#f43f5e',
      // Female English voices only. Samantha ships with every Mac as default.
      preferredVoices: ['Samantha', 'Zoe', 'Ava', 'Allison', 'Susan', 'Victoria', 'Karen'],
      fallbackGender: 'female',
      lang: 'en-US', pitch: 1.25, rate: 1.05, builtin: true },
    { id: 'diego',  name: 'Diego',  icon: 'fa-mars',   description: 'Deep man',       accentColor: '#f97316',
      preferredVoices: ['Daniel', 'Tom', 'Alex', 'Oliver', 'Aaron', 'Fred'],
      fallbackGender: 'male',
      lang: 'en-US', pitch: 0.9,  rate: 0.95, builtin: true },
    { id: 'vulsor',  name: 'Vulsor',  icon: 'fa-bolt',   description: 'Normal man',     accentColor: '#dc2626',
      preferredVoices: ['Daniel', 'Tom', 'Alex', 'Oliver', 'Aaron', 'Fred'],
      fallbackGender: 'male',
      lang: 'en-US', pitch: 1.0,  rate: 1.0,  builtin: true }
];

// Hand-curated gender hints for known macOS voice names so fallback
// selection doesn't accidentally pick the wrong gender.
const VOICE_GENDER_HINTS = {
    male:   ['alex','daniel','tom','oliver','aaron','fred','ralph','bruce','lee','gordon','jorge','diego','carlos','juan','reed','arthur','rocko','rishi','albert','grandpa','eddy','thomas','romain','luc','jacques'],
    female: ['samantha','zoe','ava','allison','susan','victoria','karen','vicki','fiona','moira','tessa','nicky','kate','serena','paulina','monica','lorenza','grandma','sandy','amelie','aurelie']
};

function voiceGender(voice) {
    const n = voice.name.toLowerCase();
    if (VOICE_GENDER_HINTS.male.some(g => n.includes(g)))   return 'male';
    if (VOICE_GENDER_HINTS.female.some(g => n.includes(g))) return 'female';
    return null;
}

const ACCENT_COLORS = [
    '#dc2626', '#f43f5e', '#f97316', '#eab308',
    '#22c55e', '#06b6d4', '#3b82f6', '#a855f7'
];

const ICON_OPTIONS = [
    'fa-user', 'fa-user-tie', 'fa-user-astronaut', 'fa-user-ninja',
    'fa-user-secret', 'fa-venus', 'fa-mars', 'fa-robot',
    'fa-ghost', 'fa-cat', 'fa-dog', 'fa-bolt',
    'fa-fire', 'fa-star', 'fa-moon', 'fa-sun',
    'fa-heart', 'fa-shield-alt', 'fa-crown', 'fa-music',
    'fa-magic', 'fa-feather', 'fa-skull', 'fa-dragon'
];

function loadCustomVoices() {
    try { return JSON.parse(localStorage.getItem('vulsor_custom_voices') || '[]'); }
    catch (_) { return []; }
}
function saveCustomVoices(arr) {
    localStorage.setItem('vulsor_custom_voices', JSON.stringify(arr));
}

function loadOverrides() {
    try { return JSON.parse(localStorage.getItem('vulsor_voice_overrides') || '{}'); }
    catch (_) { return {}; }
}
function saveOverrides(obj) {
    localStorage.setItem('vulsor_voice_overrides', JSON.stringify(obj));
}

let customVoices = loadCustomVoices();
let voiceOverrides = loadOverrides();   // { [id]: { name, icon, accentColor, voiceURI, lang, pitch, rate } }

function getAllProfiles() {
    const builtins = BUILTIN_VOICES.map(v => {
        const o = voiceOverrides[v.id];
        return o ? { ...v, ...o, builtin: true } : v;
    });
    return [...builtins, ...customVoices];
}

let currentVoiceProfileId = localStorage.getItem('vulsor_voice_profile') || 'raniax';
function getCurrentProfile() {
    return getAllProfiles().find(p => p.id === currentVoiceProfileId) || BUILTIN_VOICES[0];
}

// ── State ───────────────────────────────────────────────────────
let voiceActive      = false;
let isListening      = false;
let isSpeaking       = false;
let isProcessing     = false;

let audioCtx        = null;
let micStream       = null;
let sourceNode      = null;
let analyserNode    = null;
let processorNode   = null;
let pcmChunks       = [];
let voiceDetected   = false;       // true once user has spoken in this turn
let silenceFrames   = 0;
let voiceFrames     = 0;
let vadRafId        = null;

// ── Interrupt listener (runs while AI is speaking) ──────────────
let interruptStream = null;
let interruptCtx    = null;
let interruptRafId  = null;

const STOP_WORDS = /\b(shut up|stop|quiet|be quiet|silence|enough|cancel|stop talking|stop it|please stop|ok stop|shush)\b/i;

async function startInterruptListener() {
    if (interruptStream) return;
    try {
        // Echo / noise cancellation so the mic doesn't pick up the AI's own
        // voice coming out of the speakers and trigger a self-interrupt.
        interruptStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl:  true
            },
            video: false
        });
        interruptCtx    = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
        const src       = interruptCtx.createMediaStreamSource(interruptStream);
        const analyser  = interruptCtx.createAnalyser();
        analyser.fftSize = 512;
        src.connect(analyser);

        let consecutiveVoiceFrames = 0;
        const buf = new Uint8Array(analyser.frequencyBinCount);
        const startedAt = performance.now();

        // Higher threshold than normal listening — TTS leakage through the
        // mic is usually quieter than real speech, so we want to ignore it.
        const INTERRUPT_THRESHOLD = 0.10;
        // Don't start checking for ~1s after speech begins; gives AEC time
        // to converge and prevents a false trigger on the very first word.
        const GRACE_MS = 1000;
        // Need ~600ms of sustained loud speech before cancelling.
        const REQUIRED_FRAMES = 12;

        const check = () => {
            if (!isSpeaking) { stopInterruptListener(); return; }
            if (performance.now() - startedAt < GRACE_MS) {
                interruptRafId = requestAnimationFrame(check);
                return;
            }
            analyser.getByteTimeDomainData(buf);
            let sum = 0;
            for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
            const rms = Math.sqrt(sum / buf.length);

            if (rms > INTERRUPT_THRESHOLD) {
                consecutiveVoiceFrames++;
                if (consecutiveVoiceFrames >= REQUIRED_FRAMES) {
                    window.speechSynthesis.cancel();
                    isSpeaking = false;
                    stopInterruptListener();
                    return;
                }
            } else {
                consecutiveVoiceFrames = 0;
            }
            interruptRafId = requestAnimationFrame(check);
        };
        interruptRafId = requestAnimationFrame(check);
    } catch (_) { /* mic denied — fail silently */ }
}

function stopInterruptListener() {
    if (interruptRafId) { cancelAnimationFrame(interruptRafId); interruptRafId = null; }
    try { interruptStream && interruptStream.getTracks().forEach(t => t.stop()); } catch (_) {}
    try { interruptCtx && interruptCtx.close(); } catch (_) {}
    interruptStream = null;
    interruptCtx    = null;
}

const SAMPLE_RATE   = 16000;
const VOICE_THRESHOLD = 0.018;     // RMS threshold to count as speech
const SILENCE_MS    = 1500;        // ms of silence after speech → stop
const MIN_VOICE_MS  = 300;         // need at least this much speech before processing

// ── UI state ────────────────────────────────────────────────────
function setVoiceState(state) {
    const voiceMicBtn  = document.getElementById('voice-mic-btn');
    const voiceMicIcon = document.getElementById('voice-mic-icon');
    const voiceStatus  = document.getElementById('voice-status');
    const voiceWaves   = document.getElementById('voice-waves');
    const voiceStopBtn = document.getElementById('voice-stop-btn');

    voiceMicBtn.classList.remove('voice-listening', 'voice-speaking', 'voice-idle');
    voiceWaves.style.opacity = '0';

    // Show the dedicated Stop button only while the AI is actively speaking.
    if (voiceStopBtn) {
        if (state === 'speaking') {
            voiceStopBtn.classList.remove('hidden');
            voiceStopBtn.classList.add('flex');
        } else {
            voiceStopBtn.classList.add('hidden');
            voiceStopBtn.classList.remove('flex');
        }
    }

    if (state === 'idle') {
        voiceMicBtn.classList.add('voice-idle');
        voiceMicIcon.className = 'fas fa-microphone text-4xl';
        voiceStatus.textContent = 'Tap to speak';
    } else if (state === 'listening') {
        voiceMicBtn.classList.add('voice-listening');
        voiceMicIcon.className = 'fas fa-microphone text-4xl';
        voiceStatus.textContent = 'Listening...';
        voiceWaves.style.opacity = '1';
    } else if (state === 'thinking') {
        voiceMicBtn.classList.add('voice-idle');
        voiceMicIcon.className = 'fas fa-circle-notch fa-spin text-4xl';
        voiceStatus.textContent = 'Transcribing...';
    } else if (state === 'generating') {
        voiceMicBtn.classList.add('voice-idle');
        voiceMicIcon.className = 'fas fa-circle-notch fa-spin text-4xl';
        voiceStatus.textContent = 'Thinking...';
    } else if (state === 'speaking') {
        voiceMicBtn.classList.add('voice-speaking');
        voiceMicIcon.className = 'fas fa-volume-up text-4xl';
        voiceStatus.textContent = 'Speaking...';
    }
}

// ── TTS helpers ─────────────────────────────────────────────────
function stripMarkdown(text) {
    return text
        .replace(/```[\s\S]*?```/g, '[code block]')
        .replace(/\*\*(.*?)\*\*/g, '$1')
        .replace(/\*(.*?)\*/g, '$1')
        .replace(/`(.*?)`/g, '$1')
        .replace(/#+\s/g, '')
        .trim();
}

function findVoiceForProfile(profile) {
    vsEnsureVoiceWatch();
    const voices = window.speechSynthesis.getVoices();

    // Custom voices store an exact voiceURI
    if (profile.voiceURI) {
        const match = voices.find(v => v.voiceURI === profile.voiceURI);
        if (match) return match;
    }

    // Built-in voices: try exact name match first, then prefix match.
    if (profile.preferredVoices) {
        for (const name of profile.preferredVoices) {
            const lower = name.toLowerCase();
            const exact = voices.find(v => v.name.toLowerCase() === lower);
            if (exact) return exact;
            const partial = voices.find(v => v.name.toLowerCase().split(/[\s(]/)[0] === lower);
            if (partial) return partial;
        }
    }

    // Language fallback — but if the profile specifies a gender,
    // never pick a voice of the wrong gender.
    const langBase = (profile.lang || 'en-US').split('-')[0];
    const wantGender = profile.fallbackGender;
    const okGender = (v) => !wantGender || voiceGender(v) !== (wantGender === 'male' ? 'female' : 'male');

    return voices.find(v => v.lang.startsWith(langBase) && v.localService && okGender(v))
        || voices.find(v => v.lang.startsWith(langBase) && okGender(v))
        || voices.find(v => v.lang.startsWith('en')     && v.localService && okGender(v))
        || voices.find(v => v.lang.startsWith('en')     && okGender(v))
        // Last resort: anything, even if gender is uncertain
        || voices.find(v => v.lang.startsWith(langBase))
        || voices.find(v => v.lang.startsWith('en'))
        || voices[0];
}

function speakText(text) {
    return new Promise(resolve => {
        window.speechSynthesis.cancel();
        const profile = getCurrentProfile();
        const utter   = new SpeechSynthesisUtterance(stripMarkdown(text));
        utter.rate    = profile.rate;
        utter.pitch   = profile.pitch;
        const voice   = findVoiceForProfile(profile);
        if (voice) utter.voice = voice;
        utter.onend   = resolve;
        utter.onerror = resolve;
        window.speechSynthesis.speak(utter);
    });
}

// ── Voice selector UI ───────────────────────────────────────────
// Register the voiceschanged handler on first real use. Kept out of startup:
// see the note in initVoice about what touching speechSynthesis costs.
let _vsVoiceWatchArmed = false;
function vsEnsureVoiceWatch() {
    if (_vsVoiceWatchArmed) return;
    _vsVoiceWatchArmed = true;
    try { window.speechSynthesis.onvoiceschanged = () => renderVoiceSelector(); } catch (_) {}
}

function renderVoiceSelector() {
    const container = document.getElementById('voice-selector');
    if (!container) return;
    container.innerHTML = '';
    getAllProfiles().forEach(profile => {
        const isActive = profile.id === currentVoiceProfileId;
        const card = document.createElement('div');
        card.className = [
            'voice-profile-card relative flex flex-col items-center gap-3 px-4 py-6 rounded-2xl border transition-all duration-200 cursor-pointer',
            isActive
                ? 'border-transparent text-white shadow-lg scale-[1.03]'
                : 'border-slate-700/60 bg-slate-800/60 text-slate-400 hover:border-slate-600 hover:text-slate-200'
        ].join(' ');
        if (isActive) {
            card.style.backgroundColor = profile.accentColor + '22';
            card.style.borderColor     = profile.accentColor + '88';
            card.style.boxShadow       = `0 0 32px ${profile.accentColor}55`;
        }
        const editBtn = `
            <button class="ve-edit-mini absolute top-2 right-2 w-8 h-8 rounded-full bg-slate-700/90 hover:bg-slate-600 text-slate-300 text-xs flex items-center justify-center border border-slate-900/60 shadow"
                    data-id="${profile.id}" title="Edit voice">
                <i class="fas fa-pen"></i>
            </button>`;
        const iconHtml = profile.iconImage
            ? `<img src="${profile.iconImage}" class="w-24 h-24 rounded-full object-cover pointer-events-none" alt="">`
            : `<div class="w-24 h-24 rounded-full flex items-center justify-center text-4xl pointer-events-none"
                    style="background:${isActive ? profile.accentColor : '#334155'}">
                   <i class="fas ${profile.icon}"></i>
               </div>`;
        card.innerHTML = `
            ${editBtn}
            ${iconHtml}
            <span class="text-base font-semibold pointer-events-none" style="${isActive ? `color:${profile.accentColor}` : ''}">${profile.name}</span>
        `;
        card.onclick = (e) => {
            if (e.target.closest('.ve-edit-mini')) {
                openVoiceEditor(profile.id);
                return;
            }
            currentVoiceProfileId = profile.id;
            localStorage.setItem('vulsor_voice_profile', profile.id);
            renderVoiceSelector();
        };
        container.appendChild(card);
    });

    // Add "+" card to create a new custom voice
    const addCard = document.createElement('button');
    addCard.className = 'flex flex-col items-center justify-center gap-3 px-4 py-6 rounded-2xl border-2 border-dashed border-slate-700 bg-slate-900/50 text-slate-500 hover:border-red-600/60 hover:text-red-400 transition-all duration-200 min-h-[180px]';
    addCard.innerHTML = `
        <div class="w-24 h-24 rounded-full flex items-center justify-center bg-slate-800/60">
            <i class="fas fa-plus text-3xl"></i>
        </div>
        <span class="text-base font-semibold uppercase tracking-wider">New</span>
    `;
    addCard.onclick = () => openVoiceEditor(null);
    container.appendChild(addCard);
}

// ── Audio capture (Web Audio → raw PCM) ─────────────────────────
async function startListening() {
    if (isProcessing || isListening) return;
    if (isSpeaking) { window.speechSynthesis.cancel(); isSpeaking = false; }

    try {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (e) {
        document.getElementById('voice-status').textContent = 'Mic access denied';
        setVoiceState('idle');
        return;
    }

    audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: SAMPLE_RATE });
    sourceNode    = audioCtx.createMediaStreamSource(micStream);
    analyserNode  = audioCtx.createAnalyser();
    analyserNode.fftSize = 512;
    processorNode = audioCtx.createScriptProcessor(4096, 1, 1);

    pcmChunks      = [];
    voiceDetected  = false;
    silenceFrames  = 0;
    voiceFrames    = 0;

    processorNode.onaudioprocess = (e) => {
        const ch = e.inputBuffer.getChannelData(0);
        pcmChunks.push(new Float32Array(ch));
    };

    sourceNode.connect(analyserNode);
    sourceNode.connect(processorNode);
    processorNode.connect(audioCtx.destination);

    isListening = true;
    document.getElementById('voice-transcript').textContent = '';
    setVoiceState('listening');
    runVAD();
}

function runVAD() {
    const buf = new Uint8Array(analyserNode.frequencyBinCount);
    const FRAME_MS = 50;
    const SILENCE_FRAMES_THRESHOLD = Math.ceil(SILENCE_MS / FRAME_MS);
    const VOICE_FRAMES_THRESHOLD   = Math.ceil(MIN_VOICE_MS / FRAME_MS);

    let lastTick = 0;

    const tick = () => {
        if (!isListening) return;
        const now = performance.now();
        if (now - lastTick < FRAME_MS) {
            vadRafId = requestAnimationFrame(tick);
            return;
        }
        lastTick = now;

        analyserNode.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
            const v = (buf[i] - 128) / 128;
            sum += v * v;
        }
        const rms = Math.sqrt(sum / buf.length);

        if (rms > VOICE_THRESHOLD) {
            voiceFrames++;
            silenceFrames = 0;
            if (voiceFrames >= VOICE_FRAMES_THRESHOLD) voiceDetected = true;
        } else {
            silenceFrames++;
            if (voiceDetected && silenceFrames >= SILENCE_FRAMES_THRESHOLD) {
                stopAndProcess();
                return;
            }
        }
        vadRafId = requestAnimationFrame(tick);
    };
    vadRafId = requestAnimationFrame(tick);
}

function teardownAudio() {
    if (vadRafId) { cancelAnimationFrame(vadRafId); vadRafId = null; }
    try { processorNode && processorNode.disconnect(); } catch (_) {}
    try { sourceNode    && sourceNode.disconnect();    } catch (_) {}
    try { analyserNode  && analyserNode.disconnect();  } catch (_) {}
    try { audioCtx      && audioCtx.close();           } catch (_) {}
    if (micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
    audioCtx = sourceNode = analyserNode = processorNode = null;
}

function stopListening() {
    isListening = false;
    teardownAudio();
    pcmChunks = [];
    setVoiceState('idle');
}

async function stopAndProcess() {
    if (!isListening) return;
    isListening = false;

    // Concatenate PCM chunks into a single Float32Array
    let total = 0;
    for (const c of pcmChunks) total += c.length;
    const merged = new Float32Array(total);
    let offset = 0;
    for (const c of pcmChunks) { merged.set(c, offset); offset += c.length; }
    const sampleRate = audioCtx.sampleRate;
    pcmChunks = [];

    teardownAudio();

    if (!voiceDetected || merged.length < SAMPLE_RATE * 0.3) {
        setVoiceState('idle');
        if (voiceActive) setTimeout(() => { if (voiceActive && !isProcessing) startListening(); }, 200);
        return;
    }

    setVoiceState('thinking');
    isProcessing = true;

    let result;
    try {
        result = await ipcRenderer.invoke('voice:transcribe', {
            samples: merged,
            sampleRate
        });
    } catch (e) {
        result = { ok: false, error: e.message };
    }

    if (!result.ok) {
        document.getElementById('voice-status').textContent = 'STT failed: ' + (result.error || 'unknown');
        isProcessing = false;
        setVoiceState('idle');
        return;
    }

    const transcript = (result.text || '').trim();
    if (!transcript) {
        isProcessing = false;
        setVoiceState('idle');
        if (voiceActive) setTimeout(() => { if (voiceActive && !isProcessing) startListening(); }, 200);
        return;
    }

    document.getElementById('voice-transcript').textContent = transcript;

    // Stop-word check: cancel any ongoing speech and restart listening
    if (STOP_WORDS.test(transcript)) {
        window.speechSynthesis.cancel();
        isSpeaking = false;
        isProcessing = false;
        setVoiceState('idle');
        if (voiceActive) setTimeout(() => { if (voiceActive && !isProcessing) startListening(); }, 200);
        return;
    }

    await handleVoiceInput(transcript);
}

// ── AI + TTS pipeline ───────────────────────────────────────────
// Routes through generate() so voice has full feature parity with the
// normal chatbot — same chat history, JARVIS tools, the works.
async function handleVoiceInput(transcript) {
    const voiceReply = document.getElementById('voice-reply');
    voiceReply.textContent = '';
    setVoiceState('generating');

    // Mirror the message into the regular chat UI
    try { addMessageToUI('You', transcript); } catch (_) {}

    let reply = '';
    try {
        reply = await generate(transcript);
    } catch (_) {
        reply = 'Unable to connect to Vulsor core.';
    }

    try { addMessageToUI('AI', reply); } catch (_) {}
    voiceReply.textContent = reply;

    setVoiceState('speaking');
    isSpeaking = true;
    // Auto-interrupt listener disabled — even with echoCancellation it occasionally
    // catches the AI's own voice through the mic and cuts it off mid-sentence.
    // To stop the AI mid-speech, click the mic button (which cancels TTS).
    await speakText(reply);
    isSpeaking = false;

    isProcessing = false;
    if (voiceActive) {
        setVoiceState('idle');
        setTimeout(() => {
            if (voiceActive && !isProcessing) startListening();
        }, 400);
    }
}

// ── Voice editor modal ──────────────────────────────────────────
let editorEditingId = null;
let editorAccentColor = ACCENT_COLORS[0];
let editorIcon = ICON_OPTIONS[0];
let editorIconImage = null;   // data URL for custom uploaded image

function openVoiceEditor(profileId) {
    const editor = document.getElementById('voice-editor');
    editor.classList.remove('hidden');
    editor.classList.add('flex');

    editorEditingId = profileId;

    // Look up existing — either an effective built-in (with overrides applied) or a custom voice
    const existing = profileId ? getAllProfiles().find(v => v.id === profileId) : null;
    const isBuiltin = !!existing?.builtin;
    const hasOverride = isBuiltin && !!voiceOverrides[profileId];

    let title;
    if (!existing) title = 'New Voice';
    else if (isBuiltin) title = `Edit ${existing.name}`;
    else title = 'Edit Voice';
    document.getElementById('voice-editor-title').textContent = title;

    document.getElementById('ve-name').value = existing?.name || '';
    document.getElementById('ve-pitch').value = existing?.pitch ?? 1;
    document.getElementById('ve-rate').value  = existing?.rate  ?? 1;
    document.getElementById('ve-pitch-val').textContent = (existing?.pitch ?? 1).toFixed(2);
    document.getElementById('ve-rate-val').textContent  = (existing?.rate  ?? 1).toFixed(2);
    editorAccentColor = existing?.accentColor || ACCENT_COLORS[0];
    editorIcon = existing?.icon || ICON_OPTIONS[0];
    editorIconImage = existing?.iconImage || null;

    populateSystemVoiceDropdown(existing?.voiceURI);
    renderColorPicker();
    renderIconPicker();
    refreshImagePreview();

    // Delete button: hidden for new, shows "Reset" for overridden built-ins, "Delete" for custom
    const delBtn = document.getElementById('ve-delete-btn');
    if (!existing) {
        delBtn.classList.add('hidden');
    } else if (isBuiltin) {
        delBtn.classList.toggle('hidden', !hasOverride);
        delBtn.innerHTML = '<i class="fas fa-rotate-left text-xs"></i>';
        delBtn.title = 'Reset to default';
    } else {
        delBtn.classList.remove('hidden');
        delBtn.innerHTML = '<i class="fas fa-trash text-xs"></i>';
        delBtn.title = 'Delete voice';
    }
}

function closeVoiceEditor() {
    const editor = document.getElementById('voice-editor');
    editor.classList.add('hidden');
    editor.classList.remove('flex');
    editorEditingId = null;
}

function populateSystemVoiceDropdown(selectedURI) {
    const sel = document.getElementById('ve-system-voice');
    sel.innerHTML = '';
    vsEnsureVoiceWatch();
    const voices = window.speechSynthesis.getVoices();
    // Group by language for readability
    const sorted = [...voices].sort((a, b) => a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name));
    sorted.forEach(v => {
        const opt = document.createElement('option');
        opt.value = v.voiceURI;
        opt.textContent = `${v.name} — ${v.lang}${v.localService ? '' : ' (online)'}`;
        if (v.voiceURI === selectedURI) opt.selected = true;
        sel.appendChild(opt);
    });
}

function renderColorPicker() {
    const picker = document.getElementById('ve-color-picker');
    picker.innerHTML = '';
    ACCENT_COLORS.forEach(color => {
        const swatch = document.createElement('button');
        const isActive = color === editorAccentColor;
        swatch.className = `w-7 h-7 rounded-full transition-all ${isActive ? 'ring-2 ring-white scale-110' : 'hover:scale-105'}`;
        swatch.style.backgroundColor = color;
        swatch.onclick = () => { editorAccentColor = color; renderColorPicker(); renderIconPicker(); };
        picker.appendChild(swatch);
    });
}

function refreshImagePreview() {
    const preview    = document.getElementById('ve-image-preview');
    const previewImg = document.getElementById('ve-image-preview-img');
    const clearBtn   = document.getElementById('ve-image-clear');
    const picker     = document.getElementById('ve-icon-picker');
    if (editorIconImage) {
        previewImg.src = editorIconImage;
        preview.classList.remove('hidden');
        preview.classList.add('flex');
        clearBtn.classList.remove('hidden');
        picker.classList.add('opacity-40', 'pointer-events-none');
    } else {
        preview.classList.add('hidden');
        preview.classList.remove('flex');
        clearBtn.classList.add('hidden');
        picker.classList.remove('opacity-40', 'pointer-events-none');
    }
}

// Resize uploaded image to 128x128 to keep localStorage small
function resizeImageToDataURL(file, size = 128) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = size; canvas.height = size;
                const ctx = canvas.getContext('2d');
                // Cover-fit crop to a square
                const minSide = Math.min(img.width, img.height);
                const sx = (img.width  - minSide) / 2;
                const sy = (img.height - minSide) / 2;
                ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, size, size);
                resolve(canvas.toDataURL('image/jpeg', 0.85));
            };
            img.onerror = reject;
            img.src = reader.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

function renderIconPicker() {
    const picker = document.getElementById('ve-icon-picker');
    if (!picker) return;
    picker.innerHTML = '';
    ICON_OPTIONS.forEach(icon => {
        const btn = document.createElement('button');
        btn.type = 'button';
        const isActive = icon === editorIcon;
        btn.className = `w-9 h-9 rounded-lg flex items-center justify-center text-sm transition-all border ${
            isActive
                ? 'border-transparent text-white scale-110'
                : 'border-slate-700/60 bg-slate-800/60 text-slate-400 hover:text-slate-200 hover:border-slate-600'
        }`;
        if (isActive) btn.style.backgroundColor = editorAccentColor;
        btn.innerHTML = `<i class="fas ${icon} pointer-events-none"></i>`;
        btn.onclick = (e) => {
            e.stopPropagation();
            editorIcon = icon;
            renderIconPicker();
        };
        picker.appendChild(btn);
    });
}

function saveVoiceFromEditor() {
    const name = document.getElementById('ve-name').value.trim();
    const voiceURI = document.getElementById('ve-system-voice').value;
    const pitch = parseFloat(document.getElementById('ve-pitch').value);
    const rate  = parseFloat(document.getElementById('ve-rate').value);

    if (!name) { document.getElementById('ve-name').focus(); return; }
    vsEnsureVoiceWatch();
    const sysVoice = window.speechSynthesis.getVoices().find(v => v.voiceURI === voiceURI);
    const lang = sysVoice ? sysVoice.lang : 'en-US';

    const isBuiltin = editorEditingId && BUILTIN_VOICES.some(v => v.id === editorEditingId);

    if (isBuiltin) {
        // Save as override on top of the built-in
        voiceOverrides[editorEditingId] = {
            name, icon: editorIcon, iconImage: editorIconImage,
            accentColor: editorAccentColor,
            voiceURI, lang, pitch, rate
        };
        saveOverrides(voiceOverrides);
        currentVoiceProfileId = editorEditingId;
    } else {
        const profile = {
            id: editorEditingId || ('custom_' + Date.now()),
            name, icon: editorIcon, iconImage: editorIconImage,
            accentColor: editorAccentColor,
            voiceURI, lang, pitch, rate
        };
        if (editorEditingId) {
            const idx = customVoices.findIndex(v => v.id === editorEditingId);
            if (idx >= 0) customVoices[idx] = profile;
        } else {
            customVoices.push(profile);
        }
        saveCustomVoices(customVoices);
        currentVoiceProfileId = profile.id;
    }
    localStorage.setItem('vulsor_voice_profile', currentVoiceProfileId);
    closeVoiceEditor();
    renderVoiceSelector();
}

function deleteVoiceFromEditor() {
    if (!editorEditingId) return;
    const isBuiltin = BUILTIN_VOICES.some(v => v.id === editorEditingId);

    if (isBuiltin) {
        // Reset built-in: remove override
        delete voiceOverrides[editorEditingId];
        saveOverrides(voiceOverrides);
    } else {
        customVoices = customVoices.filter(v => v.id !== editorEditingId);
        saveCustomVoices(customVoices);
        if (currentVoiceProfileId === editorEditingId) {
            currentVoiceProfileId = 'vulsor';
            localStorage.setItem('vulsor_voice_profile', 'vulsor');
        }
    }
    closeVoiceEditor();
    renderVoiceSelector();
}

function testVoiceFromEditor() {
    const voiceURI = document.getElementById('ve-system-voice').value;
    const pitch = parseFloat(document.getElementById('ve-pitch').value);
    const rate  = parseFloat(document.getElementById('ve-rate').value);
    const name  = document.getElementById('ve-name').value.trim() || 'Vulsor';
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(`Hi, I'm ${name}. This is how I sound.`);
    vsEnsureVoiceWatch();
    const v = window.speechSynthesis.getVoices().find(x => x.voiceURI === voiceURI);
    if (v) utter.voice = v;
    utter.pitch = pitch;
    utter.rate  = rate;
    window.speechSynthesis.speak(utter);
}

function wireVoiceEditor() {
    document.getElementById('voice-editor-close').onclick = closeVoiceEditor;
    document.getElementById('ve-save-btn').onclick   = saveVoiceFromEditor;
    document.getElementById('ve-delete-btn').onclick = deleteVoiceFromEditor;
    document.getElementById('ve-test-btn').onclick   = testVoiceFromEditor;
    document.getElementById('ve-pitch').oninput = (e) => {
        document.getElementById('ve-pitch-val').textContent = parseFloat(e.target.value).toFixed(2);
    };
    document.getElementById('ve-rate').oninput = (e) => {
        document.getElementById('ve-rate-val').textContent = parseFloat(e.target.value).toFixed(2);
    };

    // Upload image → file picker → resize → set as icon image
    document.getElementById('ve-image-btn').onclick = () => {
        document.getElementById('ve-image-input').click();
    };
    document.getElementById('ve-image-input').onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
            editorIconImage = await resizeImageToDataURL(file, 128);
            refreshImagePreview();
        } catch (_) { /* ignore bad image */ }
        e.target.value = '';
    };
    document.getElementById('ve-image-clear').onclick = () => {
        editorIconImage = null;
        refreshImagePreview();
    };
}

// ── Setup check & model download UI ─────────────────────────────
async function ensureWhisperReady() {
    const statusEl = document.getElementById('voice-status');
    const setup = await ipcRenderer.invoke('voice:check-setup');

    if (!setup.binInstalled) {
        statusEl.textContent = 'Run: brew install whisper-cpp';
        return false;
    }
    if (!setup.modelInstalled) {
        statusEl.textContent = 'Downloading model (≈142 MB)…';
        const onProgress = (_e, pct) => {
            statusEl.textContent = `Downloading model… ${(pct * 100).toFixed(0)}%`;
        };
        ipcRenderer.on('voice:download-progress', onProgress);
        const r = await ipcRenderer.invoke('voice:download-model');
        ipcRenderer.removeListener('voice:download-progress', onProgress);
        if (!r.ok) {
            statusEl.textContent = 'Model download failed: ' + r.error;
            return false;
        }
    }
    return true;
}

// ── Init ────────────────────────────────────────────────────────
function initVoice() {
    wireVoiceEditor();

    // Do not touch window.speechSynthesis during startup — not getVoices(), not
    // even reading the property. The first access binds Blink's SpeechSynthesis
    // interface, and handling that one message makes the browser process
    // enumerate every macOS Text-to-Speech voice: 1.26 SECONDS, measured in a
    // Chromium trace, with the app's window waiting behind it.
    //
    // The selector is built from saved profiles and needs no system voice list.
    // The voiceschanged handler is registered the first time something actually
    // reaches for a voice (vsEnsureVoiceWatch, called from the paths that speak
    // or list system voices), by which point the user has asked for speech.
    renderVoiceSelector();

    document.getElementById('voice-mic-btn').onclick = () => {
        if (isProcessing) return;
        if (isSpeaking) { window.speechSynthesis.cancel(); isSpeaking = false; setVoiceState('idle'); return; }
        if (isListening) stopListening(); else startListening();
    };

    document.getElementById('voice-stop-btn').onclick = () => {
        window.speechSynthesis.cancel();
        isSpeaking = false;
        setVoiceState('idle');
    };

    document.getElementById('voice-mode-btn').onclick = async () => {
        voiceActive = true;
        document.getElementById('voice-mode').classList.add('active');
        document.getElementById('voice-transcript').textContent = '';
        document.getElementById('voice-reply').textContent = '';
        setVoiceState('idle');
        const ready = await ensureWhisperReady();
        if (ready) setVoiceState('idle');
    };

    document.getElementById('voice-back-btn').onclick = () => {
        voiceActive = false;
        isProcessing = false;
        stopListening();
        window.speechSynthesis.cancel();
        isSpeaking = false;
        document.getElementById('voice-mode').classList.remove('active');
    };
}
