/**
 * Experiment Framework
 *
 * Runs A/B experiments comparing:
 * 1. Fixed reward weights (baseline)
 * 2. Adaptive reward weights (novel contribution)
 *
 * Collects metrics for research paper
 */

import * as fs from 'fs'
import * as path from 'path'
import { DQNAgent, DQNConfig } from './dqn-agent'
import { V2GEnvironment, EpisodeStats, SimulationConfig } from './environment'
import { loadIEXData, get24HourForecastFromDataset } from '../services/iex-price-service'

export interface ExperimentConfig {
    name: string
    numEpisodes: number
    evalEvery: number           // Evaluate every N episodes
    numEvalEpisodes: number     // Number of episodes for evaluation
    saveEvery: number           // Save model every N episodes
    useAdaptiveWeights: boolean // Novel contribution flag
    dqnConfig?: Partial<DQNConfig>
    simConfig?: Partial<SimulationConfig>
    seed?: number
}

export interface ExperimentMetrics {
    episode: number
    trainReward: number
    evalReward: number
    evalProfit: number
    evalGridSupport: number
    evalDegradation: number
    epsilon: number
    loss: number
    peakDischargeRate: number   // % of peak hours with discharge
    offPeakChargeRate: number   // % of off-peak hours with charge
    avgFinalSoc: number
}

export interface ExperimentResults {
    config: ExperimentConfig
    metrics: ExperimentMetrics[]
    finalStats: {
        avgReward: number
        avgProfit: number
        avgGridSupport: number
        avgDegradation: number
        trainingTime: number
    }
}

/**
 * Main experiment runner
 */
export class ExperimentRunner {
    private config: ExperimentConfig
    private agent: DQNAgent
    private env: V2GEnvironment
    private prices: number[] = []
    private metrics: ExperimentMetrics[] = []
    private outputDir: string

    constructor(config: ExperimentConfig) {
        this.config = config
        this.outputDir = path.join(process.cwd(), 'experiments', config.name)

        // Initialize agent
        this.agent = new DQNAgent(config.dqnConfig)

        // Will be set after loading prices
        this.env = null as unknown as V2GEnvironment
    }

    /**
     * Load price data and initialize environment
     */
    async initialize(): Promise<void> {
        console.log(`[Experiment ${this.config.name}] Initializing...`)

        // Load IEX data
        const loaded = await loadIEXData()
        if (loaded) {
            console.log('[Experiment] Using IEX DAM dataset for prices')
            // Generate price sequence from dataset
            this.prices = this.generatePriceSequence(10000)  // 10k price points
        } else {
            console.log('[Experiment] Using synthetic TOU prices')
            this.prices = this.generateSyntheticPrices(10000)
        }

        // Initialize environment
        this.env = new V2GEnvironment(this.prices, {
            ...this.config.simConfig,
            useAdaptiveWeights: this.config.useAdaptiveWeights
        })

        // Create output directory
        if (!fs.existsSync(this.outputDir)) {
            fs.mkdirSync(this.outputDir, { recursive: true })
        }

        console.log(`[Experiment] Initialized with ${this.prices.length} price points`)
        console.log(`[Experiment] Adaptive weights: ${this.config.useAdaptiveWeights}`)
    }

    /**
     * Generate price sequence from IEX dataset
     */
    private generatePriceSequence(length: number): number[] {
        const prices: number[] = []
        for (let day = 0; day < Math.ceil(length / 24); day++) {
            const dayOffset = new Date()
            dayOffset.setDate(dayOffset.getDate() + day)
            const forecast = get24HourForecastFromDataset(dayOffset)
            prices.push(...forecast)
        }
        return prices.slice(0, length)
    }

    /**
     * Generate synthetic TOU prices
     */
    private generateSyntheticPrices(length: number): number[] {
        const prices: number[] = []
        for (let i = 0; i < length; i++) {
            const hour = i % 24
            let price: number

            if (hour >= 18 && hour <= 22) {
                price = 10 + Math.random() * 4  // Peak: ₹10-14
            } else if (hour >= 6 && hour <= 9) {
                price = 7 + Math.random() * 2   // Morning: ₹7-9
            } else if (hour >= 23 || hour <= 5) {
                price = 3 + Math.random() * 2   // Night: ₹3-5
            } else {
                price = 5 + Math.random() * 3   // Off-peak: ₹5-8
            }

            prices.push(price)
        }
        return prices
    }

