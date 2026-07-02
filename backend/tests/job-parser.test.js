const test = require("node:test");
const assert = require("node:assert/strict");
const { inferCoverLetter, parseJobPage } = require("../lib/job-parser.js");

test("parses a HiringCafe-style JSON-LD posting", () => {
  const job = parseJobPage({
    url: "https://hiring.cafe/viewjob/yvspjf5ynav738b8",
    html: `<script type="application/ld+json">{"@context":"https://schema.org","@type":"JobPosting","title":"FullStack Software Engineer, Codex App","hiringOrganization":{"name":"OpenAI"},"jobLocation":{"address":{"addressLocality":"San Francisco","addressRegion":"CA","addressCountry":"US"}},"description":"<h2>About the Team</h2><p>Build the systems that power Codex. Please submit a resume and cover letter.</p>"}</script>`,
  });
  assert.equal(job.title, "FullStack Software Engineer, Codex App");
  assert.equal(job.company, "OpenAI");
  assert.equal(job.location, "San Francisco, CA, US");
  assert.equal(job.cover_letter.status, "required");
  assert.equal(job.extraction_method, "json_ld");
});

test("keeps LinkedIn reader text and infers no unmentioned cover letter", () => {
  const job = parseJobPage({
    url: "https://www.linkedin.com/jobs/view/4363592311",
    text: "Title: Frontend Software Engineer - University Graduate 2026\nURL Source: https://www.linkedin.com/jobs/view/4363592311\nMarkdown Content:\n# Frontend Software Engineer - University Graduate 2026\nVerkada San Mateo, CA\nWho We Are\nVerkada builds cloud physical security products.\nWhat You'll Do\nBuild product experiences across React and React Native.",
    extractionMethod: "jina_reader",
  });
  assert.match(job.description, /Verkada builds cloud physical security/);
  assert.equal(job.title, "Frontend Software Engineer - University Graduate 2026");
  assert.equal(job.company, "Verkada");
  assert.equal(job.cover_letter.status, "not_mentioned");
  assert.equal(job.cover_letter.recommended, false);
});

test("cover-letter inference supports explicit skip and optional language", () => {
  assert.equal(inferCoverLetter("Resume only. Do not submit a cover letter.").status, "not_required");
  assert.equal(inferCoverLetter("A cover letter is optional.").status, "optional");
});

test("extracts LinkedIn's guest job description container without navigation chrome", () => {
  const job = parseJobPage({
    url: "https://www.linkedin.com/jobs/view/it-support-technician-at-state-of-utah-4427848549",
    html: `<html><body><h1 class="top-card-layout__title">IT Support Technician</h1><a class="topcard__org-name-link">State of Utah</a><span class="topcard__flavor topcard__flavor--bullet">Salt Lake City, UT</span><div class="description__text"><div class="show-more-less-html__markup show-more-less-html__markup--clamp-after-5"><p>This is an entry-level technical position focused on first-contact support.</p><ul><li>Resolve service requests.</li><li>Support agency users and hardware.</li></ul><p>Please attach a cover letter with your application.</p></div></div><footer>LinkedIn navigation noise</footer></body></html>`,
  });
  assert.equal(job.extraction_method, "linkedin_html");
  assert.equal(job.title, "IT Support Technician");
  assert.equal(job.company, "State of Utah");
  assert.equal(job.location, "Salt Lake City, UT");
  assert.doesNotMatch(job.description, /navigation noise/);
  assert.equal(job.cover_letter.status, "required");
});
