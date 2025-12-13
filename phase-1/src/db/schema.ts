import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
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

export const marketMetadata = pgTable(
  "market_metadata",
  {
    id: serial("id").primaryKey(),
    conditionId: text("condition_id").notNull(),
    assetIdUp: text("asset_id_up").notNull(),
    assetIdDown: text("asset_id_down").notNull(),
    tickSize: numeric("tick_size"),
    minOrderSize: numeric("min_order_size"),
    negRisk: boolean("neg_risk").default(false).notNull(),
    tags: jsonb("tags"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    uniqueIndex("uniq_market_metadata_condition").on(table.conditionId),
    index("idx_market_metadata_assets").on(table.assetIdUp, table.assetIdDown),
  ],
);

export const pmPriceChanges = pgTable(
  "pm_price_changes",
  {
    id: serial("id").primaryKey(),
    conditionId: text("condition_id").notNull(),
    assetId: text("asset_id").notNull(),
    hash: text("hash"),
    side: tradeSideEnum("side"),
    price: numeric("price"),
    size: numeric("size"),
    bestBid: numeric("best_bid"),
    bestAsk: numeric("best_ask"),
    midPrice: numeric("mid_price"),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
    raw: jsonb("raw"),
  },
  (table) => [
    index("idx_pm_price_changes_asset_ts").on(table.assetId, table.timestamp),
    index("idx_pm_price_changes_condition_ts").on(
      table.conditionId,
      table.timestamp,
    ),
    uniqueIndex("uniq_pm_price_changes_hash").on(table.hash),
  ],
);

export const spotPrices = pgTable(
  "spot_prices",
  {
    id: serial("id").primaryKey(),
    exchange: text("exchange").notNull(),
    productId: text("product_id").notNull(),
    baseAsset: text("base_asset"),
    quoteAsset: text("quote_asset"),
    bestBid: numeric("best_bid"),
    bestAsk: numeric("best_ask"),
    midPrice: numeric("mid_price"),
    tradePrice: numeric("trade_price"),
    tradeSize: numeric("trade_size"),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
    raw: jsonb("raw"),
  },
  (table) => [
    index("idx_spot_prices_ts").on(table.timestamp),
    index("idx_spot_prices_product_ts").on(table.productId, table.timestamp),
    index("idx_spot_prices_pair_ts").on(
      table.baseAsset,
      table.quoteAsset,
      table.timestamp,
    ),
  ],
);

export const derivedFeatures = pgTable(
  "derived_features",
  {
    id: serial("id").primaryKey(),
    conditionId: text("condition_id").notNull(),
    assetId: text("asset_id").notNull(),
    pmTimestamp: timestamp("pm_timestamp", { withTimezone: true }).notNull(),
    spotTimestamp: timestamp("spot_timestamp", {
      withTimezone: true,
    }).notNull(),
    dtMs: integer("dt_ms").notNull(),
    pmMid: numeric("pm_mid"),
    pmSpread: numeric("pm_spread"),
    spotMid: numeric("spot_mid"),
    x1: numeric("x1"),
    x2: numeric("x2"),
    x3: numeric("x3"),
    features: jsonb("features"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("idx_derived_features_asset_ts").on(table.assetId, table.pmTimestamp),
    index("idx_derived_features_condition_ts").on(
      table.conditionId,
      table.pmTimestamp,
    ),
  ],
);

export const strategyParams = pgTable(
  "strategy_params",
  {
    id: serial("id").primaryKey(),
    strategy: text("strategy").notNull(),
    version: text("version").notNull(),
    params: jsonb("params").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("idx_strategy_params_strategy_version").on(
      table.strategy,
      table.version,
    ),
  ],
);

export const simulatedTrades = pgTable(
  "simulated_trades",
  {
    id: serial("id").primaryKey(),
    runId: text("run_id").notNull(),
    conditionId: text("condition_id").notNull(),
    assetId: text("asset_id").notNull(),
    side: tradeSideEnum("side"),
    price: numeric("price"),
    size: numeric("size"),
    fees: numeric("fees"),
    slippage: numeric("slippage"),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
    metadata: jsonb("metadata"),
  },
  (table) => [
    index("idx_simulated_trades_run_ts").on(table.runId, table.timestamp),
    index("idx_simulated_trades_condition_ts").on(
      table.conditionId,
      table.timestamp,
    ),
  ],
);

export const dislocationSignals = pgTable(
  "dislocation_signals",
  {
    id: serial("id").primaryKey(),
    runId: text("run_id").notNull(),
    conditionId: text("condition_id").notNull(),
    assetId: text("asset_id").notNull(),
    exchangeTs: timestamp("exchange_ts", { withTimezone: true }).notNull(),
    ingestTs: timestamp("ingest_ts", { withTimezone: true }).notNull(),
    dtMs: integer("dt_ms"),
    pmMid: numeric("pm_mid"),
    expectedProb: numeric("expected_prob"),
    deltaSpd: numeric("delta_spd"),
    state: text("state"),
    featuresVersion: text("features_version"),
    betaVersion: text("beta_version"),
    orderingCollision: boolean("ordering_collision").default(false).notNull(),
    raw: jsonb("raw"),
  },
  (table) => [
    index("idx_dislocation_signals_run_ts").on(table.runId, table.exchangeTs),
    index("idx_dislocation_signals_condition_asset_ts").on(
      table.conditionId,
      table.assetId,
      table.exchangeTs,
    ),
  ],
);
