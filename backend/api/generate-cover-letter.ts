import type { VercelRequest, VercelResponse } from "@vercel/node";
import OpenAI from "openai";
import { access, readFile } from "node:fs/promises";
import path from "node:path";

const ALLOWED_ORIGIN = "https://stphnmade.github.io";

type TokenUsage = {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cached_input_tokens?: number;
  reasoning_output_tokens?: number;
};

type LetterPayload = {
  bodyParagraphs: string[];
  closingSentence: string;
  skillsHighlighted: string[];
  evidenceUsed: string[];
};

type ContactInfo = {
  fullName: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
};

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

async function resolveTemplatesRoot(): Promise<string> {
  const candidates = [
    path.resolve(process.cwd(), "lib/templates"),
    path.resolve(process.cwd(), "backend/lib/templates"),
    path.resolve(__dirname, "../lib/templates"),
    path.resolve(__dirname, "../../lib/templates"),
  ];
  const resolved = await firstExistingPath(candidates);
  if (!resolved) {
    throw new Error("TEMPLATES_DIRECTORY_NOT_FOUND");
  }
  return resolved;
}

async function loadLetterContext() {
  const rulesRoot = await resolveRulesRoot();
  const promptsRoot = await resolvePromptsRoot();
  const templatesRoot = await resolveTemplatesRoot();

  const files = {
    tailoringRules: path.join(rulesRoot, "rules/tailoring_rules.md"),
    allowedClaims: path.join(rulesRoot, "rules/allowed_claims.md"),
    forbiddenClaims: path.join(rulesRoot, "rules/forbidden_claims.md"),
    canonicalResume: path.join(rulesRoot, "resumes/stephen_syl_akinwale__resume__source.tex"),
    systemPrompt: path.join(promptsRoot, "cover-letter-system.md"),
    userPrompt: path.join(promptsRoot, "cover-letter-user.md"),
    texTemplate: path.join(templatesRoot, "cover-letter-moderncv.tex"),
  };

  const [
    tailoringRules,
    allowedClaims,
    forbiddenClaims,
    canonicalResume,
    systemPrompt,
    userPrompt,
    texTemplate,
  ] = await Promise.all([
    readFile(files.tailoringRules, "utf8"),
    readFile(files.allowedClaims, "utf8"),
    readFile(files.forbiddenClaims, "utf8"),
    readFile(files.canonicalResume, "utf8"),
    readFile(files.systemPrompt, "utf8"),
    readFile(files.userPrompt, "utf8"),
    readFile(files.texTemplate, "utf8"),
  ]);

  return {
    systemPrompt,
    userPrompt,
    texTemplate,
    canonicalResume,
    values: {
      TAILORING_RULES: tailoringRules,
      ALLOWED_CLAIMS: allowedClaims,
      FORBIDDEN_CLAIMS: forbiddenClaims,
      CANONICAL_RESUME: canonicalResume,
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

function zeroTokenUsage(): TokenUsage {
  return {
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    cached_input_tokens: 0,
    reasoning_output_tokens: 0,
  };
}

function parseLetterPayload(parsed: any): LetterPayload {
  const bodyParagraphs = Array.isArray(parsed?.body_paragraphs)
    ? parsed.body_paragraphs.map((item: any) => String(item || "").trim()).filter(Boolean)
    : [];

  return {
    bodyParagraphs,
    closingSentence: String(parsed?.closing_sentence || "").trim(),
    skillsHighlighted: Array.isArray(parsed?.skills_highlighted)
      ? parsed.skills_highlighted.map((item: any) => String(item))
      : [],
    evidenceUsed: Array.isArray(parsed?.evidence_used)
      ? parsed.evidence_used.map((item: any) => String(item))
      : [],
  };
}

function splitName(fullName: string) {
  const parts = String(fullName || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) {
    return { firstName: "Stephen", lastName: "Syl-Akinwale" };
  }
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: "" };
  }
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" "),
  };
}

function extractContactInfoFromResume(resumeTex: string, fallbackResume: string): ContactInfo {
  const source = String(resumeTex || fallbackResume || "");
  const nameMatch = source.match(/\{\\Huge\s+\\scshape\s+([^}]*)\}/);
  const fullName = nameMatch?.[1]?.replace(/\\[a-zA-Z]+/g, " ").replace(/\s+/g, " ").trim() || "Stephen Syl-Akinwale";
  const email = source.match(/mailto:([^}]+)/)?.[1]?.trim() || "stephensylak@gmail.com";
  const phone =
    source.match(/\{\s*\\underline\{([^}]*(?:\+\d[^}]*)?)\}\s*\}/)?.[1]?.trim() ||
    source.match(/(\+\d[\d\s().-]{7,}\d)/)?.[1]?.trim() ||
    "";
  const { firstName, lastName } = splitName(fullName);

  return {
    fullName,
    firstName,
    lastName,
    email,
    phone,
  };
}

