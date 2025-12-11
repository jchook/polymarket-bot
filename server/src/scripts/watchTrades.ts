// watchTrades.ts
import { RealTimeDataClient } from "@polymarket/real-time-data-client";

const TARGET = process.env.TARGET_PROXY?.toLowerCase(); // set to the wallet you want to copy

new RealTimeDataClient({
  onConnect: (client) => {
    client.subscribe({
      subscriptions: [
        {
          topic: "activity",
          type: "orders_matched", // fills only
          // optional: filters: '{"market_slug":"some-market"}',
        },
      ],
    });
  },
  onMessage: (client, msg) => {
    if (msg.topic !== "activity" || msg.type !== "orders_matched") return;
    const t = msg.payload;
    if (TARGET && t.proxyWallet?.toLowerCase() !== TARGET) return; // drop others
    // One-line summary
    console.log(
      [
        new Date(t.timestamp * 1000).toISOString(),
        t.proxyWallet,
        t.side,
        `size=${t.size}`,
        `px=${t.price}`,
        t.slug || t.conditionId,
        t.transactionHash?.slice(0, 10),
      ].join(" | ")
    );
  },
  //onError: (err) => console.error("RT client error:", err),
}).connect();
