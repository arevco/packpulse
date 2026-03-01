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

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const user = getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    const supabase = getSupabaseAdmin();
    const q = await supabase
      .from("cache_snapshot_history")
      .select("captured_at,updated_by,derived_metrics")
      .eq("site_id", CACHE_SITE_ID)
      .order("captured_at", { ascending: false })
      .limit(20);
    if (q.error) {
      var qMsg = String(q.error.message || "").toLowerCase();
      if (qMsg.includes("cache_snapshot_history") && qMsg.includes("schema cache")) {
        // Non-blocking while history table is being provisioned.
        return res.status(200).json({ change: null, historyStatus: "missing_history_table" });
      }
      throw q.error;
    }
    const rows = Array.isArray(q.data) ? q.data : [];
    if (!rows.length) return res.status(200).json({ change: null });

    const current = rows[0];
    const currentTs = new Date(current.captured_at).getTime();
    const sixHoursAgo = currentTs - (6 * 3600000);
    let previous = rows.find(function(r) { return new Date(r.captured_at).getTime() <= sixHoursAgo; }) || rows[1] || null;
    if (!previous) return res.status(200).json({ change: null });

    const c = current.derived_metrics || {};
    const p = previous.derived_metrics || {};
    const metrics = [
      ["woActive", "Active WOs"],
      ["woRemainingUnits", "Remaining Units"],
      ["woLate", "Late WOs"],
      ["inventoryRows", "Inventory Rows"],
      ["dockRows", "OpenDock Rows"],
      ["edrRows", "EDR Rows"],
    ].map(function(pair) {
      const key = pair[0];
      const label = pair[1];
      const curr = toNum(c[key]);
      const prev = toNum(p[key]);
      return { key: key, label: label, current: curr, previous: prev, delta: curr - prev };
    });

    return res.status(200).json({
      change: {
        currentAt: current.captured_at,
        previousAt: previous.captured_at,
        currentBy: current.updated_by || "",
        previousBy: previous.updated_by || "",
        metrics: metrics,
      }
    });
  } catch (err) {
    Sentry.captureException(err);
    return res.status(500).json({ error: "Shift change request failed", details: err && err.message ? err.message : "unknown" });
  }
}
