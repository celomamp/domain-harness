-- 0006_guidance_events_retention_idx: the retention-sweep hook (Story 6.7).
--
-- The scheduled sweep deletes Guidance event rows older than the Buyer's
-- retention setting (default 90 days) with `delete from guidance_events
-- where created_at < $1`. This index keeps that sweep an index scan.
-- (Story 4.5 deliberately left `created_at` as its only retention hook.)
create index if not exists guidance_events_created_at_idx
  on guidance_events (created_at);
