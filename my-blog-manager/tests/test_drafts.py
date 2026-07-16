from __future__ import annotations

import json
from pathlib import Path

import pytest

from cms_core.api import drafts


def response_json(response) -> dict:
    return json.loads(response.body.decode("utf-8"))


@pytest.fixture
def draft_workspace(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> tuple[Path, Path]:
    workspace = tmp_path / "workspace"
    content = workspace / "content"
    draft_root = workspace / "drafts"
    for folder in (content / "posts", content / "chatters", draft_root):
        folder.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(drafts, "WORKSPACE_ROOT", workspace)
    monkeypatch.setattr(drafts, "CONTENT_ROOT", content)
    monkeypatch.setattr(drafts, "DRAFTS_ROOT", draft_root)
    monkeypatch.setattr(drafts, "ensure_workspace", lambda: workspace)
    return content, draft_root


def test_draft_round_trip_and_list_preview(draft_workspace: tuple[Path, Path]) -> None:
    _, draft_root = draft_workspace
    response = drafts.save_draft(drafts.DraftPayload(
        id="draft_test",
        type="post",
        title="测试草稿",
        content="<p>仅保存在本机的完整正文</p>",
        tags=["测试"],
    ))
    assert response.status_code == 201
    assert (draft_root / "draft_test.json").is_file()

    listed = response_json(drafts.list_drafts())["data"]["drafts"]
    assert listed[0]["contentPreview"] == "仅保存在本机的完整正文"
    assert "content" not in listed[0]

    loaded = response_json(drafts.get_draft(drafts.DraftLookup(id="draft_test", type="post")))["data"]["draft"]
    assert loaded["content"] == "<p>仅保存在本机的完整正文</p>"


def test_delete_only_removes_draft_copy(draft_workspace: tuple[Path, Path]) -> None:
    content, draft_root = draft_workspace
    published = content / "posts" / "post_keep.md"
    published.write_text("---\ntitle: 已发布\n---\n正文\n", encoding="utf-8")
    (draft_root / "post_keep.json").write_text(json.dumps({"id": "post_keep"}), encoding="utf-8")

    response = drafts.remove_draft("post_keep")

    assert response.status_code == 200
    assert not (draft_root / "post_keep.json").exists()
    assert published.is_file()


def test_get_published_markdown_when_draft_is_missing(draft_workspace: tuple[Path, Path]) -> None:
    content, _ = draft_workspace
    published = content / "chatters" / "note_test.md"
    published.write_text("---\ntitle: 随笔\ntags: [生活]\n---\n## 标题\n\n正文\n", encoding="utf-8")

    response = drafts.get_draft(drafts.DraftLookup(id="note_test", type="chatter"))
    payload = response_json(response)["data"]["draft"]

    assert payload["published"] is True
    assert payload["title"] == "随笔"
    assert "<h2>标题</h2>" in payload["content"]


def test_draft_id_cannot_escape_workspace(draft_workspace: tuple[Path, Path]) -> None:
    response = drafts.get_draft(drafts.DraftLookup(id="../secret", type="post"))

    assert response.status_code == 400
    assert response_json(response)["error"]["code"] == "draft_read_failed"
