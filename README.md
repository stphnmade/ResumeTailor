# ResumeTailor Monorepo

This repository is split into:

- `frontend/` - Vite + React app for GitHub Pages
- `backend/` - Vercel serverless API (`backend/api/*`)

## Repository Layout

- `frontend/index.html`
- `frontend/src/*`
- `frontend/vite.config.js` (`base: '/ResumeTailor/'` for GitHub Pages)
- `source_of_truth/*` (canonical resume + tailoring rules + JD examples)
- `backend/api/health.ts`
- `backend/api/generate-tex.ts`
- `backend/api/compile-pdf.ts`
- `backend/lib/prompts/*.md` (prompt templates loaded at runtime)
- `backend/vercel.json`
- `.github/workflows/deploy-pages.yml`

## Secrets Policy

- Never commit secrets.
- Only commit `.env.example`.
- OpenAI secrets are backend-only and must be set in Vercel Environment Variables.
- Do not put OpenAI secrets in frontend code or frontend env vars.

## Frontend Deployment (GitHub Pages)

A GitHub Actions workflow is included at `.github/workflows/deploy-pages.yml`.

It:

1. Installs `frontend/` dependencies
2. Copies repository `source_of_truth/` into `frontend/public/source_of_truth/`
3. Builds `frontend/dist`
4. Deploys `frontend/dist` to GitHub Pages

Set repository variable `VITE_BACKEND_URL` to your deployed Vercel backend origin (for example `https://your-backend.vercel.app`).

After deployment, frontend URL should be:

- `https://stphnmade.github.io/ResumeTailor/`

## Backend Deployment (Vercel)

1. In Vercel, import this GitHub repository.
2. Set **Root Directory** to `backend`.
3. Deploy.
4. In Vercel Project Settings -> Environment Variables, set:
   - `OPENAI_KEY`
   - `OPENAI_MODEL` (optional, e.g. `gpt-4.1-mini`)

`backend/vercel.json` configures serverless function runtime settings.

## Verification Checklist

1. Backend health endpoint:
   - `GET https://<your-backend>.vercel.app/api/health`
   - Expected JSON: `{ "ok": true }`
2. Frontend page loads at:
   - `https://stphnmade.github.io/ResumeTailor/`
3. Frontend can call backend:
   - Trigger Generate flow and confirm API requests target `VITE_BACKEND_URL`
4. Confirm no secret leakage:
   - Search frontend for OpenAI secret names (should be none)
5. Canonical resume asset is reachable:
   - `GET https://stphnmade.github.io/ResumeTailor/source_of_truth/resumes/stephen_syl_akinwale__resume__source.tex`
   - Expected status: `200`
