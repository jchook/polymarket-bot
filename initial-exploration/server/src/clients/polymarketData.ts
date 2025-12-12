import {
  type ListMarketsParams,
  type Market,
  type Event,
  type EventParams,
  Polymarket,
} from "polymarket-data";

const client = new Polymarket({
  gammaEndpoint: process.env.GAMMA_BASE_URL,
});

export async function listGammaMarkets(
  params: ListMarketsParams = {},
): Promise<Market[]> {
  return client.gamma.markets.listMarkets(params);
}

export async function getGammaEventBySlug(
  slug: string,
  params?: EventParams,
): Promise<Event> {
  return client.gamma.events.getEventBySlug(slug, params);
}

export type { ListMarketsParams, Market, Event, EventParams };
