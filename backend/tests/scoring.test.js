const test = require("node:test");
const assert = require("node:assert/strict");
const { CURRENT_PROFILE_CONTEXT, scoreJob } = require("../lib/scoring.js");

test("strong IT Support role lands in priority review", () => {
  const result = scoreJob(
    {
      title: "IT Support Specialist",
      company: "Northwind Health",
      location: "Buffalo, NY",
      description:
        "Provide desktop support, Jamf administration, Google Admin support, printer troubleshooting, device imaging, and SLA-bound ticket resolution.",
      source: "linkedin",
    },
    "IT Support",
    CURRENT_PROFILE_CONTEXT
  );

  assert.ok(result.totalScore >= 80);
  assert.equal(result.scoreBand, "Priority review");
  assert.equal(result.archiveByDefault, false);
});

test("hybrid IT and automation roles receive the explicit boost", () => {
  const result = scoreJob(
    {
      title: "Systems Automation Analyst",
      company: "HarborOps",
      location: "Remote",
      description:
        "Blend support operations with Python scripting, SQL workflow automation, endpoint management, and internal systems troubleshooting.",
      source: "greenhouse",
    },
    "IT / Systems / Automation",
    CURRENT_PROFILE_CONTEXT
  );

  assert.ok(result.adjustments.some((item) => item.code === "hybrid_it_automation"));
  assert.ok(result.totalScore >= 80);
});

test("senior-only wording is penalized and archived by default when clearly over-level", () => {
  const result = scoreJob(
    {
      title: "Senior Staff Platform Engineer",
      company: "Atlas Runtime",
      location: "San Francisco, CA",
      description:
        "Requires 8+ years of experience leading Kubernetes platform strategy, distributed systems, and staff-level architecture decisions.",
      source: "linkedin",
    },
    "IT / Systems / Automation",
    CURRENT_PROFILE_CONTEXT
  );

  assert.ok(result.adjustments.some((item) => item.code === "senior_only_wording"));
  assert.ok(result.totalScore < 50);
  assert.equal(result.archiveByDefault, true);
});

test("bad stack mismatch is visible in scoring output", () => {
  const result = scoreJob(
    {
      title: "SAP ABAP Technical Lead",
      company: "BlueRidge ERP",
      location: "Chicago, IL",
      description:
        "Lead SAP ABAP customization, HANA integrations, and FICO-driven ERP delivery across a manufacturing environment.",
      source: "linkedin",
    },
    "Entry SWE / Developer",
    CURRENT_PROFILE_CONTEXT
  );

  assert.ok(result.adjustments.some((item) => item.code === "incompatible_stack"));
  assert.match(result.explanation, /Penalty: Job emphasizes SAP \/ ABAP enterprise stack/i);
});
