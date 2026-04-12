import { ethers } from 'ethers'
import { getBlockchainDeploymentConfig } from './blockchain-config'

export interface PendingContributionForChain {
    id: number
    walletAddress: string
    energyKwh: number
    wasPeakHour: boolean
    wasEmergency: boolean
}

const REWARD_DISTRIBUTOR_ABI = [
    'function batchDistributeRewards((address user,uint256 energyKwh,bool wasPeakHour,bool wasEmergency,bytes32 contributionId)[] rewards) external',
]

function getDistributionConfig() {
    const deployment = getBlockchainDeploymentConfig()
    const privateKey = process.env.PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY
    const rewardDistributorAddress = deployment.rewardDistributorAddress

    return { rpcUrl: deployment.rpcUrl, privateKey, rewardDistributorAddress }
}

export function isBlockchainDistributionConfigured(): boolean {
    const { privateKey, rewardDistributorAddress } = getDistributionConfig()
    return !!privateKey && !!rewardDistributorAddress
}

export async function settleContributionsOnChain(
    contributions: PendingContributionForChain[]
): Promise<{
    txHash: string
    processedIds: number[]
    gasUsed: string
    effectiveGasPriceWei: string
    feeWei: string
    blockNumber: number
}> {
    if (contributions.length === 0) {
        throw new Error('No contributions provided for settlement')
    }

    const { rpcUrl, privateKey, rewardDistributorAddress } = getDistributionConfig()
    if (!privateKey || !rewardDistributorAddress) {
        throw new Error('Blockchain distribution is not configured')
    }

    const provider = new ethers.JsonRpcProvider(rpcUrl)
    const signer = new ethers.Wallet(privateKey, provider)
    const contract = new ethers.Contract(
        rewardDistributorAddress,
        REWARD_DISTRIBUTOR_ABI,
        signer
    )

    const rewards = contributions.map((c) => ({
        user: c.walletAddress,
        energyKwh: BigInt(Math.max(0, Math.round(c.energyKwh * 1000))),
        wasPeakHour: c.wasPeakHour,
        wasEmergency: c.wasEmergency,
        contributionId: ethers.keccak256(ethers.toUtf8Bytes(`contribution-${c.id}`))
    }))

    const tx = await contract.batchDistributeRewards(rewards)
    const receipt = await tx.wait()

    if (!receipt || !receipt.hash) {
        throw new Error('Transaction failed while settling contributions')
    }

    return {
        txHash: receipt.hash,
        processedIds: contributions.map((c) => c.id),
        gasUsed: receipt.gasUsed.toString(),
        effectiveGasPriceWei: (receipt.gasPrice ?? 0n).toString(),
        feeWei: (receipt.gasUsed * (receipt.gasPrice ?? 0n)).toString(),
        blockNumber: receipt.blockNumber,
    }
}
