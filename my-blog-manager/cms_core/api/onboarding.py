"""新设备接入：凭据由 GitHub CLI 保管，仓库仅写入当前用户的独立工作区。"""
from __future__ import annotations
import json
import os
import re
import shutil
import subprocess
import tempfile
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse
from fastapi import APIRouter, BackgroundTasks
from pydantic import BaseModel, Field, field_validator
from cms_core import workspace as ws, cloud_content
from cms_core.api.deploy import DeployConfig, validate_git_branch, ok, fail
from cms_core.api.sync import validate_blog_path

router = APIRouter()
TEMPLATE = 'https://github.com/YunYueSama/YunYueBlog.git'
lock = threading.Lock()
login = {'status': 'idle', 'code': '', 'url': 'https://github.com/login/device'}
jobs: dict[str, dict] = {}

def run(args, cwd=None, timeout=180):
    env = {**os.environ, 'GIT_TERMINAL_PROMPT': '0', 'GH_PROMPT_DISABLED': '1'}
    result = subprocess.run(args, cwd=cwd, env=env, capture_output=True, text=True,
                            encoding='utf-8', errors='replace', timeout=timeout,
                            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
    if result.returncode:
        # Git/CLI 诊断可能包含凭据、账号或本机路径，不直接返回给界面。
        raise RuntimeError('操作未完成，请检查 GitHub 授权、仓库权限、分支和网络后重试。')
    return result.stdout.strip()

def account():
    try:
        data = json.loads(run(['gh', 'api', 'user'], timeout=20))
        return {'login': data['login'], 'id': data['id']}
    except (RuntimeError, OSError, ValueError, subprocess.TimeoutExpired):
        return None

def repository_url(value):
    parsed = urlparse(value.strip())
    if parsed.scheme != 'https' or parsed.netloc != 'github.com' or parsed.query or parsed.fragment:
        raise ValueError('请填写不含凭据的 GitHub HTTPS 仓库地址。')
    match = re.fullmatch(r'/([A-Za-z0-9-]+)/([A-Za-z0-9_.-]+?)(?:\.git)?/?', parsed.path)
    if not match or match[2] in ('.', '..'):
        raise ValueError('仓库地址应为 https://github.com/用户名/仓库名。')
    return f'https://github.com/{match[1]}/{match[2]}.git'

class Connect(BaseModel):
    mode: str = Field(pattern='^(existing|new)$')
    repository: str = ''
    name: str = Field(default='my-blog', pattern=r'^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$')
    branch: str = 'main'
    title: str = Field(default='我的博客', min_length=1, max_length=100)
    author: str = Field(default='博主', min_length=1, max_length=50)
    @field_validator('branch')
    @classmethod
    def branch_name(cls, value):
        return validate_git_branch(value)

def neutralize(root: Path, payload: Connect):
    """只处理本次新建的模板副本；保留代码、字体、主题资源与署名。"""
    for name in ('posts', 'chatters', 'moments'):
        folder = root / name
        if folder.is_dir():
            shutil.rmtree(folder)
        folder.mkdir()
        (folder / '.gitkeep').touch()
    data = root / 'src/data'
    site = ws.read_json(data / 'site.json', {})
    site.update(title=payload.title, shortTitle=payload.title[:20], author=payload.author,
                bio='记录生活与灵感', description=payload.title, siteUrl='https://example.com',
                avatar='/images/template.svg', favicon='/images/template.svg',
                homeHero='/images/template.svg', defaultCover='/images/template.svg',
                social={'github': '', 'email': ''}, musicIds=[], musicTracks=[], danmaku=[],
                bangumiUsername='', icp={'name': '', 'url': ''})
    site['buildDate'] = datetime.now(timezone.utc).isoformat()
    ws.write_json_atomic(data / 'site.json', site)
    # 空歌单会让 JSON 模块把嵌套数组推断为 never[]；用稳定类型支持后续增删音乐。
    (data / 'template-site.ts').write_text('''import data from './site.json';
type Track = {source: 'netease' | 'kugou'; id: string; name: string; artist: string; album: string; cover: string; albumId?: string; albumAudioId?: string; key?: string};
type Site = Omit<typeof data, 'musicTracks' | 'musicIds' | 'danmaku'> & {musicTracks: Track[]; musicIds: string[]; danmaku: string[]};
export default data as unknown as Site;
''', encoding='utf-8')
    collections = {
        'friends': '{id: string; name: string; url: string; description: string; avatar: string; themeColor: string}',
        'projects': '{id: string; name: string; description: string; icon: string; githubUrl: string; tags: string[]}',
        'albums': '{id: string; title: string; description: string; cover: string; date: string; photos: {url: string; caption: string}[]}',
    }
    for name, item_type in collections.items():
        (data / f'template-{name}.ts').write_text(
            f"import data from './{name}.json';\ntype Item = {item_type};\nexport default data as Item[];\n", encoding='utf-8')
    for directory in (root / 'src', root / 'tests'):
        for file in directory.rglob('*'):
            if file.suffix not in ('.ts', '.tsx', '.astro') or file.name.startswith('template-'):
                continue
            text = file.read_text(encoding='utf-8')
            pattern = r"(import\s+\w+\s+from\s+['\"][^'\"]*data/)site\.json(['\"])(?:\s+with\s*\{[^}]*\})?"
            updated = re.sub(pattern, r'\1template-site\2', text)
            for name in collections:
                pattern = rf"(import\s+\w+\s+from\s+['\"][^'\"]*data/){name}\.json(['\"])(?:\s+with\s*\{{[^}}]*\}})?"
                updated = re.sub(pattern, rf'\1template-{name}\2', updated)
            if updated != text:
                file.write_text(updated, encoding='utf-8')
    for name in ('albums', 'friends', 'projects'):
        ws.write_json_atomic(data / f'{name}.json', [])
    ws.write_json_atomic(data / 'music.json', {'version': 1, 'tracks': {}})
    for name in ('image-manifest', 'image-dimensions'):
        ws.write_json_atomic(data / f'{name}.json', {})
    astro = root / 'astro.config.mjs'
    if astro.exists():
        config = astro.read_text(encoding='utf-8')
        config = re.sub(r"site:\s*['\"][^'\"]+['\"]", "site: publicSite.siteUrl || 'https://example.com'", config, count=1)
        if 'import publicSite ' not in config:
            config = "import publicSite from './src/data/site.json' with { type: 'json' };\n" + config
        astro.write_text(config, encoding='utf-8')
    # 图片、歌词和音频可能是原作者的公开个人内容；新博客使用中性的占位图。
    for name in ('lyrics', 'music'):
        folder = root / 'public' / name
        if folder.is_dir():
            shutil.rmtree(folder)
    images = root / 'public/images'
    images.mkdir(parents=True, exist_ok=True)
    for entry in images.iterdir():
        # 这些目录是公开的角色主题和通用表情；作者头像、相册缩略图等不继承。
        if entry.name in ('mahoyo', 'robin', 'emotes'):
            continue
        if entry.is_dir():
            shutil.rmtree(entry)
        else:
            entry.unlink()
    (images / 'template.svg').write_text('<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="1600" height="900" fill="#e9e4d8"/><circle cx="1200" cy="200" r="100" fill="#c7d3cb"/><path d="M0 700Q400 450 800 650T1600 600V900H0Z" fill="#748e86"/></svg>', encoding='utf-8')
    about = root / 'src/content/pages/about.md'
    # 当前博客使用 pages 目录；兼容后续迁移后的标准内容目录。
    for candidate in (root / 'content/about.md', root / 'pages/about.md', about):
        if candidate.exists():
            candidate.write_text('---\ntitle: 关于\ndescription: 关于这个博客\n---\n\n欢迎来到我的博客。\n', encoding='utf-8')
    (root / '.yunyue-managed.json').unlink(missing_ok=True)

@router.get('/status')
def status():
    ws.ensure_workspace()
    return ok({'account': account(), 'login': login.copy(),
               'completed': bool(ws.read_json(ws.CONFIG_ROOT / 'onboarding.json', {}).get('completed') or cloud_content.status().get('enabled'))})

def authenticate():
    global login
    try:
        process = subprocess.Popen(['gh', 'auth', 'login', '--hostname', 'github.com', '--git-protocol', 'https', '--web'],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
            encoding='utf-8', errors='replace',
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        process.stdin.write('\n'); process.stdin.close()
        timer = threading.Timer(600, process.kill)
        timer.start()
        try:
            for line in process.stdout:
                match = re.search(r'\b[A-Z0-9]{4}-[A-Z0-9]{4}\b', line)
                if match:
                    login['code'] = match[0]
            process.wait()
        finally:
            timer.cancel()
        login['status'] = 'succeeded' if process.returncode == 0 else 'failed'
    except OSError:
        login['status'] = 'failed'

@router.post('/login')
def start_login(tasks: BackgroundTasks):
    if login['status'] != 'running':
        login.update(status='running', code='')
        tasks.add_task(authenticate)
    return ok(login.copy())

@router.post('/connect')
def start_connect(payload: Connect, tasks: BackgroundTasks):
    if not lock.acquire(blocking=False):
        return fail('setup_busy', '正在连接仓库，请等待当前任务完成。', 409)
    if ws.read_json(ws.CONFIG_ROOT / 'onboarding.json', {}).get('completed') or cloud_content.status().get('enabled'):
        lock.release()
        return fail('already_connected', '已有博客已连接，请在发布页面管理现有仓库。', 409)
    try:
        if payload.mode == 'existing':
            payload.repository = repository_url(payload.repository)
    except ValueError as error:
        lock.release()
        return fail('invalid_repository', str(error))
    job_id = uuid.uuid4().hex
    jobs[job_id] = {'status': 'running', 'message': '正在准备独立的博客工作区。'}
    tasks.add_task(connect, payload, job_id)
    return ok({'jobId': job_id})

@router.get('/jobs/{job_id}')
def job(job_id: str):
    return ok(jobs[job_id].copy()) if job_id in jobs else fail('not_found', '连接任务不存在。', 404)

def connect(payload: Connect, job_id: str):
    target = None
    try:
        user = account()
        if not user:
            raise RuntimeError('请先完成 GitHub 登录授权。')
        roots = ws.WORKSPACE_ROOT / 'repositories'
        roots.mkdir(parents=True, exist_ok=True)
        repo = payload.repository if payload.mode == 'existing' else f'https://github.com/{user["login"]}/{payload.name}.git'
        if payload.mode == 'existing':
            slug = repo.removesuffix('.git').split('github.com/')[1]
            permissions = json.loads(run(['gh', 'api', f'repos/{slug}']))
            if not permissions.get('permissions', {}).get('push'):
                raise RuntimeError('当前账号没有该仓库的推送权限，请切换账号或选择自己的博客。')
        target = roots / (repo.removesuffix('.git').rsplit('/', 2)[-2] + '-' + repo.removesuffix('.git').rsplit('/', 1)[-1])
        reusing = target.exists()
        if reusing:
            _, error = validate_blog_path(str(target))
            if error or run(['git', 'remote', 'get-url', 'origin'], cwd=target) != repo:
                raise RuntimeError('已有目录不是本次仓库，已保留原内容，请在发布页面检查。')
            if run(['git', 'branch', '--show-current'], cwd=target) != payload.branch or run(['git', 'status', '--porcelain'], cwd=target):
                raise RuntimeError('已有目录包含修改或使用其他分支，已保留原内容，请先处理再连接。')
        with tempfile.TemporaryDirectory(dir=roots, prefix='.setup-') as temporary:
            staged = target if reusing else Path(temporary) / 'blog'
            source = repo if payload.mode == 'existing' else TEMPLATE
            arguments = ['git', '-c', 'credential.helper=', '-c', 'credential.helper=!gh auth git-credential',
                         'clone', '--single-branch', '--branch', payload.branch if payload.mode == 'existing' else 'main', '--', source, str(staged)]
            if not reusing:
                run(arguments, timeout=300)
            validated, error = validate_blog_path(str(staged))
            if error:
                raise RuntimeError('这个仓库不是兼容的 YunYueBlog 博客，请确认仓库地址。')
            if payload.mode == 'new' and not reusing:
                neutralize(staged, payload)
                shutil.rmtree(staged / '.git')
                run(['git', 'init', '--initial-branch', payload.branch], cwd=staged)
            run(['git', 'config', 'user.name', user['login']], cwd=staged)
            run(['git', 'config', 'user.email', f'{user["id"]}+{user["login"]}@users.noreply.github.com'], cwd=staged)
            run(['git', 'config', 'credential.https://github.com.helper', ''], cwd=staged)
            run(['git', 'config', '--add', 'credential.https://github.com.helper', '!gh auth git-credential'], cwd=staged)
            if payload.mode == 'new' and not reusing:
                jobs[job_id]['message'] = '正在创建你自己的私有博客仓库。'
                run(['gh', 'repo', 'create', f'{user["login"]}/{payload.name}', '--private'])
                run(['git', 'remote', 'add', 'origin', repo], cwd=staged)
                run(['git', 'add', '--all'], cwd=staged)
                run(['git', 'commit', '-m', '初始化：我的个性化博客'], cwd=staged)
                run(['git', 'push', '-u', 'origin', payload.branch], cwd=staged, timeout=300)
            if not reusing:
                staged.rename(target)
        config_path = ws.CONFIG_ROOT / 'deploy.json'
        previous = ws.read_json(config_path, None)
        ws.write_json_atomic(config_path, DeployConfig(blogPath=str(target), branch=payload.branch).model_dump())
        try:
            jobs[job_id]['message'] = '正在读取远程文章、图库、歌单与公开设置。'
            cloud_content.refresh(force=True, connect=True)
        except Exception:
            if previous is None:
                config_path.unlink(missing_ok=True)
            else:
                ws.write_json_atomic(config_path, previous)
            raise
        ws.write_json_atomic(ws.CONFIG_ROOT / 'onboarding.json', {'completed': True, 'repository': repo})
        jobs[job_id].update(status='succeeded', message='博客已连接，可以开始管理。', repository=repo)
    except (RuntimeError, OSError, ValueError, subprocess.SubprocessError) as error:
        message = str(error) if isinstance(error, RuntimeError) else '连接未完成，请检查网络与权限后重试。'
        jobs[job_id].update(status='failed', message=message)
    finally:
        lock.release()
