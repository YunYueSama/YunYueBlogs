import { StudioSelect } from './StudioSelect';
import {useState} from 'react';
import { ArrowDown, ArrowUp, ChevronDown, Disc3, LoaderCircle, Pause, Pencil, Play, Trash2 } from 'lucide-react';
import MusicCatalog from './MusicCatalog';
import {useStudioPlayback} from './MusicPreview';
import {musicChannels,type MusicTrack} from './music-channels';
export type {MusicTrack} from './music-channels';
const str=(value:unknown)=>typeof value==='string'?value:'';
export function MusicPlaybackSettings({site,onChange}:{site:Record<string,unknown>;onChange:(next:Record<string,unknown>)=>void}){
  const policy=(site.musicPlayback&&typeof site.musicPlayback==='object'?site.musicPlayback:{}) as Record<string,unknown>;
  return <section className="config-section music-playback-settings"><header><span><Disc3 size={20}/></span><div><h3>播放音质与访客流量</h3></div></header><div className="config-fields"><label className="config-field">播放音质<StudioSelect label="播放音质" value={String(policy.defaultQuality||'320k')} onChange={value=>{const {allowLossless:_old,...settings}=policy;onChange({...site,musicPlayback:{...settings,defaultQuality:value}});}}><option value="320k">320 kbps · 推荐</option><option value="lossless">最高兼容 · 优先 FLAC</option></StudioSelect></label><p className="field-help">320 kbps 约 144 MB/小时；无损体积更大。发布后应用于博客。</p></div></section>;
}
export function AutomaticLyrics(){return <div className="automatic-lyrics-note"><Disc3 size={18}/><div><strong>歌词自动跟随</strong><p>选中歌曲后自动读取同步歌词与逐字时间轴，无需手动排轴；没有逐字歌词时使用逐行歌词。</p></div></div>;}
export function MusicTracksForm({site,onChange}:{site:Record<string,unknown>;onChange:(next:Record<string,unknown>)=>void}){
  const [editing,setEditing]=useState('');
  const {listen,preview,loading,playing}=useStudioPlayback();
  const rows=(Array.isArray(site.musicTracks)?site.musicTracks:[]) as MusicTrack[];
  const policy=(site.musicPlayback&&typeof site.musicPlayback==='object'?site.musicPlayback:{}) as Record<string,unknown>;
  const save=(next:MusicTrack[])=>onChange({...site,musicTracks:next,musicIds:Array.isArray(site.musicIds)?site.musicIds:[]});
  const update=(index:number,key:string,value:string)=>save(rows.map((row,i)=>i===index?{...row,[key]:value}:row));
  const add=(track:MusicTrack)=>{if(!rows.some(row=>row.key.toUpperCase()===track.key.toUpperCase()))save([...rows,track]);};
  const move=(index:number,by:number)=>{const next=[...rows];[next[index],next[index+by]]=[next[index+by],next[index]];save(next);};
  return <div className="configuration-form music-settings">
    <MusicCatalog selected={rows} onAdd={add} preference={String(policy.defaultQuality||'320k')}/><AutomaticLyrics/>
    <section className="config-section playlist-section" aria-label="私人歌单"><header><span><Disc3 size={20}/></span><div><h3>私人歌单</h3><p>把喜欢的旋律留在这里，随时试听、整理。</p></div><strong className="config-count">{rows.length} 首</strong></header>
      <div className="playlist-tracks">{rows.map((track,index)=>{const active=preview?.track.key===track.key,open=editing===track.key,qualities=(track.lx?.types||[]) as {type:string}[];return <article className={`playlist-track ${active?'is-previewing':''} ${open?'is-editing':''}`} key={track.key}>
        <div className="playlist-track-row"><span className="playlist-order">{String(index+1).padStart(2,'0')}</span><div className="playlist-art"><Disc3 size={25}/>{track.cover&&<img src={track.cover} loading="lazy" decoding="async" alt="" referrerPolicy="no-referrer" onError={event=>{event.currentTarget.style.display='none';}}/>}</div>
          <div className="playlist-copy"><strong>{track.name}</strong><span>{track.artist||'歌手信息待补充'}</span><small>{track.album||'未收录专辑'}{track.durationMs?` · ${Math.floor(track.durationMs/60000)}:${String(Math.floor(track.durationMs/1000)%60).padStart(2,'0')}`:''}</small><div className="playlist-tags"><span>{musicChannels[track.source]?.name||track.source}</span>{qualities.some(q=>q.type==='flac')&&<span>无损版本</span>}</div></div>
          <div className="playlist-actions"><button className="icon-button" aria-label={`试听歌单：${track.name}`} disabled={loading===track.key} onClick={()=>void listen(track,String(policy.defaultQuality||'320k'),rows)}>{loading===track.key?<LoaderCircle className="spin" size={17}/>:active&&playing?<Pause size={17}/>:<Play size={17}/>}</button><button className="icon-button" aria-expanded={open} aria-controls={`track-edit-${index}`} aria-label={`编辑曲目：${track.name}`} onClick={()=>setEditing(open?'':track.key)}>{open?<ChevronDown size={17}/>:<Pencil size={16}/>}</button></div>
        </div>
        {open&&<div className="playlist-edit" id={`track-edit-${index}`}><div className="config-fields">{[['name','歌曲名'],['artist','歌手'],['album','专辑'],['cover','封面地址']].map(([key,label])=><label className="config-field" key={key}>{label}<input value={str(track[key])} onChange={event=>update(index,key,event.target.value)}/></label>)}</div><div className="config-entry-footer"><div className="button-row"><button className="button ghost" disabled={index===0} onClick={()=>move(index,-1)} aria-label={`上移 ${track.name}`}><ArrowUp size={15}/>上移</button><button className="button ghost" disabled={index===rows.length-1} onClick={()=>move(index,1)} aria-label={`下移 ${track.name}`}><ArrowDown size={15}/>下移</button></div><button onClick={()=>{if(confirm(`从歌单移除「${track.name}」？历史修订仍会保留，发布后才影响公开站点。`))save(rows.filter((_,i)=>i!==index));}}><Trash2 size={14}/>移除</button></div></div>}
      </article>;})}</div>
      {!rows.length&&<p className="catalog-empty">在上方检索音乐，找到喜欢的版本后加入歌单。</p>}
    </section>
  </div>;
}