    /**
     * Run the full experiment
     */
    async run(): Promise<ExperimentResults> {
        const startTime = Date.now()

        console.log(`\n${'='.repeat(60)}`)
        console.log(`Starting Experiment: ${this.config.name}`)
        console.log(`Episodes: ${this.config.numEpisodes}`)
        console.log(`Adaptive Weights: ${this.config.useAdaptiveWeights}`)
        console.log(`${'='.repeat(60)}\n`)

        for (let episode = 0; episode < this.config.numEpisodes; episode++) {
            // Train one episode
            const trainStats = await this.trainEpisode()
            const loss = await this.agent.train()

            // Periodic evaluation
            if (episode % this.config.evalEvery === 0) {
                const evalStats = await this.evaluate()

                const metrics: ExperimentMetrics = {
                    episode,
                    trainReward: trainStats.totalReward,
                    evalReward: evalStats.avgReward,
                    evalProfit: evalStats.avgProfit,
                    evalGridSupport: evalStats.avgGridSupport,
                    evalDegradation: evalStats.avgDegradation,
                    epsilon: this.agent.getEpsilon(),
                    loss,
                    peakDischargeRate: evalStats.peakDischargeRate,
                    offPeakChargeRate: evalStats.offPeakChargeRate,
                    avgFinalSoc: evalStats.avgFinalSoc
                }

                this.metrics.push(metrics)

                // Log progress
                console.log(
                    `Episode ${episode.toString().padStart(4)} | ` +
                    `Train: ${trainStats.totalReward.toFixed(1).padStart(7)} | ` +
                    `Eval: ${evalStats.avgReward.toFixed(1).padStart(7)} | ` +
                    `Profit: ₹${evalStats.avgProfit.toFixed(0).padStart(5)} | ` +
                    `Grid: ${evalStats.avgGridSupport.toFixed(1).padStart(5)} | ` +
                    `ε: ${this.agent.getEpsilon().toFixed(3)}`
                )
            }

            // Periodic save
            if (episode > 0 && episode % this.config.saveEvery === 0) {
                await this.saveCheckpoint(episode)
            }
        }

        const trainingTime = (Date.now() - startTime) / 1000

        // Final evaluation
        const finalEval = await this.evaluate(20)

        const results: ExperimentResults = {
            config: this.config,
            metrics: this.metrics,
            finalStats: {
                avgReward: finalEval.avgReward,
                avgProfit: finalEval.avgProfit,
                avgGridSupport: finalEval.avgGridSupport,
                avgDegradation: finalEval.avgDegradation,
                trainingTime
            }
        }

        // Save results
        await this.saveResults(results)

        console.log(`\n${'='.repeat(60)}`)
        console.log(`Experiment Complete: ${this.config.name}`)
        console.log(`Training Time: ${(trainingTime / 60).toFixed(1)} minutes`)
        console.log(`Final Avg Reward: ${results.finalStats.avgReward.toFixed(2)}`)
        console.log(`Final Avg Profit: ₹${results.finalStats.avgProfit.toFixed(2)}`)
        console.log(`${'='.repeat(60)}\n`)

        return results
    }

    /**
     * Train one episode
     */
    private async trainEpisode(): Promise<EpisodeStats> {
        const startStep = Math.floor(Math.random() * (this.prices.length - 100))
        const episodePrices = this.prices.slice(startStep, startStep + 200)

        const env = new V2GEnvironment(episodePrices, {
            ...this.config.simConfig,
            useAdaptiveWeights: this.config.useAdaptiveWeights
        })
        let state = env.reset()

        while (true) {
            const action = this.agent.selectAction(state, true)
            const result = env.step(action)

            this.agent.remember({
                state,
                action,
                reward: result.reward,
                nextState: result.state,
                done: result.done
            })

            state = result.state

            // Train periodically
            if (Math.random() < 0.1) {
                await this.agent.train()
            }

            if (result.done) break
        }

        return env.getEpisodeStats()
    }

    /**
     * Evaluate current policy
     */
    private async evaluate(numEpisodes?: number): Promise<{
        avgReward: number
        avgProfit: number
        avgGridSupport: number
        avgDegradation: number
        peakDischargeRate: number
        offPeakChargeRate: number
        avgFinalSoc: number
    }> {
        const episodes = numEpisodes ?? this.config.numEvalEpisodes
        const stats: EpisodeStats[] = []

        // Temporarily disable exploration
        const originalEpsilon = this.agent.getEpsilon()
        this.agent.setEpsilon(0)

        for (let i = 0; i < episodes; i++) {
            const startStep = Math.floor(Math.random() * (this.prices.length - 100))
            const episodePrices = this.prices.slice(startStep, startStep + 200)

            const env = new V2GEnvironment(episodePrices, {
                ...this.config.simConfig,
                useAdaptiveWeights: this.config.useAdaptiveWeights
            })
            let state = env.reset()

            while (true) {
                const action = this.agent.selectAction(state, false)
                const result = env.step(action)
                state = result.state

                if (result.done) break
            }

            stats.push(env.getEpisodeStats())
        }

        // Restore exploration
        this.agent.setEpsilon(originalEpsilon)

        // Aggregate stats
        const totalSteps = stats.reduce((sum, s) => sum + s.steps, 0)
        const peakHours = totalSteps * (5 / 24)   // ~5 peak hours per day
        const offPeakHours = totalSteps * (7 / 24) // ~7 off-peak hours per day

        return {
            avgReward: stats.reduce((sum, s) => sum + s.totalReward, 0) / episodes,
            avgProfit: stats.reduce((sum, s) => sum + s.totalProfit, 0) / episodes,
            avgGridSupport: stats.reduce((sum, s) => sum + s.totalGridSupport, 0) / episodes,
            avgDegradation: stats.reduce((sum, s) => sum + s.totalDegradation, 0) / episodes,
            peakDischargeRate: stats.reduce((sum, s) => sum + s.peakDischarges, 0) / peakHours,
            offPeakChargeRate: stats.reduce((sum, s) => sum + s.offPeakCharges, 0) / offPeakHours,
            avgFinalSoc: stats.reduce((sum, s) => sum + s.finalSoc, 0) / episodes
        }
    }

