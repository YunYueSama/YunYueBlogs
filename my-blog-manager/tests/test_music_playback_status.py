import json
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from cms_core.api import music

@pytest.mark.parametrize("account_available", [True, False])
def test_account_full_source_overrides_anonymous_restriction(monkeypatch, account_available):
    anonymous = {"available": False, "playbackSource": "kugou", "reason": "login_required"}
    monkeypatch.setattr(music, "validate_track", lambda **kwargs: anonymous)
    def playback(source, track_id, **kwargs):
        assert kwargs == {"album_id": "570987", "album_audio_id": "2910278"}
        if not account_available:
            raise ValueError("trial or account unavailable")
        return {"url": "https://private.example/audio?token=secret", "scope": "private"}
    monkeypatch.setattr(music.music_accounts, "private_playback", playback)
    app = FastAPI(); app.include_router(music.router)
    response = TestClient(app).get("/playback/kugou/" + "A" * 32 + "/status?albumId=570987&albumAudioId=2910278")
    data = response.json()["data"]
    assert data["available"] is account_available
    assert data["playbackScope"] == ("account" if account_available else "public")
    assert "secret" not in response.text and "url" not in data
    assert anonymous["available"] is False


def test_invalid_id_never_requests_account(monkeypatch):
    monkeypatch.setattr(music, "validate_track", lambda **kwargs: {"available": False, "reason": "invalid_hash"})
    def playback(*args, **kwargs):
        pytest.fail("invalid id must not use credentials")
    monkeypatch.setattr(music.music_accounts, "private_playback", playback)
    app = FastAPI(); app.include_router(music.router)
    assert TestClient(app).get("/playback/kugou/bad/status").json()["data"]["available"] is False


@pytest.mark.parametrize("local_available", [True, False])
def test_public_success_still_checks_actual_local_path(monkeypatch, local_available):
    monkeypatch.setattr(music, "validate_track", lambda **kwargs: {"available": True, "playbackSource": "netease", "reason": ""})
    def playback(source, track_id, **kwargs):
        assert (source, track_id) == ("netease", "123")
        if not local_available:
            raise ValueError("本机音乐服务或平台暂时不可用，请稍后重试")
        return {"url": "https://private.example/secret"}
    monkeypatch.setattr(music.music_accounts, "private_playback", playback)
    app = FastAPI(); app.include_router(music.router)
    response = TestClient(app).get("/playback/netease/123/status")
    data = response.json()["data"]
    assert data["available"] is True
    assert data["localAvailable"] is local_available
    assert bool(data["localReason"]) is not local_available
    assert response.headers["cache-control"] == "no-store"
    assert "secret" not in response.text and "url" not in data


def test_public_failure_does_not_block_local_playback(monkeypatch):
    def validate(**kwargs):
        raise ValueError("public upstream failed")
    monkeypatch.setattr(music, "validate_track", validate)
    monkeypatch.setattr(music.music_accounts, "private_playback", lambda *args, **kwargs: {"url": "https://private.example/secret"})
    app = FastAPI(); app.include_router(music.router)
    data = TestClient(app).get("/playback/netease/123/status").json()["data"]
    assert data["localAvailable"] is True
    assert data["playbackScope"] == "account"


def test_account_change_is_checked_again(monkeypatch):
    monkeypatch.setattr(music, "validate_track", lambda **kwargs: {"available": True})
    calls = []
    def playback(*args, **kwargs):
        calls.append(1)
        if len(calls) > 1:
            raise ValueError("请先登录对应的音乐账号，可选择扫码或手机号登录")
        return {"url": "https://private.example/secret"}
    monkeypatch.setattr(music.music_accounts, "private_playback", playback)
    app = FastAPI(); app.include_router(music.router)
    client = TestClient(app)
    assert client.get("/playback/netease/123/status").json()["data"]["localAvailable"] is True
    assert client.get("/playback/netease/123/status").json()["data"]["localAvailable"] is False


def test_playlist_and_lyrics_preserve_more_than_twelve_tracks():
    from cms_core.api.settings_v2 import MusicSettings
    from cms_core.music_library import MusicLibrary
    ids = [str(i) for i in range(1, 101)]
    settings = MusicSettings(musicIds=ids)
    assert len(settings.musicTracks) == 100
    assert settings.musicIds == ids
    lyrics = MusicLibrary(tracks={f"netease:{i}": {} for i in ids})
    assert len(lyrics.tracks) == 100
