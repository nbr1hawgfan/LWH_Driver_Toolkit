// yard-check-history — recent Yard Checks, for days-on-yard and the dispatch view.
// Deploy:  supabase functions deploy yard-check-history --no-verify-jwt
// POST JSON: { location?: string, from?: ISO, to?: ISO, trailer?: string, limit?: number }
//   with location → that yard's checks, newest first (default 40)
//   without       → newest checks across every yard (default 300)
//   from/to       → only checks with checked_at in [from, to)  (dispatch Day view)
//   trailer       → only checks that list a trailer number containing this text (Find a trailer)
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const locKey = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const iso = (v: unknown) => { const d = new Date(typeof v === "string" ? v : ""); return isNaN(d.getTime()) ? "" : d.toISOString(); };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let b: Record<string, unknown> = {};
  try { b = await req.json(); } catch { /* empty body is fine */ }
  const location = typeof b.location === "string" ? locKey(b.location) : "";
  const limit = Math.min(Math.max(Number(b.limit) || (location ? 40 : 300), 1), 500);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let q = db.from("yard_checks")
    .select("id,location,location_key,pin,driver,checked_at,sent_at,how,notes,trailers")
    .order("checked_at", { ascending: false })
    .limit(limit);
  if (location) q = q.eq("location_key", location);
  const from = iso(b.from), to = iso(b.to);
  if (from) q = q.gte("checked_at", from);
  if (to) q = q.lt("checked_at", to);
  const trailer = typeof b.trailer === "string" ? b.trailer.toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 20) : "";
  if (trailer) q = q.ilike("trailers_text", `%${trailer}%`);
  const { data, error } = await q;
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, checks: data ?? [] });
});
