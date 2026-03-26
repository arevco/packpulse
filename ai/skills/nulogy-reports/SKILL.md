---
name: nulogy-reports
description: Use when working on PackPulse features that depend on Nulogy Reports API data, need to choose the right report set, plan joins across multiple reports, or run the repo's Nulogy report artifact pipeline.
---

# Nulogy Reports

This repo keeps the Nulogy API workflow in versioned docs and scripts instead of rediscovering report behavior during feature work.

## Workflow

1. Read `docs/nulogy/Implementation-Strategy.md` for execution rules, partitioning guidance, and artifact layout.
2. Read `docs/nulogy/AI-Usage-Guide.md` for report selection and merge heuristics.
3. Use `docs/nulogy/reports-api-metadata.json` or `docs/nulogy/Reports-API-Catalog.md` to inspect report fields and filters before changing code.
4. If fresh source artifacts are needed, use `/api/nulogy/run-report` or `node scripts/nulogy/run-report-catalog.mjs` sequentially. Never plan concurrent Nulogy report runs.

## Guardrails

- Prefer deterministic calculations after extraction. Do not treat model output as authoritative numeric logic.
- Save raw CSV artifacts before building transforms or summaries.
- Treat `project_code`, `job_id`, `item_code`, `lot_code`, and `pallet_number` as candidate join keys, but verify coverage in the metadata before coding.
- If a report reaches its documented max rows, assume truncation risk and plan a partitioned pull rather than trusting the result.
- Keep report-specific transforms separate from raw artifacts so new features can reuse the source extract.
