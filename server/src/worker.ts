import { marketIngestionWorker } from "./queue/workers";

console.log("Starting market ingestion worker...");

const shutdown = async () => {
  console.log("Shutting down worker...");
  await marketIngestionWorker.close();
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
