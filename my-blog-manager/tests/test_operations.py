from __future__ import annotations

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from cms_core.api import friends, gallery, moments, operations, projects
from cms_core.workspace import read_json
from cms_core import workspace as ws


def response_json(response) -> dict:
    return json.loads(response.body.decode("utf-8"))


@pytest.fixture
def operation_workspace(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    workspace = tmp_path / "workspace"
    content = workspace / "content"
    data = workspace / "data"
    for path in (content / "posts", content / "chatters", content / "moments", data):
        path.mkdir(parents=True, exist_ok=True)
    ensure = lambda: workspace
    monkeypatch.setattr(operations, "WORKSPACE_ROOT", workspace)
    monkeypatch.setattr(operations, "CONTENT_ROOT", content)
    monkeypatch.setattr(operations, "DATA_ROOT", data)
    monkeypatch.setattr(operations, "OPERATIONS_FILE", workspace / "operations.json")
    monkeypatch.setattr(operations, "ensure_workspace", ensure)
    # 临时工作区不能读取开发机真实的云端连接与版本配置。
    monkeypatch.setattr(ws, "CONFIG_ROOT", workspace / 'config')
    monkeypatch.setattr(projects, "DATA_ROOT", data)
    monkeypatch.setattr(projects, "ensure_workspace", ensure)
    monkeypatch.setattr(gallery, "DATA_ROOT", data)
    monkeypatch.setattr(gallery, "ensure_workspace", ensure)
    monkeypatch.setattr(friends, "DATA_ROOT", data)
    monkeypatch.setattr(friends, "ensure_workspace", ensure)
    monkeypatch.setattr(moments, "CONTENT_ROOT", content)
    monkeypatch.setattr(moments, "ensure_workspace", ensure)
    return workspace


def test_discriminated_queue_applies_to_workspace(operation_workspace: Path) -> None:
    queue = operations.OperationList.model_validate({"operations": [
        {
            "id": "op_content", "type": "content_upsert", "label": "发布测试文章", "timestamp": "2026-07-15T10:00:00+08:00",
            "payload": {"id": "post_test", "type": "post", "title": "测试文章", "tags": ["测试"], "content": "<h2>正文</h2><p>内容</p>", "published": True},
        },
        {
            "id": "op_projects", "type": "projects_update", "label": "更新项目", "timestamp": "2026-07-15T10:01:00+08:00",
            "payload": {"projects": [{"id": "project_test", "name": "测试项目", "description": "描述", "icon": "Code", "githubUrl": "https://github.com/example/project", "tags": ["Astro"]}]},
        },
        {
            "id": "op_moment", "type": "moment_upsert", "label": "发布说说", "timestamp": "2026-07-15T10:02:00+08:00",
            "payload": {"id": "moment_test", "date": "2026-07-15T10:02:00+08:00", "content": "今天完成了队列重构。", "location": "本地", "images": []},
        },
    ]})
    operations.save_operations(queue)

    response = operations.apply_operations()
    payload = response_json(response)

    assert payload["ok"] is True
    assert payload["data"]["count"] == 3
    assert "## 正文" in (operation_workspace / "content" / "posts" / "post_test.md").read_text(encoding="utf-8")
    assert read_json(operation_workspace / "data" / "projects.json", [])[0]["id"] == "project_test"
    assert (operation_workspace / "content" / "moments" / "moment_test.md").is_file()
    assert read_json(operation_workspace / "operations.json", {}) == {"operations": []}


def test_operation_failure_rolls_back_all_files(operation_workspace: Path) -> None:
    project_file = operation_workspace / "data" / "projects.json"
    project_file.write_text('[{"id":"original"}]\n', encoding="utf-8")
    queue = operations.OperationList.model_validate({"operations": [
        {
            "id": "op_projects", "type": "projects_update", "label": "更新项目", "timestamp": "2026-07-15T10:01:00+08:00",
            "payload": {"projects": [{"id": "project_test", "name": "测试项目", "githubUrl": "https://github.com/example/project"}]},
        },
        {
            "id": "op_settings", "type": "settings_update", "label": "错误设置", "timestamp": "2026-07-15T10:02:00+08:00",
            "payload": {"values": {"picBedToken": "must-not-enter-public-settings"}},
        },
    ]})
    operations.save_operations(queue)

    response = operations.apply_operations()
    payload = response_json(response)

    assert response.status_code == 500
    assert payload["error"]["code"] == "operation_apply_failed"
    assert read_json(project_file, [])[0]["id"] == "original"
    assert len(read_json(operation_workspace / "operations.json", {})["operations"]) == 2


def test_operation_payload_is_selected_by_discriminator() -> None:
    with pytest.raises(ValidationError):
        operations.OperationList.model_validate({"operations": [{
            "id": "bad", "type": "projects_update", "label": "错误任务", "timestamp": "now", "payload": {"albums": []},
        }]})
