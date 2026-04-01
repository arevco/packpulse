# QuickBooks Online Invoicing Integration Plan

## Goal
Let a PackPulse bookkeeper review invoiceable production, select the invoiceable lines that should be billed, and push those selections into QuickBooks Online to create reviewable invoices without re-keying customer, SKU, lot code, work order, or PO detail.

## What We Verified From Intuit Docs
- QuickBooks Online integrations use OAuth 2.0. After authorization, requests are scoped to the connected company via `realmId`.
- The accounting scope we need is `com.intuit.quickbooks.accounting`.
- Invoice creation is a normal REST call to the Accounting API, for example `POST /v3/company/{realmId}/invoice`.
- Invoices must reference existing QuickBooks entities such as `Customer` and `Item`. Intuit explicitly recommends pre-creating common entities and notes that referenced entities cannot be created on the fly inside a transaction.
- Batch operations exist, but they are limited. Intuit documents up to 10 payloads per batch request and up to 40 requests per minute per connected company.
- Webhooks are available for `Invoice`, `Customer`, and `Item`, so PackPulse can refresh sync state when bookkeeping changes happen in QuickBooks.
- Custom fields are available, but support depends on the QuickBooks subscription and API used. They should be treated as an enhancement, not a V1 dependency.

## Current PackPulse Fit

### What already exists
- [`/src/views/InvoicingView.jsx`](../src/views/InvoicingView.jsx) builds invoice candidates from production history and labels each candidate as `ready` or `review`.
- Candidate rows are grouped by customer, SKU, lot code, work order, and purchase order.
- [`/api/ops/invoicing-production.js`](../api/ops/invoicing-production.js) already serves normalized production rows from `production_events` for a selected billing window.
- The current UI already feels like a bookkeeper review surface: date range, customer filter, readiness status, issue summaries, summary export, and detail export.

### Important observation about the current model
- The current candidate key does **not** include `jobId`.
- A single candidate row can therefore represent multiple jobs when customer + SKU + lot + work order + PO are the same.
- If billing is driven by produced quantity and lot code, this is not a blocker. It is actually close to the right billing grain already.
- Job rows should still be available as drill-down detail for audit, but they do not need to be the primary export unit.
- The current candidate grouping also includes **work order**. If billing is actually keyed by **purchase order**, this likely over-splits some invoiceable lines today.

## Recommendation
Use a **PO-centered invoice candidate** as the source of truth for QuickBooks exports.

This keeps the bookkeeper working at the billing grain that matters most: quantity produced tied to the billed lot-coded output and the purchase order being billed.

Job detail and work order detail should remain available as drill-down context and export audit detail, but they do not need to drive QuickBooks invoice creation in V1.

### Proposed billing identity
Use:
- customer
- SKU
- lot code
- purchase order

Do not use `work order` as part of the invoice export key. Keep it only as descriptive metadata and audit context.

## Proposed V1 Workflow
1. A PackPulse admin connects one QuickBooks Online company.
2. PackPulse pulls or looks up QuickBooks `Customer` and `Item` records and stores mappings for PackPulse customer names and SKUs.
3. The bookkeeper opens Invoicing, filters to a billing window, and reviews invoiceable production lines.
4. The bookkeeper selects specific invoice candidates to export.
5. PackPulse validates each selection:
   - ready status only
   - exactly one QuickBooks customer mapping
   - exactly one QuickBooks item mapping
   - deterministic quantity and price
   - not already exported
6. PackPulse shows a preview grouped into one or more QuickBooks invoices, usually by customer and billing window.
7. The bookkeeper clicks `Create in QuickBooks`.
8. PackPulse creates unsent/open QuickBooks invoices and stores the resulting QuickBooks invoice ids, sync tokens, and per-line export links.
9. PackPulse marks those selected invoice candidates as exported and shows sync state in the Invoicing view.

## Recommended Invoice Shape In QuickBooks

### V1 grouping rule
- Default to one QuickBooks invoice per `customer + billing window`.
- Within that invoice, create one QuickBooks line per selected PackPulse invoice candidate.
- Only merge multiple selected candidates into one QuickBooks line if:
  - customer mapping matches
  - item mapping matches
  - lot handling still stays correct for billing and traceability
  - purchase order matches
  - unit price matches
  - unit of measure matches
  - the merge still preserves the bookkeeping detail you care about

