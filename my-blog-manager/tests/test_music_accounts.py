import json
from datetime import datetime

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from cms_core import music_accounts as accounts
from cms_core.api.music_accounts import router


@pytest.fixture
def local_account(tmp_path, monkeypatch):
    monkeypatch.setattr(accounts, 'CONFIG_ROOT', tmp_path)
    monkeypatch.setattr(accounts, 'ensure_workspace', lambda: None)
    accounts.PENDING.clear()
    accounts.SMS_PENDING.clear()
    accounts.SMS_SENT.clear()
    accounts.save({'kugou': {'cookie': {'token': 'private-test-token', 'userid': '42'}, 'autoDailyVip': True}})
    yield tmp_path
    accounts.PENDING.clear()
    accounts.SMS_PENDING.clear()
    accounts.SMS_SENT.clear()


def history(received):
    return {'body': {'status': 1, 'data': {'list': [{'day': datetime.now(accounts.CHINA).date().isoformat(), 'receive_vip': int(received)}]}}}


def test_existing_record_does_not_claim_again(local_account, monkeypatch):
    calls = []
    def gateway(source, action, **kwargs):
        calls.append(action)
        return history(True)
    monkeypatch.setattr(accounts, 'gateway', gateway)
    assert accounts.claim_daily()['status'] == 'claimed'
    assert calls == ['youth_month_vip_record', 'youth_month_vip_record']
    accounts.claim_daily()
    assert len(calls) == 2


def test_claim_requires_confirmation_not_just_acceptance(local_account, monkeypatch):
    replies = iter([history(False), {'body': {'status': 1}}, history(False)])
    monkeypatch.setattr(accounts, 'gateway', lambda *args, **kwargs: next(replies))
    assert accounts.claim_daily()['status'] == 'unconfirmed'
    calls = []
    def recheck(source, action, **kwargs):
        calls.append(action)
        return history(False)
    monkeypatch.setattr(accounts, 'gateway', recheck)
    assert accounts.claim_daily(force=True)['status'] == 'unconfirmed'
    assert 'youth_day_vip' not in calls


def test_confirmed_claim(local_account, monkeypatch):
    replies = iter([history(False), {'body': {'status': 1}}, history(True)])
    monkeypatch.setattr(accounts, 'gateway', lambda *args, **kwargs: next(replies))
    assert accounts.claim_daily()['status'] == 'claimed'


def test_history_failure_prevents_claim(local_account, monkeypatch):
    calls = []
    def gateway(source, action, **kwargs):
        calls.append(action)
        return {'body': {'status': 0}}
    monkeypatch.setattr(accounts, 'gateway', gateway)
    assert accounts.claim_daily()['status'] == 'failed'
    assert calls == ['youth_month_vip_record']


def test_public_responses_hide_credentials_and_reject_remote_origin(local_account):
    app = FastAPI()
    app.include_router(router, prefix='/api/music/accounts')
    client = TestClient(app, base_url='http://127.0.0.1')
    response = client.get('/api/music/accounts')
    assert response.json()['data']['kugou']['loggedIn']
    assert 'private-test-token' not in response.text
    assert 'protectedCookie' not in response.text
    assert response.headers['cache-control'] == 'no-store'
    assert client.post('/api/music/accounts/kugou/daily', headers={'Origin': 'https://example.org'}).status_code == 403


def test_qr_is_scoped_to_source_and_expires(local_account):
    accounts.PENDING['login'] = {'source': 'kugou', 'expires': 0}
    assert accounts.poll_login('netease', 'login')['status'] == 'expired'
    assert accounts.poll_login('kugou', 'login')['status'] == 'expired'


def test_successful_qr_login_keeps_credentials_private(local_account, monkeypatch):
    replies = iter([
        {'body': {'data': {'unikey': 'key'}}},
        {'body': {'data': {'qrimg': 'data:image/png;base64,fixture'}}},
        {'body': {'code': 803, 'cookie': 'MUSIC_U=login-secret; Path=/'}, 'cookies': []},
    ])
    monkeypatch.setattr(accounts, 'gateway', lambda *args, **kwargs: next(replies))
    login = accounts.begin_login('netease')
    result = accounts.poll_login('netease', login['loginId'])
    assert result['status'] == 'logged_in'
    assert 'login-secret' not in json.dumps(result)
    assert accounts.state()['netease']['cookie']['MUSIC_U'] == 'login-secret'
    assert 'login-secret' not in json.dumps(accounts.overview())


