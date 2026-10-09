import json
from pathlib import Path

import pytest
from fastapi import BackgroundTasks
from pydantic import ValidationError

from cms_core.api import robin


@pytest.fixture
def storage(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(robin, 'CONFIG_ROOT', tmp_path)
    monkeypatch.setattr(robin, 'JOBS_ROOT', tmp_path)
    monkeypatch.setattr(robin, 'ensure_workspace', lambda: tmp_path)
    return tmp_path


def data(response):
    return json.loads(response.body)


def test_keys_are_write_only_and_blank_preserves_existing(storage):
    robin.save_config(robin.RobinUpdate(apiKey='private-fixture'))
    response = robin.save_config(robin.RobinUpdate())
    assert 'private-fixture' not in response.body.decode()
    assert data(response)['data']['apiKeyConfigured'] is True
    assert data(response)['data']['fastModel'] == 'deepseek-flash'
    assert json.loads((storage / 'secrets.json').read_text(encoding='utf-8'))['robinApiKey'] == 'private-fixture'
    robin.save_config(robin.RobinUpdate(apiKey=''))
    assert data(robin.get_config())['data']['apiKeyConfigured'] is False


def test_old_local_model_configuration_is_ignored(storage):
    (storage / 'robin.json').write_text(json.dumps({'fastModel': 'deepseek-v4-pro', 'deepModel': 'deepseek-v4-pro', 'baseUrl': 'https://other.example'}))
    assert robin.local_config().fastModel == 'deepseek-flash'
    assert robin.local_config().deepModel == 'deepseek-flash'
    with pytest.raises(ValidationError):
        robin.RobinUpdate(deepModel='deepseek-v4-pro')


@pytest.mark.parametrize('url', ['http://example.com', 'https://127.0.0.1', 'https://user:pass@example.com', 'https://example.com?token=x'])
def test_invalid_endpoint_is_rejected(url):
    with pytest.raises(ValidationError):
        robin.RobinConfig(baseUrl=url)


def test_cloud_status_exposes_only_config_and_key_presence(monkeypatch):
    envs = [{'key': 'DEEPSEEK_API_KEY', 'value': 'secret', 'target': ['production']}, {'key': 'ROBIN_AI_FAST_MODEL', 'value': 'custom-model', 'target': ['production']}, {'key': 'UNRELATED_TOKEN', 'value': 'other-secret', 'target': ['production']}]
    monkeypatch.setattr(robin, 'cli', lambda *a, **kw: json.dumps({'envs': envs}))
    result = robin.cloud_config(Path('.'), {'projectName': 'blog', 'projectId': 'prj_test'})
    assert result['apiKeyConfigured'] is True
    assert result['fastModel'] == 'deepseek-flash'
    assert 'secret' not in json.dumps(result)


def test_old_encrypted_model_is_ignored_without_decrypting_values(monkeypatch):
    calls = []
    def command(path, linked, args):
        calls.append(args)
        if args[1].startswith('/v9/'):
            return json.dumps({'envs': [
                {'key': 'ROBIN_AI_FAST_MODEL', 'value': 'ciphertext', 'type': 'encrypted', 'id': 'env_model', 'target': ['production']},
                {'key': 'DEEPSEEK_API_KEY', 'value': 'private-ciphertext', 'type': 'encrypted', 'id': 'env_secret', 'target': ['production']},
            ]})
        return json.dumps({'key': 'ROBIN_AI_FAST_MODEL', 'value': 'actual-model'})
    monkeypatch.setattr(robin, 'cli', command)
    result = robin.cloud_config(Path('.'), {'projectName': 'blog', 'projectId': 'prj_test'})
    assert result['fastModel'] == 'deepseek-flash'
    assert result['apiKeyConfigured'] is True
    assert len(calls) == 1
    assert all('env_secret' not in args[1] for args in calls)
    assert 'ciphertext' not in json.dumps(result)


def test_sync_failure_never_leaks_key_or_starts_deployment(storage, monkeypatch):
    calls = []
    def command(path, linked, args, **kwargs):
        calls.append(args)
        if args[0] == 'env' and args[2] == 'ROBIN_AI_API_KEY':
            raise RuntimeError('CLI echoed private-fixture')
        return ''
    monkeypatch.setattr(robin, 'cli', command)
    robin.sync_lock.acquire()
    robin.run_sync('test', storage, {}, robin.RobinConfig(), 'private-fixture')
    job = json.loads((storage / 'test.json').read_text(encoding='utf-8'))
    assert job['status'] == 'failed'
    assert 'private-fixture' not in json.dumps(job)
    assert not any(call[0] == 'redeploy' for call in calls)
    assert not robin.sync_lock.locked()


def test_sync_reuses_server_key_and_uses_latest_server_deployment(storage, monkeypatch):
    calls = []
    def command(path, linked, args, **kwargs):
        calls.append((args, kwargs))
        if args[0] == 'list':
            return json.dumps({'deployments': [{'url': 'blog-current.vercel.app', 'state': 'READY'}]})
        if args[0] == 'redeploy':
            return 'https://blog-new.vercel.app\n'
        if args[0] == 'inspect':
            return json.dumps({'readyState': 'READY'})
        return ''
    monkeypatch.setattr(robin, 'cli', command)
    monkeypatch.setattr(robin, 'project', lambda: (storage, {'projectName': 'blog'}))
    monkeypatch.setattr(robin, 'cloud_config', lambda *args: {'apiKeyConfigured': True, 'baseUrl': 'https://api.deepseek.com'})
    tasks = BackgroundTasks()
    assert robin.synchronize(tasks).status_code == 202
    task = tasks.tasks[0]
    task.func(*task.args, **task.kwargs)
    assert not any(args[0] == 'env' for args, _ in calls)
    assert any(args[:2] == ['redeploy', 'blog-current.vercel.app'] for args, _ in calls)
    assert 'private-fixture' not in json.dumps(calls)
    job = json.loads(next(storage.glob('*.json')).read_text(encoding='utf-8'))
    assert job['status'] == 'succeeded'
