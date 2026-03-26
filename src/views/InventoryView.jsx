import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useTheme } from "../theme";
import { useStyles } from "../hooks/useStyles";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Card } from "../components/ui/card";
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

function parseInventoryDate(value) {
  var raw = String(value || "").trim();
  if (!raw) return null;
  var ymd = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (ymd) {
    var ymdDate = new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]));
    return isNaN(ymdDate) ? null : ymdDate;
  }
  var mdy = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
  if (mdy) {
    var year = Number(mdy[3]);
    if (year < 100) year += 2000;
    var mdyDate = new Date(year, Number(mdy[1]) - 1, Number(mdy[2]));
    return isNaN(mdyDate) ? null : mdyDate;
  }
  var parsed = new Date(raw);
  if (isNaN(parsed)) return null;
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}

function daysUntilInventoryDate(value) {
  var dt = parseInventoryDate(value);
  if (!dt) return null;
  var now = new Date();
  var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((dt.getTime() - today.getTime()) / 86400000);
}

function formatDaysToExpiry(days) {
  if (days == null) return "";
  if (days < 0) return Math.abs(days).toLocaleString() + "d overdue";
  if (days === 0) return "today";
  return days.toLocaleString() + "d";
}

function matchesExpiryFilter(days, filter) {
  if (filter === "all") return true;
  if (filter === "missing") return days == null;
  if (days == null) return false;
  if (filter === "expired") return days < 0;
  if (filter === "0_30") return days >= 0 && days <= 30;
  if (filter === "31_60") return days >= 31 && days <= 60;
  if (filter === "61_90") return days >= 61 && days <= 90;
  if (filter === "90_plus") return days > 90;
  return true;
}

function coveragePct(count, total) {
  return total > 0 ? Math.round((count / total) * 100) : 0;
}

function statusVariant(status) {
  var value = normalizeKey(status);
  if (!value) return "secondary";
  if (value.includes("good") || value.includes("available")) return "success";
  if (value.includes("hold") || value.includes("quarantine")) return "warning";
  if (value.includes("reject") || value.includes("damaged") || value.includes("blocked")) return "danger";
  return "info";
}

