import { useState } from 'react';
import { compilePdf, generateTex } from './api';

const MAX_RESUME_BYTES = 200 * 1024;
const MAX_JD_CHARS = 30000;
const CANONICAL_RESUME_PATH = 'source_of_truth/resumes/stephen_syl_akinwale__resume__source.tex';

function canonicalResumeUrl() {
  const base = import.meta.env.BASE_URL || '/';
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  return `${normalizedBase}${CANONICAL_RESUME_PATH}`;
}

function makeFilename(prefix, ext) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  return `${prefix}_${ts}.${ext}`;
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

export default function App() {
  const [resumeTex, setResumeTex] = useState('');
  const [jobDescription, setJobDescription] = useState('');
  const [optimizedTex, setOptimizedTex] = useState('');
  const [metadata, setMetadata] = useState(null);
  const [error, setError] = useState('');
  const [compileLog, setCompileLog] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isCompiling, setIsCompiling] = useState(false);
  const [useCanonical, setUseCanonical] = useState(false);
  const [isLoadingCanonical, setIsLoadingCanonical] = useState(false);

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

  async function onGenerate() {
    setError('');
    setCompileLog('');

    const invalid = validateInputs();
    if (invalid) {
      setError(invalid);
      return;
    }

    setIsGenerating(true);
    setMetadata(null);

    try {
      const data = await generateTex(resumeTex, jobDescription);
      setOptimizedTex(data.optimized_tex || '');
      setMetadata(data.metadata || null);

      setIsCompiling(true);
      try {
        const pdfBlob = await compilePdf(data.optimized_tex || '');
        downloadBlob(pdfBlob, 'optimized_resume.pdf');
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
    downloadBlob(blob, makeFilename('optimized_resume', 'tex'));
  }

  return (
    <div className="page">
      <main className="container">
        <h1>ResumeTailor MVP</h1>
        <p className="subtitle">LaTeX-first resume optimization with ATS alignment and PDF auto-download.</p>

        <section className="panel">
          <h2>1) Resume Input</h2>
          <label className="row">
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
            rows={16}
            value={resumeTex}
            onChange={(e) => setResumeTex(e.target.value)}
            placeholder="Paste your full LaTeX resume here..."
          />
        </section>

        <section className="panel">
          <h2>2) Job Description</h2>
          <textarea
            rows={10}
            value={jobDescription}
            onChange={(e) => setJobDescription(e.target.value)}
            placeholder="Paste job description text..."
          />
          <div className="row">
            <button onClick={onGenerate} disabled={isGenerating || isCompiling}>
              {isGenerating ? 'Generating...' : 'Generate'}
            </button>
          </div>
        </section>

        {error && (
          <section className="panel error">
            <h2>Error</h2>
            <pre>{error}</pre>
          </section>
        )}

        {optimizedTex && (
          <section className="panel">
            <h2>3) Optimized LaTeX (Primary Output)</h2>
            <div className="row">
              <button onClick={onCopyTex}>Copy</button>
              <button onClick={onDownloadTex}>Download .tex</button>
              <span className="status">
                {isCompiling ? 'Compiling PDF...' : 'PDF compile attempted automatically.'}
              </span>
            </div>
            <textarea rows={20} value={optimizedTex} readOnly />
            {metadata && (
              <div className="meta">
                <strong>Keyword focus:</strong> {(metadata.keyword_focus || []).join(', ') || 'none'}
                <br />
                <strong>Removed projects:</strong> {(metadata.removed_projects || []).join(', ') || 'none'}
                <br />
                <strong>Optimizer:</strong> {metadata.optimizer || 'unknown'}
                <br />
                <strong>Key source:</strong> {metadata.key_source || 'none'}
                {metadata.warning ? (
                  <>
                    <br />
                    <strong>Warning:</strong> {metadata.warning}
                  </>
                ) : null}
                {metadata.openai_error ? (
                  <>
                    <br />
                    <strong>OpenAI error:</strong>{' '}
                    {[
                      metadata.openai_error.name,
                      metadata.openai_error.status ? `status=${metadata.openai_error.status}` : '',
                      metadata.openai_error.code ? `code=${metadata.openai_error.code}` : '',
                      metadata.openai_error.type ? `type=${metadata.openai_error.type}` : '',
                      metadata.openai_error.cause ? `cause=${metadata.openai_error.cause}` : '',
                    ]
                      .filter(Boolean)
                      .join(' | ') || metadata.openai_error.message || 'unknown'}
                  </>
                ) : null}
              </div>
            )}
          </section>
        )}

        {compileLog && (
          <section className="panel error">
            <h2>PDF Compilation Error Log</h2>
            <pre>{compileLog}</pre>
          </section>
        )}
      </main>
    </div>
  );
}
