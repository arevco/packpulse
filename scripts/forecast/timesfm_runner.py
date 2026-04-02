#!/usr/bin/env python3

import argparse
import json
import sys
from collections import defaultdict


def main():
  parser = argparse.ArgumentParser()
  parser.add_argument("--input", required=True)
  parser.add_argument("--output", required=True)
  args = parser.parse_args()

  try:
    with open(args.input, "r", encoding="utf-8") as handle:
      payload = json.load(handle)
  except Exception as exc:
    write_output(args.output, {"error": "Could not read TimesFM input: %s" % exc})
    raise

  try:
    import numpy as np
    import timesfm
    try:
      import torch
    except Exception:
      torch = None
  except Exception as exc:
    write_output(args.output, {"error": "TimesFM dependencies unavailable: %s" % exc})
    return

  tasks = payload.get("tasks") or []
  if not tasks:
    write_output(args.output, {"predictions": [], "model": "", "python_version": sys.version})
    return

  max_context = max(len(task.get("context") or []) for task in tasks)
  max_horizon = max(int(task.get("horizon") or 0) for task in tasks)

  if torch is not None and hasattr(torch, "set_float32_matmul_precision"):
    torch.set_float32_matmul_precision("high")

  try:
    model = timesfm.TimesFM_2p5_200M_torch.from_pretrained("google/timesfm-2.5-200m-pytorch")
    model.compile(
      timesfm.ForecastConfig(
        max_context=max(32, int(max_context)),
        max_horizon=max(1, int(max_horizon)),
        normalize_inputs=True,
        use_continuous_quantile_head=True,
        force_flip_invariance=True,
        infer_is_positive=True,
        fix_quantile_crossing=True,
      )
    )
  except Exception as exc:
    write_output(args.output, {"error": "Could not initialize TimesFM: %s" % exc})
    return

  predictions = []
  tasks_by_horizon = defaultdict(list)
  for task in tasks:
    tasks_by_horizon[int(task.get("horizon") or 0)].append(task)

  try:
    for horizon, batch in tasks_by_horizon.items():
      contexts = [np.asarray(task.get("context") or [], dtype=float) for task in batch]
      point_forecast, _ = model.forecast(horizon=horizon, inputs=contexts)
      for task, forecast in zip(batch, point_forecast):
        predictions.append(
          {
            "id": task.get("id"),
            "futureDays": task.get("futureDays") or [],
            "point": [max(0.0, float(value)) for value in forecast.tolist()],
          }
        )
  except Exception as exc:
    write_output(args.output, {"error": "TimesFM forecast failed: %s" % exc})
    return

  write_output(
    args.output,
    {
      "model": "google/timesfm-2.5-200m-pytorch",
      "python_version": sys.version,
      "predictions": predictions,
    },
  )


def write_output(path, payload):
  with open(path, "w", encoding="utf-8") as handle:
    json.dump(payload, handle, indent=2)
    handle.write("\n")


if __name__ == "__main__":
  main()
