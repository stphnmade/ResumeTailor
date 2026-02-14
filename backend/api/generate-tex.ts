import type { VercelRequest, VercelResponse } from "@vercel/node";

const ALLOWED_ORIGIN = "https://stphnmade.github.io";

function setCors(res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  setCors(res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const { resume_tex, job_description } = req.body ?? {};

    if (!resume_tex || !job_description) {
      return res.status(400).json({ error: "Missing input" });
    }

    // Temporary stub to verify routing works
    return res.status(200).json({
      optimized_tex: resume_tex,
      metadata: { keyword_focus: [] }
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
