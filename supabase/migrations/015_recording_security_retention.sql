begin;

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
commit;
