import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "../theme";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { MonthPicker } from "../components/ui/month-picker";
import TableShell from "../components/ui/table-shell";
import { detectPackType, safeNum } from "../utils";

function fmtMoney(n) {
  var v = safeNum(n);
  return "$" + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtMoneyWhole(n) {
  var v = safeNum(n);
  return "$" + Math.round(v).toLocaleString();
}

function fmtPct(n) {
  return (safeNum(n) * 100).toFixed(1) + "%";
}

function fmtPctWhole(n) {
  return Math.round(safeNum(n) * 100).toLocaleString() + "%";
}

function hasExplicitValue(value) {
  return value != null && String(value).trim() !== "";
}

function currentMonthKey() {
  return new Date().toISOString().slice(0, 7);
}

function statusLooksClosed(status) {
  var s = String(status || "").toLowerCase();
  if (!s) return false;
  return s.indexOf("close") !== -1 || s.indexOf("complete") !== -1 || s.indexOf("cancel") !== -1 || s.indexOf("archive") !== -1 || s.indexOf("done") !== -1;
}

function defaultLaborBucketForRole(role) {
  var r = normalizeRoleKey(role);
  if (r === "maint" || r === "qa") return "fixed";
  if (r === "fork" || r === "recycling") return "step_fixed";
  return "variable";
}

function normalizeRoleKey(role) {
  var r = String(role || "").toLowerCase().trim();
  if (r === "forklift" || r === "fork lift") return "fork";
  if (r === "maintenance") return "maint";
  if (r === "qa tech" || r === "qa_tech") return "qa";
  if (r === "gen labor" || r === "general labor") return "labor";
  return r;
}

var FORECAST_ROLE_ORDER = ["labor", "operator", "fork", "qa", "maint", "recycling"];
var DEFAULT_MICRO_HEADCOUNT = {
  labor: 9.6,
  operator: 1,
  fork: 1.5,
  qa: 0.5,
  maint: 0.5,
  recycling: 0.5
};
var LINE_OPTIONS = ["DMM", "MPAC", "RSC", "Hand Pack", "Climax"];
var DEFAULT_ROLE_RATE = {
  labor: 20.17,
  operator: 27.22,
  fork: 27.73,
  qa: 22.20,
  maint: 37.06,
  recycling: 20.17
};

function normalizeLegacyHeadcountMap(map) {
  var out = Object.assign({}, map || {});
  var labor = safeNum(out.labor);
  var operator = safeNum(out.operator);
  var fork = safeNum(out.fork);
  var qa = safeNum(out.qa);
  var maint = safeNum(out.maint);
  var recycling = safeNum(out.recycling);
  // Legacy bootstrap used labor=1 with otherwise current defaults; upgrade to current preset.
  if (labor === 1 && operator === 1 && fork === 1.5 && qa === 0.5 && maint === 0.5 && recycling === 0.5) {
    out.labor = DEFAULT_MICRO_HEADCOUNT.labor;
  }
  return out;
}

export default function ForecastView(props) {
  var C = useTheme().C;
  var workOrders = Array.isArray(props.workOrders) ? props.workOrders : [];
  var itemMaster = Array.isArray(props.itemMaster) ? props.itemMaster : [];
  var productionData = Array.isArray(props.productionData) ? props.productionData : [];
  var laborData = Array.isArray(props.laborData) ? props.laborData : [];
  var initial = props.initialFilters || {};
  var onPermalinkChange = props.onPermalinkChange;
  var [monthKey, setMonthKey] = useState(currentMonthKey());
  var [overheadGlobal, setOverheadGlobal] = useState(0);
  var [cogsNonLabor, setCogsNonLabor] = useState(0);
  var [equipmentRental, setEquipmentRental] = useState(0);
  var [loading, setLoading] = useState(false);
  var [error, setError] = useState("");
  var [payload, setPayload] = useState(null);
  var [laborTemplates, setLaborTemplates] = useState([]);
  var [overrides, setOverrides] = useState([]);
  var [assumptionsLoading, setAssumptionsLoading] = useState(false);
  var [autosaveStatus, setAutosaveStatus] = useState("idle");
  var [autosaveError, setAutosaveError] = useState("");
  var [versions, setVersions] = useState([]);
  var [versionsLoading, setVersionsLoading] = useState(false);
  var [versionsMsg, setVersionsMsg] = useState("");
  var [publishLoading, setPublishLoading] = useState(false);
  var [laborActuals, setLaborActuals] = useState({ status: "idle", summary: {} });
  var didLoadMonthRef = useRef({});
  var [expandedRows, setExpandedRows] = useState({});
  var [dirtyRows, setDirtyRows] = useState({});
  var [selectedRows, setSelectedRows] = useState({});
  var [bulkOperatorHeadcount, setBulkOperatorHeadcount] = useState("");

  useEffect(function() {
    if (initial.month) setMonthKey(String(initial.month));
    if (initial.overhead !== "") setOverheadGlobal(String(initial.overhead));
    if (initial.cogs !== "") setCogsNonLabor(String(initial.cogs));
    if (initial.equipment !== "") setEquipmentRental(String(initial.equipment));
    // Only apply once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(function() {
    if (!onPermalinkChange) return;
    onPermalinkChange({
      month: monthKey,
      overhead: String(overheadGlobal || ""),
      cogs: String(cogsNonLabor || ""),
      equipment: String(equipmentRental || "")
    });
  }, [onPermalinkChange, monthKey, overheadGlobal, cogsNonLabor, equipmentRental]);

  var applySavedAssumptions = useCallback(function(row) {
    if (!row) return;
    var ga = row.global_assumptions || {};
    var lt = Array.isArray(row.labor_templates) ? row.labor_templates : [];
    var ov = Array.isArray(row.overrides) ? row.overrides : [];
    if (ga && typeof ga === "object") {
      if (ga.overhead_global != null) setOverheadGlobal(String(ga.overhead_global));
      if (ga.cogs_non_labor != null) setCogsNonLabor(String(ga.cogs_non_labor));
      if (ga.equipment_rental != null) setEquipmentRental(String(ga.equipment_rental));
    }
    if (lt.length) setLaborTemplates(lt);
    if (ov.length) {
      setOverrides(ov.map(function(r) {
        var hc = normalizeLegacyHeadcountMap(r && r.override_headcount_by_role);
        return Object.assign({}, r, { override_headcount_by_role: hc });
      }));
    }
  }, []);

  var applyForecastSnapshot = useCallback(function(snapshot) {
    if (!snapshot || typeof snapshot !== "object") return false;
    var ga = snapshot.global_assumptions && typeof snapshot.global_assumptions === "object"
      ? snapshot.global_assumptions
      : (snapshot.globalAssumptions && typeof snapshot.globalAssumptions === "object" ? snapshot.globalAssumptions : {});
    var lt = Array.isArray(snapshot.labor_templates) ? snapshot.labor_templates : (Array.isArray(snapshot.laborTemplates) ? snapshot.laborTemplates : []);
    var ov = Array.isArray(snapshot.overrides) ? snapshot.overrides : [];
    applySavedAssumptions({
      global_assumptions: ga,
      labor_templates: lt,
      overrides: ov
    });
    return true;
  }, [applySavedAssumptions]);

  var loadAssumptions = useCallback(async function(targetMonthKey) {
    var mk = String(targetMonthKey || monthKey || "").trim();
    if (!mk) return;
    setAssumptionsLoading(true);
    setAutosaveError("");
    setAutosaveStatus("loading");
    try {
      var res = await fetch("/api/ops/forecast-assumptions?monthKey=" + encodeURIComponent(mk), { credentials: "include" });
      var body = await res.json();
      if (!res.ok) throw new Error((body && body.error) || "Could not load assumptions");
      if (body && body.status === "missing_forecast_assumptions_table") {
        setAutosaveStatus("error");
        setAutosaveError("Assumptions table not set up yet.");
        didLoadMonthRef.current[mk] = true;
        return;
      }
      if (body && body.row) {
        applySavedAssumptions(body.row);
      }
      didLoadMonthRef.current[mk] = true;
      setAutosaveStatus("idle");
    } catch (err) {
      setAutosaveStatus("error");
      setAutosaveError(err && err.message ? err.message : "Could not load assumptions.");
      didLoadMonthRef.current[mk] = true;
    } finally {
      setAssumptionsLoading(false);
    }
  }, [monthKey, applySavedAssumptions]);

  var saveAssumptions = useCallback(async function() {
    try {
      setAutosaveStatus("saving");
      setAutosaveError("");
      var res = await fetch("/api/ops/forecast-assumptions", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          monthKey: monthKey,
          globalAssumptions: {
            overhead_global: safeNum(overheadGlobal),
            cogs_non_labor: safeNum(cogsNonLabor),
            equipment_rental: safeNum(equipmentRental)
          },
          laborTemplates: laborTemplates,
          overrides: overrides
        })
      });
      var body = await res.json();
      if (!res.ok) throw new Error((body && body.error) || "Could not save assumptions");
      if (body && body.status === "missing_forecast_assumptions_table") {
        setAutosaveStatus("error");
        setAutosaveError("Assumptions table not set up yet.");
        return;
      }
      setAutosaveStatus("saved");
    } catch (err) {
      setAutosaveStatus("error");
      setAutosaveError(err && err.message ? err.message : "Could not save assumptions.");
    }
  }, [monthKey, overheadGlobal, cogsNonLabor, equipmentRental, laborTemplates, overrides]);

  var loadVersions = useCallback(async function(targetMonthKey, opts) {
    var options = opts && typeof opts === "object" ? opts : {};
    var hydrate = !!options.hydrate;
    var mk = String(targetMonthKey || monthKey || "").trim();
    if (!mk) return;
    setVersionsLoading(true);
    if (hydrate) {
      setAssumptionsLoading(true);
      setAutosaveError("");
      setAutosaveStatus("loading");
    }
    try {
      var res = await fetch("/api/ops/forecast-versions?monthKey=" + encodeURIComponent(mk), { credentials: "include" });
      var body = await res.json();
      if (!res.ok) throw new Error((body && body.error) || "Could not load forecast versions");
      var list = Array.isArray(body && body.versions) ? body.versions : [];
      setVersions(list);
      if (body && body.status === "missing_forecast_versions_table") {
        setVersionsMsg("Run docs/supabase-forecast-versions.sql in Supabase to enable publishing.");
      }
      if (hydrate) {
        var picked = null;
        list.forEach(function(v) {
          if (picked) return;
          if (v && v.is_active) picked = v;
        });
        if (!picked && list.length) picked = list[0];
        if (picked && picked.snapshot && typeof picked.snapshot === "object") {
          applyForecastSnapshot(picked.snapshot);
          didLoadMonthRef.current[mk] = true;
          setAutosaveStatus("idle");
          setVersionsMsg("Loaded published version v" + String(picked.version_no || "") + " for " + mk + ".");
        } else {
          await loadAssumptions(mk);
        }
      }
    } catch (err) {
      if (hydrate) {
        await loadAssumptions(mk);
      } else {
        setVersionsMsg(err && err.message ? err.message : "Could not load forecast versions.");
      }
    } finally {
      setVersionsLoading(false);
      if (hydrate) setAssumptionsLoading(false);
    }
  }, [monthKey, applyForecastSnapshot, loadAssumptions]);

  useEffect(function() {
    var cancelled = false;
    (async function() {
      try {
        var res = await fetch("/api/ops/config?monthKey=" + encodeURIComponent(monthKey), { credentials: "include" });
        var body = await res.json();
        if (!res.ok || cancelled) return;
        var rates = Array.isArray(body && body.rates) ? body.rates : [];
        var headcountDefaults = body && body.headcountDefaults && typeof body.headcountDefaults === "object"
          ? body.headcountDefaults
          : {};
        var lineHeadcountDefaults = body && body.lineHeadcountDefaults && typeof body.lineHeadcountDefaults === "object"
          ? body.lineHeadcountDefaults
          : {};
        if (!rates.length) return;
        var seenRoles = {};
        var roles = [];
        var rateByRole = {};
        rates.forEach(function(r) {
          var role = normalizeRoleKey(r.role);
          if (!role) return;
          if (!seenRoles[role]) {
            seenRoles[role] = true;
            roles.push(role);
          }
          rateByRole[role] = (safeNum(r.hourly_rate) * (1 + safeNum(r.markup_pct))).toFixed(2);
        });
        FORECAST_ROLE_ORDER.forEach(function(role) {
          if (seenRoles[role]) return;
          roles.push(role);
          if (!rateByRole[role]) rateByRole[role] = "0.00";
        });
        var combos = {};
        workOrders.forEach(function(w) {
          var status = String((w && (w["Work Order Status"] || w.project_status || w.status)) || "").trim();
          if (statusLooksClosed(status)) return;
          var line = String((w && (w["Line"] || w.line || w["Line Name"] || w.line_name)) || "").trim();
          var sku = String((w && (w["Item Code"] || w.item_code || w.code || w["Code"])) || "").trim();
          var desc = String((w && (w["Description"] || w.description || w.item_description || w["Item Description"])) || "").trim();
          var pack = detectPackType(desc || sku, sku);
          if (!line) return;
          combos[line + "::" + pack] = { line_name: line, pack_type: pack || "" };
        });
        var comboList = Object.keys(combos).map(function(k) { return combos[k]; });
        if (!comboList.length) comboList = [{ line_name: "", pack_type: "" }];
        var seeded = [];
        comboList.forEach(function(c) {
          roles.forEach(function(role) {
            var lineDefaults = lineHeadcountDefaults[c.line_name] || {};
            var hc = safeNum(lineDefaults[role]);
            if (!(hc > 0)) hc = safeNum(headcountDefaults[role]);
            if (!(hc > 0)) hc = safeNum(DEFAULT_MICRO_HEADCOUNT[role]);
            seeded.push({
              sku: "",
              product_family: "",
              pack_type: c.pack_type || "",
              line_name: c.line_name || "",
              role: role,
              labor_bucket: defaultLaborBucketForRole(role),
              headcount_assumed: hc > 0 ? hc : 1,
              hourly_rate: rateByRole[role] || "0.00"
            });
          });
        });
        setLaborTemplates(function(prev) {
          return Array.isArray(prev) && prev.length ? prev : seeded;
        });
      } catch (e) {
        // noop
      }
    })();
    return function() { cancelled = true; };
  }, [monthKey, workOrders]);

  var runForecast = useCallback(async function() {
    setLoading(true);
    setError("");
    try {
      var res = await fetch("/api/ops/labor-forecast", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          monthKey: monthKey,
          workOrders: workOrders,
          itemMaster: itemMaster,
          laborTemplates: laborTemplates,
          overrides: overrides,
          globalAssumptions: {
            overhead_global: safeNum(overheadGlobal),
            cogs_non_labor: safeNum(cogsNonLabor),
            equipment_rental: safeNum(equipmentRental)
          }
        })
      });
      var body = await res.json();
      if (!res.ok) throw new Error((body && body.error) || "Forecast request failed");
      setPayload(body);
      clearAllDirty();
    } catch (err) {
      setError(err && err.message ? err.message : "Could not run forecast.");
    } finally {
      setLoading(false);
    }
  }, [monthKey, overheadGlobal, cogsNonLabor, equipmentRental, workOrders, itemMaster, laborTemplates, overrides]);

  var publishForecastVersion = useCallback(async function() {
    if (!monthKey) return;
    if (!payload || !payload.forecast) {
      setVersionsMsg("Run Forecast before publishing a version.");
      return;
    }
    setPublishLoading(true);
    setVersionsMsg("");
    try {
      var res = await fetch("/api/ops/forecast-versions", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "publish",
          monthKey: monthKey,
          snapshot: {
            global_assumptions: {
              overhead_global: safeNum(overheadGlobal),
              cogs_non_labor: safeNum(cogsNonLabor),
              equipment_rental: safeNum(equipmentRental)
            },
            labor_templates: laborTemplates,
            overrides: overrides,
            forecast: payload.forecast
          },
          summary: summary || {}
        })
      });
      var body = await res.json();
      if (!res.ok) throw new Error((body && body.error) || "Could not publish forecast version");
      if (body && body.status === "missing_forecast_versions_table") {
        setVersionsMsg("Run docs/supabase-forecast-versions.sql in Supabase to enable publishing.");
        return;
      }
      setVersionsMsg("Published forecast version for " + monthKey + ".");
      loadVersions(monthKey);
    } catch (err) {
      setVersionsMsg(err && err.message ? err.message : "Could not publish forecast version.");
    } finally {
      setPublishLoading(false);
    }
  }, [monthKey, payload, summary, overheadGlobal, cogsNonLabor, equipmentRental, laborTemplates, overrides, loadVersions]);

  useEffect(function() {
    if (!workOrders.length) return;
    runForecast();
  }, [runForecast, workOrders.length]);

  useEffect(function() {
    if (!monthKey) return;
    didLoadMonthRef.current[monthKey] = false;
    loadVersions(monthKey, { hydrate: true });
  }, [monthKey, loadVersions]);

  useEffect(function() {
    var cancelled = false;
    if (!monthKey) return;
    (async function() {
      try {
        var res = await fetch("/api/ops/labor-actuals?monthKey=" + encodeURIComponent(monthKey), { credentials: "include" });
        var body = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error((body && body.error) || "Could not load labor actuals");
        setLaborActuals({
          status: body.status || "ok",
          summary: body.summary || {},
          byWorkOrder: Array.isArray(body.byWorkOrder) ? body.byWorkOrder : [],
          byJob: Array.isArray(body.byJob) ? body.byJob : []
        });
      } catch (err) {
        if (cancelled) return;
        setLaborActuals({ status: "error", summary: {}, byWorkOrder: [], byJob: [], error: err && err.message ? err.message : "Could not load labor actuals" });
      }
    })();
    return function() { cancelled = true; };
  }, [monthKey, laborData]);

  useEffect(function() {
    if (!monthKey) return;
    if (assumptionsLoading) return;
    if (!didLoadMonthRef.current[monthKey]) return;
    var id = setTimeout(function() {
      saveAssumptions();
    }, 900);
    return function() { clearTimeout(id); };
  }, [monthKey, overheadGlobal, cogsNonLabor, equipmentRental, laborTemplates, overrides, assumptionsLoading, saveAssumptions]);

  var forecast = payload && payload.forecast ? payload.forecast : null;
  var summary = forecast && forecast.summary ? forecast.summary : null;
  var actualLaborSummary = laborActuals && laborActuals.summary && typeof laborActuals.summary === "object" ? laborActuals.summary : {};
  var bySku = forecast && Array.isArray(forecast.bySku) ? forecast.bySku : [];
  var byWorkOrder = forecast && Array.isArray(forecast.byWorkOrder) ? forecast.byWorkOrder : [];
  var daily = forecast && Array.isArray(forecast.daily) ? forecast.daily : [];
  var flags = forecast && Array.isArray(forecast.flags) ? forecast.flags : [];
  var topSku = useMemo(function() { return bySku.slice(0, 20); }, [bySku]);
  var microRows = useMemo(function() {
    return byWorkOrder.slice().sort(function(a, b) {
      return safeNum(b.planned_cases) - safeNum(a.planned_cases);
    });
  }, [byWorkOrder]);
  var visibleMicroRows = useMemo(function() { return microRows.slice(0, 200); }, [microRows]);
  var dirtyCount = useMemo(function() { return Object.keys(dirtyRows || {}).length; }, [dirtyRows]);
  var activeVersion = useMemo(function() {
    var found = null;
    (versions || []).forEach(function(v) {
      if (found) return;
      if (v && v.is_active) found = v;
    });
    return found;
  }, [versions]);
  var selectedCount = useMemo(function() {
    var count = 0;
    visibleMicroRows.forEach(function(r, idx) {
      var key = r && r.wo_code ? ("wo:" + String(r.wo_code).trim().toLowerCase()) : ("sku:" + String(r && r.sku || "").trim().toLowerCase() + "::" + idx);
      if (selectedRows[key]) count += 1;
    });
    return count;
  }, [visibleMicroRows, selectedRows]);
  var descriptionBySku = useMemo(function() {
    var out = {};
    itemMaster.forEach(function(r) {
      var sku = String((r && (r["Item Code"] || r.Code || r.item_code || r.code)) || "").trim();
      if (!sku) return;
      var desc = String((r && (r["Description"] || r.description || r["Item Description"])) || "").trim();
      if (!desc) return;
      if (!out[sku]) out[sku] = desc;
      var key = sku.toLowerCase();
      if (!out[key]) out[key] = desc;
    });
    return out;
  }, [itemMaster]);
  var actualByDay = useMemo(function() {
    var pick = function(row, keys) {
      var rowKeys = Object.keys(row || {});
      for (var i = 0; i < keys.length; i++) {
        var target = String(keys[i] || "").toLowerCase();
        for (var j = 0; j < rowKeys.length; j++) {
          var key = rowKeys[j];
          if (String(key).toLowerCase() === target) return row[key];
        }
      }
      return "";
    };
    var dayIso = function(value) {
      if (!value) return "";
      var d = new Date(value);
      if (isNaN(d)) return "";
      return d.toISOString().slice(0, 10);
    };
    var skuRate = {};
    bySku.forEach(function(s) {
      var sku = String(s.sku || "").trim();
      var key = sku.toLowerCase();
      if (!key) return;
      var rate = safeNum(s.revenue) / Math.max(1, safeNum(s.planned_cases));
      if (rate > 0) skuRate[key] = rate;
    });
    itemMaster.forEach(function(r) {
      var sku = String((r && (r["Item Code"] || r.Code || r.item_code || r.code)) || "").trim();
      if (!sku) return;
      var key = sku.toLowerCase();
      if (skuRate[key] > 0) return;
      var cost = safeNum((r && (r["Cost Per Unit"] || r.cost_per_unit || r["Unit Cost"] || r.unit_cost)) || 0);
      if (cost > 0) skuRate[key] = cost;
    });

    var out = {};
    productionData.forEach(function(r) {
      var sku = String(pick(r, ["Item Code", "item_code", "Code", "code"])).trim();
      if (!sku) return;
      var dt = dayIso(pick(r, ["Produced date", "producedAt", "Produced At", "produced_at", "Actual Job End", "actual_job_end_at", "Actual Job Start", "actual_job_start_at"]));
      if (!dt || dt.slice(0, 7) !== monthKey) return;
      var units = safeNum(pick(r, ["Units Produced", "units_produced", "Produced", "produced"]));
      if (!(units > 0)) return;
      var rate = safeNum(skuRate[sku.toLowerCase()]);
      if (!out[dt]) out[dt] = { day_key: dt, actual_cases: 0, actual_revenue: 0 };
      out[dt].actual_cases += units;
      out[dt].actual_revenue += units * rate;
    });
    return out;
  }, [productionData, bySku, itemMaster, monthKey]);

  var normKey = function(v) {
    return String(v || "").trim().toLowerCase();
  };
  var getRowKey = function(row, idx) {
    var woKey = normKey(row && row.wo_code);
    if (woKey) return "wo:" + woKey;
    return "sku:" + normKey(row && row.sku) + "::" + idx;
  };
  var markRowDirty = function(key) {
    if (!key) return;
    setDirtyRows(function(prev) {
      return Object.assign({}, prev, { [key]: true });
    });
  };
  var clearRowDirty = function(key) {
    if (!key) return;
    setDirtyRows(function(prev) {
      if (!prev[key]) return prev;
      var next = Object.assign({}, prev);
      delete next[key];
      return next;
    });
  };
  var clearAllDirty = function() {
    setDirtyRows({});
  };
  var pickOverrideForWo = function(row) {
    var woKey = normKey(row && row.wo_code);
    var skuKey = normKey(row && row.sku);
    var lineKey = normKey(row && row.line_name);
    var month = String(monthKey || "");
    var found = null;
    overrides.forEach(function(o) {
      if (found) return;
      var oMonth = String((o && o.month_key) || "");
      if (month && oMonth && oMonth !== month) return;
      if (woKey && normKey(o.wo_code) === woKey) {
        found = o;
        return;
      }
      if (skuKey && normKey(o.sku) === skuKey && lineKey && normKey(o.line_name) === lineKey) {
        found = o;
      }
    });
    return found || {};
  };
  var upsertOverrideForWo = function(row, apply) {
    setOverrides(function(prev) {
      var woKey = normKey(row && row.wo_code);
      var skuKey = normKey(row && row.sku);
      var lineKey = normKey(row && row.line_name);
      var month = String(monthKey || "");
      var idx = -1;
      for (var i = 0; i < prev.length; i++) {
        var o = prev[i] || {};
        var oMonth = String(o.month_key || "");
        if (month && oMonth && oMonth !== month) continue;
        if (woKey && normKey(o.wo_code) === woKey) { idx = i; break; }
        if (!woKey && skuKey && lineKey && normKey(o.sku) === skuKey && normKey(o.line_name) === lineKey) { idx = i; break; }
      }
      var base = idx >= 0 ? Object.assign({}, prev[idx]) : {
        month_key: monthKey,
        wo_code: row.wo_code || "",
        sku: row.sku || "",
        line_name: row.line_name || "",
        override_planned_cases: "",
        override_cases_per_min: "",
        override_line_name: "",
        override_pack_type: "",
        override_headcount_by_role: {},
        override_bucket_multiplier: {}
      };
      var nextRow = apply(base) || base;
      nextRow = Object.assign({}, nextRow, { month_key: monthKey });
      if (idx >= 0) {
        var next = prev.slice();
        next[idx] = nextRow;
        return next;
      }
      return prev.concat([nextRow]);
    });
  };
  var baselineHeadcountByRole = function(row) {
    var out = Object.assign({}, DEFAULT_MICRO_HEADCOUNT);
    var lineKey = normKey(row && row.line_name);
    var packKey = normKey(row && row.pack_type);
    var skuKey = normKey(row && row.sku);
    var matches = laborTemplates.filter(function(t) {
      var tRole = normalizeRoleKey(t && t.role);
      if (!tRole) return false;
      var tSku = normKey(t && t.sku);
      var tLine = normKey(t && t.line_name);
      var tPack = normKey(t && t.pack_type);
      if (tSku && skuKey && tSku === skuKey && (!tLine || tLine === lineKey)) return true;
      if (tLine && tLine === lineKey && (!tPack || tPack === packKey)) return true;
      return false;
    });
    matches.forEach(function(t) {
      var role = normalizeRoleKey(t && t.role);
      if (!Object.prototype.hasOwnProperty.call(out, role)) return;
      out[role] = safeNum(t.headcount_assumed);
    });
    return out;
  };
  var workOrderByCode = useMemo(function() {
    var out = {};
    workOrders.forEach(function(w) {
      var wo = String((w && (w["Work Order Code"] || w.project_code || w["Project Code"] || w.wo_number || w.wo)) || "").trim();
      if (!wo) return;
      out[normKey(wo)] = w;
    });
    return out;
  }, [workOrders]);
  var workOrderCasesPerMin = function(wo) {
    if (!wo) return 0;
    var uph = safeNum((wo["Standard Units Per Hour"] || wo.standard_units_per_hour || wo.units_per_hour || wo["Units Per Hour"] || wo.rate_per_hour || wo["Rate Per Hour"]) || 0);
    if (uph > 0) return uph / 60;
    return 0;
  };
  var roleRatesForRow = function(row, lineName, packType) {
    var out = Object.assign({}, DEFAULT_ROLE_RATE);
    var lineKey = normKey(lineName || (row && row.line_name));
    var packKey = normKey(packType || (row && row.pack_type));
    var skuKey = normKey(row && row.sku);
    laborTemplates.forEach(function(t) {
      var role = normalizeRoleKey(t && t.role);
      if (!role) return;
      var tSku = normKey(t && t.sku);
      var tLine = normKey(t && t.line_name);
      var tPack = normKey(t && t.pack_type);
      var match = false;
      if (tSku && skuKey && tSku === skuKey && (!tLine || tLine === lineKey)) match = true;
      else if (!tSku && tLine && tLine === lineKey && (!tPack || tPack === packKey)) match = true;
      else if (!tSku && !tLine && tPack && tPack === packKey) match = true;
      else if (!tSku && !tLine && !tPack) match = true;
      if (!match) return;
      var rate = safeNum(t && t.hourly_rate);
      if (rate > 0) out[role] = rate;
    });
    return out;
  };
  var baselineLaborCostByRowKey = useMemo(function() {
    var out = {};
    microRows.forEach(function(r, idx) {
      var key = getRowKey(r, idx);
      var wo = workOrderByCode[normKey(r && r.wo_code)];
      var baseLine = String((wo && (wo["Line"] || wo.line || wo["Line Name"] || wo.line_name)) || r.line_name || "Unassigned");
      var basePack = String((wo && (wo["Pack Type"] || wo.pack_type || wo["Item Type"] || wo.item_type)) || r.pack_type || "");
      var baseCpm = workOrderCasesPerMin(wo);
      if (!(baseCpm > 0)) baseCpm = safeNum(r.cases_per_min);
      if (!(baseCpm > 0)) baseCpm = 1;
      var baseHc = baselineHeadcountByRole(Object.assign({}, r, { line_name: baseLine, pack_type: basePack }));
      var rateByRole = roleRatesForRow(r, baseLine, basePack);
      var hourly = 0;
      Object.keys(baseHc).forEach(function(role) {
        hourly += safeNum(baseHc[role]) * safeNum(rateByRole[role] || DEFAULT_ROLE_RATE[role] || 0);
      });
      var hours = safeNum(r.planned_cases) / (baseCpm * 60);
      out[key] = hourly * hours;
    });
    return out;
  }, [microRows, workOrderByCode, laborTemplates]);
  useEffect(function() {
    if (!microRows.length) return;
    var month = String(monthKey || "");
    setOverrides(function(prev) {
      var next = prev.slice();
      var changed = false;
      for (var i = 0; i < next.length; i++) {
        var row = next[i] || {};
        var hcCurrent = row.override_headcount_by_role || {};
        var hcNext = normalizeLegacyHeadcountMap(hcCurrent);
        if (safeNum(hcNext.labor) !== safeNum(hcCurrent.labor)) {
          next[i] = Object.assign({}, row, { override_headcount_by_role: hcNext });
          changed = true;
        }
      }
      microRows.forEach(function(r) {
        var woKey = normKey(r && r.wo_code);
        if (!woKey) return;
        var exists = next.some(function(o) {
          var oMonth = String((o && o.month_key) || "");
          if (month && oMonth && oMonth !== month) return false;
          return normKey(o && o.wo_code) === woKey;
        });
        if (exists) return;
        var hc = baselineHeadcountByRole(r);
        hc = normalizeLegacyHeadcountMap(hc);
        next.push({
          month_key: monthKey,
          wo_code: r.wo_code || "",
          sku: r.sku || "",
          line_name: r.line_name || "",
          override_planned_cases: "",
          override_cases_per_min: "",
          override_line_name: "",
          override_pack_type: "",
          override_headcount_by_role: hc,
          override_bucket_multiplier: { variable: 1, step_fixed: 1, fixed: 1 }
        });
        changed = true;
      });
      return changed ? next : prev;
    });
  }, [monthKey, microRows]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <div>
          <div className="mb-1 text-xs text-[rgb(var(--muted))]">Month</div>
          <MonthPicker value={monthKey} onChange={setMonthKey} className="w-44" />
        </div>
        <div>
          <div className="mb-1 text-xs text-[rgb(var(--muted))]">Overhead</div>
          <Input type="number" value={overheadGlobal} onChange={function(e) { setOverheadGlobal(e.target.value); }} className="h-10 w-36 text-sm" />
        </div>
        <div>
          <div className="mb-1 text-xs text-[rgb(var(--muted))]">COGS (Non-Labor)</div>
          <Input type="number" value={cogsNonLabor} onChange={function(e) { setCogsNonLabor(e.target.value); }} className="h-10 w-40 text-sm" />
        </div>
        <div>
          <div className="mb-1 text-xs text-[rgb(var(--muted))]">Equipment</div>
          <Input type="number" value={equipmentRental} onChange={function(e) { setEquipmentRental(e.target.value); }} className="h-10 w-36 text-sm" />
        </div>
        <Button onClick={publishForecastVersion} disabled={publishLoading || !summary} variant="outline">
          {publishLoading ? "Publishing..." : "Publish Forecast"}
        </Button>
      </div>
      <div className="mb-2 text-xs text-[rgb(var(--muted))]">
        {assumptionsLoading ? "Loading monthly assumptions..." : ""}
        {!assumptionsLoading && autosaveStatus === "saving" ? "Saving monthly assumptions..." : ""}
        {!assumptionsLoading && autosaveStatus === "saved" ? "Saved monthly assumptions." : ""}
        {!assumptionsLoading && autosaveStatus === "error" ? ("Autosave issue: " + (autosaveError || "Could not save assumptions.")) : ""}
      </div>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-[rgb(var(--muted))]">
        <span>{activeVersion ? ("Source of truth: v" + activeVersion.version_no + " (" + (activeVersion.label || "") + ")") : "No published source of truth yet."}</span>
        {!!versionsMsg && <span>{versionsMsg}</span>}
      </div>

      {!!error && <div className="mb-2 text-sm text-[rgb(var(--danger))]">{error}</div>}

      {!!summary && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10, marginBottom: 14 }}>
          {[
            { label: "Total Case Forecast", value: safeNum(summary.total_cases).toLocaleString() },
            { label: "Rollover Cases", value: safeNum(summary.rollover_cases).toLocaleString() },
            { label: "Rollover WOs", value: safeNum(summary.rollover_wo_count).toLocaleString() },
            { label: "Total Revenue", value: fmtMoneyWhole(summary.total_revenue) },
            { label: "Total Labor Cost", value: fmtMoneyWhole(summary.total_labor_cost) },
            { label: "Variable Labor", value: fmtMoneyWhole(summary.total_variable_labor_cost) },
            { label: "Step-Fixed Labor", value: fmtMoneyWhole(summary.total_step_fixed_labor_cost) },
            { label: "Fixed Labor", value: fmtMoneyWhole(summary.total_fixed_labor_cost) },
            { label: "Labor Cost / Case", value: fmtMoney(summary.labor_cost_per_case) },
            { label: "Labor % Sales", value: fmtPctWhole(summary.labor_pct_sales) },
            { label: "Gross Margin", value: fmtMoneyWhole(summary.gross_margin) },
            { label: "Net Operating Income", value: fmtMoneyWhole(summary.net_operating_income) },
            { label: "Production Hours", value: Math.round(safeNum(summary.total_prod_hours)).toLocaleString() },
            { label: "Headcount Hours", value: Math.round(safeNum(summary.total_headcount_hours)).toLocaleString() },
            { label: "Actual Labor Cost", value: fmtMoneyWhole(actualLaborSummary.labor_cost) },
            { label: "Actual Payable Hours", value: Math.round(safeNum(actualLaborSummary.payable_hours)).toLocaleString() },
            { label: "Actual Cases / Labor Hr", value: safeNum(actualLaborSummary.cases_per_payable_hour).toFixed(1) },
            { label: "Actual Labor $ / Case", value: fmtMoney(safeNum(actualLaborSummary.labor_cost_per_case)) }
          ].map(function(card) {
            return (
              <div key={card.label} style={{ background: C.surface, border: "1px solid " + C.border, borderRadius: 10, padding: "10px 12px" }}>
                <div style={{ fontSize: 11, color: C.dim }}>{card.label}</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: C.bright }}>{card.value}</div>
              </div>
            );
          })}
        </div>
      )}
      {!!summary && laborActuals.status === "ok" && safeNum(actualLaborSummary.payable_hours) > 0 && (
        <div className="mb-3 text-xs text-[rgb(var(--muted))]">
          Labor actuals matched {Math.round(safeNum(actualLaborSummary.matched_cases)).toLocaleString()} cases across {Math.round(safeNum(actualLaborSummary.unique_job_count)).toLocaleString()} jobs through {actualLaborSummary.latest_date || monthKey}.
          {" "}Coverage: {fmtPctWhole(actualLaborSummary.coverage_pct || 0)} of production cases in the selected month.
        </div>
      )}
      {!!summary && laborActuals.status === "missing_labor_events_table" && (
        <div className="mb-3 text-xs text-[rgb(var(--muted))]">
          Labor actuals are not enabled yet. Run `docs/supabase-labor-events.sql` in Supabase.
        </div>
      )}

      {!!flags.length && (
        <div className="mb-3 rounded-md border border-[rgb(var(--warning))] bg-[rgba(245,158,11,0.08)] p-2 text-xs text-[rgb(var(--foreground))]">
          <div className="mb-1 font-semibold">Forecast Flags ({flags.length})</div>
          {flags.slice(0, 8).map(function(f, idx) {
            return <div key={idx}>{f.woCode || "--"} | {f.sku || "--"} | {f.message}</div>;
          })}
        </div>
      )}

      <div className="mb-3 rounded-md border border-[rgb(var(--border))] bg-[rgb(var(--surface))] p-2">
        <div className="mb-1 text-sm font-semibold text-[rgb(var(--foreground))]">Published Forecast Versions</div>
        {versionsLoading ? (
          <div className="text-xs text-[rgb(var(--muted))]">Loading versions...</div>
        ) : !versions.length ? (
          <div className="text-xs text-[rgb(var(--muted))]">No published versions for this month yet.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: C.raised }}>
                  <th style={{ textAlign: "left", padding: "6px 8px", fontSize: 12, color: C.dim }}>Month</th>
                  <th style={{ textAlign: "left", padding: "6px 8px", fontSize: 12, color: C.dim }}>Version</th>
                  <th style={{ textAlign: "left", padding: "6px 8px", fontSize: 12, color: C.dim }}>Published At</th>
                  <th style={{ textAlign: "right", padding: "6px 8px", fontSize: 12, color: C.dim }}>Cases</th>
                  <th style={{ textAlign: "right", padding: "6px 8px", fontSize: 12, color: C.dim }}>Revenue</th>
                  <th style={{ textAlign: "right", padding: "6px 8px", fontSize: 12, color: C.dim }}>Labor</th>
                  <th style={{ textAlign: "left", padding: "6px 8px", fontSize: 12, color: C.dim }}>By</th>
                  <th style={{ textAlign: "left", padding: "6px 8px", fontSize: 12, color: C.dim }}>State</th>
                </tr>
              </thead>
              <tbody>
                {versions.slice(0, 20).map(function(v) {
                  var s = v && v.summary && typeof v.summary === "object" ? v.summary : {};
                  var dt = String((v && (v.published_at || v.created_at)) || "");
                  var mk = String((v && v.month_key) || "");
                  var monthLabel = mk && /^\d{4}-\d{2}$/.test(mk) ? new Date(mk + "-01T00:00:00").toLocaleDateString(undefined, { year: "numeric", month: "short" }) : (mk || "--");
                  return (
                    <tr key={v.id || (v.version_no + "-" + dt)} style={{ borderBottom: "1px solid " + C.border }}>
                      <td style={{ padding: "6px 8px", fontSize: 12, color: C.text }}>{monthLabel}</td>
                      <td style={{ padding: "6px 8px", fontSize: 12, color: C.text }}>v{v.version_no} {v.label ? ("- " + v.label) : ""}</td>
                      <td style={{ padding: "6px 8px", fontSize: 12, color: C.text }}>{dt ? new Date(dt).toLocaleString() : "--"}</td>
                      <td style={{ padding: "6px 8px", fontSize: 12, color: C.text, textAlign: "right" }}>{Math.round(safeNum(s.total_cases)).toLocaleString()}</td>
                      <td style={{ padding: "6px 8px", fontSize: 12, color: C.text, textAlign: "right" }}>{fmtMoneyWhole(s.total_revenue)}</td>
                      <td style={{ padding: "6px 8px", fontSize: 12, color: C.text, textAlign: "right" }}>{fmtMoneyWhole(s.total_labor_cost)}</td>
                      <td style={{ padding: "6px 8px", fontSize: 12, color: C.text }}>{v.created_by || "--"}</td>
                      <td style={{ padding: "6px 8px", fontSize: 12, color: C.text }}>{v.is_active ? "Active" : "Archived"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="mb-1 text-sm font-semibold text-[rgb(var(--foreground))]">Work Order Micro-Forecasts</div>
      <div className="mb-2 text-xs text-[rgb(var(--muted))]">Compact rows show outcome KPIs. Expand a row to edit headcount buckets and advanced settings.</div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="rounded border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-2 py-1 text-xs text-[rgb(var(--muted))]">Dirty rows: {dirtyCount}</div>
        <Button size="sm" onClick={runForecast} disabled={loading || dirtyCount === 0}>Save All</Button>
        <div className="h-5 w-px bg-[rgb(var(--border))]" />
        <div className="text-xs text-[rgb(var(--muted))]">Bulk for selected ({selectedCount})</div>
        <Button
          size="sm"
          variant="outline"
          disabled={!selectedCount}
          onClick={function() {
            visibleMicroRows.forEach(function(r, idx) {
              var key = getRowKey(r, idx);
              if (!selectedRows[key]) return;
              upsertOverrideForWo(r, function(base) { return Object.assign({}, base, { override_line_name: "" }); });
              markRowDirty(key);
            });
          }}
        >
          Apply Line Defaults
        </Button>
        <Input
          type="number"
          step="0.1"
          placeholder="HC Op"
          value={bulkOperatorHeadcount}
          onChange={function(e) { setBulkOperatorHeadcount(e.target.value); }}
          className="h-8 w-20 text-xs"
        />
        <Button
          size="sm"
          variant="outline"
          disabled={!selectedCount}
          onClick={function() {
            visibleMicroRows.forEach(function(r, idx) {
              var key = getRowKey(r, idx);
              if (!selectedRows[key]) return;
              upsertOverrideForWo(r, function(base) {
                var nextHc = Object.assign({}, base.override_headcount_by_role || {});
                nextHc.operator = bulkOperatorHeadcount;
                return Object.assign({}, base, { override_headcount_by_role: nextHc });
              });
              markRowDirty(key);
            });
          }}
        >
          Set HC Op
        </Button>
      </div>
      <TableShell>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: C.raised }}>
                <th style={{ textAlign: "center", padding: "8px 6px", fontSize: 12, color: C.dim, width: 38 }}>
                  <input
                    type="checkbox"
                    checked={visibleMicroRows.length > 0 && selectedCount === visibleMicroRows.length}
                    onChange={function(e) {
                      var checked = !!e.target.checked;
                      setSelectedRows(function(prev) {
                        var next = Object.assign({}, prev);
                        visibleMicroRows.forEach(function(r, idx) {
                          var key = getRowKey(r, idx);
                          if (checked) next[key] = true;
                          else delete next[key];
                        });
                        return next;
                      });
                    }}
                  />
                </th>
                <th style={{ textAlign: "center", padding: "8px 6px", fontSize: 12, color: C.dim, width: 38 }} />
                <th style={{ textAlign: "left", padding: "8px 10px", fontSize: 12, color: C.dim }}>WO</th>
                <th style={{ textAlign: "left", padding: "8px 10px", fontSize: 12, color: C.dim }}>SKU</th>
                <th style={{ textAlign: "left", padding: "8px 10px", fontSize: 12, color: C.dim }}>Description</th>
                <th style={{ textAlign: "left", padding: "8px 10px", fontSize: 12, color: C.dim }}>KPIs</th>
                <th style={{ textAlign: "right", padding: "8px 10px", fontSize: 12, color: C.dim }}>Cases</th>
                <th style={{ textAlign: "right", padding: "8px 10px", fontSize: 12, color: C.dim }}>Price Per Unit</th>
                <th style={{ textAlign: "right", padding: "8px 10px", fontSize: 12, color: C.dim }}>Labor Cost</th>
                <th style={{ textAlign: "right", padding: "8px 10px", fontSize: 12, color: C.dim }}>Revenue</th>
              </tr>
            </thead>
            <tbody>
              {!visibleMicroRows.length && <tr><td colSpan={11} style={{ padding: 16, textAlign: "center", color: C.dim }}>No forecast rows yet.</td></tr>}
              {visibleMicroRows.map(function(r, idx) {
                var rowKey = getRowKey(r, idx);
                var desc = descriptionBySku[r.sku] || descriptionBySku[String(r.sku || "").toLowerCase()] || "--";
                var ov = pickOverrideForWo(r);
                var baseHc = baselineHeadcountByRole(r);
                var hc = Object.assign({}, baseHc, (ov && ov.override_headcount_by_role) || {});
                var lineValue = String((ov && ov.override_line_name) || r.line_name || "Unassigned");
                var rowLines = LINE_OPTIONS.slice();
                if (lineValue && rowLines.indexOf(lineValue) === -1) rowLines.unshift(lineValue);
                var isExpanded = !!expandedRows[rowKey];
                var isDirty = !!dirtyRows[rowKey];
                var baseLaborCost = safeNum(baselineLaborCostByRowKey[rowKey]);
                var deltaVsBase = safeNum(r.line_run_labor_cost) - baseLaborCost;
                var casesValue = hasExplicitValue(ov && ov.override_planned_cases)
                  ? String(ov.override_planned_cases)
                  : String(Math.round(safeNum(r.planned_cases)));
                var setRoleHeadcount = function(role, val) {
                  upsertOverrideForWo(r, function(base) {
                    var nextHc = Object.assign({}, base.override_headcount_by_role || {});
                    nextHc[role] = val;
                    return Object.assign({}, base, { override_headcount_by_role: nextHc });
                  });
                  markRowDirty(rowKey);
                };
                var saveRow = function() {
                  runForecast();
                };
                var resetRow = function() {
                  var resetHc = normalizeLegacyHeadcountMap(baseHc);
                  upsertOverrideForWo(r, function(base) {
                    return Object.assign({}, base, {
                      override_planned_cases: "",
                      override_cases_per_min: "",
                      override_line_name: "",
                      override_pack_type: "",
                      override_headcount_by_role: resetHc,
                      override_bucket_multiplier: { variable: 1, step_fixed: 1, fixed: 1 }
                    });
                  });
                  markRowDirty(rowKey);
                };
                return [
                    <tr key={rowKey + "-main"} style={{ borderBottom: "1px solid " + C.border }}>
                      <td style={{ padding: "8px 6px", textAlign: "center" }}>
                        <input
                          type="checkbox"
                          checked={!!selectedRows[rowKey]}
                          onChange={function(e) {
                            var checked = !!e.target.checked;
                            setSelectedRows(function(prev) {
                              var next = Object.assign({}, prev);
                              if (checked) next[rowKey] = true;
                              else delete next[rowKey];
                              return next;
                            });
                          }}
                        />
                      </td>
                      <td style={{ padding: "8px 6px", textAlign: "center" }}>
                        <button
                          type="button"
                          onClick={function() {
                            setExpandedRows(function(prev) {
                              var next = Object.assign({}, prev);
                              next[rowKey] = !prev[rowKey];
                              return next;
                            });
                          }}
                          className="rounded border border-[rgb(var(--border))] px-1 text-xs"
                        >
                          {isExpanded ? "-" : "+"}
                        </button>
                      </td>
                      <td style={{ padding: "8px 10px", fontSize: 13, color: C.bright, fontWeight: 600, position: "sticky", left: 0, zIndex: 3, background: C.surface, minWidth: 160 }}>{r.wo_code || "--"}</td>
                      <td style={{ padding: "8px 10px", fontSize: 13, color: C.bright, fontWeight: 600, position: "sticky", left: 160, zIndex: 3, background: C.surface, minWidth: 120 }}>{r.sku}</td>
                      <td style={{ padding: "8px 10px", fontSize: 13, color: C.text, position: "sticky", left: 280, zIndex: 3, background: C.surface, minWidth: 320, maxWidth: 420 }}>{desc}</td>
                      <td style={{ padding: "8px 10px" }}>
                        <div className="flex flex-wrap gap-1">
                          <span className="rounded border border-[rgb(var(--border))] px-2 py-0.5 text-[11px]">Hours {safeNum(r.production_hours).toFixed(1)}</span>
                          <span className="rounded border border-[rgb(var(--border))] px-2 py-0.5 text-[11px]">$/Case {fmtMoney(safeNum(r.line_run_labor_cost) / Math.max(1, safeNum(r.planned_cases)))}</span>
                          <span className="rounded border border-[rgb(var(--border))] px-2 py-0.5 text-[11px]">Labor% {fmtPct(safeNum(r.line_run_labor_cost) / Math.max(1, safeNum(r.revenue)))}</span>
                          <span className="rounded border border-[rgb(var(--border))] px-2 py-0.5 text-[11px]" style={{ color: deltaVsBase >= 0 ? C.bad : C.ok }}>Delta {fmtMoney(deltaVsBase)}</span>
                        </div>
                      </td>
                      <td style={{ padding: "8px 10px", fontSize: 13, color: C.text, textAlign: "right" }}>
                        <Input
                          type="number"
                          min="0"
                          step="1"
                          value={casesValue}
                          onChange={function(e) {
                            var v = e.target.value;
                            upsertOverrideForWo(r, function(base) { return Object.assign({}, base, { override_planned_cases: v }); });
                            markRowDirty(rowKey);
                          }}
                          className="h-8 w-28 text-xs text-right"
                        />
                      </td>
                      <td style={{ padding: "8px 10px", fontSize: 13, color: C.text, textAlign: "right" }}>{fmtMoney(safeNum(r.revenue_per_case || 0))}</td>
                      <td style={{ padding: "8px 10px", fontSize: 13, color: C.text, textAlign: "right" }}>{fmtMoney(r.line_run_labor_cost)}</td>
                      <td style={{ padding: "8px 10px", fontSize: 13, color: C.text, textAlign: "right" }}>{fmtMoney(r.revenue)}</td>
                    </tr>,
                    isExpanded ? (
                      <tr key={rowKey + "-edit"} style={{ borderBottom: "1px solid " + C.border, background: C.surface }}>
                        <td colSpan={11} style={{ padding: "4px 10px 8px" }}>
                          <div className="flex flex-wrap items-end gap-2">
                            <div className="text-xs font-medium text-[rgb(var(--muted))] pr-2">Headcount Inputs</div>
                            <div>
                              <div className="mb-1 text-[11px] text-[rgb(var(--muted))]">Gen</div>
                              <Input type="number" step="0.1" value={hc.labor} onChange={function(e) { setRoleHeadcount("labor", e.target.value); }} className="h-8 w-16 text-xs text-right" />
                            </div>
                            <div>
                              <div className="mb-1 text-[11px] text-[rgb(var(--muted))]">Op</div>
                              <Input type="number" step="0.1" value={hc.operator} onChange={function(e) { setRoleHeadcount("operator", e.target.value); }} className="h-8 w-16 text-xs text-right" />
                            </div>
                            <div>
                              <div className="mb-1 text-[11px] text-[rgb(var(--muted))]">Fork</div>
                              <Input type="number" step="0.1" value={hc.fork} onChange={function(e) { setRoleHeadcount("fork", e.target.value); }} className="h-8 w-16 text-xs text-right" />
                            </div>
                            <div>
                              <div className="mb-1 text-[11px] text-[rgb(var(--muted))]">QA</div>
                              <Input type="number" step="0.1" value={hc.qa} onChange={function(e) { setRoleHeadcount("qa", e.target.value); }} className="h-8 w-16 text-xs text-right" />
                            </div>
                            <div>
                              <div className="mb-1 text-[11px] text-[rgb(var(--muted))]">Maint</div>
                              <Input type="number" step="0.1" value={hc.maint} onChange={function(e) { setRoleHeadcount("maint", e.target.value); }} className="h-8 w-16 text-xs text-right" />
                            </div>
                            <div>
                              <div className="mb-1 text-[11px] text-[rgb(var(--muted))]">Rec</div>
                              <Input type="number" step="0.1" value={hc.recycling} onChange={function(e) { setRoleHeadcount("recycling", e.target.value); }} className="h-8 w-16 text-xs text-right" />
                            </div>
                            <div className="ml-2 h-8 w-px bg-[rgb(var(--border))]" />
                            <div>
                              <div className="mb-1 text-[11px] text-[rgb(var(--muted))]">Line</div>
                              <select
                                value={lineValue}
                                onChange={function(e) {
                                  var v = e.target.value;
                                  upsertOverrideForWo(r, function(base) { return Object.assign({}, base, { override_line_name: v }); });
                                  markRowDirty(rowKey);
                                }}
                                className="h-8 w-28 rounded border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-2 text-xs"
                              >
                                {rowLines.map(function(line) { return <option key={line} value={line}>{line}</option>; })}
                              </select>
                            </div>
                            <div>
                              <div className="mb-1 text-[11px] text-[rgb(var(--muted))]">Cases/Min</div>
                              <Input
                                type="number"
                                step="0.01"
                                value={(ov && ov.override_cases_per_min) || ""}
                                onChange={function(e) {
                                  var v = e.target.value;
                                  upsertOverrideForWo(r, function(base) { return Object.assign({}, base, { override_cases_per_min: v }); });
                                  markRowDirty(rowKey);
                                }}
                                className="h-8 w-20 text-xs text-right"
                                placeholder={safeNum(r.cases_per_min).toFixed(2)}
                              />
                            </div>
                            <div>
                              <div className="mb-1 text-[11px] text-[rgb(var(--muted))]">&nbsp;</div>
                              <div className="flex items-center gap-1">
                                <Button size="sm" variant="outline" onClick={saveRow} disabled={loading || !isDirty}>Save</Button>
                                <Button size="sm" variant="outline" onClick={resetRow}>Reset</Button>
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : null
                ];
              })}
            </tbody>
          </table>
        </div>
      </TableShell>

      <div className="mb-2 mt-4 text-sm font-semibold text-[rgb(var(--foreground))]">Daily Forecast Targets</div>
      <TableShell>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: C.raised }}>
                <th style={{ textAlign: "left", padding: "8px 10px", fontSize: 12, color: C.dim }}>Day</th>
                <th style={{ textAlign: "right", padding: "8px 10px", fontSize: 12, color: C.dim }}>Cases</th>
                <th style={{ textAlign: "right", padding: "8px 10px", fontSize: 12, color: C.dim }}>Revenue</th>
                <th style={{ textAlign: "right", padding: "8px 10px", fontSize: 12, color: C.dim }}>Actual Revenue</th>
                <th style={{ textAlign: "right", padding: "8px 10px", fontSize: 12, color: C.dim }}>Revenue Var</th>
                <th style={{ textAlign: "right", padding: "8px 10px", fontSize: 12, color: C.dim }}>Labor Cost</th>
                <th style={{ textAlign: "right", padding: "8px 10px", fontSize: 12, color: C.dim }}>Headcount Hours</th>
              </tr>
            </thead>
            <tbody>
              {!daily.length && <tr><td colSpan={7} style={{ padding: 16, textAlign: "center", color: C.dim }}>No daily targets available.</td></tr>}
              {daily.slice(0, 31).map(function(d) {
                var act = actualByDay[d.day_key] || { actual_cases: 0, actual_revenue: 0 };
                var revVar = safeNum(act.actual_revenue) - safeNum(d.revenue);
                return (
                  <tr key={d.day_key} style={{ borderBottom: "1px solid " + C.border }}>
                    <td style={{ padding: "8px 10px", fontSize: 13, color: C.bright }}>{d.day_key}</td>
                    <td style={{ padding: "8px 10px", fontSize: 13, color: C.text, textAlign: "right" }}>{safeNum(d.planned_cases).toLocaleString(undefined, { maximumFractionDigits: 1 })}</td>
                    <td style={{ padding: "8px 10px", fontSize: 13, color: C.text, textAlign: "right" }}>{fmtMoney(d.revenue)}</td>
                    <td style={{ padding: "8px 10px", fontSize: 13, color: C.text, textAlign: "right" }}>{fmtMoney(act.actual_revenue)}</td>
                    <td style={{ padding: "8px 10px", fontSize: 13, color: revVar >= 0 ? C.ok : C.bad, textAlign: "right" }}>{fmtMoney(revVar)}</td>
                    <td style={{ padding: "8px 10px", fontSize: 13, color: C.text, textAlign: "right" }}>{fmtMoney(d.labor_cost)}</td>
                    <td style={{ padding: "8px 10px", fontSize: 13, color: C.text, textAlign: "right" }}>{safeNum(d.headcount_hours).toFixed(1)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </TableShell>
    </div>
  );
}
