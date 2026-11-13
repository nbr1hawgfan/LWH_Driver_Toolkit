-- Driver Time Clock (Driver Toolkit v1.42.0) — project tjivcqxnkftujceumdtx (LWH Companion)
--
-- Drivers clock in / out on their own phone (or a shared tablet): pick their name, type the
-- same PIN they use in the PTO tracker, tap Clock In / Clock Out. Lunch = a second out/in pair.
-- Each punch saves the phone's GPS position and the nearest LWH site.
--
-- PINs:   the PTO tracker's Apps Script pushes Transportation PINs here (tc_sync_pins), hashed on
--         arrival; nothing here stores a PIN in plain text.
-- TLand:  Sync-DriverClock.ps1 on APP02 pulls finished days with tc_export (secret key), and
--         TLand's usp_DriverHoursClockPrefill puts them in the Driver Hours tool (source CLOCK).
--
-- Everything goes through SECURITY DEFINER functions called with the publishable key. Tables
-- have RLS on and no policies, so nothing is readable directly.

-- ---------------------------------------------------------------- tables
create table if not exists public.tc_pins (
  pto_employee_id  text primary key,                  -- PTO tracker Employee ID, e.g. BAY01
  pto_name         text not null default '',
  driver_id        text references public.drivers(driver_id) on update cascade on delete set null,
  pin_hash         text,                              -- bcrypt; null = no PIN in the tracker
  failed_attempts  int  not null default 0,
  locked_until     timestamptz,
  synced_at        timestamptz not null default now()
);
create index if not exists tc_pins_driver_idx on public.tc_pins (driver_id);

-- Only when the PTO tracker name can't be matched to the driver list automatically.
create table if not exists public.tc_pin_map (
  driver_id        text primary key references public.drivers(driver_id) on update cascade on delete cascade,
  pto_employee_id  text not null unique,
  note             text
);
insert into public.tc_pin_map (driver_id, pto_employee_id, note)
select 'BMARR', 'MARRS01', 'Tracker spells it Marrs'
 where exists (select 1 from public.drivers where driver_id = 'BMARR')
on conflict do nothing;

create table if not exists public.tc_devices (            -- remembered phone/tablet per driver (for offline punches)
  token_hash  text primary key,
  driver_id   text not null references public.drivers(driver_id) on update cascade on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  last_used   timestamptz
);
create index if not exists tc_devices_driver_idx on public.tc_devices (driver_id);

create table if not exists public.tc_punches (
  id           bigint generated always as identity primary key,
  driver_id    text not null references public.drivers(driver_id) on update cascade,
  punch_type   text not null check (punch_type in ('in','out')),
  punched_at   timestamptz not null,                  -- the time that counts
  received_at  timestamptz not null default now(),
  device_at    timestamptz,                           -- the phone's clock when tapped
  offline      boolean not null default false,        -- tapped with no signal, sent later
  client_id    text unique,                           -- from the phone, so a resend never doubles
  lat          double precision,
  lon          double precision,
  accuracy_m   real,
  near_site    text,
  near_m       int,                                   -- metres from that site (0 = inside it)
  voided_at    timestamptz,
  voided_by    text,
  void_reason  text
);
create index if not exists tc_punches_driver_time_idx on public.tc_punches (driver_id, punched_at);
create index if not exists tc_punches_time_idx on public.tc_punches (punched_at);

create table if not exists public.tc_sync_meta (
  id                 int primary key check (id = 1),
  pin_secret_hash    text,     -- sha256 of the key in the PTO tracker's TimeClock_PinPush.gs
  export_secret_hash text,     -- sha256 of the key in Sync-DriverClock.ps1's config
  last_pin_push      timestamptz,
  last_pin_counts    jsonb,
  last_export        timestamptz
);
insert into public.tc_sync_meta (id) values (1) on conflict do nothing;

alter table public.tc_pins      enable row level security;
alter table public.tc_pin_map   enable row level security;
alter table public.tc_devices   enable row level security;
alter table public.tc_punches   enable row level security;
alter table public.tc_sync_meta enable row level security;

-- ---------------------------------------------------------------- helpers (not callable by the app)
create or replace function public.tc_local(ts timestamptz)
returns timestamp language sql immutable as $$ select ts at time zone 'America/Chicago' $$;

