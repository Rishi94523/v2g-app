import type { Device, UserPreferences } from '@/lib/supabase'
import type { GridStatus, PriceData, TelemetryPayload } from '@/types/v2g'

export interface DecisionApiRequest {
    request_id?: string
    controller_id: 'contextual_safety_gated_experts' | 'lexicographic_service' | 'adaptive' | 'fixed_repo' | 'fixed_service'
    telemetry: {
        device_id: string
        timestamp_utc: string
        battery_soc: number
        battery_capacity_kwh: number
        battery_temperature_c?: number
        current_power_kw?: number
        operating_mode?: string
    }
    session: {
        hours_to_departure: number
        target_departure_soc: number
        minimum_soc: number
        maximum_soc: number
        allow_v2g: boolean
        max_charge_kw: number
        max_discharge_kw: number
        control_interval_hours: number
    }
    context: {
        price_per_kwh: number
        future_average_price_per_kwh: number
        grid_stress_index: number
    }
}

export interface DecisionApiResponse {
    request_id: string
    controller_id: string
    controller_version: string
    decision_ts_utc: string
    action: 'charge' | 'discharge' | 'idle'
    target_power_kw: number
    signed_power_kw: number
    controller_mode: string
    summary: {
        battery_soc: number
        urgency_ratio: number
        slack_hours: number
        price_signal: number
        safe_candidate_count: number
    }
    expected_state: {
        soc_after_interval: number
        energy_after_kwh: number
        remaining_required_kwh: number
        reserve_after_kwh: number
    }
}

const DEFAULT_DECISION_API_BASE_URL = 'https://research-api-henna.vercel.app'
const DEFAULT_TIMEZONE = 'Asia/Kolkata'
const DEFAULT_BATTERY_CAPACITY_KWH = 75

export function isNoDischargeDay(noDischargeDays: string[]): boolean {
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
    const today = days[new Date().getDay()]
    return noDischargeDays.map((value) => value.toLowerCase()).includes(today)
}

export function isQuietHours(quietStart: string | null, quietEnd: string | null): boolean {
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

    return currentTime >= startMinutes || currentTime <= endMinutes
}

function getCurrentMinutesInTimezone(timezone: string): number {
    const formatter = new Intl.DateTimeFormat('en-GB', {
        timeZone: timezone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    })

    const parts = formatter.formatToParts(new Date())
    const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0')
    const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '0')
    return hour * 60 + minute
}

export function computeHoursToDeparture(
    preferredDepartureTime: string | null,
    timezoneName: string | null,
): number {
    if (!preferredDepartureTime) {
        return 8
    }

    const [targetHour, targetMinute] = preferredDepartureTime.split(':').map(Number)
    const targetMinutes = targetHour * 60 + targetMinute
    const currentMinutes = getCurrentMinutesInTimezone(timezoneName || DEFAULT_TIMEZONE)
    let diffMinutes = targetMinutes - currentMinutes

    if (diffMinutes <= 0) {
        diffMinutes += 24 * 60
    }

    return Math.max(0.25, Number((diffMinutes / 60).toFixed(3)))
}

function normalizePriceForDecisionEngine(pricePerKwh: number): number {
    // The deployed controller was benchmarked on sub-unit price scales.
    // Normalize the current app's INR-like price range into a comparable band.
    return Number((pricePerKwh / 50).toFixed(6))
}

export function buildDecisionApiPayload(args: {
    payload: TelemetryPayload
    device: Device
    preferences: UserPreferences
    priceData: PriceData
    gridStatus: GridStatus
}): DecisionApiRequest {
    const { payload, device, preferences, priceData, gridStatus } = args
    const allowV2G =
        !preferences.disable_discharge &&
        !isNoDischargeDay(preferences.no_discharge_days || []) &&
        !isQuietHours(preferences.quiet_hours_start, preferences.quiet_hours_end)

    const normalizedCurrentPrice = normalizePriceForDecisionEngine(priceData.current_price)
    const normalizedFutureAveragePrice = normalizePriceForDecisionEngine(priceData.average_forecast)

    return {
        controller_id: 'contextual_safety_gated_experts',
        telemetry: {
            device_id: device.id,
            timestamp_utc: payload.timestamp,
            battery_soc: Number((payload.bms_data.soc_percent / 100).toFixed(6)),
            battery_capacity_kwh: payload.battery_capacity_kwh ?? DEFAULT_BATTERY_CAPACITY_KWH,
            battery_temperature_c: payload.bms_data.temperature_c,
            current_power_kw: Number(
                ((payload.bms_data.voltage_v * payload.bms_data.current_a) / 1000).toFixed(3)
            ),
            operating_mode: payload.bms_data.current_a > 0 ? 'charge' : payload.bms_data.current_a < 0 ? 'discharge' : 'idle',
        },
        session: {
            hours_to_departure: computeHoursToDeparture(
                preferences.preferred_departure_time,
                preferences.timezone_name,
            ),
            target_departure_soc: Number((preferences.target_departure_soc_percent / 100).toFixed(6)),
            minimum_soc: Number((preferences.min_soc_percent / 100).toFixed(6)),
            maximum_soc: Number((preferences.max_soc_percent / 100).toFixed(6)),
            allow_v2g: allowV2G,
            max_charge_kw: Number(Math.min(payload.charger_status.max_power_kw, preferences.max_charge_kw).toFixed(3)),
            max_discharge_kw: Number(preferences.max_discharge_kw.toFixed(3)),
            control_interval_hours: Number((preferences.control_interval_minutes / 60).toFixed(6)),
        },
        context: {
            price_per_kwh: normalizedCurrentPrice,
            future_average_price_per_kwh: normalizedFutureAveragePrice,
            grid_stress_index: gridStatus.stress_index,
        },
    }
}

export async function fetchDeviceDecision(
    body: DecisionApiRequest,
): Promise<DecisionApiResponse> {
    const baseUrl = process.env.DECISION_API_BASE_URL || DEFAULT_DECISION_API_BASE_URL
    const response = await fetch(`${baseUrl}/v1/decisions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        cache: 'no-store',
    })

    if (!response.ok) {
        const text = await response.text()
        throw new Error(`Decision API failed (${response.status}): ${text}`)
    }

    return response.json() as Promise<DecisionApiResponse>
}

