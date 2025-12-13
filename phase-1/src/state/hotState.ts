import { getRedis } from "./redisClient";

export type BestBookState = {
  bestBid?: number;
  bestAsk?: number;
  mid?: number | null;
  updatedAt: number;
};

export type SpotState = {
  productId: string;
  baseAsset?: string;
  quoteAsset?: string;
  mid?: number | null;
  updatedAt: number;
};

const bookCache = new Map<string, BestBookState>();
const spotCache = new Map<string, SpotState>();

const BOOK_TTL_MS = Number(process.env.BEST_BOOK_TTL_MS ?? 5_000);
const SPOT_TTL_MS = Number(process.env.SPOT_TTL_MS ?? 5_000);

function bookKey(assetId: string) {
  return `book:${assetId}`;
}

function spotKey(productId: string) {
  return `spot:${productId}`;
}

export async function setBestBookState(
  assetId: string,
  state: BestBookState,
): Promise<void> {
  bookCache.set(assetId, state);

  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.set(bookKey(assetId), JSON.stringify(state), {
      PX: BOOK_TTL_MS,
    });
  } catch (err) {
    console.error("Failed to set book state in redis", err);
  }
}

export function getBestBookState(assetId: string): BestBookState | undefined {
  const state = bookCache.get(assetId);
  if (!state) return undefined;
  if (Date.now() - state.updatedAt > BOOK_TTL_MS) {
    bookCache.delete(assetId);
    return undefined;
  }
  return state;
}

export async function setSpotState(state: SpotState): Promise<void> {
  spotCache.set(state.productId, state);
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.set(spotKey(state.productId), JSON.stringify(state), {
      PX: SPOT_TTL_MS,
    });
  } catch (err) {
    console.error("Failed to set spot state in redis", err);
  }
}

export function getSpotState(productId: string): SpotState | undefined {
  const state = spotCache.get(productId);
  if (!state) return undefined;
  if (Date.now() - state.updatedAt > SPOT_TTL_MS) {
    spotCache.delete(productId);
    return undefined;
  }
  return state;
}
