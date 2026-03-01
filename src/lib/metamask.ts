export interface MetaMaskConnection {
    address: string
    chainId: string
}

interface EthereumRequestArgs {
    method: string
    params?: unknown[] | Record<string, unknown>
}

interface EthereumProvider {
    request: (args: EthereumRequestArgs) => Promise<unknown>
    on?: (eventName: string, handler: (...args: unknown[]) => void) => void
    removeListener?: (eventName: string, handler: (...args: unknown[]) => void) => void
}

const SEPOLIA_CHAIN_ID_HEX = '0xaa36a7'

const SEPOLIA_CHAIN_PARAMS = {
    chainId: SEPOLIA_CHAIN_ID_HEX,
    chainName: 'Sepolia',
    nativeCurrency: {
        name: 'Sepolia Ether',
        symbol: 'ETH',
        decimals: 18
    },
    rpcUrls: ['https://rpc.sepolia.org'],
    blockExplorerUrls: ['https://sepolia.etherscan.io']
}

declare global {
    interface Window {
        ethereum?: EthereumProvider
    }
}

function getProvider(): EthereumProvider {
    if (typeof window === 'undefined' || !window.ethereum) {
        throw new Error('MetaMask is not available in this browser')
    }
    return window.ethereum
}

export function isMetaMaskAvailable(): boolean {
    return typeof window !== 'undefined' && !!window.ethereum
}

export function isSepolia(chainId: string | null | undefined): boolean {
    return (chainId || '').toLowerCase() === SEPOLIA_CHAIN_ID_HEX
}

export async function getCurrentChainId(): Promise<string | null> {
    if (!isMetaMaskAvailable()) return null
    const provider = getProvider()
    const chainId = await provider.request({ method: 'eth_chainId' })
    return String(chainId)
}

export async function ensureSepoliaNetwork(): Promise<string> {
    const provider = getProvider()
    const currentChain = await provider.request({ method: 'eth_chainId' })
    const currentChainId = String(currentChain)

    if (isSepolia(currentChainId)) {
        return currentChainId
    }

    try {
        await provider.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: SEPOLIA_CHAIN_ID_HEX }]
        })
        return SEPOLIA_CHAIN_ID_HEX
    } catch (error) {
        const switchError = error as { code?: number; message?: string }
        // 4902 means chain is not added in wallet.
        if (switchError?.code === 4902) {
            await provider.request({
                method: 'wallet_addEthereumChain',
                params: [SEPOLIA_CHAIN_PARAMS]
            })
            return SEPOLIA_CHAIN_ID_HEX
        }
        throw new Error(switchError?.message || 'Failed to switch MetaMask network')
    }
}

export async function connectMetaMask(): Promise<MetaMaskConnection> {
    const provider = getProvider()

    await ensureSepoliaNetwork()
    const accounts = await provider.request({ method: 'eth_requestAccounts' })
    const walletAccounts = accounts as string[]
    const address = walletAccounts?.[0]

    if (!address) {
        throw new Error('No account selected in MetaMask')
    }

    return {
        address,
        chainId: SEPOLIA_CHAIN_ID_HEX
    }
}

export async function getConnectedAccount(): Promise<string | null> {
    if (!isMetaMaskAvailable()) return null
    const provider = getProvider()
    const accounts = await provider.request({ method: 'eth_accounts' })
    const walletAccounts = accounts as string[]
    return walletAccounts?.[0] || null
}

export function shortAddress(address: string): string {
    if (!address) return ''
    return `${address.slice(0, 6)}...${address.slice(-4)}`
}
