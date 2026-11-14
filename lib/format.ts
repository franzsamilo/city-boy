/*
 * Formatting helpers. Dates are formatted by hand (not toLocaleString) so the
 * server render and the browser always produce identical text.
 */
import { isoToUTC } from './budget.ts';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MANILA_OFFSET = 8 * 3_600_000; // UTC+8, no daylight saving

const group = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

export const peso = (n: number) => {
  const r = Math.round(n) || 0;
  return (r < 0 ? '-₱' : '₱') + group(Math.abs(r));
};
export const usd = (n: number) => {
  const cents = Math.round((n || 0) * 100);
  return (cents < 0 ? '-$' : '$') + group(Math.floor(Math.abs(cents) / 100)) + '.' + String(Math.abs(cents) % 100).padStart(2, '0');
};
export const rateTxt = (r: number | null | undefined) => (r ? '₱' + r.toFixed(2) : '—');
export const signedPeso = (n: number) => (Math.round(n) >= 0 ? '+' : '−') + peso(Math.abs(n));
export const pct = (n: number) => (Number.isFinite(n) ? Math.round(n * 100) : 0) + '%';
export const capFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "Fri, Nov 20" */
export const fmtDay = (iso: string) => {
  const d = new Date(isoToUTC(iso));
  return `${WEEKDAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
};

/** "Jan 2027" from "2027-01" */
export const fmtMonth = (ym: string) => `${MONTHS[+ym.slice(5, 7) - 1]} ${ym.slice(0, 4)}`;

/** "Sep" for a UTC timestamp */
export const fmtMonthShort = (t: number) => MONTHS[new Date(t).getUTCMonth()];

/** The Manila calendar day a rate belongs to (sources give a date or a timestamp). */
export const asOfDay = (asOf: string) =>
  asOf.length <= 10 ? asOf : new Date(Date.parse(asOf) + MANILA_OFFSET).toISOString().slice(0, 10);

/** "Sat, Nov 14" or "Sat, Nov 14, 8:02 AM" (Manila time) */
export const fmtAsOf = (asOf: string) => {
  if (asOf.length <= 10) return fmtDay(asOf);
  const d = new Date(Date.parse(asOf) + MANILA_OFFSET);
  const h = d.getUTCHours();
  const time = `${h % 12 || 12}:${String(d.getUTCMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
  return `${fmtDay(d.toISOString().slice(0, 10))}, ${time}`;
};

/** Today's date in Manila (yyyy-mm-dd). Call it in effects or handlers, not during render. */
export const manilaToday = () => new Date(Date.now() + MANILA_OFFSET).toISOString().slice(0, 10);
