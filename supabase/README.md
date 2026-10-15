# Yard Check sync — one-time setup

The Driver Toolkit (v1.14.0+) sends every Yard Check to Supabase project
`tjivcqxnkftujceumdtx`, the same project the timesheets use. Until these
three pieces are set up, the app still works normally: checks save on the
phone, queue up, and send themselves once the functions exist.

1. **Table** – open the Supabase dashboard → SQL Editor, paste
   `migrations/20261015_yard_checks.sql`, and run it.
2. **Functions** – from this repo folder with the Supabase CLI logged in:

   ```
   supabase functions deploy yard-check-submit  --project-ref tjivcqxnkftujceumdtx --no-verify-jwt
   supabase functions deploy yard-check-history --project-ref tjivcqxnkftujceumdtx --no-verify-jwt
   ```

   (Or create each function in the dashboard → Edge Functions, paste its
   `index.ts`, and turn **Enforce JWT verification** off, matching
   timesheet-submit.)
3. **Check** – open the toolkit → Yard Board. It should say
   "No yard checks synced yet" instead of a load error.

Like the timesheet functions, these are open to anyone who has the URL. They
only accept yard-check shaped data and only return yard checks.
