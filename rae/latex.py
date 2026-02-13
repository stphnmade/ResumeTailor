from __future__ import annotations

import re
from dataclasses import dataclass

SECTION_RE = re.compile(r"^\s*\\section\{([^}]+)\}")
LIST_START_RE = re.compile(r"\\(resumeItemListStart|begin\{itemize\})")
LIST_END_RE = re.compile(r"\\(resumeItemListEnd|end\{itemize\})")


@dataclass
class Bullet:
    id: int
    block_id: int
    section: str
    kind: str
    start_rel: int
    end_rel: int
    raw: str
    content: str


@dataclass
class BulletBlock:
    id: int
    section: str
    start_line: int
    end_line: int
    interior_lines: list[str]
    bullets: list[Bullet]


@dataclass
class ParsedResume:
    lines: list[str]
    blocks: list[BulletBlock]
    bullets: list[Bullet]


def _section_spans(lines: list[str]) -> list[tuple[int, str]]:
    spans: list[tuple[int, str]] = []
    for i, line in enumerate(lines):
        m = SECTION_RE.match(line)
        if m:
            spans.append((i, m.group(1).strip()))
    return spans


def _section_for_line(line_idx: int, spans: list[tuple[int, str]]) -> str:
    current = "Unknown"
    for start_idx, name in spans:
        if start_idx > line_idx:
            break
        current = name
    return current


def _find_matching_brace(text: str, open_idx: int) -> int:
    depth = 0
    for i in range(open_idx, len(text)):
        ch = text[i]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return i
    return -1


def _extract_resume_item_content(raw: str) -> str:
    marker = "\\resumeItem"
    idx = raw.find(marker)
    if idx == -1:
        return raw.strip()
    open_idx = raw.find("{", idx)
    if open_idx == -1:
        return raw.strip()
    close_idx = _find_matching_brace(raw, open_idx)
    if close_idx == -1:
        return raw[open_idx + 1 :].strip()
    return raw[open_idx + 1 : close_idx].strip()


def _extract_item_content(raw: str) -> str:
    marker = "\\item"
    idx = raw.find(marker)
    if idx == -1:
        return raw.strip()
    start = idx + len(marker)
    while start < len(raw) and raw[start].isspace():
        start += 1
    return raw[start:].strip()


def _parse_bullets(block_id: int, section: str, interior_lines: list[str], start_bullet_id: int) -> list[Bullet]:
    bullets: list[Bullet] = []
    i = 0
    next_id = start_bullet_id

    while i < len(interior_lines):
        line = interior_lines[i]
        stripped = line.lstrip()

        if "\\resumeItem{" in line:
            start = i
            raw_lines = [line]
            open_idx = line.find("{", line.find("\\resumeItem"))
            brace_balance = 0
            if open_idx != -1:
                brace_balance = line[open_idx:].count("{") - line[open_idx:].count("}")
            i += 1

            while brace_balance > 0 and i < len(interior_lines):
                nxt = interior_lines[i]
                raw_lines.append(nxt)
                brace_balance += nxt.count("{") - nxt.count("}")
                i += 1

            raw = "".join(raw_lines)
            bullets.append(
                Bullet(
                    id=next_id,
                    block_id=block_id,
                    section=section,
                    kind="resumeItem",
                    start_rel=start,
                    end_rel=i,
                    raw=raw,
                    content=_extract_resume_item_content(raw),
                )
            )
            next_id += 1
            continue

        if stripped.startswith("\\item"):
            start = i
            raw_lines = [line]
            i += 1

            while i < len(interior_lines):
                nxt = interior_lines[i]
                nxt_stripped = nxt.lstrip()
                if "\\resumeItem{" in nxt or nxt_stripped.startswith("\\item"):
                    break
                raw_lines.append(nxt)
                i += 1

            raw = "".join(raw_lines)
            bullets.append(
                Bullet(
                    id=next_id,
                    block_id=block_id,
                    section=section,
                    kind="item",
                    start_rel=start,
                    end_rel=i,
                    raw=raw,
                    content=_extract_item_content(raw),
                )
            )
            next_id += 1
            continue

        i += 1

    return bullets


