-- Driver Messages (Driver Toolkit v1.39.0) — project tjivcqxnkftujceumdtx (LWH Companion)
--
-- 1. Driver sign-in: Driver ID (drivers.driver_id) + 6-digit PIN, same pattern as the
--    Warehouse Toolkit's emp_* employee login (setup code -> create PIN -> 30-day session token).
-- 2. Messages: dispatch sends notices / must-acknowledge / quick-reply messages; one
--    recipient row per person tracks delivered, read, acknowledged and reply.
--    recipient_kind is 'driver' now; 'emp' is reserved so the Warehouse Toolkit can use the
--    same tables later with its emp_* sessions.
--
-- Everything goes through SECURITY DEFINER functions called with the publishable key.
-- Tables have RLS on and no policies, so nothing is readable directly.

-- ---------------------------------------------------------------- driver sign-in
create table if not exists public.drv_auth (
  driver_id       text primary key references public.drivers(driver_id) on update cascade on delete cascade,
  pin_hash        text not null,
  failed_attempts int  not null default 0,
  locked_until    timestamptz,
  created_at      timestamptz not null default now(),
  last_login_at   timestamptz
);
create table if not exists public.drv_setup_codes (
  driver_id       text primary key references public.drivers(driver_id) on update cascade on delete cascade,
  setup_code      text not null,
  failed_attempts int  not null default 0,
  locked_until    timestamptz,
  created_at      timestamptz not null default now()
);
create table if not exists public.drv_sessions (
  token_hash  text primary key,
  driver_id   text not null references public.drivers(driver_id) on update cascade on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);
create index if not exists drv_sessions_driver_idx on public.drv_sessions (driver_id);
alter table public.drv_auth        enable row level security;
alter table public.drv_setup_codes enable row level security;
alter table public.drv_sessions    enable row level security;

-- ---------------------------------------------------------------- messages
create table if not exists public.msg_messages (
  id             bigint generated always as identity primary key,
  created_at     timestamptz not null default now(),
  sender_kind    text not null default 'driver' check (sender_kind in ('driver','emp')),
  sender_id      text not null,
  sender_name    text not null,
  audience_kind  text not null default 'driver' check (audience_kind in ('driver','emp')),
  audience_label text not null default '',
  msg_type       text not null check (msg_type in ('notice','ack','reply')),
  body           text not null check (length(body) between 1 and 1000),
  reply_options  text[] not null default '{}',
  urgent         boolean not null default false,
  expires_at     timestamptz,
  recalled_at    timestamptz,
  reminder_of    bigint references public.msg_messages(id) on delete set null
);
create index if not exists msg_messages_created_idx on public.msg_messages (created_at desc);

create table if not exists public.msg_recipients (
  message_id     bigint not null references public.msg_messages(id) on delete cascade,
  recipient_kind text   not null check (recipient_kind in ('driver','emp')),
  recipient_id   text   not null,
  recipient_name text   not null default '',
  delivered_at   timestamptz,
  read_at        timestamptz,
  acked_at       timestamptz,
  reply          text,
  replied_at     timestamptz,
  primary key (message_id, recipient_kind, recipient_id)
);
create index if not exists msg_recipients_person_idx on public.msg_recipients (recipient_kind, recipient_id, message_id desc);
alter table public.msg_messages   enable row level security;
alter table public.msg_recipients enable row level security;

-- ---------------------------------------------------------------- helpers (not callable by the app)
create or replace function public.drv_session_driver(p_token text)
returns text language sql stable security definer set search_path = public, extensions as $$
  select s.driver_id
    from drv_sessions s join drivers d on d.driver_id = s.driver_id and d.status = 'Active'
   where s.token_hash = encode(digest(coalesce(p_token,''), 'sha256'), 'hex')
     and s.expires_at > now();
$$;

create or replace function public.drv_session_manager(p_token text)
returns text language sql stable security definer set search_path = public, extensions as $$
  select d.driver_id from drivers d
   where d.driver_id = drv_session_driver(p_token) and d.role = 'Manager';
