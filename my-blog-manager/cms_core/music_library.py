from __future__ import annotations

import base64
import json
import re
import zlib
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

from cms_core.workspace import DATA_ROOT, ensure_workspace, read_json, write_json_atomic


MAX_UPLOAD_BYTES = 512 * 1024
MAX_DECODED_BYTES = 1024 * 1024
KRC_KEY = bytes((0x40, 0x47, 0x61, 0x77, 0x5E, 0x32, 0x74, 0x47, 0x51, 0x36, 0x31, 0x2D, 0xCE, 0xD2, 0x6E, 0x69))
SONG_ID = re.compile(r"^\d{1,20}$")
TRACK_KEY = re.compile(r"^(?:netease:\d{1,20}|kugou:[A-Fa-f0-9]{32})$")
MILLISECOND_LINE = re.compile(r"^\[(\d+),(\d+)\](.*)$")
STANDARD_LINE = re.compile(r"^\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]")
KRC_WORD = re.compile(r"<(\d+),(\d+)(?:,\d+)?>([^<]*)")
MILLISECOND_WORD = re.compile(r"\((\d+),(\d+)(?:,\d+)?\)([^()]*)")
LANGUAGE_LINE = re.compile(r"^\[language:([^\]]+)\]$")

LyricKind = Literal["primary", "translation", "romanization"]
LyricFormat = Literal["lrc", "yrc", "krc", "qrc"]


class LyricAsset(BaseModel):
    format: LyricFormat
    fileName: str = Field(min_length=1, max_length=255)
    content: str = Field(min_length=1, max_length=MAX_DECODED_BYTES)
    bytes: int = Field(ge=1, le=MAX_DECODED_BYTES)
    lineCount: int = Field(ge=1, le=20_000)
    wordTimed: bool = False
    generatedFrom: str | None = Field(default=None, max_length=40)


class TrackLyricConfig(BaseModel):
    offsetMs: int = Field(default=0, ge=-5_000, le=5_000)
    primary: LyricAsset | None = None
    translation: LyricAsset | None = None
    romanization: LyricAsset | None = None


class MusicLibrary(BaseModel):
    version: Literal[1] = 1
    tracks: dict[str, TrackLyricConfig] = Field(default_factory=dict)

    @field_validator("tracks")
    @classmethod
    def validate_tracks(cls, value: dict[str, TrackLyricConfig]) -> dict[str, TrackLyricConfig]:
        if any(not (SONG_ID.fullmatch(song_id) or TRACK_KEY.fullmatch(song_id)) for song_id in value):
            raise ValueError("歌词配置包含无效歌曲标识")
        return value


class LyricFileError(ValueError):
    def __init__(self, code: str, message: str, status_code: int = 422):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


def library_path() -> Path:
    return DATA_ROOT / "music.json"


def load_library() -> MusicLibrary:
    ensure_workspace()
    raw = read_json(library_path(), {"version": 1, "tracks": {}})
    try:
        return MusicLibrary.model_validate(raw)
    except ValueError:
        return MusicLibrary()


def save_library(library: MusicLibrary) -> None:
    write_json_atomic(library_path(), library.model_dump(exclude_none=True))


def public_library(library: MusicLibrary) -> dict[str, Any]:
    return library.model_dump(exclude_none=True)


def summarize_asset(asset: LyricAsset | None) -> dict[str, Any] | None:
    if asset is None:
        return None
    return asset.model_dump(exclude={"content"}, exclude_none=True)


def summarize_track(track: TrackLyricConfig) -> dict[str, Any]:
    return {
        "offsetMs": track.offsetMs,
        "primary": summarize_asset(track.primary),
        "translation": summarize_asset(track.translation),
        "romanization": summarize_asset(track.romanization),
    }


def decode_uploaded_lyric(filename: str, payload: bytes) -> tuple[LyricFormat, str]:
    suffix = Path(filename).suffix.lower().removeprefix(".")
    if suffix not in {"lrc", "yrc", "krc", "qrc"}:
        raise LyricFileError("unsupported_lyric_format", "仅支持 LRC、YRC、KRC 和 QRC 歌词文件。", 415)
    if not payload:
        raise LyricFileError("empty_lyric_file", "歌词文件为空。")
    if len(payload) > MAX_UPLOAD_BYTES:
        raise LyricFileError("lyric_file_too_large", "歌词文件不能超过 512 KB。", 413)

    if suffix == "krc" and payload.startswith(b"krc1"):
        encrypted = payload[4:]
        decrypted = bytes(value ^ KRC_KEY[index % len(KRC_KEY)] for index, value in enumerate(encrypted))
        try:
            decoded = zlib.decompress(decrypted)
        except zlib.error as error:
            raise LyricFileError("invalid_krc", "KRC 文件解密失败或内容已损坏。") from error
        if len(decoded) > MAX_DECODED_BYTES:
            raise LyricFileError("lyric_file_too_large", "KRC 解压后的歌词不能超过 1 MB。", 413)
        text = decoded.decode("utf-8", errors="strict")
    else:
        text = _decode_text(payload, suffix)

    normalized = text.replace("\r\n", "\n").replace("\r", "\n").lstrip("\ufeff")
    if "\x00" in normalized:
        message = "暂不支持加密 QRC，请先导出为文本 QRC。" if suffix == "qrc" else "歌词文件包含无效二进制内容。"
        raise LyricFileError("encrypted_qrc_unsupported" if suffix == "qrc" else "invalid_lyric_file", message, 415)
    normalized = "\n".join(line.rstrip() for line in normalized.split("\n")).strip()
    if not normalized:
        raise LyricFileError("empty_lyric_file", "歌词文件没有可读取内容。")
    return suffix, normalized


