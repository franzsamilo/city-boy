import { getRates } from '@/lib/rates';

/** Today's USD→PHP rate plus ~95 days of history, cached for an hour. */
export async function GET() {
  return Response.json(await getRates());
}
