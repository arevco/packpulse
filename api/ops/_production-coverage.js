function normalizeLooseKey(value) {
  return String(value || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function normalizeLookupKey(value) {
  var raw = String(value || "").trim();
  if (!raw) return "";
  return raw.replace(/\.0+$/, "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

export function sanitizeIsoDate(value) {
  var text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

export function normalizeRawRow(raw) {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch (_error) {
      return {};
    }
  }
  return typeof raw === "object" ? raw : {};
}

export function pickFieldLoose(row, keys) {
  if (!row || typeof row !== "object") return "";
  var rowKeys = Object.keys(row);
  for (var i = 0; i < keys.length; i += 1) {
    var target = String(keys[i] || "").toLowerCase();
    for (var j = 0; j < rowKeys.length; j += 1) {
      var rowKey = rowKeys[j];
      if (String(rowKey || "").toLowerCase() === target) return row[rowKey];
    }
  }
  var wanted = {};
  (Array.isArray(keys) ? keys : []).forEach(function(key) {
    wanted[normalizeLooseKey(key)] = true;
  });
  for (var x = 0; x < rowKeys.length; x += 1) {
    var looseKey = rowKeys[x];
    if (wanted[normalizeLooseKey(looseKey)]) return row[looseKey];
  }
  return "";
}

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

function parseNamedMonthDate(raw) {
  var match = String(raw || "").trim().match(
    /^(\d{4})-([A-Za-z]{3})-(\d{1,2})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)?)?$/i
  );
  if (!match) return "";
  var year = parseInt(match[1], 10);
  var monthIndex = MONTH_INDEX[String(match[2] || "").toLowerCase()];
  var day = parseInt(match[3], 10);
  if (!Number.isFinite(year) || !Number.isFinite(monthIndex) || !Number.isFinite(day)) return "";
  return (
    String(year).padStart(4, "0") +
    "-" +
    String(monthIndex + 1).padStart(2, "0") +
    "-" +
    String(day).padStart(2, "0")
  );
}

function parseSlashDate(raw) {
  var match = String(raw || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!match) return "";
  var month = parseInt(match[1], 10);
  var day = parseInt(match[2], 10);
  var year = parseInt(match[3], 10);
  if (year < 100) year += 2000;
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return "";
  return (
    String(year).padStart(4, "0") +
    "-" +
    String(month).padStart(2, "0") +
    "-" +
    String(day).padStart(2, "0")
  );
}

export function resolveProducedDateKey(value) {
  var raw = String(value || "").trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  var namedMonth = parseNamedMonthDate(raw);
  if (namedMonth) return namedMonth;
  var slashDate = parseSlashDate(raw);
  if (slashDate) return slashDate;
  var parsed = new Date(raw);
  if (!isNaN(parsed)) return parsed.toISOString().slice(0, 10);
  return "";
}

function isMissingValue(value) {
  var text = String(value || "").trim();
  return !text || text === "--";
}

function incrementDimension(map, key, missingLot, missingUnit) {
  var label = String(key || "").trim() || "--";
  if (!map[label]) {
    map[label] = {
      label: label,
      totalRows: 0,
      missingLotRows: 0,
      missingUnitOfMeasureRows: 0,
      missingBothRows: 0
    };
  }
  map[label].totalRows += 1;
  if (missingLot) map[label].missingLotRows += 1;
  if (missingUnit) map[label].missingUnitOfMeasureRows += 1;
  if (missingLot && missingUnit) map[label].missingBothRows += 1;
}

function toCoveragePct(numerator, denominator) {
  if (!(denominator > 0)) return 100;
  return Math.round((numerator / denominator) * 100);
}

function toProductionUnits(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  var parsed = parseFloat(String(value == null ? "" : value).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeProductionJob(row) {
  var raw = normalizeRawRow(row && Object.prototype.hasOwnProperty.call(row, "raw") ? row.raw : row);
  return {
    jobId: String(pickFieldLoose(raw, ["Job ID", "Job", "job_id"]) || row && row.job_id || "").trim(),
    workOrder: String(
      pickFieldLoose(raw, ["Work Order Code", "Work Order code", "work_order_code", "project_code", "Project Code"]) ||
      row && row.work_order_code || ""
    ).trim(),
    itemCode: String(pickFieldLoose(raw, ["Item Code", "Item code", "item_code", "SKU", "sku"]) || row && row.item_code || "").trim(),
    line: String(pickFieldLoose(raw, ["Line", "line", "line_name", "Line Name"]) || row && row.line || "").trim(),
    units: toProductionUnits(
      pickFieldLoose(raw, ["Units Produced", "Units produced", "units_produced", "Produced Units", "Quantity Produced", "Qty Produced"]) ||
      row && row.units_produced || 0
    )
  };
}

function aggregateProductionJobs(rows) {
  var jobs = {};
  (Array.isArray(rows) ? rows : []).forEach(function(row) {
    var normalized = normalizeProductionJob(row);
    if (!normalized.jobId || !(normalized.units > 0)) return;
    if (!jobs[normalized.jobId]) {
      jobs[normalized.jobId] = {
        jobId: normalized.jobId,
        workOrders: {},
        itemCodes: {},
        lines: {},
        units: 0
      };
    }
    var job = jobs[normalized.jobId];
    job.units += normalized.units;
    if (normalized.workOrder) job.workOrders[normalized.workOrder] = true;
    if (normalized.itemCode) job.itemCodes[normalized.itemCode] = true;
    if (normalized.line) job.lines[normalized.line] = true;
  });
  return jobs;
}

function sortedKeys(value) {
  return Object.keys(value || {}).sort(function(left, right) {
    return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
  });
}

export function reconcileProductionJobCoverage(sourceRows, storedRows) {
  var sourceJobs = aggregateProductionJobs(sourceRows);
  var storedJobs = aggregateProductionJobs(storedRows);
  var sourceIds = sortedKeys(sourceJobs);
  var storedIds = sortedKeys(storedJobs);
  var missingJobs = [];
  var extraJobs = [];
  var revisedJobs = [];
  var renamedWorkOrders = [];

  sourceIds.forEach(function(jobId) {
    var source = sourceJobs[jobId];
    var stored = storedJobs[jobId];
    if (!stored) {
      missingJobs.push({
        jobId: jobId,
        units: source.units,
        workOrders: sortedKeys(source.workOrders),
        itemCodes: sortedKeys(source.itemCodes),
        lines: sortedKeys(source.lines)
      });
      return;
    }
    if (source.units !== stored.units) {
      revisedJobs.push({
        jobId: jobId,
        sourceUnits: source.units,
        storedUnits: stored.units,
        unitDelta: source.units - stored.units
      });
    }
    var sourceWorkOrders = sortedKeys(source.workOrders);
    var storedWorkOrders = sortedKeys(stored.workOrders);
    if (sourceWorkOrders.join("|") !== storedWorkOrders.join("|")) {
      renamedWorkOrders.push({
        jobId: jobId,
        sourceWorkOrders: sourceWorkOrders,
        storedWorkOrders: storedWorkOrders
      });
    }
  });

  storedIds.forEach(function(jobId) {
    if (sourceJobs[jobId]) return;
    var stored = storedJobs[jobId];
    extraJobs.push({
      jobId: jobId,
      units: stored.units,
      workOrders: sortedKeys(stored.workOrders),
      itemCodes: sortedKeys(stored.itemCodes),
      lines: sortedKeys(stored.lines)
    });
  });

  return {
    sourceJobCount: sourceIds.length,
    storedJobCount: storedIds.length,
    sourceUnits: sourceIds.reduce(function(sum, jobId) { return sum + sourceJobs[jobId].units; }, 0),
    storedUnits: storedIds.reduce(function(sum, jobId) { return sum + storedJobs[jobId].units; }, 0),
    unitDelta: sourceIds.reduce(function(sum, jobId) { return sum + sourceJobs[jobId].units; }, 0) -
      storedIds.reduce(function(sum, jobId) { return sum + storedJobs[jobId].units; }, 0),
    missingJobs: missingJobs,
    extraJobs: extraJobs,
    revisedJobs: revisedJobs,
    renamedWorkOrders: renamedWorkOrders,
    reconciled: !missingJobs.length && !extraJobs.length && !revisedJobs.length && !renamedWorkOrders.length
  };
}

function sortDimensionRows(left, right) {
  if (right.missingLotRows !== left.missingLotRows) return right.missingLotRows - left.missingLotRows;
  if (right.missingUnitOfMeasureRows !== left.missingUnitOfMeasureRows) return right.missingUnitOfMeasureRows - left.missingUnitOfMeasureRows;
  if (right.missingBothRows !== left.missingBothRows) return right.missingBothRows - left.missingBothRows;
  if (right.totalRows !== left.totalRows) return right.totalRows - left.totalRows;
  return String(left.label || "").localeCompare(String(right.label || ""), undefined, { numeric: true, sensitivity: "base" });
}

function finalizeDimension(map, limit) {
  return Object.keys(map || {})
    .map(function(key) {
      var row = map[key];
      var rowsWithLotCode = row.totalRows - row.missingLotRows;
      var rowsWithUnitOfMeasure = row.totalRows - row.missingUnitOfMeasureRows;
      return {
        label: row.label,
        totalRows: row.totalRows,
        missingLotRows: row.missingLotRows,
        missingUnitOfMeasureRows: row.missingUnitOfMeasureRows,
        missingBothRows: row.missingBothRows,
        lotCoveragePct: toCoveragePct(rowsWithLotCode, row.totalRows),
        unitOfMeasureCoveragePct: toCoveragePct(rowsWithUnitOfMeasure, row.totalRows)
      };
    })
    .sort(sortDimensionRows)
    .slice(0, Math.max(1, Number(limit || 8)));
}

export function buildProductionCoverageAudit(rows, options) {
  var sourceRows = Array.isArray(rows) ? rows : [];
  var topLimit = Math.max(1, Number(options && options.topLimit || 8));
  var focusWorkOrders = Array.isArray(options && options.focusWorkOrders)
    ? options.focusWorkOrders.map(normalizeLookupKey).filter(Boolean)
    : [];
  var focusLookup = {};
  focusWorkOrders.forEach(function(key) {
    focusLookup[key] = true;
  });

  var totalRows = 0;
  var rowsWithLotCode = 0;
  var rowsWithUnitOfMeasure = 0;
  var rowsMissingLotCode = 0;
  var rowsMissingUnitOfMeasure = 0;
  var rowsMissingBoth = 0;
  var rowsFullyCovered = 0;
  var byDate = {};
  var byWorkOrder = {};
  var bySku = {};
  var byJob = {};

  sourceRows.forEach(function(row) {
    var raw = normalizeRawRow(row && Object.prototype.hasOwnProperty.call(row, "raw") ? row.raw : row);
    var workOrderCode = String(
      pickFieldLoose(raw, [
        "Work Order Code", "Work Order code", "work_order_code",
        "project_code", "Project Code"
      ]) || row && row.work_order_code || ""
    ).trim();
    if (focusWorkOrders.length && !focusLookup[normalizeLookupKey(workOrderCode)]) return;

    var lotCode = String(pickFieldLoose(raw, [
      "Lot Code", "Lot code", "lot_code",
      "Finished Good Lot Code", "finished_good_lot_code"
    ]) || "").trim();
    var unitOfMeasure = String(pickFieldLoose(raw, [
      "Unit of Measure", "Unit of measure", "unit_of_measure",
      "Unit Of Measure", "uom"
    ]) || "").trim();
    var producedDate = resolveProducedDateKey(
      pickFieldLoose(raw, [
        "Produced Date ET", "produced_date_et",
        "Produced date", "produced_date",
        "Produced At", "produced_at",
        "produced_at_utc",
        "Actual Job end date", "actual_job_end_at"
      ]) || row && (row.produced_date_et || row.produced_date || row.produced_at_utc) || ""
    );
    var sku = String(pickFieldLoose(raw, [
      "Item Code", "Item code", "item_code",
      "SKU", "sku"
    ]) || row && row.item_code || "").trim();
    var jobId = String(pickFieldLoose(raw, [
      "Job ID", "Job", "job_id"
    ]) || row && row.job_id || "").trim();

    var missingLot = isMissingValue(lotCode);
    var missingUnit = isMissingValue(unitOfMeasure);

    totalRows += 1;
    if (missingLot) rowsMissingLotCode += 1;
    else rowsWithLotCode += 1;
    if (missingUnit) rowsMissingUnitOfMeasure += 1;
    else rowsWithUnitOfMeasure += 1;
    if (missingLot && missingUnit) rowsMissingBoth += 1;
    if (!missingLot && !missingUnit) rowsFullyCovered += 1;

    incrementDimension(byDate, producedDate || "--", missingLot, missingUnit);
    incrementDimension(byWorkOrder, workOrderCode || "--", missingLot, missingUnit);
    incrementDimension(bySku, sku || "--", missingLot, missingUnit);
    incrementDimension(byJob, jobId || "--", missingLot, missingUnit);
  });

  return {
    totalRows: totalRows,
    rowsWithLotCode: rowsWithLotCode,
    rowsMissingLotCode: rowsMissingLotCode,
    lotCoveragePct: toCoveragePct(rowsWithLotCode, totalRows),
    rowsWithUnitOfMeasure: rowsWithUnitOfMeasure,
    rowsMissingUnitOfMeasure: rowsMissingUnitOfMeasure,
    unitOfMeasureCoveragePct: toCoveragePct(rowsWithUnitOfMeasure, totalRows),
    rowsMissingBoth: rowsMissingBoth,
    rowsFullyCovered: rowsFullyCovered,
    fullyCoveredPct: toCoveragePct(rowsFullyCovered, totalRows),
    focusWorkOrders: focusWorkOrders,
    topMissingDates: finalizeDimension(byDate, topLimit),
    topMissingWorkOrders: finalizeDimension(byWorkOrder, topLimit),
    topMissingSkus: finalizeDimension(bySku, topLimit),
    topMissingJobs: finalizeDimension(byJob, topLimit)
  };
}
