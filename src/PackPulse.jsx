import { Suspense, lazy, useState, useCallback, useEffect, useRef } from "react";
import NulogySync from "./NulogySync";
import { useTheme } from "./theme";
import { useDataSources } from "./hooks/useDataSources";
import { useAnalysis } from "./hooks/useAnalysis";
import ColumnMapper from "./components/ColumnMapper";
import FileUploader from "./components/FileUploader";
import { normalizeInboundRows } from "./lib/inboundData";
import { Button } from "./components/ui/button";
import { Badge } from "./components/ui/badge";
import { Progress } from "./components/ui/progress";
import TabsNav from "./components/ui/tabs-nav";
import { Card } from "./components/ui/card";
import AskAiPanel from "./components/AskAiPanel";

function areStructuredValuesEqual(left, right) {
  if (left === right) return true;
  var leftIsArray = Array.isArray(left);
  var rightIsArray = Array.isArray(right);
  if (leftIsArray !== rightIsArray) return false;
  if (leftIsArray && rightIsArray && left.length !== right.length) return false;
  try {
    return JSON.stringify(left || null) === JSON.stringify(right || null);
  } catch (_error) {
    return false;
  }
}

function autoSyncCheckpointKey(mode) {
  return "packpulse:auto-sync-checkpoint:" + String(mode || "full");
}

function readAutoSyncCheckpoint(mode) {
  if (typeof window === "undefined" || !window.sessionStorage) return 0;
  var raw = Number(window.sessionStorage.getItem(autoSyncCheckpointKey(mode)) || "0");
  return Number.isFinite(raw) ? raw : 0;
}

function writeAutoSyncCheckpoint(mode, value) {
  if (typeof window === "undefined" || !window.sessionStorage) return;
  var nextValue = Number(value || 0);
  window.sessionStorage.setItem(autoSyncCheckpointKey(mode), String(Number.isFinite(nextValue) ? nextValue : 0));
}

var operationsViewImportPromise = null;
var analyticsViewImportPromise = null;
var operationsInsightsPanelImportPromise = null;
var forecastViewImportPromise = null;
var inventoryViewImportPromise = null;
var invoicingViewImportPromise = null;
var reportingViewImportPromise = null;
var onboardingViewImportPromise = null;
var calendarViewImportPromise = null;
var purchaseOrdersViewImportPromise = null;

function importOperationsView() {
  if (!operationsViewImportPromise) operationsViewImportPromise = import("./views/OperationsView");
  return operationsViewImportPromise;
}

function importAnalyticsView() {
  if (!analyticsViewImportPromise) analyticsViewImportPromise = import("./views/AnalyticsView");
  return analyticsViewImportPromise;
}

function importOperationsInsightsPanel() {
  if (!operationsInsightsPanelImportPromise) operationsInsightsPanelImportPromise = import("./views/OperationsInsightsPanel");
  return operationsInsightsPanelImportPromise;
}

function importForecastView() {
  if (!forecastViewImportPromise) forecastViewImportPromise = import("./views/ForecastView");
  return forecastViewImportPromise;
}

function importInventoryView() {
  if (!inventoryViewImportPromise) inventoryViewImportPromise = import("./views/InventoryView");
  return inventoryViewImportPromise;
}

function importInvoicingView() {
  if (!invoicingViewImportPromise) invoicingViewImportPromise = import("./views/InvoicingView");
  return invoicingViewImportPromise;
}

function importReportingView() {
  if (!reportingViewImportPromise) reportingViewImportPromise = import("./views/ReportingView");
  return reportingViewImportPromise;
}

function importOnboardingView() {
  if (!onboardingViewImportPromise) onboardingViewImportPromise = import("./views/OnboardingView");
  return onboardingViewImportPromise;
}

function importCalendarView() {
  if (!calendarViewImportPromise) calendarViewImportPromise = import("./views/CalendarView");
  return calendarViewImportPromise;
}

function importPurchaseOrdersView() {
  if (!purchaseOrdersViewImportPromise) purchaseOrdersViewImportPromise = import("./views/PurchaseOrdersView");
  return purchaseOrdersViewImportPromise;
}

function prefetchOperationsView() {
  return Promise.all([
    importOperationsView(),
    importOperationsInsightsPanel()
  ]).catch(function() {});
}

function prefetchAnalyticsView() {
  return importAnalyticsView().catch(function() {});
}

function prefetchForecastView() {
  return importForecastView().catch(function() {});
}

function prefetchInventoryView() {
  return importInventoryView().catch(function() {});
}

function prefetchInvoicingView() {
  return importInvoicingView().catch(function() {});
}

function prefetchReportingView() {
  return importReportingView().catch(function() {});
}

function prefetchOnboardingView() {
  return importOnboardingView().catch(function() {});
}

function prefetchCalendarView() {
  return importCalendarView().catch(function() {});
}

function prefetchPurchaseOrdersView() {
  return importPurchaseOrdersView().catch(function() {});
}

function prefetchLikelyNextViews(activeView) {
  var prefetchers = [];
  if (activeView !== "operations") prefetchers.push(prefetchOperationsView);
  if (activeView !== "inventory") prefetchers.push(prefetchInventoryView);
  if (activeView !== "forecast") prefetchers.push(prefetchForecastView);
  if (activeView !== "invoicing") prefetchers.push(prefetchInvoicingView);
  if (activeView !== "reporting") prefetchers.push(prefetchReportingView);
  if (activeView !== "onboarding") prefetchers.push(prefetchOnboardingView);
  if (activeView !== "calendar") prefetchers.push(prefetchCalendarView);
  if (activeView !== "purchaseorders") prefetchers.push(prefetchPurchaseOrdersView);
  return prefetchers.reduce(function(chain, prefetch) {
    return chain.then(function() {
      return prefetch();
    });
  }, Promise.resolve());
}

function lazyViewRecoveryKey(name) {
  return "packpulse:lazy-view-recovery:" + String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

function scheduleLazyViewRecovery(name) {
  if (typeof window === "undefined" || !window.sessionStorage) return false;
  var key = lazyViewRecoveryKey(name);
  if (window.sessionStorage.getItem(key) === "1") return false;
  window.sessionStorage.setItem(key, "1");
  window.setTimeout(function() {
    try {
      window.location.reload();
    } catch (_error) {}
  }, 0);
  return true;
}

function clearLazyViewRecovery(name) {
  if (typeof window === "undefined" || !window.sessionStorage) return;
  window.sessionStorage.removeItem(lazyViewRecoveryKey(name));
}

function lazySafe(importer, name) {
  return lazy(function() {
    return importer()
      .then(function(mod) {
        if (mod && mod.default) {
          clearLazyViewRecovery(name);
          return mod;
        }
        if (mod && typeof mod === "object") {
          var keys = Object.keys(mod);
          for (var i = 0; i < keys.length; i++) {
            var k = keys[i];
            var candidate = mod[k];
            if (typeof candidate === "function") {
              clearLazyViewRecovery(name);
              return { default: candidate };
            }
          }
        }
        console.error("[PackPulse] Lazy view module missing component export:", name, mod);
        var isRecoveringMissing = scheduleLazyViewRecovery(name);
        return {
          default: function MissingView() {
            return (
              <Card className="mt-3 p-4 text-sm text-[rgb(var(--danger))]">
                {isRecoveringMissing ? ("Refreshing " + name + " view...") : ("Could not load " + name + " view.")}
              </Card>
            );
          }
        };
      })
      .catch(function(error) {
        console.error("[PackPulse] Lazy view import failed:", name, error);
        var isRecoveringFailed = scheduleLazyViewRecovery(name);
        return {
          default: function FailedView() {
            return (
              <Card className="mt-3 p-4 text-sm text-[rgb(var(--danger))]">
                {isRecoveringFailed ? ("Refreshing " + name + " view...") : ("Failed to load " + name + " view.")}
              </Card>
            );
          }
        };
      });
  });
}

function normalizeLooseKey(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function pickLooseInventoryField(row, keys) {
  if (!row || typeof row !== "object") return "";
  var rowKeys = Object.keys(row);
  for (var i = 0; i < keys.length; i++) {
    var wanted = normalizeLooseKey(keys[i]);
    for (var j = 0; j < rowKeys.length; j++) {
      if (normalizeLooseKey(rowKeys[j]) === wanted) return row[rowKeys[j]];
    }
  }
  return "";
}

function pickLooseRowField(row, keys) {
  if (!row || typeof row !== "object") return "";
  var rowKeys = Object.keys(row);
  for (var i = 0; i < keys.length; i++) {
    var wanted = normalizeLooseKey(keys[i]);
    for (var j = 0; j < rowKeys.length; j++) {
      if (normalizeLooseKey(rowKeys[j]) === wanted) return row[rowKeys[j]];
    }
  }
  return "";
}

function measureJsonBytes(value) {
  var text = "";
  try {
    text = JSON.stringify(value || {});
  } catch (_error) {
    return 0;
  }
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(text).length;
  }
  return unescape(encodeURIComponent(text)).length;
}

var LABOR_SYNC_MONTH_INDEX = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12
};

function toEasternDateKey(date) {
  if (!(date instanceof Date) || isNaN(date)) return "";
  var parts = {};
  new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date).forEach(function(part) {
    if (part.type !== "literal") parts[part.type] = part.value;
  });
  if (!parts.year || !parts.month || !parts.day) return "";
  return parts.year + "-" + parts.month + "-" + parts.day;
}

function parseLooseDateKey(value) {
  var raw = String(value || "").trim();
  if (!raw) return "";

  var isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T].*)?$/);
  if (isoMatch) return isoMatch[1] + "-" + isoMatch[2] + "-" + isoMatch[3];

  var namedMatch = raw.match(/^(\d{4})-([A-Za-z]{3})-(\d{1,2})(?:[ T].*)?$/);
  if (namedMatch) {
    var namedMonth = LABOR_SYNC_MONTH_INDEX[String(namedMatch[2] || "").toLowerCase()];
    if (namedMonth) {
      return namedMatch[1] + "-" + String(namedMonth).padStart(2, "0") + "-" + String(parseInt(namedMatch[3], 10)).padStart(2, "0");
    }
  }

  var slashMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T].*)?$/);
  if (slashMatch) {
    return slashMatch[3] + "-" + String(parseInt(slashMatch[1], 10)).padStart(2, "0") + "-" + String(parseInt(slashMatch[2], 10)).padStart(2, "0");
  }

  var parsed = new Date(raw);
  return isNaN(parsed) ? "" : toEasternDateKey(parsed);
}

