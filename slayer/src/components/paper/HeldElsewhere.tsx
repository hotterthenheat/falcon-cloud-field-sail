/* Another tab holds the paper accounts (data/paper/store.ts, one tab at a time): this one reads them, and can take
   them. */

import { card } from '../review/DeskShell';
import { takeHere } from '../../data/paper/store';

export const HeldElsewhere = () => (
  <div className={`${card} px-5 py-3 flex items-center gap-4 flex-wrap border-warn/40`} data-paper-elsewhere>
    <div className="min-w-0 flex-1">
      <p className="text-t12 font-medium text-textPrimary">Your paper accounts are open in another tab.</p>
      <p className="mt-0.5 text-t11 text-textMuted">This tab only reads them. Taking them here moves the trading to this tab; what is open stays open.</p>
    </div>
    <button type="button" onClick={takeHere} className="h-8 px-4 rounded-full text-t12 font-semibold transition-opacity hover:opacity-90 tap-40" style={{ background: 'rgb(var(--silver-fill))', color: '#0a0a0a' }} data-paper-take-here>
      Take them here
    </button>
  </div>
);
