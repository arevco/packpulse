import { useMemo, useState } from "react";
import { Card } from "../components/ui/card";
import { useTheme } from "../theme";
import CriticalItemsView from "./CriticalItemsView";
import TimelineView from "./TimelineView";

function safeNum(v) {
  var n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

export default function SupplyRiskView({ rawCriticalItems, inboundCoverage, timelineData, deliveriesV2 }) {
  const { mono } = useTheme();
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
    <div className="space-y-4">
      <div className="space-y-1">
        <div className="text-sm text-[rgb(var(--muted))]">
          One Supply Risk workflow: start with material shortages, then review the inbound loads that may close those gaps.
        </div>
        <div className="text-xs text-[rgb(var(--muted))]">
          Material Risk shows what is blocked now from work orders plus inventory. Inbound Loads shows what Receive Orders and OpenDock say is coming next.
        </div>
      </div>

      <div className="grid gap-2 md:grid-cols-2">
        <Card className="px-3 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[rgb(var(--muted))]">
            1. Material Risk
          </div>
          <div className="mt-1 text-sm text-[rgb(var(--foreground))]">
            Identify the components blocking finished goods, how much is still uncovered, and where inbound needs to land.
          </div>
        </Card>
        <Card className="px-3 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[rgb(var(--muted))]">
            2. Inbound Loads
          </div>
          <div className="mt-1 text-sm text-[rgb(var(--foreground))]">
            Reconcile Receive Orders with OpenDock so the team can see which loads are scheduled, unmatched, or still not on the dock calendar.
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        <Card className="px-3 py-2.5"><div className="text-xl font-bold [font-variant-numeric:tabular-nums]" style={{ fontFamily: mono }}>{summary.atRiskSkus.toLocaleString()}</div><div className="text-xs text-[rgb(var(--muted))]">At-Risk SKUs</div></Card>
        <Card className="px-3 py-2.5"><div className="text-xl font-bold [font-variant-numeric:tabular-nums]" style={{ fontFamily: mono }}>{Math.round(summary.unitsAtRisk).toLocaleString()}</div><div className="text-xs text-[rgb(var(--muted))]">Units at Risk</div></Card>
        <Card className="px-3 py-2.5"><div className="text-xl font-bold [font-variant-numeric:tabular-nums]" style={{ fontFamily: mono }}>{summary.inboundLoads.toLocaleString()}</div><div className="text-xs text-[rgb(var(--muted))]">Inbound Loads</div></Card>
        <Card className="px-3 py-2.5"><div className="text-xl font-bold [font-variant-numeric:tabular-nums]" style={{ fontFamily: mono }}>{Math.round(summary.unlocked).toLocaleString()}</div><div className="text-xs text-[rgb(var(--muted))]">Units Potentially Unlocked</div></Card>
        <Card className="px-3 py-2.5"><div className="text-xl font-bold [font-variant-numeric:tabular-nums]" style={{ fontFamily: mono }}>{summary.unmatched.toLocaleString()}</div><div className="text-xs text-[rgb(var(--muted))]">Unmatched Materials</div></Card>
      </div>

      <Card className="overflow-hidden">
        <div className="border-b border-[rgb(var(--border))] px-4 py-3">
          <div className="text-sm font-semibold text-[rgb(var(--foreground))]">Material Risk</div>
          <div className="mt-1 text-xs text-[rgb(var(--muted))]">
            Use this section to see which components are short now and whether inbound is enough to cover current work-order demand.
          </div>
        </div>
        <div className="p-4">
          <CriticalItemsView
            rawCriticalItems={rawCriticalItems}
            inboundCoverage={inboundCoverage}
            customerFilter={customerFilter}
            onCustomerFilterChange={setCustomerFilter}
          />
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b border-[rgb(var(--border))] px-4 py-3">
          <div className="text-sm font-semibold text-[rgb(var(--foreground))]">Inbound Loads</div>
          <div className="mt-1 text-xs text-[rgb(var(--muted))]">
            Use this section to follow the Receive Orders behind those shortages, then confirm whether OpenDock has them scheduled.
          </div>
        </div>
        <div className="p-4">
          <TimelineView timelineData={timelineData} deliveriesV2={deliveriesV2} />
        </div>
      </Card>
    </div>
  );
}
