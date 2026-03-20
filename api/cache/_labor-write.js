import { selectEventsForWrite, siteTableHasRows } from "../_event-window.js";

function sanitizeDateKey(value) {
  var s = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}

function todayEtDateKey() {
  var parts = {};
  new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date()).forEach(function(part) {
    if (part.type !== "literal") parts[part.type] = part.value;
  });
  if (!parts.year || !parts.month || !parts.day) return "";
  return parts.year + "-" + parts.month + "-" + parts.day;
}

function shiftDateKey(dateKey, deltaDays) {
  var base = sanitizeDateKey(dateKey);
  if (!base) return "";
  var d = new Date(base + "T12:00:00Z");
  if (isNaN(d)) return "";
  d.setUTCDate(d.getUTCDate() + Number(deltaDays || 0));
  return d.toISOString().slice(0, 10);
}

function toNum(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (value == null || value === "") return 0;
  var n = parseFloat(String(value).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function clampRatio(value, fallback) {
  var n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

function groupEventsByDate(events, dateField) {
  var out = {
    byDate: {},
    undated: []
  };
  (Array.isArray(events) ? events : []).forEach(function(event) {
    var dateKey = sanitizeDateKey(event && event[dateField]);
    if (!dateKey) {
      out.undated.push(event);
      return;
    }
    if (!out.byDate[dateKey]) out.byDate[dateKey] = [];
    out.byDate[dateKey].push(event);
  });
  return out;
}

async function fetchExistingLaborStatsByDate(supabase, siteId, startDate, endDate) {
  var out = {};
  var pageSize = 1000;
  var from = 0;
  while (true) {
    var to = from + pageSize - 1;
    var q = await supabase
      .from("labor_events")
      .select("worked_date_et,payable_hours")
      .eq("site_id", siteId)
      .gte("worked_date_et", startDate)
      .lte("worked_date_et", endDate)
      .order("worked_date_et", { ascending: false })
      .range(from, to);
    if (q.error) throw q.error;
    var rows = Array.isArray(q.data) ? q.data : [];
    rows.forEach(function(row) {
      var dateKey = sanitizeDateKey(row && row.worked_date_et);
      if (!dateKey) return;
      if (!out[dateKey]) out[dateKey] = { rows: 0, payableHours: 0 };
      out[dateKey].rows += 1;
      out[dateKey].payableHours += toNum(row && row.payable_hours);
    });
    if (rows.length < pageSize) break;
    from += pageSize;
    if (from > 100000) break;
  }
  return out;
}

async function replaceLaborEventsByDate(supabase, siteId, events) {
  var grouped = groupEventsByDate(events, "worked_date_et");
  var datedKeys = Object.keys(grouped.byDate).sort();
  var chunkSize = 500;
  var written = 0;

  for (var i = 0; i < datedKeys.length; i++) {
    var dateKey = datedKeys[i];
    var del = await supabase
      .from("labor_events")
      .delete()
      .eq("site_id", siteId)
      .eq("worked_date_et", dateKey);
    if (del.error) throw del.error;

    var rows = grouped.byDate[dateKey] || [];
    for (var x = 0; x < rows.length; x += chunkSize) {
      var chunk = rows.slice(x, x + chunkSize);
      var up = await supabase.from("labor_events").upsert(chunk, { onConflict: "site_id,event_key" });
      if (up.error) throw up.error;
      written += chunk.length;
    }
  }

  for (var u = 0; u < grouped.undated.length; u += chunkSize) {
    var undatedChunk = grouped.undated.slice(u, u + chunkSize);
    var undatedUp = await supabase.from("labor_events").upsert(undatedChunk, { onConflict: "site_id,event_key" });
    if (undatedUp.error) throw undatedUp.error;
    written += undatedChunk.length;
  }

  return {
    written: written,
    deletedWindowStart: datedKeys.length ? datedKeys[0] : null,
    deletedWindowEnd: datedKeys.length ? datedKeys[datedKeys.length - 1] : null,
    deletedDates: datedKeys
  };
}

async function protectRecentSparseDates(supabase, siteId, events) {
  var grouped = groupEventsByDate(events, "worked_date_et");
  var dateKeys = Object.keys(grouped.byDate).sort();
  if (!dateKeys.length) {
    return {
      events: grouped.undated.slice(),
      guardedDates: []
    };
  }

  var guardDays = Math.max(0, Number(process.env.LABOR_EVENT_RECENT_GUARD_DAYS || 3));
  if (!(guardDays > 0)) {
    return {
      events: grouped.undated.concat(dateKeys.flatMap(function(dateKey) { return grouped.byDate[dateKey] || []; })),
      guardedDates: []
    };
  }

  var todayEt = todayEtDateKey();
  var guardStart = todayEt ? shiftDateKey(todayEt, -(guardDays - 1)) : "";
  var candidateDates = dateKeys.filter(function(dateKey) {
    return !guardStart || dateKey >= guardStart;
  });
  if (!candidateDates.length) {
    return {
      events: grouped.undated.concat(dateKeys.flatMap(function(dateKey) { return grouped.byDate[dateKey] || []; })),
      guardedDates: []
    };
  }

  var existingByDate = await fetchExistingLaborStatsByDate(
    supabase,
    siteId,
    candidateDates[0],
    candidateDates[candidateDates.length - 1]
  );
  var minHoursRatio = clampRatio(process.env.LABOR_EVENT_GUARD_MIN_HOURS_RATIO, 0.75);
  var minCountRatio = clampRatio(process.env.LABOR_EVENT_GUARD_MIN_COUNT_RATIO, 0.75);
  var minExistingHours = Math.max(0, Number(process.env.LABOR_EVENT_GUARD_MIN_EXISTING_HOURS || 40));
  var minExistingRows = Math.max(0, Number(process.env.LABOR_EVENT_GUARD_MIN_EXISTING_ROWS || 5));
  var minHoursDelta = Math.max(0, Number(process.env.LABOR_EVENT_GUARD_MIN_HOURS_DELTA || 12));
  var minRowsDelta = Math.max(0, Number(process.env.LABOR_EVENT_GUARD_MIN_ROWS_DELTA || 3));

  var allowedEvents = grouped.undated.slice();
  var guardedDates = [];
  dateKeys.forEach(function(dateKey) {
    var dateEvents = grouped.byDate[dateKey] || [];
    var existing = existingByDate[dateKey];
    if (!existing || candidateDates.indexOf(dateKey) === -1) {
      Array.prototype.push.apply(allowedEvents, dateEvents);
      return;
    }

    if (!(existing.rows >= minExistingRows) && !(existing.payableHours >= minExistingHours)) {
      Array.prototype.push.apply(allowedEvents, dateEvents);
      return;
    }

    var incomingRows = dateEvents.length;
    var incomingHours = dateEvents.reduce(function(sum, event) {
      return sum + toNum(event && event.payable_hours);
    }, 0);
    var hoursRatio = existing.payableHours > 0 ? (incomingHours / existing.payableHours) : 1;
    var countRatio = existing.rows > 0 ? (incomingRows / existing.rows) : 1;
    var suspiciousDrop =
      countRatio < minCountRatio &&
      hoursRatio < minHoursRatio &&
      (existing.rows - incomingRows) >= minRowsDelta &&
      (existing.payableHours - incomingHours) >= minHoursDelta;

    if (suspiciousDrop) {
      guardedDates.push({
        date: dateKey,
        existingRows: existing.rows,
        incomingRows: incomingRows,
        existingPayableHours: Number(existing.payableHours.toFixed(2)),
        incomingPayableHours: Number(incomingHours.toFixed(2))
      });
      return;
    }

    Array.prototype.push.apply(allowedEvents, dateEvents);
  });

  return {
    events: allowedEvents,
    guardedDates: guardedDates
  };
}

export async function writeLaborEventsSafely(supabase, options) {
  var siteId = String(options && options.siteId || "");
  var allEvents = Array.isArray(options && options.events) ? options.events : [];
  var correctionDays = Math.max(1, Number(options && options.correctionDays || 60));

  var hasExistingRows = await siteTableHasRows(supabase, "labor_events", siteId);
  var writePlan = selectEventsForWrite(allEvents, {
    dateField: "worked_date_et",
    hasExistingRows: hasExistingRows,
    correctionDays: correctionDays
  });
  var guardedPlan = await protectRecentSparseDates(supabase, siteId, writePlan.events);
  var writeResult = await replaceLaborEventsByDate(supabase, siteId, guardedPlan.events);

  return {
    writeMode: guardedPlan.guardedDates.length ? (writePlan.mode + "_guarded") : writePlan.mode,
    correctionStart: writePlan.cutoffDate,
    written: writeResult.written,
    deletedWindowStart: writeResult.deletedWindowStart,
    deletedWindowEnd: writeResult.deletedWindowEnd,
    deletedDates: writeResult.deletedDates,
    guardedDates: guardedPlan.guardedDates,
    guardedDateKeys: guardedPlan.guardedDates.map(function(row) { return row.date; }),
    submittedEvents: allEvents.length,
    selectedEvents: writePlan.events.length
  };
}
