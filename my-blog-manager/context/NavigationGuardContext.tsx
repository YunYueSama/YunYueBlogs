'use client';

import { createContext, useCallback, useContext, useEffect, useRef } from 'react';

type Navigation = () => void;
type Guard = (proceed: Navigation) => void;
const Context = createContext<{ register: (guard: Guard | null) => void; navigate: (proceed: Navigation) => void; blocked: () => boolean }>({ register() {}, navigate: (proceed) => proceed(), blocked: () => false });

export function NavigationGuardProvider({ children }: { children: React.ReactNode }) {
  const guard = useRef<Guard | null>(null);
  const register = useCallback((next: Guard | null) => { guard.current = next; }, []);
  const navigate = useCallback((proceed: Navigation) => { if (guard.current) guard.current(proceed); else proceed(); }, []);
  const blocked = useCallback(() => Boolean(guard.current), []);

  useEffect(() => {
    // Navigation API 可以在浏览器后退前取消跳转；普通 Link 和快捷导航另走同一守卫。
    type TraverseEvent = Event & { navigationType: string; destination: { key: string; sameDocument: boolean }; canIntercept: boolean };
    const navigation = (window as unknown as { navigation?: EventTarget & { traverseTo: (key: string) => unknown } }).navigation;
    if (!navigation) return;
    let bypass = false;
    const onNavigate = (raw: Event) => {
      const event = raw as TraverseEvent;
      if (bypass) { bypass = false; return; }
      if (!guard.current || event.navigationType !== 'traverse' || !event.canIntercept || !event.cancelable || !event.destination.sameDocument) return;
      event.preventDefault();
      guard.current(() => { bypass = true; navigation.traverseTo(event.destination.key); });
    };
    navigation.addEventListener('navigate', onNavigate);
    return () => navigation.removeEventListener('navigate', onNavigate);
  }, []);

  return <Context.Provider value={{ register, navigate, blocked }}>{children}</Context.Provider>;
}

export const useNavigationGuard = () => useContext(Context);