def test_trial_is_not_complete_audio(local_account, monkeypatch):
    accounts.save({'netease': {'cookie': {'MUSIC_U': 'fake'}}})
    monkeypatch.setattr(accounts, 'gateway', lambda *args, **kwargs: {'body': {'data': [{'url': 'https://example.org/trial', 'freeTrialInfo': {'end': 30}}]}})
    with pytest.raises(ValueError, match='只能试听'):
        accounts.private_playback('netease', '501660')


def test_windows_storage_is_protected(local_account):
    import os
    if os.name == 'nt':
        raw = (local_account / 'music-accounts.json').read_text()
        assert 'private-test-token' not in raw
        assert 'protectedCookie' in json.loads(raw)['kugou']
        assert accounts.state()['kugou']['cookie']['token'] == 'private-test-token'


@pytest.mark.parametrize('source', ['netease', 'kugou'])
def test_sms_login_is_scoped_private_and_throttled(local_account, monkeypatch, source):
    monkeypatch.setattr('music_runtime.configure_daily_task', lambda enabled: {'enabled': enabled})
    calls = []
    def gateway(provider, action, params=None, cookie=None):
        calls.append((provider, action, params, cookie))
        if action == 'captcha_sent':
            return {'body': {'code': 200, 'status': 1}, 'cookies': ['KUGOU_API_DEV=DEVICE']}
        if source == 'netease':
            return {'body': {'code': 200, 'profile': {'nickname': '测试账号'}, 'cookie': 'MUSIC_U=secret-sms; Path=/'}}
        return {'body': {'status': 1, 'data': {'nickname': '测试账号', 'token': 'secret-sms', 'userid': 42}}}
    monkeypatch.setattr(accounts, 'gateway', gateway)
    session = accounts.send_sms(source, '13800000000')
    assert '13800000000' not in json.dumps(session)
    with pytest.raises(ValueError, match='60 秒'):
        accounts.send_sms(source, '13800000000')
    other = 'kugou' if source == 'netease' else 'netease'
    with pytest.raises(ValueError, match='过期'):
        accounts.login_sms(other, session['loginId'], '123456')
    result = accounts.login_sms(source, session['loginId'], '123456')
    assert result['status'] == 'logged_in'
    assert accounts.overview()[source]['loggedIn']
    assert 'secret-sms' not in json.dumps(accounts.overview())
    assert '13800000000' not in (local_account / 'music-accounts.json').read_text()
    assert calls[-1][3]['KUGOU_API_DEV'] == 'DEVICE'
    with pytest.raises(ValueError, match='过期'):
        accounts.login_sms(source, session['loginId'], '123456')


def test_failed_sms_or_invalid_phone_does_not_create_session(local_account, monkeypatch):
    monkeypatch.setattr(accounts, 'gateway', lambda *args: {'body': {'status': 0, 'challenge': True}})
    with pytest.raises(ValueError, match='手机号'):
        accounts.send_sms('kugou', 'not-a-phone')
    with pytest.raises(ValueError, match='安全验证'):
        accounts.send_sms('kugou', '13800000000')
    assert not accounts.SMS_PENDING


def test_cancelled_sms_and_invalid_qr_status_are_not_waiting_forever(local_account, monkeypatch):
    accounts.SMS_PENDING['session'] = {'source': 'kugou'}
    accounts.cancel_login('kugou', 'session')
    assert not accounts.SMS_PENDING
    accounts.PENDING['session'] = {'source': 'kugou', 'key': 'test', 'cookie': {}, 'expires': accounts.time.monotonic() + 60}
    monkeypatch.setattr(accounts, 'gateway', lambda *args: {'body': {'status': 0, 'data': {}}})
    with pytest.raises(ValueError, match='有效扫码状态'):
        accounts.poll_login('kugou', 'session')
