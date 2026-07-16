'use client';
/* eslint-disable @next/next/no-img-element -- Music covers are supplied by the selected remote source. */

import { ArrowDown, ArrowUp, Check, ChevronDown, ChevronUp, Disc3, Languages, LoaderCircle, Music2, Plus, RefreshCw, Save, Search, Trash2, Waves } from 'lucide-react';
import { Fragment, FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { managerApi } from '../../lib/managerApi';

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
type Track = TrackReference & { name: string; artist: string; album: string; cover: string; durationMs?: number; playbackAvailable?: boolean; lyric?: LyricStatus };
type TrackResult = { track?: Track; error?: string };

function referenceKey(reference: Pick<TrackReference, 'source' | 'id'>) {
  return `${reference.source}:${reference.source === 'kugou' ? reference.id.toUpperCase() : reference.id}`;
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
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'query' | 'save' | 'refresh' | null>(null);
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

  const queryTrack = useCallback(async (reference: TrackReference): Promise<TrackResult> => {
    try {
      let base: Track;
      if (reference.source === 'netease') {
        const result = await managerApi<{ id: string; name: string; artist: string; album: string; cover: string; durationMs: number }>(`/api/music/query/${reference.id}`);
        base = { ...reference, ...result, key: referenceKey(reference), source: 'netease' };
      } else {
        const playback = await managerApi<{ available: boolean; name?: string; artist?: string; album?: string; cover?: string; albumAudioId?: string }>(`/api/music/kugou/${reference.id}/status`);
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
        };
      }
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
    const results = await Promise.all(nextReferences.map(async (reference) => [referenceKey(reference), await queryTrack(reference)] as const));
    setTracks(Object.fromEntries(results));
    if (mode === 'refresh') {
      setBusy(null);
      setStatus({ message: `已刷新 ${nextReferences.length} 首歌曲的双源音频与逐字歌词状态。` });
    }
  }, [queryTrack]);

  useEffect(() => {
    managerApi<MusicSettings>('/api/settings/music')
      .then(async (settings) => {
        setReferences(settings.musicTracks);
        setLyricSettings(settings.tracks || {});
        setOffsetDrafts(Object.fromEntries(settings.musicTracks.map((track) => [track.key, String(settings.tracks?.[track.key]?.offsetMs ?? 0)])));
        await refreshTracks(settings.musicTracks);
      })
      .catch((error) => setStatus({ error: true, message: error instanceof Error ? error.message : '无法加载音乐配置' }))
      .finally(() => setLoading(false));
  }, [refreshTracks]);

  const canQuery = source === 'netease' ? /^\d{1,20}$/.test(candidate.trim()) : candidate.trim().length >= 2;
  const unavailableCount = useMemo(() => references.filter((reference) => tracks[referenceKey(reference)]?.error || (reference.source === 'kugou' && tracks[referenceKey(reference)]?.track?.playbackAvailable === false)).length, [references, tracks]);

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

  const addTrack = (track: TrackReference) => {
    if (references.length >= 12) return;
    const key = referenceKey(track);
    const normalized = { ...track, key };
    setReferences((current) => [...current, normalized]);
    setTracks((current) => ({ ...current, [key]: { track: normalized as Track } }));
    setOffsetDrafts((current) => ({ ...current, [key]: '0' }));
    setCandidateTracks([]);
    setCandidate('');
    setStatus({ message: '歌曲已加入待保存列表。' });
    void queryTrack(normalized).then((result) => setTracks((current) => ({ ...current, [key]: result })));
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
      const saved = await managerApi<MusicSettings>('/api/settings/music', { method: 'POST', body: JSON.stringify({ musicTracks: references }) });
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
    <section className="console-panel span-8">
      <header><div><h2>双源播放列表</h2><span>网易云与酷狗共用一个播放器；最多 12 首</span></div><span className={`integration-badge ${unavailableCount === 0 ? 'is-ready' : ''}`}><span className={`status-dot ${unavailableCount ? 'warn' : ''}`} />{unavailableCount ? `${unavailableCount} 首待检查` : `${references.length} 首可用`}</span></header>
      <div className="music-resource-list">
        {references.length ? references.map((reference, index) => {
          const key = referenceKey(reference);
          const result = tracks[key];
          const track = result?.track;
          const lyric = lyricSettings[key] || { offsetMs: 0 };
          const expanded = expandedTrack === key;
          const preciseLyric = lyric.primary?.wordTimed || track?.lyric?.wordTimed;
          return <Fragment key={key}>
            <article>
              <span className="music-resource-index">{String(index + 1).padStart(2, '0')}</span>
              <div className="music-resource-cover">{track?.cover ? <img src={track.cover} alt="" referrerPolicy="no-referrer" /> : <Disc3 size={22} />}</div>
              <div className="music-resource-copy"><strong>{track?.name || reference.name || (result?.error ? '资源暂不可用' : '正在读取歌曲')}</strong><span>{track ? `${track.artist}${track.album ? ` · ${track.album}` : ''}` : result?.error || key}</span><small><b data-source={reference.source}>{reference.source === 'kugou' ? '酷狗' : '网易云'}</b> · {preciseLyric ? 'KRC 逐字歌词' : '普通歌词回退'} · {formatOffset(lyric.offsetMs)}</small></div>
              <div className="music-resource-actions"><button type="button" onClick={() => setExpandedTrack(expanded ? null : key)} title="歌词状态与校准" aria-label={`${track?.name || reference.name || key} 歌词设置`} aria-expanded={expanded}><Waves size={15} />{expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}</button><button type="button" onClick={() => move(index, -1)} disabled={index === 0} title="上移" aria-label={`上移 ${track?.name || key}`}><ArrowUp size={15} /></button><button type="button" onClick={() => move(index, 1)} disabled={index === references.length - 1} title="下移" aria-label={`下移 ${track?.name || key}`}><ArrowDown size={15} /></button><button type="button" onClick={() => remove(key)} title="移除" aria-label={`移除 ${track?.name || key}`}><Trash2 size={15} /></button></div>
            </article>
            {expanded && <div className="music-lyric-settings music-auto-lyric-settings">
              <div className="music-lyric-settings-heading"><div><Languages size={17} /><strong>自动逐字歌词</strong></div><span>{track?.lyric?.available ? `已匹配 ${track.lyric.candidate?.artist || ''} - ${track.lyric.candidate?.song || ''}` : '未匹配时自动回退网易云歌词'}</span></div>
              <div className="music-auto-lyric-flow"><span>SearchLyricAsync</span><i>→</i><span>candidates</span><i>→</i><span>GetLyricAsync</span><i>→</i><span>DecodeLyrics</span><i>→</i><strong>KrcParser</strong></div>
              <div className="music-offset-control"><label htmlFor={`offset-${key}`}>歌词偏移</label><div><input id={`offset-${key}`} type="number" min="-5000" max="5000" step="10" value={offsetDrafts[key] ?? String(lyric.offsetMs)} onChange={(event) => setOffsetDrafts((current) => ({ ...current, [key]: event.target.value }))} /><span>ms</span><button type="button" onClick={() => void saveOffset(key)} disabled={Boolean(offsetBusy)}>{offsetBusy === key ? <LoaderCircle className="animate-spin" size={15} /> : <Check size={15} />}保存</button></div></div>
              <p className="music-lyric-help"><Waves size={15} />不需要上传歌词文件。酷狗 KRC 提供真实逐字 Start/Duration；翻译和罗马音会从 KRC 的 language 数据自动提取。</p>
            </div>}
          </Fragment>;
        }) : <div className="structured-empty"><Music2 size={28} /><strong>播放列表还是空的</strong><span>从右侧选择网易云或酷狗，加入第一首歌。</span></div>}
      </div>
      <div className="music-resource-footer"><button className="console-action secondary" type="button" onClick={() => void refreshTracks(references, 'refresh')} disabled={Boolean(busy) || !references.length}>{busy === 'refresh' ? <LoaderCircle className="animate-spin" size={16} /> : <RefreshCw size={16} />}刷新双源状态</button><button className="console-action" type="button" onClick={() => void save()} disabled={Boolean(busy)}>{busy === 'save' ? <LoaderCircle className="animate-spin" size={16} /> : <Save size={16} />}保存播放列表</button></div>
    </section>

    <section className="console-panel span-4 music-query-panel">
      <header><div><h2>添加音乐</h2><span>网易云 ID 或酷狗关键词</span></div></header>
      <div className="music-source-switch" role="tablist" aria-label="音乐来源"><button type="button" role="tab" aria-selected={source === 'netease'} onClick={() => { setSource('netease'); setCandidate(''); setCandidateTracks([]); }}>网易云</button><button type="button" role="tab" aria-selected={source === 'kugou'} onClick={() => { setSource('kugou'); setCandidate(''); setCandidateTracks([]); }}>酷狗</button></div>
      <form className="console-form" onSubmit={lookup}>
        <div className="form-field"><label htmlFor="musicQuery">{source === 'netease' ? '网易云歌曲 ID' : '酷狗歌曲关键词'}</label><input id="musicQuery" inputMode={source === 'netease' ? 'numeric' : 'search'} maxLength={100} value={candidate} onChange={(event) => { setCandidate(source === 'netease' ? event.target.value.replace(/\D/g, '') : event.target.value); setCandidateTracks([]); }} placeholder={source === 'netease' ? '例如：1809646618' : '歌曲名或 歌曲名 + 歌手'} /><small>{references.length}/12 首</small></div>
        <button className="console-action secondary" type="submit" disabled={!canQuery || Boolean(busy)}>{busy === 'query' ? <LoaderCircle className="animate-spin" size={16} /> : <Search size={16} />}{source === 'netease' ? '查询歌曲' : '搜索酷狗'}</button>
      </form>
      {candidateTracks.length > 0 && <div className="music-query-results">{candidateTracks.map((track) => <div className="music-query-result" key={referenceKey(track)}><div className="music-resource-cover">{track.cover ? <img src={track.cover} alt="" referrerPolicy="no-referrer" /> : <Disc3 size={22} />}</div><div><strong>{track.name}</strong><span>{track.artist}{track.album ? ` · ${track.album}` : ''}</span></div><button className="console-icon" type="button" onClick={() => addTrack(track)} disabled={references.length >= 12} title="加入播放列表" aria-label={`加入 ${track.name}`}><Plus size={17} /></button></div>)}</div>}
      <div className="console-note music-query-note"><Waves size={16} />酷狗歌曲直接使用 Hash；网易云歌曲会按歌名和歌手补查酷狗 KRC，失败时无感回退到网易云歌词。</div>
    </section>
    {status && <div className={`form-status span-12 ${status.error ? 'error' : ''}`} role={status.error ? 'alert' : 'status'}>{status.message}</div>}
  </div>;
}

function formatOffset(offsetMs: number) {
  if (!offsetMs) return '无偏移';
  return `${offsetMs > 0 ? '+' : ''}${offsetMs} ms`;
}
