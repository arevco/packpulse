import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { safeNum, normalizeStr, autoMapColumns, INV_PAT, BOM_PAT, WO_PAT, PO_PAT } from "../utils";
import { parseCsvText, readFileAsText, readWorkbook } from "../utils/fileParsers";

const STORAGE_KEYS = {
  inventory: "inv-data",
  workOrders: "wo-data",
  itemMaster: "itemmaster-data",
  boms: "bom-data",
  production: "production-data",
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

export function useDataSources() {
  const [inventory, setInventory] = useState(null);
  const [itemMaster, setItemMaster] = useState(null);
  const [boms, setBoms] = useState(null);
  const [workOrders, setWorkOrders] = useState(null);
  const [productionData, setProductionData] = useState(null);
  const [evoconData, setEvoconData] = useState(null);
  const [invFileName, setInvFileName] = useState("");
  const [itemMasterFileName, setItemMasterFileName] = useState("");
  const [bomFileName, setBomFileName] = useState("");
  const [woFileName, setWoFileName] = useState("");
  const [productionFileName, setProductionFileName] = useState("");
  const [evoconFileName, setEvoconFileName] = useState("");
  const [invTimestamp, setInvTimestamp] = useState(null);
  const [itemMasterTimestamp, setItemMasterTimestamp] = useState(null);
  const [bomTimestamp, setBomTimestamp] = useState(null);
  const [woTimestamp, setWoTimestamp] = useState(null);
  const [productionTimestamp, setProductionTimestamp] = useState(null);
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
  const [sharedSnapshotMeta, setSharedSnapshotMeta] = useState({ source: "unknown", syncedAt: null, updatedBy: "" });
  const hydrateDoneRef = useRef(false);

  const invRefreshRef = useCallback(n => { if (n) window.__invR = n; }, []);
  const bomRefreshRef = useCallback(n => { if (n) window.__bomR = n; }, []);
  const woRefreshRef = useCallback(n => { if (n) window.__woR = n; }, []);
  const edrRefreshRef = useCallback(n => { if (n) window.__edrR = n; }, []);
  const dockRefreshRef = useCallback(n => { if (n) window.__dockR = n; }, []);

  const hydrateDataSet = useCallback(function(storedValue, setData, setFileName, setTimestamp, fallbackName) {
    if (!storedValue) return false;
    var parsed = null;
    try {
      parsed = JSON.parse(storedValue);
    } catch (e) {
      return false;
    }
    if (!parsed || !parsed.data || !parsed.data.length) return false;
    setData(parsed.data);
    setFileName(parsed.fileName || fallbackName || "Saved Data");
    setTimestamp(parsed.timestamp ? new Date(parsed.timestamp) : new Date());
    return true;
  }, []);

  const persistDataSet = useCallback(async function(key, data, fileName, timestamp) {
    if (!data || !data.length) return;
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
      if (!Array.isArray(rows) || !rows.length) return;
      hasAny = true;
      setData(rows);
      setName(meta[dataKey + "FileName"] || defaultLabel + (labelSuffix ? " (" + labelSuffix + ")" : ""));
      setTs(meta[dataKey + "Timestamp"] ? new Date(meta[dataKey + "Timestamp"]) : new Date());
    }

    applyData("inventory", setInventory, setInvFileName, setInvTimestamp, "Nulogy Sync");
    applyData("workOrders", setWorkOrders, setWoFileName, setWoTimestamp, "Nulogy Sync");
    applyData("productionData", setProductionData, setProductionFileName, setProductionTimestamp, "Nulogy Production");
    applyData("evoconData", setEvoconData, setEvoconFileName, setEvoconTimestamp, "Evocon Reports");
    applyData("itemMaster", setItemMaster, setItemMasterFileName, setItemMasterTimestamp, "Nulogy Sync");
    applyData("boms", setBoms, setBomFileName, setBomTimestamp, "Nulogy Sync");
    applyData("edrData", setEdrData, setEdrFileName, setEdrTimestamp, "EDR");
    applyData("dockData", setDockData, setDockFileName, setDockTimestamp, "OpenDock API");

    if (typeof meta.mappingConfirmed === "boolean") {
      setMappingConfirmed(meta.mappingConfirmed);
    }
    return hasAny;
  }, []);

  // Load shared snapshot first, then local fallback.
  useEffect(() => {
    (async () => {
      try {
        var sharedLoaded = false;
        try {
          var sharedRes = await fetch("/api/cache/snapshot", { credentials: "include" });
          if (sharedRes.ok) {
            var sharedBody = await sharedRes.json();
            if (sharedBody && sharedBody.snapshot && sharedBody.snapshot.payload) {
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

        if (!sharedLoaded) {
          hydrateDataSet(map[STORAGE_KEYS.inventory], setInventory, setInvFileName, setInvTimestamp, "Nulogy Sync (cached)");
          hydrateDataSet(map[STORAGE_KEYS.workOrders], setWorkOrders, setWoFileName, setWoTimestamp, "Nulogy Sync (cached)");
          hydrateDataSet(map[STORAGE_KEYS.production], setProductionData, setProductionFileName, setProductionTimestamp, "Nulogy Production (cached)");
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

        if (map[STORAGE_KEYS.mappingConfirmed] === "1") {
          setMappingConfirmed(true);
        }
      } catch (e) {
        // If cache is unavailable, app still works with live/manual data load.
      } finally {
        hydrateDoneRef.current = true;
      }
    })();
  }, [hydrateDataSet, hydrateFromPayloadObject]);

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
      inventory: inventory || [],
      workOrders: workOrders || [],
      productionData: productionData || [],
      evoconData: evoconData || [],
      itemMaster: itemMaster || [],
      boms: boms || [],
      edrData: edrData || [],
      dockData: dockData || [],
      meta: {
        inventoryFileName: invFileName || "",
        workOrdersFileName: woFileName || "",
        productionDataFileName: productionFileName || "",
        evoconDataFileName: evoconFileName || "",
        itemMasterFileName: itemMasterFileName || "",
        bomsFileName: bomFileName || "",
        edrDataFileName: edrFileName || "",
        dockDataFileName: dockFileName || "",
        inventoryTimestamp: invTimestamp ? invTimestamp.toISOString() : null,
        workOrdersTimestamp: woTimestamp ? woTimestamp.toISOString() : null,
        productionDataTimestamp: productionTimestamp ? productionTimestamp.toISOString() : null,
        evoconDataTimestamp: evoconTimestamp ? evoconTimestamp.toISOString() : null,
        itemMasterTimestamp: itemMasterTimestamp ? itemMasterTimestamp.toISOString() : null,
        bomsTimestamp: bomTimestamp ? bomTimestamp.toISOString() : null,
        edrDataTimestamp: edrTimestamp ? edrTimestamp.toISOString() : null,
        dockDataTimestamp: dockTimestamp ? dockTimestamp.toISOString() : null,
        mappingConfirmed: !!mappingConfirmed,
      }
    };
    var timer = setTimeout(function() {
      fetch("/api/cache/snapshot", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload: payload })
      }).then(function(resp) {
        if (!resp.ok) return null;
        return resp.json();
      }).then(function(body) {
        if (!body || !body.snapshot) return;
        setSharedSnapshotMeta({
          source: "shared",
          syncedAt: body.snapshot.synced_at ? new Date(body.snapshot.synced_at) : new Date(),
          updatedBy: body.snapshot.updated_by || ""
        });
      }).catch(function() {
        // Local cache still works; shared cache sync is best effort.
      });
    }, 1400);
    return function() { clearTimeout(timer); };
  }, [
    inventory, workOrders, productionData, evoconData, itemMaster, boms, edrData, dockData,
    invFileName, woFileName, productionFileName, evoconFileName, itemMasterFileName, bomFileName, edrFileName, dockFileName,
    invTimestamp, woTimestamp, productionTimestamp, evoconTimestamp, itemMasterTimestamp, bomTimestamp, edrTimestamp, dockTimestamp,
    mappingConfirmed
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
    evoconData, setEvoconData,
    invFileName, setInvFileName,
    itemMasterFileName, setItemMasterFileName,
    bomFileName, setBomFileName,
    woFileName, setWoFileName,
    productionFileName, setProductionFileName,
    evoconFileName, setEvoconFileName,
    invTimestamp, setInvTimestamp,
    itemMasterTimestamp, setItemMasterTimestamp,
    bomTimestamp, setBomTimestamp,
    woTimestamp, setWoTimestamp,
    productionTimestamp, setProductionTimestamp,
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
    sharedSnapshotMeta,
    analyzing, setAnalyzing,
    invRefreshRef, bomRefreshRef, woRefreshRef, edrRefreshRef, dockRefreshRef,
    parseXlsxFile, parseEdrWorkbook, handleRefreshFile,
    invHeaders, bomHeaders, woHeaders,
    allUploaded, requiredMappingsMet,
  };
}
