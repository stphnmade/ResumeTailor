export const BACKEND_URL =
  import.meta.env.VITE_BACKEND_URL?.replace(/\/$/, '') ??
  'https://resumetailor-ivory.vercel.app';

export type GenerateTexResponse = {
  optimized_tex: string;
  metadata?: {
    removed_projects?: string[];
    keyword_focus?: string[];
    warning?: string;
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

  return await res.blob();
}