create or replace function public.tc_dist_m(lat1 double precision, lon1 double precision, lat2 double precision, lon2 double precision)
returns double precision language sql immutable as $$
  select 2 * 6371000 * asin(sqrt(
           power(sin(radians(lat2 - lat1) / 2), 2) +
           cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lon2 - lon1) / 2), 2)))
$$;

-- Nearest active fleet site: centre + radius (or polygon centroid + farthest corner).
create or replace function public.tc_nearest_site(p_lat double precision, p_lon double precision, out site text, out dist_m int)
language plpgsql stable security definer set search_path = public as $$
declare r record; v record; c_lat double precision; c_lon double precision; rad double precision; d double precision; best double precision;
begin
  if p_lat is null or p_lon is null then return; end if;
  for r in select name, geofence_cache, center_lat, center_lng, radius_m from fleet_sites where active loop
    if r.center_lat is not null then
      c_lat := r.center_lat; c_lon := r.center_lng; rad := coalesce(r.radius_m, 150);
    elsif r.geofence_cache is not null then
      select avg((v2.value->>'latitude')::float8), avg((v2.value->>'longitude')::float8) into c_lat, c_lon
        from jsonb_array_elements(r.geofence_cache->'shapes') s, jsonb_array_elements(s.value->'vertices') v2;
      if c_lat is null then continue; end if;
      select max(tc_dist_m(c_lat, c_lon, (v2.value->>'latitude')::float8, (v2.value->>'longitude')::float8)) into rad
        from jsonb_array_elements(r.geofence_cache->'shapes') s, jsonb_array_elements(s.value->'vertices') v2;
    else continue;
    end if;
    d := greatest(0, tc_dist_m(p_lat, p_lon, c_lat, c_lon) - rad);
    if best is null or d < best then best := d; site := r.name; end if;
  end loop;
  dist_m := round(best);
end $$;

create or replace function public.tc_driver_for_pin(p_driver_id text)
returns public.tc_pins language sql stable security definer set search_path = public as $$
  select p.* from tc_pins p where p.driver_id = p_driver_id and p.pin_hash is not null
  order by p.synced_at desc limit 1;
$$;

-- PIN check with lockout (5 wrong = 15 minutes). Returns null when OK, else the message.
create or replace function public.tc_check_pin(p_driver_id text, p_pin text)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare p tc_pins%rowtype;
begin
  if not exists (select 1 from drivers where driver_id = p_driver_id and status = 'Active') then
    return 'Pick your name from the list.';
  end if;
  select * into p from tc_pins where driver_id = p_driver_id and pin_hash is not null order by synced_at desc limit 1 for update;
  if not found then
    return 'No PIN on file for you yet. Ask Chris to set your PIN in the PTO tracker (same PIN you use for time off).';
  end if;
  if p.locked_until is not null and p.locked_until > now() then
    return 'Too many wrong PINs. Wait 15 minutes, then try again.';
  end if;
  if p.pin_hash <> crypt(coalesce(p_pin,''), p.pin_hash) then
    update tc_pins set failed_attempts = failed_attempts + 1,
           locked_until = case when failed_attempts + 1 >= 5 then now() + interval '15 minutes' end
     where pto_employee_id = p.pto_employee_id;
    return 'That PIN is not right. Use the same PIN as the PTO / time off app.';
  end if;
  update tc_pins set failed_attempts = 0, locked_until = null where pto_employee_id = p.pto_employee_id;
  return null;
end $$;

create or replace function public.tc_new_device(p_driver_id text)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare tok text := encode(gen_random_bytes(24), 'hex');
begin
  insert into tc_devices (token_hash, driver_id, expires_at, last_used)
  values (encode(digest(tok,'sha256'),'hex'), p_driver_id, now() + interval '120 days', now());
  delete from tc_devices where expires_at < now();
  return tok;
end $$;

create or replace function public.tc_device_driver(p_token text)
returns text language sql stable security definer set search_path = public, extensions as $$
  select t.driver_id from tc_devices t join drivers d on d.driver_id = t.driver_id and d.status = 'Active'
   where t.token_hash = encode(digest(coalesce(p_token,''),'sha256'),'hex') and t.expires_at > now();
$$;

-- Shifts = an IN paired with the OUT right after it. Work date = the day the shift started
-- (Central time). status: ok | long (over 14 hrs) | open (on the clock now) |
-- missing_out (an IN with no OUT, over 16 hrs old or followed by another IN) |
-- missing_in (an OUT with no IN before it).
create or replace function public.tc_shifts(p_from date, p_to date, p_driver text default null)
returns table (driver_id text, work_date date, in_id bigint, out_id bigint, in_at timestamptz, out_at timestamptz,
               minutes numeric, status text, in_site text, in_site_m int, out_site text, out_site_m int,
               no_gps boolean, sent_late boolean)
