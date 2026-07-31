# API Contracts

## Auth
- Most operational routes require `pp_session` cookie.
- Unauthorized requests return `401`.

## `/api/ai/chat`
- Method: `POST`
- Body:
  - `prompt: string`
  - `activeView?: string`
  - `contextLines?: string[]`
  - `metrics?: object`
  - `history?: { role: "user"|"assistant", text: string }[]`
- Success:
  - `200 { answer: string, model: string }`
- Errors:
  - `400 { error: "Prompt is required" }`
  - `401 { error: "Unauthorized" }`
  - `405 { error: "Method not allowed" }`
  - `5xx { error: string, details?: string }`

## `/api/cache/snapshot`
- Methods: `GET`, `POST`
- Purpose:
  - read/write shared dataset snapshot (site scoped)

## `/api/cache/production-events`
- Method: `POST`
- Purpose:
  - ingest normalized production rows to `production_events`

## `/api/cache/labor-events`
- Method: `POST`
- Purpose:
  - ingest normalized labor rows to `labor_events`

## `/api/cache/production-trends`
- Method: `GET`
- Query:
  - `days?: number`
  - `operatingDays?: boolean`
- Returns:
  - trend rows by day/shift and diagnostics

## `/api/cache/shift-change`
- Method: `GET`
- Purpose:
  - compare latest and prior snapshots

## `/api/ops/config`
- Methods: `GET`, `POST`
- Purpose:
  - labor rate config + SKU targets

## `/api/ops/shift-inputs`
- Methods: `GET`, `POST`
- Purpose:
  - manual labor inputs by date/shift/line

## `/api/ops/production-breakdown`
- Method: `GET`
- Query:
  - `days?: number`
- Purpose:
  - breakdown for operations charts and KPI cards

## `/api/ops/labor-actuals`
- Method: `GET`
- Query:
  - `start?: YYYY-MM-DD`
  - `end?: YYYY-MM-DD`
  - `monthKey?: YYYY-MM`
- Purpose:
  - labor actual summaries for Operations and Forecast

## `/api/ops/user-logins`
- Method: `GET`
- Query:
  - `limit?: number`
- Purpose:
  - lightweight user login activity
