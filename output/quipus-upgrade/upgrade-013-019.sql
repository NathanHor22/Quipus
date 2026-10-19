-- Quipus upgrade 013-019. Apply once using Supabase SQL Editor as database owner.

-- Requires migrations 001-012. All seven changes commit or roll back together.

-- If any upgrade migration is already installed, apply only missing individual files instead.

begin;

set local lock_timeout = '10s';

set local statement_timeout = '120s';


-- 013_dedicated_processing_worker.sql
-- A single locked row makes the capacity boundary atomic across processes and
-- across the temporary inline/dedicated migration. Redis is never a job ledger.
create table public.quipus_processing_capacity (
  id boolean primary key default true check (id),
  global_limit integer not null default 2 check (global_limit between 1 and 16),
  per_user_limit integer not null default 1 check (per_user_limit between 1 and 4)
);
insert into public.quipus_processing_capacity(id) values(true);
alter table public.quipus_processing_capacity enable row level security;
revoke all on public.quipus_processing_capacity from public, anon, authenticated;
grant select, update on public.quipus_processing_capacity to service_role;

create or replace function public.claim_lantern_processing(
  p_user_id uuid default null, p_session_id uuid default null
) returns setof public.lantern_processing_jobs
language plpgsql security definer set search_path = public as $$
declare capacity public.quipus_processing_capacity;
begin
  select * into strict capacity from public.quipus_processing_capacity where id for update;
  if (select count(*) from public.lantern_processing_jobs
      where state='running' and lease_until > now()) >= capacity.global_limit then
    return;
  end if;
  return query with candidate as (
    select j.session_id from public.lantern_processing_jobs j
    where (p_user_id is null or j.user_id=p_user_id)
      and (p_session_id is null or j.session_id=p_session_id)
      and ((j.state='queued' and j.available_at<=now()) or
        (j.state='running' and j.lease_until<now()))
      and (select count(*) from public.lantern_processing_jobs active
        where active.user_id=j.user_id and active.state='running'
          and active.lease_until>now()) < capacity.per_user_limit
    order by j.available_at, j.session_id for update skip locked limit 1
  ) update public.lantern_processing_jobs j
    set state='running', attempts=j.attempts+1, lease_token=gen_random_uuid(),
      lease_until=now()+interval '6 minutes', updated_at=now()
    from candidate c where j.session_id=c.session_id returning j.*;
