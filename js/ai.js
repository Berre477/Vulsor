// ── AI Generation ──────────────────────────────────────────────
// Depends on: globals.js, jarvis.js (JARVIS_SYSTEM, executeTool), chat.js (saveChat)

function addToolCallToUI(toolName, args, result) {
    const div = document.createElement('div');
    div.className = 'flex justify-start mb-2';
    const argsStr    = typeof args === 'object' ? Object.entries(args).map(([k, v]) => `${k}: ${v}`).join(', ') : String(args);
    const shortResult = result.length > 250 ? result.slice(0, 250) + '…' : result;
    div.innerHTML = `
        <div class="tool-card bg-slate-900 text-slate-400 px-4 py-3 rounded-xl max-w-[85%] border border-slate-700/60 text-xs font-mono">
            <div class="flex items-center gap-2 mb-1.5 text-yellow-400/90">
                <i class="fas fa-bolt text-[9px]"></i>
                <span class="font-semibold tracking-wide">${toolName}</span>
                <span class="text-slate-500 font-normal truncate max-w-[240px]">${argsStr}</span>
            </div>
            <div class="text-slate-500 whitespace-pre-wrap leading-relaxed">${shortResult}</div>
        </div>`;
    chatBox.appendChild(div);
    chatBox.scrollTop = chatBox.scrollHeight;
}

// Abort handle for the in-flight generate() call. Set when generate starts,
// cleared when it finishes. cancelGeneration() aborts the active fetch and
// breaks out of the tool loop on the next iteration.
let currentAbortController = null;

function cancelGeneration() {
    if (currentAbortController) {
        currentAbortController.abort();
    }
}

async function generate(text, imageBase64 = null, imageMime = null) {
    const userMsg = { role: 'user', content: text };
    if (imageBase64) { userMsg.images = [imageBase64]; if (imageMime) userMsg.imageMime = imageMime; }
    chatHistory.push(userMsg);
    saveChat();

    currentAbortController = new AbortController();
    const signal = currentAbortController.signal;

    try {
        const systemPrompt = TUNING.system + (jarvisEnabled ? '\n\n' + JARVIS_SYSTEM : '');
        let messages = chatHistory.map(m => ({ ...m }));
        // Ensure the system message in the messages array matches the full prompt
        // (chatHistory only stores the base system prompt; JARVIS tools must be injected here)
        const sysIdx = messages.findIndex(m => m.role === 'system');
        if (sysIdx >= 0) messages[sysIdx].content = systemPrompt;
        else messages.unshift({ role: 'system', content: systemPrompt });

        let iterations = 0;
        let lastReply  = '';
        let lastToolSig = '';
        let repeatCount = 0;
        let webSearchCount = 0;          // cap web searches at 3 per question
        const MAX_ITER  = 8;
        const MAX_WEB_SEARCHES = 3;

        while (iterations++ < MAX_ITER) {
            if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
            const isLastIter = iterations === MAX_ITER;
            // On the final attempt, force the model to wrap up with no more tool calls
            const sysForCall = isLastIter
                ? TUNING.system + '\n\nIMPORTANT: Respond directly to the user now. Do NOT call any more tools.'
                : systemPrompt;
            if (isLastIter) {
                const sysIdx2 = messages.findIndex(m => m.role === 'system');
                if (sysIdx2 >= 0) messages[sysIdx2].content = sysForCall;
            }

            // Whatever provider is selected in the picker (providers.js).
            const reply = await aiComplete({
                system: sysForCall,
                messages,
                signal,
                options: { temperature: TUNING.temperature, repeat_penalty: TUNING.repeat_penalty },
            });
            lastReply = reply;

            if (jarvisEnabled && !isLastIter) {
                // Extract all TOOL_CALLs from the reply
                const toolCalls = [];
                let searchFrom = 0;
                while (true) {
                    const tcIdx = reply.indexOf('TOOL_CALL:', searchFrom);
                    if (tcIdx === -1) break;
                    const jsonStart = reply.indexOf('{', tcIdx);
                    if (jsonStart === -1) break;
                    let depth = 0, jsonEnd = -1;
                    for (let i = jsonStart; i < reply.length; i++) {
                        if (reply[i] === '{') depth++;
                        else if (reply[i] === '}') { depth--; if (depth === 0) { jsonEnd = i; break; } }
                    }
                    if (jsonEnd === -1) break;
                    try {
                        const parsed = JSON.parse(reply.slice(jsonStart, jsonEnd + 1));
                        toolCalls.push({ name: parsed.name, args: parsed.args || {} });
                    } catch (_) {}
                    searchFrom = jsonEnd + 1;
                }

                if (toolCalls.length > 0) {
                    // Detect repeated identical tool calls — model is stuck in a loop, bail early
                    const sig = JSON.stringify(toolCalls);
                    if (sig === lastToolSig) {
                        repeatCount++;
                        if (repeatCount >= 2) break;   // saw the same calls 3 times → give up
                    } else {
                        repeatCount = 0;
                        lastToolSig = sig;
                    }

                    const results = [];
                    for (const tc of toolCalls) {
                        // Cap web searches per question — refuse extras instead of running them
                        if (tc.name === 'web_search' && webSearchCount >= MAX_WEB_SEARCHES) {
                            const limitMsg = `Web search limit reached (max ${MAX_WEB_SEARCHES} per question). Do not search again — answer using the results you already have.`;
                            addToolCallToUI(tc.name, tc.args, limitMsg);
                            results.push(`Tool "${tc.name}" result:\n${limitMsg}`);
                            continue;
                        }
                        if (tc.name === 'web_search') webSearchCount++;
                        const result = await executeTool(tc.name, tc.args);
                        addToolCallToUI(tc.name, tc.args, result);
                        results.push(`Tool "${tc.name}" result:\n${result}`);
                    }
                    messages.push({ role: 'assistant', content: reply });
                    messages.push({ role: 'user',      content: results.join('\n\n') });
                    continue;
                }
            }

            const clean = reply.replace(/TOOL_CALL:\s*\{[\s\S]*?\}\s*\n?/g, '').trim();
            chatHistory.push({ role: 'assistant', content: clean });
            saveChat();
            return clean || reply;
        }

        // Hit max iterations or detected a tool-call loop — return whatever readable text we have
        const fallback = lastReply.replace(/TOOL_CALL:\s*\{[\s\S]*?\}\s*\n?/g, '').trim()
            || 'I got stuck running tools. Try rephrasing the question.';
        chatHistory.push({ role: 'assistant', content: fallback });
        saveChat();
        return fallback;
    } catch (e) {
        if (e.name === 'AbortError') {
            const cancelMsg = '_Request cancelled._';
            chatHistory.push({ role: 'assistant', content: cancelMsg });
            saveChat();
            return cancelMsg;
        }
        if (e.userFacing) {
            if (e.needsKey && typeof aiOpenPicker === 'function') setTimeout(() => aiOpenPicker(), 300);
            return e.message;
        }
        if (e.message.includes('fetch') || e.message.includes('ECONNREFUSED')) {
            return 'I can\'t reach the model right now — check your connection (or, for the local Vulsor model, that it is running) and try again.';
        }
        return `Something went wrong talking to the model: ${e.message}`;
    } finally {
        currentAbortController = null;
    }
}
