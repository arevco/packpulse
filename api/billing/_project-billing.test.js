import assert from "node:assert/strict";
import test from "node:test";

import { calculateChargeAmount, normalizeProjectInput } from "./_project-billing.js";

test("labor and fixed charges use quantity times billable rate", function() {
  assert.equal(calculateChargeAmount({ type: "labor", quantity: 12.5, billableRate: 68 }), 850);
  assert.equal(calculateChargeAmount({ type: "fixed", quantity: 2, billableRate: 125 }), 250);
});

test("expense charges apply markup after quantity and unit cost", function() {
  assert.equal(calculateChargeAmount({ type: "expense", quantity: 4, unitCost: 25, markupPct: 15 }), 115);
});

test("project input is normalized and totalled deterministically", function() {
  var result = normalizeProjectInput({
    customer: "  Acme  ", title: " Trailer rebuild ", occurredOn: "2026-09-02",
    charges: [
      { type: "labor", description: "Re-stack pallets", quantity: 16, billableRate: 72 },
      { type: "expense", description: "Stretch wrap", quantity: 2, unitCost: 18.5, markupPct: 10 }
    ]
  });
  assert.deepEqual(result.errors, []);
  assert.equal(result.customer, "Acme");
  assert.equal(result.total, 1192.7);
});

test("zero-value charges remain drafts rather than invoiceable work", function() {
  var result = normalizeProjectInput({
    customer: "Acme", title: "Unpriced work", occurredOn: "2026-09-02",
    charges: [{ type: "labor", description: "Pending rate", quantity: 2, billableRate: 0 }]
  });
  assert.match(result.errors.join(" "), /positive billable rate/);
});
