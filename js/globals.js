// ── Node.js APIs (Electron renderer — nodeIntegration: true) ──
const fs            = require('fs');
const path          = require('path');
const os            = require('os');
const { exec }      = require('child_process');
const { promisify } = require('util');
const execAsync     = promisify(exec);
const { ipcRenderer }   = require('electron');
const { pathToFileURL } = require('url');

// ── Global error safety net ───────────────────────────────────────
// A stray exception in one feature (or an unhandled promise rejection)
// must never take down the whole UI. We swallow it and log it to the
// console, and keep going. We deliberately do NOT show any on-screen toast:
// the old red "Something went wrong, but the app kept running." popup fired on
// harmless background errors and annoyed the user, so it's removed. Individual
// features still handle their own errors; this is only the last line of defence.
(function () {
    // No-op kept so any caller of window.__vulsorErrToast stays safe.
    function _quietErrToast() {}
    // Remove any toast element left behind by an older build still in the DOM.
    try { const old = document.getElementById('vulsor-global-err-toast'); if (old) old.remove(); } catch (_) {}
    window.addEventListener('error', ev => {
        // Ignore benign resource load errors (missing image/favicon etc.)
        if (ev && ev.target && ev.target !== window && (ev.target.tagName === 'IMG' || ev.target.tagName === 'LINK' || ev.target.tagName === 'SCRIPT')) return;
        // Well-known harmless browser noise, not a real error
        if (ev && typeof ev.message === 'string' && ev.message.includes('ResizeObserver loop')) return;
        console.error('[global error]', ev && (ev.error || ev.message));
    });
    window.addEventListener('unhandledrejection', ev => {
        console.error('[unhandled rejection]', ev && ev.reason);
        if (ev && ev.preventDefault) ev.preventDefault();   // stop console noise
    });
    window.__vulsorErrToast = _quietErrToast;
})();

// ── Storage paths ──────────────────────────────────────────────
const DOCUMENTS_PATH = path.join(os.homedir(), 'Documents', 'Vulsor_Memories');
if (!fs.existsSync(DOCUMENTS_PATH)) fs.mkdirSync(DOCUMENTS_PATH, { recursive: true });

const TODOS_FILE      = path.join(DOCUMENTS_PATH, 'todos.json');
const LISTS_FILE      = path.join(DOCUMENTS_PATH, 'lists.json');
const COMMANDS_FILE   = path.join(DOCUMENTS_PATH, 'commands.json');
const CATEGORIES_FILE = path.join(DOCUMENTS_PATH, 'categories.json');
const CALENDAR_FILE   = path.join(DOCUMENTS_PATH, 'calendar.json');
const STUDY_FILE      = path.join(DOCUMENTS_PATH, 'study.json');
const VAULT_FILE      = path.join(DOCUMENTS_PATH, 'vault.json');
const VAULT_DIR       = path.join(DOCUMENTS_PATH, 'vault');
if (!fs.existsSync(VAULT_DIR)) fs.mkdirSync(VAULT_DIR, { recursive: true });
const FINANCE_FILE    = path.join(DOCUMENTS_PATH, 'finance.json');
const JOURNAL_FILE    = path.join(DOCUMENTS_PATH, 'journal.json');
const LAB_FILE        = path.join(DOCUMENTS_PATH, 'lab.json');
const RECIPES_FILE    = path.join(DOCUMENTS_PATH, 'recipes.json');
const BOOKS_FILE      = path.join(DOCUMENTS_PATH, 'books.json');
const WRITER_FILE     = path.join(DOCUMENTS_PATH, 'writer.json');
const LEARN_FILE      = path.join(DOCUMENTS_PATH, 'learn.json');
const COUNTDOWN_FILE  = path.join(DOCUMENTS_PATH, 'countdowns.json');
const DOCS_FILE       = path.join(DOCUMENTS_PATH, 'docs.json');
const DOCS_DIR        = path.join(DOCUMENTS_PATH, 'docs');
if (!fs.existsSync(DOCS_DIR)) fs.mkdirSync(DOCS_DIR, { recursive: true });
const SETTINGS_FILE   = path.join(DOCUMENTS_PATH, 'settings.json');
const STUDIO_FILE     = path.join(DOCUMENTS_PATH, 'studio.json');
const WORKOUT_FILE    = path.join(DOCUMENTS_PATH, 'workout.json');
const RESEARCH_FILE   = path.join(DOCUMENTS_PATH, 'research.json');
let researchData = { notebooks: [], apiKey: '' };
const COSMOS_FILE     = path.join(DOCUMENTS_PATH, 'cosmos.json');
const BROWSER_FILE    = path.join(DOCUMENTS_PATH, 'browser.json');
const PASSWORDS_FILE  = path.join(DOCUMENTS_PATH, 'passwords.json');
const MAIL_FILE       = path.join(DOCUMENTS_PATH, 'mail.json');
const RTS_SAVE_FILE   = path.join(DOCUMENTS_PATH, 'empire_save.json');
const NETWORK_FILE    = path.join(DOCUMENTS_PATH, 'network.json');
const NETWORK_DIR     = path.join(DOCUMENTS_PATH, 'network_downloads');
if (!fs.existsSync(NETWORK_DIR)) fs.mkdirSync(NETWORK_DIR, { recursive: true });
let mailData = { accounts: [] };
const WORKOUT_DIR     = path.join(DOCUMENTS_PATH, 'workout_media');
if (!fs.existsSync(WORKOUT_DIR)) fs.mkdirSync(WORKOUT_DIR, { recursive: true });
const RECIPES_DIR     = path.join(DOCUMENTS_PATH, 'recipe_photos');
if (!fs.existsSync(RECIPES_DIR)) fs.mkdirSync(RECIPES_DIR, { recursive: true });

