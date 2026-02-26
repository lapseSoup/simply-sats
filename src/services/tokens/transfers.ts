/**
 * Token Transfers — token transfer/send logic
 *
 * Handles BSV-20/BSV-21 token transfer transactions: inscription creation,
 * transaction building, UTXO selection, and broadcasting.
 */

import { Transaction, PrivateKey, P2PKH, Script } from '@bsv/sdk'
import { tokenLogger } from '../logger'
import { ok, err, type Result } from '../../domain/types'
import { broadcastTransaction, calculateTxFee, type UTXO } from '../wallet'
import { isValidBSVAddress } from '../../domain/wallet/validation'
import { recordSentTransaction, markUtxosSpent } from '../sync'
import type { TokenUTXO } from './fetching'
import { getTokenUtxosForSend } from './fetching'

// Opcodes for inscription scripts
const OP_FALSE = 0x00
const OP_IF = 0x63
const OP_ENDIF = 0x68
const OP_0 = 0x00
const OP_1 = 0x51

/**
 * Create a BSV-20 transfer inscription script
 *
 * Format: OP_FALSE OP_IF "ord" <1> <content-type> OP_0 <content> OP_ENDIF
 * Content: {"p":"bsv-20","op":"transfer","tick":"TOKEN","amt":"AMOUNT"}
 */
function createBsv20TransferInscription(ticker: string, amount: string): Script {
  const contentType = Array.from(new TextEncoder().encode('application/bsv-20'))
  const content = Array.from(new TextEncoder().encode(JSON.stringify({
    p: 'bsv-20',
    op: 'transfer',
    tick: ticker,
    amt: amount
  })))
  const ordMarker = Array.from(new TextEncoder().encode('ord'))

  // Build inscription script: OP_FALSE OP_IF "ord" <1> <content-type> OP_0 <content> OP_ENDIF
  const script = new Script()

  // OP_FALSE OP_IF
  script.writeOpCode(OP_FALSE)
  script.writeOpCode(OP_IF)

  // "ord" marker
  script.writeBin(ordMarker)

  // Push 1 (content-type tag)
  script.writeOpCode(OP_1)

  // Push content type
  script.writeBin(contentType)

  // OP_0 (content tag)
  script.writeOpCode(OP_0)

  // Push content
  script.writeBin(content)

  // OP_ENDIF
  script.writeOpCode(OP_ENDIF)

  return script
}

/**
 * Create a BSV-21 transfer inscription script
 *
 * Format: {"p":"bsv-20","op":"transfer","id":"CONTRACT_ID","amt":"AMOUNT"}
 */
function createBsv21TransferInscription(contractId: string, amount: string): Script {
  const contentType = Array.from(new TextEncoder().encode('application/bsv-20'))
  const content = Array.from(new TextEncoder().encode(JSON.stringify({
    p: 'bsv-20',
    op: 'transfer',
    id: contractId,
    amt: amount
  })))
  const ordMarker = Array.from(new TextEncoder().encode('ord'))

  const script = new Script()
  script.writeOpCode(OP_FALSE)
  script.writeOpCode(OP_IF)
  script.writeBin(ordMarker)
  script.writeOpCode(OP_1)
  script.writeBin(contentType)
  script.writeOpCode(OP_0)
  script.writeBin(content)
  script.writeOpCode(OP_ENDIF)

  return script
}

/**
 * Transfer BSV20/BSV21 tokens to another address
 *
 * @param tokenWif - Private key WIF for the token-holding address
 * @param tokenUtxos - Token UTXOs to spend
 * @param ticker - Token ticker (BSV20) or contract ID (BSV21)
 * @param protocol - Token protocol (bsv20 or bsv21)
 * @param amount - Amount to send (as string to handle bigint)
 * @param toAddress - Recipient address
 * @param fundingWif - Private key WIF for funding (for the fee)
 * @param fundingUtxos - UTXOs to use for paying the fee
 * @param changeAddress - Address for change (both token change and BSV change)
 * @returns Transaction ID
 */
