import { Children, isValidElement, useId, useLayoutEffect, useRef, useState, type OptionHTMLAttributes, type ReactElement, type ReactNode } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import './studio-select.css';

type Props={label:string;value:string|number;onChange:(value:string)=>void;children:ReactNode;disabled?:boolean;name?:string;id?:string};

// 选择状态先提交，浮层只负责呈现；顶层 Popover 不受配置卡片 overflow 裁切。
export function StudioSelect({label,value,onChange,children,disabled=false,name,id}:Props){
  const generated=useId();const triggerId=id||`studio-select-${generated}`,menuId=`${triggerId}-menu`;
  const trigger=useRef<HTMLButtonElement>(null),menu=useRef<HTMLDivElement>(null);
  const options=Children.toArray(children).filter(isValidElement).map(child=>{
    const option=child as ReactElement<OptionHTMLAttributes<HTMLOptionElement>>;
    return {value:String(option.props.value??option.props.children??''),label:option.props.children,disabled:!!option.props.disabled};
  });
  const selected=options.findIndex(option=>option.value===String(value));
  const [open,setOpen]=useState(false),[active,setActive]=useState(selected);
  const search=useRef({text:'',at:0});const supported=typeof HTMLElement!=='undefined'&&'showPopover' in HTMLElement.prototype;
  const available=options.map((option,index)=>option.disabled?-1:index).filter(index=>index>=0);
  const position=()=>{
    const bounds=trigger.current?.getBoundingClientRect(),popup=menu.current;if(!bounds||!popup)return;
    const width=Math.min(Math.max(180,bounds.width),innerWidth-24),below=innerHeight-bounds.bottom-16,above=bounds.top-16;
    const upwards=below<Math.min(280,options.length*44+12)&&above>below;
    Object.assign(popup.style,{width:`${width}px`,left:`${Math.max(12,Math.min(bounds.left,innerWidth-width-12))}px`,maxHeight:`${Math.max(44,Math.min(304,upwards?above:below))}px`,top:upwards?'auto':`${bounds.bottom+8}px`,bottom:upwards?`${innerHeight-bounds.top+8}px`:'auto'});
  };
  const close=()=>{menu.current?.hidePopover();setOpen(false);search.current.text='';};
  const reveal=(index=selected)=>{setActive(available.includes(index)?index:available[0]??-1);position();menu.current?.showPopover();setOpen(true);};
  const commit=(index:number)=>{const option=options[index];if(!option||option.disabled)return;onChange(option.value);close();};
  useLayoutEffect(()=>{
    if(!open)return;
    const popup=menu.current;if(!popup)return;
    const controller=new AbortController();window.addEventListener('resize',position,{signal:controller.signal});
    document.addEventListener('scroll',event=>{if(event.target!==popup)position();},{capture:true,passive:true,signal:controller.signal});
    return()=>controller.abort();
  },[open,options.length]);
  useLayoutEffect(()=>{if(open)menu.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({block:'nearest'});},[open,active]);
  useLayoutEffect(()=>{if(disabled&&open)close();},[disabled]);
  if(!supported)return <select id={id} className="studio-select-fallback" aria-label={label} value={value} onChange={event=>onChange(event.target.value)} disabled={disabled} name={name}>{children}</select>;
  return <span className="studio-select">
    {name&&<input type="hidden" name={name} value={value} disabled={disabled}/>}
    <button ref={trigger} type="button" id={triggerId} className="studio-select-trigger" role="combobox" aria-label={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={menuId} aria-activedescendant={open&&active>=0?`${menuId}-${active}`:undefined} disabled={disabled||!available.length} popoverTarget={menuId} popoverTargetAction="toggle" onClick={()=>{position();setActive(available.includes(selected)?selected:available[0]??-1);}} onKeyDown={event=>{
      const key=event.key;
      if(['ArrowDown','ArrowUp','Home','End'].includes(key)){
        event.preventDefault();const offset=available.indexOf(active);
        const next=key==='Home'?available[0]:key==='End'?available.at(-1):open?available[(offset+(key==='ArrowDown'?1:-1)+available.length)%available.length]:selected>=0?selected:key==='ArrowUp'?available.at(-1):available[0];
        if(!open)reveal(next);else setActive(next??-1);return;
      }
      if(key==='Enter'||key===' '){event.preventDefault();if(open)commit(active);else reveal();return;}
      if(key==='Escape'&&open){event.preventDefault();close();return;}
      if(key==='Tab'&&open){commit(active);return;}
      if(key.length===1&&!event.altKey&&!event.ctrlKey&&!event.metaKey){
        event.preventDefault();const now=Date.now();search.current.text=(now-search.current.at<650?search.current.text:'')+key.toLocaleLowerCase();search.current.at=now;
        const match=available.find(index=>String(options[index].label).toLocaleLowerCase().startsWith(search.current.text));
        if(match!==undefined){if(open)setActive(match);else reveal(match);}
      }
    }}><span>{options[selected]?.label||'请选择'}</span><ChevronDown size={16} aria-hidden="true"/></button>
    <div ref={menu} popover="auto" className="studio-select-menu" role="listbox" aria-label={label} id={menuId} onToggle={event=>{const expanded=event.currentTarget.matches(':popover-open');setOpen(expanded);if(!expanded)search.current.text='';}}>
      {options.map((option,index)=><button type="button" id={`${menuId}-${index}`} data-index={index} role="option" aria-selected={index===selected} aria-disabled={option.disabled} disabled={option.disabled} tabIndex={-1} key={option.value} className={index===active?'is-active':''} onPointerDown={event=>event.preventDefault()} onPointerMove={()=>!option.disabled&&setActive(index)} onClick={()=>{commit(index);trigger.current?.focus();}}><span>{option.label}</span>{index===selected&&<Check size={16} aria-hidden="true"/>}</button>)}
    </div>
  </span>;
}
