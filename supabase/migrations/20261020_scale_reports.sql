-- Weigh-station Open/Closed reports from LWH drivers (Driver Toolkit v1.34.0).
-- No public feed of scale status exists for AR/OK/MO/KS/TX/LA/TN/MS, so drivers
-- report what they see and everyone in the toolkit sees the latest report.
-- Read/written only through the scale-reports edge function (service role).
create table if not exists public.scale_reports (
  id           text primary key,              -- "sr-..." from the phone; resends update, not duplicate
  osm_id       text not null,                 -- OpenStreetMap id of the scale, e.g. "node/123" or "way/456"
  name         text not null default '',
  lat          double precision,
  lon          double precision,
  status       text not null check (status in ('Open','Closed')),
  driver       text not null default '',
  reported_at  timestamptz not null,
  created_at   timestamptz not null default now()
);
create index if not exists scale_reports_osm_idx on public.scale_reports (osm_id, reported_at desc);
create index if not exists scale_reports_time_idx on public.scale_reports (reported_at desc);
alter table public.scale_reports enable row level security;

-- Scales added by LWH drivers ("Add a scale here") — fills gaps in OpenStreetMap.
-- id = "lwh/<random>"; reports reference it in scale_reports.osm_id.
-- Set hidden = true to remove a bad entry from the app.
create table if not exists public.scale_sites (
  id          text primary key,
  name        text not null,
  lat         double precision not null,
  lon         double precision not null,
  added_by    text not null default '',
  hidden      boolean not null default false,
  created_at  timestamptz not null default now()
);
alter table public.scale_sites enable row level security;
