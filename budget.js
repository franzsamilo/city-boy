/*
 * Makati Budget — the money math.
 *
 * Pure functions only (no DOM), so the same file runs in the browser
 * (as window.Budget) and in Node for tests (require('./budget.js')).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Budget = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DAY = 86400000;

  // Order matters: this is the order groups appear in the plan.
  const GROUPS = ['Housing', 'Bills', 'Subscriptions', 'Living'];

  // "Living" is everyday spending. It is the only group that can bend when
  // the exchange rate moves; rent, bills and subscriptions are fixed.
  const FLEX_GROUP = 'Living';

  // Every month is planned on two paychecks. On a bi-weekly schedule two
  // months a year get a third paycheck; that one is treated as a bonus.
  const CHECKS_PER_MONTH = 2;

  const DEFAULTS = {
    version: 1,
    income: {
      usdPerPaycheck: 475, // $950 a month, paid in two halves
      schedule: 'biweekly', // 'biweekly' (26 a year) | 'semimonthly' (24 a year)
      anchorPayday: '2026-11-20', // any real payday, so the calendar lines up
      anchorIsGuess: true,
      feePct: 0, // gap between market rate and what your bank/Wise/Payoneer gives
    },
    rateBasis: 'live', // 'live' | 'avg30' | 'low90' | 'custom'
    customRate: 63.8,
    savingsTarget: 20000,
    flexToSavings: 100, // % of any rate swing that lands on savings (rest on spending)
    caps: { Bills: 4000 },
    items: [
      { id: 'rent', group: 'Housing', name: 'Rent', amount: 17500, currency: 'PHP' },
      { id: 'power', group: 'Bills', name: 'Electricity (Meralco)', amount: 2200, currency: 'PHP', est: true },
      { id: 'internet', group: 'Bills', name: 'Internet', amount: 1500, currency: 'PHP', est: true },
      { id: 'water', group: 'Bills', name: 'Water (Manila Water)', amount: 300, currency: 'PHP', est: true },
      { id: 'claude', group: 'Subscriptions', name: 'Claude', amount: 20, currency: 'USD' },
      { id: 'youtube', group: 'Subscriptions', name: 'YouTube Premium', amount: 149, currency: 'PHP' },
      { id: 'food', group: 'Living', name: 'Food & groceries', amount: 9000, currency: 'PHP', est: true },
      { id: 'transport', group: 'Living', name: 'Transport', amount: 3000, currency: 'PHP', est: true },
      { id: 'personal', group: 'Living', name: 'Personal & going out', amount: 5000, currency: 'PHP', est: true },
    ],
  };

  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  /** Monthly cost of one item in pesos at the given USD→PHP rate. */
  function phpOf(item, rate) {
    const amount = num(item.amount);
    return item.currency === 'USD' ? amount * rate : amount;
  }

  /**
   * The whole month at one exchange rate.
   *
   * gap = take-home − fixed costs − planned spending − savings goal.
   * A positive gap is a good-rate bonus; a negative one is a shortfall.
   * `flexToSavings` decides how much of the gap savings absorbs; spending
   * takes the rest. Savings never goes below zero while there is spending
   * money left to cut, and spending never goes below zero.
   */
  function compute(cfg, rate) {
    const net = 1 - num(cfg.income.feePct) / 100;
    const usdPerCheck = num(cfg.income.usdPerPaycheck);
    const usdMonth = usdPerCheck * CHECKS_PER_MONTH;
    const income = usdMonth * rate * net;
    const perCheck = usdPerCheck * rate * net;

    const rows = cfg.items.map((it) => ({ ...it, php: phpOf(it, rate) }));
    const groupTotals = Object.fromEntries(GROUPS.map((g) => [g, 0]));
    for (const r of rows) groupTotals[r.group] = (groupTotals[r.group] || 0) + r.php;

    const livingPlan = groupTotals[FLEX_GROUP] || 0;
    const fixed = rows.reduce((s, r) => (r.group === FLEX_GROUP ? s : s + r.php), 0);
    const target = Math.max(0, num(cfg.savingsTarget));
    const discretionary = income - fixed; // what's left for spending + savings
    const gap = discretionary - livingPlan - target;
    const p = clamp(num(cfg.flexToSavings) / 100, 0, 1);

    let savings;
    let living;
    let shortfall = 0;
    if (discretionary < 0) {
      savings = 0;
      living = 0;
      shortfall = -discretionary;
    } else {
      savings = clamp(target + gap * p, 0, discretionary);
      living = discretionary - savings;
    }

    // How the month responds to the rate. USD-priced items (like Claude)
    // get pricier as the dollar strengthens, so they offset part of it.
    const usdCosts = cfg.items.reduce((s, it) => (it.currency === 'USD' ? s + num(it.amount) : s), 0);
    const phpCosts = cfg.items.reduce((s, it) => (it.currency === 'USD' ? s : s + num(it.amount)), 0);
    const pesosPerRatePeso = usdMonth * net - usdCosts;
    const targetRate = pesosPerRatePeso > 0 ? (phpCosts + target) / pesosPerRatePeso : null;

    let status = 'on';
    if (shortfall > 0) status = 'short';
    else if (savings < target - 0.5) status = savings >= target * 0.9 ? 'near' : 'below';

    return {
      rate,
      usdMonth,
      income,
      perCheck,
      rows,
      groupTotals,
      fixed,
      livingPlan,
      living,
      target,
      savings,
      gap,
      shortfall,
      status,
      pesosPerRatePeso,
      targetRate,
    };
  }

  // ---- Dates (all in whole UTC days, ISO yyyy-mm-dd strings) ----

  function isoToUTC(iso) {
    const [y, m, d] = String(iso).split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  }
  function utcToISO(t) {
    return new Date(t).toISOString().slice(0, 10);
  }
  function addDaysISO(iso, days) {
    return utcToISO(isoToUTC(iso) + days * DAY);
  }

  /** Every payday from `fromISO` to `toISO`, inclusive. */
  function paydays(income, fromISO, toISO) {
    const from = isoToUTC(fromISO);
    const to = isoToUTC(toISO);
    const out = [];
    if (income.schedule === 'semimonthly') {
      // 15th and last day of each month
      const start = new Date(from);
      let y = start.getUTCFullYear();
      let m = start.getUTCMonth();
      for (;;) {
        const mid = Date.UTC(y, m, 15);
        const end = Date.UTC(y, m + 1, 0);
        if (mid > to) break;
        for (const t of [mid, end]) if (t >= from && t <= to) out.push(utcToISO(t));
        m += 1;
        if (m > 11) {
          m = 0;
          y += 1;
        }
      }
    } else {
      const step = 14 * DAY;
      const anchor = income.anchorPayday ? isoToUTC(income.anchorPayday) : from;
      if (!Number.isFinite(anchor)) return out;
      for (let t = anchor + Math.ceil((from - anchor) / step) * step; t <= to; t += step) {
        out.push(utcToISO(t));
      }
    }
    return out;
  }

  /**
   * Paydays over the next `months` calendar months (starting this month),
   * the next payday on or after today, and the months with a third check.
   */
  function payCalendar(income, todayISO, months = 12) {
    const [y, m] = todayISO.split('-').map(Number);
    const start = utcToISO(Date.UTC(y, m - 1, 1));
    const end = utcToISO(Date.UTC(y, m - 1 + months, 0));
    const days = paydays(income, start, end);
    const byMonth = new Map();
    for (const d of days) byMonth.set(d.slice(0, 7), (byMonth.get(d.slice(0, 7)) || 0) + 1);
    const extra = [...byMonth]
      .filter(([, n]) => n > CHECKS_PER_MONTH)
      .map(([month, count]) => ({ month, count, dates: days.filter((d) => d.startsWith(month)) }));
    return { next: days.find((d) => d >= todayISO) || null, extra, paydays: days };
  }

  /** 30-day average and 90-day low/high from a [{date, rate}] history. */
  function rateStats(history, todayISO) {
    const empty = { avg30: null, low90: null, high90: null, n30: 0, n90: 0 };
    if (!Array.isArray(history) || !history.length) return empty;
    const today = isoToUTC(todayISO);
    const age = (h) => (today - isoToUTC(h.date)) / DAY;
    const in30 = history.filter((h) => age(h) >= 0 && age(h) <= 30);
    const in90 = history.filter((h) => age(h) >= 0 && age(h) <= 90);
    if (!in90.length) return empty;
    const rates90 = in90.map((h) => h.rate);
    return {
      avg30: in30.length ? in30.reduce((s, h) => s + h.rate, 0) / in30.length : null,
      low90: Math.min(...rates90),
      high90: Math.max(...rates90),
      n30: in30.length,
      n90: in90.length,
    };
  }

  return {
    GROUPS,
    FLEX_GROUP,
    CHECKS_PER_MONTH,
    DEFAULTS,
    phpOf,
    compute,
    paydays,
    payCalendar,
    rateStats,
    isoToUTC,
    utcToISO,
    addDaysISO,
  };
});
