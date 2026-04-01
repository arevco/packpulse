import Sentry from "../../_sentry.js";
import { getAuthenticatedUser, toNum, withCors } from "../../ops/_common.js";
import { loadQuickBooksPersistenceState, normalizeInvoiceCandidate } from "./_persistence.js";

function sanitizeText(value, maxLen) {
  var text = String(value || "").trim();
  if (!text) return "";
  if (maxLen && text.length > maxLen) return text.slice(0, maxLen);
  return text;
}

function sanitizeIsoDate(value) {
  var text = sanitizeText(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function normalizeKey(value) {
  return sanitizeText(value).toLowerCase();
}

function buildPreviewLineDescription(candidate) {
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

function buildWorkOrderSummary(candidate) {
  var workOrderReference = sanitizeText(candidate && candidate.workOrderReference, 200);
  var workOrderCount = Math.max(0, Math.round(toNum(candidate && candidate.workOrderCount)));
  if (!workOrderCount) return "";
  if (workOrderCount === 1 && workOrderReference && workOrderReference !== "--") return "WO " + workOrderReference;
  if (workOrderCount === 1) return "1 work order";
  return workOrderCount.toLocaleString() + " work orders";
}

function validationIssuesForCandidate(candidate, persistenceState) {
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

export default async function handler(req, res) {
  withCors(req, res, ["POST", "OPTIONS"]);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    var user = getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    var body = req.body && typeof req.body === "object" ? req.body : {};
    var billingWindow = body.billingWindow && typeof body.billingWindow === "object" ? body.billingWindow : {};
    var invoiceDate = sanitizeIsoDate(body.invoiceDate) || sanitizeIsoDate(billingWindow.endDate) || sanitizeIsoDate(billingWindow.startDate) || "";
    var selectedCandidates = Array.isArray(body.selectedCandidates) ? body.selectedCandidates : [];
    if (!selectedCandidates.length) {
      return res.status(400).json({ error: "Select at least one invoice candidate to preview." });
    }

    var normalizedCandidates = selectedCandidates.map(function(candidate, index) {
      return normalizeInvoiceCandidate(candidate, index);
    });
    var persistence = await loadQuickBooksPersistenceState(normalizedCandidates);

    var validationIssues = [];
    var validCandidates = [];
    normalizedCandidates.forEach(function(candidate) {
      var candidateState = persistence.candidateStates[candidate.key] || null;
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
          lines: []
        };
      }
      var group = grouped[key];
      group.lineCount += 1;
      group.totalUnits += candidate.unitsProduced;
      group.totalAmount += candidate.estimatedRevenue;
      group.lines.push({
        key: candidate.key,
        sku: candidate.sku,
        description: buildPreviewLineDescription(candidate),
        lotCode: candidate.lotCode,
        purchaseOrderNumber: candidate.purchaseOrderReference,
        workOrderSummary: buildWorkOrderSummary(candidate),
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

    return res.status(200).json({
      ok: true,
      generatedAt: new Date().toISOString(),
      invoiceDate: invoiceDate,
      groupCount: totals.groupCount,
      lineCount: totals.lineCount,
      totalUnits: totals.totalUnits,
      totalAmount: totals.totalAmount,
      validationIssues: validationIssues,
      invoiceGroups: invoiceGroups
    });
  } catch (err) {
    Sentry.captureException(err);
    return res.status(500).json({
      error: "QuickBooks preview failed",
      details: err && err.message ? err.message : "unknown"
    });
  }
}
