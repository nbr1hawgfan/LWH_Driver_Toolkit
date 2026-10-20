// scale-reports — weigh-station Open/Closed reports from LWH drivers.
// POST JSON:
//   { action: "submit", id, osm_id, name, lat, lon, status: "Open"|"Closed", driver, reported_at }
//   { action: "latest", osm_ids: string[], hours?: number }  -> newest report per scale within `hours` (default 24)
//   { action: "add_site", id: "lwh/...", name, lat, lon, added_by }   -> driver adds a scale missing from the map
//   { action: "sites" }                                               -> all driver-added scales
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const str = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const OSM_ID = /^((node|way|relation)\/\d{1,15}|lwh\/[a-z0-9-]{6,40})$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return json({ error: "Bad JSON" }, 400); }
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  if (b.action === "submit") {
    const id = str(b.id, 64);
    if (!/^sr-[A-Za-z0-9-]+$/.test(id)) return json({ error: "Missing or bad id" }, 400);
    const osm_id = str(b.osm_id, 48);
    if (!OSM_ID.test(osm_id)) return json({ error: "Bad osm_id" }, 400);
    const status = str(b.status, 10);
    if (status !== "Open" && status !== "Closed") return json({ error: "Bad status" }, 400);
    const at = new Date(str(b.reported_at, 40));
    const now = Date.now();
    // Queued offline reports can arrive late; anything older than 12h is no longer useful.
    if (isNaN(at.getTime()) || at.getTime() > now + 10 * 60000 || at.getTime() < now - 12 * 3600000)
      return json({ error: "Bad reported_at" }, 400);
    const lat = num(b.lat), lon = num(b.lon);
    const row = {
      id, osm_id, status, name: str(b.name, 120), driver: str(b.driver, 80),
      lat: lat !== null && Math.abs(lat) <= 90 ? lat : null,
      lon: lon !== null && Math.abs(lon) <= 180 ? lon : null,
      reported_at: at.toISOString(),
    };
    const { error } = await db.from("scale_reports").upsert(row, { onConflict: "id" });
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, id });
  }

  if (b.action === "latest") {
    const ids = Array.isArray(b.osm_ids)
      ? [...new Set(b.osm_ids.filter((x): x is string => typeof x === "string" && OSM_ID.test(x)))].slice(0, 300)
      : [];
    if (!ids.length) return json({ ok: true, reports: {} });
    const hours = Math.min(Math.max(Number(b.hours) || 24, 1), 72);
    const since = new Date(Date.now() - hours * 3600000).toISOString();
    const { data, error } = await db.from("scale_reports")
      .select("osm_id,status,driver,reported_at")
      .in("osm_id", ids).gte("reported_at", since)
      .order("reported_at", { ascending: false }).limit(2000);
    if (error) return json({ error: error.message }, 500);
    const reports: Record<string, unknown> = {};
    for (const r of data ?? []) if (!reports[r.osm_id]) reports[r.osm_id] = r;
    return json({ ok: true, reports });
  }

  if (b.action === "add_site") {
    const id = str(b.id, 48);
    if (!/^lwh\/[a-z0-9-]{6,40}$/.test(id)) return json({ error: "Bad id" }, 400);
    const name = str(b.name, 80);
    if (name.length < 3) return json({ error: "Name needed" }, 400);
    const lat = num(b.lat), lon = num(b.lon);
    // Our operating area plus margin (Fort Smith +/- ~450 mi).
    if (lat === null || lon === null || lat < 28 || lat > 43 || lon < -104 || lon > -85) return json({ error: "Location outside our area" }, 400);
    // Don't add a second pin right on top of an existing one.
    const { data: near } = await db.from("scale_sites").select("id,name,lat,lon").eq("hidden", false)
      .gte("lat", lat - 0.004).lte("lat", lat + 0.004).gte("lon", lon - 0.005).lte("lon", lon + 0.005).limit(1);
    if (near && near.length) return json({ ok: true, id: near[0].id, existing: near[0] });
    const { error } = await db.from("scale_sites").upsert({ id, name, lat, lon, added_by: str(b.added_by, 80) }, { onConflict: "id" });
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, id });
  }

  if (b.action === "sites") {
    const { data, error } = await db.from("scale_sites").select("id,name,lat,lon,added_by,created_at").eq("hidden", false).limit(2000);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, sites: data ?? [] });
  }

  return json({ error: "Unknown action" }, 400);
});
