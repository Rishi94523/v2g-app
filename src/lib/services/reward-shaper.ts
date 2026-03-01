/**
 * Reward Shaper
 * 
 * This is the NOVEL contribution for the paper:
 * "Adaptive Multi-Objective Reward Shaping for V2G Optimization"
 * 
 * The reward function dynamically adjusts weights based on:
 * 1. Real-time grid stress levels
 * 2. Battery state (SOC, health)
 * 3. User preferences
 * 4. Market conditions (price volatility)
 */

import type { DecisionState, DecisionAction, RewardWeights, V2GAction } from '@/types/v2g'
import { getAdaptiveRewardWeights } from './grid-service'

// Constants for reward calculation
const BATTERY_DEGRADATION_COST_PER_CYCLE = 0.5  // ₹ per kWh cycled
const GRID_SUPPORT_BONUS_CRITICAL = 5.0          // ₹ bonus per kWh during critical
const GRID_SUPPORT_BONUS_ELEVATED = 2.0          // ₹ bonus per kWh during elevated
const USER_VIOLATION_PENALTY = -10.0             // Penalty for violating user prefs

// Power rates
const MAX_CHARGE_RATE_KW = 7.4
const MAX_DISCHARGE_RATE_KW = 5.0

interface RewardComponents {
    profit: number
    grid_stability: number
    battery_health: number
    user_preference: number
    total: number
    weights: RewardWeights
}

const DEFAULT_FIXED_WEIGHTS: RewardWeights = {
    profit: 0.4,
    grid_stability: 0.2,
    battery_health: 0.3,
    user_preference: 0.1
}

/**
 * Calculate the multi-objective reward with adaptive weights
 * 
 * This is the core of the novel contribution:
 * Instead of fixed weights, we dynamically adjust based on context
 */
export function calculateReward(
    state: DecisionState,
    action: DecisionAction,
    duration_hours: number = 0.25, // Default 15 minutes
    userDisableDischarge: boolean = false,
    weightOverride?: RewardWeights
): RewardComponents {
    // Use fixed weights when provided; otherwise use adaptive weights.
    const weights = weightOverride
        ? normalizeWeights(weightOverride)
        : getAdaptiveRewardWeights(
            state.grid_stress_index,
            state.soc_percent,
            userDisableDischarge
        )

    // Calculate individual reward components
    const profitReward = calculateProfitReward(state, action, duration_hours)
    const gridReward = calculateGridReward(state, action, duration_hours)
    const batteryReward = calculateBatteryReward(state, action, duration_hours)
    const userReward = calculateUserReward(state, action, userDisableDischarge)

    // Weighted sum (this is what makes it multi-objective)
    const total = (
        weights.profit * profitReward +
        weights.grid_stability * gridReward +
        weights.battery_health * batteryReward +
        weights.user_preference * userReward
    )

    return {
        profit: profitReward,
        grid_stability: gridReward,
        battery_health: batteryReward,
        user_preference: userReward,
        total: Number(total.toFixed(4)),
        weights
    }
}

/**
 * Profit Reward Component
 * Rewards buying low and selling high
 */
function calculateProfitReward(
    state: DecisionState,
    action: DecisionAction,
    duration_hours: number
): number {
    const rateKw = getActualRate(action)
    const energyKwh = rateKw * duration_hours
    const price = state.current_price

    switch (action.action_type) {
        case 'discharge':
            // Selling to grid - positive reward at high prices
            return energyKwh * (price - BATTERY_DEGRADATION_COST_PER_CYCLE)

        case 'charge':
            // Buying from grid - reward is negative of cost
            // But we want to reward buying at LOW prices, so invert
            const avgPrice = state.price_forecast.length > 0
                ? state.price_forecast.slice(0, 6).reduce((a, b) => a + b) / 6
                : price
            // Reward is higher when current price is below average
            return energyKwh * (avgPrice - price)

        case 'idle':
        default:
            // Small reward for patience when prices are moderate
            return 0.1
    }
}

