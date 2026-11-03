import {createContext,useCallback,useContext,useEffect,useRef,useState,type ReactNode,type RefObject} from 'react';
import {Disc3,Headphones,LoaderCircle,Pause,Play,RotateCw,SkipBack,SkipForward,Volume2,VolumeX,X} from 'lucide-react';
import {api} from './api';
import {musicChannels,type MusicTrack} from './music-channels';
import './music-catalog.css';
import './music-studio.css';

type Preview={track:MusicTrack;url:string;quality:string;preference:string};
type StudioPlayback={preview:Preview|null;loading:string;error:string;playing:boolean;audio:RefObject<HTMLAudioElement|null>;queue:MusicTrack[];listen:(track:MusicTrack,preference:string,queue?:MusicTrack[],refresh?:boolean)=>Promise<void>;toggle:()=>void;close:()=>void};
const Playback=createContext<StudioPlayback|null>(null);
export function useStudioPlayback(){const state=useContext(Playback);if(!state)throw new Error('音乐试听需要工作台上下文');return state;}

// 搜索与私人歌单共用一个音频实例。时间更新只在播放器中订阅，不反复刷新整份搜索结果。
export function MusicPreviewProvider({children}:{children:ReactNode}){
  const [preview,setPreview]=useState<Preview|null>(null),[loading,setLoading]=useState(''),[error,setError]=useState(''),[playing,setPlaying]=useState(false),[queue,setQueue]=useState<MusicTrack[]>([]);
  const audio=useRef<HTMLAudioElement>(null),request=useRef<AbortController|null>(null),generation=useRef(0),current=useRef<Preview|null>(null),activeQueue=useRef<MusicTrack[]>([]);
  const toggle=useCallback(()=>{const element=audio.current;if(!element||!current.current)return;if(!element.paused)element.pause();else void element.play().catch(reason=>{if(reason.name!=='NotAllowedError')setError('音频暂时无法播放，请刷新音源或选择其他版本。');});},[]);
  const listen=useCallback(async(track:MusicTrack,preference:string,items:MusicTrack[]=[],refresh=false)=>{
    if(!refresh&&current.current?.track.key===track.key&&current.current.preference===preference&&audio.current?.readyState){activeQueue.current=items;setQueue(items);toggle();return;}
    request.current?.abort();const controller=new AbortController();request.current=controller;const turn=++generation.current;
    const element=audio.current;element?.pause();if(element){element.removeAttribute('src');element.load();}
    const pending={track,url:'',quality:'',preference};current.current=pending;setPreview(pending);setLoading(track.key);setError('');setPlaying(false);activeQueue.current=items;setQueue(items);
    try{
      const result=await api<{url:string;quality:string}>('/integrations/music/preview',{method:'POST',body:JSON.stringify({track,preference}),signal:controller.signal});
      if(turn!==generation.current||controller.signal.aborted)return;
      const next={track,...result,preference};current.current=next;setPreview(next);
      if(element){element.src=result.url;try{await element.play();}catch(reason){if(turn===generation.current&&(reason as Error).name!=='NotAllowedError'&&(reason as Error).name!=='AbortError')setError('音频暂时无法播放，请刷新音源或选择其他版本。');}}
    }catch(reason){if(turn===generation.current&&!controller.signal.aborted)setError((reason as Error).message);}
    finally{if(turn===generation.current)setLoading('');}
  },[toggle]);
  const close=useCallback(()=>{request.current?.abort();generation.current++;audio.current?.pause();audio.current?.removeAttribute('src');audio.current?.load();current.current=null;setPreview(null);setError('');setLoading('');setPlaying(false);},[]);
  useEffect(()=>()=>{request.current?.abort();generation.current++;},[]);
  function failed(){const value=current.current,element=audio.current;if(!value?.url||!element?.error||element.currentSrc!==value.url)return;
    if(value.preference==='lossless'&&value.quality==='FLAC 无损'){void listen(value.track,'320k',activeQueue.current,true);return;}
    setPlaying(false);setError('音频暂时无法播放，请刷新音源或选择其他版本。');
  }
  return <Playback.Provider value={{preview,loading,error,playing,audio,queue,listen,toggle,close}}>{children}<audio className="studio-audio-element" ref={audio} preload="none" onPlay={()=>{if(current.current?.url&&audio.current?.currentSrc===current.current.url)setPlaying(true);}} onPause={()=>{if(audio.current?.paused)setPlaying(false);}} onEnded={()=>{if(audio.current?.ended&&current.current?.url===audio.current.currentSrc)setPlaying(false);}} onError={failed}/></Playback.Provider>;
}

