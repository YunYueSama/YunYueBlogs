'use client';
import { useEffect, useState } from 'react';
import { managerApi } from '../../lib/managerApi';
type CloudState = { enabled?: boolean; revision?: string; checkedAt?: number; backup?: string };
export default function CloudContentStatus() {
  const [state, setState] = useState<CloudState>({});
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => { managerApi<CloudState>('/api/cloud/status').then(setState).catch(e => setError(e.message)).finally(() => setBusy(false)); }, []);
  const connect = async () => {
    setBusy(true); setError('');
    try { await managerApi('/api/cloud/connect', { method: 'POST' }); window.location.reload(); }
    catch (e) { setError(e instanceof Error ? e.message : '同步失败'); setBusy(false); }
  };
  return <section className="console-panel" aria-label="服务器内容同步" style={{marginBottom:20}}>
    <header><div><h2>{state.enabled ? '内容以服务器为准' : '连接服务器内容'}</h2><span>{state.enabled ? '文章、歌单和公开设置从远程博客仓库同步；修改后请通过发布页同步到其他设备。' : '本地旧内容会先备份，再读取服务器最新版本，避免覆盖其他设备的修改。'}</span></div>
    {state.enabled ? <button className="console-action secondary" onClick={() => window.location.reload()}>刷新服务器内容</button> : <button className="console-action" disabled={busy} onClick={() => void connect()}>{busy ? '连接中…' : '从服务器同步并启用'}</button>}</header>
    {state.enabled && <p className="muted">不同设备需要连接同一博客仓库；未发布修改、私密草稿和账号凭据仍保留在本机。</p>}
    {error && <p role="alert" className="form-status error">{error}</p>}
  </section>;
}
