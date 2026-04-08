import { Chat } from "chat";
import { createSlackAdapter } from "@chat-adapter/slack";
import { createMemoryState } from "@chat-adapter/state-memory";

import { getProjectRoot, loadLocalEnv } from "../../mcp/lib/packpulse-data.mjs";
import { callPackPulseTool, closePackPulseMcpClient, getPackPulseMcpSummary } from "./mcp-client.mjs";

const DEFAULT_DAYS = 7;
const MAX_DAYS = 30;

let chatInstance = null;

function getSlackCommandName() {
  return process.env.PACKPULSE_SLACK_COMMAND || "/packpulse";
}

function getRequiredSlackEnvStatus() {
  return {
    hasBotToken: !!process.env.SLACK_BOT_TOKEN,
    hasSigningSecret: !!process.env.SLACK_SIGNING_SECRET,
    hasBotUserId: !!process.env.SLACK_BOT_USER_ID,
  };
}

function ensureSlackEnv() {
  const status = getRequiredSlackEnvStatus();
  const missing = [];
  if (!status.hasBotToken) missing.push("SLACK_BOT_TOKEN");
  if (!status.hasSigningSecret) missing.push("SLACK_SIGNING_SECRET");
  if (missing.length) {
    throw new Error(
      `Missing Slack bot environment variables: ${missing.join(", ")}. ` +
      "Set them before starting the Slack bot service."
    );
  }
}

function removeLeadingInvocation(text) {
  const botName = (process.env.PACKPULSE_SLACK_USER_NAME || "packpulse").toLowerCase();
  return String(text || "")
    .replace(new RegExp(`^@?${botName}[,:\\-\\s]*`, "i"), "")
    .replace(/^<@[^>]+>\s*/, "")
    .trim();
}

function extractDays(text, fallback = DEFAULT_DAYS) {
  const match = String(text || "").match(/\b(\d{1,2})\b/);
  if (!match) return fallback;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(MAX_DAYS, value));
}

function formatNumber(value, digits = 0) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return "0";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(num);
}

function describeFreshness(snapshotSyncedAt, freshnessMinutes) {
  if (!snapshotSyncedAt) return "snapshot freshness unavailable";
  if (!(Number(freshnessMinutes) >= 0)) return `snapshot synced ${snapshotSyncedAt}`;
  const minutes = Number(freshnessMinutes);
  if (minutes < 60) return `snapshot synced ${formatNumber(minutes, 1)} minutes ago`;
  const hours = minutes / 60;
  if (hours < 48) return `snapshot synced ${formatNumber(hours, 1)} hours ago`;
  return `snapshot synced ${formatNumber(hours / 24, 1)} days ago`;
}

function helpMarkdown() {
  const command = getSlackCommandName();
  return [
    "*PackPulse Slack bot*",
    "",
    `Mention \`@packpulse\` or use \`${command}\` with one of these queries:`,
    `- \`${command} brief\``,
    `- \`${command} ops 7\``,
    `- \`${command} late work orders\``,
    `- \`${command} due soon work orders\``,
    `- \`${command} inventory 115193\``,
    "",
    "The bot uses the PackPulse MCP server for deterministic KPI and snapshot lookups.",
  ].join("\n");
}

function formatSnapshotSummary(data) {
  const freshness = describeFreshness(data.syncedAt, data.freshnessMinutes);
  const datasets = Array.isArray(data.availableDatasets) && data.availableDatasets.length
    ? data.availableDatasets.join(", ")
    : "none";
  return [
    "*PackPulse Snapshot*",
    `- Site: \`${data.siteId || "default"}\``,
    `- Freshness: ${freshness}`,
    `- Updated by: ${data.updatedBy || "unknown"}`,
    `- Available datasets: ${datasets}`,
  ].join("\n");
}

function formatOperationsSummary(data) {
  const topLines = Array.isArray(data.topLines) ? data.topLines.slice(0, 3) : [];
  const topSkus = Array.isArray(data.topSkus) ? data.topSkus.slice(0, 3) : [];
  const linesSection = topLines.length
    ? ["*Top lines*", ...topLines.map((line) => (
      `- ${line.line}: ${formatNumber(line.producedUnits)} units, ` +
      `${formatNumber(line.casesPerPayableHour || 0, 2)} cases/payable hr`
    ))].join("\n")
    : "*Top lines*\n- No line detail available";
  const skuSection = topSkus.length
    ? ["*Top SKUs*", ...topSkus.map((sku) => (
      `- ${sku.itemCode}: ${formatNumber(sku.producedUnits)} units`
    ))].join("\n")
    : "*Top SKUs*\n- No SKU detail available";

  return [
    `*PackPulse Ops (${data.window.start} to ${data.window.end})*`,
    `- Produced: ${formatNumber(data.totals.producedUnits)} units`,
    `- Payable hours: ${formatNumber(data.totals.payableHours, 2)}`,
    `- Labor cost: $${formatNumber(data.totals.laborCost, 2)}`,
    `- Cases/payable hr: ${formatNumber(data.totals.casesPerPayableHour || 0, 2)}`,
    data.snapshotSyncedAt ? `- Snapshot: ${data.snapshotSyncedAt}` : "- Snapshot: unavailable",
    linesSection,
    skuSection,
  ].join("\n");
}

