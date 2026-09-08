// ── Finance — Expense, Income & Time Tracker ─────────────────────
// Depends on: globals.js (fs, path, FINANCE_FILE, financeData)

function loadFinanceData() {
    try {
        if (fs.existsSync(FINANCE_FILE)) {
            const d = JSON.parse(fs.readFileSync(FINANCE_FILE, 'utf8'));
            return { transactions: d.transactions || [], timeEntries: d.timeEntries || [], currency: d.currency || 'USD' };
        }
    } catch(_) {}
    return { transactions: [], timeEntries: [], currency: 'USD' };
}
function saveFinanceData() {
    fs.writeFileSync(FINANCE_FILE, JSON.stringify(financeData, null, 2));
}

// ── State ──────────────────────────────────────────────────────────
let financePeriod = 'month';
let financeEditId = null;
let finChartType  = 'bar';

const CURRENCIES = [
    { code: 'USD', symbol: '$',  name: 'US Dollar'        },
    { code: 'EUR', symbol: '€',  name: 'Euro'             },
    { code: 'GBP', symbol: '£',  name: 'British Pound'    },
    { code: 'JPY', symbol: '¥',  name: 'Japanese Yen'     },
    { code: 'CNY', symbol: '¥',  name: 'Chinese Yuan'     },
    { code: 'CAD', symbol: 'CA$',name: 'Canadian Dollar'  },
    { code: 'AUD', symbol: 'A$', name: 'Australian Dollar'},
    { code: 'CHF', symbol: 'Fr', name: 'Swiss Franc'      },
    { code: 'INR', symbol: '₹',  name: 'Indian Rupee'     },
    { code: 'BRL', symbol: 'R$', name: 'Brazilian Real'   },
    { code: 'MXN', symbol: 'MX$',name: 'Mexican Peso'     },
    { code: 'KRW', symbol: '₩',  name: 'Korean Won'       },
    { code: 'SEK', symbol: 'kr', name: 'Swedish Krona'    },
    { code: 'NOK', symbol: 'kr', name: 'Norwegian Krone'  },
    { code: 'DKK', symbol: 'kr', name: 'Danish Krone'     },
    { code: 'SGD', symbol: 'S$', name: 'Singapore Dollar' },
    { code: 'HKD', symbol: 'HK$',name: 'Hong Kong Dollar' },
    { code: 'NZD', symbol: 'NZ$',name: 'New Zealand Dollar'},
    { code: 'ZAR', symbol: 'R',  name: 'South African Rand'},
    { code: 'AED', symbol: 'د.إ',name: 'UAE Dirham'       },
];

function finCurrencySymbol() {
    const cur = CURRENCIES.find(c => c.code === (financeData.currency || 'USD'));
    return cur ? cur.symbol : '$';
}

const FINANCE_CATEGORIES = [
    'Salary','Freelance','Investment','Gift','Other Income',
    'Food','Transport','Housing','Entertainment','Health',
    'Shopping','Education','Subscriptions','Utilities','Other',
];

// ── Date helpers ───────────────────────────────────────────────────
function finToday() { return new Date().toISOString().slice(0, 10); }

