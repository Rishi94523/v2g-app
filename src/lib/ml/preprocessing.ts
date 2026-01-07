/**
 * Data Preprocessing Pipeline
 *
 * Prepares training data from IEX prices + EV charging patterns
 * Creates normalized state vectors for the DQN agent
 */

import type { DecisionState, Experience } from '@/types/v2g'

// Normalization constants (based on IEX dataset analysis)
export const NORMALIZATION = {
    price: { min: 0.5, max: 15.0 },      // ₹/kWh range from IEX data
    soc: { min: 0, max: 100 },            // Percentage
    temperature: { min: 0, max: 50 },     // Celsius
    gridStress: { min: 0, max: 1 },       // Already 0-1
}

// State vector size for DQN input
export const STATE_SIZE = 14

// Action space: 0=idle, 1-4=charge@25/50/75/100%, 5-8=discharge@25/50/75/100%
export const ACTION_SIZE = 9

export interface NormalizedState {
    vector: number[]      // Flattened normalized state vector
    original: DecisionState
}

export interface TrainingDataPoint {
    state: number[]
    action: number        // Action index (0-8)
    reward: number
    nextState: number[]
    done: boolean
}

/**
 * Normalize a value to 0-1 range
 */
export function normalize(value: number, min: number, max: number): number {
    return Math.max(0, Math.min(1, (value - min) / (max - min)))
}

/**
 * Denormalize a value from 0-1 range back to original scale
 */
export function denormalize(value: number, min: number, max: number): number {
    return value * (max - min) + min
}

/**
 * Convert DecisionState to normalized vector for DQN input
 *
 * State vector components (14 total):
 * [0]    SOC (0-1)
 * [1]    Temperature (0-1)
 * [2]    Current price (0-1)
 * [3-8]  Price forecast next 6 hours (0-1 each)
 * [9]    Grid stress index (0-1)
 * [10]   Hour sin (already -1 to 1, shift to 0-1)
 * [11]   Hour cos (already -1 to 1, shift to 0-1)
 * [12]   Min SOC threshold (0-1)
 * [13]   Discharge allowed (0 or 1)
 */
export function stateToVector(state: DecisionState): number[] {
    const vector: number[] = []

    // Battery state
    vector.push(normalize(state.soc_percent, NORMALIZATION.soc.min, NORMALIZATION.soc.max))
    vector.push(normalize(state.temperature_c, NORMALIZATION.temperature.min, NORMALIZATION.temperature.max))

    // Price (current + 6hr forecast)
    vector.push(normalize(state.current_price, NORMALIZATION.price.min, NORMALIZATION.price.max))

    // Take first 6 hours of forecast, pad with current price if needed
    const forecast = state.price_forecast.slice(0, 6)
    while (forecast.length < 6) {
        forecast.push(state.current_price)
    }
    for (const price of forecast) {
        vector.push(normalize(price, NORMALIZATION.price.min, NORMALIZATION.price.max))
    }

    // Grid state
    vector.push(state.grid_stress_index) // Already 0-1

    // Time features (shift from [-1,1] to [0,1])
    vector.push((state.hour_sin + 1) / 2)
    vector.push((state.hour_cos + 1) / 2)

    // User preferences
    vector.push(normalize(state.min_soc, NORMALIZATION.soc.min, NORMALIZATION.soc.max))
    vector.push(state.discharge_allowed ? 1 : 0)

    return vector
}

/**
 * Convert action index to DecisionAction
 */
export function indexToAction(index: number): { action_type: 'idle' | 'charge' | 'discharge', rate_percent: number } {
    if (index === 0) {
        return { action_type: 'idle', rate_percent: 0 }
    } else if (index >= 1 && index <= 4) {
        return { action_type: 'charge', rate_percent: index * 25 }
    } else {
        return { action_type: 'discharge', rate_percent: (index - 4) * 25 }
    }
}

/**
 * Convert DecisionAction to action index
 */
