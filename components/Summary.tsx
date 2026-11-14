import type { Config, Month } from '@/lib/budget';
import { pct, peso, rateTxt, signedPeso, usd } from '@/lib/format';

const PILL: Record<Month['status'], string> = { on: 'On goal', near: 'Just under', below: 'Under goal', short: 'Short' };

export function Summary({ m, cfg, basisName }: { m: Month; cfg: Config; basisName: string | null }) {
  const livDiff = m.living - m.livingPlan;
  const fee = cfg.income.feePct > 0 ? `, after ${cfg.income.feePct}% fee` : '';
  return (
    <section className="summary" aria-label="This month">
      <div className="tile">
        <span className="label">Take-home</span>
        <span className="big">{peso(m.income)}</span>
        <span className="sub">
          {usd(m.usdMonth)} at {rateTxt(m.rate)}
          {basisName ? ` (${basisName})` : ''}
          {fee}
        </span>
      </div>
      <div className="tile">
        <span className="label">Rent, bills &amp; subscriptions</span>
        <span className="big">{peso(m.fixed)}</span>
        <span className="sub">{m.income > 0 ? `${pct(m.fixed / m.income)} of take-home` : ' '}</span>
      </div>
      <div className="tile">
        <span className="label">Spending money</span>
        <span className="big">{peso(m.living)}</span>
        <span className="sub">
          {Math.abs(livDiff) < 1
            ? 'as planned'
            : livDiff > 0
              ? `${peso(livDiff)} more than planned`
              : `${peso(-livDiff)} less than planned`}
        </span>
      </div>
      <div className={`tile tile-savings is-${m.status}`}>
        <span className="label">Savings</span>
        <span className="big">{peso(m.savings)}</span>
        <span className="sub">
          <span className={`pill ${m.status}`}>{PILL[m.status]}</span>{' '}
          {m.shortfall > 0 ? `${peso(m.shortfall)} short this month` : `${signedPeso(m.savings - m.target)} vs ${peso(m.target)} goal`}
        </span>
      </div>
    </section>
  );
}

export function MoneySplit({ m }: { m: Month }) {
  const parts: [string, number, string][] = [
    ['Rent', m.groupTotals.Housing, 'var(--c-housing)'],
    ['Bills', m.groupTotals.Bills, 'var(--c-bills)'],
    ['Subscriptions', m.groupTotals.Subscriptions, 'var(--c-subs)'],
    ['Spending', m.living, 'var(--c-living)'],
    ['Savings', m.savings, 'var(--c-savings)'],
  ];
  const whole = Math.max(m.income, parts.reduce((s, p) => s + p[1], 0)) || 1;
  const diff = m.targetRate ? m.rate - m.targetRate : 0;

  return (
    <section className="split" aria-label="Where the money goes">
      <div className="bar" role="img" aria-label={parts.map(([l, v]) => `${l} ${peso(v)}`).join(', ')}>
        {parts
          .filter(([, v]) => v > 0.5)
          .map(([label, value, color]) => (
            <span key={label} title={`${label}: ${peso(value)}`} style={{ flex: `0 0 ${(value / whole) * 100}%`, background: color }} />
          ))}
      </div>
      <ul className="legend">
        {parts.map(([label, value, color]) => (
          <li key={label}>
            <i style={{ background: color }} />
            {label} <b>{peso(value)}</b> <em>{pct(value / whole)}</em>
          </li>
        ))}
      </ul>
      {m.pesosPerRatePeso > 0 && m.targetRate ? (
        <p className="insight">
          Every ₱1 the dollar gains or loses moves your month by <strong>{peso(m.pesosPerRatePeso)}</strong>. You hit your{' '}
          {peso(m.target)} savings goal at <strong>{rateTxt(m.targetRate)}</strong> per dollar or better
          {Math.abs(diff) < 0.005
            ? ', which is exactly where the plan sits.'
            : diff > 0
              ? `; ${rateTxt(m.rate)} clears it by ₱${diff.toFixed(2)}.`
              : `; ${rateTxt(m.rate)} is ₱${(-diff).toFixed(2)} under it.`}
        </p>
      ) : null}
    </section>
  );
}
