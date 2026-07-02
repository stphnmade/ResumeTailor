import { useEffect, useMemo, useRef, useState } from 'react';
import { BACKEND_URL, compilePdf, generateCoverLetter, generateTex, scrapeJob } from './api';
import { DashboardShell } from './dashboard/DashboardShell';
import { extractRoleCompanyFromJD, shouldGenerateCoverLetter } from './lib/jobAutofill.mjs';
import { useAppPath } from './router';
import canonicalResumeSource from '../../source_of_truth/resumes/stephen_syl_akinwale__resume__source.tex?raw';

const MAX_RESUME_BYTES = 200 * 1024;
const MAX_JD_CHARS = 30000;
const TONE_OPTIONS = ['professional', 'confident', 'warm'];
const LENGTH_OPTIONS = ['concise', 'standard', 'detailed'];

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
  const plainText = String(tex || '').trim();
  if (!plainText) return 'candidate';

  const headerMatch = tex.match(/\{\\Huge\s+\\scshape\s+([^}]*)\}/);
  if (headerMatch?.[1]) {
    const cleaned = headerMatch[1].replace(/\\[a-zA-Z]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (cleaned) return cleaned;
  }

  const commentName = tex.match(/^%\s*([A-Za-z][A-Za-z .'-]{2,})$/m);
  if (commentName?.[1]) return commentName[1].trim();

  const plainTextName = plainText.match(/(?:^|\n)\s*([A-Z][a-z]+(?:\s+[A-Z][a-z'.-]+){1,3})\s*(?:\n|$)/);
  if (plainTextName?.[1]) return plainTextName[1].trim();

  return 'candidate';
}

function isLatexResumeSource(text) {
  const value = String(text || '').trim();
  return value.includes('\\documentclass') || value.includes('\\begin{document}') || value.includes('\\section{');
}

function buildDownloadBaseNameFromParts(candidateName, companyName, roleName) {
  const candidate = sanitizeToken(candidateName || 'candidate', 48);
  const roleToken = sanitizeToken(roleName || 'target_role', 40);
  const companyToken = sanitizeToken(companyName || 'target_company', 40);
  const base = [candidate, companyToken, roleToken].filter(Boolean).join('_') || 'optimized_resume';
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

function ManualStudio() {
  const [activeTab, setActiveTab] = useState('resume');
  const [resumeDraft, setResumeDraft] = useState('');
  const [jobDraft, setJobDraft] = useState('');
  const [contextNotes, setContextNotes] = useState('');
  const [recruiterNotes, setRecruiterNotes] = useState('');
  const [useCanonical, setUseCanonical] = useState(true);
  const [isLoadingCanonical, setIsLoadingCanonical] = useState(false);

  const [versions, setVersions] = useState([]);
  const [selectedVersionId, setSelectedVersionId] = useState('');
  const [editorTex, setEditorTex] = useState('');
  const [editorDirty, setEditorDirty] = useState(false);

  const [coverLetterVersions, setCoverLetterVersions] = useState([]);
  const [selectedCoverLetterVersionId, setSelectedCoverLetterVersionId] = useState('');
  const [coverLetterTex, setCoverLetterTex] = useState('');
  const [coverLetterDirty, setCoverLetterDirty] = useState(false);

  const [drawerOpen, setDrawerOpen] = useState(true);
  const [logsOpen, setLogsOpen] = useState(false);
  const [runLogs, setRunLogs] = useState([]);

  const [pdfPreviewUrl, setPdfPreviewUrl] = useState('');
  const [pdfPreviewFilename, setPdfPreviewFilename] = useState('optimized_resume.pdf');
  const [isPreviewStale, setIsPreviewStale] = useState(false);
  const [coverLetterPdfPreviewUrl, setCoverLetterPdfPreviewUrl] = useState('');
  const [coverLetterPdfPreviewFilename, setCoverLetterPdfPreviewFilename] = useState('optimized_cover_letter.pdf');
  const [isCoverLetterPreviewStale, setIsCoverLetterPreviewStale] = useState(false);

  const [metadata, setMetadata] = useState(null);
  const [coverLetterMetadata, setCoverLetterMetadata] = useState(null);
  const [appliedAt, setAppliedAt] = useState('');
  const [coverLetterAppliedAt, setCoverLetterAppliedAt] = useState('');
  const [error, setError] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isCompiling, setIsCompiling] = useState(false);
  const [isGeneratingCoverLetter, setIsGeneratingCoverLetter] = useState(false);
  const [isCompilingCoverLetter, setIsCompilingCoverLetter] = useState(false);
  const [downloadCompany, setDownloadCompany] = useState('');
  const [downloadRole, setDownloadRole] = useState('');
  const [downloadCompanyEdited, setDownloadCompanyEdited] = useState(false);
  const [downloadRoleEdited, setDownloadRoleEdited] = useState(false);
  const [hiringManager, setHiringManager] = useState('');
  const [coverLetterTone, setCoverLetterTone] = useState('professional');
  const [coverLetterLength, setCoverLetterLength] = useState('standard');
  const [jobUrl, setJobUrl] = useState('');
  const [scrapedJob, setScrapedJob] = useState(null);
  const [isScraping, setIsScraping] = useState(false);
  const [isBundling, setIsBundling] = useState(false);
  const [coverLetterChoice, setCoverLetterChoice] = useState('auto');

  const pdfPreviewUrlRef = useRef('');
  const coverLetterPdfPreviewUrlRef = useRef('');

  const selectedVersion = useMemo(
    () => versions.find((item) => item.id === selectedVersionId) || null,
    [versions, selectedVersionId]
  );
  const selectedCoverLetterVersion = useMemo(
    () => coverLetterVersions.find((item) => item.id === selectedCoverLetterVersionId) || null,
    [coverLetterVersions, selectedCoverLetterVersionId]
  );

  const currentResumeSourceForLetter = useMemo(() => {
    if (String(editorTex || '').trim()) return editorTex;
    return resumeDraft;
  }, [editorTex, resumeDraft]);

  const autoCandidateName = useMemo(() => extractCandidateNameFromTex(currentResumeSourceForLetter || ''), [currentResumeSourceForLetter]);
  const detectedFromJD = useMemo(() => extractRoleCompanyFromJD(jobDraft), [jobDraft]);
  const resolvedDownloadCompany = downloadCompanyEdited ? downloadCompany : downloadCompany || detectedFromJD.company;
  const resolvedDownloadRole = downloadRoleEdited ? downloadRole : downloadRole || detectedFromJD.role;

  const activeBaseName = useMemo(
    () => buildDownloadBaseNameFromParts(autoCandidateName, resolvedDownloadCompany, resolvedDownloadRole),
    [autoCandidateName, resolvedDownloadCompany, resolvedDownloadRole]
  );
  const activeCoverLetterBaseName = useMemo(() => `${activeBaseName}_cover_letter`, [activeBaseName]);

  const canGenerate = !isGenerating && !!resumeDraft.trim() && !!jobDraft.trim();
  const canCompile = !isCompiling && !!editorTex.trim();
  const canGenerateCoverLetter =
    !isGeneratingCoverLetter && !!jobDraft.trim() && !!currentResumeSourceForLetter.trim();
  const canCompileCoverLetter = !isCompilingCoverLetter && !!coverLetterTex.trim();

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
      if (coverLetterPdfPreviewUrlRef.current) {
        URL.revokeObjectURL(coverLetterPdfPreviewUrlRef.current);
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
      setResumeDraft(canonicalResumeSource);
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

    if (!/\.(tex|txt)$/i.test(file.name)) {
      setError('Please upload a .tex or .txt file.');
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

  function clearCoverLetterPreview() {
    if (coverLetterPdfPreviewUrlRef.current) {
      URL.revokeObjectURL(coverLetterPdfPreviewUrlRef.current);
      coverLetterPdfPreviewUrlRef.current = '';
    }
    setCoverLetterPdfPreviewUrl('');
    setCoverLetterPdfPreviewFilename('optimized_cover_letter.pdf');
    setIsCoverLetterPreviewStale(false);
  }

  function setCoverLetterPreview(blob, filename) {
    const nextUrl = URL.createObjectURL(blob);
    if (coverLetterPdfPreviewUrlRef.current) {
      URL.revokeObjectURL(coverLetterPdfPreviewUrlRef.current);
    }
    coverLetterPdfPreviewUrlRef.current = nextUrl;
    setCoverLetterPdfPreviewUrl(nextUrl);
    setCoverLetterPdfPreviewFilename(filename);
    setIsCoverLetterPreviewStale(false);
  }

  function validateGenerateInputs() {
    const trimmedResume = resumeDraft.trim();
    const trimmedJD = jobDraft.trim();

    if (!trimmedResume) return 'Resume source is required.';
    if (isLatexResumeSource(trimmedResume)) {
      if (!trimmedResume.includes('\\begin{document}')) return 'Resume must include \\begin{document}.';
      if (!trimmedResume.includes('\\end{document}')) return 'Resume must include \\end{document}.';
    } else if (trimmedResume.length < 80) {
      return 'Plain-text resume input is too short. Add more source detail.';
    }

    const bytes = new TextEncoder().encode(trimmedResume).length;
    if (bytes > MAX_RESUME_BYTES) return `Resume exceeds ${MAX_RESUME_BYTES} bytes.`;

    if (!trimmedJD) return 'Job description is required.';
    if (trimmedJD.length > MAX_JD_CHARS) return `Job description exceeds ${MAX_JD_CHARS} characters.`;

    return '';
  }

  function validateCoverLetterInputs() {
    const trimmedResume = currentResumeSourceForLetter.trim();
    const trimmedJD = jobDraft.trim();

    if (!trimmedResume) return 'A resume source is required to generate a cover letter.';
    if (!trimmedJD) return 'Job description is required.';
    if (trimmedJD.length > MAX_JD_CHARS) return `Job description exceeds ${MAX_JD_CHARS} characters.`;

    return '';
  }

  function createVersion(tex, metadataValue) {
    const nextNumber = versions.length + 1;
    const version = {
      id: `v${nextNumber}-${Date.now()}`,
      label: `v${nextNumber}`,
      timestamp: new Date().toLocaleString(),
      tex,
      metadata: metadataValue || null,
    };

    setVersions((prev) => [...prev, version]);
    setSelectedVersionId(version.id);
    setEditorTex(tex);
    setEditorDirty(false);
    setMetadata(metadataValue || null);

    return version;
  }

  function createCoverLetterVersion(tex, metadataValue) {
    const nextNumber = coverLetterVersions.length + 1;
    const version = {
      id: `cl${nextNumber}-${Date.now()}`,
      label: `cl${nextNumber}`,
      timestamp: new Date().toLocaleString(),
      tex,
      metadata: metadataValue || null,
    };

    setCoverLetterVersions((prev) => [...prev, version]);
    setSelectedCoverLetterVersionId(version.id);
    setCoverLetterTex(tex);
    setCoverLetterDirty(false);
    setCoverLetterMetadata(metadataValue || null);

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

  function loadCoverLetterVersion(versionId) {
    const version = coverLetterVersions.find((item) => item.id === versionId);
    if (!version) return;

    setSelectedCoverLetterVersionId(version.id);
    setCoverLetterTex(version.tex);
    setCoverLetterDirty(false);
    setCoverLetterMetadata(version.metadata || null);
    clearCoverLetterPreview();
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

  async function compileCurrentCoverLetter(options = {}) {
    const {
      tex = coverLetterTex,
      download = false,
      label = selectedCoverLetterVersion?.label || 'working copy',
      baseName = activeCoverLetterBaseName,
    } = options;

    if (!String(tex || '').trim()) {
      setError('No cover letter LaTeX in editor to compile.');
      return;
    }

    setError('');
    setIsCompilingCoverLetter(true);

    try {
      const blob = await compilePdf(String(tex));
      const fileName = `${baseName || 'optimized_cover_letter'}.pdf`;
      setCoverLetterPreview(blob, fileName);

      if (download) {
        downloadBlob(blob, fileName);
      }

      appendLog('compile-cover-letter', `Compile success (${label})`, {
        label,
        filename: fileName,
        size_bytes: blob.size,
        editor_dirty: tex === coverLetterTex ? coverLetterDirty : false,
      });
    } catch (compileErr) {
      const message = String(compileErr?.message || compileErr);
      setError(message);
      appendLog('compile-cover-letter', `Compile failed (${label})`, {
        label,
        error: message,
        editor_dirty: tex === coverLetterTex ? coverLetterDirty : false,
      });
    } finally {
      setIsCompilingCoverLetter(false);
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
      const data = await generateTex(resumeDraft, jobDraft, contextNotes, recruiterNotes);
      const nextTex = data.optimized_tex || '';
      const version = createVersion(nextTex, data.metadata || null);

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
        removed_experience_entries: data.metadata?.removed_experience_entries || [],
        estimated_line_count: data.metadata?.estimated_line_count ?? null,
        compressed_by_postprocessor: data.metadata?.compressed_by_postprocessor ?? false,
        validator_failures: data.metadata?.validator_failures || [],
        tokens: data.metadata?.openai_tokens?.total || null,
        warning: data.metadata?.warning || '',
      });

      await compileCurrent({ tex: nextTex, download: false, label: version.label });
    } catch (err) {
      const message = String(err?.message || err);
      setError(message);
      appendLog('generate', 'Generation failed', { error: message });
    } finally {
      setIsGenerating(false);
    }
  }

  async function onGenerateCoverLetter() {
    setError('');
    const invalid = validateCoverLetterInputs();
    if (invalid) {
      setError(invalid);
      return;
    }

    setIsGeneratingCoverLetter(true);

    try {
      const data = await generateCoverLetter({
        resumeTex: currentResumeSourceForLetter,
        jobDescription: jobDraft,
        contextNotes,
        recruiterNotes,
        roleName: resolvedDownloadRole,
        companyName: resolvedDownloadCompany,
        hiringManager,
        tone: coverLetterTone,
        length: coverLetterLength,
      });
      const nextTex = data.cover_letter_tex || '';
      const version = createCoverLetterVersion(nextTex, data.metadata || null);

      setCoverLetterAppliedAt(new Date().toLocaleString());
      setDrawerOpen(false);
      clearCoverLetterPreview();

      appendLog('generate-cover-letter', `Generated ${version.label}`, {
        version: version.label,
        optimizer: data.metadata?.optimizer || 'unknown',
        tone: data.metadata?.tone || coverLetterTone,
        length: data.metadata?.length || coverLetterLength,
        skills_highlighted: data.metadata?.skills_highlighted || [],
        evidence_used: data.metadata?.evidence_used || [],
        tokens: data.metadata?.openai_tokens?.total || null,
        warning: data.metadata?.warning || '',
      });
    } catch (err) {
      const message = String(err?.message || err);
      setError(message);
      appendLog('generate-cover-letter', 'Generation failed', { error: message });
    } finally {
      setIsGeneratingCoverLetter(false);
    }
  }

  async function onImportJob() {
    setError('');
    setIsScraping(true);
    try {
      const imported = await scrapeJob(jobUrl.trim());
      setScrapedJob(imported);
      setJobDraft(imported.description || '');
      if (imported.company) {
        setDownloadCompany(imported.company);
        setDownloadCompanyEdited(true);
      }
      if (imported.role || imported.title) {
        setDownloadRole(imported.role || imported.title);
        setDownloadRoleEdited(true);
      }
      appendLog('job-import', `Imported ${imported.title || 'job posting'}`, {
        url: imported.url,
        source: imported.source,
        extraction_method: imported.extraction_method,
        company: imported.company,
        role: imported.role,
        description_characters: imported.description?.length || 0,
        cover_letter: imported.cover_letter,
      });
    } catch (err) {
      const message = String(err?.message || err);
      setError(message);
      appendLog('job-import', 'Job import failed', { url: jobUrl, error: message });
    } finally {
      setIsScraping(false);
    }
  }

  async function onGenerateBundle() {
    setError('');
    const invalid = validateGenerateInputs();
    if (invalid) return setError(invalid);
    setIsBundling(true);
    try {
      const resumeData = await generateTex(resumeDraft, jobDraft, contextNotes, recruiterNotes);
      const nextResumeTex = resumeData.optimized_tex || '';
      const resumeVersion = createVersion(nextResumeTex, resumeData.metadata || null);
      setAppliedAt(new Date().toLocaleString());
      clearPdfPreview();
      await compileCurrent({ tex: nextResumeTex, label: resumeVersion.label });

      const inference = scrapedJob?.cover_letter;
      const includeLetter = shouldGenerateCoverLetter(coverLetterChoice, inference);
      if (includeLetter) {
        const letterData = await generateCoverLetter({
          resumeTex: nextResumeTex,
          jobDescription: jobDraft,
          contextNotes,
          recruiterNotes,
          roleName: resolvedDownloadRole,
          companyName: resolvedDownloadCompany,
          hiringManager,
          tone: coverLetterTone,
          length: coverLetterLength,
        });
        createCoverLetterVersion(letterData.cover_letter_tex || '', letterData.metadata || null);
        setCoverLetterAppliedAt(new Date().toLocaleString());
        clearCoverLetterPreview();
      } else {
        setCoverLetterTex('');
        setSelectedCoverLetterVersionId('');
        setCoverLetterMetadata(null);
        clearCoverLetterPreview();
      }
      appendLog('bundle', 'Bundled generation complete', {
        resume: resumeVersion.label,
        cover_letter_generated: includeLetter,
        cover_letter_choice: coverLetterChoice,
        inference: inference || null,
      });
    } catch (err) {
      const message = String(err?.message || err);
      setError(message);
      appendLog('bundle', 'Bundled generation failed', { error: message });
    } finally {
      setIsBundling(false);
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

  async function onCopyCoverLetterTex() {
    if (!coverLetterTex) return;
    try {
      await navigator.clipboard.writeText(coverLetterTex);
    } catch {
      setError('Clipboard copy failed.');
    }
  }

  function onDownloadTex() {
    if (!editorTex) return;
    const blob = new Blob([editorTex], { type: 'application/x-tex' });
    downloadBlob(blob, `${activeBaseName}.tex`);
  }

  function onDownloadCoverLetterTex() {
    if (!coverLetterTex) return;
    const blob = new Blob([coverLetterTex], { type: 'application/x-tex' });
    downloadBlob(blob, `${activeCoverLetterBaseName}.tex`);
  }

  async function onDownloadPdf() {
    if (pdfPreviewUrl && !isPreviewStale) {
      const a = document.createElement('a');
      a.href = pdfPreviewUrl;
      a.download = `${activeBaseName}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      return;
    }

    await compileCurrent({ download: true });
  }

  async function onDownloadCoverLetterPdf() {
    if (coverLetterPdfPreviewUrl && !isCoverLetterPreviewStale) {
      const a = document.createElement('a');
      a.href = coverLetterPdfPreviewUrl;
      a.download = coverLetterPdfPreviewFilename || `${activeCoverLetterBaseName}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      return;
    }

    await compileCurrentCoverLetter({ download: true });
  }

  function onEditorChange(value) {
    setEditorTex(value);
    setEditorDirty(true);
    if (pdfPreviewUrl) {
      setIsPreviewStale(true);
    }
  }

  function onCoverLetterEditorChange(value) {
    setCoverLetterTex(value);
    setCoverLetterDirty(true);
    if (coverLetterPdfPreviewUrl) {
      setIsCoverLetterPreviewStale(true);
    }
  }

  function onAutofillDownloadName() {
    setDownloadCompany(detectedFromJD.company || '');
    setDownloadRole(detectedFromJD.role || '');
    setDownloadCompanyEdited(true);
    setDownloadRoleEdited(true);
  }

  function renderResumeToolbar() {
    return (
      <>
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

        {metadata?.relevance_summary || metadata?.chronology_summary ? (
          <div className="hint">
            {metadata?.relevance_summary ? `Relevance: ${metadata.relevance_summary}` : ''}
            {metadata?.relevance_summary && metadata?.chronology_summary ? ' ' : ''}
            {metadata?.chronology_summary ? `Chronology: ${metadata.chronology_summary}` : ''}
          </div>
        ) : null}

        <div className="filename-grid">
          <label className="filename-field">
            Candidate (auto)
            <input type="text" value={autoCandidateName} readOnly />
          </label>
          <label className="filename-field">
            Title (auto)
            <input type="text" value={detectedFromJD.title || ''} readOnly placeholder="detected job title" />
          </label>
          <label className="filename-field">
            Company
            <input
              type="text"
              value={downloadCompany}
              onChange={(e) => {
                setDownloadCompanyEdited(true);
                setDownloadCompany(e.target.value);
              }}
              placeholder={detectedFromJD.company || 'target company'}
            />
          </label>
          <label className="filename-field">
            Role
            <input
              type="text"
              value={downloadRole}
              onChange={(e) => {
                setDownloadRoleEdited(true);
                setDownloadRole(e.target.value);
              }}
              placeholder={detectedFromJD.role || 'target role'}
            />
          </label>
          <button type="button" className="secondary filename-autofill" onClick={onAutofillDownloadName}>
            Auto-fill from JD
          </button>
          <div className="filename-preview">
            Download name: <code>{`${activeBaseName}.pdf`}</code>
          </div>
          <div className="hint">
            JD detection: company <code>{detectedFromJD.company || 'not found'}</code>, role <code>{detectedFromJD.role || 'not found'}</code>, title <code>{detectedFromJD.title || 'not found'}</code>
          </div>
        </div>
      </>
    );
  }

  function renderPlusToolbar() {
    return (
      <>
        <div className="row">
          <button type="button" className="secondary" onClick={() => setDrawerOpen((v) => !v)}>
            {drawerOpen ? 'Hide Inputs' : 'Show Inputs'}
          </button>
          <button type="button" onClick={onGenerateCoverLetter} disabled={!canGenerateCoverLetter}>
            {isGeneratingCoverLetter ? 'Generating...' : 'Generate Cover Letter'}
          </button>
          <button type="button" onClick={() => void compileCurrentCoverLetter()} disabled={!canCompileCoverLetter}>
            {isCompilingCoverLetter ? 'Compiling...' : 'Try PDF Preview'}
          </button>
          <button
            type="button"
            onClick={() => void onDownloadCoverLetterPdf()}
            disabled={!coverLetterTex.trim() || isCompilingCoverLetter}
          >
            Download .pdf
          </button>
          <button type="button" className="secondary" onClick={onDownloadCoverLetterTex} disabled={!coverLetterTex.trim()}>
            Download .tex
          </button>
          <button type="button" className="secondary" onClick={onCopyCoverLetterTex} disabled={!coverLetterTex.trim()}>
            Copy
          </button>
        </div>

        <div className="row meta-row">
          <span>Backend: <code>{BACKEND_URL}</code></span>
          <span>Selected: <strong>{selectedCoverLetterVersion?.label || 'working copy'}</strong>{coverLetterDirty ? ' (edited)' : ''}</span>
          <span>Tokens: <strong>{summarizeTokens(coverLetterMetadata?.openai_tokens?.total)}</strong></span>
          <span>Applied inputs: <strong>{coverLetterAppliedAt || 'not yet'}</strong></span>
        </div>

        <div className="settings-grid">
          <label className="filename-field">
            Candidate (auto)
            <input type="text" value={autoCandidateName} readOnly />
          </label>
          <label className="filename-field">
            Title (auto)
            <input type="text" value={detectedFromJD.title || ''} readOnly placeholder="detected job title" />
          </label>
          <label className="filename-field">
            Company
            <input
              type="text"
              value={downloadCompany}
              onChange={(e) => {
                setDownloadCompanyEdited(true);
                setDownloadCompany(e.target.value);
              }}
              placeholder={detectedFromJD.company || 'target company'}
            />
          </label>
          <label className="filename-field">
            Role
            <input
              type="text"
              value={downloadRole}
              onChange={(e) => {
                setDownloadRoleEdited(true);
                setDownloadRole(e.target.value);
              }}
              placeholder={detectedFromJD.role || 'target role'}
            />
          </label>
          <label className="filename-field">
            Hiring Manager (optional)
            <input
              type="text"
              value={hiringManager}
              onChange={(e) => setHiringManager(e.target.value)}
              placeholder="Defaults to Hiring Manager"
            />
          </label>
          <label className="filename-field">
            Tone
            <select value={coverLetterTone} onChange={(e) => setCoverLetterTone(e.target.value)}>
              {TONE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="filename-field">
            Length
            <select value={coverLetterLength} onChange={(e) => setCoverLetterLength(e.target.value)}>
              {LENGTH_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="secondary filename-autofill" onClick={onAutofillDownloadName}>
            Auto-fill from JD
          </button>
          <div className="filename-preview">
            Download name: <code>{`${activeCoverLetterBaseName}.pdf`}</code>
          </div>
          <div className="hint">
            JD detection: company <code>{detectedFromJD.company || 'not found'}</code>, role <code>{detectedFromJD.role || 'not found'}</code>, title <code>{detectedFromJD.title || 'not found'}</code>
          </div>
          <div className="hint">
            Plus stays `.tex`-first, but you can try a PDF preview when compilation is available.
          </div>
        </div>
      </>
    );
  }

  function renderBundleToolbar() {
    const inference = scrapedJob?.cover_letter;
    return (
      <>
        <div className="row">
          <button type="button" className="secondary" onClick={() => setDrawerOpen((value) => !value)}>
            {drawerOpen ? 'Hide Inputs' : 'Show Inputs'}
          </button>
          <button type="button" onClick={() => void onGenerateBundle()} disabled={isBundling || !resumeDraft.trim() || !jobDraft.trim()}>
            {isBundling ? 'Building bundle...' : 'Generate Bundled Send'}
          </button>
        </div>
        <div className="row meta-row">
          <span>Imported via: <strong>{scrapedJob?.extraction_method || 'not yet'}</strong></span>
          <span>Source: <strong>{scrapedJob?.source || 'not yet'}</strong></span>
          <span>Cover letter: <strong>{inference?.status || 'not inferred'}</strong></span>
          <span>Confidence: <strong>{inference?.confidence || '—'}</strong></span>
        </div>
        {inference ? <div className="hint">Inference evidence: {inference.evidence}</div> : null}
      </>
    );
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>ResumeTailor Pipeline</h1>
        <p>input -&gt; generate -&gt; review -&gt; tweak -&gt; regenerate/compile -&gt; download</p>
      </header>

      <section className="tab-row">
        <button
          type="button"
          className={`tab-button ${activeTab === 'resume' ? 'active' : ''}`}
          onClick={() => setActiveTab('resume')}
        >
          Resume
        </button>
        <button
          type="button"
          className={`tab-button ${activeTab === 'plus' ? 'active' : ''}`}
          onClick={() => setActiveTab('plus')}
        >
          Plus
        </button>
        <button
          type="button"
          className={`tab-button ${activeTab === 'bundle' ? 'active' : ''}`}
          onClick={() => setActiveTab('bundle')}
        >
          Bundled Send
        </button>
      </section>

      <section className="toolbar card">
        {activeTab === 'resume' ? renderResumeToolbar() : activeTab === 'plus' ? renderPlusToolbar() : renderBundleToolbar()}
      </section>

      {drawerOpen ? (
        <section className="card drawer-card">
          <h2>{activeTab === 'resume' ? 'Resume Inputs' : activeTab === 'bundle' ? 'Bundled Send Inputs' : 'Shared Inputs'}</h2>
          {activeTab === 'bundle' ? (
            <div className="job-import-box">
              <label htmlFor="job-url">Job posting URL</label>
              <div className="job-url-row">
                <input id="job-url" type="url" value={jobUrl} onChange={(event) => setJobUrl(event.target.value)} placeholder="https://hiring.cafe/job/... or https://linkedin.com/jobs/view/..." />
                <button type="button" onClick={() => void onImportJob()} disabled={isScraping || !jobUrl.trim()}>
                  {isScraping ? 'Importing...' : 'Import & auto-fill'}
                </button>
              </div>
              <div className="bundle-options">
                <label>Cover letter behavior
                  <select value={coverLetterChoice} onChange={(event) => setCoverLetterChoice(event.target.value)}>
                    <option value="auto">Auto (use posting inference)</option>
                    <option value="include">Always include</option>
                    <option value="skip">Skip</option>
                  </select>
                </label>
                <span className="hint">Auto generates a letter only when the posting requires or explicitly invites one.</span>
              </div>
              {scrapedJob ? (
                <div className="bundle-autofill-grid">
                  <label>
                    Company
                    <input
                      type="text"
                      value={downloadCompany}
                      onChange={(event) => {
                        setDownloadCompanyEdited(true);
                        setDownloadCompany(event.target.value);
                      }}
                    />
                  </label>
                  <label>
                    Role
                    <input
                      type="text"
                      value={downloadRole}
                      onChange={(event) => {
                        setDownloadRoleEdited(true);
                        setDownloadRole(event.target.value);
                      }}
                    />
                  </label>
                  <label>
                    Location
                    <input type="text" value={scrapedJob.location || 'Not listed'} readOnly />
                  </label>
                </div>
              ) : null}
            </div>
          ) : null}
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
            <input type="file" accept=".tex,.txt" onChange={onUploadFile} disabled={useCanonical} />
          </div>

          <div className="drawer-grid drawer-grid-wide">
            <div>
              <label>Resume source (.tex or plain text)</label>
              <textarea
                rows={11}
                value={resumeDraft}
                onChange={(e) => setResumeDraft(e.target.value)}
                placeholder="Paste source resume TeX or plain-text resume notes"
              />
            </div>
            <div>
              <label htmlFor="job-description">Job description</label>
              <textarea
                id="job-description"
                rows={11}
                value={jobDraft}
                onChange={(e) => setJobDraft(e.target.value)}
                placeholder="Paste job description"
              />
            </div>
            <div className="drawer-span-full">
              <label>Notes / factual supplemental context</label>
              <textarea
                rows={5}
                value={contextNotes}
                onChange={(e) => setContextNotes(e.target.value)}
                placeholder="Add verified details, constraints, or plain-text resume context the generator may use as source material."
              />
            </div>
            <div className="drawer-span-full">
              <label>Recruiter notes / extra instructions</label>
              <textarea
                rows={5}
                value={recruiterNotes}
                onChange={(e) => setRecruiterNotes(e.target.value)}
                placeholder="Add emphasis instructions such as: lead with IT support, prioritize healthcare hardware, prefer 2 projects, or sound more recruiter-friendly. Unsupported instructions will be ignored."
              />
            </div>
          </div>
          <div className="hint">
            Shared inputs feed both tabs. Resume source may be LaTeX or plain text. Factual notes add source context. Recruiter notes act as additive prompt instructions and cannot override truth or one-page constraints.
          </div>
        </section>
      ) : null}

      {activeTab === 'resume' && versions.length ? (
        <section className="card version-card">
          <h2>Resume Version History</h2>
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

      {activeTab === 'plus' && coverLetterVersions.length ? (
        <section className="card version-card">
          <h2>Cover Letter Version History</h2>
          <div className="version-list">
            {coverLetterVersions
              .slice()
              .reverse()
              .map((version) => (
                <button
                  key={version.id}
                  type="button"
                  className={`version-item ${selectedCoverLetterVersionId === version.id ? 'active' : ''}`}
                  onClick={() => loadCoverLetterVersion(version.id)}
                >
                  <span>{version.label}</span>
                  <small>{version.timestamp}</small>
                </button>
              ))}
          </div>
        </section>
      ) : null}

      {activeTab === 'resume' ? (
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
      ) : activeTab === 'plus' ? (
        <section className="workspace-grid">
          <section className="card panel-card">
            <h2>Cover Letter LaTeX Editor (working copy)</h2>
            <textarea
              className="workspace-editor"
              value={coverLetterTex}
              onChange={(e) => onCoverLetterEditorChange(e.target.value)}
              placeholder="Generate a cover letter to begin editing."
            />
          </section>

          <section className="card panel-card">
            <h2>{coverLetterPdfPreviewUrl ? 'PDF Preview' : 'Cover Letter Output'}</h2>
            {coverLetterPdfPreviewUrl ? (
              <>
                {isCoverLetterPreviewStale ? <div className="hint stale">Preview is stale. Re-run PDF preview for the current editor text.</div> : null}
                <iframe title="Cover Letter PDF Preview" className="pdf-preview" src={coverLetterPdfPreviewUrl} />
              </>
            ) : (
              <div className="output-summary">
                <p>Generate a tailored cover letter, review the LaTeX, and use `Try PDF Preview` when compilation is available.</p>
                <p>
                  Tone: <strong>{coverLetterMetadata?.tone || coverLetterTone}</strong>
                </p>
                <p>
                  Length: <strong>{coverLetterMetadata?.length || coverLetterLength}</strong>
                </p>
                <p>
                  Skills highlighted: <strong>{(coverLetterMetadata?.skills_highlighted || []).join(', ') || 'none yet'}</strong>
                </p>
                <p>
                  Evidence used: <strong>{(coverLetterMetadata?.evidence_used || []).join(', ') || 'none yet'}</strong>
                </p>
                {coverLetterMetadata?.warning ? (
                  <div className="hint stale">Warning: {coverLetterMetadata.warning}</div>
                ) : (
                  <div className="hint">No PDF preview yet. Generate the letter first, then try the preview button.</div>
                )}
              </div>
            )}
          </section>
        </section>
      ) : (
        <section className="workspace-grid bundle-workspace">
          <section className="card panel-card">
            <h2>Tailored Resume</h2>
            <textarea className="workspace-editor" value={editorTex} onChange={(e) => onEditorChange(e.target.value)} placeholder="Import a job, then generate the bundle." />
          </section>
          <section className="card panel-card">
            <h2>{coverLetterTex ? 'Cover Letter' : 'Bundle Status'}</h2>
            {coverLetterTex ? (
              <textarea className="workspace-editor" value={coverLetterTex} onChange={(e) => onCoverLetterEditorChange(e.target.value)} />
            ) : (
              <div className="output-summary">
                <p>No cover letter generated for this bundle.</p>
                <p>Inference: <strong>{scrapedJob?.cover_letter?.status || 'Import a posting to analyze it'}</strong></p>
                <p>{scrapedJob?.cover_letter?.evidence || 'You can override the automatic decision before generation.'}</p>
              </div>
            )}
          </section>
        </section>
      )}

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

export default function App() {
  const { pathname, navigate } = useAppPath();

  if (pathname === '/dashboard' || pathname === '/dashboard/inbox' || pathname === '/dashboard/review' || pathname === '/dashboard/tracker') {
    return <DashboardShell pathname={pathname} onNavigate={navigate} />;
  }

  return <ManualStudio />;
}
