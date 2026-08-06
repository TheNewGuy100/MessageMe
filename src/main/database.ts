import { app } from 'electron'
import Database from 'better-sqlite3'
import { join } from 'path'
import { mkdirSync } from 'fs'

export type ScheduledMessageRecord = {
  id: string
  platform: string
  conversationId: string | null
  message: string
  scheduledAt: string
  status: string
  createdAt: string
  updatedAt: string
}

export type AutomationLogRecord = {
  id: string
  at: string
  platform: 'instagram'
  conversation: string
  action: 'reply'
  status: 'sent' | 'failed'
  detail: string
}

export type AutomationFlowRecord = {
  id: string
  name: string
  enabled: boolean
  priority: number
  definition: string
  createdAt: string
  updatedAt: string
}

let db: Database.Database | null = null

export function getAppSetting(key: string): string | undefined {
  const row = getDb().prepare('SELECT value FROM store WHERE namespace = ? AND key = ?').get('app', key) as { value?: string } | undefined
  return row?.value
}

export function setAppSetting(key: string, value: string) {
  getDb().prepare('INSERT OR REPLACE INTO store (namespace, key, value) VALUES (?, ?, ?)').run('app', key, value)
}

function getDb() {
  if (db) return db
  const directory = join(app.getPath('userData'), 'data')
  mkdirSync(directory, { recursive: true })
  db = new Database(join(directory, 'message-manager.db'))
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS store (
      namespace TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT,
      PRIMARY KEY (namespace, key)
    );

    CREATE TABLE IF NOT EXISTS scheduled_messages (
      id TEXT PRIMARY KEY,
      platform TEXT NOT NULL DEFAULT 'instagram',
      conversation_id TEXT,
      message TEXT NOT NULL,
      scheduled_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_scheduled_messages_date
      ON scheduled_messages (scheduled_at, status);

    CREATE TABLE IF NOT EXISTS automation_flows (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 0,
      priority INTEGER NOT NULL DEFAULT 0,
      definition TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversation_states (
      platform TEXT NOT NULL,
      account_id TEXT NOT NULL DEFAULT '',
      conversation_id TEXT NOT NULL,
      flow_id TEXT,
      state TEXT NOT NULL DEFAULT 'new',
      variables TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL,
      PRIMARY KEY (platform, account_id, conversation_id)
    );

    CREATE TABLE IF NOT EXISTS processed_messages (
      platform TEXT NOT NULL,
      account_id TEXT NOT NULL DEFAULT '',
      message_id TEXT NOT NULL,
      processed_at TEXT NOT NULL,
      PRIMARY KEY (platform, account_id, message_id)
    );

    CREATE TABLE IF NOT EXISTS automation_logs (
      id TEXT PRIMARY KEY,
      at TEXT NOT NULL,
      platform TEXT NOT NULL,
      conversation TEXT NOT NULL,
      action TEXT NOT NULL,
      status TEXT NOT NULL,
      detail TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_automation_logs_at
      ON automation_logs (at DESC);
  `)
  return db
}

export function listScheduledMessages(): ScheduledMessageRecord[] {
  return getDb().prepare(`
    SELECT id, platform, conversation_id AS conversationId, message,
      scheduled_at AS scheduledAt, status, created_at AS createdAt, updated_at AS updatedAt
    FROM scheduled_messages
    ORDER BY scheduled_at ASC
  `).all() as ScheduledMessageRecord[]
}

export function insertScheduledMessage(item: { id: string; message: string; at: string; createdAt?: string; platform?: string; conversationId?: string | null }) {
  const now = new Date().toISOString()
  getDb().prepare(`
    INSERT INTO scheduled_messages
      (id, platform, conversation_id, message, scheduled_at, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      platform = excluded.platform,
      conversation_id = excluded.conversation_id,
      message = excluded.message,
      scheduled_at = excluded.scheduled_at,
      updated_at = excluded.updated_at
  `).run(item.id, item.platform || 'instagram', item.conversationId || null, item.message, item.at, item.createdAt || now, now)
}

export function deleteScheduledMessage(id: string) {
  getDb().prepare('DELETE FROM scheduled_messages WHERE id = ?').run(id)
}

export function listAutomationFlows(): AutomationFlowRecord[] {
  return getDb().prepare(`
    SELECT id, name, enabled, priority, definition,
      created_at AS createdAt, updated_at AS updatedAt
    FROM automation_flows ORDER BY priority DESC, created_at ASC
  `).all().map((flow: any) => ({ ...flow, enabled: Boolean(flow.enabled) })) as AutomationFlowRecord[]
}

export function upsertAutomationFlow(flow: { id: string; name: string; enabled: boolean; priority?: number; definition: string; createdAt?: string }) {
  const now = new Date().toISOString()
  getDb().prepare(`
    INSERT INTO automation_flows (id, name, enabled, priority, definition, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      enabled = excluded.enabled,
      priority = excluded.priority,
      definition = excluded.definition,
      updated_at = excluded.updated_at
  `).run(flow.id, flow.name, flow.enabled ? 1 : 0, flow.priority || 0, flow.definition, flow.createdAt || now, now)
}

export function deleteAutomationFlow(id: string) {
  getDb().prepare('DELETE FROM automation_flows WHERE id = ?').run(id)
}

export type ConversationStateRecord = {
  platform: string
  accountId: string
  conversationId: string
  flowId: string | null
  state: string
  variables: string
  updatedAt: string
}

export function getConversationState(platform: string, accountId: string, conversationId: string): ConversationStateRecord | undefined {
  return getDb().prepare(`
    SELECT platform, account_id AS accountId, conversation_id AS conversationId,
      flow_id AS flowId, state, variables, updated_at AS updatedAt
    FROM conversation_states
    WHERE platform = ? AND account_id = ? AND conversation_id = ?
  `).get(platform, accountId, conversationId) as ConversationStateRecord | undefined
}

export function upsertConversationState(state: { platform: string; accountId?: string; conversationId: string; flowId?: string | null; currentState: string; variables?: string }) {
  const updatedAt = new Date().toISOString()
  getDb().prepare(`
    INSERT INTO conversation_states
      (platform, account_id, conversation_id, flow_id, state, variables, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(platform, account_id, conversation_id) DO UPDATE SET
      flow_id = excluded.flow_id,
      state = excluded.state,
      variables = excluded.variables,
      updated_at = excluded.updated_at
  `).run(state.platform, state.accountId || '', state.conversationId, state.flowId || null, state.currentState, state.variables || '{}', updatedAt)
}

export function listProcessedMessageIds(platform: string, accountId = ''): string[] {
  return (getDb().prepare(`
    SELECT message_id FROM processed_messages
    WHERE platform = ? AND account_id = ?
    ORDER BY processed_at DESC LIMIT 1000
  `).all(platform, accountId) as Array<{ message_id: string }>).map(row => row.message_id)
}

export function markProcessedMessage(platform: string, messageId: string, accountId = '') {
  getDb().prepare(`
    INSERT OR IGNORE INTO processed_messages (platform, account_id, message_id, processed_at)
    VALUES (?, ?, ?, ?)
  `).run(platform, accountId, messageId, new Date().toISOString())
  getDb().prepare(`
    DELETE FROM processed_messages
    WHERE platform = ? AND account_id = ?
      AND message_id NOT IN (
        SELECT message_id FROM processed_messages
        WHERE platform = ? AND account_id = ?
        ORDER BY processed_at DESC LIMIT 1000
      )
  `).run(platform, accountId, platform, accountId)
}

export function resetAutomationRuntime() {
  getDb().exec('DELETE FROM processed_messages; DELETE FROM conversation_states;')
}

export function listAutomationLogs(): AutomationLogRecord[] {
  return getDb().prepare(`
    SELECT id, at, platform, conversation, action, status, detail
    FROM automation_logs ORDER BY at DESC LIMIT 200
  `).all() as AutomationLogRecord[]
}

export function insertAutomationLog(log: AutomationLogRecord) {
  getDb().prepare(`
    INSERT OR REPLACE INTO automation_logs
      (id, at, platform, conversation, action, status, detail)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(log.id, log.at, log.platform, log.conversation, log.action, log.status, log.detail)
  getDb().prepare(`
    DELETE FROM automation_logs
    WHERE id NOT IN (SELECT id FROM automation_logs ORDER BY at DESC LIMIT 200)
  `).run()
}

export function clearAutomationLogs() {
  getDb().prepare('DELETE FROM automation_logs').run()
}

export function closeDb() {
  db?.close()
  db = null
}
