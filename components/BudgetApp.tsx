'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  compute,
  daysBetween,
  DEFAULTS,
  mergeConfig,
  payCalendar,
  rateStats,
  type Config,
  type Group,
  type Income,
  type Item,
  type RateBasis,
  type RatePoint,
} from '@/lib/budget';
import { asOfDay, fmtAsOf, fmtDay, manilaToday, rateTxt } from '@/lib/format';
import { FALLBACK_RATE, type LiveRate, type RatesPayload } from '@/lib/rate-types';
import { BASIS, FlexPanel, PaychecksPanel, RatePanel } from './Panels';
import PlanLedger from './PlanLedger';
import SavingsChart from './SavingsChart';
import { MoneySplit, Summary } from './Summary';

const CFG_KEY = 'makati-budget:config:v1';
const RATES_KEY = 'makati-budget:rates:v1';
const STALE_AFTER = 60 * 60 * 1000; // re-check the rate hourly
const POLL_EVERY = 10 * 60 * 1000; // how often to ask "is it time yet?"

// Browser storage is a convenience: private windows or blocked storage just mean the plan isn't remembered.
const store = {
  get<T>(key: string): T | null {
    try {
      return JSON.parse(localStorage.getItem(key) ?? 'null') as T | null;
    } catch {
      return null;
    }
  },
  set(key: string, value: unknown) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* not remembered, still works */
    }
  },
};

/** Rate history plus today's live rate, trimmed to the last ~90 days. */
function chartHistory(rates: RatesPayload, today: string): RatePoint[] {
  const h = rates.history.slice();
  if (rates.live) {
    const day = asOfDay(rates.live.asOf);
    const last = h[h.length - 1];
    if (!last || last.date < day) h.push({ date: day, rate: rates.live.rate });
    else if (last.date === day) h[h.length - 1] = { date: day, rate: rates.live.rate };
  }
  return h.filter((p) => {
    const age = daysBetween(p.date, today);
    return age >= 0 && age <= 92;
  });
}

