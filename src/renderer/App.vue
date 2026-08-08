<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { VueFlow } from '@vue-flow/core'
import type { Connection, Edge, Node } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import { MiniMap } from '@vue-flow/minimap'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import Sidebar from '@/components/Sidebar.vue'
import InstagramHeader from '@/components/InstagramHeader.vue'
import WebViewsHeader from '@/components/WebViewsHeader.vue'
import FlowNode from '@/components/FlowNode.vue'

const api = window.electronAPI
const dialogType = new URLSearchParams(window.location.search).get('dialog') as 'dashboard' | 'automation' | 'appointments' | 'logs' | 'contacts' | null
const isInstagramHeader = new URLSearchParams(window.location.search).has('instagram-header')
const autoReplyEnabled = ref(localStorage.getItem('auto-reply-enabled') === 'true')
const autoReplyText = ref(localStorage.getItem('auto-reply-text') || '')
type AutomaticReply = { id: string; message: string; start: string; end: string }
const automaticReplies = ref<AutomaticReply[]>(loadAutomaticReplies())
const scheduledMessage = ref(localStorage.getItem('scheduled-message') || '')
const scheduledAt = ref(localStorage.getItem('scheduled-at') || '')
type ScheduledItem = { id: string; message: string; at: string; createdAt: string; platform?: string; conversationId?: string | null }
const scheduledItems = ref<ScheduledItem[]>(loadScheduledItems())
type AutomationLog = { id: string; at: string; platform: 'instagram'; conversation: string; action: 'reply'; status: 'sent' | 'failed'; detail: string }
const automationLogs = ref<AutomationLog[]>([])
type Contact = { id: string; platform: string; accountId: string; externalId: string; username: string | null; fullName: string | null; profilePicUrl: string | null; metadata: string; createdAt: string; updatedAt: string; conversationCount?: number; lastSeenAt?: string | null }
type ContactEvent = { id: string; contactId: string; platform: string; conversationId: string; eventType: string; direction: string; content: string | null; metadata: string; occurredAt: string }
const contacts = ref<Contact[]>([])
const selectedContactId = ref<string | null>(null)
const selectedContact = ref<Contact | null>(null)
const contactEvents = ref<ContactEvent[]>([])
type DebugLog = { id: string; at: string; level: string; message: string }
const debugLogs = ref<DebugLog[]>([])
const dashboardUnread = ref(0)
const dashboardInstagramCounts = ref({ inbox: 0, requests: 0, hidden: 0 })
const dashboardWhatsAppUnread = ref(0)
const dashboardAutomationStatus = ref({ enabled: false, configured: false, globalEnabled: false, running: false })
let dashboardRefreshTimer: ReturnType<typeof setInterval> | null = null
const logMode = ref<'automation' | 'debug'>('automation')
type AutomationFlow = { id: string; name: string; enabled: boolean; priority: number; definition: string; createdAt: string; updatedAt: string }
type FlowNode = { id: string; type: 'trigger' | 'message' | 'condition' | 'fallback' | 'end'; title: string; keywords: string; text: string; parentId?: string; position?: { x: number; y: number } }
const automationFlows = ref<AutomationFlow[]>([])
const flowName = ref('')
const flowKeywords = ref('')
const flowResponse = ref('')
const automationTab = ref<'reply' | 'flows' | 'scheduled'>('reply')
const selectedFlowId = ref<string | null>(null)
const selectedScheduledId = ref<string | null>(null)
const flowNodes = ref<FlowNode[]>([])
const flowFallbackNodeId = ref<string | null>(null)
const flowFallbackBehavior = ref<'human' | 'restart' | 'infinite'>('human')
const flowFullscreen = ref(false)
const flowZoom = ref(1)
const flowCanvasNodes = ref<Node[]>([])
const flowCanvasEdges = ref<Edge[]>([])
const removedFlowEdgeKeys = ref(new Set<string>())
const flowEdgeKeysById = ref(new Map<string, string>())
const selectedFlowNodeId = ref<string | null>(null)
const flowValidationErrors = ref<string[]>([])
const invalidFlowNodeIds = ref<string[]>([])
const invalidFlowEdgeIds = ref<string[]>([])
const flowNodeTypes = { trigger: FlowNode, message: FlowNode, condition: FlowNode, fallback: FlowNode, end: FlowNode }
const selectedFlowNode = computed(() => flowNodes.value.find(node => node.id === selectedFlowNodeId.value) || null)
const mainFlowNodes = computed(() => flowNodes.value.filter(node => node.type !== 'fallback' && !node.parentId))
const fallbackFlowNode = computed(() => flowNodes.value.find(node => node.id === flowFallbackNodeId.value) || flowNodes.value.find(node => node.type === 'fallback'))
const conditionChildren = computed<Record<string, FlowNode>>(() => Object.fromEntries(flowNodes.value.filter(node => node.parentId && node.type === 'message').map(node => [node.parentId, node])))
const flowRows = computed(() => {
  const rows: Array<{ type: 'node' | 'conditions'; nodes: FlowNode[] }> = []
  for (const node of mainFlowNodes.value) {
    const last = rows[rows.length - 1]
    if (node.type === 'condition' && last?.type === 'conditions') last.nodes.push(node)
    else rows.push({ type: node.type === 'condition' ? 'conditions' : 'node', nodes: [node] })
  }
  return rows
})

function refreshFlowCanvas() {
  const rows = flowRows.value
  const nodes: Node[] = []
  rows.forEach((row, rowIndex) => {
    row.nodes.forEach((node, nodeIndex) => {
      const position = node.position || { x: row.type === 'conditions' ? (nodeIndex - (row.nodes.length - 1) / 2) * 250 : 0, y: rowIndex * 190 }
      if (!node.position) node.position = position
      nodes.push({ id: node.id, type: node.type, position, data: { label: node.title, invalid: invalidFlowNodeIds.value.includes(node.id), selected: node.id === selectedFlowNodeId.value } })
    })
  })
  const fallback = fallbackFlowNode.value
  if (fallback) {
    const position = fallback.position || { x: 360, y: Math.max(0, ...nodes.map(node => node.position.y)) }
    if (!fallback.position) fallback.position = position
    nodes.push({ id: fallback.id, type: fallback.type, position, data: { label: fallback.title, invalid: invalidFlowNodeIds.value.includes(fallback.id), selected: fallback.id === selectedFlowNodeId.value } })
  }
  for (const node of flowNodes.value.filter(item => item.parentId)) {
    const parent = nodes.find(item => item.id === node.parentId)
    if (!parent) continue
    const position = node.position || { x: parent.position.x, y: parent.position.y + 130 }
    if (!node.position) node.position = position
    nodes.push({ id: node.id, type: node.type, position, data: { label: node.title, invalid: invalidFlowNodeIds.value.includes(node.id), selected: node.id === selectedFlowNodeId.value } })
  }
  const nodeIds = new Set(nodes.map(node => node.id))
  const existingEdges = flowCanvasEdges.value.filter(edge => nodeIds.has(edge.source) && nodeIds.has(edge.target))
  const edges = existingEdges.filter(edge => !removedFlowEdgeKeys.value.has(`${edge.source}->${edge.target}`))
  flowEdgeKeysById.value = new Map(edges.map(edge => [edge.id, `${edge.source}->${edge.target}`]))
  flowCanvasNodes.value = nodes
  flowCanvasEdges.value = edges
  validateFlowGraph()
}

function validateFlowGraph() {
  const errors: string[] = []
  const invalidNodes = new Set<string>()
  const invalidEdges = new Set<string>()
  const nodesById = new Map(flowCanvasNodes.value.map(node => [node.id, node]))
  const incoming = new Map<string, Edge[]>()
  const outgoing = new Map<string, Edge[]>()
  for (const node of flowCanvasNodes.value) {
    incoming.set(node.id, [])
    outgoing.set(node.id, [])
  }
  for (const edge of flowCanvasEdges.value) {
    if (!nodesById.has(edge.source) || !nodesById.has(edge.target)) {
      invalidEdges.add(edge.id)
      errors.push(`A conexão ${edge.id} aponta para um nó inexistente.`)
      continue
    }
    incoming.get(edge.target)!.push(edge)
    outgoing.get(edge.source)!.push(edge)
  }
  const triggers = flowCanvasNodes.value.filter(node => node.type === 'trigger')
  if (triggers.length === 0) errors.push('O fluxo precisa ter um nó de início.')
  if (triggers.length > 1) {
    errors.push('O fluxo deve ter apenas um nó de início.')
    triggers.slice(1).forEach(node => invalidNodes.add(node.id))
  }
  for (const node of flowCanvasNodes.value) {
    const nodeIncoming = incoming.get(node.id)!.length
    const nodeOutgoing = outgoing.get(node.id)!.length
    if (node.type === 'trigger' && nodeIncoming > 0) { invalidNodes.add(node.id); errors.push(`O início "${node.data.label}" não pode receber conexões.`) }
    if (node.type === 'condition' && nodeOutgoing === 0) { invalidNodes.add(node.id); errors.push(`A decisão "${node.data.label}" precisa ter uma saída.`) }
    if (node.type === 'end' && nodeOutgoing > 0) { invalidNodes.add(node.id); errors.push(`O fim "${node.data.label}" não pode ter saída.`) }
  }
  const reachable = new Set<string>()
  const queue = triggers.slice(0, 1).map(node => node.id)
  while (queue.length) {
    const id = queue.shift()!
    if (reachable.has(id)) continue
    reachable.add(id)
    outgoing.get(id)?.forEach(edge => queue.push(edge.target))
  }
  for (const node of flowCanvasNodes.value) {
    if (triggers.length > 0 && !reachable.has(node.id)) {
      invalidNodes.add(node.id)
      errors.push(`O nó "${node.data.label}" não é alcançável a partir do início.`)
    }
  }
  flowValidationErrors.value = [...new Set(errors)]
  invalidFlowNodeIds.value = [...invalidNodes]
  invalidFlowEdgeIds.value = [...invalidEdges]
  flowCanvasNodes.value = flowCanvasNodes.value.map(node => ({ ...node, data: { ...node.data, invalid: invalidNodes.has(node.id) } }))
  flowCanvasEdges.value = flowCanvasEdges.value.map(edge => ({ ...edge, class: invalidEdges.has(edge.id) ? 'flow-edge-invalid' : '' }))
}

