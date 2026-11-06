-- Driver Messages, part 2 (Driver Toolkit v1.40.0) — project tjivcqxnkftujceumdtx
-- 1. Attachments: dispatch can attach a PDF or photo (a BOL, gate pass...) to a message; drivers can
--    attach a photo to a message they send. Files live in the private "msg-files" bucket and are
--    reached only through the msg-file Edge Function (signed links, 10 minutes). Files are removed
--    14 days after upload (msg_attachments.expires_at); the message and its receipts stay.
-- 2. Drivers -> dispatch: drivers send a message (topic + optional text, photo, location) when stopped.
--    It lands in the Message Center's Driver Inbox; dispatch replies in the same thread.

-- ---------------------------------------------------------------- schema
alter table public.msg_messages
  add column if not exists direction  text not null default 'to_driver',
  add column if not exists reply_to   bigint references public.msg_messages(id) on delete set null,
  add column if not exists thread_id  bigint references public.msg_messages(id) on delete set null,
  add column if not exists topic      text,
  add column if not exists lat        double precision,
  add column if not exists lon        double precision,
  add column if not exists loc_acc_m  integer,
  add column if not exists dispatch_read_at timestamptz,
  add column if not exists dispatch_read_by text,
  add column if not exists handled_at timestamptz,
  add column if not exists handled_by text;
do $$ begin
  alter table public.msg_messages add constraint msg_messages_direction_check check (direction in ('to_driver','to_dispatch'));
exception when duplicate_object then null; end $$;
alter table public.msg_messages drop constraint if exists msg_messages_body_check;
alter table public.msg_messages add constraint msg_messages_body_check check (length(body) <= 1000);
create index if not exists msg_messages_dispatch_idx on public.msg_messages (direction, created_at desc);
create index if not exists msg_messages_thread_idx on public.msg_messages (thread_id);
create index if not exists msg_messages_sender_idx on public.msg_messages (sender_kind, sender_id, created_at desc);

alter table public.msg_recipients add column if not exists opened_at timestamptz;

create table if not exists public.msg_attachments (
  id            uuid primary key default gen_random_uuid(),
  message_id    bigint references public.msg_messages(id) on delete cascade,
  uploader_kind text not null check (uploader_kind in ('driver','emp')),
  uploader_id   text not null,
  file_name     text not null,
  mime          text not null,
  bytes         integer not null,
  storage_path  text not null unique,
  uploaded_at   timestamptz,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null default now() + interval '14 days',
  removed_at    timestamptz
);
create index if not exists msg_attachments_message_idx on public.msg_attachments (message_id);
create index if not exists msg_attachments_expires_idx on public.msg_attachments (expires_at) where removed_at is null;
alter table public.msg_attachments enable row level security;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('msg-files','msg-files',false,10485760,array['application/pdf','image/jpeg','image/png','image/webp'])
on conflict (id) do update set public=false, file_size_limit=excluded.file_size_limit, allowed_mime_types=excluded.allowed_mime_types;

-- ---------------------------------------------------------------- helpers
create or replace function public.msg_attachments_json(p_message_id bigint)
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object('id',a.id,'name',a.file_name,'mime',a.mime,'bytes',a.bytes,
           'expires_at',a.expires_at,'removed',(a.removed_at is not null or a.expires_at < now())) order by a.created_at),'[]'::json)
    from msg_attachments a where a.message_id = p_message_id and a.uploaded_at is not null;
$$;

-- Links uploaded-but-unsent files to a new message. Only the uploader's own, unused, uploaded files.
create or replace function public.msg_link_attachments(p_message_id bigint, p_kind text, p_id text, p_ids uuid[])
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if p_ids is null or array_length(p_ids,1) is null then return 0; end if;
  update msg_attachments set message_id = p_message_id
   where id = any(p_ids[1:5]) and message_id is null and uploaded_at is not null
     and uploader_kind = p_kind and uploader_id = p_id and removed_at is null;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------- file RPCs (Edge Function only — service_role)
-- Reserve a storage path for an upload. Drivers: photos only. Managers: PDF or photos.
create or replace function public.msg_file_register(p_token text, p_name text, p_mime text, p_bytes int)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v_id text := drv_session_driver(p_token); v_mgr boolean; a_id uuid := gen_random_uuid();
        v_name text := left(regexp_replace(coalesce(nullif(trim(p_name),''),'file'),'[\r\n/\\]','_','g'),120);
        v_ext text; v_recent int;
