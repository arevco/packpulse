# OSHA Log Feature Plan

Last updated: 2026-07-08

## Goal

Design a PackPulse-native OSHA recordkeeping feature that helps a plant or warehouse team:

- capture incidents quickly
- determine whether a case is OSHA-recordable using deterministic rules
- maintain OSHA Forms `300`, `300A`, and `301`
- track severe-incident reporting deadlines
- produce audit-ready exports and annual summaries
- connect safety trends back to operations without exposing sensitive case detail broadly

This plan is for product and UX planning before implementation. It is not legal advice. State-plan jurisdictions can differ from federal OSHA, so the product should support state-specific routing and instructions.

## Recommendation

Ship this as a new top-level PackPulse view: `Safety`.

Why:

- OSHA logging is a distinct workflow from production analytics.
- It has different access-control needs because it contains medical and personally identifiable information.
- The primary CTA is urgent and action-oriented: `Report incident`.
- Annual summary, audit, and severe-reporting flows deserve a persistent home rather than being buried under `Operations`.

If the team wants the smallest possible launch, the same view can technically start as an `Operations` sub-tab. My recommendation is still a top-level `Safety` tab with lazy loading and a compact initial scope.

## What OSHA Requires

The feature should be built around official OSHA recordkeeping workflows, not around a generic incident tracker.

### Core recordkeeping requirements

- OSHA uses three core forms: `300` log, `300A` annual summary, and `301` incident report.
- Employers must decide whether a case is recordable within `7 calendar days` after receiving information about it.
- The `300A` summary must be posted from `February 1` through `April 30` of the year following the covered year.
- The `300` log, `300A` summary, and `301` details must be retained for `5 years`.
- Separate logs are kept per establishment.
- Equivalent forms are allowed, but they must contain the same information as the OSHA forms.

### Recordability basics the product should support

The product should drive users through deterministic checks for:

- work-relatedness
- new case vs recurrence
- severity / outcome
- injury vs illness category

Recordable cases generally include work-related cases involving:

- death
- loss of consciousness
- days away from work
- restricted work or job transfer
- medical treatment beyond first aid
- certain significant diagnoses and special criteria cases

### Severe incident reporting

All employers under OSHA jurisdiction must report:

- fatalities within `8 hours`
- in-patient hospitalization, amputation, or loss of an eye within `24 hours`

This is separate from routine log maintenance.

### Electronic submission / ITA

As of `July 8, 2026`, OSHA’s ITA guidance says:

- covered establishments submit `300A` data annually
- some establishments with `100+` employees in listed industries must also submit `300` and `301` data
- the deadline is `March 2` of the year after the covered calendar year
- OSHA supports manual entry, CSV upload, and API submission

This means PackPulse should eventually support ITA-ready export, and possibly API submission later, but that does not need to be part of MVP.

### Privacy

The feature must explicitly support privacy-concern cases. OSHA requires:

- replacing the employee name on the `300` log with `privacy case`
- maintaining a separate confidential list that links case number to employee identity

This has major UX and permissions implications.

## PackPulse Product Fit

PackPulse already has a strong pattern for:

- summary-first operational views
- deterministic KPI calculations
- Supabase-backed shared state
- lazy-loaded feature views
- AI as synthesis, not source-of-truth math

An OSHA feature fits that model well if we keep:

- compliance math deterministic
- sensitive data server-backed
- wide detail datasets out of the app shell
- AI limited to drafting and summarization

## Users and User Stories

### Primary users

- EHS manager
- plant manager
- production supervisor
- HR or admin partner
- executive certifier for `300A`

### User stories

#### 1. Supervisor quick-report flow

As a production supervisor, I want to report an incident from the floor in under 2 minutes so the case is captured immediately even if classification happens later.

#### 2. EHS classification flow

As an EHS manager, I want a guided recordability workflow so I can consistently determine whether a case belongs on the OSHA log and whether severe-reporting deadlines apply.

#### 3. Ongoing lost-time management

As an EHS manager or HR partner, I want to update days away, restricted work, job transfer, and return-to-work status over time because OSHA outcomes often change after the original incident.

#### 4. Annual summary workflow

As a compliance owner, I want PackPulse to prepare `300A` totals, hours-worked inputs, and certification status so annual posting and submission are straightforward.

#### 5. Executive sign-off

As a company executive, I want a review-ready summary with certification fields so I can sign an accurate annual form without digging through raw incidents.

#### 6. Operations safety trend review

As a plant leader, I want de-identified safety trends by line, shift, area, and time period so I can see where risk is rising without exposing private medical details broadly.

#### 7. Audit / inspection readiness

As an admin or EHS lead, I want audit trails, exports, and form history so I can respond to requests quickly and confidently.

## Core Use Cases