end $$;
revoke all on function public.claim_lantern_processing(uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_lantern_processing(uuid,uuid) to service_role;

-- Optional public research runs separately after the core report is ready.
create table public.quipus_meeting_enrichment_jobs (
  meeting_id uuid primary key references public.meetings(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  state text not null default 'queued' check (state in ('queued','running','ready','failed')),
  attempts integer not null default 0 check (attempts >= 0),
  lease_token uuid,
  lease_until timestamptz,
  available_at timestamptz not null default now(),
  last_error text,
  updated_at timestamptz not null default now()
);
create index quipus_enrichment_pending on public.quipus_meeting_enrichment_jobs(available_at)
  where state in ('queued','running');
alter table public.quipus_meeting_enrichment_jobs enable row level security;
revoke all on public.quipus_meeting_enrichment_jobs from public,anon,authenticated;
grant select,update on public.quipus_meeting_enrichment_jobs to service_role;

create function public.queue_quipus_meeting_enrichment()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status='ready' and (TG_OP='INSERT' or old.status is distinct from 'ready') then
    insert into public.quipus_meeting_enrichment_jobs(meeting_id,user_id)
      values(new.id,new.user_id) on conflict(meeting_id) do nothing;
  end if;
  return new;
end $$;
revoke all on function public.queue_quipus_meeting_enrichment() from public,anon,authenticated;
create trigger quipus_queue_meeting_enrichment after insert or update of status on public.meetings
  for each row execute function public.queue_quipus_meeting_enrichment();

create function public.claim_quipus_meeting_enrichment()
returns setof public.quipus_meeting_enrichment_jobs
language plpgsql security definer set search_path=public as $$
begin
  -- Share the short capacity lock, but keep optional work in its own small pool.
  perform id from public.quipus_processing_capacity where id for update;
  if (select count(*) from public.quipus_meeting_enrichment_jobs
      where state='running' and lease_until>now()) >= 2 then return; end if;
  return query with candidate as (
    select j.meeting_id from public.quipus_meeting_enrichment_jobs j
    join public.meetings m on m.id=j.meeting_id and m.user_id=j.user_id and m.status='ready'
    where ((j.state='queued' and j.available_at<=now()) or
      (j.state='running' and j.lease_until<now()))
      and not exists (select 1 from public.quipus_meeting_enrichment_jobs active
        where active.user_id=j.user_id and active.state='running' and active.lease_until>now())
    order by j.available_at, j.meeting_id for update of j skip locked limit 1
  ) update public.quipus_meeting_enrichment_jobs j set state='running',attempts=j.attempts+1,
    lease_token=gen_random_uuid(),lease_until=now()+interval '6 minutes',updated_at=now()
    from candidate c where j.meeting_id=c.meeting_id returning j.*;
end $$;
revoke all on function public.claim_quipus_meeting_enrichment() from public,anon,authenticated;
grant execute on function public.claim_quipus_meeting_enrichment() to service_role;

notify pgrst, 'reload schema';


-- 014_people_relationships.sql
alter table public.contacts add column if not exists research_checked_at timestamptz;
create unique index if not exists contacts_id_owner_key on public.contacts(id, user_id);
alter table public.commitments add column if not exists contact_id uuid;
alter table public.commitments drop constraint if exists commitments_contact_owner_fk;
alter table public.commitments add constraint commitments_contact_owner_fk
  foreign key (contact_id, user_id) references public.contacts(id, user_id) on delete cascade;

create table if not exists public.contact_research_candidates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  contact_id uuid not null,
  url text not null check (url ~ '^https://www\.linkedin\.com/in/[^/?#]+/?$'),
  title text not null check (length(title) between 1 and 300),
  snippet text not null check (length(snippet) <= 2000),
  status text not null default 'candidate' check (status in ('candidate','confirmed','rejected')),
  observed_at timestamptz not null default now(),
  confirmed_at timestamptz,
  unique(contact_id, url),
  foreign key (contact_id, user_id) references public.contacts(id, user_id) on delete cascade
);
create unique index if not exists contact_one_confirmed_linkedin on public.contact_research_candidates(contact_id) where status = 'confirmed';
alter table public.contact_research_candidates enable row level security;
create policy "read own contact research" on public.contact_research_candidates for select to authenticated using (user_id = auth.uid());
-- Decisions and provider results are written only through owner-checked server routes.
grant select on public.contact_research_candidates to authenticated;
grant all on public.contact_research_candidates to service_role;

create table if not exists public.contact_private_notes (
  contact_id uuid primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null default '' check (length(body) <= 4000),
  updated_at timestamptz not null default now(),
  foreign key (contact_id, user_id) references public.contacts(id, user_id) on delete cascade
);
alter table public.contact_private_notes enable row level security;
create policy "read own private notes" on public.contact_private_notes for select to authenticated using (user_id = auth.uid());
grant select on public.contact_private_notes to authenticated;
grant all on public.contact_private_notes to service_role;

create or replace function public.decide_contact_research(p_user_id uuid, p_contact_id uuid, p_candidate_id uuid, p_status text)
returns void language plpgsql security invoker set search_path = public as $$
begin
  if p_status not in ('confirmed','rejected') then raise exception 'Invalid decision'; end if;
  perform 1 from public.contacts where id=p_contact_id and user_id=p_user_id for update;
  if not found then raise exception 'Contact not found'; end if;
  perform 1 from public.contact_research_candidates where id=p_candidate_id and contact_id=p_contact_id and user_id=p_user_id;
  if not found then raise exception 'Candidate not found'; end if;
  if p_status='confirmed' then
    update public.contact_research_candidates set status='candidate', confirmed_at=null
      where contact_id=p_contact_id and user_id=p_user_id and status='confirmed';
  end if;
  update public.contact_research_candidates set status=p_status,
    confirmed_at=case when p_status='confirmed' then now() else null end
    where id=p_candidate_id and contact_id=p_contact_id and user_id=p_user_id;
end;
$$;
revoke all on function public.decide_contact_research(uuid,uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.decide_contact_research(uuid,uuid,uuid,text) to service_role;

create unique index if not exists meetings_id_owner_key on public.meetings(id, user_id);
create table if not exists public.meeting_speaker_identifications (
  meeting_id uuid not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  speaker_label text not null check (length(speaker_label) between 1 and 80),
  contact_id uuid,
  confirmed_at timestamptz not null default now(),
  primary key (meeting_id, speaker_label),
  foreign key (meeting_id,user_id) references public.meetings(id,user_id) on delete cascade,
  foreign key (contact_id,user_id) references public.contacts(id,user_id) on delete cascade
);
alter table public.meeting_speaker_identifications enable row level security;
create policy "read own speaker identities" on public.meeting_speaker_identifications for select to authenticated using (user_id = auth.uid());
grant select on public.meeting_speaker_identifications to authenticated;
grant all on public.meeting_speaker_identifications to service_role;

notify pgrst, 'reload schema';


-- 015_recording_security_retention.sql
-- Audio expires 90 days from ingestion. Transcripts/approved actions have a
-- separate lifecycle and are deliberately retained when audio is removed.
alter table public.recordings add column if not exists audio_deleted_at timestamptz;
alter table public.recordings add column if not exists audio_retention_at timestamptz;
update public.recordings set audio_retention_at=created_at where audio_retention_at is null;
alter table public.recordings alter column audio_retention_at set default now();
alter table public.recordings alter column audio_retention_at set not null;

-- Public API clients must not extend retention or forge completed deletion.
create or replace function public.protect_recording_retention() returns trigger
language plpgsql set search_path=public as $$
begin
  if current_user in ('anon','authenticated') then
    if tg_op='INSERT' then
      new.audio_retention_at := now();
      new.audio_deleted_at := null;
    else
      new.audio_retention_at := old.audio_retention_at;
      new.audio_deleted_at := old.audio_deleted_at;
    end if;
  end if;
  return new;
end $$;
create trigger protect_recording_retention before insert or update on public.recordings
  for each row execute function public.protect_recording_retention();
update storage.buckets set public = false where id = 'recordings';

create table if not exists public.recording_audio_deletions (
  recording_id uuid primary key references public.recordings(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  object_paths text[] not null,
  state text not null default 'pending' check (state in ('pending','working','complete')),
  attempts integer not null default 0,
  lease_token uuid,
  lease_until timestamptz,
  available_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.recording_audio_deletions enable row level security;
revoke all on public.recording_audio_deletions from public, anon, authenticated;
grant all on public.recording_audio_deletions to service_role;
create index if not exists recording_audio_deletions_pending_idx
  on public.recording_audio_deletions(available_at) where state <> 'complete';

create table if not exists public.security_audit_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  event_type text not null check (event_type in ('audio_deleted','recording_playback')),
  resource_id uuid,
  created_at timestamptz not null default now()
);
alter table public.security_audit_events enable row level security;
revoke all on public.security_audit_events from public, anon, authenticated;
grant all on public.security_audit_events to service_role;
create index if not exists security_audit_events_created_idx on public.security_audit_events(created_at);

create or replace function public.claim_recording_audio_deletions(p_limit integer default 20)
returns setof public.recording_audio_deletions language plpgsql security definer set search_path=public as $$
declare r record; paths text[]; extra_paths text[];
begin
  if p_limit < 1 or p_limit > 100 then raise exception 'Invalid batch size'; end if;
  for r in select x.id,x.user_id,x.storage_path,to_jsonb(x)->>'consolidated_storage_path' as consolidated_path from public.recordings x
    where x.audio_retention_at <= now()-interval '90 days' and x.audio_deleted_at is null
      and not exists(select 1 from public.lantern_sessions sess join public.lantern_processing_jobs j on j.session_id=sess.id
        where sess.recording_id=x.id and j.state='running' and j.lease_until>now())
      and not exists(select 1 from public.recording_audio_deletions d where d.recording_id=x.id
        and (d.state='complete' or (d.state='working' and d.lease_until>now()) or d.available_at>now()))
    order by x.audio_retention_at limit p_limit for update skip locked
  loop
    paths := case when r.storage_path is null then array[]::text[] else array[r.storage_path] end;
    if r.consolidated_path is not null then paths := paths || array[r.consolidated_path]; end if;
    -- Optional dual-microphone migration is later in the ordered migration set.
    if to_regclass('public.recording_audio_sources') is not null then
      execute 'select array_agg(storage_path) filter(where storage_path is not null) from public.recording_audio_sources where recording_id=$1 and user_id=$2'
        into extra_paths using r.id,r.user_id;
      paths := paths || coalesce(extra_paths,array[]::text[]);
    end if;
    if to_regclass('public.recording_audio_derivatives') is not null then
      execute 'select array_agg(storage_path) from public.recording_audio_derivatives where recording_id=$1 and user_id=$2'
        into extra_paths using r.id,r.user_id;
      paths := paths || coalesce(extra_paths,array[]::text[]);
    end if;
    insert into public.recording_audio_deletions(recording_id,user_id,object_paths)
      values(r.id,r.user_id,paths) on conflict(recording_id) do update set object_paths=excluded.object_paths
        where recording_audio_deletions.state<>'complete' and
          (recording_audio_deletions.state='pending' or recording_audio_deletions.lease_until<now());
  end loop;
  return query with candidates as (
    select d.recording_id from public.recording_audio_deletions d
    where d.state <> 'complete' and d.available_at<=now()
      and (d.state='pending' or d.lease_until<now())
    order by d.available_at for update skip locked limit p_limit
  ) update public.recording_audio_deletions d set state='working',attempts=d.attempts+1,
    lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes'
    from candidates c where d.recording_id=c.recording_id returning d.*;
end $$;

create or replace function public.finish_recording_audio_deletion(p_recording_id uuid,p_lease_token uuid)
returns boolean language plpgsql security definer set search_path=public as $$
declare d public.recording_audio_deletions; r public.recordings; extra_paths text[];
begin
  select * into d from public.recording_audio_deletions where recording_id=p_recording_id
    and lease_token=p_lease_token and state='working' and lease_until>now() for update;
  if not found then return false; end if;
  select * into r from public.recordings where id=d.recording_id and user_id=d.user_id for update;
  if not found then raise exception 'Recording owner changed'; end if;
  if (r.storage_path is not null and not r.storage_path=any(d.object_paths)) or
    (to_jsonb(r)->>'consolidated_storage_path' is not null and not (to_jsonb(r)->>'consolidated_storage_path')=any(d.object_paths)) then
    raise exception 'Audio deletion manifest changed'; end if;
  if to_regclass('public.recording_audio_sources') is not null then
    execute 'select array_agg(storage_path) from public.recording_audio_sources where recording_id=$1 and user_id=$2'
      into extra_paths using d.recording_id,d.user_id;
    if not coalesce(extra_paths,array[]::text[]) <@ d.object_paths then raise exception 'Audio deletion manifest changed'; end if;
  end if;
  if to_regclass('public.recording_audio_derivatives') is not null then
    execute 'select array_agg(storage_path) from public.recording_audio_derivatives where recording_id=$1 and user_id=$2'
      into extra_paths using d.recording_id,d.user_id;
    if not coalesce(extra_paths,array[]::text[]) <@ d.object_paths then raise exception 'Audio deletion manifest changed'; end if;
  end if;
  update public.recordings set storage_path=null,audio_deleted_at=now(),updated_at=now()
    where id=d.recording_id and user_id=d.user_id;
  if not found then raise exception 'Recording owner changed'; end if;
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='recordings' and column_name='consolidated_storage_path') then
    execute 'update public.recordings set consolidated_storage_path=null where id=$1 and user_id=$2' using d.recording_id,d.user_id;
  end if;
  if to_regclass('public.recording_audio_sources') is not null then
    execute 'delete from public.recording_audio_sources where recording_id=$1 and user_id=$2'
      using d.recording_id,d.user_id;
  end if;
  if to_regclass('public.recording_audio_derivatives') is not null then
    execute 'delete from public.recording_audio_derivatives where recording_id=$1 and user_id=$2'
      using d.recording_id,d.user_id;
  end if;
  delete from public.lantern_audio_uploads where session_id in (
    select id from public.lantern_sessions where recording_id=d.recording_id and user_id=d.user_id);
  insert into public.security_audit_events(user_id,event_type,resource_id)
    values(d.user_id,'audio_deleted',d.recording_id);
  update public.recording_audio_deletions set state='complete',lease_until=null,completed_at=now()
    where recording_id=d.recording_id;
  return true;
end $$;

create or replace function public.audit_recording_playback(p_recording_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null or not exists(select 1 from public.recordings
    where id=p_recording_id and user_id=auth.uid() and audio_deleted_at is null
      and audio_retention_at>now()-interval '90 days') then raise exception 'Recording not available'; end if;
  insert into public.security_audit_events(user_id,event_type,resource_id)
    values(auth.uid(),'recording_playback',p_recording_id);
end $$;

revoke all on function public.claim_recording_audio_deletions(integer) from public,anon,authenticated;
revoke all on function public.finish_recording_audio_deletion(uuid,uuid) from public,anon,authenticated;
revoke all on function public.audit_recording_playback(uuid) from public,anon;
grant execute on function public.claim_recording_audio_deletions(integer) to service_role;
grant execute on function public.finish_recording_audio_deletion(uuid,uuid) to service_role;
grant execute on function public.audit_recording_playback(uuid) to authenticated;
-- The legacy chunk transport creates the same integrity manifest as TUS.
-- Row attachment and manifest publication commit atomically under a session lock.
create or replace function public.attach_lantern_legacy_audio(
  p_session_id uuid,p_user_id uuid,p_device_id uuid,p_event_id uuid,p_recording_id uuid,
  p_storage_path text,p_bytes bigint,p_sha256 text,p_duration integer)
returns uuid language plpgsql security definer set search_path=public as $$
declare s public.lantern_sessions; u public.lantern_audio_uploads;
begin
  select * into s from public.lantern_sessions where id=p_session_id
    and user_id=p_user_id and device_id=p_device_id for update;
  if not found then raise exception 'Session not found'; end if;
  if s.recording_id is not null then
    if s.audio_event_id=p_event_id then return s.recording_id; end if;
    raise exception 'Different audio already attached';
  end if;
  if s.state<>'finalising' or p_bytes<=44 or p_bytes>268435456 or p_duration<1
    or p_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'Invalid audio archive'; end if;
  if p_storage_path !~ ('^' || p_user_id::text || '/[0-9]{4}/(0[1-9]|1[0-2])/' || p_recording_id::text || '[.]wav$') then
    raise exception 'Invalid audio owner path'; end if;
  select * into u from public.lantern_audio_uploads where session_id=s.id;
  if found and (u.event_id<>p_event_id or u.total_bytes<>p_bytes or u.sha256<>p_sha256) then
    raise exception 'Audio differs from original manifest'; end if;
  insert into public.recordings(id,user_id,device_id,storage_path,duration_seconds,status,provider_status)
    values(p_recording_id,p_user_id,p_device_id,p_storage_path,p_duration,'processing',
      jsonb_build_object('archive','device-sd-wav-v2','bytes',p_bytes,'sha256',p_sha256));
  insert into public.lantern_audio_uploads(session_id,event_id,storage_path,total_bytes,sha256)
    values(s.id,p_event_id,p_storage_path,p_bytes,p_sha256)
    on conflict(session_id) do update set storage_path=excluded.storage_path,upload_url=null,
      url_created_at=null,verified_at=null;
  update public.lantern_sessions set recording_id=p_recording_id,audio_event_id=p_event_id,
    audio_received_at=now(),upload_bytes=p_bytes,upload_total_bytes=p_bytes,
    processing_error=null,processing_stage='queued' where id=s.id;
  return p_recording_id;
end $$;
revoke all on function public.attach_lantern_legacy_audio(uuid,uuid,uuid,uuid,uuid,text,bigint,text,integer)
  from public,anon,authenticated;
grant execute on function public.attach_lantern_legacy_audio(uuid,uuid,uuid,uuid,uuid,text,bigint,text,integer) to service_role;

notify pgrst, 'reload schema';


-- 016_calendar_connection_and_preparation.sql
-- Per-user Google identity/health; encrypted_credentials format remains compatible.
alter table public.provider_connections
  add column if not exists account_email text,
  add column if not exists connection_generation uuid not null default gen_random_uuid(),
  add column if not exists checked_at timestamptz,
  add column if not exists connection_status text not null default 'connected'
    check (connection_status in ('connected', 'needs_reconnect'));

create table if not exists public.meeting_preparations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  requirements jsonb not null default '[]'::jsonb,
  venue_preferences jsonb,
  venue_results jsonb not null default '[]'::jsonb,
  researched_at timestamptz,
  updated_at timestamptz not null default now(),
  unique(user_id, meeting_id)
);
alter table public.meeting_preparations enable row level security;
create policy preparations_owner on public.meeting_preparations
  for all to authenticated using (user_id = auth.uid()
    and exists (select 1 from public.meetings m where m.id = meeting_id and m.user_id = auth.uid()))
  with check (user_id = auth.uid()
    and exists (select 1 from public.meetings m where m.id = meeting_id and m.user_id = auth.uid()));
grant select, insert, update, delete on public.meeting_preparations to authenticated;
grant all on public.meeting_preparations to service_role;

-- Server clients bypass RLS, so the owner must also match the referenced meeting.
alter table public.meeting_preparations
  add constraint meeting_preparations_meeting_owner_fk foreign key (meeting_id,user_id)
  references public.meetings(id,user_id) on delete cascade;

create or replace function public.toggle_meeting_preparation_requirement(
  p_user_id uuid,p_meeting_id uuid,p_requirement_id text,p_completed boolean,p_derived jsonb
) returns jsonb language plpgsql security invoker set search_path=public as $$
declare previous jsonb; merged jsonb;
begin
  if jsonb_typeof(p_derived) <> 'array' or jsonb_array_length(p_derived) > 12 then raise exception 'Invalid preparation'; end if;
  perform 1 from public.meetings where id=p_meeting_id and user_id=p_user_id;
  if not found then raise exception 'Meeting not found'; end if;
  if not exists(select 1 from jsonb_array_elements(p_derived) d where d->>'id'=p_requirement_id) then raise exception 'Requirement not found'; end if;
  insert into public.meeting_preparations(user_id,meeting_id) values(p_user_id,p_meeting_id) on conflict(user_id,meeting_id) do nothing;
  select requirements into previous from public.meeting_preparations where user_id=p_user_id and meeting_id=p_meeting_id for update;
  select coalesce(jsonb_agg(d || jsonb_build_object('completed',case when d->>'id'=p_requirement_id then p_completed
    else coalesce((select (s->'completed'='true'::jsonb) from jsonb_array_elements(previous) s where s->>'id'=d->>'id' limit 1),false) end)), '[]'::jsonb)
    into merged from jsonb_array_elements(p_derived) d;
  update public.meeting_preparations set requirements=merged,updated_at=now() where user_id=p_user_id and meeting_id=p_meeting_id;
  return merged;
end;
$$;
revoke all on function public.toggle_meeting_preparation_requirement(uuid,uuid,text,boolean,jsonb) from public,anon,authenticated;
grant execute on function public.toggle_meeting_preparation_requirement(uuid,uuid,text,boolean,jsonb) to service_role;


-- 017_multi_source_recordings.sql
alter table public.lantern_sessions add column if not exists expected_audio_sources text[] not null default array['onboard'];
alter table public.recordings add column if not exists consolidated_storage_path text;

create table public.recording_audio_sources (
  id uuid primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  session_id uuid not null references public.lantern_sessions(id) on delete cascade,
  recording_id uuid references public.recordings(id) on delete cascade,
  source_kind text not null check(source_kind = 'phone'),
  storage_path text not null,
  byte_length bigint not null check(byte_length >= 46 and byte_length <= 268435456),
  sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
  sample_rate integer not null default 16000 check(sample_rate=16000),
  channels integer not null default 1 check(channels=1),
  timing_manifest jsonb not null,
  upload_url text,
  committed_at timestamptz,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  unique(session_id,source_kind),
  check(storage_path = user_id::text || '/device/' || session_id::text || '/' || id::text || '.wav')
);
alter table public.recording_audio_sources enable row level security;
create policy sources_owner_read on public.recording_audio_sources for select to authenticated
  using(user_id=auth.uid() and exists(select 1 from public.lantern_sessions s where s.id=session_id and s.user_id=auth.uid()));
grant select on public.recording_audio_sources to authenticated;
grant all on public.recording_audio_sources to service_role;

-- Reserve every derived object before writing storage, including ambiguous uploads.
create table public.recording_audio_derivatives (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  recording_id uuid not null references public.recordings(id) on delete cascade,
  version text not null,
  storage_path text not null,
  sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
  byte_length bigint not null check(byte_length>=46 and byte_length<=268435456),
  created_at timestamptz not null default now(),
  unique(recording_id,version),
  check(split_part(storage_path,'/',1)=user_id::text)
);
alter table public.recording_audio_derivatives enable row level security;
create policy derivative_owner_read on public.recording_audio_derivatives for select to authenticated using(user_id=auth.uid());
grant select on public.recording_audio_derivatives to authenticated;
grant all on public.recording_audio_derivatives to service_role;

create or replace function public.prepare_quipus_phone_audio(
  p_session_id uuid,p_user_id uuid,p_device_id uuid,p_event_id uuid,p_bytes bigint,p_sha256 text,p_timing jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare s public.lantern_sessions; a public.recording_audio_sources;
begin
  select * into s from public.lantern_sessions where id=p_session_id and user_id=p_user_id and device_id=p_device_id for update;
  if not found then raise exception 'Session not found'; end if;
  if not exists(select 1 from public.devices where id=p_device_id and user_id=p_user_id and revoked_at is null and credential_hash is not null) then
    raise exception 'Invalid device';
  end if;
  if s.created_at <= now()-interval '90 days' or exists(select 1 from public.recordings r
    where r.id=s.recording_id and (r.audio_deleted_at is not null or r.audio_retention_at+interval '90 days'<=now())) then
    raise exception 'Recording audio has expired';
  end if;
  select * into a from public.recording_audio_sources where session_id=p_session_id and source_kind='phone';
  if found then
    if a.user_id<>p_user_id or a.id<>p_event_id or a.sha256<>p_sha256 or a.byte_length<>p_bytes
      or a.timing_manifest is distinct from p_timing then raise exception 'Conflicting phone audio'; end if;
    return to_jsonb(a);
  end if;
  if s.state<>'finalising' or s.ended_at is not null then raise exception 'Session is not accepting audio'; end if;
  if p_timing->>'sampleRate'<>'16000' or p_timing->>'channels'<>'1' then raise exception 'Invalid audio format'; end if;
  insert into public.recording_audio_sources(id,user_id,session_id,recording_id,source_kind,storage_path,byte_length,sha256,timing_manifest)
    values(p_event_id,p_user_id,p_session_id,s.recording_id,'phone',
      p_user_id::text||'/device/'||p_session_id::text||'/'||p_event_id::text||'.wav',p_bytes,p_sha256,p_timing)
    returning * into a;
  update public.lantern_sessions set expected_audio_sources=array['onboard','phone'] where id=s.id;
  return to_jsonb(a);
end $$;

create or replace function public.commit_quipus_phone_audio(p_session_id uuid,p_user_id uuid,p_device_id uuid,p_event_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare s public.lantern_sessions;
begin
  select * into s from public.lantern_sessions where id=p_session_id and user_id=p_user_id and device_id=p_device_id for update;
  if not found then raise exception 'Session not found'; end if;
  update public.recording_audio_sources set committed_at=coalesce(committed_at,now()),recording_id=s.recording_id
    where id=p_event_id and session_id=s.id and user_id=p_user_id;
  if not found then raise exception 'Phone audio not found'; end if;
end $$;

create function public.link_quipus_source_recording() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.recording_id is not null then
    update public.recording_audio_sources set recording_id=new.recording_id
      where session_id=new.id and user_id=new.user_id;
  end if;
  return new;
end $$;
create trigger link_quipus_sources_after_archive after update of recording_id on public.lantern_sessions
  for each row execute function public.link_quipus_source_recording();

create function public.require_complete_quipus_sources() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if exists(select 1 from public.lantern_sessions s where s.id=new.session_id and 'phone'=any(s.expected_audio_sources))
    and not exists(select 1 from public.recording_audio_sources a where a.session_id=new.session_id and a.user_id=new.user_id
      and a.source_kind='phone' and a.committed_at is not null) then
    raise exception 'The phone recording must be completely uploaded first';
  end if;
  return new;
end $$;
create trigger recording_job_sources_complete before insert on public.lantern_processing_jobs
  for each row execute function public.require_complete_quipus_sources();
revoke all on function public.prepare_quipus_phone_audio(uuid,uuid,uuid,uuid,bigint,text,jsonb) from public,anon,authenticated;
revoke all on function public.commit_quipus_phone_audio(uuid,uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.link_quipus_source_recording() from public,anon,authenticated;
revoke all on function public.require_complete_quipus_sources() from public,anon,authenticated;
grant execute on function public.prepare_quipus_phone_audio(uuid,uuid,uuid,uuid,bigint,text,jsonb) to service_role;
grant execute on function public.commit_quipus_phone_audio(uuid,uuid,uuid,uuid) to service_role;
notify pgrst,'reload schema';


-- 018_offline_recording_import.sql
alter table public.devices add column if not exists encrypted_archive_key text;
alter table public.lantern_sessions
  add column if not exists offline_import_fingerprint text,
  add column if not exists capture_time_uncertain boolean not null default false;

create or replace function public.import_quipus_offline_session(
  p_session_id uuid, p_event_id uuid, p_user_id uuid, p_device_id uuid,
  p_started_at timestamptz, p_capture_ended_at timestamptz, p_machine jsonb,
  p_time_uncertain boolean, p_timezone text, p_fingerprint text, p_audio_sources text[]
) returns jsonb language plpgsql security definer set search_path=public as $$
declare d public.devices; s public.lantern_sessions;
begin
  select * into d from public.devices where id=p_device_id and user_id=p_user_id
    and revoked_at is null and credential_hash is not null for update;
  if not found then raise exception 'Invalid device owner'; end if;
  if p_fingerprint !~ '^[a-f0-9]{64}$' or p_machine->>'state' <> 'finalising'
    or p_machine->>'sessionId' <> p_session_id::text or p_machine->>'mode' <> 'quick'
    or (p_machine->>'version')::bigint <> 1 or p_machine->'prompt' is distinct from 'null'::jsonb
    or (p_machine->>'consentConfirmedAt')::timestamptz <> p_started_at
    or p_capture_ended_at <= p_started_at or p_capture_ended_at > now()+interval '2 minutes'
    or p_started_at < now()-interval '90 days'
    or not p_audio_sources <@ array['onboard','phone']::text[]
    or not 'onboard'=any(p_audio_sources) then raise exception 'Invalid offline manifest'; end if;
  select * into s from public.lantern_sessions where id=p_session_id for update;
  if found then
    if s.user_id <> p_user_id or s.device_id <> p_device_id then raise exception 'Conflicting offline owner'; end if;
    if s.offline_import_fingerprint is not null then
      if s.offline_import_fingerprint <> p_fingerprint then raise exception 'Conflicting offline import'; end if;
      return s.machine;
    end if;
    raise exception 'Session identity is already in use';
  end if;
  if exists(select 1 from public.lantern_device_events where device_id=p_device_id and event_id=p_event_id) then
    raise exception 'Event already used';
  end if;
  insert into public.lantern_sessions(id,user_id,device_id,mode,state,state_version,machine,started_at,
    recording_started_at,capture_ended_at,conversation_timezone,capture_time_uncertain,offline_import_fingerprint,
    expected_audio_sources)
    values(p_session_id,p_user_id,p_device_id,'quick','finalising',1,p_machine,p_started_at,
      p_started_at,p_capture_ended_at,p_timezone,p_time_uncertain,p_fingerprint,p_audio_sources);
  insert into public.lantern_device_events(user_id,device_id,session_id,event_id,event_type,state_version,machine)
    values(p_user_id,p_device_id,p_session_id,p_event_id,'OFFLINE_IMPORT',1,p_machine);
  return p_machine;
end $$;
revoke all on function public.import_quipus_offline_session(uuid,uuid,uuid,uuid,timestamptz,timestamptz,jsonb,boolean,text,text,text[]) from public,anon,authenticated;
grant execute on function public.import_quipus_offline_session(uuid,uuid,uuid,uuid,timestamptz,timestamptz,jsonb,boolean,text,text,text[]) to service_role;
notify pgrst,'reload schema';


-- 019_secure_device_transfer.sql
create table public.device_transfers(
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id),
  user_id uuid not null references public.profiles(id),
  status text not null default 'pending' check(status in ('pending','completed','cancelled')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '24 hours',
  completed_at timestamptz
);
create unique index one_pending_device_transfer on public.device_transfers(device_id) where status='pending';
alter table public.device_transfers enable row level security;
create policy owner_transfer_read on public.device_transfers for select to authenticated using(user_id=auth.uid());
grant select on public.device_transfers to authenticated;
grant all on public.device_transfers to service_role;

create function public.request_quipus_transfer(p_device_id uuid,p_user_id uuid)
returns public.device_transfers language plpgsql security definer set search_path=public as $$
declare d public.devices; t public.device_transfers;
begin
  select * into d from public.devices where id=p_device_id and user_id=p_user_id and revoked_at is null for update;
  if not found then raise exception 'Device not found'; end if;
  if exists(select 1 from public.lantern_sessions where device_id=d.id and ended_at is null) then
    raise exception 'Finish the current session before requesting transfer';
  end if;
  update public.device_transfers set status='cancelled' where device_id=d.id and status='pending' and expires_at<=now();
  select * into t from public.device_transfers where device_id=d.id and status='pending';
  if found then return t; end if;
  insert into public.device_transfers(device_id,user_id) values(d.id,p_user_id) returning * into t;
  return t;
end $$;

create function public.acknowledge_quipus_transfer(p_transfer_id uuid,p_device_id uuid,p_user_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare t public.device_transfers; d public.devices;
begin
  select * into d from public.devices where id=p_device_id and user_id=p_user_id for update;
  if not found or d.revoked_at is not null or d.credential_hash is null then raise exception 'Invalid device'; end if;
  select * into t from public.device_transfers where id=p_transfer_id and device_id=d.id and user_id=p_user_id for update;
  if not found or t.status<>'pending' or t.expires_at<=now() then raise exception 'Transfer request expired'; end if;
  if exists(select 1 from public.lantern_sessions s where s.device_id=d.id and
      (s.ended_at is null or (s.recording_id is not null and not exists(select 1 from public.recordings r where r.id=s.recording_id and r.audio_deleted_at is not null) and not exists(
        select 1 from public.lantern_audio_uploads a where a.session_id=s.id and a.event_id=s.audio_event_id and a.verified_at is not null))))
    or exists(select 1 from public.recording_audio_sources a join public.lantern_sessions s on s.id=a.session_id
      where s.device_id=d.id and (a.committed_at is null or a.verified_at is null)) then
    raise exception 'Verify all pending recordings before transfer';
  end if;
  -- Keep the old device/session rows and their original owner. Release only the physical identity.
  update public.devices set revoked_at=now(),credential_hash=null,hardware_id=null,status='offline',
    encrypted_archive_key=null,updated_at=now() where id=d.id;
  update public.device_transfers set status='completed',completed_at=now() where id=t.id;
end $$;
revoke all on function public.request_quipus_transfer(uuid,uuid) from public,anon,authenticated;
revoke all on function public.acknowledge_quipus_transfer(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.request_quipus_transfer(uuid,uuid) to service_role;
grant execute on function public.acknowledge_quipus_transfer(uuid,uuid,uuid) to service_role;
notify pgrst,'reload schema';

notify pgrst,'reload schema';

commit;
