import { waGetCreds, waSetCreds, waGetKey, waSetKey } from './database'

let initAuthCreds: any
let BufferJSON: any

async function loadInitCreds() {
  if (!initAuthCreds) {
    const m = await import('@whiskeysockets/baileys')
    initAuthCreds = m.initAuthCreds
    BufferJSON = m.BufferJSON
  }
}

function makeKeyStore() {
  const get = async (type: string, ids: string[]) => {
    const data: Record<string, any> = {}
    for (const id of ids) {
      const val = waGetKey(`${type}:${id}`)
      if (val) data[id] = JSON.parse(val, BufferJSON.reviver)
    }
    return data
  }

  const set = async (data: Record<string, any>) => {
    for (const id in data) {
      waSetKey(id, JSON.stringify(data[id], BufferJSON.replacer))
    }
  }

  return { get, set }
}

export async function useSqliteAuthState() {
  await loadInitCreds()

  let creds: any
  const credsRaw = waGetCreds()
  if (credsRaw) {
    creds = JSON.parse(credsRaw, BufferJSON.reviver)
  } else {
    creds = initAuthCreds()
    waSetCreds(JSON.stringify(creds, BufferJSON.replacer))
  }

  const keys = makeKeyStore()

  const saveCreds = () => {
    if (creds) waSetCreds(JSON.stringify(creds, BufferJSON.replacer))
  }

  return { state: { creds, keys }, saveCreds }
}
