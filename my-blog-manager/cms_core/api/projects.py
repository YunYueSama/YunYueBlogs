from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator

from cms_core.api.picbed import validate_public_url
from cms_core.workspace import DATA_ROOT, ensure_workspace, read_json, write_json_atomic

router = APIRouter()


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Project(StrictModel):
    id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,100}$")
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=1_000)
    icon: str = Field(default="", max_length=100)
    githubUrl: str = Field(max_length=4_096)
    tags: list[str] = Field(default_factory=list, max_length=30)

    @field_validator("githubUrl")
    @classmethod
    def valid_repository_url(cls, value: str) -> str:
        return validate_public_url(value)


class ProjectsPayload(StrictModel):
    projects: list[Project] = Field(default_factory=list, max_length=500)


def ok(data=None):
    return JSONResponse({"ok": True, "data": data})


def save_projects(projects: list[Project]) -> list[dict]:
    ensure_workspace()
    data = [project.model_dump() for project in projects]
    write_json_atomic(DATA_ROOT / "projects.json", data)
    return data


@router.get("")
def get_projects():
    ensure_workspace()
    return ok({"projects": read_json(DATA_ROOT / "projects.json", [])})


@router.post("/sync")
def sync_projects(payload: ProjectsPayload):
    data = save_projects(payload.projects)
    return ok({"projects": data, "count": len(data)})
