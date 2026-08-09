import { key, text } from "./_service.js";

function pick(row, names) {
  var rowKeys = Object.keys(row || {});
  for (var nameIndex = 0; nameIndex < names.length; nameIndex++) {
    var wanted = key(names[nameIndex]);
    for (var keyIndex = 0; keyIndex < rowKeys.length; keyIndex++) {
      if (key(rowKeys[keyIndex]) === wanted) return row[rowKeys[keyIndex]];
    }
  }
  return "";
}

function positiveNumber(value) {
  var parsed = Number(String(value == null ? "" : value).replace(/[$,]/g, ""));
  return Number.isFinite(parsed) && parsed > 0;
}

function customerValue(row) {
  return text(pick(row, [
    "Customer Name", "customer_name", "Customer", "Item Customer", "item_customer",
    "Item Customer Name", "item_customer_name", "Work Order Customer", "project_customer_name"
  ]), 240);
}

function skuValue(row) {
  return text(pick(row, ["Item Code", "item_code", "Code", "code", "SKU", "Product SKU", "product_sku"]), 160);
}

function poNumberValue(row) {
  return text(pick(row, [
    "Purchase Order Number", "Purchase Order number", "purchase_order_number", "PO Number", "PO",
    "Reference 1", "reference_1", "Project Reference 1", "project_reference_1"
  ]), 160);
}

function priceValue(row) {
  return pick(row, [
    "Purchase Price Per Unit", "purchase_price_per_unit", "Price Per Unit", "price_per_unit",
    "Unit Price", "unit_price", "Cost Per Unit", "cost_per_unit", "Unit Cost", "unit_cost",
    "Standard Cost", "standard_cost", "Cost Per Base Unit", "cost_per_base_unit"
  ]);
}

function check(status, label, detail, missing) {
  return { status: status, label: label, detail: detail, missing: missing || [] };
}

export function buildNulogySetupStatus(po, lines, snapshot) {
  var payload = snapshot && snapshot.payload && typeof snapshot.payload === "object" ? snapshot.payload : null;
  var activeLines = (Array.isArray(lines) ? lines : []).filter(function(line) { return line && line.active !== false; });
  if (!payload) {
    var unavailableChecks = [
      check("unknown", "Customer", "No Nulogy snapshot is available."),
      check("unknown", "Item numbers", "No Nulogy snapshot is available."),
      check("unknown", "Price", "No Nulogy snapshot is available."),
      check("unknown", "Work Order", "No Nulogy snapshot is available.")
    ];
    return { status: "unknown", completeCount: 0, totalCount: 4, checks: unavailableChecks, verifiedAt: null };
  }

  var inventory = Array.isArray(payload.inventory) ? payload.inventory : [];
  var itemMaster = Array.isArray(payload.itemMaster) ? payload.itemMaster : [];
  var workOrders = Array.isArray(payload.workOrders) ? payload.workOrders : [];
  var allRows = itemMaster.concat(inventory, workOrders);
  var customerKey = key(po && po.customer_name);
  var customerFound = Boolean(customerKey) && allRows.some(function(row) { return key(customerValue(row)) === customerKey; });

  var nulogySkus = {};
  var pricedSkus = {};
  allRows.forEach(function(row) {
    var skuKey = key(skuValue(row));
    if (!skuKey) return;
    nulogySkus[skuKey] = true;
    if (positiveNumber(priceValue(row))) pricedSkus[skuKey] = true;
  });
  var poSkus = activeLines.map(function(line) { return text(line.sku, 160); });
  var missingItems = poSkus.filter(function(sku) { return !sku || !nulogySkus[key(sku)]; });
  var missingPrices = poSkus.filter(function(sku) { return !sku || !pricedSkus[key(sku)]; });
  var poNumberKey = key(po && po.po_number);
  var matchingWorkOrders = workOrders.filter(function(row) { return poNumberKey && key(poNumberValue(row)) === poNumberKey; });

  var checks = [
    customerFound
      ? check("complete", "Customer", "Exact customer found in Nulogy.")
      : check("needed", "Customer", "Customer name was not found in the current Nulogy data.", [text(po && po.customer_name, 240) || "Customer name"]),
    poSkus.length && !missingItems.length
      ? check("complete", "Item numbers", poSkus.length + " of " + poSkus.length + " PO SKUs found in Nulogy.")
      : check("needed", "Item numbers", (poSkus.length - missingItems.length) + " of " + poSkus.length + " PO SKUs found in Nulogy.", missingItems),
    poSkus.length && !missingPrices.length
      ? check("complete", "Price", poSkus.length + " of " + poSkus.length + " PO SKUs have Nulogy pricing.")
      : check("needed", "Price", (poSkus.length - missingPrices.length) + " of " + poSkus.length + " PO SKUs have Nulogy pricing.", missingPrices),
    matchingWorkOrders.length
      ? check("complete", "Work Order", matchingWorkOrders.length + " Work Order" + (matchingWorkOrders.length === 1 ? "" : "s") + " found with this exact PO number.")
      : check("needed", "Work Order", "No Work Order has this exact PO number.", [text(po && po.po_number, 160) || "PO number"])
  ];
  var completeCount = checks.filter(function(item) { return item.status === "complete"; }).length;
  return {
    status: completeCount === checks.length ? "complete" : "needed",
    completeCount: completeCount,
    totalCount: checks.length,
    checks: checks,
    verifiedAt: snapshot.synced_at || null
  };
}
