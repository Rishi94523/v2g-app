'use client'

import Link from 'next/link'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { Zap, Battery, TrendingUp, Sun, Moon, LogOut } from 'lucide-react'

interface PriceData {
    current_price: number
    is_peak_hour: boolean
    recommendation: string
    forecast_24h: number[]
    best_buy_time: { hour: number; price: number; label: string }
    best_sell_time: { hour: number; price: number; label: string }
}

interface ContributionSummary {
    total_contributions: number
    total_energy_kwh: string
    total_tokens: number
}

export default function Dashboard() {
    const { user, loading, signOut } = useAuth()
    const router = useRouter()
    const [priceData, setPriceData] = useState<PriceData | null>(null)
    const [contributionSummary, setContributionSummary] = useState<ContributionSummary | null>(null)
    const [deviceStatus, setDeviceStatus] = useState<'online' | 'offline' | 'idle'>('online')
    const [currentAction, setCurrentAction] = useState<'charge' | 'discharge' | 'idle'>('idle')
    const [soc, setSoc] = useState(65)

    // Redirect to login if not authenticated
    useEffect(() => {
        if (!loading && !user) {
            router.push('/login')
        }
    }, [user, loading, router])

    useEffect(() => {
        if (!user) return

        // Fetch price data
        fetch('/api/price')
            .then(res => res.json())
            .then(setPriceData)
            .catch(console.error)

        // Fetch contribution summary for the logged-in user
        fetch(`/api/contribution?user_id=${user.id}`)
            .then(res => res.json())
            .then(data => setContributionSummary(data.summary))
            .catch(console.error)

        // Simulate device status
        const interval = setInterval(() => {
            setSoc(prev => {
                if (currentAction === 'charge') return Math.min(100, prev + 0.5)
                if (currentAction === 'discharge') return Math.max(20, prev - 0.5)
                return prev
            })
        }, 2000)

        return () => clearInterval(interval)
    }, [user, currentAction])

    const simulateDecision = async () => {
        const response = await fetch('/api/decision', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer demo-token'
            },
            body: JSON.stringify({
                soc_percent: soc,
                battery_temp_c: 25,
                solar_power_kw: 2.5,
                grid_connected: true
            })
        })
        const decision = await response.json()
        setCurrentAction(decision.action)
    }

    // Show loading state while checking auth
    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-[var(--background)]">
                <div className="animate-spin w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full" />
            </div>
        )
    }

    // Don't render if not logged in (redirect will happen)
    if (!user) {
        return null
    }

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
                        <Link href="/dashboard" className="neu-pressed flex items-center gap-3 px-4 py-3 rounded-xl text-green-600 font-bold">
                            <Zap className="w-5 h-5" />
                            Dashboard
                        </Link>
                        <Link href="/dashboard/devices" className="flex items-center gap-3 px-4 py-3 rounded-xl text-slate-500 hover:text-slate-700 hover:bg-slate-200/50 transition">
                            <Battery className="w-5 h-5" />
                            Devices
                        </Link>
                        <Link href="/dashboard/settings" className="flex items-center gap-3 px-4 py-3 rounded-xl text-slate-500 hover:text-slate-700 hover:bg-slate-200/50 transition">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                            Settings
                        </Link>
                    </nav>

                    <div className="space-y-6">
                        <div className="neu-inset p-4 rounded-2xl">
                            <div className="text-xs font-bold text-slate-400 mb-1 uppercase tracking-wider">Token Balance</div>
                            <div className="text-2xl font-black text-slate-700">{contributionSummary?.total_tokens || 0}</div>
                            <div className="text-xs text-green-500 font-bold">V2G Tokens</div>
                        </div>

                        {/* User info and sign out */}
                        <div className="flex items-center justify-between pt-4 border-t border-slate-200">
                            <div className="flex items-center gap-2 min-w-0">
                                <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-xs font-bold shrink-0 text-slate-600">
                                    {user.email?.[0]?.toUpperCase() || 'U'}
                                </div>
                                <div className="flex flex-col">
                                    <span className="text-xs font-bold text-slate-700 truncate max-w-[90px]">User</span>
                                    <span className="text-[10px] text-slate-400 truncate max-w-[90px]">{user.email}</span>
                                </div>
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
                {/* Header */}
                <header className="flex items-center justify-between mb-10">
                    <div>
                        <h1 className="text-4xl font-black text-slate-700 mb-2">Dashboard</h1>
                        <p className="text-slate-500 font-medium">Overview of your energy assets</p>
                    </div>
                    <div className="flex items-center gap-4">
                        <button
                            onClick={simulateDecision}
                            className="neu-btn text-sm py-3 px-6"
                        >
                            <Zap className="w-4 h-4" />
                            Analyze & Decide
                        </button>
                    </div>
                </header>

                {/* Stats Grid */}
                <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 mb-10">
                    {/* Current Price */}
                    <div className="card">
                        <div className="flex items-center justify-between mb-4">
                            <span className="text-slate-500 font-bold text-sm">Grid Price</span>
                            {priceData?.is_peak_hour && (
                                <span className="neu-inset px-3 py-1 text-xs font-bold text-amber-500 rounded-full">
                                    PEAK
                                </span>
                            )}
                        </div>
                        <div className="text-3xl font-black text-slate-700">
                            ₹{priceData?.current_price?.toFixed(2) || '--'}
                            <span className="text-sm text-slate-400 font-medium ml-1">/kWh</span>
                        </div>
                    </div>

                    {/* Battery Status */}
                    <div className="card">
                        <div className="flex items-center justify-between mb-4">
                            <span className="text-slate-500 font-bold text-sm">Battery SOC</span>
                            <div className={`w-3 h-3 rounded-full ${deviceStatus === 'online' ? 'bg-green-500 shadow-[0_0_10px_#22c55e]' : 'bg-red-500'}`} />
                        </div>
                        <div className="text-3xl font-black text-slate-700 mb-3">
                            {soc.toFixed(0)}%
                        </div>
                        <div className="w-full h-3 bg-slate-200 rounded-full neu-inset overflow-hidden">
                            <div
                                className="h-full rounded-full bg-green-500 transition-all duration-500"
                                style={{ width: `${soc}%` }}
                            />
                        </div>
                    </div>

                    {/* Current Action */}
                    <div className="card">
                        <div className="text-slate-500 font-bold text-sm mb-4">Status</div>
                        <div className={`text-2xl font-black capitalise mb-2 ${currentAction === 'charge' ? 'text-green-500' :
                                currentAction === 'discharge' ? 'text-slate-600' : 'text-slate-400'
                            }`}>
                            {currentAction}
                        </div>
                        <div className="text-xs text-slate-500 font-medium">
                            {currentAction === 'charge' && '⚡ Drawing power'}
                            {currentAction === 'discharge' && '📤 Injecting power'}
                            {currentAction === 'idle' && '⏸️ System Standby'}
                        </div>
                    </div>

                    {/* Total Earnings */}
                    <div className="card">
                        <div className="text-slate-500 font-bold text-sm mb-4">Contribution</div>
                        <div className="text-3xl font-black text-green-500 mb-1">
                            {contributionSummary?.total_energy_kwh || '0'} <span className="text-sm text-green-600/60">kWh</span>
                        </div>
                        <div className="text-xs text-slate-400 font-bold">
                            Total Energy Exported
                        </div>
                    </div>
                </div>

                {/* Price Chart & Recommendations */}
                <div className="grid lg:grid-cols-3 gap-8 mb-8">
                    {/* Price Forecast */}
                    <div className="lg:col-span-2 card">
                        <h3 className="text-lg font-bold text-slate-700 mb-6">24-Hour Price Forecast</h3>
                        <div className="h-64 flex items-end gap-2 px-4 pb-4 neu-inset rounded-2xl bg-slate-100/50">
                            {priceData?.forecast_24h?.slice(0, 24).map((price, i) => {
                                const maxPrice = Math.max(...(priceData?.forecast_24h || [1]))
                                const height = (price / maxPrice) * 100
                                const hour = (new Date().getHours() + i) % 24
                                const isCurrent = i === 0

                                return (
                                    <div key={i} className="flex-1 flex flex-col items-center gap-2 group relative">
                                        {/* Tooltip */}
                                        <div className="absolute bottom-full mb-2 opacity-0 group-hover:opacity-100 transition-opacity bg-slate-800 text-white text-xs py-1 px-2 rounded pointer-events-none whitespace-nowrap z-10">
                                            ₹{price.toFixed(2)} @ {hour}:00
                                        </div>

                                        <div
                                            className={`w-full rounded-t-lg transition-all hover:bg-opacity-80 ${isCurrent ? 'bg-green-500' :
                                                price > 8 ? 'bg-red-400' :
                                                    price < 5 ? 'bg-green-400' : 'bg-slate-400'
                                                }`}
                                            style={{ height: `${height}%` }}
                                        />
                                    </div>
                                )
                            })}
                        </div>
                        <div className="flex justify-center gap-8 mt-6 text-sm font-medium text-slate-500">
                            <span className="flex items-center gap-2">
                                <span className="w-3 h-3 rounded-full bg-green-400" /> Low Price
                            </span>
                            <span className="flex items-center gap-2">
                                <span className="w-3 h-3 rounded-full bg-slate-400" /> Normal
                            </span>
                            <span className="flex items-center gap-2">
                                <span className="w-3 h-3 rounded-full bg-red-400" /> High Price
                            </span>
                        </div>
                    </div>

                    {/* Recommendations */}
                    <div className="card flex flex-col">
                        <h3 className="text-lg font-bold text-slate-700 mb-6 flex items-center gap-2">
                            <SparklesIcon /> AI Insights
                        </h3>
                        <div className="space-y-4 flex-1">
                            <div className="neu-inset p-5 rounded-2xl bg-green-50/50">
                                <div className="text-xs font-bold text-green-600 mb-1 uppercase">Best Time to Buy</div>
                                <div className="text-2xl font-black text-slate-700">{priceData?.best_buy_time?.label || '--'}</div>
                                <div className="text-sm font-medium text-slate-500">Target: ₹{priceData?.best_buy_time?.price?.toFixed(2) || '--'}/kWh</div>
                            </div>

                            <div className="neu-inset p-5 rounded-2xl bg-slate-50/50">
                                <div className="text-xs font-bold text-slate-600 mb-1 uppercase">Best Time to Sell</div>
                                <div className="text-2xl font-black text-slate-700">{priceData?.best_sell_time?.label || '--'}</div>
                                <div className="text-sm font-medium text-slate-500">Target: ₹{priceData?.best_sell_time?.price?.toFixed(2) || '--'}/kWh</div>
                            </div>

                            <div className="mt-auto pt-4 text-sm text-slate-500 italic border-t border-slate-200">
                                "{priceData?.recommendation || 'Analyzing market trends...'}"
                            </div>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    )
}

function SparklesIcon() {
    return (
        <svg className="w-5 h-5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 3.214L13 21l-2.286-6.857L5 12l5.714-3.214z" />
        </svg>
    )
}
