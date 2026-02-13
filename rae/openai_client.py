from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from rae.jd import JDAnalysis


class OpenAIClientError(RuntimeError):
    pass


@dataclass
class OpenAIClient:
    api_key: str
    model: str

    def __post_init__(self) -> None:
        try:
            from openai import OpenAI
        except ImportError as exc:
            raise OpenAIClientError(
                "Missing dependency: openai. Install with `pip install -r requirements.txt`."
            ) from exc

        self._client = OpenAI(api_key=self.api_key)

    @staticmethod
    def _extract_json(text: str) -> dict[str, Any]:
        text = text.strip()
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            pass

        start = text.find("{")
        end = text.rfind("}")
        if start == -1 or end == -1 or end <= start:
            raise OpenAIClientError("Model response did not contain valid JSON.")
        try:
            return json.loads(text[start : end + 1])
        except json.JSONDecodeError as exc:
            raise OpenAIClientError("Model JSON parse failed.") from exc

    def _run_json_prompt(self, system_prompt: str, user_prompt: str) -> dict[str, Any]:
        response = self._client.responses.create(
            model=self.model,
            temperature=0.2,
            input=[
                {
                    "role": "system",
                    "content": [{"type": "input_text", "text": system_prompt}],
                },
                {
                    "role": "user",
                    "content": [{"type": "input_text", "text": user_prompt}],
                },
            ],
        )

        output_text = getattr(response, "output_text", "")
        if not output_text:
            raise OpenAIClientError("Model returned empty output.")
        return self._extract_json(output_text)

    def analyze_job_description(self, job_description: str) -> JDAnalysis:
        system_prompt = (
            "You are a deterministic resume alignment analyzer. "
            "Return strict JSON only. Never include markdown."
        )
        user_prompt = (
            "Analyze this job description and return JSON with keys: "
            "keywords (array of <=40), hard_skills (array), soft_skills (array), "
            "tools (array), responsibilities (array of <=10 concise phrases), "
            "seniority (string).\n\n"
            f"JOB DESCRIPTION:\n{job_description}"
        )

        data = self._run_json_prompt(system_prompt, user_prompt)

        return JDAnalysis(
            keywords=[str(x).strip().lower() for x in data.get("keywords", []) if str(x).strip()],
            hard_skills=[str(x).strip().lower() for x in data.get("hard_skills", []) if str(x).strip()],
            soft_skills=[str(x).strip().lower() for x in data.get("soft_skills", []) if str(x).strip()],
            tools=[str(x).strip().lower() for x in data.get("tools", []) if str(x).strip()],
            responsibilities=[str(x).strip() for x in data.get("responsibilities", []) if str(x).strip()],
            seniority=str(data.get("seniority", "unspecified") or "unspecified").strip().lower(),
        )

    def rewrite_bullets(
        self,
        bullet_contents: list[str],
        job_description: str,
        keywords: list[str],
        aggression: str = "balanced",
    ) -> list[str]:
        if not bullet_contents:
            return []

        aggression_instruction = {
            "conservative": "Make minimal edits and retain original wording whenever possible.",
            "balanced": "Improve ATS wording while keeping sentence structure close to original.",
            "aggressive": "Maximize ATS keyword alignment and impact while preserving factual claims exactly.",
        }.get(aggression, "Improve ATS wording while preserving factual claims exactly.")

        system_prompt = (
            "You rewrite resume bullets conservatively. "
            "Never fabricate tools, systems, or metrics. "
            "Preserve original factual claims. Return strict JSON only."
        )

        user_prompt = (
            "Rewrite each bullet to improve ATS alignment and clarity while preserving truth exactly. "
            "Do not add any new technologies, tools, employers, achievements, or numbers. "
            "Keep each rewrite to one sentence.\n"
            "Return JSON with key rewrites (array) and same item count/order as bullets.\n\n"
            f"AGGRESSION MODE: {aggression}\n"
            f"STYLE GUIDANCE: {aggression_instruction}\n\n"
            f"TARGET KEYWORDS: {', '.join(keywords[:25])}\n\n"
            f"JOB DESCRIPTION:\n{job_description}\n\n"
            f"BULLETS:\n{json.dumps(bullet_contents)}"
        )

        data = self._run_json_prompt(system_prompt, user_prompt)
        rewrites = data.get("rewrites", [])
        if not isinstance(rewrites, list):
            raise OpenAIClientError("Rewrite response missing rewrites array.")

        normalized = [str(x).strip() for x in rewrites]
        if len(normalized) != len(bullet_contents):
            raise OpenAIClientError("Rewrite count mismatch.")

        return normalized
