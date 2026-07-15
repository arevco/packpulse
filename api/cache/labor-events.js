import { createClient } from "@supabase/supabase-js";
import Sentry from "../_sentry.js";
import { buildLaborEvents } from "../_labor.js";
import { isMissingTableError } from "../_event-window.js";
import { getAuthenticatedUser } from "../_session.js";
import { refreshOpsPerformanceViews } from "./_performance-views.js";
import { writeLaborEventsSafely } from "./_labor-write.js";

const CACHE_SITE_ID = process.env.CACHE_SITE_ID || "default";

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
    const shouldRefresh = !(req.body && Object.prototype.hasOwnProperty.call(req.body, "refresh") && req.body.refresh === false);
    const events = buildLaborEvents(rows, CACHE_SITE_ID, syncedAt, user.email);
    if (!events.length) {
      return res.status(200).json({ ok: true, submitted: rows.length, written: 0, note: "no_positive_labor_rows" });
    }
    const supabase = getSupabaseAdmin();
    try {
      var writeResult = await writeLaborEventsSafely(supabase, {
        siteId: CACHE_SITE_ID,
        events: events,
        correctionDays: Number(process.env.LABOR_EVENT_CORRECTION_DAYS || process.env.NULOGY_EVENT_CORRECTION_DAYS || 60)
      });
      var refreshResult = { status: shouldRefresh ? "noop" : "deferred", details: null };
      if (writeResult.written > 0 && shouldRefresh) {
        try {
          refreshResult = await refreshOpsPerformanceViews(supabase);
        } catch (refreshErr) {
          Sentry.captureException(refreshErr);
          refreshResult = {
            status: "refresh_failed",
            details: refreshErr && refreshErr.message ? refreshErr.message : "unknown"
          };
        }
      }
      return res.status(200).json({
        ok: true,
        submitted: rows.length,
        submittedEvents: writeResult.submittedEvents,
        selectedEvents: writeResult.selectedEvents,
        writeMode: writeResult.writeMode,
        correctionStart: writeResult.correctionStart,
        written: writeResult.written,
        refreshRequested: shouldRefresh,
        deletedWindowStart: writeResult.deletedWindowStart,
        deletedWindowEnd: writeResult.deletedWindowEnd,
        guardedDates: writeResult.guardedDates,
        guardedDateKeys: writeResult.guardedDateKeys,
        performanceViewRefreshStatus: refreshResult.status,
        performanceViewRefreshDetails: refreshResult.details
      });
    } catch (writeErr) {
      if (isMissingTableError("labor_events", writeErr)) {
        return res.status(200).json({
          ok: false,
          laborStatus: "missing_labor_events_table",
          submitted: rows.length,
          submittedEvents: events.length,
          writeMode: "unavailable",
          correctionStart: null,
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
