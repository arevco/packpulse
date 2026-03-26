# PackPulse Agent Notes

## Purpose
This file gives Codex/AI contributors a stable operating playbook for this repo.

## Core Rules
- Keep KPI math deterministic where possible.
- Use AI models for summaries/recommendations, not authoritative numeric calculation.
- Never expose secrets in client-side code (`VITE_*` for public only).
- Prefer minimal diffs and avoid broad refactors unless explicitly requested.

## React/Vite Performance Checklist
- Parallelize independent fetches and await late.
- Prefer summary-first/detail-later APIs for large datasets.
- Keep heavy views and optional libraries lazy-loaded or deferred.
- Prefetch likely next views when the user hovers/focuses likely navigation targets.
- Paginate or virtualize large tables before shipping.
- Use `useDeferredValue` or `startTransition` for expensive filter/search updates.
- See `/docs/React-Performance-Checklist.md` for the repo-specific checklist used in reviews.

## Stack
- Frontend: React + Vite + Tailwind + shadcn-style UI
- APIs: Vercel serverless routes in `/api`
- Data: Supabase

## Deployment Workflow
1. `npm run build`
2. Commit with clear message
3. Push to `main`
4. Verify Vercel deploy health
5. Smoke-test key views: Overview, Operations, Work Orders, Supply Risk, Ask AI

## Data Source Trust Order
1. Deterministic server-side queries/calculations
2. Supabase shared snapshot/state
3. Client-local state/cache
4. Model-generated narrative

## Ask AI Guardrails
- Route deterministic intents first (e.g., cases produced today, period summaries).
- Include `source` and data timestamp when available.
- If context is missing, return explicit “data unavailable” guidance.

## Environment Variables (Important)
- Client:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`
- Server:
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `CACHE_SITE_ID`
  - `SESSION_SECRET`
  - `OPENAI_API_KEY`
  - `OPENAI_MODEL`

## File Priorities for Changes
- App shell/state: `/src/PackPulse.jsx`
- AI panel: `/src/components/AskAiPanel.jsx`
- AI backend: `/api/ai/chat.js`
- Ops data APIs: `/api/ops/*`
- Snapshot/cache: `/api/cache/*`
