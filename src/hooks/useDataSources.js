import { useState, useMemo, useCallback, useEffect } from "react";
import * as XLSX from "xlsx";
import { parseCSV, safeNum, normalizeStr, autoMapColumns, INV_PAT, BOM_PAT, WO_PAT, PO_PAT } from "../utils";

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
  const [boms, setBoms] = useState(null);
  const [workOrders, setWorkOrders] = useState(null);
  const [invFileName, setInvFileName] = useState("");
  const [bomFileName, setBomFileName] = useState("");
  const [woFileName, setWoFileName] = useState("");
  const [invTimestamp, setInvTimestamp] = useState(null);
  const [bomTimestamp, setBomTimestamp] = useState(null);
  const [woTimestamp, setWoTimestamp] = useState(null);
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

  const invRefreshRef = useCallback(n => { if (n) window.__invR = n; }, []);
  const bomRefreshRef = useCallback(n => { if (n) window.__bomR = n; }, []);
  const woRefreshRef = useCallback(n => { if (n) window.__woR = n; }, []);
  const edrRefreshRef = useCallback(n => { if (n) window.__edrR = n; }, []);
  const dockRefreshRef = useCallback(n => { if (n) window.__dockR = n; }, []);

  // Load BOM from persistent storage on mount
  useEffect(() => {
    (async () => {
      try {
        var result = await window.storage.get("bom-data");
        if (result && result.value) {
          var stored = JSON.parse(result.value);
          if (stored.data && stored.data.length) {
            setBoms(stored.data);
            setBomFileName(stored.fileName || "Saved BOM");
            setBomTimestamp(stored.timestamp ? new Date(stored.timestamp) : new Date());
          }
        }
      } catch (e) { /* no stored BOM, that's fine */ }
    })();
  }, []);

  // Save BOM to persistent storage whenever it changes
  useEffect(() => {
    if (!boms || !boms.length) return;
    (async () => {
      try {
        await window.storage.set("bom-data", JSON.stringify({ data:boms, fileName:bomFileName, timestamp:bomTimestamp?bomTimestamp.toISOString():new Date().toISOString() }));
      } catch (e) { console.error("Failed to save BOM:", e); }
    })();
  }, [boms, bomFileName, bomTimestamp]);

  const parseXlsxFile = useCallback((file, cb) => { var r = new FileReader(); r.onload = e => { try { cb(XLSX.read(new Uint8Array(e.target.result), { type:"array", cellDates:true })); } catch(err) { console.error(err); } }; r.readAsArrayBuffer(file); }, []);

  const parseEdrWorkbook = useCallback(wb => {
    var rows = []; var ds = wb.SheetNames.filter(s => { var l = s.toLowerCase(); return l==="fg"||l==="rm"||l==="inbound"||l==="inbounds"; });
    (ds.length > 0 ? ds : [wb.SheetNames[0]]).forEach(sn => { var ws = wb.Sheets[sn]; if (!ws) return; var d = XLSX.utils.sheet_to_json(ws, {defval:""}); d.forEach(r => { r.__edrTab = sn; }); rows.push(...d); });
    return rows;
  }, []);

  const handleRefreshFile = useCallback((type, file) => {
    if (!file) return; var ext = file.name.split(".").pop().toLowerCase(); var ts = new Date();
    if (ext === "xlsx" || ext === "xls") {
      parseXlsxFile(file, wb => {
        if (type==="edr") { setEdrData(parseEdrWorkbook(wb)); setEdrFileName(file.name); setEdrTimestamp(ts); }
        else if (type==="dock") { setDockData(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {defval:""})); setDockFileName(file.name); setDockTimestamp(ts); }
        else { var d = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {defval:""}); if (type==="inv") {setInventory(d);setInvFileName(file.name);setInvTimestamp(ts);} else if (type==="bom") {setBoms(d);setBomFileName(file.name);setBomTimestamp(ts);} else if (type==="wo") {setWorkOrders(d);setWoFileName(file.name);setWoTimestamp(ts);} }
      });
    } else {
      var r = new FileReader();
      r.onload = e => { var d = parseCSV(e.target.result); if (type==="inv") {setInventory(d);setInvFileName(file.name);setInvTimestamp(ts);} else if (type==="bom") {setBoms(d);setBomFileName(file.name);setBomTimestamp(ts);} else if (type==="wo") {setWorkOrders(d);setWoFileName(file.name);setWoTimestamp(ts);} else if (type==="edr") {setEdrData(d);setEdrFileName(file.name);setEdrTimestamp(ts);} };
      r.readAsText(file);
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
    boms, setBoms,
    workOrders, setWorkOrders,
    invFileName, setInvFileName,
    bomFileName, setBomFileName,
    woFileName, setWoFileName,
    invTimestamp, setInvTimestamp,
    bomTimestamp, setBomTimestamp,
    woTimestamp, setWoTimestamp,
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
    analyzing, setAnalyzing,
    invRefreshRef, bomRefreshRef, woRefreshRef, edrRefreshRef, dockRefreshRef,
    parseXlsxFile, parseEdrWorkbook, handleRefreshFile,
    invHeaders, bomHeaders, woHeaders,
    allUploaded, requiredMappingsMet,
  };
}
