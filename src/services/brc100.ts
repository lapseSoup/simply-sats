/**
 * BRC-100 Protocol Implementation
 *
 * This allows Simply Sats to communicate with BRC-100 compatible apps
 * like Wrootz for locking BSV and creating 1Sat Ordinals.
 */

import { PrivateKey, P2PKH, Transaction, Script } from '@bsv/sdk'
import { WalletKeys, getUTXOs } from './wallet'

// BRC-100 message types
export type BRC100Action =
  | 'getPublicKey'
  | 'getBalance'
  | 'sendBSV'
  | 'lockBSV'
  | 'createInscription'
  | 'signMessage'

export interface BRC100Request {
  action: BRC100Action
  params?: Record<string, any>
  origin?: string
}

export interface BRC100Response {
  success: boolean
  data?: any
  error?: string
}

// Create a CLTV (CheckLockTimeVerify) locking script for time-locked BSV
function createCLTVScript(publicKeyHex: string, unlockBlock: number): Script {
  // OP_CHECKLOCKTIMEVERIFY script:
  // <unlockBlock> OP_CHECKLOCKTIMEVERIFY OP_DROP <pubkey> OP_CHECKSIG
  const script = new Script()

  // Push the unlock block number
  script.writeNumber(unlockBlock)

  // OP_CHECKLOCKTIMEVERIFY (0xb1)
  script.writeOpCode(0xb1)

  // OP_DROP (0x75)
  script.writeOpCode(0x75)

  // Push public key
  script.writeBuffer(Buffer.from(publicKeyHex, 'hex'))

  // OP_CHECKSIG (0xac)
  script.writeOpCode(0xac)

  return script
}

// Create a 1Sat Ordinal inscription
export async function createInscription(
  keys: WalletKeys,
  content: string,
  contentType: string = 'text/plain'
): Promise<{ txid: string; inscriptionId: string }> {
  const privateKey = PrivateKey.fromWif(keys.ordWif)
  const publicKey = privateKey.toPublicKey()

  // Get UTXOs from ordinals address
  const utxos = await getUTXOs(keys.ordAddress)

  if (utxos.length === 0) {
    throw new Error('No UTXOs available for inscription')
  }

  const tx = new Transaction()

  // Add input
  tx.addInput({
    sourceTXID: utxos[0].txid,
    sourceOutputIndex: utxos[0].vout,
    sourceSatoshis: utxos[0].satoshis,
    unlockingScriptTemplate: new P2PKH().unlock(privateKey)
  })

  // Create inscription script (1Sat Ordinals format)
  // OP_FALSE OP_IF "ord" <content-type> <content> OP_ENDIF <P2PKH>
  const inscriptionScript = new Script()

  // OP_FALSE OP_IF
  inscriptionScript.writeOpCode(0x00) // OP_FALSE
  inscriptionScript.writeOpCode(0x63) // OP_IF

  // Push "ord"
  inscriptionScript.writeBuffer(Buffer.from('ord'))

  // Content type
  inscriptionScript.writeBuffer(Buffer.from(contentType))

  // Content
  inscriptionScript.writeBuffer(Buffer.from(content))

  // OP_ENDIF
  inscriptionScript.writeOpCode(0x68)

  // Add P2PKH locking after inscription
  const p2pkh = new P2PKH().lock(keys.ordAddress)
  inscriptionScript.writeScript(p2pkh)

  // Add inscription output (1 satoshi)
  tx.addOutput({
    lockingScript: inscriptionScript,
    satoshis: 1
  })

  // Add change output
  const fee = 300 // Estimate
  const change = utxos[0].satoshis - 1 - fee
  if (change > 546) {
    tx.addOutput({
      lockingScript: new P2PKH().lock(keys.ordAddress),
      satoshis: change
    })
  }

  // Sign
  await tx.sign()

  // Broadcast
  const response = await fetch('https://api.whatsonchain.com/v1/bsv/main/tx/raw', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ txhex: tx.toHex() })
  })

  if (!response.ok) {
    throw new Error('Failed to broadcast inscription')
  }

  const txid = tx.id('hex')
  return {
    txid,
    inscriptionId: `${txid}_0`
  }
}

