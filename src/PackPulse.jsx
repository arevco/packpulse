import { useState, useMemo, useCallback, useEffect } from "react";
import * as Papa from "papaparse";
import * as XLSX from "xlsx";

const FONTS_CSS = "@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap');";
const sans = "'IBM Plex Sans', -apple-system, sans-serif";
const mono = "'IBM Plex Mono', monospace";

const THEMES = {
  dark: {
    bg:"#101114",surface:"#18191e",raised:"#1e2026",border:"#2a2c34",
    text:"#a8adb8",dim:"#5c6070",bright:"#e2e5eb",
    accent:"#5b8def",accentSoft:"rgba(91,141,239,0.10)",accentLine:"rgba(91,141,239,0.30)",
    ok:"#3dbd7d",okSoft:"rgba(61,189,125,0.10)",okLine:"rgba(61,189,125,0.25)",
    warn:"#e0a030",warnSoft:"rgba(224,160,48,0.10)",warnLine:"rgba(224,160,48,0.25)",
    bad:"#e05555",badSoft:"rgba(224,85,85,0.10)",badLine:"rgba(224,85,85,0.25)",
    hover:"rgba(255,255,255,0.03)",
  },
  light: {
    bg:"#f3f4f6",surface:"#ffffff",raised:"#f8f9fb",border:"#e2e4ea",
    text:"#505868",dim:"#8c93a4",bright:"#1c2030",
    accent:"#3b6fd8",accentSoft:"rgba(59,111,216,0.07)",accentLine:"rgba(59,111,216,0.22)",
    ok:"#1c9858",okSoft:"rgba(28,152,88,0.07)",okLine:"rgba(28,152,88,0.22)",
    warn:"#b88510",warnSoft:"rgba(184,133,16,0.07)",warnLine:"rgba(184,133,16,0.22)",
    bad:"#cc3838",badSoft:"rgba(204,56,56,0.07)",badLine:"rgba(204,56,56,0.22)",
    hover:"rgba(0,0,0,0.025)",
  },
};
let C = THEMES.dark;

function parseCSV(text) { return Papa.parse(text, { header:true, skipEmptyLines:true, dynamicTyping:false }).data; }
function safeNum(v) { if (v == null || v === "") return 0; const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, "")); return isNaN(n) ? 0 : n; }
function normalizeStr(s) { return String(s || "").replace(/[^a-z0-9]/gi, "").toLowerCase(); }
function fmtDate(v) { if (!v) return "--"; var d = v instanceof Date ? v : new Date(v); if (isNaN(d)) return String(v); return (d.getMonth()+1) + "/" + d.getDate() + "/" + String(d.getFullYear()).slice(-2); }
function autoMapColumns(headers, patterns) {
  const map = {}; const normed = headers.map(h => ({ orig:h, norm:normalizeStr(h) }));
  Object.entries(patterns).forEach(([field, cands]) => { for (const c of cands) { const m = normed.find(h => h.norm.includes(c.toLowerCase())); if (m) { map[field] = m.orig; break; } } });
  return map;
}
const INV_PAT = { sku:["itemcode","sku","item","material","partnumber"], description:["description","desc","itemname","name"], qtyOnHand:["good","qtyonhand","onhand","available","stock","instock","quantity"] };
const BOM_PAT = { bomId:["finishedgoodcode","bomid","parentsku","parent","fgcode"], componentSku:["subcomponentcode","componentsku","childsku","component","material"], description:["description","desc","name"], qtyPer:["qtyper","quantity","ratio","usage","per"], substituteFor:["substitutefor","altfor","replacementfor","subfor"], priority:["priority","prio","rank","preference"] };
const WO_PAT = { woNumber:["workordercode","wonum","wonumber","workorder","wo"], productSku:["itemcode","productsku","sku","material","fgsku"], qtyToProduce:["unitsexpected","qtytoproduce","orderqty","quantity","qty"], dueDate:["duedate","due","needdate","requireddate"], status:["workorderstatus","status","state","wostatus"], customer:["customername","customer","client"], unitsProduced:["unitsproduced","produced","completed"], unitsRemaining:["unitsremaining","remaining","balance"], unitsPerHour:["standardunitsperhour","unitsperhour","rateperhour","rate"], standardPeople:["standardpeople","people","crew","headcount"], plannedStart:["plannedstart","startdate","planstart"], plannedEnd:["plannedend","enddate","planend"], reference1:["reference1","ref1","notes","reference"] };
const PO_PAT = { material:["material","materialcode","itemcode","sku","item","partnumber","materialdescription"], description:["description","desc","name","materialdescription"], qty:["quantity","qty","orderqty","poqty","ordered"], unitPrice:["unitprice","price","rate","cost"], poNumber:["ponumber","po","purchaseorder","documentnumber"] };

function ColumnMapper({ title, headers, mapping, onMappingChange, fields }) {
  return (
    <div style={{ marginBottom:20 }}>
      <div style={{ fontSize:12, fontWeight:600, color:C.accent, fontFamily:mono, textTransform:"uppercase", letterSpacing:1.5, marginBottom:10 }}>{title}</div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(190px, 1fr))", gap:8 }}>
        {fields.map(f => (
          <div key={f.key}>
            <label style={{ fontSize:13, color:C.dim, fontFamily:sans, display:"block", marginBottom:3 }}>{f.label}{f.required && <span style={{ color:C.bad }}> *</span>}</label>
            <select value={mapping[f.key] || ""} onChange={e => onMappingChange({ ...mapping, [f.key]: e.target.value })}
              style={{ width:"100%", padding:"7px 10px", borderRadius:6, border:"1px solid " + (mapping[f.key] ? C.accentLine : C.border), background:C.surface, color:C.bright, fontFamily:mono, fontSize:13, outline:"none" }}>
              <option value="">--</option>
              {headers.map(h => <option key={h} value={h}>{h}</option>)}
            </select>
          </div>
        ))}
      </div>
    </div>
  );
}

function FileUploader({ label, onData, uploaded, fileName, subtitle, acceptTypes, parseWorkbook }) {
  const accept = acceptTypes || ".csv";
  const handleFile = useCallback(file => {
    if (!file) return;
    const ext = file.name.split(".").pop().toLowerCase();
    if (ext === "xlsx" || ext === "xls") {
      const r = new FileReader();
      r.onload = e => { try { const wb = XLSX.read(new Uint8Array(e.target.result), { type:"array", cellDates:true }); parseWorkbook ? onData(parseWorkbook(wb), file.name) : onData(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval:"" }), file.name); } catch(err) { console.error(err); } };
      r.readAsArrayBuffer(file);
    } else { const r = new FileReader(); r.onload = e => onData(parseCSV(e.target.result), file.name); r.readAsText(file); }
  }, [onData, parseWorkbook]);
  return (
    <label onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); handleFile(e.dataTransfer.files[0]); }}
      style={{ display:"flex", alignItems:"center", gap:12, padding:"12px 14px", border:"1px solid " + (uploaded ? C.okLine : C.border), borderRadius:8, cursor:"pointer", background:uploaded ? C.okSoft : C.surface }}>
      <input type="file" accept={accept} style={{ display:"none" }} onChange={e => handleFile(e.target.files[0])} />
      <div style={{ width:28, height:28, borderRadius:6, background:uploaded ? C.ok : C.raised, display:"flex", alignItems:"center", justifyContent:"center", fontSize:15, color:uploaded ? "#fff" : C.dim, fontWeight:700, flexShrink:0 }}>{uploaded ? "\u2713" : "+"}</div>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:15, fontWeight:600, color:uploaded ? C.ok : C.bright, fontFamily:sans }}>{label}</div>
        <div style={{ fontSize:13, color:C.dim, fontFamily:sans, marginTop:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{uploaded ? fileName : subtitle || ("Drop " + accept.replace(/\./g,"").toUpperCase() + " or click")}</div>
      </div>
    </label>
  );
}

function Dot({ status }) {
  var c = status === "ready" ? C.ok : status === "partial" ? C.warn : status === "nobom" ? C.accent : C.bad;
  var l = status === "ready" ? "Ready" : status === "partial" ? "Partial" : status === "nobom" ? "No BOM" : "Blocked";
  return <span style={{ display:"inline-flex", alignItems:"center", gap:5, fontSize:13, fontFamily:sans, fontWeight:500, color:c }}><span style={{ width:6, height:6, borderRadius:"50%", background:c }} />{l}</span>;
}


function triggerDownload(content, filename, mimeType) {
  try { var b = new Blob([content], { type:mimeType }); var u = URL.createObjectURL(b); var a = document.createElement("a"); a.href = u; a.download = filename; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(u); } catch(e) { console.error(e); }
}

function buildExportHTML(title, headerCells, bodyRows) {
  var css = "body{font-family:Arial,sans-serif;margin:24px;color:#222}h1{font-size:20px}table{width:100%;border-collapse:collapse;margin-top:16px;font-size:11px}th{background:#f0f0f0;padding:8px;text-align:left;border-bottom:2px solid #ccc;font-size:10px;text-transform:uppercase}td{padding:8px;border-bottom:1px solid #eee}.ready{color:#1c9858}.partial{color:#b88510}.blocked{color:#cc3838}.nobom{color:#3b6fd8}.zero{color:#cc3838}.low{color:#b88510}";
  var parts = ["<!DOCTYPE html>", "<html>", "<head>", "<title>", title, "</title>", "<style>", css, "</style>", "</head>", "<body>", "<h1>", title, "</h1>", "<p>Generated ", new Date().toLocaleString(), "</p>", "<table>", "<thead>", "<tr>", headerCells, "</tr>", "</thead>", "<tbody>", bodyRows, "</tbody>", "</table>", "</body>", "</html>"];
  return parts.join("");
}

