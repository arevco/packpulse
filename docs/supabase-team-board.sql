-- Lightweight shared team board for recurring work, onboarding, and misc projects.
-- Run in Supabase SQL editor.

create table if not exists public.team_board_tasks (
  id uuid primary key default gen_random_uuid(),
  site_id text not null,
  board_key text not null check (board_key in ('recurring', 'onboarding', 'projects')),
  title text not null default '',
  status text not null default 'todo' check (status in ('todo', 'working', 'waiting', 'done')),
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  cadence text not null default 'adhoc' check (cadence in ('adhoc', 'daily', 'weekly', 'monthly', 'onboarding')),
  owner_email text,
  due_date date,
  customer_name text,
  project_name text,
  notes text,
  sort_order bigint not null default 0,
  archived boolean not null default false,
  created_by text,
  created_at timestamptz not null default now(),
  updated_by text,
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists idx_team_board_tasks_site_board_status
  on public.team_board_tasks(site_id, board_key, archived, status, sort_order, updated_at desc);

create index if not exists idx_team_board_tasks_site_due
  on public.team_board_tasks(site_id, archived, due_date);

-- Access is intended through PackPulse server routes using the service role.
alter table public.team_board_tasks enable row level security;
