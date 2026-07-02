const MAX_DESCRIPTION_CHARS = 30_000;

function decodeHtml(value) {
  const entities = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return String(value || "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (match, name) => entities[name.toLowerCase()] ?? match);
}

function htmlToText(value) {
  return decodeHtml(String(value || "")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|section|article)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " "))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function normalizeDescription(value) {
  return htmlToText(value)
    .replace(/^Title:\s.*\nURL Source:\s.*\n(?:Published Time:\s.*\n)?(?:Markdown Content:\s*)?/i, "")
    .trim()
    .slice(0, MAX_DESCRIPTION_CHARS);
}

function walkJsonLd(value, results = []) {
  if (Array.isArray(value)) {
    value.forEach((item) => walkJsonLd(item, results));
  } else if (value && typeof value === "object") {
    const types = Array.isArray(value["@type"]) ? value["@type"] : [value["@type"]];
    if (types.some((type) => String(type).toLowerCase() === "jobposting")) results.push(value);
    if (value["@graph"]) walkJsonLd(value["@graph"], results);
  }
  return results;
}

function extractJobPosting(html) {
  const matches = String(html || "").matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const match of matches) {
    try {
      const jobs = walkJsonLd(JSON.parse(decodeHtml(match[1]).trim()));
      if (jobs.length) return jobs[0];
    } catch {
      // Invalid JSON-LD is common; visible content remains a valid fallback.
    }
  }
  return null;
}

function organizationName(value) {
  if (typeof value === "string") return value.trim();
  return String(value?.name || value?.legalName || "").trim();
}

function locationText(value) {
  const location = Array.isArray(value) ? value[0] : value;
  const address = location?.address || location || {};
  return [address.addressLocality, address.addressRegion, address.addressCountry?.name || address.addressCountry]
    .filter(Boolean).join(", ");
}

