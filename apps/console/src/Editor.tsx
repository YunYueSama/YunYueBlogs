import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { ArrowLeft, Bold, Check, Cloud, CloudOff, Code, Columns2, Download, Eye, Heading2, ImagePlus, Link, List, Save, Settings2, X } from 'lucide-react';
import { api, ApiError, download } from './api';
import { localDraft } from './drafts';
import { kindLabels, type ContentDocument } from './contracts';
import {MusicPreviewPlayer} from './MusicPreview';
import { studioDateTimeInput } from './dates';

const ImagebedSettings=lazy(()=>import('./ImagebedSettings'));
const MusicPlaybackSettings=lazy(()=>import('./MusicConfiguration').then(module=>({default:module.MusicPlaybackSettings})));
const ConfigurationForm=lazy(()=>import('./ConfigurationForm'));

const signature = (d: ContentDocument) => JSON.stringify([d.title, d.slug, d.body, d.metadata, d.publish]);
export function Editor({ id, onBack, onChanged, configurationPanel }: { id: string; onBack: () => void; onChanged: () => void; configurationPanel?:'site'|'music'|'shelf' }) {
  const [doc, setDoc] = useState<ContentDocument | null>(null); const [saved, setSaved] = useState('');
  const [saving, setSaving] = useState(false); const [notice, setNotice] = useState(''); const [conflict, setConflict] = useState<ContentDocument | null>(null);
  const [recovery, setRecovery] = useState<ContentDocument | null>(null); const [mode, setMode] = useState<'write'|'split'|'preview'>('split');
  const [jsonSource,setJsonSource]=useState(false);const [imagePicker,setImagePicker]=useState(false);const imageDialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{if(imagePicker)imageDialog.current?.showModal();},[imagePicker]);
  const [settingsOpen, setSettingsOpen] = useState(false); const [retry, setRetry] = useState(0);
  const textarea = useRef<HTMLTextAreaElement>(null); const savingRef = useRef(false); const lastSave = useRef(Date.now()); const current = useRef(doc); current.current = doc;
  const dirty = !!doc && signature(doc) !== saved;
  const dirtyRef=useRef(dirty);dirtyRef.current=dirty;
  const isJson = !!doc && ['site','projects','albums','friends','music'].includes(doc.kind);
  useEffect(()=>()=>{const latest=current.current;if(latest&&dirtyRef.current)void localDraft(id,{id,document:latest,savedAt:new Date().toISOString()}).catch(()=>{});},[id]);
  useEffect(() => {
    let active = true;
    api<ContentDocument>(`/documents/${id}`).then(async result => {
      if (!active) return; setDoc(result); setSaved(signature(result)); setNotice('');
      try { const cached = await localDraft(id); if (active && cached && signature(cached.document) !== signature(result)) setRecovery(cached.document); } catch { /* 隐私模式可能禁止本机缓存，云端编辑仍可用。 */ }
    }).catch(error => { if (active) setNotice(error.message); });
    return () => { active = false; };
  }, [id]);
  useEffect(() => {
    if (!doc || !dirty) return;
    const timer = setTimeout(() => { void localDraft(id, { id, document: doc, savedAt: new Date().toISOString() }).catch(() => {}); }, 300);
    const handler = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', handler);
    return () => { clearTimeout(timer); window.removeEventListener('beforeunload', handler); };
  }, [doc, dirty, id]);
  const save = useCallback(async () => {
    const submitted = current.current; if (!submitted || savingRef.current || conflict) return;
    savingRef.current = true; setSaving(true); setNotice('');
    try {
      const next = await api<ContentDocument>(`/documents/${id}`, { method: 'PUT', body: JSON.stringify(submitted) });
      setSaved(signature(submitted)); lastSave.current = Date.now();
      setDoc(latest => latest && { ...latest, revision: next.revision, updatedAt: next.updatedAt });
      if (current.current && signature(current.current) === signature(submitted)) await localDraft(id, null).catch(() => {});
      onChanged();
    } catch (error) {
      setNotice((error as Error).message);
      if (error instanceof ApiError && error.code === 'revision_conflict') {
        try { setConflict(await api<ContentDocument>(`/documents/${id}`)); } catch { /* 保留当前输入并继续显示原始冲突。 */ }
      }
    } finally { savingRef.current = false; setSaving(false); }
  }, [id, conflict, onChanged]);
  const saveRef = useRef(save); saveRef.current = save;
  useEffect(() => {
    if (!dirty || saving || conflict || notice) return;
    const timer = setTimeout(() => void saveRef.current(), Math.min(1800, Math.max(0, 12000 - (Date.now() - lastSave.current))));
    return () => clearTimeout(timer);
  }, [doc, dirty, saving, conflict, notice, retry]);
  useEffect(() => {
    const online = () => { setNotice(''); setRetry(n => n + 1); };
    const keydown = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key === 's') { event.preventDefault(); void saveRef.current(); } };
    window.addEventListener('online', online); window.addEventListener('keydown', keydown);
    return () => { window.removeEventListener('online', online); window.removeEventListener('keydown', keydown); };
  }, []);
  function edit(values: Partial<ContentDocument>) { setDoc(old => old && { ...old, ...values }); setNotice(''); }
  function insert(before: string, after = '') {
    const el = textarea.current; if (!el || !doc) return;
    const start = el.selectionStart; const end = el.selectionEnd;
    edit({ body: doc.body.slice(0, start) + before + doc.body.slice(start, end) + after + doc.body.slice(end) });
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(start + before.length, end + before.length); });
  }
  const html = doc && !isJson ? DOMPurify.sanitize(marked.parse(doc.body, { async: false }), { FORBID_TAGS: ['iframe','style','script','form'], FORBID_ATTR: ['style'], ADD_ATTR: ['target'] }) : '';
  if (!doc) return <div className="empty-state"><Cloud size={30}/><h2>{notice || '正在打开云端文稿…'}</h2><button className="button" onClick={onBack}>返回文稿</button></div>;
  let musicSite:Record<string,unknown>|null=null;if(configurationPanel==='music'){try{musicSite=JSON.parse(doc.body);}catch{/* 高级源码未完成时保留输入，不渲染播放表单。 */}}
  return <section className={`editor-page ${configurationPanel==='music'?'music-editor':''}`}>
    {imagePicker&&<dialog ref={imageDialog} className="asset-dialog" aria-label="选择公开图片" onCancel={()=>setImagePicker(false)}><header className="dialog-heading"><h2>为文字添一幅画</h2><button className="icon-button" aria-label="关闭图片选择" onClick={()=>setImagePicker(false)}><X size={20}/></button></header><Suspense fallback={<p>正在读取图片…</p>}><ImagebedSettings onInsert={url=>{insert(`![图片说明](${url})`);setImagePicker(false);}}/></Suspense><button className="button ghost" onClick={()=>{insert("![图片说明](https://)");setImagePicker(false);}}>手动填写图片地址</button></dialog>}
    <header className="editor-header"><button className="button ghost" onClick={onBack}><ArrowLeft size={16}/>文稿</button><span className="save-state" aria-live="polite">{notice ? <CloudOff size={15}/> : dirty || saving ? <Cloud size={15}/> : <Check size={15}/>}<span>{conflict ? '版本冲突' : notice ? '尚未同步' : saving ? '正在保存…' : dirty ? '有未保存修改' : '已保存'}</span></span><div className="editor-header-actions"><button className="button" onClick={() => void save()} disabled={saving || !dirty || !!conflict}><Save size={16}/><span>保存</span></button><button className="icon-button" aria-label="文稿设置" aria-expanded={settingsOpen} onClick={() => setSettingsOpen(v => !v)}><Settings2 size={20}/></button></div></header>
    {notice && <div className="notice error" role="alert">{notice}<button onClick={() => void save()} disabled={saving || !!conflict}>重新保存</button></div>}
    {recovery && <div className="notice">此设备还有一份未同步的草稿。<button onClick={() => { edit({ ...recovery, id: doc.id, revision: doc.revision }); setRecovery(null); }}>恢复到编辑器</button><button onClick={() => { setRecovery(null); void localDraft(id, null); }}>使用云端版本</button></div>}
    {conflict && <div className="conflict-panel" role="alert"><h3>另一台设备保存了更新的版本</h3><p>云端已有更新，当前输入已保留。先下载或比较，再决定如何合并。</p><div className="conflict-comparison"><pre aria-label="当前本机正文">{doc.body}</pre><pre aria-label="云端正文">{conflict.body}</pre></div><div className="button-row"><button className="button" onClick={() => download(`${doc.slug}-未同步.md`, doc.body)}><Download size={15}/>下载当前稿</button><button className="button" onClick={() => { if (window.confirm('将以云端版本替换编辑器内容。请先下载需要保留的当前稿。')) { setDoc(conflict); setSaved(signature(conflict)); setConflict(null); setNotice(''); void localDraft(id, null); } }}>载入云端版本</button><button className="button" onClick={() => { setDoc(latest => latest && { ...latest, revision: conflict.revision }); setConflict(null); setNotice(''); }}>保留当前内容继续合并</button></div></div>}
    <div className={`editor-layout ${settingsOpen ? 'settings-open' : ''}`}>
      <div className="editor-main"><div className="document-heading"><span className="overline">{kindLabels[doc.kind]} / YOUR NEXT STORY</span><label className="sr-only" htmlFor="document-title">标题</label><input id="document-title" className="title-input" placeholder="为这个故事起个名字" value={doc.title} onChange={e => edit({ title: e.target.value })}/><div className="editor-byline"><span>YunYueSama</span><span>·</span><span>{doc.body.length.toLocaleString()} 字</span><span>·</span><span>{doc.publish ? '包含在下次发布中' : '私密草稿'}</span></div></div>
        {isJson&&<div className="config-view-switch"><div><button aria-pressed={!jsonSource} onClick={()=>setJsonSource(false)}>可视化设置</button><button aria-pressed={jsonSource} onClick={()=>setJsonSource(true)}>高级源码</button></div><span>保留原有配置字段，保存后可继续发布。</span></div>}
        {isJson&&!jsonSource?<Suspense fallback={<div className="empty-state">正在打开配置表单…</div>}><ConfigurationForm kind={doc.kind} value={doc.body} onChange={body=>edit({body})} panel={configurationPanel}/></Suspense>:<>
        <div className="writing-toolbar"><div className="toolbar-tools">{!isJson && <><button aria-label="加粗" onClick={() => insert('**','**')}><Bold size={17}/></button><button aria-label="二级标题" onClick={() => insert('\n## ')}><Heading2 size={19}/></button><button aria-label="列表" onClick={() => insert('\n- ')}><List size={18}/></button><button aria-label="插入链接" onClick={() => insert('[','](https://)')}><Link size={17}/></button><button aria-label="插入图片" onClick={() => setImagePicker(true)}><ImagePlus size={18}/></button><button aria-label="代码块" onClick={() => insert('\n```\n','\n```\n')}><Code size={18}/></button></>}</div><div className="segmented" aria-label="编辑视图">{(['write','split','preview'] as const).map((v,i) => <button key={v} aria-pressed={mode===v} onClick={() => setMode(v)} aria-label={['编辑','分栏预览','只看预览'][i]}>{i===0?<Code size={15}/>:i===1?<Columns2 size={15}/>:<Eye size={15}/>}</button>)}</div></div>
        <div className={`writing-surface mode-${mode}`}><label className="sr-only" htmlFor="document-body">{isJson ? '配置 JSON' : 'Markdown 正文'}</label><textarea id="document-body" ref={textarea} spellCheck={false} value={doc.body} onChange={e => edit({ body: e.target.value })} placeholder={isJson ? '输入配置 JSON' : '从一个念头、一段代码，或今天的心情开始…'}/><div className="document-preview prose" aria-label="正文预览">{isJson ? <pre>{doc.body}</pre> : <div dangerouslySetInnerHTML={{ __html: html }}/>}</div></div>
        </>}
      </div>
      {configurationPanel==='music'&&musicSite?<aside className="document-settings music-workspace-sidebar" aria-label="试听与播放设置"><MusicPreviewPlayer/><div className="music-sidebar-options"><Suspense fallback={<p>正在读取播放设置…</p>}><MusicPlaybackSettings site={musicSite} onChange={value=>edit({body:JSON.stringify(value,null,2)})}/></Suspense><details className="music-publish-options"><summary>发布与备份</summary><label className="switch-label"><input type="checkbox" checked={doc.publish} onChange={e=>edit({publish:e.target.checked})}/><span>包含在下次发布中</span></label><p className="field-help">保存后前往「发布」更新博客。</p><button className="button ghost" onClick={()=>download(`${doc.slug}.json`,doc.body)}><Download size={14}/>导出歌单配置</button></details></div></aside>:<aside className="document-settings"><div className="panel-title"><h3>文稿设置</h3><button className="icon-button mobile-only" aria-label="关闭设置" onClick={() => setSettingsOpen(false)}><X size={18}/></button></div><label>地址名称<input value={doc.slug} onChange={e => edit({ slug: e.target.value })} disabled={isJson}/></label><p className="field-help">保留现有名称可保持文章链接稳定。</p>{!isJson && <><label>摘要<textarea rows={3} value={String(doc.metadata.description || '')} onChange={e => edit({ metadata: { ...doc.metadata, description: e.target.value } })}/></label><label>标签<input value={(doc.metadata.tags || []).join('，')} onChange={e => edit({ metadata: { ...doc.metadata, tags: e.target.value.split(/[,，]/).map(v => v.trim()).filter(Boolean) } })}/></label><label>日期<input type="datetime-local" value={studioDateTimeInput(String(doc.metadata.date || doc.createdAt))} onChange={e => edit({ metadata: { ...doc.metadata, date: e.target.value ? `${e.target.value}:00+08:00` : '' } })}/></label><label>公开封面地址<input type="text" placeholder="https:// 或 /images/…" value={String(doc.metadata.cover || '')} onChange={e => edit({ metadata: { ...doc.metadata, cover: e.target.value } })}/></label></>}<label className="switch-label"><input type="checkbox" checked={doc.publish} onChange={e => edit({ publish: e.target.checked })}/><span>包含在下次发布中</span></label><p className="field-help">保存只更新云端文稿。前往「发布」构建后，正式站点才会变化。</p><button className="button ghost" onClick={() => download(`${doc.slug}.${isJson?'json':'md'}`,doc.body)}><Download size={16}/>导出当前内容</button></aside>}
    </div>
  </section>;
}
