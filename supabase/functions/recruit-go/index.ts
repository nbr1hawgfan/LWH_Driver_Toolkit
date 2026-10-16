// recruit-go — the link inside each driver's Recruiter QR code.
// GET ?r=CODE → counts the scan (once per person per day) and sends them to the
// driver application page, tagged with the code so the website can capture it.
// Always redirects to the fixed application URL below (never an arbitrary one).
import { createClient } from "jsr:@supabase/supabase-js@2";

const APPLY_URL = "https://logistics-warehouse.com/driver-opportunities/";

async function sha256(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  const u = new URL(req.url);
  const code = (u.searchParams.get("r") || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
  const dest = new URL(APPLY_URL);
  if (code) {
    try {
      const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      const { data } = await db.from("recruit_codes").select("code").eq("code", code).maybeSingle();
      if (data) {
        dest.searchParams.set("ref", code);
        dest.searchParams.set("utm_source", "driver_referral");
        dest.searchParams.set("utm_medium", u.searchParams.get("m") === "link" ? "link" : "qr");
        dest.searchParams.set("utm_campaign", code);
        // Link-preview bots (iMessage, Facebook, etc.) fetch links too; don't count them.
        const ua = req.headers.get("user-agent") || "";
        const bot = /bot|crawl|spider|preview|facebookexternalhit|slack|whatsapp|discord|telegram|twitter/i.test(ua);
        if (!bot) {
          const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim();
          const visitor = await sha256(`${ip}|${ua}|${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`);
          const day = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
          await db.from("recruit_scans").upsert({ code, visitor_hash: visitor, scan_day: day },
            { onConflict: "code,visitor_hash,scan_day", ignoreDuplicates: true });
        }
      }
    } catch (_) { /* counting is best-effort; never block the applicant */ }
  }
  return new Response(null, { status: 302, headers: { Location: dest.toString(), "Cache-Control": "no-store" } });
});
