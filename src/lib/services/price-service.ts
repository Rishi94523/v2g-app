/**
 * Price Service
 * Handles electricity price data from various sources
 */

import type { PriceData, OptimalWindow } from '@/types/v2g'

// Time-of-Use pricing patterns based on Indian grid (IEX-like)
const TOU_PATTERNS = {
    // Peak hours: 6-10 PM (high demand, high price)
    peak: { start: 18, end: 22, basePrice: 10, variance: 4 },
    // Morning peak: 6-9 AM
    morning: { start: 6, end: 9, basePrice: 7, variance: 2 },
    // Off-peak night: 11 PM - 5 AM (lowest prices)
    night: { start: 23, end: 5, basePrice: 3, variance: 1.5 },
    // Shoulder hours: rest of the day
    shoulder: { basePrice: 5.5, variance: 2.5 }
}

// Seasonal adjustments (India)
const SEASONAL_MULTIPLIERS: Record<number, number> = {
    // Summer (Apr-Jun): High AC demand = higher prices
    3: 1.15, 4: 1.25, 5: 1.3,
    // Monsoon (Jul-Sep): Moderate
    6: 1.1, 7: 1.05, 8: 1.05,
    // Post-monsoon (Oct-Nov): Lower demand
    9: 0.95, 10: 0.9,
    // Winter (Dec-Mar): Heating in North, moderate
    11: 1.0, 0: 1.0, 1: 0.95, 2: 0.95
}

/**
 * Get the base price for a given hour using TOU patterns
 */
function getBasePriceForHour(hour: number): { base: number; variance: number } {
    const { peak, morning, night, shoulder } = TOU_PATTERNS

    // Check peak hours
    if (hour >= peak.start && hour <= peak.end) {
        return { base: peak.basePrice, variance: peak.variance }
    }

    // Check morning peak
    if (hour >= morning.start && hour <= morning.end) {
        return { base: morning.basePrice, variance: morning.variance }
    }

    // Check night hours (spans midnight)
    if (hour >= night.start || hour <= night.end) {
        return { base: night.basePrice, variance: night.variance }
    }

    // Default to shoulder
    return { base: shoulder.basePrice, variance: shoulder.variance }
}

/**
 * Generate a realistic price with some randomness
 */
function generatePrice(hour: number, month: number): number {
    const { base, variance } = getBasePriceForHour(hour)
    const seasonalMultiplier = SEASONAL_MULTIPLIERS[month] || 1.0

    // Add controlled randomness (Gaussian-like)
    const noise = (Math.random() + Math.random() + Math.random()) / 3 - 0.5
    const price = (base + noise * variance) * seasonalMultiplier

    return Math.max(2, Math.min(18, price)) // Clamp between ₹2-18/kWh
}

/**
 * Check if current hour is a peak hour
 */
export function isPeakHour(hour?: number): boolean {
    const h = hour ?? new Date().getHours()
    return h >= 18 && h <= 22
}

/**
 * Get current electricity price (mock TOU-based)
 */
export function getCurrentPrice(): PriceData {
    const now = new Date()
    const hour = now.getHours()
    const month = now.getMonth()

    const currentPrice = generatePrice(hour, month)
    const forecast = get24HourForecast()
    const avgForecast = forecast.reduce((a, b) => a + b, 0) / forecast.length

    return {
        current_price: Number(currentPrice.toFixed(2)),
        unit: 'INR/kWh',
        source: 'mock',
        timestamp: now.toISOString(),
        is_peak_hour: isPeakHour(hour),
        forecast_24h: forecast,
        average_forecast: Number(avgForecast.toFixed(2))
    }
}

/**
 * Get 24-hour price forecast
 */
export function get24HourForecast(): number[] {
    const now = new Date()
    const currentHour = now.getHours()
    const month = now.getMonth()
    const forecast: number[] = []

    for (let i = 0; i < 24; i++) {
        const futureHour = (currentHour + i) % 24
        const price = generatePrice(futureHour, month)
        forecast.push(Number(price.toFixed(2)))
    }

    return forecast
}

/**
 * Find optimal buy/sell windows in the forecast
 */
export function findOptimalWindows(forecast: number[]): {
    bestBuy: OptimalWindow | null
    bestSell: OptimalWindow | null
    allWindows: OptimalWindow[]
} {
    const currentHour = new Date().getHours()
    const windows: OptimalWindow[] = []

    // Find price valleys (buy) and peaks (sell)
    const avgPrice = forecast.reduce((a, b) => a + b, 0) / forecast.length

    let inBuyWindow = false
    let inSellWindow = false
    let windowStart = 0
    let windowPrices: number[] = []

    for (let i = 0; i < forecast.length; i++) {
        const price = forecast[i]
        const hour = (currentHour + i) % 24

        // Buy window: price significantly below average
        if (price < avgPrice * 0.8 && !inBuyWindow) {
            inBuyWindow = true
            windowStart = hour
            windowPrices = [price]
        } else if (price < avgPrice * 0.8 && inBuyWindow) {
            windowPrices.push(price)
        } else if (price >= avgPrice * 0.8 && inBuyWindow) {
            inBuyWindow = false
            if (windowPrices.length >= 1) {
                windows.push({
                    start: `${windowStart.toString().padStart(2, '0')}:00`,
                    end: `${hour.toString().padStart(2, '0')}:00`,
                    avg_price: Number((windowPrices.reduce((a, b) => a + b) / windowPrices.length).toFixed(2)),
                    action: 'buy'
                })
            }
        }

        // Sell window: price significantly above average
        if (price > avgPrice * 1.2 && !inSellWindow) {
            inSellWindow = true
            windowStart = hour
            windowPrices = [price]
        } else if (price > avgPrice * 1.2 && inSellWindow) {
            windowPrices.push(price)
        } else if (price <= avgPrice * 1.2 && inSellWindow) {
            inSellWindow = false
            if (windowPrices.length >= 1) {
                windows.push({
                    start: `${windowStart.toString().padStart(2, '0')}:00`,
                    end: `${hour.toString().padStart(2, '0')}:00`,
                    avg_price: Number((windowPrices.reduce((a, b) => a + b) / windowPrices.length).toFixed(2)),
                    action: 'sell'
                })
            }
        }
    }

    // Find best windows
    const buyWindows = windows.filter(w => w.action === 'buy')
    const sellWindows = windows.filter(w => w.action === 'sell')

    const bestBuy = buyWindows.length > 0
        ? buyWindows.reduce((best, curr) => curr.avg_price < best.avg_price ? curr : best)
        : null

    const bestSell = sellWindows.length > 0
        ? sellWindows.reduce((best, curr) => curr.avg_price > best.avg_price ? curr : best)
        : null

    return { bestBuy, bestSell, allWindows: windows }
}

/**
 * Get price trend
 */
export function getPriceTrend(forecast: number[]): 'rising' | 'falling' | 'stable' {
    if (forecast.length < 3) return 'stable'

    const shortTerm = forecast.slice(0, 3).reduce((a, b) => a + b) / 3
    const midTerm = forecast.slice(3, 8).reduce((a, b) => a + b) / Math.min(5, forecast.length - 3)

    const diff = midTerm - shortTerm
    if (diff > 1) return 'rising'
    if (diff < -1) return 'falling'
    return 'stable'
}
