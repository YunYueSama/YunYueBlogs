from __future__ import annotations

import json
import os
import shutil
from pathlib import Path
from typing import Any


MANAGER_ROOT = Path(__file__).resolve().parent.parent
WORKSPACE_ROOT = MANAGER_ROOT / "workspace"
CONTENT_ROOT = WORKSPACE_ROOT / "content"
DATA_ROOT = WORKSPACE_ROOT / "data"
CONFIG_ROOT = WORKSPACE_ROOT / "config"
PLANS_ROOT = WORKSPACE_ROOT / "plans"
JOBS_ROOT = WORKSPACE_ROOT / "jobs"
DRAFTS_ROOT = WORKSPACE_ROOT / "drafts"


def ensure_workspace() -> Path:
    for directory in (
        CONTENT_ROOT / "posts",
        CONTENT_ROOT / "chatters",
        CONTENT_ROOT / "moments",
        DATA_ROOT,
        CONFIG_ROOT,
        PLANS_ROOT,
        JOBS_ROOT,
        DRAFTS_ROOT,
    ):
        directory.mkdir(parents=True, exist_ok=True)
    return WORKSPACE_ROOT


def import_legacy_content() -> dict[str, Any]:
    """Idempotently imports existing local content without deleting the source."""
    ensure_workspace()
    copied: list[str] = []
    if read_json(CONFIG_ROOT / 'cloud-content.json', {}).get('enabled'):
        return {"copied": [], "counts": workspace_counts()}

    for folder in ("posts", "chatters", "moments"):
        source = MANAGER_ROOT / folder
        destination = CONTENT_ROOT / folder
        if not source.exists():
            continue
        for source_file in source.glob("*.md"):
            target_file = destination / source_file.name
            if not target_file.exists():
                shutil.copy2(source_file, target_file)
                copied.append(str(target_file.relative_to(WORKSPACE_ROOT)))

    legacy_about = MANAGER_ROOT / "app" / "about" / "about.md"
    target_about = CONTENT_ROOT / "about.md"
    if legacy_about.exists() and not target_about.exists():
        shutil.copy2(legacy_about, target_about)
        copied.append(str(target_about.relative_to(WORKSPACE_ROOT)))

    legacy_drafts = MANAGER_ROOT / "manager_data" / "drafts"
    if legacy_drafts.exists():
        for source_file in legacy_drafts.glob("*.json"):
            target_file = DRAFTS_ROOT / source_file.name
            if not target_file.exists():
                shutil.copy2(source_file, target_file)
                copied.append(str(target_file.relative_to(WORKSPACE_ROOT)))

    sibling_data = MANAGER_ROOT.parent / "YunYueBlog" / "src" / "data"
    for name, export_name in (("albums", "albums"), ("friends", "friendsData"), ("projects", "projectsData")):
        target = DATA_ROOT / f"{name}.json"
        current_json = sibling_data / f"{name}.json"
        source = MANAGER_ROOT / "data" / f"{name}.ts"
        if not target.exists() and current_json.exists():
            shutil.copy2(current_json, target)
            copied.append(str(target.relative_to(WORKSPACE_ROOT)))
        elif not target.exists() and source.exists():
            parsed = _extract_typescript_array(source, export_name)
            if parsed is not None:
                target.write_text(json.dumps(parsed, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
                copied.append(str(target.relative_to(WORKSPACE_ROOT)))

    sibling_site = MANAGER_ROOT.parent / "YunYueBlog" / "src" / "data" / "site.json"
    target_site = DATA_ROOT / "site.json"
    if sibling_site.exists() and not target_site.exists():
        shutil.copy2(sibling_site, target_site)
        copied.append(str(target_site.relative_to(WORKSPACE_ROOT)))

    legacy_deploy = MANAGER_ROOT / "data" / "deploy_config.json"
    target_deploy = CONFIG_ROOT / "deploy.json"
    if legacy_deploy.exists() and not target_deploy.exists():
        try:
            legacy = json.loads(legacy_deploy.read_text(encoding="utf-8"))
            target_deploy.write_text(json.dumps({
                "blogPath": legacy.get("blogPath", ""),
                "remote": "origin",
                "branch": legacy.get("sourceBranch", "main"),
            }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            copied.append(str(target_deploy.relative_to(WORKSPACE_ROOT)))
        except (OSError, json.JSONDecodeError):
            pass

    return {"copied": copied, "counts": workspace_counts()}


def workspace_counts() -> dict[str, int]:
    ensure_workspace()
    return {
        name: len(list((CONTENT_ROOT / name).glob("*.md")))
        for name in ("posts", "chatters", "moments")
    }


def read_json(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return default


def write_json_atomic(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def _extract_typescript_array(path: Path, export_name: str) -> list[Any] | None:
    text = path.read_text(encoding="utf-8")
    marker = f"{export_name}"
    marker_index = text.find(marker)
    if marker_index < 0:
        return None
    start = text.find("[", marker_index)
    end = text.rfind("]")
    if start < 0 or end < start:
        return None
    try:
        return json.loads(text[start:end + 1])
    except json.JSONDecodeError:
        return None
