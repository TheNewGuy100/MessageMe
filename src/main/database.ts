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

    CREATE TABLE IF NOT EXISTS wa_chats (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS wa_messages (
      chat_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      message_timestamp INTEGER NOT NULL DEFAULT 0,
      data TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (chat_id, message_id)
    );

    CREATE INDEX IF NOT EXISTS idx_wa_messages_chat_time
      ON wa_messages (chat_id, message_timestamp);

    CREATE TABLE IF NOT EXISTS wa_outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      data TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_wa_outbox_pending
      ON wa_outbox (status, next_attempt_at);

    CREATE TABLE IF NOT EXISTS instagram_threads (
      folder TEXT NOT NULL,
      id TEXT NOT NULL,
      data TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (folder, id)
    );

    CREATE INDEX IF NOT EXISTS idx_instagram_threads_folder
      ON instagram_threads (folder, updated_at);
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
  d.prepare('DELETE FROM store WHERE namespace = ?').run('whatsapp')
  d.prepare('DELETE FROM wa_chats').run()
  d.prepare('DELETE FROM wa_messages').run()
  d.prepare('DELETE FROM wa_outbox').run()
  d.prepare('DELETE FROM instagram_threads').run()
}

export function waClearData() {
  const d = getDb()
  d.prepare('DELETE FROM store WHERE namespace = ?').run('whatsapp')
  d.prepare('DELETE FROM wa_chats').run()
  d.prepare('DELETE FROM wa_messages').run()
  d.prepare('DELETE FROM wa_outbox').run()
}

export function instagramUpsertThreads(folder: string, threads: any[]) {
  const statement = getDb().prepare(`
    INSERT INTO instagram_threads (folder, id, data, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(folder, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
  `)
  const transaction = getDb().transaction((items: any[]) => {
    const now = Date.now()
    for (const thread of items || []) {
      if (thread?.id) statement.run(folder, String(thread.id), JSON.stringify(thread), now)
    }
  })
  transaction(threads)
}

export function instagramReplaceThreads(folder: string, threads: any[]) {
  const db = getDb()
  const replace = db.transaction((items: any[]) => {
    db.prepare('DELETE FROM instagram_threads WHERE folder = ?').run(folder)
    const now = Date.now()
    const insert = db.prepare(`
      INSERT INTO instagram_threads (folder, id, data, updated_at)
      VALUES (?, ?, ?, ?)
    `)
    for (const thread of items || []) {
      if (thread?.id) insert.run(folder, String(thread.id), JSON.stringify(thread), now)
    }
  })
  replace(threads)
}

export function instagramListThreads(folder: string): { id: string; data: string }[] {
  return getDb().prepare(`
    SELECT id, data FROM instagram_threads
    WHERE folder = ? ORDER BY updated_at DESC
  `).all(folder) as any
}

export function instagramClearThreads(folder?: string) {
  if (folder) getDb().prepare('DELETE FROM instagram_threads WHERE folder = ?').run(folder)
  else getDb().prepare('DELETE FROM instagram_threads').run()
}

export function waUpsertChat(id: string, data: string) {
  const now = Date.now()
  getDb().prepare(`
    INSERT INTO wa_chats (id, data, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
  `).run(id, data, now)
}

export function waListChats(): { id: string; data: string }[] {
  return getDb().prepare('SELECT id, data FROM wa_chats ORDER BY updated_at ASC').all() as any
}

export function waUpsertMessage(chatId: string, messageId: string, timestamp: number, data: string) {
  const now = Date.now()
  getDb().prepare(`
    INSERT INTO wa_messages (chat_id, message_id, message_timestamp, data, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(chat_id, message_id) DO UPDATE SET
      message_timestamp = excluded.message_timestamp,
      data = excluded.data,
      updated_at = excluded.updated_at
  `).run(chatId, messageId, timestamp, data, now)
}

export function waListMessages(chatId?: string): { chat_id: string; message_id: string; data: string }[] {
  if (chatId) {
    return getDb().prepare(`
      SELECT chat_id, message_id, data FROM wa_messages
      WHERE chat_id = ? ORDER BY message_timestamp ASC, message_id ASC
    `).all(chatId) as any
  }
  return getDb().prepare('SELECT chat_id, message_id, data FROM wa_messages').all() as any
}

export function waEnqueueOutbox(chatId: string, kind: string, data: string): number {
  const now = Date.now()
  const result = getDb().prepare(`
    INSERT INTO wa_outbox (chat_id, kind, data, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(chatId, kind, data, now, now)
  return Number(result.lastInsertRowid)
}

export function waListPendingOutbox(): any[] {
  return getDb().prepare(`
    SELECT * FROM wa_outbox
    WHERE status = 'pending' AND next_attempt_at <= ?
    ORDER BY id ASC
  `).all(Date.now()) as any
}

export function waRecoverOutbox() {
  getDb().prepare(`
    UPDATE wa_outbox
    SET status = 'pending', next_attempt_at = 0, updated_at = ?
    WHERE status = 'sending'
  `).run(Date.now())
}

export function waUpdateOutbox(id: number, status: string, attempts: number, error?: string, nextAttemptAt = 0) {
  getDb().prepare(`
    UPDATE wa_outbox
    SET status = ?, attempts = ?, last_error = ?, next_attempt_at = ?, updated_at = ?
    WHERE id = ?
  `).run(status, attempts, error || null, nextAttemptAt, Date.now(), id)
}

export function closeDb() {
  if (db) {
    db.close()
    db = undefined as any
  }
}
