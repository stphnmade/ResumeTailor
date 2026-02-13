from __future__ import annotations

import re
from dataclasses import dataclass, replace

from rae.jd import JDAnalysis
from rae.latex import Bullet, ParsedResume, latex_to_plain_text, render_bullet_with_new_content
from rae.openai_client import OpenAIClient, OpenAIClientError

WORD_RE = re.compile(r"[A-Za-z0-9.+#/-]+")


@dataclass(frozen=True)
class AggressionProfile:
    name: str
    max_total_bullets: int
    exp_primary_limit: int
    exp_secondary_limit: int
    project_limit: int
    keyword_weight: float
    hard_weight: float
    soft_weight: float
    tool_weight: float
    metric_weight: float


PROFILES: dict[str, AggressionProfile] = {
    "conservative": AggressionProfile(
        name="conservative",
        max_total_bullets=18,
        exp_primary_limit=5,
        exp_secondary_limit=2,
        project_limit=2,
        keyword_weight=1.5,
        hard_weight=2.0,
        soft_weight=1.0,
        tool_weight=3.6,
        metric_weight=0.4,
    ),
    "balanced": AggressionProfile(
        name="balanced",
        max_total_bullets=22,
        exp_primary_limit=6,
        exp_secondary_limit=3,
        project_limit=3,
        keyword_weight=1.8,
        hard_weight=2.2,
        soft_weight=1.1,
        tool_weight=4.0,
        metric_weight=0.5,
    ),
    "aggressive": AggressionProfile(
        name="aggressive",
        max_total_bullets=26,
        exp_primary_limit=7,
        exp_secondary_limit=4,
        project_limit=4,
        keyword_weight=2.0,
        hard_weight=2.5,
        soft_weight=1.2,
        tool_weight=4.3,
        metric_weight=0.6,
    ),
}


def get_aggression_profile(name: str) -> AggressionProfile:
    return PROFILES.get(name, PROFILES["balanced"])


@dataclass
class AlignmentResult:
    bullet_scores: dict[int, float]
    selected_by_block: dict[int, list[Bullet]]


def _tokenize(text: str) -> set[str]:
    raw_tokens = [m.group(0).lower().strip(".,;:()[]") for m in WORD_RE.finditer(text)]
    normalized: set[str] = set()
    for token in raw_tokens:
        if not token:
            continue
        normalized.add(token)
        for part in re.split(r"[/\\-]", token):
            if part:
                normalized.add(part)
    return normalized


def _section_weight(section_name: str) -> float:
    lowered = section_name.lower()
    if "experience" in lowered:
        return 1.3
    if "project" in lowered:
        return 1.15
    if "skill" in lowered:
        return 0.8
    return 1.0


def _score_bullet(bullet: Bullet, jd: JDAnalysis, profile: AggressionProfile) -> float:
    plain = latex_to_plain_text(bullet.content)
    tokens = _tokenize(plain)

    keyword_hits = len(tokens.intersection(set(jd.keywords[:35])))
    hard_hits = len(tokens.intersection(set(jd.hard_skills)))
    soft_hits = len(tokens.intersection(set(jd.soft_skills)))
    tool_hits = len(tokens.intersection(set(jd.tools)))
    has_metric = 1 if re.search(r"\b\d+(?:\.\d+)?%?\b", plain) else 0

    score = (
        keyword_hits * profile.keyword_weight
        + hard_hits * profile.hard_weight
        + soft_hits * profile.soft_weight
        + tool_hits * profile.tool_weight
        + has_metric * profile.metric_weight
    )

    return score * _section_weight(bullet.section)


def _block_limit(
    section_name: str,
    experience_block_index: int,
    profile: AggressionProfile,
) -> int | None:
    lowered = section_name.lower()
    if "experience" in lowered:
        return profile.exp_primary_limit if experience_block_index == 0 else profile.exp_secondary_limit
    if "project" in lowered:
        return profile.project_limit
    return None


def align_resume(
    parsed: ParsedResume,
    jd: JDAnalysis,
    profile: AggressionProfile,
    max_total_bullets: int | None = None,
) -> AlignmentResult:
    scores = {bullet.id: _score_bullet(bullet, jd, profile) for bullet in parsed.bullets}

    selected_by_block: dict[int, list[Bullet]] = {}
    exp_idx = 0

    for block in parsed.blocks:
        ranked = sorted(
            block.bullets,
            key=lambda b: (-scores.get(b.id, 0.0), b.start_rel),
        )
        limit = _block_limit(block.section, exp_idx, profile)
        if "experience" in block.section.lower():
            exp_idx += 1

        if limit is not None:
            ranked = ranked[:limit]

        selected_by_block[block.id] = ranked

    selected_flat: list[tuple[float, int, int]] = []
    for block_id, bullets in selected_by_block.items():
        for idx, bullet in enumerate(bullets):
            selected_flat.append((scores.get(bullet.id, 0.0), block_id, idx))

    total = len(selected_flat)
    effective_max_total = max_total_bullets if max_total_bullets is not None else profile.max_total_bullets
    if total > effective_max_total:
        candidates: list[tuple[float, int, int]] = []
        for block_id, bullets in selected_by_block.items():
            for bullet in bullets:
                candidates.append((scores.get(bullet.id, 0.0), block_id, bullet.id))
        candidates.sort(key=lambda x: x[0])

        to_remove = total - effective_max_total
        removed_ids: set[int] = set()

        for _, block_id, bullet_id in candidates:
            if to_remove == 0:
                break
            remaining = [b for b in selected_by_block.get(block_id, []) if b.id not in removed_ids]
            if len(remaining) <= 1:
                continue
            removed_ids.add(bullet_id)
            to_remove -= 1

        if removed_ids:
            for block_id, bullets in selected_by_block.items():
                selected_by_block[block_id] = [b for b in bullets if b.id not in removed_ids]

    return AlignmentResult(bullet_scores=scores, selected_by_block=selected_by_block)


def rewrite_selected_bullets(
    selected_by_block: dict[int, list[Bullet]],
    openai_client: OpenAIClient,
    jd: JDAnalysis,
    job_description: str,
    aggression: str,
) -> dict[int, list[Bullet]]:
    rewritten: dict[int, list[Bullet]] = {}

    for block_id, bullets in selected_by_block.items():
        if not bullets:
            rewritten[block_id] = bullets
            continue

        contents = [latex_to_plain_text(b.content) for b in bullets]
        try:
            rewrites = openai_client.rewrite_bullets(
                contents,
                job_description,
                jd.keywords,
                aggression=aggression,
            )
        except OpenAIClientError:
            rewritten[block_id] = bullets
            continue

        updated_block: list[Bullet] = []
        for bullet, new_text in zip(bullets, rewrites):
            updated_raw = render_bullet_with_new_content(bullet, new_text)
            updated_block.append(replace(bullet, raw=updated_raw, content=new_text))
        rewritten[block_id] = updated_block

    return rewritten
