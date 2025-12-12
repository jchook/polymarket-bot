import dotenv from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as relations from "./relations";
import * as schema from "./schema";

export * from "./schema";
export * from "./relations";

dotenv.config();

const {
  DATABASE_URL,
  POSTGRES_URL,
  POSTGRES_USER,
  POSTGRES_PASSWORD,
  POSTGRES_HOST,
  POSTGRES_PORT,
  POSTGRES_DB,
  POSTGRES_SSL,
} = process.env;

const connectionString =
  DATABASE_URL ||
  POSTGRES_URL ||
  (POSTGRES_USER &&
  POSTGRES_PASSWORD &&
  POSTGRES_HOST &&
  POSTGRES_PORT &&
  POSTGRES_DB
    ? `postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}`
    : undefined);

if (!connectionString) {
  throw new Error(
    "Database connection string not provided. Set DATABASE_URL or POSTGRES_* env vars.",
  );
}

const ssl = POSTGRES_SSL === "true" ? { rejectUnauthorized: false } : false;

const pool = new Pool({
  connectionString,
  ssl,
});

export const db = drizzle(pool, {
  schema: { ...schema, ...relations },
  casing: "snake_case",
});
