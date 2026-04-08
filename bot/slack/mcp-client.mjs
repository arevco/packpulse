import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { getProjectRoot, loadLocalEnv } from "../../mcp/lib/packpulse-data.mjs";

let clientPromise = null;
let activeTransport = null;

function getMcpServerCommand() {
  const command = process.env.PACKPULSE_MCP_COMMAND || "node";
  const args = process.env.PACKPULSE_MCP_ARGS
    ? String(process.env.PACKPULSE_MCP_ARGS).split(/\s+/g).filter(Boolean)
    : ["mcp/packpulse-server.mjs"];
  const cwd = process.env.PACKPULSE_MCP_CWD || getProjectRoot();
  return { command, args, cwd };
}

async function createClientConnection() {
  await loadLocalEnv();
  const params = getMcpServerCommand();
  activeTransport = new StdioClientTransport({
    command: params.command,
    args: params.args,
    cwd: params.cwd,
    stderr: "pipe",
    env: process.env,
  });

  const client = new Client({
    name: "packpulse-slack-bot",
    version: "1.0.0",
  });

  await client.connect(activeTransport);
  await client.listTools();
  return client;
}

export async function getPackPulseMcpClient() {
  if (!clientPromise) {
    clientPromise = createClientConnection().catch((error) => {
      clientPromise = null;
      activeTransport = null;
      throw error;
    });
  }
  return clientPromise;
}

export async function callPackPulseTool(name, args = {}) {
  const client = await getPackPulseMcpClient();
  const result = await client.callTool({ name, arguments: args });
  return {
    isError: !!result.isError,
    text:
      result.content && result.content[0] && result.content[0].type === "text"
        ? result.content[0].text
        : "",
    data: result.structuredContent || null,
    raw: result,
  };
}

export async function closePackPulseMcpClient() {
  const transport = activeTransport;
  activeTransport = null;
  clientPromise = null;
  if (transport) {
    await transport.close().catch(() => {});
  }
}

export async function getPackPulseMcpSummary() {
  await loadLocalEnv();
  const params = getMcpServerCommand();
  return {
    command: params.command,
    args: params.args,
    cwd: params.cwd,
  };
}
