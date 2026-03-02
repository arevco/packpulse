import { useMemo, useState } from "react";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { useTheme } from "../theme";
import CriticalItemsView from "./CriticalItemsView";
import TimelineView from "./TimelineView";

function safeNum(v) {
  var n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

export default function SupplyRiskView({ rawCriticalItems, inboundCoverage, timelineData, deliveriesV2 }) {
  const { mono } = useTheme();
  const [mode, setMode] = useState("risk");
  const [customerFilter, setCustomerFilter] = useState("all");

  var filteredCoverageRows = useMemo(function() {
    if (!inboundCoverage || !Array.isArray(inboundCoverage.rows)) return [];
    if (customerFilter === "all") return inboundCoverage.rows;
    return inboundCoverage.rows.filter(function(r) {
      return String(r.customerLabel || "")
        .split(",")
        .map(function(v) { return v.trim(); })
        .includes(customerFilter);
    });
  }, [inboundCoverage, customerFilter]);

  var summary = useMemo(function() {
    var atRiskSkus = 0;
    var unitsAtRisk = 0;
    if (filteredCoverageRows.length) {
      atRiskSkus = filteredCoverageRows.filter(function(r) { return (r.riskLevel || "high") !== "low"; }).length;
      unitsAtRisk = filteredCoverageRows.reduce(function(sum, r) { return sum + safeNum(r.uncoveredQty != null ? r.uncoveredQty : r.shortQty); }, 0);
    } else if (Array.isArray(rawCriticalItems)) {
      var filteredCritical = customerFilter === "all"
        ? rawCriticalItems
        : rawCriticalItems.filter(function(r) { return Array.isArray(r.customers) && r.customers.includes(customerFilter); });
      atRiskSkus = filteredCritical.length;
      unitsAtRisk = filteredCritical.reduce(function(sum, r) { return sum + safeNum(r.totalShort); }, 0);
    }
    var inboundLoads = 0;
    var unmatched = 0;
    var unlocked = 0;
    if (filteredCoverageRows.length) {
      var poSet = new Set();
      filteredCoverageRows.forEach(function(r) {
        (r.openPOs || []).forEach(function(po) {
          var p = String(po || "").trim();
          if (p) poSet.add(p);
        });
      });
      inboundLoads = poSet.size;
      unmatched = filteredCoverageRows.filter(function(r) { return (r.status || "missing") === "missing"; }).length;
      var unlockedBySku = {};
      if (Array.isArray(rawCriticalItems)) {
        rawCriticalItems.forEach(function(item) {
          unlockedBySku[String(item.sku || "").trim()] = safeNum(item.unlockedUnits || 0);
        });
      }
      unlocked = filteredCoverageRows.reduce(function(sum, r) {
        return sum + safeNum(unlockedBySku[String(r.sku || "").trim()] || 0);
      }, 0);
    } else {
      inboundLoads = deliveriesV2 && deliveriesV2.summary ? safeNum(deliveriesV2.summary.openDockScheduled) : 0;
      unlocked = deliveriesV2 && deliveriesV2.summary ? safeNum(deliveriesV2.summary.unitsPotentiallyUnlocked) : 0;
      unmatched = deliveriesV2 && deliveriesV2.summary ? safeNum(deliveriesV2.summary.materialUnknown) : 0;
    }
    return {
      atRiskSkus: atRiskSkus,
      unitsAtRisk: unitsAtRisk,
      inboundLoads: inboundLoads,
      unlocked: unlocked,
      unmatched: unmatched
    };
  }, [rawCriticalItems, filteredCoverageRows, deliveriesV2, customerFilter]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-[rgb(var(--muted))]">
          Single workspace for material shortage risk and inbound execution impact.
        </div>
        <div className="flex items-center gap-1.5">
          <Button onClick={function() { setMode("risk"); }} variant={mode === "risk" ? "active" : "outline"} size="default">Risk Now</Button>
          <Button onClick={function() { setMode("inbound"); }} variant={mode === "inbound" ? "active" : "outline"} size="default">Inbound Impact</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        <Card className="px-3 py-2.5"><div className="text-xl font-bold [font-variant-numeric:tabular-nums]" style={{ fontFamily: mono }}>{summary.atRiskSkus.toLocaleString()}</div><div className="text-xs text-[rgb(var(--muted))]">At-Risk SKUs</div></Card>
        <Card className="px-3 py-2.5"><div className="text-xl font-bold [font-variant-numeric:tabular-nums]" style={{ fontFamily: mono }}>{Math.round(summary.unitsAtRisk).toLocaleString()}</div><div className="text-xs text-[rgb(var(--muted))]">Units at Risk</div></Card>
        <Card className="px-3 py-2.5"><div className="text-xl font-bold [font-variant-numeric:tabular-nums]" style={{ fontFamily: mono }}>{summary.inboundLoads.toLocaleString()}</div><div className="text-xs text-[rgb(var(--muted))]">Inbound Loads</div></Card>
        <Card className="px-3 py-2.5"><div className="text-xl font-bold [font-variant-numeric:tabular-nums]" style={{ fontFamily: mono }}>{Math.round(summary.unlocked).toLocaleString()}</div><div className="text-xs text-[rgb(var(--muted))]">Units Potentially Unlocked</div></Card>
        <Card className="px-3 py-2.5"><div className="text-xl font-bold [font-variant-numeric:tabular-nums]" style={{ fontFamily: mono }}>{summary.unmatched.toLocaleString()}</div><div className="text-xs text-[rgb(var(--muted))]">Unmatched Materials</div></Card>
      </div>

      {mode === "risk" ? (
        <CriticalItemsView
          rawCriticalItems={rawCriticalItems}
          inboundCoverage={inboundCoverage}
          customerFilter={customerFilter}
          onCustomerFilterChange={setCustomerFilter}
        />
      ) : (
        <TimelineView timelineData={timelineData} deliveriesV2={deliveriesV2} />
      )}
    </div>
  );
}
