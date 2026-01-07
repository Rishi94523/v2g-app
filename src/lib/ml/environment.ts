/**
 * V2G Simulation Environment
 *
 * Simulates EV battery interaction with grid for training
 * Uses historical IEX prices and simulated grid conditions
 */

import type { DecisionState, DecisionAction, RewardWeights } from '@/types/v2g'
import { stateToVector, indexToAction, STATE_SIZE, ACTION_SIZE } from './preprocessing'
import { calculateReward } from '../services/reward-shaper'
import { getAdaptiveRewardWeights } from '../services/grid-service'

export interface BatteryConfig {
    capacityKwh: number
    maxChargeRateKw: number
    maxDischargeRateKw: number
    efficiency: number          // Round-trip efficiency (0-1)
    degradationRate: number     // % capacity loss per full cycle
}

export interface SimulationConfig {
    battery: BatteryConfig
    stepDurationHours: number   // Time step (default 0.25 = 15 min)
    episodeLengthSteps: number  // Episode length in steps
    minSoc: number              // Minimum allowed SOC
    maxSoc: number              // Maximum allowed SOC
}

const DEFAULT_BATTERY: BatteryConfig = {
    capacityKwh: 60,
    maxChargeRateKw: 7.4,        // Level 2 AC
    maxDischargeRateKw: 5.0,
    efficiency: 0.92,
    degradationRate: 0.0001      // 0.01% per cycle
}

const DEFAULT_SIM_CONFIG: SimulationConfig = {
    battery: DEFAULT_BATTERY,
    stepDurationHours: 0.25,     // 15 minutes
    episodeLengthSteps: 96,      // 24 hours
    minSoc: 10,
    maxSoc: 95
}

export interface StepResult {
    state: number[]
    reward: number
    done: boolean
    info: {
        soc: number
        price: number
        action: string
        energyKwh: number
        profit: number
        gridSupport: number
        degradation: number
    }
}

export interface EpisodeStats {
    totalReward: number
    totalProfit: number
    totalGridSupport: number
    totalDegradation: number
    finalSoc: number
    steps: number
    avgPrice: number
    peakDischarges: number
    offPeakCharges: number
}

export class V2GEnvironment {
    private config: SimulationConfig
    private prices: number[]
    private currentStep: number = 0
    private currentSoc: number = 50
    private totalDegradation: number = 0
    private episodeStats: Partial<EpisodeStats> = {}

    constructor(
        prices: number[],
        config: Partial<SimulationConfig> = {}
    ) {
        this.config = {
            ...DEFAULT_SIM_CONFIG,
            ...config,
            battery: { ...DEFAULT_BATTERY, ...config.battery }
        }
        this.prices = prices
    }

    /**
     * Reset environment for new episode
     */
    reset(startSoc?: number): number[] {
        this.currentStep = 0
        this.currentSoc = startSoc ?? 40 + Math.random() * 30  // Random 40-70%
        this.totalDegradation = 0
        this.episodeStats = {
            totalReward: 0,
            totalProfit: 0,
            totalGridSupport: 0,
            totalDegradation: 0,
            steps: 0,
            peakDischarges: 0,
            offPeakCharges: 0
        }

        return this.getStateVector()
    }

    /**
     * Take action and return new state
     */
    step(actionIndex: number): StepResult {
        const action = indexToAction(actionIndex)
        const state = this.getCurrentState()

        // Calculate reward using adaptive reward shaper
        const rewardResult = calculateReward(
            state,
            action as DecisionAction,
            this.config.stepDurationHours,
            false
        )

        // Apply action to battery
        const { energyKwh, actualAction } = this.applyAction(action)

        // Track degradation
        const cycleDepth = Math.abs(energyKwh) / this.config.battery.capacityKwh
        const degradation = cycleDepth * this.config.battery.degradationRate
        this.totalDegradation += degradation

        // Calculate profit component
        const price = this.prices[this.currentStep % this.prices.length]
        const profit = actualAction === 'discharge'
            ? energyKwh * price
            : actualAction === 'charge'
                ? -energyKwh * price
                : 0

        // Track stats
        this.updateStats(rewardResult.total, profit, rewardResult.grid_stability, degradation, actualAction, state)

        // Advance time
        this.currentStep++
        const done = this.currentStep >= this.config.episodeLengthSteps

        return {
            state: this.getStateVector(),
            reward: rewardResult.total,
            done,
            info: {
                soc: this.currentSoc,
                price,
                action: actualAction,
                energyKwh,
                profit,
                gridSupport: rewardResult.grid_stability,
                degradation
            }
        }
    }

