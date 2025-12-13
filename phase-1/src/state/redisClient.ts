// typed via @types/redis when available; fall back to built-in types in redis >=4
// eslint-disable-next-line import/no-unresolved
import { type RedisClientType, createClient } from "redis";

let client: RedisClientType | null = null;
let connecting = false;

export function getRedis(): RedisClientType | null {
  if (client) return client;

  const { REDIS_URL, REDIS_HOST, REDIS_PORT, REDIS_PASSWORD } = process.env;
  const url =
    REDIS_URL ||
    (REDIS_HOST
      ? `redis://${REDIS_PASSWORD ? `:${REDIS_PASSWORD}@` : ""}${REDIS_HOST}:${REDIS_PORT || 6379}`
      : null);

  if (!url) return null;

  const redisClient = createClient({
    url,
    socket: {
      reconnectStrategy: () => 500,
    },
  });

  redisClient.on("error", (err: unknown) => {
    console.error("Redis error", err);
  });

  // Connect lazily; fire and forget.
  if (!connecting) {
    connecting = true;
    redisClient.connect().catch((err) => {
      console.error("Redis connect error", err);
      connecting = false;
    });
  }

  client = redisClient;
  return client;
}
