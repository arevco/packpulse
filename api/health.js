import { getSupabaseAdminClient, getSupabaseHealthSummary } from "./lib/supabase.js";

function sanitizeError(error) {
  if (!error) return "unknown";
  const text = String((error && (error.message || error.error_description || error.details || error.code)) || error).trim();
  return text || "unknown";
}

function isProvisioningError(error) {
  const text = sanitizeError(error).toLowerCase();
  return text.includes("schema cache") || text.includes("could not find the table") || text.includes("relation") && text.includes("cache_snapshots") || text.includes("does not exist");
}

async function checkSupabase() {
  const client = getSupabaseAdminClient({ required: false });
  if (!client) {
    return { ok: false, status: "not_configured", details: "Missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" };
  }
  try {
    const result = await client
      .from("cache_snapshots")
      .select("site_id", { head: true, count: "exact" })
      .limit(1);
    if (result.error) {
      if (isProvisioningError(result.error)) {
        return { ok: false, status: "degraded", details: "cache_snapshots table not available yet: " + sanitizeError(result.error) };
      }
      return { ok: false, status: "failed", details: sanitizeError(result.error) };
    }
    return { ok: true, status: "ok" };
  } catch (error) {
    return { ok: false, status: "failed", details: sanitizeError(error) };
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Credentials", "true");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET" && req.method !== "HEAD") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const supabaseSummary = getSupabaseHealthSummary();
  const checks = { environment: "failed", supabase: null, auth: { hasSessionSecret: supabaseSummary.hasSessionSecret } };
  const supabase = await checkSupabase();
  checks.supabase = supabase;
  if (supabaseSummary.hasSessionSecret && supabase.ok && supabaseSummary.hasSupabaseUrl && supabaseSummary.hasSupabaseServiceRoleKey) {
    checks.environment = "ok";
  } else if (supabase.ok) {
    checks.environment = "degraded";
  }

  const status = checks.environment === "ok" ? 200 : 503;

  return res.status(status).json({
    status: checks.environment,
    timestamp: new Date().toISOString(),
    deployment: process.env.VERCEL_ENV || process.env.NODE_ENV || "unknown",
    config: {
      cacheSiteId: supabaseSummary.cacheSiteId,
      supabaseUrlSource: supabaseSummary.urlSource
    },
    checks
  });
}
