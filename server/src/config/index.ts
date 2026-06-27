import { z } from 'zod';
import fs from 'fs';
import path from 'path';

// Self-contained .env parser to avoid external package dependencies
let envPath = path.resolve(process.cwd(), '.env');
if (!fs.existsSync(envPath)) {
  // Fallback to parent directory for monorepos
  envPath = path.resolve(process.cwd(), '..', '.env');
}

if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf-8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index > 0) {
      const key = trimmed.substring(0, index).trim();
      let value = trimmed.substring(index + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.substring(1, value.length - 1);
      }
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_PATH: z.string().default('./data/monopoly.db'),
  JWT_SECRET: z.string().min(8, 'JWT_SECRET must be at least 8 characters long'),
  HOST_PIN: z.string().length(6, 'HOST_PIN must be exactly 6 characters long'),
  CLIENT_URL: z.string().url().default('http://localhost:3000'),
  GAME_SEED: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Environment validation failed:', parsed.error.format());
  process.exit(1);
}

export const config = parsed.data;
export type ConfigType = z.infer<typeof envSchema>;
