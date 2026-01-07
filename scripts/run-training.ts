#!/usr/bin/env node
/**
 * V2G Training Script (Standalone)
 *
 * Run: npx ts-node --esm scripts/run-training.ts
 */

import * as dotenv from 'dotenv'
import * as fs from 'fs'
import * as path from 'path'
import * as tf from '@tensorflow/tfjs'
import * as XLSX from 'xlsx'

dotenv.config({ path: '.env.local' })

// ============ CONSTANTS ============

const STATE_SIZE = 14
const ACTION_SIZE = 9
const BATTERY_CAPACITY_KWH = 60
const MAX_CHARGE_RATE = 7.4
const MAX_DISCHARGE_RATE = 5.0

// ============ PRICE DATA ============

interface PriceRecord {
    hour: number
    month: number
    mcpRsPerKWh: number
}

let priceData: PriceRecord[] = []
let pricesByHourMonth: Map<string, number[]> = new Map()

function excelDateToJS(serial: number): Date {
    return new Date((serial - 25569) * 86400 * 1000)
}

async function loadIEXData(): Promise<boolean> {
    try {
        const dataPath = path.join(process.cwd(), 'data', 'iex-prices', 'DAM.xlsx')

        if (!fs.existsSync(dataPath)) {
            console.log('[Data] IEX dataset not found, using synthetic prices')
            return false
        }

        console.log('[Data] Loading IEX DAM dataset...')
        const workbook = XLSX.readFile(dataPath)
        const sheet = workbook.Sheets[workbook.SheetNames[0]]
        const rawData = XLSX.utils.sheet_to_json(sheet) as Record<string, unknown>[]

        priceData = rawData.map(row => {
            const timestamp = excelDateToJS(row['TimeStamp'] as number)
            const mcpRsPerMWh = row['MCP (Rs/MWh) *'] as number
            return {
                hour: timestamp.getHours(),
                month: timestamp.getMonth(),
                mcpRsPerKWh: mcpRsPerMWh / 1000
            }
        }).filter(r => !isNaN(r.mcpRsPerKWh))

        // Build index
        for (const record of priceData) {
            const key = `${record.hour}-${record.month}`
            if (!pricesByHourMonth.has(key)) {
                pricesByHourMonth.set(key, [])
            }
            pricesByHourMonth.get(key)!.push(record.mcpRsPerKWh)
        }

        console.log(`[Data] Loaded ${priceData.length} price records`)
        return true
    } catch (error) {
        console.log('[Data] Error loading IEX data:', error)
        return false
    }
}

function generatePrices(length: number): number[] {
    const prices: number[] = []
    const month = new Date().getMonth()

    for (let i = 0; i < length; i++) {
        const hour = i % 24
        const key = `${hour}-${month}`
        const historicalPrices = pricesByHourMonth.get(key)

        if (historicalPrices && historicalPrices.length > 0) {
            const sorted = [...historicalPrices].sort((a, b) => a - b)
            const median = sorted[Math.floor(sorted.length / 2)]
            const variance = (Math.random() - 0.5) * 0.2 * median
            prices.push(Math.max(0.5, median + variance))
        } else {
            // Synthetic fallback
            if (hour >= 18 && hour <= 22) {
                prices.push(10 + Math.random() * 4)
            } else if (hour >= 6 && hour <= 9) {
                prices.push(7 + Math.random() * 2)
            } else if (hour >= 23 || hour <= 5) {
                prices.push(3 + Math.random() * 2)
            } else {
                prices.push(5 + Math.random() * 3)
            }
        }
    }
    return prices
}

// ============ STATE/ACTION ENCODING ============

function normalize(value: number, min: number, max: number): number {
    return Math.max(0, Math.min(1, (value - min) / (max - min)))
}

interface State {
    soc: number
    temperature: number
    price: number
    forecast: number[]
    gridStress: number
    hourSin: number
    hourCos: number
    minSoc: number
    dischargeAllowed: boolean
}

function stateToVector(state: State): number[] {
    const vector: number[] = []
    vector.push(normalize(state.soc, 0, 100))
    vector.push(normalize(state.temperature, 0, 50))
    vector.push(normalize(state.price, 0.5, 15))

    const forecast = state.forecast.slice(0, 6)
    while (forecast.length < 6) forecast.push(state.price)
    for (const p of forecast) {
        vector.push(normalize(p, 0.5, 15))
    }

    vector.push(state.gridStress)
    vector.push((state.hourSin + 1) / 2)
    vector.push((state.hourCos + 1) / 2)
    vector.push(normalize(state.minSoc, 0, 100))
    vector.push(state.dischargeAllowed ? 1 : 0)

    return vector
}