export function actionToIndex(action_type: string, rate_percent: number): number {
    if (action_type === 'idle') {
        return 0
    } else if (action_type === 'charge') {
        return Math.round(rate_percent / 25)
    } else {
        return 4 + Math.round(rate_percent / 25)
    }
}

/**
 * Generate synthetic training episode from historical data
 *
 * @param prices - Array of hourly prices
 * @param startSoc - Initial SOC
 * @param duration - Episode length in hours
 */
export function generateEpisode(
    prices: number[],
    startSoc: number = 50,
    duration: number = 24
): TrainingDataPoint[] {
    const episode: TrainingDataPoint[] = []
    let currentSoc = startSoc

    const BATTERY_CAPACITY_KWH = 60  // Typical EV battery
    const MAX_CHARGE_RATE = 7.4      // kW (Level 2)
    const MAX_DISCHARGE_RATE = 5.0   // kW

    for (let hour = 0; hour < duration && hour < prices.length - 1; hour++) {
        const hourRad = (2 * Math.PI * hour) / 24

        // Build current state
        const state: DecisionState = {
            soc_percent: currentSoc,
            temperature_c: 25 + Math.random() * 10, // Simulate temp 25-35°C
            current_price: prices[hour],
            price_forecast: prices.slice(hour, hour + 24),
            grid_stress_index: simulateGridStress(prices[hour], hour),
            hour_sin: Math.sin(hourRad),
            hour_cos: Math.cos(hourRad),
            day_of_week: Math.floor(Math.random() * 7),
            min_soc: 20,
            discharge_allowed: true
        }

        // Convert to vector
        const stateVector = stateToVector(state)

        // Simple greedy action selection for data generation
        const action = selectGreedyAction(state)
        const actionIndex = actionToIndex(action.action_type, action.rate_percent)

        // Simulate battery change
        const rateKw = action.action_type === 'charge'
            ? (action.rate_percent / 100) * MAX_CHARGE_RATE
            : action.action_type === 'discharge'
                ? (action.rate_percent / 100) * MAX_DISCHARGE_RATE
                : 0

        const energyKwh = rateKw * 1.0  // 1 hour step

        if (action.action_type === 'charge') {
            currentSoc = Math.min(100, currentSoc + (energyKwh / BATTERY_CAPACITY_KWH) * 100)
        } else if (action.action_type === 'discharge') {
            currentSoc = Math.max(0, currentSoc - (energyKwh / BATTERY_CAPACITY_KWH) * 100)
        }

        // Build next state
        const nextHourRad = (2 * Math.PI * (hour + 1)) / 24
        const nextState: DecisionState = {
            soc_percent: currentSoc,
            temperature_c: 25 + Math.random() * 10,
            current_price: prices[hour + 1],
            price_forecast: prices.slice(hour + 1, hour + 25),
            grid_stress_index: simulateGridStress(prices[hour + 1], hour + 1),
            hour_sin: Math.sin(nextHourRad),
            hour_cos: Math.cos(nextHourRad),
            day_of_week: Math.floor(Math.random() * 7),
            min_soc: 20,
            discharge_allowed: true
        }

        const nextStateVector = stateToVector(nextState)

        // Calculate reward
        const reward = calculateSimpleReward(state, action, prices[hour], state.grid_stress_index)

        episode.push({
            state: stateVector,
            action: actionIndex,
            reward,
            nextState: nextStateVector,
            done: hour === duration - 1
        })
    }

    return episode
}

/**
 * Simulate grid stress based on price and hour
 */
function simulateGridStress(price: number, hour: number): number {
    // Higher stress during peak hours and high prices
    const isPeak = hour >= 18 && hour <= 22
    const priceStress = normalize(price, NORMALIZATION.price.min, NORMALIZATION.price.max)

    let stress = priceStress * 0.6  // Base from price
    if (isPeak) {
        stress += 0.3  // Peak hour boost
    }

    // Add some randomness
    stress += (Math.random() - 0.5) * 0.1

    return Math.max(0, Math.min(1, stress))
}

/**
 * Simple greedy action selection for generating training data
 */