    /**
     * Apply action to battery, respecting constraints
     */
    private applyAction(action: { action_type: string, rate_percent: number }): {
        energyKwh: number
        actualAction: string
    } {
        const { battery, stepDurationHours, minSoc, maxSoc } = this.config

        let targetRateKw = 0
        let actualAction = action.action_type

        if (action.action_type === 'charge') {
            targetRateKw = (action.rate_percent / 100) * battery.maxChargeRateKw

            // Check if we can charge
            if (this.currentSoc >= maxSoc) {
                targetRateKw = 0
                actualAction = 'idle'
            }
        } else if (action.action_type === 'discharge') {
            targetRateKw = (action.rate_percent / 100) * battery.maxDischargeRateKw

            // Check if we can discharge
            if (this.currentSoc <= minSoc) {
                targetRateKw = 0
                actualAction = 'idle'
            }
        }

        // Calculate energy transfer
        let energyKwh = targetRateKw * stepDurationHours

        // Apply efficiency losses
        if (actualAction === 'charge') {
            energyKwh *= battery.efficiency
        } else if (actualAction === 'discharge') {
            energyKwh /= battery.efficiency
        }

        // Update SOC
        const socChange = (energyKwh / battery.capacityKwh) * 100

        if (actualAction === 'charge') {
            this.currentSoc = Math.min(maxSoc, this.currentSoc + socChange)
        } else if (actualAction === 'discharge') {
            this.currentSoc = Math.max(minSoc, this.currentSoc - socChange)
        }

        return { energyKwh, actualAction }
    }

    /**
     * Get current state as DecisionState object
     */
    private getCurrentState(): DecisionState {
        const step = this.currentStep
        const hour = (step * this.config.stepDurationHours) % 24
        const hourInt = Math.floor(hour)
        const hourRad = (2 * Math.PI * hour) / 24

        const price = this.prices[step % this.prices.length]
        const forecast = this.prices.slice(step, step + 24)

        // Simulate grid stress
        const isPeak = hourInt >= 18 && hourInt <= 22
        const priceNorm = Math.min(1, price / 15)  // Normalize to max ~15 Rs/kWh
        let gridStress = priceNorm * 0.5
        if (isPeak) gridStress += 0.3
        gridStress = Math.min(1, Math.max(0, gridStress + (Math.random() - 0.5) * 0.1))

        return {
            soc_percent: this.currentSoc,
            temperature_c: 25 + Math.random() * 10,  // Simulate 25-35°C
            current_price: price,
            price_forecast: forecast,
            grid_stress_index: gridStress,
            hour_sin: Math.sin(hourRad),
            hour_cos: Math.cos(hourRad),
            day_of_week: Math.floor(step / 96) % 7,  // Assumes 96 steps/day
            min_soc: this.config.minSoc,
            discharge_allowed: true
        }
    }

    /**
     * Get current state as normalized vector
     */
    getStateVector(): number[] {
        return stateToVector(this.getCurrentState())
    }

    /**
     * Update episode statistics
     */
    private updateStats(
        reward: number,
        profit: number,
        gridSupport: number,
        degradation: number,
        action: string,
        state: DecisionState
    ): void {
        this.episodeStats.totalReward = (this.episodeStats.totalReward || 0) + reward
        this.episodeStats.totalProfit = (this.episodeStats.totalProfit || 0) + profit
        this.episodeStats.totalGridSupport = (this.episodeStats.totalGridSupport || 0) + gridSupport
        this.episodeStats.totalDegradation = (this.episodeStats.totalDegradation || 0) + degradation
        this.episodeStats.steps = (this.episodeStats.steps || 0) + 1

        const hour = Math.floor((this.currentStep * this.config.stepDurationHours) % 24)
        const isPeak = hour >= 18 && hour <= 22
        const isOffPeak = hour >= 23 || hour <= 5

        if (action === 'discharge' && isPeak) {
            this.episodeStats.peakDischarges = (this.episodeStats.peakDischarges || 0) + 1
        }
        if (action === 'charge' && isOffPeak) {
            this.episodeStats.offPeakCharges = (this.episodeStats.offPeakCharges || 0) + 1
        }
    }

    /**
     * Get episode statistics
     */
    getEpisodeStats(): EpisodeStats {
        return {
            totalReward: this.episodeStats.totalReward || 0,
            totalProfit: this.episodeStats.totalProfit || 0,
            totalGridSupport: this.episodeStats.totalGridSupport || 0,
            totalDegradation: this.episodeStats.totalDegradation || 0,
            finalSoc: this.currentSoc,
            steps: this.episodeStats.steps || 0,
            avgPrice: this.prices.slice(0, this.currentStep).reduce((a, b) => a + b, 0) / this.currentStep || 0,
            peakDischarges: this.episodeStats.peakDischarges || 0,
            offPeakCharges: this.episodeStats.offPeakCharges || 0
        }
    }

    /**
     * Get current SOC
     */
    getCurrentSoc(): number {
        return this.currentSoc
    }

    /**
     * Get current step
     */
    getCurrentStep(): number {
        return this.currentStep
    }

    /**
     * Get action space size
     */
    static getActionSize(): number {
        return ACTION_SIZE
    }

    /**
     * Get state space size
     */
    static getStateSize(): number {
        return STATE_SIZE
    }
}
