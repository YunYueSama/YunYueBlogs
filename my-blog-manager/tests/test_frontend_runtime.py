import json
from pathlib import Path
import subprocess
import pytest
from frontend_runtime import active_build_dir, source_digest, activate_build
import run_me


def sources(root):
    (root / 'app').mkdir()
    (root / 'app/page.tsx').write_text('export default 1')
    (root / 'tsconfig.json').write_text('{"include":["**/*.ts"]}')


def test_build_never_replaces_running_directory_and_reuses_success(tmp_path, monkeypatch):
    sources(tmp_path)
    old = tmp_path / '.next/standalone/server.js'
    old.parent.mkdir(parents=True)
    old.write_text('running old version')
    monkeypatch.chdir(tmp_path)
    calls = []
    def build(command, env):
        calls.append(env['YUNYUE_BUILD_DIR'])
        assert env['YUNYUE_BUILD_DIR'] != '.next'
        server = tmp_path / env['YUNYUE_BUILD_DIR'] / 'standalone/server.js'
        server.parent.mkdir(parents=True)
        server.write_text('new version')
    monkeypatch.setattr(run_me.subprocess, 'check_call', build)
    assert run_me.ensure_frontend_build()
    assert old.read_text() == 'running old version'
    assert active_build_dir(tmp_path).name == calls[0]
    assert run_me.ensure_frontend_build()
    assert len(calls) == 1


def test_failed_update_preserves_active_version(tmp_path, monkeypatch):
    sources(tmp_path)
    directory = tmp_path / '.next-desktop-0123456789ab'
    (directory / 'standalone').mkdir(parents=True)
    (directory / 'standalone/server.js').write_text('valid')
    activate_build(tmp_path, directory, source_digest(tmp_path))
    (tmp_path / 'app/page.tsx').write_text('new source')
    monkeypatch.chdir(tmp_path)
    def fail(*args, **kwargs):
        raise subprocess.CalledProcessError(1, 'build')
    monkeypatch.setattr(run_me.subprocess, 'check_call', fail)
    assert not run_me.ensure_frontend_build()
    assert active_build_dir(tmp_path) == directory


def test_generated_type_paths_do_not_trigger_rebuild(tmp_path):
    sources(tmp_path)
    before = source_digest(tmp_path)
    (tmp_path / 'tsconfig.json').write_text(json.dumps({'include': ['**/*.ts', '.next-desktop-0123456789ab/types/**/*.ts']}))
    assert source_digest(tmp_path) == before
    with pytest.raises(ValueError):
        activate_build(tmp_path, tmp_path.parent / 'outside', before)
