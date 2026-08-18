import crypto from "crypto";
import * as XLSX from "xlsx";
import { CACHE_SITE_ID, getSupabaseAdmin, toNum } from "../ops/_common.js";

export const MAX_FILE_BYTES = 3 * 1024 * 1024;
export const BUCKET = "purchase-orders";
export const ALLOWED_TYPES = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "text/csv": "csv",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx"
};

export function text(value, max) {
  var out = String(value == null ? "" : value).trim();
  return max && out.length > max ? out.slice(0, max) : out;
}

export function key(value) {
  return text(value, 240).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function date(value) {
  var raw = text(value, 40);
  if (!raw) return null;
  var direct = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (direct) return direct[1] + "-" + direct[2] + "-" + direct[3];
  var parsed = new Date(raw);
  return isNaN(parsed) ? null : parsed.toISOString().slice(0, 10);
}

function money(value) {
  return Math.round(toNum(value) * 10000) / 10000;
}

function pick(row, names) {
  var keys = Object.keys(row || {});
  for (var i = 0; i < names.length; i++) {
    var wanted = key(names[i]);
    for (var x = 0; x < keys.length; x++) {
      if (key(keys[x]) === wanted) return row[keys[x]];
    }
  }
  return "";
}

export function normalizeExtracted(input) {
  var raw = input && typeof input === "object" ? input : {};
  var rawLines = Array.isArray(raw.lines) ? raw.lines : [];
  var lines = rawLines.map(function(row, index) {
    var quantity = money(row.quantity);
    var unitRate = money(row.unitRate || row.unit_rate);
    var calculated = money(quantity * unitRate);
    var printedAmount = money(row.printedAmount || row.lineAmount || row.line_amount);
    return {
      lineNumber: index + 1,
      sku: text(row.sku || row.item, 160),
      description: text(row.description || row.itemDescription, 1000),
      quantity: quantity,
      uom: text(row.uom || row.unit, 40),
      unitRate: unitRate,
      taxAmount: money(row.taxAmount || row.tax_amount),
      lineAmount: calculated,
      printedAmount: printedAmount,
      expectedDate: date(row.expectedDate || row.expected_date)
    };
  }).filter(function(line) {
    return line.description || line.sku || line.quantity;
  });
  var subtotal = money(lines.reduce(function(sum, line) { return sum + line.lineAmount; }, 0));
  var taxTotal = money(raw.taxTotal || raw.tax_total);
  var calculatedTotal = money(subtotal + taxTotal);
  var printedSubtotal = money(raw.printedSubtotal || raw.subtotal);
  var printedTotal = money(raw.printedTotal || raw.total);
  var warnings = [];
  if (!text(raw.customerName || raw.customer)) warnings.push("Customer is required.");
  if (!text(raw.poNumber || raw.po_number)) warnings.push("PO number is required.");
  if (!date(raw.poDate || raw.po_date)) warnings.push("PO date is required.");
  if (!lines.length) warnings.push("At least one line item is required.");
  lines.forEach(function(line, index) {
    if (!line.description) warnings.push("Line " + (index + 1) + " needs a description.");
    if (!(line.quantity > 0)) warnings.push("Line " + (index + 1) + " needs a positive quantity.");
    if (!line.uom) warnings.push("Line " + (index + 1) + " needs a unit of measure.");
    if (line.printedAmount && Math.abs(line.printedAmount - line.lineAmount) > 0.01) {
      warnings.push("Line " + (index + 1) + " printed amount differs from quantity × rate.");
    }
  });
  if (printedTotal && Math.abs(printedTotal - calculatedTotal) > 0.01) {
    warnings.push("Printed total differs from the deterministic calculated total.");
  }
  return {
    customerName: text(raw.customerName || raw.customer, 200),
    poNumber: text(raw.poNumber || raw.po_number, 120),
    poDate: date(raw.poDate || raw.po_date),
    expectedDate: date(raw.expectedDate || raw.receiveBy || raw.expected_date),
    vendor: text(raw.vendor, 500),
    billTo: text(raw.billTo || raw.bill_to, 1000),
    shipTo: text(raw.shipTo || raw.ship_to, 1000),
    memo: text(raw.memo, 2000),
    terms: text(raw.terms, 240),
    fob: text(raw.fob, 240),
    shippingMethod: text(raw.shippingMethod || raw.shipping_method, 240),
    currency: text(raw.currency, 3).toUpperCase() || "USD",
    subtotal: subtotal,
    taxTotal: taxTotal,
    total: calculatedTotal,
    printedSubtotal: printedSubtotal,
    printedTotal: printedTotal,
    lines: lines,
    warnings: warnings
  };
}

function spreadsheetExtraction(buffer, documentKind) {
  var workbook = XLSX.read(buffer, { type: "buffer", cellFormula: false, cellHTML: false });
  var first = workbook.Sheets[workbook.SheetNames[0]];
  var rows = XLSX.utils.sheet_to_json(first, { defval: "", raw: false });
  if (!rows.length) throw new Error("Spreadsheet contains no data rows.");
  var firstRow = rows[0] || {};
  return normalizeExtracted({
    customerName: pick(firstRow, ["customer", "customer name", "client"]),
    poNumber: pick(firstRow, documentKind === "quote" ? ["quote number", "quote no", "estimate number", "quote"] : ["po number", "purchase order", "purchase order number", "po"]),
    poDate: pick(firstRow, documentKind === "quote" ? ["quote date", "estimate date", "date"] : ["po date", "purchase order date", "date"]),
    expectedDate: pick(firstRow, documentKind === "quote" ? ["expiration date", "expiry date", "valid until", "expires"] : ["expected date", "arrival date", "receive by", "due date"]),
    currency: pick(firstRow, ["currency"]),
    taxTotal: pick(firstRow, ["tax total", "tax"]),
    total: pick(firstRow, ["total", "order total"]),
    lines: rows.map(function(row) {
      return {
        sku: pick(row, ["sku", "item", "item code", "product code"]),
        description: pick(row, ["description", "item description", "product"]),
        quantity: pick(row, ["quantity", "qty", "ordered quantity"]),
        uom: pick(row, ["uom", "unit", "unit of measure"]),
        unitRate: pick(row, ["unit rate", "rate", "unit price", "price per unit"]),
        printedAmount: pick(row, ["amount", "line total", "total cost"]),
        expectedDate: pick(row, ["expected date", "arrival date"])
      };
    })
  });
}

const EXTRACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    customerName: { type: ["string", "null"] },
    poNumber: { type: ["string", "null"] },
    poDate: { type: ["string", "null"] },
    expectedDate: { type: ["string", "null"] },
    vendor: { type: ["string", "null"] },
    billTo: { type: ["string", "null"] },
    shipTo: { type: ["string", "null"] },
    memo: { type: ["string", "null"] },
    terms: { type: ["string", "null"] },
    fob: { type: ["string", "null"] },
    shippingMethod: { type: ["string", "null"] },
    currency: { type: ["string", "null"] },
    subtotal: { type: ["number", "null"] },
    taxTotal: { type: ["number", "null"] },
    total: { type: ["number", "null"] },
    lines: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          sku: { type: ["string", "null"] },
          description: { type: ["string", "null"] },
          quantity: { type: ["number", "null"] },
          uom: { type: ["string", "null"] },
          unitRate: { type: ["number", "null"] },
          taxAmount: { type: ["number", "null"] },
          lineAmount: { type: ["number", "null"] },
          expectedDate: { type: ["string", "null"] }
        },
        required: ["sku","description","quantity","uom","unitRate","taxAmount","lineAmount","expectedDate"]
      }
    }
  },
  required: ["customerName","poNumber","poDate","expectedDate","vendor","billTo","shipTo","memo","terms","fob","shippingMethod","currency","subtotal","taxTotal","total","lines"]
};

