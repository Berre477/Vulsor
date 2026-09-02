// ── UI Helpers ─────────────────────────────────────────────────
// Depends on: globals.js (chatBox, currentImageBase64, currentImageDataUrl)

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
