begin;
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
commit;
