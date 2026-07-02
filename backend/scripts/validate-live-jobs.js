const { scrapeJobUrl } = require("../lib/job-scraper.js");

const CASES = [
  {
    source: "HiringCafe",
    url: "https://hiring.cafe/job/software-engineer-software-developer-altamira-technologies-fairborn-iamcidcqmh8iwhh0",
    title: "Software Engineer/Software Developer",
    company: "Altamira Technologies",
  },
  {
    source: "HiringCafe",
    url: "https://hiring.cafe/job/software-engineer-lead-software-engineer-state-farm-bloomington-kac5xufceyhyds01",
    title: "Software Engineer/Lead Software Engineer",
    company: "State Farm",
  },
  {
    source: "HiringCafe",
    url: "https://hiring.cafe/job/software-engineer-world-travel-holdings-los-angeles-california-rxmk7e754jaz79dg",
    title: "Software Engineer",
    company: "World Travel Holdings",
  },
  {
    source: "LinkedIn",
    url: "https://www.linkedin.com/jobs/view/it-support-technician-at-state-of-utah-4427848549",
    title: "IT Support Technician",
    company: "State of Utah",
  },
  {
    source: "LinkedIn",
    url: "https://www.linkedin.com/jobs/view/2026-new-grad-software-engineer-full-stack-chicago-at-data2logistics-4411719408",
    title: "2026 New Grad | Software Engineer, Full-Stack (Chicago)",
    company: "Data2Logistics",
  },
  {
    source: "LinkedIn",
    url: "https://www.linkedin.com/jobs/view/software-engineer-graduate-cloud-native-infrastructure-2026-start-bs-ms-at-bytedance-4303534341",
    title: "Software Engineer Graduate (Cloud Native Infrastructure) - 2026 Start (BS/MS)",
    company: "ByteDance",
  },
];

function sameText(left, right) {
  return String(left || "").trim().toLowerCase() === String(right || "").trim().toLowerCase();
}

async function run() {
  const results = [];
  for (const item of CASES) {
    try {
      const parsed = await scrapeJobUrl(item.url);
      const checks = {
        title: sameText(parsed.title, item.title),
        company: sameText(parsed.company, item.company),
        description: parsed.description.length >= 500,
        chrome_free: !/Skip to main content|Sign in to view|jobs in United States/i.test(parsed.description.slice(0, 500)),
      };
      results.push({ ...item, ok: Object.values(checks).every(Boolean), checks, method: parsed.extraction_method, description_chars: parsed.description.length, cover_letter: parsed.cover_letter.status });
    } catch (error) {
      results.push({ ...item, ok: false, error: String(error?.message || error) });
    }
  }

  const passed = results.filter((result) => result.ok).length;
  const bySource = Object.fromEntries([...new Set(results.map((result) => result.source))].map((source) => {
    const sourceResults = results.filter((result) => result.source === source);
    return [source, { passed: sourceResults.filter((result) => result.ok).length, total: sourceResults.length }];
  }));
  console.log(JSON.stringify({ tested_at: new Date().toISOString(), passed, total: results.length, accuracy: passed / results.length, by_source: bySource, results }, null, 2));
  if (passed !== results.length) process.exitCode = 1;
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
