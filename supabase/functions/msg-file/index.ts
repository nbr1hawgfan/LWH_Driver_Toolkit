// msg-file — files attached to Driver Messages (private bucket "msg-files").
//
//   POST ?action=upload   raw file body; headers: x-msg-token, x-file-name (URI-encoded), content-type
//                         → { ok, id, name, mime, bytes }   (then pass id in p_attachments to msg_send / msg_driver_send)
//   POST ?action=url      JSON { token, id } → { ok, url, name, mime }   (signed link, 10 minutes)
//
// Who may upload/open is decided in Postgres (msg_file_register / msg_file_access) from the same
// Driver ID + PIN session token the apps already use. Every upload also clears files past their
// 14-day date. Deployed with JWT verification off, like the other Driver Toolkit functions.
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-msg-token, x-file-name",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const MAX = 10 * 1024 * 1024;
const BUCKET = "msg-files";

function sniff(b: Uint8Array): string | null {
  if (b.length >= 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return "application/pdf";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);
  const action = new URL(req.url).searchParams.get("action") || "";
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  if (action === "upload") {
    const token = req.headers.get("x-msg-token") || "";
    let name = "file";
    try { name = decodeURIComponent(req.headers.get("x-file-name") || "file"); } catch { /* keep default */ }
    const buf = new Uint8Array(await req.arrayBuffer());
    if (!buf.length) return json({ ok: false, error: "Empty file" }, 400);
    if (buf.length > MAX) return json({ ok: false, error: "File must be under 10 MB." }, 413);
    const mime = sniff(buf);
    if (!mime) return json({ ok: false, error: "Only PDF, JPG, PNG or WebP files." }, 415);

    const reg = await db.rpc("msg_file_register", { p_token: token, p_name: name, p_mime: mime, p_bytes: buf.length });
    if (reg.error) return json({ ok: false, error: reg.error.message }, 500);
    const r = reg.data as { ok: boolean; error?: string; id?: string; path?: string };
    if (!r.ok) return json(r, r.error === "signed_out" ? 401 : 400);

    const up = await db.storage.from(BUCKET).upload(r.path!, buf, { contentType: mime, upsert: false });
    if (up.error) return json({ ok: false, error: up.error.message }, 500);
    await db.rpc("msg_file_uploaded", { p_id: r.id });

    // Housekeeping: remove files past their date (and abandoned uploads).
    try {
      const old = await db.rpc("msg_file_expired");
      const paths = ((old.data ?? []) as unknown[]).map((p) => (typeof p === "string" ? p : (p as Record<string, string>).msg_file_expired)).filter(Boolean);
      if (paths.length) await db.storage.from(BUCKET).remove(paths);
    } catch { /* never block an upload on cleanup */ }

    return json({ ok: true, id: r.id, name, mime, bytes: buf.length });
  }

  if (action === "url") {
    let b: Record<string, unknown>;
    try { b = await req.json(); } catch { return json({ ok: false, error: "Bad JSON" }, 400); }
    const acc = await db.rpc("msg_file_access", { p_token: String(b.token || ""), p_id: String(b.id || "") });
    if (acc.error) return json({ ok: false, error: /uuid/i.test(acc.error.message) ? "File not found." : acc.error.message }, 400);
    const a = acc.data as { ok: boolean; error?: string; path?: string; name?: string; mime?: string };
    if (!a.ok) return json(a, a.error === "signed_out" ? 401 : 404);
    const s = await db.storage.from(BUCKET).createSignedUrl(a.path!, 600);
    if (s.error) return json({ ok: false, error: s.error.message }, 500);
    return json({ ok: true, url: s.data.signedUrl, name: a.name, mime: a.mime });
  }

  return json({ ok: false, error: "Unknown action" }, 400);
});
