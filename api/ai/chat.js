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
    q.includes("explain change") ||
    q.includes("explain the change") ||
    q.includes("why did this change") ||
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

function isDiagnoseQuestion(prompt) {
  var q = toText(prompt).toLowerCase();
  if (!q) return false;
  return (
    q.includes("diagnose") ||
    q.includes("root cause") ||
    q.includes("what is going on") ||
    q.includes("what's going on") ||
    q.includes("interpret the data")
  );
}

function isRecommendQuestion(prompt) {
  var q = toText(prompt).toLowerCase();
  if (!q) return false;
  return (
    q.includes("recommend") ||
    q.includes("what should we do") ||
    q.includes("best move") ||
    q.includes("action plan") ||
    q.includes("best actions")
  );
}

function isSimulateQuestion(prompt) {
  var q = toText(prompt).toLowerCase();
  if (!q) return false;
  return (
    q.includes("simulate") ||
    q.includes("scenario") ||
    q.includes("what if") ||
    q.includes("if we") ||
    q.includes("if the")
  );
}

function isIdeateQuestion(prompt) {
  var q = toText(prompt).toLowerCase();
  if (!q) return false;
  return (
    q.includes("ideate") ||
    q.includes("brainstorm") ||
    q.includes("ideas") ||
    q.includes("options") ||
    q.includes("creative ways")
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
  if (key === "diagnose") return "Diagnose";
  if (key === "recommend") return "Recommend";
  if (key === "simulate") return "Simulate";
  if (key === "ideate") return "Ideate";
  if (key === "standup") return "Standup Brief";
  if (key === "run_next") return "Run Next";
  if (key === "risk_radar") return "Risk Radar";
  if (key === "batch_plan") return "Batch Plan";
  if (key === "throughput_watch") return "Throughput Watch";
  if (key === "executive_brief") return "Executive Brief";
  if (key === "what_changed" || key === "explain_change") return "Explain Change";
  if (key === "data_health") return "Data Health";
  return "Copilot";
}

function inferCopilotMode(prompt, explicitMode) {
  var mode = toText(explicitMode).toLowerCase();
  if (mode) return mode;
  if (isDiagnoseQuestion(prompt)) return "diagnose";
  if (isRecommendQuestion(prompt)) return "recommend";
  if (isSimulateQuestion(prompt)) return "simulate";
  if (isIdeateQuestion(prompt)) return "ideate";
  if (isStandupQuestion(prompt)) return "standup";
  if (isRunNextQuestion(prompt)) return "run_next";
  if (isRiskRadarQuestion(prompt)) return "risk_radar";
  if (isBatchOpportunityQuestion(prompt)) return "batch_plan";
  if (isThroughputWatchQuestion(prompt)) return "throughput_watch";
  if (isExecutiveBriefQuestion(prompt)) return "executive_brief";
  if (isWhatChangedQuestion(prompt)) return "explain_change";
  if (isDataHealthQuestion(prompt)) return "data_health";
  return "";
}

function followUpsForMode(mode, activeView) {
  var key = toText(mode).toLowerCase();
  if (key === "diagnose") {
    return [
      "What should we do next based on that diagnosis?",
      "Simulate the best recovery scenarios.",
      "Explain what changed vs last week."
    ];
  }
  if (key === "recommend") {
    return [
      "Diagnose why those moves matter most.",
      "Simulate the best and worst outcomes.",
      "Turn this into a standup brief."
    ];
  }
  if (key === "simulate") {
    return [
      "Which scenario is safest to act on now?",
      "Recommend the best next moves from that simulation.",
      "Diagnose what is most likely to go wrong."
    ];
  }
  if (key === "ideate") {
    return [
      "Which ideas are most realistic to test first?",
      "Recommend the best actions from those ideas.",
      "Simulate the upside of the top option."
    ];
  }
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
  if (key === "what_changed" || key === "explain_change") {
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
    provider: toText(options && options.provider),
    toolsUsed: Array.isArray(options && options.toolsUsed) ? options.toolsUsed.slice(0, 6) : [],
    analysisSummary: toText(options && options.analysisSummary),
    plannerSource: toText(options && options.plannerSource),
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

function buildDiagnoseAnswer(metrics, dataTimestamp) {
  var topRisk = takeTop(metrics && metrics.topSupplyRisks, 1)[0] || null;
  var topRun = takeTop(metrics && metrics.topRunNext, 1)[0] || null;
  return [
    "**1) What I See**",
    "- Output today is " + formatWholeNumber(metrics && metrics.productionTodayCases) + " cases, with week-to-date at " + formatWholeNumber(metrics && metrics.thisWeekCases) + " (" + formatSignedPercent(metrics && metrics.weekDeltaPct) + " vs last week).",
    "- Supply pressure is " + formatWholeNumber(metrics && metrics.highRiskCount) + " high-risk items and " + formatWholeNumber(metrics && metrics.atRiskUnits) + " units exposed.",
    "- Queue pressure is " + formatWholeNumber(metrics && metrics.workOrdersBlocked) + " blocked work orders against " + formatWholeNumber(metrics && metrics.workOrdersReady) + " ready.",
    "",
    "**2) What I Think It Means**",
    "- Material risk is likely constraining the plan." + (topRisk ? " The sharpest current signal is " + toText(topRisk.sku) + "." : ""),
    "- Throughput loss is also meaningful at " + formatWholeNumber(metrics && metrics.evoconUnplannedMin) + " unplanned-stop minutes and " + formatWholeNumber(metrics && metrics.evoconSlowMin) + " slow-production minutes.",
    "- Sequencing still matters because the lead queue candidate is " + (topRun ? ("WO " + toText(topRun.woNum)) : "not clearly established yet") + ".",
    "",
    "**3) What I'd Check Next**",
    "- Validate whether the top shortage blocks multiple near-due work orders.",
    "- Confirm whether throughput loss is concentrated on one line or spread across shifts.",
    "- Re-check data freshness before escalating the narrative outside the plant team.",
    "",
    "**4) Confidence / Source**",
    "- Diagnosis is grounded in PackPulse production, queue, risk, and data-health signals." + sourceNote("PackPulse metrics", dataTimestamp)
  ].join("\n");
}

function buildRecommendAnswer(metrics, dataTimestamp) {
  var plannerRec = findRecommendationForOwner(metrics, "planner");
  var supplyRec = findRecommendationForOwner(metrics, "supply");
  return [
    "**1) Decision Frame**",
    "- Protect output first, then de-risk shortages, then reduce avoidable changeovers.",
    "- The day currently carries " + formatWholeNumber(metrics && metrics.atRiskUnits) + " units of supply exposure and " + formatWholeNumber(metrics && metrics.evoconUnplannedMin) + " minutes of unplanned-stop loss.",
    "",
    "**2) Best Moves**",
    "- Planner: " + (plannerRec ? (toText(plannerRec.action) + " - " + toText(plannerRec.why)) : "Lock the next run family and keep the sequence stable."),
    "- Supply Chain: " + (supplyRec ? (toText(supplyRec.action) + " - " + toText(supplyRec.why)) : "Expedite the highest uncovered shortages first."),
    "- Floor Lead: protect the highest-value run and attack the largest throughput loss first.",
    "",
    "**3) Tradeoffs**",
    "- Running the top queue candidate maximizes service, but repeated-SKU batching may still be the better efficiency move if due dates allow it.",
    "- Aggressive expedites can protect output, but only if the inbound timing beats the due-date window.",
    "",
    "**4) Confidence / Source**",
    "- Recommendations are grounded in current PackPulse rankings and risk signals." + sourceNote("dispatch queue + recommendations + risk", dataTimestamp)
  ].join("\n");
}

function buildSimulateAnswer(metrics, dataTimestamp) {
  var topRisk = takeTop(metrics && metrics.topSupplyRisks, 1)[0] || null;
  var topBatch = takeTop(metrics && metrics.topBatchGroups, 1)[0] || null;
  return [
    "**1) Scenario Set**",
    "- Resolve top shortage: " + (topRisk ? (toText(topRisk.sku) + " with roughly " + formatWholeNumber(Math.max(toNum(topRisk.shortQty), toNum(topRisk.unitsAtRisk))) + " units at risk.") : "No dominant shortage is surfaced right now."),
    "- Run the largest batch family: " + (topBatch ? (toText(topBatch.sku) + " across " + formatWholeNumber(topBatch.count) + " work orders.") : "No strong same-item family is open right now."),
    "- Reduce throughput loss: cut unplanned stops from " + formatWholeNumber(metrics && metrics.evoconUnplannedMin) + " minutes and protect the best-ranked run.",
    "",
    "**2) Likely Outcomes**",
    "- Shortage recovery helps most when the blocked material sits inside near-due work orders.",
    "- Batch execution helps most when the repeated family is not already at risk from material shortages.",
    "- Throughput recovery helps most when the output gap is operational rather than material-driven.",
    "",
    "**3) Decision Use**",
    "- If shortage risk dominates, expedite material first.",
    "- If material is stable, sequence the largest same-item family.",
    "- If the floor is unstable, prioritize loss recovery before resequencing again.",
    "",
    "**4) Confidence / Source**",
    "- Scenarios are evidence-backed directionally, not exact simulation math." + sourceNote("PackPulse metrics + current queue/risk context", dataTimestamp)
  ].join("\n");
}

function buildIdeateAnswer(metrics, dataTimestamp) {
  var topBatch = takeTop(metrics && metrics.topBatchGroups, 1)[0] || null;
  return [
    "**1) Fresh Angles**",
    "- Use micro-batching on the strongest repeated SKU family" + (topBatch ? (" (" + toText(topBatch.sku) + ").") : "."),
    "- Build a temporary shortage-protection list that combines due date, units at risk, and affected customers.",
    "- Create a standing recovery trigger when unplanned-stop minutes breach the day’s tolerance.",
    "",
    "**2) High-Leverage Experiments**",
    "- Test whether protecting the top run family for one full shift reduces resequencing churn.",
    "- Try a daily 15-minute joint review between planner, supply, and floor lead on the top 3 risks only.",
    "- Separate “data confidence” issues from real operating issues so the team stops reacting to stale signals.",
    "",
    "**3) Watchouts**",
    "- Do not treat ideation as confirmation; each idea still needs evidence and owner assignment.",
    "- Creative sequencing is only useful if it does not worsen due-date risk or shortage exposure.",
    "",
    "**4) Confidence / Source**",
    "- Ideas are grounded in current PackPulse signals, but they are exploratory by design." + sourceNote("PackPulse metrics", dataTimestamp)
  ].join("\n");
}

function buildDeterministicCopilotAnswer(mode, metrics, dataTimestamp) {
  var key = toText(mode).toLowerCase();
  if (key === "diagnose") return buildDiagnoseAnswer(metrics, dataTimestamp);
  if (key === "recommend") return buildRecommendAnswer(metrics, dataTimestamp);
  if (key === "simulate") return buildSimulateAnswer(metrics, dataTimestamp);
  if (key === "ideate") return buildIdeateAnswer(metrics, dataTimestamp);
  if (key === "run_next") return buildRunNextAnswer(metrics, dataTimestamp);
  if (key === "standup") return buildStandupAnswer(metrics, dataTimestamp);
  if (key === "risk_radar") return buildRiskRadarAnswer(metrics, dataTimestamp);
  if (key === "batch_plan") return buildBatchPlanAnswer(metrics, dataTimestamp);
  if (key === "throughput_watch") return buildThroughputWatchAnswer(metrics, dataTimestamp);
  if (key === "executive_brief") return buildExecutiveBriefAnswer(metrics, dataTimestamp);
  if (key === "what_changed" || key === "explain_change") return buildWhatChangedAnswer(metrics, dataTimestamp);
  if (key === "data_health") return buildDataHealthAnswer(metrics, dataTimestamp);
  return "";
}

function buildCopilotModeInstruction(mode) {
  var key = toText(mode).toLowerCase();
  if (key === "diagnose") {
    return "Format with bold headings exactly: **1) What I See**, **2) What I Think It Means**, **3) What I'd Check Next**, **4) Confidence / Source**. Interpret the evidence before giving recommendations.";
  }
  if (key === "recommend") {
    return "Format with bold headings exactly: **1) Decision Frame**, **2) Best Moves**, **3) Tradeoffs**, **4) Confidence / Source**. Make the actions explicit and realistic.";
  }
  if (key === "simulate") {
    return "Format with bold headings exactly: **1) Scenario Set**, **2) Likely Outcomes**, **3) Decision Use**, **4) Confidence / Source**. Be clear when a scenario is directional rather than exact.";
  }
  if (key === "ideate") {
    return "Format with bold headings exactly: **1) Fresh Angles**, **2) High-Leverage Experiments**, **3) Watchouts**, **4) Confidence / Source**. Generate useful options without pretending they are validated facts.";
  }
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
  if (key === "what_changed" || key === "explain_change") {
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

function resolveAiProviderConfig() {
  var configured = toText(process.env.AI_PROVIDER).toLowerCase();
  var openaiKey = toText(process.env.OPENAI_API_KEY);
  var anthropicKey = toText(process.env.ANTHROPIC_API_KEY);
  if (configured === "anthropic") {
    if (!anthropicKey) return null;
    return {
      provider: "anthropic",
      apiKey: anthropicKey,
      model: toText(process.env.ANTHROPIC_MODEL) || "claude-sonnet-4-20250514"
    };
  }
  if (configured === "openai") {
    if (!openaiKey) return null;
    return {
      provider: "openai",
      apiKey: openaiKey,
      model: toText(process.env.OPENAI_MODEL) || "gpt-4o-mini"
    };
  }
  if (openaiKey) {
    return {
      provider: "openai",
      apiKey: openaiKey,
      model: toText(process.env.OPENAI_MODEL) || "gpt-4o-mini"
    };
  }
  if (anthropicKey) {
    return {
      provider: "anthropic",
      apiKey: anthropicKey,
      model: toText(process.env.ANTHROPIC_MODEL) || "claude-sonnet-4-20250514"
    };
  }
  return null;
}

function providerLabel(provider) {
  var key = toText(provider).toLowerCase();
  if (key === "anthropic") return "Claude";
  if (key === "openai") return "OpenAI";
  return key || "";
}

function stripJsonFences(text) {
  var raw = toText(text);
  if (!raw) return "";
  return raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function parseJsonLoose(text) {
  var raw = stripJsonFences(text);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_) {}
  var firstBrace = raw.indexOf("{");
  var lastBrace = raw.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(raw.slice(firstBrace, lastBrace + 1));
    } catch (_) {}
  }
  var firstBracket = raw.indexOf("[");
  var lastBracket = raw.lastIndexOf("]");
  if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
    try {
      return JSON.parse(raw.slice(firstBracket, lastBracket + 1));
    } catch (_) {}
  }
  return null;
}

async function callAiText(providerConfig, options) {
  if (!providerConfig || !providerConfig.provider || !providerConfig.apiKey) {
    throw new Error("AI provider is not configured");
  }
  var messages = Array.isArray(options && options.messages) ? options.messages : [];
  var system = toText(options && options.system);
  var temperature = options && options.temperature != null ? Number(options.temperature) : 0.2;
  var maxTokens = Math.max(200, Number(options && options.maxTokens) || 1400);
  if (providerConfig.provider === "anthropic") {
    var anthropicMessages = messages.map(function(msg) {
      return {
        role: msg && msg.role === "assistant" ? "assistant" : "user",
        content: toText(msg && msg.content)
      };
    }).filter(function(msg) { return !!msg.content; });
    var anthropicResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": providerConfig.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: providerConfig.model,
        max_tokens: maxTokens,
        temperature: temperature,
        system: system || undefined,
        messages: anthropicMessages,
      }),
    });
    var anthropicRaw = await anthropicResp.text();
    var anthropicParsed = null;
    try {
      anthropicParsed = JSON.parse(anthropicRaw);
    } catch (_) {
      anthropicParsed = null;
    }
    if (!anthropicResp.ok) {
      var anthropicDetails = anthropicParsed && anthropicParsed.error && anthropicParsed.error.message
        ? anthropicParsed.error.message
        : anthropicRaw || "Anthropic request failed";
      throw new Error(anthropicDetails);
    }
    var anthropicText = anthropicParsed && Array.isArray(anthropicParsed.content)
      ? anthropicParsed.content.map(function(item) { return item && item.type === "text" ? toText(item.text) : ""; }).filter(Boolean).join("\n")
      : "";
    return {
      provider: providerConfig.provider,
      model: providerConfig.model,
      text: anthropicText.trim(),
    };
  }

  var openAiMessages = [];
  if (system) openAiMessages.push({ role: "system", content: system });
  messages.forEach(function(msg) {
    var role = msg && msg.role === "assistant" ? "assistant" : "user";
    var content = toText(msg && msg.content);
    if (content) openAiMessages.push({ role: role, content: content });
  });
  var openaiResp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + providerConfig.apiKey,
    },
    body: JSON.stringify({
      model: providerConfig.model,
      temperature: temperature,
      max_tokens: maxTokens,
      messages: openAiMessages,
    }),
  });
  var openaiRaw = await openaiResp.text();
  var openaiParsed = null;
  try {
    openaiParsed = JSON.parse(openaiRaw);
  } catch (_) {
    openaiParsed = null;
  }
  if (!openaiResp.ok) {
    var openaiDetails = openaiParsed && openaiParsed.error && openaiParsed.error.message
      ? openaiParsed.error.message
      : openaiRaw || "OpenAI request failed";
    throw new Error(openaiDetails);
  }
  var openaiText =
    openaiParsed &&
    openaiParsed.choices &&
    openaiParsed.choices[0] &&
    openaiParsed.choices[0].message &&
    openaiParsed.choices[0].message.content
      ? String(openaiParsed.choices[0].message.content).trim()
      : "";
  return {
    provider: providerConfig.provider,
    model: providerConfig.model,
    text: openaiText,
  };
}

