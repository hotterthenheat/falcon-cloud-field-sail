/* Backtest is paused: a replay needs the option quotes that stood each minute, and the app has no source for them
   yet. The old seeded tape was a random walk, so it is not offered as a past market. */

import { History } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useSessions } from '../../data/review/store';

const BACKTEST_PAUSED_WORDS =
  'Backtest is paused. A replay needs the option bid and ask that stood each minute of a past session, and the app has no source for that history yet. The old tape was a seeded random walk, so it is not offered as a past market.';

const BacktestPaused = () => {
  const navigate = useNavigate();
  const sessions = useSessions();
  return (
    <div className="border border-borderSubtle bg-panel rounded-md px-6 py-6 flex flex-col gap-3 max-w-[720px]" data-backtest-paused>
      <div className="flex items-center gap-2.5">
        <span className="inline-flex items-center justify-center w-7 h-7 rounded-md border border-borderSubtle text-textSecondary" aria-hidden="true">
          <History className="w-4 h-4" />
        </span>
        <h2 className="text-t15 font-semibold text-textPrimary">Backtest is paused</h2>
      </div>
      <p className="text-t12 leading-relaxed text-textSecondary">{BACKTEST_PAUSED_WORDS}</p>
      {sessions.length > 0 && (
        <p className="text-t11 leading-relaxed text-textMuted">
          {sessions.length === 1 ? 'Your one earlier session stays' : `Your ${sessions.length} earlier sessions stay`} in the Journal under Backtest, marked as played on the synthetic tape.
        </p>
      )}
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => navigate('/practice/paper')} className="inline-flex items-center h-7 px-3 rounded-md border border-borderSubtle hover:border-borderMuted text-t11 text-textPrimary transition-colors" data-backtest-to-paper>
          Practise on live prices in Paper
        </button>
        <button type="button" onClick={() => navigate('/practice/journal')} className="inline-flex items-center h-7 px-3 rounded-md border border-borderSubtle hover:border-borderMuted text-t11 text-textSecondary transition-colors">
          Open the Journal
        </button>
      </div>
    </div>
  );
};

export default BacktestPaused;
