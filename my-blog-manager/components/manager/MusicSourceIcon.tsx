/** 轻量平台标识使用内联矢量，无需额外图片请求。 */
export default function MusicSourceIcon({ source, size = 20 }: { source: 'netease' | 'kugou'; size?: number }) {
  return <span className={`music-source-icon is-${source}`} style={{ width: size, height: size }} aria-hidden="true">
    <svg viewBox="0 0 24 24" width="100%" height="100%" fill="none">
      {source === 'netease' ? <><path d="M16.4 7.5a7.1 7.1 0 1 0 2.4 5.3c0-3-1.8-4.8-4.4-4.8-2.1 0-3.8 1.5-3.8 3.5s1.5 3.2 3.1 3.2c1.4 0 2.3-.9 2.3-2.2V3.5l4 1.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></> : <path d="M5 4h3.5v7l7-7H20l-8 8 8 8h-4.6l-6.9-7v7H5z" fill="currentColor" />}
    </svg>
  </span>;
}
