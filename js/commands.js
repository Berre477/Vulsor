// ── Custom Slash Commands ──────────────────────────────────────
// Depends on: globals.js (COMMANDS_FILE, customCommands, userInput)

function loadCommands() {
    try {
        customCommands = fs.existsSync(COMMANDS_FILE) ? JSON.parse(fs.readFileSync(COMMANDS_FILE, 'utf8')) : [];
    } catch (_) {
        customCommands = [];
    }
}

function saveCommands() {
    fs.writeFileSync(COMMANDS_FILE, JSON.stringify(customCommands, null, 2));
}

function renderCommandsList() {
    const list = document.getElementById('commands-list');
    if (!customCommands.length) {
        list.innerHTML = `<p class="text-slate-500 text-xs text-center py-6">No commands yet. Add one below.</p>`;
        return;
    }
    list.innerHTML = customCommands.map((c, i) => `
        <div class="flex items-start gap-3 px-2 py-2.5 rounded-lg hover:bg-slate-800/60 group">
            <div class="flex-1 min-w-0">
                <span class="text-red-600 font-mono text-sm font-semibold">/${c.name}</span>
                <p class="text-slate-500 text-xs mt-0.5 truncate">${c.prompt}</p>
            </div>
            <button class="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-600 transition-all text-xs w-6 h-6 flex items-center justify-center" data-delete="${i}">
                <i class="fas fa-trash"></i>
            </button>
        </div>`).join('');
    list.querySelectorAll('[data-delete]').forEach(btn => {
        btn.onclick = () => {
            customCommands.splice(parseInt(btn.dataset.delete), 1);
            saveCommands();
            renderCommandsList();
        };
    });
}

function showCmdSuggestions(query) {
    const box = document.getElementById('cmd-suggestions');
    const matches = customCommands.filter(c => c.name.toLowerCase().startsWith(query.toLowerCase()));
    if (!matches.length) { box.classList.add('hidden'); return; }
    box.innerHTML = matches.map(c => `
        <div class="cmd-item flex items-center gap-3 px-4 py-2.5 cursor-pointer border-b border-slate-700/50 last:border-0" data-name="${c.name}">
            <span class="text-red-600 font-mono text-sm font-semibold shrink-0">/${c.name}</span>
            <span class="text-slate-400 text-xs truncate">${c.prompt.slice(0, 70)}${c.prompt.length > 70 ? '…' : ''}</span>
        </div>`).join('');
    box.querySelectorAll('.cmd-item').forEach(el => {
        el.onclick = () => applyCommand(el.dataset.name);
    });
    box.classList.remove('hidden');
}

function applyCommand(name) {
    const cmd = customCommands.find(c => c.name === name);
    if (!cmd) return;
    const hasInput = cmd.prompt.includes('{input}');
    userInput.value = hasInput ? cmd.prompt.replace('{input}', '') : cmd.prompt + ' ';
    userInput.focus();
    document.getElementById('cmd-suggestions').classList.add('hidden');
}

function initCommands() {
    document.getElementById('commands-btn').onclick = () => {
        renderCommandsList();
        document.getElementById('commands-modal').classList.add('open');
    };
    document.getElementById('close-commands-btn').onclick = () => {
        document.getElementById('commands-modal').classList.remove('open');
    };
    document.getElementById('commands-modal').onclick = (e) => {
        if (e.target === document.getElementById('commands-modal'))
            document.getElementById('commands-modal').classList.remove('open');
    };
    document.getElementById('add-cmd-btn').onclick = () => {
        const nameEl   = document.getElementById('cmd-name-input');
        const promptEl = document.getElementById('cmd-prompt-input');
        const name   = nameEl.value.trim().replace(/^\//, '').replace(/\s+/g, '-');
        const prompt = promptEl.value.trim();
        if (!name || !prompt) return;
        const existing = customCommands.findIndex(c => c.name === name);
        if (existing >= 0) {
            customCommands[existing].prompt = prompt;
        } else {
            customCommands.push({ name, prompt });
        }
        saveCommands();
        renderCommandsList();
        nameEl.value = '';
        promptEl.value = '';
    };

    userInput.addEventListener('input', () => {
        const val = userInput.value;
        if (val.startsWith('/') && !val.includes(' ')) {
            showCmdSuggestions(val.slice(1));
        } else {
            document.getElementById('cmd-suggestions').classList.add('hidden');
        }
    });

    userInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') document.getElementById('cmd-suggestions').classList.add('hidden');
    });
}
