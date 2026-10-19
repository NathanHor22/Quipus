begin;
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
commit;
