/**
 * 图床 URL 工具函数
 * CloudFlare-ImgBed 的 publicUrl 是网页链接（如 https://tu.majo-elaina.top/xxx.jpg）
 * 真正的图片直链需要加 /file/ 路径（如 https://tu.majo-elaina.top/file/xxx.jpg）
 */

/**
 * 将图床 publicUrl 转为图片直链
 * @param url 原始 URL（可能是 publicUrl 格式）
 * @param picBedBase 图床基础地址（如 https://tu.majo-elaina.top）
 * @returns 转换后的图片直链
 */
export function toDirectUrl(url: string, picBedBase?: string): string {
  if (!url || !picBedBase) return url || '';
  const base = picBedBase.replace(/\/$/, '');

  // 格式1: https://tu.majo-elaina.top/xxx.jpg → https://tu.majo-elaina.top/file/xxx.jpg
  if (url.startsWith(base + '/') && !url.includes('/file/')) {
    return url.replace(base + '/', base + '/file/');
  }

  // 格式2: https://tu.majo-elaina.topxxx.jpg（缺少分隔符）
  if (url.startsWith(base) && !url.startsWith(base + '/') && url.length > base.length) {
    return base + '/file/' + url.slice(base.length);
  }

  return url;
}