begin
  if v_id is null then return json_build_object('ok',false,'error','signed_out'); end if;
  v_mgr := drv_session_manager(p_token) is not null;
  if p_mime not in ('application/pdf','image/jpeg','image/png','image/webp') then
    return json_build_object('ok',false,'error','Only PDF, JPG, PNG or WebP files.');
  end if;
  if not v_mgr and p_mime = 'application/pdf' then return json_build_object('ok',false,'error','Drivers can send photos only.'); end if;
  if p_bytes is null or p_bytes <= 0 or p_bytes > 10485760 then return json_build_object('ok',false,'error','File must be under 10 MB.'); end if;
  select count(*) into v_recent from msg_attachments where uploader_id = v_id and created_at > now() - interval '1 hour';
  if v_recent >= (case when v_mgr then 60 else 15 end) then return json_build_object('ok',false,'error','Too many files this hour. Try again later.'); end if;
  v_ext := case p_mime when 'application/pdf' then 'pdf' when 'image/png' then 'png' when 'image/webp' then 'webp' else 'jpg' end;
  insert into msg_attachments (id, uploader_kind, uploader_id, file_name, mime, bytes, storage_path)
  values (a_id, 'driver', v_id, v_name, p_mime, p_bytes, to_char(now() at time zone 'America/Chicago','YYYY-MM') || '/' || a_id || '.' || v_ext);
  return json_build_object('ok',true,'id',a_id,'path',(select storage_path from msg_attachments where id = a_id));
end $$;

create or replace function public.msg_file_uploaded(p_id uuid)
returns void language sql security definer set search_path = public as $$
  update msg_attachments set uploaded_at = now() where id = p_id;
$$;

-- Who may open a file: managers (any message file), the uploader, or a recipient of the message.
create or replace function public.msg_file_access(p_token text, p_id uuid)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v_id text := drv_session_driver(p_token); a msg_attachments%rowtype; ok boolean := false;
begin
  if v_id is null then return json_build_object('ok',false,'error','signed_out'); end if;
  select * into a from msg_attachments where id = p_id and uploaded_at is not null;
  if not found then return json_build_object('ok',false,'error','File not found.'); end if;
  if a.removed_at is not null or a.expires_at < now() then return json_build_object('ok',false,'error','This file was removed after 14 days.'); end if;
  if drv_session_manager(p_token) is not null or a.uploader_id = v_id then ok := true;
  elsif a.message_id is not null and exists (select 1 from msg_recipients r join msg_messages m on m.id = r.message_id
         where r.message_id = a.message_id and r.recipient_kind='driver' and r.recipient_id = v_id and m.recalled_at is null) then
    ok := true;  -- opening is recorded by msg_mark(..., 'open') so pre-downloading for offline use doesn't count
  end if;
  if not ok then return json_build_object('ok',false,'error','File not found.'); end if;
  return json_build_object('ok',true,'path',a.storage_path,'name',a.file_name,'mime',a.mime);
end $$;

-- Files past their date (and abandoned uploads older than a day): mark removed, return paths to delete.
create or replace function public.msg_file_expired()
returns setof text language plpgsql security definer set search_path = public as $$
begin
  return query
  with u as (
    update msg_attachments set removed_at = now()
     where removed_at is null
       and (expires_at < now() or (message_id is null and created_at < now() - interval '1 day'))
    returning storage_path)
  select u.storage_path from u;
end $$;

