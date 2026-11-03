import {validMusicId} from '../src/music-channels';
import { HttpError } from './http';
const object = (v: unknown): v is Record<string,unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const invalid = (message: string): never => { throw new HttpError(400,message); };

export function validatePublicConfiguration(kind: string, value: Record<string,unknown>) {
  const visit = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    for (const [key,entry] of Object.entries(node)) {
      if (/^(cookie|cookies|token|accessToken|refreshToken|password|privateKey|apiKey|secret|script)$/i.test(key)) invalid('公开配置不能保存账号凭据或音源脚本，请使用专用连接设置。');
      if (typeof entry === 'object') visit(entry);
    }
  };
  visit(value);
  if (kind === 'site') {
    if (value.musicTracks !== undefined) {
      if (!Array.isArray(value.musicTracks) || value.musicTracks.length > 100) invalid('歌单最多配置 100 首歌曲。');
      const keys = new Set<string>();
      for (const track of value.musicTracks as unknown[]) {
        if (!object(track) || !validMusicId(String(track.source),track.id) || typeof track.name !== 'string' || !track.name.trim() || track.name.length > 200 || typeof track.key !== 'string' || track.key.toUpperCase() !== `${track.source}:${track.id}`.toUpperCase()) invalid('请检查歌单中的平台、歌曲 ID、名称与唯一标识。');
        const key = String((track as Record<string,unknown>).key).toUpperCase();
        if (keys.has(key)) invalid('歌单中有重复歌曲，请先移除重复项。');
        keys.add(key);
        const lx=(track as Record<string,unknown>).lx;
        if(lx!==undefined&&(!object(lx)||JSON.stringify(lx).length>4000))invalid('曲目的公开取源信息过大或格式不正确，请重新检索添加。');
      }
    }
    if (value.musicPlayback !== undefined) {
      const policy = value.musicPlayback;
      if (!object(policy) || !['320k','lossless'].includes(String(policy.defaultQuality))) invalid('请选择有效的播放音质。');
    }
    if (value.bangumiSubjectType !== undefined && ![1,2,3,4,6].includes(Number(value.bangumiSubjectType))) invalid('书架分类不正确。');
  }
  if (kind === 'music') {
    if (value.version !== 1 || !object(value.tracks) || Object.keys(value.tracks).length > 100) invalid('歌词配置需要使用版本 1，最多维护 100 首歌曲。');
    for (const [key,track] of Object.entries(value.tracks as Record<string,unknown>)) {
      if (!validMusicId(key.split(':')[0],key.split(':')[1]) || !object(track)) invalid('歌词对应的歌曲标识不正确。');
      const entry = track as Record<string,unknown>;
      if (entry.offsetMs !== undefined && (!Number.isFinite(entry.offsetMs) || Math.abs(Number(entry.offsetMs)) > 5000)) invalid('歌词时间偏移必须在 ±5000 毫秒以内。');
      for (const variant of ['primary','translation','romanization']) {
        const lyric = entry[variant];
        if (lyric !== undefined && (!object(lyric) || !['lrc','yrc','qrc','krc'].includes(String(lyric.format)) || typeof lyric.content !== 'string' || lyric.content.length > 150000)) invalid('歌词需要有效的格式与文本，每份最多 150 KB。');
      }
    }
  }
}
