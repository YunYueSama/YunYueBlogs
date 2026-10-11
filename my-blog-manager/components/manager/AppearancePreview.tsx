'use client';

import { ExternalLink, Monitor, Smartphone, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import styles from './AppearancePreview.module.css';

const themes = [
  { id: 'aoko', name: '苍崎青子', title: '青色回路', image: '/appearance/aoko-c0cf1ca5.webp', width:640, height:622, faceX:.52, faceY:.22, faceHeight:.25, scene: '洋馆的一页日常', quote: '人生的第一个观众不是别人，就是自己啊。', spell: '点亮青色回路' },
  { id: 'alice', name: '久远寺有珠', title: '洋馆月色', image: '/appearance/alice-de089c85.webp', width:640, height:451, faceX:.30, faceY:.25, faceHeight:.19, scene: '钟楼与夜的边缘', quote: '约定就是约定。', spell: '唤醒午睡之镜' },
  { id: 'souju', name: '静希草十郎', title: '山间来风', image: '/appearance/souju-official-2022-cd5e8cde.webp', width:750, height:1000, faceX:.5, faceY:.18, faceHeight:.16, scene: '静希草十郎 · 官网立绘', quote: '在山上啊，星星真的仿佛触手可及。', spell: '让夜风经过' },
] as const;

export default function AppearancePreview({ title, bio, siteUrl }: { title: string; bio: string; siteUrl: string }) {
  const [selected, setSelected] = useState<string>('aoko');
  const [viewport, setViewport] = useState<'desktop' | 'mobile'>('desktop');
  const [calm, setCalm] = useState(false);
  const [casting, setCasting] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const theme = themes.find(item => item.id === selected) || themes[0];
  const publicUrl = /^https?:\/\//i.test(siteUrl) ? siteUrl : undefined;
  useEffect(() => () => clearTimeout(timer.current), []);
  const cast = () => {
    clearTimeout(timer.current); setCasting(true);
    timer.current = setTimeout(() => setCasting(false), 1100);
  };

  return <section className={`console-panel ${styles.panel}`} aria-label="角色外观预览">
    <header><div><h2>看看此刻的夜色</h2><span>角色、画面与阅读层次，一起预览。</span></div>{publicUrl && <a className="console-action secondary" href={publicUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} />打开公开站</a>}</header>
    <div className={styles.controls}>
      <div className={styles.choices} role="group" aria-label="预览角色">{themes.map(item => <button type="button" key={item.id} data-theme={item.id} aria-pressed={selected === item.id} onClick={() => { setSelected(item.id); setCasting(false); }}><i aria-hidden="true" />{item.name}</button>)}</div>
      <div className={styles.devices} role="group" aria-label="预览尺寸"><button type="button" aria-pressed={viewport === 'desktop'} onClick={() => setViewport('desktop')}><Monitor size={15} />桌面</button><button type="button" aria-pressed={viewport === 'mobile'} onClick={() => setViewport('mobile')}><Smartphone size={15} />手机</button></div>
      <label className={styles.motion}><input type="checkbox" checked={calm} onChange={event => { setCalm(event.target.checked); setCasting(false); }} />减少动画</label>
    </div>
    <div className={styles.canvas}>
      <div className={styles.preview} data-theme={theme.id} data-viewport={viewport} data-calm={calm} data-casting={casting}>
        <div className={styles.previewHeader}><strong>{title || '云月的书房'}</strong><span>{theme.title}</span></div>
        <div className={styles.intro}><small>AI · CODE · MAGIC</small><h3>把日常，留在书页间。</h3><p>{bio || '在代码里构筑理想，在文字里收藏日常。'}</p></div>
        <div className={styles.bookmark}>
          <div className={styles.copy}><small>魔夜书签 · {theme.name}</small><blockquote>{theme.quote}</blockquote><button type="button" disabled={casting} onClick={cast}><Sparkles size={14} />{theme.spell}</button><span className={styles.feedback} role="status">{casting ? theme.id === 'souju' ? '夜风轻轻翻过这一页。' : '光影停留在这一页。' : '点一下，感受局部光影。'}</span><i className={styles.light} aria-hidden="true" /></div>
          <div className={styles.art} aria-hidden="true"><Image src={theme.image} width={theme.width} height={theme.height} style={{ height:`${.68 / theme.faceHeight * 100}%`, transform:`translate(-${theme.faceX * 100}%, -${theme.faceY * 100}%)` }} alt="" loading="lazy" unoptimized /></div>
        </div>
        <div className={styles.reading}><span>最近更新</span><strong>文章与故事，始终是这一页的主角。</strong><p>官方角色画面淡淡融入语录，阅读区保持清晰。</p></div>
      </div>
    </div>
    <p className={styles.note}>这里是本地组件预览；角色、尺寸和动画选项只影响当前预览，站点标题与简介会跟随上方表单。公开站由访客自行选择角色主题。</p>
  </section>;
}
