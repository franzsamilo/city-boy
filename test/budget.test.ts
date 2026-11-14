// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { compute, DEFAULTS, mergeConfig, payCalendar, rateStats, type Config } from '../lib/budget.ts';
import { asOfDay, fmtAsOf, fmtDay, peso, usd } from '../lib/format.ts';

const cfg = (): Config => structuredClone(DEFAULTS);
const near = (a: number, b: number, eps = 0.01) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('take-home: $950 a month at ₱63.81 is about ₱60.6K', () => {
  const r = compute(cfg(), 63.81);
  near(r.income, 950 * 63.81);
  near(r.perCheck, 475 * 63.81);
});

test('Claude is priced in dollars, so it moves with the rate', () => {
  const claude = (rate: number) => compute(cfg(), rate).rows.find((x) => x.id === 'claude')!.php;
  near(claude(60), 1200);
  near(claude(65), 1300);
});

test('bills add up to the ₱4,000 cap by default', () => {
  near(compute(cfg(), 63).groupTotals.Bills, 4000);
});

test('at the target rate, savings land exactly on the goal', () => {
  const c = cfg();
  const r0 = compute(c, 63);
  const r = compute(c, r0.targetRate!);
  near(r.savings, c.savingsTarget);
  near(r.living, r.livingPlan);
  // (17,500 + 4,000 + 149 + 17,000 + 20,000) / (950 − 20)
  near(r0.targetRate!, 58649 / 930, 1e-9);
});

test('savings absorbs the swing by default; each ₱1 of rate is ₱930', () => {
  const lo = compute(cfg(), 62);
  const hi = compute(cfg(), 63);
  near(hi.savings - lo.savings, 930);
  near(hi.living, lo.living);
});

test('a 50/50 flex splits the swing between savings and spending', () => {
  const c = cfg();
  c.flexToSavings = 50;
  const atTarget = compute(c, compute(c, 63).targetRate!);
  const plus2 = compute(c, atTarget.rate + 2);
  near(plus2.savings - atTarget.savings, 930);
  near(plus2.living - atTarget.living, 930);
});

test('savings and spending never go negative; a shortfall is reported', () => {
  const r = compute(cfg(), 20);
  assert.equal(r.savings, 0);
  assert.equal(r.living, 0);
  assert.ok(r.shortfall > 0);
  assert.equal(r.status, 'short');
});

test('a conversion fee comes off the take-home', () => {
  const c = cfg();
  c.income.feePct = 1;
  near(compute(c, 60).income, 950 * 60 * 0.99);
});

test('bi-weekly pay puts a third paycheck in two months of the year', () => {
  const cal = payCalendar(DEFAULTS.income, '2026-11-14', 12);
  assert.equal(cal.next, '2026-11-20');
  assert.equal(cal.paydays.length, 26);
  assert.deepEqual(cal.extra.map((e) => e.month), ['2027-01', '2027-07']);
});

test('twice-a-month pay never has a third paycheck', () => {
  const cal = payCalendar({ ...DEFAULTS.income, schedule: 'semimonthly' }, '2026-11-14', 12);
  assert.equal(cal.next, '2026-11-15');
  assert.equal(cal.paydays.length, 24);
  assert.equal(cal.extra.length, 0);
  assert.ok(cal.paydays.includes('2027-02-28'));
});

test('rate stats: 30-day average and 90-day low', () => {
  const s = rateStats(
    [
      { date: '2026-08-20', rate: 61.4 },
      { date: '2026-10-20', rate: 63.0 },
      { date: '2026-11-13', rate: 64.0 },
    ],
    '2026-11-14',
  );
  near(s.avg30!, 63.5);
  near(s.low90!, 61.4);
  near(s.high90!, 64.0);
});

test('a saved plan from an older version falls back to the defaults', () => {
  assert.deepEqual(mergeConfig({ version: 0, savingsTarget: 1 }), DEFAULTS);
  assert.equal(mergeConfig({ ...DEFAULTS, savingsTarget: 25000 }).savingsTarget, 25000);
});

test('formatting matches between server and browser (no locale APIs)', () => {
  assert.equal(peso(60665.4), '₱60,665');
  assert.equal(usd(950), '$950.00');
  assert.equal(fmtDay('2026-11-20'), 'Fri, Nov 20');
  // 00:02 UTC is 8:02 AM in Manila
  assert.equal(asOfDay('2026-11-14T00:02:31.000Z'), '2026-11-14');
  assert.equal(fmtAsOf('2026-11-14T00:02:31.000Z'), 'Sat, Nov 14, 8:02 AM');
  assert.equal(asOfDay('2026-11-13T17:00:00.000Z'), '2026-11-14');
});
