'use client';

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { managerApi } from '../lib/managerApi';
import type { Operation, OperationInput } from '../lib/operationTypes';

interface OperationContextType {
  operations: Operation[];
  addOperation: (operation: OperationInput) => void;
  removeOperation: (id: string) => void;
  clearOperations: () => void;
  applyOperations: () => Promise<{ count: number }>;
  hydrated: boolean;
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
  const skipFirstPersist = useRef(true);

  useEffect(() => {
    managerApi<{ operations: Operation[] }>('/api/operations')
      .then((data) => setOperations(data.operations || []))
      .catch(() => setOperations([]))
      .finally(() => setHydrated(true));
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    if (skipFirstPersist.current) { skipFirstPersist.current = false; return; }
    const timeout = window.setTimeout(() => {
      void managerApi('/api/operations', { method: 'PUT', body: JSON.stringify({ operations }) });
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [hydrated, operations]);

  const addOperation = useCallback((operation: OperationInput) => {
    const next = {
      ...operation,
      id: operation.id || crypto.randomUUID().replaceAll('-', '_'),
      description: operation.description || '',
      timestamp: operation.timestamp || new Date().toISOString(),
    } as Operation;
    setOperations((current) => {
      if (singletonOperationTypes.has(next.type)) {
        return [...current.filter((item) => item.type !== next.type), next];
      }
      return [...current.filter((item) => item.id !== next.id), next];
    });
  }, []);

  const removeOperation = useCallback((id: string) => setOperations((current) => current.filter((item) => item.id !== id)), []);
  const clearOperations = useCallback(() => setOperations([]), []);
  const applyOperations = useCallback(async () => {
    const result = await managerApi<{ count: number }>('/api/operations/apply', { method: 'POST', body: '{}' });
    setOperations([]);
    return result;
  }, []);

  return <OperationContext.Provider value={{ operations, addOperation, removeOperation, clearOperations, applyOperations, hydrated }}>{children}</OperationContext.Provider>;
}

export function useOperations() {
  const context = useContext(OperationContext);
  if (!context) throw new Error('useOperations must be used within an OperationProvider');
  return context;
}