function selectCanvasNode(event: { node: Node }) {
  selectedFlowNodeId.value = event.node.id
  flowCanvasNodes.value = flowCanvasNodes.value.map(node => ({ ...node, data: { ...node.data, selected: node.id === event.node.id } }))
}

function updateCanvasNodes(nodes: Node[]) {
  for (const canvasNode of nodes) {
    const flowNode = flowNodes.value.find(node => node.id === canvasNode.id)
    if (flowNode) flowNode.position = canvasNode.position
  }
}

function onNodesChange(changes: Array<{ type: string; id?: string }>) {
  const removedIds = changes.filter(change => change.type === 'remove' && change.id).map(change => change.id!)
  if (removedIds.length === 0) return
  flowNodes.value = flowNodes.value.filter(node => !removedIds.includes(node.id))
  if (removedIds.includes(flowFallbackNodeId.value || '')) flowFallbackNodeId.value = null
  if (removedIds.includes(selectedFlowNodeId.value || '')) selectedFlowNodeId.value = null
}

function onConnect(connection: Connection) {
  if (!connection.source || !connection.target || connection.source === connection.target) return
  if (flowCanvasEdges.value.some(edge => edge.source === connection.source && edge.target === connection.target)) return
  removedFlowEdgeKeys.value.delete(`${connection.source}->${connection.target}`)
  const edge = { id: crypto.randomUUID(), source: connection.source, target: connection.target, type: 'smoothstep' as const }
  flowCanvasEdges.value.push(edge)
  flowEdgeKeysById.value.set(edge.id, `${edge.source}->${edge.target}`)
  validateFlowGraph()
}

function onEdgesChange(changes: Array<{ type: string; id?: string }>) {
  for (const change of changes) {
    if (change.type !== 'remove' || !change.id) continue
    const edgeKey = flowEdgeKeysById.value.get(change.id)
    if (edgeKey) removedFlowEdgeKeys.value.add(edgeKey)
  }
  validateFlowGraph()
}

watch(flowNodes, refreshFlowCanvas, { deep: true })
const logSearch = ref('')
const calendarCursor = ref(new Date())
const selectedDate = ref(dateKey(new Date()))

function loadScheduledItems(): ScheduledItem[] {
  try {
    return JSON.parse(localStorage.getItem('scheduled-items') || '[]') as ScheduledItem[]
  } catch {
    return []
  }
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function monthLabel(date: Date) {
  return date.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
}

const calendarDays = computed(() => {
  const first = new Date(calendarCursor.value.getFullYear(), calendarCursor.value.getMonth(), 1)
  const start = new Date(first)
  start.setDate(first.getDate() - ((first.getDay() + 6) % 7))
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start)
    date.setDate(start.getDate() + index)
    return { date, key: dateKey(date), currentMonth: date.getMonth() === calendarCursor.value.getMonth() }
  })
})

const selectedScheduledItems = computed(() => scheduledItems.value.filter(item => dateKey(new Date(item.at)) === selectedDate.value))
const filteredAutomationLogs = computed(() => {
  const query = logSearch.value.trim().toLocaleLowerCase()
  if (!query) return automationLogs.value
  return automationLogs.value.filter(log => [log.conversation, log.detail, log.status, log.at].join(' ').toLocaleLowerCase().includes(query))
})

function moveCalendar(months: number) {
  calendarCursor.value = new Date(calendarCursor.value.getFullYear(), calendarCursor.value.getMonth() + months, 1)
}

function scheduledCount(key: string) {
  return scheduledItems.value.filter(item => dateKey(new Date(item.at)) === key).length
}

function saveAutomation() {
  localStorage.setItem('auto-reply-enabled', String(autoReplyEnabled.value))
  localStorage.setItem('auto-reply-text', autoReplyText.value)
  localStorage.setItem('auto-reply-rules', JSON.stringify(automaticReplies.value))
  void api.app.setInstagramAutomation(autoReplyEnabled.value, autoReplyText.value, automaticReplies.value.map(reply => ({ message: reply.message, start: reply.start, end: reply.end })))
}

function loadAutomaticReplies(): AutomaticReply[] {
  try {
    const saved = JSON.parse(localStorage.getItem('auto-reply-rules') || '[]') as AutomaticReply[]
    return Array.isArray(saved) ? saved : []
  } catch {
    return []
  }
}

async function loadDashboard() {
  try {
    const [unread, instagramCounts, whatsappUnread, automationStatus] = await Promise.all([
      api.app.getUnreadCount(),
      api.app.getInstagramCounts(),
      api.app.getWhatsAppUnreadCount(),
      api.app.getAutomationStatus()
    ])
    dashboardUnread.value = unread
    dashboardInstagramCounts.value = instagramCounts
    dashboardWhatsAppUnread.value = whatsappUnread
    dashboardAutomationStatus.value = automationStatus
  } catch (error) {
    console.error('[DASHBOARD] Falha ao carregar métricas', error)
  }
}

function addAutomaticReply() {
  automaticReplies.value.push({ id: crypto.randomUUID(), message: '', start: '', end: '' })
}

function removeAutomaticReply(id: string) {
  automaticReplies.value = automaticReplies.value.filter(reply => reply.id !== id)
  saveAutomation()
}

function automaticReplyHasConflict(index: number) {
  const current = automaticReplies.value[index]
  if (!current.start || !current.end) return false
  const toMinutes = (value: string) => {
    const [hours, minutes] = value.split(':').map(Number)
    return hours * 60 + minutes
  }
  const ranges = (reply: AutomaticReply) => {
    const start = toMinutes(reply.start)
    const end = toMinutes(reply.end)
    if (start === end) return [[0, 1440]]
    return start < end ? [[start, end]] : [[start, 1440], [0, end]]
  }
  return automaticReplies.value.some((reply, otherIndex) => otherIndex !== index && reply.start && reply.end && ranges(current).some(first => ranges(reply).some(second => first[0] < second[1] && second[0] < first[1])))
}

async function saveScheduledMessage() {
  localStorage.setItem('scheduled-message', scheduledMessage.value)
  localStorage.setItem('scheduled-at', scheduledAt.value)
  if (!scheduledMessage.value.trim() || !scheduledAt.value) return

  const item: ScheduledItem = {
    id: selectedScheduledId.value || crypto.randomUUID(),
    message: scheduledMessage.value.trim(),
    at: scheduledAt.value,
    createdAt: new Date().toISOString()
  }
  await api.app.createScheduledMessage(item)
  scheduledItems.value = await api.app.getScheduledMessages()
  scheduledMessage.value = ''
  scheduledAt.value = ''
  localStorage.removeItem('scheduled-message')
  localStorage.removeItem('scheduled-at')
  selectedScheduledId.value = null
}

function removeScheduledItem(id: string) {
  scheduledItems.value = scheduledItems.value.filter(item => item.id !== id)
  void api.app.deleteScheduledMessage(id)
}

function clearAutomationLogs() {
  void api.app.clearAutomationLogs()
  automationLogs.value = []
}

function addDebugLog(level: string, args: any[]) {
  if (dialogType !== 'logs') return
  debugLogs.value.unshift({ id: crypto.randomUUID(), at: new Date().toISOString(), level, message: args.map(value => typeof value === 'string' ? value : JSON.stringify(value)).join(' ') })
  if (debugLogs.value.length > 300) debugLogs.value.length = 300
}

function clearVisibleLogs() {
  if (logMode.value === 'automation') clearAutomationLogs()
  else debugLogs.value = []
}

async function resetAutomationRuntime() {
  if (!window.confirm('Resetar estados e IDs processados da automação? Fluxos e agendamentos serão preservados.')) return
  await api.app.resetAutomationRuntime()
  debugLogs.value.unshift({ id: crypto.randomUUID(), at: new Date().toISOString(), level: 'log', message: 'Runtime da automação resetado' })
}

async function loadAutomationFlows() {
  automationFlows.value = await api.app.getAutomationFlows()
}

async function loadContacts() {
  contacts.value = await api.app.getContacts()
  if (selectedContactId.value && contacts.value.some(contact => contact.id === selectedContactId.value)) await selectContact(selectedContactId.value)
}

async function selectContact(contactId: string) {
  selectedContactId.value = contactId
  const history = await api.app.getContactHistory(contactId)
  selectedContact.value = history.contact || null
  contactEvents.value = history.events
}

