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

type HeartbeatMessage =
  | {
      type: "heartbeat" | "heartbeats";
      product_id?: string;
      time?: string;
      last_trade_id?: number;
      sequence?: number;
    }
  | {
      channel: "heartbeats";
      events: unknown[];
      timestamp?: string;
    };

export type CoinbaseFeedHandle = {
  stop: () => void;
};

export function startCoinbaseFeed(options: {
  productIds: string[];
  staleMs: number;
  wsUrl?: string;
  sink?: IntentSink;
  ctx: PipelineContext;
}): CoinbaseFeedHandle {
  const { productIds, staleMs, wsUrl, sink, ctx } = options;
  const log = logger("coinbase");
  const url = wsUrl || "wss://advanced-trade-ws.coinbase.com";
  const debugTicks = process.env.COINBASE_LOG_TICKS === "true";
  const debugAll = process.env.COINBASE_LOG_ALL === "true";
  const reconnectMs = Number(process.env.COINBASE_RECONNECT_MS ?? 1000);
  let logged = 0;
  let lastTick = Date.now();
  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const scheduleReconnect = () => {
    if (stopped) return;
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, reconnectMs);
  };

  const connect = () => {
    if (stopped) return;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      console.error("Failed to create Coinbase WS", err);
      scheduleReconnect();
      return;
    }

    ws.addEventListener("open", () => {
      const jwt = process.env.COINBASE_JWT;
      const tickerSubscribe = {
        type: "subscribe",
        channel: "ticker",
        product_ids: productIds,
        ...(jwt ? { jwt } : {}),
      };
      const heartbeatSubscribe = {
        type: "subscribe",
        channel: "heartbeats",
        product_ids: productIds,
        ...(jwt ? { jwt } : {}),
      };
      ws?.send(JSON.stringify(tickerSubscribe));
      ws?.send(JSON.stringify(heartbeatSubscribe));
      log("Connected to Coinbase WS %o", { url, products: productIds });
    });

    ws.addEventListener("message", (event) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(event.data as string);
      } catch (err) {
        console.error("Failed to parse Coinbase message", err);
        return;
      }

      if (typeof parsed !== "object" || parsed === null) return;
      const type = (parsed as { type?: unknown }).type;
      const channel = (parsed as { channel?: unknown }).channel;

      if (debugAll && logged < 5) {
        logged += 1;
        log("coinbase_message %o", parsed);
      }

      // Advanced Trade channel wrapper with events array
      if (channel === "ticker" && Array.isArray((parsed as any).events)) {
        const baseTs = (parsed as any).timestamp;
        const events = (parsed as any).events;
        for (const evt of events) {
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
            lastTick = Date.now();
            if (debugTicks && logged < 5) {
              logged += 1;
              log("coinbase_ticker_wrapped %o", msg);
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
            }).catch((err) =>
              console.error("Failed to persist Coinbase tick", err),
            );
          }
        }
        return;
      }

      if (type !== "ticker" && type !== "heartbeat" && type !== "heartbeats") {
        return;
      }

      if (type === "heartbeat" || type === "heartbeats") return;

      const msg = parsed as CoinbaseTickerMessage | HeartbeatMessage;
      if ((msg as HeartbeatMessage).type === "heartbeat") return;

      lastTick = Date.now();

      if (debugTicks && logged < 5 && type === "ticker") {
        logged += 1;
        log("coinbase_ticker %o", parsed);
      }

      void processCoinbaseTicker(msg as CoinbaseTickerMessage, {
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
    });

    ws.addEventListener("close", (evt) => {
      console.error("Coinbase WS closed", evt.code, evt.reason);
      scheduleReconnect();
    });

    ws.addEventListener("error", (err) => {
      console.error("Coinbase WS error", err);
      scheduleReconnect();
    });
  };

  connect();

  const warnInterval = setInterval(() => {
    const now = Date.now();
    if (now - lastTick > staleMs * 3) {
      console.warn("No Coinbase ticker seen recently", {
        secondsSinceLast: Math.round((now - lastTick) / 1000),
        products: productIds,
      });
    }
  }, staleMs);

  return {
    stop: () => {
      try {
        stopped = true;
        if (ws) ws.close();
      } catch (err) {
        console.error("Failed to close Coinbase WS", err);
      }
      if (reconnectTimer) clearTimeout(reconnectTimer);
      clearInterval(warnInterval);
    },
  };
}
