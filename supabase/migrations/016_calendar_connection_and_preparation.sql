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
