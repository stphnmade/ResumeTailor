export const BACKEND_URL =
  import.meta.env.VITE_BACKEND_URL?.replace(/\/$/, '') ??
  'https://resumetailor-ivory.vercel.app';

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

export async function health() {
  const res = await fetch(`${BACKEND_URL}/api/health`, { method: 'GET' });
  if (!res.ok) {
    throw new Error(`Health failed: ${res.status}`);
  }
  return res.json();
}

export async function generateTex(resumeTex: string, jobDescription: string): Promise<GenerateTexResponse> {
  const res = await fetch(`${BACKEND_URL}/api/generate-tex`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      resume_tex: resumeTex,
      job_description: jobDescription,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(String(data?.error || `Generate failed: ${res.status}`));
  }
  return data as GenerateTexResponse;
}

export async function compilePdf(tex: string): Promise<Blob> {
  const res = await fetch(`${BACKEND_URL}/api/compile-pdf`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tex }),
  });

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