### Suggested line payload
- `CustomerRef.value`: mapped QuickBooks customer id
- `Line[].Amount`: `Qty * UnitPrice`
- `Line[].SalesItemLineDetail.ItemRef.value`: mapped QuickBooks item id
- `Line[].SalesItemLineDetail.Qty`: PackPulse invoice quantity
- `Line[].SalesItemLineDetail.UnitPrice`: PackPulse revenue per unit
- `Line[].Description`: customer-facing detail such as SKU description plus lot code and purchase order
- `TxnDate`: billing or export date
- `PrivateNote`: PackPulse export batch id plus internal references for audit

### Example payload
```json
{
  "CustomerRef": { "value": "123" },
  "TxnDate": "2026-03-31",
  "PrivateNote": "PackPulse export pp-exp-2026-03-31-001 | Lot LOT-123 | PO Gorgie770 | WO refs: Gorgie770-2,Gorgie770-3",
  "Line": [
    {
      "Amount": 1300.0,
      "Description": "AMZ Tropical VP | Lot LOT-123 | PO Gorgie770 | 1250 cases",
      "DetailType": "SalesItemLineDetail",
      "SalesItemLineDetail": {
        "ItemRef": { "value": "456" },
        "Qty": 1250,
        "UnitPrice": 1.04
      }
    }
  ]
}
```

## Data Model

### `accounting_connections`
One row per PackPulse site and provider.

Suggested fields:
- `site_id`
- `provider` (`quickbooks_online`)
- `realm_id`
- `environment` (`sandbox` or `production`)
- `connected_by_user`
- `connected_at`
- `refresh_token_encrypted`
- `refresh_token_updated_at`
- `access_token_encrypted`
- `access_token_expires_at`
- `webhook_realm_id`
- `status`

### `accounting_entity_mappings`
Store PackPulse-to-QuickBooks lookups.

Suggested fields:
- `site_id`
- `provider`
- `entity_type` (`customer`, `item`)
- `packpulse_key`
- `packpulse_label`
- `external_id`
- `external_name`
- `status`
- `last_verified_at`
- `metadata`

### `invoice_exports`
One row per push attempt or created QuickBooks invoice.

Suggested fields:
- `site_id`
- `provider`
- `export_batch_id`
- `customer_key`
- `billing_start`
- `billing_end`
- `request_hash`
- `qbo_invoice_id`
- `qbo_sync_token`
- `qbo_doc_number`
- `status` (`previewed`, `created`, `failed`, `voided`, `deleted`)
- `created_by_user`
- `created_at`
- `error_message`
- `request_payload`
- `response_payload`

### `invoice_export_lines`
Join selected PackPulse invoice candidates to the QuickBooks invoice created from them.

Suggested fields:
- `site_id`
- `export_batch_id`
- `candidate_key`
- `customer`
- `sku`
- `lot_code`
- `purchase_order_number`
- `work_order_codes`
- `selected_units`
- `selected_unit_price`
- `selected_amount`
- `export_status`
- `metadata`

## API Surface

### Connection and mapping
- `GET /api/accounting/qbo/status`
- `POST /api/accounting/qbo/connect-url`
- `GET /api/accounting/qbo/oauth/callback`
- `POST /api/accounting/qbo/disconnect`
- `GET /api/accounting/qbo/entities?type=customer|item`
- `POST /api/accounting/qbo/mappings`

### Export flow
- `POST /api/accounting/qbo/preview-invoices`
  - input: selected candidate keys or selected export rows
  - output: grouped invoice preview, mapping gaps, validation issues
- `POST /api/accounting/qbo/create-invoices`
  - input: preview-confirmed export batch
  - output: created QuickBooks invoice ids and statuses
- `POST /api/accounting/qbo/webhook`
  - input: Intuit webhook payload
  - purpose: refresh invoice or mapping state after QuickBooks changes

## UI Changes In PackPulse

### Invoicing view
- Add a `QuickBooks` connection badge in the header.
- Add checkbox selection at the grouped invoice-candidate level.
- Add QuickBooks status filters:
  - `Unmapped`
  - `Ready to push`
  - `Already pushed`
  - `Push failed`
- Add a right-side preview panel or bottom drawer for selected invoice candidates and resulting invoice groups.
- Add a primary action:
  - `Preview QuickBooks Invoice`
  - then `Create in QuickBooks`
