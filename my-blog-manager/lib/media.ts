import { managerApi } from './managerApi';

export type ImageAsset = {
  id: string;
  url: string;
  thumbnailUrl?: string;
  width: number;
  height: number;
  bytes: number;
  mimeType: string;
  alt: string;
  source: 'image-host' | 'external' | 'local';
  createdAt: string;
};

export type MediaPage = { items: ImageAsset[]; total: number };

export async function imageDimensions(file: File) {
  try {
    const bitmap = await createImageBitmap(file);
    const dimensions = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return dimensions;
  } catch {
    return { width: 0, height: 0 };
  }
}

export function validateImageFile(file: File) {
  if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'].includes(file.type)) {
    throw new Error('只支持 PNG、JPEG、GIF、WebP 或 AVIF 图片。');
  }
  if (file.size > 12 * 1024 * 1024) throw new Error('图片不能超过 12MB。');
}

export async function uploadImage(file: File, alt = '') {
  validateImageFile(file);
  const dimensions = await imageDimensions(file);
  const body = new FormData();
  body.append('file', file);
  body.append('width', String(dimensions.width));
  body.append('height', String(dimensions.height));
  body.append('alt', alt);
  return managerApi<ImageAsset>('/api/picbed/upload', { method: 'POST', body });
}

export function loadMedia(query = '') {
  return managerApi<MediaPage>(`/api/picbed/assets?query=${encodeURIComponent(query)}&limit=120`);
}

export function registerExternalImage(url: string, alt = '') {
  return managerApi<ImageAsset>('/api/picbed/assets', {
    method: 'POST',
    body: JSON.stringify({ url, alt }),
  });
}
