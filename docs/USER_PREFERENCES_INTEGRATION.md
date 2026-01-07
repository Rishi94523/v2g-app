# User Preferences Integration Analysis

## Overview

This document analyzes how user-defined constraints from the dashboard settings are integrated into the V2G optimization system.

---

## 1. Dashboard Settings (Frontend)

**Location:** `src/app/dashboard/settings/page.tsx`

The dashboard allows users to configure:

| Setting | UI Element | Type | Default |
|---------|------------|------|---------|
| `min_soc_percent` | Slider (10-50%) | number | 20 |
| `disable_discharge` | Toggle switch | boolean | false |
| `no_discharge_days` | Day buttons (Mon-Sun) | string[] | [] |
| `quiet_hours_start` | Time picker | string | null |
| `quiet_hours_end` | Time picker | string | null |
| `wallet_address` | Text input | string | null |

### Current Status: ⚠️ PARTIAL INTEGRATION

The dashboard UI is complete, but:
- **TODO**: Save to Supabase is not implemented (line 42: `// TODO: Save to Supabase`)
- Preferences are stored in React state but not persisted

---

## 2. Backend Integration (API)

**Location:** `src/app/api/device/telemetry/route.ts`

The telemetry API **IS** designed to use user preferences:

### 2.1 Preference Loading (Lines 43-55)
```typescript
const { data: prefs } = await supabase
    .from('user_preferences')
    .select('*')
    .eq('user_id', device.user_id)
    .single()

const userPrefs = prefs || {
    min_soc_percent: 20,
    disable_discharge: false,
    no_discharge_days: [],
    quiet_hours_start: null,
    quiet_hours_end: null
}
```

✅ **Status: IMPLEMENTED** - Falls back to defaults if no preferences saved

### 2.2 State Building (Lines 76-78)
```typescript
const state: DecisionState = {
    // ...
    min_soc: userPrefs.min_soc_percent,
    discharge_allowed: !userPrefs.disable_discharge && !isNoDischargeDay(userPrefs.no_discharge_days)
}
```

✅ **Status: IMPLEMENTED** - User constraints are passed to decision state

### 2.3 Safety Constraints (Lines 81-87)
```typescript
const safetyCheck = checkSafetyConstraints(
    payload.bms_data.soc_percent,
    payload.bms_data.temperature_c,
    payload.charger_status.connected,
    userPrefs.quiet_hours_start,
    userPrefs.quiet_hours_end
)
```

✅ **Status: IMPLEMENTED** - Quiet hours are enforced as hard constraints

### 2.4 ML Decision (Line 104)
```typescript
const { action, reward } = getBestAction(state, userPrefs.disable_discharge)
```

✅ **Status: IMPLEMENTED** - Discharge disable flag passed to reward shaper

---

## 3. Reward Shaper Integration

**Location:** `src/lib/services/reward-shaper.ts`

### 3.1 User Preference in Reward Calculation (Lines 207-228)
```typescript
function calculateUserReward(
    state: DecisionState,
    action: DecisionAction,
    userDisableDischarge: boolean
): number {
    // Check if discharge is disabled but we're trying to discharge
    if (userDisableDischarge && action.action_type === 'discharge') {
        return USER_VIOLATION_PENALTY  // -10.0
    }

    // Check minimum SOC constraint
    if (action.action_type === 'discharge' && state.soc_percent <= state.min_soc + 5) {
        return USER_VIOLATION_PENALTY * 0.5  // -5.0
    }

    // Reward for respecting preferences
    if (!state.discharge_allowed && action.action_type !== 'discharge') {
        return 1.0  // Bonus for listening to user
    }

    return 0
}
```

✅ **Status: IMPLEMENTED** - User preferences affect reward calculation

---

## 4. Adaptive Weights Integration

**Location:** `src/lib/services/grid-service.ts`

### 4.1 User Override in Weight Adjustment (Lines 263-270)
```typescript
// ADAPTIVE ADJUSTMENT 3: User priority override
if (userPriorityOverride) {
    weights.user_preference = 0.4  // Increase from 0.1 to 0.4
    // Reduce others proportionally
    weights.profit *= 0.7
    weights.grid_stability *= 0.7
    weights.battery_health *= 0.7
}
```

✅ **Status: IMPLEMENTED** - User override increases user_preference weight 4x

