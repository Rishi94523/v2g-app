/**
 * Electricity Maps API Service
 *
 * Integrates with Electricity Maps API for real-time grid data:
 * - Carbon intensity (gCO2/kWh)
 * - Day-ahead electricity prices
 * - Power breakdown by source
 *
 * API Docs: https://api-portal.electricitymaps.com/
 *
 * Zone: IN-SO (Southern India) - covers Telangana region
 */

import type { PriceData, GridStatus } from '@/types/v2g'

const API_BASE_URL = 'https://api.electricitymap.org/v3'
const API_KEY = process.env.ELECTRICITY_MAPS_API_KEY || process.env.ELECTRICITY_MAPS_API
const DEFAULT_ZONE = process.env.ELECTRICITY_MAPS_ZONE || 'IN-SO'

// Cache to avoid excessive API calls (free tier has limits)
interface CacheEntry<T> {
    data: T
    timestamp: number
    ttl: number
}

const cache: Map<string, CacheEntry<unknown>> = new Map()

function getCached<T>(key: string): T | null {
    const entry = cache.get(key)
    if (entry && Date.now() - entry.timestamp < entry.ttl) {
        return entry.data as T
    }
    cache.delete(key)
    return null
}

function setCache<T>(key: string, data: T, ttlMs: number = 5 * 60 * 1000): void {
    cache.set(key, { data, timestamp: Date.now(), ttl: ttlMs })
}

// API Response Types
interface ElectricityMapsError {
    error: string
    message?: string
}

interface CarbonIntensityResponse {
    zone: string
    carbonIntensity: number // gCO2eq/kWh
    datetime: string
    updatedAt: string
    createdAt: string
    emissionFactorType: string
    isEstimated: boolean
    estimationMethod?: string
}

interface PriceResponse {
    zone: string
    price: number // EUR/MWh (or local currency)
    currency: string
    datetime: string
    updatedAt: string
    createdAt: string
    isEstimated: boolean
}

interface PowerBreakdownResponse {
    zone: string
    datetime: string
    updatedAt: string
    powerConsumptionTotal: number
    powerProductionTotal: number
    powerImportTotal: number
    powerExportTotal: number
    fossilFreePercentage: number
    renewablePercentage: number
    powerConsumptionBreakdown: Record<string, number>
    powerProductionBreakdown: Record<string, number>
}

interface HistoryResponse<T> {
    zone: string
    history: T[]
}

/**
 * Make authenticated API request
 */
async function apiRequest<T>(endpoint: string, params: Record<string, string> = {}): Promise<T> {
    if (!API_KEY) {
        throw new Error('ELECTRICITY_MAPS_API_KEY is not configured')
    }

    const url = new URL(`${API_BASE_URL}${endpoint}`)
    Object.entries(params).forEach(([key, value]) => {
        if (value) url.searchParams.append(key, value)
    })

    const response = await fetch(url.toString(), {
        headers: {
            'auth-token': API_KEY,
        },
        next: { revalidate: 300 } // Cache for 5 minutes in Next.js
    })

    if (!response.ok) {
        const error = await response.json() as ElectricityMapsError
        throw new Error(`Electricity Maps API error: ${error.error || response.statusText}`)
    }

    return response.json() as Promise<T>
}

/**
 * Get current carbon intensity for the zone
 * Returns gCO2eq/kWh - useful for environmental optimization
 */
export async function getCarbonIntensity(zone: string = DEFAULT_ZONE): Promise<CarbonIntensityResponse | null> {
    const cacheKey = `carbon-intensity-${zone}`
    const cached = getCached<CarbonIntensityResponse>(cacheKey)
    if (cached) return cached

    try {
        const data = await apiRequest<CarbonIntensityResponse>('/carbon-intensity/latest', { zone })
        setCache(cacheKey, data, 5 * 60 * 1000) // 5 min cache
        return data
    } catch (error) {
        console.error('Failed to fetch carbon intensity:', error)
        return null
    }
}

/**
 * Get current day-ahead electricity price
 * Returns price in local currency per MWh
 */
export async function getDayAheadPrice(zone: string = DEFAULT_ZONE): Promise<PriceResponse | null> {
    const cacheKey = `price-${zone}`
    const cached = getCached<PriceResponse>(cacheKey)
    if (cached) return cached

    try {
        const data = await apiRequest<PriceResponse>('/price-day-ahead/latest', { zone })
        setCache(cacheKey, data, 15 * 60 * 1000) // 15 min cache (prices update less frequently)
        return data
    } catch (error) {
        console.error('Failed to fetch day-ahead price:', error)
        return null
    }
}

