import { useState, useCallback, useEffect, lazy, Suspense } from "react";
import NulogySync from "./NulogySync";
import { useTheme } from "./theme";
import { useDataSources } from "./hooks/useDataSources";
import { useAnalysis } from "./hooks/useAnalysis";
import ColumnMapper from "./components/ColumnMapper";
import FileUploader from "./components/FileUploader";
import { Button } from "./components/ui/button";
import { Badge } from "./components/ui/badge";
import { Progress } from "./components/ui/progress";
import TabsNav from "./components/ui/tabs-nav";
const OverviewView = lazy(() => import("./views/OverviewView"));
const WorkOrdersView = lazy(() => import("./views/WorkOrdersView"));
const CriticalItemsView = lazy(() => import("./views/CriticalItemsView"));
const FlagsView = lazy(() => import("./views/FlagsView"));
const TimelineView = lazy(() => import("./views/TimelineView"));
const RecommendationsView = lazy(() => import("./views/RecommendationsView"));
const SandboxView = lazy(() => import("./views/SandboxView"));

export default function ProductionReadiness() {
  const { C, theme, setTheme, sans, mono, FONTS_CSS, A11Y_CSS } = useTheme();
  const ds = useDataSources();
  const { analysis, summary, criticalItems, woStatuses, woCustomers, timelineData, deliveriesV2, inboundCoverage, recommendations, dispatchQueue } = useAnalysis({
    mappingConfirmed: ds.mappingConfirmed, allUploaded: ds.allUploaded,
    inventory: ds.inventory, itemMaster: ds.itemMaster, boms: ds.boms, workOrders: ds.workOrders,
    invMapping: ds.invMapping, bomMapping: ds.bomMapping, woMapping: ds.woMapping,
    edrData: ds.edrData, dockData: ds.dockData,
  });

  const [activeView, setActiveView] = useState("overview");
  const [showSettings, setShowSettings] = useState(false);
  const [showDataSetup, setShowDataSetup] = useState(false);
  const [showDataControlsPanel, setShowDataControlsPanel] = useState(false);
  const [workOrdersPrefilterCustomer, setWorkOrdersPrefilterCustomer] = useState("");
  const [workOrdersPrefilterNonce, setWorkOrdersPrefilterNonce] = useState(0);
  const [autoBootstrapEnabled, setAutoBootstrapEnabled] = useState(true);
  const [syncNonce, setSyncNonce] = useState(0);
  const [nulogySyncState, setNulogySyncState] = useState(null);
  const [autoDockAttempted, setAutoDockAttempted] = useState(false);
  const [dockApiLoading, setDockApiLoading] = useState(false);
  const [dockApiError, setDockApiError] = useState("");
  const [dockApiInfo, setDockApiInfo] = useState("");
  const [syncVisualPct, setSyncVisualPct] = useState(0);

  var showAutoBootstrap = autoBootstrapEnabled;

  var fmtTs = ts => { if (!ts) return "--"; var d = Date.now() - ts; return d < 60000 ? "now" : d < 3600000 ? Math.floor(d/60000) + "m" : d < 86400000 ? Math.floor(d/3600000) + "h" : Math.floor(d/86400000) + "d"; };
  var staleLevel = (ts, cad) => { if (!ts) return "stale"; var h = (Date.now()-ts)/3600000; if (cad==="daily") return h<8?"fresh":h<24?"stale":"old"; if (cad==="rare") return h<720?"fresh":"stale"; return h<168?"fresh":"stale"; };
  var dataSourceStatus = [
    { k:"inv", l:"Inventory", ts:ds.invTimestamp, cad:"daily", ref:() => window.__invR && window.__invR.click() },
    { k:"wo", l:"Work Orders", ts:ds.woTimestamp, cad:"monthly", ref:() => window.__woR && window.__woR.click() },
    { k:"bom", l:"BOMs", ts:ds.bomTimestamp, cad:"rare", ref:() => window.__bomR && window.__bomR.click() },
    { k:"edr", l:"EDR", ts:ds.edrTimestamp, cad:"monthly", ref:() => window.__edrR && window.__edrR.click() },
    { k:"dock", l:"OpenDock", ts:ds.dockTimestamp, cad:"daily", ref:() => window.__dockR && window.__dockR.click() },
  ];
  var freshCount = dataSourceStatus.filter(function(s) { return staleLevel(s.ts, s.cad) === "fresh"; }).length;
  var newestTs = dataSourceStatus.reduce(function(max, s) {
    var ts = s.ts ? new Date(s.ts).getTime() : 0;
    return ts > max ? ts : max;
  }, 0);
  var summaryStamp = newestTs ? fmtTs(new Date(newestTs)) : "--";

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
    if (results.itemmaster) {
      ds.setItemMaster(results.itemmaster.data);
      ds.setItemMasterFileName("Nulogy Sync");
      ds.setItemMasterTimestamp(ts);
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
  var recommendationsForUI = recommendations || [];
  var syncProgress = (() => {
    var reportStates = nulogySyncState && nulogySyncState.reportStates ? nulogySyncState.reportStates : null;
    var steps = [
      { key:"inventory", label:"Inventory" },
      { key:"workorders", label:"Work Orders" },
      { key:"itemmaster", label:"Item Master" },
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
  var isActivelySyncing = showAutoBootstrap && (
    !ds.mappingConfirmed ||
    dockApiLoading ||
    (nulogySyncState && nulogySyncState.syncing)
  );
  var syncBarColor = isActivelySyncing ? C.accent : C.ok;
  var syncPctColor = C.dim;
  useEffect(() => {
    if (!showSyncBanner) {
      setSyncVisualPct(0);
      return;
    }
    if (!isActivelySyncing) {
      setSyncVisualPct(100);
      return;
    }
    var id = setInterval(function() {
      setSyncVisualPct(function(prev) {
        var floor = Math.max(8, Math.min(88, syncProgress.pct));
        var base = Math.max(prev, floor);
        if (base >= 96) return 96;
        return Math.min(96, base + (Math.random() * 4 + 1));
      });
    }, 420);
    return function() { clearInterval(id); };
  }, [showSyncBanner, isActivelySyncing, syncProgress.pct]);
  var goToDashboard = function() {
    setShowDataSetup(false);
    setTimeout(function() {
      var el = document.getElementById("dashboard-main");
      if (el && el.scrollIntoView) el.scrollIntoView({ behavior:"smooth", block:"start" });
    }, 0);
  };
  var openWorkOrdersForCustomer = useCallback(function(customerName) {
    setWorkOrdersPrefilterCustomer(customerName || "");
    setWorkOrdersPrefilterNonce(function(v) { return v + 1; });
    setActiveView("workorders");
    setTimeout(function() {
      var el = document.getElementById("dashboard-main");
      if (el && el.scrollIntoView) el.scrollIntoView({ behavior:"smooth", block:"start" });
    }, 0);
  }, []);
  var openRecommendation = useCallback(function(rec) {
    if (!rec || !rec.targetView) return;
    setActiveView(rec.targetView);
    setTimeout(function() {
      var el = document.getElementById("dashboard-main");
      if (el && el.scrollIntoView) el.scrollIntoView({ behavior:"smooth", block:"start" });
    }, 0);
  }, []);

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
          {window.__ppLogout && <Button onClick={window.__ppLogout} variant="outline" size="sm">Sign out</Button>}
          <Button onClick={() => setTheme(theme==="dark"?"light":"dark")} variant="outline" size="sm">
            {theme === "dark" ? "Light" : "Dark"}
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-[1440px] px-7 py-5">
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
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2.5">
          <div className="text-xs text-[rgb(var(--muted))]">
            Dashboard / <span style={{ color:C.bright, fontWeight:600 }}>Data Setup</span>
          </div>
          <Button onClick={goToDashboard} variant="outline" size="sm">
            Back to Dashboard
          </Button>
        </div>
        {showAutoBootstrap && !showDataSetup && (
          <div className="mb-4 flex flex-wrap items-center gap-2.5 rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-3.5 py-3">
            <div className="flex min-w-[260px] flex-col gap-0.5">
              <div className="text-sm font-semibold text-[rgb(var(--foreground))]">
                Syncing live data in background
              </div>
              <div className="text-xs text-[rgb(var(--muted))]">
                {nulogySyncState && nulogySyncState.syncing
                  ? "Pulling Nulogy + OpenDock now. You will enter the dashboard automatically."
                  : "Preparing live feeds. You can open manual setup at any time."}
              </div>
            </div>
            {dockApiLoading && <Badge variant="secondary">Loading OpenDock…</Badge>}
            {nulogySyncState && nulogySyncState.syncing && <Badge variant="secondary">Loading Nulogy…</Badge>}
            {dockApiInfo && <Badge variant="success">{dockApiInfo}</Badge>}
            {dockApiError && <Badge variant="danger">OpenDock: {dockApiError}</Badge>}
            {nulogySyncState && nulogySyncState.errorCount > 0 && <Badge variant="danger">Nulogy sync has errors</Badge>}
            {!dockApiLoading && (!nulogySyncState || !nulogySyncState.syncing) && (
              <Button onClick={() => { setDockApiInfo(""); setDockApiError(""); setAutoDockAttempted(false); setSyncNonce(n => n + 1); }} variant="outline" size="sm">
                Retry Sync
              </Button>
            )}
            <Button onClick={() => setShowDataSetup(true)} variant="outline" size="sm">
              Open Data Setup
            </Button>
            <Button onClick={() => { setAutoBootstrapEnabled(false); setShowDataSetup(true); }} variant="outline" size="sm">
              Switch to Manual Upload
            </Button>
          </div>
        )}
        {(!showAutoBootstrap || showDataSetup) && <div className="mb-2 text-sm font-semibold tracking-[0.2px] text-[rgb(var(--muted))]">Data Setup</div>}
        {(!showAutoBootstrap || showDataSetup) && (
          <NulogySync onDataLoaded={handleNulogyData} theme={C} autoStart={false} hideToggle={false} />
        )}
        {(!showAutoBootstrap || showDataSetup) && (<>
        <div className="mb-5 grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-2">
          <FileUploader label="Inventory" uploaded={!!ds.inventory} fileName={ds.invFileName} onData={(d,n) => {ds.setInventory(d);ds.setInvFileName(n);ds.setInvTimestamp(new Date());}} subtitle="Daily stock levels (.csv)" />
          <FileUploader label="Work Orders" uploaded={!!ds.workOrders} fileName={ds.woFileName} onData={(d,n) => {ds.setWorkOrders(d);ds.setWoFileName(n);ds.setWoTimestamp(new Date());}} subtitle="Open work orders (.csv)" />
        </div>
        <div className="mb-2">
          <div className="mb-2 text-sm font-semibold tracking-[0.2px] text-[rgb(var(--muted))]">Optional</div>
        </div>
        <div className="mb-5 grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-2">
          <FileUploader label="Bill of Materials" uploaded={!!ds.boms} fileName={ds.bomFileName} onData={(d,n) => {ds.setBoms(d);ds.setBomFileName(n);ds.setBomTimestamp(new Date());}} subtitle={ds.boms ? ("Saved \u00b7 Re-upload to update") : "BOM structure (.csv, .xlsx)"} acceptTypes=".csv,.xlsx,.xls" />
          <FileUploader label="EDR" uploaded={!!ds.edrData} fileName={ds.edrFileName} onData={(d,n) => {ds.setEdrData(d);ds.setEdrFileName(n);ds.setEdrTimestamp(new Date());}} subtitle="Inbound deliveries (.xlsx)" acceptTypes=".xlsx,.xls,.csv" parseWorkbook={ds.parseEdrWorkbook} />
          <FileUploader label="OpenDock" uploaded={!!ds.dockData} fileName={ds.dockFileName} onData={(d,n) => {ds.setDockData(d);ds.setDockFileName(n);ds.setDockTimestamp(new Date());}} subtitle="Dock appointments (.xlsx)" acceptTypes=".xlsx,.xls,.csv" />
        </div>
        <div className="-mt-2.5 mb-4 flex flex-wrap items-center gap-2.5">
          <Button onClick={fetchOpenDockApi} disabled={dockApiLoading} variant={dockApiLoading ? "soft" : "active"} size="default">
            {dockApiLoading ? "Loading OpenDock..." : "Fetch OpenDock from API"}
          </Button>
          <span className="text-xs text-[rgb(var(--muted))]">Uses secure Vercel server route (`/api/opendock/appointments`).</span>
          {dockApiInfo && <span className="text-xs" style={{ color:C.ok }}>{dockApiInfo}</span>}
          {dockApiError && <span className="text-xs" style={{ color:C.bad }}>OpenDock API error: {dockApiError}</span>}
        </div>
        </>)}
        {ds.allUploaded && !ds.analyzing && (
          <Button onClick={() => { ds.setAnalyzing(true); setTimeout(() => { ds.setMappingConfirmed(true); ds.setAnalyzing(false); setShowDataSetup(false); setTimeout(() => { var el = document.getElementById("dashboard-main"); if (el && el.scrollIntoView) el.scrollIntoView({ behavior:"smooth", block:"start" }); }, 0); }, 1500); }} disabled={!ds.requiredMappingsMet} variant={ds.requiredMappingsMet ? "default" : "soft"} size="default">
            Analyze
          </Button>
        )}
        {ds.allUploaded && ds.analyzing && (
          <div style={{ background:C.surface, border:"1px solid "+C.border, borderRadius:8, padding:"32px 20px", marginBottom:20, textAlign:"center" }}>
            <div style={{ display:"inline-block", width:28, height:28, border:"3px solid "+C.border, borderTopColor:C.accent, borderRadius:"50%", animation:"spin 0.8s linear infinite", marginBottom:12 }} />
            <div style={{ fontSize:16, fontWeight:600, color:C.bright }}>Analyzing</div>
            <div style={{ fontSize:14, color:C.dim, marginTop:4 }}>Mapping columns and processing data...</div>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        )}

        {(!showAutoBootstrap || showDataSetup) && <div className="mt-7 border-t border-[rgb(var(--border))] pt-6">
          <div className="mb-4 text-[15px] font-bold text-[rgb(var(--foreground))]">How PackPulse Works</div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">

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
                <span style={{ color:C.bright }}>BOM</span> {"\u2014"} enables component-level readiness (saved between sessions). <span style={{ color:C.bright }}>EDR</span> {"\u2014"} inbound delivery data for the Delivery Timeline. <span style={{ color:C.bright }}>OpenDock</span> {"\u2014"} dock appointment statuses.
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
          <div className="mb-2.5 flex flex-wrap items-center gap-2 rounded-md border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-2.5 py-2">
            <span className="text-sm font-semibold text-[rgb(var(--foreground))]">Live Sync</span>
            <span className="text-xs text-[rgb(var(--muted))]">
              {isActivelySyncing ? "Syncing data..." : "Up to date"}
            </span>
            <span className="min-w-11 text-right text-xs font-semibold [font-variant-numeric:tabular-nums]" style={{ color:syncPctColor }}>
              {Math.round(syncVisualPct)}%
            </span>
            <Progress value={syncVisualPct} className="w-44" />
            {syncVisualPct < 100 && (
              <span className="text-xs text-[rgb(var(--muted))]">
                {syncProgress.activeText}
              </span>
            )}
            {nulogySyncState && nulogySyncState.syncing && <Badge variant="secondary">Nulogy</Badge>}
            {dockApiLoading && <Badge variant="secondary">OpenDock</Badge>}
            {dockApiInfo && syncVisualPct < 100 && <Badge variant="success">{dockApiInfo}</Badge>}
            {dockApiError && <Badge variant="danger">OpenDock: {dockApiError}</Badge>}
            {nulogySyncState && nulogySyncState.errorCount > 0 && <Badge variant="danger">Nulogy sync has errors</Badge>}
            {!dockApiLoading && (!nulogySyncState || !nulogySyncState.syncing) && !ds.mappingConfirmed && (
              <Button variant="outline" size="sm" onClick={() => { setDockApiInfo(""); setDockApiError(""); setAutoDockAttempted(false); setSyncNonce(n => n + 1); }}>
                Retry
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => setShowDataSetup(v => !v)}>
              {showDataSetup ? "Close Setup" : "Open Data Setup"}
            </Button>
          </div>
        ) : null}

        <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
          <Button onClick={() => setShowDataControlsPanel(v => !v)} variant={showDataControlsPanel ? "active" : "outline"} size="sm">
            {showDataControlsPanel ? "Hide Data Controls" : "Data Controls"}
          </Button>
          <Button onClick={() => setShowSettings(!showSettings)} variant={showSettings ? "active" : "outline"} size="sm">Data Mapping</Button>
          <span className="text-xs text-[rgb(var(--muted))]">
            Data freshness: <span style={{ color:freshCount===dataSourceStatus.length?C.ok:freshCount>=3?C.warn:C.bad, fontWeight:600 }}>{freshCount}/{dataSourceStatus.length}</span> fresh · Updated {summaryStamp}
          </span>
        </div>
        {showDataControlsPanel && (
          <div className="mb-2.5 rounded-md border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-3 py-2.5">
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <Button onClick={fetchOpenDockApi} disabled={dockApiLoading} variant={dockApiLoading ? "soft" : "active"} size="sm">
              {dockApiLoading ? "Syncing OpenDock..." : "Sync OpenDock API"}
            </Button>
              <Button onClick={() => setShowDataSetup(v => !v)} variant="outline" size="sm">
                {showDataSetup ? "Close Data Setup" : "Open Data Setup"}
              </Button>
              <Button onClick={() => setActiveView("flags")} variant={activeView==="flags" ? "active" : "outline"} size="sm">
                Data Flags {analysisForUI.flags.length > 0 ? "(" + analysisForUI.flags.length + ")" : ""}
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {dataSourceStatus.map(function(s) {
                var sl = staleLevel(s.ts, s.cad); var dc = sl==="fresh"?C.ok:sl==="stale"?C.warn:C.bad;
                return <button key={s.k} onClick={s.ref} className="inline-flex items-center gap-1.5 rounded-md border border-[rgb(var(--border))] bg-white px-2.5 py-1 text-xs font-medium text-[rgb(var(--muted))]">
                  <span style={{ width:6, height:6, borderRadius:"50%", background:dc }} />{s.l} <span style={{ opacity:0.6 }}>{fmtTs(s.ts)}</span>
                </button>;
              })}
            </div>
          </div>
        )}
        {dockApiError && <div style={{ fontSize:12, color:C.bad, marginTop:-8, marginBottom:10 }}>OpenDock API error: {dockApiError}</div>}

        {showSettings && (
          <div style={{ position:"fixed", top:0, left:0, right:0, bottom:0, background:"rgba(0,0,0,0.5)", zIndex:100, display:"flex", alignItems:"center", justifyContent:"center" }} onClick={e => { if (e.target === e.currentTarget) setShowSettings(false); }}>
            <div style={{ background:C.surface, border:"1px solid "+C.border, borderRadius:10, padding:24, width:"90%", maxWidth:720, maxHeight:"80vh", overflowY:"auto" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
                <div>
                  <div style={{ fontSize:16, fontWeight:600, color:C.bright }}>Column Mapping</div>
                  <div style={{ fontSize:14, color:C.dim, marginTop:2 }}>Adjust how your file columns map to the analysis engine. <span style={{color:C.bad}}>*</span> = required</div>
                </div>
                <Button onClick={() => setShowSettings(false)} variant="outline" size="sm">{"\u2715"}</Button>
              </div>
              <ColumnMapper title="Inventory" headers={ds.invHeaders} mapping={ds.invMapping} onMappingChange={ds.setInvMapping} fields={[{key:"sku",label:"Item / SKU",required:true},{key:"description",label:"Description"},{key:"qtyOnHand",label:"Qty On Hand",required:true},{key:"status",label:"Inventory Status",help:"If mapped, PackPulse uses only rows marked Good."}]} />
              {ds.boms && <ColumnMapper title="Bill of Materials" headers={ds.bomHeaders} mapping={ds.bomMapping} onMappingChange={ds.setBomMapping} fields={[{key:"bomId",label:"Finished Good",required:true},{key:"componentSku",label:"Component SKU",required:true},{key:"description",label:"Description (optional)",help:"Used for component naming in details. If blank, PackPulse falls back to Item Master / Inventory descriptions."},{key:"qtyPer",label:"Qty Per",required:true},{key:"substituteFor",label:"Substitute For"},{key:"priority",label:"Priority"}]} />}
              <ColumnMapper title="Work Orders" headers={ds.woHeaders} mapping={ds.woMapping} onMappingChange={ds.setWoMapping} fields={[{key:"woNumber",label:"WO Number",required:true},{key:"productSku",label:"Product SKU",required:true},{key:"qtyToProduce",label:"Qty to Produce",required:true},{key:"dueDate",label:"Due Date"},{key:"status",label:"Status"},{key:"customer",label:"Customer"},{key:"unitsProduced",label:"Units Produced"},{key:"unitsRemaining",label:"Units Remaining"},{key:"unitsPerHour",label:"Units/Hour"},{key:"standardPeople",label:"Crew Size"},{key:"plannedStart",label:"Planned Start"},{key:"plannedEnd",label:"Planned End"},{key:"reference1",label:"Reference / Notes"}]} />
              <div style={{ display:"flex", justifyContent:"flex-end", marginTop:16 }}>
                <Button onClick={() => setShowSettings(false)} variant="default" size="default">Done</Button>
              </div>
            </div>
          </div>
        )}

        <TabsNav
          activeKey={activeView}
          onChange={setActiveView}
          items={[{key:"overview",label:"Overview",count:null,alert:false},{key:"workorders",label:"Work Orders",count:summaryForUI.total},{key:"criticalitems",label:"Critical Items",count:criticalItemsForUI.length},{key:"recommendations",label:"Recommendations",count:recommendationsForUI.length,alert:recommendationsForUI.some(function(r){return r.priority==="P1";})}]
            .concat([{key:"timeline",label:"Deliveries",count:timelineData ? timelineData.totalDeliveries : 0,alert:false},{key:"sandbox",label:"Sandbox",count:null,alert:false}])}
        />

        <Suspense fallback={<div style={{ fontSize:13, color:C.dim, padding:"8px 0 4px" }}>Loading view...</div>}>
          {activeView === "overview" && <OverviewView analysis={analysisForUI} woStatuses={woStatusesForUI} onSelectCustomer={openWorkOrdersForCustomer} />}
          {activeView === "workorders" && <WorkOrdersView analysis={analysisForUI} woStatuses={woStatusesForUI} woCustomers={woCustomersForUI} recommendations={recommendationsForUI} dispatchQueue={dispatchQueue || []} prefilterCustomer={workOrdersPrefilterCustomer} prefilterNonce={workOrdersPrefilterNonce} />}
          {activeView === "criticalitems" && <CriticalItemsView rawCriticalItems={criticalItemsForUI} inboundCoverage={inboundCoverage} />}
          {activeView === "recommendations" && <RecommendationsView recommendations={recommendationsForUI} onOpenRecommendation={openRecommendation} />}
          {activeView === "sandbox" && <SandboxView />}
          {activeView === "flags" && <FlagsView flags={analysisForUI.flags} />}
          {activeView === "timeline" && <TimelineView timelineData={timelineData} deliveriesV2={deliveriesV2} />}
        </Suspense>

      </div>
      </main>
    </div>
  );
}
