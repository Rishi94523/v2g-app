/**
 * Grid Service
 * Manages grid stress signals from the power authority
 *
 * In production, this would receive signals from the municipality/utility.
 * Now enhanced with real-time data from Electricity Maps API.
 */

import type { GridStatus } from '@/types/v2g'

// In-memory grid state (in production, this would be in Redis/database)
let currentGridStatus: GridStatus = {
    stress_level: 'normal',
    stress_index: 0.2,
    updated_at: new Date().toISOString()
}

// Stress level mappings
const STRESS_LEVELS = {
    normal: { min: 0, max: 0.4 },
    elevated: { min: 0.4, max: 0.7 },
    critical: { min: 0.7, max: 1.0 }
}

// Real-time grid data from Electricity Maps (cached)
interface RealTimeGridData {
    carbonIntensity?: number
    renewablePercentage?: number
    fossilFreePercentage?: number
    powerConsumption?: number
    powerProduction?: number
    timestamp: string
}

let realTimeGridData: RealTimeGridData | null = null

/**
 * Update real-time grid data from Electricity Maps
 * Called by the price API when fetching power breakdown
 */
export function updateRealTimeGridData(data: {
    carbonIntensity?: number
    renewablePercentage?: number
    fossilFreePercentage?: number
    powerConsumption?: number
    powerProduction?: number
}): void {
    realTimeGridData = {
        ...data,
        timestamp: new Date().toISOString()
    }
}

/**
 * Get real-time grid data
 */
export function getRealTimeGridData(): RealTimeGridData | null {
    return realTimeGridData
}

/**
 * Get current grid status
 */
export function getGridStatus(): GridStatus {
    return { ...currentGridStatus }
}

/**
 * Calculate grid stress from real-time Electricity Maps data
 * Uses carbon intensity, renewable %, and supply/demand balance
 */
export function calculateStressFromRealTimeData(): GridStatus | null {
    if (!realTimeGridData) {
        return null
    }

    let stressIndex = 0.2 // Base stress

    // Factor 1: Carbon intensity (higher = more stressed grid, relying on fossil fuels)
    // India typical range: 300-700 gCO2eq/kWh
    if (realTimeGridData.carbonIntensity !== undefined) {
        if (realTimeGridData.carbonIntensity > 600) {
            stressIndex += 0.25 // High carbon = grid is stressed, using dirty peakers
        } else if (realTimeGridData.carbonIntensity > 450) {
            stressIndex += 0.15
        } else if (realTimeGridData.carbonIntensity < 300) {
            stressIndex -= 0.1 // Low carbon = healthy grid
        }
    }

    // Factor 2: Renewable percentage (lower = more stressed)
    if (realTimeGridData.renewablePercentage !== undefined) {
        if (realTimeGridData.renewablePercentage < 20) {
            stressIndex += 0.2 // Very low renewable = grid stress
        } else if (realTimeGridData.renewablePercentage < 35) {
            stressIndex += 0.1
        } else if (realTimeGridData.renewablePercentage > 50) {
            stressIndex -= 0.1 // High renewable = healthy grid
        }
    }

    // Factor 3: Supply/demand imbalance
    if (realTimeGridData.powerConsumption && realTimeGridData.powerProduction) {
        const ratio = realTimeGridData.powerConsumption / realTimeGridData.powerProduction
        if (ratio > 1.05) {
            stressIndex += 0.3 // Demand exceeds supply - critical!
        } else if (ratio > 1.0) {
            stressIndex += 0.15 // Slight deficit
        }
    }

    // Factor 4: Time-based adjustment (peak hours)
    const hour = new Date().getHours()
    if (hour >= 18 && hour <= 21) {
        stressIndex += 0.1 // Evening peak
    } else if (hour >= 6 && hour <= 9) {
        stressIndex += 0.05 // Morning peak
    }

    // Clamp to valid range
    stressIndex = Math.max(0, Math.min(1, stressIndex))

    // Determine level
    let level: 'normal' | 'elevated' | 'critical' = 'normal'
    if (stressIndex >= 0.7) {
        level = 'critical'
    } else if (stressIndex >= 0.4) {
        level = 'elevated'
    }

    const status: GridStatus = {
        stress_level: level,
        stress_index: Number(stressIndex.toFixed(2)),
        updated_at: realTimeGridData.timestamp
    }

    // Update the global state
    currentGridStatus = status

    return status
}

