# Generic Nulogy Runner API

## Endpoints

### `POST /api/nulogy/run-report`

Creates a Nulogy report run for any report code and optionally waits for completion.

Request body:

```json
{
  "report": "project_status",
  "columns": ["project_code", "item_code", "units_expected"],
  "filters": [
    {
      "column": "project_status",
      "operator": "!=",
      "threshold": "Cancelled"
    }
  ],
  "sort_by": [
    {
      "column": "project_code",
      "direction": "asc"
    }
  ],
  "locale": "en_US",
  "site_uuid": "optional-site-uuid",
  "waitForCompletion": true,
  "pollIntervalMs": 2500,
  "maxPolls": 12
}
```

Notes:

- Omit fixed fields from `columns`. Nulogy already includes them.
- `sort_by` accepts only one column. Extra entries are ignored and returned as warnings.
- `waitForCompletion: false` returns quickly with `statusUrl`.
- `waitForCompletion: true` returns `200` when completed or `202` when polling timed out.

### `POST /api/nulogy/run-catalog`

Advances through the generated catalog one report at a time. This is intended for client or script loops that need sequential execution.

Request body:

```json
{
  "cursor": 0,
  "reportCodes": ["inventory_snapshot", "project_status"],
  "waitForCompletion": true,
  "pollIntervalMs": 2500,
  "maxPolls": 12,
  "locale": "en_US",
  "overrides": {
    "project_status": {
      "filters": [
        {
          "column": "project_status",
          "operator": "!=",
          "threshold": "Cancelled"
        }
      ]
    }
  }
}
```

Behavior:

- Loads [reports-api-metadata.json](/Users/aj/Documents/New project/docs/nulogy/reports-api-metadata.json)
- Builds the request for the report at `cursor`
- Requests all documented data fields unless overridden
- Returns `advanceCursor`, `nextCursor`, and `hasMore`
- `advanceCursor` becomes `true` only after the current report completes, so a caller can stay sequential and avoid overlapping jobs

## Response Shape

`run-report` returns a flat response:

- `report`
- `requestBody`
- `statusUrl`
- `downloadUrl` when completed
- `statusHistory` when polling occurs
- `warnings` for sort truncation or other normalization behavior

`run-catalog` wraps the execution result with:

- `cursor`
- `nextCursor`
- `totalReports`
- `hasMore`
- `catalogReport`
- `result`

## Safety Rules

- Status polling only accepts URLs on the configured Nulogy host.
- The route uses server-side `NULOGY_USER`, `NULOGY_PASS`, and optional `NULOGY_SITE_UUID`.
- Reports still need to be executed sequentially by the caller. `run-catalog` helps by processing one catalog entry per request instead of creating a burst of jobs.
