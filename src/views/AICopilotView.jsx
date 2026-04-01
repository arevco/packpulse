import { useMemo, useState } from "react";
import {
  ArrowRight,
  BrainCircuit,
  BriefcaseBusiness,
  ClipboardList,
  FlaskConical,
  Layers3,
  Lightbulb,
  Radar,
  Search,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { useTheme } from "../theme";

function safeNum(v) {
  var n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

function formatWhole(value) {
  return Math.round(safeNum(value)).toLocaleString();
}

function formatSignedPct(value) {
  var n = Math.round(safeNum(value));
  return (n >= 0 ? "+" : "") + n + "%";
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

function formatMetaTimestamp(value) {
  var raw = String(value || "").trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  var parsed = new Date(raw);
  if (isNaN(parsed)) return raw;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
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

function renderInline(text) {
  return String(text || "")
    .split(/(\*\*[^*]+\*\*)/g)
    .filter(Boolean)
    .map(function(part, idx) {
      if (/^\*\*[^*]+\*\*$/.test(part)) {
        return <strong key={idx} className="font-semibold text-[rgb(var(--foreground))]">{part.slice(2, -2)}</strong>;
      }
      return <span key={idx}>{part}</span>;
    });
}

function parseAiBrief(text) {
  var lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  var sections = [];
  var current = null;

  lines.forEach(function(rawLine) {
    var line = String(rawLine || "").replace(/\t/g, "  ");
    var trimmed = line.trim();
    if (!trimmed) return;

    var headingMatch = trimmed.match(/^\*\*(.+?)\*\*$/);
    if (headingMatch) {
      current = {
        title: String(headingMatch[1] || "").replace(/:$/, "").trim(),
        items: []
      };
      sections.push(current);
      return;
    }

    if (!current) {
      current = { title: "Summary", items: [] };
      sections.push(current);
    }

    var listMatch = line.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
    if (listMatch) {
      current.items.push({
        type: "list",
        level: listMatch[1] && listMatch[1].length >= 2 ? 1 : 0,
        marker: listMatch[2],
        text: listMatch[3]
      });
      return;
    }

    current.items.push({ type: "text", text: trimmed });
  });

  return sections;
}

function sectionTone(title) {
  var raw = String(title || "").toLowerCase();
  if (raw.includes("snapshot") || raw.includes("performance") || raw.includes("output")) {
    return {
      panel: "border-[rgba(var(--accent-rgb),0.22)] bg-[rgba(var(--accent-rgb),0.06)]",
      badge: "bg-[rgba(var(--accent-rgb),0.14)] text-[rgb(var(--accent))]"
    };
  }
  if (raw.includes("risk") || raw.includes("watch")) {
    return {
      panel: "border-[rgba(var(--warning-rgb),0.24)] bg-[rgba(var(--warning-rgb),0.08)]",
      badge: "bg-[rgba(var(--warning-rgb),0.14)] text-[rgb(var(--warning))]"
    };
  }
  if (raw.includes("action") || raw.includes("moves") || raw.includes("guidance")) {
    return {
      panel: "border-[rgba(var(--success-rgb),0.24)] bg-[rgba(var(--success-rgb),0.08)]",
      badge: "bg-[rgba(var(--success-rgb),0.14)] text-[rgb(var(--success))]"
    };
  }
  return {
    panel: "border-[rgb(var(--border))] bg-[rgb(var(--surface))]",
    badge: "bg-[rgb(var(--surface-2))] text-[rgb(var(--muted))]"
  };
}

function postureFromFacts(facts, metrics) {
  var staleFeeds = (metrics && Array.isArray(metrics.dataHealth) ? metrics.dataHealth : []).filter(function(feed) {
    var status = String(feed && feed.status || "").toLowerCase();
    return status && status !== "fresh";
  }).length;
  if (facts.highRiskCount >= 2 || facts.evoconUnplannedMin >= 150 || safeNum(facts.woBlocked) > safeNum(facts.woReady) || staleFeeds >= 2) {
    return {
      label: "Intervene",
      detail: "High-risk exposure is large enough that the floor plan needs active intervention.",
      variant: "danger"
    };
  }
  if (facts.highRiskCount >= 1 || facts.atRiskUnits >= 10000 || facts.evoconUnplannedMin >= 60 || staleFeeds >= 1) {
    return {
      label: "Watch",
      detail: "The plan is workable, but the day has enough pressure that it should be managed tightly.",
      variant: "warning"
    };
  }
  return {
    label: "Stable",
    detail: "Signals look contained enough to run the plan with normal supervision.",
    variant: "success"
  };
}

function recommendationForOwner(recommendations, token) {
  var lower = String(token || "").toLowerCase();
  return (recommendations || []).find(function(row) {
    return String(row && row.owner || "").toLowerCase().indexOf(lower) !== -1;
  }) || null;
}

function targetViewForRecommendation(row, fallbackView) {
  var view = String(row && row.targetView || "").toLowerCase();
  if (view === "criticalitems") return "supplyrisk";
  if (view === "workorders" || view === "operations" || view === "supplyrisk") return view;
  return fallbackView || "aicopilot";
}

export default function AICopilotView(props) {
  var summary = props.summary || { total: 0, ready: 0, blocked: 0 };
  var criticalItems = Array.isArray(props.criticalItems) ? props.criticalItems : [];
  var dispatchQueue = Array.isArray(props.dispatchQueue) ? props.dispatchQueue : [];
  var recommendations = Array.isArray(props.recommendations) ? props.recommendations : [];
  var productionSegments = props.productionSegments || { shiftRows: [], jobRows: [] };
  var evoconData = Array.isArray(props.evoconData) ? props.evoconData : [];
  var workOrders = Array.isArray(props.workOrders) ? props.workOrders : [];
  var metrics = props.metrics && typeof props.metrics === "object" ? props.metrics : {};
  var onNavigate = typeof props.onNavigate === "function" ? props.onNavigate : function() {};
  const { mono } = useTheme();

  const [selectedMode, setSelectedMode] = useState("diagnose");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");
  const [aiResult, setAiResult] = useState({
    answer: "",
    mode: "",
    meta: null,
    followUps: [],
  });

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

  var posture = useMemo(function() {
    return postureFromFacts(facts, metrics);
  }, [facts, metrics]);

  var cards = useMemo(function() {
    var list = [];
    list.push({
      id: "today-output",
      title: "Today Output Snapshot",
      severity: facts.producedToday > 0 ? "success" : "warning",
      why: "Produced " + formatWhole(facts.producedToday) + " cases so far (S1 " + formatWhole(facts.producedS1) + " / S2 " + formatWhole(facts.producedS2) + ").",
      action: "Review line-level output and shift mix on Operations.",
      confidence: "High",
      view: "operations"
    });
    list.push({
      id: "supply-risk",
      title: "Supply Risk Concentration",
      severity: severityFromUnits(facts.atRiskUnits),
      why: formatWhole(facts.riskSkuCount) + " at-risk SKUs and " + formatWhole(facts.atRiskUnits) + " units exposed.",
      action: "Prioritize high-risk shortages and inbound scheduling gaps.",
      confidence: "High",
      view: "supplyrisk"
    });
    if (facts.topRisk) {
      list.push({
        id: "top-risk",
        title: "Highest Impact Material",
        severity: "danger",
        why: String(facts.topRisk.sku || "--") + " has " + formatWhole(safeNum(facts.topRisk.totalShort || facts.topRisk.unitsAtRisk || 0)) + " units short.",
        action: String(facts.topRisk.recommendation || facts.topRisk.recommendedAction || "Expedite / resequence based on due date."),
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
        why: facts.batchGroupCount + " same-item batch groups are open. Top group: " + facts.topBatch.sku + " with " + facts.topBatch.count + " WOs and " + formatWhole(facts.topBatch.remainingUnits) + " remaining cases.",
        action: "Use Work Orders batch filters to reduce changeovers on the top repeated items first.",
        confidence: "High",
        view: "workorders"
      });
    }
    list.push({
      id: "ops-loss",
      title: "Evocon Loss Watch",
      severity: facts.evoconUnplannedMin > 120 ? "warning" : "info",
      why: "Today unplanned stops: " + formatWhole(facts.evoconUnplannedMin) + " min; speed loss: " + formatWhole(facts.evoconSlowMin) + " min.",
      action: "Use Operations to target the top stop-loss line first.",
      confidence: facts.evoconTodayRows ? "Medium" : "Low",
      view: "operations"
    });
    return list;
  }, [facts]);

  var ownerMoves = useMemo(function() {
    var plannerRec = recommendationForOwner(recommendations, "planner");
    var supplyRec = recommendationForOwner(recommendations, "supply");
    var opsRec = recommendationForOwner(recommendations, "supervisor") || recommendationForOwner(recommendations, "ops");
    var staleFeeds = (metrics.dataHealth || []).filter(function(feed) {
      return String(feed && feed.status || "").toLowerCase() && String(feed && feed.status || "").toLowerCase() !== "fresh";
    });

    return [
      {
        owner: "Planner",
        title: plannerRec ? plannerRec.action : (facts.topRunNext[0] ? facts.topRunNext[0].action || "Run Next" : "Review Queue"),
        detail: plannerRec
          ? plannerRec.why
          : (facts.topRunNext[0] ? ("Lead with WO " + (facts.topRunNext[0].woNum || "--") + " and keep the same-family queue flowing.") : "Use the ranked dispatch queue to lock the next production sequence."),
        view: targetViewForRecommendation(plannerRec, "workorders"),
        badge: "Today"
      },
      {
        owner: "Supply Chain",
        title: supplyRec ? supplyRec.action : (facts.topRisk && (facts.topRisk.recommendation || facts.topRisk.recommendedAction) ? (facts.topRisk.recommendation || facts.topRisk.recommendedAction) : "Protect Coverage"),
        detail: supplyRec
          ? supplyRec.why
          : (facts.topRisk ? ((facts.topRisk.sku || "--") + " is the sharpest current shortage signal.") : "Validate the highest-risk materials before the next due-date window closes."),
        view: targetViewForRecommendation(supplyRec, "supplyrisk"),
        badge: facts.highRiskCount > 0 ? "Risk" : "Watch"
      },
      {
        owner: "Floor Lead",
        title: opsRec ? opsRec.action : "Recover Throughput",
        detail: opsRec
          ? opsRec.why
          : ("Today shows " + formatWhole(facts.evoconUnplannedMin) + " min unplanned stops and " + formatWhole(facts.evoconSlowMin) + " min slow production."),
        view: targetViewForRecommendation(opsRec, "operations"),
        badge: facts.evoconUnplannedMin > 60 ? "Loss" : "Flow"
      },
      {
        owner: "Ops Analyst",
        title: staleFeeds.length ? "Refresh Feeds" : "Validate Narrative",
        detail: staleFeeds.length
          ? ("Refresh " + staleFeeds.slice(0, 3).map(function(feed) { return String(feed && feed.label || "source"); }).join(", ") + " before using the next narrative externally.")
          : "Core feeds look healthy enough to support standups and escalation notes.",
        view: staleFeeds.length ? "operations" : "aicopilot",
        badge: staleFeeds.length ? "Data" : "Ready"
      }
    ];
  }, [recommendations, facts, metrics.dataHealth]);

  var aiBriefSections = useMemo(function() {
    return parseAiBrief(aiResult.answer);
  }, [aiResult.answer]);

  var playbooks = useMemo(function() {
    return [
      {
        id: "diagnose",
        label: "Diagnose",
        description: "Interpret what is happening before jumping to action.",
        kicker: "Analyst",
        icon: Search,
        prompt: "Diagnose what is going on in the operation right now. Interpret the data, name likely drivers, and tell me what you would check next."
      },
      {
        id: "recommend",
        label: "Recommend",
        description: "Turn the evidence into the best next moves and tradeoffs.",
        kicker: "Decision",
        icon: BrainCircuit,
        prompt: "Recommend the best next moves from the current operational data. Include tradeoffs and owner-specific actions."
      },
      {
        id: "simulate",
        label: "Simulate",
        description: "Model useful what-if scenarios from current queue, risk, and flow signals.",
        kicker: "Scenarios",
        icon: FlaskConical,
        prompt: "Simulate the most useful what-if scenarios from the current operation. Compare shortage recovery, batching, and throughput recovery options."
      },
      {
        id: "ideate",
        label: "Ideate",
        description: "Generate creative but grounded ideas to improve flow and decision quality.",
        kicker: "Explore",
        icon: Lightbulb,
        prompt: "Ideate practical, grounded ways to improve flow, sequencing, and risk management from the current data."
      },
      {
        id: "explain_change",
        label: "Explain Change",
        description: "Explain what changed and what is most likely driving it.",
        kicker: "Delta",
        icon: TrendingUp,
        prompt: "Explain what changed versus last week and what is most likely driving the change."
      },
      {
        id: "standup",
        label: "Standup Brief",
        description: "Floor-ready snapshot, risks, and owner actions.",
        kicker: "Shift pulse",
        icon: ClipboardList,
        prompt: "Generate a concise operations copilot brief for daily standup. Use sections: 1) Today snapshot 2) Top risks 3) Actions by role 4) Confidence / source. Keep it under 220 words and include numbers from context."
      },
      {
        id: "run_next",
        label: "Run Next",
        description: "Rank the best next work orders and explain sequencing.",
        kicker: "Dispatch",
        icon: Sparkles,
        prompt: "Which work orders should we run next and why? Use sections: 1) Run next 2) Why these jobs 3) Sequencing guidance 4) Confidence / source."
      },
      {
        id: "risk_radar",
        label: "Risk Radar",
        description: "Expose what can derail the plan today and what to do first.",
        kicker: "Shortage watch",
        icon: Radar,
        prompt: "Which risks can derail today's plan? Focus on shortages, due-date exposure, and concrete owner actions."
      },
      {
        id: "batch_plan",
        label: "Batch Plan",
        description: "Find same-item families that can reduce changeovers.",
        kicker: "Changeovers",
        icon: Layers3,
        prompt: "Where are the best batching opportunities right now? Group by same-item families, recommend sequence order, and call out any watchouts."
      },
      {
        id: "throughput_watch",
        label: "Throughput Watch",
        description: "Turn output pace and loss signals into a recovery plan.",
        kicker: "Recovery",
        icon: TrendingUp,
        prompt: "Create a throughput watch. Use sections: 1) Output pace 2) Loss watch 3) Recovery moves 4) Confidence / source."
      },
      {
        id: "executive_brief",
        label: "Executive Brief",
        description: "A tighter leadership recap with performance, risk, and management moves.",
        kicker: "Leadership",
        icon: BriefcaseBusiness,
        prompt: "Create a concise executive brief for plant leadership. Use sections: 1) Performance 2) Operating risk 3) Management moves 4) Confidence / source. Keep it under 180 words."
      }
    ];
  }, []);

  var selectedPlaybook = playbooks.find(function(playbook) {
    return playbook.id === selectedMode;
  }) || playbooks[0];

  async function runCopilot(mode, promptOverride) {
    var playbook = playbooks.find(function(item) { return item.id === mode; }) || selectedPlaybook;
    if (!playbook) return;
    setSelectedMode(playbook.id);
    setAiLoading(true);
    setAiError("");
    try {
      var contextLines = [
        "Date: " + facts.todayEt,
        "Work orders: " + facts.woTotal + " total, " + facts.woReady + " ready, " + facts.woBlocked + " blocked",
        "Today produced: " + formatWhole(facts.producedToday) + " cases",
        "Supply risk: " + facts.riskSkuCount + " SKUs, " + formatWhole(facts.atRiskUnits) + " units at risk",
        "Batching: " + facts.batchGroupCount + " item groups, " + facts.batchWorkOrderCount + " work orders, top batch " + (facts.topBatch ? facts.topBatch.sku + " x" + facts.topBatch.count : "none"),
        "Evocon today: " + facts.evoconUnplannedMin + " unplanned min, " + facts.evoconSlowMin + " speed loss min",
        "Top run-next count: " + facts.topRunNext.length,
        "Posture: " + posture.label
      ];
      var mergedMetrics = Object.assign({}, metrics, {
        todayEt: facts.todayEt,
        productionTodayCases: facts.producedToday,
        productionTodayShift1Cases: facts.producedS1,
        productionTodayShift2Cases: facts.producedS2,
        workOrdersTotal: facts.woTotal,
        workOrdersReady: facts.woReady,
        workOrdersBlocked: facts.woBlocked,
        supplyRiskItems: facts.riskSkuCount,
        atRiskUnits: facts.atRiskUnits,
        highRiskCount: facts.highRiskCount,
        evoconUnplannedMin: facts.evoconUnplannedMin,
        evoconSlowMin: facts.evoconSlowMin,
      });
      var r = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          prompt: promptOverride || playbook.prompt,
          copilotMode: playbook.id,
          activeView: "aicopilot",
          contextLines: contextLines,
          metrics: mergedMetrics,
          history: []
        })
      });
      var body = await r.json().catch(function() { return {}; });
      if (!r.ok) throw new Error(body && (body.error || body.details) ? (body.error || body.details) : "AI request failed");
      setAiResult({
        answer: String(body && body.answer || "").trim() || "No AI brief returned.",
        mode: playbook.id,
        meta: body && body.meta ? body.meta : null,
        followUps: Array.isArray(body && body.followUps) ? body.followUps : [],
      });
    } catch (e) {
      setAiError(e && e.message ? e.message : "Could not generate AI brief");
      setAiResult({ answer: "", mode: playbook.id, meta: null, followUps: [] });
    } finally {
      setAiLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden border-[rgba(var(--accent-rgb),0.18)] bg-[linear-gradient(135deg,rgba(var(--accent-rgb),0.14),rgba(255,255,255,0.96)_60%)] px-4 py-4">
        <div className="grid gap-4 xl:grid-cols-[1.4fr,1fr]">
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge variant="info">AI Copilot Command Center</Badge>
              <Badge variant={posture.variant}>{posture.label}</Badge>
              <Badge variant="success">Live</Badge>
            </div>
            <div className="max-w-3xl text-xl font-semibold tracking-tight text-[rgb(var(--foreground))]">
              Reframe the day from signals into decisions, then turn those decisions into owner-specific moves.
            </div>
            <div className="mt-2 max-w-2xl text-sm leading-6 text-[rgb(var(--muted))]">
              The copilot now blends PackPulse metrics, work-order sequencing, shortage pressure, throughput loss, and data health into focused playbooks. Use it as a standup engine, a sequencing coach, or a fast escalation writer.
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button size="sm" variant="default" onClick={function() { runCopilot(selectedPlaybook.id); }} disabled={aiLoading}>
                {aiLoading ? "Running..." : "Run " + selectedPlaybook.label}
              </Button>
              <Button size="sm" variant="outline" onClick={function() { onNavigate("workorders"); }}>
                Open Work Orders
              </Button>
              <div className="text-xs text-[rgb(var(--muted))]">{posture.detail}</div>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-2">
            <div className="rounded-2xl border border-white/70 bg-white/80 px-3 py-3 shadow-sm">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[rgb(var(--muted))]">Output Today</div>
              <div className="mt-2 text-2xl font-semibold text-[rgb(var(--foreground))]">{formatWhole(facts.producedToday)}</div>
              <div className="mt-1 text-xs text-[rgb(var(--muted))]">Cases so far | S1 {formatWhole(facts.producedS1)} / S2 {formatWhole(facts.producedS2)}</div>
            </div>
            <div className="rounded-2xl border border-white/70 bg-white/80 px-3 py-3 shadow-sm">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[rgb(var(--muted))]">Supply Exposure</div>
              <div className="mt-2 text-2xl font-semibold text-[rgb(var(--foreground))]">{formatWhole(facts.atRiskUnits)}</div>
              <div className="mt-1 text-xs text-[rgb(var(--muted))]">{facts.highRiskCount} high-risk items live right now</div>
            </div>
            <div className="rounded-2xl border border-white/70 bg-white/80 px-3 py-3 shadow-sm">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[rgb(var(--muted))]">Run-Next Depth</div>
              <div className="mt-2 text-2xl font-semibold text-[rgb(var(--foreground))]">{facts.topRunNext.length}</div>
              <div className="mt-1 text-xs text-[rgb(var(--muted))]">{facts.topRunNext[0] ? ("Lead WO " + (facts.topRunNext[0].woNum || "--")) : "No ranked lead yet"}</div>
            </div>
            <div className="rounded-2xl border border-white/70 bg-white/80 px-3 py-3 shadow-sm">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[rgb(var(--muted))]">Changeover Wins</div>
              <div className="mt-2 text-2xl font-semibold text-[rgb(var(--foreground))]">{facts.batchGroupCount}</div>
              <div className="mt-1 text-xs text-[rgb(var(--muted))]">{facts.topBatch ? (facts.topBatch.sku + " x" + facts.topBatch.count) : "No repeat families open"}</div>
            </div>
          </div>
        </div>
      </Card>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {ownerMoves.map(function(move) {
          return (
            <Card key={move.owner} className="px-4 py-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-sm font-semibold">{move.owner}</div>
                <Badge variant="secondary">{move.badge}</Badge>
              </div>
              <div className="mb-1 text-sm font-medium text-[rgb(var(--foreground))]">{move.title}</div>
              <div className="mb-3 text-xs leading-6 text-[rgb(var(--muted))]">{move.detail}</div>
              <Button size="sm" variant="outline" onClick={function() { onNavigate(move.view); }}>
                Open {move.view === "workorders" ? "Work Orders" : move.view === "supplyrisk" ? "Supply Risk" : move.view === "operations" ? "Operations" : "Copilot"}
              </Button>
            </Card>
          );
        })}
      </div>

      <Card className="px-4 py-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-sm font-semibold">Copilot Playbooks</div>
            <div className="mt-1 text-xs text-[rgb(var(--muted))]">Pick a mode to generate a different kind of grounded guidance from the same operating context.</div>
          </div>
          <Button size="sm" variant="outline" onClick={function() { runCopilot(selectedPlaybook.id); }} disabled={aiLoading}>
            {aiLoading ? "Running..." : "Generate " + selectedPlaybook.label}
          </Button>
        </div>
        <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
          {playbooks.map(function(playbook) {
            var Icon = playbook.icon;
            var isActive = playbook.id === selectedMode;
            return (
              <button
                key={playbook.id}
                type="button"
                onClick={function() { setSelectedMode(playbook.id); }}
                className={
                  "group rounded-2xl border px-4 py-4 text-left transition " +
                  (isActive
                    ? "border-[rgb(var(--accent))] bg-[rgba(var(--accent-rgb),0.08)] shadow-sm"
                    : "border-[rgb(var(--border))] bg-white hover:border-[rgba(var(--accent-rgb),0.32)] hover:bg-[rgb(var(--surface))]")
                }
              >
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div className={"inline-flex h-10 w-10 items-center justify-center rounded-2xl " + (isActive ? "bg-[rgba(var(--accent-rgb),0.12)] text-[rgb(var(--accent))]" : "bg-[rgb(var(--surface))] text-[rgb(var(--muted))]")}>
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <Badge variant={isActive ? "info" : "secondary"}>{playbook.kicker}</Badge>
                </div>
                <div className="text-sm font-semibold text-[rgb(var(--foreground))]">{playbook.label}</div>
                <div className="mt-1 text-xs leading-6 text-[rgb(var(--muted))]">{playbook.description}</div>
                <div className="mt-4 flex items-center gap-1 text-xs font-medium text-[rgb(var(--accent))]">
                  Selected {isActive ? <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /> : null}
                </div>
              </button>
            );
          })}
        </div>
      </Card>

      {aiError ? <Card className="border-[rgb(var(--danger-line))] bg-[rgb(var(--danger-soft))] px-3 py-2 text-sm text-[rgb(var(--danger))]">{aiError}</Card> : null}

      {aiResult.answer ? (
        <Card className="overflow-hidden border-[rgba(var(--accent-rgb),0.16)] bg-[linear-gradient(180deg,rgba(var(--accent-rgb),0.05),rgba(255,255,255,0))] px-4 py-4">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[rgb(var(--muted))]">
                {aiResult.meta && aiResult.meta.modeLabel ? aiResult.meta.modeLabel : "Copilot Output"}
              </div>
              <div className="mt-1 text-sm text-[rgb(var(--muted))]">
                {aiResult.meta && aiResult.meta.sourceLabel ? aiResult.meta.sourceLabel : "Grounded response from current PackPulse context."}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {aiResult.meta && aiResult.meta.deterministic ? <Badge variant="success">Deterministic</Badge> : <Badge variant="info">AI + Grounding</Badge>}
              {aiResult.meta && aiResult.meta.provider ? <Badge variant="secondary">{aiResult.meta.provider}</Badge> : null}
              {aiResult.meta && aiResult.meta.toolsUsed && aiResult.meta.toolsUsed.length ? <Badge variant="secondary">{aiResult.meta.toolsUsed.length} tools</Badge> : null}
              {aiResult.meta && aiResult.meta.dataTimestamp ? <Badge variant="secondary">{formatMetaTimestamp(aiResult.meta.dataTimestamp)}</Badge> : null}
              <Badge variant="secondary">{aiResult.meta && aiResult.meta.modeLabel ? aiResult.meta.modeLabel : selectedPlaybook.label}</Badge>
            </div>
          </div>
          {aiResult.meta && (aiResult.meta.analysisSummary || (aiResult.meta.toolsUsed && aiResult.meta.toolsUsed.length)) ? (
            <div className="mb-4 rounded-xl border border-[rgb(var(--border))] bg-white/70 px-3 py-3 text-xs text-[rgb(var(--muted))]">
              {aiResult.meta.analysisSummary ? <div className="mb-2 text-sm text-[rgb(var(--foreground))]">{aiResult.meta.analysisSummary}</div> : null}
              {aiResult.meta.toolsUsed && aiResult.meta.toolsUsed.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {aiResult.meta.toolsUsed.map(function(tool) {
                    return <Badge key={tool} variant="secondary">{tool}</Badge>;
                  })}
                </div>
              ) : null}
            </div>
          ) : null}

          {aiBriefSections.length ? (
            <div className="grid gap-3 xl:grid-cols-3">
              {aiBriefSections.map(function(section, sectionIdx) {
                var tone = sectionTone(section.title);
                return (
                  <div key={section.title + "-" + sectionIdx} className={"rounded-xl border px-4 py-3 shadow-sm " + tone.panel}>
                    <div className="mb-3 flex items-center gap-2">
                      <div className={"inline-flex min-w-[28px] items-center justify-center rounded-full px-2 py-1 text-[11px] font-semibold " + tone.badge}>
                        {sectionIdx + 1}
                      </div>
                      <div className="text-sm font-semibold text-[rgb(var(--foreground))]">{section.title.replace(/^\d+\)\s*/, "")}</div>
                    </div>
                    <div className="space-y-2.5 text-sm leading-6 text-[rgb(var(--foreground))]">
                      {section.items.map(function(item, itemIdx) {
                        if (item.type === "text") {
                          return (
                            <div key={itemIdx} className="rounded-lg bg-white/70 px-3 py-2">
                              {renderInline(item.text)}
                            </div>
                          );
                        }
                        var indentClass = item.level > 0 ? "ml-5" : "";
                        var markerLabel = /^\d+\.$/.test(item.marker) ? item.marker.slice(0, -1) : item.level > 0 ? ">" : "-";
                        return (
                          <div key={itemIdx} className={"flex items-start gap-2 " + indentClass}>
                            <div className={"mt-0.5 inline-flex h-6 min-w-[24px] items-center justify-center rounded-full text-[11px] font-semibold " + (item.level > 0 ? "bg-white/80 text-[rgb(var(--muted))]" : tone.badge)}>
                              {markerLabel}
                            </div>
                            <div className="min-w-0 flex-1 rounded-lg bg-white/70 px-3 py-2">
                              {renderInline(item.text)}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="whitespace-pre-wrap rounded-xl border border-[rgb(var(--border))] bg-white/80 px-4 py-3 text-sm leading-relaxed">
              {aiResult.answer}
            </div>
          )}

          {aiResult.followUps.length ? (
            <div className="mt-4">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[rgb(var(--muted))]">Ask Next</div>
              <div className="flex flex-wrap gap-1.5">
                {aiResult.followUps.map(function(prompt) {
                  return (
                    <button
                      key={prompt}
                      type="button"
                      onClick={function() { runCopilot(selectedPlaybook.id, prompt); }}
                      className="rounded-full border border-[rgb(var(--border))] bg-white px-3 py-1.5 text-xs text-[rgb(var(--foreground))] transition hover:border-[rgb(var(--accent))] hover:text-[rgb(var(--accent))]"
                    >
                      {prompt}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </Card>
      ) : (
        <Card className="px-4 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">No Copilot Output Yet</div>
              <div className="mt-1 max-w-2xl text-sm leading-6 text-[rgb(var(--muted))]">
                Start with <strong>{selectedPlaybook.label}</strong> if you want the fastest way to turn today’s signals into an interpreted plan. The result will come back from an analyst loop that plans, gathers evidence, and then writes the conclusion with follow-up prompts you can keep drilling into.
              </div>
            </div>
            <Button size="sm" variant="outline" onClick={function() { runCopilot(selectedPlaybook.id); }} disabled={aiLoading}>
              {aiLoading ? "Running..." : "Generate First Output"}
            </Button>
          </div>
        </Card>
      )}

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
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-sm font-semibold">Top Run-Next Candidates</div>
              <div className="mt-1 text-xs text-[rgb(var(--muted))]">These come from the dispatch engine, then the copilot can reframe them into sequence guidance or standup language.</div>
            </div>
            <Button size="sm" variant="outline" onClick={function() { onNavigate("workorders"); }}>Open Queue</Button>
          </div>
          <div className="space-y-1.5">
            {facts.topRunNext.map(function(r, idx) {
              return (
                <div key={r.id || (r.woNum + "-" + idx)} className="flex flex-wrap items-center gap-2 rounded-md border border-[rgb(var(--border))] px-2.5 py-1.5 text-xs">
                  <Badge variant={idx < 2 ? "success" : "secondary"}>#{idx + 1}</Badge>
                  <span className="font-semibold">{r.woNum || "--"}</span>
                  <span className="text-[rgb(var(--muted))]">{r.action || "Run Next"}</span>
                  <span className="text-[rgb(var(--muted))]">Impact {formatWhole(r.impactUnits)} units</span>
                  <span className="text-[rgb(var(--muted))]">Score {formatWhole(r.priorityScore)}</span>
                  {r.why ? <span className="text-[rgb(var(--muted))]">{r.why}</span> : null}
                </div>
              );
            })}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
