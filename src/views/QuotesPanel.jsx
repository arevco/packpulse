import { useDeferredValue, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, FileText, Loader2, Pencil, Plus, Search, Upload, X } from "lucide-react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Input } from "../components/ui/input";
import TableShell from "../components/ui/table-shell";
import { cn } from "../lib/utils";

const ACCEPT = ".pdf,.jpg,.jpeg,.png,.csv,.xls,.xlsx";

function api(path, options) {
  return fetch(path, Object.assign({ credentials: "include" }, options || {})).then(async function(response) {
    var body = await response.json().catch(function() { return {}; });
    if (!response.ok) throw new Error(body.error || "Request failed (" + response.status + ")");
    return body;
  });
}

function base64File(file) {
  return new Promise(function(resolve, reject) {
    var reader = new FileReader();
    reader.onload = function() { resolve(String(reader.result || "").split(",")[1] || ""); };
    reader.onerror = function() { reject(reader.error || new Error("Could not read file")); };
    reader.readAsDataURL(file);
  });
}

function money(value, currency) {
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "USD" }).format(Number(value || 0)); }
  catch (_error) { return "$" + Number(value || 0).toFixed(2); }
}

function number(value) { return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(Number(value || 0)); }
function quoteAgingDays(quoteDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(quoteDate || ""))) return null;
  var start = Date.parse(String(quoteDate) + "T00:00:00Z");
  var today = Date.parse(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
  return isNaN(start) ? null : Math.max(0, Math.floor((today - start) / 86400000));
}
function agingIndicator(quoteDate) {
  var days = quoteAgingDays(quoteDate);
  if (days == null) return <span className="text-[rgb(var(--muted))]">—</span>;
  var style = days >= 60 ? "border-red-300 bg-red-50 text-red-700" : days >= 30 ? "border-amber-300 bg-amber-50 text-amber-800" : "border-slate-200 bg-slate-50 text-slate-700";
  return <span className={"inline-flex rounded-full border px-2 py-0.5 text-xs font-medium " + style} title="Calculated from the quote date through today">{days} day{days === 1 ? "" : "s"}</span>;
}
function blankLine() { return { sku: "", description: "", quantity: 0, uom: "", unitRate: 0, taxAmount: 0, lineAmount: 0 }; }
function Field({ label, value, type, onChange, disabled }) {
  return <label className="block"><span className="mb-1 block text-xs font-medium text-[rgb(var(--muted))]">{label}</span><Input type={type || "text"} value={value == null ? "" : value} disabled={disabled} step={type === "number" ? "any" : undefined} onChange={function(event) { onChange && onChange(event.target.value); }} /></label>;
}

function statusBadge(status) {
  if (status === "accepted") return <Badge variant="success">Accepted</Badge>;
  if (status === "declined" || status === "expired") return <Badge variant="secondary">{status === "declined" ? "Declined" : "Expired"}</Badge>;
  if (status === "sent") return <Badge variant="warning">Sent</Badge>;
  return <Badge variant="outline">Draft</Badge>;
}

function outcomeLabel(outcome) {
  if (outcome === "won") return "Won";
  if (outcome === "lost") return "Lost";
  return "Open";
}