async function modelExtraction(buffer, contentType, documentKind) {
  var apiKey = process.env.OPENAI_API_KEY || "";
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured.");
  var model = process.env.OPENAI_MODEL || "gpt-5-mini";
  var dataUrl = "data:" + contentType + ";base64," + buffer.toString("base64");
  var quoteInstructions = "Extract this customer quote. Put the quote number in poNumber, the quote date in poDate, and the expiration/valid-until date in expectedDate.";
  var poInstructions = "Extract this client purchase order.";
  var content = [{ type: "input_text", text: (documentKind === "quote" ? quoteInstructions : poInstructions) + " Preserve printed values and use ISO YYYY-MM-DD dates. Use null when a field is absent. Do not infer SKU from a description." }];
  if (contentType.indexOf("image/") === 0) content.push({ type: "input_image", image_url: dataUrl });
  else content.push({ type: "input_file", filename: "purchase-order.pdf", file_data: dataUrl });
  var response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Authorization": "Bearer " + apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: model,
      input: [{ role: "user", content: content }],
      text: { format: { type: "json_schema", name: documentKind === "quote" ? "customer_quote" : "purchase_order", strict: true, schema: EXTRACTION_SCHEMA } }
    })
  });
  var body = await response.json().catch(function() { return {}; });
  if (!response.ok) throw new Error(text(body && body.error && body.error.message, 500) || "OpenAI extraction failed.");
  var outputText = body.output_text;
  if (!outputText && Array.isArray(body.output)) {
    body.output.some(function(item) {
      return Array.isArray(item.content) && item.content.some(function(part) {
        if (part.type === "output_text" && part.text) { outputText = part.text; return true; }
        return false;
      });
    });
  }
  if (!outputText) throw new Error("The extraction model returned no structured data.");
  return { data: normalizeExtracted(JSON.parse(outputText)), model: model };
}

