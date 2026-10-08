from __future__ import annotations

import re
import threading
import time
from pathlib import Path
from typing import Annotated, Any, Literal, Union

import yaml
from fastapi import APIRouter
from fastapi.responses import JSONResponse
from markdownify import markdownify
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from cms_core.api.friends import Friend, save_friends
from cms_core.api.gallery import Album, save_gallery
from cms_core.api.moments import MomentPayload, moment_path, save_moment_file
from cms_core.api.projects import Project, save_projects
from cms_core.workspace import CONTENT_ROOT, DATA_ROOT, WORKSPACE_ROOT, ensure_workspace, read_json, write_json_atomic

router = APIRouter()
OPERATION_LOCK = threading.Lock()
OPERATIONS_FILE = WORKSPACE_ROOT / "operations.json"


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class OperationBase(StrictModel):
    cloudRevision: str | None = Field(default=None, pattern=r'^[a-f0-9]{40,64}$')
    id: str = Field(min_length=1, max_length=100, pattern=r"^[A-Za-z0-9_-]+$")
    label: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=1_000)
    timestamp: str = Field(max_length=80)


class ContentPayload(StrictModel):
    id: str | None = Field(default=None, pattern=r"^[A-Za-z0-9_-]{1,100}$")
    type: Literal["post", "chatter", "about"]
    title: str = Field(default="", max_length=200)
    tags: list[str] = Field(default_factory=list, max_length=50)
    cover: str = Field(default="", max_length=4_096)
    mood: str = Field(default="", max_length=100)
    description: str = Field(default="", max_length=500)
    content: str = Field(default="", max_length=2_000_000)
    date: str = Field(default="", max_length=80)
    published: bool = True


class ContentUpsertOperation(OperationBase):
    type: Literal["content_upsert"]
    payload: ContentPayload


class ContentDeletePayload(StrictModel):
    id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,100}$")
    type: Literal["post", "chatter", "about"]


class ContentDeleteOperation(OperationBase):
    type: Literal["content_delete"]
    payload: ContentDeletePayload


class MomentUpsertOperation(OperationBase):
    type: Literal["moment_upsert"]
    payload: MomentPayload


class MomentDeletePayload(StrictModel):
    id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,100}$")


class MomentDeleteOperation(OperationBase):
    type: Literal["moment_delete"]
    payload: MomentDeletePayload


class ProjectsPayload(StrictModel):
    projects: list[Project] = Field(default_factory=list, max_length=500)


class ProjectsUpdateOperation(OperationBase):
    type: Literal["projects_update"]
    payload: ProjectsPayload


class GalleryPayload(StrictModel):
    albums: list[Album] = Field(default_factory=list, max_length=100)


class GalleryUpdateOperation(OperationBase):
    type: Literal["gallery_update"]
    payload: GalleryPayload


class FriendsPayload(StrictModel):
    friends: list[Friend] = Field(default_factory=list, max_length=500)


class FriendsUpdateOperation(OperationBase):
    type: Literal["friends_update"]
    payload: FriendsPayload


class SettingsPayload(StrictModel):
    values: dict[str, str | int | float | bool | list[str] | None]


class SettingsUpdateOperation(OperationBase):
    type: Literal["settings_update"]
    payload: SettingsPayload


Operation = Annotated[
    Union[
        ContentUpsertOperation,
        ContentDeleteOperation,
        MomentUpsertOperation,
        MomentDeleteOperation,
        ProjectsUpdateOperation,
        GalleryUpdateOperation,
        FriendsUpdateOperation,
        SettingsUpdateOperation,
    ],
    Field(discriminator="type"),
]


class OperationList(StrictModel):
    operations: list[Operation] = Field(default_factory=list, max_length=500)


def ok(data=None):
    return JSONResponse({"ok": True, "data": data})


def fail(code: str, message: str, status_code: int = 400, details: Any = None):
    error = {"code": code, "message": message}
    if details is not None:
        error["details"] = details
    return JSONResponse({"ok": False, "error": error}, status_code=status_code)


def content_path(payload: ContentPayload | ContentDeletePayload) -> Path:
    if payload.type == "about":
        return CONTENT_ROOT / "about.md"
    if not payload.id or not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", payload.id):
        raise ValueError("内容 ID 无效。")
    folder = "posts" if payload.type == "post" else "chatters"
    return CONTENT_ROOT / folder / f"{payload.id}.md"


