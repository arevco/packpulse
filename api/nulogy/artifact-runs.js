import { clampInt, getArtifactSiteId, getArtifactSupabase, requireArtifactUser, withArtifactCors } from "./_artifacts.js";

export default async function handler(req, res) {
  withArtifactCors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  if (!requireArtifactUser(req, res)) return;

  try {
    const supabase = getArtifactSupabase();
    const siteId = getArtifactSiteId(req);
    const limit = clampInt(req.query && req.query.limit, 20, 1, 100);
    const latestOnly = /^(1|true|yes)$/i.test(String((req.query && req.query.latest) || "").trim());

    let query = supabase
      .from("nulogy_artifact_runs")
      .select("site_id,run_id,generated_at,mode,proxy_base_url,metadata_path,report_count,succeeded_count,failed_count,manifest_storage_bucket,manifest_storage_path,created_by,created_at,updated_at")
      .eq("site_id", siteId)
      .order("generated_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(latestOnly ? 1 : limit);

    const result = await query;
    if (result.error) throw result.error;

    return res.status(200).json({
      ok: true,
      siteId,
      runs: result.data || [],
    });
  } catch (error) {
    return res.status(500).json({
      error: "Could not load Nulogy artifact runs.",
      details: error && error.message ? error.message : "unknown",
    });
  }
}
