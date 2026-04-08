#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod";

import {
  getDocResources,
  getOperationsSummary,
  getProjectRoot,
  getRuntimeConfigSummary,
  getSnapshotHistoryResource,
  getSnapshotStatus,
  getWorkOrderSummary,
  loadLocalEnv,
  readDocResource,
  searchInventory,
  summarizeFailure,
} from "./lib/packpulse-data.mjs";

const server = new McpServer(
  {
    name: "packpulse",
    version: "1.0.0",
  },
  {
    capabilities: { logging: {} },
    instructions:
      "PackPulse exposes deterministic operations data from Supabase and the shared snapshot. " +
      "Use tools for KPI math and status checks, verify snapshot freshness before drawing conclusions, " +
      "and say explicitly when data is unavailable or stale.",
  }
);

function asJson(value) {
  return JSON.stringify(value, null, 2);
}

function toolSuccess(summary, data) {
  return {
    content: [
      {
        type: "text",
        text: `${summary}\n\n${asJson(data)}`,
      },
    ],
    structuredContent: data,
  };
}

function toolFailure(context, error) {
  const message = `${context}: ${summarizeFailure(error)}`;
  return {
    content: [{ type: "text", text: message }],
    structuredContent: { error: message },
    isError: true,
  };
}

server.registerTool(
  "get_snapshot_status",
  {
    title: "Get Snapshot Status",
    description:
      "Returns PackPulse shared snapshot freshness, row counts, and derived work-order metrics.",
    annotations: {
      title: "Get Snapshot Status",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async () => {
    try {
      const data = await getSnapshotStatus();
      const summary = data.snapshotFound
        ? `Latest PackPulse snapshot is from ${data.syncedAt || "unknown time"} for site ${data.siteId || "default"}.`
        : "No PackPulse shared snapshot was found for the configured site.";
      return toolSuccess(summary, data);
    } catch (error) {
      return toolFailure("Unable to read PackPulse snapshot status", error);
    }
  }
);

server.registerTool(
  "get_operations_summary",
  {
    title: "Get Operations Summary",
    description:
      "Returns deterministic production and labor KPIs for a PackPulse date window.",
    inputSchema: {
      start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Inclusive Eastern start date in YYYY-MM-DD format."),
      end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Inclusive Eastern end date in YYYY-MM-DD format."),
      days: z.number().int().min(1).max(62).optional().describe("Use this instead of explicit dates to summarize the latest N days. Defaults to 7."),
      lineLimit: z.number().int().min(1).max(25).optional().describe("How many lines to include in the topLines output. Defaults to 10."),
      skuLimit: z.number().int().min(1).max(25).optional().describe("How many SKUs to include in the topSkus output. Defaults to 10."),
    },
    annotations: {
      title: "Get Operations Summary",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (input) => {
    try {
      const data = await getOperationsSummary(input || {});
      const summary =
        `Operations summary for ${data.window.start} through ${data.window.end}. ` +
        `Produced ${data.totals.producedUnits} units with ${data.totals.payableHours} payable labor hours.`;
      return toolSuccess(summary, data);
    } catch (error) {
      return toolFailure("Unable to build PackPulse operations summary", error);
    }
  }
);

server.registerTool(
  "get_work_order_summary",
  {
    title: "Get Work Order Summary",
    description:
      "Returns active, late, due-soon, or closed work-order detail from the PackPulse shared snapshot.",
    inputSchema: {
      status: z.enum(["active", "late", "due_soon", "closed", "all"]).optional().describe("Which work-order bucket to return. Defaults to active."),
      query: z.string().optional().describe("Optional text search against work order code, item, customer, or status."),
      limit: z.number().int().min(1).max(50).optional().describe("Maximum number of matching work orders to return. Defaults to 15."),
    },
    annotations: {
      title: "Get Work Order Summary",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (input) => {
    try {
      const data = await getWorkOrderSummary(input || {});
      const summary =
        `Matched ${data.matchedCount} work orders from a snapshot containing ${data.totalWorkOrders} total rows. ` +
        `${data.totals.late} are currently late.`;
      return toolSuccess(summary, data);
    } catch (error) {
      return toolFailure("Unable to summarize PackPulse work orders", error);
    }
  }
);

server.registerTool(
  "search_inventory",
  {
    title: "Search Inventory",
    description:
      "Searches the current PackPulse inventory snapshot by SKU, description, customer, or status.",
    inputSchema: {
      query: z.string().min(1).describe("Inventory search text, usually a SKU, partial SKU, or description."),
      limit: z.number().int().min(1).max(50).optional().describe("Maximum number of matching items to return. Defaults to 20."),
    },
    annotations: {
      title: "Search Inventory",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ query, limit }) => {
    try {
      const data = await searchInventory({ query, limit });
      const summary =
        data.totalMatches > 0
          ? `Found ${data.totalMatches} inventory matches for "${query}".`
          : `No inventory matches were found for "${query}".`;
      return toolSuccess(summary, data);
    } catch (error) {
      return toolFailure("Unable to search PackPulse inventory", error);
    }
  }
);

server.registerResource(
  "snapshot-status-resource",
  "packpulse://snapshot/status",
  {
    title: "PackPulse Snapshot Status",
    description: "Latest PackPulse snapshot freshness, row counts, and derived metrics.",
    mimeType: "application/json",
  },
  async () => {
    try {
      const data = await getSnapshotStatus();
      return {
        contents: [
          {
            uri: "packpulse://snapshot/status",
            mimeType: "application/json",
            text: asJson(data),
          },
        ],
      };
    } catch (error) {
      return {
        contents: [
          {
            uri: "packpulse://snapshot/status",
            mimeType: "application/json",
            text: asJson({ error: summarizeFailure(error) }),
          },
        ],
      };
    }
  }
);

server.registerResource(
  "snapshot-history-resource",
  "packpulse://snapshot/history",
  {
    title: "PackPulse Snapshot History",
    description: "Recent PackPulse snapshot history rows and derived metrics.",
    mimeType: "application/json",
  },
  async () => {
    try {
      const data = await getSnapshotHistoryResource(10);
      return {
        contents: [
          {
            uri: "packpulse://snapshot/history",
            mimeType: "application/json",
            text: asJson(data),
          },
        ],
      };
    } catch (error) {
      return {
        contents: [
          {
            uri: "packpulse://snapshot/history",
            mimeType: "application/json",
            text: asJson({ error: summarizeFailure(error) }),
          },
        ],
      };
    }
  }
);

for (const resource of getDocResources()) {
  server.registerResource(
    resource.name,
    resource.uri,
    {
      title: resource.title,
      description: resource.description,
      mimeType: resource.mimeType,
    },
    async () => {
      const contents = await readDocResource(resource.uri);
      return {
        contents: [
          {
            uri: contents.uri,
            mimeType: contents.mimeType,
            text: contents.text,
          },
        ],
      };
    }
  );
}

server.registerPrompt(
  "daily_ops_brief",
  {
    title: "Daily Ops Brief",
    description:
      "Guides an MCP client to pull the latest PackPulse snapshot and build a concise daily operations brief.",
    argsSchema: {
      days: z.number().int().min(1).max(30).optional().describe("How many days of operations to summarize. Defaults to 7."),
    },
  },
  async ({ days = 7 } = {}) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text:
            `Create a PackPulse operations brief for the last ${days} days. ` +
            "First call get_snapshot_status, then call get_operations_summary with the same day window, " +
            "and finally call get_work_order_summary with {\"status\":\"late\",\"limit\":10}. " +
            "Keep KPI math deterministic, mention snapshot freshness, and clearly separate facts from recommendations.",
        },
      },
    ],
  })
);

server.registerPrompt(
  "inventory_triage",
  {
    title: "Inventory Triage",
    description:
      "Guides an MCP client to look up inventory for a SKU or phrase and summarize availability.",
    argsSchema: {
      query: z.string().describe("SKU, partial SKU, or item description to investigate."),
    },
  },
  async ({ query }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text:
            `Investigate PackPulse inventory for "${query}". ` +
            "Call search_inventory first, highlight total on-hand quantity, customer/status splits, " +
            "and flag if the inventory result appears empty or stale based on snapshot freshness from get_snapshot_status.",
        },
      },
    ],
  })
);

async function main() {
  await loadLocalEnv();
  const config = await getRuntimeConfigSummary();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `PackPulse MCP server running on stdio from ${getProjectRoot()} ` +
    `(siteId=${config.siteId}, hasSupabaseUrl=${config.hasSupabaseUrl}, hasServiceRoleKey=${config.hasServiceRoleKey})`
  );
}

main().catch((error) => {
  console.error("PackPulse MCP server failed to start:", error);
  process.exit(1);
});