function extractLaborSyncDateKey(row) {
  var explicitDate = pickLooseRowField(row, [
    "Worked Date ET",
    "worked_date_et",
    "Worked Date",
    "worked_date",
    "Work Date",
    "work_date",
    "Date",
    "date"
  ]);
  var explicitKey = parseLooseDateKey(explicitDate);
  if (explicitKey) return explicitKey;
  return parseLooseDateKey(pickLooseRowField(row, [
    "Clock In Time",
    "clock_in_time",
    "Clock In At",
    "clock_in_at",
    "Clocked In At",
    "clocked_in_at",
    "Started At",
    "started_at",
    "Clock Out Time",
    "clock_out_time",
    "Clock Out At",
    "clock_out_at",
    "Clocked Out At",
    "clocked_out_at",
    "Ended At",
    "ended_at"
  ]));
}

function buildLaborSyncBatches(rows) {
  var grouped = {};
  var undated = [];
  var batches = [];
  var maxRowsPerBatch = 450;
  var maxDatesPerBatch = 7;
  var maxRequestBytes = 350000;

  (Array.isArray(rows) ? rows : []).forEach(function(row) {
    var dateKey = extractLaborSyncDateKey(row);
    if (!dateKey) {
      undated.push(row);
      return;
    }
    if (!grouped[dateKey]) grouped[dateKey] = [];
    grouped[dateKey].push(row);
  });

  var dateKeys = Object.keys(grouped).sort();
  var currentRows = [];
  var currentDateCount = 0;

  function flushCurrent() {
    if (!currentRows.length) return;
    batches.push(currentRows.slice());
    currentRows = [];
    currentDateCount = 0;
  }

  dateKeys.forEach(function(dateKey) {
    var dateRows = grouped[dateKey] || [];
    var nextRows = currentRows.concat(dateRows);
    var nextBytes = measureJsonBytes({
      rows: nextRows,
      syncedAt: "2000-01-01T00:00:00.000Z",
      refresh: false
    });
    var shouldFlushFirst = currentRows.length > 0 && (
      nextRows.length > maxRowsPerBatch ||
      (currentDateCount + 1) > maxDatesPerBatch ||
      nextBytes > maxRequestBytes
    );
    if (shouldFlushFirst) flushCurrent();
    currentRows = currentRows.concat(dateRows);
    currentDateCount += 1;
  });

  if (undated.length) {
    var undatedCandidate = currentRows.concat(undated);
    var undatedBytes = measureJsonBytes({
      rows: undatedCandidate,
      syncedAt: "2000-01-01T00:00:00.000Z",
      refresh: false
    });
    if (currentRows.length > 0 && (undatedCandidate.length > maxRowsPerBatch || undatedBytes > maxRequestBytes)) {
      flushCurrent();
    }
    currentRows = currentRows.concat(undated);
  }

  flushCurrent();
  return batches;
}

async function postJsonOrThrow(url, payload, label) {
  var response = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  var rawText = await response.text();
  var body = null;
  if (rawText) {
    try {
      body = JSON.parse(rawText);
    } catch (_error) {
      body = null;
    }
  }
  if (!response.ok || (body && body.ok === false)) {
    var detail = [
      body && body.error,
      body && body.details,
      body && body.message,
      body && body.laborStatus,
      body && body.productionStatus
    ].filter(Boolean).join(": ");
    if (!detail && rawText) detail = rawText.slice(0, 220);
    throw new Error(label + " failed (" + response.status + "): " + (detail || ("HTTP " + response.status)));
  }
  return body;
}

async function writeLaborRowsToCache(rows, syncedAt) {
  var batches = buildLaborSyncBatches(rows);
  var responses = [];
  for (var i = 0; i < batches.length; i++) {
    responses.push(await postJsonOrThrow("/api/cache/labor-events", {
      rows: batches[i],
      syncedAt: syncedAt,
      refresh: i === (batches.length - 1)
    }, "Labor event ingest batch " + (i + 1) + "/" + batches.length));
  }
  return responses;
}

const OperationsView = lazySafe(importOperationsView, "Operations");
const AnalyticsView = lazySafe(importAnalyticsView, "Analytics");
const ForecastView = lazySafe(importForecastView, "Forecast");
const WorkOrdersView = lazySafe(function() { return import("./views/WorkOrdersView"); }, "Work Orders");
const InventoryView = lazySafe(importInventoryView, "Inventory");
const InvoicingView = lazySafe(importInvoicingView, "Invoicing");
const ReportingView = lazySafe(importReportingView, "Reporting");
const OnboardingView = lazySafe(importOnboardingView, "Onboarding");
const CalendarView = lazySafe(importCalendarView, "Calendar");
const PurchaseOrdersView = lazySafe(importPurchaseOrdersView, "Purchase Orders");
const SupplyRiskView = lazySafe(function() { return import("./views/SupplyRiskView"); }, "Supply Risk");
const ItemMasterView = lazySafe(function() { return import("./views/ItemMasterView"); }, "Item Master");
const FlagsView = lazySafe(function() { return import("./views/FlagsView"); }, "Data Flags");
const AICopilotView = lazySafe(function() { return import("./views/AICopilotView"); }, "AI Copilot");