export default function ProductionReadiness() {
  const [theme, setTheme] = useState("light");
  C = THEMES[theme];
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
  const [sortField, setSortField] = useState("readiness");
  const [sortDir, setSortDir] = useState("desc");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterWoStatus, setFilterWoStatus] = useState("Booked");
  const [filterCustomer, setFilterCustomer] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [expandedWO, setExpandedWO] = useState(null);
  const [activeView, setActiveView] = useState("overview");
  const [ciSort, setCiSort] = useState("unlockedUnits");
  const [ciSortDir, setCiSortDir] = useState("desc");
  const [ciSearch, setCiSearch] = useState("");
  const [matSort, setMatSort] = useState("affectedWOs");
  const [matSortDir, setMatSortDir] = useState("desc");
  const [matFilterTab, setMatFilterTab] = useState("all");
  const [matFilterDock, setMatFilterDock] = useState("all");
  const [matFilterWO, setMatFilterWO] = useState("all");
  const [matSearch, setMatSearch] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [flagSearch, setFlagSearch] = useState("");
  const [flagFilterType, setFlagFilterType] = useState("all");
  const [flagFilterSeverity, setFlagFilterSeverity] = useState("all");
  const [flagSort, setFlagSort] = useState("severity");
  const [flagSortDir, setFlagSortDir] = useState("desc");
  const [showSettings, setShowSettings] = useState(false);
  const [lateCollapsed, setLateCollapsed] = useState(false);
  const [ovDateFrom, setOvDateFrom] = useState("");
  const [ovDateTo, setOvDateTo] = useState("");
  const [ovWoStatus, setOvWoStatus] = useState("all");

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

  var fmtTs = ts => { if (!ts) return "--"; var d = Date.now() - ts; return d < 60000 ? "now" : d < 3600000 ? Math.floor(d/60000) + "m" : d < 86400000 ? Math.floor(d/3600000) + "h" : Math.floor(d/86400000) + "d"; };
  var staleLevel = (ts, cad) => { if (!ts) return "stale"; var h = (Date.now()-ts)/3600000; if (cad==="daily") return h<8?"fresh":h<24?"stale":"old"; if (cad==="rare") return h<720?"fresh":"stale"; return h<168?"fresh":"stale"; };

  var invHeaders = useMemo(() => inventory && inventory.length > 0 ? Object.keys(inventory[0]) : [], [inventory]);
  var bomHeaders = useMemo(() => boms && boms.length > 0 ? Object.keys(boms[0]) : [], [boms]);
  var woHeaders = useMemo(() => workOrders && workOrders.length > 0 ? Object.keys(workOrders[0]) : [], [workOrders]);
  useMemo(() => { if (invHeaders.length && !invMapping.sku) setInvMapping(autoMapColumns(invHeaders, INV_PAT)); }, [invHeaders]);
  useMemo(() => { if (bomHeaders.length && !bomMapping.bomId) setBomMapping(autoMapColumns(bomHeaders, BOM_PAT)); }, [bomHeaders]);
  useMemo(() => { if (woHeaders.length && !woMapping.woNumber) setWoMapping(autoMapColumns(woHeaders, WO_PAT)); }, [woHeaders]);
  var allUploaded = inventory && workOrders;
  var requiredMappingsMet = useMemo(() => invMapping.sku && invMapping.qtyOnHand && woMapping.woNumber && woMapping.productSku && woMapping.qtyToProduce && (!boms || (bomMapping.bomId && bomMapping.componentSku && bomMapping.qtyPer)), [invMapping,bomMapping,woMapping,boms]);


  /* ====== ANALYSIS ENGINE ====== */
  var analysis = useMemo(() => {
    if (!mappingConfirmed || !allUploaded) return null;
    var invMap = {}; var invDescMap = {};
    inventory.forEach(row => { var sku = normalizeStr(row[invMapping.sku]); if (sku) { invMap[sku] = (invMap[sku]||0) + safeNum(row[invMapping.qtyOnHand]); if (invMapping.description && row[invMapping.description] && !invDescMap[sku]) invDescMap[sku] = row[invMapping.description].toString().trim(); } });
    var bomMap = {};
    if (boms && boms.length) { boms.forEach(row => {
      var parentRaw = (row[bomMapping.bomId]||"").toString().trim(); var parent = normalizeStr(parentRaw); if (!parent) return;
      if (!bomMap[parent]) bomMap[parent] = { parentRaw:parentRaw, rawComponents:[] };
      var subForRaw = bomMapping.substituteFor ? (row[bomMapping.substituteFor]||"").toString().trim() : "";
      var priorityRaw = bomMapping.priority ? safeNum(row[bomMapping.priority]) : 0;
      bomMap[parent].rawComponents.push({ sku:normalizeStr(row[bomMapping.componentSku]), skuRaw:(row[bomMapping.componentSku]||"").toString().trim(), descRaw:bomMapping.description?(row[bomMapping.description]||"").toString().trim():"", qtyPer:safeNum(row[bomMapping.qtyPer]), substituteFor:subForRaw?normalizeStr(subForRaw):"", substituteForRaw:subForRaw, priority:priorityRaw||1 });
    }); }
    Object.values(bomMap).forEach(bom => {
      var pri = bom.rawComponents.filter(c => !c.substituteFor); var subs = bom.rawComponents.filter(c => !!c.substituteFor);
      bom.groups = pri.map(p => { var gs = subs.filter(s => s.substituteFor === p.sku).sort((a,b) => a.priority - b.priority); return { primary:p, substitutes:gs, allOptions:[p,...gs] }; });
      var mapped = new Set(bom.groups.flatMap(g => g.substitutes.map(s => s.sku)));
      subs.filter(s => !mapped.has(s.sku)).forEach(s => { bom.groups.push({ primary:s, substitutes:[], allOptions:[s] }); });
    });
    var results = workOrders.map(wo => {
      var woNum = (wo[woMapping.woNumber]||"").toString().trim(); var productSku = normalizeStr(wo[woMapping.productSku]); var productSkuRaw = (wo[woMapping.productSku]||"").toString().trim();
      var qtyToProduce = safeNum(wo[woMapping.qtyToProduce]); var dueDate = woMapping.dueDate ? (wo[woMapping.dueDate]||"").toString().trim() : ""; var status = woMapping.status ? (wo[woMapping.status]||"").toString().trim() : "";
      var customer = woMapping.customer ? (wo[woMapping.customer]||"").toString().trim() : "";
      var unitsProduced = woMapping.unitsProduced ? safeNum(wo[woMapping.unitsProduced]) : 0;
      var unitsRemaining = woMapping.unitsRemaining ? safeNum(wo[woMapping.unitsRemaining]) : Math.max(0, qtyToProduce - unitsProduced);
      var unitsPerHour = woMapping.unitsPerHour ? safeNum(wo[woMapping.unitsPerHour]) : 0;
      var standardPeople = woMapping.standardPeople ? safeNum(wo[woMapping.standardPeople]) : 0;
      var plannedStart = woMapping.plannedStart ? (wo[woMapping.plannedStart]||"").toString().trim() : "";
      var plannedEnd = woMapping.plannedEnd ? (wo[woMapping.plannedEnd]||"").toString().trim() : "";
      var reference1 = woMapping.reference1 ? (wo[woMapping.reference1]||"").toString().trim() : "";
      var estHours = unitsPerHour > 0 && unitsRemaining > 0 ? Math.round(unitsRemaining / unitsPerHour * 10) / 10 : 0;
      var prodPct = qtyToProduce > 0 ? Math.round(unitsProduced / qtyToProduce * 100) : 0;
      var extra = { customer:customer, unitsProduced:unitsProduced, unitsRemaining:unitsRemaining, unitsPerHour:unitsPerHour, standardPeople:standardPeople, plannedStart:plannedStart, plannedEnd:plannedEnd, reference1:reference1, estHours:estHours, prodPct:prodPct };
      var bom = bomMap[productSku];
      if (!bom) return Object.assign({ woNum:woNum, productSkuRaw:productSkuRaw, productDesc:invDescMap[productSku]||"", qtyToProduce:qtyToProduce, dueDate:dueDate, status:status, readiness:-1, runStatus:"nobom", components:[], maxRunnable:0, couldMake:0, zeroStockCount:0, normalizedSku:productSku }, extra);
      var minFill = Infinity, maxRun = Infinity, couldMk = Infinity, zeroCount = 0; var components = [];
      bom.groups.forEach(group => {
        var qp = group.primary.qtyPer; var needed = qp * qtyToProduce; if (needed <= 0) return;
        var combined = 0;
        var optDet = group.allOptions.map(opt => { var oh = invMap[opt.sku]||0; combined += oh; return { sku:opt.skuRaw, desc:invDescMap[opt.sku]||"", onHand:oh, priority:opt.priority, isSub:!!opt.substituteFor, foundInInventory:invMap.hasOwnProperty(opt.sku) }; });
        var fill = (combined/needed)*100; var canMake = qp > 0 ? Math.floor(combined/qp) : Infinity; var short = Math.max(0, needed - combined);
        minFill = Math.min(minFill, fill); maxRun = Math.min(maxRun, canMake);
        if (combined === 0 && qp > 0) zeroCount++; else couldMk = Math.min(couldMk, canMake);
        components.push({ sku:group.primary.skuRaw, desc:invDescMap[group.primary.sku]||"", qtyPer:qp, needed:needed, onHand:combined, fillRate:fill, canMake:canMake, short:short, foundInInventory:optDet.some(o => o.foundInInventory), hasSubs:group.substitutes.length>0, optionDetails:group.substitutes.length>0?optDet:null });
      });
      var readiness = minFill === Infinity ? 100 : Math.min(minFill, 100);
      var runStatus = readiness >= 100 ? "ready" : maxRun > 0 ? "partial" : "blocked";
      if (maxRun === Infinity) maxRun = qtyToProduce; if (couldMk === Infinity) couldMk = qtyToProduce;
      return Object.assign({ woNum:woNum, productSkuRaw:productSkuRaw, productDesc:invDescMap[productSku]||"", qtyToProduce:qtyToProduce, dueDate:dueDate, status:status, readiness:readiness, runStatus:runStatus, components:components, maxRunnable:Math.min(maxRun, qtyToProduce), couldMake:Math.min(couldMk, qtyToProduce), zeroStockCount:zeroCount, normalizedSku:productSku }, extra);
    });
    var diag = { invCount:inventory.length, invUniqueSkus:Object.keys(invMap).length, invSampleQtys:Object.entries(invMap).slice(0,6).map(function(e){return{key:e[0],qty:e[1]}}), bomParentCount:Object.keys(bomMap).length, bomSampleParents:Object.keys(bomMap).slice(0,8), bomTotalLines:boms?boms.length:0, woCount:workOrders.length, woUniqueSkus:[...new Set(results.map(r=>r.normalizedSku))], woUnmatched:[...new Set(results.filter(r=>r.runStatus==="nobom").map(r=>({raw:r.productSkuRaw,norm:r.normalizedSku})))].slice(0,10), woMatchedCount:results.filter(r=>r.runStatus!=="nobom").length };

    /* ====== DATA FLAGS ====== */
    var flags = [];
    var flagId = 0;
    // 1. Inventory SKUs missing descriptions
    var seenInvSkus = new Set();
    inventory.forEach(row => {
      var sku = normalizeStr(row[invMapping.sku]); var skuRaw = (row[invMapping.sku]||"").toString().trim();
      if (!sku || seenInvSkus.has(sku)) return; seenInvSkus.add(sku);
      var desc = invMapping.description ? (row[invMapping.description]||"").toString().trim() : "";
      if (!desc) flags.push({ id:flagId++, type:"missing-desc", severity:"warn", sku:skuRaw, skuNorm:sku, desc:"", source:"Inventory", detail:"SKU has no product description in inventory. Update in ERP.", affectedWOs:[] });
    });
    // 2. BOM components not found in inventory
    var seenNotInInv = new Set();
    Object.values(bomMap).forEach(bom => { bom.rawComponents.forEach(comp => {
      if (seenNotInInv.has(comp.sku)) return;
      if (!invMap.hasOwnProperty(comp.sku)) { seenNotInInv.add(comp.sku); var aws = results.filter(r => r.components.some(c => normalizeStr(c.sku) === comp.sku)).map(r => r.woNum);
        flags.push({ id:flagId++, type:"not-in-inventory", severity:"bad", sku:comp.skuRaw, skuNorm:comp.sku, desc:"", source:"BOM", detail:"Referenced in BOM but has no inventory record. Add to ERP or verify SKU.", affectedWOs:aws });
      }
    }); });
    // 3. WO product SKUs with no BOM
    var seenNoBom = new Set();
    results.forEach(r => { if (r.runStatus === "nobom" && !seenNoBom.has(r.normalizedSku)) { seenNoBom.add(r.normalizedSku); var aws = results.filter(w => w.normalizedSku === r.normalizedSku).map(w => w.woNum);
      flags.push({ id:flagId++, type:"no-bom", severity:"bad", sku:r.productSkuRaw, skuNorm:r.normalizedSku, desc:r.productDesc, source:"Work Orders", detail:"Work order product has no BOM defined. Create BOM in ERP.", affectedWOs:aws });
    } });
    // 4. FG SKUs on work orders not in inventory
    var seenFgNoInv = new Set();
    results.forEach(r => { if (!invMap.hasOwnProperty(r.normalizedSku) && !seenFgNoInv.has(r.normalizedSku)) { seenFgNoInv.add(r.normalizedSku); var aws = results.filter(w => w.normalizedSku === r.normalizedSku).map(w => w.woNum);
      flags.push({ id:flagId++, type:"fg-not-in-inventory", severity:"warn", sku:r.productSkuRaw, skuNorm:r.normalizedSku, desc:r.productDesc, source:"Work Orders", detail:"Finished good has no inventory record. Add to ERP.", affectedWOs:aws });
    } });
    // 5. BOM components with description in inventory but needed and zero stock
    var seenZero = new Set();
    results.forEach(r => { r.components.forEach(comp => { var cn = normalizeStr(comp.sku); if (comp.onHand === 0 && comp.needed > 0 && !seenZero.has(cn) && invMap.hasOwnProperty(cn)) { seenZero.add(cn); var aws = results.filter(w => w.components.some(c => normalizeStr(c.sku) === cn && c.onHand === 0 && c.needed > 0)).map(w => w.woNum);
      flags.push({ id:flagId++, type:"zero-stock", severity:"bad", sku:comp.sku, skuNorm:cn, desc:comp.desc, source:"Inventory", detail:"Component exists in inventory but has zero stock. Verify count or expedite PO.", affectedWOs:aws });
    } }); });

    return { results:results, diagnostics:diag, flags:flags };
  }, [mappingConfirmed, allUploaded, inventory, boms, workOrders, invMapping, bomMapping, woMapping]);

  var summary = useMemo(() => { if (!analysis) return null; var r = analysis.results; return { total:r.length, ready:r.filter(w=>w.runStatus==="ready").length, partial:r.filter(w=>w.runStatus==="partial").length, blocked:r.filter(w=>w.runStatus==="blocked").length, nobom:r.filter(w=>w.runStatus==="nobom").length }; }, [analysis]);

  var overview = useMemo(() => {
    if (!analysis) return null;
    var r = analysis.results.slice();
    // WO status filter
    if (ovWoStatus !== "all") r = r.filter(w => w.status === ovWoStatus);
    // Date range filter on due date
    if (ovDateFrom) { var from = new Date(ovDateFrom); from.setHours(0,0,0,0); r = r.filter(w => { if (!w.dueDate) return false; var d = new Date(w.dueDate); return !isNaN(d) && d >= from; }); }
    if (ovDateTo) { var to = new Date(ovDateTo); to.setHours(23,59,59,999); r = r.filter(w => { if (!w.dueDate) return false; var d = new Date(w.dueDate); return !isNaN(d) && d <= to; }); }
    var today = new Date(); today.setHours(0,0,0,0);
    var totalOrderQty = 0, totalProduced = 0, totalRemaining = 0, totalCanMake = 0, totalEstHours = 0, woCount = r.length;
    var lateWOs = [], byCustomer = {}, noDueDate = 0;
    r.forEach(wo => {
      totalOrderQty += wo.qtyToProduce;
      totalProduced += wo.unitsProduced;
      totalRemaining += wo.unitsRemaining;
      if (wo.runStatus !== "nobom") totalCanMake += wo.maxRunnable;
      totalEstHours += wo.estHours || 0;
      if (wo.dueDate) {
        var dd = new Date(wo.dueDate);
        if (!isNaN(dd) && dd < today && wo.unitsRemaining > 0) {
          var daysLate = Math.floor((today - dd) / 86400000);
          lateWOs.push(Object.assign({}, wo, { daysLate:daysLate }));
        }
      } else { noDueDate++; }
      var cust = wo.customer || "Unassigned";
      if (!byCustomer[cust]) byCustomer[cust] = { orderQty:0, produced:0, remaining:0, canMake:0, count:0, late:0 };
      byCustomer[cust].orderQty += wo.qtyToProduce;
      byCustomer[cust].produced += wo.unitsProduced;
      byCustomer[cust].remaining += wo.unitsRemaining;
      if (wo.runStatus !== "nobom") byCustomer[cust].canMake += wo.maxRunnable;
      byCustomer[cust].count++;
    });
    lateWOs.sort((a,b) => b.daysLate - a.daysLate);
    lateWOs.forEach(w => { var cust = w.customer || "Unassigned"; if (byCustomer[cust]) byCustomer[cust].late++; });
    var completionPct = totalOrderQty > 0 ? Math.round(totalProduced / totalOrderQty * 100) : 0;
    var custArr = Object.entries(byCustomer).map(([name, d]) => Object.assign({ name:name }, d)).sort((a,b) => b.remaining - a.remaining);
    return { totalOrderQty:totalOrderQty, totalProduced:totalProduced, totalRemaining:totalRemaining, totalCanMake:totalCanMake, totalEstHours:Math.round(totalEstHours*10)/10, completionPct:completionPct, lateWOs:lateWOs, byCustomer:custArr, woCount:woCount, noDueDate:noDueDate };
  }, [analysis, ovWoStatus, ovDateFrom, ovDateTo]);

  var poCheck = useMemo(() => {
    if (!poData || !poData.length || !poMapping.material || !poMapping.qty || !analysis) return null;
    var woSkuMap = {};
    analysis.results.forEach(wo => {
      var sk = normalizeStr(wo.productSkuRaw);
      if (!woSkuMap[sk]) woSkuMap[sk] = [];
      woSkuMap[sk].push(wo);
    });
    var lines = [], matched = 0, missing = 0, qtyMismatch = 0, totalPOQty = 0, totalWOQty = 0;
    var poNum = poData[0] && poMapping.poNumber ? (poData[0][poMapping.poNumber]||"").toString().trim() : "";
    poData.forEach(row => {
      var mat = (row[poMapping.material]||"").toString().trim();
      var matNorm = normalizeStr(mat);
      if (!matNorm) return;
      var qty = safeNum(row[poMapping.qty]);
      var desc = poMapping.description ? (row[poMapping.description]||"").toString().trim() : "";
      var price = poMapping.unitPrice ? (row[poMapping.unitPrice]||"").toString().trim() : "";
      totalPOQty += qty;
      var wos = woSkuMap[matNorm] || [];
      var woTotalQty = wos.reduce((s,w) => s + w.qtyToProduce, 0);
      var woTotalProduced = wos.reduce((s,w) => s + w.unitsProduced, 0);
      totalWOQty += woTotalQty;
      var status = "missing";
      if (wos.length > 0) {
        if (Math.abs(woTotalQty - qty) <= 1) { status = "matched"; matched++; }
        else { status = "qty_mismatch"; qtyMismatch++; }
      } else { missing++; }
      lines.push({ material:mat, description:desc, poQty:qty, price:price, status:status, woCount:wos.length, woTotalQty:woTotalQty, woProduced:woTotalProduced, wos:wos, qtyDiff:woTotalQty - qty });
    });
    return { lines:lines, poNum:poNum, matched:matched, missing:missing, qtyMismatch:qtyMismatch, totalLines:lines.length, totalPOQty:totalPOQty, totalWOQty:totalWOQty };
  }, [poData, poMapping, analysis]);

  var criticalItems = useMemo(() => {
    if (!analysis) return [];
    var m = {};
    analysis.results.forEach(wo => { wo.components.forEach(comp => { if (comp.short <= 0) return; var k = normalizeStr(comp.sku); if (!m[k]) m[k] = { sku:comp.sku, desc:comp.desc, onHand:comp.onHand, totalShort:0, affectedWOs:[], unlockedUnits:0, isZeroStock:comp.onHand===0 }; m[k].totalShort += comp.short; m[k].unlockedUnits += wo.qtyToProduce - wo.maxRunnable; m[k].affectedWOs.push({ woNum:wo.woNum, productSku:wo.productSkuRaw, qtyToProduce:wo.qtyToProduce, needed:comp.needed, short:comp.short, dueDate:wo.dueDate }); }); });
    var items = Object.values(m);
    if (ciSearch) { var q = ciSearch.toLowerCase(); items = items.filter(i => i.sku.toLowerCase().includes(q) || (i.desc||"").toLowerCase().includes(q)); }
    items.sort((a,b) => { var c = 0; if (ciSort==="sku") c = a.sku.localeCompare(b.sku); else if (ciSort==="desc") c = (a.desc||"").localeCompare(b.desc||""); else if (ciSort==="onHand") c = a.onHand - b.onHand; else if (ciSort==="totalShort") c = a.totalShort - b.totalShort; else if (ciSort==="affectedWOs") c = a.affectedWOs.length - b.affectedWOs.length; else c = a.unlockedUnits - b.unlockedUnits; return ciSortDir==="desc" ? -c : c; });
    return items;
  }, [analysis, ciSort, ciSortDir, ciSearch]);

  var handleSort = f => { if (sortField === f) setSortDir(d => d==="asc"?"desc":"asc"); else { setSortField(f); setSortDir("desc"); } };
  var handleCiSort = f => { if (ciSort === f) setCiSortDir(d => d==="asc"?"desc":"asc"); else { setCiSort(f); setCiSortDir("desc"); } };
  var handleFlagSort = f => { if (flagSort === f) setFlagSortDir(d => d==="asc"?"desc":"asc"); else { setFlagSort(f); setFlagSortDir("desc"); } };

  var filteredFlags = useMemo(() => {
    if (!analysis || !analysis.flags) return [];
    var f = analysis.flags.slice();
    if (flagFilterType !== "all") f = f.filter(x => x.type === flagFilterType);
    if (flagFilterSeverity !== "all") f = f.filter(x => x.severity === flagFilterSeverity);
    if (flagSearch) { var q = flagSearch.toLowerCase(); f = f.filter(x => x.sku.toLowerCase().includes(q) || (x.desc||"").toLowerCase().includes(q) || x.detail.toLowerCase().includes(q) || x.affectedWOs.some(w => w.toLowerCase().includes(q))); }
    var sevOrd = { bad:0, warn:1, info:2 };
    f.sort((a,b) => { var c = 0; if (flagSort==="severity") c = (sevOrd[a.severity]||9) - (sevOrd[b.severity]||9); else if (flagSort==="sku") c = a.sku.localeCompare(b.sku); else if (flagSort==="type") c = a.type.localeCompare(b.type); else if (flagSort==="source") c = a.source.localeCompare(b.source); else if (flagSort==="affectedWOs") c = a.affectedWOs.length - b.affectedWOs.length; return flagSortDir==="desc" ? -c : c; });
    return f;
  }, [analysis, flagFilterType, flagFilterSeverity, flagSearch, flagSort, flagSortDir]);

  var woStatuses = useMemo(() => { if (!analysis) return []; return [...new Set(analysis.results.map(r => r.status).filter(Boolean))].sort(); }, [analysis]);
  var woCustomers = useMemo(() => { if (!analysis) return []; return [...new Set(analysis.results.map(r => r.customer).filter(Boolean))].sort(); }, [analysis]);

  var filteredResults = useMemo(() => {
    if (!analysis) return []; var r = analysis.results.slice();
    if (filterStatus !== "all") r = r.filter(w => w.runStatus === filterStatus);
    if (filterWoStatus !== "all") r = r.filter(w => w.status === filterWoStatus);
    if (filterCustomer !== "all") r = r.filter(w => w.customer === filterCustomer);
    if (searchTerm) { var q = searchTerm.toLowerCase(); r = r.filter(w => w.woNum.toLowerCase().includes(q) || w.productSkuRaw.toLowerCase().includes(q) || (w.productDesc||"").toLowerCase().includes(q) || (w.customer||"").toLowerCase().includes(q) || (w.reference1||"").toLowerCase().includes(q)); }
    r.sort((a,b) => { var c = 0; if (sortField==="woNum") c=a.woNum.localeCompare(b.woNum); else if (sortField==="product") c=a.productSkuRaw.localeCompare(b.productSkuRaw); else if (sortField==="customer") c=(a.customer||"").localeCompare(b.customer||""); else if (sortField==="qty") c=a.qtyToProduce-b.qtyToProduce; else if (sortField==="produced") c=a.unitsProduced-b.unitsProduced; else if (sortField==="remaining") c=a.unitsRemaining-b.unitsRemaining; else if (sortField==="complete") c=a.prodPct-b.prodPct; else if (sortField==="maxRunnable") c=a.maxRunnable-b.maxRunnable; else if (sortField==="readiness") c=a.readiness-b.readiness; else if (sortField==="estHours") c=a.estHours-b.estHours; else if (sortField==="dueDate") c=(a.dueDate||"zzz").localeCompare(b.dueDate||"zzz"); else if (sortField==="plannedStart") c=(a.plannedStart||"zzz").localeCompare(b.plannedStart||"zzz"); else if (sortField==="plannedEnd") c=(a.plannedEnd||"zzz").localeCompare(b.plannedEnd||"zzz"); else if (sortField==="status") c=(a.status||"").localeCompare(b.status||""); return sortDir==="desc"?-c:c; });
    return r;
  }, [analysis, filterStatus, filterWoStatus, filterCustomer, searchTerm, sortField, sortDir]);

  /* ====== EXPORTS ====== */
  var exportCSV = () => { if (!analysis) return; var h = ["Work Order","Product SKU","Description","Customer","Order Qty","Produced","Remaining","Complete %","Can Make","Ready %","Est Hours","Status","WO Status","Due Date","Planned Start","Planned End","Reference"]; var rows = analysis.results.map(w => [w.woNum, w.productSkuRaw, '"'+(w.productDesc||"").replace(/"/g,'""')+'"', '"'+(w.customer||"")+'"', w.qtyToProduce, w.unitsProduced, w.unitsRemaining, w.prodPct, w.maxRunnable, w.readiness<0?"N/A":Math.round(w.readiness), w.estHours||"", w.runStatus, w.status||"", w.dueDate||"", w.plannedStart||"", w.plannedEnd||"", '"'+(w.reference1||"").replace(/"/g,'""')+'"']); triggerDownload([h.join(",")].concat(rows.map(r => r.join(","))).join("\n"), "packpulse_" + new Date().toISOString().slice(0,10) + ".csv", "text/csv"); };
  var exportPDF = () => { if (!analysis) return; var th = ["WO#","Product","Customer","Qty","Produced","Remaining","Complete","Ready","Est Hrs","Status","Due"].map(h => "<th>"+h+"</th>").join(""); var tb = analysis.results.map(w => "<tr><td>"+w.woNum+"</td><td>"+w.productSkuRaw+"</td><td>"+(w.customer||"--")+"</td><td>"+w.qtyToProduce.toLocaleString()+"</td><td>"+w.unitsProduced.toLocaleString()+"</td><td>"+w.unitsRemaining.toLocaleString()+"</td><td>"+w.prodPct+"%</td><td>"+(w.readiness<0?"N/A":Math.round(w.readiness)+"%")+'</td><td>'+(w.estHours||"--")+'</td><td class="'+w.runStatus+'">'+w.runStatus+"</td><td>"+fmtDate(w.dueDate)+"</td></tr>").join(""); triggerDownload(buildExportHTML("PackPulse Report", th, tb), "packpulse_" + new Date().toISOString().slice(0,10) + ".html", "text/html"); };
  var exportCriticalCSV = () => { var h = ["Item Code","Description","On Hand","Total Short","WOs Affected","Production Unlocked","Status"]; var rows = criticalItems.map(i => [i.sku, '"'+(i.desc||"").replace(/"/g,'""')+'"', Math.round(i.onHand), Math.round(i.totalShort), i.affectedWOs.length, Math.round(i.unlockedUnits), i.isZeroStock?"ZERO":"LOW"]); triggerDownload([h.join(",")].concat(rows.map(r=>r.join(","))).join("\n"), "critical_items_" + new Date().toISOString().slice(0,10) + ".csv", "text/csv"); };
  var exportCriticalPDF = () => { var th = ["Item","Desc","On Hand","Short","WOs","Unlocked","Status"].map(h=>"<th>"+h+"</th>").join(""); var tb = criticalItems.map(i => "<tr><td>"+i.sku+"</td><td>"+(i.desc||"--")+"</td><td>"+Math.round(i.onHand).toLocaleString()+"</td><td>"+Math.round(i.totalShort).toLocaleString()+"</td><td>"+i.affectedWOs.length+"</td><td>"+Math.round(i.unlockedUnits).toLocaleString()+'</td><td class="'+(i.isZeroStock?"zero":"low")+'">'+(i.isZeroStock?"ZERO":"LOW")+"</td></tr>").join(""); triggerDownload(buildExportHTML("Critical Items Report", th, tb), "critical_items_" + new Date().toISOString().slice(0,10) + ".html", "text/html"); };

  var FLAG_LABELS = { "missing-desc":"Missing Description", "not-in-inventory":"Not in Inventory", "no-bom":"No BOM", "fg-not-in-inventory":"FG Not in Inventory", "zero-stock":"Zero Stock" };
  var exportFlagsCSV = () => { if (!filteredFlags.length) return; var h = ["Severity","Type","SKU","Description","Source","Detail","Affected WOs"]; var rows = filteredFlags.map(f => [f.severity.toUpperCase(), FLAG_LABELS[f.type]||f.type, f.sku, '"'+(f.desc||"").replace(/"/g,'""')+'"', f.source, '"'+f.detail.replace(/"/g,'""')+'"', '"'+f.affectedWOs.join("; ")+'"']); triggerDownload([h.join(",")].concat(rows.map(r=>r.join(","))).join("\n"), "data_flags_"+new Date().toISOString().slice(0,10)+".csv", "text/csv"); };
  var exportFlagsPDF = () => { if (!filteredFlags.length) return; var th = ["Severity","Type","SKU","Description","Source","Detail","WOs"].map(h=>"<th>"+h+"</th>").join(""); var tb = filteredFlags.map(f => '<tr><td class="'+(f.severity==="bad"?"blocked":"partial")+'">'+f.severity.toUpperCase()+"</td><td>"+(FLAG_LABELS[f.type]||f.type)+"</td><td>"+f.sku+"</td><td>"+(f.desc||"--")+"</td><td>"+f.source+"</td><td>"+f.detail+"</td><td>"+f.affectedWOs.join(", ")+"</td></tr>").join(""); triggerDownload(buildExportHTML("Data Flags Report", th, tb), "data_flags_"+new Date().toISOString().slice(0,10)+".html", "text/html"); };

  /* ====== TIMELINE ====== */
  var timelineData = useMemo(() => {
    if (!edrData || !edrData.length || !analysis) return null;
    var edrCols = Object.keys(edrData[0]);
    var findCol = cands => edrCols.find(c => cands.some(p => normalizeStr(c).includes(p)));
    var colMat = findCol(["material"]) || findCol(["sku","itemcode"]);
    var colDesc = findCol(["shorttext","matdesc","desc"]);
    var colDate = findCol(["deliverydate","delivery"]) || findCol(["reqdely"]);
    var colPO = findCol(["purchasingdocument","purchasedoc","ponumber"]);
    var colQtyOpen = findCol(["stilltobedelivered","openqty","stillto"]);
    var colQtyOrd = findCol(["orderquantity","orderqty"]);
    var colTab = "__edrTab";
    if (!colMat || !colDate) return null;
    var dockByPO = {};
    if (dockData && dockData.length) {
      var dC = Object.keys(dockData[0]); var dPO = dC.find(c=>normalizeStr(c)==="po") || dC.find(c=>normalizeStr(c).includes("po")); var dSt = dC.find(c=>normalizeStr(c)==="status"); var dDt = dC.find(c=>normalizeStr(c).includes("apptdate")); var dTm = dC.find(c=>normalizeStr(c).includes("appttime"));
      if (dPO) dockData.forEach(row => { var po = (row[dPO]||"").toString().trim(); if (!po) return; if (!dockByPO[po]) dockByPO[po] = []; dockByPO[po].push({ status:(row[dSt]||"").toString().trim(), apptDate:(row[dDt]||"").toString().trim() }); });
    }
    var deliveries = [];
    edrData.forEach(row => {
      var mat = (row[colMat]||"").toString().trim(); var desc = colDesc ? (row[colDesc]||"").toString().trim() : "";
      var rawDate = row[colDate]; var po = colPO ? (row[colPO]||"").toString().trim() : "";
      var qtyOpen = colQtyOpen ? safeNum(row[colQtyOpen]) : 0; var qtyOrd = colQtyOrd ? safeNum(row[colQtyOrd]) : 0;
      var tab = row[colTab] || "";
      if (!mat || !rawDate) return; var qty = qtyOpen > 0 ? qtyOpen : qtyOrd; if (qty <= 0) return;
      var dateObj; if (rawDate instanceof Date) dateObj = rawDate; else { dateObj = new Date(rawDate); if (isNaN(dateObj)) return; }
      var dateStr = dateObj.toISOString().slice(0,10);
      var dockAppts = dockByPO[po] || [];
      var bestDock = dockAppts.length > 0 ? dockAppts.sort((a,b) => { var o = {Completed:0,Arrived:1,Scheduled:2,Cancelled:3}; return (o[a.status]||9)-(o[b.status]||9); })[0] : null;
      deliveries.push({ sku:mat, skuNorm:normalizeStr(mat), desc:desc, date:dateStr, dateObj:dateObj, qty:qty, po:po, tab:tab, dockStatus:bestDock?bestDock.status:"", qtyOrd:qtyOrd });
    });
    if (!deliveries.length) return null;
    var compToFG = {};
    analysis.results.forEach(wo => {
      wo.components.forEach(comp => {
        var norm = normalizeStr(comp.sku); if (!compToFG[norm]) compToFG[norm] = [];
        compToFG[norm].push({ woNum:wo.woNum, productSku:wo.productSkuRaw, productDesc:wo.productDesc, needed:comp.needed, short:comp.short, qtyToProduce:wo.qtyToProduce });
        if (comp.optionDetails) comp.optionDetails.forEach(opt => { var on = normalizeStr(opt.sku); if (on !== norm) { if (!compToFG[on]) compToFG[on]=[]; compToFG[on].push({ woNum:wo.woNum, productSku:wo.productSkuRaw, productDesc:wo.productDesc, needed:comp.needed, short:comp.short, qtyToProduce:wo.qtyToProduce }); } });
      });
    });
    var byMaterial = {};
    deliveries.forEach(d => { if (!byMaterial[d.skuNorm]) byMaterial[d.skuNorm] = { sku:d.sku, desc:d.desc, deliveries:[], affectedWOs:compToFG[d.skuNorm]||[] }; byMaterial[d.skuNorm].deliveries.push(d); });
    var today = new Date().toISOString().slice(0,10);
    var allDO = deliveries.map(d => d.dateObj); var minD = new Date(Math.min(...allDO, Date.now())); var maxD = new Date(Math.max(...allDO, Date.now()));
    minD.setDate(minD.getDate()-1); maxD.setDate(maxD.getDate()+3);
    var days = []; var cursor = new Date(minD); while (cursor <= maxD) { days.push(cursor.toISOString().slice(0,10)); cursor.setDate(cursor.getDate()+1); }
    var woTimelines = analysis.results.map(wo => {
      var cd = []; wo.components.forEach(comp => { if (comp.short <= 0) return; var allS = [normalizeStr(comp.sku)]; if (comp.optionDetails) comp.optionDetails.forEach(o => allS.push(normalizeStr(o.sku)));
      [...new Set(allS)].forEach(sn => { var md = byMaterial[sn]; if (md) md.deliveries.forEach(d => { cd.push(Object.assign({}, d, { componentSku:comp.sku, short:comp.short, needed:comp.needed })); }); }); });
      var dueDateStr = ""; if (wo.dueDate) { var p = new Date(wo.dueDate); if (!isNaN(p)) dueDateStr = p.toISOString().slice(0,10); }
      var delByDate = {}; cd.forEach(d => { if (!delByDate[d.date]) delByDate[d.date] = { items:[], totalQty:0 }; delByDate[d.date].items.push(d); delByDate[d.date].totalQty += d.qty; });
      return { woNum:wo.woNum, productSku:wo.productSkuRaw, productDesc:wo.productDesc, qtyToProduce:wo.qtyToProduce, readiness:wo.readiness, runStatus:wo.runStatus, maxRunnable:wo.maxRunnable, dueDate:dueDateStr, hasDeliveries:cd.length>0, deliveries:cd, delByDate:delByDate, totalIncoming:cd.reduce((s,d)=>s+d.qty,0) };
    }).filter(w => w.hasDeliveries).sort((a,b) => (a.dueDate||"zzz").localeCompare(b.dueDate||"zzz"));
    return { days:days, today:today, woTimelines:woTimelines, deliveries:deliveries, byMaterial:byMaterial, totalDeliveries:deliveries.length, matchedToBOM:deliveries.filter(d=>(compToFG[d.skuNorm]||[]).length>0).length, withDockAppt:deliveries.filter(d=>d.dockStatus).length };
  }, [edrData, dockData, analysis]);

  /* ====== STYLE HELPERS ====== */
  var thC = active => ({ padding:"10px 14px", textAlign:"left", fontSize:12, fontWeight:600, fontFamily:sans, letterSpacing:0.6, color:active?C.accent:C.dim, borderBottom:"1px solid "+C.border, cursor:"pointer", userSelect:"none", whiteSpace:"nowrap", textTransform:"uppercase" });
  var thS = { padding:"10px 14px", textAlign:"left", fontSize:12, fontWeight:600, fontFamily:sans, letterSpacing:0.6, color:C.dim, borderBottom:"1px solid "+C.border, whiteSpace:"nowrap", textTransform:"uppercase" };
  var tdN = { padding:"10px 14px", fontSize:14, fontFamily:sans, color:C.text };
  var tdM = { padding:"10px 14px", fontSize:14, fontFamily:mono, color:C.text };
  var inp = { padding:"6px 12px", background:C.surface, border:"1px solid "+C.border, borderRadius:6, color:C.bright, fontFamily:sans, fontSize:14, outline:"none" };
  var sel = Object.assign({}, inp, { cursor:"pointer" });
  var pill = on => ({ padding:"4px 12px", borderRadius:16, border:"1px solid "+(on?C.accentLine:C.border), background:on?C.accentSoft:"transparent", color:on?C.accent:C.dim, fontFamily:sans, fontSize:14, fontWeight:500, cursor:"pointer", whiteSpace:"nowrap" });

  var SortTh = function(props) { return <th onClick={() => handleSort(props.field)} style={Object.assign({}, thC(sortField===props.field), props.style||{})}>{props.children}{sortField===props.field ? (sortDir==="asc" ? " \u2191" : " \u2193") : ""}</th>; };

  /* ====== WO ROW RENDERER ====== */
  var renderWORows = () => {
    if (filteredResults.length === 0) return <tr><td colSpan={16} style={{ padding:36, textAlign:"center", color:C.dim, fontSize:14 }}>No work orders match filters.</td></tr>;
    var out = [];
    filteredResults.forEach((wo, idx) => {
      var isX = expandedWO === wo.woNum + idx;
      out.push(
        <tr key={"r"+idx} onClick={() => setExpandedWO(isX ? null : wo.woNum + idx)} style={{ cursor:"pointer", borderBottom:"1px solid "+C.border, background:isX?C.raised:"transparent" }}
          onMouseEnter={e => { if (!isX) e.currentTarget.style.background = C.hover; }} onMouseLeave={e => { if (!isX) e.currentTarget.style.background = isX ? C.raised : "transparent"; }}>
          <td style={{ padding:"9px 6px", textAlign:"center", fontSize:13, color:C.dim }}>{isX ? "\u25BE" : "\u25B8"}</td>
          <td style={Object.assign({}, tdM, { fontWeight:600, color:C.bright })}>{wo.woNum}</td>
          <td style={tdM}>{wo.productSkuRaw}</td>
          <td style={Object.assign({}, tdN, { color:C.dim, maxWidth:140, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" })}>{wo.customer || "--"}</td>
          <td style={Object.assign({}, tdM, { color:C.bright })}>{wo.qtyToProduce.toLocaleString()}</td>
          <td style={Object.assign({}, tdM, { color:wo.unitsProduced>0?C.ok:C.dim })}>{wo.unitsProduced>0?wo.unitsProduced.toLocaleString():"--"}</td>
          <td style={Object.assign({}, tdM, { color:C.bright })}>{wo.unitsRemaining.toLocaleString()}</td>
          <td style={Object.assign({}, tdM, { fontWeight:600, color:wo.prodPct>=100?C.ok:wo.prodPct>=50?C.warn:wo.prodPct>0?C.accent:C.dim })}>{wo.prodPct > 0 ? wo.prodPct+"%" : "--"}</td>
          <td style={Object.assign({}, tdM, { fontWeight:600, color:wo.readiness>=100?C.ok:wo.readiness>=70?C.warn:C.bad })}>{wo.readiness < 0 ? <span style={{color:C.dim}}>--</span> : Math.round(wo.readiness)+"%"}</td>
          <td style={Object.assign({}, tdM, { fontWeight:600, color:wo.runStatus==="ready"?C.ok:wo.runStatus==="nobom"?C.dim:wo.maxRunnable>0?C.warn:C.bad })}>{wo.runStatus==="nobom" ? "--" : wo.maxRunnable.toLocaleString()}</td>
          <td style={Object.assign({}, tdM, { color:wo.estHours>0?C.bright:C.dim })}>{wo.estHours > 0 ? wo.estHours+"h" : "--"}</td>
          <td style={Object.assign({}, tdM, { color:C.text })}>{fmtDate(wo.dueDate)}</td>
          <td style={Object.assign({}, tdM, { color:C.dim, fontSize:12 })}>{fmtDate(wo.plannedStart)}</td>
          <td style={Object.assign({}, tdM, { color:C.dim, fontSize:12 })}>{fmtDate(wo.plannedEnd)}</td>
          <td style={tdN}><Dot status={wo.runStatus} />{wo.status ? <span style={{ marginLeft:6, fontSize:12, color:C.dim }}>{wo.status}</span> : ""}</td>
        </tr>
      );
      if (isX) {
        var details = [];
        if (wo.reference1) details.push(<div key="ref" style={{ fontSize:13, color:C.text, marginBottom:8 }}><span style={{ fontSize:12, fontWeight:600, color:C.dim, textTransform:"uppercase", letterSpacing:0.6, marginRight:6 }}>Notes</span>{wo.reference1}</div>);
        if (wo.unitsPerHour > 0 || wo.standardPeople > 0) details.push(<div key="ops" style={{ fontSize:13, color:C.dim, marginBottom:8, display:"flex", gap:16 }}>
          {wo.unitsPerHour > 0 && <span><span style={{ fontWeight:600, color:C.bright }}>{wo.unitsPerHour}</span> units/hr</span>}
          {wo.standardPeople > 0 && <span><span style={{ fontWeight:600, color:C.bright }}>{wo.standardPeople}</span> crew</span>}
          {wo.prodPct > 0 && <span><span style={{ fontWeight:600, color:wo.prodPct>=100?C.ok:C.accent }}>{wo.prodPct}%</span> complete</span>}
        </div>);
        if (wo.components.length > 0) details.push(
          <div key="bom">
            <div style={{ fontSize:12, fontWeight:600, color:C.accent, marginBottom:6, marginTop:4, textTransform:"uppercase", letterSpacing:0.8 }}>BOM - {wo.components.length} components</div>
            <table style={{ width:"100%", borderCollapse:"collapse" }}>
              <thead><tr>
                {["Component","Description","Qty/Unit","Needed","On Hand","Short","Fill %"].map(h => <th key={h} style={{ padding:"7px 10px", fontSize:13, fontWeight:600, fontFamily:sans, textTransform:"uppercase", letterSpacing:0.6, color:C.dim, textAlign:"left", borderBottom:"1px solid "+C.border }}>{h}</th>)}
              </tr></thead>
              <tbody>
                {wo.components.map((comp, ci) => {
                  var rows = [];
                  rows.push(
                    <tr key={"c"+ci} style={{ borderBottom:comp.hasSubs?"none":"1px solid "+C.border }}>
                      <td style={{ padding:"7px 10px", fontFamily:mono, fontSize:13, color:C.bright }}>{comp.sku}{comp.hasSubs && <span style={{ fontSize:13, color:C.accent, marginLeft:3 }}>+alt</span>}</td>
                      <td style={{ padding:"7px 10px", fontSize:13, color:C.dim, maxWidth:150, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{comp.desc || "--"}</td>
                      <td style={{ padding:"7px 10px", fontFamily:mono, fontSize:13, color:C.text }}>{comp.qtyPer}</td>
                      <td style={{ padding:"7px 10px", fontFamily:mono, fontSize:13, color:C.bright }}>{comp.needed.toLocaleString()}</td>
                      <td style={{ padding:"7px 10px", fontFamily:mono, fontSize:13, fontWeight:600, color:comp.onHand>=comp.needed?C.ok:C.bad }}>{comp.onHand.toLocaleString()}</td>
                      <td style={{ padding:"7px 10px", fontFamily:mono, fontSize:13, fontWeight:600, color:comp.short>0?C.bad:C.dim }}>{comp.short > 0 ? comp.short.toLocaleString() : "--"}</td>
                      <td style={{ padding:"7px 10px", fontFamily:mono, fontSize:13, fontWeight:500, color:comp.fillRate>=100?C.ok:comp.fillRate>=70?C.warn:C.bad }}>{Math.round(Math.min(comp.fillRate, 100))+"%"}</td>
                    </tr>
                  );
                  if (comp.hasSubs && comp.optionDetails) {
                    rows.push(
                      <tr key={"s"+ci}><td colSpan={7} style={{ padding:"0 8px 5px 20px", borderBottom:"1px solid "+C.border }}>
                        <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
                          {comp.optionDetails.map((opt, oi) => <span key={oi} style={{ fontSize:12, fontFamily:mono, color:C.dim }}>
                            <span style={{ color:opt.isSub?C.accent:C.ok, fontWeight:600, marginRight:2 }}>{opt.isSub ? "ALT" : "PRI"}</span>{opt.sku} = {opt.onHand.toLocaleString()}
                          </span>)}
                        </div>
                      </td></tr>
                    );
                  }
                  return rows;
                })}
              </tbody>
            </table>
          </div>
        );
        out.push(
          <tr key={"d"+idx}><td colSpan={16} style={{ padding:"0 12px 14px 36px", background:C.raised }}>
            {details}
          </td></tr>
        );
      }
    });
    return out;
  };

  /* ====== CI ROW RENDERER ====== */
  var renderCIRows = () => {
    if (criticalItems.length === 0) return <tr><td colSpan={8} style={{ padding:36, textAlign:"center", color:C.dim }}>All materials available.</td></tr>;
    var out = [];
    criticalItems.forEach((ci, idx) => {
      var isX = expandedWO === "ci-" + idx;
      out.push(
        <tr key={"ci"+idx} onClick={() => setExpandedWO(isX ? null : "ci-" + idx)} style={{ cursor:"pointer", borderBottom:"1px solid "+C.border, background:isX?C.raised:"transparent" }}
          onMouseEnter={e => { if (!isX) e.currentTarget.style.background = C.hover; }} onMouseLeave={e => { if (!isX) e.currentTarget.style.background = isX ? C.raised : "transparent"; }}>
          <td style={{ padding:"9px 6px", textAlign:"center", fontSize:13, color:C.dim }}>{isX ? "\u25BE" : "\u25B8"}</td>
          <td style={Object.assign({}, tdM, { fontWeight:600, color:C.bright })}>{ci.sku}</td>
          <td style={Object.assign({}, tdN, { color:C.dim, maxWidth:200, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" })}>{ci.desc || "--"}</td>
          <td style={Object.assign({}, tdM, { textAlign:"right", fontWeight:600, color:ci.isZeroStock?C.bad:C.warn })}>{Math.round(ci.onHand).toLocaleString()}</td>
          <td style={Object.assign({}, tdM, { textAlign:"right", fontWeight:600, color:C.bad })}>{Math.round(ci.totalShort).toLocaleString()}</td>
          <td style={Object.assign({}, tdM, { textAlign:"right", color:C.bright })}>{ci.affectedWOs.length}</td>
          <td style={Object.assign({}, tdM, { textAlign:"right", fontWeight:600, color:C.ok })}>{Math.round(ci.unlockedUnits).toLocaleString()}</td>
          <td style={tdN}><Dot status={ci.isZeroStock ? "blocked" : "partial"} /></td>
        </tr>
      );
      if (isX) {
        out.push(
          <tr key={"cd"+idx}><td colSpan={8} style={{ padding:"0 12px 14px 36px", background:C.raised }}>
            <div style={{ fontSize:12, fontWeight:600, color:C.accent, marginBottom:6, marginTop:10, textTransform:"uppercase", letterSpacing:0.8 }}>Affected Work Orders</div>
            <table style={{ width:"100%", borderCollapse:"collapse" }}>
              <thead><tr>
                {["WO#","Product","WO Qty","Needed","Short","Due"].map(h => <th key={h} style={{ padding:"7px 10px", fontSize:13, fontWeight:600, fontFamily:sans, textTransform:"uppercase", letterSpacing:0.6, color:C.dim, textAlign:"left", borderBottom:"1px solid "+C.border }}>{h}</th>)}
              </tr></thead>
              <tbody>
                {ci.affectedWOs.map((wo, wi) => <tr key={wi} style={{ borderBottom:"1px solid "+C.border }}>
                  <td style={{ padding:"7px 10px", fontFamily:mono, fontSize:13, fontWeight:600, color:C.bright }}>{wo.woNum}</td>
                  <td style={{ padding:"7px 10px", fontFamily:mono, fontSize:13, color:C.text }}>{wo.productSku}</td>
                  <td style={{ padding:"7px 10px", fontFamily:mono, fontSize:13, color:C.bright }}>{wo.qtyToProduce.toLocaleString()}</td>
                  <td style={{ padding:"7px 10px", fontFamily:mono, fontSize:13, color:C.text }}>{Math.round(wo.needed).toLocaleString()}</td>
                  <td style={{ padding:"7px 10px", fontFamily:mono, fontSize:13, fontWeight:600, color:C.bad }}>{Math.round(wo.short).toLocaleString()}</td>
                  <td style={{ padding:"7px 10px", fontFamily:mono, fontSize:13, color:C.text }}>{fmtDate(wo.dueDate)}</td>
                </tr>)}
              </tbody>
            </table>
          </td></tr>
        );
      }
    });
    return out;
  };

  /* ====== MAIN RENDER ====== */
  return (
    <div style={{ fontFamily:sans, background:C.bg, minHeight:"100vh", color:C.text }}>
      <style>{FONTS_CSS}</style>
      <header style={{ padding:"16px 28px", borderBottom:"1px solid "+C.border, display:"flex", alignItems:"center", justifyContent:"space-between", background:C.surface }}>
        <div>
          <h1 style={{ fontSize:18, fontWeight:700, color:C.bright, margin:0, fontFamily:sans, letterSpacing:-0.2 }}>PackPulse</h1>
          <span style={{ fontSize:13, color:C.dim }}>REV Copack</span>
        </div>
        <button onClick={() => setTheme(theme==="dark"?"light":"dark")} style={{ padding:"5px 12px", borderRadius:6, border:"1px solid "+C.border, background:"transparent", color:C.dim, fontFamily:sans, fontSize:13, cursor:"pointer" }}>
          {theme === "dark" ? "Light" : "Dark"}
        </button>
      </header>
      <main style={{ padding:"20px 28px", maxWidth:1440, margin:"0 auto" }}>

      {!mappingConfirmed && (<div>
        <div style={{ marginBottom:16 }}>
          <div style={{ fontSize:15, fontWeight:600, color:C.bright }}>Data Sources</div>
          <div style={{ fontSize:14, color:C.dim, marginTop:2 }}>Upload Inventory and Work Orders to begin.</div>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(230px, 1fr))", gap:8, marginBottom:20 }}>
          <FileUploader label="Inventory" uploaded={!!inventory} fileName={invFileName} onData={(d,n) => {setInventory(d);setInvFileName(n);setInvTimestamp(new Date());}} subtitle="Daily stock levels (.csv)" />
          <FileUploader label="Work Orders" uploaded={!!workOrders} fileName={woFileName} onData={(d,n) => {setWorkOrders(d);setWoFileName(n);setWoTimestamp(new Date());}} subtitle="Open work orders (.csv)" />
        </div>
        <div style={{ marginBottom:8 }}>
          <div style={{ fontSize:13, fontWeight:600, color:C.dim, textTransform:"uppercase", letterSpacing:1, marginBottom:8 }}>Optional</div>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(230px, 1fr))", gap:8, marginBottom:20 }}>
          <FileUploader label="Bill of Materials" uploaded={!!boms} fileName={bomFileName} onData={(d,n) => {setBoms(d);setBomFileName(n);setBomTimestamp(new Date());}} subtitle={boms ? ("Saved \u00b7 Re-upload to update") : "BOM structure (.csv, .xlsx)"} acceptTypes=".csv,.xlsx,.xls" />
          <FileUploader label="EDR" uploaded={!!edrData} fileName={edrFileName} onData={(d,n) => {setEdrData(d);setEdrFileName(n);setEdrTimestamp(new Date());}} subtitle="Inbound deliveries (.xlsx)" acceptTypes=".xlsx,.xls,.csv" parseWorkbook={parseEdrWorkbook} />
          <FileUploader label="OpenDock" uploaded={!!dockData} fileName={dockFileName} onData={(d,n) => {setDockData(d);setDockFileName(n);setDockTimestamp(new Date());}} subtitle="Dock appointments (.xlsx)" acceptTypes=".xlsx,.xls,.csv" />
          <FileUploader label="Purchase Order" uploaded={!!poData} fileName={poFileName} onData={(d,n) => {setPoData(d);setPoFileName(n);setPoTimestamp(new Date());var h=d&&d.length?Object.keys(d[0]):[]; setPoHeaders(h); setPoMapping(autoMapColumns(h,PO_PAT));}} subtitle="PO line items (.csv, .xlsx)" acceptTypes=".csv,.xlsx,.xls" />
        </div>
        {allUploaded && !analyzing && (
          <button onClick={() => { setAnalyzing(true); setTimeout(() => { setMappingConfirmed(true); setAnalyzing(false); }, 1500); }} disabled={!requiredMappingsMet} style={{ padding:"8px 24px", borderRadius:6, border:"none", background:requiredMappingsMet?C.accent:C.raised, color:requiredMappingsMet?"#fff":C.dim, fontFamily:sans, fontSize:15, fontWeight:600, cursor:requiredMappingsMet?"pointer":"not-allowed" }}>
            Analyze
          </button>
        )}
        {allUploaded && analyzing && (
          <div style={{ background:C.surface, border:"1px solid "+C.border, borderRadius:8, padding:"32px 20px", marginBottom:20, textAlign:"center" }}>
            <div style={{ display:"inline-block", width:28, height:28, border:"3px solid "+C.border, borderTopColor:C.accent, borderRadius:"50%", animation:"spin 0.8s linear infinite", marginBottom:12 }} />
            <div style={{ fontSize:16, fontWeight:600, color:C.bright }}>Analyzing</div>
            <div style={{ fontSize:14, color:C.dim, marginTop:4 }}>Mapping columns and processing data...</div>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        )}

        <div style={{ marginTop:28, borderTop:"1px solid "+C.border, paddingTop:24 }}>
          <div style={{ fontSize:15, fontWeight:700, color:C.bright, marginBottom:16 }}>How PackPulse Works</div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(280px, 1fr))", gap:16 }}>

            <div style={{ background:C.surface, border:"1px solid "+C.border, borderRadius:8, padding:"16px 18px" }}>
              <div style={{ fontSize:14, fontWeight:700, color:C.accent, marginBottom:6 }}>1. SKU Matching</div>
              <div style={{ fontSize:13, color:C.dim, lineHeight:1.6 }}>
                Each Work Order has a product SKU that PackPulse normalizes (lowercased, trimmed, special characters removed) and matches against your Inventory and BOM files. This means "114715", " 114715 ", and "114715.0" all match correctly.
              </div>
            </div>

            <div style={{ background:C.surface, border:"1px solid "+C.border, borderRadius:8, padding:"16px 18px" }}>
              <div style={{ fontSize:14, fontWeight:700, color:C.accent, marginBottom:6 }}>2. Material Readiness</div>
              <div style={{ fontSize:13, color:C.dim, lineHeight:1.6 }}>
                When a BOM is loaded, PackPulse explodes each Work Order into its component materials. It compares <span style={{ color:C.bright }}>Qty Needed</span> (BOM qty per unit Ã— order qty) against <span style={{ color:C.bright }}>On Hand</span> from Inventory. The lowest component fill rate becomes the WO's readiness %. <span style={{ color:C.bright }}>Can Make</span> shows the max units producible with current stock.
              </div>
            </div>

            <div style={{ background:C.surface, border:"1px solid "+C.border, borderRadius:8, padding:"16px 18px" }}>
              <div style={{ fontSize:14, fontWeight:700, color:C.accent, marginBottom:6 }}>3. Substitutes & Alternates</div>
              <div style={{ fontSize:13, color:C.dim, lineHeight:1.6 }}>
                BOMs can include substitute components. PackPulse groups primary and alternate materials together and pools their inventory â€” if the primary is short but an approved alternate has stock, the combined quantity is used for readiness calculations.
              </div>
            </div>

            <div style={{ background:C.surface, border:"1px solid "+C.border, borderRadius:8, padding:"16px 18px" }}>
              <div style={{ fontSize:14, fontWeight:700, color:C.accent, marginBottom:6 }}>4. Production Progress</div>
              <div style={{ fontSize:13, color:C.dim, lineHeight:1.6 }}>
                Work Order fields like <span style={{ color:C.bright }}>Units Produced</span>, <span style={{ color:C.bright }}>Units Remaining</span>, and <span style={{ color:C.bright }}>Standard Units/Hour</span> power the completion % and estimated run hours. Past-due detection compares due dates against today's date for WOs with remaining units.
              </div>
            </div>

            <div style={{ background:C.surface, border:"1px solid "+C.border, borderRadius:8, padding:"16px 18px" }}>
              <div style={{ fontSize:14, fontWeight:700, color:C.accent, marginBottom:6 }}>5. Column Auto-Detection</div>
              <div style={{ fontSize:13, color:C.dim, lineHeight:1.6 }}>
                PackPulse scans your column headers against known patterns (e.g., "Item Code" â†’ SKU, "Qty On Hand" â†’ stock level). If a column doesn't map correctly, use the <span style={{ color:C.bright }}>Settings</span> panel after analysis to manually adjust any field mapping.
              </div>
            </div>

            <div style={{ background:C.surface, border:"1px solid "+C.border, borderRadius:8, padding:"16px 18px" }}>
              <div style={{ fontSize:14, fontWeight:700, color:C.accent, marginBottom:6 }}>6. Optional Data Sources</div>
              <div style={{ fontSize:13, color:C.dim, lineHeight:1.6 }}>
                <span style={{ color:C.bright }}>BOM</span> â€” enables component-level readiness (saved between sessions). <span style={{ color:C.bright }}>EDR</span> â€” inbound delivery data for the Delivery Timeline. <span style={{ color:C.bright }}>OpenDock</span> â€” dock appointment statuses. <span style={{ color:C.bright }}>Purchase Order</span> â€” cross-checks PO line items against WOs to catch missing or mismatched orders.
              </div>
            </div>

          </div>
        </div>
      </div>)}

      {mappingConfirmed && analysis && summary && (<div>
        <input ref={invRefreshRef} type="file" accept=".csv" style={{display:"none"}} onChange={e => {handleRefreshFile("inv",e.target.files[0]);e.target.value="";}} />
        <input ref={bomRefreshRef} type="file" accept=".csv,.xlsx,.xls" style={{display:"none"}} onChange={e => {handleRefreshFile("bom",e.target.files[0]);e.target.value="";}} />
        <input ref={woRefreshRef} type="file" accept=".csv" style={{display:"none"}} onChange={e => {handleRefreshFile("wo",e.target.files[0]);e.target.value="";}} />
        <input ref={edrRefreshRef} type="file" accept=".xlsx,.xls,.csv" style={{display:"none"}} onChange={e => {handleRefreshFile("edr",e.target.files[0]);e.target.value="";}} />
        <input ref={dockRefreshRef} type="file" accept=".xlsx,.xls,.csv" style={{display:"none"}} onChange={e => {handleRefreshFile("dock",e.target.files[0]);e.target.value="";}} />

        <div style={{ display:"flex", gap:6, marginBottom:16, flexWrap:"wrap", alignItems:"center" }}>
          {[
            {k:"inv",l:"Inventory",ts:invTimestamp,cad:"daily",ref:() => window.__invR && window.__invR.click()},
            {k:"wo",l:"Work Orders",ts:woTimestamp,cad:"monthly",ref:() => window.__woR && window.__woR.click()},
            {k:"bom",l:"BOMs",ts:bomTimestamp,cad:"rare",ref:() => window.__bomR && window.__bomR.click()},
          ].concat(edrData ? [{k:"edr",l:"EDR",ts:edrTimestamp,cad:"monthly",ref:() => window.__edrR && window.__edrR.click()}] : [])
           .concat(dockData ? [{k:"dock",l:"OpenDock",ts:dockTimestamp,cad:"daily",ref:() => window.__dockR && window.__dockR.click()}] : [])
           .map(s => {
            var sl = staleLevel(s.ts, s.cad); var dc = sl==="fresh"?C.ok:sl==="stale"?C.warn:C.bad;
            return <button key={s.k} onClick={s.ref} style={{ display:"inline-flex", alignItems:"center", gap:5, padding:"4px 10px", borderRadius:6, border:"1px solid "+C.border, background:C.surface, cursor:"pointer", color:C.dim, fontFamily:sans, fontSize:13, fontWeight:500 }}>
              <span style={{ width:6, height:6, borderRadius:"50%", background:dc }} />{s.l} <span style={{ opacity:0.6 }}>{fmtTs(s.ts)}</span>
            </button>;
          })}
          <button onClick={() => setActiveView(activeView==="flags"?"workorders":"flags")} style={{ padding:"4px 10px", borderRadius:6, border:"1px solid "+(activeView==="flags"?C.accentLine:C.border), background:activeView==="flags"?C.accentSoft:"transparent", cursor:"pointer", color:activeView==="flags"?C.accent:C.dim, fontFamily:sans, fontSize:13 }}>Data Flags {analysis.flags?<span style={{ opacity:0.6 }}>{analysis.flags.length}</span>:""}</button>
          <button onClick={() => setShowSettings(!showSettings)} style={{ padding:"4px 10px", borderRadius:6, border:"1px solid "+(showSettings?C.accentLine:C.border), background:showSettings?C.accentSoft:"transparent", cursor:"pointer", color:showSettings?C.accent:C.dim, fontFamily:sans, fontSize:13 }}>Settings</button>
          <button onClick={() => { setMappingConfirmed(false); setActiveView("overview"); }} style={{ padding:"4px 10px", borderRadius:6, border:"1px solid "+C.border, background:"transparent", cursor:"pointer", color:C.dim, fontFamily:sans, fontSize:13 }}>Re-upload</button>
        </div>

        {showSettings && (
          <div style={{ position:"fixed", top:0, left:0, right:0, bottom:0, background:"rgba(0,0,0,0.5)", zIndex:100, display:"flex", alignItems:"center", justifyContent:"center" }} onClick={e => { if (e.target === e.currentTarget) setShowSettings(false); }}>
            <div style={{ background:C.surface, border:"1px solid "+C.border, borderRadius:10, padding:24, width:"90%", maxWidth:720, maxHeight:"80vh", overflowY:"auto" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
                <div>
                  <div style={{ fontSize:16, fontWeight:600, color:C.bright }}>Column Mapping</div>
                  <div style={{ fontSize:14, color:C.dim, marginTop:2 }}>Adjust how your file columns map to the analysis engine. <span style={{color:C.bad}}>*</span> = required</div>
                </div>
                <button onClick={() => setShowSettings(false)} style={{ padding:"4px 10px", borderRadius:6, border:"1px solid "+C.border, background:"transparent", cursor:"pointer", color:C.dim, fontFamily:sans, fontSize:14 }}>{"\u2715"}</button>
              </div>
              <ColumnMapper title="Inventory" headers={invHeaders} mapping={invMapping} onMappingChange={setInvMapping} fields={[{key:"sku",label:"Item / SKU",required:true},{key:"description",label:"Description"},{key:"qtyOnHand",label:"Qty On Hand",required:true}]} />
              {boms && <ColumnMapper title="Bill of Materials" headers={bomHeaders} mapping={bomMapping} onMappingChange={setBomMapping} fields={[{key:"bomId",label:"Finished Good",required:true},{key:"componentSku",label:"Component SKU",required:true},{key:"description",label:"Description"},{key:"qtyPer",label:"Qty Per",required:true},{key:"substituteFor",label:"Substitute For"},{key:"priority",label:"Priority"}]} />}
              <ColumnMapper title="Work Orders" headers={woHeaders} mapping={woMapping} onMappingChange={setWoMapping} fields={[{key:"woNumber",label:"WO Number",required:true},{key:"productSku",label:"Product SKU",required:true},{key:"qtyToProduce",label:"Qty to Produce",required:true},{key:"dueDate",label:"Due Date"},{key:"status",label:"Status"},{key:"customer",label:"Customer"},{key:"unitsProduced",label:"Units Produced"},{key:"unitsRemaining",label:"Units Remaining"},{key:"unitsPerHour",label:"Units/Hour"},{key:"standardPeople",label:"Crew Size"},{key:"plannedStart",label:"Planned Start"},{key:"plannedEnd",label:"Planned End"},{key:"reference1",label:"Reference / Notes"}]} />
              {poData && <ColumnMapper title="Purchase Order" headers={poHeaders} mapping={poMapping} onMappingChange={setPoMapping} fields={[{key:"material",label:"Material / SKU",required:true},{key:"description",label:"Description"},{key:"qty",label:"Quantity",required:true},{key:"unitPrice",label:"Unit Price"},{key:"poNumber",label:"PO Number"}]} />}
              <div style={{ display:"flex", justifyContent:"flex-end", marginTop:16 }}>
                <button onClick={() => setShowSettings(false)} style={{ padding:"8px 20px", borderRadius:6, border:"none", background:C.accent, color:"#fff", fontFamily:sans, fontSize:15, fontWeight:600, cursor:"pointer" }}>Done</button>
              </div>
            </div>
          </div>
        )}

        <div style={{ display:"flex", gap:1, marginBottom:16, background:C.surface, borderRadius:8, border:"1px solid "+C.border, width:"fit-content", overflow:"hidden" }}>
          {[{l:"Total",v:summary.total,c:C.bright},{l:"Ready",v:summary.ready,c:C.ok},{l:"Partial",v:summary.partial,c:C.warn},{l:"Blocked",v:summary.blocked,c:C.bad},{l:"No BOM",v:summary.nobom,c:C.accent}].map(s =>
            <div key={s.l} style={{ padding:"10px 18px", textAlign:"center", minWidth:70 }}>
              <div style={{ fontSize:22, fontWeight:700, fontFamily:mono, color:s.c, lineHeight:1 }}>{s.v}</div>
              <div style={{ fontSize:13, color:C.dim, marginTop:3, fontWeight:500, textTransform:"uppercase", letterSpacing:0.5 }}>{s.l}</div>
            </div>
          )}
        </div>

        <div style={{ display:"flex", gap:0, marginBottom:16, borderBottom:"1px solid "+C.border }}>
          {[{key:"overview",label:"Overview",count:overview&&overview.lateWOs.length>0?overview.lateWOs.length:null,alert:overview&&overview.lateWOs.length>0},{key:"workorders",label:"Work Orders",count:summary.total},{key:"criticalitems",label:"Critical Items",count:criticalItems.length}].concat(poCheck?[{key:"pocheck",label:"PO Check",count:poCheck.missing+poCheck.qtyMismatch,alert:poCheck.missing+poCheck.qtyMismatch>0}]:[]).concat(timelineData?[{key:"timeline",label:"Delivery Timeline",count:timelineData.woTimelines.length}]:[]).map(t =>
            <button key={t.key} onClick={() => setActiveView(t.key)} style={{ padding:"8px 16px", border:"none", fontFamily:sans, fontSize:14, fontWeight:500, cursor:"pointer", background:"transparent", color:activeView===t.key?C.bright:C.dim, borderBottom:activeView===t.key?"2px solid "+C.accent:"2px solid transparent", marginBottom:-1 }}>
              {t.label} {t.count != null && <span style={{ opacity:t.alert?1:0.45, fontSize:13, color:t.alert?C.bad:undefined }}>{t.alert?"\u26A0 ":""}{t.count}</span>}
            </button>
          )}
        </div>

        {activeView === "overview" && overview && (<div>
          <div style={{ display:"flex", gap:8, marginBottom:16, flexWrap:"wrap", alignItems:"center" }}>
            {["all"].concat(woStatuses).map(f => <button key={f} onClick={() => setOvWoStatus(f)} style={pill(ovWoStatus===f)}>{f==="all"?"All WO Status":f}</button>)}
            <span style={{ fontSize:13, color:C.dim, marginLeft:4 }}>Due from</span>
            <input type="date" value={ovDateFrom} onChange={e => setOvDateFrom(e.target.value)} style={Object.assign({}, inp, { width:140 })} />
            <span style={{ fontSize:13, color:C.dim }}>to</span>
            <input type="date" value={ovDateTo} onChange={e => setOvDateTo(e.target.value)} style={Object.assign({}, inp, { width:140 })} />
            {(ovWoStatus!=="all" || ovDateFrom || ovDateTo) && <button onClick={() => {setOvWoStatus("all");setOvDateFrom("");setOvDateTo("");}} style={Object.assign({}, pill(false), { fontSize:12, color:C.bad, borderColor:C.badLine })}>Clear</button>}
            <span style={{ fontSize:13, color:C.dim, marginLeft:4 }}>{overview.woCount} of {analysis.results.length} WOs{overview.noDueDate > 0 && ovDateFrom ? " ("+overview.noDueDate+" excluded \u2014 no due date)" : ""}</span>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(150px, 1fr))", gap:10, marginBottom:20 }}>
            {[
              {l:"Total Order Qty", v:overview.totalOrderQty.toLocaleString(), c:C.bright},
              {l:"Produced", v:overview.totalProduced.toLocaleString(), c:C.ok},
              {l:"Remaining", v:overview.totalRemaining.toLocaleString(), c:C.warn},
              {l:"Can Make", v:overview.totalCanMake.toLocaleString(), c:C.accent},
              {l:"Completion", v:overview.completionPct+"%", c:overview.completionPct>=80?C.ok:overview.completionPct>=50?C.warn:C.bad},
              {l:"Est Hours Left", v:overview.totalEstHours+"h", c:C.bright},
              {l:"Late WOs", v:overview.lateWOs.length, c:overview.lateWOs.length>0?C.bad:C.ok}
            ].map(s => <div key={s.l} style={{ background:C.surface, border:"1px solid "+C.border, borderRadius:8, padding:"14px 16px" }}>
              <div style={{ fontSize:24, fontWeight:700, fontFamily:mono, color:s.c, lineHeight:1 }}>{s.v}</div>
              <div style={{ fontSize:12, color:C.dim, marginTop:5, fontWeight:500, textTransform:"uppercase", letterSpacing:0.5 }}>{s.l}</div>
            </div>)}
          </div>

          {overview.byCustomer.length > 0 && (<div style={{ marginBottom:20 }}>
            <div style={{ fontSize:14, fontWeight:600, color:C.bright, marginBottom:10 }}>By Customer</div>
            <div style={{ background:C.surface, border:"1px solid "+C.border, borderRadius:8, overflow:"hidden" }}>
              <table style={{ width:"100%", borderCollapse:"collapse" }}>
                <thead><tr style={{ background:C.raised }}>
                  {["Customer","WOs","Order Qty","Produced","Remaining","Can Make","Complete","Late"].map(h =>
                    <th key={h} style={thS}>{h}</th>
                  )}
                </tr></thead>
                <tbody>
                  {overview.byCustomer.map((c, i) => {
                    var pct = c.orderQty > 0 ? Math.round(c.produced / c.orderQty * 100) : 0;
                    return <tr key={i} style={{ borderBottom:"1px solid "+C.border }}>
                      <td style={Object.assign({}, tdN, { fontWeight:600, color:C.bright })}>{c.name}</td>
                      <td style={Object.assign({}, tdM, { color:C.dim })}>{c.count}</td>
                      <td style={Object.assign({}, tdM, { color:C.bright })}>{c.orderQty.toLocaleString()}</td>
                      <td style={Object.assign({}, tdM, { color:C.ok })}>{c.produced.toLocaleString()}</td>
                      <td style={Object.assign({}, tdM, { color:C.warn })}>{c.remaining.toLocaleString()}</td>
                      <td style={Object.assign({}, tdM, { color:C.accent })}>{c.canMake.toLocaleString()}</td>
                      <td style={Object.assign({}, tdM, { fontWeight:600, color:pct>=80?C.ok:pct>=50?C.warn:pct>0?C.accent:C.dim })}>{pct+"%"}</td>
                      <td style={Object.assign({}, tdM, { fontWeight:600, color:c.late>0?C.bad:C.dim })}>{c.late > 0 ? c.late : "--"}</td>
                    </tr>;
                  })}
                </tbody>
              </table>
            </div>
          </div>)}

          {overview.lateWOs.length > 0 && (<div style={{ marginBottom:20 }}>
            <div onClick={() => setLateCollapsed(!lateCollapsed)} style={{ fontSize:14, fontWeight:600, color:C.bad, marginBottom:lateCollapsed?0:10, display:"flex", alignItems:"center", gap:8, cursor:"pointer", userSelect:"none" }}>
              <span style={{ fontSize:13, color:C.dim }}>{lateCollapsed ? "\u25B8" : "\u25BE"}</span>
              <span style={{ fontSize:16 }}>{"\u26A0"}</span> Past Due Work Orders ({overview.lateWOs.length})
            </div>
            {!lateCollapsed && <div style={{ background:C.surface, border:"1px solid "+C.badLine, borderRadius:8, overflow:"hidden" }}>
              <table style={{ width:"100%", borderCollapse:"collapse" }}>
                <thead><tr style={{ background:C.raised }}>
                  {["Days Late","WO#","Product","Customer","Order Qty","Remaining","Complete","Ready","Can Make","Due Date"].map(h =>
                    <th key={h} style={thS}>{h}</th>
                  )}
                </tr></thead>
                <tbody>
                  {overview.lateWOs.map((wo, i) => <tr key={i} style={{ borderBottom:"1px solid "+C.border }}>
                    <td style={Object.assign({}, tdM, { fontWeight:700, color:C.bad })}>{wo.daysLate}d</td>
                    <td style={Object.assign({}, tdM, { fontWeight:600, color:C.bright })}>{wo.woNum}</td>
                    <td style={tdM}>{wo.productSkuRaw}</td>
                    <td style={Object.assign({}, tdN, { color:C.dim })}>{wo.customer || "--"}</td>
                    <td style={Object.assign({}, tdM, { color:C.bright })}>{wo.qtyToProduce.toLocaleString()}</td>
                    <td style={Object.assign({}, tdM, { color:C.warn })}>{wo.unitsRemaining.toLocaleString()}</td>
                    <td style={Object.assign({}, tdM, { fontWeight:600, color:wo.prodPct>=100?C.ok:wo.prodPct>0?C.accent:C.dim })}>{wo.prodPct>0?wo.prodPct+"%":"--"}</td>
                    <td style={Object.assign({}, tdM, { fontWeight:600, color:wo.readiness>=100?C.ok:wo.readiness>=70?C.warn:C.bad })}>{wo.readiness<0?"--":Math.round(wo.readiness)+"%"}</td>
                    <td style={Object.assign({}, tdM, { fontWeight:600, color:wo.runStatus==="ready"?C.ok:wo.maxRunnable>0?C.warn:C.bad })}>{wo.runStatus==="nobom"?"--":wo.maxRunnable.toLocaleString()}</td>
                    <td style={Object.assign({}, tdM, { color:C.bad })}>{fmtDate(wo.dueDate)}</td>
                  </tr>)}
                </tbody>
              </table>
            </div>}
          </div>)}
        </div>)}

        {activeView === "workorders" && (<div>
          <div style={{ display:"flex", gap:6, marginBottom:12, flexWrap:"wrap", alignItems:"center" }}>
            <input type="text" placeholder="Search WO, SKU, customer, notes..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} style={Object.assign({}, inp, { width:220 })} />
            {["all","ready","partial","blocked","nobom"].map(f => <button key={f} onClick={() => setFilterStatus(f)} style={pill(filterStatus===f)}>{f==="all"?"All":f==="ready"?"Ready":f==="partial"?"Partial":f==="blocked"?"Blocked":"No BOM"}</button>)}
            {woStatuses.length > 1 && <select value={filterWoStatus} onChange={e => setFilterWoStatus(e.target.value)} style={Object.assign({}, sel, { fontSize:13 })}>
              <option value="all">All WO Status</option>
              {woStatuses.map(s => <option key={s} value={s}>{s}</option>)}
            </select>}
            {woCustomers.length > 1 && <select value={filterCustomer} onChange={e => setFilterCustomer(e.target.value)} style={Object.assign({}, sel, { fontSize:13 })}>
              <option value="all">All Customers</option>
              {woCustomers.map(s => <option key={s} value={s}>{s}</option>)}
            </select>}
            <div style={{ flex:1 }} />
            <button onClick={exportCSV} style={Object.assign({}, pill(false), { fontSize:13 })}>CSV</button>
            <button onClick={exportPDF} style={Object.assign({}, pill(false), { fontSize:13 })}>PDF</button>
          </div>
          <div style={{ background:C.surface, border:"1px solid "+C.border, borderRadius:8, overflow:"hidden" }}>
            <div style={{ overflowX:"auto" }}>
              <table style={{ width:"100%", borderCollapse:"collapse" }}>
                <thead><tr style={{ background:C.raised }}>
                  <th style={{ width:24, padding:"9px 6px", borderBottom:"1px solid "+C.border }} />
                  <SortTh field="woNum">WO#</SortTh>
                  <SortTh field="product">Product</SortTh>
                  <SortTh field="customer">Customer</SortTh>
                  <SortTh field="qty">Order Qty</SortTh>
                  <SortTh field="produced">Produced</SortTh>
                  <SortTh field="remaining">Remaining</SortTh>
                  <SortTh field="complete">Complete</SortTh>
                  <SortTh field="readiness">Ready</SortTh>
                  <SortTh field="maxRunnable">Can Make</SortTh>
                  <SortTh field="estHours">Est Hrs</SortTh>
                  <SortTh field="dueDate">Due</SortTh>
                  <SortTh field="plannedStart">Start</SortTh>
                  <SortTh field="plannedEnd">End</SortTh>
                  <SortTh field="status">WO Status</SortTh>
                </tr></thead>
                <tbody>{renderWORows()}</tbody>
              </table>
            </div>
          </div>
          <div style={{ marginTop:8, fontSize:13, color:C.dim }}>{filteredResults.length} of {analysis.results.length} work orders</div>
        </div>)}

        {activeView === "criticalitems" && (<div>
          <div style={{ display:"flex", gap:6, marginBottom:12, flexWrap:"wrap", alignItems:"center" }}>
            <input type="text" placeholder="Search..." value={ciSearch} onChange={e => setCiSearch(e.target.value)} style={Object.assign({}, inp, { width:200 })} />
            <span style={{ fontSize:13, color:C.dim }}><span style={{ color:C.bad, fontWeight:600 }}>{criticalItems.filter(i=>i.isZeroStock).length}</span> zero | <span style={{ color:C.warn, fontWeight:600 }}>{criticalItems.filter(i=>!i.isZeroStock).length}</span> low</span>
            <div style={{ flex:1 }} />
            <button onClick={exportCriticalCSV} style={Object.assign({}, pill(false), { fontSize:13 })}>CSV</button>
            <button onClick={exportCriticalPDF} style={Object.assign({}, pill(false), { fontSize:13 })}>PDF</button>
          </div>
          <div style={{ background:C.surface, border:"1px solid "+C.border, borderRadius:8, overflow:"hidden" }}>
            <div style={{ overflowX:"auto" }}>
              <table style={{ width:"100%", borderCollapse:"collapse" }}>
                <thead><tr style={{ background:C.raised }}>
                  <th style={{ width:24, padding:"9px 6px", borderBottom:"1px solid "+C.border }} />
                  {[{f:"sku",l:"Item"},{f:"desc",l:"Description"},{f:"onHand",l:"On Hand"},{f:"totalShort",l:"Short"},{f:"affectedWOs",l:"WOs"},{f:"unlockedUnits",l:"Units Unlocked"}].map(col =>
                    <th key={col.f} onClick={() => handleCiSort(col.f)} style={Object.assign({}, thC(ciSort===col.f), { textAlign:col.f==="sku"||col.f==="desc"?"left":"right" })}>
                      {col.l}{ciSort===col.f ? (ciSortDir==="asc" ? " \u2191" : " \u2193") : ""}
                    </th>
                  )}
                  <th style={thS}>Status</th>
                </tr></thead>
                <tbody>{renderCIRows()}</tbody>
              </table>
            </div>
          </div>
          <div style={{ marginTop:8, fontSize:13, color:C.dim }}>{criticalItems.length} critical items</div>
        </div>)}

        {activeView === "flags" && analysis.flags && (<div>
          <div style={{ display:"flex", gap:6, marginBottom:12, flexWrap:"wrap", alignItems:"center" }}>
            <input type="text" placeholder="Search SKU, description, WO..." value={flagSearch} onChange={e => setFlagSearch(e.target.value)} style={Object.assign({}, inp, { width:200 })} />
            <select value={flagFilterType} onChange={e => setFlagFilterType(e.target.value)} style={Object.assign({}, sel, { fontSize:13 })}>
              <option value="all">All types</option>
              <option value="missing-desc">Missing Description</option>
              <option value="not-in-inventory">Not in Inventory</option>
              <option value="no-bom">No BOM</option>
              <option value="fg-not-in-inventory">FG Not in Inventory</option>
              <option value="zero-stock">Zero Stock</option>
            </select>
            <select value={flagFilterSeverity} onChange={e => setFlagFilterSeverity(e.target.value)} style={Object.assign({}, sel, { fontSize:13 })}>
              <option value="all">All severity</option>
              <option value="bad">Error</option>
              <option value="warn">Warning</option>
            </select>
            <span style={{ fontSize:13, color:C.dim }}><span style={{ color:C.bad, fontWeight:600 }}>{analysis.flags.filter(f=>f.severity==="bad").length}</span> errors | <span style={{ color:C.warn, fontWeight:600 }}>{analysis.flags.filter(f=>f.severity==="warn").length}</span> warnings</span>
            {(flagSearch || flagFilterType!=="all" || flagFilterSeverity!=="all") && <button onClick={() => {setFlagSearch("");setFlagFilterType("all");setFlagFilterSeverity("all");}} style={Object.assign({}, pill(false), { fontSize:12, color:C.bad, borderColor:C.badLine })}>Clear</button>}
            <div style={{ flex:1 }} />
            <button onClick={exportFlagsCSV} style={Object.assign({}, pill(false), { fontSize:13 })}>CSV</button>
            <button onClick={exportFlagsPDF} style={Object.assign({}, pill(false), { fontSize:13 })}>PDF</button>
          </div>
          <div style={{ background:C.surface, border:"1px solid "+C.border, borderRadius:8, overflow:"hidden" }}>
            <div style={{ overflowX:"auto" }}>
              <table style={{ width:"100%", borderCollapse:"collapse" }}>
                <thead><tr style={{ background:C.raised }}>
                  {[{f:"severity",l:"Severity"},{f:"type",l:"Type"},{f:"sku",l:"SKU"},{f:"desc",l:"Description"},{f:"source",l:"Source"},{f:"detail",l:"Action Needed"},{f:"affectedWOs",l:"Affected WOs"}].map(col =>
                    <th key={col.f} onClick={() => handleFlagSort(col.f)} style={thC(flagSort===col.f)}>
                      {col.l}{flagSort===col.f ? (flagSortDir==="asc" ? " \u2191" : " \u2193") : ""}
                    </th>
                  )}
                </tr></thead>
                <tbody>
                  {filteredFlags.length === 0 && <tr><td colSpan={7} style={{ padding:36, textAlign:"center", color:C.dim, fontSize:14 }}>No data flags found. All clear!</td></tr>}
                  {filteredFlags.map(f => <tr key={f.id} style={{ borderBottom:"1px solid "+C.border }}>
                    <td style={tdN}><span style={{ fontSize:12, fontWeight:600, padding:"2px 8px", borderRadius:10, color:f.severity==="bad"?"#fff":C.warn, background:f.severity==="bad"?C.bad:C.warnSoft }}>{f.severity==="bad"?"ERROR":"WARN"}</span></td>
                    <td style={Object.assign({}, tdN, { fontSize:13, whiteSpace:"nowrap" })}>{FLAG_LABELS[f.type]||f.type}</td>
                    <td style={Object.assign({}, tdM, { fontWeight:600, color:C.bright })}>{f.sku}</td>
                    <td style={Object.assign({}, tdN, { color:C.dim, maxWidth:180, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" })}>{f.desc || "--"}</td>
                    <td style={Object.assign({}, tdN, { fontSize:13 })}>{f.source}</td>
                    <td style={Object.assign({}, tdN, { fontSize:13, color:C.text })}>{f.detail}</td>
                    <td style={Object.assign({}, tdN, { fontSize:13, color:f.affectedWOs.length?C.accent:C.dim })}>{f.affectedWOs.length ? f.affectedWOs.slice(0,3).join(", ")+(f.affectedWOs.length>3?" +"+String(f.affectedWOs.length-3)+" more":"") : "--"}</td>
                  </tr>)}
                </tbody>
              </table>
            </div>
          </div>
          <div style={{ marginTop:8, fontSize:13, color:C.dim }}>{filteredFlags.length} of {analysis.flags.length} flags</div>
        </div>)}

        {activeView === "pocheck" && poCheck && (<div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(140px, 1fr))", gap:10, marginBottom:20 }}>
            {[
              {l:"PO Lines", v:poCheck.totalLines, c:C.bright},
              {l:"Matched", v:poCheck.matched, c:C.ok},
              {l:"Qty Mismatch", v:poCheck.qtyMismatch, c:C.warn},
              {l:"Missing WO", v:poCheck.missing, c:poCheck.missing>0?C.bad:C.ok},
              {l:"PO Total Qty", v:poCheck.totalPOQty.toLocaleString(), c:C.bright},
              {l:"WO Total Qty", v:poCheck.totalWOQty.toLocaleString(), c:poCheck.totalWOQty>=poCheck.totalPOQty?C.ok:C.warn}
            ].map(s => <div key={s.l} style={{ background:C.surface, border:"1px solid "+C.border, borderRadius:8, padding:"14px 16px" }}>
              <div style={{ fontSize:24, fontWeight:700, fontFamily:mono, color:s.c, lineHeight:1 }}>{s.v}</div>
              <div style={{ fontSize:12, color:C.dim, marginTop:5, fontWeight:500, textTransform:"uppercase", letterSpacing:0.5 }}>{s.l}</div>
            </div>)}
          </div>
          {poCheck.poNum && <div style={{ fontSize:13, color:C.dim, marginBottom:12 }}>PO# <span style={{ fontWeight:600, color:C.bright }}>{poCheck.poNum}</span></div>}
          <div style={{ background:C.surface, border:"1px solid "+C.border, borderRadius:8, overflow:"hidden" }}>
            <table style={{ width:"100%", borderCollapse:"collapse" }}>
              <thead><tr style={{ background:C.raised }}>
                {["Status","Material","Description","PO Qty","WO Qty","Diff","WOs","Produced"].map(h =>
                  <th key={h} style={thS}>{h}</th>
                )}
              </tr></thead>
              <tbody>
                {poCheck.lines.map((ln, i) => {
                  var sc = ln.status==="matched"?C.ok:ln.status==="qty_mismatch"?C.warn:C.bad;
                  var sl = ln.status==="matched"?"\u2713 Matched":ln.status==="qty_mismatch"?"\u26A0 Qty Mismatch":"\u2717 Missing WO";
                  return <tr key={i} style={{ borderBottom:"1px solid "+C.border }}>
                    <td style={Object.assign({}, tdN, { fontWeight:600, color:sc, whiteSpace:"nowrap" })}>{sl}</td>
                    <td style={Object.assign({}, tdM, { fontWeight:600, color:C.bright })}>{ln.material}</td>
                    <td style={Object.assign({}, tdN, { color:C.dim, maxWidth:200, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" })}>{ln.description || "--"}</td>
                    <td style={Object.assign({}, tdM, { color:C.bright })}>{ln.poQty.toLocaleString()}</td>
                    <td style={Object.assign({}, tdM, { color:ln.woCount>0?C.bright:C.dim })}>{ln.woCount>0?ln.woTotalQty.toLocaleString():"--"}</td>
                    <td style={Object.assign({}, tdM, { fontWeight:600, color:ln.qtyDiff===0?C.dim:ln.qtyDiff>0?C.ok:C.bad })}>{ln.woCount>0?(ln.qtyDiff>0?"+":"")+ln.qtyDiff.toLocaleString():"--"}</td>
                    <td style={Object.assign({}, tdM, { color:C.dim })}>{ln.woCount>0?ln.woCount:"--"}</td>
                    <td style={Object.assign({}, tdM, { color:ln.woProduced>0?C.ok:C.dim })}>{ln.woProduced>0?ln.woProduced.toLocaleString():"--"}</td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
        </div>)}

        {activeView === "timeline" && timelineData && (<div>
          <div style={{ display:"flex", gap:20, marginBottom:16 }}>
            {[{l:"Inbound",v:timelineData.totalDeliveries,c:C.accent},{l:"BOM Matched",v:timelineData.matchedToBOM,c:C.ok},{l:"Dock Appts",v:timelineData.withDockAppt,c:C.bright},{l:"WOs Waiting",v:timelineData.woTimelines.length,c:C.warn}].map((s,i) =>
              <div key={i}><div style={{ fontSize:24, fontWeight:700, fontFamily:mono, color:s.c, lineHeight:1 }}>{s.v}</div><div style={{ fontSize:13, color:C.dim, marginTop:3, textTransform:"uppercase", letterSpacing:0.5 }}>{s.l}</div></div>
            )}
          </div>
          <div style={{ background:C.surface, border:"1px solid "+C.border, borderRadius:8, overflow:"hidden", marginBottom:16 }}>
            <div style={{ padding:"12px 16px", borderBottom:"1px solid "+C.border }}>
              <div style={{ fontSize:15, fontWeight:600, color:C.bright }}>Delivery Timeline</div>
            </div>
            <div style={{ overflowX:"auto" }}>
              <div style={{ minWidth:Math.max(800, timelineData.days.length*40 + 340), display:"flex", flexDirection:"column" }}>
                <div style={{ display:"flex", position:"sticky", top:0, zIndex:2, background:C.raised }}>
                  <div style={{ minWidth:320, padding:"6px 12px", fontSize:13, fontWeight:600, fontFamily:sans, textTransform:"uppercase", letterSpacing:0.6, color:C.dim, borderBottom:"1px solid "+C.border, flexShrink:0 }}>Work Order</div>
                  <div style={{ display:"flex", flex:1 }}>
                    {timelineData.days.map(day => {
                      var dt = new Date(day + "T12:00:00"); var isT = day === timelineData.today; var isW = dt.getDay()===0||dt.getDay()===6;
                      return <div key={day} style={{ minWidth:40, flex:"0 0 40px", textAlign:"center", padding:"3px 0", borderBottom:"1px solid "+(isT?C.accent:C.border), background:isT?C.accentSoft:isW?C.raised:"transparent" }}>
                        <div style={{ fontSize:12, fontFamily:sans, fontWeight:600, color:isT?C.accent:C.dim }}>{"SMTWTFS"[dt.getDay()]}</div>
                        <div style={{ fontSize:12, fontFamily:mono, fontWeight:isT?700:400, color:isT?C.accent:C.bright }}>{dt.getDate()}</div>
                        {(dt.getDate()===1||day===timelineData.days[0]) && <div style={{ fontSize:12, color:C.dim }}>{dt.toLocaleDateString("en-US",{month:"short"})}</div>}
                      </div>;
                    })}
                  </div>
                </div>
                {timelineData.woTimelines.map((wo, wI) => {
                  var sc = wo.runStatus==="ready"?C.ok:wo.runStatus==="partial"?C.warn:wo.runStatus==="nobom"?C.accent:C.bad;
                  return <div key={wI} style={{ display:"flex", borderBottom:"1px solid "+C.border, minHeight:46 }}>
                    <div style={{ minWidth:320, padding:"6px 12px", display:"flex", flexDirection:"column", justifyContent:"center", flexShrink:0, borderRight:"1px solid "+C.border }}>
                      <div style={{ display:"flex", alignItems:"center", gap:5 }}>
                        <span style={{ fontSize:13, fontWeight:600, fontFamily:mono, color:C.bright }}>{wo.woNum}</span>
                        <span style={{ width:6, height:6, borderRadius:"50%", background:sc }} />
                      </div>
                      <div style={{ fontSize:12, color:C.dim, marginTop:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", maxWidth:290 }}>{wo.productSku} | {wo.productDesc||""}</div>
                      <div style={{ fontSize:13, color:C.dim, fontFamily:mono, marginTop:1 }}>{"Need "+wo.qtyToProduce.toLocaleString()+" | Can make "+wo.maxRunnable.toLocaleString()+" | +"+wo.totalIncoming.toLocaleString()+" incoming"}</div>
                    </div>
                    <div style={{ display:"flex", flex:1 }}>
                      {timelineData.days.map(day => {
                        var dt = new Date(day+"T12:00:00"); var isT = day===timelineData.today; var isW = dt.getDay()===0||dt.getDay()===6; var isDue = day===wo.dueDate;
                        var dd = wo.delByDate[day]; var badge = null;
                        if (dd) { var sts = dd.items.map(d=>d.dockStatus).filter(Boolean); var bg = sts.includes("Completed")?C.ok:sts.includes("Scheduled")?C.accent:sts.includes("Cancelled")?C.bad:C.dim; var ic = sts.includes("Completed")?"\u2713":sts.includes("Scheduled")?"\u25C9":sts.includes("Cancelled")?"\u2717":"\u25CF"; badge = { bg:bg, ic:ic }; }
                        return <div key={day} style={{ minWidth:40, flex:"0 0 40px", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:1, background:isDue?C.badSoft:isT?C.accentSoft:isW?C.raised:"transparent", borderLeft:isDue?"2px solid "+C.bad:isT?"2px solid "+C.accent:"none" }}>
                          {dd && <div title={dd.items.map(d => d.sku+": "+d.qty.toLocaleString()+" ("+(d.dockStatus||"pending")+")").join("\n")} style={{ fontSize:14, fontFamily:mono, fontWeight:700, color:"#fff", background:badge?badge.bg:C.dim, borderRadius:3, padding:"2px 4px", lineHeight:1.3, textAlign:"center", minWidth:30, cursor:"default" }}>
                            {dd.totalQty >= 1000 ? (dd.totalQty/1000).toFixed(1)+"k" : dd.totalQty}
                          </div>}
                          {isDue && <div style={{ fontSize:12, fontWeight:700, color:C.bad }}>DUE</div>}
                        </div>;
                      })}
                    </div>
                  </div>;
                })}
              </div>
            </div>
            <div style={{ padding:"8px 16px", borderTop:"1px solid "+C.border, display:"flex", gap:14, flexWrap:"wrap" }}>
              {[{bg:C.dim,l:"Pending"},{bg:C.accent,l:"Scheduled"},{bg:C.ok,l:"Received"},{bg:C.bad,l:"Cancelled"}].map((x,i) =>
                <span key={i} style={{ fontSize:12, color:C.dim, display:"flex", alignItems:"center", gap:3 }}><span style={{ width:7, height:7, borderRadius:2, background:x.bg }} />{x.l}</span>
              )}
            </div>
          </div>

          {/* Material Summary */}
          {(function() {
            var matRows = Object.entries(timelineData.byMaterial).map(function(entry) {
              var sn = entry[0]; var item = entry[1];
              var dels = item.deliveries; var totalOpen = dels.reduce(function(s,d){return s+d.qty},0); var tab = dels[0] ? dels[0].tab : "";
              var ds = {}; dels.forEach(function(d) { if (d.dockStatus) ds[d.dockStatus] = (ds[d.dockStatus]||0)+1; });
              var dockSummary = Object.entries(ds).map(function(e){return e[1]+" "+e[0]}).join(", ");
              var pd = dels.some(function(d){return d.dockStatus==="Completed"})?"Completed":dels.some(function(d){return d.dockStatus==="Scheduled"})?"Scheduled":dels.some(function(d){return d.dockStatus==="Cancelled"})?"Cancelled":"None";
              var uWOs = Array.from(new Set(item.affectedWOs.map(function(w){return w.woNum})));
              return { sn:sn, sku:item.sku, desc:item.desc, tab:tab, delCount:dels.length, totalOpen:totalOpen, dockSummary:dockSummary, pd:pd, uWOs:uWOs, woC:uWOs.length };
            });
            var f = matRows.slice();
            if (matSearch) { var q = matSearch.toLowerCase(); f = f.filter(function(r) { return r.sku.toLowerCase().includes(q) || (r.desc||"").toLowerCase().includes(q) || r.uWOs.some(function(w){return w.toLowerCase().includes(q)}); }); }
            if (matFilterTab !== "all") f = f.filter(function(r){return r.tab===matFilterTab});
            if (matFilterDock !== "all") { if (matFilterDock==="none") f=f.filter(function(r){return r.pd==="None"}); else f=f.filter(function(r){return r.pd===matFilterDock}); }
            if (matFilterWO !== "all") { if (matFilterWO==="matched") f=f.filter(function(r){return r.woC>0}); else f=f.filter(function(r){return r.woC===0}); }
            f.sort(function(a,b) { var c=0; if(matSort==="material")c=a.sku.localeCompare(b.sku); else if(matSort==="description")c=(a.desc||"").localeCompare(b.desc||""); else if(matSort==="tab")c=a.tab.localeCompare(b.tab); else if(matSort==="deliveries")c=a.delCount-b.delCount; else if(matSort==="openQty")c=a.totalOpen-b.totalOpen; else if(matSort==="dockStatus")c=a.pd.localeCompare(b.pd); else if(matSort==="affectedWOs")c=a.woC-b.woC; return matSortDir==="desc"?-c:c; });
            var hMS = function(col) { if (matSort===col) setMatSortDir(function(d){return d==="asc"?"desc":"asc"}); else { setMatSort(col); setMatSortDir("desc"); } };
            var cols = [{k:"material",l:"Material"},{k:"description",l:"Description"},{k:"tab",l:"Tab"},{k:"deliveries",l:"Deliveries"},{k:"openQty",l:"Open Qty"},{k:"dockStatus",l:"Dock"},{k:"affectedWOs",l:"WOs"}];
            var hasF = matSearch || matFilterTab!=="all" || matFilterDock!=="all" || matFilterWO!=="all";
            return <div style={{ background:C.surface, border:"1px solid "+C.border, borderRadius:8, overflow:"hidden" }}>
              <div style={{ padding:"12px 16px", borderBottom:"1px solid "+C.border, display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:8 }}>
                <div>
                  <div style={{ fontSize:15, fontWeight:600, color:C.bright }}>Inbound Materials</div>
                  <div style={{ fontSize:13, color:C.dim, marginTop:1 }}>{f.length} of {matRows.length} materials</div>
                </div>
                <div style={{ display:"flex", gap:5, flexWrap:"wrap", alignItems:"center" }}>
                  <input value={matSearch} onChange={function(e){setMatSearch(e.target.value)}} placeholder="Search..." style={Object.assign({}, inp, { width:130, fontSize:13 })} />
                  <select value={matFilterTab} onChange={function(e){setMatFilterTab(e.target.value)}} style={Object.assign({}, sel, { fontSize:13 })}><option value="all">All tabs</option><option value="FG">FG</option><option value="RM">RM</option></select>
                  <select value={matFilterDock} onChange={function(e){setMatFilterDock(e.target.value)}} style={Object.assign({}, sel, { fontSize:13 })}><option value="all">All dock</option><option value="Completed">Completed</option><option value="Scheduled">Scheduled</option><option value="Cancelled">Cancelled</option><option value="none">No appt</option></select>
                  <select value={matFilterWO} onChange={function(e){setMatFilterWO(e.target.value)}} style={Object.assign({}, sel, { fontSize:13 })}><option value="all">All WO</option><option value="matched">Has WO</option><option value="unmatched">No WO</option></select>
                  {hasF && <button onClick={function(){setMatSearch("");setMatFilterTab("all");setMatFilterDock("all");setMatFilterWO("all");}} style={Object.assign({}, pill(false), { fontSize:12, color:C.bad, borderColor:C.badLine })}>Clear</button>}
                </div>
              </div>
              <div style={{ overflowX:"auto" }}>
                <table style={{ width:"100%", borderCollapse:"collapse" }}>
                  <thead><tr style={{ background:C.raised }}>
                    {cols.map(function(col) { return <th key={col.k} onClick={function(){hMS(col.k)}} style={thC(matSort===col.k)}>{col.l}{matSort===col.k?(matSortDir==="asc"?" \u2191":" \u2193"):""}</th>; })}
                  </tr></thead>
                  <tbody>
                    {f.map(function(r,i) { return <tr key={i} style={{ borderBottom:"1px solid "+C.border }}>
                      <td style={Object.assign({}, tdM, { fontWeight:600, color:C.bright })}>{r.sku}</td>
                      <td style={Object.assign({}, tdN, { color:C.dim, maxWidth:180, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" })}>{r.desc||"--"}</td>
                      <td style={tdN}><span style={{ fontSize:12, fontWeight:500, padding:"1px 7px", borderRadius:10, color:r.tab==="FG"?C.accent:C.warn, background:r.tab==="FG"?C.accentSoft:C.warnSoft }}>{r.tab||"--"}</span></td>
                      <td style={Object.assign({}, tdM, { color:C.bright })}>{r.delCount}</td>
                      <td style={Object.assign({}, tdM, { fontWeight:600, color:C.ok })}>{r.totalOpen.toLocaleString()}</td>
                      <td style={Object.assign({}, tdN, { fontSize:13, color:r.dockSummary?C.bright:C.dim })}>{r.dockSummary||"--"}</td>
                      <td style={Object.assign({}, tdN, { fontSize:13, color:r.woC?C.accent:C.dim })}>{r.woC ? r.uWOs.join(", ") : "--"}</td>
                    </tr>; })}
                    {f.length===0 && <tr><td colSpan={7} style={{ padding:24, textAlign:"center", color:C.dim }}>No materials match filters</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>;
          })()}
        </div>)}

      </div>)}
      </main>
    </div>
  );
}
