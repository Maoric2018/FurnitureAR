import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';
export default function Modal({children,onClose,label,className=''}:{children:ReactNode;onClose:()=>void;label:string;className?:string}) {
  const dialog=useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const item=dialog.current;
    const previous=document.activeElement as HTMLElement | null;
    item?.showModal();
    const oldOverflow=document.body.style.overflow;
    document.body.style.overflow='hidden';
    return () => { item?.close(); document.body.style.overflow=oldOverflow; previous?.focus(); };
  },[]);
  return <dialog ref={dialog} className={`modal ${className}`} aria-label={label} onCancel={event=>{event.preventDefault();onClose();}} onClick={event=>{if(event.target===dialog.current)onClose();}}>
    <div className="modal-inner"><button className="icon-button close-modal" aria-label="Close dialog" onClick={onClose}><X size={21}/></button>{children}</div>
  </dialog>;
}
