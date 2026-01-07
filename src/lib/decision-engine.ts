/**
 * Decision Engine Logic
 * Determines optimal charge/discharge/idle action based on multiple factors
 */

export interface DecisionInput {
    soc_percent: number          // Current state of charge (0-100)
    battery_temp_c: number       // Battery temperature in Celsius
    solar_power_kw: number       // Currently available solar power
    grid_connected: boolean      // Whether connected to grid
    electricity_price: number    // Current price in ₹/kWh
    price_forecast: number[]     // Next 24 hours prices
    user_preferences: {
        min_soc_percent: number
        disable_discharge: boolean
        no_discharge_days: string[]
        quiet_hours_start: string | null
        quiet_hours_end: string | null
    }
}

export interface DecisionOutput {
    action: 'charge' | 'discharge' | 'idle'
    rate_kw: number
    reason: string
    valid_until: string          // ISO timestamp
    next_check_seconds: number
}

// Constants for decision making
const BATTERY_CAPACITY_KWH = 40        // Typical EV battery
const MAX_CHARGE_RATE_KW = 7.4         // Level 2 charger
const MAX_DISCHARGE_RATE_KW = 5.0      // V2G discharge limit
const DEGRADATION_COST_PER_KWH = 0.5   // ₹ cost per kWh cycled (battery wear)
const PRICE_THRESHOLD_HIGH = 8         // ₹/kWh - consider selling above this
const PRICE_THRESHOLD_LOW = 4          // ₹/kWh - consider buying below this

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
        // Quiet hours span midnight
        return currentTime >= startMinutes || currentTime <= endMinutes
    }
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
 * Calculate optimal charge rate based on solar availability
 */
function calculateChargeRate(solarPower: number, gridPrice: number): number {
    // If solar is available, charge at solar rate
    if (solarPower > 0.5) {
        return Math.min(solarPower, MAX_CHARGE_RATE_KW)
    }

    // If grid price is low, charge from grid
    if (gridPrice < PRICE_THRESHOLD_LOW) {
        return MAX_CHARGE_RATE_KW
    }

    // Moderate price - slow charge
    return MAX_CHARGE_RATE_KW * 0.5
}

/**
 * Calculate optimal discharge rate based on price
 */
function calculateDischargeRate(price: number, soc: number): number {
    // Higher SOC = can afford higher discharge rate
    const socFactor = Math.min(1, (soc - 30) / 50) // Scale from 30-80% SOC

    // Higher price = more aggressive discharge
    const priceFactor = Math.min(1, (price - PRICE_THRESHOLD_HIGH) / 10)

    return MAX_DISCHARGE_RATE_KW * Math.max(0.3, socFactor * priceFactor)
}

/**
 * Check if battery temperature is safe for operations
 */
function isSafeTemperature(temp: number): { safe: boolean; reason?: string } {
    if (temp < 0) {
        return { safe: false, reason: 'Battery too cold for safe operation' }
    }
    if (temp > 45) {
        return { safe: false, reason: 'Battery too hot for safe operation' }
    }
    return { safe: true }
}

/**
 * Main decision function
 */
