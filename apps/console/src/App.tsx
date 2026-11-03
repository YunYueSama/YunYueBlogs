import { useNavigationIndicator } from './useNavigationIndicator';
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useContentMotion } from './useContentMotion';
import { ArrowDownToLine, ArrowRight, ArrowUpRight, BookOpen, CheckCircle2, ChevronRight, Cloud, ExternalLink, FileText, FolderHeart, Image, LayoutDashboard, LogOut, Menu, MoreHorizontal, Plus, Rocket, Search, Settings, ShieldCheck, Sparkles, Music2, Library, X } from 'lucide-react';
import { Auth } from './Auth';
import { Overview } from './Overview';
import { DocumentBrowser, DocumentList } from './ContentGallery';
import { CommandPalette, ScenePicker, useStudioCharacter } from './StudioUtilities';
import { api, download, setCsrf } from './api';
import { clearActivation, readActivation } from './activation';
import { clearDrafts, setDraftCacheActive } from './drafts';
import { kindLabels, releaseLabels, type ContentDocument, type DocumentKind, type DocumentSummary, type Release, type Session } from './contracts';

const ConfigurationWorkspace=lazy(()=>import('./ConfigurationWorkspace'));
const ImagebedSettings=lazy(()=>import('./ImagebedSettings'));
const Editor = lazy(() => import('./Editor').then(module => ({ default: module.Editor })));

