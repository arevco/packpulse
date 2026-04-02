# TimesFM Evaluation Harness

This repo now includes a small backtest harness for daily production forecasting:

- [scripts/forecast/evaluate-daily-targets.mjs](/Users/aj/Documents/New%20project/scripts/forecast/evaluate-daily-targets.mjs)
- [scripts/forecast/timesfm_runner.py](/Users/aj/Documents/New%20project/scripts/forecast/timesfm_runner.py)

The harness evaluates daily target shape against actual production history. It is meant to answer one question before we integrate any external model: does TimesFM beat the current production-history allocator on PackPulse's real day-level output?

## What It Tests

The script pulls daily production history from `ops_daily_line_metrics_mv` when available, or falls back to `production_events`.

It compares:

- `production_history`: the same flat business-day allocator with bounded weekday adjustments currently used in Forecast view
- `weekday_profile`: a simpler recent weekday-shape baseline
- `business_day_flat`: an even-spread baseline across remaining business days
- `timesfm_raw`: direct TimesFM forecast, if a compatible Python environment is available
- `timesfm_scaled`: TimesFM scaled to the actual remaining month total so shape can be compared fairly with the in-app allocator

The scaled models use actual completed-month totals as a stand-in for the monthly forecast total. That means the backtest measures day-shape quality, not monthly total accuracy.

## Run It

Baseline backtest only:

```bash
npm run forecast:eval -- --start 2025-10-01 --end 2026-03-31 --output /tmp/forecast-eval.json
```

Write prediction rows and the source dataset:

```bash
npm run forecast:eval -- \
  --start 2025-10-01 \
  --end 2026-03-31 \
  --output /tmp/forecast-eval.json \
  --predictions-output /tmp/forecast-eval-predictions.csv \
  --dataset-output /tmp/forecast-history.csv
```

## TimesFM Requirements

The official TimesFM package currently requires Python `>=3.10`. The desktop machine used for this audit has Python `3.9.6`, so the harness is wired to make TimesFM optional.

If you have a compatible Python installed, point the harness at it:

```bash
npm run forecast:eval -- \
  --start 2025-10-01 \
  --end 2026-03-31 \
  --timesfm \
  --timesfm-python /opt/homebrew/bin/python3.11 \
  --output /tmp/forecast-eval-timesfm.json
```

The runner expects `timesfm` and its dependencies to already be installed in that Python environment. Official repo: [google-research/timesfm](https://github.com/google-research/timesfm)

## Output

The JSON summary includes:

- overall WAPE, MAE, and RMSE by model
- mean window WAPE across forecast cutoffs
- next-day and next-3-day WAPE
- TimesFM runner status and any skip/error reason

The dataset CSV includes daily cases plus production-job and production-work-order counts so we can later test TimesFM with richer covariates if the raw univariate run looks promising.
