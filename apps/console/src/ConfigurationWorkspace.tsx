import { lazy, Suspense, useState } from 'react';
import {MusicPreviewProvider} from './MusicPreview';
import MusicSourceSettings from './MusicSourceSettings';
const Editor=lazy(()=>import('./Editor').then(m=>({default:m.Editor})));

export default function ConfigurationWorkspace({kind,onChanged}:{kind:'music'|'shelf';onChanged:()=>void}){
  const [tab,setTab]=useState<'playlist'|'source'>('playlist');
  const [editing,setEditing]=useState(true);
  const workspace=<div className="configuration-workspace">
    {kind==='music'&&<div className="settings-tabs" role="tablist" aria-label="音乐管理" onKeyDown={event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;const buttons=Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=tab]'));const index=buttons.indexOf(event.target as HTMLButtonElement);if(index<0)return;event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowRight'?1:-1)+buttons.length)%buttons.length;buttons[next]?.click();buttons[next]?.focus();}}>{([{id:'playlist',label:'检索与歌单'},{id:'source',label:'自定义音源'}] as const).map(item=><button key={item.id} id={`settings-${item.id}-tab`} role="tab" tabIndex={tab===item.id?0:-1} aria-selected={tab===item.id} aria-controls="music-settings-panel" onClick={()=>{setTab(item.id);setEditing(true);}}>{item.label}</button>)}</div>}
    <div id="music-settings-panel" aria-labelledby={kind==='music'?`settings-${tab}-tab`:undefined} role={kind==='music'?'tabpanel':undefined}>
      {kind==='music'&&tab==='source'?<MusicSourceSettings/>:editing?<Suspense fallback={<p className="notice">正在打开设置…</p>}><Editor key="site" id="config-site" configurationPanel={kind==='shelf'?'shelf':'music'} onBack={()=>setEditing(false)} onChanged={onChanged}/></Suspense>:<button className="button" onClick={()=>setEditing(true)}>继续编辑{kind==='shelf'?'书架':'歌单'}</button>}
    </div>
  </div>;
  return kind==='music'&&tab==='playlist'&&editing?<MusicPreviewProvider>{workspace}</MusicPreviewProvider>:workspace;
}
