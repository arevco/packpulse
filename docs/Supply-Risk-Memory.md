# Supply Risk Memory

## Why This Exists
This document stores the working memory for PackPulse's Supply Risk feature so future builds do not have to reconstruct the history from chat threads, screenshots, and scattered commits.

Use this as the first reference before changing Supply Risk UX, matching logic, or Nulogy Receive Orders sync behavior.

## Core Team Jobs
Supply Risk exists to help RevCopack answer three operational questions:

1. What can we run next, and by when?
2. What is short and not yet scheduled in Receive Orders?
3. What is already on Receive Orders, but not scheduled on OpenDock yet?

Those outputs support three concrete workflows:

1. Production planning: understand what work orders unlock next and what labor / line planning is possible.
2. Vendor follow-up: export materials that are still short because Receive Orders do not yet cover the gap.
3. Trucking / dock follow-up: export Receive Orders that exist but still need an OpenDock appointment.

## Product Principles
- Spreadsheet-first UX is preferred over card-heavy or app-like drilldown UX.
- Users need all the data to remain surfaceable, but the default experience should be easier to scan.
- Receive Orders are the primary inbound material truth.
- OpenDock is the appointment / schedule truth.
- Work Orders plus Inventory determine whether a shortage actually matters.
- Deterministic math should drive risk calculations. AI should summarize, not calculate authoritative quantities.

## Current Mental Model
Supply Risk should be understood as one workflow, not three separate reports:

1. Work Orders create demand.
2. Inventory covers some of that demand now.
3. Remaining shortages are compared against open Receive Orders.
4. OpenDock appointments tell us whether those inbound loads are scheduled yet.
5. The UI presents the operational actions that follow from that comparison.

## Current UX Shape
Current entry point:
- [src/views/SupplyRiskView.jsx](/Users/aj/Documents/New project/src/views/SupplyRiskView.jsx)

Current main UX:
- [src/views/SupplyRiskWorkbench.jsx](/Users/aj/Documents/New project/src/views/SupplyRiskWorkbench.jsx)

The current Supply Risk page is organized into three spreadsheet-style boards with shared filtering:

### Run Next
Purpose:
- Show blocked work orders sorted by when inbound should unlock them.

Primary questions answered:
- Which work orders can run soon?
- What is blocking them?
- Which Receive Orders are expected to unblock them?

### Vendor Gaps
Purpose:
- Show materials still short because Receive Orders do not cover the full gap.

Primary questions answered:
- Which shortages still need vendor action?
- How much is covered already?
- What still needs to be placed, expedited, or confirmed?

### Dock Follow-up
Purpose:
- Show Receive Orders that exist but do not yet have an OpenDock appointment.

Primary questions answered:
- Which inbound loads need appointment follow-up?
- What quantity is at risk of arriving without dock scheduling?
- Which work orders would be affected if those loads slip?

## Current Dropdown UX
The board rows use inline dropdown expansion, not a below-board detail panel.

Recent UX decisions:
- Row details expand inline beneath the clicked row.
- Detail content was condensed to reduce vertical sprawl.
- Large stat cards were replaced by tighter metric strips.
- Supporting detail tables were reduced to fewer columns and denser layouts.

If future contributors expand the row details again, keep the scan speed of the board as the priority.

## Data Sources and Trust Order
Supply Risk depends on four core data sources:

1. Work Orders with remaining units and component requirements
2. Inventory
3. OpenDock scheduled inbound appointments
4. Receive Orders for upcoming inbound supply

Repo trust order from AGENTS.md:

1. Deterministic server-side queries / calculations
2. Supabase shared snapshot / shared state
3. Client-local state / cache
4. Model-generated narrative

## Current Architecture
### UI Shell
- [src/views/SupplyRiskView.jsx](/Users/aj/Documents/New project/src/views/SupplyRiskView.jsx)
- [src/views/SupplyRiskWorkbench.jsx](/Users/aj/Documents/New project/src/views/SupplyRiskWorkbench.jsx)

### Analysis Wiring
- [src/hooks/useAnalysis.js](/Users/aj/Documents/New project/src/hooks/useAnalysis.js)
- [src/PackPulse.jsx](/Users/aj/Documents/New project/src/PackPulse.jsx)

### Supply Risk Engine
- [src/lib/supplyRiskEngine.js](/Users/aj/Documents/New project/src/lib/supplyRiskEngine.js)

### Inbound Normalization
- [src/lib/inboundData.js](/Users/aj/Documents/New project/src/lib/inboundData.js)

### Receive Orders Sync
- [src/NulogySync.jsx](/Users/aj/Documents/New project/src/NulogySync.jsx)
- [api/nulogy/receive-orders-rich.js](/Users/aj/Documents/New project/api/nulogy/receive-orders-rich.js)

## Important Implementation Notes
### Legacy Naming
Inbound data is still stored in `edrData` / `edrTimestamp` in app state for backward compatibility, even though Supply Risk is now driven by Receive Orders.

Important references:
- [src/PackPulse.jsx](/Users/aj/Documents/New project/src/PackPulse.jsx)
- [src/hooks/useAnalysis.js](/Users/aj/Documents/New project/src/hooks/useAnalysis.js)

Do not assume `edrData` means legacy EDR anymore. In current Supply Risk builds, it often means normalized Receive Orders.

### Receive Orders Normalization
Inbound rows are normalized in:
- [src/lib/inboundData.js](/Users/aj/Documents/New project/src/lib/inboundData.js)

