import { debug } from '../../main/debug'

export function handleRenderError(details: Record<string, unknown>) {
  debug.renderError(details)
}
