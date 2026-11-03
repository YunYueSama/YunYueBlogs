import { useLayoutEffect, useRef } from 'react';

// 从屏幕上的当前位置重定向，连续切页不排队，也不等待动画结束才选中页面。
export function useNavigationIndicator(active: string) {
  const nav = useRef<HTMLElement>(null);
  const moving = useRef<Animation | undefined>(undefined);
  useLayoutEffect(() => () => moving.current?.cancel(), []);
  useLayoutEffect(() => {
    const root = nav.current;
    const indicator = root?.querySelector<HTMLElement>('.navigation-cursor');
    if (!root || !indicator) return;
    const place = () => {
      const selected = root.querySelector<HTMLElement>('[aria-current="page"]');
      if (!selected) { indicator.hidden = true; return; }
      const from = indicator.getBoundingClientRect();
      const target = selected.getBoundingClientRect();
      const bounds = root.getBoundingClientRect();
      const initialized = indicator.dataset.ready === 'true';
      moving.current?.cancel();
      indicator.hidden = false;
      Object.assign(indicator.style, { left: `${target.left - bounds.left}px`, top: `${target.top - bounds.top + root.scrollTop}px`, width: `${target.width}px`, height: `${target.height}px` });
      if (initialized && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        moving.current = indicator.animate([{ transform: `translate(${from.left - target.left}px,${from.top - target.top}px) scale(${from.width / target.width},${from.height / target.height})` }, { transform: 'none' }], { duration: 170, easing: 'cubic-bezier(.2,.7,.2,1)' });
      }
      indicator.dataset.ready = 'true';
    };
    place();
    const observer = new ResizeObserver(place); observer.observe(root);
    return () => { observer.disconnect(); };
  }, [active]);
  return nav;
}