def write_text_atomic(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(content, encoding="utf-8")
    temporary.replace(path)


def save_content(payload: ContentPayload) -> str:
    path = content_path(payload)
    body = payload.content
    if "<" in body and ">" in body:
        body = markdownify(body, heading_style="ATX", strip=["script", "style"]).strip()
    frontmatter = {
        "title": payload.title or ("关于我" if payload.type == "about" else "无标题"),
        "date": payload.date or time.strftime("%Y-%m-%d %H:%M:%S"),
        "tags": payload.tags,
        "description": payload.description,
        "cover": payload.cover,
        "mood": payload.mood,
        "draft": not payload.published,
    }
    if payload.type == "about":
        frontmatter = {"title": frontmatter["title"], "description": payload.description}
    text = f"---\n{yaml.safe_dump(frontmatter, allow_unicode=True, sort_keys=False)}---\n\n{body}\n"
    write_text_atomic(path, text)
    return str(path.relative_to(WORKSPACE_ROOT)).replace("\\", "/")


def resolve_new_content_ids(operations: list[Operation]) -> list[Operation]:
    resolved: list[Operation] = []
    for index, operation in enumerate(operations):
        if isinstance(operation, ContentUpsertOperation) and operation.payload.type != "about" and not operation.payload.id:
            content_id = f"{operation.payload.type}_{int(time.time() * 1000)}_{index}"
            operation = operation.model_copy(update={"payload": operation.payload.model_copy(update={"id": content_id})})
        resolved.append(operation)
    return resolved


def operation_paths(operation: Operation) -> list[Path]:
    if isinstance(operation, (ContentUpsertOperation, ContentDeleteOperation)):
        return [content_path(operation.payload)]
    if isinstance(operation, (MomentUpsertOperation, MomentDeleteOperation)):
        return [moment_path(operation.payload.id)]
    if isinstance(operation, ProjectsUpdateOperation):
        return [DATA_ROOT / "projects.json"]
    if isinstance(operation, GalleryUpdateOperation):
        return [DATA_ROOT / "albums.json"]
    if isinstance(operation, FriendsUpdateOperation):
        return [DATA_ROOT / "friends.json"]
    if isinstance(operation, SettingsUpdateOperation):
        return [DATA_ROOT / "site.json"]
    raise ValueError("不支持的操作类型。")


def apply_operation(operation: Operation) -> list[str]:
    if isinstance(operation, ContentUpsertOperation):
        return [save_content(operation.payload)]
    if isinstance(operation, ContentDeleteOperation):
        path = content_path(operation.payload)
        path.unlink(missing_ok=True)
        return [str(path.relative_to(WORKSPACE_ROOT)).replace("\\", "/")]
    if isinstance(operation, MomentUpsertOperation):
        return [f"content/moments/{save_moment_file(operation.payload)}"]
    if isinstance(operation, MomentDeleteOperation):
        path = moment_path(operation.payload.id)
        path.unlink(missing_ok=True)
        return [str(path.relative_to(WORKSPACE_ROOT)).replace("\\", "/")]
    if isinstance(operation, ProjectsUpdateOperation):
        save_projects(operation.payload.projects)
        return ["data/projects.json"]
    if isinstance(operation, GalleryUpdateOperation):
        save_gallery(operation.payload.albums)
        return ["data/albums.json"]
    if isinstance(operation, FriendsUpdateOperation):
        save_friends(operation.payload.friends)
        return ["data/friends.json"]
    if isinstance(operation, SettingsUpdateOperation):
        site = read_json(DATA_ROOT / "site.json", {})
        forbidden = {"picBedToken", "geminiApiKey", "gitPassword", "clientSecret"}
        if forbidden.intersection(operation.payload.values):
            raise ValueError("公开设置操作不能包含私密凭据。")
        site.update(operation.payload.values)
        write_json_atomic(DATA_ROOT / "site.json", site)
        return ["data/site.json"]
    raise ValueError("不支持的操作类型。")


@router.get("")
def list_operations():
    ensure_workspace()
    raw = read_json(OPERATIONS_FILE, {"operations": []})
    try:
        return ok(OperationList.model_validate(raw).model_dump())
    except ValidationError:
        return fail("operation_queue_invalid", "操作队列格式无效，请清理旧队列后重试。", 422)


@router.put("")
def save_operations(payload: OperationList):
    data = payload.model_dump()
    with OPERATION_LOCK:
        write_json_atomic(OPERATIONS_FILE, data)
    return ok(data)


@router.post("/apply")
def apply_operations():
    ensure_workspace()
    with OPERATION_LOCK:
        raw = read_json(OPERATIONS_FILE, {"operations": []})
        try:
            queue = OperationList.model_validate(raw)
        except ValidationError as error:
            return fail("operation_queue_invalid", "操作队列格式无效。", 422, error.errors(include_input=False))
        if not queue.operations:
            return fail("operation_queue_empty", "操作队列为空。", 409)
        from cms_core import cloud_content
        cloud = cloud_content.status()
        if cloud.get('enabled') and any(item.cloudRevision != cloud.get('revision') for item in queue.operations):
            return fail('stale_operations', '操作队列基于旧版本，请保留输入并刷新服务器内容后重新编辑。', 409)

        operations = resolve_new_content_ids(queue.operations)
        paths = {path for operation in operations for path in operation_paths(operation)}
        backups = {path: path.read_bytes() if path.is_file() else None for path in paths}
        applied: list[dict[str, Any]] = []
        try:
            for operation in operations:
                affected = apply_operation(operation)
                applied.append({"id": operation.id, "type": operation.type, "paths": affected})
            write_json_atomic(OPERATIONS_FILE, {"operations": []})
        except (OSError, ValueError) as error:
            for path, content in backups.items():
                if content is None:
                    path.unlink(missing_ok=True)
                else:
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_bytes(content)
            return fail("operation_apply_failed", "操作应用失败，工作区已回滚。", 500, str(error))
    return ok({"applied": applied, "count": len(applied)})
