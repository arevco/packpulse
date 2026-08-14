import { Fragment, useCallback, useDeferredValue, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, Check, ChevronLeft, ChevronRight, FileSpreadsheet, FileText,
  Link2, Loader2, MessageSquare, Paperclip, Pencil, Plus, RefreshCw, Search, Send, Upload, X
} from "lucide-react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import TableShell from "../components/ui/table-shell";
import { cn } from "../lib/utils";
import QuotesPanel from "./QuotesPanel";

var ACCEPT = ".pdf,.jpg,.jpeg,.png,.csv,.xls,.xlsx";
var ONBOARDING_ACCEPT = ".pdf,.doc,.docx,.xls,.xlsx,.csv,.jpg,.jpeg,.png";
var TABS = [
  { key: "open", label: "Open" },
  { key: "suggested_closed", label: "Suggested closed" },
  { key: "closed", label: "Closed" },
  { key: "cancelled", label: "Cancelled" },
  { key: "all", label: "All" }
];

function api(path, options) {
  return fetch(path, Object.assign({ credentials: "include" }, options || {})).then(async function(response) {
    var body = await response.json().catch(function() { return {}; });
    if (!response.ok) {
      var error = new Error(body.error || ("Request failed (" + response.status + ")"));
      error.body = body;
      throw error;
    }
    return body;
  });
}

function base64File(file) {
  return new Promise(function(resolve, reject) {
    var reader = new FileReader();
    reader.onload = function() {
      resolve(String(reader.result || "").split(",")[1] || "");
    };
    reader.onerror = function() { reject(reader.error || new Error("Could not read file")); };
    reader.readAsDataURL(file);
  });
}

function formatMoney(value, currency) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "USD" }).format(Number(value || 0));
  } catch (_error) {
    return "$" + Number(value || 0).toFixed(2);
  }
}

function formatNumber(value) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(Number(value || 0));
}

function statusBadge(status, suggested) {
  if (status === "open" && suggested === "closed") return <Badge variant="warning">Suggested closed</Badge>;
  if (status === "closed") return <Badge variant="success">Closed</Badge>;
  if (status === "cancelled") return <Badge variant="secondary">Cancelled</Badge>;
  return <Badge variant="outline">Open</Badge>;
}

function blankLine() {
  return { sku: "", description: "", quantity: 0, uom: "", unitRate: 0, taxAmount: 0, lineAmount: 0, expectedDate: "" };
}

function normalizeDraft(data) {
  var draft = Object.assign({
    customerName: "", poNumber: "", poDate: "", expectedDate: "", vendor: "",
    billTo: "", shipTo: "", memo: "", terms: "", fob: "", shippingMethod: "",
    currency: "USD", subtotal: 0, taxTotal: 0, total: 0, lines: [blankLine()], warnings: []
  }, data || {});
  draft.lines = Array.isArray(draft.lines) && draft.lines.length ? draft.lines.map(function(line) {
    return Object.assign(blankLine(), line);
  }) : [blankLine()];
  return draft;
}

