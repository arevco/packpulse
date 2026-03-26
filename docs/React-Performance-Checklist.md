# PackPulse React/Vite Performance Checklist

Use this checklist when building or reviewing UI, data-loading, and API changes in this repo.

## Data Loading
- Start independent requests in parallel and await them as late as possible.
- Prefer deterministic server-side summaries over wide client-side raw reads.
- For large datasets, ship summary-first and detail-later APIs instead of blocking first paint on full detail.
- Keep shared snapshot payloads compact. Do not push raw artifacts or large detailed datasets into the app shell unless the view truly needs them.

## Bundle and Boot
- Defer non-critical third-party client libraries until after initial render when they are not needed for first paint.
- Keep heavy views lazy-loaded and avoid pulling them into the app shell bundle.
- Prefetch likely next views on hover/focus and, when safe, during idle time.
- Use `npm run build:analyze` before and after major frontend changes that add dependencies or large view logic.

## Rendering
- Paginate or virtualize long tables. Do not render thousands of rows at once.
- Use `useDeferredValue` or `startTransition` for expensive filtering, searching, or sorting interactions.
- Keep expensive derived state in render-time derivation or memoized helpers, not effect-driven state churn.
- Prefer summary cards and compact tables on initial load; defer heavy charts and row-level panels when possible.

## Review Triggers
- New API response is wide or overfetching:
  add a compact mode or separate summary endpoint.
- New tab/view is a common next click:
  add prefetch using the shared lazy import pattern.
- New dependency is large or optional:
  lazy-load it or defer boot until after paint.
- New table or grid can exceed a few hundred visible rows:
  add pagination or virtualization before shipping.

## Current Repo Hotspots
- [src/PackPulse.jsx](/Users/aj/Documents/New project/src/PackPulse.jsx): view-level lazy loading and prefetch.
- [src/hooks/useDataSources.js](/Users/aj/Documents/New project/src/hooks/useDataSources.js): shared snapshot hydration and client data loading.
- [src/views/InventoryView.jsx](/Users/aj/Documents/New project/src/views/InventoryView.jsx): search/filter responsiveness and long-row rendering.
- [src/views/OperationsView.jsx](/Users/aj/Documents/New project/src/views/OperationsView.jsx): summary-first/detail-later loading.
- [api/cache/snapshot.js](/Users/aj/Documents/New project/api/cache/snapshot.js): shared payload size.