function indexToAction(index: number): { type: 'idle' | 'charge' | 'discharge', rate: number } {
    if (index === 0) return { type: 'idle', rate: 0 }
    if (index <= 4) return { type: 'charge', rate: index * 25 }
    return { type: 'discharge', rate: (index - 4) * 25 }
}

// ============ DQN AGENT ============

class DQNAgent {
    private model: tf.LayersModel
    private targetModel: tf.LayersModel
    private optimizer: tf.Optimizer
    private buffer: { state: number[], action: number, reward: number, nextState: number[], done: boolean }[] = []
    private epsilon: number = 1.0
    private trainStep: number = 0

    constructor() {
        this.model = this.buildModel()
        this.targetModel = this.buildModel()
        this.optimizer = tf.train.adam(0.001)
        this.updateTarget()
    }

    private buildModel(): tf.LayersModel {
        const model = tf.sequential()
        model.add(tf.layers.dense({ units: 128, activation: 'relu', inputShape: [STATE_SIZE] }))
        model.add(tf.layers.dense({ units: 64, activation: 'relu' }))
        model.add(tf.layers.dense({ units: 32, activation: 'relu' }))
        model.add(tf.layers.dense({ units: ACTION_SIZE, activation: 'linear' }))
        return model
    }

    updateTarget(): void {
        this.targetModel.setWeights(this.model.getWeights())
    }

    selectAction(state: number[], training: boolean): number {
        if (training && Math.random() < this.epsilon) {
            return Math.floor(Math.random() * ACTION_SIZE)
        }
        const stateTensor = tf.tensor2d([state])
        const qValues = this.model.predict(stateTensor) as tf.Tensor
        const action = qValues.argMax(1).dataSync()[0]
        stateTensor.dispose()
        qValues.dispose()
        return action
    }

    remember(state: number[], action: number, reward: number, nextState: number[], done: boolean): void {
        this.buffer.push({ state, action, reward, nextState, done })
        if (this.buffer.length > 50000) this.buffer.shift()
    }

    async train(): Promise<number> {
        if (this.buffer.length < 64) return 0

        // Sample batch
        const batch: typeof this.buffer = []
        for (let i = 0; i < 64; i++) {
            batch.push(this.buffer[Math.floor(Math.random() * this.buffer.length)])
        }

        const states = tf.tensor2d(batch.map(e => e.state))
        const nextStates = tf.tensor2d(batch.map(e => e.nextState))

        const currentQ = (this.model.predict(states) as tf.Tensor).arraySync() as number[][]
        const nextQ = (this.targetModel.predict(nextStates) as tf.Tensor).arraySync() as number[][]

        for (let i = 0; i < batch.length; i++) {
            const maxNextQ = Math.max(...nextQ[i])
            const target = batch[i].reward + (batch[i].done ? 0 : 0.95 * maxNextQ)
            currentQ[i][batch[i].action] = target
        }

        const targetTensor = tf.tensor2d(currentQ)

        // Train
        let loss = 0
        const lossFunc = () => {
            const pred = this.model.apply(states, { training: true }) as tf.Tensor
            const mse = tf.losses.meanSquaredError(targetTensor, pred)
            loss = mse.dataSync()[0]
            return mse as tf.Scalar
        }

        this.optimizer.minimize(lossFunc, true)

        states.dispose()
        nextStates.dispose()
        targetTensor.dispose()

        this.trainStep++
        if (this.trainStep % 100 === 0) this.updateTarget()
        if (this.epsilon > 0.01) this.epsilon *= 0.995

        return loss
    }

    getEpsilon(): number { return this.epsilon }
    setEpsilon(e: number): void { this.epsilon = e }

    dispose(): void {
        this.model.dispose()
        this.targetModel.dispose()
    }
}

// ============ ENVIRONMENT ============

class V2GEnv {
    private prices: number[]
    private step: number = 0
    private soc: number = 50
    private stats = { reward: 0, profit: 0, gridSupport: 0 }

    constructor(prices: number[]) {
        this.prices = prices
    }

