CREATE TYPE "public"."trade_role" AS ENUM('TAKER', 'MAKER', 'MIXED');--> statement-breakpoint
CREATE TYPE "public"."trade_side" AS ENUM('BUY', 'SELL');--> statement-breakpoint
CREATE TABLE "arb_opportunities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"matcher_name" text NOT NULL,
	"matcher_key" text NOT NULL,
	"kind" text NOT NULL,
	"margin" numeric NOT NULL,
	"total_ask" numeric NOT NULL,
	"leg_count" integer NOT NULL,
	"threshold_used" numeric,
	"timestamp" timestamp with time zone NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "arb_opportunity_legs" (
	"id" serial PRIMARY KEY NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"condition_id" text NOT NULL,
	"outcome_index" integer NOT NULL,
	"exchange" text DEFAULT 'polymarket' NOT NULL,
	"title" text,
	"market_slug" text,
	"outcome_name" text NOT NULL,
	"best_ask_price" numeric,
	"best_ask_size" numeric,
	"best_bid_price" numeric,
	"best_bid_size" numeric,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backtest_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"condition_id" text,
	"outcome_index" integer,
	"timestamp_decision" timestamp with time zone,
	"timestamp_execution" timestamp with time zone,
	"side" "trade_side",
	"size_requested" numeric,
	"size_filled" numeric,
	"price_effective" numeric,
	"fees_paid" numeric,
	"role" "trade_role",
	"pnl_contribution" numeric
);
--> statement-breakpoint
CREATE TABLE "backtest_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"strategy_name" text NOT NULL,
	"params" jsonb,
	"market_filter" jsonb,
	"fee_model" jsonb,
	"latency_model" jsonb,
	"started_at" timestamp with time zone DEFAULT now(),
	"finished_at" timestamp with time zone,
	"pnl_total" numeric,
	"pnl_vs_gabagool" numeric,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "btc_prices" (
	"id" serial PRIMARY KEY NOT NULL,
	"timestamp" timestamp with time zone NOT NULL,
	"exchange" text NOT NULL,
	"symbol" text NOT NULL,
	"open" numeric NOT NULL,
	"high" numeric NOT NULL,
	"low" numeric NOT NULL,
	"close" numeric NOT NULL,
	"volume" numeric
);
--> statement-breakpoint
CREATE TABLE "market_outcomes" (
	"id" serial PRIMARY KEY NOT NULL,
	"condition_id" text NOT NULL,
	"outcome_index" integer NOT NULL,
	"outcome_name" text NOT NULL,
	"token_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "markets" (
	"condition_id" text PRIMARY KEY NOT NULL,
	"exchange" text DEFAULT 'polymarket' NOT NULL,
	"event_id" text,
	"event_slug" text,
	"market_slug" text,
	"title" text NOT NULL,
	"category" text,
	"underlying_symbol" text,
	"window_start" timestamp with time zone NOT NULL,
	"window_end" timestamp with time zone NOT NULL,
	"resolution_time" timestamp with time zone,
	"resolved" boolean DEFAULT false NOT NULL,
	"winning_outcome_index" integer,
	"neg_risk" boolean DEFAULT false NOT NULL,
	"tags" jsonb,
	"volume_24h" numeric,
	"volume_all_time" numeric,
	"open_interest" numeric,
	"liquidity" numeric,
	"raw_metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "orderbook_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"condition_id" text NOT NULL,
	"outcome_index" integer NOT NULL,
	"exchange" text DEFAULT 'polymarket' NOT NULL,
	"timestamp" timestamp with time zone NOT NULL,
	"best_bid_price" numeric,
	"best_bid_size" numeric,
	"best_ask_price" numeric,
	"best_ask_size" numeric,
	"mid_price" numeric,
	"spread" numeric,
	"raw_orderbook" jsonb
);
--> statement-breakpoint
CREATE TABLE "price_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"condition_id" text NOT NULL,
	"outcome_index" integer NOT NULL,
	"exchange" text DEFAULT 'polymarket' NOT NULL,
	"timestamp" timestamp with time zone NOT NULL,
	"price" numeric NOT NULL,
	"side" "trade_side"
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"trade_id" text PRIMARY KEY NOT NULL,
	"condition_id" text NOT NULL,
	"outcome_index" integer NOT NULL,
	"exchange" text DEFAULT 'polymarket' NOT NULL,
	"taker" text,
	"maker" text,
	"side" "trade_side" NOT NULL,
	"price" numeric NOT NULL,
	"size" numeric NOT NULL,
	"timestamp" timestamp with time zone NOT NULL,
	"tx_hash" text,
	"raw" jsonb
);
--> statement-breakpoint
CREATE TABLE "user_pnl_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"wallet" text NOT NULL,
	"condition_id" text,
	"realized_pnl" numeric NOT NULL,
	"unrealized_pnl" numeric,
	"timestamp" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_trades" (
	"id" serial PRIMARY KEY NOT NULL,
	"trade_id" text NOT NULL,
	"wallet" text NOT NULL,
	"exchange" text DEFAULT 'polymarket' NOT NULL,
	"role" "trade_role" NOT NULL,
	"side" "trade_side" NOT NULL,
	"price" numeric NOT NULL,
	"size" numeric NOT NULL,
	"timestamp" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "arb_opportunity_legs" ADD CONSTRAINT "arb_opportunity_legs_opportunity_id_arb_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."arb_opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backtest_orders" ADD CONSTRAINT "backtest_orders_run_id_backtest_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."backtest_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_outcomes" ADD CONSTRAINT "market_outcomes_condition_id_markets_condition_id_fk" FOREIGN KEY ("condition_id") REFERENCES "public"."markets"("condition_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orderbook_snapshots" ADD CONSTRAINT "orderbook_snapshots_condition_id_markets_condition_id_fk" FOREIGN KEY ("condition_id") REFERENCES "public"."markets"("condition_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_condition_id_markets_condition_id_fk" FOREIGN KEY ("condition_id") REFERENCES "public"."markets"("condition_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_condition_id_markets_condition_id_fk" FOREIGN KEY ("condition_id") REFERENCES "public"."markets"("condition_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_trades" ADD CONSTRAINT "user_trades_trade_id_trades_trade_id_fk" FOREIGN KEY ("trade_id") REFERENCES "public"."trades"("trade_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_backtest_orders_run" ON "backtest_orders" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_btc_prices_time_exchange_symbol" ON "btc_prices" USING btree ("timestamp","exchange","symbol");--> statement-breakpoint
CREATE INDEX "idx_btc_prices_exchange_ts" ON "btc_prices" USING btree ("exchange","timestamp");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_market_outcomes_condition_outcome" ON "market_outcomes" USING btree ("condition_id","outcome_index");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_orderbook_snapshots_condition_outcome_ts" ON "orderbook_snapshots" USING btree ("condition_id","outcome_index","timestamp");--> statement-breakpoint
CREATE INDEX "idx_orderbook_snapshots_ts" ON "orderbook_snapshots" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "idx_orderbook_snapshots_condition_ts" ON "orderbook_snapshots" USING btree ("condition_id","timestamp");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_price_history_condition_outcome_side_ts" ON "price_history" USING btree ("condition_id","outcome_index","timestamp","side");--> statement-breakpoint
CREATE INDEX "idx_price_history_condition_ts" ON "price_history" USING btree ("condition_id","timestamp");--> statement-breakpoint
CREATE INDEX "idx_trades_condition_ts" ON "trades" USING btree ("condition_id","timestamp");--> statement-breakpoint
CREATE INDEX "idx_user_pnl_wallet_ts" ON "user_pnl_snapshots" USING btree ("wallet","timestamp");--> statement-breakpoint
CREATE INDEX "idx_user_pnl_condition" ON "user_pnl_snapshots" USING btree ("condition_id");--> statement-breakpoint
CREATE INDEX "idx_user_trades_wallet_ts" ON "user_trades" USING btree ("wallet","timestamp");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_user_trades_trade_wallet_role" ON "user_trades" USING btree ("trade_id","wallet","role");