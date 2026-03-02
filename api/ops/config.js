import Sentry from "../_sentry.js";
import { CACHE_SITE_ID, getAuthenticatedUser, getSupabaseAdmin, toNum, withCors } from "./_common.js";

const DEFAULT_RATES = [
  { role: "labor", hourly_rate: 20.1, markup_pct: 0.2 },
  { role: "fork", hourly_rate: 20.1, markup_pct: 0.2 },
  { role: "qa", hourly_rate: 20.1, markup_pct: 0.2 },
  { role: "maint", hourly_rate: 20.1, markup_pct: 0.2 },
  { role: "recycling", hourly_rate: 20.1, markup_pct: 0.2 }
];

export default async function handler(req, res) {
  withCors(req, res, ["GET", "POST", "OPTIONS"]);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET" && req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const user = getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    const supabase = getSupabaseAdmin();

    if (req.method === "GET") {
      const ratesQ = await supabase
        .from("ops_rates")
        .select("role,hourly_rate,markup_pct,effective_from,effective_to,updated_at")
        .eq("site_id", CACHE_SITE_ID)
        .order("effective_from", { ascending: false });
      if (ratesQ.error) throw ratesQ.error;

      const targetsQ = await supabase
        .from("ops_sku_targets")
        .select("item_code,customer,revenue_per_case,target_cases_per_hour,active_from,active_to,updated_at")
        .eq("site_id", CACHE_SITE_ID)
        .order("updated_at", { ascending: false })
        .limit(5000);
      if (targetsQ.error) throw targetsQ.error;

      let rates = Array.isArray(ratesQ.data) ? ratesQ.data : [];
      if (!rates.length) rates = DEFAULT_RATES.map(function(r) { return Object.assign({ effective_from: "2000-01-01", effective_to: null }, r); });

      return res.status(200).json({
        rates: rates,
        skuTargets: Array.isArray(targetsQ.data) ? targetsQ.data : []
      });
    }

    const rates = Array.isArray(req.body && req.body.rates) ? req.body.rates : [];
    const skuTargets = Array.isArray(req.body && req.body.skuTargets) ? req.body.skuTargets : [];

    if (rates.length) {
      const rows = rates.map(function(r) {
        return {
          site_id: CACHE_SITE_ID,
          role: String(r.role || "").trim().toLowerCase(),
          effective_from: r.effective_from || "2000-01-01",
          effective_to: r.effective_to || null,
          hourly_rate: toNum(r.hourly_rate),
          markup_pct: toNum(r.markup_pct),
          updated_by: user.email
        };
      }).filter(function(r) { return r.role; });

      if (rows.length) {
        const up = await supabase.from("ops_rates").upsert(rows, { onConflict: "site_id,role,effective_from" });
        if (up.error) throw up.error;
      }
    }

    if (skuTargets.length) {
      const rows = skuTargets.map(function(t) {
        return {
          site_id: CACHE_SITE_ID,
          item_code: String(t.item_code || "").trim(),
          customer: t.customer ? String(t.customer).trim() : null,
          active_from: t.active_from || "2000-01-01",
          active_to: t.active_to || null,
          revenue_per_case: toNum(t.revenue_per_case),
          target_cases_per_hour: toNum(t.target_cases_per_hour),
          updated_by: user.email
        };
      }).filter(function(t) { return t.item_code; });

      if (rows.length) {
        const up = await supabase.from("ops_sku_targets").upsert(rows, { onConflict: "site_id,item_code,active_from" });
        if (up.error) throw up.error;
      }
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    Sentry.captureException(err);
    return res.status(500).json({ error: "Ops config request failed", details: err && err.message ? err.message : "unknown" });
  }
}