var ANALYST_TOOL_LABELS = {
  plant_snapshot: "Plant Snapshot",
  queue_health: "Queue Health",
  risk_blast_radius: "Risk Blast Radius",
  batch_leverage: "Batch Leverage",
  throughput_pressure: "Throughput Pressure",
  period_compare: "Period Compare",
  owner_action_board: "Owner Action Board",
  data_confidence: "Data Confidence",
  scenario_lab: "Scenario Lab",
};

function analystToolLabel(name) {
  return ANALYST_TOOL_LABELS[toText(name)] || toText(name);
}

function defaultAnalystPlan(mode, prompt) {
  var key = toText(mode).toLowerCase() || "diagnose";
  if (key === "recommend" || key === "standup" || key === "executive_brief") {
    return {
      analysisMode: key,
      goal: "Turn current operating signals into the best next moves.",
      hypotheses: [
        "The highest-leverage actions are visible in the current recommendation board.",
        "Material risk and throughput loss are the main constraints on the plan.",
        "The next answer should be concrete and owner-specific."
      ],
      toolRequests: [
        { tool: "plant_snapshot", reason: "Anchor the answer in the current operating state." },
        { tool: "owner_action_board", reason: "Pull the strongest actions by owner." },
        { tool: "queue_health", reason: "Frame the queue pressure and next sequence." },
        { tool: "risk_blast_radius", reason: "Surface the sharpest material exposure." },
        { tool: "data_confidence", reason: "State how much confidence the team should have." },
      ],
    };
  }
  if (key === "simulate") {
    return {
      analysisMode: key,
      goal: "Model the most decision-useful scenarios from the current state.",
      hypotheses: [
        "Shortage recovery, batching, and throughput recovery are the most useful scenarios.",
        "The scenarios should be directional unless exact math is available.",
        "The answer should help the user choose which scenario to test first."
      ],
      toolRequests: [
        { tool: "plant_snapshot", reason: "Anchor the scenarios." },
        { tool: "scenario_lab", reason: "Generate scenario candidates from current signals." },
        { tool: "queue_health", reason: "Evaluate queue sensitivity." },
        { tool: "risk_blast_radius", reason: "See how supply risk changes scenario value." },
        { tool: "data_confidence", reason: "State where scenario confidence is weak." },
      ],
    };
  }
  if (key === "ideate") {
    return {
      analysisMode: key,
      goal: "Generate practical, evidence-aware new options.",
      hypotheses: [
        "There are creative but plausible ways to improve flow without rewriting the whole plan.",
        "Ideas are strongest when tied to queue, risk, and batching evidence.",
        "The answer should separate ideas from validated facts."
      ],
      toolRequests: [
        { tool: "plant_snapshot", reason: "Anchor ideation in facts." },
        { tool: "batch_leverage", reason: "Find efficiency-based idea paths." },
        { tool: "scenario_lab", reason: "Generate experiments and options." },
        { tool: "risk_blast_radius", reason: "Avoid ideas that worsen shortages." },
        { tool: "data_confidence", reason: "Keep the ideation honest." },
      ],
    };
  }
  if (key === "run_next" || key === "batch_plan") {
    return {
      analysisMode: key,
      goal: "Interpret the queue and sequence the next best work.",
      hypotheses: [
        "The best next jobs balance due urgency, material coverage, and batching leverage.",
        "Queue interpretation is stronger when shortage and batching tools are combined.",
        "The answer should name the next jobs and explain the sequencing logic."
      ],
      toolRequests: [
        { tool: "queue_health", reason: "Start from ranked queue pressure." },
        { tool: "batch_leverage", reason: "Pull same-item sequencing opportunities." },
        { tool: "risk_blast_radius", reason: "Avoid jobs that are about to break on material." },
        { tool: "data_confidence", reason: "Declare feed freshness and uncertainty." },
      ],
    };
  }
  if (key === "risk_radar") {
    return {
      analysisMode: key,
      goal: "Interpret the risk picture and prioritize the strongest mitigations.",
      hypotheses: [
        "A few high-risk materials are doing most of the damage.",
        "The best risk answer should connect exposure to actions and owners.",
        "Freshness matters because stale inbound feeds can distort the watchlist."
      ],
      toolRequests: [
        { tool: "risk_blast_radius", reason: "Map the sharpest current exposure." },
        { tool: "owner_action_board", reason: "Translate risk into actions." },
        { tool: "queue_health", reason: "Show how risk collides with the run plan." },
        { tool: "data_confidence", reason: "Explain data freshness." },
      ],
    };
  }
  if (key === "throughput_watch" || key === "what_changed" || key === "explain_change") {
    return {
      analysisMode: key,
      goal: "Explain performance change and isolate what is driving it.",
      hypotheses: [
        "The current delta is a mix of throughput loss, material pressure, and queue shape.",
        "Comparing this week to last week should expose the strongest drivers.",
        "The answer should distinguish facts from inference."
      ],
      toolRequests: [
        { tool: "plant_snapshot", reason: "Anchor the current state." },
        { tool: "period_compare", reason: "Explain the change against the prior period." },
        { tool: "throughput_pressure", reason: "See whether the loss story is operational." },
        { tool: "risk_blast_radius", reason: "See whether the loss story is material." },
        { tool: "data_confidence", reason: "Explain how much trust to place in the story." },
      ],
    };
  }
  return {
    analysisMode: key,
    goal: "Diagnose what is happening in the plant data and why it matters.",
    hypotheses: [
      "The output story is being shaped by both material risk and throughput pressure.",
      "The next useful answer needs interpretation, not just a restatement of metrics.",
      "Any strong conclusion should account for data freshness."
    ],
    toolRequests: [
      { tool: "plant_snapshot", reason: "Anchor the diagnosis in current facts." },
      { tool: "period_compare", reason: "Check the current pace against the prior window." },
      { tool: "throughput_pressure", reason: "Inspect operational drag." },
      { tool: "risk_blast_radius", reason: "Inspect material drag." },
      { tool: "queue_health", reason: "See whether sequencing pressure is part of the story." },
      { tool: "data_confidence", reason: "State whether the evidence is fresh enough." },
    ],
  };
}

