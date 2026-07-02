-- Cached Gusto time-off requests for PackPulse team visibility.
-- Run in Supabase SQL editor before enabling the Gusto PTO routes.

create table if not exists public.gusto_time_off_requests (
  site_id text not null,
  request_uuid text not null,
  company_uuid text not null,
  employee_uuid text not null,
  employee_name text not null default '',
  approver_uuid text,
  approver_name text,
  initiator_uuid text,
  initiator_name text,
  status text not null check (status in ('pending', 'approved', 'declined', 'consumed')),
  policy_uuid text,
  policy_type text,
  employee_note text,
  employer_note text,
  start_date date not null,
  end_date date not null,
  requested_hours numeric(10, 3) not null default 0,
  days jsonb not null default '{}'::jsonb,
  raw jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (site_id, request_uuid)
);

create index if not exists idx_gusto_time_off_site_date
  on public.gusto_time_off_requests (site_id, start_date, end_date, status);

create index if not exists idx_gusto_time_off_site_employee
  on public.gusto_time_off_requests (site_id, employee_uuid, start_date desc);

create index if not exists idx_gusto_time_off_site_company
  on public.gusto_time_off_requests (site_id, company_uuid, start_date desc);

alter table public.gusto_time_off_requests enable row level security;
