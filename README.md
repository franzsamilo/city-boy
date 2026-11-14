# Makati Budget

A monthly budget for living in Makati on a USD income. You're paid in dollars and spend in pesos, so every time USD→PHP moves, your month changes. This page pulls the live rate and re-plans the month on its own.

## Run it

No install and no build step. Either:

- open `index.html` in a browser, or
- serve the folder (better on phones): `npm start`, then open http://localhost:8080

Everything you type is saved in that browser (localStorage). Nothing is sent anywhere. The only network calls are to the free exchange-rate services below.

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

Any item can be in ₱ or $. Dollar-priced items convert at the plan's rate.

## How the flexing works

1. **Pick the rate the plan uses**: today's live rate, the 30-day average (steadier), the 90-day low (cautious), or a what-if rate on a slider.
2. **Take-home** = $ per paycheck × 2 × rate × (1 − conversion fee).
3. **Fixed costs** (rent, bills, subscriptions) come off first.
4. Compared with plan (spending money + savings goal), any leftover or shortfall is the **gap**. The **"Who takes the swing"** slider decides where the gap goes:
   - 100% savings (default): spending money stays put and savings moves with the dollar.
   - 0% savings: savings stays at the goal and spending money absorbs it.
   - anything in between splits it.

Two numbers make the rate easy to read:

- **₱ per ₱1 of rate.** With the starting plan, each ₱1 move in USD→PHP changes your month by **₱930**. That's $950 of pay minus the $20 Claude bill, which rises along with the dollar.
- **Goal rate.** This is the rate at which you hit the savings goal exactly. With the starting plan it's **₱63.06**.

### Third paychecks

"Every 2 weeks" means 26 paychecks a year, not 24. The plan budgets every month on two, so two months a year (with the starting payday, Jan and Jul 2027) bring a whole extra paycheck you can save. Set **A real payday** to one of your actual paydays so the calendar matches. If you're actually paid on the 15th and 30th, switch **Paid** to "15th & end of month".

### Conversion fee

Banks, Wise, Payoneer and PayPal usually pay out a bit below the market rate. If you know how much lower, enter it as a percent and every number accounts for it.

## Exchange-rate sources

- Today's rate: [ExchangeRate-API open endpoint](https://www.exchangerate-api.com/docs/free), with [Frankfurter](https://frankfurter.dev) (ECB) and [fawazahmed0/currency-api](https://github.com/fawazahmed0/exchange-api) as fallbacks. Checked on load and every hour while the page is open.
- History (30-day average, 90-day low, chart): Frankfurter / ECB daily reference rates.
- Offline: the last rate saved on the device is used. If there's none, a built-in ₱63.81 (Nov 2026).

## Files

- `index.html`, `styles.css`: the page
- `app.js`: fetches rates, renders the plan, saves your edits
- `budget.js`: the budget math (pure functions, shared with the tests)
- `test/budget.test.js`: `npm test` (Node 18+)
