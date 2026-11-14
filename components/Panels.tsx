'use client';

import type { Config, Income, Month, PayCalendar, RateBasis } from '@/lib/budget';
import { capFirst, fmtDay, fmtMonth, peso, rateTxt, usd } from '@/lib/format';
import NumberInput from './NumberInput';

export const BASIS: Record<RateBasis, { label: string; name: string; hint: string }> = {
  live: { label: 'Today', name: "today's rate", hint: "Today's market rate. The plan moves with it day to day." },
  avg30: { label: '30-day avg', name: '30-day average', hint: 'Smooths out day-to-day noise for a steadier plan.' },
  low90: {
    label: '90-day low',
    name: '90-day low',
    hint: 'The weakest dollar of the last 90 days. Plan on this and most months come in better.',
  },
  custom: { label: 'What if', name: 'what-if rate', hint: 'Drag to see what a stronger or weaker dollar does to your month.' },
};

// ---------- Exchange rate ----------

export function RatePanel({
  basis,
  options,
  customRate,
  status,
  onBasis,
  onCustom,
  onRefresh,
}: {
  basis: RateBasis;
  options: Record<RateBasis, number | null>;
  customRate: number;
  status: string;
  onBasis: (b: RateBasis) => void;
  onCustom: (rate: number) => void;
  onRefresh: () => void;
}) {
  return (
    <section className="panel" aria-labelledby="rateTitle">
      <div className="panel-head">
        <h2 id="rateTitle">Exchange rate</h2>
        <p className="hint">Which rate should the plan use?</p>
      </div>
      <div className="seg" role="radiogroup" aria-labelledby="rateTitle">
        {(Object.keys(BASIS) as RateBasis[]).map((b) => (
          <label className="seg-opt" key={b}>
            <input
              type="radio"
              name="rateBasis"
              id={'basis-' + b}
              value={b}
              checked={basis === b}
              disabled={b !== 'custom' && b !== 'live' && !options[b]}
              onChange={() => onBasis(b)}
            />
            <span className="seg-name">{BASIS[b].label}</span>
            <span className="seg-val">{rateTxt(options[b])}</span>
          </label>
        ))}
      </div>
      {basis === 'custom' ? (
        <div className="custom">
          <label htmlFor="customRate">Try a rate</label>
          <div className="custom-row">
            <span className="prefix">₱</span>
            <NumberInput id="customRate" step={0.05} min={30} max={100} digits={2} value={customRate} onValue={(v) => v > 0 && onCustom(v)} />
            <input
              type="range"
              id="customRange"
              min={55}
              max={72}
              step={0.05}
              aria-label="Exchange rate slider"
              value={customRate}
              onChange={(e) => onCustom(parseFloat(e.target.value))}
            />
          </div>
        </div>
      ) : null}
      <p className="hint">{BASIS[basis].hint}</p>
      <div className="fx-status">
        <span>{status}</span>
        <button type="button" className="link-btn" onClick={onRefresh}>
          Refresh
        </button>
      </div>
    </section>
  );
}

// ---------- Where rate swings land ----------

function flexStory(m: Month) {
  const at = `At ${rateTxt(m.rate)}`;
  if (m.shortfall > 0) return `${at}, take-home doesn't cover rent, bills and subscriptions. You'd be ${peso(m.shortfall)} short.`;
  if (Math.abs(m.gap) < 1) return `${at}, the plan lands right on your goal.`;
  const toSav = m.savings - m.target;
  const toLiv = m.living - m.livingPlan;
  const bits: string[] = [];
  if (Math.abs(toSav) >= 1) bits.push(`savings ${toSav > 0 ? 'gets' : 'gives up'} ${peso(Math.abs(toSav))}`);
  if (Math.abs(toLiv) >= 1) bits.push(`spending money ${toLiv > 0 ? 'gets' : 'gives up'} ${peso(Math.abs(toLiv))}`);
  const lead = m.gap > 0 ? `${at}, you have ${peso(m.gap)} more than the plan needs.` : `${at}, you're ${peso(-m.gap)} short of the plan.`;
  return `${lead} ${capFirst(bits.join(' and '))}.`;
}

