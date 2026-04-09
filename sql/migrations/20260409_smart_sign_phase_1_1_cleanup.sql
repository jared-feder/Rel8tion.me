-- Smart Sign Phase 1.1 cleanup/hardening

-- 1) open_house_events property/open-house reference clarity and lifecycle fields
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'open_house_events' AND column_name = 'property_id'
  ) THEN
    -- Convert UUID/text ambiguity into explicit source reference text field.
    ALTER TABLE public.open_house_events
      ADD COLUMN IF NOT EXISTS open_house_source_id text;

    UPDATE public.open_house_events
    SET open_house_source_id = COALESCE(open_house_source_id, property_id::text)
    WHERE open_house_source_id IS NULL;

    ALTER TABLE public.open_house_events
      DROP COLUMN property_id;
  END IF;

  ALTER TABLE public.open_house_events
    ADD COLUMN IF NOT EXISTS resumed_from_event_id uuid REFERENCES public.open_house_events(id),
    ADD COLUMN IF NOT EXISTS ended_at timestamptz,
    ADD COLUMN IF NOT EXISTS last_activity_at timestamptz DEFAULT now(),
    ADD COLUMN IF NOT EXISTS activation_uid_primary text,
    ADD COLUMN IF NOT EXISTS activation_uid_secondary text,
    ADD COLUMN IF NOT EXISTS activation_method text,
    ADD COLUMN IF NOT EXISTS setup_confirmed_at timestamptz;
END $$;

COMMENT ON COLUMN public.open_house_events.open_house_source_id IS
'Canonical source identifier from open_houses.id (text). Replaces ambiguous property_id typing.';
COMMENT ON COLUMN public.open_house_events.activation_uid_primary IS
'Primary scanned UID used during Smart Sign activation.';
COMMENT ON COLUMN public.open_house_events.activation_uid_secondary IS
'Secondary scanned UID used during Smart Sign activation where dual-tap setup is used.';
COMMENT ON COLUMN public.open_house_events.activation_method IS
'Activation path used for event setup, e.g. smart_sign_double_scan_confirmed.';
COMMENT ON COLUMN public.open_house_events.setup_confirmed_at IS
'Timestamp when host explicitly confirmed setup.';

-- One active event per smart sign at a time.
CREATE UNIQUE INDEX IF NOT EXISTS idx_open_house_events_one_active_per_sign
  ON public.open_house_events (smart_sign_id)
  WHERE ended_at IS NULL;

-- 2) smart_signs activation trace + stronger UID uniqueness and device typing
ALTER TABLE public.smart_signs
  ADD COLUMN IF NOT EXISTS activation_uid_primary text,
  ADD COLUMN IF NOT EXISTS activation_uid_secondary text,
  ADD COLUMN IF NOT EXISTS activation_method text,
  ADD COLUMN IF NOT EXISTS setup_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS primary_device_type text,
  ADD COLUMN IF NOT EXISTS secondary_device_type text;

COMMENT ON COLUMN public.smart_signs.activation_uid_primary IS
'Canonical primary UID for this smart sign setup; used for auditability.';
COMMENT ON COLUMN public.smart_signs.activation_uid_secondary IS
'Canonical secondary UID for this smart sign setup; used for auditability.';
COMMENT ON COLUMN public.smart_signs.activation_method IS
'Setup method (manual_pairing, smart_sign_double_scan_confirmed, etc.).';
COMMENT ON COLUMN public.smart_signs.setup_confirmed_at IS
'When setup was confirmed by host agent.';
COMMENT ON COLUMN public.smart_signs.primary_device_type IS
'Device typing hint: chip, smart_sign, smart_sign_side_a, smart_sign_side_b.';
COMMENT ON COLUMN public.smart_signs.secondary_device_type IS
'Device typing hint: chip, smart_sign, smart_sign_side_a, smart_sign_side_b.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_smart_signs_activation_uid_primary_unique
  ON public.smart_signs (activation_uid_primary)
  WHERE activation_uid_primary IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_smart_signs_activation_uid_secondary_unique
  ON public.smart_signs (activation_uid_secondary)
  WHERE activation_uid_secondary IS NOT NULL;

-- Prevent same UID from being stored as primary on one row and secondary on another.
CREATE OR REPLACE FUNCTION public.enforce_smart_sign_uid_global_uniqueness()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.activation_uid_primary IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM public.smart_signs s
      WHERE s.id <> NEW.id
        AND (s.activation_uid_primary = NEW.activation_uid_primary
          OR s.activation_uid_secondary = NEW.activation_uid_primary)
    ) THEN
      RAISE EXCEPTION 'activation_uid_primary is already assigned to another smart sign';
    END IF;
  END IF;

  IF NEW.activation_uid_secondary IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM public.smart_signs s
      WHERE s.id <> NEW.id
        AND (s.activation_uid_primary = NEW.activation_uid_secondary
          OR s.activation_uid_secondary = NEW.activation_uid_secondary)
    ) THEN
      RAISE EXCEPTION 'activation_uid_secondary is already assigned to another smart sign';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_smart_sign_uid_global_uniqueness ON public.smart_signs;
CREATE TRIGGER trg_enforce_smart_sign_uid_global_uniqueness
BEFORE INSERT OR UPDATE ON public.smart_signs
FOR EACH ROW
EXECUTE FUNCTION public.enforce_smart_sign_uid_global_uniqueness();

-- 3) scan event device typing and canonical id/slug comments
ALTER TABLE public.smart_sign_scan_events
  ADD COLUMN IF NOT EXISTS device_type text;

COMMENT ON COLUMN public.smart_sign_scan_events.device_type IS
'Observed device type for scanned UID: chip, smart_sign, smart_sign_side_a, smart_sign_side_b.';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'smart_sign_scan_events' AND column_name = 'agent_id'
  ) THEN
    COMMENT ON COLUMN public.smart_sign_scan_events.agent_id IS
    'Canonical normalized reference. Prefer this over agent_slug.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'smart_sign_scan_events' AND column_name = 'agent_slug'
  ) THEN
    COMMENT ON COLUMN public.smart_sign_scan_events.agent_slug IS
    'Denormalized helper for URL routing/display only. Not canonical identity.';
  END IF;
END $$;

-- 4) event_checkins direct identity capture
ALTER TABLE public.event_checkins
  ADD COLUMN IF NOT EXISTS visitor_name text,
  ADD COLUMN IF NOT EXISTS visitor_phone text,
  ADD COLUMN IF NOT EXISTS visitor_email text,
  ADD COLUMN IF NOT EXISTS buyer_agent_name text,
  ADD COLUMN IF NOT EXISTS buyer_agent_phone text,
  ADD COLUMN IF NOT EXISTS buyer_agent_email text,
  ADD COLUMN IF NOT EXISTS pre_approved boolean,
  ADD COLUMN IF NOT EXISTS represented_buyer_confirmed boolean;

COMMENT ON COLUMN public.event_checkins.visitor_name IS
'Free-text identity capture for early-stage check-in before normalized buyer records exist.';
COMMENT ON COLUMN public.event_checkins.visitor_phone IS
'Direct phone capture from check-in flow.';
COMMENT ON COLUMN public.event_checkins.visitor_email IS
'Direct email capture from check-in flow.';
COMMENT ON COLUMN public.event_checkins.buyer_agent_name IS
'Agent identity entered at check-in where no normalized agent record yet exists.';
COMMENT ON COLUMN public.event_checkins.buyer_agent_phone IS
'Agent phone entered at check-in.';
COMMENT ON COLUMN public.event_checkins.buyer_agent_email IS
'Agent email entered at check-in.';

