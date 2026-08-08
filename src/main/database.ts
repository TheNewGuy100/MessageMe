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

    CREATE TABLE IF NOT EXISTS contacts (
      id TEXT PRIMARY KEY,
      platform TEXT NOT NULL,
      account_id TEXT NOT NULL DEFAULT '',
      external_id TEXT NOT NULL,
      username TEXT,
      full_name TEXT,
      profile_pic_url TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (platform, account_id, external_id)
    );

    CREATE INDEX IF NOT EXISTS idx_contacts_updated
      ON contacts (updated_at DESC);

    CREATE TABLE IF NOT EXISTS contact_conversations (
      platform TEXT NOT NULL,
      account_id TEXT NOT NULL DEFAULT '',
      conversation_id TEXT NOT NULL,
      contact_id TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'new',
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      PRIMARY KEY (platform, account_id, conversation_id),
      FOREIGN KEY (contact_id) REFERENCES contacts (id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_contact_conversations_contact
      ON contact_conversations (contact_id, last_seen_at DESC);

    CREATE TABLE IF NOT EXISTS contact_events (
      id TEXT PRIMARY KEY,
      contact_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      direction TEXT NOT NULL,
      content TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      occurred_at TEXT NOT NULL,
      FOREIGN KEY (contact_id) REFERENCES contacts (id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_contact_events_contact
      ON contact_events (contact_id, occurred_at DESC);

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

export type ContactRecord = {
  id: string
  platform: string
  accountId: string
  externalId: string
  username: string | null
  fullName: string | null
  profilePicUrl: string | null
  metadata: string
  createdAt: string
  updatedAt: string
  conversationCount?: number
  lastSeenAt?: string | null
}

export type ContactEventRecord = {
  id: string
  contactId: string
  platform: string
  conversationId: string
  eventType: string
  direction: string
  content: string | null
  metadata: string
  occurredAt: string
}

export function upsertContact(contact: { id: string; platform: string; accountId?: string; externalId: string; username?: string | null; fullName?: string | null; profilePicUrl?: string | null; metadata?: string }) {
  const now = new Date().toISOString()
  const existing = getDb().prepare('SELECT id FROM contacts WHERE platform = ? AND account_id = ? AND external_id = ?').get(contact.platform, contact.accountId || '', contact.externalId) as { id: string } | undefined
  const contactId = existing?.id || contact.id
  getDb().prepare(`
    INSERT INTO contacts
      (id, platform, account_id, external_id, username, full_name, profile_pic_url, metadata, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(platform, account_id, external_id) DO UPDATE SET
      username = COALESCE(excluded.username, contacts.username),
      full_name = COALESCE(excluded.full_name, contacts.full_name),
      profile_pic_url = COALESCE(excluded.profile_pic_url, contacts.profile_pic_url),
      metadata = CASE WHEN excluded.metadata = '{}' THEN contacts.metadata ELSE excluded.metadata END,
      updated_at = excluded.updated_at
  `).run(contactId, contact.platform, contact.accountId || '', contact.externalId, contact.username || null, contact.fullName || null, contact.profilePicUrl || null, contact.metadata || '{}', now, now)
  return contactId
}

export function upsertContactConversation(conversation: { platform: string; accountId?: string; conversationId: string; contactId: string; state?: string }) {
  const now = new Date().toISOString()
  getDb().prepare(`
    INSERT INTO contact_conversations
      (platform, account_id, conversation_id, contact_id, state, first_seen_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(platform, account_id, conversation_id) DO UPDATE SET
      contact_id = excluded.contact_id,
      state = excluded.state,
      last_seen_at = excluded.last_seen_at
  `).run(conversation.platform, conversation.accountId || '', conversation.conversationId, conversation.contactId, conversation.state || 'new', now, now)
}

export function insertContactEvent(event: { id: string; contactId: string; platform: string; conversationId: string; eventType: string; direction: string; content?: string | null; metadata?: string; occurredAt?: string }) {
  getDb().prepare(`
    INSERT OR IGNORE INTO contact_events
      (id, contact_id, platform, conversation_id, event_type, direction, content, metadata, occurred_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(event.id, event.contactId, event.platform, event.conversationId, event.eventType, event.direction, event.content || null, event.metadata || '{}', event.occurredAt || new Date().toISOString())
}

export function listContacts(): ContactRecord[] {
  return getDb().prepare(`
    SELECT c.id, c.platform, c.account_id AS accountId, c.external_id AS externalId,
      c.username, c.full_name AS fullName, c.profile_pic_url AS profilePicUrl,
      c.metadata, c.created_at AS createdAt, c.updated_at AS updatedAt,
      COUNT(cc.conversation_id) AS conversationCount, MAX(cc.last_seen_at) AS lastSeenAt
    FROM contacts c
    LEFT JOIN contact_conversations cc ON cc.contact_id = c.id
    GROUP BY c.id
    ORDER BY COALESCE(MAX(cc.last_seen_at), c.updated_at) DESC
  `).all() as ContactRecord[]
}

export function getContactHistory(contactId: string): { contact: ContactRecord | undefined; events: ContactEventRecord[] } {
  const contact = getDb().prepare(`
    SELECT id, platform, account_id AS accountId, external_id AS externalId,
      username, full_name AS fullName, profile_pic_url AS profilePicUrl,
      metadata, created_at AS createdAt, updated_at AS updatedAt
    FROM contacts WHERE id = ?
  `).get(contactId) as ContactRecord | undefined
  const events = getDb().prepare(`
    SELECT id, contact_id AS contactId, platform, conversation_id AS conversationId,
      event_type AS eventType, direction, content, metadata, occurred_at AS occurredAt
    FROM contact_events WHERE contact_id = ? ORDER BY occurred_at DESC LIMIT 500
  `).all(contactId) as ContactEventRecord[]
  return { contact, events }
}

export function getConversationState(platform: string, accountId: string, conversationId: string): ConversationStateRecord | undefined {
  return getDb().prepare(`
    SELECT platform, account_id AS accountId, conversation_id AS conversationId,
      flow_id AS flowId, state, variables, updated_at AS updatedAt
    FROM conversation_states
    WHERE platform = ? AND account_id = ? AND conversation_id = ?
  `).get(platform, accountId, conversationId) as ConversationStateRecord | undefined
}

export function listConversationStates(platform: string, accountId = ''): ConversationStateRecord[] {
  return getDb().prepare(`
    SELECT platform, account_id AS accountId, conversation_id AS conversationId,
      flow_id AS flowId, state, variables, updated_at AS updatedAt
    FROM conversation_states
    WHERE platform = ? AND account_id = ?
  `).all(platform, accountId) as ConversationStateRecord[]
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
