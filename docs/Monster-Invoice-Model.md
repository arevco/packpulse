# Monster Invoice Model

## Source Documents
- [Invoice 1300.pdf](/Users/aj/Downloads/Invoice%201300.pdf)
- [Invoice 1301.pdf](/Users/aj/Downloads/Invoice%201301.pdf)

These two PDFs were reviewed on April 1, 2026 and used as the historical model for how Monster invoices have actually been structured.

## What The PDFs Show

### Invoice 1300
- Invoice no: `1300`
- Customer: `Monster Beverage Corporation`
- Invoice date: `02/28/2026`
- Due date: `04/02/2026`
- Terms: `Net 30`
- PO: `450056275`
- Line count: `15`
- Distinct item codes: `5`
- Total: `$69,311.50`

### Invoice 1301
- Invoice no: `1301`
- Customer: `Monster Beverage Corporation`
- Invoice date: `02/28/2026`
- Due date: `04/02/2026`
- Terms: `Net 30`
- PO: `450056848`
- Line count: `25`
- Distinct item codes: `9`
- Total: `$104,396.00`

## Billing Pattern Confirmed By These Invoices
- There is **one invoice per PO** in both examples.
- The invoice header repeats the PO in the customer note:
  - `PO ONLY# 450056275`
  - `PO#450056848 ONLY`
- Each invoice line represents a specific billed quantity for a specific:
  - item code
  - PO
  - lot code
  - unit rate
- Work order numbers do **not** appear as billing drivers on the customer-facing invoice.
- Lot codes are explicitly printed on each line and are clearly part of the billing/tracing model.
- The visible line pattern is effectively:
  - `item_code + PO + product description + pack text + lot code + qty + rate + amount`
- All visible line dates match the invoice date in these samples.
- No tax, freight, or surcharge lines are shown in these examples.

## Recommended Billing Grain For PackPulse
For Monster-style invoices, the PackPulse export grain should be:

- `customer`
- `purchase_order_number`
- `item_code`
- `lot_code`
- `unit_rate`

`work_order` should not be part of the billing identity.

`job_id` should not be part of the billing identity.

## Recommended Invoice Grouping

### Invoice header grouping
Create one QuickBooks invoice per:
- `customer + purchase_order_number`

Optionally include billing date/window in the duplicate-prevention key, but not in the customer-facing grouping label if the PO already identifies the billing packet.

### Invoice line grouping
Create one QuickBooks line per:
- `item_code + lot_code + unit_rate`

inside a single PO invoice.

Do not merge across:
- different lot codes
- different item codes
- different unit rates
- different POs

Multiple work orders can roll up into one billed line if they contributed to the same:
- PO
- item code
- lot code
- rate

## Required PackPulse Data Model

### Invoice header data
- `customer_name`
- `customer_account_key`
- `purchase_order_number`
- `invoice_date`
- `terms_code`
- `due_date`
- `bill_to_name`
- `bill_to_address`
- `ship_to_name`
- `ship_to_address`
- `currency_code`
- `invoice_note`

### Invoice line data
- `item_code`
- `item_description`
- `pack_description`
- `lot_code`
- `quantity`
- `unit_rate`
- `line_amount`
- `unit_of_measure`

### Audit-only supporting data
- `work_order_codes[]`
- `job_ids[]`
- `produced_date_min`
- `produced_date_max`
- `source_snapshot_at`
- `packpulse_candidate_key`
- `export_batch_id`

## What PackPulse Must Preserve
- PO must be preserved as first-class billing data.
- Lot code must be preserved as first-class billing data.
- Quantity and rate must stay deterministic in PackPulse.
- Amount should be sent to QuickBooks as a final computed value from PackPulse inputs, not recalculated from fuzzy logic.
- Work orders can be stored in audit metadata or private notes, but they should not split invoice lines by default.

## QuickBooks Online Payload Mapping

## Header mapping
- `CustomerRef.value`
  - mapped QuickBooks customer id for `Monster Beverage Corporation`
- `TxnDate`
  - PackPulse invoice date
- `SalesTermRef`
  - QuickBooks term id for `Net 30`
- `DueDate`
  - optional if you want PackPulse to set it explicitly rather than rely on QuickBooks terms
- `ShipAddr`
  - set if the billable ship-to location varies and should match the PDF output
- `BillAddr`
  - usually optional if QuickBooks customer defaults are correct
- `CustomerMemo.value`
  - recommended place for customer-facing PO note, for example `PO ONLY# 450056275`
- `PrivateNote`
  - recommended place for internal PackPulse export id plus work-order references
- `DocNumber`
  - only set if PackPulse is intended to control invoice numbering
- `CustomField`
  - optional if you want dedicated PO or lot fields instead of encoding them in description/memo

## Line mapping
- `Line[].Amount`
  - line amount from PackPulse
- `Line[].Description`
  - customer-facing description that mirrors the PDF pattern
- `Line[].DetailType`
  - `SalesItemLineDetail`
