import {
  clampInt,
  getArtifactSiteId,
  getArtifactSupabase,
  parseBoolean,
  reportMatchesField,
  requireArtifactUser,
  withArtifactCors,
} from "./_artifacts.js";

export default async function handler(req, res) {
  withArtifactCors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  if (!requireArtifactUser(req, res)) return;

  try {
    const supabase = getArtifactSupabase();
    const siteId = getArtifactSiteId(req);
    const runId = String((req.query && req.query.runId) || "").trim();
    const reportCode = String((req.query && req.query.reportCode) || "").trim();
    const field = String((req.query && req.query.field) || "").trim();
    const okOnly = parseBoolean(req.query && req.query.ok, false);
    const latest = runId ? false : parseBoolean(req.query && req.query.latest, true);
    const limit = clampInt(req.query && req.query.limit, latest ? 100 : 250, 1, 500);
    const tableName = latest
      ? (okOnly ? "nulogy_artifact_latest_successful_reports" : "nulogy_artifact_latest_reports")
      : "nulogy_artifact_reports";

    let query = supabase
      .from(tableName)
      .select("site_id,run_id,generated_at,report_code,report_title,ok,skipped,row_count,header_count,headers,requested_columns,maximum_rows,maximum_rows_text,possible_truncation,request_body,preview_json,summary_json,status_url,download_url,error,created_at,updated_at")
      .eq("site_id", siteId)
      .limit(limit);

    if (runId) query = query.eq("run_id", runId);
    if (reportCode) query = query.eq("report_code", reportCode);
    if (!latest && okOnly) query = query.eq("ok", true).eq("skipped", false);
    query = query.order("generated_at", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false });

    const result = await query;
    if (result.error) throw result.error;

    const reports = (result.data || [])
      .map(function(report) {
        const match = reportMatchesField(report, field);
        return Object.assign({}, report, {
          fieldMatches: match.matches,
          fieldMatched: match.matched,
        });
      })
      .filter(function(report) {
        return !field || report.fieldMatched;
      });

    return res.status(200).json({
      ok: true,
      siteId,
      latest,
      reports,
    });
  } catch (error) {
    return res.status(500).json({
      error: "Could not load Nulogy artifact reports.",
      details: error && error.message ? error.message : "unknown",
    });
  }
}