function selectGreedyAction(state: DecisionState): { action_type: 'idle' | 'charge' | 'discharge', rate_percent: number } {
    const avgPrice = state.price_forecast.slice(0, 6).reduce((a, b) => a + b, 0) / 6
    const currentPrice = state.current_price
    const soc = state.soc_percent

    // Low battery - must charge
    if (soc < 20) {
        return { action_type: 'charge', rate_percent: 100 }
    }

    // High battery, high price - discharge
    if (soc > 60 && currentPrice > avgPrice * 1.1) {
        const rate = currentPrice > avgPrice * 1.3 ? 100 : 50
        return { action_type: 'discharge', rate_percent: rate }
    }

    // Low price - charge
    if (soc < 80 && currentPrice < avgPrice * 0.9) {
        const rate = currentPrice < avgPrice * 0.7 ? 100 : 50
        return { action_type: 'charge', rate_percent: rate }
    }

    // Grid stress - help if we can
    if (state.grid_stress_index > 0.7 && soc > 40) {
        return { action_type: 'discharge', rate_percent: 75 }
    }

    return { action_type: 'idle', rate_percent: 0 }
}

/**
 * Simple reward calculation for training data
 */
function calculateSimpleReward(
    state: DecisionState,
    action: { action_type: string, rate_percent: number },
    price: number,
    gridStress: number
): number {
    const BATTERY_CAPACITY_KWH = 60
    const MAX_CHARGE_RATE = 7.4
    const MAX_DISCHARGE_RATE = 5.0

    const rateKw = action.action_type === 'discharge'
        ? (action.rate_percent / 100) * MAX_DISCHARGE_RATE
        : action.action_type === 'charge'
            ? (action.rate_percent / 100) * MAX_CHARGE_RATE
            : 0

    const energyKwh = rateKw * 1.0  // 1 hour
    let reward = 0

    if (action.action_type === 'discharge') {
        // Profit from selling
        reward += energyKwh * price

        // Grid support bonus
        if (gridStress > 0.7) {
            reward += energyKwh * 5
        } else if (gridStress > 0.4) {
            reward += energyKwh * 2
        }

        // Penalty for low SOC discharge
        if (state.soc_percent < 30) {
            reward -= energyKwh * 3
        }
    } else if (action.action_type === 'charge') {
        // Cost of buying (reward is negative)
        reward -= energyKwh * price

        // Bonus for charging at low prices
        const avgPrice = state.price_forecast.slice(0, 6).reduce((a, b) => a + b, 0) / 6
        if (price < avgPrice * 0.8) {
            reward += energyKwh * 2
        }

        // Penalty for charging during grid stress
        if (gridStress > 0.7) {
            reward -= energyKwh * 3
        }
    } else {
        // Small reward for being patient
        reward = 0.1
    }

    return reward
}

/**
 * Batch normalize training data
 */
export function normalizeTrainingBatch(batch: TrainingDataPoint[]): TrainingDataPoint[] {
    // Data is already normalized in generateEpisode
    return batch
}

/**
 * Create replay buffer from multiple episodes
 */
export class ReplayBuffer {
    private buffer: TrainingDataPoint[] = []
    private maxSize: number

    constructor(maxSize: number = 100000) {
        this.maxSize = maxSize
    }

    add(experience: TrainingDataPoint): void {
        this.buffer.push(experience)
        if (this.buffer.length > this.maxSize) {
            this.buffer.shift()
        }
    }

    addEpisode(episode: TrainingDataPoint[]): void {
        for (const exp of episode) {
            this.add(exp)
        }
    }

    sample(batchSize: number): TrainingDataPoint[] {
        const batch: TrainingDataPoint[] = []
        for (let i = 0; i < batchSize; i++) {
            const idx = Math.floor(Math.random() * this.buffer.length)
            batch.push(this.buffer[idx])
        }
        return batch
    }

    get size(): number {
        return this.buffer.length
    }

    clear(): void {
        this.buffer = []
    }
}
