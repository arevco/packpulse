import Sentry from "../_sentry.js";
import { getAuthenticatedUser, withCors } from "../ops/_common.js";
import { stageUpload } from "./_service.js";

export default async function handler(req, res) {
  withCors(req, res, ["POST", "OPTIONS"]);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    var user = getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    var result = await stageUpload(req.body || {}, user);
    return res.status(result.error ? 422 : 200).json(result);
  } catch (error) {
    Sentry.captureException(error);
    return res.status(error.statusCode || 500).json({ error: error.message || "Upload failed" });
  }
}
