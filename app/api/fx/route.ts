/**
 * GET /api/fx?home=NZD&to=PHP,GBP
 * Today's exchange rates for the projector. Cached for 6 hours.
 */
import { fetchRates, isCurrency } from '../../../lib/fxRates';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const home = url.searchParams.get('home');
  const to = (url.searchParams.get('to') ?? '').split(',').filter(isCurrency);
  if (!isCurrency(home) || !to.length) return Response.json({ error: 'Choose a home currency and at least one other currency.' }, { status: 400 });
  const quote = await fetchRates(home, to);
  if (!quote) return Response.json({ error: "Today's exchange rates couldn't be fetched. Enter the rates yourself." }, { status: 502 });
  return Response.json(quote, { headers: { 'Cache-Control': 'public, max-age=3600' } });
}
