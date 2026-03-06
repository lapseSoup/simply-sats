export interface PaymentNotification {
  txid: string
  vout: number
  amount: number
  derivationPrefix: string
  derivationSuffix: string
  senderPublicKey: string
}
