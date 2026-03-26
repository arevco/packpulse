#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_INPUT =
  process.env.NULOGY_REPORTS_HTML ||
  "/Users/aj/Downloads/Reports API Documentation _ Nulogy.html";

const DEFAULT_OUTPUT_DIR = path.resolve(process.cwd(), "docs/nulogy");

const COMMON_JOIN_FIELDS = [
  "item_code",
  "project_code",
  "job_id",
  "project_id",
  "customer_name",
  "lot_code",
  "pallet_number",
  "line",
  "line_name",
  "reference_1",
  "reference",
  "item_description",
  "finished_good_code",
  "subcomponent_code",
];

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputPath = path.resolve(args.input || DEFAULT_INPUT);
  const outputDir = path.resolve(args.outputDir || DEFAULT_OUTPUT_DIR);

  const html = await fs.readFile(inputPath, "utf8");
  const metadata = buildMetadata(html, inputPath);

  await fs.mkdir(outputDir, { recursive: true });

  const metadataPath = path.join(outputDir, "reports-api-metadata.json");
  const analysisPath = path.join(outputDir, "reports-key-analysis.json");
  const catalogPath = path.join(outputDir, "Reports-API-Catalog.md");

  await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2) + "\n");
  await fs.writeFile(analysisPath, JSON.stringify(metadata.analysis, null, 2) + "\n");
  await fs.writeFile(catalogPath, renderCatalog(metadata));

  process.stdout.write(
    JSON.stringify(
      {
        ok: true,
        reports: metadata.reports.length,
        metadataPath,
        analysisPath,
        catalogPath,
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

function buildMetadata(html, sourcePath) {
  const reports = extractReports(html);
  const fieldFrequency = computeFieldFrequency(reports);
  const joinKeyCoverage = COMMON_JOIN_FIELDS
    .map((field) => ({
      field,
      reports: reports
        .filter((report) => report.allFieldNames.includes(field))
        .map((report) => report.reportCode),
    }))
    .filter((entry) => entry.reports.length > 0);

  return {
    generatedAt: new Date().toISOString(),
    sourcePath,
    totalReports: reports.length,
    reports,
    analysis: {
      reportCodes: reports.map((report) => report.reportCode),
      rowLimits: reports
        .map((report) => ({
          reportCode: report.reportCode,
          maximumRowsText: report.maximumRowsText,
          maximumRows: report.maximumRows,
        }))
        .sort((a, b) => (b.maximumRows || 0) - (a.maximumRows || 0)),
      topSharedFields: fieldFrequency.slice(0, 50),
      joinKeyCoverage,
      reportsWithDateFilters: reports
        .filter((report) => report.dateLikeFilterFields.length > 0)
        .map((report) => ({
          reportCode: report.reportCode,
          dateLikeFilterFields: report.dateLikeFilterFields,
        })),
    },
  };
}

function extractReports(html) {
  const reportLinks = extractReportLinks(html);
  const reportStarts = reportLinks.map((report) => ({
    ...report,
    startIndex: findReportStart(html, report.anchor),
  }));

  return reportStarts
    .filter((report) => report.startIndex >= 0)
    .map((report, index) => {
      const next = reportStarts[index + 1];
      const endIndex = next && next.startIndex >= 0 ? next.startIndex : html.length;
      const sectionHtml = html.slice(report.startIndex, endIndex);
      return parseReportSection(report, sectionHtml);
    });
}

function extractReportLinks(html) {
  const sectionMatch = html.match(/<div id=['"]available-reports['"][\s\S]*?<ul>([\s\S]*?)<\/ul>/i);
  if (!sectionMatch) throw new Error("Could not find the available reports section.");

  const reports = [];
  const pattern = /<li>\s*<a href="#([^"]+)">([\s\S]*?)<\/a>\s*<\/li>/gi;
  for (const match of sectionMatch[1].matchAll(pattern)) {
    reports.push({
      anchor: match[1].trim(),
      title: normalizeWhitespace(stripTags(match[2])),
    });
  }
  return reports;
}

function findReportStart(html, anchor) {
  const pattern = new RegExp(`<div id=['"]${escapeRegExp(anchor)}['"]>`, "i");
  return html.search(pattern);
}

function parseReportSection(link, sectionHtml) {
  const title = extractFirst(sectionHtml, /<h2>([\s\S]*?)<\/h2>/i) || link.title;
  const reportCode = extractFirst(sectionHtml, /<strong>Report code:<\/strong>\s*<code>([\s\S]*?)<\/code>/i);
  const maximumRowsText =
    extractFirst(sectionHtml, /<strong>Maximum rows returned:<\/strong>\s*([\s\S]*?)<\/p>/i) || "";
  const dataFields = parseNamedFieldTable(sectionHtml, "Data Fields");
  const fixedFields = parseNamedFieldTable(sectionHtml, "Fixed Fields");
  const filterFields = parseSingleFieldTable(sectionHtml, "Filter Fields");
  const allFieldNames = Array.from(
    new Set([...dataFields, ...fixedFields].map((field) => field.name).filter(Boolean)),
  );
  const dateLikeFilterFields = filterFields.filter(isDateLikeField);

  return {
    anchor: link.anchor,
    title: normalizeWhitespace(title),
    reportCode: normalizeWhitespace(reportCode),
    maximumRowsText: normalizeWhitespace(stripTags(maximumRowsText)),
    maximumRows: parseMaximumRows(maximumRowsText),
    dataFields,
    fixedFields,
    filterFields,
    dataFieldCount: dataFields.length,
    fixedFieldCount: fixedFields.length,
    filterFieldCount: filterFields.length,
    dateLikeFilterFields,
    allFieldNames,
  };
}

function parseNamedFieldTable(sectionHtml, heading) {
  const tableHtml = extractTableAfterHeading(sectionHtml, heading);
  if (!tableHtml) return [];

  return parseTableRows(tableHtml)
    .slice(1)
    .map((cells) => {
      const name = extractFieldCode(cells[0] || "");
      const label = normalizeWhitespace(stripTags(cells[1] || ""));
      if (!name) return null;
      return { name, label };
    })
    .filter(Boolean);
}

function parseSingleFieldTable(sectionHtml, heading) {
  const tableHtml = extractTableAfterHeading(sectionHtml, heading);
  if (!tableHtml) return [];

  return parseTableRows(tableHtml)
    .slice(1)
    .map((cells) => extractFieldCode(cells[0] || ""))
    .filter(Boolean);
}

function extractTableAfterHeading(sectionHtml, heading) {
  const pattern = new RegExp(
    `<h3>\\s*${escapeRegExp(heading)}\\s*<\\/h3>[\\s\\S]*?<table[^>]*>([\\s\\S]*?)<\\/table>`,
    "i",
  );
  const match = sectionHtml.match(pattern);
  return match ? match[1] : "";
}

function parseTableRows(tableHtml) {
  const rows = [];
  const rowPattern = /<tr[\s\S]*?<\/tr>/gi;
  const cellPattern = /<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi;

  for (const rowMatch of tableHtml.matchAll(rowPattern)) {
    const cells = [];
    for (const cellMatch of rowMatch[0].matchAll(cellPattern)) {
      cells.push(cellMatch[1]);
    }
    if (cells.length) rows.push(cells);
  }

  return rows;
}

function extractFieldCode(cellHtml) {
  const tooltipMatch = cellHtml.match(/data-tooltip="([^"]+)"/i);
  if (tooltipMatch && tooltipMatch[1]) return decodeHtml(tooltipMatch[1]).trim();
  return normalizeWhitespace(stripTags(cellHtml));
}

function computeFieldFrequency(reports) {
  const counts = new Map();
  for (const report of reports) {
    const seen = new Set(report.allFieldNames);
    for (const field of seen) {
      counts.set(field, (counts.get(field) || 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .map(([field, reportCount]) => ({ field, reportCount }))
    .sort((a, b) => b.reportCount - a.reportCount || a.field.localeCompare(b.field));
}

function parseMaximumRows(value) {
  const text = normalizeWhitespace(stripTags(value));
  const numberMatch = text.match(/(\d+(?:\.\d+)?)/);
  if (!numberMatch) return null;
  let numeric = Number(numberMatch[1]);
  if (/million/i.test(text)) numeric *= 1_000_000;
  else if (/thousand/i.test(text)) numeric *= 1_000;
  return Number.isFinite(numeric) ? Math.round(numeric) : null;
}

function isDateLikeField(name) {
  const value = String(name || "").toLowerCase();
  return (
    /_at$/.test(value) ||
    /_date$/.test(value) ||
    /(^|_)date(_|$)/.test(value) ||
    /expiry|expiration|snapshot/.test(value) ||
    /_since$/.test(value)
  );
}

function renderCatalog(metadata) {
  const lines = [];
  lines.push("# Nulogy Reports API Catalog");
  lines.push("");
  lines.push(`Generated: \`${metadata.generatedAt}\``);
  lines.push("");
  lines.push(`Source HTML: \`${metadata.sourcePath}\``);
  lines.push("");
  lines.push(`Total reports: **${metadata.totalReports}**`);
  lines.push("");
  lines.push("## Report Summary");
  lines.push("");
  lines.push("| Report | Code | Max rows | Data fields | Fixed fields | Filter fields | Date-like filters |");
  lines.push("| --- | --- | ---: | ---: | ---: | ---: | --- |");
  for (const report of metadata.reports) {
    lines.push(
      `| ${escapePipe(report.title)} | \`${report.reportCode}\` | ${report.maximumRows || ""} | ${report.dataFieldCount} | ${report.fixedFieldCount} | ${report.filterFieldCount} | ${report.dateLikeFilterFields.map((field) => `\`${field}\``).join(", ")} |`,
    );
  }

  lines.push("");
  lines.push("## Shared Fields");
  lines.push("");
  lines.push("| Field | Reports |");
  lines.push("| --- | ---: |");
  for (const field of metadata.analysis.topSharedFields.slice(0, 25)) {
    lines.push(`| \`${field.field}\` | ${field.reportCount} |`);
  }

  for (const report of metadata.reports) {
    lines.push("");
    lines.push(`## ${report.title}`);
    lines.push("");
    lines.push(`- Anchor: \`${report.anchor}\``);
    lines.push(`- Report code: \`${report.reportCode}\``);
    lines.push(`- Maximum rows returned: ${report.maximumRowsText || "Not documented"}`);
    lines.push(`- Data fields: ${report.dataFieldCount}`);
    lines.push(`- Fixed fields: ${report.fixedFieldCount}`);
    lines.push(`- Filter fields: ${report.filterFieldCount}`);
    lines.push(
      `- Date-like filters: ${report.dateLikeFilterFields.length ? report.dateLikeFilterFields.map((field) => `\`${field}\``).join(", ") : "None detected"}`,
    );
    lines.push("");
    lines.push("### Data Fields");
    lines.push("");
    lines.push(renderFieldTable(report.dataFields));
    if (report.fixedFields.length) {
      lines.push("");
      lines.push("### Fixed Fields");
      lines.push("");
      lines.push(renderFieldTable(report.fixedFields));
    }
    lines.push("");
    lines.push("### Filter Fields");
    lines.push("");
    lines.push(renderFilterTable(report.filterFields));
  }

  return lines.join("\n") + "\n";
}

function renderFieldTable(fields) {
  if (!fields.length) return "_None documented._";
  const lines = [];
  lines.push("| Field | Label |");
  lines.push("| --- | --- |");
  for (const field of fields) {
    lines.push(`| \`${field.name}\` | ${escapePipe(field.label)} |`);
  }
  return lines.join("\n");
}

function renderFilterTable(fields) {
  if (!fields.length) return "_None documented._";
  const lines = [];
  lines.push("| Field |");
  lines.push("| --- |");
  for (const field of fields) {
    lines.push(`| \`${field}\` |`);
  }
  return lines.join("\n");
}

function extractFirst(text, pattern) {
  const match = text.match(pattern);
  return match && match[1] ? decodeHtml(match[1]).trim() : "";
}

function stripTags(value) {
  return decodeHtml(String(value || "").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " "));
}

function normalizeWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)));
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapePipe(value) {
  return String(value || "").replace(/\|/g, "\\|");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
