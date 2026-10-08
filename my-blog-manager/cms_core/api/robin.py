from __future__ import annotations

import json
import re
import shutil
import subprocess
import threading
import time
import uuid
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, BackgroundTasks
from pydantic import BaseModel, Field, field_validator

from cms_core.api.picbed import validate_public_url
from cms_core.api.deploy import ok, fail
from cms_core.api.sync import validate_blog_path
from cms_core.workspace import CONFIG_ROOT, JOBS_ROOT, ensure_workspace, read_json, write_json_atomic

router = APIRouter()
sync_lock = threading.Lock()


class RobinConfig(BaseModel):
    provider: Literal['deepseek', 'compatible'] = 'deepseek'
    baseUrl: str = Field(default='https://api.deepseek.com', max_length=2048)
    fastModel: str = Field(default='deepseek-flash', min_length=1, max_length=200, pattern=r'^[A-Za-z0-9][A-Za-z0-9_./:-]*$')
    deepModel: str = Field(default='deepseek-v4-pro', min_length=1, max_length=200, pattern=r'^[A-Za-z0-9][A-Za-z0-9_./:-]*$')

    @field_validator('baseUrl')
    @classmethod
    def validate_base(cls, value):
        value = validate_public_url(value.strip()).rstrip('/')
        from urllib.parse import urlparse
        url = urlparse(value)
        if url.scheme != 'https' or url.query or url.fragment:
            raise ValueError('AI 接口须使用无查询参数的 HTTPS 地址。')
        return value


class RobinUpdate(RobinConfig):
    apiKey: str | None = Field(default=None, max_length=4096)

    @field_validator('apiKey')
    @classmethod
    def validate_key(cls, value):
        if value is not None and ('\n' in value or '\r' in value):
            raise ValueError('密钥不能包含换行。')
        return value.strip() if value is not None else None


def local_config():
    return RobinConfig.model_validate(read_json(CONFIG_ROOT / 'robin.json', {}))


@router.get('/config')
def get_config():
    ensure_workspace()
    return ok({**local_config().model_dump(), 'apiKeyConfigured': bool(read_json(CONFIG_ROOT / 'secrets.json', {}).get('robinApiKey')), 'saved': (CONFIG_ROOT / 'robin.json').is_file()})


@router.post('/config')
def save_config(payload: RobinUpdate):
    ensure_workspace()
    config = RobinConfig.model_validate(payload.model_dump())
    if config.provider == 'deepseek' and config.baseUrl != 'https://api.deepseek.com':
        return fail('invalid_provider', 'DeepSeek 请使用官方接口地址，其他接口请选择兼容服务。')
    secrets = read_json(CONFIG_ROOT / 'secrets.json', {})
    if local_config().baseUrl != config.baseUrl and payload.apiKey is None:
        # 换服务时不能悄悄把上一家服务的密钥发送到新地址。
        return fail('new_key_required', '更换接口地址时请填写新服务的密钥。')
    if payload.apiKey is not None:
        if payload.apiKey:
            secrets['robinApiKey'] = payload.apiKey
        else:
            secrets.pop('robinApiKey', None)
    write_json_atomic(CONFIG_ROOT / 'secrets.json', secrets)
    write_json_atomic(CONFIG_ROOT / 'robin.json', config.model_dump())
    return get_config()


def project():
    path, error = validate_blog_path(read_json(CONFIG_ROOT / 'deploy.json', {}).get('blogPath', ''))
    if error or path is None:
        raise RuntimeError('请先在发布页配置正确的博客路径。')
    linked = read_json(path / '.vercel/project.json', {})
    if not linked.get('projectId') or not linked.get('orgId') or not linked.get('projectName'):
        raise RuntimeError('博客尚未关联 Vercel 项目，请先完成 Vercel 登录与项目关联。')
    if not all(isinstance(linked.get(name), str) and re.fullmatch(r'[A-Za-z0-9_-]+', linked[name]) for name in ('projectId', 'orgId', 'projectName')):
        raise RuntimeError('Vercel 项目关联信息无效，请重新关联项目。')
    return path, linked