def parse_resume_latex(text: str) -> ParsedResume:
    lines = text.splitlines(keepends=True)
    spans = _section_spans(lines)

    blocks: list[BulletBlock] = []
    bullets: list[Bullet] = []

    depth = 0
    block_start = -1
    next_block_id = 0
    next_bullet_id = 0

    for i, line in enumerate(lines):
        if LIST_START_RE.search(line):
            if depth == 0:
                block_start = i
            depth += 1

        if LIST_END_RE.search(line) and depth > 0:
            depth -= 1
            if depth == 0 and block_start >= 0:
                section = _section_for_line(block_start, spans)
                interior = lines[block_start + 1 : i]
                block_bullets = _parse_bullets(
                    block_id=next_block_id,
                    section=section,
                    interior_lines=interior,
                    start_bullet_id=next_bullet_id,
                )
                next_bullet_id += len(block_bullets)
                blocks.append(
                    BulletBlock(
                        id=next_block_id,
                        section=section,
                        start_line=block_start,
                        end_line=i,
                        interior_lines=interior,
                        bullets=block_bullets,
                    )
                )
                bullets.extend(block_bullets)
                next_block_id += 1
                block_start = -1

    return ParsedResume(lines=lines, blocks=blocks, bullets=bullets)


LATEX_CMD_RE = re.compile(r"\\[A-Za-z@]+")


def latex_to_plain_text(text: str) -> str:
    cleaned = LATEX_CMD_RE.sub(" ", text)
    cleaned = cleaned.replace("{", " ").replace("}", " ")
    cleaned = cleaned.replace("~", " ")
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned.strip()


def escape_latex_text(text: str) -> str:
    replacements = {
        "\\": r"\\textbackslash{}",
        "&": r"\\&",
        "%": r"\\%",
        "$": r"\\$",
        "#": r"\\#",
        "_": r"\\_",
        "{": r"\\{",
        "}": r"\\}",
        "~": r"\\textasciitilde{}",
        "^": r"\\textasciicircum{}",
    }
    return "".join(replacements.get(ch, ch) for ch in text)


def render_bullet_with_new_content(bullet: Bullet, new_content_plain: str) -> str:
    escaped = escape_latex_text(new_content_plain.strip())
    if bullet.kind == "resumeItem":
        marker = "\\resumeItem"
        idx = bullet.raw.find(marker)
        if idx == -1:
            return bullet.raw
        open_idx = bullet.raw.find("{", idx)
        if open_idx == -1:
            return bullet.raw
        close_idx = _find_matching_brace(bullet.raw, open_idx)
        if close_idx == -1:
            return bullet.raw
        return bullet.raw[: open_idx + 1] + escaped + bullet.raw[close_idx:]

    # Generic \item bullet replacement.
    first_line = bullet.raw.splitlines(keepends=True)[0]
    indent = first_line[: len(first_line) - len(first_line.lstrip())]
    newline = "\n" if bullet.raw.endswith("\n") else ""
    return f"{indent}\\item {escaped}{newline}"


def rebuild_resume(parsed: ParsedResume, block_to_bullets: dict[int, list[Bullet]]) -> str:
    lines = parsed.lines[:]

    for block in parsed.blocks:
        if block.id not in block_to_bullets:
            continue

        ordered_bullets = block_to_bullets[block.id]
        if not ordered_bullets:
            continue

        interior = block.interior_lines
        first = min(b.start_rel for b in block.bullets) if block.bullets else 0
        last = max(b.end_rel for b in block.bullets) if block.bullets else len(interior)

        prefix = interior[:first]
        suffix = interior[last:]

        bullet_lines: list[str] = []
        for bullet in ordered_bullets:
            bullet_lines.extend(bullet.raw.splitlines(keepends=True))

        new_interior = prefix + bullet_lines + suffix

        lines[block.start_line + 1 : block.end_line] = new_interior

    return "".join(lines)
