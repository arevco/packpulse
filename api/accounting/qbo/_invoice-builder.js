import { toNum } from "../../ops/_common.js";
import { normalizeInvoiceCandidate, sanitizeIsoDate } from "./_persistence.js";

function sanitizeText(value, maxLen) {
  var text = String(value || "").trim();
  if (!text) return "";
  if (maxLen && text.length > maxLen) return text.slice(0, maxLen);
  return text;
}

function normalizeKey(value) {
  return sanitizeText(value).toLowerCase();
}

function dedupeText(values) {
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

export function buildPreviewLineDescription(candidate) {
  var sku = sanitizeText(candidate && candidate.sku, 120);
  var description = sanitizeText(candidate && candidate.description, 500);
  var purchaseOrderNumber = sanitizeText(candidate && candidate.purchaseOrderReference, 120);
  var lotCode = sanitizeText(candidate && candidate.lotCode, 120);
  var firstLine = "";
  if (sku) firstLine += sku;
  if (purchaseOrderNumber) firstLine += (firstLine ? " " : "") + "PO#" + purchaseOrderNumber;
  if (description) firstLine += (purchaseOrderNumber ? "," : (firstLine ? " " : "")) + description;
  var lines = [];
  if (firstLine) lines.push(firstLine);
  if (lotCode) lines.push("LOT CODE#" + lotCode);
  return lines.join("\n");
}

export function buildWorkOrderSummary(candidate) {
  var workOrderReference = sanitizeText(candidate && candidate.workOrderReference, 200);
  var workOrderCount = Math.max(0, Math.round(toNum(candidate && candidate.workOrderCount)));
  if (!workOrderCount) return "";
  if (workOrderCount === 1 && workOrderReference && workOrderReference !== "--") return "WO " + workOrderReference;
  if (workOrderCount === 1) return "1 work order";
  return workOrderCount.toLocaleString() + " work orders";
}

export function validationIssuesForCandidate(candidate, persistenceState) {
  var issues = [];
  if (!candidate.customer) issues.push("Missing customer");
  if (!candidate.purchaseOrderReference) issues.push("Missing purchase order");
  if (!candidate.sku) issues.push("Missing SKU");
  if (!candidate.lotCode || candidate.lotCode === "--" || candidate.lotCode === "Mixed") issues.push("Missing or mixed lot code");
  if (!(candidate.unitsProduced > 0)) issues.push("Missing billed quantity");
  if (!(candidate.revenuePerUnit > 0)) issues.push("Missing billed rate");
  if (!(candidate.estimatedRevenue > 0)) issues.push("Missing billed amount");
  if (candidate.status && candidate.status !== "ready") issues.push("Candidate is not ready");
  if (persistenceState && Array.isArray(persistenceState.issues) && persistenceState.issues.length) {
    persistenceState.issues.forEach(function(issue) {
      if (!issue || issues.indexOf(issue) !== -1) return;
      issues.push(issue);
    });
  }
  return issues;
}

function buildPrivateNote(group) {
  var references = dedupeText(group.workOrderReferences);
  var note = "PackPulse export";
  if (group.purchaseOrderNumber) note += " PO " + group.purchaseOrderNumber;
  if (references.length) note += " | WO refs: " + references.join(",");
  return sanitizeText(note, 4000);
}

export function buildQuickBooksPreviewModel(input) {
  var source = input && typeof input === "object" ? input : {};
  var billingWindow = source.billingWindow && typeof source.billingWindow === "object" ? source.billingWindow : {};
  var invoiceDate = sanitizeIsoDate(source.invoiceDate) || sanitizeIsoDate(billingWindow.endDate) || sanitizeIsoDate(billingWindow.startDate) || "";
  var rawCandidates = Array.isArray(source.selectedCandidates) ? source.selectedCandidates : [];
  var persistence = source.persistenceState && typeof source.persistenceState === "object" ? source.persistenceState : {};
  var normalizedCandidates = rawCandidates.map(function(candidate, index) {
    return normalizeInvoiceCandidate(candidate, index);
  });

  var validationIssues = [];
  var validCandidates = [];
  normalizedCandidates.forEach(function(candidate) {
    var candidateState = persistence.candidateStates && persistence.candidateStates[candidate.key] ? persistence.candidateStates[candidate.key] : null;
    var issues = validationIssuesForCandidate(candidate, candidateState);
    if (issues.length) {
      validationIssues.push({
        key: candidate.key,
        customer: candidate.customer,
        purchaseOrderReference: candidate.purchaseOrderReference,
        message: issues.join(" | ")
      });
      return;
    }
    validCandidates.push(candidate);
  });

  var grouped = {};
  validCandidates.forEach(function(candidate) {
    var key = normalizeKey(candidate.customer) + "|" + normalizeKey(candidate.purchaseOrderReference);
    if (!grouped[key]) {
      grouped[key] = {
        key: key,
        customer: candidate.customer,
        purchaseOrderNumber: candidate.purchaseOrderReference,
        customerMemo: candidate.purchaseOrderReference ? "PO ONLY# " + candidate.purchaseOrderReference : "",
        invoiceDate: invoiceDate || candidate.lastProducedDate || candidate.firstProducedDate || "",
        lineCount: 0,
        totalUnits: 0,
        totalAmount: 0,
        candidateKeys: [],
        workOrderReferences: [],
        lines: []
      };
    }
    var group = grouped[key];
    group.lineCount += 1;
    group.totalUnits += candidate.unitsProduced;
    group.totalAmount += candidate.estimatedRevenue;
    group.candidateKeys.push(candidate.key);
    if (candidate.workOrderReference && candidate.workOrderReference !== "--") group.workOrderReferences.push(candidate.workOrderReference);
    group.lines.push({
      key: candidate.key,
      candidateExportKey: candidate.candidateExportKey,
      sku: candidate.sku,
      description: buildPreviewLineDescription(candidate),
      lotCode: candidate.lotCode,
      purchaseOrderNumber: candidate.purchaseOrderReference,
      workOrderSummary: buildWorkOrderSummary(candidate),
      workOrderReference: candidate.workOrderReference,
      unitsProduced: candidate.unitsProduced,
      revenuePerUnit: candidate.revenuePerUnit,
      amount: candidate.estimatedRevenue,
      unitOfMeasure: candidate.unitOfMeasure,
      firstProducedDate: candidate.firstProducedDate,
      lastProducedDate: candidate.lastProducedDate
    });
  });

  var invoiceGroups = Object.values(grouped).sort(function(left, right) {
    var customerCompare = String(left.customer || "").localeCompare(String(right.customer || ""), undefined, { sensitivity: "base", numeric: true });
    if (customerCompare) return customerCompare;
    return String(left.purchaseOrderNumber || "").localeCompare(String(right.purchaseOrderNumber || ""), undefined, { sensitivity: "base", numeric: true });
  }).map(function(group) {
    group.workOrderReferences = dedupeText(group.workOrderReferences);
    group.privateNote = buildPrivateNote(group);
    group.lines.sort(function(left, right) {
      var skuCompare = String(left.sku || "").localeCompare(String(right.sku || ""), undefined, { sensitivity: "base", numeric: true });
      if (skuCompare) return skuCompare;
      var lotCompare = String(left.lotCode || "").localeCompare(String(right.lotCode || ""), undefined, { sensitivity: "base", numeric: true });
      if (lotCompare) return lotCompare;
      return toNum(left.revenuePerUnit) - toNum(right.revenuePerUnit);
    });
    return group;
  });

  var totals = invoiceGroups.reduce(function(acc, group) {
    acc.groupCount += 1;
    acc.lineCount += Math.max(0, Math.round(toNum(group.lineCount)));
    acc.totalUnits += toNum(group.totalUnits);
    acc.totalAmount += toNum(group.totalAmount);
    return acc;
  }, {
    groupCount: 0,
    lineCount: 0,
    totalUnits: 0,
    totalAmount: 0
  });

  return {
    generatedAt: new Date().toISOString(),
    invoiceDate: invoiceDate,
    candidateCount: normalizedCandidates.length,
    validCandidateCount: validCandidates.length,
    validationIssues: validationIssues,
    invoiceGroups: invoiceGroups,
    groupCount: totals.groupCount,
    lineCount: totals.lineCount,
    totalUnits: totals.totalUnits,
    totalAmount: totals.totalAmount
  };
}