### Use case A: New incident intake

- employee is injured or becomes ill
- supervisor opens `Safety`
- taps `Report incident`
- enters who / where / when / what
- uploads optional photos or notes
- saves as draft or submits

### Use case B: Recordability review

- EHS opens an intake queue
- system flags missing information
- guided rules engine walks through work-relatedness, new case, treatment, outcome, and severity
- system classifies the case and prepares `300` + `301` records
- severe-reporting banner appears if the event may require reporting within `8` or `24` hours

### Use case C: Annual `300A` prep

- compliance owner selects year + establishment
- PackPulse rolls up totals from the log
- user verifies annual average employees and total hours worked
- executive certification fields are completed
- printable/exportable annual summary is generated

### Use case D: ITA prep

- compliance owner opens `Submission Readiness`
- sees whether establishment may be covered for `300A` only or `300A + 300/301`
- exports OSHA-ready CSV
- later phase: optional API handoff

### Use case E: Safety trend review

- plant manager opens a de-identified analytics view
- sees TRIR/DART trends, incident counts, line/shift hot spots, open corrective actions, and days since last recordable

## Recommended UX

### View structure

`Safety` should open on a summary dashboard with four sub-sections:

1. `Inbox`
2. `OSHA Log`
3. `Annual Summary`
4. `Analytics`

Optional later section:

5. `Actions`

### 1. Inbox

Purpose:

- new incident capture
- missing-info triage
- severe-reporting alerts
- aging follow-up

Top UI elements:

- summary cards:
  - open intakes
  - recordability review due
  - severe-report deadlines active
  - open lost-time / restricted-work cases
- primary CTA: `Report incident`
- queue table:
  - status
  - employee
  - date
  - location
  - probable severity
  - recordable candidate
  - severe-report candidate
  - owner
  - age

### 2. Report Incident flow

Use a step-based drawer or wizard.

#### Step 1: Quick capture

- establishment
- location / area
- date and time
- employee
- supervisor / reporter
- incident type
- short narrative
- immediate outcome guess
- photo / attachment upload

#### Step 2: Guided classification

- work-relatedness questions
- new case questions
- treatment questions
- loss of consciousness
- ER / hospitalization
- days away / restricted / transfer
- amputation / eye loss / fatality
- injury vs illness type

This step should use deterministic rules and explain the result.

#### Step 3: OSHA detail completion

- populate `301` detail fields
- flag privacy case if needed
- capture physician / facility
- capture body part, object/substance, task being performed

#### Step 4: Follow-up

- owner
- next review date
- expected lost-time updates
- corrective action linkage

### 3. OSHA Log

This should look and behave like a PackPulse table-heavy operational view.

Recommended features:

- year selector
- establishment selector
- filters:
  - status
  - recordable type
  - severe-reportable
  - privacy case
  - line / area / department
  - open / closed
- column set aligned to Form `300`
- row drawer showing full `301` detail, notes, attachments, audit trail, and follow-up history
- export actions:
  - `Export 300`
  - `Export 301 packet`
  - `Print case`

### 4. Annual Summary

This view should be optimized for compliance readiness, not case triage.

Recommended elements:

- year + establishment selector
- `300A` totals
- annual average employees input / worksheet helper
- total hours worked input / worksheet helper
- executive certification block
- posting window status
- readiness checklist:
  - all cases reviewed
  - missing days-away updates resolved
  - hours entered
  - average employment entered
  - executive certifier assigned
  - exported / posted

Actions:

- `Generate 300A`
- `Print 300A`
- `Export ITA CSV`

### 5. Analytics

This should be de-identified by default.

Recommended cards and charts:

- total recordables this year
- DART rate
- total recordable case rate
- days since last recordable
- recordables by line
- recordables by shift
- recordables by month
- severity mix
- open follow-up cases

This is where PackPulse’s operations context becomes valuable:

- correlate incidents with line, shift, work center, or operation type
- avoid exposing names or medical detail outside privileged users

## Information Required

### Establishment-level data

Required for `300A` and routing:

- establishment name
- street, city, state, ZIP
- NAICS
- industry description
- jurisdiction / state-plan routing context
- executive certifier name, title, phone
- annual average number of employees
- total hours worked

Recommended additional fields:

- site contact person
- OSHA area office / state-plan reporting details
- default timezone

### Employee-level data

Required or useful for `301` and internal workflows:

- employee full name
- internal employee ID
- job title
- date of birth
- date hired
- sex
- department
- shift
- supervisor

Recommended note:

Do not assume PackPulse’s current operations data is enough to populate this cleanly. This likely needs either:

- manual search / entry in MVP
- later HRIS import or roster sync

### Incident-level data

Required for intake:

- case number
- incident date
- incident time
- time employee began work
- establishment
- exact location
- reporter
- supervisor
- short description
- attachments

