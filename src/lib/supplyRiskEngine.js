import { normalizeStr, safeNum } from "../utils.js";

function normalizePoKey(value) {
  var s = (value || "").toString().trim();
  if (!s) return "";
  s = s.replace(/\.0+$/, "");
  s = s.replace(/[^a-zA-Z0-9]/g, "");
  return normalizeStr(s);
}

function buildSkuMatchKeys(value) {
  var raw = (value || "").toString().trim();
  if (!raw) return [];
  var noDecimal = raw.replace(/\.0+$/, "");
  var norm = normalizeStr(noDecimal);
  if (!norm) return [];
  var keys = [norm];
  var stripped = norm.replace(/^0+/, "");
  if (stripped && stripped !== norm) keys.push(stripped);
  return Array.from(new Set(keys));
}

function firstValue(row, keys) {
  if (!row) return "";
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    if (Object.prototype.hasOwnProperty.call(row, key) && row[key] != null && row[key] !== "") return row[key];
  }
  return "";
}

function firstValueLoose(row, keys) {
  var direct = firstValue(row, keys);
  if (direct) return direct;
  if (!row || !keys || !keys.length) return "";
  var wanted = {};
  keys.forEach(function(key) { wanted[normalizeStr(key)] = true; });
  var rowKeys = Object.keys(row);
  for (var i = 0; i < rowKeys.length; i++) {
    var rowKey = rowKeys[i];
    if (!wanted[normalizeStr(rowKey)]) continue;
    var value = row[rowKey];
    if (value != null && value !== "") return value;
  }
  return "";
}

function pickInboundDateValue(row) {
  return firstValueLoose(row, [
    "Delivery Date",
    "Expected delivery date",
    "Receive Order Item expected delivery date",
    "RO Date",
    "Expected ship date",
    "Actual ship date",
    "Req Dely"
  ]);
}

function parseInboundDateValue(row) {
  var raw = pickInboundDateValue(row);
  if (!raw) return null;
  var d = raw instanceof Date ? raw : new Date(raw);
  return isNaN(d) ? null : d;
}

function toIsoDate(value) {
  if (!value) return "";
  var d = value instanceof Date ? value : new Date(value);
  if (isNaN(d)) return "";
  return d.toISOString().slice(0, 10);
}

function normalizeDateOnly(value) {
  if (!value) return null;
  var d = value instanceof Date ? new Date(value) : new Date(value);
  if (isNaN(d)) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}

function isWorkOrderClosed(wo) {
  var status = normalizeStr(wo && wo.status ? wo.status : "");
  if (status && (
    status.includes("closed") ||
    status.includes("complete") ||
    status.includes("completed") ||
    status.includes("done") ||
    status.includes("cancelled") ||
    status.includes("canceled") ||
    status.includes("archived")
  )) return true;
  return safeNum(wo && wo.unitsRemaining) <= 0;
}

function isReceiveOrderInboundRow(row) {
  var source = firstValueLoose(row, ["__inboundSource", "Inbound Source", "Source"]);
  if (normalizeStr(source).includes("receiveorders")) return true;
  var keys = Object.keys(row || {});
  for (var i = 0; i < keys.length; i++) {
    if (normalizeStr(keys[i]).includes("receiveorder")) return true;
  }
  return false;
}

function isClosedReceiveOrderInboundRow(row) {
  if (!isReceiveOrderInboundRow(row)) return false;
  var received = normalizeStr(firstValueLoose(row, ["Received", "Receive Order received"]));
  return received === "yes" || received === "true" || received === "1";
}

function pushToken(out, seen, value, kind) {
  var token = normalizePoKey(value);
  if (!token || seen[token]) return;
  seen[token] = true;
  out.push({ token: token, kind: kind || "reference" });
}

function collectReferenceTokens(row, explicitPairs) {
  var out = [];
  var seen = {};
  (explicitPairs || []).forEach(function(pair) {
    if (!pair) return;
    pushToken(out, seen, pair.value, pair.kind);
  });
  Object.keys(row || {}).forEach(function(key) {
    var normalized = normalizeStr(key);
    if (!(normalized.includes("po") || normalized.includes("purchase") || normalized.includes("reference") || normalized.includes("ref") || normalized.includes("bol") || normalized.includes("document") || normalized.includes("order") || normalized.includes("confirm"))) return;
    pushToken(out, seen, row[key], normalized.includes("po") ? "po" : normalized.includes("confirm") ? "confirmation" : "reference");
  });
  return out;
}

function isInboundDockRow(row) {
  if (!row) return false;
  var keys = Object.keys(row || {});
  var values = [
    keys.find(function(key) { return normalizeStr(key).includes("dock"); }),
    keys.find(function(key) { return normalizeStr(key).includes("loadtype"); }),
    keys.find(function(key) { return normalizeStr(key).includes("direction"); }),
    keys.find(function(key) { return normalizeStr(key).includes("type"); })
  ].filter(Boolean).map(function(key) {
    return normalizeStr(row[key] || "");
  }).join(" ");
  if (!values) return true;
  if (values.includes("outbound") || values.includes("shipping")) return false;
  if (values.includes("inbound") || values.includes("receiv")) return true;
  return true;
}

function isScheduledDockStatus(status) {
  return normalizeStr(status || "").includes("scheduled");
}

function buildMaterialLinkMap(analysis) {
  var linkMap = {};
  if (!analysis || !Array.isArray(analysis.results)) return linkMap;
  var addLink = function(skuRaw, payload) {
    buildSkuMatchKeys(skuRaw).forEach(function(key) {
      if (!linkMap[key]) linkMap[key] = [];
      linkMap[key].push(payload);
    });
  };
  analysis.results.forEach(function(wo) {
    if (isWorkOrderClosed(wo)) return;
    (wo.components || []).forEach(function(component) {
      if (safeNum(component && component.short) <= 0) return;
      var payload = {
        woNum: wo.woNum,
        productSku: wo.productSkuRaw,
        productDesc: wo.productDesc || "",
        dueDate: wo.dueDate || "",
        needed: safeNum(component && component.needed),
        short: safeNum(component && component.short),
        qtyToProduce: safeNum(wo.qtyToProduce),
        unitsRemaining: safeNum(wo.unitsRemaining),
        customer: wo.customer || "",
        status: wo.status || "",
        isOpen: true
      };
      addLink(component.sku, payload);
      (component.optionDetails || []).forEach(function(option) {
        addLink(option && option.sku, payload);
      });
    });
  });
  return linkMap;
}

