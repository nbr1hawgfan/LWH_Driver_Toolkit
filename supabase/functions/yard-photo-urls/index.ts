// yard-photo-urls — short-lived view links for yard check photos (Dispatch Board).
// POST JSON: { paths: ["yc-.../ph-....jpg", ...] }  → { ok, urls: { path: url } }
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const OK_PATH = /^yc-[A-Za-z0-9-]{1,60}\/ph-[A-Za-z0-9-]{1,60}\.jpg$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  let b: Record<string, unknown> = {};
  try { b = await req.json(); } catch { return json({ error: "Bad JSON" }, 400); }
  const paths = (Array.isArray(b.paths) ? b.paths : []).filter((p): p is string => typeof p === "string" && OK_PATH.test(p)).slice(0, 300);
  if (!paths.length) return json({ ok: true, urls: {} });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data, error } = await db.storage.from("yard-photos").createSignedUrls(paths, 3600);
  if (error) return json({ error: error.message }, 500);
  const urls: Record<string, string> = {};
  (data ?? []).forEach((d) => { if (d.path && d.signedUrl) urls[d.path] = d.signedUrl; });
  return json({ ok: true, urls });
});
