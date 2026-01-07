import { NextRequest, NextResponse } from 'next/server'
import {
    makeDecision,
    getMockElectricityPrice,
    getMockPriceForecast,
    DecisionInput
} from '@/lib/decision-engine'
import {
    getDeviceByToken,
    getUserPreferences,
    logDecision
} from '@/lib/supabase'

// Default preferences for demo mode (when no device token found)
const DEFAULT_PREFERENCES: {
    min_soc_percent: number
    disable_discharge: boolean
    no_discharge_days: string[]
    quiet_hours_start: string | null
    quiet_hours_end: string | null
} = {
    min_soc_percent: 20,
    disable_discharge: false,
    no_discharge_days: [],
    quiet_hours_start: null,
    quiet_hours_end: null
}

/**
 * POST /api/decision
 * 
 * Called by ESP32 device to get charge/discharge decision
 * 
 * Request body:
 * {
 *   "soc_percent": 65.5,
 *   "battery_temp_c": 28.3,
 *   "solar_power_kw": 2.1,
 *   "grid_connected": true
 * }
 * 
 * Response:
 * {
 *   "action": "charge" | "discharge" | "idle",
 *   "rate_kw": 3.0,
 *   "reason": "...",
 *   "valid_until": "ISO timestamp",
 *   "next_check_seconds": 300
 * }
 */
export async function POST(request: NextRequest) {
    try {
        // Get device token from Authorization header
        const authHeader = request.headers.get('Authorization')
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return NextResponse.json(
                { error: 'Missing or invalid Authorization header' },
                { status: 401 }
            )
        }

        const deviceToken = authHeader.replace('Bearer ', '')

        // Try to get device from database
        const device = await getDeviceByToken(deviceToken)
        let userPreferences = DEFAULT_PREFERENCES

        if (device) {
            // Get user preferences from database
            const prefs = await getUserPreferences(device.user_id)
            if (prefs) {
                userPreferences = {
                    min_soc_percent: prefs.min_soc_percent,
                    disable_discharge: prefs.disable_discharge,
                    no_discharge_days: prefs.no_discharge_days || [],
                    quiet_hours_start: prefs.quiet_hours_start,
                    quiet_hours_end: prefs.quiet_hours_end
                }
            }
        }

        // Parse request body
        const body = await request.json()

        // Validate required fields
        const requiredFields = ['soc_percent', 'battery_temp_c', 'solar_power_kw', 'grid_connected']
        for (const field of requiredFields) {
            if (body[field] === undefined) {
                return NextResponse.json(
                    { error: `Missing required field: ${field}` },
                    { status: 400 }
                )
            }
        }

        // Get current electricity price (mock for now)
        const electricityPrice = getMockElectricityPrice()
        const priceForecast = getMockPriceForecast()

        // Build decision input
        const decisionInput: DecisionInput = {
            soc_percent: body.soc_percent,
            battery_temp_c: body.battery_temp_c,
            solar_power_kw: body.solar_power_kw,
            grid_connected: body.grid_connected,
            electricity_price: electricityPrice,
            price_forecast: priceForecast,
            user_preferences: userPreferences
        }

        // Make decision
        const decision = makeDecision(decisionInput)

        // Log decision to database if device is registered
        if (device) {
            await logDecision(
                device.id,
                body.soc_percent,
                electricityPrice,
                decision.action,
                decision.rate_kw,
                body.solar_power_kw,
                decision.reason
            )
        }

        console.log(`[Decision] Device: ${deviceToken.slice(0, 12)}... | SOC: ${body.soc_percent}% | Price: ₹${electricityPrice.toFixed(2)} | Action: ${decision.action}`)

        return NextResponse.json(decision)

    } catch (error) {
        console.error('Decision API error:', error)
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        )
    }
}

/**
 * GET /api/decision
 * 
 * Health check endpoint
 */
export async function GET() {
    return NextResponse.json({
        status: 'ok',
        service: 'V2G Decision Engine',
        timestamp: new Date().toISOString(),
        mock_price: getMockElectricityPrice().toFixed(2)
    })
}