function resolveMaterialLinks(linkMap, skuKeys) {
  var keys = Array.isArray(skuKeys) ? skuKeys : buildSkuMatchKeys(skuKeys);
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    if (linkMap[key] && linkMap[key].length) {
      return {
        skuKey: key,
        links: linkMap[key],
        via: i === 0 ? "exact" : "leading-zero"
      };
    }
  }
  return {
    skuKey: keys[0] || "",
    links: [],
    via: "none"
  };
}

function buildCriticalItemsFallback(analysis) {
  if (!analysis || !Array.isArray(analysis.results)) return [];
  var bySku = {};
  analysis.results.forEach(function(wo) {
    if (isWorkOrderClosed(wo)) return;
    (wo.components || []).forEach(function(component) {
      if (safeNum(component && component.short) <= 0) return;
      var key = normalizeStr(component.sku);
      if (!bySku[key]) {
        bySku[key] = {
          sku: component.sku,
          desc: component.desc || "",
          totalShort: 0,
          onHand: safeNum(component && component.onHand),
          unlockedUnits: 0,
          affectedWOs: [],
          customersMap: {}
        };
      }
      bySku[key].totalShort += safeNum(component && component.short);
      bySku[key].unlockedUnits += Math.max(0, safeNum(wo.unitsRemaining) - safeNum(wo.maxRunnable));
      bySku[key].affectedWOs.push({
        woNum: wo.woNum,
        productSku: wo.productSkuRaw,
        productDesc: wo.productDesc || "",
        customer: wo.customer || "",
        qtyToProduce: safeNum(wo.qtyToProduce),
        unitsRemaining: safeNum(wo.unitsRemaining),
        needed: safeNum(component && component.needed),
        short: safeNum(component && component.short),
        dueDate: wo.dueDate || ""
      });
      if (wo.customer) bySku[key].customersMap[wo.customer] = true;
    });
  });
  return Object.values(bySku).map(function(item) {
    var customers = Object.keys(item.customersMap || {});
    return {
      sku: item.sku,
      desc: item.desc || "",
      totalShort: item.totalShort,
      onHand: item.onHand,
      unlockedUnits: item.unlockedUnits,
      affectedWOs: item.affectedWOs,
      customers: customers,
      customerLabel: customers.length ? customers.join(", ") : "--"
    };
  });
}

function normalizeInboundLines(edrData, windowStart, windowEnd) {
  var rows = Array.isArray(edrData) ? edrData : [];
  var lines = [];
  rows.forEach(function(row, index) {
    if (isClosedReceiveOrderInboundRow(row)) return;
    var sku = String(firstValueLoose(row, ["Material", "Item Code", "SKU"]) || "").trim();
    var skuKeys = buildSkuMatchKeys(sku);
    if (!skuKeys.length) return;
    var qtyOpen = safeNum(firstValueLoose(row, ["Still to be delivered", "Open Qty", "still_to_be_delivered", "openqty"]));
    var qtyOrd = safeNum(firstValueLoose(row, ["Order Quantity", "Expected unit quantity", "Expected Quantity", "Actual unit quantity", "Quantity"]));
    var qty = qtyOpen > 0 ? qtyOpen : qtyOrd;
    if (qty <= 0) return;
    var dateObj = parseInboundDateValue(row);
    var hasDate = !!dateObj;
    var isReceiveOrder = isReceiveOrderInboundRow(row);
    if (hasDate) {
      dateObj = normalizeDateOnly(dateObj);
      if (dateObj < windowStart || dateObj > windowEnd) return;
    } else if (!isReceiveOrder) {
      return;
    }
    var po = String(firstValueLoose(row, ["PO Number", "Receive Order Code", "Receive Order", "Purchasing Document", "Purchase Order Number"]) || "").trim();
    var reference = String(firstValueLoose(row, ["Reference"]) || "").trim();
    lines.push({
      id: "inbound-" + index,
      row: row,
      sku: sku,
      skuKeys: skuKeys,
      desc: String(firstValueLoose(row, ["Description", "Item Description", "Material Description", "Short Text", "Mat Desc"]) || "").trim(),
      qty: qty,
      po: po,
      poKey: normalizePoKey(po),
      reference: reference,
      dateObj: dateObj,
      date: hasDate && dateObj ? dateObj.toISOString().slice(0, 10) : "",
      hasDate: hasDate,
      isReceiveOrder: isReceiveOrder,
      tokens: collectReferenceTokens(row, [{ value: po, kind: "po" }, { value: reference, kind: "reference" }]),
      matchKind: "none",
      matchScore: 0,
      matchedAppointmentId: "",
      dockStatus: "",
      dockScheduledDate: "",
      confirmation: ""
    });
  });
  return lines;
}

function normalizeAppointments(dockData) {
  var rows = Array.isArray(dockData) ? dockData : [];
  return rows.reduce(function(out, row, index) {
    if (!isInboundDockRow(row)) return out;
    var scheduledDate = normalizeDateOnly(firstValueLoose(row, ["Appt Date", "Appointment Date", "Date", "Scheduled Date"]));
    var po = String(firstValueLoose(row, ["PO", "PO Number", "Reference", "Purchase Order"]) || "").trim();
    var confirmation = String(firstValueLoose(row, ["Confirmation", "Confirmation Number"]) || "").trim();
    var status = String(firstValueLoose(row, ["Status"]) || "").trim();
    if (!scheduledDate && !po && !confirmation && !status) return out;
    var appointment = {
      id: "dock-" + index,
      row: row,
      scheduledDate: scheduledDate ? scheduledDate.toISOString().slice(0, 10) : "",
      scheduledDateObj: scheduledDate,
      po: po,
      poKey: normalizePoKey(po),
      confirmation: confirmation,
      confirmationKey: normalizePoKey(confirmation),
      status: status,
      tokens: collectReferenceTokens(row, [{ value: po, kind: "po" }, { value: confirmation, kind: "confirmation" }])
    };
    out.push(appointment);
    return out;
  }, []);
}

