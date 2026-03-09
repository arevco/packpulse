import { useMemo, useState } from "react";
import { useTheme } from "../theme";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import TableShell from "../components/ui/table-shell";
import { safeNum, triggerDownload } from "../utils";

function pickValue(row, keys) {
  if (!row || !keys || !keys.length) return "";
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if (Object.prototype.hasOwnProperty.call(row, k) && row[k] != null && row[k] !== "") return row[k];
  }
  return "";
}

function normalizeKey(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function pickCostValue(row) {
  var direct = pickValue(row, [
    "Cost Per Unit", "cost_per_unit", "Unit Cost", "unit_cost",
    "Standard Cost", "standard_cost", "Cost Per Base Unit", "cost_per_base_unit"
  ]);
  if (direct != null && direct !== "") return direct;
  var keys = Object.keys(row || {});
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    var nk = normalizeKey(k);
    var hasCostToken = nk.indexOf("cost") !== -1 || nk.indexOf("price") !== -1;
    var looksLikeUnitish =
      nk.indexOf("unit") !== -1 ||
      nk.indexOf("base") !== -1 ||
      nk.indexOf("standard") !== -1 ||
      nk.indexOf("std") !== -1 ||
      nk.indexOf("default") !== -1 ||
      nk.indexOf("avg") !== -1 ||
      nk.indexOf("average") !== -1 ||
      nk === "cost" ||
      nk === "price";
    var looksLikeUnitCost = hasCostToken && looksLikeUnitish && nk.indexOf("total") === -1 && nk.indexOf("extended") === -1 && nk.indexOf("amount") === -1;
    if (looksLikeUnitCost && row[k] != null && row[k] !== "") return row[k];
  }
  return "";
}

