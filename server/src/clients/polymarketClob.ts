import { Chain, ClobClient } from "@polymarket/clob-client";

const host = process.env.CLOB_BASE_URL ?? "https://clob.polymarket.com";

const chainId =
  Number(process.env.CLOB_CHAIN_ID) === Chain.AMOY ? Chain.AMOY : Chain.POLYGON;

/**
 * Public CLOB client used for read-only market/orderbook data.
 * `useServerTime` is enabled to avoid local clock skew when the API supports it.
 */
export const clobClient = new ClobClient(
  host,
  chainId,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  true,
);

export { Chain };
