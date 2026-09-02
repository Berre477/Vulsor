// ── ESLint configuration ─────────────────────────────────────────────────────
// Tuned to catch real defects, not to enforce a style. Vulsor's renderer is ~50
// classic <script> files sharing one global scope (see README → Architecture),
// so rules that assume modules or a declared global list are deliberately off.
//
//   npm run lint
export default [
    {
        // Third-party and generated code is not ours to lint.
        ignores: [
            'node_modules/**',
            'vendor/**',
            'js/ace/**',
            'js/xterm/**',
            'js/models/**',
            'js/**/*.min.js',
            'js/GLTFLoader.js',
            'Vulsor Browser-*/**',
            'Verso-*/**',
            'trip-planner/**',
            'Norsklab/**',
            'SpaceVoyage/**',
            'VulsorMind/**',
            'VulsorPlay/**',
            'VulsoriOS/**',
            '.evs-venv/**',
        ],
    },
    {
        files: ['**/*.js'],
        languageOptions: {
            ecmaVersion: 2023,
            // Every file here is a classic script: the renderer loads them via
            // <script src>, and the Electron main process uses CommonJS.
            sourceType: 'script',
        },
        rules: {
            // ── Genuine bugs ────────────────────────────────────────────────
            'no-dupe-keys': 'error',
            'no-dupe-args': 'error',
            'no-dupe-class-members': 'error',
            'no-dupe-else-if': 'error',
            'no-duplicate-case': 'error',
            'no-unreachable': 'error',
            'no-const-assign': 'error',
            'no-class-assign': 'error',
            'no-func-assign': 'error',
            'no-self-assign': 'error',
            'no-self-compare': 'error',
            'no-compare-neg-zero': 'error',
            'no-constant-binary-expression': 'error',
            'no-unsafe-negation': 'error',
            'no-unsafe-optional-chaining': 'error',
            'no-sparse-arrays': 'error',
            'no-obj-calls': 'error',
            'no-setter-return': 'error',
            'getter-return': 'error',
            'no-ex-assign': 'error',
            'no-invalid-regexp': 'error',
            'no-misleading-character-class': 'error',
            'no-new-native-nonconstructor': 'error',
            'no-loss-of-precision': 'error',
            'no-async-promise-executor': 'error',
            'use-isnan': 'error',
            'valid-typeof': 'error',
            'no-fallthrough': 'error',
            'no-redeclare': 'error',

            // Vulsor compiles user-typed math expressions into functions in two
            // places. Both are annotated at the call site; the rule is on so a
            // third, unconsidered use has to be justified too.
            'no-new-func': 'error',

            // `while ((m = re.exec(s)))` is used throughout the parsers here.
            // The extra parentheses are the signal that the assignment is meant.
            'no-cond-assign': ['error', 'except-parens'],

            // Swallowing an error is a deliberate, very common pattern in this
            // codebase (optional integrations, missing DOM nodes); an empty
            // block anywhere else is a mistake.
            'no-empty': ['error', { allowEmptyCatch: true }],

            // ── Off on purpose ──────────────────────────────────────────────
            // Renderer scripts share one global scope and intentionally call
            // across files, so there is no meaningful global list to check.
            'no-undef': 'off',
            // Reading a property off a plain object literal is fine here.
            'no-prototype-builtins': 'off',
        },
    },
];
