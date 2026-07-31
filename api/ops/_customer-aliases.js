function compactText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeCustomerLookup(value) {
  return compactText(value).replace(/[^a-z0-9]/gi, "").toLowerCase();
}

const CUSTOMER_CANONICAL_BY_ALIAS = {
  mpl: "Kirkland",
  mplbrands: "Kirkland",
};

export function canonicalizeCustomerName(value, fallback) {
  const text = compactText(value);
  if (!text) return fallback || "";
  return CUSTOMER_CANONICAL_BY_ALIAS[normalizeCustomerLookup(text)] || text;
}

export function customerNamesMatch(left, right) {
  return normalizeCustomerLookup(canonicalizeCustomerName(left)) === normalizeCustomerLookup(canonicalizeCustomerName(right));
}
