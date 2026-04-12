-- Extend user preferences for the hosted decision-engine architecture.
-- This keeps the legacy fields intact and adds the missing session-level knobs
-- needed by the backend when it calls the decision API.

ALTER TABLE public.user_preferences
    ADD COLUMN IF NOT EXISTS max_soc_percent INTEGER DEFAULT 90 CHECK (max_soc_percent >= 50 AND max_soc_percent <= 100),
    ADD COLUMN IF NOT EXISTS target_departure_soc_percent INTEGER DEFAULT 80 CHECK (target_departure_soc_percent >= 20 AND target_departure_soc_percent <= 100),
    ADD COLUMN IF NOT EXISTS preferred_departure_time TIME DEFAULT '08:00',
    ADD COLUMN IF NOT EXISTS max_charge_kw REAL DEFAULT 7.4 CHECK (max_charge_kw > 0 AND max_charge_kw <= 22),
    ADD COLUMN IF NOT EXISTS max_discharge_kw REAL DEFAULT 5.0 CHECK (max_discharge_kw >= 0 AND max_discharge_kw <= 22),
    ADD COLUMN IF NOT EXISTS control_interval_minutes INTEGER DEFAULT 15 CHECK (control_interval_minutes IN (5, 10, 15, 30, 60)),
    ADD COLUMN IF NOT EXISTS timezone_name TEXT DEFAULT 'Asia/Kolkata';

UPDATE public.user_preferences
SET
    max_soc_percent = COALESCE(max_soc_percent, 90),
    target_departure_soc_percent = COALESCE(target_departure_soc_percent, 80),
    preferred_departure_time = COALESCE(preferred_departure_time, '08:00'::TIME),
    max_charge_kw = COALESCE(max_charge_kw, 7.4),
    max_discharge_kw = COALESCE(max_discharge_kw, 5.0),
    control_interval_minutes = COALESCE(control_interval_minutes, 15),
    timezone_name = COALESCE(timezone_name, 'Asia/Kolkata');

CREATE OR REPLACE FUNCTION public.get_user_preferences(p_user_id UUID)
RETURNS TABLE (
    min_soc_percent INTEGER,
    max_soc_percent INTEGER,
    target_departure_soc_percent INTEGER,
    disable_discharge BOOLEAN,
    no_discharge_days TEXT[],
    quiet_hours_start TIME,
    quiet_hours_end TIME,
    preferred_departure_time TIME,
    max_charge_kw REAL,
    max_discharge_kw REAL,
    control_interval_minutes INTEGER,
    timezone_name TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        COALESCE(up.min_soc_percent, 20),
        COALESCE(up.max_soc_percent, 90),
        COALESCE(up.target_departure_soc_percent, 80),
        COALESCE(up.disable_discharge, FALSE),
        COALESCE(up.no_discharge_days, '{}'),
        up.quiet_hours_start,
        up.quiet_hours_end,
        COALESCE(up.preferred_departure_time, '08:00'::TIME),
        COALESCE(up.max_charge_kw, 7.4),
        COALESCE(up.max_discharge_kw, 5.0),
        COALESCE(up.control_interval_minutes, 15),
        COALESCE(up.timezone_name, 'Asia/Kolkata')
    FROM public.user_preferences up
    WHERE up.user_id = p_user_id;

    IF NOT FOUND THEN
        RETURN QUERY
        SELECT
            20,
            90,
            80,
            FALSE,
            '{}'::TEXT[],
            NULL::TIME,
            NULL::TIME,
            '08:00'::TIME,
            7.4::REAL,
            5.0::REAL,
            15,
            'Asia/Kolkata';
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
