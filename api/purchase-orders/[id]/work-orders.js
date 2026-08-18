import Sentry from "../../_sentry.js";
import { CACHE_SITE_ID, getAuthenticatedUser, getSupabaseAdmin, toNum, withCors } from "../../ops/_common.js";
import { addEvent, date, key, text } from "../_service.js";
import { matchCustomerName } from "../../ops/_customer-aliases.js";

function pick(row, names) {
  var keys = Object.keys(row || {});
  for (var nameIndex = 0; nameIndex < names.length; nameIndex++) {
    var wanted = key(names[nameIndex]);
    for (var keyIndex = 0; keyIndex < keys.length; keyIndex++) {
      if (key(keys[keyIndex]) === wanted) return row[keys[keyIndex]];
    }
  }
  return "";
}

function missingMatchesTable(error) {
  var message = String(error && error.message || "").toLowerCase();
  return message.indexOf("purchase_order_work_order_matches") !== -1 &&
    (message.indexOf("schema cache") !== -1 || message.indexOf("relation") !== -1);
}

function normalizeWorkOrder(row) {
  var code = text(pick(row, ["Work Order Code","project_code","Project Code","Work Order","WO Number","wo_number"]), 160);
  return {
    code: code,
    codeKey: key(code),
    purchaseOrderNumber: text(pick(row, ["Purchase Order Number","Purchase Order number","purchase_order_number","PO Number","PO"]), 160),
    sku: text(pick(row, ["Item Code","item_code","Product SKU","product_sku","SKU"]), 160),
    description: text(pick(row, ["Item Description","item_description","Description","Project Description","project_description"]), 500),
    customer: text(pick(row, ["Work Order Customer","project_customer_name","Project Customer","Customer Name","customer_name","Customer"]), 240),
    status: text(pick(row, ["Work Order Status","work_order_status","Status","state"]), 120),
    dueDate: date(pick(row, ["Due Date","due_date","Need Date","Required Date"])),
    quantity: toNum(pick(row, ["Units Expected","units_expected","Order Qty","Quantity","qty"])),
    produced: toNum(pick(row, ["Units Produced","units_produced","Produced"])),
    remaining: toNum(pick(row, ["Units Remaining","units_remaining","Remaining"])),
    reference: text(pick(row, ["Reference 1","reference_1","Project Reference 1","project_reference_1"]), 300)
  };
}

export function scoreCandidate(po, line, workOrder, customerNames) {
  var normalizedPo = text(po.po_number, 160).replace(/\s+/g, "").toLowerCase();
  var normalizedWorkOrderCode = text(workOrder.code, 160).replace(/\s+/g, "").toLowerCase();
  var escapedPo = normalizedPo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  var poBasedWorkOrderCode = Boolean(normalizedPo) && new RegExp("^" + escapedPo + "-\\d+$").test(normalizedWorkOrderCode);
  var exactPo = key(workOrder.purchaseOrderNumber) === key(po.po_number) || key(workOrder.reference) === key(po.po_number) || poBasedWorkOrderCode;
  var exactSku = Boolean(key(line.sku)) && key(workOrder.sku) === key(line.sku);
  var customerMatch = matchCustomerName(po.customer_name, customerNames);
  var exactCustomer = customerMatch.matched && key(workOrder.customer) === key(customerMatch.matchedName);
  if (!exactPo || !exactSku || !exactCustomer) return null;
  return { score: 100, confidence: "exact", reasons: [poBasedWorkOrderCode ? "PO base number + run suffix" : "Exact PO number", "Exact SKU", "Exact customer"] };
}

