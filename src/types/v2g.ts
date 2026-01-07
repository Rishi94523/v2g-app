/**
 * V2G Type Definitions
 * Shared types for the entire application
 */

// ============ BMS / Device Telemetry ============

export interface BMSData {
    soc_percent: number           // State of Charge (0-100)
    voltage_v: number             // Battery voltage
    current_a: number             // Current (positive = charging, negative = discharging)
    temperature_c: number         // Battery temperature in Celsius
    cell_balance?: number[]       // Individual cell voltages (optional)
}

export interface ChargerStatus {
    connected: boolean            // Is charger physically connected
    max_power_kw: number          // Maximum power the charger can deliver
    charger_type: 'ac_level1' | 'ac_level2' | 'dc_fast'
}

export interface TelemetryPayload {
    device_token: string
    timestamp: string             // ISO 8601 format
    bms_data: BMSData
    charger_status: ChargerStatus
}

// ============ Commands to Device ============

export type V2GAction = 'charge' | 'discharge' | 'idle'

export interface DeviceCommand {
    action: V2GAction
    rate_kw: number               // Power rate in kW (0 = idle)
    reason: string                // Human-readable reason for the decision
    valid_until: string           // ISO timestamp - when this command expires
    next_poll_seconds: number     // When device should poll again

    // ML-specific fields
    ml_confidence?: number        // 0-1 confidence score
    reward_weights?: RewardWeights
}

// ============ Grid & Pricing ============

export interface GridStatus {
    stress_level: 'normal' | 'elevated' | 'critical'  // Manual signal from authority
    stress_index: number          // 0-1 numerical representation
    updated_at: string            // When the status was last updated
}

export interface PriceData {
    current_price: number         // Current price in ₹/kWh
    unit: string                  // e.g., "INR/kWh"
    source: 'mock' | 'dataset' | 'iex_live' | 'electricity-maps'
    timestamp: string
    is_peak_hour: boolean
    forecast_24h: number[]        // Next 24 hours price forecast
    average_forecast: number
    carbon_intensity?: number     // gCO2eq/kWh (from Electricity Maps)
    renewable_percentage?: number // % of power from renewable sources
}

export interface OptimalWindow {
    start: string                 // HH:MM format
    end: string
    avg_price: number
    action: 'buy' | 'sell'
}

// ============ ML / Decision Engine ============

export interface RewardWeights {
    profit: number                // Weight for profit optimization (0-1)
    grid_stability: number        // Weight for grid support (0-1)
    battery_health: number        // Weight for battery longevity (0-1)
    user_preference: number       // Weight for user settings (0-1)
}

export interface DecisionState {
    // Battery state
    soc_percent: number
    temperature_c: number

    // Grid state
    current_price: number
    price_forecast: number[]
    grid_stress_index: number

    // Time features (cyclical encoding)
    hour_sin: number              // sin(2π * hour/24)
    hour_cos: number              // cos(2π * hour/24)
    day_of_week: number           // 0-6

    // User preferences
    min_soc: number
    discharge_allowed: boolean
}

export interface DecisionAction {
    action_type: V2GAction
    rate_percent: number          // 0, 25, 50, 75, or 100 percent of max rate
}

export interface Experience {
    state: DecisionState
    action: DecisionAction
    reward: number
    next_state: DecisionState
    done: boolean
}

// ============ User Preferences ============

export interface UserPreferences {
    min_soc_percent: number       // Never discharge below this
    disable_discharge: boolean    // User can disable all discharging
    no_discharge_days: string[]   // Days when discharge is disabled
    quiet_hours_start: string | null  // HH:MM format
    quiet_hours_end: string | null
    wallet_address: string | null // For token rewards
}

// ============ Database Models ============

export interface Device {
    id: string
    user_id: string
    name: string
    device_token: string
    wallet_address: string | null
    last_seen_at: string | null
    last_telemetry: BMSData | null
    created_at: string
}

export interface DecisionLog {
    id: string
    device_id: string
    timestamp: string
    state: DecisionState
    action: DeviceCommand
    reward: number | null         // Calculated after observing outcome
}

export interface Contribution {
    id: string
    device_id: string
    user_id: string
    timestamp: string
    action: V2GAction
    energy_kwh: number
    price_at_time: number
    grid_stress_at_time: number
    tokens_earned: number
}

// ============ API Responses ============

export interface TelemetryResponse {
    success: boolean
    command: DeviceCommand
    grid_status: GridStatus
    price_info: {
        current: number
        trend: 'rising' | 'falling' | 'stable'
    }
}

export interface PriceResponse extends PriceData {
    recommendation: string
    best_buy_time: OptimalWindow | null
    best_sell_time: OptimalWindow | null
    optimal_windows: OptimalWindow[]
}

// ============ Training Data ============

export interface TrainingEpisode {
    episode_id: string
    steps: Experience[]
    total_reward: number
    profit_earned: number
    grid_contribution: number
    battery_degradation: number
}

export interface ModelCheckpoint {
    version: string
    timestamp: string
    weights: number[][]
    performance_metrics: {
        avg_reward: number
        avg_profit: number
        episodes_trained: number
    }
}
