import { useState } from 'react';
import { compilePdf, generateTex } from './api';

const MAX_RESUME_BYTES = 200 * 1024;
const MAX_JD_CHARS = 30000;

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
          <input type="file" accept=".tex" onChange={onUploadFile} />
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
                {metadata.warning ? (
                  <>
                    <br />
                    <strong>Warning:</strong> {metadata.warning}
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
