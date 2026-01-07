/**
 * Test script for Electricity Maps API integration
 * Run with: npx tsx scripts/test-electricity-maps.ts
 */

// Load environment variables FIRST before any other imports
import * as dotenv from 'dotenv'
import * as path from 'path'

// Load .env.local first, then .env as fallback
const envLocalResult = dotenv.config({ path: path.join(process.cwd(), '.env.local') })
const envResult = dotenv.config({ path: path.join(process.cwd(), '.env') })

console.log('Environment loaded:')
console.log('  .env.local:', envLocalResult.error ? 'NOT FOUND' : 'LOADED')
console.log('  .env:', envResult.error ? 'NOT FOUND' : 'LOADED')
console.log('  ELECTRICITY_MAPS_API_KEY:', process.env.ELECTRICITY_MAPS_API_KEY ? 'SET' : 'NOT SET')
console.log('  ELECTRICITY_MAPS_ZONE:', process.env.ELECTRICITY_MAPS_ZONE || 'NOT SET')

// Now define the service functions inline since we need env to be loaded first
const API_BASE_URL = 'https://api.electricitymap.org/v3'
const API_KEY = process.env.ELECTRICITY_MAPS_API_KEY || process.env.ELECTRICITY_MAPS_API
const DEFAULT_ZONE = process.env.ELECTRICITY_MAPS_ZONE || 'IN-SO'

interface CarbonIntensityResponse {
    zone: string
    carbonIntensity: number
    datetime: string
    updatedAt: string
    isEstimated: boolean
}

interface PriceResponse {
    zone: string
    price: number
    currency: string
    datetime: string
    updatedAt: string
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
    powerProductionBreakdown: Record<string, number>
}

async function apiRequest<T>(endpoint: string, params: Record<string, string> = {}): Promise<T> {
    if (!API_KEY) {
        throw new Error('ELECTRICITY_MAPS_API_KEY is not configured')
    }

    const url = new URL(`${API_BASE_URL}${endpoint}`)
    Object.entries(params).forEach(([key, value]) => {
        if (value) url.searchParams.append(key, value)
    })

    console.log(`  Calling: ${url.toString()}`)

    const response = await fetch(url.toString(), {
        headers: {
            'auth-token': API_KEY,
        },
    })

    if (!response.ok) {
        const text = await response.text()
        throw new Error(`API error ${response.status}: ${text}`)
    }

    return response.json() as Promise<T>
}

function convertPriceToINRperKWh(pricePerMWh: number, currency: string): number {
    const EUR_TO_INR = 90
    const MWH_TO_KWH = 1000

    if (currency === 'INR') {
        return pricePerMWh / MWH_TO_KWH
    }
    if (currency === 'EUR') {
        return (pricePerMWh * EUR_TO_INR) / MWH_TO_KWH
    }
    return (pricePerMWh * EUR_TO_INR) / MWH_TO_KWH
}

async function testAPI() {
    console.log('\n' + '='.repeat(60))
    console.log('ELECTRICITY MAPS API INTEGRATION TEST')
    console.log('='.repeat(60))

    console.log('\n--- Configuration ---')
    console.log('API Key:', API_KEY ? `${API_KEY.slice(0, 8)}...` : 'NOT SET')
    console.log('Zone:', DEFAULT_ZONE)

    if (!API_KEY) {
        console.log('\n❌ API Key not configured. Cannot proceed with tests.')
        return
    }

    const testZone = DEFAULT_ZONE

    // Test 1: Carbon Intensity
    console.log('\n--- Test 1: Carbon Intensity ---')
    try {
        const carbon = await apiRequest<CarbonIntensityResponse>('/carbon-intensity/latest', { zone: testZone })
        console.log('  ✅ Success!')
        console.log(`  Zone: ${carbon.zone}`)
        console.log(`  Carbon Intensity: ${carbon.carbonIntensity} gCO2eq/kWh`)
        console.log(`  Updated: ${carbon.updatedAt}`)
        console.log(`  Estimated: ${carbon.isEstimated}`)
    } catch (error) {
        console.log(`  ❌ Error: ${error}`)
    }

    // Test 2: Day-Ahead Price
    console.log('\n--- Test 2: Day-Ahead Price ---')
    try {
        const price = await apiRequest<PriceResponse>('/price-day-ahead/latest', { zone: testZone })
        console.log('  ✅ Success!')
        console.log(`  Zone: ${price.zone}`)
        console.log(`  Price: ${price.price} ${price.currency}/MWh`)
        console.log(`  Price in INR/kWh: ₹${convertPriceToINRperKWh(price.price, price.currency).toFixed(2)}`)
        console.log(`  Datetime: ${price.datetime}`)
    } catch (error) {
        console.log(`  ❌ Error: ${error}`)
        console.log('  Note: Price data may not be available for all zones')
    }

    // Test 3: Power Breakdown
    console.log('\n--- Test 3: Power Breakdown ---')
    try {
        const power = await apiRequest<PowerBreakdownResponse>('/power-breakdown/latest', { zone: testZone })
        console.log('  ✅ Success!')
        console.log(`  Zone: ${power.zone}`)
        console.log(`  Total Consumption: ${power.powerConsumptionTotal?.toFixed(0) || 'N/A'} MW`)
        console.log(`  Total Production: ${power.powerProductionTotal?.toFixed(0) || 'N/A'} MW`)
        console.log(`  Renewable %: ${power.renewablePercentage?.toFixed(1) || 'N/A'}%`)
        console.log(`  Fossil-Free %: ${power.fossilFreePercentage?.toFixed(1) || 'N/A'}%`)

        if (power.powerProductionBreakdown) {
            console.log('\n  Power Sources:')
            Object.entries(power.powerProductionBreakdown)
                .filter(([, value]) => (value as number) > 0)
                .sort(([, a], [, b]) => (b as number) - (a as number))
                .slice(0, 6)
                .forEach(([source, value]) => {
                    const pct = ((value as number) / power.powerProductionTotal * 100).toFixed(1)
                    console.log(`    - ${source}: ${(value as number).toFixed(0)} MW (${pct}%)`)
                })
        }
    } catch (error) {
        console.log(`  ❌ Error: ${error}`)
    }

    // Scaling verification
    console.log('\n--- Scaling Verification ---')
    console.log('For V2G simulation, prices should be in range ₹3-15/kWh')
    console.log('Carbon intensity typically: 100-800 gCO2eq/kWh')
    console.log('Renewable percentage: 0-100%')

    console.log('\n' + '='.repeat(60))
    console.log('TEST COMPLETE')
    console.log('='.repeat(60))
}

testAPI().catch(console.error)
