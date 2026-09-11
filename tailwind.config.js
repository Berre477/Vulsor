// ── Tailwind build config ────────────────────────────────────────────
// The renderer used to include the Tailwind Play CDN script, which compiles
// the stylesheet in the browser at every launch: it walks the whole 400KB DOM,
// runs the compiler, and injects the result. That cost ~1.7s of the app's
// startup, every time. This config builds the same stylesheet once, ahead of
// time, into css/tailwind.css:
//
//   npm run build:css        (add --watch while working on markup)
//
// The one change from the default theme: the `slate` palette resolves through
// CSS variables. The whole UI is written in slate utilities (bg-slate-900,
// text-slate-400, border-slate-700 …), so redefining those eleven variables
// re-skins every surface, label and hairline at once. That is how the
// background themes in Settings work — see buildThemeVars() in js/settings.js.
// The variables hold space-separated RGB triplets ("15 23 42") so the opacity
// modifiers (bg-slate-900/40) keep working.
//
// The other colour families go through variables too (--tw-red-400 …), written
// by build-extras/gen-palette.js into css/palette.css. Light themes redefine
// those so pastel text and deep tints swap roles — see the generator.
const STOPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
const FAMILIES = ['gray','zinc','neutral','stone','red','orange','amber','yellow','lime','green','emerald','teal','cyan','sky','blue','indigo','violet','purple','fuchsia','pink','rose'];

const colors = { slate: {} };
for (const stop of STOPS) colors.slate[stop] = `rgb(var(--slate-${stop}) / <alpha-value>)`;
for (const f of FAMILIES) {
    colors[f] = {};
    for (const stop of STOPS) colors[f][stop] = `rgb(var(--tw-${f}-${stop}) / <alpha-value>)`;
}

module.exports = {
    content: ['./index.html', './js/**/*.js', './drag-preview.html'],
    theme: {
        extend: {
            colors,
            // Apple's card radii: 18px cards, 12px controls. Utilities keep
            // their names so the markup doesn't change.
            borderRadius: { xl: '12px', '2xl': '18px', '3xl': '22px' },
        },
    },
    plugins: [],
};
