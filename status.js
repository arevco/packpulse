// GET /api/nulogy/status?url=<statusUrl>
// Checks the status of a Nulogy report job

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const user = process.env.NULOGY_USER;
  const pass = process.env.NULOGY_PASS;

  if (!user || !pass) {
    return res.status(500).json({ error: "Nulogy credentials not configured." });
  }

  const statusUrl = req.query.url;
  if (!statusUrl) {
    return res.status(400).json({ error: "Missing url parameter" });
  }

  const auth = Buffer.from(`${user}:${pass}`).toString("base64");

  try {
    const response = await fetch(statusUrl, {
      method: "GET",
      headers: {
        "Authorization": `Basic ${auth}`
      }
    });

    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({ error: `Nulogy status error (${response.status}): ${text}` });
    }

    const data = await response.json();

    // data.status is "IN_PROGRESS" or "COMPLETED"
    // When COMPLETED, data.url contains the S3 download URL
    return res.status(200).json({
      status: data.status,
      downloadUrl: data.url || null
    });

  } catch (err) {
    console.error("Nulogy status check error:", err);
    return res.status(500).json({ error: `Failed to check report status: ${err.message}` });
  }
}
