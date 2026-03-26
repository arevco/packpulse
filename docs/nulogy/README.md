# Nulogy Reports API Docs

This folder is the working reference for PackPulse's Nulogy integration.

- `Implementation-Strategy.md`: recommended extraction architecture, row-limit strategy, and storage design
- `AI-Usage-Guide.md`: rules for report selection, joins, and AI-assisted feature work
- `Generic-Runner-API.md`: request and response contracts for the generic deployed runner
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
