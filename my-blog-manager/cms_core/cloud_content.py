"""以远程博客仓库为内容源，本地仅保存可回滚缓存与待发布修改。"""
from __future__ import annotations
import hashlib
import os
import re
import shutil
import subprocess
import threading
import time
from pathlib import Path
from cms_core import workspace as ws

LOCK = threading.RLock()
_last_check = 0.0

def state_path():
    return ws.CONFIG_ROOT / 'cloud-content.json'

def status():
    state = ws.read_json(state_path(), {})
    return {key: state.get(key) for key in ('enabled', 'revision', 'checkedAt', 'backup', 'remote', 'branch')}

def _git(target, *args):
    try:
        result = subprocess.run(['git', *args], cwd=target, capture_output=True, timeout=45)
    except subprocess.TimeoutExpired as error:
        raise RuntimeError('服务器同步超时，已停止操作，请稍后重试。') from error
    if result.returncode:
        raise RuntimeError('无法同步远程内容，请检查 GitHub 网络和仓库权限。')
    return result.stdout

def _settings():
    config = ws.read_json(ws.CONFIG_ROOT / 'deploy.json', {})
    target = Path(config.get('blogPath', '')).resolve()
    from cms_core.api.sync import validate_blog_path
    valid, error = validate_blog_path(str(target))
    if error:
        raise RuntimeError(error)
    remote, branch = config.get('remote', 'origin'), config.get('branch', 'main')
    if not re.fullmatch(r'[A-Za-z0-9_.-]+', remote) or not re.fullmatch(r'[A-Za-z0-9_./-]+', branch) or '..' in branch:
        raise RuntimeError('远程仓库或分支配置无效。')
    return valid, remote, branch

def _cache_path(relative):
    if re.fullmatch(r'(posts|chatters|moments)/[A-Za-z0-9_-]+\.md', relative):
        return ws.CONTENT_ROOT / relative
    if relative == 'content/about.md':
        return ws.CONTENT_ROOT / 'about.md'
    if re.fullmatch(r'src/data/(site|albums|friends|projects|music)\.json', relative):
        return ws.DATA_ROOT / Path(relative).name
    return None

def _hash(data):
    return hashlib.sha256(data).hexdigest() if data is not None else None

def _local():
    from cms_core.api.sync import source_files
    return {name: path.read_bytes() for name, path in source_files().items()}

def _remote(target, remote, branch):
    _git(target, 'fetch', remote, branch)
    revision = _git(target, 'rev-parse', f'refs/remotes/{remote}/{branch}').decode().strip()
    if not re.fullmatch(r'[a-f0-9]{40,64}', revision):
        raise RuntimeError('远程版本无效。')
    files = {}
    tree = _git(target, 'ls-tree', '-r', revision).decode('utf-8')
    for line in tree.splitlines():
        info, relative = line.split('\t', 1)
        if _cache_path(relative) is not None:
            if not info.startswith('100644 ') and not info.startswith('100755 '):
                raise RuntimeError('服务器内容包含不支持的链接文件。')
            files[relative] = _git(target, 'show', f'{revision}:{relative}')
    if 'src/data/site.json' not in files:
        raise RuntimeError('远程博客缺少站点配置，已停止同步。')
    return revision, files

def _backup():
    directory = ws.WORKSPACE_ROOT / 'backups' / ('cloud-' + str(time.time_ns()))
    directory.mkdir(parents=True)
    for name in ('content', 'data'):
        source = ws.WORKSPACE_ROOT / name
        if source.exists():
            shutil.copytree(source, directory / name)
    return str(directory)

def refresh(force=False, connect=False):
    global _last_check
    with LOCK:
        state = ws.read_json(state_path(), {})
        if not connect and not state.get('enabled'):
            return status()
        if not force and not connect and time.monotonic() - _last_check < 15:
            return status()
        target, remote, branch = _settings()
        revision, remote_files = _remote(target, remote, branch)
        local = _local()
        first = connect or not state.get('revision')
        base = state.get('baseFiles', {})
        backup = state.get('backup')
        merged = {}
        conflicts = []
        for name in set(remote_files) | set(local) | set(base):
            current, server = local.get(name), remote_files.get(name)
            changed_local = _hash(current) != base.get(name)
            changed_server = _hash(server) != base.get(name)
            if first or not changed_local:
                chosen = server
            elif changed_server and current != server:
                # 冲突时服务器优先，旧本地版本先备份，不能反向覆盖服务器。
                conflicts.append(name)
                chosen = server
            else:
                chosen = current
            merged[name] = chosen
        if first or conflicts:
            backup = _backup()
        previous = dict(local)
        try:
            for name, data in merged.items():
                destination = _cache_path(name)
                if destination is None:
                    continue
                if data is None:
                    destination.unlink(missing_ok=True)
                else:
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    temporary = destination.with_suffix(destination.suffix + '.cloud-tmp')
                    temporary.write_bytes(data)
                    os.replace(temporary, destination)
            state = {'enabled': True, 'revision': revision, 'remote': remote, 'branch': branch,
                     'baseFiles': {name: _hash(data) for name, data in remote_files.items()},
                     'checkedAt': int(time.time()), 'backup': backup}
            ws.write_json_atomic(state_path(), state)
        except Exception:
            for name in merged:
                path = _cache_path(name)
                if path is None:
                    continue
                if name in previous:
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_bytes(previous[name])
                else:
                    path.unlink(missing_ok=True)
            raise
        # 博客源码同步到同一基线，绝不重置脏工作区或分叉的分支。
        from cms_core.api.sync import git_changes
        if not git_changes(target):
            head = _git(target, 'rev-parse', 'HEAD').decode().strip()
            if head != revision:
                try:
                    _git(target, 'merge', '--ff-only', revision)
                except RuntimeError:
                    raise RuntimeError('博客源码与服务器分支存在分叉，请先处理本地提交后再发布。')
        _last_check = time.monotonic()
        return status()

def require_revision(expected):
    current = refresh(force=True)
    if current.get('enabled') and expected != current.get('revision'):
        raise RuntimeError('服务器内容已被其他设备更新，请刷新页面查看最新版本后再保存或发布。')