async function buildPreview(supabase, po) {
  var results = await Promise.all([
    supabase.from("purchase_order_lines").select("*").eq("site_id", CACHE_SITE_ID).eq("purchase_order_id", po.id).eq("revision_id", po.current_revision_id).eq("active", true).order("line_number"),
    supabase.from("cache_snapshots").select("payload,synced_at").eq("site_id", CACHE_SITE_ID).maybeSingle(),
    supabase.from("purchase_order_work_order_matches").select("*").eq("site_id", CACHE_SITE_ID).eq("purchase_order_id", po.id)
  ]);
  if (results[0].error) throw results[0].error;
  if (results[1].error) throw results[1].error;
  var databaseStatus = "ready";
  if (results[2].error) {
    if (!missingMatchesTable(results[2].error)) throw results[2].error;
    databaseStatus = "missing_table";
  }
  var rawWorkOrders = results[1].data && results[1].data.payload && Array.isArray(results[1].data.payload.workOrders) ? results[1].data.payload.workOrders : [];
  var workOrdersByKey = {};
  rawWorkOrders.map(normalizeWorkOrder).filter(function(row) { return row.codeKey; }).forEach(function(row) { workOrdersByKey[row.codeKey] = row; });
  var workOrders = Object.keys(workOrdersByKey).map(function(workOrderKey) { return workOrdersByKey[workOrderKey]; });
  var selectedByLine = {};
  (results[2].data || []).forEach(function(match) {
    if (!selectedByLine[match.line_id]) selectedByLine[match.line_id] = [];
    selectedByLine[match.line_id].push(match.work_order_code);
  });
  var lines = (results[0].data || []).map(function(line) {
    var candidates = workOrders.map(function(workOrder) {
      var match = scoreCandidate(po, line, workOrder, workOrders.map(function(row) { return row.customer; }).filter(Boolean));
      return match ? Object.assign({}, workOrder, match) : null;
    }).filter(Boolean).sort(function(left, right) { return right.score - left.score || String(left.code).localeCompare(String(right.code)); }).slice(0, 25);
    return {
      id: line.id, lineNumber: line.line_number, sku: line.sku || "", description: line.description,
      quantity: toNum(line.quantity), selectedWorkOrderCodes: selectedByLine[line.id] || [], candidates: candidates
    };
  });
  return {
    databaseStatus: databaseStatus, poNumber: po.po_number, customer: po.customer_name,
    snapshotAt: results[1].data && results[1].data.synced_at || null, workOrderCount: workOrders.length,
    matchedCount: lines.reduce(function(sum, line) { return sum + line.selectedWorkOrderCodes.length; }, 0), lines: lines
  };
}

export default async function handler(req, res) {
  withCors(req, res, ["GET", "POST", "OPTIONS"]);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET" && req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    var user = getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    var supabase = getSupabaseAdmin();
    var id = text(req.query && req.query.id, 80);
    var found = await supabase.from("purchase_orders").select("*").eq("site_id", CACHE_SITE_ID).eq("id", id).single();
    if (found.error) return res.status(404).json({ error: "Purchase order not found" });
    var preview = await buildPreview(supabase, found.data);
    if (req.method === "GET") return res.status(200).json(preview);
    if (preview.databaseStatus !== "ready") return res.status(409).json({ error: "Work Order matching database setup required. Run docs/supabase-purchase-order-work-order-matches.sql in Supabase." });
    var requested = Array.isArray(req.body && req.body.matches) ? req.body.matches : [];
    var lineById = {};
    preview.lines.forEach(function(line) { lineById[line.id] = line; });
    var rows = [];
    for (var matchIndex = 0; matchIndex < requested.length; matchIndex++) {
      var request = requested[matchIndex] || {};
      var line = lineById[text(request.lineId, 80)];
      if (!line) return res.status(400).json({ error: "A selected PO line is no longer active." });
      var candidateByKey = {};
      line.candidates.forEach(function(candidate) { candidateByKey[candidate.codeKey] = candidate; });
      var codes = Array.isArray(request.workOrderCodes) ? request.workOrderCodes : [];
      for (var codeIndex = 0; codeIndex < codes.length; codeIndex++) {
        var candidate = candidateByKey[key(codes[codeIndex])];
        if (!candidate) return res.status(400).json({ error: "A selected Work Order is not a candidate for this PO line." });
        rows.push({
          site_id: CACHE_SITE_ID, purchase_order_id: id, line_id: line.id,
          work_order_code: candidate.code, work_order_key: candidate.codeKey,
          match_method: "reviewed", work_order_snapshot: candidate,
          reviewed_by: user.email, reviewed_at: new Date().toISOString()
        });
      }
    }
    var removed = await supabase.from("purchase_order_work_order_matches").delete().eq("site_id", CACHE_SITE_ID).eq("purchase_order_id", id);
    if (removed.error) throw removed.error;
    if (rows.length) {
      var inserted = await supabase.from("purchase_order_work_order_matches").insert(rows);
      if (inserted.error) throw inserted.error;
    }
    await addEvent(supabase, id, found.data.current_revision_id, "work_orders_matched", user, {
      metadata: { matchedWorkOrders: rows.map(function(row) { return row.work_order_code; }), lineCount: requested.length }
    });
    var updatedPreview = await buildPreview(supabase, found.data);
    return res.status(200).json(Object.assign({}, updatedPreview, { message: rows.length + " Work Order match" + (rows.length === 1 ? "" : "es") + " saved." }));
  } catch (error) {
    Sentry.captureException(error);
    return res.status(500).json({ error: error.message || "Work Order matching failed" });
  }
}
