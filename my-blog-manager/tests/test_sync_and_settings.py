from __future__ import annotations

import hashlib
import asyncio
import base64
import json
import subprocess
import zlib
from io import BytesIO
from pathlib import Path

import pytest
from fastapi import BackgroundTasks
from pydantic import ValidationError
from starlette.datastructures import Headers, UploadFile

from cms_core.api import deploy, music, settings_v2, sync
from cms_core import kugou, music_library, music_validation
from cms_core.workspace import read_json


def git(path: Path, *args: str) -> None:
    subprocess.run(["git", *args], cwd=path, check=True, capture_output=True)


def initialize_blog(path: Path) -> None:
    path.mkdir()
    git(path, "init")
    git(path, "config", "user.name", "YunYue Test")
    git(path, "config", "user.email", "test@example.invalid")
    (path / "package.json").write_text('{"name":"yunyue-blog"}\n', encoding="utf-8")
    (path / ".yunyue-blog.json").write_text('{"schemaVersion":2}\n', encoding="utf-8")


def commit_all(path: Path, message: str = "测试基线") -> None:
    git(path, "add", ".")
    git(path, "commit", "-m", message)


def response_json(response) -> dict:
    return json.loads(response.body.decode("utf-8"))


def lyric_upload(filename: str, content: bytes) -> UploadFile:
    return UploadFile(file=BytesIO(content), filename=filename, headers=Headers({"content-type": "text/plain"}))


