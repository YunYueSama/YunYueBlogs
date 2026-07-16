from __future__ import annotations

import hashlib
import re
import subprocess
import time
import uuid
from pathlib import Path
from urllib.parse import urlparse

from fastapi import APIRouter, BackgroundTasks
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator

from cms_core.api.sync import MANIFEST_NAME, git_changes, managed_destination, validate_blog_path
from cms_core.workspace import CONFIG_ROOT, JOBS_ROOT, ensure_workspace, read_json, write_json_atomic

router = APIRouter()
jobs_router = APIRouter()


class DeployConfig(BaseModel):
    blogPath: str = ""
    remote: str = Field(default="origin", pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
    branch: str = Field(default="main", min_length=1, max_length=240)
    vercelProjectUrl: str = ""

    @field_validator("branch")
    @classmethod
    def validate_branch_name(cls, value: str) -> str:
        return validate_git_branch(value)

    @field_validator("vercelProjectUrl")
    @classmethod
    def validate_vercel_project_url(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            return ""
        parsed = urlparse(cleaned)
        hostname = (parsed.hostname or "").lower()
        if parsed.scheme != "https" or parsed.username or parsed.password or not (
            hostname == "vercel.com" or hostname.endswith(".vercel.app")
        ):
            raise ValueError("Vercel 项目地址必须使用 vercel.com 或 vercel.app 的 HTTPS 地址。")
        return cleaned


class RepositoryRequest(BaseModel):
    blogPath: str = Field(min_length=1)
    remote: str = Field(default="origin", pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
    branch: str = Field(default="main", min_length=1, max_length=240)

    @field_validator("branch")
    @classmethod
    def validate_branch_name(cls, value: str) -> str:
        return validate_git_branch(value)


class PushRequest(BaseModel):
    blogPath: str = Field(min_length=1)
    commitMessage: str = Field(default="内容：通过星辉控制台同步博客", min_length=1, max_length=120)
    remote: str = Field(default="origin", pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
    branch: str = Field(default="main", min_length=1, max_length=240)

    @field_validator("commitMessage")
    @classmethod
    def require_chinese_commit_message(cls, value: str) -> str:
        cleaned = value.strip()
        if not re.search(r"[\u3400-\u9fff]", cleaned):
            raise ValueError("提交信息必须包含中文字符。")
        return cleaned

    @field_validator("branch")
    @classmethod
    def validate_branch_name(cls, value: str) -> str:
        return validate_git_branch(value)


def validate_git_branch(value: str) -> str:
    result = subprocess.run(
        ["git", "check-ref-format", "--branch", value],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    if result.returncode != 0:
        raise ValueError("目标分支名称不符合 Git 引用格式。")
    return value


def ok(data=None, status_code: int = 200):
    return JSONResponse({"ok": True, "data": data}, status_code=status_code)


def fail(code: str, message: str, status_code: int = 400, details=None):
    payload = {"ok": False, "error": {"code": code, "message": message}}
    if details is not None:
        payload["error"]["details"] = details
    return JSONResponse(payload, status_code=status_code)


@router.get("/config")
def get_config():
    ensure_workspace()
    return ok(read_json(CONFIG_ROOT / "deploy.json", DeployConfig().model_dump()))


@router.post("/config")
def save_config(payload: DeployConfig):
    write_json_atomic(CONFIG_ROOT / "deploy.json", payload.model_dump())
    return ok(payload.model_dump())


@router.post("/push")
def push(payload: PushRequest, background_tasks: BackgroundTasks):
    target, error = validate_blog_path(payload.blogPath)
    if error or target is None:
        return fail("invalid_target", error or "目标路径无效。", 400)

    manifest = read_json(target / MANIFEST_NAME, None)
    if not manifest:
        return fail("missing_manifest", "尚未执行安全同步，无法推送。", 409)
    dirty = git_changes(target)
    if dirty == ["<git-status-failed>"]:
        return fail("git_status_failed", "无法读取 Git 状态。", 500)
    if not dirty:
        return fail("nothing_to_commit", "没有需要提交的同步改动。", 409)

    allowed = set(manifest.get("files", [])) | set(manifest.get("deletedFiles", [])) | {MANIFEST_NAME}
    changed_paths = set(dirty)
    unrelated = sorted(path for path in changed_paths if path not in allowed)
    if unrelated:
        return fail("unrelated_changes", "检测到同步清单之外的改动，已停止推送。", 409, unrelated)

    job_id = uuid.uuid4().hex
    job = {"jobId": job_id, "status": "queued", "createdAt": int(time.time()), "message": "等待执行 Git 提交。", "paths": sorted(changed_paths)}
    write_json_atomic(JOBS_ROOT / f"{job_id}.json", job)
    paths = sorted(changed_paths)
    background_tasks.add_task(_run_push, job_id, target, payload, paths, _snapshot(target, paths))
    return ok(job, 202)


@router.post("/repository/status")
def repository_status(payload: RepositoryRequest):
    target, error = validate_blog_path(payload.blogPath)
    if error or target is None:
        return fail("invalid_target", error or "目标路径无效。", 400)
    try:
        return ok(_repository_status(target, payload.remote, payload.branch))
    except RuntimeError as status_error:
        return fail("git_status_failed", str(status_error), 500)


@router.post("/repository/fetch")
def fetch_repository(payload: RepositoryRequest):
    target, error = validate_blog_path(payload.blogPath)
    if error or target is None:
        return fail("invalid_target", error or "目标路径无效。", 400)
    result = _git(target, ["fetch", "--prune", payload.remote])
    if result.returncode != 0:
        return fail("git_fetch_failed", "无法刷新远程状态：" + _git_error(result), 502)
    try:
        return ok(_repository_status(target, payload.remote, payload.branch))
    except RuntimeError as status_error:
        return fail("git_status_failed", str(status_error), 500)


@router.post("/repository/update")
def update_repository(payload: RepositoryRequest):
    target, error = validate_blog_path(payload.blogPath)
    if error or target is None:
        return fail("invalid_target", error or "目标路径无效。", 400)
    dirty = git_changes(target)
    if dirty == ["<git-status-failed>"]:
        return fail("git_status_failed", "无法读取 Git 状态。", 500)
    if dirty:
        return fail("dirty_repository", "目标仓库存在未提交改动，不能更新本地分支。", 409, dirty)

    current_branch = _git(target, ["branch", "--show-current"])
    if current_branch.returncode != 0 or current_branch.stdout.strip() != payload.branch:
        return fail("branch_mismatch", f"当前分支不是 {payload.branch}，已停止更新。", 409)
    fetched = _git(target, ["fetch", "--prune", payload.remote])
    if fetched.returncode != 0:
        return fail("git_fetch_failed", "无法获取远程更新：" + _git_error(fetched), 502)

    remote_ref = f"refs/remotes/{payload.remote}/{payload.branch}"
    if _git(target, ["show-ref", "--verify", "--quiet", remote_ref]).returncode != 0:
        return fail("remote_branch_missing", f"远程分支 {payload.remote}/{payload.branch} 不存在。", 404)
    counts = _ahead_behind(target, remote_ref)
    if counts[0] and counts[1]:
        return fail("diverged_repository", "本地与远程分支已经分叉，请手动检查提交后再处理。", 409, {"ahead": counts[0], "behind": counts[1]})
    if counts[1]:
        merged = _git(target, ["merge", "--ff-only", remote_ref])
        if merged.returncode != 0:
            return fail("fast_forward_failed", "本地分支无法快进更新：" + _git_error(merged), 409)
    try:
        status = _repository_status(target, payload.remote, payload.branch)
    except RuntimeError as status_error:
        return fail("git_status_failed", str(status_error), 500)
    status["message"] = "本地仓库已快进到远程最新版本。" if counts[1] else "本地仓库已经是远程最新版本。"
    return ok(status)


@jobs_router.get("/{job_id}")
def get_job(job_id: str):
    if not job_id.isalnum():
        return fail("invalid_job", "任务编号无效。", 400)
    job = read_json(JOBS_ROOT / f"{job_id}.json", None)
    if not job:
        return fail("job_not_found", "没有找到该发布任务。", 404)
    return ok(job)


def _run_push(job_id: str, target: Path, payload: PushRequest, paths: list[str], snapshot: dict[str, str]) -> None:
    job_path = JOBS_ROOT / f"{job_id}.json"
    try:
        write_json_atomic(job_path, {**read_json(job_path, {}), "status": "running", "message": "正在创建中文提交并推送。"})
        if git_changes(target) != paths or _snapshot(target, paths) != snapshot:
            raise RuntimeError("排队后仓库内容发生变化，请重新执行发布。")
        remote_check = _git(target, ["ls-remote", "--exit-code", payload.remote])
        if remote_check.returncode != 0:
            raise RuntimeError("Git 远程仓库不可访问，请检查网络、权限和 Remote 配置：" + remote_check.stderr.strip())
        add = _git(target, ["add", "--", *paths])
        if add.returncode != 0:
            raise RuntimeError("Git 暂存失败：" + add.stderr.strip())
        commit = _git(target, ["commit", "-m", payload.commitMessage])
        if commit.returncode != 0:
            raise RuntimeError("Git 提交失败：" + commit.stderr.strip())
        push_result = _git(target, ["push", payload.remote, f"HEAD:{payload.branch}"])
        if push_result.returncode != 0:
            raise RuntimeError("Git 推送失败：" + push_result.stderr.strip())
        write_json_atomic(job_path, {**read_json(job_path, {}), "status": "succeeded", "finishedAt": int(time.time()), "message": "已推送 GitHub，Vercel 将自动开始部署。"})
    except Exception as error:
        write_json_atomic(job_path, {**read_json(job_path, {}), "status": "failed", "finishedAt": int(time.time()), "message": str(error)[:1000]})


def _git(target: Path, args: list[str]):
    command = ["git", *args]
    try:
        return subprocess.run(command, cwd=target, capture_output=True, text=True, encoding="utf-8", errors="replace", check=False, timeout=30)
    except subprocess.TimeoutExpired:
        return subprocess.CompletedProcess(command, 124, "", "Git 操作等待超过 30 秒，已安全中止。")


def _git_error(result: subprocess.CompletedProcess[str]) -> str:
    return (result.stderr or result.stdout or "Git 命令执行失败。").strip()[:800]


def _ahead_behind(target: Path, remote_ref: str) -> tuple[int, int]:
    counts = _git(target, ["rev-list", "--left-right", "--count", f"HEAD...{remote_ref}"])
    if counts.returncode != 0:
        raise RuntimeError("无法比较本地与远程提交：" + _git_error(counts))
    try:
        ahead, behind = (int(value) for value in counts.stdout.split())
    except (TypeError, ValueError) as error:
        raise RuntimeError("Git 返回了无法识别的提交差异。") from error
    return ahead, behind


def _repository_status(target: Path, remote: str, branch: str) -> dict:
    current_branch = _git(target, ["branch", "--show-current"])
    if current_branch.returncode != 0:
        raise RuntimeError("无法读取当前分支：" + _git_error(current_branch))
    dirty = git_changes(target)
    if dirty == ["<git-status-failed>"]:
        raise RuntimeError("无法读取 Git 工作区状态。")
    remote_ref = f"refs/remotes/{remote}/{branch}"
    has_remote_branch = _git(target, ["show-ref", "--verify", "--quiet", remote_ref]).returncode == 0
    ahead, behind = _ahead_behind(target, remote_ref) if has_remote_branch else (0, 0)
    return {
        "path": str(target),
        "branch": current_branch.stdout.strip() or "DETACHED",
        "remote": remote,
        "remoteBranch": branch,
        "remoteBranchAvailable": has_remote_branch,
        "dirtyFiles": dirty,
        "ahead": ahead,
        "behind": behind,
        "canUpdate": not dirty and current_branch.stdout.strip() == branch and not (ahead and behind),
    }


def _snapshot(target: Path, paths: list[str]) -> dict[str, str]:
    result: dict[str, str] = {}
    for relative in paths:
        path = managed_destination(target, relative)
        result[relative] = hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else "<missing>"
    return result
