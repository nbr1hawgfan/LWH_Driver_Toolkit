-- One sign-in for the Driver Toolkit (v1.51.0). Already applied to Supabase.
CREATE OR REPLACE FUNCTION public.drv_badge_login(p_badge text, p_device text DEFAULT NULL::text)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $function$
declare r json;
begin
  r := tc_badge_check(p_badge, p_device);
  if coalesce((r->>'ok')::boolean, false) is not true then return r; end if;
  return (r::jsonb || jsonb_build_object('token', drv_start_session(r->>'driver_id')))::json;
end $function$;

CREATE OR REPLACE FUNCTION public.drv_tc_device(p_token text, p_device text DEFAULT NULL::text)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $function$
declare v_id text := drv_session_driver(p_token); v_tok text;
begin
  if v_id is null then return json_build_object('ok',false,'error','signed_out'); end if;
  if p_device is not null and tc_device_driver(p_device) = v_id then
    update tc_devices set last_used = now(), expires_at = now() + interval '120 days'
     where token_hash = encode(digest(p_device,'sha256'),'hex');
    v_tok := p_device;
  else
    v_tok := tc_new_device(v_id);
  end if;
  return json_build_object('ok',true,'driver_id',v_id,'name',drv_display_name(v_id),'device',v_tok,'status',tc_driver_status(v_id));
end $function$;

CREATE OR REPLACE FUNCTION public.tc_device_status(p_device text)
 RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $function$
declare v_id text := tc_device_driver(p_device);
begin
  if v_id is null then return json_build_object('ok',false,'device_expired',true); end if;
  return json_build_object('ok',true,'driver_id',v_id,'status',tc_driver_status(v_id));
end $function$;
