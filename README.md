# ResumeTailor Monorepo

This repository is split into:

- `frontend/` - Vite + React app for GitHub Pages
- `backend/` - Vercel serverless API (`backend/api/*`)
- `rae/` + `tailor.py` - local Python resume alignment engine and CLI

## Product Surfaces

- `v1: Manual Studio`
  The current user-facing web product lives in `frontend/src/App.jsx` and the serverless handlers in `backend/api/*`.
  It is a single-page workflow with three tabs:
  `Resume` for tailored resume generation and review
  `Plus` for cover letter generation and review
  `Bundled Send` for importing a job URL, reviewing parsed fields, and generating a resume plus an inferred/overridden cover letter
- `Local CLI / engine`
  The Python path in `tailor.py` and `rae/*` is a separate local tooling surface for LaTeX parsing, scoring, alignment, and optional bullet rewriting.
- `v2 beta (planned, not implemented here)`
  The repo is being prepared for a parallel `dashboard`-based workflow plus extension-assisted job application pipeline without replacing v1.

## Route Stance

- Keep the current root experience unchanged for now.
- Reserve `/manual` as the explicit v1 "Manual Studio" route once frontend routing is introduced.
- Reserve `/dashboard` as the v2 beta route.
- Do not migrate current users or break the existing GitHub Pages root route during v2 prep.

## Repository Layout

- `frontend/index.html`
- `frontend/src/*`
- `frontend/vite.config.js` (`base: '/ResumeTailor/'` for GitHub Pages)
- `tailor.py`
- `rae/*`
- `source_of_truth/*` (canonical resume + tailoring rules + JD examples)
- `backend/api/health.ts`
- `backend/api/generate-tex.ts`
- `backend/api/compile-pdf.ts`
- `backend/api/generate-cover-letter.ts`
- `backend/api/scrape-job.ts`
- `backend/lib/job-scraper.js` (HTTPS fetch, redirect/size/time limits, SSRF checks, free Reader fallback)
- `backend/lib/job-parser.js` (JSON-LD, HiringCafe, LinkedIn, and cover-letter inference)
- `backend/lib/prompts/*.md` (prompt templates loaded at runtime)
- `backend/lib/templates/*`
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
   - `OPENAI_API_KEY`
   - `OPENAI_MODEL` (optional, e.g. `gpt-4.1-mini`)
   - `LATEX_REMOTE_FALLBACK` (optional, defaults to enabled; set to `false` to disable remote PDF fallback when local `tectonic` is unavailable)
   - `LATEXONLINE_BASE_URL` (optional, defaults to `https://texlive2020.latexonline.cc`)

`backend/vercel.json` configures serverless function runtime settings.

Note: remote fallback sends LaTeX source to the configured remote compiler endpoint.

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

## Job Import Verification

From `backend/`:

- `npm run test:jobs` runs deterministic parser, fallback, redirect, blocking, and SSRF tests.
- `npm run test:jobs:live` checks three current HiringCafe postings and three current LinkedIn postings for exact title/company extraction, meaningful description length, and navigation-chrome removal.

The live suite intentionally depends on third-party postings. A removed job or temporary anti-bot response should fail the suite and prompt replacement of that sample; it should never be accepted as a job description.