language sql stable security definer set search_path = public as $$
  with p as (
    select t.* from tc_punches t
     where t.voided_at is null
       and (p_driver is null or t.driver_id = p_driver)
       and t.punched_at >= (p_from::timestamp - interval '1 day') at time zone 'America/Chicago'
       and t.punched_at <  (p_to::timestamp   + interval '3 day') at time zone 'America/Chicago'
  ), s as (
    select p.*,
           lead(p.id)         over w as n_id,  lead(p.punch_type) over w as n_type,
           lead(p.punched_at) over w as n_at,  lead(p.near_site)  over w as n_site,
           lead(p.near_m)     over w as n_m,   lead(p.lat)        over w as n_lat,
           lead(p.offline)    over w as n_off,
           lag(p.punch_type)  over w as p_type
      from p window w as (partition by p.driver_id order by p.punched_at, p.id)
  ), x as (
    select s.driver_id, tc_local(s.punched_at)::date as work_date, s.id as in_id,
           case when s.n_type = 'out' then s.n_id end as out_id,
           s.punched_at as in_at,
           case when s.n_type = 'out' then s.n_at end as out_at,
           case when s.n_type = 'out' then round(extract(epoch from (s.n_at - s.punched_at)) / 60.0, 2) else 0 end as minutes,
           case when s.n_type = 'out' and s.n_at - s.punched_at > interval '14 hours' then 'long'
                when s.n_type = 'out' then 'ok'
                when s.n_type is null and now() - s.punched_at < interval '16 hours' then 'open'
                else 'missing_out' end as status,
           s.near_site as in_site, s.near_m as in_site_m,
           case when s.n_type = 'out' then s.n_site end as out_site,
           case when s.n_type = 'out' then s.n_m end as out_site_m,
           (s.lat is null or (s.n_type = 'out' and s.n_lat is null)) as no_gps,
           (s.offline or (s.n_type = 'out' and coalesce(s.n_off, false))) as sent_late
      from s where s.punch_type = 'in'
    union all
    select s.driver_id, tc_local(s.punched_at)::date, null::bigint, s.id, null::timestamptz, s.punched_at, 0::numeric, 'missing_in'::text,
           null::text, null::int, s.near_site, s.near_m, s.lat is null, s.offline
      from s where s.punch_type = 'out' and (s.p_type is null or s.p_type = 'out')
  )
  select * from x where x.work_date between p_from and p_to;
$$;

-- One row per driver per work day: hours rounded DOWN to 0.05 (same rule as Samsara, 8.53 -> 8.50),
-- a review flag, and a one-line summary of the punches for the Driver Hours tool.
create or replace function public.tc_days(p_from date, p_to date, p_driver text default null)
returns table (driver_id text, work_date date, hours numeric, raw_hours numeric, needs_review boolean,
               on_clock boolean, flags text[], detail text)
language sql stable security definer set search_path = public as $$
  with sh as (select * from tc_shifts(p_from, p_to, p_driver))
  select sh.driver_id, sh.work_date,
         (floor(sum(case when sh.status in ('ok','long') then sh.minutes else 0 end) / 60.0 * 20 + 0.0000001) / 20.0)::numeric(6,2) as hours,
         round(sum(case when sh.status in ('ok','long') then sh.minutes else 0 end) / 60.0, 2)::numeric(6,2) as raw_hours,
         bool_or(sh.status in ('long','missing_out','missing_in')) as needs_review,
         bool_or(sh.status = 'open') as on_clock,
         array_remove(array[
           case when bool_or(sh.status = 'missing_out') then 'No clock-out' end,
           case when bool_or(sh.status = 'missing_in')  then 'No clock-in'  end,
           case when bool_or(sh.status = 'long')        then 'Over 14 hrs'  end,
           case when bool_or(sh.no_gps)                 then 'No GPS'       end,
           case when bool_or(sh.sent_late)              then 'Sent later (no signal)' end
         ], null) as flags,
         left(string_agg(
           coalesce(to_char(tc_local(sh.in_at), 'FMHH12:MIam'), '?') || '-' ||
           case when sh.status = 'open' then 'now' else coalesce(to_char(tc_local(sh.out_at), 'FMHH12:MIam'), '?') end ||
           coalesce(' @' || coalesce(sh.in_site, sh.out_site) ||
                    case when coalesce(sh.in_site_m, sh.out_site_m) > 400 then ' ' || round(coalesce(sh.in_site_m, sh.out_site_m) / 1609.34, 1) || 'mi away' else '' end, ''),
           ', ' order by coalesce(sh.in_at, sh.out_at)), 300) as detail
    from sh
   group by sh.driver_id, sh.work_date;