export async function transferToken(
  tokenWif: string,
  tokenUtxos: TokenUTXO[],
  ticker: string,
  protocol: 'bsv20' | 'bsv21',
  amount: string,
  toAddress: string,
  fundingWif: string,
  fundingUtxos: UTXO[],
  changeAddress: string
): Promise<Result<{ txid: string }, string>> {
  // S-62: Validate recipient address before anything else — invalid address = permanent token loss
  if (!isValidBSVAddress(toAddress)) {
    return err(`Invalid recipient address: ${toAddress}`)
  }
  // S-62: Validate change address
  if (!isValidBSVAddress(changeAddress)) {
    return err(`Invalid change address: ${changeAddress}`)
  }
  // Q-54: Validate amount string before BigInt conversion — BigInt('abc') throws SyntaxError
  if (!/^\d+$/.test(amount) || amount === '0') {
    return err(`Invalid amount: must be a positive whole number, got "${amount}"`)
  }

  try {
    const tokenPrivateKey = PrivateKey.fromWif(tokenWif)
    const tokenPublicKey = tokenPrivateKey.toPublicKey()
    const tokenFromAddress = tokenPublicKey.toAddress()
    const tokenSourceLockingScript = new P2PKH().lock(tokenFromAddress)

    const fundingPrivateKey = PrivateKey.fromWif(fundingWif)
    const fundingPublicKey = fundingPrivateKey.toPublicKey()
    const fundingFromAddress = fundingPublicKey.toAddress()
    const fundingSourceLockingScript = new P2PKH().lock(fundingFromAddress)

    // Calculate total tokens available
    let totalTokensAvailable = BigInt(0)
    for (const utxo of tokenUtxos) {
      totalTokensAvailable += BigInt(utxo.amt)
    }

    const amountToSend = BigInt(amount)

    if (amountToSend > totalTokensAvailable) {
      return err(`Insufficient token balance. Have ${totalTokensAvailable}, need ${amountToSend}`)
    }

    const tx = new Transaction()

    // Add token inputs
    let tokensAdded = BigInt(0)
    const tokenInputsUsed: TokenUTXO[] = []

    for (const utxo of tokenUtxos) {
      if (tokensAdded >= amountToSend) break

      tx.addInput({
        sourceTXID: utxo.txid,
        sourceOutputIndex: utxo.vout,
        unlockingScriptTemplate: new P2PKH().unlock(
          tokenPrivateKey,
          'all',
          false,
          utxo.satoshis,
          tokenSourceLockingScript
        ),
        sequence: 0xffffffff
      })

      tokensAdded += BigInt(utxo.amt)
      tokenInputsUsed.push(utxo)
    }

    // B-54/S-65: Select funding UTXOs first, then calculate fee with actual counts
    const hasTokenChange = tokensAdded > amountToSend
    const fundingToUse: UTXO[] = []
    let totalFunding = 0

    // Start with a rough estimate using 1 funding input
    let estimatedFee = calculateTxFee(tokenInputsUsed.length + 1, hasTokenChange ? 3 : 2)

    for (const utxo of fundingUtxos) {
      fundingToUse.push(utxo)
      totalFunding += utxo.satoshis

      // Recalculate fee with ACTUAL funding input count + actual output count
      const actualOutputs = (hasTokenChange ? 2 : 1) + (totalFunding > estimatedFee ? 1 : 0) // + BSV change
      estimatedFee = calculateTxFee(tokenInputsUsed.length + fundingToUse.length, actualOutputs)

      if (totalFunding >= estimatedFee + 100) break
    }

    if (totalFunding < estimatedFee) {
      return err(`Insufficient BSV for fee (need ~${estimatedFee} sats)`)
    }

    // Add funding inputs
    for (const utxo of fundingToUse) {
      tx.addInput({
        sourceTXID: utxo.txid,
        sourceOutputIndex: utxo.vout,
        unlockingScriptTemplate: new P2PKH().unlock(
          fundingPrivateKey,
          'all',
          false,
          utxo.satoshis,
          fundingSourceLockingScript
        ),
        sequence: 0xffffffff
      })
    }

    // Create inscription script for recipient
    const recipientInscription = protocol === 'bsv21'
      ? createBsv21TransferInscription(ticker, amount)
      : createBsv20TransferInscription(ticker, amount)

    // Build recipient output script: inscription + P2PKH
    const recipientP2PKH = new P2PKH().lock(toAddress)
    const recipientScript = Script.fromBinary([
      ...recipientInscription.toBinary(),
      ...recipientP2PKH.toBinary()
    ])

    // Add recipient output (1 sat for the inscription)
    tx.addOutput({
      lockingScript: recipientScript,
      satoshis: 1
    })

    // Add token change output if there's leftover tokens
    const tokenChange = tokensAdded - amountToSend
    if (tokenChange > 0n) {
      const changeInscription = protocol === 'bsv21'
        ? createBsv21TransferInscription(ticker, tokenChange.toString())
        : createBsv20TransferInscription(ticker, tokenChange.toString())

      const changeP2PKH = new P2PKH().lock(changeAddress)
      const changeScript = Script.fromBinary([
        ...changeInscription.toBinary(),
        ...changeP2PKH.toBinary()
      ])

      tx.addOutput({
        lockingScript: changeScript,
        satoshis: 1
      })
    }

    // Calculate BSV change
    let totalInput = totalFunding
    for (const utxo of tokenInputsUsed) {
      totalInput += utxo.satoshis
    }

    const outputSats = 1 + (tokenChange > 0n ? 1 : 0) // recipient + optional token change
    // S-65: Calculate fee with actual input and output counts
    const actualOutputCount = outputSats + 1 // + BSV change output
    const actualFee = calculateTxFee(tokenInputsUsed.length + fundingToUse.length, actualOutputCount)
    const bsvChange = totalInput - outputSats - actualFee

    // Add BSV change output
    if (bsvChange > 0) {
      tx.addOutput({
        lockingScript: new P2PKH().lock(fundingFromAddress),
        satoshis: bsvChange
      })
    }

    await tx.sign()
    const txid = await broadcastTransaction(tx)

    // B-42: Track spent UTXOs and record transaction locally
    // Mark funding and token UTXOs as spent to prevent double-spend on rapid follow-up sends
    try {
      const spentFundingOutpoints = fundingToUse.map(u => ({ txid: u.txid, vout: u.vout }))
      await markUtxosSpent(spentFundingOutpoints, txid)

      const spentTokenOutpoints = tokenInputsUsed.map(u => ({ txid: u.txid, vout: u.vout }))
      await markUtxosSpent(spentTokenOutpoints, txid)

      // Record the transaction so it appears in Activity tab immediately
      await recordSentTransaction(
        txid,
        tx.toHex(),
        `Token transfer: ${amount} ${ticker}`,
        ['token-transfer'],
        bsvChange < 0 ? 0 : bsvChange
      )
    } catch (trackingError) {
      // Non-critical: next sync will discover the transaction
      tokenLogger.warn('Failed to track token transfer locally', { txid, error: String(trackingError) })
    }

    tokenLogger.info('Token transfer completed', { amount, ticker, toAddress, txid })

    return ok({ txid })
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : 'Token transfer failed'
    tokenLogger.error('Transfer error', e)
    return err(errorMsg)
  }
}

