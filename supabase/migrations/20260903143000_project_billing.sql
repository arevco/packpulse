-- Ad-hoc client projects, pass-through expenses, and immutable invoice snapshots.
create sequence if not exists public.billing_invoice_number_seq start 1001;

create table if not exists public.billing_projects (
  id uuid primary key default gen_random_uuid(),
  site_id text not null,
  customer_name text not null,
  title text not null,
  occurred_on date not null,
  purchase_order_number text not null default '',
  notes text not null default '',
  status text not null default 'draft' check (status in ('draft', 'ready', 'invoiced', 'cancelled')),
  total_amount numeric(14,2) not null default 0 check (total_amount >= 0),
  created_by text not null default '',
  updated_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.billing_project_charges (
  id uuid primary key default gen_random_uuid(),
  site_id text not null,
  project_id uuid not null references public.billing_projects(id) on delete cascade,
  line_number integer not null check (line_number > 0),
  line_type text not null check (line_type in ('labor', 'expense', 'fixed')),
  description text not null,
  quantity numeric(14,4) not null check (quantity > 0),
  unit text not null,
  unit_cost numeric(14,4) not null default 0 check (unit_cost >= 0),
  billable_rate numeric(14,4) not null default 0 check (billable_rate >= 0),
  markup_pct numeric(8,4) not null default 0 check (markup_pct >= 0),
  reference text not null default '',
  amount numeric(14,2) generated always as (
    round(case when line_type = 'expense'
      then quantity * unit_cost * (1 + markup_pct / 100)
      else quantity * billable_rate end, 2)
  ) stored,
  created_at timestamptz not null default now(),
  unique (project_id, line_number)
);

create table if not exists public.billing_invoices (
  id uuid primary key default gen_random_uuid(),
  site_id text not null,
  project_id uuid not null unique references public.billing_projects(id),
  invoice_number text not null,
  customer_name text not null,
  purchase_order_number text not null default '',
  status text not null default 'issued' check (status in ('issued', 'paid', 'void')),
  invoice_date date not null default current_date,
  due_date date not null default (current_date + 30),
  subtotal numeric(14,2) not null check (subtotal >= 0),
  total numeric(14,2) not null check (total >= 0),
  notes text not null default '',
  issued_by text not null default '',
  paid_at timestamptz,
  updated_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (site_id, invoice_number)
);

create table if not exists public.billing_invoice_lines (
  id uuid primary key default gen_random_uuid(),
  site_id text not null,
  invoice_id uuid not null references public.billing_invoices(id) on delete cascade,
  source_charge_id uuid references public.billing_project_charges(id),
  line_number integer not null,
  line_type text not null,
  description text not null,
  quantity numeric(14,4) not null,
  unit text not null,
  unit_rate numeric(14,4) not null,
  amount numeric(14,2) not null,
  reference text not null default '',
  created_at timestamptz not null default now(),
  unique (invoice_id, line_number)
);

create index if not exists idx_billing_projects_site_status_date on public.billing_projects(site_id, status, occurred_on desc);
create index if not exists idx_billing_charges_project on public.billing_project_charges(project_id, line_number);
create index if not exists idx_billing_invoices_site_status on public.billing_invoices(site_id, status, invoice_date desc);

alter table public.billing_projects enable row level security;
alter table public.billing_project_charges enable row level security;
alter table public.billing_invoices enable row level security;
alter table public.billing_invoice_lines enable row level security;

revoke all on table public.billing_projects, public.billing_project_charges, public.billing_invoices, public.billing_invoice_lines from anon, authenticated;
grant select, insert, update, delete on table public.billing_projects, public.billing_project_charges, public.billing_invoices, public.billing_invoice_lines to service_role;
grant usage, select on sequence public.billing_invoice_number_seq to service_role;

create or replace function public.create_billing_project(
  p_site_id text, p_customer_name text, p_title text, p_occurred_on date,
  p_purchase_order_number text, p_notes text, p_charges jsonb, p_actor text
) returns uuid
language plpgsql security invoker set search_path = public
as $$
declare
  v_project_id uuid;
  v_charge jsonb;
  v_line_number integer := 0;
  v_line_type text;
begin
  if nullif(trim(p_customer_name), '') is null or nullif(trim(p_title), '') is null or p_occurred_on is null then
    raise exception 'Customer, project title, and project date are required';
  end if;
  if p_charges is null or jsonb_typeof(p_charges) <> 'array' then
    raise exception 'Charges must be an array';
  end if;
  if jsonb_array_length(p_charges) = 0 then
    raise exception 'At least one charge is required';
  end if;

  insert into public.billing_projects (
    site_id, customer_name, title, occurred_on, purchase_order_number, notes, created_by, updated_by
  ) values (
    p_site_id, trim(p_customer_name), trim(p_title), p_occurred_on,
    coalesce(trim(p_purchase_order_number), ''), coalesce(trim(p_notes), ''), coalesce(p_actor, ''), coalesce(p_actor, '')
  ) returning id into v_project_id;

  for v_charge in select value from jsonb_array_elements(p_charges)
  loop
    v_line_number := v_line_number + 1;
    v_line_type := lower(coalesce(v_charge->>'type', 'fixed'));
    if v_line_type not in ('labor', 'expense', 'fixed') then raise exception 'Invalid charge type'; end if;
    if nullif(trim(v_charge->>'description'), '') is null then raise exception 'Charge description is required'; end if;
    if coalesce((v_charge->>'quantity')::numeric, 0) <= 0 then raise exception 'Charge quantity must be positive'; end if;
    if v_line_type = 'expense' and coalesce((v_charge->>'unitCost')::numeric, 0) <= 0 then raise exception 'Expense unit cost must be positive'; end if;
    if v_line_type <> 'expense' and coalesce((v_charge->>'billableRate')::numeric, 0) <= 0 then raise exception 'Billable rate must be positive'; end if;
    insert into public.billing_project_charges (
      site_id, project_id, line_number, line_type, description, quantity, unit,
      unit_cost, billable_rate, markup_pct, reference
    ) values (
      p_site_id, v_project_id, v_line_number, v_line_type, trim(v_charge->>'description'),
      (v_charge->>'quantity')::numeric, coalesce(nullif(trim(v_charge->>'unit'), ''), 'each'),
      case when v_line_type = 'expense' then coalesce((v_charge->>'unitCost')::numeric, 0) else 0 end,
      case when v_line_type <> 'expense' then coalesce((v_charge->>'billableRate')::numeric, 0) else 0 end,
      case when v_line_type = 'expense' then coalesce((v_charge->>'markupPct')::numeric, 0) else 0 end,
      coalesce(trim(v_charge->>'reference'), '')
    );
  end loop;

  update public.billing_projects p set
    total_amount = (select coalesce(sum(c.amount), 0) from public.billing_project_charges c where c.project_id = v_project_id),
    updated_at = now()
  where p.id = v_project_id;
  return v_project_id;
end;
$$;

create or replace function public.set_billing_project_status(
  p_site_id text, p_project_id uuid, p_status text, p_actor text
) returns void
language plpgsql security invoker set search_path = public
as $$
begin
  if p_status not in ('draft', 'ready', 'cancelled') then raise exception 'Invalid project status'; end if;
  update public.billing_projects set status = p_status, updated_by = coalesce(p_actor, ''), updated_at = now()
  where id = p_project_id and site_id = p_site_id and status <> 'invoiced';
  if not found then raise exception 'Project cannot be updated'; end if;
end;
$$;

create or replace function public.create_project_invoice(
  p_site_id text, p_project_id uuid, p_actor text
) returns jsonb
language plpgsql security invoker set search_path = public
as $$
declare
  v_project public.billing_projects%rowtype;
  v_invoice_id uuid;
  v_invoice_number text;
begin
  select * into v_project from public.billing_projects
  where id = p_project_id and site_id = p_site_id for update;
  if not found then raise exception 'Project not found'; end if;
  if v_project.status <> 'ready' then raise exception 'Only a ready project can be invoiced'; end if;
  if v_project.total_amount <= 0 then raise exception 'Invoice total must be greater than zero'; end if;

  v_invoice_number := 'PP-' || to_char(current_date, 'YYYY') || '-' || lpad(nextval('public.billing_invoice_number_seq')::text, 6, '0');
  insert into public.billing_invoices (
    site_id, project_id, invoice_number, customer_name, purchase_order_number,
    subtotal, total, notes, issued_by, updated_by
  ) values (
    p_site_id, v_project.id, v_invoice_number, v_project.customer_name, v_project.purchase_order_number,
    v_project.total_amount, v_project.total_amount, v_project.notes, coalesce(p_actor, ''), coalesce(p_actor, '')
  ) returning id into v_invoice_id;

  insert into public.billing_invoice_lines (
    site_id, invoice_id, source_charge_id, line_number, line_type, description,
    quantity, unit, unit_rate, amount, reference
  ) select
    p_site_id, v_invoice_id, c.id, c.line_number, c.line_type, c.description,
    c.quantity, c.unit,
    case when c.line_type = 'expense' then round(c.unit_cost * (1 + c.markup_pct / 100), 4) else c.billable_rate end,
    c.amount, c.reference
  from public.billing_project_charges c where c.project_id = v_project.id order by c.line_number;

  update public.billing_projects set status = 'invoiced', updated_by = coalesce(p_actor, ''), updated_at = now()
  where id = v_project.id;
  return jsonb_build_object('id', v_invoice_id, 'invoiceNumber', v_invoice_number, 'total', v_project.total_amount);
end;
$$;

create or replace function public.set_billing_invoice_status(
  p_site_id text, p_project_id uuid, p_status text, p_actor text
) returns void
language plpgsql security invoker set search_path = public
as $$
begin
  if p_status not in ('paid', 'void') then raise exception 'Invalid invoice status'; end if;
  update public.billing_invoices set
    status = p_status,
    paid_at = case when p_status = 'paid' then now() else null end,
    updated_by = coalesce(p_actor, ''), updated_at = now()
  where project_id = p_project_id and site_id = p_site_id and status = 'issued';
  if not found then raise exception 'Issued invoice not found'; end if;
end;
$$;

revoke all on function public.create_billing_project(text,text,text,date,text,text,jsonb,text) from public;
revoke all on function public.set_billing_project_status(text,uuid,text,text) from public;
revoke all on function public.create_project_invoice(text,uuid,text) from public;
revoke all on function public.set_billing_invoice_status(text,uuid,text,text) from public;
revoke all on function public.create_billing_project(text,text,text,date,text,text,jsonb,text) from anon, authenticated;
revoke all on function public.set_billing_project_status(text,uuid,text,text) from anon, authenticated;
revoke all on function public.create_project_invoice(text,uuid,text) from anon, authenticated;
revoke all on function public.set_billing_invoice_status(text,uuid,text,text) from anon, authenticated;
grant execute on function public.create_billing_project(text,text,text,date,text,text,jsonb,text) to service_role;
grant execute on function public.set_billing_project_status(text,uuid,text,text) to service_role;
grant execute on function public.create_project_invoice(text,uuid,text) to service_role;
grant execute on function public.set_billing_invoice_status(text,uuid,text,text) to service_role;