export async function extractFile(buffer, contentType, documentKind) {
  var ext = ALLOWED_TYPES[contentType];
  if (ext === "csv" || ext === "xls" || ext === "xlsx") {
    return { data: spreadsheetExtraction(buffer, documentKind), model: "deterministic-spreadsheet-parser-v1" };
  }
  return modelExtraction(buffer, contentType, documentKind);
}

export function validateUpload(body) {
  var fileName = text(body && body.fileName, 240).replace(/[\/\\]/g, "_");
  var contentType = text(body && body.contentType, 120).toLowerCase();
  if (!fileName || !body || !body.base64) throw new Error("File name and file content are required.");
  if (!ALLOWED_TYPES[contentType]) throw new Error("Unsupported file type.");
  var buffer = Buffer.from(String(body.base64), "base64");
  if (!buffer.length) throw new Error("The uploaded file is empty.");
  if (buffer.length > MAX_FILE_BYTES) throw new Error("Files must be 3 MB or smaller.");
  var claimedExtension = fileName.split(".").pop().toLowerCase();
  var expected = ALLOWED_TYPES[contentType];
  var extensionOk = claimedExtension === expected ||
    (expected === "jpg" && claimedExtension === "jpeg") ||
    (expected === "xls" && claimedExtension === "csv");
  if (!extensionOk) throw new Error("File extension does not match its content type.");
  if (contentType === "application/pdf" && buffer.slice(0, 5).toString() !== "%PDF-") throw new Error("Invalid PDF file.");
  if (contentType === "application/pdf") {
    var pdfText = buffer.toString("latin1");
    if (/\/Encrypt\b/.test(pdfText)) throw new Error("Encrypted PDFs are not supported.");
    var pageCount = (pdfText.match(/\/Type\s*\/Page\b/g) || []).length;
    if (pageCount > 20) throw new Error("PDFs may contain at most 20 pages.");
  }
  return { fileName: fileName, contentType: contentType, buffer: buffer };
}