/**
 * Get 24-hour price forecast
 */
export async function getPriceForecast(zone: string = DEFAULT_ZONE): Promise<PriceResponse[] | null> {
    const cacheKey = `price-forecast-${zone}`
    const cached = getCached<PriceResponse[]>(cacheKey)
    if (cached) return cached

    try {
        const data = await apiRequest<HistoryResponse<PriceResponse>>('/price-day-ahead/forecast', {
            zone,
            horizonHours: '24'
        })
        setCache(cacheKey, data.history, 30 * 60 * 1000) // 30 min cache
        return data.history
    } catch (error) {
        console.error('Failed to fetch price forecast:', error)
        return null
    }
}

/**
 * Get current power breakdown (renewable %, fossil fuel %, etc.)
 */
export async function getPowerBreakdown(zone: string = DEFAULT_ZONE): Promise<PowerBreakdownResponse | null> {
    const cacheKey = `power-breakdown-${zone}`
    const cached = getCached<PowerBreakdownResponse>(cacheKey)
    if (cached) return cached

    try {
        const data = await apiRequest<PowerBreakdownResponse>('/power-breakdown/latest', { zone })
        setCache(cacheKey, data, 5 * 60 * 1000) // 5 min cache
        return data
    } catch (error) {
        console.error('Failed to fetch power breakdown:', error)
        return null
    }
}

/**
 * Calculate grid stress from power breakdown
 * High consumption + low renewable = high stress
 */
export function calculateGridStressFromPowerData(breakdown: PowerBreakdownResponse): GridStatus {
    const consumption = breakdown.powerConsumptionTotal
    const production = breakdown.powerProductionTotal
    const renewablePercent = breakdown.renewablePercentage

    // Stress factors:
    // 1. Demand exceeding supply
    // 2. Low renewable percentage (relying on fossil fuels)
    // 3. High imports

    let stressIndex = 0.2 // Base stress

    // If demand > supply, increase stress
    if (consumption > production) {
        const deficit = (consumption - production) / production
        stressIndex += Math.min(0.4, deficit * 2) // Up to +0.4 stress
    }

    // Low renewable = higher stress (grid is strained)
    if (renewablePercent < 30) {
        stressIndex += 0.2
    } else if (renewablePercent < 50) {
        stressIndex += 0.1
    }

    // High import dependency = stress
    const importRatio = breakdown.powerImportTotal / consumption
    if (importRatio > 0.3) {
        stressIndex += 0.15
    }

    stressIndex = Math.min(1, Math.max(0, stressIndex))

    let stress_level: 'normal' | 'elevated' | 'critical' = 'normal'
    if (stressIndex >= 0.7) {
        stress_level = 'critical'
    } else if (stressIndex >= 0.4) {
        stress_level = 'elevated'
    }

    return {
        stress_level,
        stress_index: Number(stressIndex.toFixed(2)),
        updated_at: breakdown.updatedAt
    }
}

/**
 * Convert Electricity Maps price to our format
 *
 * Electricity Maps returns EUR/MWh, we need INR/kWh
 * Conversion: 1 EUR ≈ 90 INR, 1 MWh = 1000 kWh
 * So EUR/MWh * 90 / 1000 = INR/kWh * 0.09
 */
const EUR_TO_INR = 90 // Approximate exchange rate
const MWH_TO_KWH = 1000

export function convertPriceToINRperKWh(priceEurPerMWh: number, currency: string): number {
    if (currency === 'INR') {
        // Already in INR/MWh, just convert to kWh
        return priceEurPerMWh / MWH_TO_KWH
    }

    if (currency === 'EUR') {
        return (priceEurPerMWh * EUR_TO_INR) / MWH_TO_KWH
    }

    // Default: assume EUR
    return (priceEurPerMWh * EUR_TO_INR) / MWH_TO_KWH
}

/**
 * Get real-time price data formatted for our V2G system
 * Falls back to mock data if API fails
 */