$$;

create or replace function public.tc_week_start(d date)
returns date language sql immutable as $$ select d - extract(dow from d)::int $$;

-- What the driver sees after a good PIN / on the board.
create or replace function public.tc_driver_status(p_driver_id text)
returns json language plpgsql stable security definer set search_path = public as $$
declare v_today date := tc_local(now())::date; v_last tc_punches%rowtype; v_ws date := tc_week_start(tc_local(now())::date);
begin
  select * into v_last from tc_punches where driver_id = p_driver_id and voided_at is null
   order by punched_at desc, id desc limit 1;
  return json_build_object(
    'driver_id', p_driver_id,
    'name', drv_display_name(p_driver_id),
    'last_type', v_last.punch_type,
    'last_at', v_last.punched_at,
    'on_clock', v_last.punch_type = 'in' and now() - v_last.punched_at < interval '16 hours',
    'stale_in', v_last.punch_type = 'in' and now() - v_last.punched_at >= interval '16 hours',
    'today', coalesce((select json_agg(json_build_object('type', t.punch_type, 'at', t.punched_at, 'site', t.near_site, 'offline', t.offline) order by t.punched_at)
                         from tc_punches t where t.driver_id = p_driver_id and t.voided_at is null
                          and t.punched_at >= least(v_today::timestamp at time zone 'America/Chicago',
                                                    case when v_last.punch_type = 'in' and now() - v_last.punched_at < interval '16 hours'
                                                         then v_last.punched_at else 'infinity'::timestamptz end)),
                      '[]'::json),
    'week_start', v_ws,
    'week', coalesce((select json_agg(json_build_object('date', d.work_date, 'hours', d.hours, 'on_clock', d.on_clock, 'flags', d.flags) order by d.work_date)
                        from tc_days(v_ws, v_ws + 6, p_driver_id) d), '[]'::json)
  );
end $$;

revoke all on function public.tc_local(timestamptz) from public, anon, authenticated;
revoke all on function public.tc_dist_m(double precision,double precision,double precision,double precision) from public, anon, authenticated;
revoke all on function public.tc_nearest_site(double precision,double precision) from public, anon, authenticated;
revoke all on function public.tc_driver_for_pin(text) from public, anon, authenticated;
revoke all on function public.tc_check_pin(text,text) from public, anon, authenticated;
revoke all on function public.tc_new_device(text) from public, anon, authenticated;
revoke all on function public.tc_device_driver(text) from public, anon, authenticated;
revoke all on function public.tc_shifts(date,date,text) from public, anon, authenticated;
revoke all on function public.tc_days(date,date,text) from public, anon, authenticated;
revoke all on function public.tc_week_start(date) from public, anon, authenticated;
revoke all on function public.tc_driver_status(text) from public, anon, authenticated;

-- ---------------------------------------------------------------- app RPCs (drivers)
-- Names for the pick list: active drivers, and whether a PIN is on file.
create or replace function public.tc_roster()
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object('driver_id', d.driver_id, 'name', coalesce(nullif(trim(d.goes_by),''), d.name),
                                             'location', d.location,
                                             'has_pin', exists (select 1 from tc_pins p where p.driver_id = d.driver_id and p.pin_hash is not null))
                           order by coalesce(nullif(trim(d.goes_by),''), d.name)), '[]'::json)
    from drivers d where d.status = 'Active' and d.role = 'Driver';
$$;

-- Name + PIN -> current status. Also gives this phone a device token (or renews the one it sent)
-- so a punch made later with no signal can still be accepted (the app checks the PIN on the phone then).
create or replace function public.tc_check(p_driver_id text, p_pin text, p_device text default null)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v_id text := upper(trim(coalesce(p_driver_id,''))); msg text; v_tok text;
begin
  msg := tc_check_pin(v_id, p_pin);
  if msg is not null then return json_build_object('ok', false, 'error', msg); end if;
  if p_device is not null and tc_device_driver(p_device) = v_id then
    update tc_devices set last_used = now(), expires_at = now() + interval '120 days'
     where token_hash = encode(digest(p_device,'sha256'),'hex');
    v_tok := p_device;
  else
    v_tok := tc_new_device(v_id);
  end if;
  return json_build_object('ok', true, 'device', v_tok, 'status', tc_driver_status(v_id));
