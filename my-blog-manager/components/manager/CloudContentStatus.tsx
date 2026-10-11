'use client';
import { useEffect, useState } from 'react';
import { managerApi } from '../../lib/managerApi';
import { useNavigationGuard } from '../../context/NavigationGuardContext';
import { usePathname } from 'next/navigation';

type CloudState = { enabled?: boolean; revision?: string; checkedAt?: number; checking?: boolean; checkError?: string; updateAvailable?: boolean };
export default function CloudContentStatus() {
  const pathname = usePathname();
  const [state, setState] = useState<CloudState>({});
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [statusError, setStatusError] = useState('');
  const { navigate } = useNavigationGuard();
  useEffect(() => {
    if (pathname === '/setup') return;
    const controller = new AbortController();
    const read = (initial = false) => managerApi<CloudState>('/api/cloud/status', { signal: controller.signal }).then((next) => { setState(next); setStatusError(''); }).catch((reason) => {
      if (!controller.signal.aborted) setStatusError(reason instanceof Error ? reason.message : '无法读取同步状态');
    }).finally(() => { if (initial && !controller.signal.aborted) setBusy(false); });
    void read(true);
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void read(); }, 5_000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [pathname]);
  const synchronize = async () => {
    setBusy(true); setError('');
    try {
      if (state.enabled) await managerApi('/api/cloud/refresh');
      else await managerApi('/api/cloud/connect', { method: 'POST' });
      window.location.reload();
    } catch (reason) { setError(reason instanceof Error ? reason.message : '同步失败'); setBusy(false); }
  };
  if (pathname === '/setup') return null;
  return <section className="console-panel cloud-content-status" aria-label="服务器内容同步" style={{ marginBottom: 20 }}>
    <header><div><h2>{state.enabled ? state.updateAvailable ? '服务器有新内容' : '正在使用本地内容快照' : '连接服务器内容'}</h2><span>{state.enabled ? '浏览使用最近同步的内容；检查服务器更新不会替换正在编辑的文档。' : '首次连接会备份本地内容，再读取服务器最新版本。'}</span></div>
      <button className="console-action secondary" disabled={busy} onClick={() => navigate(() => { void synchronize(); })}>{busy ? '正在同步…' : state.enabled ? '更新服务器内容' : '从服务器同步并启用'}</button></header>
    {state.enabled && <p className="console-note" aria-live="polite">最近同步：{state.checkedAt ? new Date(state.checkedAt * 1000).toLocaleString() : '尚无记录'}{state.checking ? ' · 正在后台检查更新' : state.updateAvailable ? ' · 有新内容，更新前会先处理未保存的编辑' : ''}。保存与发布前仍会核对服务器版本。</p>}
    {(error || statusError || state.checkError) && <p role="status" className="form-status">{error || statusError || state.checkError}</p>}
  </section>;
}
