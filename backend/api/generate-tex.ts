import type { VercelRequest, VercelResponse } from "@vercel/node";
import OpenAI from "openai";
import { access, readFile } from "node:fs/promises";
import path from "node:path";

const ALLOWED_ORIGIN = "https://stphnmade.github.io";
const OPENAI_REQUEST_TIMEOUT_MS = 45_000;
const OPENAI_MAX_RETRIES = 0;
const RESUME_MAX_OUTPUT_TOKENS = 3_200;

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
  experienceEntryCount: number;
  experienceBulletCount: number;
  projectBulletCount: number;
  estimatedLineCount: number;
  keywordCoverage: string[];
  keywordTargets: string[];
  requiredCoverage: number;
};

type ResumeBullet = {
  raw: string;
  content: string;
};

type ResumeEntry = {
  raw: string;
  headingText: string;
  bullets: ResumeBullet[];
  score: number;
  start: number;
  end: number;
  pinned: boolean;
  isCurrent: boolean;
};

type CompressionResult = {
  tex: string;
  removedProjects: string[];
  includedProjects: string[];
  removedExperienceHeadings: string[];
  estimatedLineCount: number;
  compressed: boolean;
};

type PromptContext = {
  systemPrompt: string;
  userPrompt: string;
  values: Record<string, string>;
  canonicalResume: string;
};

const RESUME_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["optimized_tex", "metadata"],
  properties: {
    optimized_tex: { type: "string" },
    metadata: {
      type: "object",
      additionalProperties: false,
      required: ["keyword_focus", "removed_projects", "included_projects"],
      properties: {
        keyword_focus: {
          type: "array",
          items: { type: "string" },
        },
        removed_projects: {
          type: "array",
          items: { type: "string" },
        },
        included_projects: {
          type: "array",
          items: { type: "string" },
        },
      },
    },
  },
} as const;

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

