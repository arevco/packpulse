import {
  clampInt,
  DEFAULT_NULOGY_ARTIFACT_BUCKET,
  getArtifactSiteId,
  getArtifactSupabase,
  normalizeArtifactType,
  parseBoolean,
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
    const latest = runId ? false : parseBoolean(req.query && req.query.latest, !runId);
    const expiresIn = clampInt(req.query && req.query.expiresIn, 900, 60, 3600);
    const artifactType = normalizeArtifactType(
      (req.query && req.query.artifactType) || (reportCode ? "raw_csv" : "manifest"),
    );

    if (!artifactType) {
      return res.status(400).json({ error: "artifactType is required." });
    }

    let query = supabase
      .from("nulogy_artifact_files")
      .select("site_id,run_id,generated_at,report_code,artifact_type,storage_bucket,storage_path,content_type,byte_size,sha256,row_count,header_count,created_at")
      .eq("site_id", siteId)
      .eq("artifact_type", artifactType)
      .eq("report_code", reportCode || "")
      .limit(1);

    if (runId) {
      query = query.eq("run_id", runId);
    } else if (latest) {
      query = query.order("generated_at", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false });
    }

    const result = await query;
    if (result.error) throw result.error;
    const file = Array.isArray(result.data) && result.data.length ? result.data[0] : null;
    if (!file) {
      return res.status(404).json({
        error: "Artifact file not found.",
        siteId,
        runId: runId || null,
        reportCode: reportCode || "",
        artifactType,
      });
    }

    const bucket = file.storage_bucket || DEFAULT_NULOGY_ARTIFACT_BUCKET;
    const signed = await supabase.storage.from(bucket).createSignedUrl(file.storage_path, expiresIn);
    if (signed.error) throw signed.error;

    return res.status(200).json({
      ok: true,
      siteId,
      artifact: Object.assign({}, file, {
        signedUrl: signed.data && signed.data.signedUrl ? signed.data.signedUrl : "",
        expiresIn,
      }),
    });
  } catch (error) {
    return res.status(500).json({
      error: "Could not load Nulogy artifact file.",
      details: error && error.message ? error.message : "unknown",
    });
  }
}
