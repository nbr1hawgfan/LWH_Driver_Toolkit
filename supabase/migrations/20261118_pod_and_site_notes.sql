-- Proof of Delivery + Customer Site Notes (Driver Toolkit v1.43.0) — project tjivcqxnkftujceumdtx
--
-- PROOF OF DELIVERY
--   Driver scans the signed BOL / delivery receipt in the Toolkit; the pages become one PDF that is
--   uploaded through the pod-file Edge Function into the private "pod-files" bucket. PODs are kept
--   (no 14-day expiry like message files) — they're billing records. Each upload also drops a
--   "Proof of delivery" message in the Driver Message Center inbox so dispatch sees it right away;
--   the PODs tab there searches, opens and marks them reviewed.
--   client_id makes uploads idempotent: a retry after a dropped connection never makes a duplicate.
--
-- CUSTOMER SITE NOTES
--   Notes hang off the Samsara address book (fleet_address_book, synced) so drivers can find the
--   customer they're at by name or "near me". Categories: hours, check-in, gate/door codes, parking,
--   docks, contacts, watch-outs, other. Drivers suggest; managers (role Manager) approve/edit in the
--   Message Center's Site Notes tab. A manager's own suggestion from the Toolkit goes straight in.
--
-- Same sign-in as Messages (Driver ID + PIN session token). Tables closed (RLS on, no policies).

-- ============================================================ POD
create table if not exists public.pod_deliveries (
  id            uuid primary key default gen_random_uuid(),
  client_id     text unique,
  driver_id     text not null,
  driver_name   text,
  load_no       text not null,
  customer      text,
  addr_id       text,
  delivered_at  timestamptz not null default now(),
  pallets       integer,
  condition     text not null default 'clean' check (condition in ('clean','short','over','damaged','refused')),
  note          text,
  lat           double precision,
  lon           double precision,
  loc_acc_m     integer,
  pages         integer,
  bytes         integer,
  storage_path  text not null unique,
  uploaded_at   timestamptz,
  created_at    timestamptz not null default now(),
  message_id    bigint references public.msg_messages(id) on delete set null,
  reviewed_at   timestamptz,
  reviewed_by   text
);
create index if not exists pod_deliveries_when_idx   on public.pod_deliveries (delivered_at desc) where uploaded_at is not null;
create index if not exists pod_deliveries_driver_idx on public.pod_deliveries (driver_id, delivered_at desc);
create index if not exists pod_deliveries_load_idx   on public.pod_deliveries (upper(load_no));
alter table public.pod_deliveries enable row level security;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pod-files','pod-files',false,20971520,array['application/pdf'])
on conflict (id) do update set public=false, file_size_limit=excluded.file_size_limit, allowed_mime_types=excluded.allowed_mime_types;

create or replace function public.pod_json(p public.pod_deliveries) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object('id',p.id,'driver_id',p.driver_id,'driver_name',p.driver_name,'load_no',p.load_no,
    'customer',p.customer,'addr_id',p.addr_id,'delivered_at',p.delivered_at,'pallets',p.pallets,'condition',p.condition,
    'note',p.note,'lat',p.lat,'lon',p.lon,'pages',p.pages,'bytes',p.bytes,'uploaded_at',p.uploaded_at,
    'reviewed_at',p.reviewed_at,'reviewed_by',p.reviewed_by);
$$;

-- Edge Function only (service role): reserve a path. p_meta = {client_id, load_no, customer, addr_id,
-- delivered_at, pallets, condition, note, lat, lon, acc, pages}
create or replace function public.pod_register(p_token text, p_meta jsonb, p_bytes int)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v_id text := drv_session_driver(p_token); p pod_deliveries%rowtype; n int; v_new uuid := gen_random_uuid();
        v_cid text := left(nullif(trim(coalesce(p_meta->>'client_id','')),''),80);
        v_load text := left(upper(trim(coalesce(p_meta->>'load_no',''))),40);
        v_cond text := lower(coalesce(nullif(p_meta->>'condition',''),'clean'));
        v_when timestamptz; v_lat double precision; v_lon double precision;
