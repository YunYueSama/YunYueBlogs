import json
import threading
from concurrent.futures import ThreadPoolExecutor

import pytest

from cms_core import workspace


def test_concurrent_writers_publish_complete_json_without_sharing_temp(tmp_path, monkeypatch):
    path = tmp_path / 'settings.json'
    serialize = workspace.json.dumps
    ready = threading.Barrier(8)

    def simultaneous_serialize(*args, **kwargs):
        ready.wait(timeout=5)
        return serialize(*args, **kwargs)

    monkeypatch.setattr(workspace.json, 'dumps', simultaneous_serialize)
    with ThreadPoolExecutor(max_workers=8) as workers:
        list(workers.map(lambda index: workspace.write_json_atomic(path, {'index': index, 'text': '夜色' * 1000}), range(8)))
    stored = json.loads(path.read_text(encoding='utf-8'))
    assert stored['index'] in range(8)
    assert stored['text'] == '夜色' * 1000
    assert sorted(item.name for item in tmp_path.iterdir()) == ['settings.json']


def test_failed_replace_preserves_original_and_cleans_temp(tmp_path, monkeypatch):
    path = tmp_path / 'settings.json'
    path.write_text('{"saved": true}', encoding='utf-8')

    def unavailable(*args):
        raise PermissionError('文件暂不可写')

    monkeypatch.setattr(workspace.os, 'replace', unavailable)
    with pytest.raises(PermissionError):
        workspace.write_json_atomic(path, {'saved': False})
    assert json.loads(path.read_text(encoding='utf-8')) == {'saved': True}
    assert sorted(item.name for item in tmp_path.iterdir()) == ['settings.json']
