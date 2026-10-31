/* Another tab holds the paper accounts (data/paper/store.ts, one tab at a time): this one reads them, and can take
   them. Every control that would trade or change an account says so here, not by going quietly grey. */

import { card } from '../review/DeskShell';
import { takeHere } from '../../data/paper/store';

export const HeldElsewhere = () => (
  <div className={`${card} px-5 py-3 flex items-center gap-4 flex-wrap border-warn/40`} role="status" data-paper-elsewhere>
    <div className="min-w-0 flex-1">
      <p className="text-t12 font-semibold text-warn">Open in another tab — use them here</p>
      <p className="mt-0.5 text-t11 text-textSecondary">Your paper accounts are trading in another tab, so this one only reads them: orders, closes and new accounts wait. Use them here and the trading moves to this tab; what is open stays open.</p>
    </div>
    <button type="button" onClick={takeHere} className="h-8 px-4 rounded-full text-t12 font-semibold transition-opacity hover:opacity-90 tap-40" style={{ background: 'rgb(var(--silver-fill))', color: '#0a0a0a' }} data-paper-take-here>
      Use them here
    </button>
  </div>
);
