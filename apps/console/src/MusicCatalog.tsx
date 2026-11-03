import {useEffect,useRef,useState} from 'react';
import {Check,ChevronLeft,ChevronRight,Disc3,LoaderCircle,Music2,Pause,Play,Plus,Search,X} from 'lucide-react';
import {api} from './api';
import {useStudioPlayback} from './MusicPreview';
import './music-catalog.css';
import {musicChannels,type ChannelInfo,type MusicChannel,type MusicTrack} from './music-channels';

type Result={source:MusicChannel;items:MusicTrack[];total:number;page:number;limit:number;hasMore:boolean};
const cache=new Map<string,{at:number;value:Result}>();
const clock=(ms=0)=>`${Math.floor(ms/60000)}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}`;
export default function MusicCatalog({selected,onAdd,preference}:{selected:MusicTrack[];onAdd:(track:MusicTrack)=>void;preference:string}){
  const [channels,setChannels]=useState<ChannelInfo[]>([]),[source,setSource]=useState<MusicChannel>('netease'),[query,setQuery]=useState(''),[searched,setSearched]=useState(''),[result,setResult]=useState<Result|null>(null),[loading,setLoading]=useState(false),[ready,setReady]=useState(false),[sourceHash,setSourceHash]=useState(''),[error,setError]=useState('');
  const generation=useRef(0),request=useRef<AbortController|null>(null);
  useEffect(()=>{const controller=new AbortController();void api<{enabled:boolean;channels:ChannelInfo[];sha256:string}>('/integrations/music/channels',{signal:controller.signal}).then(value=>{if(controller.signal.aborted)return;setSourceHash(value.sha256||'');setChannels(value.channels);if(value.channels.length)setSource(value.channels.some(c=>c.id==='netease')?'netease':value.channels[0].id);setReady(true);}).catch(reason=>{if(!controller.signal.aborted){setError(reason.message);setReady(true);}});return()=>{controller.abort();request.current?.abort();generation.current++;};},[]);
  async function search(keyword:string,channel=source,page=1){
    const value=keyword.trim().replace(/\s+/g,' ');if(!value||value.length>100){setError('请输入 1–100 字的歌名、歌手或关键词。');return;}
    request.current?.abort();const controller=new AbortController();request.current=controller;const current=++generation.current;setSource(channel);setSearched(value);setError('');
    const key=JSON.stringify([sourceHash,channel,value.toLocaleLowerCase(),page]),saved=cache.get(key);
    if(saved&&Date.now()-saved.at<300000){setResult(saved.value);setLoading(false);return;}
    setResult(null);setLoading(true);
    try{const data=await api<Result>('/integrations/music/search',{method:'POST',body:JSON.stringify({channel,query:value,page}),signal:controller.signal});if(current!==generation.current)return;
      if(cache.size>=60)cache.delete(cache.keys().next().value!);cache.set(key,{at:Date.now(),value:data});setResult(data);
    }catch(reason){if(current===generation.current&&!controller.signal.aborted)setError((reason as Error).message);}finally{if(current===generation.current)setLoading(false);}
  }
  function channel(value:MusicChannel){if(value===source)return;setSource(value);if(searched)void search(query.trim()||searched,value);}
  const {listen,loading:previewing,preview,playing}=useStudioPlayback();
  const selectedKeys=new Set(selected.map(track=>track.key.toUpperCase()));
  return <section className="config-section catalog-section" aria-label="音乐检索"><header><span><Search size={21}/></span><div><h3>找到下一首心动</h3><p>歌名、歌手，或只记得的一小段关键词。</p></div></header>
    <form className="catalog-query" onSubmit={event=>{event.preventDefault();void search(query);}}><label className="catalog-input"><Search size={19} aria-hidden="true"/><span className="sr-only">音乐关键词</span><input type="search" value={query} onChange={event=>setQuery(event.target.value)} placeholder="搜索歌名、歌手或关键词" maxLength={100} autoComplete="off"/>{query&&<button type="button" className="icon-button" aria-label="清空音乐关键词" onClick={()=>setQuery('')}><X size={16}/></button>}</label><button className="button primary" type="submit" disabled={!ready||!channels.length||!query.trim()}><Search size={17}/>检索音乐</button></form>
    <div className="catalog-channels" role="tablist" aria-label="检索渠道" onKeyDown={event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;const tabs=Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=tab]'));const at=tabs.indexOf(event.target as HTMLButtonElement);if(at<0)return;event.preventDefault();const index=event.key==='Home'?0:event.key==='End'?tabs.length-1:(at+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;tabs[index]?.click();tabs[index]?.focus();}}>{channels.map(item=><button role="tab" type="button" key={item.id} aria-selected={item.id===source} tabIndex={item.id===source?0:-1} onClick={()=>channel(item.id)}>{item.name}</button>)}</div>
    {!ready?<p className="catalog-empty" role="status">正在读取当前音源支持的渠道…</p>:!channels.length?<p className="catalog-empty">请先在“自定义音源”导入、测试并启用音源。</p>:!searched&&!error?<div className="catalog-welcome"><Music2 size={30}/><strong>从喜欢的声音开始</strong><p>支持模糊检索。切换渠道会沿用关键词，不必重新输入。</p></div>:null}
    {loading&&<div className="catalog-loading" role="status"><LoaderCircle size={21} className="spin"/><span>正在{musicChannels[source].name}寻找「{searched}」…</span></div>}
    {error&&<p role="alert" className="notice error catalog-error">{error}</p>}
    {result&&<div className="catalog-results"><div className="catalog-result-heading"><span>「{searched}」<small>{musicChannels[result.source].name} · {result.total.toLocaleString()} 首结果</small></span><span>第 {result.page} 页</span></div>
      {result.items.map(track=>{const added=selectedKeys.has(track.key.toUpperCase()),qualities=(track.lx?.types||[]) as {type:string}[];return <article className={`catalog-result ${preview?.track.key===track.key?'is-previewing':''}`} key={track.key}><div className="catalog-cover">{track.cover?<img src={track.cover} loading="lazy" decoding="async" alt="" width={52} height={52} referrerPolicy="no-referrer" onError={event=>{event.currentTarget.style.display='none';}}/>:<Disc3 size={24}/>}</div><div className="catalog-track-copy"><strong>{track.name}</strong><span>{track.artist||'歌手信息待补充'}</span><small>{track.album||'未收录专辑'}{track.durationMs?` · ${clock(track.durationMs)}`:''}</small><div className="catalog-quality-tags">{qualities.some(q=>q.type==='flac')&&<span>无损版本</span>}{qualities.some(q=>q.type==='320k')&&<span>高品质</span>}</div></div><div className="catalog-track-actions"><button className="icon-button" type="button" aria-label={`试听：${track.name}`} disabled={previewing===track.key} onClick={()=>void listen(track,preference,result.items)}>{previewing===track.key?<LoaderCircle size={17} className="spin"/>:preview?.track.key===track.key&&playing?<Pause size={17}/>:<Play size={17}/>}</button><button className={added?'button ghost':'button'} type="button" disabled={added} aria-label={added?`已收录：${track.name}`:`加入歌单：${track.name}`} onClick={()=>onAdd(track)}>{added?<Check size={16}/>:<Plus size={16}/>}<span>{added?'已收录':'加入歌单'}</span></button></div></article>;})}
      {!result.items.length&&<p className="catalog-empty">这个渠道没有找到匹配结果，可以换个关键词或渠道。</p>}
      <div className="catalog-pagination"><button className="button ghost" disabled={loading||result.page===1} onClick={()=>void search(searched,source,result.page-1)}><ChevronLeft size={16}/>上一页</button><span>{result.total?`${(result.page-1)*result.limit+1}–${(result.page-1)*result.limit+result.items.length}`:'0'} / {result.total}</span><button className="button ghost" disabled={loading||!result.hasMore} onClick={()=>void search(searched,source,result.page+1)}>下一页<ChevronRight size={16}/></button></div>
    </div>}
  </section>;
}
