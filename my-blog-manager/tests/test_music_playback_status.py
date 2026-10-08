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