function normalizePlannerOutput(rawPlan, fallbackPlan) {
  var allowedTools = Object.keys(ANALYST_TOOL_LABELS);
  var fallback = fallbackPlan || defaultAnalystPlan("", "");
  var plan = rawPlan && typeof rawPlan === "object" ? rawPlan : {};
  var toolRequests = takeTop(Array.isArray(plan.tool_requests) ? plan.tool_requests : fallback.toolRequests, 6)
    .map(function(item) {
      return {
        tool: toText(item && item.tool).toLowerCase(),
        reason: toText(item && item.reason),
      };
    })
    .filter(function(item) { return allowedTools.indexOf(item.tool) !== -1; });
  if (!toolRequests.length) toolRequests = fallback.toolRequests;
  var hypotheses = takeTop(Array.isArray(plan.hypotheses) ? plan.hypotheses : fallback.hypotheses, 4)
    .map(toText)
    .filter(Boolean);
  if (!hypotheses.length) hypotheses = fallback.hypotheses;
  return {
    analysisMode: toText(plan.analysis_mode || fallback.analysisMode || "diagnose").toLowerCase(),
    goal: toText(plan.goal || fallback.goal),
    hypotheses: hypotheses,
    toolRequests: toolRequests,
  };
}

async function planAnalystWorkflow(providerConfig, options) {
  var mode = toText(options && options.mode).toLowerCase();
  var prompt = toText(options && options.prompt);
  var fallbackPlan = defaultAnalystPlan(mode, prompt);
  if (!providerConfig) {
    return Object.assign({ plannerSource: "fallback" }, fallbackPlan);
  }
  try {
    var plannerSystem = [
      "You are planning a PackPulse AI analyst workflow.",
      "Return JSON only.",
      "Do not answer the user's question directly.",
      "Choose 3 to 6 tools from this allowed list: " + Object.keys(ANALYST_TOOL_LABELS).join(", ") + ".",
      "JSON shape: {\"analysis_mode\":\"...\",\"goal\":\"...\",\"hypotheses\":[...],\"tool_requests\":[{\"tool\":\"...\",\"reason\":\"...\"}]}."
    ].join(" ");
    var plannerUser = [
      "User question: " + prompt,
      "Requested mode: " + (mode || "auto"),
      "Compact fact pack JSON: " + JSON.stringify(options && options.factPack ? options.factPack : {}),
      "If exact simulation math is unavailable, you may still request scenario_lab for directional reasoning."
    ].join("\n");
    var plannerResp = await callAiText(providerConfig, {
      system: plannerSystem,
      messages: [{ role: "user", content: plannerUser }],
      temperature: 0.1,
      maxTokens: 500,
    });
    var plannerJson = parseJsonLoose(plannerResp.text);
    var normalized = normalizePlannerOutput(plannerJson, fallbackPlan);
    normalized.plannerSource = "model";
    return normalized;
  } catch (_) {
    return Object.assign({ plannerSource: "fallback" }, fallbackPlan);
  }
}

