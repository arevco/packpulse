import Sentry from "../../_sentry.js";
import { CACHE_SITE_ID, getAuthenticatedUser, getSupabaseAdmin, toNum, withCors } from "../../ops/_common.js";
import { createQuickBooksInvoice, getQuickBooksRequestContext } from "./_client.js";
import { buildQuickBooksPreviewModel } from "./_invoice-builder.js";
import { loadQuickBooksPersistenceState, QBO_PROVIDER } from "./_persistence.js";

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

function nowIso() {
  return new Date().toISOString();
}

function roundAmount(value, fractionDigits) {
  return Number(toNum(value).toFixed(fractionDigits));
}

function addDaysIso(value, days) {
  var dateText = sanitizeIsoDate(value);
  if (!dateText) return "";
  var parts = dateText.split("-").map(function(part) { return parseInt(part, 10); });
  if (parts.length !== 3) return "";
  var date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  date.setUTCDate(date.getUTCDate() + Math.max(0, Math.round(toNum(days))));
  return date.toISOString().slice(0, 10);
}

function isMissingRelationError(error) {
  if (!error) return false;
  if (error.code === "42P01") return true;
  return /relation .* does not exist|could not find the table|schema cache/i.test(String(error.message || ""));
}

async function loadNet30TermMapping(supabase) {
  var result = await supabase
    .from("accounting_entity_mappings")
    .select("packpulse_key, packpulse_value, external_id, external_name")
    .eq("site_id", CACHE_SITE_ID)
    .eq("provider", QBO_PROVIDER)
    .eq("entity_type", "term")
    .eq("packpulse_key", "net30")
    .eq("is_active", true)
    .maybeSingle();

  if (result.error) {
    if (isMissingRelationError(result.error)) {
      return {
        mapping: null,
        warning: "Supabase table public.accounting_entity_mappings is missing. QuickBooks terms will fall back to customer defaults."
      };
    }
    throw result.error;
  }

  if (!result.data) {
    return {
      mapping: null,
      warning: "No active Net 30 QuickBooks term mapping was found. QuickBooks customer defaults will be used."
    };
  }

  return {
    mapping: {
      externalId: sanitizeText(result.data.external_id, 120),
      externalName: sanitizeText(result.data.external_name, 200),
      packpulseValue: sanitizeText(result.data.packpulse_value, 200)
    },
    warning: ""
  };
}

async function insertInvoiceExportRecord(supabase, payload) {
  var result = await supabase
    .from("invoice_exports")
    .insert(payload)
    .select("id")
    .single();
  if (result.error) {
    if (isMissingRelationError(result.error)) {
      throw new Error("Supabase table public.invoice_exports is missing. Run supabase-accounting-qbo.sql before creating QuickBooks invoices.");
    }
    throw result.error;
  }
  return result.data;
}

async function updateInvoiceExportRecord(supabase, exportId, payload) {
  var result = await supabase
    .from("invoice_exports")
    .update(Object.assign({}, payload, { updated_at: nowIso() }))
    .eq("id", exportId);
  if (result.error) {
    if (isMissingRelationError(result.error)) {
      throw new Error("Supabase table public.invoice_exports is missing. Run supabase-accounting-qbo.sql before creating QuickBooks invoices.");
    }
    throw result.error;
  }
}

async function insertInvoiceExportLines(supabase, rows) {
  if (!rows.length) return;
  var result = await supabase.from("invoice_export_lines").insert(rows);
  if (result.error) {
    if (isMissingRelationError(result.error)) {
      throw new Error("Supabase table public.invoice_export_lines is missing. Run supabase-accounting-qbo.sql before creating QuickBooks invoices.");
    }
    throw result.error;
  }
}

function extractSalesLineIds(invoice) {
  return (Array.isArray(invoice && invoice.Line) ? invoice.Line : [])
    .filter(function(line) {
      return sanitizeText(line && line.DetailType, 80) === "SalesItemLineDetail";
    })
    .map(function(line) {
      return sanitizeText(line && line.Id, 120);
    });
}

