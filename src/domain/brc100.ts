export const BRC100_REQUEST_TYPES = [
  'getPublicKey',
  'createSignature',
  'createAction',
  'getNetwork',
  'getVersion',
  'isAuthenticated',
  'getHeight',
  'listOutputs',
  'lockBSV',
  'unlockBSV',
  'listLocks',
  'encrypt',
  'decrypt',
  'getTaggedKeys',
  'acquireCertificate',
  'proveCertificate',
  'listCertificates',
  'relinquishCertificate'
] as const

export type BRC100RequestType = typeof BRC100_REQUEST_TYPES[number]

export interface BRC100Request {
  id: string
  type: BRC100RequestType
  params?: Record<string, unknown>
  origin?: string
}

export interface CreateActionRequest {
  description: string
  outputs: Array<{
    lockingScript: string
    satoshis: number
    outputDescription?: string
    basket?: string
    tags?: string[]
  }>
  inputs?: Array<{
    outpoint: string
    inputDescription?: string
    unlockingScript?: string
    sequenceNumber?: number
    unlockingScriptLength?: number
  }>
  lockTime?: number
  labels?: string[]
  options?: {
    signAndProcess?: boolean
    noSend?: boolean
    randomizeOutputs?: boolean
  }
}