function cleanDetectionLine(value: string): string {
  return String(value || "")
    .replace(/^[\s\-*•|:]+/, "")
    .replace(/\s+/g, " ")
    .replace(/[|:]+$/g, "")
    .trim();
}

function detectRoleCompany(jobDescription: string) {
  const lines = String(jobDescription || "")
    .split(/\r?\n/)
    .map((line) => cleanDetectionLine(line))
    .filter(Boolean);

  const topLines = lines.slice(0, 12);
  let role = "";
  let company = "";

  for (const line of topLines) {
    if (!role) {
      const roleMatch = line.match(/\b(?:job title|title|role|position)\s*:?\s*([A-Z][A-Za-z0-9/&()\- ]{2,80}?)(?=[.,]|$)/i);
      if (roleMatch?.[1]) role = cleanDetectionLine(roleMatch[1]);
    }
    if (!company) {
      const companyMatch = line.match(/\b(?:company|organization|employer)\s*:?\s*([A-Z][A-Za-z0-9&.'\- ]{1,60})\b/i);
      if (companyMatch?.[1]) company = cleanDetectionLine(companyMatch[1]);
    }
    if (!role && /\b(engineer|developer|analyst|manager|specialist|support|administrator|consultant|designer|architect|scientist)\b/i.test(line)) {
      role = line;
    }
    if (!company && /\b(inc|llc|ltd|corp|company|technologies|technology|systems|solutions|labs|group|partners|university|health|bank|services|studio|media)\b/i.test(line)) {
      company = line;
    }
  }

  return { role, company };
}

function escapeLatexText(value: string): string {
  return String(value || "")
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/&/g, "\\&")
    .replace(/%/g, "\\%")
    .replace(/\$/g, "\\$")
    .replace(/#/g, "\\#")
    .replace(/_/g, "\\_")
    .replace(/{/g, "\\{")
    .replace(/}/g, "\\}")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}")
    .replace(/[“”]/g, '"')
    .replace(/[’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function buildLetterBody(bodyParagraphs: string[]): string {
  return bodyParagraphs
    .map((paragraph) => escapeLatexText(paragraph))
    .filter(Boolean)
    .join("\n\n\\par\n\n");
}

function buildFallbackPayload(roleName: string, companyName: string, tone: string): LetterPayload {
  const role = roleName || "the role";
  const company = companyName || "your team";
  const toneLead = tone === "confident" ? "I am excited" : tone === "warm" ? "I would welcome the opportunity" : "I am writing";

  return {
    bodyParagraphs: [
      `${toneLead} to apply for ${role} at ${company}. My background combines technical support, product-minded problem solving, and cross-functional collaboration, and I am motivated by opportunities where strong user service and reliable execution matter.`,
      `Across my experience in IT support and project delivery, I have resolved user issues, improved operational workflows, and communicated clearly with stakeholders while working across tools such as Jamf, Google Admin, Salesforce, SQL, and modern web stacks.`,
      `I would bring a practical, user-centered approach to ${role}, with an emphasis on troubleshooting, accountability, and translating technical work into a better experience for the people relying on the systems your team supports.`,
    ],
    closingSentence: "Thank you for your time and consideration. I would welcome the opportunity to discuss how my experience could support your team.",
    skillsHighlighted: ["technical support", "communication", "troubleshooting"],
    evidenceUsed: ["IT technical support", "cross-functional collaboration", "workflow improvement"],
  };
}

function buildCoverLetterTex(
  template: string,
  contact: ContactInfo,
  payload: LetterPayload,
  companyName: string,
  hiringManager: string
): string {
  return renderTemplate(template, {
    FIRST_NAME: escapeLatexText(contact.firstName),
    LAST_NAME: escapeLatexText(contact.lastName),
    EMAIL: escapeLatexText(contact.email),
    PHONE: escapeLatexText(contact.phone),
    RECIPIENT_NAME: escapeLatexText(hiringManager || "Hiring Manager"),
    RECIPIENT_COMPANY: escapeLatexText(companyName || ""),
    OPENING: escapeLatexText(`Dear ${hiringManager || "Hiring Manager"},`),
    BODY_CONTENT: buildLetterBody(payload.bodyParagraphs),
    CLOSING_SENTENCE: escapeLatexText(payload.closingSentence),
  });
}

async function runLetterPass(
  client: OpenAI,
  model: string,
  systemPrompt: string,
  userPrompt: string
): Promise<{ payload: LetterPayload; usage: TokenUsage; responseId?: string }> {
  const response = await client.responses.create({
    model,
    temperature: 0.3,
    input: [
      {
        role: "system",
        content: [{ type: "input_text", text: systemPrompt }],
      },
      {
        role: "user",
        content: [{ type: "input_text", text: userPrompt }],
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
    payload: parseLetterPayload(parsed),
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const {
      resume_tex,
      job_description,
      context_notes,
      role_name,
      company_name,
      hiring_manager,
      tone,
      length,
    } = req.body ?? {};

    if (!job_description) {
      return res.status(400).json({ error: "Missing job description" });
    }

    const { systemPrompt, userPrompt, texTemplate, canonicalResume, values } =
      await loadLetterContext();

    const sourceResumeTex = String(resume_tex || canonicalResume || "");
    const sourceJobDescription = String(job_description || "");
    const contextNotes = String(context_notes || "").trim() || "None provided.";
    const detected = detectRoleCompany(sourceJobDescription);
    const resolvedRoleName = String(role_name || "").trim() || detected.role || "the target role";
    const resolvedCompanyName = String(company_name || "").trim() || detected.company || "the company";
    const resolvedHiringManager = String(hiring_manager || "").trim();
    const resolvedTone = String(tone || "professional").trim();
    const resolvedLength = String(length || "standard").trim();

    const renderedUserPrompt = renderTemplate(userPrompt, {
      ...values,
      RESUME_TEX: sourceResumeTex,
      JOB_DESCRIPTION: sourceJobDescription,
      CONTEXT_NOTES: contextNotes,
      ROLE_NAME: resolvedRoleName,
      COMPANY_NAME: resolvedCompanyName,
      HIRING_MANAGER: resolvedHiringManager || "Hiring Manager",
      TONE: resolvedTone,
      LENGTH: resolvedLength,
    });

    const keySource = process.env.OPENAI_API_KEY ? "OPENAI_API_KEY" : "none";
    const apiKey = process.env.OPENAI_API_KEY;
    const model = process.env.OPENAI_MODEL || "gpt-5.2";
    const contact = extractContactInfoFromResume(sourceResumeTex, canonicalResume);

    if (!apiKey) {
      const fallbackPayload = buildFallbackPayload(resolvedRoleName, resolvedCompanyName, resolvedTone);
      return res.status(200).json({
        cover_letter_tex: buildCoverLetterTex(
          texTemplate,
          contact,
          fallbackPayload,
          resolvedCompanyName,
          resolvedHiringManager
        ),
        metadata: {
          skills_highlighted: fallbackPayload.skillsHighlighted,
          evidence_used: fallbackPayload.evidenceUsed,
          tone: resolvedTone,
          length: resolvedLength,
          optimizer: "fallback",
          model: "none",
          warning: "OPENAI_UNAVAILABLE_FALLBACK",
          key_source: keySource,
          openai_tokens: {
            total: zeroTokenUsage(),
          },
        },
      });
    }

    const client = new OpenAI({ apiKey });

    try {
      const result = await runLetterPass(client, model, systemPrompt, renderedUserPrompt);
      const payload =
        result.payload.bodyParagraphs.length >= 3 && result.payload.closingSentence
          ? result.payload
          : buildFallbackPayload(resolvedRoleName, resolvedCompanyName, resolvedTone);

      return res.status(200).json({
        cover_letter_tex: buildCoverLetterTex(
          texTemplate,
          contact,
          payload,
          resolvedCompanyName,
          resolvedHiringManager
        ),
        metadata: {
          skills_highlighted: payload.skillsHighlighted,
          evidence_used: payload.evidenceUsed,
          tone: resolvedTone,
          length: resolvedLength,
          optimizer: "openai",
          model,
          key_source: keySource,
          openai_response_id: result.responseId,
          openai_tokens: {
            total: result.usage,
          },
        },
      });
    } catch (openaiErr: any) {
      const details = summarizeError(openaiErr);
      const fallbackPayload = buildFallbackPayload(resolvedRoleName, resolvedCompanyName, resolvedTone);
      return res.status(200).json({
        cover_letter_tex: buildCoverLetterTex(
          texTemplate,
          contact,
          fallbackPayload,
          resolvedCompanyName,
          resolvedHiringManager
        ),
        metadata: {
          skills_highlighted: fallbackPayload.skillsHighlighted,
          evidence_used: fallbackPayload.evidenceUsed,
          tone: resolvedTone,
          length: resolvedLength,
          optimizer: "fallback",
          model,
          warning: `OPENAI_CONNECTION_ERROR_FALLBACK: ${details.name}: ${details.message}`,
          key_source: keySource,
          openai_error: details,
          openai_tokens: {
            total: zeroTokenUsage(),
          },
        },
      });
    }
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
