import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ensureSeedData, getJobs, upsertJob } from "../lib/data";

const { applyCors, readJsonBody, setJson } = require("./_lib/http");

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) {
    return;
  }

  await ensureSeedData();

  if (req.method === "GET") {
    const jobs = await getJobs();
    setJson(res, 200, { jobs });
    return;
  }

  if (req.method === "POST") {
    try {
      const body = await readJsonBody(req);
      if (!body?.title || !body?.company || !body?.url || !body?.source) {
        setJson(res, 400, { error: "title, company, url, and source are required" });
        return;
      }

      const job = await upsertJob({
        title: String(body.title),
        company: String(body.company),
        location: body.location ? String(body.location) : null,
        description: body.description ? String(body.description) : null,
        url: String(body.url),
        source: String(body.source),
      });

      setJson(res, 200, { job });
    } catch (error: any) {
      setJson(res, 500, { error: String(error?.message || error || "failed_to_upsert_job") });
    }
    return;
  }

  setJson(res, 405, { error: "METHOD_NOT_ALLOWED" });
}
