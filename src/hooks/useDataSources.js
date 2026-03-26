import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { safeNum, normalizeStr, autoMapColumns, INV_PAT, BOM_PAT, WO_PAT, PO_PAT } from "../utils";
import { parseCsvText, readFileAsText, readWorkbook } from "../utils/fileParsers";

const STORAGE_KEYS = {
  inventory: "inv-data",
  workOrders: "wo-data",
  itemMaster: "itemmaster-data",
  boms: "bom-data",
  production: "production-data",
  labor: "labor-data",
  evocon: "evocon-data",
  edr: "edr-data",
  dock: "dock-data",
  mappingConfirmed: "mapping-confirmed",
};

function areMappingsEqual(a, b) {
  var ka = Object.keys(a || {});
  var kb = Object.keys(b || {});
  if (ka.length !== kb.length) return false;
  for (var i = 0; i < ka.length; i++) {
    var k = ka[i];
    if ((a || {})[k] !== (b || {})[k]) return false;
  }
  return true;
}

function pickLooseInventoryValue(row, keys) {
  if (!row || typeof row !== "object") return "";
  var rowKeys = Object.keys(row);
  for (var i = 0; i < keys.length; i++) {
    var target = normalizeStr(keys[i]);
    for (var j = 0; j < rowKeys.length; j++) {
      var rowKey = rowKeys[j];
      if (normalizeStr(rowKey) === target) return row[rowKey];
    }
  }
  return "";
}

function shouldCompactInventoryForApp(rows, fileName) {
  if (!Array.isArray(rows) || !rows.length) return false;
  var name = String(fileName || "").toLowerCase();
  if (name.includes("nulogy")) return true;
  var sourceMarkers = 0;
  var sampleSize = Math.min(rows.length, 40);
  for (var i = 0; i < sampleSize; i++) {
    var row = rows[i] || {};
    var source = String(pickLooseInventoryValue(row, ["Source", "source"]) || "").toLowerCase();
    if (source && (source.includes("inventory") || source.includes("locator") || source.includes("compact") || source.includes("nulogy"))) {
      sourceMarkers += 1;
    }
  }
  return sourceMarkers > 0;
}

function compactInventoryRowsForApp(rows) {
  var grouped = {};
  (Array.isArray(rows) ? rows : []).forEach(function(row) {
    var sku = String(pickLooseInventoryValue(row, ["Item Code", "item_code", "SKU", "sku", "Item", "item"]) || "").trim();
    var description = String(pickLooseInventoryValue(row, ["Description", "description", "Item Description", "item_description"]) || "").trim();
    var qty = safeNum(pickLooseInventoryValue(row, ["Qty On Hand", "qty_on_hand", "Base quantity", "base_quantity", "Quantity", "quantity", "Available", "available"]));
    var status = String(pickLooseInventoryValue(row, ["Inventory Status", "inventory_status", "Status", "status"]) || "").trim();
    var customer = String(pickLooseInventoryValue(row, ["Customer Name", "customer_name", "Customer", "customer"]) || "").trim();
    var baseUom = String(pickLooseInventoryValue(row, ["Base UOM", "base_uom", "Base unit of measure", "base_unit_of_measure", "UOM", "uom"]) || "").trim();
    var source = String(pickLooseInventoryValue(row, ["Source", "source"]) || "").trim();
    if (!sku && !description && !(qty > 0) && !status && !customer) return;
    var key = [
      normalizeStr(sku),
      normalizeStr(status),
      normalizeStr(customer),
      normalizeStr(baseUom)
    ].join("|");
    if (!grouped[key]) {
      grouped[key] = {
        "Item Code": sku || "--",
        "Description": description || "--",
        "Qty On Hand": 0,
        "Inventory Status": status || "",
        "Customer Name": customer || "",
        "Base UOM": baseUom || "",
        "Source": source || "compact_inventory"
      };
    }
    grouped[key]["Qty On Hand"] += qty;
    if ((!grouped[key]["Description"] || grouped[key]["Description"] === "--") && description) {
      grouped[key]["Description"] = description;
    }
    if (!grouped[key]["Source"] && source) grouped[key]["Source"] = source;
    if (grouped[key]["Source"] && source && grouped[key]["Source"] !== source) {
      grouped[key]["Source"] = "report_compact_inventory";
    }
  });
  return Object.values(grouped);
}

