import { NextResponse } from 'next/server'
import type { DeviceCommand, TelemetryPayload } from '@/types/v2g'
import { getCurrentPrice, getPriceTrend } from '@/lib/services/price-service'
import { simulateGridStress } from '@/lib/services/grid-service'
import { buildDecisionApiPayload, fetchDeviceDecision, isQuietHours } from '@/lib/device-decision'
import type { DecisionApiResponse } from '@/lib/device-decision'
import { getDeviceByToken, getUserPreferences, logDecision } from '@/lib/supabase'

/**
 * POST /api/device/telemetry
 *
 * ESP32 devices call this endpoint.
 *
 * This backend route:
 * 1. authenticates the device token
 * 2. loads user preferences from Supabase
 * 3. builds the full decision payload
 * 4. calls the hosted Python decision API
 * 5. returns a simple device command to the ESP32
 */
export async function POST(request: Request) {
    try {
        const payload: TelemetryPayload = await request.json()

        if (!payload.device_token) {
            return NextResponse.json(
                { error: 'device_token is required' },
                { status: 400 }
            )
        }

        const device = await getDeviceByToken(payload.device_token)
        if (!device) {
            return NextResponse.json(
                { error: 'Invalid device token' },
                { status: 401 }
            )
        }

        const userPrefs = await getUserPreferences(device.user_id)
        if (!userPrefs) {
            return NextResponse.json(
                { error: 'Failed to load user preferences' },
                { status: 500 }
            )
        }

        const priceData = getCurrentPrice()
        const hour = new Date().getHours()
        const gridStatus = simulateGridStress(priceData.current_price, hour)

        const safetyCheck = checkSafetyConstraints(
            payload.bms_data.soc_percent,
            payload.bms_data.temperature_c,
            payload.charger_status.connected,
            userPrefs.quiet_hours_start,
            userPrefs.quiet_hours_end
        )

        let command: DeviceCommand
        let decisionMeta: DecisionApiResponse | null = null

        if (!safetyCheck.safe) {
            command = {
                action: safetyCheck.forceCharge ? 'charge' : 'idle',
                rate_kw: safetyCheck.forceCharge ? Math.min(3.7, payload.charger_status.max_power_kw) : 0,
                reason: safetyCheck.reason,
                valid_until: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
                next_poll_seconds: 300,
                ml_confidence: 1.0,
            }
        } else {
            const decisionPayload = buildDecisionApiPayload({
                payload,
                device,
                preferences: userPrefs,
                priceData,
                gridStatus,
            })

            const decision = await fetchDeviceDecision(decisionPayload)
            decisionMeta = decision

            command = {
                action: decision.action,
                rate_kw: decision.target_power_kw,
                reason: buildDecisionReason(decision),
                valid_until: new Date(
                    Date.now() + userPrefs.control_interval_minutes * 60 * 1000
                ).toISOString(),
                next_poll_seconds: Math.max(60, userPrefs.control_interval_minutes * 60),
                ml_confidence: 1.0,
            }
        }

        await logDecision(
            device.id,
            payload.bms_data.soc_percent,
            priceData.current_price,
            command.action,
            command.rate_kw,
            null,
            command.reason
        )

        return NextResponse.json({
            success: true,
            command,
            grid_status: gridStatus,
            price_info: {
                current: priceData.current_price,
                trend: getPriceTrend(priceData.forecast_24h),
            },
            decision_engine: decisionMeta
                ? {
                    controller_id: decisionMeta.controller_id,
                    controller_version: decisionMeta.controller_version,
                    controller_mode: decisionMeta.controller_mode,
                    summary: decisionMeta.summary,
                    expected_state: decisionMeta.expected_state,
                }
                : null,
        })
    } catch (error) {
        console.error('Telemetry API error:', error)
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        )
    }
}

export async function GET() {
    const priceData = getCurrentPrice()
    const gridStatus = simulateGridStress(priceData.current_price, new Date().getHours())

    return NextResponse.json({
        status: 'ok',
        endpoint: 'device-telemetry-backend',
        decision_api: process.env.DECISION_API_BASE_URL || 'https://research-api-henna.vercel.app',
        grid_status: gridStatus,
        price_info: {
            current: priceData.current_price,
            trend: getPriceTrend(priceData.forecast_24h),
        },
        timestamp: new Date().toISOString(),
    })
}

function checkSafetyConstraints(
    soc: number,
    temp: number,
    connected: boolean,
    quietStart: string | null,
    quietEnd: string | null
): { safe: boolean; reason: string; forceCharge: boolean } {
    if (!connected) {
        return { safe: false, reason: 'Charger not connected', forceCharge: false }
    }

    if (temp < 0) {
        return { safe: false, reason: 'Battery too cold for safe operation', forceCharge: false }
    }
    if (temp > 45) {
        return { safe: false, reason: 'Battery too hot - cooling required', forceCharge: false }
    }

    if (soc < 10) {
        return { safe: false, reason: 'Critical low SOC - emergency charging', forceCharge: true }
    }

    if (isQuietHours(quietStart, quietEnd)) {
        return { safe: false, reason: 'Quiet hours - no grid operations', forceCharge: false }
    }

    return { safe: true, reason: '', forceCharge: false }
}

function buildDecisionReason(decision: {
    controller_mode: string
    summary: {
        urgency_ratio: number
        price_signal: number
        safe_candidate_count: number
    }
}): string {
    if (decision.controller_mode.includes('service_recovery')) {
        return `Departure recovery mode (urgency ${decision.summary.urgency_ratio.toFixed(2)})`
    }
    if (decision.controller_mode.includes('grid_support')) {
        return 'Grid-support mode selected by decision engine'
    }
    if (decision.controller_mode.includes('profit')) {
        return `Price-spread opportunity detected (${decision.summary.price_signal.toFixed(3)})`
    }
    if (decision.summary.safe_candidate_count === 0) {
        return 'No fully safe candidate available, choosing best recovery action'
    }
    return `Decision engine selected ${decision.controller_mode}`
}
