/**
 * Token Transfers — token transfer/send logic
 *
 * Handles BSV-20/BSV-21 token transfer transactions: inscription creation,
 * transaction building, UTXO selection, and broadcasting.
 *
 * Transaction building is delegated to the Tauri (Rust) backend.
 * No @bsv/sdk imports — all cryptographic operations happen in Rust.
 */

import { tokenLogger } from '../logger'
import { ok, err, type Result } from '../../domain/types'
import { broadcastTransaction, calculateTxFee, type UTXO } from '../wallet'
import { isValidBSVAddress } from '../../domain/wallet/validation'
import { recordSentTransaction, markUtxosSpent } from '../sync'
import type { TokenUTXO } from './fetching'
import { getTokenUtxosForSend } from './fetching'
import { p2pkhLockingScriptHex } from '../../domain/transaction/builder'
import { isTauri, tauriInvoke } from '../../utils/tauri'

interface BuiltTokenTransferResult {
  rawTx: string
  txid: string
  fee: number
  change: number
}

async function finalizeTokenTransfer(
  txResult: BuiltTokenTransferResult,
  fundingToUse: UTXO[],
  tokenInputsUsed: TokenUTXO[],
  amount: string,
  ticker: string,
  toAddress: string
): Promise<Result<{ txid: string }, string>> {
  const bsvChange = txResult.change

  // Broadcast the signed raw transaction
  const txid = await broadcastTransaction(txResult.rawTx)

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
      txResult.rawTx,
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
 * @param changeAddress - Address for BSV change output
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
  // Q-54: Validate amount string before BigInt conversion — BigInt('abc') throws SyntaxError
  if (!/^\d+$/.test(amount) || amount === '0') {
    return err(`Invalid amount: must be a positive whole number, got "${amount}"`)
  }

  if (!isTauri()) {
    return err('Token transfer transaction building requires Tauri runtime')
  }

  try {
    // Derive addresses from WIFs via Tauri
    const tokenKeyInfo = await tauriInvoke<{ address: string }>('keys_from_wif', { wif: tokenWif })
    const tokenFromAddress = tokenKeyInfo.address
    const tokenFromScriptHex = p2pkhLockingScriptHex(tokenFromAddress)

    const fundingKeyInfo = await tauriInvoke<{ address: string }>('keys_from_wif', { wif: fundingWif })
    const fundingFromAddress = fundingKeyInfo.address
    const fundingFromScriptHex = p2pkhLockingScriptHex(fundingFromAddress)

    // Calculate total tokens available
    let totalTokensAvailable = BigInt(0)
    for (const utxo of tokenUtxos) {
      totalTokensAvailable += BigInt(utxo.amt)
    }

    const amountToSend = BigInt(amount)

    if (amountToSend > totalTokensAvailable) {
      return err(`Insufficient token balance. Have ${totalTokensAvailable}, need ${amountToSend}`)
    }

    // Select token inputs
    let tokensAdded = BigInt(0)
    const tokenInputsUsed: TokenUTXO[] = []

    for (const utxo of tokenUtxos) {
      if (tokensAdded >= amountToSend) break
      tokensAdded += BigInt(utxo.amt)
      tokenInputsUsed.push(utxo)
    }

    // B-54: Calculate fee iteratively — the initial estimate assumes 2 funding
    // inputs, but if more are needed the fee rises, potentially requiring yet
    // more inputs. Loop until funding covers the recalculated fee.
    const tokenChange = tokensAdded - amountToSend
    const numOutputs = (tokenChange > 0n) ? 3 : 2 // recipient + (token change?) + BSV change

    const fundingToUse: UTXO[] = []
    let totalFunding = 0
    let estimatedFee = calculateTxFee(tokenInputsUsed.length + Math.min(fundingUtxos.length, 2), numOutputs)

    for (const utxo of fundingUtxos) {
      fundingToUse.push(utxo)
      totalFunding += utxo.satoshis
      if (totalFunding >= estimatedFee + 100) break
    }

    // Recalculate fee with actual input count and continue selecting if needed
    estimatedFee = calculateTxFee(tokenInputsUsed.length + fundingToUse.length, numOutputs)
    while (totalFunding < estimatedFee + 100 && fundingToUse.length < fundingUtxos.length) {
      const next = fundingUtxos[fundingToUse.length]!
      fundingToUse.push(next)
      totalFunding += next.satoshis
      estimatedFee = calculateTxFee(tokenInputsUsed.length + fundingToUse.length, numOutputs)
    }

    if (totalFunding < estimatedFee) {
      return err(`Insufficient BSV for fee (need ~${estimatedFee} sats)`)
    }

    // Build token transfer with proper inscription outputs via Rust backend
    const txResult = await tauriInvoke<{ rawTx: string; txid: string; fee: number; change: number }>('build_token_transfer_tx', {
      tokenWif,
      tokenUtxos: tokenInputsUsed.map(u => ({
        txid: u.txid,
        vout: u.vout,
        satoshis: u.satoshis,
        script: u.script ?? tokenFromScriptHex
      })),
      fundingWif,
      fundingUtxos: fundingToUse.map(u => ({
        txid: u.txid,
        vout: u.vout,
        satoshis: u.satoshis,
        script: u.script ?? fundingFromScriptHex
      })),
      recipient: toAddress,
      amount,
      ticker,
      protocol: protocol === 'bsv21' ? 'bsv-21' : 'bsv-20',
      changeAddress
    })

    return await finalizeTokenTransfer(txResult, fundingToUse, tokenInputsUsed, amount, ticker, toAddress)
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : 'Token transfer failed'
    tokenLogger.error('Transfer error', e)
    return err(errorMsg)
  }
}

