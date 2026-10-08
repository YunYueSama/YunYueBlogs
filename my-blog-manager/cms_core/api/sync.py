from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import tempfile
import threading
import time
import uuid
from pathlib import Path
from typing import Literal

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from cms_core.workspace import CONTENT_ROOT, DATA_ROOT, PLANS_ROOT, ensure_workspace, import_legacy_content, read_json, write_json_atomic
from cms_core import cloud_content

router = APIRouter()
MANIFEST_NAME = ".yunyue-managed.json"
SYNC_LOCK = threading.Lock()


class SyncRequest(BaseModel):
    blogPath: str = Field(min_length=1)


class ApplyRequest(BaseModel):
    blogPath: str = Field(min_length=1)
    planId: str = Field(pattern=r"^[a-f0-9]{32}$")


def ok(data=None, status_code: int = 200):
    return JSONResponse({"ok": True, "data": data}, status_code=status_code)


def fail(code: str, message: str, status_code: int = 400, details=None):
    payload = {"ok": False, "error": {"code": code, "message": message}}
    if details is not None:
        payload["error"]["details"] = details
    return JSONResponse(payload, status_code=status_code)


def validate_blog_path(raw_path: str) -> tuple[Path | None, str | None]:
    try:
        target = Path(raw_path).expanduser().resolve(strict=True)
    except (OSError, RuntimeError):
        return None, "目标路径不存在或无法解析。"
    if not target.is_dir() or not (target / ".git").is_dir():
        return None, "目标必须是包含 .git 的博客仓库根目录。"
    package = read_json(target / "package.json", {})
    marker = read_json(target / ".yunyue-blog.json", {})
    if package.get("name") != "yunyue-blog" and marker.get("schemaVersion") != 2:
        return None, "目标缺少 YunYueBlog v2 项目标识。"
    return target, None


def git_changes(target: Path) -> list[str]:
    paths: set[str] = set()
    commands = (
        ["diff", "--name-only", "-z"],
        ["diff", "--cached", "--name-only", "-z"],
        ["ls-files", "--others", "--exclude-standard", "-z"],
    )
    for arguments in commands:
        result = subprocess.run(
            ["git", "-c", "core.quotepath=false", *arguments],
            cwd=target,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
        )
        if result.returncode != 0:
            return ["<git-status-failed>"]
        paths.update(path.replace("\\", "/") for path in result.stdout.split("\0") if path)
    return sorted(paths)


def managed_destination(target: Path, relative: str) -> Path:
    relative_path = Path(relative)
    if relative_path.is_absolute() or ".." in relative_path.parts:
        raise ValueError(f"非法受管路径：{relative}")
    destination = (target / relative_path).resolve()
    if target not in destination.parents:
        raise ValueError(f"受管路径超出目标仓库：{relative}")
    return destination


def source_files() -> dict[str, Path]:
    ensure_workspace()
    files: dict[str, Path] = {}
    for folder in ("posts", "chatters", "moments"):
        for source in sorted((CONTENT_ROOT / folder).glob("*.md")):
            files[f"{folder}/{source.name}"] = source
    about = CONTENT_ROOT / "about.md"
    if about.exists():
        files["content/about.md"] = about
    for name in ("albums", "friends", "music", "projects", "site"):
        source = DATA_ROOT / f"{name}.json"
        if source.exists():
            files[f"src/data/{name}.json"] = source
    return files


def digest_files(files: dict[str, Path]) -> str:
    digest = hashlib.sha256()
    for relative, source in sorted(files.items()):
        digest.update(relative.encode("utf-8"))
        digest.update(hashlib.sha256(source.read_bytes()).digest())
    return digest.hexdigest()


def file_digest(path: Path) -> str:
    # Git 在 Windows 检出时可能转换换行；内容预览忽略这一差异，防止把服务器原文误报为更新。
    return hashlib.sha256(path.read_bytes().replace(b'\r\n', b'\n')).hexdigest()


@router.post("/migrate")
def migrate_workspace():
    return ok(import_legacy_content())


@router.post("/plan")
def create_sync_plan(payload: SyncRequest):
    import_legacy_content()
    target, error = validate_blog_path(payload.blogPath)
    if error or target is None:
        return fail("invalid_target", error or "目标路径无效。", 400)

    dirty = git_changes(target)
    files = source_files()
    if not files:
        return fail("empty_workspace", "本地工作区没有可同步内容。", 409)

    previous_manifest = read_json(target / MANIFEST_NAME, {"files": []})
    previous_files = set(previous_manifest.get("files", []))
    current_files = set(files)
    changes = []
    for relative, source in sorted(files.items()):
        destination = managed_destination(target, relative)
        kind: Literal["add", "update", "unchanged"]
        if not destination.exists():
            kind = "add"
        elif file_digest(source) != file_digest(destination):
            kind = "update"
        else:
            kind = "unchanged"
        changes.append({"kind": kind, "path": relative})
    for stale in sorted(previous_files - current_files):
        changes.append({"kind": "delete", "path": stale})

    plan_id = uuid.uuid4().hex
    plan = {
        "remoteRevision": cloud_content.status().get('revision'),
        "planId": plan_id,
        "createdAt": int(time.time()),
        "target": str(target),
        "sourceDigest": digest_files(files),
        "files": sorted(files),
        "changes": changes,
        "warnings": ["目标仓库存在未提交改动，应用计划已锁定。"] if dirty else [],
        "dirtyFiles": dirty,
        "canApply": not dirty,
    }
    write_json_atomic(PLANS_ROOT / f"{plan_id}.json", plan)
    return ok(plan)


