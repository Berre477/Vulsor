// ── UI Helpers ─────────────────────────────────────────────────
// Depends on: globals.js (chatBox, currentImageBase64, currentImageDataUrl)

// ── Shared "this can't run here" panel ────────────────────────────
// Used wherever a feature depends on something the machine may not have
// (WebGL, a helper binary, a network service). Renders a quiet, centred
// explanation inside the feature's own container so the rest of the app is
// untouched; optional action button for the fix.
function uiUnavailable(container, { icon = 'fa-triangle-exclamation', title, detail, action, onAction } = {}) {
    if (!container) return null;
    container.querySelector('.ui-unavailable')?.remove();
    const el = document.createElement('div');
    el.className = 'ui-unavailable';
    el.innerHTML = `
        <div class="ui-unavailable-icon"><i class="fas ${icon}"></i></div>
        <div class="ui-unavailable-title">${title || 'Not available'}</div>
        ${detail ? `<div class="ui-unavailable-detail">${detail}</div>` : ''}
        ${action ? `<button type="button" class="ui-unavailable-action">${action}</button>` : ''}`;
    if (action && onAction) el.querySelector('.ui-unavailable-action').onclick = onAction;
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
    container.appendChild(el);
    return el;
}

// Creating a WebGLRenderer throws when the GPU process is unavailable or
// WebGL is disabled. Every 3D feature goes through here so that case shows
// the panel above instead of a blank pane and a console error.
function uiCreateWebGLRenderer(container, opts) {
    try {
        if (typeof THREE === 'undefined') throw new Error('three.js did not load');
        const probe = document.createElement('canvas');
        if (!(probe.getContext('webgl2') || probe.getContext('webgl'))) throw new Error('WebGL is not available');
        return new THREE.WebGLRenderer(opts);
    } catch (e) {
        console.warn('[webgl]', e && e.message);
        if (window.__vulsorLog) window.__vulsorLog('webgl', e && e.message);
        uiUnavailable(container, {
            icon: 'fa-cube',
            title: '3D isn\'t available on this machine',
            detail: 'WebGL couldn\'t start. Graphics drivers or a hardware-acceleration setting are usually the cause; the rest of Vulsor works normally.',
        });
        return null;
    }
}

function formatText(text) {
    // Escape HTML first to avoid XSS in code blocks
    const escapeHtml = (s) => s
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    return text
        // Fenced code blocks
        .replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) =>
            `<pre class="bg-slate-950 p-3 rounded-xl my-2 font-mono text-xs border border-slate-800 overflow-x-auto select-text leading-relaxed" style="color:var(--accent-light)"><code>${escapeHtml(code.trim())}</code></pre>`)
        // Inline code
        .replace(/`([^`]+)`/g, '<code class="bg-slate-950 px-1.5 py-0.5 rounded text-xs font-mono" style="color:var(--accent-light)">$1</code>')
        // Bold
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        // Italic
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        // Line breaks
        .replace(/\n/g, '<br>');
}

function addMessageToUI(sender, text, imageDataUrl = null) {
    if (!text && !imageDataUrl) return;
    const isUser = sender === 'You';
    const div    = document.createElement('div');
    div.className = `flex ${isUser ? 'justify-end' : 'justify-start'} mb-3`;

    const imageHtml = imageDataUrl
        ? `<img src="${imageDataUrl}" class="max-h-48 rounded-lg mb-2 w-auto block">`
        : '';

    // AI replies get the rich formatter (math / plots / geometry) when available,
    // falling back to plain markdown. User messages stay plain text.
    const aiHtml = (typeof mvFormatRich === 'function') ? mvFormatRich(text) : formatText(text);

    div.innerHTML = isUser
        ? `<div class="max-w-[85%] px-4 py-3 rounded-2xl rounded-br-md shadow-sm text-sm leading-relaxed text-white"
                style="background:var(--accent)">
                ${imageHtml}${text}
           </div>`
        : `<div class="max-w-[85%] px-4 py-3 rounded-2xl rounded-bl-md shadow-sm text-sm leading-relaxed bg-slate-800 text-slate-200">
                ${imageHtml}${aiHtml}
           </div>`;
    chatBox.appendChild(div);
    // Render any deferred math/plot/geometry widgets now that they're in the DOM.
    if (!isUser && typeof mvRenderPending === 'function') {
        try { mvRenderPending(div); } catch (_) {}
    }
    chatBox.scrollTop = chatBox.scrollHeight;
}

function showTyping() {
    const div  = document.createElement('div');
    div.id     = 'typing-indicator';
    div.className = 'flex justify-start mb-3';
    div.innerHTML = `
        <div class="bg-slate-800 px-4 py-3 rounded-2xl rounded-bl-md shadow-sm flex gap-1.5 items-center">
            <div class="w-1.5 h-1.5 bg-slate-400 rounded-full typing-dot"></div>
            <div class="w-1.5 h-1.5 bg-slate-400 rounded-full typing-dot"></div>
            <div class="w-1.5 h-1.5 bg-slate-400 rounded-full typing-dot"></div>
        </div>`;
    chatBox.appendChild(div);
    chatBox.scrollTop = chatBox.scrollHeight;
}

function clearImage() {
    currentImageBase64  = null;
    currentImageDataUrl = null;
    document.getElementById('image-preview-container').classList.add('hidden');
    document.getElementById('image-preview').src = '';
    document.getElementById('image-input').value = '';
}
