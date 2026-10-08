'use client';

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { managerApi, currentCloudRevision } from '../lib/managerApi';
import type { Operation, OperationInput } from '../lib/operationTypes';

interface OperationContextType {
  operations: Operation[];
  addOperation: (operation: OperationInput) => void;
  removeOperation: (id: string) => void;
  clearOperations: () => void;
  applyOperations: () => Promise<{ count: number }>;
  hydrated: boolean;
  saving: boolean;
  error: string;
  retrySave: () => Promise<void>;
}

const OperationContext = createContext<OperationContextType | undefined>(undefined);
const singletonOperationTypes = new Set<Operation['type']>([
  'projects_update',
  'gallery_update',
  'friends_update',
  'settings_update',
]);

export function OperationProvider({ children }: { children: React.ReactNode }) {
  const [operations, setOperations] = useState<Operation[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const latest = useRef<Operation[]>([]);
  const writeChain = useRef<Promise<unknown>>(Promise.resolve());
  const applying = useRef(false);
  const persistTimer = useRef<number | undefined>(undefined);
  const skipFirstPersist = useRef(true);

  const persist = useCallback((snapshot: Operation[]) => {
    const request = writeChain.current.catch(() => undefined).then(() =>
      managerApi('/api/operations', { method: 'PUT', body: JSON.stringify({ operations: snapshot }) }));
    writeChain.current = request;
    setSaving(true);
    return request.then(() => {
      setError('');
      if (latest.current === snapshot) setDirty(false);
    }).catch((reason) => {
      setError(reason instanceof Error ? reason.message : '队列保存失败');
      throw reason;
    }).finally(() => { if (writeChain.current === request) setSaving(false); });
  }, []);

  const load = useCallback(async () => {
    try {
      const data = await managerApi<{ operations: Operation[] }>('/api/operations');
      latest.current = data.operations || [];
      setOperations(latest.current);
      setError('');
      setHydrated(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法读取操作队列');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!hydrated) return;
    if (skipFirstPersist.current) { skipFirstPersist.current = false; return; }
    const timeout = window.setTimeout(() => {
      if (!applying.current) void persist(operations).catch(() => undefined);
    }, 250);
    persistTimer.current = timeout;
    return () => window.clearTimeout(timeout);
  }, [hydrated, operations, persist]);

  const update = useCallback((transform: (current: Operation[]) => Operation[]) => {
    if (!hydrated) throw new Error('操作队列尚未读取成功，请先重试连接');
    if (applying.current) throw new Error('正在应用操作，请完成后再编辑');
    latest.current = transform(latest.current);
    setDirty(true);
    setOperations(latest.current);
  }, [hydrated]);

  const addOperation = useCallback((operation: OperationInput) => {
    const next = {
      ...operation,
      id: operation.id || crypto.randomUUID().replaceAll('-', '_'),
      description: operation.description || '',
      timestamp: operation.timestamp || new Date().toISOString(),
      cloudRevision: currentCloudRevision(),
    } as Operation;
    update((current) => {
      if (singletonOperationTypes.has(next.type)) {
        return [...current.filter((item) => item.type !== next.type), next];
      }
      return [...current.filter((item) => item.id !== next.id), next];
    });
  }, [update]);

  const removeOperation = useCallback((id: string) => update((current) => current.filter((item) => item.id !== id)), [update]);
  const clearOperations = useCallback(() => update(() => []), [update]);
  const retrySave = useCallback(async () => {
    if (!hydrated) return load();
    await persist(latest.current);
  }, [hydrated, load, persist]);
  const applyOperations = useCallback(async () => {
    if (!hydrated || applying.current) throw new Error('操作队列尚未就绪或正在应用');
    applying.current = true;
    window.clearTimeout(persistTimer.current);
    try {
      // 先等待旧写入，再保存最新快照，避免点击应用时仍在防抖等待。
      await persist(latest.current);
      const result = await managerApi<{ count: number }>('/api/operations/apply', { method: 'POST', body: '{}' });
      latest.current = [];
      setDirty(false);
      skipFirstPersist.current = true;
      setOperations([]);
      return result;
    } finally { applying.current = false; }
  }, [hydrated, persist]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (saving || dirty) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [saving, dirty]);

  return <OperationContext.Provider value={{ operations, addOperation, removeOperation, clearOperations, applyOperations, hydrated, saving, error, retrySave }}>{children}</OperationContext.Provider>;
}

export function useOperations() {
  const context = useContext(OperationContext);
  if (!context) throw new Error('useOperations must be used within an OperationProvider');
  return context;
}
