import Sentry from "../_sentry.js";
import { getAuthenticatedUser, withCors } from "../ops/_common.js";

function toText(value) {
  if (value == null) return "";
  return String(value).trim();
}

export default async function handler(req, res) {
  withCors(req, res, ["POST", "OPTIONS"]);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    var user = getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    var apiKey = process.env.OPENAI_API_KEY || "";
    var model = process.env.OPENAI_MODEL || "gpt-4o-mini";
    if (!apiKey) {
      return res.status(500).json({ error: "OPENAI_API_KEY is not configured" });
    }

    var body = req.body || {};
    var prompt = toText(body.prompt);
    var activeView = toText(body.activeView || "overview");
    var contextLines = Array.isArray(body.contextLines) ? body.contextLines.map(toText).filter(Boolean).slice(0, 8) : [];
    var history = Array.isArray(body.history) ? body.history.slice(-8) : [];
    if (!prompt) return res.status(400).json({ error: "Prompt is required" });

    var system = [
      "You are PackPulse AI copilot for factory operations.",
      "Be concise, practical, and action-oriented.",
      "Prioritize: what happened, why it matters, and what to do next.",
      "If data is missing or uncertain, say so clearly.",
      "Never claim actions were completed unless explicitly provided in context."
    ].join(" ");

    var messages = [{ role: "system", content: system }];
    messages.push({
      role: "user",
      content:
        "Context\n" +
        "- User: " + user.email + "\n" +
        "- Active view: " + activeView + "\n" +
        (contextLines.length ? "- Dashboard context:\n  - " + contextLines.join("\n  - ") + "\n" : "")
    });

    history.forEach(function(msg) {
      var role = msg && msg.role === "assistant" ? "assistant" : "user";
      var text = toText(msg && msg.text);
      if (!text) return;
      messages.push({ role: role, content: text });
    });
    messages.push({ role: "user", content: prompt });

    var openaiResp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + apiKey,
      },
      body: JSON.stringify({
        model: model,
        temperature: 0.2,
        messages: messages,
      }),
    });

    var raw = await openaiResp.text();
    var parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch (_) {
      parsed = null;
    }
    if (!openaiResp.ok) {
      var details = parsed && parsed.error && parsed.error.message ? parsed.error.message : raw || "OpenAI request failed";
      return res.status(openaiResp.status).json({ error: "AI request failed", details: details });
    }

    var answer =
      parsed &&
      parsed.choices &&
      parsed.choices[0] &&
      parsed.choices[0].message &&
      parsed.choices[0].message.content
        ? String(parsed.choices[0].message.content).trim()
        : "";
    if (!answer) answer = "No AI response was returned.";

    return res.status(200).json({ answer: answer, model: model });
  } catch (err) {
    Sentry.captureException(err);
    return res.status(500).json({
      error: "Could not process AI request",
      details: err && err.message ? err.message : "unknown",
    });
  }
}
