import { createClient, SupabaseClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

// Client for browser usage (respects RLS)
export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Admin client for server-side operations (bypasses RLS)
export const supabaseAdmin: SupabaseClient = supabaseServiceKey
    ? createClient(supabaseUrl, supabaseServiceKey, {
        auth: {
            autoRefreshToken: false,
            persistSession: false
        }
    })
    : supabase

// Types for database tables
export interface Device {
    id: string
    user_id: string
    device_token: string
    name: string
    wallet_address: string | null
    last_seen_at: string | null
    created_at: string
}

export interface UserPreferences {
    user_id: string
    min_soc_percent: number
    disable_discharge: boolean
    no_discharge_days: string[]
    quiet_hours_start: string | null
    quiet_hours_end: string | null
}

export interface DecisionLog {
    id: number
    device_id: string
    timestamp: string
    soc_percent: number
    electricity_price: number
    decision: 'charge' | 'discharge' | 'idle'
    rate_kw: number
    solar_available_kw: number | null
    reason: string | null
}

export interface Contribution {
    id: number
    user_id: string
    device_id: string
    energy_kwh: number
    was_peak_hour: boolean
    was_emergency: boolean
    base_tokens: number
    multiplier: number
    total_tokens: number
    tx_hash: string | null
    submitted_to_chain: boolean
    created_at: string
}

// Helper functions

/**
 * Get device by token (for API authentication)
 */
export async function getDeviceByToken(token: string): Promise<Device | null> {
    const { data, error } = await supabaseAdmin
        .from('devices')
        .select('*')
        .eq('device_token', token)
        .single()

    if (error) {
        console.error('Error fetching device:', error)
        return null
    }

    // Update last_seen_at
    await supabaseAdmin
        .from('devices')
        .update({ last_seen_at: new Date().toISOString() })
        .eq('id', data.id)

    return data as Device
}

/**
 * Get user preferences
 */
export async function getUserPreferences(userId: string): Promise<UserPreferences | null> {
    const { data, error } = await supabaseAdmin
        .from('user_preferences')
        .select('*')
        .eq('user_id', userId)
        .single()

    if (error) {
        // Return defaults if not found
        return {
            user_id: userId,
            min_soc_percent: 20,
            disable_discharge: false,
            no_discharge_days: [],
            quiet_hours_start: null,
            quiet_hours_end: null
        }
    }

    return data as UserPreferences
}

/**
 * Log a decision
 */
export async function logDecision(
    deviceId: string,
    socPercent: number,
    electricityPrice: number,
    decision: string,
    rateKw: number,
    solarAvailable: number | null,
    reason: string
): Promise<void> {
    const { error } = await supabaseAdmin
        .from('decision_logs')
        .insert({
            device_id: deviceId,
            soc_percent: socPercent,
            electricity_price: electricityPrice,
            decision,
            rate_kw: rateKw,
            solar_available_kw: solarAvailable,
            reason
        })

    if (error) {
        console.error('Error logging decision:', error)
    }
}

/**
 * Create a contribution record
 */
export async function createContribution(
    userId: string,
    deviceId: string,
    energyKwh: number,
    wasPeakHour: boolean,
    wasEmergency: boolean
): Promise<{ id: number; tokens: number } | null> {
    const BASE_TOKENS_PER_KWH = 10
    const baseTokens = Math.floor(energyKwh * BASE_TOKENS_PER_KWH)

    let multiplier = 1.0
    if (wasEmergency) {
        multiplier = 3.0
    } else if (wasPeakHour) {
        multiplier = 2.0
    }

    const { data, error } = await supabaseAdmin
        .from('contributions')
        .insert({
            user_id: userId,
            device_id: deviceId,
            energy_kwh: energyKwh,
            was_peak_hour: wasPeakHour,
            was_emergency: wasEmergency,
            base_tokens: baseTokens,
            multiplier
        })
        .select('id, total_tokens')
        .single()

    if (error) {
        console.error('Error creating contribution:', error)
        return null
    }

    return { id: data.id, tokens: data.total_tokens }
}

/**
 * Get user stats
 */
export async function getUserStats(userId: string): Promise<{
    total_contributions: number
    total_energy_kwh: number
    total_tokens: number
    pending_submissions: number
}> {
    const { data, error } = await supabaseAdmin
        .rpc('get_user_stats', { p_user_id: userId })

    if (error) {
        console.error('Error getting user stats:', error)
        return {
            total_contributions: 0,
            total_energy_kwh: 0,
            total_tokens: 0,
            pending_submissions: 0
        }
    }

    return data[0] || {
        total_contributions: 0,
        total_energy_kwh: 0,
        total_tokens: 0,
        pending_submissions: 0
    }
}

/**
 * Register a new device
 */
export async function registerDevice(
    userId: string,
    name: string,
    walletAddress?: string
): Promise<{ deviceId: string; deviceToken: string } | null> {
    const deviceToken = `v2g_${crypto.randomUUID().replace(/-/g, '')}`

    const { data, error } = await supabaseAdmin
        .from('devices')
        .insert({
            user_id: userId,
            device_token: deviceToken,
            name,
            wallet_address: walletAddress || null
        })
        .select('id')
        .single()

    if (error) {
        console.error('Error registering device:', error)
        return null
    }

    return { deviceId: data.id, deviceToken }
}
