'use client';
/* eslint-disable @next/next/no-img-element -- 二维码由本机音乐服务生成。 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { LoaderCircle, LogOut, QrCode, RefreshCw, ShieldCheck } from 'lucide-react';
import { managerApi } from '../../lib/managerApi';

type Source = 'netease' | 'kugou';
type Account = { loggedIn: boolean; nickname: string; autoDailyVip: boolean; daily?: { status?: string; message?: string; date?: string }; scheduler?: { enabled?: boolean; message?: string } };
type Overview = Record<Source, Account>;
type QR = { loginId: string; image: string; expiresIn: number };
const names = { netease: '网易云音乐', kugou: '酷狗概念版' };

export default function MusicAccounts({ preview }: { preview?: { source: Source; id: string; name?: string } | null }) {
  const [accounts, setAccounts] = useState<Overview | null>(null);
  const [qr, setQr] = useState<(QR & { source: Source }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [audio, setAudio] = useState('');
  const [previewName, setPreviewName] = useState('');
  const [audioTrack, setAudioTrack] = useState('');
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
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const expires = Date.now() + qr.expiresIn * 1000;
    const poll = async () => {
      if (Date.now() >= expires) { setQr(null); setMessage('二维码已过期，请重新获取'); return; }
      try {
        const result = await managerApi<{ status: string; message: string }>(`/api/music/accounts/${qr.source}/login/${qr.loginId}`, { signal: controller.signal });
        if (cancelled) return;
        setMessage(result.message);
        if (result.status === 'logged_in' || result.status === 'expired') {
          setQr(null);
          await refresh();
          return;
        }
      } catch (error) {
        if (cancelled) return;
        setMessage(error instanceof Error ? error.message : '登录状态读取失败');
      }
      if (!cancelled) timer = setTimeout(() => void poll(), 2500);
    };
    timer = setTimeout(() => void poll(), 2000);
    return () => { cancelled = true; controller.abort(); clearTimeout(timer); };
  }, [qr, refresh]);

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
    void managerApi<{ url: string; message: string }>(`/api/music/accounts/${preview.source}/preview/${preview.id}`, { signal: controller.signal })
      .then((result) => { if (current === generation.current) { setAudioTrack(`${preview.source}:${preview.id}`); setPreviewName(preview.name || preview.id); setAudio(result.url); setMessage(result.message); } })
      .catch((error: Error) => { if (!controller.signal.aborted && current === generation.current) { setAudio(''); setMessage(error.message); } });
    return () => controller.abort();
  }, [preview]);

  return <section className="console-panel span-12 music-accounts">
    <header><div><h2>我的音乐账号</h2><span>手机扫码登录 · 本机账号试听 · 每日福利</span></div><ShieldCheck size={22} /></header>
    <div className="music-account-grid">{(['netease', 'kugou'] as const).map((source) => {
      const account = accounts?.[source];
      return <article key={source} className="music-account-card">
        <div><strong>{names[source]}</strong><span className={`integration-badge ${account?.loggedIn ? 'is-ready' : ''}`}>{account?.loggedIn ? account.nickname : accounts ? '未登录' : '读取中'}</span></div>
        {account?.loggedIn ? <button type="button" className="console-action secondary" disabled={busy} onClick={() => void run(async () => { setAudio(''); setQr(null); await managerApi(`/api/music/accounts/${source}`, { method: 'DELETE' }); setMessage('已退出并清除本机登录凭据'); })}><LogOut size={15} />退出账号</button>
          : <button type="button" className="console-action secondary" disabled={busy || !accounts} onClick={() => void run(async () => { setQr(null); const result = await managerApi<QR>(`/api/music/accounts/${source}/login`, { method: 'POST' }); setQr({ ...result, source }); setMessage(`请使用${names[source]}手机端扫码并确认`); })}>{busy ? <LoaderCircle size={15} className="animate-spin" /> : <QrCode size={15} />}扫码登录</button>}
        {source === 'kugou' && account?.loggedIn && <>
          <label className="music-daily-toggle"><input type="checkbox" checked={account.autoDailyVip} disabled={busy} onChange={(event) => void run(() => managerApi('/api/music/accounts/kugou/daily', { method: 'PUT', body: JSON.stringify({ enabled: event.target.checked }) }))} />每天自动领取会员福利</label>
          <p>{account.daily?.date && `${account.daily.date} · `}{account.daily?.message || '领取前后会核对平台记录，仅在记录确认后显示到账'}</p>
          <small>{account.scheduler?.message || '窗口运行期间会自动检查领取资格'}</small>
          <button type="button" className="console-action secondary" disabled={busy} onClick={() => void run(async () => { const result = await managerApi<{ message: string }>('/api/music/accounts/kugou/daily', { method: 'POST' }); setMessage(result.message); })}><RefreshCw size={15} />领取 / 核实今日福利</button>
        </>}
      </article>;
    })}</div>
    {qr && <div className="music-login-qr"><img src={qr.image} width={192} height={192} alt={`${names[qr.source]}登录二维码`} /><div><strong>使用{names[qr.source]}扫码</strong><p>二维码有效期 3 分钟，请在手机端确认。</p><button type="button" className="console-action secondary" onClick={() => { setQr(null); setMessage('已取消扫码'); }}>取消扫码</button></div></div>}
    {message && <p className="console-note" role="status">{message}</p>}
    {audio && audioTrack === `${preview?.source}:${preview?.id}` && <div className="music-private-preview"><strong>本机试听 · {previewName}</strong><audio controls src={audio} preload="none" onError={() => { setAudio(''); setMessage('音源已失效或连接失败，请再次点击本机试听'); }} /></div>}
    <p className="console-note">账号权益仅用于本机试听。公开博客始终使用匿名音源；会员歌曲能否完整播放取决于当前账号权益。每日福利遵守平台领取资格，必要时请在手机端完成操作。</p>
  </section>;
}