function buildLineDeltaRows(thisWeekAgg, lastWeekAgg) {
  var map = {};
  takeTop(thisWeekAgg && thisWeekAgg.byLineTop, 10).forEach(function(row) {
    var key = toText(row && row.line) || "Unknown";
    if (!map[key]) map[key] = { line: key, thisWeek: 0, lastWeek: 0 };
    map[key].thisWeek += toNum(row && row.units);
  });
  takeTop(lastWeekAgg && lastWeekAgg.byLineTop, 10).forEach(function(row) {
    var key = toText(row && row.line) || "Unknown";
    if (!map[key]) map[key] = { line: key, thisWeek: 0, lastWeek: 0 };
    map[key].lastWeek += toNum(row && row.units);
  });
  return Object.keys(map).map(function(key) {
    return {
      line: key,
      thisWeek: map[key].thisWeek,
      lastWeek: map[key].lastWeek,
      delta: map[key].thisWeek - map[key].lastWeek,
    };
  }).sort(function(a, b) { return Math.abs(b.delta) - Math.abs(a.delta); }).slice(0, 5);
}

function executeAnalystTool(name, context) {
  var metrics = context && context.metrics ? context.metrics : {};
  var factPack = context && context.factPack ? context.factPack : {};
  var lastWeekAgg = context && context.lastWeekAgg ? context.lastWeekAgg : {};
  var thisWeekAgg = context && context.thisWeekAgg ? context.thisWeekAgg : {};
  var dataTimestamp = toText(context && context.dataTimestamp);
  var topRun = takeTop(metrics && metrics.topRunNext, 3);
  var topRisk = takeTop(metrics && metrics.topSupplyRisks, 4);
  var topBatch = takeTop(metrics && metrics.topBatchGroups, 4);
  var topRecommendations = takeTop(metrics && metrics.topRecommendations, 8);
  var staleFeeds = takeTop((metrics && metrics.dataHealth || []).filter(function(feed) {
    var status = toText(feed && feed.status);
    return status && status !== "fresh";
  }), 5);
  if (name === "plant_snapshot") {
    return {
      tool: name,
      label: analystToolLabel(name),
      summary:
        "Today " + formatWholeNumber(metrics && metrics.productionTodayCases) + " cases; " +
        formatWholeNumber(metrics && metrics.workOrdersReady) + " ready / " + formatWholeNumber(metrics && metrics.workOrdersBlocked) + " blocked WOs; " +
        formatWholeNumber(metrics && metrics.atRiskUnits) + " units at risk.",
      data: {
        todayCases: toNum(metrics && metrics.productionTodayCases),
        yesterdayCases: toNum(metrics && metrics.productionYesterdayCases),
        thisWeekCases: toNum(metrics && metrics.thisWeekCases),
        lastWeekCases: toNum(metrics && metrics.lastWeekCases),
        workOrdersTotal: toNum(metrics && metrics.workOrdersTotal),
        workOrdersReady: toNum(metrics && metrics.workOrdersReady),
        workOrdersBlocked: toNum(metrics && metrics.workOrdersBlocked),
        atRiskUnits: toNum(metrics && metrics.atRiskUnits),
        highRiskCount: toNum(metrics && metrics.highRiskCount),
        dataTimestamp: dataTimestamp,
      },
    };
  }
  if (name === "queue_health") {
    return {
      tool: name,
      label: analystToolLabel(name),
      summary:
        "Queue has " + topRun.length + " visible run-next candidates. Lead: " +
        (topRun[0] ? ("WO " + toText(topRun[0].woNum) + " with " + formatWholeNumber(topRun[0].impactUnits) + " units impact.") : "none."),
      data: {
        blocked: toNum(metrics && metrics.workOrdersBlocked),
        ready: toNum(metrics && metrics.workOrdersReady),
        blockedRatio: toNum(metrics && metrics.workOrdersTotal) > 0 ? Math.round((toNum(metrics && metrics.workOrdersBlocked) / toNum(metrics && metrics.workOrdersTotal)) * 100) : 0,
        topRunNext: topRun,
      },
    };
  }
  if (name === "risk_blast_radius") {
    return {
      tool: name,
      label: analystToolLabel(name),
      summary:
        "Top risk watchlist shows " + formatWholeNumber(metrics && metrics.highRiskCount) + " high-risk items and " + formatWholeNumber(metrics && metrics.atRiskUnits) + " units exposed.",
      data: {
        topSupplyRisks: topRisk,
        atRiskUnits: toNum(metrics && metrics.atRiskUnits),
        highRiskCount: toNum(metrics && metrics.highRiskCount),
      },
    };
  }
  if (name === "batch_leverage") {
    return {
      tool: name,
      label: analystToolLabel(name),
      summary:
        (topBatch[0]
          ? ("Top repeated family is " + toText(topBatch[0].sku) + " across " + formatWholeNumber(topBatch[0].count) + " WOs and " + formatWholeNumber(topBatch[0].remainingUnits) + " remaining cases.")
          : "No strong repeated SKU family is currently open."),
      data: {
        topBatchGroups: topBatch,
        batchGroupCount: topBatch.length,
      },
    };
  }
  if (name === "throughput_pressure") {
    return {
      tool: name,
      label: analystToolLabel(name),
      summary:
        "This week is " + formatSignedPercent(metrics && metrics.weekDeltaPct) + " vs last week, with " +
        formatWholeNumber(metrics && metrics.evoconUnplannedMin) + " unplanned-stop minutes and " +
        formatWholeNumber(metrics && metrics.evoconSlowMin) + " slow-production minutes today.",
      data: {
        weekDeltaPct: toNum(metrics && metrics.weekDeltaPct),
        weekDeltaCases: toNum(metrics && metrics.weekDeltaCases),
        evoconUnplannedMin: toNum(metrics && metrics.evoconUnplannedMin),
        evoconSlowMin: toNum(metrics && metrics.evoconSlowMin),
      },
    };
  }
  if (name === "period_compare") {
    return {
      tool: name,
      label: analystToolLabel(name),
      summary:
        "This week produced " + formatWholeNumber(thisWeekAgg && thisWeekAgg.totalCases) + " cases vs " +
        formatWholeNumber(lastWeekAgg && lastWeekAgg.totalCases) + " last week. Largest line deltas are captured below.",
      data: {
        thisWeekCases: toNum(thisWeekAgg && thisWeekAgg.totalCases),
        lastWeekCases: toNum(lastWeekAgg && lastWeekAgg.totalCases),
        lineDeltas: buildLineDeltaRows(thisWeekAgg, lastWeekAgg),
      },
    };
  }
  if (name === "owner_action_board") {
    var byOwner = {};
    topRecommendations.forEach(function(row) {
      var owner = toText(row && row.owner) || "Unassigned";
      if (!byOwner[owner]) byOwner[owner] = [];
      byOwner[owner].push({
        action: toText(row && row.action),
        why: toText(row && row.why),
        priority: toText(row && row.priority),
        impactUnits: toNum(row && row.impactUnits),
      });
    });
    return {
      tool: name,
      label: analystToolLabel(name),
      summary: "Recommendation board is led by " + Object.keys(byOwner).length + " owner groups.",
      data: byOwner,
    };
  }
  if (name === "data_confidence") {
    return {
      tool: name,
      label: analystToolLabel(name),
      summary:
        (staleFeeds.length
          ? (staleFeeds.length + " feeds are not fresh; most important: " + staleFeeds.map(function(feed) { return toText(feed && feed.label); }).join(", ") + ".")
          : "Core feeds are fresh enough for operating decisions right now."),
      data: {
        staleFeeds: staleFeeds,
        dataHealth: takeTop(metrics && metrics.dataHealth, 8),
        snapshotSyncedAt: toText(factPack && factPack.snapshotSyncedAt),
      },
    };
  }
  if (name === "scenario_lab") {
    var scenarios = [];
    if (topRisk[0]) {
      scenarios.push({
        scenario: "Resolve top shortage " + toText(topRisk[0].sku),
        likelyImpact: formatWholeNumber(Math.max(toNum(topRisk[0].shortQty), toNum(topRisk[0].unitsAtRisk))) + " units of current exposure become more recoverable.",
        confidence: "Medium"
      });
    }
    if (topBatch[0]) {
      scenarios.push({
        scenario: "Run repeated family " + toText(topBatch[0].sku),
        likelyImpact: "Potentially execute " + formatWholeNumber(topBatch[0].count) + " related WOs with fewer changeovers.",
        confidence: "Medium"
      });
    }
    scenarios.push({
      scenario: "Recover throughput loss",
      likelyImpact: "Improves the odds of closing the current pace gap, but exact recovered cases need line-rate context.",
      confidence: "Low"
    });
    return {
      tool: name,
      label: analystToolLabel(name),
      summary: "Scenario lab generated " + scenarios.length + " directional scenarios from current queue, risk, and throughput signals.",
      data: scenarios,
    };
  }
  return {
    tool: name,
    label: analystToolLabel(name),
    summary: "No evidence returned.",
    data: {},
  };
}