function statusBucketRows(row) {
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

function sortInventoryRows(rows, sortField, sortDir) {
  var data = rows.slice();
  data.sort(function(a, b) {
    var dir = sortDir === "asc" ? 1 : -1;
    if (sortField === "qtyOnHand") return (a.qtyOnHand - b.qtyOnHand) * dir;
    if (sortField === "daysToExpiry") {
      var aDays = a.daysToExpiry == null ? Number.POSITIVE_INFINITY : a.daysToExpiry;
      var bDays = b.daysToExpiry == null ? Number.POSITIVE_INFINITY : b.daysToExpiry;
      return (aDays - bDays) * dir;
    }
    return textCompare(a[sortField], b[sortField]) * dir;
  });
  return data;
}

function matchesInventoryFilters(row, q, filters) {
  if (filters.positiveOnly && !(row.qtyOnHand > 0)) return false;
  if (filters.locationFilter !== "all" && row.location !== filters.locationFilter) return false;
  if (filters.statusFilter !== "all" && row.status !== filters.statusFilter) return false;
  if (filters.customerFilter !== "all" && row.customer !== filters.customerFilter) return false;
  if (filters.sourceFilter !== "all" && (row.source || "") !== filters.sourceFilter) return false;
  if (!matchesExpiryFilter(row.daysToExpiry, filters.expiryFilter)) return false;
  if (!q) return true;
  var haystack = [
    row.sku,
    row.description,
    row.location,
    row.lotCode,
    row.expiryDate,
    row.palletNumber,
    row.customer,
    row.status,
    row.source,
    row.itemCategory,
    row.siteName,
    row.zone
  ].join(" ").toLowerCase();
  return haystack.includes(q);
}

var inventoryDetailCache = {
  key: "",
  rows: null
};

function inventoryRowsNeedDetailFetch(rows, fileName) {
  if (!Array.isArray(rows) || !rows.length) return false;
  var compactSourceRows = rows.filter(function(row) {
    var source = String(pickLooseValue(row, ["Source", "source"]) || "").toLowerCase();
    return source.includes("compact_inventory");
  }).length;
  if (compactSourceRows >= Math.max(1, Math.round(rows.length * 0.5))) return true;
  if (String(fileName || "").toLowerCase().indexOf("nulogy") === -1) return false;
  var detailRows = rows.filter(function(row) {
    return !!String(pickLooseValue(row, [
      "Location", "location",
      "Lot Code", "lot_code",
      "Expiry Date", "expiry_date",
      "Pallet Number", "pallet_number"
    ]) || "").trim();
  }).length;
  return detailRows < Math.max(10, Math.round(rows.length * 0.15));
}

export default function InventoryView({ inventory, itemMaster, invMapping, inventoryTimestamp, inventoryFileName }) {
  var fallbackRows = Array.isArray(inventory) ? inventory : [];
  var itemMasterRows = Array.isArray(itemMaster) ? itemMaster : [];
  var mapping = invMapping || {};
  var detailCacheKey = String(
    inventoryTimestamp && inventoryTimestamp.toISOString
      ? inventoryTimestamp.toISOString()
      : (inventoryTimestamp || inventoryFileName || "")
  );
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
  var [customerFilter, setCustomerFilter] = useState("all");
  var [expiryFilter, setExpiryFilter] = useState("all");
  var [sourceFilter, setSourceFilter] = useState("all");
  var [viewMode, setViewMode] = useState("grouped");
  var [positiveOnly, setPositiveOnly] = useState(true);
  var [sortField, setSortField] = useState("qtyOnHand");
  var [sortDir, setSortDir] = useState("desc");
  var [page, setPage] = useState(1);
  var [pageSize, setPageSize] = useState(100);
  var [detailRows, setDetailRows] = useState(function() {
    return inventoryDetailCache.key === detailCacheKey && Array.isArray(inventoryDetailCache.rows)
      ? inventoryDetailCache.rows
      : null;
  });
  var [detailStatus, setDetailStatus] = useState(function() {
    return inventoryDetailCache.key === detailCacheKey && Array.isArray(inventoryDetailCache.rows) ? "ready" : "idle";
  });
  var [detailError, setDetailError] = useState("");
  var deferredSearch = useDeferredValue(searchTerm);
  var shouldLoadDetail = useMemo(function() {
    return inventoryRowsNeedDetailFetch(fallbackRows, inventoryFileName);
  }, [fallbackRows, inventoryFileName]);

  useEffect(function() {
    if (inventoryDetailCache.key === detailCacheKey && Array.isArray(inventoryDetailCache.rows)) {
      setDetailRows(inventoryDetailCache.rows);
      setDetailStatus("ready");
      setDetailError("");
      return;
    }
    setDetailRows(null);
    setDetailStatus("idle");
    setDetailError("");
  }, [detailCacheKey]);

  useEffect(function() {
    if (!shouldLoadDetail) return;
    if (inventoryDetailCache.key === detailCacheKey && Array.isArray(inventoryDetailCache.rows)) return;
    var cancelled = false;
    setDetailStatus("loading");
    setDetailError("");
    fetch("/api/nulogy/inventory-rich")
      .then(function(response) {
        return response.json().then(function(body) {
          return { ok: response.ok, body: body };
        });
      })
      .then(function(result) {
        if (cancelled) return;
        if (!result.ok) {
          throw new Error((result.body && (result.body.error || result.body.details)) || "Could not load full inventory detail");
        }
        var nextRows = Array.isArray(result.body && result.body.data) ? result.body.data : [];
        inventoryDetailCache.key = detailCacheKey;
        inventoryDetailCache.rows = nextRows;
        setDetailRows(nextRows);
        setDetailStatus("ready");
      })
      .catch(function(error) {
        if (cancelled) return;
        setDetailStatus("error");
        setDetailError(error && error.message ? error.message : "Could not load full inventory detail");
      });
    return function() {
      cancelled = true;
    };
  }, [detailCacheKey, shouldLoadDetail]);

  var rows = Array.isArray(detailRows) && detailRows.length ? detailRows : fallbackRows;
  var usingDetailRows = Array.isArray(detailRows) && detailRows.length > 0;

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

  var rawRows = useMemo(function() {
    var out = [];
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
      var customer = String(pickMappedOrLoose(row, mapping.customer, ["Customer Name", "customer_name", "Customer", "customer"]) || "").trim();
      var baseUom = String(pickLooseValue(row, ["Base UOM", "base_unit_of_measure", "Base Unit Of Measure", "UOM"]) || "").trim();
      var source = String(pickLooseValue(row, ["Source", "source"]) || "").trim();
      var inventoryCategory = String(pickLooseValue(row, ["Inventory Category", "inventory_category"]) || "").trim();
      var itemCategory = String(pickLooseValue(row, ["Item Category", "item_category", "Item category name", "item_category_name"]) || "").trim();
      var itemClass = String(pickLooseValue(row, ["Item Class", "item_class"]) || "").trim();
      var itemFamily = String(pickLooseValue(row, ["Item Family", "item_family", "Item family name", "item_family_name"]) || "").trim();
      var siteName = String(pickLooseValue(row, ["Site Name", "site_name"]) || "").trim();
      var zone = String(pickLooseValue(row, ["Zone", "warehouse_zone"]) || "").trim();
      var storedSince = String(pickLooseValue(row, ["Stored Since", "stored_since"]) || "").trim();
      var bucketRows = statusBucketRows(row);
      var hasBucketedStatuses = bucketRows.length > 0;

      if (!sku && !description && !location && !lotCode && !expiryDate && !palletNumber && !(quantity || status || customer || hasBucketedStatuses)) return;

      var derivedRows = hasBucketedStatuses
        ? bucketRows
        : [{ status: status || "Unknown", qty: quantity }];

      derivedRows.forEach(function(derived, derivedIdx) {
        out.push({
          id: [sku || ("row-" + idx), location || "", lotCode || "", expiryDate || "", palletNumber || "", derived.status || "", customer || "", String(derivedIdx), String(idx)].join("|"),
          sku: sku || "--",
          description: formatDescriptionForDisplay(description) || "--",
          location: location || "",
          lotCode: lotCode || "",
          expiryDate: expiryDate || "",
          palletNumber: palletNumber || "",
          qtyOnHand: safeNum(derived.qty),
          status: derived.status || "Unknown",
          customer: customer || "--",
          baseUom: baseUom || "",
          source: source || "",
          inventoryCategory: inventoryCategory || "",
          itemCategory: itemCategory || "",
          itemClass: itemClass || "",
          itemFamily: itemFamily || "",
          siteName: siteName || "",
          zone: zone || "",
          storedSince: storedSince || "",
          daysToExpiry: expiryDate ? daysUntilInventoryDate(expiryDate) : null,
          sourceRows: 1,
          raw: row
        });
      });
    });
    return out;
  }, [rows, mapping, itemMasterDescriptionBySku]);

  var preparedRows = useMemo(function() {
    var grouped = {};
    rawRows.forEach(function(row) {
      var key = [row.sku || "--", row.location || "", row.lotCode || "", row.expiryDate || "", row.palletNumber || "", row.status || "", row.customer || "", row.baseUom || ""].join("|");
      if (!grouped[key]) {
        grouped[key] = Object.assign({}, row, { id: key, qtyOnHand: 0, sourceRows: 0 });
      }
      grouped[key].qtyOnHand += safeNum(row.qtyOnHand);
      grouped[key].sourceRows += 1;
      if (!grouped[key].source && row.source) grouped[key].source = row.source;
      if (grouped[key].source && row.source && grouped[key].source !== row.source) grouped[key].source = "mixed";
      if (!grouped[key].inventoryCategory && row.inventoryCategory) grouped[key].inventoryCategory = row.inventoryCategory;
      if (!grouped[key].itemCategory && row.itemCategory) grouped[key].itemCategory = row.itemCategory;
      if (!grouped[key].itemClass && row.itemClass) grouped[key].itemClass = row.itemClass;
      if (!grouped[key].itemFamily && row.itemFamily) grouped[key].itemFamily = row.itemFamily;
      if (!grouped[key].siteName && row.siteName) grouped[key].siteName = row.siteName;
      if (!grouped[key].zone && row.zone) grouped[key].zone = row.zone;
      if (!grouped[key].storedSince && row.storedSince) grouped[key].storedSince = row.storedSince;
    });
    return Object.values(grouped);
  }, [rawRows]);

  var locationOptions = useMemo(function() {
    return Array.from(new Set(rawRows.map(function(row) { return row.location; }).filter(Boolean))).sort(textCompare);
  }, [rawRows]);
  var statusOptions = useMemo(function() {
    return Array.from(new Set(rawRows.map(function(row) { return row.status; }).filter(Boolean))).sort(textCompare);
  }, [rawRows]);
  var customerOptions = useMemo(function() {
    return Array.from(new Set(rawRows.map(function(row) { return row.customer; }).filter(function(value) { return value && value !== "--"; }))).sort(textCompare);
  }, [rawRows]);
  var sourceOptions = useMemo(function() {
    return Array.from(new Set(rawRows.map(function(row) { return row.source; }).filter(Boolean))).sort(textCompare);
  }, [rawRows]);

  var filterState = {
    positiveOnly: positiveOnly,
    locationFilter: locationFilter,
    statusFilter: statusFilter,
    customerFilter: customerFilter,
    sourceFilter: sourceFilter,
    expiryFilter: expiryFilter
  };
  var searchLower = String(deferredSearch || "").trim().toLowerCase();

  var filteredRows = useMemo(function() {
    return preparedRows.filter(function(row) {
      return matchesInventoryFilters(row, searchLower, filterState);
    });
  }, [preparedRows, searchLower, positiveOnly, locationFilter, statusFilter, customerFilter, sourceFilter, expiryFilter]);
  var filteredRawRows = useMemo(function() {
    return rawRows.filter(function(row) {
      return matchesInventoryFilters(row, searchLower, filterState);
    });
  }, [rawRows, searchLower, positiveOnly, locationFilter, statusFilter, customerFilter, sourceFilter, expiryFilter]);

  var sortedRows = useMemo(function() {
    return sortInventoryRows(filteredRows, sortField, sortDir);
  }, [filteredRows, sortField, sortDir]);
  var sortedRawRows = useMemo(function() {
    return sortInventoryRows(filteredRawRows, sortField, sortDir);
  }, [filteredRawRows, sortField, sortDir]);
  var activeRows = viewMode === "raw" ? sortedRawRows : sortedRows;
  var pageCount = Math.max(1, Math.ceil(activeRows.length / pageSize));

  useEffect(function() {
    setPage(1);
  }, [viewMode, searchLower, positiveOnly, locationFilter, statusFilter, customerFilter, sourceFilter, expiryFilter, sortField, sortDir, pageSize]);

  useEffect(function() {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  var pagedRows = useMemo(function() {
    var start = Math.max(0, (page - 1) * pageSize);
    return activeRows.slice(start, start + pageSize);
  }, [activeRows, page, pageSize]);
  var visibleStart = activeRows.length ? ((page - 1) * pageSize) + 1 : 0;
  var visibleEnd = Math.min(activeRows.length, page * pageSize);

  var summary = useMemo(function() {
    var totalQty = activeRows.reduce(function(sum, row) { return sum + safeNum(row.qtyOnHand); }, 0);
    var uniqueLocations = new Set(activeRows.map(function(row) { return row.location; }).filter(Boolean)).size;
    var uniqueLots = new Set(activeRows.map(function(row) { return row.lotCode; }).filter(function(value) { return value && value !== "--"; })).size;
    var uniqueSkus = new Set(activeRows.map(function(row) { return row.sku; }).filter(function(value) { return value && value !== "--"; })).size;
    var expiringSoonRows = activeRows.filter(function(row) { return row.daysToExpiry != null && row.daysToExpiry >= 0 && row.daysToExpiry <= 30; });
    var expiredRows = activeRows.filter(function(row) { return row.daysToExpiry != null && row.daysToExpiry < 0; });
    return {
      totalQty: totalQty,
      uniqueLocations: uniqueLocations,
      uniqueLots: uniqueLots,
      uniqueSkus: uniqueSkus,
      expiringSoonQty: expiringSoonRows.reduce(function(sum, row) { return sum + safeNum(row.qtyOnHand); }, 0),
      expiringSoonLots: new Set(expiringSoonRows.map(function(row) { return row.lotCode; }).filter(Boolean)).size,
      expiredQty: expiredRows.reduce(function(sum, row) { return sum + safeNum(row.qtyOnHand); }, 0)
    };
  }, [activeRows]);

  var coverage = useMemo(function() {
    return {
      locationRows: rawRows.filter(function(row) { return !!String(row.location || "").trim(); }).length,
      lotRows: rawRows.filter(function(row) { return !!String(row.lotCode || "").trim(); }).length,
      expiryRows: rawRows.filter(function(row) { return !!String(row.expiryDate || "").trim(); }).length,
      palletRows: rawRows.filter(function(row) { return !!String(row.palletNumber || "").trim(); }).length,
      customerRows: rawRows.filter(function(row) { return !!String(row.customer || "").trim() && row.customer !== "--"; }).length
    };
  }, [rawRows]);

  var summaryCards = useMemo(function() {
    return [
      {
        key: "visible_qty",
        label: "Visible Qty",
        value: Math.round(summary.totalQty).toLocaleString(),
        note: activeRows.length.toLocaleString() + " rows visible"
      },
      {
        key: "locations",
        label: "Locations",
        value: summary.uniqueLocations.toLocaleString(),
        note: "Filtered location count"
      },
      {
        key: "lot_codes",
        label: "Lot Codes",
        value: summary.uniqueLots.toLocaleString(),
        note: "Distinct lots in view"
      },
      {
        key: "expiring_soon",
        label: "Expiring <=30d",
        value: Math.round(summary.expiringSoonQty).toLocaleString(),
        note: summary.expiringSoonLots.toLocaleString() + " lots · " + Math.round(summary.expiredQty).toLocaleString() + " expired qty"
      },
      {
        key: "skus",
        label: "SKUs",
        value: summary.uniqueSkus.toLocaleString(),
        note: "Distinct items in view"
      }
    ];
  }, [summary, activeRows.length]);

  var hasLocationColumn = useMemo(function() {
    return rawRows.some(function(row) { return !!String(row.location || "").trim(); });
  }, [rawRows]);
  var hasLotColumn = useMemo(function() {
    return rawRows.some(function(row) { return !!String(row.lotCode || "").trim(); });
  }, [rawRows]);
  var hasExpiryColumn = useMemo(function() {
    return rawRows.some(function(row) { return !!String(row.expiryDate || "").trim(); });
  }, [rawRows]);
  var hasPalletColumn = useMemo(function() {
    return rawRows.some(function(row) { return !!String(row.palletNumber || "").trim(); });
  }, [rawRows]);
  var hasCustomerColumn = useMemo(function() {
    return rawRows.some(function(row) { return !!String(row.customer || "").trim() && row.customer !== "--"; });
  }, [rawRows]);
  var hasItemCategoryColumn = useMemo(function() {
    return rawRows.some(function(row) { return !!String(row.itemCategory || "").trim(); });
  }, [rawRows]);
  var hasSiteColumn = useMemo(function() {
    return rawRows.some(function(row) { return !!String(row.siteName || "").trim(); });
  }, [rawRows]);
  var hasZoneColumn = useMemo(function() {
    return rawRows.some(function(row) { return !!String(row.zone || "").trim(); });
  }, [rawRows]);
  var hasSourceColumn = useMemo(function() {
    return rawRows.some(function(row) { return !!String(row.source || "").trim(); });
  }, [rawRows]);
  var legacyLikeData = useMemo(function() {
    if (!rows.length) return false;
    var sourceRows = rows.filter(function(row) { return !!String(pickLooseValue(row, ["Source", "source"]) || "").trim(); }).length;
    if (sourceRows > 0) return false;
    var detailRows = rows.filter(function(row) {
      return !!String(pickLooseValue(row, ["Location", "location", "Lot Code", "lot_code", "Expiry Date", "expiry_date"]) || "").trim();
    }).length;
    return detailRows < Math.max(10, Math.round(rows.length * 0.15));
  }, [rows]);

  var handleSort = function(field) {
    if (sortField === field) setSortDir(function(prev) { return prev === "asc" ? "desc" : "asc"; });
    else {
      setSortField(field);
      setSortDir(field === "qtyOnHand" ? "desc" : "asc");
    }
  };

  var exportGroupedCsv = function() {
    var headers = ["sku", "description", "location", "lot_code", "expiry_date", "days_to_expiry", "pallet_number", "qty_on_hand", "base_uom", "status", "customer", "source"];
    var lines = [headers.join(",")];
    sortedRows.forEach(function(row) {
      lines.push([
        csvCell(row.sku),
        csvCell(row.description),
        csvCell(row.location),
        csvCell(row.lotCode),
        csvCell(row.expiryDate || ""),
        csvCell(row.daysToExpiry == null ? "" : String(row.daysToExpiry)),
        csvCell(row.palletNumber),
        csvCell(String(Math.round((row.qtyOnHand || 0) * 100) / 100)),
        csvCell(row.baseUom || ""),
        csvCell(row.status),
        csvCell(row.customer),
        csvCell(row.source || "")
      ].join(","));
    });
    var stamp = new Date().toISOString().slice(0, 10);
    triggerDownload(lines.join("\n"), "inventory_lookup_" + stamp + ".csv", "text/csv");
  };

  var exportAllFieldsCsv = function() {
    var rawObjects = filteredRawRows.map(function(row) {
      return row.raw && typeof row.raw === "object" ? row.raw : {};
    });
    if (!rawObjects.length) return;
    var headers = [];
    rawObjects.forEach(function(row) {
      Object.keys(row || {}).forEach(function(key) {
        if (headers.indexOf(key) === -1) headers.push(key);
      });
    });
    var lines = [headers.map(csvCell).join(",")];
    rawObjects.forEach(function(row) {
      lines.push(headers.map(function(key) { return csvCell(row[key]); }).join(","));
    });
    var stamp = new Date().toISOString().slice(0, 10);
    triggerDownload(lines.join("\n"), "inventory_lookup_all_fields_" + stamp + ".csv", "text/csv");
  };

  var exportCsv = function() {
    if (viewMode === "raw") {
      exportAllFieldsCsv();
      return;
    }
    exportGroupedCsv();
  };

  var resetFilters = function() {
    setSearchTerm("");
    setLocationFilter("all");
    setStatusFilter("all");
    setCustomerFilter("all");
    setExpiryFilter("all");
    setSourceFilter("all");
    setPositiveOnly(true);
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold tracking-[-0.02em] text-[rgb(var(--foreground))]">Inventory Lookup</h2>
        <p className="mt-1 text-sm text-[rgb(var(--muted))]">Search inventory by SKU, customer, location, lot code, expiry date, pallet, and report source.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="text"
          placeholder="Search SKU / description / customer / lot / pallet"
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
        {hasCustomerColumn ? (
          <select
            value={customerFilter}
            onChange={function(event) { setCustomerFilter(event.target.value); }}
            style={Object.assign({}, styles.sel, { height: 40, minWidth: 190 })}
          >
            <option value="all">All Customers</option>
            {customerOptions.map(function(option) {
              return <option key={option} value={option}>{option}</option>;
            })}
          </select>
        ) : null}
        <select
          value={expiryFilter}
          onChange={function(event) { setExpiryFilter(event.target.value); }}
          style={Object.assign({}, styles.sel, { height: 40, minWidth: 170 })}
        >
          <option value="all">All Expiry</option>
          <option value="expired">Expired</option>
          <option value="0_30">0-30 Days</option>
          <option value="31_60">31-60 Days</option>
          <option value="61_90">61-90 Days</option>
          <option value="90_plus">90+ Days</option>
          <option value="missing">No Expiry</option>
        </select>
        {sourceOptions.length ? (
          <select
            value={sourceFilter}
            onChange={function(event) { setSourceFilter(event.target.value); }}
            style={Object.assign({}, styles.sel, { height: 40, minWidth: 180 })}
          >
            <option value="all">All Sources</option>
            {sourceOptions.map(function(option) {
              return <option key={option} value={option}>{option}</option>;
            })}
          </select>
        ) : null}
        <Button variant={viewMode === "grouped" ? "active" : "outline"} size="default" onClick={function() { setViewMode("grouped"); }}>
          Grouped
        </Button>
        <Button variant={viewMode === "raw" ? "active" : "outline"} size="default" onClick={function() { setViewMode("raw"); }}>
          Raw Rows
        </Button>
        <Button variant={positiveOnly ? "active" : "outline"} size="default" onClick={function() { setPositiveOnly(function(prev) { return !prev; }); }}>
          Positive Qty
        </Button>
        <Button variant="outline" size="default" onClick={resetFilters}>Clear</Button>
        <Button variant="outline" size="default" onClick={exportCsv} disabled={!activeRows.length}>{viewMode === "raw" ? "CSV (All Fields)" : "CSV"}</Button>
        <Button variant="outline" size="default" onClick={exportAllFieldsCsv} disabled={!filteredRawRows.length}>Raw CSV</Button>
      </div>

      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-5">
        {summaryCards.map(function(card) {
          return (
            <Card key={card.key} className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-3 py-2.5">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[rgb(var(--muted))]">{card.label}</div>
              <div className="mt-1.5 text-[2rem] font-bold leading-none [font-variant-numeric:tabular-nums] text-[rgb(var(--foreground))]" style={{ fontFamily: mono }}>
                {card.value}
              </div>
              <div className="mt-1 text-[11px] leading-tight text-[rgb(var(--muted))]">{card.note}</div>
            </Card>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm text-[rgb(var(--muted))]">
        <Badge variant="secondary">{preparedRows.length.toLocaleString()} grouped rows</Badge>
        <Badge variant="secondary">{rawRows.length.toLocaleString()} raw rows</Badge>
        <Badge variant="secondary">{locationOptions.length.toLocaleString()} locations</Badge>
        <Badge variant="secondary">{statusOptions.length.toLocaleString()} statuses</Badge>
        {customerOptions.length ? <Badge variant="secondary">{customerOptions.length.toLocaleString()} customers</Badge> : null}
        {sourceOptions.length ? <Badge variant="secondary">{sourceOptions.length.toLocaleString()} sources</Badge> : null}
        {shouldLoadDetail ? (
          <Badge variant={usingDetailRows ? "success" : detailStatus === "loading" ? "secondary" : detailStatus === "error" ? "warning" : "secondary"}>
            {usingDetailRows ? "Full detail loaded" : detailStatus === "loading" ? "Loading full detail..." : detailStatus === "error" ? "Showing compact inventory" : "Compact inventory"}
          </Badge>
        ) : null}
      </div>

      {detailStatus === "error" ? (
        <div className="rounded-md border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-3 py-2 text-sm text-[rgb(var(--muted))]">
          Full inventory detail could not be loaded, so this view is using the compact inventory snapshot. {detailError}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 text-sm text-[rgb(var(--muted))]">
        <Badge variant="secondary">Location coverage {coveragePct(coverage.locationRows, rawRows.length)}%</Badge>
        <Badge variant="secondary">Lot coverage {coveragePct(coverage.lotRows, rawRows.length)}%</Badge>
        <Badge variant="secondary">Expiry coverage {coveragePct(coverage.expiryRows, rawRows.length)}%</Badge>
        <Badge variant="secondary">Pallet coverage {coveragePct(coverage.palletRows, rawRows.length)}%</Badge>
        {hasCustomerColumn ? <Badge variant="secondary">Customer coverage {coveragePct(coverage.customerRows, rawRows.length)}%</Badge> : null}
      </div>

      {legacyLikeData ? (
        <div className="rounded-md border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-3 py-2 text-sm text-[rgb(var(--muted))]">
          Current inventory dataset looks like a legacy cached export without enriched Nulogy detail fields. A fresh full Nulogy sync should replace it with the report-backed inventory rows.
        </div>
      ) : null}

      {(!hasLocationColumn || !hasPalletColumn) ? (
        <div className="rounded-md border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-3 py-2 text-sm text-[rgb(var(--muted))]">
          Inventory source includes
          {hasLotColumn ? " lot codes" : ""}
          {hasLotColumn && hasExpiryColumn ? " and" : ""}
          {hasExpiryColumn ? " expiry dates" : ""}
          {!hasLotColumn && !hasExpiryColumn ? " quantity/status rows" : ""}
          , but it does not include
          {!hasLocationColumn && !hasPalletColumn ? " location or pallet data" : (!hasLocationColumn ? " location data" : " pallet data")}
          . Full location lookup depends on the report-backed inventory enrichment succeeding.
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-[rgb(var(--muted))]">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">
            Showing {visibleStart.toLocaleString()}-{visibleEnd.toLocaleString()} of {activeRows.length.toLocaleString()}
          </Badge>
          <select
            value={String(pageSize)}
            onChange={function(event) { setPageSize(Number(event.target.value) || 100); }}
            style={Object.assign({}, styles.sel, { height: 36, minWidth: 120 })}
          >
            <option value="100">100 / page</option>
            <option value="250">250 / page</option>
            <option value="500">500 / page</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={function() { setPage(function(prev) { return Math.max(1, prev - 1); }); }} disabled={page <= 1}>
            Prev
          </Button>
          <Badge variant="secondary">Page {page.toLocaleString()} / {pageCount.toLocaleString()}</Badge>
          <Button variant="outline" size="sm" onClick={function() { setPage(function(prev) { return Math.min(pageCount, prev + 1); }); }} disabled={page >= pageCount}>
            Next
          </Button>
        </div>
      </div>

      <TableShell>
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr>
                <th style={thC(sortField === "sku")}><SortHeaderButton onClick={function() { handleSort("sku"); }}>SKU</SortHeaderButton></th>
                <th style={thC(sortField === "description")}><SortHeaderButton onClick={function() { handleSort("description"); }}>Description</SortHeaderButton></th>
                {hasCustomerColumn ? <th style={thC(sortField === "customer")}><SortHeaderButton onClick={function() { handleSort("customer"); }}>Customer</SortHeaderButton></th> : null}
                {viewMode === "raw" && hasItemCategoryColumn ? <th style={thC(sortField === "itemCategory")}><SortHeaderButton onClick={function() { handleSort("itemCategory"); }}>Item Category</SortHeaderButton></th> : null}
                {hasLocationColumn ? <th style={thC(sortField === "location")}><SortHeaderButton onClick={function() { handleSort("location"); }}>Location</SortHeaderButton></th> : null}
                {hasLotColumn ? <th style={thC(sortField === "lotCode")}><SortHeaderButton onClick={function() { handleSort("lotCode"); }}>Lot Code</SortHeaderButton></th> : null}
                {hasExpiryColumn ? <th style={thC(sortField === "daysToExpiry")}><SortHeaderButton onClick={function() { handleSort("daysToExpiry"); }}>Expiry</SortHeaderButton></th> : null}
                {hasPalletColumn ? <th style={thC(sortField === "palletNumber")}><SortHeaderButton onClick={function() { handleSort("palletNumber"); }}>Pallet</SortHeaderButton></th> : null}
                {viewMode === "raw" && hasSiteColumn ? <th style={thC(sortField === "siteName")}><SortHeaderButton onClick={function() { handleSort("siteName"); }}>Site</SortHeaderButton></th> : null}
                {viewMode === "raw" && hasZoneColumn ? <th style={thC(sortField === "zone")}><SortHeaderButton onClick={function() { handleSort("zone"); }}>Zone</SortHeaderButton></th> : null}
                <th style={thC(sortField === "qtyOnHand")}><SortHeaderButton onClick={function() { handleSort("qtyOnHand"); }}>Qty On Hand</SortHeaderButton></th>
                <th style={thC(sortField === "status")}><SortHeaderButton onClick={function() { handleSort("status"); }}>Status</SortHeaderButton></th>
                {viewMode === "raw" && hasSourceColumn ? <th style={thC(sortField === "source")}><SortHeaderButton onClick={function() { handleSort("source"); }}>Source</SortHeaderButton></th> : null}
              </tr>
            </thead>
            <tbody>
              {activeRows.length ? pagedRows.map(function(row) {
                return (
                  <tr key={row.id} className="border-b border-[rgb(var(--border))] last:border-b-0">
                    <td style={Object.assign({}, tdN, { fontWeight: 700 })}>{row.sku}</td>
                    <td style={Object.assign({}, tdN, truncate(320))} title={row.description}>{row.description}</td>
                    {hasCustomerColumn ? <td style={Object.assign({}, tdN, truncate(220))} title={row.customer}>{row.customer || "--"}</td> : null}
                    {viewMode === "raw" && hasItemCategoryColumn ? <td style={Object.assign({}, tdN, truncate(180))} title={row.itemCategory}>{row.itemCategory || "--"}</td> : null}
                    {hasLocationColumn ? <td style={Object.assign({}, tdN, { fontFamily: mono })}>{row.location || "--"}</td> : null}
                    {hasLotColumn ? <td style={Object.assign({}, tdN, { fontFamily: mono })}>{row.lotCode || "--"}</td> : null}
                    {hasExpiryColumn ? (
                      <td style={Object.assign({}, tdN, { fontFamily: mono })}>
                        <div>{row.expiryDate || "--"}</div>
                        {row.daysToExpiry != null ? (
                          <div style={{ color: row.daysToExpiry < 0 ? C.bad : row.daysToExpiry <= 30 ? C.warn : C.dim, fontFamily: "inherit", fontSize: 12 }}>
                            {formatDaysToExpiry(row.daysToExpiry)}
                          </div>
                        ) : null}
                      </td>
                    ) : null}
                    {hasPalletColumn ? <td style={Object.assign({}, tdN, { fontFamily: mono })}>{row.palletNumber || "--"}</td> : null}
                    {viewMode === "raw" && hasSiteColumn ? <td style={Object.assign({}, tdN, truncate(140))}>{row.siteName || "--"}</td> : null}
                    {viewMode === "raw" && hasZoneColumn ? <td style={Object.assign({}, tdN, truncate(120))}>{row.zone || "--"}</td> : null}
                    <td style={Object.assign({}, tdM, { fontWeight: 700, color: C.ok })}>
                      {Math.round((row.qtyOnHand || 0) * 100) / 100}
                      {row.baseUom ? <span style={{ marginLeft: 6, color: C.dim, fontWeight: 500 }}>{row.baseUom}</span> : null}
                    </td>
                    <td style={tdN}><Badge variant={statusVariant(row.status)}>{row.status}</Badge></td>
                    {viewMode === "raw" && hasSourceColumn ? <td style={Object.assign({}, tdN, truncate(180))}>{row.source || "--"}</td> : null}
                  </tr>
                );
              }) : (
                <tr>
                  <td colSpan={2 + (hasCustomerColumn ? 1 : 0) + (viewMode === "raw" && hasItemCategoryColumn ? 1 : 0) + (hasLocationColumn ? 1 : 0) + (hasLotColumn ? 1 : 0) + (hasExpiryColumn ? 1 : 0) + (hasPalletColumn ? 1 : 0) + (viewMode === "raw" && hasSiteColumn ? 1 : 0) + (viewMode === "raw" && hasZoneColumn ? 1 : 0) + 2 + (viewMode === "raw" && hasSourceColumn ? 1 : 0)} style={Object.assign({}, tdN, { padding: "28px 16px", textAlign: "center", color: C.dim })}>
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
