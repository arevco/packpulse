# Data Dictionary

## Operations KPIs
- `Actual Cases`
  - Definition: sum of produced units in selected window.
  - Source: `production_events.units_produced`
- `Plan Cases` / baseline
  - Definition: configured baseline/target for comparison.
  - Source: ops config + derived logic in Operations view.
- `Variance`
  - Formula: `Actual - Plan`
- `Shift 1` / `Shift 2` totals
  - Definition: production grouped by ET shift windows.
  - Shift 1: 7:00-14:59 ET
  - Shift 2: 15:00-22:59 ET

## Work Orders KPIs
- `Order Qty`
  - Source: work order expected units.
- `Produced`
  - Source: work order produced units.
- `Remaining`
  - Formula: explicit remaining field; fallback `max(0, Order Qty - Produced)`.
- `Ready %`
  - Definition: component readiness from BOM + inventory.
- `Make`
  - Definition: max units possible from current component availability.
- `Net`
  - Definition: make adjusted for shared-component commitments.

## Supply Risk KPIs
- `At-Risk SKU`
  - Definition: component/SKU with shortage impact on active WOs.
- `Units at Risk`
  - Definition: aggregate WO units impacted by shortage constraints.
- `Missing`
  - Definition: no inbound signal found for shortage.
- `Unscheduled`
  - Definition: inbound exists but no confirmed schedule linkage.
- `Partially Covered`
  - Definition: inbound covers only part of shortage.

## Inbound / Delivery
- `OpenDock Scheduled`
  - Definition: appointments from OpenDock in selected window.
- `EDR Match`
  - Definition: inbound rows reconciled between EDR and OpenDock keys.

## AI Metrics
- `productionTodayCases`
  - Definition: sum of today’s ET production rows.
- `lastWeekCases`, `thisWeekCases`
  - Definition: deterministic aggregates from shift/day rows.
- `marchDailyTargetRemaining`
  - Formula: `ceil(March remaining units / remaining business days)`.
