// POST /api/nulogy/run-report
// Creates a generic Nulogy report run from arbitrary report metadata and optionally waits for completion.

import { executeReportRun, withNulogyCors } from "./_runner.js";

export default async function handler(req, res) {
  withNulogyCors(res, ["POST", "OPTIONS"]);

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  var result = await executeReportRun(req.body || {});
  return res.status(result.statusCode).json(result.body);
}