async function findExistingPurchaseOrder(supabase, revision, extracted) {
  var query = supabase.from("purchase_orders")
    .select("id,customer_name,po_number,status,revision_number,current_revision_id,updated_at")
    .eq("site_id", CACHE_SITE_ID);
  if (revision && revision.purchase_order_id) query = query.eq("id", revision.purchase_order_id);
  else {
    var customerKey = key(extracted && extracted.customerName);
    var poNumberKey = key(extracted && extracted.poNumber);
    if (!customerKey || !poNumberKey) return null;
    query = query.eq("customer_key", customerKey).eq("po_number_key", poNumberKey);
  }
  var result = await query.maybeSingle();
  if (result.error) throw result.error;
  return result.data || null;
}

export async function stageUpload(input, user) {
  var valid = validateUpload(input);
  var supabase = getSupabaseAdmin();
  var sha256 = crypto.createHash("sha256").update(valid.buffer).digest("hex");
  var existing = await supabase.from("purchase_order_revisions").select("*").eq("site_id", CACHE_SITE_ID).eq("sha256", sha256).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) {
    var exactFilePo = await findExistingPurchaseOrder(supabase, existing.data, existing.data.extracted_data);
    return {
      duplicate: true, duplicateType: "exact_file", revision: existing.data,
      extracted: existing.data.extracted_data, existingPurchaseOrder: exactFilePo,
      documentUrl: await signedDocumentUrl(supabase, existing.data)
    };
  }
  var storagePath = CACHE_SITE_ID + "/" + sha256.slice(0, 2) + "/" + sha256 + "." + ALLOWED_TYPES[valid.contentType];
  var stored = await supabase.storage.from(BUCKET).upload(storagePath, valid.buffer, {
    contentType: valid.contentType,
    upsert: false
  });
  if (stored.error && String(stored.error.message || "").toLowerCase().indexOf("already exists") === -1) throw stored.error;
  var extraction;
  try {
    extraction = await extractFile(valid.buffer, valid.contentType);
  } catch (error) {
    var failed = await supabase.from("purchase_order_revisions").insert({
      site_id: CACHE_SITE_ID, processing_status: "failed", original_file_name: valid.fileName,
      content_type: valid.contentType, byte_size: valid.buffer.length, sha256: sha256,
      storage_path: storagePath, extraction_error: text(error.message, 1000),
      created_by: user.email
    }).select("*").single();
    if (failed.error) throw failed.error;
    return {
      duplicate: false, revision: failed.data, error: failed.data.extraction_error,
      documentUrl: await signedDocumentUrl(supabase, failed.data)
    };
  }
  var inserted = await supabase.from("purchase_order_revisions").insert({
    site_id: CACHE_SITE_ID, processing_status: "needs_review", original_file_name: valid.fileName,
    content_type: valid.contentType, byte_size: valid.buffer.length, sha256: sha256,
    storage_path: storagePath, extracted_data: extraction.data,
    warnings: extraction.data.warnings, extraction_model: extraction.model, created_by: user.email
  }).select("*").single();
  if (inserted.error) throw inserted.error;
  var existingPurchaseOrder = await findExistingPurchaseOrder(supabase, null, extraction.data);
  return {
    duplicate: false, duplicateType: existingPurchaseOrder ? "po_identity" : null,
    revision: inserted.data, extracted: extraction.data, existingPurchaseOrder: existingPurchaseOrder,
    documentUrl: await signedDocumentUrl(supabase, inserted.data)
  };
}

export async function signedDocumentUrl(supabase, revision) {
  if (!revision || !revision.storage_path) return null;
  var signed = await supabase.storage.from(revision.storage_bucket || BUCKET).createSignedUrl(revision.storage_path, 300);
  return signed.error ? null : signed.data.signedUrl;
}

