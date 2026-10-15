-- Yard Check sync (Driver Toolkit v1.14.0)
-- Run once in the Supabase SQL editor for project tjivcqxnkftujceumdtx.
-- One row per sent yard check. The phone's own check id is the primary key,
-- so resending the same check updates the row instead of duplicating it.

create table if not exists public.yard_checks (
  id            text primary key,              -- e.g. "yc-1760550000000" from the phone
  location      text not null default '',
  location_key  text not null default '',      -- lower-cased, trimmed, single-spaced; used for matching
  pin           text not null default '',      -- Google Maps link if the driver pinned GPS
  driver        text not null default '',
  checked_at    timestamptz not null,          -- the date/time on the form
  sent_at       timestamptz not null default now(),
  how           text not null default '',      -- "Text to Chris", "Email", "Shared", ...
  notes         text not null default '',      -- yard notes
  trailers      jsonb not null default '[]',   -- [{ "trailer": "53101", "status": "Loaded", "note": "Tyson chicken" }]
  trailer_count int  not null default 0,
  loaded_count  int  not null default 0,
  empty_count   int  not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists yard_checks_location_idx on public.yard_checks (location_key, checked_at desc);
create index if not exists yard_checks_checked_idx  on public.yard_checks (checked_at desc);

-- Only the edge functions (service role) touch this table.
alter table public.yard_checks enable row level security;
