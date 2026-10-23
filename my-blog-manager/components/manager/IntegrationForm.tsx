'use client';

import { CheckCircle2, Cloud, CloudUpload, KeyRound, LoaderCircle, RefreshCw, Save } from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import RobinSettings from './RobinSettings';
import { managerApi } from '../../lib/managerApi';

type Integrations = {
  bangumiUsername: string;
  picBedUrl: string;
  picBedName: string;
  picBedTokenConfigured: boolean;
  geminiApiKeyConfigured: boolean;
};

const empty: Integrations = {
  bangumiUsername: '',
  picBedUrl: '',
  picBedName: '',
  picBedTokenConfigured: false,
  geminiApiKeyConfigured: false,
};

export default function IntegrationForm() {
  const [data, setData] = useState(empty);
  const [savedBangumi, setSavedBangumi] = useState('');
  const [picBedToken, setPicBedToken] = useState('');
  const [clearPicBedToken, setClearPicBedToken] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingPicBed, setTestingPicBed] = useState(false);
  const [status, setStatus] = useState<{ error?: boolean; message: string } | null>(null);

  useEffect(() => {
    managerApi<Integrations>('/api/settings/integrations')
      .then((value) => { setData(value); setSavedBangumi(value.bangumiUsername); })
      .catch((error) => setStatus({ error: true, message: error.message }))
      .finally(() => setLoading(false));
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setStatus(null);
    try {
      const payload = {
        ...(data.bangumiUsername.trim() !== savedBangumi.trim() ? { bangumiUsername: data.bangumiUsername } : {}),
        picBedUrl: data.picBedUrl,
        picBedName: data.picBedName,
        ...(clearPicBedToken ? { picBedToken: '' } : picBedToken ? { picBedToken } : {}),
      };
      const saved = await managerApi<Integrations>('/api/settings/integrations', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setData(saved);
      setSavedBangumi(saved.bangumiUsername);
      setPicBedToken('');
      setClearPicBedToken(false);
      setStatus({ message: '已保存到管理端工作区。Bangumi 等公开配置需前往“发布”生成差异并同步；密钥只写入本机忽略目录。' });
    } catch (error) {
      setStatus({ error: true, message: error instanceof Error ? error.message : '保存失败' });
    } finally {
      setSaving(false);
    }
  };

  const testPicBed = async () => {
    if (testingPicBed) return;
    setTestingPicBed(true);
    setStatus(null);
    try {
      const result = await managerApi<{ name: string; message: string }>('/api/picbed/test', { method: 'POST', body: '{}' });
      setStatus({ message: `${result.name}：${result.message}` });
    } catch (error) {
      setStatus({ error: true, message: error instanceof Error ? error.message : '图床连接测试失败' });
    } finally {
      setTestingPicBed(false);
    }
  };

  if (loading) return <div className="console-skeleton" />;

  return (
    <div className="console-form">
    <form className="console-form" onSubmit={submit}>
      <section className="console-panel">
        <header>
          <div><h2>Bangumi 只读书架</h2><span>读取公开动画收藏，不保存 Token，也不执行收藏写入</span></div>
        </header>
        <div className="form-field">
          <label htmlFor="bangumi">Bangumi 用户名</label>
          <input id="bangumi" maxLength={100} value={data.bangumiUsername} onChange={(event) => setData({ ...data, bangumiUsername: event.target.value })} placeholder="例如：sai" />
          <small>留空时公开站显示明确的“未配置”状态。</small>
        </div>
        <div className="integration-test-row">
          <p><CloudUpload size={15} /> 保存只更新管理端工作区；同步后本地博客生效，推送后 GitHub 与 Vercel 生效。</p>
          <Link className="console-action secondary" href="/publish"><CloudUpload size={16} />前往发布</Link>
        </div>
      </section>

      <section className="console-panel integration-feature">
        <header>
          <div><h2><Cloud size={18} /> 自定义图床</h2><span>背景图、文章封面、头像、相册和正文图片统一从媒体库选择</span></div>
          <span className={`integration-badge ${data.picBedTokenConfigured ? 'is-ready' : ''}`}><span className="status-dot" />{data.picBedTokenConfigured ? '已配置' : '待配置'}</span>
        </header>
        <div className="form-grid">
          <div className="form-field"><label htmlFor="picBedName">图床名称</label><input id="picBedName" maxLength={60} value={data.picBedName} onChange={(event) => setData({ ...data, picBedName: event.target.value })} placeholder="例如：星辉云端" /></div>
          <div className="form-field"><label htmlFor="picBedUrl">上传 API 地址</label><input id="picBedUrl" type="url" value={data.picBedUrl} onChange={(event) => setData({ ...data, picBedUrl: event.target.value })} placeholder="https://example.com/api/upload" /></div>
          <div className="form-field full">
            <label htmlFor="picToken">图床 Token {data.picBedTokenConfigured && <CheckCircle2 size={14} aria-label="已配置" />}</label>
            <input id="picToken" type="password" autoComplete="new-password" value={picBedToken} onChange={(event) => { setPicBedToken(event.target.value); setClearPicBedToken(false); }} placeholder={data.picBedTokenConfigured ? '已配置，留空保持不变' : '尚未配置'} disabled={clearPicBedToken} />
            {data.picBedTokenConfigured && <label className="inline-check"><input type="checkbox" checked={clearPicBedToken} onChange={(event) => { setClearPicBedToken(event.target.checked); if (event.target.checked) setPicBedToken(''); }} />清除已保存的图床 Token</label>}
          </div>
        </div>
        <div className="integration-test-row">
          <p><KeyRound size={15} /> Token 不会回显、写入日志或发送到浏览器以外的非图床服务。</p>
          <div className="console-page-actions"><Link className="console-action secondary" href="/media">打开媒体库</Link><button className="console-action secondary" type="button" onClick={() => void testPicBed()} disabled={saving || testingPicBed || !data.picBedTokenConfigured || !data.picBedUrl} title={!data.picBedTokenConfigured ? '请先保存图床配置' : undefined}>{testingPicBed ? <LoaderCircle className="animate-spin" size={16} /> : <RefreshCw size={16} />}测试已保存配置</button></div>
        </div>
      </section>

      {status && <div className={`form-status ${status.error ? 'error' : ''}`} role={status.error ? 'alert' : 'status'} aria-live="polite">{status.message}</div>}
      <div><button className="console-action" type="submit" disabled={saving}>{saving ? <LoaderCircle className="animate-spin" size={16} /> : <Save size={16} />}保存集成配置</button></div>
    </form>
    <RobinSettings />
    </div>
  );
}
