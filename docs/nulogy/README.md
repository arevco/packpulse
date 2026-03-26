# Nulogy Reports API Docs

This folder is the working reference for PackPulse's Nulogy integration.

- `Implementation-Strategy.md`: recommended extraction architecture, row-limit strategy, and storage design
- `AI-Usage-Guide.md`: rules for report selection, joins, and AI-assisted feature work
- `Generic-Runner-API.md`: request and response contracts for the generic deployed runner
- `../supabase-nulogy-artifacts.sql`: Supabase schema for raw artifact storage plus searchable report metadata
- `Reports-API-Catalog.md`: generated human-readable catalog of every report in the supplied Nulogy docs
- `reports-api-metadata.json`: generated machine-readable report metadata
- `reports-key-analysis.json`: generated shared-field and join-key summary

Build or refresh the generated files with:

```bash
npm run nulogy:docs
```

Run report artifacts with:

```bash
npm run nulogy:artifacts
```

Upload an artifact run into Supabase Storage + metadata tables:

```bash
npm run nulogy:artifacts:upload -- --run-dir artifacts/nulogy/runs/2026-03-26T15-44-46.613Z
```

Run the catalog and upload it in one step:

```bash
npm run nulogy:artifacts -- --mode proxy --proxy-route generic --proxy-base-url https://packpulse.revcopack.com --upload-supabase true
```
