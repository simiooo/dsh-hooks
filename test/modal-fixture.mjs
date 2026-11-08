import React from 'react';
import { createPortal } from 'react-dom';
const h = React.createElement;
export function Button({ variant, size, icon, ...props }) { return h('button', { type: 'button', ...props }); }
/** Public Modal API fixture; Harness owns its focus and keyboard implementation. */
export function Modal({ open, title, closeLabel, onClose, children, footer, className, contentClassName }) {
  React.useEffect(() => {
    if (!open) return;
    const previous = document.activeElement;
    const key = event => { if (event.key === 'Escape' && !event.isComposing && !event.repeat) onClose(); };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); previous?.focus(); };
  }, [open, onClose]);
  return open ? createPortal(h('div', { role: 'dialog', 'aria-modal': true, 'aria-label': title, className },
    h('button', { type: 'button', 'aria-label': closeLabel, onClick: onClose }, '×'),
    h('div', { className: contentClassName }, children), footer), document.body) : null;
}
