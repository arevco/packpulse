# Reporting Module Scope

## Goal

Create a first-class `Reporting` module in PackPulse that recreates the customer-facing daily report packet currently sent outside the product.

This scope is based on the attached workbook:

- `/Users/aj/Downloads/MONSTER ENERGY COMPANY 07-07-2026 EOD.xlsx`

## Workbook Audit

### Observed workbook structure

- `Inbounds`
  - range: `A1:F43`
  - flat ledger
  - columns: `Received at`, `STO#/TO#/PO#`, `Item code`, `Item description`, `Lot code`, `Qty Received`
- `Outbounds`
  - range: `A1:F55`
  - flat ledger
  - columns: `Date Shipped`, `PO#`, `Part Number`, `Description`, `Vendor Lot Code`, `Quantity`
- `114718 - PO 450059516`
- `118354 - PO 450059516`
- `114634 - PO 450060323`
- `114715 - PO 450059516`
  - each is a consumption sheet
  - columns: `Date`, `Item`, `Description`, `Lot Code`, `Expiry Date`, `Quantity Consumed`
  - rows are grouped by date
  - blank separator rows split date groups
  - sheets are named by finished-good item code plus PO number

### Product implications from the sample

- The workbook is a packet of operational tabs, not a chart-heavy executive report.
- The workbook filename is a single EOD date, but the transactional tabs span `2026-07-01` through `2026-07-07`.
- The most reasonable v1 interpretation is:
  - inventory is an as-of snapshot at end date
  - inbounds, outbounds, production, and consumption are rolling-window activity tabs
- The sample workbook does **not** include `Inventory` or `Production` tabs even though the business request says daily reporting includes them.
  - v1 should still add those sections in PackPulse.

## Data Mapping In PackPulse

### Inventory

- source report: `inventory_snapshot`
- current repo support:
  - [api/nulogy/inventory-rich.js](/Users/aj/Documents/New project/api/nulogy/inventory-rich.js)
  - Nulogy artifact storage tables and latest-report APIs

### Inbounds

- source report: `receipt_item`
- workbook shape aligns closely to receipt-level rows:
  - `received_at`
  - `receive_order_code`
  - `item_code`
  - `item_description`
  - `lot_code`
  - quantity field derived from receipt quantity columns

### Outbounds

- source report: `shipment_item`
- workbook shape aligns to shipment-item rows:
  - `actual_ship_at`
  - shipment or ship-order identifier
  - `item_code`
  - `item_description`
  - `lot_code`
  - quantity field derived from shipment quantity columns

### Production

- source report: `production`
- new v1 PackPulse reporting tab should be built from:
  - `produced_at`
  - `purchase_order_number`
  - `project_code`
  - `item_code`
  - `item_description`
  - `lot_code`
  - `units_produced`

### Consumption

- source report: `consumption_by_lot`
- workbook grouping needs to be synthesized from report fields:
  - sheet grouping: finished-good item code + PO / reference heuristic
  - visible row fields:
    - `consumed_at` or `consumed_date`
    - `subcomponent_item_code`
    - subcomponent description
    - `subcomponent_lot_code`
    - `subcomponent_expiry_date`
    - `subcomponent_quantity_consumed`
  - workbook-style finished-good summary rows should be synthesized from:
    - `finished_good_item_code`
    - `finished_good_lot_code`
    - `finished_good_expiry_date`
    - `finished_good_quantity_produced`

## V1 Scope

### User-facing module

- Add `Reporting` as a top-level PackPulse view.
- Add filters for:
  - `As of date`
  - rolling window days, default `7`
  - customer
- Show section tabs for:
  - `Inventory`
  - `Inbounds`
  - `Outbounds`
  - `Production`
  - `Consumption`
- Show section-level summary metrics and report freshness.

### Export behavior

- Add `Download Excel Packet`
  - workbook tabs should mirror the operational packet model
  - one tab each for inventory, inbounds, outbounds, production
  - one tab per consumption group
- Add `Download CSV` for the active visible section.

### Data source strategy

- v1 should read from stored Nulogy artifacts in Supabase, not run fresh live Nulogy report jobs from the UI.
- Historical report selection should prefer the latest successful artifact run whose generated date is on or before the selected `As of date`.
- Inventory uses the selected as-of artifact snapshot.
- Transaction sections filter rows to the selected rolling window.

## Known Gaps And Decisions

- The sample workbook does not define the desired `Inventory` or `Production` tab layout.
  - v1 will use flat operational tables consistent with the rest of the packet.
- `consumption_by_lot` docs do not clearly expose a finished-good description field.
  - v1 should backfill descriptions from other report datasets when available.
- Consumption sheet PO naming must be heuristic-driven.
  - v1 should scan job and project reference fields for PO-like values.
- If only preview rows exist for an artifact and raw CSV is unavailable, the module should render explicit incomplete-data guidance instead of pretending the packet is complete.

## Acceptance Criteria

- Users can open `Reporting` from the main nav.
- Users can select an end date and customer and see packet sections in-app.
- Users can export an Excel packet that recreates the workbook packet structure.
- Missing or stale sections are called out explicitly.
- The feature uses existing PackPulse/Nulogy artifact plumbing instead of a separate reporting datastore.
