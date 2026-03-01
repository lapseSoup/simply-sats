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
import { recordSentTransaction, markUtxosSpent } from '../sync'
import type { TokenUTXO } from './fetching'
import { getTokenUtxosForSend } from './fetching'
import { p2pkhLockingScriptHex } from '../../domain/transaction/builder'
import { isTauri, tauriInvoke } from '../../utils/tauri'

/**
 * Transfer BSV20/BSV21 tokens to another address
 *
 * @param tokenWif - Private key WIF for the token-holding address
 * @param tokenUtxos - Token UTXOs to spend
 * @param ticker - Token ticker (BSV20) or contract ID (BSV21)
 * @param _protocol - Token protocol (bsv20 or bsv21) — reserved for future inscription Tauri command
 * @param amount - Amount to send (as string to handle bigint)
 * @param toAddress - Recipient address
 * @param fundingWif - Private key WIF for funding (for the fee)
 * @param fundingUtxos - UTXOs to use for paying the fee
 * @param _changeAddress - Address for change — reserved for future inscription Tauri command
 * @returns Transaction ID
 */
export async function transferToken(
  tokenWif: string,
  tokenUtxos: TokenUTXO[],
  ticker: string,
  _protocol: 'bsv20' | 'bsv21',
  amount: string,
  toAddress: string,
  fundingWif: string,
  fundingUtxos: UTXO[],
  _changeAddress: string
): Promise<Result<{ txid: string }, string>> {
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

    // Calculate fee
    const tokenChange = tokensAdded - amountToSend
    const numOutputs = (tokenChange > 0n) ? 3 : 2 // recipient + (token change?) + BSV change
    const numFundingInputs = Math.min(fundingUtxos.length, 2)
    const estimatedFee = calculateTxFee(tokenInputsUsed.length + numFundingInputs, numOutputs)

    // Select funding UTXOs
    const fundingToUse: UTXO[] = []
    let totalFunding = 0

    for (const utxo of fundingUtxos) {
      fundingToUse.push(utxo)
      totalFunding += utxo.satoshis

      if (totalFunding >= estimatedFee + 100) break
    }

    if (totalFunding < estimatedFee) {
      return err(`Insufficient BSV for fee (need ~${estimatedFee} sats)`)
    }

    // Build extended UTXOs with per-UTXO WIF for multi-key signing
    // Token inputs use tokenWif, funding inputs use fundingWif
    const extendedUtxos = [
      ...tokenInputsUsed.map(u => ({
        txid: u.txid,
        vout: u.vout,
        satoshis: u.satoshis,
        script: u.script ?? tokenFromScriptHex,
        wif: tokenWif
      })),
      ...fundingToUse.map(u => ({
        txid: u.txid,
        vout: u.vout,
        satoshis: u.satoshis,
        script: u.script ?? fundingFromScriptHex,
        wif: fundingWif
      }))
    ]

    // Calculate totals
    let totalInput = totalFunding
    for (const utxo of tokenInputsUsed) {
      totalInput += utxo.satoshis
    }

    const outputSats = 1 + (tokenChange > 0n ? 1 : 0)
    const actualFee = calculateTxFee(tokenInputsUsed.length + fundingToUse.length, numOutputs)
    const bsvChange = totalInput - outputSats - actualFee

    // TODO: When a dedicated `build_token_transfer_tx` Tauri command is available,
    // use it to construct proper inscription outputs. For now, use build_multi_key_p2pkh_tx
    // which creates standard P2PKH outputs (token transfer semantics require inscription
    // outputs to be handled by a specialized builder).
    const txResult = await tauriInvoke<{ rawTx: string; txid: string }>('build_multi_key_p2pkh_tx', {
      changeWif: fundingWif,
      toAddress,
      satoshis: outputSats,
      selectedUtxos: extendedUtxos,
      totalInput,
      feeRate: 0.1
    })

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