// Files to exclude when listing chat sessions
const NON_CHAT_FILES = new Set(['todos.json','lists.json','commands.json','study.json','vault.json','finance.json','journal.json','lab.json','recipes.json','books.json','learn.json','studio.json','workout.json','countdowns.json','news.json','courses.json','calendar.json']);

// ── AI configuration ───────────────────────────────────────────
const MODEL = 'llama3.1:8b';

const TUNING = {
    temperature: 0.7,
    repeat_penalty: 1.1,
    system: `You are Vulsor, a helpful AI assistant. Your name is Vulsor.
RULES:
0. Only if the user explicitly asks who made, built, or created you should you answer that you were created by Alexander. Do not bring up Alexander or who created you in any other situation.
1. Answer questions naturally and concisely. Be direct — skip unnecessary preamble.
2. Never use emojis.
3. Always wrap code in triple backticks with the language name.
4. You can open websites and URLs in the browser, and read web pages to get information from them.
5. You can run shell commands, open macOS apps, search the web, play YouTube, and check system info via your tools.
6. You do NOT have access to the user's personal data — to-do list, lists, Vault files, journal, finance, or saved notes. If the user asks about those, tell them you can't see them and ask them to open the relevant tab.

VISUAL MATH — your chat replies render math and figures. Use these only when the user asks for a formula, graph, plot, function, triangle, or other shape; otherwise answer normally.
- Equations: write LaTeX inline as $ ... $ and centered as $$ ... $$. Example: The roots are $x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}$.
- Graphs of functions: a fenced code block tagged plot, one function per line (use x as the variable; ^ is power; sin, cos, tan, sqrt, ln, log, exp, abs, pi, e are supported). Optionally add lines like "title: ...", "xrange: -10, 10", "yrange: -5, 5".
  Example:
  \`\`\`plot
  title: Parabola vs sine
  y = x^2
  y = sin(x)
  xrange: -6, 6
  \`\`\`
- Shapes / geometry: a fenced code block tagged geometry containing JSON with a "shapes" array. Coordinates are [x, y] with y pointing up. Shape types: triangle, polygon, circle, rect, line, segment, vector, point. Useful keys: points, center, r, from, to, at, color, label, labelVertices (auto A,B,C), lengths (label side lengths), angles (triangle interior angles), and top-level "axes": true / "grid": true.
  Example (a triangle with labelled vertices and side lengths):
  \`\`\`geometry
  {"axes": true, "shapes": [
    {"type": "triangle", "points": [[0,0],[4,0],[1,3]], "labelVertices": true, "lengths": true, "angles": true}
  ]}
  \`\`\``
};

const jarvisEnabled = true;

// ── Shared mutable state ───────────────────────────────────────
let currentFilePath     = null;
let currentChatTitle    = 'New Conversation';
let chatHistory         = [];
let currentImageBase64  = null;
let currentImageDataUrl = null;
let todos               = [];
let categories          = [];
let calEvents           = [];   // calendar events — see calendar.js for the shape
let activeCategoryFilter = null;
let activeDateFilter     = null;  // null | 'today' | 'week' | 'month'
let lists               = { shopping: [], goals: [], ideas: [], projects: [] };
let countdowns          = [];
let currentListTab      = 'shopping';
let customCommands      = [];

