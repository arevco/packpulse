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

  var summary = useMemo(function() {
    var atRiskSkus = Array.isArray(rawCriticalItems) ? rawCriticalItems.length : 0;
    var unitsAtRisk = 0;
    if (inboundCoverage && Array.isArray(inboundCoverage.rows)) {
      unitsAtRisk = inboundCoverage.rows.reduce(function(sum, r) { return sum + safeNum(r.uncoveredQty != null ? r.uncoveredQty : r.shortQty); }, 0);
    } else if (Array.isArray(rawCriticalItems)) {
      unitsAtRisk = rawCriticalItems.reduce(function(sum, r) { return sum + safeNum(r.totalShort); }, 0);
    }
    var inboundLoads = deliveriesV2 && deliveriesV2.summary ? safeNum(deliveriesV2.summary.openDockScheduled) : 0;
    var unlocked = deliveriesV2 && deliveriesV2.summary ? safeNum(deliveriesV2.summary.unitsPotentiallyUnlocked) : 0;
    var unmatched = deliveriesV2 && deliveriesV2.summary ? safeNum(deliveriesV2.summary.materialUnknown) : 0;
    return {
      atRiskSkus: atRiskSkus,
      unitsAtRisk: unitsAtRisk,
      inboundLoads: inboundLoads,
      unlocked: unlocked,
      unmatched: unmatched
    };
  }, [rawCriticalItems, inboundCoverage, deliveriesV2]);

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
        <CriticalItemsView rawCriticalItems={rawCriticalItems} inboundCoverage={inboundCoverage} />
      ) : (
        <TimelineView timelineData={timelineData} deliveriesV2={deliveriesV2} />
      )}
    </div>
  );
}

