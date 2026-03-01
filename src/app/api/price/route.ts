import { NextResponse } from 'next/server'
import { findOptimalWindows, getPriceTrend, isPeakHour, getCurrentPrice } from '@/lib/services/price-service'
import { getGridStatus } from '@/lib/services/grid-service'
import {
    getRealTimeGridStatus,
    getRealTimePriceData,
    isElectricityMapsConfigured,
    getCarbonIntensity,
    getPowerBreakdown
} from '@/lib/services/electricity-maps-service'
import {
    getIEXPriceData,
    isDatasetLoaded,
    getDatasetInfo
} from '@/lib/services/iex-price-service'

/**
 * GET /api/price
 *
 * Get current electricity price, forecast, and recommendations
 *
 * Query params:
 * - source: 'auto' | 'iex' | 'mock' (default: 'auto')
 * - zone: India zone code for grid data (default: IN-SO for Southern India)
 *
 * Response includes:
 * - Current price from IEX DAM dataset
 * - 24-hour forecast based on historical patterns
 * - Best buy/sell windows
 * - Grid stress status (from Electricity Maps)
 * - Carbon intensity (from Electricity Maps)
 * - AI recommendation
 */
export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url)
        const sourceParam = searchParams.get('source')
        const configuredSource = process.env.PRICE_DATA_SOURCE || 'auto'
        const source = (sourceParam || configuredSource).toLowerCase()
        const zone = searchParams.get('zone') || process.env.ELECTRICITY_MAPS_ZONE || 'IN-SO'

        let priceData
        switch (source) {
            case 'mock':
                priceData = getCurrentPrice()
                break
            case 'electricity-maps':
            case 'emaps':
                priceData = await getRealTimePriceData(zone)
                break
            case 'dataset':
            case 'iex':
            case 'auto':
            default:
                priceData = await getIEXPriceData()
                break
        }

        // Get grid status and environmental data from Electricity Maps
        let gridStatus = getGridStatus()
        let carbonIntensity: number | undefined
        let renewablePercentage: number | undefined

        if (isElectricityMapsConfigured()) {
            try {
                const [realGridStatus, carbonData, powerData] = await Promise.all([
                    getRealTimeGridStatus(zone),
                    getCarbonIntensity(zone),
                    getPowerBreakdown(zone)
                ])

                gridStatus = realGridStatus
                carbonIntensity = carbonData?.carbonIntensity
                renewablePercentage = powerData?.renewablePercentage
            } catch (error) {
                console.warn('[Price API] Electricity Maps API error, using simulated grid status:', error)
            }
        }

        const forecast = priceData.forecast_24h
        const { bestBuy, bestSell, allWindows } = findOptimalWindows(forecast)
        const trend = getPriceTrend(forecast)
        const avgPrice = forecast.reduce((a, b) => a + b, 0) / forecast.length

        // Generate recommendation based on current conditions
        let recommendation: string

        if (gridStatus.stress_level === 'critical') {
            recommendation = 'Grid Emergency: Consider discharging to support the grid (bonus rewards active)'
        } else if (priceData.current_price > avgPrice * 1.2) {
            recommendation = 'Excellent time to sell (discharge) - price is 20%+ above average'
        } else if (priceData.current_price > avgPrice) {
            recommendation = 'Good time to sell - price is above average'
        } else if (priceData.current_price < avgPrice * 0.8) {
            recommendation = 'Excellent time to buy (charge) - price is 20%+ below average'
        } else if (priceData.current_price < avgPrice) {
            recommendation = 'Good time to buy - price is below average'
        } else {
            recommendation = 'Hold - price is average. Wait for better conditions.'
        }

        // Add carbon-based recommendation if available
        if (carbonIntensity !== undefined) {
            if (carbonIntensity < 200) {
                recommendation += ' | Low carbon grid - good time to charge!'
            } else if (carbonIntensity > 500) {
                recommendation += ' | High carbon intensity - consider discharging stored clean energy.'
            }
        }

        // Get dataset info
        const datasetInfo = getDatasetInfo()

        return NextResponse.json({
            // Price data
            current_price: priceData.current_price,
            unit: priceData.unit,
            source: priceData.source,
            timestamp: priceData.timestamp,
            is_peak_hour: isPeakHour(),
            zone: zone,

            // Forecast
            forecast_24h: forecast,
            average_forecast: Number(avgPrice.toFixed(2)),
            price_trend: trend,

            // Recommendations
            recommendation,

            // Optimal windows
            best_buy_time: bestBuy ? {
                hour: parseInt(bestBuy.start.split(':')[0]),
                price: bestBuy.avg_price,
                label: bestBuy.start
            } : null,

            best_sell_time: bestSell ? {
                hour: parseInt(bestSell.start.split(':')[0]),
                price: bestSell.avg_price,
                label: bestSell.start
            } : null,

            optimal_windows: allWindows,

            // Grid status
            grid_status: {
                stress_level: gridStatus.stress_level,
                stress_index: gridStatus.stress_index,
                grid_support_active: gridStatus.stress_level !== 'normal'
            },

            // Environmental data (from Electricity Maps)
            environmental: {
                carbon_intensity: carbonIntensity,
                carbon_unit: 'gCO2eq/kWh',
                renewable_percentage: renewablePercentage,
                is_green_grid: renewablePercentage !== undefined ? renewablePercentage > 50 : undefined
            },

            // API configuration info
            api_info: {
                electricity_maps_configured: isElectricityMapsConfigured(),
                iex_dataset_loaded: isDatasetLoaded(),
                iex_dataset_records: datasetInfo.recordCount,
                iex_date_range: datasetInfo.dateRange,
                requested_source: source,
                data_source: priceData.source
            }
        })

    } catch (error) {
        console.error('Price API error:', error)
        return NextResponse.json(
            { error: 'Internal server error', details: String(error) },
            { status: 500 }
        )
    }
}
