'use client';

import { AlertTriangle, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useModalDialog } from '../../lib/useModalDialog';

export function ConsoleDialog({ open, eyebrow, title, onClose, busy = false, children, footer, wide = false }: {
  open: boolean;
  eyebrow: string;
  title: string;
  onClose: () => void;
  busy?: boolean;
  children: React.ReactNode;
  footer: React.ReactNode;
  wide?: boolean;
}) {
  const dialog = useModalDialog(open);

  if (!open) return null;
  return createPortal(<dialog ref={dialog} className="console-native-dialog" aria-labelledby="console-dialog-title" onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }} onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section className={`console-dialog ${wide ? 'wide' : ''}`}>
      <header><div><span>{eyebrow}</span><h2 id="console-dialog-title">{title}</h2></div><button className="console-icon" type="button" onClick={onClose} disabled={busy} aria-label="关闭"><X size={18} /></button></header>
      <div className="console-dialog-content">{children}</div>
      <footer>{footer}</footer>
    </section>
  </dialog>, document.body);
}

export function ConfirmDialog({ open, title, description, onClose, onConfirm, busy = false, confirmLabel = '确认删除' }: {
  open: boolean;
  title: string;
  description: string;
  onClose: () => void;
  onConfirm: () => void;
  busy?: boolean;
  confirmLabel?: string;
}) {
  return <ConsoleDialog open={open} eyebrow="DESTRUCTIVE ACTION" title={title} onClose={onClose} busy={busy} footer={<><button className="console-action secondary" type="button" onClick={onClose} disabled={busy}>取消</button><button className="console-action danger" type="button" onClick={onConfirm} disabled={busy}>{confirmLabel}</button></>}>
    <div className="console-confirm"><AlertTriangle size={28} color="var(--console-coral)" /><p>{description}</p></div>
  </ConsoleDialog>;
}
