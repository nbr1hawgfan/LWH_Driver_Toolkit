-- Time Clock fixes by managers (Driver Toolkit v1.47.0)
-- Managers (Driver Messages sign-in, role Manager) can add a missed punch, change a punch time, or remove a
-- punch from the Time Clock Board. Nothing is deleted: a changed/removed punch is voided (who, why) and a
-- changed one gets a new punch marked manual with who added it, why, and which punch it replaced.
-- Hours (tc_shifts / tc_days / tc_export) already skip voided punches, so payroll picks up the fix.
-- Days with a manager fix get the flag "Fixed by manager". The driver gets a Messages notice.

alter table public.tc_punches add column if not exists manual      boolean not null default false;
alter table public.tc_punches add column if not exists added_by    text;
alter table public.tc_punches add column if not exists add_reason  text;
alter table public.tc_punches add column if not exists replaces_id bigint;

-- One change: add (p_punch_id null), change time (p_punch_id + p_local), remove (p_punch_id, p_local null, p_remove true).
-- p_local = 'YYYY-MM-DD HH24:MI' in Central time.
create or replace function public.tc_fix(p_token text, p_driver_id text, p_type text, p_local text, p_reason text,
                                         p_punch_id bigint default null, p_remove boolean default false, p_notify boolean default true)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v_mgr text := drv_session_manager(p_token); v_by text; v_id text := upper(trim(coalesce(p_driver_id,'')));
        v_reason text := left(trim(coalesce(p_reason,'')),200); v_at timestamptz; old tc_punches%rowtype; v_new bigint;
        v_msg text; v_when text;
begin
  if v_mgr is null then return json_build_object('ok',false,'error','not_manager'); end if;
  v_by := drv_display_name(v_mgr);
  if length(v_reason) < 3 then return json_build_object('ok',false,'error','Type a reason (for example: forgot to clock out).'); end if;
  if not exists (select 1 from drivers where driver_id = v_id) then return json_build_object('ok',false,'error','Driver not found.'); end if;

  if p_punch_id is not null then
    select * into old from tc_punches where id = p_punch_id and driver_id = v_id for update;
    if not found then return json_build_object('ok',false,'error','That punch was not found.'); end if;
    if old.voided_at is not null then return json_build_object('ok',false,'error','That punch was already changed. Refresh.'); end if;
    if old.punched_at < now() - interval '62 days' then return json_build_object('ok',false,'error','That punch is too old to change here.'); end if;
  end if;

  if coalesce(p_remove,false) then
    if p_punch_id is null then return json_build_object('ok',false,'error','Pick the punch to remove.'); end if;
    update tc_punches set voided_at = now(), voided_by = v_by, void_reason = v_reason where id = old.id;
    v_when := to_char(tc_local(old.punched_at),'FMDy FMMon FMDD, FMHH12:MI AM');
    v_msg := v_by||' removed your clock-'||old.punch_type||' on '||v_when||'. Reason: '||v_reason;
  else
    if p_type not in ('in','out') then return json_build_object('ok',false,'error','Pick Clock In or Clock Out.'); end if;
    begin
      v_at := (to_timestamp(trim(p_local),'YYYY-MM-DD HH24:MI')::timestamp) at time zone 'America/Chicago';
    exception when others then return json_build_object('ok',false,'error','Pick a date and time.'); end;
    if v_at is null then return json_build_object('ok',false,'error','Pick a date and time.'); end if;
    if v_at > now() + interval '5 minutes' then return json_build_object('ok',false,'error','That time is in the future.'); end if;
    if v_at < now() - interval '62 days' then return json_build_object('ok',false,'error','That date is too far back to fix here.'); end if;
    if exists (select 1 from tc_punches t where t.driver_id = v_id and t.voided_at is null and t.punch_type = p_type
                and abs(extract(epoch from t.punched_at - v_at)) < 60 and t.id is distinct from p_punch_id) then
      return json_build_object('ok',false,'error','There is already a clock-'||p_type||' at that time.');
    end if;
    if p_punch_id is not null then
      update tc_punches set voided_at = now(), voided_by = v_by, void_reason = 'Changed: '||v_reason where id = old.id;
    end if;
    insert into tc_punches (driver_id, punch_type, punched_at, offline, manual, added_by, add_reason, replaces_id)
    values (v_id, p_type, v_at, false, true, v_by, v_reason, p_punch_id) returning id into v_new;
    v_when := to_char(tc_local(v_at),'FMDy FMMon FMDD, FMHH12:MI AM');
    v_msg := case when p_punch_id is null then v_by||' added a clock-'||p_type||' for you: '||v_when||'.'
                  else v_by||' changed your clock-'||old.punch_type||' from '||to_char(tc_local(old.punched_at),'FMHH12:MI AM')
                       ||' to '||case when old.punch_type<>p_type then 'clock-'||p_type||' ' else '' end||v_when||'.' end
             ||' Reason: '||v_reason;
  end if;

  if coalesce(p_notify,true) then
    begin
      perform msg_send(p_token, jsonb_build_object('drivers', jsonb_build_array(v_id)), 'notice',
                       left('Time clock: '||v_msg||' Questions? Message dispatch.', 1000));
    exception when others then null;   -- a message problem never blocks the fix
    end;
  end if;
  return json_build_object('ok',true,'id',v_new,'message',v_msg);