function QuoteReview({ staged, onClose, onConfirmed }) {
  const [draft, setDraft] = useState(function() {
    var extracted = staged.extracted || {};
    var lines = Array.isArray(extracted.lines) && extracted.lines.length ? extracted.lines.map(function(line) { return Object.assign(blankLine(), line); }) : [blankLine()];
    return Object.assign({ customerName: "", poNumber: "", poDate: "", expectedDate: "", currency: "USD", taxTotal: 0, warnings: [] }, extracted, { lines: lines });
  });
  const mutation = useMutation({ mutationFn: function() { return api("/api/quotes/" + staged.revision.id + "/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: draft }) }); }, onSuccess: onConfirmed });
  var recalculate = function(lines, tax) {
    var nextLines = lines.map(function(line) { return Object.assign({}, line, { lineAmount: Number(line.quantity || 0) * Number(line.unitRate || 0) }); });
    var subtotal = nextLines.reduce(function(sum, line) { return sum + Number(line.lineAmount || 0); }, 0);
    return { lines: nextLines, subtotal: subtotal, taxTotal: tax, total: subtotal + tax };
  };
  var update = function(field, value) { setDraft(function(old) { return Object.assign({}, old, { [field]: value }); }); };
  var updateLine = function(index, field, value) { setDraft(function(old) { var lines = old.lines.slice(); lines[index] = Object.assign({}, lines[index], { [field]: value }); return Object.assign({}, old, recalculate(lines, Number(old.taxTotal || 0))); }); };
  var missing = !draft.customerName || !draft.poNumber || !draft.poDate || !draft.lines.length || draft.lines.some(function(line) { return !line.description || !(Number(line.quantity) > 0) || !line.uom; });
  return <div className="fixed inset-0 z-50 flex bg-slate-950/40 p-3 backdrop-blur-sm"><div className="m-auto flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--background))] shadow-2xl">
    <div className="flex items-center justify-between border-b border-[rgb(var(--border))] px-5 py-3"><div><div className="font-semibold">Review extracted quote</div><div className="text-xs text-[rgb(var(--muted))]">{staged.revision.original_file_name}</div></div><Button variant="ghost" size="icon" onClick={onClose}><X className="h-4 w-4" /></Button></div>
    <div className="grid min-h-0 flex-1 gap-4 overflow-auto p-5 lg:grid-cols-[0.85fr_1.35fr]">
      <Card className="min-h-[420px] overflow-hidden"><div className="border-b border-[rgb(var(--border))] p-4 text-sm font-semibold">Original quote</div><div className="flex h-[520px] items-center justify-center bg-slate-50 p-3">{staged.documentUrl && staged.revision.content_type === "application/pdf" ? <iframe title="Quote preview" className="h-full w-full rounded bg-white" src={staged.documentUrl} /> : staged.documentUrl && staged.revision.content_type.indexOf("image/") === 0 ? <img alt="Quote preview" className="max-h-full max-w-full object-contain" src={staged.documentUrl} /> : <div className="text-center"><FileText className="mx-auto h-14 w-14 text-[rgb(var(--muted))]" /><div className="mt-3 font-medium">{staged.revision.original_file_name}</div></div>}</div></Card>
      <div className="space-y-4">{draft.warnings && draft.warnings.length > 0 && <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"><div className="mb-1 flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" />Review warnings</div>{draft.warnings.map(function(warning, index) { return <div key={index}>• {warning.replace(/PO /g, "Quote ")}</div>; })}</div>}
        <div className="grid gap-3 sm:grid-cols-2"><Field label="Customer *" value={draft.customerName} onChange={function(v) { update("customerName", v); }} /><Field label="Quote number *" value={draft.poNumber} onChange={function(v) { update("poNumber", v); }} /><Field label="Quote date *" type="date" value={draft.poDate} onChange={function(v) { update("poDate", v); }} /><Field label="Expiration date" type="date" value={draft.expectedDate} onChange={function(v) { update("expectedDate", v); }} /><Field label="Currency" value={draft.currency} onChange={function(v) { update("currency", v.toUpperCase().slice(0, 3)); }} /></div>
        <div className="space-y-3"><div className="flex items-center justify-between"><div className="text-sm font-semibold">Quoted items</div><Button variant="outline" size="sm" onClick={function() { setDraft(function(old) { return Object.assign({}, old, recalculate(old.lines.concat([blankLine()]), Number(old.taxTotal || 0))); }); }}><Plus className="mr-1 h-3.5 w-3.5" />Add line</Button></div>{draft.lines.map(function(line, index) { return <div key={index} className="rounded-md border border-[rgb(var(--border))] p-3"><div className="mb-2 flex justify-between text-xs font-semibold text-[rgb(var(--muted))]"><span>LINE {index + 1}</span>{draft.lines.length > 1 && <button onClick={function() { setDraft(function(old) { return Object.assign({}, old, recalculate(old.lines.filter(function(_, i) { return i !== index; }), Number(old.taxTotal || 0))); }); }}><X className="h-4 w-4" /></button>}</div><div className="grid gap-2 sm:grid-cols-6"><div className="sm:col-span-2"><Field label="Description *" value={line.description} onChange={function(v) { updateLine(index, "description", v); }} /></div><Field label="SKU" value={line.sku} onChange={function(v) { updateLine(index, "sku", v); }} /><Field label="Quantity *" type="number" value={line.quantity} onChange={function(v) { updateLine(index, "quantity", Number(v)); }} /><Field label="UOM *" value={line.uom} onChange={function(v) { updateLine(index, "uom", v); }} /><Field label="Unit rate" type="number" value={line.unitRate} onChange={function(v) { updateLine(index, "unitRate", Number(v)); }} /></div></div>; })}</div>
        <div className="grid gap-3 sm:grid-cols-3"><Field label="Subtotal" type="number" value={draft.subtotal} disabled /><Field label="Tax" type="number" value={draft.taxTotal} onChange={function(v) { var tax = Number(v); setDraft(function(old) { return Object.assign({}, old, recalculate(old.lines, tax)); }); }} /><Field label="Calculated total" type="number" value={draft.total} disabled /></div>{mutation.error && <div className="text-sm text-red-600">{mutation.error.message}</div>}
      </div>
    </div>
    <div className="flex justify-end gap-2 border-t border-[rgb(var(--border))] px-5 py-3"><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={missing || mutation.isPending} onClick={function() { mutation.mutate(); }}>{mutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}Confirm quote</Button></div>
  </div></div>;
}

function QuoteEdit({ data, onCancel, onSave, saving, error }) {
  const [draft, setDraft] = useState(function() {
    var lines = data.lines.map(function(line) { return { id: line.id, sku: line.sku || "", description: line.description || "", quantity: Number(line.quantity || 0), uom: line.uom || "", unitRate: Number(line.unit_rate || 0), taxAmount: Number(line.tax_amount || 0), lineAmount: Number(line.line_amount || 0) }; });
    return { customerName: data.quote.customer_name, poNumber: data.quote.quote_number, poDate: data.quote.quote_date, expectedDate: data.quote.expiration_date || "", currency: data.quote.currency || "USD", subtotal: Number(data.quote.subtotal || 0), taxTotal: Number(data.quote.tax_total || 0), total: Number(data.quote.total || 0), lines: lines };
  });
  var recalculate = function(lines, tax) { var next = lines.map(function(line) { return Object.assign({}, line, { lineAmount: Number(line.quantity || 0) * Number(line.unitRate || 0) }); }); var subtotal = next.reduce(function(sum, line) { return sum + line.lineAmount; }, 0); return { lines: next, subtotal: subtotal, taxTotal: tax, total: subtotal + tax }; };
  var update = function(field, value) { setDraft(function(old) { return Object.assign({}, old, { [field]: value }); }); };
  var updateLine = function(index, field, value) { setDraft(function(old) { var lines = old.lines.slice(); lines[index] = Object.assign({}, lines[index], { [field]: value }); return Object.assign({}, old, recalculate(lines, Number(old.taxTotal || 0))); }); };
  var missing = !draft.customerName || !draft.poNumber || !draft.poDate || !draft.lines.length || draft.lines.some(function(line) { return !line.description || !(Number(line.quantity) > 0) || !line.uom; });
  return <section className="space-y-4 rounded-md border border-blue-200 bg-blue-50/40 p-4"><div><div className="font-semibold">Edit quote details</div><div className="text-xs text-[rgb(var(--muted))]">Changes update the quote register and audit history. The original document remains unchanged.</div></div>
    <div className="grid gap-3 sm:grid-cols-2"><Field label="Customer *" value={draft.customerName} onChange={function(v) { update("customerName", v); }} /><Field label="Quote number *" value={draft.poNumber} onChange={function(v) { update("poNumber", v); }} /><Field label="Quote date *" type="date" value={draft.poDate} onChange={function(v) { update("poDate", v); }} /><Field label="Expiration date" type="date" value={draft.expectedDate} onChange={function(v) { update("expectedDate", v); }} /><Field label="Currency" value={draft.currency} onChange={function(v) { update("currency", v.toUpperCase().slice(0, 3)); }} /><Field label="Tax" type="number" value={draft.taxTotal} onChange={function(v) { var tax = Number(v); setDraft(function(old) { return Object.assign({}, old, recalculate(old.lines, tax)); }); }} /></div>
    <div className="space-y-3"><div className="flex items-center justify-between"><div className="text-sm font-semibold">Quoted items</div><Button variant="outline" size="sm" onClick={function() { setDraft(function(old) { return Object.assign({}, old, recalculate(old.lines.concat([blankLine()]), Number(old.taxTotal || 0))); }); }}><Plus className="mr-1 h-3.5 w-3.5" />Add line</Button></div>{draft.lines.map(function(line, index) { return <div key={line.id || "new-" + index} className="rounded-md border border-[rgb(var(--border))] bg-[rgb(var(--background))] p-3"><div className="mb-2 flex justify-between text-xs font-semibold text-[rgb(var(--muted))]"><span>LINE {index + 1}</span>{draft.lines.length > 1 && <button onClick={function() { setDraft(function(old) { return Object.assign({}, old, recalculate(old.lines.filter(function(_, i) { return i !== index; }), Number(old.taxTotal || 0))); }); }}><X className="h-4 w-4" /></button>}</div><div className="grid gap-2 sm:grid-cols-6"><div className="sm:col-span-2"><Field label="Description *" value={line.description} onChange={function(v) { updateLine(index, "description", v); }} /></div><Field label="SKU" value={line.sku} onChange={function(v) { updateLine(index, "sku", v); }} /><Field label="Quantity *" type="number" value={line.quantity} onChange={function(v) { updateLine(index, "quantity", Number(v)); }} /><Field label="UOM *" value={line.uom} onChange={function(v) { updateLine(index, "uom", v); }} /><Field label="Unit rate" type="number" value={line.unitRate} onChange={function(v) { updateLine(index, "unitRate", Number(v)); }} /></div></div>; })}</div>
    <div className="flex items-center justify-between"><div className="text-sm"><span className="text-[rgb(var(--muted))]">Calculated total: </span><strong>{money(draft.total, draft.currency)}</strong></div><div className="flex gap-2"><Button variant="outline" onClick={onCancel}>Cancel</Button><Button disabled={missing || saving} onClick={function() { onSave(draft); }}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save changes</Button></div></div>{error && <div className="text-sm text-red-600">{error.message}</div>}
  </section>;
}

function QuoteDetail({ id, onClose, onChanged }) {
  const [editing, setEditing] = useState(false);
  const query = useQuery({ queryKey: ["quote", id], queryFn: function() { return api("/api/quotes/" + id); } });
  const poQuery = useQuery({ queryKey: ["purchase-orders", "quote-link-options"], queryFn: function() { return api("/api/purchase-orders?status=all&page=1&pageSize=100&sort=updated_at&direction=desc"); } });
  const update = useMutation({ mutationFn: function(input) { return api("/api/quotes/" + id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }); }, onSuccess: function() { setEditing(false); query.refetch(); onChanged(); } });
  var data = query.data;
  var linkedId = data && data.links && data.links[0] && data.links[0].purchase_order_id || "";
  return <div className="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-sm" onMouseDown={onClose}><div className="absolute inset-y-0 right-0 w-full max-w-3xl overflow-auto border-l border-[rgb(var(--border))] bg-[rgb(var(--background))] shadow-2xl" onMouseDown={function(e) { e.stopPropagation(); }}><div className="sticky top-0 z-10 flex items-center justify-between border-b border-[rgb(var(--border))] bg-[rgb(var(--background))] px-5 py-3"><div className="font-semibold">{data ? data.quote.quote_number + " · " + data.quote.customer_name : "Quote"}</div><Button variant="ghost" size="icon" onClick={onClose}><X className="h-4 w-4" /></Button></div>{query.isLoading ? <Loader2 className="m-8 h-6 w-6 animate-spin" /> : query.error ? <div className="p-5 text-red-600">{query.error.message}</div> : data && <div className="space-y-5 p-5">
    <div className="flex flex-wrap items-center gap-2">{statusBadge(data.quote.status)}<Badge variant="outline">Revision {data.quote.revision_number}</Badge><Button variant="outline" size="sm" onClick={function() { setEditing(true); }}><Pencil className="mr-1 h-3.5 w-3.5" />Edit details</Button><span className="ml-auto text-xl font-semibold">{money(data.quote.total, data.quote.currency)}</span></div>
    {editing && <QuoteEdit data={data} saving={update.isPending} error={update.error} onCancel={function() { setEditing(false); }} onSave={function(draft) { update.mutate({ data: draft }); }} />}
    <div className="grid gap-3 sm:grid-cols-2"><label><span className="mb-1 block text-xs font-medium text-[rgb(var(--muted))]">Status</span><select className="h-10 w-full rounded-md border border-[rgb(var(--border))] bg-white px-3 text-sm" value={data.quote.status} onChange={function(e) { update.mutate({ status: e.target.value }); }}>{["draft","sent","accepted","declined","expired"].map(function(status) { return <option key={status} value={status}>{status[0].toUpperCase() + status.slice(1)}</option>; })}</select></label><label><span className="mb-1 block text-xs font-medium text-[rgb(var(--muted))]">Win / loss</span><select className="h-10 w-full rounded-md border border-[rgb(var(--border))] bg-white px-3 text-sm" value={data.quote.outcome || "open"} onChange={function(e) { update.mutate({ outcome: e.target.value }); }}>{["open","won","lost"].map(function(outcome) { return <option key={outcome} value={outcome}>{outcomeLabel(outcome)}</option>; })}</select></label><Field label="Target close" type="date" value={data.quote.target_close_date || ""} onChange={function(value) { update.mutate({ targetCloseDate: value }); }} /><label><span className="mb-1 block text-xs font-medium text-[rgb(var(--muted))]">Linked PO</span><select className="h-10 w-full rounded-md border border-[rgb(var(--border))] bg-white px-3 text-sm" value={linkedId} onChange={function(e) { update.mutate({ linkedPurchaseOrderId: e.target.value }); }}><option value="">Not linked</option>{((poQuery.data && poQuery.data.rows) || []).map(function(po) { return <option key={po.id} value={po.id}>{po.po_number} · {po.customer_name}</option>; })}</select></label></div>
    {update.error && <div className="text-sm text-red-600">{update.error.message}</div>}
    <div className="grid gap-3 rounded-md border border-[rgb(var(--border))] p-4 sm:grid-cols-4"><div><div className="text-xs text-[rgb(var(--muted))]">Quote date</div><div className="font-semibold">{data.quote.quote_date}</div></div><div><div className="text-xs text-[rgb(var(--muted))]">Expires</div><div className="font-semibold">{data.quote.expiration_date || "—"}</div></div><div><div className="text-xs text-[rgb(var(--muted))]">Quantity</div><div className="font-semibold">{number(data.lines.reduce(function(sum,line) { return sum + Number(line.quantity || 0); }, 0))}</div></div><div>{data.documentUrl && <Button variant="outline" size="sm" asChild><a href={data.documentUrl} target="_blank" rel="noreferrer">Open original</a></Button>}</div></div>
    <section><div className="mb-2 text-sm font-semibold">Quoted items</div><TableShell><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-[rgb(var(--muted))]"><tr><th className="px-3 py-2">Item</th><th className="px-3 py-2 text-right">Quantity</th><th className="px-3 py-2 text-right">Rate</th><th className="px-3 py-2 text-right">Amount</th></tr></thead><tbody>{data.lines.map(function(line) { return <tr key={line.id} className="border-t border-[rgb(var(--border))]"><td className="px-3 py-3"><div className="font-medium">{line.description}</div><div className="text-xs text-[rgb(var(--muted))]">{line.sku || "No SKU"} · {line.uom}</div></td><td className="px-3 py-3 text-right">{number(line.quantity)}</td><td className="px-3 py-3 text-right">{money(line.unit_rate, data.quote.currency)}</td><td className="px-3 py-3 text-right">{money(line.line_amount, data.quote.currency)}</td></tr>; })}</tbody></table></div></TableShell></section>
    <section><div className="mb-2 text-sm font-semibold">Audit history</div><div className="space-y-2">{data.events.map(function(event) { return <div key={event.id} className="border-l-2 border-[rgb(var(--border))] pl-3 text-sm"><div className="font-medium">{String(event.event_type).replace(/_/g, " ")}</div><div className="text-xs text-[rgb(var(--muted))]">{event.actor || "System"} · {new Date(event.created_at).toLocaleString()}</div></div>; })}</div></section>
  </div>}</div></div>;
}

export default function QuotesPanel() {
  const queryClient = useQueryClient();
  const inputRef = useRef(null);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [status, setStatus] = useState("all");
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState([]);
  const [reviewQueue, setReviewQueue] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [error, setError] = useState("");
  const list = useQuery({ queryKey: ["quotes", status, deferredSearch], queryFn: function() { return api("/api/quotes?status=" + status + "&q=" + encodeURIComponent(deferredSearch) + "&page=1&pageSize=50"); } });
  const registerUpdate = useMutation({ mutationFn: function(input) { return api("/api/quotes/" + input.id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input.data) }); }, onSuccess: function() { refresh(); }, onError: function(updateError) { setError(updateError.message); } });
  var handleFiles = async function(fileList) {
    var files = Array.from(fileList || []);
    if (!files.length) return;
    setError("");
    for (var fileIndex = 0; fileIndex < files.length; fileIndex++) {
      var file = files[fileIndex];
      var token = file.name + ":" + file.size + ":" + fileIndex + ":" + Date.now();
      setUploading(function(old) { return old.concat([{ token: token, name: file.name, status: "uploading" }]); });
      try {
        if (file.size > 3 * 1024 * 1024) throw new Error(file.name + " is larger than 3 MB.");
        var result = await api("/api/quotes/uploads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileName: file.name, contentType: file.type || "application/octet-stream", base64: await base64File(file) }) });
        if (result.error) throw new Error(result.error);
        setUploading(function(old) { return old.map(function(row) { return row.token === token ? Object.assign({}, row, { status: "ready" }) : row; }); });
        setReviewQueue(function(old) { return old.some(function(item) { return item.revision.id === result.revision.id; }) ? old : old.concat([result]); });
      } catch (uploadError) {
        setUploading(function(old) { return old.map(function(row) { return row.token === token ? Object.assign({}, row, { status: "failed", error: uploadError.message }) : row; }); });
        setError(uploadError.message);
      }
    }
  };
  var refresh = function() { queryClient.invalidateQueries({ queryKey: ["quotes"] }); };
  var rows = list.data && list.data.rows || [];
  var staged = reviewQueue.length ? reviewQueue[0] : null;
  return <div className="space-y-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-semibold tracking-tight">Quotes</h1><p className="mt-1 text-sm text-[rgb(var(--muted))]">Upload customer quotes, review pricing, and link accepted quotes to purchase orders.</p></div><Button onClick={function() { inputRef.current && inputRef.current.click(); }}><Upload className="mr-2 h-4 w-4" />Upload quotes</Button><input ref={inputRef} className="hidden" type="file" multiple accept={ACCEPT} onChange={function(e) { handleFiles(e.target.files); e.target.value = ""; }} /></div>
    <Card className={cn("border-dashed transition-colors", dragging && "border-blue-500 bg-blue-50")}>
      <div className="flex min-h-28 items-center justify-center p-5 text-center" onDragOver={function(e) { e.preventDefault(); setDragging(true); }} onDragLeave={function() { setDragging(false); }} onDrop={function(e) { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files); }}>
        <div><Upload className="mx-auto h-7 w-7 text-[rgb(var(--muted))]" /><div className="mt-2 text-sm font-medium">Drop PDF, image, CSV, or Excel quotes here</div><div className="mt-1 text-xs text-[rgb(var(--muted))]">Multiple files supported · 3 MB per file · review required before saving</div></div>
      </div>
      {uploading.length > 0 && <div className="border-t border-[rgb(var(--border))] px-4 py-2">{uploading.slice(-5).map(function(row) { return <div key={row.token} className="flex items-center gap-2 py-1 text-xs">{row.status === "uploading" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : row.status === "ready" ? <Check className="h-3.5 w-3.5 text-green-600" /> : <AlertTriangle className="h-3.5 w-3.5 text-red-600" />}<span>{row.name}</span>{row.error && <span className="text-red-600">{row.error}</span>}</div>; })}</div>}
    </Card>
    {(error || list.error) && <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error || list.error.message}</div>}{list.data && list.data.status === "missing_table" && <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"><strong>Database setup required.</strong> Run <code>docs/supabase-quotes.sql</code> in Supabase, then refresh.</div>}
    <div className="flex flex-wrap items-center gap-2"><div className="flex gap-1 rounded-md border border-[rgb(var(--border))] p-1">{["all","draft","sent","accepted","declined","expired"].map(function(item) { return <button key={item} onClick={function() { setStatus(item); }} className={"rounded px-3 py-1.5 text-sm " + (status === item ? "bg-slate-900 text-white" : "text-[rgb(var(--muted))] hover:bg-slate-100")}>{item === "all" ? "All" : item[0].toUpperCase() + item.slice(1)}</button>; })}</div><div className="relative ml-auto w-full sm:w-72"><Search className="absolute left-3 top-2.5 h-4 w-4 text-[rgb(var(--muted))]" /><Input className="pl-9" placeholder="Search customer or quote" value={search} onChange={function(e) { setSearch(e.target.value); }} /></div></div>
    <TableShell><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-[rgb(var(--muted))]"><tr><th className="px-4 py-3">Quote / Customer</th><th className="px-4 py-3">SKU / Description</th><th className="px-4 py-3">Dates</th><th className="px-4 py-3">Days Aging</th><th className="px-4 py-3">Target Close</th><th className="px-4 py-3 text-right">Quantity</th><th className="px-4 py-3 text-right">Value</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Win / Loss</th><th className="px-4 py-3">Linked PO</th></tr></thead><tbody>{list.isLoading ? <tr><td colSpan="10" className="p-10 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin" /></td></tr> : !rows.length ? <tr><td colSpan="10" className="p-10 text-center text-[rgb(var(--muted))]">No quotes in this view.</td></tr> : rows.map(function(row) { return <tr key={row.id} className="cursor-pointer border-t border-[rgb(var(--border))] hover:bg-slate-50" onClick={function() { setSelectedId(row.id); }}><td className="px-4 py-3"><div className="font-semibold">{row.quote_number}</div><div className="text-xs text-[rgb(var(--muted))]">{row.customer_name} · Rev {row.revision_number}</div></td><td className="min-w-64 px-4 py-3"><div className="space-y-1">{row.items.map(function(item, index) { return <div key={index}><div className="font-medium">{item.sku || "No SKU"}</div><div className="line-clamp-1 text-xs text-[rgb(var(--muted))]">{item.description}</div></div>; })}</div></td><td className="px-4 py-3"><div>{row.quote_date}</div><div className="text-xs text-[rgb(var(--muted))]">Expires {row.expiration_date || "—"}</div></td><td className="px-4 py-3">{agingIndicator(row.quote_date)}</td><td className="min-w-36 px-4 py-3" onClick={function(e) { e.stopPropagation(); }}><Input type="date" className="h-8 text-xs" value={row.target_close_date || ""} onChange={function(e) { registerUpdate.mutate({ id: row.id, data: { targetCloseDate: e.target.value } }); }} /></td><td className="px-4 py-3 text-right">{number(row.quantity)}</td><td className="px-4 py-3 text-right font-medium">{money(row.total, row.currency)}</td><td className="px-4 py-3">{statusBadge(row.status)}</td><td className="min-w-28 px-4 py-3" onClick={function(e) { e.stopPropagation(); }}><select className="h-8 w-full rounded-md border border-[rgb(var(--border))] bg-white px-2 text-xs" value={row.outcome || "open"} onChange={function(e) { registerUpdate.mutate({ id: row.id, data: { outcome: e.target.value } }); }}>{["open","won","lost"].map(function(outcome) { return <option key={outcome} value={outcome}>{outcomeLabel(outcome)}</option>; })}</select></td><td className="px-4 py-3 text-xs">{row.linkedPurchaseOrders.length ? row.linkedPurchaseOrders.map(function(po) { return po.poNumber; }).join(", ") : <span className="text-[rgb(var(--muted))]">Not linked</span>}</td></tr>; })}</tbody></table></div><div className="border-t border-[rgb(var(--border))] px-4 py-3 text-sm text-[rgb(var(--muted))]">{list.data && list.data.total || 0} quotes</div></TableShell>
    {staged && <QuoteReview staged={staged} onClose={function() { setReviewQueue(function(old) { return old.slice(1); }); }} onConfirmed={function(result) { setReviewQueue(function(old) { return old.slice(1); }); refresh(); setSelectedId(result.quote.id); }} />}{selectedId && <QuoteDetail id={selectedId} onClose={function() { setSelectedId(null); }} onChanged={refresh} />}
  </div>;
}
