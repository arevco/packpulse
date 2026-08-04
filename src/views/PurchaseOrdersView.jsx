import { useCallback, useDeferredValue, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, Check, ChevronLeft, ChevronRight, FileSpreadsheet, FileText,
  Loader2, Paperclip, Plus, RefreshCw, Search, Upload, X
} from "lucide-react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader } from "../components/ui/card";
import { Input } from "../components/ui/input";
import TableShell from "../components/ui/table-shell";
import { cn } from "../lib/utils";

var ACCEPT = ".pdf,.jpg,.jpeg,.png,.csv,.xls,.xlsx";
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

function Detail({ id, onClose, onChanged, onRevisionStaged }) {
  const revisionInputRef = useRef(null);
  const onboardingInputRef = useRef(null);
  const query = useQuery({ queryKey: ["purchase-order", id], queryFn: function() { return api("/api/purchase-orders/" + id); } });
  const action = useMutation({
    mutationFn: function(input) {
      return api("/api/purchase-orders/" + id, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input)
      });
    },
    onSuccess: function() { query.refetch(); onChanged(); }
  });
  const reconcile = useMutation({
    mutationFn: function() { return api("/api/purchase-orders/" + id + "/reconcile", { method: "POST" }); },
    onSuccess: function() { query.refetch(); onChanged(); }
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
      if (file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)) throw new Error("Onboarding documents must be PDF files.");
      if (file.size > 3 * 1024 * 1024) throw new Error(file.name + " is larger than 3 MB.");
      return api("/api/purchase-orders/" + id + "/onboarding-documents", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: file.name, contentType: "application/pdf", base64: await base64File(file) })
      });
    },
    onSuccess: function() { query.refetch(); onChanged(); }
  });
  var data = query.data;
  return (
    <div className="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-sm" onMouseDown={onClose}>
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
              <Button variant="outline" disabled={reconcile.isPending} onClick={function() { reconcile.mutate(); }}>
                <RefreshCw className={cn("mr-2 h-4 w-4", reconcile.isPending && "animate-spin")} />Reconcile production
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
            {(action.error || reconcile.error || revisionUpload.error || onboardingUpload.error) && <div className="text-sm text-red-600">{(action.error || reconcile.error || revisionUpload.error || onboardingUpload.error).message}</div>}
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
                  Attach onboarding PDF
                </Button>
                <input ref={onboardingInputRef} type="file" className="hidden" accept="application/pdf,.pdf" onChange={function(e) {
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
                    {document.url && <Button variant="outline" size="sm" asChild><a href={document.url} target="_blank" rel="noreferrer">Open PDF</a></Button>}
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
            <section>
              <div className="mb-2 text-sm font-semibold">Revision history</div>
              <div className="space-y-2">{data.revisions.map(function(revision) { return <div key={revision.id} className="flex items-center justify-between rounded-md border border-[rgb(var(--border))] px-3 py-2 text-sm">
                <div><span className="font-medium">Revision {revision.revision_number}</span><span className="ml-2 text-[rgb(var(--muted))]">{revision.original_file_name}</span></div>
                <span className="text-xs text-[rgb(var(--muted))]">{new Date(revision.created_at).toLocaleString()}</span>
              </div>; })}</div>
            </section>
            <section>
              <div className="mb-2 text-sm font-semibold">Audit history</div>
              <div className="space-y-2">{data.events.map(function(event) { return <div key={event.id} className="border-l-2 border-[rgb(var(--border))] pl-3 text-sm">
                <div className="font-medium">{String(event.event_type).replace(/_/g, " ")}</div>
                <div className="text-xs text-[rgb(var(--muted))]">{event.actor || "System"} · {new Date(event.created_at).toLocaleString()}</div>
              </div>; })}</div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value }) {
  return <div><div className="text-xs text-[rgb(var(--muted))]">{label}</div><div className="mt-1 font-semibold">{value}</div></div>;
}

export default function PurchaseOrdersView({ onOpenCountChange }) {
  const queryClient = useQueryClient();
  const inputRef = useRef(null);
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
  const [error, setError] = useState("");
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
              <th className="px-4 py-3"><SortLabel field="po_number">PO / Customer</SortLabel></th><th className="px-4 py-3"><SortLabel field="po_date">Dates</SortLabel></th><th className="px-4 py-3 text-right">Ordered</th>
              <th className="px-4 py-3 text-right">Produced</th><th className="px-4 py-3 text-right">Remaining</th><th className="px-4 py-3 text-right">Value</th>
              <th className="px-4 py-3"><SortLabel field="status">Status</SortLabel></th><th className="px-4 py-3"><SortLabel field="updated_at">Updated</SortLabel></th>
            </tr></thead>
            <tbody>{listQuery.isLoading ? <tr><td colSpan="8" className="p-10 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin" /></td></tr> :
              rows.length === 0 ? <tr><td colSpan="8" className="p-10 text-center text-[rgb(var(--muted))]">No purchase orders in this view.</td></tr> :
              rows.map(function(row) { return <tr key={row.id} onClick={function() { setSelectedId(row.id); }} className="cursor-pointer border-t border-[rgb(var(--border))] hover:bg-slate-50">
                <td className="px-4 py-3"><div className="font-semibold">{row.po_number}</div><div className="text-xs text-[rgb(var(--muted))]">{row.customer_name} · Rev {row.revision_number}</div></td>
                <td className="px-4 py-3"><div>{row.po_date || "—"}</div><div className="text-xs text-[rgb(var(--muted))]">Due {row.expected_date || "—"}</div></td>
                <td className="px-4 py-3 text-right">{formatNumber(row.ordered_quantity)}</td><td className="px-4 py-3 text-right">{formatNumber(row.produced_quantity)}</td>
                <td className="px-4 py-3 text-right">{formatNumber(row.remaining_quantity)}</td><td className="px-4 py-3 text-right font-medium">{formatMoney(row.total, row.currency)}</td>
                <td className="px-4 py-3">{statusBadge(row.status, row.suggested_status)}</td><td className="px-4 py-3 text-xs text-[rgb(var(--muted))]">{new Date(row.updated_at).toLocaleDateString()}</td>
              </tr>; })}</tbody>
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
