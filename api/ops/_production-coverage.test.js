import test from "node:test";
import assert from "node:assert/strict";
import { reconcileProductionJobCoverage } from "./_production-coverage.js";
import { buildProductionBackfillReconciliation } from "./_invoicing-production-backfill.js";
import { buildProductionIngestReconciliation } from "../cache/production-events.js";
import {
  isAuthorizedProductionCron,
  productionReconciliationWindow
} from "../cron/production-reconciliation.js";
import { buildJuly2026ProductionCompletenessFixture } from "./fixtures/july-2026-production-completeness.fixture.js";

test("July 2026 regression detects omitted, revised, and renamed Nulogy jobs", function() {
  var fixture = buildJuly2026ProductionCompletenessFixture();
  var result = reconcileProductionJobCoverage(fixture.sourceRows, fixture.storedRows);

  assert.equal(result.reconciled, false);
  assert.equal(result.sourceJobCount, fixture.expected.sourceJobCount);
  assert.equal(result.storedJobCount, fixture.expected.storedJobCount);
  assert.equal(result.sourceUnits, fixture.expected.sourceUnits);
  assert.equal(result.storedUnits, fixture.expected.storedUnits);
  assert.equal(result.unitDelta, fixture.expected.unitDelta);

  assert.deepEqual(result.missingJobs.map(function(row) { return row.jobId; }).sort(), fixture.expected.missingJobIds);
  assert.deepEqual(result.extraJobs, []);
  assert.deepEqual(result.revisedJobs.map(function(row) { return row.jobId; }).sort(), fixture.expected.revisedJobIds);
  assert.equal(
    result.revisedJobs.reduce(function(sum, row) { return sum + row.unitDelta; }, 0),
    fixture.expected.revisedUnitDelta
  );

  assert.equal(result.renamedWorkOrders.length, 1);
  assert.deepEqual(result.renamedWorkOrders[0], {
    jobId: fixture.expected.renamedJobId,
    sourceWorkOrders: [fixture.expected.sourceWorkOrder],
    storedWorkOrders: [fixture.expected.storedWorkOrder]
  });
});

test("production coverage reconciles when stored rows match the source", function() {
  var fixture = buildJuly2026ProductionCompletenessFixture();
  var result = reconcileProductionJobCoverage(fixture.sourceRows, fixture.sourceRows);

  assert.equal(result.reconciled, true);
  assert.deepEqual(result.missingJobs, []);
  assert.deepEqual(result.extraJobs, []);
  assert.deepEqual(result.revisedJobs, []);
  assert.deepEqual(result.renamedWorkOrders, []);
  assert.equal(result.unitDelta, 0);
});

test("production backfill reports a mismatch instead of success for the July incident", function() {
  var fixture = buildJuly2026ProductionCompletenessFixture();
  var result = buildProductionBackfillReconciliation(fixture.sourceRows, fixture.storedRows);

  assert.equal(result.status, "mismatch");
  assert.equal(result.reconciled, false);
  assert.equal(result.missingJobs.length, 16);
  assert.equal(result.revisedJobs.length, 3);
  assert.equal(result.renamedWorkOrders.length, 1);
});

test("routine production ingestion applies the same completeness control", function() {
  var fixture = buildJuly2026ProductionCompletenessFixture();
  var result = buildProductionIngestReconciliation(fixture.sourceRows, fixture.storedRows);

  assert.equal(result.status, "mismatch");
  assert.equal(result.sourceJobCount, 92);
  assert.equal(result.storedJobCount, 76);
  assert.equal(result.unitDelta, 38493);
});

test("partial source windows cannot silently replace or validate fuller stored production", function() {
  var fixture = buildJuly2026ProductionCompletenessFixture();
  var partialSource = fixture.sourceRows.slice(0, 20);
  var result = buildProductionIngestReconciliation(partialSource, fixture.sourceRows);

  assert.equal(result.reconciled, false);
  assert.equal(result.missingJobs.length, 0);
  assert.equal(result.extraJobs.length, 72);
});

test("scheduled reconciliation uses an inclusive 45-day rolling window", function() {
  assert.deepEqual(productionReconciliationWindow({ endDate: "2026-08-27", lookbackDays: 45 }), {
    startDate: "2026-07-14",
    endDate: "2026-08-27",
    lookbackDays: 45
  });
});

test("scheduled reconciliation requires the configured bearer secret", function() {
  assert.equal(isAuthorizedProductionCron({ headers: { authorization: "Bearer expected" } }, "expected"), true);
  assert.equal(isAuthorizedProductionCron({ headers: { authorization: "Bearer wrong" } }, "expected"), false);
  assert.equal(isAuthorizedProductionCron({ headers: {} }, ""), false);
});
