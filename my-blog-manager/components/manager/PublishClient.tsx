'use client';

import { AlertTriangle, CheckCircle2, CloudUpload, ExternalLink, Eye, FolderGit2, GitCompareArrows, GitPullRequestArrow, LoaderCircle, RadioTower, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { managerApi } from '../../lib/managerApi';
import { watchDeployJob, type DeployJob as Job } from '../../lib/deployJob';

type DeployConfig = { blogPath: string; remote: string; branch: string; vercelProjectUrl: string };
type Change = { kind: 'add' | 'update' | 'delete' | 'unchanged'; path: string };
type Plan = { planId: string; canApply: boolean; changes: Change[]; warnings: string[]; dirtyFiles: string[] };
type RepositoryStatus = {
  path: string;
  branch: string;
  remote: string;
  remoteBranch: string;
  remoteBranchAvailable: boolean;
  dirtyFiles: string[];
  ahead: number;
  behind: number;
  canUpdate: boolean;
  message?: string;
};
type Phase = 'idle' | 'planned' | 'locked' | 'applied' | 'pushing' | 'succeeded' | 'failed';
type RepositoryAction = 'status' | 'fetch' | 'update';

const initialConfig: DeployConfig = { blogPath: '', remote: 'origin', branch: 'main', vercelProjectUrl: '' };

export default function PublishClient() {
  const [config, setConfig] = useState<DeployConfig>(initialConfig);
  const [message, setMessage] = useState('内容：通过星辉控制台同步博客');
  const [plan, setPlan] = useState<Plan | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [repository, setRepository] = useState<RepositoryStatus | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [busy, setBusy] = useState('load');
  const [notice, setNotice] = useState<{ error?: boolean; message: string } | null>(null);
  const [recentJobs, setRecentJobs] = useState<Job[]>([]);
  const polling = useRef<AbortController | null>(null);
  const mounted = useRef(true);

  const followJob = useCallback(async (jobId: string) => {
    if (!mounted.current) return;
    polling.current?.abort();
    const controller = new AbortController(); polling.current = controller;
    setBusy('push'); setPhase('pushing');
    try {
      const finished = await watchDeployJob(jobId,
        (id, signal) => managerApi<Job>(`/api/jobs/${id}`, { signal }),
        (next) => { setJob(next); setRecentJobs((current) => [next, ...current.filter((item) => item.jobId !== next.jobId)].slice(0, 10)); },
        controller.signal);
      if (finished) {
        setPhase(finished.status === 'succeeded' ? 'succeeded' : 'failed');
        setNotice({ error: finished.status === 'failed', message: finished.message });
      } else setNotice({ message: '任务仍在服务端执行。可以继续查看状态，或稍后返回此页。' });
    } catch (error) {
      if (!controller.signal.aborted) setNotice({ error: true, message: `${error instanceof Error ? error.message : '暂时无法获取任务状态'}；任务可能仍在执行，请继续查看状态。` });
    } finally { if (!controller.signal.aborted) setBusy(''); }
  }, []);

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    Promise.all([
      managerApi<DeployConfig>('/api/deploy/config', { signal: controller.signal }),
      managerApi<{ jobs: Job[] }>('/api/jobs', { signal: controller.signal }),
    ]).then(([saved, history]) => {
      setConfig({ ...initialConfig, ...saved }); setRecentJobs(history.jobs);
      const active = history.jobs.find((item) => item.status === 'queued' || item.status === 'running');
      if (active) { setJob(active); void followJob(active.jobId); }
      else { setJob(history.jobs[0] || null); setBusy(''); }
    }).catch((error) => {
      if (!controller.signal.aborted) { setNotice({ error: true, message: error instanceof Error ? error.message : '无法加载发布配置' }); setBusy(''); }
    });
    return () => { mounted.current = false; controller.abort(); polling.current?.abort(); };
  }, [followJob]);

  const changed = useMemo(() => plan?.changes.filter((item) => item.kind !== 'unchanged') ?? [], [plan]);
  const unresolvedJob = Boolean(job && ['queued', 'running'].includes(job.status));
  const configLocked = Boolean(busy) || unresolvedJob;
  const hasChineseMessage = /[\u3400-\u9fff]/.test(message);
  const repositoryPayload = { blogPath: config.blogPath, remote: config.remote, branch: config.branch };

  const resetPlan = () => {
    setPlan(null);
    setJob(null);
    setPhase('idle');
    setNotice(null);
  };

  const updateConfig = (next: DeployConfig) => {
    if (configLocked) return;
    setConfig(next);
    setRepository(null);
    resetPlan();
  };

  const repositoryAction = async (action: RepositoryAction) => {
    if (!config.blogPath || busy || unresolvedJob) return;
    setBusy(`repo-${action}`);
    setNotice(null);
    try {
      await managerApi('/api/deploy/config', { method: 'POST', body: JSON.stringify(config) });
      const result = await managerApi<RepositoryStatus>(`/api/deploy/repository/${action}`, { method: 'POST', body: JSON.stringify(repositoryPayload) });
      setRepository(result);
      if (action === 'update') resetPlan();
      setNotice({ message: result.message || (action === 'fetch' ? '远程引用已刷新。' : action === 'update' ? '本地仓库更新完成。' : '仓库状态检查完成。') });
    } catch (error) {
      setNotice({ error: true, message: error instanceof Error ? error.message : '仓库操作失败' });
    } finally {
      setBusy('');
    }
  };

  const preview = async () => {
    if (!config.blogPath || busy || unresolvedJob) return;
    setBusy('preview');
    setNotice(null);
    setJob(null);
    // 新预览完成之前，旧计划不能继续应用到当前工作区。
    setPlan(null);
    setPhase('idle');
    try {
      await managerApi('/api/deploy/config', { method: 'POST', body: JSON.stringify(config) });
      const next = await managerApi<Plan>('/api/sync/plan', { method: 'POST', body: JSON.stringify({ blogPath: config.blogPath }) });
      setPlan(next);
      setPhase(next.canApply ? 'planned' : 'locked');
      if (!next.canApply) setNotice({ error: true, message: '目标仓库存在未提交改动。请先处理下方文件，再重新生成预览。' });
    } catch (error) {
      setPlan(null);
      setPhase('failed');
      setNotice({ error: true, message: error instanceof Error ? error.message : '无法生成预览' });
    } finally {
      setBusy('');
    }
  };

  const apply = async () => {
    if (!plan?.canApply || phase !== 'planned' || busy) return;
    setBusy('apply');
    setNotice(null);
    try {
      await managerApi('/api/sync/apply', { method: 'POST', body: JSON.stringify({ blogPath: config.blogPath, planId: plan.planId }) });
      setPhase('applied');
      setNotice({ message: `已原子同步 ${changed.length} 项改动。请确认差异后创建中文提交。` });
    } catch (error) {
      setPhase('failed');
      setNotice({ error: true, message: error instanceof Error ? error.message : '同步失败' });
    } finally {
      setBusy('');
    }
  };

  const push = async () => {
    if (!plan || phase !== 'applied' || !hasChineseMessage || busy) return;
    setBusy('push');
    setPhase('pushing');
    setNotice(null);
    try {
      const queued = await managerApi<Job>('/api/deploy/push', {
        method: 'POST',
        body: JSON.stringify({ blogPath: config.blogPath, remote: config.remote, branch: config.branch, commitMessage: message }),
      });
      setJob(queued);
      await followJob(queued.jobId);
    } catch (error) {
      setPhase('failed');
      setNotice({ error: true, message: error instanceof Error ? error.message : '推送失败' });
    } finally {
      setBusy('');
    }
  };

  return <div className="console-grid">
    <section className="console-panel span-5">
      <header><div><h2>发布设置</h2><span>Astro 源码仓库与 Vercel 项目</span></div></header>
      <div className="console-form">
        <div className="form-field"><label htmlFor="blogPath">本地博客仓库</label><input id="blogPath" disabled={configLocked} value={config.blogPath} onChange={(event) => updateConfig({ ...config, blogPath: event.target.value })} placeholder="D:\\Work\\Projects\\YunYueBlogs\\YunYueBlog" /></div>
        <div className="form-grid"><div className="form-field"><label htmlFor="remote">Git Remote</label><input id="remote" disabled={configLocked} value={config.remote} onChange={(event) => updateConfig({ ...config, remote: event.target.value })} /></div><div className="form-field"><label htmlFor="branch">目标分支</label><input id="branch" disabled={configLocked} value={config.branch} onChange={(event) => updateConfig({ ...config, branch: event.target.value })} /></div></div>
        <div className="form-field"><label htmlFor="vercelProject">Vercel 项目地址（可选）</label><input id="vercelProject" disabled={configLocked} type="url" value={config.vercelProjectUrl} onChange={(event) => setConfig({ ...config, vercelProjectUrl: event.target.value })} placeholder="https://vercel.com/team/project" /><small>推送 GitHub 后由 Vercel 仓库集成自动构建；此地址用于快速查看部署状态。</small></div>
        <div className="form-field"><label htmlFor="commit">中文提交信息</label><input id="commit" disabled={configLocked} required maxLength={120} value={message} aria-invalid={!hasChineseMessage} onChange={(event) => setMessage(event.target.value)} /><small className={!hasChineseMessage ? 'field-error' : ''}>必须至少包含一个中文字符，最多 120 字符。</small></div>
        <button className="console-action" type="button" onClick={() => void preview()} disabled={!config.blogPath || Boolean(busy) || unresolvedJob}>{busy === 'preview' ? <LoaderCircle className="animate-spin" size={16} /> : <Eye size={16} />}生成差异预览</button>
      </div>
    </section>

    <section className="console-panel span-7">
      <header><div><h2>执行顺序</h2><span>本地内容、GitHub 与 Vercel 使用同一条可追踪链路</span></div>{config.vercelProjectUrl && <a className="console-action secondary" href={config.vercelProjectUrl} target="_blank" rel="noreferrer"><ExternalLink size={15} />Vercel</a>}</header>
      <div className="publish-steps"><div className={`publish-step ${plan ? 'is-done' : ''}`}><h3>生成同步计划</h3><p>验证路径、Git 根目录、项目标识、工作区哈希和未提交改动。</p></div><div className={`publish-step ${['applied', 'pushing', 'succeeded'].includes(phase) ? 'is-done' : ''}`}><h3>原子同步</h3><p>仅写入受管路径，并只删除上一份清单记录的过期文件。</p></div><div className={`publish-step ${phase === 'succeeded' ? 'is-done' : ''}`}><h3>中文提交并推送 GitHub</h3><p>{phase === 'pushing' ? job?.message || '正在等待 Git 任务。' : '只暂存受管文件，不执行 reset、force push 或自动合并。'}</p></div><div className="publish-step"><h3>Vercel 部署待确认</h3><p>{phase === 'succeeded' ? 'GitHub 推送已完成。Vercel 构建和上线结果尚未确认，请打开项目地址查看实际状态。' : 'GitHub 推送成功后自动触发，不再维护 GitHub Pages 双轨发布。'}</p></div></div>
    </section>

    <section className="console-panel span-12 repository-panel">
      <header><div><h2>本地与远程仓库</h2><span>状态检查不会修改文件；更新只允许干净工作区 fast-forward</span></div><div className="console-page-actions"><button className="console-action secondary" type="button" onClick={() => void repositoryAction('status')} disabled={!config.blogPath || Boolean(busy) || unresolvedJob}>{busy === 'repo-status' ? <LoaderCircle className="animate-spin" size={16} /> : <GitCompareArrows size={16} />}检查状态</button><button className="console-action secondary" type="button" onClick={() => void repositoryAction('fetch')} disabled={!config.blogPath || Boolean(busy) || unresolvedJob}>{busy === 'repo-fetch' ? <LoaderCircle className="animate-spin" size={16} /> : <RadioTower size={16} />}刷新远程</button><button className="console-action" type="button" onClick={() => void repositoryAction('update')} disabled={!config.blogPath || Boolean(busy) || unresolvedJob || Boolean(repository && !repository.canUpdate)}>{busy === 'repo-update' ? <LoaderCircle className="animate-spin" size={16} /> : <GitPullRequestArrow size={16} />}安全更新本地</button></div></header>
      {repository ? <div className="repository-status-grid"><div><span>当前分支</span><strong>{repository.branch}</strong><small>目标 {repository.remote}/{repository.remoteBranch}</small></div><div><span>本地领先</span><strong>{repository.ahead}</strong><small>尚未推送的提交</small></div><div><span>本地落后</span><strong>{repository.behind}</strong><small>可 fast-forward 的提交</small></div><div><span>工作区</span><strong>{repository.dirtyFiles.length ? repository.dirtyFiles.length : '干净'}</strong><small>{repository.remoteBranchAvailable ? '远程分支可用' : '请先刷新远程引用'}</small></div></div> : <div className="repository-empty"><FolderGit2 size={23} /><span>检查后会显示分支、领先/落后提交数与工作区状态。</span></div>}
      {repository?.dirtyFiles.length ? <div className="repository-dirty-list">{repository.dirtyFiles.map((file) => <code key={file}>{file}</code>)}</div> : null}
    </section>

    {plan && <section className="console-panel span-12"><header><div><h2>差异清单</h2><span>{changed.length} 项改动，{plan.changes.length - changed.length} 项未变化</span></div>{plan.canApply ? <span><CheckCircle2 size={16} /> 可以同步</span> : <span><AlertTriangle size={16} /> 已锁定</span>}</header>{plan.dirtyFiles.length > 0 && <div className="form-status error">{plan.dirtyFiles.join('\n')}</div>}<div className="change-list">{plan.changes.map((change) => <div className="change-row" key={`${change.kind}-${change.path}`}><span className={`change-kind ${change.kind}`}>{change.kind}</span><span>{change.path}</span></div>)}</div><div className="console-page-actions"><button className="console-action secondary" type="button" onClick={() => void preview()} disabled={Boolean(busy) || unresolvedJob}><RefreshCw size={16} />重新预览</button><button className="console-action" type="button" onClick={() => void apply()} disabled={phase !== 'planned' || !plan.canApply || Boolean(busy) || unresolvedJob}>{busy === 'apply' ? <LoaderCircle className="animate-spin" size={16} /> : <FolderGit2 size={16} />}应用同步</button><button className="console-action" type="button" onClick={() => void push()} disabled={phase !== 'applied' || !hasChineseMessage || Boolean(busy) || unresolvedJob}>{busy === 'push' ? <LoaderCircle className="animate-spin" size={16} /> : <CloudUpload size={16} />}提交并推送</button></div></section>}
    {recentJobs.length > 0 && <section className="console-panel span-12"><header><div><h2>最近发布任务</h2><span>离开或刷新页面后，可继续查看服务端任务结果。</span></div>{job && <button className="console-action secondary" disabled={busy === 'push'} onClick={() => void followJob(job.jobId)}><RefreshCw size={15} />继续查看状态</button>}</header><div className="console-list" aria-live="polite">{recentJobs.map((item) => <div className="console-list-row" key={item.jobId}><div><strong>{({ queued: '等待提交', running: '正在提交或推送', succeeded: 'GitHub 已推送', failed: '提交或推送失败' })[item.status]}</strong><span>{item.message}</span>{item.status === 'succeeded' && <span>Vercel 部署结果待确认。</span>}</div><small>{item.createdAt ? new Date(item.createdAt * 1000).toLocaleString() : ''}</small></div>)}</div></section>}
    {notice && <div className={`form-status span-12 ${notice.error ? 'error' : ''}`} role={notice.error ? 'alert' : 'status'}>{notice.message}</div>}
  </div>;
}
