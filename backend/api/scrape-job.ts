import type { VercelRequest, VercelResponse } from "@vercel/node";
// CommonJS helpers are shared with Node's built-in test runner.
// @ts-expect-error This repository does not generate declarations for JS API helpers.
import { applyCors, readJsonBody, setJson } from "./_lib/http.js";
// @ts-expect-error This repository does not generate declarations for JS service modules.
import { scrapeJobUrl } from "../lib/job-scraper.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;
  if (req.method !== "POST") return setJson(res, 405, { error: "METHOD_NOT_ALLOWED" });
  try {
    const body = await readJsonBody(req, 20_000);
    return setJson(res, 200, await scrapeJobUrl(body?.url));
  } catch (error: any) {
    const message = String(error?.name === "AbortError" ? "UPSTREAM_TIMEOUT" : error?.message || error);
    const status = /URL_|PRIVATE_|Invalid URL/.test(message) ? 400 : 502;
    return setJson(res, status, { error: message });
  }
}
