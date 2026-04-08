import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

const ET_TIME_ZONE = "America/New_York";
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SNAPSHOT_SELECT = "site_id,payload,row_counts,synced_at,updated_by";
const SNAPSHOT_HISTORY_SELECT = "site_id,row_counts,derived_metrics,captured_at,updated_by";

let envLoaded = false;

const DOC_RESOURCE_SPECS = [
  {
    name: "architecture-doc",
    uri: "packpulse://docs/architecture",
    title: "PackPulse Architecture",
    description: "High-level PackPulse architecture and data flow.",
    mimeType: "text/markdown",
    path: path.join(PROJECT_ROOT, "docs/Architecture.md"),
  },
  {
    name: "api-contracts-doc",
    uri: "packpulse://docs/api-contracts",
    title: "PackPulse API Contracts",
    description: "Existing PackPulse route contracts and request shapes.",
    mimeType: "text/markdown",
    path: path.join(PROJECT_ROOT, "docs/API-Contracts.md"),
  },
  {
    name: "data-dictionary-doc",
    uri: "packpulse://docs/data-dictionary",
    title: "PackPulse Data Dictionary",
    description: "Deterministic KPI definitions used by PackPulse.",
    mimeType: "text/markdown",
    path: path.join(PROJECT_ROOT, "docs/Data-Dictionary.md"),
  },
  {
    name: "ai-routing-doc",
    uri: "packpulse://docs/ai-intent-routing",
    title: "PackPulse AI Intent Routing",
    description: "Rules for deterministic versus model-driven answers in Ask AI.",
    mimeType: "text/markdown",
    path: path.join(PROJECT_ROOT, "docs/AI-Intent-Routing.md"),
  },
];

function toText(value) {
  return value == null ? "" : String(value).trim();
}

function toNum(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (value == null || value === "") return 0;
  const parsed = parseFloat(String(value).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function round(value, digits = 2) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return 0;
  const factor = 10 ** digits;
  return Math.round(num * factor) / factor;
}

function ratio(numerator, denominator, digits = 2) {
  const num = Number(numerator || 0);
  const den = Number(denominator || 0);
  if (!(den > 0)) return null;
  return round(num / den, digits);
}

function normalizeKey(value) {
  return String(value || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function normalizeQueryTokens(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .split(/\s+/g)
    .map(normalizeKey)
    .filter(Boolean);
}

function pickFieldLoose(row, keys) {
  if (!row || typeof row !== "object") return "";
  const rowKeys = Object.keys(row);
  for (let i = 0; i < keys.length; i += 1) {
    const target = String(keys[i]).toLowerCase();
    for (let j = 0; j < rowKeys.length; j += 1) {
      const rowKey = rowKeys[j];
      if (String(rowKey).toLowerCase() === target) return row[rowKey];
    }
  }
  const wanted = new Set(keys.map(normalizeKey));
  for (let i = 0; i < rowKeys.length; i += 1) {
    const rowKey = rowKeys[i];
    if (wanted.has(normalizeKey(rowKey))) return row[rowKey];
  }
  return "";
}

function statusLooksClosed(status) {
  const text = String(status || "").toLowerCase();
  return !!text && (
    text.includes("close") ||
    text.includes("complete") ||
    text.includes("cancel") ||
    text.includes("archive") ||
    text.includes("done")
  );
}

function parseEnvFile(contents) {
  const values = {};
  const lines = String(contents || "").split(/\r?\n/g);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    let value = match[2] || "";
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value.replace(/\\n/g, "\n");
  }
  return values;
}

export async function loadLocalEnv() {
  if (envLoaded) return;
  envLoaded = true;
  const protectedKeys = new Set(Object.keys(process.env));
  const envFiles = [
    path.join(PROJECT_ROOT, ".env"),
    path.join(PROJECT_ROOT, ".env.local"),
  ];
  for (const envPath of envFiles) {
    try {
      const parsed = parseEnvFile(await fs.readFile(envPath, "utf8"));
      for (const [key, value] of Object.entries(parsed)) {
        if (protectedKeys.has(key)) continue;
        process.env[key] = value;
      }
    } catch (error) {
      if (error && error.code === "ENOENT") continue;
      throw error;
    }
  }
}

function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const siteId = process.env.CACHE_SITE_ID || "default";
  return { url, serviceRoleKey, siteId };
}

export function getProjectRoot() {
  return PROJECT_ROOT;
}

export function getDocResources() {
  return DOC_RESOURCE_SPECS.map((resource) => ({
    name: resource.name,
    uri: resource.uri,
    title: resource.title,
    description: resource.description,
    mimeType: resource.mimeType,
  }));
}

export async function readDocResource(uri) {
  const match = DOC_RESOURCE_SPECS.find((resource) => resource.uri === uri);
  if (!match) throw new Error(`Unknown doc resource: ${uri}`);
  return {
    uri: match.uri,
    mimeType: match.mimeType,
    text: await fs.readFile(match.path, "utf8"),
  };
}

export async function getRuntimeConfigSummary() {
  await loadLocalEnv();
  const { url, serviceRoleKey, siteId } = getSupabaseConfig();
  return {
    projectRoot: PROJECT_ROOT,
    siteId,
    hasSupabaseUrl: !!url,
    hasServiceRoleKey: !!serviceRoleKey,
    loadedEnvFiles: [".env", ".env.local"],
  };
}

async function createSupabaseAdmin() {
  await loadLocalEnv();
  const { url, serviceRoleKey } = getSupabaseConfig();
  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. " +
      "Start the MCP server with PackPulse server env vars available."
    );
  }
  return createClient(url, serviceRoleKey, { auth: { persistSession: false } });
}

