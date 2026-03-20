import { CACHE_SITE_ID, toNum } from "./_common.js";

function normalizeStr(value) {
  return String(value || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

export function normalizeWorkOrderCode(value) {
  var s = String(value || "").trim();
  if (!s) return "";
  s = s.replace(/\.0+$/, "");
  return normalizeStr(s);
}

export function normalizeSkuCode(value) {
  var s = String(value || "").trim();
  if (!s) return "";
  s = s.replace(/\.0+$/, "");
  return normalizeStr(s);
}

function pickValue(row, keys) {
  if (!row || typeof row !== "object") return "";
  var rowKeys = Object.keys(row);
  for (var i = 0; i < keys.length; i++) {
    var target = normalizeStr(keys[i]);
    for (var j = 0; j < rowKeys.length; j++) {
      var key = rowKeys[j];
      if (normalizeStr(key) === target) return row[key];
    }
  }
  return "";
}

function statusLooksClosed(status) {
  var s = normalizeStr(status || "");
  if (!s) return false;
  return s.indexOf("close") !== -1 || s.indexOf("complete") !== -1 || s.indexOf("cancel") !== -1 || s.indexOf("archive") !== -1 || s.indexOf("done") !== -1;
}

function chunk(list, size) {
  var out = [];
  for (var i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

async function fetchRowsByWorkOrderChunk(supabase, workOrderCodes) {
  var pageSize = 1000;
  var from = 0;
  var out = [];
  while (true) {
    var to = from + pageSize - 1;
    var q = await supabase
      .from("production_events")
      .select("work_order_code,item_code,units_produced")
      .eq("site_id", CACHE_SITE_ID)
      .in("work_order_code", workOrderCodes)
      .range(from, to);
    if (q.error) throw q.error;
    var rows = Array.isArray(q.data) ? q.data : [];
    out = out.concat(rows);
    if (rows.length < pageSize) break;
    from += pageSize;
    if (from > 500000) break;
  }
  return out;
}

export function extractRequestedWorkOrders(workOrders) {
  return (Array.isArray(workOrders) ? workOrders : []).map(function(row) {
    var woCode = String(pickValue(row, [
      "woNum", "wo_code", "woNumRaw",
      "Work Order Code", "project_code", "Project Code", "work_order_code"
    ]) || "").trim();
    var sku = String(pickValue(row, [
      "sku", "productSku", "productSkuRaw",
      "Item Code", "item_code", "Code", "code"
    ]) || "").trim();
    var status = String(pickValue(row, [
      "status", "Work Order Status", "project_status"
    ]) || "").trim();
    return {
      woCode: woCode,
      woKey: normalizeWorkOrderCode(woCode),
      sku: sku,
      skuKey: normalizeSkuCode(sku),
      status: status,
      closed: statusLooksClosed(status)
    };
  }).filter(function(row) {
    return !!(row.woCode || row.sku);
  });
}

export async function fetchProductionTotalsForWorkOrders(supabase, workOrders) {
  var refs = extractRequestedWorkOrders(workOrders).filter(function(row) {
    return !!row.woCode && !row.closed;
  });
  if (!refs.length) {
    return {
      requestedRows: 0,
      matchedRows: 0,
      byWorkOrder: {},
      bySku: {}
    };
  }

  var uniqueRawCodes = Array.from(new Set(refs.map(function(row) { return row.woCode; }).filter(Boolean)));
  var byWorkOrder = {};
  var bySku = {};
  var matchedRows = 0;

  var groups = chunk(uniqueRawCodes, 100);
  for (var i = 0; i < groups.length; i++) {
    var rows = await fetchRowsByWorkOrderChunk(supabase, groups[i]);
    rows.forEach(function(row) {
      var units = toNum(row && row.units_produced);
      if (!(units > 0)) return;
      var woKey = normalizeWorkOrderCode(row && row.work_order_code);
      var skuKey = normalizeSkuCode(row && row.item_code);
      matchedRows += 1;
      if (woKey) byWorkOrder[woKey] = (byWorkOrder[woKey] || 0) + units;
      if (skuKey) bySku[skuKey] = (bySku[skuKey] || 0) + units;
    });
  }

  return {
    requestedRows: refs.length,
    matchedRows: matchedRows,
    byWorkOrder: byWorkOrder,
    bySku: bySku
  };
}
