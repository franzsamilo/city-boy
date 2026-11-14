import type { RatePoint } from './budget.ts';

export interface LiveRate {
  rate: number;
  /** yyyy-mm-dd, or an ISO timestamp when the source gives one */
  asOf: string;
  source: string;
}

export interface RatesPayload {
  live: LiveRate | null;
  history: RatePoint[];
  /** today's date in Manila when this payload was built */
  today: string;
  fetchedAt: string;
}

/** Used only when every source is down and this device has nothing saved. */
export const FALLBACK_RATE: LiveRate = { rate: 63.81, asOf: '2026-11-13', source: 'built-in rate' };
