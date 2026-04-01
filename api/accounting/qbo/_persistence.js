import { CACHE_SITE_ID, getSupabaseAdmin, toNum } from "../../ops/_common.js";

export var QBO_PROVIDER = "qbo";

function sanitizeText(value, maxLen) {
  var text = String(value || "").trim();
  if (!text) return "";
  if (maxLen && text.length > maxLen) return text.slice(0, maxLen);
  return text;
}

export function sanitizeIsoDate(value) {
  var text = sanitizeText(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

export function normalizeLookupKey(value) {
  var raw = sanitizeText(value);
  if (!raw) return "";
  return raw.replace(/\.0+$/, "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function normalizeNumber(value, fractionDigits) {
  return toNum(value).toFixed(fractionDigits);
}

function summarizeMapping(row) {
  if (!row || typeof row !== "object") return null;
  return {
    externalId: sanitizeText(row.external_id, 120),
    externalName: sanitizeText(row.external_name, 200),
    packpulseValue: sanitizeText(row.packpulse_value, 200)
  };
}

function summarizeExport(row) {
  if (!row || typeof row !== "object") return null;
  return {
    exportId: sanitizeText(row.export_id, 120),
    exportStatus: sanitizeText(row.export_status, 40).toLowerCase(),
    externalInvoiceId: sanitizeText(row.external_invoice_id, 120),
    externalDocNumber: sanitizeText(row.external_doc_number, 120),
    exportedAt: sanitizeText(row.exported_at, 40),
    createdAt: sanitizeText(row.created_at, 40),
    isActive: row.is_active !== false
  };
}

function isMissingRelationError(error) {
  if (!error) return false;
  if (error.code === "42P01") return true;
  return /relation .* does not exist/i.test(String(error.message || ""));
}

function dedupeTextValues(values) {
  var out = [];
  var seen = {};
  (Array.isArray(values) ? values : []).forEach(function(value) {
    var text = sanitizeText(value, 240);
    if (!text || seen[text]) return;
    seen[text] = true;
    out.push(text);
  });
  return out;
}

function indexRowsByField(rows, fieldName) {
  var out = {};
  (Array.isArray(rows) ? rows : []).forEach(function(row) {
    var key = sanitizeText(row && row[fieldName], 240);
    if (!key || out[key]) return;
    out[key] = row;
  });
  return out;
}

export function buildCandidateExportKey(candidate) {
  var key = sanitizeText(candidate && candidate.key, 240) || "candidate";
  var firstProducedDate = sanitizeIsoDate(candidate && candidate.firstProducedDate) || "--";
  var lastProducedDate = sanitizeIsoDate(candidate && candidate.lastProducedDate) || "--";
  var unitsProduced = normalizeNumber(candidate && candidate.unitsProduced, 4);
  var revenuePerUnit = normalizeNumber(candidate && (candidate.revenuePerUnitAvg != null ? candidate.revenuePerUnitAvg : candidate.revenuePerUnit), 4);
  var estimatedRevenue = normalizeNumber(candidate && candidate.estimatedRevenue, 2);
  var detailRows = String(Math.max(0, Math.round(toNum(candidate && (candidate.detailRows != null ? candidate.detailRows : candidate.lineCount)))));
  return [
    key,
    firstProducedDate,
    lastProducedDate,
    unitsProduced,
    revenuePerUnit,
    estimatedRevenue,
    detailRows
  ].join("|");
}

export function normalizeInvoiceCandidate(raw, index) {
  var candidate = raw && typeof raw === "object" ? raw : {};
  var detailRows = Math.max(0, Math.round(toNum(candidate.detailRows != null ? candidate.detailRows : candidate.lineCount)));
  var normalized = {
    key: sanitizeText(candidate.key || ("candidate-" + index), 240) || ("candidate-" + index),
    customer: sanitizeText(candidate.customer, 200),
    customerLookupKey: normalizeLookupKey(candidate.customer),
    sku: sanitizeText(candidate.sku, 120),
    skuLookupKey: normalizeLookupKey(candidate.sku),
    description: sanitizeText(candidate.description, 500),
    unitsProduced: toNum(candidate.unitsProduced),
    estimatedRevenue: toNum(candidate.estimatedRevenue),
    revenuePerUnit: toNum(candidate.revenuePerUnitAvg != null ? candidate.revenuePerUnitAvg : candidate.revenuePerUnit),
    unitOfMeasure: sanitizeText(candidate.unitOfMeasure, 80),
    lotCode: sanitizeText(candidate.lotCode, 120),
    purchaseOrderReference: sanitizeText(candidate.purchaseOrderReference, 120),
    workOrderReference: sanitizeText(candidate.workOrderReference, 200),
    workOrderCount: Math.max(0, Math.round(toNum(candidate.workOrderCount))),
    jobCount: Math.max(0, Math.round(toNum(candidate.jobCount))),
    lineCount: Math.max(0, Math.round(toNum(candidate.lineCount))),
    detailRows: detailRows,
    status: sanitizeText(candidate.status, 24).toLowerCase(),
    firstProducedDate: sanitizeIsoDate(candidate.firstProducedDate),
    lastProducedDate: sanitizeIsoDate(candidate.lastProducedDate),
    issueSummary: sanitizeText(candidate.issueSummary, 1000)
  };
  normalized.candidateExportKey = sanitizeText(candidate.candidateExportKey, 400) || buildCandidateExportKey(normalized);
  return normalized;
}

async function loadActiveMappings(supabase, entityType, packpulseKeys) {
  var keys = dedupeTextValues(packpulseKeys);
  if (!keys.length) {
    return { tableReady: true, warning: "", rowsByKey: {} };
  }

  var result = await supabase
    .from("accounting_entity_mappings")
    .select("packpulse_key, packpulse_value, external_id, external_name")
    .eq("site_id", CACHE_SITE_ID)
    .eq("provider", QBO_PROVIDER)
    .eq("entity_type", entityType)
    .eq("is_active", true)
    .in("packpulse_key", keys);

  if (result.error) {
    if (isMissingRelationError(result.error)) {
      return {
        tableReady: false,
        warning: "Supabase table public.accounting_entity_mappings is missing. Run supabase-accounting-qbo.sql to enable QuickBooks mapping checks.",
        rowsByKey: {}
      };
    }
    throw result.error;
  }

  return {
    tableReady: true,
    warning: "",
    rowsByKey: indexRowsByField(result.data, "packpulse_key")
  };
}

async function loadActiveExportLines(supabase, candidateExportKeys) {
  var keys = dedupeTextValues(candidateExportKeys);
  if (!keys.length) {
    return { tableReady: true, warning: "", rowsByKey: {} };
  }

  var result = await supabase
    .from("invoice_export_lines")
    .select("candidate_export_key, export_id, export_status, external_invoice_id, external_doc_number, exported_at, created_at, is_active")
    .eq("site_id", CACHE_SITE_ID)
    .eq("provider", QBO_PROVIDER)
    .eq("is_active", true)
    .in("candidate_export_key", keys);

  if (result.error) {
    if (isMissingRelationError(result.error)) {
      return {
        tableReady: false,
        warning: "Supabase table public.invoice_export_lines is missing. Run supabase-accounting-qbo.sql to enable QuickBooks duplicate detection.",
        rowsByKey: {}
      };
    }
    throw result.error;
  }

  var rowsByKey = {};
  (Array.isArray(result.data) ? result.data : []).forEach(function(row) {
    var candidateExportKey = sanitizeText(row && row.candidate_export_key, 400);
    if (!candidateExportKey) return;
    var previous = rowsByKey[candidateExportKey];
    var previousTimestamp = sanitizeText(previous && (previous.exported_at || previous.created_at), 40);
    var currentTimestamp = sanitizeText(row && (row.exported_at || row.created_at), 40);
    if (!previous || currentTimestamp > previousTimestamp) rowsByKey[candidateExportKey] = row;
  });

  return {
    tableReady: true,
    warning: "",
    rowsByKey: rowsByKey
  };
}

function buildCandidateState(candidate, options) {
  var customerMappingRow = options.customerMappings[candidate.customerLookupKey] || null;
  var itemMappingRow = options.itemMappings[candidate.skuLookupKey] || null;
  var exportRow = options.exportsByAuditKey[candidate.candidateExportKey] || null;

  var customerMapped = options.mappingTableReady ? !!customerMappingRow : null;
  var itemMapped = options.mappingTableReady ? !!itemMappingRow : null;

  var exportSummary = summarizeExport(exportRow);
  var exportStatus = exportSummary && exportSummary.exportStatus ? exportSummary.exportStatus : "";
  var alreadyPushed = null;
  if (options.exportTableReady) {
    alreadyPushed = !!(exportSummary && exportSummary.isActive && exportStatus !== "failed" && exportStatus !== "voided" && exportStatus !== "deleted");
  }

  var issues = [];
  if (options.mappingTableReady && !customerMapped) issues.push("Missing QuickBooks customer mapping");
  if (options.mappingTableReady && !itemMapped) issues.push("Missing QuickBooks item mapping");
  if (options.exportTableReady && alreadyPushed) {
    if (exportSummary && exportSummary.externalDocNumber) issues.push("Already pushed to QuickBooks invoice " + exportSummary.externalDocNumber);
    else issues.push("Already pushed to QuickBooks");
  }

  var quickBooksState = "unknown";
  if (options.exportTableReady && alreadyPushed) quickBooksState = "already_pushed";
  else if (options.mappingTableReady && (!customerMapped || !itemMapped)) quickBooksState = "missing_mapping";
  else if (options.mappingTableReady && options.exportTableReady) quickBooksState = "ready";

  return {
    key: candidate.key,
    candidateExportKey: candidate.candidateExportKey,
    mappingStateKnown: options.mappingTableReady,
    exportStateKnown: options.exportTableReady,
    stateKnown: options.mappingTableReady && options.exportTableReady,
    customerMapped: customerMapped,
    itemMapped: itemMapped,
    customerMapping: summarizeMapping(customerMappingRow),
    itemMapping: summarizeMapping(itemMappingRow),
    alreadyPushed: alreadyPushed,
    quickBooksState: quickBooksState,
    exportReady: issues.length === 0,
    exportStatus: exportStatus,
    externalInvoiceId: exportSummary && exportSummary.externalInvoiceId ? exportSummary.externalInvoiceId : "",
    externalDocNumber: exportSummary && exportSummary.externalDocNumber ? exportSummary.externalDocNumber : "",
    exportedAt: exportSummary && exportSummary.exportedAt ? exportSummary.exportedAt : "",
    issues: issues
  };
}

export async function loadQuickBooksPersistenceState(rawCandidates) {
  var normalizedCandidates = (Array.isArray(rawCandidates) ? rawCandidates : []).map(function(candidate, index) {
    return normalizeInvoiceCandidate(candidate, index);
  });

  var warnings = [];
  if (!normalizedCandidates.length) {
    return {
      ok: true,
      generatedAt: new Date().toISOString(),
      siteId: CACHE_SITE_ID,
      provider: QBO_PROVIDER,
      tablesReady: true,
      mappingTableReady: true,
      exportTableReady: true,
      warnings: warnings,
      summary: {
        candidateCount: 0,
        exportReadyCount: 0,
        alreadyPushedCount: 0,
        missingCustomerMappings: 0,
        missingItemMappings: 0
      },
      candidateStates: {}
    };
  }

  var supabase = getSupabaseAdmin();
  var customerKeys = normalizedCandidates.map(function(candidate) { return candidate.customerLookupKey; }).filter(Boolean);
  var skuKeys = normalizedCandidates.map(function(candidate) { return candidate.skuLookupKey; }).filter(Boolean);
  var candidateExportKeys = normalizedCandidates.map(function(candidate) { return candidate.candidateExportKey; }).filter(Boolean);

  var customerMappings = await loadActiveMappings(supabase, "customer", customerKeys);
  if (customerMappings.warning) warnings.push(customerMappings.warning);

  var itemMappings = await loadActiveMappings(supabase, "item", skuKeys);
  if (itemMappings.warning && warnings.indexOf(itemMappings.warning) === -1) warnings.push(itemMappings.warning);

  var exportLines = await loadActiveExportLines(supabase, candidateExportKeys);
  if (exportLines.warning) warnings.push(exportLines.warning);

  var mappingTableReady = customerMappings.tableReady && itemMappings.tableReady;
  var exportTableReady = exportLines.tableReady;

  var candidateStates = {};
  var summary = {
    candidateCount: normalizedCandidates.length,
    exportReadyCount: 0,
    alreadyPushedCount: 0,
    missingCustomerMappings: 0,
    missingItemMappings: 0
  };

  normalizedCandidates.forEach(function(candidate) {
    var state = buildCandidateState(candidate, {
      customerMappings: customerMappings.rowsByKey,
      itemMappings: itemMappings.rowsByKey,
      exportsByAuditKey: exportLines.rowsByKey,
      mappingTableReady: mappingTableReady,
      exportTableReady: exportTableReady
    });
    if (state.exportReady) summary.exportReadyCount += 1;
    if (state.alreadyPushed) summary.alreadyPushedCount += 1;
    if (state.customerMapped === false) summary.missingCustomerMappings += 1;
    if (state.itemMapped === false) summary.missingItemMappings += 1;
    candidateStates[candidate.key] = state;
  });

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    siteId: CACHE_SITE_ID,
    provider: QBO_PROVIDER,
    tablesReady: mappingTableReady && exportTableReady,
    mappingTableReady: mappingTableReady,
    exportTableReady: exportTableReady,
    warnings: warnings,
    summary: summary,
    candidateStates: candidateStates
  };
}