function describeError(error) {
  return String(
    (error && (error.message || error.details || error.hint || error.code)) ||
    error ||
    ""
  ).trim();
}

function isMissingRelationError(error, relationName) {
  const message = describeError(error).toLowerCase();
  const relation = String(relationName || "").toLowerCase();
  return !!relation && message.includes(relation) && (
    message.includes("schema cache") ||
    message.includes("could not find the table") ||
    message.includes("relation") ||
    message.includes("does not exist")
  );
}

function sanitizeDateKey(value) {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function toEasternDateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = {};
  new Intl.DateTimeFormat("en-US", {
    timeZone: ET_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date).forEach((part) => {
    if (part.type !== "literal") parts[part.type] = part.value;
  });
  return parts.year && parts.month && parts.day
    ? `${parts.year}-${parts.month}-${parts.day}`
    : "";
}

function shiftIsoDate(dateKey, deltaDays) {
  const clean = sanitizeDateKey(dateKey);
  if (!clean) return "";
  const date = new Date(`${clean}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + Number(deltaDays || 0));
  return date.toISOString().slice(0, 10);
}

function diffDaysInclusive(start, end) {
  const startKey = sanitizeDateKey(start);
  const endKey = sanitizeDateKey(end);
  if (!startKey || !endKey) return 0;
  const startDate = new Date(`${startKey}T00:00:00Z`);
  const endDate = new Date(`${endKey}T00:00:00Z`);
  const diffMs = endDate.getTime() - startDate.getTime();
  return Math.floor(diffMs / 86400000) + 1;
}

function resolveWindow({ start, end, days }, defaults = {}) {
  const defaultDays = Math.max(1, Number(defaults.defaultDays || 7));
  const maxDays = Math.max(defaultDays, Number(defaults.maxDays || 62));
  const todayEt = toEasternDateKey(new Date());
  let startKey = sanitizeDateKey(start);
  let endKey = sanitizeDateKey(end);
  const requestedDays = Math.max(1, Math.min(maxDays, Number(days || defaultDays)));

  if (!endKey) endKey = todayEt;
  if (!startKey) startKey = shiftIsoDate(endKey, -(requestedDays - 1));
  if (!startKey || !endKey) throw new Error("Could not resolve date window");
  if (startKey > endKey) throw new Error("Start date must be on or before end date");

  const resolvedDays = diffDaysInclusive(startKey, endKey);
  if (resolvedDays > maxDays) {
    throw new Error(`Date window is too large. Maximum supported window is ${maxDays} days.`);
  }

  return { start: startKey, end: endKey, days: resolvedDays };
}

async function fetchAllPages(fetchPage, options = {}) {
  const pageSize = Math.max(1, Number(options.pageSize || 1000));
  const maxPages = Math.max(1, Number(options.maxPages || 200));
  const rows = [];
  let from = 0;
  for (let page = 0; page < maxPages; page += 1) {
    const to = from + pageSize - 1;
    const result = await fetchPage(from, to);
    if (result.error) throw result.error;
    const chunk = Array.isArray(result.data) ? result.data : [];
    rows.push(...chunk);
    if (chunk.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

async function fetchLatestSnapshot(supabase, siteId) {
  const result = await supabase
    .from("cache_snapshots")
    .select(SNAPSHOT_SELECT)
    .eq("site_id", siteId)
    .maybeSingle();
  if (result.error) throw result.error;
  return result.data || null;
}

async function fetchSnapshotHistory(supabase, siteId, limit = 10) {
  const result = await supabase
    .from("cache_snapshot_history")
    .select(SNAPSHOT_HISTORY_SELECT)
    .eq("site_id", siteId)
    .order("captured_at", { ascending: false })
    .limit(Math.max(1, Math.min(50, Number(limit || 10))));
  if (result.error) throw result.error;
  return Array.isArray(result.data) ? result.data : [];
}

function deriveSnapshotMetrics(payload, rowCounts) {
  const workOrders = Array.isArray(payload && payload.workOrders) ? payload.workOrders : [];
  let remainingUnits = 0;
  let lateWos = 0;
  let activeWos = 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  workOrders.forEach((workOrder) => {
    const status = pickFieldLoose(workOrder, ["Work Order Status", "status", "project_status"]);
    let unitsRemaining = toNum(pickFieldLoose(workOrder, ["Units Remaining", "units_remaining"]));
    if (!(unitsRemaining > 0)) {
      const expected = toNum(pickFieldLoose(workOrder, ["Units Expected", "units_expected", "Order Qty", "qtyToProduce"]));
      const produced = toNum(pickFieldLoose(workOrder, ["Units Produced", "units_produced", "Produced", "unitsProduced"]));
      unitsRemaining = Math.max(0, expected - produced);
    }
    remainingUnits += unitsRemaining;
    const closed = statusLooksClosed(status);
    if (!closed && unitsRemaining > 0) activeWos += 1;
    const dueRaw = pickFieldLoose(workOrder, ["Due Date", "due_date_at", "dueDate"]);
    if (!closed && unitsRemaining > 0 && dueRaw) {
      const dueDate = new Date(dueRaw);
      if (!Number.isNaN(dueDate.getTime()) && dueDate < today) lateWos += 1;
    }
  });

  return {
    woCount: Number(rowCounts && rowCounts.workOrders) || 0,
    woActive: activeWos,
    woLate: lateWos,
    woRemainingUnits: Math.round(remainingUnits),
    inventoryRows: Number(rowCounts && rowCounts.inventory) || 0,
    productionRows: Number(rowCounts && rowCounts.productionData) || 0,
    laborRows: Number(rowCounts && rowCounts.laborData) || 0,
    evoconRows: Number(rowCounts && rowCounts.evoconData) || 0,
    bomRows: Number(rowCounts && rowCounts.boms) || 0,
    edrRows: Number(rowCounts && rowCounts.edrData) || 0,
    dockRows: Number(rowCounts && rowCounts.dockData) || 0,
  };
}

function summarizeSnapshotPayload(snapshot, historyRows) {
  if (!snapshot) {
    return {
      snapshotFound: false,
      siteId: null,
      syncedAt: null,
      updatedBy: "",
      freshnessMinutes: null,
      rowCounts: {},
      derivedMetrics: {},
      availableDatasets: [],
      snapshotVersion: "",
      historyStatus: Array.isArray(historyRows) ? "ok" : "unavailable",
    };
  }

  const rowCounts = snapshot.row_counts && typeof snapshot.row_counts === "object"
    ? snapshot.row_counts
    : {};
  const derivedMetrics = Array.isArray(historyRows) && historyRows[0] && historyRows[0].derived_metrics
    ? historyRows[0].derived_metrics
    : deriveSnapshotMetrics(snapshot.payload || {}, rowCounts);
  const syncedAt = snapshot.synced_at || null;
  const freshnessMinutes = syncedAt
    ? round((Date.now() - new Date(syncedAt).getTime()) / 60000, 1)
    : null;
  const snapshotVersion = toText(snapshot && snapshot.payload && snapshot.payload.meta && snapshot.payload.meta.snapshotVersion);
  const availableDatasets = Object.keys(rowCounts).filter((key) => Number(rowCounts[key] || 0) > 0);

  return {
    snapshotFound: true,
    siteId: snapshot.site_id || null,
    syncedAt,
    updatedBy: snapshot.updated_by || "",
    freshnessMinutes,
    rowCounts,
    derivedMetrics,
    availableDatasets,
    snapshotVersion,
    historyStatus: Array.isArray(historyRows) ? "ok" : "unavailable",
  };
}

export async function getSnapshotStatus() {
  const supabase = await createSupabaseAdmin();
  const { siteId } = getSupabaseConfig();
  const snapshot = await fetchLatestSnapshot(supabase, siteId);
  let historyRows = [];
  try {
    historyRows = await fetchSnapshotHistory(supabase, siteId, 1);
  } catch (error) {
    if (!isMissingRelationError(error, "cache_snapshot_history")) throw error;
    historyRows = null;
  }
  return summarizeSnapshotPayload(snapshot, historyRows);
}

export async function getSnapshotHistoryResource(limit = 10) {
  const supabase = await createSupabaseAdmin();
  const { siteId } = getSupabaseConfig();
  const snapshot = await fetchLatestSnapshot(supabase, siteId);
  let historyRows = [];
  let historyStatus = "ok";
  try {
    historyRows = await fetchSnapshotHistory(supabase, siteId, limit);
  } catch (error) {
    if (!isMissingRelationError(error, "cache_snapshot_history")) throw error;
    historyRows = [];
    historyStatus = "missing_history_table";
  }

  return {
    snapshot: summarizeSnapshotPayload(snapshot, historyRows),
    historyStatus,
    history: historyRows.map((row) => ({
      capturedAt: row.captured_at || null,
      updatedBy: row.updated_by || "",
      rowCounts: row.row_counts || {},
      derivedMetrics: row.derived_metrics || {},
    })),
  };
}

async function fetchOpsMetricRows(supabase, siteId, window) {
  return fetchAllPages((from, to) => (
    supabase
      .from("ops_daily_line_metrics_mv")
      .select(
        "date_et,shift_label,line_name,produced_units,production_rows,labor_rows,payable_hours,productive_hours,labor_cost"
      )
      .eq("site_id", siteId)
      .gte("date_et", window.start)
      .lte("date_et", window.end)
      .order("date_et", { ascending: false })
      .range(from, to)
  ), { pageSize: 1000, maxPages: 150 });
}

async function fetchProductionEvents(supabase, siteId, window) {
  return fetchAllPages((from, to) => (
    supabase
      .from("production_events")
      .select("produced_date_et,produced_at_utc,shift_label,units_produced,line,item_code,work_order_code")
      .eq("site_id", siteId)
      .gte("produced_date_et", window.start)
      .lte("produced_date_et", window.end)
      .order("produced_date_et", { ascending: false })
      .range(from, to)
  ), { pageSize: 1000, maxPages: 250 });
}

async function fetchLaborEvents(supabase, siteId, window) {
  return fetchAllPages((from, to) => (
    supabase
      .from("labor_events")
      .select("worked_date_et,worked_at_utc,shift_label,line_name,role_name,payable_hours,productive_hours,hourly_rate")
      .eq("site_id", siteId)
      .gte("worked_date_et", window.start)
      .lte("worked_date_et", window.end)
      .order("worked_date_et", { ascending: false })
      .range(from, to)
  ), { pageSize: 1000, maxPages: 250 });
}

function createOpsBucket(seed = {}) {
  return {
    producedUnits: 0,
    productionRows: 0,
    laborRows: 0,
    payableHours: 0,
    productiveHours: 0,
    laborCost: 0,
    ...seed,
  };
}

function finalizeOpsBucket(bucket) {
  return {
    ...bucket,
    producedUnits: round(bucket.producedUnits, 2),
    productionRows: Math.round(bucket.productionRows),
    laborRows: Math.round(bucket.laborRows),
    payableHours: round(bucket.payableHours, 2),
    productiveHours: round(bucket.productiveHours, 2),
    laborCost: round(bucket.laborCost, 2),
    casesPerPayableHour: ratio(bucket.producedUnits, bucket.payableHours, 2),
    casesPerProductiveHour: ratio(bucket.producedUnits, bucket.productiveHours, 2),
  };
}

function aggregateMetricRows(rows) {
  const totals = createOpsBucket();
  const byDay = new Map();
  const byShift = new Map();
  const byLine = new Map();

  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const date = toText(row.date_et);
    const shift = toText(row.shift_label) || "Unassigned";
    const line = toText(row.line_name) || "Unknown";
    const producedUnits = toNum(row.produced_units);
    const productionRows = toNum(row.production_rows);
    const laborRows = toNum(row.labor_rows);
    const payableHours = toNum(row.payable_hours);
    const productiveHours = toNum(row.productive_hours);
    const laborCost = toNum(row.labor_cost);
    if (!date) return;

    const apply = (target) => {
      target.producedUnits += producedUnits;
      target.productionRows += productionRows;
      target.laborRows += laborRows;
      target.payableHours += payableHours;
      target.productiveHours += productiveHours;
      target.laborCost += laborCost;
    };

    apply(totals);
    if (!byDay.has(date)) byDay.set(date, createOpsBucket({ date }));
    if (!byShift.has(shift)) byShift.set(shift, createOpsBucket({ shift }));
    if (!byLine.has(line)) byLine.set(line, createOpsBucket({ line }));
    apply(byDay.get(date));
    apply(byShift.get(shift));
    apply(byLine.get(line));
  });

  return {
    totals: finalizeOpsBucket(totals),
    byDay: Array.from(byDay.values())
      .map(finalizeOpsBucket)
      .sort((a, b) => String(b.date || "").localeCompare(String(a.date || ""))),
    byShift: Array.from(byShift.values())
      .map(finalizeOpsBucket)
      .sort((a, b) => b.producedUnits - a.producedUnits || String(a.shift || "").localeCompare(String(b.shift || ""))),
    topLines: Array.from(byLine.values())
      .map(finalizeOpsBucket)
      .sort((a, b) => b.producedUnits - a.producedUnits || b.laborCost - a.laborCost),
  };
}

function aggregateFallbackRows(productionRows, laborRows) {
  const totals = createOpsBucket();
  const byDay = new Map();
  const byShift = new Map();
  const byLine = new Map();

  const touchBucket = (map, key, seed) => {
    if (!map.has(key)) map.set(key, createOpsBucket(seed));
    return map.get(key);
  };

  const apply = (target, values) => {
    target.producedUnits += values.producedUnits || 0;
    target.productionRows += values.productionRows || 0;
    target.laborRows += values.laborRows || 0;
    target.payableHours += values.payableHours || 0;
    target.productiveHours += values.productiveHours || 0;
    target.laborCost += values.laborCost || 0;
  };

  (Array.isArray(productionRows) ? productionRows : []).forEach((row) => {
    const date = toText(row.produced_date_et) || toEasternDateKey(row.produced_at_utc);
    if (!date) return;
    const shift = toText(row.shift_label) || "Unassigned";
    const line = toText(row.line) || "Unknown";
    const values = {
      producedUnits: toNum(row.units_produced),
      productionRows: 1,
    };
    apply(totals, values);
    apply(touchBucket(byDay, date, { date }), values);
    apply(touchBucket(byShift, shift, { shift }), values);
    apply(touchBucket(byLine, line, { line }), values);
  });

  (Array.isArray(laborRows) ? laborRows : []).forEach((row) => {
    const date = toText(row.worked_date_et) || toEasternDateKey(row.worked_at_utc);
    if (!date) return;
    const shift = toText(row.shift_label) || "Unassigned";
    const line = toText(row.line_name) || "Unknown";
    const values = {
      laborRows: 1,
      payableHours: toNum(row.payable_hours),
      productiveHours: toNum(row.productive_hours),
      laborCost: toNum(row.payable_hours) * toNum(row.hourly_rate),
    };
    apply(totals, values);
    apply(touchBucket(byDay, date, { date }), values);
    apply(touchBucket(byShift, shift, { shift }), values);
    apply(touchBucket(byLine, line, { line }), values);
  });

  return {
    totals: finalizeOpsBucket(totals),
    byDay: Array.from(byDay.values())
      .map(finalizeOpsBucket)
      .sort((a, b) => String(b.date || "").localeCompare(String(a.date || ""))),
    byShift: Array.from(byShift.values())
      .map(finalizeOpsBucket)
      .sort((a, b) => b.producedUnits - a.producedUnits || b.payableHours - a.payableHours),
    topLines: Array.from(byLine.values())
      .map(finalizeOpsBucket)
      .sort((a, b) => b.producedUnits - a.producedUnits || b.laborCost - a.laborCost),
  };
}

function aggregateTopSkus(rows, limit) {
  const bySku = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const itemCode = toText(row.item_code) || "UNKNOWN";
    if (!bySku.has(itemCode)) {
      bySku.set(itemCode, {
        itemCode,
        producedUnits: 0,
        productionRows: 0,
        workOrders: new Set(),
      });
    }
    const sku = bySku.get(itemCode);
    sku.producedUnits += toNum(row.units_produced);
    sku.productionRows += 1;
    if (row.work_order_code) sku.workOrders.add(String(row.work_order_code));
  });

  return Array.from(bySku.values())
    .map((row) => ({
      itemCode: row.itemCode,
      producedUnits: round(row.producedUnits, 2),
      productionRows: Math.round(row.productionRows),
      workOrderCount: row.workOrders.size,
    }))
    .sort((a, b) => b.producedUnits - a.producedUnits || b.productionRows - a.productionRows)
    .slice(0, Math.max(1, Math.min(50, Number(limit || 10))));
}

export async function getOperationsSummary(options = {}) {
  const supabase = await createSupabaseAdmin();
  const { siteId } = getSupabaseConfig();
  const window = resolveWindow(options, { defaultDays: 7, maxDays: 62 });
  const skuLimit = Math.max(1, Math.min(50, Number(options.skuLimit || 10)));
  const lineLimit = Math.max(1, Math.min(50, Number(options.lineLimit || 10)));

  let source = "ops_daily_line_metrics_mv";
  let notes = [];
  let aggregate = null;
  let productionRows = [];
  let laborRows = [];

  try {
    const metricRows = await fetchOpsMetricRows(supabase, siteId, window);
    aggregate = aggregateMetricRows(metricRows);
  } catch (error) {
    if (!isMissingRelationError(error, "ops_daily_line_metrics_mv")) throw error;
    source = "production_events + labor_events";
    notes.push("ops_daily_line_metrics_mv is unavailable, so the summary was computed from raw event tables.");
    productionRows = await fetchProductionEvents(supabase, siteId, window);
    laborRows = await fetchLaborEvents(supabase, siteId, window);
    aggregate = aggregateFallbackRows(productionRows, laborRows);
  }

  if (!productionRows.length) {
    productionRows = await fetchProductionEvents(supabase, siteId, window);
  }

  const snapshot = await fetchLatestSnapshot(supabase, siteId).catch(() => null);
  const topSkus = aggregateTopSkus(productionRows, skuLimit);

  return {
    siteId,
    source,
    notes,
    window,
    snapshotSyncedAt: snapshot && snapshot.synced_at ? snapshot.synced_at : null,
    totals: aggregate.totals,
    byDay: aggregate.byDay,
    byShift: aggregate.byShift,
    topLines: aggregate.topLines.slice(0, lineLimit),
    topSkus,
  };
}

function normalizeDueDate(value) {
  const direct = sanitizeDateKey(value);
  if (direct) return direct;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

function mapWorkOrderRow(row, todayEt) {
  const workOrderCode = toText(pickFieldLoose(row, ["Work Order Code", "project_code", "Project Code", "work_order_code"]));
  const itemCode = toText(pickFieldLoose(row, ["Item Code", "item_code", "SKU", "sku"]));
  const itemDescription = toText(pickFieldLoose(row, ["Item Description", "item_description", "Description", "description"]));
  const customerName = toText(pickFieldLoose(row, ["Customer Name", "customer_name", "Customer", "customer"]));
  const status = toText(pickFieldLoose(row, ["Work Order Status", "status", "project_status"]));
  const unitsExpected = toNum(pickFieldLoose(row, ["Units Expected", "units_expected", "Order Qty", "qtyToProduce"]));
  const unitsProduced = toNum(pickFieldLoose(row, ["Units Produced", "units_produced", "Produced", "unitsProduced"]));
  const explicitRemaining = toNum(pickFieldLoose(row, ["Units Remaining", "units_remaining"]));
  const unitsRemaining = explicitRemaining > 0 ? explicitRemaining : Math.max(0, unitsExpected - unitsProduced);
  const dueDate = normalizeDueDate(pickFieldLoose(row, ["Due Date", "due_date_at", "dueDate"]));
  const closed = statusLooksClosed(status) || !(unitsRemaining > 0);
  const late = !closed && !!dueDate && dueDate < todayEt;
  const dueSoon = !closed && !late && !!dueDate && dueDate <= shiftIsoDate(todayEt, 7);
  const priority = late ? "late" : (dueSoon ? "due_soon" : (closed ? "closed" : "active"));

  return {
    workOrderCode,
    itemCode,
    itemDescription,
    customerName,
    status,
    dueDate: dueDate || null,
    unitsExpected: round(unitsExpected, 2),
    unitsProduced: round(unitsProduced, 2),
    unitsRemaining: round(unitsRemaining, 2),
    priority,
    closed,
    late,
    dueSoon,
  };
}

export async function getWorkOrderSummary(options = {}) {
  const supabase = await createSupabaseAdmin();
  const { siteId } = getSupabaseConfig();
  const snapshot = await fetchLatestSnapshot(supabase, siteId);
  if (!snapshot || !snapshot.payload || !Array.isArray(snapshot.payload.workOrders)) {
    return {
      siteId,
      snapshotSyncedAt: snapshot && snapshot.synced_at ? snapshot.synced_at : null,
      totalWorkOrders: 0,
      matchedCount: 0,
      totals: {
        active: 0,
        late: 0,
        dueSoon: 0,
        closed: 0,
        remainingUnits: 0,
      },
      items: [],
    };
  }

  const limit = Math.max(1, Math.min(50, Number(options.limit || 15)));
  const requestedStatus = String(options.status || "active").toLowerCase();
  const queryTokens = normalizeQueryTokens(options.query);
  const todayEt = toEasternDateKey(new Date());
  const mapped = snapshot.payload.workOrders.map((row) => mapWorkOrderRow(row, todayEt));

  const totals = mapped.reduce((accumulator, row) => {
    if (row.closed) accumulator.closed += 1;
    else accumulator.active += 1;
    if (row.late) accumulator.late += 1;
    if (row.dueSoon) accumulator.dueSoon += 1;
    accumulator.remainingUnits += toNum(row.unitsRemaining);
    return accumulator;
  }, {
    active: 0,
    late: 0,
    dueSoon: 0,
    closed: 0,
    remainingUnits: 0,
  });
  totals.remainingUnits = round(totals.remainingUnits, 2);

  const matchesStatus = (row) => {
    if (requestedStatus === "all") return true;
    if (requestedStatus === "late") return row.late;
    if (requestedStatus === "due_soon") return row.dueSoon;
    if (requestedStatus === "closed") return row.closed;
    return !row.closed;
  };

  const matchesQuery = (row) => {
    if (!queryTokens.length) return true;
    const haystack = normalizeKey([
      row.workOrderCode,
      row.itemCode,
      row.itemDescription,
      row.customerName,
      row.status,
    ].join(" "));
    return queryTokens.every((token) => haystack.includes(token));
  };

  const matched = mapped
    .filter((row) => matchesStatus(row) && matchesQuery(row))
    .sort((a, b) => {
      const priorityOrder = { late: 0, due_soon: 1, active: 2, closed: 3 };
      const priorityDelta = (priorityOrder[a.priority] || 9) - (priorityOrder[b.priority] || 9);
      if (priorityDelta !== 0) return priorityDelta;
      if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) return a.dueDate.localeCompare(b.dueDate);
      return b.unitsRemaining - a.unitsRemaining;
    });
  const items = matched.slice(0, limit);

  return {
    siteId,
    snapshotSyncedAt: snapshot.synced_at || null,
    totalWorkOrders: mapped.length,
    matchedCount: matched.length,
    totals,
    items,
  };
}

function mapInventoryRow(row) {
  return {
    itemCode: toText(pickFieldLoose(row, ["Item Code", "item_code", "SKU", "sku", "Item", "item"])),
    description: toText(pickFieldLoose(row, ["Description", "description", "Item Description", "item_description"])),
    qtyOnHand: toNum(pickFieldLoose(row, ["Qty On Hand", "qty_on_hand", "Base quantity", "base_quantity", "Quantity", "quantity", "Available", "available"])),
    status: toText(pickFieldLoose(row, ["Inventory Status", "inventory_status", "Status", "status"])),
    customerName: toText(pickFieldLoose(row, ["Customer Name", "customer_name", "Customer", "customer"])),
    baseUom: toText(pickFieldLoose(row, ["Base UOM", "base_uom", "UOM", "uom"])),
  };
}

export async function searchInventory(options = {}) {
  const query = toText(options.query);
  if (!query) throw new Error("Inventory search query is required.");

  const supabase = await createSupabaseAdmin();
  const { siteId } = getSupabaseConfig();
  const snapshot = await fetchLatestSnapshot(supabase, siteId);
  const inventoryRows = snapshot && snapshot.payload && Array.isArray(snapshot.payload.inventory)
    ? snapshot.payload.inventory
    : [];
  const tokens = normalizeQueryTokens(query);
  const exactCode = normalizeKey(query);
  const limit = Math.max(1, Math.min(50, Number(options.limit || 20)));
  const grouped = new Map();

  inventoryRows.forEach((row) => {
    const mapped = mapInventoryRow(row);
    const haystack = normalizeKey([
      mapped.itemCode,
      mapped.description,
      mapped.customerName,
      mapped.status,
    ].join(" "));
    if (!tokens.every((token) => haystack.includes(token))) return;

    const key = normalizeKey(mapped.itemCode) || normalizeKey(mapped.description);
    const groupKey = key || `${mapped.itemCode}|${mapped.description}`;
    if (!grouped.has(groupKey)) {
      grouped.set(groupKey, {
        itemCode: mapped.itemCode || null,
        description: mapped.description || null,
        totalQtyOnHand: 0,
        rowCount: 0,
        statuses: new Set(),
        customers: new Set(),
        baseUoms: new Set(),
        exactMatch: false,
      });
    }

    const target = grouped.get(groupKey);
    target.totalQtyOnHand += mapped.qtyOnHand;
    target.rowCount += 1;
    if (mapped.status) target.statuses.add(mapped.status);
    if (mapped.customerName) target.customers.add(mapped.customerName);
    if (mapped.baseUom) target.baseUoms.add(mapped.baseUom);
    if (normalizeKey(mapped.itemCode) === exactCode) target.exactMatch = true;
  });

  const matched = Array.from(grouped.values())
    .map((row) => ({
      itemCode: row.itemCode,
      description: row.description,
      totalQtyOnHand: round(row.totalQtyOnHand, 2),
      rowCount: row.rowCount,
      statuses: Array.from(row.statuses).slice(0, 5),
      customers: Array.from(row.customers).slice(0, 5),
      baseUoms: Array.from(row.baseUoms).slice(0, 3),
      exactMatch: row.exactMatch,
    }))
    .sort((a, b) => {
      if (a.exactMatch !== b.exactMatch) return a.exactMatch ? -1 : 1;
      return b.totalQtyOnHand - a.totalQtyOnHand || b.rowCount - a.rowCount;
    });
  const items = matched.slice(0, limit);

  return {
    siteId,
    snapshotSyncedAt: snapshot && snapshot.synced_at ? snapshot.synced_at : null,
    totalMatches: matched.length,
    items,
  };
}

export function summarizeFailure(error) {
  return describeError(error) || "Unknown PackPulse MCP error";
}
