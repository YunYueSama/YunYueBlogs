from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from cms_core.api import config, deploy, drafts, friends, gallery, moments, music, music_accounts, operations, picbed, projects, settings_v2, sync
from cms_core.workspace import import_legacy_content, workspace_counts

app = FastAPI(title="星辉云端控制台 API", version="2.0.0", max_request_size=50 * 1024 * 1024)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:3000", "http://localhost:3000"],
    allow_origin_regex=r"^http://(127\.0\.0\.1|localhost):\d+$",
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type"],
)


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
app.include_router(operations.router, prefix="/api/operations", tags=["Operations"])
