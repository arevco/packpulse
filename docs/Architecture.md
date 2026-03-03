# PackPulse Architecture

## High-Level Components
- Frontend app shell: `/src/PackPulse.jsx`
- View modules:
  - `/src/views/OverviewView.jsx`
  - `/src/views/OperationsView.jsx`
  - `/src/views/WorkOrdersView.jsx`
  - `/src/views/SupplyRiskView.jsx`
  - `/src/views/SandboxView.jsx`
- API routes:
  - `/api/nulogy/*`
  - `/api/opendock/*`
  - `/api/cache/*`
  - `/api/ops/*`
  - `/api/ai/chat.js`

## Data Flow
1. Nulogy/OpenDock data is synced through server routes.
2. App computes deterministic analytics in hooks (`/src/hooks/useAnalysis.js`).
3. Snapshot and operational data are persisted in Supabase.
4. Ask AI uses server route with Supabase context + deterministic intent routing.

## State Layers
- Shared backend state: Supabase tables (authoritative for cross-user shared context)
- Client state: React state + local cache
- Derived state: analytics/computed metrics

## AI Flow
1. User asks question in Ask AI panel.
2. `/api/ai/chat` receives prompt + context.
3. Route loads Supabase context.
4. Intent routing:
  - deterministic answer path for known KPI questions
  - OpenAI model path for synthesis/advice
5. Response returned to UI with source metadata (roadmap item if not present yet).

