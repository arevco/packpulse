# OSHA Log Implementation Spec

Last updated: 2026-07-08

Companion planning doc:

- [docs/OSHA-Log-Feature-Plan.md](/Users/aj/Documents/New%20project/docs/OSHA-Log-Feature-Plan.md)

## Objective

Translate the OSHA Log feature plan into implementation-ready PackPulse architecture:

- Supabase schema
- API route set
- frontend view structure
- deterministic rules boundaries
- MVP slice order

This document is still product and engineering planning. It is intended to reduce ambiguity before coding.

## MVP Outcome

After MVP, a PackPulse user should be able to:

- create and review incident intakes
- classify a case deterministically for OSHA recordkeeping
- maintain a site-scoped OSHA `300` log
- complete `301` detail for recordable cases
- generate a `300A` annual summary
- track `8 hour` and `24 hour` severe-report deadlines
- export year-end or case-level data

## Non-Goals For MVP

- direct OSHA or state-plan submission
- full corrective action management suite
- near-miss program
- training / certification workflows
- workers' comp administration
- broad EHS platform consolidation

## Product Placement

Add a new top-level lazy-loaded view:

- `Safety`

Internal `Safety` tabs:

1. `Inbox`
2. `OSHA Log`
3. `Annual Summary`
4. `Analytics`

Recommended permalink keys:

- `view=safety`
- `sf_tab=inbox|log|annual|analytics`
- `sf_year=YYYY`
- `sf_est=<uuid>`
- `sf_status=<value>`
- `sf_q=<search>`

This keeps the feature aligned with the existing `PackPulse.jsx` permalink pattern.

## Access Model

PackPulse does not currently expose a full RBAC layer in the repo, so MVP should implement role checks in server routes first and keep browser queries server-mediated only.

### Suggested roles

- `safety_admin`
- `safety_editor`
- `safety_viewer`
- `ops_viewer`

### Intended permissions

- `safety_admin`
  - full CRUD on establishments, cases, annual summaries, exports, and private detail
- `safety_editor`
  - create and update cases, view private detail, update annual inputs, mark severe reports filed
- `safety_viewer`
  - read log, annual summary, analytics, and private detail if policy allows
- `ops_viewer`
  - de-identified analytics only

### MVP fallback if roles are not yet available

- restrict all safety routes to authenticated users
- keep private fields in a separate table
- only return private fields from dedicated case-detail routes

## Data Model

Primary schema file:

- [docs/supabase-safety-osha.sql](/Users/aj/Documents/New%20project/docs/supabase-safety-osha.sql)

### Tables

- `safety_establishments`
  - site-scoped establishments for separate OSHA logs and annual summaries
- `safety_cases`
  - shared, mostly de-identified incident and OSHA case record
- `safety_case_private`
  - PII and medical-detail fields kept separate from the shared log row
- `safety_case_updates`
  - follow-up updates for lost time, restrictions, notes, and audit history
- `safety_annual_summaries`
  - year + establishment inputs and certification snapshot
- `safety_attachments`
  - attachment metadata for photos, PDFs, and supporting files

### Design choices

- Keep one `safety_cases` table for both recordable and non-recordable intakes.
- Separate private detail from the shared case row.
- Store classification answers and form snapshots in `jsonb` so the deterministic engine can evolve without table churn.
- Use `incident_date` as the anchor and derive `osha_year` as a generated column.
- Persist annual summary inputs even though totals are derived live.

## Deterministic Logic Boundaries

Put OSHA calculation and classification logic in shared server helpers, not in React components and not in AI prompts.

### Recommended helper files

- `api/safety/_common.js`
- `api/safety/_recordability.js`
- `api/safety/_annual-summary.js`
- `api/safety/_analytics.js`
- `api/safety/_permissions.js`

### Deterministic responsibilities

- work-relatedness decision support scoring and final rule evaluation
- new case vs recurrence evaluation storage
- recordability classification
- severe-report eligibility clock
- `300A` totals
- DART and total recordable case rate
- export payload mapping

### AI-allowed responsibilities

- rewrite narrative text for clarity
- draft de-identified monthly safety briefs
- point out missing intake fields

AI should never decide whether a case is recordable.

