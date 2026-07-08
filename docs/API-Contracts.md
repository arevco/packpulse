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

## Planned `/api/safety/*`
- Safety routes are planned for the OSHA Log feature and should follow the same auth model.

## `/api/safety/establishments`
- Methods: `GET`, `POST`
- Purpose:
  - site-scoped establishment setup for separate OSHA logs

## `/api/safety/summary`
- Method: `GET`
- Query:
  - `year: YYYY`
  - `establishmentId: uuid`
- Purpose:
  - summary cards and inbox counts

## `/api/safety/cases`
- Methods: `GET`, `POST`
- Purpose:
  - list, create, update, and classify incident / OSHA case records

## `/api/safety/case`
- Method: `GET`
- Query:
  - `id: uuid`
  - `includePrivate?: 1`
- Purpose:
  - full case detail payload, updates, and attachments

## `/api/safety/case-updates`
- Methods: `GET`, `POST`
- Purpose:
  - follow-up updates for lost time, restrictions, and notes

## `/api/safety/annual-summary`
- Methods: `GET`, `POST`
- Purpose:
  - derive and persist annual summary inputs and certification state

## `/api/safety/analytics`
- Method: `GET`
- Purpose:
  - de-identified safety trends and KPI aggregates

## `/api/safety/export`
- Method: `GET`
- Query:
  - `type: 300|300a|301|ita_csv`
- Purpose:
  - export OSHA-ready payloads for print or file generation
