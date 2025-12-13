import dotenv from "dotenv";
import { db } from "../db";
import {
  type CoinbaseTickerMessage,
  processCoinbaseTicker,
} from "../pipeline/coinbaseTicker";
import type { IntentSink, PipelineContext } from "../pipeline/intentSink";
import { handleUnifiedEvent } from "../pipeline/unifiedEventConsumer";

dotenv.config();

type HeartbeatMessage = {
  type: "heartbeat";
  product_id: string;
  time: string;
  last_trade_id?: number;
  sequence?: number;
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
  const url = wsUrl || "wss://advanced-trade-ws.coinbase.com";
  const ws = new WebSocket(url);

  ws.addEventListener("open", () => {
    const subscribe = {
      type: "subscribe",
      product_ids: productIds,
      channel: "ticker",
    };
    const heartbeats = {
      type: "subscribe",
      product_ids: productIds,
      channel: "heartbeats",
    };
    ws.send(JSON.stringify(subscribe));
    ws.send(JSON.stringify(heartbeats));
    console.log("Connected to Coinbase WS", {
      url,
      products: productIds,
    });
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
    if (type !== "ticker" && type !== "heartbeat") return;

    if (type === "heartbeat") return;

    const msg = parsed as CoinbaseTickerMessage | HeartbeatMessage;
    if ((msg as HeartbeatMessage).type === "heartbeat") return;

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
  });

  ws.addEventListener("error", (err) => {
    console.error("Coinbase WS error", err);
  });

  return {
    stop: () => {
      try {
        ws.close();
      } catch (err) {
        console.error("Failed to close Coinbase WS", err);
      }
    },
  };
}
