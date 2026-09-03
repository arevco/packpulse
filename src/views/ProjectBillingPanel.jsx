import { useDeferredValue, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ClipboardList, DollarSign, Plus, ReceiptText, RotateCcw, Trash2 } from "lucide-react";

import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader } from "../components/ui/card";
import { Input } from "../components/ui/input";
import TableShell from "../components/ui/table-shell";
import { Textarea } from "../components/ui/textarea";

var money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
var number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

function todayIso() {
  var now = new Date();
  var offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function blankCharge(type) {
  var lineType = type || "labor";
  return {
    id: String(Date.now()) + "-" + Math.random().toString(16).slice(2),
    type: lineType,
    description: "",
    quantity: "",
    unit: lineType === "labor" ? "hours" : lineType === "expense" ? "each" : "job",
    unitCost: "",
    billableRate: "",
    markupPct: "0",
    reference: ""
  };
}

function blankProject() {
  return { customer: "", title: "", occurredOn: todayIso(), purchaseOrder: "", notes: "", charges: [blankCharge("labor")] };
}

function chargeAmount(charge) {
  var quantity = Number(charge.quantity || 0);
  if (charge.type === "expense") return quantity * Number(charge.unitCost || 0) * (1 + Number(charge.markupPct || 0) / 100);
  return quantity * Number(charge.billableRate || 0);
}

async function api(options) {
  var response = await fetch("/api/billing/projects", Object.assign({ credentials: "include" }, options || {}));
  var body = await response.json().catch(function() { return {}; });
  if (!response.ok) throw new Error(body.error || "Project billing request failed");
  return body;
}

function statusBadge(status) {
  if (status === "ready") return <Badge variant="warning">Ready to invoice</Badge>;
  if (status === "invoiced") return <Badge variant="success">Invoiced</Badge>;
  if (status === "cancelled") return <Badge variant="secondary">Cancelled</Badge>;
  return <Badge variant="info">Draft</Badge>;
}

function Field({ label, children }) {
  return <label className="block"><span className="mb-1 block text-xs font-medium text-[rgb(var(--muted))]">{label}</span>{children}</label>;
}

function Metric({ label, value, helper }) {
  return <Card><CardContent className="px-4 py-4"><div className="text-xs font-medium uppercase tracking-[0.12em] text-[rgb(var(--muted))]">{label}</div><div className="mt-2 text-2xl font-semibold text-[rgb(var(--foreground))]">{value}</div><div className="mt-1 text-xs text-[rgb(var(--muted))]">{helper}</div></CardContent></Card>;
}

function ProjectForm({ customerOptions, onCancel, onSaved }) {
  const [draft, setDraft] = useState(blankProject);
  const mutation = useMutation({ mutationFn: function(payload) { return api({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); }, onSuccess: onSaved });
  var total = useMemo(function() { return draft.charges.reduce(function(sum, charge) { return sum + chargeAmount(charge); }, 0); }, [draft.charges]);
  var update = function(field, value) { setDraft(function(old) { return Object.assign({}, old, { [field]: value }); }); };
  var updateCharge = function(id, field, value) {
    setDraft(function(old) { return Object.assign({}, old, { charges: old.charges.map(function(charge) {
      if (charge.id !== id) return charge;
      if (field === "type") return Object.assign({}, blankCharge(value), { id: charge.id, description: charge.description });
      return Object.assign({}, charge, { [field]: value });
    }) }); });
  };
  var valid = draft.customer.trim() && draft.title.trim() && draft.occurredOn && draft.charges.length && draft.charges.every(function(charge) {
    return charge.description.trim() && Number(charge.quantity) > 0 && (charge.type === "expense" ? Number(charge.unitCost) > 0 : Number(charge.billableRate) > 0);
  });
  return <Card className="border-[rgb(var(--accent))]/30">
    <CardHeader className="border-b border-[rgb(var(--border))]"><div className="text-lg font-semibold">New billable project</div><div className="mt-1 text-sm text-[rgb(var(--muted))]">Capture the client, reason, and every labor, purchase, or fixed-fee charge. Totals are calculated automatically.</div></CardHeader>
    <CardContent className="space-y-5 px-4 py-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Field label="Customer *"><select className="h-9 w-full rounded-md border border-[rgb(var(--border))] bg-white px-3 text-sm text-[rgb(var(--foreground))] shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--accent))] focus-visible:ring-offset-1" value={draft.customer} onChange={function(e) { update("customer", e.target.value); }}><option value="">{customerOptions.length ? "Select a Nulogy client" : "No Nulogy clients found"}</option>{customerOptions.map(function(customer) { return <option key={customer} value={customer}>{customer}</option>; })}</select></Field>
        <Field label="Project *"><Input value={draft.title} onChange={function(e) { update("title", e.target.value); }} placeholder="Trailer pallet rebuild" /></Field>
        <Field label="Date *"><Input type="date" value={draft.occurredOn} onChange={function(e) { update("occurredOn", e.target.value); }} /></Field>
        <Field label="Customer PO / approval"><Input value={draft.purchaseOrder} onChange={function(e) { update("purchaseOrder", e.target.value); }} placeholder="Optional reference" /></Field>
      </div>
      <div className="space-y-3">
        <div className="flex items-center justify-between"><div><div className="text-sm font-semibold">Charges</div><div className="text-xs text-[rgb(var(--muted))]">Labor = hours × rate. Expenses = quantity × cost + markup.</div></div><Button variant="outline" size="sm" onClick={function() { update("charges", draft.charges.concat([blankCharge("labor")])); }}><Plus className="h-3.5 w-3.5" />Add charge</Button></div>
        {draft.charges.map(function(charge, index) {
          return <div key={charge.id} className="rounded-md border border-[rgb(var(--border))] bg-slate-50/60 p-3">
            <div className="mb-2 flex items-center justify-between"><div className="text-xs font-semibold uppercase tracking-wide text-[rgb(var(--muted))]">Charge {index + 1}</div>{draft.charges.length > 1 && <Button variant="ghost" size="sm" onClick={function() { update("charges", draft.charges.filter(function(item) { return item.id !== charge.id; })); }} aria-label="Remove charge"><Trash2 className="h-3.5 w-3.5" /></Button>}</div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-12">
              <div className="xl:col-span-2"><Field label="Type"><select className="h-9 w-full rounded-md border border-[rgb(var(--border))] bg-white px-3 text-sm" value={charge.type} onChange={function(e) { updateCharge(charge.id, "type", e.target.value); }}><option value="labor">Labor</option><option value="expense">Expense</option><option value="fixed">Fixed fee</option></select></Field></div>
              <div className="xl:col-span-3"><Field label="Description *"><Input value={charge.description} onChange={function(e) { updateCharge(charge.id, "description", e.target.value); }} placeholder={charge.type === "expense" ? "Labels purchased" : "Rebuild tipped pallets"} /></Field></div>
              <div className="xl:col-span-1"><Field label={charge.type === "labor" ? "Hours *" : "Qty *"}><Input type="number" min="0" step="0.25" value={charge.quantity} onChange={function(e) { updateCharge(charge.id, "quantity", e.target.value); }} /></Field></div>
              <div className="xl:col-span-1"><Field label="Unit"><Input value={charge.unit} onChange={function(e) { updateCharge(charge.id, "unit", e.target.value); }} /></Field></div>
              {charge.type === "expense" ? <><div className="xl:col-span-2"><Field label="Unit cost *"><Input type="number" min="0" step="0.01" value={charge.unitCost} onChange={function(e) { updateCharge(charge.id, "unitCost", e.target.value); }} /></Field></div><div className="xl:col-span-1"><Field label="Markup %"><Input type="number" min="0" step="0.1" value={charge.markupPct} onChange={function(e) { updateCharge(charge.id, "markupPct", e.target.value); }} /></Field></div></> : <div className="xl:col-span-3"><Field label="Billable rate *"><Input type="number" min="0" step="0.01" value={charge.billableRate} onChange={function(e) { updateCharge(charge.id, "billableRate", e.target.value); }} /></Field></div>}
              <div className="xl:col-span-2"><Field label="Line total"><div className="flex h-9 items-center justify-end rounded-md border border-[rgb(var(--border))] bg-white px-3 text-sm font-semibold">{money.format(chargeAmount(charge))}</div></Field></div>
            </div>
            <div className="mt-3"><Field label="Receipt, ticket, or approval reference"><Input value={charge.reference} onChange={function(e) { updateCharge(charge.id, "reference", e.target.value); }} placeholder="Optional evidence reference" /></Field></div>
          </div>;
        })}
      </div>
      <Field label="Internal notes"><Textarea value={draft.notes} onChange={function(e) { update("notes", e.target.value); }} placeholder="What happened, who approved it, or anything accounting needs to know." /></Field>
      {mutation.error && <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{mutation.error.message}</div>}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[rgb(var(--border))] pt-4"><div><div className="text-xs text-[rgb(var(--muted))]">Project total</div><div className="text-2xl font-semibold">{money.format(total)}</div></div><div className="flex gap-2"><Button variant="ghost" onClick={onCancel}>Cancel</Button><Button disabled={!valid || mutation.isPending} onClick={function() { mutation.mutate(draft); }}>{mutation.isPending ? "Saving..." : "Save project"}</Button></div></div>
    </CardContent>
  </Card>;
}

