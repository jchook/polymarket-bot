import { RealTimeDataClient } from "@polymarket/real-time-data-client";

const TARGET = process.env.TARGET_PROXY?.toLowerCase(); // wallet to watch; leave unset to see all

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
  onMessage: (_client, msg) => {
    if (msg.topic !== "activity" || msg.type !== "orders_matched") return;
    const t = msg.payload;
    if (TARGET && t.proxyWallet?.toLowerCase() !== TARGET) return;

    // compute lag if timestamp/match_time present
    const eventSeconds = t.match_time ?? t.timestamp ?? t.last_update;
    const lagMs =
      eventSeconds !== undefined
        ? Date.now() - Number(eventSeconds) * 1000
        : undefined;

    console.log(
      [
        new Date(Date.now()).toISOString(),
        t.proxyWallet,
        t.side,
        `size=${t.size}`,
        `px=${t.price}`,
        t.slug || t.conditionId,
        t.transactionHash?.slice(0, 10),
        lagMs !== undefined ? `lag=${lagMs}ms` : "lag=n/a",
      ].join(" | ")
    );
  },
  onStatusChange: (status) => console.log("Connection status:" + status),
}).connect();
