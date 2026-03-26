// POST /api/nulogy/run-catalog
// Runs one report from the generated Nulogy report catalog at a time so a client can iterate sequentially.

import fs from "node:fs/promises";
import path from "node:path";

import { executeReportRun, withNulogyCors } from "./_runner.js";

async function loadCatalog() {
  var metadataPath = path.join(process.cwd(), "docs", "nulogy", "reports-api-metadata.json");
  var text = await fs.readFile(metadataPath, "utf8");
  return JSON.parse(text);
}

function normalizeReportCodes(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error("reportCodes must be an array.");
  var seen = {};
  return value
    .map(function(entry) { return String(entry || "").trim(); })
    .filter(function(entry) {
      if (!entry) return false;
      if (seen[entry]) return false;
      seen[entry] = true;
      return true;
    });
}

function normalizeCursor(value) {
  var numeric = Number(value || 0);
  if (!Number.isFinite(numeric) || numeric < 0) return 0;
  return Math.floor(numeric);
}

export default async function handler(req, res) {
  withNulogyCors(res, ["POST", "OPTIONS"]);

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    var catalog = await loadCatalog();
    var requestedCodes = normalizeReportCodes(req.body && req.body.reportCodes);
    var overrides = req.body && typeof req.body.overrides === "object" && req.body.overrides ? req.body.overrides : {};
    var reports = Array.isArray(catalog && catalog.reports) ? catalog.reports : [];

    if (requestedCodes.length) {
      var requestedLookup = {};
      requestedCodes.forEach(function(code) { requestedLookup[code] = true; });
      reports = reports.filter(function(report) {
        return requestedLookup[report.reportCode];
      });
    }

    var cursor = normalizeCursor(req.body && req.body.cursor);
    if (!reports.length) {
      return res.status(400).json({ error: "No catalog reports available for execution." });
    }
    if (cursor >= reports.length) {
      return res.status(200).json({
        ok: true,
        complete: true,
        cursor: cursor,
        totalReports: reports.length,
        hasMore: false
      });
    }

    var report = reports[cursor];
    var override = overrides && overrides[report.reportCode] && typeof overrides[report.reportCode] === "object"
      ? overrides[report.reportCode]
      : {};
    var runInput = {
      report: report.reportCode,
      columns: Array.isArray(override.columns) ? override.columns : report.dataFields.map(function(field) { return field.name; }),
      filters: Array.isArray(override.filters) ? override.filters : undefined,
      sort_by: override.sort_by || override.sortBy,
      locale: override.locale || (req.body && req.body.locale) || "en_US",
      site_uuid: override.site_uuid || override.siteUuid || (req.body && (req.body.site_uuid || req.body.siteUuid)),
      waitForCompletion: req.body && req.body.waitForCompletion !== false,
      pollIntervalMs: req.body && req.body.pollIntervalMs,
      maxPolls: req.body && req.body.maxPolls
    };

    var result = await executeReportRun(runInput);
    var canAdvance = !!(result && result.ok && result.body && result.body.completed);
    return res.status(result.statusCode).json({
      ok: result.ok,
      cursor: cursor,
      nextCursor: canAdvance ? (cursor + 1) : cursor,
      advanceCursor: canAdvance,
      totalReports: reports.length,
      hasMore: canAdvance ? (cursor + 1 < reports.length) : true,
      catalogReport: {
        title: report.title,
        reportCode: report.reportCode,
        dataFieldCount: report.dataFieldCount,
        fixedFieldCount: report.fixedFieldCount,
        filterFieldCount: report.filterFieldCount,
        fixedFields: report.fixedFields,
        filterFields: report.filterFields
      },
      result: result.body
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
