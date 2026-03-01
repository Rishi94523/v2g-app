import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import type { TelemetryPayload, DeviceCommand, DecisionState, GridStatus } from '@/types/v2g'
import { getCurrentPrice, getPriceTrend, get24HourForecast } from '@/lib/services/price-service'
import { getGridStatus, simulateGridStress, getAdaptiveRewardWeights } from '@/lib/services/grid-service'
import { getBestAction } from '@/lib/services/reward-shaper'

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Constants
const MAX_CHARGE_RATE_KW = 7.4
const MAX_DISCHARGE_RATE_KW = 5.0

/**
 * POST /api/device/telemetry
 * 
 * Receives BMS data from ESP32 device, makes a decision, returns command
 * 
 * This is the main endpoint that ESP32 devices poll to get their instructions
 */
export async function POST(request: Request) {
    try {
        const payload: TelemetryPayload = await request.json()

        // Validate device token
        const { data: device, error: deviceError } = await supabase
            .from('devices')
            .select('*, user:user_id(id)')
            .eq('device_token', payload.device_token)
            .single()

        if (deviceError || !device) {
            return NextResponse.json(
                { error: 'Invalid device token' },
                { status: 401 }
            )
        }

        // Get user preferences
        const { data: prefs } = await supabase
            .from('user_preferences')
            .select('*')
            .eq('user_id', device.user_id)
            .single()

        const userPrefs = prefs || {
            min_soc_percent: 20,
            disable_discharge: false,
            no_discharge_days: [],
            quiet_hours_start: null,
            quiet_hours_end: null
        }

        // Get current price and grid status
        const priceData = getCurrentPrice()
        const hour = new Date().getHours()

        // Simulate or get grid stress
        const gridStatus: GridStatus = simulateGridStress(priceData.current_price, hour)
        const forecast = get24HourForecast()

        // Build decision state
        const hourRad = (2 * Math.PI * hour) / 24
        const state: DecisionState = {
            soc_percent: payload.bms_data.soc_percent,
            temperature_c: payload.bms_data.temperature_c,
            current_price: priceData.current_price,
            price_forecast: forecast,
            grid_stress_index: gridStatus.stress_index,
            hour_sin: Math.sin(hourRad),
            hour_cos: Math.cos(hourRad),
            day_of_week: new Date().getDay(),
            min_soc: userPrefs.min_soc_percent,
            discharge_allowed: !userPrefs.disable_discharge && !isNoDischargeDay(userPrefs.no_discharge_days)
        }

        // Check safety constraints first
        const safetyCheck = checkSafetyConstraints(
            payload.bms_data.soc_percent,
            payload.bms_data.temperature_c,
            payload.charger_status.connected,
            userPrefs.quiet_hours_start,
            userPrefs.quiet_hours_end
        )

        let command: DeviceCommand

        if (!safetyCheck.safe) {
            // Safety override - force idle or charge
            command = {
                action: safetyCheck.forceCharge ? 'charge' : 'idle',
                rate_kw: safetyCheck.forceCharge ? Math.min(3.7, payload.charger_status.max_power_kw) : 0,
                reason: safetyCheck.reason,
                valid_until: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
                next_poll_seconds: 300,
                ml_confidence: 1.0,
                reward_weights: getAdaptiveRewardWeights(gridStatus.stress_index, state.soc_percent, false)
            }
        } else {
            // Use ML-based decision making
            const { action, reward } = getBestAction(state, userPrefs.disable_discharge)

            const rateKw = action.action_type === 'discharge'
                ? (action.rate_percent / 100) * MAX_DISCHARGE_RATE_KW
                : action.action_type === 'charge'
                    ? (action.rate_percent / 100) * Math.min(MAX_CHARGE_RATE_KW, payload.charger_status.max_power_kw)
                    : 0

            command = {
                action: action.action_type,
                rate_kw: Number(rateKw.toFixed(2)),
                reason: generateReason(action.action_type, priceData.current_price, gridStatus, state.soc_percent),
                valid_until: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
                next_poll_seconds: gridStatus.stress_level === 'critical' ? 60 : 300,
                ml_confidence: 0.85, // Placeholder - would come from actual model
                reward_weights: reward.weights
            }
        }

        // Update device last_seen and telemetry
        await supabase
            .from('devices')
            .update({
                last_seen_at: new Date().toISOString()
            })
            .eq('id', device.id)

        // Log the decision for training data
        await supabase
            .from('decision_logs')
            .insert({
                device_id: device.id,
                soc_percent: state.soc_percent,
                electricity_price: state.current_price,
                decision: command.action,
                rate_kw: command.rate_kw,
                solar_available_kw: null,
                reason: command.reason,
                timestamp: new Date().toISOString()
            })

        return NextResponse.json({
            success: true,
            command,
            grid_status: gridStatus,
            price_info: {
                current: priceData.current_price,
                trend: getPriceTrend(forecast)
            }
        })

    } catch (error) {
        console.error('Telemetry API error:', error)
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        )
    }
}