function matchInboundLinesToAppointments(lines, appointments) {
  var appointmentsByToken = {};
  appointments.forEach(function(appointment) {
    appointment.tokens.forEach(function(token) {
      if (!appointmentsByToken[token.token]) appointmentsByToken[token.token] = [];
      appointmentsByToken[token.token].push({ appointment: appointment, kind: token.kind });
    });
  });

  var matchedAppointmentIds = {};
  lines.forEach(function(line) {
    var candidatesById = {};
    line.tokens.forEach(function(token) {
      (appointmentsByToken[token.token] || []).forEach(function(hit) {
        var baseScore = token.kind === "po" ? 100 : token.kind === "confirmation" ? 95 : 70;
        if (!candidatesById[hit.appointment.id] || candidatesById[hit.appointment.id].score < baseScore) {
          candidatesById[hit.appointment.id] = {
            appointment: hit.appointment,
            kind: token.kind,
            score: baseScore
          };
        }
      });
    });

    var best = null;
    Object.values(candidatesById).forEach(function(candidate) {
      var score = candidate.score || 0;
      if (line.dateObj && candidate.appointment && candidate.appointment.scheduledDateObj) {
        var diffDays = Math.abs(Math.round((line.dateObj.getTime() - candidate.appointment.scheduledDateObj.getTime()) / 86400000));
        if (diffDays === 0) score += 20;
        else if (diffDays === 1) score += 10;
      }
      if (!best || score > best.score) {
        best = {
          appointment: candidate.appointment,
          kind: candidate.kind,
          score: score
        };
      }
    });

    if (!best || best.score < 80) return;
    line.matchKind = best.kind;
    line.matchScore = best.score;
    line.matchedAppointmentId = best.appointment.id;
    line.dockStatus = best.appointment.status || "";
    line.dockScheduledDate = best.appointment.scheduledDate || "";
    line.confirmation = best.appointment.confirmation || "";
    matchedAppointmentIds[best.appointment.id] = true;
  });

  return { lines: lines, matchedAppointmentIds: matchedAppointmentIds };
}

function chooseRiskLevel(status, dueBeforeScheduled, dueWithin48h) {
  if (status === "missing" || dueBeforeScheduled) return "high";
  if (status === "unscheduled" || status === "partial" || dueWithin48h) return "medium";
  return "low";
}

function chooseRecommendedAction(status, dueBeforeScheduled) {
  if (dueBeforeScheduled) return "Resequence WO / Expedite";
  if (status === "missing") return "Create / Expedite PO";
  if (status === "unscheduled") return "Schedule OpenDock";
  if (status === "partial") return "Expedite Balance";
  return "Monitor";
}

function buildInboundCoverage(criticalItems, inboundLines) {
  if (!Array.isArray(criticalItems) || !criticalItems.length) return null;

  var inboundBySku = {};
  inboundLines.forEach(function(line) {
    line.skuKeys.forEach(function(key) {
      if (!inboundBySku[key]) inboundBySku[key] = [];
      inboundBySku[key].push(line);
    });
  });

  var now = new Date();
  var rows = criticalItems.map(function(item) {
    var inboundRows = [];
    buildSkuMatchKeys(item && item.sku).forEach(function(key) {
      inboundRows = inboundRows.concat(inboundBySku[key] || []);
    });
    if (inboundRows.length > 1) {
      var seen = {};
      inboundRows = inboundRows.filter(function(line) {
        if (seen[line.id]) return false;
        seen[line.id] = true;
        return true;
      });
    }

    var shortQty = Math.max(0, safeNum(item && item.totalShort));
    var inboundQty = inboundRows.reduce(function(sum, line) { return sum + safeNum(line.qty); }, 0);
    var scheduledRows = inboundRows.filter(function(line) { return isScheduledDockStatus(line.dockStatus) && !!line.matchedAppointmentId; });
    var scheduledQty = scheduledRows.reduce(function(sum, line) { return sum + safeNum(line.qty); }, 0);
    var unscheduledQty = Math.max(0, inboundQty - scheduledQty);
    var uncoveredQty = Math.max(0, shortQty - scheduledQty);
    var coveragePct = shortQty > 0 ? Math.min(100, Math.round((inboundQty / shortQty) * 100)) : 100;
    var scheduledCoveragePct = shortQty > 0 ? Math.min(100, Math.round((scheduledQty / shortQty) * 100)) : 100;

    var earliestInboundDate = inboundRows
      .map(function(line) { return line.date || line.dockScheduledDate || ""; })
      .filter(Boolean)
      .sort()[0] || "";
    var earliestScheduledDate = scheduledRows
      .map(function(line) { return line.dockScheduledDate || line.date || ""; })
      .filter(Boolean)
      .sort()[0] || "";

    var earliestDue = "";
    var dueDates = (item && item.affectedWOs ? item.affectedWOs : [])
      .map(function(wo) {
        var due = normalizeDateOnly(wo && wo.dueDate);
        return due ? due.toISOString().slice(0, 10) : "";
      })
      .filter(Boolean)
      .sort();
    if (dueDates.length) earliestDue = dueDates[0];

    var dueWithin48h = false;
    var dueBeforeScheduled = false;
    if (earliestDue) {
      var dueDate = new Date(earliestDue + "T00:00:00");
      dueWithin48h = dueDate.getTime() - now.getTime() <= 48 * 3600000;
      if (earliestScheduledDate) dueBeforeScheduled = dueDate < new Date(earliestScheduledDate + "T00:00:00");
      else if (shortQty > 0) dueBeforeScheduled = true;
    }

    var status = "covered";
    if (scheduledQty <= 0 && inboundQty <= 0) status = "missing";
    else if (scheduledQty <= 0 && inboundQty > 0) status = "unscheduled";
    else if (scheduledQty < shortQty) status = "partial";

    var openPOs = Array.from(new Set(inboundRows.map(function(line) { return line.po; }).filter(Boolean)));
    var scheduledPOs = Array.from(new Set(scheduledRows.map(function(line) { return line.po; }).filter(Boolean)));
    var dockStatuses = Array.from(new Set(scheduledRows.map(function(line) { return line.dockStatus; }).filter(Boolean)));

    return {
      sku: item && item.sku ? item.sku : "",
      desc: item && item.desc ? item.desc : "",
      customerLabel: item && item.customerLabel ? item.customerLabel : "--",
      shortQty: shortQty,
      affectedWOCount: item && item.affectedWOs ? item.affectedWOs.length : 0,
      earliestDueDate: earliestDue,
      earliestInboundDate: earliestInboundDate,
      earliestScheduledDate: earliestScheduledDate,
      inboundQty: inboundQty,
      scheduledQty: scheduledQty,
      unscheduledQty: unscheduledQty,
      uncoveredQty: uncoveredQty,
      coveragePct: coveragePct,
      scheduledCoveragePct: scheduledCoveragePct,
      dueBeforeScheduled: dueBeforeScheduled,
      dueWithin48h: dueWithin48h,
      status: status,
      riskLevel: chooseRiskLevel(status, dueBeforeScheduled, dueWithin48h),
      dockStatuses: dockStatuses,
      openPOs: openPOs,
      scheduledPOs: scheduledPOs,
      recommendedAction: chooseRecommendedAction(status, dueBeforeScheduled)
    };
  }).sort(function(a, b) {
    var riskRank = { high: 0, medium: 1, low: 2 };
    var statusRank = { missing: 0, unscheduled: 1, partial: 2, covered: 3 };
    if (a.riskLevel !== b.riskLevel) return riskRank[a.riskLevel] - riskRank[b.riskLevel];
    if (a.status !== b.status) return statusRank[a.status] - statusRank[b.status];
    return b.shortQty - a.shortQty;
  });

  return {
    summary: {
      totalCriticalItems: rows.length,
      covered: rows.filter(function(row) { return row.status === "covered"; }).length,
      partial: rows.filter(function(row) { return row.status === "partial"; }).length,
      unscheduled: rows.filter(function(row) { return row.status === "unscheduled"; }).length,
      missing: rows.filter(function(row) { return row.status === "missing"; }).length,
      atRisk: rows.filter(function(row) { return row.riskLevel !== "low"; }).length,
      dueSoon: rows.filter(function(row) { return row.dueWithin48h; }).length,
      totalShortQty: rows.reduce(function(sum, row) { return sum + safeNum(row.shortQty); }, 0),
      totalUncoveredQty: rows.reduce(function(sum, row) { return sum + safeNum(row.uncoveredQty); }, 0),
      totalInboundQty: rows.reduce(function(sum, row) { return sum + safeNum(row.inboundQty); }, 0),
      totalScheduledQty: rows.reduce(function(sum, row) { return sum + safeNum(row.scheduledQty); }, 0)
    },
    rows: rows
  };
}

