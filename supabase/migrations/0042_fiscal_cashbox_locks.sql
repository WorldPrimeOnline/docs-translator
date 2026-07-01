-- Distributed lock table for per-cashbox Webkassa request serialization.
--
-- One row per cashbox. Workers atomically acquire a lock before sending any
-- request to that cashbox. Lock auto-expires after 10 minutes to handle
-- worker crashes (prevents permanent deadlock).
--
-- Acquire pattern (atomic):
--   INSERT ... ON CONFLICT (cashbox_id) DO UPDATE
--     SET worker_id = ..., acquired_at = NOW(), expires_at = NOW() + '10min'
--     WHERE fiscal_cashbox_locks.expires_at < NOW()
--   RETURNING cashbox_id;
--   -- rows > 0 → lock acquired; rows = 0 → another worker holds active lock
--
-- Release pattern:
--   DELETE FROM fiscal_cashbox_locks WHERE cashbox_id = $1 AND worker_id = $2;

CREATE TABLE IF NOT EXISTS fiscal_cashbox_locks (
  cashbox_id   TEXT        NOT NULL PRIMARY KEY,
  worker_id    TEXT        NOT NULL,
  acquired_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '10 minutes')
);

ALTER TABLE fiscal_cashbox_locks ENABLE ROW LEVEL SECURITY;

-- Only service role may read or write lock rows.
CREATE POLICY "service_role_only" ON fiscal_cashbox_locks
  USING ((SELECT auth.role()) = 'service_role')
  WITH CHECK ((SELECT auth.role()) = 'service_role');

COMMENT ON TABLE fiscal_cashbox_locks IS
  'Distributed per-cashbox lock for sequential Webkassa API request processing. '
  'Prevents concurrent requests to the same cashbox across Railway worker instances.';