function formatWorkOrderSummary(data, statusLabel) {
  const items = Array.isArray(data.items) ? data.items : [];
  const itemLines = items.length
    ? items.map((item) => (
      `- ${item.workOrderCode}: ${item.itemCode || "unknown SKU"}, ` +
      `${formatNumber(item.unitsRemaining)} remaining` +
      (item.dueDate ? `, due ${item.dueDate}` : "")
    ))
    : ["- No matching work orders found."];

  return [
    `*PackPulse ${statusLabel} work orders*`,
    `- Total work orders in snapshot: ${formatNumber(data.totalWorkOrders)}`,
    `- Matching work orders: ${formatNumber(data.matchedCount)}`,
    `- Remaining units across all work orders: ${formatNumber(data.totals.remainingUnits)}`,
    ...itemLines,
  ].join("\n");
}

function formatInventorySummary(query, data) {
  const items = Array.isArray(data.items) ? data.items : [];
  const itemLines = items.length
    ? items.slice(0, 5).map((item) => (
      `- ${item.itemCode || "unknown"}: ${formatNumber(item.totalQtyOnHand, 2)} on hand` +
      (item.description ? `, ${item.description}` : "")
    ))
    : ["- No matching inventory rows found."];

  return [
    `*PackPulse inventory for "${query}"*`,
    `- Matches: ${formatNumber(data.totalMatches)}`,
    data.snapshotSyncedAt ? `- Snapshot: ${data.snapshotSyncedAt}` : "- Snapshot: unavailable",
    ...itemLines,
  ].join("\n");
}

async function buildBrief(days) {
  const [snapshot, operations, late] = await Promise.all([
    callPackPulseTool("get_snapshot_status"),
    callPackPulseTool("get_operations_summary", { days, lineLimit: 3, skuLimit: 3 }),
    callPackPulseTool("get_work_order_summary", { status: "late", limit: 5 }),
  ]);

  if (snapshot.isError) throw new Error(snapshot.text || "Could not load PackPulse snapshot.");
  if (operations.isError) throw new Error(operations.text || "Could not load PackPulse operations summary.");
  if (late.isError) throw new Error(late.text || "Could not load late work orders.");

  const snapshotData = snapshot.data || {};
  const operationsData = operations.data || {};
  const lateData = late.data || {};

  const lateItems = Array.isArray(lateData.items) ? lateData.items.slice(0, 3) : [];
  return [
    "*PackPulse brief*",
    `- Freshness: ${describeFreshness(snapshotData.syncedAt, snapshotData.freshnessMinutes)}`,
    `- Last ${days} days: ${formatNumber(operationsData.totals && operationsData.totals.producedUnits)} units, ` +
      `${formatNumber(operationsData.totals && operationsData.totals.payableHours, 2)} payable hours, ` +
      `${formatNumber(operationsData.totals && operationsData.totals.casesPerPayableHour, 2)} cases/payable hr`,
    `- Late work orders: ${formatNumber(lateData.matchedCount)}`,
    ...lateItems.map((item) => `- ${item.workOrderCode}: ${formatNumber(item.unitsRemaining)} remaining`),
  ].join("\n");
}

