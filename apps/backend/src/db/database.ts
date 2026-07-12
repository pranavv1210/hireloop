import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { schemaSql } from './schema.js';

export type AppDatabase = DatabaseSync;

let db: AppDatabase | undefined;

export function getDatabase(): AppDatabase {
  if (db) {
    return db;
  }

  fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });
  db = new DatabaseSync(config.databasePath);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(schemaSql);
  runMigrations(db);

  logger.info({ databasePath: config.databasePath }, 'Database connected and schema initialized');
  return db;
}

function runMigrations(database: AppDatabase): void {
  const columns = database.prepare('PRAGMA table_info(user_profiles)').all() as Array<{
    name: string;
  }>;
  const columnNames = new Set(columns.map((column) => column.name));

  if (!columnNames.has('google_sub')) {
    database.exec('ALTER TABLE user_profiles ADD COLUMN google_sub TEXT');
  }

  if (!columnNames.has('avatar_url')) {
    database.exec('ALTER TABLE user_profiles ADD COLUMN avatar_url TEXT');
  }

  database.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_user_profiles_google_sub ON user_profiles(google_sub)');

  const applicationColumns = database.prepare('PRAGMA table_info(applications)').all() as Array<{
    name: string;
  }>;
  const applicationColumnNames = new Set(applicationColumns.map((column) => column.name));

  if (!applicationColumnNames.has('outcome_status')) {
    database.exec('ALTER TABLE applications ADD COLUMN outcome_status TEXT');
  }

  if (!applicationColumnNames.has('outcome_detected_at')) {
    database.exec('ALTER TABLE applications ADD COLUMN outcome_detected_at TEXT');
  }

  if (!applicationColumnNames.has('outcome_source_message_id')) {
    database.exec('ALTER TABLE applications ADD COLUMN outcome_source_message_id TEXT');
  }
}

export function closeDatabase(): void {
  db?.close();
  db = undefined;
}