begin
  if v_id is null then return json_build_object('ok',false,'error','signed_out'); end if;
  if v_load = '' then return json_build_object('ok',false,'error','Enter the load or BOL number.'); end if;
  if p_bytes is null or p_bytes <= 0 or p_bytes > 20971520 then return json_build_object('ok',false,'error','The PDF must be under 20 MB.'); end if;
  if v_cond not in ('clean','short','over','damaged','refused') then v_cond := 'clean'; end if;
  if v_cid is not null then
    select * into p from pod_deliveries where client_id = v_cid;
    if found then
      if p.driver_id <> v_id then return json_build_object('ok',false,'error','Duplicate upload id.'); end if;
      if p.uploaded_at is not null then return json_build_object('ok',true,'dup',true,'id',p.id); end if;
      return json_build_object('ok',true,'id',p.id,'path',p.storage_path);   -- retry an unfinished upload
    end if;
  end if;
  select count(*) into n from pod_deliveries where driver_id = v_id and created_at > now() - interval '1 hour';
  if n >= 30 then return json_build_object('ok',false,'error','Too many uploads this hour. Call dispatch.'); end if;
  begin v_when := (p_meta->>'delivered_at')::timestamptz; exception when others then v_when := null; end;
  if v_when is null or v_when > now() + interval '1 hour' or v_when < now() - interval '30 days' then v_when := now(); end if;
  begin v_lat := (p_meta->>'lat')::double precision; v_lon := (p_meta->>'lon')::double precision; exception when others then v_lat := null; v_lon := null; end;
  if not (v_lat between -90 and 90 and v_lon between -180 and 180) then v_lat := null; v_lon := null; end if;
  insert into pod_deliveries (id, client_id, driver_id, driver_name, load_no, customer, addr_id, delivered_at, pallets, condition, note,
                              lat, lon, loc_acc_m, pages, bytes, storage_path)
  values (v_new, v_cid, v_id, drv_display_name(v_id), v_load, left(nullif(trim(coalesce(p_meta->>'customer','')),''),120),
          left(nullif(p_meta->>'addr_id',''),40), v_when,
          case when (p_meta->>'pallets') ~ '^\d{1,4}$' then (p_meta->>'pallets')::int end, v_cond,
          left(nullif(trim(coalesce(p_meta->>'note','')),''),500), v_lat, v_lon,
          case when (p_meta->>'acc') ~ '^\d{1,6}$' then (p_meta->>'acc')::int end,
          case when (p_meta->>'pages') ~ '^\d{1,3}$' then (p_meta->>'pages')::int end, p_bytes,
          to_char(now() at time zone 'America/Chicago','YYYY-MM') || '/' || v_new || '.pdf');
  return json_build_object('ok',true,'id',v_new,'path',(select storage_path from pod_deliveries where id = v_new));
end $$;

-- Edge Function only: mark uploaded and tell dispatch.
create or replace function public.pod_uploaded(p_id uuid)
returns json language plpgsql security definer set search_path = public as $$
declare p pod_deliveries%rowtype; v_msg bigint; v_body text;
begin
  select * into p from pod_deliveries where id = p_id for update;
  if not found then return json_build_object('ok',false,'error','not found'); end if;
  if p.uploaded_at is not null then return json_build_object('ok',true,'dup',true); end if;
  v_body := 'POD — Load '||p.load_no||coalesce(' · '||p.customer,'')||coalesce(' · '||p.pallets||' pallets','')
            ||coalesce(' · '||p.pages||' page'||case when p.pages = 1 then '' else 's' end,'')
            ||case when p.condition <> 'clean' then ' · '||upper(p.condition) else '' end
            ||coalesce(E'\n'||p.note,'')||E'\nOpen it in the PODs tab.';
  insert into msg_messages (direction, sender_kind, sender_id, sender_name, audience_kind, audience_label, msg_type, body, topic, lat, lon, loc_acc_m)
  values ('to_dispatch','driver', p.driver_id, coalesce(p.driver_name, p.driver_id), 'driver', 'Dispatch', 'notice', left(v_body,1000),
          'Proof of delivery', p.lat, p.lon, p.loc_acc_m)
  returning id into v_msg;
  update msg_messages set thread_id = v_msg where id = v_msg;
  update pod_deliveries set uploaded_at = now(), message_id = v_msg where id = p_id;
  return json_build_object('ok',true,'message_id',v_msg);
