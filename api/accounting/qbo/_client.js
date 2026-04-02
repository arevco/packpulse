import crypto from "crypto";

import { getSessionSecret } from "../../_session.js";
import { CACHE_SITE_ID, getSupabaseAdmin } from "../../ops/_common.js";
import { normalizeLookupKey, QBO_PROVIDER } from "./_persistence.js";

var QBO_SCOPE = "com.intuit.quickbooks.accounting";
var QBO_AUTH_URL = "https://appcenter.intuit.com/connect/oauth2";
var QBO_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
var QBO_STATE_TTL_MS = 10 * 60 * 1000;
var QBO_ACCESS_TOKEN_REFRESH_BUFFER_MS = 2 * 60 * 1000;
var QBO_QUERY_PAGE_SIZE = 500;

function sanitizeText(value, maxLen) {
  var text = String(value || "").trim();
  if (!text) return "";
  if (maxLen && text.length > maxLen) return text.slice(0, maxLen);
  return text;
}

function nowIso() {
  return new Date().toISOString();
}

function addSecondsToNow(seconds) {
  var amount = Math.max(0, Number(seconds || 0));
  if (!amount) return "";
  return new Date(Date.now() + amount * 1000).toISOString();
}

function toNonNegativeInt(value, fallback) {
  var amount = parseInt(value, 10);
  if (!Number.isFinite(amount) || amount < 0) return Math.max(0, Number(fallback || 0));
  return amount;
}

