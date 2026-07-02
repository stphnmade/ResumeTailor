const dns = require("node:dns/promises");
const net = require("node:net");
const { parseJobPage } = require("./job-parser.js");

const DEFAULT_FETCH_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RESPONSE_BYTES = 1_500_000;
const MAX_REDIRECTS = 3;

function isPrivateIp(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  const normalized = String(address || "").toLowerCase();
  return normalized === "::" || normalized === "::1" || normalized.startsWith("fc") ||
    normalized.startsWith("fd") || normalized.startsWith("fe80:") || normalized.startsWith("::ffff:127.") ||
    normalized.startsWith("::ffff:10.") || normalized.startsWith("::ffff:192.168.");
}

async function validatePublicUrl(raw, lookup = dns.lookup) {
  let url;
  try {
    url = new URL(String(raw || ""));
  } catch {
    throw new Error("INVALID_URL");
  }
  if (url.protocol !== "https:") throw new Error("URL_MUST_USE_HTTPS");
  if (url.username || url.password) throw new Error("URL_CREDENTIALS_NOT_ALLOWED");
  if (!url.hostname || url.hostname === "localhost" || url.hostname.endsWith(".localhost")) {
    throw new Error("PRIVATE_NETWORK_URL_NOT_ALLOWED");
  }
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateIp(address))) {
    throw new Error("PRIVATE_NETWORK_URL_NOT_ALLOWED");
  }
  return url;
}

async function fetchLimited(rawUrl, headers, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const lookup = options.lookup || dns.lookup;
  const timeoutMs = options.timeoutMs || DEFAULT_FETCH_TIMEOUT_MS;
  const maxBytes = options.maxBytes || DEFAULT_MAX_RESPONSE_BYTES;
  let current = await validatePublicUrl(rawUrl, lookup);

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(current.href, { headers, redirect: "manual", signal: controller.signal });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) throw new Error(`UPSTREAM_${response.status}`);
        if (redirectCount === MAX_REDIRECTS) throw new Error("TOO_MANY_REDIRECTS");
        current = await validatePublicUrl(new URL(location, current).href, lookup);
        continue;
      }
      if (!response.ok) throw new Error(`UPSTREAM_${response.status}`);
      const contentType = response.headers.get("content-type") || "";
      if (options.requireHtml && !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
        throw new Error("UPSTREAM_NOT_HTML");
      }
      const declaredSize = Number(response.headers.get("content-length") || 0);
      if (declaredSize > maxBytes) throw new Error("UPSTREAM_RESPONSE_TOO_LARGE");

      let body;
      if (response.body?.getReader) {
        const reader = response.body.getReader();
        const chunks = [];
        let total = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > maxBytes) {
            await reader.cancel();
            throw new Error("UPSTREAM_RESPONSE_TOO_LARGE");
          }
          chunks.push(Buffer.from(value));
        }
        body = Buffer.concat(chunks, total).toString("utf8");
      } else {
        body = await response.text();
        if (Buffer.byteLength(body) > maxBytes) throw new Error("UPSTREAM_RESPONSE_TOO_LARGE");
      }
      return { body, finalUrl: current.href };
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("TOO_MANY_REDIRECTS");
}

function isExtractionFailure(text) {
  return /SecurityCompromiseError|Target URL returned error (?:4\d\d|5\d\d)|HiringCafe - Page Gone|Page not found|Job no longer available|This job is no longer available/i.test(text);
}

function isUsableJob(parsed) {
  return parsed.description?.length >= 120 && !isExtractionFailure(parsed.description) &&
    Boolean(parsed.title && parsed.company) &&
    !/\b\d[\d,+]*\s+.+ jobs? in\b/i.test(parsed.title) &&
    !/Skip to main content|Sign in to view|jobs in United States/i.test(parsed.description.slice(0, 500)) &&
    /[A-Za-z0-9]/.test(parsed.company) && !/^[\W_]+$/.test(parsed.company);
}

async function scrapeJobUrl(rawUrl, options = {}) {
  const lookup = options.lookup || dns.lookup;
  const target = await validatePublicUrl(rawUrl, lookup);
  let html = "";
  let finalUrl = target.href;
  let directError = "";
  try {
    const result = await fetchLimited(target.href, {
      "User-Agent": "Mozilla/5.0 (compatible; ResumeTailor/1.0)",
      Accept: "text/html,application/xhtml+xml",
    }, { ...options, lookup, requireHtml: true });
    html = result.body;
    finalUrl = result.finalUrl;
  } catch (error) {
    directError = String(error?.message || error);
  }

  let parsed = parseJobPage({ url: finalUrl, html, extractionMethod: "direct_html" });
  if (!isUsableJob(parsed)) {
    const readerUrl = `https://r.jina.ai/${target.href}`;
    const result = await fetchLimited(readerUrl, {
      Accept: "text/plain",
      "X-Retain-Images": "none",
      "X-Retain-Links": "text",
      "X-Timeout": "12",
    }, { ...options, lookup, requireHtml: false });
    if (isExtractionFailure(result.body)) throw new Error(directError || "JOB_CONTENT_NOT_FOUND");
    parsed = parseJobPage({ url: target.href, html, text: result.body, extractionMethod: "jina_reader" });
  }
  if (!isUsableJob(parsed)) throw new Error(directError || "JOB_CONTENT_NOT_FOUND");
  return parsed;
}

module.exports = { fetchLimited, isExtractionFailure, isPrivateIp, scrapeJobUrl, validatePublicUrl };
