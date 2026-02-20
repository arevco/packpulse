# PackPulse V1 Roadmap (6 Weeks)

## Product Goal
Answer in under 30 seconds:
- Are we on track for today/this shift?
- What will block output next?
- What are the top actions to take now?

## Personas
- Plant Supervisor
- Production Planner
- Supply Chain Manager
- VP Operations

## Week-by-Week Plan

### Week 1: Data Foundation + Reliability
Objectives:
- Build resilient Nulogy Reports API runner flow (`POST` run, poll `Location`, fetch CSV).
- Enforce sequential report execution and polling backoff to avoid HTTP 429.
- Standardize schema mapping and feed health checks.

Scope:
- Reports: `production`, `project_status`, `job_productivity`, `inventory_snapshot`, `receipt_item`, `shipment_item`, `reject`, `job_downtime`.
- Add feed telemetry: last success time, row counts, error counts.

Definition of Done:
- Stable automated pulls for all core reports.
- Data health panel shows stale/missing feed alerts.

### Week 2: Command Center MVP (Supervisor + Planner)
Objectives:
- Launch Overview v2 command center.
- Add role presets for Supervisor and Planner.

Scope:
- Shift status: On Track / At Risk / Off Track.
- Plan vs projected output cards.
- Units at risk (48h), top constraint, action queue.
- One-click drill-down into Work Orders/Critical Items.

Definition of Done:
- Supervisors can identify top 3 risks and actions in under 30 seconds.

### Week 3: Constraint + Service Risk
Objectives:
- Add impact-ranked constraints and customer exception intelligence.

Scope:
- Constraint Ladder: Material Shortage, Late WOs, Capacity Gap, Inbound Timing Conflict, No BOM.
- Customer Exceptions (risk-only): affected WOs, units at risk, nearest due date, severity.
- What changed since yesterday panel.

Definition of Done:
- Risk is prioritized by impact units and affected orders.
- Customer service risk is visible without scanning full order lists.

### Week 4: Logistics + Dock Alignment
Objectives:
- Tighten inbound/outbound visibility with OpenDock + Nulogy receipts/shipments.

Scope:
- 48h flow strip: due units vs inbound units.
- Collision alerts: due before inbound arrival.
- Carrier/dock reliability and appointment status integration.

Definition of Done:
- Supply chain can identify inbound timing conflicts in one view.

### Week 5: Quality + Downtime Intelligence
Objectives:
- Add quality and downtime as first-class constraints.

Scope:
- Reject trend by SKU/line/reason.
- Downtime Pareto by reason/line/line leader.
- Tie quality/downtime impact to output risk (units/hours).

Definition of Done:
- Teams can see where quality/downtime is reducing attainable output.

### Week 6: Exec Layer + Hardening
Objectives:
- Deliver VP Ops view and production hardening.

Scope:
- VP Ops preset: attainment trend, confidence, major deltas.
- Role-based visibility and export-ready summary.
- Operational guardrails: retries, backoff, alert thresholds, audit logging.

Definition of Done:
- Weekly executive readout generated directly from dashboard KPIs.
- System runs reliably with configurable thresholds and alerts.

## Must-Have V1 KPIs
- Plan attainment %
- Units produced today
- Units at risk (next 48h)
- At-risk WOs count
- Late WO count
- Top constraint (impact units)
- Reject %
- Downtime minutes
- Forecast confidence score
- Data freshness by source

## Role-Based Launch Priority
1. Supervisor (daily execution)
2. Planner (sequence + due risk)
3. Supply Chain (materials + dock risk)
4. VP Ops (trend + confidence + impact)

## Data Sources and Report Codes (from Nulogy Reports API docs)
- Production: `production`
- Work Order Status: `project_status`
- Job Productivity: `job_productivity`
- Job Downtime: `job_downtime`
- Inventory Snapshot: `inventory_snapshot`
- Receipt Item: `receipt_item`
- Shipment Item: `shipment_item`
- Reject: `reject`
- Reject Percentage: `reject_percentage`
- Consumption by Lot: `consumption_by_lot`
- Reconciliation: `reconciliation`
- Labor: `labor`

## API Execution Notes
- Use async report run pattern (`POST` create -> poll status URL -> download CSV).
- Run reports sequentially; avoid concurrent requests.
- Use poll backoff to avoid `429 Too Many Requests`.
- Support `site_uuid` for multi-site users.
- Persist data snapshots for day-over-day deltas.

## V1 Success Criteria
- Users can answer the 3 core questions in under 30 seconds.
- Every summary card has 1-click drill-down.
- Report ingestion is reliable with visible data freshness and errors.
