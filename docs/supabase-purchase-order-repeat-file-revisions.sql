-- Allow an explicit in-PO repair revision to reuse the same source document.
-- Global uploads remain idempotent in application code by checking this hash.

alter table public.purchase_order_revisions
  drop constraint if exists purchase_order_revisions_site_id_sha256_key;

create index if not exists purchase_order_revisions_site_sha256_idx
  on public.purchase_order_revisions (site_id, sha256, created_at desc);