def configure_music_workspace(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    data_root = tmp_path / "data"
    data_root.mkdir()
    (data_root / "site.json").write_text(json.dumps({"musicIds": ["1809646618"]}), encoding="utf-8")
    monkeypatch.setattr(settings_v2, "DATA_ROOT", data_root)
    monkeypatch.setattr(settings_v2, "ensure_workspace", lambda: tmp_path)
    monkeypatch.setattr(music_library, "DATA_ROOT", data_root)
    monkeypatch.setattr(music_library, "ensure_workspace", lambda: tmp_path)
    return data_root


@pytest.fixture
def isolated_workspace(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    workspace = tmp_path / "workspace"
    content = workspace / "content"
    data = workspace / "data"
    plans = workspace / "plans"
    for folder in (content / "posts", content / "chatters", content / "moments", data, plans):
        folder.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(sync, "CONTENT_ROOT", content)
    monkeypatch.setattr(sync, "DATA_ROOT", data)
    monkeypatch.setattr(sync, "PLANS_ROOT", plans)
    monkeypatch.setattr(sync, "ensure_workspace", lambda: workspace)
    monkeypatch.setattr(sync, "import_legacy_content", lambda: {"copied": [], "counts": {}})
    return workspace


def test_git_changes_preserves_chinese_paths(tmp_path: Path) -> None:
    target = tmp_path / "blog"
    initialize_blog(target)
    commit_all(target)
    chinese_file = target / "posts" / "中文文章.md"
    chinese_file.parent.mkdir()
    chinese_file.write_text("正文", encoding="utf-8")

    assert sync.git_changes(target) == ["posts/中文文章.md"]


def test_managed_destination_rejects_escape(tmp_path: Path) -> None:
    target = tmp_path / "blog"
    target.mkdir()

    with pytest.raises(ValueError):
        sync.managed_destination(target.resolve(), "../secret.txt")


def test_plan_apply_only_deletes_managed_files(isolated_workspace: Path, tmp_path: Path) -> None:
    target = tmp_path / "blog"
    initialize_blog(target)
    (target / "posts").mkdir()
    (target / "posts" / "stale.md").write_text("旧内容", encoding="utf-8")
    (target / "notes.txt").write_text("不能删除", encoding="utf-8")
    (target / sync.MANIFEST_NAME).write_text(
        json.dumps({"schemaVersion": 2, "files": ["posts/stale.md"]}),
        encoding="utf-8",
    )
    commit_all(target)

    source = isolated_workspace / "content" / "posts" / "新文章.md"
    source.write_text("---\ntitle: 新文章\ndate: 2026-07-15\n---\n正文\n", encoding="utf-8")
    plan_response = sync.create_sync_plan(sync.SyncRequest(blogPath=str(target)))
    plan = response_json(plan_response)["data"]
    assert plan["canApply"] is True

    apply_response = sync.apply_sync_plan(sync.ApplyRequest(blogPath=str(target), planId=plan["planId"]))
    assert response_json(apply_response)["ok"] is True
    assert (target / "posts" / "新文章.md").is_file()
    assert not (target / "posts" / "stale.md").exists()
    assert (target / "notes.txt").read_text(encoding="utf-8") == "不能删除"
    manifest = read_json(target / sync.MANIFEST_NAME, {})
    assert manifest["deletedFiles"] == ["posts/stale.md"]


def test_push_rejects_unrelated_changes(isolated_workspace: Path, tmp_path: Path) -> None:
    target = tmp_path / "blog"
    initialize_blog(target)
    (target / sync.MANIFEST_NAME).write_text(
        json.dumps({"schemaVersion": 2, "files": ["posts/managed.md"]}),
        encoding="utf-8",
    )
    commit_all(target)
    (target / "README.md").write_text("用户改动", encoding="utf-8")

    response = deploy.push(deploy.PushRequest(blogPath=str(target)), BackgroundTasks())
    payload = response_json(response)
    assert response.status_code == 409
    assert payload["error"]["code"] == "unrelated_changes"
    assert payload["error"]["details"] == ["README.md"]


def test_push_request_requires_chinese_commit_and_safe_git_names() -> None:
    with pytest.raises(ValidationError):
        deploy.PushRequest(blogPath="C:/blog", commitMessage="update content")
    with pytest.raises(ValidationError):
        deploy.PushRequest(blogPath="C:/blog", remote="--mirror")
    with pytest.raises(ValidationError):
        deploy.PushRequest(blogPath="C:/blog", branch="../main")

    request = deploy.PushRequest(blogPath="C:/blog", commitMessage="内容：更新文章", remote="origin", branch="main")
    assert request.commitMessage == "内容：更新文章"


def test_deploy_config_only_accepts_vercel_urls() -> None:
    assert deploy.DeployConfig(vercelProjectUrl="https://vercel.com/yunyue/blog").vercelProjectUrl
    assert deploy.DeployConfig(vercelProjectUrl="https://yunyue.vercel.app").vercelProjectUrl
    with pytest.raises(ValidationError):
        deploy.DeployConfig(vercelProjectUrl="https://example.com/fake-vercel")
    with pytest.raises(ValidationError):
        deploy.DeployConfig(remote="--mirror")


def test_repository_update_fast_forwards_clean_branch(tmp_path: Path) -> None:
    remote = tmp_path / "remote.git"
    subprocess.run(["git", "init", "--bare", str(remote)], check=True, capture_output=True)
    target = tmp_path / "blog"
    initialize_blog(target)
    git(target, "branch", "-M", "main")
    commit_all(target)
    git(target, "remote", "add", "origin", str(remote))
    git(target, "push", "-u", "origin", "main")

    author = tmp_path / "author"
    subprocess.run(["git", "clone", "--branch", "main", str(remote), str(author)], check=True, capture_output=True)
    git(author, "config", "user.name", "Remote Author")
    git(author, "config", "user.email", "remote@example.invalid")
    (author / "remote.txt").write_text("远程更新", encoding="utf-8")
    commit_all(author, "远程更新")
    git(author, "push", "origin", "main")

    response = deploy.update_repository(deploy.RepositoryRequest(blogPath=str(target), remote="origin", branch="main"))
    payload = response_json(response)
    assert payload["ok"] is True
    assert payload["data"]["behind"] == 0
    assert (target / "remote.txt").read_text(encoding="utf-8") == "远程更新"


def test_repository_update_rejects_dirty_worktree(tmp_path: Path) -> None:
    target = tmp_path / "blog"
    initialize_blog(target)
    git(target, "branch", "-M", "main")
    commit_all(target)
    (target / "local.txt").write_text("未提交", encoding="utf-8")

    response = deploy.update_repository(deploy.RepositoryRequest(blogPath=str(target), remote="origin", branch="main"))
    payload = response_json(response)
    assert response.status_code == 409
    assert payload["error"]["code"] == "dirty_repository"
    assert payload["error"]["details"] == ["local.txt"]


def test_public_settings_build_date_requires_timezone() -> None:
    payload = {
        "title": "云月", "shortTitle": "云月", "author": "云月", "bio": "", "description": "",
        "avatar": "", "favicon": "", "homeHero": "/images/home-hero.webp", "defaultCover": "",
        "siteUrl": "https://example.invalid", "buildDate": "2026-06-15T00:00:00+08:00",
        "social": {"github": "", "email": ""}, "musicIds": [], "danmaku": [], "bangumiUsername": "",
        "giscus": {"repo": "", "repoId": "", "category": "Announcements", "categoryId": ""},
        "icp": {"name": "", "url": ""},
    }

    assert settings_v2.PublicSiteConfig.model_validate(payload).buildDate.endswith("+08:00")
    payload["buildDate"] = "2026-06-15T00:00:00"
    with pytest.raises(ValidationError):
        settings_v2.PublicSiteConfig.model_validate(payload)


def test_music_settings_validate_deduplicate_and_limit_ids() -> None:
    assert settings_v2.MusicSettings(musicIds=["12", "12", "34"]).musicIds == ["12", "34"]
    with pytest.raises(ValidationError):
        settings_v2.MusicSettings(musicIds=["not-an-id"])
    assert len(settings_v2.MusicSettings(musicIds=[str(index) for index in range(100)]).musicIds) == 100


def test_upload_encrypted_krc_extracts_word_timing_and_languages(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    data_root = configure_music_workspace(tmp_path, monkeypatch)
    language = base64.b64encode(json.dumps({
        "content": [
            {"type": 1, "lyricContent": [["Starlight"], ["Moonlight"]]},
            {"type": 0, "lyricContent": [["xing", " guang"], ["yue", " se"]]},
        ],
    }, ensure_ascii=False).encode("utf-8")).decode("ascii")
    decoded = f"[language:{language}]\n[1000,1000]<0,400,0>星<400,600,0>光\n[2500,1200]<0,500,0>月<500,700,0>色"
    compressed = zlib.compress(decoded.encode("utf-8"))
    encrypted = bytes(value ^ music_library.KRC_KEY[index % len(music_library.KRC_KEY)] for index, value in enumerate(compressed))

    response = asyncio.run(settings_v2.upload_lyric("1809646618", "primary", lyric_upload("星夜.krc", b"krc1" + encrypted)))
    payload = response_json(response)
    assert payload["ok"] is True
    assert payload["data"]["primary"]["format"] == "krc"
    assert payload["data"]["primary"]["wordTimed"] is True
    assert payload["data"]["translation"]["generatedFrom"] == "primary"
    assert payload["data"]["romanization"]["generatedFrom"] == "primary"
    assert "content" not in payload["data"]["primary"]

    stored = read_json(data_root / "music.json", {})
    assert stored["tracks"]["netease:1809646618"]["primary"]["content"].startswith("[language:")
    assert "[00:01.000]Starlight" in stored["tracks"]["netease:1809646618"]["translation"]["content"]
    assert "[00:02.500]yue se" in stored["tracks"]["netease:1809646618"]["romanization"]["content"]


def test_text_qrc_and_offset_are_saved_with_validation(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    configure_music_workspace(tmp_path, monkeypatch)
    qrc = "[1000,1600](0,700)云(700,900)月".encode("utf-8")
    upload_response = asyncio.run(settings_v2.upload_lyric("1809646618", "primary", lyric_upload("云月.qrc", qrc)))
    assert response_json(upload_response)["data"]["primary"]["format"] == "qrc"

    offset_response = settings_v2.save_lyric_offset("1809646618", settings_v2.LyricOffsetUpdate(offsetMs=350))
    assert response_json(offset_response)["data"]["offsetMs"] == 350
    with pytest.raises(ValidationError):
        settings_v2.LyricOffsetUpdate(offsetMs=5001)


def test_dual_source_music_settings_migrate_legacy_ids_and_validate_kugou_hash() -> None:
    legacy = settings_v2.MusicSettings(musicIds=["1809646618"])
    assert legacy.musicTracks[0].key == "netease:1809646618"
    dual = settings_v2.MusicSettings(musicTracks=[
        settings_v2.MusicTrackReference(source="netease", id="1809646618"),
        settings_v2.MusicTrackReference(source="kugou", id="d89573ba09b50eee2d3c3da4f8ea1395", name="云月谣", artist="兰音Reine"),
    ])
    assert [track.key for track in dual.musicTracks] == ["netease:1809646618", "kugou:D89573BA09B50EEE2D3C3DA4F8EA1395"]
    with pytest.raises(ValidationError):
        settings_v2.MusicTrackReference(source="kugou", id="not-a-hash", name="错误")


def test_kugou_validation_rejects_track_without_playback_url(monkeypatch: pytest.MonkeyPatch) -> None:
    music_validation.VALIDATION_CACHE.clear()
    monkeypatch.setattr(kugou, "playback_info", lambda _song_hash: {
        "available": False,
        "reason": "copyright",
        "name": "久遠寺有珠",
        "artist": "深澤秀行",
    })

    result = music_validation.validate_track(
        source="kugou",
        track_id="BF25EEA67F30CA66142F51F0AAB9FF3D",
        name="久遠寺有珠",
        artist="深澤秀行",
        force=True,
    )

    assert result["available"] is False
    assert result["reason"] == "copyright"
    assert result["name"] == "久遠寺有珠"


def test_music_save_preserves_restricted_catalog_track_without_private_url(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    data_root = configure_music_workspace(tmp_path, monkeypatch)
    original = read_json(data_root / "site.json", {})
    def offline(*args, **kwargs):
        raise AssertionError("保存歌单不应访问外部音乐平台")
    monkeypatch.setattr(music_validation, "validate_track", offline)
    monkeypatch.setattr(music_validation.httpx, "get", offline)
    payload = settings_v2.MusicSettings(musicTracks=[
        settings_v2.MusicTrackReference(
            source="kugou",
            id="BF25EEA67F30CA66142F51F0AAB9FF3D",
            name="久遠寺有珠",
            artist="深澤秀行",
        ),
    ])

    response = settings_v2.save_music_settings(payload)

    assert response.status_code == 200
    stored = read_json(data_root / "site.json", {})
    assert stored != original
    assert stored['musicTracks'][0]['id'] == 'BF25EEA67F30CA66142F51F0AAB9FF3D'
    assert 'url' not in stored['musicTracks'][0]


def test_kugou_lyrics_follow_search_download_decode_parse_chain(monkeypatch: pytest.MonkeyPatch) -> None:
    language = base64.b64encode(json.dumps({
        "content": [
            {"type": 1, "lyricContent": [["Starlight"]]},
            {"type": 0, "lyricContent": [["xing", " guang"]]},
        ],
    }).encode("utf-8")).decode("ascii")
    decoded = f"[language:{language}]\n[1000,1200]<0,500,0>星<500,700,0>光"
    compressed = zlib.compress(decoded.encode("utf-8"))
    encrypted = bytes(value ^ music_library.KRC_KEY[index % len(music_library.KRC_KEY)] for index, value in enumerate(compressed))
    encoded = base64.b64encode(b"krc1" + encrypted).decode("ascii")
    calls: list[str] = []
    search_params: list[dict] = []

    class Response:
        def __init__(self, payload: dict):
            self.payload = payload

        def raise_for_status(self):
            return None

        def json(self):
            return self.payload

    def fake_get(url, **kwargs):
        calls.append(url)
        if url.endswith("/v1/search"):
            search_params.append(kwargs["params"])
            return Response({"candidates": [{"id": "lyric-1", "accesskey": "key-1", "song": "云月谣", "singer": "兰音Reine", "score": 80}]})
        return Response({"content": encoded, "contenttype": 0})

    kugou.CACHE.clear()
    monkeypatch.setattr(kugou.httpx, "get", fake_get)
    result = kugou.fetch_lyrics(song_hash="D89573BA09B50EEE2D3C3DA4F8EA1395", album_audio_id="91260320", name="云月谣", artist="兰音Reine")
    assert calls == ["https://lyrics.kugou.com/v1/search", "https://lyrics.kugou.com/download"]
    assert search_params[0]["album_audio_id"] == "0"
    assert result["available"] is True
    assert result["format"] == "krc"
    assert result["wordTimed"] is True
    assert "<0,500,0>星" in result["content"]
    assert "[00:01.000]Starlight" in result["translationLrc"]
    assert "[00:01.000]xing guang" in result["romanizedLrc"]


def test_kugou_lyrics_resolve_exact_song_hash_and_reject_preview_candidates(monkeypatch: pytest.MonkeyPatch) -> None:
    decoded = "[1000,3000]<0,1000,0>第<1000,1000,0>一<2000,1000,0>句\n[150000,5000]<0,2500,0>最<2500,2500,0>后"
    compressed = zlib.compress(decoded.encode("utf-8"))
    encrypted = bytes(value ^ music_library.KRC_KEY[index % len(music_library.KRC_KEY)] for index, value in enumerate(compressed))
    encoded = base64.b64encode(b"krc1" + encrypted).decode("ascii")
    calls: list[str] = []

    class Response:
        def __init__(self, payload: dict):
            self.payload = payload

        def raise_for_status(self):
            return None

        def json(self):
            return self.payload

    def fake_get(url, **kwargs):
        calls.append(url)
        if "gateway.kugou.com" in url:
            return Response({"data": {"lists": [{
                "FileHash": "D89573BA09B50EEE2D3C3DA4F8EA1395",
                "OriSongName": "云月谣",
                "SingerName": "兰音Reine",
                "Duration": 160,
            }]}})
        if url.endswith("/v1/search"):
            assert kwargs["params"]["hash"] == "D89573BA09B50EEE2D3C3DA4F8EA1395"
            assert kwargs["params"]["album_audio_id"] == "0"
            return Response({"candidates": [{
                "id": "full-lyric",
                "accesskey": "full-key",
                "song": "云月谣",
                "singer": "兰音Reine",
                "duration": 158000,
                "score": 80,
            }]})
        return Response({"content": encoded, "contenttype": 0})

    kugou.CACHE.clear()
    monkeypatch.setattr(kugou.httpx, "get", fake_get)
    result = kugou.fetch_lyrics(name="云月谣", artist="兰音Reine", duration_ms=160562)
    assert calls == [
        "https://gateway.kugou.com/v3/search/song",
        "https://lyrics.kugou.com/v1/search",
        "https://lyrics.kugou.com/download",
    ]
    assert result["available"] is True
    assert result["resolvedHash"] == "D89573BA09B50EEE2D3C3DA4F8EA1395"


def test_lyric_upload_rejects_binary_qrc_and_song_outside_playlist(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    configure_music_workspace(tmp_path, monkeypatch)
    binary = asyncio.run(settings_v2.upload_lyric("1809646618", "primary", lyric_upload("locked.qrc", b"\x00\x01\x02")))
    assert binary.status_code == 415
    assert response_json(binary)["error"]["code"] == "encrypted_qrc_unsupported"

    missing = asyncio.run(settings_v2.upload_lyric("42", "primary", lyric_upload("plain.lrc", b"[00:01]line")))
    assert missing.status_code == 409
    assert response_json(missing)["error"]["code"] == "song_not_in_playlist"


def test_sync_sources_include_public_music_configuration(isolated_workspace: Path) -> None:
    music_file = isolated_workspace / "data" / "music.json"
    music_file.write_text('{"version":1,"tracks":{}}\n', encoding="utf-8")
    assert sync.source_files()["src/data/music.json"] == music_file


def test_music_query_normalizes_upstream_response(monkeypatch: pytest.MonkeyPatch) -> None:
    class Response:
        def raise_for_status(self):
            return None

        def json(self):
            return {"songs": [{"name": "云月谣", "artists": [{"name": "兰音Reine"}], "album": {"name": "星夜", "picUrl": "https://images.example/cover.jpg"}}]}

    music.MUSIC_CACHE.clear()
    monkeypatch.setattr(music.httpx, "get", lambda *args, **kwargs: Response())
    payload = response_json(music.query_netease_music("1809646618"))
    assert payload["data"] == {
        "id": "1809646618",
        "name": "云月谣",
        "artist": "兰音Reine",
            "album": "星夜",
            "cover": "https://images.example/cover.jpg",
            "durationMs": 0,
        }


def test_integration_secrets_are_never_returned(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    data_root = tmp_path / "data"
    config_root = tmp_path / "config"
    data_root.mkdir()
    config_root.mkdir()
    site = {
        "title": "云月",
        "giscus": {"repo": "", "repoId": "", "category": "Announcements", "categoryId": ""},
    }
    (data_root / "site.json").write_text(json.dumps(site), encoding="utf-8")
    monkeypatch.setattr(settings_v2, "DATA_ROOT", data_root)
    monkeypatch.setattr(settings_v2, "CONFIG_ROOT", config_root)
    monkeypatch.setattr(settings_v2, "ensure_workspace", lambda: tmp_path)

    response = settings_v2.save_integrations(settings_v2.IntegrationUpdate(
        bangumiUsername="yunyue",
        picBedUrl="https://images.example.invalid/upload",
        picBedName="私有图床",
        picBedToken="pic-secret",
        geminiApiKey="ai-secret",
    ))
    payload = response_json(response)["data"]
    serialized = json.dumps(payload, ensure_ascii=False)
    assert "pic-secret" not in serialized
    assert "ai-secret" not in serialized
    assert "giscus" not in payload
    assert "giscus" not in json.loads((data_root / "site.json").read_text(encoding="utf-8"))
    assert payload["picBedTokenConfigured"] is True
    assert payload["geminiApiKeyConfigured"] is True
    assert hashlib.sha256(b"pic-secret").hexdigest() not in serialized