export default function ItemMasterView(props) {
  var rows = Array.isArray(props.itemMaster) ? props.itemMaster : [];
  var inventoryRows = Array.isArray(props.inventory) ? props.inventory : [];
  var C = useTheme().C;
  var [q, setQ] = useState("");
  var [costByItemId, setCostByItemId] = useState({});
  var [costBySkuExport, setCostBySkuExport] = useState({});
  var [loadingBackfill, setLoadingBackfill] = useState(false);
  var [backfillMsg, setBackfillMsg] = useState("");
  var [exportingFull, setExportingFull] = useState(false);

  var inventoryCostBySku = useMemo(function() {
    var out = {};
    inventoryRows.forEach(function(r) {
      var sku = pickValue(r, ["Item Code", "Code", "item_code", "code"]).toString().trim();
      if (!sku) return;
      var skuNorm = normalizeKey(sku);
      var cost = pickCostValue(r);
      var n = safeNum(cost);
      if (!(n > 0)) return;
      if (!out[sku] || n > out[sku]) out[sku] = n;
      if (skuNorm && (!out[skuNorm] || n > out[skuNorm])) out[skuNorm] = n;
    });
    return out;
  }, [inventoryRows]);

  var prepared = useMemo(function() {
    return rows.map(function(r, idx) {
      var itemId = pickValue(r, ["Item ID", "item_id", "id", "ID"]).toString().trim();
      var sku = pickValue(r, ["Item Code", "Code", "item_code", "code"]).toString().trim();
      var description = pickValue(r, ["Description", "description", "Item Description"]).toString().trim();
      var cost = pickCostValue(r);
      var itemMasterCost = safeNum(cost);
      var htmlCost = itemId ? safeNum(costByItemId[itemId]) : 0;
      var skuNorm = normalizeKey(sku);
      var exportCost = sku ? safeNum(costBySkuExport[sku] || (skuNorm ? costBySkuExport[skuNorm] : 0)) : 0;
      var inventoryCost = sku ? safeNum(inventoryCostBySku[sku] || (skuNorm ? inventoryCostBySku[skuNorm] : 0)) : 0;
      var costNum = itemMasterCost > 0 ? itemMasterCost : (htmlCost > 0 ? htmlCost : (exportCost > 0 ? exportCost : inventoryCost));
      return {
        id: sku || ("row-" + idx),
        itemId: itemId || "",
        sku: sku || "--",
        description: description || "--",
        costRaw: cost,
        costNum: costNum,
        costSource: itemMasterCost > 0 ? "itemmaster" : (htmlCost > 0 ? "item-page" : (exportCost > 0 ? "full-export" : (inventoryCost > 0 ? "inventory" : "none")))
      };
    });
  }, [rows, inventoryCostBySku, costByItemId, costBySkuExport]);

  var filtered = useMemo(function() {
    var qq = String(q || "").toLowerCase().trim();
    if (!qq) return prepared;
    return prepared.filter(function(r) {
      return r.sku.toLowerCase().includes(qq) || r.description.toLowerCase().includes(qq);
    });
  }, [prepared, q]);

  var withCost = filtered.filter(function(r) { return r.costNum > 0; }).length;
  var backfillableIds = useMemo(function() {
    var set = {};
    prepared.forEach(function(r) {
      if (!r.itemId) return;
      if (r.costNum > 0) return;
      set[r.itemId] = true;
    });
    return Object.keys(set);
  }, [prepared]);

  var runBackfill = async function() {
    if (!backfillableIds.length || loadingBackfill) return;
    setLoadingBackfill(true);
    setBackfillMsg("");
    try {
      var resp = await fetch("/api/nulogy/item-cost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemIds: backfillableIds.slice(0, 250) })
      });
      var body = await resp.json();
      if (!resp.ok) throw new Error((body && body.error) || "Backfill request failed");
      var map = body && body.costsByItemId ? body.costsByItemId : {};
      setCostByItemId(function(prev) { return Object.assign({}, prev, map); });
      setBackfillMsg("Backfill found " + (body && body.found ? body.found : 0) + " item costs.");
    } catch (err) {
      setBackfillMsg(err && err.message ? err.message : "Could not backfill costs.");
    } finally {
      setLoadingBackfill(false);
    }
  };

  var escapeCsv = function(value) {
    var s = String(value == null ? "" : value);
    if (/[",\n]/.test(s)) return "\"" + s.replace(/"/g, "\"\"") + "\"";
    return s;
  };

  var exportFullItemMaster = async function() {
    if (exportingFull) return;
    setExportingFull(true);
    setBackfillMsg("");
    try {
      var createRes = await fetch("/api/nulogy/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportType: "itemmaster" })
      });
      var createBody = await createRes.json();
      if (!createRes.ok) throw new Error((createBody && createBody.error) || "Could not start item master report");
      var statusUrl = createBody.statusUrl;
      if (!statusUrl) throw new Error("No status URL returned from create.");

      var downloadUrl = "";
      for (var i = 0; i < 90; i++) {
        await new Promise(function(resolve) { setTimeout(resolve, 2500); });
        var stRes = await fetch("/api/nulogy/status?url=" + encodeURIComponent(statusUrl));
        var stBody = await stRes.json();
        if (!stRes.ok) throw new Error((stBody && stBody.error) || "Status check failed");
        if (stBody.status === "COMPLETED" && stBody.downloadUrl) {
          downloadUrl = stBody.downloadUrl;
          break;
        }
        if (stBody.status === "FAILED" || stBody.status === "ERROR") {
          throw new Error("Nulogy report generation failed.");
        }
      }
      if (!downloadUrl) throw new Error("Timed out waiting for report completion.");

      var dlRes = await fetch("/api/nulogy/download?url=" + encodeURIComponent(downloadUrl) + "&type=itemmaster&raw=1");
      var dlBody = await dlRes.json();
      if (!dlRes.ok) throw new Error((dlBody && dlBody.error) || "Could not download item master data");
      var data = Array.isArray(dlBody && dlBody.data) ? dlBody.data : [];
      var headers = Array.isArray(dlBody && dlBody.originalHeaders) && dlBody.originalHeaders.length
        ? dlBody.originalHeaders
        : (data.length ? Object.keys(data[0]) : []);
      if (!headers.length) throw new Error("No headers returned from Nulogy item master download.");

      var exportMap = {};
      data.forEach(function(row) {
        var sku = String((row && (row.Code || row.code || row["Item Code"] || row["item_code"])) || "").trim();
        if (!sku) return;
        var skuNorm = normalizeKey(sku);
        var c = safeNum(
          (row && (row["Cost Per Unit"] || row.cost_per_unit || row["Unit Cost"] || row.unit_cost || row["Standard Cost"] || row.standard_cost)) || 0
        );
        if (c > 0) {
          exportMap[sku] = c;
          if (skuNorm) exportMap[skuNorm] = c;
        }
      });
      if (Object.keys(exportMap).length) {
        setCostBySkuExport(function(prev) { return Object.assign({}, prev, exportMap); });
      }

      var lines = [];
      lines.push(headers.map(escapeCsv).join(","));
      data.forEach(function(row) {
        lines.push(headers.map(function(h) { return escapeCsv(row[h]); }).join(","));
      });
      var stamp = new Date().toISOString().slice(0, 10);
      triggerDownload(lines.join("\n"), "nulogy_item_master_full_" + stamp + ".csv", "text/csv");
      setBackfillMsg("Downloaded full item master CSV (" + data.length + " rows). Loaded " + Object.keys(exportMap).length + " cost values into the table.");
    } catch (err) {
      setBackfillMsg(err && err.message ? err.message : "Could not export full item master CSV.");
    } finally {
      setExportingFull(false);
    }
  };

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Input
          type="text"
          placeholder="Search SKU or description..."
          value={q}
          onChange={function(e) { setQ(e.target.value); }}
          className="h-10 w-72 text-sm"
        />
        <Badge variant="secondary">{filtered.length} rows</Badge>
        <Badge variant={withCost ? "success" : "warning"}>
          {withCost} with cost
        </Badge>
        <button
          type="button"
          onClick={runBackfill}
          disabled={loadingBackfill || !backfillableIds.length}
          style={{
            height: 34,
            padding: "0 10px",
            borderRadius: 8,
            border: "1px solid " + C.border,
            background: (loadingBackfill || !backfillableIds.length) ? C.raised : C.surface,
            color: C.text,
            fontSize: 12,
            cursor: (loadingBackfill || !backfillableIds.length) ? "not-allowed" : "pointer"
          }}
          title="Pull Cost per unit from Nulogy item page fallback"
        >
          {loadingBackfill ? "Backfilling..." : ("Backfill Cost (" + backfillableIds.length + ")")}
        </button>
        <button
          type="button"
          onClick={exportFullItemMaster}
          disabled={exportingFull}
          style={{
            height: 34,
            padding: "0 10px",
            borderRadius: 8,
            border: "1px solid " + C.border,
            background: exportingFull ? C.raised : C.surface,
            color: C.text,
            fontSize: 12,
            cursor: exportingFull ? "not-allowed" : "pointer"
          }}
          title="Run a full item_master API export and download raw CSV"
        >
          {exportingFull ? "Exporting..." : "Download Full Item Master CSV"}
        </button>
      </div>
      {!!backfillMsg && <div className="mb-2 text-xs text-[rgb(var(--muted))]">{backfillMsg}</div>}
      <TableShell>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: C.raised }}>
                <th style={{ textAlign: "left", padding: "8px 10px", fontSize: 12, color: C.dim }}>SKU</th>
                <th style={{ textAlign: "left", padding: "8px 10px", fontSize: 12, color: C.dim }}>Description</th>
                <th style={{ textAlign: "right", padding: "8px 10px", fontSize: 12, color: C.dim }}>Cost Per Unit</th>
              </tr>
            </thead>
            <tbody>
              {!filtered.length && (
                <tr>
                  <td colSpan={3} style={{ padding: 24, textAlign: "center", color: C.dim }}>
                    No item master rows found.
                  </td>
                </tr>
              )}
              {filtered.map(function(r) {
                return (
                  <tr key={r.id} style={{ borderBottom: "1px solid " + C.border }}>
                    <td style={{ padding: "8px 10px", fontSize: 13, fontWeight: 600, color: C.bright }}>{r.sku}</td>
                    <td style={{ padding: "8px 10px", fontSize: 13, color: C.text }}>{r.description}</td>
                    <td style={{ padding: "8px 10px", fontSize: 13, color: r.costNum > 0 ? C.ok : C.dim, textAlign: "right" }}>
                      {r.costNum > 0 ? ("$" + r.costNum.toFixed(4) + (r.costSource === "inventory" ? " *" : "")) : "--"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </TableShell>
      <div className="mt-1 text-xs text-[rgb(var(--muted))]">* cost sourced from inventory when item master cost is blank.</div>
      <div className="mt-0.5 text-xs text-[rgb(var(--muted))]">Item-page fallback uses Nulogy item detail HTML (`Cost per unit`) by Item ID.</div>
    </div>
  );
}
