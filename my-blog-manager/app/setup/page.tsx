'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, LogIn, LoaderCircle, ShieldCheck } from 'lucide-react';
import { managerApi } from '../../lib/managerApi';

type SetupStatus = { account: { login: string } | null; login: { status: string; code: string; url: string }; completed: boolean };
type SetupJob = { status: string; message: string; repository?: string };

export default function SetupPage() {
  const router = useRouter();
  const [status, setStatus] = useState<SetupStatus>();
  const [mode, setMode] = useState('existing');
  const [repository, setRepository] = useState('');
  const [branch, setBranch] = useState('main');
  const [name, setName] = useState('my-blog');
  const [title, setTitle] = useState('我的博客');
  const [author, setAuthor] = useState('博主');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [jobId, setJobId] = useState('');
  const [job, setJob] = useState<SetupJob>();
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const next = await managerApi<SetupStatus>('/api/onboarding/status');
        if (!stopped) { setStatus(next); setError(''); }
      } catch (reason) { if (!stopped) setError(reason instanceof Error ? reason.message : '无法读取连接状态'); }
      if (!stopped) timer = setTimeout(refresh, 4000);
    };
    void refresh();
    return () => { stopped = true; clearTimeout(timer); };
  }, []);
  useEffect(() => {
    if (!jobId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const next = await managerApi<SetupJob>(`/api/onboarding/jobs/${jobId}`);
        if (stopped) return;
        setJob(next);
        if (next.status === 'running') timer = setTimeout(refresh, 1200);
        else setBusy(false);
      } catch (reason) {
        if (!stopped) { setError(reason instanceof Error ? reason.message : '状态暂时无法读取，连接任务可能仍在运行，请稍后重试'); timer = setTimeout(refresh, 4000); }
      }
    };
    void refresh();
    return () => { stopped = true; clearTimeout(timer); };
  }, [jobId]);
  const login = async () => {
    setError('');
    try { await managerApi('/api/onboarding/login', { method: 'POST' }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '登录未完成'); }
  };
  const connect = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setJob(undefined);
    try {
      const next = await managerApi<{ jobId: string }>('/api/onboarding/connect', {
        method: 'POST', body: JSON.stringify({ mode, repository, branch, name, title, author }),
      });
      setJobId(next.jobId);
    } catch (reason) { setBusy(false); setError(reason instanceof Error ? reason.message : '连接未完成'); }
  };
  const connected = status?.completed || job?.status === 'succeeded';
  return <section className="console-panel setup-panel">
    <header><div><h1>让你的博客在这里安家</h1><span>连接已有博客，或从这套博客基础创建自己的站点。</span></div><ShieldCheck size={28} /></header>
    <p className="console-note">内容与草稿保存在当前 Windows 用户的独立工作区。安装包不包含作者的账号、私密草稿或发布凭据。</p>
    {connected ? <div className="setup-success"><CheckCircle2 size={32} /><h2>博客已连接</h2><p>{job?.message || '可以开始管理已有内容。'}</p><button className="console-action" onClick={() => router.push('/admin')}>进入管理端</button>
      {mode === 'new' && <p>上线还需在 Vercel 导入刚创建的私有仓库，框架选择 Astro，生产分支使用 {branch}。<a href="https://vercel.com/new" target="_blank" rel="noreferrer">前往部署博客 ↗</a></p>}</div>
      : <form className="console-form" onSubmit={connect}>
        <div className="setup-account"><LogIn size={22} /><div><strong>第一步 · 登录你的 GitHub</strong><p>{status?.account ? `已登录 ${status.account.login}` : '通过 GitHub 官方授权页面登录，不需要在这里填写密码或 Token。'}</p></div>
          <button className="console-action secondary" type="button" onClick={() => void login()} disabled={busy || status?.login.status === 'running'}>{status?.account ? '切换账号' : '登录 GitHub'}</button></div>
        {status?.login.status === 'running' && <div className="form-status">{status.login.code ? <>授权码：<strong>{status.login.code}</strong> · <a href={status.login.url} target="_blank" rel="noreferrer">打开 GitHub 授权页面 ↗</a></> : '正在准备 GitHub 授权页面…'}</div>}
        {status?.login.status === 'failed' && <p className="form-status error">登录未完成或授权已过期，可以重新登录。</p>}
        <fieldset className="setup-modes" disabled={busy}><legend>第二步 · 选择博客</legend>
          <label><input type="radio" name="mode" checked={mode === 'existing'} onChange={() => setMode('existing')} /><strong>连接已有博客</strong><span>在新设备继续管理原来的文章、图库和音乐。</span></label>
          <label><input type="radio" name="mode" checked={mode === 'new'} onChange={() => setMode('new')} /><strong>创建自己的博客</strong><span>创建你名下的私有仓库，以空白内容开始个性化。</span></label>
        </fieldset>
        {mode === 'existing' ? <div className="form-field"><label htmlFor="setup-repository">GitHub 博客仓库地址</label><input id="setup-repository" required type="url" value={repository} disabled={busy} onChange={event => setRepository(event.target.value)} placeholder="https://github.com/你的用户名/你的博客仓库" /><small>选择你拥有推送权限的 YunYueBlog 仓库。现有 Vercel 项目和网址保持不变。</small></div>
          : <><div className="form-field"><label htmlFor="setup-name">新仓库名称</label><input id="setup-name" required pattern="[A-Za-z0-9][A-Za-z0-9_.-]{0,79}" value={name} disabled={busy} onChange={event => setName(event.target.value)} /><small>将使用当前 GitHub 账号创建私有仓库并上传初始博客代码。</small></div><div className="form-grid"><div className="form-field"><label htmlFor="setup-title">博客名称</label><input id="setup-title" required maxLength={100} value={title} disabled={busy} onChange={event => setTitle(event.target.value)} /></div><div className="form-field"><label htmlFor="setup-author">作者名称</label><input id="setup-author" required maxLength={50} value={author} disabled={busy} onChange={event => setAuthor(event.target.value)} /></div></div></>}
        <div className="form-field"><label htmlFor="setup-branch">目标分支</label><input id="setup-branch" required value={branch} disabled={busy} onChange={event => setBranch(event.target.value)} /><small>已有博客应与原生产分支一致，通常为 main。</small></div>
        {job && <p role="status" className={`form-status ${job.status === 'failed' ? 'error' : ''}`}>{job.message}</p>}
        {error && <p role="alert" className="form-status error">{error}</p>}
        <button className="console-action" type="submit" disabled={busy || !status?.account}>{busy && <LoaderCircle className="spin" size={16} />}{busy ? '正在连接…' : mode === 'new' ? '创建仓库并连接' : '下载内容并连接'}</button>
      </form>}
  </section>;
}
