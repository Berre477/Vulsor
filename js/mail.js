// ── Mail — multi-account IMAP/SMTP client with AI compose ────────────────
// Depends on: globals.js (fs, ipcRenderer, MAIL_FILE, mailData)

const MAIL_PROVIDERS = {
    gmail:   { imapHost:'imap.gmail.com', imapPort:993, smtpHost:'smtp.gmail.com', smtpPort:465, hint:'Use a Google <b>App Password</b> (myaccount.google.com → Security → App passwords; needs 2-Step Verification).' },
    outlook: { imapHost:'outlook.office365.com', imapPort:993, smtpHost:'smtp.office365.com', smtpPort:587, hint:'Use an Outlook app password (account.microsoft.com → Security).' },
    icloud:  { imapHost:'imap.mail.me.com', imapPort:993, smtpHost:'smtp.mail.me.com', smtpPort:587, hint:'Use an app-specific password from appleid.apple.com.' },
    yahoo:   { imapHost:'imap.mail.yahoo.com', imapPort:993, smtpHost:'smtp.mail.yahoo.com', smtpPort:465, hint:'Use a Yahoo app password (account security settings).' },
    custom:  { imapHost:'', imapPort:993, smtpHost:'', smtpPort:465, hint:'Enter your provider’s IMAP and SMTP server details.' },
};

let mailActiveAcct = null;   // account id
let mailMessages   = [];
let mailOpenUid    = null;

function loadMailData() {
    try { if (fs.existsSync(MAIL_FILE)) return JSON.parse(fs.readFileSync(MAIL_FILE,'utf8')); } catch(_){}
    return { accounts: [] };
}
function saveMailData(){ try { fs.writeFileSync(MAIL_FILE, JSON.stringify(mailData,null,2)); } catch(e){ console.error('[mail] save',e); } }
function _mEsc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function _mAcct(){ return mailData.accounts.find(a=>a.id===mailActiveAcct) || null; }
function _mDate(d){ try{ const dt=new Date(d); const now=new Date(); const sameDay=dt.toDateString()===now.toDateString(); return sameDay? dt.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : dt.toLocaleDateString([], {month:'short',day:'numeric'}); }catch(_){ return ''; } }

// ── Render ────────────────────────────────────────────────────────────────
function renderMail() {
    renderMailAccounts();
    if (!mailData.accounts.length) {
        document.getElementById('mail-reader').innerHTML = `
            <div class="flex flex-col items-center justify-center h-full gap-4 text-center p-10">
                <div class="w-16 h-16 rounded-2xl flex items-center justify-center" style="background:rgba(14,165,233,0.15);border:1.5px solid rgba(14,165,233,0.3)"><i class="fas fa-envelope text-2xl text-sky-400"></i></div>
                <div><h2 class="text-slate-100 text-xl font-bold mb-1">Your mail, in Vulsor</h2><p class="text-slate-400 text-sm max-w-md">Connect one or more email accounts to read and reply — with AI help writing your messages.</p></div>
                <button onclick="mailShowAcctModal()" class="px-5 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-sm font-semibold"><i class="fas fa-plus mr-2"></i>Add account</button>
            </div>`;
        document.getElementById('mail-list').innerHTML = '';
        return;
    }
    if (!mailActiveAcct) mailActiveAcct = mailData.accounts[0].id;
    mailLoadInbox();
}

function renderMailAccounts() {
    const el = document.getElementById('mail-account-list');
    if (!el) return;
    el.innerHTML = mailData.accounts.map(a => {
        const active = a.id===mailActiveAcct;
        return `<div class="flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-pointer group ${active?'bg-sky-600/20 border border-sky-500/40':'hover:bg-slate-800/60 border border-transparent'}" onclick="mailSelectAccount('${a.id}')">
            <div class="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0" style="background:#0ea5e9">${_mEsc((a.email||'?')[0].toUpperCase())}</div>
            <div class="min-w-0 flex-1"><div class="text-slate-200 text-[11px] font-medium truncate">${_mEsc(a.email)}</div></div>
            <button onclick="event.stopPropagation();mailRemoveAccount('${a.id}')" class="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400 text-[10px]"><i class="fas fa-times"></i></button>
        </div>`;
    }).join('');
}

function mailSelectAccount(id){ mailActiveAcct=id; mailOpenUid=null; renderMailAccounts(); mailLoadInbox(); }
function mailRemoveAccount(id){
    if (!confirm('Remove this account from Vulsor? (Your email is not deleted.)')) return;
    mailData.accounts = mailData.accounts.filter(a=>a.id!==id); saveMailData();
    if (mailActiveAcct===id) mailActiveAcct = mailData.accounts[0]?.id || null;
    renderMail();
}

