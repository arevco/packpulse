import { CACHE_SITE_ID, getAuthenticatedUser, getSupabaseAdmin, withCors } from "../ops/_common.js";

export const DEFAULT_NULOGY_ARTIFACT_BUCKET = process.env.NULOGY_ARTIFACTS_BUCKET || "nulogy-artifacts";

export function withArtifactCors(req, res) {
  withCors(req, res, ["GET", "OPTIONS"]);
}

export function requireArtifactUser(req, res) {
  const user = getAuthenticatedUser(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  return user;
}

export function getArtifactSiteId(req) {
  return String((req.query && req.query.siteId) || CACHE_SITE_ID || "default").trim() || "default";
}

export function getArtifactSupabase() {
  return getSupabaseAdmin();
}

export function clampInt(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.round(numeric)));
}

export function parseBoolean(value, fallback = false) {
  if (value == null || value === "") return fallback;
  return /^(1|true|yes)$/i.test(String(value).trim());
}

export function normalizeFieldName(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function normalizeArtifactType(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  if (raw === "manifest.json" || raw === "manifest") return "manifest";
  if (raw === "raw.csv" || raw === "raw_csv" || raw === "rawcsv") return "raw_csv";
  if (raw === "request.json" || raw === "request_json" || raw === "requestjson") return "request_json";
  if (raw === "summary.json" || raw === "summary_json" || raw === "summaryjson") return "summary_json";
  if (raw === "preview.json" || raw === "preview_json" || raw === "previewjson") return "preview_json";
  return raw.replace(/[^a-z0-9]+/g, "_");
}

export function reportMatchesField(report, field) {
  const normalized = normalizeFieldName(field);
  if (!normalized) return { matched: true, matches: [] };
  const matches = [];
  const headers = Array.isArray(report && report.headers) ? report.headers : [];
  headers.forEach(function(header, index) {
    if (normalizeFieldName(header) === normalized) {
      matches.push({ source: "csv_header", fieldName: header, ordinal: index + 1 });
    }
  });
  const requested = Array.isArray(report && report.requested_columns) ? report.requested_columns : [];
  requested.forEach(function(column, index) {
    if (normalizeFieldName(column) === normalized) {
      matches.push({ source: "request_column", fieldName: column, ordinal: index + 1 });
    }
  });
  return { matched: matches.length > 0, matches };
}
