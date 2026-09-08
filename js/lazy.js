// ── Lazy library loading ─────────────────────────────────────────────
// Everything the renderer needs used to be a <script> tag in index.html, so
// launching the app parsed several megabytes before it could paint — including
// the code editor and the charting library, which most sessions never open.
// Those now load the first time something actually asks for them.
//
// Each bundle loads once; concurrent callers share the same promise.
const _lazyBundles = new Map();

function vulsorLoadScripts(urls) {
    const key = urls.join('|');
    if (_lazyBundles.has(key)) return _lazyBundles.get(key);
    // Sequential: these are classic scripts that register onto globals in order.
    const chain = urls.reduce((p, src) => p.then(() => new Promise((resolve, reject) => {
        const el = document.createElement('script');
        el.src     = src;
        el.async   = false;
        el.onload  = () => resolve();
        el.onerror = () => reject(new Error('could not load ' + src));
        document.head.appendChild(el);
    })), Promise.resolve());
    // A failed load must not be cached as "done" — let the next call retry.
    const p = chain.catch(err => { _lazyBundles.delete(key); throw err; });
    _lazyBundles.set(key, p);
    return p;
}

// Chart.js — the finance charts.
function vulsorLoadChart() {
    if (typeof Chart !== 'undefined') return Promise.resolve();
    return vulsorLoadScripts(['vendor/chart.umd.min.js']);
}

// Ace — the code editor and the notebook's cells. ace.min.js first; the
// extensions, themes and language modes register onto it afterwards.
const VULSOR_ACE_SCRIPTS = [
    'js/ace/ace.min.js',
    'js/ace/ext-language_tools.min.js',
    'js/ace/ext-inline_autocomplete.min.js',
    'js/ace/theme-monokai.min.js',
    'js/ace/theme-dracula.min.js',
    'js/ace/theme-one_dark.min.js',
    'js/ace/theme-tomorrow_night.min.js',
    'js/ace/theme-nord_dark.min.js',
    'js/ace/theme-github_dark.min.js',
    'js/ace/theme-solarized_dark.min.js',
    'js/ace/theme-cobalt.min.js',
    'js/ace/theme-tomorrow_night_blue.min.js',
    'js/ace/theme-vibrant_ink.min.js',
    'js/ace/theme-github.min.js',
    'js/ace/theme-solarized_light.min.js',
    'js/ace/theme-xcode.min.js',
    'js/ace/theme-eclipse.min.js',
    'js/ace/mode-python.min.js',
    'js/ace/mode-javascript.min.js',
    'js/ace/mode-typescript.min.js',
    'js/ace/mode-sh.min.js',
    'js/ace/mode-golang.min.js',
    'js/ace/mode-ruby.min.js',
    'js/ace/mode-c_cpp.min.js',
    'js/ace/mode-java.min.js',
    'js/ace/mode-rust.min.js',
    'js/ace/mode-php.min.js',
    'js/ace/mode-perl.min.js',
    'js/ace/mode-r.min.js',
    'js/ace/mode-html.min.js',
    'js/ace/mode-css.min.js',
    'js/ace/mode-json.min.js',
    'js/ace/mode-yaml.min.js',
    'js/ace/mode-sql.min.js',
    'js/ace/mode-markdown.min.js',
    'js/ace/mode-text.min.js',
];

function vulsorLoadAce() {
    if (typeof ace !== 'undefined') return Promise.resolve();
    return vulsorLoadScripts(VULSOR_ACE_SCRIPTS);
}
