import { useEffect, useMemo, useRef, useState } from 'react';
import { BACKEND_URL, compilePdf, generateTex } from './api';

const MAX_RESUME_BYTES = 200 * 1024;
const MAX_JD_CHARS = 30000;
const CANONICAL_RESUME_PATH = 'source_of_truth/resumes/stephen_syl_akinwale__resume__source.tex';

function canonicalResumeUrl() {
  const base = import.meta.env.BASE_URL || '/';
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  return `${normalizedBase}${CANONICAL_RESUME_PATH}`;
}

function sanitizeToken(value, maxLen = 40) {
  return String(value || '')
    .replace(/\\[a-zA-Z]+/g, ' ')
    .replace(/[{}]/g, ' ')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, maxLen);
}

function extractCandidateNameFromTex(tex) {
  const headerMatch = tex.match(/\{\\Huge\s+\\scshape\s+([^}]*)\}/);
  if (headerMatch?.[1]) {
    const cleaned = headerMatch[1].replace(/\\[a-zA-Z]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (cleaned) return cleaned;
  }

  const commentName = tex.match(/^%\s*([A-Za-z][A-Za-z .'-]{2,})$/m);
  if (commentName?.[1]) {
    return commentName[1].trim();
  }

  return 'candidate';
}

function extractRoleCompanyFromJD(jd) {
  const lines = String(jd || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  let role = '';
  const descriptionIndex = lines.findIndex((line) => /^description$/i.test(line));
  if (descriptionIndex !== -1 && lines[descriptionIndex + 1]) {
    role = lines[descriptionIndex + 1];
  }

  if (!role) {
    role =
      lines.find(
        (line) =>
          !/location|workplace|about the role|responsibilities|required skills|qualifications/i.test(line)
      ) || '';
  }

  let company = '';
  const seekingMatch = jd.match(/([A-Z][A-Za-z0-9&.,\- ]{1,60})\s+is\s+seeking/i);
  if (seekingMatch?.[1]) {
    company = seekingMatch[1].trim();
  }

  if (!company) {
    const atMatch = jd.match(/\bat\s+([A-Z][A-Za-z0-9&.,\- ]{1,60})/i);
    if (atMatch?.[1]) {
      company = atMatch[1].trim();
    }
  }

  return { role, company };
}

function buildDownloadBaseName(tex, jd) {
  const candidate = sanitizeToken(extractCandidateNameFromTex(tex), 48);
  const { role, company } = extractRoleCompanyFromJD(jd);
  const roleToken = sanitizeToken(role || 'target_role', 40);
  const companyToken = sanitizeToken(company || 'target_company', 40);

  const base = [candidate, roleToken, companyToken].filter(Boolean).join('__') || 'optimized_resume';
  return base.slice(0, 120);
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function summarizeTokens(tokens) {
  if (!tokens) return '0 in / 0 out / 0 total';
  const input = Number(tokens.input_tokens || 0);
  const output = Number(tokens.output_tokens || 0);
  const total = Number(tokens.total_tokens || input + output || 0);
  return `${input} in / ${output} out / ${total} total`;
}

export default function App() {
  const [resumeTex, setResumeTex] = useState('');
  const [jobDescription, setJobDescription] = useState('');
  const [optimizedTex, setOptimizedTex] = useState('');
  const [outputBaseName, setOutputBaseName] = useState('optimized_resume');
  const [metadata, setMetadata] = useState(null);
  const [error, setError] = useState('');
  const [compileLog, setCompileLog] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isCompiling, setIsCompiling] = useState(false);
  const [useCanonical, setUseCanonical] = useState(true);
  const [isLoadingCanonical, setIsLoadingCanonical] = useState(false);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState('');
  const [pdfPreviewFilename, setPdfPreviewFilename] = useState('optimized_resume.pdf');
  const pdfPreviewUrlRef = useRef('');

  const canGenerate = !!resumeTex.trim() && !!jobDescription.trim() && !isGenerating && !isCompiling;

  useEffect(() => {
    if (useCanonical) {
      void loadCanonicalResume();
    }
  }, []);

  useEffect(() => {
    return () => {
      if (pdfPreviewUrlRef.current) {
        URL.revokeObjectURL(pdfPreviewUrlRef.current);
      }
    };
  }, []);

  const currentDownloadBaseName = useMemo(() => {
    const sourceTex = optimizedTex || resumeTex;
    if (!sourceTex.trim()) return 'optimized_resume';
    return buildDownloadBaseName(sourceTex, jobDescription);
  }, [optimizedTex, resumeTex, jobDescription]);

  async function onUploadFile(evt) {
    setError('');
    const file = evt.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.tex')) {
      setError('Please upload a .tex file.');
      return;
    }

    if (file.size > MAX_RESUME_BYTES) {
      setError(`Resume file is too large. Max is ${MAX_RESUME_BYTES} bytes.`);
      return;
    }

    const text = await file.text();
    setResumeTex(text);
  }

  async function loadCanonicalResume() {
    setError('');
    setIsLoadingCanonical(true);
    try {
      const res = await fetch(canonicalResumeUrl(), { method: 'GET' });
      if (!res.ok) {
        throw new Error(`Canonical resume fetch failed: ${res.status}`);
      }
      const tex = await res.text();
      setResumeTex(tex);
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setIsLoadingCanonical(false);
    }
  }

  function onToggleCanonical(evt) {
    const checked = evt.target.checked;
    setUseCanonical(checked);
    if (checked) {
      void loadCanonicalResume();
    }
  }

  function validateInputs() {
    const trimmedResume = resumeTex.trim();
    const trimmedJD = jobDescription.trim();

    if (!trimmedResume) return 'Resume LaTeX is required.';
    if (!trimmedResume.includes('\\begin{document}')) return 'Resume must include \\begin{document}.';
    if (!trimmedResume.includes('\\end{document}')) return 'Resume must include \\end{document}.';

    const bytes = new TextEncoder().encode(trimmedResume).length;
    if (bytes > MAX_RESUME_BYTES) return `Resume exceeds ${MAX_RESUME_BYTES} bytes.`;

    if (!trimmedJD) return 'Job description is required.';
    if (trimmedJD.length > MAX_JD_CHARS) return `Job description exceeds ${MAX_JD_CHARS} characters.`;

    return '';
  }

  function setPdfPreview(blob, filename) {
    const nextUrl = URL.createObjectURL(blob);
    if (pdfPreviewUrlRef.current) {
      URL.revokeObjectURL(pdfPreviewUrlRef.current);
    }
    pdfPreviewUrlRef.current = nextUrl;
    setPdfPreviewUrl(nextUrl);
    setPdfPreviewFilename(filename);
  }

  function clearPdfPreview() {
    if (pdfPreviewUrlRef.current) {
      URL.revokeObjectURL(pdfPreviewUrlRef.current);
      pdfPreviewUrlRef.current = '';
    }
    setPdfPreviewUrl('');
    setPdfPreviewFilename('optimized_resume.pdf');
  }

  async function onGenerate() {
    setError('');
    setCompileLog('');
    clearPdfPreview();

    const invalid = validateInputs();
    if (invalid) {
      setError(invalid);
      return;
    }

    setIsGenerating(true);
    setMetadata(null);

    try {
      const data = await generateTex(resumeTex, jobDescription);
      const nextOptimizedTex = data.optimized_tex || '';
      const baseName = buildDownloadBaseName(nextOptimizedTex || resumeTex, jobDescription);

      setOptimizedTex(nextOptimizedTex);
      setOutputBaseName(baseName);
      setMetadata(data.metadata || null);

      setIsCompiling(true);
      try {
        const pdfBlob = await compilePdf(nextOptimizedTex || '');
        setPdfPreview(pdfBlob, `${baseName}.pdf`);
      } catch (compileErr) {
        setCompileLog(String(compileErr.message || compileErr));
      } finally {
        setIsCompiling(false);
      }
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setIsGenerating(false);
    }
  }

  async function onCopyTex() {
    if (!optimizedTex) return;
    try {
      await navigator.clipboard.writeText(optimizedTex);
    } catch {
      setError('Clipboard copy failed. You can still download the .tex file.');
    }
  }

  function onDownloadTex() {
    if (!optimizedTex) return;
    const blob = new Blob([optimizedTex], { type: 'application/x-tex' });
    const baseName = outputBaseName || currentDownloadBaseName;
    downloadBlob(blob, `${baseName}.tex`);
  }

  function onDownloadPdf() {
    if (!pdfPreviewUrl) return;
    const a = document.createElement('a');
    a.href = pdfPreviewUrl;
    a.download = pdfPreviewFilename || 'optimized_resume.pdf';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>ResumeTailor MVP</h1>
        <p>LaTeX-first ATS optimization with deterministic validation.</p>
      </header>

      <div className="top-grid">
        <div className="stack">
          <section className="card">
            <h2>Resume Input</h2>
            <label className="row checkbox-row">
              <input type="checkbox" checked={useCanonical} onChange={onToggleCanonical} />
              <span>Use canonical resume</span>
              {useCanonical ? (
                <button type="button" onClick={() => void loadCanonicalResume()} disabled={isLoadingCanonical}>
                  {isLoadingCanonical ? 'Loading...' : 'Reload canonical'}
                </button>
              ) : null}
            </label>
            <input type="file" accept=".tex" onChange={onUploadFile} disabled={useCanonical} />
            <textarea
              rows={14}
              value={resumeTex}
              onChange={(e) => setResumeTex(e.target.value)}
              placeholder="Paste your full LaTeX resume here..."
            />
          </section>

          <section className="card">
            <h2>Job Description</h2>
            <textarea
              rows={10}
              value={jobDescription}
              onChange={(e) => setJobDescription(e.target.value)}
              placeholder="Paste job description text..."
            />
            <div className="row">
              <button onClick={onGenerate} disabled={!canGenerate}>
                {isGenerating ? 'Generating...' : 'Generate'}
              </button>
            </div>
          </section>
        </div>

        <aside className="card status-card">
          <h2>Status</h2>
          <div className="status-grid">
            <div>Canonical Resume</div>
            <strong>{useCanonical ? (isLoadingCanonical ? 'loading' : 'enabled') : 'disabled'}</strong>

            <div>Generate</div>
            <strong>{isGenerating ? 'running' : 'idle'}</strong>

            <div>Compile PDF</div>
            <strong>{isCompiling ? 'running' : 'idle'}</strong>

            <div>Backend</div>
            <code>{BACKEND_URL}</code>

            <div>Output Filename</div>
            <code>{(outputBaseName || currentDownloadBaseName) + '.pdf/.tex'}</code>
          </div>

          {metadata ? (
            <div className="status-block">
              <div>
                <span>Optimizer:</span> <strong>{metadata.optimizer || 'unknown'}</strong>
              </div>
              <div>
                <span>Coverage:</span>{' '}
                <strong>
                  {metadata.coverage_total ?? 0}/{metadata.coverage_required ?? 0}
                </strong>
              </div>
              <div>
                <span>Project count:</span> <strong>{metadata.project_count ?? 'n/a'}</strong>
              </div>
              <div>
                <span>Bullet count:</span> <strong>{metadata.bullet_count ?? 'n/a'}</strong>
              </div>
              <div>
                <span>Tokens:</span> <strong>{summarizeTokens(metadata.openai_tokens?.total)}</strong>
              </div>
            </div>
          ) : null}
        </aside>
      </div>

      {error ? (
        <section className="card card-error">
          <h2>Error</h2>
          <pre>{error}</pre>
        </section>
      ) : null}

      {optimizedTex ? (
        <section className="card">
          <h2>Optimized LaTeX</h2>
          <div className="row">
            <button onClick={onCopyTex}>Copy</button>
            <button onClick={onDownloadTex}>Download .tex</button>
            <span className="hint">Compile uses optimized .tex only.</span>
          </div>
          <textarea rows={22} value={optimizedTex} readOnly />
        </section>
      ) : null}

      <section className="card">
        <h2>PDF Preview (Optimized .tex)</h2>
        <div className="row">
          <button onClick={onDownloadPdf} disabled={!pdfPreviewUrl}>
            Download .pdf
          </button>
          <span className="hint">
            {isCompiling
              ? 'Compiling optimized .tex...'
              : pdfPreviewUrl
                ? `Preview ready: ${pdfPreviewFilename}`
                : 'Generate optimized .tex to build preview.'}
          </span>
        </div>
        {pdfPreviewUrl ? (
          <iframe title="Optimized PDF Preview" className="pdf-preview" src={pdfPreviewUrl} />
        ) : (
          <div className="empty-preview">No PDF preview yet.</div>
        )}
      </section>

      <details className="card debug-card">
        <summary>Debug Panel</summary>
        <div className="debug-grid">
          <div>
            <strong>Keyword focus</strong>
            <pre>{(metadata?.keyword_focus || []).join(', ') || 'none'}</pre>
          </div>
          <div>
            <strong>Keyword coverage</strong>
            <pre>{(metadata?.keyword_coverage || []).join(', ') || 'none'}</pre>
          </div>
          <div>
            <strong>Target support keywords</strong>
            <pre>{(metadata?.support_keywords_target || []).join(', ') || 'none'}</pre>
          </div>
          <div>
            <strong>Removed projects</strong>
            <pre>{(metadata?.removed_projects || []).join(', ') || 'none'}</pre>
          </div>
          <div>
            <strong>Included projects</strong>
            <pre>{(metadata?.included_projects || []).join(', ') || 'none'}</pre>
          </div>
          <div>
            <strong>Validator failures</strong>
            <pre>{(metadata?.validator_failures || []).join(', ') || 'none'}</pre>
          </div>
          <div>
            <strong>Warning</strong>
            <pre>{metadata?.warning || 'none'}</pre>
          </div>
          <div>
            <strong>OpenAI error</strong>
            <pre>{metadata?.openai_error ? JSON.stringify(metadata.openai_error, null, 2) : 'none'}</pre>
          </div>
          <div>
            <strong>OpenAI response id</strong>
            <pre>{metadata?.openai_response_id || 'none'}</pre>
          </div>
          <div>
            <strong>OpenAI tokens (pass 1)</strong>
            <pre>{metadata?.openai_tokens?.pass_1 ? JSON.stringify(metadata.openai_tokens.pass_1, null, 2) : 'none'}</pre>
          </div>
          <div>
            <strong>OpenAI tokens (pass 2)</strong>
            <pre>{metadata?.openai_tokens?.pass_2 ? JSON.stringify(metadata.openai_tokens.pass_2, null, 2) : 'none'}</pre>
          </div>
          <div>
            <strong>OpenAI tokens (total)</strong>
            <pre>{metadata?.openai_tokens?.total ? JSON.stringify(metadata.openai_tokens.total, null, 2) : 'none'}</pre>
          </div>
          <div>
            <strong>Compile log</strong>
            <pre>{compileLog || 'none'}</pre>
          </div>
        </div>
      </details>
    </div>
  );
}
