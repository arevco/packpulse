import { normalizeStr } from "../utils.js";

function normalizeLooseKey(value) {
  return normalizeStr(value || "");
}

function pickLooseValue(row, keys) {
  if (!row || typeof row !== "object") return "";
  var rowKeys = Object.keys(row);
  for (var i = 0; i < keys.length; i++) {
    var wanted = normalizeLooseKey(keys[i]);
    for (var j = 0; j < rowKeys.length; j++) {
      if (normalizeLooseKey(rowKeys[j]) === wanted) return row[rowKeys[j]];
    }
  }
  return "";
}

function firstNonEmpty(row, keys) {
  for (var i = 0; i < keys.length; i++) {
    var value = pickLooseValue(row, [keys[i]]);
    if (value != null && String(value).trim() !== "") return value;
  }
  return "";
}

function applyAlias(target, key, value) {
  if (!target || !key) return;
  if (value == null || String(value).trim() === "") return;
  if (target[key] == null || String(target[key]).trim() === "") {
    target[key] = value;
  }
}

function inferInboundSource(row, sourceHint) {
  var hinted = normalizeLooseKey(sourceHint);
  if (hinted.includes("receiveorder")) return "Receive Orders";
  if (hinted.includes("edr")) return "Legacy EDR";
  var rowKeys = Object.keys(row || {}).map(normalizeLooseKey);
  if (rowKeys.some(function(key) { return key.indexOf("receiveorder") !== -1; })) return "Receive Orders";
  if (rowKeys.indexOf("expecteddeliverydate") !== -1 && rowKeys.indexOf("quantity") !== -1) return "Receive Orders";
  return "Legacy EDR";
}

function isReceiveOrderSource(source) {
  return normalizeLooseKey(source).indexOf("receiveorders") !== -1;
}

function isClosedReceiveOrderValue(value) {
  var normalized = normalizeLooseKey(value);
  return normalized === "yes" || normalized === "true" || normalized === "1";
}

export function normalizeInboundRows(rows, sourceHint) {
  if (!Array.isArray(rows)) return [];
  return rows.reduce(function(out, row) {
    var next = Object.assign({}, row);
    var material = firstNonEmpty(row, [
      "Material",
      "Material Code",
      "Item Code",
      "SKU",
      "Subcomponent Code"
    ]);
    var description = firstNonEmpty(row, [
      "Description",
      "Item Description",
      "Material Description",
      "Short Text",
      "Mat Desc"
    ]);
    var deliveryDate = firstNonEmpty(row, [
      "Delivery Date",
      "Expected delivery date",
      "Expected Delivery Date",
      "Receive Order Item expected delivery date",
      "Expected ship date",
      "Actual ship date",
      "RO Date",
      "Req Dely"
    ]);
    var orderQuantity = firstNonEmpty(row, [
      "Order Quantity",
      "Expected unit quantity",
      "Expected Quantity",
      "Actual unit quantity",
      "Quantity"
    ]);
    var poNumber = firstNonEmpty(row, [
      "PO Number",
      "Purchasing Document",
      "Purchase Order Number",
      "Receive Order Code",
      "Receive Order",
      "Reference",
      "External identifier"
    ]);
    var receiveOrderCode = firstNonEmpty(row, [
      "Receive Order Code",
      "Receive Order"
    ]);
    var unitOfMeasure = firstNonEmpty(row, [
      "Unit Of Measure",
      "Unit of measure",
      "Receive Order expected unit of measure"
    ]);
    var received = firstNonEmpty(row, [
      "Received",
      "Receive Order received"
    ]);
    var source = inferInboundSource(row, sourceHint);
    if (isReceiveOrderSource(source) && isClosedReceiveOrderValue(received)) {
      return out;
    }

    applyAlias(next, "Material", material);
    applyAlias(next, "Item Code", material);
    applyAlias(next, "Description", description);
    applyAlias(next, "Item Description", description);
    applyAlias(next, "Delivery Date", deliveryDate);
    applyAlias(next, "Expected delivery date", deliveryDate);
    applyAlias(next, "Order Quantity", orderQuantity);
    applyAlias(next, "PO Number", poNumber);
    applyAlias(next, "Receive Order Code", receiveOrderCode);
    applyAlias(next, "Unit Of Measure", unitOfMeasure);
    applyAlias(next, "Received", received);
    applyAlias(next, "Inbound Source", source);
    applyAlias(next, "__inboundSource", isReceiveOrderSource(source) ? "receive_orders" : "legacy_edr");

    out.push(next);
    return out;
  }, []);
}
