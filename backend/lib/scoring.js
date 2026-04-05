const SCORE_WEIGHTS = {
  roleMatch: 0.3,
  skillsAlignment: 0.25,
  experienceAlignment: 0.2,
  seniorityFit: 0.1,
  locationFit: 0.05,
  resumeModeConfidence: 0.1,
};

const RESUME_MODES = [
  "IT Support",
  "IT / Systems / Automation",
  "Entry SWE / Developer",
  "Alternate PM",
];

const MODE_CONFIG = {
  "IT Support": {
    trackKey: "itSupport",
    roleKeywords: [
      "it support",
      "technical support",
      "desktop support",
      "help desk",
      "helpdesk",
      "service desk",
      "support specialist",
      "it technician",
      "support technician",
      "field technician",
      "endpoint support",
    ],
    skillKeywords: [
      "jamf",
      "google admin",
      "salesforce",
      "tdx",
      "office 365",
      "onedrive",
      "device imaging",
      "pxe",
      "windows",
      "macos",
      "printers",
      "sla",
      "ticket",
    ],
  },
  "IT / Systems / Automation": {
    trackKey: "systemsAutomation",
    roleKeywords: [
      "systems",
      "automation",
      "system administrator",
      "systems analyst",
      "endpoint engineer",
      "infrastructure",
      "operations",
      "workflow automation",
      "platform operations",
    ],
    skillKeywords: [
      "sql",
      "excel",
      "airtable",
      "python",
      "powershell",
      "scripting",
      "automation",
      "docker",
      "postgresql",
      "go",
      "grpc",
      "redis",
      "workflow",
      "api",
    ],
  },
  "Entry SWE / Developer": {
    trackKey: "entrySWE",
    roleKeywords: [
      "software engineer",
      "software developer",
      "frontend developer",
      "backend developer",
      "full stack",
      "web developer",
      "application developer",
      "junior engineer",
      "entry level engineer",
    ],
    skillKeywords: [
      "react",
      "typescript",
      "javascript",
      "node",
      "express",
      "postgresql",
      "sqlite",
      "docker",
      "aws",
      "go",
      "grpc",
      "next.js",
      "prisma",
      "tailwind",
      "html",
      "css",
    ],
  },
  "Alternate PM": {
    trackKey: "pmAdjacent",
    roleKeywords: [
      "project manager",
      "program manager",
      "product coordinator",
      "operations coordinator",
      "implementation specialist",
      "technical program",
      "customer success",
      "business analyst",
    ],
    skillKeywords: [
      "stakeholder",
      "coordination",
      "workflow",
      "agile",
      "figma",
      "balsamiq",
      "research",
      "documentation",
      "cross-functional",
      "onboarding",
    ],
  },
};

const CURRENT_PROFILE_CONTEXT = {
  identity: {
    name: "Stephen Syl-Akinwale",
    email: "stephensylak@gmail.com",
    github: "https://github.com/stphnmade",
    linkedin: "https://linkedin.com/in/stephen-syl-akinwale",
  },
  tracks: {
    itSupport: {
      strength: 0.95,
      evidence: [
        "Current IT Technician experience at Kaleida Health",
        "IT Technical Support role at eCornell",
        "Hands-on endpoint, printer, and migration support",
      ],
    },
    systemsAutomation: {
      strength: 0.84,
      evidence: [
        "SQL and Excel reporting automation at eCornell",
        "Airtable workflow automation",
        "Go, PostgreSQL, Docker, and workflow-heavy systems projects",
      ],
    },
    entrySWE: {
      strength: 0.73,
      evidence: [
        "Multiple recent software projects in React, TypeScript, Go, Next.js, and Node",
        "Cornell Information Science degree with programming coursework",
      ],
    },
    pmAdjacent: {
      strength: 0.61,
      evidence: [
        "Club co-president leadership",
        "Workflow coordination and onboarding improvements",
        "UX research and prototyping project work",
      ],
    },
  },
  knownSkills: [
    "jamf",
    "google admin",
    "salesforce",
    "tdx",
    "office 365",
    "onedrive",
    "windows",
    "macos",
    "device imaging",
    "pxe",
    "sql",
    "excel",
    "airtable",
    "python",
    "react",
    "typescript",
    "javascript",
    "node",
    "express",
    "go",
    "grpc",
    "postgresql",
    "sqlite",
    "docker",
    "aws",
    "redis",
    "next.js",
    "prisma",
    "tailwind",
    "google oauth",
    "figma",
    "balsamiq",
    "html",
    "css",
    "ffmpeg",
    "git",
    "github",
    "r",
    "quarto",
    "network troubleshooting",
    "printers",
    "barcode scanners",
  ],
  locationSignals: {
    knownCities: ["Buffalo, NY", "Ithaca, NY"],
    knownStates: ["NY"],
    remoteExperience: true,
    preferredArrangements: ["remote", "hybrid", "new york onsite"],
  },
};

