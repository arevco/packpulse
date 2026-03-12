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

export function toNum(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (value == null || value === "") return 0;
  var n = parseFloat(String(value).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export function normalizeKey(value) {
  return String(value || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
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

function parseNulogyWallClock(value) {
  var raw = String(value || "").trim();
  if (!raw) return null;
  var m = raw.match(/^(\d{4})-([A-Za-z]{3})-(\d{1,2})[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)$/i);
  if (!m) return null;
  var year = parseInt(m[1], 10);
  var monthIndex = MONTH_INDEX[String(m[2] || "").toLowerCase()];
  var day = parseInt(m[3], 10);
  var hour = parseInt(m[4], 10);
  var minute = parseInt(m[5], 10);
  var second = parseInt(m[6] || "0", 10);
  var meridiem = String(m[7] || "").toUpperCase();
  if (!Number.isFinite(year) || monthIndex == null || !Number.isFinite(day)) return null;
  if (meridiem === "PM" && hour < 12) hour += 12;
  if (meridiem === "AM" && hour === 12) hour = 0;
  var parsed = easternWallClockToDate(year, monthIndex, day, hour, minute, second);
  return isNaN(parsed) ? null : parsed;
}

function parseDateLoose(value) {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value) ? null : value;
  if (typeof value === "number") {
    var fromNum = new Date(value);
    return isNaN(fromNum) ? null : fromNum;
  }
  var raw = String(value).trim();
  if (!raw) return null;

  var wallClock = parseNulogyWallClock(raw);
  if (wallClock) return wallClock;

  var parsed = new Date(raw);
  return isNaN(parsed) ? null : parsed;
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
  if (hour >= 7 && hour < 15) return "Shift 1 (7a-3p)";
  if (hour >= 15 && hour < 23) return "Shift 2 (3p-11p)";
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
  (Array.isArray(rows) ? rows : []).forEach(function(row, idx) {
    var payableHours = toNum(pickFieldLoose(row, ["Payable hours", "payable_hours"]));
    var productiveHours = toNum(pickFieldLoose(row, ["Productive hours", "productive_hours"]));
    var durationHours = parseDurationHours(pickFieldLoose(row, ["Duration", "duration"]));
    if (!(payableHours > 0) && !(productiveHours > 0) && !(durationHours > 0)) return;

    var clockInRaw = pickFieldLoose(row, [
      "Clock in time",
      "clock_in_time",
      "Clock In At",
      "clock_in_at",
      "Clocked In At",
      "clocked_in_at",
      "Started At",
      "started_at"
    ]);
    var clockOutRaw = pickFieldLoose(row, [
      "Clock out time",
      "clock_out_time",
      "Clock Out At",
      "clock_out_at",
      "Clocked Out At",
      "clocked_out_at",
      "Ended At",
      "ended_at"
    ]);
    var clockInIso = toIso(clockInRaw);
    var clockOutIso = toIso(clockOutRaw);
    var eastern = toEasternParts(clockInIso || clockOutIso || syncedAt);
    var shift = classifyShiftET(eastern);
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
    var keyBase = [siteId, rowHash, String(idx)].join("|");
    var eventKey = crypto.createHash("sha1").update(keyBase).digest("hex");

    dedup[eventKey] = {
      site_id: siteId,
      event_key: eventKey,
      worked_at_utc: clockInIso || clockOutIso || null,
      clock_in_at_utc: clockInIso,
      clock_out_at_utc: clockOutIso,
      worked_date_et: eastern ? eastern.dateKey : null,
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
