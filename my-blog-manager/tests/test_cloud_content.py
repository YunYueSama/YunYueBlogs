import json
import subprocess
from pathlib import Path
import pytest
from cms_core import cloud_content as cloud, workspace as ws
from cms_core.api import sync

def git(root, *args):
    return subprocess.run(['git', *args], cwd=root, check=True, capture_output=True).stdout.decode().strip()

@pytest.fixture
def devices(tmp_path, monkeypatch):
    remote = tmp_path / 'remote.git'
    remote.mkdir()
    git(remote, 'init', '--bare', '--initial-branch=main')
    first = tmp_path / 'blog'
    git(tmp_path, 'clone', str(remote), str(first))
    git(first, 'config', 'user.name', '同步测试')
    git(first, 'config', 'user.email', 'test@example.invalid')
    (first / 'src/data').mkdir(parents=True)
    (first / 'posts').mkdir()
    (first / 'package.json').write_text('{"name":"yunyue-blog"}')
    (first / 'src/data/site.json').write_text('{"musicIds":["1","2"]}')
    (first / 'posts/new.md').write_text('服务器文章', encoding='utf-8')
    git(first, 'add', '.'); git(first, 'commit', '-m', '服务器基线'); git(first, 'push', 'origin', 'main')
    second = tmp_path / 'second'
    git(tmp_path, 'clone', str(remote), str(second))
    git(second, 'config', 'user.name', '其他设备')
    git(second, 'config', 'user.email', 'test@example.invalid')
    root = tmp_path / 'workspace'
    content, data, config = root / 'content', root / 'data', root / 'config'
    for path in (content / 'posts', content / 'chatters', content / 'moments', data, config):
        path.mkdir(parents=True, exist_ok=True)
    (content / 'posts/old.md').write_text('过期本地文章', encoding='utf-8')
    (data / 'site.json').write_text('{"musicIds":["old"]}')
    ws.write_json_atomic(config / 'deploy.json', {'blogPath': str(first), 'remote': 'origin', 'branch': 'main'})
    for module in (ws, sync):
        monkeypatch.setattr(module, 'CONTENT_ROOT', content)
        monkeypatch.setattr(module, 'DATA_ROOT', data)
    monkeypatch.setattr(ws, 'WORKSPACE_ROOT', root)
    monkeypatch.setattr(ws, 'CONFIG_ROOT', config)
    monkeypatch.setattr(cloud, '_last_check', 0)
    monkeypatch.setattr(sync, 'ensure_workspace', lambda: root)
    return first, second, content, data

def publish(root, file, content):
    path = root / file
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding='utf-8')
    git(root, 'add', '.'); git(root, 'commit', '-m', '其他设备更新'); git(root, 'push', 'origin', 'main')

def test_first_connection_prefers_server_and_backs_up_old_cache(devices):
    first, second, content, data = devices
    state = cloud.refresh(connect=True)
    assert (content / 'posts/new.md').read_text(encoding='utf-8') == '服务器文章'
    assert not (content / 'posts/old.md').exists()
    assert (Path(state['backup']) / 'content/posts/old.md').read_text(encoding='utf-8') == '过期本地文章'
    assert json.loads((data / 'site.json').read_text())['musicIds'] == ['1', '2']

def test_other_device_updates_preserve_unrelated_pending_music_and_reject_old_revision(devices):
    first, second, content, data = devices
    old = cloud.refresh(connect=True)['revision']
    (data / 'site.json').write_text('{"musicIds":["1"]}')
    publish(second, 'posts/new.md', '其他设备的新正文')
    state = cloud.refresh(force=True)
    assert state['revision'] != old
    assert (content / 'posts/new.md').read_text(encoding='utf-8') == '其他设备的新正文'
    assert json.loads((data / 'site.json').read_text())['musicIds'] == ['1']
    with pytest.raises(RuntimeError, match='其他设备'):
        cloud.require_revision(old)

def test_conflict_prefers_server_and_keeps_backup(devices):
    first, second, content, data = devices
    cloud.refresh(connect=True)
    (data / 'site.json').write_text('{"musicIds":["local"]}')
    publish(second, 'src/data/site.json', '{"musicIds":["server"]}')
    state = cloud.refresh(force=True)
    assert json.loads((data / 'site.json').read_text())['musicIds'] == ['server']
    assert json.loads((Path(state['backup']) / 'data/site.json').read_text())['musicIds'] == ['local']

def test_old_browser_write_is_rejected_before_handler_and_has_cors(devices):
    from fastapi.testclient import TestClient
    from cms_core.main import app
    first, second, content, data = devices
    revision = cloud.refresh(connect=True)['revision']
    publish(second, 'src/data/site.json', '{"musicIds":["new-server"]}')
    with TestClient(app) as client:
        response = client.post('/api/settings/music', json={'musicIds':['stale']}, headers={
            'Origin':'http://127.0.0.1:3000', 'X-YunYue-Revision':revision})
    assert response.status_code == 409
    assert response.headers['access-control-allow-origin'] == 'http://127.0.0.1:3000'
    assert json.loads((data / 'site.json').read_text())['musicIds'] == ['new-server']


def test_preview_ignores_windows_checkout_line_endings(tmp_path):
    server = tmp_path / 'server.md'
    checkout = tmp_path / 'checkout.md'
    server.write_bytes('---\n标题\n---\n正文\n'.encode('utf-8'))
    checkout.write_bytes(server.read_bytes().replace(b'\n', b'\r\n'))
    assert sync.file_digest(server) == sync.file_digest(checkout)
    checkout.write_bytes(checkout.read_bytes() + '新内容'.encode('utf-8'))
    assert sync.file_digest(server) != sync.file_digest(checkout)


def test_unchanged_remote_skips_object_reads_and_preserves_pending_edits(devices, monkeypatch):
    first, second, content, data = devices
    cloud.refresh(connect=True)
    path = data / 'site.json'
    path.write_text('{"musicIds":["pending"]}')
    modified = path.stat().st_mtime_ns
    commands = []
    original = cloud._git
    def observed(target, *args, **kwargs):
        commands.append(args[0])
        return original(target, *args, **kwargs)
    monkeypatch.setattr(cloud, '_git', observed)
    cloud.refresh(force=True)
    assert commands == ['fetch', 'rev-parse']
    assert path.stat().st_mtime_ns == modified
    assert json.loads(path.read_text())['musicIds'] == ['pending']


def test_batch_read_preserves_multiline_unicode_and_binary_lengths(devices):
    first, second, content, data = devices
    cloud.refresh(connect=True)
    text = '标题\n正文\n\n中文与 emoji 🎵\n'
    publish(second, 'posts/new.md', text)
    cloud.refresh(force=True)
    assert (content / 'posts/new.md').read_bytes() == text.encode('utf-8')


def test_local_queue_autosave_does_not_fetch_remote(devices, monkeypatch):
    from fastapi.testclient import TestClient
    from cms_core.main import app
    from cms_core.api import operations
    cloud.refresh(connect=True)
    monkeypatch.setattr(operations, 'OPERATIONS_FILE', ws.WORKSPACE_ROOT / 'operations.json')
    def forbidden(*args, **kwargs):
        raise AssertionError('本机队列自动保存不应同步远程')
    monkeypatch.setattr(cloud, 'require_revision', forbidden)
    monkeypatch.setattr(cloud, 'refresh', forbidden)
    with TestClient(app) as client:
        response = client.put('/api/operations', json={'operations': []})
    assert response.status_code == 200
