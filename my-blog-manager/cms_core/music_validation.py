from __future__ import annotations

import re
import time
from typing import Any, Literal

import httpx

from cms_core import kugou


MusicSource = Literal["netease", "kugou"]
NETEASE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; YunYueBlogs-Manager/2.0; +https://majo-elaina.top)",
    "Referer": "https://music.163.com/",
}
VALIDATION_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}


def validate_track(
    *,
    source: MusicSource,
    track_id: str,
    name: str = "",
    artist: str = "",
    duration_ms: int = 0,
    force: bool = False,
) -> dict[str, Any]:
    normalized_id = track_id.upper() if source == "kugou" else track_id
    cache_key = f"{source}:{normalized_id}"
    cached = VALIDATION_CACHE.get(cache_key)
    if not force and cached and cached[0] > time.monotonic():
        return cached[1]

    if source == "kugou":
        result = _validate_kugou(normalized_id)
    else:
        result = _validate_netease(normalized_id, name, artist, duration_ms)

    if len(VALIDATION_CACHE) >= 128:
        VALIDATION_CACHE.clear()
    VALIDATION_CACHE[cache_key] = (time.monotonic() + (300 if result["available"] else 90), result)
    return result


def _validate_kugou(song_hash: str) -> dict[str, Any]:
    if not re.fullmatch(r"[A-F0-9]{32}", song_hash):
        return _result(False, "kugou", "invalid_hash")
    playback = kugou.playback_info(song_hash)
    return {
        **_result(bool(playback.get("available")), "kugou", str(playback.get("reason") or "playback_unavailable")),
        "name": str(playback.get("name") or "")[:200],
        "artist": str(playback.get("artist") or "")[:200],
        "album": str(playback.get("album") or "")[:200],
        "cover": str(playback.get("cover") or "")[:2048],
        "albumAudioId": str(playback.get("albumAudioId") or "")[:40],
    }


def _validate_netease(song_id: str, name: str, artist: str, duration_ms: int) -> dict[str, Any]:
    if not re.fullmatch(r"\d{1,20}", song_id):
        return _result(False, "netease", "invalid_id")

    if not name.strip():
        name, artist, duration_ms = _netease_identity(song_id)

    response = httpx.get(
        "https://music.163.com/api/song/enhance/player/url",
        params={"ids": f"[{song_id}]", "br": "320000"},
        headers=NETEASE_HEADERS,
        timeout=8,
        follow_redirects=False,
    )
    response.raise_for_status()
    payload = response.json()
    rows = payload.get("data", []) if isinstance(payload, dict) else []
    url = rows[0].get("url") if rows and isinstance(rows[0], dict) else ""
    if isinstance(url, str) and url.startswith(("https://", "http://")):
        return _result(True, "netease", "")

    if name.strip():
        lyric = kugou.fetch_lyrics(name=name, artist=artist, duration_ms=duration_ms)
        fallback_hash = str(lyric.get("resolvedHash") or "").upper()
        if re.fullmatch(r"[A-F0-9]{32}", fallback_hash):
            fallback = kugou.playback_info(fallback_hash)
            if fallback.get("available"):
                return _result(True, "kugou", "netease_fallback")

    return _result(False, "netease", "copyright_or_region")


def _netease_identity(song_id: str) -> tuple[str, str, int]:
    response = httpx.get(
        "https://music.163.com/api/song/detail/",
        params={"id": song_id, "ids": f"[{song_id}]"},
        headers=NETEASE_HEADERS,
        timeout=8,
        follow_redirects=False,
    )
    response.raise_for_status()
    payload = response.json()
    songs = payload.get("songs", []) if isinstance(payload, dict) else []
    song = songs[0] if songs and isinstance(songs[0], dict) else None
    if song is None:
        raise ValueError("music_not_found")
    artists = song.get("artists") if isinstance(song.get("artists"), list) else []
    artist = str(artists[0].get("name") if artists and isinstance(artists[0], dict) else "")[:200]
    return str(song.get("name") or "")[:200], artist, max(0, int(song.get("duration") or 0))


def _result(available: bool, playback_source: MusicSource, reason: str) -> dict[str, Any]:
    return {
        "available": available,
        "playbackSource": playback_source,
        "reason": "" if available else reason,
    }
