'use client';
/* eslint-disable @next/next/no-img-element -- Music covers are supplied by the selected remote source. */

import { ArrowDown, ArrowUp, Check, ChevronDown, ChevronUp, CircleAlert, Disc3, Languages, LoaderCircle, Music2, Plus, RefreshCw, Save, Search, Trash2, Waves } from 'lucide-react';
import { Fragment, FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { managerApi } from '../../lib/managerApi';
import MusicAccounts from './MusicAccounts';

type MusicSource = 'netease' | 'kugou';
type TrackReference = {
  key: string;
  source: MusicSource;
  id: string;
  name?: string;
  artist?: string;
  album?: string;
  cover?: string;
  albumId?: string;
  albumAudioId?: string;
  duration?: number;
};
type LyricAsset = { format: 'lrc' | 'yrc' | 'krc' | 'qrc'; fileName: string; bytes: number; lineCount: number; wordTimed: boolean; generatedFrom?: string };
type TrackLyricSettings = { offsetMs: number; primary?: LyricAsset | null; translation?: LyricAsset | null; romanization?: LyricAsset | null };
type MusicSettings = { musicIds: string[]; musicTracks: TrackReference[]; tracks: Record<string, TrackLyricSettings> };
type LyricStatus = { available: boolean; source: 'kugou'; format?: string; wordTimed?: boolean; candidate?: { song: string; artist: string }; reason?: string };
type PlaybackStatus = { available: boolean; playbackSource: MusicSource; reason?: string; name?: string; artist?: string; album?: string; cover?: string; albumAudioId?: string };
type Track = TrackReference & { name: string; artist: string; album: string; cover: string; durationMs?: number; playbackAvailable?: boolean; playbackSource?: MusicSource; playbackReason?: string; lyric?: LyricStatus };
type TrackResult = { track?: Track; error?: string };

const playbackReasons: Record<string, string> = {
  payment_required: '该版本需要会员或购买权益，可登录后本机试听，或选择其他版本发布',
  login_required: '该版本需要登录，可使用本机账号试听，公开歌单请选其他版本',
  trial_only: '该版本只有试听片段，不能作为完整音源发布',
  copyright_or_region: '平台未提供完整音源，可能受版权或地区限制',
};

async function mapLimited<T, R>(items: T[], task: (item: T) => Promise<R>): Promise<R[]> {
  const output: R[] = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(3, items.length) }, async () => {
    while (cursor < items.length) { const index = cursor++; output[index] = await task(items[index]); }
  }));
  return output;
}

function referenceKey(reference: Pick<TrackReference, 'source' | 'id'>) {
  return `${reference.source}:${reference.source === 'kugou' ? reference.id.toUpperCase() : reference.id}`;
}

function isUnavailable(result?: TrackResult) {
  return Boolean(result?.error || result?.track?.playbackAvailable === false);
}

function toReference(track: Track): TrackReference {
  return {
    key: referenceKey(track), source: track.source, id: track.id, name: track.name, artist: track.artist,
    album: track.album, cover: track.cover, albumId: track.albumId, albumAudioId: track.albumAudioId,
  };
}

