import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { config } from './index.js';
import { logger } from '../utils/logger.js';
import { runMigrations } from './migration.runner.js';

let db: Database.Database | null = null;

export function initDatabase(): Database.Database {
  if (db) return db;

  const dbPath = path.resolve(process.cwd(), config.DATABASE_PATH);
  const dbDir = path.dirname(dbPath);

  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
    logger.info({ dbDir }, 'Created database directory');
  }

  try {
    db = new Database(dbPath, {
      verbose: (message) => logger.debug({ sql: message }, 'SQL Query'),
    });

    logger.info({ dbPath }, 'Database connection established');

    // Apply WAL mode and optimal performance pragmas
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');

    logger.info('Database pragmas configured successfully');

    // Run pending migrations
    runMigrations(db);

    return db;
  } catch (error) {
    logger.fatal({ err: error, dbPath }, 'Failed to initialize database');
    throw error;
  }
}

export function getDatabase(): Database.Database {
  if (!db) {
    return initDatabase();
  }
  return db;
}

