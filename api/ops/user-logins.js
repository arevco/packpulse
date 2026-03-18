import Sentry from "../_sentry.js";
import { CACHE_SITE_ID, getAuthenticatedUser, getSupabaseAdmin, withCors } from "./_common.js";

const ACTIVITY_DEDUP_MS = 15 * 60 * 1000;

function parseCookies(cookieHeader) {
  var cookies = {};
  if (!cookieHeader) return cookies;
  String(cookieHeader).split(";").forEach(function(c) {
    var parts = c.trim().split("=");
    var key = parts.shift();
    if (key) cookies[key.trim()] = parts.join("=").trim();
  });
  return cookies;
}

function getCookieUserName(req) {
  try {
    var cookies = parseCookies(req.headers.cookie || "");
    var raw = cookies.pp_user;
    if (!raw) return null;
    var parsed = JSON.parse(decodeURIComponent(raw));
    var name = parsed && parsed.name ? String(parsed.name).trim() : "";
    return name || null;
  } catch (_) {
    return null;
  }
}

function requestIp(req) {
  var h = req.headers || {};
  var fwd = h["x-forwarded-for"] || h["X-Forwarded-For"] || "";
  if (typeof fwd === "string" && fwd.trim()) return fwd.split(",")[0].trim();
  return h["x-real-ip"] || h["X-Real-Ip"] || "";
}

export default async function handler(req, res) {
  withCors(req, res, ["GET", "POST", "OPTIONS"]);
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const user = getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    const supabase = getSupabaseAdmin();
    if (req.method === "POST") {
      const body = req.body || {};
      const eventType = String(body.event_type || body.eventType || "").trim().toLowerCase();
      const allowedEventTypes = { session_refresh: true, activity: true };
      if (!allowedEventTypes[eventType]) {
        return res.status(400).json({ error: "Unsupported event type" });
      }

      if (eventType === "activity") {
        const latest = await supabase
          .from("user_login_events")
          .select("created_at")
          .eq("site_id", CACHE_SITE_ID)
          .eq("user_email", user.email)
          .eq("event_type", "activity")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (latest.error) {
          const latestMsg = String(latest.error.message || "").toLowerCase();
          if (!(latestMsg.includes("user_login_events") && latestMsg.includes("schema cache"))) {
            throw latest.error;
          }
        } else if (latest.data && latest.data.created_at) {
          const lastTs = new Date(latest.data.created_at).getTime();
          if (Number.isFinite(lastTs) && (Date.now() - lastTs) < ACTIVITY_DEDUP_MS) {
            return res.status(200).json({ ok: true, skipped: true, reason: "deduped" });
          }
        }
      }

      const insertRes = await supabase
        .from("user_login_events")
        .insert({
          site_id: CACHE_SITE_ID,
          user_email: user.email,
          user_name: getCookieUserName(req),
          event_type: eventType,
          auth_provider: "session",
          source: process.env.VERCEL_ENV || process.env.NODE_ENV || "unknown",
          ip_address: requestIp(req) || null,
          user_agent: String(req.headers["user-agent"] || "").slice(0, 1000) || null
        });

      if (insertRes.error) {
        const insertMsg = String(insertRes.error.message || "").toLowerCase();
        if (insertMsg.includes("user_login_events") && insertMsg.includes("schema cache")) {
          return res.status(200).json({ ok: true, skipped: true, status: "missing_user_login_events_table" });
        }
        throw insertRes.error;
      }

      return res.status(200).json({ ok: true });
    }

    if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

    const limit = Math.max(5, Math.min(100, Number(req.query.limit || 25)));

    const q = await supabase
      .from("user_login_events")
      .select("id,user_email,user_name,event_type,auth_provider,source,ip_address,user_agent,created_at")
      .eq("site_id", CACHE_SITE_ID)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (q.error) {
      const msg = String(q.error.message || "").toLowerCase();
      if (msg.includes("user_login_events") && msg.includes("schema cache")) {
        return res.status(200).json({ rows: [], status: "missing_user_login_events_table" });
      }
      throw q.error;
    }

    return res.status(200).json({ rows: Array.isArray(q.data) ? q.data : [] });
  } catch (err) {
    Sentry.captureException(err);
    return res.status(500).json({ error: "Could not load user login events", details: err && err.message ? err.message : "unknown" });
  }
}