function selectFlow(flow: AutomationFlow) {
  selectedFlowId.value = flow.id
  removedFlowEdgeKeys.value = new Set()
  flowName.value = flow.name
  try {
    const definition = JSON.parse(flow.definition) as { nodes?: FlowNode[]; edges?: Array<{ from: string; to: string; type?: string }>; fallbackNodeId?: string | null; fallbackPolicy?: { behavior?: 'human' | 'restart' | 'infinite' }; trigger?: { keywords?: string[] }; actions?: Array<{ type?: string; text?: string }> }
    flowKeywords.value = (definition.trigger?.keywords || []).join(', ')
    flowResponse.value = definition.actions?.find(action => action.type === 'reply')?.text || ''
    flowCanvasEdges.value = (definition.edges || []).map(edge => ({ id: crypto.randomUUID(), source: edge.from, target: edge.to, type: 'smoothstep', label: edge.type === 'fallback' ? 'fallback' : undefined }))
    flowNodes.value = definition.nodes || [
      { id: crypto.randomUUID(), type: 'trigger', title: 'Mensagem recebida', keywords: flowKeywords.value, text: '' },
      { id: crypto.randomUUID(), type: 'message', title: 'Resposta', keywords: '', text: flowResponse.value }
    ]
    flowFallbackNodeId.value = definition.fallbackNodeId || null
    flowFallbackBehavior.value = definition.fallbackPolicy?.behavior || 'human'
  } catch {
    flowKeywords.value = ''
    flowResponse.value = ''
    flowNodes.value = []
    flowFallbackNodeId.value = null
    flowFallbackBehavior.value = 'human'
  }
}

function newFlow() {
  selectedFlowId.value = null
  flowName.value = ''
  flowKeywords.value = ''
  flowResponse.value = ''
  flowCanvasEdges.value = []
  removedFlowEdgeKeys.value = new Set()
  flowEdgeKeysById.value = new Map()
  flowValidationErrors.value = []
  flowNodes.value = [
    { id: crypto.randomUUID(), type: 'trigger', title: 'Mensagem recebida', keywords: '', text: '' }
  ]
  flowFallbackNodeId.value = null
  flowFallbackBehavior.value = 'human'
}

function findFreeNodePosition(sourceNode: FlowNode) {
  if (!sourceNode.position) return undefined
  const occupied = flowNodes.value.filter(node => node.position && node.id !== sourceNode.id)
  const horizontalOffsets = [0, 220, -220, 440, -440, 660, -660]
  for (let row = 0; row < 50; row += 1) {
    for (const offset of horizontalOffsets) {
      const position = { x: sourceNode.position.x + offset, y: sourceNode.position.y + 190 + row * 120 }
      const collides = occupied.some(node => Math.abs(node.position!.x - position.x) < 190 && Math.abs(node.position!.y - position.y) < 100)
      if (!collides) return position
    }
  }
  return { x: sourceNode.position.x, y: sourceNode.position.y + 190 }
}

function addFlowNode(type: FlowNode['type']) {
  const sourceId = selectedFlowNodeId.value
  const sourceNode = sourceId ? flowNodes.value.find(item => item.id === sourceId) : null
  const node = { id: crypto.randomUUID(), type, title: type === 'condition' ? 'Condição' : type === 'message' ? 'Mensagem' : type === 'fallback' ? 'Fallback' : type === 'end' ? 'Fim' : 'Gatilho', keywords: '', text: '', position: sourceNode ? findFreeNodePosition(sourceNode) : undefined } satisfies FlowNode
  flowNodes.value.push(node)
  if (sourceId) void nextTick().then(() => {
    flowCanvasEdges.value = flowCanvasEdges.value.filter(edge => edge.target !== node.id)
    onConnect({ source: sourceId, target: node.id })
  })
}

function removeFlowNode(id: string) {
  flowNodes.value = flowNodes.value.filter(node => node.id !== id)
  if (flowFallbackNodeId.value === id) flowFallbackNodeId.value = null
}

function addConditionAfter(nodeId: string) {
  const index = flowNodes.value.findIndex(node => node.id === nodeId)
  if (index < 0) return
  flowNodes.value.splice(index + 1, 0, { id: crypto.randomUUID(), type: 'condition', title: 'Condição', keywords: '', text: '' })
}

function addMessageAfterCondition(conditionId: string) {
  if (flowNodes.value.some(node => node.parentId === conditionId && node.type === 'message')) return
  const index = flowNodes.value.findIndex(node => node.id === conditionId)
  flowNodes.value.splice(index + 1, 0, { id: crypto.randomUUID(), type: 'message', title: 'Processo da condição', keywords: '', text: '', parentId: conditionId })
}

function addFallbackFromNode() {
  const existing = flowNodes.value.find(node => node.type === 'fallback')
  if (existing) {
    flowFallbackNodeId.value = existing.id
    return
  }
  const fallback: FlowNode = { id: crypto.randomUUID(), type: 'fallback', title: 'Fallback', keywords: '', text: '' }
  flowNodes.value.push(fallback)
  flowFallbackNodeId.value = fallback.id
}

function changeFlowZoom(delta: number) {
  flowZoom.value = Math.max(.65, Math.min(1.4, Number((flowZoom.value + delta).toFixed(2))))
}

async function saveAutomationFlow() {
  const triggerNode = flowNodes.value.find(node => node.type === 'trigger') || mainFlowNodes.value[0]
  const responseNode = flowNodes.value.find(node => node.type === 'message' && node.text.trim()) || flowNodes.value.find(node => node.type === 'message')
  const responseText = (responseNode?.text || flowResponse.value).trim()
  const fallbackNode = flowNodes.value.find(node => node.id === flowFallbackNodeId.value) || flowNodes.value.find(node => node.type === 'fallback')
  if (!flowName.value.trim()) return
  await api.app.saveAutomationFlow({
    id: selectedFlowId.value || crypto.randomUUID(),
    name: flowName.value.trim(),
    enabled: true,
    priority: 0,
    definition: JSON.stringify({
      nodes: flowNodes.value,
      edges: flowCanvasEdges.value.map(edge => ({ from: edge.source, to: edge.target, type: edge.label || 'next' })),
      fallbackNodeId: flowFallbackNodeId.value || fallbackNode?.id || null,
      fallbackPolicy: { behavior: flowFallbackBehavior.value, maxLocalAttempts: 1 },
      trigger: { type: 'keywords', keywords: (triggerNode?.keywords || flowKeywords.value).split(',').map(keyword => keyword.trim()).filter(Boolean) },
      actions: [{ type: 'reply', text: responseText }]
    }),
    createdAt: new Date().toISOString()
  })
  newFlow()
  await loadAutomationFlows()
}

async function removeAutomationFlow(id: string) {
  await api.app.deleteAutomationFlow(id)
  await loadAutomationFlows()
}

function selectScheduled(item: ScheduledItem) {
  selectedScheduledId.value = item.id
  scheduledMessage.value = item.message
  scheduledAt.value = item.at
}

function newScheduled() {
  selectedScheduledId.value = null
  scheduledMessage.value = ''
  scheduledAt.value = ''
}

onMounted(() => {
  window.addEventListener('keydown', handleGlobalKeydown)
  void api.app.setInstagramAutomation(autoReplyEnabled.value, autoReplyText.value, automaticReplies.value.map(reply => ({ message: reply.message, start: reply.start, end: reply.end })))
  void api.app.getScheduledMessages().then(async stored => {
    if (stored.length === 0 && scheduledItems.value.length > 0) {
      await Promise.all(scheduledItems.value.map(item => api.app.createScheduledMessage(item)))
      localStorage.removeItem('scheduled-items')
    }
    scheduledItems.value = await api.app.getScheduledMessages()
  })
  if (dialogType === 'logs') {
    void api.app.getAutomationLogs().then(logs => { automationLogs.value = logs })
  }
   if (dialogType === 'automation') void loadAutomationFlows()
   if (dialogType === 'contacts') void loadContacts()
  if (dialogType === 'dashboard') void loadDashboard()
  if (dialogType === 'dashboard') dashboardRefreshTimer = setInterval(() => void loadDashboard(), 5000)
  api.onEvent('app:automation-logs', (logs: AutomationLog[]) => {
    automationLogs.value = logs
  })
  api.onEvent('debug:log', (...args: any[]) => {
    addDebugLog('log', args)
    console.log('%c[DEBUG]', 'color:#00e676;font-weight:bold', ...args)
  })

  api.onEvent('debug:error', (...args: any[]) => {
    addDebugLog('error', args)
    console.error('%c[DEBUG]', 'color:#ff5252;font-weight:bold', ...args)
  })

  api.onEvent('debug:network-error', (...args: any[]) => {
    addDebugLog('network', args)
    console.error('%c[NETWORK]', 'color:#ff9800;font-weight:bold', ...args)
  })

  api.onEvent('debug:render-error', (...args: any[]) => {
    addDebugLog('render', args)
    console.error('%c[RENDER]', 'color:#e040fb;font-weight:bold', ...args)
  })

  api.onEvent('debug:ipc', (data: { channel: string; direction: string; data?: any; tag: string }) => {
    addDebugLog('ipc', [data.tag, data.data ?? ''])
    const colors: Record<string, string> = { send: '#64b5f6', result: '#81c784', error: '#ff5252' }
    console.log(`%c${data.tag}`, `color:${colors[data.direction] || '#888'};font-weight:bold`, data.data ?? '')
  })
})

onUnmounted(() => {
  if (dashboardRefreshTimer) clearInterval(dashboardRefreshTimer)
  dashboardRefreshTimer = null
  window.removeEventListener('keydown', handleGlobalKeydown)
  const api = window.electronAPI
  api.removeListener('debug:log')
  api.removeListener('debug:error')
  api.removeListener('debug:network-error')
  api.removeListener('debug:render-error')
  api.removeListener('debug:ipc')
  api.removeListener('app:automation-logs')
})

function handleGlobalKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && flowFullscreen.value) flowFullscreen.value = false
}
</script>