const LOCATION_PATTERNS = {
  remote: /\bremote\b/i,
  hybrid: /\bhybrid\b/i,
  onsite: /\b(on[- ]site|onsite)\b/i,
};

const SENIORITY_PATTERNS = {
  entry: /\b(junior|entry|associate|new grad|graduate|l1|level 1|apprentice|intern)\b/i,
  mid: /\b(mid|intermediate|ii|level 2|l2)\b/i,
  senior: /\b(senior|sr\.?|lead|manager)\b/i,
  principal: /\b(staff|principal|director|head|architect|vp|vice president)\b/i,
};

const INCOMPATIBLE_STACK_RULES = [
  {
    label: "SAP / ABAP enterprise stack",
    pattern: /\b(sap|abap|hana|fico|bw\/4hana)\b/i,
  },
  {
    label: "iOS / Swift mobile stack",
    pattern: /\b(swift|ios|uikit|swiftui|xcode)\b/i,
  },
  {
    label: "Android / Kotlin mobile stack",
    pattern: /\b(android|kotlin|jetpack compose)\b/i,
  },
  {
    label: "Embedded / firmware stack",
    pattern: /\b(embedded|firmware|rtos|microcontroller|c\+\+ driver)\b/i,
  },
];

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function normalizeText(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9+#./ -]+/g, " ");
}

function includesPhrase(text, phrase) {
  return text.includes(normalizeText(phrase).trim());
}

function countKeywordHits(text, keywords) {
  const seen = new Set();
  for (const keyword of keywords) {
    if (includesPhrase(text, keyword)) {
      seen.add(keyword);
    }
  }
  return [...seen];
}

function detectSeniority(text) {
  if (SENIORITY_PATTERNS.principal.test(text)) {
    return "principal";
  }
  if (SENIORITY_PATTERNS.senior.test(text)) {
    return "senior";
  }
  if (SENIORITY_PATTERNS.entry.test(text)) {
    return "entry";
  }
  if (SENIORITY_PATTERNS.mid.test(text)) {
    return "mid";
  }
  return "unspecified";
}

function buildExplanation(summaryParts, adjustments) {
  const joined = summaryParts.filter(Boolean).join(" ");
  if (!adjustments.length) {
    return joined;
  }
  const visibleAdjustments = adjustments
    .map((adjustment) => `${adjustment.type === "boost" ? "Boost" : "Penalty"}: ${adjustment.reason}`)
    .join(" ");
  return `${joined} ${visibleAdjustments}`.trim();
}

function getScoreBand(score) {
  if (score >= 80) return "Priority review";
  if (score >= 65) return "Standard review";
  if (score >= 50) return "Low-confidence review";
  return "Archive by default";
}

function scoreRoleMatch(jobText, selectedMode, profileContext) {
  const config = MODE_CONFIG[selectedMode];
  const titleHits = countKeywordHits(normalizeText(jobText.title), config.roleKeywords);
  const descHits = countKeywordHits(normalizeText(jobText.description), config.roleKeywords);
  const trackStrength = profileContext.tracks[config.trackKey].strength;
  const raw = clamp(25 + titleHits.length * 24 + descHits.length * 8 + trackStrength * 20);
  return {
    rawScore: raw,
    notes: `Matched ${titleHits.length} role-title cues and ${descHits.length} description cues for ${selectedMode}.`,
  };
}

function scoreSkillsAlignment(jobText, selectedMode, profileContext) {
  const config = MODE_CONFIG[selectedMode];
  const text = normalizeText(`${jobText.title} ${jobText.description}`);
  const required = countKeywordHits(text, config.skillKeywords);
  const matched = required.filter((skill) => countKeywordHits(text, profileContext.knownSkills).includes(skill));
  const coverage = required.length ? matched.length / required.length : 0.55;
  const raw = clamp(required.length ? 35 + coverage * 65 : 58);
  return {
    rawScore: raw,
    notes: required.length
      ? `Matched ${matched.length} of ${required.length} visible job skills without inferring missing tools.`
      : "No strong explicit skill set was extracted from the job text, so this factor remains conservative.",
    requiredSkills: required,
    matchedSkills: matched,
  };
}