end $$;

-- Record a punch. Online: driver + PIN. Queued offline: driver + device token from tc_check, plus
-- the time it was tapped (accepted if within the last 24 hrs; otherwise the time it arrived).
create or replace function public.tc_punch(p_driver_id text, p_type text, p_pin text default null, p_device text default null,
                                           p_client_id text default null, p_device_at timestamptz default null,
                                           p_lat double precision default null, p_lon double precision default null,
                                           p_accuracy real default null)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v_id text := upper(trim(coalesce(p_driver_id,''))); msg text; v_at timestamptz; v_off boolean := false;
        v_site text; v_m int; v_new tc_punches%rowtype; v_last tc_punches%rowtype;
begin
  if p_type not in ('in','out') then return json_build_object('ok', false, 'error', 'bad_type'); end if;
  if p_client_id is not null and exists (select 1 from tc_punches where client_id = p_client_id) then
    return json_build_object('ok', true, 'duplicate', true, 'status', tc_driver_status(v_id));
  end if;
  if p_pin is not null then
    msg := tc_check_pin(v_id, p_pin);
    if msg is not null then return json_build_object('ok', false, 'error', msg); end if;
  elsif p_device is not null then
    if tc_device_driver(p_device) is distinct from v_id then
      return json_build_object('ok', false, 'error', 'This phone needs your PIN again. Open Time Clock and enter it.', 'device_expired', true);
    end if;
    update tc_devices set last_used = now() where token_hash = encode(digest(p_device,'sha256'),'hex');
  else
    return json_build_object('ok', false, 'error', 'Enter your PIN.');
  end if;

  v_at := now();
  if p_device_at is not null and p_device_at <= now() + interval '2 minutes' and p_device_at > now() - interval '24 hours' then
    if now() - p_device_at > interval '3 minutes' then v_off := true; v_at := p_device_at; end if;
  end if;

  -- double tap: same punch within 60 seconds is the same punch
  select * into v_last from tc_punches where driver_id = v_id and voided_at is null order by punched_at desc, id desc limit 1;
  if found and v_last.punch_type = p_type and abs(extract(epoch from (v_at - v_last.punched_at))) < 60 then
    return json_build_object('ok', true, 'duplicate', true, 'status', tc_driver_status(v_id));
  end if;

  select site, dist_m into v_site, v_m from tc_nearest_site(p_lat, p_lon);
  insert into tc_punches (driver_id, punch_type, punched_at, device_at, offline, client_id, lat, lon, accuracy_m, near_site, near_m)
  values (v_id, p_type, v_at, p_device_at, v_off, nullif(left(p_client_id, 64), ''),
          case when p_lat between -90 and 90 then p_lat end, case when p_lon between -180 and 180 then p_lon end,
          p_accuracy, v_site, v_m)
  returning * into v_new;
  return json_build_object('ok', true, 'punch', json_build_object('id', v_new.id, 'type', v_new.punch_type, 'at', v_new.punched_at,
                                                                  'site', v_new.near_site, 'site_m', v_new.near_m, 'offline', v_new.offline),
                           'status', tc_driver_status(v_id));
end $$;

grant execute on function public.tc_roster() to anon, authenticated;
grant execute on function public.tc_check(text,text,text) to anon, authenticated;
grant execute on function public.tc_punch(text,text,text,text,text,timestamptz,double precision,double precision,real) to anon, authenticated;

