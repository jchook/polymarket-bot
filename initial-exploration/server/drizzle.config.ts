import { defineConfig } from "drizzle-kit";
const { env } = process;

const connectionString = env.DATABASE_URL || env.POSTGRES_URL;

export default defineConfig({
  out: "./drizzle",
  schema: "./src/db/schema.ts",
  dialect: "postgresql",
  casing: "snake_case",
  dbCredentials: connectionString
    ? { url: connectionString }
    : {
        host: env.POSTGRES_HOST || "localhost",
        port: Number(env.POSTGRES_PORT) || 5432,
        database: env.POSTGRES_DB || "app",
        user: env.POSTGRES_USER,
        password: env.POSTGRES_PASSWORD,
        ssl: env.POSTGRES_SSL === "true" ? { rejectUnauthorized: false } : false,
      },
});
