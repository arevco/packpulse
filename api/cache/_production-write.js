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

function sleep(ms) {
  return new Promise(function(resolve) {
    setTimeout(resolve, Math.max(0, Number(ms || 0)));
  });
}

function isTransientFetchError(error) {
  var msg = String(error && error.message || "").toLowerCase();
  return (
    msg.indexOf("fetch failed") !== -1 ||
    msg.indexOf("etimedout") !== -1 ||
    msg.indexOf("econnreset") !== -1 ||
    msg.indexOf("enotfound") !== -1 ||
    msg.indexOf("network") !== -1 ||
    msg.indexOf("socket") !== -1
  );
}

async function withRetry(fn, options) {
  var attempts = Math.max(1, Number(options && options.attempts || 2));
  var delayMs = Math.max(0, Number(options && options.delayMs || 150));
  var lastErr;
  for (var attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isTransientFetchError(err) || attempt === attempts - 1) throw err;
      await sleep(delayMs * (attempt + 1));
    }
  }
  throw lastErr || new Error("retry_failed");
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

async function fetchExistingProductionStatsByDate(supabase, siteId, startDate, endDate) {
  var out = {};
  var pageSize = 1000;
  var from = 0;
  while (true) {
    var to = from + pageSize - 1;
    var q = await withRetry(function() {
      return supabase
        .from("production_events")
        .select("produced_date_et,units_produced")
        .eq("site_id", siteId)
        .gte("produced_date_et", startDate)
        .lte("produced_date_et", endDate)
        .order("produced_date_et", { ascending: false })
        .range(from, to);
    }, { attempts: 3, delayMs: 200 });
    if (q.error) throw q.error;
    var rows = Array.isArray(q.data) ? q.data : [];
    rows.forEach(function(row) {
      var dateKey = sanitizeDateKey(row && row.produced_date_et);
      if (!dateKey) return;
      if (!out[dateKey]) out[dateKey] = { rows: 0, unitsProduced: 0 };
      out[dateKey].rows += 1;
      out[dateKey].unitsProduced += toNum(row && row.units_produced);
    });
    if (rows.length < pageSize) break;
    from += pageSize;
    if (from > 100000) break;
  }
  return out;
}

async function replaceProductionEventsByDate(supabase, siteId, events) {
  var grouped = groupEventsByDate(events, "produced_date_et");
  var datedKeys = Object.keys(grouped.byDate).sort();
  var chunkSize = 500;
  var written = 0;

  for (var i = 0; i < datedKeys.length; i++) {
    var dateKey = datedKeys[i];
    var del = await withRetry(function() {
      return supabase
        .from("production_events")
        .delete()
        .eq("site_id", siteId)
        .eq("produced_date_et", dateKey);
    }, { attempts: 3, delayMs: 200 });
    if (del.error) throw del.error;

    var rows = grouped.byDate[dateKey] || [];
    for (var x = 0; x < rows.length; x += chunkSize) {
      var chunk = rows.slice(x, x + chunkSize);
      var up = await withRetry(function() {
        return supabase.from("production_events").upsert(chunk, { onConflict: "site_id,event_key" });
      }, { attempts: 3, delayMs: 200 });
      if (up.error) throw up.error;
      written += chunk.length;
    }
  }

  for (var u = 0; u < grouped.undated.length; u += chunkSize) {
    var undatedChunk = grouped.undated.slice(u, u + chunkSize);
    var undatedUp = await withRetry(function() {
      return supabase.from("production_events").upsert(undatedChunk, { onConflict: "site_id,event_key" });
    }, { attempts: 3, delayMs: 200 });
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
  var grouped = groupEventsByDate(events, "produced_date_et");
  var dateKeys = Object.keys(grouped.byDate).sort();
  if (!dateKeys.length) {
    return {
      events: grouped.undated.slice(),
      guardedDates: []
    };
  }

  var guardDays = Math.max(0, Number(process.env.PRODUCTION_EVENT_RECENT_GUARD_DAYS || 3));
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

  var existingByDate = {};
  try {
    existingByDate = await fetchExistingProductionStatsByDate(
      supabase,
      siteId,
      candidateDates[0],
      candidateDates[candidateDates.length - 1]
    );
  } catch (guardErr) {
    if (!isTransientFetchError(guardErr)) throw guardErr;
    return {
      events: grouped.undated.concat(dateKeys.flatMap(function(dateKey) { return grouped.byDate[dateKey] || []; })),
      guardedDates: []
    };
  }

  var minUnitsRatio = clampRatio(process.env.PRODUCTION_EVENT_GUARD_MIN_UNITS_RATIO, 0.75);
  var minCountRatio = clampRatio(process.env.PRODUCTION_EVENT_GUARD_MIN_COUNT_RATIO, 0.75);
  var minExistingUnits = Math.max(0, Number(process.env.PRODUCTION_EVENT_GUARD_MIN_EXISTING_UNITS || 500));
  var minExistingRows = Math.max(0, Number(process.env.PRODUCTION_EVENT_GUARD_MIN_EXISTING_ROWS || 3));
  var minUnitsDelta = Math.max(0, Number(process.env.PRODUCTION_EVENT_GUARD_MIN_UNITS_DELTA || 250));
  var minRowsDelta = Math.max(0, Number(process.env.PRODUCTION_EVENT_GUARD_MIN_ROWS_DELTA || 2));

  var allowedEvents = grouped.undated.slice();
  var guardedDates = [];
  dateKeys.forEach(function(dateKey) {
    var dateEvents = grouped.byDate[dateKey] || [];
    var existing = existingByDate[dateKey];
    if (!existing || candidateDates.indexOf(dateKey) === -1) {
      Array.prototype.push.apply(allowedEvents, dateEvents);
      return;
    }

    if (!(existing.rows >= minExistingRows) && !(existing.unitsProduced >= minExistingUnits)) {
      Array.prototype.push.apply(allowedEvents, dateEvents);
      return;
    }

    var incomingRows = dateEvents.length;
    var incomingUnits = dateEvents.reduce(function(sum, event) {
      return sum + toNum(event && event.units_produced);
    }, 0);
    var unitsRatio = existing.unitsProduced > 0 ? (incomingUnits / existing.unitsProduced) : 1;
    var countRatio = existing.rows > 0 ? (incomingRows / existing.rows) : 1;
    var suspiciousDrop =
      countRatio < minCountRatio &&
      unitsRatio < minUnitsRatio &&
      (existing.rows - incomingRows) >= minRowsDelta &&
      (existing.unitsProduced - incomingUnits) >= minUnitsDelta;

    if (suspiciousDrop) {
      guardedDates.push({
        date: dateKey,
        existingRows: existing.rows,
        incomingRows: incomingRows,
        existingUnitsProduced: Number(existing.unitsProduced.toFixed(2)),
        incomingUnitsProduced: Number(incomingUnits.toFixed(2))
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

export async function writeProductionEventsSafely(supabase, options) {
  var siteId = String(options && options.siteId || "");
  var allEvents = Array.isArray(options && options.events) ? options.events : [];
  var correctionDays = Math.max(1, Number(options && options.correctionDays || 3));

  var hasExistingRows = await withRetry(function() {
    return siteTableHasRows(supabase, "production_events", siteId);
  }, { attempts: 3, delayMs: 200 });
  var writePlan = selectEventsForWrite(allEvents, {
    dateField: "produced_date_et",
    hasExistingRows: hasExistingRows,
    correctionDays: correctionDays
  });
  var guardedPlan = await protectRecentSparseDates(supabase, siteId, writePlan.events);
  var writeResult = await replaceProductionEventsByDate(supabase, siteId, guardedPlan.events);

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