-- ---------------------------------------------------------------- manager RPCs (Driver Messages sign-in, role Manager)
-- Who is on the clock and the punches for one day.
create or replace function public.tc_board(p_token text, p_date date default null)
returns json language plpgsql stable security definer set search_path = public as $$
declare v_mgr text := drv_session_manager(p_token); v_d date := coalesce(p_date, tc_local(now())::date);
begin
  if v_mgr is null then return json_build_object('ok', false, 'error', 'signed_out'); end if;
  return json_build_object('ok', true, 'date', v_d,
    'rows', coalesce((
      select json_agg(r order by r->>'name') from (
        select json_build_object(
          'driver_id', d.driver_id, 'name', coalesce(nullif(trim(d.goes_by),''), d.name), 'location', d.location,
          'has_pin', exists (select 1 from tc_pins p where p.driver_id = d.driver_id and p.pin_hash is not null),
          'hours', y.hours, 'on_clock', y.on_clock, 'flags', y.flags, 'detail', y.detail,
          'punches', (select json_agg(json_build_object('type', t.punch_type, 'at', t.punched_at, 'site', t.near_site, 'site_m', t.near_m,
                                                        'lat', t.lat, 'lon', t.lon, 'acc', t.accuracy_m, 'offline', t.offline) order by t.punched_at)
                        from tc_punches t where t.driver_id = d.driver_id and t.voided_at is null and tc_local(t.punched_at)::date = v_d)
        ) as r
        from drivers d
        left join tc_days(v_d, v_d) y on y.driver_id = d.driver_id
        where d.status = 'Active' and d.role = 'Driver'
      ) z), '[]'::json));
end $$;

-- A Sun-Sat week: hours per driver per day, with flags and the punch summary.
create or replace function public.tc_week(p_token text, p_week_start date default null)
returns json language plpgsql stable security definer set search_path = public as $$
declare v_mgr text := drv_session_manager(p_token); v_ws date := tc_week_start(coalesce(p_week_start, tc_local(now())::date));
begin
  if v_mgr is null then return json_build_object('ok', false, 'error', 'signed_out'); end if;
  return json_build_object('ok', true, 'week_start', v_ws,
    'days', coalesce((select json_agg(json_build_object('driver_id', y.driver_id, 'name', drv_display_name(y.driver_id),
                                                        'date', y.work_date, 'hours', y.hours, 'on_clock', y.on_clock,
                                                        'needs_review', y.needs_review, 'flags', y.flags, 'detail', y.detail)
                                      order by drv_display_name(y.driver_id), y.work_date)
                        from tc_days(v_ws, v_ws + 6) y), '[]'::json),
    'no_pin', coalesce((select json_agg(coalesce(nullif(trim(d.goes_by),''), d.name) order by d.name) from drivers d
                         where d.status = 'Active' and d.role = 'Driver'
                           and not exists (select 1 from tc_pins p where p.driver_id = d.driver_id and p.pin_hash is not null)), '[]'::json),
    'pin_sync', (select json_build_object('at', last_pin_push, 'counts', last_pin_counts) from tc_sync_meta where id = 1));
end $$;

grant execute on function public.tc_board(text,date) to anon, authenticated;
grant execute on function public.tc_week(text,date) to anon, authenticated;

-- ---------------------------------------------------------------- PTO tracker -> PINs (Apps Script, secret key)
-- p_rows: [{ "id": "BAY01", "name": "Albert Bay", "pin": "1234" }, ...]  (Transportation only)
-- Matched to drivers by tc_pin_map, then exact name, then name without middle initial,
-- then first initial + last name (only if that picks exactly one driver).
create or replace function public.tc_sync_pins(p_secret text, p_rows jsonb)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v_hash text; r jsonb; v_id text; v_name text; v_pin text; v_drv text; v_old tc_pins%rowtype;
        n int := 0; n_pin int := 0; n_new int := 0; unmatched text[] := '{}'; seen text[] := '{}';
