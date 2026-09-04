// ── Vault — File Storage, Organiser & Viewer ────────────────────
// Depends on: globals.js  (fs, path, VAULT_FILE, VAULT_DIR, exec)

// ── Syntax highlighting for fenced code blocks ───────────────────
// Hand-rolled rather than pulling in highlight.js: notes hold short snippets,
// and a 300-line tokenizer keeps the viewer dependency-free (and works offline
// in the print/PDF path too). Unknown languages fall through to plain escaped
// text, so a bad guess never mangles code.
const _VMD_HL_SPECS = (() => {
    const set = s => new Set(s.split(/\s+/).filter(Boolean));

    // Shared pieces. `line`/`block` are comment syntaxes, `str` the quote
    // characters that open a string, `decl` the keywords whose next word names
    // something (so `const foo` / `def foo` colour foo as a variable).
    const cLike = {
        line: '//', block: ['/*', '*/'], str: `"'`,
        decl: set('class interface struct enum type namespace record trait'),
        declVar: set('var let const int float double bool string func fn def function val'),
    };

    const specs = {
        js: {
            ...cLike, str: `"'\``, template: true,
            kw: set(`as async await break case catch class const continue debugger default delete do else export
                     extends finally for from function get if implements import in instanceof interface let new of
                     package private protected public return satisfies set static super switch this throw try type
                     typeof var void while with yield readonly keyof infer declare abstract enum namespace`),
            lit: set('true false null undefined NaN Infinity this super'),
            built: set(`console window document Math JSON Object Array String Number Boolean Promise Map Set WeakMap
                        Date RegExp Error Symbol BigInt Proxy Reflect require module exports process globalThis
                        fetch setTimeout setInterval clearTimeout clearInterval localStorage`),
        },
        py: {
            line: '#', str: `"'`, triple: true, at: true,
            decl: set('class'), declVar: set('def lambda global nonlocal as'),
            kw: set(`and as assert async await break class continue def del elif else except finally for from global
                     if import in is lambda match case nonlocal not or pass raise return try while with yield`),
            lit: set('True False None self cls Ellipsis NotImplemented'),
            built: set(`print len range enumerate zip map filter sorted sum min max abs round open input type isinstance
                        str int float bool list dict set tuple super property staticmethod classmethod format repr
                        any all next iter dir vars getattr setattr hasattr id hash bytes bytearray frozenset`),
        },
        java: {
            ...cLike,
            kw: set(`abstract assert boolean break byte case catch char class const continue default do double else
                     enum extends final finally float for goto if implements import instanceof int interface long
                     native new package private protected public return short static strictfp super switch
                     synchronized this throw throws transient try var void volatile while record sealed yield`),
            lit: set('true false null this super'),
            built: set('String System Integer Double Boolean Object List Map Set ArrayList HashMap Math Optional Stream Exception Override'),
        },
        c: {
            ...cLike,
            kw: set(`alignas alignof auto break case catch char class const constexpr continue decltype default delete
                     do double else enum explicit export extern float for friend goto if inline int long mutable
                     namespace new noexcept operator private protected public register return short signed sizeof
                     static struct switch template this throw try typedef typename union unsigned using virtual void
                     volatile while bool nullptr static_cast dynamic_cast const_cast reinterpret_cast`),
            lit: set('true false NULL nullptr this'),
            built: set('printf scanf malloc free memcpy strlen size_t uint8_t int32_t std vector string cout cin endl unique_ptr shared_ptr'),
        },
        go: {
            ...cLike, str: `"'\``,
            declVar: set('var const func type range'),
            kw: set(`break case chan const continue default defer else fallthrough for func go goto if import
                     interface map package range return select struct switch type var`),
            lit: set('true false nil iota'),
            built: set('len cap make new append copy delete panic recover print println error string int int64 float64 bool byte rune fmt'),
        },
        rust: {
            ...cLike,
            declVar: set('let fn const static mut'),
            kw: set(`as async await break const continue crate dyn else enum extern fn for if impl in let loop match
                     mod move mut pub ref return self Self static struct super trait type unsafe use where while`),
            lit: set('true false None Some Ok Err self Self'),
            built: set('Vec String Option Result Box Rc Arc HashMap println vec panic format assert unwrap expect'),
        },
        sh: {
            line: '#', str: `"'`, dollar: true,
            kw: set(`if then else elif fi for while until do done case esac function in select time coproc return
                     break continue local export readonly declare source alias unset shift trap set`),
            lit: set('true false'),
            built: set(`echo cd ls cat grep sed awk cut sort uniq head tail wc find xargs curl wget git npm node python
                        rm mkdir cp mv chmod chown kill ps sudo brew docker make test printf read exit pwd touch`),
        },
        sql: {
            line: '--', block: ['/*', '*/'], str: `"'`, upperKw: true,
            kw: set(`select from where insert into values update set delete create table drop alter add column index
                     view join inner left right outer full on group by order having limit offset union all distinct
                     as and or not null is in between like exists case when then else end asc desc primary key
                     foreign references unique default constraint begin commit rollback with returning`),
            lit: set('null true false'),
            built: set('count sum avg min max coalesce cast now current_date current_timestamp int text varchar boolean date timestamp serial'),
        },
        json: { line: null, str: `"`, kw: set(''), lit: set('true false null'), built: set('') },
        yaml: { line: '#', str: `"'`, kw: set('true false null yes no on off'), lit: set('true false null yes no'), built: set('') },
        html: { mode: 'html' },
        css:  { mode: 'css'  },
    };

    // Aliases → the spec that fits best.
    const alias = {
        javascript: 'js', jsx: 'js', ts: 'js', typescript: 'js', tsx: 'js', node: 'js', mjs: 'js', cjs: 'js',
        python: 'py', py3: 'py', ipynb: 'py',
        cpp: 'c', 'c++': 'c', cc: 'c', h: 'c', hpp: 'c', cs: 'c', csharp: 'c', objc: 'c', swift: 'c',
        kotlin: 'java', kt: 'java', scala: 'java', dart: 'java', php: 'js', rb: 'py', ruby: 'py',
        golang: 'go', rs: 'rust',
        bash: 'sh', zsh: 'sh', shell: 'sh', console: 'sh', terminal: 'sh', fish: 'sh', ps1: 'sh',
        postgres: 'sql', postgresql: 'sql', mysql: 'sql', sqlite: 'sql',
        yml: 'yaml', toml: 'yaml', ini: 'yaml', conf: 'yaml',
        xml: 'html', svg: 'html', vue: 'html', htm: 'html',
        scss: 'css', sass: 'css', less: 'css',
    };

    return { specs, alias };
})();