export default function ProjectBillingPanel({ customerOptions = [] }) {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState("open");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const deferredSearch = useDeferredValue(search);
  const query = useQuery({ queryKey: ["project-billing"], queryFn: function() { return api(); } });
  const action = useMutation({ mutationFn: function(payload) { return api({ method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); }, onSuccess: function() { setError(""); queryClient.invalidateQueries({ queryKey: ["project-billing"] }); }, onError: function(actionError) { setError(actionError.message); } });
  var rows = query.data && query.data.rows || [];
  var summary = query.data && query.data.summary || { totalProjects: 0, draftCount: 0, readyCount: 0, invoicedCount: 0, unbilledValue: 0, invoicedValue: 0 };
  var visible = rows.filter(function(row) {
    if (filter === "open" && ["draft", "ready"].indexOf(row.status) === -1) return false;
    if (filter === "invoiced" && row.status !== "invoiced") return false;
    var needle = deferredSearch.trim().toLowerCase();
    return !needle || [row.customer_name, row.title, row.purchase_order_number].join(" ").toLowerCase().indexOf(needle) !== -1;
  });
  var pageSize = 25;
  var pageCount = Math.max(1, Math.ceil(visible.length / pageSize));
  var currentPage = Math.min(page, pageCount);
  var visiblePage = visible.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  var run = function(payload, confirmMessage) { if (!confirmMessage || window.confirm(confirmMessage)) action.mutate(payload); };
  return <div className="space-y-4">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><h2 className="text-xl font-semibold">Projects & Expenses</h2><p className="mt-1 max-w-3xl text-sm text-[rgb(var(--muted))]">Track work outside normal production agreements, collect supporting references, and turn approved charges into an invoice.</p></div><Button onClick={function() { setShowForm(true); }}><Plus className="h-4 w-4" />New billable project</Button></div>
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"><Metric label="Unbilled" value={money.format(summary.unbilledValue)} helper={(summary.draftCount + summary.readyCount) + " open projects"} /><Metric label="Ready" value={summary.readyCount} helper="Approved for invoicing" /><Metric label="Invoiced" value={money.format(summary.invoicedValue)} helper={summary.invoicedCount + " invoices created"} /><Metric label="Projects" value={summary.totalProjects} helper="All captured work" /></div>
    {showForm && <ProjectForm customerOptions={customerOptions} onCancel={function() { setShowForm(false); }} onSaved={function() { setShowForm(false); queryClient.invalidateQueries({ queryKey: ["project-billing"] }); }} />}
    {(error || query.error) && <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error || query.error.message}</div>}
    {query.data && query.data.status === "missing_table" && <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"><strong>Database setup required.</strong> Apply migration <code>20260903143000_project_billing.sql</code>, then refresh this page.</div>}
    <Card>
      <CardHeader className="flex flex-col gap-3 border-b border-[rgb(var(--border))] sm:flex-row sm:items-center"><div className="flex gap-1 rounded-md border border-[rgb(var(--border))] p-1">{[["open","Open"],["invoiced","Invoiced"],["all","All"]].map(function(item) { return <button key={item[0]} className={"rounded px-3 py-1.5 text-sm " + (filter === item[0] ? "bg-slate-900 text-white" : "text-[rgb(var(--muted))] hover:bg-slate-100")} onClick={function() { setFilter(item[0]); setPage(1); }}>{item[1]}</button>; })}</div><div className="sm:ml-auto sm:w-72"><Input value={search} onChange={function(e) { setSearch(e.target.value); setPage(1); }} placeholder="Search customer, project, or PO" /></div></CardHeader>
      <TableShell className="border-0 rounded-none"><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-[rgb(var(--muted))]"><tr><th className="px-4 py-3">Project / Customer</th><th className="px-4 py-3">Charges</th><th className="px-4 py-3">Date / PO</th><th className="px-4 py-3 text-right">Total</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Action</th></tr></thead><tbody>
        {query.isLoading ? <tr><td colSpan="6" className="p-10 text-center text-[rgb(var(--muted))]">Loading project billing…</td></tr> : !visible.length ? <tr><td colSpan="6" className="p-10 text-center text-[rgb(var(--muted))]"><ClipboardList className="mx-auto mb-2 h-7 w-7" />No projects in this view.</td></tr> : visiblePage.map(function(row) {
          var invoice = Array.isArray(row.billing_invoices) ? row.billing_invoices[0] : row.billing_invoices;
          return <tr key={row.id} className="border-t border-[rgb(var(--border))] align-top"><td className="px-4 py-4"><div className="font-semibold">{row.title}</div><div className="mt-0.5 text-xs text-[rgb(var(--muted))]">{row.customer_name}</div>{row.notes && <div className="mt-2 max-w-md text-xs text-[rgb(var(--muted))]">{row.notes}</div>}</td><td className="min-w-72 px-4 py-4"><div className="space-y-2">{(row.billing_project_charges || []).map(function(charge) { return <div key={charge.id} className="flex justify-between gap-3"><div><span className="font-medium">{charge.description}</span><div className="text-xs text-[rgb(var(--muted))]">{charge.line_type === "labor" ? number.format(charge.quantity) + " hours × " + money.format(charge.billable_rate) : charge.line_type === "expense" ? number.format(charge.quantity) + " × " + money.format(charge.unit_cost) + (Number(charge.markup_pct) ? " + " + number.format(charge.markup_pct) + "%" : "") : number.format(charge.quantity) + " × " + money.format(charge.billable_rate)}</div></div><span className="font-medium">{money.format(charge.amount)}</span></div>; })}</div></td><td className="px-4 py-4"><div>{row.occurred_on}</div><div className="text-xs text-[rgb(var(--muted))]">{row.purchase_order_number || "No PO reference"}</div>{invoice && <div className="mt-2 font-medium text-[rgb(var(--accent))]">{invoice.invoice_number}</div>}{invoice && <div className="text-xs text-[rgb(var(--muted))]">Due {invoice.due_date}</div>}</td><td className="px-4 py-4 text-right text-base font-semibold">{money.format(row.total_amount)}</td><td className="px-4 py-4">{statusBadge(row.status)}{invoice && invoice.status === "paid" && <div className="mt-2"><Badge variant="success">Paid</Badge></div>}</td><td className="px-4 py-4"><div className="flex justify-end gap-2">{row.status === "draft" && <Button size="sm" onClick={function() { run({ action: "set_status", projectId: row.id, status: "ready" }); }}><Check className="h-3.5 w-3.5" />Mark ready</Button>}{row.status === "ready" && <><Button variant="ghost" size="sm" onClick={function() { run({ action: "set_status", projectId: row.id, status: "draft" }); }}><RotateCcw className="h-3.5 w-3.5" />Reopen</Button><Button size="sm" onClick={function() { run({ action: "create_invoice", projectId: row.id }, "Create and issue an invoice for " + money.format(row.total_amount) + " to " + row.customer_name + "?"); }}><ReceiptText className="h-3.5 w-3.5" />Create invoice</Button></>}{row.status === "invoiced" && invoice && invoice.status === "issued" && <Button size="sm" onClick={function() { run({ action: "mark_paid", projectId: row.id }, "Mark invoice " + invoice.invoice_number + " as paid?"); }}><DollarSign className="h-3.5 w-3.5" />Mark paid</Button>}</div></td></tr>;
        })}
      </tbody></table></div>{visible.length > pageSize && <div className="flex items-center justify-between border-t border-[rgb(var(--border))] px-4 py-3"><div className="text-xs text-[rgb(var(--muted))]">Page {currentPage} of {pageCount} · {visible.length} projects</div><div className="flex gap-2"><Button variant="outline" size="sm" disabled={currentPage <= 1} onClick={function() { setPage(currentPage - 1); }}>Previous</Button><Button variant="outline" size="sm" disabled={currentPage >= pageCount} onClick={function() { setPage(currentPage + 1); }}>Next</Button></div></div>}</TableShell>
    </Card>
  </div>;
}
