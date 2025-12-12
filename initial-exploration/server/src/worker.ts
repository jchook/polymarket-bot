import {
  marketIngestionWorker,
  orderbookIngestionWorker,
  btcPriceIngestionWorker,
  tradeIngestionWorker,
} from "./queue/workers";

console.log("Starting ingestion workers...");

const shutdown = async () => {
  console.log("Shutting down workers...");
  await marketIngestionWorker.close();
  await orderbookIngestionWorker.close();
  await btcPriceIngestionWorker.close();
  await tradeIngestionWorker.close();
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
