import { NextRequest, NextResponse } from 'next/server'
import { registerDevice, supabaseAdmin } from '@/lib/supabase'

/**
 * POST /api/device
 * 
 * Register a new device for a user
 * 
 * Request body:
 * {
 *   "user_id": "uuid",
 *   "name": "My EV Charger",
 *   "wallet_address": "0x..." (optional)
 * }
 * 
 * Response:
 * {
 *   "device_id": "uuid",
 *   "device_token": "token for ESP32",
 *   "message": "Device registered successfully"
 * }
 */
export async function POST(request: NextRequest) {
    try {
        const body = await request.json()

        if (!body.user_id) {
            return NextResponse.json(
                { error: 'user_id is required' },
                { status: 400 }
            )
        }

        // Register device in database
        const result = await registerDevice(
            body.user_id,
            body.name || 'V2G Device',
            body.wallet_address
        )

        if (!result) {
            return NextResponse.json(
                { error: 'Failed to register device' },
                { status: 500 }
            )
        }

        console.log(`[Device] New device registered: ${body.name || 'V2G Device'} (${result.deviceId})`)

        return NextResponse.json({
            device_id: result.deviceId,
            device_token: result.deviceToken,
            message: 'Device registered successfully. Use this token in your ESP32 Authorization header.'
        }, { status: 201 })

    } catch (error) {
        console.error('Device registration error:', error)
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        )
    }
}

/**
 * GET /api/device
 * 
 * List all devices for a user
 */
export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('user_id')

    if (!userId) {
        return NextResponse.json(
            { error: 'user_id query parameter is required' },
            { status: 400 }
        )
    }

    try {
        const { data, error } = await supabaseAdmin
            .from('devices')
            .select('id, name, wallet_address, last_seen_at, created_at')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })

        if (error) {
            console.error('Error fetching devices:', error)
            return NextResponse.json(
                { error: 'Failed to fetch devices' },
                { status: 500 }
            )
        }

        return NextResponse.json({
            devices: data || [],
            count: data?.length || 0
        })
    } catch (error) {
        console.error('Device list error:', error)
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        )
    }
}

/**
 * DELETE /api/device
 * 
 * Delete a device
 */
export async function DELETE(request: NextRequest) {
    const { searchParams } = new URL(request.url)
    const deviceId = searchParams.get('device_id')
    const userId = searchParams.get('user_id')

    if (!deviceId || !userId) {
        return NextResponse.json(
            { error: 'device_id and user_id query parameters are required' },
            { status: 400 }
        )
    }

    try {
        const { error } = await supabaseAdmin
            .from('devices')
            .delete()
            .eq('id', deviceId)
            .eq('user_id', userId)

        if (error) {
            console.error('Error deleting device:', error)
            return NextResponse.json(
                { error: 'Failed to delete device' },
                { status: 500 }
            )
        }

        return NextResponse.json({
            message: 'Device deleted successfully'
        })
    } catch (error) {
        console.error('Device delete error:', error)
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        )
    }
}