function inferCoverLetter(description) {
  const text = String(description || "");
  const required = [
    /(?:please|must|required to)\s+(?:include|submit|attach|provide)[^.\n]{0,50}cover letter/i,
    /cover letter\s+(?:is\s+)?(?:required|mandatory)/i,
    /applications?\s+without\s+(?:a\s+)?cover letter\s+will not/i,
  ];
  const prohibited = [
    /(?:do not|don't|no need to)\s+(?:include|submit|attach|send|provide)[^.\n]{0,35}cover letter/i,
    /(?:resume|cv)\s+only/i,
    /no cover letter(?:s)?(?:\s+(?:needed|required|please))?/i,
  ];
  const optional = [
    /cover letter\s+(?:is\s+)?optional/i,
    /(?:may|can)\s+(?:include|submit|attach)[^.\n]{0,35}cover letter/i,
  ];
  const find = (patterns) => patterns.map((pattern) => text.match(pattern)?.[0]).find(Boolean) || "";
  const noEvidence = find(prohibited);
  if (noEvidence) return { status: "not_required", recommended: false, confidence: "high", evidence: noEvidence };
  const requiredEvidence = find(required);
  if (requiredEvidence) return { status: "required", recommended: true, confidence: "high", evidence: requiredEvidence };
  const optionalEvidence = find(optional);
  if (optionalEvidence) return { status: "optional", recommended: true, confidence: "medium", evidence: optionalEvidence };
  return { status: "not_mentioned", recommended: false, confidence: "low", evidence: "No cover-letter instruction found." };
}

function inferSource(url) {
  const host = new URL(url).hostname.replace(/^www\./, "");
  if (host.endsWith("linkedin.com")) return "linkedin";
  if (host.endsWith("hiring.cafe")) return "hiring_cafe";
  return host;
}

function inferVisibleEntities(text, source) {
  const lines = String(text || "").split(/\r?\n/).map((line) => line.replace(/^#+\s*/, "").trim()).filter(Boolean);
  if (source === "hiring_cafe") {
    const titleIndex = lines.findIndex((line) => /^(?:job description|responsibilities|requirements)$/i.test(line));
    const header = (titleIndex > 0 ? lines.slice(0, titleIndex) : lines.slice(0, 30));
    const companyLine = header.find((line) => /^@\s*\S/.test(line));
    const company = companyLine?.replace(/^@\s*/, "").trim() || "";
    const companyIndex = companyLine ? header.indexOf(companyLine) : -1;
    const title = companyIndex > 0 ? header[companyIndex - 1] : "";
    return { title, company };
  }
  if (source === "linkedin") {
    const noise = /^(apply|save|sign in|join now|about the job|show more|see who|job function)$/i;
    const title = lines.find((line) => !noise.test(line) && /\b(engineer|developer|analyst|manager|specialist|support|administrator|consultant|designer|architect|scientist|coordinator|technician|associate|lead|director|intern|assistant)\b/i.test(line)) || "";
    const index = title ? lines.indexOf(title) : -1;
    const next = lines[index + 1] || "";
    const company = next.replace(/\s+(?:[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*),\s*[A-Z]{2}.*$/, "").trim();
    return { title, company: noise.test(company) ? "" : company };
  }
  return { title: "", company: "" };
}

function titleCaseSlug(value) {
  const preserved = new Map([["ibm", "IBM"], ["sap", "SAP"], ["ai", "AI"], ["it", "IT"]]);
  return String(value || "").split("-").filter(Boolean).map((part) =>
    preserved.get(part.toLowerCase()) || `${part.charAt(0).toUpperCase()}${part.slice(1)}`
  ).join(" ");
}

function linkedInSlugEntities(url) {
  let slug = "";
  try {
    slug = new URL(url).pathname.match(/\/jobs\/view\/([^/?#]+)/i)?.[1] || "";
  } catch {
    return { title: "", company: "" };
  }
  slug = slug.replace(/-\d+$/, "");
  const marker = slug.lastIndexOf("-at-");
  if (marker < 1) return { title: "", company: "" };
  return {
    title: titleCaseSlug(slug.slice(0, marker)),
    company: titleCaseSlug(slug.slice(marker + 4)),
  };
}

function trimSourceChrome(value, source) {
  const text = String(value || "");
  const lines = text.split(/\r?\n/);
  if (source === "hiring_cafe") {
    const indices = lines.map((line, index) => /^\s*Job Description\s*$/i.test(line) ? index : -1).filter((index) => index >= 0);
    if (indices.length) return lines.slice(indices[indices.length - 1] + 1).join("\n").trim();
  }
  if (source === "linkedin") {
    const aboutIndex = lines.findIndex((line) => /^\s*About the job\s*$/i.test(line.replace(/^#+\s*/, "")));
    if (aboutIndex >= 0) return lines.slice(aboutIndex + 1).join("\n").trim();
  }
  return text;
}

function extractClassContent(html, tag, className) {
  const pattern = new RegExp(`<${tag}[^>]*class=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  return pattern.exec(String(html || ""))?.[1] || "";
}

function extractLinkedInPosting(html) {
  const description = extractClassContent(html, "div", "show-more-less-html__markup");
  if (!description) return null;
  return {
    title: normalizeDescription(extractClassContent(html, "h1", "top-card-layout__title")),
    company: normalizeDescription(extractClassContent(html, "a", "topcard__org-name-link")),
    location: normalizeDescription(extractClassContent(html, "span", "topcard__flavor--bullet")),
    description: normalizeDescription(description),
  };
}

function parseJobPage({ url, html = "", text = "", extractionMethod = "direct" }) {
  const structured = extractJobPosting(html);
  const source = inferSource(url);
  const linkedInPosting = source === "linkedin" ? extractLinkedInPosting(html) : null;
  const visible = normalizeDescription(text || html);
  const inferred = inferVisibleEntities(visible, source);
  const slugEntities = source === "linkedin" ? linkedInSlugEntities(url) : { title: "", company: "" };
  const title = String(structured?.title || structured?.name || linkedInPosting?.title || inferred.title || slugEntities.title || "").trim();
  const company = organizationName(structured?.hiringOrganization) || linkedInPosting?.company || slugEntities.company || inferred.company;
  const description = normalizeDescription(structured?.description || linkedInPosting?.description || trimSourceChrome(visible, source));
  return {
    url,
    source,
    extraction_method: structured ? "json_ld" : linkedInPosting ? "linkedin_html" : extractionMethod,
    title,
    role: title,
    company,
    location: locationText(structured?.jobLocation) || String(structured?.jobLocationType || linkedInPosting?.location || ""),
    description,
    cover_letter: inferCoverLetter(description),
  };
}

module.exports = { decodeHtml, htmlToText, extractJobPosting, inferCoverLetter, parseJobPage };