begin
  select pin_secret_hash into v_hash from tc_sync_meta where id = 1;
  if v_hash is null or encode(digest(coalesce(p_secret,''),'sha256'),'hex') <> v_hash then
    return json_build_object('ok', false, 'error', 'bad_secret');
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    return json_build_object('ok', false, 'error', 'empty_push');
  end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    v_id   := upper(trim(coalesce(r->>'id','')));
    v_name := regexp_replace(trim(coalesce(r->>'name','')), '\s+', ' ', 'g');
    v_pin  := regexp_replace(coalesce(r->>'pin',''), '\.0+$', '');
    if v_id = '' or v_id = any(seen) then continue; end if;
    seen := seen || v_id; n := n + 1;
    if v_pin !~ '^[0-9]{4,6}$' then v_pin := null; end if;

    select m.driver_id into v_drv from tc_pin_map m where upper(m.pto_employee_id) = v_id;
    if v_drv is null then
      select d.driver_id into v_drv from drivers d
       where lower(d.name) = lower(v_name) or lower(coalesce(d.goes_by,'')) = lower(v_name) limit 1;
    end if;
    if v_drv is null then   -- "Robert A. Wood" -> "Robert Wood"
      select d.driver_id into v_drv from drivers d
       where lower(d.name) = lower(regexp_replace(v_name, ' [A-Za-z]\. ', ' ')) limit 1;
    end if;
    if v_drv is null then   -- "Christopher Morland" -> "Chris Morland"
      select min(d.driver_id) into v_drv from drivers d
       where lower(split_part(d.name, ' ', 1)) like lower(left(v_name, 1)) || '%'
         and lower(regexp_replace(d.name, '^.* ', '')) = lower(regexp_replace(v_name, '^.* ', ''))
      having count(*) = 1;
    end if;
    if v_drv is null then unmatched := unmatched || (v_name || ' (' || v_id || ')'); end if;

    select * into v_old from tc_pins where pto_employee_id = v_id;
    if not found then
      insert into tc_pins (pto_employee_id, pto_name, driver_id, pin_hash)
      values (v_id, v_name, v_drv, case when v_pin is not null then crypt(v_pin, gen_salt('bf', 8)) end);
      n_new := n_new + 1;
    else
      update tc_pins set pto_name = v_name, driver_id = v_drv, synced_at = now(),
             pin_hash = case when v_pin is null then null
                             when v_old.pin_hash is not null and v_old.pin_hash = crypt(v_pin, v_old.pin_hash) then v_old.pin_hash
                             else crypt(v_pin, gen_salt('bf', 8)) end,
             failed_attempts = case when v_pin is null or v_old.pin_hash is null or v_old.pin_hash <> crypt(v_pin, v_old.pin_hash) then 0 else failed_attempts end,
             locked_until    = case when v_pin is null or v_old.pin_hash is null or v_old.pin_hash <> crypt(v_pin, v_old.pin_hash) then null else locked_until end
       where pto_employee_id = v_id;
    end if;
    if v_pin is not null then n_pin := n_pin + 1; end if;
    v_drv := null;
  end loop;

  delete from tc_pins where not (pto_employee_id = any(seen));
  update tc_sync_meta set last_pin_push = now(),
         last_pin_counts = jsonb_build_object('people', n, 'with_pin', n_pin, 'new', n_new, 'unmatched', to_jsonb(unmatched))
   where id = 1;
  return json_build_object('ok', true, 'people', n, 'with_pin', n_pin, 'new', n_new, 'unmatched', unmatched,
                           'drivers_without_pin', (select coalesce(json_agg(d.name order by d.name), '[]'::json) from drivers d
                                                    where d.status = 'Active' and d.role = 'Driver'
                                                      and not exists (select 1 from tc_pins p where p.driver_id = d.driver_id and p.pin_hash is not null)));
end $$;
grant execute on function public.tc_sync_pins(text,jsonb) to anon, authenticated;

-- ---------------------------------------------------------------- TLand export (Sync-DriverClock.ps1, secret key)
-- Days from p_from to p_to (Central). Each: driver, date, hours (rounded down to 0.05), raw hours,
-- needs_review, on_clock (shift still open), flags and the punch summary.
create or replace function public.tc_export(p_secret text, p_from date, p_to date)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v_hash text;
begin
  select export_secret_hash into v_hash from tc_sync_meta where id = 1;
  if v_hash is null or encode(digest(coalesce(p_secret,''),'sha256'),'hex') <> v_hash then
    return json_build_object('ok', false, 'error', 'bad_secret');
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 62 then
    return json_build_object('ok', false, 'error', 'bad_range');
  end if;
  update tc_sync_meta set last_export = now() where id = 1;
  return json_build_object('ok', true, 'at', now(), 'from', p_from, 'to', p_to,
    'days', coalesce((select json_agg(json_build_object('driver_id', y.driver_id, 'work_date', y.work_date, 'hours', y.hours,
                                                        'raw_hours', y.raw_hours, 'needs_review', y.needs_review, 'on_clock', y.on_clock,
                                                        'flags', array_to_string(y.flags, ', '), 'detail', y.detail)
                                      order by y.work_date, y.driver_id)
                        from tc_days(p_from, p_to) y), '[]'::json),
    'drivers_with_punches', (select count(distinct t.driver_id) from tc_punches t
                              where t.punched_at >= p_from::timestamp at time zone 'America/Chicago'));
end $$;
grant execute on function public.tc_export(text,date,date) to anon, authenticated;