def _decode_text(payload: bytes, suffix: str) -> str:
    for encoding in ("utf-8-sig", "gb18030"):
        try:
            return payload.decode(encoding)
        except UnicodeDecodeError:
            continue
    message = "暂不支持加密 QRC，请先导出为文本 QRC。" if suffix == "qrc" else "歌词文件编码必须是 UTF-8 或 GB18030。"
    raise LyricFileError("encrypted_qrc_unsupported" if suffix == "qrc" else "invalid_lyric_encoding", message, 415)


def build_asset(filename: str, lyric_format: LyricFormat, content: str, *, generated_from: str | None = None) -> LyricAsset:
    lines = [line for line in content.splitlines() if _is_timed_line(line)]
    if not lines:
        raise LyricFileError("lyric_timing_missing", "歌词中没有找到有效时间戳。")
    word_timed = _has_word_timing(content, lyric_format)
    if lyric_format in {"yrc", "krc", "qrc"} and not word_timed:
        raise LyricFileError("word_timing_missing", f"{lyric_format.upper()} 文件中没有找到逐字时间。")
    encoded_size = len(content.encode("utf-8"))
    if encoded_size > MAX_DECODED_BYTES:
        raise LyricFileError("lyric_file_too_large", "规范化后的歌词不能超过 1 MB。", 413)
    return LyricAsset(
        format=lyric_format,
        fileName=Path(filename).name,
        content=content,
        bytes=encoded_size,
        lineCount=len(lines),
        wordTimed=word_timed,
        generatedFrom=generated_from,
    )


def _is_timed_line(line: str) -> bool:
    return bool(MILLISECOND_LINE.match(line) or STANDARD_LINE.match(line))


def _has_word_timing(content: str, lyric_format: str) -> bool:
    if lyric_format == "krc":
        return bool(KRC_WORD.search(content))
    if lyric_format in {"yrc", "qrc"}:
        return bool(MILLISECOND_WORD.search(content))
    return bool(re.search(r"<\d{1,3}:\d{2}(?:[.:]\d{1,3})?>", content))


def extract_krc_languages(content: str) -> dict[LyricKind, str]:
    starts = [int(match.group(1)) for line in content.splitlines() if (match := MILLISECOND_LINE.match(line))]
    if not starts:
        return {}
    language_payload: dict[str, Any] | None = None
    for line in content.splitlines():
        match = LANGUAGE_LINE.match(line.strip())
        if not match:
            continue
        encoded = match.group(1).replace("-", "+").replace("_", "/")
        encoded += "=" * (-len(encoded) % 4)
        try:
            language_payload = json.loads(base64.b64decode(encoded, validate=True).decode("utf-8"))
        except (ValueError, UnicodeDecodeError, json.JSONDecodeError):
            return {}
        break
    if not isinstance(language_payload, dict):
        return {}

    extracted: dict[LyricKind, str] = {}
    sections = language_payload.get("content")
    if not isinstance(sections, list):
        return extracted
    for section in sections:
        if not isinstance(section, dict):
            continue
        kind: LyricKind | None = "translation" if section.get("type") == 1 else "romanization" if section.get("type") == 0 else None
        rows = section.get("lyricContent")
        if kind is None or not isinstance(rows, list):
            continue
        rendered: list[str] = []
        for index, row in enumerate(rows[:len(starts)]):
            if not isinstance(row, list):
                continue
            text = "".join(str(part) for part in row if part is not None).strip()
            if text:
                rendered.append(f"[{_milliseconds_to_timestamp(starts[index])}]{text}")
        if rendered:
            extracted[kind] = "\n".join(rendered)
    return extracted


def _milliseconds_to_timestamp(value: int) -> str:
    minutes, remainder = divmod(max(0, value), 60_000)
    seconds, milliseconds = divmod(remainder, 1_000)
    return f"{minutes:02d}:{seconds:02d}.{milliseconds:03d}"
