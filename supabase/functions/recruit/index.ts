// recruit — Driver Recruiter data for the Driver Toolkit.
// POST JSON { action, ... }:
//   register { driver_name, code? }        → { code }   (creates or renames a driver's code)
//   stats    { code? }                      → { me, board, recent }
//   award    { passcode, code, kind, applicant, note, by } → credit points (manager passcode)
//   unaward  { passcode, id }               → remove a mistaken credit
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const str = (v: unknown, max = 120) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const cleanCode = (v: unknown) => str(v, 12).toUpperCase().replace(/[^A-Z0-9]/g, "");
const POINTS: Record<string, number> = { Applied: 10, Hired: 50 };

function newCode(name: string) {
  const initials = name.split(/\s+/).filter(Boolean).map((w) => w[0].toUpperCase()).join("").replace(/[^A-Z]/g, "").slice(0, 2) || "LW";
  const abc = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L to avoid mix-ups
  let r = ""; const b = crypto.getRandomValues(new Uint8Array(4));
  for (const x of b) r += abc[x % abc.length];
  return initials + r;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  let b: Record<string, unknown> = {};
  try { b = await req.json(); } catch { return json({ error: "Bad JSON" }, 400); }
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const action = str(b.action, 20);

  if (action === "register") {
    const name = str(b.driver_name, 80);
    if (!name) return json({ error: "Enter your name first" }, 400);
    const code = cleanCode(b.code);
    if (code) {
      const { data } = await db.from("recruit_codes").select("code").eq("code", code).maybeSingle();
      if (data) {
        await db.from("recruit_codes").update({ driver_name: name, updated_at: new Date().toISOString() }).eq("code", code);
        return json({ ok: true, code });
      }
    }
    for (let i = 0; i < 5; i++) {
      const c = newCode(name);
      const { error } = await db.from("recruit_codes").insert({ code: c, driver_name: name });
      if (!error) return json({ ok: true, code: c });
    }
    return json({ error: "Could not create a code, try again" }, 500);
  }

  if (action === "stats") {
    const [codes, scans, awards] = await Promise.all([
      db.from("recruit_codes").select("code,driver_name"),
      db.from("recruit_scans").select("code,scanned_at").order("scanned_at", { ascending: false }).limit(20000),
      db.from("recruit_awards").select("id,code,kind,points,applicant,note,awarded_by,created_at").order("created_at", { ascending: false }).limit(5000),
    ]);
    if (codes.error || scans.error || awards.error) return json({ error: (codes.error || scans.error || awards.error)!.message }, 500);
    const monthStart = new Date(new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" }).slice(0, 7) + "-01T06:00:00Z").getTime();
    const rows: Record<string, any> = {};
    for (const c of codes.data ?? []) rows[c.code] = { code: c.code, name: c.driver_name, scans: 0, scansMonth: 0, applied: 0, hired: 0, points: 0, pointsMonth: 0 };
    for (const s of scans.data ?? []) { const r = rows[s.code]; if (!r) continue; r.scans++; if (+new Date(s.scanned_at) >= monthStart) r.scansMonth++; }
    for (const a of awards.data ?? []) {
      const r = rows[a.code]; if (!r) continue;
      if (a.kind === "Applied") r.applied++; else r.hired++;
      r.points += a.points; if (+new Date(a.created_at) >= monthStart) r.pointsMonth += a.points;
    }
    // Merge codes that belong to the same name (e.g. a driver who switched phones).
    const byName: Record<string, any> = {};
    for (const r of Object.values(rows)) {
      const k = r.name.toLowerCase().replace(/\s+/g, " ").trim() || r.code;
      const m = byName[k] ||= { name: r.name || "(no name)", codes: [], scans: 0, scansMonth: 0, applied: 0, hired: 0, points: 0, pointsMonth: 0 };
      m.codes.push(r.code); for (const f of ["scans", "scansMonth", "applied", "hired", "points", "pointsMonth"]) m[f] += r[f];
    }
    const board = Object.values(byName).sort((a: any, b: any) => b.points - a.points || b.scans - a.scans);
    const code = cleanCode(b.code);
    const me = code ? board.find((r: any) => r.codes.includes(code)) || null : null;
    const names: Record<string, string> = {}; for (const c of codes.data ?? []) names[c.code] = c.driver_name;
    const recent = (awards.data ?? []).slice(0, 50).map((a) => ({ ...a, driver_name: names[a.code] || "" }));
    return json({ ok: true, points: POINTS, me, board, recent });
  }

  if (action === "award" || action === "unaward") {
    const { data: v, error: ve } = await db.rpc("toolkit_outbound_verify", { p_passcode: str(b.passcode, 60) });
    if (ve) return json({ error: ve.message }, 500);
    if (!v || v.ok !== true) return json({ error: (v && v.error) || "Wrong passcode" }, 403);
    if (action === "unaward") {
      const id = Number(b.id); if (!Number.isInteger(id)) return json({ error: "Bad id" }, 400);
      const { error } = await db.from("recruit_awards").delete().eq("id", id);
      return error ? json({ error: error.message }, 500) : json({ ok: true });
    }
    const code = cleanCode(b.code), kind = str(b.kind, 10);
    if (!POINTS[kind]) return json({ error: "Kind must be Applied or Hired" }, 400);
    const { data: c } = await db.from("recruit_codes").select("code").eq("code", code).maybeSingle();
    if (!c) return json({ error: "Unknown driver code" }, 400);
    const { data, error } = await db.from("recruit_awards").insert({
      code, kind, points: POINTS[kind], applicant: str(b.applicant, 80), note: str(b.note, 200), awarded_by: str(b.by, 60),
    }).select("id").single();
    return error ? json({ error: error.message }, 500) : json({ ok: true, id: data.id });
  }
  return json({ error: "Unknown action" }, 400);
});
