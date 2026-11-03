import { useState, type FormEvent } from 'react';
import { ArrowRight, Eye, EyeOff, KeyRound, LogOut, ShieldCheck, Sparkles } from 'lucide-react';
import { m } from 'motion/react';
import { api } from './api';
import type { Session } from './contracts';

export function Auth({ session, activationToken, onSession, onLogout }: { session: Session | null; activationToken: string; onSession: (s: Session) => void; onLogout: () => void }) {
  const change = session?.mustChangePassword;
  const [username, setUsername] = useState(''); const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState(''); const [confirm, setConfirm] = useState('');
  const [visible, setVisible] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return; setError('');
    if (change && newPassword !== confirm) { setError('两次填写的新密码不一致。'); return; }
    setBusy(true);
    try {
      const next = await api<Session>(change ? '/auth/password' : '/auth/login', { method: 'POST', body: JSON.stringify(change ? { currentPassword: password, newPassword } : { username, password, activationToken }) });
      setPassword(''); setNewPassword(''); setConfirm(''); onSession(next);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <main className="auth-page">
    <section className="auth-story" aria-label="云月创作间">
      <img className="auth-art" src="/brand/studio-cover.webp" alt="" width="1672" height="941"/>
      <a className="auth-brand" href="https://yunyuesama.cn"><span className="monogram">Y.</span><span>YUNYUE<small>PRIVATE STUDIO / 03</small></span></a>
      <div className="auth-story-copy"><span className="overline"><Sparkles size={14}/> 把灵感，写成自己的世界</span><h1>故事从这里<br/>继续生长<span>。</span></h1><p>为文字、代码和生活留一盏灯。<br/>无论此刻在哪里，都能回到你的创作间。</p></div>
      <div className="auth-story-foot"><span>神隐之地 · 作者入口</span><span>AI / CODE / MAGIC</span></div>
    </section>
    <section className="auth-side">
      <m.div className="auth-card" key={change ? 'change' : 'login'} initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .36 }}>
        <span className="section-code">{change ? '01 / SET A NEW KEY' : 'WELCOME BACK'}</span>
        <h2>{change ? '先换一把新钥匙' : '回到创作间'}</h2>
        <p className="muted">{change ? '首次登录需要修改初始密码，完成后即可开始创作。' : '登录你的管理账号，继续尚未写完的故事。'}</p>
        <form onSubmit={submit} className="auth-form">
          {!change && <label>管理账号<input autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} placeholder="输入账号" required autoFocus /></label>}
          <label>{change ? '当前密码' : '密码'}<div className="password-field"><input type={visible ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required/><button type="button" className="icon-button" aria-label={visible ? '隐藏密码' : '显示密码'} onClick={() => setVisible(v => !v)}>{visible ? <EyeOff size={18}/> : <Eye size={18}/>}</button></div></label>
          {change && <><label>新密码<input type="password" autoComplete="new-password" value={newPassword} onChange={e => setNewPassword(e.target.value)} aria-describedby="password-help" required/></label><p className="field-help" id="password-help">长度与字符由你决定，请使用与当前密码不同的新密码。</p><label>再次输入新密码<input type="password" autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} required/></label></>}
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="button primary wide" disabled={busy} type="submit">{busy ? '正在验证…' : change ? '修改密码并进入' : '进入创作间'}{change ? <KeyRound size={17}/> : <ArrowRight size={17}/>}</button>
        </form>
        <div className="auth-assurance"><ShieldCheck size={16}/><span>{change ? '修改后，其他设备的旧会话会退出。' : '仅供站长管理，文章阅读无需登录。'}</span></div>
        {change && <button className="button ghost wide" onClick={onLogout}><LogOut size={16}/>退出登录</button>}
      </m.div>
      <p className="auth-bottom">YunYueSama <span>·</span> 愿每一次记录，都有回声。</p>
    </section>
  </main>;
}
