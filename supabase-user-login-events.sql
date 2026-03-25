-- User login analytics/audit table for PackPulse.
-- Safe to run multiple times.

create table if not exists public.user_login_events (
  id bigserial primary key,
  site_id text not null,
  user_email text not null,
  user_name text null,
  event_type text not null default 'login',
  auth_provider text null,
  source text null,
  ip_address text null,
  user_agent text null,
  created_at timestamptz not null default now()
);

create index if not exists user_login_events_site_created_idx
  on public.user_login_events (site_id, created_at desc);

create index if not exists user_login_events_site_email_idx
  on public.user_login_events (site_id, user_email, created_at desc);

-- Access is intended through PackPulse server routes using the service role.
alter table public.user_login_events enable row level security;
