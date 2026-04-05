import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ApplicationStatus, createApplication, ensureSeedData, getApplications } from "../lib/data";

const { applyCors, readJsonBody, setJson } = require("./_lib/http");

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) {
    return;
  }

  await ensureSeedData();

  if (req.method === "GET") {
    const applications = await getApplications();
    setJson(res, 200, { applications });
    return;
  }

  if (req.method === "POST") {
    try {
      const body = await readJsonBody(req);
      if (!body?.jobId) {
        setJson(res, 400, { error: "jobId is required" });
        return;
      }

      const statusValue = body.status ? String(body.status) : ApplicationStatus.captured;
      const allowedStatuses = new Set(Object.values(ApplicationStatus));
      if (!allowedStatuses.has(statusValue as ApplicationStatus)) {
        setJson(res, 400, { error: "invalid status" });
        return;
      }

      const application = await createApplication({
        jobId: String(body.jobId),
        status: statusValue as ApplicationStatus,
        resumeId: body.resumeId ? String(body.resumeId) : null,
      });

      setJson(res, 201, { application });
    } catch (error: any) {
      setJson(res, 500, { error: String(error?.message || error || "failed_to_create_application") });
    }
    return;
  }

  setJson(res, 405, { error: "METHOD_NOT_ALLOWED" });
}
