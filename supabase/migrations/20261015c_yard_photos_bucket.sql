-- Yard Check photos (Driver Toolkit v1.17.0). Already applied to tjivcqxnkftujceumdtx.
-- Private bucket; phones upload through yard-photo-upload and dispatch views
-- through yard-photo-urls (1-hour signed links). No storage policies needed
-- because only the edge functions (service role) touch it.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('yard-photos', 'yard-photos', false, 3145728, array['image/jpeg'])
on conflict (id) do nothing;
