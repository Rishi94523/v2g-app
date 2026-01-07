#!/usr/bin/env npx ts-node
/**
 * Training Script
 *
 * Run V2G optimization experiments
 *
 * Usage:
 *   npx ts-node scripts/train.ts [--episodes N] [--mode comparison|fixed|adaptive]
 */

import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { runComparisonExperiment, ExperimentRunner, ExperimentConfig } from '../src/lib/ml/index'

async function main() {
    const args = process.argv.slice(2)

    // Parse arguments
    let numEpisodes = 500
    let mode = 'comparison'

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--episodes' && args[i + 1]) {
            numEpisodes = parseInt(args[i + 1])
            i++
        }
        if (args[i] === '--mode' && args[i + 1]) {
            mode = args[i + 1]
            i++
        }
    }

    console.log('\n╔════════════════════════════════════════════════════════════╗')
    console.log('║     V2G Optimization Training - Adaptive Reward Shaping    ║')
    console.log('╚════════════════════════════════════════════════════════════╝\n')
    console.log(`Mode: ${mode}`)
    console.log(`Episodes: ${numEpisodes}`)
    console.log('')

    if (mode === 'comparison') {
        // Run full comparison experiment
        const results = await runComparisonExperiment(numEpisodes)

        console.log('\n📊 Results Summary:')
        console.log(`   Fixed weights avg reward: ${results.fixed.finalStats.avgReward.toFixed(2)}`)
        console.log(`   Adaptive weights avg reward: ${results.adaptive.finalStats.avgReward.toFixed(2)}`)

        const improvement = ((results.adaptive.finalStats.avgReward - results.fixed.finalStats.avgReward) /
            Math.abs(results.fixed.finalStats.avgReward) * 100).toFixed(1)
        console.log(`\n   🎯 Adaptive weights showed ${improvement}% improvement!`)

    } else {
        // Run single experiment
        const config: ExperimentConfig = {
            name: `${mode}_${Date.now()}`,
            numEpisodes,
            evalEvery: 50,
            numEvalEpisodes: 5,
            saveEvery: 200,
            useAdaptiveWeights: mode === 'adaptive'
        }

        const runner = new ExperimentRunner(config)
        await runner.initialize()
        const results = await runner.run()
        runner.dispose()

        console.log('\n📊 Results:')
        console.log(`   Avg Reward: ${results.finalStats.avgReward.toFixed(2)}`)
        console.log(`   Avg Profit: ₹${results.finalStats.avgProfit.toFixed(2)}`)
        console.log(`   Training Time: ${(results.finalStats.trainingTime / 60).toFixed(1)} minutes`)
    }

    console.log('\n✅ Training complete!\n')
}

main().catch(console.error)
