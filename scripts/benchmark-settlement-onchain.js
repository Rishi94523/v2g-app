/* eslint-disable @typescript-eslint/no-require-imports */
require("dotenv").config({ path: ".env.local" });
require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const deployment = require("../contracts/deployments/sepolia.json");
const rewardDistributorArtifact = require("../artifacts/contracts/RewardDistributor.sol/RewardDistributor.json");

const DEFAULT_RPC = "https://ethereum-sepolia-rpc.publicnode.com";
const OUTPUT_DIR = path.resolve(
  __dirname,
  "..",
  "..",
  "research",
  "outputs",
  "evaluation",
  "blockchain_settlement_apr_2026"
);

const BATCH_SIZES = [1, 5, 10, 20, 50];
const REPEATS = 3;
const ENERGY_KWH = 1.0;

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

async function main() {
  const rpcUrl = process.env.SEPOLIA_RPC_URL || deployment.rpcUrl || DEFAULT_RPC;
  const privateKey = process.env.PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY;
  const rewardDistributorAddress =
    process.env.REWARD_DISTRIBUTOR_ADDRESS ||
    process.env.NEXT_PUBLIC_REWARD_DISTRIBUTOR_ADDRESS ||
    deployment.contracts.RewardDistributor;

  if (!privateKey) {
    throw new Error("Missing PRIVATE_KEY or DEPLOYER_PRIVATE_KEY");
  }
  if (!rewardDistributorAddress) {
    throw new Error("Missing RewardDistributor address");
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  const network = await provider.getNetwork();

  const contract = new ethers.Contract(
    rewardDistributorAddress,
    rewardDistributorArtifact.abi,
    wallet
  );

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const rawRows = [];

  for (const batchSize of BATCH_SIZES) {
    for (let repeat = 1; repeat <= REPEATS; repeat += 1) {
      const rewards = Array.from({ length: batchSize }, (_, index) => ({
        user: wallet.address,
        energyKwh: BigInt(Math.round(ENERGY_KWH * 1000)),
        wasPeakHour: index % 2 === 0,
        wasEmergency: index % 7 === 0,
        contributionId: ethers.keccak256(
          ethers.toUtf8Bytes(
            `benchmark-${Date.now()}-${batchSize}-${repeat}-${index}-${Math.random()}`
          )
        ),
      }));

      const startedAt = Date.now();
      const tx = await contract.batchDistributeRewards(rewards);
      const receipt = await tx.wait();
      const confirmedAt = Date.now();

      const gasUsed = Number(receipt.gasUsed);
      const effectiveGasPriceWei = Number(receipt.gasPrice || 0n);
      const feeWei = Number(receipt.gasUsed * (receipt.gasPrice || 0n));

      rawRows.push({
        batch_size: batchSize,
        repeat,
        tx_hash: receipt.hash,
        block_number: receipt.blockNumber,
        latency_seconds: (confirmedAt - startedAt) / 1000,
        gas_used: gasUsed,
        effective_gas_price_wei: effectiveGasPriceWei,
        fee_eth: Number(ethers.formatEther(BigInt(feeWei))),
        fee_usd_placeholder: null,
        cost_per_contribution_eth: Number(ethers.formatEther(BigInt(feeWei))) / batchSize,
      });
    }
  }

  const summaryRows = BATCH_SIZES.map((batchSize) => {
    const rows = rawRows.filter((row) => row.batch_size === batchSize);
    return {
      batch_size: batchSize,
      repeats: rows.length,
      mean_latency_seconds: mean(rows.map((row) => row.latency_seconds)),
      median_latency_seconds: median(rows.map((row) => row.latency_seconds)),
      mean_gas_used: mean(rows.map((row) => row.gas_used)),
      mean_fee_eth: mean(rows.map((row) => row.fee_eth)),
      mean_cost_per_contribution_eth: mean(
        rows.map((row) => row.cost_per_contribution_eth)
      ),
    };
  });

  const metadata = {
    generated_at: new Date().toISOString(),
    rpc_url: rpcUrl,
    chain_id: Number(network.chainId),
    reward_distributor_address: rewardDistributorAddress,
    benchmark_wallet: wallet.address,
    batch_sizes: BATCH_SIZES,
    repeats: REPEATS,
    energy_kwh_per_reward: ENERGY_KWH,
  };

  fs.writeFileSync(
    path.join(OUTPUT_DIR, "settlement_benchmark_raw.json"),
    JSON.stringify(rawRows, null, 2)
  );
  fs.writeFileSync(
    path.join(OUTPUT_DIR, "settlement_benchmark_summary.json"),
    JSON.stringify(summaryRows, null, 2)
  );
  fs.writeFileSync(
    path.join(OUTPUT_DIR, "settlement_benchmark_metadata.json"),
    JSON.stringify(metadata, null, 2)
  );

  const rawCsvLines = [
    "batch_size,repeat,tx_hash,block_number,latency_seconds,gas_used,effective_gas_price_wei,fee_eth,cost_per_contribution_eth",
    ...rawRows.map((row) =>
      [
        row.batch_size,
        row.repeat,
        row.tx_hash,
        row.block_number,
        row.latency_seconds,
        row.gas_used,
        row.effective_gas_price_wei,
        row.fee_eth,
        row.cost_per_contribution_eth,
      ].join(",")
    ),
  ];
  fs.writeFileSync(
    path.join(OUTPUT_DIR, "settlement_benchmark_raw.csv"),
    rawCsvLines.join("\n")
  );

  const summaryCsvLines = [
    "batch_size,repeats,mean_latency_seconds,median_latency_seconds,mean_gas_used,mean_fee_eth,mean_cost_per_contribution_eth",
    ...summaryRows.map((row) =>
      [
        row.batch_size,
        row.repeats,
        row.mean_latency_seconds,
        row.median_latency_seconds,
        row.mean_gas_used,
        row.mean_fee_eth,
        row.mean_cost_per_contribution_eth,
      ].join(",")
    ),
  ];
  fs.writeFileSync(
    path.join(OUTPUT_DIR, "settlement_benchmark_summary.csv"),
    summaryCsvLines.join("\n")
  );

  console.log(JSON.stringify({ ok: true, outputDir: OUTPUT_DIR, summaryRows }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
