import { NextRequest, NextResponse } from 'next/server'
import { settlePendingContributions } from '@/lib/blockchain-settlement'

const DEFAULT_BATCH_LIMIT = 20

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
        const result = await settlePendingContributions({ limit, dryRun })
        return NextResponse.json(result)
    } catch (error) {
        console.error('Contribution settlement error:', error)
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        )
    }
}
