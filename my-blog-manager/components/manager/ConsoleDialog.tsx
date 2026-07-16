'use client';

import { AlertTriangle, X } from 'lucide-react';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';

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
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [busy, onClose, open]);

  if (!open) return null;
  return createPortal(<div className="console-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section className={`console-dialog ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby="console-dialog-title">
      <header><div><span>{eyebrow}</span><h2 id="console-dialog-title">{title}</h2></div><button className="console-icon" type="button" onClick={onClose} disabled={busy} aria-label="关闭"><X size={18} /></button></header>
      <div className="console-dialog-content">{children}</div>
      <footer>{footer}</footer>
    </section>
  </div>, document.body);
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
