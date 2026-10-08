"""本机音乐账号与福利；凭据只进入忽略目录，不参与公开内容同步。"""
from __future__ import annotations

import secrets
import hashlib
import re
import os
import json
from contextlib import contextmanager
from pathlib import Path
import threading
import time
from datetime import datetime, timezone, timedelta
from typing import Any

import httpx

from cms_core.workspace import CONFIG_ROOT, ensure_workspace, read_json, write_json_atomic

LOCK = threading.RLock()
PENDING: dict[str, dict[str, Any]] = {}
SMS_PENDING: dict[str, dict[str, Any]] = {}
SMS_SENT: dict[str, float] = {}
CHINA = timezone(timedelta(hours=8))


@contextmanager
def account_lock():
    # 桌面窗口与每日计划任务可能同时运行，共用文件锁防止重复领取和覆盖账号。
    with LOCK:
        ensure_workspace()
        with (CONFIG_ROOT / 'music-accounts.lock').open('a+b') as file:
            file.seek(0)
            if os.name == 'nt':
                import msvcrt
                if not file.read(1):
                    file.write(b'0')
                    file.flush()
                for attempt in range(180):
                    try:
                        file.seek(0)
                        msvcrt.locking(file.fileno(), msvcrt.LK_NBLCK, 1)
                        break
                    except OSError:
                        if attempt == 179:
                            raise ValueError('另一项账号操作正在进行，请稍后重试') from None
                        time.sleep(0.5)
                try:
                    yield
                finally:
                    file.seek(0)
                    msvcrt.locking(file.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl
                fcntl.flock(file, fcntl.LOCK_EX)
                try:
                    yield
                finally:
                    fcntl.flock(file, fcntl.LOCK_UN)


def state() -> dict:
    ensure_workspace()
    value = read_json(CONFIG_ROOT / 'music-accounts.json', {})
    from cms_core.local_secrets import protect
    for source in ('netease', 'kugou'):
        account = value.get(source, {})
        if account.get('protectedCookie'):
            try:
                account['cookie'] = json.loads(protect(account['protectedCookie'], decrypt=True))
            except (ValueError, OSError):
                account['cookie'] = {}
    return value


def save(value: dict) -> None:
    from cms_core.local_secrets import protect
    stored = json.loads(json.dumps(value))
    if os.name == 'nt':
        for source in ('netease', 'kugou'):
            account = stored.get(source, {})
            if account.get('cookie'):
                account['protectedCookie'] = protect(json.dumps(account.pop('cookie')))
    write_json_atomic(CONFIG_ROOT / 'music-accounts.json', stored)


def merge_cookies(current: dict, values: list[str]) -> dict:
    result = dict(current)
    for value in values:
        part = value.split(';', 1)[0]
        if '=' in part:
            key, content = part.split('=', 1)
            if key.strip():
                result[key.strip()] = content.strip()
    return result


def gateway(source: str, action: str, params: dict | None = None, cookie: dict | None = None) -> dict:
    config = read_json(Path(os.environ.get('MUSIC_GATEWAY_CONFIG', str(CONFIG_ROOT / 'music-gateway.json'))), {})
    port = config.get('port')
    key = config.get('key')
    if not isinstance(port, int) or not 1 <= port <= 65535 or not key:
        raise ValueError('本机音乐服务尚未启动，请关闭旧窗口后重新启动控制台')
    try:
        response = httpx.post(f'http://127.0.0.1:{port}/request',
                              headers={'Authorization': f'Bearer {key}'},
                              json={'source': source, 'action': action, 'params': params or {}, 'cookie': cookie or {}},
                              timeout=20)
        response.raise_for_status()
        result = response.json()
        if not isinstance(result.get('body'), dict):
            raise ValueError('音乐平台返回了异常数据，请稍后重试')
        return result
    except httpx.HTTPError:
        raise ValueError('本机音乐服务或平台暂时不可用，请稍后重试') from None


def overview() -> dict:
    value = state()
    return {source: {'loggedIn': bool(value.get(source, {}).get('cookie')),
                     'nickname': value.get(source, {}).get('nickname', ''),
                     'autoDailyVip': bool(value.get(source, {}).get('autoDailyVip')),
                     'scheduler': value.get(source, {}).get('scheduler', {}),
                     'daily': value.get(source, {}).get('daily', {})}
            for source in ('netease', 'kugou')}


def begin_login(source: str) -> dict:
    first = gateway(source, 'login_qr_key')
    cookie = merge_cookies({}, first.get('cookies', []))
    data = first['body'].get('data', {})
    key = data.get('unikey') if source == 'netease' else data.get('qrcode')
    if not key:
        raise ValueError('未能取得登录二维码，请稍后重试')
    created = gateway(source, 'login_qr_create', {'key': key, 'qrimg': True}, cookie)
    qr = created['body'].get('data', {})
    image = qr.get('qrimg') or qr.get('base64') or ''
    if not isinstance(image, str) or not image.startswith('data:image/'):
        raise ValueError('二维码生成失败，请稍后重试')
    login_id = secrets.token_urlsafe(24)
    with LOCK:
        for old in list(PENDING):
            if PENDING[old]['expires'] < time.monotonic():
                del PENDING[old]
        if len(PENDING) >= 8:
            del PENDING[next(iter(PENDING))]
        PENDING[login_id] = {'source': source, 'key': key, 'cookie': cookie, 'expires': time.monotonic() + 180}
    return {'loginId': login_id, 'image': image, 'expiresIn': 180}


def poll_login(source: str, login_id: str) -> dict:
    with LOCK:
        pending = PENDING.get(login_id)
        if not pending or pending['source'] != source or pending['expires'] < time.monotonic():
            return {'status': 'expired', 'message': '二维码已过期，请重新获取'}
    result = gateway(source, 'login_qr_check', {'key': pending['key'], 'noCookie': True}, pending['cookie'])
    body = result['body']
    data = body.get('data', {})
    try:
        code = int(body.get('code') if source == 'netease' else data.get('status'))
    except (TypeError, ValueError):
        raise ValueError('平台未返回有效扫码状态，请在手机端确认，或切换手机号登录') from None
    success = code == (803 if source == 'netease' else 4)
    if not success:
        expired = code in ({800} if source == 'netease' else {0})
        confirmed = code == (802 if source == 'netease' else 2)
        pending['cookie'] = merge_cookies(pending['cookie'], result.get('cookies', []))
        return {'status': 'expired' if expired else 'confirming' if confirmed else 'waiting',
                'message': '二维码已过期' if expired else '请在手机端确认登录' if confirmed else '等待手机扫码'}
    cookies = merge_cookies(pending['cookie'], result.get('cookies', []))
    if source == 'netease' and isinstance(body.get('cookie'), str):
        cookies = merge_cookies(cookies, body['cookie'].split(';'))
    if source == 'kugou':
        cookies.update({key: str(data[key]) for key in ('token', 'userid') if data.get(key)})
    if not cookies.get('MUSIC_U' if source == 'netease' else 'token') or cookies.get('token') == 'undefined':
        raise ValueError('平台已确认扫码，但未返回有效登录凭据，请重新登录')
    nickname = str(data.get('nickname') or '已登录账号')[:100]
    with account_lock():
        if PENDING.get(login_id) is not pending:
            return {'status': 'expired', 'message': '登录已取消，请重新扫码'}
        value = state()
        value[source] = {'cookie': cookies, 'nickname': nickname, 'autoDailyVip': source == 'kugou', 'daily': {}}
        save(value)
        if source == 'kugou':
            from music_runtime import configure_daily_task
            value[source]['scheduler'] = configure_daily_task(True)
        save(value)
        PENDING.pop(login_id, None)
    return {'status': 'logged_in', 'message': '登录成功，凭据仅保存在本机'}


def send_sms(source: str, phone: str) -> dict:
    if not re.fullmatch(r'1[3-9]\d{9}', phone):
        raise ValueError('请输入有效的中国大陆手机号')
    identity = hashlib.sha256(f'{source}:{phone}'.encode()).hexdigest()
    now = time.monotonic()
    with LOCK:
        if now - SMS_SENT.get(identity, -1000) < 60:
            raise ValueError('验证码请求已提交，请等待 60 秒后再试')
        for key in list(SMS_PENDING):
            if SMS_PENDING[key]['expires'] < now:
                del SMS_PENDING[key]
        for key in list(SMS_SENT):
            if now - SMS_SENT[key] > 600:
                del SMS_SENT[key]
        if len(SMS_PENDING) >= 8 or len(SMS_SENT) >= 20:
            raise ValueError('登录请求过多，请稍后重试')
        SMS_SENT[identity] = now
    result = gateway(source, 'captcha_sent', {'phone': phone, 'ctcode': '86'} if source == 'netease' else {'mobile': phone})
    body = result['body']
    if body.get('code' if source == 'netease' else 'status') != (200 if source == 'netease' else 1):
        raise ValueError('平台未确认发送验证码，请检查手机号；如需安全验证，请先在官方手机端完成后重试')
    login_id = secrets.token_urlsafe(24)
    with LOCK:
        SMS_PENDING[login_id] = {'source': source, 'phone': phone, 'cookie': merge_cookies({}, result.get('cookies', [])), 'expires': now + 600, 'attempts': 0}
    return {'loginId': login_id, 'retryAfter': 60, 'message': '验证码已发送，请查看手机短信'}


def login_sms(source: str, login_id: str, code: str) -> dict:
    if not re.fullmatch(r'\d{4,8}', code):
        raise ValueError('请输入 4 至 8 位短信验证码')
    with LOCK:
        pending = SMS_PENDING.get(login_id)
        if not pending or pending['source'] != source or pending['expires'] < time.monotonic() or pending['attempts'] >= 5:
            raise ValueError('验证码登录已过期或尝试过多，请重新获取验证码')
        pending['attempts'] += 1
    params = {'phone': pending['phone'], 'captcha': code, 'countrycode': '86'} if source == 'netease' else {'mobile': pending['phone'], 'code': code}
    result = gateway(source, 'login_cellphone', params, pending['cookie'])
    body = result['body']
    if body.get('code' if source == 'netease' else 'status') != (200 if source == 'netease' else 1):
        raise ValueError('验证码错误、已过期或平台要求安全验证，请重新确认；必要时在官方手机端完成验证')
    data = body.get('profile', {}) if source == 'netease' else body.get('data', {})
    cookies = merge_cookies(pending['cookie'], result.get('cookies', []))
    if source == 'netease' and isinstance(body.get('cookie'), str):
        cookies = merge_cookies(cookies, body['cookie'].split(';'))
    if source == 'kugou':
        cookies.update({key: str(data[key]) for key in ('token', 'userid') if data.get(key)})
    if not cookies.get('MUSIC_U' if source == 'netease' else 'token') or cookies.get('token') == 'undefined':
        raise ValueError('平台未返回有效登录凭据，请重新登录')
    with account_lock():
        if SMS_PENDING.get(login_id) is not pending:
            raise ValueError('登录已取消，请重新获取验证码')
        value = state()
        value[source] = {'cookie': cookies, 'nickname': str(data.get('nickname') or data.get('username') or '已登录账号')[:100], 'autoDailyVip': source == 'kugou', 'daily': {}}
        save(value)
        SMS_PENDING.pop(login_id, None)
        if source == 'kugou':
            from music_runtime import configure_daily_task
            value[source]['scheduler'] = configure_daily_task(True)
            save(value)
    return {'status': 'logged_in', 'message': '登录成功，凭据仅保存在本机'}


def cancel_login(source: str, login_id: str) -> dict:
    with LOCK:
        for collection in (PENDING, SMS_PENDING):
            if collection.get(login_id, {}).get('source') == source:
                collection.pop(login_id, None)
    return {'message': '已取消登录'}


def logout(source: str) -> None:
    with account_lock():
        if source == 'kugou':
            from music_runtime import configure_daily_task
            configure_daily_task(False)
        value = state()
        value.pop(source, None)
        save(value)
        for collection in (PENDING, SMS_PENDING):
            for key in list(collection):
                if collection[key]['source'] == source:
                    del collection[key]


def private_playback(source: str, track_id: str) -> dict:
    account = state().get(source, {})
    if not account.get('cookie'):
        raise ValueError('请先扫码登录对应的音乐账号')
    params = {'id': track_id, 'level': 'standard'} if source == 'netease' else {'hash': track_id, 'quality': '128', 'free_part': False}
    result = gateway(source, 'song_url_v1' if source == 'netease' else 'song_url', params, account['cookie'])['body']
    if source == 'netease':
        row = (result.get('data') or [{}])[0]
        if row.get('freeTrialInfo'):
            raise ValueError('当前账号只能试听，完整播放需要对应会员或购买权益')
        url = row.get('url')
    else:
        data = result.get('data') if isinstance(result.get('data'), dict) else result
        urls = data.get('url') or data.get('play_url') or ''
        url = urls[0] if isinstance(urls, list) and urls else urls
    if not isinstance(url, str) or not url.startswith(('https://', 'http://')):
        raise ValueError('平台未提供完整音源，请检查账号会员、购买权益或地区限制')
    return {'url': url, 'scope': 'private', 'message': '仅供本机账号试听，不会保存到公开歌单'}


def today_record(body: dict, today: str) -> dict | None:
    data = body.get('data') if isinstance(body.get('data'), dict) else body
    rows = data.get('list', [])
    if not isinstance(rows, list):
        raise ValueError('平台领取记录格式异常，未执行领取')
    return next((row for row in rows if isinstance(row, dict) and row.get('day') == today and row.get('receive_vip') == 1), None)


def claim_daily(*, force: bool = False) -> dict:
    today = datetime.now(CHINA).date().isoformat()
    # 跨日后台任务和手动按钮共用串行锁，领取前后均核对平台记录。
    with account_lock():
        value = state()
        account = value.get('kugou', {})
        if not account.get('cookie'):
            raise ValueError('请先登录酷狗概念版账号')
        previous = account.get('daily', {})
        if not force and previous.get('date') == today and (previous.get('status') == 'claimed' or time.time() - previous.get('attemptedAt', 0) < 3600):
            return previous
        cookie = account['cookie']
        outcome = {'date': today, 'status': 'pending', 'message': '正在核实平台领取记录'}
        submission_uncertain = False
        already_submitted = previous.get('date') == today and previous.get('status') in ('pending', 'unconfirmed')
        try:
            history = gateway('kugou', 'youth_month_vip_record', cookie=cookie)['body']
            if history.get('status') != 1:
                raise ValueError('无法确认平台领取记录，未执行领取；请检查登录状态')
            record = today_record(history, today)
            if record is None and not already_submitted:
                # 请求前持久化意图；断网或进程退出后只核实，避免自动重复提交。
                account['daily'] = {**outcome, 'attemptedAt': time.time()}
                save(value)
                submission_uncertain = True
                result = gateway('kugou', 'youth_day_vip', cookie=cookie)['body']
                submission_uncertain = False
                if result.get('status') != 1:
                    raise ValueError('平台未确认领取成功，请在概念版查看资格或完成必要操作')
            checked = gateway('kugou', 'youth_month_vip_record', cookie=cookie)['body']
            if checked.get('status') == 1 and today_record(checked, today):
                outcome = {'date': today, 'status': 'claimed', 'message': '平台记录已确认今日福利到账'}
            else:
                outcome = {'date': today, 'status': 'unconfirmed', 'message': '平台已受理，领取记录尚未确认，请稍后手动核实'}
        except ValueError as error:
            uncertain = submission_uncertain or already_submitted
            outcome = {'date': today, 'status': 'unconfirmed' if uncertain else 'failed', 'message': '领取请求结果尚未确认，将仅核实记录；请在手机端确认' if uncertain else str(error)}
        account['daily'] = outcome
        outcome['attemptedAt'] = time.time()
        save(value)
        return outcome


def auto_daily_loop(stop: threading.Event) -> None:
    while not stop.is_set():
        try:
            account = state().get('kugou', {})
            if account.get('cookie') and account.get('autoDailyVip'):
                claim_daily()
        except (ValueError, OSError):
            # 暂时的文件/网关失败不终止每日任务，也不记录账号敏感信息。
            pass
        stop.wait(300)
