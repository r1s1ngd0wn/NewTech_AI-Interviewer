import test from "node:test";
import assert from "node:assert/strict";
import { plainText } from "../src/lib/plainText.js";

test("bold markers are removed", () => {
  assert.equal(plainText("**Matches:** you used PostgreSQL"), "Matches: you used PostgreSQL");
  assert.equal(plainText("a __b__ c"), "a b c");
});

test("star and dash bullets become real bullets, one per line", () => {
  assert.equal(plainText("Skills:\n* Java\n* Spring\n- SQL"), "Skills:\n• Java\n• Spring\n• SQL");
});

test("headings and inline code lose their markers", () => {
  assert.equal(plainText("## Gaps\nUse `Node.js` more"), "Gaps\nUse Node.js more");
});

test("ordinary text, numbers and a lone asterisk are left alone", () => {
  assert.equal(plainText("You scored 5 * 3 = 15 [1]."), "You scored 5 * 3 = 15 [1].");
  assert.equal(plainText("Well-known - a hyphen mid line"), "Well-known - a hyphen mid line");
});

test("null and undefined become an empty string", () => {
  assert.equal(plainText(null), "");
  assert.equal(plainText(undefined), "");
});
