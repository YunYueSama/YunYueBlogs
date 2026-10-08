/** 列表使用平台缩略图，保留原始封面地址供保存和播放器使用。 */
export function musicCoverThumbnail(value: string): string {
  if (!value) return '';
  if (value.startsWith('/') && !value.startsWith('//')) return value;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    if (url.hostname === 'music.126.net' || url.hostname.endsWith('.music.126.net')) {
      url.protocol = 'https:';
      url.searchParams.set('param', '120y120');
    } else if (url.hostname === 'kugou.com' || url.hostname.endsWith('.kugou.com')) {
      url.protocol = 'https:';
      url.pathname = url.pathname.replace(/\{size\}|%7Bsize%7D/gi, '120').replace(/(\/stdmusic\/|\/soft\/collection\/)\d+\//, (_, prefix: string) => `${prefix}120/`);
    }
    return url.href;
  } catch { return ''; }
}