## Frontend Architecture

### New view

- `src/views/SafetyView.jsx`

### Suggested component tree

- `src/components/safety/SafetyHeader.jsx`
- `src/components/safety/SafetySummaryCards.jsx`
- `src/components/safety/SafetyInboxTable.jsx`
- `src/components/safety/IncidentReportWizard.jsx`
- `src/components/safety/OshaLogTable.jsx`
- `src/components/safety/CaseDetailDrawer.jsx`
- `src/components/safety/AnnualSummaryPanel.jsx`
- `src/components/safety/SafetyAnalyticsPanel.jsx`

### React Query keys

- `["safety-summary", year, establishmentId]`
- `["safety-cases", filters]`
- `["safety-case", caseId]`
- `["safety-annual-summary", year, establishmentId]`
- `["safety-analytics", year, establishmentId]`
- `["safety-establishments"]`

### Render strategy

- load summary cards first
- paginate case lists
- fetch case detail only when a row opens
- lazy-load analytics charts after first render

This follows the repo's summary-first and detail-later guidance.

## UX Flow Details

### `Inbox`

Entry point for daily safety work.

Cards:

- open drafts
- review due
- severe report due now
- open lost-time follow-up

Table columns:

- workflow status
- incident date
- location
- department / area
- probable severity
- recordability status
- severe-report status
- owner
- updated at

Primary CTA:

- `Report incident`

### `IncidentReportWizard`

#### Step 1: Quick Capture

- establishment
- incident date / time
- employee identity picker or manual entry
- supervisor / reporter
- location / line / department
- short description

#### Step 2: Classification

- work-relatedness
- new case
- treatment beyond first aid
- days away / restriction / transfer
- ER / overnight hospitalization
- fatality / amputation / eye loss
- injury vs illness category

#### Step 3: OSHA Detail

- what employee was doing
- what happened
- body part / illness detail
- object / substance
- physician / facility
- privacy case flag

#### Step 4: Follow-Up

- owner
- next review date
- notes
- severe report confirmation fields when applicable

### `OSHA Log`

Designed for year-based filtering and audit support.

Controls:

- year
- establishment
- workflow status
- recordability status
- privacy case
- severe-report status
- search

Actions:

- open row detail
- export `300`
- export `301` packet
- print case

### `Annual Summary`

Inputs:

- annual average employees
- total hours worked
- executive certifier name, title, phone

Derived:

- live `300A` totals
- readiness checklist
- posting status

Actions:

- save inputs
- certify summary
- print `300A`
- export ITA CSV

### `Analytics`

De-identified by default.

MVP charts:

- recordables by month
- recordables by department / area
- recordables by shift
- DART trend
- total recordable case rate trend

## API Surface

Follow the repo's existing route style:

- authenticated via `pp_session`
- `GET` for read
- `POST` with `action` for write when helpful
- graceful missing-table status for unprovisioned environments

### `/api/safety/establishments`

Methods:

- `GET`
- `POST`

`GET` response:

```json
{
  "rows": [
    {
      "id": "uuid",
      "name": "PackPulse Main Plant",
      "state": "NC",
      "naics_code": "312111",
      "active": true
    }
  ]
}
```

`POST` actions:

- `upsert_establishment`
- `archive_establishment`

### `/api/safety/summary`

Method:

- `GET`

Query:

- `year=YYYY`
- `establishmentId=<uuid>`

Response:

```json
{
  "cards": {
    "openDrafts": 2,
    "reviewDue": 4,
    "severeDueNow": 1,
    "openLostTime": 3
  },
  "queue": {
    "total": 9
  }
}
```

### `/api/safety/cases`

Methods:

- `GET`
- `POST`

`GET` query:

- `year=YYYY`
- `establishmentId=<uuid>`
- `workflowStatus?=draft|submitted|under_review|recorded|closed`
- `recordabilityStatus?=pending|recordable|non_recordable`
- `severeReportStatus?=not_required|candidate|required|reported|overdue`
- `q?=<text>`
- `page?=<n>`
- `pageSize?=<n>`

`GET` response:

```json
{
  "rows": [],
  "page": 1,
  "pageSize": 25,
  "total": 0
}
```

