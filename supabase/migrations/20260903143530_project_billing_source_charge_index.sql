-- Cover the invoice-line source charge foreign key for joins and cascades.
create index if not exists idx_billing_invoice_lines_source_charge
  on public.billing_invoice_lines(source_charge_id);
