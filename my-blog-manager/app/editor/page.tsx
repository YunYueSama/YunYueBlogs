"use client";

import React, { useCallback, useState, useRef, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import RichTextEditor, { RichTextEditorHandle } from '../../components/editor/RichTextEditor';
import MetaMatrix from '../../components/editor/MetaMatrix';
import FloatingImageTool from '../../components/editor/FloatingImageTool';
import { ArrowLeft, Save, LogOut } from 'lucide-react';
import { useToast } from '../../components/ToastProvider';
import { useOperations } from '../../context/OperationContext';
import { ConsoleDialog } from '../../components/manager/ConsoleDialog';
import { useNavigationGuard } from '../../context/NavigationGuardContext';
import { DraftSaveCoordinator } from '../../lib/draftSave';
import { managerApi } from '../../lib/managerApi';

type DocumentType = 'post' | 'chatter' | 'about';
type DraftValues = { type: DocumentType; title: string; tags: string[]; cover: string; mood: string; description: string; content: string; date: string; published: boolean };

function EditorContent({ requestedId, requestedType }: { requestedId: string; requestedType: DocumentType }) {
  const router = useRouter();
  const { showToast } = useToast();
  const { addOperation } = useOperations();
  const { register, navigate } = useNavigationGuard();
  const [docType, setDocType] = useState<DocumentType>(requestedType);
  const [currentDocId, setCurrentDocId] = useState(requestedId);
  const [title, setTitle] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [cover, setCover] = useState('');
  const [summary, setSummary] = useState('');
  const [mood, setMood] = useState('');
  const [content, setContent] = useState('');
  const [date, setDate] = useState('');
  const [historyPostTags, setHistoryPostTags] = useState<string[]>([]);
  const [historyChatterTags, setHistoryChatterTags] = useState<string[]>([]);
  const [isLoadingTags, setIsLoadingTags] = useState(true);
  const [loadingDocument, setLoadingDocument] = useState(requestedId !== 'new');
  const [loadError, setLoadError] = useState('');
  const historyMoods = ['开心', '疲惫', '平静', '激动', 'Emo'];
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const saveHandler = useRef<(silent: boolean) => Promise<void>>(async () => undefined);
  const [isImgToolOpen, setIsImgToolOpen] = useState(false);
  const [imgToolTarget, setImgToolTarget] = useState<'editor' | 'cover'>('editor');
  const editorRef = useRef<RichTextEditorHandle>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [exitModalOpen, setExitModalOpen] = useState(false);
  const allowExit = useRef(false);
  const pendingNavigation = useRef<(() => void) | null>(null);
  const saver = useRef<DraftSaveCoordinator<DraftValues> | null>(null);
  if (!saver.current) saver.current = new DraftSaveCoordinator(requestedId === 'new' ? null : requestedId,
    (payload) => managerApi('/api/drafts/save', { method: 'POST', body: JSON.stringify(payload) }));
  const values = useRef({ docType, title, tags, cover, summary, mood, date });
  values.current = { docType, title, tags, cover, summary, mood, date };
  const markChanged = useCallback(() => {
    saver.current!.markChanged();
    setHasUnsavedChanges(true);
    clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => { void saveHandler.current(true); }, 4_000);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    managerApi<{ postTags: string[]; chatterTags: string[] }>('/api/drafts/all_tags', { signal: controller.signal })
      .then((data) => { setHistoryPostTags(data.postTags || []); setHistoryChatterTags(data.chatterTags || []); })
      .catch(() => undefined).finally(() => { if (!controller.signal.aborted) setIsLoadingTags(false); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (requestedId === 'new') return;
    const controller = new AbortController();
    managerApi<{ draft: Partial<DraftValues> }>('/api/drafts/get', {
      method: 'POST', body: JSON.stringify({ id: requestedId, type: requestedType }), signal: controller.signal,
    }).then(({ draft }) => {
      if (controller.signal.aborted) return;
      setDocType(draft.type || requestedType);
      setTitle((draft.type || requestedType) === 'about' ? '关于我' : draft.title || '');
      setTags(draft.tags || []); setCover(draft.cover || ''); setSummary(draft.description || '');
      setMood(draft.mood || ''); setDate(draft.date || ''); setContent(draft.content || '');
      setLoadingDocument(false);
    }).catch((error) => { if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : '读取失败'); });
    return () => controller.abort();
    // 只在打开另一篇文档时读取。首次保存获得 ID 不得重新读取旧快照。
  }, [requestedId, requestedType]);

  useEffect(() => {
    if (hasUnsavedChanges || isSaving) register((proceed) => { pendingNavigation.current = proceed; setExitModalOpen(true); });
    else register(null);
    return () => register(null);
  }, [hasUnsavedChanges, isSaving, register]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!allowExit.current && (saver.current!.dirty || isSaving)) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [isSaving]);

  const finishNavigation = () => {
    allowExit.current = true;
    register(null);
    setExitModalOpen(false);
    const proceed = pendingNavigation.current;
    pendingNavigation.current = null;
    proceed?.();
  };
  const handleBackClick = () => navigate(() => router.push('/content'));
  const readValues = useCallback((): DraftValues => {
    const latest = values.current;
    return { type: latest.docType, title: latest.title, tags: latest.tags, cover: latest.cover, mood: latest.mood,
      description: latest.summary, content: editorRef.current?.getContent() || '',
      date: latest.date || new Date().toISOString().split('T')[0], published: false };
  }, []);

  const saveDraft = useCallback(async (silent: boolean, leave = false) => {
    if (!values.current.title.trim() && values.current.docType !== 'about') {
      if (!silent) showToast('请填写标题', 'warning');
      return;
    }
    setIsSaving(true);
    try {
      const result = await saver.current!.save(readValues);
      setCurrentDocId(result.id);
      setLastSaved(new Date(result.lastModified).toLocaleTimeString());
      setHasUnsavedChanges(saver.current!.dirty);
      if (!silent) showToast(saver.current!.dirty ? '已保存上一版本，正在等待保存新修改' : '草稿已保存', 'success');
      if (leave && !saver.current!.dirty) {
        register(null); setExitModalOpen(false);
        const proceed = pendingNavigation.current; pendingNavigation.current = null; proceed?.();
      }
    } catch (error) { showToast(error instanceof Error ? error.message : '保存失败', 'error'); }
    finally { setIsSaving(false); }
  }, [readValues, register, showToast]);

  useEffect(() => { saveHandler.current = saveDraft; }, [saveDraft]);

  const handleSave = (isPublish: boolean) => {
    if (!values.current.title.trim() && docType !== 'about') { showToast('请填写标题', 'warning'); return; }
    if (!isPublish) { void saveDraft(false); return; }
    try {
      addOperation({ id: `publish_${Date.now()}`, type: 'content_upsert', label: `发布: ${title || '无标题'}`,
        payload: { ...readValues(), id: saver.current!.id, published: true } });
      // 加入队列不等于草稿已经落盘，仍保留离开保护与自动保存。
      showToast('已加入待处理队列', 'info');
    } catch (error) { showToast(error instanceof Error ? error.message : '加入队列失败', 'error'); }
  };

  useEffect(() => {
    if (!hasUnsavedChanges || loadingDocument || isSaving || (!title.trim() && docType !== 'about')) return;
    clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => { void saveDraft(true); }, 4_000);
    return () => clearTimeout(autosaveTimer.current);
  }, [docType, hasUnsavedChanges, loadingDocument, isSaving, saveDraft, title]);

  useEffect(() => () => clearTimeout(autosaveTimer.current), []);

  if (loadError) return <div className="form-status error" role="alert">{loadError}<button className="console-action secondary" onClick={() => window.location.reload()}>重新读取</button></div>;
  if (loadingDocument) return <div className="console-skeleton" role="status" aria-label="正在读取文档" />;

  return (
    <div className="editor-page">

      <ConsoleDialog open={exitModalOpen} eyebrow="草稿保护" title="还有未保存的修改" busy={isSaving} onClose={() => setExitModalOpen(false)} footer={<>
        <button className="console-action secondary" onClick={() => setExitModalOpen(false)}>继续编辑</button>
        <button className="console-action secondary" disabled={isSaving} onClick={finishNavigation}><LogOut size={16} />放弃并离开</button>
        <button className="console-action" disabled={isSaving} onClick={() => void saveDraft(false, true)}><Save size={16} />保存并离开</button>
      </>}><p>保存草稿后再离开，可保留正文和属性设置。</p></ConsoleDialog>

      <div className="editor-page-toolbar"><button className="console-action secondary" type="button" onClick={handleBackClick}><ArrowLeft size={16} />返回内容库</button><span>{docType === 'about' ? '关于页' : docType === 'chatter' ? '杂谈' : '文章'} · {currentDocId === 'new' ? '新建' : currentDocId}</span></div>
      <main className="editor-workspace">
          <section className="editor-document">
            <RichTextEditor
              ref={editorRef}
              title={title}
              setTitle={(val) => { setTitle(val); markChanged(); }}
              initialContent={content}
              isTitleLocked={docType === 'about'}
              onOpenImageTool={() => { setImgToolTarget('editor'); setIsImgToolOpen(true); }}
              onChange={markChanged}
            />
          </section>

          <aside className="editor-meta">
            <MetaMatrix
              type={docType} tags={tags} setTags={(next) => { setTags(next); markChanged(); }} cover={cover} setCover={(value) => { setCover(value); markChanged(); }} summary={summary} setSummary={(value) => { setSummary(value); markChanged(); }} mood={mood} setMood={(value) => { setMood(value); markChanged(); }}
              allHistoryPostTags={historyPostTags} allHistoryChatterTags={historyChatterTags} isLoadingTags={isLoadingTags}
              allHistoryMoods={historyMoods} onSave={handleSave} isSaving={isSaving} lastSaved={lastSaved} onOpenImageTool={() => { setImgToolTarget('cover'); setIsImgToolOpen(true); }}
            />
          </aside>
      </main>
      <FloatingImageTool isOpen={isImgToolOpen} onClose={() => setIsImgToolOpen(false)} onInsert={(url) => {
        if (imgToolTarget === 'editor') { editorRef.current?.insertImage(url); if (!cover) setCover(url); }
        else { setCover(url); setIsImgToolOpen(false); }
        markChanged();
      }} />
    </div>
  );
}

function DocumentRoute() {
  const params = useSearchParams();
  const requestedType: DocumentType = params.get('type') === 'about' ? 'about' : params.get('type') === 'chatter' ? 'chatter' : 'post';
  const requestedId = requestedType === 'about' ? 'about' : params.get('id') || 'new';
  return <EditorContent key={`${requestedType}:${requestedId}`} requestedId={requestedId} requestedType={requestedType} />;
}

export default function EditorPage() {
  return (
    <Suspense fallback={
      <div className="console-skeleton">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin"></div>
          <p className="text-slate-500 font-bold tracking-widest text-sm uppercase">加载编辑器内核中...</p>
        </div>
      </div>
    }>
      <DocumentRoute />
    </Suspense>
  );
}