@router.post("/apply")
def apply_sync_plan(payload: ApplyRequest):
    target, error = validate_blog_path(payload.blogPath)
    if error or target is None:
        return fail("invalid_target", error or "目标路径无效。", 400)
    plan = read_json(PLANS_ROOT / f"{payload.planId}.json", None)
    if not plan or plan.get("target") != str(target):
        return fail("plan_not_found", "同步计划不存在或不属于当前仓库。", 404)
    if not plan.get("canApply"):
        return fail("dirty_repository", "目标仓库在生成计划时存在未提交改动。", 409, plan.get("dirtyFiles", []))
    from cms_core import cloud_content
    if plan.get('remoteRevision') and plan['remoteRevision'] != cloud_content.status().get('revision'):
        return fail('remote_changed', '服务器内容已更新，请重新生成发布预览。', 409)
    with SYNC_LOCK:
        if git_changes(target):
            return fail("repository_changed", "生成计划后目标仓库状态发生变化，请重新预览。", 409)

        files = source_files()
        if digest_files(files) != plan.get("sourceDigest"):
            return fail("stale_plan", "本地内容在预览后发生变化，请重新生成同步计划。", 409)

        previous_manifest = read_json(target / MANIFEST_NAME, {"files": []})
        stale_files = set(previous_manifest.get("files", [])) - set(files)
        manifest_path = target / MANIFEST_NAME
        previous_manifest_bytes = manifest_path.read_bytes() if manifest_path.is_file() else None

        try:
            with tempfile.TemporaryDirectory(prefix=".yunyue-sync-", dir=target) as temporary_root:
                temporary = Path(temporary_root)
                staged_root = temporary / "staged"
                backup_root = temporary / "backup"
                backed_up: set[str] = set()

                # 只暂存和备份实际变化文件，大型相册和文章库不重复复制全部内容。
                changed_files = {relative: source for relative, source in files.items()
                                 if not managed_destination(target, relative).is_file()
                                 or file_digest(source) != file_digest(managed_destination(target, relative))}
                for relative, source in changed_files.items():
                    staged = staged_root / Path(relative)
                    staged.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(source, staged)

                for relative in set(changed_files) | stale_files:
                    destination = managed_destination(target, relative)
                    if destination.exists() and not destination.is_file():
                        raise ValueError(f"受管目标不是普通文件：{relative}")
                    if destination.is_file():
                        backup = backup_root / Path(relative)
                        backup.parent.mkdir(parents=True, exist_ok=True)
                        shutil.copy2(destination, backup)
                        backed_up.add(relative)

                try:
                    for relative in changed_files:
                        destination = managed_destination(target, relative)
                        # 未变化文件保留 Git 的检出格式，避免只因换行与时间戳显示脏工作区。
                        if destination.is_file() and file_digest(files[relative]) == file_digest(destination):
                            continue
                        destination.parent.mkdir(parents=True, exist_ok=True)
                        os.replace(staged_root / Path(relative), destination)
                    for relative in stale_files:
                        stale = managed_destination(target, relative)
                        if stale.is_file():
                            stale.unlink()

                    manifest = {
                        "remoteRevision": plan.get('remoteRevision'),
                        "schemaVersion": 2,
                        "generatedAt": int(time.time()),
                        "files": sorted(files),
                        "deletedFiles": sorted(stale_files),
                    }
                    write_json_atomic(manifest_path, manifest)
                except Exception:
                    for relative in set(changed_files) | stale_files:
                        destination = managed_destination(target, relative)
                        if destination.is_file():
                            destination.unlink()
                        if relative in backed_up:
                            backup = backup_root / Path(relative)
                            destination.parent.mkdir(parents=True, exist_ok=True)
                            shutil.copy2(backup, destination)
                    if previous_manifest_bytes is None:
                        manifest_path.unlink(missing_ok=True)
                    else:
                        manifest_path.write_bytes(previous_manifest_bytes)
                    raise
        except (OSError, ValueError) as error:
            return fail("sync_failed", "同步未完成，目标仓库已回滚。", 500, str(error))

    return ok({"planId": payload.planId, "applied": [change for change in plan["changes"] if change["kind"] != "unchanged"], "manifest": MANIFEST_NAME})


@router.post("/check")
def check_compat(payload: SyncRequest):
    target, error = validate_blog_path(payload.blogPath)
    if error or target is None:
        return fail("invalid_target", error or "目标路径无效。", 400)
    return ok({"path": str(target), "dirtyFiles": git_changes(target)})


@router.post("/execute")
def reject_unsafe_compat():
    return fail("deprecated_endpoint", "直接覆盖同步已停用，请先调用 /api/sync/plan，再调用 /api/sync/apply。", 410)