function buildQuickBooksInvoicePayload(group, candidateStates, termMapping) {
  var firstLine = Array.isArray(group.lines) && group.lines.length ? group.lines[0] : null;
  var firstState = firstLine && candidateStates[firstLine.key] ? candidateStates[firstLine.key] : null;
  var customerExternalId = sanitizeText(firstState && firstState.customerMapping && firstState.customerMapping.externalId, 120);
  if (!customerExternalId) throw new Error("Missing QuickBooks customer mapping for " + sanitizeText(group.customer, 200));

  var linePayload = group.lines.map(function(line) {
    var candidateState = candidateStates[line.key] || null;
    var itemExternalId = sanitizeText(candidateState && candidateState.itemMapping && candidateState.itemMapping.externalId, 120);
    if (!itemExternalId) throw new Error("Missing QuickBooks item mapping for SKU " + sanitizeText(line.sku, 120));
    return {
      Amount: roundAmount(line.amount, 2),
      Description: sanitizeText(line.description, 4000),
      DetailType: "SalesItemLineDetail",
      SalesItemLineDetail: {
        ItemRef: { value: itemExternalId },
        Qty: roundAmount(line.unitsProduced, 4),
        UnitPrice: roundAmount(line.revenuePerUnit, 4)
      }
    };
  });

  var invoiceDate = sanitizeIsoDate(group.invoiceDate);
  var payload = {
    CustomerRef: { value: customerExternalId },
    CustomerMemo: group.customerMemo ? { value: sanitizeText(group.customerMemo, 1000) } : undefined,
    PrivateNote: sanitizeText(group.privateNote, 4000),
    Line: linePayload
  };
  if (invoiceDate) payload.TxnDate = invoiceDate;
  if (invoiceDate) payload.DueDate = addDaysIso(invoiceDate, 30);
  if (termMapping && termMapping.externalId) {
    payload.SalesTermRef = { value: sanitizeText(termMapping.externalId, 120) };
  }
  return payload;
}

function buildInvoiceExportLineRows(exportId, group, invoice, exportedAt) {
  var externalInvoiceId = sanitizeText(invoice && invoice.Id, 120);
  var externalDocNumber = sanitizeText(invoice && invoice.DocNumber, 120);
  var externalLineIds = extractSalesLineIds(invoice);
  return (Array.isArray(group.lines) ? group.lines : []).map(function(line, index) {
    return {
      export_id: exportId,
      site_id: CACHE_SITE_ID,
      provider: QBO_PROVIDER,
      candidate_key: sanitizeText(line.key, 240),
      candidate_export_key: sanitizeText(line.candidateExportKey, 400),
      customer_name: sanitizeText(group.customer, 200),
      purchase_order_number: sanitizeText(group.purchaseOrderNumber, 120),
      sku: sanitizeText(line.sku, 120),
      lot_code: sanitizeText(line.lotCode, 120),
      billed_quantity: roundAmount(line.unitsProduced, 4),
      billed_rate: roundAmount(line.revenuePerUnit, 4),
      billed_amount: roundAmount(line.amount, 2),
      unit_of_measure: sanitizeText(line.unitOfMeasure, 80),
      work_order_summary: sanitizeText(line.workOrderSummary, 240),
      first_produced_date: sanitizeIsoDate(line.firstProducedDate) || null,
      last_produced_date: sanitizeIsoDate(line.lastProducedDate) || null,
      export_status: "created",
      is_active: true,
      external_invoice_id: externalInvoiceId,
      external_doc_number: externalDocNumber,
      external_line_id: sanitizeText(externalLineIds[index], 120),
      exported_at: exportedAt,
      created_at: exportedAt
    };
  });
}

function serializeErrorPayload(error) {
  return {
    message: sanitizeText(error && error.message, 500) || "Unknown QuickBooks export failure",
    intuit_tid: sanitizeText(error && error.intuitTid, 240),
    status: Number(error && error.status || 0) || null,
    response: error && error.responseBody && typeof error.responseBody === "object" ? error.responseBody : {}
  };
}