async function mailLoadInbox() {
    const acc = _mAcct(); if (!acc) return;
    const list = document.getElementById('mail-list');
    list.innerHTML = `<div class="flex items-center justify-center py-10 text-slate-500 text-sm"><i class="fas fa-circle-notch fa-spin mr-2"></i>Loading…</div>`;
    const r = await ipcRenderer.invoke('mail:list', { acc, limit: 40 });
    if (!r || !r.ok) { list.innerHTML = `<div class="p-4 text-center"><p class="text-red-400 text-xs">${_mEsc(String(r&&r.error||'Could not load').slice(0,120))}</p><button onclick="mailLoadInbox()" class="mt-2 text-sky-400 text-xs underline">Retry</button></div>`; return; }
    mailMessages = r.messages || [];
    if (!mailMessages.length) { list.innerHTML = `<p class="text-slate-600 text-xs text-center py-10 italic">Inbox empty.</p>`; return; }
    list.innerHTML = mailMessages.map(m => `
        <div class="px-4 py-3 border-b border-slate-800/50 cursor-pointer transition-colors ${m.uid===mailOpenUid?'bg-sky-600/15':'hover:bg-slate-800/40'}" onclick="mailOpen(${m.uid})">
            <div class="flex items-center justify-between gap-2 mb-0.5">
                <span class="text-slate-200 text-xs font-${m.seen?'medium':'bold'} truncate">${_mEsc(m.from)}</span>
                <span class="text-slate-600 text-[10px] shrink-0">${_mDate(m.date)}</span>
            </div>
            <div class="text-slate-${m.seen?'400':'200'} text-[11px] truncate font-${m.seen?'normal':'semibold'}">${m.seen?'':'<span class="inline-block w-1.5 h-1.5 rounded-full bg-sky-400 mr-1"></span>'}${_mEsc(m.subject)}</div>
        </div>`).join('');
}

async function mailOpen(uid) {
    mailOpenUid = uid;
    mailLoadInbox();
    const acc = _mAcct(); if (!acc) return;
    const reader = document.getElementById('mail-reader');
    reader.innerHTML = `<div class="flex items-center justify-center h-full text-slate-500 text-sm"><i class="fas fa-circle-notch fa-spin mr-2"></i>Opening…</div>`;
    const r = await ipcRenderer.invoke('mail:get', { acc, uid });
    if (!r || !r.ok) { reader.innerHTML = `<div class="flex items-center justify-center h-full"><p class="text-red-400 text-sm">${_mEsc(String(r&&r.error||'Could not open'))}</p></div>`; return; }
    const m = r.message;
    const bodyHtml = m.html ? `<iframe id="mail-body-frame" sandbox="allow-same-origin" class="w-full" style="border:0;background:#fff;border-radius:8px;min-height:300px"></iframe>`
                            : `<pre class="text-slate-300 text-sm whitespace-pre-wrap leading-relaxed font-sans">${_mEsc(m.text)}</pre>`;
    reader.innerHTML = `
        <div class="px-6 py-4 border-b border-slate-800/70 shrink-0">
            <h2 class="text-slate-100 text-lg font-semibold mb-1">${_mEsc(m.subject||'(no subject)')}</h2>
            <div class="flex items-center justify-between">
                <div class="text-slate-400 text-xs"><span class="text-slate-300 font-medium">${_mEsc(m.from)}</span></div>
                <span class="text-slate-600 text-[11px]">${m.date?new Date(m.date).toLocaleString():''}</span>
            </div>
        </div>
        <div class="flex-1 overflow-y-auto chat-scroll p-6">${bodyHtml}</div>
        <div class="px-6 py-3 border-t border-slate-800/70 shrink-0 flex gap-2">
            <button onclick="mailReply()" class="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold"><i class="fas fa-reply mr-1.5"></i>Reply</button>
            <button onclick="mailReplyAI()" class="px-4 py-2 rounded-xl text-white text-xs font-semibold" style="background:#8b5cf6"><i class="fas fa-wand-magic-sparkles mr-1.5"></i>Reply with AI</button>
        </div>`;
    if (m.html) {
        const frame = document.getElementById('mail-body-frame');
        if (frame) { frame.srcdoc = m.html; }
    }
    mailOpenMsg = m;
}
let mailOpenMsg = null;

