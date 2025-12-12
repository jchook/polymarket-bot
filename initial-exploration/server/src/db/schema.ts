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
  uuid,
} from "drizzle-orm/pg-core";

export const tradeSideEnum = pgEnum("trade_side", ["BUY", "SELL"]);
export const tradeRoleEnum = pgEnum("trade_role", ["TAKER", "MAKER", "MIXED"]);

export const markets = pgTable("markets", {
  conditionId: text("condition_id").primaryKey(),
  exchange: text("exchange").notNull().default("polymarket"),
  eventId: text("event_id"),
  eventSlug: text("event_slug"),
  marketSlug: text("market_slug"),
  title: text("title").notNull(),
  category: text("category"),
  underlyingSymbol: text("underlying_symbol"),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  windowEnd: timestamp("window_end", { withTimezone: true }).notNull(),
  resolutionTime: timestamp("resolution_time", { withTimezone: true }),
  resolved: boolean("resolved").default(false).notNull(),
  winningOutcomeIndex: integer("winning_outcome_index"),
  negRisk: boolean("neg_risk").default(false).notNull(),
  tags: jsonb("tags"),
  volume24h: numeric("volume_24h"),
  volumeAllTime: numeric("volume_all_time"),
  openInterest: numeric("open_interest"),
  liquidity: numeric("liquidity"),
  rawMetadata: jsonb("raw_metadata"),
});

export const marketOutcomes = pgTable(
  "market_outcomes",
  {
    id: serial("id").primaryKey(),
    conditionId: text("condition_id")
      .references(() => markets.conditionId, { onDelete: "cascade" })
      .notNull(),
    outcomeIndex: integer("outcome_index").notNull(),
    outcomeName: text("outcome_name").notNull(),
    tokenId: text("token_id").notNull(),
  },
  (table) => [
    uniqueIndex("uq_market_outcomes_condition_outcome").on(
      table.conditionId,
      table.outcomeIndex,
    ),
  ],
);

export const orderbookSnapshots = pgTable(
  "orderbook_snapshots",
  {
    id: serial("id").primaryKey(),
    conditionId: text("condition_id")
      .references(() => markets.conditionId, { onDelete: "cascade" })
      .notNull(),
    outcomeIndex: integer("outcome_index").notNull(),
    exchange: text("exchange").notNull().default("polymarket"),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
    bestBidPrice: numeric("best_bid_price"),
    bestBidSize: numeric("best_bid_size"),
    bestAskPrice: numeric("best_ask_price"),
    bestAskSize: numeric("best_ask_size"),
    midPrice: numeric("mid_price"),
    spread: numeric("spread"),
    rawOrderbook: jsonb("raw_orderbook"),
  },
  (table) => [
    uniqueIndex("uq_orderbook_snapshots_condition_outcome_ts").on(
      table.conditionId,
      table.outcomeIndex,
      table.timestamp,
    ),
    index("idx_orderbook_snapshots_ts").on(table.timestamp),
    index("idx_orderbook_snapshots_condition_ts").on(
      table.conditionId,
      table.timestamp,
    ),
  ],
);

export const priceHistory = pgTable(
  "price_history",
  {
    id: serial("id").primaryKey(),
    conditionId: text("condition_id")
      .references(() => markets.conditionId, { onDelete: "cascade" })
      .notNull(),
    outcomeIndex: integer("outcome_index").notNull(),
    exchange: text("exchange").notNull().default("polymarket"),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
    price: numeric("price").notNull(),
    side: tradeSideEnum("side"),
  },
  (table) => [
    uniqueIndex("uq_price_history_condition_outcome_side_ts").on(
      table.conditionId,
      table.outcomeIndex,
      table.timestamp,
      table.side,
    ),
    index("idx_price_history_condition_ts").on(
      table.conditionId,
      table.timestamp,
    ),
  ],
);

export const trades = pgTable(
  "trades",
  {
    tradeId: text("trade_id").primaryKey(),
    conditionId: text("condition_id")
      .references(() => markets.conditionId, { onDelete: "cascade" })
      .notNull(),
    outcomeIndex: integer("outcome_index").notNull(),
    exchange: text("exchange").notNull().default("polymarket"),
    taker: text("taker"),
    maker: text("maker"),
    side: tradeSideEnum("side").notNull(),
    price: numeric("price").notNull(),
    size: numeric("size").notNull(),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
    txHash: text("tx_hash"),
    raw: jsonb("raw"),
  },
  (table) => [
    index("idx_trades_condition_ts").on(table.conditionId, table.timestamp),
  ],
);

