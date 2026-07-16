'use client';

import { ExternalLink, FolderGit2, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ConfirmDialog, ConsoleDialog } from '../../components/manager/ConsoleDialog';
import PageHeader from '../../components/manager/PageHeader';
import { useToast } from '../../components/ToastProvider';
import { useOperations } from '../../context/OperationContext';
import type { ProjectRecord as Project } from '../../lib/operationTypes';

const emptyProject = (): Project => ({ id: '', name: '', description: '', icon: 'Code', githubUrl: '', tags: [] });

export default function ProjectsBoard({ initialProjects }: { initialProjects: Project[] }) {
  const { addOperation } = useOperations();
  const { showToast } = useToast();
  const [projects, setProjects] = useState(initialProjects);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Project | null>(null);
  const [deleting, setDeleting] = useState<Project | null>(null);
  const [formError, setFormError] = useState('');

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return projects;
    return projects.filter((project) => [project.name, project.description, project.githubUrl, ...project.tags].some((value) => value.toLowerCase().includes(keyword)));
  }, [projects, query]);

  const stage = (next: Project[], label: string) => {
    setProjects(next);
    addOperation({ id: `projects_${Date.now()}`, type: 'projects_update', label, description: `${next.length} 个项目将写入本地工作区`, payload: { projects: next } });
    showToast('项目变更已加入操作队列', 'info');
  };

  const save = () => {
    if (!editing) return;
    const name = editing.name.trim();
    const githubUrl = editing.githubUrl.trim();
    if (!name || !githubUrl) { setFormError('项目名称和仓库地址不能为空。'); return; }
    try {
      const parsed = new URL(githubUrl);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
    } catch { setFormError('仓库地址必须是有效的 HTTP 或 HTTPS URL。'); return; }
    const record = { ...editing, id: editing.id || `project_${Date.now()}`, name, githubUrl, tags: editing.tags.filter(Boolean).slice(0, 30) };
    const exists = projects.some((project) => project.id === record.id);
    stage(exists ? projects.map((project) => project.id === record.id ? record : project) : [record, ...projects], `${exists ? '更新' : '新增'}项目：${record.name}`);
    setEditing(null);
  };

  const remove = () => {
    if (!deleting) return;
    stage(projects.filter((project) => project.id !== deleting.id), `移除项目：${deleting.name}`);
    setDeleting(null);
  };

  return <>
    <PageHeader eyebrow="Structured project data" title="项目档案" description="管理公开项目的介绍、技术栈与仓库地址；保存后先进入本地操作队列。" actions={<button className="console-action" type="button" onClick={() => { setFormError(''); setEditing(emptyProject()); }}><Plus size={16} />新增项目</button>} />
    <section className="console-panel">
      <header><div><h2>项目列表</h2><span>{projects.length} 个公开项目</span></div></header>
      <div className="structured-toolbar"><label className="media-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索项目、技术栈或仓库" /></label><span className="integration-badge"><span className="status-dot" />队列保存</span></div>
      {filtered.length ? <div className="record-grid">{filtered.map((project) => <article className="record-card" key={project.id}>
        <header><span><FolderGit2 size={17} />{project.icon || 'Code'}</span><div><button className="console-icon" type="button" onClick={() => { setFormError(''); setEditing({ ...project, tags: [...project.tags] }); }} aria-label={`编辑${project.name}`}><Pencil size={15} /></button><button className="console-icon danger" type="button" onClick={() => setDeleting(project)} aria-label={`删除${project.name}`}><Trash2 size={15} /></button></div></header>
        <div><h3>{project.name}</h3><p>{project.description || '暂无项目描述'}</p></div>
        <div className="record-tags">{project.tags.slice(0, 8).map((tag) => <span key={tag}>{tag}</span>)}</div>
        <footer><a href={project.githubUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} />查看仓库</a><small>{project.id}</small></footer>
      </article>)}</div> : <div className="structured-empty"><FolderGit2 size={28} /><strong>{query ? '没有匹配的项目' : '还没有项目档案'}</strong><span>{query ? '换一个关键词试试。' : '新增项目后，变更会先进入操作队列。'}</span></div>}
    </section>

    <ConsoleDialog open={Boolean(editing)} eyebrow="PROJECT RECORD" title={editing?.id ? '编辑项目' : '新增项目'} onClose={() => setEditing(null)} wide footer={<><button className="console-action secondary" type="button" onClick={() => setEditing(null)}>取消</button><button className="console-action" type="button" onClick={save}>加入队列</button></>}>
      {editing && <div className="console-form"><div className="form-grid"><label className="form-field"><span>项目名称</span><input value={editing.name} maxLength={120} onChange={(event) => setEditing({ ...editing, name: event.target.value })} /></label><label className="form-field"><span>图标代号</span><input value={editing.icon} maxLength={100} onChange={(event) => setEditing({ ...editing, icon: event.target.value })} placeholder="Code / Rocket" /></label><label className="form-field full"><span>仓库地址</span><input type="url" value={editing.githubUrl} onChange={(event) => setEditing({ ...editing, githubUrl: event.target.value })} placeholder="https://github.com/..." /></label><label className="form-field full"><span>项目描述</span><textarea value={editing.description} maxLength={1000} onChange={(event) => setEditing({ ...editing, description: event.target.value })} /></label><label className="form-field full"><span>技术栈</span><input value={editing.tags.join(', ')} onChange={(event) => setEditing({ ...editing, tags: event.target.value.split(',').map((tag) => tag.trim()) })} placeholder="Astro, React, FastAPI" /><small>使用英文逗号分隔，最多 30 项。</small></label></div>{formError && <div className="form-status error" role="alert">{formError}</div>}</div>}
    </ConsoleDialog>
    <ConfirmDialog open={Boolean(deleting)} title="移除项目档案" description={`“${deleting?.name || ''}”将从公开项目数据中移除。操作应用前仍可在队列中清空。`} onClose={() => setDeleting(null)} onConfirm={remove} />
  </>;
}