/**
 * Simple token send function that handles UTXO selection
 */
export async function sendToken(
  walletAddress: string,
  ordAddress: string,
  walletWif: string,
  ordWif: string,
  fundingUtxos: UTXO[],
  ticker: string,
  protocol: 'bsv20' | 'bsv21',
  amount: string,
  toAddress: string
): Promise<Result<{ txid: string }, string>> {
  try {
    // Fetch token UTXOs from both addresses
    const [walletTokenUtxos, ordTokenUtxos] = await Promise.all([
      getTokenUtxosForSend(walletAddress, protocol === 'bsv21' ? ticker : ticker, protocol),
      getTokenUtxosForSend(ordAddress, protocol === 'bsv21' ? ticker : ticker, protocol)
    ])

    // Combine and sort by amount (largest first for efficient selection)
    const allTokenUtxos = [...walletTokenUtxos, ...ordTokenUtxos]
      .sort((a, b) => Number(BigInt(b.amt) - BigInt(a.amt)))

    if (allTokenUtxos.length === 0) {
      return err('No token UTXOs found')
    }

    // Determine which WIF to use based on where tokens are
    // Use the address that has the most tokens
    const walletTotal = walletTokenUtxos.reduce((sum, u) => sum + BigInt(u.amt), 0n)
    const ordTotal = ordTokenUtxos.reduce((sum, u) => sum + BigInt(u.amt), 0n)

    const useOrdWallet = ordTotal > walletTotal
    const tokenWif = useOrdWallet ? ordWif : walletWif
    const changeAddress = useOrdWallet ? ordAddress : walletAddress

    // Filter UTXOs to match the selected wallet
    const tokenUtxos = useOrdWallet ? ordTokenUtxos : walletTokenUtxos

    if (tokenUtxos.length === 0) {
      // Fall back to other wallet if primary has no UTXOs
      const fallbackUtxos = useOrdWallet ? walletTokenUtxos : ordTokenUtxos
      const fallbackWif = useOrdWallet ? walletWif : ordWif
      const fallbackChange = useOrdWallet ? walletAddress : ordAddress

      return transferToken(
        fallbackWif,
        fallbackUtxos,
        ticker,
        protocol,
        amount,
        toAddress,
        walletWif,
        fundingUtxos,
        fallbackChange
      )
    }

    // B-43: Check if selected address has sufficient tokens before attempting transfer
    const selectedTotal = tokenUtxos.reduce((sum, u) => sum + BigInt(u.amt), 0n)
    const amountNeeded = BigInt(amount)
    if (selectedTotal < amountNeeded) {
      // Check if combined addresses would have enough
      const combinedTotal = walletTotal + ordTotal
      if (combinedTotal >= amountNeeded) {
        return err(
          `Tokens are split across wallet and ordinal addresses. ` +
          `${useOrdWallet ? 'Ordinal' : 'Wallet'} address has ${selectedTotal.toString()} but needs ${amount}. ` +
          `Please consolidate your tokens to one address first.`
        )
      }
      return err(`Insufficient token balance. Have ${combinedTotal.toString()}, need ${amount}`)
    }

    return transferToken(
      tokenWif,
      tokenUtxos,
      ticker,
      protocol,
      amount,
      toAddress,
      walletWif,
      fundingUtxos,
      changeAddress
    )
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : 'Token send failed'
    tokenLogger.error('Send error', e)
    return err(errorMsg)
  }
}