// Finance state
let financeData = { transactions: [], timeEntries: [] };

// Workout state — days keyed by 'YYYY-MM-DD'
let workoutData    = { days: {} };
let workoutWeekAnchor = null;   // Monday Date of the visible week

let projects        = [];                  // Studio: build/draw/plan/3D projects
let studioFilter    = 'all';               // 'all' | 'build' | 'draw' | 'plan' | '3d'

// Chat tabs state
let chatTabs       = []; // [{tabId, title, filePath, history}]
let activeChatTabId = null;

// DOM refs — assigned in main.js after DOMContentLoaded
let chatBox, userInput, sessionList;

// ── Text prompt ────────────────────────────────────────────────────────
// Electron's window.prompt() throws "prompt() is not supported.", so every
// call to it failed silently — the click just did nothing. This is a drop-in
// replacement that resolves to the typed string, or null if cancelled.
//
//   const name = await vulsorPrompt('Rename file', current);
//   if (name === null) return;          // cancelled
function vulsorPrompt(message, defaultValue, opts) {
    const o = opts || {};
    return new Promise(resolve => {
        const back = document.createElement('div');
        back.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(8,10,18,.72);'
                           + 'backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center';
        const box = document.createElement('div');
        box.style.cssText = 'width:420px;max-width:92vw;background:var(--bg-surface);border:1px solid rgb(var(--slate-400) / .18);'
                          + 'border-radius:16px;box-shadow:0 24px 80px rgba(0,0,0,.6);padding:18px';
        const label = document.createElement('div');
        label.style.cssText = 'color:rgb(var(--slate-200));font-size:13px;font-weight:600;line-height:1.5;margin-bottom:4px;white-space:pre-wrap';
        label.textContent = message || '';
        const hint = document.createElement('div');
        hint.style.cssText = 'color:rgb(var(--slate-500));font-size:11px;line-height:1.5;margin-bottom:11px';
        hint.textContent = o.hint || '';
        const input = document.createElement(o.multiline ? 'textarea' : 'input');
        if (o.multiline) input.rows = 3;
        input.value = defaultValue == null ? '' : String(defaultValue);
        if (o.placeholder) input.placeholder = o.placeholder;
        input.style.cssText = 'width:100%;background:rgb(var(--slate-400) / .08);color:#fff;font-size:13px;'
                            + 'border:1px solid rgb(var(--slate-400) / .2);border-radius:10px;padding:9px 12px;'
                            + 'outline:none;resize:vertical;font-family:inherit';
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;margin-top:14px';
        const cancel = document.createElement('button');
        cancel.textContent = 'Cancel';
        cancel.style.cssText = 'background:rgb(var(--slate-400) / .14);color:rgb(var(--slate-300));border:none;border-radius:9px;'
                             + 'padding:8px 15px;font-size:12px;font-weight:600;cursor:pointer';
        const ok = document.createElement('button');
        ok.textContent = o.confirmLabel || 'OK';
        ok.style.cssText = 'background:rgb(var(--tw-green-600));color:#fff;border:none;border-radius:9px;padding:8px 17px;'
                         + 'font-size:12px;font-weight:700;cursor:pointer';

        row.append(cancel, ok);
        box.append(label);
        if (o.hint) box.append(hint);
        box.append(input, row);
        back.append(box);
        document.body.appendChild(back);

        let done = false;
        const finish = v => {
            if (done) return;
            done = true;
            document.removeEventListener('keydown', onKey, true);
            back.remove();
            resolve(v);
        };
        function onKey(e) {
            if (e.key === 'Escape') { e.preventDefault(); finish(null); }
            // A textarea needs Enter for newlines, so only the single-line
            // variant submits on it.
            else if (e.key === 'Enter' && !o.multiline) { e.preventDefault(); finish(input.value); }
        }
        document.addEventListener('keydown', onKey, true);
        cancel.onclick = () => finish(null);
        ok.onclick     = () => finish(input.value);
        back.onclick   = e => { if (e.target === back) finish(null); };
        setTimeout(() => { input.focus(); if (input.select) input.select(); }, 0);
    });
}