end $$;

-- Edge Function only: who may open a POD — managers, or the driver who sent it.
create or replace function public.pod_access(p_token text, p_id uuid)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v_id text := drv_session_driver(p_token); p pod_deliveries%rowtype;
begin
  if v_id is null then return json_build_object('ok',false,'error','signed_out'); end if;
  select * into p from pod_deliveries where id = p_id and uploaded_at is not null;
  if not found or (drv_session_manager(p_token) is null and p.driver_id <> v_id) then return json_build_object('ok',false,'error','POD not found.'); end if;
  return json_build_object('ok',true,'path',p.storage_path,'name','POD '||regexp_replace(p.load_no,'[^A-Za-z0-9_-]','_','g')||' '||to_char(p.delivered_at at time zone 'America/Chicago','YYYY-MM-DD')||'.pdf');
end $$;

-- App: drivers see their own (30 days); managers search everyone.
create or replace function public.pod_list(p_token text, p_q text default '', p_days int default 30, p_unreviewed boolean default false)
returns json language plpgsql stable security definer set search_path = public, extensions as $$
declare v_id text := drv_session_driver(p_token); v_mgr boolean; q text := upper(trim(coalesce(p_q,'')));
        d int := least(greatest(coalesce(p_days,30),1),730);
begin
  if v_id is null then return json_build_object('ok',false,'error','signed_out'); end if;
  v_mgr := drv_session_manager(p_token) is not null;
  return json_build_object('ok',true,'is_manager',v_mgr,
    'unreviewed', case when v_mgr then (select count(*) from pod_deliveries where uploaded_at is not null and reviewed_at is null) end,
    'pods', coalesce((select json_agg(pod_json(p) order by p.delivered_at desc) from (
      select * from pod_deliveries p
       where p.uploaded_at is not null
         and (v_mgr or p.driver_id = v_id)
         and p.delivered_at > now() - make_interval(days => case when v_mgr then d else least(d,30) end)
         and (not p_unreviewed or p.reviewed_at is null)
         and (q = '' or upper(p.load_no) like '%'||q||'%' or upper(coalesce(p.customer,'')) like '%'||q||'%'
              or upper(coalesce(p.driver_name,'')) like '%'||q||'%' or upper(p.driver_id) = q)
       order by p.delivered_at desc limit 300) p), '[]'::json));
end $$;

create or replace function public.pod_review(p_token text, p_id uuid, p_reviewed boolean)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v_mgr text := drv_session_manager(p_token);
begin
  if v_mgr is null then return json_build_object('ok',false,'error','not_manager'); end if;
  update pod_deliveries set reviewed_at = case when p_reviewed then now() end,
                            reviewed_by = case when p_reviewed then drv_display_name(v_mgr) end
   where id = p_id;
  return json_build_object('ok',true);
end $$;

-- ============================================================ SITE NOTES
create table if not exists public.site_notes (
  addr_id     text primary key,          -- fleet_address_book.id, or 'c-<uuid>' for a site not in Samsara
  name        text not null,
  address     text,
  lat         double precision,
  lon         double precision,
  notes       jsonb not null default '{}'::jsonb,   -- {hours, checkin, gate, parking, docks, contact, watch, other}
  updated_at  timestamptz not null default now(),
  updated_by  text
);
alter table public.site_notes enable row level security;

