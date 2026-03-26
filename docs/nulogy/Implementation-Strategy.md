# Nulogy Reports API Implementation Strategy

## Objectives

- Stop rediscovering report codes, fields, and filters during feature work.
- Keep raw report artifacts separate from feature-specific transforms.
- Support multi-report features with deterministic joins and visible freshness.
- Design for row limits and asynchronous execution instead of assuming one report run is enough.

## Observed Constraints

- The Nulogy Reports API is asynchronous: create a run, poll the status URL, then download CSV.
- Nulogy explicitly recommends sequential execution. Parallel report creation will trigger `429`.
- Report availability, columns, and filters are permission-sensitive. The catalog is user-specific.
- Every report has a documented maximum row count. Hitting that cap should be treated as truncation risk, not success.
- Locale and `site_uuid` are first-class parameters and should be set intentionally.

## Repository Assets

- `scripts/nulogy/extract-reports-api-docs.mjs`
  Refreshes machine-readable metadata and the human-readable report catalog from the supplied Nulogy HTML documentation.
- `scripts/nulogy/run-report-catalog.mjs`
  Runs reports sequentially, saves raw CSV artifacts, and records request/preview/manifest metadata.
- `/api/nulogy/run-report`
  Generic deployed report runner for arbitrary report codes, columns, filters, and sort clauses.
- `/api/nulogy/run-catalog`
  Cursor-based deployed wrapper that advances through the metadata catalog one report at a time.
- `docs/nulogy/reports-api-metadata.json`
  Source of truth for report codes, fields, fixed fields, and filter fields.
- `artifacts/nulogy/runs/<timestamp>/`
  Stable artifact layout for live report pulls.

## Current Repo Gap

The current `/api/nulogy/create` route is not a generic Reports API runner. It supports only six report families and uses curated fallback column sets. That means:

- the generated catalog is broader than the live proxy's execution surface
- proxy-mode artifacts are valuable for validation, but they are not proof of full-detail field coverage
- a true full-catalog implementation requires a generic server route that accepts arbitrary `report`, `columns`, optional `filters`, and optional `sort_by`

Example from the live proxy pull:

- `project_status` metadata lists 51 data fields, but the current proxy artifact returned 16 columns
- `bom` metadata lists 15 data fields, but the current proxy artifact returned 6 columns

That behavior is a limitation of the current PackPulse proxy, not of the Nulogy documentation parser.

## Data Extraction Model

### 1. Metadata first

Do not hand-code report fields in feature work unless the metadata proves the field exists for the current integration user. New features should start by reading the catalog and choosing:

- primary fact report
- supporting reports
- required join keys
- partitioning plan if row caps are likely

### 2. Raw artifacts before transforms

For each live report run, save:

- exact request body
- raw CSV
- preview JSON with headers and sample rows
- execution summary with status history and truncation hint

Feature code should transform from these raw artifacts or from explicitly normalized tables derived from them. Do not make UI code depend directly on ad hoc report experimentation.

### 3. Partition when row caps are credible

A full-column request is not the same thing as a full-data extract. If the returned row count is near the documented maximum:

- transactional reports should be partitioned by date window
- snapshots should be partitioned by customer, item family, item category, or similar stable filter dimensions
- labor and production should be partitioned by time range before feature logic is trusted

The artifact manifest already marks `possibleTruncation` when a result reaches the documented cap.

## Merge Strategy

### Canonical join keys

Prefer deterministic keys in this order:

1. `job_id`
2. `project_code`
3. `project_id`
4. `item_code`
5. `lot_code`
6. `pallet_number`

Useful secondary context:

- `customer_name`
- `line` or `line_name`
- `reference_1` and related reference fields
- `item_description` only as a display attribute, not as a primary key

### Report roles

- Inventory and item master reports behave like dimensions or current-state snapshots.
- Production, labor, shipments, receipts, rejects, and transactions behave like fact tables and usually need time-window partitioning.
- BOM and planning reports bridge finished-good and subcomponent relationships and should be treated as structural lookup data.

### Feature build pattern

For any new PackPulse feature:

1. Pick the fact report that represents the event or measure.
2. Add supporting dimensions only after the fact grain is explicit.
3. Persist the raw artifact and confirm the join keys exist in both sources.
4. Build deterministic transforms server-side.
5. Expose freshness and source metadata alongside any AI-generated narrative.

## Recommended Operating Modes

### Direct mode

Use direct mode when local `NULOGY_USER` and `NULOGY_PASS` are available. This is the only mode that can run the full report catalog from the current repo without relying on deployed proxy limitations.

### Proxy mode

Use proxy mode when the deployed PackPulse environment has credentials but the local shell does not. Today this is useful for validating connectivity and harvesting raw artifacts for the subset already supported by `/api/nulogy/create`, but it should not be treated as full-detail parity with the catalog.

## Suggested Next Phase

- Add partition profiles for capped reports with date-window defaults.
- Promote reusable normalized tables once specific report combinations become stable.
- Deploy the new generic runner and switch artifact collection from legacy proxy mode to generic proxy mode.