/**
 * Store-backed token transfer builder.
 * Keeps wallet/ordinal WIFs inside the Rust key store in Tauri.
 */
export async function transferTokenFromStore(
  tokenKeyType: 'wallet' | 'ordinals',
  tokenUtxos: TokenUTXO[],
  ticker: string,
  protocol: 'bsv20' | 'bsv21',
  amount: string,
  toAddress: string,
  fundingUtxos: UTXO[],
  changeAddress: string
): Promise<Result<{ txid: string }, string>> {
  if (!isValidBSVAddress(toAddress)) {
    return err(`Invalid recipient address: ${toAddress}`)
  }
  if (!/^\d+$/.test(amount) || amount === '0') {
    return err(`Invalid amount: must be a positive whole number, got "${amount}"`)
  }
  if (!isTauri()) {
    return err('Token transfer transaction building requires Tauri runtime')
  }

  try {
    let totalTokensAvailable = 0n
    for (const utxo of tokenUtxos) {
      totalTokensAvailable += BigInt(utxo.amt)
    }

    const amountToSend = BigInt(amount)
    if (amountToSend > totalTokensAvailable) {
      return err(`Insufficient token balance. Have ${totalTokensAvailable}, need ${amountToSend}`)
    }

    let tokensAdded = 0n
    const tokenInputsUsed: TokenUTXO[] = []
    for (const utxo of tokenUtxos) {
      if (tokensAdded >= amountToSend) break
      tokensAdded += BigInt(utxo.amt)
      tokenInputsUsed.push(utxo)
    }

    const tokenChange = tokensAdded - amountToSend
    const numOutputs = tokenChange > 0n ? 3 : 2

    const fundingToUse: UTXO[] = []
    let totalFunding = 0
    let estimatedFee = calculateTxFee(tokenInputsUsed.length + Math.min(fundingUtxos.length, 2), numOutputs)

    for (const utxo of fundingUtxos) {
      fundingToUse.push(utxo)
      totalFunding += utxo.satoshis
      if (totalFunding >= estimatedFee + 100) break
    }

    estimatedFee = calculateTxFee(tokenInputsUsed.length + fundingToUse.length, numOutputs)
    while (totalFunding < estimatedFee + 100 && fundingToUse.length < fundingUtxos.length) {
      const next = fundingUtxos[fundingToUse.length]!
      fundingToUse.push(next)
      totalFunding += next.satoshis
      estimatedFee = calculateTxFee(tokenInputsUsed.length + fundingToUse.length, numOutputs)
    }

    if (totalFunding < estimatedFee) {
      return err(`Insufficient BSV for fee (need ~${estimatedFee} sats)`)
    }

    const txResult = await tauriInvoke<BuiltTokenTransferResult>('build_token_transfer_tx_from_store', {
      tokenKeyType,
      tokenUtxos: tokenInputsUsed.map(u => ({
        txid: u.txid,
        vout: u.vout,
        satoshis: u.satoshis,
        script: u.script ?? p2pkhLockingScriptHex(changeAddress)
      })),
      fundingUtxos: fundingToUse.map(u => ({
        txid: u.txid,
        vout: u.vout,
        satoshis: u.satoshis,
        script: u.script ?? ''
      })),
      recipient: toAddress,
      amount,
      ticker,
      protocol: protocol === 'bsv21' ? 'bsv-21' : 'bsv-20',
      changeAddress
    })

    return await finalizeTokenTransfer(txResult, fundingToUse, tokenInputsUsed, amount, ticker, toAddress)
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : 'Token transfer failed'
    tokenLogger.error('Transfer-from-store error', e)
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
      getTokenUtxosForSend(walletAddress, ticker, protocol),
      getTokenUtxosForSend(ordAddress, ticker, protocol)
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

/**
 * Tauri-first token send path that never requests raw WIFs over IPC.
 */
export async function sendTokenFromStore(
  walletAddress: string,
  ordAddress: string,
  fundingUtxos: UTXO[],
  ticker: string,
  protocol: 'bsv20' | 'bsv21',
  amount: string,
  toAddress: string
): Promise<Result<{ txid: string }, string>> {
  try {
    const [walletTokenUtxos, ordTokenUtxos] = await Promise.all([
      getTokenUtxosForSend(walletAddress, ticker, protocol),
      getTokenUtxosForSend(ordAddress, ticker, protocol)
    ])

    const allTokenUtxos = [...walletTokenUtxos, ...ordTokenUtxos]
      .sort((a, b) => Number(BigInt(b.amt) - BigInt(a.amt)))

    if (allTokenUtxos.length === 0) {
      return err('No token UTXOs found')
    }

    const walletTotal = walletTokenUtxos.reduce((sum, u) => sum + BigInt(u.amt), 0n)
    const ordTotal = ordTokenUtxos.reduce((sum, u) => sum + BigInt(u.amt), 0n)

    const useOrdWallet = ordTotal > walletTotal
    const tokenKeyType = useOrdWallet ? 'ordinals' : 'wallet'
    const changeAddress = useOrdWallet ? ordAddress : walletAddress
    const tokenUtxos = useOrdWallet ? ordTokenUtxos : walletTokenUtxos

    if (tokenUtxos.length === 0) {
      const fallbackTokenKeyType = useOrdWallet ? 'wallet' : 'ordinals'
      const fallbackChangeAddress = useOrdWallet ? walletAddress : ordAddress
      const fallbackTokenUtxos = useOrdWallet ? walletTokenUtxos : ordTokenUtxos

      if (fallbackTokenUtxos.length === 0) {
        return err('No token UTXOs found')
      }

      return transferTokenFromStore(
        fallbackTokenKeyType,
        fallbackTokenUtxos,
        ticker,
        protocol,
        amount,
        toAddress,
        fundingUtxos,
        fallbackChangeAddress
      )
    }

    return transferTokenFromStore(
      tokenKeyType,
      tokenUtxos,
      ticker,
      protocol,
      amount,
      toAddress,
      fundingUtxos,
      changeAddress
    )
  } catch (e) {
    tokenLogger.error('Token send-from-store failed', e)
    return err(e instanceof Error ? e.message : 'Token transfer failed')
  }
}
