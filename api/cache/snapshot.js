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
  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

function sanitizePayload(p) {
  if (!p || typeof p !== "object") return {};
  const allowed = ["inventory", "workOrders", "itemMaster", "boms", "edrData", "dockData", "meta"];
  const out = {};
  allowed.forEach(function(k) {
    if (Object.prototype.hasOwnProperty.call(p, k)) out[k] = p[k];
  });
  return out;
}

function rowCountsFromPayload(payload) {
  return {
    inventory: Array.isArray(payload.inventory) ? payload.inventory.length : 0,
    workOrders: Array.isArray(payload.workOrders) ? payload.workOrders.length : 0,
    itemMaster: Array.isArray(payload.itemMaster) ? payload.itemMaster.length : 0,
    boms: Array.isArray(payload.boms) ? payload.boms.length : 0,
    edrData: Array.isArray(payload.edrData) ? payload.edrData.length : 0,
    dockData: Array.isArray(payload.dockData) ? payload.dockData.length : 0,
  };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const user = getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const supabase = getSupabaseAdmin();

    if (req.method === "GET") {
      const q = await supabase
        .from("cache_snapshots")
        .select("site_id,payload,row_counts,synced_at,updated_by")
        .eq("site_id", CACHE_SITE_ID)
        .maybeSingle();
      if (q.error) throw q.error;
      if (!q.data) return res.status(200).json({ snapshot: null });
      return res.status(200).json({ snapshot: q.data });
    }

    if (req.method === "POST") {
      const payload = sanitizePayload((req.body && req.body.payload) || {});
      const rowCounts = rowCountsFromPayload(payload);
      const up = await supabase
        .from("cache_snapshots")
        .upsert({
          site_id: CACHE_SITE_ID,
          payload: payload,
          row_counts: rowCounts,
          synced_at: new Date().toISOString(),
          updated_by: user.email,
        }, { onConflict: "site_id" })
        .select("site_id,row_counts,synced_at,updated_by")
        .single();
      if (up.error) throw up.error;
      return res.status(200).json({ ok: true, snapshot: up.data });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    Sentry.captureException(err);
    return res.status(500).json({ error: "Snapshot cache request failed", details: err && err.message ? err.message : "unknown" });
  }
}

