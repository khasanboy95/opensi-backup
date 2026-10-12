import { useEffect, useRef, type ReactNode } from 'react';
import { X, LoaderCircle, AlertCircle, Inbox } from 'lucide-react';

export function Spinner({ label = 'Yuklanmoqda...' }: { label?: string }) { return <div className="loading" role="status"><LoaderCircle className="spin" size={20} /><span>{label}</span></div>; }
export function Empty({ children, icon = true }: { children: ReactNode; icon?: boolean }) { return <div className="empty">{icon && <Inbox size={24} strokeWidth={1.5} />}<span>{children}</span></div>; }
export function ErrorBox({ message }: { message: string }) { return <div className="error-box" role="alert"><AlertCircle size={18} /><span>{message}</span></div>; }
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => { if (dialog?.open) dialog.close(); }; }, []);
  return <dialog ref={ref} className="modal" onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) { const box = event.currentTarget.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) onClose(); } }}>
    <header><h2>{title}</h2><button type="button" className="icon-button" aria-label="Yopish" onClick={onClose}><X size={19}/></button></header>{children}
  </dialog>;
}
export function Badge({ children, active = false }: { children: ReactNode; active?: boolean }) { return <span className={`badge ${active ? 'badge-active' : ''}`}><i/>{children}</span>; }
