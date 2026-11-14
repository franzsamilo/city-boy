import BudgetApp from '@/components/BudgetApp';
import { getRates } from '@/lib/rates';

export default async function Home() {
  // Cached for an hour (see lib/rates.ts), so the page ships with a recent rate.
  const rates = await getRates();
  return <BudgetApp initialRates={rates} />;
}
