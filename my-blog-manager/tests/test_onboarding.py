import json
import subprocess
from pathlib import Path
import pytest
from fastapi import BackgroundTasks
from cms_core import workspace as ws
from cms_core.api import onboarding as setup

@pytest.fixture
def isolated(tmp_path, monkeypatch):
    for name, relative in {'MANAGER_ROOT': '.', 'WORKSPACE_ROOT': 'workspace', 'CONFIG_ROOT': 'workspace/config',
                           'DATA_ROOT': 'workspace/data', 'CONTENT_ROOT': 'workspace/content',
                           'DRAFTS_ROOT': 'workspace/drafts', 'PLANS_ROOT': 'workspace/plans', 'JOBS_ROOT': 'workspace/jobs'}.items():
        monkeypatch.setattr(ws, name, tmp_path / relative)
    ws.ensure_workspace()
    monkeypatch.setattr(setup.cloud_content, 'status', lambda: {'enabled': False})
    setup.jobs.clear()
    return tmp_path

@pytest.mark.parametrize('url', ['file:///tmp/blog', 'https://token@github.com/a/blog',
                                 'https://github.com.evil.invalid/a/blog', 'https://github.com/a/../',
                                 'https://github.com/a/blog?token=x', 'http://github.com/a/blog'])
def test_repository_rejects_local_paths_credentials_and_other_hosts(url):
    with pytest.raises(ValueError): setup.repository_url(url)

def test_repository_normalizes_https():
    assert setup.repository_url('https://github.com/test/my-blog.git') == 'https://github.com/test/my-blog.git'

def test_packaged_start_does_not_import_author_content(isolated, monkeypatch):
    (isolated / 'posts').mkdir()
    (isolated / 'posts/private.md').write_text('作者旧稿', encoding='utf-8')
    monkeypatch.setenv('YUNYUE_PACKAGED', '1')
    assert ws.import_legacy_content()['copied'] == []
    assert not (ws.CONTENT_ROOT / 'posts/private.md').exists()

def test_new_template_has_no_author_articles_images_music_or_contact(tmp_path):
    (tmp_path / 'src/data').mkdir(parents=True)
    ws.write_json_atomic(tmp_path / 'src/data/site.json', {'title': '旧作者', 'social': {'email': 'private@example.invalid'}, 'musicTracks': [{'id': '1'}]})
    for folder in ('posts', 'chatters', 'moments', 'public/images', 'public/lyrics', 'content'):
        (tmp_path / folder).mkdir(parents=True)
        (tmp_path / folder / ('about.md' if folder == 'content' else 'old.md')).write_text('旧内容')
    setup.neutralize(tmp_path, setup.Connect(mode='new', title='新博客', author='新作者'))
    assert ws.read_json(tmp_path / 'src/data/site.json', {})['social'] == {'github': '', 'email': ''}
    assert ws.read_json(tmp_path / 'src/data/music.json', {}) == {'version': 1, 'tracks': {}}
    assert not list((tmp_path / 'posts').glob('*.md'))
    assert not (tmp_path / 'public/images/old.md').exists()
    assert '旧内容' not in (tmp_path / 'content/about.md').read_text(encoding='utf-8')

def test_neutral_template_has_valid_domain_and_typed_empty_collections(tmp_path):
    (tmp_path / 'src/data').mkdir(parents=True)
    (tmp_path / 'src/pages').mkdir()
    (tmp_path / 'astro.config.mjs').write_text("export default {site: 'https://old.example'};", encoding='utf-8')
    page = tmp_path / 'src/pages/index.astro'
    page.write_text("import projects from '../data/projects.json';\nimport site from '../data/site.json';", encoding='utf-8')
    for _ in range(2):
        setup.neutralize(tmp_path, setup.Connect(mode='new'))
    assert ws.read_json(tmp_path / 'src/data/site.json', {})['siteUrl'] == 'https://example.com'
    assert 'template-projects' in page.read_text()
    assert 'template-site' in page.read_text()
    assert 'tags: string[]' in (tmp_path / 'src/data/template-projects.ts').read_text()
    assert (tmp_path / 'astro.config.mjs').read_text().count('import publicSite ') == 1

def test_already_connected_workspace_cannot_be_replaced(isolated):
    ws.write_json_atomic(ws.CONFIG_ROOT / 'onboarding.json', {'completed': True})
    response = setup.start_connect(setup.Connect(mode='existing', repository='https://github.com/test/blog'), BackgroundTasks())
    assert response.status_code == 409
    assert not setup.lock.locked()

def test_no_push_permission_stops_before_clone(isolated, monkeypatch):
    monkeypatch.setattr(setup, 'account', lambda: {'login': 'guest', 'id': 1})
    calls = []
    def run(args, **kwargs):
        calls.append(args)
        return json.dumps({'permissions': {'push': False}})
    monkeypatch.setattr(setup, 'run', run)
    setup.jobs['test'] = {'status': 'running'}
    setup.lock.acquire()
    setup.connect(setup.Connect(mode='existing', repository='https://github.com/owner/blog.git'), 'test')
    assert setup.jobs['test']['status'] == 'failed'
    assert all(args[0] != 'git' for args in calls)
    assert not (ws.CONFIG_ROOT / 'deploy.json').exists()

def test_existing_repository_is_cloned_to_new_device_and_configured(isolated, monkeypatch, tmp_path):
    original = tmp_path / 'remote'
    original.mkdir()
    def git(*args): subprocess.run(['git', *args], cwd=original, check=True, capture_output=True)
    git('init', '--initial-branch=main'); git('config', 'user.name', '测试'); git('config', 'user.email', 'test@example.invalid')
    (original / 'package.json').write_text('{"name":"yunyue-blog"}')
    git('add', '.'); git('commit', '-m', '测试内容')
    monkeypatch.setattr(setup, 'account', lambda: {'login': 'test', 'id': 1})
    actual_run = setup.run
    def run(args, **kwargs):
        if args[0] == 'gh': return json.dumps({'permissions': {'push': True}})
        if 'clone' in args:
            args = args.copy(); args[-2] = str(original)
        return actual_run(args, **kwargs)
    monkeypatch.setattr(setup, 'run', run)
    monkeypatch.setattr(setup.cloud_content, 'refresh', lambda **kwargs: {'enabled': True})
    setup.jobs['test'] = {'status': 'running'}
    setup.lock.acquire()
    setup.connect(setup.Connect(mode='existing', repository='https://github.com/test/blog.git'), 'test')
    assert setup.jobs['test']['status'] == 'succeeded'
    config = ws.read_json(ws.CONFIG_ROOT / 'deploy.json', {})
    assert Path(config['blogPath']).is_relative_to(ws.WORKSPACE_ROOT)
    assert Path(config['blogPath'], 'package.json').exists()
    assert ws.read_json(ws.CONFIG_ROOT / 'onboarding.json', {})['completed'] is True
