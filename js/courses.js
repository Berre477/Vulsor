// ── Courses — learn anything, built from the internet ──────────────
// Depends on: globals.js (fs, path, DOCUMENTS_PATH)
// Type a topic → builds a structured course from Wikipedia's knowledge
// APIs: modules → step-by-step lessons with images, an auto-generated
// quiz, and curated further resources. Progress is tracked per lesson.

const COURSES_FILE = path.join(DOCUMENTS_PATH, 'courses.json');

// ── State ──────────────────────────────────────────────────────────
let coursesData     = { courses: [] };
let crsActiveCourse = null;    // course id open in main pane
let crsActiveLesson = null;    // lesson id open in reader (null = overview)
let crsBuilding     = false;

// ── Persistence ────────────────────────────────────────────────────
function loadCoursesData() {
    try {
        if (fs.existsSync(COURSES_FILE))
            return JSON.parse(fs.readFileSync(COURSES_FILE, 'utf8'));
    } catch (_) {}
    return { courses: [] };
}
function saveCoursesData() {
    try { fs.writeFileSync(COURSES_FILE, JSON.stringify(coursesData, null, 2)); }
    catch (e) { console.error('[courses] save failed:', e); }
}

// ── Helpers ────────────────────────────────────────────────────────
function crsEsc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function crsId(p) { return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function crsOpenExternal(url) {
    if (!/^https?:\/\//i.test(url)) return;
    try { require('electron').shell.openExternal(url); } catch (_) {}
}
function crsFetchJson(url) {
    return new Promise((resolve, reject) => {
        const req = require('https').get(url, {
            headers: { 'User-Agent': 'VulsorCourses/1.0 (personal learning app)', 'Accept': 'application/json' },
        }, res => {
            if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
            let d = '';
            res.setEncoding('utf8');
            res.on('data', c => { d += c; });
            res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
        });
        req.on('error', reject);
        req.setTimeout(15000, () => req.destroy(new Error('timeout')));
    });
}

// All lessons of a course in reading order
function crsFlatLessons(course) {
    const out = [];
    course.modules.forEach(m => m.lessons.forEach(l => out.push(l)));
    return out;
}
function crsProgress(course) {
    const all = crsFlatLessons(course);
    const done = all.filter(l => l.done).length;
    return { done, total: all.length, pct: all.length ? Math.round(done / all.length * 100) : 0 };
}

// ── Course building ────────────────────────────────────────────────
const CRS_SKIP_SECTIONS = /^(references|external links|see also|bibliography|notes|further reading|sources|citations|gallery|footnotes|works cited)$/i;

function _crsStatus(msg) {
    const el = document.getElementById('crs-build-status');
    if (el) el.innerHTML = msg ? `<i class="fas fa-circle-notch fa-spin mr-1.5"></i>${msg}` : '';
}

// Split a Wikipedia plain-text extract into { lead, sections:[{title,text}] }
function crsSplitExtract(extract) {
    const parts = extract.split(/\n(?===? [^=].*? ==?\n)|\n(?=== .*? ==\n)/);
    // Simpler reliable approach: walk lines
    const lines = extract.split('\n');
    let lead = '', cur = null;
    const sections = [];
    for (const line of lines) {
        const h2 = line.match(/^== (.+?) ==$/);
        if (h2) {
            if (cur) sections.push(cur);
            cur = { title: h2[1].trim(), text: '' };
            continue;
        }
        if (cur) cur.text += line + '\n';
        else lead += line + '\n';
    }
    if (cur) sections.push(cur);
    return { lead: lead.trim(), sections: sections.map(s => ({ title: s.title, text: s.text.trim() })) };
}

// Trim very long lesson text at a paragraph boundary
function crsTrim(text, max) {
    if (text.length <= max) return text;
    const cut = text.lastIndexOf('\n\n', max);
    return text.slice(0, cut > max / 2 ? cut : max).trim() + '\n\n[…] Read the full article for more.';
}

// ── Question generation ────────────────────────────────────────────
function _crsShuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}
// Collect fill-in-the-blank candidates { q, a } from reading lessons
function _crsCollectCandidates(lessons) {
    const stop = /^(The|This|These|Those|However|Its|His|Her|Their|They|She|Many|Most|Some|Other|Both|Each|Such|When|Where|While|Since|After|Before|During|Although|Because|According|Unlike|Like|For|One|Two|New)$/;
    const cands = [];
    const seen = new Set();
    lessons.forEach(l => {
        if (l.type !== 'read' || !l.content) return;
        l.content.split(/(?<=[.!?])\s+/).forEach(s => {
            s = s.trim().replace(/\s+/g, ' ');
            if (s.length < 60 || s.length > 190 || /[=[\]{}|]/.test(s)) return;
            const m = s.slice(1).match(/\b([A-Z][a-z]{3,}(?: [A-Z][a-z]{3,})?)\b/);
            if (!m || stop.test(m[1].split(' ')[0]) || seen.has(m[1])) return;
            seen.add(m[1]);
            cands.push({ q: s.replace(m[1], '_______'), a: m[1] });
        });
    });
    return _crsShuffle(cands);
}
// Turn candidates into multiple-choice questions with 4 options
function _crsMcqs(cands, count, extraTerms) {
    const allTerms = cands.map(c => c.a).concat(extraTerms || []);
    return cands.slice(0, count).map(c => {
        const opts = new Set([c.a]);
        for (const t of _crsShuffle(allTerms.slice())) {
            if (opts.size >= 4) break;
            if (t !== c.a) opts.add(t);
        }
        return { q: c.q, a: c.a, options: _crsShuffle([...opts]) };
    });
}
// Legacy single-quiz builder (still used by old saved courses)
function crsMakeQuiz(lessons) {
    return _crsMcqs(_crsCollectCandidates(lessons), 6);
}

// Per-module exercises: a mix of multiple-choice checks and open questions
// with self-check reveals taken from the source text.
function crsMakeExercises(moduleLessons, allTerms) {
    const mcqs = _crsMcqs(_crsCollectCandidates(moduleLessons), 4, allTerms);
    const opens = moduleLessons
        .filter(l => l.type === 'read' && l.content && l.content.length > 400)
        .slice(0, 2)
        .map(l => ({
            kind: 'open',
            q: `In your own words, explain: “${l.title}”. Write a few sentences, then compare with the key points.`,
            reveal: l.content.split(/(?<=[.!?])\s+/).slice(0, 3).join(' ').slice(0, 420),
        }));
    const items = [...mcqs.map(m => ({ kind: 'mcq', ...m })), ...opens];
    if (items.length < 3) return null;
    return { id: crsId('l'), type: 'exercise', title: 'Exercises', items, done: false };
}

// Final exam: a larger scored test drawn from the whole course
function crsMakeExam(readings) {
    const questions = _crsMcqs(_crsCollectCandidates(readings), 14);
    if (questions.length < 6) return null;
    return {
        id: crsId('l'), type: 'exam', title: 'Final exam',
        questions, pass: 70, best: null, done: false,
    };
}

async function crsBuildCourse(topic) {
    if (crsBuilding) return;
    crsBuilding = true;
    try {
        // 1. Resolve the topic to the best article
        _crsStatus('Finding the best source…');
        const api = 'https://en.wikipedia.org/w/api.php';
        const search = await crsFetchJson(`${api}?action=opensearch&search=${encodeURIComponent(topic)}&limit=4&format=json`);
        const titles = search[1] || [];
        if (!titles.length) throw new Error(`Nothing found for “${topic}” — try different wording.`);

        // 2. Fetch the main article (fall back through results past disambiguation stubs)
        _crsStatus('Reading the main article…');
        let page = null, title = '';
        for (const t of titles) {
            const res = await crsFetchJson(`${api}?action=query&prop=extracts|pageimages&explaintext=1&redirects=1&titles=${encodeURIComponent(t)}&format=json&pithumbsize=640`);
            const p = Object.values(res.query?.pages || {})[0];
            if (p && p.extract && p.extract.length > 1500 && !/may refer to[:\s]/i.test(p.extract.slice(0, 300))) {
                page = p; title = p.title || t;
                break;
            }
        }
        if (!page) throw new Error(`Couldn't build a course for “${topic}” — try a more specific topic.`);

        const { lead, sections } = crsSplitExtract(page.extract);
        const img = page.thumbnail?.source || null;
        const wikiUrl = 'https://en.wikipedia.org/wiki/' + encodeURIComponent(title.replace(/ /g, '_'));

        // 3. Reading lessons from the article's sections
        const readings = [{
            id: crsId('l'), type: 'read', title: `What is ${title}?`,
            content: crsTrim(lead, 6000), img, source: wikiUrl, done: false,
        }];
        sections.forEach(s => {
            if (CRS_SKIP_SECTIONS.test(s.title) || s.text.length < 300) return;
            readings.push({
                id: crsId('l'), type: 'read', title: s.title,
                content: crsTrim(s.text, 7000), img: null, source: wikiUrl, done: false,
            });
        });

        // 4. Related topics → "Going deeper" lessons
        _crsStatus('Finding related topics…');
        let deeper = [];
        try {
            const rel = await crsFetchJson(`${api}?action=query&list=search&srsearch=${encodeURIComponent('morelike:' + title)}&srlimit=6&format=json`);
            const hits = (rel.query?.search || []).slice(0, 6);
            const sums = await Promise.allSettled(hits.map(h =>
                crsFetchJson('https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(h.title.replace(/ /g, '_')))));
            deeper = sums
                .filter(r => r.status === 'fulfilled' && r.value.extract && r.value.extract.length > 200)
                .map(r => ({
                    id: crsId('l'), type: 'read', title: r.value.title,
                    content: r.value.extract,
                    img: r.value.thumbnail?.source || null,
                    source: r.value.content_urls?.desktop?.page || null,
                    done: false,
                }));
        } catch (_) {}

        // 5. Exam + resources
        _crsStatus('Writing exercises & exam…');
        const examLesson = crsMakeExam(readings);
        const q = encodeURIComponent(title);
        const resourcesLesson = {
            id: crsId('l'), type: 'resources', title: 'Keep learning',
            links: [
                { label: `Full Wikipedia article`,        url: wikiUrl,                                                       icon: 'fa-book' },
                { label: `YouTube — video lessons`,       url: `https://www.youtube.com/results?search_query=${q}+tutorial`,  icon: 'fa-video' },
                { label: `Khan Academy`,                  url: `https://www.khanacademy.org/search?page_search_query=${q}`,   icon: 'fa-graduation-cap' },
                { label: `Coursera — full courses`,       url: `https://www.coursera.org/search?query=${q}`,                  icon: 'fa-university' },
                { label: `Google Scholar — papers`,       url: `https://scholar.google.com/scholar?q=${q}`,                   icon: 'fa-flask' },
                { label: `Reddit — community discussion`, url: `https://www.reddit.com/search/?q=${q}`,                       icon: 'fa-comments' },
            ],
            done: false,
        };

        // 6. Assemble modules: chunk the readings into digestible parts,
        //    each module ending with its own exercises.
        const modules = [];
        const chunk = 4;
        const names = ['Foundations', 'Core concepts', 'Advanced topics', 'Special topics'];
        const allTerms = _crsCollectCandidates(readings).map(c => c.a);
        for (let i = 0; i < readings.length; i += chunk) {
            const lessons = readings.slice(i, i + chunk);
            const ex = crsMakeExercises(lessons, allTerms);
            if (ex) lessons.push(ex);
            modules.push({
                id: crsId('m'),
                title: `Module ${modules.length + 1} — ${names[Math.min(modules.length, names.length - 1)]}`,
                lessons,
            });
        }
        if (deeper.length) modules.push({ id: crsId('m'), title: `Module ${modules.length + 1} — Going deeper`, lessons: deeper });
        const lastLessons = [];
        if (examLesson) lastLessons.push(examLesson);
        lastLessons.push(resourcesLesson);
        modules.push({ id: crsId('m'), title: `Module ${modules.length + 1} — Final exam & continue`, lessons: lastLessons });

        const course = {
            id: crsId('c'), topic, title, img,
            desc: lead.split(/(?<=[.!?])\s+/).slice(0, 2).join(' ').slice(0, 260),
            createdAt: Date.now(), modules,
        };
        coursesData.courses.unshift(course);
        saveCoursesData();
        crsActiveCourse = course.id;
        crsActiveLesson = null;
        _crsStatus('');
        renderCourses();
    } catch (e) {
        console.error('[courses] build failed:', e);
        _crsStatus('');
        const el = document.getElementById('crs-build-status');
        if (el) el.innerHTML = `<span class="text-red-400">${crsEsc(e.message || 'Failed — are you online?')}</span>`;
    } finally {
        crsBuilding = false;
    }
}

// ── Render ─────────────────────────────────────────────────────────
function renderCourses() {
    _crsRenderSidebar();
    const course = coursesData.courses.find(c => c.id === crsActiveCourse);
    if (!course) { _crsRenderEmpty(); return; }
    const lesson = crsActiveLesson ? crsFlatLessons(course).find(l => l.id === crsActiveLesson) : null;
    if (lesson) _crsRenderLesson(course, lesson);
    else _crsRenderOverview(course);
}

function _crsRenderSidebar() {
    const list = document.getElementById('crs-course-list');
    if (!list) return;
    list.innerHTML = coursesData.courses.map(c => {
        const p = crsProgress(c);
        const active = c.id === crsActiveCourse;
        return `<div onclick="crsOpenCourse('${c.id}')" class="px-3 py-2.5 rounded-xl cursor-pointer transition-colors ${active ? 'bg-indigo-600/20 border border-indigo-500/40' : 'hover:bg-slate-800/70 border border-transparent'}">
            <div class="text-slate-200 text-xs font-semibold truncate">${crsEsc(c.title)}</div>
            <div class="flex items-center gap-2 mt-1.5">
                <div class="flex-1 h-1 rounded-full bg-slate-800 overflow-hidden"><div class="h-full bg-indigo-500" style="width:${p.pct}%"></div></div>
                <span class="text-slate-500 text-[10px] tabular-nums">${p.pct}%</span>
            </div>
        </div>`;
    }).join('') || '<p class="text-slate-600 text-[11px] italic px-3 py-4">No courses yet — build your first one above.</p>';
}

function _crsRenderEmpty() {
    const main = document.getElementById('crs-main');
    if (!main) return;
    const suggestions = ['Quantum computing', 'Python (programming language)', 'Photography', 'Ancient Rome', 'Machine learning', 'Nutrition', 'Music theory', 'Stoicism'];
    main.innerHTML = `<div class="flex flex-col items-center justify-center h-full text-center px-8">
        <i class="fas fa-chalkboard-teacher text-slate-700 text-5xl mb-5"></i>
        <h3 class="text-slate-200 text-lg font-semibold mb-2">Learn anything</h3>
        <p class="text-slate-500 text-sm max-w-md mb-6">Type any topic in the sidebar and Vulsor builds you a structured course from the internet — modules, step-by-step lessons, a quiz, and places to go deeper.</p>
        <div class="flex flex-wrap gap-2 justify-center max-w-lg">
            ${suggestions.map(s => `<button onclick="crsSuggest('${crsEsc(s)}')" class="px-3 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 text-xs transition-colors">${crsEsc(s)}</button>`).join('')}
        </div>
    </div>`;
}
function crsSuggest(topic) {
    const input = document.getElementById('crs-topic-input');
    if (input) input.value = topic;
    crsBuildCourse(topic);
}

function _crsRenderOverview(course) {
    const main = document.getElementById('crs-main');
    if (!main) return;
    const p = crsProgress(course);
    const typeIcon = { read: 'fa-book-open', quiz: 'fa-question-circle', exercise: 'fa-pencil-alt', exam: 'fa-clipboard-check', resources: 'fa-compass' };
    main.innerHTML = `
    <div class="h-full overflow-y-auto chat-scroll">
        <div class="max-w-3xl mx-auto p-8">
            <div class="flex items-start gap-5 mb-6">
                ${course.img ? `<img src="${crsEsc(course.img)}" class="w-28 h-28 rounded-2xl object-cover bg-slate-800 shrink-0" onerror="this.style.display='none'" alt="">` : ''}
                <div class="min-w-0 flex-1">
                    <h2 class="text-slate-100 text-2xl font-bold mb-1.5">${crsEsc(course.title)}</h2>
                    <p class="text-slate-400 text-sm leading-relaxed">${crsEsc(course.desc)}</p>
                </div>
                <div class="flex items-center gap-1 shrink-0">
                    <button onclick="crsExportPdf('${course.id}')" title="Download the whole course as a PDF" class="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700/50 text-slate-300 text-xs font-semibold transition-colors"><i class="fas fa-file-pdf mr-1.5 text-red-400"></i>PDF</button>
                    <button onclick="crsDeleteCourse('${course.id}')" title="Delete course" class="text-slate-600 hover:text-red-400 w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-800 transition-colors"><i class="fas fa-trash text-xs"></i></button>
                </div>
            </div>
            <div class="flex items-center gap-3 mb-8">
                <div class="flex-1 h-2 rounded-full bg-slate-800 overflow-hidden"><div class="h-full bg-indigo-500 transition-all" style="width:${p.pct}%"></div></div>
                <span class="text-slate-400 text-xs tabular-nums font-semibold">${p.done}/${p.total} lessons · ${p.pct}%</span>
                ${p.done < p.total ? `<button onclick="crsContinue('${course.id}')" class="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-colors">${p.done ? 'Continue' : 'Start course'}</button>` : '<span class="text-emerald-400 text-xs font-semibold"><i class="fas fa-circle-check mr-1"></i>Complete!</span>'}
            </div>
            ${course.modules.map(m => `
                <div class="mb-6">
                    <h3 class="text-slate-300 text-xs uppercase tracking-wide font-bold mb-2.5">${crsEsc(m.title)}</h3>
                    <div class="flex flex-col gap-1.5">
                        ${m.lessons.map(l => `
                            <div onclick="crsOpenLesson('${course.id}','${l.id}')" class="flex items-center gap-3 px-4 py-3 rounded-xl border cursor-pointer transition-colors ${l.done ? 'border-emerald-600/25 bg-emerald-500/5' : 'border-slate-800 hover:border-slate-600 bg-slate-900/40'}">
                                <i class="fas ${l.done ? 'fa-circle-check text-emerald-400' : typeIcon[l.type] + ' text-slate-500'} text-sm w-4 text-center"></i>
                                <span class="text-sm font-medium flex-1 ${l.done ? 'text-slate-500' : 'text-slate-200'}">${crsEsc(l.title)}</span>
                                ${l.type === 'exam' && l.best != null ? `<span class="text-[10px] font-bold tabular-nums ${l.best >= l.pass ? 'text-emerald-400' : 'text-amber-400'}">${l.best}%</span>` : ''}
                                <i class="fas fa-chevron-right text-slate-700 text-xs"></i>
                            </div>`).join('')}
                    </div>
                </div>`).join('')}
        </div>
    </div>`;
}

// Plain text → simple HTML (paragraphs + === sub-headings ===)
function _crsContentHtml(text) {
    return text.split(/\n{2,}/).map(block => {
        block = block.trim();
        if (!block) return '';
        const h3 = block.match(/^=== (.+?) ===\n?([\s\S]*)$/);
        if (h3) {
            return `<h4 class="text-slate-200 text-base font-bold mt-6 mb-2">${crsEsc(h3[1])}</h4>`
                + (h3[2].trim() ? `<p class="text-slate-300 text-[15px] leading-relaxed mb-4">${crsEsc(h3[2].trim())}</p>` : '');
        }
        return `<p class="text-slate-300 text-[15px] leading-relaxed mb-4">${crsEsc(block.replace(/^=+ .+? =+$/gm, '').trim())}</p>`;
    }).join('');
}

function _crsRenderLesson(course, lesson) {
    const main = document.getElementById('crs-main');
    if (!main) return;
    const flat = crsFlatLessons(course);
    const idx  = flat.findIndex(l => l.id === lesson.id);
    const p    = crsProgress(course);

    let body = '';
    if (lesson.type === 'read') {
        body = `${lesson.img ? `<img src="${crsEsc(lesson.img)}" class="w-full max-h-72 object-cover rounded-2xl mb-6 bg-slate-800" onerror="this.style.display='none'" alt="">` : ''}
            ${_crsContentHtml(lesson.content || '')}
            ${lesson.source ? `<button onclick="crsOpenExternal('${crsEsc(lesson.source)}')" class="text-indigo-400 hover:text-indigo-300 text-xs mt-2"><i class="fas fa-external-link-alt mr-1"></i>Read the full source</button>` : ''}`;
    } else if (lesson.type === 'quiz' || lesson.type === 'exercise') {
        const items = lesson.type === 'quiz'
            ? lesson.questions.map(q => ({ kind: 'mcq', ...q }))
            : lesson.items;
        let qi = 0;
        body = `<p class="text-slate-400 text-sm mb-6">${lesson.type === 'quiz'
                ? 'Fill in the blanks — pick the missing term in each sentence.'
                : 'Practice what you just read — instant feedback on each answer.'}</p>
            <div data-quiz-scope>` +
            items.map((it, ii) => {
                if (it.kind === 'open') {
                    return `<div class="mb-6 p-4 rounded-2xl bg-slate-900/50 border border-slate-800">
                        <div class="text-slate-200 text-sm leading-relaxed mb-3"><i class="fas fa-pen text-indigo-400 mr-2"></i>${crsEsc(it.q)}</div>
                        <textarea rows="3" placeholder="Write your answer here…" class="w-full bg-slate-800/70 text-slate-200 text-sm border border-slate-700/60 rounded-xl px-3 py-2 outline-none focus:border-indigo-500/60 resize-none mb-2" style="color-scheme:dark"></textarea>
                        <button onclick="this.nextElementSibling.classList.toggle('hidden');this.textContent=this.textContent.includes('Show')?'Hide key points':'Show key points'" class="text-indigo-400 hover:text-indigo-300 text-xs font-semibold">Show key points</button>
                        <div class="hidden mt-2 p-3 rounded-xl bg-indigo-500/10 border border-indigo-500/25 text-slate-300 text-xs leading-relaxed">${crsEsc(it.reveal)}</div>
                    </div>`;
                }
                qi++;
                return `<div class="mb-6 p-4 rounded-2xl bg-slate-900/50 border border-slate-800" data-q>
                    <div class="text-slate-200 text-sm leading-relaxed mb-3"><span class="text-indigo-400 font-bold mr-1.5">${qi}.</span>${crsEsc(it.q)}</div>
                    <div class="grid grid-cols-2 gap-2">
                        ${it.options.map(o => `<button onclick="crsAnswer(this)" data-correct="${o === it.a ? '1' : '0'}" class="crs-opt px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700/50 text-slate-300 text-xs text-left transition-colors">${crsEsc(o)}</button>`).join('')}
                    </div>
                </div>`;
            }).join('') +
            `<p data-quiz-score class="text-slate-400 text-sm font-semibold"></p></div>`;
    } else if (lesson.type === 'exam') {
        const answered = lesson.best != null;
        body = `<div class="p-4 rounded-2xl bg-indigo-500/10 border border-indigo-500/25 mb-6">
                <div class="text-slate-200 text-sm font-semibold mb-1"><i class="fas fa-clipboard-check text-indigo-400 mr-2"></i>${lesson.questions.length} questions · pass mark ${lesson.pass}%</div>
                <div class="text-slate-400 text-xs">Answer every question, then submit. You can retake the exam as often as you like${answered ? ` — your best score is <span class="font-bold ${lesson.best >= lesson.pass ? 'text-emerald-400' : 'text-amber-400'}">${lesson.best}%</span>` : ''}.</div>
            </div>
            <div data-exam-scope>` +
            lesson.questions.map((q, qi) => `
                <div class="mb-6 p-4 rounded-2xl bg-slate-900/50 border border-slate-800" data-exam-q>
                    <div class="text-slate-200 text-sm leading-relaxed mb-3"><span class="text-indigo-400 font-bold mr-1.5">${qi + 1}.</span>${crsEsc(q.q)}</div>
                    <div class="grid grid-cols-2 gap-2">
                        ${q.options.map(o => `<button onclick="crsExamSelect(this)" data-correct="${o === q.a ? '1' : '0'}" class="crs-opt px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700/50 text-slate-300 text-xs text-left transition-colors">${crsEsc(o)}</button>`).join('')}
                    </div>
                </div>`).join('') +
            `<div data-exam-result class="mb-4"></div>
            <button onclick="crsExamSubmit('${lesson.id}')" class="w-full px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold transition-colors"><i class="fas fa-flag-checkered mr-2"></i>Submit exam</button>
            </div>`;
    } else if (lesson.type === 'resources') {
        body = `<p class="text-slate-400 text-sm mb-5">You've got the foundations — here's where to go for videos, full courses and the research itself.</p>
            <div class="flex flex-col gap-2">` +
            lesson.links.map(l => `
                <button onclick="crsOpenExternal('${crsEsc(l.url)}')" class="flex items-center gap-3 px-4 py-3 rounded-xl border border-slate-800 hover:border-indigo-500/50 bg-slate-900/40 text-left transition-colors">
                    <i class="fas ${l.icon} text-indigo-400 w-4 text-center"></i>
                    <span class="text-slate-200 text-sm font-medium">${crsEsc(l.label)}</span>
                    <i class="fas fa-external-link-alt text-slate-700 text-xs ml-auto"></i>
                </button>`).join('') + `</div>`;
    }

    main.innerHTML = `
    <div class="h-full flex flex-col">
        <div class="px-6 py-3 border-b border-slate-800/70 flex items-center gap-3 shrink-0">
            <button onclick="crsBackToOverview()" class="text-slate-500 hover:text-white text-xs"><i class="fas fa-arrow-left mr-1.5"></i>${crsEsc(course.title)}</button>
            <div class="flex-1"></div>
            <div class="w-32 h-1.5 rounded-full bg-slate-800 overflow-hidden"><div class="h-full bg-indigo-500" style="width:${p.pct}%"></div></div>
            <span class="text-slate-500 text-[10px] tabular-nums">${idx + 1}/${flat.length}</span>
        </div>
        <div class="flex-1 overflow-y-auto chat-scroll">
            <div class="max-w-2xl mx-auto px-8 py-8">
                <h2 class="text-slate-100 text-xl font-bold mb-5">${crsEsc(lesson.title)}</h2>
                ${body}
            </div>
        </div>
        <div class="px-6 py-3 border-t border-slate-800/70 flex items-center justify-between shrink-0">
            <button onclick="crsNav(-1)" ${idx <= 0 ? 'disabled' : ''} class="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold disabled:opacity-30 transition-colors"><i class="fas fa-chevron-left mr-1.5"></i>Previous</button>
            <button onclick="crsCompleteAndNext()" class="px-5 py-2 rounded-xl ${lesson.done || lesson.type === 'exam' ? 'bg-slate-800 hover:bg-slate-700 text-slate-300' : 'bg-indigo-600 hover:bg-indigo-500 text-white'} text-xs font-semibold transition-colors">
                ${lesson.type === 'exam' && !lesson.done
                    ? 'Skip for now<i class="fas fa-chevron-right ml-1.5"></i>'
                    : lesson.done ? (idx < flat.length - 1 ? 'Next<i class="fas fa-chevron-right ml-1.5"></i>' : 'Back to overview')
                    : (idx < flat.length - 1 ? 'Mark complete &amp; continue<i class="fas fa-chevron-right ml-1.5"></i>' : 'Finish course<i class="fas fa-flag-checkered ml-1.5"></i>')}
            </button>
        </div>
    </div>`;
}

// ── Interactions ───────────────────────────────────────────────────
function crsOpenCourse(id)          { crsActiveCourse = id; crsActiveLesson = null; renderCourses(); }
function crsBackToOverview()        { crsActiveLesson = null; renderCourses(); }
function crsOpenLesson(cid, lid)    { crsActiveCourse = cid; crsActiveLesson = lid; renderCourses(); }
function crsContinue(cid) {
    const course = coursesData.courses.find(c => c.id === cid);
    if (!course) return;
    const next = crsFlatLessons(course).find(l => !l.done) || crsFlatLessons(course)[0];
    if (next) crsOpenLesson(cid, next.id);
}
function crsNav(dir) {
    const course = coursesData.courses.find(c => c.id === crsActiveCourse);
    if (!course) return;
    const flat = crsFlatLessons(course);
    const idx  = flat.findIndex(l => l.id === crsActiveLesson);
    const next = flat[idx + dir];
    if (next) { crsActiveLesson = next.id; renderCourses(); }
}
function crsCompleteAndNext() {
    const course = coursesData.courses.find(c => c.id === crsActiveCourse);
    if (!course) return;
    const flat = crsFlatLessons(course);
    const idx  = flat.findIndex(l => l.id === crsActiveLesson);
    const lesson = flat[idx];
    // Exams only complete by passing them — the footer button just navigates
    if (lesson && !lesson.done && lesson.type !== 'exam') { lesson.done = true; saveCoursesData(); }
    if (idx < flat.length - 1) { crsActiveLesson = flat[idx + 1].id; }
    else { crsActiveLesson = null; }
    renderCourses();
}
// Instant-feedback answer for quizzes & exercises (scoped to the lesson)
function crsAnswer(btn) {
    const wrap = btn.closest('[data-q]');
    if (!wrap || wrap.dataset.answered) return;
    wrap.dataset.answered = '1';
    wrap.dataset.right = btn.dataset.correct;
    wrap.querySelectorAll('.crs-opt').forEach(b => {
        b.disabled = true;
        if (b.dataset.correct === '1') {
            b.style.background = 'rgba(16,185,129,.25)';
            b.style.borderColor = 'rgba(16,185,129,.6)';
        }
    });
    if (btn.dataset.correct !== '1') {
        btn.style.background = 'rgba(239,68,68,.25)';
        btn.style.borderColor = 'rgba(239,68,68,.6)';
    }
    const scope = btn.closest('[data-quiz-scope]');
    if (!scope) return;
    const all = scope.querySelectorAll('[data-q]');
    const answered = scope.querySelectorAll('[data-q][data-answered]');
    if (answered.length === all.length) {
        const right = scope.querySelectorAll('[data-q][data-right="1"]').length;
        const el = scope.querySelector('[data-quiz-score]');
        if (el) el.innerHTML = right === all.length
            ? `<span class="text-emerald-400"><i class="fas fa-trophy mr-1.5"></i>Perfect — ${right}/${all.length}!</span>`
            : `You got ${right}/${all.length} — review the readings above and come back.`;
    }
}

// ── Exam ───────────────────────────────────────────────────────────
function crsExamSelect(btn) {
    const wrap = btn.closest('[data-exam-q]');
    if (!wrap || wrap.dataset.graded) return;
    wrap.querySelectorAll('.crs-opt').forEach(b => {
        b.style.background = '';
        b.style.borderColor = '';
        delete b.dataset.selected;
    });
    btn.dataset.selected = '1';
    btn.style.background = 'rgba(99,102,241,.3)';
    btn.style.borderColor = 'rgba(99,102,241,.7)';
}
function crsExamSubmit(lessonId) {
    const course = coursesData.courses.find(c => c.id === crsActiveCourse);
    const lesson = course && crsFlatLessons(course).find(l => l.id === lessonId);
    const scope  = document.querySelector('[data-exam-scope]');
    if (!lesson || !scope) return;
    const qs = [...scope.querySelectorAll('[data-exam-q]')];
    const unanswered = qs.filter(w => !w.querySelector('[data-selected]')).length;
    const resultEl = scope.querySelector('[data-exam-result]');
    if (unanswered) {
        if (resultEl) resultEl.innerHTML = `<p class="text-amber-400 text-sm font-semibold p-3 rounded-xl bg-amber-500/10 border border-amber-500/25">${unanswered} question${unanswered !== 1 ? 's' : ''} still unanswered — scroll up and finish before submitting.</p>`;
        return;
    }
    let right = 0;
    qs.forEach(w => {
        w.dataset.graded = '1';
        const sel = w.querySelector('[data-selected]');
        w.querySelectorAll('.crs-opt').forEach(b => {
            b.disabled = true;
            if (b.dataset.correct === '1') {
                b.style.background = 'rgba(16,185,129,.25)';
                b.style.borderColor = 'rgba(16,185,129,.6)';
            }
        });
        if (sel.dataset.correct === '1') right++;
        else { sel.style.background = 'rgba(239,68,68,.25)'; sel.style.borderColor = 'rgba(239,68,68,.6)'; }
    });
    const pct    = Math.round(right / qs.length * 100);
    const passed = pct >= (lesson.pass || 70);
    lesson.best = Math.max(lesson.best || 0, pct);
    if (passed && !lesson.done) lesson.done = true;
    saveCoursesData();
    if (resultEl) resultEl.innerHTML = passed
        ? `<div class="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-center">
             <div class="text-emerald-400 text-lg font-bold mb-1"><i class="fas fa-trophy mr-2"></i>Passed — ${pct}%</div>
             <div class="text-slate-400 text-xs">${right}/${qs.length} correct. The exam is marked complete.</div>
           </div>`
        : `<div class="p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-center">
             <div class="text-red-400 text-lg font-bold mb-1">${pct}% — not quite (pass mark ${lesson.pass}%)</div>
             <div class="text-slate-400 text-xs mb-2">${right}/${qs.length} correct. Review the modules and try again.</div>
             <button onclick="renderCourses()" class="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition-colors"><i class="fas fa-rotate mr-1.5"></i>Retake exam</button>
           </div>`;
    _crsRenderSidebar();   // progress may have changed
}
// ── PDF export ─────────────────────────────────────────────────────
// Builds a print-styled booklet of the whole course (cover, contents,
// readings, exercises, exam, answer key) and writes a real PDF file.
function _crsPdfContent(text) {
    return String(text || '').split(/\n{2,}/).map(b => {
        b = b.trim();
        if (!b) return '';
        const h3 = b.match(/^=== (.+?) ===\n?([\s\S]*)$/);
        if (h3) return `<h4>${crsEsc(h3[1])}</h4>` + (h3[2].trim() ? `<p>${crsEsc(h3[2].trim())}</p>` : '');
        return `<p>${crsEsc(b.replace(/^=+ .+? =+$/gm, '').trim())}</p>`;
    }).join('');
}
function crsCoursePdfHtml(course) {
    let qNum = 0;
    const answers = [];
    const modulesHtml = course.modules.map(m => {
        const lessons = m.lessons.map(l => {
            if (l.type === 'read') {
                return `<div class="lesson"><h3>${crsEsc(l.title)}</h3>${_crsPdfContent(l.content)}
                    ${l.source ? `<p class="src">Source: ${crsEsc(l.source)}</p>` : ''}</div>`;
            }
            if (l.type === 'exercise' || l.type === 'quiz' || l.type === 'exam') {
                const items = l.type === 'exercise' ? l.items : (l.questions || []).map(q => ({ kind: 'mcq', ...q }));
                const label = l.type === 'exam' ? `Final exam (pass mark ${l.pass || 70}%)` : l.title;
                return `<div class="lesson"><h3>${crsEsc(label)}</h3>` + items.map(it => {
                    if (it.kind === 'open') {
                        return `<div class="q"><p><b>✎</b> ${crsEsc(it.q)}</p><div class="lines"></div></div>`;
                    }
                    qNum++;
                    answers.push({ n: qNum, a: it.a });
                    return `<div class="q"><p><b>${qNum}.</b> ${crsEsc(it.q)}</p>
                        <p class="opts">${it.options.map((o, i) => `${'abcd'[i]}) ${crsEsc(o)}`).join(' &nbsp;&nbsp; ')}</p></div>`;
                }).join('') + `</div>`;
            }
            if (l.type === 'resources') {
                return `<div class="lesson"><h3>Keep learning</h3><ul>${l.links.map(k => `<li>${crsEsc(k.label)} — ${crsEsc(k.url)}</li>`).join('')}</ul></div>`;
            }
            return '';
        }).join('');
        return `<div class="module"><h2>${crsEsc(m.title)}</h2>${lessons}</div>`;
    }).join('');

    const toc = course.modules.map(m => `<li>${crsEsc(m.title)}<span class="toc-l">${m.lessons.map(l => crsEsc(l.title)).join(' · ')}</span></li>`).join('');
    const key = answers.length
        ? `<div class="module"><h2>Answer key</h2><p class="key">${answers.map(a => `<b>${a.n}.</b> ${crsEsc(a.a)}`).join(' &nbsp;&nbsp;&nbsp; ')}</p></div>`
        : '';

    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${crsEsc(course.title)}</title>
<style>
  body{font-family:Georgia,'Times New Roman',serif;color:#1a202c;margin:0;line-height:1.65;font-size:12.5px}
  .cover{text-align:center;padding:180px 40px 40px;page-break-after:always}
  .cover h1{font-size:34px;margin:0 0 14px}
  .cover .desc{font-size:14px;color:#4a5568;max-width:460px;margin:0 auto 26px}
  .cover .meta{font-size:11px;color:#718096;text-transform:uppercase;letter-spacing:.1em}
  .toc{page-break-after:always;padding:30px 10px}
  .toc h2{font-size:20px;border-bottom:2px solid #1a202c;padding-bottom:6px}
  .toc li{margin:10px 0;font-weight:bold}
  .toc-l{display:block;font-weight:normal;font-size:10.5px;color:#718096;margin-top:2px}
  .module{page-break-before:always;padding:0 6px}
  .module:first-of-type{page-break-before:auto}
  h2{font-size:19px;border-bottom:2px solid #1a202c;padding-bottom:6px;margin:26px 0 14px}
  h3{font-size:15px;margin:20px 0 8px}
  h4{font-size:13px;margin:14px 0 6px}
  p{margin:7px 0;text-align:justify}
  .src{font-size:10px;color:#a0aec0;font-style:italic}
  .q{margin:13px 0;page-break-inside:avoid}
  .opts{color:#4a5568;margin-left:18px}
  .lines{height:64px;border-bottom:1px solid #cbd5e0;background:repeating-linear-gradient(transparent,transparent 20px,#cbd5e0 21px)}
  .key{line-height:2.1}
  ul{margin:6px 0 6px 18px}
  @media print{@page{margin:1.4cm}}
</style></head><body>
<div class="cover">
  <h1>${crsEsc(course.title)}</h1>
  <p class="desc">${crsEsc(course.desc)}</p>
  <p class="meta">A Vulsor course · ${course.modules.length} modules · ${crsFlatLessons(course).length} lessons · ${new Date(course.createdAt).toLocaleDateString()}</p>
</div>
<div class="toc"><h2>Contents</h2><ol>${toc}</ol></div>
${modulesHtml}
${key}
</body></html>`;
}
async function crsExportPdf(id) {
    const course = coursesData.courses.find(c => c.id === id);
    if (!course) return;
    _crsStatus('Exporting PDF…');
    try {
        const res = await ipcRenderer.invoke('export-pdf', {
            html: crsCoursePdfHtml(course),
            name: course.title + ' — Course',
        });
        _crsStatus('');
        if (res && res.success) {
            if (typeof woToast === 'function') woToast('Course PDF saved to Downloads 📄');
            if (typeof vaultRevealInFinder === 'function') vaultRevealInFinder(res.path);
        } else {
            alert('PDF export failed: ' + (res?.error || 'unknown error'));
        }
    } catch (e) {
        _crsStatus('');
        alert('PDF export failed: ' + e.message);
    }
}

function crsDeleteCourse(id) {
    const c = coursesData.courses.find(x => x.id === id);
    if (!c || !confirm(`Delete the course “${c.title}”?`)) return;
    coursesData.courses = coursesData.courses.filter(x => x.id !== id);
    if (crsActiveCourse === id) { crsActiveCourse = null; crsActiveLesson = null; }
    saveCoursesData();
    renderCourses();
}

// ── Init ───────────────────────────────────────────────────────────
function initCourses() {
    coursesData = loadCoursesData();
    const input = document.getElementById('crs-topic-input');
    const go    = document.getElementById('crs-build-btn');
    const start = () => {
        const topic = input?.value.trim();
        if (topic && !crsBuilding) crsBuildCourse(topic);
    };
    go?.addEventListener('click', start);
    input?.addEventListener('keydown', e => { if (e.key === 'Enter') start(); });
}
function renderCoursesView() { renderCourses(); }
