import { useCallback, useEffect, useMemo, useState } from "react";
import { useTheme } from "../theme";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import TableShell from "../components/ui/table-shell";
import { detectPackType, safeNum } from "../utils";

function fmtMoney(n) {
  var v = safeNum(n);
  return "$" + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPct(n) {
  return (safeNum(n) * 100).toFixed(1) + "%";
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
  var r = String(role || "").toLowerCase().trim();
  if (r === "maint" || r === "maintenance" || r === "qa") return "fixed";
  if (r === "fork" || r === "forklift" || r === "recycling") return "step_fixed";
  return "variable";
}

export default function ForecastView(props) {
  var C = useTheme().C;
  var workOrders = Array.isArray(props.workOrders) ? props.workOrders : [];
  var itemMaster = Array.isArray(props.itemMaster) ? props.itemMaster : [];
  var productionData = Array.isArray(props.productionData) ? props.productionData : [];
  var initial = props.initialFilters || {};
  var onPermalinkChange = props.onPermalinkChange;
  var [monthKey, setMonthKey] = useState(currentMonthKey());
  var [overheadGlobal, setOverheadGlobal] = useState(0);
  var [cogsNonLabor, setCogsNonLabor] = useState(0);
  var [equipmentRental, setEquipmentRental] = useState(0);
  var [loading, setLoading] = useState(false);
  var [error, setError] = useState("");
  var [payload, setPayload] = useState(null);
  var [showAdvanced, setShowAdvanced] = useState(false);
  var [laborTemplates, setLaborTemplates] = useState([]);
  var [overrides, setOverrides] = useState([]);
  var [assumptionsLoading, setAssumptionsLoading] = useState(false);
  var [assumptionsSaving, setAssumptionsSaving] = useState(false);
  var [assumptionsMsg, setAssumptionsMsg] = useState("");

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
    if (ov.length) setOverrides(ov);
  }, []);

  var loadAssumptions = useCallback(async function(targetMonthKey) {
    var mk = String(targetMonthKey || monthKey || "").trim();
    if (!mk) return;
    setAssumptionsLoading(true);
    setAssumptionsMsg("");
    try {
      var res = await fetch("/api/ops/forecast-assumptions?monthKey=" + encodeURIComponent(mk), { credentials: "include" });
      var body = await res.json();
      if (!res.ok) throw new Error((body && body.error) || "Could not load assumptions");
      if (body && body.status === "missing_forecast_assumptions_table") {
        setAssumptionsMsg("Assumptions table not set up yet. Run docs/supabase-forecast-assumptions.sql in Supabase.");
        return;
      }
      if (body && body.row) {
        applySavedAssumptions(body.row);
        setAssumptionsMsg("Loaded saved assumptions for " + mk + ".");
      } else {
        setAssumptionsMsg("No saved assumptions for " + mk + ".");
      }
    } catch (err) {
      setAssumptionsMsg(err && err.message ? err.message : "Could not load assumptions.");
    } finally {
      setAssumptionsLoading(false);
    }
  }, [monthKey, applySavedAssumptions]);

  var saveAssumptions = useCallback(async function() {
    setAssumptionsSaving(true);
    setAssumptionsMsg("");
    try {
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
        setAssumptionsMsg("Assumptions table not set up yet. Run docs/supabase-forecast-assumptions.sql in Supabase.");
        return;
      }
      setAssumptionsMsg("Saved assumptions for " + monthKey + ".");
    } catch (err) {
      setAssumptionsMsg(err && err.message ? err.message : "Could not save assumptions.");
    } finally {
      setAssumptionsSaving(false);
    }
  }, [monthKey, overheadGlobal, cogsNonLabor, equipmentRental, laborTemplates, overrides]);

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
        var roles = rates.map(function(r) { return String(r.role || "").trim().toLowerCase(); }).filter(Boolean);
        var rateByRole = {};
        rates.forEach(function(r) {
          var role = String(r.role || "").trim().toLowerCase();
          if (!role) return;
          rateByRole[role] = (safeNum(r.hourly_rate) * (1 + safeNum(r.markup_pct))).toFixed(2);
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
    } catch (err) {
      setError(err && err.message ? err.message : "Could not run forecast.");
    } finally {
      setLoading(false);
    }
  }, [monthKey, overheadGlobal, cogsNonLabor, equipmentRental, workOrders, itemMaster, laborTemplates, overrides]);

  useEffect(function() {
    if (!workOrders.length) return;
    runForecast();
  }, [runForecast, workOrders.length]);

  useEffect(function() {
    if (!monthKey) return;
    loadAssumptions(monthKey);
  }, [monthKey, loadAssumptions]);

  var forecast = payload && payload.forecast ? payload.forecast : null;
  var summary = forecast && forecast.summary ? forecast.summary : null;
  var bySku = forecast && Array.isArray(forecast.bySku) ? forecast.bySku : [];
  var daily = forecast && Array.isArray(forecast.daily) ? forecast.daily : [];
  var flags = forecast && Array.isArray(forecast.flags) ? forecast.flags : [];
  var topSku = useMemo(function() { return bySku.slice(0, 20); }, [bySku]);
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
  var optionLists = useMemo(function() {
    var skuSet = {};
    var familySet = {};
    var packTypeSet = {};
    var lineSet = {};
    var woCodeSet = {};

    itemMaster.forEach(function(r) {
      var sku = String((r && (r["Item Code"] || r.Code || r.item_code || r.code)) || "").trim();
      var desc = String((r && (r["Description"] || r.description || r["Item Description"])) || "").trim();
      var fam = String((r && (r["Item Family"] || r.item_family || r.item_family_name || r["Family"] || r.family || r["Item Category"] || r.item_category)) || "").trim();
      if (sku) skuSet[sku] = true;
      if (fam) familySet[fam] = true;
      var p = detectPackType(desc || sku, sku);
      if (p) packTypeSet[p] = true;
    });

    workOrders.forEach(function(w) {
      var status = String((w && (w["Work Order Status"] || w.project_status || w.status)) || "").trim();
      var unitsExpected = safeNum((w && (w["Units Expected"] || w.units_expected || w["Order Qty"] || w.qtyToProduce || w.quantity)) || 0);
      var unitsProduced = safeNum((w && (w["Units Produced"] || w.units_produced || w.produced)) || 0);
      var unitsRemaining = safeNum((w && (w["Units Remaining"] || w.units_remaining || w.remaining)) || 0);
      var remaining = unitsRemaining > 0 ? unitsRemaining : Math.max(0, unitsExpected - unitsProduced);
      var isOpen = !statusLooksClosed(status) && remaining > 0;
      if (!isOpen) return;

      var sku = String((w && (w["Item Code"] || w.item_code || w.productSkuRaw || w.productSku || w["Product SKU"])) || "").trim();
      var desc = String((w && (w["Description"] || w.description || w.productDesc || w.item_description || w["Item Description"])) || "").trim();
      var fam = String((w && (w["Product Family"] || w.product_family || w["Item Family"] || w.item_family || w.family)) || "").trim();
      var line = String((w && (w["Line"] || w.line || w["Line Name"] || w.line_name)) || "").trim();
      var woCode = String((w && (w["Work Order Code"] || w.project_code || w["Project Code"] || w.wo_number || w.wo)) || "").trim();
      if (sku) skuSet[sku] = true;
      if (fam) familySet[fam] = true;
      if (line) lineSet[line] = true;
      if (woCode) woCodeSet[woCode] = true;
      var p = detectPackType(desc || sku, sku);
      if (p) packTypeSet[p] = true;
    });

    laborTemplates.forEach(function(t) {
      var line = String(t && t.line_name || "").trim();
      var fam = String(t && t.product_family || "").trim();
      var pack = String(t && t.pack_type || "").trim();
      var sku = String(t && t.sku || "").trim();
      if (line) lineSet[line] = true;
      if (fam) familySet[fam] = true;
      if (pack) packTypeSet[pack] = true;
      if (sku) skuSet[sku] = true;
    });

    return {
      skus: Object.keys(skuSet).sort(),
      woCodes: Object.keys(woCodeSet).sort(),
      families: Object.keys(familySet).sort(),
      packTypes: Object.keys(packTypeSet).sort(),
      lines: Object.keys(lineSet).sort()
    };
  }, [itemMaster, workOrders, laborTemplates]);
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
      var dt = dayIso(pick(r, ["Actual Job End", "actual_job_end_at", "Produced At", "produced_at", "Actual Job Start", "actual_job_start_at"]));
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

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <div>
          <div className="mb-1 text-xs text-[rgb(var(--muted))]">Month</div>
          <Input type="month" value={monthKey} onChange={function(e) { setMonthKey(e.target.value); }} className="h-10 w-44 text-sm" />
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
        <Button onClick={runForecast} disabled={loading}>{loading ? "Running..." : "Run Forecast"}</Button>
        <Button onClick={function() { setShowAdvanced(function(v) { return !v; }); }} variant={showAdvanced ? "active" : "outline"}>
          {showAdvanced ? "Hide Assumptions" : "Advanced Assumptions"}
        </Button>
        <Button onClick={saveAssumptions} disabled={assumptionsSaving} variant="outline">
          {assumptionsSaving ? "Saving..." : "Save Assumptions"}
        </Button>
        <Button onClick={function() { loadAssumptions(monthKey); }} disabled={assumptionsLoading} variant="outline">
          {assumptionsLoading ? "Loading..." : "Load Assumptions"}
        </Button>
      </div>
      {!!assumptionsMsg && <div className="mb-2 text-xs text-[rgb(var(--muted))]">{assumptionsMsg}</div>}

      {showAdvanced && (
        <div className="mb-3 space-y-3 rounded-md border border-[rgb(var(--border))] bg-[rgb(var(--surface))] p-3">
          <datalist id="forecast-sku-options">
            {optionLists.skus.map(function(v) { return <option key={v} value={v} />; })}
          </datalist>
          <datalist id="forecast-wo-options">
            {optionLists.woCodes.map(function(v) { return <option key={v} value={v} />; })}
          </datalist>
          <datalist id="forecast-family-options">
            {optionLists.families.map(function(v) { return <option key={v} value={v} />; })}
          </datalist>
          <datalist id="forecast-pack-options">
            {optionLists.packTypes.map(function(v) { return <option key={v} value={v} />; })}
          </datalist>
          <datalist id="forecast-line-options">
            {optionLists.lines.map(function(v) { return <option key={v} value={v} />; })}
          </datalist>
          <div className="text-sm font-semibold text-[rgb(var(--foreground))]">Labor Template Rules (fewest edits: use pack type + line)</div>
          <div className="text-xs text-[rgb(var(--muted))]">Resolution order uses SKU/line first, then pack type/family, then line/global defaults.</div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: C.raised }}>
                  {["SKU", "Family", "Pack Type", "Line", "Role", "Bucket", "Headcount", "Hourly Rate", ""].map(function(h) {
                    return <th key={h} style={{ textAlign: "left", padding: "6px 8px", fontSize: 12, color: C.dim }}>{h}</th>;
                  })}
                </tr>
              </thead>
              <tbody>
                {!laborTemplates.length && (
                  <tr><td colSpan={9} style={{ padding: 10, color: C.dim }}>No template rows. Add one below.</td></tr>
                )}
                {laborTemplates.map(function(r, idx) {
                  var setRow = function(key, val) {
                    setLaborTemplates(function(prev) {
                      var next = prev.slice();
                      next[idx] = Object.assign({}, next[idx], { [key]: val });
                      return next;
                    });
                  };
                  return (
                    <tr key={idx} style={{ borderBottom: "1px solid " + C.border }}>
                      <td style={{ padding: 6 }}><Input list="forecast-sku-options" value={r.sku || ""} onChange={function(e) { setRow("sku", e.target.value); }} className="h-8 w-28 text-xs" /></td>
                      <td style={{ padding: 6 }}><Input list="forecast-family-options" value={r.product_family || ""} onChange={function(e) { setRow("product_family", e.target.value); }} className="h-8 w-28 text-xs" /></td>
                      <td style={{ padding: 6 }}><Input list="forecast-pack-options" value={r.pack_type || ""} onChange={function(e) { setRow("pack_type", e.target.value); }} className="h-8 w-28 text-xs" placeholder="e.g. 15 PACK" /></td>
                      <td style={{ padding: 6 }}><Input list="forecast-line-options" value={r.line_name || ""} onChange={function(e) { setRow("line_name", e.target.value); }} className="h-8 w-24 text-xs" placeholder="DMM" /></td>
                      <td style={{ padding: 6 }}><Input value={r.role || ""} onChange={function(e) { setRow("role", e.target.value); }} className="h-8 w-24 text-xs" /></td>
                      <td style={{ padding: 6 }}><Input value={r.labor_bucket || ""} onChange={function(e) { setRow("labor_bucket", e.target.value); }} className="h-8 w-24 text-xs" placeholder="variable/fixed" /></td>
                      <td style={{ padding: 6 }}><Input type="number" step="0.1" value={r.headcount_assumed || ""} onChange={function(e) { setRow("headcount_assumed", e.target.value); }} className="h-8 w-24 text-xs" /></td>
                      <td style={{ padding: 6 }}><Input type="number" step="0.01" value={r.hourly_rate || ""} onChange={function(e) { setRow("hourly_rate", e.target.value); }} className="h-8 w-24 text-xs" /></td>
                      <td style={{ padding: 6 }}>
                        <Button size="sm" variant="outline" onClick={function() {
                          setLaborTemplates(function(prev) { return prev.filter(function(_, i) { return i !== idx; }); });
                        }}>Remove</Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={function() {
              setLaborTemplates(function(prev) {
                return prev.concat([{ sku: "", product_family: "", pack_type: "", line_name: "", role: "labor", labor_bucket: "variable", headcount_assumed: 1, hourly_rate: 20 }]);
              });
            }}>Add Template Row</Button>
          </div>

          <div className="mt-2 text-sm font-semibold text-[rgb(var(--foreground))]">Throughput / Line Overrides (WO/SKU-level)</div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: C.raised }}>
                  {["WO", "SKU", "Line", "Cases/Min", "Override Line", "Override Pack Type", "HC Labor", "HC Fork", "HC QA", "HC Maint", "HC Recycle", ""].map(function(h) {
                    return <th key={h} style={{ textAlign: "left", padding: "6px 8px", fontSize: 12, color: C.dim }}>{h}</th>;
                  })}
                </tr>
              </thead>
              <tbody>
                {!overrides.length && (
                  <tr><td colSpan={12} style={{ padding: 10, color: C.dim }}>No overrides configured.</td></tr>
                )}
                {overrides.map(function(r, idx) {
                  var setRow = function(key, val) {
                    setOverrides(function(prev) {
                      var next = prev.slice();
                      next[idx] = Object.assign({}, next[idx], { [key]: val });
                      return next;
                    });
                  };
                  var setRoleHeadcount = function(role, val) {
                    setOverrides(function(prev) {
                      var next = prev.slice();
                      var row = Object.assign({}, next[idx]);
                      var hc = Object.assign({}, row.override_headcount_by_role || {});
                      hc[role] = val;
                      row.override_headcount_by_role = hc;
                      next[idx] = row;
                      return next;
                    });
                  };
                  var roleHc = Object.assign({ labor: "", fork: "", qa: "", maint: "", recycling: "" }, r.override_headcount_by_role || {});
                  return (
                    <tr key={idx} style={{ borderBottom: "1px solid " + C.border }}>
                      <td style={{ padding: 6 }}><Input list="forecast-wo-options" value={r.wo_code || ""} onChange={function(e) { setRow("wo_code", e.target.value); }} className="h-8 w-28 text-xs" /></td>
                      <td style={{ padding: 6 }}><Input list="forecast-sku-options" value={r.sku || ""} onChange={function(e) { setRow("sku", e.target.value); }} className="h-8 w-28 text-xs" /></td>
                      <td style={{ padding: 6 }}><Input list="forecast-line-options" value={r.line_name || ""} onChange={function(e) { setRow("line_name", e.target.value); }} className="h-8 w-24 text-xs" /></td>
                      <td style={{ padding: 6 }}><Input type="number" step="0.01" value={r.override_cases_per_min || ""} onChange={function(e) { setRow("override_cases_per_min", e.target.value); }} className="h-8 w-24 text-xs" /></td>
                      <td style={{ padding: 6 }}><Input list="forecast-line-options" value={r.override_line_name || ""} onChange={function(e) { setRow("override_line_name", e.target.value); }} className="h-8 w-24 text-xs" /></td>
                      <td style={{ padding: 6 }}><Input list="forecast-pack-options" value={r.override_pack_type || ""} onChange={function(e) { setRow("override_pack_type", e.target.value); }} className="h-8 w-32 text-xs" /></td>
                      <td style={{ padding: 6 }}><Input type="number" step="0.1" value={roleHc.labor} onChange={function(e) { setRoleHeadcount("labor", e.target.value); }} className="h-8 w-20 text-xs" /></td>
                      <td style={{ padding: 6 }}><Input type="number" step="0.1" value={roleHc.fork} onChange={function(e) { setRoleHeadcount("fork", e.target.value); }} className="h-8 w-20 text-xs" /></td>
                      <td style={{ padding: 6 }}><Input type="number" step="0.1" value={roleHc.qa} onChange={function(e) { setRoleHeadcount("qa", e.target.value); }} className="h-8 w-20 text-xs" /></td>
                      <td style={{ padding: 6 }}><Input type="number" step="0.1" value={roleHc.maint} onChange={function(e) { setRoleHeadcount("maint", e.target.value); }} className="h-8 w-20 text-xs" /></td>
                      <td style={{ padding: 6 }}><Input type="number" step="0.1" value={roleHc.recycling} onChange={function(e) { setRoleHeadcount("recycling", e.target.value); }} className="h-8 w-20 text-xs" /></td>
                      <td style={{ padding: 6 }}>
                        <Button size="sm" variant="outline" onClick={function() {
                          setOverrides(function(prev) { return prev.filter(function(_, i) { return i !== idx; }); });
                        }}>Remove</Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Button size="sm" variant="outline" onClick={function() {
            setOverrides(function(prev) { return prev.concat([{ wo_code: "", sku: "", line_name: "", override_cases_per_min: "", override_line_name: "", override_pack_type: "", override_headcount_by_role: {} }]); });
          }}>Add Override Row</Button>
        </div>
      )}

      {!!error && <div className="mb-2 text-sm text-[rgb(var(--danger))]">{error}</div>}

      {!!summary && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10, marginBottom: 14 }}>
          {[
            { label: "Total Case Forecast", value: safeNum(summary.total_cases).toLocaleString() },
            { label: "Rollover Cases", value: safeNum(summary.rollover_cases).toLocaleString() },
            { label: "Rollover WOs", value: safeNum(summary.rollover_wo_count).toLocaleString() },
            { label: "Total Revenue", value: fmtMoney(summary.total_revenue) },
            { label: "Total Labor Cost", value: fmtMoney(summary.total_labor_cost) },
            { label: "Variable Labor", value: fmtMoney(summary.total_variable_labor_cost) },
            { label: "Step-Fixed Labor", value: fmtMoney(summary.total_step_fixed_labor_cost) },
            { label: "Fixed Labor", value: fmtMoney(summary.total_fixed_labor_cost) },
            { label: "Labor Cost / Case", value: fmtMoney(summary.labor_cost_per_case) },
            { label: "Labor % Sales", value: fmtPct(summary.labor_pct_sales) },
            { label: "Gross Margin", value: fmtMoney(summary.gross_margin) },
            { label: "Net Operating Income", value: fmtMoney(summary.net_operating_income) },
            { label: "Headcount Hours", value: safeNum(summary.total_headcount_hours).toFixed(1) }
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

      {!!flags.length && (
        <div className="mb-3 rounded-md border border-[rgb(var(--warning))] bg-[rgba(245,158,11,0.08)] p-2 text-xs text-[rgb(var(--foreground))]">
          <div className="mb-1 font-semibold">Forecast Flags ({flags.length})</div>
          {flags.slice(0, 8).map(function(f, idx) {
            return <div key={idx}>{f.woCode || "--"} | {f.sku || "--"} | {f.message}</div>;
          })}
        </div>
      )}

      <div className="mb-3 text-sm font-semibold text-[rgb(var(--foreground))]">Top SKU Forecast</div>
      <TableShell>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: C.raised }}>
                <th style={{ textAlign: "left", padding: "8px 10px", fontSize: 12, color: C.dim }}>SKU</th>
                <th style={{ textAlign: "left", padding: "8px 10px", fontSize: 12, color: C.dim }}>Description</th>
                <th style={{ textAlign: "right", padding: "8px 10px", fontSize: 12, color: C.dim }}>Cases</th>
                <th style={{ textAlign: "right", padding: "8px 10px", fontSize: 12, color: C.dim }}>Revenue</th>
                <th style={{ textAlign: "right", padding: "8px 10px", fontSize: 12, color: C.dim }}>Labor Cost</th>
                <th style={{ textAlign: "right", padding: "8px 10px", fontSize: 12, color: C.dim }}>Labor $/Case</th>
                <th style={{ textAlign: "right", padding: "8px 10px", fontSize: 12, color: C.dim }}>Labor % Sales</th>
              </tr>
            </thead>
            <tbody>
              {!topSku.length && <tr><td colSpan={7} style={{ padding: 16, textAlign: "center", color: C.dim }}>No forecast rows yet.</td></tr>}
              {topSku.map(function(r, idx) {
                var desc = descriptionBySku[r.sku] || descriptionBySku[String(r.sku || "").toLowerCase()] || "--";
                return (
                  <tr key={r.sku + "-" + idx} style={{ borderBottom: "1px solid " + C.border }}>
                    <td style={{ padding: "8px 10px", fontSize: 13, color: C.bright, fontWeight: 600 }}>{r.sku}</td>
                    <td style={{ padding: "8px 10px", fontSize: 13, color: C.text }}>{desc}</td>
                    <td style={{ padding: "8px 10px", fontSize: 13, color: C.text, textAlign: "right" }}>{safeNum(r.planned_cases).toLocaleString()}</td>
                    <td style={{ padding: "8px 10px", fontSize: 13, color: C.text, textAlign: "right" }}>{fmtMoney(r.revenue)}</td>
                    <td style={{ padding: "8px 10px", fontSize: 13, color: C.text, textAlign: "right" }}>{fmtMoney(r.labor_cost)}</td>
                    <td style={{ padding: "8px 10px", fontSize: 13, color: C.text, textAlign: "right" }}>{fmtMoney(r.labor_cost_per_case)}</td>
                    <td style={{ padding: "8px 10px", fontSize: 13, color: C.text, textAlign: "right" }}>{fmtPct(r.labor_pct_sales)}</td>
                  </tr>
                );
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
