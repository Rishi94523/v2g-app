import { NextRequest, NextResponse } from 'next/server'
import {
    getCurrentPrice,
    get24HourForecast,
    getPriceTrend
} from '@/lib/services/price-service'
import { simulateGridStress } from '@/lib/services/grid-service'
import { getBestAction } from '@/lib/services/reward-shaper'
import {
    getDeviceByToken,
    getUserPreferences,
    logDecision
} from '@/lib/supabase'
import type { DecisionState, GridStatus } from '@/types/v2g'

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

const MAX_CHARGE_RATE_KW = 7.4
const MAX_DISCHARGE_RATE_KW = 5.0

/**
 * POST /api/decision
 *
 * Called by dashboard/demo clients to get reward-based charge/discharge decision
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

        const now = new Date()
        const hour = now.getHours()
        const priceData = getCurrentPrice()
        const forecast = get24HourForecast()
        const gridStatus: GridStatus = simulateGridStress(priceData.current_price, hour)

        // Build reward-shaper state
        const hourRad = (2 * Math.PI * hour) / 24
        const state: DecisionState = {
            soc_percent: body.soc_percent,
            temperature_c: body.battery_temp_c,
            current_price: priceData.current_price,
            price_forecast: forecast,
            grid_stress_index: gridStatus.stress_index,
            hour_sin: Math.sin(hourRad),
            hour_cos: Math.cos(hourRad),
            day_of_week: now.getDay(),
            min_soc: userPreferences.min_soc_percent,
            discharge_allowed: !userPreferences.disable_discharge &&
                !isNoDischargeDay(userPreferences.no_discharge_days)
        }

        // Safety checks first
        const safetyCheck = checkSafetyConstraints(
            body.soc_percent,
            body.battery_temp_c,
            body.grid_connected,
            userPreferences.quiet_hours_start,
            userPreferences.quiet_hours_end
        )

        let decision: {
            action: 'charge' | 'discharge' | 'idle'
            rate_kw: number
            reason: string
            valid_until: string
            next_check_seconds: number
            ml_confidence: number
            reward_weights?: {
                profit: number
                grid_stability: number
                battery_health: number
                user_preference: number
            }
        }

        if (!safetyCheck.safe) {
            decision = {
                action: safetyCheck.forceCharge ? 'charge' : 'idle',
                rate_kw: safetyCheck.forceCharge ? Math.min(3.7, MAX_CHARGE_RATE_KW) : 0,
                reason: safetyCheck.reason,
                valid_until: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
                next_check_seconds: 300,
                ml_confidence: 1.0
            }
        } else {
            const { action, reward } = getBestAction(state, userPreferences.disable_discharge)

            const rateKw = action.action_type === 'discharge'
                ? (action.rate_percent / 100) * MAX_DISCHARGE_RATE_KW
                : action.action_type === 'charge'
                    ? (action.rate_percent / 100) * MAX_CHARGE_RATE_KW
                    : 0

            decision = {
                action: action.action_type,
                rate_kw: Number(rateKw.toFixed(2)),
                reason: generateReason(action.action_type, priceData.current_price, gridStatus, state.soc_percent),
                valid_until: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
                next_check_seconds: gridStatus.stress_level === 'critical' ? 60 : 300,
                ml_confidence: 0.85,
                reward_weights: reward.weights
            }
        }

        // Log decision to database if device is registered
        if (device) {
            await logDecision(
                device.id,
                body.soc_percent,
                priceData.current_price,
                decision.action,
                decision.rate_kw,
                body.solar_power_kw,
                decision.reason
            )
        }

        console.log(
            `[Decision] Device: ${deviceToken.slice(0, 12)}... | SOC: ${body.soc_percent}% | Price: INR ${priceData.current_price.toFixed(2)} | Action: ${decision.action}`
        )

        return NextResponse.json({
            ...decision,
            grid_status: gridStatus,
            price_info: {
                current: priceData.current_price,
                trend: getPriceTrend(forecast)
            }
        })

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
        service: 'V2G Reward-Based Decision Engine',
        timestamp: new Date().toISOString(),
        current_price: getCurrentPrice().current_price.toFixed(2)
    })
}

function checkSafetyConstraints(
    soc: number,
    temp: number,
    connected: boolean,
    quietStart: string | null,
    quietEnd: string | null
): { safe: boolean; reason: string; forceCharge: boolean } {
    // Not connected - must idle
    if (!connected) {
        return { safe: false, reason: 'Not connected to grid', forceCharge: false }
    }

    // Temperature out of range
    if (temp < 0) {
        return { safe: false, reason: 'Battery too cold for safe operation', forceCharge: false }
    }
    if (temp > 45) {
        return { safe: false, reason: 'Battery too hot for safe operation', forceCharge: false }
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

function isNoDischargeDay(noDischargeDays: string[]): boolean {
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
    const today = days[new Date().getDay()]
    return noDischargeDays.map((d) => d.toLowerCase()).includes(today)
}

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
    }

    // Quiet hours span midnight
    return currentTime >= startMinutes || currentTime <= endMinutes
}

function generateReason(
    action: 'charge' | 'discharge' | 'idle',
    price: number,
    gridStatus: GridStatus,
    soc: number
): string {
    if (action === 'discharge') {
        if (gridStatus.stress_level === 'critical') {
            return `Grid emergency support (stress ${(gridStatus.stress_index * 100).toFixed(0)}%)`
        }
        return `High price opportunity: INR ${price.toFixed(2)} per kWh`
    }

    if (action === 'charge') {
        if (soc < 30) {
            return `Low battery (${soc}%) - charging to safe level`
        }
        return `Low price opportunity: INR ${price.toFixed(2)} per kWh`
    }

    return `Holding at ${soc}% SOC - waiting for better conditions`
}
