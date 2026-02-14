import type { VercelRequest, VercelResponse } from "@vercel/node";
import OpenAI from "openai";
import { access, readFile } from "node:fs/promises";
import path from "node:path";

const ALLOWED_ORIGIN = "https://stphnmade.github.io";

function setCors(res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

async function firstExistingPath(candidates: string[]): Promise<string | null> {
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Continue.
    }
  }
  return null;
}

async function resolveRulesRoot(): Promise<string> {
  const candidates = [
    path.resolve(process.cwd(), "source_of_truth"),
    path.resolve(process.cwd(), "../source_of_truth"),
    path.resolve(process.cwd(), "../../source_of_truth"),
    path.resolve(__dirname, "../source_of_truth"),
    path.resolve(__dirname, "../../source_of_truth"),
    path.resolve(__dirname, "../../../source_of_truth"),
  ];
  const resolved = await firstExistingPath(candidates);
  if (!resolved) {
    throw new Error("SOURCE_OF_TRUTH_NOT_FOUND");
  }
  return resolved;
}

async function resolvePromptsRoot(): Promise<string> {
  const candidates = [
    path.resolve(process.cwd(), "lib/prompts"),
    path.resolve(process.cwd(), "backend/lib/prompts"),
    path.resolve(__dirname, "../lib/prompts"),
    path.resolve(__dirname, "../../lib/prompts"),
  ];
  const resolved = await firstExistingPath(candidates);
  if (!resolved) {
    throw new Error("PROMPTS_DIRECTORY_NOT_FOUND");
  }
  return resolved;
}

async function loadPromptAndRules() {
  const rulesRoot = await resolveRulesRoot();
  const promptsRoot = await resolvePromptsRoot();

  const files = {
    tailoringRules: path.join(rulesRoot, "rules/tailoring_rules.md"),
    allowedClaims: path.join(rulesRoot, "rules/allowed_claims.md"),
    forbiddenClaims: path.join(rulesRoot, "rules/forbidden_claims.md"),
    formattingRules: path.join(rulesRoot, "rules/formatting_rules.md"),
    atsGuidance: path.join(rulesRoot, "rules/ats_keywords_guidance.md"),
    canonicalResume: path.join(rulesRoot, "resumes/stephen_syl_akinwale__resume__source.tex"),
    referenceJD: path.join(rulesRoot, "examples/job_descriptions/l1_engineer__incedo.txt"),
    systemPrompt: path.join(promptsRoot, "system.md"),
    userPrompt: path.join(promptsRoot, "user.md"),
  };

  const [
    tailoringRules,
    allowedClaims,
    forbiddenClaims,
    formattingRules,
    atsGuidance,
    canonicalResume,
    referenceJD,
    systemPrompt,
    userPrompt,
  ] = await Promise.all([
    readFile(files.tailoringRules, "utf8"),
    readFile(files.allowedClaims, "utf8"),
    readFile(files.forbiddenClaims, "utf8"),
    readFile(files.formattingRules, "utf8"),
    readFile(files.atsGuidance, "utf8"),
    readFile(files.canonicalResume, "utf8"),
    readFile(files.referenceJD, "utf8"),
    readFile(files.systemPrompt, "utf8"),
    readFile(files.userPrompt, "utf8"),
  ]);

  return {
    systemPrompt,
    userPrompt,
    values: {
      TAILORING_RULES: tailoringRules,
      ALLOWED_CLAIMS: allowedClaims,
      FORBIDDEN_CLAIMS: forbiddenClaims,
      FORMATTING_RULES: formattingRules,
      ATS_KEYWORDS_GUIDANCE: atsGuidance,
      CANONICAL_RESUME: canonicalResume,
      REFERENCE_JOB_DESCRIPTION: referenceJD,
    },
  };
}

function renderTemplate(template: string, values: Record<string, string>): string {
  let rendered = template;
  for (const [key, value] of Object.entries(values)) {
    rendered = rendered.split(`{{${key}}}`).join(value);
  }
  return rendered;
}