function encodeBase64Url(value) {
  return Buffer.from(String(value || ""), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function decodeBase64Url(value) {
  var text = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  while (text.length % 4) text += "=";
  return Buffer.from(text, "base64").toString("utf8");
}

function isMissingRelationError(error) {
  if (!error) return false;
  if (error.code === "42P01") return true;
  return /relation .* does not exist|could not find the table|schema cache/i.test(String(error.message || ""));
}

function chunkArray(values, size) {
  var list = Array.isArray(values) ? values : [];
  var chunkSize = Math.max(1, Number(size || 200));
  var out = [];
  for (var index = 0; index < list.length; index += chunkSize) {
    out.push(list.slice(index, index + chunkSize));
  }
  return out;
}

function pickFieldLoose(row, keys) {
  if (!row || typeof row !== "object") return "";
  var rowKeys = Object.keys(row);
  for (var i = 0; i < keys.length; i += 1) {
    var target = String(keys[i] || "").toLowerCase();
    for (var j = 0; j < rowKeys.length; j += 1) {
      var rowKey = rowKeys[j];
      if (String(rowKey || "").toLowerCase() === target) return row[rowKey];
    }
  }
  var wanted = {};
  keys.forEach(function(key) {
    wanted[normalizeLookupKey(key)] = true;
  });
  for (var x = 0; x < rowKeys.length; x += 1) {
    var looseKey = rowKeys[x];
    if (wanted[normalizeLookupKey(looseKey)]) return row[looseKey];
  }
  return "";
}

function coerceBoolean(value) {
  if (typeof value === "boolean") return value;
  var normalized = sanitizeText(value).toLowerCase();
  if (!normalized) return false;
  return normalized === "true" || normalized === "yes" || normalized === "y" || normalized === "1";
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function buildStateSignature(payload) {
  return crypto.createHmac("sha256", getSessionSecret()).update(payload).digest("hex");
}

function deriveEncryptionKey() {
  return crypto.createHash("sha256").update(getSessionSecret()).digest();
}

function encryptSecret(value) {
  var plainText = sanitizeText(value);
  if (!plainText) return "";
  var iv = crypto.randomBytes(12);
  var cipher = crypto.createCipheriv("aes-256-gcm", deriveEncryptionKey(), iv);
  var encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  var tag = cipher.getAuthTag();
  return [
    iv.toString("base64"),
    tag.toString("base64"),
    encrypted.toString("base64")
  ].join(".");
}

function decryptSecret(value) {
  var text = sanitizeText(value);
  if (!text) return "";
  var parts = text.split(".");
  if (parts.length !== 3) throw new Error("Malformed encrypted QuickBooks secret");
  var iv = Buffer.from(parts[0], "base64");
  var tag = Buffer.from(parts[1], "base64");
  var encrypted = Buffer.from(parts[2], "base64");
  var decipher = crypto.createDecipheriv("aes-256-gcm", deriveEncryptionKey(), iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted, undefined, "utf8") + decipher.final("utf8");
}

function buildCatalogSummaryFromConnection(row) {
  var summary = row && row.last_sync_summary && typeof row.last_sync_summary === "object" ? row.last_sync_summary : {};
  return {
    customerCatalogCount: toNonNegativeInt(summary.customerCatalogCount || 0, 0),
    itemCatalogCount: toNonNegativeInt(summary.itemCatalogCount || 0, 0),
    termCatalogCount: toNonNegativeInt(summary.termCatalogCount || 0, 0),
    customerMappingsCreated: toNonNegativeInt(summary.customerMappingsCreated || 0, 0),
    customerMappingsUpdated: toNonNegativeInt(summary.customerMappingsUpdated || 0, 0),
    customerMappingsUnresolved: toNonNegativeInt(summary.customerMappingsUnresolved || 0, 0),
    itemMappingsCreated: toNonNegativeInt(summary.itemMappingsCreated || 0, 0),
    itemMappingsUpdated: toNonNegativeInt(summary.itemMappingsUpdated || 0, 0),
    itemMappingsUnresolved: toNonNegativeInt(summary.itemMappingsUnresolved || 0, 0),
    termMappingsCreated: toNonNegativeInt(summary.termMappingsCreated || 0, 0),
    termMappingsUpdated: toNonNegativeInt(summary.termMappingsUpdated || 0, 0),
    termMappingsUnresolved: toNonNegativeInt(summary.termMappingsUnresolved || 0, 0),
    unresolvedCustomers: ensureArray(summary.unresolvedCustomers).slice(0, 8),
    unresolvedItems: ensureArray(summary.unresolvedItems).slice(0, 12),
    unresolvedTerms: ensureArray(summary.unresolvedTerms).slice(0, 4),
    preservedMappings: toNonNegativeInt(summary.preservedMappings || 0, 0)
  };
}

function getQuickBooksCredentials() {
  var clientId = sanitizeText(process.env.QBO_CLIENT_ID, 240);
  var clientSecret = sanitizeText(process.env.QBO_CLIENT_SECRET, 240);
  return {
    clientId: clientId,
    clientSecret: clientSecret,
    configured: !!(clientId && clientSecret)
  };
}

export function getQuickBooksEnvironment() {
  return sanitizeText(process.env.QBO_ENVIRONMENT, 32).toLowerCase() === "sandbox" ? "sandbox" : "production";
}

export function getQuickBooksApiBaseUrl(environment) {
  return String(environment || "").toLowerCase() === "sandbox"
    ? "https://sandbox-quickbooks.api.intuit.com"
    : "https://quickbooks.api.intuit.com";
}

export function sanitizeReturnToPath(value) {
  var path = sanitizeText(value, 1200);
  if (!path || path.indexOf("//") === 0) return "/?view=invoicing";
  if (path[0] !== "/") return "/?view=invoicing";
  return path;
}

export function resolveAppOrigin(req) {
  var forwardedProto = sanitizeText(req && req.headers && req.headers["x-forwarded-proto"], 20);
  var protocol = forwardedProto || "https";
  var host = sanitizeText(req && req.headers && (req.headers["x-forwarded-host"] || req.headers.host), 240);
  if (!host) throw new Error("Could not determine PackPulse host for QuickBooks redirect.");
  return protocol + "://" + host;
}

export function resolveQuickBooksRedirectUri(req) {
  var configured = sanitizeText(process.env.QBO_REDIRECT_URI, 500);
  if (configured) return configured;
  return resolveAppOrigin(req) + "/api/accounting/qbo/callback";
}

export function createQuickBooksOauthState(input) {
  var payload = JSON.stringify({
    email: sanitizeText(input && input.email, 240).toLowerCase(),
    returnTo: sanitizeReturnToPath(input && input.returnTo),
    createdAt: Date.now()
  });
  return encodeBase64Url(payload) + "." + buildStateSignature(payload);
}

export function parseQuickBooksOauthState(value) {
  var text = sanitizeText(value, 2000);
  if (!text || text.indexOf(".") === -1) return null;
  var parts = text.split(".");
  if (parts.length !== 2) return null;
  var payload = "";
  try {
    payload = decodeBase64Url(parts[0]);
  } catch (_error) {
    return null;
  }
  if (buildStateSignature(payload) !== parts[1]) return null;
  var parsed = null;
  try {
    parsed = JSON.parse(payload);
  } catch (_error2) {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  if (Math.abs(Date.now() - Number(parsed.createdAt || 0)) > QBO_STATE_TTL_MS) return null;
  return {
    email: sanitizeText(parsed.email, 240).toLowerCase(),
    returnTo: sanitizeReturnToPath(parsed.returnTo),
    createdAt: Number(parsed.createdAt || 0)
  };
}

export function buildQuickBooksAuthorizationUrl(req, options) {
  var credentials = getQuickBooksCredentials();
  if (!credentials.configured) throw new Error("Missing QBO_CLIENT_ID or QBO_CLIENT_SECRET");
  var redirectUri = resolveQuickBooksRedirectUri(req);
  var state = createQuickBooksOauthState({
    email: options && options.email,
    returnTo: options && options.returnTo
  });
  var url = new URL(QBO_AUTH_URL);
  url.searchParams.set("client_id", credentials.clientId);
  url.searchParams.set("scope", QBO_SCOPE);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  return url.toString();
}

async function exchangeTokenRequest(formData) {
  var credentials = getQuickBooksCredentials();
  if (!credentials.configured) throw new Error("Missing QBO_CLIENT_ID or QBO_CLIENT_SECRET");
  var authHeader = Buffer.from(credentials.clientId + ":" + credentials.clientSecret).toString("base64");
  var response = await fetch(QBO_TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: "Basic " + authHeader,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams(formData)
  });
  var body = {};
  try {
    body = await response.json();
  } catch (_error) {
    body = {};
  }
  if (!response.ok) {
    var errorText = sanitizeText(body.error_description || body.error || body.message, 300) || ("QuickBooks token exchange failed (" + response.status + ")");
    throw new Error(errorText);
  }
  return body;
}

export async function exchangeAuthorizationCodeForTokens(input) {
  return exchangeTokenRequest({
    grant_type: "authorization_code",
    code: sanitizeText(input && input.code, 400),
    redirect_uri: sanitizeText(input && input.redirectUri, 500)
  });
}

async function refreshAccessToken(refreshToken) {
  return exchangeTokenRequest({
    grant_type: "refresh_token",
    refresh_token: sanitizeText(refreshToken, 1200)
  });
}

function normalizeConnectionRow(row) {
  if (!row || typeof row !== "object") return null;
  return {
    id: row.id,
    siteId: sanitizeText(row.site_id, 120),
    provider: sanitizeText(row.provider, 40),
    status: sanitizeText(row.status, 40),
    environment: sanitizeText(row.environment, 20) || "production",
    realmId: sanitizeText(row.realm_id, 120),
    companyName: sanitizeText(row.company_name, 200),
    accessTokenCiphertext: sanitizeText(row.access_token_ciphertext, 6000),
    refreshTokenCiphertext: sanitizeText(row.refresh_token_ciphertext, 6000),
    accessTokenExpiresAt: sanitizeText(row.access_token_expires_at, 40),
    refreshTokenExpiresAt: sanitizeText(row.refresh_token_expires_at, 40),
    scopes: ensureArray(row.scopes),
    metadata: row.metadata && typeof row.metadata === "object" ? row.metadata : {},
    lastSyncedAt: sanitizeText(row.last_synced_at, 40),
    lastSyncStatus: sanitizeText(row.last_sync_status, 40),
    lastSyncSummary: row.last_sync_summary && typeof row.last_sync_summary === "object" ? row.last_sync_summary : {},
    createdBy: sanitizeText(row.created_by, 240),
    createdAt: sanitizeText(row.created_at, 40),
    updatedBy: sanitizeText(row.updated_by, 240),
    updatedAt: sanitizeText(row.updated_at, 40)
  };
}

async function loadConnectionRecord(supabase) {
  var result = await supabase
    .from("accounting_connections")
    .select("*")
    .eq("site_id", CACHE_SITE_ID)
    .eq("provider", QBO_PROVIDER)
    .maybeSingle();

  if (result.error) {
    if (isMissingRelationError(result.error)) {
      return {
        tableReady: false,
        warning: "Supabase table public.accounting_connections is missing. Run supabase-accounting-qbo-sync.sql to enable QuickBooks OAuth and catalog sync.",
        row: null
      };
    }
    throw result.error;
  }

  return {
    tableReady: true,
    warning: "",
    row: normalizeConnectionRow(result.data)
  };
}

async function updateConnectionRow(supabase, rowId, values) {
  var payload = Object.assign({}, values, { updated_at: nowIso() });
  var result = await supabase
    .from("accounting_connections")
    .update(payload)
    .eq("id", rowId)
    .select("*")
    .single();
  if (result.error) throw result.error;
  return normalizeConnectionRow(result.data);
}

export async function upsertQuickBooksConnection(input) {
  var supabase = input && input.supabase ? input.supabase : getSupabaseAdmin();
  var existing = await loadConnectionRecord(supabase);
  if (!existing.tableReady) throw new Error(existing.warning);

  var tokens = input && input.tokens && typeof input.tokens === "object" ? input.tokens : {};
  var metadata = input && input.metadata && typeof input.metadata === "object" ? input.metadata : {};
  var current = existing.row;
  var payload = {
    site_id: CACHE_SITE_ID,
    provider: QBO_PROVIDER,
    status: "connected",
    environment: sanitizeText(input && input.environment, 20) || getQuickBooksEnvironment(),
    realm_id: sanitizeText(input && input.realmId, 120),
    company_name: sanitizeText(input && input.companyName, 200),
    access_token_ciphertext: encryptSecret(tokens.access_token || ""),
    refresh_token_ciphertext: encryptSecret(tokens.refresh_token || ""),
    access_token_expires_at: addSecondsToNow(tokens.expires_in),
    refresh_token_expires_at: addSecondsToNow(tokens.x_refresh_token_expires_in),
    scopes: sanitizeText(tokens.scope, 500) ? sanitizeText(tokens.scope, 500).split(/\s+/).filter(Boolean) : (current && current.scopes ? current.scopes : []),
    metadata: Object.assign({}, current && current.metadata ? current.metadata : {}, metadata),
    created_by: current && current.createdBy ? current.createdBy : sanitizeText(input && input.userEmail, 240),
    updated_by: sanitizeText(input && input.userEmail, 240)
  };

  if (!payload.realm_id) throw new Error("Missing QuickBooks realm ID");
  if (!payload.access_token_ciphertext || !payload.refresh_token_ciphertext) throw new Error("Missing QuickBooks token payload");

  if (current && current.id) {
    return updateConnectionRow(supabase, current.id, payload);
  }

  payload.last_sync_status = "never_synced";
  payload.last_sync_summary = {};
  payload.created_at = nowIso();
  payload.updated_at = nowIso();

  var result = await supabase
    .from("accounting_connections")
    .insert(payload)
    .select("*")
    .single();
  if (result.error) throw result.error;
  return normalizeConnectionRow(result.data);
}

async function refreshConnectionIfNeeded(supabase, row, userEmail, forceRefresh) {
  var connection = normalizeConnectionRow(row);
  if (!connection) throw new Error("QuickBooks is not connected.");
  var expiresAt = connection.accessTokenExpiresAt ? new Date(connection.accessTokenExpiresAt).getTime() : 0;
  var needsRefresh = !!forceRefresh || !expiresAt || expiresAt <= (Date.now() + QBO_ACCESS_TOKEN_REFRESH_BUFFER_MS);
  if (!needsRefresh) {
    return Object.assign({}, connection, {
      accessToken: decryptSecret(connection.accessTokenCiphertext),
      refreshToken: decryptSecret(connection.refreshTokenCiphertext)
    });
  }

  var refreshToken = decryptSecret(connection.refreshTokenCiphertext);
  if (!refreshToken) throw new Error("QuickBooks refresh token is unavailable. Reconnect QuickBooks.");

  try {
    var refreshed = await refreshAccessToken(refreshToken);
    var updated = await updateConnectionRow(supabase, connection.id, {
      status: "connected",
      access_token_ciphertext: encryptSecret(refreshed.access_token || ""),
      refresh_token_ciphertext: encryptSecret(refreshed.refresh_token || refreshToken),
      access_token_expires_at: addSecondsToNow(refreshed.expires_in),
      refresh_token_expires_at: addSecondsToNow(refreshed.x_refresh_token_expires_in),
      scopes: sanitizeText(refreshed.scope, 500) ? sanitizeText(refreshed.scope, 500).split(/\s+/).filter(Boolean) : connection.scopes,
      updated_by: sanitizeText(userEmail, 240) || connection.updatedBy
    });
    return Object.assign({}, updated, {
      accessToken: sanitizeText(refreshed.access_token, 6000),
      refreshToken: sanitizeText(refreshed.refresh_token || refreshToken, 1200)
    });
  } catch (error) {
    await updateConnectionRow(supabase, connection.id, {
      status: "reauthorization_required",
      updated_by: sanitizeText(userEmail, 240) || connection.updatedBy
    });
    throw error;
  }
}

async function requestQuickBooksJson(context, method, path, searchParams, payload, allowRetry) {
  var url = new URL(getQuickBooksApiBaseUrl(context.environment) + path);
  var params = searchParams && typeof searchParams === "object" ? searchParams : {};
  Object.keys(params).forEach(function(key) {
    if (params[key] == null || params[key] === "") return;
    url.searchParams.set(key, String(params[key]));
  });
  var headers = {
    Accept: "application/json",
    Authorization: "Bearer " + context.accessToken
  };
  if (payload != null) headers["Content-Type"] = "application/json";
  var response = await fetch(url.toString(), {
    method: sanitizeText(method, 12).toUpperCase() || "GET",
    headers: headers,
    body: payload == null ? undefined : JSON.stringify(payload)
  });
  var body = {};
  try {
    body = await response.json();
  } catch (_error) {
    body = {};
  }
  var intuitTid = sanitizeText(
    (response.headers && typeof response.headers.get === "function" && (response.headers.get("intuit_tid") || response.headers.get("intuit-tid"))) || "",
    240
  );
  if (response.status === 401 && allowRetry !== false) {
    var refreshed = await refreshConnectionIfNeeded(context.supabase, context, context.userEmail, true);
    return requestQuickBooksJson(Object.assign({}, context, refreshed), method, path, searchParams, payload, false);
  }
  if (!response.ok) {
    var fault = body && body.Fault && Array.isArray(body.Fault.Error) && body.Fault.Error.length
      ? body.Fault.Error.map(function(entry) { return sanitizeText(entry && (entry.Detail || entry.Message), 180); }).filter(Boolean).join(" | ")
      : "";
    var error = new Error(fault || ("QuickBooks API request failed (" + response.status + ")"));
    error.status = response.status;
    error.intuitTid = intuitTid;
    error.responseBody = body;
    throw error;
  }
  return {
    body: body,
    status: response.status,
    intuitTid: intuitTid
  };
}

async function fetchQuickBooksJson(context, path, searchParams, allowRetry) {
  var result = await requestQuickBooksJson(context, "GET", path, searchParams, null, allowRetry);
  return result.body;
}

async function queryQuickBooksEntities(context, entityType) {
  var startPosition = 1;
  var out = [];
  while (true) {
    var query = "select * from " + entityType + " startposition " + startPosition + " maxresults " + QBO_QUERY_PAGE_SIZE;
    var body = await fetchQuickBooksJson(
      context,
      "/v3/company/" + encodeURIComponent(context.realmId) + "/query",
      { query: query }
    );
    var response = body && body.QueryResponse && typeof body.QueryResponse === "object" ? body.QueryResponse : {};
    var rows = ensureArray(response[entityType]);
    if (!rows.length) break;
    out = out.concat(rows);
    if (rows.length < QBO_QUERY_PAGE_SIZE) break;
    startPosition += QBO_QUERY_PAGE_SIZE;
  }
  return out;
}

async function fetchQuickBooksCompanyInfo(context) {
  try {
    var body = await fetchQuickBooksJson(
      context,
      "/v3/company/" + encodeURIComponent(context.realmId) + "/companyinfo/" + encodeURIComponent(context.realmId)
    );
    var company = body && body.CompanyInfo && typeof body.CompanyInfo === "object" ? body.CompanyInfo : {};
    return sanitizeText(company.CompanyName || company.LegalName || company.CompanyAddr && company.CompanyAddr.Line1, 200);
  } catch (_error) {
    return "";
  }
}

export async function getQuickBooksRequestContext(userEmail) {
  var supabase = getSupabaseAdmin();
  var record = await loadConnectionRecord(supabase);
  if (!record.tableReady) throw new Error(record.warning);
  if (!record.row) throw new Error("QuickBooks is not connected yet.");
  var connection = await refreshConnectionIfNeeded(supabase, record.row, userEmail);
  return Object.assign({}, connection, {
    supabase: supabase,
    userEmail: sanitizeText(userEmail, 240),
    environment: connection.environment || getQuickBooksEnvironment(),
    realmId: connection.realmId
  });
}

export async function createQuickBooksInvoice(input) {
  var payload = input && input.payload && typeof input.payload === "object" ? input.payload : {};
  var context = input && input.context ? input.context : await getQuickBooksRequestContext(input && input.userEmail);
  var result = await requestQuickBooksJson(
    context,
    "POST",
    "/v3/company/" + encodeURIComponent(context.realmId) + "/invoice",
    null,
    payload
  );
  var invoice = result.body && result.body.Invoice && typeof result.body.Invoice === "object" ? result.body.Invoice : {};
  return {
    invoice: invoice,
    body: result.body,
    intuitTid: result.intuitTid,
    context: context
  };
}

function normalizeCatalogEntity(entityType, raw, realmId, syncedAt) {
  var entity = raw && typeof raw === "object" ? raw : {};
  var name = "";
  var code = "";
  var fullyQualifiedName = sanitizeText(entity.FullyQualifiedName, 240);
  if (entityType === "customer") {
    name = sanitizeText(entity.DisplayName || entity.CompanyName || entity.FullyQualifiedName || entity.GivenName || entity.Id, 240);
    code = sanitizeText(entity.DisplayName || entity.CompanyName || entity.Id, 240);
  } else if (entityType === "item") {
    name = sanitizeText(entity.Name || entity.FullyQualifiedName || entity.Sku || entity.Id, 240);
    code = sanitizeText(entity.Sku || entity.Name || entity.Id, 240);
  } else {
    name = sanitizeText(entity.Name || entity.FullyQualifiedName || entity.Id, 240);
    code = sanitizeText(entity.Name || entity.Id, 240);
  }

  return {
    site_id: CACHE_SITE_ID,
    provider: QBO_PROVIDER,
    realm_id: sanitizeText(realmId, 120),
    entity_type: entityType,
    external_id: sanitizeText(entity.Id, 120),
    external_name: name,
    external_code: code,
    fully_qualified_name: fullyQualifiedName,
    normalized_name: normalizeLookupKey(name),
    normalized_code: normalizeLookupKey(code),
    active: entity.Active !== false,
    sync_token: sanitizeText(entity.SyncToken, 80),
    metadata: {
      subtype: sanitizeText(entity.SubType || entity.Type, 120),
      display_name: sanitizeText(entity.DisplayName, 240),
      company_name: sanitizeText(entity.CompanyName, 240),
      sku: sanitizeText(entity.Sku, 240)
    },
    raw_payload: entity,
    last_synced_at: syncedAt,
    updated_at: syncedAt
  };
}

async function upsertCatalogEntities(supabase, rows) {
  var chunks = chunkArray(rows, 250);
  for (var index = 0; index < chunks.length; index += 1) {
    var chunk = chunks[index];
    if (!chunk.length) continue;
    var result = await supabase
      .from("accounting_catalog_entities")
      .upsert(chunk, { onConflict: "site_id,provider,realm_id,entity_type,external_id" });
    if (result.error) {
      if (isMissingRelationError(result.error)) {
        throw new Error("Supabase table public.accounting_catalog_entities is missing. Run supabase-accounting-qbo-sync.sql to enable QuickBooks catalog sync.");
      }
      throw result.error;
    }
  }
}

async function loadActiveMappingsByType(supabase, entityType, packpulseKeys) {
  var keys = Array.from(new Set((Array.isArray(packpulseKeys) ? packpulseKeys : []).map(function(key) {
    return sanitizeText(key, 200);
  }).filter(Boolean)));
  var rows = [];
  var chunks = chunkArray(keys, 250);
  for (var index = 0; index < chunks.length; index += 1) {
    var chunk = chunks[index];
    if (!chunk.length) continue;
    var result = await supabase
      .from("accounting_entity_mappings")
      .select("id, packpulse_key, packpulse_value, external_id, external_name, metadata")
      .eq("site_id", CACHE_SITE_ID)
      .eq("provider", QBO_PROVIDER)
      .eq("entity_type", entityType)
      .eq("is_active", true)
      .in("packpulse_key", chunk);
    if (result.error) {
      if (isMissingRelationError(result.error)) {
        throw new Error("Supabase table public.accounting_entity_mappings is missing. Run supabase-accounting-qbo.sql before QuickBooks sync.");
      }
      throw result.error;
    }
    rows = rows.concat(ensureArray(result.data));
  }
  var byKey = {};
  rows.forEach(function(row) {
    var key = sanitizeText(row && row.packpulse_key, 200);
    if (!key || byKey[key]) return;
    byKey[key] = row;
  });
  return byKey;
}

async function insertMappings(supabase, rows) {
  var chunks = chunkArray(rows, 200);
  for (var index = 0; index < chunks.length; index += 1) {
    var chunk = chunks[index];
    if (!chunk.length) continue;
    var result = await supabase.from("accounting_entity_mappings").insert(chunk);
    if (result.error) {
      if (isMissingRelationError(result.error)) {
        throw new Error("Supabase table public.accounting_entity_mappings is missing. Run supabase-accounting-qbo.sql before QuickBooks sync.");
      }
      throw result.error;
    }
  }
}

async function updateMappings(supabase, rows) {
  for (var index = 0; index < rows.length; index += 1) {
    var row = rows[index];
    if (!row || !row.id) continue;
    var result = await supabase
      .from("accounting_entity_mappings")
      .update({
        packpulse_value: row.packpulse_value,
        external_id: row.external_id,
        external_name: row.external_name,
        metadata: row.metadata,
        updated_by: row.updated_by,
        updated_at: nowIso()
      })
      .eq("id", row.id);
    if (result.error) {
      if (isMissingRelationError(result.error)) {
        throw new Error("Supabase table public.accounting_entity_mappings is missing. Run supabase-accounting-qbo.sql before QuickBooks sync.");
      }
      throw result.error;
    }
  }
}

function addCandidateIndex(index, key, candidate) {
  var normalized = normalizeLookupKey(key);
  if (!normalized) return;
  if (!index[normalized]) index[normalized] = [];
  index[normalized].push(candidate);
}

function dedupeCandidates(candidates) {
  var out = [];
  var seen = {};
  ensureArray(candidates).forEach(function(candidate) {
    var key = sanitizeText(candidate && candidate.externalId, 120);
    if (!key || seen[key]) return;
    seen[key] = true;
    out.push(candidate);
  });
  return out;
}

function buildCustomerCatalogCandidates(rows) {
  var index = {};
  ensureArray(rows).forEach(function(row) {
    var candidate = {
      externalId: sanitizeText(row.external_id, 120),
      externalName: sanitizeText(row.external_name, 240),
      matchType: "customer_name"
    };
    addCandidateIndex(index, row.external_name, candidate);
    addCandidateIndex(index, row.fully_qualified_name, candidate);
    addCandidateIndex(index, row.metadata && row.metadata.company_name, candidate);
    addCandidateIndex(index, row.metadata && row.metadata.display_name, candidate);
  });
  Object.keys(index).forEach(function(key) {
    index[key] = dedupeCandidates(index[key]);
  });
  return index;
}

function buildItemCatalogCandidates(rows) {
  var codeIndex = {};
  var nameIndex = {};
  ensureArray(rows).forEach(function(row) {
    var candidate = {
      externalId: sanitizeText(row.external_id, 120),
      externalName: sanitizeText(row.external_name, 240),
      externalCode: sanitizeText(row.external_code, 240)
    };
    addCandidateIndex(codeIndex, row.external_code, Object.assign({ matchType: "item_code" }, candidate));
    addCandidateIndex(nameIndex, row.external_name, Object.assign({ matchType: "item_name" }, candidate));
    addCandidateIndex(nameIndex, row.fully_qualified_name, Object.assign({ matchType: "item_name" }, candidate));
  });
  Object.keys(codeIndex).forEach(function(key) {
    codeIndex[key] = dedupeCandidates(codeIndex[key]);
  });
  Object.keys(nameIndex).forEach(function(key) {
    nameIndex[key] = dedupeCandidates(nameIndex[key]);
  });
  return { codeIndex: codeIndex, nameIndex: nameIndex };
}

function buildTermCatalogCandidates(rows) {
  var index = {};
  ensureArray(rows).forEach(function(row) {
    var candidate = {
      externalId: sanitizeText(row.external_id, 120),
      externalName: sanitizeText(row.external_name, 240),
      matchType: "term_name"
    };
    addCandidateIndex(index, row.external_name, candidate);
    addCandidateIndex(index, row.external_code, candidate);
  });
  Object.keys(index).forEach(function(key) {
    index[key] = dedupeCandidates(index[key]);
  });
  return index;
}

function normalizePackPulseCustomerReferences(snapshotPayload) {
  var refs = {};
  var pushValue = function(value, source) {
    var label = sanitizeText(value, 200);
    var key = normalizeLookupKey(label);
    if (!key) return;
    if (!refs[key]) refs[key] = { packpulseKey: key, packpulseValue: label, sources: {} };
    refs[key].sources[source] = true;
  };

  ensureArray(snapshotPayload && snapshotPayload.itemMaster).forEach(function(row) {
    pushValue(pickFieldLoose(row, [
      "Customer Name", "customer_name",
      "Customer", "customer"
    ]), "item_master");
  });

  ensureArray(snapshotPayload && snapshotPayload.productionData).forEach(function(row) {
    pushValue(pickFieldLoose(row, [
      "Customer Name", "customer_name",
      "Customer", "customer",
      "item_customer_name", "item_customer"
    ]), "production");
  });

  return Object.values(refs).sort(function(left, right) {
    return left.packpulseValue.localeCompare(right.packpulseValue);
  });
}

function normalizePackPulseItemReferences(snapshotPayload) {
  var rows = ensureArray(snapshotPayload && snapshotPayload.itemMaster);
  var hasFinishedGoodFlag = rows.some(function(row) {
    return pickFieldLoose(row, ["Is Finished Good", "is_finished_good", "Finished Good", "finished_good"]) !== "";
  });
  var refs = {};

  rows.forEach(function(row) {
    var rawCode = sanitizeText(pickFieldLoose(row, ["Code", "code", "Item Code", "item_code"]), 120);
    if (!rawCode) return;
    var key = normalizeLookupKey(rawCode);
    if (!key) return;
    var inactive = coerceBoolean(pickFieldLoose(row, ["Inactive", "inactive", "Is Inactive", "is_inactive"]));
    if (inactive) return;
    if (hasFinishedGoodFlag && !coerceBoolean(pickFieldLoose(row, ["Is Finished Good", "is_finished_good", "Finished Good", "finished_good"]))) return;
    if (!refs[key]) {
      refs[key] = {
        packpulseKey: key,
        packpulseValue: rawCode,
        description: sanitizeText(pickFieldLoose(row, ["Description", "description", "Item Description", "item_description"]), 240),
        customer: sanitizeText(pickFieldLoose(row, ["Customer Name", "customer_name", "Customer", "customer"]), 200)
      };
    }
  });

  return Object.values(refs).sort(function(left, right) {
    return left.packpulseValue.localeCompare(right.packpulseValue, undefined, { numeric: true, sensitivity: "base" });
  });
}

function normalizePackPulseTermReferences() {
  return [{
    packpulseKey: "net30",
    packpulseValue: "Net 30"
  }];
}

function selectMatchForReference(entityType, reference, indexes) {
  var key = sanitizeText(reference && reference.packpulseKey, 200);
  if (!key) return { candidates: [], matched: null };
  if (entityType === "customer") {
    var customerCandidates = dedupeCandidates(indexes[key]);
    return {
      candidates: customerCandidates,
      matched: customerCandidates.length === 1 ? customerCandidates[0] : null
    };
  }
  if (entityType === "item") {
    var codeCandidates = dedupeCandidates(indexes.codeIndex[key]);
    if (codeCandidates.length) {
      return {
        candidates: codeCandidates,
        matched: codeCandidates.length === 1 ? codeCandidates[0] : null
      };
    }
    var nameCandidates = dedupeCandidates(indexes.nameIndex[key]);
    return {
      candidates: nameCandidates,
      matched: nameCandidates.length === 1 ? nameCandidates[0] : null
    };
  }
  var termCandidates = dedupeCandidates(indexes[key]);
  return {
    candidates: termCandidates,
    matched: termCandidates.length === 1 ? termCandidates[0] : null
  };
}

async function syncMappingRows(supabase, entityType, references, indexes, userEmail) {
  var existingByKey = await loadActiveMappingsByType(supabase, entityType, references.map(function(reference) {
    return reference.packpulseKey;
  }));
  var inserts = [];
  var updates = [];
  var unresolved = [];
  var preservedMappings = 0;

  references.forEach(function(reference) {
    var selection = selectMatchForReference(entityType, reference, indexes);
    if (!selection.matched) {
      unresolved.push({
        packpulseKey: reference.packpulseKey,
        packpulseValue: reference.packpulseValue,
        candidateCount: selection.candidates.length
      });
      return;
    }

    var existing = existingByKey[reference.packpulseKey] || null;
    var metadata = Object.assign({}, existing && existing.metadata && typeof existing.metadata === "object" ? existing.metadata : {}, {
      source: "qbo_sync",
      auto_managed: true,
      matched_on: selection.matched.matchType,
      synced_at: nowIso()
    });

    if (existing && sanitizeText(existing.external_id, 120) && sanitizeText(existing.external_id, 120) !== selection.matched.externalId) {
      if (!(existing.metadata && existing.metadata.auto_managed === true)) {
        preservedMappings += 1;
        return;
      }
    }

    var nextRow = {
      packpulse_value: sanitizeText(reference.packpulseValue, 240),
      external_id: selection.matched.externalId,
      external_name: selection.matched.externalName,
      metadata: metadata,
      updated_by: sanitizeText(userEmail, 240)
    };

    if (existing && existing.id) {
      updates.push(Object.assign({ id: existing.id }, nextRow));
      return;
    }

    inserts.push({
      site_id: CACHE_SITE_ID,
      provider: QBO_PROVIDER,
      entity_type: entityType,
      packpulse_key: sanitizeText(reference.packpulseKey, 200),
      packpulse_value: sanitizeText(reference.packpulseValue, 240),
      external_id: selection.matched.externalId,
      external_name: selection.matched.externalName,
      metadata: metadata,
      is_active: true,
      created_by: sanitizeText(userEmail, 240),
      updated_by: sanitizeText(userEmail, 240)
    });
  });

  if (inserts.length) await insertMappings(supabase, inserts);
  if (updates.length) await updateMappings(supabase, updates);

  return {
    created: inserts.length,
    updated: updates.length,
    unresolved: unresolved,
    preservedMappings: preservedMappings
  };
}

function summarizeUnresolved(items, maxCount) {
  return ensureArray(items).slice(0, Math.max(1, Number(maxCount || 5))).map(function(item) {
    var label = sanitizeText(item.packpulseValue || item.packpulseKey, 240);
    var count = Number(item.candidateCount || 0);
    if (count > 1) return label + " (" + count + " QBO matches)";
    return label;
  });
}

export async function getQuickBooksConnectionStatus() {
  var warnings = [];
  var credentials = getQuickBooksCredentials();
  if (!credentials.configured) warnings.push("Missing QBO_CLIENT_ID or QBO_CLIENT_SECRET. Add QuickBooks app credentials before connecting.");

  var supabase = getSupabaseAdmin();
  var record = await loadConnectionRecord(supabase);
  if (record.warning) warnings.push(record.warning);

  var connection = record.row;
  var summary = buildCatalogSummaryFromConnection(connection);

  return {
    ok: true,
    configured: credentials.configured,
    warnings: warnings,
    connected: !!connection,
    connection: connection ? {
      status: connection.status || "connected",
      environment: connection.environment || "production",
      realmId: connection.realmId || "",
      companyName: connection.companyName || "",
      lastSyncedAt: connection.lastSyncedAt || "",
      lastSyncStatus: connection.lastSyncStatus || "",
      accessTokenExpiresAt: connection.accessTokenExpiresAt || "",
      refreshTokenExpiresAt: connection.refreshTokenExpiresAt || "",
      scopes: connection.scopes || [],
      summary: summary
    } : {
      status: "disconnected",
      environment: getQuickBooksEnvironment(),
      realmId: "",
      companyName: "",
      lastSyncedAt: "",
      lastSyncStatus: "",
      accessTokenExpiresAt: "",
      refreshTokenExpiresAt: "",
      scopes: [],
      summary: summary
    }
  };
}

async function loadSnapshotPayload(supabase) {
  var result = await supabase
    .from("cache_snapshots")
    .select("payload, synced_at")
    .eq("site_id", CACHE_SITE_ID)
    .maybeSingle();
  if (result.error) {
    if (isMissingRelationError(result.error)) {
      return {
        warning: "Supabase table public.cache_snapshots is missing, so PackPulse customer and item references could not be auto-matched.",
        payload: {},
        syncedAt: ""
      };
    }
    throw result.error;
  }
  var row = result.data && typeof result.data === "object" ? result.data : {};
  return {
    warning: "",
    payload: row.payload && typeof row.payload === "object" ? row.payload : {},
    syncedAt: sanitizeText(row.synced_at, 40)
  };
}

export async function syncQuickBooksMasterData(userEmail) {
  var supabase = getSupabaseAdmin();
  var record = await loadConnectionRecord(supabase);
  if (!record.tableReady) throw new Error(record.warning);
  if (!record.row) throw new Error("QuickBooks is not connected yet.");

  var connection = await refreshConnectionIfNeeded(supabase, record.row, userEmail);
  var context = Object.assign({}, connection, {
    supabase: supabase,
    userEmail: sanitizeText(userEmail, 240),
    environment: connection.environment || getQuickBooksEnvironment(),
    realmId: connection.realmId
  });

  var syncedAt = nowIso();
  var snapshot = await loadSnapshotPayload(supabase);
  var warnings = [];
  if (snapshot.warning) warnings.push(snapshot.warning);

  var customers = await queryQuickBooksEntities(context, "Customer");
  var items = await queryQuickBooksEntities(context, "Item");
  var terms = await queryQuickBooksEntities(context, "Term");
  var companyName = await fetchQuickBooksCompanyInfo(context);

  var catalogRows = []
    .concat(customers.map(function(entity) { return normalizeCatalogEntity("customer", entity, connection.realmId, syncedAt); }))
    .concat(items.map(function(entity) { return normalizeCatalogEntity("item", entity, connection.realmId, syncedAt); }))
    .concat(terms.map(function(entity) { return normalizeCatalogEntity("term", entity, connection.realmId, syncedAt); }));

  await upsertCatalogEntities(supabase, catalogRows);

  var customerMapping = await syncMappingRows(
    supabase,
    "customer",
    normalizePackPulseCustomerReferences(snapshot.payload),
    buildCustomerCatalogCandidates(catalogRows.filter(function(row) { return row.entity_type === "customer" && row.active !== false; })),
    userEmail
  );
  var itemMapping = await syncMappingRows(
    supabase,
    "item",
    normalizePackPulseItemReferences(snapshot.payload),
    buildItemCatalogCandidates(catalogRows.filter(function(row) { return row.entity_type === "item" && row.active !== false; })),
    userEmail
  );
  var termMapping = await syncMappingRows(
    supabase,
    "term",
    normalizePackPulseTermReferences(),
    buildTermCatalogCandidates(catalogRows.filter(function(row) { return row.entity_type === "term" && row.active !== false; })),
    userEmail
  );

  var summary = {
    syncedAt: syncedAt,
    customerCatalogCount: customers.length,
    itemCatalogCount: items.length,
    termCatalogCount: terms.length,
    customerMappingsCreated: customerMapping.created,
    customerMappingsUpdated: customerMapping.updated,
    customerMappingsUnresolved: customerMapping.unresolved.length,
    itemMappingsCreated: itemMapping.created,
    itemMappingsUpdated: itemMapping.updated,
    itemMappingsUnresolved: itemMapping.unresolved.length,
    termMappingsCreated: termMapping.created,
    termMappingsUpdated: termMapping.updated,
    termMappingsUnresolved: termMapping.unresolved.length,
    unresolvedCustomers: summarizeUnresolved(customerMapping.unresolved, 8),
    unresolvedItems: summarizeUnresolved(itemMapping.unresolved, 12),
    unresolvedTerms: summarizeUnresolved(termMapping.unresolved, 4),
    preservedMappings: customerMapping.preservedMappings + itemMapping.preservedMappings + termMapping.preservedMappings,
    snapshotSyncedAt: snapshot.syncedAt || ""
  };

  var updated = await updateConnectionRow(supabase, connection.id, {
    status: "connected",
    company_name: companyName || connection.companyName || "",
    last_synced_at: syncedAt,
    last_sync_status: "ok",
    last_sync_summary: summary,
    updated_by: sanitizeText(userEmail, 240)
  });

  return {
    ok: true,
    warnings: warnings,
    connected: true,
    connection: {
      status: updated.status,
      environment: updated.environment,
      realmId: updated.realmId,
      companyName: updated.companyName,
      lastSyncedAt: updated.lastSyncedAt,
      lastSyncStatus: updated.lastSyncStatus
    },
    summary: summary
  };
}
