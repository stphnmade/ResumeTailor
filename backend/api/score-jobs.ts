import type { VercelRequest, VercelResponse } from "@vercel/node";
const { RESUME_MODES } = require("../lib/scoring.js");
const { scoreAllJobs, scoreSingleJob } = require("../lib/scoring-runner.js");

const { applyCors, readJsonBody, setJson } = require("./_lib/http");

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) {
    return;
  }

  if (req.method !== "POST") {
    setJson(res, 405, { error: "METHOD_NOT_ALLOWED" });
    return;
  }

  try {
    const body = await readJsonBody(req);
    const resumeMode = String(body?.resumeMode || "").trim();
    if (!RESUME_MODES.includes(resumeMode)) {
      setJson(res, 400, {
        error: `resumeMode is required and must be one of: ${RESUME_MODES.join(", ")}`,
      });
      return;
    }

    if (body?.jobId) {
      const result = await scoreSingleJob({
        jobId: String(body.jobId),
        resumeMode,
      });
      setJson(res, 200, { results: [result] });
      return;
    }

    const results = await scoreAllJobs({ resumeMode });
    setJson(res, 200, { results });
  } catch (error: any) {
    setJson(res, 500, { error: String(error?.message || error || "failed_to_score_jobs") });
  }
}