export async function getRealTimePriceData(zone: string = DEFAULT_ZONE): Promise<PriceData> {
    const now = new Date()
    const hour = now.getHours()

    try {
        // Try to get real data
        const [priceData, forecastData, carbonData] = await Promise.all([
            getDayAheadPrice(zone),
            getPriceForecast(zone),
            getCarbonIntensity(zone)
        ])

        if (priceData) {
            const priceInINR = convertPriceToINRperKWh(priceData.price, priceData.currency)

            // Build forecast array (24 hours)
            let forecast: number[] = []
            if (forecastData && forecastData.length > 0) {
                forecast = forecastData
                    .slice(0, 24)
                    .map(f => convertPriceToINRperKWh(f.price, f.currency))
            } else {
                // Generate synthetic forecast if not available
                forecast = generateSyntheticForecast(priceInINR, hour)
            }

            const avgForecast = forecast.length > 0
                ? forecast.reduce((a, b) => a + b, 0) / forecast.length
                : priceInINR

            return {
                current_price: Number(priceInINR.toFixed(2)),
                unit: 'INR/kWh',
                source: 'electricity-maps',
                timestamp: priceData.datetime,
                is_peak_hour: hour >= 18 && hour <= 22,
                forecast_24h: forecast.map(p => Number(p.toFixed(2))),
                average_forecast: Number(avgForecast.toFixed(2)),
                carbon_intensity: carbonData?.carbonIntensity,
                renewable_percentage: undefined // Would need power breakdown call
            }
        }
    } catch (error) {
        console.error('Electricity Maps API error, falling back to mock:', error)
    }

    // Fallback to synthetic data
    return generateMockPriceData(hour)
}

/**
 * Generate synthetic forecast based on TOU patterns
 */
function generateSyntheticForecast(currentPrice: number, currentHour: number): number[] {
    const forecast: number[] = []

    for (let i = 0; i < 24; i++) {
        const futureHour = (currentHour + i) % 24
        let multiplier = 1

        // Peak hours (6-10 PM): higher prices
        if (futureHour >= 18 && futureHour <= 22) {
            multiplier = 1.5 + Math.random() * 0.3
        }
        // Morning peak (6-9 AM)
        else if (futureHour >= 6 && futureHour <= 9) {
            multiplier = 1.2 + Math.random() * 0.2
        }
        // Night (11 PM - 5 AM): lower prices
        else if (futureHour >= 23 || futureHour <= 5) {
            multiplier = 0.5 + Math.random() * 0.2
        }
        // Shoulder hours
        else {
            multiplier = 0.8 + Math.random() * 0.3
        }

        forecast.push(currentPrice * multiplier)
    }

    return forecast
}

/**
 * Generate mock price data (fallback when API unavailable)
 */
function generateMockPriceData(hour: number): PriceData {
    let basePrice: number

    if (hour >= 18 && hour <= 22) {
        basePrice = 10 + Math.random() * 4  // Peak: ₹10-14/kWh
    } else if (hour >= 6 && hour <= 9) {
        basePrice = 7 + Math.random() * 2   // Morning: ₹7-9/kWh
    } else if (hour >= 23 || hour <= 5) {
        basePrice = 3 + Math.random() * 2   // Night: ₹3-5/kWh
    } else {
        basePrice = 5 + Math.random() * 3   // Off-peak: ₹5-8/kWh
    }

    const forecast = generateSyntheticForecast(basePrice, hour)
    const avgForecast = forecast.reduce((a, b) => a + b, 0) / forecast.length

    return {
        current_price: Number(basePrice.toFixed(2)),
        unit: 'INR/kWh',
        source: 'mock',
        timestamp: new Date().toISOString(),
        is_peak_hour: hour >= 18 && hour <= 22,
        forecast_24h: forecast.map(p => Number(p.toFixed(2))),
        average_forecast: Number(avgForecast.toFixed(2))
    }
}

/**
 * Get real-time grid status from Electricity Maps
 */
export async function getRealTimeGridStatus(zone: string = DEFAULT_ZONE): Promise<GridStatus> {
    try {
        const breakdown = await getPowerBreakdown(zone)
        if (breakdown) {
            return calculateGridStressFromPowerData(breakdown)
        }
    } catch (error) {
        console.error('Failed to get grid status from API:', error)
    }

    // Fallback to simulated status
    return {
        stress_level: 'normal',
        stress_index: 0.2,
        updated_at: new Date().toISOString()
    }
}

/**
 * Check if API is configured and available
 */
export function isElectricityMapsConfigured(): boolean {
    return !!API_KEY
}

/**
 * Get available zones (for configuration)
 */
export function getIndiaZones(): { code: string; name: string }[] {
    return [
        { code: 'IN-SO', name: 'Southern India (Telangana, AP, Karnataka, TN, Kerala)' },
        { code: 'IN-NO', name: 'Northern India (Delhi, UP, Punjab, Haryana, etc.)' },
        { code: 'IN-WE', name: 'Western India (Maharashtra, Gujarat, Goa, etc.)' },
        { code: 'IN-EA', name: 'Eastern India (West Bengal, Bihar, Odisha, etc.)' },
        { code: 'IN-NE', name: 'North Eastern India (Assam, Meghalaya, etc.)' }
    ]
}
