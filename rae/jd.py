from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Iterable

STOPWORDS = {
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "by",
    "for",
    "from",
    "in",
    "is",
    "it",
    "of",
    "on",
    "or",
    "that",
    "the",
    "to",
    "with",
    "you",
    "your",
    "will",
    "our",
    "we",
    "their",
    "this",
    "have",
    "has",
    "they",
    "them",
    "using",
    "use",
}

TOOL_HINTS = {
    "aws",
    "azure",
    "gcp",
    "docker",
    "kubernetes",
    "terraform",
    "linux",
    "postgresql",
    "mysql",
    "redis",
    "python",
    "java",
    "golang",
    "go",
    "typescript",
    "javascript",
    "react",
    "nextjs",
    "next.js",
    "node",
    "nodejs",
    "sql",
    "graphql",
    "jira",
    "salesforce",
    "zendesk",
    "servicenow",
}

SOFT_SKILL_HINTS = {
    "communication",
    "collaboration",
    "ownership",
    "leadership",
    "mentorship",
    "documentation",
    "stakeholder",
    "escalation",
    "support",
}

SENIORITY_HINTS = {
    "intern": "intern",
    "junior": "junior",
    "mid": "mid",
    "senior": "senior",
    "staff": "staff",
    "principal": "principal",
    "lead": "lead",
    "manager": "manager",
}


@dataclass
class JDAnalysis:
    keywords: list[str]
    hard_skills: list[str]
    soft_skills: list[str]
    tools: list[str]
    responsibilities: list[str]
    seniority: str


WORD_RE = re.compile(r"[A-Za-z0-9.+#/-]+")


def _tokenize(text: str) -> list[str]:
    tokens: list[str] = []
    for match in WORD_RE.finditer(text):
        raw = match.group(0).lower().strip(".,;:()[]")
        if not raw:
            continue
        tokens.append(raw)
        for part in re.split(r"[/\\-]", raw):
            if part and part != raw:
                tokens.append(part)
    return tokens


def _top_terms(tokens: Iterable[str], limit: int = 30) -> list[str]:
    counts: dict[str, int] = {}
    for token in tokens:
        if token in STOPWORDS or len(token) < 3:
            continue
        counts[token] = counts.get(token, 0) + 1
    ranked = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))
    return [term for term, _ in ranked[:limit]]


def analyze_job_description_local(job_description: str) -> JDAnalysis:
    lines = [ln.strip(" -\t") for ln in job_description.splitlines() if ln.strip()]
    tokens = _tokenize(job_description)
    keywords = _top_terms(tokens, limit=40)

    tools = sorted({term for term in keywords if term in TOOL_HINTS})
    soft_skills = sorted({term for term in keywords if term in SOFT_SKILL_HINTS})

    hard_skills = [term for term in keywords if term not in soft_skills][:12]

    responsibilities = [ln for ln in lines if len(ln.split()) >= 5][:10]

    seniority = "unspecified"
    for token in tokens:
        if token in SENIORITY_HINTS:
            seniority = SENIORITY_HINTS[token]
            break

    return JDAnalysis(
        keywords=keywords,
        hard_skills=hard_skills,
        soft_skills=soft_skills,
        tools=tools,
        responsibilities=responsibilities,
        seniority=seniority,
    )