export function FlexPanel({
  cfg,
  m,
  onTarget,
  onFlex,
}: {
  cfg: Config;
  m: Month;
  onTarget: (v: number) => void;
  onFlex: (v: number) => void;
}) {
  const p = Math.round(cfg.flexToSavings);
  return (
    <section className="panel" aria-labelledby="flexTitle">
      <div className="panel-head">
        <h2 id="flexTitle">When the rate moves</h2>
        <p className="hint">A stronger dollar is a raise; a weaker one is a pay cut. Decide where that lands.</p>
      </div>
      <div className="field">
        <label htmlFor="savingsTarget">Savings goal per month</label>
        <div className="money-input">
          <span className="prefix">₱</span>
          <NumberInput id="savingsTarget" min={0} step={500} value={cfg.savingsTarget} onValue={onTarget} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="flex">Who takes the swing</label>
        <input type="range" id="flex" min={0} max={100} step={10} value={cfg.flexToSavings} onChange={(e) => onFlex(parseFloat(e.target.value))} />
        <div className="flex-ends">
          <span>Spending</span>
          <span>Savings</span>
        </div>
        <p className="flex-readout">
          {p >= 100 ? 'All of it goes to savings' : p <= 0 ? 'All of it goes to spending money' : `${p}% to savings, ${100 - p}% to spending money`}
        </p>
      </div>
      <p className="explain">{flexStory(m)}</p>
    </section>
  );
}

// ---------- Paychecks ----------

export function PaychecksPanel({
  income,
  perCheck,
  cal,
  onIncome,
}: {
  income: Income;
  perCheck: number;
  cal: PayCalendar;
  onIncome: (patch: Partial<Income>) => void;
}) {
  const n = cal.extra.length;
  return (
    <section className="panel" aria-labelledby="payTitle">
      <div className="panel-head">
        <h2 id="payTitle">Paychecks</h2>
      </div>
      <div className="fields-2">
        <div className="field">
          <label htmlFor="usdPerPaycheck">Per paycheck</label>
          <div className="money-input">
            <span className="prefix usd">$</span>
            <NumberInput id="usdPerPaycheck" min={0} step={5} value={income.usdPerPaycheck} onValue={(v) => onIncome({ usdPerPaycheck: v })} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="schedule">Paid</label>
          <select id="schedule" value={income.schedule} onChange={(e) => onIncome({ schedule: e.target.value as Income['schedule'] })}>
            <option value="biweekly">Every 2 weeks</option>
            <option value="semimonthly">15th &amp; end of month</option>
          </select>
        </div>
        {income.schedule === 'biweekly' ? (
          <div className="field">
            <label htmlFor="anchorPayday">
              A real payday {income.anchorIsGuess ? <span className="est">est.</span> : null}
            </label>
            <input
              type="date"
              id="anchorPayday"
              value={income.anchorPayday}
              onChange={(e) => e.target.value && onIncome({ anchorPayday: e.target.value, anchorIsGuess: false })}
            />
          </div>
        ) : null}
        <div className="field">
          <label htmlFor="feePct">Conversion fee</label>
          <div className="money-input">
            <NumberInput id="feePct" min={0} max={10} step={0.1} value={income.feePct} onValue={(v) => onIncome({ feePct: Math.max(0, v) })} />
            <span className="suffix">%</span>
          </div>
        </div>
      </div>
      <p className="hint">If Wise, Payoneer or your bank pays out below the market rate, put the gap in Conversion fee (for example 1.5).</p>
      <div className="paydays">
        {cal.next ? (
          <p>
            Next payday: <b>{fmtDay(cal.next)}</b> · {usd(income.usdPerPaycheck)} ≈ {peso(perCheck)}
          </p>
        ) : null}
        {income.schedule !== 'biweekly' ? (
          <p className="hint">Paid on the 15th and the last day of the month, so every month has exactly two paychecks.</p>
        ) : n ? (
          <>
            <p>
              <b>Third-paycheck months</b> in the next year:
            </p>
            <div className="chips">
              {cal.extra.map((e) => (
                <span className="chip" key={e.month} title={e.dates.map(fmtDay).join(', ')}>
                  {fmtMonth(e.month)}
                </span>
              ))}
            </div>
            <p className="hint">
              Every 2 weeks means 26 paychecks a year, not 24. The plan counts two a month, so{' '}
              {n === 1 ? 'the extra one is' : `each of these ${n} extras is`} free money: about {peso(perCheck)} each,{' '}
              {peso(perCheck * n)} a year on top of your goal.
            </p>
          </>
        ) : null}
      </div>
    </section>
  );
}
