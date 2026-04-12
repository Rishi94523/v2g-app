import sepoliaDeployment from '../../contracts/deployments/sepolia.json'

const DEFAULT_SEPOLIA_RPC = 'https://ethereum-sepolia-rpc.publicnode.com'

export interface BlockchainDeploymentConfig {
    rpcUrl: string
    v2gTokenAddress: string
    rewardDistributorAddress: string
}

function clean(value: string | null | undefined): string {
    return (value || '').trim()
}

export function getBlockchainDeploymentConfig(): BlockchainDeploymentConfig {
    const deploymentRpc = clean(sepoliaDeployment.rpcUrl)
    const deploymentToken = clean(sepoliaDeployment.contracts?.V2GToken)
    const deploymentDistributor = clean(sepoliaDeployment.contracts?.RewardDistributor)

    return {
        rpcUrl: clean(process.env.SEPOLIA_RPC_URL) || deploymentRpc || DEFAULT_SEPOLIA_RPC,
        v2gTokenAddress:
            clean(process.env.V2G_TOKEN_ADDRESS) ||
            clean(process.env.NEXT_PUBLIC_V2G_TOKEN_ADDRESS) ||
            deploymentToken,
        rewardDistributorAddress:
            clean(process.env.REWARD_DISTRIBUTOR_ADDRESS) ||
            clean(process.env.NEXT_PUBLIC_REWARD_DISTRIBUTOR_ADDRESS) ||
            deploymentDistributor,
    }
}