export const userTrades = pgTable(
  "user_trades",
  {
    id: serial("id").primaryKey(),
    tradeId: text("trade_id")
      .references(() => trades.tradeId, { onDelete: "cascade" })
      .notNull(),
    wallet: text("wallet").notNull(),
    exchange: text("exchange").notNull().default("polymarket"),
    role: tradeRoleEnum("role").notNull(),
    side: tradeSideEnum("side").notNull(),
    price: numeric("price").notNull(),
    size: numeric("size").notNull(),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("idx_user_trades_wallet_ts").on(table.wallet, table.timestamp),
    uniqueIndex("uq_user_trades_trade_wallet_role").on(
      table.tradeId,
      table.wallet,
      table.role,
    ),
  ],
);

export const btcPrices = pgTable(
  "btc_prices",
  {
    id: serial("id").primaryKey(),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
    exchange: text("exchange").notNull(),
    symbol: text("symbol").notNull(),
    open: numeric("open").notNull(),
    high: numeric("high").notNull(),
    low: numeric("low").notNull(),
    close: numeric("close").notNull(),
    volume: numeric("volume"),
  },
  (table) => [
    uniqueIndex("uq_btc_prices_time_exchange_symbol").on(
      table.timestamp,
      table.exchange,
      table.symbol,
    ),
    index("idx_btc_prices_exchange_ts").on(table.exchange, table.timestamp),
  ],
);

export const tradeWatermarks = pgTable(
  "trade_watermarks",
  {
    id: serial("id").primaryKey(),
    conditionId: text("condition_id")
      .references(() => markets.conditionId, { onDelete: "cascade" })
      .notNull(),
    wallet: text("wallet"),
    scope: text("scope").notNull().default("global"), // 'global' or 'wallet'
    lastTimestamp: timestamp("last_timestamp", { withTimezone: true }),
    lastTradeId: text("last_trade_id"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("uq_trade_watermarks_scope_condition_wallet").on(
      table.scope,
      table.conditionId,
      table.wallet,
    ),
  ],
);

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

export const backtestRuns = pgTable("backtest_runs", {
  id: uuid("id").primaryKey().defaultRandom().notNull(),
  strategyName: text("strategy_name").notNull(),
  params: jsonb("params"),
  marketFilter: jsonb("market_filter"),
  feeModel: jsonb("fee_model"),
  latencyModel: jsonb("latency_model"),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  pnlTotal: numeric("pnl_total"),
  pnlVsGabagool: numeric("pnl_vs_gabagool"),
  notes: text("notes"),
});

export const backtestOrders = pgTable(
  "backtest_orders",
  {
    id: uuid("id").primaryKey().defaultRandom().notNull(),
    runId: uuid("run_id")
      .references(() => backtestRuns.id, { onDelete: "cascade" })
      .notNull(),
    conditionId: text("condition_id"),
    outcomeIndex: integer("outcome_index"),
    timestampDecision: timestamp("timestamp_decision", {
      withTimezone: true,
    }),
    timestampExecution: timestamp("timestamp_execution", {
      withTimezone: true,
    }),
    side: tradeSideEnum("side"),
    sizeRequested: numeric("size_requested"),
    sizeFilled: numeric("size_filled"),
    priceEffective: numeric("price_effective"),
    feesPaid: numeric("fees_paid"),
    role: tradeRoleEnum("role"),
    pnlContribution: numeric("pnl_contribution"),
  },
  (table) => [index("idx_backtest_orders_run").on(table.runId)],
);

export const userPnlSnapshots = pgTable(
  "user_pnl_snapshots",
  {
    id: serial("id").primaryKey(),
    wallet: text("wallet").notNull(),
    conditionId: text("condition_id"),
    realizedPnl: numeric("realized_pnl").notNull(),
    unrealizedPnl: numeric("unrealized_pnl"),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("idx_user_pnl_wallet_ts").on(table.wallet, table.timestamp),
    index("idx_user_pnl_condition").on(table.conditionId),
  ],
);

export const arbOpportunities = pgTable("arb_opportunities", {
  id: uuid("id").primaryKey().defaultRandom().notNull(),
  matcherName: text("matcher_name").notNull(),
  matcherKey: text("matcher_key").notNull(),
  kind: text("kind").notNull(),
  margin: numeric("margin").notNull(),
  totalAsk: numeric("total_ask").notNull(),
  legCount: integer("leg_count").notNull(),
  thresholdUsed: numeric("threshold_used"),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const arbOpportunityLegs = pgTable("arb_opportunity_legs", {
  id: serial("id").primaryKey(),
  opportunityId: uuid("opportunity_id")
    .references(() => arbOpportunities.id, { onDelete: "cascade" })
    .notNull(),
  conditionId: text("condition_id").notNull(),
  outcomeIndex: integer("outcome_index").notNull(),
  exchange: text("exchange").notNull().default("polymarket"),
  title: text("title"),
  marketSlug: text("market_slug"),
  outcomeName: text("outcome_name").notNull(),
  bestAskPrice: numeric("best_ask_price"),
  bestAskSize: numeric("best_ask_size"),
  bestBidPrice: numeric("best_bid_price"),
  bestBidSize: numeric("best_bid_size"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
