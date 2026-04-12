import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: '.env.local' })
dotenv.config()

// Load app modules only after env vars are present.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { registerDevice, createContribution } = require('../src/lib/supabase')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { settlePendingContributions } = require('../src/lib/blockchain-settlement')

const OUTPUT_DIR = path.resolve(
    __dirname,
    '..',
    '..',
    'research',
    'outputs',
    'evaluation',
    'blockchain_settlement_apr_2026'
)

const BATCH_SIZES = [5, 20]

async function createBenchmarkUser(
    supabaseUrl: string,
    serviceRoleKey: string
): Promise<{ userId: string; cleanup: () => Promise<void> }> {
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false }
    })

    const email = `benchmark-${Date.now()}@example.com`
    const password = `Bench-${crypto.randomUUID()}!`
    const walletAddress = process.env.BENCHMARK_SETTLEMENT_WALLET_ADDRESS
    if (!walletAddress) {
        throw new Error('Missing BENCHMARK_SETTLEMENT_WALLET_ADDRESS')
    }

    const { data, error } = await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { benchmark: true }
    })

    if (error || !data.user) {
        throw new Error(`Failed to create benchmark auth user: ${error?.message || 'unknown error'}`)
    }

    await adminClient
        .from('user_preferences')
        .update({ wallet_address: walletAddress })
        .eq('user_id', data.user.id)

    return {
        userId: data.user.id,
        cleanup: async () => {
            await adminClient.auth.admin.deleteUser(data.user!.id)
        }
    }
}

async function main() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!supabaseUrl || !serviceRoleKey) {
        throw new Error('Missing Supabase environment variables')
    }

    fs.mkdirSync(OUTPUT_DIR, { recursive: true })

    const results: Array<Record<string, unknown>> = []
    const benchmarkWallet =
        process.env.BENCHMARK_SETTLEMENT_WALLET_ADDRESS ||
        process.env.BENCHMARK_DEVICE_WALLET_ADDRESS ||
        ''

    if (!benchmarkWallet) {
        throw new Error('Missing BENCHMARK_SETTLEMENT_WALLET_ADDRESS or BENCHMARK_DEVICE_WALLET_ADDRESS')
    }

    for (const batchSize of BATCH_SIZES) {
        const benchmarkUser = await createBenchmarkUser(supabaseUrl, serviceRoleKey)

        try {
            const device = await registerDevice(
                benchmarkUser.userId,
                `Settlement Benchmark ${batchSize}`,
                benchmarkWallet
            )

            if (!device) {
                throw new Error('Failed to register benchmark device')
            }

            const contributionIds: number[] = []
            for (let index = 0; index < batchSize; index += 1) {
                const contribution = await createContribution(
                    benchmarkUser.userId,
                    device.deviceId,
                    0.5 + index * 0.01,
                    index % 2 === 0,
                    index % 7 === 0
                )

                if (!contribution) {
                    throw new Error(`Failed to create contribution ${index + 1}/${batchSize}`)
                }

                contributionIds.push(contribution.id)
            }

            const startedAt = Date.now()
            const result = await settlePendingContributions({
                limit: batchSize,
                contributionIds
            })
            const finishedAt = Date.now()

            results.push({
                batch_size: batchSize,
                contribution_count: contributionIds.length,
                end_to_end_seconds: (finishedAt - startedAt) / 1000,
                processed: result.processed,
                skipped: result.skipped,
                tx_hash: result.tx_hash || '',
                gas_used: result.gas_used || '',
                fee_wei: result.fee_wei || '',
                reconciliation_matched: result.reconciliation_matched || 0,
                reconciliation_mismatched: result.reconciliation_mismatched || 0
            })
        } finally {
            await benchmarkUser.cleanup()
        }
    }

    fs.writeFileSync(
        path.join(OUTPUT_DIR, 'settlement_integration_summary.json'),
        JSON.stringify(results, null, 2)
    )
    fs.writeFileSync(
        path.join(OUTPUT_DIR, 'settlement_integration_summary.csv'),
        [
            'batch_size,contribution_count,end_to_end_seconds,processed,skipped,tx_hash,gas_used,fee_wei,reconciliation_matched,reconciliation_mismatched',
            ...results.map((row) =>
                [
                    row.batch_size,
                    row.contribution_count,
                    row.end_to_end_seconds,
                    row.processed,
                    row.skipped,
                    row.tx_hash,
                    row.gas_used,
                    row.fee_wei,
                    row.reconciliation_matched,
                    row.reconciliation_mismatched
                ].join(',')
            )
        ].join('\n')
    )

    console.log(JSON.stringify({ ok: true, outputDir: OUTPUT_DIR, results }, null, 2))
}

main().catch((error) => {
    console.error(error)
    process.exit(1)
})
