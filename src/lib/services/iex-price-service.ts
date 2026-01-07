/**
 * IEX Price Service
 *
 * Loads and queries real electricity prices from the IEX DAM dataset
 * Dataset: 233,760 rows of 15-minute interval prices from 2018-2024
 *
 * Price column: MCP (Rs/MWh) - Market Clearing Price
 * Conversion: Rs/MWh ÷ 1000 = Rs/kWh
 */

import * as XLSX from 'xlsx'
import * as fs from 'fs'
import * as path from 'path'
import type { PriceData } from '@/types/v2g'

// Cache for loaded price data
interface PriceRecord {
    timestamp: Date
    hour: number
    minute: number
    dayOfWeek: number
    month: number
    mcpRsPerMWh: number
    mcpRsPerKWh: number
}

let priceData: PriceRecord[] = []
let pricesByHourMonth: Map<string, number[]> = new Map()
let isLoaded = false
let loadError: string | null = null

/**
 * Convert Excel serial date to JavaScript Date
 */
function excelDateToJS(serial: number): Date {
    return new Date((serial - 25569) * 86400 * 1000)
}

/**
 * Load the IEX DAM dataset
 * Call this once at startup or lazily on first request
 */
export async function loadIEXData(): Promise<boolean> {
    if (isLoaded) return true
    if (loadError) return false

    try {
        const dataPath = path.join(process.cwd(), 'data', 'iex-prices', 'DAM.xlsx')

        if (!fs.existsSync(dataPath)) {
            loadError = 'IEX DAM.xlsx file not found'
            console.error(`[IEX Service] ${loadError}`)
            return false
        }

        console.log('[IEX Service] Loading IEX DAM dataset...')
        const startTime = Date.now()

        const workbook = XLSX.readFile(dataPath)
        const sheet = workbook.Sheets[workbook.SheetNames[0]]
        const rawData = XLSX.utils.sheet_to_json(sheet) as Record<string, unknown>[]

        console.log(`[IEX Service] Parsing ${rawData.length} price records...`)

        // Parse and index the data
        priceData = rawData.map(row => {
            const timestamp = excelDateToJS(row['TimeStamp'] as number)
            const mcpRsPerMWh = row['MCP (Rs/MWh) *'] as number

            return {
                timestamp,
                hour: timestamp.getHours(),
                minute: timestamp.getMinutes(),
                dayOfWeek: timestamp.getDay(),
                month: timestamp.getMonth(),
                mcpRsPerMWh,
                mcpRsPerKWh: mcpRsPerMWh / 1000 // Convert to Rs/kWh
            }
        }).filter(r => !isNaN(r.mcpRsPerKWh))

        // Build lookup index by hour+month for fast queries
        pricesByHourMonth.clear()
        for (const record of priceData) {
            const key = `${record.hour}-${record.month}`
            if (!pricesByHourMonth.has(key)) {
                pricesByHourMonth.set(key, [])
            }
            pricesByHourMonth.get(key)!.push(record.mcpRsPerKWh)
        }

        isLoaded = true
        const loadTime = Date.now() - startTime
        console.log(`[IEX Service] Loaded ${priceData.length} records in ${loadTime}ms`)
        console.log(`[IEX Service] Price range: ₹${getMinPrice().toFixed(2)} - ₹${getMaxPrice().toFixed(2)}/kWh`)

        return true
    } catch (error) {
        loadError = `Failed to load IEX data: ${error}`
        console.error(`[IEX Service] ${loadError}`)
        return false
    }
}

/**
 * Get statistics
 */
export function getMinPrice(): number {
    if (priceData.length === 0) return 0
    return Math.min(...priceData.slice(0, 1000).map(r => r.mcpRsPerKWh))
}

export function getMaxPrice(): number {
    if (priceData.length === 0) return 0
    return Math.max(...priceData.slice(0, 1000).map(r => r.mcpRsPerKWh))
}

/**
 * Get current price based on time-of-day matching
 * Uses historical data for the same hour and month
 */
export function getCurrentPriceFromDataset(date: Date = new Date()): number {
    if (!isLoaded || priceData.length === 0) {
        // Fallback to synthetic
        return getSyntheticPrice(date.getHours())
    }

    const hour = date.getHours()
    const month = date.getMonth()
    const key = `${hour}-${month}`

    const prices = pricesByHourMonth.get(key)
    if (!prices || prices.length === 0) {
        return getSyntheticPrice(hour)
    }

    // Return median price for this hour/month combination
    const sorted = [...prices].sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)]

    // Add some variance (±10%) to simulate real-time fluctuation
    const variance = (Math.random() - 0.5) * 0.2 * median
    return Math.max(0.5, median + variance)
}

/**
 * Get 24-hour forecast from dataset
 */
