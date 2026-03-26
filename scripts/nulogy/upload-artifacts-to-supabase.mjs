#!/usr/bin/env node

import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const DEFAULT_ARTIFACT_ROOT = path.resolve(process.cwd(), "artifacts/nulogy/runs");
const DEFAULT_BUCKET = process.env.NULOGY_ARTIFACTS_BUCKET || "nulogy-artifacts";
const DEFAULT_SITE_ID = process.env.CACHE_SITE_ID || "default";

export async function uploadArtifactRun(options = {}) {
  const cwd = path.resolve(options.cwd || process.cwd());
  loadLocalEnv(cwd);

  const runDir = await resolveRunDir(options.runDir || "");
  const runId = path.basename(runDir);
  const siteId = String(options.siteId || DEFAULT_SITE_ID).trim() || "default";
  const bucket = String(options.bucket || DEFAULT_BUCKET).trim() || DEFAULT_BUCKET;
  const dryRun = !!options.dryRun;
  const manifestPath = path.join(runDir, "manifest.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  const generatedAt = manifest.generatedAt || new Date().toISOString();
  const createdBy = String(options.createdBy || process.env.USER || process.env.LOGNAME || "local-script").trim();

  const supabase = dryRun ? null : createSupabaseAdmin();
  if (supabase) {
    await ensureBucket(supabase, bucket);
  }

  const uploadPlan = await buildUploadPlan({ runDir, runId, siteId, bucket, manifest });
  const runRecord = buildRunRecord({
    siteId,
    runId,
    generatedAt,
    manifest,
    bucket,
    manifestStoragePath: uploadPlan.manifestStoragePath,
    createdBy,
  });
  const reportRecords = buildReportRecords({
    siteId,
    runId,
    generatedAt,
    manifest,
    uploadPlan,
  });
  const fileRecords = buildFileRecords({
    siteId,
    runId,
    generatedAt,
    uploadPlan,
    reportRecords,
  });
  const fieldRecords = buildFieldRecords({
    siteId,
    runId,
    generatedAt,
    reportRecords,
  });

  if (supabase) {
    for (const item of uploadPlan.files) {
      await uploadStorageFile(supabase, bucket, item);
    }

    await upsertRunRecord(supabase, runRecord);
    await deleteExistingRunRows(supabase, siteId, runId);
    await insertMany(supabase, "nulogy_artifact_reports", reportRecords);
    await insertMany(supabase, "nulogy_artifact_files", fileRecords);
    await insertMany(supabase, "nulogy_artifact_report_fields", fieldRecords);
  }

  return {
    ok: true,
    dryRun,
    siteId,
    bucket,
    runId,
    runDir,
    generatedAt,
    uploadedFiles: uploadPlan.files.length,
    reportRecords: reportRecords.length,
    fieldRecords: fieldRecords.length,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await uploadArtifactRun({
    cwd: process.cwd(),
    runDir: args["run-dir"] || "",
    siteId: args["site-id"] || "",
    bucket: args.bucket || "",
    createdBy: args["created-by"] || "",
    dryRun: isTruthy(args["dry-run"]),
  });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = "true";
      continue;
    }
    args[key] = next;
    i += 1;
  }
  return args;
}

function isTruthy(value) {
  return /^(1|true|yes)$/i.test(String(value || "").trim());
}

