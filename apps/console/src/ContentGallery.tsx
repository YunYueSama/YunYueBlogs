import { StudioSelect } from './StudioSelect';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useContentMotion } from './useContentMotion';
import { ArrowDownWideNarrow, ArrowRight, ArrowUpRight, BookOpen, CalendarDays, Check, Clock3, Code2, Eye, Feather, FileText, LayoutGrid, List, LockKeyhole, Search, SlidersHorizontal, Sparkles, X } from 'lucide-react';
import { kindLabels, type ContentDocument, type DocumentSummary } from './contracts';
import { normalizeStudioDate } from './dates';

const QuickPreview=lazy(()=>import('./QuickPreview'));

const kindIcons = {post:BookOpen,chatter:Feather,moment:Sparkles,page:FileText,projects:Code2,albums:Eye,friends:Feather,site:SlidersHorizontal,music:BookOpen};
export const contentDate = (doc:DocumentSummary) => normalizeStudioDate(String(doc.metadata.date || doc.updatedAt));
export const shortDate = (date:string) => Number.isFinite(Date.parse(date)) ? new Date(date).toLocaleDateString('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}) : '日期待设置';
function coverUrl(doc:DocumentSummary) {
  const value=typeof doc.metadata.cover==='string'?doc.metadata.cover:'';
  if(!value)return '';
  try { const url=new URL(value,value.startsWith('/api/media/')?location.origin:'https://yunyuesama.cn'); return url.protocol==='https:'||url.origin===location.origin?url.href:''; } catch { return ''; }
}
export function DocumentCover({doc,compact=false}:{doc:DocumentSummary;compact?:boolean}) {
  const [loaded,setLoaded]=useState(false);const src=coverUrl(doc);const Icon=kindIcons[doc.kind];
  const tone=Array.from(doc.title).reduce((value,char)=>(value+char.codePointAt(0)!)%5,0);
  useEffect(()=>setLoaded(false),[src]);
  return <div className={`story-cover story-cover-${doc.kind} story-cover-tone-${tone} ${compact?'compact':''}`} data-loaded={loaded}>
    <div className="story-cover-design" aria-hidden="true"><span className="cover-orbit"/><span className="cover-number">Y.</span><Icon size={compact?23:38} strokeWidth={1.2}/><strong>{(doc.metadata.tags||[])[0]||doc.title.slice(0,14)}</strong><small>{kindLabels[doc.kind]} / YUNYUE JOURNAL</small></div>
    {src&&<img src={src} alt="" loading="lazy" decoding="async" onLoad={()=>setLoaded(true)} onError={e=>{e.currentTarget.style.display='none';setLoaded(false);}}/>}
  </div>;
}

export function DocumentCard({doc,index=0,onOpen,onPreview,compact=false}:{doc:DocumentSummary;index?:number;onOpen:(id:string)=>void;onPreview?:(doc:DocumentSummary)=>void;compact?:boolean}) {
  const Icon=kindIcons[doc.kind];
  return <article className={`story-card ${compact?'story-card-compact':''}`}>
    <button className="story-cover-button" onClick={()=>onPreview?onPreview(doc):onOpen(doc.id)} aria-label={`${onPreview?'预览':'编辑'}：${doc.title}`}><DocumentCover doc={doc} compact={compact}/><span className="cover-hover"><Eye size={18}/>{onPreview?'快速预览':'继续编辑'}</span></button>
    <div className="story-card-content"><div className="story-card-meta"><span><Icon size={13}/>{kindLabels[doc.kind]}</span><span className={`story-state ${doc.publish?'included':'private'}`}>{doc.publish?<Check size={11}/>:<LockKeyhole size={11}/>}<span>{doc.publish?'包含发布':'私密草稿'}</span></span></div><h3><button onClick={()=>onOpen(doc.id)}>{doc.title}</button></h3><p className="story-excerpt">{doc.excerpt || '还没有摘要，继续写下这个故事。'}</p><div className="story-tags">{(doc.metadata.tags||[]).slice(0,2).map(tag=><span key={tag}># {tag}</span>)}</div><div className="story-card-footer"><span><CalendarDays size={13}/>{shortDate(contentDate(doc))}</span><button onClick={()=>onOpen(doc.id)} aria-label={`编辑：${doc.title}`}>继续编辑<ArrowUpRight size={15}/></button></div></div>
  </article>;
}

export function DocumentList({documents,onOpen}:{documents:DocumentSummary[];onOpen:(id:string)=>void}) {
  return documents.length?<div className="story-compact-grid">{documents.map((doc,index)=><DocumentCard key={doc.id} doc={doc} index={index} compact onOpen={onOpen}/>)}</div>:<EmptyContent/>;
}

export function DocumentBrowser({documents,onOpen}:{documents:DocumentSummary[];onOpen:(id:string)=>void}) {
  const [query,setQuery]=useState('');const [kind,setKind]=useState('all');const [status,setStatus]=useState('all');const [sort,setSort]=useState('content');const [layout,setLayout]=useState<'grid'|'list'>(()=>{try{return localStorage.getItem('yunyue-studio-view')==='list'?'list':'grid';}catch{return 'grid';}});const [preview,setPreview]=useState<DocumentSummary|null>(null);
  const availableKinds=useMemo(()=>[...new Set(documents.map(doc=>doc.kind))],[documents]);
  const result=useMemo(()=>documents.filter(doc=>(kind==='all'||doc.kind===kind)&&(status==='all'||status==='private'&&!doc.publish||status==='included'&&doc.publish)&&`${doc.title} ${doc.slug} ${doc.excerpt||''} ${(doc.metadata.tags||[]).join(' ')}`.toLowerCase().includes(query.toLowerCase())).sort((a,b)=>sort==='title'?a.title.localeCompare(b.title,'zh-CN'):Date.parse(sort==='updated'?b.updatedAt:contentDate(b))-Date.parse(sort==='updated'?a.updatedAt:contentDate(a))),[documents,kind,status,query,sort]);
  const resultsRef=useContentMotion(`${kind}:${status}:${sort}:${layout}:${result.map(d=>d.id).join(',')}`);
  const changeLayout=(next:'grid'|'list')=>{setLayout(next);try{localStorage.setItem('yunyue-studio-view',next);}catch{}};
  return <section className="content-workshop" aria-label="内容工作台">
    <div className="workshop-overview"><div><span className="workshop-marker"><Feather size={15}/></span><span>每一份手稿，都有自己的位置。<small>{documents.length} 份内容 · {documents.filter(d=>!d.publish).length} 份私密草稿</small></span></div><span className="workshop-hint"><CloudStatus/>云端版本自动保存</span></div>
    <div className="workshop-toolbar"><div className="workshop-tabs" aria-label="内容类型"><button aria-pressed={kind==='all'} onClick={()=>setKind('all')}>全部<span>{documents.length}</span></button>{availableKinds.map(k=><button key={k} aria-pressed={kind===k} onClick={()=>setKind(k)}>{kindLabels[k]}<span>{documents.filter(d=>d.kind===k).length}</span></button>)}</div><div className="view-switch" aria-label="内容显示方式"><button aria-pressed={layout==='grid'} onClick={()=>changeLayout('grid')} aria-label="卡片视图"><LayoutGrid size={17}/></button><button aria-pressed={layout==='list'} onClick={()=>changeLayout('list')} aria-label="紧凑视图"><List size={19}/></button></div></div>
    <div className="workshop-filters"><label className="workshop-search"><Search size={18}/><span className="sr-only">搜索文稿</span><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="寻找一篇文章、一个标签，或一段灵感…"/>{query&&<button className="icon-button" aria-label="清除搜索" onClick={()=>setQuery('')}><X size={15}/></button>}</label><label className="filter-select"><SlidersHorizontal size={15}/><span className="sr-only">发布范围</span><StudioSelect label="发布范围" value={status} onChange={value=>setStatus(value)}><option value="all">全部状态</option><option value="private">私密草稿</option><option value="included">包含发布</option></StudioSelect></label><label className="filter-select"><ArrowDownWideNarrow size={15}/><span className="sr-only">文稿排序</span><StudioSelect label="文稿排序" value={sort} onChange={value=>setSort(value)}><option value="content">内容日期</option><option value="updated">最近保存</option><option value="title">标题顺序</option></StudioSelect></label></div>
    {result.length?<div ref={resultsRef} className={`story-gallery layout-${layout}`}>{result.map((doc,index)=><DocumentCard key={doc.id} doc={doc} index={index} compact={layout==='list'} onOpen={onOpen} onPreview={setPreview}/>)}</div>:<EmptyContent filtered={!!query||kind!=='all'||status!=='all'} onReset={()=>{setQuery('');setKind('all');setStatus('all');}}/>}
    <div className="workshop-footer"><span>显示 {result.length} 份内容</span><span><LockKeyhole size={12}/>保存不会自动公开，发布前仍由你确认。</span></div>
    {preview&&<Suspense fallback={null}><QuickPreview summary={preview} onClose={()=>setPreview(null)} onOpen={()=>onOpen(preview.id)}/></Suspense>}
  </section>;
}
function CloudStatus(){return <span className="cloud-status-dot" aria-hidden="true"/>;}
function EmptyContent({filtered=false,onReset}:{filtered?:boolean;onReset?:()=>void}){return <div className="studio-empty"><span><Search size={27}/></span><h3>{filtered?'这份灵感，暂时还没找到':'故事还在酝酿'}</h3><p>{filtered?'换一个关键词，或清除筛选再看看。':'新建一份文稿，开始记录此刻的想法。'}</p>{filtered&&<button className="button" onClick={onReset}>清除筛选</button>}</div>;}