function extractJson(text: string): any {
  const trimmed = (text || "").trim();
  if (!trimmed) throw new Error("MODEL_EMPTY_RESPONSE");

  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      throw new Error("MODEL_JSON_PARSE_FAILED");
    }
    return JSON.parse(trimmed.slice(start, end + 1));
  }
}

function summarizeError(err: any) {
  const cause =
    typeof err?.cause === "string"
      ? err.cause
      : String(err?.cause?.message || err?.cause || "");

  return {
    name: String(err?.name || "Error"),
    message: String(err?.message || "unknown"),
    status:
      typeof err?.status === "number"
        ? err.status
        : typeof err?.statusCode === "number"
          ? err.statusCode
          : undefined,
    code: err?.code ? String(err.code) : undefined,
    type: err?.type ? String(err.type) : undefined,
    cause: cause ? cause.slice(0, 240) : undefined,
  };
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

    const { systemPrompt, userPrompt, values } = await loadPromptAndRules();
    const renderedUserPrompt = renderTemplate(userPrompt, {
      ...values,
      RESUME_TEX: String(resume_tex),
      JOB_DESCRIPTION: String(job_description),
    });

    const keySource = process.env.OPENAI_KEY
      ? "OPENAI_KEY"
      : process.env.OPENAI_API_KEY
        ? "OPENAI_API_KEY"
        : "none";
    const apiKey = process.env.OPENAI_KEY || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(200).json({
        optimized_tex: String(resume_tex),
        metadata: {
          keyword_focus: [],
          removed_projects: [],
          optimizer: "fallback",
          model: "none",
          warning: "OPENAI_UNAVAILABLE_FALLBACK",
          key_source: keySource,
        },
      });
    }

    const client = new OpenAI({ apiKey });
    let response;
    try {
      response = await client.responses.create({
        model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
        temperature: 0.2,
        input: [
          {
            role: "system",
            content: [{ type: "input_text", text: systemPrompt }],
          },
          {
            role: "user",
            content: [{ type: "input_text", text: renderedUserPrompt }],
          },
        ],
      });
    } catch (openaiErr: any) {
      const details = summarizeError(openaiErr);
      return res.status(200).json({
        optimized_tex: String(resume_tex),
        metadata: {
          keyword_focus: [],
          removed_projects: [],
          optimizer: "fallback",
          model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
          warning: `OPENAI_CONNECTION_ERROR_FALLBACK: ${details.name}: ${details.message}`,
          key_source: keySource,
          openai_error: details,
        },
      });
    }

    try {
      const parsed = extractJson(response.output_text || "");
      const optimizedTex = String(parsed?.optimized_tex || "").trim();
      const keywordFocus = Array.isArray(parsed?.metadata?.keyword_focus)
        ? parsed.metadata.keyword_focus.map((x: any) => String(x))
        : [];
      const removedProjects = Array.isArray(parsed?.metadata?.removed_projects)
        ? parsed.metadata.removed_projects.map((x: any) => String(x))
        : [];

      if (!optimizedTex) {
        return res.status(200).json({
          optimized_tex: String(resume_tex),
          metadata: {
            keyword_focus: [],
            removed_projects: [],
            optimizer: "fallback",
            model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
            warning: "OPENAI_INVALID_OUTPUT_FALLBACK: EMPTY_OPTIMIZED_TEX",
            key_source: keySource,
          },
        });
      }

      return res.status(200).json({
        optimized_tex: optimizedTex,
        metadata: {
          keyword_focus: keywordFocus,
          removed_projects: removedProjects,
          optimizer: "openai",
          model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
          key_source: keySource,
        },
      });
    } catch (parseErr: any) {
      return res.status(200).json({
        optimized_tex: String(resume_tex),
        metadata: {
          keyword_focus: [],
          removed_projects: [],
          optimizer: "fallback",
          model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
          warning: `OPENAI_INVALID_OUTPUT_FALLBACK: ${String(parseErr?.message || "unknown")}`,
          key_source: keySource,
        },
      });
    }
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