function _vmdEscCode(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function _vmdSpan(cls, text) {
    return cls ? `<span class="vmd-t-${cls}">${_vmdEscCode(text)}</span>` : _vmdEscCode(text);
}

function _vmdSpecFor(lang) {
    const key = String(lang || '').toLowerCase().trim().split(/[\s:{,]/)[0];
    if (!key) return null;
    const { specs, alias } = _VMD_HL_SPECS;
    return specs[key] || specs[alias[key]] || null;
}

// Escape a literal string for use inside a RegExp.
function _vmdReEsc(s) { return s.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&'); }

// Build the ordered scan rules for a spec once, then cache them on it.
function _vmdRules(spec) {
    if (spec._rules) return spec._rules;
    const r = [];
    const y = (src) => new RegExp(src, 'y');

    if (spec.block) r.push({ cls: 'c', re: y(`${_vmdReEsc(spec.block[0])}[\\s\\S]*?(?:${_vmdReEsc(spec.block[1])}|$)`) });
    if (spec.line)  r.push({ cls: 'c', re: y(`${_vmdReEsc(spec.line)}.*`) });
    // Python/Ruby docstrings before the single-quote rules, or """ opens an empty string.
    if (spec.triple) r.push({ cls: 's', re: y(`[rbfu]{0,2}("""[\\s\\S]*?(?:"""|$)|'''[\\s\\S]*?(?:'''|$))`) });
    for (const q of (spec.str || '')) {
        // Template literals and shell double quotes span lines; the rest stop at
        // the newline so one stray quote can't paint the whole block.
        const multi = q === '`';
        r.push({ cls: 's', re: y(`[rbfu]{0,2}${q}(?:\\\\.|[^\\\\${q}${multi ? '' : '\\n'}])*${q}?`) });
    }
    if (spec.dollar) r.push({ cls: 'v', re: y('\\$(?:\\{[^}]*\\}|[A-Za-z_][\\w]*|[@*#?$!0-9-])') });
    if (spec.at)     r.push({ cls: 'y', re: y('@[A-Za-z_][\\w.]*') });
    r.push({ cls: 'n', re: y('\\b(?:0[xXbBoO][0-9a-fA-F_]+|\\d[\\d_]*(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)[a-zA-Z_%]*\\b') });
    r.push({ cls: 'id', re: y('[A-Za-z_$][\\w$]*') });
    r.push({ cls: 'o', re: y('[+\\-*/%=<>!&|^~?:@]+') });
    r.push({ cls: null, re: y('\\s+') });
    spec._rules = r;
    return r;
}

// Generic tokenizer: walks the source once, trying each rule at the cursor.
// Identifiers get their colour from context — a call, a property, the name
// being declared, a type — which is what makes variables stand out.
function _vmdHlGeneric(code, spec) {
    const rules = _vmdRules(spec);
    let out = '', i = 0, prev = null;

    while (i < code.length) {
        let hit = null;
        for (const rule of rules) {
            rule.re.lastIndex = i;
            const m = rule.re.exec(code);
            if (m && m[0].length) { hit = { cls: rule.cls, text: m[0] }; break; }
        }
        if (!hit) { out += _vmdEscCode(code[i]); i++; continue; }

        let { cls, text } = hit;
        const after = code.slice(i + text.length);

        if (cls === 'id') {
            const word = spec.upperKw ? text.toLowerCase() : text;
            if (spec.kw.has(word))            cls = 'k';
            else if (spec.lit.has(word))      cls = 'b';
            else if (spec.built.has(word))    cls = 'y';
            else if (/^\s*\(/.test(after))    cls = 'f';   // call or definition
            else if (prev === '.')            cls = 'v';   // property access
            else if (spec.decl && spec.decl.has(prev))     cls = 'y';   // class Name
            else if (spec.declVar && spec.declVar.has(prev)) cls = 'v'; // let name
            else if (/^[A-Z][\w$]*$/.test(text) && text.length > 1) cls = 'y';
            else if (/^\s*=[^=]/.test(after)) cls = 'v';   // assignment target
            else if (/^\s*:/.test(after) && (spec === _VMD_HL_SPECS.specs.yaml)) cls = 'v';
            else cls = null;
        } else if (cls === 's' && /^\s*:/.test(after)) {
            cls = 'v';   // "key": value — JSON/JS object keys read as properties
        }

        out += _vmdSpan(cls, text);
        if (!/^\s/.test(text)) prev = text;
        i += text.length;
    }
    return out;
}

// Markup: tags, attribute names and attribute values, plus comments. Anything
// between tags is left plain, which is what makes the structure readable.
function _vmdHlHtml(code) {
    let out = '', i = 0;
    const re = /<!--[\s\S]*?(?:-->|$)|<\/?[A-Za-z][\w:-]*|\/?>|[A-Za-z_:][\w:.-]*(?=\s*=)|"[^"]*"|'[^']*'/y;
    let inTag = false;
    while (i < code.length) {
        re.lastIndex = i;
        const m = re.exec(code);
        if (!m) { out += _vmdEscCode(code[i]); i++; continue; }
        const t = m[0];
        let cls;
        if (t.startsWith('<!--'))                 cls = 'c';
        else if (t[0] === '<')                    { cls = 'g'; inTag = true; }
        else if (t === '>' || t === '/>')         { cls = 'g'; inTag = false; }
        else if (t[0] === '"' || t[0] === "'")    cls = inTag ? 's' : null;
        else                                      cls = inTag ? 'a' : null;
        out += _vmdSpan(cls, t);
        i += t.length;
    }
    return out;
}

// Stylesheets: at-rules and selectors, then property names and their values.
function _vmdHlCss(code) {
    let out = '', i = 0, inBlock = false, atValue = false;
    const re = /\/\*[\s\S]*?(?:\*\/|$)|"[^"]*"|'[^']*'|@[\w-]+|[#.]?[A-Za-z_][\w-]*|-?\d+(?:\.\d+)?[a-z%]*|#[0-9a-fA-F]{3,8}|[{}:;,()]|\s+/y;
    while (i < code.length) {
        re.lastIndex = i;
        const m = re.exec(code);
        if (!m) { out += _vmdEscCode(code[i]); i++; continue; }
        const t = m[0];
        let cls = null;
        if (t.startsWith('/*'))                        cls = 'c';
        else if (t[0] === '"' || t[0] === "'")         cls = 's';
        else if (t[0] === '@')                         cls = 'k';
        else if (t === '{')                            { inBlock = true; atValue = false; }
        else if (t === '}')                            { inBlock = false; atValue = false; }
        else if (t === ':' && inBlock)                 atValue = true;
        else if (t === ';')                            atValue = false;
        else if (/^#[0-9a-fA-F]{3,8}$/.test(t))        cls = 'n';
        else if (/^-?\d/.test(t))                      cls = 'n';
        else if (!inBlock && /^[A-Za-z#.]/.test(t))    cls = 'g';   // selector
        else if (inBlock && !atValue && /^[A-Za-z-]/.test(t)) cls = 'a';   // property
        else if (inBlock && atValue && /^[A-Za-z-]/.test(t))  cls = 'b';   // value
        out += _vmdSpan(cls, t);
        i += t.length;
    }
    return out;
}

// Entry point used by the fenced-code branch of renderVaultMarkdown.
function vmdHighlight(code, lang) {
    const spec = _vmdSpecFor(lang);
    if (!spec) return _vmdEscCode(code);
    try {
        if (spec.mode === 'html') return _vmdHlHtml(code);
        if (spec.mode === 'css')  return _vmdHlCss(code);
        return _vmdHlGeneric(code, spec);
    } catch (e) {
        console.error('[vault] highlight failed:', e);
        return _vmdEscCode(code);
    }
}

// ── Obsidian-style Markdown Renderer ─────────────────────────────
function renderVaultMarkdown(raw) {
    // ── Math placeholder — browser-side KaTeX renders after innerHTML is set ──
    // We can't call browser katex here (we're still building the HTML string),
    // so we drop a placeholder <span> that vaultRenderMath() fills in afterwards.
    function renderMath(tex, displayMode) {
        const safe = tex.replace(/&/g,'&amp;').replace(/"/g,'&quot;');
        const cls  = displayMode ? 'vmd-math-block' : 'vmd-math-inline';
        return `<span class="${cls} vmd-math-pending" data-tex="${safe}" data-display="${displayMode}"></span>`;
    }

    function esc(s) {
        return String(s)
            .replace(/&/g,'&amp;').replace(/</g,'&lt;')
            .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    // Heading slug — matches Obsidian's anchor ID format
    function slugify(text) {
        return text
            .toLowerCase()
            .normalize('NFD').replace(/[̀-ͯ]/g,'') // strip diacritics
            .replace(/[^\w\s-]/g,'')
            .trim()
            .replace(/\s+/g,'-')
            .replace(/-+/g,'-');
    }

    // ── Inline formatting ────────────────────────────────────────
    function inline(s) {
        if (!s) return '';

        // Protect slots so math/code aren't mangled by bold/italic regexes
        const slots = [];
        function protect(html) { slots.push(html); return `\x00SLOT${slots.length-1}\x00`; }

        // images  ![alt](src)
        s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g,
            (_,alt,src) => protect(`<img src="${esc(src)}" alt="${esc(alt)}" class="vmd-img">`));

        // wikilinks  [[Name]] · [[Name|alias]] · [[Name#heading]]
        s = s.replace(/\[\[([^\]\n|#]+)(?:#[^\]\n|]+)?(?:\|([^\]\n]+))?\]\]/g, (_, name, alias) => {
            name = name.trim();
            const label = (alias || name).trim();
            const id = (typeof vaultResolveLink === 'function') ? vaultResolveLink(name) : null;
            const color = id ? '#a78bfa' : '#6b7280';
            const deco  = id ? '' : 'border-bottom:1px dashed #6b7280;';
            const arg   = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
            return protect(`<a class="vmd-wikilink${id ? '' : ' vmd-wikilink-missing'}" href="#" style="color:${color};text-decoration:none;font-weight:500;${deco}" onclick="event.preventDefault();vaultGraphOpenByName('${arg}');return false">${esc(label)}</a>`);
        });

        // links   [text](url)
        s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_,txt,url) => {
            if (url.startsWith('#')) {
                const id = url.slice(1);
                return protect(`<a class="vmd-a" href="#${id}" onclick="event.preventDefault();(function(){const el=document.getElementById('${id.replace(/'/g,"\\'")}');if(el)el.scrollIntoView({behavior:'smooth',block:'start'});})();return false">${esc(txt)}</a>`);
            }
            return protect(`<a class="vmd-a" href="#" onclick="event.preventDefault();vaultOpenExternal('${url.replace(/'/g,"\\'")}');return false">${esc(txt)}</a>`);
        });

        // inline math  $...$  (must come before code to avoid `` ` `` eating it)
        s = s.replace(/\$([^$\n]+?)\$/g, (_,tex) => protect(renderMath(tex, false)));

        // inline code  `code`
        s = s.replace(/`([^`]+)`/g, (_,c) => protect(`<code class="vmd-ic">${esc(c)}</code>`));

        // Escape remaining special chars
        s = s.replace(/&(?![a-zA-Z#]\w{0,6};)/g,'&amp;');

        // bold+italic  ***t***
        s = s.replace(/\*\*\*(.+?)\*\*\*/g,'<strong><em>$1</em></strong>');
        s = s.replace(/___(.+?)___/g,'<strong><em>$1</em></strong>');
        // bold
        s = s.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>');
        s = s.replace(/__(.+?)__/g,'<strong>$1</strong>');
        // italic
        s = s.replace(/\*([^*\s][^*]*?[^*\s]|\S)\*/g,'<em>$1</em>');
        s = s.replace(/_([^_\s][^_]*?[^_\s]|\S)_/g,'<em>$1</em>');
        // strikethrough
        s = s.replace(/~~(.+?)~~/g,'<del>$1</del>');
        // highlight  ==t==
        s = s.replace(/==(.+?)==/g,
            '<mark style="background:rgba(255,215,0,.18);color:#ffd700;border-radius:2px;padding:0 2px">$1</mark>');

        // Restore protected slots
        s = s.replace(/\x00SLOT(\d+)\x00/g, (_,n) => slots[+n]);
        return s;
    }

    // ── Block parser ─────────────────────────────────────────────
    const lines = raw.split('\n');
    let i = 0;
    let out = '';

    function parseList(baseIndent, ordered) {
        let tag = ordered ? 'ol' : 'ul';
        let items = '';
        while (i < lines.length) {
            const line = lines[i];
            if (line.trim() === '') { i++; continue; }
            const m = line.match(/^(\s*)([-*+]|\d+[.)]) (.*)/);
            if (!m) break;
            const indent = m[1].length;
            if (indent < baseIndent) break;
            if (indent > baseIndent) {
                const isOrd = /\d+/.test(lines[i].match(/^(\s*)([-*+]|\d+[.)])/)?.[2] || '');
                items += parseList(indent, isOrd);
                continue;
            }
            i++;
            const content = m[3];
            // task list  [ ]  [x]
            const taskM = content.match(/^\[([ xX])\] (.*)/);
            if (taskM) {
                const done = taskM[1].toLowerCase() === 'x';
                items += `<li class="vmd-task"><span class="vmd-cb${done?' vmd-cb-done':''}"></span><span class="${done?'vmd-task-done':''}">${inline(taskM[2])}</span></li>`;
            } else {
                let body = inline(content);
                // look-ahead for nested list
                while (i < lines.length) {
                    const nm = lines[i].match(/^(\s*)([-*+]|\d+[.)]) /);
                    if (nm && nm[1].length > indent) {
                        const isOrd2 = /\d+/.test(nm[2]);
                        body += parseList(nm[1].length, isOrd2);
                    } else break;
                }
                items += `<li>${body}</li>`;
            }
        }
        return `<${tag} class="vmd-${tag}">${items}</${tag}>`;
    }

    while (i < lines.length) {
        const line = lines[i];

        // ── Display math  $$...$$  (block)
        if (line.trimStart().startsWith('$$')) {
            const rest = line.trimStart().slice(2);
            // single-line  $$  expr  $$
            if (rest.trimEnd().endsWith('$$') && rest.trim().length > 2) {
                const tex = rest.trimEnd().slice(0, -2).trim();
                out += `<div class="vmd-math-block">${renderMath(tex, true)}</div>`;
                i++; continue;
            }
            // multi-line block: collect until closing $$
            let tex = rest + '\n';
            i++;
            while (i < lines.length && !lines[i].trimStart().startsWith('$$')) {
                tex += lines[i] + '\n';
                i++;
            }
            i++; // skip closing $$
            out += `<div class="vmd-math-block">${renderMath(tex.trim(), true)}</div>`;
            continue;
        }

        // ── Fenced code block  ```lang
        if (/^`{3}/.test(line)) {
            const lang = line.slice(3).trim();
            i++;
            let code = '';
            while (i < lines.length && !/^`{3}/.test(lines[i])) {
                code += lines[i] + '\n';
                i++;
            }
            i++; // closing ```
            const langLabel = lang ? `<span class="vmd-lang">${esc(lang)}</span>` : '';
            const body = vmdHighlight(code.trimEnd(), lang);
            out += `<div class="vmd-pre-wrap">${langLabel}<pre class="vmd-pre"><code>${body}</code></pre></div>`;
            continue;
        }

        // ── ATX Heading  # … ######
        {
            const m = line.match(/^(#{1,6})\s+(.*)/);
            if (m) {
                const lvl = m[1].length;
                const id  = slugify(m[2].replace(/\*+|_+|~~|==|`/g,''));
                out += `<h${lvl} id="${id}" class="vmd-h vmd-h${lvl}">${inline(m[2])}</h${lvl}>`;
                i++;
                continue;
            }
        }

        // ── Setext headings  (underline with === or ---)
        if (i+1 < lines.length) {
            if (/^=+\s*$/.test(lines[i+1]) && line.trim()) {
                const id = slugify(line);
                out += `<h1 id="${id}" class="vmd-h vmd-h1">${inline(line)}</h1>`;
                i += 2; continue;
            }
            if (/^-+\s*$/.test(lines[i+1]) && line.trim()) {
                const id = slugify(line);
                out += `<h2 id="${id}" class="vmd-h vmd-h2">${inline(line)}</h2>`;
                i += 2; continue;
            }
        }

        // ── Horizontal rule
        if (/^(\s*)([-*_])\s*\2\s*\2[\s\2]*$/.test(line.trim()) && line.trim().length >= 3) {
            out += `<hr class="vmd-hr">`;
            i++; continue;
        }

        // ── Blockquote / Obsidian Callout
        if (line.startsWith('>')) {
            let qlines = [];
            while (i < lines.length && (lines[i].startsWith('>') || (qlines.length && lines[i].trim() === ''))) {
                if (lines[i].startsWith('>')) qlines.push(lines[i].replace(/^>\s?/,''));
                else qlines.push('');
                i++;
            }
            // Obsidian callout:  > [!type] title
            const cm = qlines[0]?.match(/^\[!([\w]+)\][ \t]*(.*)/i);
            if (cm) {
                const type  = cm[1].toLowerCase();
                const title = cm[2].trim() || (type[0].toUpperCase()+type.slice(1));
                const body  = qlines.slice(1).join('\n').replace(/^[\n]+|[\n]+$/g,'');
                const colors = {note:'#4a9eff',tip:'#3dba4e',warning:'#e8a838',danger:'#e85050',
                    error:'#e85050',info:'#4a9eff',example:'#9b59b6',quote:'#94a3b8',
                    abstract:'#22d3ee',summary:'#22d3ee',success:'#3dba4e',check:'#3dba4e',
                    failure:'#e85050',fail:'#e85050',bug:'#e85050',question:'#e8a838',
                    help:'#e8a838',important:'#e8a838',caution:'#e85050'};
                const icons  = {note:'fa-pencil-alt',tip:'fa-fire-alt',warning:'fa-exclamation-triangle',
                    danger:'fa-times-circle',error:'fa-times-circle',info:'fa-info-circle',
                    example:'fa-list',quote:'fa-quote-right',abstract:'fa-clipboard-list',
                    summary:'fa-clipboard-list',success:'fa-check-circle',check:'fa-check-circle',
                    failure:'fa-times-circle',fail:'fa-times-circle',bug:'fa-bug',
                    question:'fa-question-circle',help:'fa-question-circle',
                    important:'fa-exclamation-circle',caution:'fa-radiation-alt'};
                const c  = colors[type] || '#4a9eff';
                const ic = icons[type]  || 'fa-info-circle';
                out += `<div class="vmd-callout" style="--ccolor:${c}">
                    <div class="vmd-callout-title">
                        <i class="fas ${ic}"></i> ${esc(title)}
                    </div>
                    <div class="vmd-callout-body">${inline(body)}</div>
                </div>`;
            } else {
                out += `<blockquote class="vmd-bq">${inline(qlines.join('\n'))}</blockquote>`;
            }
            continue;
        }

        // ── Table  (line contains | and next line is separator)
        if (line.includes('|') && i+1 < lines.length && /^\|?[\s\-:|]+\|/.test(lines[i+1])) {
            // Split on | but NOT inside $…$/$$…$$ math, inline `code`, or escaped \|
            const parseRow = r => {
                const cells = [];
                let cur = '', math = false, code = false;
                for (let k = 0; k < r.length; k++) {
                    const ch = r[k];
                    if (ch === '\\' && r[k+1] === '|') { cur += '\\|'; k++; continue; } // escaped pipe
                    if (ch === '$') { math = !math; cur += ch; continue; }
                    if (ch === '`') { code = !code; cur += ch; continue; }
                    if (ch === '|' && !math && !code) { cells.push(cur); cur = ''; continue; }
                    cur += ch;
                }
                cells.push(cur);
                // drop the empty leading/trailing cell produced by surrounding pipes
                if (cells.length && cells[0].trim() === '') cells.shift();
                if (cells.length && cells[cells.length-1].trim() === '') cells.pop();
                return cells.map(c => c.trim());
            };
            const headers  = parseRow(line);
            i += 2; // skip header + separator
            let rows = '';
            while (i < lines.length && lines[i].includes('|') && lines[i].trim().startsWith('|')) {
                rows += `<tr>${parseRow(lines[i]).map(c=>`<td class="vmd-td">${inline(c)}</td>`).join('')}</tr>`;
                i++;
            }
            out += `<div class="vmd-tbl-wrap"><table class="vmd-tbl">
                <thead><tr>${headers.map(h=>`<th class="vmd-th">${inline(h)}</th>`).join('')}</tr></thead>
                <tbody>${rows}</tbody></table></div>`;
            continue;
        }

        // ── List (unordered or ordered)
        {
            const m = line.match(/^(\s*)([-*+]|\d+[.)]) /);
            if (m) {
                out += parseList(m[1].length, /\d+/.test(m[2]));
                continue;
            }
        }

        // ── Blank line → spacer
        if (line.trim() === '') {
            out += '<div class="vmd-space"></div>';
            i++; continue;
        }

        // ── Paragraph: collect consecutive plain lines
        let para = '';
        while (i < lines.length) {
            const l = lines[i];
            if (l.trim() === '') break;
            if (/^#{1,6}\s/.test(l)) break;
            if (/^`{3}/.test(l)) break;
            if (l.startsWith('>')) break;
            if (/^(\s*)([-*+]|\d+[.)]) /.test(l)) break;
            if (l.includes('|') && i+1 < lines.length && /^\|?[\s\-:|]+\|/.test(lines[i+1])) break;
            if (/^(\s*)([-*_])\s*\2\s*\2[\s\2]*$/.test(l.trim()) && l.trim().length >= 3) break;
            para += (para ? '\n' : '') + l;
            i++;
        }
        if (para.trim()) {
            // soft breaks (single \n) → <br> to match Obsidian default rendering
            out += `<p class="vmd-p">${inline(para).replace(/\n/g,'<br>')}</p>`;
        }
    }

    return `
<style>
.vmd-wrap{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:15px;line-height:1.7;color:#dcddde;padding:32px 40px;max-width:860px;margin:0 auto}
.vmd-h{font-weight:700;color:#fff;margin:1.4em 0 .5em;line-height:1.3}
.vmd-h1{font-size:2em;border-bottom:1px solid rgba(255,255,255,.1);padding-bottom:.3em}
.vmd-h2{font-size:1.5em;border-bottom:1px solid rgba(255,255,255,.07);padding-bottom:.25em}
.vmd-h3{font-size:1.2em}
.vmd-h4{font-size:1.05em}
.vmd-h5{font-size:.95em;color:#a0aec0}
.vmd-h6{font-size:.875em;color:#718096}
.vmd-p{margin:.55em 0;color:#cdd6f4}
.vmd-space{height:.6em}
.vmd-a{color:#7aa2f7;text-decoration:none;border-bottom:1px solid rgba(122,162,247,.3);transition:border-color .15s}
.vmd-a:hover{border-color:#7aa2f7}
.vmd-ic{font-family:"SF Mono",Monaco,Consolas,monospace;font-size:.875em;background:rgba(255,255,255,.08);color:#f38ba8;padding:.1em .35em;border-radius:4px;border:1px solid rgba(255,255,255,.08)}
.vmd-pre-wrap{position:relative;margin:1.1em 0;border-radius:8px;overflow:hidden;border:1px solid rgba(255,255,255,.08)}
.vmd-lang{position:absolute;top:8px;right:12px;font-family:"SF Mono",Monaco,Consolas,monospace;font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:.08em;pointer-events:none}
.vmd-pre{margin:0;padding:18px 20px;background:#0d1117;overflow-x:auto;font-family:"SF Mono",Monaco,Consolas,monospace;font-size:13px;line-height:1.6;color:#e2e8f0}
.vmd-pre code{background:none;border:none;padding:0;color:inherit;font-size:inherit}
/* Code colours (GitHub-dark family, tuned for the #0d1117 block background):
   c comment · k keyword · s string · n number · f function · v variable/property
   y type/builtin · b literal/value · o operator · g tag/selector · a attribute */
.vmd-t-c{color:#8b949e;font-style:italic}
.vmd-t-k{color:#ff7b72}
.vmd-t-s{color:#a5d6ff}
.vmd-t-n{color:#f0883e}
.vmd-t-f{color:#d2a8ff}
.vmd-t-v{color:#79c0ff}
.vmd-t-y{color:#7ee787}
.vmd-t-b{color:#ffa657}
.vmd-t-o{color:#ff7b72;opacity:.85}
.vmd-t-g{color:#7ee787}
.vmd-t-a{color:#79c0ff}
.vmd-hr{border:none;border-top:1px solid rgba(255,255,255,.12);margin:1.8em 0}
.vmd-bq{border-left:3px solid #4a9eff;margin:1em 0;padding:.5em 1em;background:rgba(74,158,255,.06);border-radius:0 6px 6px 0;color:#a0aec0;font-style:italic}
.vmd-callout{border-radius:6px;margin:1.1em 0;overflow:hidden;border:1px solid color-mix(in srgb,var(--ccolor) 25%,transparent)}
.vmd-callout-title{display:flex;align-items:center;gap:8px;padding:8px 14px;background:color-mix(in srgb,var(--ccolor) 15%,transparent);color:var(--ccolor);font-weight:600;font-size:13px;text-transform:uppercase;letter-spacing:.06em}
.vmd-callout-title .fas{font-size:12px}
.vmd-callout-body{padding:10px 14px;color:#cdd6f4;font-size:14px;background:color-mix(in srgb,var(--ccolor) 5%,transparent)}
.vmd-ul,.vmd-ol{margin:.5em 0 .5em 1.5em;padding:0;color:#cdd6f4}
.vmd-ul li,.vmd-ol li{margin:.2em 0;padding-left:.2em}
.vmd-ul li::marker{color:#4a9eff}
.vmd-ol li::marker{color:#7aa2f7;font-weight:600}
.vmd-task{list-style:none;display:flex;align-items:baseline;gap:7px;margin:.3em 0}
.vmd-cb{display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;min-width:14px;border:1.5px solid #475569;border-radius:3px;margin-top:2px;background:transparent;transition:all .15s;flex-shrink:0}
.vmd-cb-done{background:#3dba4e;border-color:#3dba4e}
.vmd-cb-done::after{content:"✓";color:#fff;font-size:10px;line-height:1}
.vmd-task-done{color:#6b7280;text-decoration:line-through}
.vmd-tbl-wrap{overflow-x:auto;margin:1.1em 0;border-radius:8px;border:1px solid rgba(255,255,255,.1)}
.vmd-tbl{border-collapse:collapse;width:100%;font-size:14px}
.vmd-th{padding:9px 14px;background:rgba(255,255,255,.06);color:#e2e8f0;font-weight:600;text-align:left;border-bottom:1px solid rgba(255,255,255,.1);white-space:nowrap}
.vmd-td{padding:8px 14px;border-bottom:1px solid rgba(255,255,255,.05);color:#cdd6f4}
.vmd-tbl tbody tr:last-child .vmd-td{border-bottom:none}
.vmd-tbl tbody tr:hover .vmd-td{background:rgba(255,255,255,.03)}
.vmd-img{max-width:100%;border-radius:8px;margin:.5em 0;box-shadow:0 4px 24px rgba(0,0,0,.4)}
.vmd-math-block{display:flex;justify-content:center;padding:14px 0;margin:.8em 0;overflow-x:auto}
math{color:#e2e8f0;font-size:1.05em}
.vmd-p math,p math{font-size:1em;vertical-align:middle}
strong{color:#f1f5f9;font-weight:600}
em{color:#e2e8f0;font-style:italic}
del{color:#6b7280}
</style>
<div class="vmd-wrap">${out}</div>`;
}

// ── Post-process math placeholders with KaTeX ────────────────────────────────
// katex.min.js is a UMD bundle — in Electron (nodeIntegration:true) it exports
// via module.exports rather than window.katex, so we must require() it directly.
let _katexLib = null;
let _katexFontsInjected = false;

function _ensureKatexFonts() {
    if (_katexFontsInjected) return;
    _katexFontsInjected = true;
    // Build absolute file:// URLs so fonts load regardless of packager/asar layout
    const fontDir = path.join(__dirname, '..', 'css', 'katex-fonts').replace(/\\/g, '/');
    const base    = `file://${fontDir.startsWith('/') ? '' : '/'}${fontDir}`;
    const faces = [
        ['KaTeX_Main',       'normal', 400, 'KaTeX_Main-Regular'],
        ['KaTeX_Main',       'italic', 400, 'KaTeX_Main-Italic'],
        ['KaTeX_Main',       'normal', 700, 'KaTeX_Main-Bold'],
        ['KaTeX_Main',       'italic', 700, 'KaTeX_Main-BoldItalic'],
        ['KaTeX_Math',       'italic', 400, 'KaTeX_Math-Italic'],
        ['KaTeX_Math',       'italic', 700, 'KaTeX_Math-BoldItalic'],
        ['KaTeX_AMS',        'normal', 400, 'KaTeX_AMS-Regular'],
        ['KaTeX_Caligraphic','normal', 400, 'KaTeX_Caligraphic-Regular'],
        ['KaTeX_Caligraphic','normal', 700, 'KaTeX_Caligraphic-Bold'],
        ['KaTeX_Fraktur',    'normal', 400, 'KaTeX_Fraktur-Regular'],
        ['KaTeX_Fraktur',    'normal', 700, 'KaTeX_Fraktur-Bold'],
        ['KaTeX_SansSerif',  'normal', 400, 'KaTeX_SansSerif-Regular'],
        ['KaTeX_SansSerif',  'normal', 700, 'KaTeX_SansSerif-Bold'],
        ['KaTeX_SansSerif',  'italic', 400, 'KaTeX_SansSerif-Italic'],
        ['KaTeX_Script',     'normal', 400, 'KaTeX_Script-Regular'],
        ['KaTeX_Typewriter', 'normal', 400, 'KaTeX_Typewriter-Regular'],
        ['KaTeX_Size1',      'normal', 400, 'KaTeX_Size1-Regular'],
        ['KaTeX_Size2',      'normal', 400, 'KaTeX_Size2-Regular'],
        ['KaTeX_Size3',      'normal', 400, 'KaTeX_Size3-Regular'],
        ['KaTeX_Size4',      'normal', 400, 'KaTeX_Size4-Regular'],
    ];
    const css = faces.map(([family, style, weight, file]) =>
        `@font-face{font-family:"${family}";font-style:${style};font-weight:${weight};font-display:block;` +
        `src:url("${base}/${file}.woff2") format("woff2"),` +
        `url("${base}/${file}.woff") format("woff"),` +
        `url("${base}/${file}.ttf") format("truetype")}`
    ).join('\n');
    const style = document.createElement('style');
    style.id = 'katex-abs-fonts';
    style.textContent = css;
    document.head.appendChild(style);
}

function vaultRenderMath(container) {
    if (!_katexLib) {
        try { _katexLib = require('katex'); } catch(_) { return; }
    }
    _ensureKatexFonts();
    container.querySelectorAll('.vmd-math-pending').forEach(el => {
        const tex     = el.dataset.tex || '';
        const display = el.dataset.display === 'true';
        try {
            _katexLib.render(tex, el, {
                displayMode:  display,
                throwOnError: false,
                output:       'html',
                trust:        true,
                strict:       false,
            });
            el.classList.remove('vmd-math-pending');
        } catch(e) {
            el.textContent = tex;
            el.style.color = '#f87171';
        }
    });
}

// Electron 32+ removed File.path — use webUtils instead
const { webUtils, webFrame } = require('electron');
// Enable pinch gesture events to fire (Electron disables visual zoom by default).
// We preventDefault on the wheel events ourselves, so this won't actually page-zoom.
try { webFrame.setVisualZoomLevelLimits(1, 3); } catch(_) {}
function vaultFilePath(f) {
    try { return webUtils.getPathForFile(f); } catch(_) { return f.path || ''; }
}

// ── Persistence ───────────────────────────────────────────────────
function loadVaultData() {
    try {
        return fs.existsSync(VAULT_FILE)
            ? JSON.parse(fs.readFileSync(VAULT_FILE, 'utf8'))
            : { folders: [], files: [] };
    } catch(_) { return { folders: [], files: [] }; }
}
// Write a vault file the same way the index is written: to a temp file, then
// rename over the target. A rename is atomic on the same volume, so a crash or
// a pulled plug mid-write leaves the previous version intact instead of a
// half-written one. Documents auto-save every 800ms while you type, so this is
// the write that happens most often in the whole app.
function vaultWriteFile(fullPath, data) {
    const tmp = fullPath + '.tmp';
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, fullPath);
}

// The Verso → Vulsor rename moved files on disk but left some index entries
// pointing at the old name. An entry whose file is missing opens as a blank
// document — and the next keystroke saves over that blank, stranding the real
// content under the old name. Repair the pointer instead: if the file is gone
// but the same id exists under another extension, point at that.
function vaultRepairStoredNames() {
    let fixed = 0;
    for (const f of vaultData.files) {
        if (!f.storedName || f.isProject || f.isWebLink) continue;
        try {
            if (fs.existsSync(path.join(VAULT_DIR, f.storedName))) continue;
            const id = f.id;
            const twin = fs.readdirSync(VAULT_DIR)
                .find(n => n !== f.storedName && n.startsWith(id + '.'));
            if (!twin) continue;
            console.warn(`[vault] "${f.originalName}": ${f.storedName} is missing, repointing to ${twin}`);
            f.storedName = twin;
            fixed++;
        } catch (e) { console.error('[vault] repair:', e); }
    }
    if (fixed) saveVaultData();
    return fixed;
}

function saveVaultData() {
    // Atomic write: a crash mid-write must not corrupt vault.json
    // (loadVaultData falls back to an empty vault on parse failure,
    // which a later save would then persist — total data loss).
    const tmp = VAULT_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(vaultData, null, 2));
    fs.renameSync(tmp, VAULT_FILE);
    try { _vaultFileMtime = fs.statSync(VAULT_FILE).mtimeMs; } catch(_) {}
    // Tell other windows to reload, so their in-memory copy doesn't
    // go stale and clobber this save the next time *they* save.
    try { ipcRenderer.send('vault-data-changed'); } catch(_) {}
}

// Reload the index from disk after another window saved it. Only the
// metadata + list views refresh — the open editor/viewer is left alone,
// and pending debounced saves still work (they look files up by id at
// fire time, so they find the reloaded objects).
let _vaultFileMtime = 0;
function vaultSyncFromDisk() {
    try {
        const m = fs.statSync(VAULT_FILE).mtimeMs;
        if (m === _vaultFileMtime) return;
        _vaultFileMtime = m;
    } catch(_) { return; }
    vaultData = loadVaultData();
    if (vaultData.sortOrder) vaultSortOrder = vaultData.sortOrder;
    if (vaultDragSrcId) return; // don't rebuild the grid mid-drag
    try {
        renderVaultFolders();
        renderVaultGrid();
    } catch(e) { console.error('[vault] sync render:', e); }
}

// ── Live sync with writers outside the app ─────────────────────────
// vault.json is also written by server/vault-mcp.js, which is how Claude
// (Claude Code / Claude Desktop) puts notes and files in the Vault. Without a
// watcher those only turn up once the window loses and regains focus, so a
// file created while you're looking at the Vault looks like nothing happened.
//
// Watch the *directory*, not vault.json itself: every writer replaces the
// index with a rename, and a file watcher follows the old inode into the void.
// Renames also fire twice, hence the debounce.
let _vaultWatcher    = null;
let _vaultWatchTimer = null;
function vaultStartWatching() {
    if (_vaultWatcher) return;
    try {
        _vaultWatcher = fs.watch(DOCUMENTS_PATH, (_evt, name) => {
            if (name && name !== 'vault.json') return;
            clearTimeout(_vaultWatchTimer);
            _vaultWatchTimer = setTimeout(vaultSyncExternalChange, 250);
        });
    } catch(e) { console.error('[vault] watch:', e); }
}
function vaultStopWatching() {
    clearTimeout(_vaultWatchTimer);
    try { _vaultWatcher?.close(); } catch(_) {}
    _vaultWatcher = null;
}

// Pull in an outside change and point out what landed. Our own saves bump
// _vaultFileMtime before the watcher fires, so those pass through silently.
function vaultSyncExternalChange() {
    const before   = new Set(vaultData.files.map(f => f.id));
    const openSize = vaultData.files.find(f => f.id === vaultOpenFileId)?.size;
    vaultSyncFromDisk();
    const fresh = vaultData.files.filter(f => !before.has(f.id));
    if (fresh.length) {
        const nm = fresh[0].originalName || 'File';
        const label = fresh.length === 1
            ? `<b>${_vaultEsc(nm.length > 24 ? nm.slice(0, 22) + '…' : nm)}</b> added to the Vault`
            : `<b>${fresh.length} files</b> added to the Vault`;
        _vaultShowToast(`<i class="fas fa-sparkles text-blue-400 text-sm"></i> <span>${label}</span>`);
    }
    // A note being read (not edited) should show the new text right away —
    // e.g. you asked Claude to append to the note that's open in front of you.
    const open = vaultData.files.find(f => f.id === vaultOpenFileId);
    if (open && open.size !== openSize) vaultRefreshOpenMarkdown(open);
}

function _vaultEsc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Re-render the markdown viewer in place, keeping the scroll position. Edit
// mode is left alone: the textarea may hold keystrokes not yet saved.
function vaultRefreshOpenMarkdown(file) {
    if (!vaultIsMd || vaultMdEditMode) return;
    const host = document.getElementById('vault-img-el');
    if (!host) return;
    try {
        const text = fs.readFileSync(path.join(VAULT_DIR, file.storedName), 'utf8');
        const top  = host.scrollTop;
        host.innerHTML = renderVaultMarkdown(text)
            + ((typeof vaultGraphBacklinksHTML === 'function') ? vaultGraphBacklinksHTML(file.id) : '');
        host.scrollTop = top;
        vaultRenderMath(host.parentElement || host);
    } catch(e) { console.error('[vault] refresh open note:', e); }
}

// ── State ──────────────────────────────────────────────────────────
let vaultData             = { folders: [], files: [] };
let vaultActiveFolderId   = null;      // null = root "All Files"
let vaultOpenFileId       = null;      // file in viewer
let vaultSearchQuery      = '';
let vaultSortOrder        = 'date-desc';
let vaultDragSrcId        = null;   // id being dragged
let vaultDragSrcType      = null;   // 'file' | 'folder'
let vaultNotesTimer       = null;
let vaultNewFolderColor   = '#f87171';
let vaultNewFolderParent  = null;      // parentId for the modal
let vaultExpandedFolders  = new Set(); // sidebar expand state

// Doc editor state
let vaultIsDoc        = false;
let vaultDocSaveTimer = null;

// Code editor state
let vaultIsCode       = false;

// Notebook state
let vaultIsNotebook   = false;

// Science tool states
let vaultIsMolecule       = false;
let vaultIsPeriodic       = false;
let vaultIsDna            = false;
let vaultIsAnatomy        = false;
let vaultIsChessStrategy  = false;
let vaultIsPhysics        = false;
let vaultIsGraph          = false;

// Markdown editor state
let vaultIsMd        = false;
let vaultMdEditMode  = false;
let vaultMdSaveTimer = null;

// PDF.js state
let pdfDoc          = null;
let pdfPageNum      = 1;
let pdfTotalPages   = 0;
let pdfScale        = 1.0;
let imgZoom         = 1.0;
let pdfRenderQueue  = [];     // pages waiting to render
let pdfRendering    = false;
let pdfObserver     = null;   // IntersectionObserver for scroll tracking
let pdfViewMode     = 'scroll'; // 'scroll' | 'single' | 'book'
let pdfFullscreen   = false;    // is the fullscreen overlay active
let vaultPendingScrollPage = null; // set before reopening a PDF to restore scroll position
let vaultPendingPPTXSlide  = null; // set before reopening a PPTX to restore slide position
let vaultNotesMode  = 'page'; // 'page' | 'all'
let vaultIsPDF      = false;
let vaultIsPPTX     = false;
let pptxSlides      = [];
let pptxCurrentSlide = 0;
let pptxTmpDir      = null;

const VAULT_FOLDER_COLORS = [
    '#f87171','#fb923c','#fbbf24','#34d399',
    '#22d3ee','#60a5fa','#a78bfa','#f472b6',
];

function pickFolderColor() {
    const used = new Set(vaultData.folders.map(f => f.color));
    return VAULT_FOLDER_COLORS.find(c => !used.has(c))
        || VAULT_FOLDER_COLORS[vaultData.folders.length % VAULT_FOLDER_COLORS.length];
}

// ── File type helpers ──────────────────────────────────────────────
function vaultExt(name)  { return (name.split('.').pop() || '').toLowerCase(); }

function vaultIcon(name, isDoc, isCode, isNotebook, file) {
    if (file && file.isCustomNote)     return { icon: 'fa-note-sticky', color: '#eab308' };
    if (file && file.isWebLink)        return { icon: 'fa-globe',       color: '#60a5fa' };
    if (file && file.isMolecule)       return { icon: 'fa-atom',        color: '#10b981' };
    if (file && file.isPeriodic)       return { icon: 'fa-th',          color: '#fbbf24' };
    if (file && file.isDna)            return { icon: 'fa-dna',         color: '#f472b6' };
    if (file && file.isAnatomy)        return { icon: 'fa-heartbeat',   color: '#f87171' };
    if (file && file.isChessStrategy)  return { icon: 'fa-chess',       color: '#d97706' };
    if (file && file.isGraph)          return { icon: 'fa-chart-line',  color: '#38bdf8' };
    if (isDoc)      return { icon: 'fa-file-alt',  color: '#f87171' };
    if (isNotebook || vaultExt(name) === 'vnb')
                    return { icon: 'fa-book-open',  color: '#fb923c' };
    if (isCode || (typeof isCodeFile === 'function' && isCodeFile(name)))
                    return { icon: 'fa-file-code', color: '#22d3ee' };
    const e = vaultExt(name);
    if (e === 'pdf')                                         return { icon: 'fa-file-pdf',      color: '#f87171' };
    if (['pptx','ppt'].includes(e))                          return { icon: 'fa-file-powerpoint', color: '#f97316' };
    if (['png','jpg','jpeg','gif','webp','svg'].includes(e)) return { icon: 'fa-file-image',    color: '#34d399' };
    if (['txt','md','markdown'].includes(e))                 return { icon: 'fa-file-alt',      color: '#60a5fa' };
    if (['doc','docx'].includes(e))                          return { icon: 'fa-file-word',     color: '#60a5fa' };
    if (['xls','xlsx','csv'].includes(e))                    return { icon: 'fa-file-excel',    color: '#22c55e' };
    if (['mp4','mov','avi','mkv'].includes(e))               return { icon: 'fa-file-video',    color: '#a78bfa' };
    if (['mp3','wav','m4a','flac'].includes(e))              return { icon: 'fa-file-audio',    color: '#fb923c' };
    return { icon: 'fa-file', color: '#64748b' };
}

// ── Website links ──────────────────────────────────────────────────
// A vault entry that just points at a URL — opening it launches the site as
// a tab in the built-in browser. Nothing is written to disk (storedName is a
// placeholder so every storedName consumer stays happy).
function openVaultWebsiteModal() {
    const modal  = document.getElementById('vault-website-modal');
    const urlEl  = document.getElementById('vault-website-url-input');
    const nameEl = document.getElementById('vault-website-name-input');
    if (urlEl)  urlEl.value  = '';
    if (nameEl) nameEl.value = '';
    if (modal) modal.classList.add('open');
    setTimeout(() => urlEl?.focus(), 50);
}

function createVaultWebsite() {
    const urlEl  = document.getElementById('vault-website-url-input');
    const nameEl = document.getElementById('vault-website-name-input');
    const raw = (urlEl?.value || '').trim();
    if (!raw) { urlEl?.focus(); return; }
    const url = /^(https?|file):\/\//i.test(raw) ? raw : 'https://' + raw;
    let fallbackName = url;
    try { fallbackName = new URL(url).hostname.replace(/^www\./, ''); } catch (_) {}
    const name = (nameEl?.value || '').trim() || fallbackName;
    const id = 'vf_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    vaultData.files.unshift({
        id, originalName: name, storedName: id + '.weblink',
        folderId: vaultActiveFolderId,
        isWebLink: true, url,
        notes: '', pageNotes: {}, addedAt: Date.now(), size: 0,
    });
    saveVaultData();
    document.getElementById('vault-website-modal')?.classList.remove('open');
    renderVaultFolders();
    renderVaultGrid();
}

// ── Vault doc helpers ──────────────────────────────────────────────
function createVaultDoc() {
    const id         = 'vf_' + Date.now() + '_' + Math.random().toString(36).slice(2,7);
    const storedName = id + '.vulsor';
    fs.writeFileSync(path.join(VAULT_DIR, storedName), '<p><br></p>');
    vaultData.files.unshift({
        id, originalName: 'New Document', storedName,
        folderId: vaultActiveFolderId,
        notes: '', pageNotes: {}, addedAt: Date.now(), size: 0,
        isDoc: true,
    });
    saveVaultData();
    renderVaultFolders();
    renderVaultGrid();
    openVaultFile(id);
}

// A Custom Note — a doc-flavoured file you can fully re-style (background, font
// colour, size, family, spacing) via the palette button in the editor. Same rich
// editor as a Document, but flagged isCustomNote so ONLY these show the Customize
// panel (regular Documents keep the clean default look). Starts on a soft note
// theme so the styling is visible right away.
function createVaultCustomNote() {
    const id         = 'vf_' + Date.now() + '_' + Math.random().toString(36).slice(2,7);
    const storedName = id + '.vulsor';
    fs.writeFileSync(path.join(VAULT_DIR, storedName), '<p><br></p>');
    vaultData.files.unshift({
        id, originalName: 'New Note', storedName,
        folderId: vaultActiveFolderId,
        notes: '', pageNotes: {}, addedAt: Date.now(), size: 0,
        isDoc: true, isCustomNote: true,
        style: { bg: '#fff9c4', fg: '#3f3a12', size: 16, font: "'Inter', sans-serif", lh: 1.7 },
    });
    saveVaultData();
    renderVaultFolders();
    renderVaultGrid();
    openVaultFile(id);
}

function openVaultDocEditor(file, storedPath) {
    // Hide normal viewer, show doc editor
    document.getElementById('vault-normal-view').style.display        = 'none';
    document.getElementById('vault-doc-editor-area').style.display    = '';
    document.getElementById('vault-doc-toolbar-row').style.display    = '';
    document.getElementById('vault-doc-footer').style.display         = '';

    // Switch title span → editable input
    document.getElementById('vault-viewer-title').classList.add('hidden');
    const titleInput = document.getElementById('vault-doc-title-input');
    titleInput.classList.remove('hidden');
    titleInput.value = file.originalName;

    const content = fs.existsSync(storedPath) ? fs.readFileSync(storedPath, 'utf8') : '<p><br></p>';
    const editor  = document.getElementById('vault-doc-editor');
    editor.innerHTML = content || '<p><br></p>';
    // Apply this note's saved appearance (background, font colour, size, …), or
    // reset to defaults for a note that has none, since the editor element is reused.
    try { if (typeof vdOpenDocStyle === 'function') vdOpenDocStyle(file); } catch (_) {}
    editor.focus();
    updateVaultDocWordCount();
    document.getElementById('vault-doc-save-status').textContent = '';
}

function saveVaultDocTitle() {
    if (!vaultOpenFileId) return;
    const file = vaultData.files.find(f => f.id === vaultOpenFileId);
    if (!file) return;
    const val = document.getElementById('vault-doc-title-input').value.trim();
    file.originalName = val || (file.isCustomNote ? 'New Note' : (vaultIsNotebook ? 'New Notebook' : 'New Document'));
    saveVaultData();
    renderVaultGrid();
    renderVaultFolders();
}

function vaultDocOnInput() {
    updateVaultDocWordCount();
    clearTimeout(vaultDocSaveTimer);
    document.getElementById('vault-doc-save-status').textContent = 'saving…';
    vaultDocSaveTimer = setTimeout(saveCurrentVaultDoc, 800);
}

function saveCurrentVaultDoc() {
    if (!vaultOpenFileId) return;
    const file = vaultData.files.find(f => f.id === vaultOpenFileId);
    if (!file) return;
    const html = document.getElementById('vault-doc-editor').innerHTML;
    vaultWriteFile(path.join(VAULT_DIR, file.storedName), html);
    file.size      = Buffer.byteLength(html, 'utf8');
    file.updatedAt = Date.now();
    saveVaultData();
    document.getElementById('vault-doc-save-status').textContent = 'saved';
}

function _saveVaultMdContent() {
    if (!vaultOpenFileId || !vaultMdEditMode) return;
    const file = vaultData.files.find(f => f.id === vaultOpenFileId);
    if (!file) return;
    const ta = document.getElementById('vault-md-textarea');
    if (!ta) return;
    const text = ta.value;
    vaultWriteFile(path.join(VAULT_DIR, file.storedName), text);
    file.size      = Buffer.byteLength(text, 'utf8');
    file.updatedAt = Date.now();
    saveVaultData();
    // A file opened from Finder keeps its original on disk — mirror the edit
    // back there, otherwise the Vault silently forks from the file the user
    // thinks they are editing. Only if the original's folder still exists, so
    // we never resurrect a note the user deleted or moved off a mounted drive.
    if (file.sourcePath) {
        try {
            if (fs.existsSync(path.dirname(file.sourcePath))) vaultWriteFile(file.sourcePath, text);
        } catch (e) { console.error('[vault] write-back to source failed:', e); }
    }
}

function vaultSetMdMode(mode) {
    if (!vaultOpenFileId || !vaultIsMd) return;
    const file       = vaultData.files.find(f => f.id === vaultOpenFileId);
    if (!file) return;
    const altEl      = document.getElementById('vault-content-alt');
    const storedPath = path.join(VAULT_DIR, file.storedName);
    const readBtn    = document.getElementById('vault-md-read-btn');
    const writeBtn   = document.getElementById('vault-md-write-btn');

    if (mode === 'write' && !vaultMdEditMode) {
        vaultMdEditMode = true;
        const text = fs.existsSync(storedPath) ? fs.readFileSync(storedPath, 'utf8') : '';
        altEl.innerHTML = '<textarea id="vault-md-textarea" class="w-full h-full bg-[#0d1117] text-slate-300 text-sm font-mono leading-relaxed outline-none resize-none p-6 chat-scroll" spellcheck="false" placeholder="Write markdown…"></textarea>';
        const ta = document.getElementById('vault-md-textarea');
        ta.value = text;
        ta.addEventListener('input', () => {
            clearTimeout(vaultMdSaveTimer);
            vaultMdSaveTimer = setTimeout(_saveVaultMdContent, 800);
        });
        ta.focus();
        readBtn?.classList.remove('active');
        writeBtn?.classList.add('active');
    } else if (mode === 'read' && vaultMdEditMode) {
        clearTimeout(vaultMdSaveTimer);
        _saveVaultMdContent();
        vaultMdEditMode = false;
        try {
            const text = fs.readFileSync(storedPath, 'utf8');
            altEl.innerHTML = `<div id="vault-img-el" class="w-full h-full overflow-y-auto chat-scroll" style="background:#13141f">${renderVaultMarkdown(text)}</div>`;
            vaultRenderMath(altEl);
        } catch(e) {
            altEl.innerHTML = `<p class="text-red-400 p-6 text-sm">Could not read file: ${e.message}</p>`;
        }
        readBtn?.classList.add('active');
        writeBtn?.classList.remove('active');
    }
}

function vaultPrintMd() {
    if (!vaultOpenFileId || !vaultIsMd) return;
    const file = vaultData.files.find(f => f.id === vaultOpenFileId);
    if (!file) return;

    // Save any pending edits first
    if (vaultMdEditMode) { clearTimeout(vaultMdSaveTimer); _saveVaultMdContent(); }

    const storedPath = path.join(VAULT_DIR, file.storedName);
    const text = fs.existsSync(storedPath) ? fs.readFileSync(storedPath, 'utf8') : '';
    const rendered   = renderVaultMarkdown(text);
    const katexCss   = `file://${path.join(__dirname, '..', 'css', 'katex.css').replace(/\\/g, '/')}`;
    const safeTitle  = (file.originalName || 'Document').replace(/[<>"]/g, '');

    const printHtml = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>${safeTitle}</title>
<link rel="stylesheet" href="${katexCss}">
<style>
  body{margin:0;background:#fff}
  .vmd-wrap{color:#111!important;background:#fff!important;max-width:100%!important;padding:24px 40px!important}
  .vmd-h{color:#000!important}.vmd-h1,.vmd-h2{border-color:#ccc!important}
  .vmd-p,.vmd-ul,.vmd-ol,.vmd-td{color:#222!important}
  .vmd-th{background:#f3f4f6!important;color:#111!important}
  .vmd-pre{background:#f5f5f5!important;color:#333!important;border-color:#ddd!important}
  /* Same token roles in GitHub-light, so a printed note keeps its colours. */
  .vmd-t-c{color:#6a737d!important}.vmd-t-k{color:#d73a49!important}.vmd-t-s{color:#032f62!important}
  .vmd-t-n{color:#b31d28!important}.vmd-t-f{color:#6f42c1!important}.vmd-t-v{color:#005cc5!important}
  .vmd-t-y{color:#22863a!important}.vmd-t-b{color:#e36209!important}.vmd-t-o{color:#d73a49!important}
  .vmd-t-g{color:#22863a!important}.vmd-t-a{color:#6f42c1!important}
  .vmd-ic{background:#f5f5f5!important;color:#c0392b!important;border-color:#ddd!important}
  .vmd-a{color:#2563eb!important}
  .vmd-bq{background:#eff6ff!important;border-color:#3b82f6!important;color:#374151!important}
  .vmd-callout{border-color:var(--ccolor)!important}
  .vmd-callout-body{color:#222!important;background:color-mix(in srgb,var(--ccolor) 8%,#fff)!important}
  strong{color:#000!important} del{color:#666!important}
  @media print{@page{margin:1.5cm} body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style>
</head><body>${rendered}</body></html>`;

    const { ipcRenderer } = require('electron');
    ipcRenderer.invoke('print-html', { html: printHtml, title: safeTitle });
}

function updateVaultDocWordCount() {
    const text   = document.getElementById('vault-doc-editor').innerText || '';
    const words  = text.trim() ? text.trim().split(/\s+/).length : 0;
    document.getElementById('vault-doc-word-count').textContent =
        `${words} words · ${text.length} chars`;
}

function vaultFmtSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024)        return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// ── Folder tree helpers ────────────────────────────────────────────
// Collect a folder + all its descendants
function vaultDescendantIds(folderId) {
    const ids = [folderId];
    vaultData.folders
        .filter(f => f.parentId === folderId)
        .forEach(c => ids.push(...vaultDescendantIds(c.id)));
    return ids;
}

// Build breadcrumb array: [{id, name}, …] from root → active folder
function vaultBreadcrumb(folderId) {
    if (!folderId) return [{ id: null, name: 'All Files' }];
    const crumbs = [];
    let cur = folderId;
    while (cur) {
        const f = vaultData.folders.find(x => x.id === cur);
        if (!f) break;
        crumbs.unshift({ id: f.id, name: f.name });
        cur = f.parentId || null;
    }
    crumbs.unshift({ id: null, name: 'All Files' });
    return crumbs;
}

// Recursive <option> list with indentation for the viewer folder select
function vaultFolderOptions(parentId, depth) {
    return vaultData.folders
        .filter(f => (f.parentId || null) === parentId)
        .map(f => {
            const pad = '\u00a0\u00a0'.repeat(depth);
            return `<option value="${f.id}">${pad}${f.name}</option>`
                + vaultFolderOptions(f.id, depth + 1);
        }).join('');
}

function setVaultFolder(id) {
    vaultActiveFolderId = id;
    if (id) vaultExpandedFolders.add(id);
    renderVaultFolders();
    renderVaultGrid();
}

// ── File operations ────────────────────────────────────────────────
// Returns { added, failed, ids, folderId } so callers (the browser's
// downloads bar, drag-and-drop) can report what actually happened instead
// of assuming success — a copy that throws used to be logged and silently
// swallowed, leaving the caller claiming the file was in the Vault.
function addFilesToVault(filePaths, targetFolderId) {
    // targetFolderId lets the caller drop files into a specific folder.
    // When omitted, fall back to the folder currently being viewed.
    if (targetFolderId === undefined) targetFolderId = vaultActiveFolderId;
    targetFolderId = targetFolderId || null;
    // Another window may have written the index since we last read it. Pull
    // it in first (cheap mtime check) so our save doesn't drop their changes,
    // and so the folder check below runs against the current folder list.
    try { vaultSyncFromDisk(); } catch(_) {}
    // A folder that no longer exists would swallow the file: it isn't the
    // root, so "All Files" won't list it, and there's no folder left to open.
    if (targetFolderId && !vaultData.folders.some(f => f.id === targetFolderId)) targetFolderId = null;

    const result = { added: 0, failed: 0, ids: [], folderId: targetFolderId };
    // .docx files (Word / Google Docs export) are converted into editable
    // Vault docs instead of being stored as raw binary attachments.
    const docx = filePaths.filter(p => /\.docx$/i.test(p));
    if (docx.length && typeof vaultImportDocxFiles === 'function') {
        const imported = vaultImportDocxFiles(docx, targetFolderId) || 0;
        result.added  += imported;
        result.failed += docx.length - imported;
        filePaths = filePaths.filter(p => !/\.docx$/i.test(p));
        if (!filePaths.length) return result;
    }
    filePaths.forEach(srcPath => {
        try {
            const originalName = path.basename(srcPath);
            const id           = 'vf_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
            const ext          = vaultExt(originalName);
            const storedName   = id + (ext ? '.' + ext : '');
            const destPath     = path.join(VAULT_DIR, storedName);
            fs.copyFileSync(srcPath, destPath);
            const stats = fs.statSync(destPath);
            vaultData.files.push({
                id, originalName, storedName,
                folderId: targetFolderId,
                notes: '', pageNotes: {}, addedAt: Date.now(), size: stats.size,
            });
            result.added++;
            result.ids.push(id);
        } catch(e) { result.failed++; console.error('Vault add failed:', e); }
    });
    if (result.added && targetFolderId) vaultExpandedFolders.add(targetFolderId);
    if (result.added) { saveVaultData(); renderVaultFolders(); renderVaultGrid(); }
    return result;
}

// ── Files handed to us by the OS ────────────────────────────────────
// Vulsor is registered as a handler for .md/.markdown, so double-clicking one
// in Finder launches the app with that path (main.js → 'open-external-file').
// The Vault viewer reads from VAULT_DIR/storedName, so an outside file has to
// be brought in: copy it once, remember where it came from in `sourcePath`, and
// reuse that entry on every later open instead of piling up duplicates. Edits
// made in the Vault are written back to the original file (_saveVaultMdContent),
// so opening a note here behaves like opening it in any other editor.
function _vaultRealPath(p) {
    try { return fs.realpathSync(p); } catch (_) { return path.resolve(p); }
}

function vaultFileForSourcePath(fullPath) {
    const norm = _vaultRealPath(fullPath);
    // Already a Vault file? Open the entry that owns it rather than copying it
    // back into the Vault under a second id.
    const dir = path.dirname(norm);
    if (dir === _vaultRealPath(VAULT_DIR)) {
        const base = path.basename(norm);
        return vaultData.files.find(f => f.storedName === base) || null;
    }
    return vaultData.files.find(f => f.sourcePath && _vaultRealPath(f.sourcePath) === norm) || null;
}

// Import (or find) an outside file and open it in the Vault. Returns the file
// id, or null if it could not be brought in.
function vaultOpenExternalFile(fullPath) {
    if (!fullPath) return null;
    try { vaultSyncFromDisk(); } catch (_) {}
    if (!fs.existsSync(fullPath)) {
        _vaultShowToast(`<i class="fas fa-triangle-exclamation text-amber-400 text-sm"></i> <span>File not found: <b>${_vaultEsc(path.basename(fullPath))}</b></span>`);
        return null;
    }

    const norm = _vaultRealPath(fullPath);
    let file = vaultFileForSourcePath(norm);

    if (file) {
        // Seen before: refresh the Vault's copy if the file changed on disk
        // since we last looked, so the viewer never shows a stale note.
        if (file.sourcePath) {
            try {
                const stored = path.join(VAULT_DIR, file.storedName);
                const srcM = fs.statSync(norm).mtimeMs;
                const dstM = fs.existsSync(stored) ? fs.statSync(stored).mtimeMs : 0;
                if (srcM > dstM) {
                    fs.copyFileSync(norm, stored);
                    file.size      = fs.statSync(stored).size;
                    file.updatedAt = Date.now();
                    saveVaultData();
                }
            } catch (e) { console.error('[vault] refresh from source failed:', e); }
        }
    } else {
        const res = addFilesToVault([norm], null);
        if (!res.added || !res.ids.length) {
            _vaultShowToast(`<i class="fas fa-triangle-exclamation text-amber-400 text-sm"></i> <span>Could not open <b>${_vaultEsc(path.basename(norm))}</b></span>`);
            return null;
        }
        file = vaultData.files.find(f => f.id === res.ids[0]);
        if (!file) return null;
        file.sourcePath = norm;
        saveVaultData();
    }

    // Show it: reuse a Vault tab and open the file straight into the viewer.
    // Re-opening the note that is already on screen skips the reopen (see
    // _restoreVaultTabState), so re-render it here or an outside edit we just
    // copied in would not show up.
    const alreadyOpen = (vaultOpenFileId === file.id);
    if (typeof window.appOpenVaultAt === 'function') {
        window.appOpenVaultAt(file.folderId || null, file.id);
    } else {
        setVaultFolder(file.folderId || null);
        openVaultFile(file.id);
    }
    if (alreadyOpen) vaultRefreshOpenMarkdown(file);
    return file.id;
}

window.appOpenVaultExternalFile = vaultOpenExternalFile;

function deleteVaultFile(id) {
    const file = vaultData.files.find(f => f.id === id);
    if (!file) return;
    if (!file.isProject) {
        try {
            const p = path.join(VAULT_DIR, file.storedName);
            if (fs.existsSync(p)) fs.unlinkSync(p);
        } catch(_) {}
    }
    vaultThumbDelete(id);
    vaultData.files = vaultData.files.filter(f => f.id !== id);
    saveVaultData();
    if (vaultOpenFileId === id) closeVaultViewer();
    renderVaultFolders();
    renderVaultGrid();
}

// ── Viewer ─────────────────────────────────────────────────────────

// ── PDF.js helpers ──

// The scroll container currently hosting the PDF (normal or fullscreen)
function getPDFScrollEl() {
    return document.getElementById(pdfFullscreen ? 'vault-pdf-fs-scroll' : 'vault-pdf-scroll');
}

// Returns (or creates) the pages wrapper div inside the active scroll container
function getPDFPagesEl() {
    let el = document.getElementById('vault-pdf-pages');
    if (!el) {
        el = document.createElement('div');
        el.id        = 'vault-pdf-pages';
        el.className = 'flex flex-col items-center gap-5 py-6 w-full';
    }
    const scrollEl = getPDFScrollEl();
    if (el.parentElement !== scrollEl) scrollEl.appendChild(el);
    return el;
}

// ── Lazy scroll rendering ─────────────────────────────────────────────
// For large PDFs (hundreds/thousands of pages) we never allocate a canvas
// for every page. Each page is a sized placeholder; canvases are rendered
// only when the page nears the viewport and torn down when it scrolls away.
let pdfRenderObserver = null;   // renders/unloads pages near viewport
let pdfPlaceW = 0, pdfPlaceH = 0; // estimated page size at current scale
let _pdfRenderInFlight = new Set();

// ── Shared page painting helpers ─────────────────────────────────────
// Canvases are painted at devicePixelRatio so text stays crisp on retina
// displays, then scaled back down via CSS to the layout size.
function _pdfDPR() {
    return Math.min(window.devicePixelRatio || 1, 3);
}

// Size + paint `canvas` for `page` at `vp`. Returns the render promise.
function paintPageCanvas(page, vp, canvas) {
    const dpr = _pdfDPR();
    canvas.width  = Math.floor(vp.width  * dpr);
    canvas.height = Math.floor(vp.height * dpr);
    canvas.style.width  = vp.width  + 'px';
    canvas.style.height = vp.height + 'px';
    const ctx = canvas.getContext('2d', { alpha: false });
    return page.render({
        canvasContext: ctx,
        viewport: vp,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null
    }).promise;
}

// Overlay an invisible, selectable text layer on top of a page so the user
// can select and copy sentences straight out of the PDF.
function attachTextLayer(page, vp, wrapper) {
    if (!wrapper || typeof pdfjsLib === 'undefined' || !pdfjsLib.renderTextLayer) return;
    const old = wrapper.querySelector('.pdf-text-layer');
    if (old) old.remove();

    const layer = document.createElement('div');
    layer.className = 'pdf-text-layer';
    layer.style.width  = vp.width  + 'px';
    layer.style.height = vp.height + 'px';
    wrapper.appendChild(layer);

    page.getTextContent().then(textContent => {
        if (!layer.isConnected) return;
        pdfjsLib.renderTextLayer({
            textContentSource: textContent,
            container: layer,
            viewport: vp,
            textDivs: []
        });
    }).catch(() => {});
}

// Render a single page's canvas into its placeholder wrapper (idempotent)
function renderScrollPage(num) {
    if (!pdfDoc) return;
    const wrapper = document.querySelector(`#vault-pdf-pages [data-page-num="${num}"]`);
    if (!wrapper) return;
    if (wrapper.querySelector('canvas')) return;       // already rendered
    if (_pdfRenderInFlight.has(num)) return;            // render pending
    _pdfRenderInFlight.add(num);

    pdfDoc.getPage(num).then(page => {
        // Page may have been unloaded again while getPage resolved
        const w = document.querySelector(`#vault-pdf-pages [data-page-num="${num}"]`);
        if (!w || w.querySelector('canvas')) { _pdfRenderInFlight.delete(num); return; }
        if (!w.dataset.wanted) { _pdfRenderInFlight.delete(num); return; }

        const vp     = page.getViewport({ scale: pdfScale });
        const canvas = document.createElement('canvas');
        canvas.id          = `vault-pdf-page-${num}`;
        canvas.className   = 'block shadow-2xl rounded-sm';
        // Placeholders are sized from page 1, so a page whose real size differs
        // resizes the moment it renders. When that page sits ABOVE the viewport
        // the change drags whatever you're reading up or down with it — which is
        // what made zoom drift onto a different page. Measure first, then put the
        // scroll position back by the same amount.
        const scrollEl = getPDFScrollEl();
        const wasAbove = scrollEl && w.getBoundingClientRect().bottom
                                     <= scrollEl.getBoundingClientRect().top;
        const oldH = w.offsetHeight;
        // Lock the wrapper to exact page size
        w.style.width  = vp.width  + 'px';
        w.style.height = vp.height + 'px';
        if (wasAbove) {
            const dH = w.offsetHeight - oldH;
            if (dH) scrollEl.scrollTop += dH;
        }
        w.insertBefore(canvas, w.firstChild);
        paintPageCanvas(page, vp, canvas)
            .then(() => { _pdfRenderInFlight.delete(num); })
            .catch(() => { _pdfRenderInFlight.delete(num); });
        attachTextLayer(page, vp, w);
        // Marks live above the text layer, sized to this page at this zoom.
        try { if (window.pdfAnnot) window.pdfAnnot.attach(w, num, vp.width, vp.height); } catch (e) { console.error('[vault] annot layer:', e); }
    }).catch(() => { _pdfRenderInFlight.delete(num); });
}

// Free a page's canvas memory but keep its placeholder sized
function unloadScrollPage(num) {
    const wrapper = document.querySelector(`#vault-pdf-pages [data-page-num="${num}"]`);
    if (!wrapper) return;
    const canvas = wrapper.querySelector('canvas');
    if (canvas) {
        // Zero the bitmap to release GPU/CPU memory, then remove
        canvas.width = 0; canvas.height = 0;
        canvas.remove();
    }
    const layer = wrapper.querySelector('.pdf-text-layer');
    if (layer) layer.remove();
    const annot = wrapper.querySelector('.pdf-annot-layer');
    if (annot) annot.remove();
    _pdfRenderInFlight.delete(num);
}

// ── Keeping your place across a zoom ─────────────────────────────────
// Zooming rebuilds every placeholder, so the scroll offset you were at means
// something different afterwards. Remembering the page number alone wasn't
// enough: page heights change, and pages that render lazily resize their
// placeholder, so the restore drifted and landed you somewhere else entirely.
// Capture the page AND how far into it you are, then put that back exactly.
let _pdfRestoring = false;   // suppress page tracking while we reposition

function _pdfCapturePosition(scrollEl) {
    if (!scrollEl) return null;
    const top = scrollEl.getBoundingClientRect().top;
    const wrappers = document.querySelectorAll('#vault-pdf-pages [data-page-num]');
    for (const w of wrappers) {
        const r = w.getBoundingClientRect();
        if (r.bottom > top + 1) {          // first page still on screen
            const h = r.height || 1;
            return {
                page: parseInt(w.dataset.pageNum, 10) || 1,
                frac: Math.min(1, Math.max(0, (top - r.top) / h)),
            };
        }
    }
    return null;
}

function _pdfRestorePosition(scrollEl, pos) {
    if (!scrollEl || !pos) return;
    const w = document.querySelector(`#vault-pdf-pages [data-page-num="${pos.page}"]`);
    if (!w) return;
    const r = w.getBoundingClientRect();
    // Jump, never smooth-scroll: an animation across hundreds of pages both looks
    // wrong and lets the tracking observer rewrite the page number on the way.
    scrollEl.scrollTop += (r.top - scrollEl.getBoundingClientRect().top) + pos.frac * (r.height || 0);
}

// Re-render current view (after zoom change) — keeps the current scale
function reRenderAllPages() {
    if (!pdfDoc) return;
    if (pdfViewMode === 'single') { buildPDFSingleView(); return; }
    if (pdfViewMode === 'book')   { buildPDFBookView();   return; }
    // Scroll mode: rebuild placeholders at the current scale, keep position
    buildPDFScrollView(true);
}

// Build the full scrollable page stack (lazy).
// keepScale=true preserves the current pdfScale (zoom); otherwise fit-to-width.
function buildPDFScrollView(keepScale) {
    if (!pdfDoc) return;

    // Disconnect old observers
    if (pdfObserver)       { pdfObserver.disconnect();       pdfObserver = null; }
    if (pdfRenderObserver) { pdfRenderObserver.disconnect(); pdfRenderObserver = null; }
    _pdfRenderInFlight.clear();

    const scrollEl = getPDFScrollEl();
    const pagesEl  = getPDFPagesEl();
    // Preserve exactly where we were so a zoom rebuild lands in the same place.
    // Only on a rebuild — a fresh open has nothing to preserve and starts at the
    // top (or at the page a restored tab asked for).
    const restorePos = keepScale ? _pdfCapturePosition(scrollEl) : null;
    pagesEl.innerHTML = '';

    // Compute scale + placeholder size from page 1
    pdfDoc.getPage(1).then(firstPage => {
        const vp0       = firstPage.getViewport({ scale: 1 });
        if (!keepScale) {
            const available = (scrollEl ? scrollEl.clientWidth : 800) - 48;
            pdfScale        = Math.max(0.3, available / vp0.width);
        }
        pdfPlaceW       = vp0.width  * pdfScale;
        pdfPlaceH       = vp0.height * pdfScale;

        // Build lightweight placeholders (no canvas yet)
        const frag = document.createDocumentFragment();
        for (let i = 1; i <= pdfTotalPages; i++) {
            const wrapper = document.createElement('div');
            wrapper.className       = 'relative shrink-0';
            wrapper.dataset.pageNum = i;
            wrapper.style.width  = pdfPlaceW + 'px';
            wrapper.style.height = pdfPlaceH + 'px';

            const badge = document.createElement('div');
            badge.className   = 'absolute bottom-2 right-2 bg-black/50 text-white/60 text-[10px] font-mono px-1.5 py-0.5 rounded pointer-events-none';
            badge.textContent = i;
            wrapper.appendChild(badge);
            frag.appendChild(wrapper);
        }
        pagesEl.appendChild(frag);

        updateVaultPDFControls();
        updateNotesForCurrentPage();

        // Render observer — render pages within ~1.5 viewports, unload beyond
        pdfRenderObserver = new IntersectionObserver(entries => {
            entries.forEach(entry => {
                const num = parseInt(entry.target.dataset.pageNum);
                if (entry.isIntersecting) {
                    entry.target.dataset.wanted = '1';
                    renderScrollPage(num);
                } else {
                    delete entry.target.dataset.wanted;
                    unloadScrollPage(num);
                }
            });
        }, { root: scrollEl, rootMargin: '1200px 0px 1200px 0px', threshold: 0 });

        // Tracking observer — which page is most visible (for page number + notes)
        pdfObserver = new IntersectionObserver(entries => {
            let best = null, bestRatio = 0;
            entries.forEach(entry => {
                if (entry.intersectionRatio > bestRatio) {
                    bestRatio = entry.intersectionRatio;
                    best      = entry.target;
                }
            });
            if (best && !_pdfRestoring) {
                const newPage = parseInt(best.dataset.pageNum);
                if (newPage !== pdfPageNum) {
                    pdfPageNum = newPage;
                    updateVaultPDFControls();
                    if (vaultNotesMode === 'page') updateNotesForCurrentPage();
                }
            }
        }, { root: scrollEl, threshold: [0, 0.25, 0.5, 0.75, 1.0] });

        pagesEl.querySelectorAll('[data-page-num]').forEach(w => {
            pdfRenderObserver.observe(w);
            pdfObserver.observe(w);
        });

        // Restore scroll position (from zoom rebuild or pending open)
        if (vaultPendingScrollPage && vaultPendingScrollPage > 1) {
            const pending = vaultPendingScrollPage;
            vaultPendingScrollPage = null;
            setTimeout(() => scrollToPage(pending), 60);
        } else if (restorePos) {
            vaultPendingScrollPage = null;
            _pdfRestoring = true;
            // Two frames: one for the placeholders to lay out, one to land on them.
            requestAnimationFrame(() => requestAnimationFrame(() => {
                _pdfRestorePosition(scrollEl, restorePos);
                pdfPageNum = restorePos.page;
                updateVaultPDFControls();
                if (vaultNotesMode === 'page') updateNotesForCurrentPage();
                // Let the lazy renders settle before tracking takes over again.
                setTimeout(() => { _pdfRestoring = false; }, 200);
            }));
        } else {
            vaultPendingScrollPage = null;
        }
    });
}

// Scroll to a specific page (scroll mode only)
function scrollToPage(num) {
    const target = document.querySelector(`#vault-pdf-pages [data-page-num="${num}"]`);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Jump to a page, respecting the current view mode
function gotoPDFPage(num) {
    if (!pdfDoc || num < 1 || num > pdfTotalPages) return;
    if (pdfViewMode === 'single') { pdfPageNum = num; buildPDFSingleView(); }
    else if (pdfViewMode === 'book') {
        // Snap to the spread containing this page (1=cover, then 2-3, 4-5…)
        pdfPageNum = num === 1 ? 1 : (num % 2 === 0 ? num : num - 1);
        buildPDFBookView();
    } else {
        scrollToPage(num);
    }
}

// ── Single-page view ─────────────────────────────────────────────────
function buildPDFSingleView() {
    if (!pdfDoc) return;
    if (pdfObserver)       { pdfObserver.disconnect();       pdfObserver = null; }
    if (pdfRenderObserver) { pdfRenderObserver.disconnect(); pdfRenderObserver = null; }
    _pdfRenderInFlight.clear();

    const scrollEl = getPDFScrollEl();
    const old = document.getElementById('vault-pdf-pages');
    if (old) old.remove();

    const pagesEl = document.createElement('div');
    pagesEl.id        = 'vault-pdf-pages';
    pagesEl.className = 'flex items-center justify-center w-full h-full';
    pagesEl.style.minHeight = '100%';
    scrollEl.appendChild(pagesEl);

    pdfDoc.getPage(pdfPageNum).then(page => {
        const vp0    = page.getViewport({ scale: 1 });
        const availW = Math.max(1, (scrollEl.clientWidth  || 800) - 48);
        const availH = Math.max(1, (scrollEl.clientHeight || 600) - 48);
        pdfScale     = Math.min(availW / vp0.width, availH / vp0.height, 3.0);

        const vp     = page.getViewport({ scale: pdfScale });
        const canvas = document.createElement('canvas');
        canvas.id            = `vault-pdf-page-${pdfPageNum}`;
        canvas.className     = 'block shadow-2xl rounded-sm';
        canvas.dataset.pageNum = pdfPageNum;
        paintPageCanvas(page, vp, canvas);

        const wrap = document.createElement('div');
        wrap.className       = 'relative shrink-0';
        wrap.dataset.pageNum = pdfPageNum;
        wrap.style.width  = vp.width  + 'px';
        wrap.style.height = vp.height + 'px';
        wrap.appendChild(canvas);
        attachTextLayer(page, vp, wrap);
        pagesEl.appendChild(wrap);
        updateVaultPDFControls();
        updateNotesForCurrentPage();
    });
}

// ── Book-spread view ─────────────────────────────────────────────────
// Page 1 = solo cover (right side), then spreads: (2,3), (4,5), …
// pdfPageNum always points to the first (left) page of the current spread,
// or 1 for the cover.
function buildPDFBookView() {
    if (!pdfDoc) return;
    if (pdfObserver)       { pdfObserver.disconnect();       pdfObserver = null; }
    if (pdfRenderObserver) { pdfRenderObserver.disconnect(); pdfRenderObserver = null; }
    _pdfRenderInFlight.clear();

    const scrollEl = getPDFScrollEl();
    const old = document.getElementById('vault-pdf-pages');
    if (old) old.remove();

    const pagesEl = document.createElement('div');
    pagesEl.id        = 'vault-pdf-pages';
    pagesEl.className = 'flex items-center justify-center w-full h-full';
    pagesEl.style.minHeight = '100%';
    scrollEl.appendChild(pagesEl);

    const isCover = pdfPageNum === 1;
    const leftNum  = isCover ? null : pdfPageNum;
    const rightNum = isCover ? 1    : (pdfPageNum + 1 <= pdfTotalPages ? pdfPageNum + 1 : null);
    const refNum   = leftNum || rightNum;
    if (!refNum) return;

    pdfDoc.getPage(refNum).then(page => {
        const vp0    = page.getViewport({ scale: 1 });
        const availW = Math.max(1, (scrollEl.clientWidth  || 800) - 80);
        const availH = Math.max(1, (scrollEl.clientHeight || 600) - 48);
        pdfScale     = Math.min(availW / (vp0.width * 2 + 8), availH / vp0.height, 3.0);

        const vp   = page.getViewport({ scale: pdfScale });
        const pw   = vp.width;
        const ph   = vp.height;

        const makeCanvas = (num, side, wrapEl) => {
            const c = document.createElement('canvas');
            c.id             = `vault-pdf-page-${num}`;
            c.dataset.pageNum = num;
            c.className      = `block ${side === 'left' ? 'rounded-l-sm' : 'rounded-r-sm'}`;
            c.style.width  = pw + 'px';   // placeholder size until painted
            c.style.height = ph + 'px';
            pdfDoc.getPage(num).then(pg => {
                const pvp = pg.getViewport({ scale: pdfScale });
                paintPageCanvas(pg, pvp, c);
                attachTextLayer(pg, pvp, wrapEl);
            });
            return c;
        };

        const blankPage = (side) => {
            const d = document.createElement('div');
            d.style.width   = pw + 'px';
            d.style.height  = ph + 'px';
            d.className     = `shrink-0 ${side === 'left' ? 'rounded-l-sm' : 'rounded-r-sm'} bg-slate-900/50`;
            return d;
        };

        const spine = document.createElement('div');
        spine.style.cssText = `width:8px;align-self:stretch;flex-shrink:0;background:linear-gradient(to right,rgba(0,0,0,0.35),rgba(100,116,139,0.15),rgba(0,0,0,0.35))`;

        // Left side
        const leftWrap = document.createElement('div');
        leftWrap.className = 'relative shrink-0 shadow-[-6px_0_20px_rgba(0,0,0,0.5)]';
        leftWrap.appendChild(leftNum ? makeCanvas(leftNum, 'left', leftWrap) : blankPage('left'));

        // Right side
        const rightWrap = document.createElement('div');
        rightWrap.className = 'relative shrink-0 shadow-[6px_0_20px_rgba(0,0,0,0.5)]';
        rightWrap.appendChild(rightNum ? makeCanvas(rightNum, 'right', rightWrap) : blankPage('right'));

        pagesEl.appendChild(leftWrap);
        pagesEl.appendChild(spine);
        pagesEl.appendChild(rightWrap);

        updateVaultPDFControls();
        updateNotesForCurrentPage();
    });
}

// ── Switch view mode ─────────────────────────────────────────────────
function setPDFViewMode(mode) {
    pdfViewMode = mode;
    ['scroll','single','book'].forEach(m => {
        document.getElementById(`vault-pdf-mode-${m}`)?.classList.toggle('active', m === mode);
    });
    if (!pdfDoc) return;
    if (mode === 'scroll')      buildPDFScrollView();
    else if (mode === 'single') buildPDFSingleView();
    else if (mode === 'book')   buildPDFBookView();
}

// Set zoom. If anchorX/Y are provided (in scroll-wrap-local coords), keep the
// pixel under those coords stationary during zoom (Preview-style cursor anchor).
function applyImgZoom(anchorX, anchorY) {
    const el = document.getElementById('vault-img-el');
    if (el) {
        if (el.tagName === 'IMG' && el.dataset.baseW) {
            const wrap = document.getElementById('vault-img-scroll-wrap');
            const oldW = parseFloat(el.style.width)  || parseFloat(el.dataset.baseW);
            const oldH = parseFloat(el.style.height) || parseFloat(el.dataset.baseH);
            let beforeX = 0, beforeY = 0, hasAnchor = false;
            if (wrap && anchorX != null && anchorY != null) {
                beforeX = wrap.scrollLeft + anchorX;
                beforeY = wrap.scrollTop  + anchorY;
                hasAnchor = true;
            }
            const newW = parseFloat(el.dataset.baseW) * imgZoom;
            const newH = parseFloat(el.dataset.baseH) * imgZoom;
            el.style.width  = newW + 'px';
            el.style.height = newH + 'px';
            if (hasAnchor && oldW > 0 && oldH > 0) {
                wrap.scrollLeft = beforeX * (newW / oldW) - anchorX;
                wrap.scrollTop  = beforeY * (newH / oldH) - anchorY;
            }
        } else {
            el.style.zoom = imgZoom;
        }
    }
    const label = document.getElementById('vault-img-zoom-label');
    if (label) label.textContent = Math.round(imgZoom * 100) + '%';
}

// Compute initial fit-to-window size and store as the zoom=1 baseline.
function _vaultFitImageToWrap() {
    const img  = document.getElementById('vault-img-el');
    const wrap = document.getElementById('vault-img-scroll-wrap');
    if (!img || !wrap || img.tagName !== 'IMG') return;
    const availW = Math.max(1, wrap.clientWidth  - 48);
    const availH = Math.max(1, wrap.clientHeight - 48);
    const natW = img.naturalWidth  || 1;
    const natH = img.naturalHeight || 1;
    const fit  = Math.min(availW / natW, availH / natH, 1);
    const baseW = Math.max(1, natW * fit);
    const baseH = Math.max(1, natH * fit);
    img.dataset.baseW = baseW;
    img.dataset.baseH = baseH;
    img.style.width  = (baseW * imgZoom) + 'px';
    img.style.height = (baseH * imgZoom) + 'px';
}

function fitVaultPDFToWidth() {
    if (!pdfDoc) return;
    pdfDoc.getPage(1).then(page => {
        const scrollEl  = getPDFScrollEl();
        const vp0       = page.getViewport({ scale: 1 });
        const available = (scrollEl ? scrollEl.clientWidth : 800) - 48;
        pdfScale        = Math.max(0.3, available / vp0.width);
        if (pdfViewMode === 'single') buildPDFSingleView();
        else if (pdfViewMode === 'book') buildPDFBookView();
        else buildPDFScrollView(true);  // keep the scale we just computed
    });
}

function updateVaultPDFControls() {
    document.getElementById('vault-pdf-page-info').textContent  = `${pdfPageNum} / ${pdfTotalPages}`;
    document.getElementById('vault-pdf-zoom-label').textContent = Math.round(pdfScale * 100) + '%';
    if (pdfViewMode === 'book') {
        document.getElementById('vault-pdf-prev').disabled = pdfPageNum <= 1;
        const nextStart = pdfPageNum === 1 ? 2 : pdfPageNum + 2;
        document.getElementById('vault-pdf-next').disabled = nextStart > pdfTotalPages;
    } else {
        document.getElementById('vault-pdf-prev').disabled = pdfPageNum <= 1;
        document.getElementById('vault-pdf-next').disabled = pdfPageNum >= pdfTotalPages;
    }
    const gotoEl = document.getElementById('vault-pdf-goto');
    if (gotoEl) { gotoEl.max = pdfTotalPages; gotoEl.value = ''; }
    const fsInfo = document.getElementById('vault-pdf-fs-page-info');
    if (fsInfo) {
        fsInfo.textContent = `${pdfPageNum} / ${pdfTotalPages}`;
        document.getElementById('vault-pdf-fs-zoom-label').textContent = Math.round(pdfScale * 100) + '%';
        document.getElementById('vault-pdf-fs-prev').disabled = pdfPageNum <= 1;
        document.getElementById('vault-pdf-fs-next').disabled = pdfPageNum >= pdfTotalPages;
    }
}

// Print the currently-open PDF via the system print dialog
function vaultPrintPDF() {
    const file = vaultData.files.find(f => f.id === vaultOpenFileId);
    if (!file) return;
    const storedPath = path.join(VAULT_DIR, file.storedName);
    const btn = document.getElementById('vault-pdf-print');
    if (btn) btn.innerHTML = '<i class="fas fa-circle-notch fa-spin text-xs"></i>';
    ipcRenderer.invoke('print-file', { filePath: storedPath }).catch(()=>{}).finally(() => {
        if (btn) btn.innerHTML = '<i class="fas fa-print text-xs"></i>';
    });
}

function loadVaultPDF(filePath) {
    const singleCanvas = document.getElementById('vault-pdf-canvas');
    const altEl        = document.getElementById('vault-content-alt');
    const ctrlBar      = document.getElementById('vault-pdf-controls');

    singleCanvas.style.display = 'none';  // we use per-page canvases instead
    altEl.style.display        = 'none';
    ctrlBar.style.display      = '';

    // Clear previous pages
    const old = document.getElementById('vault-pdf-pages');
    if (old) old.remove();

    // Destroy the previously-open PDF document so its worker/memory is freed.
    // Without this, opening many PDFs leaks resources and eventually fails to open.
    if (pdfDoc) { try { pdfDoc.destroy(); } catch(_) {} }
    pdfDoc = null; pdfPageNum = 1; pdfTotalPages = 0;
    pdfScale = 1.0; pdfRendering = false; pdfRenderQueue = [];
    if (pdfObserver)       { pdfObserver.disconnect();       pdfObserver = null; }
    if (typeof pdfRenderObserver !== 'undefined' && pdfRenderObserver) { pdfRenderObserver.disconnect(); pdfRenderObserver = null; }
    if (typeof _pdfRenderInFlight !== 'undefined') _pdfRenderInFlight.clear();
    pdfViewMode = 'scroll';
    ['scroll','single','book'].forEach(m => {
        document.getElementById(`vault-pdf-mode-${m}`)?.classList.toggle('active', m === 'scroll');
    });

    let pdfUrl;
    try { pdfUrl = pathToFileURL(filePath).href; }
    catch (_) { pdfUrl = `file://${filePath}`; }

    if (typeof pdfjsLib === 'undefined') {
        altEl.style.display = '';
        altEl.innerHTML = `<div class="flex items-center justify-center h-full"><p class="text-red-400 text-sm p-6">PDF engine not loaded.</p></div>`;
        return;
    }
    pdfjsLib.getDocument(pdfUrl).promise.then(doc => {
        pdfDoc        = doc;
        pdfTotalPages = doc.numPages;
        buildPDFScrollView();
    }).catch(err => {
        console.error('[vault] PDF load failed:', filePath, err);
        altEl.style.display = '';
        altEl.innerHTML = `<div class="flex items-center justify-center h-full"><p class="text-red-400 text-sm p-6">Could not load PDF: ${err.message}</p></div>`;
    });
}

// ── Notes helpers ──
function updateNotesForCurrentPage() {
    const file = vaultData.files.find(f => f.id === vaultOpenFileId);
    if (!file) return;

    const label  = document.getElementById('vault-notes-page-label');
    const dot    = document.getElementById('vault-note-dot');
    const input  = document.getElementById('vault-notes-input');

    if (vaultIsPDF) {
        if (label) label.textContent = `Page ${pdfPageNum}`;
        const note = (file.pageNotes || {})[String(pdfPageNum)] || '';
        if (input) input.value = note;
        if (dot) dot.style.display = note ? '' : 'none';
    } else {
        if (label) label.textContent = 'Notes';
        if (input) input.value = file.notes || '';
        if (dot) dot.style.display = (file.notes || '') ? '' : 'none';
    }
}

function saveNoteForCurrentPage(text) {
    const file = vaultData.files.find(f => f.id === vaultOpenFileId);
    if (!file) return;
    if (vaultIsPDF) {
        if (!file.pageNotes) file.pageNotes = {};
        if (text) file.pageNotes[String(pdfPageNum)] = text;
        else delete file.pageNotes[String(pdfPageNum)];
    } else {
        file.notes = text;
    }
    saveVaultData();
    const dot = document.getElementById('vault-note-dot');
    if (dot) dot.style.display = text ? '' : 'none';
    renderVaultFolders(); // refresh note indicators in sidebar
}

function renderAllNotes() {
    const file    = vaultData.files.find(f => f.id === vaultOpenFileId);
    const listEl  = document.getElementById('vault-notes-all-list');
    if (!listEl || !file) return;

    if (vaultIsPDF) {
        const pn = file.pageNotes || {};
        const pages = Object.keys(pn).map(Number).sort((a,b) => a - b);
        if (!pages.length) {
            listEl.innerHTML = '<p class="text-slate-600 text-xs text-center py-8 italic">No notes yet. Switch to Page view and start writing.</p>';
            return;
        }
        listEl.innerHTML = pages.map(pg => {
            const escaped = (pn[pg] || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
            return `<div class="vault-note-card bg-slate-800/60 border border-slate-700/50 rounded-xl p-3 cursor-pointer hover:border-slate-600/70 transition-all" data-page="${pg}">
                <div class="flex items-center justify-between mb-1.5">
                    <span class="text-[10px] font-semibold uppercase tracking-wide" style="color:var(--accent-light)">Page ${pg}</span>
                    <button class="vault-note-del text-slate-600 hover:text-red-400 transition-colors text-[10px]" data-page="${pg}"><i class="fas fa-times"></i></button>
                </div>
                <p class="text-slate-300 text-xs leading-relaxed whitespace-pre-wrap">${escaped}</p>
            </div>`;
        }).join('');

        listEl.querySelectorAll('.vault-note-card').forEach(card => {
            card.onclick = e => {
                if (e.target.closest('.vault-note-del')) return;
                const pg = parseInt(card.dataset.page);
                setNotesTab('page');
                gotoPDFPage(pg);
            };
        });
        listEl.querySelectorAll('.vault-note-del').forEach(btn => {
            btn.onclick = e => {
                e.stopPropagation();
                const pg = String(btn.dataset.page);
                delete file.pageNotes[pg];
                saveVaultData();
                renderAllNotes();
            };
        });
    } else {
        const note = file.notes || '';
        listEl.innerHTML = note
            ? `<div class="bg-slate-800/60 border border-slate-700/50 rounded-xl p-3">
                   <p class="text-slate-300 text-xs leading-relaxed whitespace-pre-wrap">${note.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</p>
               </div>`
            : '<p class="text-slate-600 text-xs text-center py-8 italic">No notes yet.</p>';
    }
}

function setNotesTab(mode) {
    vaultNotesMode = mode;
    const pageBtnEl = document.getElementById('vault-notes-tab-page');
    const allBtnEl  = document.getElementById('vault-notes-tab-all');
    const pageView  = document.getElementById('vault-notes-view-page');
    const allView   = document.getElementById('vault-notes-view-all');

    pageBtnEl.classList.toggle('active', mode === 'page');
    allBtnEl.classList.toggle('active',  mode === 'all');
    pageView.style.display = mode === 'page' ? '' : 'none';
    allView.style.display  = mode === 'all'  ? '' : 'none';

    if (mode === 'page') updateNotesForCurrentPage();
    else                 renderAllNotes();
}

// Convert an .srt file to a WebVTT blob URL for <video><track>
function vaultSrtToVttUrl(srtPath) {
    try {
        let s = fs.readFileSync(srtPath, 'utf8').replace(/\r/g, '');
        s = s.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2'); // SRT comma → VTT dot
        const blob = new Blob(['WEBVTT\n\n' + s], { type: 'text/vtt' });
        return URL.createObjectURL(blob);
    } catch (_) { return null; }
}

// ── Open / close ──
// Hide all editor/tool areas — purely DOM, no save/close side effects.
// Save functions are called by closeVaultViewer() when user explicitly closes a file.
function _vaultResetViewerAreas() {
    // Save pending doc content before switching away from it
    if (vaultIsDoc) {
        clearTimeout(vaultDocSaveTimer);
        try { saveCurrentVaultDoc(); } catch(e) { console.error('[reset] doc save:', e); }
        vaultIsDoc = false;
    }
    // Save pending markdown content before switching away
    if (vaultIsMd && vaultMdEditMode) {
        clearTimeout(vaultMdSaveTimer);
        try { _saveVaultMdContent(); } catch(e) { console.error('[reset] md save:', e); }
    }
    vaultIsMd       = false;
    vaultMdEditMode = false;
    const _mdToolbar = document.getElementById('vault-md-toolbar');
    if (_mdToolbar) _mdToolbar.classList.add('hidden');

    // Reset all science / editor flags
    vaultIsMolecule      = false;
    vaultIsPeriodic      = false;
    vaultIsDna           = false;
    vaultIsAnatomy       = false;
    vaultIsChessStrategy = false;
    vaultIsPhysics       = false;
    vaultIsGraph         = false;
    vaultIsCode          = false;
    vaultIsNotebook      = false;

    // Hide every editor/tool area
    ['vault-doc-editor-area','vault-doc-toolbar-row','vault-doc-footer',
     'vault-code-area','vault-code-toolbar-row',
     'vault-notebook-area','vault-notebook-toolbar-row',
     'vault-molecule-area','vault-periodic-area','vault-dna-area',
     'vault-anatomy-area','vault-chessstrategy-area','vault-physics-area',
     'vault-graph-area'].forEach(elId => {
        const el = document.getElementById(elId);
        if (el) el.style.display = 'none';
    });
    // Restore the standard PDF/image/text viewer
    const nv = document.getElementById('vault-normal-view');
    if (nv) nv.style.display = '';
    // Restore the static title span, hide the editable title input
    document.getElementById('vault-viewer-title')?.classList.remove('hidden');
    document.getElementById('vault-doc-title-input')?.classList.add('hidden');
}

function openVaultFile(id) {
    try {
    console.log('[openVaultFile] id:', id);
    const file = vaultData.files.find(f => f.id === id);
    if (!file) { console.error('[openVaultFile] file not found:', id); return; }
    console.log('[openVaultFile] file:', file.originalName, 'isMolecule:', file.isMolecule, 'isPeriodic:', file.isPeriodic);
    if (file.isProject) { openVaultProjectWorkspace(file); return; }

    // Website links: open the site as a tab in the built-in browser.
    if (file.isWebLink) {
        if (file.url && window.appOpenBrowserTab) window.appOpenBrowserTab(file.url, { background: false });
        return;
    }

    // HTML files (e.g. course/study pages) open as a real web page in the
    // built-in browser — its own top-level tab — instead of the vault viewer
    // (which would land them in the code editor and show only the source).
    if (!file.isDoc && !file.isNotebook && ['html','htm'].includes(vaultExt(file.originalName))) {
        const p = path.join(VAULT_DIR, file.storedName);
        const u = 'file://' + encodeURI(p.replace(/\\/g, '/')).replace(/#/g, '%23').replace(/"/g, '%22');
        if (window.appOpenBrowserTab) { window.appOpenBrowserTab(u, { background: false }); return; }
    }

    // Migrate old files that have no pageNotes
    if (!file.pageNotes) file.pageNotes = {};

    // Clean up any previously-open editor/science area BEFORE changing vaultOpenFileId,
    // so saves go to the OLD file, not the new one.
    _vaultResetViewerAreas();

    vaultOpenFileId = id;
    renderVaultFolders(); // update active highlight in sidebar

    // Start with both side panels collapsed — reopen them from the tabs when needed
    if (typeof window._vaultSetNotesVisible === 'function') window._vaultSetNotesVisible(false, null);
    if (typeof window._vaultSetDocsVisible  === 'function') window._vaultSetDocsVisible(false, null);

    document.getElementById('vault-grid-view').style.display   = 'none';
    document.getElementById('vault-viewer-view').style.display = 'flex';

    const { icon, color } = vaultIcon(file.originalName, file.isDoc, file.isCode, file.isNotebook, file);
    const iconEl = document.getElementById('vault-viewer-icon');
    iconEl.className   = `fas ${icon} text-sm shrink-0`;
    iconEl.style.color = color;
    document.getElementById('vault-viewer-title').textContent = file.originalName;

    renderVaultFolderSelect();

    const storedPath = path.join(VAULT_DIR, file.storedName);
    const fileUrl    = `file://${storedPath}`;
    const ext        = vaultExt(file.originalName);
    const canvas     = document.getElementById('vault-pdf-canvas');
    const altEl      = document.getElementById('vault-content-alt');
    const ctrlBar    = document.getElementById('vault-pdf-controls');
    const notesTabs  = document.getElementById('vault-notes-tabs');
    const imgCtrlBar = document.getElementById('vault-img-controls');

    // Hide image-zoom bar by default; branches below re-enable it for image/text/markdown
    if (imgCtrlBar) imgCtrlBar.style.display = 'none';
    imgZoom = 1.0;
    const _zlbl = document.getElementById('vault-img-zoom-label');
    if (_zlbl) _zlbl.textContent = '100%';

    // Reset notes mode
    vaultNotesMode = 'page';
    setNotesTab('page');

    if (file.isMolecule || file.isPeriodic || file.isDna || file.isAnatomy || file.isChessStrategy || file.isPhysics || file.isGraph) {
        vaultIsPDF = false; vaultIsPPTX = false; pdfDoc = null;
        canvas.style.display  = 'none';
        ctrlBar.style.display = 'none';
        altEl.style.display   = 'none';
        notesTabs.style.display = 'none';
        if (file.isMolecule)       { vaultIsMolecule = true;      openVaultMoleculeEditor(file); }
        else if (file.isPeriodic)  { vaultIsPeriodic = true;      openVaultPeriodicEditor(file); }
        else if (file.isDna)       { vaultIsDna = true;           openVaultDNAEditor(file); }
        else if (file.isAnatomy)   { vaultIsAnatomy = true;       openVaultAnatomyEditor(file); }
        else if (file.isChessStrategy) { vaultIsChessStrategy = true; openVaultChessStrategyEditor(file); }
        else if (file.isPhysics)   { vaultIsPhysics = true;       openVaultPhysicsEditor(file); }
        else if (file.isGraph)     { vaultIsGraph = true;         openVaultGraphEditor(file); }
    } else if (file.isDoc) {
        vaultIsDoc = true;
        vaultIsPDF = false;
        vaultIsPPTX = false;
        pdfDoc = null;
        canvas.style.display  = 'none';
        ctrlBar.style.display = 'none';
        altEl.style.display   = 'none';
        notesTabs.style.display = 'none';
        openVaultDocEditor(file, storedPath);
    } else if (file.isNotebook || vaultExt(file.originalName) === 'vnb') {
        vaultIsNotebook = true;
        vaultIsDoc  = false;
        vaultIsCode = false;
        vaultIsPDF  = false;
        pdfDoc = null;
        canvas.style.display  = 'none';
        ctrlBar.style.display = 'none';
        altEl.style.display   = 'none';
        notesTabs.style.display = 'none';
        openNotebookEditor(file, storedPath);
    } else if (['md','markdown'].includes(ext)) {
        // Markdown — render with Obsidian-style viewer (must come before isCodeFile check
        // because md/markdown are also registered as code file extensions)
        vaultIsPDF  = false;
        vaultIsCode = false;
        vaultIsDoc  = false;
        vaultIsNotebook = false;
        vaultIsMd   = true;
        vaultMdEditMode = false;
        pdfDoc = null;
        canvas.style.display  = 'none';
        ctrlBar.style.display = 'none';
        altEl.style.display   = '';
        notesTabs.style.display = 'none';
        if (imgCtrlBar) imgCtrlBar.style.display = '';
        const _mdToolbar = document.getElementById('vault-md-toolbar');
        if (_mdToolbar) _mdToolbar.classList.remove('hidden');
        document.getElementById('vault-md-read-btn')?.classList.add('active');
        document.getElementById('vault-md-write-btn')?.classList.remove('active');
        try {
            const text = fs.readFileSync(storedPath, 'utf8');
            altEl.innerHTML =
                `<div id="vault-img-el" class="w-full h-full overflow-y-auto chat-scroll" style="background:#13141f">
                    ${renderVaultMarkdown(text)}
                    ${(typeof vaultGraphBacklinksHTML === 'function') ? vaultGraphBacklinksHTML(file.id) : ''}
                </div>`;
            vaultRenderMath(altEl);
        } catch(e) {
            altEl.innerHTML = `<p class="text-red-400 p-6 text-sm">Could not read file: ${e.message}</p>`;
        }
        updateNotesForCurrentPage();
    } else if (file.isCode || (typeof isCodeFile === 'function' && isCodeFile(file.originalName))) {
        vaultIsCode = true;
        vaultIsDoc  = false;
        vaultIsPDF  = false;
        vaultIsNotebook = false;
        pdfDoc = null;
        canvas.style.display  = 'none';
        ctrlBar.style.display = 'none';
        altEl.style.display   = 'none';
        notesTabs.style.display = 'none';
        openVaultCodeEditor(file, storedPath);
    } else if (ext === 'pdf') {
        vaultIsPDF = true;
        notesTabs.style.display = '';
        try { if (window.pdfAnnot) window.pdfAnnot.reset(); } catch (_) {}
        loadVaultPDF(storedPath);
    } else if (['pptx','ppt'].includes(ext)) {
        vaultIsPPTX     = true;
        vaultIsPDF      = false;
        vaultIsDoc      = false;
        vaultIsCode     = false;
        vaultIsNotebook = false;
        pdfDoc = null;
        canvas.style.display  = 'none';
        ctrlBar.style.display = 'none';
        notesTabs.style.display = 'none';
        altEl.style.display   = '';
        openVaultPPTX(storedPath, altEl);
    } else {
        vaultIsPDF = false;
        pdfDoc = null;
        canvas.style.display  = 'none';
        ctrlBar.style.display = 'none';
        altEl.style.display   = '';
        notesTabs.style.display = 'none'; // hide Page/All for non-PDFs

        const isZoomable = ['png','jpg','jpeg','gif','webp','svg','txt','md','markdown'].includes(ext);
        if (imgCtrlBar) imgCtrlBar.style.display = isZoomable ? '' : 'none';

        if (['png','jpg','jpeg','gif','webp','svg'].includes(ext)) {
            altEl.innerHTML =
                `<div id="vault-img-scroll-wrap" class="w-full h-full" style="overflow:auto">
                    <div style="min-width:100%; min-height:100%; display:flex; justify-content:center; align-items:center; padding:24px; box-sizing:border-box">
                        <img id="vault-img-el" src="${fileUrl}" class="rounded-xl shadow-2xl" style="display:block; max-width:none; max-height:none">
                    </div>
                </div>`;
            const _img = document.getElementById('vault-img-el');
            if (_img) {
                _img.addEventListener('load', _vaultFitImageToWrap);
                if (_img.complete && _img.naturalWidth) _vaultFitImageToWrap();
            }
        } else if (['txt','md','markdown'].includes(ext)) {
            try {
                const text = fs.readFileSync(storedPath, 'utf8');
                if (['md','markdown'].includes(ext)) {
                    altEl.innerHTML =
                        `<div id="vault-img-el" class="w-full h-full overflow-y-auto chat-scroll" style="background:#13141f">
                            ${renderVaultMarkdown(text)}
                        </div>`;
                    vaultRenderMath(altEl);
                } else {
                    // plain .txt — keep monospace pre
                    const escaped = text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
                    altEl.innerHTML =
                        `<div id="vault-img-el" class="w-full h-full overflow-y-auto chat-scroll p-6">
                            <pre class="text-slate-300 text-sm leading-relaxed font-mono whitespace-pre-wrap">${escaped}</pre>
                        </div>`;
                }
            } catch(e) {
                altEl.innerHTML = `<p class="text-red-400 p-6 text-sm">Could not read file: ${e.message}</p>`;
            }
        } else if (['mp4','webm','mov','m4v','ogv','mkv'].includes(ext)) {
            // ── In-app video player (+ subtitles if a matching .srt exists) ──
            let trackHtml = '';
            try {
                const base = file.originalName.replace(/\.[^.]+$/, '');
                const srt = vaultData.files.find(f => f.originalName === base + '.srt');
                if (srt) {
                    const vttUrl = vaultSrtToVttUrl(path.join(VAULT_DIR, srt.storedName));
                    if (vttUrl) trackHtml = `<track default kind="subtitles" srclang="en" label="Subtitles" src="${vttUrl}">`;
                }
            } catch(_) {}
            altEl.innerHTML =
                `<div class="w-full h-full flex flex-col items-center justify-center p-4 gap-3" style="background:#0a0b12">
                    <video id="vault-video-el" src="${fileUrl}" controls playsinline
                        class="max-w-full rounded-xl shadow-2xl bg-black" style="max-height:calc(100% - 52px)">${trackHtml}</video>
                    <button onclick="openVideoEditor('${file.id}')"
                        class="px-4 py-2 rounded-xl text-white text-xs font-semibold transition-colors shrink-0" style="background:#dc2626">
                        <i class="fas fa-scissors mr-1.5"></i> Edit video
                    </button>
                </div>`;
        } else {
            const safePath = storedPath.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
            altEl.innerHTML =
                `<div class="flex flex-col items-center justify-center h-full gap-4 text-center p-8">
                    <i class="fas ${icon} text-6xl" style="color:${color}"></i>
                    <p class="text-slate-300 text-sm font-medium">${file.originalName}</p>
                    <p class="text-slate-500 text-xs">Preview not available for this file type</p>
                    <button onclick="vaultOpenExternal('${safePath}')"
                        class="mt-2 px-5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm rounded-xl border border-slate-700 transition-colors">
                        Open externally
                    </button>
                </div>`;
        }
        updateNotesForCurrentPage();
    }
    // Reset / refresh the AI panel for the file that just opened
    if (typeof vaultAIOnFileOpen === 'function') vaultAIOnFileOpen();
    } catch(e) {
        console.error('[openVaultFile] crash:', e);
        alert('Failed to open file: ' + e.message + '\n\nCheck DevTools console for details.');
    }
}

// ── PPTX Viewer ───────────────────────────────────────────────
function openVaultPPTX(storedPath, altEl) {
    pptxSlides = [];
    pptxCurrentSlide = 0;

    // Clean up old tmp dir
    if (pptxTmpDir) { try { fs.rmSync(pptxTmpDir, { recursive: true }); } catch(e) {} }
    pptxTmpDir = path.join(require('os').tmpdir(), 'vulsor_pptx_' + Date.now());
    fs.mkdirSync(pptxTmpDir, { recursive: true });

    altEl.innerHTML = `<div class="flex flex-col items-center justify-center h-full gap-3 text-slate-500">
        <i class="fas fa-circle-notch fa-spin text-2xl" style="color:var(--accent-light)"></i>
        <p class="text-xs">Parsing presentation…</p>
    </div>`;

    // Python script to extract slide data from PPTX (ZIP + XML — no extra packages needed)
    const pyScript = `
import sys, json, zipfile, re, os, base64
import xml.etree.ElementTree as ET

NS_A  = 'http://schemas.openxmlformats.org/drawingml/2006/main'
NS_P  = 'http://schemas.openxmlformats.org/presentationml/2006/main'
NS_R  = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
NS_PR = 'http://schemas.openxmlformats.org/package/2006/relationships'

def get_runs(txBody):
    paras = []
    for para in txBody.findall(f'{{{NS_A}}}p'):
        runs = []
        for r in para.findall(f'{{{NS_A}}}r'):
            t = r.find(f'{{{NS_A}}}t')
            rPr = r.find(f'{{{NS_A}}}rPr')
            sz = None; bold = False; color = None
            if rPr is not None:
                raw = rPr.get('sz')
                if raw: sz = int(raw) // 100
                bold = rPr.get('b') in ('1','true')
                solidFill = rPr.find(f'{{{NS_A}}}solidFill')
                if solidFill is not None:
                    srgb = solidFill.find(f'{{{NS_A}}}srgbClr')
                    if srgb is not None: color = '#' + srgb.get('val','ffffff')
            if t is not None and t.text:
                runs.append({'text': t.text, 'sz': sz, 'bold': bold, 'color': color})
        pPr = para.find(f'{{{NS_A}}}pPr')
        algn = pPr.get('algn','l') if pPr is not None else 'l'
        if runs:
            paras.append({'runs': runs, 'align': algn})
    return paras

def parse_slide(xml_str, rels_str, media_dir, z):
    root = ET.fromstring(xml_str)
    shapes = []

    # Parse relationships to map rId -> media path
    rId_map = {}
    if rels_str:
        try:
            rroot = ET.fromstring(rels_str)
            for rel in rroot:
                rid = rel.get('Id','')
                target = rel.get('Target','')
                rId_map[rid] = target
        except: pass

    for sp in root.iter(f'{{{NS_P}}}sp'):
        txBody = sp.find(f'.//{{{NS_A}}}txBody') or sp.find(f'.//{{{NS_P}}}txBody')
        if txBody is None: continue
        xfrm = sp.find(f'.//{{{NS_A}}}xfrm')
        shape = {'type':'text','x':0,'y':0,'w':0,'h':0,'paras':[],'bg':None}
        if xfrm is not None:
            off = xfrm.find(f'{{{NS_A}}}off')
            ext = xfrm.find(f'{{{NS_A}}}ext')
            if off is not None: shape['x']=int(off.get('x',0)); shape['y']=int(off.get('y',0))
            if ext is not None: shape['w']=int(ext.get('cx',0)); shape['h']=int(ext.get('cy',0))
        spPr = sp.find(f'.//{{{NS_P}}}spPr') or sp.find(f'.//{{{NS_A}}}spPr')
        if spPr is not None:
            sf = spPr.find(f'.//{{{NS_A}}}solidFill/{{{NS_A}}}srgbClr')
            if sf is not None: shape['bg'] = '#' + sf.get('val','')
        shape['paras'] = get_runs(txBody)
        if shape['paras']: shapes.append(shape)

    for pic in root.iter(f'{{{NS_P}}}pic'):
        xfrm = pic.find(f'.//{{{NS_A}}}xfrm')
        blip = pic.find(f'.//{{{NS_A}}}blip')
        shape = {'type':'img','x':0,'y':0,'w':0,'h':0,'data':None}
        if xfrm is not None:
            off = xfrm.find(f'{{{NS_A}}}off')
            ext = xfrm.find(f'{{{NS_A}}}ext')
            if off is not None: shape['x']=int(off.get('x',0)); shape['y']=int(off.get('y',0))
            if ext is not None: shape['w']=int(ext.get('cx',0)); shape['h']=int(ext.get('cy',0))
        if blip is not None:
            rId = blip.get(f'{{{NS_R}}}embed','')
            target = rId_map.get(rId,'')
            # target is like '../media/image1.png'
            media_zip_path = 'ppt/' + target.lstrip('.').lstrip('/').lstrip('/')
            media_zip_path = media_zip_path.replace('//','/')
            try:
                img_bytes = z.read(media_zip_path)
                ext_type = media_zip_path.split('.')[-1].lower()
                mime = {'png':'image/png','jpg':'image/jpeg','jpeg':'image/jpeg','gif':'image/gif','svg':'image/svg+xml'}.get(ext_type,'image/png')
                shape['data'] = f'data:{mime};base64,' + base64.b64encode(img_bytes).decode()
            except: pass
        if shape['w'] > 0: shapes.append(shape)

    # Background color
    bg_color = None
    bg_el = root.find(f'.//{{{NS_P}}}bg')
    if bg_el is not None:
        sf = bg_el.find(f'.//{{{NS_A}}}solidFill/{{{NS_A}}}srgbClr')
        if sf is not None: bg_color = '#' + sf.get('val','')

    return {'shapes': shapes, 'bg': bg_color}

pptx_path = sys.argv[1]
try:
    with zipfile.ZipFile(pptx_path) as z:
        names = sorted(
            [n for n in z.namelist() if re.match(r'ppt/slides/slide\\d+\\.xml$', n)],
            key=lambda n: int(re.search(r'\\d+', n.split('/')[-1]).group())
        )
        slides = []
        for name in names:
            try:
                xml_str = z.read(name).decode('utf-8', errors='replace')
                rels_name = name.replace('slides/slide', 'slides/_rels/slide').replace('.xml', '.xml.rels')
                rels_str = None
                if rels_name in z.namelist():
                    rels_str = z.read(rels_name).decode('utf-8', errors='replace')
                slides.append(parse_slide(xml_str, rels_str, None, z))
            except Exception as e2:
                slides.append({'shapes': [], 'bg': None, 'error': str(e2)})
    print(json.dumps({'ok': True, 'slides': slides, 'count': len(slides)}))
except Exception as e:
    print(json.dumps({'ok': False, 'error': str(e)}))
`.trim();

    // Write script to tmp, run it
    const scriptPath = path.join(pptxTmpDir, 'parse.py');
    fs.writeFileSync(scriptPath, pyScript);

    exec(`python3 "${scriptPath}" "${storedPath}"`, { maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
        try {
            const result = JSON.parse(stdout.trim());
            if (!result.ok) throw new Error(result.error);
            pptxSlides = result.slides;
            pptxCurrentSlide = 0;
            renderPPTXViewer(altEl, storedPath);
        } catch(e) {
            altEl.innerHTML = `
                <div class="flex flex-col items-center justify-center h-full gap-4 text-center p-8">
                    <i class="fas fa-file-powerpoint text-5xl" style="color:#f97316;opacity:.4"></i>
                    <p class="text-slate-400 text-sm font-medium">Could not parse presentation</p>
                    <p class="text-slate-600 text-xs">${escHtml((e.message||'').slice(0,200))}</p>
                    <button onclick="vaultOpenExternal('${storedPath.replace(/\\/g,'\\\\').replace(/'/g,"\\'")}') "
                        class="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded-xl border border-slate-700">
                        Open in Keynote / PowerPoint
                    </button>
                </div>`;
        }
    });
}

// ── EMU → px conversion (standard slide = 9144000 × 5143500 EMU) ──
const PPTX_W_EMU = 9144000;
const PPTX_H_EMU = 5143500;

function emuToPx(emu, axis) {
    const base = axis === 'x' ? PPTX_W_EMU : PPTX_H_EMU;
    const px   = axis === 'x' ? 760 : 427; // render size (16:9)
    return (emu / base) * px;
}

function renderPPTXViewer(altEl, storedPath) {
    const total = pptxSlides.length;
    if (!total) {
        altEl.innerHTML = `<div class="flex items-center justify-center h-full text-slate-500 text-sm">No slides found</div>`;
        return;
    }

    altEl.innerHTML = `
        <div style="display:flex;flex-direction:column;height:100%;background:#1a1a2e;overflow:hidden">

            <!-- Slide strip top nav -->
            <div id="pptx-strip" style="display:flex;gap:6px;padding:10px 12px;overflow-x:auto;background:#0f0f1a;border-bottom:1px solid rgba(255,255,255,.07);flex-shrink:0"></div>

            <!-- Main slide canvas -->
            <div style="flex:1;display:flex;align-items:center;justify-content:center;overflow:hidden;padding:20px">
                <div id="pptx-slide-wrap" style="position:relative;width:760px;height:427px;border-radius:8px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.6);flex-shrink:0"></div>
            </div>

            <!-- Bottom controls -->
            <div style="display:flex;align-items:center;justify-content:center;gap:12px;padding:10px 16px;background:#0f0f1a;border-top:1px solid rgba(255,255,255,.07);flex-shrink:0">
                <button onclick="pptxGo(-1)" style="background:rgba(255,255,255,.08);border:none;color:#94a3b8;border-radius:8px;width:32px;height:32px;cursor:pointer;font-size:13px;display:flex;align-items:center;justify-content:center">
                    <i class="fas fa-chevron-left"></i>
                </button>
                <span id="pptx-page-info" style="color:#64748b;font-size:11px;min-width:80px;text-align:center"></span>
                <button onclick="pptxGo(1)" style="background:rgba(255,255,255,.08);border:none;color:#94a3b8;border-radius:8px;width:32px;height:32px;cursor:pointer;font-size:13px;display:flex;align-items:center;justify-content:center">
                    <i class="fas fa-chevron-right"></i>
                </button>
                <div style="width:1px;height:16px;background:rgba(255,255,255,.1)"></div>
                <button onclick="vaultOpenExternal('${storedPath.replace(/\\/g,'\\\\').replace(/'/g,"\\'")}') "
                    style="background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08);color:#94a3b8;border-radius:8px;padding:0 12px;height:32px;cursor:pointer;font-size:10px;font-weight:600">
                    <i class="fas fa-external-link-alt" style="margin-right:5px;font-size:9px"></i>Open in Keynote
                </button>
            </div>
        </div>`;

    // Build thumbnail strip
    const strip = document.getElementById('pptx-strip');
    pptxSlides.forEach((_, i) => {
        const thumb = document.createElement('div');
        thumb.dataset.idx = i;
        thumb.style.cssText = `flex-shrink:0;cursor:pointer;border-radius:4px;overflow:hidden;border:2px solid ${i === 0 ? 'var(--accent-light)' : 'transparent'};transition:border-color .15s`;
        thumb.onclick = () => pptxGoTo(i);
        const mini = document.createElement('div');
        mini.style.cssText = 'width:80px;height:45px;position:relative;overflow:hidden;pointer-events:none';
        renderPPTXSlideInto(mini, i, 80, 45);
        thumb.appendChild(mini);
        strip.appendChild(thumb);
    });

    const startSlide = (vaultPendingPPTXSlide != null) ? vaultPendingPPTXSlide : 0;
    vaultPendingPPTXSlide = null;
    pptxGoTo(startSlide);
}

function pptxGoTo(idx) {
    if (!pptxSlides.length) return;
    pptxCurrentSlide = Math.max(0, Math.min(pptxSlides.length - 1, idx));

    // Update main slide
    const wrap = document.getElementById('pptx-slide-wrap');
    if (wrap) renderPPTXSlideInto(wrap, pptxCurrentSlide, 760, 427);

    // Update page info
    const info = document.getElementById('pptx-page-info');
    if (info) info.textContent = `Slide ${pptxCurrentSlide + 1} of ${pptxSlides.length}`;

    // Update strip highlights
    const strip = document.getElementById('pptx-strip');
    if (strip) {
        strip.querySelectorAll('[data-idx]').forEach(el => {
            const active = parseInt(el.dataset.idx) === pptxCurrentSlide;
            el.style.borderColor = active ? 'var(--accent-light)' : 'transparent';
        });
        // Scroll active thumb into view
        const activeThumb = strip.querySelector(`[data-idx="${pptxCurrentSlide}"]`);
        if (activeThumb) activeThumb.scrollIntoView({ inline: 'nearest', block: 'nearest' });
    }
}

function pptxGo(delta) { pptxGoTo(pptxCurrentSlide + delta); }

function renderPPTXSlideInto(container, slideIdx, renderW, renderH) {
    const slide = pptxSlides[slideIdx];
    if (!slide) return;

    const scaleX = renderW / PPTX_W_EMU;
    const scaleY = renderH / PPTX_H_EMU;

    container.innerHTML = '';
    container.style.cssText += `;width:${renderW}px;height:${renderH}px;position:relative;overflow:hidden;background:${slide.bg || '#ffffff'}`;

    slide.shapes.forEach(shape => {
        const el = document.createElement('div');
        el.style.cssText = `
            position:absolute;
            left:${Math.round(shape.x * scaleX)}px;
            top:${Math.round(shape.y * scaleY)}px;
            width:${Math.round(shape.w * scaleX)}px;
            height:${Math.round(shape.h * scaleY)}px;
            overflow:hidden;
            box-sizing:border-box;
        `;

        if (shape.type === 'img' && shape.data) {
            const img = document.createElement('img');
            img.src = shape.data;
            img.style.cssText = 'width:100%;height:100%;object-fit:contain;display:block';
            el.appendChild(img);

        } else if (shape.type === 'text' && shape.paras) {
            if (shape.bg) el.style.background = shape.bg;
            el.style.padding = '2px';
            el.style.display = 'flex';
            el.style.flexDirection = 'column';
            el.style.justifyContent = 'center';

            shape.paras.forEach(para => {
                const p = document.createElement('p');
                p.style.cssText = `margin:0;padding:0;text-align:${para.align === 'ctr' ? 'center' : para.align === 'r' ? 'right' : 'left'};line-height:1.2`;
                para.runs.forEach(run => {
                    const span = document.createElement('span');
                    const baseSz = run.sz || 18;
                    const scaledSz = Math.max(renderW === 760 ? 6 : 3, Math.round(baseSz * scaleY * 96));
                    span.style.cssText = `
                        font-size:${scaledSz}px;
                        font-weight:${run.bold ? '700' : '400'};
                        color:${run.color || (slide.bg && slide.bg.toLowerCase() === '#ffffff' ? '#1e293b' : '#f1f5f9')};
                        font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
                        white-space:pre-wrap;
                    `;
                    span.textContent = run.text;
                    p.appendChild(span);
                });
                el.appendChild(p);
            });
        }

        container.appendChild(el);
    });
}

function closeVaultViewer() {
    // Bring the file sidebar back — it belongs to the grid view too
    if (typeof window._vaultSetDocsVisible === 'function') window._vaultSetDocsVisible(true, 208);
    // The AI panel is a sibling of the whole vault area, so it has to be told
    // to collapse itself — it is not inside the viewer that is being hidden.
    if (typeof vaultAIOnViewerClose === 'function') vaultAIOnViewerClose();

    // Save / close science tool editors
    if (vaultIsMolecule)      { saveVaultDocTitle(); closeVaultMoleculeEditor();       vaultIsMolecule = false; }
    if (vaultIsPeriodic)      { saveVaultDocTitle(); closeVaultPeriodicEditor();       vaultIsPeriodic = false; }
    if (vaultIsDna)           { saveVaultDocTitle(); closeVaultDNAEditor();            vaultIsDna = false; }
    if (vaultIsAnatomy)       { saveVaultDocTitle(); closeVaultAnatomyEditor();        vaultIsAnatomy = false; }
    if (vaultIsChessStrategy) { saveVaultDocTitle(); closeVaultChessStrategyEditor();  vaultIsChessStrategy = false; }
    if (vaultIsPhysics)       { saveVaultDocTitle(); closeVaultPhysicsEditor();        vaultIsPhysics = false; }
    if (vaultIsGraph)         { saveVaultDocTitle(); closeVaultGraphEditor();          vaultIsGraph = false; }

    // Save / close notebook editor
    if (vaultIsNotebook) {
        saveVaultDocTitle();   // persist any unsaved name change
        closeNotebookEditor();
    }

    // Save / close code editor
    if (vaultIsCode) {
        vaultIsCode = false;
        closeVaultCodeEditor();
    }

    // Save pending doc
    if (vaultIsDoc) {
        clearTimeout(vaultDocSaveTimer);
        saveVaultDocTitle();
        saveCurrentVaultDoc();
        vaultIsDoc = false;
        document.getElementById('vault-doc-editor-area').style.display = 'none';
        document.getElementById('vault-doc-toolbar-row').style.display = 'none';
        document.getElementById('vault-doc-footer').style.display      = 'none';
        document.getElementById('vault-normal-view').style.display     = '';
        document.getElementById('vault-viewer-title').classList.remove('hidden');
        document.getElementById('vault-doc-title-input').classList.add('hidden');
    }

    // Save any pending note
    clearTimeout(vaultNotesTimer);
    const input = document.getElementById('vault-notes-input');
    if (input && vaultOpenFileId) saveNoteForCurrentPage(input.value);

    if (pdfObserver) { pdfObserver.disconnect(); pdfObserver = null; }
    if (typeof pdfRenderObserver !== 'undefined' && pdfRenderObserver) { pdfRenderObserver.disconnect(); pdfRenderObserver = null; }
    if (typeof _pdfRenderInFlight !== 'undefined') _pdfRenderInFlight.clear();
    if (pdfDoc) { try { pdfDoc.destroy(); } catch(_) {} }   // free PDF worker/memory
    pdfDoc = null; pdfRenderQueue = []; pdfRendering = false;

    if (vaultIsPPTX) {
        vaultIsPPTX = false;
        pptxSlides = [];
        if (pptxTmpDir) { try { fs.rmSync(pptxTmpDir, { recursive: true }); } catch(e) {} pptxTmpDir = null; }
    }

    vaultOpenFileId = null;
    vaultIsPDF      = false;

    const singleCanvas = document.getElementById('vault-pdf-canvas');
    const altEl        = document.getElementById('vault-content-alt');
    const ctrlBar      = document.getElementById('vault-pdf-controls');
    const pagesEl      = document.getElementById('vault-pdf-pages');

    // Close fullscreen overlay if open, moving pages back first
    const fsOverlay = document.getElementById('vault-pdf-fullscreen-overlay');
    if (fsOverlay && fsOverlay.style.display !== 'none') {
        const normalScroll = document.getElementById('vault-pdf-scroll');
        const fsPages = document.getElementById('vault-pdf-pages');
        if (fsPages && normalScroll) normalScroll.appendChild(fsPages);
        fsOverlay.style.display = 'none';
    }

    if (singleCanvas) singleCanvas.style.display = 'block';
    if (altEl)   { altEl.innerHTML = ''; altEl.style.display = 'none'; }
    if (ctrlBar) ctrlBar.style.display = 'none';
    if (pagesEl) pagesEl.remove();

    document.getElementById('vault-viewer-view').style.display = 'none';
    document.getElementById('vault-grid-view').style.display   = '';
    renderVaultGrid();
}

function vaultRevealInFinder(filePath) {
    // shell.showItemInFolder takes the path as a value. The old `open -R "…"`
    // went through a shell, so an exported name containing a quote could run
    // as part of the command — and export names come from the file's title.
    try {
        require('electron').shell.showItemInFolder(filePath);
        return;
    } catch (_) {}
    const cmd = process.platform === 'darwin'
        ? `open -R "${filePath}"`
        : `explorer /select,"${filePath}"`;
    exec(cmd, () => {});
}

// Strip the characters a filesystem can't take, keeping spaces and casing so the
// exported file reads like the title in the Vault rather than a slug.
function vaultSafeFileName(name, fallback) {
    const clean = String(name || '')
        .replace(/[\/\\:*?"<>|]/g, '-')     // path separators + Windows reserved
        .replace(/[\x00-\x1f]/g, '')          // control characters
        .replace(/\s+/g, ' ')
        .replace(/^\.+/, '')                   // no leading dots (hidden files)
        .trim();
    return clean || fallback || 'file';
}

// "Report.pdf" already taken → "Report (1).pdf".
function vaultUniquePath(dir, fileName) {
    const ext  = path.extname(fileName);
    const base = path.basename(fileName, ext);
    let out = path.join(dir, fileName), n = 1;
    while (fs.existsSync(out)) out = path.join(dir, `${base} (${n++})${ext}`);
    return out;
}

// The name to export a vault file under. Files are stored on disk under an
// internal id (vf_1712….pdf) so renaming never has to touch the disk — which is
// why sharing used to hand people a file called "vf_1712…". Docs are stored as
// .vulsor, an extension nothing else opens, so they go out as .html.
function vaultExportFileName(file) {
    const isDoc = !!(file.isDoc || file.isCustomNote || vaultExt(file.storedName || '') === 'vulsor');
    let name = vaultSafeFileName(file.originalName, isDoc ? 'Document' : 'file');
    if (isDoc) {
        if (!/\.html?$/i.test(name)) name += '.html';
        return name;
    }
    // Keep the real extension when the display name has lost it (renaming is
    // free-form), so the exported copy still opens in the right app.
    if (!vaultExt(name) || vaultExt(name) === name.toLowerCase()) {
        const ext = vaultExt(file.storedName || '');
        if (ext) name += '.' + ext;
    }
    return name;
}

// Wrap a doc's stored fragment as a standalone HTML file so the shared copy
// opens in a browser or Word instead of being a bare run of tags.
function vaultDocExportHtml(file, body) {
    const title = String(file.originalName || 'Document').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const s     = (typeof vdDocStyleFor === 'function' && file.isCustomNote) ? vdDocStyleFor(file) : null;
    const pageCss = s
        ? `background:${s.bg};color:${s.fg};font-size:${parseFloat(s.size) || 15}px;font-family:${s.font};line-height:${s.lh}`
        : 'background:#fff;color:#111;font-family:Georgia,serif;line-height:1.7';
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{max-width:800px;margin:40px auto;padding:0 40px;${pageCss}}
table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:6px 10px}
h1,h2,h3{margin:1.2em 0 0.4em}hr{border:none;border-top:2px solid #e5e7eb;margin:1.5em 0}
a{color:#2563eb}img{max-width:100%}
@media print{@page{margin:1.5cm}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style>
</head><body>${body}</body></html>`;
}

function vaultShareFile(id) {
    const file = vaultData.files.find(f => f.id === id);
    if (!file) return;
    if (file.isProject) { exportVaultProject(file); return; }

    // A web link is a URL, not a file on disk. Hand over the address.
    if (file.isWebLink || vaultExt(file.storedName || '') === 'weblink') {
        const url = file.url || '';
        if (!url) { alert('That link has no address saved.'); return; }
        try {
            require('electron').clipboard.writeText(url);
            _vaultShowMoveToast(file.originalName || 'Link', 'the clipboard');
        } catch (_) { alert(url); }
        return;
    }
    if (!file.storedName) return;

    const src = path.join(VAULT_DIR, file.storedName);
    if (!fs.existsSync(src)) {
        alert(`"${file.originalName}" is missing from the Vault folder.\n\n`
            + 'The entry is still listed but the file itself is gone. Right-click it and delete to tidy it up.');
        return;
    }

    // A doc being edited right now may have unsaved changes sitting in the
    // editor — flush them so the shared copy isn't a version behind.
    if (vaultOpenFileId === file.id && vaultIsDoc) {
        try { clearTimeout(vaultDocSaveTimer); saveCurrentVaultDoc(); } catch (_) {}
    }

    const downloads = path.join(os.homedir(), 'Downloads');
    const isDoc = !!(file.isDoc || file.isCustomNote || vaultExt(file.storedName) === 'vulsor');
    try {
        const target = vaultUniquePath(downloads, vaultExportFileName(file));
        if (isDoc) {
            fs.writeFileSync(target, vaultDocExportHtml(file, fs.readFileSync(src, 'utf8')), 'utf8');
        } else {
            fs.copyFileSync(src, target);
        }
        vaultRevealInFinder(target);
    } catch (e) {
        console.error('Vault share failed:', e);
        alert('Could not export that file: ' + e.message);
    }
}

function exportVaultProject(file) {
    // Keep spaces and casing — "Kitchen Plan" should land as "Kitchen Plan.png",
    // not "Kitchen_Plan.png". Only characters a path can't hold are replaced.
    const safeName = vaultSafeFileName(file.originalName, 'project');
    const downloads = path.join(os.homedir(), 'Downloads');
    const type = file.projectType || 'build';

    if (type === 'build') {
        const notes = file.projectData || file.notes || '';
        const target = vaultUniquePath(downloads, safeName + '.txt');
        try {
            fs.writeFileSync(target, notes, 'utf8');
            vaultRevealInFinder(target);
        } catch(e) { alert('Export failed: ' + e.message); }
        return;
    }

    if (type === 'draw') {
        const dataUrl = file.projectData;
        if (!dataUrl) { alert('Nothing drawn yet — open the project and draw something first.'); return; }
        const target = vaultUniquePath(downloads, safeName + '.png');
        try {
            const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
            fs.writeFileSync(target, Buffer.from(base64, 'base64'));
            vaultRevealInFinder(target);
        } catch(e) { alert('Export failed: ' + e.message); }
        return;
    }

    if (type === 'plan') {
        if (!file.projectData || !file.projectData.nodes || !file.projectData.nodes.length) {
            alert('No diagram yet — open the project and add shapes first.');
            return;
        }
        exportVaultPlanAsPng(file, safeName, downloads);
        return;
    }

    if (type === '3d') {
        savedDataToOBJ(file.projectData, safeName);
    }
}

function exportVaultPlanAsPng(file, safeName, downloads) {
    const data = file.projectData;
    if (!data || !data.nodes) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    data.nodes.forEach(n => {
        minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
        maxX = Math.max(maxX, n.x + (n.w || 120)); maxY = Math.max(maxY, n.y + (n.h || 48));
    });
    const pad = 40;
    minX -= pad; minY -= pad; maxX += pad; maxY += pad;
    const w = maxX - minX, h = maxY - minY;

    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('width', w); svg.setAttribute('height', h);
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);

    const bg = document.createElementNS(ns, 'rect');
    bg.setAttribute('width', w); bg.setAttribute('height', h); bg.setAttribute('fill', '#ffffff');
    svg.appendChild(bg);

    const g = document.createElementNS(ns, 'g');
    g.setAttribute('transform', `translate(${-minX} ${-minY})`);
    data.nodes.forEach(n => {
        const rect = document.createElementNS(ns, 'rect');
        rect.setAttribute('x', n.x); rect.setAttribute('y', n.y);
        rect.setAttribute('width', n.w || 120); rect.setAttribute('height', n.h || 48);
        rect.setAttribute('rx', '6'); rect.setAttribute('fill', n.color || '#f1f5f9');
        rect.setAttribute('stroke', '#94a3b8'); rect.setAttribute('stroke-width', '1');
        g.appendChild(rect);
        if (n.text) {
            const txt = document.createElementNS(ns, 'text');
            txt.setAttribute('x', n.x + (n.w || 120) / 2);
            txt.setAttribute('y', n.y + (n.h || 48) / 2 + 4);
            txt.setAttribute('text-anchor', 'middle'); txt.setAttribute('font-size', '12');
            txt.setAttribute('font-family', 'sans-serif'); txt.setAttribute('fill', '#1e293b');
            txt.textContent = n.text;
            g.appendChild(txt);
        }
    });
    svg.appendChild(g);

    const svgStr = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([svgStr], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
        const scale = 2;
        const c = document.createElement('canvas');
        c.width = w * scale; c.height = h * scale;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob(b => {
            const reader = new FileReader();
            reader.onload = () => {
                try {
                    const target = vaultUniquePath(downloads, safeName + '.png');
                    fs.writeFileSync(target, Buffer.from(reader.result));
                    vaultRevealInFinder(target);
                } catch(e) { alert('Export failed: ' + e.message); }
            };
            reader.readAsArrayBuffer(b);
        }, 'image/png');
    };
    img.src = url;
}

function vaultOpenExternal(filePath) {
    const cmd = process.platform === 'darwin' ? `open "${filePath}"` : `start "" "${filePath}"`;
    exec(cmd, err => { if (err) console.error('Open external:', err); });
}

function renderVaultFolderSelect() {
    const sel  = document.getElementById('vault-viewer-folder-select');
    if (!sel) return;
    const file = vaultData.files.find(f => f.id === vaultOpenFileId);
    sel.innerHTML = '<option value="">No folder</option>' + vaultFolderOptions(null, 0);
    if (file && file.folderId) sel.value = file.folderId;
    // Show/hide the "go to folder" arrow button
    const btn = document.getElementById('vault-goto-folder-btn');
    if (btn) btn.style.display = (file && file.folderId) ? '' : 'none';
}

// Navigate to the current file's folder (saves + closes the viewer first)
function vaultGoToCurrentFolder() {
    const file = vaultData.files.find(f => f.id === vaultOpenFileId);
    const targetFolder = file ? (file.folderId || null) : null;
    closeVaultViewer();
    setVaultFolder(targetFolder);
}

// ── Sidebar docs list ──────────────────────────────────────────────
function renderVaultDocsList() {
    const el = document.getElementById('vault-docs-list');
    if (!el) return;
    const docs = vaultData.files.filter(f => f.isDoc).sort((a, b) => (b.updatedAt || b.addedAt) - (a.updatedAt || a.addedAt));
    if (!docs.length) {
        el.innerHTML = '<p class="text-slate-700 text-[10px] px-2 py-1 italic">No documents yet</p>';
        return;
    }
    el.innerHTML = docs.map(f => {
        const isOpen = vaultOpenFileId === f.id;
        return `<div class="vault-sidebar-doc group flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition-all ${
            isOpen ? 'bg-slate-800 text-slate-200' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
        }" data-id="${f.id}" title="${f.originalName}">
            <i class="fas fa-file-alt text-[10px] shrink-0" style="color:#f87171"></i>
            <span class="text-xs flex-1 truncate">${f.originalName}</span>
            <button class="vault-sidebar-doc-del opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400 transition-all text-[9px] shrink-0" data-id="${f.id}">
                <i class="fas fa-times"></i>
            </button>
        </div>`;
    }).join('');
    el.querySelectorAll('.vault-sidebar-doc').forEach(row => {
        row.onclick = e => {
            if (e.target.closest('.vault-sidebar-doc-del')) return;
            openVaultFile(row.dataset.id);
        };
    });
    el.querySelectorAll('.vault-sidebar-doc-del').forEach(btn => {
        btn.onclick = e => {
            e.stopPropagation();
            const f = vaultData.files.find(x => x.id === btn.dataset.id);
            if (f && confirm(`Delete "${f.originalName}"? This cannot be undone.`)) deleteVaultFile(btn.dataset.id);
        };
    });
}

// ── Sidebar notes list ─────────────────────────────────────────────
function renderVaultNotesList() {
    const el = document.getElementById('vault-notes-sidebar-list');
    if (!el) return;
    const withNotes = vaultData.files.filter(f => !f.isDoc && (
        f.notes || Object.values(f.pageNotes || {}).some(n => n)
    )).sort((a, b) => b.addedAt - a.addedAt);
    if (!withNotes.length) {
        el.innerHTML = '<p class="text-slate-700 text-[10px] px-2 py-1 italic">No notes yet</p>';
        return;
    }
    el.innerHTML = withNotes.map(f => {
        const { icon, color } = vaultIcon(f.originalName, false, false, f.isNotebook, f);
        const noteCount = f.pageNotes ? Object.values(f.pageNotes).filter(n => n).length : 0;
        const label = noteCount > 1 ? `${noteCount} notes` : '1 note';
        return `<div class="vault-sidebar-noted flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 transition-all" data-id="${f.id}" title="${f.originalName}">
            <i class="fas ${icon} text-[10px] shrink-0" style="color:${color}"></i>
            <span class="text-xs flex-1 truncate">${f.originalName}</span>
            <span class="text-[9px] text-amber-400 shrink-0"><i class="fas fa-sticky-note"></i> ${label}</span>
        </div>`;
    }).join('');
    el.querySelectorAll('.vault-sidebar-noted').forEach(row => {
        row.onclick = () => openVaultFile(row.dataset.id);
    });
}

// ── Sidebar unified tree ───────────────────────────────────────────

// Render sidebar file rows for files belonging to a given folder (or root)
function renderSidebarFilesHTML(folderId, indent) {
    const files = vaultData.files
        .filter(f => (f.folderId || null) === folderId)
        .sort((a, b) => (b.updatedAt || b.addedAt) - (a.updatedAt || a.addedAt));
    if (!files.length) return '';
    return files.map(f => {
        const { icon, color } = vaultIcon(f.originalName, f.isDoc, f.isCode, f.isNotebook, f);
        const isOpen = vaultOpenFileId === f.id;
        const hasNote = f.notes || Object.values(f.pageNotes || {}).some(n => n);
        return `<div class="vault-sidebar-file group flex items-center gap-1.5 py-1 rounded-lg cursor-pointer transition-all pr-1 ${
            isOpen ? 'bg-slate-800 text-slate-200' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
        }" style="padding-left:${8 + indent}px" data-file-id="${f.id}" title="${f.originalName}">
            <i class="fas ${icon} text-[9px] shrink-0" style="color:${color}"></i>
            <span class="text-[11px] flex-1 truncate">${f.originalName}</span>
            ${hasNote ? '<i class="fas fa-sticky-note text-amber-400 text-[8px] shrink-0"></i>' : ''}
            <button class="vault-sidebar-file-del opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400 transition-all text-[8px] shrink-0 ml-0.5" data-file-id="${f.id}">
                <i class="fas fa-times"></i>
            </button>
        </div>`;
    }).join('');
}

function renderFolderTreeHTML(parentId, depth) {
    const children = vaultData.folders.filter(f => (f.parentId || null) === parentId);
    const indent   = depth * 14;

    const folderHTML = children.map(f => {
        const subFolders  = vaultData.folders.filter(c => c.parentId === f.id);
        const folderFiles = vaultData.files.filter(file => file.folderId === f.id);
        const hasKids     = subFolders.length > 0 || folderFiles.length > 0;
        const isExpanded  = vaultExpandedFolders.has(f.id);
        const isActive    = vaultActiveFolderId === f.id;
        const totalCount  = folderFiles.length;

        return `<div data-tree-folder="${f.id}">
            <div class="vault-folder-row group flex items-center gap-1.5 py-1.5 rounded-lg cursor-pointer transition-all pr-1 ${
                isActive ? 'bg-slate-800 text-slate-200' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }" style="padding-left:${6 + indent}px" data-id="${f.id}">
                <button class="vault-expand-btn w-4 h-4 flex items-center justify-center rounded shrink-0 ${
                    hasKids ? 'hover:bg-slate-700' : 'opacity-0 pointer-events-none'
                }" data-id="${f.id}">
                    <i class="fas fa-chevron-${isExpanded ? 'down' : 'right'} text-[8px] text-slate-500"></i>
                </button>
                <div class="w-2 h-2 rounded-full shrink-0" style="background:${f.color}"></div>
                <span class="text-xs flex-1 truncate">${f.name}</span>
                <span class="text-[10px] text-slate-600 group-hover:opacity-0 transition-opacity">${totalCount || ''}</span>
                <div class="absolute right-2 hidden group-hover:flex items-center gap-0.5">
                    <button class="vault-add-sub-btn w-5 h-5 flex items-center justify-center rounded hover:bg-slate-600 text-slate-500 hover:text-green-400 transition-colors" data-parent="${f.id}" title="New subfolder">
                        <i class="fas fa-plus text-[8px]"></i>
                    </button>
                    <button class="vault-del-folder-btn w-5 h-5 flex items-center justify-center rounded hover:bg-slate-600 text-slate-500 hover:text-red-400 transition-colors" data-id="${f.id}" title="Delete folder">
                        <i class="fas fa-times text-[8px]"></i>
                    </button>
                </div>
            </div>
            ${isExpanded ? `<div class="vault-children">
                ${renderFolderTreeHTML(f.id, depth + 1)}
                ${renderSidebarFilesHTML(f.id, 6 + indent + 14)}
            </div>` : ''}
        </div>`;
    }).join('');

    return folderHTML;
}

function renderVaultFolders() {
    const el     = document.getElementById('vault-folders-list');
    const allBtn = document.getElementById('vault-all-btn');
    if (!el) return;

    // All Files button state
    if (allBtn) {
        const isAll = vaultActiveFolderId === null;
        allBtn.className = 'vault-side-row' + (isAll ? ' vault-side-row-active' : '');
        allBtn.querySelector('.vault-all-count').textContent = vaultData.files.length;
    }

    // Build unified tree: folders + root-level files
    const folderHTML    = renderFolderTreeHTML(null, 0);
    const rootFilesHTML = renderSidebarFilesHTML(null, 8);
    const hasContent    = vaultData.folders.length || vaultData.files.length;

    el.innerHTML = hasContent
        ? folderHTML + rootFilesHTML
        : '<p class="text-slate-700 text-[10px] px-2 py-2 italic">Nothing here yet</p>';

    el.style.position = 'relative';

    // Folder row click → navigate (if a file is open, close it first then go to folder)
    el.querySelectorAll('.vault-folder-row').forEach(row => {
        row.style.position = 'relative';
        row.onclick = e => {
            if (e.target.closest('.vault-expand-btn') ||
                e.target.closest('.vault-add-sub-btn') ||
                e.target.closest('.vault-del-folder-btn')) return;
            if (vaultOpenFileId) closeVaultViewer();
            setVaultFolder(row.dataset.id);
        };
    });

    // Expand / collapse
    el.querySelectorAll('.vault-expand-btn').forEach(btn => {
        btn.onclick = e => {
            e.stopPropagation();
            const id = btn.dataset.id;
            if (vaultExpandedFolders.has(id)) vaultExpandedFolders.delete(id);
            else vaultExpandedFolders.add(id);
            renderVaultFolders();
        };
    });

    // Add subfolder
    el.querySelectorAll('.vault-add-sub-btn').forEach(btn => {
        btn.onclick = e => { e.stopPropagation(); openVaultFolderModal(btn.dataset.parent); };
    });

    // Delete folder
    el.querySelectorAll('.vault-del-folder-btn').forEach(btn => {
        btn.onclick = e => {
            e.stopPropagation();
            const fid  = btn.dataset.id;
            const name = vaultData.folders.find(f => f.id === fid)?.name;
            if (!confirm(`Delete folder "${name}" and all its subfolders?\nFiles will be moved to All Files.`)) return;
            const ids = vaultDescendantIds(fid);
            vaultData.files.forEach(f => { if (ids.includes(f.folderId)) f.folderId = null; });
            vaultData.folders = vaultData.folders.filter(f => !ids.includes(f.id));
            if (ids.includes(vaultActiveFolderId)) vaultActiveFolderId = null;
            ids.forEach(id => vaultExpandedFolders.delete(id));
            saveVaultData();
            renderVaultFolders();
            renderVaultGrid();
        };
    });

    // Right-click a folder row → context menu (move / rename / new sub / delete)
    el.querySelectorAll('.vault-folder-row').forEach(row => {
        row.addEventListener('contextmenu', e => {
            e.preventDefault();
            e.stopPropagation();
            const fid = row.dataset.id;
            openVaultContextMenu(e.clientX, e.clientY, [
                { label: 'Open',          icon: 'fa-folder-open',  color: '#3b82f6', action: () => { if (vaultOpenFileId) closeVaultViewer(); setVaultFolder(fid); } },
                { label: 'New Subfolder', icon: 'fa-folder-plus',  color: '#94a3b8', action: () => openVaultFolderModal(fid) },
                { label: 'Rename',        icon: 'fa-pen',          color: '#94a3b8', action: () => renameVaultFolder(fid) },
                { label: 'Move to…',      icon: 'fa-arrow-right-arrow-left', color: '#94a3b8', action: () => moveVaultFolderPicker(fid) },
                { separator: true },
                { label: 'Delete Folder', icon: 'fa-trash',        danger: true,     action: () => deleteVaultFolder(fid) },
            ]);
        });
    });

    // Sidebar file clicks
    el.querySelectorAll('.vault-sidebar-file').forEach(row => {
        row.onclick = e => {
            if (e.target.closest('.vault-sidebar-file-del')) return;
            openVaultFile(row.dataset.fileId);
        };
    });

    // Sidebar file delete
    el.querySelectorAll('.vault-sidebar-file-del').forEach(btn => {
        btn.onclick = e => {
            e.stopPropagation();
            const f = vaultData.files.find(x => x.id === btn.dataset.fileId);
            if (f && confirm(`Delete "${f.originalName}"? This cannot be undone.`)) deleteVaultFile(btn.dataset.fileId);
        };
    });

    // ── Sidebar drag-to-move ──────────────────────────────────────
    let sbDragFileId   = null;
    let sbDragFolderId = null;

    // Make file rows draggable
    el.querySelectorAll('.vault-sidebar-file').forEach(row => {
        row.setAttribute('draggable', 'true');

        row.addEventListener('dragstart', e => {
            sbDragFileId   = row.dataset.fileId;
            sbDragFolderId = null;
            e.dataTransfer.effectAllowed = 'move';
            e.stopPropagation();
            setTimeout(() => row.classList.add('vault-sb-dragging'), 0);
        });

        row.addEventListener('dragend', () => {
            sbDragFileId = null;
            row.classList.remove('vault-sb-dragging');
            el.querySelectorAll('.vault-sb-folder-target')
              .forEach(r => r.classList.remove('vault-sb-folder-target'));
        });
    });

    // Make folder rows draggable
    el.querySelectorAll('.vault-folder-row').forEach(row => {
        row.setAttribute('draggable', 'true');

        row.addEventListener('dragstart', e => {
            sbDragFolderId = row.dataset.id;
            sbDragFileId   = null;
            e.dataTransfer.effectAllowed = 'move';
            e.stopPropagation();
            setTimeout(() => row.classList.add('vault-sb-dragging'), 0);
        });

        row.addEventListener('dragend', () => {
            sbDragFolderId = null;
            row.classList.remove('vault-sb-dragging');
            el.querySelectorAll('.vault-sb-folder-target')
              .forEach(r => r.classList.remove('vault-sb-folder-target'));
        });
    });

    // Folder rows accept drops (files and folders)
    el.querySelectorAll('.vault-folder-row').forEach(row => {
        row.addEventListener('dragover', e => {
            const targetId = row.dataset.id;
            // Files dragged in from outside — the row is a live target too.
            if (!sbDragFileId && !sbDragFolderId) {
                if (!vaultDragHasFiles(e)) return;
                e.preventDefault();
                e.stopPropagation();
                el.querySelectorAll('.vault-sb-folder-target')
                  .forEach(r => r.classList.remove('vault-sb-folder-target'));
                row.classList.add('vault-sb-folder-target');
                e.dataTransfer.dropEffect = 'copy';
                return;
            }
            if (sbDragFolderId) {
                if (sbDragFolderId === targetId) return;
                const desc = vaultDescendantIds(sbDragFolderId);
                if (desc.includes(targetId)) return; // cycle guard
            }
            e.preventDefault();
            e.stopPropagation();
            el.querySelectorAll('.vault-sb-folder-target')
              .forEach(r => r.classList.remove('vault-sb-folder-target'));
            row.classList.add('vault-sb-folder-target');
            e.dataTransfer.dropEffect = 'move';
        });

        row.addEventListener('dragleave', e => {
            if (!row.contains(e.relatedTarget)) {
                row.classList.remove('vault-sb-folder-target');
            }
        });

        row.addEventListener('drop', e => {
            e.preventDefault();
            e.stopPropagation();
            row.classList.remove('vault-sb-folder-target');
            const targetId = row.dataset.id;

            // Dropped in from outside → straight into this folder.
            if (!sbDragFileId && !sbDragFolderId) { vaultDropExternalFiles(e, targetId); return; }

            if (sbDragFolderId) {
                if (sbDragFolderId === targetId) return;
                const desc = vaultDescendantIds(sbDragFolderId);
                if (desc.includes(targetId)) return;
                const folder = vaultData.folders.find(f => f.id === sbDragFolderId);
                if (!folder || folder.parentId === targetId) return;
                folder.parentId = targetId;
                vaultExpandedFolders.add(targetId);
                saveVaultData();
                renderVaultFolders();
                renderVaultGrid();
                _vaultShowMoveToast(folder.name, vaultData.folders.find(f => f.id === targetId)?.name);
                return;
            }

            if (sbDragFileId) {
                const file = vaultData.files.find(f => f.id === sbDragFileId);
                if (!file || file.folderId === targetId) return;
                file.folderId = targetId;
                vaultExpandedFolders.add(targetId);
                saveVaultData();
                renderVaultFolders();
                renderVaultGrid();
                _vaultShowMoveToast(file.originalName, vaultData.folders.find(f => f.id === targetId)?.name);
            }
        });
    });

    // "All Files" button accepts drops → moves file/folder to root
    if (allBtn) {
        allBtn.addEventListener('dragover', e => {
            if (!sbDragFileId && !sbDragFolderId && !vaultDragHasFiles(e)) return;
            e.preventDefault();
            e.stopPropagation();
            el.querySelectorAll('.vault-sb-folder-target')
              .forEach(r => r.classList.remove('vault-sb-folder-target'));
            allBtn.classList.add('vault-sb-folder-target');
            e.dataTransfer.dropEffect = 'move';
        });

        allBtn.addEventListener('dragleave', e => {
            if (!allBtn.contains(e.relatedTarget)) {
                allBtn.classList.remove('vault-sb-folder-target');
            }
        });

        allBtn.addEventListener('drop', e => {
            e.preventDefault();
            e.stopPropagation();
            allBtn.classList.remove('vault-sb-folder-target');

            // Dropped in from outside → the Vault root.
            if (!sbDragFileId && !sbDragFolderId) { vaultDropExternalFiles(e, null); return; }

            if (sbDragFolderId) {
                const folder = vaultData.folders.find(f => f.id === sbDragFolderId);
                if (!folder || folder.parentId === null) return;
                folder.parentId = null;
                saveVaultData();
                renderVaultFolders();
                renderVaultGrid();
                _vaultShowMoveToast(folder.name, 'All Files');
                return;
            }

            if (sbDragFileId) {
                const file = vaultData.files.find(f => f.id === sbDragFileId);
                if (!file || file.folderId === null) return;
                file.folderId = null;
                saveVaultData();
                renderVaultFolders();
                renderVaultGrid();
                _vaultShowMoveToast(file.originalName, 'All Files');
            }
        });
    }

    if (vaultOpenFileId) renderVaultFolderSelect();
}

// ── Move-to-folder toast ───────────────────────────────────────────
// The bottom-of-screen toast. Shared by "moved to…" and by files that arrive
// from outside the app (Claude writing through server/vault-mcp.js).
function _vaultShowToast(html) {
    const existing = document.getElementById('vault-move-toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.id = 'vault-move-toast';
    toast.className = 'fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium shadow-xl pointer-events-none';
    toast.style.cssText = 'background:#1e293b;border:1px solid #334155;color:#e2e8f0;transition:opacity .3s';
    toast.innerHTML = html;
    document.body.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 2200);
}

function _vaultShowMoveToast(fileName, folderName) {
    const name = (fileName.length > 22 ? fileName.slice(0, 20) + '…' : fileName);
    const dest = (folderName || 'folder').length > 18 ? (folderName||'folder').slice(0,16)+'…' : (folderName||'folder');
    _vaultShowToast(`<i class="fas fa-check-circle text-green-400 text-sm"></i> <span><b>${name}</b> moved to <b>${dest}</b></span>`);
}

// ── Dropping files in from outside ─────────────────────────────────
// A drag from Finder (or any other app) carries files instead of one of our
// own card ids, which is what tells the two cases apart in every handler.
function vaultDragHasFiles(e) {
    try { return Array.from(e.dataTransfer.types || []).includes('Files'); } catch(_) { return false; }
}

// Files dropped from outside land in the folder they were dropped on — the
// folder card, the sidebar row, or the folder the grid is showing. No
// "where should this go?" prompt: you already said where by dropping it there.
function vaultDropExternalFiles(e, folderId) {
    const paths = Array.from(e.dataTransfer.files || []).map(vaultFilePath).filter(Boolean);
    if (!paths.length) return false;
    const res  = addFilesToVault(paths, folderId);
    const dest = folderId ? (vaultData.folders.find(f => f.id === folderId)?.name || 'the Vault') : 'All Files';
    if (res.added) {
        const what = res.added === 1 ? path.basename(paths[0]) : res.added + ' files';
        _vaultShowToast(`<i class="fas fa-check-circle text-green-400 text-sm"></i> `
            + `<span><b>${_vaultEsc(_vaultClip(what, 24))}</b> added to <b>${_vaultEsc(_vaultClip(dest, 18))}</b></span>`);
    }
    if (res.failed) {
        console.error('[vault] %d file(s) could not be added', res.failed);
        if (!res.added) _vaultShowToast('<i class="fas fa-triangle-exclamation text-amber-400 text-sm"></i> <span>Could not add those files</span>');
    }
    return true;
}
const _vaultClip = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));

// ── Drag-to-reorder helpers ────────────────────────────────────────
function vaultReorderItem(arr, srcId, tgtId, before) {
    const srcIdx = arr.findIndex(x => x.id === srcId);
    const tgtIdx = arr.findIndex(x => x.id === tgtId);
    if (srcIdx === -1 || tgtIdx === -1 || srcIdx === tgtIdx) return;
    const [item] = arr.splice(srcIdx, 1);
    const newTgt = arr.findIndex(x => x.id === tgtId);
    arr.splice(before ? newTgt : newTgt + 1, 0, item);
}

// ── File grid + subfolder cards ────────────────────────────────────
function filteredVaultFiles() {
    // Only direct children of the active folder
    let files = vaultData.files.filter(f =>
        vaultActiveFolderId === null ? !f.folderId : f.folderId === vaultActiveFolderId
    );
    if (vaultSearchQuery) {
        const q = vaultSearchQuery.toLowerCase();
        // When searching, scan all files regardless of folder
        files = vaultData.files.filter(f => f.originalName.toLowerCase().includes(q));
    }
    if (vaultSortOrder === 'custom') return files; // preserve array order
    return files.sort((a, b) => {
        switch (vaultSortOrder) {
            case 'date-asc':  return a.addedAt - b.addedAt;
            case 'name-asc':  return a.originalName.localeCompare(b.originalName);
            case 'name-desc': return b.originalName.localeCompare(a.originalName);
            case 'size-desc': return (b.size || 0) - (a.size || 0);
            case 'size-asc':  return (a.size || 0) - (b.size || 0);
            default:          return b.addedAt - a.addedAt; // date-desc
        }
    });
}

// ── Card previews: the first page instead of a file-type icon ──────
// A grid of identical red PDF icons tells you nothing about which document
// is which, so every card that *can* show its own first page does.
//   pdf    → page 1 rendered with pdf.js, cached on disk as a JPEG
//   image  → the image itself
//   paper  → docs/notes/markdown/text laid out as a miniature white page
//   code   → same, on the dark background the code viewer uses
// Anything else (notebooks, molecules, videos, …) keeps its icon.
//
// PDF renders are cached under VAULT_DIR/.thumbs keyed by file id: rendering
// a folder full of big documents on every grid repaint would stall the UI.
const VAULT_THUMB_DIR   = path.join(VAULT_DIR, '.thumbs');
const VAULT_THUMB_WIDTH = 320;          // px wide the PDF page is rendered at
const _vaultThumbCache  = new Map();    // file id → data URL
const _vaultThumbFailed = new Set();    // file ids whose render already failed
const _vaultThumbQueue  = [];           // file ids waiting to be rendered
let   _vaultThumbBusy   = false;
let   _vaultThumbForFolders = false;    // a queued render will fill a folder card

const VAULT_PAPER_EXTS = ['vulsor','verso','md','markdown','txt','text','log','csv','tsv'];
const VAULT_IMAGE_EXTS = ['png','jpg','jpeg','gif','webp','svg','bmp','avif'];

// Which kind of preview a file can produce, or null to keep the icon.
function vaultThumbKind(file) {
    if (!file || !file.storedName)  return null;
    if (file.isProject || file.isWebLink || file.isNotebook) return null;
    if (file.isMolecule || file.isPeriodic || file.isDna ||
        file.isAnatomy  || file.isChessStrategy || file.isGraph) return null;

    const ext = vaultExt(file.storedName);
    if (ext === 'pdf')                    return 'pdf';
    if (VAULT_IMAGE_EXTS.includes(ext))   return 'image';
    if (file.isDoc || file.isCustomNote)  return 'paper';
    if (VAULT_PAPER_EXTS.includes(ext))   return 'paper';
    if (file.isCode || (typeof isCodeFile === 'function' && isCodeFile(file.originalName)))
                                          return 'code';
    return null;
}

function vaultThumbSrc(file) { return path.join(VAULT_DIR, file.storedName); }

function vaultFileURL(p) {
    try { return pathToFileURL(p).href; } catch(_) { return 'file://' + p; }
}

// First few hundred characters of a text-ish file. Reads only the head of the
// file so a 40 MB log costs the same as a two-line note.
function vaultThumbText(file) {
    let raw = '';
    try {
        const fd  = fs.openSync(vaultThumbSrc(file), 'r');
        const buf = Buffer.alloc(4096);
        const n   = fs.readSync(fd, buf, 0, 4096, 0);
        fs.closeSync(fd);
        raw = buf.subarray(0, n).toString('utf8');
    } catch(_) { return ''; }

    // Docs and notes are stored as HTML — show what the page reads like,
    // not its markup.
    if (file.isDoc || file.isCustomNote || /\.(vulsor|verso|html?)$/i.test(file.storedName)) {
        raw = raw.replace(/<(script|style)[\s\S]*?(<\/\1>|$)/gi, '')
                 .replace(/<br\s*\/?>/gi, '\n')
                 .replace(/<\/(p|div|h[1-6]|li|tr|blockquote|pre)>/gi, '\n')
                 .replace(/<[^>]*>/g, '')
                 .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
                 .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
    }
    return raw.replace(/\r/g, '').replace(/�/g, '').replace(/\n{3,}/g, '\n\n').trim();
}

// A miniature page of text: first line as the title, the rest as body copy.
function vaultThumbPaperHTML(file, kind) {
    const text = vaultThumbText(file);
    if (!text) return '';
    const lines = text.split('\n');
    const title = (lines.shift() || '').replace(/^#{1,6}\s+/, '').trim().slice(0, 80);
    const body  = lines.join('\n').replace(/^\n+/, '').slice(0, 1400);
    return `<div class="vault-thumb ${kind === 'code' ? 'vault-thumb-code' : 'vault-thumb-paper'}">
        <div class="vault-thumb-title">${_vaultEsc(title)}</div>
        <div class="vault-thumb-body">${_vaultEsc(body)}</div>
    </div>`;
}

// Cached PDF thumbnail, from memory or from disk. Returns '' if there isn't
// one yet or the document has changed since it was made.
function vaultThumbCached(file) {
    if (_vaultThumbCache.has(file.id)) return _vaultThumbCache.get(file.id);
    const dest = path.join(VAULT_THUMB_DIR, file.id + '.jpg');
    try {
        if (fs.statSync(dest).mtimeMs < fs.statSync(vaultThumbSrc(file)).mtimeMs) return '';
        const url = 'data:image/jpeg;base64,' + fs.readFileSync(dest).toString('base64');
        _vaultThumbCache.set(file.id, url);
        return url;
    } catch(_) { return ''; }
}

// Render page 1 of a PDF to a JPEG data URL and cache it on disk.
async function vaultRenderPDFThumb(file) {
    if (typeof pdfjsLib === 'undefined') return '';
    const doc = await pdfjsLib.getDocument(vaultFileURL(vaultThumbSrc(file))).promise;
    try {
        const page   = await doc.getPage(1);
        const scale  = VAULT_THUMB_WIDTH / page.getViewport({ scale: 1 }).width;
        const vp     = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width  = Math.max(1, Math.round(vp.width));
        canvas.height = Math.max(1, Math.round(vp.height));
        const ctx = canvas.getContext('2d');
        // Pages are drawn without a background — paint the paper ourselves,
        // or the thumbnail comes out as black text on transparency.
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        const url = canvas.toDataURL('image/jpeg', 0.82);
        try {
            fs.mkdirSync(VAULT_THUMB_DIR, { recursive: true });
            vaultWriteFile(path.join(VAULT_THUMB_DIR, file.id + '.jpg'),
                           Buffer.from(url.split(',')[1], 'base64'));
        } catch(_) {}
        _vaultThumbCache.set(file.id, url);
        return url;
    } finally {
        try { doc.destroy(); } catch(_) {}
    }
}

function vaultThumbDelete(id) {
    _vaultThumbCache.delete(id);
    _vaultThumbFailed.delete(id);
    try { fs.unlinkSync(path.join(VAULT_THUMB_DIR, id + '.jpg')); } catch(_) {}
}

function vaultApplyThumb(box, url) {
    box.style.background = '';
    box.classList.add('vault-thumb-img');
    box.innerHTML = `<img src="${url}" alt="" draggable="false">`;
}

// One PDF at a time: pdf.js shares a single worker, and a slow render must
// never hold up the rest of the grid.
async function _vaultThumbPump() {
    if (_vaultThumbBusy) return;
    _vaultThumbBusy = true;
    try {
        while (_vaultThumbQueue.length) {
            const id   = _vaultThumbQueue.shift();
            const file = vaultData.files.find(f => f.id === id);
            if (!file) continue;
            let url = '';
            try { url = await vaultRenderPDFThumb(file); }
            catch (e) { console.warn('[vault] thumbnail failed:', file.originalName, e.message); }
            if (!url) { _vaultThumbFailed.add(id); continue; }
            document.querySelectorAll(`.vault-thumb[data-thumb-id="${id}"]`)
                    .forEach(box => vaultApplyThumb(box, url));
        }
    } finally { _vaultThumbBusy = false; }
    // Folder cards read the cache when they're built, so they need one repaint
    // once the pages they were waiting for exist.
    if (_vaultThumbForFolders) {
        _vaultThumbForFolders = false;
        renderVaultGrid();
    }
}

// The preview block for a card: a finished preview where we have one, the
// icon otherwise (queued for rendering if it's a PDF we haven't done yet).
function vaultCardPreviewHTML(file, icon, color) {
    const kind = vaultThumbKind(file);

    if (kind === 'image') {
        return `<div class="vault-thumb vault-thumb-img">
            <img src="${_vaultEsc(vaultFileURL(vaultThumbSrc(file)))}" alt="" draggable="false"
                 onerror="this.parentElement.className='vault-thumb vault-thumb-icon vault-thumb-plate';this.parentElement.innerHTML='<i class=&quot;fas ${icon}&quot; style=&quot;color:${color}&quot;></i>'">
        </div>`;
    }
    if (kind === 'paper' || kind === 'code') {
        const html = vaultThumbPaperHTML(file, kind);
        if (html) return html;
    }
    if (kind === 'pdf') {
        const cached = vaultThumbCached(file);
        if (cached) {
            return `<div class="vault-thumb vault-thumb-img">
                <img src="${cached}" alt="" draggable="false">
            </div>`;
        }
        if (!_vaultThumbFailed.has(file.id)) {
            return `<div class="vault-thumb vault-thumb-icon vault-thumb-plate" data-thumb-id="${file.id}">
                <i class="fas ${icon}" style="color:${color}"></i>
            </div>`;
        }
    }
    return `<div class="vault-thumb vault-thumb-icon vault-thumb-plate">
        <i class="fas ${icon}" style="color:${color}"></i>
    </div>`;
}

// Files inside a folder, its subfolders included — a folder of folders should
// still show what's at the bottom of it. Bounded so a deep tree stays cheap.
function _vaultFolderContents(folderId, out, depth) {
    if (out.length >= 24 || depth > 3) return out;
    for (const f of vaultData.files) {
        if (f.folderId === folderId) { out.push(f); if (out.length >= 24) return out; }
    }
    for (const c of vaultData.folders) {
        if ((c.parentId || null) === folderId) _vaultFolderContents(c.id, out, depth + 1);
    }
    return out;
}

// A folder card shows the documents it holds, fanned like sheets in a tray —
// a folder with lecture notes in it should look different from an empty one.
// Only pages we already have (a cached PDF render, an image) are used: opening
// a folder list must never kick off a batch of renders.
function vaultFolderPreviewHTML(folder) {
    const sheets = [];
    for (const file of _vaultFolderContents(folder.id, [], 0)) {
        if (sheets.length === 3) break;
        const kind = vaultThumbKind(file);
        if (kind === 'pdf') {
            const url = vaultThumbCached(file);
            if (url) sheets.push(url);
        } else if (kind === 'image') {
            sheets.push(vaultFileURL(vaultThumbSrc(file)));
        }
    }
    const badge = `<i class="fas fa-folder vault-thumb-badge" style="color:${folder.color}"></i>`;
    if (!sheets.length) {
        return `<div class="vault-thumb vault-thumb-icon" data-folder-thumb="${folder.id}" style="background:${folder.color}0e">
            <i class="fas fa-folder" style="color:${folder.color}"></i>
        </div>`;
    }
    // Middle sheet first in the DOM so it can sit on top of the fanned pair
    const order = sheets.length === 3 ? [sheets[1], sheets[0], sheets[2]] : sheets;
    const cls   = ['vault-sheet-mid', 'vault-sheet-left', 'vault-sheet-right'];
    return `<div class="vault-thumb vault-thumb-fan" style="background:${folder.color}0e">
        ${order.map((url, i) => `<div class="vault-sheet ${sheets.length === 1 ? 'vault-sheet-mid' : cls[i]}">
            <img src="${_vaultEsc(url)}" alt="" draggable="false">
        </div>`).join('')}
        ${badge}
    </div>`;
}

// Queue every card still showing a placeholder icon for a PDF render.
function vaultHydrateThumbs(gridEl) {
    const queue = id => {
        if (_vaultThumbFailed.has(id) || _vaultThumbQueue.includes(id)) return false;
        _vaultThumbQueue.push(id);
        return true;
    };
    gridEl.querySelectorAll('.vault-thumb[data-thumb-id]').forEach(box => queue(box.dataset.thumbId));

    // A folder with nothing to show yet gets one page rendered on its behalf, so
    // it stops looking empty after the first visit. One per folder, three per
    // repaint — enough to fill the view without a render storm.
    let budget = 3;
    gridEl.querySelectorAll('.vault-thumb[data-folder-thumb]').forEach(box => {
        if (budget <= 0) return;
        const first = _vaultFolderContents(box.dataset.folderThumb, [], 0)
            .find(f => vaultThumbKind(f) === 'pdf' && !_vaultThumbFailed.has(f.id) && !vaultThumbCached(f));
        if (first && queue(first.id)) { budget--; _vaultThumbForFolders = true; }
    });

    if (_vaultThumbQueue.length) _vaultThumbPump();
}

function renderVaultGrid() {
    const gridEl  = document.getElementById('vault-files-grid');
    const countEl = document.getElementById('vault-file-count');
    const titleEl = document.getElementById('vault-header-title');
    const emptyEl = document.getElementById('vault-empty-state');
    if (!gridEl) return;

    const files      = filteredVaultFiles();
    const subfolders = vaultSearchQuery ? [] : vaultData.folders.filter(f =>
        (f.parentId || null) === vaultActiveFolderId
    );

    // ── Breadcrumb ──
    if (titleEl) {
        const crumbs = vaultBreadcrumb(vaultSearchQuery ? null : vaultActiveFolderId);
        titleEl.innerHTML = crumbs.map((c, i) => {
            const isLast = i === crumbs.length - 1;
            return isLast
                ? `<span class="text-white">${c.name}</span>`
                : `<button class="vault-crumb text-slate-500 hover:text-slate-300 transition-colors" data-id="${c.id ?? ''}">${c.name}</button>
                   <span class="text-slate-700 mx-1">/</span>`;
        }).join('');
        titleEl.querySelectorAll('.vault-crumb').forEach(btn => {
            btn.onclick = () => setVaultFolder(btn.dataset.id || null);
        });
    }

    const totalItems = subfolders.length + files.length;
    if (countEl) {
        const parts = [];
        if (subfolders.length) parts.push(`${subfolders.length} folder${subfolders.length !== 1 ? 's' : ''}`);
        if (files.length)      parts.push(`${files.length} file${files.length !== 1 ? 's' : ''}`);
        countEl.textContent = parts.length ? parts.join(', ') : 'Empty';
    }

    if (totalItems === 0) {
        gridEl.innerHTML = '';
        if (emptyEl) emptyEl.style.display = '';
        return;
    }
    if (emptyEl) emptyEl.style.display = 'none';

    // ── Subfolder cards ──
    const subfolderHTML = subfolders.map(f => {
        const childCount    = vaultData.folders.filter(c => c.parentId === f.id).length;
        const fileCount     = vaultData.files.filter(file => file.folderId === f.id).length;
        const subLabel      = [
            fileCount  ? `${fileCount} file${fileCount !== 1 ? 's' : ''}` : '',
            childCount ? `${childCount} folder${childCount !== 1 ? 's' : ''}` : '',
        ].filter(Boolean).join(', ') || 'Empty';

        return `<div class="vault-subfolder-card group relative cursor-pointer" data-folder-id="${f.id}">
            ${vaultFolderPreviewHTML(f)}
            <p class="vault-card-name">${f.name}</p>
            <div class="vault-card-meta"><span>${subLabel}</span></div>
            <!-- Hover: add subfolder + delete -->
            <div class="absolute top-2 right-2 hidden group-hover:flex items-center gap-1">
                <button class="vault-subfolder-add w-6 h-6 bg-slate-700 hover:bg-green-600/20 text-slate-400 hover:text-green-400 rounded-lg flex items-center justify-center transition-colors" data-parent="${f.id}" title="New subfolder">
                    <i class="fas fa-plus text-[9px]"></i>
                </button>
                <button class="vault-subfolder-del w-6 h-6 bg-slate-700 hover:bg-red-600/20 text-slate-400 hover:text-red-400 rounded-lg flex items-center justify-center transition-colors" data-id="${f.id}" title="Delete folder">
                    <i class="fas fa-trash text-[9px]"></i>
                </button>
            </div>
        </div>`;
    }).join('');

    // ── File + Project cards ──
    const PROJECT_TYPES = {
        build: { icon: 'fa-hammer',         color: '#f97316', name: 'Build' },
        draw:  { icon: 'fa-pen-nib',        color: '#3b82f6', name: 'Draw'  },
        plan:  { icon: 'fa-clipboard-list', color: '#22c55e', name: 'Plan'  },
        '3d':  { icon: 'fa-cube',           color: '#a855f7', name: '3D'    },
    };
    const PROJECT_STATUSES = {
        idea:        { label: 'Idea',        color: '#64748b' },
        in_progress: { label: 'In progress', color: '#eab308' },
        done:        { label: 'Done',        color: '#22c55e' },
    };

    const fileHTML = files.map(file => {
        const folder = file.folderId ? vaultData.folders.find(f => f.id === file.folderId) : null;
        const date   = new Date(file.addedAt).toLocaleDateString([], { month: 'short', day: 'numeric' });
        const deleteBtn = `<button class="vault-card-delete absolute top-2 left-2 w-6 h-6 bg-red-600 rounded-lg text-white items-center justify-center opacity-0 group-hover:opacity-100 transition-all hover:bg-red-700 flex" data-id="${file.id}"><i class="fas fa-trash text-[9px]"></i></button>`;
        const shareBtn  = `<button class="vault-card-share absolute top-2 right-2 w-6 h-6 bg-slate-700 hover:bg-slate-600 rounded-lg text-slate-300 items-center justify-center opacity-0 group-hover:opacity-100 transition-all flex" data-id="${file.id}" title="Export / Share"><i class="fas fa-share-alt text-[9px]"></i></button>`;
        const folderTag = folder && vaultSearchQuery ? `<div class="mt-1.5 flex items-center gap-1.5"><div class="w-1.5 h-1.5 rounded-full" style="background:${folder.color}"></div><span class="text-[10px] text-slate-500 truncate">${folder.name}</span></div>` : '';

        if (file.isProject) {
            const pt = PROJECT_TYPES[file.projectType] || PROJECT_TYPES.build;
            const ps = PROJECT_STATUSES[file.projectStatus] || PROJECT_STATUSES.idea;
            return `<div class="vault-card group relative cursor-pointer" data-id="${file.id}">
                <div class="vault-thumb vault-thumb-icon" style="background:${pt.color}0e">
                    <i class="fas ${pt.icon}" style="color:${pt.color}"></i>
                </div>
                <p class="vault-card-name" title="${file.originalName}">${file.originalName}</p>
                <div class="vault-card-meta">
                    <span class="vault-card-kind" style="color:${pt.color}">${pt.name}</span>
                    <span><i class="fas fa-circle" style="font-size:4px;vertical-align:middle;margin-right:3px;color:${ps.color}"></i>${ps.label}</span>
                    <span class="vault-card-date">${date}</span>
                </div>
                ${folderTag}
                ${deleteBtn}
                ${shareBtn}
            </div>`;
        }

        const { icon, color } = vaultIcon(file.originalName, file.isDoc, file.isCode, file.isNotebook, file);
        const preview = vaultCardPreviewHTML(file, icon, color);
        const ext = file.isCustomNote ? 'NOTE'
                  : file.isDoc ? 'DOC'
                  : file.isNotebook ? 'NB'
                  : file.isMolecule ? 'MOL'
                  : file.isPeriodic ? 'PT'
                  : file.isDna ? 'DNA'
                  : file.isAnatomy ? 'ANAT'
                  : file.isChessStrategy ? 'CHESS'
                  : file.isGraph ? 'GRAPH'
                  : vaultExt(file.originalName).toUpperCase();
        return `<div class="vault-card group relative cursor-pointer" data-id="${file.id}">
            ${preview}
            <p class="vault-card-name" title="${file.originalName}">${file.originalName}</p>
            <div class="vault-card-meta">
                <span class="vault-card-kind" style="color:${color}">${ext}</span>
                <span>${vaultFmtSize(file.size)}</span>
                <span class="vault-card-date">${date}</span>
            </div>
            ${folderTag}
            ${file.notes ? `<div class="absolute top-2.5 right-2.5"><i class="fas fa-sticky-note text-amber-400 text-[10px]" title="Has notes"></i></div>` : ''}
            ${deleteBtn}
            ${shareBtn}
        </div>`;
    }).join('');

    gridEl.innerHTML = subfolderHTML + fileHTML;
    vaultHydrateThumbs(gridEl);

    // Wire subfolder card clicks
    gridEl.querySelectorAll('.vault-subfolder-card').forEach(card => {
        card.onclick = e => {
            if (e.target.closest('.vault-subfolder-add') || e.target.closest('.vault-subfolder-del')) return;
            setVaultFolder(card.dataset.folderId);
        };
    });
    gridEl.querySelectorAll('.vault-subfolder-add').forEach(btn => {
        btn.onclick = e => { e.stopPropagation(); openVaultFolderModal(btn.dataset.parent); };
    });
    gridEl.querySelectorAll('.vault-subfolder-del').forEach(btn => {
        btn.onclick = e => {
            e.stopPropagation();
            deleteVaultFolder(btn.dataset.id);
        };
    });

    // Right-click a subfolder card → folder context menu
    gridEl.querySelectorAll('.vault-subfolder-card').forEach(card => {
        card.addEventListener('contextmenu', e => {
            e.preventDefault();
            e.stopPropagation();
            const fid = card.dataset.folderId;
            openVaultContextMenu(e.clientX, e.clientY, [
                { label: 'Open',          icon: 'fa-folder-open',  color: '#3b82f6', action: () => setVaultFolder(fid) },
                { label: 'New Subfolder', icon: 'fa-folder-plus',  color: '#94a3b8', action: () => openVaultFolderModal(fid) },
                { label: 'Rename',        icon: 'fa-pen',          color: '#94a3b8', action: () => renameVaultFolder(fid) },
                { label: 'Move to…',      icon: 'fa-arrow-right-arrow-left', color: '#94a3b8', action: () => moveVaultFolderPicker(fid) },
                { separator: true },
                { label: 'Delete Folder', icon: 'fa-trash',        danger: true,     action: () => deleteVaultFolder(fid) },
            ]);
        });
    });

    // Wire file card clicks
    gridEl.querySelectorAll('.vault-card').forEach(card => {
        card.onclick = e => {
            if (e.target.closest('.vault-card-delete') || e.target.closest('.vault-card-share')) return;
            openVaultFile(card.dataset.id);
        };
    });
    gridEl.querySelectorAll('.vault-card-delete').forEach(btn => {
        btn.onclick = e => {
            e.stopPropagation();
            const file = vaultData.files.find(f => f.id === btn.dataset.id);
            if (file && confirm(`Delete "${file.originalName}"? This cannot be undone.`)) {
                deleteVaultFile(btn.dataset.id);
            }
        };
    });
    gridEl.querySelectorAll('.vault-card-share').forEach(btn => {
        btn.onclick = e => {
            e.stopPropagation();
            vaultShareFile(btn.dataset.id);
        };
    });

    // Right-click a file card → file context menu
    gridEl.querySelectorAll('.vault-card').forEach(card => {
        card.addEventListener('contextmenu', e => {
            e.preventDefault();
            e.stopPropagation();
            const fid  = card.dataset.id;
            const file = vaultData.files.find(f => f.id === fid);
            if (!file) return;
            openVaultContextMenu(e.clientX, e.clientY, [
                { label: 'Open',           icon: 'fa-up-right-from-square', color: '#3b82f6', action: () => openVaultFile(fid) },
                { label: 'Rename',         icon: 'fa-pen',                  color: '#94a3b8', action: () => renameVaultFile(fid) },
                { label: 'Move to…',       icon: 'fa-arrow-right-arrow-left', color: '#94a3b8', action: () => moveVaultFilePicker(fid) },
                { label: 'Export / Share', icon: 'fa-share-alt',            color: '#94a3b8', action: () => vaultShareFile(fid) },
                { separator: true },
                { label: 'Delete',         icon: 'fa-trash', danger: true, action: () => {
                    if (confirm(`Delete "${file.originalName}"? This cannot be undone.`)) deleteVaultFile(fid);
                } },
            ]);
        });
    });

    // ── Drag-to-reorder + drag-file-into-folder ──
    const allCards = [...gridEl.querySelectorAll('.vault-card, .vault-subfolder-card')];
    allCards.forEach(card => {
        card.setAttribute('draggable', 'true');

        card.addEventListener('dragstart', e => {
            vaultDragSrcId   = card.dataset.id || card.dataset.folderId;
            vaultDragSrcType = card.dataset.id ? 'file' : 'folder';
            e.dataTransfer.effectAllowed = 'move';
            e.stopPropagation();
            setTimeout(() => card.classList.add('vault-dragging'), 0);
        });

        card.addEventListener('dragend', () => {
            card.classList.remove('vault-dragging');
            gridEl.querySelectorAll('.vault-drop-before, .vault-drop-after, .vault-folder-drop-target')
                  .forEach(el => el.classList.remove('vault-drop-before', 'vault-drop-after', 'vault-folder-drop-target'));
            vaultDragSrcId   = null;
            vaultDragSrcType = null;
        });

        card.addEventListener('dragover', e => {
            e.preventDefault();
            e.stopPropagation();
            const thisId   = card.dataset.id || card.dataset.folderId;
            const thisType = card.dataset.id ? 'file' : 'folder';

            // Files from outside: a folder card is a target, a file card isn't
            // (those fall through to the folder currently on screen).
            if (!vaultDragSrcId) {
                if (thisType !== 'folder' || !vaultDragHasFiles(e)) return;
                gridEl.querySelectorAll('.vault-drop-before, .vault-drop-after, .vault-folder-drop-target')
                      .forEach(el => el.classList.remove('vault-drop-before', 'vault-drop-after', 'vault-folder-drop-target'));
                card.classList.add('vault-folder-drop-target');
                e.dataTransfer.dropEffect = 'copy';
                return;
            }

            // File or folder dragged over a different folder → drop-into highlight
            if (thisType === 'folder' && vaultDragSrcId !== thisId) {
                if (vaultDragSrcType === 'folder') {
                    const desc = vaultDescendantIds(vaultDragSrcId);
                    if (desc.includes(thisId)) return; // would create a cycle
                }
                gridEl.querySelectorAll('.vault-drop-before, .vault-drop-after, .vault-folder-drop-target')
                      .forEach(el => el.classList.remove('vault-drop-before', 'vault-drop-after', 'vault-folder-drop-target'));
                card.classList.add('vault-folder-drop-target');
                e.dataTransfer.dropEffect = 'move';
                return;
            }

            // Same-type reorder
            if (thisId === vaultDragSrcId || thisType !== vaultDragSrcType) return;
            gridEl.querySelectorAll('.vault-drop-before, .vault-drop-after, .vault-folder-drop-target')
                  .forEach(el => el.classList.remove('vault-drop-before', 'vault-drop-after', 'vault-folder-drop-target'));
            const rect   = card.getBoundingClientRect();
            const before = e.clientX < rect.left + rect.width / 2;
            card.classList.add(before ? 'vault-drop-before' : 'vault-drop-after');
            e.dataTransfer.dropEffect = 'move';
        });

        card.addEventListener('dragleave', e => {
            // Only clear if we're truly leaving this card (not moving to a child element)
            if (!card.contains(e.relatedTarget)) {
                card.classList.remove('vault-drop-before', 'vault-drop-after', 'vault-folder-drop-target');
            }
        });

        card.addEventListener('drop', e => {
            e.preventDefault();
            e.stopPropagation();
            const thisId   = card.dataset.id || card.dataset.folderId;
            const thisType = card.dataset.id ? 'file' : 'folder';
            card.classList.remove('vault-drop-before', 'vault-drop-after', 'vault-folder-drop-target');

            // Dropped in from outside: into this folder if it's a folder card,
            // otherwise into the folder the grid is showing.
            if (!vaultDragSrcId) {
                vaultDropExternalFiles(e, thisType === 'folder' ? thisId : vaultActiveFolderId);
                return;
            }

            // ── Drop folder INTO another folder ──
            if (vaultDragSrcType === 'folder' && thisType === 'folder' && vaultDragSrcId !== thisId) {
                const desc = vaultDescendantIds(vaultDragSrcId);
                if (desc.includes(thisId)) return; // cycle guard
                const folder = vaultData.folders.find(f => f.id === vaultDragSrcId);
                if (!folder || folder.parentId === thisId) return;
                folder.parentId = thisId;
                vaultExpandedFolders.add(thisId);
                saveVaultData();
                renderVaultFolders();
                renderVaultGrid();
                _vaultShowMoveToast(folder.name, vaultData.folders.find(f => f.id === thisId)?.name);
                return;
            }

            // ── Drop file INTO a folder ──
            if (vaultDragSrcType === 'file' && thisType === 'folder') {
                const file = vaultData.files.find(f => f.id === vaultDragSrcId);
                if (!file) return;
                file.folderId = thisId;
                saveVaultData();
                renderVaultFolders();
                renderVaultGrid();
                _vaultShowMoveToast(file.originalName, vaultData.folders.find(f => f.id === thisId)?.name);
                return;
            }

            // ── Same-type reorder ──
            if (thisId === vaultDragSrcId || thisType !== vaultDragSrcType) return;
            const rect   = card.getBoundingClientRect();
            const before = e.clientX < rect.left + rect.width / 2;
            const arr    = thisType === 'file' ? vaultData.files : vaultData.folders;
            vaultReorderItem(arr, vaultDragSrcId, thisId, before);
            // Switch to custom sort so the new order is preserved
            vaultSortOrder = 'custom';
            vaultData.sortOrder = 'custom';
            const sel = document.getElementById('vault-sort-select');
            if (sel) sel.value = 'custom';
            saveVaultData();
            renderVaultFolders();
            renderVaultGrid();
        });
    });

    // A file revealed from outside the Vault (downloads bar) may have been added
    // while this grid was hidden — flash it once its card actually exists.
    if (_vaultHighlightId) _vaultFlashCard(_vaultHighlightId);
}

// ── New / sub folder modal ─────────────────────────────────────────
function openVaultFolderModal(parentId) {
    vaultNewFolderParent = parentId || null;
    vaultNewFolderColor  = pickFolderColor();

    const modal    = document.getElementById('vault-folder-modal');
    const input    = document.getElementById('vault-folder-name-input');
    const titleEl  = document.getElementById('vault-folder-modal-title');

    if (titleEl) {
        if (parentId) {
            const parent = vaultData.folders.find(f => f.id === parentId);
            titleEl.textContent = `New Folder in "${parent ? parent.name : '…'}"`;
        } else {
            titleEl.textContent = 'New Folder';
        }
    }
    if (modal) modal.classList.add('open');
    if (input) { input.value = ''; input.focus(); }
    renderVaultFolderColorPicker();
}

function renderVaultFolderColorPicker() {
    const el = document.getElementById('vault-folder-color-picker');
    if (!el) return;
    el.innerHTML = VAULT_FOLDER_COLORS.map(hex =>
        `<button class="w-6 h-6 rounded-full transition-all border-2 ${
            vaultNewFolderColor === hex ? 'border-white scale-110' : 'border-transparent'
        }" style="background:${hex}" data-color="${hex}"></button>`
    ).join('');
    el.querySelectorAll('button').forEach(btn => {
        btn.onclick = () => { vaultNewFolderColor = btn.dataset.color; renderVaultFolderColorPicker(); };
    });
}

function createVaultFolder() {
    const input = document.getElementById('vault-folder-name-input');
    const name  = input ? input.value.trim() : '';
    if (!name) return;
    const newFolder = { id: 'vd_' + Date.now(), name, color: vaultNewFolderColor, parentId: vaultNewFolderParent };
    vaultData.folders.push(newFolder);
    // Auto-expand parent in sidebar
    if (vaultNewFolderParent) vaultExpandedFolders.add(vaultNewFolderParent);
    saveVaultData();
    document.getElementById('vault-folder-modal').classList.remove('open');
    renderVaultFolders();
    renderVaultGrid();
}

// ── Right-click context menu ────────────────────────────────────────
let _vaultCtxMenuEl = null;

function _closeVaultCtxMenu() {
    if (_vaultCtxMenuEl) { _vaultCtxMenuEl.remove(); _vaultCtxMenuEl = null; }
    document.removeEventListener('click', _closeVaultCtxMenu);
    document.removeEventListener('scroll', _closeVaultCtxMenu, true);
    window.removeEventListener('blur', _closeVaultCtxMenu);
}

// items: [{ label, icon, color?, danger?, action }] or { separator: true }
function openVaultContextMenu(x, y, items) {
    _closeVaultCtxMenu();
    const menu = document.createElement('div');
    menu.className = 'vault-ctx-menu';
    menu.style.cssText =
        'position:fixed;z-index:9999;min-width:200px;padding:6px;border-radius:12px;' +
        'background:#0f172a;border:1px solid rgba(148,163,184,0.18);' +
        'box-shadow:0 12px 36px rgba(0,0,0,0.55);font-size:12px;user-select:none;';

    items.forEach(it => {
        if (it.separator) {
            const sep = document.createElement('div');
            sep.style.cssText = 'height:1px;margin:5px 6px;background:rgba(148,163,184,0.15);';
            menu.appendChild(sep);
            return;
        }
        const btn = document.createElement('button');
        btn.style.cssText =
            'display:flex;align-items:center;gap:10px;width:100%;text-align:left;' +
            'padding:7px 10px;border-radius:8px;background:transparent;border:none;cursor:pointer;' +
            'transition:background .12s;color:' + (it.danger ? '#f87171' : '#e2e8f0') + ';';
        const iconColor = it.color || (it.danger ? '#f87171' : '#94a3b8');
        btn.innerHTML =
            '<i class="fas ' + it.icon + '" style="width:14px;text-align:center;color:' + iconColor + '"></i>' +
            '<span>' + it.label + '</span>';
        btn.onmouseenter = () => btn.style.background = it.danger ? 'rgba(248,113,113,0.12)' : 'rgba(148,163,184,0.12)';
        btn.onmouseleave = () => btn.style.background = 'transparent';
        btn.onclick = e => { e.stopPropagation(); _closeVaultCtxMenu(); it.action(); };
        menu.appendChild(btn);
    });

    document.body.appendChild(menu);

    // Keep the menu on screen
    const rect = menu.getBoundingClientRect();
    const px = Math.min(x, window.innerWidth  - rect.width  - 8);
    const py = Math.min(y, window.innerHeight - rect.height - 8);
    menu.style.left = Math.max(8, px) + 'px';
    menu.style.top  = Math.max(8, py) + 'px';
    _vaultCtxMenuEl = menu;

    // Dismiss on next click / scroll / focus loss
    setTimeout(() => {
        document.addEventListener('click', _closeVaultCtxMenu);
        document.addEventListener('scroll', _closeVaultCtxMenu, true);
        window.addEventListener('blur', _closeVaultCtxMenu);
    }, 0);
}

async function renameVaultFolder(id) {
    const folder = vaultData.folders.find(f => f.id === id);
    if (!folder) return;
    const name = await vulsorPrompt('Rename folder', folder.name, { confirmLabel: 'Rename' });
    if (name == null) return;
    const trimmed = name.trim();
    if (!trimmed || trimmed === folder.name) return;
    folder.name = trimmed;
    saveVaultData();
    renderVaultFolders();
    renderVaultGrid();
}

function deleteVaultFolder(id) {
    const name = vaultData.folders.find(f => f.id === id)?.name;
    if (!confirm(`Delete folder "${name}" and all its subfolders?\nFiles will be moved to All Files.`)) return;
    const ids = vaultDescendantIds(id);
    vaultData.files.forEach(f => { if (ids.includes(f.folderId)) f.folderId = null; });
    vaultData.folders = vaultData.folders.filter(f => !ids.includes(f.id));
    if (ids.includes(vaultActiveFolderId)) vaultActiveFolderId = null;
    ids.forEach(i => vaultExpandedFolders.delete(i));
    saveVaultData();
    renderVaultFolders();
    renderVaultGrid();
}

// Picker menu: move a folder into another folder (or out to the root)
// ── Folder navigator ────────────────────────────────────────────────
// Replaces the old flat "every folder in the vault, indented" menu. That listed the
// whole tree at once, which stops being navigable as soon as there are more than a
// handful of folders. This walks one level at a time: the main folders first, tap a
// row to go deeper, breadcrumb or Up to come back, then confirm with the button at
// the bottom — which always refers to the folder you're currently standing in.
//
// Names are set with textContent rather than interpolated into innerHTML, so a
// folder called `<img onerror=…>` stays a folder name instead of running.
//
// opts:
//   title         heading, e.g. 'Move 3 files'
//   confirmLabel  button verb, default 'Move here'
//   currentId     where the item lives now (null = root). That folder gets marked and
//                 the button goes quiet while you're standing in it.
//   blocked       Set of folder ids that can't be entered or chosen — a folder being
//                 moved plus its descendants, since dropping a branch inside itself
//                 would cut it off from the tree.
//   onPick(id)    called with the chosen folder id (null = All Files)
function vaultFolderNavigator(opts) {
    const o           = opts || {};
    const blocked     = o.blocked || new Set();
    const hasCurrent  = o.currentId !== undefined;
    const currentId   = o.currentId || null;
    const confirmVerb = o.confirmLabel || 'Move here';
    let hereId        = null;                  // start at the top — show the main folders

    // The picker is also opened from outside the Vault (the browser's downloads
    // bar). #view-vault is display:none unless it's the active view, so hosting
    // there would render an invisible modal — fall back to <body>, where the
    // backdrop has to be fixed rather than absolute to cover the window.
    const vaultView = document.getElementById('view-vault');
    const inVault   = !!(vaultView && vaultView.classList.contains('active'));
    const host      = inVault ? vaultView : document.body;
    const back = document.createElement('div');
    back.className = 'vault-modal-backdrop open';
    if (!inVault) { back.style.position = 'fixed'; back.style.zIndex = '2000'; }
    back.innerHTML = `
        <div class="vault-modal-box" style="width:430px;max-width:92%">
            <div class="flex items-center justify-between px-5 py-4 border-b border-slate-800">
                <div class="flex items-center gap-2 min-w-0">
                    <i class="fas fa-folder-tree text-red-500 text-sm"></i>
                    <h2 data-vfn="title" class="font-semibold text-white text-sm truncate"></h2>
                </div>
                <button data-vfn="cancel" class="text-slate-500 hover:text-white w-7 h-7 flex items-center justify-center rounded-lg hover:bg-slate-800 transition-colors">
                    <i class="fas fa-times text-xs"></i>
                </button>
            </div>
            <div data-vfn="crumbs" class="px-5 pt-3 pb-1 flex items-center gap-1 flex-wrap text-[11px]"></div>
            <div data-vfn="list" class="px-3 pb-3 pt-1 flex flex-col gap-1" style="max-height:320px;overflow-y:auto"></div>
            <div class="border-t border-slate-800 px-5 py-4 flex items-center gap-2">
                <button data-vfn="up" class="w-9 h-9 shrink-0 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700/60 text-slate-300 disabled:opacity-30 disabled:pointer-events-none transition-colors" title="Up one level">
                    <i class="fas fa-arrow-turn-up text-xs"></i>
                </button>
                <button data-vfn="confirm" class="flex-1 bg-red-600 hover:bg-red-700 disabled:bg-slate-700 disabled:text-slate-500 disabled:pointer-events-none text-white text-sm font-medium py-2.5 rounded-xl transition-colors"></button>
            </div>
        </div>`;
    host.appendChild(back);

    const q        = sel => back.querySelector(`[data-vfn="${sel}"]`);
    const crumbsEl = q('crumbs'), listEl = q('list'), upBtn = q('up'), okBtn = q('confirm');
    q('title').textContent = o.title || 'Choose a folder';

    const kids      = id => vaultData.folders.filter(f => (f.parentId || null) === id);
    const fileCount = id => vaultData.files.filter(f => (f.folderId || null) === id).length;
    const close = () => { document.removeEventListener('keydown', onKey); back.remove(); };

    function draw() {
        // Breadcrumb — every level is clickable, so getting back out is one tap.
        crumbsEl.innerHTML = '';
        vaultBreadcrumb(hereId).forEach((c, i, arr) => {
            if (i) {
                const sep = document.createElement('span');
                sep.className = 'text-slate-600';
                sep.textContent = '/';
                crumbsEl.appendChild(sep);
            }
            const b = document.createElement('button');
            b.className = i === arr.length - 1
                ? 'text-slate-200 font-semibold'
                : 'text-slate-400 hover:text-slate-200 transition-colors';
            b.textContent = c.name;
            b.onclick = () => { hereId = c.id; draw(); };
            crumbsEl.appendChild(b);
        });

        // Folders at this level
        listEl.innerHTML = '';
        const here = kids(hereId);
        if (!here.length) {
            const empty = document.createElement('p');
            empty.className = 'text-slate-500 text-xs text-center py-7 px-4 leading-relaxed';
            empty.textContent = hereId
                ? 'Nothing inside this one — use the button below to put it here.'
                : 'No folders yet. The button below puts it in All Files.';
            listEl.appendChild(empty);
        }
        here.forEach(f => {
            const off  = blocked.has(f.id);
            const subs = kids(f.id).length, files = fileCount(f.id);
            const row  = document.createElement('button');
            row.className = 'flex items-center gap-3 w-full text-left px-3 py-2.5 rounded-xl transition-colors ' +
                (off ? 'opacity-40 pointer-events-none' : 'hover:bg-slate-800');

            const icon = document.createElement('i');
            icon.className = 'fas ' + (off ? 'fa-ban' : 'fa-folder') + ' text-sm shrink-0';
            icon.style.color = off ? '#64748b' : (f.color || '#94a3b8');

            const mid  = document.createElement('span');
            mid.className = 'flex-1 min-w-0';
            const name = document.createElement('span');
            name.className = 'block text-slate-100 text-sm truncate';
            name.textContent = f.name;
            const meta = document.createElement('span');
            meta.className = 'block text-[10px] text-slate-500';
            meta.textContent = [
                subs  ? subs  + (subs  === 1 ? ' folder' : ' folders') : '',
                files ? files + (files === 1 ? ' file'   : ' files')   : '',
            ].filter(Boolean).join(' · ') || 'empty';
            mid.append(name, meta);

            row.append(icon, mid);
            if (hasCurrent && f.id === currentId) {
                const badge = document.createElement('span');
                badge.className = 'text-[10px] text-emerald-400 shrink-0';
                badge.textContent = 'here now';
                row.appendChild(badge);
            }
            const chev = document.createElement('i');
            chev.className = 'fas fa-chevron-right text-slate-600 text-[10px] shrink-0';
            row.appendChild(chev);

            if (off) row.title = "Can't move a folder inside itself";
            row.onclick = () => { hereId = f.id; draw(); };
            listEl.appendChild(row);
        });

        // The button always names where you're standing, so there's no doubt where it lands.
        const hereName  = hereId ? (vaultData.folders.find(f => f.id === hereId)?.name || 'this folder') : 'All Files';
        const isCurrent = hasCurrent && hereId === currentId;
        const isBlocked = hereId !== null && blocked.has(hereId);
        upBtn.disabled  = hereId === null;
        okBtn.disabled  = isCurrent || isBlocked;
        okBtn.innerHTML = '';
        if (isCurrent) {
            okBtn.textContent = 'Already in ' + hereName;
        } else if (isBlocked) {
            okBtn.textContent = "Can't move it in here";
        } else {
            const ic = document.createElement('i');
            ic.className = 'fas fa-arrow-down mr-2';
            const tx = document.createElement('span');
            tx.textContent = confirmVerb + ' — ' + hereName;
            okBtn.append(ic, tx);
        }
    }

    function goUp() {
        const f = vaultData.folders.find(x => x.id === hereId);
        hereId = f ? (f.parentId || null) : null;
        draw();
    }
    function commit() {
        const dest = hereId;
        close();
        if (typeof o.onPick === 'function') o.onPick(dest);
    }
    function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); close(); return; }
        if (e.key === 'Enter' && !okBtn.disabled) { e.preventDefault(); commit(); return; }
        if (e.key === 'Backspace' && hereId !== null) { e.preventDefault(); goUp(); }
    }

    upBtn.onclick       = goUp;
    okBtn.onclick       = commit;
    q('cancel').onclick = close;
    back.onclick = e => { if (e.target === back) close(); };   // click the dim area to bail
    document.addEventListener('keydown', onKey);
    draw();
}

function moveVaultFolderPicker(id) {
    const folder = vaultData.folders.find(f => f.id === id);
    if (!folder) return;
    vaultFolderNavigator({
        title:        'Move folder “' + folder.name + '”',
        confirmLabel: 'Move here',
        currentId:    folder.parentId || null,
        // vaultDescendantIds includes the folder itself, which is exactly the set
        // that must stay off-limits as a destination.
        blocked:      new Set(vaultDescendantIds(id)),
        onPick:       destId => _applyFolderMove(folder, destId),
    });
}

function _applyFolderMove(folder, destId) {
    destId = destId || null;
    if (folder.parentId === destId) return;
    if (destId && vaultDescendantIds(folder.id).includes(destId)) return; // safety: never create a cycle
    folder.parentId = destId;
    if (destId) vaultExpandedFolders.add(destId);
    saveVaultData();
    renderVaultFolders();
    renderVaultGrid();
    _vaultShowMoveToast(folder.name, destId ? vaultData.folders.find(f => f.id === destId)?.name : 'All Files');
}

// Add files via the file picker / drop, asking first where they should go.
// Skips the prompt when there are no folders (nowhere else to put them).
//
// opts.startFolderId  where the picker's default lands when there are no folders
//                     to choose from (defaults to the folder on screen)
// opts.title          override the heading, e.g. for a finished download
// opts.onDone(res)    called with addFilesToVault's result once files land, and
//                     NOT called if the user cancels the picker
function vaultAddFilesWithDestination(paths, opts) {
    if (!paths || !paths.length) return;
    const o     = opts || {};
    const start = o.startFolderId !== undefined ? o.startFolderId : vaultActiveFolderId;
    const done  = res => { if (typeof o.onDone === 'function') o.onDone(res); };
    if (!vaultData.folders.length) { done(addFilesToVault(paths, start)); return; }
    const many = paths.length > 1;
    vaultFolderNavigator({
        title:        o.title || (many ? 'Put ' + paths.length + ' files in…' : 'Put this file in…'),
        confirmLabel: many ? 'Put them here' : 'Put it here',
        onPick:       folderId => done(addFilesToVault(paths, folderId)),
    });
}

// Jump to a file in the Vault and flash its card, from anywhere in the app.
// Used by the browser's downloads bar so "saved to the Vault" is something you
// can actually see rather than something you have to go hunting for.
let _vaultHighlightId = null;
function vaultRevealFile(fileId) {
    const file = vaultData.files.find(f => f.id === fileId);
    if (!file) return;
    _vaultHighlightId = fileId;
    if (typeof window.appOpenVaultAt === 'function') {
        window.appOpenVaultAt(file.folderId || null);
    } else {
        setVaultFolder(file.folderId || null);
    }
    _vaultFlashCard(fileId);
}

// Scroll a freshly-added card into view and pulse it. Called after every grid
// render so it still works when the render happens a tick later (tab switch).
function _vaultFlashCard(fileId) {
    if (!fileId) return;
    const grid = document.getElementById('vault-files-grid');
    const card = grid && grid.querySelector(`.vault-card[data-id="${fileId}"]`);
    if (!card) return;
    _vaultHighlightId = null;
    try { card.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch(_) { card.scrollIntoView(); }
    card.classList.remove('vault-card-flash');
    void card.offsetWidth;               // restart the animation on a repeat reveal
    card.classList.add('vault-card-flash');
    setTimeout(() => card.classList.remove('vault-card-flash'), 2000);
}

// Rename a file's display name. The on-disk stored name (id-based) is left
// untouched, so this is pure metadata. The original extension is preserved
// when the user doesn't type one, to keep file-type detection intact.
async function renameVaultFile(id) {
    const file = vaultData.files.find(f => f.id === id);
    if (!file) return;
    const cur    = file.originalName || '';
    const dot    = cur.lastIndexOf('.');
    const hasExt = dot > 0;
    const ext    = hasExt ? cur.slice(dot) : '';
    const base   = hasExt ? cur.slice(0, dot) : cur;

    const input = await vulsorPrompt('Rename file', base, { confirmLabel: 'Rename', hint: 'The extension is kept automatically.' });
    if (input == null) return;
    const trimmed = input.trim();
    if (!trimmed) return;

    let newName = trimmed;
    if (hasExt && !/\.[^.]+$/.test(trimmed)) newName += ext; // re-append original extension
    if (newName === cur) return;

    file.originalName = newName;
    file.updatedAt    = Date.now();
    saveVaultData();
    renderVaultFolders();
    renderVaultGrid();

    // Keep an open viewer/editor title in sync
    if (vaultOpenFileId === id) {
        const titleEl = document.getElementById('vault-viewer-title');
        if (titleEl) titleEl.textContent = newName;
        const docTitle = document.getElementById('vault-doc-title-input');
        if (docTitle && !docTitle.classList.contains('hidden')) docTitle.value = newName;
    }
}

// Move a file into another folder (or back out to the root)
function moveVaultFilePicker(id) {
    const file = vaultData.files.find(f => f.id === id);
    if (!file) return;
    vaultFolderNavigator({
        title:        'Move “' + (file.originalName || 'file') + '”',
        confirmLabel: 'Move here',
        currentId:    file.folderId || null,
        onPick:       destId => _applyFileMove(file, destId),
    });
}

function _applyFileMove(file, destId) {
    destId = destId || null;
    if (file.folderId === destId) return;
    file.folderId = destId;
    if (destId) vaultExpandedFolders.add(destId);
    saveVaultData();
    renderVaultFolders();
    renderVaultGrid();
    _vaultShowMoveToast(file.originalName, destId ? vaultData.folders.find(f => f.id === destId)?.name : 'All Files');
}

// Menu shown when right-clicking empty vault space
function openVaultBackgroundMenu(x, y) {
    openVaultContextMenu(x, y, [
        { label: 'New Folder',   icon: 'fa-folder-plus', color: '#3b82f6', action: () => openVaultFolderModal(vaultActiveFolderId) },
        { label: 'New Document', icon: 'fa-file-lines',  color: '#22c55e', action: () => createVaultDoc() },
        { label: 'New Custom Note', icon: 'fa-note-sticky', color: '#eab308', action: () => createVaultCustomNote() },
        { label: 'New Project',  icon: 'fa-hammer',      color: '#f97316', action: () => openStudioEditor() },
        { label: 'Add Website…', icon: 'fa-globe',       color: '#60a5fa', action: () => openVaultWebsiteModal() },
        { separator: true },
        { label: 'Add File…',    icon: 'fa-upload',      color: '#94a3b8', action: () => document.getElementById('vault-file-input').click() },
    ]);
}

// ── Init ───────────────────────────────────────────────────────────
function initVault() {
    vaultData = loadVaultData();
    vaultRepairStoredNames();
    try { _vaultFileMtime = fs.statSync(VAULT_FILE).mtimeMs; } catch(_) {}

    // ── Multi-window sync ──
    // Another window saved the vault → reload our copy from disk.
    ipcRenderer.on('vault-reload', vaultSyncFromDisk);
    // Safety net for changes made while this window was backgrounded.
    window.addEventListener('focus', vaultSyncFromDisk);
    // Claude (via server/vault-mcp.js) writes the same index — watch for it.
    vaultStartWatching();

    // Flush pending debounced saves when the window closes — otherwise
    // edits made in the last ~800ms before closing are silently lost.
    window.addEventListener('beforeunload', () => {
        vaultStopWatching();
        if (vaultIsDoc) {
            clearTimeout(vaultDocSaveTimer);
            try { saveCurrentVaultDoc(); } catch(e) { console.error('[unload] doc save:', e); }
        }
        if (vaultIsMd && vaultMdEditMode) {
            clearTimeout(vaultMdSaveTimer);
            try { _saveVaultMdContent(); } catch(e) { console.error('[unload] md save:', e); }
        }
        if (vaultNotesTimer) {
            clearTimeout(vaultNotesTimer);
            const notesInput = document.getElementById('vault-notes-input');
            if (notesInput && vaultOpenFileId) {
                try { saveNoteForCurrentPage(notesInput.value); } catch(e) { console.error('[unload] note save:', e); }
            }
            vaultNotesTimer = null;
        }
    });
    // Restore saved sort preference
    if (vaultData.sortOrder) {
        vaultSortOrder = vaultData.sortOrder;
        const sel = document.getElementById('vault-sort-select');
        if (sel) sel.value = vaultSortOrder;
    }

    // ── New doc button ──
    document.getElementById('vault-new-doc-btn').onclick = createVaultDoc;

    // ── New custom note button ──
    document.getElementById('vault-new-note-btn')?.addEventListener('click', createVaultCustomNote);

    // ── Website link button + modal ──
    const webBtn = document.getElementById('vault-new-website-btn');
    if (webBtn) webBtn.onclick = openVaultWebsiteModal;
    document.getElementById('vault-website-modal-cancel')?.addEventListener('click', () =>
        document.getElementById('vault-website-modal')?.classList.remove('open'));
    document.getElementById('vault-website-modal-save')?.addEventListener('click', createVaultWebsite);
    ['vault-website-url-input', 'vault-website-name-input'].forEach(eid =>
        document.getElementById(eid)?.addEventListener('keydown', e => { if (e.key === 'Enter') createVaultWebsite(); }));

    // ── Import .docx (Word / Google Docs export) ──
    const importDocxBtn = document.getElementById('vault-import-docx-btn');
    const docxInput     = document.getElementById('vault-docx-input');
    if (importDocxBtn && docxInput) {
        importDocxBtn.onclick = () => docxInput.click();
        docxInput.onchange = e => {
            const paths = Array.from(e.target.files).map(vaultFilePath).filter(Boolean);
            e.target.value = '';
            if (!paths.length) return;
            if (!vaultData.folders.length) { vaultImportDocxFiles(paths, vaultActiveFolderId); return; }
            const many = paths.length > 1;
            vaultFolderNavigator({
                title:        many ? 'Import ' + paths.length + ' documents into…' : 'Import this document into…',
                confirmLabel: many ? 'Import them here' : 'Import it here',
                onPick:       folderId => vaultImportDocxFiles(paths, folderId),
            });
        };
    }

    // ── New menu (everything that creates a file lives here) ──
    // The items are the same buttons other modules bind by id — code.js,
    // notebook.js and science.js each own their own click handler — so this
    // only opens and closes the menu.
    const newBtn  = document.getElementById('vault-new-btn');
    const newMenu = document.getElementById('vault-new-menu');
    if (newBtn && newMenu) {
        const closeMenu = () => {
            newMenu.classList.add('hidden');
            newBtn.setAttribute('aria-expanded', 'false');
        };
        newBtn.onclick = e => {
            e.stopPropagation();
            const open = newMenu.classList.toggle('hidden') === false;
            newBtn.setAttribute('aria-expanded', String(open));
        };
        // Picking an item runs its own handler, then the menu gets out of the way
        newMenu.querySelectorAll('.vault-menu-item').forEach(item => item.addEventListener('click', closeMenu));
        document.addEventListener('click', e => {
            if (!newMenu.contains(e.target) && !newBtn.contains(e.target)) closeMenu();
        });
        document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });
    }

    // ── Project (code workspace) — a New-menu item now, not a dropdown ──
    const projBtn = document.getElementById('vault-new-project-btn');
    if (projBtn) projBtn.onclick = () => openStudioEditor();

    // ── Doc title input ──
    const docTitleInput = document.getElementById('vault-doc-title-input');
    docTitleInput.addEventListener('blur', saveVaultDocTitle);
    docTitleInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); docTitleInput.blur(); }
    });

    // ── File add ──
    document.getElementById('vault-add-btn').onclick = () =>
        document.getElementById('vault-file-input').click();
    document.getElementById('vault-file-input').onchange = e => {
        const paths = Array.from(e.target.files).map(vaultFilePath).filter(Boolean);
        e.target.value = '';
        if (!paths.length) return;
        vaultAddFilesWithDestination(paths);
    };

    // ── Right-click empty grid space → background context menu ──
    const ctxDropZone = document.getElementById('vault-drop-zone');
    if (ctxDropZone) {
        ctxDropZone.addEventListener('contextmenu', e => {
            // Card right-clicks are handled per-card (they stop propagation)
            if (e.target.closest('.vault-card, .vault-subfolder-card')) return;
            e.preventDefault();
            openVaultBackgroundMenu(e.clientX, e.clientY);
        });
    }

    // ── Search ──
    document.getElementById('vault-search').oninput = e => {
        vaultSearchQuery = e.target.value.trim();
        renderVaultGrid();
    };

    // ── Sort ──
    document.getElementById('vault-sort-select').onchange = e => {
        vaultSortOrder = e.target.value;
        vaultData.sortOrder = vaultSortOrder;
        saveVaultData();
        renderVaultGrid();
    };

    // ── Sidebar ──
    document.getElementById('vault-all-btn').onclick = () => setVaultFolder(null);
    document.getElementById('vault-new-folder-btn').onclick = () =>
        openVaultFolderModal(vaultActiveFolderId);
    document.getElementById('vault-new-doc-sidebar-btn').onclick = createVaultDoc;

    // ── Storage path indicator ──
    const pathEl = document.getElementById('vault-storage-path');
    if (pathEl) pathEl.textContent = VAULT_DIR;

    // ── Folder modal ──
    document.getElementById('vault-folder-modal-save').onclick   = createVaultFolder;
    document.getElementById('vault-folder-modal-cancel').onclick = () =>
        document.getElementById('vault-folder-modal').classList.remove('open');
    document.getElementById('vault-folder-name-input').onkeypress = e => {
        if (e.key === 'Enter') createVaultFolder();
    };

    // ── Viewer back ──
    document.getElementById('vault-back-btn').onclick = closeVaultViewer;

    // ── Folder select (move file) ──
    document.getElementById('vault-viewer-folder-select').onchange = e => {
        const file = vaultData.files.find(f => f.id === vaultOpenFileId);
        if (file) {
            file.folderId = e.target.value || null;
            saveVaultData();
            renderVaultFolders();
            // Update visibility of the go-to-folder button
            const btn = document.getElementById('vault-goto-folder-btn');
            if (btn) btn.style.display = file.folderId ? '' : 'none';
        }
    };

    // ── Notes textarea (auto-save) ──
    document.getElementById('vault-notes-input').oninput = e => {
        clearTimeout(vaultNotesTimer);
        vaultNotesTimer = setTimeout(() => saveNoteForCurrentPage(e.target.value), 400);
    };

    // ── Notes tab buttons ──
    document.getElementById('vault-notes-tab-page').onclick = () => setNotesTab('page');
    document.getElementById('vault-notes-tab-all').onclick  = () => setNotesTab('all');

    // ── PDF controls ──
    document.getElementById('vault-pdf-prev').onclick = () => {
        if (pdfViewMode === 'book') {
            const prev = pdfPageNum === 1 ? null : (pdfPageNum === 2 ? 1 : pdfPageNum - 2);
            if (prev !== null) { pdfPageNum = prev; buildPDFBookView(); }
        } else if (pdfViewMode === 'single') {
            if (pdfPageNum > 1) { pdfPageNum--; buildPDFSingleView(); }
        } else {
            if (pdfPageNum > 1) scrollToPage(pdfPageNum - 1);
        }
    };
    document.getElementById('vault-pdf-next').onclick = () => {
        if (pdfViewMode === 'book') {
            const next = pdfPageNum === 1 ? 2 : pdfPageNum + 2;
            if (next <= pdfTotalPages) { pdfPageNum = next; buildPDFBookView(); }
        } else if (pdfViewMode === 'single') {
            if (pdfPageNum < pdfTotalPages) { pdfPageNum++; buildPDFSingleView(); }
        } else {
            if (pdfPageNum < pdfTotalPages) scrollToPage(pdfPageNum + 1);
        }
    };
    document.getElementById('vault-pdf-zoom-out').onclick = () => {
        pdfScale = Math.max(0.3, pdfScale - 0.15);
        reRenderAllPages();
    };
    document.getElementById('vault-pdf-zoom-in').onclick = () => {
        pdfScale = Math.min(4.0, pdfScale + 0.15);
        reRenderAllPages();
    };
    document.getElementById('vault-pdf-fit').onclick = fitVaultPDFToWidth;
    document.getElementById('vault-pdf-fullscreen').onclick = enterPDFFullscreen;

    // ── PDF Fullscreen overlay ──
    function syncFSControls() {
        document.getElementById('vault-pdf-fs-page-info').textContent  = `${pdfPageNum} / ${pdfTotalPages}`;
        document.getElementById('vault-pdf-fs-zoom-label').textContent = Math.round(pdfScale * 100) + '%';
        document.getElementById('vault-pdf-fs-prev').disabled = pdfPageNum <= 1;
        document.getElementById('vault-pdf-fs-next').disabled = pdfPageNum >= pdfTotalPages;
    }

    function fitFSWidth() {
        if (!pdfDoc) return;
        pdfDoc.getPage(1).then(page => {
            const scrollEl = document.getElementById('vault-pdf-fs-scroll');
            const available = scrollEl.clientWidth - 48;
            const vp0 = page.getViewport({ scale: 1 });
            pdfScale = Math.max(0.3, available / vp0.width);
            if (pdfViewMode === 'single') buildPDFSingleView();
            else if (pdfViewMode === 'book') buildPDFBookView();
            else buildPDFScrollView(true);
            syncFSControls();
        });
    }

    function enterPDFFullscreen() {
        const overlay = document.getElementById('vault-pdf-fullscreen-overlay');
        overlay.style.display = 'flex';
        pdfFullscreen = true;
        // Rebuild in the fullscreen container so lazy observers bind to it
        fitFSWidth();
        syncFSControls();
    }

    function exitPDFFullscreen() {
        const overlay = document.getElementById('vault-pdf-fullscreen-overlay');
        overlay.style.display = 'none';
        pdfFullscreen = false;
        // Rebuild in the normal container
        if (pdfViewMode === 'single') buildPDFSingleView();
        else if (pdfViewMode === 'book') buildPDFBookView();
        else fitVaultPDFToWidth();
    }

    // ── Image / text zoom controls ──
    document.getElementById('vault-img-zoom-out').onclick = () => {
        imgZoom = Math.max(0.2, parseFloat((imgZoom - 0.15).toFixed(2)));
        applyImgZoom();
    };
    document.getElementById('vault-img-zoom-in').onclick = () => {
        imgZoom = Math.min(5.0, parseFloat((imgZoom + 0.15).toFixed(2)));
        applyImgZoom();
    };
    document.getElementById('vault-img-reset').onclick = () => {
        imgZoom = 1.0;
        applyImgZoom();
    };

    // ── Trackpad pinch-to-zoom on the main scroll area ──
    // Pinch fires `wheel` with ctrlKey:true on macOS. Use exponential factor for
    // a smooth Preview-style feel, and anchor on cursor position.
    let _pdfReRenderTimer = null;
    document.getElementById('vault-pdf-scroll').addEventListener('wheel', e => {
        if (!e.ctrlKey) return;
        e.preventDefault();
        const factor = Math.exp(-e.deltaY * 0.01);
        if (vaultIsPDF) {
            const oldScale = pdfScale;
            pdfScale = Math.max(0.3, Math.min(4.0, pdfScale * factor));
            if (pdfScale === oldScale) return;
            const ratio = pdfScale / oldScale;
            // Anchor the point under the cursor while CSS-scaling pages
            const scrollEl = document.getElementById('vault-pdf-scroll');
            const rect     = scrollEl.getBoundingClientRect();
            const ax = e.clientX - rect.left;
            const ay = e.clientY - rect.top;
            const beforeX = scrollEl.scrollLeft + ax;
            const beforeY = scrollEl.scrollTop  + ay;
            // Text layers are positioned in absolute px — drop them during the
            // pinch and let the debounced re-render rebuild them at the new scale.
            document.querySelectorAll('.pdf-text-layer').forEach(l => l.remove());
            // Cheap CSS resize for instant visual feedback (canvas pixel data stays,
            // browser interpolates — sharp re-render happens on debounce below).
            if (pdfViewMode === 'scroll') {
                // Scale placeholder wrappers (and their canvases) so unrendered
                // pages keep correct layout height during the pinch.
                document.querySelectorAll('#vault-pdf-pages [data-page-num]').forEach(w => {
                    const curW = parseFloat(w.style.width)  || pdfPlaceW;
                    const curH = parseFloat(w.style.height) || pdfPlaceH;
                    w.style.width  = (curW * ratio) + 'px';
                    w.style.height = (curH * ratio) + 'px';
                    const c = w.querySelector('canvas');
                    if (c) { c.style.width = '100%'; c.style.height = '100%'; }
                });
                pdfPlaceW *= ratio; pdfPlaceH *= ratio;
            } else {
                document.querySelectorAll('[id^="vault-pdf-page-"]').forEach(c => {
                    const curW = parseFloat(c.style.width)  || c.width;
                    const curH = parseFloat(c.style.height) || c.height;
                    c.style.width  = (curW * ratio) + 'px';
                    c.style.height = (curH * ratio) + 'px';
                });
            }
            scrollEl.scrollLeft = beforeX * ratio - ax;
            scrollEl.scrollTop  = beforeY * ratio - ay;
            updateVaultPDFControls();
            // Debounced sharp re-render after the pinch settles
            clearTimeout(_pdfReRenderTimer);
            _pdfReRenderTimer = setTimeout(() => {
                reRenderAllPages();
            }, 180);
        } else {
            const imgBar = document.getElementById('vault-img-controls');
            if (imgBar && imgBar.style.display !== 'none') {
                const wrap = document.getElementById('vault-img-scroll-wrap');
                let ax = null, ay = null;
                if (wrap) {
                    const rect = wrap.getBoundingClientRect();
                    ax = e.clientX - rect.left;
                    ay = e.clientY - rect.top;
                }
                imgZoom = Math.max(0.2, Math.min(5.0, imgZoom * factor));
                applyImgZoom(ax, ay);
            }
        }
    }, { passive: false });

    document.getElementById('vault-pdf-exit-fullscreen').onclick = exitPDFFullscreen;
    document.getElementById('vault-pdf-fs-prev').onclick = () => { if (pdfPageNum > 1) { scrollToPage(pdfPageNum - 1); syncFSControls(); } };
    document.getElementById('vault-pdf-fs-next').onclick = () => { if (pdfPageNum < pdfTotalPages) { scrollToPage(pdfPageNum + 1); syncFSControls(); } };
    document.getElementById('vault-pdf-fs-zoom-out').onclick = () => { pdfScale = Math.max(0.3, pdfScale - 0.15); reRenderAllPages(); syncFSControls(); };
    document.getElementById('vault-pdf-fs-zoom-in').onclick  = () => { pdfScale = Math.min(4.0, pdfScale + 0.15); reRenderAllPages(); syncFSControls(); };
    document.getElementById('vault-pdf-fs-fit').onclick = fitFSWidth;
    document.getElementById('vault-pdf-goto').onkeypress = e => {
        if (e.key !== 'Enter') return;
        const pg = parseInt(e.target.value);
        if (!isNaN(pg) && pg >= 1 && pg <= pdfTotalPages) gotoPDFPage(pg);
        e.target.value = '';
    };

    // ── Keyboard navigation in viewer ──
    document.addEventListener('keydown', e => {
        if (!vaultOpenFileId) return;
        if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
        if (vaultIsPDF) {
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                e.preventDefault();
                if (pdfViewMode === 'book') {
                    const next = pdfPageNum === 1 ? 2 : pdfPageNum + 2;
                    if (next <= pdfTotalPages) { pdfPageNum = next; buildPDFBookView(); }
                } else if (pdfViewMode === 'single') {
                    if (pdfPageNum < pdfTotalPages) { pdfPageNum++; buildPDFSingleView(); }
                } else {
                    if (pdfPageNum < pdfTotalPages) scrollToPage(pdfPageNum + 1);
                }
            } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                e.preventDefault();
                if (pdfViewMode === 'book') {
                    const prev = pdfPageNum === 1 ? null : (pdfPageNum === 2 ? 1 : pdfPageNum - 2);
                    if (prev !== null) { pdfPageNum = prev; buildPDFBookView(); }
                } else if (pdfViewMode === 'single') {
                    if (pdfPageNum > 1) { pdfPageNum--; buildPDFSingleView(); }
                } else {
                    if (pdfPageNum > 1) scrollToPage(pdfPageNum - 1);
                }
            } else if (e.key === 'Escape') {
                closeVaultViewer();
            }
        } else if (vaultIsPPTX) {
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); pptxGo(1); }
            else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); pptxGo(-1); }
            else if (e.key === 'Escape') closeVaultViewer();
        } else {
            // Image / text zoom via Ctrl/Cmd +/-/0
            if (e.ctrlKey || e.metaKey) {
                if (e.key === '=' || e.key === '+') {
                    e.preventDefault();
                    const imgBar = document.getElementById('vault-img-controls');
                    if (imgBar && imgBar.style.display !== 'none') {
                        imgZoom = Math.min(5.0, parseFloat((imgZoom + 0.15).toFixed(2)));
                        applyImgZoom();
                    }
                } else if (e.key === '-') {
                    e.preventDefault();
                    const imgBar = document.getElementById('vault-img-controls');
                    if (imgBar && imgBar.style.display !== 'none') {
                        imgZoom = Math.max(0.2, parseFloat((imgZoom - 0.15).toFixed(2)));
                        applyImgZoom();
                    }
                } else if (e.key === '0') {
                    const imgBar = document.getElementById('vault-img-controls');
                    if (imgBar && imgBar.style.display !== 'none') {
                        imgZoom = 1.0;
                        applyImgZoom();
                    }
                }
            }
        }
    });

    // ── Panel drag-resize + collapse tabs ──
    const resizer         = document.getElementById('vault-notes-resizer');
    const docsResizer     = document.getElementById('vault-docs-resizer');
    const notesSidebar    = document.getElementById('vault-notes-sidebar');
    const vaultSidebarEl  = document.getElementById('vault-sidebar');
    const toggleDocsBtn   = document.getElementById('vault-toggle-docs-btn');
    const toggleNotesBtn  = document.getElementById('vault-toggle-notes-btn');
    const reopenDocsBtn   = document.getElementById('vault-reopen-docs-btn');
    const reopenNotesBtn  = document.getElementById('vault-reopen-notes-btn');
    const SNAP = 120;

    // deltaSign: +1 means drag-right widens the panel, -1 means drag-left widens it
    function initPanelTab(tabBtn, panelEl, resizerEl, deltaSign, defaultW, reopenBtn) {
        let visible = true;

        function setVisible(v, width) {
            visible = v;
            panelEl.style.display = v ? '' : 'none';
            if (resizerEl) resizerEl.style.display = v ? '' : 'none';
            tabBtn.classList.toggle('active', v);
            reopenBtn.style.display = v ? 'none' : '';
            if (v && width != null) panelEl.style.width = width + 'px';
        }

        tabBtn.addEventListener('mousedown', e => {
            if (e.button !== 0) return;
            e.preventDefault();
            const startX = e.clientX;
            const startW = (visible ? panelEl.offsetWidth : 0) || defaultW;
            let moved = false;

            function onMove(ev) {
                const d = (ev.clientX - startX) * deltaSign;
                if (Math.abs(d) > 4) moved = true;
                if (!moved) return;
                const newW = Math.max(0, Math.min(700, startW + d));
                // Always update width live so the drag feels responsive
                if (!visible && newW > SNAP) {
                    panelEl.style.display = '';
                    if (resizerEl) resizerEl.style.display = '';
                    visible = true;
                    tabBtn.classList.add('active');
                    reopenBtn.style.display = 'none';
                }
                if (visible) panelEl.style.width = newW + 'px';
            }

            function onUp(ev) {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                document.body.classList.remove('vault-resizing');
                if (!moved) {
                    setVisible(!visible, defaultW);
                } else {
                    const finalW = startW + (ev.clientX - startX) * deltaSign;
                    if (finalW <= SNAP) {
                        setVisible(false, null);
                    } else {
                        panelEl.style.width = Math.min(700, Math.max(SNAP + 1, finalW)) + 'px';
                    }
                }
            }

            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
            document.body.classList.add('vault-resizing');
        });

        reopenBtn.addEventListener('click', () => setVisible(true, defaultW));
        return setVisible;
    }

    const setVisibleDocs  = initPanelTab(toggleDocsBtn,  vaultSidebarEl, docsResizer, 1,  208, reopenDocsBtn);
    const setVisibleNotes = initPanelTab(toggleNotesBtn, notesSidebar,   resizer,    -1, 288, reopenNotesBtn);

    // Let openVaultFile collapse the side panels when a document is opened
    window._vaultSetNotesVisible = setVisibleNotes;
    window._vaultSetDocsVisible  = setVisibleDocs;

    // Wire edge resizer strips (drag the panel edge directly to resize/close)
    function initEdgeResizer(resizerEl, panelEl, deltaSign, setVisibleFn, defaultW) {
        if (!resizerEl) return;
        resizerEl.addEventListener('mousedown', e => {
            if (e.button !== 0) return;
            e.preventDefault();
            const startX = e.clientX;
            const startW = panelEl.offsetWidth || defaultW;
            document.body.classList.add('vault-resizing');

            function onMove(ev) {
                const newW = Math.max(0, Math.min(700, startW + (ev.clientX - startX) * deltaSign));
                panelEl.style.width = newW + 'px';
            }
            function onUp(ev) {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                document.body.classList.remove('vault-resizing');
                const finalW = startW + (ev.clientX - startX) * deltaSign;
                if (finalW <= SNAP) {
                    setVisibleFn(false, null);
                } else {
                    panelEl.style.width = Math.min(700, Math.max(SNAP + 1, finalW)) + 'px';
                }
            }
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    }

    initEdgeResizer(docsResizer,  vaultSidebarEl, 1,  setVisibleDocs,  208);
    initEdgeResizer(resizer,       notesSidebar,  -1, setVisibleNotes, 288);

    // ── Drag & drop ──
    const dropZone = document.getElementById('vault-drop-zone');
    dropZone.addEventListener('dragover',  e => { e.preventDefault(); dropZone.classList.add('vault-drag-over'); });
    ['dragleave','dragend'].forEach(ev =>
        dropZone.addEventListener(ev, () => dropZone.classList.remove('vault-drag-over'))
    );
    dropZone.addEventListener('drop', e => {
        e.preventDefault();
        dropZone.classList.remove('vault-drag-over');
        // The grid is showing one folder — that's the folder you dropped into.
        vaultDropExternalFiles(e, vaultActiveFolderId);
    });

    // A file dropped somewhere with no drop target of its own must not make
    // Electron navigate the whole window to it. Only file drags are swallowed,
    // so dragging text into an input or the editor still works.
    window.addEventListener('dragover', e => { if (vaultDragHasFiles(e)) e.preventDefault(); });
    window.addEventListener('drop',     e => { if (vaultDragHasFiles(e)) e.preventDefault(); });

    renderVaultFolders();
    renderVaultGrid();

    // Wire rich text editor toolbar
    initVaultDocEditor();

    // Wire code editor (IDE)
    initVaultCodeEditor();

    // Wire notebook
    if (typeof initVaultNotebook === 'function') initVaultNotebook();
}
