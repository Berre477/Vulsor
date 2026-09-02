// ── Jarvis / Computer Access ───────────────────────────────────
// Depends on: globals.js

const JARVIS_SYSTEM = `
You are Vulsor, a helpful AI assistant connected to the user's Mac. Your name is Vulsor. Only if the user explicitly asks who made, built, or created you should you answer that you were created by Alexander; do not bring up Alexander otherwise. You have tools available, but your DEFAULT behaviour is to answer directly from your own knowledge without using any tools.

TOOL_CALL FORMAT — output exactly this on its own line, no text before or after on that line:
TOOL_CALL: {"name":"tool_name","args":{"key":"value"}}

WHEN TO USE TOOLS — only in these exact situations:
- User says "open", "go to", "visit", or gives a URL → use open_url
- User says "play", "put on", names a song/video → use play_youtube
- User says "search for", "look up online", "google" → use web_search
- User says "read this page", "fetch", gives a URL to read → use fetch_page
- User asks about their Mac, computer, battery, memory, disk, system specs → use get_system_info
- User asks to run a command, open an app, read/write a file → use the relevant tool
- User says "whatsapp", "text/message <someone> on whatsapp", "send a whatsapp" → use send_whatsapp

NEVER USE TOOLS FOR:
- Questions about health, fitness, diet, nutrition, exercise
- Questions about history, science, math, geography
- How-to questions, advice, recommendations
- Coding help, explanations, definitions
- Anything you can answer from your own knowledge
- Even if the user previously triggered a search — if they say "just tell me" or "from your knowledge", answer directly, NO tools

EXAMPLES:
User: "how do I lose 1kg per week" → answer directly, NO tools
User: "what is the capital of France" → answer directly, NO tools
User: "tell me what you know about X" → answer directly, NO tools
User: "without looking it up" → answer directly, NO tools
User: "open youtube.com" → TOOL_CALL: {"name":"open_url","args":{"url":"https://youtube.com"}}
User: "play bohemian rhapsody" → TOOL_CALL: {"name":"play_youtube","args":{"query":"bohemian rhapsody"}}
User: "what is the weather today" → TOOL_CALL: {"name":"web_search","args":{"query":"weather today"}}
User: "how much RAM do I have" → TOOL_CALL: {"name":"get_system_info","args":{}}
User: "whatsapp Mom that I'll be home by 7" → TOOL_CALL: {"name":"send_whatsapp","args":{"contact":"Mom","message":"I'll be home by 7"}}
User: "text John on whatsapp happy birthday" → TOOL_CALL: {"name":"send_whatsapp","args":{"contact":"John","message":"Happy birthday!"}}
User: "open google and youtube" →
TOOL_CALL: {"name":"open_url","args":{"url":"https://google.com"}}
TOOL_CALL: {"name":"open_url","args":{"url":"https://youtube.com"}}

You do NOT have access to the user's Vault (notes / knowledge base), to-do list, lists, journal, or finance data. If asked to read, create, or edit notes in the Vault, say you can't access it.

WEB BROWSING EXAMPLES (follow these exactly):
User: "open google.com" → TOOL_CALL: {"name":"open_url","args":{"url":"https://google.com"}}
User: "go to youtube" → TOOL_CALL: {"name":"open_url","args":{"url":"https://youtube.com"}}
User: "open https://example.com" → TOOL_CALL: {"name":"open_url","args":{"url":"https://example.com"}}
User: "read the page at example.com" → TOOL_CALL: {"name":"fetch_page","args":{"url":"https://example.com"}}
User: "what does apple.com say about the new iPhone?" → TOOL_CALL: {"name":"fetch_page","args":{"url":"https://apple.com"}}
User: "open google and youtube" →
TOOL_CALL: {"name":"open_url","args":{"url":"https://google.com"}}
TOOL_CALL: {"name":"open_url","args":{"url":"https://youtube.com"}}
User: "open spotify and go to github" →
TOOL_CALL: {"name":"open_app","args":{"app_name":"Spotify"}}
TOOL_CALL: {"name":"open_url","args":{"url":"https://github.com"}}

AVAILABLE TOOLS:
- run_command: {"command":"zsh command"} — runs a shell command
- open_app: {"app_name":"AppName"} — opens a macOS app
- open_url: {"url":"https://..."} — opens a URL
- get_system_info: {} — gets macOS system info
- read_file: {"file_path":"/path"} — reads a file
- write_file: {"file_path":"/path","content":"text"} — writes a file
- list_directory: {"dir_path":"/path"} — lists folder contents
- run_applescript: {"script":"code"} — runs AppleScript
- play_youtube: {"query":"song or video"} — opens YouTube result
- web_search: {"query":"search query"} — searches the web (max 3 searches per question)
- fetch_page: {"url":"https://..."} — reads a webpage
- send_whatsapp: {"contact":"Contact name","message":"text"} — sends a WhatsApp message via the WhatsApp app. Looks the contact's number up in macOS Contacts, opens the chat with the message pre-filled, and auto-sends it. Use the person's name as the user refers to them (e.g. "Mom", "John Smith").`;

