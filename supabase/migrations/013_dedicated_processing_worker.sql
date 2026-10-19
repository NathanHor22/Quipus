begin;

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
commit;
