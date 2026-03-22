export const BACKEND_URL =
  import.meta.env.VITE_BACKEND_URL?.replace(/\/$/, '') ??
  'https://resumetailor-ivory.vercel.app';

const GENERATE_TIMEOUT_MS = 70_000;
const COVER_LETTER_TIMEOUT_MS = 60_000;
const COMPILE_TIMEOUT_MS = 40_000;

export type GenerateTexResponse = {
  optimized_tex: string;
  metadata?: {
    removed_projects?: string[];
    included_projects?: string[];
    keyword_focus?: string[];
    keyword_coverage?: string[];
    support_keywords_target?: string[];
    coverage_required?: number;
    coverage_total?: number;
    project_count?: number;
    bullet_count?: number;
    experience_entry_count?: number;
    experience_bullet_count?: number;
    project_bullet_count?: number;
    estimated_line_count?: number;
    compressed_by_postprocessor?: boolean;
    removed_experience_entries?: string[];
    validator_failures?: string[];
    regeneration_attempted?: boolean;
    warning?: string;
    optimizer?: string;
    model?: string;
    key_source?: string;
    openai_response_id?: string;
    openai_tokens?: {
      pass_1?: {
        input_tokens?: number;
        output_tokens?: number;
        total_tokens?: number;
        cached_input_tokens?: number;
        reasoning_output_tokens?: number;
      };
      pass_2?: {
        input_tokens?: number;
        output_tokens?: number;
        total_tokens?: number;
        cached_input_tokens?: number;
        reasoning_output_tokens?: number;
      };
      total?: {
        input_tokens?: number;
        output_tokens?: number;
        total_tokens?: number;
        cached_input_tokens?: number;
        reasoning_output_tokens?: number;
      };
    };
    openai_error?: {
      name?: string;
      message?: string;
      status?: number;
      code?: string;
      type?: string;
      cause?: string;
    };
  };
};

export type GenerateCoverLetterResponse = {
  cover_letter_tex: string;
  metadata?: {
    skills_highlighted?: string[];
    evidence_used?: string[];
    tone?: string;
    length?: string;
    warning?: string;
    optimizer?: string;
    model?: string;
    key_source?: string;
    openai_response_id?: string;
    openai_tokens?: {
      total?: {
        input_tokens?: number;
        output_tokens?: number;
        total_tokens?: number;
        cached_input_tokens?: number;
        reasoning_output_tokens?: number;
      };
    };
    openai_error?: {
      name?: string;
      message?: string;
      status?: number;
      code?: string;
      type?: string;
      cause?: string;
    };
  };
};

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s.`);
    }
    throw err;
  } finally {
    window.clearTimeout(timer);
  }
}

export async function health() {
  const res = await fetchWithTimeout(`${BACKEND_URL}/api/health`, { method: 'GET' }, 15_000);
  if (!res.ok) {
    throw new Error(`Health failed: ${res.status}`);
  }
  return res.json();
}

export async function generateTex(
  resumeTex: string,
  jobDescription: string,
  contextNotes = '',
  recruiterNotes = ''
): Promise<GenerateTexResponse> {
  const res = await fetchWithTimeout(`${BACKEND_URL}/api/generate-tex`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      resume_tex: resumeTex,
      job_description: jobDescription,
      context_notes: contextNotes,
      recruiter_notes: recruiterNotes,
    }),
  }, GENERATE_TIMEOUT_MS);

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(String(data?.error || `Generate failed: ${res.status}`));
  }
  return data as GenerateTexResponse;
}

export async function generateCoverLetter(params: {
  resumeTex: string;
  jobDescription: string;
  contextNotes?: string;
  recruiterNotes?: string;
  roleName?: string;
  companyName?: string;
  hiringManager?: string;
  tone?: string;
  length?: string;
}): Promise<GenerateCoverLetterResponse> {
  const res = await fetchWithTimeout(`${BACKEND_URL}/api/generate-cover-letter`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      resume_tex: params.resumeTex,
      job_description: params.jobDescription,
      context_notes: params.contextNotes || '',
      recruiter_notes: params.recruiterNotes || '',
      role_name: params.roleName || '',
      company_name: params.companyName || '',
      hiring_manager: params.hiringManager || '',
      tone: params.tone || 'professional',
      length: params.length || 'standard',
    }),
  }, COVER_LETTER_TIMEOUT_MS);

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(String(data?.error || `Cover letter generation failed: ${res.status}`));
  }
  return data as GenerateCoverLetterResponse;
}

export async function compilePdf(tex: string): Promise<Blob> {
  const res = await fetchWithTimeout(`${BACKEND_URL}/api/compile-pdf`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tex }),
  }, COMPILE_TIMEOUT_MS);

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(String(err?.log || `Compile failed: ${res.status}`));
  }

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/pdf')) {
    const asText = await res.text().catch(() => '');
    throw new Error(asText || `Compile did not return PDF (${res.status}).`);
  }

  return await res.blob();
}
