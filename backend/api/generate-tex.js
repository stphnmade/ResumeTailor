const { applyCors, readJsonBody, setJson } = require('./_lib/http');
const {
  validateInputs,
  optimizeDeterministic,
  preservesPreamble,
  validateNoNewTech,
} = require('./_lib/latex');
const { optimizeWithOpenAI, getClient } = require('./_lib/openai');

function validateCandidate(originalTex, candidateTex) {
  if (!candidateTex || typeof candidateTex !== 'string') {
    return { valid: false, reason: 'EMPTY_OPTIMIZED_TEX' };
  }

  if (!candidateTex.includes('\\begin{document}') || !candidateTex.includes('\\end{document}')) {
    return { valid: false, reason: 'MISSING_DOCUMENT_MARKERS' };
  }

  if (!preservesPreamble(originalTex, candidateTex)) {
    return { valid: false, reason: 'PREAMBLE_MISMATCH' };
  }

  const techCheck = validateNoNewTech(originalTex, candidateTex);
  if (!techCheck.valid) {
    return { valid: false, reason: `NEW_TECH_TERMS:${techCheck.newTech.join(',')}` };
  }

  return { valid: true, reason: '' };
}

module.exports = async function handler(req, res) {
  if (applyCors(req, res)) return;

  if (req.method !== 'POST') {
    setJson(res, 405, { error: 'METHOD_NOT_ALLOWED' });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    if (String(err.message || '').includes('PAYLOAD_TOO_LARGE')) {
      setJson(res, 413, { error: 'PAYLOAD_TOO_LARGE' });
      return;
    }
    setJson(res, 400, { error: 'INVALID_JSON_BODY' });
    return;
  }

  const resumeTex = body?.resume_tex;
  const jobDescription = body?.job_description;

  try {
    validateInputs(resumeTex, jobDescription);
  } catch (err) {
    setJson(res, 400, { error: String(err.message || 'VALIDATION_ERROR') });
    return;
  }

  const deterministic = optimizeDeterministic(resumeTex, jobDescription);
  let optimizedTex = deterministic.optimizedTex;
  let metadata = deterministic.metadata;

  const clientAvailable = Boolean(getClient());
  if (clientAvailable) {
    let violationFeedback = '';
    let accepted = false;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const openaiOutput = await optimizeWithOpenAI({
          resumeTex,
          jobDescription,
          whitelistTech: deterministic.parsed.whitelist_tech,
          violationFeedback,
        });

        const candidate = openaiOutput.optimized_tex;
        const candidateCheck = validateCandidate(resumeTex, candidate);
        if (candidateCheck.valid) {
          optimizedTex = candidate;
          metadata = {
            ...metadata,
            removed_projects: openaiOutput.metadata.removed_projects || metadata.removed_projects,
            keyword_focus: (openaiOutput.metadata.keyword_focus || metadata.keyword_focus).slice(0, 20),
          };
          accepted = true;
          break;
        }

        violationFeedback = candidateCheck.reason;
      } catch (err) {
        violationFeedback = String(err.message || 'OPENAI_OPTIMIZATION_ERROR');
      }
    }

    if (!accepted && violationFeedback.startsWith('NEW_TECH_TERMS:')) {
      setJson(res, 422, { error: 'HALLUCINATION_GUARD_REJECTED_OUTPUT' });
      return;
    }
  }

  const onePagePass = optimizeDeterministic(optimizedTex, jobDescription);
  optimizedTex = onePagePass.optimizedTex;
  metadata = {
    removed_projects: [...new Set([...(metadata.removed_projects || []), ...(onePagePass.metadata.removed_projects || [])])],
    keyword_focus: [...new Set([...(metadata.keyword_focus || []), ...(onePagePass.metadata.keyword_focus || [])])].slice(0, 20),
    warning: onePagePass.metadata.warning || metadata.warning || '',
  };

  const finalCheck = validateCandidate(resumeTex, optimizedTex);
  if (!finalCheck.valid) {
    setJson(res, 500, { error: 'OPTIMIZATION_OUTPUT_INVALID' });
    return;
  }

  setJson(res, 200, {
    optimized_tex: optimizedTex,
    metadata,
  });
};
