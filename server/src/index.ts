import { app } from "./app";
import {
  marketIngestionWorker,
  orderbookIngestionWorker,
} from "./queue/workers";

const start = async () => {
  try {
    await app.ready();
    await app.listen({ host: "0.0.0.0", port: 3000 });
    app.log.info("App server listening on :3000");
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "Shutting down app and worker...");
  try {
    await app.close();
  } catch (err) {
    app.log.error({ err }, "Error closing app");
  }
  try {
    await marketIngestionWorker.close();
  } catch (err) {
    app.log.error({ err }, "Error closing worker");
  }
  try {
    await orderbookIngestionWorker.close();
  } catch (err) {
    app.log.error({ err }, "Error closing orderbook worker");
  }
  process.exit(0);
};

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

start();