Key rules:
- Receive Orders are detected by source hint and loose column matching.
- Closed Receive Orders are dropped when `Received` is yes / true / 1.
- `Order Quantity` prefers expected quantity first.
- Actual quantity is only a fallback if expected quantity is missing.
- Date aliases include expected delivery, expected ship, actual ship, and RO date.

### Supply Risk Engine Responsibilities
The engine in [src/lib/supplyRiskEngine.js](/Users/aj/Documents/New project/src/lib/supplyRiskEngine.js) is responsible for:

1. Normalizing inbound lines from Receive Orders
2. Normalizing dock appointments from OpenDock
3. Matching inbound lines to appointments
4. Building material coverage
5. Building the inbound load board
6. Building unlock timeline outputs

Current horizon:
- Supply Risk inbound horizon defaults to 60 days

### Matching Rules
Matching is based on a combination of:
- PO / Receive Order code
- Reference-like fields
- SKU linkage back to shortage materials and affected work orders

Conceptually:
- Receive Orders tell us what material is inbound
- OpenDock tells us whether that inbound has an appointment
- The engine merges them into a shared operational model

## Current Sync Behavior
Receive Orders are currently pulled through:
- [api/nulogy/receive-orders-rich.js](/Users/aj/Documents/New project/api/nulogy/receive-orders-rich.js)

This route exists because the generic report path proved unreliable for open Receive Orders.

Important sync lessons from this rebuild:
- Nulogy sometimes returned closed-only Receive Orders datasets through the older path.
- Supply Risk needs audit diagnostics for Receive Orders after sync.
- Freshness should reflect sync timestamps, not inbound shipment dates.
- Successful syncs should update freshness even if the dataset is unchanged.

## Audit / Debugging Expectations
When Supply Risk appears wrong, check these first:

1. Did Receive Orders actually sync open lines?
2. Did `edrData` update, or was it guarded because the source was closed-only?
3. Is the issue in inbound normalization or only in UI rendering?
4. Does OpenDock have an appointment, and does the engine match it to the same Receive Order?

Useful files:
- [src/NulogySync.jsx](/Users/aj/Documents/New project/src/NulogySync.jsx)
- [src/PackPulse.jsx](/Users/aj/Documents/New project/src/PackPulse.jsx)
- [src/lib/inboundData.js](/Users/aj/Documents/New project/src/lib/inboundData.js)
- [src/lib/supplyRiskEngine.js](/Users/aj/Documents/New project/src/lib/supplyRiskEngine.js)

## UX Lessons Learned
### What Did Not Work Well
- Three disconnected interfaces for the same workflow
- Repeated KPI summaries and duplicate data
- Very tall detail areas that turned each row into a second page
- Hiding key operational context behind separate sections instead of keeping it near the relevant row

### What Users Actually Needed
- One consistent spreadsheet pattern
- All relevant data still available
- Easy exports for each operational job
- Fast scan of many rows
- Inline drilldown for row-level context

### Current UX Direction
Keep the main board dense and operational. Let row detail be available, but compact.

If future redesigns drift back toward card-heavy layouts or multi-section storytelling, re-check against the team's actual use case: fast operations review and outreach.

## Known Product Truths
- Receive Orders should be primary in the UI.
- OpenDock should supplement Receive Orders with schedule truth.
- Expected quantity is the primary inbound quantity used by Supply Risk.
- Undated Receive Orders can still matter for coverage and should not be silently dropped if they are valid open inbound.
- A matched OpenDock row with zero inbound quantity usually indicates a data or sync problem, not a valid business state.

## Important Commits in the Rebuild History
These commits capture the major steps in the Supply Risk / Receive Orders evolution:

- `976446e` Migrate inbound sync to Receive Orders
- `6b2dc90` Count undated receive orders in supply risk
- `dfb0c8c` Make receive orders blocking and extend supply risk horizon
- `966c5ca` Broaden receive orders sync and add audit diagnostics
- `7949c99` Fix receive orders supply risk ingestion
- `e330565` Add receive orders sync diagnostics and guardrails
- `0d68af9` Clarify inbound receive order sync status
- `718a647` Rebuild supply risk around receive orders
- `281b928` Switch receive orders sync to direct export
- `e388ad0` Fix supply risk inbound freshness state
- `accb82b` Restore receive orders sync and prioritize inbound loads
- `28f340c` Consolidate supply risk into one workflow
- `15c515b` Add supply risk unlock timeline
- `bc65e4f` Redesign supply risk as action workbench
- `a1fa7f9` Refocus supply risk around operations workflows
- `c4f5866` Move supply risk details into inline row dropdowns
- `5eaaa04` Condense supply risk row detail dropdowns

Use `git show <commit>` when you need the exact rationale or code shape for one of these transitions.

## Future Build Priorities
If Supply Risk gets another meaningful iteration, likely next-value areas are:

1. Better vendor-ready CSV content and default filters
2. Better dock follow-up CSV content and trucking-focused terminology
3. Stronger run-next prioritization tied to committed net output and labor context
4. Saved filters / saved board states for planner workflows
5. Faster large-table scanning through virtualization or pagination if row counts grow further

## Change Checklist for Future Contributors
Before shipping Supply Risk changes:

1. Run `npm run build`
2. Verify the three operational boards still answer the team jobs above
3. Verify Receive Orders sync still produces open inbound rows
4. Verify freshness badges reflect actual sync state
5. Verify exports for:
   - Run Next
   - Vendor Gaps
   - Dock Follow-up
6. Verify inline row dropdowns stay compact enough for scanning

## How To Update This File
Whenever a meaningful Supply Risk change lands, update this document with:

- the new user-facing behavior
- the architectural change
- any known caveat
- the commit hash if the change was material

This file is intended to be durable project memory, not a one-time spec.
