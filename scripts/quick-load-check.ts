/**
 * Quick analysis of Telangana grid load data
 */
import * as XLSX from 'xlsx'

const filePath = 'data/grid-load/telangana_godishala_load.xlsx'
const workbook = XLSX.readFile(filePath)

console.log('Sheet names:', workbook.SheetNames)

const firstSheet = workbook.Sheets[workbook.SheetNames[0]]
const data = XLSX.utils.sheet_to_json(firstSheet, { header: 1 }) as unknown[][]

console.log('\nTotal rows:', data.length)
console.log('\nHeaders:', data[0])
console.log('\nSample rows:')
for (let i = 1; i <= 10 && i < data.length; i++) {
    console.log(`Row ${i}:`, JSON.stringify(data[i]))
}