$$;

create or replace function public.drv_display_name(p_driver_id text)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(nullif(trim(goes_by),''), name) from drivers where driver_id = p_driver_id;
$$;

create or replace function public.drv_start_session(p_driver_id text)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare tok text := encode(gen_random_bytes(32), 'hex');
begin
  insert into drv_sessions (token_hash, driver_id, expires_at)
  values (encode(digest(tok,'sha256'),'hex'), p_driver_id, now() + interval '30 days');
  update drv_auth set last_login_at = now() where driver_id = p_driver_id;
  delete from drv_sessions where expires_at < now();
  return tok;
end $$;

-- Every active person in the drivers table without a PIN gets a setup code.
create or replace function public.drv_fill_setup_codes()
returns int language plpgsql security definer set search_path = public, extensions as $$
declare n int;
begin
  insert into drv_setup_codes (driver_id, setup_code)
  select d.driver_id, emp_new_setup_code() from drivers d
   where d.status = 'Active'
     and not exists (select 1 from drv_auth a where a.driver_id = d.driver_id)
     and not exists (select 1 from drv_setup_codes c where c.driver_id = d.driver_id);
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------- sign-in RPCs (app)
create or replace function public.drv_create_pin(p_driver_id text, p_setup_code text, p_pin text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare sc drv_setup_codes%rowtype; msg text; v_id text := upper(trim(coalesce(p_driver_id,'')));
begin
  if exists (select 1 from drv_auth where driver_id = v_id) then
    return json_build_object('ok',false,'error','A PIN is already set for this Driver ID. Sign in instead, or ask dispatch for a reset.');
  end if;
  select * into sc from drv_setup_codes where driver_id = v_id for update;
  if not found or not exists (select 1 from drivers where driver_id = v_id and status = 'Active') then
    return json_build_object('ok',false,'error','That Driver ID and setup code do not match.');
  end if;
  if sc.locked_until is not null and sc.locked_until > now() then
    return json_build_object('ok',false,'error','Too many tries. Wait 15 minutes, then try again.');
  end if;
  if upper(regexp_replace(coalesce(p_setup_code,''),'[^A-Za-z0-9]','','g')) <> sc.setup_code then
    update drv_setup_codes
       set failed_attempts = failed_attempts + 1,
           locked_until = case when failed_attempts + 1 >= 5 then now() + interval '15 minutes' end
     where driver_id = v_id;
    return json_build_object('ok',false,'error','That Driver ID and setup code do not match.');
  end if;
  msg := emp_pin_problem(p_pin);
  if msg is not null then return json_build_object('ok',false,'error',msg); end if;
  insert into drv_auth (driver_id, pin_hash) values (v_id, crypt(p_pin, gen_salt('bf',10)));
  delete from drv_setup_codes where driver_id = v_id;
  return json_build_object('ok',true,'token',drv_start_session(v_id));
end $$;

create or replace function public.drv_login(p_driver_id text, p_pin text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare a drv_auth%rowtype; v_id text := upper(trim(coalesce(p_driver_id,'')));
begin
  select au.* into a from drv_auth au join drivers d on d.driver_id = au.driver_id and d.status = 'Active'
   where au.driver_id = v_id for update of au;
  if not found then
    if exists (select 1 from drv_setup_codes where driver_id = v_id) then
      return json_build_object('ok',false,'error','First time? Tap "First time sign-in" and use the setup code from dispatch.','needs_setup',true);
    end if;
    return json_build_object('ok',false,'error','Driver ID or PIN not recognized.');
  end if;
  if a.locked_until is not null and a.locked_until > now() then
    return json_build_object('ok',false,'error','Too many tries. Wait 15 minutes, then try again.');
  end if;
  if a.pin_hash <> crypt(coalesce(p_pin,''), a.pin_hash) then
    update drv_auth
       set failed_attempts = failed_attempts + 1,
           locked_until = case when failed_attempts + 1 >= 5 then now() + interval '15 minutes' end
     where driver_id = v_id;
    return json_build_object('ok',false,'error','Driver ID or PIN not recognized.');
  end if;
  update drv_auth set failed_attempts = 0, locked_until = null where driver_id = v_id;
  return json_build_object('ok',true,'token',drv_start_session(v_id));
end $$;

create or replace function public.drv_logout(p_token text)
returns json language plpgsql security definer set search_path = public, extensions as $$
begin
  delete from drv_sessions where token_hash = encode(digest(coalesce(p_token,''),'sha256'),'hex');
  return json_build_object('ok',true);
end $$;

create or replace function public.drv_me(p_token text)
returns json language plpgsql stable security definer set search_path = public, extensions as $$
declare v_id text := drv_session_driver(p_token); d drivers%rowtype;
begin
  if v_id is null then return json_build_object('ok',false,'error','signed_out'); end if;
  select * into d from drivers where driver_id = v_id;
  return json_build_object('ok',true,'driver_id',d.driver_id,'name',drv_display_name(d.driver_id),
                           'full_name',d.name,'role',d.role,'location',d.location);
end $$;

-- ---------------------------------------------------------------- driver inbox RPCs (app)
create or replace function public.msg_inbox(p_token text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v_id text := drv_session_driver(p_token); result json;
begin
  if v_id is null then return json_build_object('ok',false,'error','signed_out'); end if;
  update msg_recipients r set delivered_at = now()
    from msg_messages m
   where m.id = r.message_id and r.recipient_kind = 'driver' and r.recipient_id = v_id
     and r.delivered_at is null and m.recalled_at is null;
  select json_build_object('ok',true,'now',now(),'messages',coalesce(json_agg(x order by x.sort_key, x.created_at desc),'[]'::json))
    into result
    from (
      select m.id, m.created_at, m.sender_name, m.msg_type, m.body, m.reply_options, m.urgent, m.expires_at,
             r.read_at, r.acked_at, r.reply, r.replied_at,
             case when m.msg_type = 'ack'   and r.acked_at  is null then 0
                  when m.msg_type = 'reply' and r.replied_at is null then 0
                  when r.read_at is null then 1 else 2 end as sort_key
        from msg_recipients r join msg_messages m on m.id = r.message_id
       where r.recipient_kind = 'driver' and r.recipient_id = v_id
         and m.recalled_at is null
         and (m.expires_at is null or m.expires_at > now())
         and m.created_at > now() - interval '30 days'
       order by 1 desc limit 100
    ) x;
  return result;
end $$;

-- p_action: 'read' | 'ack' | 'reply' (reply needs p_reply)
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

-- ---------------------------------------------------------------- dispatch RPCs (Message Center, role = Manager)
create or replace function public.msg_directory(p_token text)
returns json language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if drv_session_manager(p_token) is null then return json_build_object('ok',false,'error','not_manager'); end if;
  return json_build_object('ok',true,'me',drv_display_name(drv_session_manager(p_token)),'drivers',coalesce((
    select json_agg(json_build_object('driver_id',d.driver_id,'name',drv_display_name(d.driver_id),'role',d.role,
                    'location',coalesce(d.location,''),'has_pin',exists(select 1 from drv_auth a where a.driver_id=d.driver_id))
                    order by d.role desc, coalesce(d.location,''), d.name)
      from drivers d where d.status = 'Active'),'[]'::json));
end $$;

-- p_audience: {"all":true} | {"locations":["Road","Trane"]} | {"drivers":["ATHOMPS","RWOOD"]}
-- "all" and "locations" go to active Drivers and Other roles (not Managers); "drivers" can pick anyone active.
create or replace function public.msg_send(p_token text, p_audience jsonb, p_type text, p_body text,
                                           p_reply_options text[] default '{}', p_urgent boolean default false,
                                           p_expires_at timestamptz default null, p_reminder_of bigint default null)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v_mgr text := drv_session_manager(p_token); v_body text := trim(coalesce(p_body,''));
        v_opts text[]; v_label text; v_id bigint; n int; v_to text[];
begin
  if v_mgr is null then return json_build_object('ok',false,'error','not_manager'); end if;
  if p_type not in ('notice','ack','reply') then return json_build_object('ok',false,'error','Bad message type.'); end if;
  if v_body = '' or length(v_body) > 1000 then return json_build_object('ok',false,'error','Message must be 1–1000 characters.'); end if;
  select coalesce(array_agg(o order by i),'{}') into v_opts
    from (select left(trim(u.o),40) o, min(u.i) i
            from unnest(coalesce(p_reply_options,'{}')) with ordinality u(o,i)
           where trim(u.o) <> ''
           group by left(trim(u.o),40) order by min(u.i) limit 4) z;
  if p_type = 'reply' and array_length(v_opts,1) is null then
    return json_build_object('ok',false,'error','Add at least one quick reply.');
  end if;
  if p_type <> 'reply' then v_opts := '{}'; end if;

  if coalesce((p_audience->>'all')::boolean,false) then
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

  insert into msg_messages (sender_id, sender_name, audience_label, msg_type, body, reply_options, urgent, expires_at, reminder_of)
  values (v_mgr, drv_display_name(v_mgr), coalesce(v_label,''), p_type, v_body, v_opts, coalesce(p_urgent,false), p_expires_at, p_reminder_of)
  returning id into v_id;
  insert into msg_recipients (message_id, recipient_kind, recipient_id, recipient_name)
  select v_id, 'driver', t, drv_display_name(t) from unnest(v_to) t;
  return json_build_object('ok',true,'id',v_id,'recipients',n);
end $$;

create or replace function public.msg_sent(p_token text, p_days int default 30)
returns json language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if drv_session_manager(p_token) is null then return json_build_object('ok',false,'error','not_manager'); end if;
  return json_build_object('ok',true,'messages',coalesce((
    select json_agg(x order by x.created_at desc) from (
      select m.id, m.created_at, m.sender_name, m.audience_label, m.msg_type, m.body, m.reply_options, m.urgent,
             m.expires_at, m.recalled_at, m.reminder_of,
             count(r.*) total,
             count(r.read_at) read,
             count(r.acked_at) acked,
             count(r.replied_at) replied
        from msg_messages m left join msg_recipients r on r.message_id = m.id
       where m.audience_kind = 'driver' and m.created_at > now() - make_interval(days => least(greatest(coalesce(p_days,30),1),180))
       group by m.id) x),'[]'::json));
end $$;

create or replace function public.msg_detail(p_token text, p_message_id bigint)
returns json language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if drv_session_manager(p_token) is null then return json_build_object('ok',false,'error','not_manager'); end if;
  return json_build_object('ok',true,'recipients',coalesce((
    select json_agg(json_build_object('driver_id',r.recipient_id,'name',r.recipient_name,
             'location',coalesce(d.location,''),'delivered_at',r.delivered_at,'read_at',r.read_at,
             'acked_at',r.acked_at,'reply',r.reply,'replied_at',r.replied_at)
             order by (r.acked_at is not null), (r.read_at is not null), r.recipient_name)
      from msg_recipients r left join drivers d on d.driver_id = r.recipient_id
     where r.message_id = p_message_id and r.recipient_kind = 'driver'),'[]'::json));
end $$;

create or replace function public.msg_recall(p_token text, p_message_id bigint)
returns json language plpgsql security definer set search_path = public, extensions as $$
begin
  if drv_session_manager(p_token) is null then return json_build_object('ok',false,'error','not_manager'); end if;
  update msg_messages set recalled_at = coalesce(recalled_at, now()) where id = p_message_id;
  return json_build_object('ok',true);
end $$;

-- Setup codes for people who have not made a PIN yet, and PIN resets.
create or replace function public.drv_setup_list(p_token text)
returns json language plpgsql security definer set search_path = public, extensions as $$
begin
  if drv_session_manager(p_token) is null then return json_build_object('ok',false,'error','not_manager'); end if;
  perform drv_fill_setup_codes();
  return json_build_object('ok',true,'codes',coalesce((
    select json_agg(json_build_object('driver_id',c.driver_id,'name',drv_display_name(c.driver_id),
                    'location',coalesce(d.location,''),'setup_code',c.setup_code) order by coalesce(d.location,''), d.name)
      from drv_setup_codes c join drivers d on d.driver_id = c.driver_id and d.status='Active'),'[]'::json));
end $$;

create or replace function public.drv_reset_pin(p_token text, p_driver_id text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v_code text; v_id text := upper(trim(coalesce(p_driver_id,'')));
begin
  if drv_session_manager(p_token) is null then return json_build_object('ok',false,'error','not_manager'); end if;
  if not exists (select 1 from drivers where driver_id = v_id and status='Active') then
    return json_build_object('ok',false,'error','No active driver with that ID.');
  end if;
  delete from drv_sessions    where driver_id = v_id;
  delete from drv_auth        where driver_id = v_id;
  delete from drv_setup_codes where driver_id = v_id;
  v_code := emp_new_setup_code();
  insert into drv_setup_codes (driver_id, setup_code) values (v_id, v_code);
  return json_build_object('ok',true,'driver_id',v_id,'name',drv_display_name(v_id),'setup_code',v_code);
end $$;

-- ---------------------------------------------------------------- grants
revoke all on function public.drv_session_driver(text)  from public, anon, authenticated;
revoke all on function public.drv_session_manager(text) from public, anon, authenticated;
revoke all on function public.drv_display_name(text)    from public, anon, authenticated;
revoke all on function public.drv_start_session(text)   from public, anon, authenticated;
revoke all on function public.drv_fill_setup_codes()    from public, anon, authenticated;

revoke all on function public.drv_create_pin(text,text,text) from public;
revoke all on function public.drv_login(text,text)           from public;
revoke all on function public.drv_logout(text)               from public;
revoke all on function public.drv_me(text)                   from public;
revoke all on function public.msg_inbox(text)                from public;
revoke all on function public.msg_mark(text,bigint,text,text) from public;
revoke all on function public.msg_directory(text)            from public;
revoke all on function public.msg_send(text,jsonb,text,text,text[],boolean,timestamptz,bigint) from public;
revoke all on function public.msg_sent(text,int)             from public;
revoke all on function public.msg_detail(text,bigint)        from public;
revoke all on function public.msg_recall(text,bigint)        from public;
revoke all on function public.drv_setup_list(text)           from public;
revoke all on function public.drv_reset_pin(text,text)       from public;

grant execute on function public.drv_create_pin(text,text,text) to anon, authenticated;
grant execute on function public.drv_login(text,text)           to anon, authenticated;
grant execute on function public.drv_logout(text)               to anon, authenticated;
grant execute on function public.drv_me(text)                   to anon, authenticated;
grant execute on function public.msg_inbox(text)                to anon, authenticated;
grant execute on function public.msg_mark(text,bigint,text,text) to anon, authenticated;
grant execute on function public.msg_directory(text)            to anon, authenticated;
grant execute on function public.msg_send(text,jsonb,text,text,text[],boolean,timestamptz,bigint) to anon, authenticated;
grant execute on function public.msg_sent(text,int)             to anon, authenticated;
grant execute on function public.msg_detail(text,bigint)        to anon, authenticated;
grant execute on function public.msg_recall(text,bigint)        to anon, authenticated;
grant execute on function public.drv_setup_list(text)           to anon, authenticated;
grant execute on function public.drv_reset_pin(text,text)       to anon, authenticated;

-- Initial setup codes for everyone active.
select public.drv_fill_setup_codes();
