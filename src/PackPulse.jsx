import { useState, useCallback, useEffect } from "react";
import NulogySync from "./NulogySync";
import { useTheme } from "./theme";
import { autoMapColumns, PO_PAT } from "./utils";
import { useStyles } from "./hooks/useStyles";
import { useDataSources } from "./hooks/useDataSources";
import { useAnalysis } from "./hooks/useAnalysis";
import ColumnMapper from "./components/ColumnMapper";
import FileUploader from "./components/FileUploader";
import OverviewView from "./views/OverviewView";
import WorkOrdersView from "./views/WorkOrdersView";
import CriticalItemsView from "./views/CriticalItemsView";
import FlagsView from "./views/FlagsView";
import POCheckView from "./views/POCheckView";
import TimelineView from "./views/TimelineView";

export default function ProductionReadiness() {
  const { C, theme, setTheme, sans, mono, FONTS_CSS, A11Y_CSS } = useTheme();
  const { pill } = useStyles();
  const ds = useDataSources();
  const { analysis, summary, criticalItems, woStatuses, woCustomers, poCheck, timelineData } = useAnalysis({
    mappingConfirmed: ds.mappingConfirmed, allUploaded: ds.allUploaded,
    inventory: ds.inventory, boms: ds.boms, workOrders: ds.workOrders,
    invMapping: ds.invMapping, bomMapping: ds.bomMapping, woMapping: ds.woMapping,
    poData: ds.poData, poMapping: ds.poMapping, edrData: ds.edrData, dockData: ds.dockData,
  });

  const [activeView, setActiveView] = useState("overview");
  const [showSettings, setShowSettings] = useState(false);
  const [showDataSetup, setShowDataSetup] = useState(false);
  const [autoBootstrapEnabled, setAutoBootstrapEnabled] = useState(true);
  const [syncNonce, setSyncNonce] = useState(0);
  const [nulogySyncState, setNulogySyncState] = useState(null);
  const [autoDockAttempted, setAutoDockAttempted] = useState(false);
  const [dockApiLoading, setDockApiLoading] = useState(false);
  const [dockApiError, setDockApiError] = useState("");
  const [dockApiInfo, setDockApiInfo] = useState("");

  var showAutoBootstrap = autoBootstrapEnabled;

  var fmtTs = ts => { if (!ts) return "--"; var d = Date.now() - ts; return d < 60000 ? "now" : d < 3600000 ? Math.floor(d/60000) + "m" : d < 86400000 ? Math.floor(d/3600000) + "h" : Math.floor(d/86400000) + "d"; };
  var staleLevel = (ts, cad) => { if (!ts) return "stale"; var h = (Date.now()-ts)/3600000; if (cad==="daily") return h<8?"fresh":h<24?"stale":"old"; if (cad==="rare") return h<720?"fresh":"stale"; return h<168?"fresh":"stale"; };

  var fetchOpenDockApi = useCallback(async () => {
    setDockApiLoading(true);
    setDockApiError("");
    setDockApiInfo("");
    try {
      var resp = await fetch("/api/opendock/appointments");
      var body = await resp.json();
      if (!resp.ok) {
        throw new Error(body && body.error ? body.error : "OpenDock API request failed");
      }
      var rows = body && Array.isArray(body.rows) ? body.rows : [];
      ds.setDockData(rows);
      ds.setDockFileName("OpenDock API");
      ds.setDockTimestamp(new Date());
      setDockApiInfo((body && body.message) || ("Loaded " + rows.length + " appointments"));
    } catch (err) {
      setDockApiError(err && err.message ? err.message : "Could not load OpenDock data");
    } finally {
      setDockApiLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!showAutoBootstrap || autoDockAttempted) return;
    setAutoDockAttempted(true);
    fetchOpenDockApi();
  }, [showAutoBootstrap, autoDockAttempted, fetchOpenDockApi]);

  var handleNulogyData = useCallback(function(results) {
    var ts = new Date();
    if (results.inventory) {
      ds.setInventory(results.inventory.data);
      ds.setInvFileName("Nulogy Sync");
      ds.setInvTimestamp(ts);
    }
    if (results.workorders) {
      ds.setWorkOrders(results.workorders.data);
      ds.setWoFileName("Nulogy Sync");
      ds.setWoTimestamp(ts);
    }
    if (results.bom) {
      ds.setBoms(results.bom.data);
      ds.setBomFileName("Nulogy Sync");
      ds.setBomTimestamp(ts);
    }
    // Auto-analyze if we got at least inventory + work orders
    if (results.inventory && results.workorders) {
      ds.setAnalyzing(true);
      setTimeout(function() {
        ds.setMappingConfirmed(true);
        ds.setAnalyzing(false);
        setShowDataSetup(false);
        setTimeout(function() {
          var el = document.getElementById("dashboard-main");
          if (el && el.scrollIntoView) el.scrollIntoView({ behavior:"smooth", block:"start" });
        }, 0);
      }, 1500);
    }
  }, []);
  var analysisForUI = analysis || { results:[], flags:[], diagnostics:{} };
  var summaryForUI = summary || { total:0, ready:0, partial:0, blocked:0, nobom:0 };
  var criticalItemsForUI = criticalItems || [];
  var woStatusesForUI = woStatuses || [];
  var woCustomersForUI = woCustomers || [];
  var syncProgress = (() => {
    var reportStates = nulogySyncState && nulogySyncState.reportStates ? nulogySyncState.reportStates : null;
    var steps = [
      { key:"inventory", label:"Inventory" },
      { key:"workorders", label:"Work Orders" },
      { key:"bom", label:"BOM" },
      { key:"opendock", label:"OpenDock API", synthetic:true }
    ];
    var done = 0;
    var active = [];
    var errors = 0;
    steps.forEach(function(step) {
      if (step.synthetic) {
        if (dockApiLoading) active.push("Loading OpenDock API...");
        else if (ds.dockData && ds.dockData.length) done++;
        if (dockApiError) errors++;
        return;
      }
      var st = reportStates && reportStates[step.key] ? reportStates[step.key] : null;
      if (!st) return;
      if (st.status === "done") done++;
      else if (st.status === "error") errors++;
      else if (st.status && st.status !== "idle") active.push(step.label + (st.progress ? ": " + st.progress : ""));
    });
    var total = steps.length;
    var pct = Math.max(0, Math.min(100, Math.round(done / total * 100)));
    return {
      total: total,
      done: done,
      errors: errors,
      pct: pct,
      activeText: active.length ? active[0] : (done >= total ? "Sync complete." : "Waiting to start...")
    };
  })();
  var showSyncBanner = showAutoBootstrap && (
    !ds.mappingConfirmed ||
    dockApiLoading ||
    (nulogySyncState && nulogySyncState.syncing) ||
    dockApiError ||
    (nulogySyncState && nulogySyncState.errorCount > 0)
  );
  useEffect(() => {
    if (!ds.mappingConfirmed || !showDataSetup) return;
    setShowDataSetup(false);
  }, [ds.mappingConfirmed, showDataSetup]);
  var goToDashboard = function() {
    setShowDataSetup(false);
    setTimeout(function() {
      var el = document.getElementById("dashboard-main");
      if (el && el.scrollIntoView) el.scrollIntoView({ behavior:"smooth", block:"start" });
    }, 0);
  };

  /* ====== MAIN RENDER ====== */
  return (
    <div style={{ fontFamily:sans, background:C.bg, minHeight:"100vh", color:C.text }}>
      <style>{FONTS_CSS + A11Y_CSS}</style>
      <header style={{ padding:"16px 28px", borderBottom:"1px solid "+C.border, display:"flex", alignItems:"center", justifyContent:"space-between", background:C.surface }}>
        <div>
          <h1 style={{ fontSize:18, fontWeight:700, color:C.bright, margin:0, fontFamily:sans, letterSpacing:-0.2 }}>PackPulse</h1>
          <span style={{ fontSize:13, color:C.dim }}>REV Copack</span>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          {window.__ppUser && <span style={{ fontSize:13, color:C.dim }}>{window.__ppUser.email}</span>}
          {window.__ppLogout && <button onClick={window.__ppLogout} style={{ padding:"5px 12px", borderRadius:6, border:"1px solid "+C.border, background:"transparent", color:C.dim, fontFamily:sans, fontSize:13, cursor:"pointer" }}>Sign out</button>}
          <button onClick={() => setTheme(theme==="dark"?"light":"dark")} style={{ padding:"5px 12px", borderRadius:6, border:"1px solid "+C.border, background:"transparent", color:C.dim, fontFamily:sans, fontSize:13, cursor:"pointer" }}>
            {theme === "dark" ? "Light" : "Dark"}
          </button>
        </div>
      </header>
      <main style={{ padding:"20px 28px", maxWidth:1440, margin:"0 auto" }}>
      {showAutoBootstrap && (
        <NulogySync
          key={"auto-sync-" + syncNonce}
          onDataLoaded={handleNulogyData}
          theme={C}
          autoStart
          hideToggle
          silent
          onSyncStateChange={setNulogySyncState}
        />
      )}

      {(showDataSetup || (!ds.mappingConfirmed && !showAutoBootstrap)) && (<div>
        <div style={{ marginBottom:12, display:"flex", alignItems:"center", justifyContent:"space-between", gap:10, flexWrap:"wrap" }}>
          <div style={{ fontSize:12, color:C.dim }}>
            Dashboard / <span style={{ color:C.bright, fontWeight:600 }}>Data Setup</span>
          </div>
          <button onClick={goToDashboard} style={{ padding:"6px 12px", borderRadius:6, border:"1px solid "+C.border, background:"transparent", color:C.dim, fontFamily:sans, fontSize:13, cursor:"pointer" }}>
            Back to Dashboard
          </button>
        </div>
        {showAutoBootstrap && !showDataSetup && (
          <div style={{ marginBottom:16, border:"1px solid "+C.border, borderRadius:10, background:C.surface, padding:"12px 14px", display:"flex", flexWrap:"wrap", alignItems:"center", gap:10 }}>
            <div style={{ display:"flex", flexDirection:"column", gap:2, minWidth:260 }}>
              <div style={{ fontSize:14, fontWeight:600, color:C.bright }}>
                Syncing live data in background
              </div>
              <div style={{ fontSize:12, color:C.dim }}>
                {nulogySyncState && nulogySyncState.syncing
                  ? "Pulling Nulogy + OpenDock now. You will enter the dashboard automatically."
                  : "Preparing live feeds. You can open manual setup at any time."}
              </div>
            </div>
            {dockApiLoading && <span style={pill("info")}>Loading OpenDock…</span>}
            {nulogySyncState && nulogySyncState.syncing && <span style={pill("info")}>Loading Nulogy…</span>}
            {dockApiInfo && <span style={pill("ok")}>{dockApiInfo}</span>}
            {dockApiError && <span style={pill("bad")}>OpenDock: {dockApiError}</span>}
            {nulogySyncState && nulogySyncState.errorCount > 0 && <span style={pill("bad")}>Nulogy sync has errors</span>}
            {!dockApiLoading && (!nulogySyncState || !nulogySyncState.syncing) && (
              <button onClick={() => { setDockApiInfo(""); setDockApiError(""); setAutoDockAttempted(false); setSyncNonce(n => n + 1); }} style={{ padding:"6px 12px", borderRadius:6, border:"1px solid "+C.border, background:"transparent", color:C.dim, fontFamily:sans, fontSize:13, cursor:"pointer" }}>
                Retry Sync
              </button>
            )}
            <button onClick={() => setShowDataSetup(true)} style={{ padding:"6px 12px", borderRadius:6, border:"1px solid "+C.border, background:"transparent", color:C.dim, fontFamily:sans, fontSize:13, cursor:"pointer" }}>
              Open Data Setup
            </button>
            <button onClick={() => { setAutoBootstrapEnabled(false); setShowDataSetup(true); }} style={{ padding:"6px 12px", borderRadius:6, border:"1px solid "+C.border, background:"transparent", color:C.dim, fontFamily:sans, fontSize:13, cursor:"pointer" }}>
              Switch to Manual Upload
            </button>
          </div>
        )}
        {(!showAutoBootstrap || showDataSetup) && <div style={{ fontSize:13, fontWeight:600, color:C.dim, textTransform:"uppercase", letterSpacing:1, marginBottom:8 }}>Data setup</div>}
        {(!showAutoBootstrap || showDataSetup) && (
          <NulogySync onDataLoaded={handleNulogyData} theme={C} autoStart={false} hideToggle={false} />
        )}
        {(!showAutoBootstrap || showDataSetup) && (<>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(230px, 1fr))", gap:8, marginBottom:20 }}>
          <FileUploader label="Inventory" uploaded={!!ds.inventory} fileName={ds.invFileName} onData={(d,n) => {ds.setInventory(d);ds.setInvFileName(n);ds.setInvTimestamp(new Date());}} subtitle="Daily stock levels (.csv)" />
          <FileUploader label="Work Orders" uploaded={!!ds.workOrders} fileName={ds.woFileName} onData={(d,n) => {ds.setWorkOrders(d);ds.setWoFileName(n);ds.setWoTimestamp(new Date());}} subtitle="Open work orders (.csv)" />
        </div>
        <div style={{ marginBottom:8 }}>
          <div style={{ fontSize:13, fontWeight:600, color:C.dim, textTransform:"uppercase", letterSpacing:1, marginBottom:8 }}>Optional</div>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(230px, 1fr))", gap:8, marginBottom:20 }}>
          <FileUploader label="Bill of Materials" uploaded={!!ds.boms} fileName={ds.bomFileName} onData={(d,n) => {ds.setBoms(d);ds.setBomFileName(n);ds.setBomTimestamp(new Date());}} subtitle={ds.boms ? ("Saved \u00b7 Re-upload to update") : "BOM structure (.csv, .xlsx)"} acceptTypes=".csv,.xlsx,.xls" />
          <FileUploader label="EDR" uploaded={!!ds.edrData} fileName={ds.edrFileName} onData={(d,n) => {ds.setEdrData(d);ds.setEdrFileName(n);ds.setEdrTimestamp(new Date());}} subtitle="Inbound deliveries (.xlsx)" acceptTypes=".xlsx,.xls,.csv" parseWorkbook={ds.parseEdrWorkbook} />
          <FileUploader label="OpenDock" uploaded={!!ds.dockData} fileName={ds.dockFileName} onData={(d,n) => {ds.setDockData(d);ds.setDockFileName(n);ds.setDockTimestamp(new Date());}} subtitle="Dock appointments (.xlsx)" acceptTypes=".xlsx,.xls,.csv" />
          <FileUploader label="Purchase Order" uploaded={!!ds.poData} fileName={ds.poFileName} onData={(d,n) => {ds.setPoData(d);ds.setPoFileName(n);ds.setPoTimestamp(new Date());var h=d&&d.length?Object.keys(d[0]):[]; ds.setPoHeaders(h); ds.setPoMapping(autoMapColumns(h,PO_PAT));}} subtitle="PO line items (.csv, .xlsx, .pdf)" acceptTypes=".csv,.xlsx,.xls,.pdf" />
        </div>
        <div style={{ marginTop:-10, marginBottom:16, display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
          <button onClick={fetchOpenDockApi} disabled={dockApiLoading} style={{ padding:"8px 14px", borderRadius:6, border:"1px solid "+(dockApiLoading?C.border:C.accentLine), background:dockApiLoading?C.raised:C.accentSoft, color:dockApiLoading?C.dim:C.accent, fontFamily:sans, fontSize:14, fontWeight:600, cursor:dockApiLoading?"not-allowed":"pointer" }}>
            {dockApiLoading ? "Loading OpenDock..." : "Fetch OpenDock from API"}
          </button>
          <span style={{ fontSize:12, color:C.dim }}>Uses secure Vercel server route (`/api/opendock/appointments`).</span>
          {dockApiInfo && <span style={{ fontSize:12, color:C.ok }}>{dockApiInfo}</span>}
          {dockApiError && <span style={{ fontSize:12, color:C.bad }}>OpenDock API error: {dockApiError}</span>}
        </div>
        </>)}
        {ds.allUploaded && !ds.analyzing && (
          <button onClick={() => { ds.setAnalyzing(true); setTimeout(() => { ds.setMappingConfirmed(true); ds.setAnalyzing(false); setShowDataSetup(false); setTimeout(() => { var el = document.getElementById("dashboard-main"); if (el && el.scrollIntoView) el.scrollIntoView({ behavior:"smooth", block:"start" }); }, 0); }, 1500); }} disabled={!ds.requiredMappingsMet} style={{ padding:"8px 24px", borderRadius:6, border:"none", background:ds.requiredMappingsMet?C.accent:C.raised, color:ds.requiredMappingsMet?"#fff":C.dim, fontFamily:sans, fontSize:15, fontWeight:600, cursor:ds.requiredMappingsMet?"pointer":"not-allowed" }}>
            Analyze
          </button>
        )}
        {ds.allUploaded && ds.analyzing && (
          <div style={{ background:C.surface, border:"1px solid "+C.border, borderRadius:8, padding:"32px 20px", marginBottom:20, textAlign:"center" }}>
            <div style={{ display:"inline-block", width:28, height:28, border:"3px solid "+C.border, borderTopColor:C.accent, borderRadius:"50%", animation:"spin 0.8s linear infinite", marginBottom:12 }} />
            <div style={{ fontSize:16, fontWeight:600, color:C.bright }}>Analyzing</div>
            <div style={{ fontSize:14, color:C.dim, marginTop:4 }}>Mapping columns and processing data...</div>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        )}

        {(!showAutoBootstrap || showDataSetup) && <div style={{ marginTop:28, borderTop:"1px solid "+C.border, paddingTop:24 }}>
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
                When a BOM is loaded, PackPulse explodes each Work Order into its component materials. It compares <span style={{ color:C.bright }}>Qty Needed</span> (BOM qty per unit {"\u00D7"} order qty) against <span style={{ color:C.bright }}>On Hand</span> from Inventory. The lowest component fill rate becomes the WO's readiness %. <span style={{ color:C.bright }}>Can Make</span> shows the max units producible with current stock.
              </div>
            </div>

            <div style={{ background:C.surface, border:"1px solid "+C.border, borderRadius:8, padding:"16px 18px" }}>
              <div style={{ fontSize:14, fontWeight:700, color:C.accent, marginBottom:6 }}>3. Substitutes & Alternates</div>
              <div style={{ fontSize:13, color:C.dim, lineHeight:1.6 }}>
                BOMs can include substitute components. PackPulse groups primary and alternate materials together and pools their inventory {"\u2014"} if the primary is short but an approved alternate has stock, the combined quantity is used for readiness calculations.
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
                PackPulse scans your column headers against known patterns (e.g., "Item Code" {"\u2192"} SKU, "Qty On Hand" {"\u2192"} stock level). If a column doesn't map correctly, use the <span style={{ color:C.bright }}>Settings</span> panel after analysis to manually adjust any field mapping.
              </div>
            </div>

            <div style={{ background:C.surface, border:"1px solid "+C.border, borderRadius:8, padding:"16px 18px" }}>
              <div style={{ fontSize:14, fontWeight:700, color:C.accent, marginBottom:6 }}>6. Optional Data Sources</div>
              <div style={{ fontSize:13, color:C.dim, lineHeight:1.6 }}>
                <span style={{ color:C.bright }}>BOM</span> {"\u2014"} enables component-level readiness (saved between sessions). <span style={{ color:C.bright }}>EDR</span> {"\u2014"} inbound delivery data for the Delivery Timeline. <span style={{ color:C.bright }}>OpenDock</span> {"\u2014"} dock appointment statuses. <span style={{ color:C.bright }}>Purchase Order</span> {"\u2014"} cross-checks PO line items against WOs to catch missing or mismatched orders.
              </div>
            </div>

          </div>
        </div>}
      </div>)}

      <div id="dashboard-main">
        <input ref={ds.invRefreshRef} type="file" accept=".csv" style={{display:"none"}} onChange={e => {ds.handleRefreshFile("inv",e.target.files[0]);e.target.value="";}} />
        <input ref={ds.bomRefreshRef} type="file" accept=".csv,.xlsx,.xls" style={{display:"none"}} onChange={e => {ds.handleRefreshFile("bom",e.target.files[0]);e.target.value="";}} />
        <input ref={ds.woRefreshRef} type="file" accept=".csv" style={{display:"none"}} onChange={e => {ds.handleRefreshFile("wo",e.target.files[0]);e.target.value="";}} />
        <input ref={ds.edrRefreshRef} type="file" accept=".xlsx,.xls,.csv" style={{display:"none"}} onChange={e => {ds.handleRefreshFile("edr",e.target.files[0]);e.target.value="";}} />
        <input ref={ds.dockRefreshRef} type="file" accept=".xlsx,.xls,.csv" style={{display:"none"}} onChange={e => {ds.handleRefreshFile("dock",e.target.files[0]);e.target.value="";}} />

        {showSyncBanner ? (
          <div style={{ marginBottom:10, border:"1px solid "+C.border, borderRadius:8, background:C.surface, padding:"8px 10px", display:"flex", flexWrap:"wrap", alignItems:"center", gap:8 }}>
            <span style={{ fontSize:13, fontWeight:600, color:C.bright }}>Syncing live data in background</span>
            <span style={{ fontSize:12, color:C.dim }}>
              {nulogySyncState && nulogySyncState.syncing ? "Pulling Nulogy + OpenDock feeds while you stay on dashboard." : "Preparing live data feeds."}
            </span>
            <span style={{ fontSize:12, color:C.dim }}>
              {syncProgress.done}/{syncProgress.total} steps ({syncProgress.pct}%)
            </span>
            <div style={{ width:180, height:6, borderRadius:999, background:C.raised, overflow:"hidden", border:"1px solid "+C.border }}>
              <div style={{ width:syncProgress.pct+"%", height:"100%", background:syncProgress.errors>0?C.bad:C.accent, transition:"width 240ms ease" }} />
            </div>
            <span style={{ fontSize:12, color:syncProgress.errors>0?C.bad:C.dim }}>
              {syncProgress.activeText}
            </span>
            {nulogySyncState && nulogySyncState.syncing && <span style={pill("info")}>Nulogy</span>}
            {dockApiLoading && <span style={pill("info")}>OpenDock</span>}
            {dockApiInfo && <span style={pill("ok")}>{dockApiInfo}</span>}
            {dockApiError && <span style={pill("bad")}>OpenDock: {dockApiError}</span>}
            {nulogySyncState && nulogySyncState.errorCount > 0 && <span style={pill("bad")}>Nulogy sync has errors</span>}
            {!dockApiLoading && (!nulogySyncState || !nulogySyncState.syncing) && !ds.mappingConfirmed && (
              <button onClick={() => { setDockApiInfo(""); setDockApiError(""); setAutoDockAttempted(false); setSyncNonce(n => n + 1); }} style={{ padding:"6px 10px", borderRadius:6, border:"1px solid "+C.border, background:"transparent", color:C.dim, fontFamily:sans, fontSize:12, cursor:"pointer" }}>
                Retry Sync
              </button>
            )}
            <button onClick={() => setShowDataSetup(v => !v)} style={{ padding:"6px 10px", borderRadius:6, border:"1px solid "+C.border, background:"transparent", color:C.dim, fontFamily:sans, fontSize:12, cursor:"pointer" }}>
              {showDataSetup ? "Close Setup" : "Open Data Setup"}
            </button>
          </div>
        ) : null}

        <div style={{ display:"flex", gap:6, marginBottom:16, flexWrap:"wrap", alignItems:"center" }}>
          {[
            {k:"inv",l:"Inventory",ts:ds.invTimestamp,cad:"daily",ref:() => window.__invR && window.__invR.click()},
            {k:"wo",l:"Work Orders",ts:ds.woTimestamp,cad:"monthly",ref:() => window.__woR && window.__woR.click()},
            {k:"bom",l:"BOMs",ts:ds.bomTimestamp,cad:"rare",ref:() => window.__bomR && window.__bomR.click()},
            {k:"edr",l:"EDR",ts:ds.edrTimestamp,cad:"monthly",ref:() => window.__edrR && window.__edrR.click()},
            {k:"dock",l:"OpenDock",ts:ds.dockTimestamp,cad:"daily",ref:() => window.__dockR && window.__dockR.click()},
          ]
           .map(s => {
            var sl = staleLevel(s.ts, s.cad); var dc = sl==="fresh"?C.ok:sl==="stale"?C.warn:C.bad;
            return <button key={s.k} onClick={s.ref} style={{ display:"inline-flex", alignItems:"center", gap:5, padding:"4px 10px", borderRadius:6, border:"1px solid "+C.border, background:C.surface, cursor:"pointer", color:C.dim, fontFamily:sans, fontSize:13, fontWeight:500 }}>
              <span style={{ width:6, height:6, borderRadius:"50%", background:dc }} />{s.l} <span style={{ opacity:0.6 }}>{fmtTs(s.ts)}</span>
            </button>;
          })}
          <button onClick={() => setActiveView(activeView==="flags"?"workorders":"flags")} style={{ padding:"4px 10px", borderRadius:6, border:"1px solid "+(activeView==="flags"?C.accentLine:C.border), background:activeView==="flags"?C.accentSoft:"transparent", cursor:"pointer", color:activeView==="flags"?C.accent:C.dim, fontFamily:sans, fontSize:13 }}>Data Flags {analysisForUI.flags?<span style={{ opacity:0.6 }}>{analysisForUI.flags.length}</span>:""}</button>
          <button onClick={fetchOpenDockApi} disabled={dockApiLoading} style={{ padding:"4px 10px", borderRadius:6, border:"1px solid "+(dockApiLoading?C.border:C.accentLine), background:dockApiLoading?C.raised:C.accentSoft, cursor:dockApiLoading?"not-allowed":"pointer", color:dockApiLoading?C.dim:C.accent, fontFamily:sans, fontSize:13 }}>Sync OpenDock API</button>
          <button onClick={() => setShowSettings(!showSettings)} style={{ padding:"4px 10px", borderRadius:6, border:"1px solid "+(showSettings?C.accentLine:C.border), background:showSettings?C.accentSoft:"transparent", cursor:"pointer", color:showSettings?C.accent:C.dim, fontFamily:sans, fontSize:13 }}>Settings</button>
          <button onClick={() => setShowDataSetup(v => !v)} style={{ padding:"4px 10px", borderRadius:6, border:"1px solid "+C.border, background:"transparent", cursor:"pointer", color:C.dim, fontFamily:sans, fontSize:13 }}>{showDataSetup ? "Close Setup" : "Data Setup"}</button>
        </div>
        {dockApiError && <div style={{ fontSize:12, color:C.bad, marginTop:-8, marginBottom:10 }}>OpenDock API error: {dockApiError}</div>}

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
              <ColumnMapper title="Inventory" headers={ds.invHeaders} mapping={ds.invMapping} onMappingChange={ds.setInvMapping} fields={[{key:"sku",label:"Item / SKU",required:true},{key:"description",label:"Description"},{key:"qtyOnHand",label:"Qty On Hand",required:true}]} />
              {ds.boms && <ColumnMapper title="Bill of Materials" headers={ds.bomHeaders} mapping={ds.bomMapping} onMappingChange={ds.setBomMapping} fields={[{key:"bomId",label:"Finished Good",required:true},{key:"componentSku",label:"Component SKU",required:true},{key:"description",label:"Description"},{key:"qtyPer",label:"Qty Per",required:true},{key:"substituteFor",label:"Substitute For"},{key:"priority",label:"Priority"}]} />}
              <ColumnMapper title="Work Orders" headers={ds.woHeaders} mapping={ds.woMapping} onMappingChange={ds.setWoMapping} fields={[{key:"woNumber",label:"WO Number",required:true},{key:"productSku",label:"Product SKU",required:true},{key:"qtyToProduce",label:"Qty to Produce",required:true},{key:"dueDate",label:"Due Date"},{key:"status",label:"Status"},{key:"customer",label:"Customer"},{key:"unitsProduced",label:"Units Produced"},{key:"unitsRemaining",label:"Units Remaining"},{key:"unitsPerHour",label:"Units/Hour"},{key:"standardPeople",label:"Crew Size"},{key:"plannedStart",label:"Planned Start"},{key:"plannedEnd",label:"Planned End"},{key:"reference1",label:"Reference / Notes"}]} />
              {ds.poData && <ColumnMapper title="Purchase Order" headers={ds.poHeaders} mapping={ds.poMapping} onMappingChange={ds.setPoMapping} fields={[{key:"material",label:"Material / SKU",required:true},{key:"description",label:"Description"},{key:"qty",label:"Quantity",required:true},{key:"unitPrice",label:"Unit Price"},{key:"poNumber",label:"PO Number"}]} />}
              <div style={{ display:"flex", justifyContent:"flex-end", marginTop:16 }}>
                <button onClick={() => setShowSettings(false)} style={{ padding:"8px 20px", borderRadius:6, border:"none", background:C.accent, color:"#fff", fontFamily:sans, fontSize:15, fontWeight:600, cursor:"pointer" }}>Done</button>
              </div>
            </div>
          </div>
        )}

        <div style={{ display:"flex", gap:0, marginBottom:16, borderBottom:"1px solid "+C.border }}>
          {[{key:"overview",label:"Overview",count:null,alert:false},{key:"workorders",label:"Work Orders",count:summaryForUI.total},{key:"criticalitems",label:"Critical Items",count:criticalItemsForUI.length}]
            .concat([{key:"pocheck",label:"PO Check",count:poCheck ? poCheck.missing+poCheck.qtyMismatch : 0,alert:poCheck ? poCheck.missing+poCheck.qtyMismatch>0 : false}])
            .concat([{key:"timeline",label:"Deliveries",count:timelineData ? timelineData.woTimelines.length : 0,alert:false}]).map(t =>
              <button key={t.key} onClick={() => setActiveView(t.key)} style={{ padding:"8px 16px", border:"none", fontFamily:sans, fontSize:14, fontWeight:500, cursor:"pointer", background:"transparent", color:activeView===t.key?C.bright:C.dim, borderBottom:activeView===t.key?"2px solid "+C.accent:"2px solid transparent", marginBottom:-1 }}>
                {t.label} {t.count != null && <span style={{ opacity:t.alert?1:0.45, fontSize:13, color:t.alert?C.bad:undefined }}>{t.alert?"\u26A0 ":""}{t.count}</span>}
              </button>
          )}
        </div>

        {activeView === "overview" && <OverviewView analysis={analysisForUI} woStatuses={woStatusesForUI} />}
        {activeView === "workorders" && <WorkOrdersView analysis={analysisForUI} woStatuses={woStatusesForUI} woCustomers={woCustomersForUI} />}
        {activeView === "criticalitems" && <CriticalItemsView rawCriticalItems={criticalItemsForUI} />}
        {activeView === "flags" && <FlagsView flags={analysisForUI.flags} />}
        {activeView === "pocheck" && <POCheckView poCheck={poCheck} />}
        {activeView === "timeline" && <TimelineView timelineData={timelineData} />}

      </div>
      </main>
    </div>
  );
}