async function executePackPulseQuery(queryText) {
  const text = removeLeadingInvocation(queryText);
  const lower = text.toLowerCase();
  const days = extractDays(text);

  if (!text || lower === "help" || lower === "commands") {
    return helpMarkdown();
  }

  if (lower.startsWith("brief") || lower.startsWith("summary")) {
    return buildBrief(days);
  }

  if (lower.startsWith("status") || lower.startsWith("snapshot")) {
    const result = await callPackPulseTool("get_snapshot_status");
    if (result.isError) throw new Error(result.text || "Could not load PackPulse snapshot status.");
    return formatSnapshotSummary(result.data || {});
  }

  if (
    lower.startsWith("ops") ||
    lower.startsWith("operations") ||
    lower.startsWith("production")
  ) {
    const result = await callPackPulseTool("get_operations_summary", {
      days,
      lineLimit: 3,
      skuLimit: 3,
    });
    if (result.isError) throw new Error(result.text || "Could not load PackPulse operations summary.");
    return formatOperationsSummary(result.data || {});
  }

  if (lower.includes("late")) {
    const result = await callPackPulseTool("get_work_order_summary", {
      status: "late",
      limit: 5,
    });
    if (result.isError) throw new Error(result.text || "Could not load late work orders.");
    return formatWorkOrderSummary(result.data || {}, "late");
  }

  if (lower.includes("due soon")) {
    const result = await callPackPulseTool("get_work_order_summary", {
      status: "due_soon",
      limit: 5,
    });
    if (result.isError) throw new Error(result.text || "Could not load due-soon work orders.");
    return formatWorkOrderSummary(result.data || {}, "due-soon");
  }

  if (lower.includes("work order")) {
    const result = await callPackPulseTool("get_work_order_summary", {
      status: "active",
      limit: 5,
    });
    if (result.isError) throw new Error(result.text || "Could not load active work orders.");
    return formatWorkOrderSummary(result.data || {}, "active");
  }

  if (lower.startsWith("inventory") || lower.startsWith("sku ")) {
    const query = text.replace(/^(inventory|sku)\s+/i, "").trim();
    if (!query) return "Please include a SKU or item search term, for example `inventory 115193`.";
    const result = await callPackPulseTool("search_inventory", { query, limit: 5 });
    if (result.isError) throw new Error(result.text || "Could not search PackPulse inventory.");
    return formatInventorySummary(query, result.data || {});
  }

  return [
    "I couldn't map that to a PackPulse command yet.",
    "",
    helpMarkdown(),
  ].join("\n");
}

export async function runPackPulseSlackQuery(queryText) {
  await loadLocalEnv();
  return executePackPulseQuery(queryText);
}

function buildErrorMarkdown(error) {
  return [
    "*PackPulse bot error*",
    "",
    String(error && error.message ? error.message : error || "Unknown error"),
  ].join("\n");
}

export async function getSlackBotSummary() {
  await loadLocalEnv();
  const mcp = await getPackPulseMcpSummary();
  return {
    projectRoot: getProjectRoot(),
    slashCommand: getSlackCommandName(),
    slack: getRequiredSlackEnvStatus(),
    mcp,
  };
}

export async function getSlackChat() {
  await loadLocalEnv();
  if (chatInstance) return chatInstance;

  ensureSlackEnv();

  const slackAdapter = createSlackAdapter({
    botToken: process.env.SLACK_BOT_TOKEN,
    botUserId: process.env.SLACK_BOT_USER_ID || undefined,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    userName: process.env.PACKPULSE_SLACK_USER_NAME || "packpulse",
  });

  const chat = new Chat({
    userName: process.env.PACKPULSE_SLACK_USER_NAME || "packpulse",
    adapters: {
      slack: slackAdapter,
    },
    state: createMemoryState(),
    logger: process.env.PACKPULSE_SLACK_LOG_LEVEL || "info",
  });

  chat.onNewMention(async (thread, message) => {
    await thread.subscribe();
    try {
      const markdown = await executePackPulseQuery(message.text || "");
      await thread.post({ markdown });
    } catch (error) {
      await thread.post({ markdown: buildErrorMarkdown(error) });
    }
  });

  chat.onDirectMessage(async (thread, message) => {
    await thread.subscribe();
    try {
      const markdown = await executePackPulseQuery(message.text || "");
      await thread.post({ markdown });
    } catch (error) {
      await thread.post({ markdown: buildErrorMarkdown(error) });
    }
  });

  chat.onSubscribedMessage(async (thread, message) => {
    try {
      const markdown = await executePackPulseQuery(message.text || "");
      await thread.post({ markdown });
    } catch (error) {
      await thread.post({ markdown: buildErrorMarkdown(error) });
    }
  });

  chat.onSlashCommand(getSlackCommandName(), async (event) => {
    try {
      const markdown = await executePackPulseQuery(event.text || "");
      await event.channel.postEphemeral(event.user, { markdown }, { fallbackToDM: false });
    } catch (error) {
      await event.channel.postEphemeral(
        event.user,
        { markdown: buildErrorMarkdown(error) },
        { fallbackToDM: false }
      );
    }
  });

  await chat.initialize();
  chatInstance = chat;
  return chatInstance;
}

export async function handleSlackWebhook(request) {
  const chat = await getSlackChat();
  return chat.webhooks.slack(request);
}

export async function closeSlackBot() {
  const chat = chatInstance;
  chatInstance = null;
  if (chat) {
    await chat.shutdown().catch(() => {});
  }
  await closePackPulseMcpClient();
}
