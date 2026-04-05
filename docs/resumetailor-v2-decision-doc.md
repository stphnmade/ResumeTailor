# ResumeTailor v2 Beta Decision Doc

## Goal

Prepare ResumeTailor v2 beta alongside the existing product without breaking the current v1 experience.

## Product Stance

- Personal-first: `User 0` comes first.
- v1 remains the stable manual workflow.
- v2 is built in parallel as a dashboard-based system with browser extension integration and a human-in-the-loop application pipeline.

## Current Product Mapping

### v1: Manual Studio

Current v1 logic lives in these areas:

- Frontend entry point: `frontend/src/main.jsx`
- Main v1 UI shell: `frontend/src/App.jsx`
- Frontend API client: `frontend/src/api.ts`
- Backend handlers:
  - `backend/api/health.ts`
  - `backend/api/generate-tex.ts`
  - `backend/api/generate-cover-letter.ts`
  - `backend/api/compile-pdf.ts`
- Prompt/template assets:
  - `backend/lib/prompts/*`
  - `backend/lib/templates/*`
- Canonical inputs / rules:
  - `source_of_truth/*`
  - `backend/source_of_truth/*`

Conceptual definition:

- `Manual Studio` is the current human-operated workflow where the user pastes a job description, edits inputs manually, generates a tailored resume or cover letter, reviews LaTeX, and optionally compiles a PDF.

### Local Engine / CLI

There is also a separate local Python path:

- CLI entry point: `tailor.py`
- Resume parsing / rebuilding: `rae/latex.py`
- Resume alignment and bullet selection: `rae/engine.py`
- Job description analysis: `rae/jd.py`
- Optional OpenAI-backed analysis / rewrites: `rae/openai_client.py`
- Config/env loading: `rae/config.py`
- Tests: `tests/test_rae.py`

This path should be treated as legacy/local tooling until explicitly folded into the v2 architecture.

## Current Pipeline Audit

### Frontend entry points

- `frontend/src/main.jsx` mounts the app.
- `frontend/src/App.jsx` contains the entire current v1 UI and workflow state.
- There is no frontend router today.
- The current UX is tab-based inside one page:
  - `Resume`
  - `Plus`

### API / backend handlers

- `backend/api/health.ts`
  Health/CORS surface.
- `backend/api/generate-tex.ts`
  Resume generation pipeline.
- `backend/api/generate-cover-letter.ts`
  Cover letter generation pipeline.
- `backend/api/compile-pdf.ts`
  LaTeX-to-PDF compile pipeline.

### Resume generation pipeline

- Input collected in `frontend/src/App.jsx`
- Request sent by `frontend/src/api.ts -> generateTex(...)`
- Handler: `backend/api/generate-tex.ts`
- Inputs/rules/prompts loaded from:
  - `source_of_truth/rules/*`
  - `source_of_truth/resumes/*`
  - `backend/lib/prompts/system.md`
  - `backend/lib/prompts/user.md`
- Output is optimized resume LaTeX plus metadata
- Optional PDF compile goes through `backend/api/compile-pdf.ts`

### Cover letter generation pipeline

- Input collected in `frontend/src/App.jsx`
- Request sent by `frontend/src/api.ts -> generateCoverLetter(...)`
- Handler: `backend/api/generate-cover-letter.ts`
- Inputs/rules/prompts/templates loaded from:
  - `source_of_truth/rules/*`
  - `source_of_truth/resumes/*`
  - `backend/lib/prompts/cover-letter-system.md`
  - `backend/lib/prompts/cover-letter-user.md`
  - `backend/lib/templates/cover-letter-moderncv.tex`
- Output is cover-letter LaTeX plus metadata
- Optional PDF compile goes through `backend/api/compile-pdf.ts`

### LaTeX / PDF utilities

- Web/serverless path:
  - `backend/api/compile-pdf.ts`
  - local `tectonic` compile first
  - remote LaTeX fallback second
- Shared backend utility helpers:
  - `backend/api/_lib/http.js`
  - `backend/api/_lib/latex.js`
- Local CLI path:
  - `tailor.py --compile-check`
  - local `pdflatex` compile check
  - `rae/latex.py` parsing/rebuild utilities

## v1 vs v2 Structure Decision

### Preserve v1

- v1 remains the existing product and is now referred to as `Manual Studio`.
- Do not remove or replace the current root experience during v2 beta prep.
- v1 remains responsible for:
  - manual job description paste
  - resume tailoring
  - cover letter generation
  - LaTeX review/edit
  - optional PDF preview/compile

### Build v2 in parallel

v2 should be introduced beside v1, not inside the existing `App.jsx` flow.

Recommended conceptual structure:

- `/manual` -> explicit v1 `Manual Studio`
- `/dashboard` -> v2 beta dashboard workflow

Recommended code organization when implementation starts:

- `frontend/src/manual/*` for v1 UI extracted from current `App.jsx`
- `frontend/src/dashboard/*` for v2 beta surfaces
- `frontend/src/routes/*` or equivalent route shell
- Keep current backend handlers stable unless a new v2-only API surface is needed
- Add new v2 APIs under clearly separate handler names instead of mutating v1 endpoints in place

### Route migration rule

- Do not break the current root route.
- When routing is introduced:
  - root can temporarily continue to serve current v1 behavior
  - `/manual` should map to the same v1 workflow
  - `/dashboard` should host v2 beta

## v2 Beta Workflow

Canonical v2 workflow:

`scrape -> score -> approve -> generate -> diff review -> prefill -> final confirm -> track -> email`

Interpretation:

- scrape
  Collect job/application data from supported sources.
- score
  Evaluate fit and recommend a resume mode / application path.
- approve
  Human approval gate before generation or submission.
- generate
  Produce tailored materials.
- diff review
  Show the user exactly what changed.
- prefill
  Prepare application answers/forms where possible.
- final confirm
  Require explicit user confirmation before external submission.
- track
  Record application state and follow-up context.
- email
  Support confirmation or follow-up communication.

## Source Priority

- LinkedIn first
- Greenhouse and Lever next

## Resume Modes

Supported v2 targeting modes:

- IT Support
- IT / Systems / Automation
- Entry SWE / Developer
- Alternate PM

## Safety

- Unsupported questions pause for user input.
- Any ambiguous, high-risk, or unsupported application field should stop automation and request human confirmation.
- v2 must remain human-in-the-loop for approval and final confirmation steps.

## Risks and Coupling Notes

- `frontend/src/App.jsx` currently holds most v1 UI state and workflow logic in one file, so future routing work has a high extraction risk if done carelessly.
- There is no router yet, so route introduction is a structural change that should be staged separately from feature work.
- `source_of_truth/*` is used by both frontend deployment flow and backend generation logic; changing that layout carelessly could break v1 generation.
- There are duplicated `source_of_truth` assets under both repo root and `backend/`, which creates drift risk.
- The Python CLI/RAE path and the web/serverless path overlap conceptually but are not the same implementation, so v2 should choose explicitly whether it depends on one, both, or neither.

## Decision

- Preserve the current app as v1 `Manual Studio`.
- Build v2 beta in parallel behind a separate dashboard surface.
- Avoid feature work in this prep step.
- Prefer documentation and structural separation before any new workflow implementation.
