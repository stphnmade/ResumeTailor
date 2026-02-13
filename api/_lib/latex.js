const BEGIN_DOC = '\\begin{document}';
const END_DOC = '\\end{document}';
const MAX_RESUME_BYTES = 200 * 1024;
const MAX_JD_CHARS = 30000;

const SECTION_REGEX = /\\section\{([^}]+)\}/g;

const START_LIST = '\\resumeItemListStart';
const END_LIST = '\\resumeItemListEnd';
const RESUME_ITEM = '\\resumeItem{';

const TECH_TERMS = [
  'aws', 'azure', 'gcp', 'docker', 'kubernetes', 'terraform', 'linux', 'unix', 'bash',
  'python', 'java', 'golang', 'go', 'typescript', 'javascript', 'react', 'next.js', 'nextjs',
  'node', 'nodejs', 'express', 'postgresql', 'mysql', 'sqlite', 'redis', 'mongodb', 'sql',
  'graphql', 'rest', 'api', 'git', 'github', 'gitlab', 'jira', 'salesforce', 'zendesk',
  'servicenow', 'tableau', 'powerbi', 'excel', 'figma', 'html', 'css', 'tailwind', 'vite',
  'prisma', 'netlify', 'vercel', 'lambda', 'cloudfront', 's3', 'ec2', 'ecs', 'fargate',
  'ci/cd', 'jenkins', 'circleci', 'github actions', 'agile', 'scrum', 'kanban', 'c++', 'c#',
  'r', 'matlab', 'snowflake', 'databricks', 'spark', 'hadoop', 'ffmpeg'
];

function validateInputs(resumeTex, jobDescription) {
  if (typeof resumeTex !== 'string' || !resumeTex.trim()) {
    throw new Error('RESUME_REQUIRED');
  }

  const bytes = Buffer.byteLength(resumeTex, 'utf8');
  if (bytes > MAX_RESUME_BYTES) {
    throw new Error('RESUME_TOO_LARGE');
  }

  if (!resumeTex.includes(BEGIN_DOC) || !resumeTex.includes(END_DOC)) {
    throw new Error('RESUME_LATEX_INVALID');
  }

  if (typeof jobDescription !== 'string' || !jobDescription.trim()) {
    throw new Error('JOB_DESCRIPTION_REQUIRED');
  }

  if (jobDescription.length > MAX_JD_CHARS) {
    throw new Error('JOB_DESCRIPTION_TOO_LARGE');
  }
}

function validateResumeTex(resumeTex) {
  if (typeof resumeTex !== 'string' || !resumeTex.trim()) {
    throw new Error('RESUME_REQUIRED');
  }

  const bytes = Buffer.byteLength(resumeTex, 'utf8');
  if (bytes > MAX_RESUME_BYTES) {
    throw new Error('RESUME_TOO_LARGE');
  }

  if (!resumeTex.includes(BEGIN_DOC) || !resumeTex.includes(END_DOC)) {
    throw new Error('RESUME_LATEX_INVALID');
  }
}

function splitPreambleAndBody(tex) {
  const beginIdx = tex.indexOf(BEGIN_DOC);
  const endIdx = tex.lastIndexOf(END_DOC);
  if (beginIdx === -1 || endIdx === -1 || endIdx <= beginIdx) {
    throw new Error('RESUME_LATEX_INVALID');
  }

  return {
    preamble: tex.slice(0, beginIdx),
    body: tex.slice(beginIdx, endIdx + END_DOC.length),
    beginIdx,
    endIdx,
  };
}

function parseSections(tex) {
  const sections = [];
  let match;
  while ((match = SECTION_REGEX.exec(tex)) !== null) {
    sections.push({
      name: match[1].trim(),
      index: match.index,
      endIndex: match.index + match[0].length,
    });
  }

  const withRanges = sections.map((section, i) => {
    const next = sections[i + 1];
    return {
      ...section,
      contentStart: section.endIndex,
      contentEnd: next ? next.index : tex.length,
      content: tex.slice(section.endIndex, next ? next.index : tex.length),
    };
  });

  return withRanges;
}

function sectionForIndex(index, sections) {
  let current = 'Unknown';
  for (const section of sections) {
    if (section.index > index) break;
    current = section.name;
  }
  return current;
}

