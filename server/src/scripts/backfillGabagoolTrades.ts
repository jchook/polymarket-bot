import dotenv from "dotenv";
import { getGammaEventBySlug } from "../clients/polymarketData";
import { marketIngestionQueue, tradeIngestionQueue } from "../queue/queues";

dotenv.config();

const assets = ["btc", "eth"] as const;
const assetLongName: Record<(typeof assets)[number], string> = {
  btc: "bitcoin",
  eth: "ethereum",
};

const etSlugFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "long",
  day: "numeric",
  hour: "numeric",
  hour12: true,
});

type IntervalDef = { label: "15m" | "1h"; seconds: number };
const intervals: IntervalDef[] = [
  { label: "15m", seconds: 15 * 60 },
  { label: "1h", seconds: 60 * 60 },
];

function ceilToInterval(epochSeconds: number, intervalSeconds: number): number {
  return Math.ceil(epochSeconds / intervalSeconds) * intervalSeconds;
}

function build15mSlug(asset: string, endEpoch: number) {
  return `${asset}-updown-15m-${endEpoch}`;
}

function buildHourSlug(
  asset: (typeof assets)[number],
  endEtEpoch: number,
): string {
  const date = new Date(endEtEpoch * 1000);
  const parts = etSlugFormatter.formatToParts(date);
  const month = parts.find((p) => p.type === "month")?.value?.toLowerCase();
  const day = parts.find((p) => p.type === "day")?.value;
  const hour = parts.find((p) => p.type === "hour")?.value;
  const dayPeriod = parts.find((p) => p.type === "dayPeriod")?.value;
  if (!month || !day || !hour || !dayPeriod) {
    throw new Error("Failed to build 1h slug: missing date parts");
  }
  return `${assetLongName[asset]}-up-or-down-${month}-${Number(day)}-${hour.toLowerCase()}${dayPeriod.toLowerCase()}-et`;
}

function iterateDays(start: Date, end: Date): Date[] {
  const days: Date[] = [];
  const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  while (d <= end) {
    days.push(new Date(d));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return days;
}

function toEtEpochSeconds(date: Date): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const lookup = Object.fromEntries(
    parts.map((p) => [p.type, Number(p.value)]),
  ) as Record<string, number>;
  const naiveUtc = Date.UTC(
    lookup.year,
    lookup.month - 1,
    lookup.day,
    lookup.hour,
    lookup.minute,
    lookup.second,
  );
  const etOffsetMinutes = (() => {
    const probeParts = fmt.formatToParts(date);
    const probeLookup = Object.fromEntries(
      probeParts.map((p) => [p.type, Number(p.value)]),
    ) as Record<string, number>;
    const asUtc = Date.UTC(
      probeLookup.year,
      probeLookup.month - 1,
      probeLookup.day,
      probeLookup.hour,
      probeLookup.minute,
      probeLookup.second,
    );
    return (asUtc - date.getTime()) / 60000;
  })();
  return (naiveUtc - etOffsetMinutes * 60_000) / 1000;
}

function buildSlugsForRange(start: Date, end: Date): string[] {
  const slugs = new Set<string>();
  for (const day of iterateDays(start, end)) {
    // step through the day in 15m increments in ET
    for (let hour = 0; hour < 24; hour++) {
      for (let minute of [0, 15, 30, 45]) {
        const etDate = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hour, minute));
        const etEpoch = toEtEpochSeconds(etDate);
        for (const asset of assets) {
          // 15m current/next
          const currentEnd15 = ceilToInterval(etEpoch, 15 * 60);
          const nextEnd15 = currentEnd15 + 15 * 60;
          slugs.add(build15mSlug(asset, currentEnd15));
          slugs.add(build15mSlug(asset, nextEnd15));
          // 1h current/next
          const currentEnd1h = ceilToInterval(etEpoch, 60 * 60);
          const nextEnd1h = currentEnd1h + 60 * 60;
          slugs.add(buildHourSlug(asset, currentEnd1h));
          slugs.add(buildHourSlug(asset, nextEnd1h));
        }
      }
    }
  }
  return Array.from(slugs);
}

async function slugsToConditionIds(slugs: string[]): Promise<string[]> {
  const ids = new Set<string>();
  const chunkSize = Number(process.env.GABA_SLUG_BATCH ?? 10);
  for (let i = 0; i < slugs.length; i += chunkSize) {
    const chunk = slugs.slice(i, i + chunkSize);
    console.log(
      `Resolving slugs ${i + 1}-${Math.min(i + chunk.length, slugs.length)} of ${slugs.length}`,
    );
    const results = await Promise.all(
      chunk.map(async (slug) => {
        try {
          const event = await getGammaEventBySlug(slug);
          const markets = (event as Record<string, unknown>).markets;
          if (!Array.isArray(markets)) return [];
          return markets
            .map((m) => {
              if (typeof m !== "object" || m === null) return undefined;
              return (
                (m as Record<string, string | undefined>).conditionId ??
                (m as Record<string, string | undefined>).condition_id
              );
            })
            .filter((cid): cid is string => Boolean(cid));
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "unknown error fetching event";
          console.warn(`Failed to fetch event for slug=${slug}: ${message}`);
          return [];
        }
      }),
    );
    results.flat().forEach((cid) => ids.add(cid));
  }
  return Array.from(ids);
}

async function main() {
  const wallet = process.env.GABA_WALLET?.toLowerCase();
  if (!wallet) {
    throw new Error("GABA_WALLET env required");
  }
  const startIso = process.env.GABA_START_ISO;
  const endIso = process.env.GABA_END_ISO;
  if (!startIso || !endIso) {
    throw new Error("GABA_START_ISO and GABA_END_ISO envs required");
  }
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error("Invalid start/end ISO timestamps");
  }

  console.log(
    `Building slugs for range start=${start.toISOString()} end=${end.toISOString()}`,
  );
  const slugs = buildSlugsForRange(start, end);
  console.log(`Built ${slugs.length} slugs (deduped)`);

  const batchSize = Number(process.env.GABA_BATCH_SIZE ?? 50);
  const delayMs = Number(process.env.GABA_DELAY_MS ?? 200);
  const slugBatchSize = Number(process.env.GABA_SLUG_BATCH ?? 10);

  for (let i = 0; i < slugs.length; i += slugBatchSize) {
    const slugChunk = slugs.slice(i, i + slugBatchSize);
    console.log(
      `Resolving slug chunk ${i / slugBatchSize + 1} size=${slugChunk.length}`,
    );
    const conditionIds = await slugsToConditionIds(slugChunk);
    console.log(
      `Chunk resolved ${conditionIds.length} conditionIds (slug chunk ${i / slugBatchSize + 1})`,
    );
    if (!conditionIds.length) continue;

    await marketIngestionQueue.add("ingest-markets", { conditionIds });

    for (let j = 0; j < conditionIds.length; j += batchSize) {
      const batch = conditionIds.slice(j, j + batchSize);
      await tradeIngestionQueue.add(
        `ingest-trades-${i / slugBatchSize + 1}-${j / batchSize + 1}`,
        {
          conditionIds: batch,
          wallet,
          delayMs,
        },
        { delay: j === 0 ? 0 : delayMs },
      );
      console.log(
        `Enqueued trade batch slugChunk=${i / slugBatchSize + 1} batch=${j / batchSize + 1} size=${batch.length} delayMs=${delayMs}`,
      );
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