create table if not exists public.site_suggestions (
  id          bigint generated always as identity primary key,
  addr_id     text not null,
  site_name   text not null,
  site_addr   text,
  cat         text not null check (cat in ('hours','checkin','gate','parking','docks','contact','watch','other')),
  body        text not null check (length(body) between 1 and 600),
  driver_id   text not null,
  driver_name text,
  lat         double precision,
  lon         double precision,
  created_at  timestamptz not null default now(),
  status      text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_by text,
  reviewed_at timestamptz
);
create index if not exists site_suggestions_status_idx on public.site_suggestions (status, created_at desc);
alter table public.site_suggestions enable row level security;

create or replace function public.site_row_json(p_addr text, p_name text, p_address text, p_lat double precision, p_lon double precision,
                                                p_dist double precision, p_driver text)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object('addr_id',p_addr,'name',coalesce(s.name,p_name),'address',coalesce(s.address,p_address),
    'lat',coalesce(s.lat,p_lat),'lon',coalesce(s.lon,p_lon),'miles',case when p_dist is null then null else round(p_dist::numeric,1) end,
    'notes',coalesce(s.notes,'{}'::jsonb),'updated_at',s.updated_at,'updated_by',s.updated_by,
    'my_pending',(select count(*) from site_suggestions g where g.addr_id = p_addr and g.driver_id = p_driver and g.status='pending'))
    from (select 1) x left join site_notes s on s.addr_id = p_addr;
$$;

-- Search by name / address, or nearest to a point when the search is empty.
create or replace function public.site_search(p_token text, p_q text default '', p_lat double precision default null,
                                              p_lon double precision default null, p_only_noted boolean default false)
returns json language plpgsql stable security definer set search_path = public, extensions as $$
declare v_id text := drv_session_driver(p_token); q text := upper(trim(coalesce(p_q,'')));
begin
  if v_id is null then return json_build_object('ok',false,'error','signed_out'); end if;
  return json_build_object('ok',true,'sites',coalesce((select json_agg(site_row_json(x.id,x.name,x.addr,x.lat,x.lon,x.dist,v_id) order by x.rank, x.dist nulls last, x.name) from (
    select id, name, addr, lat, lon, dist,
           case when q = '' then 0 when upper(name) like q||'%' then 0 else 1 end rank
      from (
        select f.id, f.name, f.formatted_address addr, f.latitude lat, f.longitude lon from fleet_address_book f
        union all
        select s.addr_id, s.name, s.address, s.lat, s.lon from site_notes s where s.addr_id like 'c-%'
      ) a
      cross join lateral (select case when p_lat is null or a.lat is null then null else
             3958.8*2*asin(sqrt(power(sin(radians(a.lat-p_lat)/2),2)+cos(radians(p_lat))*cos(radians(a.lat))*power(sin(radians(a.lon-p_lon)/2),2))) end dist) dd
     where (q = '' or upper(a.name) like '%'||q||'%' or upper(coalesce(a.addr,'')) like '%'||q||'%')
       and (not coalesce(p_only_noted,false) or exists (select 1 from site_notes s2 where s2.addr_id = a.id and s2.notes <> '{}'::jsonb))
       and (q <> '' or p_lat is not null or coalesce(p_only_noted,false))
     order by rank, dist nulls last, name limit 40) x), '[]'::json));
end $$;

-- Driver suggests a note. A manager's goes straight in (appended to that category).
create or replace function public.site_suggest(p_token text, p_addr_id text, p_cat text, p_text text,
                                               p_new_name text default null, p_new_address text default null,
                                               p_lat double precision default null, p_lon double precision default null)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v_id text := drv_session_driver(p_token); v_mgr boolean; v_addr text := nullif(trim(coalesce(p_addr_id,'')),'');
        v_name text; v_address text; v_slat double precision; v_slon double precision; t text := left(trim(coalesce(p_text,'')),600); n int;