const START_LIST = "\\resumeItemListStart";
const END_LIST = "\\resumeItemListEnd";
const RESUME_ITEM = "\\resumeItem{";
const STOP_WORDS = new Set([
  "the", "and", "for", "with", "you", "your", "our", "a", "an", "to", "of", "in", "on",
  "is", "are", "as", "be", "or", "by", "this", "that", "will", "from", "using", "use",
  "have", "has", "we", "their", "at", "it", "role", "job", "work", "team", "support",
]);
const MAX_ESTIMATED_LINES = 56;

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
    systemPrompt,
    userPrompt,
  ] = await Promise.all([
    readFile(files.tailoringRules, "utf8"),
    readFile(files.allowedClaims, "utf8"),
    readFile(files.forbiddenClaims, "utf8"),
    readFile(files.formattingRules, "utf8"),
    readFile(files.atsGuidance, "utf8"),
    readFile(files.canonicalResume, "utf8"),
    readFile(files.systemPrompt, "utf8"),
    readFile(files.userPrompt, "utf8"),
  ]);

  return {
    systemPrompt,
    userPrompt,
    canonicalResume,
    values: {
      TAILORING_RULES: tailoringRules,
      ALLOWED_CLAIMS: allowedClaims,
      FORBIDDEN_CLAIMS: forbiddenClaims,
      FORMATTING_RULES: formattingRules,
      ATS_KEYWORDS_GUIDANCE: atsGuidance,
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

function extractSectionBody(tex: string, sectionName: string): string {
  const escapedSectionName = sectionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = tex.match(
    new RegExp(`\\\\section\\{${escapedSectionName}\\}([\\s\\S]*?)(?=\\\\section\\{|\\\\end\\{document\\})`)
  );
  return match?.[1] || "";
}

function replaceSectionBody(tex: string, sectionName: string, nextBody: string): string {
  const escapedSectionName = sectionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return tex.replace(
    new RegExp(`(\\\\section\\{${escapedSectionName}\\})([\\s\\S]*?)(?=\\\\section\\{|\\\\end\\{document\\})`),
    `$1${nextBody}`
  );
}

function findMatchingBrace(text: string, openBraceIndex: number): number {
  let depth = 0;
  for (let index = openBraceIndex; index < text.length; index += 1) {
    const char = text[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function extractBullets(text: string): ResumeBullet[] {
  const bullets: ResumeBullet[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const itemIndex = text.indexOf(RESUME_ITEM, cursor);
    if (itemIndex === -1) break;
    const braceIndex = itemIndex + "\\resumeItem".length;
    const closeIndex = findMatchingBrace(text, braceIndex);
    if (closeIndex === -1) break;

    bullets.push({
      raw: text.slice(itemIndex, closeIndex + 1),
      content: text.slice(braceIndex + 1, closeIndex).trim(),
    });

    cursor = closeIndex + 1;
  }

  return bullets;
}

function extractScoringTerms(jobDescription: string): string[] {
  const tokens = normalizeText(jobDescription)
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));

  const counts = new Map<string, number>();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) || 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 24)
    .map(([token]) => token);
}

function countTermHits(text: string, terms: string[]): number {
  const normalized = normalizeText(text);
  return terms.reduce((hits, term) => hits + (normalized.includes(term) ? 1 : 0), 0);
}

function extractEntries(sectionBody: string, macroName: string): ResumeEntry[] {
  const macro = `\\${macroName}`;
  const starts: number[] = [];
  let cursor = 0;

  while (cursor < sectionBody.length) {
    const index = sectionBody.indexOf(macro, cursor);
    if (index === -1) break;
    starts.push(index);
    cursor = index + macro.length;
  }

  return starts.map((start, idx) => {
    const end = idx + 1 < starts.length ? starts[idx + 1] : sectionBody.length;
    const raw = sectionBody.slice(start, end);
    const headingText = normalizeText(raw.slice(0, Math.min(raw.indexOf(START_LIST), 220)).trim() || raw.slice(0, 220));
    return {
      raw,
      headingText,
      bullets: extractBullets(raw),
      score: 0,
      start,
      end,
      pinned: false,
      isCurrent: /\bpresent\b/.test(headingText),
    };
  });
}

function rebuildSectionBodyWithEntries(sectionBody: string, entries: ResumeEntry[]): string {
  if (!entries.length) return sectionBody;

  const sorted = [...entries].sort((a, b) => a.start - b.start);
  const prefix = sectionBody.slice(0, sorted[0].start);
  const suffix = sectionBody.slice(sorted[sorted.length - 1].end);
  const middle = sorted.map((entry) => entry.raw.trim()).join("\n\n");

  return `${prefix}${middle}\n${suffix}`;
}

function scoreEntry(
  entry: ResumeEntry,
  jdTerms: string[],
  supportKeywordTargets: string[],
  section: "experience" | "projects"
): ResumeEntry {
  const rawText = normalizeText(entry.raw);
  const bulletText = entry.bullets.map((bullet) => bullet.content).join(" ");
  const keywordHits = countTermHits(rawText, jdTerms);
  const supportHits = countTermHits(rawText, supportKeywordTargets);
  const metrics = (bulletText.match(/\b\d+(?:\.\d+)?%?\b/g) || []).length;
  const pinned =
    entry.isCurrent ||
    (section === "experience" &&
      /\b(it|technical support|technician|helpdesk|support|health|jamf|google admin|tdx|office 365|network)\b/.test(rawText) &&
      supportHits > 0);

  return {
    ...entry,
    pinned,
    score:
      keywordHits * 2.5 +
      supportHits * 2 +
      Math.min(metrics, 3) * 0.5 +
      (entry.isCurrent ? 2 : 0) +
      (pinned ? 1.5 : 0),
  };
}

function trimEntryBullets(entry: ResumeEntry, maxBullets: number, jdTerms: string[]): ResumeEntry {
  if (!entry.bullets.length || entry.bullets.length <= maxBullets) return entry;

  const startIndex = entry.raw.indexOf(START_LIST);
  const endIndex = entry.raw.indexOf(END_LIST, startIndex + START_LIST.length);
  if (startIndex === -1 || endIndex === -1) return entry;

  const ranked = [...entry.bullets]
    .map((bullet) => ({
      ...bullet,
      score: countTermHits(bullet.content, jdTerms) * 2 + (/\b\d+(?:\.\d+)?%?\b/.test(bullet.content) ? 0.5 : 0),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, maxBullets);

  const selected = entry.bullets.filter((bullet) => ranked.some((candidate) => candidate.raw === bullet.raw));
  const prefix = entry.raw.slice(0, startIndex + START_LIST.length);
  const suffix = entry.raw.slice(endIndex);
  const nextRaw = `${prefix}\n${selected.map((bullet) => bullet.raw).join("\n")}\n${suffix}`;

  return {
    ...entry,
    raw: nextRaw,
    bullets: selected,
  };
}

function selectEntries(
  entries: ResumeEntry[],
  keepCount: number,
  jdTerms: string[],
  supportKeywordTargets: string[],
  section: "experience" | "projects"
): ResumeEntry[] {
  const scored = entries.map((entry) => scoreEntry(entry, jdTerms, supportKeywordTargets, section));
  const selected: ResumeEntry[] = [];

  const pinned = scored.filter((entry) => entry.pinned).sort((a, b) => b.score - a.score);
  for (const entry of pinned) {
    if (selected.length >= keepCount) break;
    if (!selected.some((candidate) => candidate.start === entry.start)) {
      selected.push(entry);
    }
  }

  for (const entry of [...scored].sort((a, b) => b.score - a.score)) {
    if (selected.length >= keepCount) break;
    if (!selected.some((candidate) => candidate.start === entry.start)) {
      selected.push(entry);
    }
  }

  return selected
    .sort((a, b) => a.start - b.start)
    .map((entry, idx) =>
      trimEntryBullets(
        entry,
        section === "experience" ? (idx === 0 ? 4 : 2) : 2,
        jdTerms
      )
    );
}

function estimateRenderedLines(tex: string): number {
  const sectionCount = countMatches(tex, /\\section\{/g);
  const experienceCount = countMatches(extractSectionBody(tex, "Experience"), /\\resumeSubheading\s*\{/g);
  const projectCount = countMatches(extractSectionBody(tex, "Projects"), /\\resumeProjectHeading\s*\{/g);
  const bullets = extractBullets(tex);
  const bulletLines = bullets.reduce((sum, bullet) => {
    const plain = normalizeText(bullet.content);
    return sum + Math.max(1, Math.ceil(plain.length / 88));
  }, 0);
  const skillsSection = extractSectionBody(tex, "Technical Skills");
  const skillsLines = Math.max(1, countMatches(skillsSection, /\\\\/g) + 1);

  return 3 + sectionCount * 2 + experienceCount * 2 + projectCount * 2 + bulletLines + skillsLines;
}

function compressResumeToOnePage(
  tex: string,
  jobDescription: string,
  supportKeywordTargets: string[]
): CompressionResult {
  const experienceBody = extractSectionBody(tex, "Experience");
  const projectsBody = extractSectionBody(tex, "Projects");
  if (!experienceBody || !projectsBody) {
    return {
      tex,
      removedProjects: [],
      includedProjects: [],
      removedExperienceHeadings: [],
      estimatedLineCount: estimateRenderedLines(tex),
      compressed: false,
    };
  }

  const jdTerms = extractScoringTerms(jobDescription);
  const experienceEntries = extractEntries(experienceBody, "resumeSubheading");
  const projectEntries = extractEntries(projectsBody, "resumeProjectHeading");
  if (!experienceEntries.length || !projectEntries.length) {
    return {
      tex,
      removedProjects: [],
      includedProjects: [],
      removedExperienceHeadings: [],
      estimatedLineCount: estimateRenderedLines(tex),
      compressed: false,
    };
  }

  let selectedExperience = selectEntries(experienceEntries, 3, jdTerms, supportKeywordTargets, "experience");
  let selectedProjects = selectEntries(projectEntries, 2, jdTerms, supportKeywordTargets, "projects");

  let nextTex = replaceSectionBody(
    tex,
    "Experience",
    rebuildSectionBodyWithEntries(experienceBody, selectedExperience)
  );
  nextTex = replaceSectionBody(
    nextTex,
    "Projects",
    rebuildSectionBodyWithEntries(projectsBody, selectedProjects)
  );

  let estimatedLineCount = estimateRenderedLines(nextTex);

  if (estimatedLineCount > MAX_ESTIMATED_LINES && selectedExperience.length > 2) {
    selectedExperience = selectEntries(experienceEntries, 2, jdTerms, supportKeywordTargets, "experience");
    nextTex = replaceSectionBody(
      tex,
      "Experience",
      rebuildSectionBodyWithEntries(experienceBody, selectedExperience)
    );
    nextTex = replaceSectionBody(
      nextTex,
      "Projects",
      rebuildSectionBodyWithEntries(projectsBody, selectedProjects)
    );
    estimatedLineCount = estimateRenderedLines(nextTex);
  }

  const includedProjects = selectedProjects.map((entry) => entry.headingText.slice(0, 120)).filter(Boolean);
  const removedProjects = projectEntries
    .filter((entry) => !selectedProjects.some((candidate) => candidate.start === entry.start))
    .map((entry) => entry.headingText.slice(0, 120))
    .filter(Boolean);
  const removedExperienceHeadings = experienceEntries
    .filter((entry) => !selectedExperience.some((candidate) => candidate.start === entry.start))
    .map((entry) => entry.headingText.slice(0, 120))
    .filter(Boolean);

  return {
    tex: nextTex,
    removedProjects,
    includedProjects,
    removedExperienceHeadings,
    estimatedLineCount,
    compressed:
      removedProjects.length > 0 ||
      removedExperienceHeadings.length > 0 ||
      nextTex !== tex,
  };
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
  const experienceSection = extractSectionBody(optimizedTex, "Experience");
  const projectsSection = extractSectionBody(optimizedTex, "Projects");
  const projectCount = countMatches(projectsSection, /\\resumeProjectHeading\s*\{/g);
  const bulletCount = countMatches(optimizedTex, /\\resumeItem\s*\{/g);
  const experienceEntryCount = countMatches(experienceSection, /\\resumeSubheading\s*\{/g);
  const experienceBulletCount = countMatches(experienceSection, /\\resumeItem\s*\{/g);
  const projectBulletCount = countMatches(projectsSection, /\\resumeItem\s*\{/g);
  const estimatedLineCount = estimateRenderedLines(optimizedTex);
  const keywordCoverage = computeKeywordCoverage(optimizedTex, keywordTargets);
  const requiredCoverage = Math.min(8, keywordTargets.length);

  const failures: string[] = [];
  if (projectCount < 2 || projectCount > 3) {
    failures.push(`PROJECT_COUNT_OUT_OF_RANGE:${projectCount}`);
  }
  if (experienceEntryCount < 2 || experienceEntryCount > 3) {
    failures.push(`EXPERIENCE_ENTRY_COUNT_OUT_OF_RANGE:${experienceEntryCount}`);
  }
  if (bulletCount < 11) {
    failures.push(`BULLET_COUNT_TOO_LOW:${bulletCount}`);
  }
  if (bulletCount > 16) {
    failures.push(`BULLET_COUNT_TOO_HIGH:${bulletCount}`);
  }
  if (experienceBulletCount > 10) {
    failures.push(`EXPERIENCE_BULLET_COUNT_TOO_HIGH:${experienceBulletCount}`);
  }
  if (projectBulletCount > 6) {
    failures.push(`PROJECT_BULLET_COUNT_TOO_HIGH:${projectBulletCount}`);
  }
  if (estimatedLineCount > MAX_ESTIMATED_LINES) {
    failures.push(`ESTIMATED_PAGE_OVERFLOW:${estimatedLineCount}`);
  }
  if (keywordCoverage.length < requiredCoverage) {
    failures.push(`KEYWORD_COVERAGE_TOO_LOW:${keywordCoverage.length}/${requiredCoverage}`);
  }

  return {
    ok: failures.length === 0,
    failures,
    projectCount,
    bulletCount,
    experienceEntryCount,
    experienceBulletCount,
    projectBulletCount,
    estimatedLineCount,
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
    "Keep LaTeX valid and keep the resume to one page.",
    `Current failures: ${validation.failures.join(", ")}`,
    "Required corrections:",
    "- keep only the strongest 2-3 experience entries",
    "- include 2 projects with strongest JD alignment unless a 3rd clearly still fits on one page",
    "- keep only the strongest 2-3 experience entries if needed for one page",
    "- ensure total bullet count is between 11 and 16",
    "- keep project bullets to 6 or fewer total",
    "- keep experience bullets to 10 or fewer total",
    "- compress bullets before adding detail",
    `- reduce estimated rendered line count to ${MAX_ESTIMATED_LINES} or less`,
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

function buildCanonicalLayoutGuidance(sourceResumeTex: string, canonicalResume: string): string {
  const normalizedSource = sourceResumeTex.trim();
  const normalizedCanonical = canonicalResume.trim();

  if (normalizedSource === normalizedCanonical) {
    return [
      "The candidate resume source is already the canonical layout baseline.",
      "Preserve its preamble, macros, section order, and visual structure exactly.",
      "Only tailor entry selection, bullet wording, and bullet counts within that existing layout.",
    ].join("\n");
  }

  return [
    "Use the candidate resume source as the direct LaTeX base.",
    "Match the canonical layout style: Jake-style one-page resume, same macro family, same section order.",
    "Preserve the candidate resume preamble exactly and do not redesign layout.",
  ].join("\n");
}

function buildPromptContext(
  promptContext: PromptContext,
  sourceResumeTex: string,
  sourceJobDescription: string,
  contextNotes: string,
  recruiterNotes: string
): string {
  return renderTemplate(promptContext.userPrompt, {
    ...promptContext.values,
    CANONICAL_RESUME: buildCanonicalLayoutGuidance(sourceResumeTex, promptContext.canonicalResume),
    RESUME_TEX: sourceResumeTex,
    JOB_DESCRIPTION: sourceJobDescription,
    CONTEXT_NOTES: contextNotes,
    RECRUITER_NOTES: recruiterNotes,
  });
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
    reasoning: { effort: "low" },
    max_output_tokens: RESUME_MAX_OUTPUT_TOKENS,
    text: {
      format: {
        type: "json_schema",
        name: "resume_tailor_output",
        strict: true,
        schema: RESUME_OUTPUT_SCHEMA,
      },
    },
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
  }, {
    timeout: OPENAI_REQUEST_TIMEOUT_MS,
    maxRetries: OPENAI_MAX_RETRIES,
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
    const { resume_tex, job_description, context_notes, recruiter_notes } = req.body ?? {};

    if (!resume_tex || !job_description) {
      return res.status(400).json({ error: "Missing input" });
    }

    const sourceResumeTex = String(resume_tex);
    const sourceJobDescription = String(job_description);
    const supportKeywordTargets = deriveSupportKeywordsFromJD(sourceJobDescription);

    const promptContext = await loadPromptAndRules();
    const renderedUserPrompt = buildPromptContext(
      promptContext,
      sourceResumeTex,
      sourceJobDescription,
      String(context_notes || "").trim() || "None provided.",
      String(recruiter_notes || "").trim() || "None provided."
    );

    const keySource = process.env.OPENAI_API_KEY ? "OPENAI_API_KEY" : "none";
    const apiKey = process.env.OPENAI_API_KEY;
    const model = process.env.OPENAI_MODEL || "gpt-5-mini";

    if (!apiKey) {
      return res.status(500).json({
        error: "Missing OPENAI_API_KEY",
        metadata: {
          optimizer: "error",
          model: "none",
          key_source: keySource,
          warning: "OPENAI_UNAVAILABLE",
          openai_tokens: {
            pass_1: zeroTokenUsage(),
            total: zeroTokenUsage(),
          },
        },
      });
    }

    const client = new OpenAI({
      apiKey,
      timeout: OPENAI_REQUEST_TIMEOUT_MS,
      maxRetries: OPENAI_MAX_RETRIES,
    });

    let firstPass: OptimizationPassResult;
    try {
      firstPass = await runOptimizationPass(client, model, promptContext.systemPrompt, renderedUserPrompt);
    } catch (openaiErr: any) {
      const details = summarizeError(openaiErr);
      return res.status(502).json({
        error: `OpenAI request failed: ${details.name}: ${details.message}`,
        metadata: {
          optimizer: "error",
          model,
          key_source: keySource,
          warning: "OPENAI_CONNECTION_ERROR",
          openai_error: details,
          openai_tokens: {
            pass_1: zeroTokenUsage(),
            total: zeroTokenUsage(),
          },
        },
      });
    }

    if (!firstPass.payload.optimizedTex) {
      return res.status(502).json({
        error: "Model returned invalid output: EMPTY_OPTIMIZED_TEX",
        metadata: {
          optimizer: "error",
          model,
          key_source: keySource,
          warning: "OPENAI_INVALID_OUTPUT",
          openai_response_id: firstPass.responseId,
          openai_tokens: {
            pass_1: firstPass.usage,
            total: firstPass.usage,
          },
        },
      });
    }

    let finalOutput = firstPass.payload;
    let compression = compressResumeToOnePage(firstPass.payload.optimizedTex, sourceJobDescription, supportKeywordTargets);
    finalOutput = {
      ...finalOutput,
      optimizedTex: compression.tex,
      removedProjects: [...new Set([...finalOutput.removedProjects, ...compression.removedProjects])],
      includedProjects:
        compression.includedProjects.length > 0
          ? compression.includedProjects
          : finalOutput.includedProjects,
    };
    let validation = validateOptimization(finalOutput.optimizedTex, supportKeywordTargets);
    const regenerationAttempted = false;
    let finalResponseId = firstPass.responseId;
    let totalTokenUsage = addTokenUsage(zeroTokenUsage(), firstPass.usage);

    const warnings: string[] = [];
    if (!validation.ok) {
      warnings.push(`POST_VALIDATION_FAILED:${validation.failures.join(",")}`);
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
        experience_entry_count: validation.experienceEntryCount,
        experience_bullet_count: validation.experienceBulletCount,
        project_bullet_count: validation.projectBulletCount,
        estimated_line_count: validation.estimatedLineCount,
        compressed_by_postprocessor: compression.compressed,
        removed_experience_entries: compression.removedExperienceHeadings,
        regeneration_attempted: regenerationAttempted,
        validator_failures: validation.failures,
        optimizer: "openai",
        model,
        warning: warnings.length ? warnings.join(" | ") : undefined,
        key_source: keySource,
        openai_response_id: finalResponseId,
        openai_tokens: {
          pass_1: firstPass.usage,
          total: totalTokenUsage,
        },
      },
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