// ── Compose / Reply ─────────────────────────────────────────────────────────
function mailCompose(prefill){
    const acc = _mAcct(); if (!acc) { mailShowAcctModal(); return; }
    prefill = prefill || {};
    document.getElementById('mail-compose-modal')?.remove();
    const m = document.createElement('div');
    m.id='mail-compose-modal'; m.className='settings-backdrop'; m.style.cssText='display:flex;z-index:220';
    m.innerHTML = `
        <div class="bg-slate-900 border border-slate-700/60 rounded-2xl w-[620px] max-w-[94vw] flex flex-col shadow-2xl overflow-hidden">
            <div class="px-5 py-3 border-b border-slate-800/80 flex items-center justify-between">
                <h3 class="text-slate-100 text-sm font-semibold">${prefill.subject?'Reply':'New message'}</h3>
                <button onclick="this.closest('.settings-backdrop').remove()" class="text-slate-500 hover:text-white w-7 h-7 flex items-center justify-center rounded-lg hover:bg-slate-800"><i class="fas fa-times"></i></button>
            </div>
            <div class="p-5 flex flex-col gap-2.5">
                <div class="text-slate-500 text-[11px]">From: <span class="text-slate-300">${_mEsc(acc.email)}</span></div>
                <input id="mc-to" class="mail-inp" placeholder="To" value="${_mEsc(prefill.to||'')}">
                <input id="mc-subject" class="mail-inp" placeholder="Subject" value="${_mEsc(prefill.subject||'')}">
                <div class="flex items-center gap-2">
                    <input id="mc-ai-prompt" class="mail-inp flex-1" placeholder="Tell the AI what to write… (e.g. politely decline, ask for a deadline)">
                    <button onclick="mailAIWrite()" id="mc-ai-btn" class="px-3 py-2 rounded-lg text-white text-xs font-semibold shrink-0" style="background:#8b5cf6"><i class="fas fa-wand-magic-sparkles mr-1"></i>Write</button>
                </div>
                <textarea id="mc-body" rows="9" class="mail-inp resize-none chat-scroll" placeholder="Write your message…">${_mEsc(prefill.body||'')}</textarea>
                <div class="flex items-center justify-between">
                    <span id="mc-status" class="text-[11px] text-slate-500"></span>
                    <button onclick="mailSend()" id="mc-send" class="px-5 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-sm font-semibold"><i class="fas fa-paper-plane mr-1.5"></i>Send</button>
                </div>
            </div>
        </div>`;
    document.body.appendChild(m);
    m._reply = prefill._reply || null;
    setTimeout(()=>document.getElementById(prefill.to?'mc-subject':'mc-to')?.focus(),50);
}
function mailReply(){
    if (!mailOpenMsg) return;
    const fromAddr = (mailOpenMsg.from.match(/<([^>]+)>/)||[])[1] || mailOpenMsg.from;
    mailCompose({ to: fromAddr, subject: (mailOpenMsg.subject||'').replace(/^(re:\s*)?/i,'Re: '),
        body: `\n\n--- On ${mailOpenMsg.date?new Date(mailOpenMsg.date).toLocaleString():''}, ${mailOpenMsg.from} wrote ---\n${(mailOpenMsg.text||'').split('\n').map(l=>'> '+l).join('\n')}`,
        _reply: { inReplyTo: mailOpenMsg.messageId, references: mailOpenMsg.messageId } });
}
function mailReplyAI(){
    mailReply();
    setTimeout(()=>{ const p=document.getElementById('mc-ai-prompt'); if(p){ p.value='Write a polite, concise reply'; mailAIWrite(); } }, 120);
}

async function mailAIWrite(){
    const promptEl = document.getElementById('mc-ai-prompt');
    const bodyEl = document.getElementById('mc-body');
    const btn = document.getElementById('mc-ai-btn');
    const instruction = (promptEl.value||'').trim() || 'Write a clear, polite email';
    if (btn){ btn.disabled=true; btn.innerHTML='<i class="fas fa-circle-notch fa-spin"></i>'; }
    const acc = _mAcct();
    const ctx = mailOpenMsg ? `You are replying to this email:\nFrom: ${mailOpenMsg.from}\nSubject: ${mailOpenMsg.subject}\n\n${(mailOpenMsg.text||'').slice(0,3000)}\n\n` : '';
    const sys = `You are an assistant that writes emails for ${acc?acc.name||acc.email:'the user'}. Write ONLY the email body text — no subject line, no "Here is", no markdown, ready to send. Sign off as ${acc?acc.name||'':''}.`;
    const prompt = `${sys}\n\n${ctx}Instruction: ${instruction}\n\nEmail body:`;
    try {
        const r = await ipcRenderer.invoke('claude-cli-chat', { prompt, model: 'sonnet' });
        if (r && r.ok && r.text) {
            const existing = bodyEl.value;
            const quoted = existing.startsWith('\n\n---') ? existing : (existing ? '\n\n'+existing : '');
            bodyEl.value = r.text.trim() + quoted;
        } else {
            document.getElementById('mc-status').textContent = 'AI: ' + String(r&&r.error||'failed').slice(0,80);
        }
    } catch(e){ document.getElementById('mc-status').textContent = e.message; }
    if (btn){ btn.disabled=false; btn.innerHTML='<i class="fas fa-wand-magic-sparkles mr-1"></i>Write'; }
}

