import { ChevronDown } from 'lucide-react';

/** The fold on a box's head: "Fold" with the chevron down while open, "Unfold" with it turned while shut (the tape's,
    2026-10-13, now every box's) */
const FoldDoor = ({ open, onToggle, what, testId }: { open: boolean; onToggle: () => void; what: string; testId: string }) => (
  <button
    type="button"
    onClick={onToggle}
    aria-expanded={open}
    title={open ? `Fold ${what} away` : `Show ${what}`}
    className="hit inline-flex items-center gap-1 h-6 px-1.5 rounded-md text-[11px] text-textMuted hover:text-textPrimary hover:bg-ink/[0.05] transition-colors"
    data-fold={testId}
  >
    <ChevronDown className={`w-3 h-3 transition-transform ${open ? '' : '-rotate-90'}`} />
    {open ? 'Fold' : 'Unfold'}
  </button>
);

export default FoldDoor;
