-- Additive: persists the before/after change set for a replan or manual override.
ALTER TABLE "ScheduleVersion"
  ADD COLUMN IF NOT EXISTS "changes" JSONB;
