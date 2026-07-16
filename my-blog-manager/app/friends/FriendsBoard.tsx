'use client';
/* eslint-disable @next/next/no-img-element -- Friend avatars use runtime-configured media hosts. */

import { ExternalLink, Link2, Pencil, Plus, Search, Trash2, UserRound } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ConfirmDialog, ConsoleDialog } from '../../components/manager/ConsoleDialog';
import MediaPicker from '../../components/manager/MediaPicker';
import PageHeader from '../../components/manager/PageHeader';
import { useToast } from '../../components/ToastProvider';
import { useOperations } from '../../context/OperationContext';
import type { FriendRecord as Friend } from '../../lib/operationTypes';

const emptyFriend = (): Friend => ({ id: '', name: '', url: '', description: '', avatar: '', themeColor: '#147f81' });

export default function FriendsBoard({ initialFriends }: { initialFriends: Friend[] }) {
  const { addOperation } = useOperations();
  const { showToast } = useToast();
  const [friends, setFriends] = useState(initialFriends);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Friend | null>(null);
  const [deleting, setDeleting] = useState<Friend | null>(null);
  const [mediaOpen, setMediaOpen] = useState(false);
  const [formError, setFormError] = useState('');

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return friends;
    return friends.filter((friend) => [friend.name, friend.url, friend.description].some((value) => value.toLowerCase().includes(keyword)));
  }, [friends, query]);

  const stage = (next: Friend[], label: string) => {
    setFriends(next);
    addOperation({ id: `friends_${Date.now()}`, type: 'friends_update', label, description: `${next.length} 条友链将写入本地工作区`, payload: { friends: next } });
    showToast('友链变更已加入操作队列', 'info');
  };

  const save = () => {
    if (!editing) return;
    const name = editing.name.trim();
    const url = editing.url.trim();
    if (!name || !url) { setFormError('站点名称和地址不能为空。'); return; }
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
    } catch { setFormError('站点地址必须是有效的 HTTP 或 HTTPS URL。'); return; }
    if (!/^#[0-9A-Fa-f]{6}$/.test(editing.themeColor)) { setFormError('主题色必须是六位十六进制颜色。'); return; }
    const record = { ...editing, id: editing.id || `friend_${Date.now()}`, name, url };
    const exists = friends.some((friend) => friend.id === record.id);
    stage(exists ? friends.map((friend) => friend.id === record.id ? record : friend) : [record, ...friends], `${exists ? '更新' : '新增'}友链：${record.name}`);
    setEditing(null);
  };

  const remove = () => {
    if (!deleting) return;
    stage(friends.filter((friend) => friend.id !== deleting.id), `移除友链：${deleting.name}`);
    setDeleting(null);
  };

  return <>
    <PageHeader eyebrow="Public link directory" title="友链" description="维护站点名称、头像、简介与主题色；访客申请与评论留在公开博客。" actions={<button className="console-action" type="button" onClick={() => { setFormError(''); setEditing(emptyFriend()); }}><Plus size={16} />新增友链</button>} />
    <section className="console-panel">
      <header><div><h2>站点列表</h2><span>{friends.length} 个站点</span></div></header>
      <div className="structured-toolbar"><label className="media-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索站点名称、地址或简介" /></label><span className="integration-badge"><span className="status-dot" />队列保存</span></div>
      {filtered.length ? <div className="record-grid">{filtered.map((friend) => <article className="record-card friend-record" key={friend.id} style={{ borderTopColor: friend.themeColor }}>
        <header><span>{friend.avatar ? <img src={friend.avatar} alt="" /> : <UserRound size={17} />}{friend.name}</span><div><button className="console-icon" type="button" onClick={() => { setFormError(''); setEditing({ ...friend }); }} aria-label={`编辑${friend.name}`}><Pencil size={15} /></button><button className="console-icon danger" type="button" onClick={() => setDeleting(friend)} aria-label={`删除${friend.name}`}><Trash2 size={15} /></button></div></header>
        <div><h3>{friend.name}</h3><p>{friend.description || '暂无站点简介'}</p></div>
        <div className="friend-url"><Link2 size={14} /><span>{friend.url}</span></div>
        <footer><a href={friend.url} target="_blank" rel="noreferrer"><ExternalLink size={14} />访问站点</a><small>{friend.id}</small></footer>
      </article>)}</div> : <div className="structured-empty"><Link2 size={28} /><strong>{query ? '没有匹配的站点' : '还没有友链'}</strong><span>{query ? '换一个关键词试试。' : '新增友链后，变更会先进入操作队列。'}</span></div>}
    </section>

    <ConsoleDialog open={Boolean(editing)} eyebrow="FRIEND RECORD" title={editing?.id ? '编辑友链' : '新增友链'} onClose={() => setEditing(null)} wide footer={<><button className="console-action secondary" type="button" onClick={() => setEditing(null)}>取消</button><button className="console-action" type="button" onClick={save}>加入队列</button></>}>
      {editing && <div className="console-form"><div className="form-grid"><label className="form-field"><span>站点名称</span><input value={editing.name} maxLength={100} onChange={(event) => setEditing({ ...editing, name: event.target.value })} /></label><label className="form-field"><span>主题色</span><div className="color-field"><input type="color" value={editing.themeColor} onChange={(event) => setEditing({ ...editing, themeColor: event.target.value })} /><input value={editing.themeColor} maxLength={7} onChange={(event) => setEditing({ ...editing, themeColor: event.target.value })} /></div></label><label className="form-field full"><span>站点地址</span><input type="url" value={editing.url} onChange={(event) => setEditing({ ...editing, url: event.target.value })} placeholder="https://example.com" /></label><div className="form-field full"><span>头像</span><div className="media-field-control"><div className="media-field-preview">{editing.avatar ? <img src={editing.avatar} alt="" /> : <UserRound size={20} />}</div><input value={editing.avatar} onChange={(event) => setEditing({ ...editing, avatar: event.target.value })} placeholder="HTTPS 图片地址" /><button className="console-action secondary" type="button" onClick={() => setMediaOpen(true)}>媒体库</button></div></div><label className="form-field full"><span>站点简介</span><textarea value={editing.description} maxLength={500} onChange={(event) => setEditing({ ...editing, description: event.target.value })} /></label></div>{formError && <div className="form-status error" role="alert">{formError}</div>}</div>}
    </ConsoleDialog>
    <MediaPicker open={mediaOpen} onClose={() => setMediaOpen(false)} onSelect={(avatar) => setEditing((current) => current ? { ...current, avatar } : current)} currentUrl={editing?.avatar} />
    <ConfirmDialog open={Boolean(deleting)} title="移除友链" description={`“${deleting?.name || ''}”将从公开友链数据中移除。操作应用前仍可在队列中清空。`} onClose={() => setDeleting(null)} onConfirm={remove} />
  </>;
}
