-- Driver Toolkit v1.52.0. Already applied to Supabase (full text also in the project's migration history:
-- dh_driver_alias, drv_badge_login_uses_clock, tm_attention_long_clock_and_my_hours).
-- * drv_badge_login: adds uses_clock (time clock used in the last 60 days) -> card scan opens Time Clock only for spotters.
-- * drv_my_hours(p_token, p_week_start): the driver's own Driver Hours (dh_days) for this week or up to 5 weeks back.
-- * tm_attention: adds tc_long / tc_long_list (still clocked in 12-72 hours).
-- * dh_alias (alias -> driver_id), seeded VREED -> REEDV; dh_push maps aliases (main code wins, a different alias
--   amount is noted on the day and flagged for review); dh_week hides alias codes.
create table if not exists public.dh_alias (alias text primary key, driver_id text not null, note text, created_at timestamptz not null default now());
alter table public.dh_alias enable row level security;
insert into public.dh_alias (alias, driver_id, note) values ('VREED','REEDV','TLand old code for Vincent Reed') on conflict (alias) do update set driver_id = excluded.driver_id;

CREATE OR REPLACE FUNCTION public.drv_badge_login(p_badge text, p_device text DEFAULT NULL::text)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $function$
declare r json; v_id text; v_clock boolean;
begin
  r := tc_badge_check(p_badge, p_device);
  if coalesce((r->>'ok')::boolean, false) is not true then return r; end if;
  v_id := r->>'driver_id';
  v_clock := exists (select 1 from tc_punches where driver_id = v_id and voided_at is null
                      and coalesce(manual,false) = false and punched_at > now() - interval '60 days');
  return (r::jsonb || jsonb_build_object('token', drv_start_session(v_id), 'uses_clock', v_clock))::json;
end $function$;

CREATE OR REPLACE FUNCTION public.drv_my_hours(p_token text, p_week_start date DEFAULT NULL::date)
 RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_id text := drv_session_driver(p_token);
        ws date := coalesce(p_week_start, (now() at time zone 'America/Chicago')::date);
        cur date := (now() at time zone 'America/Chicago')::date;
begin
  if v_id is null then return json_build_object('ok',false,'error','signed_out'); end if;
  ws := ws - extract(dow from ws)::int;
  cur := cur - extract(dow from cur)::int;
  if ws > cur or ws < cur - 35 then return json_build_object('ok',false,'error','bad_week'); end if;
  return json_build_object('ok',true,'driver_id',v_id,'week_start',ws,'current',ws = cur,
    'synced',(select last_push from dh_sync where id = 1),
    'approved',(select coalesce(w.approved_at is not null and (w.unapproved_at is null or w.unapproved_at < w.approved_at), false) from dh_weeks w where w.week_start = ws),
    'days',coalesce((select json_agg(json_build_object('date',h.work_date,'hours',h.hours,'pto',h.pto_hours,'hol',h.holiday_hours) order by h.work_date)
                      from dh_days h where h.driver_id = v_id and h.work_date between ws and ws + 6),'[]'::json));
end $function$;
