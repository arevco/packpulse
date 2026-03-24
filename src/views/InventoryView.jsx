import { useDeferredValue, useMemo, useState } from "react";
import { useTheme } from "../theme";
import { useStyles } from "../hooks/useStyles";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import TableShell from "../components/ui/table-shell";
import SortHeaderButton from "../components/ui/sort-header-button";
import { formatDescriptionForDisplay, safeNum, triggerDownload } from "../utils";

function normalizeKey(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function pickLooseValue(row, keys) {
  if (!row || typeof row !== "object") return "";
  var rowKeys = Object.keys(row);
  for (var i = 0; i < keys.length; i++) {
    var wanted = normalizeKey(keys[i]);
    for (var j = 0; j < rowKeys.length; j++) {
      var rowKey = rowKeys[j];
      if (normalizeKey(rowKey) === wanted) return row[rowKey];
    }
  }
  return "";
}

function pickMappedOrLoose(row, mappedKey, fallbackKeys) {
  if (mappedKey && Object.prototype.hasOwnProperty.call(row || {}, mappedKey) && row[mappedKey] != null && row[mappedKey] !== "") {
    return row[mappedKey];
  }
  return pickLooseValue(row, fallbackKeys);
}

function csvCell(value) {
  var text = String(value == null ? "" : value);
  if (/[",\n]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
  return text;
}

function textCompare(a, b) {
  return String(a || "").localeCompare(String(b || ""), undefined, { sensitivity: "base", numeric: true });
}

function statusVariant(status) {
  var value = normalizeKey(status);
  if (!value) return "secondary";
  if (value.includes("good") || value.includes("available")) return "success";
  if (value.includes("hold") || value.includes("quarantine")) return "warning";
  if (value.includes("reject") || value.includes("damaged") || value.includes("blocked")) return "danger";
  return "info";
}

function statusBucketRows(row, mapping) {
  var buckets = [
    { label: "Good", keys: ["Good", "good"] },
    { label: "Quarantined", keys: ["Quarantined", "quarantined"] },
    { label: "Rejected", keys: ["Rejected", "rejected"] },
    { label: "Unavailable", keys: ["Unavailable", "unavailable"] }
  ];
  return buckets.map(function(bucket) {
    return {
      status: bucket.label,
      qty: safeNum(pickLooseValue(row, bucket.keys))
    };
  }).filter(function(bucket) {
    return bucket.qty > 0;
  });
}

export default function InventoryView({ inventory, itemMaster, invMapping }) {
  var rows = Array.isArray(inventory) ? inventory : [];
  var itemMasterRows = Array.isArray(itemMaster) ? itemMaster : [];
  var mapping = invMapping || {};
  var theme = useTheme();
  var C = theme.C;
  var mono = theme.mono;
  var styles = useStyles();
  var thC = styles.thC;
  var tdN = styles.tdN;
  var tdM = styles.tdM;
  var truncate = styles.truncate;

  var [searchTerm, setSearchTerm] = useState("");
  var [locationFilter, setLocationFilter] = useState("all");
  var [statusFilter, setStatusFilter] = useState("all");
  var [positiveOnly, setPositiveOnly] = useState(true);
  var [sortField, setSortField] = useState("qtyOnHand");
  var [sortDir, setSortDir] = useState("desc");
  var deferredSearch = useDeferredValue(searchTerm);

  var itemMasterDescriptionBySku = useMemo(function() {
    var out = {};
    itemMasterRows.forEach(function(row) {
      var sku = String(pickLooseValue(row, ["Item Code", "item_code", "Code", "code"]) || "").trim();
      if (!sku) return;
      var desc = String(pickLooseValue(row, ["Description", "description", "Item Description", "item_description"]) || "").trim();
      if (!desc) return;
      var key = normalizeKey(sku);
      if (!out[key] || desc.length > out[key].length) out[key] = desc;
    });
    return out;
  }, [itemMasterRows]);

  var preparedRows = useMemo(function() {
    var grouped = {};
    rows.forEach(function(row, idx) {
      var sku = String(pickMappedOrLoose(row, mapping.sku, ["Item Code", "item_code", "Code", "code", "SKU", "sku"]) || "").trim();
      var skuKey = normalizeKey(sku);
      var description = String(pickMappedOrLoose(row, mapping.description, ["Description", "description", "Item Description", "item_description"]) || "").trim();
      if (!description && skuKey && itemMasterDescriptionBySku[skuKey]) description = itemMasterDescriptionBySku[skuKey];
      var quantity = safeNum(pickMappedOrLoose(row, mapping.qtyOnHand, ["Qty On Hand", "qty_on_hand", "base_quantity", "Available", "On Hand", "quantity"]));
      var status = String(pickMappedOrLoose(row, mapping.status, ["Inventory Status", "inventory_status", "Status", "status"]) || "").trim();
      var location = String(pickMappedOrLoose(row, mapping.location, ["Location", "location", "Location Name", "location_name", "Storage Location", "storage_location", "Storage Location Name", "storage_location_name", "Warehouse Location", "warehouse_location", "Inventory Location", "inventory_location", "Bin Location", "bin_location"]) || "").trim();
      var lotCode = String(pickMappedOrLoose(row, mapping.lotCode, ["Lot Code", "lot_code", "Lot", "lot", "Batch", "batch"]) || "").trim();
      var expiryDate = String(pickMappedOrLoose(row, mapping.expiryDate, ["Expiry Date", "expiry_date", "Expiration Date", "expiration_date", "Expiry", "expiration"]) || "").trim();
      var palletNumber = String(pickMappedOrLoose(row, mapping.palletNumber, ["Pallet Number", "pallet_number", "Pallet", "pallet"]) || "").trim();
      var customer = String(pickLooseValue(row, ["Customer Name", "customer_name", "Customer", "customer"]) || "").trim();
      var baseUom = String(pickLooseValue(row, ["Base UOM", "base_unit_of_measure", "Base Unit Of Measure", "UOM"]) || "").trim();
      var bucketRows = statusBucketRows(row, mapping);
      var hasBucketedStatuses = bucketRows.length > 0;

      if (!sku && !description && !location && !lotCode && !expiryDate && !palletNumber && !(quantity || status || customer || hasBucketedStatuses)) return;

      var derivedRows = hasBucketedStatuses
        ? bucketRows
        : [{
            status: status || "Unknown",
            qty: quantity
          }];

      derivedRows.forEach(function(derived, derivedIdx) {
        var displayLocation = location || "";
        var displayLotCode = lotCode || "";
        var displayExpiry = expiryDate || "";
        var displayPallet = palletNumber || "";
        var displayStatus = derived.status || status || "Unknown";
        var key = [sku || ("row-" + idx), displayLocation, displayLotCode, displayExpiry, displayPallet, displayStatus, customer || "", String(derivedIdx)].join("|");
        if (!grouped[key]) {
          grouped[key] = {
            id: key,
            sku: sku || "--",
            description: formatDescriptionForDisplay(description) || "--",
            location: displayLocation,
            lotCode: displayLotCode,
            expiryDate: displayExpiry,
            palletNumber: displayPallet,
            qtyOnHand: 0,
            status: displayStatus,
            customer: customer || "--",
            baseUom: baseUom || "",
            sourceRows: 0
          };
        }
        grouped[key].qtyOnHand += derived.qty;
        grouped[key].sourceRows += 1;
        if (grouped[key].description === "--" && description) grouped[key].description = formatDescriptionForDisplay(description);
        if (!grouped[key].baseUom && baseUom) grouped[key].baseUom = baseUom;
      });
    });
    return Object.values(grouped);
  }, [rows, mapping, itemMasterDescriptionBySku]);

  var locationOptions = useMemo(function() {
    return Array.from(new Set(preparedRows.map(function(row) { return row.location; }).filter(Boolean))).sort(textCompare);
  }, [preparedRows]);

  var statusOptions = useMemo(function() {
    return Array.from(new Set(preparedRows.map(function(row) { return row.status; }).filter(Boolean))).sort(textCompare);
  }, [preparedRows]);

  var filteredRows = useMemo(function() {
    var q = String(deferredSearch || "").trim().toLowerCase();
    return preparedRows.filter(function(row) {
      if (positiveOnly && !(row.qtyOnHand > 0)) return false;
      if (locationFilter !== "all" && row.location !== locationFilter) return false;
      if (statusFilter !== "all" && row.status !== statusFilter) return false;
      if (!q) return true;
      var haystack = [
        row.sku,
        row.description,
        row.location,
        row.lotCode,
        row.palletNumber,
        row.customer,
        row.status
      ].join(" ").toLowerCase();
      return haystack.includes(q);
    });
  }, [preparedRows, deferredSearch, positiveOnly, locationFilter, statusFilter]);

  var sortedRows = useMemo(function() {
    var data = filteredRows.slice();
    data.sort(function(a, b) {
      var dir = sortDir === "asc" ? 1 : -1;
      if (sortField === "qtyOnHand") return (a.qtyOnHand - b.qtyOnHand) * dir;
      return textCompare(a[sortField], b[sortField]) * dir;
    });
    return data;
  }, [filteredRows, sortField, sortDir]);

  var summary = useMemo(function() {
    var totalQty = filteredRows.reduce(function(sum, row) { return sum + safeNum(row.qtyOnHand); }, 0);
    var uniqueLocations = new Set(filteredRows.map(function(row) { return row.location; }).filter(Boolean)).size;
    var uniqueLots = new Set(filteredRows.map(function(row) { return row.lotCode; }).filter(function(value) { return value && value !== "--"; })).size;
    var uniqueSkus = new Set(filteredRows.map(function(row) { return row.sku; }).filter(function(value) { return value && value !== "--"; })).size;
    return {
      totalQty: totalQty,
      uniqueLocations: uniqueLocations,
      uniqueLots: uniqueLots,
      uniqueSkus: uniqueSkus
    };
  }, [filteredRows]);

  var hasLocationColumn = useMemo(function() {
    return preparedRows.some(function(row) { return !!String(row.location || "").trim(); });
  }, [preparedRows]);
  var hasLotColumn = useMemo(function() {
    return preparedRows.some(function(row) { return !!String(row.lotCode || "").trim(); });
  }, [preparedRows]);
  var hasExpiryColumn = useMemo(function() {
    return preparedRows.some(function(row) { return !!String(row.expiryDate || "").trim(); });
  }, [preparedRows]);
  var hasPalletColumn = useMemo(function() {
    return preparedRows.some(function(row) { return !!String(row.palletNumber || "").trim(); });
  }, [preparedRows]);

  var handleSort = function(field) {
    if (sortField === field) setSortDir(function(prev) { return prev === "asc" ? "desc" : "asc"; });
    else {
      setSortField(field);
      setSortDir(field === "qtyOnHand" ? "desc" : "asc");
    }
  };

  var exportCsv = function() {
    var headers = ["sku", "description", "location", "lot_code", "pallet_number", "qty_on_hand", "base_uom", "status", "customer"];
    var lines = [headers.join(",")];
    sortedRows.forEach(function(row) {
      lines.push([
        csvCell(row.sku),
        csvCell(row.description),
        csvCell(row.location),
        csvCell(row.lotCode),
        csvCell(row.palletNumber),
        csvCell(String(Math.round((row.qtyOnHand || 0) * 100) / 100)),
        csvCell(row.baseUom || ""),
        csvCell(row.status),
        csvCell(row.customer)
      ].join(","));
    });
    var stamp = new Date().toISOString().slice(0, 10);
    triggerDownload(lines.join("\n"), "inventory_lookup_" + stamp + ".csv", "text/csv");
  };

  var resetFilters = function() {
    setSearchTerm("");
    setLocationFilter("all");
    setStatusFilter("all");
    setPositiveOnly(true);
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold tracking-[-0.02em] text-[rgb(var(--foreground))]">Inventory Lookup</h2>
        <p className="mt-1 text-sm text-[rgb(var(--muted))]">Search inventory by SKU, location, lot code, and pallet with on-hand quantity.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="text"
          placeholder="Search SKU / description / lot / pallet"
          value={searchTerm}
          onChange={function(event) { setSearchTerm(event.target.value); }}
          className="h-10 min-w-[280px] flex-1 text-sm"
        />
        <select
          value={locationFilter}
          onChange={function(event) { setLocationFilter(event.target.value); }}
          style={Object.assign({}, styles.sel, { height: 40, minWidth: 190 })}
        >
          <option value="all">All Locations</option>
          {locationOptions.map(function(option) {
            return <option key={option} value={option}>{option}</option>;
          })}
        </select>
        <select
          value={statusFilter}
          onChange={function(event) { setStatusFilter(event.target.value); }}
          style={Object.assign({}, styles.sel, { height: 40, minWidth: 170 })}
        >
          <option value="all">All Statuses</option>
          {statusOptions.map(function(option) {
            return <option key={option} value={option}>{option}</option>;
          })}
        </select>
        <Button variant={positiveOnly ? "active" : "outline"} size="default" onClick={function() { setPositiveOnly(function(prev) { return !prev; }); }}>
          Positive Qty
        </Button>
        <Button variant="outline" size="default" onClick={resetFilters}>Clear</Button>
        <Button variant="outline" size="default" onClick={exportCsv} disabled={!sortedRows.length}>CSV</Button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <TableShell className="p-4">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[rgb(var(--muted))]">Visible Qty</div>
          <div className="mt-2 text-4xl font-semibold text-[rgb(var(--foreground))]">{Math.round(summary.totalQty).toLocaleString()}</div>
          <div className="mt-1 text-sm text-[rgb(var(--muted))]">{sortedRows.length.toLocaleString()} rows visible</div>
        </TableShell>
        <TableShell className="p-4">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[rgb(var(--muted))]">Locations</div>
          <div className="mt-2 text-4xl font-semibold text-[rgb(var(--foreground))]">{summary.uniqueLocations.toLocaleString()}</div>
          <div className="mt-1 text-sm text-[rgb(var(--muted))]">Filtered location count</div>
        </TableShell>
        <TableShell className="p-4">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[rgb(var(--muted))]">Lot Codes</div>
          <div className="mt-2 text-4xl font-semibold text-[rgb(var(--foreground))]">{summary.uniqueLots.toLocaleString()}</div>
          <div className="mt-1 text-sm text-[rgb(var(--muted))]">Distinct lots in view</div>
        </TableShell>
        <TableShell className="p-4">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[rgb(var(--muted))]">SKUs</div>
          <div className="mt-2 text-4xl font-semibold text-[rgb(var(--foreground))]">{summary.uniqueSkus.toLocaleString()}</div>
          <div className="mt-1 text-sm text-[rgb(var(--muted))]">Distinct items in view</div>
        </TableShell>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm text-[rgb(var(--muted))]">
        <Badge variant="secondary">{preparedRows.length.toLocaleString()} grouped rows</Badge>
        <Badge variant="secondary">{locationOptions.length.toLocaleString()} locations</Badge>
        <Badge variant="secondary">{statusOptions.length.toLocaleString()} statuses</Badge>
      </div>

      {(!hasLocationColumn || !hasPalletColumn) ? (
        <div className="rounded-md border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-3 py-2 text-sm text-[rgb(var(--muted))]">
          Current inventory source includes
          {hasLotColumn ? " lot codes" : ""}
          {hasLotColumn && hasExpiryColumn ? " and" : ""}
          {hasExpiryColumn ? " expiry dates" : ""}
          {!hasLotColumn && !hasExpiryColumn ? " quantity/status rows" : ""}
          , but it does not include
          {!hasLocationColumn && !hasPalletColumn ? " location or pallet data" : (!hasLocationColumn ? " location data" : " pallet data")}
          .
        </div>
      ) : null}

      <TableShell>
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr>
                <th style={thC(sortField === "sku")}><SortHeaderButton onClick={function() { handleSort("sku"); }}>SKU</SortHeaderButton></th>
                <th style={thC(sortField === "description")}><SortHeaderButton onClick={function() { handleSort("description"); }}>Description</SortHeaderButton></th>
                {hasLocationColumn ? <th style={thC(sortField === "location")}><SortHeaderButton onClick={function() { handleSort("location"); }}>Location</SortHeaderButton></th> : null}
                {hasLotColumn ? <th style={thC(sortField === "lotCode")}><SortHeaderButton onClick={function() { handleSort("lotCode"); }}>Lot Code</SortHeaderButton></th> : null}
                {hasExpiryColumn ? <th style={thC(sortField === "expiryDate")}><SortHeaderButton onClick={function() { handleSort("expiryDate"); }}>Expiry</SortHeaderButton></th> : null}
                {hasPalletColumn ? <th style={thC(sortField === "palletNumber")}><SortHeaderButton onClick={function() { handleSort("palletNumber"); }}>Pallet</SortHeaderButton></th> : null}
                <th style={thC(sortField === "qtyOnHand")}><SortHeaderButton onClick={function() { handleSort("qtyOnHand"); }}>Qty On Hand</SortHeaderButton></th>
                <th style={thC(sortField === "status")}><SortHeaderButton onClick={function() { handleSort("status"); }}>Status</SortHeaderButton></th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.length ? sortedRows.map(function(row) {
                return (
                  <tr key={row.id} className="border-b border-[rgb(var(--border))] last:border-b-0">
                    <td style={Object.assign({}, tdN, { fontWeight: 700 })}>{row.sku}</td>
                    <td style={Object.assign({}, tdN, truncate(320))} title={row.description}>{row.description}</td>
                    {hasLocationColumn ? <td style={Object.assign({}, tdN, { fontFamily: mono })}>{row.location || "--"}</td> : null}
                    {hasLotColumn ? <td style={Object.assign({}, tdN, { fontFamily: mono })}>{row.lotCode || "--"}</td> : null}
                    {hasExpiryColumn ? <td style={Object.assign({}, tdN, { fontFamily: mono })}>{row.expiryDate || "--"}</td> : null}
                    {hasPalletColumn ? <td style={Object.assign({}, tdN, { fontFamily: mono })}>{row.palletNumber || "--"}</td> : null}
                    <td style={Object.assign({}, tdM, { fontWeight: 700, color: C.ok })}>
                      {Math.round((row.qtyOnHand || 0) * 100) / 100}
                      {row.baseUom ? <span style={{ marginLeft: 6, color: C.dim, fontWeight: 500 }}>{row.baseUom}</span> : null}
                    </td>
                    <td style={tdN}><Badge variant={statusVariant(row.status)}>{row.status}</Badge></td>
                  </tr>
                );
              }) : (
                <tr>
                  <td colSpan={2 + (hasLocationColumn ? 1 : 0) + (hasLotColumn ? 1 : 0) + (hasExpiryColumn ? 1 : 0) + (hasPalletColumn ? 1 : 0) + 2} style={Object.assign({}, tdN, { padding: "28px 16px", textAlign: "center", color: C.dim })}>
                    No inventory rows match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </TableShell>
    </div>
  );
}
