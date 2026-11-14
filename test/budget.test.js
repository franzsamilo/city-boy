// Run with: npm test   (or: node --test)
const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../budget.js');

const cfg = () => structuredClone(B.DEFAULTS);
const near = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('take-home: $950 a month at ₱63.81 is about ₱60.6K', () => {
  const r = B.compute(cfg(), 63.81);
  near(r.income, 950 * 63.81);
  near(r.perCheck, 475 * 63.81);
});

test('Claude is priced in dollars, so it moves with the rate', () => {
  const at60 = B.compute(cfg(), 60).rows.find((x) => x.id === 'claude').php;
  const at65 = B.compute(cfg(), 65).rows.find((x) => x.id === 'claude').php;
  near(at60, 1200);
  near(at65, 1300);
});

test('bills add up to the ₱4,000 cap by default', () => {
  const r = B.compute(cfg(), 63);
  near(r.groupTotals.Bills, 4000);
});

test('at the target rate, savings land exactly on the goal', () => {
  const c = cfg();
  const r0 = B.compute(c, 63);
  const r = B.compute(c, r0.targetRate);
  near(r.savings, c.savingsTarget);
  near(r.living, r.livingPlan);
  // (17,500 + 4,000 + 149 + 17,000 + 20,000) / (950 − 20)
  near(r0.targetRate, 58649 / 930, 1e-9);
});

test('savings absorbs the swing by default; each ₱1 of rate is ₱930', () => {
  const c = cfg();
  const lo = B.compute(c, 62);
  const hi = B.compute(c, 63);
  near(hi.savings - lo.savings, 930);
  near(hi.living, lo.living); // spending untouched
});

test('a 50/50 flex splits the swing between savings and spending', () => {
  const c = cfg();
  c.flexToSavings = 50;
  const atTarget = B.compute(c, B.compute(c, 63).targetRate);
  const plus2 = B.compute(c, atTarget.rate + 2);
  near(plus2.savings - atTarget.savings, 930);
  near(plus2.living - atTarget.living, 930);
});

test('savings and spending never go negative; a shortfall is reported', () => {
  const c = cfg();
  const r = B.compute(c, 20); // absurd rate: income doesn't cover rent + bills
  assert.equal(r.savings, 0);
  assert.equal(r.living, 0);
  assert.ok(r.shortfall > 0);
  assert.equal(r.status, 'short');
});

test('a conversion fee comes off the take-home', () => {
  const c = cfg();
  c.income.feePct = 1;
  near(B.compute(c, 60).income, 950 * 60 * 0.99);
});

test('bi-weekly pay puts a third paycheck in two months of the year', () => {
  const cal = B.payCalendar(B.DEFAULTS.income, '2026-11-14', 12);
  assert.equal(cal.next, '2026-11-20');
  assert.equal(cal.paydays.length, 26);
  assert.deepEqual(
    cal.extra.map((e) => e.month),
    ['2027-01', '2027-07'],
  );
});

test('twice-a-month pay never has a third paycheck', () => {
  const income = { ...B.DEFAULTS.income, schedule: 'semimonthly' };
  const cal = B.payCalendar(income, '2026-11-14', 12);
  assert.equal(cal.next, '2026-11-15');
  assert.equal(cal.paydays.length, 24);
  assert.equal(cal.extra.length, 0);
  assert.ok(cal.paydays.includes('2027-02-28'));
});

test('rate stats: 30-day average and 90-day low', () => {
  const hist = [
    { date: '2026-08-20', rate: 61.4 },
    { date: '2026-10-20', rate: 63.0 },
    { date: '2026-11-13', rate: 64.0 },
  ];
  const s = B.rateStats(hist, '2026-11-14');
  near(s.avg30, 63.5);
  near(s.low90, 61.4);
  near(s.high90, 64.0);
});