function compareIsoDates(a, b) {
  return String(a || "9999-12-31").localeCompare(String(b || "9999-12-31"));
}

function laterIsoDate(a, b) {
  if (!a) return b || "";
  if (!b) return a || "";
  return a > b ? a : b;
}

function pickLineAvailabilityDate(line) {
  if (!line) return "";
  return laterIsoDate(line.date || "", line.dockScheduledDate || "");
}

function buildUnlockTimeline(analysis, inboundLines, todayIso) {
  if (!analysis || !Array.isArray(analysis.results)) {
    return {
      summary: {
        totalBlockedWorkOrders: 0,
        materialBlockedSkus: 0,
        runnableNow: 0,
        unlocking7d: 0,
        unlocking14d: 0,
        inboundNoDate: 0,
        partial: 0,
        stillBlocked: 0,
        blockedUnits: 0,
        unitsUnlocking14d: 0
      },
      dateBuckets: [],
      rows: []
    };
  }

  var inboundEvents = (Array.isArray(inboundLines) ? inboundLines : []).map(function(line, index) {
    var qty = safeNum(line && line.qty);
    return {
      id: line && line.id ? line.id : ("unlock-event-" + index),
      skuKeys: Array.isArray(line && line.skuKeys) && line.skuKeys.length ? line.skuKeys : buildSkuMatchKeys(line && line.sku),
      qty: qty,
      remainingQty: qty,
      availabilityDate: pickLineAvailabilityDate(line),
      po: line && line.po ? line.po : "",
      confirmation: line && line.confirmation ? line.confirmation : "",
      expectedDate: line && line.date ? line.date : "",
      scheduledDate: line && line.dockScheduledDate ? line.dockScheduledDate : "",
      dockStatus: line && line.dockStatus ? line.dockStatus : "",
      isMatched: !!(line && line.matchedAppointmentId)
    };
  }).filter(function(event) {
    return event.qty > 0 && Array.isArray(event.skuKeys) && event.skuKeys.length;
  });

  var eventsBySkuKey = {};
  inboundEvents.forEach(function(event) {
    event.skuKeys.forEach(function(key) {
      if (!eventsBySkuKey[key]) eventsBySkuKey[key] = [];
      eventsBySkuKey[key].push(event);
    });
  });

  var sortedWorkOrders = analysis.results.filter(function(wo) {
    if (isWorkOrderClosed(wo)) return false;
    if (safeNum(wo && wo.unitsRemaining) <= 0) return false;
    return Array.isArray(wo && wo.components) && wo.components.some(function(component) {
      return safeNum(component && component.short) > 0;
    });
  }).sort(function(a, b) {
    var dueCompare = compareIsoDates(a && a.dueDate ? a.dueDate : "", b && b.dueDate ? b.dueDate : "");
    if (dueCompare !== 0) return dueCompare;
    return String(a && a.woNum ? a.woNum : "").localeCompare(String(b && b.woNum ? b.woNum : ""));
  });

  var rows = sortedWorkOrders.map(function(wo) {
    var blockedUnits = Math.max(0, safeNum(wo.unitsRemaining) - safeNum(wo.maxRunnable));
    var shortageComponents = (wo.components || []).filter(function(component) {
      return safeNum(component && component.short) > 0;
    });

    var componentRows = shortageComponents.map(function(component) {
      var matchKeys = {};
      buildSkuMatchKeys(component && component.sku).forEach(function(key) { matchKeys[key] = true; });
      (component && Array.isArray(component.optionDetails) ? component.optionDetails : []).forEach(function(option) {
        buildSkuMatchKeys(option && option.sku).forEach(function(key) { matchKeys[key] = true; });
      });

      var seenEvents = {};
      var candidateEvents = [];
      Object.keys(matchKeys).forEach(function(key) {
        (eventsBySkuKey[key] || []).forEach(function(event) {
          if (seenEvents[event.id]) return;
          seenEvents[event.id] = true;
          candidateEvents.push(event);
        });
      });

      candidateEvents.sort(function(a, b) {
        var dateCompare = compareIsoDates(a.availabilityDate, b.availabilityDate);
        if (dateCompare !== 0) return dateCompare;
        return String(a.po || "").localeCompare(String(b.po || ""));
      });

      var neededQty = Math.max(0, safeNum(component && component.short));
      var coveredQty = 0;
      var lastCoveredDate = "";
      var firstInboundDate = "";
      var usedUndated = false;
      var allocations = [];

      candidateEvents.forEach(function(event) {
        if (coveredQty >= neededQty || !(event.remainingQty > 0)) return;
        var takeQty = Math.min(event.remainingQty, neededQty - coveredQty);
        if (!(takeQty > 0)) return;
        event.remainingQty -= takeQty;
        coveredQty += takeQty;
        if (event.availabilityDate) {
          if (!firstInboundDate || event.availabilityDate < firstInboundDate) firstInboundDate = event.availabilityDate;
          lastCoveredDate = event.availabilityDate;
        } else {
          usedUndated = true;
        }
        allocations.push({
          qty: takeQty,
          availabilityDate: event.availabilityDate,
          po: event.po,
          confirmation: event.confirmation,
          expectedDate: event.expectedDate,
          scheduledDate: event.scheduledDate,
          dockStatus: event.dockStatus,
          isMatched: event.isMatched
        });
      });

      var fullyCovered = coveredQty + 0.0001 >= neededQty;
      var unlockDate = fullyCovered && !usedUndated ? lastCoveredDate : "";
      var coveragePct = neededQty > 0 ? Math.min(100, Math.round((coveredQty / neededQty) * 100)) : 100;
      var state = fullyCovered ? (unlockDate ? "unlock-by-date" : "inbound-no-date") : (coveredQty > 0 ? "partial" : "still-blocked");
      var optionSkus = Array.from(new Set((component && Array.isArray(component.optionDetails) ? component.optionDetails : []).map(function(option) {
        return String(option && option.sku || "").trim();
      }).filter(Boolean)));

      return {
        sku: component && component.sku ? component.sku : "",
        desc: component && component.desc ? component.desc : "",
        neededQty: neededQty,
        coveredQty: Math.round(coveredQty),
        coveragePct: coveragePct,
        unlockDate: unlockDate,
        firstInboundDate: firstInboundDate,
        state: state,
        optionSkus: optionSkus,
        allocations: allocations
      };
    });

    var anyCoverage = componentRows.some(function(component) { return component.coveredQty > 0; });
    var allCovered = componentRows.length > 0 && componentRows.every(function(component) {
      return component.state === "unlock-by-date" || component.state === "inbound-no-date";
    });
    var allCoveredWithDates = componentRows.length > 0 && componentRows.every(function(component) {
      return component.state === "unlock-by-date" && !!component.unlockDate;
    });
    var unlockDate = allCoveredWithDates
      ? componentRows.reduce(function(maxDate, component) { return laterIsoDate(maxDate, component.unlockDate); }, "")
      : "";
    var earliestInboundDate = componentRows
      .map(function(component) { return component.firstInboundDate; })
      .filter(Boolean)
      .sort()[0] || "";
    var sourcePOs = Array.from(new Set(componentRows.flatMap(function(component) {
      return component.allocations.map(function(allocation) { return allocation.po; }).filter(Boolean);
    })));
    var status = allCoveredWithDates
      ? "unlock-by-date"
      : allCovered
        ? "inbound-no-date"
        : anyCoverage
          ? "partial"
          : "still-blocked";

    return {
      woNum: wo.woNum,
      productSku: wo.productSkuRaw,
      productDesc: wo.productDesc || "",
      customer: wo.customer || "",
      dueDate: wo.dueDate || "",
      status: status,
      unlockDate: unlockDate,
      earliestInboundDate: earliestInboundDate,
      unitsRemaining: Math.round(safeNum(wo.unitsRemaining)),
      runnableNow: Math.round(safeNum(wo.maxRunnable)),
      blockedUnits: Math.round(blockedUnits),
      componentCount: componentRows.length,
      fullyCoveredComponents: componentRows.filter(function(component) {
        return component.state === "unlock-by-date" || component.state === "inbound-no-date";
      }).length,
      sourcePOs: sourcePOs,
      components: componentRows
    };
  }).sort(function(a, b) {
    var statusRank = {
      "unlock-by-date": 0,
      "inbound-no-date": 1,
      partial: 2,
      "still-blocked": 3
    };
    var dateCompare = compareIsoDates(a && a.unlockDate ? a.unlockDate : "", b && b.unlockDate ? b && b.unlockDate : "");
    if (dateCompare !== 0) return dateCompare;
    if ((statusRank[a.status] || 99) !== (statusRank[b.status] || 99)) {
      return (statusRank[a.status] || 99) - (statusRank[b.status] || 99);
    }
    var dueCompare = compareIsoDates(a && a.dueDate ? a.dueDate : "", b && b.dueDate ? b && b.dueDate : "");
    if (dueCompare !== 0) return dueCompare;
    return String(a && a.woNum ? a.woNum : "").localeCompare(String(b && b.woNum ? b && b.woNum : ""));
  });

  var plusDays = function(baseDate, days) {
    var d = new Date(baseDate + "T00:00:00");
    if (isNaN(d)) return "";
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  };
  var bucketMap = {};
  rows.forEach(function(row) {
    if (!row.unlockDate) return;
    if (!bucketMap[row.unlockDate]) {
      bucketMap[row.unlockDate] = {
        date: row.unlockDate,
        workOrders: 0,
        units: 0,
        skuMap: {}
      };
    }
    bucketMap[row.unlockDate].workOrders += 1;
    bucketMap[row.unlockDate].units += safeNum(row.blockedUnits);
    if (row.productSku) bucketMap[row.unlockDate].skuMap[row.productSku] = true;
  });
  var dateBuckets = Object.values(bucketMap).sort(function(a, b) {
    return compareIsoDates(a.date, b.date);
  }).map(function(bucket) {
    return {
      date: bucket.date,
      workOrders: bucket.workOrders,
      units: Math.round(bucket.units),
      skuCount: Object.keys(bucket.skuMap || {}).length
    };
  });

  var materialBlockedSkuMap = {};
  rows.forEach(function(row) {
    if (row.productSku) materialBlockedSkuMap[row.productSku] = true;
  });

  return {
    summary: {
      totalBlockedWorkOrders: rows.length,
      materialBlockedSkus: Object.keys(materialBlockedSkuMap).length,
      runnableNow: rows.filter(function(row) { return safeNum(row.runnableNow) > 0; }).length,
      unlocking7d: rows.filter(function(row) { return !!row.unlockDate && row.unlockDate <= plusDays(todayIso, 7); }).length,
      unlocking14d: rows.filter(function(row) { return !!row.unlockDate && row.unlockDate <= plusDays(todayIso, 14); }).length,
      inboundNoDate: rows.filter(function(row) { return row.status === "inbound-no-date"; }).length,
      partial: rows.filter(function(row) { return row.status === "partial"; }).length,
      stillBlocked: rows.filter(function(row) { return row.status === "still-blocked"; }).length,
      blockedUnits: Math.round(rows.reduce(function(sum, row) { return sum + safeNum(row.blockedUnits); }, 0)),
      unitsUnlocking14d: Math.round(rows.filter(function(row) { return !!row.unlockDate && row.unlockDate <= plusDays(todayIso, 14); }).reduce(function(sum, row) {
        return sum + safeNum(row.blockedUnits);
      }, 0))
    },
    dateBuckets: dateBuckets,
    rows: rows
  };
}