export default async function handler(req, res) {
  withCors(req, res, ["POST", "OPTIONS"]);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    var user = getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    var body = req.body && typeof req.body === "object" ? req.body : {};
    var selectedCandidates = Array.isArray(body.selectedCandidates) ? body.selectedCandidates : [];
    if (!selectedCandidates.length) {
      return res.status(400).json({ error: "Select at least one invoice candidate to create in QuickBooks." });
    }

    var persistence = await loadQuickBooksPersistenceState(selectedCandidates);
    if (!persistence.mappingTableReady || !persistence.exportTableReady) {
      return res.status(400).json({
        error: "QuickBooks persistence tables are not ready yet.",
        warnings: Array.isArray(persistence.warnings) ? persistence.warnings : []
      });
    }

    var preview = buildQuickBooksPreviewModel({
      billingWindow: body.billingWindow,
      invoiceDate: body.invoiceDate,
      selectedCandidates: selectedCandidates,
      persistenceState: persistence
    });
    if (preview.validationIssues.length || !preview.invoiceGroups.length) {
      return res.status(400).json({
        error: preview.validationIssues.length
          ? "Selected invoice candidates are not ready for QuickBooks export."
          : "No QuickBooks invoice groups could be built from the current selection.",
        validationIssues: preview.validationIssues,
        invoiceGroups: preview.invoiceGroups
      });
    }

    var context = await getQuickBooksRequestContext(user.email);
    var supabase = getSupabaseAdmin();
    var termLookup = await loadNet30TermMapping(supabase);
    var warnings = [];
    if (termLookup.warning) warnings.push(termLookup.warning);

    var createdInvoices = [];
    var failedInvoices = [];
    var createdCandidateKeys = [];

    for (var groupIndex = 0; groupIndex < preview.invoiceGroups.length; groupIndex += 1) {
      var group = preview.invoiceGroups[groupIndex];
      var requestPayload = {};
      var exportRecord = null;
      var createdInvoice = null;
      var exportedAt = nowIso();

      try {
        requestPayload = buildQuickBooksInvoicePayload(group, persistence.candidateStates || {}, termLookup.mapping);
        exportRecord = await insertInvoiceExportRecord(supabase, {
          site_id: CACHE_SITE_ID,
          provider: QBO_PROVIDER,
          company_realm_id: sanitizeText(context.realmId, 120),
          export_status: "queued",
          customer_name: sanitizeText(group.customer, 200),
          purchase_order_number: sanitizeText(group.purchaseOrderNumber, 120),
          candidate_count: Math.max(0, Math.round(toNum(group.lineCount))),
          request_payload: {
            invoiceDate: sanitizeIsoDate(group.invoiceDate),
            candidateKeys: Array.isArray(group.candidateKeys) ? group.candidateKeys : [],
            invoice: requestPayload
          },
          response_payload: {},
          error_payload: {},
          created_by: sanitizeText(user.email, 240),
          updated_by: sanitizeText(user.email, 240)
        });

        var created = await createQuickBooksInvoice({
          context: context,
          payload: requestPayload,
          userEmail: user.email
        });
        createdInvoice = created.invoice;
        exportedAt = nowIso();

        await insertInvoiceExportLines(
          supabase,
          buildInvoiceExportLineRows(exportRecord.id, group, createdInvoice, exportedAt)
        );

        await updateInvoiceExportRecord(supabase, exportRecord.id, {
          export_status: "created",
          external_invoice_id: sanitizeText(createdInvoice && createdInvoice.Id, 120),
          external_doc_number: sanitizeText(createdInvoice && createdInvoice.DocNumber, 120),
          external_sync_token: sanitizeText(createdInvoice && createdInvoice.SyncToken, 120),
          exported_at: exportedAt,
          response_payload: {
            intuit_tid: sanitizeText(created.intuitTid, 240),
            body: created.body
          },
          error_payload: {},
          updated_by: sanitizeText(user.email, 240)
        });

        createdCandidateKeys = createdCandidateKeys.concat(Array.isArray(group.candidateKeys) ? group.candidateKeys : []);
        createdInvoices.push({
          key: group.key,
          customer: group.customer,
          purchaseOrderNumber: group.purchaseOrderNumber,
          candidateCount: Math.max(0, Math.round(toNum(group.lineCount))),
          candidateKeys: Array.isArray(group.candidateKeys) ? group.candidateKeys : [],
          externalInvoiceId: sanitizeText(createdInvoice && createdInvoice.Id, 120),
          externalDocNumber: sanitizeText(createdInvoice && createdInvoice.DocNumber, 120),
          exportedAt: exportedAt,
          intuitTid: sanitizeText(created.intuitTid, 240)
        });
      } catch (error) {
        Sentry.captureException(error);
        if (exportRecord && exportRecord.id) {
          var failureUpdate = {
            export_status: createdInvoice ? "created" : "failed",
            external_invoice_id: sanitizeText(createdInvoice && createdInvoice.Id, 120),
            external_doc_number: sanitizeText(createdInvoice && createdInvoice.DocNumber, 120),
            external_sync_token: sanitizeText(createdInvoice && createdInvoice.SyncToken, 120),
            exported_at: createdInvoice ? exportedAt : null,
            response_payload: createdInvoice ? { body: createdInvoice } : {},
            error_payload: serializeErrorPayload(error),
            updated_by: sanitizeText(user.email, 240)
          };
          try {
            await updateInvoiceExportRecord(supabase, exportRecord.id, failureUpdate);
          } catch (updateError) {
            Sentry.captureException(updateError);
          }
        }
        failedInvoices.push({
          key: group.key,
          customer: group.customer,
          purchaseOrderNumber: group.purchaseOrderNumber,
          candidateCount: Math.max(0, Math.round(toNum(group.lineCount))),
          message: sanitizeText(error && error.message, 500) || "QuickBooks export failed",
          intuitTid: sanitizeText(error && error.intuitTid, 240),
          exportedAt: createdInvoice ? exportedAt : ""
        });
      }
    }

    return res.status(200).json({
      ok: failedInvoices.length === 0,
      generatedAt: nowIso(),
      warnings: warnings,
      invoiceDate: preview.invoiceDate,
      createdCount: createdInvoices.length,
      failedCount: failedInvoices.length,
      createdCandidateKeys: createdCandidateKeys,
      createdInvoices: createdInvoices,
      failedInvoices: failedInvoices
    });
  } catch (err) {
    Sentry.captureException(err);
    return res.status(500).json({
      error: "QuickBooks invoice export failed",
      details: err && err.message ? err.message : "unknown"
    });
  }
}