Required for OSHA `301` detail:

- what employee was doing just before the incident
- what happened
- injury or illness and body part affected
- object or substance that directly harmed the employee
- physician / health care professional
- treatment facility
- emergency room yes / no
- overnight hospitalization yes / no
- date of death if applicable

Required for OSHA `300` classification:

- work-relatedness decision
- new case decision
- privacy case yes / no
- most serious outcome
- days away count
- job transfer / restriction count
- injury vs illness type

Required for severe-reporting workflow:

- fatality yes / no
- hospitalization yes / no
- amputation yes / no
- eye loss yes / no
- reportable deadline
- reported at
- reported by
- reporting method
- confirmation / reference number

## Supporting data that matters more than it first appears

### Total hours worked

This is required for meaningful safety rates and `300A`.

Recommendation:

- MVP: manual annual entry with worksheet helper
- better: monthly hours ledger by establishment
- best: payroll/timekeeping import

### Annual average employees

Recommendation:

- MVP: manual annual entry with built-in worksheet guidance
- better: pay-period employee count capture throughout the year

### Lost-time updates

Days away and restricted-work counts change after the incident.

Recommendation:

- store daily or event-based updates
- compute current official totals deterministically
- maintain final closed values on the case

## Deterministic KPIs

If PackPulse shows safety rates, they should be computed server-side or in deterministic shared logic.

Recommended MVP metrics:

- total recordable case rate
- DART incidence rate
- recordables this year
- days away cases
- restricted / transfer cases
- days since last recordable

Official OSHA formulas to support:

- total recordable case rate = `(total injuries and illnesses x 200,000) / hours worked`
- DART incidence rate = `((column H cases + column I cases) x 200,000) / hours worked`

These fit the repo’s rule that authoritative numeric calculation should not be delegated to AI.

## What Not To Do

- Do not let AI decide whether a case is OSHA-recordable.
- Do not compute `300A` totals from incomplete or inferred labor datasets unless the source is explicitly trusted for compliance use.
- Do not expose `301` detail broadly in analytics views.
- Do not make severe-reporting submission fully automatic in V1, especially across state-plan jurisdictions.
- Do not bundle near-miss tracking, audits, inspections, training management, SDS, and CAPA into the first release unless the goal is a much larger EHS platform.

## Deterministic Logic vs AI

This should follow PackPulse’s existing guardrails closely.

### Deterministic only

- recordability rules
- severity categorization
- `300` / `300A` totals
- DART and total recordable case rate
- due-date clocks
- privacy handling
- export mapping

### AI allowed, but only as assistive

- rewrite rough incident notes into clearer narrative drafts
- identify missing fields before submission
- draft de-identified safety briefs
- summarize monthly trend changes
- suggest likely follow-up questions

AI output should always be labeled as assistive and non-authoritative.

## Recommended MVP Scope

Build only the minimum set needed to make PackPulse useful for OSHA logging without pretending to be a full EHS suite.

### MVP includes

- `Safety` view
- incident intake queue
- report incident wizard
- deterministic recordability rules engine
- Form `300` log view
- Form `301` detail record
- Form `300A` annual summary builder
- privacy case handling
- severe-report deadline tracking
- export / print views
- audit history

### MVP explicitly excludes

- automatic OSHA / state submission
- full corrective action management platform
- training / certification management
- inspection checklist system
- broad near-miss program
- workers’ comp administration

## Phase 2

- corrective actions linked to incidents
- near-miss tracking
- monthly hours-worked ledger
- department / line / shift trend analytics
- better employee roster import
- better attachment / document management

## Phase 3

- ITA CSV generation from live data
- optional ITA API integration
- executive reminders / calendar prompts
- Ask AI safety summaries with de-identified context

## Suggested Data Model

Keep private and non-private data separated.

### `safety_establishments`

- `id`
- `site_id`
- `name`
- `address_line_1`
- `address_line_2`
- `city`
- `state`
- `zip`
- `naics_code`
- `industry_description`
- `jurisdiction_type`
- `executive_name`
- `executive_title`
- `executive_phone`
- `active`

### `safety_cases`

Non-private shared case record for the log and rollups.

- `id`
- `site_id`
- `establishment_id`
- `case_number`
- `status`
- `incident_date`
- `incident_time`
- `employee_job_title`
- `department`
- `shift`
- `line_area`
- `location_text`
- `is_work_related`
- `is_new_case`
- `is_recordable`
- `is_privacy_case`
- `outcome_type`
- `days_away_count`
- `days_restricted_count`
- `injury_illness_type`
- `what_happened_summary`
- `what_employee_was_doing_summary`
- `body_part_summary`
- `harm_source_summary`
- `er_treated`
- `hospitalized_overnight`
- `fatality`
- `amputation`
- `eye_loss`
- `severe_report_required`
- `severe_report_due_at`
- `severe_reported_at`
- `severe_report_reference`
- `created_by`
- `created_at`
- `updated_by`
- `updated_at`

