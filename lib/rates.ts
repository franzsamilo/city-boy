/*
 * USD→PHP rates, fetched on the server and cached for an hour.
 * The page and /api/rates both read from here, so the browser never calls
 * the rate services directly.
 */
import { cacheLife } from 'next/cache';
import type { RatePoint } from './budget.ts';
import { addDaysISO } from './budget.ts';
import { manilaToday } from './format.ts';
import type { LiveRate, RatesPayload } from './rate-types.ts';

export type { LiveRate, RatesPayload };

async function getJSON(url: string): Promise<any> {
  const res = await fetch(url, { signal: AbortSignal.timeout(9000) });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.json();
}

// Tried in order until one answers.
const LIVE_SOURCES: { name: string; url: string; pick: (d: any) => Omit<LiveRate, 'source'> }[] = [
  {
    name: 'ExchangeRate-API',
    url: 'https://open.er-api.com/v6/latest/USD',
    pick: (d) => ({ rate: d.rates.PHP, asOf: new Date(d.time_last_update_unix * 1000).toISOString() }),
  },
  {
    name: 'Frankfurter (ECB)',
    url: 'https://api.frankfurter.dev/v1/latest?base=USD&symbols=PHP',
    pick: (d) => ({ rate: d.rates.PHP, asOf: d.date }),
  },
  {
    name: 'Currency API',
    url: 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.min.json',
    pick: (d) => ({ rate: d.usd.php, asOf: d.date }),
  },
];

async function fetchLive(): Promise<LiveRate | null> {
  for (const src of LIVE_SOURCES) {
    try {
      const p = src.pick(await getJSON(src.url));
      if (p.rate > 0) return { ...p, source: src.name };
    } catch {
      // try the next source
    }
  }
  return null;
}

async function fetchHistory(today: string): Promise<RatePoint[]> {
  try {
    const d = await getJSON(`https://api.frankfurter.dev/v1/${addDaysISO(today, -95)}..?base=USD&symbols=PHP`);
    return Object.keys(d.rates)
      .sort()
      .map((date) => ({ date, rate: Number(d.rates[date].PHP) }))
      .filter((h) => h.rate > 0);
  } catch {
    return [];
  }
}

export async function getRates(): Promise<RatesPayload> {
  'use cache';
  cacheLife('hours'); // rebuilt in the background at most once an hour

  const today = manilaToday();
  const [live, history] = await Promise.all([fetchLive(), fetchHistory(today)]);
  return { live, history, today, fetchedAt: new Date().toISOString() };
}
