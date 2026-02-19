// GET /api/nulogy/test
// Tests Nulogy credentials by attempting a lightweight API call

const NULOGY_URL = process.env.NULOGY_URL || "https://app.nulogy.net";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  const user = process.env.NULOGY_USER;
  const pass = process.env.NULOGY_PASS;
  const siteUuid = process.env.NULOGY_SITE_UUID;

  if (!user || !pass) {
    return res.status(200).json({
      configured: false,
      connected: false,
      message: "Nulogy credentials not set. Add NULOGY_USER and NULOGY_PASS to Vercel environment variables."
    });
  }

  const auth = Buffer.from(`${user}:${pass}`).toString("base64");

  try {
    // Test by creating a minimal report request (small columns list)
    // We'll use the item_master report with 1 column as a lightweight test
    const response = await fetch(`${NULOGY_URL}/api/reports/report_runs`, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${auth}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        report: "inventory_snapshot",
        columns: ["item_code"],
        ...(siteUuid ? { site_uuid: siteUuid } : {})
      })
    });

    if (response.status === 401) {
      return res.status(200).json({
        configured: true,
        connected: false,
        message: "Credentials rejected by Nulogy. Check username and password."
      });
    }

    if (response.status === 403) {
      return res.status(200).json({
        configured: true,
        connected: false,
        message: "Nulogy account lacks API permissions. Contact your Nulogy admin."
      });
    }

    if (response.ok || response.status === 201) {
      return res.status(200).json({
        configured: true,
        connected: true,
        message: "Connected to Nulogy successfully.",
        user: user.replace(/(.{3}).*(@.*)/, "$1***$2"), // mask email
        url: NULOGY_URL,
        siteUuid: siteUuid || "default"
      });
    }

    const text = await response.text();
    return res.status(200).json({
      configured: true,
      connected: false,
      message: `Nulogy returned status ${response.status}: ${text.slice(0, 200)}`
    });

  } catch (err) {
    return res.status(200).json({
      configured: true,
      connected: false,
      message: `Cannot reach Nulogy: ${err.message}`
    });
  }
}
