from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from cms_core.api import config, deploy, drafts, friends, gallery, moments, music, music_accounts, operations, picbed, projects, settings_v2, sync, robin, onboarding
from cms_core.workspace import import_legacy_content, workspace_counts
import asyncio
import os
from starlette.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse
from cms_core import cloud_content

cloud_requests = asyncio.Lock()

app = FastAPI(title="星辉云端控制台 API", version="1.0.0")

@app.middleware('http')
async def synchronize_cloud_content(request, call_next):
    origin = request.headers.get('origin')
    expected = os.environ.get('YUNYUE_FRONTEND_ORIGIN')
    if expected and origin and origin != expected:
        return JSONResponse({'ok': False, 'error': {'message': '请从当前管理窗口操作。'}}, status_code=403)
    path = request.url.path
    managed = path.startswith(('/api/settings', '/api/gallery', '/api/projects', '/api/friends', '/api/moments', '/api/operations', '/api/sync/', '/api/deploy/push')) or path in ('/api/drafts/get', '/api/drafts/all_tags')
    local_integration_write = False
    if path == '/api/settings/integrations' and request.method == 'POST':
        # 图床与密钥仅存本机；只有显式修改公开用户名才需要核对远程版本。
        try:
            payload = await request.json()
        except ValueError:
            payload = None
        local_integration_write = not isinstance(payload, dict) or 'bangumiUsername' not in payload
    if managed and cloud_content.status().get('enabled') and request.method != 'OPTIONS':
        async with cloud_requests:
            try:
                if local_integration_write or path == '/api/operations' and request.method == 'PUT':
                    # 本机配置与队列保存不访问远程；仍串行读取响应快照，避免旧正文配上新版本号。
                    # 队列实际应用时再严格校验每条操作版本。
                    pass
                elif request.method in ('POST', 'PUT', 'DELETE') and path not in ('/api/drafts/get',):
                    await run_in_threadpool(cloud_content.require_revision, request.headers.get('X-YunYue-Revision'))
                else:
                    cloud_content.schedule_update_check()
                response = await call_next(request)
                revision = cloud_content.status().get('revision')
                if revision:
                    response.headers['X-YunYue-Revision'] = revision
            except (RuntimeError, OSError) as error:
                response = JSONResponse({'ok': False, 'error': {'code': 'cloud_sync_required', 'message': str(error)}}, status_code=409)
    else:
        response = await call_next(request)
    revision = cloud_content.status().get('revision')
    if revision and 'X-YunYue-Revision' not in response.headers:
        response.headers['X-YunYue-Revision'] = revision
    return response

@app.get('/api/cloud/status')
def cloud_status():
    cloud_content.schedule_update_check()
    return {'ok': True, 'data': cloud_content.status()}

@app.get('/api/cloud/snapshot')
def cloud_snapshot():
    cloud_content.schedule_update_check()
    return {'ok': True, 'data': cloud_content.status()}

@app.get('/api/cloud/refresh')
async def cloud_refresh():
    try:
        async with cloud_requests:
            return {'ok': True, 'data': await run_in_threadpool(cloud_content.refresh, force=True)}
    except (RuntimeError, OSError) as error:
        return JSONResponse({'ok': False, 'error': {'message': str(error)}}, status_code=409)

@app.post('/api/cloud/connect')
async def cloud_connect():
    try:
        async with cloud_requests:
            return {'ok': True, 'data': await run_in_threadpool(cloud_content.refresh, force=True, connect=True)}
    except (RuntimeError, OSError) as error:
        return JSONResponse({'ok': False, 'error': {'message': str(error)}}, status_code=409)


@app.on_event("startup")
def initialize_workspace():
    import_legacy_content()


@app.get("/api/status")
def get_status():
    return {"ok": True, "data": {"status": "online", "version": "1.0.0", "counts": workspace_counts()}}


app.include_router(music.router, prefix="/api/music", tags=["Music"])
app.include_router(music_accounts.router, prefix="/api/music/accounts", tags=["Music accounts"])
app.include_router(config.router, prefix="/api/config", tags=["Config"])
app.include_router(picbed.router, prefix="/api/picbed", tags=["PicBed"])
app.include_router(drafts.router, prefix="/api/drafts", tags=["Drafts"])
app.include_router(gallery.router, prefix="/api/gallery", tags=["Gallery"])
app.include_router(friends.router, prefix="/api/friends", tags=["Friends"])
app.include_router(projects.router, prefix="/api/projects", tags=["Projects"])
app.include_router(moments.router, prefix="/api/moments", tags=["Moments"])
app.include_router(sync.router, prefix="/api/sync", tags=["Sync"])
app.include_router(deploy.router, prefix="/api/deploy", tags=["Deploy"])
app.include_router(deploy.jobs_router, prefix="/api/jobs", tags=["Jobs"])
app.include_router(settings_v2.router, prefix="/api/settings", tags=["Settings"])
app.include_router(robin.router, prefix="/api/robin", tags=["Robin"])
app.include_router(operations.router, prefix="/api/operations", tags=["Operations"])
app.include_router(onboarding.router, prefix='/api/onboarding', tags=['Onboarding'])

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:3000", "http://localhost:3000"],
    allow_origin_regex=r"^http://(127\.0\.0\.1|localhost):\d+$",
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "X-YunYue-Revision"],
    expose_headers=["X-YunYue-Revision"],
)
