'use client';
/* eslint-disable @next/next/no-img-element -- 音乐平台提供专用缩略图地址。 */
import { useState } from 'react';
import { Disc3 } from 'lucide-react';
import { musicCoverThumbnail } from '../../lib/musicCover';

export default function MusicCover({ src = '' }: { src?: string }) {
  const [failed, setFailed] = useState('');
  const [original, setOriginal] = useState('');
  const thumbnail = musicCoverThumbnail(src);
  const image = original === src ? src : thumbnail;
  return <div className="music-resource-cover" title={failed === src && src ? '封面暂时无法加载' : undefined}>
    {image && failed !== src ? <img src={image} width={56} height={56} alt="" decoding="async" referrerPolicy="no-referrer" onError={() => { if (image !== src) setOriginal(src); else setFailed(src); }} /> : <Disc3 size={22} />}
  </div>;
}