export default function BudgetApp({ initialRates }: { initialRates: RatesPayload }) {
  const [cfg, setCfg] = useState<Config>(DEFAULTS);
  const [hydrated, setHydrated] = useState(false);
  const [rates, setRates] = useState<RatesPayload>(initialRates);
  const [savedLive, setSavedLive] = useState<LiveRate | null>(null);
  const [today, setToday] = useState(initialRates.today);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [resetArmed, setResetArmed] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Restore this device's plan and last good rate.
  useEffect(() => {
    setCfg(mergeConfig(store.get(CFG_KEY)));
    const saved = store.get<RatesPayload>(RATES_KEY);
    if (saved?.live) {
      setSavedLive(saved.live);
      if (!initialRates.live) setRates(saved);
    }
    setToday(manilaToday());
    setHydrated(true);
  }, [initialRates.live]);

  useEffect(() => {
    if (hydrated) store.set(CFG_KEY, cfg);
  }, [cfg, hydrated]);

  useEffect(() => {
    if (rates.live) store.set(RATES_KEY, rates);
  }, [rates]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/rates', { cache: 'no-store' });
      if (!res.ok) throw new Error(`rates answered ${res.status}`);
      const next = (await res.json()) as RatesPayload;
      if (!next.live) throw new Error('no live rate');
      setRates(next);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
      setToday(manilaToday());
    }
  }, []);

  // Keep the rate fresh: on open, every hour while open, and when you come back to the tab.
  const fetchedAt = rates.fetchedAt;
  useEffect(() => {
    const check = () => {
      if (document.hidden) return;
      setToday(manilaToday());
      if (Date.now() - Date.parse(fetchedAt) > STALE_AFTER) refresh();
    };
    check();
    const id = setInterval(check, POLL_EVERY);
    document.addEventListener('visibilitychange', check);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', check);
    };
  }, [fetchedAt, refresh]);

  // ---- derive the month ----
  const live = rates.live ?? savedLive ?? FALLBACK_RATE;
  const liveKind = rates.live && !failed ? 'live' : rates.live || savedLive ? 'saved' : 'fallback';
  const history = useMemo(() => chartHistory(rates, today), [rates, today]);
  const stats = useMemo(() => rateStats(history, today), [history, today]);
  const options: Record<RateBasis, number | null> = {
    live: live.rate,
    avg30: stats.avg30,
    low90: stats.low90,
    custom: cfg.customRate || null,
  };
  const rate = options[cfg.rateBasis] || live.rate;
  const m = useMemo(() => compute(cfg, rate), [cfg, rate]);
  const cal = useMemo(() => payCalendar(cfg.income, today, 12), [cfg.income, today]);

  const status = loading
    ? 'Checking the rate…'
    : liveKind === 'live'
      ? `Live from ${live.source}, updated ${fmtAsOf(live.asOf)}. Checks again every hour.`
      : liveKind === 'saved'
        ? `Can't reach the rate service right now. Using the last rate saved on this device (${fmtAsOf(live.asOf)}).`
        : `Can't reach the rate service. Using a built-in rate from ${fmtDay(FALLBACK_RATE.asOf)} until it's back.`;
  const chipSub = loading
    ? 'checking…'
    : liveKind === 'live'
      ? `live · ${fmtDay(asOfDay(live.asOf))}`
      : liveKind === 'saved'
        ? 'saved · tap to retry'
        : 'offline · tap to retry';

  // ---- edits ----
  const patch = (p: Partial<Config>) => setCfg((c) => ({ ...c, ...p }));
  const onItem = (id: string, p: Partial<Item>) =>
    setCfg((c) => ({ ...c, items: c.items.map((it) => (it.id === id ? { ...it, ...p } : it)) }));
  const onRemove = (id: string) => setCfg((c) => ({ ...c, items: c.items.filter((it) => it.id !== id) }));
  const onAdd = (group: Group) => {
    const id = 'i' + Math.random().toString(36).slice(2, 10);
    setCfg((c) => ({ ...c, items: [...c.items, { id, group, name: '', amount: 0, currency: 'PHP' }] }));
    return id;
  };
  const onCap = (group: Group, value: number) => setCfg((c) => ({ ...c, caps: { ...c.caps, [group]: value } }));
  const onIncome = (p: Partial<Income>) => setCfg((c) => ({ ...c, income: { ...c.income, ...p } }));
  const onBasis = (b: RateBasis) =>
    // the what-if slider starts wherever the plan was
    patch(b === 'custom' ? { rateBasis: b, customRate: Math.round(rate * 20) / 20 } : { rateBasis: b });

  const onReset = () => {
    clearTimeout(resetTimer.current);
    if (!resetArmed) {
      setResetArmed(true);
      resetTimer.current = setTimeout(() => setResetArmed(false), 4000);
      return;
    }
    setResetArmed(false);
    setCfg(structuredClone(DEFAULTS));
  };

  return (
    <div className="wrap">
      <header className="top">
        <div className="brand">
          <h1>Makati Budget</h1>
          <p>Paid in dollars, spent in pesos. The plan re-works itself every time the rate moves.</p>
        </div>
        <button className="fx-chip" type="button" onClick={refresh} title="Refresh the exchange rate">
          <span className={`fx-dot ${loading ? 'loading' : liveKind === 'live' ? 'live' : 'stale'}`} aria-hidden="true" />
          <span className="fx-main">
            $1 = <strong>{rateTxt(live.rate)}</strong>
          </span>
          <span className="fx-sub">{chipSub}</span>
        </button>
      </header>

      <Summary m={m} cfg={cfg} basisName={cfg.rateBasis === 'live' ? null : BASIS[cfg.rateBasis].name} />
      <MoneySplit m={m} />

      <main className="grid">
        <PlanLedger cfg={cfg} m={m} onItem={onItem} onRemove={onRemove} onAdd={onAdd} onCap={onCap} />

        <aside className="side">
          <RatePanel
            basis={cfg.rateBasis}
            options={options}
            customRate={cfg.customRate}
            status={status}
            onBasis={onBasis}
            onCustom={(v) => patch({ customRate: v })}
            onRefresh={refresh}
          />
          <FlexPanel cfg={cfg} m={m} onTarget={(v) => patch({ savingsTarget: v })} onFlex={(v) => patch({ flexToSavings: v })} />
          <section className="panel" aria-labelledby="chartTitle">
            <div className="panel-head">
              <h2 id="chartTitle">Last 90 days</h2>
              <p className="hint">What this plan would save at each day&apos;s rate.</p>
            </div>
            <div className="chart-wrap">
              <SavingsChart cfg={cfg} history={history} />
            </div>
          </section>
          <PaychecksPanel income={cfg.income} perCheck={m.perCheck} cal={cal} onIncome={onIncome} />
        </aside>
      </main>

      <footer className="foot">
        <p>
          Rates: <a href="https://www.exchangerate-api.com" target="_blank" rel="noopener noreferrer">ExchangeRate-API</a> (today) and{' '}
          <a href="https://frankfurter.dev" target="_blank" rel="noopener noreferrer">Frankfurter</a> / ECB (history). Your plan is saved in
          this browser only. Bar colors borrowed from peso bills.
        </p>
        <button type="button" className={`link-btn${resetArmed ? ' armed' : ''}`} onClick={onReset}>
          {resetArmed ? 'Click again to erase your changes' : 'Reset to my starting plan'}
        </button>
      </footer>
    </div>
  );
}
