import { supabaseAdmin } from './supabase'
import {
    isBlockchainDistributionConfigured,
    settleContributionsOnChain
} from './blockchain-admin'

interface PendingContributionRow {
    id: number
    user_id: string
    device_id: string
    energy_kwh: number
    was_peak_hour: boolean
    was_emergency: boolean
}

interface UserWalletRow {
    user_id: string
    wallet_address: string | null
}

interface DeviceWalletRow {
    id: string
    wallet_address: string | null
}

export interface SettlementProcessOptions {
    limit?: number
    dryRun?: boolean
    contributionIds?: number[]
}

export interface SettlementProcessResult {
    success: boolean
    dry_run?: boolean
    pending: number
    eligible: number
    skipped: number
    processed: number
    processed_ids?: number[]
    tx_hash?: string
    gas_used?: string
    effective_gas_price_wei?: string
    fee_wei?: string
    block_number?: number
    reconciliation_matched?: number
    reconciliation_mismatched?: number
    message?: string
}

function isWalletAddress(address: string | null | undefined): address is string {
    return !!address && /^0x[a-fA-F0-9]{40}$/.test(address)
}

export async function settlePendingContributions(
    options: SettlementProcessOptions = {}
): Promise<SettlementProcessResult> {
    const limit = Math.min(Math.max(options.limit || 20, 1), 100)

    let query = supabaseAdmin
        .from('contributions')
        .select('id,user_id,device_id,energy_kwh,was_peak_hour,was_emergency')
        .eq('submitted_to_chain', false)
        .order('created_at', { ascending: true })
        .limit(limit)

    if (options.contributionIds && options.contributionIds.length > 0) {
        query = query.in('id', options.contributionIds)
    }

    const { data: pendingRows, error: pendingError } = await query

    if (pendingError) {
        throw new Error(`Failed to load pending contributions: ${pendingError.message}`)
    }

    const pending = (pendingRows || []) as PendingContributionRow[]
    if (pending.length === 0) {
        return {
            success: true,
            pending: 0,
            eligible: 0,
            skipped: 0,
            processed: 0,
            message: 'No pending contributions to settle'
        }
    }

    const userIds = [...new Set(pending.map((c) => c.user_id))]
    const deviceIds = [...new Set(pending.map((c) => c.device_id))]

    const [{ data: userWalletRows }, { data: deviceWalletRows }] = await Promise.all([
        supabaseAdmin
            .from('user_preferences')
            .select('user_id,wallet_address')
            .in('user_id', userIds),
        supabaseAdmin
            .from('devices')
            .select('id,wallet_address')
            .in('id', deviceIds),
    ])

    const userWalletMap = new Map(
        ((userWalletRows || []) as UserWalletRow[]).map((u) => [u.user_id, u.wallet_address])
    )
    const deviceWalletMap = new Map(
        ((deviceWalletRows || []) as DeviceWalletRow[]).map((d) => [d.id, d.wallet_address])
    )

    const eligible = pending
        .map((row) => {
            const walletAddress =
                userWalletMap.get(row.user_id) || deviceWalletMap.get(row.device_id) || null

            return {
                ...row,
                walletAddress
            }
        })
        .filter((row) => isWalletAddress(row.walletAddress))

    const skipped = pending.length - eligible.length

    if (options.dryRun) {
        return {
            success: true,
            dry_run: true,
            pending: pending.length,
            eligible: eligible.length,
            skipped,
            processed: 0,
            processed_ids: eligible.slice(0, 20).map((r) => r.id),
            message: 'Dry run completed'
        }
    }

    if (!isBlockchainDistributionConfigured()) {
        throw new Error('Blockchain distribution not configured')
    }

    if (eligible.length === 0) {
        return {
            success: true,
            pending: pending.length,
            eligible: 0,
            skipped,
            processed: 0,
            message: 'No eligible rows with valid wallet addresses'
        }
    }

    const settlement = await settleContributionsOnChain(
        eligible.map((row) => ({
            id: row.id,
            walletAddress: row.walletAddress!,
            energyKwh: row.energy_kwh,
            wasPeakHour: row.was_peak_hour,
            wasEmergency: row.was_emergency
        }))
    )

    const nowIso = new Date().toISOString()
    const { error: updateError } = await supabaseAdmin
        .from('contributions')
        .update({
            submitted_to_chain: true,
            submitted_at: nowIso,
            tx_hash: settlement.txHash
        })
        .in('id', settlement.processedIds)

    if (updateError) {
        throw new Error(`On-chain settlement succeeded but DB update failed: ${updateError.message}`)
    }

    const { data: verifiedRows, error: verifyError } = await supabaseAdmin
        .from('contributions')
        .select('id')
        .in('id', settlement.processedIds)
        .eq('submitted_to_chain', true)
        .eq('tx_hash', settlement.txHash)

    if (verifyError) {
        throw new Error(`Settlement verification failed: ${verifyError.message}`)
    }

    const matched = (verifiedRows || []).length

    return {
        success: true,
        pending: pending.length,
        eligible: eligible.length,
        skipped,
        processed: settlement.processedIds.length,
        processed_ids: settlement.processedIds,
        tx_hash: settlement.txHash,
        gas_used: settlement.gasUsed,
        effective_gas_price_wei: settlement.effectiveGasPriceWei,
        fee_wei: settlement.feeWei,
        block_number: settlement.blockNumber,
        reconciliation_matched: matched,
        reconciliation_mismatched: settlement.processedIds.length - matched
    }
}
