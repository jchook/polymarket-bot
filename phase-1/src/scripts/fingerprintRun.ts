import { createHash } from "node:crypto";
import dotenv from "dotenv";
import { db, dislocationSignals } from "../db";
import { eq } from "drizzle-orm";

dotenv.config();

async function main() {
  const runId = process.env.RUN_ID;
  if (!runId) {
    throw new Error("RUN_ID env required");
  }

  const rows = await db
    .select({
      exchangeTs: dislocationSignals.exchangeTs,
      conditionId: dislocationSignals.conditionId,
      assetId: dislocationSignals.assetId,
      state: dislocationSignals.state,
      deltaSpd: dislocationSignals.deltaSpd,
      dtMs: dislocationSignals.dtMs,
      orderingCollision: dislocationSignals.orderingCollision,
    })
    .from(dislocationSignals)
    .where(eq(dislocationSignals.runId, runId))
    .orderBy(dislocationSignals.exchangeTs, dislocationSignals.conditionId, dislocationSignals.assetId);

  const hash = createHash("md5");
  const serialized = rows
    .map((r) =>
      [
        r.exchangeTs?.getTime(),
        r.conditionId ?? "",
        r.assetId ?? "",
        r.state ?? "",
        r.deltaSpd ? Number(r.deltaSpd).toFixed(10) : "",
        r.dtMs ?? "",
        r.orderingCollision ? "1" : "0",
      ].join("|"),
    )
    .join(",");
  hash.update(serialized);
  console.log(
    JSON.stringify({
      runId,
      count: rows.length,
      collisions: rows.filter((r) => r.orderingCollision).length,
      hash: hash.digest("hex"),
    }),
  );
}

void main();
