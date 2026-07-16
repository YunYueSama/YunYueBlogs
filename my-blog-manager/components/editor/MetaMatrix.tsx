'use client';
/* eslint-disable @next/next/no-img-element -- Cover media hosts are configured at runtime. */

import type { LucideIcon } from 'lucide-react';
import { Clock, CloudUpload, FileText, ImageIcon, Save, Send, Smile, Tag, X } from 'lucide-react';
import { KeyboardEvent, useState } from 'react';
import { toDirectUrl } from '../../lib/picbedUtils';
import { siteConfig } from '../../siteConfig';

interface Props {
  type: 'post' | 'chatter' | 'about';
  tags: string[];
  setTags: React.Dispatch<React.SetStateAction<string[]>>;
  cover: string;
  setCover: (value: string) => void;
  summary: string;
  setSummary: (value: string) => void;
  mood?: string;
  setMood?: (value: string) => void;
  allHistoryPostTags: string[];
  allHistoryChatterTags: string[];
  isLoadingTags: boolean;
  allHistoryMoods: string[];
  onSave: (isPublish: boolean) => void;
  isSaving: boolean;
  lastSaved: string | null;
  onOpenImageTool: () => void;
}

export default function MetaMatrix({
  type, tags, setTags, cover, setCover, summary, setSummary, mood, setMood,
  allHistoryPostTags, allHistoryChatterTags, isLoadingTags, allHistoryMoods,
  onSave, isSaving, lastSaved, onOpenImageTool,
}: Props) {
  const [tagInput, setTagInput] = useState('');
  const historicalTags = type === 'chatter' ? allHistoryChatterTags : allHistoryPostTags;

  const addTag = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const value = tagInput.trim().replace(/^#/, '');
    if (value && !tags.includes(value)) setTags([...tags, value]);
    setTagInput('');
  };

  return <div className="editor-meta-panel">
    <header><span>{type.toUpperCase()} MODE</span><h2>属性设置</h2></header>
    <div className="editor-meta-body">
      <EditorField icon={ImageIcon} label="封面图片">
        <button className="editor-cover" type="button" onClick={onOpenImageTool}>{cover ? <img src={toDirectUrl(cover, siteConfig.picBedUrl)} alt="封面预览" /> : <><CloudUpload size={24} /><span>从媒体库选择</span></>}</button>
        <input value={cover} onChange={(event) => setCover(toDirectUrl(event.target.value, siteConfig.picBedUrl))} placeholder="本地路径或 HTTPS 图片地址" />
      </EditorField>

      {type !== 'about' && <EditorField icon={Tag} label="标签">
        <div className="editor-tags">{tags.map((tag) => <span key={tag}>#{tag}<button type="button" onClick={() => setTags(tags.filter((value) => value !== tag))} aria-label={`移除${tag}`}><X size={11} /></button></span>)}<input value={tagInput} onChange={(event) => setTagInput(event.target.value)} onKeyDown={addTag} placeholder="输入后按 Enter" /></div>
        <div className="editor-suggestions">{isLoadingTags ? <small>正在读取历史标签</small> : historicalTags.filter((tag) => !tags.includes(tag)).slice(0, 20).map((tag) => <button type="button" key={tag} onClick={() => setTags([...tags, tag])}>+ {tag}</button>)}</div>
      </EditorField>}

      {type === 'chatter' && setMood && <EditorField icon={Smile} label="心情">
        <input value={mood || ''} onChange={(event) => setMood(event.target.value)} placeholder="今天的心情" />
        <div className="editor-suggestions">{allHistoryMoods.map((value) => <button type="button" key={value} onClick={() => setMood(value)}>{value}</button>)}</div>
      </EditorField>}

      {type !== 'about' && <EditorField icon={FileText} label="摘要">
        <textarea rows={6} value={summary} maxLength={500} onChange={(event) => setSummary(event.target.value)} placeholder="用于首页卡片与搜索预览" />
      </EditorField>}
    </div>
    <footer><p><Clock size={13} />{isSaving ? '正在保存到本地工作区' : lastSaved ? `最近保存：${lastSaved}` : '尚未保存草稿'}</p><div><button className="console-action secondary" type="button" onClick={() => onSave(false)} disabled={isSaving}><Save size={15} />存为草稿</button><button className="console-action" type="button" onClick={() => onSave(true)} disabled={isSaving}><Send size={15} />加入发布队列</button></div></footer>
  </div>;
}

function EditorField({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: React.ReactNode }) {
  return <section className="editor-meta-field"><h3><Icon size={15} />{label}</h3>{children}</section>;
}
