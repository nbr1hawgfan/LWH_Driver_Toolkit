// yard-photo-upload — stores one trailer photo from a Yard Check in the private
// "yard-photos" bucket. The phone shrinks it to a JPEG first.
// POST raw JPEG body, Content-Type image/jpeg, query: ?check=yc-...&photo=ph-...
// Returns { ok, path }  (path = "<check>/<photo>.jpg")
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const MAX_BYTES = 3 * 1024 * 1024;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const u = new URL(req.url);
  const check = u.searchParams.get("check") || "", photo = u.searchParams.get("photo") || "";
  if (!/^yc-[A-Za-z0-9-]{1,60}$/.test(check)) return json({ error: "Bad check id" }, 400);
  if (!/^ph-[A-Za-z0-9-]{1,60}$/.test(photo)) return json({ error: "Bad photo id" }, 400);

  const buf = new Uint8Array(await req.arrayBuffer());
  if (!buf.length) return json({ error: "Empty photo" }, 400);
  if (buf.length > MAX_BYTES) return json({ error: "Photo too large" }, 413);
  if (!(buf[0] === 0xff && buf[1] === 0xd8)) return json({ error: "Not a JPEG" }, 415);

  const path = `${check}/${photo}.jpg`;
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { error } = await db.storage.from("yard-photos").upload(path, buf, { contentType: "image/jpeg", upsert: true });
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, path });
});
