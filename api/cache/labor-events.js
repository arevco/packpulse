import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import Sentry from "../_sentry.js";
import { buildLaborEvents } from "../_labor.js";
import { isMissingTableError, replaceSiteEventsInWindow, selectEventsForWrite, siteTableHasRows } from "../_event-window.js";

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

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const user = getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    const rows = req.body && Array.isArray(req.body.rows) ? req.body.rows : [];
    const syncedAt = req.body && req.body.syncedAt ? String(req.body.syncedAt) : new Date().toISOString();
    const events = buildLaborEvents(rows, CACHE_SITE_ID, syncedAt, user.email);
    if (!events.length) {
      return res.status(200).json({ ok: true, submitted: rows.length, written: 0, note: "no_positive_labor_rows" });
    }
    const supabase = getSupabaseAdmin();
    var hasExistingRows;
    try {
      hasExistingRows = await siteTableHasRows(supabase, "labor_events", CACHE_SITE_ID);
    } catch (tableErr) {
      if (isMissingTableError("labor_events", tableErr)) {
        return res.status(200).json({ ok: false, laborStatus: "missing_labor_events_table", submitted: rows.length, written: 0 });
      }
      throw tableErr;
    }
    var writePlan = selectEventsForWrite(events, {
      dateField: "worked_date_et",
      hasExistingRows: hasExistingRows,
      correctionDays: Number(process.env.LABOR_EVENT_CORRECTION_DAYS || process.env.NULOGY_EVENT_CORRECTION_DAYS || 60)
    });
    try {
      var writeResult = await replaceSiteEventsInWindow(supabase, {
        table: "labor_events",
        siteId: CACHE_SITE_ID,
        dateField: "worked_date_et",
        events: writePlan.events
      });
      return res.status(200).json({
        ok: true,
        submitted: rows.length,
        submittedEvents: events.length,
        writeMode: writePlan.mode,
        correctionStart: writePlan.cutoffDate,
        written: writeResult.written,
        deletedWindowStart: writeResult.deletedWindowStart,
        deletedWindowEnd: writeResult.deletedWindowEnd
      });
    } catch (writeErr) {
      if (isMissingTableError("labor_events", writeErr)) {
        return res.status(200).json({
          ok: false,
          laborStatus: "missing_labor_events_table",
          submitted: rows.length,
          submittedEvents: events.length,
          writeMode: writePlan.mode,
          correctionStart: writePlan.cutoffDate,
          written: 0
        });
      }
      throw writeErr;
    }
  } catch (err) {
    Sentry.captureException(err);
    return res.status(500).json({ error: "Labor event ingest failed", details: err && err.message ? err.message : "unknown" });
  }
}
