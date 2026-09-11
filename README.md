# Vulsor Browser

A private, local-first desktop workspace built on Electron. It bundles a tabbed web
browser, an AI chat client, a Markdown notes vault, a code editor and notebook, a
mail client, and a wide set of study, science and media tools — all in one app,
with your data on your own disk.

Nothing is uploaded anywhere by default: the chat runs on a local model unless you
pick Claude, ChatGPT, Gemini or another API provider in the model picker. API keys
are entered at runtime and stored locally, encrypted via Electron's `safeStorage`;
there are no keys, tokens or accounts baked into this repository.

---

## Requirements

| | |
|---|---|
| **Node.js** | 20 or newer |
| **Platform** | macOS (arm64) is the primary target; Windows and Linux builds are configured but less tested |
| **Optional** | `ffmpeg` for the video editor, `whisper.cpp` for local speech-to-text, `emscripten` only if you rebuild the WebAssembly modules |

## Getting started

```bash
npm install
```

```bash
npm start
```

## Scripts

| Script | What it does |
|---|---|
| `npm start` | Run the app from source |
| `npm run lint` | ESLint across all first-party code |
| `npm run build` | Package for macOS arm64 → `Vulsor Browser-darwin-arm64/` |
| `npm run build:win` | Package for Windows x64 |
| `npm run build:linux` | Package for Linux x64 |
| `npm run build:css` | Regenerate `css/palette.css` and `css/tailwind.css` after changing markup or the theme config |
| `npm run build:wasm` | Recompile `cpp/*.cpp` → `js/wasm/*.wasm` (needs emscripten) |
| `npm run deploy` | Copy the packaged macOS app into `/Applications` |

All three `build:*` scripts share one configuration in
[`build-extras/package-app.js`](build-extras/package-app.js).

---

## Architecture

Vulsor is a **two-process Electron app** with a deliberately plain renderer: no
bundler, no framework, no build step for the UI.

```
┌─────────────────────────────────────────────────────────────┐
│  main.js            Electron main process (Node)            │
│                     ~57 IPC handlers: mail, voice, ffmpeg,  │
│                     printing, encryption, WhatsApp, NASA…   │
│    ├── updater.js         auto-update client                │
│    ├── control-server.js  local HTTP control endpoint       │
│    ├── relay.js           remote-access relay client        │
│    └── wa-bot.js          WhatsApp assistant (Baileys)      │
└──────────────────────────┬──────────────────────────────────┘
                           │  Electron IPC
┌──────────────────────────┴──────────────────────────────────┐
│  index.html         one document, one <script> per feature  │
│  js/*.js            ~50 classic scripts, shared global scope│
│  css/styles.css     tokens + styling; tailwind.css is prebuilt │
└─────────────────────────────────────────────────────────────┘
```

### The renderer is one shared global scope

This is the single most important thing to know before editing `js/`.

`index.html` loads every feature as a classic `<script src>` tag — **not** as ES
modules. They therefore all share one global scope, in load order, and features
call each other's functions directly by name. There is no import graph.

Two consequences worth internalising:

1. **A top-level `let`, `const` or `class` name must be unique across every
   non-wrapped file.** A collision is a `SyntaxError` that silently kills the
   entire file at load. Most feature files avoid this by prefixing their globals
   (`_bwPasswords`, `_sdkSolution`, `edVideo`).
2. **Load order in `index.html` is meaningful.** `js/globals.js` must come first,
   and `js/main.js` last.

Self-contained modules — the simulations, the 3D scenes, `globals.js` — wrap
themselves in an IIFE and expose only a few named entry points on `window`.
That is the preferred pattern for anything new.

### Theming is a palette, not a list of overrides

Every colour utility in the UI (`bg-slate-900`, `text-red-400`, …) is compiled
by `tailwind.config.js` against CSS variables — `--slate-N` for the grey scale
and `--tw-<family>-N` for the rest — so a background theme is a handful of
numbers on `<html>`, and a view added later is themed automatically:

- `js/settings.js` → `buildThemeVars()` derives the eleven grey stops along the
  theme's own hue (mirrored for light themes) and persists them, so the inline
  `<head>` script in `index.html` can apply them before first paint.
- `build-extras/gen-palette.js` writes `css/palette.css`: the other colour
  families, with the pastel/deep stops swapped for light themes so
  `text-green-400` and `bg-red-950/40` read correctly on a light page.
- Hand-written CSS and inline styles reference the same tokens
  (`rgb(var(--slate-400) / .5)`, `var(--bg-surface)`, `rgb(var(--ink-rgb) / .06)`
  for hover washes). Don't add new hex greys; use a token.