async function executeTool(name, args) {
    try {
        if (name === 'run_command') {
            const { stdout, stderr } = await execAsync(args.command, { timeout: 15000, shell: '/bin/zsh' });
            return (stdout || '') + (stderr ? '\nSTDERR: ' + stderr : '') || '(no output)';
        }

        if (name === 'open_app') {
            await execAsync(`open -a "${args.app_name.replace(/"/g, '\\"')}"`);
            return `Opened ${args.app_name}`;
        }

        if (name === 'open_url') {
            await execAsync(`open "${args.url.replace(/"/g, '\\"')}"`);
            return `Opened ${args.url}`;
        }

        if (name === 'get_system_info') {
            const [hw, mem, bat, disk, uptime] = await Promise.all([
                execAsync('sw_vers').then(r => r.stdout.trim()).catch(() => ''),
                execAsync('vm_stat | head -4').then(r => r.stdout.trim()).catch(() => ''),
                execAsync('pmset -g batt | head -2').then(r => r.stdout.trim()).catch(() => ''),
                execAsync('df -h / | tail -1').then(r => r.stdout.trim()).catch(() => ''),
                execAsync('uptime').then(r => r.stdout.trim()).catch(() => '')
            ]);
            return [hw, `Memory:\n${mem}`, `Battery:\n${bat}`, `Disk:\n${disk}`, `Uptime: ${uptime}`].join('\n\n');
        }

        if (name === 'read_file') {
            return fs.readFileSync(args.file_path, 'utf8');
        }

        if (name === 'write_file') {
            fs.writeFileSync(args.file_path, args.content, 'utf8');
            return `Written to ${args.file_path}`;
        }

        if (name === 'list_directory') {
            const entries = fs.readdirSync(args.dir_path, { withFileTypes: true });
            return entries.map(e => (e.isDirectory() ? '[DIR] ' : '      ') + e.name).join('\n');
        }

        if (name === 'run_applescript') {
            const tmpFile = path.join(os.tmpdir(), 'vulsor_script.applescript');
            const script = args.script.replace(/\\n/g, '\n');
            fs.writeFileSync(tmpFile, script, 'utf8');
            const { stdout, stderr } = await execAsync(`osascript "${tmpFile}"`, { timeout: 15000 });
            return stdout.trim() || stderr.trim() || '(done)';
        }

        if (name === 'web_search') {
            const q = encodeURIComponent(args.query);
            const res = await fetch(`https://api.duckduckgo.com/?q=${q}&format=json&no_html=1&skip_disambig=1`, {
                headers: { 'User-Agent': 'Mozilla/5.0' }
            });
            const d = await res.json();
            const parts = [];
            if (d.Answer) parts.push(`Answer: ${d.Answer}`);
            if (d.AbstractText) parts.push(`Summary: ${d.AbstractText}\nSource: ${d.AbstractURL}`);
            if (d.RelatedTopics?.length) {
                const topics = d.RelatedTopics.slice(0, 6)
                    .map(t => t.Text ? `- ${t.Text}${t.FirstURL ? ' (' + t.FirstURL + ')' : ''}` : null)
                    .filter(Boolean);
                if (topics.length) parts.push(`Results:\n${topics.join('\n')}`);
            }
            return parts.join('\n\n') || 'No results found. Try fetch_page with a specific URL.';
        }

        if (name === 'play_youtube') {
            const q = encodeURIComponent(args.query);
            const res = await fetch(`https://www.youtube.com/results?search_query=${q}`, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36' }
            });
            const html = await res.text();
            const match = html.match(/"videoId":"([a-zA-Z0-9_-]{11})"/);
            if (match) {
                const url = `https://www.youtube.com/watch?v=${match[1]}`;
                await execAsync(`open "${url}"`);
                return `Opening: ${url}`;
            }
            await execAsync(`open "https://www.youtube.com/results?search_query=${q}"`);
            return 'Opened YouTube search (could not auto-select video).';
        }

        if (name === 'fetch_page') {
            const res = await fetch(args.url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
            const html = await res.text();
            const text = html
                .replace(/<script[\s\S]*?<\/script>/gi, '')
                .replace(/<style[\s\S]*?<\/style>/gi, '')
                .replace(/<[^>]+>/g, ' ')
                .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#\d+;/g, '')
                .replace(/\s{2,}/g, ' ')
                .trim()
                .slice(0, 4000);
            return text || '(empty page)';
        }

        if (name === 'send_whatsapp') {
            const contact = String(args.contact || args.name || args.to || '').trim();
            const message = String(args.message || args.text || '');
            if (!contact) return 'Error: no contact name given.';
            if (!message) return 'Error: no message text given.';
            const escA = s => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

            // 1. Look up the contact's phone number in the macOS Contacts app.
            const lookup = `tell application "Contacts"
    set matches to (every person whose name contains "${escA(contact)}")
    set n to (count of matches)
    if n is 0 then return "NOTFOUND"
    if n > 1 then
        set nameList to {}
        repeat with pp in matches
            set end of nameList to (name of pp)
        end repeat
        set AppleScript's text item delimiters to "|"
        return "MULTI:" & (nameList as text)
    end if
    set pp to item 1 of matches
    set phs to phones of pp
    if (count of phs) is 0 then return "NOPHONE"
    repeat with x in phs
        set lbl to ((label of x) as text)
        if lbl contains "mobile" or lbl contains "iphone" then return (value of x)
    end repeat
    return (value of item 1 of phs)
end tell`;
            let raw;
            try {
                const f1 = path.join(os.tmpdir(), 'vulsor_wa_lookup.applescript');
                fs.writeFileSync(f1, lookup, 'utf8');
                raw = (await execAsync(`osascript "${f1}"`, { timeout: 15000 })).stdout.trim();
            } catch (e) {
                return `Couldn't read your Contacts: ${e.message}. Open System Settings → Privacy & Security → Contacts and enable Vulsor, then try again.`;
            }
            if (raw === 'NOTFOUND') return `No contact named "${contact}" was found in your Contacts app.`;
            if (raw === 'NOPHONE')  return `"${contact}" has no phone number saved in Contacts.`;
            if (raw.startsWith('MULTI:')) {
                return `Several contacts match "${contact}": ${raw.slice(6).split('|').join(', ')}. Ask the user which one they mean, then call send_whatsapp again with the full name.`;
            }

            // 2. Normalise to the digits WhatsApp expects (country code, no + or spaces).
            let digits = raw.replace(/[^\d]/g, '');
            if (digits.startsWith('00')) digits = digits.slice(2);
            if (digits.length < 7) return `"${contact}" has a phone number WhatsApp can't use: ${raw}. It needs to include the country code.`;

            // 3a. Preferred: send through the linked WhatsApp Assistant (Baileys) — instant
            //     and reliable, with no keystroke simulation or Accessibility permission.
            try {
                const r = await ipcRenderer.invoke('wa-bot:send', { number: digits, text: message });
                if (r && r.ok) return `Sent WhatsApp to ${contact} (${raw}): "${message}"`;
                if (r && r.reason === 'not-on-whatsapp') return `${contact} (${raw}) doesn't seem to be on WhatsApp.`;
                // offline / error → fall through to the app + keystroke method below
            } catch (_) { /* IPC unavailable — fall through */ }

            // 3b. Fallback: hand it to the WhatsApp desktop app signed in on this Mac.
            //     The AppleScript for that lives in wa-bot.js so the assistant and
            //     this tool share one copy; needs Accessibility for the keystroke.
            try {
                const r = await ipcRenderer.invoke('wa-bot:send-app', { number: digits, text: message });
                if (!r || !r.ok) {
                    if (r && r.reason === 'no-accessibility') {
                        return `Opened WhatsApp to ${contact} with the message ready, but couldn't press send. Enable Vulsor under System Settings → Privacy & Security → Accessibility, then try again (or just press Enter in WhatsApp).`;
                    }
                    return `Could not send that WhatsApp to ${contact}: ${(r && (r.error || r.reason)) || 'unknown error'}`;
                }
            } catch (e) {
                return `Could not send that WhatsApp to ${contact}: ${e.message}`;
            }
            return `Sent WhatsApp to ${contact} (${raw}): "${message}"`;
        }

        return 'Unknown tool';
    } catch (e) {
        return `Error: ${e.message}`;
    }
}
