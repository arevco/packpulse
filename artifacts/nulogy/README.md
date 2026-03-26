# Nulogy Report Artifacts

Generated report runs should go under `artifacts/nulogy/runs/<timestamp>/`.

Each run stores:

- `manifest.json`: top-level run summary
- `reports/<report_code>/request.json`: exact request body used
- `reports/<report_code>/raw.csv`: raw source artifact from Nulogy
- `reports/<report_code>/preview.json`: headers, sample rows, row-count summary
- `reports/<report_code>/summary.json`: execution metadata, status history, truncation hint

The raw CSV is the authoritative artifact. JSON previews are only for fast inspection and should not replace deterministic parsing in downstream code.
