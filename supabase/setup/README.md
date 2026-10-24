# Fresh Supabase project setup

For a new, empty Supabase project, [quipus-fresh-project.sql](./quipus-fresh-project.sql)
combines every numbered migration in order. No credentials are included.

1. Create the Supabase project with **Enable Data API** and **Automatically expose
   new tables** checked. The migrations enable Row Level Security and policies.
2. Open `quipus-fresh-project.sql` on GitHub, click **Raw**, and copy the entire file.
3. In your new Supabase project, open **SQL Editor > New query**, paste, and click
   **Run**. Run the entire file, with no partial selection.
4. The last result should say **Quipus database setup complete** and
   `recordings_bucket_private = true`. Confirm the application tables in Table
   Editor and the private `recordings` bucket in Storage.

Use this file once on a fresh project. It refuses to run when public tables or
Quipus types already exist. It does not reset or replace an existing database.
If an error occurs, stop and keep its text: previous migrations may already have
committed. Continue with only the missing migrations after diagnosing the error.

The original numbered migration files and their transaction boundaries are
preserved. This bundle lives outside `supabase/migrations` so the CLI does not
apply it as an extra migration. SQL Editor does not populate the CLI migration
ledger; reconcile the applied versions with `supabase migration repair` before
switching this project to CLI-managed deployments. Do not rerun all versions.

Maintainers can regenerate and check the bundle with:

```sh
python scripts/package-supabase-setup.py
python scripts/package-supabase-setup.py --check
```

After database setup, configure the site's Auth URLs and Google provider using
[the deployment guide](../../docs/deployment.md), then redeploy Vercel with the
Supabase and Agora environment variables.

## Existing project: recording and calendar upgrade

For a project that already has migrations **001 through 020**, run
[quipus-recording-calendar-upgrade.sql](./quipus-recording-calendar-upgrade.sql)
**once**, as an entire file in Supabase SQL Editor. It contains only migrations
021 and 022, with their original transaction boundaries and source checksums.
The final result should show both installation checks as `true`.

The migration itself deletes no recordings or storage objects. It adds a
service-only decision record for future, positively verified short digital
silence, plus calendar visibility preferences. Hiding a recording keeps its
audio, transcript, People history and Google Calendar invitations. It can be
restored using **Undo** or the calendar's **Hidden** filter.

If migration 021 is already installed, apply only
[022_recording_calendar_visibility.sql](../migrations/022_recording_calendar_visibility.sql)
when it is missing. The combined file deliberately refuses to re-run 021.
If an error occurs, stop and keep the message; an earlier migration may already
have committed. Do not use the fresh-project bundle on this existing database.

Maintainers can regenerate and verify the existing-project bundle with:

```sh
python scripts/package-supabase-setup.py --recording-calendar-upgrade
python scripts/package-supabase-setup.py --recording-calendar-upgrade --check
```
