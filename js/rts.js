// Scientific Calculator

(function () {
    let _expr   = '';
    let _fresh  = false;
    let _history = [];
    let _mode   = 'basic';   // 'basic' | 'sci'
    let _deg    = true;      // true = degrees, false = radians

    // ── helpers ──────────────────────────────────────────────────

    function _format(n) {
        if (typeof n !== 'number') return 'Error';
        if (!isFinite(n)) return isNaN(n) ? 'Error' : (n > 0 ? '∞' : '-∞');
        // up to 10 significant figures, strip trailing zeros
        return parseFloat(n.toPrecision(10)).toString();
    }

    function _toRad(x) { return _deg ? x * Math.PI / 180 : x; }
    function _toDeg(x) { return _deg ? x * 180 / Math.PI : x; }

    function _factorial(n) {
        n = Math.round(n);
        if (n < 0 || n > 170) return NaN;
        let r = 1;
        for (let i = 2; i <= n; i++) r *= i;
        return r;
    }

    function _evaluate(raw) {
        try {
            // Replace display operators
            let e = raw
                .replace(/\^/g, '**')
                .replace(/(\d+(\.\d+)?)\s*%/g, '($1/100)');

            // Math function substitutions with trig angle handling
            e = e
                .replace(/\bsin\(/g,  `((_x)=>Math.sin(_toRad(_x)))(`)
                .replace(/\bcos\(/g,  `((_x)=>Math.cos(_toRad(_x)))(`)
                .replace(/\btan\(/g,  `((_x)=>Math.tan(_toRad(_x)))(`)
                .replace(/\basin\(/g, `((_x)=>_toDeg(Math.asin(_x)))(`)
                .replace(/\bacos\(/g, `((_x)=>_toDeg(Math.acos(_x)))(`)
                .replace(/\batan\(/g, `((_x)=>_toDeg(Math.atan(_x)))(`)
                .replace(/\bsqrt\(/g, 'Math.sqrt(')
                .replace(/\bcbrt\(/g, 'Math.cbrt(')
                .replace(/\babs\(/g,  'Math.abs(')
                .replace(/\bln\(/g,   'Math.log(')
                .replace(/\blog\(/g,  'Math.log10(')
                .replace(/\bfact\(/g, '_factorial(')
                .replace(/\bPI\b/g,   'Math.PI')
                .replace(/\bE\b/g,    'Math.E');

            // eslint-disable-next-line no-new-func
            return Function(
                '"use strict";' +
                'const _toRad=' + _toRad.toString() + ';' +
                'const _toDeg=' + _toDeg.toString() + ';' +
                'const _factorial=' + _factorial.toString() + ';' +
                'return (' + e + ');'
            )();
        } catch (_) {
            return NaN;
        }
    }

    function _display(val) {
        const d = document.getElementById('calc-display');
        if (d) d.textContent = val;
    }

    function _setExpr(raw) {
        const e = document.getElementById('calc-expr');
        if (e) e.textContent = raw || ' ';
    }

    function _exprPretty(raw) {
        return raw
            .replace(/\*\*/g, '^')
            .replace(/\*/g, '×')
            .replace(/\//g, '÷')
            || ' ';
    }

    function _currentNumber() {
        // last token after an operator/paren
        const m = _expr.match(/[\d.]+$/);
        return m ? m[0] : null;
    }

    function _renderHistory() {
        const el = document.getElementById('calc-history');
        if (!el) return;
        el.innerHTML = _history.map(h =>
            `<div class="truncate">${h}</div>`
        ).join('');
    }

    // ── public API ────────────────────────────────────────────────

    window.calcInput = function (btn) {
        const operators = ['+', '-', '*', '/'];

        // ── AC ──
        if (btn === 'AC') {
            _expr = ''; _fresh = false;
            _display('0'); _setExpr('');
            return;
        }

        // ── +/− ──
        if (btn === '+/-') {
            if (!_expr) return;
            const m = _expr.match(/^(.*[+\-*/\^(])?(-?)(\d*\.?\d+)$/);
            if (m) {
                _expr = (m[1] || '') + (m[2] === '-' ? '' : '-') + m[3];
                _setExpr(_exprPretty(_expr));
                const res = _evaluate(_expr);
                _display(isNaN(res) ? (_currentNumber() || '0') : _format(res));
            }
            return;
        }

        // ── constants ──
        if (btn === 'PI') {
            if (_fresh) { _expr = ''; _fresh = false; }
            _expr += 'PI';
            _setExpr(_exprPretty(_expr));
            _display(_format(Math.PI));
            return;
        }
        if (btn === 'E') {
            if (_fresh) { _expr = ''; _fresh = false; }
            _expr += 'E';
            _setExpr(_exprPretty(_expr));
            _display(_format(Math.E));
            return;
        }

        // ── = ──
        if (btn === '=') {
            if (!_expr) return;
            const res = _evaluate(_expr);
            const pretty = _exprPretty(_expr) + ' =';
            _history.unshift(pretty + ' ' + _format(res));
            if (_history.length > 30) _history.pop();
            _renderHistory();
            _expr = _format(res);
            _fresh = true;
            _display(_format(res));
            _setExpr(pretty);
            return;
        }

        // ── operators ──
        if (operators.includes(btn)) {
            if (!_expr) {
                if (btn === '-') { _expr = '-'; _display('-'); _setExpr('-'); }
                return;
            }
            _fresh = false;
            // replace trailing operator (but not closing paren or power)
            _expr = _expr.replace(/[+\-*/]$/, '') + btn;
            _setExpr(_exprPretty(_expr));
            const res = _evaluate(_expr.slice(0, -1));
            if (!isNaN(res)) _display(_format(res));
            return;
        }

        // ── power shortcuts ──
        if (btn === '^2') {
            if (!_expr) return;
            _fresh = false;
            _expr += '**2';
            const res = _evaluate(_expr);
            _display(isNaN(res) ? _expr : _format(res));
            _setExpr(_exprPretty(_expr));
            return;
        }
        if (btn === '^3') {
            if (!_expr) return;
            _fresh = false;
            _expr += '**3';
            const res = _evaluate(_expr);
            _display(isNaN(res) ? _expr : _format(res));
            _setExpr(_exprPretty(_expr));
            return;
        }
        if (btn === '^') {
            if (!_expr) return;
            _fresh = false;
            _expr += '**';
            _setExpr(_exprPretty(_expr));
            return;
        }

        // ── 1/x ──
        if (btn === '1/') {
            if (!_expr) return;
            _fresh = false;
            _expr = '1/(' + _expr + ')';
            const res = _evaluate(_expr);
            _display(isNaN(res) ? _expr : _format(res));
            _setExpr(_exprPretty(_expr));
            return;
        }

        // ── % (modulo / percent) ──
        if (btn === '%') {
            if (!_expr) return;
            _expr += '%';
            const res = _evaluate(_expr);
            _display(isNaN(res) ? _expr : _format(res));
            _setExpr(_exprPretty(_expr));
            return;
        }

        // ── function prefix e.g. 'sin(' ──
        if (btn.endsWith('(') && btn.length > 1) {
            if (_fresh) { _expr = ''; _fresh = false; }
            _expr += btn;
            _setExpr(_exprPretty(_expr));
            _display(btn.replace('(', '(…)'));
            return;
        }

        // ── parens ──
        if (btn === '(' || btn === ')') {
            if (_fresh) { _expr = ''; _fresh = false; }
            _expr += btn;
            _setExpr(_exprPretty(_expr));
            const res = _evaluate(_expr);
            if (!isNaN(res)) _display(_format(res));
            return;
        }

        // ── digit or dot ──
        if (_fresh) { _expr = ''; _fresh = false; }

        if (btn === '.') {
            // find last numeric segment
            const seg = _expr.split(/[+\-*/\^(]/).pop();
            if (seg.includes('.')) return;
            if (!seg || seg === '') _expr += '0';
        }

        _expr += btn;
        const seg = _expr.split(/[+\-*/\^()]/).pop() || '0';
        _display(seg);
        _setExpr(_exprPretty(_expr));
    };

    window.calcToggleHistory = function () {
        const el = document.getElementById('calc-history');
        if (!el) return;
        el.classList.toggle('hidden');
        _renderHistory();
    };

    window.calcSetMode = function (mode) {
        _mode = mode;
        const basic = document.getElementById('calc-basic-keys');
        const sci   = document.getElementById('calc-sci-keys');
        const mBasic = document.getElementById('calc-mode-basic');
        const mSci   = document.getElementById('calc-mode-sci');
        const angleBtn = document.getElementById('calc-angle-btn');
        if (!basic || !sci) return;

        if (mode === 'sci') {
            basic.classList.add('hidden');
            sci.classList.remove('hidden');
            mBasic.classList.remove('bg-indigo-600','text-white');
            mBasic.classList.add('text-slate-400');
            mSci.classList.add('bg-indigo-600','text-white');
            mSci.classList.remove('text-slate-400');
            if (angleBtn) angleBtn.style.display = '';
        } else {
            sci.classList.add('hidden');
            basic.classList.remove('hidden');
            mSci.classList.remove('bg-indigo-600','text-white');
            mSci.classList.add('text-slate-400');
            mBasic.classList.add('bg-indigo-600','text-white');
            mBasic.classList.remove('text-slate-400');
            if (angleBtn) angleBtn.style.display = 'none';
        }
    };

    window.calcToggleAngle = function () {
        _deg = !_deg;
        const btn = document.getElementById('calc-angle-btn');
        if (btn) btn.textContent = _deg ? 'DEG' : 'RAD';
    };

    window.calcReset = function () { /* preserve state on tab switch */ };

    // Keyboard support
    document.addEventListener('keydown', function (e) {
        const view = document.getElementById('view-rts');
        if (!view || !view.classList.contains('active')) return;
        const map = {
            '0':'0','1':'1','2':'2','3':'3','4':'4',
            '5':'5','6':'6','7':'7','8':'8','9':'9',
            '+':'+','-':'-','*':'*','/':'/','%':'%',
            '.':'.','Enter':'=','=':'=',
            'Backspace':'AC','Escape':'AC',
            '(':'(', ')':')', '^':'^'
        };
        if (map[e.key] !== undefined) {
            e.preventDefault();
            calcInput(map[e.key]);
        }
    });
})();
