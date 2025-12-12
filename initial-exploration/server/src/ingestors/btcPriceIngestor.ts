import { and, desc, eq } from "drizzle-orm";
import { db } from "../db";
import { btcPrices } from "../db/schema";

type FetchKlinesParams = {
  symbol: string;
  interval: string;
  start: number; // ms
  end: number; // ms
  limit?: number;
  provider: "binance" | "bitstamp";
};

type Kline = {
  openTime: number; // ms
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
};

async function fetchBinanceKlines({
  symbol,
  interval,
  start,
  end,
  limit = 1000,
}: FetchKlinesParams): Promise<Kline[]> {
  const url = new URL("https://api.binance.com/api/v3/klines");
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("interval", interval);
  url.searchParams.set("startTime", start.toString());
  url.searchParams.set("endTime", end.toString());
  url.searchParams.set("limit", limit.toString());

  const resp = await fetch(url.toString());
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(
      `Binance klines error status=${resp.status} body=${text ?? ""}`,
    );
  }

  const data = (await resp.json()) as unknown[];
  return data.map((row) => {
    if (!Array.isArray(row) || row.length < 6) {
      throw new Error("Unexpected kline shape from Binance");
    }
    return {
      openTime: Number(row[0]),
      open: row[1] as string,
      high: row[2] as string,
      low: row[3] as string,
      close: row[4] as string,
      volume: row[5] as string,
    };
  });
}

async function fetchBitstampOhlc({
  symbol,
  interval,
  start,
  end,
}: FetchKlinesParams): Promise<Kline[]> {
  const stepSeconds = Number(interval.replace("m", "")) * 60;
  const url = new URL(
    `https://www.bitstamp.net/api/v2/ohlc/${symbol.toLowerCase()}/`,
  );
  url.searchParams.set("step", stepSeconds.toString());
  url.searchParams.set("limit", "1000");
  url.searchParams.set("start", Math.floor(start / 1000).toString());
  url.searchParams.set("end", Math.floor(end / 1000).toString());

  const resp = await fetch(url.toString());
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(
      `Bitstamp ohlc error status=${resp.status} body=${text ?? ""}`,
    );
  }
  const data = (await resp.json()) as {
    data?: { ohlc?: Array<Record<string, string>> };
  };
  const rows = data?.data?.ohlc ?? [];
  return rows.map((r) => ({
    openTime: Number(r.timestamp) * 1000,
    open: r.open,
    high: r.high,
    low: r.low,
    close: r.close,
    volume: r.volume,
  }));
}

async function fetchKlines(params: FetchKlinesParams): Promise<Kline[]> {
  if (params.provider === "bitstamp") return fetchBitstampOhlc(params);
  return fetchBinanceKlines(params);
}

function toNumericString(value: string | number): string {
  if (typeof value === "number") return value.toString();
  return value;
}

export type BtcPriceIngestConfig = {
  symbol?: string;
  exchange?: string;
  start?: Date;
  end?: Date;
  intervalMs?: number;
  provider?: "binance" | "bitstamp";
};

function normalizeIntervalMs(intervalMs?: number): { intervalMs: number; binance: string } {
  // Default to 15m buckets for arb alignment
  const ms = intervalMs ?? 15 * 60 * 1000;
  const allowed: Record<number, string> = {
    60_000: "1m",
    [3 * 60_000]: "3m",
    [5 * 60_000]: "5m",
    [15 * 60_000]: "15m",
    [30 * 60_000]: "30m",
  };
  const binance = allowed[ms];
  if (!binance) {
    throw new Error(`Unsupported intervalMs=${ms}. Allowed: ${Object.keys(allowed).join(",")}`);
  }
  return { intervalMs: ms, binance };
}

export async function ingestBtcPrices({
  symbol = "BTCUSDT",
  exchange = "binance",
  start,
  end = new Date(),
  intervalMs,
  provider = "bitstamp",
}: BtcPriceIngestConfig = {}) {
  const interval = normalizeIntervalMs(intervalMs);
  // Determine start from DB if not provided
  let startMs = start?.getTime();
  if (!startMs) {
    const latest = await db
      .select({ timestamp: btcPrices.timestamp })
      .from(btcPrices)
      .where(and(eq(btcPrices.exchange, exchange), eq(btcPrices.symbol, symbol)))
      .orderBy(desc(btcPrices.timestamp))
      .limit(1);
    if (latest.length) {
      startMs = latest[0].timestamp.getTime() + intervalMs;
    }
  }
  if (!startMs) {
    // default lookback 12h if nothing in DB
    const now = Date.now();
    const alignedNow = now - (now % interval.intervalMs);
    startMs = alignedNow - 12 * 60 * 60 * 1000;
  }

  const endMs = end.getTime();
  if (startMs >= endMs) {
    return { inserted: 0, batches: 0 };
  }

  let cursor = startMs;
  let inserted = 0;
  let batches = 0;
  const limit = 1000;
  while (cursor < endMs) {
    const batchEnd = Math.min(endMs, cursor + interval.intervalMs * limit);
    const klines = await fetchKlines({
      symbol,
      interval: interval.binance,
      start: cursor,
      end: batchEnd,
      limit,
      provider,
    });
    batches += 1;

    if (!klines.length) {
      cursor = batchEnd;
      continue;
    }

    const inserts = klines.map((k) => ({
      timestamp: new Date(k.openTime),
      exchange,
      symbol,
      open: toNumericString(k.open),
      high: toNumericString(k.high),
      low: toNumericString(k.low),
      close: toNumericString(k.close),
      volume: toNumericString(k.volume),
    }));

    await db.insert(btcPrices).values(inserts).onConflictDoNothing();
    inserted += inserts.length;
    cursor = klines[klines.length - 1].openTime + interval.intervalMs;
  }

  return { inserted, batches };
}