export default function ProductionReadiness() {
  const { C, theme, setTheme, sans, mono } = useTheme();
  const AUTO_SYNC_MS = 15 * 60 * 1000;
  const FULL_AUTO_SYNC_FRESH_MS = 30 * 60 * 1000;
  const PRODUCTION_AUTO_SYNC_FRESH_MS = 15 * 60 * 1000;
  const FULL_AUTO_SYNC_MIN_INTERVAL_MS = 60 * 60 * 1000;
  const PRODUCTION_AUTO_SYNC_MIN_INTERVAL_MS = 20 * 60 * 1000;
  const FULL_AUTO_SYNC_RETRY_BACKOFF_MS = 10 * 60 * 1000;
  const PRODUCTION_AUTO_SYNC_RETRY_BACKOFF_MS = 5 * 60 * 1000;
  const ds = useDataSources();
  const { analysis, summary, criticalItems, woStatuses, woCustomers, timelineData, deliveriesV2, inboundCoverage, recommendations, dispatchQueue, productionSegments } = useAnalysis({
    mappingConfirmed: ds.mappingConfirmed, allUploaded: ds.allUploaded,
    inventory: ds.inventory, itemMaster: ds.itemMaster, boms: ds.boms, workOrders: ds.workOrders,
    productionData: ds.productionData,
    invMapping: ds.invMapping, bomMapping: ds.bomMapping, woMapping: ds.woMapping,
    edrData: ds.edrData, edrTimestamp: ds.edrTimestamp, dockData: ds.dockData, dockTimestamp: ds.dockTimestamp,
  });

  var parseInitialPermalink = function() {
    if (typeof window === "undefined") return { view: "workorders", wo: {}, forecast: {}, operations: {}, invoicing: {} };
    var qs = new URLSearchParams(window.location.search || "");
    var allowedViews = { aicopilot:true, operations:true, analytics:true, invoicing:true, reporting:true, forecast:true, workorders:true, purchaseorders:true, inventory:true, onboarding:true, calendar:true, supplyrisk:true, flags:true, itemmaster:true };
    var rawView = String(qs.get("view") || "workorders");
    if (rawView === "overview") rawView = "workorders";
    var view = allowedViews[rawView] ? rawView : "workorders";
    var preset = String(qs.get("preset") || "").trim().toLowerCase();
    var legacyMonth = String(qs.get("wo_month") || "").trim();
    var start = String(qs.get("wo_start") || "").trim();
    var end = String(qs.get("wo_end") || "").trim();
    if ((!start || !end) && /^\d{4}-\d{2}$/.test(legacyMonth)) {
      start = legacyMonth + "-01";
      var legacyMonthDate = new Date(legacyMonth + "-01T00:00:00");
      if (!isNaN(legacyMonthDate)) {
        var legacyMonthEnd = new Date(legacyMonthDate.getFullYear(), legacyMonthDate.getMonth() + 1, 0);
        end = legacyMonthEnd.toISOString().slice(0, 10);
      }
    }
    var wo = {
      q: String(qs.get("wo_q") || ""),
      runStatus: String(qs.get("wo_run_status") || "all"),
      woStatus: String(qs.get("wo_wo_status") || "Booked"),
      customer: String(qs.get("wo_customer") || "all"),
      start: start,
      end: end,
      packType: String(qs.get("wo_pack") || "all"),
      pastDue: qs.get("wo_past_due") === "1",
      shared: qs.get("wo_shared") === "1",
      runNext: qs.get("wo_run_next") === "1",
      batchable: qs.get("wo_batchable") === "1",
      runNextLimit: String(qs.get("wo_run_next_limit") || "12"),
      sortField: String(qs.get("wo_sort_field") || "dispatchRank"),
      sortDir: String(qs.get("wo_sort_dir") || "asc"),
      preset: preset
    };
    if (preset === "run-next") {
      wo.runNext = true;
      wo.woStatus = "all";
      wo.runStatus = "all";
      wo.sortField = "dispatchRank";
      wo.sortDir = "asc";
    } else if (preset === "shared") {
      wo.shared = true;
    } else if (preset === "blocked") {
      wo.runStatus = "blocked";
    } else if (preset === "ready") {
      wo.runStatus = "ready";
    }
    var forecast = {
      month: String(qs.get("fc_month") || ""),
      overhead: String(qs.get("fc_overhead") || ""),
      cogs: String(qs.get("fc_cogs") || ""),
      equipment: String(qs.get("fc_equipment") || "")
    };
    var operations = {
      preset: String(qs.get("ops_preset") || "last_14"),
      start: String(qs.get("ops_start") || ""),
      end: String(qs.get("ops_end") || "")
    };
    var invoicing = {
      mode: String(qs.get("iv_mode") || "production"),
      start: String(qs.get("iv_start") || ""),
      end: String(qs.get("iv_end") || ""),
      customer: String(qs.get("iv_customer") || "all"),
      status: String(qs.get("iv_status") || "all"),
      q: String(qs.get("iv_q") || "")
    };
    return { view: view, wo: wo, forecast: forecast, operations: operations, invoicing: invoicing };
  };
  const [activeView, setActiveView] = useState(function() { return parseInitialPermalink().view; });
  const [workOrdersPermalinkState, setWorkOrdersPermalinkState] = useState(function() { return parseInitialPermalink().wo; });
  const [forecastPermalinkState, setForecastPermalinkState] = useState(function() { return parseInitialPermalink().forecast || {}; });
  const [operationsPermalinkState, setOperationsPermalinkState] = useState(function() { return parseInitialPermalink().operations || {}; });
  const [invoicingPermalinkState, setInvoicingPermalinkState] = useState(function() { return parseInitialPermalink().invoicing || {}; });
  const [operationsServerSyncVersion, setOperationsServerSyncVersion] = useState(0);
  const [cacheWriteError, setCacheWriteError] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [showDataSetup, setShowDataSetup] = useState(false);
  const [showDataControlsPanel, setShowDataControlsPanel] = useState(false);
  const [autoBootstrapEnabled, setAutoBootstrapEnabled] = useState(true);
  const [autoSyncArmed, setAutoSyncArmed] = useState(false);
  const [hiddenNulogySyncMode, setHiddenNulogySyncMode] = useState("full");
  const [hiddenNulogySyncOrigin, setHiddenNulogySyncOrigin] = useState("manual");
  const [syncNonce, setSyncNonce] = useState(0);
  const [nulogySyncState, setNulogySyncState] = useState(null);
  const [receiveOrderSyncAudit, setReceiveOrderSyncAudit] = useState(null);
  const [autoSyncRetryUntil, setAutoSyncRetryUntil] = useState({ full: 0, production_only: 0 });
  const [dockApiLoading, setDockApiLoading] = useState(false);
  const [dockSyncOrigin, setDockSyncOrigin] = useState("manual");
  const [dockApiError, setDockApiError] = useState("");
  const [dockApiInfo, setDockApiInfo] = useState("");
  const [evoconApiLoading, setEvoconApiLoading] = useState(false);
  const [evoconApiError, setEvoconApiError] = useState("");
  const [evoconApiInfo, setEvoconApiInfo] = useState("");
  const [evoconLastSyncAt, setEvoconLastSyncAt] = useState(null);
  const [syncVisualPct, setSyncVisualPct] = useState(0);
  const [showQuickControls, setShowQuickControls] = useState(false);
  const [showUserActivity, setShowUserActivity] = useState(false);
  const [userActivityLoading, setUserActivityLoading] = useState(false);
  const [userActivityError, setUserActivityError] = useState("");
  const [userActivityRows, setUserActivityRows] = useState([]);
  const [showAskAi, setShowAskAi] = useState(false);
  const [openPurchaseOrderCount, setOpenPurchaseOrderCount] = useState(null);
  const lastHiddenSyncModeRef = useRef("full");
  const hiddenSyncWasBusyRef = useRef(false);
  const legacyInventoryRefreshRef = useRef(false);
  const lastAutoSyncAttemptRef = useRef({
    full: readAutoSyncCheckpoint("full"),
    production_only: readAutoSyncCheckpoint("production_only")
  });

  var buildPermalinkUrl = useCallback(function(nextView, woState, fcState, opsState, ivState) {
    if (typeof window === "undefined") return "";
    var params = new URLSearchParams(window.location.search || "");
    var view = String(nextView || "workorders");
    if (view === "overview") view = "workorders";
    params.set("view", view);
    var wo = Object.assign({}, woState || {});
    var setOrDelete = function(key, value, defaultValue) {
      var val = value == null ? "" : String(value);
      if (val === "" || val === String(defaultValue)) params.delete(key);
      else params.set(key, val);
    };
    setOrDelete("wo_q", wo.q || "", "");
    setOrDelete("wo_run_status", wo.runStatus || "all", "all");
    setOrDelete("wo_wo_status", wo.woStatus || "Booked", "Booked");
    setOrDelete("wo_customer", wo.customer || "all", "all");
    setOrDelete("wo_start", wo.start || "", "");
    setOrDelete("wo_end", wo.end || "", "");
    params.delete("wo_month");
    setOrDelete("wo_pack", wo.packType || "all", "all");
    setOrDelete("wo_run_next_limit", wo.runNextLimit || "12", "12");
    setOrDelete("wo_sort_field", wo.sortField || "dispatchRank", "dispatchRank");
    setOrDelete("wo_sort_dir", wo.sortDir || "asc", "asc");
    if (wo.pastDue) params.set("wo_past_due", "1"); else params.delete("wo_past_due");
    if (wo.shared) params.set("wo_shared", "1"); else params.delete("wo_shared");
    if (wo.runNext) params.set("wo_run_next", "1"); else params.delete("wo_run_next");
    if (wo.batchable) params.set("wo_batchable", "1"); else params.delete("wo_batchable");
    var preset = String(wo.preset || "");
    if (preset) params.set("preset", preset); else params.delete("preset");
    var fc = Object.assign({}, fcState || {});
    setOrDelete("fc_month", fc.month || "", "");
    setOrDelete("fc_overhead", fc.overhead || "", "");
    setOrDelete("fc_cogs", fc.cogs || "", "");
    setOrDelete("fc_equipment", fc.equipment || "", "");
    var ops = Object.assign({}, opsState || {});
    setOrDelete("ops_preset", ops.preset || "last_14", "last_14");
    setOrDelete("ops_start", ops.start || "", "");
    setOrDelete("ops_end", ops.end || "", "");
    var iv = Object.assign({}, ivState || {});
    setOrDelete("iv_mode", iv.mode || "production", "production");
    setOrDelete("iv_start", iv.start || "", "");
    setOrDelete("iv_end", iv.end || "", "");
    setOrDelete("iv_customer", iv.customer || "all", "all");
    setOrDelete("iv_status", iv.status || "all", "all");
    setOrDelete("iv_q", iv.q || "", "");
    return window.location.pathname + "?" + params.toString();
  }, []);

  var updatePermalink = useCallback(function(nextView, woState, fcState, opsState, ivState) {
    if (typeof window === "undefined") return;
    var nextUrl = buildPermalinkUrl(nextView, woState, fcState, opsState, ivState);
    window.history.replaceState(null, "", nextUrl);
  }, [buildPermalinkUrl]);

  useEffect(function() {
    updatePermalink(activeView, workOrdersPermalinkState, forecastPermalinkState, operationsPermalinkState, invoicingPermalinkState);
  }, [activeView, workOrdersPermalinkState, forecastPermalinkState, operationsPermalinkState, invoicingPermalinkState, updatePermalink]);

  useEffect(function() {
    if (typeof window === "undefined") return;
    var cancelled = false;
    var timerId = null;
    var queuePrefetch = function() {
      if (cancelled) return;
      prefetchLikelyNextViews(activeView);
    };
    if (typeof window.requestIdleCallback === "function") {
      timerId = window.requestIdleCallback(queuePrefetch, { timeout: 1500 });
      return function() {
        cancelled = true;
        if (timerId != null && typeof window.cancelIdleCallback === "function") window.cancelIdleCallback(timerId);
      };
    }
    timerId = window.setTimeout(queuePrefetch, 1200);
    return function() {
      cancelled = true;
      if (timerId != null) window.clearTimeout(timerId);
    };
  }, [activeView]);

  var navPrefetchers = {
    operations: prefetchOperationsView,
    analytics: prefetchAnalyticsView,
    invoicing: prefetchInvoicingView,
    reporting: prefetchReportingView,
    inventory: prefetchInventoryView,
    forecast: prefetchForecastView,
    onboarding: prefetchOnboardingView,
    calendar: prefetchCalendarView,
    purchaseorders: prefetchPurchaseOrdersView,
  };

  var navItems = [{key:"purchaseorders",label:"POs",count:openPurchaseOrderCount},{key:"workorders",label:"Work Orders",count:null},{key:"operations",label:"Operations",count:null,alert:false},{key:"analytics",label:"Analytics",count:null,alert:false},{key:"inventory",label:"Inventory",count:null},{key:"reporting",label:"Reporting",count:null},{key:"onboarding",label:"Onboarding",count:null,alert:false},{key:"invoicing",label:"Invoicing",count:null,alert:false},{key:"supplyrisk",label:"Supply Risk",count:null,alert:false},{key:"forecast",label:"Forecast",count:null,alert:false},{key:"calendar",label:"Calendar",count:null,alert:false},{key:"aicopilot",label:"AI Copilot",count:null,alert:false}]
    .map(function(item) {
      return Object.assign({}, item, {
        href: buildPermalinkUrl(item.key, workOrdersPermalinkState, forecastPermalinkState, operationsPermalinkState, invoicingPermalinkState),
        onPrefetch: navPrefetchers[item.key]
      });
    });

  var handleWorkOrdersPermalinkChange = useCallback(function(woState) {
    setWorkOrdersPermalinkState(woState || {});
  }, []);
  var handleForecastPermalinkChange = useCallback(function(fcState) {
    setForecastPermalinkState(fcState || {});
  }, []);
  var handleOperationsPermalinkChange = useCallback(function(opsState) {
    setOperationsPermalinkState(opsState || {});
  }, []);
  var handleInvoicingPermalinkChange = useCallback(function(ivState) {
    setInvoicingPermalinkState(ivState || {});
  }, []);

  var showAutoBootstrap = autoBootstrapEnabled;
  var parseTimestampMs = function(ts) {
    if (!ts) return 0;
    if (typeof ts === "number") return Number.isFinite(ts) ? ts : 0;
    var ms = ts instanceof Date ? ts.getTime() : new Date(ts).getTime();
    return Number.isFinite(ms) ? ms : 0;
  };
  var isFreshForAutoSync = function(ts) {
    var ms = parseTimestampMs(ts);
    return !!ms && (Date.now() - ms) < FULL_AUTO_SYNC_FRESH_MS;
  };
  var freshestTimestampMs = function(list) {
    return (list || []).reduce(function(max, ts) {
      var ms = parseTimestampMs(ts);
      return ms > max ? ms : max;
    }, 0);
  };

  var fmtTs = ts => { if (!ts) return "--"; var d = Date.now() - ts; return d < 60000 ? "now" : d < 3600000 ? Math.floor(d/60000) + "m" : d < 86400000 ? Math.floor(d/3600000) + "h" : Math.floor(d/86400000) + "d"; };
  var fmtClock = ts => {
    if (!ts) return "--";
    var d = new Date(ts);
    if (isNaN(d)) return "--";
    return d.toLocaleString([], { month:"2-digit", day:"2-digit", hour:"numeric", minute:"2-digit" });
  };
  var fmtUserActivityEvent = function(type) {
    var t = String(type || "").toLowerCase();
    if (t === "login") return "OAuth login";
    if (t === "session_refresh") return "Site refresh";
    if (t === "activity") return "Active use";
    return t || "activity";
  };
  var staleLevel = (ts, cad) => { if (!ts) return "stale"; var h = (Date.now()-ts)/3600000; if (cad==="daily") return h<8?"fresh":h<24?"stale":"old"; if (cad==="rare") return h<720?"fresh":"stale"; return h<168?"fresh":"stale"; };
  var getDataSourceLevel = function(source) {
    if (!source) return "stale";
    if (source.forceFresh) return "fresh";
    if (source.statusOverride) return source.statusOverride;
    return staleLevel(source.ts, source.cad);
  };
  var inboundSyncIssueActive = !!(
    receiveOrderSyncAudit &&
    receiveOrderSyncAudit.closedOnlySource &&
    String(ds.edrFileName || "") === "Nulogy Receive Orders"
  );
  var dataSourceStatus = [
    { k:"inv", l:"Inventory", ts:ds.invTimestamp, cad:"daily", ref:() => window.__invR && window.__invR.click() },
    { k:"wo", l:"Work Orders", ts:ds.woTimestamp, cad:"monthly", ref:() => window.__woR && window.__woR.click() },
    { k:"itemmaster", l:"Item Master", ts:ds.itemMasterTimestamp, cad:"rare", ref:null },
    { k:"prod", l:"Production", ts:ds.productionTimestamp, cad:"daily", ref:null },
    { k:"labor", l:"Labor", ts:ds.laborTimestamp, cad:"daily", ref:null },
    { k:"evocon", l:"Evocon", ts:ds.evoconTimestamp || evoconLastSyncAt, cad:"daily", ref:null, forceFresh: !!(ds.evoconTimestamp || evoconLastSyncAt || evoconApiInfo) },
    { k:"bom", l:"BOMs", ts:ds.bomTimestamp, cad:"rare", ref:() => window.__bomR && window.__bomR.click() },
    {
      k:"edr",
      l:"Inbound",
      ts:ds.edrTimestamp,
      cad:"monthly",
      ref:() => window.__edrR && window.__edrR.click(),
      statusOverride: inboundSyncIssueActive ? "issue" : "",
      statusLabelOverride: inboundSyncIssueActive ? "Sync issue" : ""
    },
    { k:"dock", l:"OpenDock", ts:ds.dockTimestamp, cad:"daily", ref:() => window.__dockR && window.__dockR.click() },
  ];
  var staleSources = dataSourceStatus.filter(function(s) {
    return getDataSourceLevel(s) !== "fresh";
  });
  var freshCount = dataSourceStatus.length - staleSources.length;
  var newestTs = dataSourceStatus.reduce(function(max, s) {
    var ts = s.ts ? new Date(s.ts).getTime() : 0;
    return ts > max ? ts : max;
  }, 0);
  var summaryStamp = newestTs ? fmtTs(new Date(newestTs)) : "--";
  var sharedMeta = ds.sharedSnapshotMeta || { source: "unknown", syncedAt: null, updatedBy: "" };
  var sharedWrite = ds.sharedSnapshotWrite || {
    status:"idle",
    attemptedAt:null,
    succeededAt:null,
    error:"",
    snapshotVersion:"",
    productionWriteMode:"",
    laborWriteMode:"",
    productionCorrectionStart:"",
    laborCorrectionStart:"",
    productionPayloadRows:0,
    productionClientRows:0,
    productionPayloadTruncated:false,
    laborPayloadRows:0,
    laborClientRows:0,
    laborPayloadTruncated:false
  };
  var sharedSourceLabel = sharedMeta.source === "shared" ? "Shared cache" : sharedMeta.source === "local" ? "Local cache" : sharedMeta.source === "empty" ? "Shared cache empty" : "Shared cache unavailable";
  var sharedStamp = sharedMeta.syncedAt ? fmtTs(sharedMeta.syncedAt) : "--";
  var sharedAgeMins = sharedMeta.syncedAt ? Math.max(0, Math.floor((Date.now() - new Date(sharedMeta.syncedAt).getTime()) / 60000)) : null;
  var sharedSeemsStale = !!(sharedAgeMins != null && sharedAgeMins > 30 && freshCount >= 3);
  var productionWriteLabel = sharedWrite.productionWriteMode ? String(sharedWrite.productionWriteMode).replace(/_/g, " ") : "";
  var laborWriteLabel = sharedWrite.laborWriteMode ? String(sharedWrite.laborWriteMode).replace(/_/g, " ") : "";
  var productionSnapshotSafeguardActive = !!(
    sharedWrite.productionWriteMode === "skipped_truncated_snapshot" &&
    sharedWrite.productionPayloadTruncated
  );
  var laborSnapshotSafeguardActive = !!(
    sharedWrite.laborWriteMode === "skipped_truncated_snapshot" &&
    sharedWrite.laborPayloadTruncated
  );
  var snapshotSafeguardActive = productionSnapshotSafeguardActive || laborSnapshotSafeguardActive;
  var snapshotSafeguardText = [
    productionSnapshotSafeguardActive
      ? ("Production shared snapshot was compacted (" +
        Number(sharedWrite.productionPayloadRows || 0).toLocaleString() +
        " of " +
        Number(sharedWrite.productionClientRows || 0).toLocaleString() +
        " rows), so canonical production history was left unchanged.")
      : "",
    laborSnapshotSafeguardActive
      ? ("Labor shared snapshot was compacted (" +
        Number(sharedWrite.laborPayloadRows || 0).toLocaleString() +
        " of " +
        Number(sharedWrite.laborClientRows || 0).toLocaleString() +
        " rows), so canonical labor history was left unchanged.")
      : ""
  ].filter(Boolean).join(" ");
  var hasSnapshotWriteDiagnostics = !!(
    sharedWrite.productionWriteMode ||
    sharedWrite.laborWriteMode ||
    sharedWrite.snapshotVersion ||
    sharedWrite.succeededAt ||
    snapshotSafeguardActive ||
    sharedWrite.error
  );
  var staleCount = Math.max(0, dataSourceStatus.length - freshCount);
  var setupNeedsBootstrap = !!(ds.cacheHydrated && !ds.mappingConfirmed);
  var autoSyncHydrated = sharedMeta.source !== "unknown";
  var latestFullNulogySyncMs = freshestTimestampMs([
    ds.invTimestamp,
    ds.woTimestamp,
    ds.laborTimestamp,
    ds.itemMasterTimestamp,
    ds.bomTimestamp,
    ds.edrTimestamp,
  ]);
  var latestProductionSyncMs = freshestTimestampMs([ds.productionTimestamp]);
  var latestLaborSyncMs = freshestTimestampMs([ds.laborTimestamp]);
  // Keep the full-report cadence separate from the fast Operations refresh path.
  // Otherwise frequent recent production/labor syncs can suppress inventory and
  // other deferred reports indefinitely.
  var fullNulogyAutoSyncFresh = !!latestFullNulogySyncMs && (Date.now() - latestFullNulogySyncMs) < FULL_AUTO_SYNC_FRESH_MS;
  var productionAutoSyncFresh = !!latestProductionSyncMs &&
    !!latestLaborSyncMs &&
    (Date.now() - latestProductionSyncMs) < PRODUCTION_AUTO_SYNC_FRESH_MS &&
    (Date.now() - latestLaborSyncMs) < PRODUCTION_AUTO_SYNC_FRESH_MS;
  var hiddenSyncBusy = !!(nulogySyncState && (nulogySyncState.syncing || nulogySyncState.deferredSyncing));
  var pendingHiddenSyncFailureCooldown = !hiddenSyncBusy && hiddenSyncWasBusyRef.current && !!(nulogySyncState && nulogySyncState.errorCount > 0);
  var syncedInventoryLooksLegacy = !!(Array.isArray(ds.inventory) && ds.inventory.length && /nulogy/i.test(String(ds.invFileName || "")) && (function() {
    var sourceRows = 0;
    var detailRows = 0;
    ds.inventory.forEach(function(row) {
      if (String(pickLooseInventoryField(row, ["Source", "source"]) || "").trim()) sourceRows += 1;
      if (String(pickLooseInventoryField(row, ["Location", "location", "Lot Code", "lot_code", "Expiry Date", "expiry_date"]) || "").trim()) detailRows += 1;
    });
    return sourceRows === 0 && detailRows < Math.max(10, Math.round(ds.inventory.length * 0.15));
  })());
  var fullAutoRetryUntilMs = Number(autoSyncRetryUntil.full || 0);
  var productionAutoRetryUntilMs = Number(autoSyncRetryUntil.production_only || 0);
  var dockAutoSyncFresh = isFreshForAutoSync(ds.dockTimestamp);
  var evoconAutoSyncFresh = isFreshForAutoSync(ds.evoconTimestamp || evoconLastSyncAt);
  var autoSyncOrigin = setupNeedsBootstrap ? "bootstrap" : "auto";
  var triggerHiddenNulogySync = useCallback(function(mode, options) {
    if (hiddenSyncBusy) return;
    var nextMode = mode === "production_only" ? "production_only" : "full";
    var origin = options && (options.origin === "auto" || options.origin === "bootstrap") ? options.origin : "manual";
    if (origin === "auto") {
      var retryUntil = Number(autoSyncRetryUntil[nextMode] || 0);
      if (Date.now() < retryUntil) return;
      var minIntervalMs = nextMode === "production_only" ? PRODUCTION_AUTO_SYNC_MIN_INTERVAL_MS : FULL_AUTO_SYNC_MIN_INTERVAL_MS;
      var lastAttemptMs = Number(lastAutoSyncAttemptRef.current[nextMode] || 0);
      if (lastAttemptMs && (Date.now() - lastAttemptMs) < minIntervalMs) return;
      var attemptedAt = Date.now();
      lastAutoSyncAttemptRef.current[nextMode] = attemptedAt;
      writeAutoSyncCheckpoint(nextMode, attemptedAt);
    } else if (autoSyncRetryUntil[nextMode]) {
      setAutoSyncRetryUntil(function(prev) {
        return Object.assign({}, prev, { [nextMode]: 0 });
      });
    }
    lastHiddenSyncModeRef.current = nextMode;
    setHiddenNulogySyncMode(nextMode);
    setHiddenNulogySyncOrigin(origin);
    setAutoSyncArmed(true);
    setSyncNonce(function(n) { return n + 1; });
  }, [hiddenSyncBusy, autoSyncRetryUntil, FULL_AUTO_SYNC_MIN_INTERVAL_MS, PRODUCTION_AUTO_SYNC_MIN_INTERVAL_MS]);
  var triggerFullNulogySync = useCallback(function() {
    triggerHiddenNulogySync("full", { origin: "manual" });
  }, [triggerHiddenNulogySync]);
  var triggerProductionRefresh = useCallback(function() {
    triggerHiddenNulogySync("production_only", { origin: "manual" });
  }, [triggerHiddenNulogySync]);
  var freshnessVariant = freshCount === dataSourceStatus.length ? "success" : freshCount >= 3 ? "warning" : "danger";
  var freshnessLabel = freshCount === dataSourceStatus.length
    ? "Data Fresh"
    : staleCount === 1
      ? (String(staleSources[0] && staleSources[0].l) || "1 Source") + " Needs Attention"
      : (staleCount + " Sources Need Attention");

  var fetchOpenDockApi = useCallback(async function(options) {
    var origin = options && (options.origin === "auto" || options.origin === "bootstrap") ? options.origin : "manual";
    setDockSyncOrigin(origin);
    setDockApiLoading(true);
    if (origin !== "auto") {
      setDockApiError("");
      setDockApiInfo("");
    }
    try {
      var resp = await fetch("/api/opendock/appointments");
      var body = await resp.json();
      if (!resp.ok) {
        throw new Error(body && body.error ? body.error : "OpenDock API request failed");
      }
      var rows = body && Array.isArray(body.rows) ? body.rows : [];
      var changed = !areStructuredValuesEqual(ds.dockData || [], rows);
      if (changed) {
        ds.setDockData(rows);
        ds.setDockFileName("OpenDock API");
        ds.setDockTimestamp(new Date());
      }
      if (changed && origin !== "auto") {
        setDockApiInfo((body && body.message) || ("Loaded " + rows.length + " appointments"));
      } else if (origin !== "auto") {
        setDockApiInfo("OpenDock already up to date");
      }
    } catch (err) {
      setDockApiError(err && err.message ? err.message : "Could not load OpenDock data");
    } finally {
      setDockApiLoading(false);
    }
  }, [ds.dockData, ds.setDockData, ds.setDockFileName, ds.setDockTimestamp]);
  var fetchEvoconApi = useCallback(async function(options) {
    var origin = options && (options.origin === "auto" || options.origin === "bootstrap") ? options.origin : "manual";
    setEvoconApiLoading(true);
    setEvoconApiError("");
    setEvoconApiInfo("");
    try {
      var resp = await fetch("/api/evocon/report?endpoint=oee_json", { credentials: "include" });
      var body = await resp.json();
      if (!resp.ok) {
        throw new Error(body && body.error ? body.error : "Evocon API request failed");
      }
      var rows = body && Array.isArray(body.rows) ? body.rows : [];
      var changed = !areStructuredValuesEqual(ds.evoconData || [], rows);
      if (changed) {
        ds.setEvoconData(rows);
        ds.setEvoconFileName("Evocon API");
        var now = new Date();
        ds.setEvoconTimestamp(now);
        setEvoconLastSyncAt(now);
      }
      if (changed) {
        setEvoconApiInfo("Loaded " + rows.length + " Evocon rows (" + (body.endpoint || "oee_json") + ")");
      } else if (origin !== "auto") {
        setEvoconApiInfo("Evocon already up to date");
      }
    } catch (err) {
      setEvoconApiError(err && err.message ? err.message : "Could not load Evocon data");
    } finally {
      setEvoconApiLoading(false);
    }
  }, [ds.evoconData, ds.setEvoconData, ds.setEvoconFileName, ds.setEvoconTimestamp]);
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

  var shouldRunIntervalSync = autoSyncHydrated && (ds.mappingConfirmed || showAutoBootstrap);

  useEffect(() => {
    if (!showAutoBootstrap || !autoSyncHydrated) return;
    if (pendingHiddenSyncFailureCooldown) return;
    if (!fullNulogyAutoSyncFresh && Date.now() >= fullAutoRetryUntilMs) {
      triggerHiddenNulogySync("full", { origin: autoSyncOrigin });
      return;
    }
    if (!productionAutoSyncFresh && Date.now() >= productionAutoRetryUntilMs) {
      triggerHiddenNulogySync("production_only", { origin: "auto" });
    }
  }, [showAutoBootstrap, autoSyncHydrated, pendingHiddenSyncFailureCooldown, fullNulogyAutoSyncFresh, productionAutoSyncFresh, fullAutoRetryUntilMs, productionAutoRetryUntilMs, autoSyncOrigin, triggerHiddenNulogySync]);

  useEffect(function() {
    if (!syncedInventoryLooksLegacy) return;
    if (!autoSyncHydrated || hiddenSyncBusy || pendingHiddenSyncFailureCooldown) return;
    if (legacyInventoryRefreshRef.current) return;
    legacyInventoryRefreshRef.current = true;
    triggerHiddenNulogySync("full", { origin: autoSyncOrigin });
  }, [syncedInventoryLooksLegacy, autoSyncHydrated, hiddenSyncBusy, pendingHiddenSyncFailureCooldown, autoSyncOrigin, triggerHiddenNulogySync]);

  useEffect(() => {
    if (!shouldRunIntervalSync) return;
    if (!dockApiLoading && !dockAutoSyncFresh && !dockApiError) {
      fetchOpenDockApi({ origin: autoSyncOrigin });
    }
    if (!evoconApiLoading && !evoconAutoSyncFresh && !evoconApiError) {
      fetchEvoconApi({ origin: autoSyncOrigin });
    }
    var intervalId = setInterval(function() {
      if (!dockApiLoading && !dockAutoSyncFresh) fetchOpenDockApi({ origin: autoSyncOrigin });
      if (!evoconApiLoading && !evoconAutoSyncFresh) fetchEvoconApi({ origin: autoSyncOrigin });
      if (showAutoBootstrap && !hiddenSyncBusy && !pendingHiddenSyncFailureCooldown) {
        if (!fullNulogyAutoSyncFresh && Date.now() >= fullAutoRetryUntilMs) {
          triggerHiddenNulogySync("full", { origin: autoSyncOrigin });
        } else if (!productionAutoSyncFresh && Date.now() >= productionAutoRetryUntilMs) {
          triggerHiddenNulogySync("production_only", { origin: "auto" });
        }
      }
    }, AUTO_SYNC_MS);
    return function() { clearInterval(intervalId); };
  }, [shouldRunIntervalSync, showAutoBootstrap, dockApiLoading, dockApiError, evoconApiLoading, evoconApiError, hiddenSyncBusy, pendingHiddenSyncFailureCooldown, fetchOpenDockApi, fetchEvoconApi, dockAutoSyncFresh, evoconAutoSyncFresh, fullNulogyAutoSyncFresh, productionAutoSyncFresh, fullAutoRetryUntilMs, productionAutoRetryUntilMs, autoSyncOrigin, triggerHiddenNulogySync]);

  useEffect(() => {
    if (hiddenSyncBusy) {
      hiddenSyncWasBusyRef.current = true;
      return;
    }
    if (!hiddenSyncWasBusyRef.current) return;
    hiddenSyncWasBusyRef.current = false;
    setAutoSyncArmed(false);
    var failed = !!(nulogySyncState && nulogySyncState.errorCount > 0);
    var mode = lastHiddenSyncModeRef.current === "production_only" ? "production_only" : "full";
    setAutoSyncRetryUntil(function(prev) {
      var nextUntil = failed
        ? (Date.now() + (mode === "production_only" ? PRODUCTION_AUTO_SYNC_RETRY_BACKOFF_MS : FULL_AUTO_SYNC_RETRY_BACKOFF_MS))
        : 0;
      if (Number(prev[mode] || 0) === nextUntil) return prev;
      return Object.assign({}, prev, { [mode]: nextUntil });
    });
  }, [hiddenSyncBusy, nulogySyncState, FULL_AUTO_SYNC_RETRY_BACKOFF_MS, PRODUCTION_AUTO_SYNC_RETRY_BACKOFF_MS]);

  var handleNulogyData = useCallback(async function(results) {
    var ts = new Date();
    var syncedAtIso = ts.toISOString();
    var serverWrites = [];
    var coreDataChanged = false;
    var getRows = function(payload) {
      if (!payload) return [];
      if (Array.isArray(payload)) return payload;
      if (Array.isArray(payload.data)) return payload.data;
      return [];
    };
    if (results.inventory) {
      var inventoryRows = getRows(results.inventory);
      var inventoryDetailRows = Array.isArray(results.inventory.detailData) ? results.inventory.detailData : [];
      var inventoryChanged = !areStructuredValuesEqual(ds.inventory || [], inventoryRows);
      var inventoryDetailChanged = !areStructuredValuesEqual(ds.inventoryDetailData || [], inventoryDetailRows);
      if (inventoryChanged) {
        ds.setInventory(inventoryRows);
        ds.setInvFileName("Nulogy Sync");
        ds.setInvTimestamp(ts);
        coreDataChanged = true;
      }
      if (inventoryDetailChanged) {
        ds.setInventoryDetailData(inventoryDetailRows);
        ds.setInventoryDetailTimestamp(ts);
      }
    }
    if (results.workorders) {
      var workOrderRows = getRows(results.workorders);
      if (!areStructuredValuesEqual(ds.workOrders || [], workOrderRows)) {
        ds.setWorkOrders(workOrderRows);
        ds.setWoFileName("Nulogy Sync");
        ds.setWoTimestamp(ts);
        coreDataChanged = true;
      }
    }
    if (results.itemmaster) {
      var itemMasterRows = getRows(results.itemmaster);
      if (!areStructuredValuesEqual(ds.itemMaster || [], itemMasterRows)) {
        ds.setItemMaster(itemMasterRows);
        ds.setItemMasterFileName("Nulogy Sync");
        ds.setItemMasterTimestamp(ts);
      }
    }
    if (results.production) {
      var productionRows = getRows(results.production);
      var nextProductionRows = productionRows;
      if (hiddenNulogySyncMode === "production_only" && Array.isArray(ds.productionData) && ds.productionData.length > productionRows.length) {
        // Keep the fuller client-side history; the recent production refresh exists
        // to refresh server aggregates and freshness, not to truncate the local cache.
        nextProductionRows = ds.productionData;
      }
      if (!areStructuredValuesEqual(ds.productionData || [], nextProductionRows)) {
        ds.setProductionData(nextProductionRows);
        ds.setProductionFileName("Nulogy Sync");
        ds.setProductionTimestamp(ts);
      }
      serverWrites.push(postJsonOrThrow("/api/cache/production-events", {
        rows: productionRows,
        syncedAt: syncedAtIso
      }, "Production event ingest"));
    }
    if (results.labor) {
      var laborRows = getRows(results.labor);
      if (!areStructuredValuesEqual(ds.laborData || [], laborRows)) {
        ds.setLaborData(laborRows);
        ds.setLaborFileName("Nulogy Sync");
        ds.setLaborTimestamp(ts);
      }
      serverWrites.push(writeLaborRowsToCache(laborRows, syncedAtIso));
    }
    if (results.bom) {
      var bomRows = getRows(results.bom);
      if (!areStructuredValuesEqual(ds.boms || [], bomRows)) {
        ds.setBoms(bomRows);
        ds.setBomFileName("Nulogy Sync");
        ds.setBomTimestamp(ts);
      }
    }
    if (results.receiveorders) {
      var receiveOrderRawRows = getRows(results.receiveorders);
      var receiveOrderRows = normalizeInboundRows(receiveOrderRawRows, "receiveorders");
      var receiveOrderAudit = results.receiveorders.receiveOrderAudit || null;
      setReceiveOrderSyncAudit(receiveOrderAudit ? Object.assign({ syncedAt: ts.toISOString() }, receiveOrderAudit) : null);
      var shouldIgnoreReceiveOrderSync = !!(
        receiveOrderAudit &&
        receiveOrderAudit.closedOnlySource &&
        receiveOrderRawRows.length > 0 &&
        !receiveOrderRows.length
      );
      if (!shouldIgnoreReceiveOrderSync) {
        if (!areStructuredValuesEqual(ds.edrData || [], receiveOrderRows)) {
          ds.setEdrData(receiveOrderRows);
        }
        ds.setEdrFileName("Nulogy Receive Orders");
        ds.setEdrTimestamp(ts);
      }
    }
    // Only promote the user out of setup when the sync actually changed core data
    // and the sync was user-visible.
    if (results.inventory && results.workorders && coreDataChanged && hiddenNulogySyncOrigin !== "auto") {
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
    if (serverWrites.length) {
      var writeResults = await Promise.allSettled(serverWrites);
      var rejectedWrites = writeResults.filter(function(result) { return result.status === "rejected"; });
      if (rejectedWrites.length) {
        rejectedWrites.forEach(function(result) {
          console.error("[PackPulse] Server cache write failed:", result.reason);
        });
        setCacheWriteError(
          rejectedWrites[0] &&
          rejectedWrites[0].reason &&
          rejectedWrites[0].reason.message
            ? rejectedWrites[0].reason.message
            : "Server cache write failed."
        );
      } else {
        setCacheWriteError("");
      }
      setOperationsServerSyncVersion(function(v) { return v + 1; });
    }
  }, [hiddenNulogySyncMode, hiddenNulogySyncOrigin, ds.inventory, ds.inventoryDetailData, ds.workOrders, ds.itemMaster, ds.productionData, ds.laborData, ds.boms, ds.edrData]);
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
  var yesterdayEt = shiftDaysIso(todayEt, -1);
  var productionYesterdayRows = (productionSegmentsForUI.shiftRows || []).filter(function(r) { return (r && r.date) === yesterdayEt; });
  var productionYesterdayTotal = productionYesterdayRows.reduce(function(sum, r) { return sum + (Number(r && r.unitsProduced || 0) || 0); }, 0);
  var productionYesterdayS1 = productionYesterdayRows
    .filter(function(r) { return String(r && r.shift || "").toLowerCase().indexOf("shift 1") !== -1; })
    .reduce(function(sum, r) { return sum + (Number(r && r.unitsProduced || 0) || 0); }, 0);
  var productionYesterdayS2 = productionYesterdayRows
    .filter(function(r) { return String(r && r.shift || "").toLowerCase().indexOf("shift 2") !== -1; })
    .reduce(function(sum, r) { return sum + (Number(r && r.unitsProduced || 0) || 0); }, 0);
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
  var normalizeSkuKey = function(value) {
    return String(value || "").trim().replace(/\.0+$/, "").toLowerCase();
  };
  var topRunNext = (dispatchQueue || [])
    .filter(function(row) { return String(row && row.targetView || "") === "workorders"; })
    .slice(0, 5)
    .map(function(row) {
      return {
        woNum: row && row.woNum ? row.woNum : "",
        action: row && row.action ? row.action : "",
        why: row && row.why ? row.why : "",
        dueDate: row && row.dueDate ? String(row.dueDate).slice(0, 10) : "",
        impactUnits: toNumSafe(row && row.impactUnits),
        priorityScore: toNumSafe(row && row.priorityScore),
        confidence: row && row.confidence ? row.confidence : "",
        skuKey: row && row.skuKey ? row.skuKey : "",
      };
    });
  var topSupplyRisks = criticalItemsForUI.slice(0, 5).map(function(item) {
    return {
      sku: item && item.sku ? item.sku : "",
      desc: item && item.desc ? item.desc : "",
      riskLevel: item && item.riskLevel ? item.riskLevel : "",
      shortQty: toNumSafe(item && (item.totalShort != null ? item.totalShort : item.shortQty)),
      unitsAtRisk: toNumSafe(item && item.unitsAtRisk),
      dueDate: item && item.earliestDueDate ? item.earliestDueDate : "",
      customerLabel: item && item.customerLabel ? item.customerLabel : "",
      affectedWOCount: toNumSafe(item && item.affectedWOCount),
      recommendation: item && (item.recommendedAction || item.recommendation) ? (item.recommendedAction || item.recommendation) : "",
      status: item && item.status ? item.status : "",
    };
  });
  var batchGroups = {};
  (analysisForUI.results || []).forEach(function(wo) {
    var skuRaw = String((wo && (wo.productSkuRaw || wo.productSku)) || "").trim();
    var skuKey = normalizeSkuKey(skuRaw);
    if (!skuKey || isClosedStatus(wo && wo.status)) return;
    var unitsRemaining = toNumSafe(wo && wo.unitsRemaining);
    if (!(unitsRemaining > 0)) {
      var qty = toNumSafe(wo && wo.qtyToProduce);
      var produced = toNumSafe(wo && wo.unitsProduced);
      unitsRemaining = Math.max(0, qty - produced);
    }
    if (!(unitsRemaining > 0)) return;
    if (!batchGroups[skuKey]) {
      batchGroups[skuKey] = {
        sku: skuRaw || "--",
        count: 0,
        remainingUnits: 0,
        dueStart: "",
        dueEnd: "",
      };
    }
    batchGroups[skuKey].count += 1;
    batchGroups[skuKey].remainingUnits += unitsRemaining;
    var due = String(wo && wo.dueDate || "").slice(0, 10);
    if (due && (!batchGroups[skuKey].dueStart || due < batchGroups[skuKey].dueStart)) batchGroups[skuKey].dueStart = due;
    if (due && (!batchGroups[skuKey].dueEnd || due > batchGroups[skuKey].dueEnd)) batchGroups[skuKey].dueEnd = due;
  });
  var topBatchGroups = Object.keys(batchGroups)
    .map(function(key) { return batchGroups[key]; })
    .filter(function(group) { return group.count > 1; })
    .sort(function(a, b) {
      if (b.count !== a.count) return b.count - a.count;
      return b.remainingUnits - a.remainingUnits;
    })
    .slice(0, 5);
  var topRecommendations = (recommendationsForUI || []).slice(0, 6).map(function(row) {
    return {
      owner: row && row.owner ? row.owner : "",
      action: row && row.action ? row.action : "",
      why: row && row.why ? row.why : "",
      priority: row && row.priority ? row.priority : "",
      priorityScore: toNumSafe(row && row.priorityScore),
      impactUnits: toNumSafe(row && row.impactUnits),
      targetView: row && row.targetView ? row.targetView : "",
      source: row && row.source ? row.source : "",
    };
  });
  var evoconTodayRows = (ds.evoconData || []).filter(function(row) {
    return String(row && row.date || "") === todayEt;
  });
  var evoconUnplannedMin = evoconTodayRows.reduce(function(sum, row) {
    return sum + Math.round(toNumSafe(row && row.unplannedstops) / 60);
  }, 0);
  var evoconSlowMin = evoconTodayRows.reduce(function(sum, row) {
    return sum + Math.round(toNumSafe(row && row.slowProduction) / 60);
  }, 0);
  var thisWeekCases = sumUnits(thisWeekRows);
  var lastWeekCases = sumUnits(lastWeekRows);
  var weekDeltaCases = thisWeekCases - lastWeekCases;
  var weekDeltaPct = lastWeekCases > 0 ? Math.round((weekDeltaCases / lastWeekCases) * 100) : 0;
  var atRiskUnits = (criticalItemsForUI || []).reduce(function(sum, item) {
    return sum + Math.max(
      toNumSafe(item && (item.totalShort != null ? item.totalShort : item.shortQty)),
      toNumSafe(item && item.unitsAtRisk)
    );
  }, 0);
  var highRiskCount = (criticalItemsForUI || []).filter(function(item) {
    return String(item && item.riskLevel || "").toLowerCase() === "high";
  }).length;
  var dataHealth = (dataSourceStatus || []).map(function(s) {
    var freshness = getDataSourceLevel(s);
    return {
      key: s && s.k ? s.k : "",
      label: s && s.l ? s.l : "Source",
      status: freshness,
      timestamp: s && s.ts ? s.ts : "",
      forceFresh: !!(s && s.forceFresh),
    };
  });
  var askAiMetrics = {
    todayEt: todayEt,
    yesterdayEt: yesterdayEt,
    workOrdersTotal: summaryForUI.total,
    workOrdersReady: summaryForUI.ready,
    workOrdersBlocked: summaryForUI.blocked,
    supplyRiskItems: criticalItemsForUI.length,
    highRiskCount: highRiskCount,
    atRiskUnits: atRiskUnits,
    freshData: freshCount,
    freshDataTotal: dataSourceStatus.length,
    productionTodayCases: productionTodayTotal,
    productionTodayShift1Cases: productionTodayS1,
    productionTodayShift2Cases: productionTodayS2,
    productionYesterdayCases: productionYesterdayTotal,
    productionYesterdayShift1Cases: productionYesterdayS1,
    productionYesterdayShift2Cases: productionYesterdayS2,
    productionLatestDate: productionLatestDate,
    productionLatestCases: productionLatestTotal,
    thisWeekStartEt: weekStartEt,
    thisWeekEndEt: todayEt,
    thisWeekCases: thisWeekCases,
    thisWeekShift1Cases: sumShift(thisWeekRows, "shift 1"),
    thisWeekShift2Cases: sumShift(thisWeekRows, "shift 2"),
    lastWeekStartEt: lastWeekStartEt,
    lastWeekEndEt: lastWeekEndEt,
    lastWeekCases: lastWeekCases,
    lastWeekShift1Cases: sumShift(lastWeekRows, "shift 1"),
    lastWeekShift2Cases: sumShift(lastWeekRows, "shift 2"),
    weekDeltaCases: weekDeltaCases,
    weekDeltaPct: weekDeltaPct,
    evoconUnplannedMin: evoconUnplannedMin,
    evoconSlowMin: evoconSlowMin,
    topRunNext: topRunNext,
    topSupplyRisks: topSupplyRisks,
    topBatchGroups: topBatchGroups,
    topRecommendations: topRecommendations,
    dataHealth: dataHealth,
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
  var leadRunNext = topRunNext[0] || null;
  var leadRisk = topSupplyRisks[0] || null;
  var askAiContextLines = [
    "Active view: " + (activeView || "workorders"),
    "Work Orders: " + summaryForUI.total + " | Ready: " + summaryForUI.ready + " | Blocked: " + summaryForUI.blocked,
    "Supply risk items: " + criticalItemsForUI.length + " | High risk: " + highRiskCount + " | Units at risk: " + Math.round(atRiskUnits).toLocaleString(),
    "Fresh data: " + freshCount + "/" + dataSourceStatus.length + " | Produced today: " + productionTodayTotal + " | WoW: " + (weekDeltaPct >= 0 ? "+" : "") + weekDeltaPct + "%",
    "Top run next: " + (leadRunNext ? (leadRunNext.woNum + " • " + leadRunNext.action + " • " + Math.round(leadRunNext.impactUnits).toLocaleString() + " units") : "No ranked run-next candidate"),
    "Top risk: " + (leadRisk ? (leadRisk.sku + " • " + Math.round(Math.max(toNumSafe(leadRisk.shortQty), toNumSafe(leadRisk.unitsAtRisk))).toLocaleString() + " units • " + (leadRisk.recommendation || "Review")) : "No active shortage"),
    "March due remaining: " + marchRemainingUnits + " over " + businessDaysRemainingInMarch + " business days",
  ];
  var syncProgress = (() => {
    var reportStates = nulogySyncState && nulogySyncState.reportStates ? nulogySyncState.reportStates : null;
    var nulogySteps = hiddenNulogySyncMode === "production_only"
      ? [
          { key:"production", label:"Production" },
          { key:"labor", label:"Labor" }
        ]
      : [
          { key:"inventory", label:"Inventory" },
          { key:"workorders", label:"Work Orders" },
          { key:"itemmaster", label:"Item Master" },
          { key:"bom", label:"BOM" },
          { key:"receiveorders", label:"Receive Orders" },
          { key:"production", label:"Production" },
          { key:"labor", label:"Labor" }
        ];
    var steps = nulogySteps.concat([
      { key:"opendock", label:"OpenDock API", synthetic:true }
    ]);
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
  var visibleNulogySyncBusy = !!(hiddenSyncBusy && hiddenNulogySyncOrigin !== "auto");
  var backgroundNulogySyncBusy = !!(hiddenSyncBusy && hiddenNulogySyncOrigin === "auto");
  var visibleDockSyncBusy = !!(dockApiLoading && dockSyncOrigin !== "auto");
  var visibleDockSyncInfo = !!(dockApiInfo && dockSyncOrigin !== "auto");
  var visibleDockSyncError = !!(dockApiError && dockSyncOrigin !== "auto");
  var visibleNulogySyncError = !!(nulogySyncState && nulogySyncState.errorCount > 0 && hiddenNulogySyncOrigin !== "auto");
  var visibleCacheWriteError = !!cacheWriteError;
  var showSharedSnapshotWritingBadge = sharedWrite.status === "writing" && showDataControlsPanel;
  var nulogyControlLabel = visibleNulogySyncBusy
    ? "Syncing Nulogy..."
    : backgroundNulogySyncBusy
      ? "Background sync running..."
      : "Sync Nulogy";
  var showSyncBanner = showAutoBootstrap && (
    setupNeedsBootstrap ||
    visibleDockSyncBusy ||
    visibleNulogySyncBusy ||
    visibleDockSyncError ||
    visibleNulogySyncError ||
    visibleCacheWriteError
  );
  var isActivelySyncing = showAutoBootstrap && (
    visibleDockSyncBusy ||
    visibleNulogySyncBusy
  );
  var hasAnySyncedData = !!(ds.invTimestamp || ds.woTimestamp || ds.productionTimestamp || ds.bomTimestamp || ds.edrTimestamp || ds.dockTimestamp);
  var hasSyncErrors = visibleDockSyncError || visibleNulogySyncError || visibleCacheWriteError;
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
  useEffect(function() {
    if (activeView === "production") setActiveView("operations");
  }, [activeView]);
  useEffect(function() {
    if (activeView === "overview") setActiveView("workorders");
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
          key={"auto-sync-" + hiddenNulogySyncMode + "-" + syncNonce}
          onDataLoaded={handleNulogyData}
          theme={C}
          autoStart={autoSyncArmed}
          hideToggle
          silent
          onSyncStateChange={setNulogySyncState}
          defaultSyncTypes={hiddenNulogySyncMode === "production_only" ? ["production", "labor"] : undefined}
          syncProfile={hiddenNulogySyncMode === "production_only" ? "recent_production" : "full"}
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
                {hiddenSyncBusy
                  ? "Pulling Nulogy + OpenDock now. You will enter the dashboard automatically."
                  : "Preparing live feeds. You can open manual setup at any time."}
              </div>
            </div>
            {dockApiLoading && <Badge variant="secondary">Loading OpenDock…</Badge>}
            {hiddenSyncBusy && <Badge variant="secondary">Loading Nulogy…</Badge>}
            {visibleDockSyncInfo && <Badge variant="success">{dockApiInfo}</Badge>}
            {visibleDockSyncError && <Badge variant="danger">OpenDock: {dockApiError}</Badge>}
            {visibleCacheWriteError && <Badge variant="danger">Cache sync issue</Badge>}
            {!dockApiLoading && !hiddenSyncBusy && (
            <Button onClick={() => { setDockApiInfo(""); setDockApiError(""); triggerFullNulogySync(); fetchOpenDockApi(); fetchEvoconApi(); }} variant="outline" size="sm">
                Retry Sync
              </Button>
            )}
            <Button onClick={() => setShowDataSetup(true)} variant="outline" size="sm">
              Open Data Setup
            </Button>
            <Button onClick={() => { setAutoBootstrapEnabled(false); setShowDataSetup(true); }} variant="outline" size="sm">
              Switch to Manual Upload
            </Button>
            {visibleCacheWriteError && (
              <div className="basis-full text-xs text-[rgb(var(--danger))]">
                {cacheWriteError}
              </div>
            )}
          </div>
        )}
        {(!showAutoBootstrap || showDataSetup) && <div className="mb-2 text-sm font-semibold tracking-[0.2px] text-[rgb(var(--muted))]">Data Setup</div>}
        {(!showAutoBootstrap || showDataSetup) && (
          <NulogySync onDataLoaded={handleNulogyData} theme={C} autoStart={false} hideToggle={false} />
        )}
        {(!showAutoBootstrap || showDataSetup) && (<>
        <div className="mb-5 grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-2">
              <FileUploader label="Inventory" uploaded={!!ds.inventory} fileName={ds.invFileName} onData={(d,n) => { var ts = new Date(); ds.setInventory(d); ds.setInvFileName(n); ds.setInvTimestamp(ts); ds.setInventoryDetailData([]); ds.setInventoryDetailTimestamp(ts); }} subtitle="Daily stock levels (.csv)" />
          <FileUploader label="Work Orders" uploaded={!!ds.workOrders} fileName={ds.woFileName} onData={(d,n) => {ds.setWorkOrders(d);ds.setWoFileName(n);ds.setWoTimestamp(new Date());}} subtitle="Open work orders (.csv)" />
        </div>
        <div className="mb-2">
          <div className="mb-2 text-sm font-semibold tracking-[0.2px] text-[rgb(var(--muted))]">Optional</div>
        </div>
        <div className="mb-5 grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-2">
          <FileUploader label="Item Master" uploaded={!!ds.itemMaster} fileName={ds.itemMasterFileName} onData={(d,n) => {ds.setItemMaster(d);ds.setItemMasterFileName(n);ds.setItemMasterTimestamp(new Date());}} subtitle="SKU master incl. cost fields (.csv, .xlsx)" acceptTypes=".csv,.xlsx,.xls" />
          <FileUploader label="Bill of Materials" uploaded={!!ds.boms} fileName={ds.bomFileName} onData={(d,n) => {ds.setBoms(d);ds.setBomFileName(n);ds.setBomTimestamp(new Date());}} subtitle={ds.boms ? ("Saved \u00b7 Re-upload to update") : "BOM structure (.csv, .xlsx)"} acceptTypes=".csv,.xlsx,.xls" />
          <FileUploader label="Receive Orders" uploaded={!!ds.edrData} fileName={ds.edrFileName} onData={(d,n) => {ds.setEdrData(normalizeInboundRows(d, n));ds.setEdrFileName(n);ds.setEdrTimestamp(new Date());}} subtitle="Receive Orders export or legacy EDR (.csv, .xlsx)" acceptTypes=".xlsx,.xls,.csv" parseWorkbook={ds.parseEdrWorkbook} />
          <FileUploader label="OpenDock" uploaded={!!ds.dockData} fileName={ds.dockFileName} onData={(d,n) => {ds.setDockData(d);ds.setDockFileName(n);ds.setDockTimestamp(new Date());}} subtitle="Dock appointments (.xlsx)" acceptTypes=".xlsx,.xls,.csv" />
        </div>
        <div className="-mt-2.5 mb-4 flex flex-wrap items-center gap-2.5">
          <Button onClick={fetchOpenDockApi} disabled={dockApiLoading} variant={dockApiLoading ? "soft" : "active"} size="default">
            {dockApiLoading ? "Loading OpenDock..." : "Fetch OpenDock from API"}
          </Button>
          <span className="text-xs text-[rgb(var(--muted))]">Uses secure Vercel server route (`/api/opendock/appointments`).</span>
          {visibleDockSyncInfo && <span className="text-xs text-[rgb(var(--success))]">{dockApiInfo}</span>}
          {visibleDockSyncError && <span className="text-xs text-[rgb(var(--danger))]">OpenDock API error: {dockApiError}</span>}
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
            <span className="min-w-11 text-right text-xs font-semibold [font-variant-numeric:tabular-nums]" style={{ color:syncPctColor }}>
              {Math.round(syncVisualPct)}%
            </span>
            <Progress value={syncVisualPct} className="w-44" />
            {syncVisualPct < 100 && (
              <span className="text-xs text-[rgb(var(--muted))]">
                {syncProgress.activeText}
              </span>
            )}
            {dockApiLoading && <Badge variant="secondary">OpenDock</Badge>}
            {visibleDockSyncInfo && syncVisualPct < 100 && <Badge variant="success">{dockApiInfo}</Badge>}
            {visibleDockSyncError && <Badge variant="danger">OpenDock: {dockApiError}</Badge>}
            {!dockApiLoading && !hiddenSyncBusy && setupNeedsBootstrap && (
              <Button variant="outline" size="sm" onClick={() => { setDockApiInfo(""); setDockApiError(""); triggerFullNulogySync(); fetchOpenDockApi(); fetchEvoconApi(); }}>
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
                {showDataControlsPanel ? "Hide Details" : "Details"}
              </Button>
              <Badge variant={freshnessVariant}>{freshnessLabel}</Badge>
              <span className="text-xs text-[rgb(var(--muted))]">
                Updated {summaryStamp}
              </span>
              {showSharedSnapshotWritingBadge && <Badge variant="secondary">Saving shared snapshot…</Badge>}
              {sharedWrite.status === "error" && <Badge variant="danger">Shared snapshot save failed</Badge>}
              {snapshotSafeguardActive && <Badge variant="warning">Shared snapshot compacted</Badge>}
              {sharedWrite.productionWriteMode && <Badge variant="outline">Prod write: {productionWriteLabel}</Badge>}
              {sharedWrite.laborWriteMode && <Badge variant="outline">Labor write: {laborWriteLabel}</Badge>}
            </div>
          </div>
        )}
        {!syncHealthy && (
        <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
          <Button onClick={() => setShowDataControlsPanel(v => !v)} variant={showDataControlsPanel ? "active" : "outline"} size="sm">
            {showDataControlsPanel ? "Hide Details" : "Details"}
          </Button>
          <Badge variant={freshnessVariant}>{freshnessLabel}</Badge>
          <span className="text-xs text-[rgb(var(--muted))]">
            Updated {summaryStamp}
          </span>
          {showSharedSnapshotWritingBadge && <Badge variant="secondary">Saving shared snapshot…</Badge>}
          {sharedWrite.status === "error" && <Badge variant="danger">Shared snapshot save failed</Badge>}
          {snapshotSafeguardActive && <Badge variant="warning">Shared snapshot compacted</Badge>}
          {sharedWrite.productionWriteMode && <Badge variant="outline">Prod write: {productionWriteLabel}</Badge>}
          {sharedWrite.laborWriteMode && <Badge variant="outline">Labor write: {laborWriteLabel}</Badge>}
        </div>
        )}
        {sharedSeemsStale && (
          <div
            className="mb-2 rounded-md px-3 py-2 text-xs"
            style={{ border: "1px solid " + C.warnLine, background: C.warnSoft, color: C.warn }}
          >
            Shared data may be stale ({sharedAgeMins}m old). Local data is current, but the shared snapshot may not have updated.
          </div>
        )}
        {showDataControlsPanel && (!syncHealthy || showQuickControls) && (
          <div className="mb-2 rounded-md border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-3 py-2">
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <Button
              onClick={triggerFullNulogySync}
              disabled={hiddenSyncBusy}
              variant={hiddenSyncBusy ? "soft" : "outline"}
              size="sm"
            >
              {nulogyControlLabel}
            </Button>
            <Button onClick={fetchOpenDockApi} disabled={dockApiLoading} variant={dockApiLoading ? "soft" : "active"} size="sm">
              {dockApiLoading ? "Syncing OpenDock..." : "Sync OpenDock API"}
            </Button>
              <Button onClick={fetchEvoconApi} disabled={evoconApiLoading} variant={evoconApiLoading ? "soft" : "outline"} size="sm">
                {evoconApiLoading ? "Syncing Evocon..." : "Sync Evocon OEE"}
              </Button>
              <Button onClick={() => setShowDataSetup(v => !v)} variant="outline" size="sm">
                {showDataSetup ? "Close Data Setup" : "Open Data Setup"}
              </Button>
              <Button onClick={() => setActiveView("flags")} variant={activeView==="flags" ? "active" : "outline"} size="sm">
                Data Flags {analysisForUI.flags.length > 0 ? "(" + analysisForUI.flags.length + ")" : ""}
              </Button>
              <Button onClick={() => setActiveView("itemmaster")} variant={activeView==="itemmaster" ? "active" : "outline"} size="sm">
                Item Master (Debug)
              </Button>
              <Button onClick={() => setShowUserActivity(v => !v)} variant={showUserActivity ? "active" : "outline"} size="sm">
                Recent Activity
              </Button>
            </div>
            {showUserActivity && (
              <div className="mb-2 rounded-md border border-[rgb(var(--border))] bg-white px-2.5 py-2">
                <div className="mb-1 flex items-center justify-between">
                  <div className="text-xs font-semibold text-[rgb(var(--foreground))]">Recent Activity</div>
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
                          <span>{fmtUserActivityEvent(row.event_type)}</span>
                          <span>{row.auth_provider || "auth"}</span>
                          <span className="opacity-70">{row.source || "--"}</span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-xs text-[rgb(var(--muted))]">No activity events yet.</div>
                )}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-1.5">
              {dataSourceStatus.map(function(s) {
                var sl = getDataSourceLevel(s);
                var dc = sl==="fresh"?C.ok:sl==="stale"?C.warn:C.bad;
                var statusLabel = s.statusLabelOverride || (sl === "fresh" ? "Fresh" : sl === "stale" ? "Stale" : sl === "old" ? "Old" : "Attention");
                return <button key={s.k} onClick={s.ref} className="inline-flex items-center gap-1.5 rounded-md border border-[rgb(var(--border))] bg-white px-2.5 py-1 text-xs font-medium text-[rgb(var(--muted))]">
                  <span style={{ width:6, height:6, borderRadius:"50%", background:dc }} />
                  {s.l}
                  <span style={{ opacity:0.85 }}>{statusLabel}</span>
                  <span style={{ opacity:0.6 }}>{fmtTs(s.ts)}</span>
                </button>;
              })}
              <span className="inline-flex items-center gap-1.5 rounded-md border border-[rgb(var(--border))] bg-white px-2.5 py-1 text-xs font-medium text-[rgb(var(--muted))]">
                <span style={{ width:6, height:6, borderRadius:"50%", background:sharedMeta.source==="shared"?C.ok:sharedMeta.source==="local"?C.warn:C.dim }} />
                {sharedSourceLabel}
                <span style={{ opacity:0.6 }}>{sharedStamp}</span>
              </span>
            </div>
            {hasSnapshotWriteDiagnostics && (
              <div className="mt-2 rounded-md border border-[rgb(var(--border))] bg-white px-2.5 py-2 text-xs text-[rgb(var(--muted))]">
                <div className="font-medium text-[rgb(var(--foreground))]">Last shared snapshot write</div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span>Status: <span className="font-medium text-[rgb(var(--foreground))]">{sharedWrite.status || "idle"}</span></span>
                  {sharedWrite.succeededAt && <span>Saved: <span className="font-medium text-[rgb(var(--foreground))]">{fmtTs(sharedWrite.succeededAt)}</span></span>}
                  {sharedWrite.snapshotVersion && <span>Version: <span className="font-medium text-[rgb(var(--foreground))]">{sharedWrite.snapshotVersion}</span></span>}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                  {sharedWrite.productionWriteMode && (
                    <span>
                      Production: <span className="font-medium text-[rgb(var(--foreground))]">{productionWriteLabel}</span>
                      {sharedWrite.productionCorrectionStart ? " from " + sharedWrite.productionCorrectionStart : ""}
                    </span>
                  )}
                  {sharedWrite.laborWriteMode && (
                    <span>
                      Labor: <span className="font-medium text-[rgb(var(--foreground))]">{laborWriteLabel}</span>
                      {sharedWrite.laborCorrectionStart ? " from " + sharedWrite.laborCorrectionStart : ""}
                    </span>
                  )}
                </div>
                {snapshotSafeguardText && (
                  <div className="mt-1 text-[rgb(var(--warning))]">{snapshotSafeguardText}</div>
                )}
                {sharedWrite.error && (
                  <div className="mt-1 text-[rgb(var(--danger))]">{sharedWrite.error}</div>
                )}
              </div>
            )}
          </div>
        )}
        {showDataControlsPanel && (!syncHealthy || showQuickControls) && (
          <>
            {visibleDockSyncError && <div className="-mt-2 mb-1 text-xs text-[rgb(var(--danger))]">OpenDock API error: {dockApiError}</div>}
            {visibleDockSyncInfo && <div className="-mt-0.5 mb-1 text-xs text-[rgb(var(--success))]">{dockApiInfo}</div>}
            {evoconApiError && <div className="-mt-0.5 mb-1 text-xs text-[rgb(var(--danger))]">Evocon API error: {evoconApiError}</div>}
          </>
        )}

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
              <ColumnMapper title="Inventory" headers={ds.invHeaders} mapping={ds.invMapping} onMappingChange={ds.setInvMapping} fields={[{key:"sku",label:"Item / SKU",required:true},{key:"description",label:"Description"},{key:"qtyOnHand",label:"Qty On Hand",required:true},{key:"status",label:"Inventory Status",help:"If mapped, PackPulse uses only rows marked Good."},{key:"customer",label:"Customer"},{key:"location",label:"Location"},{key:"lotCode",label:"Lot Code"},{key:"expiryDate",label:"Expiry Date"},{key:"palletNumber",label:"Pallet Number"}]} />
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
          items={navItems}
        />

        <Suspense fallback={<Card className="mt-3 p-4 text-sm text-[rgb(var(--muted))]">Loading view...</Card>}>
          {activeView === "aicopilot" && <AICopilotView summary={summaryForUI} criticalItems={criticalItemsForUI} dispatchQueue={dispatchQueue || []} recommendations={recommendationsForUI} productionSegments={productionSegmentsForUI} evoconData={ds.evoconData || []} workOrders={analysisForUI.results || []} metrics={askAiMetrics} onNavigate={setActiveView} />}
          {activeView === "operations" && <OperationsView productionSegments={productionSegmentsForUI} productionDataRaw={ds.productionData || []} laborDataRaw={ds.laborData || []} evoconData={ds.evoconData || []} evoconTimestamp={ds.evoconTimestamp || evoconLastSyncAt} itemMaster={ds.itemMaster || []} workOrders={analysisForUI.results || []} dispatchQueue={dispatchQueue || []} initialFilters={operationsPermalinkState} onPermalinkChange={handleOperationsPermalinkChange} serverSyncVersion={operationsServerSyncVersion} onRefreshProduction={triggerProductionRefresh} refreshingProduction={visibleNulogySyncBusy} />}
          {activeView === "analytics" && <AnalyticsView evoconData={ds.evoconData || []} />}
          {activeView === "invoicing" && <InvoicingView productionData={ds.productionData || []} workOrders={ds.workOrders || []} itemMaster={ds.itemMaster || []} productionTimestamp={ds.productionTimestamp} initialFilters={invoicingPermalinkState} onPermalinkChange={handleInvoicingPermalinkChange} />}
          {activeView === "reporting" && <ReportingView />}
          {activeView === "forecast" && <ForecastView workOrders={ds.workOrders || []} itemMaster={ds.itemMaster || []} productionData={ds.productionData || []} laborData={ds.laborData || []} initialFilters={forecastPermalinkState} onPermalinkChange={handleForecastPermalinkChange} />}
          {activeView === "workorders" && <WorkOrdersView analysis={analysisForUI} woStatuses={woStatusesForUI} woCustomers={woCustomersForUI} recommendations={recommendationsForUI} dispatchQueue={dispatchQueue || []} inboundCoverage={inboundCoverage} initialFilters={workOrdersPermalinkState} onPermalinkChange={handleWorkOrdersPermalinkChange} />}
          {activeView === "purchaseorders" && <PurchaseOrdersView onOpenCountChange={setOpenPurchaseOrderCount} />}
          {activeView === "inventory" && (
            <InventoryView
              inventory={ds.inventory || []}
              inventoryDetailRows={ds.inventoryDetailData || []}
              inventoryDetailTimestamp={ds.inventoryDetailTimestamp}
              itemMaster={ds.itemMaster || []}
              invMapping={ds.invMapping || {}}
              inventoryTimestamp={ds.invTimestamp}
              inventoryFileName={ds.invFileName || ""}
            />
          )}
          {activeView === "onboarding" && <OnboardingView />}
          {activeView === "calendar" && <CalendarView />}
          {activeView === "itemmaster" && <ItemMasterView itemMaster={ds.itemMaster || []} inventory={ds.inventory || []} />}
          {activeView === "supplyrisk" && <SupplyRiskView rawCriticalItems={criticalItemsForUI} inboundCoverage={inboundCoverage} timelineData={timelineData} deliveriesV2={deliveriesV2} />}
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
