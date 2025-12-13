import debug from "debug";

// Prefix all logs with app:* so operators can toggle with DEBUG=app* or DEBUG=app:coinbase,app:pm, etc.
export function logger(namespace: string) {
  return debug(`app:${namespace}`);
}
