import crypto from "crypto";

var ET_TIME_ZONE = "America/New_York";
var MONTH_INDEX = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11
};

export var LABOR_SHIFT_CONFIG = Object.freeze({
  shift1_start_minute: 7 * 60,
  shift1_end_minute: 15 * 60,
  shift2_start_minute: 15 * 60,
  shift2_end_minute: 23 * 60,
  start_grace_minutes: 10,
  end_grace_minutes: 10,
  cross_shift_split_minutes: 30
});

export function toNum(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (value == null || value === "") return 0;
  var n = parseFloat(String(value).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export function normalizeKey(value) {
  return String(value || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function normalizeShiftLabel(value) {
  var key = normalizeKey(value);
  if (!key) return "";
  if (key.includes("cross")) return "Cross-Shift Job";
  if (key.includes("unassigned")) return "Unassigned";
  if (key === "1" || key.includes("1st") || key.includes("shift1") || key.includes("first")) return "Shift 1 (7a-3p)";
  if (key === "2" || key.includes("2nd") || key.includes("shift2") || key.includes("second")) return "Shift 2 (3p-11p)";
  return "";
}

function timeZoneParts(date, timeZone) {
  if (!(date instanceof Date) || isNaN(date)) return null;
  var out = {};
  new Intl.DateTimeFormat("en-US", {
    timeZone: timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(date).forEach(function(p) {
    if (p.type !== "literal") out[p.type] = p.value;
  });
  if (!out.year || !out.month || !out.day) return null;
  return {
    year: parseInt(out.year, 10),
    month: parseInt(out.month, 10),
    day: parseInt(out.day, 10),
    hour: parseInt(out.hour || "0", 10),
    minute: parseInt(out.minute || "0", 10),
    second: parseInt(out.second || "0", 10)
  };
}

function timeZoneOffsetMillis(date, timeZone) {
  var parts = timeZoneParts(date, timeZone);
  if (!parts) return 0;
  var asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - date.getTime();
}

function easternWallClockToDate(year, monthIndex, day, hour24, minute, second) {
  var utcGuess = Date.UTC(year, monthIndex, day, hour24, minute || 0, second || 0);
  var offset = timeZoneOffsetMillis(new Date(utcGuess), ET_TIME_ZONE);
  var actual = utcGuess - offset;
  var resolvedOffset = timeZoneOffsetMillis(new Date(actual), ET_TIME_ZONE);
  if (resolvedOffset !== offset) actual = utcGuess - resolvedOffset;
  return new Date(actual);
}

function isReasonableDate(date) {
  if (!(date instanceof Date) || isNaN(date)) return false;
  var year = date.getUTCFullYear();
  return year >= 2000 && year <= 2100;
}

function parseNulogyWallClock(value) {
  var raw = String(value || "").trim();
  if (!raw) return null;
  var patterns = [
    /^(\d{4})-([A-Za-z]{3})-(\d{1,2})[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d{1,6})?\s*([AP]M)(?:\s+[A-Z]{2,5}|[+-]\d{2}:?\d{2})?$/i,
    /^(\d{4})-([A-Za-z]{3})-(\d{1,2})[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d{1,6})?(?:\s+[A-Z]{2,5}|[+-]\d{2}:?\d{2})?$/i,
    /^(\d{4})-(\d{2})-(\d{2})[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d{1,6})?\s*([AP]M)?(?:\s+[A-Z]{2,5}|[+-]\d{2}:?\d{2})?$/i,
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d{1,6})?\s*([AP]M)?$/i
  ];
  for (var p = 0; p < patterns.length; p++) {
    var m = raw.match(patterns[p]);
    if (!m) continue;
    var year = 0;
    var monthIndex = 0;
    var day = 0;
    if (p === 0 || p === 1) {
      year = parseInt(m[1], 10);
      monthIndex = MONTH_INDEX[String(m[2] || "").toLowerCase()];
      day = parseInt(m[3], 10);
    } else if (p === 2) {
      year = parseInt(m[1], 10);
      monthIndex = parseInt(m[2], 10) - 1;
      day = parseInt(m[3], 10);
    } else {
      monthIndex = parseInt(m[1], 10) - 1;
      day = parseInt(m[2], 10);
      year = parseInt(m[3], 10);
    }
    var hour = parseInt(m[4], 10);
    var minute = parseInt(m[5], 10);
    var second = parseInt(m[6] || "0", 10);
    var meridiem = String(m[7] || "").toUpperCase();
    if (!Number.isFinite(year) || !Number.isFinite(monthIndex) || monthIndex < 0 || monthIndex > 11 || !Number.isFinite(day)) continue;
    if (meridiem === "PM" && hour < 12) hour += 12;
    if (meridiem === "AM" && hour === 12) hour = 0;
    var parsed = easternWallClockToDate(year, monthIndex, day, hour, minute, second);
    if (!isNaN(parsed)) return parsed;
  }
  return null;
}

function parseDateLoose(value) {
  if (!value) return null;
  if (value instanceof Date) return isReasonableDate(value) ? value : null;
  if (typeof value === "number") {
    var fromNum = new Date(value);
    return isReasonableDate(fromNum) ? fromNum : null;
  }
  var raw = String(value).trim();
  if (!raw) return null;
  if (/^[+-]?\d{4,}$/.test(raw)) return null;

  var wallClock = parseNulogyWallClock(raw);
  if (wallClock) return wallClock;

  var looksDateLike =
    /[A-Za-z]{3}/.test(raw) ||
    raw.indexOf("/") !== -1 ||
    raw.indexOf(":") !== -1 ||
    raw.indexOf("T") !== -1 ||
    /^\d{4}-\d{2}-\d{2}/.test(raw);
  if (!looksDateLike) return null;

  var parsed = new Date(raw);
  return isReasonableDate(parsed) ? parsed : null;
}

function resolveDateKey(value) {
  var raw = String(value || "").trim();
  if (!raw) return "";
  var isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) return isoMatch[1] + "-" + isoMatch[2] + "-" + isoMatch[3];
  var namedMatch = raw.match(/^(\d{4})-([A-Za-z]{3})-(\d{1,2})$/i);
  if (namedMatch) {
    var namedMonth = MONTH_INDEX[String(namedMatch[2] || "").toLowerCase()];
    if (Number.isFinite(namedMonth)) {
      return namedMatch[1] + "-" + String(namedMonth + 1).padStart(2, "0") + "-" + String(parseInt(namedMatch[3], 10)).padStart(2, "0");
    }
  }
  var slashMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    return slashMatch[3] + "-" + String(parseInt(slashMatch[1], 10)).padStart(2, "0") + "-" + String(parseInt(slashMatch[2], 10)).padStart(2, "0");
  }
  var parts = toEasternParts(raw);
  return parts && parts.dateKey ? parts.dateKey : "";
}

export function stableRowHash(row) {
  if (!row || typeof row !== "object") return "";
  var keys = Object.keys(row).sort();
  var out = {};
  keys.forEach(function(k) { out[k] = row[k]; });
  return crypto.createHash("sha1").update(JSON.stringify(out)).digest("hex");
}

export function pickFieldLoose(row, keys) {
  if (!row || typeof row !== "object") return "";
  var rowKeys = Object.keys(row);
  for (var i = 0; i < keys.length; i++) {
    var target = String(keys[i]).toLowerCase();
    for (var j = 0; j < rowKeys.length; j++) {
      var rk = rowKeys[j];
      if (String(rk).toLowerCase() === target) return row[rk];
    }
  }
  var wanted = {};
  keys.forEach(function(k) { wanted[normalizeKey(k)] = true; });
  for (var x = 0; x < rowKeys.length; x++) {
    var rowKey = rowKeys[x];
    if (wanted[normalizeKey(rowKey)]) return row[rowKey];
  }
  return "";
}

function scoreTimestampFieldName(name) {
  var key = normalizeKey(name);
  if (!key) return -1;
  var score = 0;
  if (key.includes("clockin")) score += 12;
  if (key.includes("clockout")) score += 12;
  if (key.includes("clockedin")) score += 12;
  if (key.includes("clockedout")) score += 12;
  if (key.includes("start")) score += 10;
  if (key.includes("end")) score += 10;
  if (key.includes("workedat")) score += 10;
  if (key.includes("workedon")) score += 9;
  if (key.includes("workdate")) score += 9;
  if (key === "date" || key.endsWith("date")) score += 8;
  if (key.includes("time")) score += 6;
  if (key.includes("datetime")) score += 6;
  if (key.includes("createdat") || key.includes("updatedat")) score += 3;
  return score;
}

function pickBestTimestampValue(row, preferredKeys) {
  var direct = pickFieldLoose(row, preferredKeys || []);
  if (direct && parseDateLoose(direct)) return direct;
  if (!row || typeof row !== "object") return "";
  var bestKey = "";
  var bestScore = -1;
  var rowKeys = Object.keys(row);
  for (var i = 0; i < rowKeys.length; i++) {
    var key = rowKeys[i];
    var value = row[key];
    var score = scoreTimestampFieldName(key);
    if (!(score > 0)) continue;
    if (!value || !parseDateLoose(value)) continue;
    if (score > bestScore) {
      bestScore = score;
      bestKey = key;
    }
  }
  return bestKey ? row[bestKey] : "";
}

export function toIso(value) {
  if (!value) return null;
  var d = parseDateLoose(value);
  if (!d || isNaN(d)) return null;
  return d.toISOString();
}

export function toEasternParts(value) {
  if (!value) return null;
  var d = parseDateLoose(value);
  if (!d || isNaN(d)) return null;
  var dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: ET_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  var out = {};
  dtf.formatToParts(d).forEach(function(p) {
    if (p.type !== "literal") out[p.type] = p.value;
  });
  if (!out.year || !out.month || !out.day) return null;
  return {
    dateKey: out.year + "-" + out.month + "-" + out.day,
    hour: parseInt(out.hour || "0", 10),
    minute: parseInt(out.minute || "0", 10)
  };
}

export function classifyShiftET(parts) {
  if (!parts) return "Unassigned";
  var hour = Number(parts.hour || 0);
  var minute = Number(parts.minute || 0);
  var totalMinutes = (hour * 60) + minute;
  if (totalMinutes >= (7 * 60) && totalMinutes <= ((15 * 60) + 5)) return "Shift 1 (7a-3p)";
  if (totalMinutes >= ((15 * 60) + 6) && totalMinutes <= ((23 * 60) + 59)) return "Shift 2 (3p-11p)";
  return "Unassigned";
}

export function classifyLaborShiftFromPunchET(parts) {
  if (!parts) return "Unassigned";
  var hour = Number(parts.hour || 0);
  var minute = Number(parts.minute || 0);
  var totalMinutes = (hour * 60) + minute;
  var shift1Start = LABOR_SHIFT_CONFIG.shift1_start_minute;
  var shift1End = LABOR_SHIFT_CONFIG.shift1_end_minute;
  var shift2Start = LABOR_SHIFT_CONFIG.shift2_start_minute;
  var shift2End = LABOR_SHIFT_CONFIG.shift2_end_minute;
  var grace = LABOR_SHIFT_CONFIG.start_grace_minutes;

  if (Math.abs(totalMinutes - shift1Start) <= grace) return "Shift 1 (7a-3p)";
  if (Math.abs(totalMinutes - shift2Start) <= grace) return "Shift 2 (3p-11p)";
  if (totalMinutes > (shift1Start + grace) && totalMinutes < shift1End) return "Shift 1 (7a-3p)";
  if (totalMinutes > (shift2Start + grace) && totalMinutes < shift2End) return "Shift 2 (3p-11p)";
  return "Unassigned";
}

export function parseDurationHours(value) {
  if (value == null || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  var raw = String(value).trim();
  if (!raw) return 0;
  var hhmm = raw.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/);
  if (hhmm) {
    var hours = parseInt(hhmm[1] || "0", 10);
    var minutes = parseInt(hhmm[2] || "0", 10);
    var seconds = parseInt(hhmm[3] || "0", 10);
    return hours + (minutes / 60) + (seconds / 3600);
  }
  return toNum(raw);
}

export function normalizeLaborRoleKey(value) {
  var raw = String(value || "").toLowerCase().trim();
  if (!raw) return "other";
  if (raw.includes("fork")) return "fork";
  if (raw.includes("qa")) return "qa";
  if (raw.includes("maint")) return "maint";
  if (raw.includes("recycl")) return "recycling";
  if (raw.includes("oper")) return "operator";
  if (raw.includes("labor") || raw.includes("temp")) return "labor";
  return "other";
}

export function buildLaborEvents(rows, siteId, syncedAt, updatedBy) {
  var dedup = {};
  var hashOccurrences = {};
  (Array.isArray(rows) ? rows : []).forEach(function(row) {
    var payableHours = toNum(pickFieldLoose(row, ["Payable hours", "payable_hours"]));
    var productiveHours = toNum(pickFieldLoose(row, ["Productive hours", "productive_hours"]));
    var durationHours = parseDurationHours(pickFieldLoose(row, ["Duration", "duration"]));
    if (!(payableHours > 0) && !(productiveHours > 0) && !(durationHours > 0)) return;

    var clockInRaw = pickBestTimestampValue(row, [
      "Clock in time",
      "Clock In Time",
      "clock_in_time",
      "Clock In At",
      "clock_in_at",
      "Clocked In At",
      "clocked_in_at",
      "Clocked In Time",
      "clocked_in_time",
      "Started At",
      "started_at",
      "Start Time",
      "start_time",
      "Start At",
      "start_at",
      "Worked At",
      "worked_at",
      "Work Date",
      "work_date"
    ]);
    var clockOutRaw = pickBestTimestampValue(row, [
      "Clock out time",
      "Clock Out Time",
      "clock_out_time",
      "Clock Out At",
      "clock_out_at",
      "Clocked Out At",
      "clocked_out_at",
      "Clocked Out Time",
      "clocked_out_time",
      "Ended At",
      "ended_at",
      "End Time",
      "end_time",
      "End At",
      "end_at"
    ]);
    var clockInIso = toIso(clockInRaw);
    var clockOutIso = toIso(clockOutRaw);
    var explicitShift = normalizeShiftLabel(pickFieldLoose(row, [
      "Shift Label",
      "shift_label",
      "Shift",
      "shift",
      "Shift Name",
      "shift_name"
    ]));
    var explicitDateRaw = pickFieldLoose(row, [
      "Worked Date ET",
      "worked_date_et",
      "Worked Date",
      "worked_date",
      "Work Date",
      "work_date",
      "Date",
      "date"
    ]);
    var explicitDateKey = resolveDateKey(explicitDateRaw);
    // If labor has no usable clock/date field, keep the timestamp null here and
    // let downstream job-timing reconciliation infer the reporting date/shift.
    var eastern = toEasternParts(clockInIso || clockOutIso);
    var hasCompleteClockWindow = !!clockInIso && !!clockOutIso;
    var shift = explicitShift || (clockInIso ? classifyLaborShiftFromPunchET(toEasternParts(clockInIso)) : (hasCompleteClockWindow ? classifyLaborShiftFromPunchET(eastern) : "Unassigned"));
    var roleName = String(pickFieldLoose(row, ["Badge type name", "badge_type_name", "Role", "role_name"]) || "").trim();
    var badgeTypePrefix = String(pickFieldLoose(row, ["Badge type prefix", "badge_type_prefix"]) || "").trim();
    var jobId = String(pickFieldLoose(row, ["Job ID", "job_id", "Job"]) || "").trim();
    var workOrderCode = String(pickFieldLoose(row, ["Work Order Code", "work_order_code", "project_code", "Project Code"]) || "").trim();
    var workOrderId = String(pickFieldLoose(row, ["Work Order ID", "work_order_id"]) || "").trim();
    var itemCode = String(pickFieldLoose(row, ["Item code", "item_code", "Item Code"]) || "").trim();
    var itemDescription = String(pickFieldLoose(row, ["Item description", "item_description", "Description"]) || "").trim();
    var itemFamilyName = String(pickFieldLoose(row, ["Item family name", "item_family_name"]) || "").trim();
    var lineName = String(pickFieldLoose(row, ["Line name", "line_name", "Line"]) || "").trim();
    var rowHash = stableRowHash(row);
    var occurrence = (hashOccurrences[rowHash] || 0) + 1;
    hashOccurrences[rowHash] = occurrence;
    var keyBase = [siteId, rowHash, String(occurrence)].join("|");
    var eventKey = crypto.createHash("sha1").update(keyBase).digest("hex");

    dedup[eventKey] = {
      site_id: siteId,
      event_key: eventKey,
      worked_at_utc: clockInIso || clockOutIso || null,
      clock_in_at_utc: clockInIso,
      clock_out_at_utc: clockOutIso,
      worked_date_et: explicitDateKey || (eastern ? eastern.dateKey : null),
      shift_label: shift,
      line_name: lineName || null,
      job_id: jobId || null,
      work_order_code: workOrderCode || null,
      work_order_id: workOrderId || null,
      item_code: itemCode || null,
      item_description: itemDescription || null,
      item_family_name: itemFamilyName || null,
      role_name: roleName || null,
      role_key: normalizeLaborRoleKey(roleName || badgeTypePrefix),
      badge_type_prefix: badgeTypePrefix || null,
      hourly_rate: toNum(pickFieldLoose(row, ["Badge type rate", "badge_type_rate"])),
      duration_hours: durationHours,
      payable_hours: payableHours,
      productive_hours: productiveHours,
      availability_pct: toNum(pickFieldLoose(row, ["Availability", "availability"])),
      performance_pct: toNum(pickFieldLoose(row, ["Performance", "performance"])),
      line_efficiency_pct: toNum(pickFieldLoose(row, ["Line Efficiency", "line_efficiency"])),
      source_snapshot_at: syncedAt,
      updated_by: updatedBy,
      raw: row
    };
  });
  return Object.values(dedup);
}
