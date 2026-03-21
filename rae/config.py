from __future__ import annotations

import os
from pathlib import Path


def _parse_env_line(line: str) -> tuple[str, str] | None:
    stripped = line.strip()
    if not stripped or stripped.startswith("#") or "=" not in stripped:
        return None
    key, value = stripped.split("=", 1)
    key = key.strip()
    value = value.strip()

    if value and value[0] == value[-1] and value[0] in {"\"", "'"}:
        value = value[1:-1]
    return key, value


def load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        parsed = _parse_env_line(line)
        if not parsed:
            continue
        key, value = parsed
        os.environ.setdefault(key, value)


def load_runtime_env(repo_root: Path) -> None:
    # .env provides defaults; .env.local overrides for local development.
    load_env_file(repo_root / ".env")
    if (repo_root / ".env.local").exists():
        for line in (repo_root / ".env.local").read_text(encoding="utf-8").splitlines():
            parsed = _parse_env_line(line)
            if parsed:
                key, value = parsed
                os.environ[key] = value


def get_openai_api_key() -> str | None:
    return os.getenv("OPENAI_API_KEY")


def get_openai_model() -> str:
    return os.getenv("OPENAI_MODEL", "gpt-5.2")
