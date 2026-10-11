import json

from cms_core.api import deploy


def test_recent_jobs_restore_status_without_repository_paths(tmp_path, monkeypatch):
    monkeypatch.setattr(deploy, 'JOBS_ROOT', tmp_path)
    for index in range(12):
        deploy.write_json_atomic(tmp_path / f'{index}.json', {
            'jobId': str(index), 'status': 'running' if index == 11 else 'succeeded',
            'message': '正在推送' if index == 11 else '已推送 GitHub', 'createdAt': index,
            'paths': ['private-workspace-path'],
        })
    result = json.loads(deploy.recent_jobs().body)['data']['jobs']
    assert len(result) == 10
    assert any(job['status'] == 'running' for job in result)
    assert all('paths' not in job for job in result)