async function mailSend(){
    const acc = _mAcct(); if (!acc) return;
    const modal = document.getElementById('mail-compose-modal');
    const to = document.getElementById('mc-to').value.trim();
    const subject = document.getElementById('mc-subject').value.trim();
    const text = document.getElementById('mc-body').value;
    if (!to){ document.getElementById('mc-status').textContent='Add a recipient.'; return; }
    const send = document.getElementById('mc-send');
    send.disabled=true; send.innerHTML='<i class="fas fa-circle-notch fa-spin"></i>';
    const reply = modal._reply || {};
    const r = await ipcRenderer.invoke('mail:send', { acc, to, subject, text, inReplyTo: reply.inReplyTo, references: reply.references });
    if (r && r.ok){ modal.remove(); }
    else { document.getElementById('mc-status').textContent = 'Send failed: ' + String(r&&r.error||'').slice(0,90); send.disabled=false; send.innerHTML='<i class="fas fa-paper-plane mr-1.5"></i>Send'; }
}

// ── Account modal ─────────────────────────────────────────────────────────
function mailShowAcctModal(){ const m=document.getElementById('mail-acct-modal'); if(m){ m.style.display='flex'; mailUpdateProviderUI(); } }
function mailUpdateProviderUI(){
    const prov = document.getElementById('mail-provider').value;
    const p = MAIL_PROVIDERS[prov];
    document.getElementById('mail-pass-hint').innerHTML = p.hint;
    document.getElementById('mail-custom-fields').style.display = prov==='custom'?'':'none';
}

function initMail(){
    mailData = loadMailData();
    document.getElementById('mail-add-acct')?.addEventListener('click', mailShowAcctModal);
    document.getElementById('mail-compose-btn')?.addEventListener('click', ()=>mailCompose());
    document.getElementById('mail-refresh')?.addEventListener('click', mailLoadInbox);
    document.getElementById('mail-acct-close')?.addEventListener('click', ()=>document.getElementById('mail-acct-modal').style.display='none');
    document.getElementById('mail-provider')?.addEventListener('change', mailUpdateProviderUI);
    document.getElementById('mail-acct-modal')?.addEventListener('click', e=>{ if(e.target.id==='mail-acct-modal') document.getElementById('mail-acct-modal').style.display='none'; });

    document.getElementById('mail-acct-save')?.addEventListener('click', async ()=>{
        const prov = document.getElementById('mail-provider').value;
        const preset = MAIL_PROVIDERS[prov];
        const email = document.getElementById('mail-email').value.trim();
        const pass  = document.getElementById('mail-pass').value;
        const name  = document.getElementById('mail-name').value.trim();
        if (!email || !pass) { document.getElementById('mail-acct-status').textContent='Enter email and app password.'; return; }
        const acc = {
            id: 'ma_'+Date.now(), provider: prov, name, email, password: pass,
            imapHost: prov==='custom'? document.getElementById('mail-imap-host').value.trim() : preset.imapHost,
            imapPort: prov==='custom'? (document.getElementById('mail-imap-port').value||993) : preset.imapPort,
            smtpHost: prov==='custom'? document.getElementById('mail-smtp-host').value.trim() : preset.smtpHost,
            smtpPort: prov==='custom'? (document.getElementById('mail-smtp-port').value||465) : preset.smtpPort,
        };
        const status = document.getElementById('mail-acct-status');
        status.innerHTML = '<i class="fas fa-circle-notch fa-spin mr-1"></i>Connecting…';
        const r = await ipcRenderer.invoke('mail:test', acc);
        if (!r || !r.ok) { status.innerHTML = `<span class="text-red-400">${_mEsc(String(r&&r.error||'Connection failed').slice(0,100))}</span>`; return; }
        mailData.accounts.push(acc); saveMailData();
        mailActiveAcct = acc.id;
        document.getElementById('mail-acct-modal').style.display='none';
        ['mail-email','mail-pass','mail-name'].forEach(id=>{ const el=document.getElementById(id); if(el) el.value=''; });
        renderMail();
    });
}
