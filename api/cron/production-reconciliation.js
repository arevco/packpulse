import Sentry from "../_sentry.js";
import { runInvoicingProductionBackfill } from "../ops/_invoicing-production-backfill.js";
import { CACHE_SITE_ID, getSupabaseAdmin, toDateEt } from "../ops/_common.js";

const DEFAULT_LOOKBACK_DAYS = 45;

function shiftIsoDate(dateKey, deltaDays) {
  var date = new Date(String(dateKey || "") + "T12:00:00Z");
  if (isNaN(date)) return "";
  date.setUTCDate(date.getUTCDate() + Number(deltaDays || 0));
  return date.toISOString().slice(0, 10);
}

export function productionReconciliationWindow(options) {
  var lookbackDays = Math.max(1, Math.min(45, Number(options && options.lookbackDays || DEFAULT_LOOKBACK_DAYS)));
  var endDate = String(options && options.endDate || toDateEt(1));
  return {
    startDate: shiftIsoDate(endDate, -(lookbackDays - 1)),
    endDate: endDate,
    lookbackDays: lookbackDays
  };
}

export function isAuthorizedProductionCron(req, secret) {
  var expected = String(secret || "").trim();
  if (!expected) return false;
  var authorization = String(req && req.headers && req.headers.authorization || "");
  return authorization === "Bearer " + expected;
}

async function logCronRun(supabase, result, window, startedAt, error) {
  var reconciliation = result && result.reconciliation || null;
  var insert = await supabase.from("sync_runs").insert({
    site_id: CACHE_SITE_ID,
    source: "nulogy_production_scheduled_reconciliation",
    status: result && result.ok ? "ok" : "partial",
    row_counts: {
      rowsDownloaded: Number(result && result.rowsDownloaded || 0),
      rowsWritten: Number(result && result.written || 0),
      sourceJobs: Number(reconciliation && reconciliation.sourceJobCount || 0),
      storedJobs: Number(reconciliation && reconciliation.storedJobCount || 0),
      sourceUnits: Number(reconciliation && reconciliation.sourceUnits || 0),
      storedUnits: Number(reconciliation && reconciliation.storedUnits || 0)
    },
    details: {
      window: window,
      reconciliationStatus: result && result.reconciliationStatus || "failed",
      reconciliation: reconciliation,
      writeMode: result && result.writeMode || null,
      reportStatusUrl: result && result.reportStatusUrl || null,
      error: error && error.message ? error.message : null
    },
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    updated_by: "vercel-cron"
  });
  if (insert.error) Sentry.captureException(insert.error);
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!isAuthorizedProductionCron(req, process.env.CRON_SECRET)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  var startedAt = new Date().toISOString();
  var window = productionReconciliationWindow({ lookbackDays: DEFAULT_LOOKBACK_DAYS });
  var supabase;
  try {
    supabase = getSupabaseAdmin();
    var result = await runInvoicingProductionBackfill({
      startDate: window.startDate,
      endDate: window.endDate,
      updatedBy: "vercel-cron"
    });
    await logCronRun(supabase, result, window, startedAt, null);
    if (result && result.pending) return res.status(202).json(result);
    if (!result || !result.ok) {
      Sentry.captureMessage("Scheduled Nulogy production reconciliation did not reconcile", "error");
      return res.status(409).json(result || { ok: false, reconciliationStatus: "failed" });
    }
    return res.status(200).json(result);
  } catch (error) {
    Sentry.captureException(error);
    if (supabase) await logCronRun(supabase, null, window, startedAt, error);
    return res.status(error && error.statusCode || 500).json({
      ok: false,
      error: "Scheduled Nulogy production reconciliation failed",
      details: error && error.message ? error.message : "unknown",
      window: window
    });
  }
}
