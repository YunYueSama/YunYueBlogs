from __future__ import annotations

import base64
import hashlib
import re
import secrets
import time
from typing import Any

import httpx

from cms_core.music_library import decode_uploaded_lyric, extract_krc_languages


APP_ID = "3116"
CLIENT_VERSION = "11440"
LITE_SALT = "LnT6xpN3khm36zse0QzvmgTZ3waWdRSA"
USER_AGENT = "Android15-1070-11083-46-0-DiscoveryDRADProtocol-wifi"
KUGOU_HEADERS = {
    "User-Agent": USER_AGENT,
    "kg-rc": "1",
    "kg-thash": "5d816a0",
    "kg-rec": "1",
    "kg-rf": "B9EDA08A64250DEFFBCADDEE00F8F25F",
}
HASH_PATTERN = re.compile(r"^[A-Fa-f0-9]{32}$")
CACHE: dict[str, tuple[float, dict[str, Any]]] = {}


def _md5(value: str) -> str:
    return hashlib.md5(value.encode("utf-8"), usedforsecurity=False).hexdigest()


def _request_context() -> tuple[dict[str, str], dict[str, str]]:
    dfid = "-"
    mid = str(int(_md5(dfid), 16))
    client_time = str(int(time.time()))
    defaults = {
        "appid": APP_ID,
        "clientver": CLIENT_VERSION,
        "dfid": dfid,
        "mid": mid,
        "uuid": _md5(dfid + mid),
        "userid": "0",
        "clienttime": client_time,
    }
    headers = {**KUGOU_HEADERS, "dfid": dfid, "mid": mid, "clienttime": client_time}
    return defaults, headers


def _signed(params: dict[str, str]) -> tuple[dict[str, str], dict[str, str]]:
    defaults, headers = _request_context()
    merged = {**params, **defaults}
    raw = LITE_SALT + "".join(f"{key}={value}" for key, value in sorted(merged.items())) + LITE_SALT
    merged["signature"] = _md5(raw)
    return merged, headers


def search_songs(keyword: str, limit: int = 8) -> list[dict[str, Any]]:
    cleaned = keyword.strip()[:100]
    if not cleaned:
        return []
    cache_key = f"search:{cleaned.casefold()}:{limit}"
    if cached := _cache_get(cache_key):
        return list(cached.get("items", []))
    params, headers = _signed({
        "keyword": cleaned,
        "page": "1",
        "pagesize": str(min(12, max(1, limit))),
        "platform": "AndroidFilter",
        "iscorrection": "1",
    })
    headers["x-router"] = "complexsearch.kugou.com"
    response = httpx.get("https://gateway.kugou.com/v3/search/song", params=params, headers=headers, timeout=8, follow_redirects=False)
    response.raise_for_status()
    payload = response.json()
    lists = payload.get("data", {}).get("lists", []) if isinstance(payload, dict) else []
    items: list[dict[str, Any]] = []
    for song in lists if isinstance(lists, list) else []:
        if not isinstance(song, dict):
            continue
        song_hash = str(song.get("FileHash") or "").upper()
        if not HASH_PATTERN.fullmatch(song_hash):
            continue
        image = str(song.get("Image") or song.get("trans_param", {}).get("union_cover") or "")
        items.append({
            "key": f"kugou:{song_hash}",
            "source": "kugou",
            "id": song_hash,
            "name": str(song.get("OriSongName") or song.get("FileName") or "未命名歌曲")[:200],
            "artist": str(song.get("SingerName") or "未知歌手")[:200],
            "album": str(song.get("AlbumName") or "")[:200],
            "cover": image.replace("{size}", "400").replace("http://", "https://")[:2048],
            "albumId": str(song.get("AlbumID") or "")[:40],
            "albumAudioId": str(song.get("Audioid") or song.get("MixSongID") or "")[:40],
            "duration": int(song.get("Duration") or 0),
        })
    _cache_set(cache_key, {"items": items}, 1800)
    return items