function finPeriodStart(period) {
    const n = new Date();
    if (period === 'today')  return n.toISOString().slice(0, 10);
    if (period === 'week')   { const d = new Date(n); d.setDate(d.getDate() - d.getDay()); return d.toISOString().slice(0,10); }
    if (period === 'month')  return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-01`;
    if (period === 'year')   return `${n.getFullYear()}-01-01`;
    return null;
}

function finInPeriod(dateStr, period) {
    if (period === 'all') return true;
    const start = finPeriodStart(period);
    return dateStr >= start && dateStr <= finToday();
}

function fmtMoney(n) {
    const sym = finCurrencySymbol();
    const abs = Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (n < 0 ? '-' : '') + sym + abs;
}

function fmtDuration(ms) {
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    if (h > 0) return `${h}h ${String(m).padStart(2,'0')}m`;
    return `${String(m).padStart(2,'0')}m ${String(sec).padStart(2,'0')}s`;
}

function fmtTimerDisplay(ms) {
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    if (h > 0) return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
    return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
}

function finDateLabel(dateStr) {
    const today = finToday();
    const yest  = new Date(); yest.setDate(yest.getDate() - 1);
    const yStr  = yest.toISOString().slice(0,10);
    if (dateStr === today) return 'Today';
    if (dateStr === yStr)  return 'Yesterday';
    return new Date(dateStr + 'T12:00:00').toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

// ── Recurring ─────────────────────────────────────────────────────
function processRecurring() {
    const today = finToday();
    let changed = false;
    financeData.transactions
        .filter(t => t.repeat && t.nextDate && t.nextDate <= today)
        .forEach(t => {
            financeData.transactions.push({
                ...t,
                id: 'tr_' + Date.now() + '_' + Math.random().toString(36).slice(2,5),
                date: t.nextDate,
                repeat: null, nextDate: null,
                createdAt: Date.now(),
            });
            const nd = new Date(t.nextDate + 'T12:00:00');
            if (t.repeat === 'daily')   nd.setDate(nd.getDate() + 1);
            if (t.repeat === 'weekly')  nd.setDate(nd.getDate() + 7);
            if (t.repeat === 'monthly') nd.setMonth(nd.getMonth() + 1);
            if (t.repeat === 'yearly')  nd.setFullYear(nd.getFullYear() + 1);
            t.nextDate = nd.toISOString().slice(0, 10);
            changed = true;
        });
    if (changed) saveFinanceData();
}

// ── Stats ──────────────────────────────────────────────────────────
function finStats(period) {
    const txs      = financeData.transactions.filter(t => finInPeriod(t.date, period));
    const income   = txs.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    const expenses = txs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    return { income, expenses, balance: income - expenses };
}

// ── Render ─────────────────────────────────────────────────────────
function renderFinanceSummary() {
    const { income, expenses, balance } = finStats(financePeriod);

    const balEl = document.getElementById('finance-balance');
    balEl.textContent = fmtMoney(balance);
    balEl.className   = `text-3xl font-bold tabular-nums ${balance >= 0 ? 'text-green-400' : 'text-red-400'}`;
    document.getElementById('finance-income').textContent   = fmtMoney(income);
    document.getElementById('finance-expenses').textContent = fmtMoney(expenses);

    ['today','week','month','year','all'].forEach(p => {
        const btn = document.getElementById(`fin-period-${p}`);
        if (btn) btn.classList.toggle('active', p === financePeriod);
    });
}

function renderTransactions() {
    const listEl = document.getElementById('finance-tx-list');
    if (!listEl) return;

    let txs = financeData.transactions.filter(t => finInPeriod(t.date, financePeriod));
    txs.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);

    if (!txs.length) {
        listEl.innerHTML = '<p class="text-slate-600 text-xs text-center py-12 italic">No transactions yet — click + Add to get started.</p>';
        return;
    }

    // Group by date
    const byDate = {};
    txs.forEach(t => (byDate[t.date] = byDate[t.date] || []).push(t));

    listEl.innerHTML = Object.entries(byDate)
        .sort(([a],[b]) => b.localeCompare(a))
        .map(([date, items]) => {
            const rows = items.map(t => {
                const isInc  = t.type === 'income';
                const clr    = isInc ? '#34d399' : '#f87171';
                const amtStr = (isInc ? '+' : '-') + fmtMoney(t.amount);
                return `<div class="fin-tx-row group flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-slate-800/50 cursor-pointer transition-colors" data-id="${t.id}">
                    <div class="w-8 h-8 rounded-xl flex items-center justify-center shrink-0" style="background:${clr}18">
                        <i class="fas ${isInc ? 'fa-arrow-down' : 'fa-arrow-up'} text-[11px]" style="color:${clr}"></i>
                    </div>
                    <div class="flex-1 min-w-0">
                        <p class="text-slate-200 text-sm font-medium truncate">${t.description}</p>
                        <p class="text-slate-600 text-[11px]">${t.category || ''}${t.repeat ? ' · repeats ' + t.repeat : ''}</p>
                    </div>
                    <span class="text-sm font-semibold tabular-nums shrink-0" style="color:${clr}">${amtStr}</span>
                    <button class="fin-tx-del opacity-0 group-hover:opacity-100 w-6 h-6 flex items-center justify-center rounded-lg text-slate-600 hover:text-red-400 hover:bg-red-400/10 transition-all shrink-0" data-id="${t.id}">
                        <i class="fas fa-trash text-[9px]"></i>
                    </button>
                </div>`;
            }).join('');
            return `<div class="mb-1">
                <p class="text-slate-600 text-[10px] font-semibold uppercase tracking-widest px-3 pt-3 pb-1">${finDateLabel(date)}</p>
                ${rows}
            </div>`;
        }).join('');

    listEl.querySelectorAll('.fin-tx-del').forEach(btn => {
        btn.onclick = e => {
            e.stopPropagation();
            if (!confirm('Delete this transaction?')) return;
            financeData.transactions = financeData.transactions.filter(t => t.id !== btn.dataset.id);
            saveFinanceData();
            renderTransactions();
            renderFinanceSummary();
        };
    });
    listEl.querySelectorAll('.fin-tx-row').forEach(row => {
        row.onclick = e => {
            if (e.target.closest('.fin-tx-del')) return;
            openFinanceModal(row.dataset.id);
        };
    });
}

// ── Recurring list ─────────────────────────────────────────────────
function renderRecurring() {
    const listEl = document.getElementById('finance-recurring-list');
    if (!listEl) return;
    const recur = financeData.transactions.filter(t => t.repeat);
    if (!recur.length) {
        listEl.innerHTML = '<p class="text-slate-700 text-xs text-center py-4 italic">No recurring transactions</p>';
        return;
    }
    listEl.innerHTML = recur.map(t => {
        const isInc = t.type === 'income';
        const clr   = isInc ? '#34d399' : '#f87171';
        return `<div class="group flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-slate-800/40 transition-colors">
            <div class="w-6 h-6 rounded-lg flex items-center justify-center shrink-0" style="background:${clr}18">
                <i class="fas fa-redo text-[9px]" style="color:${clr}"></i>
            </div>
            <div class="flex-1 min-w-0">
                <p class="text-slate-300 text-xs font-medium truncate">${t.description}</p>
                <p class="text-slate-600 text-[10px]">${t.repeat} · next ${t.nextDate || t.date}</p>
            </div>
            <span class="text-xs font-semibold tabular-nums shrink-0" style="color:${clr}">${fmtMoney(t.amount)}</span>
            <button class="fin-recur-del opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center justify-center text-slate-600 hover:text-red-400 transition-all" data-id="${t.id}">
                <i class="fas fa-times text-[9px]"></i>
            </button>
        </div>`;
    }).join('');
    listEl.querySelectorAll('.fin-recur-del').forEach(btn => {
        btn.onclick = () => {
            financeData.transactions = financeData.transactions.filter(t => t.id !== btn.dataset.id);
            saveFinanceData();
            renderRecurring();
            renderTransactions();
            renderFinanceSummary();
        };
    });
}


// ── Modal ──────────────────────────────────────────────────────────
function openFinanceModal(editId) {
    financeEditId = editId || null;
    const tx = editId ? financeData.transactions.find(t => t.id === editId) : null;
    const isInc = !tx || tx.type === 'income';

    document.getElementById('fin-modal-type-inc').classList.toggle('active',  isInc);
    document.getElementById('fin-modal-type-exp').classList.toggle('active',  !isInc);
    document.getElementById('fin-modal-amount').value   = tx ? tx.amount   : '';
    document.getElementById('fin-modal-desc').value     = tx ? tx.description : '';
    document.getElementById('fin-modal-date').value     = tx ? tx.date     : finToday();
    document.getElementById('fin-modal-repeat').value   = tx ? (tx.repeat || '') : '';

    const catSel = document.getElementById('fin-modal-cat');
    catSel.innerHTML = FINANCE_CATEGORIES.map(c => `<option value="${c}">${c}</option>`).join('');
    if (tx && tx.category) catSel.value = tx.category;

    document.getElementById('fin-modal-title').textContent   = editId ? 'Edit Transaction' : 'Add Transaction';
    document.getElementById('fin-modal-save-btn').textContent = editId ? 'Save Changes' : 'Add';
    document.getElementById('finance-modal').classList.add('open');
    document.getElementById('fin-modal-amount').focus();
}

function closeFinanceModal() {
    document.getElementById('finance-modal').classList.remove('open');
    financeEditId = null;
}

function saveFinanceModal() {
    const isInc  = document.getElementById('fin-modal-type-inc').classList.contains('active');
    const amount = parseFloat(document.getElementById('fin-modal-amount').value);
    if (isNaN(amount) || amount <= 0) { document.getElementById('fin-modal-amount').focus(); return; }

    const desc     = document.getElementById('fin-modal-desc').value.trim();
    const date     = document.getElementById('fin-modal-date').value || finToday();
    const category = document.getElementById('fin-modal-cat').value;
    const repeat   = document.getElementById('fin-modal-repeat').value || null;

    let nextDate = null;
    if (repeat) {
        const nd = new Date(date + 'T12:00:00');
        if (repeat === 'daily')   nd.setDate(nd.getDate() + 1);
        if (repeat === 'weekly')  nd.setDate(nd.getDate() + 7);
        if (repeat === 'monthly') nd.setMonth(nd.getMonth() + 1);
        if (repeat === 'yearly')  nd.setFullYear(nd.getFullYear() + 1);
        nextDate = nd.toISOString().slice(0, 10);
    }

    if (financeEditId) {
        const tx = financeData.transactions.find(t => t.id === financeEditId);
        if (tx) Object.assign(tx, { type: isInc ? 'income' : 'expense', amount, description: desc || (isInc ? 'Income' : 'Expense'), date, category, repeat, nextDate });
    } else {
        financeData.transactions.push({
            id: 'tr_' + Date.now(), type: isInc ? 'income' : 'expense',
            amount, description: desc || (isInc ? 'Income' : 'Expense'),
            category, date, repeat, nextDate, createdAt: Date.now(),
        });
    }
    saveFinanceData();
    closeFinanceModal();
    renderTransactions();
    renderRecurring();
    renderFinanceSummary();
}

// ── Chart ──────────────────────────────────────────────────────────
let finChartInstance = null;

function buildChartBuckets(period) {
    const today = new Date();
    const buckets = []; // [{label, income, expense}]

    if (period === 'today') {
        // 24 hours
        for (let h = 0; h < 24; h++) {
            buckets.push({ label: `${String(h).padStart(2,'0')}:00`, income: 0, expense: 0,
                test: t => new Date(t.date + 'T12:00:00').toDateString() === today.toDateString() && true,
                hMatch: h });
        }
        financeData.transactions.forEach(t => {
            if (t.date !== finToday()) return;
            const h = new Date(t.createdAt).getHours();
            if (t.type === 'income')  buckets[h].income  += t.amount;
            else                      buckets[h].expense += t.amount;
        });
        // Trim trailing empty buckets to current hour + 1
        const cutoff = today.getHours() + 1;
        return buckets.slice(0, cutoff);
    }

    if (period === 'week') {
        const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
        const weekStart = new Date(today); weekStart.setDate(today.getDate() - today.getDay());
        for (let i = 0; i < 7; i++) {
            const d = new Date(weekStart); d.setDate(weekStart.getDate() + i);
            const ds = d.toISOString().slice(0, 10);
            buckets.push({ label: days[i], dateStr: ds, income: 0, expense: 0 });
        }
        financeData.transactions.forEach(t => {
            const b = buckets.find(b => b.dateStr === t.date);
            if (!b) return;
            if (t.type === 'income') b.income += t.amount; else b.expense += t.amount;
        });
        return buckets;
    }

    if (period === 'month') {
        const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
        const prefix = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-`;
        for (let d = 1; d <= daysInMonth; d++) {
            buckets.push({ label: String(d), dateStr: prefix + String(d).padStart(2,'0'), income: 0, expense: 0 });
        }
        financeData.transactions.forEach(t => {
            const b = buckets.find(b => b.dateStr === t.date);
            if (!b) return;
            if (t.type === 'income') b.income += t.amount; else b.expense += t.amount;
        });
        return buckets;
    }

    if (period === 'year') {
        const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const yr = today.getFullYear();
        for (let m = 0; m < 12; m++) {
            buckets.push({ label: months[m], prefix: `${yr}-${String(m+1).padStart(2,'0')}-`, income: 0, expense: 0 });
        }
        financeData.transactions.forEach(t => {
            const b = buckets.find(b => t.date.startsWith(b.prefix));
            if (!b) return;
            if (t.type === 'income') b.income += t.amount; else b.expense += t.amount;
        });
        return buckets;
    }

    // 'all' — group by year-month
    const seen = {};
    financeData.transactions.forEach(t => {
        const key = t.date.slice(0, 7);
        if (!seen[key]) seen[key] = { label: key, income: 0, expense: 0 };
        if (t.type === 'income') seen[key].income += t.amount; else seen[key].expense += t.amount;
    });
    return Object.values(seen).sort((a,b) => a.label.localeCompare(b.label));
}

