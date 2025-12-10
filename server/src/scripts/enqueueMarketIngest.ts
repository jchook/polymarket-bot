import { marketIngestionQueue } from "../queue/queues";

async function main() {
  const tag = process.env.MARKET_TAG;
  const pageSize = process.env.MARKET_PAGE_SIZE
    ? Number(process.env.MARKET_PAGE_SIZE)
    : undefined;
  const maxPages = process.env.MARKET_MAX_PAGES
    ? Number(process.env.MARKET_MAX_PAGES)
    : undefined;
  const closed =
    process.env.MARKET_CLOSED === "true"
      ? true
      : process.env.MARKET_CLOSED === "false"
        ? false
        : undefined;
  const conditionIds = process.env.MARKET_CONDITION_IDS
    ? process.env.MARKET_CONDITION_IDS.split(",").map((s) => s.trim())
    : undefined;
  const exchange = process.env.MARKET_EXCHANGE;

  await marketIngestionQueue.add("ingest-markets", {
    tag,
    pageSize,
    maxPages,
    closed,
    conditionIds,
    exchange,
  });

  console.log(
    "Enqueued market ingestion job",
    JSON.stringify(
      {
        tag,
        pageSize,
        maxPages,
        closed,
        conditionIds,
        exchange,
      },
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
