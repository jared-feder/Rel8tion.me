-- Device assignment slots for Rel8tionChips and Smart Signs

-- Keys / keychains: allow each agent to hold explicit slot positions.
ALTER TABLE public.keys
  ADD COLUMN IF NOT EXISTS device_role text DEFAULT 'keychain',
  ADD COLUMN IF NOT EXISTS assigned_slot smallint;

COMMENT ON COLUMN public.keys.device_role IS
'Physical role of the claimed key uid. Expected values include keychain, chip, service_chip.';
COMMENT ON COLUMN public.keys.assigned_slot IS
'Explicit slot number for this claimed key device within the agent inventory. For launch, keychains are intended to use slots 1 or 2.';

ALTER TABLE public.keys
  DROP CONSTRAINT IF EXISTS keys_assigned_slot_check;

ALTER TABLE public.keys
  ADD CONSTRAINT keys_assigned_slot_check
  CHECK (assigned_slot IS NULL OR assigned_slot IN (1, 2));

CREATE UNIQUE INDEX IF NOT EXISTS idx_keys_agent_keychain_slot_unique
  ON public.keys (agent_slug, assigned_slot)
  WHERE claimed = true
    AND agent_slug IS NOT NULL
    AND assigned_slot IS NOT NULL
    AND device_role IN ('keychain', 'chip');

-- Smart Signs: allow explicit ownership and slot positions per agent.
ALTER TABLE public.smart_signs
  ADD COLUMN IF NOT EXISTS assigned_agent_slug text,
  ADD COLUMN IF NOT EXISTS assigned_slot smallint,
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz;

COMMENT ON COLUMN public.smart_signs.assigned_agent_slug IS
'Agent slug currently assigned to this Smart Sign as its host owner/controller.';
COMMENT ON COLUMN public.smart_signs.assigned_slot IS
'Explicit Smart Sign slot number for the assigned host. For launch, agents are intended to use slots 1 or 2.';
COMMENT ON COLUMN public.smart_signs.assigned_at IS
'Timestamp when this Smart Sign was assigned to its current host agent.';

ALTER TABLE public.smart_signs
  DROP CONSTRAINT IF EXISTS smart_signs_assigned_slot_check;

ALTER TABLE public.smart_signs
  ADD CONSTRAINT smart_signs_assigned_slot_check
  CHECK (assigned_slot IS NULL OR assigned_slot IN (1, 2));

CREATE UNIQUE INDEX IF NOT EXISTS idx_smart_signs_assigned_agent_slot_unique
  ON public.smart_signs (assigned_agent_slug, assigned_slot)
  WHERE assigned_agent_slug IS NOT NULL
    AND assigned_slot IS NOT NULL;
