import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from '../env.js';
import { SCHEMA_SQL } from './schema.js';

export type Db = Database.Database;

let instance: Db | null = null;

export function getDb(): Db {
  if (instance) return instance;

  const file = config.databaseFile;
  if (file !== ':memory:') {
    mkdirSync(dirname(file), { recursive: true });
  }

  const db = new Database(file);
  // WAL keeps reads non-blocking for the realtime gateway; NORMAL sync is the
  // right durability/speed trade-off for an application like this.
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  instance = db;
  return db;
}

/** Idempotent schema application — safe to run at every boot. */
export function migrate(db: Db = getDb()): void {
  db.exec(SCHEMA_SQL);
}

export function closeDb(): void {
  instance?.close();
  instance = null;
}

/** Run `fn` inside a transaction; better-sqlite3 nests via savepoints. */
export function tx<T>(fn: (db: Db) => T, db: Db = getDb()): T {
  return db.transaction(fn)(db);
}

export interface SqlRow {
  [key: string]: unknown;
}

export function one<T = SqlRow>(sql: string, params: unknown[] = [], db: Db = getDb()): T | undefined {
  return db.prepare(sql).get(...(params as never[])) as T | undefined;
}

export function all<T = SqlRow>(sql: string, params: unknown[] = [], db: Db = getDb()): T[] {
  return db.prepare(sql).all(...(params as never[])) as T[];
}

export function run(sql: string, params: unknown[] = [], db: Db = getDb()): Database.RunResult {
  return db.prepare(sql).run(...(params as never[]));
}
