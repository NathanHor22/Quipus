begin;

-- A finalized offline WAV must not occupy the live recording-control slot.
-- Retain every existing session, event, upload manifest and private audio file.
-- The replacement is transactional: no other transaction sees an unguarded slot.
drop index if exists public.lantern_one_open_session_per_device;
create unique index lantern_one_open_session_per_device
  on public.lantern_sessions(device_id)
  where ended_at is null and offline_import_fingerprint is null;
comment on index public.lantern_one_open_session_per_device is
  'One live cloud-control session per device; finalized offline archives queue independently.';

create or replace function public.enqueue_lantern_processing(p_session_id uuid, p_user_id uuid,
  p_device_id uuid, p_event_id uuid, p_expected_version bigint, p_machine jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.lantern_sessions; t record;
begin
  select * into s from public.lantern_sessions where id=p_session_id
    and user_id=p_user_id and device_id=p_device_id for update;
  if not found or s.recording_id is null then raise exception 'Recording is not archived'; end if;
  if s.ended_at is not null then
    if s.completion_event_id = p_event_id then return s.machine; end if;
    raise exception 'Session already completed';
  end if;
  if s.state not in ('finalising','processing') or s.state_version <> p_expected_version then
    raise exception 'Session state changed';
  end if;
  if p_machine->>'state' <> 'ready' or (p_machine->>'version')::bigint <> s.state_version+1 then
    raise exception 'Invalid queue transition';
  end if;
  insert into public.lantern_processing_jobs(session_id,user_id) values(s.id,s.user_id)
    on conflict (session_id) do nothing;
  update public.lantern_sessions set recording_started_at=coalesce(recording_started_at,
    (s.machine->>'recordingStartedAt')::timestamptz,s.started_at) where id=s.id;
  if s.offline_import_fingerprint is not null then
    -- An offline import is a stopped archive, not the live-control session.
    -- Complete only this archive. A newer live capture keeps its state/version.
    if not exists(select 1 from public.devices where id=p_device_id and user_id=p_user_id
      and revoked_at is null and credential_hash is not null) then
      raise exception 'Lantern device is unavailable';
    end if;
    update public.lantern_sessions set state='ready',state_version=s.state_version+1,
      machine=p_machine,ended_at=now(),updated_at=now() where id=s.id;
    insert into public.lantern_device_events(user_id,device_id,session_id,event_id,event_type,state_version,machine)
      values(s.user_id,s.device_id,s.id,p_event_id,'PROCESSING_QUEUED',s.state_version+1,p_machine);
  else
    -- Preserve the existing cloud session transition and its optimistic lock.
    select * into t from public.apply_lantern_transition(s.id,s.user_id,s.device_id,
      s.state_version,'ready',s.state_version+1,p_machine,p_event_id,'PROCESSING_QUEUED',now());
    if not t.applied then raise exception 'Session state changed'; end if;
  end if;
  update public.lantern_sessions set completion_event_id=p_event_id,
    processing_stage='queued', processing_error=null where id=s.id;
  return p_machine;
end $$;

revoke all on function public.enqueue_lantern_processing(uuid,uuid,uuid,uuid,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.enqueue_lantern_processing(uuid,uuid,uuid,uuid,bigint,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
