export function cleanText(value, maxLength) {
  var text = String(value == null ? "" : value).trim();
  return maxLength && text.length > maxLength ? text.slice(0, maxLength) : text;
}

export function cleanDate(value) {
  var text = cleanText(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

export function roundMoney(value) {
  var number = Number(value);
  if (!Number.isFinite(number)) number = 0;
  return Math.round((number + Number.EPSILON) * 100) / 100;
}

export function calculateChargeAmount(charge) {
  var lineType = cleanText(charge && charge.type, 20).toLowerCase();
  var quantity = Number(charge && charge.quantity);
  var unitCost = Number(charge && charge.unitCost);
  var billableRate = Number(charge && charge.billableRate);
  var markupPct = Number(charge && charge.markupPct);
  if (!Number.isFinite(quantity)) quantity = 0;
  if (!Number.isFinite(unitCost)) unitCost = 0;
  if (!Number.isFinite(billableRate)) billableRate = 0;
  if (!Number.isFinite(markupPct)) markupPct = 0;
  if (lineType === "expense") return roundMoney(quantity * unitCost * (1 + markupPct / 100));
  return roundMoney(quantity * billableRate);
}

export function normalizeProjectInput(input) {
  var raw = input && typeof input === "object" ? input : {};
  var charges = (Array.isArray(raw.charges) ? raw.charges : []).map(function(charge, index) {
    var type = cleanText(charge && charge.type, 20).toLowerCase();
    if (["labor", "expense", "fixed"].indexOf(type) === -1) type = "fixed";
    var quantity = Number(charge && charge.quantity);
    var unitCost = Number(charge && charge.unitCost);
    var billableRate = Number(charge && charge.billableRate);
    var markupPct = Number(charge && charge.markupPct);
    var normalized = {
      lineNumber: index + 1,
      type: type,
      description: cleanText(charge && charge.description, 500),
      quantity: Number.isFinite(quantity) ? quantity : 0,
      unit: cleanText(charge && charge.unit, 40) || (type === "labor" ? "hours" : type === "expense" ? "each" : "job"),
      unitCost: type === "expense" && Number.isFinite(unitCost) ? unitCost : 0,
      billableRate: type !== "expense" && Number.isFinite(billableRate) ? billableRate : 0,
      markupPct: type === "expense" && Number.isFinite(markupPct) ? markupPct : 0,
      reference: cleanText(charge && charge.reference, 240)
    };
    normalized.amount = calculateChargeAmount(normalized);
    return normalized;
  });
  var errors = [];
  if (!cleanText(raw.customer, 200)) errors.push("Customer is required.");
  if (!cleanText(raw.title, 240)) errors.push("Project title is required.");
  if (!cleanDate(raw.occurredOn)) errors.push("A valid project date is required.");
  if (!charges.length) errors.push("At least one charge is required.");
  charges.forEach(function(charge, index) {
    if (!charge.description) errors.push("Charge " + (index + 1) + " needs a description.");
    if (!(charge.quantity > 0)) errors.push("Charge " + (index + 1) + " needs a positive quantity.");
    if (charge.type === "expense" && !(charge.unitCost > 0)) errors.push("Charge " + (index + 1) + " needs a positive unit cost.");
    if (charge.type !== "expense" && !(charge.billableRate > 0)) errors.push("Charge " + (index + 1) + " needs a positive billable rate.");
    if (charge.markupPct < 0) errors.push("Charge " + (index + 1) + " cannot have negative markup.");
  });
  return {
    customer: cleanText(raw.customer, 200),
    title: cleanText(raw.title, 240),
    occurredOn: cleanDate(raw.occurredOn),
    purchaseOrder: cleanText(raw.purchaseOrder, 120),
    notes: cleanText(raw.notes, 2000),
    charges: charges,
    total: roundMoney(charges.reduce(function(sum, charge) { return sum + charge.amount; }, 0)),
    errors: errors
  };
}
