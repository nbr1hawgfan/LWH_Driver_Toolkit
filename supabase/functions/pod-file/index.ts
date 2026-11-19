// pod-file — Proof of Delivery PDFs (private bucket "pod-files"). Kept, not expired — billing records.
//
//   POST ?action=upload   raw PDF body; headers: x-msg-token (Driver Toolkit sign-in), x-pod-meta (URI-encoded JSON:
//                         {client_id, load_no, customer, addr_id, delivered_at, pallets, condition, note, lat, lon, acc, pages})
//                         → { ok, id, dup? }   Also drops a "Proof of delivery" message in the dispatch inbox.
//   POST ?action=url      JSON { token, id } → { ok, url, name }   (signed link, 10 minutes; managers or the driver who sent it)
//
// Rules live in Postgres (pod_register / pod_uploaded / pod_access — supabase/migrations/20261118_pod_and_site_notes.sql).
// client_id makes retries safe. Deployed with JWT verification off, like the other Driver Toolkit functions.
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-msg-token, x-pod-meta",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const MAX = 20 * 1024 * 1024;
const BUCKET = "pod-files";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);
  const action = new URL(req.url).searchParams.get("action") || "";
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  if (action === "upload") {
    const token = req.headers.get("x-msg-token") || "";
    let meta: Record<string, unknown> = {};
    try { meta = JSON.parse(decodeURIComponent(req.headers.get("x-pod-meta") || "{}")); } catch { return json({ ok: false, error: "Bad details" }, 400); }
    const buf = new Uint8Array(await req.arrayBuffer());
    if (!buf.length) return json({ ok: false, error: "Empty file" }, 400);
    if (buf.length > MAX) return json({ ok: false, error: "The PDF must be under 20 MB." }, 413);
    if (!(buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46)) return json({ ok: false, error: "Only PDF files." }, 415);

    const reg = await db.rpc("pod_register", { p_token: token, p_meta: meta, p_bytes: buf.length });
    if (reg.error) return json({ ok: false, error: reg.error.message }, 500);
    const r = reg.data as { ok: boolean; error?: string; id?: string; path?: string; dup?: boolean };
    if (!r.ok) return json(r, r.error === "signed_out" ? 401 : 400);
    if (r.dup) return json({ ok: true, id: r.id, dup: true });

    const up = await db.storage.from(BUCKET).upload(r.path!, buf, { contentType: "application/pdf", upsert: true });
    if (up.error) return json({ ok: false, error: up.error.message }, 500);
    const done = await db.rpc("pod_uploaded", { p_id: r.id });
    if (done.error) return json({ ok: false, error: done.error.message }, 500);
    return json({ ok: true, id: r.id });
  }

  if (action === "url") {
    let b: Record<string, unknown>;
    try { b = await req.json(); } catch { return json({ ok: false, error: "Bad JSON" }, 400); }
    const acc = await db.rpc("pod_access", { p_token: String(b.token || ""), p_id: String(b.id || "") });
    if (acc.error) return json({ ok: false, error: /uuid/i.test(acc.error.message) ? "POD not found." : acc.error.message }, 400);
    const a = acc.data as { ok: boolean; error?: string; path?: string; name?: string };
    if (!a.ok) return json(a, a.error === "signed_out" ? 401 : 404);
    const s = await db.storage.from(BUCKET).createSignedUrl(a.path!, 600, { download: b.download ? a.name : undefined });
    if (s.error) return json({ ok: false, error: s.error.message }, 500);
    return json({ ok: true, url: s.data.signedUrl, name: a.name });
  }

  return json({ ok: false, error: "Unknown action" }, 400);
});
