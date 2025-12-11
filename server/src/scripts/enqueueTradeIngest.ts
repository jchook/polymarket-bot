import dotenv from "dotenv";
import { tradeIngestionQueue } from "../queue/queues";

dotenv.config();

async function main() {
  const conditionIds = process.env.TRADE_CONDITION_IDS
    ? process.env.TRADE_CONDITION_IDS.split(",").map((s) => s.trim())
    : undefined;
  const wallet = process.env.TRADE_WALLET
    ? process.env.TRADE_WALLET.toLowerCase()
    : undefined;
  const exchange = process.env.TRADE_EXCHANGE;
  const startAfter = process.env.TRADE_START_AFTER;
  const delayMs = process.env.TRADE_DELAY_MS
    ? Number(process.env.TRADE_DELAY_MS)
    : undefined;

  await tradeIngestionQueue.add("ingest-trades", {
    conditionIds,
    wallet,
    exchange,
    startAfter,
    delayMs,
  });

  console.log(
    "Enqueued trade ingestion job",
    JSON.stringify(
      { conditionIds, wallet, exchange, startAfter, delayMs },
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