function findMatchingBrace(text, openBraceIndex) {
  let depth = 0;
  for (let i = openBraceIndex; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function parseBullets(inner) {
  const bullets = [];
  let cursor = 0;

  while (cursor < inner.length) {
    const itemIdx = inner.indexOf(RESUME_ITEM, cursor);
    if (itemIdx === -1) break;

    const openIdx = itemIdx + '\\resumeItem'.length;
    const closeIdx = findMatchingBrace(inner, openIdx);
    if (closeIdx === -1) break;

    const raw = inner.slice(itemIdx, closeIdx + 1);
    const content = inner.slice(openIdx + 1, closeIdx).trim();

    bullets.push({
      start: itemIdx,
      end: closeIdx + 1,
      raw,
      content,
    });

    cursor = closeIdx + 1;
  }

  return bullets;
}

function parseListBlocks(tex) {
  const blocks = [];
  let cursor = 0;

  while (cursor < tex.length) {
    const start = tex.indexOf(START_LIST, cursor);
    if (start === -1) break;

    const innerStart = start + START_LIST.length;
    const end = tex.indexOf(END_LIST, innerStart);
    if (end === -1) break;

    const inner = tex.slice(innerStart, end);
    const bullets = parseBullets(inner);

    blocks.push({
      start,
      end: end + END_LIST.length,
      innerStart,
      innerEnd: end,
      inner,
      bullets,
    });

    cursor = end + END_LIST.length;
  }

  return blocks;
}

function toPlain(text) {
  return text
    .replace(/\\[A-Za-z@]+/g, ' ')
    .replace(/[{}~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(text) {
  return new Set(
    (text.toLowerCase().match(/[a-z0-9.+#/-]+/g) || [])
      .flatMap((token) => token.split(/[/-]/g))
      .filter((token) => token.length >= 2)
  );
}

function extractKeywords(jobDescription, limit = 30) {
  const stop = new Set([
    'the', 'and', 'for', 'with', 'you', 'your', 'our', 'a', 'an', 'to', 'of', 'in',
    'on', 'is', 'are', 'as', 'be', 'or', 'by', 'this', 'that', 'will', 'from', 'using',
    'use', 'have', 'has', 'we', 'their', 'at', 'it'
  ]);

  const tokens = (jobDescription.toLowerCase().match(/[a-z0-9.+#/-]+/g) || [])
    .flatMap((token) => token.split(/[/-]/g))
    .filter((token) => token.length >= 3 && !stop.has(token));

  const counts = new Map();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) || 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([token]) => token);
}

function extractTechTerms(text) {
  const lower = text.toLowerCase();
  const found = [];
  for (const term of TECH_TERMS) {
    const normalized = term.toLowerCase();
    const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(^|[^a-z0-9+#])${escaped}([^a-z0-9+#]|$)`, 'i');
    if (re.test(lower)) found.push(normalized);
  }
  return [...new Set(found)].sort();
}

function countEstimatedLines(tex) {
  const lines = tex.split('\n').length;
  const bulletChars = (tex.match(/\\resumeItem\{/g) || []).length * 22;
  return lines + Math.round(bulletChars / 90);
}

function scoreBullet(content, keywords) {
  const plain = toPlain(content);
  const tokens = tokenize(plain);
  const keywordHits = keywords.filter((kw) => tokens.has(kw)).length;
  const metrics = /\b\d+(?:\.\d+)?%?\b/.test(plain) ? 1 : 0;
  return keywordHits * 2 + metrics * 0.4;
}

function createSectionMap(sections) {
  const out = {};
  for (const section of sections) {
    out[section.name] = section.content;
  }
  return out;
}

function optimizeDeterministic(resumeTex, jobDescription) {
  const sections = parseSections(resumeTex);
  const blocks = parseListBlocks(resumeTex);
  const keywords = extractKeywords(jobDescription, 32);
  const removedProjects = [];

  const blockData = blocks.map((block, idx) => {
    const section = sectionForIndex(block.start, sections);
    const context = resumeTex.slice(Math.max(0, block.start - 500), block.start).toLowerCase();
    const isPinned = context.includes('ecornell') || context.includes('blockopoly');

    const rankedBullets = [...block.bullets]
      .map((b) => ({ ...b, score: scoreBullet(b.content, keywords) }))
      .sort((a, b) => b.score - a.score);

    let limit = null;
    if (/experience/i.test(section)) {
      const expBlockIndex = blocks
        .slice(0, idx + 1)
        .filter((other) => /experience/i.test(sectionForIndex(other.start, sections))).length - 1;
      limit = expBlockIndex === 0 ? 6 : 3;
    } else if (/projects/i.test(section)) {
      limit = 3;
    }

    const selectedBullets = limit ? rankedBullets.slice(0, limit) : rankedBullets;

    return {
      ...block,
      section,
      isPinned,
      selectedBullets,
      avgScore: selectedBullets.length
        ? selectedBullets.reduce((acc, b) => acc + b.score, 0) / selectedBullets.length
        : 0,
      context,
    };
  });

  let rebuilt = resumeTex;
  for (const data of [...blockData].sort((a, b) => b.start - a.start)) {
    if (!data.bullets.length) continue;

    const firstStart = data.bullets[0].start;
    const lastEnd = data.bullets[data.bullets.length - 1].end;
    const prefix = data.inner.slice(0, firstStart);
    const suffix = data.inner.slice(lastEnd);
    const newBullets = data.selectedBullets.map((b) => b.raw).join('');
    const newInner = `${prefix}${newBullets}${suffix}`;

    rebuilt = `${rebuilt.slice(0, data.innerStart)}${newInner}${rebuilt.slice(data.innerEnd)}`;
  }

  let finalTex = rebuilt;
  let warning = '';

  if (countEstimatedLines(finalTex) > 62) {
    // Trim pass #1: tighten projects to two bullets.
    const firstPassBlocks = parseListBlocks(finalTex);
    const firstPassSections = parseSections(finalTex);

    let trimmedTex = finalTex;
    const projectCandidates = [];

    for (const block of firstPassBlocks) {
      const section = sectionForIndex(block.start, firstPassSections);
      const context = finalTex.slice(Math.max(0, block.start - 500), block.start).toLowerCase();
      const isPinned = context.includes('blockopoly');

      if (/projects/i.test(section)) {
        const ranked = [...block.bullets]
          .map((b) => ({ ...b, score: scoreBullet(b.content, keywords) }))
          .sort((a, b) => b.score - a.score)
          .slice(0, 2);

        if (block.bullets.length > 2) {
          const firstStart = block.bullets[0].start;
          const lastEnd = block.bullets[block.bullets.length - 1].end;
          const prefix = block.inner.slice(0, firstStart);
          const suffix = block.inner.slice(lastEnd);
          const newInner = `${prefix}${ranked.map((b) => b.raw).join('')}${suffix}`;
          trimmedTex = `${trimmedTex.slice(0, block.innerStart)}${newInner}${trimmedTex.slice(block.innerEnd)}`;
        }

        projectCandidates.push({ block, isPinned, score: ranked.reduce((acc, b) => acc + b.score, 0) });
      }
    }

    finalTex = trimmedTex;

    // Trim pass #2: remove one lowest relevance unpinned project block if still dense.
    if (countEstimatedLines(finalTex) > 62 && projectCandidates.length > 1) {
      const removable = projectCandidates
        .filter((p) => !p.isPinned)
        .sort((a, b) => a.score - b.score)[0];
      if (removable) {
        const targetText = finalTex.slice(removable.block.start, removable.block.end);
        finalTex = finalTex.replace(targetText, '');
        removedProjects.push('least_relevant_project');
      }
    }

    // Trim pass #3: secondary experience to two bullets.
    if (countEstimatedLines(finalTex) > 62) {
      const blocks2 = parseListBlocks(finalTex);
      const sections2 = parseSections(finalTex);
      let expSeen = 0;

      for (const block of [...blocks2].sort((a, b) => b.start - a.start)) {
        const section = sectionForIndex(block.start, sections2);
        if (!/experience/i.test(section)) continue;

        if (expSeen > 0 && block.bullets.length > 2) {
          const ranked = [...block.bullets]
            .map((b) => ({ ...b, score: scoreBullet(b.content, keywords) }))
            .sort((a, b) => b.score - a.score)
            .slice(0, 2);

          const firstStart = block.bullets[0].start;
          const lastEnd = block.bullets[block.bullets.length - 1].end;
          const prefix = block.inner.slice(0, firstStart);
          const suffix = block.inner.slice(lastEnd);
          const newInner = `${prefix}${ranked.map((b) => b.raw).join('')}${suffix}`;
          finalTex = `${finalTex.slice(0, block.innerStart)}${newInner}${finalTex.slice(block.innerEnd)}`;
        }

        expSeen += 1;
      }
    }

    // Trim pass #4: condense skills line breaks.
    if (countEstimatedLines(finalTex) > 62) {
      const skillsSection = parseSections(finalTex).find((sec) => /technical skills/i.test(sec.name));
      if (skillsSection) {
        const compact = skillsSection.content.replace(/\\\\\s*\n\s*/g, ', ');
        finalTex = `${finalTex.slice(0, skillsSection.contentStart)}${compact}${finalTex.slice(skillsSection.contentEnd)}`;
      }
    }

    if (countEstimatedLines(finalTex) > 62) {
      warning = 'One-page enforcement heuristic may still overflow; review manually.';
    }
  }

  return {
    optimizedTex: finalTex,
    metadata: {
      removed_projects: removedProjects,
      keyword_focus: keywords.slice(0, 12),
      warning,
    },
    parsed: {
      preamble: splitPreambleAndBody(resumeTex).preamble,
      body: splitPreambleAndBody(resumeTex).body,
      sections: createSectionMap(sections),
      whitelist_tech: extractTechTerms(resumeTex),
    },
  };
}

function preservesPreamble(originalTex, candidateTex) {
  const original = splitPreambleAndBody(originalTex).preamble;
  const candidate = splitPreambleAndBody(candidateTex).preamble;
  return original === candidate;
}

function validateNoNewTech(originalTex, candidateTex) {
  const originalTech = new Set(extractTechTerms(originalTex));
  const candidateTech = extractTechTerms(candidateTex);
  const newTech = candidateTech.filter((t) => !originalTech.has(t));
  return {
    valid: newTech.length === 0,
    newTech,
    whitelist: [...originalTech].sort(),
  };
}

module.exports = {
  MAX_RESUME_BYTES,
  MAX_JD_CHARS,
  validateInputs,
  validateResumeTex,
  splitPreambleAndBody,
  parseSections,
  parseListBlocks,
  extractKeywords,
  extractTechTerms,
  optimizeDeterministic,
  preservesPreamble,
  validateNoNewTech,
};