def fetch_lyrics(
    *,
    song_hash: str = "",
    album_audio_id: str = "",
    name: str,
    artist: str = "",
    duration_ms: int = 0,
) -> dict[str, Any]:
    normalized_hash = song_hash.upper() if HASH_PATTERN.fullmatch(song_hash) else ""
    cache_key = f"lyrics:{normalized_hash or 'auto'}:{name.casefold()}:{artist.casefold()}:{duration_ms}"
    if cached := _cache_get(cache_key):
        return cached
    if not normalized_hash:
        matched_song = _best_song_match(search_songs(f"{name} {artist}".strip(), 12), name, artist, duration_ms)
        normalized_hash = str(matched_song.get("id") or "") if matched_song else ""
        if not HASH_PATTERN.fullmatch(normalized_hash):
            result = {"available": False, "source": "kugou", "reason": "song_match_not_found"}
            _cache_set(cache_key, result, 600)
            return result
    search_params, headers = _signed({
        # Kugou song-search Audioid is not the lyric API's album_audio_id. Passing
        # it here can return a completely unrelated lyric candidate even when the
        # hash is correct, so hash lookup deliberately uses zero like the desktop client.
        "album_audio_id": "0",
        "duration": "0",
        "hash": normalized_hash,
        "keyword": " ".join(part for part in (name.strip(), artist.strip()) if part)[:200],
        "lrctxt": "1",
        "man": "no",
    })
    search = httpx.get("https://lyrics.kugou.com/v1/search", params=search_params, headers=headers, timeout=8, follow_redirects=False)
    search.raise_for_status()
    candidates = search.json().get("candidates", [])
    candidate = _best_candidate(candidates, name, artist, duration_ms)
    if candidate is None:
        result = {"available": False, "source": "kugou", "reason": "not_found"}
        _cache_set(cache_key, result, 600)
        return result

    lyric_id = str(candidate.get("id") or "")
    access_key = str(candidate.get("accesskey") or "")
    lyric_format = str(candidate.get("fmt") or "krc").lower()
    download_params, download_headers = _signed({
        "ver": "1",
        "client": "android",
        "id": lyric_id,
        "accesskey": access_key,
        "fmt": lyric_format,
        "charset": "utf8",
    })
    download = httpx.get("https://lyrics.kugou.com/download", params=download_params, headers=download_headers, timeout=8, follow_redirects=False)
    download.raise_for_status()
    body = download.json()
    encoded = body.get("content") if isinstance(body, dict) else None
    if not isinstance(encoded, str) or len(encoded) > 2_000_000:
        result = {"available": False, "source": "kugou", "reason": "invalid_content"}
        _cache_set(cache_key, result, 600)
        return result
    raw = base64.b64decode(encoded, validate=True)
    _, content = decode_uploaded_lyric(f"online.{lyric_format}", raw)
    if lyric_format == "krc" and duration_ms > 0 and not _covers_track(content, duration_ms):
        result = {"available": False, "source": "kugou", "reason": "partial_lyrics"}
        _cache_set(cache_key, result, 600)
        return result
    languages = extract_krc_languages(content) if lyric_format == "krc" else {}
    result = {
        "available": True,
        "source": "kugou",
        "format": lyric_format,
        "content": content,
        "translationLrc": languages.get("translation", ""),
        "romanizedLrc": languages.get("romanization", ""),
        "wordTimed": bool(re.search(r"(?m)^\[\d+,\d+\].*[<(]\d+,\d+", content)),
        "candidate": {
            "id": lyric_id,
            "song": str(candidate.get("song") or name)[:200],
            "artist": str(candidate.get("singer") or artist)[:200],
            "durationMs": int(candidate.get("duration") or 0),
        },
        "resolvedHash": normalized_hash,
    }
    _cache_set(cache_key, result, 7200)
    return result


