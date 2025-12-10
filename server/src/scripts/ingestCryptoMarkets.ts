import dotenv from "dotenv";
import { marketIngestionQueue } from "../queue/queues";

dotenv.config();

const assets = ["btc", "eth"] as const;
const assetLongName: Record<(typeof assets)[number], string> = {
  btc: "bitcoin",
  eth: "ethereum",
};

const durations = [
  { label: "15m", seconds: 15 * 60 },
  { label: "1h", seconds: 60 * 60 },
] as const;

const etDatePartsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

const etSlugFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "long",
  day: "numeric",
  hour: "numeric",
  hour12: true,
});

const offsetProbeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

type EtParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function getEtParts(date: Date): EtParts {
  const parts = etDatePartsFormatter.formatToParts(date);
  const lookup = Object.fromEntries(
    parts.map((p) => [p.type, Number(p.value)]),
  ) as Record<string, number>;
  return {
    year: lookup.year,
    month: lookup.month,
    day: lookup.day,
    hour: lookup.hour,
    minute: lookup.minute,
    second: lookup.second,
  };
}

function getEtOffsetMinutes(dateUtc: Date): number {
  // Compare the UTC date with how it would look in ET to derive offset.
  const parts = offsetProbeFormatter.formatToParts(dateUtc);
  const lookup = Object.fromEntries(parts.map((p) => [p.type, Number(p.value)]));
  const asUtc = Date.UTC(
    lookup.year,
    lookup.month - 1,
    lookup.day,
    lookup.hour,
    lookup.minute,
    lookup.second,
  );
  return (asUtc - dateUtc.getTime()) / 60000;
}

function etWallTimeToEpochSeconds(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): number {
  // Construct naive UTC time for the ET wall time, then subtract the ET offset.
  const naiveUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const offsetMinutes = getEtOffsetMinutes(new Date(naiveUtc));
  return (naiveUtc - offsetMinutes * 60_000) / 1000;
}

function ceilToInterval(epochSeconds: number, intervalSeconds: number): number {
  return Math.ceil(epochSeconds / intervalSeconds) * intervalSeconds;
}

function buildHourSlug(asset: (typeof assets)[number], endEtEpoch: number) {
  const date = new Date(endEtEpoch * 1000);
  const parts = etSlugFormatter.formatToParts(date);
  const month = parts.find((p) => p.type === "month")?.value?.toLowerCase();
  const day = parts.find((p) => p.type === "day")?.value;
  const hour = parts.find((p) => p.type === "hour")?.value;
  const dayPeriod = parts.find((p) => p.type === "dayPeriod")?.value;

  if (!month || !day || !hour || !dayPeriod) {
    throw new Error("Failed to build 1h slug: missing date parts");
  }

  // Format: bitcoin-up-or-down-december-10-4pm-et
  return `${assetLongName[asset]}-up-or-down-${month}-${Number(day)}-${hour.toLowerCase()}${dayPeriod.toLowerCase()}-et`;
}

function buildTargetSlugs(now: Date = new Date()): string[] {
  const et = getEtParts(now);
  const etEpochSeconds = etWallTimeToEpochSeconds(
    et.year,
    et.month,
    et.day,
    et.hour,
    et.minute,
    et.second,
  );

  const slugs: string[] = [];

  for (const asset of assets) {
    for (const duration of durations) {
      const currentEnd = ceilToInterval(etEpochSeconds, duration.seconds);
      const nextEnd = currentEnd + duration.seconds;

      if (duration.label === "1h") {
        slugs.push(buildHourSlug(asset, currentEnd));
        slugs.push(buildHourSlug(asset, nextEnd));
      } else {
        slugs.push(
          `${asset}-updown-${duration.label}-${currentEnd}`,
          `${asset}-updown-${duration.label}-${nextEnd}`,
        );
      }
    }
  }

  return Array.from(new Set(slugs));
}

async function main() {
  const slugs = buildTargetSlugs();
  console.log("Target slugs", slugs);

  const exchange = process.env.CRYPTO_EXCHANGE;

  await marketIngestionQueue.add("ingest-markets", {
    slugs,
    exchange,
  });

  console.log(
    "Enqueued targeted crypto market ingestion (slugs only)",
    JSON.stringify({ slugs, exchange }, null, 2),
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
