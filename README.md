# Makati Budget

A monthly budget for living in Makati on a USD income. You're paid in dollars and spend in pesos, so every time USD→PHP moves, your month changes. This app pulls the live rate and re-plans the month on its own.

Built with Next.js 16 (App Router, Cache Components) and TypeScript. No database: your plan is saved in your browser.

## Run it

Needs Node 22.18 or newer.

```bash
npm install
npm run dev        # http://localhost:3000
```

Other scripts:

```bash
npm run build && npm start   # production build
npm test                     # budget math tests (node --test)
npm run typecheck
```

### Deploy

Import the repo on [vercel.com/new](https://vercel.com/new). It needs no settings or environment variables. The page and `/api/rates` are prebuilt and refreshed in the background at most once an hour.

## What's in the starting plan

| Item | Amount | Notes |
|---|---|---|
| Pay | $475 per paycheck, every 2 weeks | $950 a month ≈ ₱60.7K at ₱63.86 |
| Rent | ₱17,500 | |
| Bills | ₱4,000 cap | Electricity, internet and water are **guesses** (marked `est.`) |
| Claude | **$20** | Priced in dollars, so it follows the rate (≈ ₱1,277 today) |
| YouTube Premium | ₱149 | |
| Spending money | ₱17,000 | Food, transport, going out. **Guesses** (marked `est.`) |
| Savings goal | ₱20,000 / month | |

These starting values live in `DEFAULTS` in `lib/budget.ts`. Anything you change in the app is saved in that browser and overrides them.

## How the flexing works

1. **Pick the rate the plan uses**: today's live rate, the 30-day average (steadier), the 90-day low (cautious), or a what-if rate on a slider.
2. **Take-home** = $ per paycheck × 2 × rate × (1 − conversion fee).
3. **Fixed costs** (rent, bills, subscriptions) come off first. Dollar-priced items convert at the same rate.
4. Compared with plan (spending money + savings goal), any leftover or shortfall is the **gap**. The **"Who takes the swing"** slider decides where it goes: all to savings (default), all to spending money, or a split.

Two numbers make the rate easy to read:

- **₱ per ₱1 of rate.** Each ₱1 move in USD→PHP changes your month by **₱930**. That's $950 of pay minus the $20 Claude bill, which rises along with the dollar.
- **Goal rate.** This is the rate at which savings hit the goal exactly. With the starting plan it's **₱63.06**.

**Third paychecks.** "Every 2 weeks" means 26 paychecks a year. The plan counts two a month, so two months a year bring a whole extra paycheck to save. Set **A real payday** so the calendar matches. If you're actually paid on the 15th and 30th, switch **Paid** to "15th & end of month".

**Conversion fee.** If your bank, Wise, Payoneer or PayPal pays out below the market rate, enter the gap as a percent.

## Where the rate comes from

`lib/rates.ts` fetches on the server inside a `'use cache'` function with `cacheLife('hours')`:

- today's rate from the [ExchangeRate-API open endpoint](https://www.exchangerate-api.com/docs/free), falling back to [Frankfurter](https://frankfurter.dev) (ECB), then [fawazahmed0/currency-api](https://github.com/fawazahmed0/exchange-api);
- ~95 days of history from Frankfurter, which feeds the 30-day average, the 90-day low and the chart.

The page ships with that data already in it. While it's open, the browser checks `/api/rates` every hour and whenever you return to the tab. If the services are down, the app uses the last rate saved on your device, or a built-in ₱63.81 (Nov 2026) as a last resort.

## Files

```
app/
  page.tsx            server: loads cached rates, renders <BudgetApp>
  layout.tsx          fonts, metadata
  api/rates/route.ts  GET /api/rates (same cached data, for the browser to poll)
  globals.css         styles (light + dark)
components/
  BudgetApp.tsx       state, saving to localStorage, rate polling
  Summary.tsx         the four numbers + money split bar
  PlanLedger.tsx      editable plan
  Panels.tsx          exchange rate, flex rule, paychecks
  SavingsChart.tsx    90-day chart (SVG)
lib/
  budget.ts           budget math (pure, tested)
  rates.ts            server-side rate fetching + caching
  format.ts           ₱/$ and date formatting
test/budget.test.ts
```