function renderFinanceChart() {
    const canvas = document.getElementById('fin-chart');
    if (!canvas) return;
    // Chart.js is not in the startup bundle any more (200KB nobody needs until
    // they open Finance) — pull it in, then draw.
    if (typeof Chart === 'undefined') {
        if (typeof vulsorLoadChart !== 'function') return;
        vulsorLoadChart()
            .then(() => renderFinanceChart())
            .catch(e => console.error('[finance] Chart.js failed to load:', e));
        return;
    }
    const sym = finCurrencySymbol();
    if (finChartInstance) { finChartInstance.destroy(); finChartInstance = null; }

    const tooltipDefaults = {
        backgroundColor: '#1e293b', borderColor: '#334155', borderWidth: 1,
        titleColor: '#e2e8f0', bodyColor: '#94a3b8', padding: 10,
    };
    const legendDefaults = { labels: { color: '#94a3b8', font: { size: 11 }, boxWidth: 10, padding: 14 } };

    // ── Doughnut / Pie ──
    if (finChartType === 'doughnut') {
        const { income, expenses } = finStats(financePeriod);
        finChartInstance = new Chart(canvas, {
            type: 'doughnut',
            data: {
                labels: ['Income', 'Expenses'],
                datasets: [{ data: [income, expenses],
                    backgroundColor: ['rgba(52,211,153,0.75)','rgba(248,113,113,0.75)'],
                    borderColor:     ['rgba(52,211,153,1)', 'rgba(248,113,113,1)'],
                    borderWidth: 2, hoverOffset: 8,
                }],
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                animation: { duration: 400 },
                plugins: {
                    legend: legendDefaults,
                    tooltip: { ...tooltipDefaults, callbacks: { label: ctx => `  ${ctx.label}: ${sym}${ctx.parsed.toFixed(2)}` } },
                },
            },
        });
        return;
    }

    // ── Bar / Line / Area ──
    const buckets = buildChartBuckets(financePeriod);
    const isLine  = finChartType === 'line' || finChartType === 'area';
    const fill    = finChartType === 'area';

    finChartInstance = new Chart(canvas, {
        type: isLine ? 'line' : 'bar',
        data: {
            labels: buckets.map(b => b.label),
            datasets: [
                {
                    label: 'Income',
                    data: buckets.map(b => b.income),
                    backgroundColor: fill ? 'rgba(52,211,153,0.12)' : 'rgba(52,211,153,0.5)',
                    borderColor: 'rgba(52,211,153,0.9)',
                    borderWidth: isLine ? 2 : 1,
                    borderRadius: isLine ? 0 : 5,
                    pointRadius: isLine ? 3 : 0,
                    pointBackgroundColor: 'rgba(52,211,153,1)',
                    pointHoverRadius: 5,
                    tension: 0.4, fill,
                },
                {
                    label: 'Expenses',
                    data: buckets.map(b => b.expense),
                    backgroundColor: fill ? 'rgba(248,113,113,0.12)' : 'rgba(248,113,113,0.5)',
                    borderColor: 'rgba(248,113,113,0.9)',
                    borderWidth: isLine ? 2 : 1,
                    borderRadius: isLine ? 0 : 5,
                    pointRadius: isLine ? 3 : 0,
                    pointBackgroundColor: 'rgba(248,113,113,1)',
                    pointHoverRadius: 5,
                    tension: 0.4, fill,
                },
            ],
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            animation: { duration: 300 },
            plugins: {
                legend: legendDefaults,
                tooltip: { ...tooltipDefaults, callbacks: { label: ctx => `  ${ctx.dataset.label}: ${sym}${ctx.parsed.y.toFixed(2)}` } },
            },
            scales: {
                x: { ticks: { color: '#475569', font: { size: 10 }, maxRotation: 0 }, grid: { color: 'rgba(51,65,85,0.35)' } },
                y: { ticks: { color: '#475569', font: { size: 10 }, callback: v => sym + v }, grid: { color: 'rgba(51,65,85,0.35)' }, beginAtZero: true },
            },
        },
    });
}