const clock=(seconds:number)=>Number.isFinite(seconds)?`${Math.floor(seconds/60)}:${String(Math.floor(seconds%60)).padStart(2,'0')}`:'—:—';
export function MusicPreviewPlayer(){
  const {preview,loading,error,playing,audio,queue,listen,toggle,close}=useStudioPlayback();
  const panel=useRef<HTMLElement>(null);
  useEffect(()=>{if(preview?.track.key&&matchMedia('(max-width:900px)').matches){const frame=requestAnimationFrame(()=>panel.current?.scrollIntoView({block:'start',behavior:'auto'}));return()=>cancelAnimationFrame(frame);}},[preview?.track.key]);
  const [time,setTime]=useState(0),[duration,setDuration]=useState(0),[volume,setVolume]=useState(1),[muted,setMuted]=useState(false),[buffering,setBuffering]=useState(false);
  useEffect(()=>{const element=audio.current;if(!element)return;const update=()=>{setTime(element.currentTime||0);setDuration(Number.isFinite(element.duration)?element.duration:0);};const waiting=()=>setBuffering(true),ready=()=>setBuffering(false);update();for(const event of ['timeupdate','durationchange','loadedmetadata','emptied'])element.addEventListener(event,update);element.addEventListener('waiting',waiting);element.addEventListener('playing',ready);element.addEventListener('canplay',ready);return()=>{for(const event of ['timeupdate','durationchange','loadedmetadata','emptied'])element.removeEventListener(event,update);element.removeEventListener('waiting',waiting);element.removeEventListener('playing',ready);element.removeEventListener('canplay',ready);};},[audio]);
  useEffect(()=>{setBuffering(false);},[preview?.url]);
  const at=queue.findIndex(track=>track.key===preview?.track.key),busy=!!loading;
  const skip=(offset:number)=>{const track=queue[(at+offset+queue.length)%queue.length];if(track&&preview)void listen(track,preview.preference,queue);};
  return <section ref={panel} className={`studio-player ${playing?'is-playing':''} ${preview?'has-track':''}`} aria-label="音乐试听播放器">
    <header className="studio-player-header"><span><Headphones size={16}/>试听间</span>{preview?<button className="icon-button" aria-label="关闭音乐试听" onClick={close}><X size={16}/></button>:<small>从一首喜欢的歌开始</small>}</header>
    <div className="studio-player-art"><div className="studio-player-glow"/><div className="studio-player-record"><Disc3 size={62}/></div>{preview?.track.cover&&<img src={preview.track.cover} key={preview.track.cover} referrerPolicy="no-referrer" alt="歌曲封面" style={{opacity:0}} onLoad={event=>{event.currentTarget.style.opacity='1';}} onError={event=>{event.currentTarget.style.visibility='hidden';}}/>}<span className="studio-player-equalizer" aria-hidden="true">{[1,2,3,4,5].map(n=><i key={n}/>)}</span></div>
    <div className="studio-player-copy"><span className="studio-player-channel">{preview?musicChannels[preview.track.source].name:'YOUR LISTENING ROOM'}</span><h3>{preview?.track.name||'此刻，想听点什么？'}</h3><p>{preview?.track.artist||'在检索结果或私人歌单中点击试听'}</p>{preview?.quality&&<span className="studio-player-quality">{preview.quality}</span>}</div>
    <div className="studio-player-timeline"><label className="sr-only" htmlFor="studio-playback-position">试听进度</label><input id="studio-playback-position" type="range" min={0} max={duration||1} step={0.1} value={Math.min(time,duration||1)} disabled={!duration||busy} onChange={event=>{if(audio.current){audio.current.currentTime=Number(event.target.value);setTime(Number(event.target.value));}}}/><div><span>{clock(time)}</span><span>{duration?clock(duration):'—:—'}</span></div></div>
    <div className="studio-player-controls"><button className="icon-button" aria-label="上一首试听" disabled={busy||queue.length<2} onClick={()=>skip(-1)}><SkipBack size={19}/></button><button className="studio-player-play" aria-label={playing?'暂停试听':'播放试听'} disabled={!preview?.url||busy} onClick={toggle}>{busy?<LoaderCircle size={23} className="spin"/>:playing?<Pause size={23}/>:<Play size={23}/>}</button><button className="icon-button" aria-label="下一首试听" disabled={busy||queue.length<2} onClick={()=>skip(1)}><SkipForward size={19}/></button></div>
    <div className="studio-player-volume"><button className="icon-button" aria-label={muted?'取消试听静音':'试听静音'} onClick={()=>{if(audio.current)audio.current.muted=!muted;setMuted(!muted);}}>{muted||!volume?<VolumeX size={17}/>:<Volume2 size={17}/>}</button><label className="sr-only" htmlFor="studio-playback-volume">试听音量</label><input id="studio-playback-volume" type="range" min={0} max={1} step={0.05} value={muted?0:volume} onChange={event=>{const value=Number(event.target.value);setVolume(value);setMuted(false);if(audio.current){audio.current.volume=value;audio.current.muted=false;}}}/></div>
    {(busy||buffering)&&!error&&<p className="studio-player-status" role="status">{busy?'正在寻找可播放音源…':'正在缓冲…'}</p>}
    {error&&<div className="studio-player-error" role="status"><p>{error}</p><button className="button ghost" disabled={busy} onClick={()=>preview&&void listen(preview.track,preview.preference,queue,true)}><RotateCw size={14}/>刷新音源</button></div>}
  </section>;
}
