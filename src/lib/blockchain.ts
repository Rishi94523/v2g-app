import { ethers } from 'ethers'

// Contract ABIs (simplified - only functions we need)
const V2G_TOKEN_ABI = [
    'function balanceOf(address account) view returns (uint256)',
    'function symbol() view returns (string)',
    'function decimals() view returns (uint8)',
    'function totalSupply() view returns (uint256)',
    'event Transfer(address indexed from, address indexed to, uint256 value)'
]

const REWARD_DISTRIBUTOR_ABI = [
    'function getUserStats(address user) view returns (uint256 totalEarned, uint256 totalKwh)',
    'function totalDistributed() view returns (uint256)',
    'function baseRewardPerKwh() view returns (uint256)',
    'function peakHourMultiplier() view returns (uint256)',
    'function emergencyMultiplier() view returns (uint256)',
    'event RewardDistributed(address indexed user, uint256 energyKwh, uint256 tokensAwarded, bytes32 contributionId)'
]

/**
 * Get provider based on environment
 */
export function getProvider(): ethers.JsonRpcProvider {
    const rpcUrl = process.env.SEPOLIA_RPC_URL || 'https://rpc.sepolia.org'
    return new ethers.JsonRpcProvider(rpcUrl)
}

/**
 * Get V2G Token contract instance
 */
export function getV2GTokenContract(signerOrProvider?: ethers.Signer | ethers.Provider) {
    const address = process.env.NEXT_PUBLIC_V2G_TOKEN_ADDRESS
    if (!address) {
        throw new Error('V2G Token address not configured')
    }
    return new ethers.Contract(address, V2G_TOKEN_ABI, signerOrProvider || getProvider())
}

/**
 * Get Reward Distributor contract instance
 */
export function getRewardDistributorContract(signerOrProvider?: ethers.Signer | ethers.Provider) {
    const address = process.env.NEXT_PUBLIC_REWARD_DISTRIBUTOR_ADDRESS
    if (!address) {
        throw new Error('Reward Distributor address not configured')
    }
    return new ethers.Contract(address, REWARD_DISTRIBUTOR_ABI, signerOrProvider || getProvider())
}

/**
 * Get user's V2G token balance
 */
export async function getTokenBalance(walletAddress: string): Promise<string> {
    try {
        const contract = getV2GTokenContract()
        const balance = await contract.balanceOf(walletAddress)
        return ethers.formatEther(balance)
    } catch (error) {
        console.error('Error fetching token balance:', error)
        return '0'
    }
}

/**
 * Get user's contribution statistics from blockchain
 */
export async function getUserStats(walletAddress: string): Promise<{
    totalEarned: string
    totalKwh: string
}> {
    try {
        const contract = getRewardDistributorContract()
        const [totalEarned, totalKwh] = await contract.getUserStats(walletAddress)
        return {
            totalEarned: ethers.formatEther(totalEarned),
            totalKwh: (Number(totalKwh) / 1000).toFixed(2) // Convert from scaled value
        }
    } catch (error) {
        console.error('Error fetching user stats:', error)
        return { totalEarned: '0', totalKwh: '0' }
    }
}

/**
 * Get total tokens distributed
 */
export async function getTotalDistributed(): Promise<string> {
    try {
        const contract = getRewardDistributorContract()
        const total = await contract.totalDistributed()
        return ethers.formatEther(total)
    } catch (error) {
        console.error('Error fetching total distributed:', error)
        return '0'
    }
}

/**
 * Format wallet address for display
 */
export function formatAddress(address: string): string {
    if (!address) return ''
    return `${address.slice(0, 6)}...${address.slice(-4)}`
}

/**
 * Check if a string is a valid Ethereum address
 */
export function isValidAddress(address: string): boolean {
    try {
        ethers.getAddress(address)
        return true
    } catch {
        return false
    }
}
