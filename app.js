/*
 * Makati Budget — page logic.
 * Reads the plan from localStorage, pulls the live USD→PHP rate, and redraws
 * every number whenever the rate or any input changes. Budget math lives in
 * budget.js.
 */
(function () {
  'use strict';

  const B = window.Budget;
  const $ = (sel, root = document) => root.querySelector(sel);

  const CFG_KEY = 'makati-budget:config:v1';
  const FX_KEY = 'makati-budget:fx:v1';
  const REFRESH_EVERY = 60 * 60 * 1000; // re-check the rate hourly
  const POLL_EVERY = 10 * 60 * 1000; // how often to ask "is it time yet?"
  // Used only if the rate services have never answered on this device.
  const FALLBACK = { rate: 63.81, asOf: '2026-11-13', source: 'built-in rate' };

  const GROUP_INFO = {
    Housing: { label: 'Rent', color: 'var(--c-housing)', note: '' },
    Bills: { label: 'Bills', color: 'var(--c-bills)', note: '' },
    Subscriptions: { label: 'Subscriptions', color: 'var(--c-subs)', note: '$ items follow the rate' },
    Living: { label: 'Spending money', color: 'var(--c-living)', note: 'Food, getting around, going out' },
  };
  const BASIS = {
    live: { name: "today's rate", hint: "Today's market rate. The plan moves with it day to day." },
    avg30: { name: '30-day average', hint: 'Smooths out day-to-day noise for a steadier plan.' },
    low90: { name: '90-day low', hint: 'The weakest dollar of the last 90 days. Plan on this and most months come in better.' },
    custom: { name: 'what-if rate', hint: 'Drag to see what a stronger or weaker dollar does to your month.' },
  };

  // ---------- formatting ----------
  const pesoFmt = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 0 });
  const usdFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
  const peso = (n) => pesoFmt.format(Math.round(n) || 0);
  const usd = (n) => usdFmt.format(n || 0);
  const rateTxt = (r) => (r ? '₱' + r.toFixed(2) : '—');
  const signedPeso = (n) => (Math.round(n) >= 0 ? '+' : '−') + peso(Math.abs(n));
  const pct = (n) => Math.round(n * 100) + '%';
  const cap1 = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  const todayISO = () =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const fmtDay = (iso) =>
    new Date(B.isoToUTC(iso)).toLocaleDateString('en-PH', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });
  const fmtMonth = (ym) =>
    new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7) - 1, 1)).toLocaleDateString('en-PH', { timeZone: 'UTC', month: 'short', year: 'numeric' });
  // The Manila calendar day a rate belongs to (sources give either a date or a timestamp).
  const asOfDay = (asOf) =>
    asOf.length <= 10
      ? asOf
      : new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(asOf));
  const fmtAsOf = (asOf) => {
    if (!asOf) return '';
    if (asOf.length <= 10) return fmtDay(asOf);
    return new Date(asOf).toLocaleString('en-PH', { timeZone: 'Asia/Manila', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  };

  // ---------- storage (always optional) ----------
  const store = {
    get(key) {
      try {
        return JSON.parse(localStorage.getItem(key));
      } catch (_) {
        return null;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch (_) {
        /* private mode or storage blocked: the page still works, it just forgets */
      }
    },
  };

  function loadConfig() {
    const d = structuredClone(B.DEFAULTS);
    const saved = store.get(CFG_KEY);
    if (!saved || saved.version !== d.version) return d;
    return {
      ...d,
      ...saved,
      income: { ...d.income, ...saved.income },
      caps: { ...d.caps, ...saved.caps },
      items: Array.isArray(saved.items) ? saved.items : d.items,
    };
  }

  let cfg = loadConfig();
  let fx = store.get(FX_KEY) || { live: null, history: [], fetchedAt: 0, error: false };
  let fxLoading = false;
  const save = () => store.set(CFG_KEY, cfg);

  // ---------- exchange rate ----------
  async function getJSON(url) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 9000);
    try {
      const res = await fetch(url, { signal: ctl.signal, cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  // Tried in order until one answers.
  const LIVE_SOURCES = [
    {
      name: 'ExchangeRate-API',
      url: 'https://open.er-api.com/v6/latest/USD',
      pick: (d) => ({ rate: d.rates.PHP, asOf: new Date(d.time_last_update_unix * 1000).toISOString() }),
    },
    {
      name: 'Frankfurter (ECB)',
      url: 'https://api.frankfurter.dev/v1/latest?base=USD&symbols=PHP',
      pick: (d) => ({ rate: d.rates.PHP, asOf: d.date }),
    },
    {
      name: 'Currency API',
      url: 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.min.json',
      pick: (d) => ({ rate: d.usd.php, asOf: d.date }),
    },
  ];

  async function fetchLive() {
    for (const src of LIVE_SOURCES) {
      try {
        const p = src.pick(await getJSON(src.url));
        if (p.rate > 0) return { ...p, source: src.name };
      } catch (_) {
        /* try the next source */
      }
    }
    throw new Error('No rate source answered');
  }

  async function fetchHistory() {
    const start = B.addDaysISO(todayISO(), -95);
    const d = await getJSON(`https://api.frankfurter.dev/v1/${start}..?base=USD&symbols=PHP`);
    return Object.keys(d.rates)
      .sort()
      .map((date) => ({ date, rate: d.rates[date].PHP }))
      .filter((h) => h.rate > 0);
  }

  async function refreshRates(force) {
    if (fxLoading) return;
    if (!force && fx.live && Date.now() - fx.fetchedAt < REFRESH_EVERY) return;
    fxLoading = true;
    updateFxStatus();
    const [live, hist] = await Promise.allSettled([fetchLive(), fetchHistory()]);
    if (live.status === 'fulfilled') {
      fx.live = live.value;
      fx.fetchedAt = Date.now();
      fx.error = false;
    } else {
      fx.error = true;
    }
    if (hist.status === 'fulfilled' && hist.value.length) fx.history = hist.value;
    fxLoading = false;
    store.set(FX_KEY, fx);
    update();
  }

  /** History plus today's live rate, so the chart ends at "now". */
  function historyWithLive() {
    const hist = Array.isArray(fx.history) ? fx.history.slice() : [];
    const live = fx.live;
    if (live) {
      const day = asOfDay(live.asOf);
      const last = hist[hist.length - 1];
      if (!last || last.date < day) hist.push({ date: day, rate: live.rate });
      else if (last.date === day) hist[hist.length - 1] = { date: day, rate: live.rate };
    }
    return hist;
  }

  function rateOptions() {
    const live = (fx.live || FALLBACK).rate;
    const st = B.rateStats(historyWithLive(), todayISO());
    return { live, avg30: st.avg30, low90: st.low90, custom: Number(cfg.customRate) || null };
  }

  function activeRate(opts) {
    const v = opts[cfg.rateBasis];
    return v && v > 0 ? v : opts.live;
  }

  // ---------- plan ledger (built on structure changes only) ----------
  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function newId() {
    return 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function itemRow(it) {
    const row = el('div', 'row');
    row.dataset.id = it.id;

    const nameWrap = el('div', 'name-wrap');
    const name = el('input');
    name.type = 'text';
    name.id = 'name-' + it.id;
    name.value = it.name;
    name.placeholder = 'New item';
    name.setAttribute('aria-label', 'Item name');
    const est = el('span', 'est', 'est.');
    est.title = 'A guess. Type your real amount and this tag goes away.';
    est.hidden = !it.est;
    nameWrap.append(name, est);

    const amt = el('div', 'amt');
    const cur = el('select');
    cur.id = 'cur-' + it.id;
    cur.setAttribute('aria-label', 'Currency');
    for (const [val, sym] of [['PHP', '₱'], ['USD', '$']]) {
      const o = el('option', null, sym);
      o.value = val;
      cur.append(o);
    }
    cur.value = it.currency;
    cur.classList.toggle('is-usd', it.currency === 'USD');
    const amount = el('input');
    amount.type = 'number';
    amount.id = 'amt-' + it.id;
    amount.min = '0';
    amount.step = 'any';
    amount.inputMode = 'decimal';
    amount.value = it.amount;
    amount.setAttribute('aria-label', 'Monthly amount');
    amt.append(cur, amount);

    const month = el('output', 'num month');
    const check = el('output', 'num check');
    const del = el('button', 'del', '×');
    del.type = 'button';
    del.setAttribute('aria-label', 'Remove ' + (it.name || 'item'));

    row.append(nameWrap, amt, month, check, del);

    name.addEventListener('input', () => {
      it.name = name.value;
      del.setAttribute('aria-label', 'Remove ' + (it.name || 'item'));
      save();
    });
    amount.addEventListener('input', () => {
      it.amount = parseFloat(amount.value) || 0;
      if (it.est) {
        it.est = false;
        est.hidden = true;
      }
      save();
      update();
    });
    cur.addEventListener('change', () => {
      it.currency = cur.value;
      cur.classList.toggle('is-usd', it.currency === 'USD');
      save();
      update();
    });
    del.addEventListener('click', () => {
      cfg.items = cfg.items.filter((x) => x !== it);
      save();
      renderPlan();
      update();
    });
    return row;
  }

  function renderPlan() {
    const host = $('#planBody');
    host.textContent = '';
    for (const g of B.GROUPS) {
      const info = GROUP_INFO[g];
      const group = el('div', 'group');
      group.dataset.group = g;

      const head = el('div', 'group-head');
      const h3 = el('h3');
      const swatch = el('i');
      swatch.style.background = info.color;
      h3.append(swatch, document.createTextNode(info.label));
      head.append(h3);
      if (info.note) head.append(el('span', 'group-note', info.note));
      const total = el('span', 'group-total');
      const totalNum = el('span', 'num');
      totalNum.dataset.total = g;
      total.append(totalNum);
      if (cfg.caps[g] != null) {
        const capWrap = el('label', 'cap-input');
        capWrap.append(document.createTextNode('cap ₱'));
        const capIn = el('input');
        capIn.type = 'number';
        capIn.id = 'cap-' + g;
        capIn.min = '0';
        capIn.step = '100';
        capIn.value = cfg.caps[g];
        capIn.setAttribute('aria-label', info.label + ' cap per month');
        capIn.addEventListener('input', () => {
          cfg.caps[g] = parseFloat(capIn.value) || 0;
          save();
          update();
        });
        capWrap.append(capIn);
        const capPill = el('span', 'pill');
        capPill.dataset.cap = g;
        total.append(capWrap, capPill);
      }
      head.append(total);
      group.append(head);

      for (const it of cfg.items.filter((x) => x.group === g)) group.append(itemRow(it));

      if (g === B.FLEX_GROUP) {
        // Shows how far this month's spending moved from plan because of the rate.
        const adj = el('div', 'row row-adjust');
        adj.id = 'livingAdjust';
        const label = el('span', 'c-name name-static', 'Rate adjustment');
        const blank = el('span', 'c-amt goal-static', 'from the rate');
        const m = el('output', 'num c-month');
        const c = el('output', 'num c-check');
        adj.append(label, blank, m, c, el('span', 'c-del'));
        adj.hidden = true;
        group.append(adj);
      }

      const add = el('button', 'add-btn', '+ Add ' + (g === 'Housing' ? 'housing cost' : info.label.toLowerCase().replace(/s$/, '')));
      add.type = 'button';
      add.addEventListener('click', () => {
        const it = { id: newId(), group: g, name: '', amount: 0, currency: 'PHP' };
        cfg.items.push(it);
        save();
        renderPlan();
        update();
        const input = document.getElementById('name-' + it.id);
        if (input) input.focus();
      });
      group.append(add);
      host.append(group);
    }
  }

  // ---------- controls ----------
  function renderControls() {
    const radio = document.getElementById('basis-' + cfg.rateBasis);
    if (radio) radio.checked = true;
    $('#customRate').value = Number(cfg.customRate).toFixed(2);
    $('#customRange').value = cfg.customRate;
    $('#savingsTarget').value = cfg.savingsTarget;
    $('#flex').value = cfg.flexToSavings;
    $('#usdPerPaycheck').value = cfg.income.usdPerPaycheck;
    $('#schedule').value = cfg.income.schedule;
    $('#anchorPayday').value = cfg.income.anchorPayday || '';
    $('#feePct').value = cfg.income.feePct;
  }

  function bindControls() {
    document.querySelectorAll('input[name="rateBasis"]').forEach((r) =>
      r.addEventListener('change', () => {
        if (!r.checked) return;
        if (r.value === 'custom') {
          // start the what-if slider wherever the plan was
          const from = activeRate(rateOptions());
          cfg.customRate = Math.round(from * 20) / 20;
          $('#customRate').value = cfg.customRate.toFixed(2);
          $('#customRange').value = cfg.customRate;
        }
        cfg.rateBasis = r.value;
        save();
        update();
      }),
    );
    $('#customRate').addEventListener('input', (e) => {
      const v = parseFloat(e.target.value);
      if (!(v > 0)) return;
      cfg.customRate = v;
      $('#customRange').value = v;
      save();
      update();
    });
    $('#customRange').addEventListener('input', (e) => {
      cfg.customRate = parseFloat(e.target.value);
      $('#customRate').value = cfg.customRate.toFixed(2);
      save();
      update();
    });
    $('#savingsTarget').addEventListener('input', (e) => {
      cfg.savingsTarget = parseFloat(e.target.value) || 0;
      save();
      update();
    });
    $('#flex').addEventListener('input', (e) => {
      cfg.flexToSavings = parseFloat(e.target.value);
      save();
      update();
    });
    $('#usdPerPaycheck').addEventListener('input', (e) => {
      cfg.income.usdPerPaycheck = parseFloat(e.target.value) || 0;
      save();
      update();
    });
    $('#schedule').addEventListener('change', (e) => {
      cfg.income.schedule = e.target.value;
      save();
      update();
    });
    $('#anchorPayday').addEventListener('change', (e) => {
      if (!e.target.value) return;
      cfg.income.anchorPayday = e.target.value;
      cfg.income.anchorIsGuess = false;
      save();
      update();
    });
    $('#feePct').addEventListener('input', (e) => {
      cfg.income.feePct = Math.max(0, parseFloat(e.target.value) || 0);
      save();
      update();
    });
    $('#refreshBtn').addEventListener('click', () => refreshRates(true));
    $('#fxChip').addEventListener('click', () => refreshRates(true));

    const reset = $('#resetBtn');
    let armTimer = null;
    reset.addEventListener('click', () => {
      if (!reset.classList.contains('armed')) {
        reset.classList.add('armed');
        reset.textContent = 'Click again to erase your changes';
        armTimer = setTimeout(() => {
          reset.classList.remove('armed');
          reset.textContent = 'Reset to my starting plan';
        }, 4000);
        return;
      }
      clearTimeout(armTimer);
      cfg = structuredClone(B.DEFAULTS);
      save();
      reset.classList.remove('armed');
      reset.textContent = 'Reset to my starting plan';
      renderPlan();
      renderControls();
      update();
    });
  }

  // ---------- update: recompute and paint every number ----------
  function updateFxStatus() {
    const live = fx.live;
    const dot = $('#fxDot');
    const status = $('#fxStatus');
    const sub = $('#fxChipSub');
    $('#fxChipRate').textContent = rateTxt((live || FALLBACK).rate);
    dot.className = 'fx-dot';
    if (fxLoading) {
      dot.classList.add('loading');
      status.textContent = 'Checking the rate…';
      sub.textContent = 'checking…';
    } else if (live && !fx.error) {
      dot.classList.add('live');
      status.textContent = `Live from ${live.source}, updated ${fmtAsOf(live.asOf)}. Checks again every hour.`;
      sub.textContent = 'live · ' + fmtDay(asOfDay(live.asOf));
    } else if (live) {
      dot.classList.add('stale');
      status.textContent = `Can't reach the rate service right now. Using the last rate saved on this device (${fmtAsOf(live.asOf)}).`;
      sub.textContent = 'saved · tap to retry';
    } else {
      dot.classList.add('stale');
      status.textContent = `Can't reach the rate service. Using a built-in rate from ${fmtDay(FALLBACK.asOf)} until it's back.`;
      sub.textContent = 'offline · tap to retry';
    }
  }

  function update() {
    const opts = rateOptions();
    const rate = activeRate(opts);
    const r = B.compute(cfg, rate);
    const basis = BASIS[cfg.rateBasis] || BASIS.live;

    updateFxStatus();

    // rate panel
    $('#valLive').textContent = rateTxt(opts.live);
    $('#valAvg30').textContent = rateTxt(opts.avg30);
    $('#valLow90').textContent = rateTxt(opts.low90);
    $('#valCustom').textContent = rateTxt(opts.custom);
    $('#basis-avg30').disabled = !opts.avg30;
    $('#basis-low90').disabled = !opts.low90;
    $('#customBox').hidden = cfg.rateBasis !== 'custom';
    $('#basisHint').textContent = basis.hint;

    // summary
    const feeNote = cfg.income.feePct > 0 ? `, after ${cfg.income.feePct}% fee` : '';
    $('#sumIncome').textContent = peso(r.income);
    $('#sumIncomeSub').textContent = `${usd(r.usdMonth)} at ${rateTxt(rate)}${cfg.rateBasis === 'live' ? '' : ' (' + basis.name + ')'}${feeNote}`;
    $('#sumFixed').textContent = peso(r.fixed);
    $('#sumFixedSub').textContent = r.income > 0 ? `${pct(r.fixed / r.income)} of take-home` : '';
    $('#sumLiving').textContent = peso(r.living);
    const livDiff = r.living - r.livingPlan;
    $('#sumLivingSub').textContent =
      Math.abs(livDiff) < 1 ? 'as planned' : livDiff > 0 ? `${peso(livDiff)} more than planned` : `${peso(-livDiff)} less than planned`;

    const pillText = { on: 'On goal', near: 'Just under', below: 'Under goal', short: 'Short' }[r.status];
    const tile = $('.tile-savings');
    tile.className = 'tile tile-savings is-' + r.status;
    $('#sumSavings').textContent = peso(r.savings);
    const pill = $('#sumSavingsPill');
    pill.textContent = pillText;
    pill.className = 'pill ' + r.status;
    $('#sumSavingsSub').textContent = r.shortfall > 0 ? `${peso(r.shortfall)} short this month` : `${signedPeso(r.savings - r.target)} vs ${peso(r.target)} goal`;

    paintBar(r);
    paintInsight(r);
    paintPlan(r);
    paintFlex(r);
    paintPaychecks(r);
    drawChart();
  }

  function paintBar(r) {
    const parts = [
      ['Rent', r.groupTotals.Housing, 'var(--c-housing)'],
      ['Bills', r.groupTotals.Bills, 'var(--c-bills)'],
      ['Subscriptions', r.groupTotals.Subscriptions, 'var(--c-subs)'],
      ['Spending', r.living, 'var(--c-living)'],
      ['Savings', r.savings, 'var(--c-savings)'],
    ];
    const whole = Math.max(r.income, parts.reduce((s, p) => s + p[1], 0)) || 1;
    const bar = $('#bar');
    const legend = $('#legend');
    bar.textContent = '';
    legend.textContent = '';
    for (const [label, value, color] of parts) {
      if (value > 0.5) {
        const seg = el('span');
        seg.style.flex = `0 0 ${(value / whole) * 100}%`;
        seg.style.background = color;
        seg.title = `${label}: ${peso(value)}`;
        bar.append(seg);
      }
      const li = el('li');
      const sw = el('i');
      sw.style.background = color;
      li.append(sw, document.createTextNode(label + ' '), el('b', null, peso(value)), document.createTextNode(' '), el('em', null, pct(value / whole)));
      legend.append(li);
    }
    bar.setAttribute('aria-label', parts.map(([l, v]) => `${l} ${peso(v)}`).join(', '));
  }

  function paintInsight(r) {
    const p = $('#insight');
    p.textContent = '';
    if (!(r.pesosPerRatePeso > 0) || !r.targetRate) return;
    const strong = (t) => el('strong', null, t);
    p.append(
      'Every ₱1 the dollar gains or loses moves your month by ',
      strong(peso(r.pesosPerRatePeso)),
      '. You hit your ' + peso(r.target) + ' savings goal at ',
      strong(rateTxt(r.targetRate)),
      ' per dollar or better',
    );
    const diff = r.rate - r.targetRate;
    if (Math.abs(diff) < 0.005) p.append(', which is exactly where the plan sits.');
    else if (diff > 0) p.append(`; ${rateTxt(r.rate)} clears it by ₱${diff.toFixed(2)}.`);
    else p.append(`; ${rateTxt(r.rate)} is ₱${(-diff).toFixed(2)} under it.`);
  }

  function paintPlan(r) {
    $('#planHint').textContent = `Two paychecks a month. Each ${usd(cfg.income.usdPerPaycheck)} comes to about ${peso(r.perCheck)}.`;
    for (const row of r.rows) {
      const node = document.querySelector(`.row[data-id="${CSS.escape(row.id)}"]`);
      if (!node) continue;
      node.querySelector('.month').textContent = peso(row.php);
      node.querySelector('.check').textContent = peso(row.php / 2);
      node.querySelector('.month').title = row.currency === 'USD' ? `${usd(row.amount)} at ${rateTxt(r.rate)}` : '';
    }
    for (const g of B.GROUPS) {
      const t = document.querySelector(`[data-total="${g}"]`);
      if (t) t.textContent = peso(r.groupTotals[g] || 0);
      const capPill = document.querySelector(`[data-cap="${g}"]`);
      if (capPill) {
        const cap = cfg.caps[g] || 0;
        const over = (r.groupTotals[g] || 0) - cap;
        capPill.className = 'pill ' + (over > 0.5 ? 'over' : Math.abs(over) <= 0.5 ? 'neutral' : 'on');
        capPill.textContent = over > 0.5 ? `${peso(over)} over` : Math.abs(over) <= 0.5 ? 'at cap' : `${peso(-over)} under`;
      }
    }
    const adj = $('#livingAdjust');
    if (adj) {
      const d = r.living - r.livingPlan;
      adj.hidden = Math.abs(d) < 1 || r.shortfall > 0;
      adj.querySelector('.c-month').textContent = signedPeso(d);
      adj.querySelector('.c-check').textContent = signedPeso(d / 2);
    }
    const calc = $('.row-calc');
    calc.className = 'row row-calc is-' + r.status;
    $('#savingsGoalCell').textContent = 'goal ' + peso(r.target);
    $('#savingsMonth').textContent = peso(r.savings);
    $('#savingsCheck').textContent = peso(r.savings / 2);
    $('#savingsNote').textContent = r.shortfall > 0 ? '' : Math.abs(r.savings - r.target) < 1 ? 'right on goal' : `${signedPeso(r.savings - r.target)} vs goal because of the rate`;
    $('#totalMonth').textContent = peso(r.income);
    $('#totalCheck').textContent = peso(r.perCheck);
  }

  function paintFlex(r) {
    const p = Math.round(cfg.flexToSavings);
    $('#flexReadout').textContent =
      p >= 100 ? 'All of it goes to savings' : p <= 0 ? 'All of it goes to spending money' : `${p}% to savings, ${100 - p}% to spending money`;

    const at = `At ${rateTxt(r.rate)}`;
    let text;
    if (r.shortfall > 0) {
      text = `${at}, take-home doesn't cover rent, bills and subscriptions. You'd be ${peso(r.shortfall)} short.`;
    } else if (Math.abs(r.gap) < 1) {
      text = `${at}, the plan lands right on your goal.`;
    } else {
      const toSav = r.savings - r.target;
      const toLiv = r.living - r.livingPlan;
      const bits = [];
      if (Math.abs(toSav) >= 1) bits.push(`savings ${toSav > 0 ? 'gets' : 'gives up'} ${peso(Math.abs(toSav))}`);
      if (Math.abs(toLiv) >= 1) bits.push(`spending money ${toLiv > 0 ? 'gets' : 'gives up'} ${peso(Math.abs(toLiv))}`);
      const lead = r.gap > 0 ? `${at}, you have ${peso(r.gap)} more than the plan needs.` : `${at}, you're ${peso(-r.gap)} short of the plan.`;
      text = `${lead} ${cap1(bits.join(' and '))}.`;
    }
    $('#flexExplain').textContent = text;
  }

  function paintPaychecks(r) {
    const income = cfg.income;
    $('#anchorField').hidden = income.schedule !== 'biweekly';
    $('#anchorEst').hidden = !income.anchorIsGuess;
    const cal = B.payCalendar(income, todayISO(), 12);
    const box = $('#paydays');
    box.textContent = '';
    if (cal.next) {
      const p = el('p');
      p.append('Next payday: ', el('b', null, fmtDay(cal.next)), ` · ${usd(income.usdPerPaycheck)} ≈ ${peso(r.perCheck)}`);
      box.append(p);
    }
    if (income.schedule !== 'biweekly') {
      box.append(el('p', 'hint', 'Paid on the 15th and the last day of the month, so every month has exactly two paychecks.'));
      return;
    }
    if (!cal.extra.length) return;
    const head = el('p');
    head.append(el('b', null, 'Third-paycheck months'), ' in the next year:');
    const chips = el('div', 'chips');
    for (const m of cal.extra) {
      const chip = el('span', 'chip', fmtMonth(m.month));
      chip.title = m.dates.map(fmtDay).join(', ');
      chips.append(chip);
    }
    const n = cal.extra.length;
    const note = el(
      'p',
      'hint',
      `Every 2 weeks means 26 paychecks a year, not 24. The plan counts two a month, so ${n === 1 ? 'the extra one is' : `each of these ${n} extras is`} free money: about ${peso(r.perCheck)} each, ${peso(r.perCheck * n)} a year on top of your goal.`,
    );
    box.append(head, chips, note);
  }

  // ---------- chart: savings at each day's rate ----------
  const chart = { points: [], X: null, Y: null };

  function niceStep(raw) {
    const exp = Math.floor(Math.log10(raw));
    const f = raw / 10 ** exp;
    return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * 10 ** exp;
  }

  function svgEl(tag, attrs) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const k in attrs) node.setAttribute(k, attrs[k]);
    return node;
  }

  function drawChart() {
    const svg = $('#chart');
    const W = Math.max(260, Math.round(svg.clientWidth || 600));
    const H = Math.round(svg.clientHeight || 210);
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.textContent = '';

    const today = todayISO();
    const hist = historyWithLive().filter((h) => (B.isoToUTC(today) - B.isoToUTC(h.date)) / 86400000 <= 92);
    const target = Math.max(0, Number(cfg.savingsTarget) || 0);
    chart.points = hist.map((h) => ({ ...h, savings: B.compute(cfg, h.rate).savings }));
    const pts = chart.points;

    if (pts.length < 2) {
      const t = svgEl('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle', class: 'empty' });
      t.textContent = 'Rate history shows up once the rate service answers.';
      svg.append(t);
      $('#chartReadout').textContent = '';
      return;
    }

    const pad = { l: 46, r: 14, t: 14, b: 24 };
    const t0 = B.isoToUTC(pts[0].date);
    const t1 = B.isoToUTC(pts[pts.length - 1].date);
    const ys = pts.map((p) => p.savings);
    let lo = Math.min(target, ...ys);
    let hi = Math.max(target, ...ys);
    const span = hi - lo || 2000;
    lo -= span * 0.15;
    hi += span * 0.15;
    const step = niceStep((hi - lo) / 4);
    lo = Math.floor(lo / step) * step;
    hi = Math.ceil(hi / step) * step;

    const X = (t) => pad.l + ((t - t0) / (t1 - t0 || 1)) * (W - pad.l - pad.r);
    const Y = (v) => pad.t + ((hi - v) / (hi - lo || 1)) * (H - pad.t - pad.b);
    chart.X = X;
    chart.Y = Y;

    // y grid + labels
    for (let v = lo; v <= hi + 1e-6; v += step) {
      svg.append(svgEl('line', { class: 'grid-line', x1: pad.l, x2: W - pad.r, y1: Y(v), y2: Y(v) }));
      const lab = svgEl('text', { x: pad.l - 8, y: Y(v) + 3.5, 'text-anchor': 'end' });
      lab.textContent = '₱' + +(v / 1000).toFixed(1) + 'K';
      svg.append(lab);
    }
    // x labels at month starts
    const d0 = new Date(t0);
    for (let y = d0.getUTCFullYear(), m = d0.getUTCMonth() + 1; ; m++) {
      const t = Date.UTC(y, m, 1);
      if (t > t1) break;
      const lab = svgEl('text', { x: X(t), y: H - 6, 'text-anchor': 'middle' });
      lab.textContent = new Date(t).toLocaleDateString('en-PH', { timeZone: 'UTC', month: 'short' });
      svg.append(lab);
      svg.append(svgEl('line', { class: 'grid-line', x1: X(t), x2: X(t), y1: H - pad.b, y2: H - pad.b + 4 }));
    }

    // area + line
    const coords = pts.map((p) => [X(B.isoToUTC(p.date)), Y(p.savings)]);
    const line = coords.map(([x, y], i) => (i ? 'L' : 'M') + x.toFixed(1) + ',' + y.toFixed(1)).join('');
    const base = Y(lo);
    svg.append(svgEl('path', { class: 'area', d: `${line}L${coords[coords.length - 1][0].toFixed(1)},${base}L${coords[0][0].toFixed(1)},${base}Z` }));
    svg.append(svgEl('path', { class: 'line', d: line }));

    // goal line
    svg.append(svgEl('line', { class: 'target-line', x1: pad.l, x2: W - pad.r, y1: Y(target), y2: Y(target) }));
    const tl = svgEl('text', { class: 'target-label', x: pad.l + 6, y: Y(target) - 5 });
    tl.textContent = 'goal ' + peso(target);
    svg.append(tl);

    // hover guide
    svg.append(svgEl('line', { class: 'guide', id: 'guide', x1: 0, x2: 0, y1: pad.t, y2: H - pad.b, visibility: 'hidden' }));
    svg.append(svgEl('circle', { class: 'guide-dot', id: 'guideDot', r: 4, cx: 0, cy: 0, visibility: 'hidden' }));

    const [ex, ey] = coords[coords.length - 1];
    svg.append(svgEl('circle', { class: 'end-dot', r: 4.5, cx: ex, cy: ey }));

    showReadout(pts.length - 1, false);
  }

  function showReadout(i, withGuide) {
    const p = chart.points[i];
    if (!p) return;
    const out = $('#chartReadout');
    out.textContent = '';
    out.append(el('b', null, fmtDay(p.date)), ` · $1 = ${rateTxt(p.rate)} · saves `, el('b', null, peso(p.savings)));
    const guide = document.getElementById('guide');
    const dot = document.getElementById('guideDot');
    if (!guide || !dot) return;
    const vis = withGuide ? 'visible' : 'hidden';
    const x = chart.X(B.isoToUTC(p.date));
    guide.setAttribute('x1', x);
    guide.setAttribute('x2', x);
    dot.setAttribute('cx', x);
    dot.setAttribute('cy', chart.Y(p.savings));
    guide.setAttribute('visibility', vis);
    dot.setAttribute('visibility', vis);
  }

  function bindChart() {
    const svg = $('#chart');
    svg.addEventListener('pointermove', (e) => {
      if (chart.points.length < 2) return;
      const box = svg.getBoundingClientRect();
      const vb = svg.viewBox.baseVal;
      const x = ((e.clientX - box.left) / box.width) * vb.width;
      let best = 0;
      let bestD = Infinity;
      chart.points.forEach((p, i) => {
        const d = Math.abs(chart.X(B.isoToUTC(p.date)) - x);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      showReadout(best, true);
    });
    svg.addEventListener('pointerleave', () => showReadout(chart.points.length - 1, false));
    if ('ResizeObserver' in window) {
      let last = 0;
      new ResizeObserver(() => {
        const w = svg.clientWidth;
        if (w !== last) {
          last = w;
          drawChart();
        }
      }).observe(svg);
    }
  }

  // ---------- boot ----------
  renderPlan();
  renderControls();
  bindControls();
  bindChart();
  update();
  refreshRates(false);
  setInterval(() => refreshRates(false), POLL_EVERY);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshRates(false);
  });
})();
