// yard-check-submit — saves (or updates) one sent Yard Check from the Driver Toolkit.
// Deploy:  supabase functions deploy yard-check-submit --no-verify-jwt
// POST JSON: { id, location, pin, driver, checked_at, how, notes, trailers:[{trailer,status,note}] }
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const str = (v: unknown, max = 500) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const locKey = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return json({ error: "Bad JSON" }, 400); }

  const id = str(b.id, 64);
  if (!/^yc-[A-Za-z0-9-]+$/.test(id)) return json({ error: "Missing or bad id" }, 400);

  const checkedAt = new Date(str(b.checked_at, 40));
  if (isNaN(checkedAt.getTime())) return json({ error: "Bad checked_at" }, 400);

  const raw = Array.isArray(b.trailers) ? b.trailers.slice(0, 300) : [];
  const trailers = raw
    .map((t: Record<string, unknown>) => ({
      trailer: str(t?.trailer, 30).toUpperCase(),
      status: ["Loaded", "Empty"].includes(str(t?.status, 10)) ? str(t?.status, 10) : "",
      note: str(t?.note, 200),
    }))
    .filter((t) => t.trailer);
  if (!trailers.length) return json({ error: "No trailers" }, 400);

  const location = str(b.location, 120);
  const row = {
    id,
    location,
    location_key: locKey(location),
    pin: str(b.pin, 200),
    driver: str(b.driver, 80),
    checked_at: checkedAt.toISOString(),
    sent_at: new Date().toISOString(),
    how: str(b.how, 60),
    notes: str(b.notes, 1000),
    trailers,
    trailer_count: trailers.length,
    loaded_count: trailers.filter((t) => t.status === "Loaded").length,
    empty_count: trailers.filter((t) => t.status === "Empty").length,
    updated_at: new Date().toISOString(),
  };

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { error } = await db.from("yard_checks").upsert(row, { onConflict: "id" });
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, id });
});