function UploadReview({ staged, onClose, onConfirmed }) {
  const [draft, setDraft] = useState(function() { return normalizeDraft(staged.extracted); });
  const mutation = useMutation({
    mutationFn: function() {
      return api("/api/purchase-orders/" + staged.revision.id + "/confirm", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: draft })
      });
    },
    onSuccess: onConfirmed
  });
  var update = function(field, value) { setDraft(function(old) { return Object.assign({}, old, { [field]: value }); }); };
  var updateLine = function(index, field, value) {
    setDraft(function(old) {
      var lines = old.lines.slice();
      lines[index] = Object.assign({}, lines[index], { [field]: value });
      if (field === "quantity" || field === "unitRate") {
        lines[index].lineAmount = Number(lines[index].quantity || 0) * Number(lines[index].unitRate || 0);
      }
      var subtotal = lines.reduce(function(sum, line) { return sum + Number(line.lineAmount || 0); }, 0);
      return Object.assign({}, old, { lines: lines, subtotal: subtotal, total: subtotal + Number(old.taxTotal || 0) });
    });
  };
  var requiredMissing = !draft.customerName || !draft.poNumber || !draft.poDate ||
    !draft.lines.length || draft.lines.some(function(line) { return !line.description || !(Number(line.quantity) > 0) || !line.uom; });
  return (
    <div className="fixed inset-0 z-50 flex bg-slate-950/40 p-3 backdrop-blur-sm">
      <div className="m-auto flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--background))] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[rgb(var(--border))] px-5 py-3">
          <div>
            <div className="font-semibold">Review extracted purchase order</div>
            <div className="text-xs text-[rgb(var(--muted))]">{staged.revision.original_file_name}</div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>
        <div className="grid min-h-0 flex-1 gap-4 overflow-auto p-5 lg:grid-cols-[0.85fr_1.35fr]">
          <Card className="min-h-[420px] overflow-hidden">
            <CardHeader className="border-b border-[rgb(var(--border))] text-sm font-semibold">Original document</CardHeader>
            <div className="flex h-[520px] items-center justify-center bg-slate-50 p-3">
              {staged.documentUrl && staged.revision.content_type === "application/pdf" ? (
                <iframe title="Purchase order preview" className="h-full w-full rounded bg-white" src={staged.documentUrl} />
              ) : staged.documentUrl && staged.revision.content_type.indexOf("image/") === 0 ? (
                <img alt="Purchase order preview" className="max-h-full max-w-full object-contain" src={staged.documentUrl} />
              ) : <div className="max-w-sm text-center">
                {staged.revision.content_type.indexOf("spreadsheet") !== -1 || staged.revision.content_type.indexOf("csv") !== -1
                  ? <FileSpreadsheet className="mx-auto h-14 w-14 text-[rgb(var(--muted))]" />
                  : <FileText className="mx-auto h-14 w-14 text-[rgb(var(--muted))]" />}
                <div className="mt-3 font-medium">{staged.revision.original_file_name}</div>
                <div className="mt-1 text-xs text-[rgb(var(--muted))]">The private original will be available in the saved PO detail view.</div>
              </div>}
            </div>
          </Card>
          <div className="space-y-4">
            {draft.warnings && draft.warnings.length > 0 && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                <div className="mb-1 flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" />Review warnings</div>
                {draft.warnings.map(function(warning, index) { return <div key={index}>• {warning}</div>; })}
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Customer *" value={draft.customerName} onChange={function(v) { update("customerName", v); }} />
              <Field label="PO number *" value={draft.poNumber} onChange={function(v) { update("poNumber", v); }} />
              <Field label="PO date *" type="date" value={draft.poDate} onChange={function(v) { update("poDate", v); }} />
              <Field label="Expected / receive-by" type="date" value={draft.expectedDate} onChange={function(v) { update("expectedDate", v); }} />
              <Field label="Vendor" value={draft.vendor} onChange={function(v) { update("vendor", v); }} />
              <Field label="Currency" value={draft.currency} onChange={function(v) { update("currency", v.toUpperCase().slice(0, 3)); }} />
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between">
                <div className="text-sm font-semibold">Line items</div>
                <Button variant="outline" size="sm" onClick={function() { setDraft(function(old) { return Object.assign({}, old, { lines: old.lines.concat([blankLine()]) }); }); }}>
                  <Plus className="mr-1 h-3.5 w-3.5" />Add line
                </Button>
              </div>
              <div className="space-y-3">
                {draft.lines.map(function(line, index) {
                  return (
                    <div key={index} className="rounded-md border border-[rgb(var(--border))] p-3">
                      <div className="mb-2 flex items-center justify-between text-xs font-semibold text-[rgb(var(--muted))]">
                        <span>LINE {index + 1}</span>
                        {draft.lines.length > 1 && <button onClick={function() { setDraft(function(old) { return Object.assign({}, old, { lines: old.lines.filter(function(_, i) { return i !== index; }) }); }); }}><X className="h-4 w-4" /></button>}
                      </div>
                      <div className="grid gap-2 sm:grid-cols-6">
                        <div className="sm:col-span-2"><Field label="Description *" value={line.description} onChange={function(v) { updateLine(index, "description", v); }} /></div>
                        <Field label="SKU" value={line.sku} onChange={function(v) { updateLine(index, "sku", v); }} />
                        <Field label="Quantity *" type="number" value={line.quantity} onChange={function(v) { updateLine(index, "quantity", Number(v)); }} />
                        <Field label="UOM *" value={line.uom} onChange={function(v) { updateLine(index, "uom", v); }} />
                        <Field label="Unit rate" type="number" value={line.unitRate} onChange={function(v) { updateLine(index, "unitRate", Number(v)); }} />
                      </div>
                      <div className="mt-2 text-right text-sm font-semibold">{formatMoney(line.lineAmount, draft.currency)}</div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Subtotal" type="number" value={draft.subtotal} disabled />
              <Field label="Tax" type="number" value={draft.taxTotal} onChange={function(v) { var tax = Number(v); setDraft(function(old) { return Object.assign({}, old, { taxTotal: tax, total: Number(old.subtotal || 0) + tax }); }); }} />
              <Field label="Calculated total" type="number" value={draft.total} disabled />
            </div>
            {mutation.error && <div className="text-sm text-red-600">{mutation.error.message}</div>}
          </div>
        </div>
        <div className="flex items-center justify-between border-t border-[rgb(var(--border))] px-5 py-3">
          <div className="text-xs text-[rgb(var(--muted))]">Saving confirms the extraction and opens the PO.</div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button disabled={requiredMissing || mutation.isPending} onClick={function() { mutation.mutate(); }}>
              {mutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}Confirm and save
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type, disabled }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-[rgb(var(--muted))]">{label}</span>
      <Input type={type || "text"} value={value == null ? "" : value} disabled={disabled} step={type === "number" ? "any" : undefined}
        onChange={function(event) { if (onChange) onChange(event.target.value); }} />
    </label>
  );
}

function EditPurchaseOrder({ data, onCancel, onSave, saving, error }) {
  const [draft, setDraft] = useState(function() {
    var initial = normalizeDraft({
      customerName: data.purchaseOrder.customer_name, poNumber: data.purchaseOrder.po_number,
      poDate: data.purchaseOrder.po_date, expectedDate: data.purchaseOrder.expected_date,
      currency: data.purchaseOrder.currency, taxTotal: Number(data.purchaseOrder.tax_total || 0),
      lines: data.lines.filter(function(line) { return line.active; }).map(function(line) { return {
        id: line.id, sku: line.sku || "", description: line.description || "", quantity: Number(line.quantity || 0),
        uom: line.uom || "", unitRate: Number(line.unit_rate || 0), taxAmount: Number(line.tax_amount || 0),
        lineAmount: Number(line.line_amount || 0), expectedDate: line.expected_date || ""
      }; })
    });
    initial.subtotal = initial.lines.reduce(function(sum, line) { return sum + Number(line.quantity || 0) * Number(line.unitRate || 0); }, 0);
    initial.total = initial.subtotal + Number(initial.taxTotal || 0);
    return initial;
  });
  var recalculate = function(lines, tax) {
    var subtotal = lines.reduce(function(sum, line) { return sum + Number(line.quantity || 0) * Number(line.unitRate || 0); }, 0);
    return { lines: lines.map(function(line) { return Object.assign({}, line, { lineAmount: Number(line.quantity || 0) * Number(line.unitRate || 0) }); }), subtotal: subtotal, taxTotal: tax, total: subtotal + tax };
  };
  var update = function(field, value) { setDraft(function(old) { return Object.assign({}, old, { [field]: value }); }); };
  var updateLine = function(index, field, value) { setDraft(function(old) {
    var lines = old.lines.slice();
    lines[index] = Object.assign({}, lines[index], { [field]: value });
    return Object.assign({}, old, recalculate(lines, Number(old.taxTotal || 0)));
  }); };
  var missing = !draft.customerName || !draft.poNumber || !draft.poDate || !draft.lines.length || draft.lines.some(function(line) {
    return !line.description || !(Number(line.quantity) > 0) || !line.uom;
  });
  return <section className="space-y-4 rounded-md border border-blue-200 bg-blue-50/40 p-4">
    <div><div className="font-semibold">Edit purchase order</div><div className="text-xs text-[rgb(var(--muted))]">Changes update the register and are recorded in audit history. The original document is preserved.</div></div>
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Customer *" value={draft.customerName} onChange={function(v) { update("customerName", v); }} />
      <Field label="PO number *" value={draft.poNumber} onChange={function(v) { update("poNumber", v); }} />
      <Field label="PO date *" type="date" value={draft.poDate} onChange={function(v) { update("poDate", v); }} />
      <Field label="Expected / receive-by" type="date" value={draft.expectedDate} onChange={function(v) { update("expectedDate", v); }} />
      <Field label="Currency" value={draft.currency} onChange={function(v) { update("currency", v.toUpperCase().slice(0, 3)); }} />
      <Field label="Tax" type="number" value={draft.taxTotal} onChange={function(v) { var tax = Number(v); setDraft(function(old) { return Object.assign({}, old, recalculate(old.lines, tax)); }); }} />
    </div>
    <div className="space-y-3">
      <div className="flex items-center justify-between"><div className="text-sm font-semibold">Line items</div><Button variant="outline" size="sm" onClick={function() { setDraft(function(old) { return Object.assign({}, old, recalculate(old.lines.concat([blankLine()]), Number(old.taxTotal || 0))); }); }}><Plus className="mr-1 h-3.5 w-3.5" />Add line</Button></div>
      {draft.lines.map(function(line, index) { return <div key={line.id || "new-" + index} className="rounded-md border border-[rgb(var(--border))] bg-[rgb(var(--background))] p-3">
        <div className="mb-2 flex justify-between text-xs font-semibold text-[rgb(var(--muted))]"><span>LINE {index + 1}</span>{draft.lines.length > 1 && <button type="button" onClick={function() { setDraft(function(old) { return Object.assign({}, old, recalculate(old.lines.filter(function(_, i) { return i !== index; }), Number(old.taxTotal || 0))); }); }}><X className="h-4 w-4" /></button>}</div>
        <div className="grid gap-2 sm:grid-cols-6"><div className="sm:col-span-2"><Field label="Description *" value={line.description} onChange={function(v) { updateLine(index, "description", v); }} /></div><Field label="SKU" value={line.sku} onChange={function(v) { updateLine(index, "sku", v); }} /><Field label="Quantity *" type="number" value={line.quantity} onChange={function(v) { updateLine(index, "quantity", Number(v)); }} /><Field label="UOM *" value={line.uom} onChange={function(v) { updateLine(index, "uom", v); }} /><Field label="Unit rate" type="number" value={line.unitRate} onChange={function(v) { updateLine(index, "unitRate", Number(v)); }} /></div>
      </div>; })}
    </div>
    <div className="flex items-center justify-between"><div className="text-sm"><span className="text-[rgb(var(--muted))]">Calculated total: </span><strong>{formatMoney(draft.total, draft.currency)}</strong></div><div className="flex gap-2"><Button variant="outline" onClick={onCancel}>Cancel</Button><Button disabled={missing || saving} onClick={function() { onSave(draft); }}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save changes</Button></div></div>
    {error && <div className="text-sm text-red-600">{error.message}</div>}
  </section>;
}

function ReconciliationReview({ preview, onCancel, onApply, saving, error }) {
  const [selections, setSelections] = useState(function() {
    var initial = {};
    (preview.lines || []).forEach(function(line) { initial[line.id] = line.selectedItemCode || ""; });
    return initial;
  });
  var selectedCandidate = function(line) {
    return (line.candidates || []).find(function(candidate) { return candidate.itemCode === selections[line.id]; });
  };
  return <section className="space-y-4 rounded-md border border-blue-200 bg-blue-50/40 p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><div className="font-semibold">Review production matches</div><div className="text-xs text-[rgb(var(--muted))]">Only Nulogy records with exact PO number {preview.poNumber} are included.</div></div>
      <div className="flex gap-2 text-xs"><Badge variant="outline">{preview.jobCount} jobs</Badge><Badge variant="outline">{preview.candidateItemCount} items</Badge></div>
    </div>
    {preview.message ? <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">{preview.message}</div> : <div className="space-y-3">
      {preview.lines.map(function(line) {
        var selected = selectedCandidate(line);
        return <div key={line.id} className="rounded-md border border-[rgb(var(--border))] bg-[rgb(var(--background))] p-3">
          <div className="flex flex-wrap justify-between gap-2"><div><div className="font-medium">{line.sku || "No SKU"} · {line.description}</div><div className="text-xs text-[rgb(var(--muted))]">Ordered {formatNumber(line.ordered)}</div></div>{line.selectionSource === "exact_sku" && <Badge variant="success">Exact SKU suggested</Badge>}{line.selectionSource === "reviewed" && <Badge variant="outline">Reviewed mapping</Badge>}</div>
          <label className="mt-3 block"><span className="mb-1 block text-xs font-medium text-[rgb(var(--muted))]">Production item</span><select className="h-10 w-full rounded-md border border-[rgb(var(--border))] bg-white px-3 text-sm" value={selections[line.id] || ""} onChange={function(event) { var value = event.target.value; setSelections(function(old) { return Object.assign({}, old, { [line.id]: value }); }); }}><option value="">Leave unmatched</option>{line.candidates.map(function(candidate) { return <option key={candidate.itemKey} value={candidate.itemCode}>{candidate.itemCode} · {formatNumber(candidate.produced)} produced · {candidate.jobCount} job{candidate.jobCount === 1 ? "" : "s"}</option>; })}</select></label>
          {selected && <div className="mt-3 overflow-hidden rounded border border-[rgb(var(--border))]"><div className="bg-slate-50 px-3 py-2 text-xs font-semibold uppercase text-[rgb(var(--muted))]">Included jobs</div>{selected.jobs.map(function(job) { return <div key={job.jobId + ":" + job.workOrderCode} className="flex flex-wrap justify-between gap-2 border-t border-[rgb(var(--border))] px-3 py-2 text-xs"><span><strong>Job {job.jobId}</strong>{job.workOrderCode ? " · WO " + job.workOrderCode : ""}{job.line ? " · " + job.line : ""}</span><span>{formatNumber(job.produced)} produced{job.firstProducedDate ? " · " + job.firstProducedDate : ""}</span></div>; })}</div>}
        </div>;
      })}
    </div>}
    {error && <div className="text-sm text-red-600">{error.message}</div>}
    <div className="flex justify-end gap-2"><Button variant="outline" onClick={onCancel}>Cancel</Button><Button disabled={saving || !preview.productionRowCount} onClick={function() { onApply(Object.keys(selections).map(function(lineId) { return { lineId: lineId, productionItemCode: selections[lineId] || "" }; })); }}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Apply matches</Button></div>
  </section>;
}

function WorkOrderMatchingReview({ preview, onCancel, onApply, saving, error }) {
  const [selections, setSelections] = useState(function() {
    var initial = {};
    (preview.lines || []).forEach(function(line) {
      var candidateCodes = {};
      (line.candidates || []).forEach(function(candidate) { candidateCodes[candidate.code] = true; });
      initial[line.id] = (line.selectedWorkOrderCodes || []).filter(function(code) { return candidateCodes[code]; });
    });
    return initial;
  });
  var toggle = function(lineId, code) {
    setSelections(function(old) {
      var selected = old[lineId] || [];
      var next = selected.indexOf(code) === -1 ? selected.concat([code]) : selected.filter(function(value) { return value !== code; });
      return Object.assign({}, old, { [lineId]: next });
    });
  };
  return <section className="space-y-4 rounded-md border border-indigo-200 bg-indigo-50/40 p-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="font-semibold">Match Work Orders to this PO</div><div className="text-xs text-[rgb(var(--muted))]">Suggestions use exact PO number first, then SKU and customer. Review every selection before saving.</div></div><div className="flex gap-2"><Badge variant="outline">{preview.workOrderCount} WOs searched</Badge>{preview.snapshotAt && <Badge variant="outline">Synced {new Date(preview.snapshotAt).toLocaleDateString()}</Badge>}</div></div>
    {preview.databaseStatus === "missing_table" && <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"><strong>Database setup required.</strong> Run <code>docs/supabase-purchase-order-work-order-matches.sql</code> in Supabase before applying matches.</div>}
    <div className="space-y-3">{preview.lines.map(function(line) { return <div key={line.id} className="rounded-md border border-[rgb(var(--border))] bg-[rgb(var(--background))] p-3"><div className="flex flex-wrap items-start justify-between gap-2"><div><div className="font-medium">{line.sku || "No SKU"} · {line.description}</div><div className="text-xs text-[rgb(var(--muted))]">PO line {line.lineNumber} · {formatNumber(line.quantity)} ordered</div></div><Badge variant="outline">{(selections[line.id] || []).length} selected</Badge></div>
      {line.candidates.length ? <div className="mt-3 space-y-2">{line.candidates.map(function(candidate) { var checked = (selections[line.id] || []).indexOf(candidate.code) !== -1; return <label key={candidate.codeKey} className={cn("flex cursor-pointer gap-3 rounded-md border p-3 transition-colors", checked ? "border-indigo-300 bg-indigo-50" : "border-[rgb(var(--border))] hover:bg-slate-50")}><input type="checkbox" className="mt-1 h-4 w-4" checked={checked} onChange={function() { toggle(line.id, candidate.code); }} /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="font-semibold">WO {candidate.code}</span><Badge variant={candidate.confidence === "high" ? "success" : candidate.confidence === "medium" ? "warning" : "outline"}>{candidate.confidence} confidence</Badge><span className="text-xs text-[rgb(var(--muted))]">{candidate.reasons.join(" · ")}</span></div><div className="mt-1 text-xs text-[rgb(var(--muted))]">{candidate.sku || "No SKU"}{candidate.description ? " · " + candidate.description : ""}</div><div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs"><span>{candidate.customer || "No customer"}</span><span>Status {candidate.status || "—"}</span><span>Due {candidate.dueDate || "—"}</span><span>{formatNumber(candidate.quantity)} ordered</span><span>{formatNumber(candidate.remaining)} remaining</span></div></div></label>; })}</div> : <div className="mt-3 rounded-md border border-dashed border-[rgb(var(--border))] p-3 text-sm text-[rgb(var(--muted))]">No Work Order candidates met the PO number or SKU + customer matching rules.</div>}
    </div>; })}</div>
    {error && <div className="text-sm text-red-600">{error.message}</div>}
    <div className="flex justify-end gap-2"><Button variant="outline" onClick={onCancel}>Cancel</Button><Button disabled={saving || preview.databaseStatus !== "ready"} onClick={function() { onApply(preview.lines.map(function(line) { return { lineId: line.id, workOrderCodes: selections[line.id] || [] }; })); }}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save Work Order matches</Button></div>
  </section>;
}

function Detail({ id, onClose, onChanged, onRevisionStaged }) {
  const revisionInputRef = useRef(null);
  const onboardingInputRef = useRef(null);
  const [editing, setEditing] = useState(false);
  const [reconciliationOpen, setReconciliationOpen] = useState(false);
  const [reconciliationResult, setReconciliationResult] = useState(null);
  const [workOrderMatchingOpen, setWorkOrderMatchingOpen] = useState(false);
  const [workOrderMatchingResult, setWorkOrderMatchingResult] = useState(null);
  const [noteDraft, setNoteDraft] = useState("");
  const query = useQuery({ queryKey: ["purchase-order", id], queryFn: function() { return api("/api/purchase-orders/" + id); } });
  const action = useMutation({
    mutationFn: function(input) {
      return api("/api/purchase-orders/" + id, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input)
      });
    },
    onSuccess: function() { setEditing(false); query.refetch(); onChanged(); }
  });
  const reconcile = useMutation({
    mutationFn: function() { return api("/api/purchase-orders/" + id + "/reconcile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "preview" }) }); },
    onSuccess: function() { setReconciliationResult(null); setReconciliationOpen(true); }
  });
  const applyReconciliation = useMutation({
    mutationFn: function(mappings) { return api("/api/purchase-orders/" + id + "/reconcile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "apply", mappings: mappings }) }); },
    onSuccess: function(result) { setReconciliationOpen(false); setReconciliationResult(result); query.refetch(); onChanged(); }
  });
  const workOrderMatching = useMutation({
    mutationFn: function() { return api("/api/purchase-orders/" + id + "/work-orders"); },
    onSuccess: function() { setWorkOrderMatchingResult(null); setWorkOrderMatchingOpen(true); }
  });
  const applyWorkOrderMatching = useMutation({
    mutationFn: function(matches) { return api("/api/purchase-orders/" + id + "/work-orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ matches: matches }) }); },
    onSuccess: function(result) { setWorkOrderMatchingOpen(false); setWorkOrderMatchingResult(result); query.refetch(); onChanged(); }
  });
  const addNote = useMutation({
    mutationFn: function(note) { return api("/api/purchase-orders/" + id + "/notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note: note }) }); },
    onSuccess: function() { setNoteDraft(""); query.refetch(); }
  });
  const revisionUpload = useMutation({
    mutationFn: async function(file) {
      if (file.size > 3 * 1024 * 1024) throw new Error(file.name + " is larger than 3 MB.");
      return api("/api/purchase-orders/" + id + "/revisions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: file.name, contentType: file.type || "application/octet-stream", base64: await base64File(file) })
      });
    },
    onSuccess: function(result) { onRevisionStaged(result); }
  });
  const onboardingUpload = useMutation({
    mutationFn: async function(file) {
      if (!/\.(pdf|doc|docx|xls|xlsx|csv|jpe?g|png)$/i.test(file.name)) throw new Error("Use a PDF, Word, Excel, CSV, JPG, or PNG file.");
      if (file.size > 3 * 1024 * 1024) throw new Error(file.name + " is larger than 3 MB.");
      return api("/api/purchase-orders/" + id + "/onboarding-documents", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: file.name, contentType: file.type || "application/octet-stream", base64: await base64File(file) })
      });
    },
    onSuccess: function() { query.refetch(); onChanged(); }
  });
  var data = query.data;
  return createPortal(
    <div className="fixed inset-0 z-[110] bg-slate-950/40 backdrop-blur-sm" onMouseDown={onClose}>
      <div className="absolute inset-y-0 right-0 w-full max-w-3xl overflow-auto border-l border-[rgb(var(--border))] bg-[rgb(var(--background))] shadow-2xl" onMouseDown={function(e) { e.stopPropagation(); }}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[rgb(var(--border))] bg-[rgb(var(--background))] px-5 py-3">
          <div className="font-semibold">{data ? data.purchaseOrder.po_number + " · " + data.purchaseOrder.customer_name : "Purchase order"}</div>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>
        {query.isLoading ? <div className="p-8 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin" /></div> : query.error ? <div className="p-5 text-red-600">{query.error.message}</div> : data && (
          <div className="space-y-5 p-5">
            <div className="flex flex-wrap items-center gap-2">
              {statusBadge(data.purchaseOrder.status, data.purchaseOrder.suggested_status)}
              <Badge variant="outline">Revision {data.purchaseOrder.revision_number}</Badge>
              <span className="ml-auto text-xl font-semibold">{formatMoney(data.purchaseOrder.total, data.purchaseOrder.currency)}</span>
            </div>
            <div className="grid gap-3 rounded-md border border-[rgb(var(--border))] p-4 sm:grid-cols-4">
              <Metric label="PO date" value={data.purchaseOrder.po_date || "—"} />
              <Metric label="Due" value={data.purchaseOrder.expected_date || "—"} />
              <Metric label="Ordered" value={formatNumber(data.lines.reduce(function(s,l) { return s + Number(l.quantity || 0); }, 0))} />
              <Metric label="Remaining" value={formatNumber(data.lines.reduce(function(s,l) { return s + Number(l.remaining_quantity || 0); }, 0))} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={function() { setEditing(true); }}><Pencil className="mr-2 h-4 w-4" />Edit details</Button>
              <Button variant="outline" disabled={reconcile.isPending} onClick={function() { reconcile.mutate(); }}>
                <RefreshCw className={cn("mr-2 h-4 w-4", reconcile.isPending && "animate-spin")} />{reconcile.isPending ? "Finding matches…" : "Reconcile production"}
              </Button>
              <Button variant="outline" disabled={workOrderMatching.isPending} onClick={function() { workOrderMatching.mutate(); }}>
                {workOrderMatching.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Link2 className="mr-2 h-4 w-4" />}{workOrderMatching.isPending ? "Finding Work Orders…" : "Match Work Orders"}
              </Button>
              {data.purchaseOrder.status === "open" && data.purchaseOrder.suggested_status === "closed" &&
                <Button onClick={function() { action.mutate({ status: "closed", note: "Accepted production-based closure suggestion." }); }}>Accept closure</Button>}
              {data.purchaseOrder.status !== "open" &&
                <Button variant="outline" onClick={function() { action.mutate({ status: "open", note: "Reopened by user." }); }}>Reopen</Button>}
              {data.purchaseOrder.status === "open" &&
                <Button variant="outline" onClick={function() { action.mutate({ status: "cancelled", note: "Cancelled by user." }); }}>Cancel PO</Button>}
              {data.documentUrl && <Button variant="outline" asChild><a href={data.documentUrl} target="_blank" rel="noreferrer">Open original</a></Button>}
              <Button variant="outline" disabled={revisionUpload.isPending} onClick={function() { revisionInputRef.current && revisionInputRef.current.click(); }}>
                {revisionUpload.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}Upload revision
              </Button>
              <input ref={revisionInputRef} type="file" className="hidden" accept={ACCEPT} onChange={function(e) {
                if (e.target.files && e.target.files[0]) revisionUpload.mutate(e.target.files[0]);
                e.target.value = "";
              }} />
            </div>
            {editing && <EditPurchaseOrder data={data} saving={action.isPending} error={action.error} onCancel={function() { setEditing(false); }} onSave={function(draft) { action.mutate({ data: draft, note: "Purchase order details edited by user." }); }} />}
            {reconciliationOpen && reconcile.data && <ReconciliationReview preview={reconcile.data} saving={applyReconciliation.isPending} error={applyReconciliation.error} onCancel={function() { setReconciliationOpen(false); }} onApply={function(mappings) { applyReconciliation.mutate(mappings); }} />}
            {reconciliationResult && <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800"><div className="font-semibold">Reconciliation complete</div><div>{reconciliationResult.message}{reconciliationResult.suggestedStatus === "closed" ? " All active lines are fulfilled; closure can now be accepted." : ""}</div></div>}
            {workOrderMatchingOpen && workOrderMatching.data && <WorkOrderMatchingReview preview={workOrderMatching.data} saving={applyWorkOrderMatching.isPending} error={applyWorkOrderMatching.error} onCancel={function() { setWorkOrderMatchingOpen(false); }} onApply={function(matches) { applyWorkOrderMatching.mutate(matches); }} />}
            {workOrderMatchingResult && <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800"><div className="font-semibold">Work Order matches saved</div><div>{workOrderMatchingResult.message}</div></div>}
            {(!editing && action.error || reconcile.error || workOrderMatching.error || revisionUpload.error || onboardingUpload.error) && <div className="text-sm text-red-600">{(!editing && action.error || reconcile.error || workOrderMatching.error || revisionUpload.error || onboardingUpload.error).message}</div>}
            <NulogySetupChecklist setup={data.nulogySetup} />
            <section>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold">Onboarding documents</div>
                  <div className="text-xs text-[rgb(var(--muted))]">Private customer onboarding forms attached to this purchase order.</div>
                </div>
                <Button variant="outline" size="sm" disabled={onboardingUpload.isPending || data.onboardingDocumentsStatus === "missing_table"} onClick={function() {
                  onboardingInputRef.current && onboardingInputRef.current.click();
                }}>
                  {onboardingUpload.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Paperclip className="mr-1 h-3.5 w-3.5" />}
                  Attach onboarding file
                </Button>
                <input ref={onboardingInputRef} type="file" className="hidden" accept={ONBOARDING_ACCEPT} onChange={function(e) {
                  if (e.target.files && e.target.files[0]) onboardingUpload.mutate(e.target.files[0]);
                  e.target.value = "";
                }} />
              </div>
              {data.onboardingDocumentsStatus === "missing_table" ? (
                <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                  Database setup required. Run <code>docs/supabase-purchase-order-onboarding-documents.sql</code> in Supabase.
                </div>
              ) : data.onboardingDocuments && data.onboardingDocuments.length ? (
                <div className="space-y-2">{data.onboardingDocuments.map(function(document) { return (
                  <div key={document.id} className="flex flex-wrap items-center gap-3 rounded-md border border-[rgb(var(--border))] px-3 py-2 text-sm">
                    <FileText className="h-4 w-4 shrink-0 text-[rgb(var(--muted))]" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{document.original_file_name}</div>
                      <div className="text-xs text-[rgb(var(--muted))]">Uploaded by {document.uploaded_by || "Unknown"} · {new Date(document.created_at).toLocaleString()}</div>
                    </div>
                    {document.url && <Button variant="outline" size="sm" asChild><a href={document.url} target="_blank" rel="noreferrer">Open file</a></Button>}
                  </div>
                ); })}</div>
              ) : (
                <div className="rounded-md border border-dashed border-[rgb(var(--border))] p-4 text-center text-sm text-[rgb(var(--muted))]">No onboarding document attached yet.</div>
              )}
            </section>
            <section>
              <div className="mb-2 text-sm font-semibold">Line fulfillment</div>
              <TableShell>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs uppercase text-[rgb(var(--muted))]"><tr>
                      <th className="px-3 py-2">Item</th><th className="px-3 py-2 text-right">Ordered</th>
                      <th className="px-3 py-2 text-right">Produced</th><th className="px-3 py-2 text-right">Remaining</th><th className="px-3 py-2">Match</th>
                    </tr></thead>
                    <tbody>{data.lines.map(function(line) { return <tr key={line.id} className="border-t border-[rgb(var(--border))]">
                      <td className="px-3 py-3"><div className="font-medium">{line.description}</div><div className="text-xs text-[rgb(var(--muted))]">{line.sku || "No SKU"} · {line.uom}</div></td>
                      <td className="px-3 py-3 text-right">{formatNumber(line.quantity)}</td><td className="px-3 py-3 text-right">{formatNumber(line.produced_quantity)}</td>
                      <td className="px-3 py-3 text-right">{formatNumber(line.remaining_quantity)}</td><td className="px-3 py-3"><Badge variant="outline">{line.match_status}</Badge></td>
                    </tr>; })}</tbody>
                  </table>
                </div>
              </TableShell>
            </section>
            <section className="rounded-md border border-[rgb(var(--border))] p-4">
              <div className="flex items-start gap-2"><MessageSquare className="mt-0.5 h-4 w-4 text-[rgb(var(--muted))]" /><div><div className="text-sm font-semibold">Notes</div><div className="text-xs text-[rgb(var(--muted))]">Leave updates or messages for anyone reviewing this purchase order.</div></div></div>
              <div className="mt-3 space-y-2">{data.events.filter(function(event) { return event.event_type === "po_note_added"; }).length ? data.events.filter(function(event) { return event.event_type === "po_note_added"; }).map(function(event) { return <div key={event.id} className="rounded-md bg-slate-50 px-3 py-2.5"><div className="whitespace-pre-wrap text-sm text-slate-800">{event.note}</div><div className="mt-1.5 text-xs text-[rgb(var(--muted))]">{event.actor || "Unknown user"} · {new Date(event.created_at).toLocaleString()}</div></div>; }) : <div className="rounded-md border border-dashed border-[rgb(var(--border))] p-3 text-center text-sm text-[rgb(var(--muted))]">No notes yet.</div>}</div>
              <div className="mt-3"><Textarea maxLength={2000} rows={3} placeholder="Add a note or update…" value={noteDraft} onChange={function(event) { setNoteDraft(event.target.value); }} /><div className="mt-2 flex items-center justify-between gap-3"><span className="text-xs text-[rgb(var(--muted))]">{noteDraft.length}/2,000</span><Button size="sm" disabled={addNote.isPending || !noteDraft.trim()} onClick={function() { addNote.mutate(noteDraft); }}>{addNote.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1.5 h-3.5 w-3.5" />}Post note</Button></div>{addNote.error && <div className="mt-2 text-sm text-red-600">{addNote.error.message}</div>}</div>
            </section>
            <section>
              <div className="mb-2 text-sm font-semibold">Revision history</div>
              <div className="space-y-2">{data.revisions.map(function(revision) { return <div key={revision.id} className="flex items-center justify-between rounded-md border border-[rgb(var(--border))] px-3 py-2 text-sm">
                <div><span className="font-medium">Revision {revision.revision_number}</span><span className="ml-2 text-[rgb(var(--muted))]">{revision.original_file_name}</span></div>
                <span className="text-xs text-[rgb(var(--muted))]">{new Date(revision.created_at).toLocaleString()}</span>
              </div>; })}</div>
            </section>
            <section>
              <div className="mb-2 text-sm font-semibold">Audit history</div>
              <div className="space-y-2">{data.events.filter(function(event) { return event.event_type !== "po_note_added"; }).map(function(event) { return <div key={event.id} className="border-l-2 border-[rgb(var(--border))] pl-3 text-sm">
                <div className="font-medium">{String(event.event_type).replace(/_/g, " ")}</div>
                <div className="text-xs text-[rgb(var(--muted))]">{event.actor || "System"} · {new Date(event.created_at).toLocaleString()}</div>
              </div>; })}</div>
            </section>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

function Metric({ label, value }) {
  return <div><div className="text-xs text-[rgb(var(--muted))]">{label}</div><div className="mt-1 font-semibold">{value}</div></div>;
}

function NulogySetupIndicator({ setup, compact }) {
  if (!setup || setup.status === "unknown") return <span className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-600" title="Nulogy data could not be verified from the current snapshot."><RefreshCw className="h-3 w-3" />Nulogy unverified</span>;
  if (setup.status === "complete") return <span className="inline-flex items-center gap-1 rounded-full border border-green-300 bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-800" title="Customer, item numbers, pricing, and a Work Order were found in Nulogy."><Check className="h-3 w-3" />Nulogy ready</span>;
  var missing = (setup.checks || []).filter(function(item) { return item.status !== "complete"; }).map(function(item) { return item.label; });
  return <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800" title={"Needs Nulogy setup: " + missing.join(", ")}><AlertTriangle className="h-3 w-3" />{compact ? "Nulogy " + setup.completeCount + "/" + setup.totalCount : "Nulogy setup needed"}</span>;
}

function NulogySetupChecklist({ setup }) {
  if (!setup) return null;
  return <section className="rounded-md border border-[rgb(var(--border))] p-4">
    <div className="flex flex-wrap items-start justify-between gap-2"><div><div className="text-sm font-semibold">Nulogy setup</div><div className="text-xs text-[rgb(var(--muted))]">Read-only checks against the latest synced Nulogy data. Exact matches only.</div></div><NulogySetupIndicator setup={setup} /></div>
    <div className="mt-3 grid gap-2 sm:grid-cols-2">{(setup.checks || []).map(function(item) { var complete = item.status === "complete"; var unknown = item.status === "unknown"; return <div key={item.label} className={cn("rounded-md border p-3", complete ? "border-green-200 bg-green-50/60" : unknown ? "border-slate-200 bg-slate-50" : "border-amber-200 bg-amber-50/60")}><div className="flex items-center gap-2">{complete ? <Check className="h-4 w-4 text-green-700" /> : unknown ? <RefreshCw className="h-4 w-4 text-slate-500" /> : <AlertTriangle className="h-4 w-4 text-amber-700" />}<span className="text-sm font-medium">{item.label}</span><span className={cn("ml-auto text-xs font-medium", complete ? "text-green-700" : unknown ? "text-slate-500" : "text-amber-700")}>{complete ? "Complete" : unknown ? "Unverified" : "Needs setup"}</span></div><div className="mt-1.5 text-xs text-[rgb(var(--muted))]">{item.detail}</div>{item.missing && item.missing.length > 0 && <div className="mt-1 text-xs font-medium text-amber-800">Missing: {item.missing.join(", ")}</div>}</div>; })}</div>
    {setup.verifiedAt && <div className="mt-2 text-right text-[11px] text-[rgb(var(--muted))]">Verified from snapshot synced {new Date(setup.verifiedAt).toLocaleString()}</div>}
  </section>;
}

function PurchaseOrderRegisterRow({ row, expanded, onToggle, onOpen, onOnboardingUpload, onboardingUploading }) {
  var items = Array.isArray(row.sku_items) ? row.sku_items : [];
  var firstItem = items[0];
  var workOrders = row.nulogy_setup && Array.isArray(row.nulogy_setup.workOrders)
    ? row.nulogy_setup.workOrders
    : (row.nulogy_setup && Array.isArray(row.nulogy_setup.workOrderNumbers) ? row.nulogy_setup.workOrderNumbers.map(function(code) { return { code: code, url: null }; }) : []);
  return <Fragment>
    <tr onClick={onToggle} className={cn("cursor-pointer border-t border-[rgb(var(--border))] transition-colors hover:bg-slate-50", expanded && "bg-slate-50/70")}>
      <td className="px-4 py-3 align-top"><div className="flex items-start gap-2"><button type="button" className="mt-0.5 rounded p-0.5 text-[rgb(var(--muted))] hover:bg-slate-200 hover:text-slate-900" aria-label={(expanded ? "Collapse " : "Expand ") + row.po_number} aria-expanded={expanded} onClick={function(event) { event.stopPropagation(); onToggle(); }}><ChevronRight className={cn("h-4 w-4 transition-transform", expanded && "rotate-90")} /></button><div><div className="font-semibold">{row.po_number}</div><div className="text-xs text-[rgb(var(--muted))]">{row.customer_name} · Rev {row.revision_number}</div><div className="mt-1 text-[11px] text-[rgb(var(--muted))]">{expanded ? "Hide line items" : "View " + items.length + " line item" + (items.length === 1 ? "" : "s")}</div><div className="mt-1.5 flex flex-col items-start gap-1.5">{row.has_onboarding_document === false && <button type="button" disabled={onboardingUploading} onClick={function(event) { event.stopPropagation(); onOnboardingUpload(); }} className="group inline-flex items-center gap-2 rounded-md border border-dashed border-slate-300 bg-white px-2 py-1 text-left text-[11px] font-medium text-slate-700 transition-colors hover:border-slate-400 hover:bg-slate-50 disabled:cursor-wait disabled:opacity-70" title="Choose an onboarding file to attach to this purchase order.">{onboardingUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-500" /> : <span className="h-3.5 w-3.5 rounded-[3px] border border-slate-400 bg-white group-hover:border-slate-500" />}<span>Task: Upload Onboarding Document</span></button>}<NulogySetupIndicator setup={row.nulogy_setup} compact /></div></div></div></td>
      <td className="min-w-64 max-w-96 px-4 py-3 align-top">{firstItem ? <div><div className="font-medium">{firstItem.sku || "No SKU number"}</div><div className="line-clamp-2 text-xs text-[rgb(var(--muted))]" title={firstItem.description || ""}>{firstItem.description || "No description"}</div>{items.length > 1 && <div className="mt-1.5 inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">+{items.length - 1} more</div>}</div> : <span className="text-xs text-[rgb(var(--muted))]">No SKU details</span>}</td>
      <td className="min-w-32 px-4 py-3 align-top">{workOrders.length ? <div className="flex flex-wrap gap-1">{workOrders.slice(0, 3).map(function(workOrder) { return workOrder.url ? <a key={workOrder.code} href={workOrder.url} target="_blank" rel="noreferrer" onClick={function(event) { event.stopPropagation(); }} className="inline-flex rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-1" title={"Open Work Order " + workOrder.code + " in Nulogy"}><Badge variant="outline" className="cursor-pointer font-medium text-slate-700 transition-colors hover:border-slate-400 hover:bg-slate-100 hover:text-slate-900">{workOrder.code}</Badge></a> : <Badge key={workOrder.code} variant="outline" title="Run a new Nulogy sync to load the Work Order ID for linking.">{workOrder.code}</Badge>; })}{workOrders.length > 3 && <Badge variant="outline">+{workOrders.length - 3}</Badge>}</div> : <span className={cn("text-xs", row.nulogy_setup && row.nulogy_setup.status !== "unknown" ? "text-amber-700" : "text-[rgb(var(--muted))]")}>{row.nulogy_setup && row.nulogy_setup.status !== "unknown" ? "Not created" : "Unverified"}</span>}</td>
      <td className="px-4 py-3 align-top"><div>{row.po_date || "—"}</div><div className="text-xs text-[rgb(var(--muted))]">Due {row.expected_date || "—"}</div></td>
      <td className="px-4 py-3 text-right align-top">{formatNumber(row.ordered_quantity)}</td><td className="px-4 py-3 text-right align-top">{formatNumber(row.produced_quantity)}</td>
      <td className="px-4 py-3 text-right align-top">{formatNumber(row.remaining_quantity)}</td><td className="px-4 py-3 text-right align-top font-medium">{formatMoney(row.total, row.currency)}</td>
      <td className="px-4 py-3 align-top">{statusBadge(row.status, row.suggested_status)}</td><td className="px-4 py-3 align-top text-xs text-[rgb(var(--muted))]">{new Date(row.updated_at).toLocaleDateString()}</td>
    </tr>
    {expanded && <tr className="border-t border-[rgb(var(--border))] bg-slate-50/60"><td colSpan="10" className="px-5 py-4"><div className="rounded-md border border-[rgb(var(--border))] bg-[rgb(var(--background))] shadow-sm"><div className="flex flex-wrap items-center justify-between gap-2 border-b border-[rgb(var(--border))] px-4 py-3"><div><div className="text-sm font-semibold">PO line items</div><div className="text-xs text-[rgb(var(--muted))]">{items.length} item{items.length === 1 ? "" : "s"} · {formatNumber(row.ordered_quantity)} total ordered</div></div><Button variant="outline" size="sm" onClick={function(event) { event.stopPropagation(); onOpen(); }}>View PO details</Button></div><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-[rgb(var(--muted))]"><tr><th className="px-4 py-2">SKU</th><th className="px-4 py-2">Description</th><th className="px-4 py-2 text-right">Ordered</th><th className="px-4 py-2 text-right">Produced</th><th className="px-4 py-2 text-right">Remaining</th><th className="px-4 py-2">Match</th></tr></thead><tbody>{items.length ? items.map(function(item, index) { return <tr key={(item.lineNumber || index) + ":" + item.sku} className="border-t border-[rgb(var(--border))]"><td className="whitespace-nowrap px-4 py-2.5 font-medium">{item.sku || "No SKU"}</td><td className="min-w-72 px-4 py-2.5 text-[rgb(var(--muted))]">{item.description || "No description"}</td><td className="px-4 py-2.5 text-right">{formatNumber(item.quantity)}</td><td className="px-4 py-2.5 text-right">{formatNumber(item.producedQuantity)}</td><td className="px-4 py-2.5 text-right">{formatNumber(item.remainingQuantity)}</td><td className="px-4 py-2.5"><Badge variant="outline">{String(item.matchStatus || "unmatched").replace(/_/g, " ")}</Badge></td></tr>; }) : <tr><td colSpan="6" className="p-5 text-center text-[rgb(var(--muted))]">No active line items.</td></tr>}</tbody></table></div></div></td></tr>}
  </Fragment>;
}

function PurchaseOrdersRegister({ onOpenCountChange }) {
  const queryClient = useQueryClient();
  const inputRef = useRef(null);
  const onboardingTaskInputRef = useRef(null);
  const onboardingTargetIdRef = useRef("");
  const [tab, setTab] = useState("open");
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState("updated_at");
  const [direction, setDirection] = useState("desc");
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState([]);
  const [reviewQueue, setReviewQueue] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [expandedRows, setExpandedRows] = useState({});
  const [error, setError] = useState("");
  const onboardingTaskUpload = useMutation({
    mutationFn: async function(input) {
      var file = input.file;
      if (!/\.(pdf|doc|docx|xls|xlsx|csv|jpe?g|png)$/i.test(file.name)) throw new Error("Use a PDF, Word, Excel, CSV, JPG, or PNG file.");
      if (file.size > 3 * 1024 * 1024) throw new Error(file.name + " is larger than 3 MB.");
      return api("/api/purchase-orders/" + input.purchaseOrderId + "/onboarding-documents", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: file.name, contentType: file.type || "application/octet-stream", base64: await base64File(file) })
      });
    },
    onSuccess: function() {
      setError("");
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
    },
    onError: function(uploadError) { setError(uploadError.message); }
  });
  const listQuery = useQuery({
    queryKey: ["purchase-orders", tab, deferredSearch, page, sort, direction],
    queryFn: function() {
      var params = new URLSearchParams({ status: tab, q: deferredSearch, page: String(page), pageSize: "25", sort: sort, direction: direction });
      return api("/api/purchase-orders?" + params.toString());
    }
  });
  var data = listQuery.data || { rows: [], counts: {}, total: 0 };
  var counts = data.counts || {};
  var rows = Array.isArray(data.rows) ? data.rows : [];
  var staged = reviewQueue.length ? reviewQueue[0] : null;
  useEffect(function() {
    if (onOpenCountChange && counts.open != null) onOpenCountChange(counts.open);
  }, [counts.open, onOpenCountChange]);
  var totalPages = Math.max(1, Math.ceil(Number(data.total || 0) / 25));
  var handleFiles = useCallback(async function(fileList) {
    var files = Array.from(fileList || []);
    if (!files.length) return;
    setError("");
    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      var token = file.name + ":" + file.size + ":" + i;
      setUploading(function(old) { return old.concat([{ token: token, name: file.name, status: "uploading" }]); });
      try {
        if (file.size > 3 * 1024 * 1024) throw new Error(file.name + " is larger than 3 MB.");
        var base64 = await base64File(file);
        var result = await api("/api/purchase-orders/uploads", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileName: file.name, contentType: file.type || "application/octet-stream", base64: base64 })
        });
        setUploading(function(old) { return old.map(function(row) { return row.token === token ? Object.assign({}, row, { status: "ready" }) : row; }); });
        setReviewQueue(function(old) {
          return old.some(function(item) { return item.revision.id === result.revision.id; }) ? old : old.concat([result]);
        });
      } catch (uploadError) {
        setUploading(function(old) { return old.map(function(row) { return row.token === token ? Object.assign({}, row, { status: "failed", error: uploadError.message }) : row; }); });
        setError(uploadError.message);
      }
    }
  }, []);
  var refresh = function() { queryClient.invalidateQueries({ queryKey: ["purchase-orders"] }); };
  var changeSort = function(field) {
    if (sort === field) setDirection(direction === "asc" ? "desc" : "asc");
    else { setSort(field); setDirection("asc"); }
    setPage(1);
  };
  var SortLabel = function({ field, children }) {
    return <button className="inline-flex items-center gap-1 hover:text-slate-900" onClick={function() { changeSort(field); }}>{children}{sort === field ? (direction === "asc" ? " ↑" : " ↓") : ""}</button>;
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-2xl font-semibold tracking-tight">Purchase Orders</h1><p className="mt-1 text-sm text-[rgb(var(--muted))]">Upload client POs, review extracted data, and track fulfillment.</p></div>
        <Button onClick={function() { inputRef.current && inputRef.current.click(); }}><Upload className="mr-2 h-4 w-4" />Upload purchase orders</Button>
        <input ref={inputRef} className="hidden" type="file" multiple accept={ACCEPT} onChange={function(e) { handleFiles(e.target.files); e.target.value = ""; }} />
        <input ref={onboardingTaskInputRef} className="hidden" type="file" accept={ONBOARDING_ACCEPT} onChange={function(event) {
          var file = event.target.files && event.target.files[0];
          var purchaseOrderId = onboardingTargetIdRef.current;
          if (file && purchaseOrderId) onboardingTaskUpload.mutate({ purchaseOrderId: purchaseOrderId, file: file });
          event.target.value = "";
        }} />
      </div>
      <Card className={cn("border-dashed transition-colors", dragging && "border-blue-500 bg-blue-50")}>
        <div className="flex min-h-28 items-center justify-center p-5 text-center" onDragOver={function(e) { e.preventDefault(); setDragging(true); }}
          onDragLeave={function() { setDragging(false); }} onDrop={function(e) { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files); }}>
          <div><Upload className="mx-auto h-7 w-7 text-[rgb(var(--muted))]" /><div className="mt-2 text-sm font-medium">Drop PDF, image, CSV, or Excel purchase orders here</div><div className="mt-1 text-xs text-[rgb(var(--muted))]">Multiple files supported · 3 MB per file · review required before saving</div></div>
        </div>
        {uploading.length > 0 && <div className="border-t border-[rgb(var(--border))] px-4 py-2">{uploading.slice(-5).map(function(row) { return <div key={row.token} className="flex items-center gap-2 py-1 text-xs">
          {row.status === "uploading" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : row.status === "ready" ? <Check className="h-3.5 w-3.5 text-green-600" /> : <AlertTriangle className="h-3.5 w-3.5 text-red-600" />}
          <span>{row.name}</span>{row.error && <span className="text-red-600">{row.error}</span>}
        </div>; })}</div>}
      </Card>
      {(error || listQuery.error) && <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error || listQuery.error.message}</div>}
      {data.status === "missing_table" && <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"><strong>Database setup required.</strong> Run <code>docs/supabase-purchase-orders.sql</code> in Supabase, then refresh.</div>}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-md border border-[rgb(var(--border))] p-1">
          {TABS.map(function(item) { return <button key={item.key} onClick={function() { setTab(item.key); setPage(1); }} className={cn("rounded px-3 py-1.5 text-sm", tab === item.key ? "bg-slate-900 text-white" : "text-[rgb(var(--muted))] hover:bg-slate-100")}>{item.label}{counts[item.key] != null && <span className="ml-1.5 text-xs opacity-70">{counts[item.key]}</span>}</button>; })}
        </div>
        <div className="relative ml-auto w-full sm:w-72"><Search className="absolute left-3 top-2.5 h-4 w-4 text-[rgb(var(--muted))]" /><Input className="pl-9" placeholder="Search customer or PO number" value={search} onChange={function(e) { setSearch(e.target.value); setPage(1); }} /></div>
      </div>
      <TableShell>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-[rgb(var(--muted))]"><tr>
              <th className="px-4 py-3"><SortLabel field="po_number">PO / Customer</SortLabel></th><th className="px-4 py-3">SKU / Description</th><th className="px-4 py-3">Work Order #</th><th className="px-4 py-3"><SortLabel field="po_date">Dates</SortLabel></th><th className="px-4 py-3 text-right">Ordered</th>
              <th className="px-4 py-3 text-right">Produced</th><th className="px-4 py-3 text-right">Remaining</th><th className="px-4 py-3 text-right">Value</th>
              <th className="px-4 py-3"><SortLabel field="status">Status</SortLabel></th><th className="px-4 py-3"><SortLabel field="updated_at">Updated</SortLabel></th>
            </tr></thead>
            <tbody>{listQuery.isLoading ? <tr><td colSpan="10" className="p-10 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin" /></td></tr> :
              rows.length === 0 ? <tr><td colSpan="10" className="p-10 text-center text-[rgb(var(--muted))]">No purchase orders in this view.</td></tr> :
              rows.map(function(row) { return <PurchaseOrderRegisterRow key={row.id} row={row} expanded={Boolean(expandedRows[row.id])} onboardingUploading={onboardingTaskUpload.isPending && onboardingTargetIdRef.current === row.id} onOnboardingUpload={function() { onboardingTargetIdRef.current = row.id; setError(""); onboardingTaskInputRef.current && onboardingTaskInputRef.current.click(); }} onToggle={function() { setExpandedRows(function(old) { return Object.assign({}, old, { [row.id]: !old[row.id] }); }); }} onOpen={function() { setSelectedId(row.id); }} />; })}</tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-[rgb(var(--border))] px-4 py-3 text-sm">
          <span className="text-[rgb(var(--muted))]">{data.total || 0} purchase orders</span>
          <div className="flex items-center gap-2"><Button variant="outline" size="icon" disabled={page <= 1} onClick={function() { setPage(page - 1); }}><ChevronLeft className="h-4 w-4" /></Button><span>Page {page} of {totalPages}</span><Button variant="outline" size="icon" disabled={page >= totalPages} onClick={function() { setPage(page + 1); }}><ChevronRight className="h-4 w-4" /></Button></div>
        </div>
      </TableShell>
      {staged && <UploadReview staged={staged} onClose={function() { setReviewQueue(function(old) { return old.slice(1); }); }} onConfirmed={function(result) { setReviewQueue(function(old) { return old.slice(1); }); refresh(); setSelectedId(result.purchaseOrder.id); }} />}
      {selectedId && <Detail id={selectedId} onClose={function() { setSelectedId(null); }} onChanged={refresh} onRevisionStaged={function(result) {
        setSelectedId(null);
        setReviewQueue(function(old) { return old.concat([result]); });
      }} />}
    </div>
  );
}

export default function PurchaseOrdersView({ onOpenCountChange }) {
  const [section, setSection] = useState("purchase-orders");
  return <div className="space-y-4">
    <div className="inline-flex gap-1 rounded-md border border-[rgb(var(--border))] bg-[rgb(var(--background))] p-1">
      <button className={cn("rounded px-4 py-2 text-sm font-medium", section === "purchase-orders" ? "bg-slate-900 text-white" : "text-[rgb(var(--muted))] hover:bg-slate-100")} onClick={function() { setSection("purchase-orders"); }}>Purchase Orders</button>
      <button className={cn("rounded px-4 py-2 text-sm font-medium", section === "quotes" ? "bg-slate-900 text-white" : "text-[rgb(var(--muted))] hover:bg-slate-100")} onClick={function() { setSection("quotes"); }}>Quotes</button>
    </div>
    {section === "purchase-orders" ? <PurchaseOrdersRegister onOpenCountChange={onOpenCountChange} /> : <QuotesPanel />}
  </div>;
}
