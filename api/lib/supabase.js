import { createClient } from "@supabase/supabase-js";

export const SUPABASE_MISSING_ERROR = "Missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY";

function getSupabaseUrl() {
  return String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim();
}

function getSupabaseServiceRoleKey() {
  return String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
}

export function getSupabaseClientConfig() {
  const url = getSupabaseUrl();
  const serviceRoleKey = getSupabaseServiceRoleKey();
  return {
    url,
    serviceRoleKey,
    urlSource: process.env.SUPABASE_URL ? "SUPABASE_URL" : process.env.VITE_SUPABASE_URL ? "VITE_SUPABASE_URL" : "missing",
    cacheSiteId: process.env.CACHE_SITE_ID || "default"
  };
}

export function getSupabaseAdminClient({ required = true } = {}) {
  const config = getSupabaseClientConfig();
  if (!config.url || !config.serviceRoleKey) {
    if (required) throw new Error(SUPABASE_MISSING_ERROR);
    return null;
  }
  return createClient(config.url, config.serviceRoleKey, {
    auth: { persistSession: false }
  });
}

export function getSupabaseHealthSummary() {
  const config = getSupabaseClientConfig();
  return {
    hasSupabaseUrl: Boolean(config.url),
    hasSupabaseServiceRoleKey: Boolean(config.serviceRoleKey),
    hasSessionSecret: Boolean(String(process.env.SESSION_SECRET || "").trim()),
    cacheSiteId: config.cacheSiteId,
    urlSource: config.urlSource
  };
}
