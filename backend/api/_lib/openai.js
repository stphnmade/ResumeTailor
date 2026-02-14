function getClient() {
  const apiKey = process.env.OPENAI_KEY;
  if (!apiKey) return null;
  let OpenAI;
  try {
    OpenAI = require('openai');
  } catch (_err) {
    return null;
  }
  return new OpenAI({ apiKey });
}

function getModel() {
  return process.env.OPENAI_MODEL || 'gpt-4.1-mini';
}

function extractJson(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) throw new Error('MODEL_EMPTY_RESPONSE');

  try {
    return JSON.parse(trimmed);
  } catch (_err) {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) {
      throw new Error('MODEL_JSON_PARSE_FAILED');
    }
    return JSON.parse(trimmed.slice(start, end + 1));
  }
}

async function optimizeWithOpenAI({ resumeTex, jobDescription, whitelistTech, violationFeedback = '' }) {
  const client = getClient();
  if (!client) {
    throw new Error('OPENAI_UNAVAILABLE');
  }

  const systemPrompt = [
    'You are ResumeTailor, a deterministic LaTeX resume optimizer.',
    'You must not fabricate experience, tools, metrics, employers, or certifications.',
    'Preserve everything before \\begin{document} exactly verbatim.',
    'Only return strict JSON. No markdown.'
  ].join(' ');

  const userPrompt = [
    'Optimize this LaTeX resume against the job description.',
    'Allowed: reorder bullets, rephrase bullets, condense low-value bullets, remove lower-relevance project content.',
    'Not allowed: add any technology not already in whitelist_tech.',
    'Output JSON with shape:',
    '{"optimized_tex":"...","metadata":{"removed_projects":[...],"keyword_focus":[...]}}',
    violationFeedback ? `Previous candidate was rejected: ${violationFeedback}` : '',
    `whitelist_tech: ${JSON.stringify(whitelistTech)}`,
    `job_description:\n${jobDescription}`,
    `resume_tex:\n${resumeTex}`,
  ].join('\n\n');

  const response = await client.responses.create({
    model: getModel(),
    temperature: 0.2,
    input: [
      {
        role: 'system',
        content: [{ type: 'input_text', text: systemPrompt }],
      },
      {
        role: 'user',
        content: [{ type: 'input_text', text: userPrompt }],
      },
    ],
  });

  const parsed = extractJson(response.output_text || '');

  return {
    optimized_tex: String(parsed.optimized_tex || ''),
    metadata: {
      removed_projects: Array.isArray(parsed?.metadata?.removed_projects)
        ? parsed.metadata.removed_projects.map((x) => String(x))
        : [],
      keyword_focus: Array.isArray(parsed?.metadata?.keyword_focus)
        ? parsed.metadata.keyword_focus.map((x) => String(x))
        : [],
    },
  };
}

module.exports = {
  optimizeWithOpenAI,
  getClient,
};
