# Office sync — Supabase setup

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

## Status: deployed (Oct 15, 2026)

All of this is live on project `tjivcqxnkftujceumdtx` (LWH Companion):

| Piece | What it does |
|---|---|
| table `yard_checks` | one row per sent Yard Check |
| table `driver_status_updates` | one row per Status Update (Arrived, Loaded, ...) |
| `yard-check-submit` | phone → save a yard check |
| `yard-check-history` | yard checks by yard and/or day (`from`/`to`) |
| `status-submit` | phone → save a status update |
| `status-history` | status updates for a day (`from`/`to`), optional `driver` |
| bucket `yard-photos` (private) | trailer photos, stored as `<check id>/<photo id>.jpg` |
| `yard-photo-upload` | phone → upload one shrunk JPEG for a yard check |
| `yard-photo-urls` | 1-hour view links for the Dispatch Board |
| tables `recruit_codes`, `recruit_scans`, `recruit_awards` | Recruiter: driver codes, counted scans, office-credited points |
| `recruit-go` | the link inside each driver's QR: counts the scan, redirects to the driver application |
| `recruit` | register a driver's code, stats/leaderboard, award/unaward (manager passcode) |

All of these functions run with JWT verification off, like the timesheet ones.
The Dispatch Board in the toolkit reads the two history functions.

## Driver Messages (Nov 6, 2026) — deployed

Migration `20261106_driver_messages.sql` is applied to LWH Companion. No Edge Functions —
the app calls Postgres functions directly with the publishable key (same as the Warehouse
Toolkit's employee PIN login). Tables have RLS on and no policies, so nothing is readable
except through these functions.

| Piece | What it does |
|---|---|
| `drv_auth`, `drv_setup_codes`, `drv_sessions` | Driver ID + PIN sign-in, keyed to `drivers.driver_id` (30-day sessions) |
| `msg_messages`, `msg_recipients` | one row per message, one row per person (delivered / read / got it / reply) |
| `drv_create_pin`, `drv_login`, `drv_logout`, `drv_me` | sign-in (Toolkit and Message Center) |
| `msg_inbox`, `msg_mark` | driver inbox; read / ack / reply |
| `msg_directory`, `msg_send`, `msg_sent`, `msg_detail`, `msg_recall` | Message Center (role = Manager only) |
| `drv_setup_list`, `drv_reset_pin` | setup codes and PIN resets (role = Manager only) |

**First sign-in for managers.** Every active person in `drivers` got a setup code. To get the
managers' codes (one time), run this in the SQL Editor:

```sql
select d.name, c.driver_id, c.setup_code
  from drv_setup_codes c join drivers d using (driver_id)
 where d.role = 'Manager';
```

Then open **Driver Messages** in the Transportation Manager app, tap **First time sign-in**, and make a PIN. After that, the Message
Center's **Driver Sign-in** tab lists every driver's code and can reset PINs. New drivers added
to the `drivers` table get a code the next time that tab is opened.

`recipient_kind`/`sender_kind` allow `'emp'` so the Warehouse Toolkit can use the same tables
with its `emp_*` sign-in later.

## Files and driver-to-dispatch messages (Nov 6, 2026) — deployed

Migration `20261106b_messages_files_and_driver_replies.sql` (applied) plus Edge Function
`msg-file` (deployed, JWT verification off like the others).

| Piece | What it does |
|---|---|
| bucket `msg-files` (private, 10 MB, PDF/JPG/PNG/WebP) | message attachments, `YYYY-MM/<id>.<ext>` |
| table `msg_attachments` | one row per file; `expires_at` = upload + 14 days |
| `msg-file` `?action=upload` | raw file body + `x-msg-token` header → attachment id (drivers: photos only) |
| `msg-file` `?action=url` | `{token,id}` → 10-minute signed link, only for managers, the uploader, or recipients |
| `msg_driver_send` | driver → dispatch (topic, text, location, photo, optional reply-to) |
| `msg_dispatch_inbox`, `msg_dispatch_mark` | Message Center Driver Inbox; read / done / reopen |
| `msg_send` (new `p_reply_to`, `p_attachments`) | answer a driver in-thread; attach files |
| `msg_mark(..., 'open')` | records when a driver opened a file (pre-downloading for offline doesn't count) |

Every upload also removes files past 14 days (and abandoned uploads). To change the 14 days,
change the default on `msg_attachments.expires_at` and the wording in the apps.
