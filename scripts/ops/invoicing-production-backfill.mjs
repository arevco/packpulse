#!/usr/bin/env node

import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { runInvoicingProductionBackfill } from "../../api/ops/_invoicing-production-backfill.js";

async function main() {
  loadLocalEnv(process.cwd());

  const args = parseArgs(process.argv.slice(2));
  const startDate = sanitizeIsoDate(args.start || args["start-date"]);
  const endDate = sanitizeIsoDate(args.end || args["end-date"]);
  if (!startDate || !endDate || endDate < startDate) {
    throw new Error("Provide --start YYYY-MM-DD and --end YYYY-MM-DD.");
  }

  const workOrders = String(args["work-orders"] || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const updatedBy =
    String(args["updated-by"] || process.env.VITE_DEV_BYPASS_EMAIL || process.env.USER || "codex").trim() || "codex";

  const result = await runInvoicingProductionBackfill({
    startDate,
    endDate,
    focusWorkOrders: workOrders,
    updatedBy
  });

  if (args.output) {
    const outputPath = path.resolve(args.output);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, JSON.stringify(result, null, 2) + "\n", "utf8");
  }

  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  if (result && result.ok === false && !result.pending) process.exitCode = 2;
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

function sanitizeIsoDate(value) {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function loadLocalEnv(cwd) {
  const extraFiles = String(process.env.CODEX_ENV_FILES || "")
    .split(path.delimiter)
    .map((value) => value.trim())
    .filter(Boolean);
  const files = extraFiles.concat([".env.local", ".env"]);
  for (const fileName of files) {
    const fullPath = path.isAbsolute(fileName) ? fileName : path.join(cwd, fileName);
    try {
      const text = readFileSync(fullPath, "utf8");
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

main().catch((error) => {
  process.stderr.write((error && error.message ? error.message : String(error)) + "\n");
  process.exit(1);
});
