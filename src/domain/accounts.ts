export interface Account {
  id?: number
  name: string
  identityAddress: string
  isActive: boolean
  createdAt: number
  lastAccessedAt?: number
  derivationIndex?: number
}

export interface AccountSettings {
  displayInSats: boolean
  feeRateKB: number
  autoLockMinutes: number
  trustedOrigins: string[]
}
