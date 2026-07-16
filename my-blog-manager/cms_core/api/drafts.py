from __future__ import annotations

import html
import re
import time
from pathlib import Path
from typing import Any, Literal

import markdown
import yaml
from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from cms_core.workspace import CONTENT_ROOT, WORKSPACE_ROOT, ensure_workspace, read_json, write_json_atomic

router = APIRouter()
DRAFTS_ROOT = WORKSPACE_ROOT / "drafts"
SAFE_ID = re.compile(r"^[A-Za-z0-9_-]{1,100}$")


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class DraftPayload(StrictModel):
    id: str | None = Field(default=None, max_length=100)
    type: Literal["post", "chatter", "about"] = "post"
    title: str = Field(default="", max_length=200)
    description: str = Field(default="", max_length=500)
    content: str = Field(default="", max_length=2_000_000)
    cover: str = Field(default="", max_length=4_096)
    tags: list[str] = Field(default_factory=list, max_length=50)
    mood: str = Field(default="", max_length=100)
    date: str = Field(default="", max_length=80)
    published: bool = False


class DraftLookup(StrictModel):
    id: str = Field(min_length=1, max_length=100)
    type: Literal["post", "chatter", "about"] = "post"


def ok(data: Any = None, status_code: int = 200) -> JSONResponse:
    return JSONResponse({"ok": True, "data": data}, status_code=status_code)


def fail(code: str, message: str, status_code: int = 400) -> JSONResponse:
    return JSONResponse({"ok": False, "error": {"code": code, "message": message}}, status_code=status_code)


def normalize_id(raw_id: str | None, document_type: str) -> str:
    if document_type == "about":
        return "about"
    candidate = (raw_id or "").removesuffix(".md").removesuffix(".json")
    if not candidate or candidate == "new":
        return f"draft_{int(time.time() * 1000)}"
    if not SAFE_ID.fullmatch(candidate):
        raise ValueError("草稿 ID 无效。")
    return candidate


def draft_path(draft_id: str) -> Path:
    if not SAFE_ID.fullmatch(draft_id):
        raise ValueError("草稿 ID 无效。")
    return DRAFTS_ROOT / f"{draft_id}.json"


def published_path(draft_id: str, document_type: str) -> Path:
    if document_type == "about":
        return CONTENT_ROOT / "about.md"
    folder = "posts" if document_type == "post" else "chatters"
    return CONTENT_ROOT / folder / f"{draft_id}.md"


def draft_preview(value: str) -> str:
    plain = html.unescape(re.sub(r"<[^>]+>", " ", value))
    return re.sub(r"\s+", " ", plain).strip()[:160]


def parse_published(path: Path, draft_id: str, document_type: str) -> dict[str, Any]:
    source = path.read_text(encoding="utf-8")
    metadata: dict[str, Any] = {}
    body = source
    if source.startswith("---"):
        parts = source.split("---", 2)
        if len(parts) == 3:
            metadata = yaml.safe_load(parts[1]) or {}
            body = parts[2].strip()
    tags = metadata.get("tags", [])
    if not isinstance(tags, list):
        tags = [tags] if tags else []
    return {
        "id": draft_id,
        "type": document_type,
        "title": str(metadata.get("title") or ("关于我" if document_type == "about" else "")),
        "description": str(metadata.get("description") or ""),
        "content": markdown.markdown(body, extensions=["fenced_code", "tables", "nl2br"]),
        "cover": str(metadata.get("cover") or ""),
        "tags": [str(tag) for tag in tags],
        "mood": str(metadata.get("mood") or ""),
        "date": str(metadata.get("date") or ""),
        "published": True,
    }


@router.post("/save")
def save_draft(payload: DraftPayload):
    ensure_workspace()
    try:
        draft_id = normalize_id(payload.id, payload.type)
        data = payload.model_dump(exclude={"published"})
        data.update({"id": draft_id, "lastModified": int(time.time() * 1000)})
        write_json_atomic(draft_path(draft_id), data)
    except (OSError, ValueError) as error:
        return fail("draft_save_failed", str(error), 400)
    return ok({"id": draft_id, "lastModified": data["lastModified"]}, 201)


def collect_drafts() -> list[dict[str, Any]]:
    ensure_workspace()
    drafts: list[dict[str, Any]] = []
    for path in DRAFTS_ROOT.glob("*.json"):
        data = read_json(path, None)
        if not isinstance(data, dict):
            continue
        content = str(data.pop("content", ""))
        data["contentPreview"] = draft_preview(content)
        drafts.append(data)
    return sorted(drafts, key=lambda item: int(item.get("lastModified", 0)), reverse=True)


@router.get("")
def list_drafts():
    return ok({"drafts": collect_drafts()})


@router.post("/list")
def list_drafts_compat():
    return list_drafts()


@router.post("/get")
def get_draft(payload: DraftLookup):
    ensure_workspace()
    try:
        draft_id = normalize_id(payload.id, payload.type)
        local_draft = draft_path(draft_id)
        if local_draft.is_file():
            return ok({"draft": read_json(local_draft, {})})
        source = published_path(draft_id, payload.type)
        if source.is_file():
            return ok({"draft": parse_published(source, draft_id, payload.type)})
    except (OSError, ValueError, yaml.YAMLError) as error:
        return fail("draft_read_failed", str(error), 400)
    return fail("draft_not_found", "未找到草稿或对应内容文件。", 404)


def remove_draft(draft_id: str):
    ensure_workspace()
    try:
        path = draft_path(normalize_id(draft_id, "post"))
        if not path.is_file():
            return fail("draft_not_found", "未找到草稿。", 404)
        path.unlink()
    except (OSError, ValueError) as error:
        return fail("draft_delete_failed", str(error), 400)
    return ok({"id": draft_id})


@router.delete("/{draft_id}")
def delete_draft(draft_id: str):
    return remove_draft(draft_id)


@router.post("/delete")
def delete_draft_compat(payload: DraftLookup):
    return remove_draft(payload.id)


@router.get("/all_tags")
def get_all_historical_tags():
    result: dict[str, set[str]] = {"post": set(), "chatter": set()}
    for document_type, folder in (("post", "posts"), ("chatter", "chatters")):
        directory = CONTENT_ROOT / folder
        if not directory.exists():
            continue
        for path in directory.glob("*.md"):
            try:
                source = path.read_text(encoding="utf-8")
                if not source.startswith("---"):
                    continue
                metadata = yaml.safe_load(source.split("---", 2)[1]) or {}
                tags = metadata.get("tags", [])
                if not isinstance(tags, list):
                    tags = [tags] if tags else []
                result[document_type].update(str(tag) for tag in tags if str(tag).strip())
            except (OSError, yaml.YAMLError):
                continue
    return ok({"postTags": sorted(result["post"]), "chatterTags": sorted(result["chatter"])})
