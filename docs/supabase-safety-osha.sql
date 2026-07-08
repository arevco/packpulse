-- OSHA / safety recordkeeping schema for PackPulse.
-- Run in Supabase SQL editor.
--
-- Purpose:
-- - site-scoped establishments
-- - incident intake + OSHA case workflow
-- - private employee / medical detail split from shared case rows
-- - annual summary inputs and certification snapshots

create table if not exists public.safety_establishments (
  id uuid primary key default gen_random_uuid(),
  site_id text not null,
  establishment_key text,
  name text not null default '',
  address_line_1 text not null default '',
  address_line_2 text,
  city text not null default '',
  state text not null default '',
  zip text not null default '',
  naics_code text,
  industry_description text,
  jurisdiction_type text not null default 'federal_osha'
    check (jurisdiction_type in ('federal_osha', 'state_plan', 'unknown')),
  default_timezone text not null default 'America/New_York',
  executive_name text,
  executive_title text,
  executive_phone text,
  contact_name text,
  contact_email text,
  contact_phone text,
  active boolean not null default true,
  created_by text,
  created_at timestamptz not null default now(),
  updated_by text,
  updated_at timestamptz not null default now()
);

create unique index if not exists ux_safety_establishments_site_key
  on public.safety_establishments(site_id, establishment_key)
  where establishment_key is not null and btrim(establishment_key) <> '';

create index if not exists idx_safety_establishments_site_active
  on public.safety_establishments(site_id, active, updated_at desc);

create table if not exists public.safety_cases (
  id uuid primary key default gen_random_uuid(),
  site_id text not null,
  establishment_id uuid not null references public.safety_establishments(id) on delete restrict,
  incident_date date not null,
  incident_time time,
  work_started_time time,
  osha_year integer generated always as (extract(year from incident_date)::integer) stored,
  case_number text,
  workflow_status text not null default 'draft'
    check (workflow_status in ('draft', 'submitted', 'under_review', 'recorded', 'closed', 'withdrawn')),
  recordability_status text not null default 'pending'
    check (recordability_status in ('pending', 'recordable', 'non_recordable')),
  severe_report_status text not null default 'not_required'
    check (severe_report_status in ('not_required', 'candidate', 'required', 'reported', 'overdue')),
  is_privacy_case boolean not null default false,
  department text,
  shift text,
  line_area text,
  job_title text,
  location_text text not null default '',
  reporter_name text,
  reporter_email text,
  supervisor_name text,
  supervisor_email text,
  owner_email text,
  short_description text not null default '',
  what_employee_was_doing text,
  what_happened text,
  injury_illness_description text,
  body_part text,
  harm_source text,
  work_related boolean,
  is_new_case boolean,
  loss_of_consciousness boolean not null default false,
  medical_treatment_beyond_first_aid boolean not null default false,
  er_treated boolean not null default false,
  hospitalized_overnight boolean not null default false,
  fatality boolean not null default false,
  amputation boolean not null default false,
  eye_loss boolean not null default false,
  injury_illness_type text
    check (injury_illness_type in ('injury', 'skin_disorder', 'respiratory_condition', 'poisoning', 'hearing_loss', 'all_other_illnesses')),
  most_serious_outcome text
    check (most_serious_outcome in ('death', 'days_away', 'job_transfer_or_restriction', 'other_recordable')),
  days_away_count integer not null default 0 check (days_away_count >= 0),
  days_restricted_count integer not null default 0 check (days_restricted_count >= 0),
  severe_report_required boolean not null default false,
  severe_report_due_at timestamptz,
  severe_reported_at timestamptz,
  severe_report_method text,
  severe_report_reference text,
  next_review_date date,
  classification_answers jsonb not null default '{}'::jsonb,
  intake_snapshot jsonb not null default '{}'::jsonb,
  osha_300_snapshot jsonb not null default '{}'::jsonb,
  osha_301_snapshot jsonb not null default '{}'::jsonb,
  archived boolean not null default false,
  created_by text,
  created_at timestamptz not null default now(),
  updated_by text,
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);

create unique index if not exists ux_safety_cases_case_number
  on public.safety_cases(site_id, establishment_id, osha_year, case_number)
  where case_number is not null and btrim(case_number) <> '';

