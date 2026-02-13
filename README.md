# Resume Alignment Engine (RAE)

CLI MVP for deterministic, ATS-focused resume tailoring from a LaTeX source-of-truth.

## What It Does

- Input: `resume.tex` + `job_description.txt`
- Output: `tailored_resume.tex`
- Preserves LaTeX template/macros/list structure
- Reorders and trims existing bullets by JD relevance
- Optional conservative bullet reframing with OpenAI (`--rewrite`)
- Never requires pasting API keys into prompts or committed config

## Safety Constraints

- No fabrication by default design: only existing bullets are used
- No new tools/metrics/employers are added
- Output remains LaTeX source so you keep full compile control

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Create `.env.local` in repo root:

```bash
OPENAI_API_KEY="your_key_here"
OPENAI_MODEL="gpt-4.1-mini"
```

`.env` and `.env.local` are git-ignored.

## Usage

```bash
python tailor.py resume.tex job.txt -o tailored_resume.tex
```

Optional flags:

- `--rewrite`: rewrite selected bullets conservatively via OpenAI
- `--aggression balanced|conservative|aggressive`: controls density and ranking intensity
- `--max-bullets N`: global cap override for one-page density heuristics
- `--compile-check`: run `pdflatex` compile validation on the generated output
- `--report-json report.json`: emit JD/alignment report

Example:

```bash
python tailor.py resume.tex job.txt -o tailored_resume.tex --aggression aggressive --rewrite --compile-check --report-json report.json
```

## Notes

- If OpenAI key/client is unavailable, JD analysis falls back to local heuristic extraction.
- OpenAI calls are server/CLI side only.
- `--compile-check` requires `pdflatex` available in `PATH`.

## Tests

```bash
python -m unittest discover -s tests -v
```
