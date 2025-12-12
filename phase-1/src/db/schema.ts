import {
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const tradeSideEnum = pgEnum("trade_side", ["BUY", "SELL"]);
export const tradeRoleEnum = pgEnum("trade_role", ["TAKER", "MAKER", "MIXED"]);

export const realtimeTrades = pgTable(
  "realtime_trades",
  {
    id: serial("id").primaryKey(),
    conditionId: text("condition_id"),
    outcomeIndex: integer("outcome_index"),
    proxyWallet: text("proxy_wallet"),
    side: tradeSideEnum("side"),
    price: numeric("price"),
    size: numeric("size"),
    timestamp: timestamp("timestamp", { withTimezone: true }),
    transactionHash: text("transaction_hash"),
    raw: jsonb("raw"),
  },
  (table) => [
    index("idx_realtime_trades_condition_ts").on(
      table.conditionId,
      table.timestamp,
    ),
  ],
);

