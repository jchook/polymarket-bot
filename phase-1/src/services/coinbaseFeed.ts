import { WebsocketClient } from "coinbase-api";
import dotenv from "dotenv";
import { db } from "../db";
import {
  type CoinbaseTickerMessage,
  processCoinbaseTicker,
} from "../pipeline/coinbaseTicker";
import type { IntentSink, PipelineContext } from "../pipeline/intentSink";
import { handleUnifiedEvent } from "../pipeline/unifiedEventConsumer";
import { logger } from "../lib/logger";

dotenv.config();

type HeartbeatMessage = {
  type: "heartbeat" | "heartbeats";
  product_id?: string;
  time?: string;
  last_trade_id?: number;
  sequence?: number;
};

export type CoinbaseFeedHandle = {
  stop: () => void;
};

export function startCoinbaseFeed(options: {
  productIds: string[];
  staleMs: number;
  sink?: IntentSink;
  ctx: PipelineContext;
}): CoinbaseFeedHandle {
  const { productIds, staleMs, sink, ctx } = options;
  const log = logger("coinbase");
  const debugTicks = process.env.COINBASE_LOG_TICKS === "true";
  const client = new WebsocketClient();

  client.on("open", (data) => {
    log("open %o", data?.wsKey);
  });
  client.on("reconnect", (data) => {
    log("reconnect %o", data);
  });
  client.on("reconnected", (data) => {
    log("reconnected %o", data);
  });
  client.on("close", (data) => {
    console.error("Coinbase WS closed", data);
  });
  client.on("exception", (data) => {
    console.error("Coinbase WS exception", data);
  });
  client.on("response", (data) => {
    log("response %o", data);
  });

  client.on("update", (data) => {
    // Expected shape: { channel: "ticker", events: [ { tickers: [ {...} ] } ], timestamp }
    const channel = (data as any).channel;
    if (channel !== "ticker" || !Array.isArray((data as any).events)) return;
    const baseTs = (data as any).timestamp;
    for (const evt of (data as any).events) {
      if (!evt || !Array.isArray(evt.tickers)) continue;
      for (const t of evt.tickers) {
        const msg: CoinbaseTickerMessage = {
          type: "ticker",
          product_id: t.product_id,
          price: t.price,
          best_bid: t.best_bid,
          best_ask: t.best_ask,
          time: baseTs,
        };
        if (debugTicks) {
          log("ticker %o", msg);
        }
        void processCoinbaseTicker(msg, {
          db,
          productIds,
          staleMs,
          onSpotPrice: async (
            productId,
            baseAsset,
            quoteAsset,
            mid,
            exchangeTs,
            ingestTs,
          ) => {
            await handleUnifiedEvent(
              {
                kind: "spot",
                productId,
                baseAsset,
                quoteAsset,
                mid,
                exchangeTs,
                ingestTs,
              },
              sink,
              ctx,
            );
          },
        }).catch((err) => console.error("Failed to persist Coinbase tick", err));
      }
    }
  });

  // Subscribe to ticker and heartbeats on the Advanced Trade market data feed.
  client.subscribe(
    {
      topic: "ticker",
      payload: { product_ids: productIds },
    },
    "advTradeMarketData",
  );
  client.subscribe(
    {
      topic: "heartbeats",
      payload: { product_ids: productIds },
    },
    "advTradeMarketData",
  );

  return {
    stop: () => {
      try {
        client.closeAll();
      } catch (err) {
        console.error("Failed to close Coinbase WS", err);
      }
    },
  };
}
