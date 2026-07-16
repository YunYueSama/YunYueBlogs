from __future__ import annotations

import re
from pathlib import Path

import yaml
from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator

from cms_core.api.gallery import validate_image_url
from cms_core.workspace import CONTENT_ROOT, ensure_workspace

router = APIRouter()


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class MomentPayload(StrictModel):
    id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,100}$")
    date: str = Field(min_length=1, max_length=80)
    content: str = Field(min_length=1, max_length=20_000)
    location: str = Field(default="", max_length=200)
    images: list[str] = Field(default_factory=list, max_length=12)

    @field_validator("images")
    @classmethod
    def valid_images(cls, values: list[str]) -> list[str]:
        return [validate_image_url(value) for value in values]


class DeletePayload(StrictModel):
    id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,100}$")


def ok(data=None):
    return JSONResponse({"ok": True, "data": data})


def moment_path(moment_id: str) -> Path:
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", moment_id):
        raise ValueError("说说 ID 无效。")
    return CONTENT_ROOT / "moments" / f"{moment_id}.md"


def save_moment_file(payload: MomentPayload) -> str:
    ensure_workspace()
    path = moment_path(payload.id)
    frontmatter = {"id": payload.id, "date": payload.date}
    if payload.location:
        frontmatter["location"] = payload.location
    if payload.images:
        frontmatter["images"] = payload.images
    content = f"---\n{yaml.safe_dump(frontmatter, allow_unicode=True, sort_keys=False)}---\n\n{payload.content.strip()}\n"
    temporary = path.with_suffix(".md.tmp")
    temporary.write_text(content, encoding="utf-8")
    temporary.replace(path)
    return path.name


@router.post("/save")
def save_moment(payload: MomentPayload):
    return ok({"file": save_moment_file(payload)})


@router.post("/delete")
def delete_moment(payload: DeletePayload):
    ensure_workspace()
    path = moment_path(payload.id)
    if not path.is_file():
        return JSONResponse({"ok": False, "error": {"code": "moment_not_found", "message": "说说不存在。"}}, status_code=404)
    path.unlink()
    return ok({"id": payload.id})
