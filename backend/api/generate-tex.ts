import type { VercelRequest, VercelResponse } from "@vercel/node";
import OpenAI from "openai";
import { access, readFile } from "node:fs/promises";
import path from "node:path";

const ALLOWED_ORIGIN = "https://stphnmade.github.io";

type ModelPayload = {
  optimizedTex: string;
  keywordFocus: string[];
  removedProjects: string[];
  includedProjects: string[];
};

type TokenUsage = {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cached_input_tokens?: number;
  reasoning_output_tokens?: number;
};

type OptimizationPassResult = {
  payload: ModelPayload;
  usage: TokenUsage;
  responseId?: string;
};

type ValidationResult = {
  ok: boolean;
  failures: string[];
  projectCount: number;
  bulletCount: number;
  keywordCoverage: string[];
  keywordTargets: string[];
  requiredCoverage: number;
};

type SupportKeyword = {
  term: string;
  patterns: string[];
};

const SUPPORT_KEYWORDS: SupportKeyword[] = [
  { term: "technical support", patterns: ["technical support", "first-level support", "first level support", "l1 support", "helpdesk"] },
  { term: "troubleshooting", patterns: ["troubleshooting", "diagnosis", "debugging", "triage"] },
  { term: "incident management", patterns: ["incident", "incident management", "incident response"] },
  { term: "escalation", patterns: ["escalate", "escalation", "l2", "l3"] },
  { term: "standard operating procedures", patterns: ["sop", "standard operating procedure", "runbook"] },
  { term: "documentation", patterns: ["document", "documentation", "knowledge base"] },
  { term: "ticketing systems", patterns: ["ticket", "ticketing", "servicenow", "jira", "tdx"] },
  { term: "customer service", patterns: ["customer", "client", "service", "satisfaction"] },
  { term: "communication", patterns: ["communication", "stakeholder", "phone", "email", "chat"] },
  { term: "collaboration", patterns: ["collaboration", "team", "cross-functional", "cross functional"] },
  { term: "windows", patterns: ["windows"] },
  { term: "linux", patterns: ["linux"] },
  { term: "networking", patterns: ["network", "tcp/ip", "tcp", "dns"] },
  { term: "monitoring", patterns: ["monitor", "monitoring", "uptime", "performance"] },
  { term: "ownership", patterns: ["ownership", "urgency", "accountability"] },
];

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

