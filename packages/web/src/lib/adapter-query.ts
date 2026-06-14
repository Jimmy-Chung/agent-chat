const PAIRED_DEVICE_KEY = 'AGENT_CHAT_PAIRED_DEVICE'

interface AdapterQueryInput {
  wssUrl?: string
  piToken?: string
}

interface PairedDeviceQuery {
  deviceCredential?: string
  adapterInstanceId?: string
  adapterWssUrl?: string
}

function readPairedDevice(storage: Storage | null): PairedDeviceQuery | null {
  if (!storage) return null
  try {
    const paired = storage.getItem(PAIRED_DEVICE_KEY)
    return paired ? JSON.parse(paired) as PairedDeviceQuery : null
  } catch {
    return null
  }
}

export function buildAdapterQueryParams(input: AdapterQueryInput, storage?: Storage | null): URLSearchParams {
  const params = new URLSearchParams()
  if (input.wssUrl) params.set('wssUrl', input.wssUrl)
  if (input.piToken) params.set('piToken', input.piToken)

  const paired = readPairedDevice(storage ?? (typeof localStorage === 'undefined' ? null : localStorage))
  if (paired?.deviceCredential) params.set('deviceCredential', paired.deviceCredential)
  if (paired?.adapterInstanceId) params.set('adapterInstanceId', paired.adapterInstanceId)
  if (paired?.adapterWssUrl) params.set('pairedAdapterWssUrl', paired.adapterWssUrl)

  return params
}
