import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';

export function runMigrations(db: Database.Database): void {
  logger.info('Starting database migrations check...');

  // 1. Create migrations tracking table if not exists
  db.prepare(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `).run();

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const migrationsDir = path.resolve(__dirname, '..', '..', 'migrations');
  if (!fs.existsSync(migrationsDir)) {
    logger.warn({ migrationsDir }, 'Migrations directory not found, skipping');
    return;
  }

  // 2. Read migration files
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    logger.info('No migration SQL files found');
    return;
  }

  // 3. Get already applied migrations
  const appliedRows = db.prepare('SELECT version FROM schema_migrations').all() as { version: string }[];
  const appliedVersions = new Set(appliedRows.map(row => row.version));

  // 4. Run pending migrations
  for (const file of files) {
    if (appliedVersions.has(file)) {
      logger.debug({ file }, 'Migration already applied');
      continue;
    }

    logger.info({ file }, 'Applying database migration');
    const filePath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(filePath, 'utf-8');

    // Run within a transaction
    const executeMigration = db.transaction(() => {
      // Split by semicolon, filter out comments and empty statements
      // A simple split by ';' works for standard migration queries.
      // But we have to be careful with statements that have multiple lines.
      // SQLite's exec() is perfect because it executes all SQL statements in the string!
      db.exec(sql);
      
      const insertStmt = db.prepare(`
        INSERT INTO schema_migrations (version, applied_at)
        VALUES (?, ?)
      `);
      insertStmt.run(file, new Date().toISOString());
    });

    try {
      executeMigration();
      logger.info({ file }, 'Migration applied successfully');
    } catch (error) {
      logger.fatal({ err: error, file }, 'Failed to apply migration, transaction rolled back');
      throw error;
    }
  }

  logger.info('All database migrations are up to date');
}