function executeAnalystTools(plan, context) {
  var requested = Array.isArray(plan && plan.toolRequests) ? plan.toolRequests : [];
  var seen = {};
  return requested.map(function(item) {
    var tool = toText(item && item.tool).toLowerCase();
    if (!tool || seen[tool]) return null;
    seen[tool] = true;
    var result = executeAnalystTool(tool, context);
    result.reason = toText(item && item.reason);
    return result;
  }).filter(Boolean);
}

async function runAnalystLoop(providerConfig, options) {
  var plan = await planAnalystWorkflow(providerConfig, {
    mode: options && options.mode,
    prompt: options && options.prompt,
    factPack: options && options.factPack,
  });
  var toolResults = executeAnalystTools(plan, options);
  var historyText = Array.isArray(options && options.history)
    ? options.history.map(function(msg) {
      var role = msg && msg.role === "assistant" ? "assistant" : "user";
      var text = toText(msg && msg.text);
      return text ? (role + ": " + text) : "";
    }).filter(Boolean).join("\n")
    : "";
  var evidenceDigest = toolResults.map(function(result) {
    return "- " + result.label + ": " + result.summary;
  }).join("\n");
  var synthesisSystem = [
    "You are PackPulse AI copilot for factory operations.",
    "You are acting as an operations analyst, not a generic chatbot.",
    "Use the analyst plan and evidence to interpret the data before recommending action.",
    "Do not reveal hidden chain-of-thought or step-by-step private reasoning.",
    "Clearly distinguish facts from scenarios or hypotheses.",
    "Use provided numbers exactly when they are available.",
    buildCopilotModeInstruction(options && options.mode),
  ].join(" ");
  var synthesisMessages = [{
    role: "user",
    content: [
      "User question: " + toText(options && options.prompt),
      "Requested mode: " + toText(options && options.mode || "diagnose"),
      (historyText ? ("Recent chat history:\n" + historyText) : ""),
      "Planner source: " + toText(plan && plan.plannerSource || "fallback"),
      "Goal: " + toText(plan && plan.goal),
      "Hypotheses:\n- " + (Array.isArray(plan && plan.hypotheses) ? plan.hypotheses.join("\n- ") : ""),
      "Evidence digest:\n" + evidenceDigest,
      "Evidence JSON: " + JSON.stringify(toolResults),
      "Compact fact pack JSON: " + JSON.stringify(options && options.factPack ? options.factPack : {}),
    ].join("\n\n")
  }];
  var synthesis = await callAiText(providerConfig, {
    system: synthesisSystem,
    messages: synthesisMessages,
    temperature: 0.25,
    maxTokens: 1500,
  });
  return {
    answer: toText(synthesis && synthesis.text),
    model: toText(synthesis && synthesis.model) || toText(providerConfig && providerConfig.model),
    provider: toText(providerConfig && providerConfig.provider),
    plan: plan,
    toolResults: toolResults,
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

    var providerConfig = resolveAiProviderConfig();
    if (!providerConfig) {
      if (deterministicCopilotAnswer) {
        return sendAnswer(res, deterministicCopilotAnswer, {
          model: "deterministic",
          provider: "deterministic",
          mode: copilotMode || "chat",
          sourceLabel: "PackPulse metrics",
          dataTimestamp: responseDataTimestamp,
          deterministic: true,
          followUps: followUpsForMode(copilotMode, activeView),
        });
      }
      return res.status(500).json({ error: "No AI provider is configured. Set OPENAI_API_KEY or ANTHROPIC_API_KEY." });
    }

    try {
      var analystResult = await runAnalystLoop(providerConfig, {
        mode: copilotMode || "diagnose",
        prompt: prompt,
        history: history,
        metrics: metrics,
        factPack: copilotFactPack,
        lastWeekAgg: lastWeekAgg,
        thisWeekAgg: thisWeekAgg,
        dataTimestamp: responseDataTimestamp,
      });
      var answer = toText(analystResult && analystResult.answer);
      if (!answer && deterministicCopilotAnswer) answer = deterministicCopilotAnswer;
      if (!answer) answer = "No AI response was returned.";

      return sendAnswer(res, answer, {
        model: toText(analystResult && analystResult.model) || toText(providerConfig && providerConfig.model),
        provider: providerLabel(analystResult && analystResult.provider),
        mode: copilotMode || "diagnose",
        sourceLabel: "Analyst loop: evidence-backed interpretation",
        dataTimestamp: responseDataTimestamp,
        deterministic: false,
        toolsUsed: Array.isArray(analystResult && analystResult.toolResults)
          ? analystResult.toolResults.map(function(item) { return analystToolLabel(item && item.tool); })
          : [],
        analysisSummary: analystResult && analystResult.plan ? toText(analystResult.plan.goal) : "",
        plannerSource: analystResult && analystResult.plan ? toText(analystResult.plan.plannerSource) : "",
        followUps: followUpsForMode(copilotMode, activeView),
      });
    } catch (aiErr) {
      if (deterministicCopilotAnswer) {
        return sendAnswer(res, deterministicCopilotAnswer, {
          model: "deterministic",
          provider: "deterministic",
          mode: copilotMode || "chat",
          sourceLabel: "PackPulse metrics fallback",
          dataTimestamp: responseDataTimestamp,
          deterministic: true,
          analysisSummary: "The external model call failed, so the copilot used deterministic PackPulse logic instead.",
          followUps: followUpsForMode(copilotMode, activeView),
        });
      }
      return res.status(500).json({
        error: "AI analyst loop failed",
        details: aiErr && aiErr.message ? aiErr.message : "unknown",
      });
    }
  } catch (err) {
    Sentry.captureException(err);
    return res.status(500).json({
      error: "Could not process AI request",
      details: err && err.message ? err.message : "unknown",
    });
  }
}