export default function MusicManager() {
  const [references, setReferences] = useState<TrackReference[]>([]);
  const [tracks, setTracks] = useState<Record<string, TrackResult>>({});
  const [lyricSettings, setLyricSettings] = useState<Record<string, TrackLyricSettings>>({});
  const [offsetDrafts, setOffsetDrafts] = useState<Record<string, string>>({});
  const [expandedTrack, setExpandedTrack] = useState<string | null>(null);
  const [source, setSource] = useState<MusicSource>('netease');
  const [candidate, setCandidate] = useState('');
  const [candidateTracks, setCandidateTracks] = useState<TrackReference[]>([]);
  const [preview, setPreview] = useState<TrackReference | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'query' | 'save' | 'refresh' | null>(null);
  const [validatingTrack, setValidatingTrack] = useState<string | null>(null);
  const [offsetBusy, setOffsetBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<{ error?: boolean; message: string } | null>(null);

  const lyricStatus = useCallback(async (track: Track, name: string, artist: string) => {
    const params = new URLSearchParams({ name, artist });
    if (track.durationMs) params.set('durationMs', String(track.durationMs));
    if (track.source === 'kugou') {
      params.set('hash', track.id);
    }
    return managerApi<LyricStatus>(`/api/music/lyrics/status?${params.toString()}`);
  }, []);

  const queryTrack = useCallback(async (reference: TrackReference, force = false): Promise<TrackResult> => {
    try {
      let base: Track;
      if (reference.source === 'netease') {
        const result = await managerApi<{ id: string; name: string; artist: string; album: string; cover: string; durationMs: number }>(`/api/music/query/${reference.id}`);
        const params = new URLSearchParams({ name: result.name, artist: result.artist, durationMs: String(result.durationMs) });
        if (force) params.set('refresh', 'true');
        const playback = await managerApi<PlaybackStatus>(`/api/music/playback/netease/${reference.id}/status?${params.toString()}`);
        base = { ...reference, ...result, key: referenceKey(reference), source: 'netease', playbackAvailable: playback.available, playbackSource: playback.playbackSource, playbackReason: playback.reason };
      } else {
        const params = new URLSearchParams({ name: reference.name || '', artist: reference.artist || '' });
        if (force) params.set('refresh', 'true');
        const playback = await managerApi<PlaybackStatus>(`/api/music/playback/kugou/${reference.id}/status?${params.toString()}`);
        base = {
          ...reference,
          key: referenceKey(reference),
          source: 'kugou',
          name: reference.name || playback.name || '未命名歌曲',
          artist: reference.artist || playback.artist || '未知歌手',
          album: reference.album || playback.album || '',
          cover: reference.cover || playback.cover || '',
          albumAudioId: reference.albumAudioId || playback.albumAudioId || '',
          playbackAvailable: playback.available,
          playbackSource: playback.playbackSource,
          playbackReason: playback.reason,
        };
      }
      if (base.playbackAvailable === false) return { track: base };
      let lyric: LyricStatus | undefined;
      try {
        lyric = await lyricStatus(base, base.name, base.artist);
      } catch {
        lyric = { available: false, source: 'kugou', reason: 'service_unavailable' };
      }
      return { track: { ...base, lyric } };
    } catch (error) {
      return { error: error instanceof Error ? error.message : '歌曲资源查询失败' };
    }
  }, [lyricStatus]);

  const refreshTracks = useCallback(async (nextReferences: TrackReference[], mode: 'load' | 'refresh' = 'load') => {
    if (mode === 'refresh') setBusy('refresh');
    const results = await mapLimited(nextReferences, async (reference) => [referenceKey(reference), await queryTrack(reference, mode === 'refresh')] as const);
    const mapped = Object.fromEntries(results);
    setTracks((current) => ({ ...current, ...mapped }));
    if (mode === 'refresh') {
      setBusy(null);
      const failed = results.filter(([, result]) => isUnavailable(result)).length;
      setStatus(failed
        ? { error: true, message: `检查完成：${failed} 首歌曲当前不可播放，已在列表中标出。请移除或更换版本后再保存。` }
        : { message: `检查完成：${nextReferences.length} 首歌曲均有可用音源。` });
    }
    return mapped;
  }, [queryTrack]);

  useEffect(() => {
    managerApi<MusicSettings>('/api/settings/music')
      .then(async (settings) => {
        setReferences(settings.musicTracks);
        setLyricSettings(settings.tracks || {});
        setOffsetDrafts(Object.fromEntries(settings.musicTracks.map((track) => [track.key, String(settings.tracks?.[track.key]?.offsetMs ?? 0)])));
        setLoading(false);
        await refreshTracks(settings.musicTracks);
      })
      .catch((error) => setStatus({ error: true, message: error instanceof Error ? error.message : '无法加载音乐配置' }))
      .finally(() => setLoading(false));
  }, [refreshTracks]);

  const canQuery = source === 'netease' ? /^\d{1,20}$/.test(candidate.trim()) : candidate.trim().length >= 2;
  const unavailableCount = useMemo(() => references.filter((reference) => isUnavailable(tracks[referenceKey(reference)])).length, [references, tracks]);
  const checkingCount = useMemo(() => references.filter((reference) => !tracks[referenceKey(reference)]).length, [references, tracks]);

  const lookup = async (event: FormEvent) => {
    event.preventDefault();
    if (!canQuery || busy) return;
    setBusy('query');
    setStatus(null);
    setCandidateTracks([]);
    try {
      if (source === 'netease') {
        const reference = { key: `netease:${candidate.trim()}`, source: 'netease' as const, id: candidate.trim() };
        if (references.some((item) => referenceKey(item) === reference.key)) throw new Error('这首歌已经在播放列表中。');
        const result = await queryTrack(reference);
        if (!result.track) throw new Error(result.error || '没有找到这首歌');
        setCandidateTracks([result.track]);
      } else {
        const results = await managerApi<TrackReference[]>(`/api/music/search/kugou?keyword=${encodeURIComponent(candidate.trim())}`);
        setCandidateTracks(results.filter((item) => !references.some((reference) => referenceKey(reference) === referenceKey(item))));
        if (!results.length) setStatus({ error: true, message: '酷狗没有返回匹配歌曲，请换一个关键词。' });
      }
    } catch (error) {
      setStatus({ error: true, message: error instanceof Error ? error.message : '歌曲查询失败' });
    } finally {
      setBusy(null);
    }
  };

  const addTrack = async (track: TrackReference) => {
    if (references.length >= 12 || validatingTrack) return;
    const key = referenceKey(track);
    const normalized = { ...track, key };
    setValidatingTrack(key);
    setStatus({ message: `正在检查《${track.name || track.id}》的音频与歌词资源…` });
    try {
      const result = await queryTrack(normalized, true);
      if (!result.track || isUnavailable(result)) {
        setStatus({ error: true, message: `《${track.name || track.id}》未加入公开歌单：${playbackReasons[result.track?.playbackReason || ''] || result.error || '没有匿名完整音源，请选择其他版本'}。` });
        return;
      }
      const checked = toReference(result.track);
      setReferences((current) => [...current, checked]);
      setTracks((current) => ({ ...current, [key]: result }));
      setOffsetDrafts((current) => ({ ...current, [key]: '0' }));
      setCandidateTracks([]);
      setCandidate('');
      setStatus({ message: result.track.lyric?.wordTimed
        ? `《${result.track.name}》音频与 KRC 逐字歌词检查通过，已加入待保存列表。`
        : `《${result.track.name}》音频检查通过；未匹配 KRC 时会使用普通歌词。` });
    } finally {
      setValidatingTrack(null);
    }
  };

  const move = (index: number, offset: number) => {
    const target = index + offset;
    if (target < 0 || target >= references.length) return;
    setReferences((current) => {
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const remove = (key: string) => {
    setReferences((current) => current.filter((item) => referenceKey(item) !== key));
    setStatus({ message: '歌曲已从待保存列表移除。' });
  };

  const save = async () => {
    if (busy) return;
    setBusy('save');
    setStatus(null);
    try {
      const checked = await mapLimited(references, async (reference) => [referenceKey(reference), await queryTrack(reference, true)] as const);
      const checkedTracks = Object.fromEntries(checked);
      setTracks(checkedTracks);
      const failed = checked.filter(([, result]) => isUnavailable(result));
      if (failed.length) {
        setStatus({ error: true, message: `保存已取消：${failed.length} 首歌曲当前不可播放。请移除标红歌曲或选择其他版本。` });
        return;
      }
      const checkedReferences = references.map((reference) => {
        const track = checkedTracks[referenceKey(reference)]?.track;
        return track ? toReference(track) : reference;
      });
      const saved = await managerApi<MusicSettings>('/api/settings/music', { method: 'POST', body: JSON.stringify({ musicTracks: checkedReferences }) });
      setReferences(saved.musicTracks);
      setLyricSettings(saved.tracks || {});
      setStatus({ message: '酷狗 + 网易云双源歌单已保存，将在下一次同步时进入公开博客。' });
    } catch (error) {
      setStatus({ error: true, message: error instanceof Error ? error.message : '保存音乐配置失败' });
    } finally {
      setBusy(null);
    }
  };

  const saveOffset = async (trackKey: string) => {
    if (offsetBusy) return;
    const offsetMs = Number(offsetDrafts[trackKey] || 0);
    if (!Number.isInteger(offsetMs) || offsetMs < -5000 || offsetMs > 5000) {
      setStatus({ error: true, message: '歌词偏移必须是 -5000 到 5000 之间的整数毫秒。' });
      return;
    }
    setOffsetBusy(trackKey);
    setStatus(null);
    try {
      const saved = await managerApi<TrackLyricSettings>(`/api/settings/music/${encodeURIComponent(trackKey)}/offset`, { method: 'POST', body: JSON.stringify({ offsetMs }) });
      setLyricSettings((current) => ({ ...current, [trackKey]: saved }));
      setOffsetDrafts((current) => ({ ...current, [trackKey]: String(saved.offsetMs) }));
      setStatus({ message: `歌词偏移已保存为 ${formatOffset(saved.offsetMs)}。` });
    } catch (error) {
      setStatus({ error: true, message: error instanceof Error ? error.message : '歌词偏移保存失败' });
    } finally {
      setOffsetBusy(null);
    }
  };

  if (loading) return <div className="console-skeleton" />;

  return <div className="console-grid">
    <MusicAccounts preview={preview} />
    <section className="console-panel span-8">
      <header><div><h2>双源播放列表</h2><span>网易云与酷狗共用一个播放器；最多 12 首</span></div><div className="music-validation-actions"><span className={`integration-badge ${unavailableCount === 0 && checkingCount === 0 ? 'is-ready' : ''}`}><span className={`status-dot ${unavailableCount ? 'warn' : ''}`} />{checkingCount ? `${checkingCount} 首检查中` : unavailableCount ? `${unavailableCount} 首不可播放` : `${references.length} 首可播放`}</span><button className="console-action secondary" type="button" onClick={() => void refreshTracks(references, 'refresh')} disabled={Boolean(busy) || Boolean(validatingTrack) || !references.length}>{busy === 'refresh' ? <LoaderCircle className="animate-spin" size={15} /> : <RefreshCw size={15} />}检查全部</button></div></header>
      <div className="music-resource-list">
        {references.length ? references.map((reference, index) => {
          const key = referenceKey(reference);
          const result = tracks[key];
          const track = result?.track;
          const lyric = lyricSettings[key] || { offsetMs: 0 };
          const expanded = expandedTrack === key;
          const preciseLyric = lyric.primary?.wordTimed || track?.lyric?.wordTimed;
          const unavailable = isUnavailable(result);
          return <Fragment key={key}>
            <article className={unavailable ? 'is-unavailable' : undefined}>
              <span className="music-resource-index">{String(index + 1).padStart(2, '0')}</span>
              <div className="music-resource-cover">{track?.cover ? <img src={track.cover} alt="" referrerPolicy="no-referrer" /> : <Disc3 size={22} />}</div>
              <div className="music-resource-copy"><strong>{track?.name || reference.name || (result?.error ? '资源暂不可用' : '正在读取歌曲')}</strong><span>{track ? `${track.artist}${track.album ? ` · ${track.album}` : ''}` : result?.error || key}</span><small><b data-source={reference.source}>{reference.source === 'kugou' ? '酷狗' : '网易云'}</b> · {unavailable ? '音源不可播放' : !result ? '正在检查音源' : preciseLyric ? '音频可用 / KRC 逐字歌词' : '音频可用 / 普通歌词回退'} · {formatOffset(lyric.offsetMs)}</small>{unavailable && <em><CircleAlert size={13} />{playbackReasons[track?.playbackReason || ''] || '当前版本没有匿名完整音源，请更换版本'}</em>}</div>
              <div className="music-resource-actions"><button type="button" onClick={() => setPreview({ ...reference })} title="本机账号试听" aria-label={`本机试听 ${track?.name || reference.name || key}`}><Music2 size={15} /></button><button type="button" onClick={() => setExpandedTrack(expanded ? null : key)} title="歌词状态与校准" aria-label={`${track?.name || reference.name || key} 歌词设置`} aria-expanded={expanded}><Waves size={15} />{expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}</button><button type="button" onClick={() => move(index, -1)} disabled={index === 0} title="上移" aria-label={`上移 ${track?.name || key}`}><ArrowUp size={15} /></button><button type="button" onClick={() => move(index, 1)} disabled={index === references.length - 1} title="下移" aria-label={`下移 ${track?.name || key}`}><ArrowDown size={15} /></button><button type="button" onClick={() => remove(key)} title="移除" aria-label={`移除 ${track?.name || key}`}><Trash2 size={15} /></button></div>
            </article>
            {expanded && <div className="music-lyric-settings music-auto-lyric-settings">
              <div className="music-lyric-settings-heading"><div><Languages size={17} /><strong>自动逐字歌词</strong></div><span>{track?.lyric?.available ? `已匹配 ${track.lyric.candidate?.artist || ''} - ${track.lyric.candidate?.song || ''}` : '未匹配时自动回退网易云歌词'}</span></div>
              <div className="music-auto-lyric-flow"><span>匹配歌曲</span><i>→</i><span>获取歌词</span><i>→</i><strong>逐字同步</strong></div>
              <div className="music-offset-control"><label htmlFor={`offset-${key}`}>歌词偏移</label><div><input id={`offset-${key}`} type="number" min="-5000" max="5000" step="10" value={offsetDrafts[key] ?? String(lyric.offsetMs)} onChange={(event) => setOffsetDrafts((current) => ({ ...current, [key]: event.target.value }))} /><span>ms</span><button type="button" onClick={() => void saveOffset(key)} disabled={Boolean(offsetBusy)}>{offsetBusy === key ? <LoaderCircle className="animate-spin" size={15} /> : <Check size={15} />}保存</button></div></div>
              <p className="music-lyric-help"><Waves size={15} />不需要上传歌词文件。酷狗 KRC 提供真实逐字 Start/Duration；翻译和罗马音会从 KRC 的 language 数据自动提取。</p>
            </div>}
          </Fragment>;
        }) : <div className="structured-empty"><Music2 size={28} /><strong>播放列表还是空的</strong><span>从右侧选择网易云或酷狗，加入第一首歌。</span></div>}
      </div>
      <div className="music-resource-footer"><span>{unavailableCount ? '不可播放的歌曲不会被保存或发布。' : '保存时会再次检查全部音源。'}</span><button className="console-action" type="button" onClick={() => void save()} disabled={Boolean(busy) || Boolean(validatingTrack) || Boolean(unavailableCount) || Boolean(checkingCount)}>{busy === 'save' ? <LoaderCircle className="animate-spin" size={16} /> : <Save size={16} />}保存播放列表</button></div>
    </section>

    <section className="console-panel span-4 music-query-panel">
      <header><div><h2>添加音乐</h2><span>网易云 ID 或酷狗关键词</span></div></header>
      <div className="music-source-switch" role="tablist" aria-label="音乐来源"><button type="button" role="tab" aria-selected={source === 'netease'} onClick={() => { setSource('netease'); setCandidate(''); setCandidateTracks([]); }}>网易云</button><button type="button" role="tab" aria-selected={source === 'kugou'} onClick={() => { setSource('kugou'); setCandidate(''); setCandidateTracks([]); }}>酷狗</button></div>
      <form className="console-form" onSubmit={lookup}>
        <div className="form-field"><label htmlFor="musicQuery">{source === 'netease' ? '网易云歌曲 ID' : '酷狗歌曲关键词'}</label><input id="musicQuery" inputMode={source === 'netease' ? 'numeric' : 'search'} maxLength={100} value={candidate} onChange={(event) => { setCandidate(source === 'netease' ? event.target.value.replace(/\D/g, '') : event.target.value); setCandidateTracks([]); }} placeholder={source === 'netease' ? '例如：1809646618' : '歌曲名或 歌曲名 + 歌手'} /><small>{references.length}/12 首</small></div>
        <button className="console-action secondary" type="submit" disabled={!canQuery || Boolean(busy)}>{busy === 'query' ? <LoaderCircle className="animate-spin" size={16} /> : <Search size={16} />}{source === 'netease' ? '查询歌曲' : '搜索酷狗'}</button>
      </form>
      {candidateTracks.length > 0 && <div className="music-query-results">{candidateTracks.map((track) => { const key = referenceKey(track); return <div className="music-query-result" key={key}><div className="music-resource-cover">{track.cover ? <img src={track.cover} alt="" referrerPolicy="no-referrer" /> : <Disc3 size={22} />}</div><div><strong>{track.name}</strong><span>{track.artist}{track.album ? ` · ${track.album}` : ''}</span></div><button className="console-icon" type="button" onClick={() => setPreview({ ...track })} title="本机账号试听" aria-label={`本机试听 ${track.name}`}><Music2 size={17} /></button><button className="console-icon" type="button" onClick={() => void addTrack(track)} disabled={references.length >= 12 || Boolean(validatingTrack)} title="检查并加入播放列表" aria-label={`检查并加入 ${track.name}`}>{validatingTrack === key ? <LoaderCircle className="animate-spin" size={17} /> : <Plus size={17} />}</button></div>; })}</div>}
      <div className="console-note music-query-note"><Waves size={16} />酷狗歌曲直接使用 Hash；网易云歌曲会按歌名和歌手补查酷狗 KRC，失败时无感回退到网易云歌词。</div>
    </section>
    {status && <div className={`form-status span-12 ${status.error ? 'error' : ''}`} role={status.error ? 'alert' : 'status'}>{status.message}</div>}
  </div>;
}

function formatOffset(offsetMs: number) {
  if (!offsetMs) return '无偏移';
  return `${offsetMs > 0 ? '+' : ''}${offsetMs} ms`;
}
