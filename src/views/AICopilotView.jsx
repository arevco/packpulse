import { useMemo, useState } from "react";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { useTheme } from "../theme";

function safeNum(v) {
  var n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

function toIsoDateET(d) {
  var dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt)) return "";
  var parts = {};
  new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(dt).forEach(function(p) {
    if (p.type !== "literal") parts[p.type] = p.value;
  });
  return parts.year && parts.month && parts.day ? (parts.year + "-" + parts.month + "-" + parts.day) : "";
}

function severityFromUnits(units) {
  var u = safeNum(units);
  if (u >= 50000) return "danger";
  if (u >= 10000) return "warning";
  return "info";
}

function normalizeSku(value) {
  return String(value || "").trim().replace(/\.0+$/, "").toLowerCase();
}

function statusLooksClosed(status) {
  var s = String(status || "").toLowerCase();
  return !!s && (s.includes("close") || s.includes("complete") || s.includes("cancel") || s.includes("archive") || s.includes("done"));
}

export default function AICopilotView(props) {
  var summary = props.summary || { total: 0, ready: 0, blocked: 0 };
  var criticalItems = Array.isArray(props.criticalItems) ? props.criticalItems : [];
  var dispatchQueue = Array.isArray(props.dispatchQueue) ? props.dispatchQueue : [];
  var productionSegments = props.productionSegments || { shiftRows: [], jobRows: [] };
  var evoconData = Array.isArray(props.evoconData) ? props.evoconData : [];
  var workOrders = Array.isArray(props.workOrders) ? props.workOrders : [];
  var onNavigate = typeof props.onNavigate === "function" ? props.onNavigate : function() {};
  const { mono } = useTheme();

  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");
  const [aiBrief, setAiBrief] = useState("");

  var todayEt = toIsoDateET(new Date());

  var facts = useMemo(function() {
    var todayShiftRows = (productionSegments.shiftRows || []).filter(function(r) {
      return String(r && r.date || "") === todayEt;
    });
    var producedToday = todayShiftRows.reduce(function(sum, r) {
      return sum + safeNum(r && r.unitsProduced);
    }, 0);
    var s1 = todayShiftRows
      .filter(function(r) { return String(r && r.shift || "").toLowerCase().indexOf("shift 1") !== -1; })
      .reduce(function(sum, r) { return sum + safeNum(r && r.unitsProduced); }, 0);
    var s2 = todayShiftRows
      .filter(function(r) { return String(r && r.shift || "").toLowerCase().indexOf("shift 2") !== -1; })
      .reduce(function(sum, r) { return sum + safeNum(r && r.unitsProduced); }, 0);

    var atRiskUnits = criticalItems.reduce(function(sum, r) {
      return sum + safeNum(r && (r.totalShort || r.unitsAtRisk || 0));
    }, 0);
    var highRisk = criticalItems.filter(function(r) {
      return String(r && r.riskLevel || "").toLowerCase() === "high";
    });
    var topRisk = highRisk[0] || criticalItems[0] || null;

    var topRunNext = dispatchQueue.filter(function(r) {
      return String(r && r.targetView || "") === "workorders";
    }).slice(0, 5);

    var batchGroups = {};
    workOrders.forEach(function(wo) {
      var skuRaw = String((wo && (wo.productSkuRaw || wo.productSku)) || "").trim();
      var skuKey = normalizeSku(skuRaw);
      if (!skuKey || statusLooksClosed(wo && wo.status)) return;
      var unitsRemaining = safeNum(wo && wo.unitsRemaining);
      if (!(unitsRemaining > 0)) {
        var qty = safeNum(wo && wo.qtyToProduce);
        var produced = safeNum(wo && wo.unitsProduced);
        unitsRemaining = Math.max(0, qty - produced);
      }
      if (!(unitsRemaining > 0)) return;
      if (!batchGroups[skuKey]) {
        batchGroups[skuKey] = {
          sku: skuRaw || "--",
          count: 0,
          remainingUnits: 0,
          woNums: [],
          dueStart: "",
          dueEnd: ""
        };
      }
      batchGroups[skuKey].count += 1;
      batchGroups[skuKey].remainingUnits += unitsRemaining;
      if (wo && wo.woNum) batchGroups[skuKey].woNums.push(wo.woNum);
      var due = String(wo && wo.dueDate || "").slice(0, 10);
      if (due && (!batchGroups[skuKey].dueStart || due < batchGroups[skuKey].dueStart)) batchGroups[skuKey].dueStart = due;
      if (due && (!batchGroups[skuKey].dueEnd || due > batchGroups[skuKey].dueEnd)) batchGroups[skuKey].dueEnd = due;
    });
    var batchList = Object.keys(batchGroups)
      .map(function(key) { return batchGroups[key]; })
      .filter(function(group) { return group.count > 1; })
      .sort(function(a, b) {
        if (b.count !== a.count) return b.count - a.count;
        return b.remainingUnits - a.remainingUnits;
      });
    var topBatch = batchList[0] || null;

    var evRowsToday = evoconData.filter(function(r) {
      return String(r && r.date || "") === todayEt;
    });
    var unplannedMin = evRowsToday.reduce(function(sum, r) { return sum + Math.round(safeNum(r && r.unplannedstops) / 60); }, 0);
    var slowMin = evRowsToday.reduce(function(sum, r) { return sum + Math.round(safeNum(r && r.slowProduction) / 60); }, 0);

    return {
      todayEt: todayEt,
      producedToday: producedToday,
      producedS1: s1,
      producedS2: s2,
      woTotal: safeNum(summary.total),
      woReady: safeNum(summary.ready),
      woBlocked: safeNum(summary.blocked),
      riskSkuCount: criticalItems.length,
      atRiskUnits: atRiskUnits,
      highRiskCount: highRisk.length,
      topRisk: topRisk,
      topRunNext: topRunNext,
      batchGroupCount: batchList.length,
      batchWorkOrderCount: batchList.reduce(function(sum, group) { return sum + safeNum(group.count); }, 0),
      topBatch: topBatch,
      evoconTodayRows: evRowsToday.length,
      evoconUnplannedMin: unplannedMin,
      evoconSlowMin: slowMin
    };
  }, [productionSegments, todayEt, summary, criticalItems, dispatchQueue, evoconData, workOrders]);

  var cards = useMemo(function() {
    var list = [];
    list.push({
      id: "today-output",
      title: "Today Output Snapshot",
      severity: facts.producedToday > 0 ? "success" : "warning",
      why: "Produced " + Math.round(facts.producedToday).toLocaleString() + " cases so far (S1 " + Math.round(facts.producedS1).toLocaleString() + " / S2 " + Math.round(facts.producedS2).toLocaleString() + ").",
      action: "Review line-level output and shift mix on Operations.",
      confidence: "High",
      view: "operations"
    });
    list.push({
      id: "supply-risk",
      title: "Supply Risk Concentration",
      severity: severityFromUnits(facts.atRiskUnits),
      why: facts.riskSkuCount.toLocaleString() + " at-risk SKUs and " + Math.round(facts.atRiskUnits).toLocaleString() + " units exposed.",
      action: "Prioritize high-risk shortages and inbound scheduling gaps.",
      confidence: "High",
      view: "supplyrisk"
    });
    if (facts.topRisk) {
      list.push({
        id: "top-risk",
        title: "Highest Impact Material",
        severity: "danger",
        why: String(facts.topRisk.sku || "--") + " has " + Math.round(safeNum(facts.topRisk.totalShort || facts.topRisk.unitsAtRisk || 0)).toLocaleString() + " units short.",
        action: String(facts.topRisk.recommendation || "Expedite / resequence based on due date."),
        confidence: "Medium",
        view: "supplyrisk"
      });
    }
    if (facts.topRunNext.length) {
      list.push({
        id: "run-next",
        title: "Run-Next Queue Ready",
        severity: "info",
        why: facts.topRunNext.length + " prioritized WOs are ranked by due risk, net coverage, run window, and shared-component impact.",
        action: "Open Work Orders and run the top ranked candidates.",
        confidence: "High",
        view: "workorders"
      });
    }
    if (facts.topBatch) {
      list.push({
        id: "batching",
        title: "Batching Opportunity",
        severity: facts.topBatch.count >= 4 ? "warning" : "info",
        why: facts.batchGroupCount + " same-item batch groups are open. Top group: " + facts.topBatch.sku + " with " + facts.topBatch.count + " WOs and " + Math.round(facts.topBatch.remainingUnits).toLocaleString() + " remaining cases.",
        action: "Use Work Orders batch filter to reduce changeovers on the top repeated items first.",
        confidence: "High",
        view: "workorders"
      });
    }
    list.push({
      id: "ops-loss",
      title: "Evocon Loss Watch",
      severity: facts.evoconUnplannedMin > 120 ? "warning" : "info",
      why: "Today unplanned stops: " + facts.evoconUnplannedMin.toLocaleString() + " min; speed loss: " + facts.evoconSlowMin.toLocaleString() + " min.",
      action: "Use Evocon Loss Intelligence to target top stop-loss line first.",
      confidence: facts.evoconTodayRows ? "Medium" : "Low",
      view: "operations"
    });
    return list;
  }, [facts]);

  async function generateBrief() {
    setAiLoading(true);
    setAiError("");
    try {
      var contextLines = [
        "Date: " + facts.todayEt,
        "Work orders: " + facts.woTotal + " total, " + facts.woReady + " ready, " + facts.woBlocked + " blocked",
        "Today produced: " + Math.round(facts.producedToday),
        "Supply risk: " + facts.riskSkuCount + " SKUs, " + Math.round(facts.atRiskUnits) + " units at risk",
        "Batching: " + facts.batchGroupCount + " item groups, " + facts.batchWorkOrderCount + " work orders, top batch " + (facts.topBatch ? facts.topBatch.sku + " x" + facts.topBatch.count : "none"),
        "Evocon today: " + facts.evoconUnplannedMin + " unplanned min, " + facts.evoconSlowMin + " speed loss min",
        "Top run next count: " + facts.topRunNext.length
      ];
      var r = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          prompt: "Generate a concise operations copilot brief for daily standup. Use sections: 1) Today snapshot 2) Top 3 risks 3) Top 3 actions by role. Keep it under 180 words and include numbers from context.",
          activeView: "aicopilot",
          contextLines: contextLines,
          metrics: facts,
          history: []
        })
      });
      var body = await r.json().catch(function() { return {}; });
      if (!r.ok) throw new Error(body && (body.error || body.details) ? (body.error || body.details) : "AI request failed");
      setAiBrief(String(body && body.answer || "").trim() || "No AI brief returned.");
    } catch (e) {
      setAiError(e && e.message ? e.message : "Could not generate AI brief");
      setAiBrief("");
    } finally {
      setAiLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <Card className="px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-sm font-semibold">AI Copilot</div>
            <div className="text-xs text-[rgb(var(--muted))]">Deterministic standup signals with AI narrative grounded in current Operations, Work Orders, and Supply Risk data.</div>
          </div>
          <div className="flex items-center gap-1.5">
            <Badge variant="success">Live</Badge>
            <Button variant="outline" size="sm" onClick={generateBrief} disabled={aiLoading}>
              {aiLoading ? "Generating..." : "Generate AI Brief"}
            </Button>
          </div>
        </div>
      </Card>

      {aiError ? <Card className="border-[rgb(var(--danger-line))] bg-[rgb(var(--danger-soft))] px-3 py-2 text-sm text-[rgb(var(--danger))]">{aiError}</Card> : null}
      {aiBrief ? (
        <Card className="px-4 py-3">
          <div className="mb-1 text-xs font-semibold uppercase tracking-[0.08em] text-[rgb(var(--muted))]">AI Brief</div>
          <div className="whitespace-pre-wrap text-sm leading-relaxed">{aiBrief}</div>
        </Card>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {cards.map(function(card) {
          return (
            <Card key={card.id} className="px-4 py-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-sm font-semibold">{card.title}</div>
                <Badge variant={card.severity}>{card.confidence}</Badge>
              </div>
              <div className="mb-1.5 text-sm text-[rgb(var(--foreground))]" style={{ fontFamily: mono }}>{card.why}</div>
              <div className="mb-2 text-xs text-[rgb(var(--muted))]">{card.action}</div>
              <Button size="sm" variant="outline" onClick={function() { onNavigate(card.view); }}>
                Open {card.view === "workorders" ? "Work Orders" : card.view === "supplyrisk" ? "Supply Risk" : "Operations"}
              </Button>
            </Card>
          );
        })}
      </div>

      {facts.topRunNext.length ? (
        <Card className="px-4 py-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-sm font-semibold">Top Run-Next Candidates</div>
            <Button size="sm" variant="outline" onClick={function() { onNavigate("workorders"); }}>Open Queue</Button>
          </div>
          <div className="space-y-1.5">
            {facts.topRunNext.map(function(r, idx) {
              return (
                <div key={r.id || (r.woNum + "-" + idx)} className="flex flex-wrap items-center gap-2 rounded-md border border-[rgb(var(--border))] px-2.5 py-1.5 text-xs">
                  <Badge variant={idx < 2 ? "success" : "secondary"}>#{idx + 1}</Badge>
                  <span className="font-semibold">{r.woNum || "--"}</span>
                  <span className="text-[rgb(var(--muted))]">{r.action || "Run Next"}</span>
                  <span className="text-[rgb(var(--muted))]">Impact {Math.round(safeNum(r.impactUnits)).toLocaleString()} units</span>
                  <span className="text-[rgb(var(--muted))]">Score {Math.round(safeNum(r.priorityScore))}</span>
                </div>
              );
            })}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
