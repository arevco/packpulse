// POST /api/auth/logout
// Clears session cookies

export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Credentials", "true");

  if (req.method === "OPTIONS") return res.status(200).end();

  res.setHeader("Set-Cookie", [
    "pp_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
    "pp_user=; Path=/; SameSite=Lax; Max-Age=0"
  ]);

  return res.status(200).json({ ok: true });
}