export async function addEvent(supabase, poId, revisionId, type, user, extra) {
  var row = {
    site_id: CACHE_SITE_ID, purchase_order_id: poId || null, revision_id: revisionId || null,
    event_type: type, actor: user && user.email || "system",
    from_status: extra && extra.fromStatus || null, to_status: extra && extra.toStatus || null,
    note: text(extra && extra.note, 2000) || null, metadata: extra && extra.metadata || {}
  };
  var result = await supabase.from("purchase_order_events").insert(row);
  if (result.error) throw result.error;
}

export function validateConfirmed(input) {
  var normalized = normalizeExtracted(input);
  if (normalized.warnings.some(function(w) { return /required|needs a|At least/.test(w); })) {
    var error = new Error("Required purchase order fields are incomplete.");
    error.statusCode = 400;
    error.warnings = normalized.warnings;
    throw error;
  }
  return normalized;
}

function productionPoNumber(row) {
  return pick(row && row.raw || {}, ["Purchase Order Number","Purchase Order number","purchase_order_number","PO Number","PO"]);
}

async function productionForPurchaseOrder(supabase, poNumber) {
  var production = [];
  var from = 0;
  while (from < 50000) {
    var batch = await supabase.from("production_events")
      .select("job_id,work_order_code,item_code,units_produced,produced_date_et,produced_at_utc,line,raw")
      .eq("site_id", CACHE_SITE_ID).range(from, from + 999);
    if (batch.error) {
      if (String(batch.error.message || "").toLowerCase().indexOf("relation") !== -1) break;
      throw batch.error;
    }
    production = production.concat(batch.data || []);
    if (!batch.data || batch.data.length < 1000) break;
    from += 1000;
  }
  var poKey = key(poNumber);
  return production.filter(function(event) { return key(productionPoNumber(event)) === poKey; });
}

export async function previewPurchaseOrderReconciliation(supabase, po) {
  var results = await Promise.all([
    supabase.from("purchase_order_lines").select("*").eq("site_id", CACHE_SITE_ID)
      .eq("purchase_order_id", po.id).eq("revision_id", po.current_revision_id).eq("active", true).order("line_number"),
    supabase.from("purchase_order_item_mappings").select("*").eq("site_id", CACHE_SITE_ID).eq("purchase_order_id", po.id),
    productionForPurchaseOrder(supabase, po.po_number)
  ]);
  if (results[0].error) throw results[0].error;
  if (results[1].error) throw results[1].error;
  var production = results[2] || [];
  var mappingByLine = {};
  (results[1].data || []).forEach(function(row) { mappingByLine[row.line_id] = row.production_item_code; });
  var candidatesByKey = {};
  production.forEach(function(event) {
    var itemCode = text(event.item_code, 160);
    var itemKey = key(itemCode);
    if (!itemKey) return;
    if (!candidatesByKey[itemKey]) candidatesByKey[itemKey] = { itemCode: itemCode, itemKey: itemKey, produced: 0, jobs: {} };
    var candidate = candidatesByKey[itemKey];
    var units = toNum(event.units_produced);
    candidate.produced += units;
    var jobId = text(event.job_id || pick(event.raw || {}, ["Job ID","Job","job_id"]), 160) || "Unknown job";
    var jobKey = key(jobId + "|" + (event.work_order_code || "")) || jobId;
    if (!candidate.jobs[jobKey]) candidate.jobs[jobKey] = {
      jobId: jobId, workOrderCode: text(event.work_order_code, 160), line: text(event.line, 120),
      produced: 0, firstProducedDate: event.produced_date_et || null
    };
    candidate.jobs[jobKey].produced += units;
    if (event.produced_date_et && (!candidate.jobs[jobKey].firstProducedDate || event.produced_date_et < candidate.jobs[jobKey].firstProducedDate)) {
      candidate.jobs[jobKey].firstProducedDate = event.produced_date_et;
    }
  });
  var candidates = Object.keys(candidatesByKey).map(function(itemKey) {
    var candidate = candidatesByKey[itemKey];
    candidate.jobs = Object.keys(candidate.jobs).map(function(jobKey) { return candidate.jobs[jobKey]; })
      .sort(function(a, b) { return String(a.jobId).localeCompare(String(b.jobId)); });
    candidate.jobCount = candidate.jobs.length;
    return candidate;
  }).sort(function(a, b) { return String(a.itemCode).localeCompare(String(b.itemCode)); });
  var lines = (results[0].data || []).map(function(line) {
    var reviewedCode = mappingByLine[line.id] || "";
    var exact = candidates.find(function(candidate) { return candidate.itemKey === key(line.sku); });
    var selectedItemCode = reviewedCode || exact && exact.itemCode || "";
    return {
      id: line.id, lineNumber: line.line_number, sku: line.sku || "", description: line.description,
      ordered: toNum(line.quantity), currentProduced: toNum(line.produced_quantity),
      selectedItemCode: selectedItemCode, selectionSource: reviewedCode ? "reviewed" : exact ? "exact_sku" : "unmatched",
      candidates: candidates.map(function(candidate) { return Object.assign({}, candidate, { exactSku: candidate.itemKey === key(line.sku) }); })
    };
  });
  return {
    poNumber: po.po_number, productionRowCount: production.length, candidateItemCount: candidates.length,
    jobCount: candidates.reduce(function(sum, candidate) { return sum + candidate.jobCount; }, 0),
    lines: lines, candidates: candidates,
    message: !production.length ? "No Nulogy production records were found for PO " + po.po_number + "." : null
  };
}

