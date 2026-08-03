import { debug } from '../../main/debug'

export function handleNetworkError(details: Record<string, unknown>) {
  debug.networkError(details)
}

export function safeErrorMessage(error: unknown, fallback = 'Operação falhou') {
  const message = error instanceof Error ? error.message : String(error || fallback)
  if (/<html[\s>]/i.test(message)) {
    const status = message.match(/Instagram API\s+(\d{3})/i)?.[1]
    return status ? `Instagram API ${status} retornou HTML` : 'O servidor retornou uma página HTML inesperada'
  }
  return message.length > 500 ? `${message.slice(0, 500)}...` : message
}
