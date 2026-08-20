import crypto from "crypto";
import Sentry from "../_sentry.js";
import { CACHE_SITE_ID, getAuthenticatedUser, getSupabaseAdmin, withCors } from "../ops/_common.js";
import { ALLOWED_TYPES, BUCKET, text } from "../purchase-orders/_service.js";
import { MAX_QUOTE_FILE_BYTES } from "./_service.js";

export default async function handler(req, res) {
  withCors(req, res, ["POST", "OPTIONS"]);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    var user = getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    var fileName = text(req.body && req.body.fileName, 240).replace(/[\/\\]/g, "_");
    var contentType = text(req.body && req.body.contentType, 120).toLowerCase();
    var byteSize = Number(req.body && req.body.byteSize) || 0;
    if (!fileName || !ALLOWED_TYPES[contentType]) return res.status(400).json({ error: "Unsupported quote file." });
    if (!(byteSize > 0) || byteSize > MAX_QUOTE_FILE_BYTES) return res.status(400).json({ error: "Quote files must be 10 MB or smaller." });
    var extension = ALLOWED_TYPES[contentType];
    var storagePath = CACHE_SITE_ID + "/quotes/staged/" + crypto.randomUUID() + "." + extension;
    var signed = await getSupabaseAdmin().storage.from(BUCKET).createSignedUploadUrl(storagePath);
    if (signed.error) throw signed.error;
    return res.status(200).json({ storagePath: storagePath, token: signed.data.token });
  } catch (error) {
    Sentry.captureException(error);
    return res.status(error.statusCode || 500).json({ error: error.message || "Could not prepare quote upload" });
  }
}
