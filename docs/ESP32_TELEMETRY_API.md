# ESP32 Telemetry API

This document is only for the ESP32 control implementer.

The ESP32 should call the app backend endpoint:

- production base URL: `https://v2g-app-taupe.vercel.app`
- full production endpoint: `https://v2g-app-taupe.vercel.app/api/device/telemetry`
- method: `POST`
- content type: `application/json`

The ESP32 does **not** need to know anything about Supabase, user preferences,
or the hosted Python decision service.

## Call pattern

This is a **synchronous HTTP polling call**.

That means:

- the ESP32 sends telemetry
- the backend waits for the decision engine result
- the backend returns the command in the same HTTP response
- the ESP32 then applies that command locally

This is **not** an asynchronous queue or webhook flow.

Recommended device behavior:

- send one telemetry request
- wait for the HTTP response
- apply `command`
- sleep until `command.next_poll_seconds`
- poll again

Recommended timeout and retry behavior:

- HTTP timeout: `10-15 seconds`
- if the request fails:
  - keep the previous safe command or fall back to `idle`
  - retry after `60 seconds`

## What the ESP32 sends

```json
{
  "device_token": "v2g_xxxxxxxxxxxxxxxxxxxx",
  "timestamp": "2026-03-09T10:30:00Z",
  "battery_capacity_kwh": 75,
  "bms_data": {
    "soc_percent": 42,
    "voltage_v": 360,
    "current_a": 0,
    "temperature_c": 29.1
  },
  "charger_status": {
    "connected": true,
    "max_power_kw": 7.4,
    "charger_type": "ac_level2"
  }
}
```

## What the ESP32 gets back

```json
{
  "success": true,
  "command": {
    "action": "charge",
    "rate_kw": 7.4,
    "reason": "Departure recovery mode (urgency 1.08)",
    "valid_until": "2026-03-09T10:45:00.000Z",
    "next_poll_seconds": 900,
    "ml_confidence": 1
  },
  "grid_status": {
    "stress_level": "normal",
    "stress_index": 0.2,
    "updated_at": "2026-03-09T10:17:08.774Z"
  },
  "price_info": {
    "current": 5.47,
    "trend": "rising"
  }
}
```

## How the ESP32 should act on the response

- if `command.action == "idle"`
  - set requested charge/discharge power to `0`
- if `command.action == "charge"`
  - charge at `command.rate_kw`
- if `command.action == "discharge"`
  - discharge/export at `command.rate_kw`
- after `command.next_poll_seconds`
  - send telemetry again

The ESP32 can ignore:

- `grid_status`
- `price_info`
- `decision_engine`

Those fields are mainly for logging, dashboards, and backend debugging.

## Minimum required fields

The ESP32 must always send:

- `device_token`
- `timestamp`
- `bms_data.soc_percent`
- `bms_data.voltage_v`
- `bms_data.current_a`
- `bms_data.temperature_c`
- `charger_status.connected`
- `charger_status.max_power_kw`
- `charger_status.charger_type`

## Safety note

The ESP32 firmware should still keep local hard safety checks:

- stop operation on unsafe battery temperature
- stop discharging below the local minimum SOC limit
- stop any action if charger contactor or relay state is invalid

## Backend behavior summary

The backend now does the following before returning a command:

1. validates `device_token`
2. loads user preferences from Supabase
3. computes price and grid context
4. calls the hosted decision API
5. converts that decision into a simple device command
6. returns the command to the ESP32

So the ESP32 contract is intentionally simple:

- send telemetry in
- receive command out
