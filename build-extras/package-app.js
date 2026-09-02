#!/usr/bin/env node
// ── Package Vulsor Browser with @electron/packager ───────────────────────────
// Replaces three near-identical 1,000-character npm one-liners. The ignore list
// was duplicated verbatim across all three; it now lives in exactly one place.
//
//   node build-extras/package-app.js darwin        → Vulsor Browser-darwin-arm64
//   node build-extras/package-app.js win32         → Vulsor Browser-win32-x64
//   node build-extras/package-app.js linux         → Vulsor Browser-linux-x64
//
// Prefer the npm aliases: `npm run build`, `build:win`, `build:linux`.
'use strict';

const path = require('path');
const { packager } = require('@electron/packager');

const ROOT = path.join(__dirname, '..');

// Everything that must NOT end up inside the shipped app bundle. Each entry is
// a regular-expression source string, matched by packager against a path that
// is relative to the project root and always starts with "/".
const IGNORE = [
    // Output of a previous packaging run — never nest a build inside a build.
    '^/Vulsor Browser-(darwin|win32|linux)-',
    '^/Verso-',

    // Server-side code: deployed to the update/relay host, not to the desktop app.
    '^/server(/|$)',

    // Sibling projects that live in this working tree but ship separately.
    '^/trip-planner($|/)',
    '^/Norsklab($|/)',
    '^/SpaceVoyage($|/)',
    '^/VulsoriOS($|/)',
    '^/VulsorPlay($|/)',
    '^/VulsorMind/dist($|/)',

    // Local tooling and editor state.
    '^/\\.claude($|/)',
    '^/\\.evs-venv($|/)',
    '^/\\.idea($|/)',
    '^/app_new\\.asar\\.unpacked($|/)',

    // Editor and terminal libraries are vendored under js/ace and js/xterm and
    // loaded from there, so the node_modules copies are dead weight in the bundle.
    '^/node_modules/ace-builds($|/)',
    '^/node_modules/xterm($|/)',
    '^/node_modules/xterm-addon-fit($|/)',

    // Large root-level assets and release archives.
    '^/[^/]+\\.glb$',
    '^/[^/]+\\.zip$',
];

// Options that differ per target. Everything else is shared.
const TARGETS = {
    darwin: {
        arch: 'arm64',
        icon: 'icon.icns',
        // Registers vulsor:// and the http/https handler entries.
        extendInfo: 'build-extras/url-types.plist',
    },
    win32: {
        arch: 'x64',
        icon: 'icon.ico',
        protocols: [
            { name: 'HTTP',  schemes: ['http']  },
            { name: 'HTTPS', schemes: ['https'] },
        ],
    },
    linux: {
        arch: 'x64',
    },
};

async function main() {
    const platform = process.argv[2];
    const target = TARGETS[platform];

    if (!target) {
        console.error(`Unknown platform "${platform ?? ''}". Expected one of: ${Object.keys(TARGETS).join(', ')}`);
        process.exit(1);
    }

    const { arch, ...platformOptions } = target;

    const paths = await packager({
        dir: ROOT,
        name: 'Vulsor Browser',
        platform,
        arch,
        overwrite: true,
        ignore: IGNORE.map(source => new RegExp(source)),
        ...platformOptions,
    });

    console.log(`Packaged ${platform}-${arch} →\n  ${paths.join('\n  ')}`);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
