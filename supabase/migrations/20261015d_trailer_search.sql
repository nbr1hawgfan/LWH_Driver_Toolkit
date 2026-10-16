-- Find a trailer (Driver Toolkit v1.18.0). Already applied to tjivcqxnkftujceumdtx.
alter table public.yard_checks
  add column if not exists trailers_text text generated always as (upper(trailers::text)) stored;
create index if not exists driver_status_trailer_idx on public.driver_status_updates (trailer);