    reset(): number[] {
        this.step = 0
        this.soc = 40 + Math.random() * 30
        this.stats = { reward: 0, profit: 0, gridSupport: 0 }
        return this.getState()
    }

    private getState(): number[] {
        const hour = (this.step * 0.25) % 24
        const hourRad = (2 * Math.PI * hour) / 24
        const price = this.prices[this.step % this.prices.length]

        const isPeak = Math.floor(hour) >= 18 && Math.floor(hour) <= 22
        let gridStress = normalize(price, 0.5, 15) * 0.5
        if (isPeak) gridStress += 0.3
        gridStress = Math.min(1, Math.max(0, gridStress))

        const state: State = {
            soc: this.soc,
            temperature: 25 + Math.random() * 10,
            price,
            forecast: this.prices.slice(this.step, this.step + 24),
            gridStress,
            hourSin: Math.sin(hourRad),
            hourCos: Math.cos(hourRad),
            minSoc: 20,
            dischargeAllowed: true
        }

        return stateToVector(state)
    }

    doStep(actionIdx: number): { state: number[], reward: number, done: boolean } {
        const action = indexToAction(actionIdx)
        const price = this.prices[this.step % this.prices.length]
        const hour = Math.floor((this.step * 0.25) % 24)
        const isPeak = hour >= 18 && hour <= 22

        let gridStress = normalize(price, 0.5, 15) * 0.5
        if (isPeak) gridStress += 0.3

        // Apply action
        let energyKwh = 0
        if (action.type === 'charge' && this.soc < 95) {
            const rateKw = (action.rate / 100) * MAX_CHARGE_RATE
            energyKwh = rateKw * 0.25 * 0.92
            this.soc = Math.min(95, this.soc + (energyKwh / BATTERY_CAPACITY_KWH) * 100)
        } else if (action.type === 'discharge' && this.soc > 10) {
            const rateKw = (action.rate / 100) * MAX_DISCHARGE_RATE
            energyKwh = rateKw * 0.25 / 0.92
            this.soc = Math.max(10, this.soc - (energyKwh / BATTERY_CAPACITY_KWH) * 100)
        }

        // Calculate reward
        let reward = 0
        if (action.type === 'discharge') {
            reward += energyKwh * price  // Profit
            if (gridStress > 0.7) reward += energyKwh * 5  // Grid bonus
            else if (gridStress > 0.4) reward += energyKwh * 2
            if (this.soc < 30) reward -= energyKwh * 3  // Low SOC penalty
            this.stats.profit += energyKwh * price
            this.stats.gridSupport += gridStress > 0.4 ? energyKwh : 0
        } else if (action.type === 'charge') {
            reward -= energyKwh * price  // Cost
            const avgPrice = this.prices.slice(this.step, this.step + 6).reduce((a, b) => a + b, 0) / 6
            if (price < avgPrice * 0.8) reward += energyKwh * 2  // Low price bonus
            if (gridStress > 0.7) reward -= energyKwh * 3  // Grid penalty
            this.stats.profit -= energyKwh * price
        } else {
            reward = 0.1  // Small idle bonus
        }

        this.stats.reward += reward
        this.step++
        const done = this.step >= 96  // 24 hours

        return { state: this.getState(), reward, done }
    }

    getStats() { return { ...this.stats, finalSoc: this.soc } }
}

// ============ TRAINING LOOP ============