/**
 * Grid Stability Reward Component
 * Rewards supporting the grid during stress periods
 */
function calculateGridReward(
    state: DecisionState,
    action: DecisionAction,
    duration_hours: number
): number {
    const rateKw = getActualRate(action)
    const energyKwh = rateKw * duration_hours
    const stressIndex = state.grid_stress_index

    if (action.action_type === 'discharge') {
        // Discharging helps the grid
        if (stressIndex >= 0.7) {
            return energyKwh * GRID_SUPPORT_BONUS_CRITICAL
        } else if (stressIndex >= 0.4) {
            return energyKwh * GRID_SUPPORT_BONUS_ELEVATED
        }
        return energyKwh * 0.5 // Small bonus even during normal
    }

    if (action.action_type === 'charge') {
        // Charging during stress is BAD for grid
        if (stressIndex >= 0.7) {
            return -energyKwh * GRID_SUPPORT_BONUS_CRITICAL
        } else if (stressIndex >= 0.4) {
            return -energyKwh * GRID_SUPPORT_BONUS_ELEVATED * 0.5
        }
        return 0 // No penalty during normal conditions
    }

    // Idle during stress is neutral-to-good
    return stressIndex >= 0.7 ? 0.5 : 0
}

/**
 * Battery Health Reward Component
 * Penalizes actions that degrade the battery
 */
function calculateBatteryReward(
    state: DecisionState,
    action: DecisionAction,
    duration_hours: number
): number {
    const rateKw = getActualRate(action)
    const energyKwh = rateKw * duration_hours
    const soc = state.soc_percent
    const temp = state.temperature_c

    let penalty = 0

    // Deep discharge penalty (below 20%)
    if (action.action_type === 'discharge') {
        if (soc < 20) {
            penalty -= 5 * energyKwh // Heavy penalty
        } else if (soc < 30) {
            penalty -= 2 * energyKwh // Moderate penalty
        } else if (soc > 80) {
            penalty -= 0.5 * energyKwh // Slight penalty for high-SOC discharge
        } else {
            penalty = 0.2 // Small reward for mid-range operation
        }
    }

    // High charge penalty (above 90%)
    if (action.action_type === 'charge') {
        if (soc > 90) {
            penalty -= 3 * energyKwh // Penalty for overcharging
        } else if (soc > 80) {
            penalty -= 0.5 * energyKwh
        } else {
            penalty = 0.3 // Reward for charging in healthy range
        }
    }

    // Temperature penalty
    if (temp < 10 || temp > 35) {
        penalty -= 2 * energyKwh // Operating outside optimal temp
    }

    // Idle is always safe for battery
    if (action.action_type === 'idle') {
        penalty = 0.5 // Small reward
    }

    return penalty
}

/**
 * User Preference Reward Component
 * Penalizes violating user settings
 */
function calculateUserReward(
    state: DecisionState,
    action: DecisionAction,
    userDisableDischarge: boolean
): number {
    // Check if discharge is disabled but we're trying to discharge
    if (userDisableDischarge && action.action_type === 'discharge') {
        return USER_VIOLATION_PENALTY
    }

    // Check minimum SOC constraint
    if (action.action_type === 'discharge' && state.soc_percent <= state.min_soc + 5) {
        return USER_VIOLATION_PENALTY * 0.5
    }

    // Reward for respecting preferences
    if (!state.discharge_allowed && action.action_type !== 'discharge') {
        return 1.0 // Bonus for listening to user
    }

    return 0
}

/**
 * Convert action to actual power rate in kW
 */
function getActualRate(action: DecisionAction): number {
    const maxRate = action.action_type === 'discharge'
        ? MAX_DISCHARGE_RATE_KW
        : MAX_CHARGE_RATE_KW

    return (action.rate_percent / 100) * maxRate
}

/**
 * Get action with highest expected reward (greedy policy)
 */
