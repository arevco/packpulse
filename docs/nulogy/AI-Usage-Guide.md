# AI Usage Guide For Nulogy Reports

## When To Use This

Use these rules whenever PackPulse work needs Nulogy data and the feature depends on more than one report or on unfamiliar report fields.

## Selection Rules

- Start from `docs/nulogy/reports-api-metadata.json`, not memory.
- Choose the primary fact report first. Do not begin by merging dimensions together.
- Prefer reports whose grain matches the user question: inventory snapshot, work order status, production event, labor entry, shipment line, receipt line, reject event.
- If a required field is not present in the metadata for the current integration user, treat it as unavailable.

## Merge Rules

- Join on stable identifiers before using descriptive text fields.
- Treat `item_description`, customer labels, and line labels as context, not keys.
- Do not mix snapshot and transactional data without an explicit timestamp or freshness story.
- If two reports only overlap on weak keys, keep them separate and surface the gap instead of inventing a fuzzy join.

## Execution Rules

- Run reports sequentially.
- Request all documented data fields for a report unless a smaller field set is intentional and justified.
- Omit fixed fields from the requested column list; they are already included by the report.
- Save the raw CSV artifact before creating transformed JSON or feature-specific tables.
- If row count is near the documented maximum, plan partitioned reruns before trusting the data as complete.
- If you run through the current deployed proxy, compare returned headers with the metadata catalog before assuming full field coverage.

## Feature Design Rules

- Keep KPI math deterministic and server-side.
- Use AI for summarization, prioritization, and guidance after the numeric layer is fixed.
- Return `source` and timestamps when exposing report-derived insights.
- If data is missing, say that it is unavailable instead of backfilling with inference.

## Practical Commands

Refresh the report catalog:

```bash
npm run nulogy:docs
```

Run live artifacts with local credentials:

```bash
npm run nulogy:artifacts -- --mode direct
```

Run the currently supported subset through the deployed proxy:

```bash
npm run nulogy:artifacts -- --mode proxy --proxy-base-url https://packpulse.revcopack.com
```

Run the full catalog after the generic proxy routes are deployed:

```bash
npm run nulogy:artifacts -- --mode proxy --proxy-route generic --proxy-base-url https://packpulse.revcopack.com
```
