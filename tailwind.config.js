// ── Tailwind build config ────────────────────────────────────────────
// The renderer used to include the Tailwind Play CDN script, which compiles
// the stylesheet in the browser at every launch: it walks the whole 400KB DOM,
// runs the compiler, and injects the result. That cost ~1.7s of the app's
// startup, every time. This config builds the same stylesheet once, ahead of
// time, into css/tailwind.css:
//
//   npm run build:css        (add --watch while working on markup)
//
// Default theme, no plugins — exactly what the CDN script ran with.
module.exports = {
    content: ['./index.html', './js/**/*.js', './drag-preview.html'],
    theme: { extend: {} },
    plugins: [],
};
