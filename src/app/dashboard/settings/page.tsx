'use client'

import Link from 'next/link'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { supabase } from '@/lib/supabase'
import { Zap, Battery, Settings as SettingsIcon, LogOut, Check, Wallet, Loader2 } from 'lucide-react'
import {
    connectMetaMask,
    getConnectedAccount,
    getCurrentChainId,
    isMetaMaskAvailable,
    isSepolia,
    shortAddress
} from '@/lib/metamask'

export default function Settings() {
    const { user, loading, signOut } = useAuth()
    const router = useRouter()

    const [preferences, setPreferences] = useState({
        min_soc_percent: 20,
        disable_discharge: false,
        no_discharge_days: [] as string[],
        quiet_hours_start: '',
        quiet_hours_end: '',
        wallet_address: ''
    })

    const [saved, setSaved] = useState(false)
    const [saving, setSaving] = useState(false)
    const [loadingPrefs, setLoadingPrefs] = useState(true)
    const [walletConnecting, setWalletConnecting] = useState(false)
    const [walletError, setWalletError] = useState<string | null>(null)
    const [walletInfo, setWalletInfo] = useState<{
        available: boolean
        address: string | null
        chainId: string | null
    }>({
        available: false,
        address: null,
        chainId: null
    })

    const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']

    // Load existing preferences from database
    useEffect(() => {
        async function loadPreferences() {
            if (!user) return

            try {
                const { data, error } = await supabase
                    .from('user_preferences')
                    .select('*')
                    .eq('user_id', user.id)
                    .single()

                if (data && !error) {
                    setPreferences({
                        min_soc_percent: data.min_soc_percent ?? 20,
                        disable_discharge: data.disable_discharge ?? false,
                        no_discharge_days: data.no_discharge_days ?? [],
                        quiet_hours_start: data.quiet_hours_start ?? '',
                        quiet_hours_end: data.quiet_hours_end ?? '',
                        wallet_address: data.wallet_address ?? ''
                    })
                }
            } catch (err) {
                console.error('Error loading preferences:', err)
            } finally {
                setLoadingPrefs(false)
            }
        }

        if (!loading && user) {
            loadPreferences()
        }
    }, [user, loading])

    useEffect(() => {
        if (!loading && !user) {
            router.push('/login')
        }
    }, [user, loading, router])

    useEffect(() => {
        async function syncWalletState() {
            const available = isMetaMaskAvailable()
            if (!available) {
                setWalletInfo({ available: false, address: null, chainId: null })
                return
            }

            try {
                const [address, chainId] = await Promise.all([
                    getConnectedAccount(),
                    getCurrentChainId()
                ])
                setWalletInfo({ available: true, address, chainId })
            } catch (error) {
                console.error('Failed to read MetaMask state:', error)
                setWalletInfo({ available: true, address: null, chainId: null })
            }
        }

        syncWalletState()
    }, [])

    const toggleDay = (day: string) => {
        setPreferences(prev => ({
            ...prev,
            no_discharge_days: prev.no_discharge_days.includes(day)
                ? prev.no_discharge_days.filter(d => d !== day)
                : [...prev.no_discharge_days, day]
        }))
    }

    const handleSave = async () => {
        if (!user) return

        if (preferences.wallet_address && !isWalletAddress(preferences.wallet_address)) {
            setWalletError('Wallet address must be a valid EVM address')
            return
        }

        setWalletError(null)
        setSaving(true)
        try {
            const { error } = await supabase
                .from('user_preferences')
                .upsert({
                    user_id: user.id,
                    min_soc_percent: preferences.min_soc_percent,
                    disable_discharge: preferences.disable_discharge,
                    no_discharge_days: preferences.no_discharge_days,
                    quiet_hours_start: preferences.quiet_hours_start || null,
                    quiet_hours_end: preferences.quiet_hours_end || null,
                    wallet_address: preferences.wallet_address || null
                }, { onConflict: 'user_id' })

            if (error) {
                console.error('Error saving preferences:', error)
                return
            }

            setSaved(true)
            setTimeout(() => setSaved(false), 3000)
        } catch (err) {
            console.error('Error saving preferences:', err)
        } finally {
            setSaving(false)
        }
    }

    const handleConnectWallet = async () => {
        setWalletError(null)
        setWalletConnecting(true)
        try {
            const connection = await connectMetaMask()
            setWalletInfo({
                available: true,
                address: connection.address,
                chainId: connection.chainId
            })
            setPreferences((prev) => ({
                ...prev,
                wallet_address: connection.address
            }))
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to connect MetaMask'
            setWalletError(message)
        } finally {
            setWalletConnecting(false)
        }
    }

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-[var(--background)]">
                <div className="animate-spin w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full" />
            </div>
        )
    }

    if (!user) return null

    return (
        <div className="min-h-screen bg-[var(--background)] flex">
            {/* Sidebar */}
            <aside className="fixed left-0 top-0 h-full w-64 p-6 hidden lg:flex flex-col z-50">
                <div className="neu-flat h-full w-full flex flex-col p-6">
                    <div className="flex items-center gap-3 mb-10">
                        <div className="w-10 h-10 rounded-xl neu-inset flex items-center justify-center text-green-500">
                            <Zap className="w-6 h-6 fill-current" />
                        </div>
                        <span className="text-xl font-black text-slate-700">V2G</span>
                    </div>

                    <nav className="space-y-4 flex-1">
                        <Link href="/dashboard" className="flex items-center gap-3 px-4 py-3 rounded-xl text-slate-500 hover:text-slate-700 hover:bg-slate-200/50 transition">
                            <Zap className="w-5 h-5" />
                            Dashboard
                        </Link>
                        <Link href="/dashboard/devices" className="flex items-center gap-3 px-4 py-3 rounded-xl text-slate-500 hover:text-slate-700 hover:bg-slate-200/50 transition">
                            <Battery className="w-5 h-5" />
                            Devices
                        </Link>
                        <Link href="/dashboard/settings" className="neu-inset flex items-center gap-3 px-4 py-3 rounded-xl text-green-600 font-bold">
                            <SettingsIcon className="w-5 h-5" />
                            Settings
                        </Link>
                    </nav>

                    <div className="pt-4 border-t border-slate-200">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 min-w-0">
                                <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-xs font-bold shrink-0 text-slate-600">
                                    {user.email?.[0]?.toUpperCase() || 'U'}
                                </div>
                                <span className="text-xs text-slate-500 truncate max-w-[100px]">{user.email}</span>
                            </div>
                            <button
                                onClick={signOut}
                                className="neu-icon-btn w-8 h-8 text-slate-400 hover:text-red-500"
                                title="Sign out"
                            >
                                <LogOut className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                </div>
            </aside>

            {/* Main Content */}
            <main className="lg:ml-64 p-8 w-full">
                <header className="mb-10">
                    <h1 className="text-4xl font-black text-slate-700 mb-2">Settings</h1>
                    <p className="text-slate-500 font-medium">Configure your V2G preferences</p>
                </header>

                <div className="max-w-2xl space-y-8">
                    {/* Battery Settings */}
                    <div className="card">
                        <h2 className="text-xl font-bold text-slate-700 mb-6">Battery Protection</h2>

                        <div className="space-y-8">
                            {/* Minimum SOC */}
                            <div>
                                <label className="block text-sm text-slate-500 mb-3 font-medium">
                                    Minimum State of Charge
                                </label>
                                <div className="flex items-center gap-4">
                                    <div className="flex-1 neu-inset rounded-full p-1">
                                        <input
                                            type="range"
                                            min="10"
                                            max="50"
                                            value={preferences.min_soc_percent}
                                            onChange={(e) => setPreferences(prev => ({ ...prev, min_soc_percent: parseInt(e.target.value) }))}
                                            className="w-full h-2 bg-transparent rounded-lg appearance-none cursor-pointer accent-green-500"
                                        />
                                    </div>
                                    <span className="w-16 text-center font-bold text-slate-700 text-lg">
                                        {preferences.min_soc_percent}%
                                    </span>
                                </div>
                                <p className="text-xs text-slate-400 mt-2">
                                    Battery will never discharge below this level
                                </p>
                            </div>

                            {/* Disable Discharge */}
                            <div className="flex items-center justify-between p-4 neu-inset rounded-2xl">
                                <div>
                                    <div className="font-bold text-slate-700">Disable All Discharging</div>
                                    <p className="text-sm text-slate-500">Stop selling power to grid completely</p>
                                </div>
                                <button
                                    onClick={() => setPreferences(prev => ({ ...prev, disable_discharge: !prev.disable_discharge }))}
                                    className={`w-14 h-8 rounded-full transition-all relative ${preferences.disable_discharge ? 'bg-red-500' : 'bg-slate-300'
                                        }`}
                                >
                                    <div className={`w-6 h-6 rounded-full bg-white shadow-md transition-transform absolute top-1 ${preferences.disable_discharge ? 'translate-x-7' : 'translate-x-1'
                                        }`} />
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Schedule Settings */}
                    <div className="card">
                        <h2 className="text-xl font-bold text-slate-700 mb-6">Schedule</h2>

                        <div className="space-y-8">
                            {/* No Discharge Days */}
                            <div>
                                <label className="block text-sm text-slate-500 mb-3 font-medium">
                                    No-Discharge Days
                                </label>
                                <div className="flex flex-wrap gap-2">
                                    {days.map(day => (
                                        <button
                                            key={day}
                                            onClick={() => toggleDay(day)}
                                            className={`px-4 py-2 rounded-xl capitalize transition font-medium ${preferences.no_discharge_days.includes(day)
                                                ? 'bg-green-500 text-white shadow-lg'
                                                : 'neu-flat text-slate-500 hover:text-slate-700'
                                                }`}
                                        >
                                            {day.slice(0, 3)}
                                        </button>
                                    ))}
                                </div>
                                <p className="text-xs text-slate-400 mt-2">
                                    Select days when discharging should be disabled
                                </p>
                            </div>

                            {/* Quiet Hours */}
                            <div>
                                <label className="block text-sm text-slate-500 mb-3 font-medium">
                                    Quiet Hours (No Grid Activity)
                                </label>
                                <div className="flex items-center gap-4">
                                    <input
                                        type="time"
                                        value={preferences.quiet_hours_start}
                                        onChange={(e) => setPreferences(prev => ({ ...prev, quiet_hours_start: e.target.value }))}
                                        className="neu-inset rounded-xl px-4 py-3 text-slate-700 bg-transparent focus:outline-none"
                                    />
                                    <span className="text-slate-400 font-medium">to</span>
                                    <input
                                        type="time"
                                        value={preferences.quiet_hours_end}
                                        onChange={(e) => setPreferences(prev => ({ ...prev, quiet_hours_end: e.target.value }))}
                                        className="neu-inset rounded-xl px-4 py-3 text-slate-700 bg-transparent focus:outline-none"
                                    />
                                </div>
                                <p className="text-xs text-slate-400 mt-2">
                                    No charging or discharging during these hours
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Wallet Settings */}
                    <div className="card">
                        <div className="flex items-center gap-3 mb-6">
                            <div className="neu-icon-btn w-10 h-10">
                                <Wallet className="w-5 h-5 text-slate-600" />
                            </div>
                            <h2 className="text-xl font-bold text-slate-700">Blockchain Wallet</h2>
                        </div>

                        <div className="space-y-4">
                            <button
                                onClick={handleConnectWallet}
                                disabled={!walletInfo.available || walletConnecting}
                                className="neu-btn text-sm py-3 px-5 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {walletConnecting && <Loader2 className="w-4 h-4 animate-spin" />}
                                {walletConnecting ? 'Connecting...' : 'Connect MetaMask (Sepolia)'}
                            </button>

                            <div className="text-xs text-slate-500 space-y-1">
                                <p>MetaMask: {walletInfo.available ? 'Detected' : 'Not detected'}</p>
                                <p>
                                    Network: {walletInfo.chainId ? (isSepolia(walletInfo.chainId) ? 'Sepolia' : walletInfo.chainId) : 'Not connected'}
                                </p>
                                <p>
                                    Connected account: {walletInfo.address ? shortAddress(walletInfo.address) : 'Not connected'}
                                </p>
                            </div>

                            <label className="block text-sm text-slate-500 mb-2 font-medium">
                                Ethereum Wallet Address (Sepolia)
                            </label>
                            <input
                                type="text"
                                placeholder="0x..."
                                value={preferences.wallet_address}
                                onChange={(e) => setPreferences(prev => ({ ...prev, wallet_address: e.target.value }))}
                                className="w-full neu-inset rounded-xl px-4 py-3 text-slate-700 bg-transparent placeholder-slate-400 focus:outline-none"
                            />
                            <p className="text-xs text-slate-400 mt-2">
                                V2G tokens will be sent to this address
                            </p>
                            {walletError && (
                                <p className="text-xs text-red-500 mt-2">{walletError}</p>
                            )}
                        </div>
                    </div>

                    {/* Save Button */}
                    <div className="flex items-center gap-4">
                        <button
                            onClick={handleSave}
                            disabled={saving || loadingPrefs}
                            className="neu-btn disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                        >
                            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                            {saving ? 'Saving...' : 'Save Preferences'}
                        </button>
                        {saved && (
                            <span className="text-green-500 flex items-center gap-2 font-medium">
                                <Check className="w-5 h-5" />
                                Saved successfully!
                            </span>
                        )}
                    </div>
                </div>
            </main>
        </div>
    )
}

function isWalletAddress(address: string): boolean {
    return /^0x[a-fA-F0-9]{40}$/.test(address.trim())
}
