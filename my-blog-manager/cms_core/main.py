from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from cms_core.api import config, deploy, drafts, friends, gallery, moments, music, music_accounts, operations, picbed, projects, settings_v2, sync, robin
from cms_core.workspace import import_legacy_content, workspace_counts
import asyncio
from starlette.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse
from cms_core import cloud_content

cloud_requests = asyncio.Lock()

app = FastAPI(title="星辉云端控制台 API", version="2.0.0", max_request_size=50 * 1024 * 1024)

@app.middleware('http')
async def synchronize_cloud_content(request, call_next):
    path = request.url.path
    managed = (path.startswith(('/api/settings', '/api/gallery', '/api/projects', '/api/friends', '/api/moments', '/api/operations', '/api/sync/', '/api/deploy/push')) or path in ('/api/drafts/get', '/api/drafts/all_tags')) and path != '/api/settings/integrations'
    if managed and cloud_content.status().get('enabled') and request.method != 'OPTIONS':
        async with cloud_requests:
            try:
                if path == '/api/operations' and request.method == 'PUT':
                    # 队列只保存在本机；实际应用时再严格校验每条操作版本。
                    # 防抖自动保存不能每次都等待远程 fetch。
                    pass
                elif request.method in ('POST', 'PUT', 'DELETE') and path not in ('/api/drafts/get',):
                    await run_in_threadpool(cloud_content.require_revision, request.headers.get('X-YunYue-Revision'))
                else:
                    await run_in_threadpool(cloud_content.refresh)
                response = await call_next(request)
            except (RuntimeError, OSError) as error:
                response = JSONResponse({'ok': False, 'error': {'code': 'cloud_sync_required', 'message': str(error)}}, status_code=409)
    else:
        response = await call_next(request)
    revision = cloud_content.status().get('revision')
    if revision:
        response.headers['X-YunYue-Revision'] = revision
    return response

@app.get('/api/cloud/status')
def cloud_status():
    return {'ok': True, 'data': cloud_content.status()}

@app.get('/api/cloud/refresh')
def cloud_refresh():
    try:
        return {'ok': True, 'data': cloud_content.refresh()}
    except (RuntimeError, OSError) as error:
        return JSONResponse({'ok': False, 'error': {'message': str(error)}}, status_code=409)

@app.post('/api/cloud/connect')
def cloud_connect():
    try:
        return {'ok': True, 'data': cloud_content.refresh(force=True, connect=True)}
    except (RuntimeError, OSError) as error:
        return JSONResponse({'ok': False, 'error': {'message': str(error)}}, status_code=409)


@app.on_event("startup")
def initialize_workspace():
    import_legacy_content()


@app.get("/api/status")
def get_status():
    return {"ok": True, "data": {"status": "online", "version": "2.0.0", "counts": workspace_counts()}}


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

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:3000", "http://localhost:3000"],
    allow_origin_regex=r"^http://(127\.0\.0\.1|localhost):\d+$",
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "X-YunYue-Revision"],
    expose_headers=["X-YunYue-Revision"],
)
