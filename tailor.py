#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

from rae.config import get_openai_api_key, get_openai_model, load_runtime_env
from rae.engine import align_resume, get_aggression_profile, rewrite_selected_bullets
from rae.jd import JDAnalysis, analyze_job_description_local
from rae.latex import parse_resume_latex, rebuild_resume
from rae.openai_client import OpenAIClient, OpenAIClientError


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Resume Alignment Engine (CLI MVP)",
    )
    parser.add_argument("resume_tex", type=Path, help="Path to source-of-truth resume.tex")
    parser.add_argument("job_description", type=Path, help="Path to job description text file")
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=Path("tailored_resume.tex"),
        help="Output tailored LaTeX path (default: tailored_resume.tex)",
    )
    parser.add_argument(
        "--rewrite",
        action="store_true",
        help="Use OpenAI to rewrite selected bullets conservatively (no fabrication)",
    )
    parser.add_argument(
        "--max-bullets",
        type=int,
        default=None,
        help="Global max bullets to keep after alignment (overrides aggression default)",
    )
    parser.add_argument(
        "--aggression",
        choices=["conservative", "balanced", "aggressive"],
        default="balanced",
        help="Alignment intensity profile (default: balanced)",
    )
    parser.add_argument(
        "--compile-check",
        action="store_true",
        help="Run pdflatex compile check on output and fail fast if compilation breaks",
    )
    parser.add_argument(
        "--report-json",
        type=Path,
        default=None,
        help="Optional path to write analysis/alignment report JSON",
    )
    return parser


def _run_compile_check(tex_path: Path) -> tuple[bool, str]:
    if shutil.which("pdflatex") is None:
        return False, "pdflatex not found in PATH"

    cmd = [
        "pdflatex",
        "-interaction=nonstopmode",
        "-halt-on-error",
        "-file-line-error",
        tex_path.name,
    ]
    proc = subprocess.run(
        cmd,
        cwd=tex_path.parent,
        capture_output=True,
        text=True,
    )
    if proc.returncode == 0:
        return True, "ok"

    tail = "\n".join((proc.stdout + "\n" + proc.stderr).splitlines()[-25:])
    return False, tail


def _load_openai_client() -> OpenAIClient | None:
    api_key = get_openai_api_key()
    if not api_key:
        return None
    try:
        return OpenAIClient(api_key=api_key, model=get_openai_model())
    except OpenAIClientError:
        return None


def _analyze_jd(job_text: str, client: OpenAIClient | None) -> tuple[JDAnalysis, str]:
    if not client:
        return analyze_job_description_local(job_text), "local"

    try:
        return client.analyze_job_description(job_text), "openai"
    except OpenAIClientError:
        return analyze_job_description_local(job_text), "local"


def main() -> int:
    args = _build_parser().parse_args()

    repo_root = Path.cwd()
    load_runtime_env(repo_root)

    if not args.resume_tex.exists():
        print(f"error: resume file not found: {args.resume_tex}", file=sys.stderr)
        return 1
    if not args.job_description.exists():
        print(f"error: job description file not found: {args.job_description}", file=sys.stderr)
        return 1

    resume_text = args.resume_tex.read_text(encoding="utf-8")
    job_text = args.job_description.read_text(encoding="utf-8")

    parsed = parse_resume_latex(resume_text)
    if not parsed.bullets:
        print("warning: no bullets detected; writing original resume output.", file=sys.stderr)
        args.output.write_text(resume_text, encoding="utf-8")
        return 0

    client = _load_openai_client()
    jd_analysis, analyzer = _analyze_jd(job_text, client)
    profile = get_aggression_profile(args.aggression)

    aligned = align_resume(
        parsed,
        jd_analysis,
        profile=profile,
        max_total_bullets=args.max_bullets,
    )
    selected = aligned.selected_by_block

    if args.rewrite and client:
        selected = rewrite_selected_bullets(
            selected,
            client,
            jd_analysis,
            job_text,
            aggression=args.aggression,
        )

    tailored_text = rebuild_resume(parsed, selected)
    args.output.write_text(tailored_text, encoding="utf-8")

    compile_checked = False
    compile_passed = None
    compile_details = None
    if args.compile_check:
        compile_checked = True
        compile_passed, compile_details = _run_compile_check(args.output)
        if not compile_passed:
            print(f"error: compile check failed for {args.output}", file=sys.stderr)
            print(compile_details, file=sys.stderr)
            return 2

    if args.report_json:
        report = {
            "analyzer": analyzer,
            "aggression": args.aggression,
            "jd": {
                "keywords": jd_analysis.keywords,
                "hard_skills": jd_analysis.hard_skills,
                "soft_skills": jd_analysis.soft_skills,
                "tools": jd_analysis.tools,
                "responsibilities": jd_analysis.responsibilities,
                "seniority": jd_analysis.seniority,
            },
            "alignment": {
                "total_detected_bullets": len(parsed.bullets),
                "selected_bullets": [
                    {
                        "block_id": block_id,
                        "bullet_id": bullet.id,
                        "section": bullet.section,
                        "score": aligned.bullet_scores.get(bullet.id, 0.0),
                        "content": bullet.content,
                    }
                    for block_id, bullets in selected.items()
                    for bullet in bullets
                ],
            },
            "constraints": {
                "fabrication": "disabled-by-design",
                "source_of_truth": str(args.resume_tex),
                "rewrite_enabled": bool(args.rewrite and client),
            },
            "compile_check": {
                "requested": compile_checked,
                "passed": compile_passed,
                "details": compile_details,
            },
        }
        args.report_json.write_text(json.dumps(report, indent=2), encoding="utf-8")

    print(f"tailored resume written: {args.output}")
    print(f"job analysis source: {analyzer}")
    print(f"aggression: {args.aggression}")
    print(f"detected bullets: {len(parsed.bullets)}")
    print(f"selected bullets: {sum(len(v) for v in selected.values())}")
    if args.compile_check:
        print("compile check: passed")

    if args.rewrite and not client:
        print("note: --rewrite requested but OpenAI client unavailable; kept original bullet text.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