function buildLoadBoard(appointments, inboundLines, linkMap, todayIso, freshnessTimestamps) {
  var todayDate = new Date(todayIso + "T00:00:00");
  var loadsById = {};
  var appointmentsById = {};
  var matchedAppointmentIds = {};
  appointments.forEach(function(appointment) {
    appointmentsById[appointment.id] = appointment;
  });

  var byMaterial = {};
  var matchDiagnostics = {
    exactSkuMatched: 0,
    leadingZeroMatched: 0,
    unmatched: 0,
    matchedByPo: 0,
    matchedByReference: 0,
    matchedByConfirmation: 0
  };

  function createLoadSeed(loadKey, appointment, line) {
    return {
      key: loadKey,
      scheduledDate: appointment && appointment.scheduledDate ? appointment.scheduledDate : "",
      expectedDate: line && line.date ? line.date : (appointment && appointment.scheduledDate ? appointment.scheduledDate : ""),
      po: line && line.po ? line.po : (appointment && appointment.po ? appointment.po : ""),
      confirmation: appointment && appointment.confirmation ? appointment.confirmation : (line && line.confirmation ? line.confirmation : ""),
      status: appointment && appointment.status ? appointment.status : (line ? "Awaiting OpenDock" : ""),
      matchState: appointment ? "matched-fresh" : (line ? "receive-order-only" : "opendock-only"),
      isMatched: !!appointment,
      materialLineCount: 0,
      totalQty: 0,
      linkedWOCount: 0,
      unitsUnlocked: 0,
      materials: [],
      linkedWOKeys: {}
    };
  }

  function getLoadKey(line) {
    if (line && line.matchedAppointmentId) return line.matchedAppointmentId;
    if (line && line.poKey) return "receive-order:" + line.poKey;
    if (line && Array.isArray(line.tokens)) {
      var firstToken = line.tokens.find(function(token) {
        return token && token.token;
      });
      if (firstToken && firstToken.token) return "receive-order-token:" + firstToken.token;
    }
    return line && line.id ? line.id : ("load-" + Object.keys(loadsById).length);
  }

  function boardDate(load) {
    return String(load && (load.scheduledDate || load.expectedDate) || "");
  }

  inboundLines.forEach(function(line) {
    var resolved = resolveMaterialLinks(linkMap, line.skuKeys);
    if (resolved.via === "exact" && resolved.links.length) matchDiagnostics.exactSkuMatched += 1;
    else if (resolved.via === "leading-zero" && resolved.links.length) matchDiagnostics.leadingZeroMatched += 1;
    else if (!resolved.links.length) matchDiagnostics.unmatched += 1;

    if (line.matchKind === "po") matchDiagnostics.matchedByPo += 1;
    else if (line.matchKind === "reference") matchDiagnostics.matchedByReference += 1;
    else if (line.matchKind === "confirmation") matchDiagnostics.matchedByConfirmation += 1;

    var unitsUnlocked = Math.min(
      safeNum(line.qty),
      resolved.links.reduce(function(sum, link) { return sum + Math.max(0, safeNum(link.short)); }, 0)
    );
    var appointment = line.matchedAppointmentId ? appointmentsById[line.matchedAppointmentId] : null;
    var loadKey = getLoadKey(line);
    if (!loadsById[loadKey]) {
      loadsById[loadKey] = createLoadSeed(loadKey, appointment, line);
    }
    var load = loadsById[loadKey];

    if (appointment) {
      matchedAppointmentIds[appointment.id] = true;
      load.isMatched = true;
      load.matchState = "matched-fresh";
      if (!load.scheduledDate && appointment.scheduledDate) load.scheduledDate = appointment.scheduledDate;
      if (!load.confirmation && appointment.confirmation) load.confirmation = appointment.confirmation;
      if ((!load.status || load.status === "Awaiting OpenDock") && appointment.status) load.status = appointment.status;
    }
    if (line.date && (!load.expectedDate || line.date < load.expectedDate)) load.expectedDate = line.date;
    if (!load.po && line.po) load.po = line.po;

    var materialLine = {
      materialSku: line.sku || "Unknown",
      materialDesc: line.desc || "",
      qty: safeNum(line.qty),
      expectedDate: line.date || line.dockScheduledDate || "",
      matchState: appointment ? "matched-fresh" : "receive-order-only",
      linkedWOCount: resolved.links.length,
      unitsUnlocked: unitsUnlocked
    };

    if (!byMaterial[resolved.skuKey || normalizeStr(line.sku)]) {
      byMaterial[resolved.skuKey || normalizeStr(line.sku)] = {
        sku: line.sku,
        desc: line.desc || "",
        deliveries: [],
        affectedWOs: resolved.links
      };
    }
    byMaterial[resolved.skuKey || normalizeStr(line.sku)].deliveries.push({
      sku: line.sku,
      skuNorm: resolved.skuKey || normalizeStr(line.sku),
      desc: line.desc || "",
      date: line.date || line.dockScheduledDate || "",
      qty: safeNum(line.qty),
      po: line.po || "",
      confirmation: line.confirmation || "",
      dockStatus: line.dockStatus || "",
      dockApptDate: line.dockScheduledDate || "",
      isMatched: !!appointment,
      linkedWOCount: resolved.links.length,
      isAtRisk: resolved.links.length > 0
    });

    load.materialLineCount += 1;
    load.totalQty += safeNum(line.qty);
    resolved.links.forEach(function(link) {
      load.linkedWOKeys[link.woNum] = true;
    });
    load.unitsUnlocked += unitsUnlocked;
    load.materials.push(materialLine);
  });

  appointments.forEach(function(appointment) {
    if (matchedAppointmentIds[appointment.id]) return;
    if (!loadsById[appointment.id]) {
      loadsById[appointment.id] = createLoadSeed(appointment.id, appointment, null);
    }
  });

  var loads = Object.values(loadsById).map(function(load) {
    return {
      key: load.key,
      scheduledDate: load.scheduledDate,
      expectedDate: load.expectedDate,
      po: load.po,
      confirmation: load.confirmation,
      status: load.status,
      matchState: load.matchState,
      isMatched: load.isMatched,
      materialLineCount: load.materialLineCount,
      totalQty: Math.round(load.totalQty),
      linkedWOCount: Object.keys(load.linkedWOKeys || {}).length,
      unitsUnlocked: Math.round(load.unitsUnlocked),
      materials: load.materials
    };
  }).sort(function(a, b) {
    return String(boardDate(a) || "9999-12-31").localeCompare(String(boardDate(b) || "9999-12-31")) ||
      String(a.po || "").localeCompare(String(b.po || ""));
  });

  var allDeliveries = [];
  Object.keys(byMaterial).forEach(function(key) {
    allDeliveries = allDeliveries.concat(byMaterial[key].deliveries || []);
  });

  var lastInboundDate = allDeliveries.reduce(function(maxDate, delivery) {
    return delivery.date && (!maxDate || delivery.date > maxDate) ? delivery.date : maxDate;
  }, "");
  var lastDockDate = appointments.reduce(function(maxDate, appointment) {
    return appointment.scheduledDate && (!maxDate || appointment.scheduledDate > maxDate) ? appointment.scheduledDate : maxDate;
  }, "");
  var inboundSyncedAt = freshnessTimestamps && freshnessTimestamps.inboundSyncedAt ? new Date(freshnessTimestamps.inboundSyncedAt) : null;
  var dockSyncedAt = freshnessTimestamps && freshnessTimestamps.dockSyncedAt ? new Date(freshnessTimestamps.dockSyncedAt) : null;
  var toAgeDays = function(dateStr) {
    if (!dateStr) return null;
    var date = new Date(dateStr + "T00:00:00");
    if (isNaN(date)) return null;
    return Math.max(0, Math.floor((todayDate.getTime() - date.getTime()) / 86400000));
  };
  var toAgeDaysFromTimestamp = function(value) {
    if (!value) return null;
    var ts = value instanceof Date ? value : new Date(value);
    if (isNaN(ts)) return null;
    return Math.max(0, Math.floor((Date.now() - ts.getTime()) / 86400000));
  };
  var toFreshnessLevel = function(ageDays) {
    if (ageDays == null) return "missing";
    if (ageDays <= 2) return "fresh";
    if (ageDays <= 7) return "aging";
    return "stale";
  };
  var inboundAgeDays = toAgeDaysFromTimestamp(inboundSyncedAt) != null
    ? toAgeDaysFromTimestamp(inboundSyncedAt)
    : toAgeDays(lastInboundDate);
  var dockAgeDays = toAgeDaysFromTimestamp(dockSyncedAt) != null
    ? toAgeDaysFromTimestamp(dockSyncedAt)
    : toAgeDays(lastDockDate);
  var inboundLevel = toFreshnessLevel(inboundAgeDays);
  var matchedState = inboundLevel === "aging" ? "matched-aging" : inboundLevel === "stale" ? "matched-stale" : "matched-fresh";

  loads = loads.map(function(load) {
    if (!load.isMatched) return load;
    return Object.assign({}, load, {
      matchState: matchedState,
      materials: (load.materials || []).map(function(material) {
        return Object.assign({}, material, { matchState: matchedState });
      })
    });
  });

  var openWorkOrdersWaiting = {};
  Object.keys(linkMap || {}).forEach(function(key) {
    (linkMap[key] || []).forEach(function(link) {
      if (!link || !link.isOpen) return;
      if (!openWorkOrdersWaiting[link.woNum]) openWorkOrdersWaiting[link.woNum] = true;
    });
  });
  allDeliveries.forEach(function(delivery) {
    var resolved = resolveMaterialLinks(linkMap, buildSkuMatchKeys(delivery && delivery.sku));
    (resolved.links || []).forEach(function(link) {
      delete openWorkOrdersWaiting[link.woNum];
    });
  });

  return {
    timelineData: {
      today: todayIso,
      deliveries: allDeliveries,
      byMaterial: byMaterial,
      woTimelines: [],
      matchDiagnostics: matchDiagnostics
    },
    deliveriesV2: {
      todayBoard: {
        openDockAppointmentsToday: appointments.filter(function(appointment) { return appointment.scheduledDate === todayIso; }).length,
        edrLoadsToday: allDeliveries.filter(function(delivery) { return delivery.date === todayIso; }).length,
        matchedLoadsToday: loads.filter(function(load) { return boardDate(load) === todayIso && load.isMatched; }).length,
        unmatchedLoadsToday: loads.filter(function(load) { return boardDate(load) === todayIso && !load.isMatched; }).length,
        atRiskLoadsToday: loads.filter(function(load) { return boardDate(load) === todayIso && (load.linkedWOCount || 0) > 0; }).length,
        unitsPotentiallyUnlockedToday: Math.round(loads.filter(function(load) { return boardDate(load) === todayIso; }).reduce(function(sum, load) { return sum + safeNum(load.unitsUnlocked); }, 0))
      },
      summary: {
        totalLoads: loads.length,
        matchedLoads: loads.filter(function(load) { return load.isMatched; }).length,
        receiveOrderOnly: loads.filter(function(load) { return load.matchState === "receive-order-only"; }).length,
        openDockOnly: loads.filter(function(load) { return load.matchState === "opendock-only"; }).length,
        openDockScheduled: loads.length,
        materialResolved: loads.filter(function(load) { return load.isMatched; }).length,
        materialUnknown: loads.filter(function(load) { return load.matchState === "receive-order-only" || load.matchState === "opendock-only"; }).length,
        atRiskWOsWaiting: Object.keys(openWorkOrdersWaiting).length,
        unitsPotentiallyUnlocked: Math.round(loads.reduce(function(sum, load) { return sum + safeNum(load.unitsUnlocked); }, 0))
      },
      freshness: {
        edr: {
          lastDate: lastInboundDate,
          syncedAt: inboundSyncedAt && !isNaN(inboundSyncedAt) ? inboundSyncedAt.toISOString() : "",
          ageDays: inboundAgeDays,
          level: inboundLevel
        },
        openDock: {
          lastDate: lastDockDate,
          syncedAt: dockSyncedAt && !isNaN(dockSyncedAt) ? dockSyncedAt.toISOString() : "",
          ageDays: dockAgeDays,
          level: toFreshnessLevel(dockAgeDays)
        },
        confidence: {
          score: loads.length && inboundLines.length ? 90 : inboundLines.length ? 75 : 40,
          label: loads.length && inboundLines.length ? "High" : inboundLines.length ? "Medium" : "Low"
        }
      },
      priorityQueue: [],
      loads: loads,
      exceptions: {
        edrWithoutOpenDock: inboundLines.filter(function(line) { return !line.matchedAppointmentId; }).length,
        openDockWithoutEdr: loads.filter(function(load) { return load.matchState === "opendock-only"; }).length,
        lateForDueWos: 0,
        cancelledAtRisk: loads.filter(function(load) { return (load.linkedWOCount || 0) > 0 && normalizeStr(load.status || "").includes("cancel"); }).length
      },
      reconciliation: {
        edrTodayTotal: allDeliveries.filter(function(delivery) { return delivery.date === todayIso; }).length,
        matchedToday: loads.filter(function(load) { return boardDate(load) === todayIso && load.isMatched; }).length,
        unmatchedToday: loads.filter(function(load) { return boardDate(load) === todayIso && !load.isMatched; }).length,
        materialColumn: "Material",
        exactSkuMatched: matchDiagnostics.exactSkuMatched,
        leadingZeroMatched: matchDiagnostics.leadingZeroMatched,
        unmatchedSkuRows: matchDiagnostics.unmatched,
        matchedByPo: matchDiagnostics.matchedByPo,
        matchedByReference: matchDiagnostics.matchedByReference,
        dateProximityOnly: 0
      }
    }
  };
}

