/*
 * Makati Budget — the money math.
 * Pure functions only (no React, no DOM, no network) so it runs anywhere,
 * including `node --test`.
 */

export const GROUPS = ['Housing', 'Bills', 'Subscriptions', 'Living'] as const;
export type Group = (typeof GROUPS)[number];
export type Currency = 'PHP' | 'USD';
export type Schedule = 'biweekly' | 'semimonthly';
export type RateBasis = 'live' | 'avg30' | 'low90' | 'custom';
export type Status = 'on' | 'near' | 'below' | 'short';

export interface Item {
  id: string;
  group: Group;
  name: string;
  amount: number;
  currency: Currency;
  /** true while the amount is a guess the user hasn't confirmed */
  est?: boolean;
}

export interface Income {
  usdPerPaycheck: number;
  schedule: Schedule;
  /** any real payday (yyyy-mm-dd) so the bi-weekly calendar lines up */
  anchorPayday: string;
  anchorIsGuess: boolean;
  /** % the bank / Wise / Payoneer pays below the market rate */
  feePct: number;
}

export interface Config {
  version: 1;
  income: Income;
  rateBasis: RateBasis;
  customRate: number;
  savingsTarget: number;
  /** % of any rate swing that lands on savings; the rest lands on spending */
  flexToSavings: number;
  caps: Partial<Record<Group, number>>;
  items: Item[];
}

export interface RatePoint {
  date: string;
  rate: number;
}

/** "Living" is everyday spending: the only group that bends when the rate moves. */
export const FLEX_GROUP: Group = 'Living';

/** Every month is planned on two paychecks; a bi-weekly third one is a bonus. */
export const CHECKS_PER_MONTH = 2;

const DAY = 86_400_000;

