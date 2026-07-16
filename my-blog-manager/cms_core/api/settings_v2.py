from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Literal
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, File, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator, model_validator

from cms_core.api.picbed import validate_public_url
from cms_core.music_library import (
    LyricFileError,
    LyricKind,
    TrackLyricConfig,
    build_asset,
    decode_uploaded_lyric,
    extract_krc_languages,
    load_library,
    save_library,
    summarize_track,
)
from cms_core.music_validation import validate_track
from cms_core.workspace import CONFIG_ROOT, DATA_ROOT, ensure_workspace, read_json, write_json_atomic

router = APIRouter()


class SocialConfig(BaseModel):
    github: str = ""
    email: str = ""


class GiscusConfig(BaseModel):
    repo: str = Field(default="", max_length=200, pattern=r"^$|^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
    repoId: str = Field(default="", max_length=200)
    category: str = Field(default="Announcements", max_length=100)
    categoryId: str = Field(default="", max_length=200)


class IcpConfig(BaseModel):
    name: str = ""
    url: str = ""


class MusicTrackReference(BaseModel):
    key: str = ""
    source: Literal["netease", "kugou"]
    id: str
    name: str = Field(default="", max_length=200)
    artist: str = Field(default="", max_length=200)
    album: str = Field(default="", max_length=200)
    cover: str = Field(default="", max_length=2048)
    albumId: str = Field(default="", max_length=40)
    albumAudioId: str = Field(default="", max_length=40)

    @model_validator(mode="after")
    def validate_reference(self):
        identifier = self.id.strip()
        if self.source == "netease":
            if not identifier.isdigit() or len(identifier) > 20:
                raise ValueError("网易云歌曲 ID 必须是 1 到 20 位数字")
        else:
            identifier = identifier.upper()
            if len(identifier) != 32 or any(character not in "0123456789ABCDEF" for character in identifier):
                raise ValueError("酷狗歌曲 Hash 必须是 32 位十六进制字符串")
            if not self.name.strip():
                raise ValueError("酷狗歌曲必须包含歌曲名称")
        self.id = identifier
        self.key = f"{self.source}:{identifier}"
        return self


class PublicSiteConfig(BaseModel):
    title: str = Field(min_length=1, max_length=100)
    shortTitle: str = Field(min_length=1, max_length=50)
    author: str = Field(min_length=1, max_length=50)
    bio: str = Field(max_length=500)
    description: str = Field(max_length=300)
    avatar: str = ""
    favicon: str = ""
    homeHero: str = "/images/home-hero.webp"
    defaultCover: str = ""
    siteUrl: str = ""
    buildDate: str
    social: SocialConfig
    musicIds: list[str] = Field(default_factory=list, max_length=12)
    musicTracks: list[MusicTrackReference] = Field(default_factory=list, max_length=12)
    danmaku: list[str] = Field(default_factory=list)
    bangumiUsername: str = Field(default="", max_length=100)
    giscus: GiscusConfig
    icp: IcpConfig

    @field_validator("buildDate")
    @classmethod
    def validate_build_date(cls, value: str) -> str:
        cleaned = value.strip()
        try:
            parsed = datetime.fromisoformat(cleaned.replace("Z", "+00:00"))
        except ValueError as error:
            raise ValueError("建站时间必须是 ISO 8601 格式") from error
        if parsed.tzinfo is None:
            raise ValueError("建站时间必须包含时区")
        return cleaned

    @field_validator("musicIds")
    @classmethod
    def validate_music_ids(cls, values: list[str]) -> list[str]:
        cleaned: list[str] = []
        for value in values:
            song_id = value.strip()
            if not song_id.isdigit() or len(song_id) > 20:
                raise ValueError("歌曲 ID 必须是 1 到 20 位数字")
            if song_id not in cleaned:
                cleaned.append(song_id)
        return cleaned


class MusicSettings(BaseModel):
    musicIds: list[str] = Field(default_factory=list, max_length=12)
    musicTracks: list[MusicTrackReference] = Field(default_factory=list, max_length=12)

    @field_validator("musicIds")
    @classmethod
    def validate_music_ids(cls, values: list[str]) -> list[str]:
        return PublicSiteConfig.validate_music_ids(values)

    @model_validator(mode="after")
    def normalize_tracks(self):
        if not self.musicTracks:
            self.musicTracks = [MusicTrackReference(source="netease", id=song_id) for song_id in self.musicIds]
        seen: set[str] = set()
        unique: list[MusicTrackReference] = []
        for track in self.musicTracks:
            if track.key not in seen:
                seen.add(track.key)
                unique.append(track)
        self.musicTracks = unique
        self.musicIds = [track.id for track in unique if track.source == "netease"]
        return self


class LyricOffsetUpdate(BaseModel):
    offsetMs: int = Field(ge=-5_000, le=5_000)


class IntegrationUpdate(BaseModel):
    bangumiUsername: str = Field(default="", max_length=100)
    giscus: GiscusConfig
    picBedUrl: str = Field(default="", max_length=2048)
    picBedName: str = Field(default="", max_length=100)
    picBedToken: str | None = Field(default=None, max_length=4096)
    geminiApiKey: str | None = Field(default=None, max_length=4096)

    @field_validator("picBedUrl")
    @classmethod
    def validate_pic_bed_url(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            return ""
        return validate_public_url(cleaned)


def ok(data=None):
    return JSONResponse({"ok": True, "data": data})


def fail(code: str, message: str, status_code: int = 400):
    return JSONResponse({"ok": False, "error": {"code": code, "message": message}}, status_code=status_code)


@router.get("/public")
def get_public_settings():
    ensure_workspace()
    data = read_json(DATA_ROOT / "site.json", None)
    if data is None:
        return fail("settings_missing", "公开站点配置尚未初始化。", 404)
    try:
        return ok(PublicSiteConfig.model_validate(data).model_dump())
    except ValueError:
        return fail("settings_invalid", "公开站点配置不完整或格式错误。", 422)


@router.post("/public")
def save_public_settings(payload: PublicSiteConfig):
    write_json_atomic(DATA_ROOT / "site.json", payload.model_dump())
    return ok(payload.model_dump())


@router.get("/music")
def get_music_settings():
    ensure_workspace()
    site = read_json(DATA_ROOT / "site.json", None)
    if site is None:
        return fail("settings_missing", "公开站点配置尚未初始化。", 404)
    try:
        payload = MusicSettings(musicIds=site.get("musicIds", []), musicTracks=site.get("musicTracks", []))
    except ValueError:
        return fail("music_settings_invalid", "音乐资源配置格式错误。", 422)
    library = load_library()
    return ok({
        **payload.model_dump(),
        "tracks": {
            reference.key: summarize_track(library.tracks.get(reference.key) or library.tracks.get(reference.id) or TrackLyricConfig())
            for reference in payload.musicTracks
        },
    })


@router.post("/music")
def save_music_settings(payload: MusicSettings):
    ensure_workspace()
    site = read_json(DATA_ROOT / "site.json", None)
    if site is None:
        return fail("settings_missing", "公开站点配置尚未初始化。", 404)
    unavailable: list[str] = []
    try:
        for track in payload.musicTracks:
            validation = validate_track(
                source=track.source,
                track_id=track.id,
                name=track.name,
                artist=track.artist,
            )
            if not validation.get("available"):
                unavailable.append(track.name.strip() or track.id)
    except (httpx.HTTPError, OSError, ValueError, TypeError):
        return fail("music_validation_unavailable", "音源检查服务暂时不可用，未保存播放列表。", 503)
    if unavailable:
        names = "、".join(unavailable[:3])
        suffix = "等歌曲" if len(unavailable) > 3 else ""
        return fail("music_tracks_unavailable", f"{names}{suffix} 当前没有可用音源，请移除或更换版本后再保存。", 422)
    site["musicIds"] = payload.musicIds
    site["musicTracks"] = [track.model_dump() for track in payload.musicTracks]
    write_json_atomic(DATA_ROOT / "site.json", site)
    library = load_library()
    active_keys = {track.key for track in payload.musicTracks}
    migrated: dict[str, TrackLyricConfig] = {}
    for reference in payload.musicTracks:
        configured = library.tracks.get(reference.key) or (library.tracks.get(reference.id) if reference.source == "netease" else None)
        if configured is not None:
            migrated[reference.key] = configured
    library.tracks = {key: track for key, track in migrated.items() if key in active_keys}
    save_library(library)
    return get_music_settings()


def require_playlist_song(song_id: str) -> JSONResponse | None:
    if not (song_id.startswith("netease:") or song_id.startswith("kugou:")):
        song_id = f"netease:{song_id}"
    site = read_json(DATA_ROOT / "site.json", {})
    settings = MusicSettings(musicIds=site.get("musicIds", []), musicTracks=site.get("musicTracks", []))
    if song_id not in {track.key for track in settings.musicTracks}:
        return fail("song_not_in_playlist", "请先保存播放列表，再配置这首歌的歌词。", 409)
    return None


def canonical_track_key(value: str) -> str:
    return value if value.startswith(("netease:", "kugou:")) else f"netease:{value}"


@router.post("/music/{song_id}/offset")
def save_lyric_offset(song_id: str, payload: LyricOffsetUpdate):
    ensure_workspace()
    if error := require_playlist_song(song_id):
        return error
    song_id = canonical_track_key(song_id)
    library = load_library()
    track = library.tracks.get(song_id, TrackLyricConfig())
    track.offsetMs = payload.offsetMs
    library.tracks[song_id] = track
    save_library(library)
    return ok(summarize_track(track))


@router.post("/music/{song_id}/lyrics/{kind}")
async def upload_lyric(song_id: str, kind: LyricKind, file: UploadFile = File(...)):
    ensure_workspace()
    if error := require_playlist_song(song_id):
        return error
    song_id = canonical_track_key(song_id)
    filename = Path(file.filename or "lyrics.lrc").name
    payload = await file.read(512 * 1024 + 1)
    await file.close()
    try:
        lyric_format, content = decode_uploaded_lyric(filename, payload)
        asset = build_asset(filename, lyric_format, content)
    except LyricFileError as error:
        return fail(error.code, error.message, error.status_code)

    library = load_library()
    track = library.tracks.get(song_id, TrackLyricConfig())
    setattr(track, kind, asset)
    if kind == "primary":
        embedded = extract_krc_languages(content) if lyric_format == "krc" else {}
        for language_kind in ("translation", "romanization"):
            current = getattr(track, language_kind)
            if language_kind in embedded:
                if current is None or current.generatedFrom == "primary":
                    generated = build_asset(
                        f"{Path(filename).stem}.{language_kind}.lrc",
                        "lrc",
                        embedded[language_kind],
                        generated_from="primary",
                    )
                    setattr(track, language_kind, generated)
            elif current is not None and current.generatedFrom == "primary":
                setattr(track, language_kind, None)
    library.tracks[song_id] = track
    save_library(library)
    return ok(summarize_track(track))


@router.delete("/music/{song_id}/lyrics/{kind}")
def delete_lyric(song_id: str, kind: LyricKind):
    ensure_workspace()
    if error := require_playlist_song(song_id):
        return error
    song_id = canonical_track_key(song_id)
    library = load_library()
    track = library.tracks.get(song_id)
    if track is None:
        return fail("lyric_not_found", "这首歌没有本地歌词配置。", 404)
    setattr(track, kind, None)
    if kind == "primary":
        if track.translation and track.translation.generatedFrom == "primary":
            track.translation = None
        if track.romanization and track.romanization.generatedFrom == "primary":
            track.romanization = None
    if track.offsetMs == 0 and not any((track.primary, track.translation, track.romanization)):
        library.tracks.pop(song_id, None)
    else:
        library.tracks[song_id] = track
    save_library(library)
    return ok(summarize_track(track))


@router.get("/integrations")
def get_integrations():
    ensure_workspace()
    site = read_json(DATA_ROOT / "site.json", {})
    secrets = read_json(CONFIG_ROOT / "secrets.json", {})
    integration = read_json(CONFIG_ROOT / "integrations.json", {})
    return ok({
        "bangumiUsername": site.get("bangumiUsername", ""),
        "giscus": site.get("giscus", GiscusConfig().model_dump()),
        "picBedUrl": integration.get("picBedUrl", ""),
        "picBedName": integration.get("picBedName", ""),
        "picBedTokenConfigured": bool(secrets.get("picBedToken")),
        "geminiApiKeyConfigured": bool(secrets.get("geminiApiKey")),
    })


@router.post("/integrations")
def save_integrations(payload: IntegrationUpdate):
    ensure_workspace()
    site = read_json(DATA_ROOT / "site.json", {})
    if not site:
        return fail("settings_missing", "公开站点配置尚未初始化。", 404)
    site["bangumiUsername"] = payload.bangumiUsername.strip()
    site["giscus"] = payload.giscus.model_dump()
    write_json_atomic(DATA_ROOT / "site.json", site)
    write_json_atomic(CONFIG_ROOT / "integrations.json", {"picBedUrl": payload.picBedUrl.strip(), "picBedName": payload.picBedName.strip()})

    secrets = read_json(CONFIG_ROOT / "secrets.json", {})
    if payload.picBedToken is not None:
        if payload.picBedToken:
            secrets["picBedToken"] = payload.picBedToken
        else:
            secrets.pop("picBedToken", None)
    if payload.geminiApiKey is not None:
        if payload.geminiApiKey:
            secrets["geminiApiKey"] = payload.geminiApiKey
        else:
            secrets.pop("geminiApiKey", None)
    write_json_atomic(CONFIG_ROOT / "secrets.json", secrets)
    return get_integrations()
