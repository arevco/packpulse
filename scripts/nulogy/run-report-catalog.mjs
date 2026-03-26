#!/usr/bin/env node

import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import Papa from "papaparse";

const DEFAULT_METADATA = path.resolve(process.cwd(), "docs/nulogy/reports-api-metadata.json");
const DEFAULT_ARTIFACT_ROOT = path.resolve(process.cwd(), "artifacts/nulogy/runs");
const DEFAULT_PROXY_BASE_URL = process.env.PACKPULSE_PROXY_BASE_URL || "";
const DEFAULT_NULOGY_URL = process.env.NULOGY_URL || "https://app.nulogy.net";

const PROXY_REPORT_TYPES = {
  inventory_snapshot: "inventory",
  project_status: "workorders",
  bom: "bom",
  item_master: "itemmaster",
  production: "production",
  labor: "labor",
};

async function main() {
  loadLocalEnv(process.cwd());

  const args = parseArgs(process.argv.slice(2));
  const metadataPath = path.resolve(args.metadata || DEFAULT_METADATA);
  const proxyBaseUrl = String(args["proxy-base-url"] || DEFAULT_PROXY_BASE_URL || "").trim().replace(/\/$/, "");
  const proxyRoute = String(args["proxy-route"] || "legacy").trim().toLowerCase();
  const selectedCodes = new Set(
    String(args.include || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  const pauseMs = parseInteger(args["pause-ms"], 2000);
  const pollMs = parseInteger(args["poll-ms"], 4000);
  const maxPolls = parseInteger(args["max-polls"], 90);
  const sampleSize = parseInteger(args["sample-size"], 25);

  const metadata = JSON.parse(await fs.readFile(metadataPath, "utf8"));
  const reports = metadata.reports.filter((report) => {
    if (!selectedCodes.size) return true;
    return selectedCodes.has(report.reportCode);
  });

  if (!reports.length) {
    throw new Error("No reports selected. Check the --include filter or metadata file.");
  }

  const mode = resolveMode(args.mode, proxyBaseUrl);
  const directContext =
    mode === "direct"
      ? {
          nulogyUrl: String(process.env.NULOGY_URL || DEFAULT_NULOGY_URL).trim().replace(/\/$/, ""),
          authHeader: buildBasicAuth(process.env.NULOGY_USER, process.env.NULOGY_PASS),
          siteUuid: String(process.env.NULOGY_SITE_UUID || "").trim(),
        }
      : null;

  const timestamp = new Date().toISOString().replace(/[:]/g, "-");
  const outputDir = path.resolve(args.output || path.join(DEFAULT_ARTIFACT_ROOT, timestamp));

  await fs.mkdir(outputDir, { recursive: true });
  await fs.mkdir(path.join(outputDir, "reports"), { recursive: true });

  const manifest = {
    generatedAt: new Date().toISOString(),
    metadataPath,
    mode,
    outputDir,
    proxyBaseUrl: proxyBaseUrl || null,
    reports: [],
  };

  for (let index = 0; index < reports.length; index += 1) {
    const report = reports[index];
    const reportDir = path.join(outputDir, "reports", report.reportCode);
    await fs.mkdir(reportDir, { recursive: true });

    const requestBody = buildRequestBody(report, directContext && directContext.siteUuid);
    await writeJson(path.join(reportDir, "request.json"), requestBody);

    let result;
    try {
      if (mode === "direct") {
        result = await runDirectReport({
          directContext,
          report,
          requestBody,
          reportDir,
          pollMs,
          maxPolls,
          sampleSize,
        });
      } else {
        result = await runProxyReport({
          proxyBaseUrl,
          proxyRoute,
          report,
          requestBody,
          reportDir,
          pollMs,
          maxPolls,
          sampleSize,
        });
      }
    } catch (error) {
      result = {
        ok: false,
        reportCode: report.reportCode,
        reportTitle: report.title,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    await writeJson(path.join(reportDir, "summary.json"), result);
    manifest.reports.push(result);

    if (index < reports.length - 1) {
      await sleep(pauseMs);
    }
  }

  await writeJson(path.join(outputDir, "manifest.json"), manifest);

  process.stdout.write(
    JSON.stringify(
      {
        ok: true,
        mode,
        outputDir,
        succeeded: manifest.reports.filter((report) => report.ok).length,
        failed: manifest.reports.filter((report) => !report.ok).length,
      },
      null,
      2,
    ) + "\n",
  );
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

function parseInteger(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : fallback;
}

function loadLocalEnv(cwd) {
  for (const fileName of [".env.local", ".env"]) {
    const fullPath = path.join(cwd, fileName);
    try {
      const text = requireText(fullPath);
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
        if (!match) continue;
        const key = match[1];
        if (process.env[key]) continue;
        let value = match[2] || "";
        value = value.replace(/^['"]|['"]$/g, "");
        process.env[key] = value;
      }
    } catch (error) {
      if (error && error.code === "ENOENT") continue;
      throw error;
    }
  }
}

function requireText(filePath) {
  return readFileSync(filePath, "utf8");
}

function resolveMode(mode, proxyBaseUrl) {
  if (mode === "direct") {
    ensureDirectCredentials();
    return "direct";
  }
  if (mode === "proxy") {
    if (!proxyBaseUrl) throw new Error("Proxy mode requires --proxy-base-url or PACKPULSE_PROXY_BASE_URL.");
    return "proxy";
  }
  if (process.env.NULOGY_USER && process.env.NULOGY_PASS) return "direct";
  if (proxyBaseUrl) return "proxy";
  throw new Error(
    "Could not resolve execution mode. Provide direct Nulogy credentials or set --proxy-base-url.",
  );
}

function ensureDirectCredentials() {
  if (!process.env.NULOGY_USER || !process.env.NULOGY_PASS) {
    throw new Error("Direct mode requires NULOGY_USER and NULOGY_PASS.");
  }
}

function buildBasicAuth(user, pass) {
  if (!user || !pass) throw new Error("Missing NULOGY_USER or NULOGY_PASS.");
  return `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
}

function buildRequestBody(report, siteUuid) {
  const body = {
    report: report.reportCode,
    columns: report.dataFields.map((field) => field.name),
    locale: "en_US",
  };
  if (!body.columns.length) delete body.columns;
  if (siteUuid) body.site_uuid = siteUuid;
  return body;
}

async function runDirectReport({
  directContext,
  report,
  requestBody,
  reportDir,
  pollMs,
  maxPolls,
  sampleSize,
}) {
  const createResponse = await fetchWithRetry(
    `${directContext.nulogyUrl}/api/reports/report_runs`,
    {
      method: "POST",
      headers: {
        Authorization: directContext.authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    },
    { retryOn429: true, label: `${report.reportCode} create` },
  );

  const createText = await createResponse.text();
  const createPayload = safeJson(createText);

  if (!(createResponse.ok || createResponse.status === 201)) {
    return buildFailure(report, requestBody, createResponse.status, createText);
  }

  const statusUrl =
    createResponse.headers.get("location") ||
    createResponse.headers.get("Location") ||
    createPayload.status_url ||
    (createPayload.task_id ? `${directContext.nulogyUrl}/api/reports/report_runs/${createPayload.task_id}` : "");

  if (!statusUrl) {
    return buildFailure(report, requestBody, createResponse.status, "Report created without a status URL.");
  }

  const statusHistory = [];
  const completed = await pollStatus({
    statusUrl,
    pollMs,
    maxPolls,
    authHeader: directContext.authHeader,
    statusHistory,
    label: report.reportCode,
  });

  if (!completed.ok) {
    return {
      ok: false,
      reportCode: report.reportCode,
      reportTitle: report.title,
      requestBody,
      statusUrl,
      statusHistory,
      error: completed.error,
    };
  }

  return await finalizeReportArtifact({
    report,
    requestBody,
    reportDir,
    statusUrl,
    statusHistory,
    downloadUrl: completed.downloadUrl,
    sampleSize,
    mode: "direct",
  });
}

async function runProxyReport({
  proxyBaseUrl,
  proxyRoute,
  report,
  requestBody,
  reportDir,
  pollMs,
  maxPolls,
  sampleSize,
}) {
  if (proxyRoute === "generic") {
    const createResponse = await fetchWithRetry(
      `${proxyBaseUrl}/api/nulogy/run-report`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          report: report.reportCode,
          columns: requestBody.columns || [],
          filters: requestBody.filters || [],
          sort_by: requestBody.sort_by || [],
          locale: requestBody.locale || "en_US",
          waitForCompletion: false,
        }),
      },
      { retryOn429: true, label: `${report.reportCode} proxy create` },
    );

    const createText = await createResponse.text();
    const createPayload = safeJson(createText);
    if (!(createResponse.ok || createResponse.status === 201)) {
      return buildFailure(report, requestBody, createResponse.status, createText);
    }
    if (!createPayload.statusUrl) {
      return buildFailure(report, requestBody, createResponse.status, "Generic proxy route omitted statusUrl.");
    }

    const statusHistory = [];
    const completed = await pollProxyStatus({
      proxyBaseUrl,
      statusUrl: createPayload.statusUrl,
      pollMs,
      maxPolls,
      statusHistory,
      label: report.reportCode,
    });

    if (!completed.ok) {
      return {
        ok: false,
        reportCode: report.reportCode,
        reportTitle: report.title,
        requestBody,
        statusUrl: createPayload.statusUrl,
        statusHistory,
        error: completed.error,
      };
    }

    return await finalizeReportArtifact({
      report,
      requestBody,
      reportDir,
      statusUrl: createPayload.statusUrl,
      statusHistory,
      downloadUrl: completed.downloadUrl,
      sampleSize,
      mode: "proxy",
    });
  }

  const reportType = PROXY_REPORT_TYPES[report.reportCode];
  if (!reportType) {
    return {
      ok: false,
      skipped: true,
      reportCode: report.reportCode,
      reportTitle: report.title,
      requestBody,
      error: "Legacy proxy mode only supports inventory_snapshot, project_status, bom, item_master, production, and labor.",
    };
  }

  const createResponse = await fetchWithRetry(
    `${proxyBaseUrl}/api/nulogy/create`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        reportType,
        syncProfile: "full",
      }),
    },
    { retryOn429: true, label: `${report.reportCode} proxy create` },
  );

  const createText = await createResponse.text();
  const createPayload = safeJson(createText);

  if (!(createResponse.ok || createResponse.status === 201)) {
    return buildFailure(report, requestBody, createResponse.status, createText);
  }

  const statusUrl = createPayload.statusUrl;
  if (!statusUrl) {
    return buildFailure(report, requestBody, createResponse.status, "Proxy create response omitted statusUrl.");
  }

  const statusHistory = [];
  const completed = await pollProxyStatus({
    proxyBaseUrl,
    statusUrl,
    pollMs,
    maxPolls,
    statusHistory,
    label: report.reportCode,
  });

  if (!completed.ok) {
    return {
      ok: false,
      reportCode: report.reportCode,
      reportTitle: report.title,
      requestBody,
      statusUrl,
      statusHistory,
      error: completed.error,
    };
  }

  return await finalizeReportArtifact({
    report,
    requestBody,
    reportDir,
    statusUrl,
    statusHistory,
    downloadUrl: completed.downloadUrl,
    sampleSize,
    mode: "proxy",
  });
}

async function pollStatus({ statusUrl, pollMs, maxPolls, authHeader, statusHistory, label }) {
  for (let attempt = 1; attempt <= maxPolls; attempt += 1) {
    await sleep(pollMs);
    const response = await fetchWithRetry(
      statusUrl,
      {
        headers: {
          Authorization: authHeader,
        },
      },
      { retryOn429: true, label: `${label} status` },
    );
    const text = await response.text();
    const payload = safeJson(text);
    statusHistory.push({
      attempt,
      statusCode: response.status,
      status: payload.status || "",
    });

    if (!response.ok) {
      return { ok: false, error: `Status poll failed (${response.status}): ${text.slice(0, 400)}` };
    }
    if (payload.status === "COMPLETED" && (payload.download_url || payload.url)) {
      return { ok: true, downloadUrl: payload.download_url || payload.url };
    }
    if (payload.status === "FAILED" || payload.status === "ERROR") {
      return { ok: false, error: `Nulogy report failed: ${text.slice(0, 400)}` };
    }
  }
  return { ok: false, error: "Timed out waiting for report completion." };
}

async function pollProxyStatus({ proxyBaseUrl, statusUrl, pollMs, maxPolls, statusHistory, label }) {
  for (let attempt = 1; attempt <= maxPolls; attempt += 1) {
    await sleep(pollMs);
    const response = await fetchWithRetry(
      `${proxyBaseUrl}/api/nulogy/status?url=${encodeURIComponent(statusUrl)}`,
      {},
      { retryOn429: true, label: `${label} proxy status` },
    );
    const text = await response.text();
    const payload = safeJson(text);
    statusHistory.push({
      attempt,
      statusCode: response.status,
      status: payload.status || "",
    });

    if (!response.ok) {
      return { ok: false, error: `Proxy status poll failed (${response.status}): ${text.slice(0, 400)}` };
    }
    if (payload.status === "COMPLETED" && payload.downloadUrl) {
      return { ok: true, downloadUrl: payload.downloadUrl };
    }
    if (payload.status === "FAILED" || payload.status === "ERROR") {
      return { ok: false, error: `Proxy report failed: ${text.slice(0, 400)}` };
    }
  }
  return { ok: false, error: "Timed out waiting for proxy report completion." };
}

async function finalizeReportArtifact({
  report,
  requestBody,
  reportDir,
  statusUrl,
  statusHistory,
  downloadUrl,
  sampleSize,
  mode,
}) {
  const csvResponse = await fetchWithRetry(downloadUrl, {}, { retryOn429: true, label: `${report.reportCode} download` });
  const csvText = await csvResponse.text();

  if (!csvResponse.ok) {
    return {
      ok: false,
      reportCode: report.reportCode,
      reportTitle: report.title,
      requestBody,
      statusUrl,
      statusHistory,
      error: `Download failed (${csvResponse.status}): ${csvText.slice(0, 400)}`,
    };
  }

  await fs.writeFile(path.join(reportDir, "raw.csv"), csvText);

  const csvSummary = summarizeCsv(csvText, sampleSize);
  const result = {
    ok: true,
    mode,
    reportCode: report.reportCode,
    reportTitle: report.title,
    requestBody,
    statusUrl,
    downloadUrl,
    statusHistory,
    maximumRows: report.maximumRows,
    maximumRowsText: report.maximumRowsText,
    possibleTruncation:
      Number.isFinite(report.maximumRows) && report.maximumRows > 0
        ? csvSummary.rowCount >= report.maximumRows
        : false,
    csvSummary,
  };

  await writeJson(path.join(reportDir, "preview.json"), csvSummary);
  return result;
}

function summarizeCsv(csvText, sampleSize) {
  const lines = String(csvText || "")
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "");
  const previewSource = lines.slice(0, sampleSize + 1).join("\n");
  const parsed = Papa.parse(previewSource, {
    header: true,
    skipEmptyLines: true,
  });

  return {
    rowCount: Math.max(0, lines.length - 1),
    headers: parsed.meta.fields || [],
    sampleRows: parsed.data.slice(0, sampleSize),
    rowCountMethod: "non-empty-line-count",
  };
}

function buildFailure(report, requestBody, statusCode, text) {
  return {
    ok: false,
    reportCode: report.reportCode,
    reportTitle: report.title,
    requestBody,
    statusCode,
    error: String(text || "").slice(0, 800),
  };
}

async function fetchWithRetry(url, options, { retryOn429, label }) {
  const maxAttempts = retryOn429 ? 4 : 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetch(url, options);
    if (response.status !== 429 || attempt === maxAttempts) return response;
    const backoffMs = attempt * 10_000;
    process.stderr.write(`${label}: received 429, backing off for ${backoffMs}ms\n`);
    await sleep(backoffMs);
  }
  throw new Error(`Unexpected retry exit for ${label}.`);
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, JSON.stringify(value, null, 2) + "\n");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
