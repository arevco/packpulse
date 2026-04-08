#!/usr/bin/env node

import { createServer } from "node:http";

import { closeSlackBot, getSlackBotSummary, handleSlackWebhook } from "./packpulse-bot.mjs";

const HOST = process.env.PACKPULSE_SLACK_HOST || "127.0.0.1";
const PORT = Number(process.env.PACKPULSE_SLACK_PORT || 8787);
const EVENTS_PATH = process.env.PACKPULSE_SLACK_EVENTS_PATH || "/slack/events";

function requestOrigin(req) {
  const protocol = req.headers["x-forwarded-proto"] || "http";
  const host = req.headers["x-forwarded-host"] || req.headers.host || `${HOST}:${PORT}`;
  return `${protocol}://${host}`;
}

async function readRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? Buffer.concat(chunks.map((chunk) => Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))) : null;
}

function buildHeaders(headerMap) {
  const headers = new Headers();
  Object.entries(headerMap || {}).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach((entry) => headers.append(key, entry));
      return;
    }
    if (typeof value === "string") headers.set(key, value);
  });
  return headers;
}

async function toWebRequest(req) {
  const body = await readRequestBody(req);
  const url = `${requestOrigin(req)}${req.url || "/"}`;
  return new Request(url, {
    method: req.method || "GET",
    headers: buildHeaders(req.headers),
    body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
  });
}

async function writeWebResponse(res, response) {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });
  const body = Buffer.from(await response.arrayBuffer());
  res.end(body);
}

function jsonResponse(payload, statusCode = 200) {
  return new Response(JSON.stringify(payload, null, 2), {
    status: statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}

const server = createServer(async (req, res) => {
  try {
    if ((req.url || "/") === "/healthz" && (req.method || "GET") === "GET") {
      const summary = await getSlackBotSummary();
      await writeWebResponse(res, jsonResponse({
        ok: true,
        service: "packpulse-slack-bot",
        eventsPath: EVENTS_PATH,
        ...summary,
      }));
      return;
    }

    if ((req.url || "/") === "/" && (req.method || "GET") === "GET") {
      await writeWebResponse(res, jsonResponse({
        service: "packpulse-slack-bot",
        eventsPath: EVENTS_PATH,
        health: "/healthz",
      }));
      return;
    }

    if ((req.url || "").startsWith(EVENTS_PATH)) {
      const request = await toWebRequest(req);
      const response = await handleSlackWebhook(request);
      await writeWebResponse(res, response);
      return;
    }

    await writeWebResponse(res, jsonResponse({ error: "Not found" }, 404));
  } catch (error) {
    await writeWebResponse(
      res,
      jsonResponse(
        {
          error: "Slack bot request failed",
          details: String(error && error.message ? error.message : error || "unknown"),
        },
        500
      )
    );
  }
});

server.listen(PORT, HOST, () => {
  console.error(`PackPulse Slack bot listening on http://${HOST}:${PORT}${EVENTS_PATH}`);
});

async function shutdown(signal) {
  console.error(`Shutting down PackPulse Slack bot on ${signal}...`);
  server.close(() => {});
  await closeSlackBot();
  process.exit(0);
}

process.on("SIGINT", () => {
  shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  shutdown("SIGTERM");
});
