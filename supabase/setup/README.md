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