begin
  if v_id is null then return json_build_object('ok',false,'error','signed_out'); end if;
  v_mgr := drv_session_manager(p_token) is not null;
  if t = '' then return json_build_object('ok',false,'error','Type the note.'); end if;
  if p_cat not in ('hours','checkin','gate','parking','docks','contact','watch','other') then return json_build_object('ok',false,'error','Pick what the note is about.'); end if;
  select count(*) into n from site_suggestions where driver_id = v_id and created_at > now() - interval '1 hour';
  if n >= 20 then return json_build_object('ok',false,'error','Too many notes this hour.'); end if;
  if v_addr is null then
    -- A place that isn't in Samsara's address book.
    v_name := left(trim(coalesce(p_new_name,'')),120);
    if v_name = '' then return json_build_object('ok',false,'error','Type the customer / site name.'); end if;
    v_addr := 'c-'||gen_random_uuid();
    v_address := left(nullif(trim(coalesce(p_new_address,'')),''),200);
    v_slat := case when p_lat between -90 and 90 then p_lat end; v_slon := case when p_lon between -180 and 180 then p_lon end;
    insert into site_notes (addr_id, name, address, lat, lon, notes, updated_by) values (v_addr, v_name, v_address, v_slat, v_slon, '{}'::jsonb, drv_display_name(v_id));
  else
    select coalesce(s.name,f.name), coalesce(s.address,f.formatted_address), coalesce(s.lat,f.latitude), coalesce(s.lon,f.longitude)
      into v_name, v_address, v_slat, v_slon
      from (select v_addr id) k left join fleet_address_book f on f.id = k.id left join site_notes s on s.addr_id = k.id;
    if v_name is null then return json_build_object('ok',false,'error','Site not found.'); end if;
  end if;
  insert into site_suggestions (addr_id, site_name, site_addr, cat, body, driver_id, driver_name, lat, lon, status, reviewed_by, reviewed_at)
  values (v_addr, v_name, v_address, p_cat, t, v_id, drv_display_name(v_id),
          case when p_lat between -90 and 90 then p_lat end, case when p_lon between -180 and 180 then p_lon end,
          case when v_mgr then 'approved' else 'pending' end, case when v_mgr then drv_display_name(v_id) end, case when v_mgr then now() end);
  if v_mgr then perform site_apply(v_addr, v_name, v_address, v_slat, v_slon, p_cat, t, drv_display_name(v_id), true); end if;
  return json_build_object('ok',true,'addr_id',v_addr,'applied',v_mgr);
end $$;

-- internal: write a category (append or replace).
create or replace function public.site_apply(p_addr text, p_name text, p_address text, p_lat double precision, p_lon double precision,
                                             p_cat text, p_text text, p_by text, p_append boolean)
returns void language plpgsql security definer set search_path = public as $$
declare cur text;
begin
  insert into site_notes (addr_id, name, address, lat, lon, notes, updated_by)
  values (p_addr, p_name, p_address, p_lat, p_lon, '{}'::jsonb, p_by)
  on conflict (addr_id) do nothing;
  select notes->>p_cat into cur from site_notes where addr_id = p_addr;
  update site_notes
     set notes = case when coalesce(trim(case when p_append and coalesce(cur,'') <> '' then cur||E'\n'||p_text else p_text end),'') = ''
                      then notes - p_cat
                      else jsonb_set(notes, array[p_cat], to_jsonb(case when p_append and coalesce(cur,'') <> '' then cur||E'\n'||p_text else p_text end)) end,
         updated_at = now(), updated_by = p_by
   where addr_id = p_addr;
end $$;

