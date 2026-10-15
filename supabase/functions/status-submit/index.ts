// status-submit — saves one Status Update (Arrived, Loaded, ...) from the Driver Toolkit.
// POST JSON: { id, driver, status, location, trailer, load_ref, eta, note, pin, how, sent_at }
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const str = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const locKey = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const STATUSES = ["Arrived", "Loaded", "Unloaded", "Delivered", "Departed", "Waiting", "Running Late"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return json({ error: "Bad JSON" }, 400); }

  const id = str(b.id, 64);
  if (!/^su-[A-Za-z0-9-]+$/.test(id)) return json({ error: "Missing or bad id" }, 400);
  const status = str(b.status, 20);
  if (!STATUSES.includes(status)) return json({ error: "Bad status" }, 400);
  const sentAt = new Date(str(b.sent_at, 40));
  if (isNaN(sentAt.getTime())) return json({ error: "Bad sent_at" }, 400);

  const location = str(b.location, 120);
  const row = {
    id, status, location, location_key: locKey(location),
    driver: str(b.driver, 80), trailer: str(b.trailer, 30).toUpperCase(), load_ref: str(b.load_ref, 60),
    eta: str(b.eta, 40), note: str(b.note, 300), pin: str(b.pin, 200), how: str(b.how, 60),
    sent_at: sentAt.toISOString(),
  };
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { error } = await db.from("driver_status_updates").upsert(row, { onConflict: "id" });
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, id });
});
