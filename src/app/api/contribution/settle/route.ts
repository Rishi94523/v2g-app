import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import {
    isBlockchainDistributionConfigured,
    settleContributionsOnChain
} from '@/lib/blockchain-admin'

const DEFAULT_BATCH_LIMIT = 20

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

function isWalletAddress(address: string | null | undefined): address is string {
    return !!address && /^0x[a-fA-F0-9]{40}$/.test(address)
}

/**
 * POST /api/contribution/settle
 *
 * Settles pending contribution rows on Sepolia via RewardDistributor.
 * This endpoint should be called by a backend job/admin tool, not directly by devices.
 */
export async function POST(request: NextRequest) {
    try {
        const body = await request.json().catch(() => ({}))
        const limit = Math.min(Number(body.limit) || DEFAULT_BATCH_LIMIT, 100)
        const dryRun = Boolean(body.dry_run)
        const adminKey = body.admin_key as string | undefined

        const expectedAdminKey = process.env.BLOCKCHAIN_ADMIN_API_KEY
        if (expectedAdminKey && adminKey !== expectedAdminKey) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const { data: pendingRows, error: pendingError } = await supabaseAdmin
            .from('contributions')
            .select('id,user_id,device_id,energy_kwh,was_peak_hour,was_emergency')
            .eq('submitted_to_chain', false)
            .order('created_at', { ascending: true })
            .limit(limit)

        if (pendingError) {
            console.error('Failed to load pending contributions:', pendingError)
            return NextResponse.json(
                { error: 'Failed to load pending contributions' },
                { status: 500 }
            )
        }

        const pending = (pendingRows || []) as PendingContributionRow[]
        if (pending.length === 0) {
            return NextResponse.json({
                success: true,
                processed: 0,
                skipped: 0,
                message: 'No pending contributions to settle'
            })
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

        if (dryRun) {
            return NextResponse.json({
                success: true,
                dry_run: true,
                pending: pending.length,
                eligible: eligible.length,
                skipped,
                sample_ids: eligible.slice(0, 10).map((r) => r.id)
            })
        }

        if (!isBlockchainDistributionConfigured()) {
            return NextResponse.json(
                {
                    error: 'Blockchain distribution not configured (missing RPC, private key, or distributor address)',
                    eligible: eligible.length,
                    skipped
                },
                { status: 400 }
            )
        }

        if (eligible.length === 0) {
            return NextResponse.json({
                success: true,
                processed: 0,
                skipped,
                message: 'No eligible rows with valid wallet addresses'
            })
        }

        const { txHash, processedIds } = await settleContributionsOnChain(
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
                tx_hash: txHash
            })
            .in('id', processedIds)

        if (updateError) {
            console.error('On-chain settlement succeeded but DB update failed:', updateError)
            return NextResponse.json(
                {
                    error: 'On-chain settlement succeeded, but DB update failed',
                    tx_hash: txHash,
                    processed_ids: processedIds
                },
                { status: 500 }
            )
        }

        return NextResponse.json({
            success: true,
            tx_hash: txHash,
            processed: processedIds.length,
            skipped
        })
    } catch (error) {
        console.error('Contribution settlement error:', error)
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        )
    }
}