// Lock BSV with CLTV (for Wrootz)
export async function lockBSV(
  keys: WalletKeys,
  satoshis: number,
  durationBlocks: number,
  ordinalOrigin?: string
): Promise<{ txid: string; lockAddress: string }> {
  const privateKey = PrivateKey.fromWif(keys.walletWif)
  const publicKey = privateKey.toPublicKey()

  // Get current block height
  const blockResponse = await fetch('https://api.whatsonchain.com/v1/bsv/main/chain/info')
  const blockInfo = await blockResponse.json()
  const currentBlock = blockInfo.blocks
  const unlockBlock = currentBlock + durationBlocks

  // Get UTXOs
  const utxos = await getUTXOs(keys.walletAddress)

  if (utxos.length === 0) {
    throw new Error('No UTXOs available')
  }

  const tx = new Transaction()

  // Add inputs
  let totalInput = 0
  for (const utxo of utxos) {
    tx.addInput({
      sourceTXID: utxo.txid,
      sourceOutputIndex: utxo.vout,
      sourceSatoshis: utxo.satoshis,
      unlockingScriptTemplate: new P2PKH().unlock(privateKey)
    })
    totalInput += utxo.satoshis
    if (totalInput >= satoshis + 500) break
  }

  // Create CLTV locking script
  const lockScript = createCLTVScript(publicKey.toString(), unlockBlock)

  // Add lock output
  tx.addOutput({
    lockingScript: lockScript,
    satoshis
  })

  // Add OP_RETURN for Wrootz linking (if ordinal origin provided)
  if (ordinalOrigin) {
    const opReturnScript = new Script()
    opReturnScript.writeOpCode(0x6a) // OP_RETURN
    opReturnScript.writeOpCode(0x00) // OP_FALSE
    opReturnScript.writeBuffer(Buffer.from('wrootz'))
    opReturnScript.writeBuffer(Buffer.from('lock'))
    opReturnScript.writeBuffer(Buffer.from(ordinalOrigin))

    tx.addOutput({
      lockingScript: opReturnScript,
      satoshis: 0
    })
  }

  // Add change
  const fee = 300
  const change = totalInput - satoshis - fee
  if (change > 546) {
    tx.addOutput({
      lockingScript: new P2PKH().lock(keys.walletAddress),
      satoshis: change
    })
  }

  // Sign
  await tx.sign()

  // Broadcast
  const response = await fetch('https://api.whatsonchain.com/v1/bsv/main/tx/raw', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ txhex: tx.toHex() })
  })

  if (!response.ok) {
    throw new Error('Failed to broadcast lock transaction')
  }

  return {
    txid: tx.id('hex'),
    lockAddress: keys.walletAddress // The lock is controlled by this address
  }
}

// Handle BRC-100 requests from web apps
export async function handleBRC100Request(
  request: BRC100Request,
  keys: WalletKeys
): Promise<BRC100Response> {
  try {
    switch (request.action) {
      case 'getPublicKey':
        return {
          success: true,
          data: {
            identityPubKey: keys.identityPubKey,
            walletPubKey: keys.walletPubKey,
            ordPubKey: keys.ordPubKey
          }
        }

      case 'lockBSV':
        const { satoshis, durationBlocks, ordinalOrigin } = request.params || {}
        const lockResult = await lockBSV(keys, satoshis, durationBlocks, ordinalOrigin)
        return { success: true, data: lockResult }

      case 'createInscription':
        const { content, contentType } = request.params || {}
        const inscResult = await createInscription(keys, content, contentType)
        return { success: true, data: inscResult }

      case 'signMessage':
        const privateKey = PrivateKey.fromWif(keys.identityWif)
        // TODO: implement message signing
        return { success: true, data: { signature: 'TODO' } }

      default:
        return { success: false, error: `Unknown action: ${request.action}` }
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}
