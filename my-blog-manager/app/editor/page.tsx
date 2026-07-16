"use client";

import React, { useCallback, useState, useRef, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import RichTextEditor, { RichTextEditorHandle } from '../../components/editor/RichTextEditor';
import MetaMatrix from '../../components/editor/MetaMatrix';
import FloatingImageTool from '../../components/editor/FloatingImageTool';
import { ArrowLeft, AlertTriangle, Save, LogOut } from 'lucide-react';
import { useToast } from '../../components/ToastProvider';
import { useOperations } from '../../context/OperationContext';
import { motion, AnimatePresence } from 'framer-motion';
import { managerApi } from '../../lib/managerApi';

// 🌟 核心修改 1：把原本暴露的主函数改名为 EditorContent（不带 export default）
function EditorContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { showToast } = useToast();
  const { addOperation } = useOperations();

  const [docType, setDocType] = useState<'post' | 'chatter' | 'about'>((searchParams.get('type') as 'post' | 'chatter' | 'about') || 'post');
  const [currentDocId, setCurrentDocId] = useState(
    searchParams.get('type') === 'about' ? 'about' : (searchParams.get('id') || 'new')
  );

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
  const historyMoods = ['开心', '疲惫', '平静', '激动', 'Emo'];

  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [changeRevision, setChangeRevision] = useState(0);
  const [isImgToolOpen, setIsImgToolOpen] = useState(false);
  const [imgToolTarget, setImgToolTarget] = useState<'editor' | 'cover'>('editor');

  const editorRef = useRef<RichTextEditorHandle>(null);
  const savingRef = useRef(false);

  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [exitModalOpen, setExitModalOpen] = useState(false);

  useEffect(() => {
    const fetchTags = async () => {
      setIsLoadingTags(true);
      try {
        const data = await managerApi<{ postTags: string[]; chatterTags: string[] }>('/api/drafts/all_tags');
        setHistoryPostTags(data.postTags || []);
        setHistoryChatterTags(data.chatterTags || []);
      } catch (e) { console.error(e); }
      finally { setIsLoadingTags(false); }
    };
    fetchTags();
  }, []);

  useEffect(() => {
    if (currentDocId !== 'new') {
      const loadDraft = async () => {
        try {
          const data = await managerApi<{ draft: {
            type?: 'post' | 'chatter' | 'about'; date?: string; title?: string; tags?: string[];
            cover?: string; description?: string; mood?: string; content?: string;
          } }>('/api/drafts/get', {
            method: 'POST',
            body: JSON.stringify({ id: currentDocId, type: docType })
          });
          if (data.draft.type) setDocType(data.draft.type);
          setDate(data.draft.date || '');
          setTitle(data.draft.type === 'about' ? '关于我' : (data.draft.title || ''));
          setTags(data.draft.tags || []);
          setCover(data.draft.cover || '');
          setSummary(data.draft.description || '');
          setMood(data.draft.mood || '');
          setContent(data.draft.content || '');

          setTimeout(() => setHasUnsavedChanges(false), 500);
          showToast("已读取本地源数据", "success");
        } catch (error) { showToast(error instanceof Error ? error.message : "读取失败", "error"); }
      };
      loadDraft();
    }
  }, [currentDocId, docType, showToast]);

  useEffect(() => {
    if (!isLoadingTags) {
      setHasUnsavedChanges(true);
      setChangeRevision((revision) => revision + 1);
    }
  }, [title, tags, cover, summary, mood, date, isLoadingTags]);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

  const handleBackClick = () => {
    if (hasUnsavedChanges) {
      setExitModalOpen(true);
    } else {
      router.back();
    }
  };

  const saveDraft = useCallback(async (silent: boolean, shouldExitAfterSave: boolean = false) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setIsSaving(true);
    const payload = {
      id: docType === 'about' ? 'about' : (currentDocId === 'new' ? null : currentDocId),
      type: docType, title, tags, cover, mood, description: summary,
      content: editorRef.current?.getContent() || '',
      date: date || new Date().toISOString().split('T')[0],
      published: false,
    };
    try {
      const result = await managerApi<{ id: string; lastModified: number }>('/api/drafts/save', {
        method: 'POST', body: JSON.stringify(payload)
      });
      if (currentDocId === 'new') setCurrentDocId(result.id);
      setLastSaved(new Date(result.lastModified).toLocaleTimeString());
      setHasUnsavedChanges(false);
      if (!silent) showToast("草稿已落盘", "success");
      if (shouldExitAfterSave) {
        setExitModalOpen(false);
        router.back();
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : "保存失败", "error");
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }
  }, [cover, currentDocId, date, docType, mood, router, showToast, summary, tags, title]);

  const handleSave = (isPublish: boolean, shouldExitAfterSave: boolean = false) => {
    if (!title.trim() && docType !== 'about') {
      showToast("⚠️ 请填写标题", "warning"); return;
    }
    const payload = {
      id: docType === 'about' ? 'about' : (currentDocId === 'new' ? null : currentDocId),
      type: docType, title, tags, cover, mood, description: summary,
      content: editorRef.current?.getContent() || '',
      date: date || new Date().toISOString().split('T')[0],
      published: isPublish
    };

    if (isPublish) {
      addOperation({
        id: `publish_${Date.now()}`,
        type: "content_upsert",
        label: `发布: ${title || '无标题'}`,
        payload
      });
      setHasUnsavedChanges(false);
      showToast("🚀 已加入待处理队列！", "info");
      if (shouldExitAfterSave) router.back();
      return;
    }
    void saveDraft(false, shouldExitAfterSave);
  };

  useEffect(() => {
    if (!hasUnsavedChanges || isLoadingTags || (!title.trim() && docType !== 'about')) return;
    const timer = window.setTimeout(() => { void saveDraft(true); }, 4_000);
    return () => window.clearTimeout(timer);
  }, [changeRevision, docType, hasUnsavedChanges, isLoadingTags, saveDraft, title]);

  return (
    <div className="editor-page">

      <AnimatePresence>
        {exitModalOpen && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setExitModalOpen(false)} className="absolute inset-0 bg-slate-900/40 backdrop-blur-md" />
            <motion.div initial={{ scale: 0.9, opacity: 0, y: 20 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.9, opacity: 0, y: 20 }} className="relative w-full max-w-sm bg-white/80 dark:bg-slate-900/80 backdrop-blur-2xl rounded-[40px] shadow-2xl border border-white/50 dark:border-white/10 p-10 text-center overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-transparent via-yellow-500 to-transparent opacity-50" />
              <div className="w-20 h-20 bg-yellow-500/10 rounded-3xl flex items-center justify-center mx-auto mb-6"><AlertTriangle className="w-10 h-10 text-yellow-500" /></div>
              <h3 className="text-xl font-black text-slate-900 dark:text-white mb-2">存在未保存的数据</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 font-medium mb-8 leading-relaxed">你的研究尚未记录，<br />直接离开将会导致这些数据消散在虚空中。</p>

              <div className="flex flex-col gap-3">
                <button
                  onClick={() => handleSave(false, true)}
                  className="w-full py-4 bg-indigo-500 text-white rounded-2xl text-xs font-black uppercase tracking-widest shadow-lg shadow-indigo-500/30 hover:bg-indigo-600 transition-all flex items-center justify-center gap-2"
                >
                  <Save size={16} /> 存为草稿并离开
                </button>
                <div className="flex gap-3">
                  <button onClick={() => setExitModalOpen(false)} className="flex-1 py-4 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-slate-200 transition-all">取消</button>
                  <button onClick={() => { setExitModalOpen(false); setHasUnsavedChanges(false); router.back(); }} className="flex-1 py-4 bg-red-500/10 text-red-500 rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-red-500 hover:text-white transition-all flex items-center justify-center gap-2">
                    <LogOut size={16} /> 强行抛弃
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <div className="editor-page-toolbar"><button className="console-action secondary" type="button" onClick={handleBackClick}><ArrowLeft size={16} />返回内容库</button><span>{docType === 'about' ? '关于页' : docType === 'chatter' ? '杂谈' : '文章'} · {currentDocId === 'new' ? '新建' : currentDocId}</span></div>
      <main className="editor-workspace">
          <section className="editor-document">
            <RichTextEditor
              ref={editorRef}
              title={title}
              setTitle={(val) => { setTitle(val); setHasUnsavedChanges(true); setChangeRevision((revision) => revision + 1); }}
              initialContent={content}
              isTitleLocked={docType === 'about'}
              onOpenImageTool={() => { setImgToolTarget('editor'); setIsImgToolOpen(true); }}
              onChange={() => { setHasUnsavedChanges(true); setChangeRevision((revision) => revision + 1); }}
            />
          </section>

          <aside className="editor-meta">
            <MetaMatrix
              type={docType as any} tags={tags} setTags={setTags} cover={cover} setCover={setCover} summary={summary} setSummary={setSummary} mood={mood} setMood={setMood}
              allHistoryPostTags={historyPostTags} allHistoryChatterTags={historyChatterTags} isLoadingTags={isLoadingTags}
              allHistoryMoods={historyMoods} onSave={(isPublish) => handleSave(isPublish, false)} isSaving={isSaving} lastSaved={lastSaved} onOpenImageTool={() => { setImgToolTarget('cover'); setIsImgToolOpen(true); }}
            />
          </aside>
      </main>
      <FloatingImageTool isOpen={isImgToolOpen} onClose={() => setIsImgToolOpen(false)} onInsert={(url) => {
        if (imgToolTarget === 'editor') { editorRef.current?.insertImage(url); if (!cover) setCover(url); }
        else { setCover(url); setIsImgToolOpen(false); }
        setHasUnsavedChanges(true);
      }} />
    </div>
  );
}

// 🌟 核心修改 2：在底部暴露真正的 EditorPage，并用 Suspense 把里面的内容套起来
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
      <EditorContent />
    </Suspense>
  );
}
