import { join } from 'path'
import { app } from 'electron'
import Database from 'better-sqlite3'
import { existsSync, mkdirSync } from 'fs'

let db: Database.Database

function getDb() {
  if (!db) {
    const dir = join(app.getPath('userData'), 'data')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    db = new Database(join(dir, 'message-manager.db'))
    db.pragma('journal_mode = WAL')
    initSchema()
  }
  return db
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS store (
      namespace TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT,
      PRIMARY KEY (namespace, key)
    );

    CREATE TABLE IF NOT EXISTS wa_creds (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      data TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS wa_keys (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL
    );
  `)
}

export function storeGet(namespace: string, key: string): string | undefined {
  const row = getDb().prepare('SELECT value FROM store WHERE namespace = ? AND key = ?').get(namespace, key) as any
  return row?.value
}

export function storeSet(namespace: string, key: string, value: string) {
  getDb().prepare('INSERT OR REPLACE INTO store (namespace, key, value) VALUES (?, ?, ?)').run(namespace, key, value)
}

export function storeDelete(namespace: string, key: string) {
  getDb().prepare('DELETE FROM store WHERE namespace = ? AND key = ?').run(namespace, key)
}

export function storeList(namespace: string): { key: string; value: string }[] {
  return getDb().prepare('SELECT key, value FROM store WHERE namespace = ?').all(namespace) as any
}

export function waGetCreds(): string | undefined {
  const row = getDb().prepare('SELECT data FROM wa_creds WHERE id = 1').get() as any
  return row?.data
}

export function waSetCreds(data: string) {
  getDb().prepare('INSERT OR REPLACE INTO wa_creds (id, data) VALUES (1, ?)').run(data)
}

export function waGetKey(id: string): string | undefined {
  const row = getDb().prepare('SELECT data FROM wa_keys WHERE id = ?').get(id) as any
  return row?.data
}

export function waSetKey(id: string, data: string) {
  getDb().prepare('INSERT OR REPLACE INTO wa_keys (id, data) VALUES (?, ?)').run(id, data)
}

export function waDeleteKey(id: string) {
  getDb().prepare('DELETE FROM wa_keys WHERE id = ?').run(id)
}

export function waListKeys(): string[] {
  return (getDb().prepare('SELECT id FROM wa_keys').all() as any[]).map(r => r.id)
}

export function waClearAll() {
  const d = getDb()
  d.prepare('DELETE FROM wa_creds').run()
  d.prepare('DELETE FROM wa_keys').run()
  d.prepare('DELETE FROM store WHERE namespace = ?').run('instagram')
}

export function closeDb() {
  if (db) {
    db.close()
    db = undefined as any
  }
}
