'use client'

import Link from 'next/link'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { Zap, Battery, Settings, LogOut, Plus, Trash2, Cpu } from 'lucide-react'

interface Device {
    id: string
    name: string
    wallet_address: string | null
    last_seen_at: string | null
    created_at: string
}

export default function DevicesPage() {
    const { user, loading, signOut } = useAuth()
    const router = useRouter()
    const [devices, setDevices] = useState<Device[]>([])
    const [loadingDevices, setLoadingDevices] = useState(true)
    const [showAddModal, setShowAddModal] = useState(false)
    const [newDeviceName, setNewDeviceName] = useState('')
    const [newDeviceToken, setNewDeviceToken] = useState<string | null>(null)
    const [saving, setSaving] = useState(false)

    useEffect(() => {
        if (!loading && !user) {
            router.push('/login')
        }
    }, [user, loading, router])

    useEffect(() => {
        if (!user) return

        fetch(`/api/device?user_id=${user.id}`)
            .then(res => res.json())
            .then(data => {
                setDevices(data.devices || [])
                setLoadingDevices(false)
            })
            .catch(err => {
                console.error('Error fetching devices:', err)
                setLoadingDevices(false)
            })
    }, [user])

    const addDevice = async () => {
        if (!user || !newDeviceName.trim()) return

        setSaving(true)
        try {
            const response = await fetch('/api/device', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    user_id: user.id,
                    name: newDeviceName.trim()
                })
            })
            const data = await response.json()

            if (data.device_token) {
                setNewDeviceToken(data.device_token)
                const devicesRes = await fetch(`/api/device?user_id=${user.id}`)
                const devicesData = await devicesRes.json()
                setDevices(devicesData.devices || [])
            }
        } catch (error) {
            console.error('Error adding device:', error)
        } finally {
            setSaving(false)
        }
    }

    const deleteDevice = async (deviceId: string) => {
        if (!user || !confirm('Are you sure you want to delete this device?')) return

        try {
            await fetch(`/api/device?device_id=${deviceId}&user_id=${user.id}`, {
                method: 'DELETE'
            })
            setDevices(devices.filter(d => d.id !== deviceId))
        } catch (error) {
            console.error('Error deleting device:', error)
        }
    }

    const closeModal = () => {
        setShowAddModal(false)
        setNewDeviceName('')
        setNewDeviceToken(null)
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
                        <Link href="/dashboard/devices" className="neu-inset flex items-center gap-3 px-4 py-3 rounded-xl text-green-600 font-bold">
                            <Battery className="w-5 h-5" />
                            Devices
                        </Link>
                        <Link href="/dashboard/settings" className="flex items-center gap-3 px-4 py-3 rounded-xl text-slate-500 hover:text-slate-700 hover:bg-slate-200/50 transition">
                            <Settings className="w-5 h-5" />
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
                <header className="flex items-center justify-between mb-10">
                    <div>
                        <h1 className="text-4xl font-black text-slate-700 mb-2">Devices</h1>
                        <p className="text-slate-500 font-medium">Manage your V2G devices</p>
                    </div>
                    <button
                        onClick={() => setShowAddModal(true)}
                        className="neu-btn text-sm py-3 px-6"
                    >
                        <Plus className="w-4 h-4" />
                        Add Device
                    </button>
                </header>

                {loadingDevices ? (
                    <div className="flex items-center justify-center py-20">
                        <div className="animate-spin w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full" />
                    </div>
                ) : devices.length === 0 ? (
                    <div className="card text-center py-16">
                        <div className="w-20 h-20 mx-auto mb-6 rounded-2xl neu-inset flex items-center justify-center">
                            <Cpu className="w-10 h-10 text-slate-400" />
                        </div>
                        <h3 className="text-2xl font-bold text-slate-700 mb-3">No devices yet</h3>
                        <p className="text-slate-500 mb-8 max-w-md mx-auto">Add your first V2G device to start earning tokens</p>
                        <button
                            onClick={() => setShowAddModal(true)}
                            className="neu-btn"
                        >
                            <Plus className="w-4 h-4" />
                            Add Your First Device
                        </button>
                    </div>
                ) : (
                    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {devices.map(device => (
                            <div key={device.id} className="card">
                                <div className="flex items-center justify-between mb-4">
                                    <div className="w-12 h-12 rounded-xl neu-inset flex items-center justify-center">
                                        <Cpu className="w-6 h-6 text-green-500" />
                                    </div>
                                    <button
                                        onClick={() => deleteDevice(device.id)}
                                        className="neu-icon-btn w-10 h-10 text-slate-400 hover:text-red-500 transition"
                                        title="Delete device"
                                    >
                                        <Trash2 className="w-5 h-5" />
                                    </button>
                                </div>
                                <h3 className="font-bold text-slate-700 text-lg mb-3">{device.name}</h3>
                                <div className="text-sm text-slate-500 space-y-1">
                                    <p>
                                        Last seen: {device.last_seen_at
                                            ? new Date(device.last_seen_at).toLocaleString()
                                            : 'Never'}
                                    </p>
                                    <p>
                                        Created: {new Date(device.created_at).toLocaleDateString()}
                                    </p>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </main>

            {/* Add Device Modal */}
            {showAddModal && (
                <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="card max-w-md w-full">
                        {newDeviceToken ? (
                            <>
                                <h2 className="text-xl font-bold mb-4 text-green-500">Device Created!</h2>
                                <p className="text-slate-500 mb-4">
                                    Save this token - you&apos;ll need it for your ESP32 device. It won&apos;t be shown again.
                                </p>
                                <div className="p-4 rounded-xl neu-inset font-mono text-sm break-all mb-6 text-slate-700">
                                    {newDeviceToken}
                                </div>
                                <button
                                    onClick={closeModal}
                                    className="neu-btn w-full justify-center"
                                >
                                    Done
                                </button>
                            </>
                        ) : (
                            <>
                                <h2 className="text-xl font-bold mb-4 text-slate-700">Add New Device</h2>
                                <label className="block text-sm text-slate-500 mb-2 font-medium">Device Name</label>
                                <input
                                    type="text"
                                    value={newDeviceName}
                                    onChange={e => setNewDeviceName(e.target.value)}
                                    placeholder="e.g., Home V2G Charger"
                                    className="w-full px-4 py-3 rounded-xl neu-inset bg-transparent border-none focus:outline-none text-slate-700 placeholder-slate-400 mb-6"
                                />
                                <div className="flex gap-3">
                                    <button
                                        onClick={closeModal}
                                        className="neu-btn flex-1 justify-center text-slate-500"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={addDevice}
                                        disabled={saving || !newDeviceName.trim()}
                                        className="neu-btn flex-1 justify-center disabled:opacity-50"
                                    >
                                        {saving ? 'Creating...' : 'Create Device'}
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}
