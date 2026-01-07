import { NextRequest, NextResponse } from 'next/server'
import { isPeakHour } from '@/lib/decision-engine'
import {
    getDeviceByToken,
    createContribution,
    supabaseAdmin
} from '@/lib/supabase'

/**
 * POST /api/contribution
 * 
 * Log a new energy contribution (discharge event)
 * Called when ESP32 completes a discharge cycle
 * 
 * Request body:
 * {
 *   "energy_kwh": 5.5,
 *   "was_emergency": false
 * }
 * 
 * Response:
 * {
 *   "contribution_id": 123,
 *   "tokens_earned": 110,
 *   "message": "Contribution logged successfully"
 * }
 */
export async function POST(request: NextRequest) {
    try {
        // Validate authorization
        const authHeader = request.headers.get('Authorization')
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return NextResponse.json(
                { error: 'Missing or invalid Authorization header' },
                { status: 401 }
            )
        }

        const deviceToken = authHeader.replace('Bearer ', '')

        // Get device from database
        const device = await getDeviceByToken(deviceToken)
        if (!device) {
            return NextResponse.json(
                { error: 'Invalid device token' },
                { status: 401 }
            )
        }

        const body = await request.json()

        // Validate required fields
        if (body.energy_kwh === undefined) {
            return NextResponse.json(
                { error: 'energy_kwh is required' },
                { status: 400 }
            )
        }

        if (body.energy_kwh <= 0) {
            return NextResponse.json(
                { error: 'energy_kwh must be positive' },
                { status: 400 }
            )
        }

        // Determine if peak hour
        const wasPeakHour = isPeakHour()
        const wasEmergency = body.was_emergency || false

        // Create contribution in database
        const result = await createContribution(
            device.user_id,
            device.id,
            body.energy_kwh,
            wasPeakHour,
            wasEmergency
        )

        if (!result) {
            return NextResponse.json(
                { error: 'Failed to log contribution' },
                { status: 500 }
            )
        }

        const multiplier = wasEmergency ? 3 : (wasPeakHour ? 2 : 1)

        console.log(`[Contribution] Device: ${device.name} | Energy: ${body.energy_kwh} kWh | Tokens: ${result.tokens} (${multiplier}x)`)

        return NextResponse.json({
            contribution_id: result.id,
            tokens_earned: result.tokens,
            multiplier: multiplier,
            was_peak_hour: wasPeakHour,
            was_emergency: wasEmergency,
            message: 'Contribution logged successfully. Tokens will be distributed in the next batch.'
        }, { status: 201 })

    } catch (error) {
        console.error('Contribution logging error:', error)
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        )
    }
}

/**
 * GET /api/contribution
 * 
 * Get contribution history for a user/device
 */
export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('user_id')
    const deviceId = searchParams.get('device_id')

    try {
        let query = supabaseAdmin
            .from('contributions')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(50)

        if (userId) {
            query = query.eq('user_id', userId)
        }

        if (deviceId) {
            query = query.eq('device_id', deviceId)
        }

        const { data, error } = await query

        if (error) {
            console.error('Error fetching contributions:', error)
            return NextResponse.json(
                { error: 'Failed to fetch contributions' },
                { status: 500 }
            )
        }

        // Calculate totals
        const totalEnergy = data?.reduce((sum, c) => sum + c.energy_kwh, 0) || 0
        const totalTokens = data?.reduce((sum, c) => sum + c.total_tokens, 0) || 0
        const pendingCount = data?.filter(c => !c.submitted_to_chain).length || 0

        return NextResponse.json({
            contributions: data || [],
            summary: {
                total_contributions: data?.length || 0,
                total_energy_kwh: totalEnergy.toFixed(2),
                total_tokens: totalTokens,
                pending_blockchain: pendingCount
            }
        })
    } catch (error) {
        console.error('Contribution list error:', error)
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        )
    }
}
