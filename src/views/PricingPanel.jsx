import { useDeferredValue, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Loader2, Search } from "lucide-react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import TableShell from "../components/ui/table-shell";

function api(path) {
  return fetch(path, { credentials: "include" }).then(async function(response) {
    var body = await response.json().catch(function() { return {}; });
    if (!response.ok) throw new Error(body.error || "Request failed (" + response.status + ")");
    return body;
  });
}

function price(value) {
  if (!(Number(value) > 0)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(Number(value));
}

export default function PricingPanel() {
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [sort, setSort] = useState("customer");
  const [direction, setDirection] = useState("asc");
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const query = useQuery({
    queryKey: ["purchase-order-pricing", deferredSearch, sort, direction, page],
    queryFn: function() { return api("/api/purchase-orders/pricing?q=" + encodeURIComponent(deferredSearch) + "&sort=" + sort + "&direction=" + direction + "&page=" + page + "&pageSize=" + pageSize); }
  });
  var data = query.data || { rows: [], total: 0 };
  var totalPages = Math.max(1, Math.ceil((data.total || 0) / pageSize));
  var changeSort = function(field) {
    if (sort === field) setDirection(function(old) { return old === "asc" ? "desc" : "asc"; });
    else { setSort(field); setDirection("asc"); }
    setPage(1);
  };
  var Header = function({ field, children, right }) {
    return <th className={"px-4 py-3 " + (right ? "text-right" : "text-left")}><button type="button" className={"inline-flex items-center gap-1 font-semibold hover:text-slate-900 " + (right ? "justify-end" : "")} onClick={function() { changeSort(field); }}>{children}{sort === field && (direction === "asc" ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />)}</button></th>;
  };
  return <div className="space-y-4">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-2xl font-semibold tracking-tight">Pricing</h1><p className="mt-1 text-sm text-[rgb(var(--muted))]">Review customer and SKU pricing from the latest synced Nulogy data.</p></div>{data.syncedAt && <Badge variant="outline">Synced {new Date(data.syncedAt).toLocaleString()}</Badge>}</div>
    <div className="relative w-full sm:w-96"><Search className="absolute left-3 top-2.5 h-4 w-4 text-[rgb(var(--muted))]" /><Input className="pl-9" placeholder="Search customer, SKU, or description" value={search} onChange={function(event) { setSearch(event.target.value); setPage(1); }} /></div>
    {query.error && <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{query.error.message}</div>}
    <TableShell>
      <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><thead className="bg-slate-50 text-xs uppercase text-[rgb(var(--muted))]"><tr><Header field="customer">Customer</Header><Header field="sku">SKU number</Header><Header field="description">Description</Header><Header field="price" right>Price</Header></tr></thead><tbody>{query.isLoading ? <tr><td colSpan="4" className="p-10 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin" /></td></tr> : !data.rows.length ? <tr><td colSpan="4" className="p-10 text-center text-[rgb(var(--muted))]">No pricing rows found.</td></tr> : data.rows.map(function(row) { return <tr key={row.id} className="border-t border-[rgb(var(--border))]"><td className="px-4 py-3 font-medium">{row.customer || "Unassigned"}</td><td className="px-4 py-3 font-mono">{row.sku}</td><td className="px-4 py-3 text-[rgb(var(--muted))]">{row.description || "—"}</td><td className="px-4 py-3 text-right font-medium tabular-nums">{row.price ? price(row.price) : <span className="text-amber-700">Missing</span>}</td></tr>; })}</tbody></table></div>
      <div className="flex items-center justify-between border-t border-[rgb(var(--border))] px-4 py-3 text-sm"><span className="text-[rgb(var(--muted))]">{data.total || 0} price-list items</span><div className="flex items-center gap-2"><Button variant="outline" size="icon" disabled={page <= 1 || query.isFetching} onClick={function() { setPage(page - 1); }}><ChevronLeft className="h-4 w-4" /></Button><span>Page {page} of {totalPages}</span><Button variant="outline" size="icon" disabled={page >= totalPages || query.isFetching} onClick={function() { setPage(page + 1); }}><ChevronRight className="h-4 w-4" /></Button></div></div>
    </TableShell>
  </div>;
}