def cli(path: Path, linked: dict, args: list[str], *, value: str | None = None, timeout: int = 35):
    executable = shutil.which('vercel.cmd') or shutil.which('vercel')
    if not executable:
        raise RuntimeError('未找到 Vercel 工具，请安装并登录后重试。')
    try:
        result = subprocess.run([executable, *args, '--scope', linked['orgId']], cwd=path,
                                input=value, capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=timeout,
                                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    except (OSError, subprocess.TimeoutExpired):
        raise RuntimeError('Vercel 操作超时或无法启动，请检查网络与登录状态。') from None
    if result.returncode:
        # CLI 的原始输出可能包含环境变量，不能写入日志或返回给浏览器。
        raise RuntimeError('Vercel 操作未完成，请检查登录、项目权限或部署状态后重试。')
    return result.stdout


def cloud_config(path, linked):
    envs = json.loads(cli(path, linked, ['env', 'ls', 'production', '--json'])).get('envs', [])
    envs = {env['key']: env for env in envs if 'production' in env.get('target', [])}
    def public_value(key, default):
        value = envs.get(key, {}).get('value')
        return value if isinstance(value, str) and value else default
    return {
        'projectName': linked['projectName'],
        'apiKeyConfigured': bool(envs.get('ROBIN_AI_API_KEY') or envs.get('DEEPSEEK_API_KEY')),
        'baseUrl': public_value('ROBIN_AI_BASE_URL', 'https://api.deepseek.com'),
        'fastModel': public_value('ROBIN_AI_FAST_MODEL', 'deepseek-flash'),
        'deepModel': public_value('ROBIN_AI_DEEP_MODEL', 'deepseek-v4-pro'),
    }


@router.get('/cloud')
def cloud_status():
    try:
        path, linked = project()
        return ok(cloud_config(path, linked))
    except (RuntimeError, ValueError):
        return fail('cloud_unavailable', '无法读取 Vercel 配置，请检查博客路径、项目关联和 Vercel 登录。', 503)


@router.post('/sync')
def synchronize(background_tasks: BackgroundTasks):
    ensure_workspace()
    if not sync_lock.acquire(blocking=False):
        return fail('sync_busy', 'Robin 配置正在同步，请等待当前任务完成。', 409)
    try:
        path, linked = project()
        config = local_config()
        key = read_json(CONFIG_ROOT / 'secrets.json', {}).get('robinApiKey')
        cloud = cloud_config(path, linked)
        if not key and not cloud['apiKeyConfigured']:
            raise RuntimeError('请先保存 Robin API Key，再同步到服务器。')
        if not key and config.baseUrl != cloud['baseUrl']:
            raise RuntimeError('更换服务器接口地址时，请先保存新服务的密钥。')
        job_id = uuid.uuid4().hex
        write_json_atomic(JOBS_ROOT / f'{job_id}.json', {'jobId': job_id, 'status': 'queued', 'message': '等待同步 Robin 配置。'})
        background_tasks.add_task(run_sync, job_id, path, linked, config, key)
        return ok({'jobId': job_id}, 202)
    except (RuntimeError, ValueError) as error:
        sync_lock.release()
        return fail('sync_unavailable', str(error) if isinstance(error, RuntimeError) else 'Robin 配置无效，请重新保存。', 409)


def run_sync(job_id, path, linked, config, key):
    job = {'jobId': job_id, 'status': 'running', 'message': '正在同步服务器配置。'}
    def report():
        write_json_atomic(JOBS_ROOT / f'{job_id}.json', job)
    try:
        report()
        values = {'ROBIN_AI_BASE_URL': config.baseUrl, 'ROBIN_AI_FAST_MODEL': config.fastModel, 'ROBIN_AI_DEEP_MODEL': config.deepModel}
        if key:
            values['ROBIN_AI_API_KEY'] = key
        for name, value in values.items():
            cli(path, linked, ['env', 'add', name, 'production', '--force', '--yes', '--sensitive' if name.endswith('API_KEY') else '--no-sensitive'], value=value)
        job['message'] = '配置已同步，正在重新部署正式博客。'; report()
        # 重建服务器已有的最新正式部署，不把本机过时内容或未提交文件发布出去。
        deployments = json.loads(cli(path, linked, ['list', linked['projectName'], '--environment', 'production', '--json'])).get('deployments', [])
        if not deployments or deployments[0].get('state') != 'READY':
            raise RuntimeError('环境变量已同步，但最新部署尚未就绪，请待其完成后重新同步部署。')
        result = cli(path, linked, ['redeploy', deployments[0]['url'], '--target', 'production', '--no-wait'], timeout=55)
        urls = re.findall(r'https://[A-Za-z0-9.-]+\.vercel\.app', result)
        if not urls:
            raise RuntimeError('环境变量已同步，但未获取部署地址，请到 Vercel 查看部署状态。')
        job['url'] = urls[-1]; report()
        deployment = json.loads(cli(path, linked, ['inspect', job['url'], '--wait', '--timeout', '4m', '--json'], timeout=260))
        if deployment.get('readyState', deployment.get('state')) != 'READY':
            raise RuntimeError('配置已同步，部署仍未就绪，请到 Vercel 查看状态。')
        job.update(status='succeeded', message='Robin 配置已同步，正式博客部署已就绪。')
    except (RuntimeError, ValueError, KeyError, OSError):
        job.update(status='failed', message='Robin 同步或部署未完成；部分环境变量可能已更新，请检查 Vercel 状态后重试。')
    finally:
        job['finishedAt'] = int(time.time())
        try:
            report()
        finally:
            sync_lock.release()
