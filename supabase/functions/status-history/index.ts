// status-history — Status Updates for the dispatch Day view.
// POST JSON: { from?: ISO, to?: ISO, driver?: string, limit?: number }  (newest first)
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const iso = (v: unknown) => { const d = new Date(typeof v === "string" ? v : ""); return isNaN(d.getTime()) ? "" : d.toISOString(); };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  let b: Record<string, unknown> = {};
  try { b = await req.json(); } catch { /* empty body is fine */ }
  const from = iso(b.from), to = iso(b.to);
  const limit = Math.min(Math.max(Number(b.limit) || 500, 1), 1000);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let q = db.from("driver_status_updates")
    .select("id,driver,status,location,trailer,load_ref,eta,note,pin,how,sent_at")
    .order("sent_at", { ascending: false }).limit(limit);
  if (from) q = q.gte("sent_at", from);
  if (to) q = q.lt("sent_at", to);
  if (typeof b.driver === "string" && b.driver.trim()) q = q.ilike("driver", b.driver.trim());
  const { data, error } = await q;
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, updates: data ?? [] });
});