export function useDataSources() {
  const [inventory, setInventory] = useState(null);
  const [itemMaster, setItemMaster] = useState(null);
  const [boms, setBoms] = useState(null);
  const [workOrders, setWorkOrders] = useState(null);
  const [productionData, setProductionData] = useState(null);
  const [laborData, setLaborData] = useState(null);
  const [evoconData, setEvoconData] = useState(null);
  const [invFileName, setInvFileName] = useState("");
  const [itemMasterFileName, setItemMasterFileName] = useState("");
  const [bomFileName, setBomFileName] = useState("");
  const [woFileName, setWoFileName] = useState("");
  const [productionFileName, setProductionFileName] = useState("");
  const [laborFileName, setLaborFileName] = useState("");
  const [evoconFileName, setEvoconFileName] = useState("");
  const [invTimestamp, setInvTimestamp] = useState(null);
  const [itemMasterTimestamp, setItemMasterTimestamp] = useState(null);
  const [bomTimestamp, setBomTimestamp] = useState(null);
  const [woTimestamp, setWoTimestamp] = useState(null);
  const [productionTimestamp, setProductionTimestamp] = useState(null);
  const [laborTimestamp, setLaborTimestamp] = useState(null);
  const [evoconTimestamp, setEvoconTimestamp] = useState(null);
  const [edrData, setEdrData] = useState(null);
  const [edrFileName, setEdrFileName] = useState("");
  const [edrTimestamp, setEdrTimestamp] = useState(null);
  const [dockData, setDockData] = useState(null);
  const [dockFileName, setDockFileName] = useState("");
  const [dockTimestamp, setDockTimestamp] = useState(null);
  const [poData, setPoData] = useState(null);
  const [poFileName, setPoFileName] = useState("");
  const [poTimestamp, setPoTimestamp] = useState(null);
  const [poHeaders, setPoHeaders] = useState([]);
  const [poMapping, setPoMapping] = useState({});
  const [invMapping, setInvMapping] = useState({});
  const [bomMapping, setBomMapping] = useState({});
  const [woMapping, setWoMapping] = useState({});
  const [mappingConfirmed, setMappingConfirmed] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [cacheHydrated, setCacheHydrated] = useState(false);
  const [sharedSnapshotMeta, setSharedSnapshotMeta] = useState({ source: "unknown", syncedAt: null, updatedBy: "" });
  const [sharedSnapshotWrite, setSharedSnapshotWrite] = useState({
    status: "idle", // idle | writing | ok | error
    attemptedAt: null,
    succeededAt: null,
    error: "",
    snapshotVersion: "",
    productionWriteMode: "",
    laborWriteMode: "",
    productionCorrectionStart: "",
    laborCorrectionStart: ""
  });
  const hydrateDoneRef = useRef(false);

  const invRefreshRef = useCallback(n => { if (n) window.__invR = n; }, []);
  const bomRefreshRef = useCallback(n => { if (n) window.__bomR = n; }, []);
  const woRefreshRef = useCallback(n => { if (n) window.__woR = n; }, []);
  const edrRefreshRef = useCallback(n => { if (n) window.__edrR = n; }, []);
  const dockRefreshRef = useCallback(n => { if (n) window.__dockR = n; }, []);

  const readStoredDataSet = useCallback(function(storedValue) {
    if (!storedValue) return null;
    var parsed = null;
    try {
      parsed = JSON.parse(storedValue);
    } catch (e) {
      return null;
    }
    if (!parsed || !Array.isArray(parsed.data)) return null;
    if (!parsed.data.length && !parsed.timestamp) return null;
    var ts = parsed.timestamp ? new Date(parsed.timestamp) : null;
    if (ts && isNaN(ts)) ts = null;
    return {
      data: parsed.data || [],
      fileName: parsed.fileName || "",
      timestamp: ts
    };
  }, []);

  const normalizeInventoryForApp = useCallback(function(rows, fileName) {
    if (!shouldCompactInventoryForApp(rows, fileName)) return Array.isArray(rows) ? rows : [];
    return compactInventoryRowsForApp(rows);
  }, []);

  const hydrateDataSet = useCallback(function(storedValue, setData, setFileName, setTimestamp, fallbackName, options) {
    var cached = readStoredDataSet(storedValue);
    if (!cached) return false;
    var nextFileName = cached.fileName || fallbackName || "Saved Data";
    var nextRows = cached.data;
    if (options && typeof options.transformRows === "function") {
      nextRows = options.transformRows(cached.data, nextFileName);
    }
    setData(nextRows);
    setFileName(nextFileName);
    setTimestamp(cached.timestamp || new Date());
    return true;
  }, [readStoredDataSet]);

  const persistDataSet = useCallback(async function(key, data, fileName, timestamp) {
    if (data == null) return;
    if (!Array.isArray(data)) return;
    try {
      var res = await window.storage.set(key, JSON.stringify({
        data: data,
        fileName: fileName || "Saved Data",
        timestamp: timestamp ? timestamp.toISOString() : new Date().toISOString()
      }));
      if (!res) {
        console.warn("[PackPulse] Cache write skipped (storage unavailable or quota exceeded):", key);
      }
    } catch (e) {
      console.warn("[PackPulse] Cache write failed:", key, e && e.message ? e.message : e);
    }
  }, []);

  const hydrateFromPayloadObject = useCallback(function(payload, labelSuffix) {
    if (!payload || typeof payload !== "object") return false;
    var meta = payload.meta && typeof payload.meta === "object" ? payload.meta : {};
    var hasAny = false;

    function applyData(dataKey, setData, setName, setTs, defaultLabel) {
      var rows = payload[dataKey];
      var tsVal = meta[dataKey + "Timestamp"] ? new Date(meta[dataKey + "Timestamp"]) : null;
      if (!Array.isArray(rows)) return;
      if (!rows.length && !tsVal) return;
      hasAny = hasAny || rows.length > 0;
      var fileName = meta[dataKey + "FileName"] || defaultLabel + (labelSuffix ? " (" + labelSuffix + ")" : "");
      var nextRows = dataKey === "inventory" ? normalizeInventoryForApp(rows, fileName) : rows;
      setData(nextRows);
      setName(fileName);
      setTs(tsVal || new Date());
    }

    applyData("inventory", setInventory, setInvFileName, setInvTimestamp, "Nulogy Sync");
    applyData("workOrders", setWorkOrders, setWoFileName, setWoTimestamp, "Nulogy Sync");
    applyData("productionData", setProductionData, setProductionFileName, setProductionTimestamp, "Nulogy Production");
    applyData("laborData", setLaborData, setLaborFileName, setLaborTimestamp, "Nulogy Labor");
    applyData("evoconData", setEvoconData, setEvoconFileName, setEvoconTimestamp, "Evocon Reports");
    applyData("itemMaster", setItemMaster, setItemMasterFileName, setItemMasterTimestamp, "Nulogy Sync");
    applyData("boms", setBoms, setBomFileName, setBomTimestamp, "Nulogy Sync");
    applyData("edrData", setEdrData, setEdrFileName, setEdrTimestamp, "EDR");
    applyData("dockData", setDockData, setDockFileName, setDockTimestamp, "OpenDock API");

    if (typeof meta.mappingConfirmed === "boolean") {
      setMappingConfirmed(meta.mappingConfirmed);
    }
    return hasAny;
  }, [normalizeInventoryForApp]);

  // Load shared snapshot first, then local fallback.
  useEffect(() => {
    (async () => {
      try {
        var sharedLoaded = false;
        var sharedProductionTruncated = false;
        var sharedPayload = {};
        var sharedMeta = {};
        var sharedRowCounts = {};
        var sharedDroppedDatasets = [];
        try {
          var sharedRes = await fetch("/api/cache/snapshot", { credentials: "include" });
          if (sharedRes.ok) {
            var sharedBody = await sharedRes.json();
            if (sharedBody && sharedBody.snapshot && sharedBody.snapshot.payload) {
              sharedRowCounts = sharedBody.snapshot.row_counts || {};
              sharedPayload = sharedBody.snapshot.payload || {};
              sharedMeta = sharedPayload.meta && typeof sharedPayload.meta === "object" ? sharedPayload.meta : {};
              var sharedProdRows = Array.isArray(sharedPayload.productionData) ? sharedPayload.productionData.length : 0;
              var sharedProdCount = Number(sharedRowCounts.productionData || 0);
              var sharedLaborRows = Array.isArray(sharedPayload.laborData) ? sharedPayload.laborData.length : 0;
              var sharedLaborCount = Number(sharedRowCounts.laborData || 0);
              sharedDroppedDatasets = Array.isArray(sharedMeta.cacheDroppedDatasets)
                ? sharedMeta.cacheDroppedDatasets
                : [];
              sharedProductionTruncated = sharedDroppedDatasets.indexOf("productionData") !== -1 || (sharedProdCount > 0 && sharedProdRows > 0 && sharedProdRows < sharedProdCount);
              var sharedLaborTruncated = sharedDroppedDatasets.indexOf("laborData") !== -1 || (sharedLaborCount > 0 && sharedLaborRows > 0 && sharedLaborRows < sharedLaborCount);
              sharedLoaded = hydrateFromPayloadObject(sharedBody.snapshot.payload, "shared");
              setSharedSnapshotMeta({
                source: "shared",
                syncedAt: sharedBody.snapshot.synced_at ? new Date(sharedBody.snapshot.synced_at) : null,
                updatedBy: sharedBody.snapshot.updated_by || ""
              });
            } else {
              setSharedSnapshotMeta({ source: "empty", syncedAt: null, updatedBy: "" });
            }
          } else {
            setSharedSnapshotMeta({ source: "unavailable", syncedAt: null, updatedBy: "" });
          }
        } catch (eShared) {
          // Ignore shared fetch issues and fallback to local cache.
          setSharedSnapshotMeta({ source: "error", syncedAt: null, updatedBy: "" });
        }

        var keys = [
          STORAGE_KEYS.inventory,
          STORAGE_KEYS.workOrders,
          STORAGE_KEYS.production,
          STORAGE_KEYS.labor,
          STORAGE_KEYS.evocon,
          STORAGE_KEYS.itemMaster,
          STORAGE_KEYS.boms,
          STORAGE_KEYS.edr,
          STORAGE_KEYS.dock,
          STORAGE_KEYS.mappingConfirmed
        ];
        var results = await Promise.all(keys.map(function(k) { return window.storage.get(k); }));
        var map = {};
        keys.forEach(function(k, i) { map[k] = results[i] && results[i].value ? results[i].value : null; });

        function preferFresherLocalData(storageKey, dataKey, setData, setName, setTs, fallbackLabel) {
          var cached = readStoredDataSet(map[storageKey]);
          if (!cached) return false;
          var sharedRows = Array.isArray(sharedPayload[dataKey]) ? sharedPayload[dataKey].length : 0;
          var sharedCount = Number(sharedRowCounts[dataKey] || 0);
          var sharedTsRaw = sharedMeta[dataKey + "Timestamp"];
          var sharedTs = sharedTsRaw ? new Date(sharedTsRaw) : null;
          if (sharedTs && isNaN(sharedTs)) sharedTs = null;
          var localTsMs = cached.timestamp ? cached.timestamp.getTime() : 0;
          var sharedTsMs = sharedTs ? sharedTs.getTime() : 0;
          var sharedTruncated = sharedDroppedDatasets.indexOf(dataKey) !== -1 || (sharedCount > 0 && sharedRows < sharedCount);
          var preferLocal = false;
          if (sharedTruncated && cached.data.length) {
            preferLocal = true;
          } else if (localTsMs && localTsMs > sharedTsMs) {
            preferLocal = true;
          }
          if (!preferLocal) return false;
          var nextFileName = cached.fileName || fallbackLabel || "Saved Data";
          var nextRows = dataKey === "inventory" ? normalizeInventoryForApp(cached.data, nextFileName) : cached.data;
          setData(nextRows);
          setName(nextFileName);
          setTs(cached.timestamp || new Date());
          return true;
        }

        if (!sharedLoaded) {
          hydrateDataSet(map[STORAGE_KEYS.inventory], setInventory, setInvFileName, setInvTimestamp, "Nulogy Sync (cached)", {
            transformRows: normalizeInventoryForApp
          });
          hydrateDataSet(map[STORAGE_KEYS.workOrders], setWorkOrders, setWoFileName, setWoTimestamp, "Nulogy Sync (cached)");
          hydrateDataSet(map[STORAGE_KEYS.production], setProductionData, setProductionFileName, setProductionTimestamp, "Nulogy Production (cached)");
          hydrateDataSet(map[STORAGE_KEYS.labor], setLaborData, setLaborFileName, setLaborTimestamp, "Nulogy Labor (cached)");
          hydrateDataSet(map[STORAGE_KEYS.evocon], setEvoconData, setEvoconFileName, setEvoconTimestamp, "Evocon Reports (cached)");
          hydrateDataSet(map[STORAGE_KEYS.itemMaster], setItemMaster, setItemMasterFileName, setItemMasterTimestamp, "Nulogy Sync (cached)");
          hydrateDataSet(map[STORAGE_KEYS.boms], setBoms, setBomFileName, setBomTimestamp, "Nulogy Sync (cached)");
          hydrateDataSet(map[STORAGE_KEYS.edr], setEdrData, setEdrFileName, setEdrTimestamp, "EDR (cached)");
          hydrateDataSet(map[STORAGE_KEYS.dock], setDockData, setDockFileName, setDockTimestamp, "OpenDock API (cached)");
          setSharedSnapshotMeta(function(prev) {
            if (prev.source === "shared") return prev;
            return { source: "local", syncedAt: null, updatedBy: "" };
          });
        }

        // Shared snapshots may intentionally compact production data for payload size.
        // If local storage still has a fuller production export, prefer that for client-side
        // fallbacks and the next server snapshot repair.
        if (sharedLoaded && sharedProductionTruncated) {
          hydrateDataSet(map[STORAGE_KEYS.production], setProductionData, setProductionFileName, setProductionTimestamp, "Nulogy Production (cached)");
        }
        if (sharedLoaded && sharedLaborTruncated) {
          hydrateDataSet(map[STORAGE_KEYS.labor], setLaborData, setLaborFileName, setLaborTimestamp, "Nulogy Labor (cached)");
        }
        if (sharedLoaded) {
          preferFresherLocalData(STORAGE_KEYS.edr, "edrData", setEdrData, setEdrFileName, setEdrTimestamp, "EDR (cached)");
          preferFresherLocalData(STORAGE_KEYS.dock, "dockData", setDockData, setDockFileName, setDockTimestamp, "OpenDock API (cached)");
        }

        if (map[STORAGE_KEYS.mappingConfirmed] === "1") {
          setMappingConfirmed(true);
        }
      } catch (e) {
        // If cache is unavailable, app still works with live/manual data load.
      } finally {
        hydrateDoneRef.current = true;
        setCacheHydrated(true);
      }
    })();
  }, [hydrateDataSet, hydrateFromPayloadObject, normalizeInventoryForApp, readStoredDataSet]);

  // Save datasets to persistent storage whenever they change
  useEffect(() => {
    persistDataSet(STORAGE_KEYS.inventory, inventory, invFileName, invTimestamp);
  }, [inventory, invFileName, invTimestamp, persistDataSet]);

  useEffect(() => {
    persistDataSet(STORAGE_KEYS.workOrders, workOrders, woFileName, woTimestamp);
  }, [workOrders, woFileName, woTimestamp, persistDataSet]);

  useEffect(() => {
    persistDataSet(STORAGE_KEYS.production, productionData, productionFileName, productionTimestamp);
  }, [productionData, productionFileName, productionTimestamp, persistDataSet]);

  useEffect(() => {
    persistDataSet(STORAGE_KEYS.labor, laborData, laborFileName, laborTimestamp);
  }, [laborData, laborFileName, laborTimestamp, persistDataSet]);

  useEffect(() => {
    persistDataSet(STORAGE_KEYS.evocon, evoconData, evoconFileName, evoconTimestamp);
  }, [evoconData, evoconFileName, evoconTimestamp, persistDataSet]);

  useEffect(() => {
    persistDataSet(STORAGE_KEYS.itemMaster, itemMaster, itemMasterFileName, itemMasterTimestamp);
  }, [itemMaster, itemMasterFileName, itemMasterTimestamp, persistDataSet]);

  useEffect(() => {
    persistDataSet(STORAGE_KEYS.boms, boms, bomFileName, bomTimestamp);
  }, [boms, bomFileName, bomTimestamp, persistDataSet]);

  useEffect(() => {
    persistDataSet(STORAGE_KEYS.edr, edrData, edrFileName, edrTimestamp);
  }, [edrData, edrFileName, edrTimestamp, persistDataSet]);

  useEffect(() => {
    persistDataSet(STORAGE_KEYS.dock, dockData, dockFileName, dockTimestamp);
  }, [dockData, dockFileName, dockTimestamp, persistDataSet]);

  useEffect(() => {
    (async () => {
      try {
        await window.storage.set(STORAGE_KEYS.mappingConfirmed, mappingConfirmed ? "1" : "0");
      } catch (e) { /* noop */ }
    })();
  }, [mappingConfirmed]);

  useEffect(() => {
    if (mappingConfirmed) return;
    if (inventory && workOrders) {
      setMappingConfirmed(true);
    }
  }, [mappingConfirmed, inventory, workOrders]);

  useEffect(() => {
    if (!hydrateDoneRef.current) return;
    if (!inventory || !workOrders) return;
    var payload = {
      inventory: normalizeInventoryForApp(inventory || [], invFileName || ""),
      workOrders: workOrders || [],
      productionData: productionData || [],
      laborData: laborData || [],
      evoconData: evoconData || [],
      itemMaster: itemMaster || [],
      boms: boms || [],
      edrData: edrData || [],
      dockData: dockData || [],
      meta: {
        inventoryFileName: invFileName || "",
        workOrdersFileName: woFileName || "",
        productionDataFileName: productionFileName || "",
        laborDataFileName: laborFileName || "",
        evoconDataFileName: evoconFileName || "",
        itemMasterFileName: itemMasterFileName || "",
        bomsFileName: bomFileName || "",
        edrDataFileName: edrFileName || "",
        dockDataFileName: dockFileName || "",
        inventoryTimestamp: invTimestamp ? invTimestamp.toISOString() : null,
        workOrdersTimestamp: woTimestamp ? woTimestamp.toISOString() : null,
        productionDataTimestamp: productionTimestamp ? productionTimestamp.toISOString() : null,
        laborDataTimestamp: laborTimestamp ? laborTimestamp.toISOString() : null,
        evoconDataTimestamp: evoconTimestamp ? evoconTimestamp.toISOString() : null,
        itemMasterTimestamp: itemMasterTimestamp ? itemMasterTimestamp.toISOString() : null,
        bomsTimestamp: bomTimestamp ? bomTimestamp.toISOString() : null,
        edrDataTimestamp: edrTimestamp ? edrTimestamp.toISOString() : null,
        dockDataTimestamp: dockTimestamp ? dockTimestamp.toISOString() : null,
        mappingConfirmed: !!mappingConfirmed,
      }
    };
    var timer = setTimeout(function() {
      setSharedSnapshotWrite(function(prev) {
        return {
          status: "writing",
          attemptedAt: new Date(),
          succeededAt: prev.succeededAt,
          error: "",
          snapshotVersion: prev.snapshotVersion || "",
          productionWriteMode: prev.productionWriteMode || "",
          laborWriteMode: prev.laborWriteMode || "",
          productionCorrectionStart: prev.productionCorrectionStart || "",
          laborCorrectionStart: prev.laborCorrectionStart || ""
        };
      });
      fetch("/api/cache/snapshot", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload: payload })
      }).then(function(resp) {
        if (!resp.ok) return null;
        return resp.json();
      }).then(function(body) {
        if (!body || !body.snapshot) {
          setSharedSnapshotWrite(function(prev) {
            return {
              status: "error",
              attemptedAt: prev.attemptedAt || new Date(),
              succeededAt: prev.succeededAt,
              error: "Snapshot write returned no payload.",
              snapshotVersion: prev.snapshotVersion || "",
              productionWriteMode: prev.productionWriteMode || "",
              laborWriteMode: prev.laborWriteMode || "",
              productionCorrectionStart: prev.productionCorrectionStart || "",
              laborCorrectionStart: prev.laborCorrectionStart || ""
            };
          });
          return;
        }
        setSharedSnapshotMeta({
          source: "shared",
          syncedAt: body.snapshot.synced_at ? new Date(body.snapshot.synced_at) : new Date(),
          updatedBy: body.snapshot.updated_by || ""
        });
        setSharedSnapshotWrite({
          status: "ok",
          attemptedAt: new Date(),
          succeededAt: body.snapshot.synced_at ? new Date(body.snapshot.synced_at) : new Date(),
          error: "",
          snapshotVersion: body.snapshot.snapshot_version || "",
          productionWriteMode: String(body.productionWriteMode || ""),
          laborWriteMode: String(body.laborWriteMode || ""),
          productionCorrectionStart: String(body.productionCorrectionStart || ""),
          laborCorrectionStart: String(body.laborCorrectionStart || "")
        });
      }).catch(function() {
        // Local cache still works; shared cache sync is best effort.
        setSharedSnapshotWrite(function(prev) {
          return {
            status: "error",
            attemptedAt: prev.attemptedAt || new Date(),
            succeededAt: prev.succeededAt,
            error: "Shared snapshot write failed.",
            snapshotVersion: prev.snapshotVersion || "",
            productionWriteMode: prev.productionWriteMode || "",
            laborWriteMode: prev.laborWriteMode || "",
            productionCorrectionStart: prev.productionCorrectionStart || "",
            laborCorrectionStart: prev.laborCorrectionStart || ""
          };
        });
      });
    }, 1400);
    return function() { clearTimeout(timer); };
  }, [
    inventory, workOrders, productionData, laborData, evoconData, itemMaster, boms, edrData, dockData,
    invFileName, woFileName, productionFileName, laborFileName, evoconFileName, itemMasterFileName, bomFileName, edrFileName, dockFileName,
    invTimestamp, woTimestamp, productionTimestamp, laborTimestamp, evoconTimestamp, itemMasterTimestamp, bomTimestamp, edrTimestamp, dockTimestamp,
    mappingConfirmed, normalizeInventoryForApp
  ]);

  const parseXlsxFile = useCallback(async (file, cb) => {
    try {
      cb(await readWorkbook(file));
    } catch (err) {
      console.error(err);
    }
  }, []);

  const parseEdrWorkbook = useCallback(wb => {
    var rows = [];
    var ds = wb.SheetNames.filter(s => { var l = s.toLowerCase(); return l==="fg"||l==="rm"||l==="inbound"||l==="inbounds"; });
    var sheets = ds.length > 0 ? ds : [wb.SheetNames[0]];
    var xlsxModulePromise = import("xlsx");
    return xlsxModulePromise.then(function(xlsxModule) {
      var XLSX = xlsxModule.default || xlsxModule;
      sheets.forEach(function(sn) {
        var ws = wb.Sheets[sn];
        if (!ws) return;
        var d = XLSX.utils.sheet_to_json(ws, { defval:"" });
        d.forEach(function(r) { r.__edrTab = sn; });
        rows.push.apply(rows, d);
      });
      return rows;
    });
  }, []);

  const handleRefreshFile = useCallback(async (type, file) => {
    if (!file) return;
    var ext = file.name.split(".").pop().toLowerCase();
    var ts = new Date();
    if (ext === "xlsx" || ext === "xls") {
      parseXlsxFile(file, async function(wb) {
        const xlsxModule = await import("xlsx");
        const XLSX = xlsxModule.default || xlsxModule;
        if (type === "edr") {
          setEdrData(await parseEdrWorkbook(wb));
          setEdrFileName(file.name);
          setEdrTimestamp(ts);
        } else if (type === "dock") {
          setDockData(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval:"" }));
          setDockFileName(file.name);
          setDockTimestamp(ts);
        } else {
          var d = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval:"" });
          if (type==="inv") {setInventory(d);setInvFileName(file.name);setInvTimestamp(ts);}
          else if (type==="bom") {setBoms(d);setBomFileName(file.name);setBomTimestamp(ts);}
          else if (type==="wo") {setWorkOrders(d);setWoFileName(file.name);setWoTimestamp(ts);}
        }
      });
    } else {
      var text = await readFileAsText(file);
      var d = await parseCsvText(text);
      if (type==="inv") {setInventory(d);setInvFileName(file.name);setInvTimestamp(ts);}
      else if (type==="bom") {setBoms(d);setBomFileName(file.name);setBomTimestamp(ts);}
      else if (type==="wo") {setWorkOrders(d);setWoFileName(file.name);setWoTimestamp(ts);}
      else if (type==="edr") {setEdrData(d);setEdrFileName(file.name);setEdrTimestamp(ts);}
    }
  }, [parseXlsxFile, parseEdrWorkbook]);

  var invHeaders = useMemo(() => inventory && inventory.length > 0 ? Object.keys(inventory[0]) : [], [inventory]);
  var bomHeaders = useMemo(() => boms && boms.length > 0 ? Object.keys(boms[0]) : [], [boms]);
  var woHeaders = useMemo(() => workOrders && workOrders.length > 0 ? Object.keys(workOrders[0]) : [], [workOrders]);
  useMemo(() => { if (invHeaders.length && !invMapping.sku) setInvMapping(autoMapColumns(invHeaders, INV_PAT)); }, [invHeaders]);
  useMemo(() => {
    if (!bomHeaders.length) return;
    var shouldInitialize = !bomMapping.bomId;
    var missingDescriptionMapping = !bomMapping.description;
    var hasVersionNameAsDescription = !!(bomMapping.description && normalizeStr(bomMapping.description).includes("versionname"));
    if (!shouldInitialize && !hasVersionNameAsDescription && !missingDescriptionMapping) return;
    var next = autoMapColumns(bomHeaders, BOM_PAT);
    if (!shouldInitialize) {
      // Preserve user's existing mappings unless we are correcting the known "Version Name" description pitfall.
      next = Object.assign({}, bomMapping, next);
      if (hasVersionNameAsDescription && next.description && normalizeStr(next.description).includes("versionname")) {
        delete next.description;
      }
      if (missingDescriptionMapping && !next.description) {
        var descCandidate = autoMapColumns(bomHeaders, { description: BOM_PAT.description }).description;
        if (descCandidate) next.description = descCandidate;
      }
    }
    if (!areMappingsEqual(next, bomMapping)) setBomMapping(next);
  }, [bomHeaders, bomMapping]);
  useMemo(() => { if (woHeaders.length && !woMapping.woNumber) setWoMapping(autoMapColumns(woHeaders, WO_PAT)); }, [woHeaders]);
  var allUploaded = inventory && workOrders;
  var requiredMappingsMet = useMemo(() => invMapping.sku && invMapping.qtyOnHand && woMapping.woNumber && woMapping.productSku && woMapping.qtyToProduce && (!boms || (bomMapping.bomId && bomMapping.componentSku && bomMapping.qtyPer)), [invMapping,bomMapping,woMapping,boms]);

  return {
    inventory, setInventory,
    itemMaster, setItemMaster,
    boms, setBoms,
    workOrders, setWorkOrders,
    productionData, setProductionData,
    laborData, setLaborData,
    evoconData, setEvoconData,
    invFileName, setInvFileName,
    itemMasterFileName, setItemMasterFileName,
    bomFileName, setBomFileName,
    woFileName, setWoFileName,
    productionFileName, setProductionFileName,
    laborFileName, setLaborFileName,
    evoconFileName, setEvoconFileName,
    invTimestamp, setInvTimestamp,
    itemMasterTimestamp, setItemMasterTimestamp,
    bomTimestamp, setBomTimestamp,
    woTimestamp, setWoTimestamp,
    productionTimestamp, setProductionTimestamp,
    laborTimestamp, setLaborTimestamp,
    evoconTimestamp, setEvoconTimestamp,
    edrData, setEdrData,
    edrFileName, setEdrFileName,
    edrTimestamp, setEdrTimestamp,
    dockData, setDockData,
    dockFileName, setDockFileName,
    dockTimestamp, setDockTimestamp,
    poData, setPoData,
    poFileName, setPoFileName,
    poTimestamp, setPoTimestamp,
    poHeaders, setPoHeaders,
    poMapping, setPoMapping,
    invMapping, setInvMapping,
    bomMapping, setBomMapping,
    woMapping, setWoMapping,
    mappingConfirmed, setMappingConfirmed,
    cacheHydrated,
    sharedSnapshotMeta,
    sharedSnapshotWrite,
    analyzing, setAnalyzing,
    invRefreshRef, bomRefreshRef, woRefreshRef, edrRefreshRef, dockRefreshRef,
    parseXlsxFile, parseEdrWorkbook, handleRefreshFile,
    invHeaders, bomHeaders, woHeaders,
    allUploaded, requiredMappingsMet,
  };
}