`POST` actions:

- `create_case`
- `update_case`
- `set_recordability`
- `mark_severe_reported`
- `close_case`

### `/api/safety/case`

Method:

- `GET`

Query:

- `id=<uuid>`
- `includePrivate=1`

Response should return:

- shared case row
- private row only when permitted
- updates
- attachments

### `/api/safety/case-updates`

Methods:

- `GET`
- `POST`

`POST` actions:

- `add_update`
- `set_days_totals`
- `append_note`

### `/api/safety/annual-summary`

Methods:

- `GET`
- `POST`

`GET` query:

- `year=YYYY`
- `establishmentId=<uuid>`

Response:

```json
{
  "inputs": {
    "avgEmployees": 0,
    "hoursWorked": 0
  },
  "totals": {},
  "readiness": {
    "hasHoursWorked": false,
    "hasAvgEmployees": false,
    "hasExecutive": false
  }
}
```

`POST` actions:

- `save_inputs`
- `certify_summary`
- `mark_posted`

### `/api/safety/analytics`

Method:

- `GET`

Query:

- `year=YYYY`
- `establishmentId=<uuid>`

Return de-identified aggregates only.

### `/api/safety/export`

Method:

- `GET`

Query:

- `type=300|300a|301|ita_csv`
- `year=YYYY`
- `establishmentId=<uuid>`
- `caseId?=<uuid>`

MVP can return structured JSON for client-side print/export first, then add downloadable files afterward.

## Proposed Server File Layout

- `api/safety/_common.js`
- `api/safety/_permissions.js`
- `api/safety/_recordability.js`
- `api/safety/_annual-summary.js`
- `api/safety/_analytics.js`
- `api/safety/establishments.js`
- `api/safety/summary.js`
- `api/safety/cases.js`
- `api/safety/case.js`
- `api/safety/case-updates.js`
- `api/safety/annual-summary.js`
- `api/safety/analytics.js`
- `api/safety/export.js`

## MVP Build Slices

### Slice 1: Schema and read plumbing

- run safety SQL migration
- add establishments route
- add summary route
- add cases list route

Acceptance:

- authenticated user can load empty safety shell without errors

### Slice 2: Safety shell and Inbox

- add `Safety` nav item and lazy import in `src/PackPulse.jsx`
- add `SafetyView.jsx`
- render summary cards and Inbox table

Acceptance:

- user can navigate to `view=safety`
- empty state is clear when no schema or no data exists

### Slice 3: Incident wizard

- build create/update flow
- persist draft cases
- support private detail row creation

Acceptance:

- user can create draft incident and reopen it

### Slice 4: Deterministic classification

- add recordability rules helper
- add severe-report clock helper
- persist classification answer snapshots

Acceptance:

- classifying the same answers always yields the same result

### Slice 5: OSHA Log and case detail

- log table
- row detail drawer
- update history

Acceptance:

- recordable cases display in log view with correct annual filtering

### Slice 6: Annual Summary

- derive `300A` totals
- save hours worked / average employees
- certify summary

Acceptance:

- `300A` totals match the filtered year and establishment deterministically

### Slice 7: Analytics and export

- de-identified charts
- export payload mapping

Acceptance:

- ops users can see trend data without private detail leakage

## Edge Cases To Handle

- missing safety tables in older environments
- privacy-concern cases
- incident becomes recordable later
- days away totals change after initial record
- severe report required but filing not yet confirmed
- multiple establishments under one site
- state-plan routing differences

## Recommended Immediate Coding Order

If implementation starts next, begin here:

1. `docs/supabase-safety-osha.sql`
2. `api/safety/_common.js`
3. `api/safety/establishments.js`
4. `api/safety/summary.js`
5. `api/safety/cases.js`
6. `src/views/SafetyView.jsx`
7. `src/PackPulse.jsx` nav + permalink wiring

## Assumptions

- PackPulse continues to use Supabase service-role server routes for safety data.
- There is no existing org-wide RBAC system in this repo yet.
- Attachments can be deferred or stored via Supabase Storage in a later slice if upload plumbing is not already available.
- OSHA source guidance referenced here was reviewed on `2026-07-08`.