function loadLocalEnv(cwd) {
  for (const fileName of [".env.local", ".env"]) {
    const fullPath = path.join(cwd, fileName);
    try {
      const text = readFileSync(fullPath, "utf8");
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
        if (!match) continue;
        const key = match[1];
        if (process.env[key]) continue;
        process.env[key] = String(match[2] || "").replace(/^['"]|['"]$/g, "");
      }
    } catch (error) {
      if (error && error.code === "ENOENT") continue;
      throw error;
    }
  }
}

function createSupabaseAdmin() {
  const url = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim();
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

async function resolveRunDir(runDirInput) {
  if (runDirInput) {
    return path.resolve(runDirInput);
  }
  const entries = await fs.readdir(DEFAULT_ARTIFACT_ROOT, { withFileTypes: true });
  const dirs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse();
  if (!dirs.length) {
    throw new Error(`No artifact runs found under ${DEFAULT_ARTIFACT_ROOT}.`);
  }
  return path.join(DEFAULT_ARTIFACT_ROOT, dirs[0]);
}

async function ensureBucket(supabase, bucket) {
  const existing = await supabase.storage.getBucket(bucket);
  if (!existing.error && existing.data) return;
  const created = await supabase.storage.createBucket(bucket, {
    public: false,
    fileSizeLimit: 104857600,
    allowedMimeTypes: ["application/json", "text/csv", "text/plain"],
  });
  if (created.error && !/already exists/i.test(String(created.error.message || ""))) {
    throw created.error;
  }
}

async function buildUploadPlan({ runDir, runId, siteId, bucket, manifest }) {
  const files = [];
  const manifestRelativePath = "manifest.json";
  const manifestUpload = await buildUploadItem({
    runDir,
    relativePath: manifestRelativePath,
    runId,
    siteId,
    bucket,
    reportCode: "",
    artifactType: "manifest",
  });
  files.push(manifestUpload);

  for (const report of manifest.reports || []) {
    const reportCode = String(report.reportCode || "").trim();
    if (!reportCode) continue;
    for (const name of ["request.json", "summary.json", "preview.json", "raw.csv"]) {
      const relativePath = path.posix.join("reports", reportCode, name);
      try {
        const item = await buildUploadItem({
          runDir,
          relativePath,
          runId,
          siteId,
          bucket,
          reportCode,
          artifactType: toArtifactType(name),
        });
        files.push(item);
      } catch (error) {
        if (error && error.code === "ENOENT") continue;
        throw error;
      }
    }
  }

  return {
    files,
    manifestStoragePath: manifestUpload.storagePath,
  };
}

async function buildUploadItem({ runDir, relativePath, runId, siteId, bucket, reportCode, artifactType }) {
  const localPath = path.join(runDir, ...relativePath.split("/"));
  const content = await fs.readFile(localPath);
  const storagePath = path.posix.join("site", siteId, "runs", runId, relativePath);
  return {
    localPath,
    relativePath,
    reportCode,
    artifactType,
    bucket,
    storagePath,
    content,
    contentType: contentTypeFor(relativePath),
    byteSize: content.byteLength,
    sha256: crypto.createHash("sha256").update(content).digest("hex"),
  };
}

function contentTypeFor(relativePath) {
  if (relativePath.endsWith(".csv")) return "text/csv";
  if (relativePath.endsWith(".json")) return "application/json";
  return "text/plain";
}

function toArtifactType(fileName) {
  if (fileName === "raw.csv") return "raw_csv";
  if (fileName === "request.json") return "request_json";
  if (fileName === "summary.json") return "summary_json";
  if (fileName === "preview.json") return "preview_json";
  return normalizeLooseKey(fileName).replace(/json$/, "_json");
}

function normalizeLooseKey(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function buildRunRecord({ siteId, runId, generatedAt, manifest, bucket, manifestStoragePath, createdBy }) {
  const reports = Array.isArray(manifest.reports) ? manifest.reports : [];
  const succeeded = reports.filter((report) => report && report.ok).length;
  const failed = reports.filter((report) => !report || !report.ok).length;
  return {
    site_id: siteId,
    run_id: runId,
    generated_at: generatedAt,
    mode: manifest.mode || "",
    proxy_base_url: manifest.proxyBaseUrl || null,
    metadata_path: manifest.metadataPath || "",
    output_dir: manifest.outputDir || "",
    manifest_storage_bucket: bucket,
    manifest_storage_path: manifestStoragePath,
    report_count: reports.length,
    succeeded_count: succeeded,
    failed_count: failed,
    manifest_json: manifest,
    created_by: createdBy,
  };
}

function buildReportRecords({ siteId, runId, generatedAt, manifest }) {
  return (manifest.reports || []).map((report) => {
    const requestBody = report && typeof report.requestBody === "object" ? report.requestBody : {};
    const csvSummary = report && report.csvSummary && typeof report.csvSummary === "object" ? report.csvSummary : {};
    return {
      site_id: siteId,
      run_id: runId,
      generated_at: generatedAt,
      report_code: String(report.reportCode || "").trim(),
      report_title: report.reportTitle || "",
      ok: !!report.ok,
      skipped: !!report.skipped,
      row_count: Number.isFinite(Number(csvSummary.rowCount)) ? Number(csvSummary.rowCount) : null,
      header_count: Array.isArray(csvSummary.headers) ? csvSummary.headers.length : 0,
      headers: Array.isArray(csvSummary.headers) ? csvSummary.headers : [],
      requested_columns: Array.isArray(requestBody.columns) ? requestBody.columns : [],
      maximum_rows: Number.isFinite(Number(report.maximumRows)) ? Number(report.maximumRows) : null,
      maximum_rows_text: report.maximumRowsText || "",
      possible_truncation: !!report.possibleTruncation,
      request_body: requestBody,
      preview_json: csvSummary,
      summary_json: report,
      status_url: report.statusUrl || "",
      download_url: report.downloadUrl || "",
      error: report.error || "",
    };
  }).filter((report) => report.report_code);
}

function buildFileRecords({ siteId, runId, generatedAt, uploadPlan, reportRecords }) {
  const reportByCode = {};
  reportRecords.forEach((report) => {
    reportByCode[report.report_code] = report;
  });
  return uploadPlan.files.map((file) => {
    const report = file.reportCode ? reportByCode[file.reportCode] : null;
    return {
      site_id: siteId,
      run_id: runId,
      generated_at: generatedAt,
      report_code: file.reportCode || "",
      artifact_type: file.artifactType,
      storage_bucket: file.bucket,
      storage_path: file.storagePath,
      content_type: file.contentType,
      byte_size: file.byteSize,
      sha256: file.sha256,
      row_count: file.artifactType === "raw_csv" && report ? report.row_count : null,
      header_count: file.artifactType === "raw_csv" && report ? report.header_count : null,
    };
  });
}

function buildFieldRecords({ siteId, runId, generatedAt, reportRecords }) {
  const rows = [];
  reportRecords.forEach((report) => {
    const pushFields = function(fieldSource, values) {
      (Array.isArray(values) ? values : []).forEach((fieldName, index) => {
        const normalized = normalizeFieldName(fieldName);
        if (!normalized) return;
        rows.push({
          site_id: siteId,
          run_id: runId,
          generated_at: generatedAt,
          report_code: report.report_code,
          field_source: fieldSource,
          ordinal: index + 1,
          field_name: String(fieldName || "").trim(),
          normalized_field_name: normalized,
        });
      });
    };
    pushFields("request_column", report.requested_columns);
    pushFields("csv_header", report.headers);
  });
  return dedupeFieldRecords(rows);
}

function dedupeFieldRecords(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = [
      row.site_id,
      row.run_id,
      row.report_code,
      row.field_source,
      row.normalized_field_name,
    ].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeFieldName(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

async function uploadStorageFile(supabase, bucket, item) {
  const uploaded = await supabase.storage.from(bucket).upload(item.storagePath, item.content, {
    contentType: item.contentType,
    upsert: true,
  });
  if (uploaded.error) throw uploaded.error;
}

async function upsertRunRecord(supabase, runRecord) {
  const response = await supabase
    .from("nulogy_artifact_runs")
    .upsert(runRecord, { onConflict: "site_id,run_id" });
  if (response.error) throw response.error;
}

async function deleteExistingRunRows(supabase, siteId, runId) {
  for (const table of ["nulogy_artifact_report_fields", "nulogy_artifact_files", "nulogy_artifact_reports"]) {
    const deleted = await supabase.from(table).delete().eq("site_id", siteId).eq("run_id", runId);
    if (deleted.error) throw deleted.error;
  }
}

async function insertMany(supabase, table, rows) {
  if (!rows.length) return;
  const chunkSize = 250;
  for (let start = 0; start < rows.length; start += chunkSize) {
    const response = await supabase.from(table).insert(rows.slice(start, start + chunkSize));
    if (response.error) throw response.error;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
