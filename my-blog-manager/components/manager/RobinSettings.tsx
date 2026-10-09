'use client';

import { useEffect, useRef, useState } from 'react';
import { CloudUpload, LoaderCircle, RefreshCw, Save, Sparkles } from 'lucide-react';
import { managerApi } from '../../lib/managerApi';

type Config = { provider: 'deepseek' | 'compatible'; baseUrl: string; fastModel: string; deepModel: string; apiKeyConfigured: boolean; saved: boolean };
type Cloud = { projectName: string; baseUrl: string; fastModel: string; deepModel: string; apiKeyConfigured: boolean };
type Job = { jobId: string; status: string; message: string; url?: string };
const defaults: Config = { provider: 'deepseek', baseUrl: 'https://api.deepseek.com', fastModel: 'deepseek-flash', deepModel: 'deepseek-v4-pro', apiKeyConfigured: false, saved: false };
const modelChoices = ['deepseek-flash', 'deepseek-v4-pro', 'deepseek-chat', 'deepseek-reasoner'];
const modelLabels: Record<string, string> = {
  'deepseek-flash': 'DeepSeek V4.1 Flash（deepseek-flash）',
  'deepseek-v4-pro': 'DeepSeek V4 Pro（deepseek-v4-pro）',
};

export default function RobinSettings() {
  const [config, setConfig] = useState(defaults);
  const [cloud, setCloud] = useState<Cloud>();
  const [key, setKey] = useState('');
  const [clearKey, setClearKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);
  const [deployment, setDeployment] = useState('');
  const [customModels, setCustomModels] = useState({ fastModel: false, deepModel: false });
  const mounted = useRef(true);
  const edited = useRef(false);

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    void managerApi<Config>('/api/robin/config', { signal: controller.signal }).then(local => {
      setConfig(local); setLoading(false);
      return managerApi<Cloud>('/api/robin/cloud', { signal: controller.signal }).then(remote => {
        setCloud(remote);
        // 首次访问优先展示服务器正在使用的模型，不拿默认值覆盖已有部署。
        if (!local.saved && !edited.current) setConfig(current => ({ ...current, baseUrl: remote.baseUrl, fastModel: remote.fastModel, deepModel: remote.deepModel, provider: remote.baseUrl === defaults.baseUrl ? 'deepseek' : 'compatible' }));
        const pending = sessionStorage.getItem('robin-sync-job');
        if (pending) void managerApi<Job>(`/api/jobs/${pending}`, { signal: controller.signal }).then(job => {
          setMessage(job.message); setError(job.status === 'failed'); if (job.url) setDeployment(job.url);
          if (job.status === 'succeeded') sessionStorage.removeItem('robin-sync-job');
        }).catch(() => {});
      });
    }).catch(() => { if (!controller.signal.aborted) { setMessage('服务器配置暂时无法读取，请刷新状态；本机已保存配置仍可编辑。'); setLoading(false); } });
    return () => { mounted.current = false; controller.abort(); };
  }, []);

  const update = (values: Partial<Config>) => { edited.current = true; setConfig(current => ({ ...current, ...values })); setDirty(true); };
  const save = async () => {
    const saved = await managerApi<Config>('/api/robin/config', { method: 'POST', body: JSON.stringify({ provider: config.provider, baseUrl: config.baseUrl, fastModel: config.fastModel, deepModel: config.deepModel, ...(clearKey ? { apiKey: '' } : key ? { apiKey: key } : {}) }) });
    setConfig(saved); setKey(''); setClearKey(false); setDirty(false);
    return saved;
  };
  const run = async (action: 'save' | 'sync' | 'refresh') => {
    if (busy) return;
    setBusy(true); setError(false); setMessage(''); setDeployment('');
    try {
      if (action === 'refresh') {
        setCloud(await managerApi<Cloud>('/api/robin/cloud'));
        const pending = sessionStorage.getItem('robin-sync-job');
        if (pending) {
          const job = await managerApi<Job>(`/api/jobs/${pending}`);
          setMessage(job.message); setError(job.status === 'failed'); if (job.url) setDeployment(job.url);
          if (job.status === 'succeeded') sessionStorage.removeItem('robin-sync-job');
        } else setMessage('已刷新服务器配置状态。');
        return;
      }
      await save();
      if (action === 'save') { setMessage('Robin 配置已保存到本机。点击“同步到 Vercel 并部署”后正式博客生效。'); return; }
      const queued = await managerApi<{ jobId: string }>('/api/robin/sync', { method: 'POST', body: '{}' });
      sessionStorage.setItem('robin-sync-job', queued.jobId);
      for (let i = 0; i < 150 && mounted.current; i++) {
        const job = await managerApi<Job>(`/api/jobs/${queued.jobId}`);
        if (!mounted.current) return;
        setMessage(job.message); if (job.url) setDeployment(job.url);
        if (job.status === 'failed') { setError(true); return; }
        if (job.status === 'succeeded') { setCloud(await managerApi<Cloud>('/api/robin/cloud')); sessionStorage.removeItem('robin-sync-job'); return; }
        await new Promise(resolve => setTimeout(resolve, 2500));
      }
      setMessage('任务仍在后台执行，请刷新状态或到 Vercel 查看，暂时不要重复同步。');
    } catch (cause) { setError(true); setMessage(cause instanceof Error ? cause.message : 'Robin 配置保存失败。'); }
    finally { if (mounted.current) setBusy(false); }
  };
  const model = (field: 'fastModel' | 'deepModel', label: string) => (
    <div className="form-field">
      <label htmlFor={field}>{label}</label>
      <select id={field} disabled={busy} value={customModels[field] ? '__custom__' : config[field]} onChange={event => {
        const custom = event.target.value === '__custom__';
        setCustomModels(current => ({ ...current, [field]: custom }));
        if (!custom) update({ [field]: event.target.value });
      }}>
        {Array.from(new Set([...modelChoices, cloud?.fastModel, cloud?.deepModel, config[field]].filter(Boolean))).map(value => <option key={value} value={value}>{modelLabels[value!] || value}</option>)}
        <option value="__custom__">自定义模型…</option>
      </select>
      {customModels[field] && <><label className="sr-only" htmlFor={`${field}-custom`}>{label}的自定义模型名称</label><input id={`${field}-custom`} disabled={busy} value={config[field]} maxLength={200} onChange={event => update({ [field]: event.target.value })} placeholder="填写服务商提供的完整模型 ID" /></>}
      <small>展开可选择其他模型；未列出的模型请选择“自定义模型”。</small>
    </div>
  );
  return <section className="console-panel integration-feature">
    <header><div><h2><Sparkles size={18} /> Robin AI 助手</h2><span>服务与模型在这里管理，角色设定由博客统一维护</span></div><span className={`integration-badge ${cloud?.apiKeyConfigured ? 'is-ready' : ''}`}>{cloud ? cloud.apiKeyConfigured ? '服务器已配置' : '服务器待配置' : '正在读取服务器状态'}</span></header>
    {loading ? <div className="console-skeleton" /> : <>
      <div className="form-grid">
        <div className="form-field"><label htmlFor="robinProvider">AI 服务</label><select disabled={busy} id="robinProvider" value={config.provider} onChange={event => update({ provider: event.target.value as Config['provider'], ...(event.target.value === 'deepseek' ? { baseUrl: defaults.baseUrl } : {}) })}><option value="deepseek">DeepSeek</option><option value="compatible">其他 OpenAI 兼容服务</option></select></div>
        <div className="form-field"><label htmlFor="robinBase">接口地址</label><input disabled={busy} id="robinBase" type="url" value={config.baseUrl} onChange={event => update({ baseUrl: event.target.value })} readOnly={config.provider === 'deepseek'} /><small>填写服务商的基础地址，不包含 /chat/completions。</small></div>
        {model('fastModel', '快速回答模型')}{model('deepModel', '深入思考模型')}
        <div className="form-field full"><label htmlFor="robinKey">Robin API Key</label><input id="robinKey" type="password" autoComplete="new-password" maxLength={4096} value={key} disabled={clearKey || busy} onChange={event => { edited.current = true; setKey(event.target.value); setClearKey(false); setDirty(true); }} placeholder={config.apiKeyConfigured || cloud?.apiKeyConfigured ? '已配置，留空保持不变' : '填写所选服务的 API Key'} />
          {config.apiKeyConfigured && <label className="inline-check"><input type="checkbox" checked={clearKey} disabled={busy} onChange={event => { setClearKey(event.target.checked); setKey(''); setDirty(true); }} />清除本机保存的密钥（不删除服务器密钥）</label>}
          <small>密钥不回显、不进入 Git。同步时仅上传到已关联的 Vercel 项目；服务器已有密钥时可以只修改模型。</small>
        </div>
      </div>
      {cloud && <p className="integration-test-row">服务器 · {cloud.projectName}：快速回答 {cloud.fastModel} / 深入思考 {cloud.deepModel}{dirty ? ' · 有未保存的修改' : ''}</p>}
      <div className="console-page-actions"><button className="console-action secondary" type="button" disabled={busy} onClick={() => void run('save')}><Save size={16} />保存 Robin 配置</button><button className="console-action" type="button" disabled={busy} onClick={() => void run('sync')}>{busy ? <LoaderCircle className="animate-spin" size={16} /> : <CloudUpload size={16} />}同步到 Vercel 并部署</button><button className="console-action secondary" type="button" disabled={busy} onClick={() => void run('refresh')}><RefreshCw size={16} />刷新服务器状态</button></div>
    </>}
    {message && <div className={`form-status ${error ? 'error' : ''}`} role={error ? 'alert' : 'status'}>{message}{deployment && <> <a href={deployment} target="_blank" rel="noreferrer">查看部署</a></>}</div>}
  </section>;
}
