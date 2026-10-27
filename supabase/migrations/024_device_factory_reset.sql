-- Revocation disables account access immediately. The hardware identity is only
-- released after the authenticated recorder confirms its local private wipe.
begin;

create table public.device_reset_requests (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null unique references public.devices(id),
  user_id uuid not null references public.profiles(id),
  credential_hash text,
  state text not null default 'pending' check (state in ('pending','completed')),
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  check (credential_hash is null or credential_hash ~ '^[0-9a-f]{64}$'),
  check ((state='completed') = (completed_at is not null))
);
alter table public.device_reset_requests enable row level security;
revoke all on public.device_reset_requests from public,anon,authenticated;
grant select,insert,update on public.device_reset_requests to service_role;

create function public.request_quipus_device_reset(p_device_id uuid,p_user_id uuid)
returns table(reset_id uuid,reset_state text)
language plpgsql security definer set search_path=public as $$
declare d public.devices; r public.device_reset_requests;
begin
  select * into d from public.devices where id=p_device_id and user_id=p_user_id for update;
  if not found then raise exception 'Device not found' using errcode='P0002'; end if;
  select * into r from public.device_reset_requests where device_id=d.id for update;
  if found then
    return query select r.id,case when r.state='completed' then 'completed'
      when r.credential_hash is null then 'recovery_required' else 'pending' end;
    return;
  end if;
  if d.hardware_id is null then
    return query select null::uuid,'completed'::text;
    return;
  end if;
  insert into public.device_reset_requests(device_id,user_id,credential_hash)
    values(d.id,d.user_id,d.credential_hash) returning * into r;
  update public.devices set revoked_at=coalesce(revoked_at,now()),credential_hash=null,
    status='offline',updated_at=now() where id=d.id;
  update public.device_transfers set status='cancelled' where device_id=d.id and status='pending';
  -- This owner explicitly discards unfinished local captures, not uploaded data.
  update public.lantern_sessions set ended_at=coalesce(ended_at,now()),updated_at=now()
    where device_id=d.id and ended_at is null;
  return query select r.id,case when r.credential_hash is null then 'recovery_required' else 'pending' end;
end $$;

create function public.acknowledge_quipus_device_reset(
  p_reset_id uuid,p_device_id uuid,p_credential_hash text
) returns void language plpgsql security definer set search_path=public as $$
declare d public.devices; r public.device_reset_requests;
begin
  -- Same lock order as owner revoke/pairing prevents a reset/reclaim race.
  select * into d from public.devices where id=p_device_id for update;
  if not found then raise exception 'Invalid reset credential' using errcode='42501'; end if;
  select * into r from public.device_reset_requests
    where id=p_reset_id and device_id=d.id and user_id=d.user_id for update;
  if not found or r.credential_hash is null or r.credential_hash<>p_credential_hash then
    raise exception 'Invalid reset credential' using errcode='42501';
  end if;
  if r.state='completed' then return; end if;
  if d.revoked_at is null or d.credential_hash is not null then
    raise exception 'Reset state changed' using errcode='40001';
  end if;
  -- Preserve the original row, owner, sessions and recordings for history.
  update public.devices set hardware_id=null,encrypted_archive_key=null,status='offline',
    updated_at=now() where id=d.id;
  update public.device_reset_requests set state='completed',completed_at=now() where id=r.id;
  -- Keep the reset-only verifier to acknowledge retries after a lost response.
  -- It never grants access to any data endpoint or to a newly paired device UUID.
end $$;

create function public.guard_quipus_device_reset() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if (new.revoked_at is null or new.credential_hash is not null) and exists(
    select 1 from public.device_reset_requests where device_id=old.id and state='pending'
  ) then raise exception 'Quipus device reset is pending'; end if;
  return new;
end $$;
create trigger quipus_device_reset_guard before update on public.devices
for each row execute function public.guard_quipus_device_reset();

create or replace function public.claim_lantern_pairing(
  p_code_hash text,p_device_id uuid,p_hardware_id text,p_model text,
  p_firmware_version text,p_credential_hash text
) returns table(device_id uuid,owner_id uuid,device_name text)
language plpgsql security definer set search_path=public as $$
declare pairing public.device_pairings; existing public.devices; claimed public.devices;
begin
  select * into pairing from public.device_pairings as p
    where p.code_hash=p_code_hash and p.claimed_at is null and p.expires_at>now() for update;
  if not found then return; end if;
  select * into existing from public.devices as d where d.hardware_id=p_hardware_id for update;
  if found then
    if exists(select 1 from public.device_reset_requests as r where r.device_id=existing.id and r.state='pending') then
      raise exception 'Quipus device reset is pending';
    end if;
    if existing.user_id<>pairing.user_id then
      raise exception 'Lantern hardware is already paired to another owner';
    end if;
    if existing.revoked_at is null and existing.credential_hash is not null then
      raise exception 'Lantern hardware is already paired; revoke it before pairing again';
    end if;
    update public.lantern_sessions as s set ended_at=coalesce(s.ended_at,now()),updated_at=now()
      where s.device_id=existing.id and s.ended_at is null;
    update public.devices as d set name=pairing.device_name,model=p_model,
      firmware_version=p_firmware_version,credential_hash=p_credential_hash,paired_at=now(),
      revoked_at=null,status='online',device_state='ready',state_version=0,last_error=null,
      last_seen_at=now(),updated_at=now() where d.id=existing.id returning * into claimed;
  else
    insert into public.devices(id,user_id,name,hardware_id,model,firmware_version,
      credential_hash,paired_at,status,device_state,last_seen_at)
      values(p_device_id,pairing.user_id,pairing.device_name,p_hardware_id,p_model,
        p_firmware_version,p_credential_hash,now(),'online','ready',now()) returning * into claimed;
  end if;
  update public.device_pairings as p set claimed_at=now(),claimed_device_id=claimed.id where p.id=pairing.id;
  return query select claimed.id,claimed.user_id,claimed.name;
end $$;

revoke all on function public.request_quipus_device_reset(uuid,uuid) from public,anon,authenticated;
revoke all on function public.acknowledge_quipus_device_reset(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.guard_quipus_device_reset() from public,anon,authenticated;
grant execute on function public.request_quipus_device_reset(uuid,uuid) to service_role;
grant execute on function public.acknowledge_quipus_device_reset(uuid,uuid,text) to service_role;
notify pgrst,'reload schema';
commit;
