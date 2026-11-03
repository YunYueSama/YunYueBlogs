import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { ArrowRight, Command, FileText, Search, Sparkles, X } from 'lucide-react';
import type { DocumentSummary } from './contracts';

type View='home'|'documents'|'collections'|'media'|'releases'|'settings'|'account'|'editor'|'music'|'shelf';
export type StudioCharacter='aoko'|'alice'|'souju';
export const sceneNames={aoko:'暮色青子',alice:'月下有珠',souju:'山间草十郎'};
export function useStudioCharacter(){
  const [character,setCharacter]=useState<StudioCharacter>(()=>{try{const saved=localStorage.getItem('yunyue-studio-character');if(saved==='alice'||saved==='souju')return saved;}catch{}return 'aoko';});
  const activeTransition=useRef<ViewTransition|null>(null);
  const generation=useRef(0);
  useEffect(()=>{document.documentElement.dataset.studioCharacter=character;try{localStorage.setItem('yunyue-studio-character',character);}catch{}},[character]);
  function changeCharacter(next:StudioCharacter){
    const current=++generation.current;
    activeTransition.current?.skipTransition();
    const update=()=>{if(current!==generation.current)return;document.documentElement.dataset.studioCharacter=next;flushSync(()=>setCharacter(next));};
    if(!document.startViewTransition||document.hidden||matchMedia('(prefers-reduced-motion: reduce)').matches){update();return;}
    try {
      const transition=document.startViewTransition(update);activeTransition.current=transition;
      // 快速连续选择会正常取消旧快照，ready 的拒绝也必须被消费，避免成为全局错误。
      void transition.ready.catch(()=>{});
      void transition.finished.catch(()=>{}).finally(()=>{if(activeTransition.current===transition)activeTransition.current=null;});
    }catch{update();}
  }
  return {character,setCharacter:changeCharacter};
}
export function ScenePicker({value,onChange}:{value:StudioCharacter;onChange:(value:StudioCharacter)=>void}){
  const root=useRef<HTMLDetailsElement>(null);
  useEffect(()=>{const outside=(event:PointerEvent)=>{if(event.target instanceof Node&&!root.current?.contains(event.target))root.current?.removeAttribute('open');};const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'&&root.current?.open){root.current.open=false;root.current.querySelector('summary')?.focus();}};document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);};},[]);
  return <details ref={root} className="studio-scene-picker"><summary aria-label={`切换创作场景，当前为${sceneNames[value]}`}><Sparkles size={16}/><span>{sceneNames[value]}</span></summary><div role="group" aria-label="创作场景">{(['aoko','alice','souju'] as const).map(key=><button key={key} className={`scene-option scene-${key}`} aria-pressed={value===key} onClick={event=>{onChange(key);event.currentTarget.closest('details')?.removeAttribute('open');}}><i/><span>{sceneNames[key]}</span><small>{key==='aoko'?'清透与好奇':key==='alice'?'静谧与灵感':'温暖与日常'}</small></button>)}</div></details>;
}
export function CommandPalette({documents,onClose,onNavigate,onCreate}:{documents:DocumentSummary[];onClose:()=>void;onNavigate:(view:View,id?:string)=>void;onCreate:()=>void}){
  const dialog=useRef<HTMLDialogElement>(null);const [query,setQuery]=useState('');const [selected,setSelected]=useState(0);
  const actions=[{id:'new',title:'开始新的创作',detail:'新建一份私密草稿',run:onCreate},...[{view:'home' as const,title:'回到创作概览'},{view:'documents' as const,title:'浏览全部文稿'},{view:'releases' as const,title:'打开发布工作台'},{view:'settings' as const,title:'查看站点设置'},{view:'music' as const,title:'管理音乐与音源'},{view:'shelf' as const,title:'配置 ACG 书架'},{view:'media' as const,title:'打开图床与素材'}].map(item=>({id:item.view,title:item.title,detail:'工作空间',run:()=>onNavigate(item.view)})),...documents.map(doc=>({id:doc.id,title:doc.title,detail:doc.publish?'文稿 · 包含发布':'文稿 · 私密草稿',run:()=>onNavigate('editor',doc.id)}))].filter(action=>`${action.title} ${action.detail}`.toLowerCase().includes(query.toLowerCase())).slice(0,8);
  useEffect(()=>{const previous=document.activeElement as HTMLElement|null;dialog.current?.showModal();return()=>{queueMicrotask(()=>previous?.focus());};},[]);
  useEffect(()=>setSelected(0),[query]);
  function run(index:number){actions[index]?.run();onClose();}
  return <dialog className="command-dialog" ref={dialog} onCancel={onClose} aria-label="快速导航与文稿搜索"><div className="command-input"><Search size={22}/><input autoFocus role="combobox" aria-label="搜索页面和文稿" aria-expanded="true" aria-controls="command-results" aria-activedescendant={actions[selected]?`command-${selected}`:undefined} placeholder="想去哪里，或继续哪一篇故事？" value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==='ArrowDown'){e.preventDefault();setSelected(n=>Math.min(n+1,actions.length-1));}if(e.key==='ArrowUp'){e.preventDefault();setSelected(n=>Math.max(0,n-1));}if(e.key==='Enter'){e.preventDefault();run(selected);}}}/><button className="icon-button" aria-label="关闭快速导航" onClick={onClose}><X size={19}/></button></div><div className="command-results" id="command-results" role="listbox" aria-label="匹配结果">{actions.length?actions.map((action,index)=><button id={`command-${index}`} role="option" aria-selected={index===selected} key={action.id} onPointerMove={()=>setSelected(index)} onClick={()=>run(index)}><span>{action.id==='new'?<Sparkles size={18}/>:<FileText size={18}/>}</span><strong>{action.title}<small>{action.detail}</small></strong><ArrowRight size={15}/></button>):<p>没有找到相关文稿，试试其他关键词。</p>}</div><footer><span><kbd>↑</kbd><kbd>↓</kbd>选择<kbd>Enter</kbd>打开</span><span><Command size={12}/> K</span></footer></dialog>;
}
