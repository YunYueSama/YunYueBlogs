from typing import Annotated, Literal
import re
from urllib.parse import urlsplit
from fastapi import APIRouter, Path, Request, HTTPException, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from cms_core import music_accounts as accounts

def require_local(request: Request):
    host = urlsplit('http://' + request.headers.get('host', '')).hostname
    origin = request.headers.get('origin')
    if host not in ('127.0.0.1', 'localhost') or (origin and (urlsplit(origin).scheme != 'http' or urlsplit(origin).hostname not in ('127.0.0.1', 'localhost'))):
        raise HTTPException(status_code=403, detail='音乐账号仅允许本机控制台访问')


router = APIRouter(dependencies=[Depends(require_local)])
Source = Literal['netease', 'kugou']


def ok(data):
    return JSONResponse({'ok': True, 'data': data}, headers={'Cache-Control': 'no-store'})


def invoke(call):
    try:
        return ok(call())
    except ValueError as error:
        return JSONResponse({'ok': False, 'error': {'code': 'music_account_unavailable', 'message': str(error)}}, status_code=400, headers={'Cache-Control': 'no-store'})


@router.get('')
def overview():
    return ok(accounts.overview())


@router.post('/{source}/login')
def begin(source: Source):
    return invoke(lambda: accounts.begin_login(source))


@router.get('/{source}/login/{login_id}')
def poll(source: Source, login_id: Annotated[str, Path(min_length=20, max_length=80)]):
    return invoke(lambda: accounts.poll_login(source, login_id))


@router.delete('/{source}')
def logout(source: Source):
    accounts.logout(source)
    return ok({'loggedIn': False})


@router.get('/{source}/preview/{track_id}')
def preview(source: Source, track_id: str):
    if not re.fullmatch(r'\d{1,20}' if source == 'netease' else r'[A-Fa-f0-9]{32}', track_id):
        return JSONResponse({'ok': False, 'error': {'message': '歌曲 ID 或 Hash 格式无效'}}, status_code=400)
    return invoke(lambda: accounts.private_playback(source, track_id))


class DailyPreference(BaseModel):
    enabled: bool


@router.put('/kugou/daily')
def preference(payload: DailyPreference):
    with accounts.account_lock():
        value = accounts.state()
        account = value.get('kugou', {})
        if not account.get('cookie'):
            return JSONResponse({'ok': False, 'error': {'message': '请先登录酷狗概念版账号'}}, status_code=400)
        account['autoDailyVip'] = payload.enabled
        accounts.save(value)
        from music_runtime import configure_daily_task
        account['scheduler'] = configure_daily_task(payload.enabled)
        accounts.save(value)
    return ok({'enabled': payload.enabled})


@router.post('/kugou/daily')
def claim():
    return invoke(lambda: accounts.claim_daily(force=True))
