# PackPulse AI Product Backlog

## Goal
Build a reliable AI copilot for factory operations that is trusted for numbers, useful for decisions, and safe for production use.

## Product Principles
- Deterministic for KPIs and numeric answers.
- Model for summaries, explanations, and recommendations.
- Every answer includes provenance (`source`, `timestamp`, `confidence`).
- AI must be grounded in Supabase shared data, not only UI state.

## Roadmap Phases

### Phase A: Foundation (Infra)
#### A1. Intent Router Service
- Add centralized intent router for `deterministic`, `hybrid`, `model_only`.
- Version routing rules for safe iteration.
- Acceptance:
  - Route decision logged for each request.
  - Router can be updated without touching UI.

#### A2. Context Assembler Service
- Build one server-side context assembler from Supabase:
  - `cache_snapshot`
  - `production_events`
  - `ops_shift_inputs`
  - `ops_config`
- Acceptance:
  - Standard context payload generated for all AI calls.
  - Missing context fields explicitly reported.

#### A3. Response Contract
- Standardize API response shape:
  - `answer`
  - `source` (`deterministic`/`openai`/`hybrid`)
  - `intent`
  - `dataTimestamp`
  - `confidence`
  - `citations` (metric keys/tables used)
- Acceptance:
  - UI displays source + timestamp on each answer.

#### A4. AI Observability + Cost Tracking
- Create Supabase table `ai_events`:
  - prompt type, intent, source, latency, token usage, fallback reason, user, timestamp.
- Create Supabase table `ai_feedback`:
  - thumbs up/down, reason, answer id.
- Acceptance:
  - Dashboard query for success rate, fallback rate, top intents, cost by day.

#### A5. Guardrails
- Add rate limits per user/day and per-route token limits.
- Add server-side redaction for sensitive fields in logs.
- Acceptance:
  - Hard cap enforcement for cost and abuse.

### Phase B: Core Ops Features
#### B1. Shift Brief Generator
- Prompt template: yesterday summary + today priorities + blockers.
- Output sections:
  - What happened
  - Why it matters
  - What to do next
- Acceptance:
  - One-click “Copy for shift call.”

#### B2. Run Plan Copilot
- AI explanation of deterministic run-next ranking.
- Include tradeoffs: changeover load, shared-component conflict, due risk.
- Acceptance:
  - “Explain top 5” works with exact numeric references.

#### B3. Supply Risk Copilot
- Explain `missing` vs `unscheduled` vs `partial`.
- Suggest vendor-facing actions by owner role.
- Acceptance:
  - Export-ready action summary for supply chain manager.

#### B4. Exception Explainer
- For selected WO/SKU, explain root cause chain:
  - shortage component
  - inbound status
  - net impact
- Acceptance:
  - Explanation references underlying rows/metrics.

#### B5. Target Planner
- Daily/shift targets for month close based on:
  - remaining volume
  - business days remaining
  - recent pace
- Acceptance:
  - deterministic answer for monthly target prompts.

### Phase C: UX + Adoption
#### C1. Ask AI Modes
- Add output modes:
  - `Quick`
  - `Ops Brief`
  - `Detailed`
- Acceptance:
  - Mode selector persists by user.

#### C2. Role Prompt Packs
- Suggested prompts by role:
  - Supervisor
  - Planner
  - Supply Chain
  - VP Ops
- Acceptance:
  - Role switch updates suggestions instantly.

#### C3. Provenance UI
- Badge per answer:
  - `Deterministic`
  - `OpenAI`
  - `Hybrid`
- Show data freshness timestamp.
- Acceptance:
  - Users can see source without opening settings.

#### C4. Report Utility
- Add “Use in Report” and “Copy brief” actions.
- Add markdown export for daily ops call notes.
- Acceptance:
  - Single-click copy of structured briefing text.

### Phase D: Quality + Governance
#### D1. KPI Dictionary
- Create a maintained metric registry:
  - definition
  - source tables
  - owner
  - refresh cadence
- Acceptance:
  - All AI KPI answers map to dictionary entries.

#### D2. Prompt Eval Suite
- Build canonical prompt test set (20-30 prompts).
- Validate:
  - numeric correctness
  - response format
  - source tagging
- Acceptance:
  - CI gate for regression on high-priority prompts.

#### D3. Weekly QA Workflow
- Review low-confidence/fallback/negative-feedback responses.
- Create backlog tickets directly from QA queue.
- Acceptance:
  - Continuous improvement loop in place.

## Initial Backlog (Prioritized)
1. Implement response contract (`source`, `intent`, `timestamp`, `confidence`, `citations`).
2. Add `ai_events` and `ai_feedback` Supabase tables + write path.
3. Add provenance footer in Ask AI UI.
4. Implement output mode selector (`Quick`, `Ops Brief`, `Detailed`).
5. Build Shift Brief generator template.
6. Build Run Plan explanation endpoint.
7. Build Supply Risk action brief endpoint.
8. Add role-based suggested prompts.
9. Add copy/export utilities for briefings.
10. Add prompt eval suite in CI.

## Definition of Done (AI)
- Numeric questions return deterministic values or explicit “data unavailable.”
- Advisory responses cite the key metrics used.
- Every response is traceable by source and timestamp.
- Fallback rate below agreed threshold (target: <10%).
- Users can reuse AI outputs in daily workflows (shift call, planner queue, vendor follow-up).