export function getBestAction(
    state: DecisionState,
    userDisableDischarge: boolean = false,
    weightOverride?: RewardWeights
): { action: DecisionAction; reward: RewardComponents } {
    const actions = generatePossibleActions(userDisableDischarge)

    let bestAction = actions[0]
    let bestReward = calculateReward(state, bestAction, 0.25, userDisableDischarge, weightOverride)

    for (const action of actions.slice(1)) {
        const reward = calculateReward(state, action, 0.25, userDisableDischarge, weightOverride)
        if (reward.total > bestReward.total) {
            bestAction = action
            bestReward = reward
        }
    }

    return { action: bestAction, reward: bestReward }
}

/**
 * Generate all possible actions for the agent
 */
function generatePossibleActions(disableDischarge: boolean = false): DecisionAction[] {
    const actions: DecisionAction[] = [
        { action_type: 'idle', rate_percent: 0 }
    ]

    // Charge actions
    for (const rate of [25, 50, 75, 100]) {
        actions.push({ action_type: 'charge', rate_percent: rate })
    }

    // Discharge actions (if allowed)
    if (!disableDischarge) {
        for (const rate of [25, 50, 75, 100]) {
            actions.push({ action_type: 'discharge', rate_percent: rate })
        }
    }

    return actions
}

/**
 * For paper: Log reward breakdown for analysis
 */
export function getRewardBreakdown(
    state: DecisionState,
    action: DecisionAction,
    userDisableDischarge: boolean = false,
    weightOverride?: RewardWeights
): string {
    const reward = calculateReward(state, action, 0.25, userDisableDischarge, weightOverride)

    return `
Reward Breakdown:
  Action: ${action.action_type} @ ${action.rate_percent}%
  
  Components:
    Profit:        ${reward.profit.toFixed(3)} × ${reward.weights.profit.toFixed(3)} = ${(reward.profit * reward.weights.profit).toFixed(3)}
    Grid Stability: ${reward.grid_stability.toFixed(3)} × ${reward.weights.grid_stability.toFixed(3)} = ${(reward.grid_stability * reward.weights.grid_stability).toFixed(3)}
    Battery Health: ${reward.battery_health.toFixed(3)} × ${reward.weights.battery_health.toFixed(3)} = ${(reward.battery_health * reward.weights.battery_health).toFixed(3)}
    User Pref:     ${reward.user_preference.toFixed(3)} × ${reward.weights.user_preference.toFixed(3)} = ${(reward.user_preference * reward.weights.user_preference).toFixed(3)}
  
  Total Reward: ${reward.total.toFixed(4)}
  
  Context:
    Grid Stress: ${state.grid_stress_index} (${state.grid_stress_index >= 0.7 ? 'CRITICAL' : state.grid_stress_index >= 0.4 ? 'ELEVATED' : 'NORMAL'})
    SOC: ${state.soc_percent}%
    Price: ₹${state.current_price}/kWh
`
}

function normalizeWeights(weights: RewardWeights): RewardWeights {
    const source = {
        profit: weights.profit ?? DEFAULT_FIXED_WEIGHTS.profit,
        grid_stability: weights.grid_stability ?? DEFAULT_FIXED_WEIGHTS.grid_stability,
        battery_health: weights.battery_health ?? DEFAULT_FIXED_WEIGHTS.battery_health,
        user_preference: weights.user_preference ?? DEFAULT_FIXED_WEIGHTS.user_preference
    }
    const sum = Object.values(source).reduce((a, b) => a + b, 0)

    if (sum <= 0) {
        return { ...DEFAULT_FIXED_WEIGHTS }
    }

    return {
        profit: Number((source.profit / sum).toFixed(3)),
        grid_stability: Number((source.grid_stability / sum).toFixed(3)),
        battery_health: Number((source.battery_health / sum).toFixed(3)),
        user_preference: Number((source.user_preference / sum).toFixed(3))
    }
}