- `Line[].SalesItemLineDetail.ItemRef.value`
  - mapped QuickBooks item id for the PackPulse item code
- `Line[].SalesItemLineDetail.Qty`
  - billed quantity
- `Line[].SalesItemLineDetail.UnitPrice`
  - billed rate

## Suggested description pattern
```text
PO#450056275,MON REHAB GREEN TEA ECOMM US 15/15.5OZ
LOT CODE#A2612X
```

That keeps the customer-facing invoice close to the historical layout.

## Example QuickBooks Invoice Payload
```json
{
  "CustomerRef": { "value": "monster-qbo-id" },
  "TxnDate": "2026-02-28",
  "SalesTermRef": { "value": "net30-term-id" },
  "DueDate": "2026-04-02",
  "CustomerMemo": {
    "value": "PO ONLY# 450056275"
  },
  "PrivateNote": "PackPulse export monster-2026-02-28-450056275 | WO refs: Gorgie770-2,Gorgie770-3",
  "Line": [
    {
      "Amount": 6571.25,
      "Description": "PO#450056275,MON REHAB GREEN TEA ECOMM US 15/15.5OZ\nLOT CODE#A2612X",
      "DetailType": "SalesItemLineDetail",
      "SalesItemLineDetail": {
        "ItemRef": { "value": "item-115193-id" },
        "Qty": 3755,
        "UnitPrice": 1.75
      }
    }
  ]
}
```

## QuickBooks Configuration We Will Need

### App-level configuration
- `INTUIT_CLIENT_ID`
- `INTUIT_CLIENT_SECRET`
- `INTUIT_REDIRECT_URI`
- `INTUIT_ENVIRONMENT`
- `INTUIT_WEBHOOK_VERIFIER_TOKEN`

### Company-level QuickBooks setup
- A connected QuickBooks Online company via OAuth 2.0
- QuickBooks customer record for `Monster Beverage Corporation`
- QuickBooks item records for each billed item code
- QuickBooks payment term for `Net 30`
- Correct bill-to defaults for Monster
- Correct ship-to defaults or support for per-invoice `ShipAddr`
- Agreed invoice numbering strategy
- Agreed sales tax behavior

## QuickBooks Mappings We Need In PackPulse

### Customer mapping
- PackPulse customer name `Monster Beverage Corporation`
- QuickBooks `Customer.Id`

### Item mapping
At minimum, item mappings are needed for the item codes seen in these two invoices:
- `114718`
- `114722`
- `115193`
- `115657`
- `115658`
- `115659`
- `116344`
- `116495`
- `118030`
- `118354`
- `118528`
- `118780`

### Terms mapping
- PackPulse terms code `Net 30`
- QuickBooks `SalesTermRef.value`

### Address mapping
- `Bill to`
  - Monster Beverage Corporation
  - 1 Monster Way
  - Corona, CA 92879 USA
- `Ship to`
  - Monster Beverage Corporation
  - R.C. Moore Distribution
  - 301 Oak St
  - Pittston, PA 18640 USA

If Monster uses multiple ship-to destinations, PackPulse needs a PO-to-ship-to mapping layer.

## Tax And Compliance Note
These invoices show no tax lines.

For QuickBooks Online, we need to confirm whether this should be achieved by:
- customer tax exemption
- item tax treatment
- ship-to/location behavior under US automated sales tax

This should be configured intentionally, not assumed.

## Current PackPulse Mismatch To Fix
The current Invoicing view groups candidates by:
- customer
- SKU
- lot code
- work order
- purchase order

That means the current key is likely too granular for Monster billing because it still splits on work order.

Relevant current code:
- [InvoicingView.jsx](/Users/aj/Documents/New%20project/src/views/InvoicingView.jsx#L1012)
- [InvoicingView.jsx](/Users/aj/Documents/New%20project/src/views/InvoicingView.jsx#L1145)

For Monster-style billing, PackPulse should instead group for export by:
- customer
- SKU
- lot code
- purchase order
- rate

and allow multiple work orders to contribute to that same billed line.

## Recommended Next Implementation Steps
1. Update PackPulse invoice candidate grouping to remove work order from the export key.
2. Preserve work order arrays in audit metadata only.
3. Add QuickBooks customer and item mapping tables.
4. Add preview payload generation that mirrors the Monster PDF format.
5. Decide whether PO should live in `CustomerMemo`, line `Description`, a QuickBooks custom field, or some combination of the three.

## Relevant Intuit Docs
- [Create basic invoices](https://developer.intuit.com/app/developer/qbo/docs/workflows/create-an-invoice)
- [OAuth 2.0](https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-2.0)
- [Explore the QuickBooks Online API](https://developer.intuit.com/app/developer/qbo/docs/learn/explore-the-quickbooks-online-api)
- [Custom fields use cases](https://developer.intuit.com/app/developer/qbo/docs/workflows/create-custom-fields/use-cases)
