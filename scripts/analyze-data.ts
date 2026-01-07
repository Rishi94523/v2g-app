/**
 * Quick script to analyze the datasets we have
 * Run with: npx tsx scripts/analyze-data.ts
 */

import * as XLSX from 'xlsx'
import * as fs from 'fs'
import * as path from 'path'

const DATA_DIR = path.join(process.cwd(), 'data')

async function analyzeIEXData() {
    console.log('\n📊 Analyzing IEX DAM Price Data...\n')

    const filePath = path.join(DATA_DIR, 'iex-prices', 'DAM.xlsx')

    if (!fs.existsSync(filePath)) {
        console.log('❌ DAM.xlsx not found')
        return
    }

    const workbook = XLSX.readFile(filePath)
    const sheetNames = workbook.SheetNames

    console.log('Sheet names:', sheetNames)

    // Analyze first sheet
    const firstSheet = workbook.Sheets[sheetNames[0]]
    const data = XLSX.utils.sheet_to_json(firstSheet, { header: 1 }) as unknown[][]

    console.log('Total rows:', data.length)
    console.log('Columns (header):', data[0])
    console.log('\nFirst 3 data rows:')
    for (let i = 1; i <= 3 && i < data.length; i++) {
        console.log(`  Row ${i}:`, data[i])
    }

    // Check date range if there's a date column
    const headers = data[0] as string[]
    const dateColIndex = headers.findIndex(h =>
        typeof h === 'string' && (h.toLowerCase().includes('date') || h.toLowerCase().includes('time'))
    )

    if (dateColIndex >= 0 && data.length > 2) {
        const dates = data.slice(1).map(row => row[dateColIndex]).filter(Boolean)
        console.log('\nDate range:', dates[0], 'to', dates[dates.length - 1])
    }

    // Check price column
    const priceColIndex = headers.findIndex(h =>
        typeof h === 'string' && (h.toLowerCase().includes('price') || h.toLowerCase().includes('mcp'))
    )

    if (priceColIndex >= 0 && data.length > 2) {
        const prices = data.slice(1).map(row => Number(row[priceColIndex])).filter(p => !isNaN(p))
        console.log('\nPrice statistics:')
        console.log('  Min:', Math.min(...prices).toFixed(2))
        console.log('  Max:', Math.max(...prices).toFixed(2))
        console.log('  Avg:', (prices.reduce((a, b) => a + b, 0) / prices.length).toFixed(2))
    }
}

async function analyzeGridLoadData() {
    console.log('\n⚡ Analyzing Telangana Grid Load Data...\n')

    const filePath = path.join(DATA_DIR, 'grid-load', 'telangana_godishala_load.xlsx')

    if (!fs.existsSync(filePath)) {
        console.log('❌ telangana_godishala_load.xlsx not found')
        return
    }

    const workbook = XLSX.readFile(filePath)
    const sheetNames = workbook.SheetNames

    console.log('Sheet names:', sheetNames.slice(0, 10), sheetNames.length > 10 ? `... (${sheetNames.length} total)` : '')

    // Analyze first sheet
    const firstSheet = workbook.Sheets[sheetNames[0]]
    const data = XLSX.utils.sheet_to_json(firstSheet, { header: 1 }) as unknown[][]

    console.log('Total rows in first sheet:', data.length)
    console.log('Columns (header):', data[0])
    console.log('\nFirst 5 data rows:')
    for (let i = 1; i <= 5 && i < data.length; i++) {
        console.log(`  Row ${i}:`, data[i])
    }

    // Try to find load/power columns
    const headers = (data[0] || []) as string[]
    const loadColumns = headers.filter(h =>
        typeof h === 'string' && (
            h.toLowerCase().includes('load') ||
            h.toLowerCase().includes('power') ||
            h.toLowerCase().includes('mw') ||
            h.toLowerCase().includes('kw')
        )
    )
    console.log('\nLoad-related columns:', loadColumns)

    // Check for time patterns
    const timeColumns = headers.filter(h =>
        typeof h === 'string' && (
            h.toLowerCase().includes('time') ||
            h.toLowerCase().includes('hour') ||
            h.toLowerCase().includes('date')
        )
    )
    console.log('Time-related columns:', timeColumns)
}

async function analyzeEVData() {
    console.log('\n🔋 Analyzing EV Charging Patterns Data...\n')

    const filePath = path.join(DATA_DIR, 'ev-patterns', 'ev_charging_patterns.csv')

    if (!fs.existsSync(filePath)) {
        console.log('❌ ev_charging_patterns.csv not found')
        return
    }

    const content = fs.readFileSync(filePath, 'utf-8')
    const lines = content.trim().split('\n')
    const headers = lines[0].split(',')

    console.log('Total records:', lines.length - 1)
    console.log('Columns:', headers.length)
    console.log('\nColumn names:')
    headers.forEach((h, i) => console.log(`  ${i + 1}. ${h}`))

    // Parse data to analyze key columns
    const data = lines.slice(1).map(line => {
        const values = line.split(',')
        return {
            socStart: parseFloat(values[headers.indexOf('State of Charge (Start %)')]),
            socEnd: parseFloat(values[headers.indexOf('State of Charge (End %)')]),
            batteryCapacity: parseFloat(values[headers.indexOf('Battery Capacity (kWh)')]),
            chargingRate: parseFloat(values[headers.indexOf('Charging Rate (kW)')]),
            temperature: parseFloat(values[headers.indexOf('Temperature (°C)')]),
            vehicleModel: values[headers.indexOf('Vehicle Model')],
            chargerType: values[headers.indexOf('Charger Type')]
        }
    })

    const validData = data.filter(d => !isNaN(d.socStart) && !isNaN(d.socEnd))

    console.log('\nSOC Statistics:')
    console.log('  Start SOC - Min:', Math.min(...validData.map(d => d.socStart)).toFixed(1) + '%')
    console.log('  Start SOC - Max:', Math.max(...validData.map(d => d.socStart)).toFixed(1) + '%')
    console.log('  Start SOC - Avg:', (validData.reduce((a, d) => a + d.socStart, 0) / validData.length).toFixed(1) + '%')
    console.log('  End SOC - Avg:', (validData.reduce((a, d) => a + d.socEnd, 0) / validData.length).toFixed(1) + '%')

    console.log('\nBattery Capacity Range:')
    console.log('  Min:', Math.min(...validData.map(d => d.batteryCapacity)).toFixed(1) + ' kWh')
    console.log('  Max:', Math.max(...validData.map(d => d.batteryCapacity)).toFixed(1) + ' kWh')

    console.log('\nTemperature Range:')
    console.log('  Min:', Math.min(...validData.map(d => d.temperature)).toFixed(1) + '°C')
    console.log('  Max:', Math.max(...validData.map(d => d.temperature)).toFixed(1) + '°C')

    // Count unique values
    const vehicleModels = [...new Set(validData.map(d => d.vehicleModel))]
    const chargerTypes = [...new Set(validData.map(d => d.chargerType))]

    console.log('\nVehicle Models:', vehicleModels.length, '-', vehicleModels.join(', '))
    console.log('Charger Types:', chargerTypes.join(', '))
}

async function main() {
    console.log('='.repeat(60))
    console.log('V2G Dataset Analysis')
    console.log('='.repeat(60))

    await analyzeIEXData()
    await analyzeGridLoadData()
    await analyzeEVData()

    console.log('\n' + '='.repeat(60))
    console.log('Analysis Complete!')
    console.log('='.repeat(60))
}

main().catch(console.error)