export function buildSupplyRiskModel(options) {
  var analysis = options && options.analysis ? options.analysis : null;
  if (!analysis) {
    return {
      inboundCoverage: null,
      timelineData: null,
      deliveriesV2: null,
      diagnostics: { inboundLines: 0, appointments: 0 }
    };
  }

  var horizonDays = Math.max(1, safeNum(options && options.horizonDays ? options.horizonDays : 60));
  var now = new Date();
  var windowStart = new Date(now);
  windowStart.setHours(0, 0, 0, 0);
  var windowEnd = new Date(windowStart.getTime() + (horizonDays * 86400000));
  windowEnd.setHours(23, 59, 59, 999);

  var criticalItems = Array.isArray(options && options.criticalItems) && options.criticalItems.length
    ? options.criticalItems
    : buildCriticalItemsFallback(analysis);
  var linkMap = buildMaterialLinkMap(analysis);
  var inboundLines = normalizeInboundLines(options && options.edrData, windowStart, windowEnd);
  var appointments = normalizeAppointments(options && options.dockData);
  var todayIso = new Date().toISOString().slice(0, 10);
  matchInboundLinesToAppointments(inboundLines, appointments);

  var inboundCoverage = buildInboundCoverage(criticalItems, inboundLines);
  var unlockTimeline = buildUnlockTimeline(analysis, inboundLines, todayIso);
  var loadBoard = buildLoadBoard(
    appointments,
    inboundLines,
    linkMap,
    todayIso,
    {
      inboundSyncedAt: options && options.inboundSyncedAt,
      dockSyncedAt: options && options.dockSyncedAt
    }
  );
  if (inboundCoverage) inboundCoverage.horizonDays = horizonDays;
  if (loadBoard && loadBoard.deliveriesV2) loadBoard.deliveriesV2.unlockTimeline = unlockTimeline;

  return {
    inboundCoverage: inboundCoverage,
    timelineData: loadBoard.timelineData,
    deliveriesV2: loadBoard.deliveriesV2,
    diagnostics: {
      inboundLines: inboundLines.length,
      appointments: appointments.length
    }
  };
}