function normalizeText(input: string): string {
  return (input || "")
    .toLowerCase()
    .replace(/\\_/g, " ")
    .replace(/\\textbf\{|\\textit\{|\\emph\{|\\href\{|\\small\{|\\scshape|\\Huge|\\vspace\{[^}]*\}/g, " ")
    .replace(/\\[a-zA-Z]+\*?(\[[^\]]*\])?(\{[^}]*\})?/g, " ")
    .replace(/[^a-z0-9+/.\-\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function includesAnyPattern(haystack: string, patterns: string[]): boolean {
  return patterns.some((pattern) => haystack.includes(pattern.toLowerCase()));
}

function deriveSupportKeywordsFromJD(jobDescription: string): string[] {
  const jd = normalizeText(jobDescription);
  const matched: string[] = [];

  for (const keyword of SUPPORT_KEYWORDS) {
    if (includesAnyPattern(jd, keyword.patterns)) {
      matched.push(keyword.term);
    }
  }

  if (matched.length < 8) {
    for (const keyword of SUPPORT_KEYWORDS) {
      if (!matched.includes(keyword.term)) {
        matched.push(keyword.term);
      }
      if (matched.length >= 8) {
        break;
      }
    }
  }

  return matched.slice(0, 12);
}

function countMatches(text: string, regex: RegExp): number {
  return (text.match(regex) || []).length;
}

function computeKeywordCoverage(optimizedTex: string, targets: string[]): string[] {
  const tex = normalizeText(optimizedTex);
  const covered: string[] = [];

  for (const term of targets) {
    const keyword = SUPPORT_KEYWORDS.find((item) => item.term === term);
    if (!keyword) continue;
    if (includesAnyPattern(tex, keyword.patterns)) {
      covered.push(term);
    }
  }

  return covered;
}

function validateOptimization(optimizedTex: string, keywordTargets: string[]): ValidationResult {
  const projectCount = countMatches(optimizedTex, /\\resumeProjectHeading\s*\{/g);
  const bulletCount = countMatches(optimizedTex, /\\resumeItem\s*\{/g);
  const keywordCoverage = computeKeywordCoverage(optimizedTex, keywordTargets);
  const requiredCoverage = Math.min(8, keywordTargets.length);

  const failures: string[] = [];
  if (projectCount < 2 || projectCount > 3) {
    failures.push(`PROJECT_COUNT_OUT_OF_RANGE:${projectCount}`);
  }
  if (bulletCount < 11) {
    failures.push(`BULLET_COUNT_TOO_LOW:${bulletCount}`);
  }
  if (keywordCoverage.length < requiredCoverage) {
    failures.push(`KEYWORD_COVERAGE_TOO_LOW:${keywordCoverage.length}/${requiredCoverage}`);
  }

  return {
    ok: failures.length === 0,
    failures,
    projectCount,
    bulletCount,
    keywordCoverage,
    keywordTargets,
    requiredCoverage,
  };
}

function buildCorrectionMessage(validation: ValidationResult): string {
  const missing = validation.keywordTargets.filter((item) => !validation.keywordCoverage.includes(item));

  return [
    "Regenerate once to satisfy deterministic constraints.",
    "Do not fabricate any content.",
    "Keep LaTeX valid and one-page dense.",
    `Current failures: ${validation.failures.join(", ")}`,
    "Required corrections:",
    "- include exactly 2-3 projects with strongest JD alignment",
    "- ensure total bullet count is at least 11",
    `- ensure keyword coverage reaches at least ${validation.requiredCoverage}`,
    `- add truthful language covering missing terms where evidence exists: ${missing.join(", ") || "none"}`,
  ].join("\n");
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

function zeroTokenUsage(): TokenUsage {
  return {
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    cached_input_tokens: 0,
    reasoning_output_tokens: 0,
  };
}

function addTokenUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    input_tokens: (a.input_tokens || 0) + (b.input_tokens || 0),
    output_tokens: (a.output_tokens || 0) + (b.output_tokens || 0),
    total_tokens: (a.total_tokens || 0) + (b.total_tokens || 0),
    cached_input_tokens: (a.cached_input_tokens || 0) + (b.cached_input_tokens || 0),
    reasoning_output_tokens: (a.reasoning_output_tokens || 0) + (b.reasoning_output_tokens || 0),
  };
}

function parseModelPayload(parsed: any): ModelPayload {
  const optimizedTex = String(parsed?.optimized_tex || "").trim();
  const keywordFocus = Array.isArray(parsed?.metadata?.keyword_focus)
    ? parsed.metadata.keyword_focus.map((x: any) => String(x))
    : [];
  const removedProjects = Array.isArray(parsed?.metadata?.removed_projects)
    ? parsed.metadata.removed_projects.map((x: any) => String(x))
    : [];
  const includedProjects = Array.isArray(parsed?.metadata?.included_projects)
    ? parsed.metadata.included_projects.map((x: any) => String(x))
    : [];

  return {
    optimizedTex,
    keywordFocus,
    removedProjects,
    includedProjects,
  };
}

async function runOptimizationPass(
  client: OpenAI,
  model: string,
  systemPrompt: string,
  baseUserPrompt: string,
  correctionMessage?: string
): Promise<OptimizationPassResult> {
  const effectiveUserPrompt = correctionMessage
    ? `${baseUserPrompt}\n\n[REGENERATION_CORRECTION]\n${correctionMessage}`
    : baseUserPrompt;

  const response = await client.responses.create({
    model,
    temperature: 0.2,
    input: [
      {
        role: "system",
        content: [{ type: "input_text", text: systemPrompt }],
      },
      {
        role: "user",
        content: [{ type: "input_text", text: effectiveUserPrompt }],
      },
    ],
  });

  const parsed = extractJson(response.output_text || "");
  const usageRaw: any = (response as any)?.usage || {};
  const inputTokens = Number(usageRaw?.input_tokens ?? usageRaw?.prompt_tokens ?? 0) || 0;
  const outputTokens = Number(usageRaw?.output_tokens ?? usageRaw?.completion_tokens ?? 0) || 0;
  const totalTokens = Number(usageRaw?.total_tokens ?? (inputTokens + outputTokens)) || 0;
  const cachedInputTokens = Number(usageRaw?.input_tokens_details?.cached_tokens ?? 0) || 0;
  const reasoningOutputTokens = Number(usageRaw?.output_tokens_details?.reasoning_tokens ?? 0) || 0;

  return {
    payload: parseModelPayload(parsed),
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: totalTokens,
      cached_input_tokens: cachedInputTokens,
      reasoning_output_tokens: reasoningOutputTokens,
    },
    responseId: (response as any)?.id ? String((response as any).id) : undefined,
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
    const { resume_tex, job_description, context_notes } = req.body ?? {};

    if (!resume_tex || !job_description) {
      return res.status(400).json({ error: "Missing input" });
    }

    const sourceResumeTex = String(resume_tex);
    const sourceJobDescription = String(job_description);
    const supportKeywordTargets = deriveSupportKeywordsFromJD(sourceJobDescription);

    const { systemPrompt, userPrompt, values } = await loadPromptAndRules();
    const renderedUserPrompt = renderTemplate(userPrompt, {
      ...values,
      RESUME_TEX: sourceResumeTex,
      JOB_DESCRIPTION: sourceJobDescription,
      CONTEXT_NOTES: String(context_notes || "").trim() || "None provided.",
    });

    const keySource = process.env.OPENAI_API_KEY ? "OPENAI_API_KEY" : "none";
    const apiKey = process.env.OPENAI_API_KEY;
    const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";

    if (!apiKey) {
      return res.status(200).json({
        optimized_tex: sourceResumeTex,
        metadata: {
          keyword_focus: [],
          keyword_coverage: [],
          support_keywords_target: supportKeywordTargets,
          coverage_required: Math.min(8, supportKeywordTargets.length),
          coverage_total: 0,
          removed_projects: [],
          included_projects: [],
          optimizer: "fallback",
          model: "none",
          warning: "OPENAI_UNAVAILABLE_FALLBACK",
          key_source: keySource,
          openai_tokens: {
            pass_1: zeroTokenUsage(),
            total: zeroTokenUsage(),
          },
        },
      });
    }

    const client = new OpenAI({ apiKey });

    let firstPass: OptimizationPassResult;
    try {
      firstPass = await runOptimizationPass(client, model, systemPrompt, renderedUserPrompt);
    } catch (openaiErr: any) {
      const details = summarizeError(openaiErr);
      return res.status(200).json({
        optimized_tex: sourceResumeTex,
        metadata: {
          keyword_focus: [],
          keyword_coverage: [],
          support_keywords_target: supportKeywordTargets,
          coverage_required: Math.min(8, supportKeywordTargets.length),
          coverage_total: 0,
          removed_projects: [],
          included_projects: [],
          optimizer: "fallback",
          model,
          warning: `OPENAI_CONNECTION_ERROR_FALLBACK: ${details.name}: ${details.message}`,
          key_source: keySource,
          openai_error: details,
          openai_tokens: {
            pass_1: zeroTokenUsage(),
            total: zeroTokenUsage(),
          },
        },
      });
    }

    if (!firstPass.payload.optimizedTex) {
      return res.status(200).json({
        optimized_tex: sourceResumeTex,
        metadata: {
          keyword_focus: [],
          keyword_coverage: [],
          support_keywords_target: supportKeywordTargets,
          coverage_required: Math.min(8, supportKeywordTargets.length),
          coverage_total: 0,
          removed_projects: [],
          included_projects: [],
          optimizer: "fallback",
          model,
          warning: "OPENAI_INVALID_OUTPUT_FALLBACK: EMPTY_OPTIMIZED_TEX",
          key_source: keySource,
          openai_response_id: firstPass.responseId,
          openai_tokens: {
            pass_1: firstPass.usage,
            total: firstPass.usage,
          },
        },
      });
    }

    let finalOutput = firstPass.payload;
    let validation = validateOptimization(firstPass.payload.optimizedTex, supportKeywordTargets);
    let regenerationAttempted = false;
    let regenerationFailedMessage = "";
    let finalResponseId = firstPass.responseId;
    let secondPassUsage: TokenUsage | undefined;
    let totalTokenUsage = addTokenUsage(zeroTokenUsage(), firstPass.usage);

    if (!validation.ok) {
      regenerationAttempted = true;
      const correctionMessage = buildCorrectionMessage(validation);
      try {
        const secondPass = await runOptimizationPass(
          client,
          model,
          systemPrompt,
          renderedUserPrompt,
          correctionMessage
        );
        secondPassUsage = secondPass.usage;
        finalResponseId = secondPass.responseId || finalResponseId;
        totalTokenUsage = addTokenUsage(totalTokenUsage, secondPass.usage);

        if (secondPass.payload.optimizedTex) {
          finalOutput = secondPass.payload;
          validation = validateOptimization(secondPass.payload.optimizedTex, supportKeywordTargets);
        }
      } catch (retryErr: any) {
        const retryDetails = summarizeError(retryErr);
        regenerationFailedMessage = `${retryDetails.name}: ${retryDetails.message}`;
      }
    }

    const warnings: string[] = [];
    if (!validation.ok) {
      warnings.push(`POST_VALIDATION_FAILED_AFTER_RETRY:${validation.failures.join(",")}`);
    }
    if (regenerationAttempted && regenerationFailedMessage) {
      warnings.push(`REGENERATION_REQUEST_FAILED:${regenerationFailedMessage}`);
    }

    return res.status(200).json({
      optimized_tex: finalOutput.optimizedTex,
      metadata: {
        keyword_focus: finalOutput.keywordFocus,
        keyword_coverage: validation.keywordCoverage,
        support_keywords_target: supportKeywordTargets,
        coverage_required: validation.requiredCoverage,
        coverage_total: validation.keywordCoverage.length,
        removed_projects: finalOutput.removedProjects,
        included_projects: finalOutput.includedProjects,
        project_count: validation.projectCount,
        bullet_count: validation.bulletCount,
        regeneration_attempted: regenerationAttempted,
        validator_failures: validation.failures,
        optimizer: "openai",
        model,
        warning: warnings.length ? warnings.join(" | ") : undefined,
        key_source: keySource,
        openai_response_id: finalResponseId,
        openai_tokens: {
          pass_1: firstPass.usage,
          pass_2: secondPassUsage,
          total: totalTokenUsage,
        },
      },
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
