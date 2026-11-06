/* A centred overlay card over a dimmed page — the shadcn Dialog (Radix) since 2026-11-01, its props unchanged: focus moves
   into the card and Tab stays there, the page behind is inert and still, Escape and a press on the backdrop close it,
   and focus goes back to whatever opened it. The card wears the theme of the box it was opened from.
   Closing fades for OUT_MS, then a timer (never an animation end) unmounts it. */

/** The close: the fade's length, and the timer that follows it */
const OUT_MS = 180;

import { useEffect, useRef, useState, type ReactNode } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { themeScopeRef, useLayeredEscape, useOpener } from '../shadcn/layer';
import { cn } from '../shadcn/utils';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  ariaLabel: string;
  header: ReactNode;
  children: ReactNode;
  /** Extra controls pinned to the header's right, before the close button. */
  headerActions?: ReactNode;
  /** Controls centred in the header — for the one control the whole view hangs on. */
  headerCenter?: ReactNode;
  /** Tailwind max-width class — default is the medium drilldown size. */
  widthClass?: string;
  /** Stacking class. The library sheet sits at z-130, so a dialog opened from it passes a higher one. */
  zClass?: string;
}

const Modal = ({ open, onClose, ariaLabel, header, children, headerActions, headerCenter, widthClass = 'max-w-[760px]', zClass = 'z-[90]' }: ModalProps) => {
  /* shown outlives open by OUT_MS — the fade; the content of the last open render is held through it */
  const [shown, setShown] = useState(open);
  const [closing, setClosing] = useState(false);
  const held = useRef({ header, children, headerActions, headerCenter });
  if (open) held.current = { header, children, headerActions, headerCenter };
  useEffect(() => {
    if (open) {
      setShown(true);
      setClosing(false);
      return;
    }
    if (!shown) return;
    setClosing(true);
    const t = window.setTimeout(() => {
      setShown(false);
      setClosing(false);
    }, OUT_MS);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  /* The innermost layer takes Escape: a hand-rolled layer inside (a toolbar menu) marks the key it took, and the modal,
     listening on the document behind it (before window-level fullscreen listeners), closes only on a key nobody took. */
  const onEscapeKeyDown = useLayeredEscape(open, onClose);
  const { onCloseAutoFocus } = useOpener(open);

  if (!shown) return null;
  const h = open ? { header, children, headerActions, headerCenter } : held.current;

  return (
    <DialogPrimitive.Root open onOpenChange={next => !next && open && onClose()}>
      <DialogPrimitive.Portal>
        {/* Backdrop — dimmed but deliberately still legible underneath; a press on it is the only outside press that closes */}
        <DialogPrimitive.Overlay
          className={`fixed inset-0 ${zClass} bg-black/55 backdrop-blur-[2px] ${closing ? 'animate-modal-backdrop-out pointer-events-none' : 'animate-modal-backdrop'}`}
          style={closing ? { pointerEvents: 'none' } : undefined}
          data-modal-backdrop
        />
        <div className={`fixed inset-0 ${zClass} flex items-center justify-center p-4 pointer-events-none`} data-modal-closing={closing || undefined}>
          <DialogPrimitive.Content
            ref={themeScopeRef}
            aria-label={ariaLabel}
            aria-modal
            aria-describedby={undefined}
            onEscapeKeyDown={onEscapeKeyDown}
            onPointerDownOutside={e => {
              if (!(e.target instanceof Element && e.target.closest('[data-modal-backdrop]'))) e.preventDefault();
            }}
            onFocusOutside={e => e.preventDefault()}
            onCloseAutoFocus={onCloseAutoFocus}
            className={cn(
              'relative w-full max-h-[86vh] flex flex-col border border-borderMuted bg-panel rounded-lg shadow-2xl shadow-black/70 overflow-hidden focus:outline-none',
              widthClass,
              closing ? 'animate-modal-card-out pointer-events-none' : 'animate-modal-card pointer-events-auto',
            )}
          >
            {/* Three tracks so the centre stays centred no matter how long the
                identity on the left runs — an absolute overlay would collide. */}
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 py-3 border-b border-borderSubtle shrink-0">
              <div className="min-w-0">{h.header}</div>
              <div className="flex items-center justify-center">{h.headerCenter}</div>
              <div className="flex items-center justify-end gap-2">
                {h.headerActions}
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close"
                  className="p-1 -m-1 rounded text-textMuted hover:text-textPrimary hover:bg-ink/[0.05] transition-colors shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* [&>*]:shrink-0: sections keep their natural height and the body scrolls; otherwise an overflow-hidden child has a
                flex min-size of 0 and is crushed */}
            <div className="overflow-y-auto px-4 py-4 flex flex-col gap-4 [&>*]:shrink-0">{h.children}</div>
          </DialogPrimitive.Content>
        </div>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};

export default Modal;
