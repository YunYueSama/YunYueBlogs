from __future__ import annotations

import asyncio
import json
from io import BytesIO
from pathlib import Path

import httpx
from starlette.datastructures import Headers, UploadFile

from cms_core.api import picbed


def response_json(response) -> dict:
    return json.loads(response.body.decode("utf-8"))


def test_media_pagination_reaches_items_after_first_120(tmp_path: Path, monkeypatch) -> None:
    _, data_root = configure(tmp_path, monkeypatch)
    assets = [{"id": str(index), "url": f"https://images.example.invalid/{index}.png", "alt": "夜色"} for index in range(145)]
    picbed.write_json_atomic(data_root / picbed.MEDIA_FILE, assets)
    first = response_json(picbed.list_assets(query="夜色", offset=0, limit=24))["data"]
    final = response_json(picbed.list_assets(query="夜色", offset=120, limit=24))["data"]
    last = response_json(picbed.list_assets(query="夜色", offset=144, limit=24))["data"]
    assert first["total"] == final["total"] == 145
    assert len(first["items"]) == len(final["items"]) == 24
    assert final["items"][0]["id"] == "120"
    assert [item["id"] for item in last["items"]] == ["144"]


def configure(tmp_path: Path, monkeypatch, *, token: str = "test-token") -> tuple[Path, Path]:
    config_root = tmp_path / "config"
    data_root = tmp_path / "data"
    config_root.mkdir()
    data_root.mkdir()
    (config_root / "integrations.json").write_text(
        json.dumps({"picBedUrl": "https://images.example.invalid", "picBedName": "测试图床"}),
        encoding="utf-8",
    )
    (config_root / "secrets.json").write_text(json.dumps({"picBedToken": token}), encoding="utf-8")
    monkeypatch.setattr(picbed, "CONFIG_ROOT", config_root)
    monkeypatch.setattr(picbed, "DATA_ROOT", data_root)
    monkeypatch.setattr(picbed, "ensure_workspace", lambda: tmp_path)
    return config_root, data_root


def upload(filename: str, content: bytes, content_type: str) -> UploadFile:
    return UploadFile(file=BytesIO(content), filename=filename, headers=Headers({"content-type": content_type}))


def test_upload_rejects_missing_configuration(tmp_path: Path, monkeypatch) -> None:
    config_root = tmp_path / "config"
    data_root = tmp_path / "data"
    config_root.mkdir()
    data_root.mkdir()
    monkeypatch.setattr(picbed, "CONFIG_ROOT", config_root)
    monkeypatch.setattr(picbed, "DATA_ROOT", data_root)
    monkeypatch.setattr(picbed, "ensure_workspace", lambda: tmp_path)

    response = asyncio.run(picbed.upload_image(upload("image.png", b"\x89PNG\r\n\x1a\n", "image/png")))
    assert response.status_code == 400
    assert response_json(response)["error"]["code"] == "picbed_not_configured"


def test_upload_rejects_non_image_before_external_call(tmp_path: Path, monkeypatch) -> None:
    configure(tmp_path, monkeypatch)
    response = asyncio.run(picbed.upload_image(upload("notes.txt", b"not an image", "text/plain")))
    assert response.status_code == 415
    assert response_json(response)["error"]["code"] == "invalid_image"


def test_upload_uses_server_secret_and_registers_asset(tmp_path: Path, monkeypatch) -> None:
    _, data_root = configure(tmp_path, monkeypatch)
    captured: dict = {}

    class FakeResponse:
        status_code = 200
        is_success = True

        @staticmethod
        def json():
            return [{"src": "/file/uploaded.png"}]

    class FakeClient:
        def __init__(self, **kwargs):
            captured["client"] = kwargs

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def post(self, url, **kwargs):
            captured["url"] = url
            captured["headers"] = kwargs["headers"]
            captured["files"] = kwargs["files"]
            return FakeResponse()

    monkeypatch.setattr(httpx, "AsyncClient", FakeClient)
    response = asyncio.run(picbed.upload_image(
        upload("头像.png", b"\x89PNG\r\n\x1a\ncontent", "image/png"),
        width=640,
        height=640,
        alt="云月头像",
    ))
    payload = response_json(response)

    assert response.status_code == 201
    assert payload["data"]["url"] == "https://images.example.invalid/file/uploaded.png"
    assert payload["data"]["width"] == 640
    assert captured["headers"] == {"Authorization": "Bearer test-token"}
    assert captured["url"] == "https://images.example.invalid/upload?uploadNameType=origin"
    assert captured["files"]["file"][0] == "头像.png"
    assert "test-token" not in json.dumps(payload)
    stored = json.loads((data_root / "media.json").read_text(encoding="utf-8"))
    assert stored[0]["alt"] == "云月头像"


def test_private_remote_url_is_rejected() -> None:
    for value in ("http://127.0.0.1/image.png", "http://10.0.0.8/image.png", "http://localhost/image.png"):
        try:
            picbed.validate_public_url(value)
        except ValueError:
            continue
        raise AssertionError(f"private URL was accepted: {value}")


def test_upload_url_preserves_channel_and_requests_original_name() -> None:
    assert picbed.upload_url("https://images.example.invalid/upload?uploadChannel=telegram&uploadNameType=default") == (
        "https://images.example.invalid/upload?uploadChannel=telegram&uploadNameType=origin"
    )


def test_empty_upload_probe_404_does_not_claim_endpoint_missing(tmp_path: Path, monkeypatch) -> None:
    configure(tmp_path, monkeypatch)

    class FakeClient:
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def post(self, *args, **kwargs):
            return httpx.Response(404, text='Not Found')

    monkeypatch.setattr(httpx, 'AsyncClient', FakeClient)
    response = asyncio.run(picbed.test_picbed_connection())
    assert response_json(response)['error']['code'] == 'picbed_probe_inconclusive'
    assert '上传一张图片验证' in response_json(response)['error']['message']
