import { z } from "zod";
import { loadConfigFromEnv } from "./env";

// Configuration schema + defaults
export const ConfigSchema = z.object({
  name: z.string().default("Project"),
  description: z.string().default("Project description"),
  version: z.string().default("development"),
});

export const config = loadConfigFromEnv(ConfigSchema, "APP_");
export type AppConfig = z.infer<typeof ConfigSchema>;
