import { useEffect, useMemo, useRef, useState } from 'react';
import { BACKEND_URL, compilePdf, generateCoverLetter, generateTex } from './api';

const MAX_RESUME_BYTES = 200 * 1024;
const MAX_JD_CHARS = 30000;
const CANONICAL_RESUME_PATH = 'source_of_truth/resumes/stephen_syl_akinwale__resume__source.tex';

const TONE_OPTIONS = ['professional', 'confident', 'warm'];
const LENGTH_OPTIONS = ['concise', 'standard', 'detailed'];

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

function cleanJobText(value) {
  return String(value || '')
    .replace(/[“”]/g, '"')
    .replace(/[’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanDetectionLine(value) {
  return String(value || '')
    .replace(/^[\s\-*•|:]+/, '')
    .replace(/\s+/g, ' ')
    .replace(/[|:]+$/g, '')
    .trim();
}

function isLikelyNoiseLine(line) {
  return !line || /^(job description|about (the )?role|responsibilities|requirements|qualifications|preferred|benefits|location|salary|hours|schedule)$/i.test(line);
}

function looksLikeRoleLine(line) {
  return /\b(engineer|developer|analyst|manager|specialist|support|administrator|consultant|designer|architect|scientist|coordinator|technician|associate|lead|director|recruiter|writer|editor|intern)\b/i.test(
    line
  );
}

function looksLikeCompanyLine(line) {
  return /\b(inc|llc|ltd|corp|company|technologies|technology|systems|solutions|labs|group|partners|university|health|bank|services|studio|media)\b/i.test(
    line
  );
}

function cleanDetectedEntity(value, kind) {
  const cleaned = cleanDetectionLine(value)
    .replace(/\b(remote|hybrid|onsite)\b/gi, '')
    .replace(/\s+\|\s+.*/g, '')
    .replace(/\s+-\s+(remote|hybrid|onsite).*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  if (!cleaned || isLikelyNoiseLine(cleaned)) return '';
  if (kind === 'role' && cleaned.length > 90) return '';
  if (kind === 'company' && cleaned.length > 70) return '';
  return cleaned;
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
  const jdText = cleanJobText(jd);
  const lines = String(jd || '')
    .split(/\r?\n/)
    .map((line) => cleanDetectionLine(line))
    .filter((line) => line && !isLikelyNoiseLine(line));

  const topLines = lines.slice(0, 12);

  for (let index = 0; index < Math.min(topLines.length, 6); index += 1) {
    const line = topLines[index];
    const nextLine = topLines[index + 1] || '';

    if (looksLikeRoleLine(line) && nextLine && !looksLikeRoleLine(nextLine)) {
      const role = cleanDetectedEntity(line, 'role');
      const company = cleanDetectedEntity(nextLine, 'company');
      if (role || company) return { role, company };
    }

    if (looksLikeCompanyLine(line) && nextLine && looksLikeRoleLine(nextLine)) {
      const company = cleanDetectedEntity(line, 'company');
      const role = cleanDetectedEntity(nextLine, 'role');
      if (role || company) return { role, company };
    }

    const splitMatch = line.match(/^(.+?)\s+(?:@|at|-)\s+(.+)$/i);
    if (splitMatch?.[1] && splitMatch?.[2]) {
      const left = cleanDetectedEntity(splitMatch[1], 'role');
      const right = cleanDetectedEntity(splitMatch[2], 'company');
      if (looksLikeRoleLine(left) || looksLikeCompanyLine(right)) {
        return { role: left, company: right };
      }
    }
  }

  let company = '';
  const companyPatterns = [
    /\b(?:company|organization|employer)\s*:?\s*([A-Z][A-Za-z0-9&.'\- ]{1,60})\b/i,
    /\bHere at\s+([A-Z][A-Za-z0-9&.'\- ]{1,60})[,.\s]/i,
    /\b([A-Z][A-Za-z0-9&.'\- ]{1,60})\s+is\s+hiring\b/i,
    /\b([A-Z][A-Za-z0-9&.'\- ]{1,60})\s+is\s+seeking\b/i,
    /\bAbout\s+([A-Z][A-Za-z0-9&.'\- ]{1,60})\b/i,
  ];
  for (const pattern of companyPatterns) {
    const match = jdText.match(pattern);
    if (match?.[1]) {
      company = cleanDetectedEntity(match[1], 'company');
      break;
    }
  }

  if (!company) {
    const titleCaseLine = topLines.find((line) => /^[A-Z][A-Za-z0-9&.'\- ]{1,60}$/.test(line) && !looksLikeRoleLine(line));
    if (titleCaseLine) company = cleanDetectedEntity(titleCaseLine, 'company');
  }

  let role = '';
  const rolePatterns = [
    /\b(?:job title|title|role|position)\s*:?\s*([A-Z][A-Za-z0-9/&()\- ]{2,80}?)(?=[.,\n]|$)/i,
    /\b(?:hiring|seeking)\s+an?\s+([A-Z][A-Za-z0-9/&()\- ]{2,80}?)(?=\s+to\b|[.,\n]|$)/i,
    /\bRole\s*:?\s*([A-Z][A-Za-z0-9/&()\- ]{2,80}?)(?=[.,\n]|$)/i,
    /\bPosition\s*:?\s*([A-Z][A-Za-z0-9/&()\- ]{2,80}?)(?=[.,\n]|$)/i,
  ];
  for (const pattern of rolePatterns) {
    const match = jdText.match(pattern);
    if (match?.[1]) {
      role = cleanDetectedEntity(match[1], 'role');
      break;
    }
  }

  if (!role) {
    const roleLine = topLines.find(
      (line) =>
        /\b(engineer|developer|analyst|manager|specialist|support|administrator|consultant)\b/i.test(line) &&
        !looksLikeCompanyLine(line)
    );
    if (roleLine) role = cleanDetectedEntity(roleLine, 'role');
  }

  return { role, company };
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

export default function App() {
  const [activeTab, setActiveTab] = useState('resume');
  const [resumeDraft, setResumeDraft] = useState('');
  const [jobDraft, setJobDraft] = useState('');
  const [contextNotes, setContextNotes] = useState('');
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

    if (!trimmedResume) return 'Resume LaTeX is required.';
    if (!trimmedResume.includes('\\begin{document}')) return 'Resume must include \\begin{document}.';
    if (!trimmedResume.includes('\\end{document}')) return 'Resume must include \\end{document}.';

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
    if (!trimmedResume.includes('\\begin{document}')) return 'Cover letter generation currently expects a LaTeX resume source.';
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
      const data = await generateTex(resumeDraft, jobDraft, contextNotes);
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

      await compileCurrentCoverLetter({ tex: nextTex, download: false, label: version.label });
    } catch (err) {
      const message = String(err?.message || err);
      setError(message);
      appendLog('generate-cover-letter', 'Generation failed', { error: message });
    } finally {
      setIsGeneratingCoverLetter(false);
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
      a.download = `${activeCoverLetterBaseName}.pdf`;
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

        <div className="filename-grid">
          <label className="filename-field">
            Candidate (auto)
            <input type="text" value={autoCandidateName} readOnly />
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
            {isCompilingCoverLetter ? 'Compiling...' : 'Compile Current'}
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
            Plus uses the current resume working copy when available. Otherwise it uses the shared resume source and supplemental notes.
          </div>
        </div>
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
      </section>

      <section className="toolbar card">{activeTab === 'resume' ? renderResumeToolbar() : renderPlusToolbar()}</section>

      {drawerOpen ? (
        <section className="card drawer-card">
          <h2>{activeTab === 'resume' ? 'Resume Inputs' : 'Shared Inputs'}</h2>
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

          <div className="drawer-grid drawer-grid-wide">
            <div>
              <label>Resume source (.tex)</label>
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
            <div className="drawer-span-full">
              <label>Notes / supplemental context</label>
              <textarea
                rows={6}
                value={contextNotes}
                onChange={(e) => setContextNotes(e.target.value)}
                placeholder="Add achievements, constraints, plain-text resume details, or direction you want the generators to consider."
              />
            </div>
          </div>
          <div className="hint">
            Shared inputs feed both tabs. Resume generation still expects LaTeX source. The supplemental notes field can hold plain-text context.
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
      ) : (
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
            <h2>PDF Preview</h2>
            {coverLetterPdfPreviewUrl ? (
              <>
                {isCoverLetterPreviewStale ? <div className="hint stale">Preview is stale. Recompile current editor text.</div> : null}
                <iframe title="Cover Letter PDF Preview" className="pdf-preview" src={coverLetterPdfPreviewUrl} />
              </>
            ) : (
              <div className="empty-preview">No compiled PDF yet. Generate or compile the cover letter to render preview.</div>
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
