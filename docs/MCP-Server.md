# PackPulse MCP Server

## What It Exposes

The PackPulse MCP server is a local `stdio` server that wraps existing PackPulse data sources in read-only MCP tools and resources.

Tools:
- `get_snapshot_status`
- `get_operations_summary`
- `get_work_order_summary`
- `search_inventory`

Resources:
- `packpulse://snapshot/status`
- `packpulse://snapshot/history`
- `packpulse://docs/architecture`
- `packpulse://docs/api-contracts`
- `packpulse://docs/data-dictionary`
- `packpulse://docs/ai-intent-routing`

Prompts:
- `daily_ops_brief`
- `inventory_triage`

## Environment

The server reads env vars from the existing shell first, then falls back to:

1. `.env`
2. `.env.local`

Required server-side values:

- `SUPABASE_URL` or `VITE_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Optional:

- `CACHE_SITE_ID`

## Run It

```bash
npm run mcp:packpulse
```

On startup, the server logs its config summary to `stderr` and serves MCP over `stdin`/`stdout`.

## Example MCP Client Wiring

Use the repo root as the working directory so `.env` and `.env.local` can be discovered.

```json
{
  "mcpServers": {
    "packpulse": {
      "command": "npm",
      "args": ["run", "mcp:packpulse"],
      "cwd": "/absolute/path/to/PackPulse"
    }
  }
}
```

If your MCP client prefers `node` directly:

```json
{
  "mcpServers": {
    "packpulse": {
      "command": "node",
      "args": ["/absolute/path/to/PackPulse/mcp/packpulse-server.mjs"],
      "cwd": "/absolute/path/to/PackPulse"
    }
  }
}
```

## Notes

- KPI math is deterministic and based on Supabase tables or the shared PackPulse snapshot.
- Snapshot-dependent tools should be treated as stale if `freshnessMinutes` is high.
- If the performance materialized view `ops_daily_line_metrics_mv` is missing, the server falls back to raw `production_events` and `labor_events`.
