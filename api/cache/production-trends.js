import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import Sentry from "../_sentry.js";

const SESSION_SECRET = process.env.SESSION_SECRET || "packpulse-default-secret-change-me";
const CACHE_SITE_ID = process.env.CACHE_SITE_ID || "default";

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(";").forEach(function(c) {
    const parts = c.trim().split("=");
    const key = parts.shift();
    if (key) cookies[key.trim()] = parts.join("=").trim();
  });
  return cookies;
}

function getAuthenticatedUser(req) {
  const cookies = parseCookies(req.headers.cookie);
  const session = cookies.pp_session;
  if (!session) return null;
  const parts = session.split(":");
  if (parts.length !== 3) return null;
  const email = parts[0];
  const expires = parts[1];
  const sig = parts[2];
  const payload = email + ":" + expires;
  const expectedSig = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("hex");
  if (sig !== expectedSig) return null;
  if (Date.now() > parseInt(expires, 10)) return null;
  return { email: email };
}

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) throw new Error("Missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false } });
}

function toNum(v) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

function toEasternDateKey(value) {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d)) return "";
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const out = {};
  dtf.formatToParts(d).forEach(function(p) {
    if (p.type !== "literal") out[p.type] = p.value;
  });
  if (!out.year || !out.month || !out.day) return "";
  return out.year + "-" + out.month + "-" + out.day;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const user = getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    const supabase = getSupabaseAdmin();
    const days = Math.max(1, Math.min(120, Number(req.query.days || 30)));
    const from = new Date();
    from.setDate(from.getDate() - days);
    const fromDate = from.toISOString().slice(0, 10);

    const q = await supabase
      .from("production_events")
      .select("produced_date_et,produced_at_utc,source_snapshot_at,shift_label,units_produced,job_id,work_order_code,line,item_code")
      .eq("site_id", CACHE_SITE_ID)
      .order("source_snapshot_at", { ascending: false })
      .limit(60000);

    if (q.error) {
      const msg = String(q.error.message || "").toLowerCase();
      if (msg.includes("production_events") && msg.includes("schema cache")) {
        return res.status(200).json({ trends: null, productionStatus: "missing_production_events_table" });
      }
      throw q.error;
    }

    const rows = Array.isArray(q.data) ? q.data : [];
    const byDay = {};
    const byShift = {};
    let rowsMissingProducedDate = 0;
    let rowsInWindow = 0;
    rows.forEach(function(r) {
      const fromProducedDate = String(r.produced_date_et || "");
      const fallbackDate = toEasternDateKey(r.produced_at_utc) || toEasternDateKey(r.source_snapshot_at);
      const d = fromProducedDate || fallbackDate;
      if (!fromProducedDate) rowsMissingProducedDate += 1;
      if (!d || d < fromDate) return;
      rowsInWindow += 1;
      const s = String(r.shift_label || "Unassigned");
      const u = toNum(r.units_produced);
      if (!byDay[d]) byDay[d] = { date: d, units: 0, rows: 0 };
      byDay[d].units += u;
      byDay[d].rows += 1;
      const key = d + "|" + s;
      if (!byShift[key]) byShift[key] = { date: d, shift: s, units: 0, rows: 0 };
      byShift[key].units += u;
      byShift[key].rows += 1;
    });

    return res.status(200).json({
      trends: {
        days: days,
        fromDate: fromDate,
        totalRows: rowsInWindow,
        byDay: Object.values(byDay).sort(function(a, b) { return a.date < b.date ? 1 : -1; }),
        byShift: Object.values(byShift).sort(function(a, b) {
          if (a.date !== b.date) return a.date < b.date ? 1 : -1;
          return a.shift < b.shift ? -1 : 1;
        }),
        diagnostics: {
          totalRowsInTable: rows.length,
          rowsMissingProducedDateEt: rowsMissingProducedDate
        }
      }
    });
  } catch (err) {
    Sentry.captureException(err);
    return res.status(500).json({ error: "Production trends request failed", details: err && err.message ? err.message : "unknown" });
  }
}