export function get24HourForecastFromDataset(startDate: Date = new Date()): number[] {
    const forecast: number[] = []
    const month = startDate.getMonth()

    for (let i = 0; i < 24; i++) {
        const futureHour = (startDate.getHours() + i) % 24
        const key = `${futureHour}-${month}`

        const prices = pricesByHourMonth.get(key)
        if (prices && prices.length > 0) {
            // Use median with slight randomness
            const sorted = [...prices].sort((a, b) => a - b)
            const median = sorted[Math.floor(sorted.length / 2)]
            const variance = (Math.random() - 0.5) * 0.15 * median
            forecast.push(Math.max(0.5, median + variance))
        } else {
            forecast.push(getSyntheticPrice(futureHour))
        }
    }

    return forecast
}

/**
 * Get price statistics for a specific hour
 */
export function getPriceStatsForHour(hour: number, month?: number): {
    min: number
    max: number
    median: number
    avg: number
    count: number
} {
    const targetMonth = month ?? new Date().getMonth()
    const key = `${hour}-${targetMonth}`
    const prices = pricesByHourMonth.get(key) || []

    if (prices.length === 0) {
        return { min: 0, max: 0, median: 0, avg: 0, count: 0 }
    }

    const sorted = [...prices].sort((a, b) => a - b)
    const sum = prices.reduce((a, b) => a + b, 0)

    return {
        min: sorted[0],
        max: sorted[sorted.length - 1],
        median: sorted[Math.floor(sorted.length / 2)],
        avg: sum / prices.length,
        count: prices.length
    }
}

/**
 * Synthetic price fallback (TOU-based)
 */
function getSyntheticPrice(hour: number): number {
    if (hour >= 18 && hour <= 22) {
        return 10 + Math.random() * 4  // Peak: ₹10-14/kWh
    } else if (hour >= 6 && hour <= 9) {
        return 7 + Math.random() * 2   // Morning: ₹7-9/kWh
    } else if (hour >= 23 || hour <= 5) {
        return 3 + Math.random() * 2   // Night: ₹3-5/kWh
    } else {
        return 5 + Math.random() * 3   // Off-peak: ₹5-8/kWh
    }
}

/**
 * Check if dataset is loaded
 */
export function isDatasetLoaded(): boolean {
    return isLoaded
}

/**
 * Get dataset info
 */
export function getDatasetInfo(): {
    loaded: boolean
    recordCount: number
    dateRange: { start: string; end: string } | null
    error: string | null
} {
    if (!isLoaded) {
        return {
            loaded: false,
            recordCount: 0,
            dateRange: null,
            error: loadError
        }
    }

    return {
        loaded: true,
        recordCount: priceData.length,
        dateRange: {
            start: priceData[0]?.timestamp.toISOString().split('T')[0] || '',
            end: priceData[priceData.length - 1]?.timestamp.toISOString().split('T')[0] || ''
        },
        error: null
    }
}

/**
 * Get complete PriceData object using IEX dataset
 */
export async function getIEXPriceData(): Promise<PriceData> {
    // Ensure data is loaded
    if (!isLoaded) {
        await loadIEXData()
    }

    const now = new Date()
    const hour = now.getHours()

    const currentPrice = getCurrentPriceFromDataset(now)
    const forecast = get24HourForecastFromDataset(now)
    const avgForecast = forecast.reduce((a, b) => a + b, 0) / forecast.length

    return {
        current_price: Number(currentPrice.toFixed(2)),
        unit: 'INR/kWh',
        source: isLoaded ? 'dataset' : 'mock',
        timestamp: now.toISOString(),
        is_peak_hour: hour >= 18 && hour <= 22,
        forecast_24h: forecast.map(p => Number(p.toFixed(2))),
        average_forecast: Number(avgForecast.toFixed(2))
    }
}

/**
 * Get price for a specific historical timestamp
 * Useful for simulation/training
 */
export function getHistoricalPrice(timestamp: Date): number | null {
    if (!isLoaded) return null

    // Find closest record
    const targetTime = timestamp.getTime()

    // Binary search for efficiency
    let left = 0
    let right = priceData.length - 1

    while (left < right) {
        const mid = Math.floor((left + right) / 2)
        if (priceData[mid].timestamp.getTime() < targetTime) {
            left = mid + 1
        } else {
            right = mid
        }
    }

    if (left < priceData.length) {
        return priceData[left].mcpRsPerKWh
    }

    return null
}

/**
 * Get all prices for a date range (for training)
 */
export function getPricesInRange(startDate: Date, endDate: Date): PriceRecord[] {
    if (!isLoaded) return []

    const startTime = startDate.getTime()
    const endTime = endDate.getTime()

    return priceData.filter(r => {
        const t = r.timestamp.getTime()
        return t >= startTime && t <= endTime
    })
}