/**
 * Set grid stress level (called by authority/admin)
 * This simulates the municipality sending a stress signal
 */
export function setGridStress(level: 'normal' | 'elevated' | 'critical'): GridStatus {
    const range = STRESS_LEVELS[level]
    const stress_index = range.min + Math.random() * (range.max - range.min)

    currentGridStatus = {
        stress_level: level,
        stress_index: Number(stress_index.toFixed(2)),
        updated_at: new Date().toISOString()
    }

    console.log(`[GridService] Stress level set to: ${level} (index: ${currentGridStatus.stress_index})`)

    return currentGridStatus
}

/**
 * Simulate grid stress based on time of day and price
 * Used when no manual signal is provided
 */
export function simulateGridStress(currentPrice: number, hour: number): GridStatus {
    // Base stress on price (higher price = higher demand = more stress)
    let stressIndex = 0.2

    // Price-based stress
    if (currentPrice > 12) {
        stressIndex += 0.4
    } else if (currentPrice > 8) {
        stressIndex += 0.2
    }

    // Time-based stress (peak hours)
    if (hour >= 18 && hour <= 21) {
        stressIndex += 0.2
    } else if (hour >= 6 && hour <= 9) {
        stressIndex += 0.1
    }

    // Add some randomness
    stressIndex += (Math.random() - 0.5) * 0.1
    stressIndex = Math.max(0, Math.min(1, stressIndex))

    // Determine level
    let level: 'normal' | 'elevated' | 'critical' = 'normal'
    if (stressIndex >= 0.7) {
        level = 'critical'
    } else if (stressIndex >= 0.4) {
        level = 'elevated'
    }

    currentGridStatus = {
        stress_level: level,
        stress_index: Number(stressIndex.toFixed(2)),
        updated_at: new Date().toISOString()
    }

    return currentGridStatus
}

/**
 * Calculate reward multiplier based on grid stress
 * Used by the decision engine to incentivize V2G during stress
 */
export function getGridRewardMultiplier(stressIndex: number): number {
    // Higher stress = higher reward for discharging to grid
    // Linear scaling from 1x (normal) to 3x (critical)
    return 1 + 2 * stressIndex
}

/**
 * Check if grid needs emergency support
 */
export function isGridEmergency(): boolean {
    return currentGridStatus.stress_level === 'critical'
}

/**
 * Get adaptive reward weights based on grid status
 * This is part of the NOVEL contribution - dynamic weight adjustment
 */
export function getAdaptiveRewardWeights(
    stressIndex: number,
    soc: number,
    userPriorityOverride: boolean
): {
    profit: number
    grid_stability: number
    battery_health: number
    user_preference: number
} {
    // Base weights
    let weights = {
        profit: 0.4,
        grid_stability: 0.2,
        battery_health: 0.3,
        user_preference: 0.1
    }

    // ADAPTIVE ADJUSTMENT 1: Grid stress increases grid_stability weight
    if (stressIndex > 0.7) {
        // Critical - prioritize grid support
        weights.grid_stability = 0.5
        weights.profit = 0.2
    } else if (stressIndex > 0.4) {
        // Elevated - moderate increase
        weights.grid_stability = 0.35
        weights.profit = 0.3
    }

    // ADAPTIVE ADJUSTMENT 2: Low SOC increases battery_health weight
    if (soc < 30) {
        weights.battery_health = 0.5
        weights.profit = Math.max(0.1, weights.profit - 0.2)
    } else if (soc < 50) {
        weights.battery_health = 0.4
    }

    // ADAPTIVE ADJUSTMENT 3: User priority override
    if (userPriorityOverride) {
        weights.user_preference = 0.4
        // Reduce others proportionally
        weights.profit *= 0.7
        weights.grid_stability *= 0.7
        weights.battery_health *= 0.7
    }

    // Normalize weights to sum to 1
    const sum = Object.values(weights).reduce((a, b) => a + b, 0)
    return {
        profit: Number((weights.profit / sum).toFixed(3)),
        grid_stability: Number((weights.grid_stability / sum).toFixed(3)),
        battery_health: Number((weights.battery_health / sum).toFixed(3)),
        user_preference: Number((weights.user_preference / sum).toFixed(3))
    }
}
