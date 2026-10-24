-- Read-only. Counts and state metadata only: no email, credentials, transcript,
-- storage paths, fingerprints or recording content are returned.
select s.state,
  s.offline_import_fingerprint is not null as is_offline_archive,
  s.capture_ended_at is not null as capture_has_stopped,
  s.recording_id is not null as has_cloud_audio,
  count(*) as open_sessions,
  min(s.created_at) as oldest_created_at,
  max(s.updated_at) as latest_updated_at
from public.lantern_sessions s
where s.ended_at is null
group by s.state,(s.offline_import_fingerprint is not null),
  (s.capture_ended_at is not null),(s.recording_id is not null)
order by oldest_created_at;

-- Confirms whether migration 020 is installed. Its predicate must include
-- "offline_import_fingerprint IS NULL" while retaining ended_at IS NULL.
select indexdef from pg_indexes
where schemaname='public' and indexname='lantern_one_open_session_per_device';
