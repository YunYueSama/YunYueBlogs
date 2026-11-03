import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Clock3, Eye, X } from 'lucide-react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { api } from './api';
import { DocumentCover, shortDate, contentDate } from './ContentGallery';
import { kindLabels, type ContentDocument, type DocumentSummary } from './contracts';

export default function QuickPreview({summary,onClose,onOpen}:{summary:DocumentSummary;onClose:()=>void;onOpen:()=>void}){
  const dialog=useRef<HTMLDialogElement>(null);const [doc,setDoc]=useState<ContentDocument|null>(null);const [error,setError]=useState('');
  useEffect(()=>{dialog.current?.showModal();let active=true;api<ContentDocument>(`/documents/${summary.id}`).then(value=>{if(active)setDoc(value);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[summary.id]);
  const html=doc?DOMPurify.sanitize(marked.parse(doc.body,{async:false}),{FORBID_TAGS:['iframe','style','script','form'],FORBID_ATTR:['style']}):'';
  return <dialog ref={dialog} className="quick-preview" aria-labelledby="quick-preview-title" onCancel={onClose}><header><span><Eye size={15}/>私密预览</span><button className="icon-button" aria-label="关闭预览" onClick={onClose}><X size={20}/></button></header><div className="quick-preview-scroll"><DocumentCover doc={summary}/><div className="quick-preview-copy"><span className="section-code">{kindLabels[summary.kind]} / {shortDate(contentDate(summary))}</span><h2 id="quick-preview-title">{summary.title}</h2><p className="preview-description">{summary.metadata.description}</p>{error?<p role="alert" className="form-error">{error}</p>:!doc?<div className="preview-skeleton" aria-label="正在载入正文"><i/><i/><i/></div>:['site','projects','albums','friends'].includes(doc.kind)?<pre>{doc.body}</pre>:<div className="prose document-preview" dangerouslySetInnerHTML={{__html:html}}/>}</div></div><footer><span><Clock3 size={13}/>仅站长可见</span><button className="button primary" onClick={onOpen}>进入编辑器<ArrowRight size={16}/></button></footer></dialog>;
}
