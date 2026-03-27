function parseDomainList(rawValue) {
  return String(rawValue || "")
    .split(",")
    .map(function(part) { return String(part || "").trim().toLowerCase(); })
    .filter(Boolean);
}

function parsePortalDomainMap(rawValue) {
  var raw = String(rawValue || "").trim();
  if (!raw) return {};
  try {
    var parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    var normalized = {};
    Object.keys(parsed).forEach(function(key) {
      var normalizedKey = normalizeDomain(key);
      var customerName = String(parsed[key] || "").trim();
      if (normalizedKey && customerName) normalized[normalizedKey] = customerName;
    });
    return normalized;
  } catch (_) {
    return {};
  }
}

export function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export function normalizeDomain(domain) {
  return String(domain || "")
    .trim()
    .toLowerCase()
    .replace(/^\.+/, "")
    .replace(/\.+$/, "");
}

export function getEmailDomain(email) {
  var normalized = normalizeEmail(email);
  if (!normalized || !normalized.includes("@")) return "";
  return normalizeDomain(normalized.split("@").slice(1).join("@"));
}

export function getRootDomain(domain) {
  var normalized = normalizeDomain(domain);
  if (!normalized) return "";
  var parts = normalized.split(".").filter(Boolean);
  if (parts.length <= 2) return normalized;
  return parts.slice(-2).join(".");
}

export function resolveEmailAccess(email) {
  var normalizedEmail = normalizeEmail(email);
  var domain = getEmailDomain(normalizedEmail);
  var rootDomain = getRootDomain(domain);
  var portalMap = parsePortalDomainMap(process.env.PORTAL_DOMAIN_CUSTOMERS || process.env.CLIENT_PORTAL_DOMAIN_MAP || "");
  var internalDomains = new Set(
    parseDomainList(process.env.ALLOWED_EMAIL_DOMAINS || "").concat([
      normalizeDomain(process.env.ALLOWED_DOMAIN || "revcopack.com"),
    ]).filter(Boolean)
  );

  if (!normalizedEmail || !domain) {
    return { ok: false, error: "Missing email address" };
  }

  if (internalDomains.has(domain) || internalDomains.has(rootDomain)) {
    return {
      ok: true,
      access: {
        kind: "internal",
        domain: domain,
        root_domain: rootDomain,
      },
    };
  }

  var customerName = portalMap[domain] || portalMap[rootDomain] || "";
  if (customerName) {
    return {
      ok: true,
      access: {
        kind: "customer",
        domain: domain,
        root_domain: rootDomain,
        customer_name: customerName,
      },
    };
  }

  return {
    ok: false,
    error: "Access restricted to approved email domains",
    access: {
      kind: "denied",
      domain: domain,
      root_domain: rootDomain,
    },
  };
}
