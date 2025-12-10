import { relations } from "drizzle-orm";
import {
  backtestOrders,
  backtestRuns,
  marketOutcomes,
  markets,
  orderbookSnapshots,
  priceHistory,
  arbOpportunities,
  arbOpportunityLegs,
  trades,
  userTrades,
} from "./schema";

export const marketRelations = relations(markets, ({ many }) => ({
  outcomes: many(marketOutcomes),
  snapshots: many(orderbookSnapshots),
  prices: many(priceHistory),
  trades: many(trades),
}));

export const marketOutcomeRelations = relations(marketOutcomes, ({ one }) => ({
  market: one(markets, {
    fields: [marketOutcomes.conditionId],
    references: [markets.conditionId],
  }),
}));

export const orderbookSnapshotRelations = relations(
  orderbookSnapshots,
  ({ one }) => ({
    market: one(markets, {
      fields: [orderbookSnapshots.conditionId],
      references: [markets.conditionId],
    }),
  }),
);

export const priceHistoryRelations = relations(priceHistory, ({ one }) => ({
  market: one(markets, {
    fields: [priceHistory.conditionId],
    references: [markets.conditionId],
  }),
}));

export const tradeRelations = relations(trades, ({ one, many }) => ({
  market: one(markets, {
    fields: [trades.conditionId],
    references: [markets.conditionId],
  }),
  userTrades: many(userTrades),
}));

export const userTradeRelations = relations(userTrades, ({ one }) => ({
  trade: one(trades, {
    fields: [userTrades.tradeId],
    references: [trades.tradeId],
  }),
}));

export const backtestRunRelations = relations(backtestRuns, ({ many }) => ({
  orders: many(backtestOrders),
}));

export const backtestOrderRelations = relations(backtestOrders, ({ one }) => ({
  run: one(backtestRuns, {
    fields: [backtestOrders.runId],
    references: [backtestRuns.id],
  }),
}));

export const arbOpportunityRelations = relations(
  arbOpportunities,
  ({ many }) => ({
    legs: many(arbOpportunityLegs),
  }),
);

export const arbOpportunityLegRelations = relations(
  arbOpportunityLegs,
  ({ one }) => ({
    opportunity: one(arbOpportunities, {
      fields: [arbOpportunityLegs.opportunityId],
      references: [arbOpportunities.id],
    }),
  }),
);
