-- The latest view of each player's farm, uploaded a few seconds after it changes (not just at bedtime),
-- so visitors see crops planted today. Separate from the save: it never changes what "Continue" loads.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS live_farm jsonb;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS live_at timestamptz;
