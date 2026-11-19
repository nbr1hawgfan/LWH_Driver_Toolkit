-- One PIN for drivers (Driver Toolkit v1.44.0) — project tjivcqxnkftujceumdtx
--
-- Chris asked that drivers sign in with the PIN they already know: their PTO / time off PIN.
-- Messages (and everything that uses its sign-in: Proof of Delivery, Site Notes) now checks the
-- PTO PIN synced into tc_pins — the same check the Time Clock uses, with the same lockout
-- (5 wrong tries = 15 minutes), so a driver never has two PINs.
--   * Drivers pick their name instead of typing a Driver ID (msg_roster).
--   * No setup codes for anyone with a PTO PIN. A Driver-app PIN (drv_auth) still works as a
--     fallback for the few people with no PTO PIN (e.g. a manager on the dispatch page).
--   * Sessions last 180 days instead of 30, and each use pushes the end date out again, so a
--     driver who uses the app doesn't get signed out.
--   * Forgot PIN → Chris resets it in the PTO tracker (it syncs here), not a setup code.

create or replace function public.drv_login(p_driver_id text, p_pin text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare a drv_auth%rowtype; v_id text := upper(trim(coalesce(p_driver_id,''))); v_err text;
begin
  if not exists (select 1 from drivers where driver_id = v_id and status = 'Active') then
    return json_build_object('ok',false,'error','Pick your name from the list.');
  end if;
  -- 1) PTO PIN (same as the Time Clock and the time off app)
  if (tc_driver_for_pin(v_id)).pto_employee_id is not null then
    v_err := tc_check_pin(v_id, p_pin);
    if v_err is null then return json_build_object('ok',true,'token',drv_start_session(v_id)); end if;
    -- Someone who set a Driver-app PIN earlier can still use it.
    select * into a from drv_auth where driver_id = v_id;
    if found and (a.locked_until is null or a.locked_until <= now()) and a.pin_hash = crypt(coalesce(p_pin,''), a.pin_hash) then
      return json_build_object('ok',true,'token',drv_start_session(v_id));
    end if;
    return json_build_object('ok',false,'error',v_err);
  end if;
  -- 2) No PTO PIN on file: fall back to a Driver-app PIN if they have one
  select * into a from drv_auth where driver_id = v_id for update;
  if not found then
    if exists (select 1 from drv_setup_codes where driver_id = v_id) and exists (select 1 from drivers where driver_id = v_id and role = 'Manager') then
      return json_build_object('ok',false,'error','First time? Tap "First time sign-in" and use the setup code.','needs_setup',true);
    end if;
    return json_build_object('ok',false,'error','No PIN on file for you yet. Ask Chris to set your PIN in the PTO tracker — it''s the same PIN you use for time off.');
  end if;
  if a.locked_until is not null and a.locked_until > now() then
    return json_build_object('ok',false,'error','Too many wrong PINs. Wait 15 minutes, then try again.');
  end if;
  if a.pin_hash <> crypt(coalesce(p_pin,''), a.pin_hash) then
    update drv_auth set failed_attempts = failed_attempts + 1,
           locked_until = case when failed_attempts + 1 >= 5 then now() + interval '15 minutes' end
     where driver_id = v_id;
    return json_build_object('ok',false,'error','That PIN is not right.');
  end if;
  update drv_auth set failed_attempts = 0, locked_until = null where driver_id = v_id;
  return json_build_object('ok',true,'token',drv_start_session(v_id));
end $$;

create or replace function public.drv_start_session(p_driver_id text)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare tok text := encode(gen_random_bytes(32), 'hex');
begin
  insert into drv_sessions (token_hash, driver_id, expires_at)
  values (encode(digest(tok,'sha256'),'hex'), p_driver_id, now() + interval '180 days');
  update drv_auth set last_login_at = now() where driver_id = p_driver_id;
  delete from drv_sessions where expires_at < now();
  return tok;
end $$;

-- Keep a driver who uses the app signed in: drv_me (called when the app opens / signs in)
-- pushes the session end date out to 180 days from now.
create or replace function public.drv_me(p_token text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v_id text := drv_session_driver(p_token); d drivers%rowtype;
begin
  if v_id is null then return json_build_object('ok',false,'error','signed_out'); end if;
  update drv_sessions set expires_at = now() + interval '180 days'
   where token_hash = encode(digest(coalesce(p_token,''),'sha256'),'hex') and expires_at < now() + interval '150 days';
  select * into d from drivers where driver_id = v_id;
  return json_build_object('ok',true,'driver_id',d.driver_id,'name',drv_display_name(d.driver_id),
                           'full_name',d.name,'role',d.role,'location',d.location);
end $$;

-- Name list for the sign-in screen (drivers + managers). Names only — no phone, email, etc.
create or replace function public.msg_roster()
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object('driver_id', d.driver_id, 'name', coalesce(nullif(trim(d.goes_by),''), d.name),
           'role', d.role,
           'has_pin', exists (select 1 from tc_pins p where p.driver_id = d.driver_id and p.pin_hash is not null)
                      or exists (select 1 from drv_auth a where a.driver_id = d.driver_id))
         order by (d.role = 'Manager'), coalesce(nullif(trim(d.goes_by),''), d.name)), '[]'::json)
    from drivers d where d.status = 'Active';
$$;
revoke all on function public.msg_roster() from public;
grant execute on function public.msg_roster() to anon, authenticated;

-- Dispatch "Driver Sign-in" tab: now lists who has NO PIN at all (needs one set in the PTO tracker).
-- Setup codes only for managers without a PTO PIN.
create or replace function public.drv_setup_list(p_token text)
returns json language plpgsql security definer set search_path = public, extensions as $$
begin
  if drv_session_manager(p_token) is null then return json_build_object('ok',false,'error','not_manager'); end if;
  perform drv_fill_setup_codes();
  return json_build_object('ok',true,
    'codes',coalesce((
      select json_agg(json_build_object('driver_id',c.driver_id,'name',drv_display_name(c.driver_id),
                      'location',coalesce(d.location,''),'setup_code',c.setup_code) order by coalesce(d.location,''), d.name)
        from drv_setup_codes c join drivers d on d.driver_id = c.driver_id and d.status='Active' and d.role = 'Manager'
       where not exists (select 1 from tc_pins p where p.driver_id = c.driver_id and p.pin_hash is not null)),'[]'::json),
    'no_pin',coalesce((
      select json_agg(json_build_object('driver_id',d.driver_id,'name',drv_display_name(d.driver_id),'location',coalesce(d.location,'')) order by d.name)
        from drivers d where d.status='Active' and d.role <> 'Manager'
         and not exists (select 1 from tc_pins p where p.driver_id = d.driver_id and p.pin_hash is not null)
         and not exists (select 1 from drv_auth a where a.driver_id = d.driver_id)),'[]'::json),
    'signed_in',coalesce((
      select json_agg(json_build_object('driver_id',x.driver_id,'name',drv_display_name(x.driver_id),'last',x.last) order by drv_display_name(x.driver_id))
        from (select s.driver_id, max(s.created_at) last from drv_sessions s join drivers d on d.driver_id = s.driver_id and d.status='Active'
               where s.expires_at > now() group by s.driver_id) x),'[]'::json));
end $$;
