begin;
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
commit;
