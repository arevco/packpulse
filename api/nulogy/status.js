// GET /api/nulogy/status?url=<statusUrl>
// Checks the status of a Nulogy report job

import Sentry from "../_sentry.js";
import { buildAuthHeader, getNulogyCredentials, isSafeStatusUrl, withNulogyCors } from "./_runner.js";

export default async function handler(req, res) {
  withNulogyCors(res, ["GET", "OPTIONS"]);

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const statusUrl = req.query.url;
  if (!statusUrl) {
    return res.status(400).json({ error: "Missing url parameter" });
  }
  if (!isSafeStatusUrl(statusUrl)) {
    return res.status(400).json({ error: "Invalid or unsafe Nulogy status URL." });
  }

  try {
    const credentials = getNulogyCredentials();
    const auth = buildAuthHeader(credentials.user, credentials.pass);
    const response = await fetch(statusUrl, {
      method: "GET",
      headers: {
        "Authorization": auth
      }
    });

    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({ error: `Nulogy status error (${response.status}): ${text}` });
    }

    const data = await response.json();

    // data.status is "IN_PROGRESS" or "COMPLETED"
    // When COMPLETED, the download URL may be exposed as either url or download_url
    return res.status(200).json({
      status: data.status,
      downloadUrl: data.download_url || data.url || null,
      errors: Array.isArray(data.errors) ? data.errors : null
    });

  } catch (err) {
    Sentry.captureException(err);
    console.error("Nulogy status check error:", err);
    return res.status(500).json({ error: `Failed to check report status: ${err.message}` });
  }
}