export async function reconcilePurchaseOrder(supabase, po) {
  var linesResult = await supabase.from("purchase_order_lines").select("*")
    .eq("site_id", CACHE_SITE_ID).eq("purchase_order_id", po.id).eq("revision_id", po.current_revision_id).eq("active", true);
  if (linesResult.error) throw linesResult.error;
  var lines = linesResult.data || [];
  var matchingEvents = await productionForPurchaseOrder(supabase, po.po_number);
  var mappingsResult = await supabase.from("purchase_order_item_mappings").select("*").eq("site_id", CACHE_SITE_ID).eq("purchase_order_id", po.id);
  if (mappingsResult.error) throw mappingsResult.error;
  var mappingByLine = {};
  (mappingsResult.data || []).forEach(function(row) { mappingByLine[row.line_id] = row.production_item_key; });
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var matchKey = mappingByLine[line.id] || key(line.sku);
    var produced = matchKey ? matchingEvents.reduce(function(sum, event) {
      return key(event.item_code) === matchKey ? sum + toNum(event.units_produced) : sum;
    }, 0) : 0;
    var remaining = Math.max(0, toNum(line.quantity) - produced);
    var status = !matchKey || !matchingEvents.length ? "unmatched" :
      produced <= 0 ? "matched" : remaining > 0 ? "partial" :
      produced > toNum(line.quantity) ? "overproduced" : "fulfilled";
    var update = await supabase.from("purchase_order_lines").update({
      produced_quantity: produced, remaining_quantity: remaining, match_status: status
    }).eq("id", line.id).eq("site_id", CACHE_SITE_ID);
    if (update.error) throw update.error;
    line.produced_quantity = produced;
    line.remaining_quantity = remaining;
    line.match_status = status;
  }
  var suggested = lines.length && lines.every(function(line) {
    return line.match_status === "fulfilled" || line.match_status === "overproduced";
  }) ? "closed" : "open";
  var poUpdate = await supabase.from("purchase_orders").update({ suggested_status: suggested }).eq("id", po.id).eq("site_id", CACHE_SITE_ID);
  if (poUpdate.error) throw poUpdate.error;
  return { suggestedStatus: suggested, lines: lines, matchedProductionRows: matchingEvents.length };
}
