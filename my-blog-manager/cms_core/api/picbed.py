from __future__ import annotations

import ipaddress
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, urlencode, urljoin, urlparse, urlunparse
from uuid import uuid4

import httpx
from fastapi import APIRouter, File, Form, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator

from cms_core.workspace import CONFIG_ROOT, DATA_ROOT, ensure_workspace, read_json, write_json_atomic

router = APIRouter()

MAX_IMAGE_BYTES = 12 * 1024 * 1024
MAX_ASSETS = 2_000
MEDIA_FILE = "media.json"


class ImageAsset(BaseModel):
    id: str
    url: str
    thumbnailUrl: str | None = None
    width: int = Field(default=0, ge=0, le=50_000)
    height: int = Field(default=0, ge=0, le=50_000)
    bytes: int = Field(default=0, ge=0, le=MAX_IMAGE_BYTES)
    mimeType: str = Field(default="image/remote", max_length=100)
    alt: str = Field(default="", max_length=300)
    source: str = Field(default="image-host", pattern=r"^(image-host|external|local)$")
    createdAt: str


class ExternalAssetRequest(BaseModel):
    url: str = Field(max_length=4_096)
    thumbnailUrl: str | None = Field(default=None, max_length=4_096)
    width: int = Field(default=0, ge=0, le=50_000)
    height: int = Field(default=0, ge=0, le=50_000)
    alt: str = Field(default="", max_length=300)

    @field_validator("url", "thumbnailUrl")
    @classmethod
    def validate_url(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return validate_public_url(value)


def ok(data: Any = None, status_code: int = 200):
    if isinstance(data, BaseModel):
        data = data.model_dump()
    return JSONResponse({"ok": True, "data": data}, status_code=status_code)


def fail(code: str, message: str, status_code: int = 400):
    return JSONResponse({"ok": False, "error": {"code": code, "message": message}}, status_code=status_code)


def validate_public_url(value: str) -> str:
    cleaned = value.strip()
    parsed = urlparse(cleaned)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("图片地址必须是有效的 HTTP(S) URL")
    if parsed.username or parsed.password:
        raise ValueError("图片地址不能包含认证信息")

    hostname = parsed.hostname.lower().rstrip(".")
    if hostname == "localhost" or hostname.endswith(".localhost"):
        raise ValueError("图片地址不能指向本机服务")
    try:
        address = ipaddress.ip_address(hostname)
        if address.is_private or address.is_loopback or address.is_link_local or address.is_reserved:
            raise ValueError("图片地址不能指向私有网络")
    except ValueError as reason:
        if "不能指向" in str(reason):
            raise
    return cleaned


def image_mime(content: bytes) -> str | None:
    if content.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if content.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if content.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif"
    if len(content) >= 12 and content[:4] == b"RIFF" and content[8:12] == b"WEBP":
        return "image/webp"
    if len(content) >= 12 and content[4:8] == b"ftyp" and content[8:12] in {b"avif", b"avis"}:
        return "image/avif"
    return None


def picbed_config() -> tuple[str, str, str]:
    ensure_workspace()
    integration = read_json(CONFIG_ROOT / "integrations.json", {})
    secrets = read_json(CONFIG_ROOT / "secrets.json", {})
    return (
        str(integration.get("picBedUrl", "")).strip().rstrip("/"),
        str(integration.get("picBedName", "")).strip(),
        str(secrets.get("picBedToken", "")).strip(),
    )


def upload_url(base_url: str) -> str:
    parsed = urlparse(base_url)
    path = parsed.path.rstrip("/")
    if not path.endswith("/upload"):
        path += "/upload"
    # CloudFlare ImgBed 的网页命名设置不会自动用于 API，上传时显式要求原名。
    query = [(key, value) for key, value in parse_qsl(parsed.query, keep_blank_values=True)
             if key != "uploadNameType"]
    query.append(("uploadNameType", "origin"))
    return urlunparse(parsed._replace(path=path, query=urlencode(query)))


async def read_limited(file: UploadFile) -> bytes:
    chunks: list[bytes] = []
    total = 0
    while chunk := await file.read(1024 * 1024):
        total += len(chunk)
        if total > MAX_IMAGE_BYTES:
            raise ValueError("图片不能超过 12MB")
        chunks.append(chunk)
    return b"".join(chunks)


def assets_path() -> Path:
    return DATA_ROOT / MEDIA_FILE


def read_assets() -> list[dict[str, Any]]:
    data = read_json(assets_path(), [])
    if not isinstance(data, list):
        return []
    return [item for item in data if isinstance(item, dict)]


def save_asset(asset: ImageAsset) -> ImageAsset:
    assets = [item for item in read_assets() if item.get("url") != asset.url]
    assets.insert(0, asset.model_dump())
    write_json_atomic(assets_path(), assets[:MAX_ASSETS])
    return asset


def extract_uploaded_url(payload: Any, base_url: str) -> str:
    item = payload[0] if isinstance(payload, list) and payload else payload
    if not isinstance(item, dict):
        raise ValueError("图床返回了无法识别的数据")
    candidate = item.get("src") or item.get("url") or item.get("publicUrl")
    if not isinstance(candidate, str) or not candidate.strip():
        raise ValueError("图床没有返回图片地址")
    absolute = urljoin(f"{base_url}/", candidate.strip())
    return validate_public_url(absolute)


@router.get("/assets")
def list_assets(query: str = "", offset: int = 0, limit: int = 60):
    normalized = query.strip().casefold()
    filtered = read_assets()
    if normalized:
        filtered = [item for item in filtered if normalized in f"{item.get('alt', '')} {item.get('url', '')}".casefold()]
    safe_offset = max(0, offset)
    safe_limit = min(120, max(1, limit))
    return ok({"items": filtered[safe_offset:safe_offset + safe_limit], "total": len(filtered)})


@router.post("/assets")
def register_external_asset(payload: ExternalAssetRequest):
    asset = ImageAsset(
        id=f"asset_{uuid4().hex}",
        url=payload.url,
        thumbnailUrl=payload.thumbnailUrl or payload.url,
        width=payload.width,
        height=payload.height,
        alt=payload.alt.strip(),
        source="external",
        createdAt=datetime.now(timezone.utc).isoformat(),
    )
    return ok(save_asset(asset), 201)


@router.delete("/assets/{asset_id}")
def remove_asset(asset_id: str):
    if not re.fullmatch(r"asset_[a-f0-9]{32}", asset_id):
        return fail("invalid_asset_id", "媒体资源 ID 无效。")
    assets = read_assets()
    remaining = [item for item in assets if item.get("id") != asset_id]
    if len(remaining) == len(assets):
        return fail("asset_not_found", "没有找到该媒体资源。", 404)
    write_json_atomic(assets_path(), remaining)
    return ok({"id": asset_id, "remoteDeleted": False})


@router.post("/test")
async def test_picbed_connection():
    base_url, name, token = picbed_config()
    if not base_url or not token:
        return fail("picbed_not_configured", "请先保存图床 API 地址和 Token。")
    try:
        validate_public_url(base_url)
        timeout = httpx.Timeout(12.0, connect=5.0)
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
            response = await client.post(upload_url(base_url), headers={"Authorization": f"Bearer {token}"})
        if response.status_code in {401, 403}:
            return fail("picbed_unauthorized", "图床 Token 无效或已过期。", 401)
        if response.status_code == 404:
            return fail("picbed_endpoint_missing", "图床上传接口不存在，请检查 API 地址。", 404)
        if response.status_code >= 500:
            return fail("picbed_unavailable", "图床服务暂时不可用。", 502)
        return ok({"name": name or "自定义图床", "status": "ready"})
    except (httpx.ConnectError, httpx.TimeoutException):
        return fail("picbed_unreachable", "无法连接图床服务，请检查网络和 API 地址。", 504)
    except ValueError as reason:
        return fail("picbed_url_invalid", str(reason))


@router.post("/upload")
async def upload_image(
    file: UploadFile = File(...),
    width: int = Form(default=0, ge=0, le=50_000),
    height: int = Form(default=0, ge=0, le=50_000),
    alt: str = Form(default="", max_length=300),
):
    base_url, _, token = picbed_config()
    if not base_url or not token:
        return fail("picbed_not_configured", "图床尚未配置，请先在集成页面保存地址和 Token。")

    try:
        validate_public_url(base_url)
        content = await read_limited(file)
    except ValueError as reason:
        return fail("invalid_upload", str(reason), 413 if "12MB" in str(reason) else 400)
    finally:
        await file.close()

    detected_mime = image_mime(content)
    if not content or not detected_mime:
        return fail("invalid_image", "只支持 PNG、JPEG、GIF、WebP 或 AVIF 图片。", 415)

    # 保留中文和空格，仅移除目录、控制字符及 multipart 文件名中的危险字符。
    filename = (file.filename or "image").replace("\\", "/").rsplit("/", 1)[-1]
    filename = re.sub(r'[\x00-\x1f\x7f"]', "_", filename)
    if filename in {"", ".", ".."}:
        filename = "image"
    try:
        timeout = httpx.Timeout(45.0, connect=8.0)
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
            response = await client.post(
                upload_url(base_url),
                headers={"Authorization": f"Bearer {token}"},
                files={"file": (filename, content, detected_mime)},
            )
        if response.status_code in {401, 403}:
            return fail("picbed_unauthorized", "图床 Token 无效或已过期。", 401)
        if response.status_code >= 500:
            return fail("picbed_unavailable", "图床服务暂时不可用，请稍后重试。", 502)
        if not response.is_success:
            return fail("picbed_rejected", f"图床拒绝上传（HTTP {response.status_code}）。", 502)
        try:
            image_url = extract_uploaded_url(response.json(), base_url)
        except (ValueError, TypeError) as reason:
            return fail("picbed_response_invalid", str(reason), 502)
    except (httpx.ConnectError, httpx.TimeoutException):
        return fail("picbed_unreachable", "上传超时或无法连接图床服务。", 504)

    asset = ImageAsset(
        id=f"asset_{uuid4().hex}",
        url=image_url,
        thumbnailUrl=image_url,
        width=width,
        height=height,
        bytes=len(content),
        mimeType=detected_mime,
        alt=alt.strip(),
        source="image-host",
        createdAt=datetime.now(timezone.utc).isoformat(),
    )
    return ok(save_asset(asset), 201)