function scoreExperienceAlignment(jobText, selectedMode, profileContext) {
  const text = normalizeText(`${jobText.title} ${jobText.description}`);
  const itSignals = countKeywordHits(text, ["support", "help desk", "ticket", "sla", "desktop", "endpoint"]);
  const systemsSignals = countKeywordHits(text, ["systems", "automation", "scripting", "workflow", "sql", "infrastructure"]);
  const devSignals = countKeywordHits(text, ["react", "typescript", "javascript", "node", "backend", "frontend", "developer"]);
  const pmSignals = countKeywordHits(text, ["project", "program", "stakeholder", "coordination", "onboarding", "research"]);

  const config = MODE_CONFIG[selectedMode];
  const trackStrength = profileContext.tracks[config.trackKey].strength;

  let domainBonus = 0;
  if (selectedMode === "IT Support") {
    domainBonus = itSignals.length * 10 + systemsSignals.length * 2;
  } else if (selectedMode === "IT / Systems / Automation") {
    domainBonus = systemsSignals.length * 10 + itSignals.length * 5;
  } else if (selectedMode === "Entry SWE / Developer") {
    domainBonus = devSignals.length * 11 + systemsSignals.length * 3;
  } else if (selectedMode === "Alternate PM") {
    domainBonus = pmSignals.length * 10 + itSignals.length * 2;
  }

  return {
    rawScore: clamp(trackStrength * 68 + domainBonus),
    notes: `Experience alignment is based on documented profile strengths for ${selectedMode}.`,
  };
}

function scoreSeniorityFit(jobText) {
  const text = normalizeText(`${jobText.title} ${jobText.description}`);
  const seniority = detectSeniority(text);

  const mapping = {
    entry: 96,
    mid: 72,
    senior: 34,
    principal: 16,
    unspecified: 68,
  };

  return {
    rawScore: mapping[seniority],
    notes: `Detected likely seniority target: ${seniority}.`,
    detectedSeniority: seniority,
  };
}

function scoreLocationFit(jobText, profileContext) {
  const location = normalizeText(jobText.location);
  const description = normalizeText(jobText.description);
  const text = `${location} ${description}`;

  if (LOCATION_PATTERNS.remote.test(text)) {
    return {
      rawScore: profileContext.locationSignals.remoteExperience ? 92 : 75,
      notes: "Remote work is compatible with the profile's documented remote support experience.",
    };
  }

  if (LOCATION_PATTERNS.hybrid.test(text)) {
    return {
      rawScore: 84,
      notes: "Hybrid work is compatible with the current profile context.",
    };
  }

  const inNewYork = profileContext.locationSignals.knownStates.some((state) => location.includes(state.toLowerCase()));
  if (inNewYork) {
    return {
      rawScore: 82,
      notes: "On-site location is within the known New York footprint from the current profile.",
    };
  }

  if (LOCATION_PATTERNS.onsite.test(text)) {
    return {
      rawScore: 44,
      notes: "On-site requirement is outside the known location footprint, so this factor is conservative.",
    };
  }

  return {
    rawScore: 64,
    notes: "Location fit is neutral because the job text does not clearly specify a restrictive arrangement.",
  };
}

function scoreResumeModeConfidence(jobText, selectedMode, profileContext) {
  const config = MODE_CONFIG[selectedMode];
  const roleHits = countKeywordHits(normalizeText(`${jobText.title} ${jobText.description}`), config.roleKeywords);
  const skillHits = countKeywordHits(normalizeText(`${jobText.title} ${jobText.description}`), config.skillKeywords);
  const trackStrength = profileContext.tracks[config.trackKey].strength;
  return {
    rawScore: clamp(trackStrength * 70 + roleHits.length * 12 + skillHits.length * 4),
    notes: `Mode confidence reflects how well ${selectedMode} fits both the job text and the current profile.`,
  };
}

function buildAdjustments(jobText, selectedMode) {
  const text = normalizeText(`${jobText.title} ${jobText.description}`);
  const adjustments = [];

  const seniority = detectSeniority(text);
  if (seniority === "principal") {
    adjustments.push({
      type: "penalty",
      code: "senior_only_wording",
      points: -24,
      reason: 'Role uses staff/principal/director-level wording that is above the likely current target level.',
    });
  } else if (seniority === "senior") {
    adjustments.push({
      type: "penalty",
      code: "senior_only_wording",
      points: -14,
      reason: 'Role uses senior/lead wording that likely stretches beyond the current target level.',
    });
  }

  const stackMismatches = INCOMPATIBLE_STACK_RULES.filter((rule) => rule.pattern.test(text));
  if (stackMismatches.length) {
    adjustments.push({
      type: "penalty",
      code: "incompatible_stack",
      points: -16,
      reason: `Job emphasizes ${stackMismatches.map((rule) => rule.label).join(", ")}, which is not evidenced in the current profile.`,
    });
  }

  const hasItSignals = /\b(support|help desk|ticket|desktop|endpoint|technician)\b/i.test(text);
  const hasSystemsSignals = /\b(system|infrastructure|sql|endpoint|admin|operations)\b/i.test(text);
  const hasAutomationSignals = /\b(automation|script|scripting|workflow|python|powershell)\b/i.test(text);

  if ((selectedMode === "IT / Systems / Automation" || selectedMode === "IT Support") && hasItSignals && hasSystemsSignals && hasAutomationSignals) {
    adjustments.push({
      type: "boost",
      code: "hybrid_it_automation",
      points: 8,
      reason: "Job combines IT support, systems, and automation signals, which matches a strong hybrid profile area.",
    });
  }

  return adjustments;
}

