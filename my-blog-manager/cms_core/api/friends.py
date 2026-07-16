from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator

from cms_core.api.picbed import validate_public_url
from cms_core.workspace import DATA_ROOT, ensure_workspace, read_json, write_json_atomic

router = APIRouter()


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Friend(StrictModel):
    id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,100}$")
    name: str = Field(min_length=1, max_length=100)
    url: str = Field(max_length=4_096)
    description: str = Field(default="", max_length=500)
    avatar: str = Field(default="", max_length=4_096)
    themeColor: str = Field(default="#168f91", pattern=r"^#[0-9A-Fa-f]{6}$")

    @field_validator("url")
    @classmethod
    def valid_url(cls, value: str) -> str:
        return validate_public_url(value)

    @field_validator("avatar")
    @classmethod
    def valid_avatar(cls, value: str) -> str:
        if not value:
            return value
        if value.startswith("/images/"):
            return value
        return validate_public_url(value)


class FriendsPayload(StrictModel):
    friends: list[Friend] = Field(default_factory=list, max_length=500)


def ok(data=None):
    return JSONResponse({"ok": True, "data": data})


def save_friends(friends: list[Friend]) -> list[dict]:
    ensure_workspace()
    data = [friend.model_dump() for friend in friends]
    write_json_atomic(DATA_ROOT / "friends.json", data)
    return data


@router.get("")
def get_friends():
    ensure_workspace()
    return ok({"friends": read_json(DATA_ROOT / "friends.json", [])})


@router.post("/sync")
def sync_friends(payload: FriendsPayload):
    data = save_friends(payload.friends)
    return ok({"friends": data, "count": len(data)})
