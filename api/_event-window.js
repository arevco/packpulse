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

export function isMissingTableError(table, error) {
  var msg = String(error && error.message || "").toLowerCase();
  return msg.includes(String(table || "").toLowerCase()) && msg.includes("schema cache");
}

export async function siteTableHasRows(supabase, table, siteId) {
  var q = await supabase
    .from(table)
    .select("event_key")
    .eq("site_id", siteId)
    .limit(1);
  if (q.error) throw q.error;
  return Array.isArray(q.data) && q.data.length > 0;
}

export function selectEventsForWrite(events, options) {
  var allEvents = Array.isArray(events) ? events : [];
  var dateField = String(options && options.dateField || "");
  var hasExistingRows = !!(options && options.hasExistingRows);
  var correctionDays = Math.max(1, Number(options && options.correctionDays || 60));
  if (!hasExistingRows) {
    return {
      mode: "full_backfill",
      cutoffDate: null,
      events: allEvents
    };
  }
  var today = todayEtDateKey();
  var cutoff = today ? shiftDateKey(today, -(correctionDays - 1)) : "";
  var selected = allEvents.filter(function(event) {
    var date = sanitizeDateKey(event && event[dateField]);
    if (!date) return true;
    return !cutoff || date >= cutoff;
  });
  return {
    mode: "correction_window",
    cutoffDate: cutoff || null,
    events: selected
  };
}

export function dateWindowForEvents(events, dateField) {
  var rows = Array.isArray(events) ? events : [];
  var dates = rows
    .map(function(event) { return sanitizeDateKey(event && event[dateField]); })
    .filter(Boolean)
    .sort();
  return {
    start: dates.length ? dates[0] : null,
    end: dates.length ? dates[dates.length - 1] : null
  };
}

export async function replaceSiteEventsInWindow(supabase, options) {
  var table = String(options && options.table || "");
  var siteId = String(options && options.siteId || "");
  var dateField = String(options && options.dateField || "");
  var onConflict = String(options && options.onConflict || "site_id,event_key");
  var events = Array.isArray(options && options.events) ? options.events : [];
  var chunkSize = Math.max(1, Number(options && options.chunkSize || 500));

  if (!table || !siteId) throw new Error("replaceSiteEventsInWindow requires table and siteId");
  if (!events.length) {
    return {
      deletedWindowStart: null,
      deletedWindowEnd: null,
      written: 0
    };
  }

  var window = dateWindowForEvents(events, dateField);
  if (window.start && window.end) {
    var del = await supabase
      .from(table)
      .delete()
      .eq("site_id", siteId)
      .gte(dateField, window.start)
      .lte(dateField, window.end);
    if (del.error) throw del.error;
  }

  var written = 0;
  for (var i = 0; i < events.length; i += chunkSize) {
    var chunk = events.slice(i, i + chunkSize);
    var up = await supabase.from(table).upsert(chunk, { onConflict: onConflict });
    if (up.error) throw up.error;
    written += chunk.length;
  }

  return {
    deletedWindowStart: window.start,
    deletedWindowEnd: window.end,
    written: written
  };
}
