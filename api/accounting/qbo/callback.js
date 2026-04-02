import Sentry from "../../_sentry.js";
import { getAuthenticatedUser, withCors } from "../../ops/_common.js";
import {
  exchangeAuthorizationCodeForTokens,
  parseQuickBooksOauthState,
  resolveAppOrigin,
  resolveQuickBooksRedirectUri,
  sanitizeReturnToPath,
  upsertQuickBooksConnection
} from "./_client.js";

function redirectWithStatus(req, res, returnTo, status, message) {
  var origin = resolveAppOrigin(req);
  var url = new URL(sanitizeReturnToPath(returnTo), origin);
  url.searchParams.set("qbo_status", status);
  if (message) url.searchParams.set("qbo_message", String(message).slice(0, 240));
  return res.redirect(url.toString());
}

export default async function handler(req, res) {
  withCors(req, res, ["GET", "OPTIONS"]);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  var state = parseQuickBooksOauthState(req.query && req.query.state);
  var returnTo = state && state.returnTo ? state.returnTo : "/?view=invoicing";

  try {
    if (!state) return redirectWithStatus(req, res, returnTo, "error", "QuickBooks authorization state expired. Start the connection again.");

    var code = String(req.query && req.query.code || "").trim();
    var realmId = String(req.query && req.query.realmId || "").trim();
    var authError = String(req.query && (req.query.error || req.query.error_description) || "").trim();
    if (authError) {
      return redirectWithStatus(req, res, returnTo, "error", authError);
    }
    if (!code || !realmId) {
      return redirectWithStatus(req, res, returnTo, "error", "QuickBooks did not return an authorization code.");
    }

    var sessionUser = getAuthenticatedUser(req);
    var userEmail = (sessionUser && sessionUser.email) || state.email || "";
    var redirectUri = resolveQuickBooksRedirectUri(req);
    var tokens = await exchangeAuthorizationCodeForTokens({
      code: code,
      redirectUri: redirectUri
    });

    await upsertQuickBooksConnection({
      realmId: realmId,
      environment: process.env.QBO_ENVIRONMENT || "production",
      tokens: tokens,
      userEmail: userEmail,
      metadata: {
        last_connected_at: new Date().toISOString()
      }
    });

    return redirectWithStatus(req, res, returnTo, "connected", "QuickBooks connected. Run a master-data sync next.");
  } catch (err) {
    Sentry.captureException(err);
    return redirectWithStatus(
      req,
      res,
      returnTo,
      "error",
      err && err.message ? err.message : "QuickBooks connection failed"
    );
  }
}
