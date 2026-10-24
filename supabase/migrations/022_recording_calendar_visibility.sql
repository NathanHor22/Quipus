begin;
-- Display preference only: audio, transcript, Google events and invitations are
-- retained. Stable references also cover hardware sessions still processing.
create table if not exists public.calendar_recording_preferences (
  user_id uuid not null references public.profiles(id) on delete cascade,
  conversation_reference text not null check (length(conversation_reference) between 1 and 160),
  hidden boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, conversation_reference)
);
alter table public.calendar_recording_preferences enable row level security;
-- Browser access goes through authenticated, explicitly owner-scoped routes.
revoke all on public.calendar_recording_preferences from public, anon, authenticated;
grant all on public.calendar_recording_preferences to service_role;
notify pgrst, 'reload schema';
commit;