create index if not exists idx_safety_cases_site_year_date
  on public.safety_cases(site_id, establishment_id, osha_year, incident_date desc, created_at desc);

create index if not exists idx_safety_cases_site_status
  on public.safety_cases(site_id, archived, workflow_status, recordability_status, severe_report_status, updated_at desc);

create index if not exists idx_safety_cases_site_review
  on public.safety_cases(site_id, archived, next_review_date, severe_report_due_at);

create table if not exists public.safety_case_private (
  case_id uuid primary key references public.safety_cases(id) on delete cascade,
  employee_full_name text not null default '',
  employee_identifier text,
  employee_address text,
  date_of_birth date,
  date_hired date,
  sex text check (sex in ('male', 'female', 'other', 'unknown')),
  physician_name text,
  treatment_facility_name text,
  treatment_facility_address text,
  date_of_death date,
  notes_private text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_by text,
  updated_at timestamptz not null default now()
);

create table if not exists public.safety_case_updates (
  id uuid primary key default gen_random_uuid(),
  site_id text not null,
  case_id uuid not null references public.safety_cases(id) on delete cascade,
  update_type text not null
    check (update_type in ('note', 'status_change', 'days_away_update', 'restricted_work_update', 'return_to_work', 'severe_report', 'corrective_action')),
  effective_date date not null,
  workflow_status text
    check (workflow_status in ('draft', 'submitted', 'under_review', 'recorded', 'closed', 'withdrawn')),
  days_away_total integer check (days_away_total is null or days_away_total >= 0),
  days_restricted_total integer check (days_restricted_total is null or days_restricted_total >= 0),
  note text,
  snapshot jsonb not null default '{}'::jsonb,
  created_by text,
  created_at timestamptz not null default now()
);

create index if not exists idx_safety_case_updates_case_date
  on public.safety_case_updates(case_id, effective_date desc, created_at desc);

create index if not exists idx_safety_case_updates_site_date
  on public.safety_case_updates(site_id, effective_date desc, created_at desc);

create table if not exists public.safety_annual_summaries (
  id uuid primary key default gen_random_uuid(),
  site_id text not null,
  establishment_id uuid not null references public.safety_establishments(id) on delete restrict,
  summary_year integer not null check (summary_year >= 2000 and summary_year <= 2100),
  annual_average_employees integer check (annual_average_employees is null or annual_average_employees >= 0),
  total_hours_worked numeric(14,2) check (total_hours_worked is null or total_hours_worked >= 0),
  executive_name text,
  executive_title text,
  executive_phone text,
  posting_status text not null default 'draft'
    check (posting_status in ('draft', 'ready', 'posted', 'submitted')),
  readiness_snapshot jsonb not null default '{}'::jsonb,
  summary_snapshot jsonb not null default '{}'::jsonb,
  certified_at timestamptz,
  posted_at timestamptz,
  ita_exported_at timestamptz,
  ita_submitted_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  updated_by text,
  updated_at timestamptz not null default now()
);

create unique index if not exists ux_safety_annual_summaries_site_est_year
  on public.safety_annual_summaries(site_id, establishment_id, summary_year);

create index if not exists idx_safety_annual_summaries_site_year
  on public.safety_annual_summaries(site_id, summary_year, updated_at desc);

create table if not exists public.safety_attachments (
  id uuid primary key default gen_random_uuid(),
  site_id text not null,
  case_id uuid not null references public.safety_cases(id) on delete cascade,
  storage_bucket text not null default 'safety-attachments',
  storage_path text not null,
  label text,
  mime_type text,
  file_size_bytes bigint,
  is_private boolean not null default true,
  created_by text,
  created_at timestamptz not null default now()
);

create index if not exists idx_safety_attachments_case
  on public.safety_attachments(case_id, created_at desc);

-- Access is intended through PackPulse server routes using the service role.
alter table public.safety_establishments enable row level security;
alter table public.safety_cases enable row level security;
alter table public.safety_case_private enable row level security;
alter table public.safety_case_updates enable row level security;
alter table public.safety_annual_summaries enable row level security;
alter table public.safety_attachments enable row level security;
