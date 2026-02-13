# ResumeTailor MVP (Web + API)

ResumeTailor is a private LaTeX-first resume optimizer.

- Frontend target: `https://stphnmade.github.io/ResumeTailor/` (GitHub Pages)
- Backend target: Vercel API routes (`/api/generate-tex`, `/api/compile-pdf`)
- Primary output: optimized LaTeX (copy + `.tex` download)
- Secondary output: auto-downloaded compiled PDF

## Architecture

- `src/*`: Vite + React frontend
- `api/generate-tex.js`: resume optimization API
- `api/compile-pdf.js`: LaTeX PDF compilation API using `tectonic`
- `api/_lib/*`: shared backend logic (CORS, parsing, validation, OpenAI)

## Security + Secrets

- `OPENAI_API_KEY` is read from environment only.
- No API key is exposed to client code.
- CORS is restricted to GitHub Pages origin in production.
- Request size limits and compile timeout are enforced.
- Raw resumes are not logged.

## Local Development

### 1) Install frontend dependencies

```bash
npm install
```

### 2) Configure environment

Copy `.env.example` and set values as needed.

- For GitHub Pages build usage:
  - `VITE_API_BASE_URL="https://<your-vercel-project>.vercel.app"`
- For backend OpenAI usage (Vercel env vars):
  - `OPENAI_API_KEY`
  - `OPENAI_MODEL` (optional, default `gpt-4.1-mini`)

### 3) Run frontend

```bash
npm run dev
```

## API Contracts

### `POST /api/generate-tex`

Request:

```json
{
  "resume_tex": "string",
  "job_description": "string"
}
```

Response:

```json
{
  "optimized_tex": "string",
  "metadata": {
    "removed_projects": ["string"],
    "keyword_focus": ["string"],
    "warning": "string"
  }
}
```

### `POST /api/compile-pdf`

Request:

```json
{
  "tex": "string"
}
```

Success response:

- `200 OK`
- `Content-Type: application/pdf`
- Binary PDF bytes

Error response:

```json
{
  "error": "LATEX_COMPILE_FAILED",
  "log": "string"
}
```

## Behavior Summary

- Resume input validation:
  - requires `\\begin{document}` and `\\end{document}`
  - max 200 KB
- Job description validation:
  - required
  - max 30,000 chars
- Preamble before `\\begin{document}` is preserved verbatim.
- Hallucination guard rejects outputs that introduce new technology terms.
- One-page heuristics trim low-value content and set a warning if still likely dense.
- Frontend shows optimized LaTeX immediately and attempts PDF compile/download afterward.

## Deployment

### GitHub Pages (frontend)

- Build with `npm run build`.
- Publish `dist/` to GitHub Pages for this repository.
- Vite base path is configured for `/ResumeTailor/`.

### Vercel (backend + optional static)

- Add environment variables in Vercel Project Settings:
  - `OPENAI_API_KEY`
  - `OPENAI_MODEL` (optional)
- Ensure `tectonic` is available in runtime if using PDF compilation route.
- `vercel.json` sets function timeout to 30 seconds.

## Existing CLI Prototype

The earlier Python CLI prototype remains in this repo (`tailor.py`, `rae/*`) and is independent from the web MVP.
