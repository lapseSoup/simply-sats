export interface Token {
  id?: number
  ticker: string
  protocol: 'bsv20' | 'bsv21'
  contractTxid?: string
  name?: string
  decimals: number
  totalSupply?: string
  iconUrl?: string
  verified: boolean
  createdAt: number
}

export interface TokenBalance {
  token: Token
  confirmed: bigint
  pending: bigint
  listed: bigint
  total: bigint
}

export function formatTokenAmount(amount: bigint, decimals: number): string {
  if (decimals === 0) {
    return amount.toString()
  }

  const str = amount.toString().padStart(decimals + 1, '0')
  const intPart = str.slice(0, -decimals) || '0'
  const decPart = str.slice(-decimals)
  const trimmedDec = decPart.replace(/0+$/, '')

  return trimmedDec ? `${intPart}.${trimmedDec}` : intPart
}
