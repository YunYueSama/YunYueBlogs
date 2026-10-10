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


def vip(active=True):
    return {'body': {'status': 1, 'busi_vip': [{'busi_type': 'concept', 'product_type': 'svip', 'is_vip': int(active)}]}}


def test_existing_record_does_not_claim_again(local_account, monkeypatch):
    calls = []
    def gateway(source, action, **kwargs):
        calls.append(action)
        return vip() if action == 'user_vip_detail' else history(True)
    monkeypatch.setattr(accounts, 'gateway', gateway)
    assert accounts.claim_daily()['status'] == 'claimed'
    assert calls == ['youth_month_vip_record', 'youth_month_vip_record', 'user_vip_detail']
    accounts.claim_daily()
    assert len(calls) == 3


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
    replies = iter([history(False), {'body': {'status': 1}}, history(True), vip()])
    monkeypatch.setattr(accounts, 'gateway', lambda *args, **kwargs: next(replies))
    assert accounts.claim_daily()['status'] == 'claimed'


def test_daily_upgrade_requires_concept_svip_confirmation_and_runs_once(local_account, monkeypatch):
    basic = history(True)
    basic['body']['data']['list'][0]['vip_type'] = 'tvip'
    calls = []
    def gateway(source, action, params=None, cookie=None):
        calls.append(action)
        if action == 'youth_day_vip_upgrade':
            return {'body': {'status': 1}}
        return vip(False) if action == 'user_vip_detail' else basic
    monkeypatch.setattr(accounts, 'gateway', gateway)
    assert accounts.claim_daily()['status'] == 'record_confirmed'
    assert calls.count('youth_day_vip_upgrade') == 1
    assert 'youth_day_vip' not in calls
    accounts.claim_daily(force=True)
    assert calls.count('youth_day_vip_upgrade') == 1


def test_daily_claim_sends_current_china_date(local_account, monkeypatch):
    def gateway(source, action, params=None, cookie=None):
        if action == 'youth_day_vip':
            assert params['receive_day'] == datetime.now(accounts.CHINA).date().isoformat()
            return {'body': {'status': 0}}
        return history(False)
    monkeypatch.setattr(accounts, 'gateway', gateway)
    assert accounts.claim_daily()['status'] == 'failed'


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


def test_kugou_preview_ignores_stale_catalog_ids_and_passes_cookie(local_account, monkeypatch):
    calls = []
    def gateway(source, action, params, cookie):
        calls.append((source, action, params, cookie))
        return {'body': {'data': {'url': ['https://example.org/full.mp3']}}}
    monkeypatch.setattr(accounts, 'gateway', gateway)
    assert accounts.private_playback('kugou', 'A' * 32, album_id='123', album_audio_id='456')['url'].endswith('/full.mp3')
    assert calls[0][2]['album_id'] == '0'
    assert calls[0][2]['album_audio_id'] == '0'
    assert calls[0][2]['hash'] == 'A' * 32
    assert calls[0][3]['token'] == 'private-test-token'


def test_kugou_preview_rejects_trial(local_account, monkeypatch):
    monkeypatch.setattr(accounts, 'gateway', lambda *args, **kwargs: {'body': {'data': {'url': ['https://example.org/trial'], 'is_free_part': 1}}})
    with pytest.raises(ValueError, match='只能试听'):
        accounts.private_playback('kugou', 'A' * 32)


def test_kugou_catalog_mismatch_cannot_select_other_song(local_account, monkeypatch):
    calls = []
    def gateway(source, action, params, cookie):
        calls.append(params)
        assert params['album_audio_id'] == '0'
        return {'body': {'url': ['https://example.org/full.mp3']}}
    monkeypatch.setattr(accounts, 'gateway', gateway)
    assert accounts.private_playback('kugou', 'A' * 32, album_audio_id='456')['url'].endswith('/full.mp3')
    assert len(calls) == 1
    assert calls[0]['hash'] == 'A' * 32


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