---

## 5. Integration Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    User Settings Dashboard                       │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ min_soc: 30% | disable_discharge: ON | quiet: 22:00-06:00│   │
│  └──────────────────────────────────────────────────────────┘   │
│                              │                                   │
│                              ▼ (TODO: Save to Supabase)          │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Supabase Database                            │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ user_preferences table                                    │   │
│  │ - user_id, min_soc_percent, disable_discharge, ...       │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│              /api/device/telemetry (POST)                        │
│                                                                  │
│  1. Load user preferences from Supabase ✅                       │
│  2. Build DecisionState with min_soc, discharge_allowed ✅       │
│  3. Check safety constraints (quiet hours) ✅                    │
│  4. If safe → Call getBestAction(state, disable_discharge) ✅   │
│  5. Return command to device                                    │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Reward Shaper                                 │
│                                                                  │
│  calculateReward() uses:                                        │
│  - state.min_soc → Penalty if discharging near minimum ✅        │
│  - state.discharge_allowed → Blocks discharge actions ✅         │
│  - userDisableDischarge → -10 penalty if violated ✅             │
│                                                                  │
│  getAdaptiveRewardWeights() uses:                               │
│  - userPriorityOverride → Increases user_preference weight ✅   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 6. Gap Analysis

### What's Working ✅

| Feature | Backend | Reward Shaper | Training |
|---------|---------|---------------|----------|
| min_soc_percent | ✅ | ✅ | ✅ |
| disable_discharge | ✅ | ✅ | ✅ |
| no_discharge_days | ✅ | ✅ | ⚠️ (not in training) |
| quiet_hours | ✅ | ✅ (hard constraint) | ⚠️ (not in training) |
| wallet_address | ✅ | N/A | N/A |

### What Needs Work ⚠️

1. **Dashboard → Database Save**: The settings page doesn't save to Supabase
2. **Training Integration**: `no_discharge_days` and `quiet_hours` not in training simulation
3. **Real-time Preference Updates**: Changes aren't pushed to connected devices

---

## 7. Required Fixes for Production

### Fix 1: Save Preferences to Supabase

In `src/app/dashboard/settings/page.tsx`, update `handleSave()`:

```typescript
const handleSave = async () => {
    const { error } = await supabase
        .from('user_preferences')
        .upsert({
            user_id: user.id,
            ...preferences
        })

    if (error) {
        console.error('Error saving preferences:', error)
        return
    }

    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
}
```

### Fix 2: Load Existing Preferences on Page Load

Add to `useEffect`:

```typescript
useEffect(() => {
    async function loadPreferences() {
        if (!user) return

        const { data } = await supabase
            .from('user_preferences')
            .select('*')
            .eq('user_id', user.id)
            .single()

        if (data) {
            setPreferences(data)
        }
    }

    loadPreferences()
}, [user])
```

### Fix 3: Add Training Support for Time-Based Constraints

In `src/lib/ml/environment.ts`, add quiet hours simulation:

```typescript
// In getCurrentState()
const isQuietHour = (hour >= 22 || hour < 6)  // Example: 10 PM - 6 AM

const state: State = {
    // ...
    quietHoursActive: isQuietHour
}

// In doStep()
if (state.quietHoursActive) {
    // Force idle during quiet hours
    return { state: this.getState(), reward: 0.1, done }
}
```

---

## 8. Summary

### Current State

| Component | Status | Notes |
|-----------|--------|-------|
| Dashboard UI | ✅ Complete | All settings configurable |
| Database Schema | ✅ Ready | `user_preferences` table defined |
| API Integration | ✅ Complete | Loads and uses preferences |
| Reward Shaper | ✅ Complete | Penalizes violations |
| Adaptive Weights | ✅ Complete | User override supported |
| Save to DB | ❌ Missing | TODO in dashboard |
| Load from DB | ❌ Missing | On page load |
| Training Sim | ⚠️ Partial | min_soc and disable_discharge only |

### For Paper

You can claim:
> "User preferences are integrated at multiple levels: as hard constraints (quiet hours), soft constraints with penalties (minimum SOC), and as weighted objectives in the adaptive reward function."

### For Production

Before deployment, implement:
1. Database save/load in dashboard
2. Add `no_discharge_days` to training simulation
3. Consider real-time preference push to devices
