import Sentry from "../_sentry.js";
import { classifyShiftET, pickFieldLoose, toEasternParts, toIso } from "../_labor.js";
import { CACHE_SITE_ID, getAuthenticatedUser, getSupabaseAdmin, withCors } from "../ops/_common.js";

function toText(value) {
  if (value == null) return "";
  return String(value).trim();
}

function toNum(value) {
  var n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function isTodayCasesQuestion(prompt) {
  var q = toText(prompt).toLowerCase();
  if (!q) return false;
  return (
    q.includes("how many cases") && q.includes("today") ||
    q.includes("cases produced today") ||
    q.includes("today production") ||
    q.includes("produced today")
  );
}

function isYesterdayCasesQuestion(prompt) {
  var q = toText(prompt).toLowerCase();
  if (!q) return false;
  return (
    q.includes("how many cases") && q.includes("yesterday") ||
    q.includes("cases produced yesterday") ||
    q.includes("yesterday production") ||
    q.includes("produced yesterday")
  );
}

function isCasesProducedQuestion(prompt) {
  var q = toText(prompt).toLowerCase();
  if (!q) return false;
  return q.includes("how many cases") || q.includes("cases produced") || q.includes("production cases");
}

function isAverageDailyQuestion(prompt) {
  var q = toText(prompt).toLowerCase();
  if (!q) return false;
  return (q.includes("average") || q.includes("avg")) && (q.includes("daily") || q.includes("per day")) && (q.includes("production") || q.includes("yield") || q.includes("cases"));
}

function isTopLineQuestion(prompt) {
  var q = toText(prompt).toLowerCase();
  if (!q) return false;
  return q.includes("top line") || q.includes("best line") || q.includes("which line produced") || q.includes("line produced most");
}

function isTopSkuQuestion(prompt) {
  var q = toText(prompt).toLowerCase();
  if (!q) return false;
  return q.includes("top sku") || q.includes("top skus") || q.includes("top item") || q.includes("sku mix") || q.includes("item mix");
}

function isShiftSplitQuestion(prompt) {
  var q = toText(prompt).toLowerCase();
  if (!q) return false;
  return q.includes("shift split") || q.includes("shift breakdown") || q.includes("which shift") || q.includes("shift 1 vs shift 2");
}

function isPeriodComparisonQuestion(prompt) {
  var q = toText(prompt).toLowerCase();
  if (!q) return false;
  return (
    q.includes("compare this week vs last week") ||
    q.includes("this week vs last week") ||
    q.includes("week over week") ||
    q.includes("compare this month vs last month") ||
    q.includes("this month vs last month") ||
    q.includes("month over month")
  );
}

function isRevenueQuestion(prompt) {
  var q = toText(prompt).toLowerCase();
  if (!q) return false;
  return (
    q.includes("revenue") ||
    q.includes("sales value") ||
    q.includes("dollar value") ||
    q.includes("dollars produced") ||
    q.includes("value produced")
  ) && !q.includes("missing revenue") && !q.includes("pricing coverage");
}

function isMissingRevenueQuestion(prompt) {
  var q = toText(prompt).toLowerCase();
  if (!q) return false;
  return (
    q.includes("missing revenue") ||
    q.includes("missing pricing") ||
    q.includes("unpriced sku") ||
    q.includes("pricing coverage") ||
    q.includes("which skus are missing revenue")
  );
}

function isLaborQuestion(prompt) {
  var q = toText(prompt).toLowerCase();
  if (!q) return false;
  return (
    q.includes("labor cost") ||
    q.includes("labour cost") ||
    q.includes("labor hours") ||
    q.includes("labour hours") ||
    q.includes("cases per labor hour") ||
    q.includes("cases per labour hour") ||
    q.includes("labor productivity") ||
    q.includes("labor efficiency")
  );
}

function isBatchOpportunityQuestion(prompt) {
  var q = toText(prompt).toLowerCase();
  if (!q) return false;
  return (
    q.includes("batch") ||
    q.includes("same item") ||
    q.includes("changeover") ||
    q.includes("batching opportunity")
  );
}

function needsProductionDetailPrompt(prompt) {
  return isTopSkuQuestion(prompt) || isRevenueQuestion(prompt) || isMissingRevenueQuestion(prompt);
}

function detectPeriodLabel(prompt) {
  var q = toText(prompt).toLowerCase();
  if (!q) return "";
  if (q.includes("today")) return "today";
  if (q.includes("yesterday")) return "yesterday";
  if (q.includes("this week") || q.includes("current week")) return "this_week";
  if (q.includes("last week") || q.includes("previous week") || q.includes("prior week")) return "last_week";
  if (q.includes("this month") || q.includes("current month")) return "this_month";
  if (q.includes("last month") || q.includes("previous month") || q.includes("prior month")) return "last_month";
  return "";
}

function ymdInEtFromDate(date) {
  var parts = {};
  new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .formatToParts(date)
    .forEach(function(part) {
      if (part.type !== "literal") parts[part.type] = part.value;
    });
  return parts.year && parts.month && parts.day ? (parts.year + "-" + parts.month + "-" + parts.day) : "";
}

function shiftIsoDate(dateIso, days) {
  if (!dateIso) return "";
  var d = new Date(dateIso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function startOfWeekIso(dateIso) {
  if (!dateIso) return "";
  var d = new Date(dateIso + "T00:00:00");
  var dow = d.getDay();
  var delta = dow === 0 ? -6 : 1 - dow; // Monday start
  d.setDate(d.getDate() + delta);
  return d.toISOString().slice(0, 10);
}

function startOfMonthIso(dateIso) {
  if (!dateIso) return "";
  var d = new Date(dateIso + "T00:00:00");
  d.setDate(1);
  return d.toISOString().slice(0, 10);
}

function endOfMonthIso(dateIso) {
  if (!dateIso) return "";
  var d = new Date(dateIso + "T00:00:00");
  d.setMonth(d.getMonth() + 1, 0);
  return d.toISOString().slice(0, 10);
}

function resolvePeriodRange(periodLabel, anchorDateIso) {
  var anchor = anchorDateIso || ymdInEtFromDate(new Date());
  var start = "";
  var end = "";
  var label = "";
  if (periodLabel === "today") {
    start = anchor;
    end = anchor;
    label = "today";
  } else if (periodLabel === "yesterday") {
    start = shiftIsoDate(anchor, -1);
    end = start;
    label = "yesterday";
  } else if (periodLabel === "this_week") {
    start = startOfWeekIso(anchor);
    end = anchor;
    label = "this week";
  } else if (periodLabel === "last_week") {
    var thisWeekStart = startOfWeekIso(anchor);
    start = shiftIsoDate(thisWeekStart, -7);
    end = shiftIsoDate(thisWeekStart, -1);
    label = "last week";
  } else if (periodLabel === "this_month") {
    start = startOfMonthIso(anchor);
    end = anchor;
    label = "this month";
  } else if (periodLabel === "last_month") {
    var thisMonthStart = startOfMonthIso(anchor);
    var lastMonthAnchor = shiftIsoDate(thisMonthStart, -1);
    start = startOfMonthIso(lastMonthAnchor);
    end = endOfMonthIso(lastMonthAnchor);
    label = "last month";
  } else {
    start = shiftIsoDate(anchor, -6);
    end = anchor;
    label = "last 7 days";
  }
  return { start: start, end: end, label: label };
}

function isLastWeekSummaryQuestion(prompt) {
  var q = toText(prompt).toLowerCase();
  if (!q) return false;
  var hasLastWeek = q.includes("last week") || q.includes("previous week") || q.includes("prior week");
  var hasProd = q.includes("production") || q.includes("reports") || q.includes("yield") || q.includes("cases");
  return hasLastWeek && hasProd;
}

function wantsDetailedBreakdown(prompt) {
  var q = toText(prompt).toLowerCase();
  if (!q) return false;
  return (
    q.includes("include") ||
    q.includes("breakdown") ||
    q.includes("reasoning") ||
    q.includes("why") ||
    q.includes("sku") ||
    q.includes("yield") ||
    q.includes("utilization") ||
    q.includes("machine")
  );
}

function isChartSummaryQuestion(prompt) {
  var q = toText(prompt).toLowerCase();
  if (!q) return false;
  return (
    q.includes("summarize these charts") ||
    q.includes("summarise these charts") ||
    q.includes("summarize the charts") ||
    q.includes("chart summary")
  );
}

function isMarchYieldQuestion(prompt) {
  var q = toText(prompt).toLowerCase();
  if (!q) return false;
  var mentionsYield = q.includes("daily production yield") || q.includes("daily yield") || q.includes("cases per day") || q.includes("daily production");
  var mentionsMarch = q.includes("march");
  var mentionsTarget = q.includes("hit") || q.includes("necessary") || q.includes("need") || q.includes("target");
  return mentionsYield && mentionsMarch && mentionsTarget;
}

function extractComponentLookupSku(prompt) {
  var q = toText(prompt);
  if (!q) return "";
  var m = q.match(/components?\s+(?:are\s+used\s+in|for|in)\s+([a-zA-Z0-9\-]+)/i);
  if (m && m[1]) return String(m[1]).trim();
  var m2 = q.match(/what\s+is\s+in\s+([a-zA-Z0-9\-]+)/i);
  if (m2 && m2[1]) return String(m2[1]).trim();
  return "";
}

function normalizeSku(value) {
  return String(value || "").trim().replace(/\.0+$/, "").toLowerCase();
}

function parseDateIso(value) {
  if (!value) return "";
  var d = value instanceof Date ? value : new Date(value);
  if (isNaN(d)) return "";
  return d.toISOString().slice(0, 10);
}

function statusLooksClosed(status) {
  var s = toText(status).toLowerCase();
  return !!s && (
    s.includes("close") ||
    s.includes("complete") ||
    s.includes("cancel") ||
    s.includes("archive") ||
    s.includes("done")
  );
}

function pickItemMasterValue(row) {
  return toNum(firstField(row, [
    "Cost Per Unit", "cost_per_unit", "Unit Cost", "unit_cost",
    "Standard Cost", "standard_cost", "Cost Per Base Unit", "cost_per_base_unit"
  ]));
}

function sourceNote(label, detail) {
  var cleanLabel = toText(label);
  var cleanDetail = toText(detail);
  if (!cleanLabel && !cleanDetail) return "";
  if (cleanLabel && cleanDetail) return " Source: " + cleanLabel + " through " + cleanDetail + ".";
  return " Source: " + (cleanLabel || cleanDetail) + ".";
}

function formatWholeNumber(value) {
  return Math.round(toNum(value)).toLocaleString();
}

function formatSignedPercent(value) {
  var n = Math.round(toNum(value));
  return (n >= 0 ? "+" : "") + n + "%";
}

function takeTop(list, limit) {
  return Array.isArray(list) ? list.slice(0, limit || 5) : [];
}

function isRunNextQuestion(prompt) {
  var q = toText(prompt).toLowerCase();
  if (!q) return false;
  return (
    q.includes("run next") ||
    q.includes("what should we run") ||
    q.includes("prioritize work orders") ||
    q.includes("which work orders should we run")
  );
}

function isStandupQuestion(prompt) {
  var q = toText(prompt).toLowerCase();
  if (!q) return false;
  return (
    q.includes("standup brief") ||
    q.includes("stand-up brief") ||
    q.includes("daily standup") ||
    (q.includes("standup") && q.includes("brief"))
  );
}

function isWhatChangedQuestion(prompt) {
  var q = toText(prompt).toLowerCase();
  if (!q) return false;
  return (
    q.includes("what changed") ||
    q.includes("what is different") ||
    q.includes("what's different") ||
    q.includes("changed since last week")
  );
}

function isDataHealthQuestion(prompt) {
  var q = toText(prompt).toLowerCase();
  if (!q) return false;
  return (
    q.includes("data health") ||
    q.includes("data freshness") ||
    q.includes("fresh data") ||
    q.includes("stale data") ||
    q.includes("which feeds are stale")
  );
}

function isRiskRadarQuestion(prompt) {
  var q = toText(prompt).toLowerCase();
  if (!q) return false;
  return (
    q.includes("risk radar") ||
    q.includes("top risks") ||
    q.includes("most urgent risks") ||
    q.includes("what can derail")
  );
}

function isThroughputWatchQuestion(prompt) {
  var q = toText(prompt).toLowerCase();
  if (!q) return false;
  return (
    q.includes("throughput watch") ||
    q.includes("recovery plan") ||
    q.includes("recover throughput") ||
    q.includes("slow production") ||
    q.includes("unplanned stops")
  );
}

function isExecutiveBriefQuestion(prompt) {
  var q = toText(prompt).toLowerCase();
  if (!q) return false;
  return (
    q.includes("executive brief") ||
    q.includes("exec brief") ||
    q.includes("board update") ||
    q.includes("leadership recap")
  );
}

function buildModeLabel(mode) {
  var key = toText(mode).toLowerCase();
  if (key === "standup") return "Standup Brief";
  if (key === "run_next") return "Run Next";
  if (key === "risk_radar") return "Risk Radar";
  if (key === "batch_plan") return "Batch Plan";
  if (key === "throughput_watch") return "Throughput Watch";
  if (key === "executive_brief") return "Executive Brief";
  if (key === "what_changed") return "Change Summary";
  if (key === "data_health") return "Data Health";
  return "Copilot";
}

function inferCopilotMode(prompt, explicitMode) {
  var mode = toText(explicitMode).toLowerCase();
  if (mode) return mode;
  if (isStandupQuestion(prompt)) return "standup";
  if (isRunNextQuestion(prompt)) return "run_next";
  if (isRiskRadarQuestion(prompt)) return "risk_radar";
  if (isBatchOpportunityQuestion(prompt)) return "batch_plan";
  if (isThroughputWatchQuestion(prompt)) return "throughput_watch";
  if (isExecutiveBriefQuestion(prompt)) return "executive_brief";
  if (isWhatChangedQuestion(prompt)) return "what_changed";
  if (isDataHealthQuestion(prompt)) return "data_health";
  return "";
}

function followUpsForMode(mode, activeView) {
  var key = toText(mode).toLowerCase();
  if (key === "standup") {
    return [
      "What should we run next and why?",
      "Which shortages are most urgent today?",
      "What changed vs last week?"
    ];
  }
  if (key === "run_next") {
    return [
      "Where are the best batching opportunities?",
      "Which shortages could block the top runs?",
      "Write a standup brief from this queue."
    ];
  }
  if (key === "risk_radar") {
    return [
      "What should supply chain do first?",
      "Which SKUs are missing revenue coverage?",
      "Summarize top blockers in one paragraph."
    ];
  }
  if (key === "batch_plan") {
    return [
      "What should we run next and why?",
      "Build a shift handoff note from this plan.",
      "Which shortages could break the batches?"
    ];
  }
  if (key === "throughput_watch") {
    return [
      "Summarize today vs yesterday output.",
      "Write a standup brief with output, risk, and actions.",
      "What changed vs last week?"
    ];
  }
  if (key === "executive_brief") {
    return [
      "Which moves matter most for the floor today?",
      "Where are the best batching opportunities?",
      "What should supply chain do first?"
    ];
  }
  if (key === "what_changed") {
    return [
      "Write a standup brief from the changes.",
      "What should we run next and why?",
      "Which risks can derail the plan today?"
    ];
  }
  if (key === "data_health") {
    return [
      "Which metrics are safe to trust right now?",
      "Write a standup brief from the freshest data only.",
      "What data should we refresh first?"
    ];
  }
  if (activeView === "operations") {
    return [
      "Summarize today vs yesterday output.",
      "How much revenue did we produce today?",
      "What is labor cost per case this week?"
    ];
  }
  if (activeView === "supplyrisk") {
    return [
      "Which shortages are most urgent today?",
      "What is missing vs unscheduled?",
      "What should supply chain do first?"
    ];
  }
  if (activeView === "workorders") {
    return [
      "What should we run next and why?",
      "Where are the best batching opportunities?",
      "Summarize top blockers in one paragraph."
    ];
  }
  return [
    "Summarize this dashboard in 5 bullets.",
    "What are top 3 actions for today?",
    "What changed since last review?"
  ];
}

function buildResponseMeta(options) {
  return {
    mode: toText(options && options.mode),
    modeLabel: buildModeLabel(options && options.mode),
    sourceLabel: toText(options && options.sourceLabel),
    dataTimestamp: toText(options && options.dataTimestamp),
    grounded: options && options.grounded !== false,
    deterministic: !!(options && options.deterministic),
  };
}

function sendAnswer(res, answer, options) {
  return res.status(200).json({
    answer: toText(answer) || "No AI response was returned.",
    model: toText(options && options.model) || "deterministic",
    meta: buildResponseMeta(options),
    followUps: Array.isArray(options && options.followUps) ? options.followUps.slice(0, 4) : [],
  });
}

function findRecommendationForOwner(metrics, ownerToken) {
  var token = toText(ownerToken).toLowerCase();
  return takeTop(metrics && metrics.topRecommendations, 8).find(function(row) {
    return toText(row && row.owner).toLowerCase().indexOf(token) !== -1;
  }) || null;
}

function buildRunNextAnswer(metrics, dataTimestamp) {
  var topRunNext = takeTop(metrics && metrics.topRunNext, 5);
  if (!topRunNext.length) {
    return "No ranked run-next candidates are available in the current dispatch queue.";
  }
  var lines = topRunNext.map(function(row, idx) {
    var due = toText(row && row.dueDate);
    var why = toText(row && row.why);
    return (idx + 1) + ". WO " + toText(row && row.woNum) +
      " - " + (toText(row && row.action) || "Run Next") +
      " | " + formatWholeNumber(row && row.impactUnits) + " units" +
      " | score " + formatWholeNumber(row && row.priorityScore) +
      (due ? " | due " + due : "") +
      (why ? " | " + why : "");
  });
  return (
    "Top run-next queue from the current dispatch ranking:\n" +
    lines.join("\n") +
    sourceNote("dispatch queue + work orders", dataTimestamp)
  );
}

function buildRiskRadarAnswer(metrics, dataTimestamp) {
  var watchlist = takeTop(metrics && metrics.topSupplyRisks, 4);
  var atRiskUnits = formatWholeNumber(metrics && metrics.atRiskUnits);
  var riskItems = formatWholeNumber(metrics && metrics.supplyRiskItems);
  var highRisk = formatWholeNumber(metrics && metrics.highRiskCount);
  var riskLines = watchlist.length
    ? watchlist.map(function(item, idx) {
      var exposure = Math.max(toNum(item && item.shortQty), toNum(item && item.unitsAtRisk));
      var due = toText(item && item.dueDate);
      return (idx + 1) + ". " + toText(item && item.sku) +
        " - " + formatWholeNumber(exposure) + " units at risk" +
        (due ? " | due " + due : "") +
        " | " + (toText(item && item.recommendation) || "Review coverage");
    }).join("\n")
    : "1. No active supply risks are surfaced in the current watchlist.";
  return [
    "**1) Exposure**",
    "- " + riskItems + " supply risk items are active, with " + highRisk + " high-risk and " + atRiskUnits + " units exposed.",
    "",
    "**2) Priority Watchlist**",
    riskLines,
    "",
    "**3) Actions**",
    "- Supply Chain: " + (toText(findRecommendationForOwner(metrics, "supply") && findRecommendationForOwner(metrics, "supply").action) || "Expedite the highest uncovered shortages first.") ,
    "- Planner: Resequence around the highest-risk shortages before they hit due-date windows.",
    "- Ops Analyst: Refresh inbound and dock feeds if the watchlist feels stale.",
    "",
    "**4) Confidence / Source**",
    "- Grounded in current PackPulse risk watchlists and recommendation signals." + sourceNote("critical items + inbound coverage", dataTimestamp)
  ].join("\n");
}

function buildBatchPlanAnswer(metrics, dataTimestamp) {
  var groups = takeTop(metrics && metrics.topBatchGroups, 5);
  if (!groups.length) {
    return "No same-item batching opportunities are open right now." + sourceNote("current work orders", dataTimestamp);
  }
  var lines = groups.map(function(group, idx) {
    var dueWindow = toText(group && group.dueStart) && toText(group && group.dueEnd)
      ? " | due " + toText(group && group.dueStart) + " to " + toText(group && group.dueEnd)
      : "";
    return (idx + 1) + ". " + toText(group && group.sku) +
      " - " + formatWholeNumber(group && group.count) + " WOs" +
      " | " + formatWholeNumber(group && group.remainingUnits) + " remaining cases" +
      dueWindow;
  });
  return [
    "**1) Best Changeover Wins**",
    lines.join("\n"),
    "",
    "**2) Sequencing Guidance**",
    "- Start with the largest repeated SKU families to capture the fastest changeover savings.",
    "- Pull the earliest-due work order to the front inside each family, then run same-SKU jobs back-to-back.",
    "- Check the top batch against the run-next queue before locking the sequence.",
    "",
    "**3) Confidence / Source**",
    "- Built from current open work orders and remaining-unit balances." + sourceNote("work orders", dataTimestamp)
  ].join("\n");
}

function buildThroughputWatchAnswer(metrics, dataTimestamp) {
  var todayCases = formatWholeNumber(metrics && metrics.productionTodayCases);
  var yesterdayCases = formatWholeNumber(metrics && metrics.productionYesterdayCases);
  var thisWeekCases = formatWholeNumber(metrics && metrics.thisWeekCases);
  var lastWeekCases = formatWholeNumber(metrics && metrics.lastWeekCases);
  var evoconUnplanned = formatWholeNumber(metrics && metrics.evoconUnplannedMin);
  var evoconSlow = formatWholeNumber(metrics && metrics.evoconSlowMin);
  return [
    "**1) Output Pace**",
    "- Today: " + todayCases + " cases versus " + yesterdayCases + " yesterday.",
    "- This week-to-date: " + thisWeekCases + " cases versus " + lastWeekCases + " last week (" + formatSignedPercent(metrics && metrics.weekDeltaPct) + ").",
    "",
    "**2) Loss Watch**",
    "- Unplanned stops today: " + evoconUnplanned + " min.",
    "- Slow production today: " + evoconSlow + " min.",
    "",
    "**3) Recovery Moves**",
    "- Floor Lead: attack the biggest stop-loss line first, then verify if speed loss is staffing, changeover, or mechanical.",
    "- Planner: protect the top run-next jobs from avoidable resequencing.",
    "- Analyst: validate the freshest production and Evocon sync before escalating trends.",
    "",
    "**4) Confidence / Source**",
    "- Grounded in current production and Evocon summaries." + sourceNote("production segments + Evocon", dataTimestamp)
  ].join("\n");
}

function buildWhatChangedAnswer(metrics, dataTimestamp) {
  var deltaCases = formatWholeNumber(metrics && metrics.weekDeltaCases);
  var topRun = takeTop(metrics && metrics.topRunNext, 1)[0] || null;
  var topRisk = takeTop(metrics && metrics.topSupplyRisks, 1)[0] || null;
  return [
    "**1) Output Delta**",
    "- This week-to-date is " + formatSignedPercent(metrics && metrics.weekDeltaPct) + " versus last week (" + deltaCases + " cases).",
    "- Today sits at " + formatWholeNumber(metrics && metrics.productionTodayCases) + " cases so far.",
    "",
    "**2) What Is Driving It**",
    "- Risk watch: " + formatWholeNumber(metrics && metrics.highRiskCount) + " high-risk items and " + formatWholeNumber(metrics && metrics.atRiskUnits) + " units exposed.",
    "- Throughput watch: " + formatWholeNumber(metrics && metrics.evoconUnplannedMin) + " unplanned-stop minutes and " + formatWholeNumber(metrics && metrics.evoconSlowMin) + " slow-production minutes today.",
    "",
    "**3) Immediate Focus**",
    "- Run-next lead: " + (topRun ? ("WO " + toText(topRun.woNum) + " - " + (toText(topRun.action) || "Run Next")) : "No lead candidate is ranked right now.") ,
    "- Biggest current risk: " + (topRisk ? (toText(topRisk.sku) + " - " + (toText(topRisk.recommendation) || "Review coverage")) : "No active shortage is highlighted right now.") ,
    "",
    "**4) Confidence / Source**",
    "- Built from current PackPulse work-order, risk, and operations signals." + sourceNote("PackPulse metrics", dataTimestamp)
  ].join("\n");
}

function buildStandupAnswer(metrics, dataTimestamp) {
  var topRun = takeTop(metrics && metrics.topRunNext, 1)[0] || null;
  var topRisk = takeTop(metrics && metrics.topSupplyRisks, 1)[0] || null;
  var plannerRec = findRecommendationForOwner(metrics, "planner");
  var supplyRec = findRecommendationForOwner(metrics, "supply");
  var analystRec = findRecommendationForOwner(metrics, "analyst");
  var staleFeeds = takeTop((metrics && metrics.dataHealth || []).filter(function(row) {
    return toText(row && row.status) && toText(row && row.status) !== "fresh";
  }), 3);
  return [
    "**1) Today Snapshot**",
    "- Output today: " + formatWholeNumber(metrics && metrics.productionTodayCases) + " cases (Shift 1 " + formatWholeNumber(metrics && metrics.productionTodayShift1Cases) + ", Shift 2 " + formatWholeNumber(metrics && metrics.productionTodayShift2Cases) + ").",
    "- Work orders: " + formatWholeNumber(metrics && metrics.workOrdersTotal) + " total, " + formatWholeNumber(metrics && metrics.workOrdersReady) + " ready, " + formatWholeNumber(metrics && metrics.workOrdersBlocked) + " blocked.",
    "- Week-to-date: " + formatWholeNumber(metrics && metrics.thisWeekCases) + " cases (" + formatSignedPercent(metrics && metrics.weekDeltaPct) + " vs last week).",
    "",
    "**2) Top Risks**",
    "- Supply exposure: " + formatWholeNumber(metrics && metrics.supplyRiskItems) + " active risk items, " + formatWholeNumber(metrics && metrics.highRiskCount) + " high-risk, " + formatWholeNumber(metrics && metrics.atRiskUnits) + " units at risk.",
    "- Highest current risk: " + (topRisk ? (toText(topRisk.sku) + " - " + formatWholeNumber(Math.max(toNum(topRisk.shortQty), toNum(topRisk.unitsAtRisk))) + " units - " + (toText(topRisk.recommendation) || "Review coverage")) : "No shortage leader is surfaced in the current watchlist.") ,
    "- Throughput watch: " + formatWholeNumber(metrics && metrics.evoconUnplannedMin) + " unplanned-stop minutes and " + formatWholeNumber(metrics && metrics.evoconSlowMin) + " slow-production minutes today.",
    "",
    "**3) Actions By Role**",
    "- Planner: " + (plannerRec ? (toText(plannerRec.action) + " - " + toText(plannerRec.why)) : (topRun ? ("Sequence WO " + toText(topRun.woNum) + " first and protect the rest of the ranked queue.") : "Review the top ranked run-next candidates.")) ,
    "- Supply Chain: " + (supplyRec ? (toText(supplyRec.action) + " - " + toText(supplyRec.why)) : (topRisk ? ((toText(topRisk.recommendation) || "Expedite") + " for " + toText(topRisk.sku) + ".") : "Confirm coverage on the top at-risk materials.")) ,
    "- Floor Lead: Attack the top loss line first, then keep the lead run-next family moving without avoidable changeovers.",
    "- Ops Analyst: " + (analystRec ? (toText(analystRec.action) + " - " + toText(analystRec.why)) : (staleFeeds.length ? ("Refresh " + staleFeeds.map(function(row) { return toText(row && row.label); }).join(", ") + ".") : "Data feeds look healthy enough to trust for the next standup.")) ,
    "",
    "**4) Confidence / Source**",
    "- Grounded in current PackPulse metrics, dispatch ranking, risk watchlists, and data-health signals." + sourceNote("PackPulse metrics", dataTimestamp)
  ].join("\n");
}

function buildExecutiveBriefAnswer(metrics, dataTimestamp) {
  var topRun = takeTop(metrics && metrics.topRunNext, 1)[0] || null;
  var topRisk = takeTop(metrics && metrics.topSupplyRisks, 1)[0] || null;
  return [
    "**1) Performance**",
    "- Today is at " + formatWholeNumber(metrics && metrics.productionTodayCases) + " cases; week-to-date is " + formatWholeNumber(metrics && metrics.thisWeekCases) + " (" + formatSignedPercent(metrics && metrics.weekDeltaPct) + " vs last week).",
    "",
    "**2) Operating Risk**",
    "- " + formatWholeNumber(metrics && metrics.highRiskCount) + " high-risk items are active with " + formatWholeNumber(metrics && metrics.atRiskUnits) + " units exposed.",
    "- Throughput loss today: " + formatWholeNumber(metrics && metrics.evoconUnplannedMin) + " unplanned-stop minutes, " + formatWholeNumber(metrics && metrics.evoconSlowMin) + " slow-production minutes.",
    "",
    "**3) Management Moves**",
    "- Run priority: " + (topRun ? ("WO " + toText(topRun.woNum) + " - " + (toText(topRun.action) || "Run Next")) : "Review the current dispatch queue.") ,
    "- Risk action: " + (topRisk ? ((toText(topRisk.recommendation) || "Escalate") + " for " + toText(topRisk.sku)) : "No single shortage dominates the watchlist.") ,
    "",
    "**4) Confidence / Source**",
    "- Built from current PackPulse production, work-order, and risk context." + sourceNote("PackPulse metrics", dataTimestamp)
  ].join("\n");
}

function buildDataHealthAnswer(metrics, dataTimestamp) {
  var feeds = takeTop(metrics && metrics.dataHealth, 8);
  if (!feeds.length) {
    return "Data-health status is unavailable from the current client context.";
  }
  var lines = feeds.map(function(feed, idx) {
    return (idx + 1) + ". " + toText(feed && feed.label) + " - " + toText(feed && feed.status) + (toText(feed && feed.timestamp) ? " (" + toText(feed && feed.timestamp) + ")" : "");
  });
  return [
    "**1) Feed Freshness**",
    lines.join("\n"),
    "",
    "**2) Trust Guidance**",
    "- Fresh feeds are safe for operational decisions right now.",
    "- Anything marked stale or old should be refreshed before using it for escalation or executive reporting.",
    "",
    "**3) Confidence / Source**",
    "- Built from PackPulse data-source freshness indicators." + sourceNote("client data health", dataTimestamp)
  ].join("\n");
}

function buildDeterministicCopilotAnswer(mode, metrics, dataTimestamp) {
  var key = toText(mode).toLowerCase();
  if (key === "run_next") return buildRunNextAnswer(metrics, dataTimestamp);
  if (key === "standup") return buildStandupAnswer(metrics, dataTimestamp);
  if (key === "risk_radar") return buildRiskRadarAnswer(metrics, dataTimestamp);
  if (key === "batch_plan") return buildBatchPlanAnswer(metrics, dataTimestamp);
  if (key === "throughput_watch") return buildThroughputWatchAnswer(metrics, dataTimestamp);
  if (key === "executive_brief") return buildExecutiveBriefAnswer(metrics, dataTimestamp);
  if (key === "what_changed") return buildWhatChangedAnswer(metrics, dataTimestamp);
  if (key === "data_health") return buildDataHealthAnswer(metrics, dataTimestamp);
  return "";
}

function buildCopilotModeInstruction(mode) {
  var key = toText(mode).toLowerCase();
  if (key === "standup") {
    return "Format the reply with bold headings exactly: **1) Today Snapshot**, **2) Top Risks**, **3) Actions By Role**, **4) Confidence / Source**. Keep it standup-ready and grounded in numbers.";
  }
  if (key === "run_next") {
    return "Format with bold headings exactly: **1) Run Next**, **2) Why These Jobs**, **3) Sequencing Guidance**, **4) Confidence / Source**. Lead with the concrete queue.";
  }
  if (key === "risk_radar") {
    return "Format with bold headings exactly: **1) Exposure**, **2) Priority Watchlist**, **3) Actions**, **4) Confidence / Source**. Focus on what can derail the plan today.";
  }
  if (key === "batch_plan") {
    return "Format with bold headings exactly: **1) Best Changeover Wins**, **2) Sequencing Guidance**, **3) Watchouts**, **4) Confidence / Source**. Recommend batching only when the data supports it.";
  }
  if (key === "throughput_watch") {
    return "Format with bold headings exactly: **1) Output Pace**, **2) Loss Watch**, **3) Recovery Moves**, **4) Confidence / Source**. Tie the plan to throughput loss and near-term actions.";
  }
  if (key === "executive_brief") {
    return "Format with bold headings exactly: **1) Performance**, **2) Operating Risk**, **3) Management Moves**, **4) Confidence / Source**. Keep it concise and leadership-ready.";
  }
  if (key === "what_changed") {
    return "Format with bold headings exactly: **1) Output Delta**, **2) What Is Driving It**, **3) Immediate Focus**, **4) Confidence / Source**. Emphasize change versus the prior comparison window.";
  }
  if (key === "data_health") {
    return "Format with bold headings exactly: **1) Feed Freshness**, **2) Trust Guidance**, **3) Confidence / Source**. State clearly what is safe versus unsafe to trust.";
  }
  return "Use bold section headings when helpful. Ground every claim in the provided PackPulse context, mention data gaps explicitly, and close with what to do next.";
}

function buildCopilotFactPack(metrics, activeView, contextLines, supabaseContext) {
  return {
    activeView: toText(activeView),
    todayEt: toText(metrics && metrics.todayEt),
    output: {
      todayCases: toNum(metrics && metrics.productionTodayCases),
      yesterdayCases: toNum(metrics && metrics.productionYesterdayCases),
      thisWeekCases: toNum(metrics && metrics.thisWeekCases),
      lastWeekCases: toNum(metrics && metrics.lastWeekCases),
      weekDeltaPct: toNum(metrics && metrics.weekDeltaPct),
      latestDate: toText(metrics && metrics.productionLatestDate),
    },
    workOrders: {
      total: toNum(metrics && metrics.workOrdersTotal),
      ready: toNum(metrics && metrics.workOrdersReady),
      blocked: toNum(metrics && metrics.workOrdersBlocked),
      topRunNext: takeTop(metrics && metrics.topRunNext, 4),
      topBatchGroups: takeTop(metrics && metrics.topBatchGroups, 4),
    },
    risk: {
      items: toNum(metrics && metrics.supplyRiskItems),
      highRisk: toNum(metrics && metrics.highRiskCount),
      atRiskUnits: toNum(metrics && metrics.atRiskUnits),
      topSupplyRisks: takeTop(metrics && metrics.topSupplyRisks, 4),
    },
    throughput: {
      evoconUnplannedMin: toNum(metrics && metrics.evoconUnplannedMin),
      evoconSlowMin: toNum(metrics && metrics.evoconSlowMin),
    },
    recommendations: takeTop(metrics && metrics.topRecommendations, 6),
    dataHealth: takeTop(metrics && metrics.dataHealth, 8),
    contextLines: Array.isArray(contextLines) ? contextLines.slice(0, 8) : [],
    snapshotSyncedAt: toText(supabaseContext && supabaseContext.snapshotSyncedAt),
    snapshotUpdatedBy: toText(supabaseContext && supabaseContext.snapshotUpdatedBy),
    pricingRows: toNum(supabaseContext && supabaseContext.revenue && supabaseContext.revenue.pricingRows),
  };
}

function firstField(row, keys) {
  if (!row || typeof row !== "object") return "";
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if (Object.prototype.hasOwnProperty.call(row, k) && row[k] != null && row[k] !== "") return row[k];
  }
  var wanted = keys.map(function(k) { return String(k).toLowerCase().replace(/[^a-z0-9]/g, ""); });
  var rowKeys = Object.keys(row);
  for (var j = 0; j < rowKeys.length; j++) {
    var rk = rowKeys[j];
    var norm = String(rk).toLowerCase().replace(/[^a-z0-9]/g, "");
    if (wanted.indexOf(norm) !== -1) {
      var v = row[rk];
      if (v != null && v !== "") return v;
    }
  }
  return "";
}

function componentsForSkuFromPayload(payload, skuRaw) {
  var boms = payload && Array.isArray(payload.boms) ? payload.boms : [];
  if (!boms.length) return { hasBomData: false, items: [] };
  var sku = normalizeSku(skuRaw);
  var out = [];
  var seen = {};
  boms.forEach(function(row) {
    var fg = normalizeSku(firstField(row, ["Finished Good Code", "finished_good_code", "bomId", "Finished Good", "fg_code"]));
    if (!fg || fg !== sku) return;
    var comp = String(firstField(row, ["Subcomponent Code", "subcomponent_code", "componentSku", "Component", "component_code"]) || "").trim();
    if (!comp) return;
    var key = normalizeSku(comp);
    if (!key || seen[key]) return;
    seen[key] = true;
    out.push({
      component: comp,
      description: String(firstField(row, ["Subcomponent Description", "subcomponent_description", "description", "Description"]) || "").trim(),
      qtyPer: firstField(row, ["Qty Per", "subcomponent_unit_quantity", "qtyPer", "quantity_per"]),
    });
  });
  return { hasBomData: true, items: out };
}

function buildBatchOpportunitiesFromSnapshot(payload) {
  var workOrders = payload && Array.isArray(payload.workOrders) ? payload.workOrders : [];
  var groups = {};
  workOrders.forEach(function(row) {
    var skuRaw = toText(firstField(row, [
      "Item Code", "item_code", "Product SKU", "productSku", "productSkuRaw", "SKU", "sku"
    ]));
    var skuKey = normalizeSku(skuRaw);
    if (!skuKey) return;
    var status = toText(firstField(row, [
      "Work Order Status", "status", "project_status"
    ]));
    if (statusLooksClosed(status)) return;
    var remaining = toNum(firstField(row, [
      "Units Remaining", "units_remaining", "Remaining Units", "remaining_units"
    ]));
    if (!(remaining > 0)) {
      var expected = toNum(firstField(row, [
        "Units Expected", "units_expected", "Order Qty", "qtyToProduce", "Quantity", "quantity"
      ]));
      var produced = toNum(firstField(row, [
        "Units Produced", "units_produced", "Produced", "unitsProduced"
      ]));
      remaining = Math.max(0, expected - produced);
    }
    if (!(remaining > 0)) return;
    var woNum = toText(firstField(row, [
      "Work Order Code", "project_code", "Project Code", "Work Order", "wo_num"
    ]));
    var dueDate = parseDateIso(firstField(row, ["Due Date", "due_date_at", "dueDate"]));
    if (!groups[skuKey]) {
      groups[skuKey] = {
        sku: skuRaw || "--",
        batchCount: 0,
        totalRemainingUnits: 0,
        woNums: [],
        dueStart: "",
        dueEnd: ""
      };
    }
    groups[skuKey].batchCount += 1;
    groups[skuKey].totalRemainingUnits += remaining;
    if (woNum) groups[skuKey].woNums.push(woNum);
    if (dueDate && (!groups[skuKey].dueStart || dueDate < groups[skuKey].dueStart)) groups[skuKey].dueStart = dueDate;
    if (dueDate && (!groups[skuKey].dueEnd || dueDate > groups[skuKey].dueEnd)) groups[skuKey].dueEnd = dueDate;
  });
  return Object.keys(groups)
    .map(function(key) { return groups[key]; })
    .filter(function(group) { return group.batchCount > 1; })
    .sort(function(a, b) {
      if (b.batchCount !== a.batchCount) return b.batchCount - a.batchCount;
      return b.totalRemainingUnits - a.totalRemainingUnits;
    });
}

function errorMessage(error) {
  return String((error && (error.message || error.details || error.hint)) || "").toLowerCase();
}

function isMissingSupabaseRelationError(name, error) {
  var msg = errorMessage(error);
  return msg.indexOf(String(name || "").toLowerCase()) !== -1 && (
    msg.indexOf("schema cache") !== -1 ||
    msg.indexOf("could not find the table") !== -1 ||
    msg.indexOf("relation") !== -1 ||
    msg.indexOf("does not exist") !== -1
  );
}

async function fetchAllRowsByDateWindow(supabase, options) {
  var table = toText(options && options.table);
  var columns = toText(options && options.columns) || "*";
  var dateColumn = toText(options && options.dateColumn);
  var siteId = toText(options && options.siteId) || CACHE_SITE_ID;
  var startDate = toText(options && options.startDate);
  var endDate = toText(options && options.endDate);
  var pageSize = Math.max(1, Number(options && options.pageSize) || 1000);
  var maxRows = Math.max(pageSize, Number(options && options.maxRows) || 50000);
  var out = [];
  var from = 0;

  while (true) {
    var to = from + pageSize - 1;
    var q = supabase
      .from(table)
      .select(columns)
      .eq("site_id", siteId)
      .order(dateColumn, { ascending: false })
      .range(from, to);
    if (startDate) q = q.gte(dateColumn, startDate);
    if (endDate) q = q.lte(dateColumn, endDate);
    var resp = await q;
    if (resp.error) return { error: resp.error, data: out };
    var rows = Array.isArray(resp.data) ? resp.data : [];
    out = out.concat(rows);
    if (rows.length < pageSize || out.length >= maxRows) break;
    from += pageSize;
    if (from > maxRows) break;
  }

  return { error: null, data: out.slice(0, maxRows) };
}

function snapshotDatasetState(snapshotPayload, snapshotRowCounts, key) {
  var rows = snapshotPayload && Array.isArray(snapshotPayload[key]) ? snapshotPayload[key] : [];
  var payloadMeta = snapshotPayload && snapshotPayload.meta && typeof snapshotPayload.meta === "object"
    ? snapshotPayload.meta
    : {};
  var dropped = Array.isArray(payloadMeta.cacheDroppedDatasets) && payloadMeta.cacheDroppedDatasets.indexOf(key) !== -1;
  var totalRows = Math.max(0, Number(snapshotRowCounts && snapshotRowCounts[key]) || 0);
  var truncated = !dropped && totalRows > 0 && rows.length > 0 && rows.length < totalRows;
  return {
    rows: rows,
    totalRows: totalRows,
    dropped: dropped,
    truncated: truncated,
    complete: !dropped && (!totalRows || rows.length >= totalRows)
  };
}

function buildProductionDetailRowsFromSnapshot(snapshotPayload, startDate, endDate, fallbackValue) {
  var rows = snapshotPayload && Array.isArray(snapshotPayload.productionData) ? snapshotPayload.productionData : [];
  var out = [];

  rows.forEach(function(row) {
    var units = toNum(firstField(row, [
      "Units Produced", "units_produced", "unitsProduced", "Produced Units", "Quantity Produced", "Qty Produced"
    ]));
    if (!(units > 0)) return;

    var producedRaw = pickFieldLoose(row, [
      "Produced date", "producedAt",
      "Produced At", "produced_at",
      "Actual Job End", "actual_job_end_at"
    ]);
    var producedIso = toIso(producedRaw);
    var eastern = toEasternParts(producedIso || producedRaw || fallbackValue);
    var dateKey = eastern && eastern.dateKey ? eastern.dateKey : parseDateIso(producedRaw || fallbackValue);
    if (!dateKey || (startDate && dateKey < startDate) || (endDate && dateKey > endDate)) return;

    out.push({
      produced_date_et: dateKey,
      shift_label: eastern ? classifyShiftET(eastern) : (toText(firstField(row, ["Shift", "shift_label", "shift"])) || "Unassigned"),
      line: toText(firstField(row, ["Line", "line", "line_name", "Line Name"])) || "Unknown",
      job_id: toText(firstField(row, ["Job ID", "job_id", "Job"])) || null,
      work_order_code: toText(firstField(row, ["Work Order Code", "project_code", "Project Code"])) || null,
      item_code: toText(firstField(row, ["Item Code", "item_code", "SKU", "sku", "Product SKU"])) || null,
      units_produced: units,
    });
  });

  return out;
}

function buildProductionSummary(metricRows, detailRows, resolveRevenuePerCase, detailSource) {
  var rows = Array.isArray(metricRows) ? metricRows : [];
  var detail = Array.isArray(detailRows) ? detailRows : [];
  var byDay = {};
  var lineTotals = {};
  var totalRows = 0;

  rows.forEach(function(row) {
    var date = toText(row && row.date_et);
    var units = toNum(row && row.produced_units);
    var rowCount = toNum(row && row.production_rows);
    if (!date || (!(units > 0) && !(rowCount > 0))) return;
    totalRows += rowCount;
    if (!byDay[date]) byDay[date] = { date: date, units: 0, rows: 0 };
    byDay[date].units += units;
    byDay[date].rows += rowCount;
    var line = toText(row && row.line_name) || "Unknown";
    if (!lineTotals[line]) lineTotals[line] = { line: line, units: 0, rows: 0 };
    lineTotals[line].units += units;
    lineTotals[line].rows += rowCount;
  });

  var dayPairs = Object.keys(byDay).sort().map(function(date) {
    return byDay[date];
  });
  var latestProdDate = dayPairs.length ? dayPairs[dayPairs.length - 1].date : "";
  var latestProdUnits = latestProdDate ? toNum(byDay[latestProdDate] && byDay[latestProdDate].units) : 0;
  var last7 = dayPairs.slice(-7);
  var lineTop = Object.keys(lineTotals)
    .map(function(line) { return lineTotals[line]; })
    .sort(function(a, b) { return b.units - a.units; })
    .slice(0, 5);
  var skuTotals = {};
  detail.forEach(function(row) {
    var sku = toText(row && row.item_code) || "Unknown";
    var units = toNum(row && row.units_produced);
    if (!(units > 0)) return;
    skuTotals[sku] = (skuTotals[sku] || 0) + units;
  });
  var skuTop = Object.keys(skuTotals)
    .map(function(sku) { return { sku: sku, units: skuTotals[sku] }; })
    .sort(function(a, b) { return b.units - a.units; })
    .slice(0, 8);

  function rangeTotals(start, end) {
    if (!start || !end) {
      return {
        totalCases: 0,
        totalRevenue: 0,
        revenueCoveredUnits: 0,
        byLineTop: [],
        bySkuTop: [],
        byShift: [],
        missingRevenueSkus: [],
        productionDays: 0,
        rows: 0,
        hasSkuDetail: false
      };
    }

    var rangeRows = rows.filter(function(row) {
      var date = toText(row && row.date_et);
      return date && date >= start && date <= end;
    });
    var totalCases = 0;
    var lineMap = {};
    var shiftMap = {};
    var dayMap = {};
    var totalRowCount = 0;

    rangeRows.forEach(function(row) {
      var units = toNum(row && row.produced_units);
      var rowCount = toNum(row && row.production_rows);
      var date = toText(row && row.date_et);
      var line = toText(row && row.line_name) || "Unknown";
      var shift = toText(row && row.shift_label) || "Unassigned";
      totalCases += units;
      totalRowCount += rowCount;
      if (!lineMap[line]) lineMap[line] = { line: line, units: 0, rows: 0 };
      lineMap[line].units += units;
      lineMap[line].rows += rowCount;
      shiftMap[shift] = (shiftMap[shift] || 0) + units;
      if (date) dayMap[date] = true;
    });

    var detailRangeRows = detail.filter(function(row) {
      var date = toText(row && row.produced_date_et);
      return date && date >= start && date <= end;
    });
    var totalRevenue = 0;
    var revenueCoveredUnits = 0;
    var skuMap = {};
    var missingRevenueSkus = {};

    detailRangeRows.forEach(function(row) {
      var units = toNum(row && row.units_produced);
      if (!(units > 0)) return;
      var date = toText(row && row.produced_date_et);
      var sku = toText(row && row.item_code) || "Unknown";
      var revenue = resolveRevenuePerCase(sku, date);
      var revenueValue = toNum(revenue && revenue.value) * units;
      if (!skuMap[sku]) skuMap[sku] = { sku: sku, units: 0, revenue: 0 };
      skuMap[sku].units += units;
      skuMap[sku].revenue += revenueValue;
      if (revenueValue > 0) {
        totalRevenue += revenueValue;
        revenueCoveredUnits += units;
      } else {
        missingRevenueSkus[sku] = (missingRevenueSkus[sku] || 0) + units;
      }
    });

    return {
      totalCases: totalCases,
      totalRevenue: totalRevenue,
      revenueCoveredUnits: revenueCoveredUnits,
      byLineTop: Object.keys(lineMap).map(function(key) { return lineMap[key]; }).sort(function(a, b) { return b.units - a.units; }).slice(0, 5),
      bySkuTop: Object.keys(skuMap).map(function(key) { return skuMap[key]; }).sort(function(a, b) { return b.units - a.units; }).slice(0, 8),
      byShift: Object.keys(shiftMap).map(function(key) { return { shift: key, units: shiftMap[key] }; }).sort(function(a, b) { return b.units - a.units; }),
      missingRevenueSkus: Object.keys(missingRevenueSkus).map(function(key) {
        return { sku: key, units: missingRevenueSkus[key] };
      }).sort(function(a, b) { return b.units - a.units; }).slice(0, 10),
      productionDays: Object.keys(dayMap).length,
      rows: totalRowCount,
      hasSkuDetail: detailRangeRows.length > 0
    };
  }

  return {
    totalRows: totalRows,
    latestDate: latestProdDate,
    latestDateUnits: latestProdUnits,
    byDayLast7: last7,
    topLines: lineTop,
    topSkus: skuTop,
    summarySource: "ops_daily_line_metrics_mv",
    detailSource: detailSource || "",
    range: rangeTotals,
  };
}

function buildLaborSummary(metricRows) {
  var rows = Array.isArray(metricRows) ? metricRows : [];
  var laborByDate = {};
  var totalRows = 0;
  var latestLaborDate = "";

  rows.forEach(function(row) {
    var date = toText(row && row.date_et);
    var laborRows = toNum(row && row.labor_rows);
    if (!date || !(laborRows > 0)) return;
    totalRows += laborRows;
    laborByDate[date] = (laborByDate[date] || 0) + laborRows;
    if (!latestLaborDate || date > latestLaborDate) latestLaborDate = date;
  });

  function laborRange(start, end) {
    if (!start || !end) return { payableHours: 0, productiveHours: 0, laborCost: 0, rows: 0, byLineTop: [] };
    var payableHours = 0;
    var productiveHours = 0;
    var laborCost = 0;
    var rowCount = 0;
    var byLine = {};

    rows.forEach(function(row) {
      var date = toText(row && row.date_et);
      if (!date || date < start || date > end) return;
      var payable = toNum(row && row.payable_hours);
      var productive = toNum(row && row.productive_hours);
      var cost = toNum(row && row.labor_cost);
      var laborRows = toNum(row && row.labor_rows);
      var line = toText(row && row.line_name) || "Unknown";
      payableHours += payable;
      productiveHours += productive;
      laborCost += cost;
      rowCount += laborRows;
      if (!byLine[line]) byLine[line] = { line: line, payableHours: 0, productiveHours: 0, laborCost: 0 };
      byLine[line].payableHours += payable;
      byLine[line].productiveHours += productive;
      byLine[line].laborCost += cost;
    });

    return {
      payableHours: payableHours,
      productiveHours: productiveHours,
      laborCost: laborCost,
      rows: rowCount,
      byLineTop: Object.keys(byLine).map(function(key) { return byLine[key]; }).sort(function(a, b) { return b.laborCost - a.laborCost; }).slice(0, 5)
    };
  }

  return {
    totalRows: totalRows,
    latestDate: latestLaborDate,
    entriesOnLatestDate: latestLaborDate ? (laborByDate[latestLaborDate] || 0) : 0,
    summarySource: "ops_daily_line_metrics_mv",
    range: laborRange,
  };
}

async function loadSupabaseAiContext(options) {
  var summaryStart = toText(options && options.summaryStart);
  var summaryEnd = toText(options && options.summaryEnd);
  var includeProductionDetail = !!(options && options.includeProductionDetail);
  var detailStart = toText(options && options.detailStart);
  var detailEnd = toText(options && options.detailEnd);
  var supabase = getSupabaseAdmin();

  var detailPromise = (includeProductionDetail && detailStart && detailEnd)
    ? fetchAllRowsByDateWindow(supabase, {
      table: "production_events",
      columns: "produced_date_et,shift_label,line,job_id,work_order_code,item_code,units_produced",
      dateColumn: "produced_date_et",
      startDate: detailStart,
      endDate: detailEnd,
      maxRows: 25000
    })
    : Promise.resolve({ error: null, data: [] });

  var responses = await Promise.all([
    supabase
      .from("cache_snapshots")
      .select("synced_at,updated_by,row_counts,payload")
      .eq("site_id", CACHE_SITE_ID)
      .maybeSingle(),
    fetchAllRowsByDateWindow(supabase, {
      table: "ops_daily_line_metrics_mv",
      columns: "date_et,shift_label,line_name,production_rows,produced_units,labor_rows,payable_hours,productive_hours,labor_cost",
      dateColumn: "date_et",
      startDate: summaryStart,
      endDate: summaryEnd,
      maxRows: 50000
    }),
    supabase
      .from("ops_sku_targets")
      .select("item_code,revenue_per_case,active_from,active_to,updated_at")
      .eq("site_id", CACHE_SITE_ID)
      .order("updated_at", { ascending: false })
      .limit(5000),
    detailPromise
  ]);

  var snapshotQ = responses[0];
  var metricQ = responses[1];
  var pricingQ = responses[2];
  var detailQ = responses[3];

  if (snapshotQ.error && !isMissingSupabaseRelationError("cache_snapshots", snapshotQ.error)) throw snapshotQ.error;
  if (metricQ.error && !isMissingSupabaseRelationError("ops_daily_line_metrics_mv", metricQ.error)) throw metricQ.error;
  if (pricingQ.error && !isMissingSupabaseRelationError("ops_sku_targets", pricingQ.error)) throw pricingQ.error;
  if (detailQ.error && !isMissingSupabaseRelationError("production_events", detailQ.error)) throw detailQ.error;

  var snapshot = !snapshotQ.error && snapshotQ.data ? snapshotQ.data : null;
  var snapshotPayload = snapshot && snapshot.payload ? snapshot.payload : null;
  var snapshotRowCounts = snapshot && snapshot.row_counts ? snapshot.row_counts : {};
  var metricRows = !metricQ.error && Array.isArray(metricQ.data) ? metricQ.data : [];
  var pricingRows = !pricingQ.error && Array.isArray(pricingQ.data) ? pricingQ.data : [];

  var itemMasterRows = snapshotPayload && Array.isArray(snapshotPayload.itemMaster) ? snapshotPayload.itemMaster : [];
  var itemMasterBySku = {};
  itemMasterRows.forEach(function(row) {
    var sku = normalizeSku(firstField(row, ["Item Code", "item_code", "SKU", "sku", "Product SKU"]));
    if (!sku) return;
    var value = pickItemMasterValue(row);
    if (!(value > 0)) return;
    if (!itemMasterBySku[sku] || value > itemMasterBySku[sku]) itemMasterBySku[sku] = value;
  });

  var pricingBySku = {};
  pricingRows.forEach(function(row) {
    var sku = normalizeSku(row && row.item_code);
    if (!sku || !(toNum(row && row.revenue_per_case) > 0)) return;
    if (!pricingBySku[sku]) pricingBySku[sku] = [];
    pricingBySku[sku].push({
      revenue_per_case: toNum(row && row.revenue_per_case),
      active_from: parseDateIso(row && row.active_from) || "1900-01-01",
      active_to: parseDateIso(row && row.active_to) || "9999-12-31"
    });
  });

  function resolveRevenuePerCase(itemCode, dateIso) {
    var sku = normalizeSku(itemCode);
    if (!sku) return { value: 0, source: "missing" };
    var dateKey = toText(dateIso) || "1900-01-01";
    var rows = pricingBySku[sku] || [];
    var best = 0;
    rows.forEach(function(row) {
      var from = toText(row.active_from) || "1900-01-01";
      var to = toText(row.active_to) || "9999-12-31";
      if (dateKey < from || dateKey > to) return;
      if (toNum(row.revenue_per_case) > best) best = toNum(row.revenue_per_case);
    });
    if (best > 0) return { value: best, source: "ops_sku_targets" };
    if (toNum(itemMasterBySku[sku]) > 0) return { value: toNum(itemMasterBySku[sku]), source: "item_master_cost_per_unit" };
    return { value: 0, source: "missing" };
  }

  var productionDetailRows = [];
  var productionDetailSource = "";
  if (includeProductionDetail && detailStart && detailEnd) {
    var productionDataState = snapshotDatasetState(snapshotPayload, snapshotRowCounts, "productionData");
    if (productionDataState.complete && productionDataState.rows.length) {
      productionDetailRows = buildProductionDetailRowsFromSnapshot(snapshotPayload, detailStart, detailEnd, snapshot && snapshot.synced_at);
      productionDetailSource = "cache snapshot productionData";
    } else if (!detailQ.error && Array.isArray(detailQ.data) && detailQ.data.length) {
      productionDetailRows = detailQ.data;
      productionDetailSource = "production_events";
    }
  }

  var production = buildProductionSummary(metricRows, productionDetailRows, resolveRevenuePerCase, productionDetailSource);
  var labor = buildLaborSummary(metricRows);

  return {
    siteId: CACHE_SITE_ID,
    snapshotSyncedAt: snapshot && snapshot.synced_at ? snapshot.synced_at : null,
    snapshotUpdatedBy: snapshot && snapshot.updated_by ? snapshot.updated_by : "",
    snapshotRowCounts: snapshotRowCounts,
    snapshotMetrics: snapshotPayload && snapshotPayload.meta && typeof snapshotPayload.meta === "object" ? snapshotPayload.meta : {},
    snapshotPayload: snapshotPayload,
    production: production,
    labor: labor,
    revenue: {
      pricingRows: pricingRows.length,
      itemMasterFallbackSkus: Object.keys(itemMasterBySku).length,
    },
    workOrders: {
      batchOpportunities: buildBatchOpportunitiesFromSnapshot(snapshotPayload),
    },
  };
}

export default async function handler(req, res) {
  withCors(req, res, ["POST", "OPTIONS"]);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    var user = getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    var body = req.body || {};
    var prompt = toText(body.prompt);
    var activeView = toText(body.activeView || "overview");
    var contextLines = Array.isArray(body.contextLines) ? body.contextLines.map(toText).filter(Boolean).slice(0, 8) : [];
    var metrics = body.metrics && typeof body.metrics === "object" ? body.metrics : {};
    var history = Array.isArray(body.history) ? body.history.slice(-8) : [];
    var explicitCopilotMode = toText(body.copilotMode).toLowerCase();
    var copilotMode = inferCopilotMode(prompt, explicitCopilotMode);
    if (!prompt) return res.status(400).json({ error: "Prompt is required" });
    var anchorDateEt = toText(metrics.todayEt) || ymdInEtFromDate(new Date());
    var defaultOpsPeriod = resolvePeriodRange(detectPeriodLabel(prompt) || "today", anchorDateEt);
    var supabaseContext = null;
    try {
      supabaseContext = await loadSupabaseAiContext({
        summaryStart: shiftIsoDate(anchorDateEt, -120),
        summaryEnd: anchorDateEt,
        includeProductionDetail: needsProductionDetailPrompt(prompt),
        detailStart: defaultOpsPeriod.start,
        detailEnd: defaultOpsPeriod.end,
      });
    } catch (_) {
      supabaseContext = null;
    }
    var responseDataTimestamp =
      toText(supabaseContext && supabaseContext.snapshotSyncedAt) ||
      toText(metrics.productionLatestDate) ||
      toText(metrics.todayEt);
    var deterministicCopilotAnswer = buildDeterministicCopilotAnswer(copilotMode, metrics, responseDataTimestamp);
    var lookupSku = extractComponentLookupSku(prompt);
    if (lookupSku) {
      var result = componentsForSkuFromPayload(supabaseContext && supabaseContext.snapshotPayload, lookupSku);
      if (!result.hasBomData) {
        return sendAnswer(res, "BOM data is not available in shared snapshot yet. Run Nulogy sync with BOM included, then ask again.", {
          model: "deterministic",
          mode: copilotMode || "chat",
          sourceLabel: "shared snapshot BOM",
          dataTimestamp: responseDataTimestamp,
          deterministic: true,
          followUps: followUpsForMode(copilotMode, activeView),
        });
      }
      if (!result.items.length) {
        return sendAnswer(res, "No BOM components found for " + lookupSku + " in current snapshot.", {
          model: "deterministic",
          mode: copilotMode || "chat",
          sourceLabel: "shared snapshot BOM",
          dataTimestamp: responseDataTimestamp,
          deterministic: true,
          followUps: followUpsForMode(copilotMode, activeView),
        });
      }
      var lines = result.items.slice(0, 25).map(function(item, idx) {
        var desc = item.description ? " - " + item.description : "";
        var qty = item.qtyPer != null && item.qtyPer !== "" ? " (qty/unit: " + item.qtyPer + ")" : "";
        return (idx + 1) + ". " + item.component + desc + qty;
      });
      return sendAnswer(res, "Components for " + lookupSku + ":\n" + lines.join("\n"), {
        model: "deterministic",
        mode: copilotMode || "chat",
        sourceLabel: "shared snapshot BOM",
        dataTimestamp: responseDataTimestamp,
        deterministic: true,
        followUps: followUpsForMode(copilotMode, activeView),
      });
    }

    var defaultProdAgg = (supabaseContext && supabaseContext.production && typeof supabaseContext.production.range === "function")
      ? supabaseContext.production.range(defaultOpsPeriod.start, defaultOpsPeriod.end)
      : null;
    var defaultLaborAgg = (supabaseContext && supabaseContext.labor && typeof supabaseContext.labor.range === "function")
      ? supabaseContext.labor.range(defaultOpsPeriod.start, defaultOpsPeriod.end)
      : null;

    if (!explicitCopilotMode && isStandupQuestion(prompt) && deterministicCopilotAnswer) {
      return sendAnswer(res, deterministicCopilotAnswer, {
        model: "deterministic",
        mode: copilotMode || "standup",
        sourceLabel: "PackPulse metrics",
        dataTimestamp: responseDataTimestamp,
        deterministic: true,
        followUps: followUpsForMode(copilotMode || "standup", activeView),
      });
    }
    if (!explicitCopilotMode && isRunNextQuestion(prompt) && deterministicCopilotAnswer) {
      return sendAnswer(res, deterministicCopilotAnswer, {
        model: "deterministic",
        mode: copilotMode || "run_next",
        sourceLabel: "dispatch queue + work orders",
        dataTimestamp: responseDataTimestamp,
        deterministic: true,
        followUps: followUpsForMode(copilotMode || "run_next", activeView),
      });
    }
    if (!explicitCopilotMode && isRiskRadarQuestion(prompt) && deterministicCopilotAnswer) {
      return sendAnswer(res, deterministicCopilotAnswer, {
        model: "deterministic",
        mode: copilotMode || "risk_radar",
        sourceLabel: "critical items + inbound coverage",
        dataTimestamp: responseDataTimestamp,
        deterministic: true,
        followUps: followUpsForMode(copilotMode || "risk_radar", activeView),
      });
    }
    if (!explicitCopilotMode && isWhatChangedQuestion(prompt) && deterministicCopilotAnswer) {
      return sendAnswer(res, deterministicCopilotAnswer, {
        model: "deterministic",
        mode: copilotMode || "what_changed",
        sourceLabel: "PackPulse metrics",
        dataTimestamp: responseDataTimestamp,
        deterministic: true,
        followUps: followUpsForMode(copilotMode || "what_changed", activeView),
      });
    }
    if (!explicitCopilotMode && isDataHealthQuestion(prompt) && deterministicCopilotAnswer) {
      return sendAnswer(res, deterministicCopilotAnswer, {
        model: "deterministic",
        mode: copilotMode || "data_health",
        sourceLabel: "client data health",
        dataTimestamp: responseDataTimestamp,
        deterministic: true,
        followUps: followUpsForMode(copilotMode || "data_health", activeView),
      });
    }
    if (!explicitCopilotMode && isThroughputWatchQuestion(prompt) && deterministicCopilotAnswer) {
      return sendAnswer(res, deterministicCopilotAnswer, {
        model: "deterministic",
        mode: copilotMode || "throughput_watch",
        sourceLabel: "production + Evocon",
        dataTimestamp: responseDataTimestamp,
        deterministic: true,
        followUps: followUpsForMode(copilotMode || "throughput_watch", activeView),
      });
    }
    if (!explicitCopilotMode && isExecutiveBriefQuestion(prompt) && deterministicCopilotAnswer) {
      return sendAnswer(res, deterministicCopilotAnswer, {
        model: "deterministic",
        mode: copilotMode || "executive_brief",
        sourceLabel: "PackPulse metrics",
        dataTimestamp: responseDataTimestamp,
        deterministic: true,
        followUps: followUpsForMode(copilotMode || "executive_brief", activeView),
      });
    }

    // Deterministic answer for high-frequency operational ask.
    if (isTodayCasesQuestion(prompt)) {
      var todayCases = toNum(metrics.productionTodayCases);
      var s1 = toNum(metrics.productionTodayShift1Cases);
      var s2 = toNum(metrics.productionTodayShift2Cases);
      var todayEt = toText(metrics.todayEt);
      return res.status(200).json({
        answer:
          "Cases produced today (" + (todayEt || "ET") + "): " + todayCases.toLocaleString() +
          ". Shift 1: " + s1.toLocaleString() +
          ", Shift 2: " + s2.toLocaleString() + "." +
          (supabaseContext && supabaseContext.production && supabaseContext.production.latestDate
            ? " Latest production date: " + supabaseContext.production.latestDate + " (" + toNum(supabaseContext.production.latestDateUnits).toLocaleString() + " cases)." +
              sourceNote(supabaseContext.production.summarySource || "ops_daily_line_metrics_mv", supabaseContext.production.latestDate)
            : ""),
        model: "deterministic",
      });
    }
    if (isYesterdayCasesQuestion(prompt)) {
      var todayEt = toText(metrics.todayEt) || ymdInEtFromDate(new Date());
      var yesterdayEt = toText(metrics.yesterdayEt) || shiftIsoDate(todayEt, -1);
      var yCases = toNum(metrics.productionYesterdayCases);
      var yS1 = toNum(metrics.productionYesterdayShift1Cases);
      var yS2 = toNum(metrics.productionYesterdayShift2Cases);

      if (!(yCases > 0) && supabaseContext && supabaseContext.production && Array.isArray(supabaseContext.production.byDayLast7)) {
        var dayRow = supabaseContext.production.byDayLast7.find(function(d) { return toText(d && d.date) === yesterdayEt; });
        if (dayRow) yCases = toNum(dayRow.units);
      }

      if (!(yCases > 0) && supabaseContext && supabaseContext.production && Array.isArray(supabaseContext.production.byDayLast7) && supabaseContext.production.byDayLast7.length) {
        var fallback = supabaseContext.production.byDayLast7[supabaseContext.production.byDayLast7.length - 1];
        var fallbackDate = toText(fallback && fallback.date) || "--";
        var fallbackUnits = toNum(fallback && fallback.units);
        return res.status(200).json({
          answer:
            "No production rows are mapped for yesterday (" + (yesterdayEt || "--") + "). " +
            "Latest available production day is " + fallbackDate + " with " + fallbackUnits.toLocaleString() + " cases.",
          model: "deterministic",
        });
      }

      if (!(yCases > 0)) {
        return res.status(200).json({
          answer: "No production rows are mapped for yesterday (" + (yesterdayEt || "--") + ").",
          model: "deterministic",
        });
      }

      return res.status(200).json({
        answer:
          "Cases produced yesterday (" + (yesterdayEt || "ET") + "): " + yCases.toLocaleString() +
          ". Shift 1: " + yS1.toLocaleString() +
          ", Shift 2: " + yS2.toLocaleString() + "." +
          sourceNote((supabaseContext && supabaseContext.production && supabaseContext.production.summarySource) || "ops_daily_line_metrics_mv", yesterdayEt),
        model: "deterministic",
      });
    }
    if (
      (isAverageDailyQuestion(prompt) || isTopLineQuestion(prompt) || isTopSkuQuestion(prompt) || isShiftSplitQuestion(prompt)) &&
      supabaseContext &&
      supabaseContext.production &&
      typeof supabaseContext.production.range === "function"
    ) {
      var anchorDate = toText(metrics.todayEt) || ymdInEtFromDate(new Date());
      var periodForOps = resolvePeriodRange(detectPeriodLabel(prompt), anchorDate);
      var opsAgg = supabaseContext.production.range(periodForOps.start, periodForOps.end);
      if (!(toNum(opsAgg && opsAgg.totalCases) > 0)) {
        return res.status(200).json({
          answer: "No production rows found for " + periodForOps.label + " (" + periodForOps.start + " to " + periodForOps.end + ").",
          model: "deterministic",
        });
      }

      if (isAverageDailyQuestion(prompt)) {
        var days = Math.max(1, toNum(opsAgg.productionDays));
        var avgDaily = Math.round(toNum(opsAgg.totalCases) / days);
        return res.status(200).json({
          answer:
            "Average daily production for " + periodForOps.label + " (" + periodForOps.start + " to " + periodForOps.end + "): " +
            avgDaily.toLocaleString() + " cases/day across " + days + " production day" + (days === 1 ? "" : "s") + "." +
            sourceNote(supabaseContext.production.summarySource || "ops_daily_line_metrics_mv", periodForOps.end),
          model: "deterministic",
        });
      }
      if (isTopLineQuestion(prompt)) {
        var topLine = opsAgg.byLineTop && opsAgg.byLineTop.length ? opsAgg.byLineTop[0] : null;
        if (!topLine) {
          return res.status(200).json({ answer: "No line totals found for " + periodForOps.label + ".", model: "deterministic" });
        }
        return res.status(200).json({
          answer:
            "Top line for " + periodForOps.label + " (" + periodForOps.start + " to " + periodForOps.end + "): " +
            String(topLine.line || "--") + " with " + toNum(topLine.units).toLocaleString() + " cases." +
            sourceNote(supabaseContext.production.summarySource || "ops_daily_line_metrics_mv", periodForOps.end),
          model: "deterministic",
        });
      }
      if (isTopSkuQuestion(prompt)) {
        if (!opsAgg.hasSkuDetail) {
          return res.status(200).json({
            answer:
              "Detailed SKU-level production data is unavailable for " + periodForOps.label + " (" + periodForOps.start + " to " + periodForOps.end + ").",
            model: "deterministic",
          });
        }
        var skuList = (opsAgg.bySkuTop || []).slice(0, 5).map(function(x, idx) {
          return (idx + 1) + ". " + String(x.sku || "--") + " - " + toNum(x.units).toLocaleString() + " cases";
        });
        return res.status(200).json({
          answer:
            "Top SKU mix for " + periodForOps.label + " (" + periodForOps.start + " to " + periodForOps.end + "):\n" +
            (skuList.length ? skuList.join("\n") : "No SKU totals found.") +
            sourceNote(supabaseContext.production.detailSource || "production_events", periodForOps.end),
          model: "deterministic",
        });
      }
      if (isShiftSplitQuestion(prompt)) {
        var shiftList = (opsAgg.byShift || []).map(function(x) {
          return String(x.shift || "Unassigned") + ": " + toNum(x.units).toLocaleString();
        });
        var topShift = opsAgg.byShift && opsAgg.byShift.length ? opsAgg.byShift[0] : null;
        return res.status(200).json({
          answer:
            "Shift split for " + periodForOps.label + " (" + periodForOps.start + " to " + periodForOps.end + "): " +
            (shiftList.length ? shiftList.join(" | ") : "No shift totals found.") +
            (topShift ? ". Highest output: " + String(topShift.shift || "--") + "." : "") +
            sourceNote(supabaseContext.production.summarySource || "ops_daily_line_metrics_mv", periodForOps.end),
          model: "deterministic",
        });
      }
    }
    if (isRevenueQuestion(prompt) && defaultProdAgg) {
      if (!defaultProdAgg.hasSkuDetail) {
        return res.status(200).json({
          answer:
            "Detailed SKU-level production data is unavailable for " + defaultOpsPeriod.label + " (" + defaultOpsPeriod.start + " to " + defaultOpsPeriod.end + "), so revenue cannot be calculated yet.",
          model: "deterministic",
        });
      }
      var revenueTotal = toNum(defaultProdAgg.totalRevenue);
      var revenueCases = toNum(defaultProdAgg.totalCases);
      var coveredUnits = toNum(defaultProdAgg.revenueCoveredUnits);
      var coveragePct = revenueCases > 0 ? Math.round((coveredUnits / revenueCases) * 100) : 0;
      var missingCount = Array.isArray(defaultProdAgg.missingRevenueSkus) ? defaultProdAgg.missingRevenueSkus.length : 0;
      var topMissing = missingCount
        ? defaultProdAgg.missingRevenueSkus.slice(0, 3).map(function(x) { return String(x.sku || "--") + " (" + toNum(x.units).toLocaleString() + ")"; }).join(", ")
        : "";
      return res.status(200).json({
        answer:
          "Revenue for " + defaultOpsPeriod.label + " (" + defaultOpsPeriod.start + " to " + defaultOpsPeriod.end + "): $" +
          Math.round(revenueTotal).toLocaleString() + " across " + revenueCases.toLocaleString() + " cases. " +
          "Coverage: " + coveragePct + "% of produced units." +
          (missingCount ? " Missing revenue on " + missingCount + " SKU" + (missingCount === 1 ? "" : "s") + (topMissing ? ": " + topMissing + "." : ".") : "") +
          sourceNote(((supabaseContext && supabaseContext.production && supabaseContext.production.detailSource) || "production_events") + " + ops_sku_targets + item master cost", defaultOpsPeriod.end),
        model: "deterministic",
      });
    }
    if (isMissingRevenueQuestion(prompt) && defaultProdAgg) {
      if (!defaultProdAgg.hasSkuDetail) {
        return res.status(200).json({
          answer:
            "Detailed SKU-level production data is unavailable for " + defaultOpsPeriod.label + " (" + defaultOpsPeriod.start + " to " + defaultOpsPeriod.end + "), so pricing coverage cannot be verified yet.",
          model: "deterministic",
        });
      }
      var missingSkuRows = Array.isArray(defaultProdAgg.missingRevenueSkus) ? defaultProdAgg.missingRevenueSkus : [];
      if (!missingSkuRows.length) {
        return res.status(200).json({
          answer:
            "All produced SKUs for " + defaultOpsPeriod.label + " (" + defaultOpsPeriod.start + " to " + defaultOpsPeriod.end + ") have revenue coverage." +
            sourceNote(((supabaseContext && supabaseContext.production && supabaseContext.production.detailSource) || "production_events") + " + ops_sku_targets + item master cost", defaultOpsPeriod.end),
          model: "deterministic",
        });
      }
      var missingSkuText = missingSkuRows.slice(0, 8).map(function(x, idx) {
        return (idx + 1) + ". " + String(x.sku || "--") + " - " + toNum(x.units).toLocaleString() + " cases";
      }).join("\n");
      return res.status(200).json({
        answer:
          "SKUs missing revenue coverage for " + defaultOpsPeriod.label + " (" + defaultOpsPeriod.start + " to " + defaultOpsPeriod.end + "):\n" +
          missingSkuText +
          sourceNote(((supabaseContext && supabaseContext.production && supabaseContext.production.detailSource) || "production_events") + " + ops_sku_targets + item master cost", defaultOpsPeriod.end),
        model: "deterministic",
      });
    }
    if (isLaborQuestion(prompt) && defaultProdAgg && defaultLaborAgg) {
      var payableHours = toNum(defaultLaborAgg.payableHours);
      var productiveHours = toNum(defaultLaborAgg.productiveHours);
      var laborCost = toNum(defaultLaborAgg.laborCost);
      var prodCases = toNum(defaultProdAgg.totalCases);
      var casesPerPayable = payableHours > 0 ? Math.round((prodCases / payableHours) * 10) / 10 : 0;
      var casesPerProductive = productiveHours > 0 ? Math.round((prodCases / productiveHours) * 10) / 10 : 0;
      var laborCostPerCase = prodCases > 0 ? Math.round((laborCost / prodCases) * 100) / 100 : 0;
      return res.status(200).json({
        answer:
          "Labor actuals for " + defaultOpsPeriod.label + " (" + defaultOpsPeriod.start + " to " + defaultOpsPeriod.end + "): " +
          payableHours.toFixed(1) + " payable hrs, " + productiveHours.toFixed(1) + " productive hrs, $" + Math.round(laborCost).toLocaleString() + " labor cost. " +
          "Productivity: " + casesPerPayable.toLocaleString() + " cases/payable hr, " +
          casesPerProductive.toLocaleString() + " cases/productive hr. " +
          "Labor cost per case: $" + laborCostPerCase.toFixed(2) + "." +
          sourceNote(((supabaseContext && supabaseContext.labor && supabaseContext.labor.summarySource) || "ops_daily_line_metrics_mv") + " + " + (((supabaseContext && supabaseContext.production && supabaseContext.production.summarySource) || "ops_daily_line_metrics_mv")), defaultOpsPeriod.end),
        model: "deterministic",
      });
    }
    if (isBatchOpportunityQuestion(prompt) && supabaseContext && supabaseContext.workOrders) {
      var batchList = Array.isArray(supabaseContext.workOrders.batchOpportunities) ? supabaseContext.workOrders.batchOpportunities : [];
      if (!batchList.length) {
        return res.status(200).json({
          answer:
            "No same-item batching opportunities were found in the current open work orders snapshot." +
            sourceNote("cache snapshot workOrders", supabaseContext.snapshotSyncedAt),
          model: "deterministic",
        });
      }
      var batchLines = batchList.slice(0, 6).map(function(group, idx) {
        var dueWindow = group.dueStart && group.dueEnd ? (" due " + group.dueStart + " to " + group.dueEnd) : "";
        return (idx + 1) + ". " + group.sku + " - " + group.batchCount + " WOs, " +
          Math.round(toNum(group.totalRemainingUnits)).toLocaleString() + " remaining cases" + dueWindow;
      });
      return res.status(200).json({
        answer:
          "Top batching opportunities from current open work orders:\n" +
          batchLines.join("\n") +
          sourceNote("cache snapshot workOrders", supabaseContext.snapshotSyncedAt),
        model: "deterministic",
      });
    }
    if (
      isPeriodComparisonQuestion(prompt) &&
      supabaseContext &&
      supabaseContext.production &&
      typeof supabaseContext.production.range === "function"
    ) {
      var anchorCmp = toText(metrics.todayEt) || ymdInEtFromDate(new Date());
      var qLower = toText(prompt).toLowerCase();
      var periodA = qLower.includes("month") ? resolvePeriodRange("this_month", anchorCmp) : resolvePeriodRange("this_week", anchorCmp);
      var periodB = qLower.includes("month") ? resolvePeriodRange("last_month", anchorCmp) : resolvePeriodRange("last_week", anchorCmp);
      var aggA = supabaseContext.production.range(periodA.start, periodA.end);
      var aggB = supabaseContext.production.range(periodB.start, periodB.end);
      var aTotal = toNum(aggA && aggA.totalCases);
      var bTotal = toNum(aggB && aggB.totalCases);
      var pct = bTotal ? Math.round(((aTotal - bTotal) / bTotal) * 100) : 0;
      return res.status(200).json({
        answer:
          periodA.label + ": " + aTotal.toLocaleString() + " cases (" + periodA.start + " to " + periodA.end + "). " +
          periodB.label + ": " + bTotal.toLocaleString() + " cases (" + periodB.start + " to " + periodB.end + "). " +
          "Change: " + (pct >= 0 ? "+" : "") + pct + "%.",
        model: "deterministic",
      });
    }

    var periodLabel = detectPeriodLabel(prompt);
    if (
      isCasesProducedQuestion(prompt) &&
      periodLabel &&
      periodLabel !== "today" &&
      periodLabel !== "yesterday" &&
      supabaseContext &&
      supabaseContext.production &&
      typeof supabaseContext.production.range === "function"
    ) {
      var anchor = toText(metrics.todayEt) || ymdInEtFromDate(new Date());
      var periodCases = resolvePeriodRange(periodLabel, anchor);
      var agg = supabaseContext.production.range(periodCases.start, periodCases.end);
      var totalCases = toNum(agg && agg.totalCases);
      return res.status(200).json({
        answer:
          "Cases produced " + periodCases.label + " (" + (periodCases.start || "--") + " to " + (periodCases.end || "--") + "): " +
          totalCases.toLocaleString() + ".",
        model: "deterministic",
      });
    }

    if (isLastWeekSummaryQuestion(prompt) && !wantsDetailedBreakdown(prompt)) {
      var lwTotal = toNum(metrics.lastWeekCases);
      var lwS1 = toNum(metrics.lastWeekShift1Cases);
      var lwS2 = toNum(metrics.lastWeekShift2Cases);
      var lwStart = toText(metrics.lastWeekStartEt);
      var lwEnd = toText(metrics.lastWeekEndEt);
      var twTotal = toNum(metrics.thisWeekCases);
      var delta = lwTotal ? Math.round(((twTotal - lwTotal) / lwTotal) * 100) : 0;
      return res.status(200).json({
        answer:
          "Last week production (" + (lwStart || "--") + " to " + (lwEnd || "--") + "): " + lwTotal.toLocaleString() +
          " cases. Shift 1: " + lwS1.toLocaleString() +
          ", Shift 2: " + lwS2.toLocaleString() +
          ". This week-to-date: " + twTotal.toLocaleString() + " (" + (delta >= 0 ? "+" : "") + delta + "% vs last week).",
        model: "deterministic",
      });
    }
    if (isChartSummaryQuestion(prompt)) {
      var last7 = (supabaseContext && supabaseContext.production && Array.isArray(supabaseContext.production.byDayLast7))
        ? supabaseContext.production.byDayLast7
        : [];
      var topLines = (supabaseContext && supabaseContext.production && Array.isArray(supabaseContext.production.topLines))
        ? supabaseContext.production.topLines
        : [];
      if (!last7.length) {
        return res.status(200).json({
          answer: "I can’t summarize charts yet because recent production trend data is empty in Supabase. Run a sync and try again.",
          model: "deterministic",
        });
      }
      var total7 = last7.reduce(function(sum, d) { return sum + toNum(d.units); }, 0);
      var avg7 = Math.round(total7 / Math.max(1, last7.length));
      var sortedDays = last7.slice().sort(function(a, b) { return toNum(b.units) - toNum(a.units); });
      var best = sortedDays[0] || { date: "--", units: 0 };
      var worst = sortedDays[sortedDays.length - 1] || { date: "--", units: 0 };
      var trend = 0;
      if (last7.length >= 2) {
        var first = toNum(last7[0].units);
        var last = toNum(last7[last7.length - 1].units);
        trend = first ? Math.round(((last - first) / first) * 100) : 0;
      }
      var topLineText = topLines.length
        ? topLines.slice(0, 3).map(function(x) { return String(x.line || "--") + " (" + toNum(x.units).toLocaleString() + ")"; }).join(", ")
        : "No line breakdown available";
      return res.status(200).json({
        answer:
          "Chart summary (last 7 production days): total " + total7.toLocaleString() +
          " cases, avg " + avg7.toLocaleString() + "/day. " +
          "Peak day: " + String(best.date || "--") + " (" + toNum(best.units).toLocaleString() + "). " +
          "Low day: " + String(worst.date || "--") + " (" + toNum(worst.units).toLocaleString() + "). " +
          "Period trend: " + (trend >= 0 ? "+" : "") + trend + "%. " +
          "Top lines: " + topLineText + ".",
        model: "deterministic",
      });
    }
    if (isMarchYieldQuestion(prompt)) {
      var marchMonth = toText(metrics.marchMonth);
      var marchRemaining = toNum(metrics.marchRemainingUnits);
      var marchWOs = toNum(metrics.marchWorkOrders);
      var daysRemaining = toNum(metrics.marchBusinessDaysRemaining);
      var daysFull = toNum(metrics.marchBusinessDays);
      var targetRemain = toNum(metrics.marchDailyTargetRemaining);
      var targetFull = toNum(metrics.marchDailyTargetFullMonth);
      if (!(marchRemaining > 0) || !(daysFull > 0)) {
        return res.status(200).json({
          answer: "I can’t calculate March daily target yet because March due-volume metrics are not available in current context.",
          model: "deterministic",
        });
      }
      return res.status(200).json({
        answer:
          "March target (" + (marchMonth || "March") + "): " + marchRemaining.toLocaleString() +
          " remaining cases across " + marchWOs.toLocaleString() + " active WOs. " +
          "Required daily yield is " + targetFull.toLocaleString() + " cases/day over all March business days (" + daysFull + "). " +
          "From today forward, required pace is " + targetRemain.toLocaleString() + " cases/day over " + daysRemaining + " remaining business days.",
        model: "deterministic",
      });
    }

    var lastWeekRange = {
      start: toText(metrics.lastWeekStartEt),
      end: toText(metrics.lastWeekEndEt),
    };
    var thisWeekRange = {
      start: toText(metrics.thisWeekStartEt),
      end: toText(metrics.thisWeekEndEt),
    };
    var lastWeekAgg = (supabaseContext && supabaseContext.production && typeof supabaseContext.production.range === "function")
      ? supabaseContext.production.range(lastWeekRange.start, lastWeekRange.end)
      : { totalCases: 0, byLineTop: [], bySkuTop: [] };
    var thisWeekAgg = (supabaseContext && supabaseContext.production && typeof supabaseContext.production.range === "function")
      ? supabaseContext.production.range(thisWeekRange.start, thisWeekRange.end)
      : { totalCases: 0, byLineTop: [], bySkuTop: [] };

    if (supabaseContext && supabaseContext.production) {
      // remove function before serialization
      delete supabaseContext.production.range;
    }
    if (supabaseContext && supabaseContext.labor) {
      delete supabaseContext.labor.range;
    }
    if (supabaseContext && Object.prototype.hasOwnProperty.call(supabaseContext, "snapshotPayload")) {
      delete supabaseContext.snapshotPayload;
    }

    var copilotFactPack = buildCopilotFactPack(metrics, activeView, contextLines, supabaseContext);

    var apiKey = process.env.OPENAI_API_KEY || "";
    var model = process.env.OPENAI_MODEL || "gpt-4o-mini";
    if (!apiKey) {
      if (deterministicCopilotAnswer) {
        return sendAnswer(res, deterministicCopilotAnswer, {
          model: "deterministic",
          mode: copilotMode || "chat",
          sourceLabel: "PackPulse metrics",
          dataTimestamp: responseDataTimestamp,
          deterministic: true,
          followUps: followUpsForMode(copilotMode, activeView),
        });
      }
      return res.status(500).json({ error: "OPENAI_API_KEY is not configured" });
    }

    var system = [
      "You are PackPulse AI copilot for factory operations.",
      "Be concise, practical, and action-oriented.",
      "Prioritize: what happened, why it matters, and what to do next.",
      "Use provided numeric context directly; do not invent metrics.",
      "If the user asks for a number and it is present in context, answer with the exact value first.",
      "For summary questions, include: total, trend, top line or SKU mix when available, and concrete actions.",
      "If data is missing or uncertain, say so clearly.",
      "Never claim actions were completed unless explicitly provided in context.",
      "Always distinguish between facts from context and recommendations inferred from those facts.",
      buildCopilotModeInstruction(copilotMode)
    ].join(" ");

    var messages = [{ role: "system", content: system }];
    messages.push({
      role: "user",
      content:
        "Context\n" +
        "- User: " + user.email + "\n" +
        "- Active view: " + activeView + "\n" +
        (copilotMode ? "- Copilot mode: " + copilotMode + "\n" : "") +
        (contextLines.length ? "- Dashboard context:\n  - " + contextLines.join("\n  - ") + "\n" : "") +
        "- Metrics JSON: " + JSON.stringify(metrics) + "\n" +
        "- Copilot fact pack JSON: " + JSON.stringify(copilotFactPack) + "\n" +
        "- Last week aggregate JSON: " + JSON.stringify(lastWeekAgg) + "\n" +
        "- This week aggregate JSON: " + JSON.stringify(thisWeekAgg) + "\n" +
        "- Supabase context JSON: " + JSON.stringify(supabaseContext || {})
    });

    history.forEach(function(msg) {
      var role = msg && msg.role === "assistant" ? "assistant" : "user";
      var text = toText(msg && msg.text);
      if (!text) return;
      messages.push({ role: role, content: text });
    });
    messages.push({ role: "user", content: prompt });

    var openaiResp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + apiKey,
      },
      body: JSON.stringify({
        model: model,
        temperature: 0.2,
        messages: messages,
      }),
    });

    var raw = await openaiResp.text();
    var parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch (_) {
      parsed = null;
    }
    if (!openaiResp.ok) {
      var details = parsed && parsed.error && parsed.error.message ? parsed.error.message : raw || "OpenAI request failed";
      if (deterministicCopilotAnswer) {
        return sendAnswer(res, deterministicCopilotAnswer, {
          model: "deterministic",
          mode: copilotMode || "chat",
          sourceLabel: "PackPulse metrics",
          dataTimestamp: responseDataTimestamp,
          deterministic: true,
          followUps: followUpsForMode(copilotMode, activeView),
        });
      }
      return res.status(openaiResp.status).json({ error: "AI request failed", details: details });
    }

    var answer =
      parsed &&
      parsed.choices &&
      parsed.choices[0] &&
      parsed.choices[0].message &&
      parsed.choices[0].message.content
        ? String(parsed.choices[0].message.content).trim()
        : "";
    if (!answer && deterministicCopilotAnswer) answer = deterministicCopilotAnswer;
    if (!answer) answer = "No AI response was returned.";

    return sendAnswer(res, answer, {
      model: model,
      mode: copilotMode || "chat",
      sourceLabel: "PackPulse metrics + Supabase context",
      dataTimestamp: responseDataTimestamp,
      deterministic: false,
      followUps: followUpsForMode(copilotMode, activeView),
    });
  } catch (err) {
    Sentry.captureException(err);
    return res.status(500).json({
      error: "Could not process AI request",
      details: err && err.message ? err.message : "unknown",
    });
  }
}