    /**
     * Save model checkpoint
     */
    private async saveCheckpoint(episode: number): Promise<void> {
        const checkpointDir = path.join(this.outputDir, 'checkpoints', `episode_${episode}`)
        if (!fs.existsSync(checkpointDir)) {
            fs.mkdirSync(checkpointDir, { recursive: true })
        }
        await this.agent.saveModel(checkpointDir)
    }

    /**
     * Save experiment results
     */
    private async saveResults(results: ExperimentResults): Promise<void> {
        // Save full results JSON
        const resultsPath = path.join(this.outputDir, 'results.json')
        fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2))

        // Save metrics CSV for plotting
        const csvPath = path.join(this.outputDir, 'metrics.csv')
        const headers = Object.keys(this.metrics[0] || {}).join(',')
        const rows = this.metrics.map(m => Object.values(m).join(','))
        fs.writeFileSync(csvPath, [headers, ...rows].join('\n'))

        // Save final model
        const modelDir = path.join(this.outputDir, 'final_model')
        if (!fs.existsSync(modelDir)) {
            fs.mkdirSync(modelDir, { recursive: true })
        }
        await this.agent.saveModel(modelDir)

        console.log(`Results saved to ${this.outputDir}`)
    }

    /**
     * Cleanup
     */
    dispose(): void {
        this.agent.dispose()
    }
}

/**
 * Run comparison experiment: Fixed vs Adaptive weights
 */
export async function runComparisonExperiment(
    numEpisodes: number = 1000
): Promise<{ fixed: ExperimentResults; adaptive: ExperimentResults }> {
    console.log('\n' + '='.repeat(70))
    console.log('V2G Optimization: Fixed vs Adaptive Weights Comparison')
    console.log('='.repeat(70) + '\n')

    // Experiment 1: Fixed weights (baseline)
    const fixedConfig: ExperimentConfig = {
        name: `fixed_weights_${Date.now()}`,
        numEpisodes,
        evalEvery: 50,
        numEvalEpisodes: 5,
        saveEvery: 200,
        useAdaptiveWeights: false
    }

    const fixedRunner = new ExperimentRunner(fixedConfig)
    await fixedRunner.initialize()
    const fixedResults = await fixedRunner.run()
    fixedRunner.dispose()

    // Experiment 2: Adaptive weights (novel)
    const adaptiveConfig: ExperimentConfig = {
        name: `adaptive_weights_${Date.now()}`,
        numEpisodes,
        evalEvery: 50,
        numEvalEpisodes: 5,
        saveEvery: 200,
        useAdaptiveWeights: true
    }

    const adaptiveRunner = new ExperimentRunner(adaptiveConfig)
    await adaptiveRunner.initialize()
    const adaptiveResults = await adaptiveRunner.run()
    adaptiveRunner.dispose()

    // Print comparison
    console.log('\n' + '='.repeat(70))
    console.log('COMPARISON RESULTS')
    console.log('='.repeat(70))
    console.log('\nMetric                  | Fixed Weights | Adaptive Weights | Improvement')
    console.log('-'.repeat(70))

    const improvement = (a: number, b: number) => ((a - b) / Math.abs(b) * 100).toFixed(1)

    console.log(`Avg Reward              | ${fixedResults.finalStats.avgReward.toFixed(2).padStart(13)} | ${adaptiveResults.finalStats.avgReward.toFixed(2).padStart(16)} | ${improvement(adaptiveResults.finalStats.avgReward, fixedResults.finalStats.avgReward).padStart(10)}%`)
    console.log(`Avg Profit (₹)          | ${fixedResults.finalStats.avgProfit.toFixed(2).padStart(13)} | ${adaptiveResults.finalStats.avgProfit.toFixed(2).padStart(16)} | ${improvement(adaptiveResults.finalStats.avgProfit, fixedResults.finalStats.avgProfit).padStart(10)}%`)
    console.log(`Grid Support Score      | ${fixedResults.finalStats.avgGridSupport.toFixed(2).padStart(13)} | ${adaptiveResults.finalStats.avgGridSupport.toFixed(2).padStart(16)} | ${improvement(adaptiveResults.finalStats.avgGridSupport, fixedResults.finalStats.avgGridSupport).padStart(10)}%`)
    console.log(`Battery Degradation     | ${fixedResults.finalStats.avgDegradation.toFixed(4).padStart(13)} | ${adaptiveResults.finalStats.avgDegradation.toFixed(4).padStart(16)} | ${improvement(-adaptiveResults.finalStats.avgDegradation, -fixedResults.finalStats.avgDegradation).padStart(10)}%`)

    console.log('\n' + '='.repeat(70) + '\n')

    return { fixed: fixedResults, adaptive: adaptiveResults }
}