/**
 * Check safety constraints before making a decision
 */
function checkSafetyConstraints(
    soc: number,
    temp: number,
    connected: boolean,
    quietStart: string | null,
    quietEnd: string | null
): { safe: boolean; reason: string; forceCharge: boolean } {
    // Not connected - must idle
    if (!connected) {
        return { safe: false, reason: 'Charger not connected', forceCharge: false }
    }

    // Temperature out of range
    if (temp < 0) {
        return { safe: false, reason: 'Battery too cold for safe operation', forceCharge: false }
    }
    if (temp > 45) {
        return { safe: false, reason: 'Battery too hot - cooling required', forceCharge: false }
    }

    // Critical low SOC - must charge
    if (soc < 10) {
        return { safe: false, reason: 'Critical low SOC - emergency charging', forceCharge: true }
    }

    // Quiet hours
    if (isQuietHours(quietStart, quietEnd)) {
        return { safe: false, reason: 'Quiet hours - no grid operations', forceCharge: false }
    }

    return { safe: true, reason: '', forceCharge: false }
}

/**
 * Check if today is a no-discharge day
 */
function isNoDischargeDay(noDischargedays: string[]): boolean {
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
    const today = days[new Date().getDay()]
    return noDischargedays.map(d => d.toLowerCase()).includes(today)
}

/**
 * Check if current time is within quiet hours
 */
function isQuietHours(quietStart: string | null, quietEnd: string | null): boolean {
    if (!quietStart || !quietEnd) return false

    const now = new Date()
    const currentTime = now.getHours() * 60 + now.getMinutes()

    const [startH, startM] = quietStart.split(':').map(Number)
    const [endH, endM] = quietEnd.split(':').map(Number)

    const startMinutes = startH * 60 + startM
    const endMinutes = endH * 60 + endM

    if (startMinutes < endMinutes) {
        return currentTime >= startMinutes && currentTime <= endMinutes
    } else {
        return currentTime >= startMinutes || currentTime <= endMinutes
    }
}

/**
 * Generate human-readable reason for the decision
 */
function generateReason(
    action: 'charge' | 'discharge' | 'idle',
    price: number,
    gridStatus: GridStatus,
    soc: number
): string {
    if (action === 'discharge') {
        if (gridStatus.stress_level === 'critical') {
            return `Grid emergency: Supporting grid stability (stress: ${(gridStatus.stress_index * 100).toFixed(0)}%)`
        }
        return `High price alert: ₹${price.toFixed(2)}/kWh - selling to grid`
    }

    if (action === 'charge') {
        if (soc < 30) {
            return `Low battery (${soc}%): Charging to safe level`
        }
        return `Low price opportunity: ₹${price.toFixed(2)}/kWh - buying from grid`
    }

    return `Holding at ${soc}% SOC - waiting for better conditions (₹${price.toFixed(2)}/kWh)`
}

/**
 * GET /api/device/telemetry
 * 
 * Returns current grid and price status (for debugging/monitoring)
 */
export async function GET() {
    const priceData = getCurrentPrice()
    const gridStatus = getGridStatus()

    return NextResponse.json({
        price: priceData,
        grid: gridStatus,
        timestamp: new Date().toISOString()
    })
}