async function runExperiment(name: string, numEpisodes: number, useAdaptive: boolean) {
    console.log(`\n${'='.repeat(60)}`)
    console.log(`Experiment: ${name}`)
    console.log(`Episodes: ${numEpisodes} | Adaptive: ${useAdaptive}`)
    console.log(`${'='.repeat(60)}\n`)

    const agent = new DQNAgent()
    const prices = generatePrices(5000)

    const metrics: { episode: number, reward: number, profit: number, epsilon: number }[] = []

    for (let ep = 0; ep < numEpisodes; ep++) {
        const startIdx = Math.floor(Math.random() * (prices.length - 200))
        const epPrices = prices.slice(startIdx, startIdx + 200)
        const env = new V2GEnv(epPrices)

        let state = env.reset()

        while (true) {
            const action = agent.selectAction(state, true)
            const result = env.doStep(action)

            agent.remember(state, action, result.reward, result.state, result.done)
            state = result.state

            if (Math.random() < 0.1) await agent.train()

            if (result.done) break
        }

        const stats = env.getStats()

        if (ep % 10 === 0) {
            metrics.push({
                episode: ep,
                reward: stats.reward,
                profit: stats.profit,
                epsilon: agent.getEpsilon()
            })

            console.log(
                `Episode ${ep.toString().padStart(4)} | ` +
                `Reward: ${stats.reward.toFixed(1).padStart(8)} | ` +
                `Profit: ₹${stats.profit.toFixed(1).padStart(7)} | ` +
                `SOC: ${stats.finalSoc.toFixed(0).padStart(3)}% | ` +
                `ε: ${agent.getEpsilon().toFixed(3)}`
            )
        }
    }

    // Final evaluation
    console.log('\nRunning evaluation (no exploration)...')
    agent.setEpsilon(0)

    let evalReward = 0, evalProfit = 0, evalGridSupport = 0
    const evalEpisodes = 10

    for (let i = 0; i < evalEpisodes; i++) {
        const startIdx = Math.floor(Math.random() * (prices.length - 200))
        const epPrices = prices.slice(startIdx, startIdx + 200)
        const env = new V2GEnv(epPrices)

        let state = env.reset()
        while (true) {
            const action = agent.selectAction(state, false)
            const result = env.doStep(action)
            state = result.state
            if (result.done) break
        }

        const stats = env.getStats()
        evalReward += stats.reward
        evalProfit += stats.profit
        evalGridSupport += stats.gridSupport
    }

    const results = {
        avgReward: evalReward / evalEpisodes,
        avgProfit: evalProfit / evalEpisodes,
        avgGridSupport: evalGridSupport / evalEpisodes
    }

    console.log(`\n${'='.repeat(60)}`)
    console.log(`Results: ${name}`)
    console.log(`${'='.repeat(60)}`)
    console.log(`  Avg Reward:      ${results.avgReward.toFixed(2)}`)
    console.log(`  Avg Profit:      ₹${results.avgProfit.toFixed(2)}`)
    console.log(`  Avg Grid Support: ${results.avgGridSupport.toFixed(2)} kWh`)
    console.log(`${'='.repeat(60)}\n`)

    agent.dispose()

    return results
}

// ============ MAIN ============

async function main() {
    console.log('\n╔════════════════════════════════════════════════════════════╗')
    console.log('║     V2G Optimization - DQN Training                        ║')
    console.log('╚════════════════════════════════════════════════════════════╝\n')

    // Load price data
    await loadIEXData()

    // Parse args
    const args = process.argv.slice(2)
    let episodes = 100
    let mode = 'single'

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--episodes' && args[i + 1]) {
            episodes = parseInt(args[i + 1])
        }
        if (args[i] === '--mode' && args[i + 1]) {
            mode = args[i + 1]
        }
    }

    if (mode === 'comparison') {
        console.log('Running comparison: Fixed vs Adaptive weights\n')

        const fixedResults = await runExperiment('Fixed Weights', episodes, false)
        const adaptiveResults = await runExperiment('Adaptive Weights', episodes, true)

        console.log('\n' + '═'.repeat(60))
        console.log('COMPARISON SUMMARY')
        console.log('═'.repeat(60))
        console.log(`                    | Fixed      | Adaptive   | Improvement`)
        console.log('-'.repeat(60))

        const rewardImprove = ((adaptiveResults.avgReward - fixedResults.avgReward) / Math.abs(fixedResults.avgReward) * 100).toFixed(1)
        const profitImprove = ((adaptiveResults.avgProfit - fixedResults.avgProfit) / Math.abs(fixedResults.avgProfit) * 100).toFixed(1)

        console.log(`Avg Reward          | ${fixedResults.avgReward.toFixed(2).padStart(10)} | ${adaptiveResults.avgReward.toFixed(2).padStart(10)} | ${rewardImprove.padStart(10)}%`)
        console.log(`Avg Profit (₹)      | ${fixedResults.avgProfit.toFixed(2).padStart(10)} | ${adaptiveResults.avgProfit.toFixed(2).padStart(10)} | ${profitImprove.padStart(10)}%`)
        console.log('═'.repeat(60) + '\n')
    } else {
        await runExperiment('V2G DQN Agent', episodes, true)
    }

    console.log('✅ Training complete!\n')
}

main().catch(console.error)