export function makeDecision(input: DecisionInput): DecisionOutput {
    const now = new Date()
    const prefs = input.user_preferences

    // Default response
    const defaultResponse: DecisionOutput = {
        action: 'idle',
        rate_kw: 0,
        reason: 'Default idle state',
        valid_until: new Date(now.getTime() + 5 * 60 * 1000).toISOString(),
        next_check_seconds: 300
    }

    // Safety checks
    if (!input.grid_connected) {
        return {
            ...defaultResponse,
            reason: 'Not connected to grid'
        }
    }

    const tempCheck = isSafeTemperature(input.battery_temp_c)
    if (!tempCheck.safe) {
        return {
            ...defaultResponse,
            reason: tempCheck.reason!
        }
    }

    // User preference checks
    if (isQuietHours(prefs.quiet_hours_start, prefs.quiet_hours_end)) {
        return {
            ...defaultResponse,
            reason: 'Quiet hours - no grid operations'
        }
    }

    // Check minimum SOC
    if (input.soc_percent <= prefs.min_soc_percent) {
        // Must charge to maintain minimum
        return {
            action: 'charge',
            rate_kw: calculateChargeRate(input.solar_power_kw, input.electricity_price),
            reason: `SOC below minimum (${prefs.min_soc_percent}%), charging required`,
            valid_until: new Date(now.getTime() + 15 * 60 * 1000).toISOString(),
            next_check_seconds: 300
        }
    }

    // Decision logic based on price and availability
    const price = input.electricity_price
    const avgFuturePrice = input.price_forecast.length > 0
        ? input.price_forecast.reduce((a, b) => a + b, 0) / input.price_forecast.length
        : price

    // Discharge logic (sell to grid)
    const canDischarge = !prefs.disable_discharge &&
        !isNoDischargeDay(prefs.no_discharge_days) &&
        input.soc_percent > prefs.min_soc_percent + 10

    if (canDischarge && price > PRICE_THRESHOLD_HIGH && price > avgFuturePrice * 1.1) {
        // Price is high and higher than average - good time to sell
        const profit = price - DEGRADATION_COST_PER_KWH
        if (profit > 2) { // Only if profit is meaningful
            return {
                action: 'discharge',
                rate_kw: calculateDischargeRate(price, input.soc_percent),
                reason: `High electricity price (₹${price}/kWh), profitable to discharge`,
                valid_until: new Date(now.getTime() + 30 * 60 * 1000).toISOString(),
                next_check_seconds: 600
            }
        }
    }

    // Charge logic (buy from grid or use solar)
    const shouldCharge = (
        input.solar_power_kw > 1.0 ||           // Solar is available
        price < PRICE_THRESHOLD_LOW ||          // Price is low
        (price < avgFuturePrice * 0.9 && input.soc_percent < 70) // Price lower than future
    )

    if (shouldCharge && input.soc_percent < 90) {
        const reason = input.solar_power_kw > 1.0
            ? `Using solar power (${input.solar_power_kw.toFixed(1)} kW available)`
            : `Low electricity price (₹${price}/kWh)`

        return {
            action: 'charge',
            rate_kw: calculateChargeRate(input.solar_power_kw, price),
            reason,
            valid_until: new Date(now.getTime() + 30 * 60 * 1000).toISOString(),
            next_check_seconds: 600
        }
    }

    // Default: idle
    return {
        ...defaultResponse,
        reason: `Price ₹${price}/kWh is moderate, waiting for better conditions`
    }
}

/**
 * Check if current hour is peak hour (typically 6-10 PM in India)
 */
export function isPeakHour(): boolean {
    const hour = new Date().getHours()
    return hour >= 18 && hour <= 22
}

/**
 * Get mock electricity price (replace with real API later)
 */
export function getMockElectricityPrice(): number {
    const hour = new Date().getHours()

    // Simulated time-of-use pricing
    if (hour >= 18 && hour <= 22) {
        return 10 + Math.random() * 4  // Peak: ₹10-14/kWh
    } else if (hour >= 6 && hour <= 9) {
        return 7 + Math.random() * 2   // Morning: ₹7-9/kWh
    } else if (hour >= 23 || hour <= 5) {
        return 3 + Math.random() * 2   // Night: ₹3-5/kWh
    } else {
        return 5 + Math.random() * 3   // Off-peak: ₹5-8/kWh
    }
}

/**
 * Get 24-hour price forecast (mock)
 */
export function getMockPriceForecast(): number[] {
    const forecast: number[] = []
    const currentHour = new Date().getHours()

    for (let i = 0; i < 24; i++) {
        const hour = (currentHour + i) % 24
        if (hour >= 18 && hour <= 22) {
            forecast.push(10 + Math.random() * 4)
        } else if (hour >= 6 && hour <= 9) {
            forecast.push(7 + Math.random() * 2)
        } else if (hour >= 23 || hour <= 5) {
            forecast.push(3 + Math.random() * 2)
        } else {
            forecast.push(5 + Math.random() * 3)
        }
    }

    return forecast
}
