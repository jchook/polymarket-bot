import type { ZodObject, ZodRawShape, z } from "zod";

function toEnvKey(key: string, prefix: string): string {
  return prefix + key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase();
}

export function loadConfigFromEnv<T extends ZodRawShape>(
  schema: ZodObject<T>,
  prefix = "",
): z.infer<typeof schema> {
  const raw: Record<string, unknown> = {};

  for (const key of Object.keys(schema.shape)) {
    const envKey = toEnvKey(key, prefix);
    raw[key] = process.env[envKey];
  }

  return schema.parse(raw);
}
