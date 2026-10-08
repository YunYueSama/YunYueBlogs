from __future__ import annotations

import time
from typing import Annotated, Literal

import httpx
from fastapi import APIRouter, Path, Query
from fastapi.responses import JSONResponse

from cms_core import kugou, music_accounts
from cms_core.music_validation import validate_track

router = APIRouter()
MUSIC_HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; YunYueBlogs-Manager/2.0; +https://majo-elaina.top)",
    "Referer": "https://music.163.com/",
}
MUSIC_CACHE: dict[str, tuple[float, dict]] = {}


def ok(data=None):
    return JSONResponse({"ok": True, "data": data})


def fail(code: str, message: str, status_code: int):
    return JSONResponse({"ok": False, "error": {"code": code, "message": message}}, status_code=status_code)


@router.get("/query/{song_id}")
def query_netease_music(song_id: Annotated[str, Path(pattern=r"^\d{1,20}$")]):
    cached = MUSIC_CACHE.get(song_id)
    if cached and cached[0] > time.monotonic():
        return ok(cached[1])
    try:
        api_url = f"https://music.163.com/api/song/detail/?id={song_id}&ids=[{song_id}]"
        response = httpx.get(api_url, headers=MUSIC_HEADERS, timeout=6, follow_redirects=False)
        response.raise_for_status()
        data = response.json()
        song = data.get("songs", [None])[0] if isinstance(data.get("songs"), list) and data.get("songs") else None
        if not isinstance(song, dict):
            return fail("music_not_found", "未找到该歌曲，可能是 ID 无效或歌曲不可用。", 404)
        artists = song.get("artists") if isinstance(song.get("artists"), list) else []
        album = song.get("album") if isinstance(song.get("album"), dict) else {}
        result = {
            "id": song_id,
            "name": str(song.get("name") or "未命名歌曲")[:200],
            "artist": str(artists[0].get("name") if artists and isinstance(artists[0], dict) else "未知歌手")[:200],
            "album": str(album.get("name") or "")[:200],
            "cover": str(album.get("picUrl") or "")[:2048],
            "durationMs": max(0, int(song.get("duration") or 0)),
        }
        if len(MUSIC_CACHE) >= 128:
            MUSIC_CACHE.clear()
        MUSIC_CACHE[song_id] = (time.monotonic() + 3600, result)
        return ok(result)
    except (httpx.HTTPError, ValueError, TypeError):
        return fail("music_upstream_unavailable", "网易云音乐服务暂时不可用，请稍后重试。", 502)


@router.get("/search/kugou")
def search_kugou_music(keyword: Annotated[str, Query(min_length=1, max_length=100)]):
    try:
        return ok(kugou.search_songs(keyword))
    except (httpx.HTTPError, ValueError, TypeError):
        return fail("kugou_search_unavailable", "酷狗音乐搜索暂时不可用，请稍后重试。", 502)


@router.get("/lyrics/status")
def query_lyric_status(
    name: Annotated[str, Query(min_length=1, max_length=200)],
    artist: Annotated[str, Query(max_length=200)] = "",
    song_hash: Annotated[str, Query(alias="hash", pattern=r"^$|^[A-Fa-f0-9]{32}$")] = "",
    album_audio_id: Annotated[str, Query(alias="albumAudioId", max_length=40)] = "",
    duration_ms: Annotated[int, Query(alias="durationMs", ge=0, le=3_600_000)] = 0,
):
    try:
        result = kugou.fetch_lyrics(
            song_hash=song_hash,
            album_audio_id=album_audio_id,
            name=name,
            artist=artist,
            duration_ms=duration_ms,
        )
        return ok(kugou.lyric_summary(result))
    except (httpx.HTTPError, ValueError, TypeError):
        return fail("kugou_lyric_unavailable", "酷狗逐字歌词服务暂时不可用，公开站会回退到网易云歌词。", 502)


@router.get("/kugou/{song_hash}/status")
def query_kugou_status(song_hash: Annotated[str, Path(pattern=r"^[A-Fa-f0-9]{32}$")]):
    try:
        return ok(validate_track(source="kugou", track_id=song_hash))
    except (httpx.HTTPError, ValueError, TypeError):
        return fail("kugou_playback_unavailable", "酷狗音频资源暂时不可用，请稍后重试。", 502)


@router.get("/playback/{source}/{track_id}/status")
def query_playback_status(
    source: Annotated[Literal["netease", "kugou"], Path()],
    track_id: Annotated[str, Path(min_length=1, max_length=32)],
    name: Annotated[str, Query(max_length=200)] = "",
    artist: Annotated[str, Query(max_length=200)] = "",
    duration_ms: Annotated[int, Query(alias="durationMs", ge=0, le=3_600_000)] = 0,
    album_id: Annotated[str, Query(alias="albumId", pattern=r"^\d{0,40}$")] = "",
    album_audio_id: Annotated[str, Query(alias="albumAudioId", pattern=r"^\d{0,40}$")] = "",
    refresh: Annotated[bool, Query()] = False,
):
    try:
        result = validate_track(
            source=source,
            track_id=track_id,
            name=name,
            artist=artist,
            duration_ms=duration_ms,
            force=refresh,
        )
        # 匿名缓存不能代表账号权益；账号检查结果不缓存，也不返回临时播放地址。
        result = {**result, "playbackScope": "public"}
        if not result.get("available") and result.get("reason") not in ("invalid_hash", "invalid_id"):
            try:
                music_accounts.private_playback(source, track_id, album_id=album_id, album_audio_id=album_audio_id)
                result.update(available=True, playbackSource=source, playbackScope="account", reason="")
            except ValueError:
                pass
        return ok(result)
    except (httpx.HTTPError, ValueError, TypeError):
        return fail("music_validation_unavailable", "音源检查服务暂时不可用，请稍后重试。", 502)
