import * as fs from 'fs'
import * as path from 'path'
import * as tf from '@tensorflow/tfjs'

type Mode = 'adaptive' | 'fixed' | 'comparison'

const STATE_SIZE = 5
const ACTION_SIZE = 3 // 0 idle, 1 charge, 2 discharge

function parseArg(name: string, fallback: string): string {
    const idx = process.argv.indexOf(name)
    return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback
}

function randomPrice(hour: number): number {
    if (hour >= 18 && hour <= 22) return 10 + Math.random() * 3
    if (hour >= 6 && hour <= 9) return 7 + Math.random() * 2
    if (hour >= 23 || hour <= 5) return 3 + Math.random() * 2
    return 5 + Math.random() * 2
}

function buildState(soc: number, price: number, stress: number, hour: number): number[] {
    return [
        soc / 100,
        Math.min(1, price / 15),
        stress,
        (Math.sin((2 * Math.PI * hour) / 24) + 1) / 2,
        (Math.cos((2 * Math.PI * hour) / 24) + 1) / 2
    ]
}

class Agent {
    private model: tf.LayersModel
    private target: tf.LayersModel
    private replay: Array<{ s: number[]; a: number; r: number; ns: number[]; d: boolean }> = []
    private epsilon = 1
    private stepCount = 0

    constructor() {
        this.model = this.buildModel()
        this.target = this.buildModel()
        this.target.setWeights(this.model.getWeights())
        this.model.compile({ optimizer: tf.train.adam(0.001), loss: 'meanSquaredError' })
    }

    private buildModel(): tf.LayersModel {
        return tf.sequential({
            layers: [
                tf.layers.dense({ inputShape: [STATE_SIZE], units: 32, activation: 'relu' }),
                tf.layers.dense({ units: 16, activation: 'relu' }),
                tf.layers.dense({ units: ACTION_SIZE, activation: 'linear' })
            ]
        })
    }

    act(state: number[], train: boolean): number {
        if (train && Math.random() < this.epsilon) return Math.floor(Math.random() * ACTION_SIZE)
        const t = tf.tensor2d([state])
        const q = this.model.predict(t) as tf.Tensor
        const a = q.argMax(1).dataSync()[0]
        t.dispose()
        q.dispose()
        return a
    }

    remember(s: number[], a: number, r: number, ns: number[], d: boolean) {
        this.replay.push({ s, a, r, ns, d })
        if (this.replay.length > 10000) this.replay.shift()
    }

    async train() {
        if (this.replay.length < 64) return
        const batch = Array.from({ length: 64 }, () => this.replay[Math.floor(Math.random() * this.replay.length)])
        const s = tf.tensor2d(batch.map((b) => b.s))
        const ns = tf.tensor2d(batch.map((b) => b.ns))
        const q = (this.model.predict(s) as tf.Tensor).arraySync() as number[][]
        const nq = (this.target.predict(ns) as tf.Tensor).arraySync() as number[][]
        for (let i = 0; i < batch.length; i++) {
            const b = batch[i]
            q[i][b.a] = b.r + (b.d ? 0 : 0.95 * Math.max(...nq[i]))
        }
        const y = tf.tensor2d(q)
        await this.model.fit(s, y, { epochs: 1, verbose: 0 })
        s.dispose()
        ns.dispose()
        y.dispose()
        this.stepCount++
        if (this.stepCount % 100 === 0) this.target.setWeights(this.model.getWeights())
        if (this.epsilon > 0.01) this.epsilon *= 0.995
    }

    async saveModel(dir: string) {
        fs.mkdirSync(dir, { recursive: true })
        try {
            await this.model.save(`file://${dir}`)
            return
        } catch (error) {
            const tensors = this.model.getWeights()
            const serialized = await Promise.all(
                tensors.map(async (t) => ({
                    shape: t.shape,
                    values: Array.from(await t.data())
                }))
            )
            fs.writeFileSync(
                path.join(dir, 'fallback-weights.json'),
                JSON.stringify({ savedAt: new Date().toISOString(), tensors: serialized }, null, 2),
                'utf-8'
            )
            console.warn(`Model file save unavailable, wrote fallback weights JSON at ${dir}:`, error)
        }
    }
}

