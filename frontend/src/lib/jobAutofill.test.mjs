import test from "node:test";
import assert from "node:assert/strict";
import { extractRoleCompanyFromJD, shouldGenerateCoverLetter } from "./jobAutofill.mjs";
import { LINKEDIN_AUTOFILL_FIXTURES } from "./jobAutofillFixtures.mjs";

for (const fixture of LINKEDIN_AUTOFILL_FIXTURES) {
  test(`extracts LinkedIn autofill fields for ${fixture.name}`, () => {
    assert.deepEqual(extractRoleCompanyFromJD(fixture.input), fixture.expected);
  });
}

test("returns blank fields rather than polluting output with metadata-only content", () => {
  const sample = `Over 100 applicants
Actively reviewing applicants
Easy Apply
Save`;

  assert.deepEqual(extractRoleCompanyFromJD(sample), {
    company: "",
    role: "",
    title: "",
  });
});

test("cover-letter generation honors automatic inference and explicit overrides", () => {
  assert.equal(shouldGenerateCoverLetter("auto", { recommended: true }), true);
  assert.equal(shouldGenerateCoverLetter("auto", { recommended: false }), false);
  assert.equal(shouldGenerateCoverLetter("auto", null), false);
  assert.equal(shouldGenerateCoverLetter("include", { recommended: false }), true);
  assert.equal(shouldGenerateCoverLetter("skip", { recommended: true }), false);
});
