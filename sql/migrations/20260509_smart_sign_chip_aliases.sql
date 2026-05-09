-- Smart Sign NFC chip aliases
--
-- Supports an additional physical front/buyer NFC chip for the same sign
-- without overloading the printed QR inventory table. The canonical front
-- chip remains smart_signs.uid_primary and the rear agent chip remains
-- smart_signs.uid_secondary.

CREATE TABLE IF NOT EXISTS public.smart_sign_chip_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  smart_sign_id uuid NOT NULL REFERENCES public.smart_signs(id) ON DELETE CASCADE,
  uid text NOT NULL UNIQUE,
  device_type text NOT NULL DEFAULT 'front_buyer_chip',
  label text,
  active boolean NOT NULL DEFAULT true,
  created_by_agent_slug text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT smart_sign_chip_aliases_device_type_check
    CHECK (device_type IN ('front_buyer_chip'))
);

CREATE INDEX IF NOT EXISTS idx_smart_sign_chip_aliases_sign
  ON public.smart_sign_chip_aliases (smart_sign_id);

CREATE INDEX IF NOT EXISTS idx_smart_sign_chip_aliases_uid_active
  ON public.smart_sign_chip_aliases (uid)
  WHERE active = true;

COMMENT ON TABLE public.smart_sign_chip_aliases IS
'Optional NFC chip aliases for smart signs. Used for extra front/buyer chips only; rear dashboard access remains smart_signs.uid_secondary.';

COMMENT ON COLUMN public.smart_sign_chip_aliases.uid IS
'Additional physical NFC chip UID that should resolve to the same public smart sign route.';

COMMENT ON COLUMN public.smart_sign_chip_aliases.device_type IS
'Currently restricted to front_buyer_chip so alias scans can only open buyer check-in, not the agent dashboard.';

ALTER TABLE public.smart_sign_chip_aliases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS smart_sign_chip_aliases_select_active ON public.smart_sign_chip_aliases;
CREATE POLICY smart_sign_chip_aliases_select_active
  ON public.smart_sign_chip_aliases
  FOR SELECT
  TO anon, authenticated
  USING (active = true);

DROP POLICY IF EXISTS smart_sign_chip_aliases_insert_front_chip ON public.smart_sign_chip_aliases;
CREATE POLICY smart_sign_chip_aliases_insert_front_chip
  ON public.smart_sign_chip_aliases
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (device_type = 'front_buyer_chip' AND active = true);

DROP POLICY IF EXISTS smart_sign_chip_aliases_update_front_chip ON public.smart_sign_chip_aliases;
CREATE POLICY smart_sign_chip_aliases_update_front_chip
  ON public.smart_sign_chip_aliases
  FOR UPDATE
  TO anon, authenticated
  USING (device_type = 'front_buyer_chip')
  WITH CHECK (device_type = 'front_buyer_chip');

GRANT SELECT, INSERT, UPDATE ON public.smart_sign_chip_aliases TO anon, authenticated;