end $$;
revoke all on function public.tc_fix(text,text,text,text,text,bigint,boolean,boolean) from public;
grant execute on function public.tc_fix(text,text,text,text,text,bigint,boolean,boolean) to anon, authenticated;

-- Days with a manager fix say so (payroll / Driver Hours see it in flags).
create or replace function public.tc_days(p_from date, p_to date, p_driver text DEFAULT NULL::text)
 RETURNS TABLE(driver_id text, work_date date, hours numeric, raw_hours numeric, needs_review boolean, on_clock boolean, flags text[], detail text)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
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
           case when bool_or(sh.sent_late)              then 'Sent later (no signal)' end,
           case when bool_or(exists (select 1 from tc_punches m where m.manual and m.voided_at is null and m.id in (sh.in_id, sh.out_id)))
                  or bool_or(exists (select 1 from tc_punches v where v.driver_id = sh.driver_id and v.voided_at is not null and v.voided_by is not null
                              and tc_local(v.punched_at)::date = sh.work_date))
                then 'Fixed by manager' end
         ], null) as flags,
         left(string_agg(
           coalesce(to_char(tc_local(sh.in_at), 'FMHH12:MIam'), '?') || '-' ||
           case when sh.status = 'open' then 'now' else coalesce(to_char(tc_local(sh.out_at), 'FMHH12:MIam'), '?') end ||
           coalesce(' @' || coalesce(sh.in_site, sh.out_site) ||
                    case when coalesce(sh.in_site_m, sh.out_site_m) > 400 then ' ' || round(coalesce(sh.in_site_m, sh.out_site_m) / 1609.34, 1) || 'mi away' else '' end, ''),
           ', ' order by coalesce(sh.in_at, sh.out_at)), 300) as detail
    from sh
   group by sh.driver_id, sh.work_date;
$function$;

-- Board: punch ids + who fixed what, and the changed/removed punches for the record.
create or replace function public.tc_board(p_token text, p_date date DEFAULT NULL::date)
 RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
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
          'punches', (select json_agg(json_build_object('id', t.id, 'type', t.punch_type, 'at', t.punched_at, 'site', t.near_site, 'site_m', t.near_m,
                                                        'lat', t.lat, 'lon', t.lon, 'acc', t.accuracy_m, 'offline', t.offline,
                                                        'manual', t.manual, 'by', t.added_by, 'reason', t.add_reason) order by t.punched_at)
                        from tc_punches t where t.driver_id = d.driver_id and t.voided_at is null and tc_local(t.punched_at)::date = v_d),
          'voided', (select json_agg(json_build_object('id', t.id, 'type', t.punch_type, 'at', t.punched_at, 'by', t.voided_by,
                                                       'reason', t.void_reason, 'when', t.voided_at) order by t.punched_at)
                        from tc_punches t where t.driver_id = d.driver_id and t.voided_at is not null and tc_local(t.punched_at)::date = v_d)
        ) as r
        from drivers d
        left join tc_days(v_d, v_d) y on y.driver_id = d.driver_id
        where d.status = 'Active' and d.role = 'Driver'
      ) z), '[]'::json));
end $function$;

-- A punch a manager added has no GPS by nature; don't flag it "No GPS".
-- (tc_shifts: no_gps now ignores manual punches — see migration timeclock_fixes_no_gps_manual; body identical otherwise,
--  plus lead(p.manual) as n_manual.)
