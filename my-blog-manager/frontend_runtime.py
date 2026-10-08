"""使用独立版本目录构建，成功后才切换启动入口。"""
import hashlib
import json
import re
from pathlib import Path


def source_digest(root):
    root = Path(root)
    paths = [root / name for name in ('package.json', 'package-lock.json', 'next.config.ts', 'tsconfig.json')]
    for name in ('app', 'components', 'context', 'lib'):
        paths.extend(path for path in (root / name).rglob('*') if path.is_file())
    digest = hashlib.sha256()
    for path in sorted(paths):
        if not path.is_file():
            continue
        data = path.read_bytes()
        if path.name == 'tsconfig.json':
            config = json.loads(data)
            # Next 自动增加的构建类型路径不是源码变化，避免每次启动都重建。
            config['include'] = [value for value in config.get('include', []) if not value.startswith('.next')]
            data = json.dumps(config, sort_keys=True).encode()
        digest.update(path.relative_to(root).as_posix().encode())
        digest.update(data)
    return digest.hexdigest()


def build_state(root):
    try:
        state = json.loads((Path(root) / 'workspace/config/frontend-build.json').read_text(encoding='utf-8'))
        return state if isinstance(state, dict) else {}
    except (OSError, ValueError):
        return {}


def active_build_dir(root):
    root = Path(root).resolve()
    name = build_state(root).get('directory', '')
    if isinstance(name, str) and re.fullmatch(r'\.next-desktop-[a-f0-9]{12}', name):
        path = root / name
        if path.resolve().parent == root and (path / 'standalone/server.js').is_file():
            return path
    return root / '.next'


def activate_build(root, directory, digest):
    root = Path(root).resolve()
    directory = Path(directory).resolve()
    if directory.parent != root or not re.fullmatch(r'\.next-desktop-[a-f0-9]{12}', directory.name):
        raise ValueError('构建目录必须在当前项目内')
    if not (directory / 'standalone/server.js').is_file():
        raise ValueError('生产构建缺少启动入口，保留原版本')
    from cms_core.workspace import write_json_atomic
    write_json_atomic(root / 'workspace/config/frontend-build.json', {'directory': directory.name, 'sourceDigest': digest})
