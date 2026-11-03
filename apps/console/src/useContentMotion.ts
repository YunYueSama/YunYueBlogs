import { useLayoutEffect, useRef } from 'react';

// 先提交正确内容再轻量呈现；中断时取消旧动画，不让退出节点占据新布局。
export function useContentMotion(key: string) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const animation = element.animate([{ opacity: .88 }, { opacity: 1 }], { duration: 130, easing: 'ease-out' });
    return () => animation.cancel();
  }, [key]);
  return ref;
}
