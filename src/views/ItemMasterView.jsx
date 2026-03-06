import { useMemo, useState } from "react";
import { useTheme } from "../theme";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import TableShell from "../components/ui/table-shell";
import { safeNum } from "../utils";

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

  var inventoryCostBySku = useMemo(function() {
    var out = {};
    inventoryRows.forEach(function(r) {
      var sku = pickValue(r, ["Item Code", "Code", "item_code", "code"]).toString().trim();
      if (!sku) return;
      var cost = pickCostValue(r);
      var n = safeNum(cost);
      if (!(n > 0)) return;
      if (!out[sku] || n > out[sku]) out[sku] = n;
    });
    return out;
  }, [inventoryRows]);

  var prepared = useMemo(function() {
    return rows.map(function(r, idx) {
      var sku = pickValue(r, ["Item Code", "Code", "item_code", "code"]).toString().trim();
      var description = pickValue(r, ["Description", "description", "Item Description"]).toString().trim();
      var cost = pickCostValue(r);
      var itemMasterCost = safeNum(cost);
      var inventoryCost = sku ? safeNum(inventoryCostBySku[sku]) : 0;
      var costNum = itemMasterCost > 0 ? itemMasterCost : inventoryCost;
      return {
        id: sku || ("row-" + idx),
        sku: sku || "--",
        description: description || "--",
        costRaw: cost,
        costNum: costNum,
        costSource: itemMasterCost > 0 ? "itemmaster" : (inventoryCost > 0 ? "inventory" : "none")
      };
    });
  }, [rows, inventoryCostBySku]);

  var filtered = useMemo(function() {
    var qq = String(q || "").toLowerCase().trim();
    if (!qq) return prepared;
    return prepared.filter(function(r) {
      return r.sku.toLowerCase().includes(qq) || r.description.toLowerCase().includes(qq);
    });
  }, [prepared, q]);

  var withCost = filtered.filter(function(r) { return r.costNum > 0; }).length;

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
      </div>
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
    </div>
  );
}