-- Managers: pending suggestions (with the site's current text for that category).
create or replace function public.site_pending(p_token text)
returns json language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if drv_session_manager(p_token) is null then return json_build_object('ok',false,'error','not_manager'); end if;
  return json_build_object('ok',true,'items',coalesce((select json_agg(json_build_object('id',g.id,'addr_id',g.addr_id,'site_name',g.site_name,
      'site_addr',g.site_addr,'cat',g.cat,'body',g.body,'driver_name',g.driver_name,'created_at',g.created_at,
      'current',(select s.notes->>g.cat from site_notes s where s.addr_id = g.addr_id)) order by g.created_at)
    from site_suggestions g where g.status = 'pending'),'[]'::json));
end $$;

-- Managers: approve (p_text = final text for that category, replaces it) or reject.
create or replace function public.site_review(p_token text, p_id bigint, p_action text, p_text text default null)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v_mgr text := drv_session_manager(p_token); g site_suggestions%rowtype; f fleet_address_book%rowtype;
begin
  if v_mgr is null then return json_build_object('ok',false,'error','not_manager'); end if;
  select * into g from site_suggestions where id = p_id for update;
  if not found or g.status <> 'pending' then return json_build_object('ok',false,'error','Already handled.'); end if;
  if p_action = 'approve' then
    select * into f from fleet_address_book where id = g.addr_id;
    perform site_apply(g.addr_id, coalesce(f.name,g.site_name), coalesce(f.formatted_address,g.site_addr), f.latitude, f.longitude,
                       g.cat, left(coalesce(p_text,g.body),2000), drv_display_name(v_mgr), p_text is null);
    update site_suggestions set status='approved', reviewed_by=drv_display_name(v_mgr), reviewed_at=now() where id = p_id;
  elsif p_action = 'reject' then
    update site_suggestions set status='rejected', reviewed_by=drv_display_name(v_mgr), reviewed_at=now() where id = p_id;
  else return json_build_object('ok',false,'error','Bad action.'); end if;
  return json_build_object('ok',true);
end $$;

-- Managers: replace a site's notes outright. p_notes = {cat: text, ...}; empty text removes a category.
create or replace function public.site_edit(p_token text, p_addr_id text, p_notes jsonb)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v_mgr text := drv_session_manager(p_token); k text; f fleet_address_book%rowtype; s site_notes%rowtype;
begin
  if v_mgr is null then return json_build_object('ok',false,'error','not_manager'); end if;
  select * into s from site_notes where addr_id = p_addr_id;
  select * into f from fleet_address_book where id = p_addr_id;
  if s.addr_id is null and f.id is null then return json_build_object('ok',false,'error','Site not found.'); end if;
  for k in select jsonb_object_keys(coalesce(p_notes,'{}'::jsonb)) loop
    if k in ('hours','checkin','gate','parking','docks','contact','watch','other') then
      perform site_apply(p_addr_id, coalesce(s.name,f.name), coalesce(s.address,f.formatted_address), coalesce(s.lat,f.latitude), coalesce(s.lon,f.longitude),
                         k, left(coalesce(p_notes->>k,''),2000), drv_display_name(v_mgr), false);
    end if;
  end loop;
  return json_build_object('ok',true);
end $$;

-- ============================================================ access
do $$
declare f text;
begin
  foreach f in array array['pod_list(text,text,integer,boolean)','pod_review(text,uuid,boolean)',
    'site_search(text,text,double precision,double precision,boolean)',
    'site_suggest(text,text,text,text,text,text,double precision,double precision)',
    'site_pending(text)','site_review(text,bigint,text,text)','site_edit(text,text,jsonb)']
  loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated', f);
  end loop;
  foreach f in array array['pod_json(public.pod_deliveries)','pod_register(text,jsonb,integer)','pod_uploaded(uuid)','pod_access(text,uuid)',
    'site_row_json(text,text,text,double precision,double precision,double precision,text)',
    'site_apply(text,text,text,double precision,double precision,text,text,text,boolean)']
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;
