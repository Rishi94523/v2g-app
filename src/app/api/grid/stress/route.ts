import { NextResponse } from 'next/server'
import { setGridStress, getGridStatus } from '@/lib/services/grid-service'

/**
 * POST /api/grid/stress
 * 
 * Set grid stress level (simulates municipality/authority signal)
 * In production, this would be called by the power utility's system
 */
export async function POST(request: Request) {
    try {
        const { level, api_key } = await request.json()

        // Simple API key protection (in production, use proper auth)
        const expectedKey = process.env.GRID_API_KEY || 'demo-grid-key'
        if (api_key !== expectedKey) {
            return NextResponse.json(
                { error: 'Unauthorized' },
                { status: 401 }
            )
        }

        // Validate stress level
        if (!['normal', 'elevated', 'critical'].includes(level)) {
            return NextResponse.json(
                { error: 'Invalid stress level. Must be: normal, elevated, or critical' },
                { status: 400 }
            )
        }

        const newStatus = setGridStress(level)

        return NextResponse.json({
            success: true,
            message: `Grid stress set to ${level}`,
            status: newStatus
        })

    } catch (error) {
        console.error('Grid stress API error:', error)
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        )
    }
}

/**
 * GET /api/grid/stress
 * 
 * Get current grid status
 */
export async function GET() {
    const status = getGridStatus()
    return NextResponse.json(status)
}
