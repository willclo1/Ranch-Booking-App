import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}

/** Mobile bottom sheet. */
export function Sheet({ open, onClose, title, children }: SheetProps) {
  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = '';
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  // Keep the sheet above the on-screen keyboard.
  //
  // The keyboard shrinks the VISUAL viewport but not the LAYOUT viewport, and
  // `position: fixed` plus `dvh` both follow the layout one — so without this
  // the sheet stays anchored to the bottom of the screen, behind the keyboard.
  // The focused input ends up underneath it and the browser starts scrolling
  // the page around trying to reveal it.
  //
  // The movement is driven from here rather than by a CSS transition. iOS only
  // fires a couple of visualViewport events across the keyboard's ~300ms slide,
  // so a fixed-duration transition keeps restarting toward a target that has
  // already moved, which reads as rubber-banding. Sampling the viewport every
  // frame instead means the sheet follows the keyboard's real curve exactly.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!open || !vv) return;

    const root = document.documentElement;
    let raf = 0;
    let followUntil = 0;
    let last = -1;

    const write = () => {
      const overlap = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      const px = Math.round(overlap);
      if (px !== last) {
        last = px;
        root.style.setProperty('--kb-inset', `${px}px`);
      }
    };

    const tick = () => {
      write();
      raf = performance.now() < followUntil ? requestAnimationFrame(tick) : 0;
    };

    // Keep sampling for a beat after the last event so we track the tail of the
    // keyboard animation, not just the one frame the event happened to land on.
    const follow = () => {
      followUntil = performance.now() + 450;
      if (!raf) raf = requestAnimationFrame(tick);
    };

    write();
    vv.addEventListener('resize', follow);
    vv.addEventListener('scroll', follow);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      vv.removeEventListener('resize', follow);
      vv.removeEventListener('scroll', follow);
      root.style.removeProperty('--kb-inset');
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        {title && <h2 className="sheet-title">{title}</h2>}
        <div className="sheet-body">{children}</div>
      </div>
    </div>,
    document.body
  );
}