export const DEFAULTS: Config = {
  version: 1,
  income: {
    usdPerPaycheck: 475, // $950 a month, paid in two halves
    schedule: 'biweekly',
    anchorPayday: '2026-11-20',
    anchorIsGuess: true,
    feePct: 0,
  },
  rateBasis: 'live',
  customRate: 63.8,
  savingsTarget: 20000,
  flexToSavings: 100,
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

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Monthly cost of one item in pesos at the given USD→PHP rate. */
export function phpOf(item: Pick<Item, 'amount' | 'currency'>, rate: number): number {
  const amount = num(item.amount);
  return item.currency === 'USD' ? amount * rate : amount;
}

export interface Month {
  rate: number;
  usdMonth: number;
  income: number;
  perCheck: number;
  rows: (Item & { php: number })[];
  groupTotals: Record<Group, number>;
  fixed: number;
  livingPlan: number;
  living: number;
  target: number;
  savings: number;
  /** take-home − fixed − planned spending − savings goal (+ = good-rate bonus) */
  gap: number;
  shortfall: number;
  status: Status;
  /** how many pesos the month gains for each ₱1 the dollar gains */
  pesosPerRatePeso: number;
  /** rate at which savings lands exactly on the goal with planned spending */
  targetRate: number | null;
}

/**
 * The whole month at one exchange rate.
 *
 * `flexToSavings` decides how much of the gap savings absorbs; spending takes
 * the rest. Savings never drops below zero while there's spending money left
 * to cut, and spending never drops below zero.
 */
export function compute(cfg: Config, rate: number): Month {
  const net = 1 - num(cfg.income.feePct) / 100;
  const usdPerCheck = num(cfg.income.usdPerPaycheck);
  const usdMonth = usdPerCheck * CHECKS_PER_MONTH;
  const income = usdMonth * rate * net;
  const perCheck = usdPerCheck * rate * net;

  const rows = cfg.items.map((it) => ({ ...it, php: phpOf(it, rate) }));
  const groupTotals = Object.fromEntries(GROUPS.map((g) => [g, 0])) as Record<Group, number>;
  for (const r of rows) groupTotals[r.group] = (groupTotals[r.group] ?? 0) + r.php;

  const livingPlan = groupTotals[FLEX_GROUP] ?? 0;
  const fixed = rows.reduce((s, r) => (r.group === FLEX_GROUP ? s : s + r.php), 0);
  const target = Math.max(0, num(cfg.savingsTarget));
  const discretionary = income - fixed; // what's left for spending + savings
  const gap = discretionary - livingPlan - target;
  const p = clamp(num(cfg.flexToSavings) / 100, 0, 1);

  let savings: number;
  let living: number;
  let shortfall = 0;
  if (discretionary < 0) {
    savings = 0;
    living = 0;
    shortfall = -discretionary;
  } else {
    savings = clamp(target + gap * p, 0, discretionary);
    living = discretionary - savings;
  }

  // USD-priced items (like Claude) get pricier as the dollar strengthens,
  // so they offset part of every rate gain.
  const usdCosts = cfg.items.reduce((s, it) => (it.currency === 'USD' ? s + num(it.amount) : s), 0);
  const phpCosts = cfg.items.reduce((s, it) => (it.currency === 'USD' ? s : s + num(it.amount)), 0);
  const pesosPerRatePeso = usdMonth * net - usdCosts;
  const targetRate = pesosPerRatePeso > 0 ? (phpCosts + target) / pesosPerRatePeso : null;

  let status: Status = 'on';
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

// ---- Dates: whole UTC days as ISO yyyy-mm-dd strings ----

export function isoToUTC(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}
export function utcToISO(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}
export function addDaysISO(iso: string, days: number): string {
  return utcToISO(isoToUTC(iso) + days * DAY);
}
export function daysBetween(fromISO: string, toISO: string): number {
  return (isoToUTC(toISO) - isoToUTC(fromISO)) / DAY;
}

/** Every payday from `fromISO` to `toISO`, inclusive. */
export function paydays(income: Income, fromISO: string, toISO: string): string[] {
  const from = isoToUTC(fromISO);
  const to = isoToUTC(toISO);
  const out: string[] = [];
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

export interface PayCalendar {
  next: string | null;
  extra: { month: string; count: number; dates: string[] }[];
  paydays: string[];
}

/** Paydays over the next `months` months (from this month), the next one, and third-paycheck months. */
export function payCalendar(income: Income, todayISO: string, months = 12): PayCalendar {
  const [y, m] = todayISO.split('-').map(Number);
  const start = utcToISO(Date.UTC(y, m - 1, 1));
  const end = utcToISO(Date.UTC(y, m - 1 + months, 0));
  const days = paydays(income, start, end);
  const byMonth = new Map<string, number>();
  for (const d of days) byMonth.set(d.slice(0, 7), (byMonth.get(d.slice(0, 7)) ?? 0) + 1);
  const extra = [...byMonth]
    .filter(([, n]) => n > CHECKS_PER_MONTH)
    .map(([month, count]) => ({ month, count, dates: days.filter((d) => d.startsWith(month)) }));
  return { next: days.find((d) => d >= todayISO) ?? null, extra, paydays: days };
}

export interface RateStats {
  avg30: number | null;
  low90: number | null;
  high90: number | null;
}

/** 30-day average and 90-day low/high from a rate history. */
export function rateStats(history: RatePoint[], todayISO: string): RateStats {
  const empty: RateStats = { avg30: null, low90: null, high90: null };
  if (!history.length) return empty;
  const age = (h: RatePoint) => daysBetween(h.date, todayISO);
  const in30 = history.filter((h) => age(h) >= 0 && age(h) <= 30);
  const in90 = history.filter((h) => age(h) >= 0 && age(h) <= 90);
  if (!in90.length) return empty;
  const rates90 = in90.map((h) => h.rate);
  return {
    avg30: in30.length ? in30.reduce((s, h) => s + h.rate, 0) / in30.length : null,
    low90: Math.min(...rates90),
    high90: Math.max(...rates90),
  };
}

/** Restores a saved config over the defaults, dropping anything malformed. */
export function mergeConfig(saved: unknown): Config {
  const d = structuredClone(DEFAULTS);
  if (!saved || typeof saved !== 'object' || (saved as Config).version !== d.version) return d;
  const s = saved as Partial<Config>;
  return {
    ...d,
    ...s,
    version: 1,
    income: { ...d.income, ...s.income },
    caps: { ...d.caps, ...s.caps },
    items: Array.isArray(s.items) ? s.items.filter((it) => GROUPS.includes(it.group)) : d.items,
  };
}
