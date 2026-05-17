-- Make call recording mandatory/default for all existing and future orgs.
-- Runs idempotently on staging + prod. Sets org master recording flag to TRUE
-- and flips per-route/per-DID/per-queue/per-user flags to 1 unless explicitly
-- set to 0 by an operator (we re-enable those too because the product decision
-- is "mandatory across the board").

-- 1. Org master switch inside the settings JSON blob.
UPDATE organizations
SET settings = JSON_SET(COALESCE(settings, JSON_OBJECT()), '$.recording_enabled', TRUE);

-- 2. Per-outbound-route flag.
UPDATE outbound_routes SET recording_enabled = 1;

-- 3. Per-DID flag.
UPDATE did_numbers SET recording_enabled = 1;

-- 4. Per-queue flag.
UPDATE queues SET recording_enabled = 1;

-- 5. Per-user flag.
UPDATE users SET recording_enabled = 1;