type View = 'home'|'documents'|'collections'|'media'|'releases'|'settings'|'account'|'editor'|'music'|'shelf';
const views: { id: View; label: string; icon: typeof LayoutDashboard }[] = [
  { id:'home', label:'创作概览', icon:LayoutDashboard }, { id:'documents', label:'文稿', icon:FileText }, { id:'collections', label:'作品与生活', icon:FolderHeart }, { id:'music', label:'音乐工作台', icon:Music2 }, { id:'shelf', label:'ACG 书架', icon:Library }, { id:'media', label:'图床与素材', icon:Image }, { id:'releases', label:'发布', icon:Rocket }, { id:'settings', label:'站点设置', icon:Settings },
];
const readRoute = () => { const p = new URLSearchParams(location.search); return { view: (['home','documents','collections','media','releases','settings','account','editor','music','shelf'].includes(p.get('view') || '') ? p.get('view') : 'home') as View, id:p.get('doc') || '' }; };
const dateLabel = (date: string) => new Date(date).toLocaleString('zh-CN',{ month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',timeZone:'Asia/Shanghai' });
type Dashboard = { counts: { kind: DocumentKind; total: number; included: number }[]; releases: { id:string; state:string; created_at:string }[]; capabilities: { publishing: boolean; media: boolean }; budgets: { deploymentsPerDay:number; maxUploadBytes:number; usageAvailable:boolean } };

export function App() {
  const pageRef=useContentMotion(location.search);
  const [session, setSession] = useState<Session | null>(null); const [loading, setLoading] = useState(true);
  const [activationToken, setActivationToken] = useState(readActivation);
  const { character, setCharacter } = useStudioCharacter();
  const [commandOpen, setCommandOpen] = useState(false);
  const [creatingKind, setCreatingKind] = useState<DocumentKind>('post');
  const [route, setRoute] = useState(readRoute); const [mobile, setMobile] = useState(false); const [creating, setCreating] = useState(false);
  const [documents, setDocuments] = useState<DocumentSummary[]>([]); const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [error, setError] = useState(''); const [online, setOnline] = useState(navigator.onLine);
  const acceptSession = (s: Session | null) => { setCsrf(s); setDraftCacheActive(!!s); setSession(s); if (s) { setActivationToken(''); clearActivation(); } };
  useEffect(() => {
    const cleanUrl = new URL(location.href); if (cleanUrl.searchParams.has('activate')) { cleanUrl.searchParams.delete('activate'); history.replaceState(null, '', cleanUrl); }
    api<Session>('/auth/session').then(acceptSession).catch(() => {}).finally(() => setLoading(false));
    const expire = () => acceptSession(null); const pop = () => setRoute(readRoute()); const connectivity = () => setOnline(navigator.onLine);
    window.addEventListener('session-expired', expire); window.addEventListener('popstate',pop); window.addEventListener('online',connectivity); window.addEventListener('offline',connectivity);
    return () => { window.removeEventListener('session-expired',expire); window.removeEventListener('popstate',pop); window.removeEventListener('online',connectivity); window.removeEventListener('offline',connectivity); };
  },[]);
  const refresh = useCallback(() => {
    void Promise.all([api<{documents:DocumentSummary[]}>('/documents'), api<Dashboard>('/dashboard')]).then(([a,b]) => { setDocuments(a.documents); setDashboard(b); setError(''); }).catch(e => setError(e.message));
  },[]);
  useEffect(() => { if (session && !session.mustChangePassword) refresh(); }, [session, refresh]);
  function navigate(view: View, id='') { history.pushState(null,'',`?view=${view}${id?`&doc=${encodeURIComponent(id)}`:''}`); setRoute({view,id}); setMobile(false); window.scrollTo({top:0,behavior:'instant'}); }
  async function logout() {
    try { await api('/auth/logout',{method:'POST'}); acceptSession(null); await clearDrafts().catch(() => {}); }
    catch (e) { setError((e as Error).message); }
  }
  useEffect(() => { const keyboard = (event:KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setCommandOpen(true); } }; window.addEventListener('keydown',keyboard); return () => window.removeEventListener('keydown',keyboard); },[]);
  function openNew(kind:DocumentKind='post') { setCreatingKind(kind); setCreating(true); }
  const active = route.view === 'editor' ? 'documents' : route.view;
  const navigationRef = useNavigationIndicator(loading || !session || session.mustChangePassword ? 'unavailable' : active);
  if (loading) return <main className="loading-screen"><span className="monogram">Y.</span><p>正在打开创作间…</p></main>;
  if (!session || session.mustChangePassword) return <Auth key={session?.mustChangePassword?'change':'login'} session={session} activationToken={activationToken} onSession={acceptSession} onLogout={() => void logout()}/>;
  const titles: Record<View,string> = { home:'创作概览',documents:'你的文稿',collections:'作品与生活',media:'图床与素材',music:'音乐工作台',shelf:'ACG 书架',releases:'把故事带到线上',settings:'站点设置',account:'账号与安全',editor:'文稿编辑' };
  const collectionDocs = documents.filter(d => ['projects','albums','friends','page'].includes(d.kind));
  return <div className="studio-shell">
    {mobile && <button className="sidebar-scrim" aria-label="关闭导航" onClick={() => setMobile(false)}/>}
    <aside className={`studio-sidebar ${mobile?'is-open':''}`}><a className="studio-brand" href="?view=home" onClick={e=>{e.preventDefault();navigate('home');}}><span className="monogram">Y.</span><span>云月的创作间<small>THE YUNYUE STUDIO</small></span></a><div className="sidebar-workspace"><span className="workspace-orbit"><Cloud size={18}/></span><div>神隐之地<small>个人创作空间</small></div><span className="workspace-online"/></div><div className="sidebar-section-label">工作空间 <span>WORKSPACE</span></div><nav ref={navigationRef} aria-label="管理导航"><span className="navigation-cursor" aria-hidden="true" hidden/>{views.map(({id,label,icon:Icon})=><a key={id} href={`?view=${id}`} className={active===id?'active':''} aria-current={active===id?'page':undefined} onClick={e=>{e.preventDefault();navigate(id);}}><Icon size={19}/><span>{label}</span>{id==='documents'&&<small>{documents.filter(d=>['post','chatter','moment'].includes(d.kind)).length}</small>}</a>)}</nav><div className="sidebar-note"><Sparkles size={20}/><p>世界很大，<br/>也要留一点自己的光。</p><a href="https://yunyuesama.cn" target="_blank" rel="noreferrer">前往神隐之地<ArrowUpRight size={14}/></a><span className="sidebar-constellation" aria-hidden="true"/></div><div className="sidebar-account"><button onClick={()=>navigate('account')} aria-label="账号与安全"><img src="/brand/avatar.webp" width="38" height="38" alt=""/><span>{session.username}<small>唯一站长 · 创作中</small></span><MoreHorizontal size={17}/></button><button className="logout-link" onClick={()=>void logout()}><LogOut size={14}/>退出登录</button></div></aside>
    <div className="studio-content"><header className="studio-topbar"><div className="breadcrumb"><button className="icon-button mobile-only" aria-label="打开管理导航" onClick={()=>setMobile(true)}><Menu size={22}/></button><span>神隐之地</span><ChevronRight size={13}/><strong>{titles[route.view]}</strong></div><div className="topbar-actions"><button className="command-trigger" onClick={()=>setCommandOpen(true)} aria-label="快速导航与文稿搜索"><Search size={16}/><span>寻找灵感或文稿</span><kbd>⌘ K</kbd></button><ScenePicker value={character} onChange={setCharacter}/><span className={`connection ${online?'':'offline'}`}><i/>{online?'网络在线':'当前离线'}</span><a href="https://yunyuesama.cn" target="_blank" rel="noreferrer" className="icon-button" aria-label="访问公开博客"><ExternalLink size={17}/></a></div></header>
      {error && <div className="notice error" role="alert">{error}<button onClick={refresh}>重新加载</button></div>}
      <main ref={pageRef} className={route.view==='editor'?'studio-main editor-route':'studio-main'} key={`${route.view}:${route.id}`}>
        {route.view==='editor' ? <Suspense fallback={<div className="empty-state">正在打开编辑器…</div>}><Editor id={route.id} onBack={() => navigate('documents')} onChanged={refresh}/></Suspense> : <>
          {route.view!=='home' && <div className="page-heading"><div><span className="overline">{`STUDIO / ${route.view.toUpperCase()}`} </span><h1>{titles[route.view]}</h1><p>{route.view==='documents'?'从私密草稿到正式发布，每一版灵感都妥善安放。':route.view==='collections'?'作品、相册与独立页面，组成你的另一面。':route.view==='music'?'检索喜欢的音乐，让歌单与自动歌词一起流动。':route.view==='shelf'?'为喜欢的作品留一格位置。':route.view==='media'?'公开图片用于博客，私有素材只在登录后可见。':route.view==='releases'?'保存是留住灵感，发布是让它与世界相遇。':route.view==='settings'?'让站点的每一个细节，都像你。':'管理登录密码与此设备的离线草稿。'}</p></div>{['home','documents','collections'].includes(route.view) && <button className="button primary" onClick={() => openNew()}><Plus size={17}/>写点什么</button>}</div>}
          {route.view==='home' && <Overview documents={documents} dashboard={dashboard} character={character} onOpen={id=>navigate('editor',id)} onNavigate={navigate} onCreate={openNew}/>}
          {route.view==='documents' && <DocumentBrowser documents={documents.filter(d=>['post','chatter','moment'].includes(d.kind))} onOpen={id=>navigate('editor',id)}/>}
          {route.view==='collections' && <DocumentBrowser documents={collectionDocs} onOpen={id=>navigate('editor',id)}/>}
          {route.view==='settings' && <><DocumentList documents={documents.filter(d=>d.kind==='site')} onOpen={id=>navigate('editor',id)}/><section className="quiet-panel budget-panel"><h2>免费额度保护策略</h2><p>以下为保护阈值，实际平台用量尚未接入。它们不代表已经使用或剩余的额度。</p><dl className="budget-grid"><div><dt>Vercel 源站传输目标</dt><dd>≤ 2 GB / 30 天</dd></div><div><dt>公开发布次数</dt><dd>≤ 20 次 / 天</dd></div><div><dt>单张私有图片</dt><dd>≤ 5 MB</dd></div><div><dt>付费 AI</dt><dd>默认关闭</dd></div></dl><p className="field-help">正文静态发布，媒体不经过 Vercel 中转。平台统计有延迟，需要同时查看服务商控制台。</p></section></>}
          {['music','shelf'].includes(route.view)&&<Suspense fallback={<p className="notice">正在打开设置…</p>}><ConfigurationWorkspace kind={route.view as 'music'|'shelf'} onChanged={refresh}/></Suspense>}
          {route.view==='media' && <><Suspense fallback={<p>正在读取图床…</p>}><ImagebedSettings/></Suspense><details className="private-library"><summary>私有素材库</summary><MediaLibrary/></details></>}
          {route.view==='releases' && <Releases enabled={dashboard?.capabilities.publishing || false} documents={documents} onChanged={refresh}/>}
          {route.view==='account' && <Account onSession={acceptSession} username={session.username}/>}
        </>}
      </main><footer className="studio-footer"><span>YunYue Studio · 03</span><span>慢慢写，认真生活。</span></footer>
    </div>
    {commandOpen && <CommandPalette documents={documents} onClose={()=>setCommandOpen(false)} onNavigate={navigate} onCreate={()=>openNew()}/>}
    {creating && <CreateDocument initialKind={creatingKind} onClose={()=>setCreating(false)} onCreated={doc=>{setCreating(false);refresh();navigate('editor',doc.id);}}/>}
  </div>;
}

function CreateDocument({onClose,onCreated,initialKind}:{onClose:()=>void;onCreated:(doc:ContentDocument)=>void;initialKind:DocumentKind}) {
  const dialog=useRef<HTMLDialogElement>(null); const [kind,setKind]=useState<DocumentKind>(initialKind);const [title,setTitle]=useState('');const [slug,setSlug]=useState('');const [error,setError]=useState('');const [busy,setBusy]=useState(false);
  useEffect(()=>{dialog.current?.showModal();},[]);
  async function submit(e:FormEvent){e.preventDefault();if(busy)return;setBusy(true);try{const doc=await api<ContentDocument>('/documents',{method:'POST',body:JSON.stringify({kind,title,slug:slug||`note-${Date.now()}`,body:'',metadata:{date:new Date().toISOString()},publish:false})});onCreated(doc);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  return <dialog ref={dialog} className="create-dialog" aria-labelledby="create-title" onCancel={onClose}><div className="dialog-heading"><span className="overline">A NEW BEGINNING</span><button className="icon-button" onClick={onClose} aria-label="关闭"><X size={20}/></button></div><h2 id="create-title">写下一个新的开始</h2><form onSubmit={submit}><div className="kind-choices">{(['post','chatter','moment','page'] as const).map(k=><button type="button" key={k} aria-pressed={kind===k} onClick={()=>setKind(k)}>{kindLabels[k]}</button>)}</div><label>标题<input autoFocus value={title} onChange={e=>setTitle(e.target.value)} maxLength={200} placeholder="这个故事叫什么？" required/></label><label>地址名称<input value={slug} onChange={e=>setSlug(e.target.value)} maxLength={120} placeholder="留空会自动生成"/></label><p className="field-help">新建内容默认为私密草稿。</p>{error&&<p role="alert" className="form-error">{error}</p>}<button className="button primary wide" disabled={busy}>创建并开始写作<ArrowRight size={16}/></button></form></dialog>;
}
function Releases({enabled,documents,onChanged}:{enabled:boolean;documents:DocumentSummary[];onChanged:()=>void}) {
  const [releases,setReleases]=useState<Release[]>([]);const [error,setError]=useState('');const [busy,setBusy]=useState(false);const idempotency=useRef('');
  const refresh=useCallback(()=>api<{releases:Release[]}>('/releases').then(r=>setReleases(r.releases)).catch(e=>setError(e.message)),[]);
  useEffect(()=>{void refresh();const timer=setInterval(()=>{if(document.visibilityState==='visible')void refresh();},10000);return()=>clearInterval(timer);},[refresh]);
  const active=releases.some(r=>['queued','exporting','building','verifying','promoting'].includes(r.state));
  async function publish(){if(busy||active)return;if(!window.confirm(`将冻结 ${documents.filter(d=>d.publish).length} 份标记内容并开始公开发布。未标记内容保持私密，正式页面预计等待约 1–3 分钟。是否继续？`))return;setBusy(true);setError('');idempotency.current||=crypto.randomUUID();try{await api('/releases',{method:'POST',body:JSON.stringify({idempotencyKey:idempotency.current})});idempotency.current='';await refresh();onChanged();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  async function exportContent(){try{const docs=await Promise.all(documents.map(d=>api<ContentDocument>(`/documents/${d.id}`)));download('yunyue-content-export.json',JSON.stringify({version:1,exportedAt:new Date().toISOString(),documents:docs},null,2),'application/json');}catch(e){setError((e as Error).message);}}
  return <><section className="publish-summary"><span className="publish-icon"><Rocket size={28}/></span><div><h2>下一份公开快照</h2><p>{documents.filter(d=>d.publish).length} 份内容已标记包含。草稿保存与公网发布分别进行。</p>{!enabled&&<p className="field-help">发布集成尚未启用，当前可以继续编辑和导出内容。</p>}</div><button className="button primary" onClick={()=>void publish()} disabled={!enabled||active||busy}>{active?'正在发布…':busy?'正在提交…':'构建并发布'}<ArrowRight size={16}/></button></section>{error&&<p role="alert" className="notice error">{error}</p>}<div className="section-heading"><h2>发布记录</h2><button className="button ghost" onClick={()=>void exportContent()}><ArrowDownToLine size={16}/>导出全部文稿</button></div>{releases.length?<div className="release-list">{releases.map(r=><article className="release-row" key={r.id}><span className={`release-dot state-${r.state}`}/><div><h3>{releaseLabels[r.state]||r.state}</h3><p>{dateLabel(r.createdAt)} · {r.id.slice(0,8)}</p>{r.error&&<p className="form-error">{r.error}</p>}</div><div>{r.commitSha&&<code>{r.commitSha.slice(0,7)}</code>}{r.state==='released'&&<a className="text-button" href="https://yunyuesama.cn" target="_blank" rel="noreferrer">查看站点<ArrowUpRight size={15}/></a>}</div></article>)}</div>:<div className="empty-state"><Rocket size={30}/><h3>下一次发布，从这里起航</h3><p>发布记录会区分构建、核验和正式上线，便于追踪每个版本。</p></div>}</>;
}
function MediaLibrary(){
  const [media,setMedia]=useState<{id:string;name:string;size:number}[]>([]);const [error,setError]=useState('');const [busy,setBusy]=useState(false);const input=useRef<HTMLInputElement>(null);
  const load=()=>api<{media:typeof media}>('/media').then(r=>setMedia(r.media)).catch(e=>setError(e.message));useEffect(()=>{void load();},[]);
  async function upload(file:File){setBusy(true);setError('');try{await api('/media',{method:'POST',headers:{'Content-Type':file.type,'X-File-Name':encodeURIComponent(file.name)},body:file});await load();}catch(e){setError((e as Error).message);}finally{setBusy(false);if(input.current)input.current.value='';}}
  return <><div className="media-upload"><Cloud size={28}/><h2>为灵感准备素材</h2><p>上传到私有素材库，每张不超过 5 MB。公开文章暂用已确认公开的图片地址。</p><input ref={input} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp,image/avif" onChange={e=>{if(e.target.files?.[0])void upload(e.target.files[0]);}}/><button className="button" disabled={busy} onClick={()=>input.current?.click()}><Plus size={17}/>{busy?'正在上传…':'选择图片'}</button></div>{error&&<p className="notice error" role="alert">{error}</p>}<div className="media-grid">{media.map(item=><figure key={item.id}><img src={`/api/media/${item.id}`} width="320" height="240" loading="lazy" alt={item.name}/><figcaption><strong>{item.name}</strong><small>私有 · {(item.size/1024).toFixed(0)} KB</small></figcaption></figure>)}</div></>;
}
function Account({onSession,username}:{onSession:(s:Session)=>void;username:string}) {
  const [current,setCurrent]=useState('');const [next,setNext]=useState('');const [confirm,setConfirm]=useState('');const [notice,setNotice]=useState('');const [busy,setBusy]=useState(false);
  async function submit(e:FormEvent){e.preventDefault();setNotice('');if(next!==confirm){setNotice('两次填写的新密码不一致。');return;}setBusy(true);try{onSession(await api<Session>('/auth/password',{method:'POST',body:JSON.stringify({currentPassword:current,newPassword:next})}));setCurrent('');setNext('');setConfirm('');setNotice('密码已更新，其他设备的会话已退出。');}catch(e){setNotice((e as Error).message);}finally{setBusy(false);}}
  return <div className="account-grid"><section className="quiet-panel"><ShieldCheck size={27}/><h2>更新登录密码</h2><p className="muted">当前账号：{username}</p><form onSubmit={submit}><label>当前密码<input type="password" autoComplete="current-password" required value={current} onChange={e=>setCurrent(e.target.value)}/></label><label>新密码<input type="password" autoComplete="new-password" required value={next} onChange={e=>setNext(e.target.value)}/></label><p className="field-help">长度与字符由你决定，请使用与当前密码不同的新密码。</p><label>再次输入新密码<input type="password" autoComplete="new-password" required value={confirm} onChange={e=>setConfirm(e.target.value)}/></label>{notice&&<p role="status">{notice}</p>}<button className="button primary" disabled={busy}>更新密码</button></form></section><section className="quiet-panel"><h2>此设备的离线草稿</h2><p>未同步内容仅作为断网保护，正式文稿保存在云端。清理后，本机尚未同步的修改无法恢复。</p><button className="button" onClick={()=>{if(window.confirm('清理此设备全部未同步草稿？已保存的云端文稿不受影响。'))void clearDrafts().then(()=>setNotice('此设备的离线草稿已清理。'));}}>清理本机草稿</button></section></div>;
}
