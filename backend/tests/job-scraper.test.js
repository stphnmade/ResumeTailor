const test = require("node:test");
const assert = require("node:assert/strict");
const { scrapeJobUrl, validatePublicUrl } = require("../lib/job-scraper.js");

const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];

function response(body, { status = 200, contentType = "text/html", headers = {} } = {}) {
  const normalized = new Map(Object.entries({ "content-type": contentType, ...headers }).map(([key, value]) => [key.toLowerCase(), String(value)]));
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => normalized.get(String(name).toLowerCase()) || null },
    text: async () => body,
  };
}

test("scrapeJobUrl returns direct JSON-LD without invoking fallback", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return response(`<script type="application/ld+json">{"@type":"JobPosting","title":"Support Engineer","hiringOrganization":{"name":"Acme"},"description":"<p>Provide technical support to enterprise users and maintain reliable systems across a global organization.</p><p>Resume only; do not submit a cover letter.</p>"}</script>`);
  };
  const result = await scrapeJobUrl("https://jobs.example.com/support", { fetchImpl, lookup: publicLookup });
  assert.equal(calls, 1);
  assert.equal(result.extraction_method, "json_ld");
  assert.equal(result.company, "Acme");
  assert.equal(result.cover_letter.status, "not_required");
});

test("scrapeJobUrl falls back to Reader and extracts HiringCafe fields", async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    if (url.startsWith("https://r.jina.ai/")) {
      return response(`Title: IT Support Technician at Cumming Group\nURL Source: https://hiring.cafe/viewjob/qdd2rkfq8asrpek8\nMarkdown Content:\nPosted 3w ago\n## IT Support Technician\n@ Cumming Group\nColumbia, South Carolina, United States\nJob Description\nWe are currently hiring for an IT Support Technician supporting internal employees. Troubleshoot Windows, Microsoft 365, Active Directory, hardware, software, and network issues.`, { contentType: "text/plain" });
    }
    return response("<html><title>HiringCafe</title><body>Loading</body></html>");
  };
  const result = await scrapeJobUrl("https://hiring.cafe/viewjob/qdd2rkfq8asrpek8", { fetchImpl, lookup: publicLookup });
  assert.equal(urls.length, 2);
  assert.equal(result.extraction_method, "jina_reader");
  assert.equal(result.title, "IT Support Technician");
  assert.equal(result.company, "Cumming Group");
  assert.match(result.description, /^We are currently hiring/);
});

test("scrapeJobUrl validates every redirect target against SSRF", async () => {
  const lookup = async (hostname) => hostname === "internal.example" ? [{ address: "127.0.0.1", family: 4 }] : publicLookup();
  const fetchImpl = async () => response("", { status: 302, headers: { location: "https://internal.example/admin" } });
  await assert.rejects(
    scrapeJobUrl("https://jobs.example.com/support", { fetchImpl, lookup }),
    /PRIVATE_NETWORK_URL_NOT_ALLOWED/
  );
});

test("scrapeJobUrl rejects reader block pages instead of treating them as descriptions", async () => {
  const fetchImpl = async (url) => url.startsWith("https://r.jina.ai/")
    ? response('{"name":"SecurityCompromiseError","status":45102}', { contentType: "text/plain" })
    : response("<html><body>Sign in</body></html>");
  await assert.rejects(
    scrapeJobUrl("https://www.linkedin.com/jobs/view/support-engineer-at-acme-123", { fetchImpl, lookup: publicLookup }),
    /JOB_CONTENT_NOT_FOUND/
  );
});

test("validatePublicUrl rejects non-HTTPS and private address space", async () => {
  await assert.rejects(validatePublicUrl("http://example.com/job", publicLookup), /URL_MUST_USE_HTTPS/);
  await assert.rejects(validatePublicUrl("https://localhost/job", publicLookup), /PRIVATE_NETWORK_URL_NOT_ALLOWED/);
  await assert.rejects(validatePublicUrl("https://example.com/job", async () => [{ address: "10.0.0.8", family: 4 }]), /PRIVATE_NETWORK_URL_NOT_ALLOWED/);
});
