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
  if (commentName?.[1]) return commentName[1].trim();

  return 'candidate';
}

function extractRoleCompanyFromJD(jd) {
  const lines = String(jd || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  let role = '';
  const descriptionIndex = lines.findIndex((line) => /^description$/i.test(line));
  if (descriptionIndex !== -1 && lines[descriptionIndex + 1]) role = lines[descriptionIndex + 1];

  if (!role) {
    role =
      lines.find(
        (line) =>
          !/location|workplace|about the role|responsibilities|required skills|qualifications/i.test(line)
      ) || '';
  }

  let company = '';
  const seekingMatch = jd.match(/([A-Z][A-Za-z0-9&.,\- ]{1,60})\s+is\s+seeking/i);
  if (seekingMatch?.[1]) company = seekingMatch[1].trim();

  if (!company) {
    const atMatch = jd.match(/\bat\s+([A-Z][A-Za-z0-9&.,\- ]{1,60})/i);
    if (atMatch?.[1]) company = atMatch[1].trim();
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

function makeLog(kind, summary, details) {
  return {
    id: `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    kind,
    summary,
    details,
    timestamp: new Date().toLocaleString(),
  };
}

export default function App() {
  const [resumeDraft, setResumeDraft] = useState('');
  const [jobDraft, setJobDraft] = useState('');
  const [useCanonical, setUseCanonical] = useState(true);
  const [isLoadingCanonical, setIsLoadingCanonical] = useState(false);

  const [versions, setVersions] = useState([]);
  const [selectedVersionId, setSelectedVersionId] = useState('');
  const [editorTex, setEditorTex] = useState('');
  const [editorDirty, setEditorDirty] = useState(false);

  const [drawerOpen, setDrawerOpen] = useState(true);
  const [logsOpen, setLogsOpen] = useState(false);
  const [runLogs, setRunLogs] = useState([]);

  const [pdfPreviewUrl, setPdfPreviewUrl] = useState('');
  const [pdfPreviewFilename, setPdfPreviewFilename] = useState('optimized_resume.pdf');
  const [isPreviewStale, setIsPreviewStale] = useState(false);

  const [metadata, setMetadata] = useState(null);
  const [appliedAt, setAppliedAt] = useState('');
  const [error, setError] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isCompiling, setIsCompiling] = useState(false);

  const pdfPreviewUrlRef = useRef('');

  const selectedVersion = useMemo(
    () => versions.find((item) => item.id === selectedVersionId) || null,
    [versions, selectedVersionId]
  );

  const inferredBaseName = useMemo(() => {
    const sourceTex = editorTex || resumeDraft;
    return sourceTex.trim() ? buildDownloadBaseName(sourceTex, jobDraft) : 'optimized_resume';
  }, [editorTex, resumeDraft, jobDraft]);

  const activeBaseName = selectedVersion?.baseName || inferredBaseName;

  const canGenerate = !isGenerating && !!resumeDraft.trim() && !!jobDraft.trim();
  const canCompile = !isCompiling && !!editorTex.trim();

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

  function appendLog(kind, summary, details) {
    setRunLogs((prev) => [makeLog(kind, summary, details), ...prev]);
  }

  async function loadCanonicalResume() {
    setError('');
    setIsLoadingCanonical(true);
    try {
      const res = await fetch(canonicalResumeUrl(), { method: 'GET' });
      if (!res.ok) throw new Error(`Canonical resume fetch failed: ${res.status}`);
      const tex = await res.text();
      setResumeDraft(tex);
    } catch (err) {
      setError(String(err?.message || err));
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
    setResumeDraft(text);
  }

  function clearPdfPreview() {
    if (pdfPreviewUrlRef.current) {
      URL.revokeObjectURL(pdfPreviewUrlRef.current);
      pdfPreviewUrlRef.current = '';
    }
    setPdfPreviewUrl('');
    setPdfPreviewFilename('optimized_resume.pdf');
    setIsPreviewStale(false);
  }

  function setPdfPreview(blob, filename) {
    const nextUrl = URL.createObjectURL(blob);
    if (pdfPreviewUrlRef.current) {
      URL.revokeObjectURL(pdfPreviewUrlRef.current);
    }
    pdfPreviewUrlRef.current = nextUrl;
    setPdfPreviewUrl(nextUrl);
    setPdfPreviewFilename(filename);
    setIsPreviewStale(false);
  }

  function validateGenerateInputs() {
    const trimmedResume = resumeDraft.trim();
    const trimmedJD = jobDraft.trim();

    if (!trimmedResume) return 'Resume LaTeX is required.';
    if (!trimmedResume.includes('\\begin{document}')) return 'Resume must include \\begin{document}.';
    if (!trimmedResume.includes('\\end{document}')) return 'Resume must include \\end{document}.';

    const bytes = new TextEncoder().encode(trimmedResume).length;
    if (bytes > MAX_RESUME_BYTES) return `Resume exceeds ${MAX_RESUME_BYTES} bytes.`;

    if (!trimmedJD) return 'Job description is required.';
    if (trimmedJD.length > MAX_JD_CHARS) return `Job description exceeds ${MAX_JD_CHARS} characters.`;

    return '';
  }

  function createVersion(tex, metadataValue, baseName) {
    const nextNumber = versions.length + 1;
    const version = {
      id: `v${nextNumber}-${Date.now()}`,
      label: `v${nextNumber}`,
      timestamp: new Date().toLocaleString(),
      tex,
      metadata: metadataValue || null,
      baseName,
    };

    setVersions((prev) => [...prev, version]);
    setSelectedVersionId(version.id);
    setEditorTex(tex);
    setEditorDirty(false);
    setMetadata(metadataValue || null);

    return version;
  }

  function loadVersion(versionId) {
    const version = versions.find((item) => item.id === versionId);
    if (!version) return;

    setSelectedVersionId(version.id);
    setEditorTex(version.tex);
    setEditorDirty(false);
    setMetadata(version.metadata || null);
    clearPdfPreview();
  }

  async function compileCurrent(options = {}) {
    const {
      tex = editorTex,
      download = false,
      label = selectedVersion?.label || 'working copy',
      baseName = activeBaseName,
    } = options;

    if (!String(tex || '').trim()) {
      setError('No LaTeX in editor to compile.');
      return;
    }

    setError('');
    setIsCompiling(true);

    try {
      const blob = await compilePdf(String(tex));
      const fileName = `${baseName || 'optimized_resume'}.pdf`;
      setPdfPreview(blob, fileName);

      if (download) {
        downloadBlob(blob, fileName);
      }

      appendLog('compile', `Compile success (${label})`, {
        label,
        filename: fileName,
        size_bytes: blob.size,
        editor_dirty: tex === editorTex ? editorDirty : false,
      });
    } catch (compileErr) {
      const message = String(compileErr?.message || compileErr);
      setError(message);
      appendLog('compile', `Compile failed (${label})`, {
        label,
        error: message,
        editor_dirty: tex === editorTex ? editorDirty : false,
      });
    } finally {
      setIsCompiling(false);
    }
  }

  async function onGenerate() {
    setError('');
    const invalid = validateGenerateInputs();
    if (invalid) {
      setError(invalid);
      return;
    }

    setIsGenerating(true);

    try {
      const data = await generateTex(resumeDraft, jobDraft);
      const nextTex = data.optimized_tex || '';
      const baseName = buildDownloadBaseName(nextTex || resumeDraft, jobDraft);
      const version = createVersion(nextTex, data.metadata || null, baseName);

      setAppliedAt(new Date().toLocaleString());
      setDrawerOpen(false);
      clearPdfPreview();

      appendLog('generate', `Generated ${version.label}`, {
        version: version.label,
        optimizer: data.metadata?.optimizer || 'unknown',
        coverage: `${data.metadata?.coverage_total ?? 0}/${data.metadata?.coverage_required ?? 0}`,
        keyword_coverage: data.metadata?.keyword_coverage || [],
        removed_projects: data.metadata?.removed_projects || [],
        included_projects: data.metadata?.included_projects || [],
        validator_failures: data.metadata?.validator_failures || [],
        tokens: data.metadata?.openai_tokens?.total || null,
        warning: data.metadata?.warning || '',
      });

      await compileCurrent({ tex: nextTex, download: false, label: version.label, baseName });
    } catch (err) {
      const message = String(err?.message || err);
      setError(message);
      appendLog('generate', 'Generation failed', { error: message });
    } finally {
      setIsGenerating(false);
    }
  }

  async function onCopyTex() {
    if (!editorTex) return;
    try {
      await navigator.clipboard.writeText(editorTex);
    } catch {
      setError('Clipboard copy failed.');
    }
  }

  function onDownloadTex() {
    if (!editorTex) return;
    const blob = new Blob([editorTex], { type: 'application/x-tex' });
    downloadBlob(blob, `${activeBaseName}.tex`);
  }

  async function onDownloadPdf() {
    if (pdfPreviewUrl && !isPreviewStale) {
      const a = document.createElement('a');
      a.href = pdfPreviewUrl;
      a.download = pdfPreviewFilename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      return;
    }

    await compileCurrent({ download: true });
  }

  function onEditorChange(value) {
    setEditorTex(value);
    setEditorDirty(true);
    if (pdfPreviewUrl) {
      setIsPreviewStale(true);
    }
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>ResumeTailor Pipeline</h1>
        <p>input -> generate -> review -> tweak -> regenerate/compile -> download</p>
      </header>

      <section className="toolbar card">
        <div className="row">
          <button type="button" className="secondary" onClick={() => setDrawerOpen((v) => !v)}>
            {drawerOpen ? 'Hide Inputs' : 'Show Inputs'}
          </button>
          <button type="button" onClick={onGenerate} disabled={!canGenerate}>
            {isGenerating ? 'Generating...' : 'Generate New Version'}
          </button>
          <button type="button" onClick={() => void compileCurrent()} disabled={!canCompile}>
            {isCompiling ? 'Compiling...' : 'Compile Current'}
          </button>
          <button type="button" onClick={() => void onDownloadPdf()} disabled={!editorTex.trim() || isCompiling}>
            Download .pdf
          </button>
          <button type="button" className="secondary" onClick={onDownloadTex} disabled={!editorTex.trim()}>
            Download .tex
          </button>
          <button type="button" className="secondary" onClick={onCopyTex} disabled={!editorTex.trim()}>
            Copy
          </button>
        </div>

        <div className="row meta-row">
          <span>Backend: <code>{BACKEND_URL}</code></span>
          <span>Selected: <strong>{selectedVersion?.label || 'working copy'}</strong>{editorDirty ? ' (edited)' : ''}</span>
          <span>Tokens: <strong>{summarizeTokens(metadata?.openai_tokens?.total)}</strong></span>
          <span>Applied inputs: <strong>{appliedAt || 'not yet'}</strong></span>
        </div>
      </section>

      {drawerOpen ? (
        <section className="card drawer-card">
          <h2>Inputs Drawer</h2>
          <div className="row">
            <label className="inline-check">
              <input type="checkbox" checked={useCanonical} onChange={onToggleCanonical} />
              <span>Use canonical resume</span>
            </label>
            {useCanonical ? (
              <button type="button" className="secondary" onClick={() => void loadCanonicalResume()} disabled={isLoadingCanonical}>
                {isLoadingCanonical ? 'Loading...' : 'Reload canonical'}
              </button>
            ) : null}
            <input type="file" accept=".tex" onChange={onUploadFile} disabled={useCanonical} />
          </div>

          <div className="drawer-grid">
            <div>
              <label>Resume source</label>
              <textarea
                rows={11}
                value={resumeDraft}
                onChange={(e) => setResumeDraft(e.target.value)}
                placeholder="Paste source resume TeX"
              />
            </div>
            <div>
              <label>Job description</label>
              <textarea
                rows={11}
                value={jobDraft}
                onChange={(e) => setJobDraft(e.target.value)}
                placeholder="Paste job description"
              />
            </div>
          </div>
          <div className="hint">Edits here do not change the workspace until you click Generate New Version.</div>
        </section>
      ) : null}

      {versions.length ? (
        <section className="card version-card">
          <h2>Version History</h2>
          <div className="version-list">
            {versions
              .slice()
              .reverse()
              .map((version) => (
                <button
                  key={version.id}
                  type="button"
                  className={`version-item ${selectedVersionId === version.id ? 'active' : ''}`}
                  onClick={() => loadVersion(version.id)}
                >
                  <span>{version.label}</span>
                  <small>{version.timestamp}</small>
                </button>
              ))}
          </div>
        </section>
      ) : null}

      <section className="workspace-grid">
        <section className="card panel-card">
          <h2>Optimized LaTeX Editor (working copy)</h2>
          <textarea
            className="workspace-editor"
            value={editorTex}
            onChange={(e) => onEditorChange(e.target.value)}
            placeholder="Generate a version to begin editing."
          />
        </section>

        <section className="card panel-card">
          <h2>PDF Preview</h2>
          {pdfPreviewUrl ? (
            <>
              {isPreviewStale ? <div className="hint stale">Preview is stale. Recompile current editor text.</div> : null}
              <iframe title="PDF Preview" className="pdf-preview" src={pdfPreviewUrl} />
            </>
          ) : (
            <div className="empty-preview">No compiled PDF yet. Compile current editor text to render preview.</div>
          )}
        </section>
      </section>

      <details className="card logs-card" open={logsOpen} onToggle={(e) => setLogsOpen(e.currentTarget.open)}>
        <summary>Logs</summary>
        <div className="log-list">
          {runLogs.length ? (
            runLogs.map((entry) => (
              <article key={entry.id} className="log-item">
                <div className="log-head">
                  <strong>{entry.kind.toUpperCase()}</strong>
                  <span>{entry.summary}</span>
                  <small>{entry.timestamp}</small>
                </div>
                <pre>{JSON.stringify(entry.details, null, 2)}</pre>
              </article>
            ))
          ) : (
            <div className="hint">No runs yet.</div>
          )}
        </div>
      </details>

      {error ? (
        <section className="card card-error">
          <h2>Error</h2>
          <pre>{error}</pre>
        </section>
      ) : null}
    </div>
  );
}
