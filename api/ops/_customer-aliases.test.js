import test from "node:test";
import assert from "node:assert/strict";
import { matchCustomerName } from "./_customer-aliases.js";

test("matches a DBA name to the Nulogy customer", function() {
  var result = matchCustomerName("Electric Youth Inc dba GORGIE", ["Gorgie", "Monster Energy Company"]);
  assert.equal(result.matched, true);
  assert.equal(result.matchedName, "Gorgie");
  assert.equal(result.reason, "DBA matches Nulogy customer");
});

test("ignores common legal suffixes deterministically", function() {
  assert.equal(matchCustomerName("The Ryl Company LLC", ["The Ryl Company"]).matched, true);
});

test("normalizes punctuation and casing", function() {
  assert.equal(matchCustomerName("Two-Robbers Spirits Co.", ["Two Robbers Spirits Co"]).matched, true);
});

test("does not match unrelated customers", function() {
  assert.equal(matchCustomerName("Electric Youth Inc", ["Gorgie"]).matched, false);
});

test("returns ambiguity instead of choosing between equivalent candidates", function() {
  var result = matchCustomerName("Acme LLC", ["Acme", "Acme Inc"]);
  assert.equal(result.matched, false);
  assert.equal(result.ambiguous, true);
});
