const MISSING_JOBS = [
  ["9516345", "July-Hugo SB", "Hugo-SB-6/4/250ml Can Case", "CLIMAX 2", 858],
  ["9516346", "July-Hugo GAM", "Hugo-GAM-6/4/250ml Can Case", "CLIMAX 2", 378],
  ["9516347", "July-Hugo PFruit", "Hugo-Pfruit-6/4/250ml Can Case", "CLIMAX 2", 431],
  ["9516350", "1731-BH 4pks", "Social Blackberry Hibiscus -6/4Pk", "CLIMAX 2", 104],
  ["9516364", "14193", "511-30-9905", "DMM", 17640],
  ["9516366", "450059516-60", "116495", "RSC", 4368],
  ["9519195", "450060323-70", "118354", "CLIMAX", 46],
  ["9520242", "Hey Now PO-0003", "HeyNow Lemonade & Tea VP 2126278307 -8pk", "CLIMAX", 1200],
  ["9521120", "July-Hugo PFruit", "Hugo-Pfruit-6/4/250ml Can Case", "CLIMAX 2", 287],
  ["9521121", "July-Hugo LDM", "Hugo-LDM-6/4/250ml Can Case", "CLIMAX 2", 280],
  ["9521126", "450059516-60", "116495", "RSC", 4144],
  ["9521537", "14193", "511-30-9905", "MPAC", 441],
  ["9521898", "2026-00-10811", "FMGOC-0003", "DMM", 104],
  ["9524816", "Hey Now PO-0003", "HeyNow Lemonade & Tea VP 2126278307 -8pk", "CLIMAX", 2500],
  ["9524818", "450060323-20", "114635", "RSC", 886],
  ["9524823", "2026-00-10811", "FMGOC-0003", "DMM", 2288]
];

const REVISED_JOBS = [
  ["9487566", "450060323-10", "114634", "RSC", 1439, 784],
  ["9489468", "450059516-70", "118354", "CLIMAX", 1960, 1400],
  ["9526388", "31329-Bailment", "AL-511-30-9905", "HANDPACK", 1470, 147]
];

function job(jobId, workOrder, itemCode, line, units) {
  return {
    job_id: jobId,
    work_order_code: workOrder,
    item_code: itemCode,
    line: line,
    units_produced: units
  };
}

function unchangedJobs() {
  var rows = [];
  // The unchanged controls are compact deterministic stand-ins. Their count and
  // units preserve the audited July totals while the incident rows below retain
  // the real job IDs, work orders, items, lines, and quantities.
  for (var index = 1; index <= 71; index += 1) {
    rows.push(job("JULY-CONTROL-" + String(index).padStart(2, "0"), "CONTROL-WO", "CONTROL-SKU", "CONTROL-LINE", 3000));
  }
  rows.push(job("JULY-CONTROL-72", "CONTROL-WO", "CONTROL-SKU", "CONTROL-LINE", 23859));
  rows.push(job("9550986", "31415-Bailment", "AL-511-30-9905", "HANDPACK", 1470));
  return rows;
}

export function buildJuly2026ProductionCompletenessFixture() {
  var unchanged = unchangedJobs();
  var sourceRows = unchanged
    .concat(MISSING_JOBS.map(function(row) { return job(row[0], row[1], row[2], row[3], row[4]); }))
    .concat(REVISED_JOBS.map(function(row) { return job(row[0], row[1], row[2], row[3], row[4]); }));
  var storedRows = unchanged
    .map(function(row) {
      return row.job_id === "9550986" ? Object.assign({}, row, { work_order_code: "31415" }) : Object.assign({}, row);
    })
    .concat(REVISED_JOBS.map(function(row) { return job(row[0], row[1], row[2], row[3], row[5]); }));

  return {
    sourceRows: sourceRows,
    storedRows: storedRows,
    expected: {
      sourceJobCount: 92,
      storedJobCount: 76,
      sourceUnits: 279153,
      storedUnits: 240660,
      unitDelta: 38493,
      missingJobIds: MISSING_JOBS.map(function(row) { return row[0]; }).sort(),
      revisedJobIds: REVISED_JOBS.map(function(row) { return row[0]; }).sort(),
      revisedUnitDelta: 2538,
      renamedJobId: "9550986",
      sourceWorkOrder: "31415-Bailment",
      storedWorkOrder: "31415"
    }
  };
}