- Deliberate exceptions (chess boards, Sudoku's paper island) pin their own
  palette locally with the same variables.

`npm run build:css` regenerates both `css/palette.css` and `css/tailwind.css`;
run it after touching Tailwind classes in markup.

### Failure paths

`js/globals.js` owns the safety net: the data folder falls back to `~/.vulsor`
if Documents isn't writable, `readJsonStrict` / `writeJsonSafe` set corrupt
files aside and write atomically, and renderer errors are appended to
`Vulsor_Memories/renderer.log` (main-process ones to `userData/logs/main.log`).
Use `uiUnavailable()` / `uiCreateWebGLRenderer()` from `js/ui.js` for anything
that depends on a capability the machine may lack.

### Where state lives

Nothing persistent is stored in this repository. At runtime the app writes to
Electron's `userData` directory (`~/Library/Application Support/Vulsor` on macOS):
the vault, notes, cookies, logins, downloaded speech models and preferences.
`main.js` performs a one-time migration from the app's former name, Verso.

---

## Module map

### Core

| File | Purpose |
|---|---|
| `js/globals.js` | Node/Electron handles and shared paths, loaded first |
| `js/main.js` | Renderer entry point and tab wiring, loaded last |
| `js/ui.js` | Shared UI helpers |
| `js/settings.js` | Settings and appearance |
| `js/commands.js` | Custom slash commands |

### AI and chat

| File | Purpose |
|---|---|
| `js/providers.js` | Model providers for the chat: the local Vulsor model (Ollama), Claude (official SDK), OpenAI, Gemini, any OpenAI-compatible server; encrypted key storage and the model picker |
| `js/ai.js` | AI generation and the tool-call loop (provider-agnostic) |
| `js/chat.js` | Chat session management |
| `js/jarvis.js` | Voice assistant / computer access |
| `js/mathviz.js` | Math and diagram rendering inside chat |
| `js/research.js` | Grounded Q&A over your own sources |
| `js/voice.js` | Voice mode, local speech-to-text via whisper.cpp |

### Vault, writing and documents

| File | Purpose |
|---|---|
| `js/vault.js` | File storage, organiser and viewer |
| `js/vault-ai.js` · `js/vault-graph.js` | Vault AI, and Obsidian-style backlinks |
| `js/docs.js` · `js/writer.js` | Document editor; long-form book and paper writing |
| `js/docx-import.js` · `js/pdf-annot.js` | Word import; PDF annotation layer |
| `js/journal.js` · `js/books.js` · `js/recipes.js` | Daily entries, reading tracker, recipes |
| `js/notebook.js` | Jupyter-style notebook for `.vnb` files |
| `js/code.js` | In-vault code editor with a terminal |

### Browser and communication

| File | Purpose |
|---|---|
| `js/browser.js` | Tabbed `<webview>` browser with a password store |
| `js/browser-preload.js` | Per-page preload: pop-under blocking and page hooks |
| `js/mail.js` | Multi-account IMAP/SMTP client |
| `js/network.js` | LAN peer discovery and file sharing over UDP + TCP |
| `js/wa-bot.js` | WhatsApp assistant (renderer half) |
| `js/news.js` | Multi-outlet RSS reader |

### Study and productivity

| File | Purpose |
|---|---|
| `js/todos.js` · `js/study.js` · `js/countdown.js` | Tasks, Pomodoro, countdowns |
| `js/calendar.js` · `js/finance.js` · `js/workout.js` | Calendar, expense tracking, workout planner |
| `js/learn.js` · `js/courses.js` | Flashcards with spaced repetition; generated courses |
| `js/voyage.js` | Study timer rendered as a 3D space journey |

### Science and simulation

| File | Purpose |
|---|---|
| `js/science.js` | Molecule builder, periodic table, DNA/RNA, anatomy |
| `js/lab.js` · `js/rts.js` | Chemistry lab reports; scientific calculator |
| `js/physics.js` · `js/physics_sims.js` | 2-D physics sandbox and extra simulations |
| `js/physics3d.js` · `js/space_sims.js` | 3-D sandbox; orbital and space simulations |
| `js/graph.js` | 2-D/3-D graphing and a matrix calculator |
| `js/galaxy.js` · `js/cosmos.js` · `js/starfield.js` | Milky Way ⇄ Solar System, NASA APOD, WASM starfield |

### Media and games

| File | Purpose |
|---|---|
| `js/music.js` · `js/audiobook.js` · `js/tuner.js` | Local music, text-to-speech books, instrument tuner |
| `js/karaoke.js` · `js/studio.js` | Karaoke; build/draw/plan/3D projects |
| `js/editor.js` · `js/video.js` · `js/camera.js` | Timeline video editor, ffmpeg trimming, subtitled capture |
| `js/chess.js` · `js/chess3d.js` · `js/chess-sounds.js` | Rules engine and bot, WebGL board, sound effects |
| `js/sudoku.js` | Generate, play, check, solve |

### Not first-party

`vendor/`, `js/ace/`, `js/xterm/`, `js/models/`, `js/GLTFLoader.js` and every
`*.min.js` are vendored third-party libraries. They are excluded from linting and
should not be edited — replace them wholesale instead.

---

## Repository layout

```
main.js                 Electron main process
index.html              the single renderer document
js/                     renderer features (see Module map)
css/                    styles and fonts
cpp/                    C++ sources for the WebAssembly modules
js/wasm/                compiled .wasm output (committed — emscripten optional)
vendor/, js/ace/…       vendored third-party libraries
build-extras/           packaging config, entitlements, deploy and helper scripts
server/                 self-hosted update, relay and workout services (see server/README.md)
```

The `server/` directory is deployed to a host separately and is deliberately
excluded from the packaged desktop app.

---

## Contributing

Before opening a pull request:

```bash
npm run lint
```

A few conventions this codebase follows, worth matching:

- Prefix new renderer globals so they cannot collide (`_myFeatureState`).
- Wrap genuinely self-contained modules in an IIFE and expose only entry points.
- Start each file with a short `// ── Name — one-line purpose ──` header. Almost
  every file has one, and the module map above is built from them.
- Explain *why* in comments, not *what*. The existing comments in `main.js` are a
  good reference for the level of detail expected around platform quirks.

## License

ISC — see [LICENSE](LICENSE).
