function compactText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeCustomerLookup(value) {
  return compactText(value).replace(/[^a-z0-9]/gi, "").toLowerCase();
}

const LEGAL_SUFFIX_PATTERN = /\b(?:incorporated|inc|llc|ltd|limited|corp|corporation|company|co|pllc|lp|llp)\b/gi;
const DBA_PATTERN = /\b(?:d\s*\/?\s*b\s*\/?\s*a|doing\s+business\s+as|trade\s+name)\b/i;

const CUSTOMER_CANONICAL_BY_ALIAS = {
  mpl: "Kirkland",
  mplbrands: "Kirkland",
};

const CUSTOMER_PREFERRED_NULOGY_FILTER_BY_CANONICAL = {
  kirkland: "MPL",
};

export function canonicalizeCustomerName(value, fallback) {
  const text = compactText(value);
  if (!text) return fallback || "";
  return CUSTOMER_CANONICAL_BY_ALIAS[normalizeCustomerLookup(text)] || text;
}

export function customerNamesMatch(left, right) {
  return normalizeCustomerLookup(canonicalizeCustomerName(left)) === normalizeCustomerLookup(canonicalizeCustomerName(right));
}

function normalizedLegalName(value) {
  return normalizeCustomerLookup(compactText(value).replace(LEGAL_SUFFIX_PATTERN, " "));
}

function customerNameParts(value) {
  var canonical = canonicalizeCustomerName(value);
  var split = canonical.split(DBA_PATTERN);
  return {
    original: compactText(value),
    canonical: canonical,
    fullKey: normalizeCustomerLookup(canonical),
    legalKey: normalizedLegalName(split[0] || canonical),
    dbaKey: split.length > 1 ? normalizedLegalName(split.slice(1).join(" ")) : ""
  };
}

export function matchCustomerName(input, candidates) {
  var source = customerNameParts(input);
  var unique = {};
  (Array.isArray(candidates) ? candidates : []).forEach(function(candidate) {
    var name = compactText(candidate);
    if (name && !unique[normalizeCustomerLookup(name)]) unique[normalizeCustomerLookup(name)] = name;
  });
  var scored = Object.keys(unique).map(function(candidateKey) {
    var name = unique[candidateKey];
    var target = customerNameParts(name);
    var score = 0;
    var reason = "";
    if (source.fullKey && source.fullKey === target.fullKey) { score = 100; reason = "Exact customer name"; }
    else if (source.dbaKey && (source.dbaKey === target.fullKey || source.dbaKey === target.legalKey)) { score = 95; reason = "DBA matches Nulogy customer"; }
    else if (source.legalKey && (source.legalKey === target.fullKey || source.legalKey === target.legalKey)) { score = 90; reason = "Legal suffixes ignored"; }
    return { name: name, score: score, reason: reason };
  }).filter(function(match) { return match.score > 0; }).sort(function(left, right) { return right.score - left.score || left.name.localeCompare(right.name); });
  if (!scored.length) return { matched: false, ambiguous: false, input: source.original, matchedName: "", reason: "", candidates: [] };
  var best = scored[0];
  var tied = scored.filter(function(match) { return match.score === best.score; });
  if (tied.length > 1) return { matched: false, ambiguous: true, input: source.original, matchedName: "", reason: "Multiple Nulogy customers matched", candidates: tied.map(function(match) { return match.name; }) };
  return { matched: true, ambiguous: false, input: source.original, matchedName: best.name, reason: best.reason, candidates: [best.name] };
}

export function preferredNulogyCustomerFilterValue(value) {
  const canonical = canonicalizeCustomerName(value);
  const key = normalizeCustomerLookup(canonical);
  return CUSTOMER_PREFERRED_NULOGY_FILTER_BY_CANONICAL[key] || canonical;
}
