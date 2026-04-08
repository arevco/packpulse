# PackPulse Slack Bot

## Overview

This Slack bot runs as a small Node service and uses the local PackPulse MCP server as its deterministic data layer.

Flow:

1. Slack sends `app_mention`, slash command, or DM webhooks to the bot service.
2. The bot service parses the request and maps it to PackPulse intents.
3. The bot calls the PackPulse MCP server over `stdio`.
4. The bot formats the MCP response back into a Slack reply.

## Run Locally

Required environment variables:

- `SLACK_BOT_TOKEN`
- `SLACK_SIGNING_SECRET`
- `SUPABASE_URL` or `VITE_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Optional environment variables:

- `SLACK_BOT_USER_ID`
- `CACHE_SITE_ID`
- `PACKPULSE_SLACK_USER_NAME`
- `PACKPULSE_SLACK_COMMAND`
- `PACKPULSE_SLACK_PORT`
- `PACKPULSE_SLACK_HOST`
- `PACKPULSE_SLACK_EVENTS_PATH`
- `PACKPULSE_MCP_COMMAND`
- `PACKPULSE_MCP_ARGS`
- `PACKPULSE_MCP_CWD`

Start the bot:

```bash
npm run bot:slack
```

Defaults:

- bot host: `127.0.0.1`
- bot port: `8787`
- Slack webhook path: `/slack/events`
- slash command: `/packpulse`

Health endpoint:

```bash
curl -s http://127.0.0.1:8787/healthz
```

## Slack App Setup

For the first version, configure a Slack app with:

OAuth scopes:

- `app_mentions:read`
- `chat:write`
- `commands`

Optional for DM support:

- `im:history`

Event subscriptions:

- `app_mention`

Optional for DM support:

- `message.im`

Slash command:

- Command: `/packpulse` or your chosen override
- Request URL: `https://YOUR-PUBLIC-URL/slack/events`

When testing locally, expose the bot service with a tunnel such as `ngrok` or `cloudflared`, then use that public URL in Slack.

## Supported Queries

The first version supports:

- `brief`
- `status`
- `ops 7`
- `late work orders`
- `due soon work orders`
- `inventory 115193`

You can use the same phrases in:

- `@packpulse ...` mentions
- direct messages to the bot
- `/packpulse ...`

## Production Notes

- The current bot uses `@chat-adapter/state-memory`, which is good for local development but not for durable production state.
- For production, switch the Chat SDK state adapter to Redis.
- The bot intentionally keeps KPI math deterministic by calling PackPulse MCP tools instead of calculating numbers inside Slack handlers.
