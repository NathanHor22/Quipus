-- Read-only check for the physical Quipus board on COM10.
-- Hardware MAC confirmed by esptool: 28:84:85:42:1c:38.
-- Run in the Supabase SQL editor as the project administrator.
-- This script changes no rows, credentials, devices or recordings.

begin transaction read only;

select
  d.id as device_id,
  d.hardware_id,
  d.name as device_name,
  d.user_id as registered_profile_id,
  p.email as registered_profile_email,
  u.id as matching_auth_user_id,
  u.email as matching_auth_email,
  (u.id is null) as profile_has_no_auth_user,
  d.revoked_at,
  d.paired_at
from public.devices as d
left join public.profiles as p on p.id = d.user_id
left join auth.users as u on u.id = d.user_id
where d.hardware_id = 'esp32s3:288485421c38';

-- Find authenticated identities with the same email as that profile.
-- A legacy profile without an auth identity can reveal a prototype/login split.
select
  u.id as auth_user_id,
  u.email,
  u.created_at,
  u.email_confirmed_at
from auth.users as u
where lower(u.email) in (
  select lower(p.email)
  from public.devices as d
  join public.profiles as p on p.id = d.user_id
  where d.hardware_id = 'esp32s3:288485421c38'
);

commit;
