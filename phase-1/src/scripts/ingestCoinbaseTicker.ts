import dotenv from "dotenv";
import { db } from "../db";
import {
  type CoinbaseTickerMessage,
  processCoinbaseTicker,
} from "../pipeline/coinbaseTicker";
import { handleUnifiedEvent } from "../pipeline/unifiedEventConsumer";

dotenv.config();

type HeartbeatMessage = {
  type: "heartbeat";
  product_id: string;
  time: string;
  last_trade_id?: number;
  sequence?: number;
};

const PRODUCT_IDS = (process.env.COINBASE_PRODUCTS || "BTC-USD")
  .split(",")
  .map((p) => p.trim())
  .filter(Boolean);

const WS_URL =
  process.env.COINBASE_WS_URL || "wss://advanced-trade-ws.coinbase.com";

const STALE_MS = Number(process.env.COINBASE_STALE_MS ?? 3_000);

const ws = new WebSocket(WS_URL);

ws.addEventListener("open", () => {
  const subscribe = {
    type: "subscribe",
    product_ids: PRODUCT_IDS,
    channel: "ticker",
  };
  const heartbeats = {
    type: "subscribe",
    product_ids: PRODUCT_IDS,
    channel: "heartbeats",
  };
  ws.send(JSON.stringify(subscribe));
  ws.send(JSON.stringify(heartbeats));
  console.log("Connected to Coinbase WS", {
    url: WS_URL,
    products: PRODUCT_IDS,
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

  const msg = parsed as CoinbaseTickerMessage;

  void processCoinbaseTicker(msg, {
    db,
    productIds: PRODUCT_IDS,
    staleMs: STALE_MS,
    onSpotPrice: async (
      productId,
      baseAsset,
      quoteAsset,
      mid,
      exchangeTs,
      ingestTs,
    ) => {
      await handleUnifiedEvent({
        kind: "spot",
        productId,
        baseAsset,
        quoteAsset,
        mid,
        exchangeTs,
        ingestTs,
      });
    },
  }).catch((err) => console.error("Failed to persist Coinbase tick", err));
});

ws.addEventListener("close", (evt) => {
  console.error("Coinbase WS closed", evt.code, evt.reason);
});

ws.addEventListener("error", (err) => {
  console.error("Coinbase WS error", err);
});
