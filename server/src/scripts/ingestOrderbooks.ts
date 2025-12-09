import { ingestOrderbooks } from "../ingestors/orderbookIngestor";

async function main() {
  const conditionIds = process.env.BOOK_CONDITION_IDS
    ? process.env.BOOK_CONDITION_IDS.split(",").map((s) => s.trim())
    : undefined;
  const exchange = process.env.BOOK_EXCHANGE ?? "polymarket";
  const concurrency = process.env.BOOK_CONCURRENCY
    ? Number(process.env.BOOK_CONCURRENCY)
    : undefined;

  await ingestOrderbooks({
    conditionIds,
    exchange,
    concurrency,
  });
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
