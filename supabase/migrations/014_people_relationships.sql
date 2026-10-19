begin;

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
commit;