function rewardFor(mode: Exclude<Mode, 'comparison'>, action: number, soc: number, price: number, stress: number): number {
    const profit = action === 2 ? price : action === 1 ? -price : 0.1
    const grid = action === 2 ? stress * 4 : action === 1 ? -stress * 2 : 0
    const battery = action === 2 && soc < 25 ? -2 : action === 1 && soc > 90 ? -1.5 : 0.2
    const fixed = { p: 0.4, g: 0.2, b: 0.3, u: 0.1 }
    const adaptive = (() => {
        const w = { ...fixed }
        if (stress > 0.7) { w.g = 0.5; w.p = 0.2 }
        if (soc < 30) { w.b = 0.5; w.p = Math.max(0.1, w.p - 0.2) }
        const sum = w.p + w.g + w.b + w.u
        return { p: w.p / sum, g: w.g / sum, b: w.b / sum, u: w.u / sum }
    })()
    const w = mode === 'adaptive' ? adaptive : fixed
    return w.p * profit + w.g * grid + w.b * battery
}

async function run(mode: Exclude<Mode, 'comparison'>, episodes: number, runName: string) {
    const out = path.join(process.cwd(), 'experiments', runName)
    const checkpoints = path.join(out, 'checkpoints')
    const finalModel = path.join(out, 'final_model')
    fs.mkdirSync(checkpoints, { recursive: true })

    const agent = new Agent()
    const metrics: Array<{ episode: number; reward: number; soc: number }> = []

    for (let ep = 0; ep < episodes; ep++) {
        let soc = 40 + Math.random() * 30
        let total = 0

        for (let step = 0; step < 96; step++) {
            const hour = Math.floor((step * 0.25) % 24)
            const price = randomPrice(hour)
            const stress = Math.max(0, Math.min(1, (price / 15) * 0.5 + (hour >= 18 && hour <= 22 ? 0.3 : 0)))

            const s = buildState(soc, price, stress, hour)
            const a = agent.act(s, true)

            if (a === 1) soc = Math.min(95, soc + 1.5)
            if (a === 2) soc = Math.max(10, soc - 1.2)

            const ns = buildState(soc, price, stress, hour)
            const r = rewardFor(mode, a, soc, price, stress)
            total += r
            const done = step === 95

            agent.remember(s, a, r, ns, done)
            if (Math.random() < 0.15) await agent.train()
        }

        metrics.push({ episode: ep, reward: Number(total.toFixed(4)), soc: Number(soc.toFixed(2)) })
        if (ep > 0 && ep % 10 === 0) {
            await agent.saveModel(path.join(checkpoints, `episode_${ep}`))
        }
        if (ep % 10 === 0) {
            console.log(`${mode} episode ${ep}/${episodes} reward=${total.toFixed(2)} soc=${soc.toFixed(1)}%`)
        }
    }

    await agent.saveModel(finalModel)
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ mode, episodes, metrics }, null, 2))
    fs.writeFileSync(path.join(out, 'metrics.csv'), ['episode,reward,soc', ...metrics.map((m) => `${m.episode},${m.reward},${m.soc}`)].join('\n'))
    console.log(`Saved artifacts: ${out}`)
}

async function main() {
    const mode = parseArg('--mode', 'adaptive') as Mode
    const episodes = Number(parseArg('--episodes', '60'))
    const name = parseArg('--name', `${mode}_run_${Date.now()}`)

    if (mode === 'comparison') {
        await run('fixed', episodes, `${name}_fixed`)
        await run('adaptive', episodes, `${name}_adaptive`)
        return
    }
    await run(mode, episodes, name)
}

main().catch((err) => {
    console.error('Training failed:', err)
    process.exit(1)
})