### `safety_case_private`

Private table for PII / medical detail.

- `case_id`
- `employee_full_name`
- `employee_id`
- `date_of_birth`
- `date_hired`
- `sex`
- `home_address`
- `physician_name`
- `facility_name`
- `facility_address`
- `date_of_death`

### `safety_case_updates`

For aging, lost-time changes, and auditability.

- `id`
- `case_id`
- `update_type`
- `effective_date`
- `days_away_delta`
- `days_restricted_delta`
- `notes`
- `created_by`
- `created_at`

### `safety_annual_summaries`

- `id`
- `establishment_id`
- `year`
- `avg_employees`
- `hours_worked`
- `deaths_total`
- `days_away_cases_total`
- `job_transfer_cases_total`
- `other_recordables_total`
- `days_away_total`
- `days_restricted_total`
- `injuries_total`
- `skin_total`
- `respiratory_total`
- `poisoning_total`
- `hearing_total`
- `other_illness_total`
- `certified_by`
- `certified_title`
- `certified_phone`
- `certified_at`

### `safety_attachments`

- `id`
- `case_id`
- `storage_path`
- `label`
- `mime_type`
- `created_by`
- `created_at`

## Suggested API Surface

Summary-first and detail-later, consistent with the repo checklist.

### Read APIs

- `/api/safety/summary`
- `/api/safety/cases`
- `/api/safety/case`
- `/api/safety/annual-summary`
- `/api/safety/analytics`

### Write APIs

- `/api/safety/report-incident`
- `/api/safety/upsert-case`
- `/api/safety/upsert-case-update`
- `/api/safety/upsert-establishment`
- `/api/safety/certify-summary`

### Export APIs

- `/api/safety/export/300`
- `/api/safety/export/300a`
- `/api/safety/export/301`
- `/api/safety/export/ita-csv`

## Frontend Slice Plan

### New view

- `src/views/SafetyView.jsx`

### Likely subcomponents

- `src/components/safety/SafetySummaryCards.jsx`
- `src/components/safety/SafetyInboxTable.jsx`
- `src/components/safety/IncidentReportWizard.jsx`
- `src/components/safety/OshaLogTable.jsx`
- `src/components/safety/CaseDetailDrawer.jsx`
- `src/components/safety/AnnualSummaryPanel.jsx`
- `src/components/safety/SafetyAnalyticsPanel.jsx`

### App shell updates

- add lazy import + nav item in `src/PackPulse.jsx`
- permalink support similar to other views
- prefetch on hover / idle consistent with existing pattern

### Performance notes

- do not hydrate full private case detail into app shell state
- fetch summary cards first
- paginate log rows
- load case detail on row open
- defer analytics charts until after initial render

## Permissions and Privacy

At minimum, define three roles:

- `safety_admin`
- `safety_editor`
- `safety_viewer`

Recommended visibility model:

- only `safety_admin` and `safety_editor` can see `301` detail and private identity data
- general operations leaders can see de-identified counts and trends
- privacy-case identity is always stored separately

## Open Questions Before Building

1. Is PackPulse intended for one establishment or multiple establishments under one account?
2. Do users need contractor / temp worker handling in V1?
3. Is there an HR or payroll source available for employee roster, hours worked, and annual average employment?
4. Does the team want near-miss tracking now, or should V1 stay strictly OSHA-focused?
5. Do they want corrective actions in the first release?
6. Which users should have access to private case detail?
7. Do they need federal OSHA only, or state-plan routing from day one?

## Recommended Build Order

1. Establishments + permissions + data model
2. Incident intake wizard
3. Deterministic recordability engine
4. OSHA `300` log table
5. OSHA `301` detail workflow
6. OSHA `300A` annual summary
7. Severe-report deadline tracker
8. Export / print flows
9. De-identified analytics
10. ITA export / submission workflow

## Sources

Official OSHA sources reviewed on `2026-07-08`:

- [Recordkeeping Forms](https://www.osha.gov/recordkeeping/forms)
- [OSHA Forms Package PDF](https://www.osha.gov/sites/default/files/OSHA-RK-Forms-Package.pdf)
- [Detailed Guidance for OSHA's Injury and Illness Recordkeeping Rule](https://www.osha.gov/recordkeeping/resources)
- [Injury Tracking Application](https://www.osha.gov/injuryreporting)
- [Report a Fatality or Severe Injury](https://www.osha.gov/report)
- [Serious Event Reporting Online Form](https://www.osha.gov/form/ser)
