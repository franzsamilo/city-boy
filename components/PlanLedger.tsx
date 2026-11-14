'use client';

import { useEffect, useState } from 'react';
import { FLEX_GROUP, GROUPS, type Config, type Group, type Item, type Month } from '@/lib/budget';
import { peso, rateTxt, signedPeso, usd } from '@/lib/format';
import NumberInput from './NumberInput';

const GROUP_INFO: Record<Group, { label: string; color: string; note?: string; add: string }> = {
  Housing: { label: 'Rent', color: 'var(--c-housing)', add: 'housing cost' },
  Bills: { label: 'Bills', color: 'var(--c-bills)', add: 'bill' },
  Subscriptions: { label: 'Subscriptions', color: 'var(--c-subs)', note: '$ items follow the rate', add: 'subscription' },
  Living: { label: 'Spending money', color: 'var(--c-living)', note: 'Food, getting around, going out', add: 'spending' },
};

interface Props {
  cfg: Config;
  m: Month;
  onItem: (id: string, patch: Partial<Item>) => void;
  onRemove: (id: string) => void;
  onAdd: (group: Group) => string;
  onCap: (group: Group, value: number) => void;
}

export default function PlanLedger({ cfg, m, onItem, onRemove, onAdd, onCap }: Props) {
  const [focusId, setFocusId] = useState<string | null>(null);
  useEffect(() => {
    if (!focusId) return;
    document.getElementById('name-' + focusId)?.focus();
    setFocusId(null);
  }, [focusId]);

  const php = new Map(m.rows.map((r) => [r.id, r.php]));
  const livingDiff = m.living - m.livingPlan;

  return (
    <section className="panel plan" aria-labelledby="planTitle">
      <div className="panel-head">
        <h2 id="planTitle">Monthly plan</h2>
        <p className="hint">
          Two paychecks a month. Each {usd(cfg.income.usdPerPaycheck)} comes to about {peso(m.perCheck)}.
        </p>
      </div>
      <div className="row row-head" aria-hidden="true">
        <span className="c-name">Item</span>
        <span className="c-amt">Amount</span>
        <span className="c-month">Per month</span>
        <span className="c-check">Per paycheck</span>
        <span className="c-del" />
      </div>

      <div>
        {GROUPS.map((g) => {
          const info = GROUP_INFO[g];
          const cap = cfg.caps[g];
          const total = m.groupTotals[g] ?? 0;
          const over = cap != null ? total - cap : 0;
          return (
            <div className="group" key={g}>
              <div className="group-head">
                <h3>
                  <i style={{ background: info.color }} />
                  {info.label}
                </h3>
                {info.note ? <span className="group-note">{info.note}</span> : null}
                <span className="group-total">
                  <span className="num">{peso(total)}</span>
                  {cap != null ? (
                    <>
                      <label className="cap-input">
                        cap ₱
                        <NumberInput
                          id={'cap-' + g}
                          min={0}
                          step={100}
                          value={cap}
                          onValue={(v) => onCap(g, v)}
                          aria-label={`${info.label} cap per month`}
                        />
                      </label>
                      <span className={`pill ${over > 0.5 ? 'over' : Math.abs(over) <= 0.5 ? 'neutral' : 'on'}`}>
                        {over > 0.5 ? `${peso(over)} over` : Math.abs(over) <= 0.5 ? 'at cap' : `${peso(-over)} under`}
                      </span>
                    </>
                  ) : null}
                </span>
              </div>

              {cfg.items
                .filter((it) => it.group === g)
                .map((it) => (
                  <ItemRow
                    key={it.id}
                    it={it}
                    php={php.get(it.id) ?? 0}
                    rate={m.rate}
                    onItem={onItem}
                    onRemove={onRemove}
                  />
                ))}

              {g === FLEX_GROUP && Math.abs(livingDiff) >= 1 && m.shortfall === 0 ? (
                <div className="row row-adjust">
                  <span className="c-name name-static">Rate adjustment</span>
                  <span className="c-amt goal-static">from the rate</span>
                  <output className="num c-month">{signedPeso(livingDiff)}</output>
                  <output className="num c-check">{signedPeso(livingDiff / 2)}</output>
                  <span className="c-del" />
                </div>
              ) : null}

              <button type="button" className="add-btn" onClick={() => setFocusId(onAdd(g))}>
                + Add {info.add}
              </button>
            </div>
          );
        })}
      </div>

      <div className="group group-savings">
        <div className="group-head">
          <h3>
            <i />
            Savings
          </h3>
          <span className="group-note">
            {m.shortfall > 0
              ? ''
              : Math.abs(m.savings - m.target) < 1
                ? 'right on goal'
                : `${signedPeso(m.savings - m.target)} vs goal because of the rate`}
          </span>
        </div>
        <div className={`row row-calc is-${m.status}`}>
          <span className="c-name name-static">Savings this month</span>
          <span className="c-amt goal-static">goal {peso(m.target)}</span>
          <output className="num c-month">{peso(m.savings)}</output>
          <output className="num c-check">{peso(m.savings / 2)}</output>
          <span className="c-del" />
        </div>
      </div>

      <div className="row row-total">
        <span className="c-name">Total = take-home</span>
        <span className="c-amt" />
        <output className="num c-month">{peso(m.income)}</output>
        <output className="num c-check">{peso(m.perCheck)}</output>
        <span className="c-del" />
      </div>
      <p className="footnote">
        <span className="est">est.</span> marks numbers I guessed. Type your real amount and the tag goes away.
      </p>
    </section>
  );
}

function ItemRow({
  it,
  php,
  rate,
  onItem,
  onRemove,
}: {
  it: Item;
  php: number;
  rate: number;
  onItem: Props['onItem'];
  onRemove: Props['onRemove'];
}) {
  return (
    <div className="row">
      <div className="name-wrap">
        <input
          type="text"
          id={'name-' + it.id}
          value={it.name}
          placeholder="New item"
          aria-label="Item name"
          onChange={(e) => onItem(it.id, { name: e.target.value })}
        />
        {it.est ? (
          <span className="est" title="A guess. Type your real amount and this tag goes away.">
            est.
          </span>
        ) : null}
      </div>
      <div className="amt">
        <select
          id={'cur-' + it.id}
          aria-label="Currency"
          className={it.currency === 'USD' ? 'is-usd' : undefined}
          value={it.currency}
          onChange={(e) => onItem(it.id, { currency: e.target.value as Item['currency'] })}
        >
          <option value="PHP">₱</option>
          <option value="USD">$</option>
        </select>
        <NumberInput
          id={'amt-' + it.id}
          min={0}
          step="any"
          value={it.amount}
          aria-label="Monthly amount"
          onValue={(v) => onItem(it.id, { amount: v, est: false })}
        />
      </div>
      <output className="num month" title={it.currency === 'USD' ? `${usd(it.amount)} at ${rateTxt(rate)}` : undefined}>
        {peso(php)}
      </output>
      <output className="num check">{peso(php / 2)}</output>
      <button type="button" className="del" aria-label={'Remove ' + (it.name || 'item')} onClick={() => onRemove(it.id)}>
        ×
      </button>
    </div>
  );
}
