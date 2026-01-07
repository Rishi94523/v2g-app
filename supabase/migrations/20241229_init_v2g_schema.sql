-- V2G Database Schema
-- This creates all tables needed for the Vehicle-to-Grid system

-- =============================================
-- DEVICES TABLE
-- Stores ESP32 device registrations
-- =============================================
CREATE TABLE IF NOT EXISTS public.devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    device_token TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL DEFAULT 'V2G Device',
    wallet_address TEXT,
    last_seen_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for faster token lookups (used in every API call)
CREATE INDEX idx_devices_token ON public.devices(device_token);
CREATE INDEX idx_devices_user_id ON public.devices(user_id);

-- Enable RLS
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;

-- Users can only see their own devices
CREATE POLICY "Users can view own devices" ON public.devices
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own devices" ON public.devices
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own devices" ON public.devices
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own devices" ON public.devices
    FOR DELETE USING (auth.uid() = user_id);

-- =============================================
-- USER PREFERENCES TABLE
-- Stores user-specific V2G settings
-- =============================================
CREATE TABLE IF NOT EXISTS public.user_preferences (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    min_soc_percent INTEGER DEFAULT 20 CHECK (min_soc_percent >= 10 AND min_soc_percent <= 50),
    disable_discharge BOOLEAN DEFAULT FALSE,
    no_discharge_days TEXT[] DEFAULT '{}',
    quiet_hours_start TIME,
    quiet_hours_end TIME,
    wallet_address TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

-- Users can only access their own preferences
CREATE POLICY "Users can view own preferences" ON public.user_preferences
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own preferences" ON public.user_preferences
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own preferences" ON public.user_preferences
    FOR UPDATE USING (auth.uid() = user_id);

-- =============================================
-- DECISION LOGS TABLE
-- Records all charge/discharge decisions made
-- =============================================
CREATE TABLE IF NOT EXISTS public.decision_logs (
    id BIGSERIAL PRIMARY KEY,
    device_id UUID NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    soc_percent REAL NOT NULL,
    electricity_price REAL NOT NULL,
    decision TEXT NOT NULL CHECK (decision IN ('charge', 'discharge', 'idle')),
    rate_kw REAL NOT NULL DEFAULT 0,
    solar_available_kw REAL,
    reason TEXT
);

-- Indexes for analytics queries
CREATE INDEX idx_decision_logs_device ON public.decision_logs(device_id);
CREATE INDEX idx_decision_logs_timestamp ON public.decision_logs(timestamp DESC);

-- Enable RLS
ALTER TABLE public.decision_logs ENABLE ROW LEVEL SECURITY;

-- Users can view logs for their devices
CREATE POLICY "Users can view own decision logs" ON public.decision_logs
    FOR SELECT USING (
        device_id IN (
            SELECT id FROM public.devices WHERE user_id = auth.uid()
        )
    );

-- =============================================
-- CONTRIBUTIONS TABLE
-- Tracks energy contributions for token rewards
-- =============================================
CREATE TABLE IF NOT EXISTS public.contributions (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    device_id UUID NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
    energy_kwh REAL NOT NULL CHECK (energy_kwh > 0),
    was_peak_hour BOOLEAN DEFAULT FALSE,
    was_emergency BOOLEAN DEFAULT FALSE,
    base_tokens INTEGER NOT NULL DEFAULT 0,
    multiplier REAL NOT NULL DEFAULT 1.0,
    total_tokens INTEGER GENERATED ALWAYS AS (FLOOR(base_tokens * multiplier)::INTEGER) STORED,
    tx_hash TEXT,
    submitted_to_chain BOOLEAN DEFAULT FALSE,
    submitted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_contributions_user ON public.contributions(user_id);
CREATE INDEX idx_contributions_device ON public.contributions(device_id);
CREATE INDEX idx_contributions_pending ON public.contributions(submitted_to_chain) WHERE NOT submitted_to_chain;

-- Enable RLS
ALTER TABLE public.contributions ENABLE ROW LEVEL SECURITY;

-- Users can view their own contributions
CREATE POLICY "Users can view own contributions" ON public.contributions
    FOR SELECT USING (auth.uid() = user_id);

-- =============================================
-- PRICE CACHE TABLE
-- Caches electricity prices to reduce API calls
-- =============================================
CREATE TABLE IF NOT EXISTS public.price_cache (
    id SERIAL PRIMARY KEY,
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    price REAL NOT NULL,
    source TEXT DEFAULT 'mock',
    forecast_24h REAL[] DEFAULT '{}'
);

-- Keep only last 24 hours of prices
CREATE INDEX idx_price_cache_timestamp ON public.price_cache(timestamp DESC);

-- =============================================
-- HELPER FUNCTIONS
-- =============================================

-- Function to get user preferences with defaults
CREATE OR REPLACE FUNCTION public.get_user_preferences(p_user_id UUID)
RETURNS TABLE (
    min_soc_percent INTEGER,
    disable_discharge BOOLEAN,
    no_discharge_days TEXT[],
    quiet_hours_start TIME,
    quiet_hours_end TIME
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COALESCE(up.min_soc_percent, 20),
        COALESCE(up.disable_discharge, FALSE),
        COALESCE(up.no_discharge_days, '{}'),
        up.quiet_hours_start,
        up.quiet_hours_end
    FROM public.user_preferences up
    WHERE up.user_id = p_user_id;
    
    -- Return defaults if no preferences exist
    IF NOT FOUND THEN
        RETURN QUERY SELECT 20, FALSE, '{}'::TEXT[], NULL::TIME, NULL::TIME;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get user stats
CREATE OR REPLACE FUNCTION public.get_user_stats(p_user_id UUID)
RETURNS TABLE (
    total_contributions BIGINT,
    total_energy_kwh REAL,
    total_tokens BIGINT,
    pending_submissions BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COUNT(*)::BIGINT,
        COALESCE(SUM(c.energy_kwh), 0)::REAL,
        COALESCE(SUM(c.total_tokens), 0)::BIGINT,
        COUNT(*) FILTER (WHERE NOT c.submitted_to_chain)::BIGINT
    FROM public.contributions c
    WHERE c.user_id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================
-- TRIGGERS
-- =============================================

-- Auto-update updated_at on preferences
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_preferences_timestamp
    BEFORE UPDATE ON public.user_preferences
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- Auto-create preferences when user signs up
CREATE OR REPLACE FUNCTION create_default_preferences()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.user_preferences (user_id)
    VALUES (NEW.id)
    ON CONFLICT (user_id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trigger_create_default_preferences
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION create_default_preferences();