// ── Currency selector ──────────────────────────────────────────────
function renderCurrencySelect() {
    const sel = document.getElementById('fin-currency-select');
    if (!sel) return;
    sel.innerHTML = CURRENCIES.map(c =>
        `<option value="${c.code}">${c.symbol} ${c.code} — ${c.name}</option>`
    ).join('');
    sel.value = financeData.currency || 'USD';
}

// ── Init ───────────────────────────────────────────────────────────
function initFinance() {
    financeData = loadFinanceData();
    processRecurring();
    renderCurrencySelect();

    // Period buttons
    ['today','week','month','year','all'].forEach(p => {
        document.getElementById(`fin-period-${p}`).onclick = () => {
            financePeriod = p;
            renderFinanceSummary();
            renderTransactions();
            renderFinanceChart();
        };
    });

    // Chart type buttons
    document.querySelectorAll('.fin-chart-type-btn').forEach(btn => {
        btn.onclick = () => {
            finChartType = btn.dataset.chart;
            document.querySelectorAll('.fin-chart-type-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderFinanceChart();
        };
    });

    document.getElementById('finance-add-btn').onclick = () => openFinanceModal();

    document.getElementById('fin-currency-select').onchange = e => {
        financeData.currency = e.target.value;
        saveFinanceData();
        renderFinanceSummary();
        renderTransactions();
        renderRecurring();
        renderFinanceChart();
    };

    // Modal
    document.getElementById('fin-modal-type-inc').onclick = () => {
        document.getElementById('fin-modal-type-inc').classList.add('active');
        document.getElementById('fin-modal-type-exp').classList.remove('active');
    };
    document.getElementById('fin-modal-type-exp').onclick = () => {
        document.getElementById('fin-modal-type-exp').classList.add('active');
        document.getElementById('fin-modal-type-inc').classList.remove('active');
    };
    document.getElementById('fin-modal-save-btn').onclick   = saveFinanceModal;
    document.getElementById('fin-modal-cancel-btn').onclick = closeFinanceModal;
    document.getElementById('fin-modal-amount').onkeypress  = e => { if (e.key === 'Enter') saveFinanceModal(); };

    renderFinanceSummary();
    renderTransactions();
    renderRecurring();
    // No chart here: Finance is not on screen at startup, and drawing it pulls
    // in Chart.js — a script fetched during page load, which holds back the
    // load event and with it the window. _activateView('finance') draws it when
    // the view is actually opened.
}
