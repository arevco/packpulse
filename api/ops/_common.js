import { getAuthenticatedUser as getAuthenticatedUserFromSession } from "../_session.js";
import { getSupabaseAdminClient } from "../lib/supabase.js";

export const CACHE_SITE_ID = process.env.CACHE_SITE_ID || "default";

export function withCors(req, res, methods) {
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader("Access-Control-Allow-Methods", methods.join(", "));
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Credentials", "true");
}

export function getAuthenticatedUser(req) {
  return getAuthenticatedUserFromSession(req);
}

export function getSupabaseAdmin() {
  return getSupabaseAdminClient();
}

export function toNum(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (v == null || v === "") return 0;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export function toDateEt(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - Math.max(0, Number(daysAgo || 0)));
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const out = {};
  dtf.formatToParts(d).forEach(function(p) {
    if (p.type !== "literal") out[p.type] = p.value;
  });
  if (!out.year || !out.month || !out.day) return "";
  return out.year + "-" + out.month + "-" + out.day;
}
