from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator

from cms_core.api.picbed import validate_public_url
from cms_core.workspace import DATA_ROOT, ensure_workspace, read_json, write_json_atomic

router = APIRouter()


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


def validate_image_url(value: str) -> str:
    cleaned = value.strip()
    if cleaned.startswith("/images/"):
        return cleaned
    return validate_public_url(cleaned)


class Photo(StrictModel):
    url: str = Field(max_length=4_096)
    caption: str = Field(default="", max_length=500)

    @field_validator("url")
    @classmethod
    def valid_url(cls, value: str) -> str:
        return validate_image_url(value)


class Album(StrictModel):
    id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,100}$")
    title: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=500)
    cover: str = Field(max_length=4_096)
    date: str = Field(default="", max_length=40)
    photos: list[Photo] = Field(default_factory=list, max_length=500)

    @field_validator("cover")
    @classmethod
    def valid_cover(cls, value: str) -> str:
        return validate_image_url(value)


class GalleryPayload(StrictModel):
    albums: list[Album] = Field(default_factory=list, max_length=100)


def ok(data=None):
    return JSONResponse({"ok": True, "data": data})


def save_gallery(albums: list[Album]) -> list[dict]:
    ensure_workspace()
    data = [album.model_dump() for album in albums]
    write_json_atomic(DATA_ROOT / "albums.json", data)
    return data


@router.get("")
def get_gallery():
    ensure_workspace()
    return ok({"albums": read_json(DATA_ROOT / "albums.json", [])})


@router.post("/sync")
def sync_gallery(payload: GalleryPayload):
    data = save_gallery(payload.albums)
    return ok({"albums": data, "count": len(data)})
