// LWH push notifications (Driver Toolkit + Transportation Manager + Warehouse Toolkit).
// Called by the database (pg_net) with the x-lwh-hook header:
//   {kind:"to_driver", ids:[message ids]}  -> each driver the message went to (Driver Toolkit phones)
//   {kind:"to_dispatch", id}               -> managers (Transportation Manager phones/PCs)
//   {kind:"to_emp", ids}  -> warehouse employees (Warehouse Toolkit)   {kind:"to_whmgr", id} -> warehouse managers
//   {kind:"direct", targets:[{app,id}], note}  -> PTO server notes (pto_notify): request sent / decided
//   {kind:"long"}                          -> managers: drivers still clocked in 12+ hours (pg_cron, every 10 min)
// From the apps (no hook header): {action:"test", endpoint} sends a test to that one phone/PC.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, apikey, authorization, x-lwh-session", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

type Sub = { endpoint: string; sub: any; app: string; driver_id: string; fails: number };
type Note = { title: string; body: string; tag?: string; path?: string; urgent?: boolean };

const clip = (s: string, n: number) => { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
const fmt = (iso: string) => new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", weekday: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso));

async function send(subs: Sub[], note: Note) {
  let ok = 0, gone = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(s.sub, JSON.stringify(note), { TTL: 6 * 3600, urgency: note.urgent ? "high" : "normal" });
      ok++;
      await db.from("push_subs").update({ last_ok: new Date().toISOString(), fails: 0 }).eq("endpoint", s.endpoint);
    } catch (e: any) {
      const code = e?.statusCode || 0;
      if (code === 404 || code === 410) { gone++; await db.from("push_subs").delete().eq("endpoint", s.endpoint); }
      else await db.from("push_subs").update({ fails: (s.fails || 0) + 1 }).eq("endpoint", s.endpoint);
    }
  }));
  return { ok, gone };
}
const once = async (key: string) => { const { data } = await db.rpc("push_once", { p_key: key }); return data === true; };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const cfg = Object.fromEntries(((await db.from("push_config").select("key,value")).data || []).map((r: any) => [r.key, r.value]));
  webpush.setVapidDetails(cfg.vapid_subject, cfg.vapid_public, cfg.vapid_private);
  const body = await req.json().catch(() => ({}));

  // ---- test from the app (only reaches the phone/PC that asked)
  if (body.action === "test") {
    const { data } = await db.from("push_subs").select("endpoint,sub,app,driver_id,fails").eq("endpoint", String(body.endpoint || "")).limit(1);
    if (!data?.length) return json({ ok: false, error: "This device is not set up for notifications." });
    const r = await send(data as Sub[], { title: "Notifications are on", body: "This is how messages will show up on this device.", tag: "lwh-test", path: data[0].app === "tm" ? "#messages" : "?view=messages" });
    return json({ ok: r.ok > 0, sent: r.ok, gone: r.gone, error: r.ok ? undefined : "The test did not reach this device. Turn notifications off and on again." });
  }

  if (req.headers.get("x-lwh-hook") !== cfg.hook_token) return json({ ok: false, error: "forbidden" }, 403);
  const out: Record<string, unknown> = { ok: true };

  if (body.kind === "to_driver") {
    const ids: number[] = (body.ids || []).map(Number).filter(Boolean).slice(0, 50);
    for (const id of ids) {
      const { data: m } = await db.from("msg_messages").select("id,sender_name,body,urgent,msg_type,recalled_at,direction").eq("id", id).maybeSingle();
      if (!m || m.recalled_at || m.direction !== "to_driver") continue;
      const { data: rc } = await db.from("msg_recipients").select("recipient_id").eq("message_id", id).eq("recipient_kind", "driver");
      const drivers: string[] = [];
      for (const r of rc || []) if (await once(`m:${id}:${r.recipient_id}`)) drivers.push(r.recipient_id);
      if (!drivers.length) continue;
      const { data: subs } = await db.from("push_subs").select("endpoint,sub,app,driver_id,fails").eq("app", "dt").in("driver_id", drivers).lt("fails", 8);
      const ask = m.msg_type === "ack" ? " Tap to answer." : m.msg_type === "reply" ? " Tap to reply." : "";
      const note: Note = {
        title: (m.urgent ? "URGENT: " : "") + "Message from " + (m.sender_name || "Dispatch"),
        body: clip(m.body, 150) + ask, tag: "msg-" + id, path: "?view=messages", urgent: !!m.urgent,
      };
      out["m" + id] = await send((subs || []) as Sub[], note);
    }
  }

  if (body.kind === "to_dispatch") {
    const { data: m } = await db.from("msg_messages").select("id,sender_name,body,urgent,direction,sender_kind,topic").eq("id", Number(body.id)).maybeSingle();
    if (m && m.direction === "to_dispatch" && m.sender_kind === "driver" && await once(`d:${m.id}`)) {
      const { data: subs } = await db.from("push_subs").select("endpoint,sub,app,driver_id,fails").eq("app", "tm").eq("is_manager", true).lt("fails", 8);
      out.sent = await send((subs || []) as Sub[], {
        title: (m.urgent ? "URGENT: " : "") + (m.sender_name || "Driver") + (m.topic ? " · " + m.topic : ""),
        body: clip(m.body, 150) || "New driver message", tag: "dmsg-" + m.id, path: "#messages", urgent: !!m.urgent,
      });
    }
  }

  if (body.kind === "to_emp") {
    const ids: number[] = (body.ids || []).map(Number).filter(Boolean).slice(0, 50);
    for (const id of ids) {
      const { data: m } = await db.from("msg_messages").select("id,sender_name,body,urgent,msg_type,recalled_at,direction").eq("id", id).maybeSingle();
      if (!m || m.recalled_at || m.direction !== "to_driver") continue;
      const { data: rc } = await db.from("msg_recipients").select("recipient_id").eq("message_id", id).eq("recipient_kind", "emp");
      const emps: string[] = [];
      for (const r of rc || []) if (await once(`e:${id}:${r.recipient_id}`)) emps.push(String(r.recipient_id));
      if (!emps.length) continue;
      const { data: subs } = await db.from("push_subs").select("endpoint,sub,app,driver_id,fails").eq("app", "wt").in("driver_id", emps).lt("fails", 8);
      const ask = m.msg_type === "ack" ? " Tap to answer." : m.msg_type === "reply" ? " Tap to reply." : "";
      out["e" + id] = await send((subs || []) as Sub[], {
        title: (m.urgent ? "URGENT: " : "") + "Message from " + (m.sender_name || "your manager"),
        body: clip(m.body, 150) + ask, tag: "wmsg-" + id, path: "?view=messages", urgent: !!m.urgent,
      });
    }
  }

  if (body.kind === "to_whmgr") {
    const { data: m } = await db.from("msg_messages").select("id,sender_name,body,urgent,direction,sender_kind,topic").eq("id", Number(body.id)).maybeSingle();
    if (m && m.direction === "to_dispatch" && m.sender_kind === "emp" && await once(`w:${m.id}`)) {
      const { data: subs } = await db.from("push_subs").select("endpoint,sub,app,driver_id,fails").eq("app", "wt").eq("is_manager", true).lt("fails", 8);
      out.sent = await send((subs || []) as Sub[], {
        title: (m.urgent ? "URGENT: " : "") + (m.sender_name || "Employee") + (m.topic ? " · " + m.topic : ""),
        body: clip(m.body, 150) || (m.topic || "New message"), tag: "whmsg-" + m.id, path: "?view=msgCenter", urgent: !!m.urgent,
      });
    }
  }

  if (body.kind === "direct") {
    const n = body.note || {};
    const note: Note = { title: clip(n.title, 120) || "Time Off", body: clip(n.body, 200), tag: clip(n.tag, 80) || undefined, path: String(n.path || "").startsWith("?") ? String(n.path) : "?view=timeOff" };
    const byApp: Record<string, string[]> = {};
    for (const t of (body.targets || []).slice(0, 60)) {
      if (!["wt", "dt", "tm"].includes(t.app)) continue;
      (byApp[t.app] ||= []).push(String(t.id));
    }
    const sent: Record<string, unknown> = {};
    for (const app of Object.keys(byApp)) {
      const { data } = await db.from("push_subs").select("endpoint,sub,app,driver_id,fails").eq("app", app).in("driver_id", byApp[app]).lt("fails", 8);
      // Transportation Manager uses #hash screens: its PTO Approvals screen is #pto
      sent[app] = await send((data || []) as Sub[], app === "tm" ? { ...note, path: "#pto" } : note);
    }
    out.sent = sent;
  }

  if (body.kind === "long") {
    const { data: due } = await db.rpc("push_long_due");
    if (due?.length) {
      const { data: subs } = await db.from("push_subs").select("endpoint,sub,app,driver_id,fails").eq("app", "tm").eq("is_manager", true).lt("fails", 8);
      for (const d of due) {
        const hrs = Math.floor((Date.now() - new Date(d.since).getTime()) / 3600e3);
        out["long_" + d.driver_id] = await send((subs || []) as Sub[], {
          title: "Still clocked in: " + (d.name || d.driver_id),
          body: `Clocked in ${fmt(d.since)} (${hrs} hrs ago). Forgot to clock out? Fix it on the Time Clock Board.`,
          tag: "long-" + d.driver_id, path: "#clock",
        });
      }
    }
    out.due = due?.length || 0;
  }
  return json(out);
});