<template>
  <InstagramHeader v-if="isInstagramHeader" />
  <div v-else-if="dialogType" class="dialog-shell">
    <div class="window-drag-region" aria-hidden="true" />
    <header class="dialog-header">
      <div>
        <span class="eyebrow">GESTÃO DE MENSAGENS</span>
       <h1>{{ dialogType === 'dashboard' ? 'Dashboard' : dialogType === 'automation' ? 'Automações' : dialogType === 'logs' ? 'Logs de automação' : dialogType === 'contacts' ? 'Contatos' : 'Agendamentos' }}</h1>
      </div>
      <button class="close-btn" title="Fechar" @click="api.app.closeDialog">×</button>
    </header>
    <div class="dialog-content">
        <section v-if="dialogType === 'contacts'" class="contacts-page">
          <div class="contacts-layout">
            <aside class="contacts-list">
              <div class="contacts-heading"><div><span class="eyebrow">BASE DE CLIENTES</span><h2>Contatos</h2></div><button class="secondary-action" @click="loadContacts">Atualizar</button></div>
              <button v-for="contact in contacts" :key="contact.id" class="contact-list-item" :class="{ active: selectedContactId === contact.id }" @click="selectContact(contact.id)">
                <img v-if="contact.profilePicUrl" :src="contact.profilePicUrl" alt="" />
                <span v-else class="contact-avatar">{{ (contact.fullName || contact.username || '?').slice(0, 1).toUpperCase() }}</span>
                <span><strong>{{ contact.fullName || contact.username || contact.externalId }}</strong><small>{{ contact.platform }} · {{ contact.conversationCount || 0 }} conversa{{ contact.conversationCount === 1 ? '' : 's' }}</small></span>
              </button>
              <p v-if="contacts.length === 0" class="empty-state">Nenhum contato capturado ainda.</p>
            </aside>
            <section class="contact-detail">
              <template v-if="selectedContact">
                <div class="contact-detail-heading">
                  <div><span class="eyebrow">PERFIL</span><h2>{{ selectedContact.fullName || selectedContact.username || selectedContact.externalId }}</h2><p>{{ selectedContact.username ? `@${selectedContact.username}` : selectedContact.externalId }} · {{ selectedContact.platform }}</p></div>
                  <img v-if="selectedContact.profilePicUrl" :src="selectedContact.profilePicUrl" alt="" />
                </div>
                <div class="contact-meta"><span>ID externo<strong>{{ selectedContact.externalId }}</strong></span><span>Última atividade<strong>{{ selectedContact.lastSeenAt ? new Date(selectedContact.lastSeenAt).toLocaleString('pt-BR') : 'Ainda não registrada' }}</strong></span></div>
                <div class="contact-events"><h3>Histórico e eventos</h3><p v-if="contactEvents.length === 0" class="empty-state">Nenhum evento registrado.</p><article v-for="event in contactEvents" :key="event.id" class="contact-event"><span class="contact-event-dot" :class="event.direction" /><div><strong>{{ event.eventType }}</strong><p>{{ event.content || 'Evento sem conteúdo' }}</p><small>{{ new Date(event.occurredAt).toLocaleString('pt-BR') }} · {{ event.conversationId }}</small></div></article></div>
              </template>
              <p v-else class="empty-state">Selecione um contato para ver o histórico.</p>
            </section>
          </div>
        </section>
        <section v-else-if="dialogType === 'dashboard'" class="dashboard-page">
         <div class="dashboard-heading"><div><span class="eyebrow">VISÃO GERAL</span><h2>Resumo da operação</h2><p>Indicadores atuais das suas plataformas e automações.</p></div><button class="secondary-action" @click="loadDashboard">Atualizar</button></div>
         <div class="dashboard-cards">
           <article class="dashboard-card dashboard-card-highlight"><span class="dashboard-card-label">Não lidas</span><strong>{{ dashboardUnread }}</strong><small>Instagram + WhatsApp</small></article>
           <article class="dashboard-card"><span class="dashboard-card-label">Instagram</span><strong>{{ dashboardInstagramCounts.inbox }}</strong><small>{{ dashboardInstagramCounts.requests }} solicitações · {{ dashboardInstagramCounts.hidden }} ocultas</small></article>
           <article class="dashboard-card"><span class="dashboard-card-label">WhatsApp</span><strong>{{ dashboardWhatsAppUnread }}</strong><small>Conversas não lidas</small></article>
           <article class="dashboard-card"><span class="dashboard-card-label">Automação</span><strong>{{ dashboardAutomationStatus.enabled ? 'Ativa' : 'Inativa' }}</strong><small>{{ dashboardAutomationStatus.running ? 'Processando agora' : dashboardAutomationStatus.configured ? 'Configurada' : 'Sem configuração' }}</small></article>
         </div>
         <div class="dashboard-grid">
           <section class="dashboard-panel"><div class="dashboard-panel-heading"><div><h3>Relatórios de vendas</h3><p>Acompanhe pedidos, faturamento e conversão.</p></div><span class="dashboard-panel-icon">$</span></div><div class="dashboard-empty"><strong>Relatórios ainda não configurados</strong><span>Conecte uma fonte de vendas para começar a acompanhar seus resultados.</span></div></section>
           <section class="dashboard-panel"><div class="dashboard-panel-heading"><div><h3>Distribuição de conversas</h3><p>Volume atual por área do Instagram.</p></div><span class="dashboard-panel-icon">◌</span></div><div class="dashboard-bars"><div><span>Conversas</span><strong>{{ dashboardInstagramCounts.inbox }}</strong><i><b :style="{ width: `${Math.min(100, dashboardInstagramCounts.inbox * 10)}%` }" /></i></div><div><span>Solicitações</span><strong>{{ dashboardInstagramCounts.requests }}</strong><i><b :style="{ width: `${Math.min(100, dashboardInstagramCounts.requests * 10)}%` }" /></i></div><div><span>Ocultas</span><strong>{{ dashboardInstagramCounts.hidden }}</strong><i><b :style="{ width: `${Math.min(100, dashboardInstagramCounts.hidden * 10)}%` }" /></i></div></div></section>
         </div>
       </section>
       <section v-else-if="dialogType === 'automation'" class="settings-page">
        <nav class="automation-tabs">
          <button :class="{ active: automationTab === 'reply' }" @click="automationTab = 'reply'">Mensagens automáticas</button>
          <button :class="{ active: automationTab === 'flows' }" @click="automationTab = 'flows'">Fluxos</button>
          <button :class="{ active: automationTab === 'scheduled' }" @click="automationTab = 'scheduled'">Agendamentos</button>
        </nav>

         <div v-if="automationTab === 'reply'" class="automation-workspace automation-workspace-full">
           <section class="automation-editor automation-editor-full">
             <div class="section-heading"><span class="section-icon">✦</span><div><h2>Mensagens automáticas</h2><p>Escolha a mensagem conforme o horário do dia.</p></div></div>
             <div class="settings-card">
               <label class="switch-row automation-switch"><input v-model="autoReplyEnabled" class="automation-switch-input" type="checkbox" @change="saveAutomation" /><span class="automation-switch-track"><span /></span><span>Ativar resposta padrão</span></label>
               <label>Resposta sem horário específico<textarea v-model="autoReplyText" rows="3" placeholder="Usada quando nenhuma mensagem por horário se aplicar." @blur="saveAutomation" /></label>
               <div class="automatic-replies-header"><strong>Mensagens por período</strong><button class="secondary-action" @click="addAutomaticReply">Adicionar Mensagem por Horário</button></div>
               <div v-for="(reply, index) in automaticReplies" :key="reply.id" class="automatic-reply-card" :class="{ conflict: automaticReplyHasConflict(index) }">
                 <textarea v-model="reply.message" rows="3" placeholder="Ex.: Estamos indisponíveis no momento." @blur="saveAutomation" />
                 <div class="automatic-reply-times"><label>Início<input v-model="reply.start" type="time" @change="saveAutomation" /></label><label>Fim<input v-model="reply.end" type="time" @change="saveAutomation" /></label><button class="remove-reply-btn" title="Remover mensagem" @click="removeAutomaticReply(reply.id)">×</button></div>
                 <span v-if="automaticReplyHasConflict(index)" class="automatic-reply-conflict">Este período conflita com outra mensagem.</span>
               </div>
               <p v-if="automaticReplies.length === 0" class="hint">Adicione períodos como 23:00 → 09:00 ou 11:00 → 13:00.</p>
               <p class="hint">A execução respeita o switch global do header e as proteções contra grupos.</p>
             </div>
           </section>
         </div>

        <div v-else-if="automationTab === 'flows'" class="automation-workspace">
          <aside class="automation-list">
            <button class="new-item-btn" @click="newFlow">+ Novo fluxo</button>
            <button v-for="flow in automationFlows" :key="flow.id" class="automation-list-item" :class="{ active: selectedFlowId === flow.id }" @click="selectFlow(flow)"><strong>{{ flow.name }}</strong><span>{{ flow.enabled ? 'Ativo' : 'Desativado' }}</span></button>
            <p v-if="automationFlows.length === 0" class="list-empty">Nenhum fluxo criado.</p>
          </aside>
          <section class="automation-editor">
            <div class="section-heading"><span class="section-icon">⌁</span><div><h2>{{ selectedFlowId ? 'Editar fluxo' : 'Novo fluxo' }}</h2><p>Monte o caminho da conversa e defina um fallback.</p></div></div>
            <div class="settings-card flow-builder">
              <label class="flow-name-field">Nome do fluxo<input v-model="flowName" class="flow-name-input" type="text" placeholder="Ex.: Interesse em produto" /></label>
               <div class="flow-node-actions"><button class="secondary-action" @click="addFlowNode('trigger')">+ Gatilho</button><button class="secondary-action" @click="addFlowNode('message')">+ Mensagem</button><button class="secondary-action" @click="addFlowNode('condition')">+ Condição</button><button class="secondary-action" @click="addFlowNode('end')">+ Fim</button><button class="secondary-action" @click="addFallbackFromNode">+ Fallback</button></div>
              <div class="flow-visual" :class="{ 'flow-visual-fullscreen': flowFullscreen }">
                <div class="flow-canvas-tools"><span>Arraste os nós para organizar o fluxo</span><button @click="flowFullscreen = !flowFullscreen">{{ flowFullscreen ? 'Sair da tela cheia' : 'Tela cheia' }}</button></div>
                <div class="flow-canvas vue-flow-canvas">
                  <VueFlow v-model:nodes="flowCanvasNodes" v-model:edges="flowCanvasEdges" :node-types="flowNodeTypes" :delete-key-code="['Backspace', 'Delete']" fit-view-on-init :min-zoom="0.2" :max-zoom="2" edges-updatable @node-click="selectCanvasNode" @update:nodes="updateCanvasNodes" @nodes-change="onNodesChange" @connect="onConnect" @edges-change="onEdgesChange">
                    <Background pattern-color="#334155" :gap="24" />
                    <Controls />
                    <MiniMap />
                  </VueFlow>
                </div>
              </div>
              <div v-if="flowValidationErrors.length" class="flow-validation" role="alert">
                <strong>Fluxo precisa de ajustes</strong>
                <span v-for="error in flowValidationErrors" :key="error">{{ error }}</span>
              </div>
              <div v-if="selectedFlowNode" class="node-properties">
                <strong>Propriedades: {{ selectedFlowNode.title }}</strong>
                <select v-model="selectedFlowNode.type"><option value="trigger">Gatilho</option><option value="message">Mensagem</option><option value="condition">Condição</option><option value="fallback">Fallback</option><option value="end">Fim</option></select>
                <input v-model="selectedFlowNode.title" type="text" placeholder="Nome do nó" />
                <input v-if="selectedFlowNode.type === 'trigger' || selectedFlowNode.type === 'condition'" v-model="selectedFlowNode.keywords" type="text" placeholder="Palavras-chave" />
                <textarea v-if="selectedFlowNode.type === 'message' || selectedFlowNode.type === 'fallback'" v-model="selectedFlowNode.text" rows="3" placeholder="Mensagem ou processo" />
                <button class="secondary-action" @click="removeFlowNode(selectedFlowNode.id); selectedFlowNodeId = null">Remover nó</button>
              </div>
              <div class="legacy-flow-editor">
              <div class="flow-canvas-tools"><button @click="changeFlowZoom(-.1)">−</button><span>{{ Math.round(flowZoom * 100) }}%</span><button @click="changeFlowZoom(.1)">+</button><button @click="flowZoom = 1">Resetar</button></div>
              <div class="flow-canvas" :style="{ zoom: flowZoom }">
                <template v-for="(row, rowIndex) in flowRows" :key="row.nodes[0].id">
                  <div v-if="row.type === 'conditions'" class="flow-condition-row">
                    <template v-for="node in row.nodes" :key="node.id">
                      <div class="flow-condition-branch">
                        <article class="flow-node node-condition">
                          <div class="flow-node-header"><strong>{{ node.title }}</strong><button title="Remover nó" @click="removeFlowNode(node.id)">×</button></div>
                          <input v-model="node.title" type="text" placeholder="Nome da condição" />
                          <input v-model="node.keywords" type="text" placeholder="Palavras-chave" />
                          <button class="branch-message-btn" @click="addMessageAfterCondition(node.id)">+ Mensagem / processo</button>
                        </article>
                        <button class="flow-plus flow-plus-right" title="Ramificação futura" disabled>+</button>
                        <div v-if="conditionChildren[node.id]" class="condition-child">
                          <span class="condition-child-arrow">↓</span>
                          <article class="flow-node node-message">
                            <div class="flow-node-header"><strong>{{ conditionChildren[node.id].title }}</strong><button title="Remover processo" @click="removeFlowNode(conditionChildren[node.id].id)">×</button></div>
                            <input v-model="conditionChildren[node.id].title" type="text" placeholder="Nome do processo" />
                            <textarea v-model="conditionChildren[node.id].text" rows="3" placeholder="Mensagem ou processo" />
                          </article>
                          <button class="branch-fallback-btn" title="Adicionar fallback para este processo" @click="addFallbackFromNode">+ fallback</button>
                        </div>
                      </div>
                    </template>
                  </div>
                  <div v-else class="flow-node-wrap">
                    <button class="flow-plus flow-plus-left" title="Adicionar fallback" @click="addFallbackFromNode">+</button>
                    <article class="flow-node" :class="`node-${row.nodes[0].type}`">
                      <div class="flow-node-header"><strong>{{ row.nodes[0].title }}</strong><button title="Remover nó" @click="removeFlowNode(row.nodes[0].id)">×</button></div>
                      <select v-model="row.nodes[0].type"><option value="trigger">Gatilho</option><option value="message">Mensagem</option><option value="end">Fim</option></select>
                      <input v-model="row.nodes[0].title" type="text" placeholder="Nome do nó" />
                      <input v-if="row.nodes[0].type === 'trigger' || (row.nodes[0].type === 'message' && rowIndex === 0)" v-model="row.nodes[0].keywords" type="text" placeholder="Palavras-chave de entrada" />
                      <textarea v-if="row.nodes[0].type === 'message'" v-model="row.nodes[0].text" rows="3" placeholder="Texto da mensagem" />
                    </article>
                    <button class="flow-plus flow-plus-right" title="Ramificação futura" disabled>+</button>
                    <button class="flow-plus flow-plus-down" title="Adicionar condição abaixo" @click="addConditionAfter(row.nodes[0].id)">+</button>
                  </div>
                  <div v-if="rowIndex < flowRows.length - 1" class="flow-arrow">↓</div>
                </template>
                <p v-if="mainFlowNodes.length === 0" class="list-empty">Adicione o primeiro nó ao fluxo.</p>
                <div v-if="fallbackFlowNode" class="flow-fallback-branch">
                  <span class="flow-fallback-arrow">→</span>
                  <article class="flow-node node-fallback">
                    <div class="flow-node-header"><strong>{{ fallbackFlowNode.title }}</strong><button title="Remover nó" @click="removeFlowNode(fallbackFlowNode.id)">×</button></div>
                    <select v-model="fallbackFlowNode.type"><option value="fallback">Fallback</option></select>
                    <input v-model="fallbackFlowNode.title" type="text" placeholder="Nome do fallback" />
                    <textarea v-model="fallbackFlowNode.text" rows="3" placeholder="Resposta fallback" />
                  </article>
                </div>
              </div>
              </div>
              <label>Fallback do fluxo<select v-model="flowFallbackNodeId"><option :value="null">Nenhum fallback</option><option v-for="node in flowNodes.filter(node => node.type === 'fallback')" :key="node.id" :value="node.id">{{ node.title }}</option></select></label>
              <label>Após falha do fallback geral<select v-model="flowFallbackBehavior"><option value="human">Encaminhar para atendimento humano</option><option value="restart">Reiniciar o fluxo uma vez</option><option value="infinite">Continuar em novas mensagens</option></select></label>
              <div class="editor-actions"><button class="primary-action" @click="saveAutomationFlow">Salvar fluxo</button><button v-if="selectedFlowId" class="secondary-action" @click="newFlow">Cancelar edição</button></div>
            </div>
          </section>
        </div>

        <div v-else class="automation-workspace">
          <aside class="automation-list">
            <button class="new-item-btn" @click="newScheduled">+ Novo agendamento</button>
            <button v-for="item in scheduledItems" :key="item.id" class="automation-list-item" :class="{ active: selectedScheduledId === item.id }" @click="selectScheduled(item)"><strong>{{ item.message }}</strong><span>{{ new Date(item.at).toLocaleString('pt-BR') }}</span></button>
            <p v-if="scheduledItems.length === 0" class="list-empty">Nenhum agendamento criado.</p>
          </aside>
          <section class="automation-editor">
            <div class="section-heading"><span class="section-icon">◷</span><div><h2>{{ selectedScheduledId ? 'Editar agendamento' : 'Novo agendamento' }}</h2><p>Defina a mensagem e o horário da execução.</p></div></div>
            <div class="settings-card">
              <label>Mensagem<textarea v-model="scheduledMessage" rows="6" placeholder="Digite a mensagem que será enviada..." /></label>
              <label>Data e horário<input v-model="scheduledAt" type="datetime-local" /></label>
              <div class="editor-actions"><button class="primary-action" @click="saveScheduledMessage">Salvar programação</button><button v-if="selectedScheduledId" class="secondary-action" @click="newScheduled">Cancelar edição</button></div>
            </div>
          </section>
        </div>
      </section>
      <section v-else-if="dialogType === 'logs'" class="settings-page logs-page">
        <div class="logs-toolbar">
          <input v-model="logSearch" class="logs-search" type="search" placeholder="Buscar nos logs..." aria-label="Buscar nos logs" />
          <div class="logs-mode-switch">
            <button :class="{ active: logMode === 'automation' }" @click="logMode = 'automation'">Normais</button>
            <button :class="{ active: logMode === 'debug' }" @click="logMode = 'debug'">DevLogs</button>
          </div>
          <button class="clear-logs-btn" title="Preserva fluxos e agendamentos" @click="resetAutomationRuntime">Resetar estado</button>
          <button class="clear-logs-btn" :disabled="(logMode === 'automation' ? automationLogs.length : debugLogs.length) === 0" @click="clearVisibleLogs">Limpar</button>
        </div>
        <p v-if="logMode === 'automation' && automationLogs.length === 0" class="empty-state">Nenhuma operação registrada.</p>
        <p v-else-if="logMode === 'automation' && filteredAutomationLogs.length === 0" class="empty-state">Nenhum log encontrado.</p>
        <p v-else-if="logMode === 'debug' && debugLogs.length === 0" class="empty-state">Nenhum DevLog registrado.</p>
        <div v-else-if="logMode === 'automation'" class="logs-list">
          <article v-for="log in filteredAutomationLogs" :key="log.id" class="log-item">
            <span class="log-status" :class="log.status">{{ log.status === 'sent' ? 'OK' : '!' }}</span>
            <div>
              <strong>{{ log.conversation }}</strong>
              <span>{{ log.detail }} · {{ new Date(log.at).toLocaleString() }}</span>
            </div>
          </article>
        </div>
        <div v-else class="logs-list">
          <article v-for="log in debugLogs" :key="log.id" class="log-item" :class="`debug-${log.level}`">
            <span class="log-status">{{ log.level.slice(0, 3).toUpperCase() }}</span>
            <div><strong>{{ log.level }}</strong><span>{{ log.message }} · {{ new Date(log.at).toLocaleString() }}</span></div>
          </article>
        </div>
      </section>
      <section v-else class="settings-page appointments-page">
        <div class="appointments-layout">
          <div class="calendar-panel">
            <div class="calendar-toolbar">
              <button class="calendar-nav" title="Mês anterior" @click="moveCalendar(-1)">‹</button>
              <strong>{{ monthLabel(calendarCursor) }}</strong>
              <button class="calendar-nav" title="Próximo mês" @click="moveCalendar(1)">›</button>
            </div>
            <div class="calendar-weekdays">
              <span v-for="weekday in ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']" :key="weekday">{{ weekday }}</span>
            </div>
            <div class="calendar-grid">
              <button v-for="day in calendarDays" :key="day.key" class="calendar-day" :class="{ muted: !day.currentMonth, selected: selectedDate === day.key, today: dateKey(new Date()) === day.key }" @click="selectedDate = day.key">
                <span>{{ day.date.getDate() }}</span>
                <i v-if="scheduledCount(day.key) > 0">{{ scheduledCount(day.key) }}</i>
              </button>
            </div>
          </div>
          <div class="selected-appointments">
            <div class="selected-day-heading">
              <strong>{{ new Date(`${selectedDate}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }) }}</strong>
              <span>{{ selectedScheduledItems.length }} agendamento{{ selectedScheduledItems.length === 1 ? '' : 's' }}</span>
            </div>
            <p v-if="selectedScheduledItems.length === 0" class="empty-state">Nenhum agendamento neste dia.</p>
            <div v-else class="appointments-list">
              <article v-for="item in selectedScheduledItems" :key="item.id" class="appointment-item">
                <div>
                  <strong>{{ item.message }}</strong>
                  <span>{{ new Date(item.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) }}</span>
                </div>
                <button class="delete-btn" title="Excluir agendamento" @click="removeScheduledItem(item.id)">×</button>
              </article>
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
  <div v-else class="app">
    <Sidebar />
    <main class="main-content">
      <WebViewsHeader />
    </main>
  </div>
</template>

<style lang="scss">
@use '@shared/styles/base';

.app {
  display: flex;
  height: 100vh;
}

.main-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.dialog-shell { position: relative; display: flex; flex-direction: column; height: 100vh; box-sizing: border-box; background: $bg-primary; color: $text-primary; overflow: hidden; }
.window-drag-region { position: absolute; z-index: 1; top: 0; left: 0; right: 0; height: 52px; -webkit-app-region: drag; cursor: grab; }
.dialog-header { position: relative; z-index: 2; display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; min-height: 76px; padding: 24px 24px 12px; background: $bg-primary; box-shadow: 0 8px 12px $bg-primary; -webkit-app-region: drag; user-select: none; }
.dialog-header:active { cursor: grabbing; }
.dialog-header h1 { margin: 6px 0 0; font-size: 24px; }
.close-btn, .primary-action { border: 0; border-radius: $radius-md; cursor: pointer; font: inherit; -webkit-app-region: no-drag; }
.close-btn { width: 32px; height: 32px; justify-content: center; padding: 0; background: transparent; color: $text-secondary; font-size: 24px; }
.close-btn:hover { background: $bg-hover; color: $text-primary; }
.dialog-content { flex: 1; min-height: 0; overflow-y: auto; padding: 0 24px 24px; scroll-behavior: auto; }
.settings-page { color: $text-primary; overflow: visible; }
.contacts-page { min-height: 100%; color: $text-primary; }
.contacts-layout { display: grid; grid-template-columns: minmax(260px, 34%) minmax(0, 1fr); min-height: 520px; background: $bg-secondary; border: 1px solid $border-color; border-radius: $radius-lg; overflow: hidden; }
.contacts-list { padding: 18px; border-right: 1px solid $border-color; overflow-y: auto; }
.contacts-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; margin-bottom: 14px; }
.contacts-heading h2 { margin: 6px 0 0; font-size: 18px; }
.contacts-heading .secondary-action { padding: 7px 10px; font-size: 11px; }
.contact-list-item { display: flex; align-items: center; gap: 10px; width: 100%; margin-bottom: 5px; border: 1px solid transparent; border-radius: $radius-md; padding: 10px; background: transparent; color: $text-primary; text-align: left; cursor: pointer; font: inherit; }
.contact-list-item:hover { background: $bg-hover; }
.contact-list-item.active { border-color: $accent; background: $bg-accent-18; }
.contact-list-item img, .contact-avatar { display: inline-flex; align-items: center; justify-content: center; width: 38px; height: 38px; flex: 0 0 38px; border-radius: 50%; background: $bg-primary; color: $accent; object-fit: cover; font-weight: 800; }
.contact-list-item > span:last-child { display: grid; gap: 4px; min-width: 0; }
.contact-list-item strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.contact-list-item small { color: $text-muted; font-size: 10px; text-transform: capitalize; }
.contact-detail { min-width: 0; padding: 24px; overflow-y: auto; }
.contact-detail-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding-bottom: 18px; border-bottom: 1px solid $border-color; }
.contact-detail-heading h2 { margin: 6px 0 4px; font-size: 22px; }
.contact-detail-heading p { margin: 0; color: $text-secondary; font-size: 12px; }
.contact-detail-heading img { width: 64px; height: 64px; border-radius: 50%; object-fit: cover; }
.contact-meta { display: flex; flex-wrap: wrap; gap: 28px; padding: 18px 0; border-bottom: 1px solid $border-color; }
.contact-meta span { display: grid; gap: 5px; color: $text-muted; font-size: 10px; text-transform: uppercase; letter-spacing: .7px; }
.contact-meta strong { color: $text-primary; font-size: 12px; text-transform: none; letter-spacing: 0; }
.contact-events { padding-top: 18px; }
.contact-events h3 { margin: 0 0 12px; font-size: 14px; }
.contact-event { display: flex; gap: 10px; padding: 12px 0; border-bottom: 1px solid $border-color; }
.contact-event-dot { width: 8px; height: 8px; flex: 0 0 8px; margin-top: 5px; border-radius: 50%; background: $text-muted; }
.contact-event-dot.inbound { background: #42a5f5; }
.contact-event-dot.outbound { background: $accent; }
.contact-event div { display: grid; gap: 4px; min-width: 0; }
.contact-event strong { font-size: 12px; }
.contact-event p, .contact-event small { margin: 0; color: $text-secondary; font-size: 11px; line-height: 1.4; overflow-wrap: anywhere; }
.contact-event small { color: $text-muted; font-size: 10px; }
.dashboard-page { display: grid; gap: 22px; color: $text-primary; }
.dashboard-heading { display: flex; align-items: end; justify-content: space-between; gap: 16px; }
.dashboard-heading h2 { margin: 6px 0 4px; font-size: 20px; }
.dashboard-heading p { margin: 0; color: $text-secondary; font-size: 12px; }
.dashboard-cards { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
.dashboard-card { display: grid; gap: 8px; min-height: 116px; box-sizing: border-box; padding: 16px; background: $bg-secondary; border: 1px solid $border-color; border-radius: $radius-lg; }
.dashboard-card-highlight { border-color: $accent; background: linear-gradient(145deg, $bg-accent-18, $bg-secondary 65%); }
.dashboard-card-label { color: $text-secondary; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .7px; }
.dashboard-card strong { color: $text-primary; font-size: 25px; line-height: 1; }
.dashboard-card small { color: $text-muted; font-size: 11px; }
.dashboard-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.dashboard-panel { min-height: 250px; padding: 18px; background: $bg-secondary; border: 1px solid $border-color; border-radius: $radius-lg; }
.dashboard-panel-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.dashboard-panel-heading h3 { margin: 0 0 5px; font-size: 14px; }
.dashboard-panel-heading p { margin: 0; color: $text-secondary; font-size: 11px; }
.dashboard-panel-icon { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; border-radius: $radius-md; background: $bg-accent-18; color: $accent; font-weight: 800; }
.dashboard-empty { display: grid; place-items: center; gap: 8px; min-height: 180px; color: $text-muted; text-align: center; }
.dashboard-empty strong { color: $text-secondary; font-size: 12px; }
.dashboard-empty span { max-width: 270px; font-size: 11px; line-height: 1.5; }
.dashboard-bars { display: grid; gap: 20px; margin-top: 30px; }
.dashboard-bars > div { display: grid; grid-template-columns: 1fr auto; gap: 7px 12px; align-items: center; color: $text-secondary; font-size: 11px; }
.dashboard-bars strong { color: $text-primary; font-size: 12px; }
.dashboard-bars i { grid-column: 1 / -1; display: block; height: 7px; overflow: hidden; border-radius: 999px; background: $bg-primary; }
.dashboard-bars b { display: block; height: 100%; min-width: 2px; border-radius: inherit; background: $accent; }
.automation-tabs { display: flex; gap: 4px; margin-bottom: 18px; border-bottom: 1px solid $border-color; }
.automation-tabs button { border: 0; border-bottom: 2px solid transparent; padding: 10px 12px; background: transparent; color: $text-secondary; cursor: pointer; font: inherit; font-size: 12px; font-weight: 700; }
.automation-tabs button.active { border-bottom-color: $accent; color: $accent; }
.automation-workspace { display: flex; align-items: stretch; min-height: 420px; gap: 20px; }
.automation-workspace-full { display: block; }
.automation-list { flex: 0 0 34%; min-width: 0; padding-right: 16px; border-right: 1px solid $border-color; }
.automation-editor { flex: 1 1 auto; min-width: 0; }
.automation-editor-full { width: 100%; }
.flow-fullscreen-btn { margin-left: auto; border: 1px solid $border-input; border-radius: $radius-sm; padding: 7px 10px; background: $bg-secondary; color: $text-secondary; cursor: pointer; font: inherit; font-size: 10px; }
.flow-fullscreen-btn:hover { background: $bg-hover; color: $text-primary; }
.automation-list-item { display: grid; gap: 5px; width: 100%; margin-bottom: 6px; border: 1px solid transparent; border-radius: $radius-md; padding: 12px; background: transparent; color: $text-primary; text-align: left; cursor: pointer; font: inherit; }
.automation-list-item:hover { background: $bg-hover; }
.automation-list-item.active { border-color: $accent; background: $bg-accent-18; }
.automation-list-item strong { overflow-wrap: anywhere; font-size: 12px; }
.automation-list-item span { color: $text-secondary; font-size: 11px; }
.new-item-btn { width: 100%; margin-bottom: 12px; border: 1px dashed $accent; border-radius: $radius-md; padding: 10px; background: transparent; color: $accent; cursor: pointer; font: inherit; font-size: 12px; font-weight: 700; }
.new-item-btn:hover { background: $bg-accent-18; }
.list-empty { color: $text-muted; font-size: 12px; text-align: center; }
.editor-actions { display: flex; align-items: center; gap: 8px; }
.secondary-action { border: 1px solid $border-input; border-radius: $radius-md; padding: 11px 16px; background: transparent; color: $text-secondary; cursor: pointer; font: inherit; font-weight: 700; }
.secondary-action:hover { background: $bg-hover; color: $text-primary; }
.section-heading { display: flex; align-items: flex-start; gap: 12px; margin: 8px 0 12px; }
.section-heading h2 { margin: 0 0 4px; font-size: 16px; }
.section-heading p { margin: 0; color: $text-secondary; font-size: 12px; }
.section-icon { color: $accent; font-size: 20px; line-height: 1; }
.scheduled-heading { margin-top: 28px; }
.eyebrow { color: $accent; font-size: 11px; font-weight: 800; letter-spacing: 1.5px; }
.settings-card { display: grid; gap: 22px; padding: 24px; background: $bg-secondary; border: 1px solid $border-color; border-radius: $radius-lg; }
.flow-name-field { gap: 8px; }
.flow-name-input { width: 100%; box-sizing: border-box; border: 1px solid $border-input; border-radius: $radius-md; padding: 11px 13px; background: $bg-primary; color: $text-primary; font: inherit; font-size: 13px; outline: 0; transition: border-color .15s ease, box-shadow .15s ease; }
.flow-name-input::placeholder { color: $text-muted; }
.flow-name-input:focus { border-color: $accent; box-shadow: 0 0 0 3px $bg-accent-18; }
label { display: grid; gap: 8px; color: $text-primary; font-size: 13px; font-weight: 600; }
textarea, input[type='datetime-local'] { width: 100%; box-sizing: border-box; border: 1px solid $border-input; border-radius: $radius-md; padding: 12px; background: $bg-primary; color: $text-primary; font: inherit; resize: vertical; }
.switch-row { display: flex; align-items: center; gap: 10px; }
.switch-row input { accent-color: $accent; }
.automation-switch { justify-content: flex-start; }
.automation-switch-input { position: absolute; width: 1px; height: 1px; opacity: 0; }
.automation-switch-track { position: relative; display: inline-flex; flex: 0 0 38px; align-items: center; width: 38px; height: 22px; border: 1px solid $border-input; border-radius: 999px; background: $bg-primary; cursor: pointer; transition: background .15s ease, border-color .15s ease; }
.automation-switch-track span { width: 16px; height: 16px; margin-left: 3px; border-radius: 50%; background: $text-muted; transition: transform .15s ease, background .15s ease; }
.automation-switch-input:checked + .automation-switch-track { border-color: $accent; background: $bg-accent-18; }
.automation-switch-input:checked + .automation-switch-track span { background: $accent; transform: translateX(15px); }
.automation-switch-input:focus-visible + .automation-switch-track { box-shadow: 0 0 0 3px $bg-accent-18; }
.hint { margin: 0; color: $text-muted; font-size: 12px; line-height: 1.5; }
.automatic-replies-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.automatic-replies-header strong { font-size: 13px; }
.automatic-reply-card { display: grid; gap: 8px; padding: 12px; border: 1px solid $border-color; border-radius: $radius-md; background: $bg-primary; }
.automatic-reply-card.conflict { border-color: #ef4444; }
.automatic-reply-card textarea, .automatic-reply-card input { width: 100%; box-sizing: border-box; border: 1px solid $border-input; border-radius: $radius-sm; padding: 9px; background: $bg-secondary; color: $text-primary; font: inherit; font-size: 12px; }
.automatic-reply-times { display: flex; align-items: end; gap: 8px; }
.automatic-reply-times label { flex: 1; gap: 5px; font-size: 11px; }
.remove-reply-btn { width: 30px; height: 30px; border: 1px solid $border-input; border-radius: $radius-sm; background: transparent; color: $text-muted; cursor: pointer; font-size: 18px; line-height: 1; }
.remove-reply-btn:hover { border-color: #ef4444; color: #ef4444; }
.automatic-reply-conflict { color: #f87171; font-size: 11px; }
.primary-action { justify-self: start; padding: 11px 16px; background: $accent; color: #07110b; font-weight: 700; }
.flow-builder { margin-bottom: 12px; }
.flow-visual { position: relative; min-width: 0; }
.flow-visual-fullscreen { position: fixed; z-index: 20; inset: 0; display: flex; flex-direction: column; padding: 20px; background: $bg-secondary; border: 0; border-radius: 0; box-shadow: 0 16px 60px rgba(0, 0, 0, .65); }
.flow-visual-fullscreen .vue-flow-canvas { flex: 1; height: auto; min-height: 0; }
.flow-canvas { display: flex; flex-direction: column; align-items: center; max-height: 430px; overflow-y: auto; padding: 4px; background: $bg-primary; border: 1px solid $border-color; border-radius: $radius-md; }
.vue-flow-canvas { display: block; width: 100%; height: 430px; padding: 0; overflow: hidden; }
.legacy-flow-editor { display: none; }
.flow-canvas-tools { display: flex; align-items: center; justify-content: flex-end; gap: 4px; margin: 8px 0; }
.flow-canvas-tools span { margin-right: auto; color: $text-muted; font-size: 11px; }
.vue-flow__controls { display: flex; flex-direction: column; gap: 0; overflow: hidden; border: 1px solid $border-input; border-radius: $radius-md; box-shadow: 0 4px 14px rgba(0, 0, 0, .3); }
.vue-flow__controls-button { display: flex; align-items: center; justify-content: center; width: 26px; height: 26px; border: 0; border-bottom: 1px solid $border-input; padding: 4px; background: $bg-secondary; color: #fff; }
.vue-flow__controls-button:last-child { border-bottom: 0; }
.vue-flow__controls-button svg { width: 14px; height: 14px; fill: #fff; stroke: #fff; }
.flow-canvas-tools button { min-width: 28px; height: 30px; border: 1px solid $border-input; border-radius: $radius-sm; padding: 0 12px; background: $bg-secondary; color: $text-secondary; cursor: pointer; font: inherit; font-size: 11px; }
.flow-canvas-tools button:hover { background: $bg-hover; color: $text-primary; }
.flow-canvas-tools span { min-width: 42px; color: $text-muted; font-size: 10px; text-align: center; }
.flow-builder-fullscreen { position: fixed; z-index: 20; inset: 12px; display: flex; flex-direction: column; margin: 0; overflow: auto; box-shadow: 0 16px 60px rgba(0, 0, 0, .65); }
.flow-builder-fullscreen .flow-canvas { flex: 1; max-height: none; min-height: 0; }
.flow-node { width: min(100%, 360px); box-sizing: border-box; border: 1px solid $border-input; border-left: 3px solid $text-secondary; border-radius: $radius-md; padding: 12px; background: $bg-secondary; }
.flow-node-wrap { position: relative; display: flex; align-items: center; justify-content: center; width: 100%; padding: 0 36px; box-sizing: border-box; }
.flow-condition-row { display: flex; align-items: flex-start; justify-content: center; flex-wrap: wrap; width: 100%; gap: 12px; overflow: visible; padding: 4px 0 18px; }
.flow-condition-branch { position: relative; display: flex; flex: 1 1 180px; flex-direction: column; align-items: center; min-width: 0; max-width: 230px; padding-top: 24px; }
.flow-condition-branch::before { position: absolute; top: 0; left: 50%; color: #ffca28; content: '↓'; font-size: 20px; line-height: 20px; transform: translateX(-50%); }
.flow-condition-branch .flow-node { width: 100%; }
.branch-message-btn { width: 100%; margin-top: 8px; border: 1px dashed #25d366; border-radius: $radius-sm; padding: 7px; background: transparent; color: $accent; cursor: pointer; font: inherit; font-size: 10px; font-weight: 700; }
.branch-message-btn:hover { background: $bg-accent-18; }
.condition-child { display: flex; flex-direction: column; align-items: center; width: 100%; }
.condition-child-arrow { color: $accent; font-size: 18px; line-height: 20px; }
.condition-child .flow-node { max-width: 100%; }
.branch-fallback-btn { margin-top: 6px; border: 0; background: transparent; color: #ab47bc; cursor: pointer; font: inherit; font-size: 10px; font-weight: 700; }
.branch-fallback-btn:hover { text-decoration: underline; }
.flow-plus { position: absolute; z-index: 1; display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border: 1px solid $border-input; border-radius: 50%; background: $bg-secondary; color: $text-secondary; cursor: pointer; font-size: 16px; line-height: 1; }
.flow-plus:hover:not(:disabled) { border-color: $accent; background: $bg-accent-18; color: $accent; }
.flow-plus:disabled { cursor: not-allowed; opacity: .35; }
.flow-plus-left { left: 2px; }
.flow-plus-right { right: 2px; }
.flow-plus-down { bottom: -13px; }
.flow-node.node-trigger { border-left-color: #42a5f5; }
.flow-node.node-message { border-left-color: $accent; }
.flow-node.node-condition { border-left-color: #ffca28; }
.flow-node.node-fallback { border-left-color: #ab47bc; }
.flow-node.node-end { border-left-color: $text-error; }
.flow-node-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
.flow-node-header strong { font-size: 12px; }
.flow-node-header button { border: 0; background: transparent; color: $text-muted; cursor: pointer; font-size: 18px; }
.flow-node select, .flow-node input, .flow-node textarea, .settings-card select { width: 100%; box-sizing: border-box; margin-top: 7px; border: 1px solid $border-input; border-radius: $radius-sm; padding: 8px; background: $bg-primary; color: $text-primary; font: inherit; font-size: 11px; }
.flow-arrow { height: 22px; color: $accent; font-size: 18px; line-height: 22px; }
.flow-fallback-branch { display: flex; align-items: center; align-self: stretch; gap: 10px; margin-top: 12px; padding-left: 50%; }
.flow-fallback-arrow { color: #ab47bc; font-size: 24px; line-height: 1; }
.flow-fallback-branch .flow-node { width: min(100%, 300px); }
.flow-node-actions { display: flex; flex-wrap: wrap; gap: 6px; margin: 12px 0; }
.flow-node-actions .secondary-action { padding: 8px 10px; font-size: 11px; }
.node-properties { display: grid; gap: 8px; padding: 14px; background: $bg-primary; border: 1px solid $border-color; border-radius: $radius-md; }
.node-properties strong { font-size: 12px; }
.node-properties input, .node-properties select, .node-properties textarea { width: 100%; box-sizing: border-box; border: 1px solid $border-input; border-radius: $radius-sm; padding: 8px; background: $bg-secondary; color: $text-primary; font: inherit; font-size: 11px; }
.flow-validation { display: grid; gap: 4px; padding: 10px 12px; border: 1px solid #ef4444; border-radius: $radius-md; background: rgba(239, 68, 68, .08); color: #fecaca; font-size: 11px; }
.flow-validation strong { color: #f87171; font-size: 12px; }
.flow-edge-invalid path { stroke: #ef4444 !important; stroke-dasharray: 5 3; }
.flow-canvas-node { border-left: 3px solid $text-secondary; }
.flow-canvas-node.node-trigger { border-left-color: #42a5f5; }
.flow-canvas-node.node-message { border-left-color: $accent; }
.flow-canvas-node.node-condition { border-left-color: #ffca28; }
.flow-canvas-node.node-fallback { border-left-color: #ab47bc; }
.flow-list { display: grid; gap: 8px; }
.flow-item { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 14px; background: $bg-secondary; border: 1px solid $border-color; border-radius: $radius-md; }
.flow-item div { display: grid; gap: 4px; min-width: 0; }
.flow-item strong { overflow-wrap: anywhere; font-size: 13px; }
.flow-item span { color: $text-secondary; font-size: 11px; }
.empty-state { margin: 0; padding: 28px 0; color: $text-secondary; text-align: center; }
.appointments-page { height: 100%; box-sizing: border-box; }
.appointments-layout { display: flex; align-items: stretch; gap: clamp(14px, 3vw, 24px); width: 100%; height: 100%; min-height: 0; }
.calendar-panel { display: flex; flex: 2 1 0; flex-direction: column; min-width: 0; min-height: 0; }
.selected-appointments { flex: 3 1 0; min-width: 0; min-height: 0; padding-left: clamp(14px, 3vw, 20px); border-left: 1px solid $border-color; overflow-y: auto; }
.logs-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
.logs-toolbar p { margin: 0; color: $text-secondary; font-size: 12px; }
.logs-search { flex: 1; min-width: 0; height: 30px; box-sizing: border-box; border: 1px solid $border-input; border-radius: $radius-sm; padding: 0 10px; background: $bg-primary; color: $text-primary; font: inherit; font-size: 11px; }
.logs-mode-switch { display: flex; gap: 2px; }
.logs-mode-switch button { border: 1px solid $border-input; padding: 7px 8px; background: $bg-secondary; color: $text-secondary; cursor: pointer; font: inherit; font-size: 10px; }
.logs-mode-switch button:first-child { border-radius: $radius-sm 0 0 $radius-sm; }
.logs-mode-switch button:last-child { border-radius: 0 $radius-sm $radius-sm 0; }
.logs-mode-switch button.active { background: $bg-accent-18; color: $accent; border-color: $accent; }
.clear-logs-btn { border: 1px solid $border-input; border-radius: $radius-sm; padding: 7px 10px; background: $bg-secondary; color: $text-secondary; cursor: pointer; font: inherit; font-size: 11px; }
.clear-logs-btn:hover:not(:disabled) { background: $bg-hover; color: $text-primary; }
.clear-logs-btn:disabled { cursor: not-allowed; opacity: .45; }
.logs-list { display: grid; gap: 8px; }
.log-item { display: flex; align-items: center; gap: 10px; padding: 11px 12px; background: $bg-secondary; border: 1px solid $border-color; border-radius: $radius-md; }
.log-item div { display: grid; gap: 4px; min-width: 0; }
.log-item strong { overflow-wrap: anywhere; font-size: 12px; }
.log-item span:not(.log-status) { color: $text-secondary; font-size: 11px; }
.log-status { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; flex: 0 0 22px; border-radius: 50%; background: $accent; color: #07110b; font-size: 11px; font-weight: 800; }
.log-status.failed { background: $danger; color: #fff; }
.calendar-toolbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; text-transform: capitalize; }
.calendar-nav { width: 30px; height: 30px; border: 1px solid $border-input; border-radius: $radius-sm; background: $bg-secondary; color: $text-primary; cursor: pointer; font-size: 20px; line-height: 1; }
.calendar-nav:hover { background: $bg-hover; }
.calendar-weekdays, .calendar-grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 4px; }
.calendar-grid { flex: 1; grid-auto-rows: minmax(0, 1fr); min-height: 0; }
.calendar-weekdays { margin-bottom: 4px; color: $text-muted; font-size: 10px; font-weight: 700; text-align: center; }
.calendar-day { position: relative; display: flex; align-items: flex-start; justify-content: space-between; min-height: 0; height: 100%; padding: clamp(5px, 1vw, 7px); border: 1px solid transparent; border-radius: $radius-sm; background: $bg-secondary; color: $text-primary; cursor: pointer; font: inherit; font-size: 12px; }
.calendar-day:hover { background: $bg-hover; }
.calendar-day.muted { color: $text-muted; opacity: .5; }
.calendar-day.today { border-color: $accent; }
.calendar-day.selected { background: $bg-accent-18; color: $accent; }
.calendar-day i { display: inline-flex; align-items: center; justify-content: center; min-width: 16px; height: 16px; border-radius: 50%; background: $accent; color: #07110b; font-size: 9px; font-style: normal; font-weight: 800; }
.selected-day-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin: 22px 0 10px; }
.selected-day-heading strong { font-size: 13px; text-transform: capitalize; }
.selected-day-heading span { color: $text-secondary; font-size: 11px; }
.appointments-list { display: grid; gap: 10px; }
.appointment-item { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px; background: $bg-secondary; border: 1px solid $border-color; border-radius: $radius-md; }
.appointment-item div { display: grid; gap: 5px; min-width: 0; }
.appointment-item strong { overflow-wrap: anywhere; font-size: 13px; }
.appointment-item span { color: $text-secondary; font-size: 12px; }
.delete-btn { width: 28px; height: 28px; flex: 0 0 28px; justify-content: center; border: 0; border-radius: $radius-sm; background: transparent; color: $text-error; cursor: pointer; font-size: 20px; }
.delete-btn:hover { background: $danger; color: #fff; }

@media (max-width: 640px) {
  .dashboard-cards, .dashboard-grid { grid-template-columns: 1fr; }
  .dashboard-heading { align-items: flex-start; flex-direction: column; }
  .automation-workspace { display: block; min-height: 0; }
  .automation-list { margin-bottom: 18px; padding: 0 0 14px; border-right: 0; border-bottom: 1px solid $border-color; }
  .appointments-page { height: auto; }
  .appointments-layout { display: block; height: auto; }
  .calendar-panel { display: block; }
  .calendar-grid { min-height: 270px; }
  .selected-appointments { margin-top: 22px; padding: 18px 0 0; border-top: 1px solid $border-color; border-left: 0; }
}
</style>