function asWeightedFactor(key, label, weight, result) {
  return {
    key,
    label,
    weight,
    rawScore: Number(result.rawScore.toFixed(2)),
    weightedScore: Number((result.rawScore * weight).toFixed(2)),
    notes: result.notes,
  };
}

function summarizeProfileContext(profileContext) {
  return {
    tracks: profileContext.tracks,
    knownSkills: profileContext.knownSkills,
    locationSignals: profileContext.locationSignals,
  };
}

function scoreJob(job, selectedMode, profileContext = CURRENT_PROFILE_CONTEXT) {
  if (!RESUME_MODES.includes(selectedMode)) {
    throw new Error(`Unsupported resume mode: ${selectedMode}`);
  }

  const jobText = {
    title: String(job.title || ""),
    company: String(job.company || ""),
    location: String(job.location || ""),
    description: String(job.description || ""),
    source: String(job.source || ""),
  };

  const roleMatch = scoreRoleMatch(jobText, selectedMode, profileContext);
  const skillsAlignment = scoreSkillsAlignment(jobText, selectedMode, profileContext);
  const experienceAlignment = scoreExperienceAlignment(jobText, selectedMode, profileContext);
  const seniorityFit = scoreSeniorityFit(jobText, selectedMode, profileContext);
  const locationFit = scoreLocationFit(jobText, profileContext);
  const resumeModeConfidence = scoreResumeModeConfidence(jobText, selectedMode, profileContext);

  const factors = [
    asWeightedFactor("role_match", "Role match", SCORE_WEIGHTS.roleMatch, roleMatch),
    asWeightedFactor("skills_alignment", "Skills / keyword alignment", SCORE_WEIGHTS.skillsAlignment, skillsAlignment),
    asWeightedFactor("experience_alignment", "Experience alignment", SCORE_WEIGHTS.experienceAlignment, experienceAlignment),
    asWeightedFactor("seniority_fit", "Seniority fit", SCORE_WEIGHTS.seniorityFit, seniorityFit),
    asWeightedFactor("location_fit", "Location / work arrangement fit", SCORE_WEIGHTS.locationFit, locationFit),
    asWeightedFactor("resume_mode_confidence", "Resume mode confidence", SCORE_WEIGHTS.resumeModeConfidence, resumeModeConfidence),
  ];

  const adjustments = buildAdjustments(jobText, selectedMode);
  const weightedBase = factors.reduce((sum, factor) => sum + factor.weightedScore, 0);
  const adjustmentTotal = adjustments.reduce((sum, adjustment) => sum + adjustment.points, 0);
  const totalScore = clamp(Number((weightedBase + adjustmentTotal).toFixed(2)));
  const scoreBand = getScoreBand(totalScore);
  const archiveByDefault = totalScore < 50;

  const explanation = buildExplanation(
    [
      `${selectedMode} scores ${totalScore} for ${job.title} at ${job.company}.`,
      roleMatch.notes,
      skillsAlignment.notes,
      seniorityFit.notes,
    ],
    adjustments
  );

  return {
    resumeMode: selectedMode,
    totalScore,
    scoreBand,
    archiveByDefault,
    weightedBase: Number(weightedBase.toFixed(2)),
    adjustmentTotal,
    factors,
    adjustments,
    explanation,
    profileContextSummary: summarizeProfileContext(profileContext),
  };
}

function parseStoredScoreRecord(jobScore) {
  if (!jobScore) return null;
  let parsed = null;
  try {
    parsed = jobScore.explanation ? JSON.parse(jobScore.explanation) : null;
  } catch {
    parsed = null;
  }

  return {
    id: jobScore.id,
    score: jobScore.score,
    createdAt: jobScore.createdAt,
    explanation: parsed,
  };
}

module.exports = {
  CURRENT_PROFILE_CONTEXT,
  MODE_CONFIG,
  RESUME_MODES,
  SCORE_WEIGHTS,
  parseStoredScoreRecord,
  scoreJob,
  summarizeProfileContext,
};
