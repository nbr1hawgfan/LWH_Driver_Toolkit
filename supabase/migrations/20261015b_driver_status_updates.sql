-- Status Update sync (Driver Toolkit v1.15.0). Already applied to tjivcqxnkftujceumdtx.
create table if not exists public.driver_status_updates (
  id            text primary key,             -- "su-..." from the phone; resends update, not duplicate
  driver        text not null default '',
  status        text not null,                -- Arrived, Loaded, Unloaded, Delivered, Departed, Waiting, Running Late
  location      text not null default '',
  location_key  text not null default '',
  trailer       text not null default '',
  load_ref      text not null default '',
  eta           text not null default '',
  note          text not null default '',
  pin           text not null default '',
  how           text not null default '',
  sent_at       timestamptz not null,
  created_at    timestamptz not null default now()
);
create index if not exists driver_status_sent_idx on public.driver_status_updates (sent_at desc);
create index if not exists driver_status_driver_idx on public.driver_status_updates (lower(driver), sent_at desc);
alter table public.driver_status_updates enable row level security;
