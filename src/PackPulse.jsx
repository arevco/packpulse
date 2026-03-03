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
import { Card } from "./components/ui/card";
import AskAiPanel from "./components/AskAiPanel";
const OverviewView = lazy(() => import("./views/OverviewView"));
const OperationsView = lazy(() => import("./views/OperationsView"));
const WorkOrdersView = lazy(() => import("./views/WorkOrdersView"));
const SupplyRiskView = lazy(() => import("./views/SupplyRiskView"));
const FlagsView = lazy(() => import("./views/FlagsView"));
const SandboxView = lazy(() => import("./views/SandboxView"));

export default function ProductionReadiness() {
  const { C, theme, setTheme, sans, mono } = useTheme();
  const ds = useDataSources();
  const { analysis, summary, criticalItems, woStatuses, woCustomers, timelineData, deliveriesV2, inboundCoverage, recommendations, dispatchQueue, productionSegments } = useAnalysis({
    mappingConfirmed: ds.mappingConfirmed, allUploaded: ds.allUploaded,
    inventory: ds.inventory, itemMaster: ds.itemMaster, boms: ds.boms, workOrders: ds.workOrders,
    productionData: ds.productionData,
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
  const [showQuickControls, setShowQuickControls] = useState(false);
  const [showUserActivity, setShowUserActivity] = useState(false);
  const [userActivityLoading, setUserActivityLoading] = useState(false);
  const [userActivityError, setUserActivityError] = useState("");
  const [userActivityRows, setUserActivityRows] = useState([]);
  const [showAskAi, setShowAskAi] = useState(false);

  var showAutoBootstrap = autoBootstrapEnabled;

  var fmtTs = ts => { if (!ts) return "--"; var d = Date.now() - ts; return d < 60000 ? "now" : d < 3600000 ? Math.floor(d/60000) + "m" : d < 86400000 ? Math.floor(d/3600000) + "h" : Math.floor(d/86400000) + "d"; };
  var fmtClock = ts => {
    if (!ts) return "--";
    var d = new Date(ts);
    if (isNaN(d)) return "--";
    return d.toLocaleString([], { month:"2-digit", day:"2-digit", hour:"numeric", minute:"2-digit" });
  };
  var staleLevel = (ts, cad) => { if (!ts) return "stale"; var h = (Date.now()-ts)/3600000; if (cad==="daily") return h<8?"fresh":h<24?"stale":"old"; if (cad==="rare") return h<720?"fresh":"stale"; return h<168?"fresh":"stale"; };
  var dataSourceStatus = [
    { k:"inv", l:"Inventory", ts:ds.invTimestamp, cad:"daily", ref:() => window.__invR && window.__invR.click() },
    { k:"wo", l:"Work Orders", ts:ds.woTimestamp, cad:"monthly", ref:() => window.__woR && window.__woR.click() },
    { k:"prod", l:"Production", ts:ds.productionTimestamp, cad:"daily", ref:null },
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
  var sharedMeta = ds.sharedSnapshotMeta || { source: "unknown", syncedAt: null, updatedBy: "" };
  var sharedSourceLabel = sharedMeta.source === "shared" ? "Shared cache" : sharedMeta.source === "local" ? "Local cache" : sharedMeta.source === "empty" ? "Shared cache empty" : "Shared cache unavailable";
  var sharedStamp = sharedMeta.syncedAt ? fmtTs(sharedMeta.syncedAt) : "--";
  var sharedBy = sharedMeta.updatedBy ? sharedMeta.updatedBy : "--";

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
  var loadUserActivity = useCallback(async function() {
    setUserActivityLoading(true);
    setUserActivityError("");
    try {
      var r = await fetch("/api/ops/user-logins?limit=20", { credentials: "include" });
      var body = await r.json();
      if (!r.ok) throw new Error(body && body.error ? body.error : "Could not load user activity");
      setUserActivityRows(Array.isArray(body.rows) ? body.rows : []);
      if (body && body.status === "missing_user_login_events_table") {
        setUserActivityError("Login tracking table not set up yet.");
      }
    } catch (e) {
      setUserActivityError(e && e.message ? e.message : "Could not load user activity");
    } finally {
      setUserActivityLoading(false);
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
    if (results.production) {
      ds.setProductionData(results.production.data);
      ds.setProductionFileName("Nulogy Sync");
      ds.setProductionTimestamp(ts);
      fetch("/api/cache/production-events", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: results.production.data || [], syncedAt: ts.toISOString() })
      }).catch(function() {
        // Non-blocking: local dashboard still works even if trend ingest fails.
      });
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
  var productionSegmentsForUI = productionSegments || { shiftRows: [], jobRows: [] };
  var toNumSafe = function(v) {
    var n = Number(v || 0);
    return Number.isFinite(n) ? n : 0;
  };
  var isClosedStatus = function(status) {
    var s = String(status || "").toLowerCase();
    return s.indexOf("close") !== -1 || s.indexOf("complete") !== -1 || s.indexOf("cancel") !== -1 || s.indexOf("done") !== -1;
  };
  var todayEt = (function() {
    var parts = {};
    new Intl.DateTimeFormat("en-US", { timeZone:"America/New_York", year:"numeric", month:"2-digit", day:"2-digit" })
      .formatToParts(new Date())
      .forEach(function(p) { if (p.type !== "literal") parts[p.type] = p.value; });
    return parts.year && parts.month && parts.day ? (parts.year + "-" + parts.month + "-" + parts.day) : "";
  })();
  var productionTodayRows = (productionSegmentsForUI.shiftRows || []).filter(function(r) { return (r && r.date) === todayEt; });
  var productionTodayTotal = productionTodayRows.reduce(function(sum, r) { return sum + (Number(r && r.unitsProduced || 0) || 0); }, 0);
  var productionTodayS1 = productionTodayRows
    .filter(function(r) { return String(r && r.shift || "").toLowerCase().indexOf("shift 1") !== -1; })
    .reduce(function(sum, r) { return sum + (Number(r && r.unitsProduced || 0) || 0); }, 0);
  var productionTodayS2 = productionTodayRows
    .filter(function(r) { return String(r && r.shift || "").toLowerCase().indexOf("shift 2") !== -1; })
    .reduce(function(sum, r) { return sum + (Number(r && r.unitsProduced || 0) || 0); }, 0);
  var productionLatestDate = (productionSegmentsForUI.shiftRows || []).length ? productionSegmentsForUI.shiftRows[0].date : "";
  var productionLatestTotal = (productionSegmentsForUI.shiftRows || [])
    .filter(function(r) { return (r && r.date) === productionLatestDate; })
    .reduce(function(sum, r) { return sum + (Number(r && r.unitsProduced || 0) || 0); }, 0);
  var weekStartEt = (function(dateIso) {
    if (!dateIso) return "";
    var d = new Date(dateIso + "T00:00:00");
    var dow = d.getDay();
    var delta = dow === 0 ? -6 : 1 - dow;
    d.setDate(d.getDate() + delta);
    return d.toISOString().slice(0, 10);
  })(todayEt);
  var shiftDaysIso = function(dateIso, n) {
    if (!dateIso) return "";
    var d = new Date(dateIso + "T00:00:00");
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  };
  var lastWeekStartEt = shiftDaysIso(weekStartEt, -7);
  var lastWeekEndEt = shiftDaysIso(weekStartEt, -1);
  var rowsInRange = function(startIso, endIso) {
    return (productionSegmentsForUI.shiftRows || []).filter(function(r) {
      var date = (r && r.date) || "";
      return date && startIso && endIso && date >= startIso && date <= endIso;
    });
  };
  var thisWeekRows = rowsInRange(weekStartEt, todayEt);
  var lastWeekRows = rowsInRange(lastWeekStartEt, lastWeekEndEt);
  var sumUnits = function(rows) { return rows.reduce(function(sum, r) { return sum + (Number(r && r.unitsProduced || 0) || 0); }, 0); };
  var sumShift = function(rows, token) {
    return rows
      .filter(function(r) { return String(r && r.shift || "").toLowerCase().indexOf(token) !== -1; })
      .reduce(function(sum, r) { return sum + (Number(r && r.unitsProduced || 0) || 0); }, 0);
  };
  var askAiMetrics = {
    todayEt: todayEt,
    workOrdersTotal: summaryForUI.total,
    workOrdersReady: summaryForUI.ready,
    workOrdersBlocked: summaryForUI.blocked,
    supplyRiskItems: criticalItemsForUI.length,
    freshData: freshCount,
    freshDataTotal: dataSourceStatus.length,
    productionTodayCases: productionTodayTotal,
    productionTodayShift1Cases: productionTodayS1,
    productionTodayShift2Cases: productionTodayS2,
    productionLatestDate: productionLatestDate,
    productionLatestCases: productionLatestTotal,
    thisWeekStartEt: weekStartEt,
    thisWeekEndEt: todayEt,
    thisWeekCases: sumUnits(thisWeekRows),
    thisWeekShift1Cases: sumShift(thisWeekRows, "shift 1"),
    thisWeekShift2Cases: sumShift(thisWeekRows, "shift 2"),
    lastWeekStartEt: lastWeekStartEt,
    lastWeekEndEt: lastWeekEndEt,
    lastWeekCases: sumUnits(lastWeekRows),
    lastWeekShift1Cases: sumShift(lastWeekRows, "shift 1"),
    lastWeekShift2Cases: sumShift(lastWeekRows, "shift 2"),
  };
  var marchMonth = (todayEt || "").slice(0, 4) + "-03";
  var marchWOs = (analysisForUI.results || []).filter(function(w) {
    var due = String(w && w.dueDate || "").slice(0, 7);
    return due === marchMonth && !isClosedStatus(w && w.status);
  });
  var marchRemainingUnits = marchWOs.reduce(function(sum, w) {
    var rem = toNumSafe(w && w.unitsRemaining);
    if (!(rem > 0)) {
      var qty = toNumSafe(w && w.qtyToProduce);
      var prod = toNumSafe(w && w.unitsProduced);
      rem = Math.max(0, qty - prod);
    }
    return sum + rem;
  }, 0);
  var businessDaysInMarch = (function() {
    if (!marchMonth) return 0;
    var y = Number(marchMonth.slice(0, 4));
    var m = Number(marchMonth.slice(5, 7));
    if (!y || !m) return 0;
    var d = new Date(y, m - 1, 1);
    var c = 0;
    while (d.getMonth() === m - 1) {
      var dow = d.getDay();
      if (dow !== 0 && dow !== 6) c += 1;
      d.setDate(d.getDate() + 1);
    }
    return c;
  })();
  var businessDaysRemainingInMarch = (function() {
    if (!marchMonth || !todayEt) return 0;
    var start = new Date(todayEt + "T00:00:00");
    var y = Number(marchMonth.slice(0, 4));
    var m = Number(marchMonth.slice(5, 7));
    var end = new Date(y, m, 0);
    if (isNaN(start) || isNaN(end) || start > end) return 0;
    var c = 0;
    var d = new Date(start);
    while (d <= end) {
      var dow = d.getDay();
      if (dow !== 0 && dow !== 6) c += 1;
      d.setDate(d.getDate() + 1);
    }
    return c;
  })();
  askAiMetrics.marchMonth = marchMonth;
  askAiMetrics.marchWorkOrders = marchWOs.length;
  askAiMetrics.marchRemainingUnits = marchRemainingUnits;
  askAiMetrics.marchBusinessDays = businessDaysInMarch;
  askAiMetrics.marchBusinessDaysRemaining = businessDaysRemainingInMarch;
  askAiMetrics.marchDailyTargetFullMonth = businessDaysInMarch ? Math.ceil(marchRemainingUnits / businessDaysInMarch) : 0;
  askAiMetrics.marchDailyTargetRemaining = businessDaysRemainingInMarch ? Math.ceil(marchRemainingUnits / businessDaysRemainingInMarch) : 0;
  var askAiContextLines = [
    "Active view: " + (activeView || "overview"),
    "Work Orders: " + summaryForUI.total + " | Ready: " + summaryForUI.ready + " | Blocked: " + summaryForUI.blocked,
    "Supply risk items: " + criticalItemsForUI.length,
    "Fresh data: " + freshCount + "/" + dataSourceStatus.length + " | Produced today: " + productionTodayTotal,
    "March due remaining: " + marchRemainingUnits + " over " + businessDaysRemainingInMarch + " business days",
  ];
  var syncProgress = (() => {
    var reportStates = nulogySyncState && nulogySyncState.reportStates ? nulogySyncState.reportStates : null;
    var steps = [
      { key:"inventory", label:"Inventory" },
      { key:"workorders", label:"Work Orders" },
      { key:"itemmaster", label:"Item Master" },
      { key:"bom", label:"BOM" },
      { key:"production", label:"Production" },
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
  var hasAnySyncedData = !!(ds.invTimestamp || ds.woTimestamp || ds.productionTimestamp || ds.bomTimestamp || ds.edrTimestamp || ds.dockTimestamp);
  var hasSyncErrors = !!dockApiError || !!(nulogySyncState && nulogySyncState.errorCount > 0);
  var syncHealthy = showAutoBootstrap && hasAnySyncedData && !isActivelySyncing && !hasSyncErrors;
  var showSyncBannerContainer = showSyncBanner;
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
  useEffect(() => {
    if (!syncHealthy) setShowQuickControls(false);
  }, [syncHealthy]);
  useEffect(() => {
    if (syncHealthy && !showQuickControls && showDataControlsPanel) {
      setShowDataControlsPanel(false);
    }
  }, [syncHealthy, showQuickControls, showDataControlsPanel]);
  useEffect(() => {
    if (showUserActivity) loadUserActivity();
  }, [showUserActivity, loadUserActivity]);
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
  useEffect(function() {
    if (activeView === "production") setActiveView("operations");
  }, [activeView]);
  useEffect(function() {
    if (activeView === "recommendations") setActiveView("workorders");
  }, [activeView]);
  useEffect(function() {
    if (activeView === "criticalitems" || activeView === "timeline") setActiveView("supplyrisk");
  }, [activeView]);

  /* ====== MAIN RENDER ====== */
  return (
    <div className="min-h-screen bg-[rgb(var(--background))] text-[rgb(var(--foreground))]" style={{ fontFamily:sans }}>
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-3 py-2 sm:gap-3 sm:px-4 md:px-7">
        <div className="flex items-center gap-2">
          <h1 className="m-0 text-lg font-bold tracking-[-0.2px] text-[rgb(var(--foreground))]" style={{ fontFamily:sans }}>PackPulse</h1>
          <span className="rounded-full border border-[rgb(var(--border))] bg-white px-2 py-0.5 text-[11px] font-medium text-[rgb(var(--muted))]">REV Copack</span>
        </div>
        <div className="flex w-full items-center justify-end gap-2.5 sm:w-auto">
          {window.__ppUser && <span className="max-w-[150px] truncate text-xs text-[rgb(var(--muted))] sm:max-w-none sm:text-sm">{window.__ppUser.email}</span>}
          {window.__ppLogout && <Button onClick={window.__ppLogout} variant="outline" size="sm">Sign out</Button>}
          {syncHealthy && (
            <Button onClick={() => setShowQuickControls(v => !v)} variant={showQuickControls ? "active" : "outline"} size="sm" title="Data & sync controls">
              ⚙
            </Button>
          )}
          <Button onClick={() => setTheme(theme==="dark"?"light":"dark")} variant="outline" size="sm">
            {theme === "dark" ? "Light" : "Dark"}
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-[1440px] px-3 py-2.5 sm:px-4 sm:py-3 md:px-7">
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
            Dashboard / <span className="font-semibold text-[rgb(var(--foreground))]">Data Setup</span>
          </div>
          <Button onClick={goToDashboard} variant="outline" size="sm">
            Back to Dashboard
          </Button>
        </div>
        {showAutoBootstrap && !showDataSetup && (
          <div className="mb-4 flex flex-wrap items-center gap-2.5 rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-3.5 py-3">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
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
          {dockApiInfo && <span className="text-xs text-[rgb(var(--success))]">{dockApiInfo}</span>}
          {dockApiError && <span className="text-xs text-[rgb(var(--danger))]">OpenDock API error: {dockApiError}</span>}
        </div>
        </>)}
        {ds.allUploaded && !ds.analyzing && (
          <Button onClick={() => { ds.setAnalyzing(true); setTimeout(() => { ds.setMappingConfirmed(true); ds.setAnalyzing(false); setShowDataSetup(false); setTimeout(() => { var el = document.getElementById("dashboard-main"); if (el && el.scrollIntoView) el.scrollIntoView({ behavior:"smooth", block:"start" }); }, 0); }, 1500); }} disabled={!ds.requiredMappingsMet} variant={ds.requiredMappingsMet ? "default" : "soft"} size="default">
            Analyze
          </Button>
        )}
        {ds.allUploaded && ds.analyzing && (
          <Card className="mb-5 px-5 py-8 text-center">
            <div className="mb-3 inline-block h-7 w-7 animate-spin rounded-full border-2 border-[rgb(var(--border))] border-t-[rgb(var(--accent))]" />
            <div className="text-base font-semibold text-[rgb(var(--foreground))]">Analyzing</div>
            <div className="mt-1 text-sm text-[rgb(var(--muted))]">Mapping columns and processing data...</div>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </Card>
        )}

        {(!showAutoBootstrap || showDataSetup) && <div className="mt-7 border-t border-[rgb(var(--border))] pt-6">
          <div className="mb-4 text-[15px] font-bold text-[rgb(var(--foreground))]">How PackPulse Works</div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">

            <Card className="px-[18px] py-4">
              <div className="mb-1.5 text-sm font-bold text-[rgb(var(--accent))]">1. SKU Matching</div>
              <div className="text-[13px] leading-[1.6] text-[rgb(var(--muted))]">
                Each Work Order has a product SKU that PackPulse normalizes (lowercased, trimmed, special characters removed) and matches against your Inventory and BOM files. This means "114715", " 114715 ", and "114715.0" all match correctly.
              </div>
            </Card>

            <Card className="px-[18px] py-4">
              <div className="mb-1.5 text-sm font-bold text-[rgb(var(--accent))]">2. Material Readiness</div>
              <div className="text-[13px] leading-[1.6] text-[rgb(var(--muted))]">
                When a BOM is loaded, PackPulse explodes each Work Order into its component materials. It compares <span className="text-[rgb(var(--foreground))]">Qty Needed</span> (BOM qty per unit {"\u00D7"} order qty) against <span className="text-[rgb(var(--foreground))]">On Hand</span> from Inventory. The lowest component fill rate becomes the WO's readiness %. <span className="text-[rgb(var(--foreground))]">Can Make</span> shows the max units producible with current stock.
              </div>
            </Card>

            <Card className="px-[18px] py-4">
              <div className="mb-1.5 text-sm font-bold text-[rgb(var(--accent))]">3. Substitutes & Alternates</div>
              <div className="text-[13px] leading-[1.6] text-[rgb(var(--muted))]">
                BOMs can include substitute components. PackPulse groups primary and alternate materials together and pools their inventory {"\u2014"} if the primary is short but an approved alternate has stock, the combined quantity is used for readiness calculations.
              </div>
            </Card>

            <Card className="px-[18px] py-4">
              <div className="mb-1.5 text-sm font-bold text-[rgb(var(--accent))]">4. Production Progress</div>
              <div className="text-[13px] leading-[1.6] text-[rgb(var(--muted))]">
                Work Order fields like <span className="text-[rgb(var(--foreground))]">Units Produced</span>, <span className="text-[rgb(var(--foreground))]">Units Remaining</span>, and <span className="text-[rgb(var(--foreground))]">Standard Units/Hour</span> power the completion % and estimated run hours. Past-due detection compares due dates against today's date for WOs with remaining units.
              </div>
            </Card>

            <Card className="px-[18px] py-4">
              <div className="mb-1.5 text-sm font-bold text-[rgb(var(--accent))]">5. Column Auto-Detection</div>
              <div className="text-[13px] leading-[1.6] text-[rgb(var(--muted))]">
                PackPulse scans your column headers against known patterns (e.g., "Item Code" {"\u2192"} SKU, "Qty On Hand" {"\u2192"} stock level). If a column doesn't map correctly, use the <span className="text-[rgb(var(--foreground))]">Settings</span> panel after analysis to manually adjust any field mapping.
              </div>
            </Card>

            <Card className="px-[18px] py-4">
              <div className="mb-1.5 text-sm font-bold text-[rgb(var(--accent))]">6. Optional Data Sources</div>
              <div className="text-[13px] leading-[1.6] text-[rgb(var(--muted))]">
                <span className="text-[rgb(var(--foreground))]">BOM</span> {"\u2014"} enables component-level readiness (saved between sessions). <span className="text-[rgb(var(--foreground))]">EDR</span> {"\u2014"} inbound delivery data for the Delivery Timeline. <span className="text-[rgb(var(--foreground))]">OpenDock</span> {"\u2014"} dock appointment statuses.
              </div>
            </Card>

          </div>
        </div>}
      </div>)}

      <div id="dashboard-main">
        <input ref={ds.invRefreshRef} type="file" accept=".csv" className="hidden" onChange={e => {ds.handleRefreshFile("inv",e.target.files[0]);e.target.value="";}} />
        <input ref={ds.bomRefreshRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={e => {ds.handleRefreshFile("bom",e.target.files[0]);e.target.value="";}} />
        <input ref={ds.woRefreshRef} type="file" accept=".csv" className="hidden" onChange={e => {ds.handleRefreshFile("wo",e.target.files[0]);e.target.value="";}} />
        <input ref={ds.edrRefreshRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => {ds.handleRefreshFile("edr",e.target.files[0]);e.target.value="";}} />
        <input ref={ds.dockRefreshRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => {ds.handleRefreshFile("dock",e.target.files[0]);e.target.value="";}} />

        {showSyncBannerContainer ? (
          <div className="mb-2.5 rounded-md border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-2.5 py-2">
            <div className="flex flex-wrap items-center gap-2">
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
          </div>
        ) : null}

        {syncHealthy && showQuickControls && (
          <div className="mb-1.5 rounded-md border border-[rgb(var(--border))] bg-[rgb(var(--surface))] p-2.5">
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              <Button onClick={() => setShowDataControlsPanel(v => !v)} variant={showDataControlsPanel ? "active" : "outline"} size="sm">
                {showDataControlsPanel ? "Hide Data Controls" : "Data Controls"}
              </Button>
              <Button onClick={() => setShowSettings(!showSettings)} variant={showSettings ? "active" : "outline"} size="sm">Data Mapping</Button>
              <Button onClick={() => setShowUserActivity(v => !v)} variant={showUserActivity ? "active" : "outline"} size="sm">User Activity</Button>
              <span className="text-xs text-[rgb(var(--muted))]">
                <span style={{ color:freshCount===dataSourceStatus.length?C.ok:freshCount>=3?C.warn:C.bad, fontWeight:600 }}>{freshCount}/{dataSourceStatus.length}</span> fresh · updated {summaryStamp}
              </span>
              <span className="text-xs text-[rgb(var(--muted))]">
                · {sharedSourceLabel}: {sharedStamp}{sharedMeta.source === "shared" ? " · " + sharedBy : ""}
              </span>
            </div>
          </div>
        )}
        {!syncHealthy && (
        <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
          <Button onClick={() => setShowDataControlsPanel(v => !v)} variant={showDataControlsPanel ? "active" : "outline"} size="sm">
            {showDataControlsPanel ? "Hide Data Controls" : "Data Controls"}
          </Button>
          <Button onClick={() => setShowSettings(!showSettings)} variant={showSettings ? "active" : "outline"} size="sm">Data Mapping</Button>
          <span className="text-xs text-[rgb(var(--muted))]">
            <span style={{ color:freshCount===dataSourceStatus.length?C.ok:freshCount>=3?C.warn:C.bad, fontWeight:600 }}>{freshCount}/{dataSourceStatus.length}</span> fresh · updated {summaryStamp}
          </span>
          <span className="text-xs text-[rgb(var(--muted))]">
            · {sharedSourceLabel}: {sharedStamp}{sharedMeta.source === "shared" ? " · " + sharedBy : ""}
          </span>
        </div>
        )}
        {showDataControlsPanel && (!syncHealthy || showQuickControls) && (
          <div className="mb-2 rounded-md border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-3 py-2">
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
              <Button onClick={() => setShowUserActivity(v => !v)} variant={showUserActivity ? "active" : "outline"} size="sm">
                User Activity
              </Button>
            </div>
            {showUserActivity && (
              <div className="mb-2 rounded-md border border-[rgb(var(--border))] bg-white px-2.5 py-2">
                <div className="mb-1 flex items-center justify-between">
                  <div className="text-xs font-semibold text-[rgb(var(--foreground))]">Recent Logins</div>
                  <Button variant="outline" size="sm" onClick={loadUserActivity} disabled={userActivityLoading}>
                    {userActivityLoading ? "Loading..." : "Refresh"}
                  </Button>
                </div>
                {userActivityError ? (
                  <div className="text-xs text-[rgb(var(--danger))]">{userActivityError}</div>
                ) : userActivityRows.length ? (
                  <div className="space-y-1">
                    {userActivityRows.slice(0, 8).map(function(row) {
                      return (
                        <div key={row.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[rgb(var(--muted))]">
                          <span className="font-medium text-[rgb(var(--foreground))]">{row.user_email || "--"}</span>
                          <span>{fmtClock(row.created_at)}</span>
                          <span>{row.auth_provider || "auth"}</span>
                          <span className="opacity-70">{row.source || "--"}</span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-xs text-[rgb(var(--muted))]">No login events yet.</div>
                )}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-1.5">
              {dataSourceStatus.map(function(s) {
                var sl = staleLevel(s.ts, s.cad); var dc = sl==="fresh"?C.ok:sl==="stale"?C.warn:C.bad;
                return <button key={s.k} onClick={s.ref} className="inline-flex items-center gap-1.5 rounded-md border border-[rgb(var(--border))] bg-white px-2.5 py-1 text-xs font-medium text-[rgb(var(--muted))]">
                  <span style={{ width:6, height:6, borderRadius:"50%", background:dc }} />{s.l} <span style={{ opacity:0.6 }}>{fmtTs(s.ts)}</span>
                </button>;
              })}
              <span className="inline-flex items-center gap-1.5 rounded-md border border-[rgb(var(--border))] bg-white px-2.5 py-1 text-xs font-medium text-[rgb(var(--muted))]">
                <span style={{ width:6, height:6, borderRadius:"50%", background:sharedMeta.source==="shared"?C.ok:sharedMeta.source==="local"?C.warn:C.dim }} />
                {sharedSourceLabel}
                <span style={{ opacity:0.6 }}>{sharedStamp}</span>
              </span>
            </div>
          </div>
        )}
        {dockApiError && <div className="-mt-2 mb-2.5 text-xs text-[rgb(var(--danger))]">OpenDock API error: {dockApiError}</div>}

        {showSettings && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50" onClick={e => { if (e.target === e.currentTarget) setShowSettings(false); }}>
            <div className="max-h-[80vh] w-[90%] max-w-[720px] overflow-y-auto rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--surface))] p-6">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <div className="text-base font-semibold text-[rgb(var(--foreground))]">Column Mapping</div>
                  <div className="mt-0.5 text-sm text-[rgb(var(--muted))]">Adjust how your file columns map to the analysis engine. <span className="text-[rgb(var(--danger))]">*</span> = required</div>
                </div>
                <Button onClick={() => setShowSettings(false)} variant="outline" size="sm">{"\u2715"}</Button>
              </div>
              <ColumnMapper title="Inventory" headers={ds.invHeaders} mapping={ds.invMapping} onMappingChange={ds.setInvMapping} fields={[{key:"sku",label:"Item / SKU",required:true},{key:"description",label:"Description"},{key:"qtyOnHand",label:"Qty On Hand",required:true},{key:"status",label:"Inventory Status",help:"If mapped, PackPulse uses only rows marked Good."}]} />
              {ds.boms && <ColumnMapper title="Bill of Materials" headers={ds.bomHeaders} mapping={ds.bomMapping} onMappingChange={ds.setBomMapping} fields={[{key:"bomId",label:"Finished Good",required:true},{key:"componentSku",label:"Component SKU",required:true},{key:"description",label:"Description (optional)",help:"Used for component naming in details. If blank, PackPulse falls back to Item Master / Inventory descriptions."},{key:"qtyPer",label:"Qty Per",required:true},{key:"substituteFor",label:"Substitute For"},{key:"priority",label:"Priority"}]} />}
              <ColumnMapper title="Work Orders" headers={ds.woHeaders} mapping={ds.woMapping} onMappingChange={ds.setWoMapping} fields={[{key:"woNumber",label:"WO Number",required:true},{key:"productSku",label:"Product SKU",required:true},{key:"qtyToProduce",label:"Qty to Produce",required:true},{key:"dueDate",label:"Due Date"},{key:"status",label:"Status"},{key:"customer",label:"Customer"},{key:"unitsProduced",label:"Units Produced"},{key:"unitsRemaining",label:"Units Remaining"},{key:"unitsPerHour",label:"Units/Hour"},{key:"standardPeople",label:"Crew Size"},{key:"plannedStart",label:"Planned Start"},{key:"plannedEnd",label:"Planned End"},{key:"reference1",label:"Reference / Notes"}]} />
              <div className="mt-4 flex justify-end">
                <Button onClick={() => setShowSettings(false)} variant="default" size="default">Done</Button>
              </div>
            </div>
          </div>
        )}

        <TabsNav
          activeKey={activeView}
          onChange={setActiveView}
          items={[{key:"overview",label:"Overview",count:null,alert:false},{key:"operations",label:"Operations",count:(productionSegmentsForUI.jobRows || []).length,alert:false},{key:"workorders",label:"Work Orders",count:summaryForUI.total},{key:"supplyrisk",label:"Supply Risk",count:criticalItemsForUI.length,alert:false}]
            .concat([{key:"sandbox",label:"Sandbox",count:null,alert:false}])}
        />

        <Suspense fallback={<div className="px-0 py-2 text-sm text-[rgb(var(--muted))]">Loading view...</div>}>
          {activeView === "overview" && <OverviewView analysis={analysisForUI} woStatuses={woStatusesForUI} onSelectCustomer={openWorkOrdersForCustomer} />}
          {activeView === "operations" && <OperationsView productionSegments={productionSegmentsForUI} />}
          {activeView === "workorders" && <WorkOrdersView analysis={analysisForUI} woStatuses={woStatusesForUI} woCustomers={woCustomersForUI} recommendations={recommendationsForUI} dispatchQueue={dispatchQueue || []} prefilterCustomer={workOrdersPrefilterCustomer} prefilterNonce={workOrdersPrefilterNonce} />}
          {activeView === "supplyrisk" && <SupplyRiskView rawCriticalItems={criticalItemsForUI} inboundCoverage={inboundCoverage} timelineData={timelineData} deliveriesV2={deliveriesV2} />}
          {activeView === "sandbox" && <SandboxView />}
          {activeView === "flags" && <FlagsView flags={analysisForUI.flags} />}
        </Suspense>

      </div>
      </main>
      <Button
        onClick={() => setShowAskAi(true)}
        className="fixed bottom-4 right-4 z-[105] shadow-lg"
        size="sm"
      >
        Ask AI
      </Button>
      <AskAiPanel
        open={showAskAi}
        onClose={() => setShowAskAi(false)}
        activeView={activeView}
        contextLines={askAiContextLines}
        metrics={askAiMetrics}
      />
    </div>
  );
}
