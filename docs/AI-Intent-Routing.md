# AI Intent Routing

## Purpose
Define when Ask AI should return deterministic values vs model-generated narrative.

## Routing Modes
- `deterministic`
  - Use for numeric/KPI queries requiring exact values.
- `model`
  - Use for summaries, recommendations, and explanations.
- `hybrid`
  - Compute facts deterministically, then ask model to explain/actions.

## Current Deterministic Intents
- Cases produced today
- Last week production summary
- Chart summary (last 7 production days)
- March daily production yield target

## Model Intents
- “What should we run next and why?”
- “Summarize top blockers”
- “What actions should supply chain take first?”

## Fallback Rules
- If deterministic path cannot compute required values:
  - return explicit “data unavailable” message.
- If model call fails:
  - return fallback guidance + failure reason in message.

## Response Metadata (Target Standard)
- `source`: deterministic | openai | hybrid
- `intent`: intent key
- `dataTimestamp`: latest context timestamp
- `confidence`: high/medium/low
- `citations`: list of metrics/table keys used

## Change Management
- Add/update intents in a single location (`/api/ai/chat.js` currently).
- Keep regex/keyword matching simple and explicit.
- Add regression prompts when new intents are introduced.

