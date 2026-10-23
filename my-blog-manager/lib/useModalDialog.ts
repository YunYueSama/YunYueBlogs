'use client';

import { useEffect, useRef } from 'react';

const modalStack: HTMLDialogElement[] = [];
const focusableSelector = 'a[href], button, input:not([type="hidden"]), select, textarea, [tabindex], [contenteditable="true"]';

export function useModalDialog(open: boolean) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const previousTabIndex = dialog.getAttribute('tabindex');
    document.body.style.overflow = 'hidden';
    dialog.tabIndex = -1;
    dialog.showModal();
    modalStack.push(dialog);
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector))
      .filter((element) => element.tabIndex >= 0 && !element.matches(':disabled') && !element.closest('[inert]') && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden');
    const trapTab = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || modalStack.at(-1) !== dialog) return;
      const elements = focusable();
      const index = elements.indexOf(document.activeElement as HTMLElement);
      if (!elements.length) {
        event.preventDefault(); dialog.focus({ preventScroll: true });
      } else if (event.shiftKey && index <= 0) {
        event.preventDefault(); elements.at(-1)!.focus({ preventScroll: true });
      } else if (!event.shiftKey && (index < 0 || index === elements.length - 1)) {
        event.preventDefault(); elements[0].focus({ preventScroll: true });
      }
    };
    // 提交中所有按钮可能一起禁用，此时保留对话框焦点，不退回页面背景。
    const observer = new MutationObserver(() => {
      if (modalStack.at(-1) !== dialog) return;
      const active = document.activeElement;
      if (!dialog.contains(active) || active?.matches(':disabled')) (focusable()[0] || dialog).focus({ preventScroll: true });
    });
    observer.observe(dialog, { subtree: true, childList: true, attributes: true, attributeFilter: ['disabled', 'hidden', 'tabindex'] });
    document.addEventListener('keydown', trapTab, true);
    return () => {
      observer.disconnect();
      document.removeEventListener('keydown', trapTab, true);
      const index = modalStack.lastIndexOf(dialog);
      if (index !== -1) modalStack.splice(index, 1);
      dialog.close();
      if (previousTabIndex === null) dialog.removeAttribute('tabindex');
      else dialog.setAttribute('tabindex', previousTabIndex);
      document.body.style.overflow = previousOverflow;
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, [open]);
  return ref;
}