- Surface purchase order prominently in the candidate grid and preview because it is the billing key.

### Candidate table behavior
- Keep the current grouped candidate table for review and issue triage.
- Add drill-down from candidate row to the contributing detail rows for audit.
- Show when a candidate is backed by multiple jobs, but do not force the user to select at job grain.
- If multiple work orders roll into one purchase order, keep them merged for billing as long as the PO, lot, SKU, and pricing remain consistent.

## Validation Rules
- Never export rows with `review` status.
- Never export a selection that mixes multiple QuickBooks customers in one invoice.
- Never export if any selected line is missing a QuickBooks item mapping.
- Block duplicate exports by hashing the selected candidates + quantities + unit prices + billing window.
- Persist PackPulse-side export state so a page refresh does not lose bookkeeping context.
- Keep deterministic math in PackPulse. QuickBooks should receive already-decided quantities and prices, not recalculate them.
- Preserve lot-code traceability in either the line description, private note, or both.
- Preserve purchase-order traceability in the exported line itself, not only in internal metadata.
- Do not split an invoice line only because multiple work orders contributed to the same billed PO.

## Reconciliation And Audit
- Store the full request and response payload for each QuickBooks invoice creation.
- Store the QuickBooks invoice id and sync token so later updates or voids can be handled safely.
- Use webhooks or periodic refresh to update PackPulse when invoices are changed in QuickBooks.
- Show PackPulse users whether a selected invoice candidate is:
  - never exported
  - exported to QuickBooks
  - later modified in QuickBooks
  - voided or deleted in QuickBooks

## Environment Variables
These should stay server-side only.

- `INTUIT_CLIENT_ID`
- `INTUIT_CLIENT_SECRET`
- `INTUIT_REDIRECT_URI`
- `INTUIT_ENVIRONMENT`
- `INTUIT_WEBHOOK_VERIFIER_TOKEN`

## Recommended Rollout

### Phase 1: Connection and mapping
- OAuth connection
- customer and item lookup
- manual mapping UI

### Phase 2: Review and preview
- invoice-candidate selection
- preview invoice groups
- duplicate export guards

### Phase 3: Create invoices
- create QuickBooks invoices
- persist export state
- show invoice links and statuses in PackPulse

### Phase 4: Reconciliation
- webhook endpoint
- refresh changed invoices
- surface mismatches and edited invoices

## Product Decisions To Confirm
- Should PackPulse create one invoice per customer per billing window, or should the bookkeeper be able to split by PO within that customer?
- Should missing QuickBooks customers/items block export, or should PackPulse offer a guided "create entity in QuickBooks first" action?
- Should lot code always appear in the customer-facing line description, in `PrivateNote`, or in QuickBooks custom fields when available?
- Should PackPulse create one QuickBooks line per `customer + SKU + lot + PO`, even when multiple WOs contributed to that quantity?
- Is "invoice created in QuickBooks but not sent" the desired review state, or does the bookkeeper want a different pre-send workflow?

## Why This Fits PackPulse
- It keeps deterministic billing math in PackPulse.
- It extends the existing Invoicing review workflow instead of replacing it.
- It respects the repo’s current architecture: React view for review, server routes for external calls, Supabase for shared sync state.
- It gives the bookkeeper explicit control over which invoiceable lot-coded lines become invoices.

## Source Links
- QuickBooks Online develop hub: https://developer.intuit.com/app/developer/qbo/docs/develop
- OAuth 2.0: https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-2.0
- Scopes: https://developer.intuit.com/app/developer/qbo/docs/learn/scopes
- API capabilities and resource model: https://developer.intuit.com/app/developer/qbo/docs/learn/explore-the-quickbooks-online-api
- REST invoice example: https://developer.intuit.com/app/developer/qbo/docs/learn/rest-api-features
- Basic billing implementation and pre-created references: https://developer.intuit.com/app/developer/qbo/docs/develop/basic-implementations/basic-billing-implementation
- Batch operation: https://developer.intuit.com/app/developer/qbo/docs/learn/explore-the-quickbooks-online-api/batch
- Webhooks: https://developer.intuit.com/app/developer/qbo/docs/develop/webhooks
- Custom fields use cases: https://developer.intuit.com/app/developer/qbo/docs/workflows/create-custom-fields/use-cases
