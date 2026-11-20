-- Time Clock cards (Driver Toolkit v1.46.0)
-- A printed card with a QR code. Scanning it on the Time Clock = signing in with the PTO PIN,
-- for the spotting yards (no Samsara HOS). The QR holds a random card code (LWHTC-…), never the PIN.
-- Only a SHA-256 hash of the code is stored. Printing a new card for a driver retires their old one.
--
--   tc_badge_check(p_badge, p_device)            → { ok, driver_id, name, device, status }  (same as tc_check)
--   tc_badge_list(p_token)                       → managers: active drivers + card status
--   tc_badge_issue(p_token, p_driver_ids text[]) → managers: new cards (codes returned once, for printing)
--   tc_badge_revoke(p_token, p_driver_id)        → managers: turn a lost card off

create table if not exists public.tc_badges (
  id          bigserial primary key,
  driver_id   text not null,
  token_hash  text not null unique,
  issued_at   timestamptz not null default now(),
  issued_by   text,
  revoked_at  timestamptz,
  last_used   timestamptz
);
create index if not exists tc_badges_driver on public.tc_badges(driver_id) where revoked_at is null;
alter table public.tc_badges enable row level security;   -- no policies: RPCs only
revoke all on public.tc_badges from anon, authenticated;

create or replace function public.tc_badge_hash(p text)
returns text language sql immutable set search_path = public, extensions as $$
  select encode(digest(upper(regexp_replace(coalesce(p,''), '\s', '', 'g')), 'sha256'), 'hex')
$$;

create or replace function public.tc_badge_check(p_badge text, p_device text default null)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare b tc_badges%rowtype; v_id text; v_tok text;
begin
  if coalesce(p_badge,'') !~* '^\s*LWHTC-[A-Z0-9]{16,40}\s*$' then
    return json_build_object('ok',false,'error','That is not a time clock card. Scan the QR code on your LWH time clock card.');
  end if;
  select * into b from tc_badges where token_hash = tc_badge_hash(p_badge);
  if not found then return json_build_object('ok',false,'error','This card is not set up. Ask Chris for a new card.'); end if;
  if b.revoked_at is not null then return json_build_object('ok',false,'error','This card was replaced and no longer works. Use your newest card, or your name and PIN.'); end if;
  v_id := b.driver_id;
  if not exists (select 1 from drivers d where d.driver_id = v_id and d.status = 'Active') then
    return json_build_object('ok',false,'error','This card is for someone who is not active. Ask Chris.');
  end if;
  update tc_badges set last_used = now() where id = b.id;
  if p_device is not null and tc_device_driver(p_device) = v_id then
    update tc_devices set last_used = now(), expires_at = now() + interval '120 days'
     where token_hash = encode(digest(p_device,'sha256'),'hex');
    v_tok := p_device;
  else
    v_tok := tc_new_device(v_id);
  end if;
  return json_build_object('ok',true,'driver_id',v_id,'name',drv_display_name(v_id),'device',v_tok,'status',tc_driver_status(v_id));
end $$;

create or replace function public.tc_badge_list(p_token text)
returns json language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if drv_session_manager(p_token) is null then return json_build_object('ok',false,'error','not_manager'); end if;
  return json_build_object('ok',true,'drivers',coalesce((
    select json_agg(json_build_object('driver_id',d.driver_id,'name',drv_display_name(d.driver_id),'location',coalesce(d.location,''),
             'truck_type',coalesce(d.truck_type,''),'role',d.role,
             'issued_at',b.issued_at,'issued_by',b.issued_by,'last_used',b.last_used) order by drv_display_name(d.driver_id))
      from drivers d left join lateral (select * from tc_badges x where x.driver_id = d.driver_id and x.revoked_at is null
                                         order by x.issued_at desc limit 1) b on true
     where d.status = 'Active'),'[]'::json));
end $$;

create or replace function public.tc_badge_issue(p_token text, p_driver_ids text[])
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v_mgr text := drv_session_manager(p_token); v_by text; r record; v_code text; out json[] := '{}';
        abc constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; i int; bytes bytea;
begin
  if v_mgr is null then return json_build_object('ok',false,'error','not_manager'); end if;
  if coalesce(array_length(p_driver_ids,1),0) = 0 then return json_build_object('ok',false,'error','Pick at least one driver.'); end if;
  if array_length(p_driver_ids,1) > 200 then return json_build_object('ok',false,'error','Too many at once.'); end if;
  v_by := drv_display_name(v_mgr);
  for r in select d.driver_id, coalesce(d.location,'') location from drivers d
            where d.status = 'Active' and d.driver_id = any(p_driver_ids) order by drv_display_name(d.driver_id) loop
    update tc_badges set revoked_at = now() where driver_id = r.driver_id and revoked_at is null;
    bytes := gen_random_bytes(20); v_code := 'LWHTC-';
    for i in 0..19 loop v_code := v_code || substr(abc, (get_byte(bytes,i) % length(abc)) + 1, 1); end loop;
    insert into tc_badges(driver_id, token_hash, issued_by) values (r.driver_id, tc_badge_hash(v_code), v_by);
    out := out || json_build_object('driver_id',r.driver_id,'name',drv_display_name(r.driver_id),'location',r.location,'code',v_code);
  end loop;
  return json_build_object('ok',true,'cards',to_json(out),'issued_by',v_by);
end $$;

create or replace function public.tc_badge_revoke(p_token text, p_driver_id text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare n int;
begin
  if drv_session_manager(p_token) is null then return json_build_object('ok',false,'error','not_manager'); end if;
  update tc_badges set revoked_at = now() where driver_id = upper(trim(p_driver_id)) and revoked_at is null;
  get diagnostics n = row_count;
  return json_build_object('ok',true,'revoked',n);
end $$;

revoke all on function public.tc_badge_hash(text) from public, anon, authenticated;
revoke all on function public.tc_badge_check(text,text) from public;
revoke all on function public.tc_badge_list(text) from public;
revoke all on function public.tc_badge_issue(text,text[]) from public;
revoke all on function public.tc_badge_revoke(text,text) from public;
grant execute on function public.tc_badge_check(text,text) to anon, authenticated;
grant execute on function public.tc_badge_list(text) to anon, authenticated;
grant execute on function public.tc_badge_issue(text,text[]) to anon, authenticated;
grant execute on function public.tc_badge_revoke(text,text) to anon, authenticated;
