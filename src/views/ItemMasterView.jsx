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

export default function ItemMasterView(props) {
  var rows = Array.isArray(props.itemMaster) ? props.itemMaster : [];
  var C = useTheme().C;
  var [q, setQ] = useState("");

  var prepared = useMemo(function() {
    return rows.map(function(r, idx) {
      var sku = pickValue(r, ["Item Code", "Code", "item_code", "code"]).toString().trim();
      var description = pickValue(r, ["Description", "description", "Item Description"]).toString().trim();
      var cost = pickValue(r, [
        "Cost Per Unit", "cost_per_unit", "Unit Cost", "unit_cost",
        "Standard Cost", "standard_cost", "Cost Per Base Unit", "cost_per_base_unit"
      ]);
      var costNum = safeNum(cost);
      return {
        id: sku || ("row-" + idx),
        sku: sku || "--",
        description: description || "--",
        costRaw: cost,
        costNum: costNum
      };
    });
  }, [rows]);

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
                      {r.costNum > 0 ? ("$" + r.costNum.toFixed(4)) : "--"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </TableShell>
    </div>
  );
}
