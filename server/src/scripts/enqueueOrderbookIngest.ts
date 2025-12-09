import { orderbookIngestionQueue } from "../queue/queues";

async function main() {
  const conditionIds = process.env.BOOK_CONDITION_IDS
    ? process.env.BOOK_CONDITION_IDS.split(",").map((s) => s.trim())
    : undefined;
  const exchange = process.env.BOOK_EXCHANGE;
  const concurrency = process.env.BOOK_CONCURRENCY
    ? Number(process.env.BOOK_CONCURRENCY)
    : undefined;
  const repeatCron = process.env.BOOK_REPEAT_CRON;

  await orderbookIngestionQueue.add(
    "ingest-orderbooks",
    {
      conditionIds,
      exchange,
      concurrency,
    },
    repeatCron
      ? {
          repeat: { pattern: repeatCron },
        }
      : undefined,
  );

  console.log(
    "Enqueued orderbook ingestion job",
    JSON.stringify(
      { conditionIds, exchange, concurrency, repeatCron },
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
