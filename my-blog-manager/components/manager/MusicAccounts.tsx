'use client';
/* eslint-disable @next/next/no-img-element -- 二维码由本机音乐服务生成。 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Gift, Headphones, LoaderCircle, LogOut, QrCode, RefreshCw, ShieldCheck, Smartphone, X } from 'lucide-react';
import MusicSourceIcon from './MusicSourceIcon';
import { managerApi } from '../../lib/managerApi';

type Source = 'netease' | 'kugou';
type Account = { loggedIn: boolean; nickname: string; autoDailyVip: boolean; daily?: { status?: string; message?: string; date?: string }; membership?: { status?: string; message?: string }; scheduler?: { enabled?: boolean; message?: string } };
type Overview = Record<Source, Account>;
type QR = { loginId: string; image: string; expiresIn: number };
const names = { netease: '网易云音乐', kugou: '酷狗概念版' };

export default function MusicAccounts({ preview, onClosePreview }: { preview?: { source: Source; id: string; name?: string; albumId?: string; albumAudioId?: string } | null; onClosePreview?: () => void }) {
  const [accounts, setAccounts] = useState<Overview | null>(null);
  const [qr, setQr] = useState<(QR & { source: Source }) | null>(null);
  const [phoneSource, setPhoneSource] = useState<Source | null>(null);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [smsId, setSmsId] = useState('');
  const [retryAt, setRetryAt] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [audio, setAudio] = useState('');
  const [previewName, setPreviewName] = useState('');
  const [audioTrack, setAudioTrack] = useState('');
  const [previewState, setPreviewState] = useState<{ loading: boolean; message: string }>({ loading: false, message: '' });
  const audioRef = useRef<HTMLAudioElement>(null);
  const generation = useRef(0);
  const alive = useRef(true);
  const refresh = useCallback(async () => {
    const result = await managerApi<Overview>('/api/music/accounts');
    if (alive.current) setAccounts(result);
  }, []);

  useEffect(() => {
    alive.current = true;
    void refresh().catch((error: Error) => setMessage(error.message));
    const timer = setInterval(() => void refresh().catch(() => {}), 30_000);
    return () => { alive.current = false; clearInterval(timer); };
  }, [refresh]);

  useEffect(() => {
    if (!qr) return;
    let failures = 0;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const expires = Date.now() + qr.expiresIn * 1000;
    const poll = async () => {
      if (Date.now() >= expires) { setQr(null); setMessage('二维码已过期，请重新获取'); return; }
      try {
        const result = await managerApi<{ status: string; message: string }>(`/api/music/accounts/${qr.source}/login/${qr.loginId}`, { signal: controller.signal });
        if (cancelled) return;
        failures = 0;
        setMessage(result.message);
        if (result.status === 'logged_in' || result.status === 'expired') {
          setQr(null);
          await refresh();
          return;
        }
      } catch (error) {
        if (cancelled) return;
        failures++;
        setMessage(error instanceof Error ? error.message : '登录状态读取失败');
        if (failures >= 3) { setMessage('连续读取扫码状态失败，请点击“重新检查”或切换手机号登录；手机端显示成功不代表本机已收到凭据。'); return; }
      }
      if (!cancelled) timer = setTimeout(() => void poll(), 2500);
    };
    timer = setTimeout(() => void poll(), 2000);
    return () => { cancelled = true; controller.abort(); clearTimeout(timer); };
  }, [qr, refresh]);

  useEffect(() => {
    const update = () => setRemaining(Math.max(0, Math.ceil((retryAt - Date.now()) / 1000)));
    update(); const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [retryAt]);

  const cancelLogin = () => {
    if (qr) void managerApi(`/api/music/accounts/${qr.source}/login/${qr.loginId}`, { method: 'DELETE' }).catch(() => {});
    if (smsId && phoneSource) void managerApi(`/api/music/accounts/${phoneSource}/login/${smsId}`, { method: 'DELETE' }).catch(() => {});
    setQr(null); setSmsId(''); setCode(''); setPhone(''); setPhoneSource(null); setMessage('');
  };

  const run = async (action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true); setMessage('');
    try { await action(); await refresh(); }
    catch (error) { if (alive.current) setMessage(error instanceof Error ? error.message : '操作失败，请重试'); }
    finally { if (alive.current) setBusy(false); }
  };

  useEffect(() => {
    const current = ++generation.current;
    if (!preview) return;
    const controller = new AbortController();
    setAudio('');
    setPreviewState({ loading: true, message: '正在使用已登录账号获取音源…' });
    const params = new URLSearchParams({ albumId: preview.albumId || '', albumAudioId: preview.albumAudioId || '' });
    void managerApi<{ url: string; message: string }>(`/api/music/accounts/${preview.source}/preview/${preview.id}?${params}`, { signal: controller.signal })
      .then((result) => { if (current === generation.current) { setAudioTrack(`${preview.source}:${preview.id}`); setPreviewName(preview.name || preview.id); setAudio(result.url); setPreviewState({ loading: false, message: result.message }); } })
      .catch((error: Error) => { if (!controller.signal.aborted && current === generation.current) { setAudio(''); setPreviewState({ loading: false, message: error.message }); } });
    return () => controller.abort();
  }, [preview]);

  useEffect(() => {
    if (!preview || !audio || audioTrack !== `${preview.source}:${preview.id}`) return;
    void audioRef.current?.play().catch(() => setPreviewState({ loading: false, message: '音源已就绪，请点击播放器的播放按钮开始播放。' }));
  }, [audio, audioTrack, preview]);

  return <section className="console-panel span-12 music-accounts">
    <header><div><h2><Headphones size={19} />我的音乐账号</h2><span>登录你的音乐平台，让歌单与账号权益各就其位。</span></div><span className="music-local-badge"><ShieldCheck size={14} />仅保存在本机</span></header>
    <div className="music-account-grid">{(['netease', 'kugou'] as const).map((source) => {
      const account = accounts?.[source];
      return <article key={source} className={`music-account-card is-${source}`}>
        <div className="music-account-heading"><MusicSourceIcon source={source} size={42} /><div><strong>{names[source]}</strong><small className="music-account-state"><i className={account?.loggedIn ? 'is-ready' : ''} />{account?.loggedIn ? account.nickname || '已登录账号' : accounts ? '未登录 · 选择一种登录方式' : '正在读取账号…'}</small></div></div>
        {account?.loggedIn ? <button type="button" className="console-action secondary" disabled={busy} onClick={() => void run(async () => { setAudio(''); setQr(null); await managerApi(`/api/music/accounts/${source}`, { method: 'DELETE' }); setMessage('已退出并清除本机登录凭据'); })}><LogOut size={15} />退出账号</button>
          : <div className="music-login-methods"><button type="button" className="console-action secondary" disabled={busy || !accounts} onClick={() => void run(async () => { cancelLogin(); const result = await managerApi<QR>(`/api/music/accounts/${source}/login`, { method: 'POST' }); setQr({ ...result, source }); setMessage(`请使用${names[source]}手机端扫码并确认`); })}>{busy ? <LoaderCircle size={15} className="animate-spin" /> : <QrCode size={15} />}扫码登录</button><button type="button" className="console-action secondary" disabled={busy || !accounts} onClick={() => { cancelLogin(); setPhoneSource(source); }}><Smartphone size={15} />手机号登录</button></div>}
        {source === 'kugou' && account?.loggedIn && <div className="music-daily-benefit">
          <strong><Gift size={16} />每日会员福利</strong>
          <label className="music-daily-toggle"><input type="checkbox" checked={account.autoDailyVip} disabled={busy} onChange={(event) => void run(() => managerApi('/api/music/accounts/kugou/daily', { method: 'PUT', body: JSON.stringify({ enabled: event.target.checked }) }))} />每天自动领取会员福利</label>
          <p>{account.daily?.date && `${account.daily.date} · `}{account.daily?.message || '领取前后会核对平台记录，仅在记录确认后显示到账'}</p>
          {account.membership?.message && <p>{account.membership.message}</p>}
          <details><summary>后台检查与领取说明</summary><small>{account.scheduler?.message || '窗口运行期间会自动检查领取资格'}</small></details>
          <button type="button" className="console-action secondary" disabled={busy} onClick={() => void run(async () => { const result = await managerApi<{ message: string }>('/api/music/accounts/kugou/daily', { method: 'POST' }); setMessage(result.message); })}><RefreshCw size={15} />领取 / 核实今日福利</button>
        </div>}
      </article>;
    })}</div>
    {qr && <div className="music-login-qr"><img src={qr.image} width={192} height={192} alt={`${names[qr.source]}登录二维码`} /><div><strong>使用{names[qr.source]}扫码</strong><p>请在手机端确认登录，成功后这里会自动更新账号状态。</p><button type="button" className="console-action secondary" disabled={busy} onClick={() => { setQr({ ...qr }); setMessage("正在重新检查扫码状态…"); }}><RefreshCw size={15} />重新检查</button><button type="button" className="console-action secondary" onClick={() => { cancelLogin(); setMessage('已取消扫码'); }}>取消扫码</button></div></div>}
    {phoneSource && <form className="music-phone-login" onSubmit={(event) => { event.preventDefault(); if (!smsId || busy) return; void run(async () => { const result = await managerApi<{ message: string }>(`/api/music/accounts/${phoneSource}/sms/login`, { method: 'POST', body: JSON.stringify({ loginId: smsId, code }) }); setMessage(result.message); setPhoneSource(null); setPhone(''); setCode(''); setSmsId(''); }); }}>
      <h3><MusicSourceIcon source={phoneSource} size={24} />{names[phoneSource]} · 手机号验证码登录</h3>
      <label>中国大陆手机号<input type="tel" inputMode="numeric" autoComplete="tel-national" maxLength={11} value={phone} disabled={busy || !!smsId} onChange={(event) => setPhone(event.target.value.replace(/\D/g, ''))} placeholder="请输入 11 位手机号" required pattern="1[3-9][0-9]{9}" /></label>
      <div className="music-phone-code"><label>短信验证码<input inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))} placeholder="4 至 8 位验证码" disabled={busy || !smsId} /></label><button type="button" className="console-action secondary" disabled={busy || remaining > 0 || !/^1[3-9]\d{9}$/.test(phone)} onClick={() => void run(async () => { setRetryAt(Date.now() + 60000); const result = await managerApi<{ loginId: string; retryAfter: number; message: string }>(`/api/music/accounts/${phoneSource}/sms/send`, { method: 'POST', body: JSON.stringify({ phone }) }); setSmsId(result.loginId); setRetryAt(Date.now() + result.retryAfter * 1000); setMessage(result.message); })}>{remaining > 0 ? `${remaining} 秒后重发` : smsId ? '重新发送' : '获取验证码'}</button></div>
      <div className="music-login-methods"><button type="submit" className="console-action" disabled={busy || !smsId || !/^\d{4,8}$/.test(code)}>{busy ? '处理中…' : '验证并登录'}</button><button type="button" className="console-action secondary" disabled={busy} onClick={cancelLogin}>取消 / 更换登录方式</button></div>
      <small>只向对应音乐平台发送手机号和验证码，凭据加密保存在本机。若平台要求安全验证，请在官方手机端完成。</small>
    </form>}
    {message && <p className="console-note" role="status">{message}</p>}
    {preview && <div className="music-private-preview" role="region" aria-label="本机账号播放"><div className="music-preview-heading"><MusicSourceIcon source={preview.source} size={24} /><strong>本机播放 · {preview.name || previewName || preview.id}</strong><button className="console-icon" type="button" aria-label="关闭播放" onClick={onClosePreview}><X size={18} /></button></div><p role="status">{previewState.loading ? <LoaderCircle size={16} className="animate-spin" /> : null}{previewState.message}</p>{audio && audioTrack === `${preview.source}:${preview.id}` && <audio ref={audioRef} controls src={audio} preload="metadata" onError={() => { setAudio(''); setPreviewState({ loading: false, message: '音源已失效或连接失败，请再次点击歌曲旁的音符按钮重试。' }); }} />}</div>}
    <p className="console-note">本机账号用于试听；公开博客可单独配置 Vercel 服务端账号。会员歌曲能否完整播放取决于该账号的有效权益。退出本机账号不会删除 Vercel 中的凭据。每日福利遵守平台领取资格，必要时请在官方 App 完成操作。</p>
  </section>;
}
