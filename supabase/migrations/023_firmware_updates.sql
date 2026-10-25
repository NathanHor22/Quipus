begin;

-- Signed recorder firmware offered over the device heartbeat. Releases and
-- targeting are written only by the service role (scripts/publish-firmware.mjs).
create table public.firmware_releases(
  id uuid primary key default gen_random_uuid(),
  model text not null check(length(model) between 1 and 100),
  version text not null check(version ~ '^[0-9]{1,5}\.[0-9]{1,5}\.[0-9]{1,5}(-[a-z0-9-]+)?$' and length(version) < 40),
  storage_path text not null unique check(storage_path ~ '^[A-Za-z0-9._/-]+$' and storage_path !~ '\.\.'),
  sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes integer not null check(size_bytes > 0 and size_bytes <= 4128768),
  status text not null default 'draft' check(status in ('draft','active','paused')),
  rollout text not null default 'selected' check(rollout in ('selected','all')),
  notes text check(notes is null or length(notes) <= 500),
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  unique(model, version)
);
alter table public.firmware_releases enable row level security;
grant all on public.firmware_releases to service_role;

create table public.firmware_release_devices(
  release_id uuid not null references public.firmware_releases(id) on delete cascade,
  device_id uuid not null references public.devices(id) on delete cascade,
  primary key(release_id, device_id)
);
alter table public.firmware_release_devices enable row level security;
grant all on public.firmware_release_devices to service_role;

create table public.device_firmware_updates(
  device_id uuid not null references public.devices(id) on delete cascade,
  release_id uuid not null references public.firmware_releases(id) on delete cascade,
  state text not null default 'offered' check(state in ('offered','installed','failed','rolled_back')),
  attempts integer not null default 0 check(attempts >= 0),
  last_error text check(last_error is null or length(last_error) <= 200),
  offered_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(device_id, release_id)
);
create index device_firmware_updates_device_idx on public.device_firmware_updates(device_id, updated_at desc);
alter table public.device_firmware_updates enable row level security;
create policy owner_firmware_update_read on public.device_firmware_updates for select to authenticated
  using(exists(select 1 from public.devices d where d.id = device_id and d.user_id = auth.uid()));
grant select on public.device_firmware_updates to authenticated;
grant all on public.device_firmware_updates to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('firmware', 'firmware', false, 4194304, array['application/octet-stream'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

notify pgrst,'reload schema';
commit;
