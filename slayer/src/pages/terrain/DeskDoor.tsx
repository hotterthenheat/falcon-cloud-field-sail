import { useEffect, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { SlidersHorizontal } from 'lucide-react';
import SlowTip from '../../components/ui/SlowTip';
import { useAnchoredMenu } from '../../components/ui/useAnchoredMenu';
import { useHoverOpen } from '../../components/ui/useHoverOpen';

/*
==================================================
  SLAYER TERMINAL - THE DESK DOOR (pages/terrain/DeskDoor.tsx)

  The desk's own settings off the foot strip (2026-11-01, the owner, the strip under the charts: "can we also push this
  up so the chart is full"). The partner tree has no foot strip under the charts any more — its layout door, desks door
  and Panels door live on the ticker bar — and ours carried three more desk-wide choices on that strip: the rails'
  COLOURS, the SESSION the book is read in, and the distance UNITS. They stand here, one square on the ticker bar after
  the layout door, in the bar's grammar: the icon alone, the word on the slow hover, the card opening on the hover
  (ui/useHoverOpen) and on a press. Every row is the same control the strip carried — nothing is lost, nothing new.
==================================================
*/

const DeskDoor = ({ rows }: { rows: { key: string; label: string; control: ReactNode }[] }) => {
  const [open, setOpen] = useState(false);
  const { anchorRef, placed, menuRef } = useAnchoredMenu<HTMLButtonElement>(open, 'bottom', 280, 'start');
  const hover = useHoverOpen(true, setOpen, menuRef);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (!t) return;
      if (anchorRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      /* a row's own dropdown is a portal of its own (Radix) — a press in it is not a press outside */
      if (t.closest?.('[data-radix-popper-content-wrapper], [role="menu"], [role="listbox"]')) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('[data-radix-popper-content-wrapper]')) return;
      e.stopPropagation();
      setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open, anchorRef, menuRef]);
  /* the card stays while a row's own list is open — the pointer is over the list, outside this card */
  const hoverMenu = {
    ...hover.menu,
    onPointerLeave: (e: ReactPointerEvent) => {
      if (document.querySelector('[data-radix-popper-content-wrapper]')) return;
      hover.menu.onPointerLeave?.(e);
    },
  };
  return (
    <>
      <SlowTip label="Desk — colours, session, units">
        <button
          ref={anchorRef}
          type="button"
          onClick={() => setOpen(o => !o)}
          {...hover.trigger}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="Desk — colours, session, units"
          className={`inline-flex items-center justify-center w-8 h-8 rounded-lg transition-colors [&_svg]:w-[13px] [&_svg]:h-[13px] ${
            open ? 'bg-ink/[0.07] text-textPrimary' : 'text-textMuted hover:text-textPrimary hover:bg-ink/[0.05]'
          }`}
          data-desk-door
        >
          <SlidersHorizontal />
        </button>
      </SlowTip>
      {open &&
        placed &&
        createPortal(
          <div
            ref={menuRef}
            role="dialog"
            aria-label="The desk's settings"
            style={{ position: 'fixed', ...placed.box, width: 280 }}
            {...hoverMenu}
            className="z-[120] p-1.5 rounded-xl border border-borderMuted bg-panel shadow-xl shadow-black/25 overflow-visible animate-fade-in"
            data-desk-door-menu
            data-toolbar-menu=""
          >
            <div className="px-2.5 pt-1.5 pb-1 text-t10 font-bold uppercase tracking-[0.06em] text-textMuted select-none">The desk</div>
            {rows.map(r => (
              <div key={r.key} className="flex items-center justify-between gap-3 min-h-[36px] px-2.5 rounded-lg hover:bg-ink/[0.04]" data-desk-row={r.key}>
                <span className="text-t125 font-medium text-textSecondary">{r.label}</span>
                <span className="inline-flex">{r.control}</span>
              </div>
            ))}
          </div>,
          document.body
        )}
    </>
  );
};

export default DeskDoor;