def playback_info(song_hash: str) -> dict[str, Any]:
    normalized_hash = song_hash.upper()
    if not HASH_PATTERN.fullmatch(normalized_hash):
        return {"available": False, "reason": "invalid_hash"}
    cache_key = f"play:{normalized_hash}"
    if cached := _cache_get(cache_key):
        return cached
    response = httpx.get(
        "https://m.kugou.com/app/i/getSongInfo.php",
        params={"cmd": "playInfo", "hash": normalized_hash},
        headers={"User-Agent": USER_AGENT, "Referer": "https://www.kugou.com/"},
        timeout=8,
        follow_redirects=False,
    )
    response.raise_for_status()
    payload = response.json()
    urls = [payload.get("url"), *(payload.get("backup_url") or [])] if isinstance(payload, dict) else []
    url = next((str(value) for value in urls if isinstance(value, str) and value.startswith("https://")), "")
    result = {
        "available": bool(url),
        "source": "kugou",
        "url": url,
        "name": str(payload.get("songName") or "")[:200],
        "artist": str(payload.get("singerName") or payload.get("author_name") or "")[:200],
        "album": str(payload.get("album_name") or "")[:200],
        "cover": str(payload.get("album_img") or payload.get("imgUrl") or "").replace("{size}", "400").replace("http://", "https://")[:2048],
        "albumAudioId": str(payload.get("album_audio_id") or payload.get("audio_id") or "")[:40],
        "reason": "" if url else str(payload.get("error") or payload.get("errcode") or "unavailable")[:100],
    }
    _cache_set(cache_key, result, 1200 if url else 300)
    return result


def lyric_summary(result: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in result.items() if key not in {"content", "translationLrc", "romanizedLrc"}}


def _best_candidate(candidates: Any, name: str, artist: str, duration_ms: int = 0) -> dict[str, Any] | None:
    if not isinstance(candidates, list):
        return None
    normalized_name = _normalize(name)
    normalized_artist = _normalize(artist)
    valid = [candidate for candidate in candidates if isinstance(candidate, dict) and candidate.get("id") and candidate.get("accesskey")]
    if not valid:
        return None
    ranked = sorted(valid, key=lambda candidate: (
        4 if _normalize(str(candidate.get("song") or "")) == normalized_name else 0,
        2 if normalized_artist and normalized_artist in _normalize(str(candidate.get("singer") or "")) else 0,
        int(candidate.get("score") or 0),
    ), reverse=True)
    best = ranked[0]
    candidate_duration = int(best.get("duration") or 0)
    if duration_ms > 0 and candidate_duration > 0:
        tolerance = max(8_000, int(duration_ms * 0.06))
        if abs(candidate_duration - duration_ms) > tolerance:
            return None
    return best


def _best_song_match(items: list[dict[str, Any]], name: str, artist: str, duration_ms: int) -> dict[str, Any] | None:
    normalized_name = _normalize(name)
    normalized_artist = _normalize(artist)
    exact: list[dict[str, Any]] = []
    for item in items:
        if _normalize(str(item.get("name") or "")) != normalized_name:
            continue
        candidate_artist = _normalize(str(item.get("artist") or ""))
        if normalized_artist and normalized_artist not in candidate_artist and candidate_artist not in normalized_artist:
            continue
        if duration_ms > 0 and int(item.get("duration") or 0) > 0:
            difference_ms = abs(int(item["duration"]) * 1000 - duration_ms)
            if difference_ms > max(8_000, int(duration_ms * 0.06)):
                continue
        exact.append(item)
    if not exact:
        return None
    return min(exact, key=lambda item: abs(int(item.get("duration") or 0) * 1000 - duration_ms) if duration_ms else 0)


def _covers_track(content: str, duration_ms: int) -> bool:
    line_ends = [int(start) + int(duration) for start, duration in re.findall(r"(?m)^\[(\d+),(\d+)\]", content)]
    if not line_ends:
        return False
    return max(line_ends) >= duration_ms * 0.7


def _normalize(value: str) -> str:
    return re.sub(r"[^a-z0-9\u3400-\u9fff\u3040-\u30ff]+", "", value.casefold())


def _cache_get(key: str) -> dict[str, Any] | None:
    cached = CACHE.get(key)
    if cached and cached[0] > time.monotonic():
        return cached[1]
    CACHE.pop(key, None)
    return None


def _cache_set(key: str, value: dict[str, Any], ttl: int) -> None:
    if len(CACHE) >= 256:
        CACHE.clear()
    CACHE[key] = (time.monotonic() + ttl, value)
