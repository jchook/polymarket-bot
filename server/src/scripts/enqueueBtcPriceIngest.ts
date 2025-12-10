import dotenv from "dotenv";
import { btcPriceIngestionQueue } from "../queue/queues";

dotenv.config();

async function main() {
  const symbol = process.env.PRICE_SYMBOL ?? "BTCUSDT";
  const exchange = process.env.PRICE_EXCHANGE ?? "binance";
  const start = process.env.PRICE_START_ISO;
  const end = process.env.PRICE_END_ISO;
  const intervalMs = process.env.PRICE_INTERVAL_MS
    ? Number(process.env.PRICE_INTERVAL_MS)
    : 15 * 60 * 1000;
  const provider =
    process.env.PRICE_PROVIDER === "binance" ? "binance" : "bitstamp";

  await btcPriceIngestionQueue.add("ingest-btc-prices", {
    symbol,
    exchange,
    start,
    end,
    intervalMs,
    provider,
  });

  console.log(
    "Enqueued BTC price ingestion job",
    JSON.stringify(
      { symbol, exchange, start, end, intervalMs, provider },
      null,
      2,
    ),
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