-- ---------------------------------------------------------------- driver side
create or replace function public.msg_inbox(p_token text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v_id text := drv_session_driver(p_token); result json;
begin
  if v_id is null then return json_build_object('ok',false,'error','signed_out'); end if;
  update msg_recipients r set delivered_at = now()
    from msg_messages m
   where m.id = r.message_id and r.recipient_kind = 'driver' and r.recipient_id = v_id
     and r.delivered_at is null and m.recalled_at is null;
  select json_build_object('ok',true,'now',now(),
    'messages',coalesce((select json_agg(x order by x.sort_key, x.created_at desc) from (
      select m.id, m.created_at, m.sender_name, m.msg_type, m.body, m.reply_options, m.urgent, m.expires_at,
             r.read_at, r.acked_at, r.reply, r.replied_at, r.opened_at, m.reply_to,
             (select json_build_object('topic',o.topic,'body',left(o.body,140),'created_at',o.created_at) from msg_messages o
               where o.id = m.reply_to and o.direction='to_dispatch' and o.sender_id = v_id) as in_reply_to,
             msg_attachments_json(m.id) as attachments,
             case when m.msg_type = 'ack'   and r.acked_at  is null then 0
                  when m.msg_type = 'reply' and r.replied_at is null then 0
                  when r.read_at is null then 1 else 2 end as sort_key
        from msg_recipients r join msg_messages m on m.id = r.message_id
       where r.recipient_kind = 'driver' and r.recipient_id = v_id
         and m.recalled_at is null
         and (m.expires_at is null or m.expires_at > now())
         and m.created_at > now() - interval '30 days'
       order by m.id desc limit 100) x),'[]'::json),
    'sent',coalesce((select json_agg(y order by y.created_at desc) from (
      select m.id, m.created_at, m.topic, m.body, m.dispatch_read_at, m.dispatch_read_by, m.handled_at, m.handled_by,
             msg_attachments_json(m.id) as attachments,
             (select count(*) from msg_messages rr where rr.reply_to = m.id and rr.direction='to_driver' and rr.recalled_at is null) as replies
        from msg_messages m
       where m.direction = 'to_dispatch' and m.sender_kind = 'driver' and m.sender_id = v_id
         and m.created_at > now() - interval '7 days'
       order by m.id desc limit 30) y),'[]'::json)
  ) into result;
  return result;
end $$;

drop function if exists public.msg_mark(text,bigint,text,text);
create or replace function public.msg_mark(p_token text, p_message_id bigint, p_action text, p_reply text default null)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v_id text := drv_session_driver(p_token); m msg_messages%rowtype; v_reply text := left(trim(coalesce(p_reply,'')),200);
begin
  if v_id is null then return json_build_object('ok',false,'error','signed_out'); end if;
  select * into m from msg_messages where id = p_message_id and recalled_at is null;
  if not found or not exists (select 1 from msg_recipients where message_id = p_message_id and recipient_kind = 'driver' and recipient_id = v_id) then
    return json_build_object('ok',false,'error','Message not found.');
  end if;
  if p_action = 'read' then
    update msg_recipients set read_at = coalesce(read_at, now()), delivered_at = coalesce(delivered_at, now())
     where message_id = p_message_id and recipient_kind = 'driver' and recipient_id = v_id;
  elsif p_action = 'ack' then
    update msg_recipients set acked_at = coalesce(acked_at, now()), read_at = coalesce(read_at, now()), delivered_at = coalesce(delivered_at, now())
     where message_id = p_message_id and recipient_kind = 'driver' and recipient_id = v_id;
  elsif p_action = 'open' then
    update msg_recipients set opened_at = coalesce(opened_at, now()), read_at = coalesce(read_at, now()), delivered_at = coalesce(delivered_at, now())
     where message_id = p_message_id and recipient_kind = 'driver' and recipient_id = v_id;
  elsif p_action = 'reply' then
    if v_reply = '' then return json_build_object('ok',false,'error','Pick a reply.'); end if;
    if m.msg_type <> 'reply' or not (v_reply = any(m.reply_options)) then
      return json_build_object('ok',false,'error','That reply is not an option for this message.');
    end if;
    update msg_recipients set reply = v_reply, replied_at = now(), acked_at = coalesce(acked_at, now()),
           read_at = coalesce(read_at, now()), delivered_at = coalesce(delivered_at, now())
     where message_id = p_message_id and recipient_kind = 'driver' and recipient_id = v_id;
  else
    return json_build_object('ok',false,'error','Bad action.');
  end if;
  return json_build_object('ok',true);
end $$;

-- Driver -> dispatch. p_reply_to: a dispatch message this answers (optional).
create or replace function public.msg_driver_send(p_token text, p_topic text, p_body text,
                                                  p_lat double precision default null, p_lon double precision default null,
                                                  p_acc integer default null, p_reply_to bigint default null,
                                                  p_attachments uuid[] default null)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v_id text := drv_session_driver(p_token); v_topic text := left(trim(coalesce(p_topic,'')),40);
        v_body text := left(trim(coalesce(p_body,'')),1000); v_thread bigint; v_new bigint; v_recent int;
begin
  if v_id is null then return json_build_object('ok',false,'error','signed_out'); end if;
  if v_topic = '' and v_body = '' then return json_build_object('ok',false,'error','Pick a topic or type a message.'); end if;
  select count(*) into v_recent from msg_messages where direction='to_dispatch' and sender_id = v_id and created_at > now() - interval '1 hour';
  if v_recent >= 20 then return json_build_object('ok',false,'error','Too many messages this hour. Please call dispatch.'); end if;
  if p_reply_to is not null then
    select coalesce(m.thread_id, m.id) into v_thread from msg_messages m
      join msg_recipients r on r.message_id = m.id and r.recipient_kind='driver' and r.recipient_id = v_id
     where m.id = p_reply_to;
    if v_thread is null then return json_build_object('ok',false,'error','Message not found.'); end if;
  end if;
  insert into msg_messages (direction, sender_kind, sender_id, sender_name, audience_kind, audience_label, msg_type, body, topic,
                            lat, lon, loc_acc_m, reply_to, thread_id)
  values ('to_dispatch','driver', v_id, drv_display_name(v_id), 'driver', 'Dispatch', 'notice', v_body, nullif(v_topic,''),
          case when p_lat between -90 and 90 and p_lon between -180 and 180 then p_lat end,
          case when p_lat between -90 and 90 and p_lon between -180 and 180 then p_lon end,
          least(greatest(p_acc,0),100000), p_reply_to, v_thread)
  returning id into v_new;
  if v_thread is null then update msg_messages set thread_id = v_new where id = v_new; end if;
  perform msg_link_attachments(v_new, 'driver', v_id, p_attachments);
  return json_build_object('ok',true,'id',v_new);
end $$;

-- ---------------------------------------------------------------- dispatch side
drop function if exists public.msg_send(text,jsonb,text,text,text[],boolean,timestamptz,bigint);
create or replace function public.msg_send(p_token text, p_audience jsonb, p_type text, p_body text,
                                           p_reply_options text[] default '{}', p_urgent boolean default false,
                                           p_expires_at timestamptz default null, p_reminder_of bigint default null,
                                           p_reply_to bigint default null, p_attachments uuid[] default null)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v_mgr text := drv_session_manager(p_token); v_body text := trim(coalesce(p_body,''));
        v_opts text[]; v_label text; v_id bigint; n int; v_to text[]; v_thread bigint; v_files int := 0;
begin
  if v_mgr is null then return json_build_object('ok',false,'error','not_manager'); end if;
  if p_type not in ('notice','ack','reply') then return json_build_object('ok',false,'error','Bad message type.'); end if;
  if length(v_body) > 1000 then return json_build_object('ok',false,'error','Message must be 1000 characters or less.'); end if;
  if v_body = '' and coalesce(array_length(p_attachments,1),0) = 0 then return json_build_object('ok',false,'error','Type a message or attach a file.'); end if;
  select coalesce(array_agg(o order by i),'{}') into v_opts
    from (select left(trim(u.o),40) o, min(u.i) i
            from unnest(coalesce(p_reply_options,'{}')) with ordinality u(o,i)
           where trim(u.o) <> ''
           group by left(trim(u.o),40) order by min(u.i) limit 4) z;
  if p_type = 'reply' and array_length(v_opts,1) is null then
    return json_build_object('ok',false,'error','Add at least one quick reply.');
  end if;
  if p_type <> 'reply' then v_opts := '{}'; end if;

  if p_reply_to is not null then
    -- Reply to a driver's message: goes to that driver only, same thread.
    select array[m.sender_id], coalesce(m.thread_id, m.id) into v_to, v_thread
      from msg_messages m join drivers d on d.driver_id = m.sender_id and d.status='Active'
     where m.id = p_reply_to and m.direction = 'to_dispatch';
    if v_to is null then return json_build_object('ok',false,'error','That driver message was not found, or the driver is inactive.'); end if;
    v_label := drv_display_name(v_to[1]);
  elsif coalesce((p_audience->>'all')::boolean,false) then
    select array_agg(driver_id) into v_to from drivers where status='Active' and role in ('Driver','Other');
    v_label := 'Everyone';
  elsif p_audience ? 'locations' then
    select array_agg(driver_id) into v_to from drivers
      where status='Active' and role in ('Driver','Other')
        and location in (select jsonb_array_elements_text(p_audience->'locations'));
    select string_agg(x, ', ') into v_label from jsonb_array_elements_text(p_audience->'locations') x;
  elsif p_audience ? 'drivers' then
    select array_agg(driver_id) into v_to from drivers
      where status='Active' and driver_id in (select upper(jsonb_array_elements_text(p_audience->'drivers')));
    v_label := case when coalesce(array_length(v_to,1),0) = 1 then drv_display_name(v_to[1])
                    else coalesce(array_length(v_to,1),0)||' people' end;
  end if;
  n := coalesce(array_length(v_to,1),0);
  if n = 0 then return json_build_object('ok',false,'error','Nobody matches that audience.'); end if;

  insert into msg_messages (sender_id, sender_name, audience_label, msg_type, body, reply_options, urgent, expires_at,
                            reminder_of, reply_to, thread_id)
  values (v_mgr, drv_display_name(v_mgr), coalesce(v_label,''), p_type, v_body, v_opts, coalesce(p_urgent,false), p_expires_at,
          p_reminder_of, p_reply_to, v_thread)
  returning id into v_id;
  insert into msg_recipients (message_id, recipient_kind, recipient_id, recipient_name)
  select v_id, 'driver', t, drv_display_name(t) from unnest(v_to) t;
  v_files := msg_link_attachments(v_id, 'driver', v_mgr, p_attachments);
  if p_reply_to is not null then
    update msg_messages set dispatch_read_at = coalesce(dispatch_read_at, now()), dispatch_read_by = coalesce(dispatch_read_by, drv_display_name(v_mgr)),
                            handled_at = coalesce(handled_at, now()), handled_by = coalesce(handled_by, drv_display_name(v_mgr))
     where id = p_reply_to;
  end if;
  return json_build_object('ok',true,'id',v_id,'recipients',n,'files',v_files);
end $$;

create or replace function public.msg_sent(p_token text, p_days int default 30)
returns json language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if drv_session_manager(p_token) is null then return json_build_object('ok',false,'error','not_manager'); end if;
  return json_build_object('ok',true,'messages',coalesce((
    select json_agg(x order by x.created_at desc) from (
      select m.id, m.created_at, m.sender_name, m.audience_label, m.msg_type, m.body, m.reply_options, m.urgent,
             m.expires_at, m.recalled_at, m.reminder_of, m.reply_to,
             msg_attachments_json(m.id) as attachments,
             count(r.*) total, count(r.read_at) read, count(r.acked_at) acked, count(r.replied_at) replied, count(r.opened_at) opened
        from msg_messages m left join msg_recipients r on r.message_id = m.id
       where m.direction = 'to_driver' and m.audience_kind = 'driver'
         and m.created_at > now() - make_interval(days => least(greatest(coalesce(p_days,30),1),180))
       group by m.id) x),'[]'::json));
end $$;

create or replace function public.msg_detail(p_token text, p_message_id bigint)
returns json language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if drv_session_manager(p_token) is null then return json_build_object('ok',false,'error','not_manager'); end if;
  return json_build_object('ok',true,'recipients',coalesce((
    select json_agg(json_build_object('driver_id',r.recipient_id,'name',r.recipient_name,
             'location',coalesce(d.location,''),'delivered_at',r.delivered_at,'read_at',r.read_at,
             'acked_at',r.acked_at,'reply',r.reply,'replied_at',r.replied_at,'opened_at',r.opened_at)
             order by (r.acked_at is not null), (r.read_at is not null), r.recipient_name)
      from msg_recipients r left join drivers d on d.driver_id = r.recipient_id
     where r.message_id = p_message_id and r.recipient_kind = 'driver'),'[]'::json));
end $$;

-- Driver Inbox for the Message Center. p_view: 'open' (not done) | 'all'
create or replace function public.msg_dispatch_inbox(p_token text, p_view text default 'open', p_days int default 7)
returns json language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if drv_session_manager(p_token) is null then return json_build_object('ok',false,'error','not_manager'); end if;
  return json_build_object('ok',true,
    'unread',(select count(*) from msg_messages where direction='to_dispatch' and dispatch_read_at is null and created_at > now() - interval '30 days'),
    'open',(select count(*) from msg_messages where direction='to_dispatch' and handled_at is null and created_at > now() - interval '30 days'),
    'messages',coalesce((select json_agg(x order by x.created_at desc) from (
      select m.id, m.created_at, m.sender_id as driver_id, m.sender_name as driver_name, coalesce(d.location,'') as location,
             m.topic, m.body, m.lat, m.lon, m.loc_acc_m, m.dispatch_read_at, m.dispatch_read_by, m.handled_at, m.handled_by,
             m.reply_to, m.thread_id,
             (select json_build_object('body',left(o.body,160),'sender_name',o.sender_name,'created_at',o.created_at)
                from msg_messages o where o.id = m.reply_to) as in_reply_to,
             msg_attachments_json(m.id) as attachments,
             coalesce((select json_agg(json_build_object('id',rr.id,'created_at',rr.created_at,'sender_name',rr.sender_name,'body',rr.body,
                         'read_at',rc.read_at,'attachments',msg_attachments_json(rr.id)) order by rr.created_at)
                from msg_messages rr left join msg_recipients rc on rc.message_id = rr.id and rc.recipient_kind='driver'
               where rr.reply_to = m.id and rr.direction='to_driver' and rr.recalled_at is null),'[]'::json) as replies
        from msg_messages m left join drivers d on d.driver_id = m.sender_id
       where m.direction = 'to_dispatch'
         and m.created_at > now() - make_interval(days => least(greatest(coalesce(p_days,7),1),90))
         and (coalesce(p_view,'open') = 'all' or m.handled_at is null)
       order by m.id desc limit 200) x),'[]'::json));
end $$;

-- p_action: 'read' | 'done' | 'reopen'
create or replace function public.msg_dispatch_mark(p_token text, p_message_id bigint, p_action text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v_mgr text := drv_session_manager(p_token); v_name text;
begin
  if v_mgr is null then return json_build_object('ok',false,'error','not_manager'); end if;
  v_name := drv_display_name(v_mgr);
  if p_action = 'read' then
    update msg_messages set dispatch_read_at = coalesce(dispatch_read_at, now()), dispatch_read_by = coalesce(dispatch_read_by, v_name)
     where id = p_message_id and direction='to_dispatch';
  elsif p_action = 'done' then
    update msg_messages set dispatch_read_at = coalesce(dispatch_read_at, now()), dispatch_read_by = coalesce(dispatch_read_by, v_name),
                            handled_at = now(), handled_by = v_name
     where id = p_message_id and direction='to_dispatch';
  elsif p_action = 'reopen' then
    update msg_messages set handled_at = null, handled_by = null where id = p_message_id and direction='to_dispatch';
  else
    return json_build_object('ok',false,'error','Bad action.');
  end if;
  return json_build_object('ok',true);
end $$;

-- ---------------------------------------------------------------- grants
revoke all on function public.msg_attachments_json(bigint) from public, anon, authenticated;
revoke all on function public.msg_link_attachments(bigint,text,text,uuid[]) from public, anon, authenticated;
revoke all on function public.msg_file_register(text,text,text,int) from public, anon, authenticated;
revoke all on function public.msg_file_uploaded(uuid) from public, anon, authenticated;
revoke all on function public.msg_file_access(text,uuid) from public, anon, authenticated;
revoke all on function public.msg_file_expired() from public, anon, authenticated;
grant execute on function public.msg_file_register(text,text,text,int) to service_role;
grant execute on function public.msg_file_uploaded(uuid) to service_role;
grant execute on function public.msg_file_access(text,uuid) to service_role;
grant execute on function public.msg_file_expired() to service_role;

revoke all on function public.msg_mark(text,bigint,text,text) from public;
revoke all on function public.msg_driver_send(text,text,text,double precision,double precision,integer,bigint,uuid[]) from public;
revoke all on function public.msg_send(text,jsonb,text,text,text[],boolean,timestamptz,bigint,bigint,uuid[]) from public;
revoke all on function public.msg_dispatch_inbox(text,text,int) from public;
revoke all on function public.msg_dispatch_mark(text,bigint,text) from public;
grant execute on function public.msg_mark(text,bigint,text,text) to anon, authenticated;
grant execute on function public.msg_driver_send(text,text,text,double precision,double precision,integer,bigint,uuid[]) to anon, authenticated;
grant execute on function public.msg_send(text,jsonb,text,text,text[],boolean,timestamptz,bigint,bigint,uuid[]) to anon, authenticated;
grant execute on function public.msg_dispatch_inbox(text,text,int) to anon, authenticated;
grant execute on function public.msg_dispatch_mark(text,bigint,text) to anon, authenticated;
